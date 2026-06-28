import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

import {
  articleToMarkdown,
  bundleNote,
  extractTweetIdentifiers,
  extractUrlFromPending,
  fetchTweet,
  isTwitterUrl,
  parseHtmlToArticle,
  processPending,
  scanPendingFolder,
  slugifyForFilename,
  tweetToArticle,
  type FxTwitterResponse,
  type IntakeDeps,
  type ParsedArticle,
} from "../src/intake";

const file = (basename: string): TFile =>
  ({ basename, path: `Inbox/Pending/${basename}.md` }) as unknown as TFile;

const fakeYaml = (value: unknown): string =>
  Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

const fakeHtmlToMd = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const sampleArticle: ParsedArticle = {
  title: "Sample Title",
  url: "https://example.com/post",
  author: "Jane Doe",
  published: "2025-11-12",
  domain: "example.com",
  contentHtml: "<p>Hello world.</p>",
};

describe("extractUrlFromPending", () => {
  it("extracts url from frontmatter", () => {
    const content = `---\nurl: https://example.com/x\nstatus: unread\n---\n\nBody.`;
    expect(extractUrlFromPending(content)).toBe("https://example.com/x");
  });

  it("strips surrounding quotes from frontmatter url", () => {
    const content = `---\nurl: "https://example.com/y"\n---\nBody.`;
    expect(extractUrlFromPending(content)).toBe("https://example.com/y");
  });

  it("falls back to first URL token in body if no frontmatter url", () => {
    const content = `---\nstatus: unread\n---\n\nCheck https://example.com/z please.`;
    expect(extractUrlFromPending(content)).toBe("https://example.com/z");
  });

  it("extracts plain URL when no frontmatter at all", () => {
    expect(extractUrlFromPending("https://example.com/raw")).toBe(
      "https://example.com/raw",
    );
  });

  it("strips trailing markdown-link punctuation from token URL", () => {
    expect(extractUrlFromPending("see [link](https://example.com/q)!")).toBe(
      "https://example.com/q",
    );
  });

  it("returns undefined when no URL anywhere", () => {
    expect(extractUrlFromPending("just text no link")).toBeUndefined();
  });
});

describe("slugifyForFilename", () => {
  it("lowercases + dasherizes", () => {
    expect(slugifyForFilename("Hello World Example")).toBe("hello-world-example");
  });

  it("strips accents", () => {
    expect(slugifyForFilename("¿Cómo estás?")).toBe("como-estas");
  });

  it("collapses repeated separators", () => {
    expect(slugifyForFilename("a -- b -- c")).toBe("a-b-c");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugifyForFilename(long).length).toBe(80);
  });

  it("falls back to 'untitled' when result is empty", () => {
    expect(slugifyForFilename("¿!?¡")).toBe("untitled");
    expect(slugifyForFilename("")).toBe("untitled");
  });
});

describe("articleToMarkdown", () => {
  it("returns frontmatter + body with the right shape", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    const note = articleToMarkdown(sampleArticle, now, fakeHtmlToMd);
    expect(note.frontmatter.source).toBe("intake-defuddle");
    expect(note.frontmatter.url).toBe(sampleArticle.url);
    expect(note.frontmatter.status).toBe("unread");
    expect(note.frontmatter.savedAt).toBe("2026-05-30T12:00:00.000Z");
    expect(note.frontmatter.author).toBe("Jane Doe");
    expect(note.frontmatter.published).toBe("2025-11-12");
    expect(note.frontmatter.tags).toEqual(["reader"]);
    expect(note.body).toContain("# Sample Title");
    expect(note.body).toContain(`[Original ↗](${sampleArticle.url})`);
    expect(note.body).toContain("Hello world.");
  });

  it("omits author and published when absent", () => {
    const minimal: ParsedArticle = {
      ...sampleArticle,
      author: undefined,
      published: undefined,
    };
    const note = articleToMarkdown(minimal, new Date(), fakeHtmlToMd);
    expect(note.frontmatter.author).toBeUndefined();
    expect(note.frontmatter.published).toBeUndefined();
  });
});

describe("bundleNote", () => {
  it("wraps frontmatter in --- delimiters with trailing newlines", () => {
    const note = articleToMarkdown(sampleArticle, new Date("2026-05-30Z"), fakeHtmlToMd);
    const bundled = bundleNote(note, fakeYaml);
    expect(bundled.startsWith("---\n")).toBe(true);
    expect(bundled).toContain("\n---\n\n");
    expect(bundled.endsWith("\n")).toBe(true);
  });
});

describe("parseHtmlToArticle (with happy-dom)", () => {
  it("extracts title, author, published, content from a blog fixture", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/blog-article.html"),
      "utf-8",
    );
    const parsed = parseHtmlToArticle(html, "https://example.com/post");
    expect(parsed.title.toLowerCase()).toContain("sleep");
    expect(parsed.url).toBe("https://example.com/post");
    expect(parsed.domain).toBe("example.com");
    expect(parsed.contentHtml.toLowerCase()).toContain("foundation");
  });

  it("falls back to hostname when title is empty", () => {
    const html = "<!DOCTYPE html><html><body><article><p>hello</p></article></body></html>";
    const parsed = parseHtmlToArticle(html, "https://no-title.example/x");
    expect(parsed.title).toBe("no-title.example");
  });
});

describe("processPending", () => {
  function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
    return {
      app: {
        vault: {
          read: vi.fn(),
          create: vi.fn(),
          delete: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
            const fm: Record<string, unknown> = {};
            fn(fm);
          }),
        },
      } as unknown as App,
      pendingFolder: "Inbox/Pending/",
      webFolder: "Inbox/Web/",
      htmlToMarkdown: fakeHtmlToMd,
      yamlStringify: fakeYaml,
      parseDom: (html: string) => new DOMParser().parseFromString(html, "text/html"),
      fetchUrl: async () => ({ status: 200, text: "<html><body><article><p>x</p></article></body></html>" }),
      now: () => new Date("2026-05-30T12:00:00Z"),
      ...overrides,
    };
  }

  it("writes to webFolder and deletes pending on success", async () => {
    const f = file("intake-001");
    const deps = makeDeps();
    (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      "---\nurl: https://example.com/x\n---\n",
    );
    const outcome = await processPending(f, deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.destination).toMatch(/^Inbox\/Web\/.+\.md$/);
    expect(deps.app.vault.create).toHaveBeenCalledTimes(1);
    expect(deps.app.vault.delete).toHaveBeenCalledWith(f);
  });

  it("deletes the pending and reports skip when URL is a duplicate", async () => {
    const f = file("intake-dup");
    const existing = {
      path: "Inbox/Read/2026-05/old.md",
      title: "Old Article",
      status: "read",
      readAt: "2026-05-01T00:00:00Z",
    };
    const deps = makeDeps({ lookupExisting: () => existing });
    (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      "---\nurl: https://example.com/x\n---\n",
    );
    const outcome = await processPending(f, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.skipped).toBe("duplicate");
    expect(outcome.existing).toEqual(existing);
    expect(deps.app.vault.create).not.toHaveBeenCalled();
    expect(deps.app.vault.delete).toHaveBeenCalledWith(f);
    expect(deps.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });

  it("marks intake-error and keeps pending file when URL is missing", async () => {
    const f = file("intake-002");
    const deps = makeDeps();
    (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue("just text, no url");
    const outcome = await processPending(f, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("no-url-found");
    expect(deps.app.vault.delete).not.toHaveBeenCalled();
    expect(deps.app.vault.create).not.toHaveBeenCalled();
    expect(deps.app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it("marks intake-error with http-NNN on non-2xx response", async () => {
    const f = file("intake-003");
    const deps = makeDeps({
      fetchUrl: async () => ({ status: 404, text: "" }),
    });
    (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      "---\nurl: https://example.com/x\n---\n",
    );
    const outcome = await processPending(f, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("http-404");
    expect(deps.app.vault.delete).not.toHaveBeenCalled();
  });

  it("marks intake-error when fetch throws", async () => {
    const f = file("intake-004");
    const deps = makeDeps({
      fetchUrl: async () => {
        throw new Error("network down");
      },
    });
    (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      "---\nurl: https://example.com/x\n---\n",
    );
    const outcome = await processPending(f, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("network down");
  });
});

describe("scanPendingFolder", () => {
  it("processes each file returned by the lister", async () => {
    const f1 = file("p1");
    const f2 = file("p2");
    const lister = vi.fn().mockResolvedValue([f1, f2]);
    const deps: IntakeDeps = {
      app: {
        vault: {
          read: vi.fn().mockResolvedValue("no url"),
          create: vi.fn(),
          delete: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn(async () => undefined),
        },
      } as unknown as App,
      pendingFolder: "Inbox/Pending/",
      webFolder: "Inbox/Web/",
      htmlToMarkdown: fakeHtmlToMd,
      yamlStringify: fakeYaml,
      parseDom: (html) => new DOMParser().parseFromString(html, "text/html"),
      fetchUrl: async () => ({ status: 200, text: "<html></html>" }),
      now: () => new Date("2026-05-30T12:00:00Z"),
    };
    const outcomes = await scanPendingFolder(deps, lister);
    expect(outcomes).toHaveLength(2);
    expect(lister).toHaveBeenCalledWith("Inbox/Pending/");
  });
});

describe("isTwitterUrl", () => {
  it("matches twitter.com / x.com and known mirrors", () => {
    expect(isTwitterUrl("https://twitter.com/jack/status/20")).toBe(true);
    expect(isTwitterUrl("https://x.com/jack/status/20")).toBe(true);
    expect(isTwitterUrl("https://www.x.com/jack/status/20")).toBe(true);
    expect(isTwitterUrl("https://fxtwitter.com/jack/status/20")).toBe(true);
    expect(isTwitterUrl("https://fixupx.com/jack/status/20")).toBe(true);
    expect(isTwitterUrl("https://vxtwitter.com/jack/status/20")).toBe(true);
  });

  it("does not match other hosts", () => {
    expect(isTwitterUrl("https://example.com/x")).toBe(false);
    expect(isTwitterUrl("https://nottwitter.com/x")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isTwitterUrl("not a url")).toBe(false);
  });
});

describe("extractTweetIdentifiers", () => {
  it("extracts user and id from a tweet URL", () => {
    expect(
      extractTweetIdentifiers("https://x.com/jack/status/20"),
    ).toEqual({ user: "jack", id: "20" });
  });

  it("ignores trailing query and path segments", () => {
    expect(
      extractTweetIdentifiers(
        "https://x.com/jack/status/20/photo/1?s=12&t=abc",
      ),
    ).toEqual({ user: "jack", id: "20" });
  });

  it("returns undefined for non-tweet URL", () => {
    expect(extractTweetIdentifiers("https://x.com/jack")).toBeUndefined();
  });
});

describe("fetchTweet", () => {
  const happyJson = readFileSync(
    join(__dirname, "fixtures/tweet-fxtwitter.json"),
    "utf-8",
  );

  it("calls the FxTwitter endpoint for the given tweet URL", async () => {
    const fetchUrl = vi.fn().mockResolvedValue({ status: 200, text: happyJson });
    await fetchTweet("https://x.com/jack/status/20", fetchUrl);
    expect(fetchUrl).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/jack/status/20",
    );
  });

  it("returns the parsed response on 200", async () => {
    const fetchUrl = async () => ({ status: 200, text: happyJson });
    const res = await fetchTweet("https://x.com/jack/status/20", fetchUrl);
    expect(res?.code).toBe(200);
    expect(res?.tweet?.text).toBe("just setting up my twttr");
  });

  it("returns undefined when status is not 200", async () => {
    const fetchUrl = async () => ({ status: 404, text: "" });
    const res = await fetchTweet("https://x.com/jack/status/20", fetchUrl);
    expect(res).toBeUndefined();
  });

  it("returns undefined when fetch throws", async () => {
    const fetchUrl = async () => {
      throw new Error("network");
    };
    const res = await fetchTweet("https://x.com/jack/status/20", fetchUrl);
    expect(res).toBeUndefined();
  });

  it("returns undefined when response is not parsable JSON", async () => {
    const fetchUrl = async () => ({ status: 200, text: "<html>" });
    const res = await fetchTweet("https://x.com/jack/status/20", fetchUrl);
    expect(res).toBeUndefined();
  });

  it("returns undefined for a non-tweet URL", async () => {
    const fetchUrl = vi.fn();
    const res = await fetchTweet("https://x.com/jack", fetchUrl);
    expect(res).toBeUndefined();
    expect(fetchUrl).not.toHaveBeenCalled();
  });
});

describe("tweetToArticle", () => {
  const happyJson = JSON.parse(
    readFileSync(join(__dirname, "fixtures/tweet-fxtwitter.json"), "utf-8"),
  ) as FxTwitterResponse;
  const mediaJson = JSON.parse(
    readFileSync(
      join(__dirname, "fixtures/tweet-fxtwitter-with-media.json"),
      "utf-8",
    ),
  ) as FxTwitterResponse;

  it("builds a ParsedArticle from a simple tweet", () => {
    const article = tweetToArticle(happyJson, "https://x.com/jack/status/20");
    expect(article).toBeDefined();
    expect(article?.title).toBe("@jack: just setting up my twttr");
    expect(article?.url).toBe("https://x.com/jack/status/20");
    expect(article?.author).toBe("jack (@jack)");
    expect(article?.published).toBe("2006-03-21T20:50:14.000Z");
    expect(article?.domain).toBe("x.com");
    expect(article?.source).toBe("intake-fxtwitter");
    expect(article?.tags).toEqual(["reader", "tweet"]);
    expect(article?.bodyMarkdown).toContain("> just setting up my twttr");
  });

  it("includes photos and videos as markdown blocks", () => {
    const article = tweetToArticle(
      mediaJson,
      "https://x.com/sample/status/999",
    );
    expect(article?.bodyMarkdown).toContain(
      "![](https://pbs.twimg.com/media/photo1.jpg)",
    );
    expect(article?.bodyMarkdown).toContain(
      "![](https://pbs.twimg.com/media/photo2.jpg)",
    );
    expect(article?.bodyMarkdown).toContain(
      "[Video ↗](https://video.twimg.com/v/vid.mp4)",
    );
  });

  it("preserves line breaks in the tweet body as blockquote", () => {
    const article = tweetToArticle(
      mediaJson,
      "https://x.com/sample/status/999",
    );
    expect(article?.bodyMarkdown?.split("\n").filter((l) => l.startsWith("> "))).toHaveLength(
      3,
    );
  });

  it("truncates the title with ellipsis when the first line is long", () => {
    const long = "a".repeat(120);
    const longJson: FxTwitterResponse = {
      code: 200,
      message: "OK",
      tweet: {
        id: "1",
        url: "https://x.com/long/status/1",
        text: long,
        author: { name: "Long", screen_name: "long" },
      },
    };
    const article = tweetToArticle(longJson, "https://x.com/long/status/1");
    expect(article?.title.endsWith("…")).toBe(true);
    expect(article?.title.length).toBeLessThanOrEqual(120);
  });

  it("returns undefined when code != 200", () => {
    expect(tweetToArticle({ code: 404, message: "not found" }, "x")).toBeUndefined();
  });

  it("returns undefined when tweet is missing", () => {
    expect(tweetToArticle({ code: 200, message: "OK" }, "x")).toBeUndefined();
  });
});

describe("processPending — Twitter URL", () => {
  function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
    return {
      app: {
        vault: {
          read: vi.fn().mockResolvedValue("---\nurl: https://x.com/jack/status/20\n---\n"),
          create: vi.fn(),
          delete: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn(async () => undefined),
        },
      } as unknown as App,
      pendingFolder: "Inbox/Pending/",
      webFolder: "Inbox/Web/",
      htmlToMarkdown: fakeHtmlToMd,
      yamlStringify: fakeYaml,
      parseDom: (html) => new DOMParser().parseFromString(html, "text/html"),
      now: () => new Date("2026-05-30T12:00:00Z"),
      ...overrides,
    };
  }

  it("uses FxTwitter for Twitter URLs and writes the parsed tweet", async () => {
    const happyJson = readFileSync(
      join(__dirname, "fixtures/tweet-fxtwitter.json"),
      "utf-8",
    );
    const fetchUrl = vi.fn().mockImplementation(async (u: string) => {
      if (u.startsWith("https://api.fxtwitter.com/")) {
        return { status: 200, text: happyJson };
      }
      return { status: 500, text: "should not fetch original" };
    });
    const deps = makeDeps({ fetchUrl });
    const f = file("intake-tweet");
    const outcome = await processPending(f, deps);

    expect(outcome.ok).toBe(true);
    expect(deps.app.vault.create).toHaveBeenCalledTimes(1);
    const createCall = (deps.app.vault.create as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    const dest = createCall[0] as string;
    const noteContent = createCall[1] as string;
    expect(dest).toMatch(/^Inbox\/Web\/.+\.md$/);
    expect(noteContent).toContain('source: "intake-fxtwitter"');
    expect(noteContent).toContain("just setting up my twttr");
    expect(fetchUrl).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/jack/status/20",
    );
  });

  it("falls back to defuddle when FxTwitter returns non-200", async () => {
    const fetchUrl = vi.fn().mockImplementation(async (u: string) => {
      if (u.startsWith("https://api.fxtwitter.com/")) {
        return { status: 404, text: "" };
      }
      return {
        status: 200,
        text: "<html><body><article><p>fallback content</p></article></body></html>",
      };
    });
    const deps = makeDeps({ fetchUrl });
    const f = file("intake-tweet-fallback");
    const outcome = await processPending(f, deps);

    expect(outcome.ok).toBe(true);
    const noteContent = (deps.app.vault.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as string;
    expect(noteContent).toContain('source: "intake-defuddle"');
    expect(fetchUrl).toHaveBeenCalledTimes(2);
  });
});
