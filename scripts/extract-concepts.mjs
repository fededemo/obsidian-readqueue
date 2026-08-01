#!/usr/bin/env node
/**
 * Pasada 1 del canon de conceptos (ADR-003): extrae 2-4 conceptos candidatos
 * de cada nota LEÍDA, con la evidencia textual que los sostiene.
 *
 * No sintetiza nada — solo junta materia prima. La pasada 2 (canonicalizar y
 * escribir las notas-concepto) va aparte, porque necesita ver todo junto.
 *
 * Para los libros de Kindle usa los HIGHLIGHTS, no el título ni la metadata:
 * los subrayados son la verdad de terreno de qué le importó al lector (es
 * también lo que arregla el `topic: otros` de B-506).
 *
 *   node scripts/extract-concepts.mjs [--dry-run] [--limit N]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const VAULT = join(homedir(), "fedenotes");
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/vault-gardener/concept-candidates.json",
);
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = Number(
  args.indexOf("--limit") >= 0 ? args[args.indexOf("--limit") + 1] : Infinity,
);

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;
if (!apiKey) throw new Error("anthropicApiKey vacía");

const ZONES = [
  ["kindle", "Inbox/Kindle"],
  ["read", "Inbox/Read"],
  ["legacy", "Inbox/Legacy/Matter"],
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(VAULT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(join(dir, e.name)));
    else if (e.name.endsWith(".md")) out.push(join(dir, e.name));
  }
  return out;
}

const field = (t, n) => {
  const m = t.match(new RegExp(`^${n}:\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};

/** Highlights para Kindle; cuerpo plano para el resto. */
function evidence(text, zone) {
  if (zone === "kindle") {
    const body = text.split("## Highlights", 1 + 1)[1] ?? "";
    const hs = body
      .split("\n")
      .filter((l) => l.startsWith("> ") && l.length > 40)
      .map((l) => l.slice(2).trim());
    // Muestra repartida: principio, medio y final del libro.
    const step = Math.max(1, Math.floor(hs.length / 18));
    return hs.filter((_, i) => i % step === 0).slice(0, 18).join("\n---\n");
  }
  const body = text.replace(/^---[\s\S]*?\n---/, "");
  return body.replace(/!\[.*?\]\(.*?\)/g, "").replace(/\s+/g, " ").slice(0, 2200);
}

const prompt = (title, topic, ev) => `Extraé los conceptos centrales de esta lectura.

Título: ${title}
Tema: ${topic ?? "?"}

Evidencia (subrayados o extracto):
${ev}

Devolvé 2 a 4 conceptos. Reglas:
- Un concepto es una IDEA REUTILIZABLE que podría aparecer en otras lecturas
  ("captura de valor", "compounding", "contra-posicionamiento"), NO un resumen
  ni el tema del texto ("este artículo sobre Nvidia").
- Nombralo en español, 2-5 palabras, sustantivo. Sin artículos iniciales.
- Por cada uno, una cita o paráfrasis corta del texto que lo sostenga.

Respondé SOLO JSON en una línea:
{"concepts":[{"name":"...","evidence":"..."}]}`;

async function ask(title, topic, ev) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt(title, topic, ev) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  const m = (j?.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return [];
  const parsed = JSON.parse(m[0]);
  return (parsed.concepts ?? [])
    .filter((c) => typeof c?.name === "string" && c.name.trim())
    .slice(0, 4)
    .map((c) => ({
      name: c.name.trim().toLowerCase(),
      evidence: String(c.evidence ?? "").replace(/\s+/g, " ").slice(0, 300),
    }));
}

const items = [];
for (const [zone, dir] of ZONES) {
  for (const rel of walk(dir)) {
    const text = await readFile(join(VAULT, rel), "utf-8");
    const ev = evidence(text, zone);
    if (ev.length < 120) continue; // sin material suficiente
    items.push({
      zone,
      note: rel.split("/").pop().replace(/\.md$/, ""),
      title: field(text, "title") ?? rel.split("/").pop().replace(/\.md$/, ""),
      topic: field(text, "topic"),
      ev,
    });
  }
}

const todo = items.slice(0, LIMIT);
console.log(
  `${items.length} notas leídas con material · procesando ${todo.length}` +
    (DRY ? " · DRY RUN" : ""),
);
if (DRY) {
  const byZone = {};
  for (const i of items) byZone[i.zone] = (byZone[i.zone] ?? 0) + 1;
  console.log(byZone);
  process.exit(0);
}

const results = [];
let done = 0,
  failed = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const it = queue.shift();
      try {
        const concepts = await ask(it.title, it.topic, it.ev);
        if (concepts.length > 0) {
          results.push({
            note: it.note,
            zone: it.zone,
            topic: it.topic,
            concepts,
          });
        }
        if (++done % 40 === 0) console.log(`  ${done}/${todo.length}…`);
      } catch (e) {
        failed++;
        if (failed <= 3) console.error(`  fallo "${it.title}": ${e.message}`);
      }
    }
  }),
);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(results, null, 1), "utf-8");

const freq = new Map();
for (const r of results)
  for (const c of r.concepts) freq.set(c.name, (freq.get(c.name) ?? 0) + 1);
console.log(`\nnotas con conceptos: ${results.length} · fallidas: ${failed}`);
console.log(`conceptos distintos: ${freq.size}`);
console.log(
  `repetidos (>=3): ${[...freq.values()].filter((n) => n >= 3).length}`,
);
console.log(`-> ${OUT}`);
