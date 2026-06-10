import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildBookMarkdown,
  parseBookHighlights,
  type KindleBook,
  type KindleHighlight,
} from "../src/kindle";
import {
  diffNewHighlights,
  highlightKey,
  mergeHighlightsIntoMarkdown,
  normalizeHighlightText,
  planMerge,
  uniqueHighlightKeys,
} from "../src/kindle-merge";
import { parseArgs, run, SYNC_STATE_FILENAME, type RunDeps } from "../scripts/sync-kindle";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, `fixtures/${name}`), "utf-8");

const parseDom = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

const h = (
  text: string,
  location?: string,
  note?: string,
): KindleHighlight => ({ text, location, note });

describe("normalizeHighlightText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeHighlightText("  You  do\nnot\t rise ")).toBe("You do not rise");
  });
});

describe("highlightKey", () => {
  it("is stable across whitespace variants of the same text", () => {
    expect(highlightKey(h("You do not rise", "Location 312"))).toBe(
      highlightKey(h("You  do\n not   rise ", "Location 312")),
    );
  });

  it("distinguishes the same text at different locations", () => {
    expect(highlightKey(h("same text", "Location 1"))).not.toBe(
      highlightKey(h("same text", "Location 2")),
    );
  });

  it("treats missing location as empty", () => {
    expect(highlightKey(h("text"))).toBe("text|");
  });
});

describe("diffNewHighlights", () => {
  const delivered = [highlightKey(h("old one", "Location 1"))];

  it("returns only highlights never delivered", () => {
    const fresh = diffNewHighlights(
      [h("old one", "Location 1"), h("new one", "Location 2")],
      delivered,
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.text).toBe("new one");
  });

  it("matches delivered keys via normalization", () => {
    const fresh = diffNewHighlights([h("old   one\n", "Location 1")], delivered);
    expect(fresh).toEqual([]);
  });

  it("dedupes repeats within the scrape itself", () => {
    const fresh = diffNewHighlights(
      [h("new one", "Location 2"), h("new  one", "Location 2")],
      delivered,
    );
    expect(fresh).toHaveLength(1);
  });
});

describe("planMerge", () => {
  const scraped = [h("alpha", "Location 1"), h("beta", "Location 2")];
  const keys = uniqueHighlightKeys(scraped);

  it("migration: no delivered keys + file exists → init-state without touching the file", () => {
    const plan = planMerge({ scraped, deliveredKeys: undefined, fileExists: true });
    expect(plan).toEqual({ action: "init-state", deliveredKeys: keys });
  });

  it("file deleted from vault → recreate with union of keys", () => {
    const plan = planMerge({
      scraped,
      deliveredKeys: ["gone|Location 0"],
      fileExists: false,
    });
    expect(plan.action).toBe("recreate");
    expect(plan.deliveredKeys).toEqual(["gone|Location 0", ...keys]);
  });

  it("nothing new → none", () => {
    const plan = planMerge({ scraped, deliveredKeys: keys, fileExists: true });
    expect(plan).toEqual({ action: "none", deliveredKeys: keys });
  });

  it("new highlights → append with extended delivered keys", () => {
    const plan = planMerge({
      scraped: [...scraped, h("gamma", "Location 3")],
      deliveredKeys: keys,
      fileExists: true,
    });
    expect(plan.action).toBe("append");
    if (plan.action !== "append") throw new Error("unreachable");
    expect(plan.newHighlights).toEqual([h("gamma", "Location 3")]);
    expect(plan.deliveredKeys).toEqual([...keys, highlightKey(h("gamma", "Location 3"))]);
  });

  it("highlight deleted by the user does NOT reappear (key already delivered)", () => {
    // delivered contains "alpha" even though the user removed it from the file
    const plan = planMerge({ scraped, deliveredKeys: keys, fileExists: true });
    expect(plan.action).toBe("none");
  });
});

describe("mergeHighlightsIntoMarkdown", () => {
  const existing = [
    "---",
    "source: kindle-scrape",
    "title: Atomic Habits",
    "status: read",
    "topic: personal",
    "highlightCount: 2",
    "myCustomField: keep-me",
    "---",
    "",
    "# Atomic Habits",
    "",
    "> by James Clear",
    "",
    "## Highlights",
    "",
    "> First highlight",
    "*Location 100*",
    "",
    "## Mis notas",
    "",
    "Texto propio del usuario.",
    "",
  ].join("\n");

  it("appends at the end of ## Highlights, before the next section", () => {
    const merged = mergeHighlightsIntoMarkdown(
      existing,
      [h("Second highlight", "Location 200", "una nota")],
      3,
    );
    const highlightsIdx = merged.indexOf("> Second highlight");
    const notasIdx = merged.indexOf("## Mis notas");
    expect(highlightsIdx).toBeGreaterThan(merged.indexOf("## Highlights"));
    expect(highlightsIdx).toBeLessThan(notasIdx);
    expect(merged).toContain("*Location 200*");
    expect(merged).toContain("📝 una nota");
    expect(merged).toContain("Texto propio del usuario.");
  });

  it("updates highlightCount without touching the rest of the frontmatter", () => {
    const merged = mergeHighlightsIntoMarkdown(existing, [h("x", "Location 1")], 3);
    expect(merged).toContain("highlightCount: 3");
    expect(merged).not.toContain("highlightCount: 2");
    expect(merged).toContain("myCustomField: keep-me");
    expect(merged).toContain("topic: personal");
    expect(merged).toContain("status: read");
  });

  it("adds highlightCount when the user removed it from the frontmatter", () => {
    const noCount = existing.replace("highlightCount: 2\n", "");
    const merged = mergeHighlightsIntoMarkdown(noCount, [h("x", "Location 1")], 3);
    expect(merged).toContain("highlightCount: 3");
    expect(merged.indexOf("highlightCount: 3")).toBeLessThan(merged.indexOf("# Atomic Habits"));
  });

  it("does not invent frontmatter when the user removed it", () => {
    const noFm = "# Atomic Habits\n\n## Highlights\n\n> First highlight\n*Location 100*\n";
    const merged = mergeHighlightsIntoMarkdown(noFm, [h("x", "Location 1")], 2);
    expect(merged).not.toContain("---");
    expect(merged).not.toContain("highlightCount");
    expect(merged).toContain("> x");
  });

  it("creates the ## Highlights section at the end when missing", () => {
    const noSection = [
      "---",
      "highlightCount: 1",
      "---",
      "",
      "# Atomic Habits",
      "",
      "Resumen escrito por el usuario.",
      "",
    ].join("\n");
    const merged = mergeHighlightsIntoMarkdown(noSection, [h("x", "Location 1")], 2);
    expect(merged).toContain("## Highlights");
    expect(merged.indexOf("## Highlights")).toBeGreaterThan(
      merged.indexOf("Resumen escrito por el usuario."),
    );
    expect(merged).toContain("> x");
    expect(merged).toContain("highlightCount: 2");
  });

  it("returns the input untouched when there is nothing to append", () => {
    expect(mergeHighlightsIntoMarkdown(existing, [], 99)).toBe(existing);
  });

  it("round-trip: build(2) + merge(1) === build(3)", () => {
    const book: KindleBook = {
      asin: "B07JTHXNXX",
      title: "Atomic Habits",
      author: "James Clear",
      coverUrl: undefined,
    };
    const all = [
      h("one", "Location 1"),
      h("two", "Location 2", "note two"),
      h("three", "Location 3"),
    ];
    const now = new Date("2026-06-10T12:00:00Z");
    const partial = buildBookMarkdown({ book, highlights: all.slice(0, 2) }, "personal", now);
    const merged = mergeHighlightsIntoMarkdown(partial.content, [all[2]!], 3);
    const full = buildBookMarkdown({ book, highlights: all }, "personal", now);
    expect(merged).toBe(full.content);
  });
});

describe("run --merge (CLI parity)", () => {
  const libHtml = fixture("kindle-library.html");
  const bookHtml = fixture("kindle-book-highlights.html");
  const someBook: KindleBook = {
    asin: "B07JTHXNXX",
    title: "Atomic Habits",
    author: "James Clear",
    coverUrl: undefined,
  };
  const fixtureHighlights = parseBookHighlights(bookHtml, someBook, parseDom).highlights;

  const baseArgs = {
    cookie: "session=x",
    dest: "/dest",
    apiKey: undefined,
    dryRun: false,
    force: false,
    merge: true,
    cookieFile: undefined,
  };

  function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps {
    return {
      fetchUrl: async (url: string) =>
        url === "https://read.amazon.com/notebook"
          ? { status: 200, text: libHtml }
          : { status: 200, text: bookHtml },
      parseDom,
      writeFile: vi.fn().mockResolvedValue(undefined),
      exists: async () => false,
      mkdirp: async () => undefined,
      log: vi.fn(),
      now: () => new Date("2026-06-10T12:00:00Z"),
      classify: async () => "personal",
      ...overrides,
    };
  }

  it("parseArgs accepts --merge", () => {
    const args = parseArgs(["--cookie", "x", "--dest", "/d", "--merge"]);
    expect(args.merge).toBe(true);
  });

  it("migration: existing files without sidecar get state initialized, files untouched", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeFile,
      // book .md files exist; sidecar does not
      exists: async (p: string) => !p.endsWith(SYNC_STATE_FILENAME),
    });
    const summary = await run(baseArgs, deps);
    expect(summary.initialized).toBe(3);
    expect(summary.written).toBe(0);
    expect(summary.merged).toBe(0);
    // only write: the sidecar state file
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [statePath, stateRaw] = writeFile.mock.calls[0] as [string, string];
    expect(statePath).toContain(SYNC_STATE_FILENAME);
    const state = JSON.parse(stateRaw) as {
      books: Record<string, { deliveredKeys: string[] }>;
    };
    expect(state.books["B07JTHXNXX"]?.deliveredKeys).toEqual(
      uniqueHighlightKeys(fixtureHighlights),
    );
  });

  it("appends only new highlights for books with delivered-keys state", async () => {
    const allKeys = uniqueHighlightKeys(fixtureHighlights);
    const deliveredKeys = allKeys.slice(0, allKeys.length - 1);
    const lastHighlight = fixtureHighlights[fixtureHighlights.length - 1]!;
    const existingMd = buildBookMarkdown(
      { book: someBook, highlights: fixtureHighlights.slice(0, -1) },
      "personal",
      new Date("2026-05-30T12:00:00Z"),
    ).content;
    const sidecar = JSON.stringify({
      version: 1,
      books: {
        B07JTHXNXX: { deliveredKeys },
        B08XYZ1234: { deliveredKeys: allKeys },
        B09NOPE5678: { deliveredKeys: allKeys },
      },
    });
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeFile,
      exists: async () => true,
      readFile: async (p: string) =>
        p.endsWith(SYNC_STATE_FILENAME) ? sidecar : existingMd,
    });
    const summary = await run(baseArgs, deps);
    expect(summary.merged).toBe(1);
    expect(summary.newHighlights).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(summary.written).toBe(0);
    // merged file + sidecar
    expect(writeFile).toHaveBeenCalledTimes(2);
    const mergedCall = writeFile.mock.calls.find(
      (c) => !(c[0] as string).endsWith(SYNC_STATE_FILENAME),
    ) as [string, string];
    expect(mergedCall[1]).toContain(`> ${lastHighlight.text}`);
    expect(mergedCall[1]).toContain(`highlightCount: ${allKeys.length}`);
    const stateCall = writeFile.mock.calls.find((c) =>
      (c[0] as string).endsWith(SYNC_STATE_FILENAME),
    ) as [string, string];
    const state = JSON.parse(stateCall[1]) as {
      books: Record<string, { deliveredKeys: string[] }>;
    };
    expect(state.books["B07JTHXNXX"]?.deliveredKeys).toEqual(allKeys);
  });

  it("recreates the file in full when it was deleted from the vault", async () => {
    const allKeys = uniqueHighlightKeys(fixtureHighlights);
    const sidecar = JSON.stringify({
      version: 1,
      books: {
        B07JTHXNXX: { deliveredKeys: allKeys },
        B08XYZ1234: { deliveredKeys: allKeys },
        B09NOPE5678: { deliveredKeys: allKeys },
      },
    });
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeFile,
      // sidecar exists, all .md files are gone
      exists: async (p: string) => p.endsWith(SYNC_STATE_FILENAME),
      readFile: async () => sidecar,
    });
    const summary = await run(baseArgs, deps);
    expect(summary.written).toBe(3);
    expect(summary.merged).toBe(0);
    // 3 recreated books + sidecar
    expect(writeFile).toHaveBeenCalledTimes(4);
  });

  it("--dry-run does not write files nor the sidecar", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeFile,
      exists: async (p: string) => !p.endsWith(SYNC_STATE_FILENAME),
    });
    const summary = await run({ ...baseArgs, dryRun: true }, deps);
    expect(summary.initialized).toBe(3);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
