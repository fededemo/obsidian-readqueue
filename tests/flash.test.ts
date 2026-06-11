import { describe, expect, it } from "vitest";

import { findHighlightElement } from "../src/flash";

function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("findHighlightElement", () => {
  it("finds the mark whose text matches exactly", () => {
    const root = container(
      "<p>before <mark>uno</mark> middle <mark>dos tres</mark> after</p>",
    );
    const el = findHighlightElement(root, "dos tres");
    expect(el?.textContent).toBe("dos tres");
  });

  it("is whitespace- and case-insensitive", () => {
    const root = container("<p><mark>Hello   World</mark></p>");
    const el = findHighlightElement(root, "hello world");
    expect(el).toBeDefined();
  });

  it("falls back to containment when the renderer splits the text", () => {
    const root = container("<p><mark>only the first part</mark></p>");
    const el = findHighlightElement(
      root,
      "only the first part of a longer highlight",
    );
    expect(el?.textContent).toBe("only the first part");
  });

  it("returns undefined when nothing matches (silent degradation)", () => {
    const root = container("<p><mark>algo</mark></p>");
    expect(findHighlightElement(root, "otra cosa distinta")).toBeUndefined();
    expect(findHighlightElement(root, "")).toBeUndefined();
    expect(findHighlightElement(container("<p>no marks</p>"), "x")).toBeUndefined();
  });
});
