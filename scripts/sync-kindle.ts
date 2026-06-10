import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PUBLISHER_TOPIC_MAP,
  DEFAULT_TOPIC_LIST,
  classifyTopic,
  type ClassifySettings,
} from "../src/topics";
import {
  LIBRARY_URL,
  bookUrl as BOOK_URL,
  buildBookMarkdown,
  parseBookHighlights,
  parseLibrary,
  type KindleBook,
  type KindleBookHighlights,
  type KindleHighlight,
} from "../src/kindle";
import { mergeHighlightsIntoMarkdown, planMerge } from "../src/kindle-merge";
import { slugifyForFilename } from "../src/slugify";

export {
  buildBookMarkdown,
  parseBookHighlights,
  parseLibrary,
  type KindleBook,
  type KindleHighlight,
};

export interface CliArgs {
  cookie: string;
  dest: string;
  apiKey: string | undefined;
  dryRun: boolean;
  force: boolean;
  merge: boolean;
  cookieFile: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    cookie: "",
    dest: "",
    apiKey: undefined,
    dryRun: false,
    force: false,
    merge: false,
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
      case "--merge":
        args.merge = true;
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
const defaultReadFile: NonNullable<RunDeps["readFile"]> = (p) =>
  fs.readFile(p, "utf-8");
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
  /** --merge: books whose existing .md got new highlights appended. */
  merged: number;
  /** --merge: pre-MX12 books whose delivered-keys state got initialized (file untouched). */
  initialized: number;
  /** --merge: total highlights appended across merged books. */
  newHighlights: number;
  errors: string[];
}

export const SYNC_STATE_FILENAME = ".kindle-sync-state.json";

interface SyncStateFile {
  version: 1;
  books: Record<string, { deliveredKeys: string[] }>;
}

function parseSyncState(raw: string): SyncStateFile {
  const parsed = JSON.parse(raw) as Partial<SyncStateFile>;
  return {
    version: 1,
    books: parsed.books && typeof parsed.books === "object" ? parsed.books : {},
  };
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
    merged: 0,
    initialized: 0,
    newHighlights: 0,
    errors: [],
  };

  await mkdirp(args.dest);

  const readFile = deps.readFile ?? defaultReadFile;
  const statePath = path.join(args.dest, SYNC_STATE_FILENAME);
  let syncState: SyncStateFile = { version: 1, books: {} };
  if (args.merge && (await exists(statePath))) {
    try {
      syncState = parseSyncState(await readFile(statePath));
    } catch {
      log(`Warning: could not parse ${SYNC_STATE_FILENAME} — starting with empty state.`);
    }
  }

  const classifyFor = async (
    book: KindleBook,
    data: KindleBookHighlights,
  ): Promise<string> => {
    if (deps.classify) return deps.classify(book, data.highlights);
    if (!args.apiKey) return "otros";
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
    return result.topic;
  };

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
      const slug = slugifyForFilename(`${book.title}-${book.asin}`);
      const destPath = path.join(args.dest, `${slug}.md`);
      const tag = `[${i + 1}/${books.length}]`;

      if (args.merge) {
        const plan = planMerge({
          scraped: data.highlights,
          deliveredKeys: syncState.books[book.asin]?.deliveredKeys,
          // --force rebuilds the file from scratch, same as if it were missing
          fileExists: !args.force && (await exists(destPath)),
        });
        switch (plan.action) {
          case "init-state":
            syncState.books[book.asin] = { deliveredKeys: plan.deliveredKeys };
            summary.initialized++;
            log(
              `${tag} init ${book.title} (${plan.deliveredKeys.length} highlights marked as delivered, file untouched)`,
            );
            break;
          case "none":
            summary.skipped++;
            log(`${tag} skip ${book.title} (no new highlights)`);
            break;
          case "recreate": {
            const topic = await classifyFor(book, data);
            const md = buildBookMarkdown(data, topic, now());
            if (!args.dryRun) await writeFile(destPath, md.content);
            syncState.books[book.asin] = { deliveredKeys: plan.deliveredKeys };
            summary.written++;
            log(
              `${tag} ${args.dryRun ? "dry" : "ok"} ${book.title} (recreated, ${data.highlights.length} highlights, topic: ${topic})`,
            );
            break;
          }
          case "append": {
            const existing = await readFile(destPath);
            const mergedContent = mergeHighlightsIntoMarkdown(
              existing,
              plan.newHighlights,
              plan.deliveredKeys.length,
            );
            if (!args.dryRun) await writeFile(destPath, mergedContent);
            syncState.books[book.asin] = { deliveredKeys: plan.deliveredKeys };
            summary.merged++;
            summary.newHighlights += plan.newHighlights.length;
            log(
              `${tag} ${args.dryRun ? "dry" : "merge"} ${book.title} (+${plan.newHighlights.length} highlights)`,
            );
            break;
          }
        }
        continue;
      }

      const topic = await classifyFor(book, data);
      const md = buildBookMarkdown(data, topic, now());
      if (!args.force && (await exists(destPath))) {
        summary.skipped++;
        log(`${tag} skip ${book.title} (exists)`);
        continue;
      }
      if (!args.dryRun) {
        await writeFile(destPath, md.content);
      }
      summary.written++;
      log(
        `${tag} ${args.dryRun ? "dry" : "ok"} ${book.title} (${data.highlights.length} highlights, topic: ${topic})`,
      );
    } catch (err) {
      summary.failed++;
      const reason = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${book.asin}: ${reason}`);
      log(`[${i + 1}/${books.length}] FAIL ${book.title}: ${reason}`);
    }
  }

  if (args.merge && !args.dryRun) {
    await writeFile(statePath, `${JSON.stringify(syncState, null, 2)}\n`);
  }

  log(
    `Done. books=${summary.books} written=${summary.written} merged=${summary.merged} initialized=${summary.initialized} newHighlights=${summary.newHighlights} skipped=${summary.skipped} failed=${summary.failed}`,
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
