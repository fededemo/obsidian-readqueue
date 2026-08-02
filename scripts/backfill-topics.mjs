#!/usr/bin/env node
/**
 * Backfill de `topic` sobre notas que no lo tienen.
 *
 * Pensado para `Inbox/Legacy/X` (E2 / B-603c): 537 notas frías sin topic son
 * 537 archivos que solo aparecen si buscás el texto literal. El acceptance del
 * ítem pide material "indexado y consultable", y el topic es lo que conecta ese
 * material con el resto del sistema — es el sustrato de SEGUNDO-CEREBRO §5.2.
 *
 * Batchea de a 10: el input por nota son pocas líneas, y mandar el vocabulario
 * 537 veces cuesta más que las clasificaciones. Si la respuesta no alinea con el
 * lote se reintenta de a una, así un batch raro no se traga 10 notas.
 *
 * Idempotente: saltea las que ya tienen `topic`.
 *
 *   node scripts/backfill-topics.mjs [--folder Inbox/Legacy/X] [--dry-run] [--limit N]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const VAULT = join(homedir(), "fedenotes");
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 6;
const BATCH = 10;

const TOPICS = {
  tech: "software, IA/ML, LLMs, programación, infraestructura, herramientas de desarrollo, hardware, semiconductores",
  producto:
    "diseño de producto, startups, growth, negocio, estrategia, marketing, ventas, management",
  macro: "economía, mercados, finanzas, geopolítica, política, energía, industria",
  ciencia: "biología, medicina, física, salud, longevidad, clima, investigación",
  personal: "hábitos, productividad, aprendizaje, carrera, relaciones, dinero personal",
  cultura: "arte, historia, filosofía, deporte, cine, música, sociedad, humor",
  otros: "no encaja en ninguno de los anteriores",
};

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const DRY = args.includes("--dry-run");
const FOLDER = String(flag("folder", "Inbox/Legacy/X"));
const LIMIT = Number(flag("limit", Infinity));

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;
if (!apiKey) throw new Error("anthropicApiKey vacía en data.json");

function split(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  return { fm: text.slice(4, end), body: text.slice(end + 4), fmEnd: end };
}

const collect = (rel) => {
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
};

const pending = [];
for (const path of collect(FOLDER)) {
  const text = await readFile(join(VAULT, path), "utf-8");
  const parts = split(text);
  if (!parts || /^topic:/m.test(parts.fm)) continue;
  pending.push({
    path,
    title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
    excerpt: parts.body.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim().slice(0, 400),
  });
}

console.log(
  `${FOLDER}: ${pending.length} sin topic` + (DRY ? " · DRY RUN" : ""),
);
if (DRY || pending.length === 0) process.exit(0);

const vocab = Object.entries(TOPICS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n");

const promptFor = (items) => `Clasificá cada ítem en UNO de estos temas:
${vocab}

Ítems:
${items.map((it, i) => `${i + 1}. ${it.title} — ${it.excerpt}`).join("\n\n")}

Respondé SOLO JSON con exactamente ${items.length} temas, en el mismo orden:
{"topics":[${items.map(() => '"<tema>"').join(",")}]}`;

async function ask(items) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: promptFor(items) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  const text = (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  const topics = m ? (JSON.parse(m[0]).topics ?? []) : [];
  // Un lote que no alinea es peor que un lote fallido: asignaría el tema de una
  // nota a otra. Se rechaza entero y el caller reintenta de a una.
  if (topics.length !== items.length) throw new Error("lote desalineado");
  return topics.map((t) => (TOPICS[String(t).toLowerCase().trim()] ? String(t).toLowerCase().trim() : null));
}

async function apply(item, topic) {
  const text = await readFile(join(VAULT, item.path), "utf-8");
  const parts = split(text);
  if (!parts || /^topic:/m.test(parts.fm)) return false;
  // `split` devuelve `fm` SIN el salto que sigue al `---` de apertura, así que
  // el salto va acá. Sin él queda `---topic: x` en una línea y Obsidian deja de
  // reconocer el frontmatter entero: la nota pierde source, topic y tags de una.
  const next = `---\n${parts.fm}\ntopic: ${topic}\n---${parts.body}`;
  await writeFile(join(VAULT, item.path), next, "utf-8");
  return true;
}

const batches = [];
const slice = pending.slice(0, LIMIT);
for (let i = 0; i < slice.length; i += BATCH) batches.push(slice.slice(i, i + BATCH));

let done = 0,
  failed = 0;
const counts = {};

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (batches.length > 0) {
      const items = batches.shift();
      let topics;
      try {
        topics = await ask(items);
      } catch {
        topics = null;
      }
      if (!topics) {
        for (const it of items) {
          try {
            const one = await ask([it]);
            topics = topics ?? [];
            if (one[0] && (await apply(it, one[0]))) {
              done++;
              counts[one[0]] = (counts[one[0]] ?? 0) + 1;
            } else failed++;
          } catch {
            failed++;
          }
        }
        continue;
      }
      for (let i = 0; i < items.length; i++) {
        const topic = topics[i];
        if (!topic) {
          failed++;
          continue;
        }
        if (await apply(items[i], topic)) {
          done++;
          counts[topic] = (counts[topic] ?? 0) + 1;
        }
      }
    }
  }),
);

console.log(`\nclasificadas: ${done} · fallaron: ${failed}`);
for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${t}`);
}
