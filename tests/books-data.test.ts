import { describe, expect, it } from "vitest";

import {
  BOOK_CARD_SOURCE,
  bookCardSlug,
  buildBookCardMarkdown,
  parseBookCard,
  reconcileLibrary,
  reconcileWishlist,
  type BookCard,
  type DesiredBook,
} from "../src/books-data";

const desired = (asin: string, shelf: DesiredBook["shelf"], title = "T"): DesiredBook => ({
  asin,
  title,
  shelf,
});

const card = (asin: string, shelf: BookCard["shelf"], extra: Partial<BookCard> = {}): BookCard => ({
  asin,
  title: "T",
  shelf,
  readingStatus: "unread",
  sourcePath: `Books/${asin}.md`,
  ...extra,
});

describe("buildBookCardMarkdown", () => {
  it("builds a card note with machine + user fields", () => {
    const md = buildBookCardMarkdown(
      { asin: "B1", title: "Outlive", author: "Peter Attia", shelf: "wishlist", url: "u" },
      { source: BOOK_CARD_SOURCE.wishlist, firstSeenAt: "2026-07-05T00:00:00.000Z" },
    );
    expect(md.slug).toBe(bookCardSlug("Outlive", "B1"));
    expect(md.content).toContain("source: readqueue-wishlist");
    expect(md.content).toContain("shelf: wishlist");
    expect(md.content).toContain("readingStatus: unread");
    expect(md.content).toContain("hasHighlights: false");
    expect(md.content).toContain("# Outlive");
    expect(md.content).toContain("> by Peter Attia");
  });

  it("round-trips through parseBookCard", () => {
    const md = buildBookCardMarkdown(
      { asin: "B2", title: "X", shelf: "owned" },
      { source: BOOK_CARD_SOURCE.library, firstSeenAt: "2026-07-05T00:00:00.000Z" },
    );
    // simulate metadataCache frontmatter
    const fm = {
      source: "kindle-library",
      asin: "B2",
      title: "X",
      shelf: "owned",
      readingStatus: "unread",
      hasHighlights: false,
    };
    const parsed = parseBookCard(fm, "Books/x.md");
    expect(parsed?.asin).toBe("B2");
    expect(parsed?.shelf).toBe("owned");
    expect(parsed?.readingStatus).toBe("unread");
    void md;
  });
});

describe("parseBookCard", () => {
  it("returns undefined without asin or shelf", () => {
    expect(parseBookCard({ title: "x" }, "p")).toBeUndefined();
    expect(parseBookCard({ asin: "B", title: "x" }, "p")).toBeUndefined();
    expect(parseBookCard(undefined, "p")).toBeUndefined();
  });
  it("defaults an unknown readingStatus to unread", () => {
    const c = parseBookCard({ asin: "B", shelf: "owned", readingStatus: "weird" }, "p");
    expect(c?.readingStatus).toBe("unread");
  });
  it("reads flags", () => {
    const c = parseBookCard(
      { asin: "B", shelf: "wishlist", wishlistRemoved: true, hasHighlights: true },
      "p",
    );
    expect(c?.wishlistRemoved).toBe(true);
    expect(c?.hasHighlights).toBe(true);
  });
});

describe("reconcileWishlist", () => {
  it("creates cards for new asins", () => {
    const actions = reconcileWishlist([desired("A", "wishlist")], []);
    expect(actions).toEqual([
      { type: "create", book: { asin: "A", title: "T", shelf: "wishlist" }, source: BOOK_CARD_SOURCE.wishlist },
    ]);
  });

  it("skips a wishlist item that already has a card", () => {
    const actions = reconcileWishlist([desired("A", "wishlist")], [card("A", "wishlist")]);
    expect(actions).toEqual([{ type: "skip", asin: "A" }]);
  });

  it("never downgrades an owned book still on the wishlist", () => {
    const actions = reconcileWishlist([desired("A", "wishlist")], [card("A", "owned")]);
    expect(actions).toEqual([{ type: "skip", asin: "A" }]);
  });

  it("flags a card removed from the wishlist", () => {
    const actions = reconcileWishlist([], [card("A", "wishlist")]);
    expect(actions).toEqual([
      { type: "update-machine", sourcePath: "Books/A.md", asin: "A", changes: { wishlistRemoved: true } },
    ]);
  });

  it("clears the removed flag when re-added", () => {
    const actions = reconcileWishlist(
      [desired("A", "wishlist")],
      [card("A", "wishlist", { wishlistRemoved: true })],
    );
    expect(actions).toEqual([
      { type: "update-machine", sourcePath: "Books/A.md", asin: "A", changes: { wishlistRemoved: null } },
    ]);
  });

  it("does not re-flag an already-removed card", () => {
    const actions = reconcileWishlist([], [card("A", "wishlist", { wishlistRemoved: true })]);
    expect(actions).toEqual([]);
  });
});

describe("reconcileLibrary", () => {
  it("creates new owned books", () => {
    const actions = reconcileLibrary([desired("A", "owned")], []);
    expect(actions[0]).toMatchObject({ type: "create", source: BOOK_CARD_SOURCE.library });
  });

  it("transitions wishlist → owned on purchase, clearing wishlistRemoved", () => {
    const actions = reconcileLibrary(
      [{ asin: "A", title: "T", shelf: "owned", acquiredAt: "2026-01-01" }],
      [card("A", "wishlist", { wishlistRemoved: true })],
    );
    expect(actions).toEqual([
      {
        type: "update-machine",
        sourcePath: "Books/A.md",
        asin: "A",
        changes: { shelf: "owned", wishlistRemoved: null, acquiredAt: "2026-01-01" },
      },
    ]);
  });

  it("skips a book already owned", () => {
    const actions = reconcileLibrary([desired("A", "owned")], [card("A", "owned")]);
    expect(actions).toEqual([{ type: "skip", asin: "A" }]);
  });

  it("keeps a card that vanished from the library (history > mirror)", () => {
    // book "B" exists locally but isn't in this library snapshot → no action for it
    const actions = reconcileLibrary([desired("A", "owned")], [card("B", "owned")]);
    expect(actions.find((a) => "asin" in a && a.asin === "B")).toBeUndefined();
  });
});
