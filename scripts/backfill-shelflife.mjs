#!/usr/bin/env node
/**
 * Backfill de `shelfLife` + `tldr` sobre notas ya existentes (B-713).
 *
 * El intake los pone en las notas nuevas (B2); esto los pone en las viejas.
 * Idempotente: saltea las que ya tienen ambos campos, así se puede re-correr
 * sin gastar de nuevo. Lee la API key del data.json del plugin.
 *
 *   node scripts/backfill-shelflife.mjs [--dry-run] [--limit N] [--folder Inbox/Web]
 */
import { readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const VAULT = join(homedir(), "fedenotes");
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 6;
const SHELF_LIVES = ["evergreen", "seasonal", "perishable"];

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const DRY = args.includes("--dry-run");
const LIMIT = Number(flag("limit", Infinity));
const FOLDER = String(flag("folder", "Inbox/Web"));

const apiKey = await (async () => {
  const raw = await readFile(
    join(VAULT, ".obsidian/plugins/readqueue/data.json"),
    "utf-8",
  );
  const key = JSON.parse(raw).anthropicApiKey;
  if (!key) throw new Error("anthropicApiKey vacía en data.json");
  return key;
})();

/** Frontmatter crudo + cuerpo, sin dependencias de YAML. */
function split(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  return { fm: text.slice(4, end), body: text.slice(end + 4), fmEnd: end };
}

const field = (fm, name) => {
  const m = fm.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};

function prompt(title, topic, excerpt) {
  return `Sos un asistente que cataloga la cola de lectura de alguien.

Título: ${title}
Tema: ${topic ?? "desconocido"}

Primeros 700 caracteres:
${excerpt.slice(0, 700)}

Devolvé DOS cosas:

1. shelfLife — qué tan rápido envejece:
   - evergreen: principios, ensayos, papers, biografías. Sigue siendo cierto en 5 años.
   - seasonal: análisis de una situación en curso. Pierde filo en 6-12 meses.
   - perishable: noticias, lanzamientos, benchmarks, polémicas. En semanas es arqueología.

2. tldr — UNA sola oración en español, máximo 25 palabras, que responda
   "¿por qué valdría MI tiempo leer esto?". El payoff concreto, no un resumen.
   Sin preámbulo ("este artículo...", "el autor...").

Respondé SOLO un objeto JSON en una línea:
{"shelfLife":"<uno>","tldr":"<una oración>"}`;
}

async function classify(title, topic, excerpt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt(title, topic, excerpt) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = await res.json();
  const text = json?.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  const parsed = JSON.parse(m[0]);
  const shelfLife = SHELF_LIVES.find(
    (s) => s === String(parsed.shelfLife ?? "").toLowerCase().trim(),
  );
  let tldr = String(parsed.tldr ?? "").replace(/\s+/g, " ").trim();
  if (tldr.length < 10) tldr = "";
  if (tldr.length > 200) tldr = `${tldr.slice(0, 199).trimEnd()}…`;
  return { shelfLife, tldr: tldr || undefined };
}

const files = readdirSync(join(VAULT, FOLDER))
  .filter((f) => f.endsWith(".md"))
  .slice(0, LIMIT);

const todo = [];
for (const name of files) {
  const path = join(VAULT, FOLDER, name);
  const text = await readFile(path, "utf-8");
  const parts = split(text);
  if (!parts) continue;
  if (field(parts.fm, "shelfLife") && field(parts.fm, "tldr")) continue;
  todo.push({ path, name, text, parts });
}

console.log(
  `${files.length} notas en ${FOLDER} · ${todo.length} sin clasificar` +
    (DRY ? " · DRY RUN" : ""),
);
if (DRY || todo.length === 0) process.exit(0);

let done = 0,
  failed = 0;
const counts = { evergreen: 0, seasonal: 0, perishable: 0 };

async function work(item) {
  const { path, text, parts } = item;
  const title = field(parts.fm, "title") ?? item.name.replace(/\.md$/, "");
  try {
    const r = await classify(title, field(parts.fm, "topic"), parts.body);
    if (!r || (!r.shelfLife && !r.tldr)) {
      failed++;
      return;
    }
    const add = [];
    if (r.shelfLife && !field(parts.fm, "shelfLife")) {
      add.push(`shelfLife: ${r.shelfLife}`);
      counts[r.shelfLife]++;
    }
    // El tldr va con comillas: puede traer `:` y romper el YAML.
    if (r.tldr && !field(parts.fm, "tldr")) {
      add.push(`tldr: ${JSON.stringify(r.tldr)}`);
    }
    if (add.length === 0) return;
    const out = `---\n${parts.fm}\n${add.join("\n")}\n---${parts.body}`;
    await writeFile(path, out, "utf-8");
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${todo.length}…`);
  } catch (e) {
    failed++;
    if (failed <= 3) console.error(`  fallo en "${title}": ${e.message}`);
  }
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) await work(queue.shift());
  }),
);

console.log(`\nlistas: ${done} · fallidas: ${failed}`);
console.log(
  `shelfLife -> evergreen ${counts.evergreen} · seasonal ${counts.seasonal} · perishable ${counts.perishable}`,
);
