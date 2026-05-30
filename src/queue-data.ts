import type { TFile } from "obsidian";

export interface ReadFrontmatter {
  source?: string;
  title?: string;
  url?: string;
  topic?: string;
  author?: string;
  published?: string;
  savedAt?: string;
  status?: string;
  tags?: string[] | string;
  snoozedUntil?: string;
  readAt?: string;
}

export interface QueueArticle {
  file: TFile;
  title: string;
  url: string | undefined;
  source: string | undefined;
  topic: string | undefined;
  author: string | undefined;
  published: string | undefined;
  savedAt: Date | undefined;
  status: string;
  tags: string[];
  snoozedUntil: Date | undefined;
  readAt: Date | undefined;
}

const isString = (x: unknown): x is string => typeof x === "string";

function parseDate(value: unknown): Date | undefined {
  if (!isString(value) || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(isString);
  if (isString(raw) && raw) return [raw];
  return [];
}

export function articleFromFile(
  file: TFile,
  frontmatter: ReadFrontmatter | undefined,
): QueueArticle {
  const fm = frontmatter ?? {};
  return {
    file,
    title: isString(fm.title) && fm.title ? fm.title : file.basename,
    url: isString(fm.url) ? fm.url : undefined,
    source: isString(fm.source) ? fm.source : undefined,
    topic: isString(fm.topic) ? fm.topic : undefined,
    author: isString(fm.author) ? fm.author : undefined,
    published: isString(fm.published) ? fm.published : undefined,
    savedAt: parseDate(fm.savedAt),
    status: isString(fm.status) ? fm.status : "unread",
    tags: normalizeTags(fm.tags),
    snoozedUntil: parseDate(fm.snoozedUntil),
    readAt: parseDate(fm.readAt),
  };
}

export function filterBySnoozedUntil(
  articles: readonly QueueArticle[],
  now: Date = new Date(),
): QueueArticle[] {
  return articles.filter(
    (a) => !a.snoozedUntil || a.snoozedUntil.getTime() <= now.getTime(),
  );
}

export function estimateReadingMinutes(
  bodyText: string,
  wordsPerMinute = 220,
): number {
  if (!bodyText) return 0;
  const words = bodyText.trim().split(/\s+/).filter((w) => w.length > 0).length;
  if (words === 0) return 0;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function estimateReadingMinutesFromSize(
  sizeBytes: number,
  charsPerWord = 5.5,
  wordsPerMinute = 220,
): number {
  if (sizeBytes <= 0) return 0;
  const words = sizeBytes / charsPerWord;
  if (words < 1) return 1;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface QueueStats {
  unread: number;
  snoozed: number;
  readThisWeek: number;
  topTopicThisMonth: string | undefined;
}

export function computeStats(
  articles: readonly QueueArticle[],
  now: Date = new Date(),
): QueueStats {
  const nowMs = now.getTime();
  let unread = 0;
  let snoozed = 0;
  let readThisWeek = 0;
  const topicCountsMonth = new Map<string, number>();
  for (const a of articles) {
    if (a.status === "unread") {
      if (a.snoozedUntil && a.snoozedUntil.getTime() > nowMs) {
        snoozed++;
      } else {
        unread++;
      }
    }
    if (a.status === "read" && a.readAt) {
      if (nowMs - a.readAt.getTime() <= WEEK_MS) readThisWeek++;
      if (a.topic && nowMs - a.readAt.getTime() <= MONTH_MS) {
        topicCountsMonth.set(a.topic, (topicCountsMonth.get(a.topic) ?? 0) + 1);
      }
    }
  }
  let topTopic: string | undefined;
  let topCount = 0;
  for (const [topic, count] of topicCountsMonth) {
    if (count > topCount) {
      topCount = count;
      topTopic = topic;
    }
  }
  return { unread, snoozed, readThisWeek, topTopicThisMonth: topTopic };
}

export interface PickForTodayOptions {
  count?: number;
  rng?: () => number;
  estimateMinutes?: (article: QueueArticle) => number;
}

export function pickForToday(
  articles: readonly QueueArticle[],
  options: PickForTodayOptions = {},
): QueueArticle[] {
  const { count = 5, rng = Math.random, estimateMinutes } = options;
  if (articles.length === 0) return [];
  if (articles.length <= count) return [...articles];

  const arr = [...articles];
  const picks: QueueArticle[] = [];

  if (estimateMinutes) {
    const sorted = [...arr].sort(
      (a, b) => estimateMinutes(a) - estimateMinutes(b),
    );
    const shortest = sorted[0];
    const longest = sorted[sorted.length - 1];
    if (shortest) picks.push(shortest);
    if (longest && longest !== shortest) picks.push(longest);
  }

  const remaining = arr.filter((a) => !picks.includes(a));
  while (picks.length < count && remaining.length > 0) {
    const idx = Math.floor(rng() * remaining.length);
    const pick = remaining.splice(idx, 1)[0];
    if (pick) picks.push(pick);
  }
  return picks;
}

const KNOWN_TOPIC_SLUGS: ReadonlyArray<string> = [
  "tech",
  "producto",
  "macro",
  "ciencia",
  "personal",
  "cultura",
  "tweet",
  "otros",
];

export function topicSlug(topic: string | undefined): string {
  if (!topic) return "unknown";
  const lower = topic.toLowerCase().trim();
  if (!lower) return "unknown";
  if (KNOWN_TOPIC_SLUGS.includes(lower)) return lower;
  return "custom";
}

export function filterByQuery(
  articles: readonly QueueArticle[],
  rawQuery: string,
): QueueArticle[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [...articles];
  return articles.filter((a) => {
    const haystack = [
      a.title,
      a.topic ?? "",
      a.url ?? "",
      a.source ?? "",
      a.author ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function filterByTopic(
  articles: readonly QueueArticle[],
  topic: string | undefined,
): QueueArticle[] {
  if (!topic) return [...articles];
  const t = topic.toLowerCase();
  return articles.filter((a) => (a.topic ?? "").toLowerCase() === t);
}

export function cleanTitle(rawTitle: string): string {
  const trimmed = (rawTitle ?? "").trim();
  if (!trimmed) return trimmed;
  const match = /^(.+?)\s*[|\-—·]\s*([^|\-—·]+)$/.exec(trimmed);
  if (!match) return trimmed;
  const head = (match[1] ?? "").trim();
  const tail = (match[2] ?? "").trim();
  if (head.length < 8) return trimmed;
  if (tail.length === 0 || tail.length > 30) return trimmed;
  if (/[.?!]$/.test(tail)) return trimmed;
  return head;
}

export type StatusFilter = "unread" | "read" | "all";

export function filterByStatus(
  articles: readonly QueueArticle[],
  status: StatusFilter = "unread",
): QueueArticle[] {
  if (status === "all") return [...articles];
  return articles.filter((a) => a.status === status);
}

export type GroupKey = "topic" | "source" | "date" | "none";

export interface ArticleGroup {
  label: string;
  articles: QueueArticle[];
}

export function groupArticles(
  articles: readonly QueueArticle[],
  groupBy: GroupKey,
  now: Date = new Date(),
): ArticleGroup[] {
  if (groupBy === "none") {
    return [{ label: "Todos", articles: [...articles] }];
  }

  const keyOf = (a: QueueArticle): string => {
    if (groupBy === "topic") return a.topic && a.topic.trim() ? a.topic : "Sin tópico";
    if (groupBy === "source") return sourceLabel(a);
    return dateBucket(a.savedAt, now);
  };

  const map = new Map<string, QueueArticle[]>();
  for (const a of articles) {
    const k = keyOf(a);
    const list = map.get(k);
    if (list) list.push(a);
    else map.set(k, [a]);
  }
  return [...map.entries()].map(([label, list]) => ({ label, articles: list }));
}

export function sourceLabel(a: QueueArticle): string {
  if (a.url) {
    try {
      const u = new URL(a.url);
      return u.hostname.replace(/^www\./, "");
    } catch {
      // fall through
    }
  }
  return a.source && a.source.trim() ? a.source : "Sin fuente";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dateBucket(date: Date | undefined, now: Date = new Date()): string {
  if (!date) return "Sin fecha";
  const diff = (now.getTime() - date.getTime()) / DAY_MS;
  if (diff < 1) return "Hoy";
  if (diff < 7) return "Esta semana";
  if (diff < 30) return "Este mes";
  return "Antes";
}

export type SortKey = "newest" | "oldest" | "shuffle";

export function sortArticles(
  articles: readonly QueueArticle[],
  sortBy: SortKey,
  rng: () => number = Math.random,
): QueueArticle[] {
  const out = [...articles];
  if (sortBy === "newest") {
    out.sort(
      (a, b) => (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0),
    );
  } else if (sortBy === "oldest") {
    out.sort(
      (a, b) =>
        (a.savedAt?.getTime() ?? Number.POSITIVE_INFINITY) -
        (b.savedAt?.getTime() ?? Number.POSITIVE_INFINITY),
    );
  } else {
    fisherYatesInPlace(out, rng);
  }
  return out;
}

function fisherYatesInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}

export function randomArticle(
  articles: readonly QueueArticle[],
  rng: () => number = Math.random,
): QueueArticle | undefined {
  if (articles.length === 0) return undefined;
  const idx = Math.floor(rng() * articles.length);
  return articles[idx];
}
