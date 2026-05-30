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

export interface MatterMetadata {
  url: string | undefined;
  publisher: string | undefined;
  author: string | undefined;
  publishedDate: string | undefined;
  tags: string[];
}

export interface MatterDocument {
  metadata: MatterMetadata;
  highlights: string[];
}

const METADATA_SECTION_RE = /## Metadata\s*\n([\s\S]*?)(?=\n## |$)/;
const HIGHLIGHTS_SECTION_RE = /## Highlights\s*\n([\s\S]*?)$/;
const URL_LINE_RE = /^\* URL:\s*\[(.+?)\]\((.+?)\)/m;
const URL_LINE_PLAIN_RE = /^\* URL:\s*(.+)$/m;
const PUBLISHER_LINE_RE = /^\* Publisher:\s*(.+)$/m;
const AUTHOR_LINE_RE = /^\* Author:\s*(.+)$/m;
const PUBLISHED_LINE_RE = /^\* Published Date:\s*(.+)$/m;
const TAGS_LINE_RE = /^\* Tags:\s*(.*)$/m;
const HIGHLIGHT_LINE_RE = /^\* (.+)$/gm;

const TITLE_PREFIX_RES = [
  /^\[(?:FREE|99|\d+)\]\s*/,
  /^-+\s*/,
];

export function parseMetadata(section: string): MatterMetadata {
  const md: MatterMetadata = {
    url: undefined,
    publisher: undefined,
    author: undefined,
    publishedDate: undefined,
    tags: [],
  };
  const urlBracket = URL_LINE_RE.exec(section);
  if (urlBracket) {
    md.url = urlBracket[2]?.trim();
  } else {
    const urlPlain = URL_LINE_PLAIN_RE.exec(section);
    if (urlPlain) md.url = urlPlain[1]?.trim();
  }
  const pub = PUBLISHER_LINE_RE.exec(section);
  if (pub) md.publisher = pub[1]?.trim();
  const author = AUTHOR_LINE_RE.exec(section);
  if (author) md.author = author[1]?.trim();
  const published = PUBLISHED_LINE_RE.exec(section);
  if (published) md.publishedDate = published[1]?.trim();
  const tags = TAGS_LINE_RE.exec(section);
  if (tags) {
    md.tags = (tags[1] ?? "")
      .split(/\s+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter((t) => t.length > 0);
  }
  return md;
}

export function parseHighlights(section: string): string[] {
  const out: string[] = [];
  HIGHLIGHT_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HIGHLIGHT_LINE_RE.exec(section)) !== null) {
    const text = m[1]?.trim();
    if (text) out.push(text);
  }
  return out;
}

export function parseMatterDocument(content: string): MatterDocument {
  const metaMatch = METADATA_SECTION_RE.exec(content);
  const metadata = metaMatch ? parseMetadata(metaMatch[1] ?? "") : {
    url: undefined,
    publisher: undefined,
    author: undefined,
    publishedDate: undefined,
    tags: [],
  };
  const hlMatch = HIGHLIGHTS_SECTION_RE.exec(content);
  const highlights = hlMatch ? parseHighlights(hlMatch[1] ?? "") : [];
  return { metadata, highlights };
}

export function normalizeTitle(filename: string): string {
  const base = filename.replace(/\.md$/, "");
  let title = base;
  for (const re of TITLE_PREFIX_RES) {
    title = title.replace(re, "");
  }
  title = title.replace(/\.{3,}$/, "...").replace(/-{2,}$/, "");
  return title.trim();
}

export function hostnameFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const YAML_ESCAPE_RE = /["\\\n]/;

function yamlScalar(value: string): string {
  if (!YAML_ESCAPE_RE.test(value) && !/^[\s-]|[:\s]$/.test(value)) {
    return value;
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function yamlList(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlScalar).join(", ")}]`;
}

export interface BuildOptions {
  title: string;
  topic: string;
  savedAt: Date;
  document: MatterDocument;
}

export function buildFrontmatterYaml(opts: BuildOptions): string {
  const { document: doc, title, topic, savedAt } = opts;
  const ts = savedAt.toISOString();
  const tags = ["reader", "legacy", ...doc.metadata.tags];
  const lines: string[] = [
    `source: matter-legacy`,
    `title: ${yamlScalar(title)}`,
  ];
  if (doc.metadata.url) lines.push(`url: ${yamlScalar(doc.metadata.url)}`);
  if (doc.metadata.author) lines.push(`author: ${yamlScalar(doc.metadata.author)}`);
  if (doc.metadata.publishedDate) {
    lines.push(`published: ${yamlScalar(doc.metadata.publishedDate)}`);
  }
  const domain = hostnameFromUrl(doc.metadata.url);
  if (domain) lines.push(`domain: ${yamlScalar(domain)}`);
  lines.push(`savedAt: ${ts}`);
  lines.push(`status: read`);
  lines.push(`readAt: ${ts}`);
  lines.push(`tags: ${yamlList(tags)}`);
  lines.push(`topic: ${yamlScalar(topic)}`);
  return lines.join("\n");
}

export function buildBody(title: string, url: string | undefined, highlights: readonly string[]): string {
  const parts: string[] = [`# ${title}`];
  if (url) parts.push(`[Original ↗](${url})`);
  if (highlights.length > 0) {
    parts.push(`## Highlights`);
    for (const h of highlights) {
      const cleaned = h.trim();
      parts.push(`> ${cleaned}`);
    }
  }
  return parts.join("\n\n");
}

export function buildOutputMd(
  document: MatterDocument,
  filename: string,
  mtime: Date,
  topic: string,
): { content: string; slug: string; title: string } {
  const title = normalizeTitle(filename);
  const fm = buildFrontmatterYaml({ title, topic, savedAt: mtime, document });
  const body = buildBody(title, document.metadata.url, document.highlights);
  const content = `---\n${fm}\n---\n\n${body}\n`;
  const slug = slugifyForFilename(title);
  return { content, slug, title };
}

export interface CliArgs {
  source: string;
  dest: string;
  apiKey: string | undefined;
  dryRun: boolean;
  force: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    source: "",
    dest: "",
    apiKey: undefined,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--source":
        args.source = argv[++i] ?? "";
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
  if (!args.source || !args.dest) {
    throw new Error("--source and --dest are required");
  }
  return args;
}

export interface RunSummary {
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface RunDeps {
  readDir?: (dir: string) => Promise<string[]>;
  readFile?: (path: string) => Promise<string>;
  statFile?: (path: string) => Promise<{ mtime: Date }>;
  writeFile?: (path: string, content: string) => Promise<void>;
  exists?: (path: string) => Promise<boolean>;
  mkdirp?: (dir: string) => Promise<void>;
  classify?: (article: {
    title: string;
    excerpt: string;
    domain: string;
    source: string | undefined;
  }) => Promise<string>;
  log?: (msg: string) => void;
}

const defaultReadDir: NonNullable<RunDeps["readDir"]> = async (dir) =>
  (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));

const defaultReadFile: NonNullable<RunDeps["readFile"]> = (p) =>
  fs.readFile(p, "utf-8");

const defaultStat: NonNullable<RunDeps["statFile"]> = async (p) => {
  const st = await fs.stat(p);
  return { mtime: st.mtime };
};

const defaultWrite: NonNullable<RunDeps["writeFile"]> = async (p, c) => {
  await fs.writeFile(p, c, "utf-8");
};

const defaultExists: NonNullable<RunDeps["exists"]> = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const defaultMkdirp: NonNullable<RunDeps["mkdirp"]> = async (d) => {
  await fs.mkdir(d, { recursive: true });
};

export async function run(args: CliArgs, deps: RunDeps = {}): Promise<RunSummary> {
  const readDir = deps.readDir ?? defaultReadDir;
  const readFile = deps.readFile ?? defaultReadFile;
  const statFile = deps.statFile ?? defaultStat;
  const writeFile = deps.writeFile ?? defaultWrite;
  const exists = deps.exists ?? defaultExists;
  const mkdirp = deps.mkdirp ?? defaultMkdirp;
  const log = deps.log ?? ((msg: string) => process.stdout.write(`${msg}\n`));

  const summary: RunSummary = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  await mkdirp(args.dest);
  const files = await readDir(args.source);
  log(`Found ${files.length} markdown files in ${args.source}`);

  const settings: ClassifySettings = {
    topics: DEFAULT_TOPIC_LIST,
    publisherTopicMap: DEFAULT_PUBLISHER_TOPIC_MAP,
    anthropicApiKey: args.apiKey,
    classifyModel: "claude-haiku-4-5",
    useClaudeForClassification: Boolean(args.apiKey),
  };

  for (let i = 0; i < files.length; i++) {
    const filename = files[i] ?? "";
    if (!filename) continue;
    const sourcePath = path.join(args.source, filename);
    try {
      const content = await readFile(sourcePath);
      const stat = await statFile(sourcePath);
      const doc = parseMatterDocument(content);
      const title = normalizeTitle(filename);

      const classifyFn =
        deps.classify ??
        (async (input) => {
          const r = await classifyTopic(input, settings);
          return r.topic;
        });
      const topic = await classifyFn({
        title,
        excerpt: doc.highlights.slice(0, 4).join("\n"),
        domain: hostnameFromUrl(doc.metadata.url),
        source: "matter-legacy",
      });

      const out = buildOutputMd(doc, filename, stat.mtime, topic);
      const destPath = path.join(args.dest, `${out.slug}.md`);

      if (!args.force && (await exists(destPath))) {
        summary.skipped++;
        log(`[${i + 1}/${files.length}] skip (exists): ${out.slug}`);
        continue;
      }

      if (!args.dryRun) {
        await writeFile(destPath, out.content);
      }
      summary.migrated++;
      log(`[${i + 1}/${files.length}] ${args.dryRun ? "dry" : "ok"}: ${out.slug} (topic: ${topic})`);
    } catch (err) {
      summary.failed++;
      const reason = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${filename}: ${reason}`);
      log(`[${i + 1}/${files.length}] FAIL: ${filename}: ${reason}`);
    }
  }

  log(`Done. migrated=${summary.migrated} skipped=${summary.skipped} failed=${summary.failed}`);
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
  const args = parseArgs(process.argv.slice(2));
  run(args)
    .then((s) => {
      if (s.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
