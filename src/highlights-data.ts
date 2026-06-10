// Pure highlight-extraction + daily-selection logic — no Obsidian imports,
// fully unit-testable. The vault scanning lives in main.ts; this module only
// sees raw markdown content plus a small metadata shape.

export type ArticleSource = "web" | "kindle" | "matter";

export interface HighlightFileMeta {
  /** vault-relative path, e.g. "Inbox/Web/foo.md" */
  sourcePath: string;
  /** display title (frontmatter title or file basename) */
  title: string;
  /** frontmatter `source` value, if any */
  source?: string | undefined;
}

export interface ExtractedHighlight {
  text: string;
  note?: string;
  location?: string;
  kind: "inline" | "section";
  /** 0-based line index in the raw file content (frontmatter included) */
  line: number;
  sourcePath: string;
  title: string;
  articleSource: ArticleSource;
}

export function classifyArticleSource(source: string | undefined): ArticleSource {
  if (source === "kindle-scrape") return "kindle";
  if (source === "matter-legacy") return "matter";
  return "web";
}

const FENCE_RE = /^[ \t]{0,3}(?:`{3,}|~{3,})/;
const HIGHLIGHTS_HEADING_RE = /^##\s+Highlights\s*$/i;
const SECTION_END_RE = /^#{1,2}\s/;

interface LineContext {
  lines: string[];
  /** [start, end) line range of the `## Highlights` section body, or null */
  sectionRange: readonly [number, number] | null;
  /** set of line indices inside fenced code blocks (incl. fence delimiters) */
  fencedLines: Set<number>;
  /** first body line (after frontmatter) */
  bodyStart: number;
}

function buildLineContext(content: string): LineContext {
  const lines = content.split("\n");

  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i] ?? "")) {
        bodyStart = i + 1;
        break;
      }
    }
  }

  const fencedLines = new Set<number>();
  let inFence = false;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE_RE.test(line)) {
      fencedLines.add(i);
      inFence = !inFence;
      continue;
    }
    if (inFence) fencedLines.add(i);
  }

  let sectionRange: readonly [number, number] | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    if (fencedLines.has(i)) continue;
    if (HIGHLIGHTS_HEADING_RE.test(lines[i] ?? "")) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (!fencedLines.has(j) && SECTION_END_RE.test(lines[j] ?? "")) {
          end = j;
          break;
        }
      }
      sectionRange = [i + 1, end];
      break;
    }
  }

  return { lines, sectionRange, fencedLines, bodyStart };
}

/** [start, end) column ranges of `inline code spans` within one line */
function codeSpanRanges(line: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

const INLINE_HIGHLIGHT_RE =
  /==(?!=)([^=](?:[^=]|=(?!=))*?)==(?:[ \t]*%%((?:[^%]|%(?!%))+?)%%)?/g;

function extractInlineHighlights(
  ctx: LineContext,
  meta: HighlightFileMeta,
  articleSource: ArticleSource,
): ExtractedHighlight[] {
  const out: ExtractedHighlight[] = [];
  const [secStart, secEnd] = ctx.sectionRange ?? [-1, -1];
  for (let i = ctx.bodyStart; i < ctx.lines.length; i++) {
    if (ctx.fencedLines.has(i)) continue;
    // skip the `## Highlights` section body: its `==` would double-count
    // against the section extractor
    if (i >= secStart && i < secEnd) continue;
    const line = ctx.lines[i] ?? "";
    if (!line.includes("==")) continue;
    const spans = codeSpanRanges(line);
    INLINE_HIGHLIGHT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_HIGHLIGHT_RE.exec(line)) !== null) {
      const col = m.index;
      if (spans.some(([s, e]) => col >= s && col < e)) continue;
      const text = (m[1] ?? "").trim();
      if (!text) continue;
      const note = (m[2] ?? "").trim();
      const h: ExtractedHighlight = {
        text,
        kind: "inline",
        line: i,
        sourcePath: meta.sourcePath,
        title: meta.title,
        articleSource,
      };
      if (note) h.note = note;
      out.push(h);
    }
  }
  return out;
}

const LOCATION_LINE_RE = /^\*([^*].*?)\*\s*$/;
const NOTE_LINE_RE = /^📝\s*(.+)$/;

function extractSectionHighlights(
  ctx: LineContext,
  meta: HighlightFileMeta,
  articleSource: ArticleSource,
): ExtractedHighlight[] {
  if (!ctx.sectionRange) return [];
  const [start, end] = ctx.sectionRange;
  const out: ExtractedHighlight[] = [];
  let i = start;
  while (i < end) {
    const line = ctx.lines[i] ?? "";
    if (!/^>/.test(line)) {
      i++;
      continue;
    }
    const startLine = i;
    const quoted: string[] = [];
    while (i < end && /^>/.test(ctx.lines[i] ?? "")) {
      quoted.push((ctx.lines[i] ?? "").replace(/^>[ \t]?/, ""));
      i++;
    }
    const text = quoted.join("\n").trim();
    if (!text) continue;

    const h: ExtractedHighlight = {
      text,
      kind: "section",
      line: startLine,
      sourcePath: meta.sourcePath,
      title: meta.title,
      articleSource,
    };

    const locMatch = LOCATION_LINE_RE.exec(ctx.lines[i] ?? "");
    if (i < end && locMatch) {
      h.location = (locMatch[1] ?? "").trim();
      i++;
    }

    let j = i;
    while (j < end && (ctx.lines[j] ?? "").trim() === "") j++;
    const noteMatch = j < end ? NOTE_LINE_RE.exec(ctx.lines[j] ?? "") : null;
    if (noteMatch) {
      h.note = (noteMatch[1] ?? "").trim();
      i = j + 1;
    }

    out.push(h);
  }
  return out;
}

export function extractHighlights(
  content: string,
  meta: HighlightFileMeta,
): ExtractedHighlight[] {
  const articleSource = classifyArticleSource(meta.source);
  const ctx = buildLineContext(content);
  return [
    ...extractInlineHighlights(ctx, meta, articleSource),
    ...extractSectionHighlights(ctx, meta, articleSource),
  ];
}

// --- Daily resurfacing ------------------------------------------------------

/** FNV-1a hash of the seed string feeding a mulberry32 PRNG. */
export function rngFromSeed(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYatesInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}

const SOURCE_ORDER: readonly ArticleSource[] = ["web", "kindle", "matter"];

/**
 * Picks up to `count` highlights, deterministic for a given rng (seed the rng
 * with the date string for "same day = same picks"). Source variety is
 * weighted by round-robin: one pick per source (web → kindle → matter) per
 * lap, so a vault with 500 kindle highlights and 10 web ones still surfaces
 * web material every day.
 */
export function pickDailyHighlights<T extends { articleSource: ArticleSource }>(
  highlights: readonly T[],
  count: number,
  rng: () => number,
): T[] {
  if (count <= 0) return [];
  if (highlights.length <= count) return [...highlights];

  const buckets: Record<ArticleSource, T[]> = { web: [], kindle: [], matter: [] };
  for (const h of highlights) buckets[h.articleSource].push(h);
  for (const s of SOURCE_ORDER) fisherYatesInPlace(buckets[s], rng);

  const picks: T[] = [];
  while (picks.length < count) {
    let pickedThisLap = false;
    for (const s of SOURCE_ORDER) {
      const next = buckets[s].pop();
      if (next === undefined) continue;
      picks.push(next);
      pickedThisLap = true;
      if (picks.length >= count) break;
    }
    if (!pickedThisLap) break;
  }
  return picks;
}

export const DIGEST_HIGHLIGHTS_HEADING = "## Highlights para repasar";

export function digestHasHighlightsSection(content: string): boolean {
  return content.includes(DIGEST_HIGHLIGHTS_HEADING);
}

function noteLinkBase(sourcePath: string): string {
  const file = sourcePath.split("/").pop() ?? sourcePath;
  return file.replace(/\.md$/i, "");
}

export function buildDigestHighlightsSection(
  picks: readonly ExtractedHighlight[],
): string[] {
  const lines: string[] = [DIGEST_HIGHLIGHTS_HEADING, ""];
  for (const h of picks) {
    for (const textLine of h.text.split("\n")) {
      lines.push(`> ${textLine}`);
    }
    lines.push(`> — [[${noteLinkBase(h.sourcePath)}]]`);
    lines.push("");
  }
  return lines;
}
