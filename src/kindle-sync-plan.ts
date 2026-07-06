// Pure Kindle library-sync planner (MX22). No chrome / no Obsidian imports so
// it is fully unit-testable. Mirrors the CLI's per-book planMerge flow
// (scripts/sync-kindle.ts) so the browser extension and the CLI reconcile the
// vault identically. The extension's service worker calls this after parsing
// (parsing itself is delegated to the offscreen document, which has a DOM); the
// resulting merge requests are dispatched to the offscreen document to touch
// files. Keeping the decision here — instead of in the service worker — means
// the risky logic is covered by Vitest, not by an untypechecked, untestable
// background script.

import {
  buildBookMarkdown,
  type KindleBook,
  type KindleHighlight,
} from "./kindle";
import { planMerge, uniqueHighlightKeys } from "./kindle-merge";

export interface ScrapedBook {
  book: KindleBook;
  highlights: KindleHighlight[];
}

/** asin → keys EVER delivered to the vault (the sidecar / storage contents). */
export type DeliveredByAsin = Record<string, string[]>;

/** Payload the offscreen `merge-kindle-books` handler consumes. */
export interface MergeRequest {
  slug: string;
  asin: string;
  /** Full rebuild used when the file is missing from the vault. */
  fullContent: string;
  newHighlights: KindleHighlight[];
  /** Count of keys ever delivered — written into frontmatter `highlightCount`. */
  highlightCount: number;
}

export interface LibrarySyncItem {
  asin: string;
  slug: string;
  action: "recreate" | "append" | "init-state" | "none";
  /** deliveredKeys for this book AFTER the sync (the new sidecar entry). */
  deliveredKeys: string[];
  /** present only for recreate | append (the actions that write a file). */
  merge?: MergeRequest;
}

export interface LibrarySyncPlan {
  items: LibrarySyncItem[];
  /** New delivered state, keyed by asin — persist to the sidecar + storage. */
  deliveredByAsin: DeliveredByAsin;
  /** Books that produce a file write (recreate | append). */
  writes: MergeRequest[];
  counts: {
    recreate: number;
    append: number;
    initState: number;
    none: number;
    /** Sum of newHighlights across append items. */
    newHighlights: number;
  };
}

/**
 * Decides, per scraped book, what to do with the vault — reusing planMerge:
 *
 * - file exists + no delivered state → `init-state`: adopt what's there without
 *   rewriting it (the safety net that makes "Reset libros" / reinstall / a fresh
 *   sidecar non-destructive — existing notes with user edits are never clobbered).
 * - file missing → `recreate`: full rebuild (a genuinely new book, or one whose
 *   note was deleted).
 * - file exists + delivered state → `append` only the never-before-delivered
 *   highlights, or `none`.
 *
 * The offscreen `merge-kindle-books` handler re-reads the file at write time, so
 * recreate/append both route through it: missing → writes fullContent, present →
 * appends newHighlights. `topic` defaults to "otros" (the plugin classifies
 * later via classifyOnLoad, exactly like the CLI).
 */
export function planLibrarySync(opts: {
  scraped: readonly ScrapedBook[];
  deliveredByAsin: Readonly<DeliveredByAsin>;
  existingSlugs: ReadonlySet<string>;
  topic?: string;
  now?: Date;
}): LibrarySyncPlan {
  const topic = opts.topic ?? "otros";
  const deliveredByAsin: DeliveredByAsin = { ...opts.deliveredByAsin };
  const items: LibrarySyncItem[] = [];
  const writes: MergeRequest[] = [];
  const counts = {
    recreate: 0,
    append: 0,
    initState: 0,
    none: 0,
    newHighlights: 0,
  };

  for (const { book, highlights } of opts.scraped) {
    const md = buildBookMarkdown({ book, highlights }, topic, opts.now);
    const fileExists = opts.existingSlugs.has(md.slug);
    const plan = planMerge({
      scraped: highlights,
      deliveredKeys: opts.deliveredByAsin[book.asin],
      fileExists,
    });
    deliveredByAsin[book.asin] = plan.deliveredKeys;

    const item: LibrarySyncItem = {
      asin: book.asin,
      slug: md.slug,
      action: plan.action,
      deliveredKeys: plan.deliveredKeys,
    };

    switch (plan.action) {
      case "recreate": {
        item.merge = {
          slug: md.slug,
          asin: book.asin,
          fullContent: md.content,
          // If the file races back into existence, appending the full set keeps
          // the note complete rather than dropping highlights.
          newHighlights: [...highlights],
          highlightCount: plan.deliveredKeys.length,
        };
        writes.push(item.merge);
        counts.recreate++;
        break;
      }
      case "append": {
        item.merge = {
          slug: md.slug,
          asin: book.asin,
          fullContent: md.content,
          newHighlights: plan.newHighlights,
          highlightCount: plan.deliveredKeys.length,
        };
        writes.push(item.merge);
        counts.append++;
        counts.newHighlights += plan.newHighlights.length;
        break;
      }
      case "init-state":
        counts.initState++;
        break;
      case "none":
        counts.none++;
        break;
    }

    items.push(item);
  }

  return { items, deliveredByAsin, writes, counts };
}

/**
 * Source of truth for delivered keys is the vault sidecar; the extension's
 * chrome.storage.local cache fills gaps for books the sidecar doesn't know yet
 * (e.g. state written by a pre-sidecar extension version). Vault wins on
 * conflict so a synced sidecar (travelling via iCloud) drives every device.
 */
export function mergeDeliveredState(
  sidecar: Readonly<DeliveredByAsin> | undefined,
  cache: Readonly<DeliveredByAsin> | undefined,
): DeliveredByAsin {
  const out: DeliveredByAsin = {};
  for (const [asin, keys] of Object.entries(cache ?? {})) {
    if (Array.isArray(keys)) out[asin] = [...keys];
  }
  for (const [asin, keys] of Object.entries(sidecar ?? {})) {
    if (Array.isArray(keys)) out[asin] = [...keys];
  }
  return out;
}

export const SYNC_STATE_FILENAME = ".kindle-sync-state.json";

export interface SyncStateFile {
  version: 1;
  books: Record<string, { deliveredKeys: string[] }>;
}

/** Tolerant parse of the sidecar JSON — same shape as the CLI writes. Never
 * throws: invalid JSON or an unexpected shape yields empty state, so a corrupt
 * sidecar degrades to "adopt existing notes" (init-state) rather than aborting
 * the whole sync. */
export function parseSyncState(raw: string): SyncStateFile {
  let parsed: Partial<SyncStateFile> | undefined;
  try {
    parsed = JSON.parse(raw) as Partial<SyncStateFile>;
  } catch {
    return { version: 1, books: {} };
  }
  const books: SyncStateFile["books"] = {};
  if (parsed && typeof parsed === "object" && parsed.books && typeof parsed.books === "object") {
    for (const [asin, entry] of Object.entries(parsed.books)) {
      const keys = (entry as { deliveredKeys?: unknown } | undefined)
        ?.deliveredKeys;
      if (Array.isArray(keys)) {
        books[asin] = {
          deliveredKeys: keys.filter((k): k is string => typeof k === "string"),
        };
      }
    }
  }
  return { version: 1, books };
}

export function syncStateToDelivered(state: SyncStateFile): DeliveredByAsin {
  const out: DeliveredByAsin = {};
  for (const [asin, entry] of Object.entries(state.books)) {
    out[asin] = [...entry.deliveredKeys];
  }
  return out;
}

export function deliveredToSyncState(delivered: DeliveredByAsin): SyncStateFile {
  const books: SyncStateFile["books"] = {};
  for (const [asin, keys] of Object.entries(delivered)) {
    books[asin] = { deliveredKeys: [...keys] };
  }
  return { version: 1, books };
}

/** Serialize the sidecar exactly like the CLI (pretty JSON + trailing newline). */
export function serializeSyncState(delivered: DeliveredByAsin): string {
  return `${JSON.stringify(deliveredToSyncState(delivered), null, 2)}\n`;
}

// Re-export so the offscreen document (which lists .md files) can strip the
// extension consistently with buildBookMarkdown's slug.
export { uniqueHighlightKeys };
