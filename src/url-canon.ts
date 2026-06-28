/**
 * URL canonicalization + the in-memory dedup index. Pure module, no Obsidian
 * deps, so the matching logic is fully unit-testable. `intake` re-exports the
 * Twitter primitives below to keep its public surface unchanged.
 */

const TWITTER_HOST_RE =
  /^(?:www\.)?(twitter\.com|x\.com|fxtwitter\.com|fixupx\.com|vxtwitter\.com)$/;
const TWEET_PATH_RE = /^\/([^/]+)\/status\/(\d+)/;

export function isTwitterUrl(url: string): boolean {
  try {
    return TWITTER_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function extractTweetIdentifiers(
  url: string,
): { user: string; id: string } | undefined {
  try {
    const m = TWEET_PATH_RE.exec(new URL(url).pathname);
    if (!m || !m[1] || !m[2]) return undefined;
    return { user: m[1], id: m[2] };
  } catch {
    return undefined;
  }
}

const TRACKING_PARAM_EXACT = new Set<string>([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "vero_conv",
  "oly_anon_id",
  "oly_enc_id",
  "wt_mc",
  "spm",
  "scid",
  "ref",
  "ref_src",
  "ref_url",
  "s",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  if (k.startsWith("utm_")) return true;
  return TRACKING_PARAM_EXACT.has(k);
}

/**
 * Canonical key for dedup: identical articles arriving with different tracking
 * params / www / protocol / trailing slash collapse to one string. Tweets key
 * on the numeric id alone, so `x.com` / `twitter.com` / `fxtwitter.com` and a
 * changed handle all match. Returns "" for empty input; falls back to the
 * lowercased raw string for non-http(s) or unparseable URLs.
 */
export function canonicalizeUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  if (isTwitterUrl(trimmed)) {
    const t = extractTweetIdentifiers(trimmed);
    if (t) return `tweet:${t.id}`;
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return trimmed.toLowerCase();
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query =
    params.length > 0
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
  return `https://${host}${path}${query}`;
}

export interface ExistingNote {
  path: string;
  title: string;
  status: string;
  readAt?: string;
}

export type UrlIndex = Map<string, ExistingNote>;

/**
 * Registers a note under its canonical URL. When two notes share a URL, a
 * `read` one wins so lookups can report "ya lo leíste" rather than "ya está en
 * tu cola". No-op for URLs that canonicalize to "".
 */
export function addToUrlIndex(
  index: UrlIndex,
  url: string,
  note: ExistingNote,
): void {
  const key = canonicalizeUrl(url);
  if (!key) return;
  const existing = index.get(key);
  if (!existing) {
    index.set(key, note);
    return;
  }
  if (existing.status !== "read" && note.status === "read") {
    index.set(key, note);
  }
}

export function findDuplicate(
  url: string,
  index: UrlIndex,
): ExistingNote | undefined {
  const key = canonicalizeUrl(url);
  if (!key) return undefined;
  return index.get(key);
}
