import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

import {
  articleToMarkdown,
  bundleNote,
  extractUrlFromPending,
  parseHtmlToArticle,
  processPending,
  scanPendingFolder,
  slugifyForFilename,
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
    expect(note.body).toContain(`[Original](${sampleArticle.url})`);
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
