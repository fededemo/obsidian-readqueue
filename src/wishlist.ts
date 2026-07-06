// Pure Amazon shared-wishlist parser + paginator (F5.2 / MX24). A public wishlist
// (`amazon.com/hz/wishlist/ls/<id>`) is server-side fetchable without a session,
// so the plugin scrapes it with requestUrl() — no browser extension, no new
// host permissions, works on mobile. Parsing is regex-based on stable markers
// (`itemName_<id>`, `item-byline-<id>`, `/dp/<asin>`), matching the style of
// kindle.ts's regex fallback; the HTML is huge but the markers are stable.

import type { DesiredBook } from "./books-data";

export interface WishlistItem {
  asin: string;
  /** Amazon list-item id (coliid) — kept for reference, not the primary key. */
  itemId: string;
  title: string;
  author?: string;
}

export interface WishlistPage {
  items: WishlistItem[];
  /** Relative path of the next page fragment, or undefined on the last page. */
  nextPath?: string;
}

const AMAZON_ORIGIN = "https://www.amazon.com";

export function wishlistUrl(listId: string): string {
  return `${AMAZON_ORIGIN}/hz/wishlist/ls/${listId}`;
}

/** Accepts a full share URL or a bare list id; returns the list id. */
export function parseWishlistId(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const fromUrl = trimmed.match(/\/wishlist\/ls\/([A-Za-z0-9]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  // Bare id: Amazon list ids are ~13 uppercase-alphanumeric chars.
  if (/^[A-Z0-9]{8,20}$/.test(trimmed)) return trimmed;
  return undefined;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

const cleanText = (raw: string): string =>
  decodeEntities(raw.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

// Amazon bylines end with the binding in parens ("Peter Attia MD (Kindle
// Edition)"); strip that trailing label so `author` is just the author.
const BINDING_SUFFIX_RE =
  /\s*\((?:[^)]*\b(?:Paperback|Hardcover|Kindle|Audio|Audiobook|Board book|Spiral|Library Binding|Loose Leaf|Mass Market|MP3|Pocket|Comic|Digital)\b[^)]*)\)\s*$/i;

const cleanAuthor = (raw: string): string =>
  cleanText(raw).replace(/^by\s+/i, "").replace(BINDING_SUFFIX_RE, "").trim();

const ITEM_RE =
  /<a[^>]*\bid="itemName_([A-Za-z0-9]+)"[^>]*\btitle="([^"]*)"[^>]*\bhref="\/dp\/([A-Za-z0-9]{10})/g;
const BYLINE_RE = /\bid="item-byline-([A-Za-z0-9]+)"[^>]*>([\s\S]*?)<\/span>/g;
const SHOW_MORE_INPUT_RE = /name="showMoreUrl"\s+value="([^"]+)"/;
const SHOW_MORE_JSON_RE = /"showMoreUrl":"([^"]+)"/;

export function parseWishlistPage(html: string): WishlistPage {
  const bylines = new Map<string, string>();
  BYLINE_RE.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = BYLINE_RE.exec(html)) !== null) {
    const id = bm[1];
    const text = cleanAuthor(bm[2] ?? "");
    if (id && text) bylines.set(id, text);
  }

  const items: WishlistItem[] = [];
  const seen = new Set<string>();
  ITEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM_RE.exec(html)) !== null) {
    const itemId = m[1] ?? "";
    const title = cleanText(m[2] ?? "");
    const asin = m[3] ?? "";
    if (!asin || !title || seen.has(asin)) continue;
    seen.add(asin);
    const item: WishlistItem = { asin, itemId, title };
    const author = bylines.get(itemId);
    if (author) item.author = author;
    items.push(item);
  }

  const page: WishlistPage = { items };
  const next =
    html.match(SHOW_MORE_INPUT_RE)?.[1] ?? html.match(SHOW_MORE_JSON_RE)?.[1];
  if (next) page.nextPath = decodeEntities(next);
  return page;
}

export interface FetchResult {
  status: number;
  text: string;
}
export type FetchText = (url: string) => Promise<FetchResult>;

export interface WishlistFetchResult {
  items: WishlistItem[];
  pages: number;
  /** True if we hit the page cap before exhausting the list. */
  truncated: boolean;
  error?: string;
}

function absoluteAmazon(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${AMAZON_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Fetches every page of a shared wishlist, following `showMoreUrl` until it runs
 * out or a page cap is hit (a guard against a pagination loop). Dedupes by ASIN.
 */
export async function collectWishlist(
  listId: string,
  fetchText: FetchText,
  opts: { maxPages?: number } = {},
): Promise<WishlistFetchResult> {
  const maxPages = opts.maxPages ?? 25;
  const seen = new Set<string>();
  const items: WishlistItem[] = [];
  let url: string | undefined = wishlistUrl(listId);
  let pages = 0;

  while (url && pages < maxPages) {
    let res: FetchResult;
    try {
      res = await fetchText(url);
    } catch (err) {
      return {
        items,
        pages,
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    pages++;
    if (res.status !== 200) {
      return { items, pages, truncated: false, error: `http-${res.status}` };
    }
    const page = parseWishlistPage(res.text);
    for (const it of page.items) {
      if (seen.has(it.asin)) continue;
      seen.add(it.asin);
      items.push(it);
    }
    url = page.nextPath ? absoluteAmazon(page.nextPath) : undefined;
  }

  return { items, pages, truncated: Boolean(url) };
}

/** Wishlist item → normalized DesiredBook (shelf: wishlist) for reconciliation. */
export function wishlistItemToDesired(item: WishlistItem): DesiredBook {
  const book: DesiredBook = {
    asin: item.asin,
    title: item.title,
    shelf: "wishlist",
    url: `${AMAZON_ORIGIN}/dp/${item.asin}`,
  };
  if (item.author) book.author = item.author;
  return book;
}
