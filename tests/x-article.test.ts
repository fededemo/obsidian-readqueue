import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  articleImageFilename,
  isXArticleUrl,
  localizeRemoteImages,
  remoteImagesInMarkdown,
  xArticleImageAssets,
  xArticleToMarkdown,
  type XArticle,
} from "../src/x-article";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/x-article-fxtwitter.json"), "utf-8"),
) as XArticle;

describe("isXArticleUrl", () => {
  it("reconoce el formato largo de X y no un status", () => {
    expect(isXArticleUrl("http://x.com/i/article/2087564694706106372")).toBe(true);
    expect(isXArticleUrl("https://twitter.com/i/article/1")).toBe(true);
    expect(isXArticleUrl("https://x.com/ericzakariasson/status/2087566447178547494")).toBe(
      false,
    );
    expect(isXArticleUrl("https://x.com/ericzakariasson/article/2087566447178547494")).toBe(
      false,
    );
  });
});

describe("xArticleToMarkdown", () => {
  const md = xArticleToMarkdown(fixture);

  it("pone la portada, los headings y el cuerpo", () => {
    expect(md).toContain("![](https://pbs.twimg.com/media/HPiFEqUbgAAPjhB.png)");
    expect(md).toContain("## Information dense communication");
    expect(md).toContain("Grok 4.6 is out! I've used it for a few weeks as my daily driver.");
  });

  it("no duplica el título: eso lo pone quien arma la nota", () => {
    expect(md.startsWith("# ")).toBe(false);
    expect(md).not.toContain("# Grok 4.6");
  });

  it("resuelve links, bold, tweets embebidos, markdown y fotos", () => {
    expect(md).toContain(
      "[Cursor SDK Bridge](https://x.com/ericzakariasson/status/2085033378865451213)",
    );
    expect(md).toContain("**collaborative**");
    expect(md).toContain("[Tweet ↗](https://x.com/i/status/2087562800982077492)");
    expect(md).toContain("```\nBuild a polished Sheets app.\n```");
    expect(md).toContain("![](https://pbs.twimg.com/media/HPiGCR5a4AE-z6-.jpg)");
  });

  it("agrupa listas y respeta blockquotes", () => {
    expect(md).toContain("- first\n- second");
    expect(md).toContain("> a quoted line");
  });

  it("un artículo vacío no explota", () => {
    expect(xArticleToMarkdown({})).toBe("");
  });

  it("acepta entityMap como objeto, no solo como array de FxTwitter", () => {
    const mdObj = xArticleToMarkdown({
      content: {
        blocks: [
          {
            type: "unstyled",
            text: "see here",
            entityRanges: [{ key: "a", offset: 4, length: 4 }],
          },
        ],
        entityMap: {
          a: { type: "LINK", data: { url: "https://example.com" } },
        },
      },
    });
    expect(mdObj).toBe("see [here](https://example.com)");
  });

  it("embebe local cuando el resolver encuentra el archivo", () => {
    const mdLocal = xArticleToMarkdown(fixture, (a) => a.filename);
    expect(mdLocal).toContain("![[xa-HPiFEqUbgAAPjhB.png]]");
    expect(mdLocal).toContain("![[xa-HPiGCR5a4AE-z6-.jpg]]");
    expect(mdLocal).not.toContain("pbs.twimg.com");
  });
});

describe("article images", () => {
  it("nombra por el stem del CDN, con prefijo xa-", () => {
    expect(articleImageFilename("https://pbs.twimg.com/media/HPiFEqUbgAAPjhB.png")).toBe(
      "xa-HPiFEqUbgAAPjhB.png",
    );
    expect(
      articleImageFilename("https://pbs.twimg.com/media/HPiFEqUbgAAPjhB?format=png&name=large"),
    ).toBe("xa-HPiFEqUbgAAPjhB.png");
  });

  it("lista portada + media_entities sin duplicar", () => {
    const assets = xArticleImageAssets(fixture);
    expect(assets.map((a) => a.filename)).toEqual([
      "xa-HPiFEqUbgAAPjhB.png",
      "xa-HPiGCR5a4AE-z6-.jpg",
    ]);
  });

  it("localiza las remotas de una nota ya escrita, sin tocar las que faltan", () => {
    const md = "![](https://pbs.twimg.com/media/AAA.png)\n\n![](https://pbs.twimg.com/media/BBB.jpg)";
    const out = localizeRemoteImages(md, new Set(["xa-AAA.png"]));
    expect(out).toContain("![[xa-AAA.png]]");
    expect(out).toContain("![](https://pbs.twimg.com/media/BBB.jpg)");
    expect(localizeRemoteImages(out, new Set(["xa-AAA.png"]))).toBe(out);
  });

  it("extrae las remotas del markdown para bajarlas", () => {
    const md = xArticleToMarkdown(fixture);
    const remote = remoteImagesInMarkdown(md);
    expect(remote).toHaveLength(2);
    expect(remote[0]?.filename).toBe("xa-HPiFEqUbgAAPjhB.png");
  });
});
