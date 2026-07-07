// Pure book-catalog model (F5.1 / F5.2). A "book card" is one markdown note per
// book in the `Books/` folder — separate from Kindle highlight notes (which stay
// in `Inbox/Kindle/` with source: kindle-scrape). Cards exist even for books
// with zero highlights (owned-but-unread, wishlist), which is exactly the signal
// the recommender needs. No Obsidian imports here — vault I/O lives in main.ts;
// this module only handles data shapes, markdown building, and reconciliation.

import { titleToFilename } from "./slugify";

export type Shelf = "owned" | "sample" | "borrowed" | "wishlist";
export type ReadingStatus = "unread" | "reading" | "read" | "abandoned";

export const SHELVES: readonly Shelf[] = ["owned", "sample", "borrowed", "wishlist"];
export const READING_STATUSES: readonly ReadingStatus[] = [
  "unread",
  "reading",
  "read",
  "abandoned",
];

/** A fully-materialized card as read back from a `Books/` note's frontmatter. */
export interface BookCard {
  asin: string;
  title: string;
  author?: string;
  cover?: string;
  url?: string;
  shelf: Shelf;
  /** User-owned: never overwritten by a machine sync. */
  readingStatus: ReadingStatus;
  topic?: string;
  hasHighlights?: boolean;
  highlightsNote?: string;
  acquiredAt?: string;
  firstSeenAt?: string;
  /** Wishlist item that disappeared without being purchased — negative signal. */
  wishlistRemoved?: boolean;
  /** vault-relative path of the note. */
  sourcePath: string;
}

/** Normalized input produced by a sync source (wishlist scrape or library API). */
export interface DesiredBook {
  asin: string;
  title: string;
  author?: string;
  cover?: string;
  url?: string;
  shelf: Shelf;
  acquiredAt?: string;
}

export const BOOK_CARD_SOURCE = {
  library: "kindle-library",
  wishlist: "readqueue-wishlist",
} as const;

// --- Markdown building -------------------------------------------------------

function yamlScalar(value: string): string {
  // See kindle.ts — quote anything that isn't a safe plain YAML scalar so a
  // ": " in a value (e.g. "By: Author") can't produce "Invalid properties".
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

export interface BookCardMarkdown {
  slug: string;
  content: string;
}

/** Same slug scheme as Kindle highlight notes (`title-asin`), so a card and its
 * highlight note match trivially. */
// asin kept in the signature for call-site stability; the readable title is
// unique enough for a personal library and reads far better as a filename.
export function bookCardSlug(title: string, _asin?: string): string {
  return titleToFilename(title);
}

export function buildBookCardMarkdown(
  book: DesiredBook,
  opts: { source: string; firstSeenAt: string; readingStatus?: ReadingStatus },
): BookCardMarkdown {
  const fm: string[] = [
    `source: ${opts.source}`,
    `asin: ${yamlScalar(book.asin)}`,
    `title: ${yamlScalar(book.title)}`,
  ];
  if (book.author) fm.push(`author: ${yamlScalar(book.author)}`);
  if (book.cover) fm.push(`cover: ${yamlScalar(book.cover)}`);
  if (book.url) fm.push(`url: ${yamlScalar(book.url)}`);
  fm.push(`shelf: ${book.shelf}`);
  fm.push(`readingStatus: ${opts.readingStatus ?? "unread"}`);
  if (book.acquiredAt) fm.push(`acquiredAt: ${yamlScalar(book.acquiredAt)}`);
  fm.push(`firstSeenAt: ${opts.firstSeenAt}`);
  fm.push(`hasHighlights: false`);
  fm.push(`topic:`);
  fm.push(`tags: [book]`);

  const body: string[] = [`# ${book.title}`, ""];
  if (book.author) body.push(`> by ${book.author}`, "");
  if (book.url) body.push(`[Amazon ↗](${book.url})`, "");

  const content = `---\n${fm.join("\n")}\n---\n\n${body.join("\n")}`;
  return { slug: bookCardSlug(book.title, book.asin), content };
}

// --- Frontmatter parsing (from a metadataCache frontmatter object) -----------

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asShelf(v: unknown): Shelf | undefined {
  return typeof v === "string" && (SHELVES as readonly string[]).includes(v)
    ? (v as Shelf)
    : undefined;
}

function asReadingStatus(v: unknown): ReadingStatus {
  return typeof v === "string" && (READING_STATUSES as readonly string[]).includes(v)
    ? (v as ReadingStatus)
    : "unread";
}

/** Reads a Books/ note's frontmatter into a BookCard. Returns undefined for
 * notes that aren't book cards (no asin or no shelf). */
export function parseBookCard(
  fm: Record<string, unknown> | undefined,
  sourcePath: string,
): BookCard | undefined {
  if (!fm) return undefined;
  const asin = asString(fm["asin"]);
  const shelf = asShelf(fm["shelf"]);
  if (!asin || !shelf) return undefined;
  const card: BookCard = {
    asin,
    title: asString(fm["title"]) ?? asin,
    shelf,
    readingStatus: asReadingStatus(fm["readingStatus"]),
    sourcePath,
  };
  const author = asString(fm["author"]);
  if (author) card.author = author;
  const cover = asString(fm["cover"]);
  if (cover) card.cover = cover;
  const url = asString(fm["url"]);
  if (url) card.url = url;
  const topic = asString(fm["topic"]);
  if (topic) card.topic = topic;
  const highlightsNote = asString(fm["highlightsNote"]);
  if (highlightsNote) card.highlightsNote = highlightsNote;
  const acquiredAt = asString(fm["acquiredAt"]);
  if (acquiredAt) card.acquiredAt = acquiredAt;
  const firstSeenAt = asString(fm["firstSeenAt"]);
  if (firstSeenAt) card.firstSeenAt = firstSeenAt;
  if (fm["hasHighlights"] === true) card.hasHighlights = true;
  if (fm["wishlistRemoved"] === true) card.wishlistRemoved = true;
  return card;
}

// --- Reconciliation ----------------------------------------------------------

/** Only machine-owned fields may change on an existing card. `readingStatus`,
 * `topic`, tags and the body are the user's and are never in here. */
export interface MachineFieldChanges {
  shelf?: Shelf;
  wishlistRemoved?: boolean | null; // null = remove the field
  acquiredAt?: string;
}

export type ReconcileAction =
  | { type: "create"; book: DesiredBook; source: string }
  | { type: "update-machine"; sourcePath: string; asin: string; changes: MachineFieldChanges }
  | { type: "skip"; asin: string };

function indexByAsin(cards: readonly BookCard[]): Map<string, BookCard> {
  const m = new Map<string, BookCard>();
  for (const c of cards) m.set(c.asin, c); // last write wins (ASIN is the key)
  return m;
}

/**
 * Reconcile the current wishlist against existing cards (F5.2):
 * - new asin → create (shelf: wishlist).
 * - existing wishlist card still present → clear any stale `wishlistRemoved`.
 * - existing OWNED (or sample/borrowed) card that's also on the wishlist → skip
 *   (never downgrade an owned book back to wishlist).
 * - existing wishlist card NOT in the current list → mark `wishlistRemoved: true`
 *   (the user lost interest — a signal for the recommender), card is kept.
 */
export function reconcileWishlist(
  desired: readonly DesiredBook[],
  existing: readonly BookCard[],
): ReconcileAction[] {
  const byAsin = indexByAsin(existing);
  const desiredAsins = new Set(desired.map((d) => d.asin));
  const actions: ReconcileAction[] = [];

  for (const book of desired) {
    const card = byAsin.get(book.asin);
    if (!card) {
      actions.push({ type: "create", book: { ...book, shelf: "wishlist" }, source: BOOK_CARD_SOURCE.wishlist });
      continue;
    }
    if (card.shelf === "wishlist" && card.wishlistRemoved) {
      // Re-added to the wishlist — clear the negative signal.
      actions.push({
        type: "update-machine",
        sourcePath: card.sourcePath,
        asin: card.asin,
        changes: { wishlistRemoved: null },
      });
    } else {
      actions.push({ type: "skip", asin: card.asin });
    }
  }

  for (const card of existing) {
    if (card.shelf !== "wishlist") continue;
    if (desiredAsins.has(card.asin)) continue;
    if (card.wishlistRemoved) continue; // already flagged
    actions.push({
      type: "update-machine",
      sourcePath: card.sourcePath,
      asin: card.asin,
      changes: { wishlistRemoved: true },
    });
  }

  return actions;
}

/**
 * Reconcile the owned Kindle library against existing cards (F5.1):
 * - new asin → create (shelf as given, typically owned/sample/borrowed).
 * - existing wishlist card now owned → flip shelf to owned, clear wishlistRemoved
 *   (the purchase transition). User fields untouched.
 * - existing card same shelf → skip.
 * - a card no longer in the library is NOT deleted (history > mirror) → skip.
 */
export function reconcileLibrary(
  desired: readonly DesiredBook[],
  existing: readonly BookCard[],
): ReconcileAction[] {
  const byAsin = indexByAsin(existing);
  const actions: ReconcileAction[] = [];

  for (const book of desired) {
    const card = byAsin.get(book.asin);
    if (!card) {
      actions.push({ type: "create", book, source: BOOK_CARD_SOURCE.library });
      continue;
    }
    if (card.shelf !== book.shelf) {
      const changes: MachineFieldChanges = { shelf: book.shelf };
      if (card.wishlistRemoved) changes.wishlistRemoved = null;
      if (book.acquiredAt && !card.acquiredAt) changes.acquiredAt = book.acquiredAt;
      actions.push({ type: "update-machine", sourcePath: card.sourcePath, asin: card.asin, changes });
    } else {
      actions.push({ type: "skip", asin: card.asin });
    }
  }

  return actions;
}
