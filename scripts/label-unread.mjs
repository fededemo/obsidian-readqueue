#!/usr/bin/env node
/**
 * Etiqueta las notas NO LEÍDAS contra el vocabulario de conceptos (B-731).
 *
 * El canon se destiló solo sobre las 238 leídas, así que hoy las 29 notas-concepto
 * son todas `conocido` y el grafo no toca lo pendiente. Sin este pase no existen
 * las conexiones de tipo **atraer** (leída ↔ no leída), que son justamente las que
 * le dan sentido a la cola: "leé esto porque se conecta con lo que ya sabés".
 *
 * El vocabulario sale de `Concepts/`, no del canon JSON: ver `lib/concepts.mjs`.
 *
 * No escribe en la vault. La salida es un JSON en el repo que consumen
 * `connection-pass.mjs` (el reporte) y `link-unread-to-concepts.mjs` (el apply).
 *
 * Barato por diseño: el input es título + topic + tldr, no el cuerpo. Los tldr
 * ya están al 100% desde B-713, así que no hay que volver a leer los artículos.
 *
 * Idempotente: saltea las notas que ya están en la salida.
 *
 *   node scripts/label-unread.mjs [--dry-run] [--limit N]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadConcepts } from "./lib/concepts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../docs/vault-gardener/unread-concepts.json");
const VAULT = join(homedir(), "fedenotes");
const FOLDER = "Inbox/Web";
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;
if (!apiKey) throw new Error("anthropicApiKey vacía en data.json");

/** Frontmatter crudo + cuerpo, sin dependencias de YAML. */
function split(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  return { fm: text.slice(4, end), body: text.slice(end + 4) };
}

const field = (fm, name) => {
  const m = fm.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};

function collect(rel) {
  const out = [];
  const walk = (r) => {
    const abs = join(VAULT, r);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(join(r, e.name));
      else if (e.name.endsWith(".md")) out.push(join(r, e.name));
    }
  };
  walk(rel);
  return out;
}

const concepts = await loadConcepts(VAULT);
const vocabList = concepts.map((c) => `- ${c.name}: ${c.gloss}`).join("\n");
const valid = new Map(concepts.map((c) => [c.name.toLowerCase(), c.name]));

const previous = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf-8")) : [];
const done = new Set(previous.map((r) => r.note));

const rows = [];
for (const path of collect(FOLDER)) {
  const text = await readFile(join(VAULT, path), "utf-8");
  const parts = split(text);
  if (!parts) continue;
  if (field(parts.fm, "status") !== "unread") continue;
  const note = path.replace(/^.*\//, "").replace(/\.md$/, "");
  if (done.has(note)) continue;
  // El tldr es el input barato; si falta (los "Link al paper:" de B-738), cae al cuerpo.
  const tldr = field(parts.fm, "tldr") ?? parts.body.replace(/\s+/g, " ").trim().slice(0, 300);
  rows.push({ note, path, topic: field(parts.fm, "topic"), tldr });
}

console.log(
  `no leídas: ${done.size + rows.length} · ya etiquetadas: ${done.size} · a procesar: ${rows.length}` +
    (DRY ? " · DRY RUN" : ""),
);
if (DRY || rows.length === 0) process.exit(0);

const prompt = (row) => `Vocabulario cerrado de conceptos:
${vocabList}

Lectura pendiente: "${row.note}" (tema: ${row.topic ?? "?"})
De qué trata: ${row.tldr}

¿Cuáles conceptos del vocabulario aparecen realmente en esta lectura? Máximo 2.
Solo los que estén claramente sostenidos por lo que dice arriba. Si ninguno encaja
de verdad, devolvé lista vacía — es una respuesta válida y preferible a forzar un
encaje débil. No inventes conceptos fuera del vocabulario.

Respondé SOLO JSON: {"concepts":["<nombre exacto del vocabulario>"]}`;

async function ask(row) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 250,
      messages: [{ role: "user", content: prompt(row) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  const text = (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]).concepts ?? []) : [];
}

const results = [...previous];
let hit = 0,
  empty = 0,
  failed = 0;

const queue = rows.slice(0, LIMIT);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const names = await ask(row);
        const concepts = names
          .slice(0, 2)
          .map((raw) => valid.get(String(raw).toLowerCase().trim()))
          .filter(Boolean);
        results.push({ note: row.note, path: row.path, topic: row.topic, concepts });
        if (concepts.length > 0) hit++;
        else empty++;
      } catch {
        failed++;
      }
    }
  }),
);

await writeFile(OUT, JSON.stringify(results, null, 1), "utf-8");

const withConcepts = results.filter((r) => r.concepts.length > 0).length;
console.log(`\nencajaron: ${hit} · sin encaje real: ${empty} · fallaron: ${failed}`);
console.log(
  `cobertura total: ${withConcepts}/${results.length} ` +
    `(${Math.round((100 * withConcepts) / results.length)}%)`,
);

const byConcept = new Map();
for (const r of results) for (const c of r.concepts) byConcept.set(c, (byConcept.get(c) ?? 0) + 1);
console.log(`\n${"pendientes".padStart(11)}  concepto`);
for (const [name, n] of [...byConcept.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${String(n).padStart(11)}  ${name}`);
}
