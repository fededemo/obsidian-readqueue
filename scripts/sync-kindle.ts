import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PUBLISHER_TOPIC_MAP,
  DEFAULT_TOPIC_LIST,
  classifyTopic,
  type ClassifySettings,
} from "../src/topics";
import { slugifyForFilename } from "../src/slugify";

const LIBRARY_URL = "https://read.amazon.com/notebook";
const BOOK_URL = (asin: string): string =>
  `https://read.amazon.com/notebook?asin=${asin}&contentLimitState=&`;

export interface KindleBook {
  asin: string;
  title: string;
  author: string | undefined;
  coverUrl: string | undefined;
}

export interface KindleHighlight {
  text: string;
  location: string | undefined;
  note: string | undefined;
}

export interface KindleBookHighlights {
  book: KindleBook;
  highlights: KindleHighlight[];
}

const LIBRARY_ITEM_RE =
  /<div[^>]*class="[^"]*kp-notebook-library-each-book[^"]*"[^>]*data-asin="([^"]+)"[\s\S]*?<\/div>\s*<\/div>/g;
const TITLE_RE =
  /class="[^"]*kp-notebook-searchable[^"]*"[^>]*>\s*([\s\S]*?)\s*</;
const AUTHOR_RE = />\s*(?:Por|By)\s+([^<]+)</i;
const COVER_RE = /<img[^>]*src="([^"]+)"/;

export function parseLibrary(html: string, parseDom: (h: string) => Document): KindleBook[] {
  const doc = parseDom(html);
  const cards = Array.from(
    doc.querySelectorAll('[class*="kp-notebook-library-each-book"]'),
  );
  const out: KindleBook[] = [];
  for (const card of cards) {
    const asin = card.getAttribute("data-asin") ?? card.getAttribute("id") ?? "";
    if (!asin) continue;
    const titleEl = card.querySelector(
      ".kp-notebook-searchable, h2.a-text-ellipsis, .a-text-bold",
    );
    const authorEl = card.querySelector(
      ".kp-notebook-searchable + p, .a-color-secondary, .a-spacing-mini.a-text-ellipsis",
    );
    const coverEl = card.querySelector("img");
    const title = (titleEl?.textContent ?? "").trim();
    if (!title) continue;
    const authorRaw = (authorEl?.textContent ?? "").trim();
    const author = authorRaw
      ? authorRaw.replace(/^(?:Por|By)\s+/i, "").trim() || undefined
      : undefined;
    const coverUrl = coverEl?.getAttribute("src") ?? undefined;
    out.push({ asin, title, author, coverUrl });
  }
  if (out.length > 0) return out;

  // Fallback: regex (HTML structure changed)
  LIBRARY_ITEM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LIBRARY_ITEM_RE.exec(html)) !== null) {
    const block = match[0];
    const asin = match[1] ?? "";
    if (!asin || !block) continue;
    const titleMatch = TITLE_RE.exec(block);
    const title = (titleMatch?.[1] ?? "").trim();
    if (!title) continue;
    const authorMatch = AUTHOR_RE.exec(block);
    const author = authorMatch ? (authorMatch[1] ?? "").trim() : undefined;
    const coverMatch = COVER_RE.exec(block);
    const coverUrl = coverMatch?.[1];
    out.push({ asin, title, author, coverUrl });
  }
  return out;
}

const HIGHLIGHT_BLOCK_SEL =
  '[id^="highlight"], .kp-notebook-highlight, .a-row.a-spacing-base[id]';

export function parseBookHighlights(
  html: string,
  book: KindleBook,
  parseDom: (h: string) => Document,
): KindleBookHighlights {
  const doc = parseDom(html);
  const blocks = Array.from(doc.querySelectorAll(HIGHLIGHT_BLOCK_SEL));
  const highlights: KindleHighlight[] = [];
  for (const block of blocks) {
    const textEl = block.querySelector(
      "#highlight, .kp-notebook-highlight, .a-spacing-base.a-row > div > span",
    );
    const text = (textEl?.textContent ?? "").trim();
    if (!text) continue;
    const locationEl = block.querySelector(
      "#kp-annotation-location, .kp-notebook-highlight-location, [class*='Location']",
    );
    const location = (locationEl?.textContent ?? "").trim() || undefined;
    const noteEl = block.querySelector(
      "#note, .kp-notebook-note, .kp-notebook-note-text",
    );
    const noteText = (noteEl?.textContent ?? "").trim();
    const note = noteText && noteText !== "[Add a note]" ? noteText : undefined;
    highlights.push({ text, location, note });
  }
  return { book, highlights };
}

const YAML_ESCAPE_RE = /["\\\n]/;

function yamlScalar(value: string): string {
  if (!YAML_ESCAPE_RE.test(value) && !/^[\s-]|[:\s]$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function yamlList(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlScalar).join(", ")}]`;
}

export interface BookMarkdown {
  content: string;
  slug: string;
}

export function buildBookMarkdown(
  data: KindleBookHighlights,
  topic: string,
  now: Date = new Date(),
): BookMarkdown {
  const { book, highlights } = data;
  const ts = now.toISOString();
  const tags = ["reader", "kindle", "legacy"];
  const fmLines = [
    `source: kindle-scrape`,
    `title: ${yamlScalar(book.title)}`,
    `asin: ${yamlScalar(book.asin)}`,
  ];
  if (book.author) fmLines.push(`author: ${yamlScalar(book.author)}`);
  if (book.coverUrl) fmLines.push(`cover: ${yamlScalar(book.coverUrl)}`);
  fmLines.push(`url: ${yamlScalar(`https://read.amazon.com/notebook?asin=${book.asin}`)}`);
  fmLines.push(`savedAt: ${ts}`);
  fmLines.push(`status: read`);
  fmLines.push(`readAt: ${ts}`);
  fmLines.push(`tags: ${yamlList(tags)}`);
  fmLines.push(`topic: ${yamlScalar(topic)}`);
  fmLines.push(`highlightCount: ${highlights.length}`);

  const bodyLines: string[] = [
    `# ${book.title}`,
    "",
    book.author ? `> by ${book.author}` : ">",
    "",
    `[Original ↗](https://read.amazon.com/notebook?asin=${book.asin})`,
    "",
    "## Highlights",
    "",
  ];
  for (const h of highlights) {
    bodyLines.push(`> ${h.text.replace(/\n/g, "\n> ")}`);
    if (h.location) bodyLines.push(`*${h.location}*`);
    if (h.note) {
      bodyLines.push("");
      bodyLines.push(`📝 ${h.note}`);
    }
    bodyLines.push("");
  }

  const content = `---\n${fmLines.join("\n")}\n---\n\n${bodyLines.join("\n")}`;
  const slug = slugifyForFilename(`${book.title}-${book.asin}`);
  return { content, slug };
}

export interface CliArgs {
  cookie: string;
  dest: string;
  apiKey: string | undefined;
  dryRun: boolean;
  force: boolean;
  cookieFile: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    cookie: "",
    dest: "",
    apiKey: undefined,
    dryRun: false,
    force: false,
    cookieFile: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--cookie":
        args.cookie = argv[++i] ?? "";
        break;
      case "--cookie-file":
        args.cookieFile = argv[++i];
        break;
      case "--dest":
        args.dest = argv[++i] ?? "";
        break;
      case "--anthropic-key":
        args.apiKey = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      default:
        if (a && a.startsWith("--")) {
          throw new Error(`Unknown flag: ${a}`);
        }
    }
  }
  if (!args.dest) throw new Error("--dest is required");
  if (!args.cookie && !args.cookieFile) {
    throw new Error("--cookie or --cookie-file is required (export from your browser DevTools after logging in to read.amazon.com)");
  }
  return args;
}

export interface RunDeps {
  fetchUrl?: (
    url: string,
    cookie: string,
  ) => Promise<{ status: number; text: string }>;
  parseDom?: (html: string) => Document;
  writeFile?: (path: string, content: string) => Promise<void>;
  readFile?: (path: string) => Promise<string>;
  exists?: (path: string) => Promise<boolean>;
  mkdirp?: (dir: string) => Promise<void>;
  classify?: (book: KindleBook, highlights: KindleHighlight[]) => Promise<string>;
  log?: (msg: string) => void;
  now?: () => Date;
}

const defaultFetchUrl: NonNullable<RunDeps["fetchUrl"]> = async (url, cookie) => {
  const res = await fetch(url, {
    headers: {
      cookie,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, text };
};

const defaultParseDom = (html: string): Document => {
  // happy-dom in scripts/ is not bundled — fallback to jsdom-free regex parse
  // tests inject this dep with happy-dom
  throw new Error("parseDom dep not provided");
};

const defaultWriteFile: NonNullable<RunDeps["writeFile"]> = (p, c) =>
  fs.writeFile(p, c, "utf-8");
const defaultExists: NonNullable<RunDeps["exists"]> = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
const defaultMkdirp: NonNullable<RunDeps["mkdirp"]> = (d) =>
  fs.mkdir(d, { recursive: true }).then(() => undefined);

export interface RunSummary {
  books: number;
  written: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function run(args: CliArgs, deps: RunDeps = {}): Promise<RunSummary> {
  const fetchUrl = deps.fetchUrl ?? defaultFetchUrl;
  const parseDom = deps.parseDom ?? defaultParseDom;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const exists = deps.exists ?? defaultExists;
  const mkdirp = deps.mkdirp ?? defaultMkdirp;
  const log = deps.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const now = deps.now ?? (() => new Date());

  let cookie = args.cookie;
  if (!cookie && args.cookieFile && deps.readFile) {
    cookie = (await deps.readFile(args.cookieFile)).trim();
  } else if (!cookie && args.cookieFile) {
    cookie = (await fs.readFile(args.cookieFile, "utf-8")).trim();
  }

  const settings: ClassifySettings = {
    topics: DEFAULT_TOPIC_LIST,
    publisherTopicMap: DEFAULT_PUBLISHER_TOPIC_MAP,
    anthropicApiKey: args.apiKey,
    classifyModel: "claude-haiku-4-5",
    useClaudeForClassification: Boolean(args.apiKey),
  };

  const summary: RunSummary = {
    books: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  await mkdirp(args.dest);

  log("Fetching Kindle library…");
  const libRes = await fetchUrl(LIBRARY_URL, cookie);
  if (libRes.status !== 200) {
    throw new Error(
      `Library fetch failed: HTTP ${libRes.status}. Cookie expired? Re-export from browser DevTools.`,
    );
  }
  const books = parseLibrary(libRes.text, parseDom);
  summary.books = books.length;
  log(`Found ${books.length} books.`);

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (!book) continue;
    try {
      const bookRes = await fetchUrl(BOOK_URL(book.asin), cookie);
      if (bookRes.status !== 200) {
        summary.failed++;
        summary.errors.push(`${book.asin}: HTTP ${bookRes.status}`);
        log(`[${i + 1}/${books.length}] FAIL ${book.title}: HTTP ${bookRes.status}`);
        continue;
      }
      const data = parseBookHighlights(bookRes.text, book, parseDom);

      let topic = "otros";
      if (deps.classify) {
        topic = await deps.classify(book, data.highlights);
      } else if (args.apiKey) {
        const excerpt = data.highlights.slice(0, 3).map((h) => h.text).join("\n");
        const result = await classifyTopic(
          {
            title: book.title,
            excerpt,
            domain: "read.amazon.com",
            source: "kindle-scrape",
          },
          settings,
        );
        topic = result.topic;
      }

      const md = buildBookMarkdown(data, topic, now());
      const destPath = path.join(args.dest, `${md.slug}.md`);
      if (!args.force && (await exists(destPath))) {
        summary.skipped++;
        log(`[${i + 1}/${books.length}] skip ${book.title} (exists)`);
        continue;
      }
      if (!args.dryRun) {
        await writeFile(destPath, md.content);
      }
      summary.written++;
      log(
        `[${i + 1}/${books.length}] ${args.dryRun ? "dry" : "ok"} ${book.title} (${data.highlights.length} highlights, topic: ${topic})`,
      );
    } catch (err) {
      summary.failed++;
      const reason = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${book.asin}: ${reason}`);
      log(`[${i + 1}/${books.length}] FAIL ${book.title}: ${reason}`);
    }
  }

  log(
    `Done. books=${summary.books} written=${summary.written} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return summary;
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  // jsdom equivalent: load happy-dom lazily for runtime use
  void (async () => {
    try {
      const args = parseArgs(process.argv.slice(2));
      const happyDom = await import("happy-dom");
      const Window = happyDom.Window;
      const parseDom = (html: string): Document => {
        const win = new Window();
        const doc = win.document;
        doc.documentElement.innerHTML = html;
        return doc as unknown as Document;
      };
      const summary = await run(args, { parseDom });
      if (summary.failed > 0) process.exit(1);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  })();
}
