import { describe, expect, it } from "vitest";

import type { BookCard } from "../src/books-data";
import {
  authorsAgree,
  mainTitle,
  normalizeTitle,
  reconcileKindleNotes,
  type KindleNoteMeta,
} from "../src/kindle-books-reconcile";

const note = (
  asin: string,
  title: string,
  extra: Partial<KindleNoteMeta> = {},
): KindleNoteMeta => ({
  asin,
  title,
  notePath: `Inbox/Kindle/${title}.md`,
  ...extra,
});

const card = (
  asin: string,
  shelf: BookCard["shelf"],
  extra: Partial<BookCard> = {},
): BookCard => ({
  asin,
  title: "T",
  shelf,
  readingStatus: "unread",
  sourcePath: `Books/${asin}.md`,
  ...extra,
});

describe("normalizeTitle", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeTitle("Ágilmente")).toBe("agilmente");
  });

  it("treats & and 'and' as equal", () => {
    expect(normalizeTitle("War & Peace")).toBe(normalizeTitle("War and Peace"));
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeTitle("A Philosophy of Software Design,   2nd Edition!")).toBe(
      "a philosophy of software design 2nd edition",
    );
  });

  it("keeps leading articles (B-506: no collision widening)", () => {
    expect(normalizeTitle("The Infinity Machine")).not.toBe(
      normalizeTitle("Infinity Machine"),
    );
  });
});

describe("mainTitle", () => {
  it("cuts at colon", () => {
    expect(mainTitle("Outlive: The Science and Art of Longevity")).toBe("outlive");
  });

  it("cuts at em dash and en dash", () => {
    expect(mainTitle("Range — Why Generalists Triumph")).toBe("range");
    expect(mainTitle("Range – Why Generalists Triumph")).toBe("range");
  });

  it("falls back to the full title when the cut leaves nothing", () => {
    expect(mainTitle(": Only Subtitle")).toBe("only subtitle");
  });
});

describe("authorsAgree", () => {
  it("handles reversed order and commas", () => {
    expect(authorsAgree("Finkel, Michael", "Michael Finkel")).toBe(true);
  });

  it("ignores initials and honorific suffixes", () => {
    expect(authorsAgree("Peter Attia MD", "Peter Attia")).toBe(true);
    expect(authorsAgree("J. K. Rowling", "Rowling")).toBe(true);
  });

  it("keeps distinct authors disjoint (Mallaby vs Russo)", () => {
    expect(authorsAgree("Sebastian Mallaby", "Camila Russo")).toBe(false);
  });
});

describe("reconcileKindleNotes — matching tiers", () => {
  it("matches by exact ASIN even with different titles", () => {
    const c = card("B01", "wishlist", { title: "Completely Different" });
    const n = note("B01", "Some Kindle Title");
    const r = reconcileKindleNotes([n], [c]);
    expect(r.actions).toEqual([
      {
        type: "update-machine",
        sourcePath: "Books/B01.md",
        asin: "B01",
        changes: {
          hasHighlights: true,
          highlightsNote: "[[Inbox/Kindle/Some Kindle Title]]",
          shelf: "owned",
          readingStatus: "read",
        },
      },
    ]);
    expect(r.matchedByAsin).toBe(1);
    expect(r.matchedByTitle).toBe(0);
  });

  it("Stranger in the Woods: print vs kindle ASIN, subtitle case differs → title match", () => {
    const c = card("1101911530", "wishlist", {
      title: "The Stranger in the Woods: The Extraordinary Story of the Last True Hermit",
      author: "Michael Finkel",
    });
    const n = note(
      "B01HYA2WDQ",
      "The Stranger in the Woods: The extraordinary story of the last true hermit",
      { author: "Michael Finkel" },
    );
    const r = reconcileKindleNotes([n], [c]);
    expect(r.matchedByTitle).toBe(1);
    expect(r.actions[0]).toMatchObject({
      type: "update-machine",
      asin: "1101911530",
      changes: { shelf: "owned", readingStatus: "read", hasHighlights: true },
    });
  });

  it("kindle title without subtitle matches full wishlist title via author guard", () => {
    const c = card("0593138031", "wishlist", {
      title: "Outlive: The Science and Art of Longevity",
      author: "Peter Attia MD",
    });
    const n = note("B0B1BTJLJN", "Outlive", { author: "Peter Attia" });
    const r = reconcileKindleNotes([n], [c]);
    expect(r.matchedByTitle).toBe(1);
    expect(r.actions[0]?.type).toBe("update-machine");
  });

  it("7 Powers: same title on both sides → single match, wishlist flips to owned", () => {
    const c = card("W7", "wishlist", {
      title: "7 Powers: The Foundations of Business Strategy",
      author: "Hamilton Helmer",
    });
    const n = note("K7", "7 Powers: The Foundations of Business Strategy", {
      author: "Hamilton Helmer",
    });
    const r = reconcileKindleNotes([n], [c]);
    expect(r.actions[0]).toMatchObject({
      type: "update-machine",
      changes: { shelf: "owned", readingStatus: "read" },
    });
  });

  it("B-506: Infinity Machine (Mallaby) never matches Infinite Machine (Russo)", () => {
    const russo = card("W506", "wishlist", {
      title: "The Infinite Machine",
      author: "Camila Russo",
    });
    const n = note("K506", "The Infinity Machine", { author: "Sebastian Mallaby" });
    const r = reconcileKindleNotes([n], [russo]);
    expect(r.toCreate).toBe(1);
    expect(r.actions).toEqual([
      {
        type: "create",
        book: {
          asin: "K506",
          title: "The Infinity Machine",
          author: "Sebastian Mallaby",
          shelf: "owned",
        },
        source: "kindle-notebook",
        seed: {
          readingStatus: "read",
          hasHighlights: true,
          highlightsNote: "[[Inbox/Kindle/The Infinity Machine]]",
        },
      },
    ]);
  });

  it("same main title but different authors → no match, creates a new card", () => {
    const c = card("W1", "wishlist", {
      title: "Revolution: A History",
      author: "Alice Smith",
    });
    const n = note("K1", "Revolution: My Story", { author: "Bob Jones" });
    const r = reconcileKindleNotes([n], [c]);
    expect(r.toCreate).toBe(1);
    expect(r.actions[0]?.type).toBe("create");
  });

  it("main-title equality with a missing author → tier 3 unavailable → create", () => {
    const cardNoAuthor = card("W2", "wishlist", { title: "Revolution: A History" });
    const n = note("K2", "Revolution: My Story", { author: "Bob Jones" });
    expect(reconcileKindleNotes([n], [cardNoAuthor]).toCreate).toBe(1);

    const cardWithAuthor = card("W3", "wishlist", {
      title: "Revolution: A History",
      author: "Bob Jones",
    });
    const noteNoAuthor = note("K3", "Revolution: My Story");
    expect(reconcileKindleNotes([noteNoAuthor], [cardWithAuthor]).toCreate).toBe(1);
  });

  it("full-title equality with a missing author → match (tier 2 allows it)", () => {
    const c = card("W4", "wishlist", { title: "Deep Work" });
    const n = note("K4", "Deep Work", { author: "Cal Newport" });
    const r = reconcileKindleNotes([n], [c]);
    expect(r.matchedByTitle).toBe(1);
    expect(r.actions[0]?.type).toBe("update-machine");
  });
});

describe("reconcileKindleNotes — ambiguity", () => {
  it("duplicate wishlist cards for the same book → ambiguous, no action", () => {
    const c1 = card("W5", "wishlist", {
      title: "A Time of Gifts",
      author: "Patrick Leigh Fermor",
      sourcePath: "Books/Wishlist/A Time of Gifts.md",
    });
    const c2 = card("W6", "wishlist", {
      title: "A Time of Gifts",
      author: "Patrick Leigh Fermor",
      sourcePath: "Books/Wishlist/A Time of Gifts 1.md",
    });
    const n = note("K5", "A Time of Gifts", { author: "Patrick Leigh Fermor" });
    const r = reconcileKindleNotes([n], [c1, c2]);
    expect(r.actions).toEqual([]);
    expect(r.ambiguous).toEqual([
      {
        notePath: "Inbox/Kindle/A Time of Gifts.md",
        title: "A Time of Gifts",
        candidatePaths: [
          "Books/Wishlist/A Time of Gifts.md",
          "Books/Wishlist/A Time of Gifts 1.md",
        ],
        tier: "title-full",
      },
    ]);
  });

  it("two cards sharing an ASIN → ambiguous", () => {
    const c1 = card("B10", "wishlist", { sourcePath: "Books/a.md" });
    const c2 = card("B10", "owned", { sourcePath: "Books/b.md" });
    const r = reconcileKindleNotes([note("B10", "X")], [c1, c2]);
    expect(r.actions).toEqual([]);
    expect(r.ambiguous[0]?.tier).toBe("asin");
  });

  it("two notes claiming the same card → second is ambiguous, never last-write-wins", () => {
    const c = card("W11", "wishlist", { title: "Cryptonomicon", author: "Neal Stephenson" });
    const n1 = note("K11", "Cryptonomicon", { author: "Neal Stephenson" });
    const n2 = note("K12", "Cryptonomicon", {
      author: "Neal Stephenson",
      notePath: "Inbox/Kindle/Cryptonomicon 1.md",
    });
    const r = reconcileKindleNotes([n1, n2], [c]);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]?.type).toBe("update-machine");
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]?.notePath).toBe("Inbox/Kindle/Cryptonomicon 1.md");
  });
});

describe("reconcileKindleNotes — emitted changes", () => {
  it("unread wishlist card gets the full upgrade, including wishlistRemoved cleanup", () => {
    const c = card("B20", "wishlist", { wishlistRemoved: true });
    const n = note("B20", "X");
    const r = reconcileKindleNotes([n], [c]);
    expect(r.actions).toEqual([
      {
        type: "update-machine",
        sourcePath: "Books/B20.md",
        asin: "B20",
        changes: {
          hasHighlights: true,
          highlightsNote: "[[Inbox/Kindle/X]]",
          shelf: "owned",
          wishlistRemoved: null,
          readingStatus: "read",
        },
      },
    ]);
  });

  it("readingStatus is upgrade-only: reading and abandoned stay untouched", () => {
    for (const status of ["reading", "abandoned"] as const) {
      const c = card("B21", "owned", { readingStatus: status });
      const r = reconcileKindleNotes([note("B21", "X")], [c]);
      expect(r.actions).toEqual([
        {
          type: "update-machine",
          sourcePath: "Books/B21.md",
          asin: "B21",
          changes: { hasHighlights: true, highlightsNote: "[[Inbox/Kindle/X]]" },
        },
      ]);
    }
  });

  it("sample shelf keeps its shelf but gets highlights + read", () => {
    const c = card("B22", "sample");
    const r = reconcileKindleNotes([note("B22", "X")], [c]);
    expect(r.actions[0]).toMatchObject({
      changes: {
        hasHighlights: true,
        highlightsNote: "[[Inbox/Kindle/X]]",
        readingStatus: "read",
      },
    });
    const action = r.actions[0];
    if (action?.type !== "update-machine") throw new Error("expected update");
    expect(action.changes.shelf).toBeUndefined();
  });

  it("is idempotent: a fully reconciled card yields skip / unchanged", () => {
    const c = card("B23", "owned", {
      readingStatus: "read",
      hasHighlights: true,
      highlightsNote: "[[Inbox/Kindle/X]]",
    });
    const r = reconcileKindleNotes([note("B23", "X")], [c]);
    expect(r.actions).toEqual([{ type: "skip", asin: "B23" }]);
    expect(r.unchanged).toBe(1);
    expect(r.matchedByAsin).toBe(0);
  });

  it("second run over the applied state emits only skips", () => {
    const original = card("B24", "wishlist");
    const n = note("B24", "X");
    const first = reconcileKindleNotes([n], [original]);
    const action = first.actions[0];
    if (action?.type !== "update-machine") throw new Error("expected update");
    const applied: BookCard = {
      ...original,
      shelf: action.changes.shelf ?? original.shelf,
      readingStatus: action.changes.readingStatus ?? original.readingStatus,
      hasHighlights: action.changes.hasHighlights ?? original.hasHighlights,
    };
    if (action.changes.highlightsNote) applied.highlightsNote = action.changes.highlightsNote;
    const second = reconcileKindleNotes([n], [applied]);
    expect(second.actions).toEqual([{ type: "skip", asin: "B24" }]);
    expect(second.unchanged).toBe(1);
  });

  it("unmatched note creates an owned+read card seeded from the note metadata", () => {
    const n = note("K30", "Brand New Book", {
      author: "Some Author",
      cover: "https://img/c.jpg",
      url: "https://read.amazon.com/notebook?asin=K30",
      highlightCount: 12,
    });
    const r = reconcileKindleNotes([n], []);
    expect(r.actions).toEqual([
      {
        type: "create",
        book: {
          asin: "K30",
          title: "Brand New Book",
          author: "Some Author",
          cover: "https://img/c.jpg",
          url: "https://read.amazon.com/notebook?asin=K30",
          shelf: "owned",
        },
        source: "kindle-notebook",
        seed: {
          readingStatus: "read",
          hasHighlights: true,
          highlightsNote: "[[Inbox/Kindle/Brand New Book]]",
        },
      },
    ]);
  });
});
