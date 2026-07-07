// Pure "¿Qué leo ahora?" recommender (MX25). Mirrors topics.ts: a pure module
// with an injectable fetchJson (via the shared anthropic helper) so it's fully
// testable without the network. main.ts assembles the ContextPack from the vault
// and renders the returned note; everything here is data-shaping, prompting, a
// hallucination-guarded parser, and markdown rendering.

import {
  extractTextFromMessage,
  postMessagesWithRetry,
  type AnthropicFetchDeps,
  type RetryOpts,
} from "./anthropic";
import { bookCardSlug } from "./books-data";

// --- Context pack ------------------------------------------------------------

export interface ReadItem {
  title: string;
  topic?: string;
  readAt?: string;
  /** vault basename for a resolvable [[link]] (optional). */
  link?: string;
}
export interface HighlightItem {
  text: string;
  note?: string;
  source: string;
  title: string;
  link?: string;
}
export interface QueueItem {
  title: string;
  topic?: string;
}
export interface OwnedBook {
  asin: string;
  title: string;
  author?: string;
  readingStatus: string;
  topic?: string;
}
export interface WishlistBook {
  asin: string;
  title: string;
  author?: string;
  wishlistRemoved?: boolean;
}
export interface PriorRecommendation {
  date: string;
  asins: string[];
}

export interface ContextPack {
  read: ReadItem[];
  topicDistribution: Array<{ topic: string; count: number }>;
  highlights: HighlightItem[];
  queue: QueueItem[];
  owned: OwnedBook[];
  wishlist: WishlistBook[];
  priorRecommendations: PriorRecommendation[];
}

export interface Recommendation {
  asin: string | null;
  title: string;
  source: "owned" | "wishlist" | "new";
  reason: string;
  connects_to: string[];
}

const CAPS = {
  read: 30,
  highlights: 40,
  highlightChars: 220,
  queue: 40,
  owned: 60,
  wishlist: 80,
  prior: 4,
} as const;

// --- Prompt ------------------------------------------------------------------

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

export function buildRecommendPrompt(pack: ContextPack): string {
  const lines: string[] = [];
  lines.push(
    "You are a personal reading advisor. Recommend what the user should read next, drawing ONLY on the data below.",
    "",
    "Priority order for recommendations (hard rule):",
    "1. Books the user already OWNS but hasn't read, that match what they've been reading or highlighting.",
    "2. Books on their WISHLIST that match.",
    "3. Only then, genuinely NEW suggestions — and only if nothing they already have covers the interest. A 'new' recommendation MUST justify why nothing owned/wishlisted fits.",
    "You are also an anti-impulse-buy guard: never recommend buying about a topic they already have a big unread backlog on.",
    "",
  );

  if (pack.topicDistribution.length > 0) {
    lines.push(
      `Topic mix of recent reading: ${pack.topicDistribution
        .map((t) => `${t.topic} (${t.count})`)
        .join(", ")}`,
      "",
    );
  }

  if (pack.read.length > 0) {
    lines.push("Recently read articles:");
    for (const a of pack.read.slice(0, CAPS.read)) {
      lines.push(`- ${a.title}${a.topic ? ` [${a.topic}]` : ""}`);
    }
    lines.push("");
  }

  if (pack.highlights.length > 0) {
    lines.push("Recent highlights (what resonated):");
    for (const h of pack.highlights.slice(0, CAPS.highlights)) {
      const note = h.note ? ` — note: ${truncate(h.note, 120)}` : "";
      lines.push(`- «${truncate(h.text, CAPS.highlightChars)}» (${h.title})${note}`);
    }
    lines.push("");
  }

  if (pack.queue.length > 0) {
    lines.push(
      `Already queued (unread) — do NOT recommend buying more on these topics: ${pack.queue
        .slice(0, CAPS.queue)
        .map((q) => (q.topic ? `${q.title} [${q.topic}]` : q.title))
        .join("; ")}`,
      "",
    );
  }

  if (pack.owned.length > 0) {
    lines.push("Books the user OWNS (asin — title — readingStatus):");
    for (const b of pack.owned.slice(0, CAPS.owned)) {
      lines.push(
        `- ${b.asin} — ${b.title}${b.author ? ` by ${b.author}` : ""} — ${b.readingStatus}`,
      );
    }
    lines.push("");
  }

  if (pack.wishlist.length > 0) {
    lines.push("Books on the WISHLIST (asin — title):");
    for (const b of pack.wishlist.slice(0, CAPS.wishlist)) {
      const removed = b.wishlistRemoved ? " (later removed — weak signal)" : "";
      lines.push(`- ${b.asin} — ${b.title}${b.author ? ` by ${b.author}` : ""}${removed}`);
    }
    lines.push("");
  }

  if (pack.priorRecommendations.length > 0) {
    lines.push(
      `Previously recommended asins (avoid repeating unless still the best fit): ${pack.priorRecommendations
        .slice(0, CAPS.prior)
        .flatMap((p) => p.asins)
        .join(", ")}`,
      "",
    );
  }

  lines.push(
    "Reply with ONLY a JSON object, no prose, on the following shape:",
    '{"recommendations":[{"asin":"<asin from the lists above, or null if source is new>","title":"...","source":"owned"|"wishlist"|"new","reason":"why, referencing concrete articles/highlights above","connects_to":["concrete title or highlight it connects to", "..."]}]}',
    "Give 3 to 5 recommendations, ranked best-first. For owned/wishlist recommendations the asin MUST be one from the lists above.",
  );

  return lines.join("\n");
}

// --- Parsing (hallucination-guarded) -----------------------------------------

interface RawRec {
  asin?: unknown;
  title?: unknown;
  source?: unknown;
  reason?: unknown;
  connects_to?: unknown;
}

const asStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export function parseRecommendations(
  text: string,
  pack: ContextPack,
): Recommendation[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { recommendations?: unknown } | undefined;
  try {
    parsed = JSON.parse(match[0]) as { recommendations?: unknown };
  } catch {
    return [];
  }
  const rawList = Array.isArray(parsed?.recommendations)
    ? (parsed.recommendations as RawRec[])
    : [];

  const knownAsins = new Set<string>([
    ...pack.owned.map((b) => b.asin),
    ...pack.wishlist.map((b) => b.asin),
  ]);

  const out: Recommendation[] = [];
  const seen = new Set<string>();
  for (const raw of rawList) {
    const title = asStr(raw.title);
    if (!title) continue;
    const source =
      raw.source === "owned" || raw.source === "wishlist" || raw.source === "new"
        ? raw.source
        : "new";
    let asin = asStr(raw.asin) ?? null;
    // Anti-hallucination: an owned/wishlist rec must cite an asin that exists in
    // the pack. If it doesn't, the model invented it — treat it as a "new" idea.
    let finalSource: Recommendation["source"] = source;
    if (source !== "new") {
      if (!asin || !knownAsins.has(asin)) {
        finalSource = "new";
        asin = null;
      }
    } else {
      asin = null;
    }
    const dedupeKey = asin ?? title.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const connects = Array.isArray(raw.connects_to)
      ? raw.connects_to.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean)
      : [];
    out.push({
      asin,
      title,
      source: finalSource,
      reason: asStr(raw.reason) ?? "",
      connects_to: connects,
    });
    if (out.length >= 5) break;
  }
  return out;
}

// --- Note rendering ----------------------------------------------------------

/** Case-insensitive title → resolvable [[basename]] for navigable links. */
function buildLinkIndex(pack: ContextPack): Map<string, string> {
  const idx = new Map<string, string>();
  const add = (title: string, link?: string): void => {
    if (link) idx.set(title.toLowerCase(), link);
  };
  for (const a of pack.read) add(a.title, a.link);
  for (const h of pack.highlights) add(h.title, h.link);
  for (const b of pack.owned) add(b.title, bookCardSlug(b.title, b.asin));
  for (const b of pack.wishlist) add(b.title, bookCardSlug(b.title, b.asin));
  return idx;
}

function linkForTitle(title: string, idx: Map<string, string>): string {
  const link = idx.get(title.toLowerCase());
  return link ? `[[${link}|${title}]]` : title;
}

export function renderRecommendationNote(
  recs: readonly Recommendation[],
  opts: { date: string; model: string; pack: ContextPack; generatedAt: string },
): string {
  const idx = buildLinkIndex(opts.pack);
  const asins = recs.map((r) => r.asin).filter((a): a is string => Boolean(a));

  const fm = [
    "source: readqueue-recommend",
    `recommendedAsins: [${asins.join(", ")}]`,
    `model: ${opts.model}`,
    `generatedAt: ${opts.generatedAt}`,
    "tags: [recommendation]",
  ];

  const body: string[] = [`# ¿Qué leo ahora? · ${opts.date}`, ""];
  if (recs.length === 0) {
    body.push("No pude generar recomendaciones esta vez (revisá la API key / el modelo).");
  }

  recs.forEach((rec, i) => {
    const badge =
      rec.source === "owned" ? "📚 ya lo tenés" : rec.source === "wishlist" ? "🛒 wishlist" : "✨ nuevo";
    const heading =
      rec.asin && (rec.source === "owned" || rec.source === "wishlist")
        ? `[[${bookCardSlug(rec.title, rec.asin)}|${rec.title}]]`
        : rec.title;
    body.push(`## ${i + 1}. ${heading}  —  ${badge}`, "");
    if (rec.reason) body.push(rec.reason, "");
    if (rec.connects_to.length > 0) {
      body.push("Conecta con:");
      for (const c of rec.connects_to) body.push(`- ${linkForTitle(c, idx)}`);
      body.push("");
    }
  });

  const ownedFirst = recs.filter((r) => r.source === "owned");
  if (ownedFirst.length > 0) {
    body.push("---", "", "### Empezá por lo que ya tenés", "");
    for (const r of ownedFirst) {
      const link = r.asin ? `[[${bookCardSlug(r.title, r.asin)}|${r.title}]]` : r.title;
      body.push(`- ${link}`);
    }
    body.push("");
  }

  return `---\n${fm.join("\n")}\n---\n\n${body.join("\n")}`;
}

// --- Orchestration -----------------------------------------------------------

export interface RecommendSettings {
  anthropicApiKey: string;
  recommendModel: string;
}

export interface RecommendDeps extends AnthropicFetchDeps {
  retry?: RetryOpts;
  maxTokens?: number;
}

export interface RecommendResult {
  recommendations: Recommendation[];
  status: number;
  /** Raw model text, for debugging. */
  raw?: string;
}

// --- Wishlist ranking (Opción A) --------------------------------------------
// Reuses the ContextPack + anthropic helper. Ranks EVERY wishlist book by match
// with what the user reads/highlights, into 3 actionable tiers. Cheaper output
// than free-form recs: asks only for asin+score+tier+reason (title comes from
// the pack, so the model can't hallucinate a title and we save output tokens).

export type RankTier = "now" | "soon" | "someday";

export interface RankedBook {
  asin: string;
  title: string;
  score: number; // 0-100
  tier: RankTier;
  reason: string;
}

export const RANK_TIER_LABEL: Readonly<Record<RankTier, string>> = {
  now: "📗 Leé ya",
  soon: "📘 Para pronto",
  someday: "📙 Algún día",
};

export function buildWishlistRankPrompt(pack: ContextPack): string {
  const lines: string[] = [
    "Rank EVERY book on the user's Amazon wishlist by how well it matches what they actually read and highlight. Return them ALL, once each.",
    "",
    "Signal priority (strongest first):",
    "1. Highlights — what genuinely resonated (weigh this most).",
    "2. Recently read topics/titles.",
    "3. Anti-backlog: if a book's topic is one the user ALREADY has a big unread pile of (see the queue), lower its score and say so — don't encourage hoarding.",
    "",
  ];
  if (pack.topicDistribution.length > 0) {
    lines.push(
      `Recent topic mix: ${pack.topicDistribution.map((t) => `${t.topic}(${t.count})`).join(", ")}`,
      "",
    );
  }
  if (pack.read.length > 0) {
    lines.push("Recently read:");
    for (const a of pack.read.slice(0, 25)) lines.push(`- ${a.title}${a.topic ? ` [${a.topic}]` : ""}`);
    lines.push("");
  }
  if (pack.highlights.length > 0) {
    lines.push("Highlights (what resonated):");
    for (const h of pack.highlights.slice(0, 30)) lines.push(`- «${truncate(h.text, 180)}» (${h.title})`);
    lines.push("");
  }
  if (pack.queue.length > 0) {
    lines.push(
      `Already queued unread (anti-backlog): ${pack.queue
        .slice(0, 40)
        .map((q) => (q.topic ? `${q.title} [${q.topic}]` : q.title))
        .join("; ")}`,
      "",
    );
  }
  lines.push("Wishlist to rank (asin — title — author):");
  for (const b of pack.wishlist) {
    lines.push(
      `- ${b.asin} — ${b.title}${b.author ? ` by ${b.author}` : ""}${b.wishlistRemoved ? " (removed — weak)" : ""}`,
    );
  }
  lines.push(
    "",
    'Reply ONLY JSON: {"ranked":[{"asin":"<from the wishlist above>","score":<0-100>,"tier":"now"|"soon"|"someday","reason":"one short sentence connecting to a concrete read/highlight"}]}',
    "Include EVERY wishlist asin exactly once. tier: now = read next, soon = queue it, someday = low match.",
  );
  return lines.join("\n");
}

export function parseWishlistRanking(text: string, pack: ContextPack): RankedBook[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { ranked?: unknown } | undefined;
  try {
    parsed = JSON.parse(match[0]) as { ranked?: unknown };
  } catch {
    return [];
  }
  const rawList = Array.isArray(parsed?.ranked) ? (parsed.ranked as Array<Record<string, unknown>>) : [];
  const byAsin = new Map(pack.wishlist.map((b) => [b.asin, b]));
  const seen = new Set<string>();
  const out: RankedBook[] = [];
  for (const r of rawList) {
    const asin = asStr(r["asin"]);
    if (!asin) continue;
    const book = byAsin.get(asin);
    if (!book || seen.has(asin)) continue; // anti-hallucination: asin must be real
    seen.add(asin);
    const score =
      typeof r["score"] === "number" ? Math.max(0, Math.min(100, Math.round(r["score"] as number))) : 0;
    const t = r["tier"];
    const tier: RankTier =
      t === "now" || t === "soon" || t === "someday"
        ? t
        : score >= 70
          ? "now"
          : score >= 40
            ? "soon"
            : "someday";
    out.push({ asin, title: book.title, score, tier, reason: asStr(r["reason"]) ?? "" });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function renderWishlistRankNote(
  ranked: readonly RankedBook[],
  opts: { date: string; model: string; generatedAt: string },
): string {
  const fm = [
    "source: readqueue-wishlist-rank",
    `model: ${opts.model}`,
    `generatedAt: ${opts.generatedAt}`,
    `count: ${ranked.length}`,
    "tags: [ranking]",
  ];
  const body: string[] = [`# Ranking de wishlist · ${opts.date}`, ""];
  if (ranked.length === 0) {
    body.push("No pude rankear (revisá la API key / que la wishlist tenga libros).");
  }
  for (const tier of ["now", "soon", "someday"] as const) {
    const items = ranked.filter((r) => r.tier === tier);
    if (items.length === 0) continue;
    body.push(`## ${RANK_TIER_LABEL[tier]}`, "");
    for (const r of items) {
      body.push(
        `- **[[${bookCardSlug(r.title)}|${r.title}]]** · ${r.score}/100${r.reason ? ` — ${r.reason}` : ""}`,
      );
    }
    body.push("");
  }
  return `---\n${fm.join("\n")}\n---\n\n${body.join("\n")}`;
}

export interface WishlistRankResult {
  ranked: RankedBook[];
  status: number;
  raw?: string;
}

export async function rankWishlist(
  pack: ContextPack,
  settings: RecommendSettings,
  deps: RecommendDeps,
): Promise<WishlistRankResult> {
  const key = settings.anthropicApiKey?.trim();
  if (!key) return { ranked: [], status: 0 };
  const response = await postMessagesWithRetry(
    deps.fetchJson,
    key,
    {
      model: settings.recommendModel || "claude-sonnet-5",
      max_tokens: deps.maxTokens ?? 3000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: buildWishlistRankPrompt(pack) }],
    },
    deps.retry,
  );
  if (response.status !== 200) return { ranked: [], status: response.status };
  const text = extractTextFromMessage(response.json);
  if (!text) return { ranked: [], status: response.status };
  return { ranked: parseWishlistRanking(text, pack), status: response.status, raw: text };
}

export async function generateRecommendations(
  pack: ContextPack,
  settings: RecommendSettings,
  deps: RecommendDeps,
): Promise<RecommendResult> {
  const key = settings.anthropicApiKey?.trim();
  if (!key) return { recommendations: [], status: 0 };

  const response = await postMessagesWithRetry(
    deps.fetchJson,
    key,
    {
      model: settings.recommendModel || "claude-sonnet-5",
      max_tokens: deps.maxTokens ?? 4000,
      // Kept off so a non-streaming requestUrl call returns plain JSON text
      // (adaptive thinking would eat max_tokens and delay the JSON).
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: buildRecommendPrompt(pack) }],
    },
    deps.retry,
  );

  if (response.status !== 200) return { recommendations: [], status: response.status };
  const text = extractTextFromMessage(response.json);
  if (!text) return { recommendations: [], status: response.status };
  return {
    recommendations: parseRecommendations(text, pack),
    status: response.status,
    raw: text,
  };
}
