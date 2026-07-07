/**
 * One-off: score the wishlist fichas directly against the vault, with proper
 * pacing (so we don't trip Anthropic's rate limit the way the plugin's burst
 * did). Reuses the tested pure modules. Only scores fichas that lack a cached
 * matchScore, then regenerates the ranking note. Hard cost cap.
 *
 *   VAULT="/path/to/fedenotes" MAXUSD=4 npx tsx scripts/score-wishlist.ts
 */
import fs from "node:fs";
import path from "node:path";

import {
  buildScoreBatchPrompt,
  parseScoreBatch,
  renderWishlistRankNote,
  tierFromScore,
  type ContextPack,
  type HighlightItem,
  type RankedBook,
  type ReadItem,
} from "../src/recommend";
import { extractHighlights } from "../src/highlights-data";

const VAULT = process.env.VAULT;
if (!VAULT) throw new Error("set VAULT env");
const MAXUSD = Number.parseFloat(process.env.MAXUSD ?? "4");
const DATA = path.join(VAULT, ".obsidian/plugins/readqueue/data.json");
const cfg = JSON.parse(fs.readFileSync(DATA, "utf-8")) as Record<string, string>;
const KEY = cfg.anthropicApiKey;
const MODEL = cfg.recommendModel || "claude-sonnet-5";
const strip = (s: string): string => s.replace(/\/+$/, "");
const webFolder = strip(cfg.webFolder || "Inbox/Web");
const readFolder = strip(cfg.readFolder || "Inbox/Read");
const kindleFolder = strip(cfg.kindleFolder || "Inbox/Kindle");
const matterFolder = strip(cfg.matterFolder || "Inbox/Legacy");
const booksFolder = strip(cfg.booksFolder || "Books");

function walk(dir: string): string[] {
  const abs = path.join(VAULT!, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
const read = (rel: string): string => fs.readFileSync(path.join(VAULT!, rel), "utf-8");
const mtime = (rel: string): number => fs.statSync(path.join(VAULT!, rel)).mtimeMs;

function frontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const out: Record<string, string> = {};
  for (const line of content.slice(3, end).split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = (m[2] ?? "").trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    out[m[1] as string] = v;
  }
  return out;
}
function yamlStr(s: string): string {
  if (s === "" || /[:#[\]{}&*!|>'"%@`,]|:\s|\s$|^\s|^-/.test(s))
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
  return s;
}
function addFields(content: string, fields: Record<string, string | number>): string {
  const end = content.indexOf("\n---", 3);
  if (!content.startsWith("---") || end < 0) return content;
  const lines = Object.entries(fields)
    .map(([k, v]) => (typeof v === "number" ? `${k}: ${v}` : `${k}: ${yamlStr(v)}`))
    .join("\n");
  return content.slice(0, end) + "\n" + lines + content.slice(end);
}

// --- context pack from the vault ---
const readItems: ReadItem[] = [];
for (const rel of [...walk(webFolder), ...walk(readFolder)]) {
  const fm = frontmatter(read(rel));
  if (fm.status !== "read") continue;
  const item: ReadItem = { title: fm.title || path.basename(rel, ".md") };
  if (fm.topic) item.topic = fm.topic;
  if (fm.readAt) item.readAt = fm.readAt;
  readItems.push(item);
}
readItems.sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""));
const topicCounts = new Map<string, number>();
for (const a of readItems.slice(0, 30)) if (a.topic) topicCounts.set(a.topic, (topicCounts.get(a.topic) ?? 0) + 1);

const hlFiles = [...walk(kindleFolder), ...walk(webFolder), ...walk(matterFolder)].sort((a, b) => mtime(b) - mtime(a));
const highlights: HighlightItem[] = [];
for (const rel of hlFiles) {
  if (highlights.length >= 40) break;
  const content = read(rel);
  const fm = frontmatter(content);
  const title = fm.title || path.basename(rel, ".md");
  const source = fm.source;
  for (const h of extractHighlights(content, { sourcePath: rel, title, source })) {
    highlights.push({ text: h.text, source: h.articleSource, title });
    if (highlights.length >= 40) break;
  }
}

const queue: { title: string; topic?: string }[] = [];
for (const rel of walk(webFolder)) {
  const fm = frontmatter(read(rel));
  if (fm.status === "read") continue;
  const item: { title: string; topic?: string } = { title: fm.title || path.basename(rel, ".md") };
  if (fm.topic) item.topic = fm.topic;
  queue.push(item);
}

const pack: ContextPack = {
  read: readItems.slice(0, 30),
  topicDistribution: [...topicCounts.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count),
  highlights,
  queue: queue.slice(0, 40),
  owned: [],
  wishlist: [],
  priorRecommendations: [],
};
console.log(`context: read=${pack.read.length} highlights=${pack.highlights.length} queue=${pack.queue.length}`);

// --- wishlist fichas ---
const wlDir = `${booksFolder}/Wishlist`;
const fichas = walk(wlDir).map((rel) => ({ rel, fm: frontmatter(read(rel)) }))
  .filter((f) => f.fm.asin && f.fm.shelf === "wishlist");
const unscored = fichas.filter((f) => !f.fm.matchScore);
console.log(`wishlist: ${fichas.length} fichas · ${unscored.length} sin score`);

// --- score in paced batches ---
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let spentUsd = 0;
async function callBatch(batch: { asin: string; title: string; author?: string }[]): Promise<ReturnType<typeof parseScoreBatch>> {
  const body = { model: MODEL, max_tokens: 4000, thinking: { type: "disabled" }, messages: [{ role: "user", content: buildScoreBatchPrompt(pack, batch) }] };
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY as string, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 200) {
      const json = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
      spentUsd += ((json.usage?.input_tokens ?? 0) * 3 + (json.usage?.output_tokens ?? 0) * 15) / 1e6;
      const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return parseScoreBatch(text, new Set(batch.map((b) => b.asin)));
    }
    const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const wait = Number.isFinite(ra) ? ra * 1000 : 5000 * (attempt + 1);
    console.log(`  HTTP ${res.status} — esperando ${Math.round(wait / 1000)}s (intento ${attempt + 1})`);
    await sleep(Math.min(wait, 90000));
  }
  return [];
}

const BATCH = 50;
const now = new Date().toISOString();

void (async () => {
  let scored = 0;
  for (let i = 0; i < unscored.length; i += BATCH) {
    if (spentUsd > MAXUSD) { console.log(`⛔ tope de US$${MAXUSD} alcanzado (US$${spentUsd.toFixed(3)}). Freno.`); break; }
    if (i > 0) await sleep(3000);
    const slice = unscored.slice(i, i + BATCH);
    console.log(`scoreando ${Math.min(i + BATCH, unscored.length)}/${unscored.length}… (gastado US$${spentUsd.toFixed(3)})`);
    const results = await callBatch(slice.map((f) => {
      const b: { asin: string; title: string; author?: string } = { asin: f.fm.asin as string, title: f.fm.title || path.basename(f.rel, ".md") };
      if (f.fm.author) b.author = f.fm.author;
      return b;
    }));
    const byAsin = new Map(results.map((s) => [s.asin, s]));
    for (const f of slice) {
      const s = byAsin.get(f.fm.asin as string);
      if (!s) continue;
      const content = read(f.rel);
      fs.writeFileSync(path.join(VAULT!, f.rel), addFields(content, { matchScore: s.score, matchTier: s.tier, matchReason: s.reason, matchScoredAt: now }));
      scored++;
    }
  }
  console.log(`✅ scoreados ${scored} nuevos · costo total US$${spentUsd.toFixed(3)}`);

  // --- regenerate ranking note from ALL scored fichas ---
  const ranked: RankedBook[] = [];
  for (const rel of walk(wlDir)) {
    const fm = frontmatter(read(rel));
    if (!fm.asin || !fm.matchScore) continue;
    const score = Number.parseInt(fm.matchScore, 10);
    const tier = fm.matchTier === "now" || fm.matchTier === "soon" || fm.matchTier === "someday" ? fm.matchTier : tierFromScore(score);
    ranked.push({ asin: fm.asin, title: fm.title || path.basename(rel, ".md"), score, tier, reason: fm.matchReason ?? "" });
  }
  ranked.sort((a, b) => b.score - a.score);
  const date = now.slice(0, 10);
  const dest = path.join(VAULT!, booksFolder, "Rankings", `${date}.md`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, renderWishlistRankNote(ranked, { date, model: MODEL, generatedAt: now, total: fichas.length }));
  console.log(`📝 ranking: ${ranked.length} libros → ${path.relative(VAULT!, dest)}`);
  console.log(`tiers: now=${ranked.filter((r) => r.tier === "now").length} soon=${ranked.filter((r) => r.tier === "soon").length} someday=${ranked.filter((r) => r.tier === "someday").length}`);
})();
