import { describe, expect, it } from "vitest";

import {
  deliveredToSyncState,
  mergeDeliveredState,
  parseSyncState,
  planLibrarySync,
  serializeSyncState,
  syncStateToDelivered,
  type ScrapedBook,
} from "../src/kindle-sync-plan";
import { buildBookMarkdown, type KindleBook } from "../src/kindle";
import { highlightKey } from "../src/kindle-merge";

const book = (asin: string, title = "A Book"): KindleBook => ({
  asin,
  title,
  author: "Author",
  coverUrl: undefined,
});

const hl = (text: string, location?: string) => ({
  text,
  location,
  note: undefined,
});

function slugOf(b: KindleBook, highlights = [hl("x")]): string {
  return buildBookMarkdown({ book: b, highlights }, "otros").slug;
}

describe("planLibrarySync", () => {
  it("recreates a brand-new book (no state, no file) and marks all keys delivered", () => {
    const b = book("B1");
    const scraped: ScrapedBook[] = [{ book: b, highlights: [hl("one"), hl("two")] }];
    const plan = planLibrarySync({
      scraped,
      deliveredByAsin: {},
      existingSlugs: new Set(),
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.action).toBe("recreate");
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.fullContent).toContain("> one");
    expect(plan.writes[0]?.fullContent).toContain("> two");
    expect(plan.deliveredByAsin["B1"]).toEqual([
      highlightKey(hl("one")),
      highlightKey(hl("two")),
    ]);
    expect(plan.counts.recreate).toBe(1);
  });

  it("appends only never-delivered highlights when the file already exists", () => {
    const b = book("B2");
    const delivered = [highlightKey(hl("old"))];
    const scraped: ScrapedBook[] = [
      { book: b, highlights: [hl("old"), hl("new1"), hl("new2")] },
    ];
    const plan = planLibrarySync({
      scraped,
      deliveredByAsin: { B2: delivered },
      existingSlugs: new Set([slugOf(b)]),
    });

    const item = plan.items[0];
    expect(item?.action).toBe("append");
    expect(item?.merge?.newHighlights.map((h) => h.text)).toEqual(["new1", "new2"]);
    expect(plan.counts.newHighlights).toBe(2);
    expect(plan.deliveredByAsin["B2"]).toHaveLength(3);
  });

  it("emits `none` (no write) when the file exists and nothing is new", () => {
    const b = book("B3");
    const delivered = [highlightKey(hl("only"))];
    const plan = planLibrarySync({
      scraped: [{ book: b, highlights: [hl("only")] }],
      deliveredByAsin: { B3: delivered },
      existingSlugs: new Set([slugOf(b)]),
    });
    expect(plan.items[0]?.action).toBe("none");
    expect(plan.writes).toHaveLength(0);
  });

  it("adopts an existing note with NO delivered state via init-state (never clobbers user edits)", () => {
    const b = book("B4");
    const scraped: ScrapedBook[] = [{ book: b, highlights: [hl("a"), hl("b")] }];
    const plan = planLibrarySync({
      scraped,
      deliveredByAsin: {}, // e.g. after "Reset libros" / a cleared sidecar
      existingSlugs: new Set([slugOf(b)]),
    });
    expect(plan.items[0]?.action).toBe("init-state");
    expect(plan.writes).toHaveLength(0); // <- the safety property
    expect(plan.deliveredByAsin["B4"]).toEqual([
      highlightKey(hl("a")),
      highlightKey(hl("b")),
    ]);
  });
});

describe("mergeDeliveredState", () => {
  it("lets the vault sidecar win over the storage cache, filling gaps from cache", () => {
    const merged = mergeDeliveredState(
      { A: ["k1"] }, // sidecar
      { A: ["stale"], B: ["k2"] }, // cache
    );
    expect(merged).toEqual({ A: ["k1"], B: ["k2"] });
  });

  it("handles undefined inputs", () => {
    expect(mergeDeliveredState(undefined, undefined)).toEqual({});
    expect(mergeDeliveredState({ A: ["k"] }, undefined)).toEqual({ A: ["k"] });
  });
});

describe("sidecar serialization", () => {
  it("parses tolerantly and drops malformed entries", () => {
    const state = parseSyncState(
      JSON.stringify({ version: 1, books: { A: { deliveredKeys: ["k", 3] }, B: {} } }),
    );
    expect(state.books["A"]?.deliveredKeys).toEqual(["k"]);
    expect(state.books["B"]).toBeUndefined();
  });

  it("round-trips delivered ↔ sync state", () => {
    const delivered = { A: ["k1", "k2"], B: ["k3"] };
    const state = deliveredToSyncState(delivered);
    expect(state.version).toBe(1);
    expect(syncStateToDelivered(state)).toEqual(delivered);
    const serialized = serializeSyncState(delivered);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(syncStateToDelivered(parseSyncState(serialized))).toEqual(delivered);
  });

  it("returns empty state for garbage", () => {
    expect(parseSyncState("not json").books).toEqual({});
  });
});
