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

/**
 * Human-readable note filename: keeps the title's words, spaces and case, and
 * only strips characters that are illegal on disk (iCloud/macOS/Windows) or that
 * Obsidian treats specially in links (`# ^ [ ] |`). Used for book notes so they
 * read "7 Powers The Foundations of Business Strategy" instead of a hyphenated
 * slug with an ASIN glued on the end.
 */
export function titleToFilename(title: string): string {
  const cleaned = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .replace(/[.\s]+$/g, "")
    .trim();
  return cleaned || "untitled";
}
