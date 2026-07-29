// Reconciles Kindle highlight notes (`Inbox/Kindle/`, source: kindle-scrape)
// against the `Books/` card catalog (MX27). A note proves the book was read on
// the Kindle, so its card gets hasHighlights + a link to the note, the
// wishlist→owned flip, and the `unread → read` upgrade. Notes without a card
// seed new owned+read cards — annotated books become the owned catalog until
// MX23 brings the full library.
//
// Matching is deliberately conservative (B-506: "The Infinity Machine" was once
// confused with "The Infinite Machine"): exact ASIN, then normalized-title
// equality with an author guard. No edit-distance, no guessing — ambiguity is
// reported and skipped. No Obsidian imports here; vault I/O lives in main.ts.

import type {
  BookCard,
  DesiredBook,
  MachineFieldChanges,
  ReconcileAction,
} from "./books-data";
import { BOOK_CARD_SOURCE } from "./books-data";

export interface KindleNoteMeta {
  /** Ebook ASIN — usually differs from the card's (often print-edition) ASIN. */
  asin: string;
  title: string;
  author?: string;
  cover?: string;
  url?: string;
  highlightCount?: number;
  /** Vault-relative path, e.g. "Inbox/Kindle/7 Powers.md". */
  notePath: string;
}

export type MatchTier = "asin" | "title-full" | "title-main";

export interface AmbiguousMatch {
  notePath: string;
  title: string;
  candidatePaths: string[];
  tier: MatchTier;
}

export interface KindleReconcileResult {
  actions: ReconcileAction[];
  matchedByAsin: number;
  matchedByTitle: number;
  toCreate: number;
  /** Cards already fully reconciled (empty diff → skip). */
  unchanged: number;
  ambiguous: AmbiguousMatch[];
}

// --- Normalization -----------------------------------------------------------

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Comparison key: lowercase, no diacritics, "&" ≡ "and", alphanumerics only.
 * Leading articles and parentheticals are kept on purpose — dropping them only
 * widens the collision surface (the B-506 failure class). */
export function normalizeTitle(title: string): string {
  return stripDiacritics(title.toLowerCase())
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalized text before the first subtitle separator (":", "—", "–").
 * Kindle notebook titles often omit the subtitle that Amazon wishlist titles
 * carry. Falls back to the full normalized title when the cut leaves nothing. */
export function mainTitle(title: string): string {
  const cut = title.split(/[:—–]/, 1)[0] ?? title;
  const normalized = normalizeTitle(cut);
  return normalized !== "" ? normalized : normalizeTitle(title);
}

const AUTHOR_STOP_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "dr", "prof", "sir"]);

function authorTokens(author: string): Set<string> {
  const tokens = stripDiacritics(author.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !AUTHOR_STOP_TOKENS.has(t));
  return new Set(tokens);
}

/** True when the two author strings share at least one meaningful token —
 * handles "Finkel, Michael" vs "Michael Finkel", ignores initials and honorific
 * suffixes. Keeps "Sebastian Mallaby" vs "Camila Russo" disjoint. */
export function authorsAgree(a: string, b: string): boolean {
  const ta = authorTokens(a);
  for (const t of authorTokens(b)) if (ta.has(t)) return true;
  return false;
}

// --- Reconciliation ----------------------------------------------------------

function pushInto<K>(map: Map<K, BookCard[]>, key: K, card: BookCard): void {
  const list = map.get(key);
  if (list) list.push(card);
  else map.set(key, [card]);
}

function noteWikilink(notePath: string): string {
  return `[[${notePath.replace(/\.md$/, "")}]]`;
}

interface TierOutcome {
  tier: MatchTier;
  candidates: BookCard[];
}

/** First tier with ≥1 candidate decides — never falls through to a later tier. */
function findMatch(
  note: KindleNoteMeta,
  byAsin: Map<string, BookCard[]>,
  byFullTitle: Map<string, BookCard[]>,
  byMainTitle: Map<string, BookCard[]>,
): TierOutcome | undefined {
  const asinHits = byAsin.get(note.asin) ?? [];
  if (asinHits.length > 0) return { tier: "asin", candidates: asinHits };

  // Tier 2: full-title equality carries the confidence; the author guard only
  // applies when both sides actually have an author.
  const fullHits = (byFullTitle.get(normalizeTitle(note.title)) ?? []).filter(
    (card) => !note.author || !card.author || authorsAgree(note.author, card.author),
  );
  if (fullHits.length > 0) return { tier: "title-full", candidates: fullHits };

  // Tier 3: main-title equality is weaker, so both authors must be present and
  // agree — without authors this tier is unavailable.
  if (!note.author) return undefined;
  const author = note.author;
  const mainHits = (byMainTitle.get(mainTitle(note.title)) ?? []).filter(
    (card) => card.author !== undefined && authorsAgree(author, card.author),
  );
  if (mainHits.length > 0) return { tier: "title-main", candidates: mainHits };

  return undefined;
}

function changesFor(card: BookCard, note: KindleNoteMeta): ReconcileAction | undefined {
  const link = noteWikilink(note.notePath);
  const changes: MachineFieldChanges = {};
  if (!card.hasHighlights) changes.hasHighlights = true;
  if (card.highlightsNote !== link) changes.highlightsNote = link;
  if (card.shelf === "wishlist") {
    changes.shelf = "owned";
    if (card.wishlistRemoved) changes.wishlistRemoved = null;
  }
  if (card.readingStatus === "unread") changes.readingStatus = "read";
  if (Object.keys(changes).length === 0) return undefined;
  return { type: "update-machine", sourcePath: card.sourcePath, asin: card.asin, changes };
}

export function reconcileKindleNotes(
  notes: readonly KindleNoteMeta[],
  existing: readonly BookCard[],
): KindleReconcileResult {
  const byAsin = new Map<string, BookCard[]>();
  const byFullTitle = new Map<string, BookCard[]>();
  const byMainTitle = new Map<string, BookCard[]>();
  for (const card of existing) {
    pushInto(byAsin, card.asin, card);
    pushInto(byFullTitle, normalizeTitle(card.title), card);
    pushInto(byMainTitle, mainTitle(card.title), card);
  }

  const result: KindleReconcileResult = {
    actions: [],
    matchedByAsin: 0,
    matchedByTitle: 0,
    toCreate: 0,
    unchanged: 0,
    ambiguous: [],
  };
  // Two notes claiming the same card (duplicate Kindle notes) is as ambiguous
  // as two cards claiming the same note — report, never last-write-wins.
  const claimed = new Map<string, string>(); // card sourcePath → notePath

  for (const note of notes) {
    const outcome = findMatch(note, byAsin, byFullTitle, byMainTitle);

    if (!outcome) {
      const book: DesiredBook = { asin: note.asin, title: note.title, shelf: "owned" };
      if (note.author) book.author = note.author;
      if (note.cover) book.cover = note.cover;
      if (note.url) book.url = note.url;
      result.actions.push({
        type: "create",
        book,
        source: BOOK_CARD_SOURCE.kindleNotebook,
        seed: { readingStatus: "read", hasHighlights: true, highlightsNote: noteWikilink(note.notePath) },
      });
      result.toCreate += 1;
      continue;
    }

    const { tier, candidates } = outcome;
    const conflicting = candidates.some((c) => claimed.has(c.sourcePath));
    if (candidates.length > 1 || conflicting) {
      result.ambiguous.push({
        notePath: note.notePath,
        title: note.title,
        candidatePaths: candidates.map((c) => c.sourcePath),
        tier,
      });
      continue;
    }

    const card = candidates[0];
    if (!card) continue; // unreachable, keeps noUncheckedIndexedAccess happy
    claimed.set(card.sourcePath, note.notePath);
    const action = changesFor(card, note);
    if (!action) {
      result.actions.push({ type: "skip", asin: card.asin });
      result.unchanged += 1;
      continue;
    }
    result.actions.push(action);
    if (tier === "asin") result.matchedByAsin += 1;
    else result.matchedByTitle += 1;
  }

  return result;
}
