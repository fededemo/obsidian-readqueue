#!/usr/bin/env tsx
/**
 * Recupera el texto completo de los tweets que entraron truncados (B-742).
 *
 * La API de X corta en 280 caracteres y engancha un `t.co`. Medido sobre los 650
 * de Fede: **ningún tweet superaba los 500 caracteres**, lo cual es imposible en
 * un corpus real. Un caso concreto —"how I'm building an agent company inside my
 * agency"— tenía 293 caracteres guardados contra 3.247 reales: el 9%.
 *
 * FxTwitter devuelve el post entero, es pública y gratis. Cuesta $0.
 *
 * Toca **solo el bloque de cita** de cada nota: el frontmatter ya trae `topic`,
 * `tldr` y `shelfLife` que costaron plata, y regenerar la nota entera los
 * perdería. Idempotente: si el texto que hay ya es el completo, no escribe.
 *
 *   npx tsx scripts/refetch-x-text.mts [--dry-run] [--limit N]
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { replaceQuoteBlock } from "../src/x-sync";
import { fetchFullText, sleep, tweetIdFromUrl } from "./lib/fx.mjs";

const VAULT = join(homedir(), "fedenotes");
const FOLDERS = ["Inbox/Web", "Inbox/Legacy/X"];
/** Por debajo de esto el tweet no puede estar cortado en 280. */
const SUSPECT_MIN = 240;
/** Solo se reemplaza si el texto nuevo aporta de verdad. */
const MIN_GAIN = 1.1;
/** Servicio público y gratuito: se consulta de a poco y sin apuro. */
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

interface Candidate {
  path: string;
  id: string;
  quote: string;
  body: string;
  head: string;
}

const collect = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (r: string): void => {
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

/** Primer bloque `>` del cuerpo: es la cita del tweet. */
function readQuote(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  const buf: string[] = [];
  while (i < lines.length && /^>/.test(lines[i] ?? "")) {
    buf.push((lines[i] ?? "").replace(/^>[ \t]?/, ""));
    i++;
  }
  return buf.join("\n").trim();
}

const candidates: Candidate[] = [];
let total = 0;
for (const folder of FOLDERS) {
  for (const path of collect(folder)) {
    const content = await readFile(join(VAULT, path), "utf-8");
    if (!/^source:\s*"?x-(bookmark|like)"?\s*$/m.test(content)) continue;
    total++;
    const end = content.indexOf("\n---", 3);
    if (end < 0) continue;
    const head = content.slice(0, end + 4);
    const body = content.slice(end + 4);
    const url = /^url:\s*"?([^"\s]+)"?/m.exec(content)?.[1];
    const id = tweetIdFromUrl(url);
    if (!id) continue;
    const quote = readQuote(body);
    if (quote.length < SUSPECT_MIN) continue;
    candidates.push({ path, id, quote, body, head });
  }
}

console.log(
  `notas de X: ${total} · sospechosas de truncado (>=${SUSPECT_MIN} chars): ${candidates.length}` +
    (DRY ? " · DRY RUN" : ""),
);
if (candidates.length === 0) process.exit(0);

let recovered = 0,
  unchanged = 0,
  failed = 0,
  gained = 0;

const queue = candidates.slice(0, LIMIT);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) break;
      const full = await fetchFullText(c.id);
      await sleep(250);
      if (!full) {
        failed++;
        continue;
      }
      if (full.length < c.quote.length * MIN_GAIN) {
        unchanged++;
        continue;
      }
      gained += full.length - c.quote.length;
      recovered++;
      if (!DRY) {
        await writeFile(join(VAULT, c.path), c.head + replaceQuoteBlock(c.body, full), "utf-8");
      }
      if (recovered <= 8) {
        console.log(
          `  ✓ ${c.quote.length} → ${full.length} chars · ${c.path.replace(/^.*\//, "").slice(0, 50)}`,
        );
      }
    }
  }),
);

console.log(
  `\n${DRY ? "DRY RUN · " : ""}recuperadas: ${recovered} · ya estaban completas: ${unchanged} · fallaron: ${failed}`,
);
if (recovered > 0) {
  console.log(
    `caracteres recuperados: ${gained.toLocaleString("es-AR")} ` +
      `(promedio ${Math.round(gained / recovered)} por nota)`,
  );
}
