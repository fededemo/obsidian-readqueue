import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import {
  articleFromFile,
  dateBucket,
  estimateReadingMinutes,
  filterBySnoozedUntil,
  filterByStatus,
  groupArticles,
  randomArticle,
  sortArticles,
  sourceLabel,
  type QueueArticle,
  type ReadFrontmatter,
} from "../src/queue-data";

function mkFile(basename: string, path = `Inbox/Web/${basename}.md`): TFile {
  return { basename, path } as unknown as TFile;
}

function mkArticle(overrides: Partial<QueueArticle> = {}): QueueArticle {
  return {
    file: mkFile(overrides.title ?? "untitled"),
    title: "Untitled",
    url: undefined,
    source: undefined,
    topic: undefined,
    author: undefined,
    published: undefined,
    savedAt: undefined,
    status: "unread",
    tags: [],
    snoozedUntil: undefined,
    ...overrides,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("articleFromFile", () => {
  const file = mkFile("my-article");

  it("extracts all known frontmatter fields", () => {
    const fm: ReadFrontmatter = {
      title: "Real Title",
      url: "https://example.com/x",
      source: "web-clipper",
      topic: "tech",
      author: "alice",
      published: "2026-01-15",
      savedAt: "2026-05-20T10:00:00Z",
      status: "unread",
      tags: ["reader", "tech"],
    };
    const a = articleFromFile(file, fm);
    expect(a.title).toBe("Real Title");
    expect(a.url).toBe("https://example.com/x");
    expect(a.source).toBe("web-clipper");
    expect(a.topic).toBe("tech");
    expect(a.author).toBe("alice");
    expect(a.published).toBe("2026-01-15");
    expect(a.savedAt?.toISOString()).toBe("2026-05-20T10:00:00.000Z");
    expect(a.status).toBe("unread");
    expect(a.tags).toEqual(["reader", "tech"]);
  });

  it("falls back to basename when title is missing", () => {
    const a = articleFromFile(file, {});
    expect(a.title).toBe("my-article");
  });

  it("defaults status to unread when missing", () => {
    const a = articleFromFile(file, {});
    expect(a.status).toBe("unread");
  });

  it("returns undefined for invalid savedAt", () => {
    const a = articleFromFile(file, { savedAt: "not-a-date" });
    expect(a.savedAt).toBeUndefined();
  });

  it("returns undefined for empty savedAt", () => {
    const a = articleFromFile(file, { savedAt: "" });
    expect(a.savedAt).toBeUndefined();
  });

  it("normalizes string tags into a single-element array", () => {
    const a = articleFromFile(file, { tags: "reader" });
    expect(a.tags).toEqual(["reader"]);
  });

  it("filters non-string entries out of tags array", () => {
    const a = articleFromFile(file, {
      tags: ["a", 42 as unknown as string, "b"],
    });
    expect(a.tags).toEqual(["a", "b"]);
  });

  it("handles undefined frontmatter without throwing", () => {
    const a = articleFromFile(file, undefined);
    expect(a.title).toBe("my-article");
    expect(a.status).toBe("unread");
    expect(a.tags).toEqual([]);
  });
});

describe("filterByStatus", () => {
  const unread = mkArticle({ status: "unread" });
  const read = mkArticle({ status: "read" });
  const archived = mkArticle({ status: "archived" });
  const all = [unread, read, archived];

  it("defaults to unread", () => {
    expect(filterByStatus(all)).toEqual([unread]);
  });

  it("filters explicitly by status", () => {
    expect(filterByStatus(all, "read")).toEqual([read]);
  });

  it("returns a copy when status is 'all'", () => {
    const out = filterByStatus(all, "all");
    expect(out).toEqual(all);
    expect(out).not.toBe(all);
  });

  it("returns empty array when input is empty", () => {
    expect(filterByStatus([])).toEqual([]);
  });
});

describe("sourceLabel", () => {
  it("returns hostname without www. for valid URL", () => {
    const a = mkArticle({ url: "https://www.example.com/post/1" });
    expect(sourceLabel(a)).toBe("example.com");
  });

  it("strips only leading www.", () => {
    const a = mkArticle({ url: "https://wwwfoo.com/x" });
    expect(sourceLabel(a)).toBe("wwwfoo.com");
  });

  it("falls back to source field when URL is invalid", () => {
    const a = mkArticle({ url: "not a url", source: "web-clipper" });
    expect(sourceLabel(a)).toBe("web-clipper");
  });

  it("falls back to 'Sin fuente' when nothing usable", () => {
    expect(sourceLabel(mkArticle())).toBe("Sin fuente");
  });
});

describe("dateBucket", () => {
  const now = new Date("2026-05-30T12:00:00Z");

  it("returns 'Sin fecha' for undefined", () => {
    expect(dateBucket(undefined, now)).toBe("Sin fecha");
  });

  it("buckets <1 day as Hoy", () => {
    expect(dateBucket(new Date("2026-05-30T03:00:00Z"), now)).toBe("Hoy");
  });

  it("buckets <7 days as Esta semana", () => {
    expect(dateBucket(new Date("2026-05-26T12:00:00Z"), now)).toBe("Esta semana");
  });

  it("buckets <30 days as Este mes", () => {
    expect(dateBucket(new Date("2026-05-10T12:00:00Z"), now)).toBe("Este mes");
  });

  it("buckets >=30 days as Antes", () => {
    expect(dateBucket(new Date("2026-04-01T12:00:00Z"), now)).toBe("Antes");
  });
});

describe("groupArticles", () => {
  it("returns single 'Todos' group for groupBy 'none'", () => {
    const arts = [mkArticle({ topic: "x" }), mkArticle({ topic: "y" })];
    const out = groupArticles(arts, "none");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Todos");
    expect(out[0]!.articles).toHaveLength(2);
  });

  it("groups by topic, missing topic goes to 'Sin tópico'", () => {
    const arts = [
      mkArticle({ topic: "tech" }),
      mkArticle({ topic: "tech" }),
      mkArticle({ topic: undefined }),
      mkArticle({ topic: "  " }),
    ];
    const out = groupArticles(arts, "topic");
    const labels = out.map((g) => g.label).sort();
    expect(labels).toEqual(["Sin tópico", "tech"]);
    const tech = out.find((g) => g.label === "tech");
    expect(tech?.articles).toHaveLength(2);
  });

  it("groups by source using hostname", () => {
    const arts = [
      mkArticle({ url: "https://www.nytimes.com/a" }),
      mkArticle({ url: "https://nytimes.com/b" }),
      mkArticle({ url: "https://example.com/c" }),
    ];
    const out = groupArticles(arts, "source");
    const labels = out.map((g) => g.label).sort();
    expect(labels).toEqual(["example.com", "nytimes.com"]);
  });

  it("groups by date using buckets", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    const arts = [
      mkArticle({ savedAt: new Date("2026-05-30T06:00:00Z") }),
      mkArticle({ savedAt: new Date("2026-05-28T06:00:00Z") }),
      mkArticle({ savedAt: undefined }),
    ];
    const out = groupArticles(arts, "date", now);
    const labels = out.map((g) => g.label).sort();
    expect(labels).toEqual(["Esta semana", "Hoy", "Sin fecha"]);
  });
});

describe("sortArticles", () => {
  const a = mkArticle({ savedAt: new Date("2026-05-30") });
  const b = mkArticle({ savedAt: new Date("2026-05-25") });
  const c = mkArticle({ savedAt: new Date("2026-05-20") });
  const noDate = mkArticle({ savedAt: undefined });

  it("sorts newest first by savedAt", () => {
    expect(sortArticles([c, a, b], "newest")).toEqual([a, b, c]);
  });

  it("sorts oldest first by savedAt, undefined dates last", () => {
    expect(sortArticles([a, noDate, c, b], "oldest")).toEqual([c, b, a, noDate]);
  });

  it("shuffle does not mutate the input", () => {
    const input = [a, b, c];
    sortArticles(input, "shuffle");
    expect(input).toEqual([a, b, c]);
  });

  it("shuffle is deterministic with a seeded RNG", () => {
    const input = [a, b, c];
    const out1 = sortArticles(input, "shuffle", mulberry32(42));
    const out2 = sortArticles(input, "shuffle", mulberry32(42));
    expect(out1).toEqual(out2);
  });

  it("shuffle changes order for sufficiently many items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mkArticle({ title: String(i) }),
    );
    const out = sortArticles(items, "shuffle", mulberry32(42));
    expect(out).not.toEqual(items);
    expect(new Set(out)).toEqual(new Set(items));
  });

  it("shuffle is uniformly distributed (chi-square sanity, k=4, n=2000)", () => {
    const rng = mulberry32(7);
    const items = [a, b, c, mkArticle({ title: "d" })];
    const k = items.length;
    const n = 2000;
    const counts: number[][] = Array.from({ length: k }, () =>
      Array.from({ length: k }, () => 0),
    );
    for (let trial = 0; trial < n; trial++) {
      const shuffled = sortArticles(items, "shuffle", rng);
      for (let pos = 0; pos < k; pos++) {
        const origIndex = items.indexOf(shuffled[pos]!);
        counts[pos]![origIndex]!++;
      }
    }
    const expected = n / k;
    let chi2 = 0;
    for (let p = 0; p < k; p++) {
      for (let i = 0; i < k; i++) {
        const obs = counts[p]![i]!;
        chi2 += ((obs - expected) ** 2) / expected;
      }
    }
    // df = (k-1)*(k-1) = 9. Critical value at p=0.001 is ~27.88.
    expect(chi2).toBeLessThan(27.88);
  });
});

describe("articleFromFile — snoozedUntil", () => {
  it("parses snoozedUntil from frontmatter", () => {
    const a = articleFromFile(mkFile("x"), { snoozedUntil: "2026-12-01T00:00:00Z" });
    expect(a.snoozedUntil?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("returns undefined when snoozedUntil is missing", () => {
    expect(articleFromFile(mkFile("x"), {}).snoozedUntil).toBeUndefined();
  });

  it("returns undefined when snoozedUntil is invalid", () => {
    expect(
      articleFromFile(mkFile("x"), { snoozedUntil: "not-a-date" }).snoozedUntil,
    ).toBeUndefined();
  });
});

describe("filterBySnoozedUntil", () => {
  const now = new Date("2026-05-30T12:00:00Z");
  const a = mkArticle({ title: "a", snoozedUntil: undefined });
  const past = mkArticle({
    title: "past",
    snoozedUntil: new Date("2026-05-28T00:00:00Z"),
  });
  const future = mkArticle({
    title: "future",
    snoozedUntil: new Date("2026-06-05T00:00:00Z"),
  });

  it("keeps articles without snoozedUntil", () => {
    expect(filterBySnoozedUntil([a], now)).toEqual([a]);
  });

  it("keeps articles whose snooze date has passed", () => {
    expect(filterBySnoozedUntil([a, past], now)).toEqual([a, past]);
  });

  it("excludes articles snoozed into the future", () => {
    const out = filterBySnoozedUntil([a, past, future], now);
    expect(out).toEqual([a, past]);
  });
});

describe("estimateReadingMinutes", () => {
  it("returns 0 for empty body", () => {
    expect(estimateReadingMinutes("")).toBe(0);
    expect(estimateReadingMinutes("   ")).toBe(0);
  });

  it("clamps to minimum 1 for non-empty short text", () => {
    expect(estimateReadingMinutes("hola")).toBe(1);
  });

  it("scales linearly with word count", () => {
    const body = "word ".repeat(440);
    expect(estimateReadingMinutes(body, 220)).toBe(2);
  });

  it("respects custom wpm", () => {
    const body = "word ".repeat(600);
    expect(estimateReadingMinutes(body, 300)).toBe(2);
  });
});

describe("randomArticle", () => {
  it("returns undefined when empty", () => {
    expect(randomArticle([])).toBeUndefined();
  });

  it("returns one of the inputs", () => {
    const items = [mkArticle({ title: "a" }), mkArticle({ title: "b" })];
    const picked = randomArticle(items, mulberry32(1));
    expect(items).toContain(picked);
  });

  it("is deterministic with a seeded RNG", () => {
    const items = [
      mkArticle({ title: "a" }),
      mkArticle({ title: "b" }),
      mkArticle({ title: "c" }),
    ];
    const a1 = randomArticle(items, mulberry32(99));
    const a2 = randomArticle(items, mulberry32(99));
    expect(a1).toBe(a2);
  });
});
