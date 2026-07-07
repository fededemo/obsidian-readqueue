import { titleToFilename } from "./slugify";

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

export interface BookMarkdown {
  content: string;
  slug: string;
}

export const LIBRARY_URL = "https://read.amazon.com/notebook";

export const bookUrl = (asin: string): string =>
  `https://read.amazon.com/notebook?asin=${asin}&contentLimitState=&`;

const LIBRARY_ITEM_RE =
  /<div[^>]*class="[^"]*kp-notebook-library-each-book[^"]*"[^>]*data-asin="([^"]+)"[\s\S]*?<\/div>\s*<\/div>/g;
const TITLE_RE =
  /class="[^"]*kp-notebook-searchable[^"]*"[^>]*>\s*([\s\S]*?)\s*</;
const AUTHOR_RE = />\s*(?:Por|By)[:\s]\s*([^<]+)</i;
const COVER_RE = /<img[^>]*src="([^"]+)"/;

export function parseLibrary(
  html: string,
  parseDom: (h: string) => Document,
): KindleBook[] {
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
      ? authorRaw.replace(/^\s*(?:Por|By)\b[:\s]+/i, "").trim() || undefined
      : undefined;
    const coverUrl = coverEl?.getAttribute("src") ?? undefined;
    out.push({ asin, title, author, coverUrl });
  }
  if (out.length > 0) return out;

  // Regex fallback (Amazon HTML structure changed)
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

function yamlScalar(value: string): string {
  // Quote whenever the value would be invalid or ambiguous as a plain YAML
  // scalar. Notably `: ` (colon+space, e.g. "By: Ayn Rand") makes it a mapping —
  // that's what triggered Obsidian's "Invalid properties". URLs like
  // `https://…` stay unquoted (the colon isn't followed by a space).
  const unsafe =
    value === "" ||
    /["\\\n]/.test(value) ||
    /:\s|:$/.test(value) ||
    /\s#/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value);
  if (!unsafe) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function yamlList(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlScalar).join(", ")}]`;
}

/** Renders one highlight as markdown block lines (blockquote + location + 📝 note), ending with a blank line. Shared by full builds and incremental merges so both produce identical output. */
export function renderHighlightLines(h: KindleHighlight): string[] {
  const lines = [`> ${h.text.replace(/\n/g, "\n> ")}`];
  if (h.location) lines.push(`*${h.location}*`);
  if (h.note) {
    lines.push("");
    lines.push(`📝 ${h.note}`);
  }
  lines.push("");
  return lines;
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
  fmLines.push(
    `url: ${yamlScalar(`https://read.amazon.com/notebook?asin=${book.asin}`)}`,
  );
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
    bodyLines.push(...renderHighlightLines(h));
  }

  const content = `---\n${fmLines.join("\n")}\n---\n\n${bodyLines.join("\n")}`;
  const slug = titleToFilename(book.title);
  return { content, slug };
}
