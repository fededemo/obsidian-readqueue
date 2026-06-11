// Pure URL validation/normalization for the "Agregar URL a la cola" modal.

const SCHEME_RE = /^https?:\/\//i;
const DOMAIN_LIKE_RE = /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/;

/**
 * Strict check used for clipboard prefill: only offer text that is
 * unambiguously a URL (explicit http/https scheme).
 */
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!SCHEME_RE.test(t)) return false;
  return normalizeUrlInput(t) !== undefined;
}

/**
 * Lenient normalization used on submit: accepts scheme-less domain-like
 * input ("example.com/post") by assuming https. Returns undefined when the
 * input cannot be a fetchable http(s) URL.
 */
export function normalizeUrlInput(raw: string): string | undefined {
  let t = raw.trim();
  if (t.startsWith("<") && t.endsWith(">")) t = t.slice(1, -1).trim();
  if (!t || /\s/.test(t)) return undefined;
  const candidate = SCHEME_RE.test(t)
    ? t
    : DOMAIN_LIKE_RE.test(t)
      ? `https://${t}`
      : undefined;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
