import {
  htmlToMarkdown as obsidianHtmlToMarkdown,
  normalizePath,
  requestUrl,
  stringifyYaml,
  type App,
  type TFile,
} from "obsidian";
import Defuddle from "defuddle";

import { cleanTitle, type ReadFrontmatter } from "./queue-data";
import { slugifyForFilename } from "./slugify";

export { slugifyForFilename };

export interface ParsedArticle {
  title: string;
  url: string;
  author: string | undefined;
  published: string | undefined;
  domain: string;
  contentHtml: string;
  source?: string;
  bodyMarkdown?: string;
  tags?: string[];
  topic?: string;
}

export interface ArticleNote {
  frontmatter: ReadFrontmatter;
  body: string;
}

export interface IntakeOutcome {
  ok: boolean;
  destination?: string;
  error?: string;
}

export interface IntakeDeps {
  app: App;
  pendingFolder: string;
  webFolder: string;
  htmlToMarkdown?: (html: string) => string;
  yamlStringify?: (value: unknown) => string;
  parseDom?: (html: string) => Document;
  fetchUrl?: (url: string) => Promise<{ status: number; text: string }>;
  now?: () => Date;
  classify?: (
    article: ParsedArticle,
  ) => Promise<{ topic: string; tags: string[] } | undefined>;
}

const defaultParseDom = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
};

const defaultFetchUrl = async (
  url: string,
): Promise<{ status: number; text: string }> => {
  const res = await requestUrl({ url, throw: false });
  return { status: res.status, text: res.text };
};

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function mergeTags(existing: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const t of extra) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

const TWITTER_HOST_RE =
  /^(?:www\.)?(twitter\.com|x\.com|fxtwitter\.com|fixupx\.com|vxtwitter\.com)$/;
const TWEET_PATH_RE = /^\/([^/]+)\/status\/(\d+)/;

export interface FxTwitterAuthor {
  name: string;
  screen_name: string;
  avatar_url?: string;
}

export interface FxTwitterMediaPhoto {
  url: string;
}

export interface FxTwitterMediaVideo {
  url: string;
  thumbnail_url?: string;
}

export interface FxTwitterTweet {
  id: string;
  url: string;
  text: string;
  created_at?: string;
  created_timestamp?: number;
  author: FxTwitterAuthor;
  media?: {
    photos?: FxTwitterMediaPhoto[];
    videos?: FxTwitterMediaVideo[];
  };
}

export interface FxTwitterResponse {
  code: number;
  message: string;
  tweet?: FxTwitterTweet;
}

export function isTwitterUrl(url: string): boolean {
  try {
    return TWITTER_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function extractTweetIdentifiers(
  url: string,
): { user: string; id: string } | undefined {
  try {
    const m = TWEET_PATH_RE.exec(new URL(url).pathname);
    if (!m || !m[1] || !m[2]) return undefined;
    return { user: m[1], id: m[2] };
  } catch {
    return undefined;
  }
}

export async function fetchTweet(
  url: string,
  fetchUrl: (url: string) => Promise<{ status: number; text: string }>,
): Promise<FxTwitterResponse | undefined> {
  const ids = extractTweetIdentifiers(url);
  if (!ids) return undefined;
  const apiUrl = `https://api.fxtwitter.com/${ids.user}/status/${ids.id}`;
  let res: { status: number; text: string };
  try {
    res = await fetchUrl(apiUrl);
  } catch {
    return undefined;
  }
  if (res.status !== 200) return undefined;
  try {
    return JSON.parse(res.text) as FxTwitterResponse;
  } catch {
    return undefined;
  }
}

export function tweetToArticle(
  response: FxTwitterResponse,
  originalUrl: string,
): ParsedArticle | undefined {
  if (response.code !== 200 || !response.tweet) return undefined;
  const t = response.tweet;
  const screen = t.author.screen_name;
  const name = t.author.name;
  const text = (t.text ?? "").trim();
  const firstLine = text.split("\n")[0] ?? text;
  const snippet = firstLine.slice(0, 80);
  const title = `@${screen}: ${snippet}${firstLine.length > 80 ? "…" : ""}`;
  const published = t.created_at ? parseTwitterDate(t.created_at) : undefined;

  const quoted = text
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

  const mediaBlocks: string[] = [];
  for (const photo of t.media?.photos ?? []) {
    mediaBlocks.push(`![](${photo.url})`);
  }
  for (const video of t.media?.videos ?? []) {
    const thumb = video.thumbnail_url ?? video.url;
    mediaBlocks.push(`[Video ↗](${video.url})\n\n![](${thumb})`);
  }

  const bodyMarkdown = [quoted, ...mediaBlocks].filter(Boolean).join("\n\n");

  return {
    title,
    url: originalUrl,
    author: `${name} (@${screen})`,
    published,
    domain: hostnameFromUrl(originalUrl),
    contentHtml: "",
    source: "intake-fxtwitter",
    bodyMarkdown,
    tags: ["reader", "tweet"],
  };
}

function parseTwitterDate(raw: string): string | undefined {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseHtmlToArticle(
  html: string,
  url: string,
  parseDom: (html: string) => Document = defaultParseDom,
): ParsedArticle {
  const doc = parseDom(html);
  const result = new Defuddle(doc, { url }).parse();
  return {
    title: result.title && result.title.trim() ? cleanTitle(result.title) : hostnameFromUrl(url),
    url,
    author: result.author && result.author.trim() ? result.author : undefined,
    published: result.published && result.published.trim() ? result.published : undefined,
    domain: hostnameFromUrl(url),
    contentHtml: result.content ?? "",
  };
}

export function articleToMarkdown(
  article: ParsedArticle,
  now: Date = new Date(),
  htmlToMarkdown: (html: string) => string = obsidianHtmlToMarkdown,
): ArticleNote {
  const sourceTag = article.source ?? "intake-defuddle";
  const tags = article.tags ?? ["reader"];
  const frontmatter: ReadFrontmatter = {
    source: sourceTag,
    title: article.title,
    url: article.url,
    status: "unread",
    savedAt: now.toISOString(),
    tags,
  };
  if (article.author) frontmatter.author = article.author;
  if (article.published) frontmatter.published = article.published;
  if (article.topic) frontmatter.topic = article.topic;
  const markdown = article.bodyMarkdown ?? htmlToMarkdown(article.contentHtml);
  const body = `# ${article.title}\n\n[Original ↗](${article.url})\n\n${markdown}`;
  return { frontmatter, body };
}

export function bundleNote(
  note: ArticleNote,
  yamlStringify: (value: unknown) => string = stringifyYaml,
): string {
  const fmYaml = yamlStringify(note.frontmatter);
  const trimmed = fmYaml.endsWith("\n") ? fmYaml : `${fmYaml}\n`;
  return `---\n${trimmed}---\n\n${note.body}\n`;
}


const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const URL_LINE_RE = /^url:\s*(.+)$/m;
const URL_TOKEN_RE = /https?:\/\/[^\s)>\]"']+/;

export function extractUrlFromPending(content: string): string | undefined {
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (fmMatch) {
    const urlMatch = URL_LINE_RE.exec(fmMatch[1] ?? "");
    if (urlMatch) {
      const raw = (urlMatch[1] ?? "").trim().replace(/^["'`]|["'`]$/g, "");
      if (raw) return raw;
    }
  }
  const tokenMatch = URL_TOKEN_RE.exec(content);
  return tokenMatch ? tokenMatch[0] : undefined;
}

export async function processPending(
  file: TFile,
  deps: IntakeDeps,
): Promise<IntakeOutcome> {
  const {
    app,
    webFolder,
    htmlToMarkdown = obsidianHtmlToMarkdown,
    yamlStringify = stringifyYaml,
    parseDom = defaultParseDom,
    fetchUrl = defaultFetchUrl,
    now = () => new Date(),
  } = deps;

  const content = await app.vault.read(file);
  const url = extractUrlFromPending(content);
  if (!url) {
    return await markIntakeError(app, file, "no-url-found", now);
  }

  try {
    let parsed: ParsedArticle | undefined;

    if (isTwitterUrl(url)) {
      const tweetData = await fetchTweet(url, fetchUrl);
      if (tweetData) parsed = tweetToArticle(tweetData, url);
    }

    if (!parsed) {
      const res = await fetchUrl(url);
      if (res.status >= 400) {
        return await markIntakeError(app, file, `http-${res.status}`, now);
      }
      parsed = parseHtmlToArticle(res.text, url, parseDom);
    }

    if (!parsed.topic && deps.classify) {
      try {
        const result = await deps.classify(parsed);
        if (result?.topic) parsed.topic = result.topic;
        if (result?.tags && result.tags.length > 0) {
          const existing = parsed.tags ?? ["reader"];
          parsed.tags = mergeTags(existing, result.tags);
        }
      } catch {
        // classifier failure should never abort intake
      }
    }

    const note = articleToMarkdown(parsed, now(), htmlToMarkdown);
    const noteFile = bundleNote(note, yamlStringify);
    const slug = slugifyForFilename(parsed.title);
    const destination = normalizePath(
      `${webFolder.replace(/\/$/, "")}/${slug}.md`,
    );
    await app.vault.create(destination, noteFile);
    await app.vault.delete(file);
    return { ok: true, destination };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return await markIntakeError(app, file, reason, now);
  }
}

async function markIntakeError(
  app: App,
  file: TFile,
  reason: string,
  now: () => Date,
): Promise<IntakeOutcome> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    const obj = fm as Record<string, unknown>;
    obj["intake-error"] = reason;
    obj["intake-attempted-at"] = now().toISOString();
  });
  return { ok: false, error: reason };
}

export async function scanPendingFolder(
  deps: IntakeDeps,
  listFiles: (folder: string) => Promise<TFile[]>,
): Promise<IntakeOutcome[]> {
  const files = await listFiles(deps.pendingFolder);
  const outcomes: IntakeOutcome[] = [];
  for (const file of files) {
    outcomes.push(await processPending(file, deps));
  }
  return outcomes;
}
