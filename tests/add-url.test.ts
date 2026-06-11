import { describe, expect, it } from "vitest";

import { looksLikeUrl, normalizeUrlInput } from "../src/add-url";

describe("normalizeUrlInput", () => {
  it("accepts http/https URLs as-is", () => {
    expect(normalizeUrlInput("https://example.com/post")).toBe(
      "https://example.com/post",
    );
    expect(normalizeUrlInput("http://example.com/a?b=1#c")).toBe(
      "http://example.com/a?b=1#c",
    );
  });

  it("trims whitespace and angle brackets", () => {
    expect(normalizeUrlInput("  https://example.com/x  ")).toBe(
      "https://example.com/x",
    );
    expect(normalizeUrlInput("<https://example.com/x>")).toBe(
      "https://example.com/x",
    );
  });

  it("assumes https for scheme-less domain-like input", () => {
    expect(normalizeUrlInput("example.com/post")).toBe(
      "https://example.com/post",
    );
    expect(normalizeUrlInput("sub.example.co.uk")).toBe(
      "https://sub.example.co.uk/",
    );
  });

  it("rejects plain text, spaces, and empty input", () => {
    expect(normalizeUrlInput("")).toBeUndefined();
    expect(normalizeUrlInput("   ")).toBeUndefined();
    expect(normalizeUrlInput("hello world")).toBeUndefined();
    expect(normalizeUrlInput("nodotdomain")).toBeUndefined();
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeUrlInput("ftp://example.com/file")).toBeUndefined();
    expect(normalizeUrlInput("javascript:alert(1)")).toBeUndefined();
    expect(normalizeUrlInput("obsidian://open?vault=x")).toBeUndefined();
  });

  it("rejects URLs whose host has no dot", () => {
    expect(normalizeUrlInput("https://localhost/x")).toBeUndefined();
  });
});

describe("looksLikeUrl (clipboard prefill)", () => {
  it("requires an explicit http/https scheme", () => {
    expect(looksLikeUrl("https://example.com/post")).toBe(true);
    expect(looksLikeUrl("http://example.com")).toBe(true);
    expect(looksLikeUrl("example.com/post")).toBe(false);
    expect(looksLikeUrl("some random clipboard text")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(looksLikeUrl("  https://example.com  ")).toBe(true);
  });
});
