import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildBookMarkdown,
  parseBookHighlights,
  parseLibrary,
  type KindleBook,
} from "../src/kindle";
import { parseArgs, run, type RunDeps } from "../scripts/sync-kindle";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, `fixtures/${name}`), "utf-8");

const parseDom = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

describe("parseLibrary", () => {
  it("extracts books with asin, title, author, cover", () => {
    const books = parseLibrary(fixture("kindle-library.html"), parseDom);
    expect(books).toHaveLength(3);
    expect(books[0]?.asin).toBe("B07JTHXNXX");
    expect(books[0]?.title).toBe("Atomic Habits");
    expect(books[0]?.author).toBe("James Clear");
    expect(books[0]?.coverUrl).toContain("cover1.jpg");
    expect(books[1]?.title).toBe("Thinking, Fast and Slow");
    expect(books[1]?.author).toBe("Daniel Kahneman");
  });

  it("returns empty array when no books in HTML", () => {
    expect(parseLibrary("<html><body></body></html>", parseDom)).toEqual([]);
  });

  it("ignores books with empty titles", () => {
    const html =
      '<div class="kp-notebook-library-each-book" data-asin="X"><h2 class="kp-notebook-searchable"></h2></div>';
    expect(parseLibrary(html, parseDom)).toEqual([]);
  });
});

describe("parseBookHighlights", () => {
  const book: KindleBook = {
    asin: "B07JTHXNXX",
    title: "Atomic Habits",
    author: "James Clear",
    coverUrl: undefined,
  };

  it("extracts highlight text and locations", () => {
    const data = parseBookHighlights(
      fixture("kindle-book-highlights.html"),
      book,
      parseDom,
    );
    expect(data.highlights).toHaveLength(3);
    expect(data.highlights[0]?.text).toContain("rise to the level of your goals");
    expect(data.highlights[0]?.location).toContain("Location 312");
  });

  it("captures notes when present", () => {
    const data = parseBookHighlights(
      fixture("kindle-book-highlights.html"),
      book,
      parseDom,
    );
    expect(data.highlights[1]?.note).toContain("identity-based habits");
    expect(data.highlights[0]?.note).toBeUndefined();
  });

  it("returns empty highlights when none in HTML", () => {
    const data = parseBookHighlights("<html><body></body></html>", book, parseDom);
    expect(data.highlights).toEqual([]);
    expect(data.book).toBe(book);
  });
});

describe("buildBookMarkdown", () => {
  const book: KindleBook = {
    asin: "B07JTHXNXX",
    title: "Atomic Habits",
    author: "James Clear",
    coverUrl: "https://m.media-amazon.com/images/I/cover1.jpg",
  };

  it("produces frontmatter with all expected fields", () => {
    const data = parseBookHighlights(
      fixture("kindle-book-highlights.html"),
      book,
      parseDom,
    );
    const md = buildBookMarkdown(data, "personal", new Date("2026-05-30T12:00:00Z"));
    expect(md.content).toContain("source: kindle-scrape");
    expect(md.content).toContain("title: Atomic Habits");
    expect(md.content).toContain("asin: B07JTHXNXX");
    expect(md.content).toContain("author: James Clear");
    expect(md.content).toContain("cover: https://m.media-amazon.com/images/I/cover1.jpg");
    expect(md.content).toContain("status: read");
    expect(md.content).toContain("topic: personal");
    expect(md.content).toContain("highlightCount: 3");
    expect(md.content).toContain("tags: [reader, kindle, legacy]");
  });

  it("body has title + author + Original link + highlights as blockquotes", () => {
    const data = parseBookHighlights(
      fixture("kindle-book-highlights.html"),
      book,
      parseDom,
    );
    const md = buildBookMarkdown(data, "personal");
    expect(md.content).toContain("# Atomic Habits");
    expect(md.content).toContain("> by James Clear");
    expect(md.content).toContain("[Original ↗](https://read.amazon.com/notebook?asin=B07JTHXNXX)");
    expect(md.content).toContain("## Highlights");
    expect(md.content).toContain("> You do not rise to the level of your goals");
    expect(md.content).toContain("📝 Important framing");
  });

  it("slug is filesystem-safe", () => {
    const data = parseBookHighlights(
      fixture("kindle-book-highlights.html"),
      book,
      parseDom,
    );
    const md = buildBookMarkdown(data, "personal");
    expect(md.slug).toMatch(/^atomic-habits-b07jthxnxx$/);
  });
});

describe("parseArgs", () => {
  it("requires --dest and one of --cookie/--cookie-file", () => {
    expect(() => parseArgs(["--cookie", "x"])).toThrow();
    expect(() => parseArgs(["--dest", "/x"])).toThrow();
  });

  it("parses required + optional flags", () => {
    const args = parseArgs([
      "--cookie",
      "session=abc",
      "--dest",
      "/dest",
      "--anthropic-key",
      "sk-ant",
      "--dry-run",
    ]);
    expect(args).toMatchObject({
      cookie: "session=abc",
      dest: "/dest",
      apiKey: "sk-ant",
      dryRun: true,
      force: false,
    });
  });

  it("--cookie-file is accepted in place of --cookie", () => {
    const args = parseArgs(["--cookie-file", "/c", "--dest", "/d"]);
    expect(args.cookieFile).toBe("/c");
  });

  it("throws on unknown flags", () => {
    expect(() =>
      parseArgs(["--cookie", "x", "--dest", "/x", "--weird"]),
    ).toThrow();
  });
});

describe("run", () => {
  function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps {
    const libHtml = fixture("kindle-library.html");
    const bookHtml = fixture("kindle-book-highlights.html");
    return {
      fetchUrl: async (url: string) => {
        if (url === "https://read.amazon.com/notebook") {
          return { status: 200, text: libHtml };
        }
        return { status: 200, text: bookHtml };
      },
      parseDom,
      writeFile: vi.fn().mockResolvedValue(undefined),
      exists: async () => false,
      mkdirp: async () => undefined,
      log: vi.fn(),
      now: () => new Date("2026-05-30T12:00:00Z"),
      classify: async () => "personal",
      ...overrides,
    };
  }

  it("writes a markdown file for each book", async () => {
    const deps = makeDeps();
    const summary = await run(
      {
        cookie: "session=x",
        dest: "/dest",
        apiKey: undefined,
        dryRun: false,
        force: false,
        cookieFile: undefined,
      },
      deps,
    );
    expect(summary.books).toBe(3);
    expect(summary.written).toBe(3);
    expect(summary.failed).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledTimes(3);
  });

  it("skips existing files without --force", async () => {
    const deps = makeDeps({ exists: async () => true });
    const summary = await run(
      {
        cookie: "session=x",
        dest: "/dest",
        apiKey: undefined,
        dryRun: false,
        force: false,
        cookieFile: undefined,
      },
      deps,
    );
    expect(summary.skipped).toBe(3);
    expect(summary.written).toBe(0);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("--dry-run does not call writeFile", async () => {
    const deps = makeDeps();
    const summary = await run(
      {
        cookie: "session=x",
        dest: "/dest",
        apiKey: undefined,
        dryRun: true,
        force: false,
        cookieFile: undefined,
      },
      deps,
    );
    expect(summary.written).toBe(3);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("throws when library fetch returns non-200 (expired cookie)", async () => {
    const deps = makeDeps({
      fetchUrl: async () => ({ status: 302, text: "" }),
    });
    await expect(
      run(
        {
          cookie: "session=expired",
          dest: "/dest",
          apiKey: undefined,
          dryRun: false,
          force: false,
          cookieFile: undefined,
        },
        deps,
      ),
    ).rejects.toThrow(/Library fetch failed/);
  });
});
