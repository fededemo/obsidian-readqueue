#!/usr/bin/env tsx
/**
 * Reclasifica los libros desde sus highlights, no desde el título (B-506).
 *
 * Medido en la vault: **33 de 34 libros de Kindle quedaron en `topic: otros`**.
 * *1929: Inside the Greatest Crash in Wall Street History* etiquetado "otros"
 * no es un error del modelo — es que el título solo no alcanza. Lo que sabe de
 * qué trata un libro es lo que Fede subrayó leyéndolo.
 *
 * Corre además el **coherence-check**: si el autor o el tema que salen del
 * contenido no coinciden con lo que dice la ficha, la ficha habla de otro libro.
 * Ese es el repro de B-506 — *The Infinity Machine* (Mallaby, DeepMind, leído)
 * confundido con *The Infinite Machine* (Russo, Ethereum, wishlist).
 *
 * Propaga el `topic` a la ficha de `Books/` cuando el ASIN coincide.
 *
 *   npx tsx scripts/classify-books.mts [--dry-run] [--limit N]
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  checkCoherence,
  extractQuotes,
  readBookIdentity,
  sameBook,
  sampleQuotes,
} from "../src/book-identity";

const VAULT = join(homedir(), "fedenotes");
const KINDLE = "Inbox/Kindle";
const BOOKS = "Books";
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 4;

const TOPICS: Record<string, string> = {
  tech: "software, IA, ingeniería, ciencia de la computación",
  producto: "negocio, startups, management, estrategia, diseño de producto",
  macro: "economía, mercados, finanzas, historia económica, geopolítica",
  ciencia: "biología, medicina, física, salud, naturaleza",
  personal: "hábitos, psicología, carrera, relaciones, autoconocimiento",
  cultura: "novela, historia, filosofía, biografía, arte, deporte",
  otros: "no encaja en ninguno de los anteriores",
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
/** Reclasificar incluso lo ya clasificado. Pisa correcciones humanas: usar a sabiendas. */
const FORCE = args.includes("--force");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const apiKey = (
  JSON.parse(
    await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
  ) as { anthropicApiKey?: string }
).anthropicApiKey;
if (!apiKey) throw new Error("anthropicApiKey vacía en data.json");

const vocab = Object.entries(TOPICS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n");

interface Verdict {
  topic: string;
  author: string | undefined;
}

async function classify(title: string, quotes: readonly string[]): Promise<Verdict | undefined> {
  const prompt = `Estos son subrayados de un libro, en orden, repartidos a lo largo del texto.

${quotes.map((q, i) => `${i + 1}. ${q}`).join("\n\n")}

El título dice: "${title}" — pero el título puede engañar. Fiate del contenido.

Devolvé:
- topic: uno de estos, según de qué trata REALMENTE el libro
${vocab}

  Ojo con la ficción: una novela va en \`cultura\` aunque sus personajes discutan
  de economía o de tecnología. Lo que decide es qué ES el libro, no de qué habla
  el pasaje que el lector marcó.
- author: si los subrayados dejan claro quién lo escribió o de quién trata la
  obra, ponelo; si no, null. No adivines a partir del título.

Respondé SOLO JSON: {"topic":"<uno>","author":<string o null>}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (j.content ?? []).find((b) => b.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  const parsed = JSON.parse(m[0]) as { topic?: string; author?: string | null };
  const topic = String(parsed.topic ?? "").toLowerCase().trim();
  if (!TOPICS[topic]) return undefined;
  return { topic, author: parsed.author ?? undefined };
}

const setField = (content: string, name: string, value: string): string => {
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  const fm = content.slice(4, end);
  const next = new RegExp(`^${name}:.*$`, "m").test(fm)
    ? fm.replace(new RegExp(`^${name}:.*$`, "m"), `${name}: ${value}`)
    : `${fm}\n${name}: ${value}`;
  return `---\n${next}\n---${content.slice(end + 4)}`;
};

// --- main -------------------------------------------------------------------

const kindleDir = join(VAULT, KINDLE);
if (!existsSync(kindleDir)) {
  console.error(`No existe ${KINDLE}`);
  process.exit(1);
}
const files = readdirSync(kindleDir).filter((f) => f.endsWith(".md"));
console.log(`${files.length} libros de Kindle` + (DRY ? " · DRY RUN" : ""));

const booksDir = join(VAULT, BOOKS);
const cards = existsSync(booksDir)
  ? await Promise.all(
      readdirSync(booksDir)
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          const content = await readFile(join(booksDir, f), "utf-8");
          return { file: f, content, id: readBookIdentity(content) };
        }),
    )
  : [];

const changes: Array<{ book: string; from: string | undefined; to: string }> = [];
const flags: Array<{ book: string; reason: string; confidence: string }> = [];
const skipped: string[] = [];
const respected: string[] = [];

const queue = files.slice(0, LIMIT);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      const path = join(kindleDir, file);
      const content = await readFile(path, "utf-8");
      const id = readBookIdentity(content);
      const quotes = sampleQuotes(extractQuotes(content));
      if (quotes.length === 0) {
        skipped.push(file.replace(/\.md$/, ""));
        continue;
      }
      let verdict: Verdict | undefined;
      try {
        verdict = await classify(id.title ?? file, quotes);
      } catch {
        verdict = undefined;
      }
      if (!verdict) {
        skipped.push(file.replace(/\.md$/, ""));
        continue;
      }

      const flag = checkCoherence(id, verdict);
      if (flag) {
        flags.push({ book: id.title ?? file, reason: flag.reason, confidence: flag.confidence });
      }

      /**
       * Upgrade-only, como el reconcile de fichas: se escribe si no había topic
       * o si decía `otros` (que es "no sé", no una afirmación).
       *
       * Los libros de frontera —*How Will You Measure Your Life?* es estrategia
       * de negocio aplicada a la vida— hacen oscilar al clasificador entre dos
       * temas igual de defendibles. Sin este guard cada corrida los da vuelta,
       * el coherence-check reporta ruido para siempre, y sobre todo: **una
       * corrección que Fede haga a mano se pierde en el próximo pase.**
       */
      const classified = id.topic && id.topic !== "otros";
      if (verdict.topic !== id.topic) {
        if (classified && !FORCE) {
          respected.push(`${id.title ?? file} (${id.topic}, el contenido sugería ${verdict.topic})`);
        } else {
          changes.push({ book: id.title ?? file, from: id.topic, to: verdict.topic });
          if (!DRY) await writeFile(path, setField(content, "topic", verdict.topic), "utf-8");
        }
      }

      // Propagar a la ficha del libro. Sin fuzzy: ASIN, o título exacto + autor.
      if (!DRY && (!classified || FORCE)) {
        for (const card of cards) {
          if (!sameBook(card.id, id)) continue;
          const updated = setField(card.content, "topic", verdict.topic);
          if (updated !== card.content) {
            await writeFile(join(booksDir, card.file), updated, "utf-8");
            card.content = updated;
          }
        }
      }
    }
  }),
);

console.log(`\nreclasificados: ${changes.length} · sin highlights o sin veredicto: ${skipped.length}`);
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.from ?? "—"} → ${c.to.padEnd(9)} ${c.book.slice(0, 60)}`);
}
if (flags.length > 0) {
  console.log(`\ncoherence-check — ${flags.length} fichas para mirar:`);
  for (const f of flags) console.log(`  [${f.confidence}] ${f.book.slice(0, 50)} — ${f.reason}`);
}
if (respected.length > 0) {
  console.log(`\nya clasificados, no se tocan (usá --force para pisarlos): ${respected.length}`);
  for (const r of respected) console.log(`  ${r}`);
}
if (skipped.length > 0) console.log(`\nsalteados: ${skipped.slice(0, 10).join(" · ")}`);
