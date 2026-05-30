import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildBody,
  buildFrontmatterYaml,
  buildOutputMd,
  hostnameFromUrl,
  normalizeTitle,
  parseArgs,
  parseHighlights,
  parseMatterDocument,
  parseMetadata,
  run,
} from "../scripts/import-matter";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, `fixtures/${name}`), "utf-8");

describe("parseMetadata", () => {
  it("extracts URL from bracket link", () => {
    const md = parseMetadata(
      "* URL: [https://example.com/x](https://example.com/x)\n* Publisher: Example\n",
    );
    expect(md.url).toBe("https://example.com/x");
    expect(md.publisher).toBe("Example");
  });

  it("extracts URL from plain text fallback", () => {
    const md = parseMetadata("* URL: https://example.com/y\n");
    expect(md.url).toBe("https://example.com/y");
  });

  it("extracts author + published date", () => {
    const md = parseMetadata(
      "* Author: Alice\n* Published Date: 2024-01-15\n",
    );
    expect(md.author).toBe("Alice");
    expect(md.publishedDate).toBe("2024-01-15");
  });

  it("parses tags and strips leading #", () => {
    const md = parseMetadata("* Tags: #tech #ai #payments\n");
    expect(md.tags).toEqual(["tech", "ai", "payments"]);
  });

  it("returns empty tags when line is missing or blank", () => {
    expect(parseMetadata("").tags).toEqual([]);
    expect(parseMetadata("* Tags: \n").tags).toEqual([]);
  });
});

describe("parseHighlights", () => {
  it("collects every `* line` entry, trimmed", () => {
    const list = parseHighlights("\n* one\n* two\n* three\n");
    expect(list).toEqual(["one", "two", "three"]);
  });

  it("returns empty array when section is empty", () => {
    expect(parseHighlights("")).toEqual([]);
  });
});

describe("parseMatterDocument", () => {
  it("parses a real blog export", () => {
    const doc = parseMatterDocument(fixture("matter-blog.md"));
    expect(doc.metadata.url).toBe("https://stratechery.com/2024/example-post");
    expect(doc.metadata.author).toBe("Ben Thompson");
    expect(doc.metadata.publisher).toBe("Stratechery");
    expect(doc.metadata.publishedDate).toBe("2024-03-15");
    expect(doc.metadata.tags).toEqual(["strategy", "tech"]);
    expect(doc.highlights).toHaveLength(3);
  });

  it("parses a tweet export with empty Tags line", () => {
    const doc = parseMatterDocument(fixture("matter-tweet.md"));
    expect(doc.metadata.url).toContain("twitter.com");
    expect(doc.metadata.tags).toEqual([]);
    expect(doc.highlights).toHaveLength(2);
  });

  it("parses minimal export with only URL + Publisher", () => {
    const doc = parseMatterDocument(fixture("matter-minimal.md"));
    expect(doc.metadata.url).toBe("https://example.com/post");
    expect(doc.metadata.publisher).toBe("example.com");
    expect(doc.metadata.author).toBeUndefined();
    expect(doc.metadata.publishedDate).toBeUndefined();
    expect(doc.highlights).toEqual(["Only highlight."]);
  });
});

describe("normalizeTitle", () => {
  it("strips .md extension", () => {
    expect(normalizeTitle("hello.md")).toBe("hello");
  });

  it("strips [FREE] / [NN] prefixes", () => {
    expect(normalizeTitle("[FREE] Article Title.md")).toBe("Article Title");
    expect(normalizeTitle("[99] Hyping Fisher.md")).toBe("Hyping Fisher");
  });

  it("strips leading dashes", () => {
    expect(normalizeTitle("-Ayn Rand Lexicon.md")).toBe("Ayn Rand Lexicon");
  });
});

describe("hostnameFromUrl", () => {
  it("returns hostname without www", () => {
    expect(hostnameFromUrl("https://www.example.com/x")).toBe("example.com");
  });

  it("returns empty string for invalid URL", () => {
    expect(hostnameFromUrl(undefined)).toBe("");
    expect(hostnameFromUrl("not a url")).toBe("");
  });
});

describe("buildFrontmatterYaml", () => {
  const doc = parseMatterDocument(fixture("matter-blog.md"));
  const yaml = buildFrontmatterYaml({
    title: "Example Post",
    topic: "producto",
    savedAt: new Date("2024-04-01T10:00:00Z"),
    document: doc,
  });

  it("includes source/title/url/author/published/domain/savedAt/status/readAt/tags/topic", () => {
    expect(yaml).toContain("source: matter-legacy");
    expect(yaml).toContain("title: Example Post");
    expect(yaml).toContain("url: https://stratechery.com/2024/example-post");
    expect(yaml).toContain("author: Ben Thompson");
    expect(yaml).toContain("published: 2024-03-15");
    expect(yaml).toContain("domain: stratechery.com");
    expect(yaml).toContain("savedAt: 2024-04-01T10:00:00.000Z");
    expect(yaml).toContain("status: read");
    expect(yaml).toContain("readAt: 2024-04-01T10:00:00.000Z");
    expect(yaml).toContain("topic: producto");
  });

  it("prefixes tags with reader/legacy + Matter tags", () => {
    expect(yaml).toContain("tags: [reader, legacy, strategy, tech]");
  });

  it("omits author/published when document doesn't have them", () => {
    const minimal = parseMatterDocument(fixture("matter-minimal.md"));
    const out = buildFrontmatterYaml({
      title: "X",
      topic: "otros",
      savedAt: new Date("2024-01-01Z"),
      document: minimal,
    });
    expect(out).not.toContain("author:");
    expect(out).not.toContain("published:");
  });
});

describe("buildBody", () => {
  it("renders title + Original link + highlights as blockquotes", () => {
    const body = buildBody("Title", "https://example.com/x", ["one", "two"]);
    expect(body).toContain("# Title");
    expect(body).toContain("[Original ↗](https://example.com/x)");
    expect(body).toContain("> one");
    expect(body).toContain("> two");
  });

  it("omits Original line when URL missing", () => {
    expect(buildBody("Title", undefined, [])).not.toContain("Original");
  });
});

describe("buildOutputMd", () => {
  it("builds full markdown with frontmatter + body and a slug", () => {
    const doc = parseMatterDocument(fixture("matter-blog.md"));
    const out = buildOutputMd(
      doc,
      "Example Post.md",
      new Date("2024-04-01T10:00:00Z"),
      "producto",
    );
    expect(out.content.startsWith("---\n")).toBe(true);
    expect(out.content).toContain("source: matter-legacy");
    expect(out.content).toContain("> First highlight from the post.");
    expect(out.slug).toBe("example-post");
    expect(out.title).toBe("Example Post");
  });
});

describe("parseArgs", () => {
  it("parses required + optional flags", () => {
    const args = parseArgs([
      "--source",
      "/a",
      "--dest",
      "/b",
      "--anthropic-key",
      "sk-ant",
      "--dry-run",
    ]);
    expect(args).toEqual({
      source: "/a",
      dest: "/b",
      apiKey: "sk-ant",
      dryRun: true,
      force: false,
    });
  });

  it("throws when --source or --dest missing", () => {
    expect(() => parseArgs(["--source", "/a"])).toThrow();
  });

  it("throws on unknown flags", () => {
    expect(() => parseArgs(["--source", "/a", "--dest", "/b", "--weird"])).toThrow();
  });
});

describe("run", () => {
  it("migrates new files and skips existing without --force", async () => {
    const log = vi.fn();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const summary = await run(
      {
        source: "/src",
        dest: "/dest",
        apiKey: undefined,
        dryRun: false,
        force: false,
      },
      {
        readDir: async () => ["a.md", "b.md"],
        readFile: async () => fixture("matter-minimal.md"),
        statFile: async () => ({ mtime: new Date("2024-01-01Z") }),
        writeFile,
        exists: async (p) => p.endsWith("a.md"),
        mkdirp: async () => undefined,
        classify: async () => "tech",
        log,
      },
    );
    expect(summary.migrated).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("--dry-run does not call writeFile", async () => {
    const writeFile = vi.fn();
    const summary = await run(
      {
        source: "/src",
        dest: "/dest",
        apiKey: undefined,
        dryRun: true,
        force: true,
      },
      {
        readDir: async () => ["a.md"],
        readFile: async () => fixture("matter-blog.md"),
        statFile: async () => ({ mtime: new Date("2024-01-01Z") }),
        writeFile,
        exists: async () => false,
        mkdirp: async () => undefined,
        classify: async () => "producto",
        log: vi.fn(),
      },
    );
    expect(summary.migrated).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("counts failed entries without aborting", async () => {
    const summary = await run(
      {
        source: "/src",
        dest: "/dest",
        apiKey: undefined,
        dryRun: false,
        force: false,
      },
      {
        readDir: async () => ["broken.md", "good.md"],
        readFile: async (p) => {
          if (p.endsWith("broken.md")) throw new Error("disk read failed");
          return fixture("matter-blog.md");
        },
        statFile: async () => ({ mtime: new Date("2024-01-01Z") }),
        writeFile: async () => undefined,
        exists: async () => false,
        mkdirp: async () => undefined,
        classify: async () => "tech",
        log: vi.fn(),
      },
    );
    expect(summary.failed).toBe(1);
    expect(summary.migrated).toBe(1);
    expect(summary.errors[0]).toContain("broken.md");
  });
});
