// Pure highlight-location logic — no Obsidian imports, fully unit-testable.
//
// Strategy: instead of building a fuzzy regex over the markdown source, we
// strip the source down to the same plain text the preview renders (removing
// emphasis markers, link URLs, heading/list/blockquote prefixes, comments,
// frontmatter) while keeping a char-by-char map from plain-text offsets back
// to source offsets. The DOM selection is whitespace-normalized and searched
// in that plain text with a literal indexOf, then mapped back to the source.
//
// Known limits (accepted trade-offs, documented here on purpose):
// - Wikilink aliases `[[target|alias]]` keep "target|alias" as plain text
//   (the preview shows only "alias"), so selections inside aliased wikilinks
//   may not be found.
// - Footnote refs, math blocks and HTML entities are not decoded.
// - `==` inside fenced code blocks is treated as literal text (correct), but
//   `==` used as a comparison operator in *inline* prose outside code spans
//   would confuse the inside-highlight parity check.
// - Partial selections that start/end in the middle of an emphasis span
//   (e.g. selecting "bo" out of `**bold**`) produce nested markers that
//   Obsidian renders reasonably but not always perfectly.

export interface OccurrenceHint {
  before: string;
  after: string;
}

export interface SourceRange {
  start: number;
  end: number;
}

export type LocateFailureReason =
  | "empty"
  | "not-found"
  | "ambiguous"
  | "multi-block"
  | "inside-highlight";

export type LocateResult =
  | { ok: true; range: SourceRange }
  | { ok: false; reason: LocateFailureReason };

interface PlainMap {
  plain: string;
  /** map[i] = source offset of plain[i] */
  map: number[];
  /** source offsets of stripped `==` highlight markers (outside code) */
  highlightMarkers: number[];
}

export function normalizeSelectedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function skipFrontmatter(source: string): number {
  if (!source.startsWith("---")) return 0;
  const firstNl = source.indexOf("\n");
  if (firstNl === -1) return 0;
  if (source.slice(0, firstNl).trim() !== "---") return 0;
  const closeRe = /\n---[ \t]*(?:\n|$)/g;
  closeRe.lastIndex = firstNl;
  const m = closeRe.exec(source);
  if (!m) return 0;
  return m.index + m[0].length;
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

export function stripMarkdownToPlain(source: string): PlainMap {
  const map: number[] = [];
  const highlightMarkers: number[] = [];
  let plain = "";
  const n = source.length;
  let i = skipFrontmatter(source);
  let inFence = false;
  let atLineStart = true;

  const emit = (ch: string, srcIdx: number): void => {
    if (/\s/.test(ch)) {
      if (plain.length === 0 || plain.endsWith(" ")) return;
      plain += " ";
      map.push(srcIdx);
      return;
    }
    plain += ch;
    map.push(srcIdx);
  };

  while (i < n) {
    const ch = source.charAt(i);

    if (atLineStart) {
      if (/^(?:`{3,}|~{3,})/.test(source.slice(i, i + 3))) {
        // fence delimiter line: toggle and drop the whole line
        inFence = !inFence;
        emit(" ", i);
        const nl = source.indexOf("\n", i);
        i = nl === -1 ? n : nl + 1;
        continue;
      }
      if (!inFence) {
        // indentation + blockquote/heading/list prefixes are invisible in preview
        const m = /^[ \t]{0,3}(?:>[ \t]?)*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)?/.exec(
          source.slice(i),
        );
        if (m && m[0].length > 0) {
          emit(" ", i);
          i += m[0].length;
          atLineStart = false;
          continue;
        }
      }
      atLineStart = false;
      continue;
    }

    if (ch === "\n") {
      emit(" ", i);
      i++;
      atLineStart = true;
      continue;
    }

    if (inFence) {
      emit(ch, i);
      i++;
      continue;
    }

    // backslash escapes render the escaped char; map it to the punct itself
    if (ch === "\\" && i + 1 < n && ASCII_PUNCT.test(source.charAt(i + 1))) {
      emit(source.charAt(i + 1), i + 1);
      i += 2;
      continue;
    }

    // %%comments%% are invisible in preview
    if (ch === "%" && source.charAt(i + 1) === "%") {
      const close = source.indexOf("%%", i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }

    // inline code span: content is rendered verbatim, so copy it untouched
    if (ch === "`") {
      let runLen = 1;
      while (source.charAt(i + runLen) === "`") runLen++;
      const fence = "`".repeat(runLen);
      const close = source.indexOf(fence, i + runLen);
      if (close !== -1) {
        for (let j = i + runLen; j < close; j++) emit(source.charAt(j), j);
        i = close + runLen;
      } else {
        i += runLen;
      }
      continue;
    }

    if (ch === "=" && source.charAt(i + 1) === "=") {
      highlightMarkers.push(i);
      i += 2;
      continue;
    }

    if (ch === "~" && source.charAt(i + 1) === "~") {
      i += 2;
      continue;
    }

    if (ch === "*") {
      while (i < n && source.charAt(i) === "*") i++;
      continue;
    }

    // `_` is an emphasis marker only at word edges (snake_case stays intact)
    if (ch === "_") {
      let runEnd = i;
      while (runEnd < n && source.charAt(runEnd) === "_") runEnd++;
      const prev = i > 0 ? source.charAt(i - 1) : "";
      const next = runEnd < n ? source.charAt(runEnd) : "";
      const intraword = /\w/.test(prev) && /\w/.test(next);
      if (intraword) {
        for (let j = i; j < runEnd; j++) emit("_", j);
      }
      i = runEnd;
      continue;
    }

    if (ch === "!" && source.charAt(i + 1) === "[") {
      i++;
      continue;
    }

    if (ch === "[") {
      i++;
      continue;
    }

    if (ch === "]") {
      i++;
      if (source.charAt(i) === "(") {
        const close = source.indexOf(")", i + 1);
        i = close === -1 ? n : close + 1;
      }
      continue;
    }

    if (ch === "<") {
      const tag = /^<\/?[a-zA-Z][^>\n]*>/.exec(source.slice(i, i + 200));
      if (tag) {
        emit(" ", i);
        i += tag[0].length;
        continue;
      }
    }

    emit(ch, i);
    i++;
  }

  return { plain, map, highlightMarkers };
}

function commonSuffixLen(a: string, b: string): number {
  let len = 0;
  while (
    len < a.length &&
    len < b.length &&
    a.charAt(a.length - 1 - len) === b.charAt(b.length - 1 - len)
  ) {
    len++;
  }
  return len;
}

function commonPrefixLen(a: string, b: string): number {
  let len = 0;
  while (len < a.length && len < b.length && a.charAt(len) === b.charAt(len)) {
    len++;
  }
  return len;
}

function countRuns(s: string, c: string): number {
  let runs = 0;
  let inRun = false;
  for (const ch of s) {
    if (ch === c) {
      if (!inRun) {
        runs++;
        inRun = true;
      }
    } else {
      inRun = false;
    }
  }
  return runs;
}

const EMPHASIS_MARKERS = "*_~`";

/**
 * Nudges range boundaries so the inserted `==`/`==` never splits a markdown
 * construct: trims whitespace, re-attaches escape backslashes, swallows whole
 * `[text](url)` links when the selection cuts them, and expands over emphasis
 * marker runs so `**bold**` is wrapped as `==**bold**==` rather than
 * `**==bold==**`'s broken cousin `==**bold**`.
 */
function refineRangeBoundaries(source: string, range: SourceRange): SourceRange {
  let { start, end } = range;

  while (start < end && /\s/.test(source.charAt(start))) start++;
  while (end > start && /\s/.test(source.charAt(end - 1))) end--;

  // escaped punct at the start: include its backslash so `==` lands before it
  while (
    start > 0 &&
    source.charAt(start - 1) === "\\" &&
    ASCII_PUNCT.test(source.charAt(start))
  ) {
    start--;
  }

  // square-bracket balance: never leave half a [text](url) inside the wrap
  const sliceFor = (): string => source.slice(start, end);
  const opens = (sliceFor().match(/\[/g) ?? []).length;
  const closes = (sliceFor().match(/\]/g) ?? []).length;
  if (opens > closes) {
    const m = /^[^\]]*\]+(?:\([^)\n]*\))?/.exec(source.slice(end));
    if (m) end += m[0].length;
  } else if (closes > opens) {
    const lastOpen = source.lastIndexOf("[", start - 1);
    if (lastOpen !== -1) {
      start = lastOpen;
      if (start > 0 && source.charAt(start - 1) === "[") start--;
      if (start > 0 && source.charAt(start - 1) === "!") start--;
    }
  }

  // expand backwards over emphasis runs touching the start (opening markers)
  while (start > 0 && EMPHASIS_MARKERS.includes(source.charAt(start - 1))) start--;
  // expand forward only if doing so closes a run opened inside the slice
  while (end < source.length && EMPHASIS_MARKERS.includes(source.charAt(end))) {
    const c = source.charAt(end);
    if (countRuns(source.slice(start, end), c) % 2 === 1) {
      while (end < source.length && source.charAt(end) === c) end++;
    } else {
      break;
    }
  }

  return { start, end };
}

const BLOCK_BOUNDARY =
  /\n[ \t]*(?:\n|#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|>[ \t]?)/;

export function locateSelection(
  source: string,
  selectedText: string,
  hint?: OccurrenceHint,
): LocateResult {
  const needle = normalizeSelectedText(selectedText);
  if (!needle) return { ok: false, reason: "empty" };

  const { plain, map, highlightMarkers } = stripMarkdownToPlain(source);

  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const idx = plain.indexOf(needle, from);
    if (idx === -1) break;
    indices.push(idx);
    from = idx + 1;
  }
  if (indices.length === 0) return { ok: false, reason: "not-found" };

  let chosen: number;
  if (indices.length === 1) {
    chosen = indices[0] as number;
  } else {
    if (!hint) return { ok: false, reason: "ambiguous" };
    const beforeNorm = normalizeSelectedText(hint.before);
    const afterNorm = normalizeSelectedText(hint.after);
    const scored = indices
      .map((idx) => ({
        idx,
        score:
          commonSuffixLen(plain.slice(0, idx).trimEnd(), beforeNorm) +
          commonPrefixLen(plain.slice(idx + needle.length).trimStart(), afterNorm),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (!best || !second || best.score === second.score) {
      return { ok: false, reason: "ambiguous" };
    }
    chosen = best.idx;
  }

  const startSrc = map[chosen];
  const lastSrc = map[chosen + needle.length - 1];
  if (startSrc === undefined || lastSrc === undefined) {
    return { ok: false, reason: "not-found" };
  }
  let range: SourceRange = { start: startSrc, end: lastSrc + 1 };

  const sliceText = source.slice(range.start, range.end);
  // Selections spanning blocks are rejected: wrapping `==...==` across a
  // paragraph/list/heading boundary breaks rendering. One block at a time.
  if (BLOCK_BOUNDARY.test(sliceText)) {
    return { ok: false, reason: "multi-block" };
  }
  const lineStart = source.lastIndexOf("\n", range.start - 1) + 1;
  if (sliceText.includes("\n") && /^#{1,6}[ \t]/.test(source.slice(lineStart, lineStart + 7))) {
    return { ok: false, reason: "multi-block" };
  }

  // No nesting: reject selections inside or crossing an existing ==highlight==
  const markersBefore = highlightMarkers.filter((m) => m < range.start).length;
  const markersInside = highlightMarkers.some(
    (m) => m >= range.start && m < range.end,
  );
  if (markersBefore % 2 === 1 || markersInside) {
    return { ok: false, reason: "inside-highlight" };
  }

  range = refineRangeBoundaries(source, range);
  return { ok: true, range };
}

export function locateSelectionInSource(
  source: string,
  selectedText: string,
  occurrenceHint?: OccurrenceHint,
): SourceRange | null {
  const res = locateSelection(source, selectedText, occurrenceHint);
  return res.ok ? res.range : null;
}

/**
 * Wraps the range in `==...==`; an optional note is appended as an Obsidian
 * `%%comment%%` (invisible in preview). `%%` inside the note is stripped so a
 * malicious/clumsy note can never break out of the comment.
 */
export function applyHighlight(
  source: string,
  range: SourceRange,
  note?: string,
): string {
  let { start, end } = range;
  while (start < end && /\s/.test(source.charAt(start))) start++;
  while (end > start && /\s/.test(source.charAt(end - 1))) end--;
  if (start >= end) return source;
  const cleanNote = (note ?? "").replace(/%%/g, "").trim();
  const suffix = cleanNote ? ` %%${cleanNote}%%` : "";
  return (
    source.slice(0, start) +
    "==" +
    source.slice(start, end) +
    "==" +
    suffix +
    source.slice(end)
  );
}
