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
