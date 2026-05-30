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
