// Pure DOM lookup for the ephemeral highlight flash (MX14, improves the
// MX13 jump). Finding the element is best-effort: callers degrade silently.

export const HIGHLIGHT_FLASH_CLASS = "readqueue-highlight-flash";
export const HIGHLIGHT_FLASH_DURATION_MS = 2_200;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Locates the rendered `<mark>` element matching a highlight's text.
 * Exact (whitespace-insensitive) match wins; falls back to containment in
 * either direction because the renderer may split or join adjacent marks.
 */
export function findHighlightElement(
  container: ParentNode,
  text: string,
): HTMLElement | undefined {
  const target = normalizeText(text);
  if (!target) return undefined;
  const marks = Array.from(container.querySelectorAll("mark"));
  for (const m of marks) {
    if (normalizeText(m.textContent ?? "") === target) return m;
  }
  for (const m of marks) {
    const t = normalizeText(m.textContent ?? "");
    if (t && (t.includes(target) || target.includes(t))) return m;
  }
  return undefined;
}
