import { describe, expect, it } from "vitest";

import {
  forgetScroll,
  isEndOfArticle,
  rememberScroll,
  scrollRatio,
  shouldRestoreScroll,
  type ScrollEntry,
  type ScrollStore,
} from "../src/scroll-memory";

const entry = (scroll: number, updatedAt: number, ratio?: number): ScrollEntry =>
  ratio === undefined ? { scroll, updatedAt } : { scroll, updatedAt, ratio };

describe("rememberScroll", () => {
  it("upserts an entry without mutating the original store", () => {
    const store: ScrollStore = { "a.md": entry(10, 1) };
    const next = rememberScroll(store, "b.md", entry(20, 2));
    expect(next["a.md"]?.scroll).toBe(10);
    expect(next["b.md"]?.scroll).toBe(20);
    expect(store["b.md"]).toBeUndefined();
  });

  it("overwrites an existing path", () => {
    const store: ScrollStore = { "a.md": entry(10, 1) };
    const next = rememberScroll(store, "a.md", entry(99, 2));
    expect(next["a.md"]?.scroll).toBe(99);
    expect(Object.keys(next)).toHaveLength(1);
  });

  it("evicts the least-recently-updated entries beyond the cap", () => {
    let store: ScrollStore = {};
    for (let i = 0; i < 5; i++) {
      store = rememberScroll(store, `n${i}.md`, entry(i + 1, i), 5);
    }
    const next = rememberScroll(store, "new.md", entry(50, 100), 5);
    expect(Object.keys(next)).toHaveLength(5);
    expect(next["n0.md"]).toBeUndefined(); // oldest evicted
    expect(next["new.md"]?.scroll).toBe(50);
    expect(next["n4.md"]?.scroll).toBe(5);
  });

  it("never evicts the entry being written even if it is the oldest", () => {
    let store: ScrollStore = {};
    for (let i = 0; i < 5; i++) {
      store = rememberScroll(store, `n${i}.md`, entry(i + 1, i + 10), 5);
    }
    // updatedAt 0 = older than everything else in the store
    const next = rememberScroll(store, "old-but-new.md", entry(7, 0), 5);
    expect(next["old-but-new.md"]?.scroll).toBe(7);
    expect(Object.keys(next)).toHaveLength(5);
  });
});

describe("forgetScroll", () => {
  it("removes the entry", () => {
    const store: ScrollStore = { "a.md": entry(10, 1), "b.md": entry(5, 2) };
    const next = forgetScroll(store, "a.md");
    expect(next["a.md"]).toBeUndefined();
    expect(next["b.md"]?.scroll).toBe(5);
  });

  it("returns the same store when the path is absent", () => {
    const store: ScrollStore = { "a.md": entry(10, 1) };
    expect(forgetScroll(store, "missing.md")).toBe(store);
  });
});

describe("shouldRestoreScroll", () => {
  it("rejects undefined and zero/negative scroll", () => {
    expect(shouldRestoreScroll(undefined)).toBe(false);
    expect(shouldRestoreScroll(entry(0, 1, 0.5))).toBe(false);
    expect(shouldRestoreScroll(entry(-3, 1, 0.5))).toBe(false);
  });

  it("uses the ratio when available: >= 10% restores, below does not", () => {
    expect(shouldRestoreScroll(entry(5, 1, 0.09))).toBe(false);
    expect(shouldRestoreScroll(entry(5, 1, 0.1))).toBe(true);
    expect(shouldRestoreScroll(entry(5, 1, 0.85))).toBe(true);
  });

  it("falls back to an absolute line threshold without ratio", () => {
    expect(shouldRestoreScroll(entry(19, 1))).toBe(false);
    expect(shouldRestoreScroll(entry(20, 1))).toBe(true);
  });
});

describe("scrollRatio", () => {
  it("computes progress over the scrollable range", () => {
    expect(scrollRatio(0, 500, 1000)).toBe(0);
    expect(scrollRatio(250, 500, 1000)).toBe(0.5);
    expect(scrollRatio(500, 500, 1000)).toBe(1);
  });

  it("clamps to 0..1", () => {
    expect(scrollRatio(-10, 500, 1000)).toBe(0);
    expect(scrollRatio(900, 500, 1000)).toBe(1);
  });

  it("treats non-scrollable content as fully read", () => {
    expect(scrollRatio(0, 800, 400)).toBe(1);
    expect(scrollRatio(0, 800, 800)).toBe(1);
  });
});

describe("isEndOfArticle", () => {
  it("triggers at the ~97% threshold", () => {
    // range = 1000; 97% = 970
    expect(isEndOfArticle(969, 500, 1500)).toBe(false);
    expect(isEndOfArticle(970, 500, 1500)).toBe(true);
    expect(isEndOfArticle(1000, 500, 1500)).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(isEndOfArticle(500, 500, 1500, 0.5)).toBe(true);
    expect(isEndOfArticle(499, 500, 1500, 0.5)).toBe(false);
  });
});
