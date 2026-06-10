import { describe, expect, it } from "vitest";

import {
  buildDigestHighlightsSection,
  classifyArticleSource,
  digestHasHighlightsSection,
  extractHighlights,
  pickDailyHighlights,
  rngFromSeed,
  type ArticleSource,
  type ExtractedHighlight,
} from "../src/highlights-data";

const WEB_META = {
  sourcePath: "Inbox/Web/articulo.md",
  title: "Un artículo",
  source: "web-clipper",
};

const KINDLE_META = {
  sourcePath: "Inbox/Kindle/libro.md",
  title: "Un libro",
  source: "kindle-scrape",
};

describe("classifyArticleSource", () => {
  it("maps known sources", () => {
    expect(classifyArticleSource("kindle-scrape")).toBe("kindle");
    expect(classifyArticleSource("matter-legacy")).toBe("matter");
    expect(classifyArticleSource("web-clipper")).toBe("web");
    expect(classifyArticleSource("intake-defuddle")).toBe("web");
    expect(classifyArticleSource(undefined)).toBe("web");
  });
});

describe("extractHighlights — inline", () => {
  it("extracts a plain inline highlight", () => {
    const md = "Intro.\n\nUna idea ==clave del texto== que sigue.\n";
    const hs = extractHighlights(md, WEB_META);
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({
      text: "clave del texto",
      kind: "inline",
      sourcePath: "Inbox/Web/articulo.md",
      title: "Un artículo",
      articleSource: "web",
      line: 2,
    });
    expect(hs[0]?.note).toBeUndefined();
  });

  it("captures the adjacent %%note%%", () => {
    const md = "Texto ==subrayado== %%mi comentario%% y más.\n";
    const hs = extractHighlights(md, WEB_META);
    expect(hs).toHaveLength(1);
    expect(hs[0]?.note).toBe("mi comentario");
  });

  it("extracts multiple highlights per file and per line", () => {
    const md = [
      "==uno== y después ==dos== en la misma línea.",
      "",
      "Otra línea con ==tres==.",
    ].join("\n");
    const hs = extractHighlights(md, WEB_META);
    expect(hs.map((h) => h.text)).toEqual(["uno", "dos", "tres"]);
  });

  it("ignores == inside fenced code blocks", () => {
    const md = [
      "Antes ==real==.",
      "```js",
      "if (a ==b== c) {}",
      "```",
      "Después.",
    ].join("\n");
    const hs = extractHighlights(md, WEB_META);
    expect(hs.map((h) => h.text)).toEqual(["real"]);
  });

  it("ignores == inside inline code spans", () => {
    const md = "Usá `a ==b== c` pero ==esto sí== cuenta.\n";
    const hs = extractHighlights(md, WEB_META);
    expect(hs.map((h) => h.text)).toEqual(["esto sí"]);
  });

  it("skips frontmatter", () => {
    const md = [
      "---",
      "title: ==no es highlight==",
      "---",
      "",
      "Cuerpo ==sí==.",
    ].join("\n");
    const hs = extractHighlights(md, WEB_META);
    expect(hs.map((h) => h.text)).toEqual(["sí"]);
    expect(hs[0]?.line).toBe(4);
  });

  it("returns empty for content without highlights", () => {
    expect(extractHighlights("Nada que ver acá.\n", WEB_META)).toEqual([]);
  });
});

describe("extractHighlights — ## Highlights section", () => {
  it("extracts blockquotes with location and note (kindle format)", () => {
    const md = [
      "---",
      "source: kindle-scrape",
      "---",
      "",
      "# Un libro",
      "",
      "## Highlights",
      "",
      "> Primer highlight del libro.",
      "*Location 123*",
      "",
      "📝 nota del lector",
      "",
      "> Segundo highlight",
      "> que sigue en otra línea.",
      "*Location 456*",
      "",
    ].join("\n");
    const hs = extractHighlights(md, KINDLE_META);
    expect(hs).toHaveLength(2);
    expect(hs[0]).toMatchObject({
      text: "Primer highlight del libro.",
      location: "Location 123",
      note: "nota del lector",
      kind: "section",
      articleSource: "kindle",
      line: 8,
    });
    expect(hs[1]).toMatchObject({
      text: "Segundo highlight\nque sigue en otra línea.",
      location: "Location 456",
    });
    expect(hs[1]?.note).toBeUndefined();
  });

  it("extracts bare blockquotes (matter format) without location/note", () => {
    const md = [
      "# Título",
      "",
      "## Highlights",
      "",
      "> Solo el texto.",
      "",
      "> Otro más.",
    ].join("\n");
    const hs = extractHighlights(md, {
      sourcePath: "Inbox/Legacy/nota.md",
      title: "Nota",
      source: "matter-legacy",
    });
    expect(hs.map((h) => h.text)).toEqual(["Solo el texto.", "Otro más."]);
    expect(hs.every((h) => h.articleSource === "matter")).toBe(true);
    expect(hs.every((h) => h.location === undefined)).toBe(true);
  });

  it("returns empty when there is no ## Highlights section", () => {
    const md = "# Título\n\n> blockquote suelto fuera de sección.\n";
    expect(extractHighlights(md, KINDLE_META)).toEqual([]);
  });

  it("stops the section at the next heading", () => {
    const md = [
      "## Highlights",
      "",
      "> dentro.",
      "",
      "## Otra sección",
      "",
      "> fuera.",
    ].join("\n");
    const hs = extractHighlights(md, KINDLE_META);
    expect(hs.map((h) => h.text)).toEqual(["dentro."]);
  });
});

describe("extractHighlights — mixed", () => {
  it("combines inline and section highlights without double-counting", () => {
    const md = [
      "Cuerpo con ==inline uno== acá.",
      "",
      "## Highlights",
      "",
      "> Con ==marcas== adentro del blockquote.",
      "",
    ].join("\n");
    const hs = extractHighlights(md, WEB_META);
    expect(hs).toHaveLength(2);
    const kinds = hs.map((h) => h.kind).sort();
    expect(kinds).toEqual(["inline", "section"]);
  });
});

// --- daily selection --------------------------------------------------------

function fakeHighlight(
  i: number,
  articleSource: ArticleSource,
): ExtractedHighlight {
  return {
    text: `highlight ${articleSource} ${i}`,
    kind: "inline",
    line: i,
    sourcePath: `Inbox/${articleSource}/${i}.md`,
    title: `nota ${i}`,
    articleSource,
  };
}

function corpus(): ExtractedHighlight[] {
  const out: ExtractedHighlight[] = [];
  for (let i = 0; i < 20; i++) out.push(fakeHighlight(i, "web"));
  for (let i = 0; i < 20; i++) out.push(fakeHighlight(i, "kindle"));
  for (let i = 0; i < 20; i++) out.push(fakeHighlight(i, "matter"));
  return out;
}

describe("pickDailyHighlights", () => {
  it("same seed → same selection", () => {
    const a = pickDailyHighlights(corpus(), 5, rngFromSeed("2026-06-10"));
    const b = pickDailyHighlights(corpus(), 5, rngFromSeed("2026-06-10"));
    expect(a.map((h) => h.text)).toEqual(b.map((h) => h.text));
  });

  it("different seeds → different selections (statistically)", () => {
    const seeds = ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13"];
    const selections = seeds.map((s) =>
      pickDailyHighlights(corpus(), 5, rngFromSeed(s))
        .map((h) => h.text)
        .join("|"),
    );
    expect(new Set(selections).size).toBeGreaterThan(1);
  });

  it("N greater than total → returns everything", () => {
    const few = corpus().slice(0, 3);
    const picks = pickDailyHighlights(few, 10, rngFromSeed("2026-06-10"));
    expect(picks).toHaveLength(3);
  });

  it("weights source variety: one per source per lap", () => {
    const picks = pickDailyHighlights(corpus(), 3, rngFromSeed("2026-06-10"));
    const sources = new Set(picks.map((h) => h.articleSource));
    expect(sources).toEqual(new Set(["web", "kindle", "matter"]));
  });

  it("count <= 0 → empty", () => {
    expect(pickDailyHighlights(corpus(), 0, rngFromSeed("x"))).toEqual([]);
  });
});

describe("digest section helpers", () => {
  it("builds blockquote + wikilink per pick", () => {
    const lines = buildDigestHighlightsSection([
      fakeHighlight(1, "web"),
      fakeHighlight(2, "kindle"),
    ]);
    expect(lines[0]).toBe("## Highlights para repasar");
    expect(lines).toContain("> highlight web 1");
    expect(lines).toContain("> — [[1]]");
    expect(lines).toContain("> — [[2]]");
  });

  it("multi-line text stays inside the blockquote", () => {
    const h = { ...fakeHighlight(1, "web"), text: "línea uno\nlínea dos" };
    const lines = buildDigestHighlightsSection([h]);
    expect(lines).toContain("> línea uno");
    expect(lines).toContain("> línea dos");
  });

  it("digestHasHighlightsSection detects the heading", () => {
    expect(digestHasHighlightsSection("# x\n\n## Highlights para repasar\n")).toBe(
      true,
    );
    expect(digestHasHighlightsSection("# x\n\n## Highlights\n")).toBe(false);
  });
});
