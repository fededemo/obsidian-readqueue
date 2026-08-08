#!/usr/bin/env tsx
/**
 * Recupera las imágenes de las notas de X que ya están en la vault.
 *
 * El sync guardaba solo el `type` de cada media y tiraba la URL, así que 277 de
 * las 519 notas de X corresponden a tweets con imagen y ninguna la muestra. El
 * dato nunca se perdió: `media_json` en birdclaw tiene las URLs completas.
 *
 * Este script es de una sola vez — `sync-x.mts` ya lo hace solo para lo nuevo.
 *
 * Toca únicamente el cuerpo de la nota, y solo agregando:
 * - no renombra archivos (renombrar dispara el watcher de dedupe del plugin,
 *   que manda la nota a la papelera — pasó, 13 notas destruidas),
 * - no toca el frontmatter, donde viven `topic`, `tldr` y `shelfLife` que
 *   costaron plata,
 * - es idempotente: una nota que ya muestra sus imágenes se saltea.
 *
 *   npm run backfill-x-media -- --dry-run
 *   npm run backfill-x-media
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  hasMediaBlocks,
  insertMediaBlocks,
  mediaAssets,
  mediaMarkdown,
  type XItem,
  type XMedia,
  type XMediaVariant,
} from "../src/x-sync";
import { downloadAll } from "./lib/media.mjs";

/** Override para poder ensayar el backfill sobre una copia antes de la vault real. */
const VAULT = process.env["READQUEUE_VAULT"] ?? join(homedir(), "fedenotes");
const DB = join(homedir(), ".birdclaw", "birdclaw.sqlite");
const MEDIA = "Inbox/x-media";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const TWEET_URL = /(?:x|twitter)\.com\/[^/\s"]+\/status\/(\d+)/i;

interface RawMedia {
  type?: string;
  url?: string;
  thumbnailUrl?: string;
  variants?: XMediaVariant[];
}

function query<T>(sql: string): T[] {
  const out = execFileSync("sqlite3", ["-json", DB, sql], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  return out ? (JSON.parse(out) as T[]) : [];
}

/** `media_json` por id de tweet, para los que tienen algo adjunto. */
function mediaByTweet(): Map<string, XMedia[]> {
  const rows = query<{ id: string | number; media_json: string | null }>(
    "SELECT id, media_json FROM tweets WHERE media_count > 0;",
  );
  const map = new Map<string, XMedia[]>();
  for (const r of rows) {
    let raw: RawMedia[] = [];
    try {
      raw = JSON.parse(r.media_json ?? "[]") as RawMedia[];
    } catch {
      continue;
    }
    const media = raw
      .filter((m) => m.url)
      .map((m): XMedia => ({
        type: m.type ?? "",
        url: m.url as string,
        thumbnailUrl: m.thumbnailUrl,
        variants: m.variants,
      }));
    if (media.length > 0) map.set(String(r.id), media);
  }
  return map;
}

interface Candidate {
  path: string;
  tweetId: string;
  media: XMedia[];
  content: string;
  /** Lo que va después del frontmatter — lo único que se modifica. */
  body: string;
  bodyStart: number;
}

/**
 * Separa el frontmatter del cuerpo. Devuelve el offset donde arranca el cuerpo
 * para poder reescribir la nota sin volver a serializar el YAML: parsear y
 * re-emitir el frontmatter perdería comentarios, orden y comillas.
 */
function splitFrontmatter(content: string): { body: string; start: number } {
  if (!content.startsWith("---\n")) return { body: content, start: 0 };
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return { body: content, start: 0 };
  const start = end + 5;
  return { body: content.slice(start), start };
}

function collect(media: Map<string, XMedia[]>): Candidate[] {
  const out: Candidate[] = [];
  const walk = (rel: string): void => {
    const abs = join(VAULT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        walk(join(rel, e.name));
        continue;
      }
      if (!e.name.endsWith(".md")) continue;
      const path = join(rel, e.name);
      const content = readFileSync(join(VAULT, path), "utf-8");
      // Solo notas que escribió el sync de X: el `source` es la marca de origen.
      if (!/^source:\s*"?x-(bookmark|like)"?/m.test(content)) continue;
      const url = /^url:\s*"?([^"\s]+)"?/m.exec(content)?.[1];
      const tweetId = url ? TWEET_URL.exec(url)?.[1] : undefined;
      if (!tweetId) continue;
      const m = media.get(tweetId);
      if (!m) continue;
      const { body, start } = splitFrontmatter(content);
      if (hasMediaBlocks(body)) continue;
      out.push({ path, tweetId, media: m, content, body, bodyStart: start });
    }
  };
  walk("Inbox");
  return out;
}

/** Lo mínimo que `mediaAssets`/`mediaMarkdown` necesitan de un XItem. */
const asItem = (c: Candidate): XItem => ({
  id: c.tweetId,
  text: "",
  createdAt: "",
  authorHandle: "",
  urls: [],
  media: c.media,
  collection: "bookmarks",
});

// ---- main ----
if (!existsSync(DB)) {
  console.error(`No existe ${DB}. Corré: birdclaw sync bookmarks --mode xurl`);
  process.exit(1);
}

const candidates = collect(mediaByTweet()).slice(0, LIMIT);
const assets = candidates.flatMap((c) => mediaAssets(asItem(c)));
const fotos = candidates.filter((c) => c.media.every((m) => m.type === "image")).length;

console.log(`notas de X sin sus imágenes: ${candidates.length}`);
console.log(`  solo fotos: ${fotos} · con video: ${candidates.length - fotos}`);
console.log(`archivos a bajar: ${assets.length} (los .mp4 se linkean, no se bajan)`);

if (DRY) {
  console.log("\nDRY RUN — no se escribió nada. Muestra:");
  for (const c of candidates.slice(0, 8)) {
    const tipos = c.media.map((m) => m.type).join(", ");
    console.log(`  [${tipos}] ${c.path}`);
  }
  process.exit(0);
}

if (candidates.length === 0) {
  console.log("\nNada que hacer.");
  process.exit(0);
}

console.log(`\nbajando a ${MEDIA}/…`);
const { available, stats } = await downloadAll(assets, join(VAULT, MEDIA), {
  onProgress: (s) => {
    const done = s.ok + s.cached + s.failed;
    if (done % 25 === 0) process.stdout.write(`\r  ${done}/${assets.length}`);
  },
});
console.log(
  `\r  nuevas ${stats.ok} · ya estaban ${stats.cached} · fallaron ${stats.failed}` +
    (stats.failed > 0 ? " (esas quedan linkeadas al CDN de X)" : ""),
);

let updated = 0;
for (const c of candidates) {
  const blocks = mediaMarkdown(asItem(c), (a) => (available.has(a.filename) ? a.filename : undefined));
  const body = insertMediaBlocks(c.body, blocks);
  if (body === c.body) continue;
  writeFileSync(join(VAULT, c.path), c.content.slice(0, c.bodyStart) + body, "utf-8");
  updated++;
}

console.log(`\nnotas actualizadas: ${updated}`);
