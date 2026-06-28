import { describe, expect, it } from "vitest";

import {
  addToUrlIndex,
  canonicalizeUrl,
  findDuplicate,
  type UrlIndex,
} from "../src/url-canon";

describe("canonicalizeUrl", () => {
  it("returns '' for empty/whitespace input", () => {
    expect(canonicalizeUrl("")).toBe("");
    expect(canonicalizeUrl("   ")).toBe("");
  });

  it("lowercases host and strips www", () => {
    expect(canonicalizeUrl("https://WWW.Example.com/Post")).toBe(
      "https://example.com/Post",
    );
  });

  it("upgrades http to https so the scheme never splits a match", () => {
    expect(canonicalizeUrl("http://example.com/post")).toBe(
      canonicalizeUrl("https://example.com/post"),
    );
  });

  it("drops trailing slash and fragment", () => {
    expect(canonicalizeUrl("https://example.com/post/")).toBe(
      "https://example.com/post",
    );
    expect(canonicalizeUrl("https://example.com/post#section")).toBe(
      "https://example.com/post",
    );
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("strips utm_* and known tracking params but keeps real ones", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/post?utm_source=tw&utm_medium=x&id=42&fbclid=abc&ref=hn",
      ),
    ).toBe("https://example.com/post?id=42");
  });

  it("sorts remaining params so order does not split a match", () => {
    expect(canonicalizeUrl("https://example.com/p?b=2&a=1")).toBe(
      canonicalizeUrl("https://example.com/p?a=1&b=2"),
    );
  });

  it("collapses the same article arriving with different tracking", () => {
    const a = canonicalizeUrl(
      "http://www.example.com/post/?utm_campaign=newsletter",
    );
    const b = canonicalizeUrl("https://example.com/post");
    expect(a).toBe(b);
  });

  it("keys tweets by numeric id across mirror domains and handles", () => {
    const key = "tweet:123";
    expect(canonicalizeUrl("https://twitter.com/jack/status/123")).toBe(key);
    expect(canonicalizeUrl("https://x.com/jack/status/123")).toBe(key);
    expect(canonicalizeUrl("https://fxtwitter.com/jack/status/123")).toBe(key);
    expect(canonicalizeUrl("https://x.com/OTHER_HANDLE/status/123")).toBe(key);
  });

  it("falls back to the lowercased raw string for non-http(s)", () => {
    expect(canonicalizeUrl("MAILTO:Foo@Bar.com")).toBe("mailto:foo@bar.com");
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("addToUrlIndex + findDuplicate", () => {
  const note = (
    path: string,
    status: string,
    readAt?: string,
  ): { path: string; title: string; status: string; readAt?: string } => ({
    path,
    title: path,
    status,
    ...(readAt ? { readAt } : {}),
  });

  it("finds a duplicate ignoring tracking params", () => {
    const index: UrlIndex = new Map();
    addToUrlIndex(
      index,
      "https://example.com/post",
      note("read/post.md", "read", "2026-05-01T00:00:00Z"),
    );
    const hit = findDuplicate(
      "https://www.example.com/post/?utm_source=x",
      index,
    );
    expect(hit?.path).toBe("read/post.md");
    expect(hit?.status).toBe("read");
  });

  it("returns undefined when nothing matches", () => {
    const index: UrlIndex = new Map();
    addToUrlIndex(index, "https://example.com/a", note("a.md", "unread"));
    expect(findDuplicate("https://example.com/b", index)).toBeUndefined();
  });

  it("prefers the read note when a URL exists both read and unread", () => {
    const index: UrlIndex = new Map();
    addToUrlIndex(index, "https://example.com/p", note("queue/p.md", "unread"));
    addToUrlIndex(
      index,
      "https://example.com/p",
      note("read/p.md", "read", "2026-05-02T00:00:00Z"),
    );
    expect(findDuplicate("https://example.com/p", index)?.status).toBe("read");
  });

  it("does not downgrade a read entry to a later unread one", () => {
    const index: UrlIndex = new Map();
    addToUrlIndex(index, "https://example.com/p", note("read/p.md", "read"));
    addToUrlIndex(index, "https://example.com/p", note("queue/p.md", "unread"));
    expect(findDuplicate("https://example.com/p", index)?.path).toBe(
      "read/p.md",
    );
  });

  it("ignores URLs that canonicalize to ''", () => {
    const index: UrlIndex = new Map();
    addToUrlIndex(index, "", note("x.md", "read"));
    expect(index.size).toBe(0);
  });
});
