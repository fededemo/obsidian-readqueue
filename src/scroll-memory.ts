// Pure logic for "resume reading where you left off" (MX14).
// Persistence and DOM wiring live in reading-flow.ts.

export interface ScrollEntry {
  /** Value from MarkdownSubView.getScroll() — line-based, mode-specific. */
  scroll: number;
  /** Reading progress 0..1 measured on the scroller element, when available. */
  ratio?: number;
  /** Epoch ms of last capture — LRU eviction key. */
  updatedAt: number;
}

export type ScrollStore = Record<string, ScrollEntry>;

export const SCROLL_STORE_CAP = 200;
export const RESTORE_MIN_RATIO = 0.1;
/** When the ratio could not be measured, restore only past this many lines. */
export const RESTORE_FALLBACK_MIN_SCROLL = 20;
export const END_OF_ARTICLE_THRESHOLD = 0.97;

/** Upserts an entry, evicting the least-recently-updated paths beyond `cap`. */
export function rememberScroll(
  store: ScrollStore,
  path: string,
  entry: ScrollEntry,
  cap: number = SCROLL_STORE_CAP,
): ScrollStore {
  const next: ScrollStore = { ...store, [path]: entry };
  const paths = Object.keys(next);
  if (paths.length <= cap) return next;
  paths.sort((a, b) => (next[a]?.updatedAt ?? 0) - (next[b]?.updatedAt ?? 0));
  let toEvict = paths.length - cap;
  for (const p of paths) {
    if (toEvict <= 0) break;
    if (p === path) continue;
    delete next[p];
    toEvict--;
  }
  return next;
}

export function forgetScroll(store: ScrollStore, path: string): ScrollStore {
  if (!(path in store)) return store;
  const next = { ...store };
  delete next[path];
  return next;
}

/**
 * Restore only meaningful positions: trivial scrolls (< ~10% of the article)
 * are not worth the jump. Without a measured ratio, fall back to an absolute
 * line threshold.
 */
export function shouldRestoreScroll(
  entry: ScrollEntry | undefined,
  minRatio: number = RESTORE_MIN_RATIO,
  fallbackMinScroll: number = RESTORE_FALLBACK_MIN_SCROLL,
): entry is ScrollEntry {
  if (!entry || entry.scroll <= 0) return false;
  if (entry.ratio !== undefined) return entry.ratio >= minRatio;
  return entry.scroll >= fallbackMinScroll;
}

/** Progress 0..1; content that does not scroll counts as fully read. */
export function scrollRatio(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  const range = scrollHeight - clientHeight;
  if (range <= 0) return 1;
  return Math.min(1, Math.max(0, scrollTop / range));
}

export function isEndOfArticle(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = END_OF_ARTICLE_THRESHOLD,
): boolean {
  return scrollRatio(scrollTop, clientHeight, scrollHeight) >= threshold;
}
