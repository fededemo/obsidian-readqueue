#!/usr/bin/env tsx
/**
 * Recupera el cuerpo de los X Articles que ya están en la vault (B-747).
 *
 * El sync clasificaba `x.com/i/article/…` como lectura (B-740) pero escribía
 * solo el tweet anuncio + el link. El HTML de esa URL es un shell de JS;
 * FxTwitter ya devolvía el artículo en `tweet.article` y nadie lo leía.
 *
 * Toca el cuerpo (inserta el markdown antes de `## Links`) y el `title` del
 * frontmatter. Baja las fotos a `Inbox/x-media/` y las embebe con `![[…]]`,
 * igual que las de los tweets: un archivo personal no depende del CDN de X.
 * No renombra archivos (el watcher de dedupe manda a la papelera) ni pisa
 * `topic`/`tldr`/`shelfLife`. Idempotente: si ya hay un H1 fuera de la cita,
 * se saltea el cuerpo; si las fotos ya son wikilinks, se saltean.
 *
 *   npm run backfill-x-articles -- --dry-run
 *   npm run backfill-x-articles
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { hasArticleBody, insertArticleBody } from "../src/x-sync";
import {
  isXArticleUrl,
  localizeRemoteImages,
  remoteImagesInMarkdown,
  xArticleToMarkdown,
} from "../src/x-article";
import { fetchTweetJson, sleep, tweetIdFromUrl } from "./lib/fx.mjs";
import { downloadAll } from "./lib/media.mjs";

const VAULT = process.env["READQUEUE_VAULT"] ?? join(homedir(), "fedenotes");
const FOLDERS = ["Inbox/Web", "Inbox/Legacy/X"];
const MEDIA = "Inbox/x-media";
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

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

const field = (fm: string, name: string): string | undefined =>
  new RegExp(`^${name}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim()?.replace(/^["']|["']$/g, "");

function setTitle(fm: string, title: string): string {
  const line = `title: ${JSON.stringify(title)}`;
  return /^title:/m.test(fm) ? fm.replace(/^title:\s*.*$/m, line) : `${line}\n${fm}`;
}

interface Candidate {
  path: string;
  id: string;
  content: string;
  fm: string;
  body: string;
}

const candidates: Candidate[] = [];
let already = 0;
let skipped = 0;

for (const folder of FOLDERS) {
  for (const path of collect(folder)) {
    const content = await readFile(join(VAULT, path), "utf-8");
    if (!/^source:\s*"?x-(bookmark|like)"?\s*$/m.test(content)) continue;
    const end = content.indexOf("\n---", 3);
    if (end < 0) continue;
    const fm = content.slice(4, end);
    const body = content.slice(end + 4);
    const target = field(fm, "targetUrl");
    if (!target || !isXArticleUrl(target)) continue;
    if (hasArticleBody(body)) {
      already++;
      continue;
    }
    const id = tweetIdFromUrl(field(fm, "url") ?? "");
    if (!id) {
      skipped++;
      continue;
    }
    candidates.push({ path, id, content, fm, body });
  }
}

const todo = candidates.slice(0, LIMIT);
console.log(
  `X Articles sin cuerpo: ${candidates.length} · ya tenían: ${already} · sin id: ${skipped}` +
    (DRY ? " · DRY RUN" : ""),
);

let ok = 0;
let fail = 0;
const queue = [...todo];
const examples: string[] = [];

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) break;
      const tweet = await fetchTweetJson(c.id);
      await sleep(250);
      const article = tweet?.article;
      if (!article || typeof article !== "object") {
        fail++;
        continue;
      }
      const markdown = xArticleToMarkdown(article);
      if (!markdown) {
        fail++;
        continue;
      }
      const title = typeof article.title === "string" ? article.title.trim() : "";
      const block = title ? `# ${title}\n\n${markdown}` : markdown;
      const nextBody = insertArticleBody(c.body, block);
      const nextFm = title ? setTitle(c.fm, title) : c.fm;
      if (DRY) {
        ok++;
        if (examples.length < 8) examples.push(`${c.path} → ${title || "(sin título)"}`);
        continue;
      }
      await writeFile(join(VAULT, c.path), `---\n${nextFm}\n---${nextBody}`, "utf-8");
      ok++;
      if (examples.length < 8) examples.push(`${c.path} → ${title || "(sin título)"}`);
    }
  }),
);

console.log(`escritas: ${ok} · sin artículo en FxTwitter: ${fail}`);
for (const e of examples) console.log(`  ${e}`);

/**
 * Segunda pasada: las fotos que el cuerpo insertó como `![](cdn)` se bajan a
 * `Inbox/x-media/` y se reemplazan por wikilinks. Corre sobre todas las notas
 * de X Article, no solo las que acabamos de escribir — el primer backfill
 * dejó 90 con el CDN.
 */
const imageJobs: Array<{ path: string; content: string; assets: ReturnType<typeof remoteImagesInMarkdown> }> = [];
for (const folder of FOLDERS) {
  for (const path of collect(folder)) {
    const content = await readFile(join(VAULT, path), "utf-8");
    if (!/^source:\s*"?x-(bookmark|like)"?\s*$/m.test(content)) continue;
    if (!/^targetUrl:\s*"?https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//im.test(content)) {
      continue;
    }
    const assets = remoteImagesInMarkdown(content);
    if (assets.length === 0) continue;
    imageJobs.push({ path, content, assets });
  }
}

const imageAssets = imageJobs.flatMap((j) => j.assets);
const unique = [...new Map(imageAssets.map((a) => [a.filename, a])).values()];
console.log(`\nfotos remotas: ${unique.length} en ${imageJobs.length} notas` + (DRY ? " · DRY RUN" : ""));

if (unique.length === 0) process.exit(0);

const mediaDir = join(VAULT, MEDIA);
let available = new Set<string>();
if (DRY) {
  available = new Set(unique.map((a) => a.filename));
} else {
  const result = await downloadAll(unique, mediaDir);
  available = result.available;
  console.log(
    `  nuevas ${result.stats.ok} · ya estaban ${result.stats.cached} · fallaron ${result.stats.failed}`,
  );
}

let localized = 0;
for (const job of imageJobs) {
  const next = localizeRemoteImages(job.content, available);
  if (next === job.content) continue;
  if (!DRY) await writeFile(join(VAULT, job.path), next, "utf-8");
  localized++;
}
console.log(`notas con fotos locales: ${localized}`);
