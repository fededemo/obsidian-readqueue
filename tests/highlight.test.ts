import { describe, expect, it } from "vitest";

import {
  applyHighlight,
  locateSelection,
  locateSelectionInSource,
  normalizeSelectedText,
  stripMarkdownToPlain,
} from "../src/highlight";

function highlightResult(
  source: string,
  selected: string,
  hint?: { before: string; after: string },
  note?: string,
): string | null {
  const range = locateSelectionInSource(source, selected, hint);
  if (!range) return null;
  return applyHighlight(source, range, note);
}

describe("normalizeSelectedText", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeSelectedText("  foo \n\n bar\tbaz ")).toBe("foo bar baz");
  });
});

describe("stripMarkdownToPlain", () => {
  it("maps plain offsets back to source offsets", () => {
    const { plain, map } = stripMarkdownToPlain("a **b** c");
    expect(plain).toBe("a b c");
    expect(map[2]).toBe(4); // 'b' lives at source index 4
  });

  it("skips frontmatter entirely", () => {
    const src = "---\ntitle: Secret phrase\n---\n\nBody text.";
    const { plain } = stripMarkdownToPlain(src);
    expect(plain).not.toContain("Secret");
    expect(plain).toContain("Body text.");
  });

  it("records highlight marker positions", () => {
    const { highlightMarkers } = stripMarkdownToPlain("a ==b== c");
    expect(highlightMarkers).toEqual([2, 5]);
  });

  it("keeps inline code content verbatim", () => {
    const { plain } = stripMarkdownToPlain("run `a*b` now");
    expect(plain).toBe("run a*b now");
  });

  it("drops %%comments%%", () => {
    const { plain } = stripMarkdownToPlain("visible %%hidden%% more");
    expect(plain).toBe("visible more");
  });
});

describe("locateSelectionInSource — simple matches", () => {
  it("finds a literal fragment", () => {
    const src = "Hello brave world today";
    expect(locateSelectionInSource(src, "brave world")).toEqual({
      start: 6,
      end: 17,
    });
  });

  it("matches across a soft line break (collapsed whitespace)", () => {
    const src = "One sentence\ncontinues on the next line.";
    const out = highlightResult(src, "sentence continues on");
    expect(out).toBe("One ==sentence\ncontinues on== the next line.");
  });

  it("matches when DOM selection has extra whitespace", () => {
    const src = "alpha beta gamma";
    expect(locateSelectionInSource(src, "  beta \n gamma ")).toEqual({
      start: 6,
      end: 16,
    });
  });

  it("handles regex-special characters literally", () => {
    const src = "price is $5.00 (approx) total";
    const out = highlightResult(src, "$5.00 (approx)");
    expect(out).toBe("price is ==$5.00 (approx)== total");
  });

  it("handles tildes and eñes", () => {
    const src = "Mañana habrá función de cine";
    const out = highlightResult(src, "habrá función");
    expect(out).toBe("Mañana ==habrá función== de cine");
  });
});

describe("locateSelectionInSource — markdown in between", () => {
  it("matches through **bold** markers", () => {
    const src = "this is **bold** text here";
    const out = highlightResult(src, "is bold text");
    expect(out).toBe("this ==is **bold** text== here");
  });

  it("wraps a whole bold span outside its markers", () => {
    const src = "this is **bold** text here";
    const out = highlightResult(src, "bold");
    expect(out).toBe("this is ==**bold**== text here");
  });

  it("matches through *italic* markers", () => {
    const src = "an *italic* word";
    const out = highlightResult(src, "an italic word");
    expect(out).toBe("==an *italic* word==");
  });

  it("matches markers glued to a word (mid-token)", () => {
    const src = "**Anthropic**'s growth";
    const out = highlightResult(src, "Anthropic's");
    expect(out).toBe("==**Anthropic**'s== growth");
  });

  it("highlights link text inside the link", () => {
    const src = "see [the docs](https://example.com/a) now";
    const out = highlightResult(src, "the docs");
    expect(out).toBe("see [==the docs==](https://example.com/a) now");
  });

  it("swallows the whole link when the selection crosses its boundary", () => {
    const src = "see [the docs](https://example.com/a) now";
    const out = highlightResult(src, "see the docs");
    expect(out).toBe("==see [the docs](https://example.com/a)== now");
  });

  it("wraps inline code outside its backticks", () => {
    const src = "run `npm install` first";
    const out = highlightResult(src, "npm install");
    expect(out).toBe("run ==`npm install`== first");
  });

  it("keeps escape backslashes attached", () => {
    const src = "a \\*literal\\* b";
    const out = highlightResult(src, "*literal*");
    expect(out).toBe("a ==\\*literal\\*== b");
  });

  it("matches inside a heading", () => {
    const src = "# Big Title\n\nBody.";
    const out = highlightResult(src, "Big Title");
    expect(out).toBe("# ==Big Title==\n\nBody.");
  });

  it("matches inside a list item (bullet stripped)", () => {
    const src = "# T\n\n- first item\n- second item\n";
    const out = highlightResult(src, "first item");
    expect(out).toBe("# T\n\n- ==first item==\n- second item\n");
  });
});

describe("locateSelectionInSource — disambiguation", () => {
  const src = "alpha target beta\n\ngamma target delta";

  it("returns null when ambiguous and no hint given", () => {
    expect(locateSelectionInSource(src, "target")).toBeNull();
    const res = locateSelection(src, "target");
    expect(res).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("picks the right occurrence using surrounding context", () => {
    const out = highlightResult(src, "target", {
      before: "gamma ",
      after: " delta",
    });
    expect(out).toBe("alpha target beta\n\ngamma ==target== delta");
  });

  it("picks the first occurrence when context points there", () => {
    const out = highlightResult(src, "target", {
      before: "alpha ",
      after: " beta",
    });
    expect(out).toBe("alpha ==target== beta\n\ngamma target delta");
  });

  it("returns null when context cannot break the tie", () => {
    const tied = "x foo y\n\nx foo y";
    const res = locateSelection(tied, "foo", { before: "x ", after: " y" });
    expect(res).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("locateSelectionInSource — rejections", () => {
  it("rejects empty selection", () => {
    expect(locateSelection("body", "")).toEqual({ ok: false, reason: "empty" });
    expect(locateSelection("body", "  \n ")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(locateSelectionInSource("body", "")).toBeNull();
  });

  it("rejects text not present in source", () => {
    expect(locateSelection("hello world", "zzz")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("rejects frontmatter-only matches", () => {
    const src = "---\ntitle: Secret phrase\n---\n\nBody with phrase here.";
    expect(locateSelection(src, "Secret phrase")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("still matches body text after frontmatter with correct offsets", () => {
    const src = "---\ntitle: Secret phrase\n---\n\nBody with phrase here.";
    const out = highlightResult(src, "phrase here");
    expect(out).toBe(
      "---\ntitle: Secret phrase\n---\n\nBody with ==phrase here==.",
    );
  });

  it("rejects selections spanning multiple paragraphs", () => {
    const src = "Para one end.\n\nPara two start.";
    expect(locateSelection(src, "end. Para two")).toEqual({
      ok: false,
      reason: "multi-block",
    });
  });

  it("rejects selections spanning two list items", () => {
    const src = "- first item\n- second item";
    expect(locateSelection(src, "item second")).toEqual({
      ok: false,
      reason: "multi-block",
    });
  });

  it("rejects selections leaking out of a heading", () => {
    const src = "# Title here\nBody right below.";
    expect(locateSelection(src, "here Body")).toEqual({
      ok: false,
      reason: "multi-block",
    });
  });

  it("rejects selections inside an existing highlight", () => {
    const src = "a ==already marked== b";
    expect(locateSelection(src, "already")).toEqual({
      ok: false,
      reason: "inside-highlight",
    });
  });

  it("rejects selections crossing a highlight boundary", () => {
    const src = "==marked== plus more";
    expect(locateSelection(src, "marked plus")).toEqual({
      ok: false,
      reason: "inside-highlight",
    });
  });

  it("does not match text hidden in %%comments%%", () => {
    const src = "visible %%hidden note%% more";
    expect(locateSelection(src, "hidden")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("applyHighlight", () => {
  it("wraps the range in ==...==", () => {
    expect(applyHighlight("Hello world", { start: 0, end: 5 })).toBe(
      "==Hello== world",
    );
  });

  it("appends the note as an Obsidian %%comment%%", () => {
    expect(applyHighlight("Hello world", { start: 0, end: 5 }, "key idea")).toBe(
      "==Hello== %%key idea%% world",
    );
  });

  it("strips %% from the note so it cannot break the comment", () => {
    expect(applyHighlight("Hello world", { start: 0, end: 5 }, "a %% b")).toBe(
      "==Hello== %%a  b%% world",
    );
  });

  it("ignores an empty note", () => {
    expect(applyHighlight("Hello world", { start: 0, end: 5 }, "  ")).toBe(
      "==Hello== world",
    );
  });

  it("trims whitespace at range edges so markers render", () => {
    expect(applyHighlight("Hello world", { start: 5, end: 11 })).toBe(
      "Hello ==world==",
    );
  });

  it("returns source untouched for whitespace-only ranges", () => {
    expect(applyHighlight("a  b", { start: 1, end: 3 })).toBe("a  b");
  });
});

describe("end-to-end: locate + apply", () => {
  it("highlight with note lands after the closing markers", () => {
    const src = "Intro. The key insight is simple. Outro.";
    const out = highlightResult(src, "key insight", undefined, "volver acá");
    expect(out).toBe(
      "Intro. The ==key insight== %%volver acá%% is simple. Outro.",
    );
  });

  it("second highlight in the same paragraph still works", () => {
    const src = "==first== part and second part";
    const out = highlightResult(src, "second part");
    expect(out).toBe("==first== part and ==second part==");
  });
});
