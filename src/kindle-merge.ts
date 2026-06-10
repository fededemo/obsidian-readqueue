import { renderHighlightLines, type KindleHighlight } from "./kindle";

/**
 * Incremental Kindle re-sync (MX12).
 *
 * Identity of a highlight = normalized text + location. Per book we persist
 * the set of keys EVER delivered to the vault (not what the file currently
 * contains) — so a highlight the user deleted from the .md never reappears:
 * its key is already marked as delivered.
 */

export function normalizeHighlightText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function highlightKey(
  h: Pick<KindleHighlight, "text" | "location">,
): string {
  return `${normalizeHighlightText(h.text)}|${(h.location ?? "").trim()}`;
}

export function uniqueHighlightKeys(
  highlights: readonly KindleHighlight[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of highlights) {
    const key = highlightKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Scraped highlights whose key was never delivered, deduped within the scrape itself. */
export function diffNewHighlights(
  scraped: readonly KindleHighlight[],
  deliveredKeys: Iterable<string>,
): KindleHighlight[] {
  const seen = new Set(deliveredKeys);
  const out: KindleHighlight[] = [];
  for (const h of scraped) {
    const key = highlightKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export type MergePlan =
  | { action: "init-state"; deliveredKeys: string[] }
  | { action: "recreate"; deliveredKeys: string[] }
  | { action: "append"; newHighlights: KindleHighlight[]; deliveredKeys: string[] }
  | { action: "none"; deliveredKeys: string[] };

/**
 * Decides what to do with an already-known book on re-sync.
 *
 * - File missing from the vault → recreate it in full.
 * - No delivered-keys state (book imported before MX12) → migration: mark the
 *   currently scraped highlights as delivered WITHOUT touching the file, so the
 *   first re-sync doesn't duplicate everything already in the vault.
 * - Otherwise → append only the highlights never delivered before.
 */
export function planMerge(opts: {
  scraped: readonly KindleHighlight[];
  deliveredKeys: readonly string[] | undefined;
  fileExists: boolean;
}): MergePlan {
  const { scraped, deliveredKeys, fileExists } = opts;
  if (!fileExists) {
    const union = [
      ...new Set([...(deliveredKeys ?? []), ...uniqueHighlightKeys(scraped)]),
    ];
    return { action: "recreate", deliveredKeys: union };
  }
  if (deliveredKeys === undefined) {
    return { action: "init-state", deliveredKeys: uniqueHighlightKeys(scraped) };
  }
  const newHighlights = diffNewHighlights(scraped, deliveredKeys);
  if (newHighlights.length === 0) {
    return { action: "none", deliveredKeys: [...deliveredKeys] };
  }
  return {
    action: "append",
    newHighlights,
    deliveredKeys: [...deliveredKeys, ...newHighlights.map(highlightKey)],
  };
}

const HEADING_RE = /^#{1,6}\s/;
const HIGHLIGHTS_HEADING_RE = /^##\s+Highlights\s*$/;

/**
 * Appends new highlights at the end of the `## Highlights` section of an
 * existing note and updates `highlightCount` in the frontmatter — everything
 * else (user edits, extra frontmatter fields, extra sections, deleted
 * highlights) is left untouched. Creates the section at the end of the file
 * if the user removed it; never invents frontmatter if the user removed it.
 *
 * `highlightCount` is the count of keys ever delivered, not what the file
 * contains — consistent with the delivered-keys semantics.
 */
export function mergeHighlightsIntoMarkdown(
  existing: string,
  newHighlights: readonly KindleHighlight[],
  highlightCount: number,
): string {
  if (newHighlights.length === 0) return existing;
  const lines = existing.split("\n");
  const bodyStart = updateFrontmatterCount(lines, highlightCount);
  const blockLines = newHighlights.flatMap((h) => renderHighlightLines(h));
  insertIntoHighlightsSection(lines, blockLines, bodyStart);
  return lines.join("\n");
}

/** Returns the index of the first body line (after the closing `---`, or 0 if no frontmatter). */
function updateFrontmatterCount(lines: string[], count: number): number {
  if (lines[0] !== "---") return 0;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return 0;
  for (let i = 1; i < close; i++) {
    if (/^highlightCount:/.test(lines[i] ?? "")) {
      lines[i] = `highlightCount: ${count}`;
      return close + 1;
    }
  }
  lines.splice(close, 0, `highlightCount: ${count}`);
  return close + 2;
}

function insertIntoHighlightsSection(
  lines: string[],
  blockLines: string[],
  searchFrom: number,
): void {
  let heading = -1;
  for (let i = searchFrom; i < lines.length; i++) {
    if (HIGHLIGHTS_HEADING_RE.test(lines[i] ?? "")) {
      heading = i;
      break;
    }
  }
  if (heading === -1) {
    while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
      lines.pop();
    }
    lines.push("", "## Highlights", "", ...blockLines);
    return;
  }
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > heading + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt--;
  }
  // blockLines ends with "" so exactly one blank line separates from a following heading / EOF newline
  lines.splice(insertAt, end - insertAt, "", ...blockLines);
}
