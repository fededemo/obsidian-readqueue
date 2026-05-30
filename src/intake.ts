import {
  htmlToMarkdown as obsidianHtmlToMarkdown,
  normalizePath,
  requestUrl,
  stringifyYaml,
  type App,
  type TFile,
} from "obsidian";
import Defuddle from "defuddle";

import type { ReadFrontmatter } from "./queue-data";

export interface ParsedArticle {
  title: string;
  url: string;
  author: string | undefined;
  published: string | undefined;
  domain: string;
  contentHtml: string;
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

export function parseHtmlToArticle(
  html: string,
  url: string,
  parseDom: (html: string) => Document = defaultParseDom,
): ParsedArticle {
  const doc = parseDom(html);
  const result = new Defuddle(doc, { url }).parse();
  return {
    title: result.title && result.title.trim() ? result.title : hostnameFromUrl(url),
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
  const frontmatter: ReadFrontmatter = {
    source: "intake-defuddle",
    title: article.title,
    url: article.url,
    status: "unread",
    savedAt: now.toISOString(),
    tags: ["reader"],
  };
  if (article.author) frontmatter.author = article.author;
  if (article.published) frontmatter.published = article.published;
  const markdown = htmlToMarkdown(article.contentHtml);
  const body = `# ${article.title}\n\n[Original](${article.url})\n\n${markdown}`;
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

export function slugifyForFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 80);
  return slug || "untitled";
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
    const res = await fetchUrl(url);
    if (res.status >= 400) {
      return await markIntakeError(app, file, `http-${res.status}`, now);
    }
    const parsed = parseHtmlToArticle(res.text, url, parseDom);
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
