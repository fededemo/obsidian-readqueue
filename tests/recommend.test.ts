import { describe, expect, it } from "vitest";

import {
  buildRecommendPrompt,
  generateRecommendations,
  parseRecommendations,
  parseScoreBatch,
  parseWishlistRanking,
  rankWishlist,
  renderRecommendationNote,
  renderWishlistRankNote,
  scoreWishlistBatch,
  tierFromScore,
  type ContextPack,
} from "../src/recommend";

const pack = (over: Partial<ContextPack> = {}): ContextPack => ({
  read: [{ title: "Why nations fail", topic: "macro", link: "why-nations-fail" }],
  topicDistribution: [{ topic: "macro", count: 5 }],
  highlights: [
    { text: "Institutions matter for growth", source: "kindle", title: "Some book", link: "some-book" },
  ],
  queue: [{ title: "An econ article", topic: "macro" }],
  owned: [
    { asin: "B0OWNED", title: "The Dictator's Handbook", readingStatus: "unread", topic: "macro" },
  ],
  wishlist: [{ asin: "B0WISH", title: "The Narrow Corridor" }],
  priorRecommendations: [{ date: "2026-06-28", asins: ["B0OLD"] }],
  ...over,
});

describe("buildRecommendPrompt", () => {
  it("includes every context section and the priority rule", () => {
    const p = buildRecommendPrompt(pack());
    expect(p).toContain("Priority order");
    expect(p).toContain("Why nations fail");
    expect(p).toContain("Institutions matter");
    expect(p).toContain("B0OWNED");
    expect(p).toContain("B0WISH");
    expect(p).toContain("anti-impulse-buy");
    expect(p).toContain("JSON");
  });
});

describe("parseRecommendations", () => {
  it("parses valid recommendations and keeps known asins", () => {
    const text = JSON.stringify({
      recommendations: [
        { asin: "B0OWNED", title: "The Dictator's Handbook", source: "owned", reason: "matches macro", connects_to: ["Why nations fail"] },
        { asin: "B0WISH", title: "The Narrow Corridor", source: "wishlist", reason: "next step", connects_to: [] },
      ],
    });
    const recs = parseRecommendations(text, pack());
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ asin: "B0OWNED", source: "owned" });
    expect(recs[0]?.connects_to).toEqual(["Why nations fail"]);
  });

  it("demotes an owned/wishlist rec with an unknown asin to 'new' (anti-hallucination)", () => {
    const text = JSON.stringify({
      recommendations: [
        { asin: "B0FAKE", title: "Invented Book", source: "owned", reason: "x", connects_to: [] },
      ],
    });
    const recs = parseRecommendations(text, pack());
    expect(recs[0]).toMatchObject({ source: "new", asin: null, title: "Invented Book" });
  });

  it("nulls the asin for genuine 'new' recs", () => {
    const text = JSON.stringify({
      recommendations: [{ asin: "whatever", title: "A new idea", source: "new", reason: "", connects_to: [] }],
    });
    expect(parseRecommendations(text, pack())[0]?.asin).toBeNull();
  });

  it("dedupes and caps at 5", () => {
    const recs = Array.from({ length: 8 }, (_, i) => ({
      asin: null,
      title: `Book ${i}`,
      source: "new",
      reason: "",
      connects_to: [],
    }));
    // add a duplicate title
    recs.push({ asin: null, title: "Book 0", source: "new", reason: "", connects_to: [] });
    const parsed = parseRecommendations(JSON.stringify({ recommendations: recs }), pack());
    expect(parsed.length).toBe(5);
    expect(new Set(parsed.map((r) => r.title)).size).toBe(5);
  });

  it("returns [] on non-JSON or missing array", () => {
    expect(parseRecommendations("no json here", pack())).toEqual([]);
    expect(parseRecommendations(JSON.stringify({ foo: 1 }), pack())).toEqual([]);
  });
});

describe("renderRecommendationNote", () => {
  it("renders frontmatter, links and the owned-first section", () => {
    const recs = parseRecommendations(
      JSON.stringify({
        recommendations: [
          { asin: "B0OWNED", title: "The Dictator's Handbook", source: "owned", reason: "you highlighted institutions", connects_to: ["Why nations fail"] },
          { asin: null, title: "A New Idea", source: "new", reason: "nothing owned covers X", connects_to: [] },
        ],
      }),
      pack(),
    );
    const note = renderRecommendationNote(recs, {
      date: "2026-07-05",
      model: "claude-sonnet-5",
      pack: pack(),
      generatedAt: "2026-07-05T10:00:00.000Z",
    });
    expect(note).toContain("source: readqueue-recommend");
    expect(note).toContain("recommendedAsins: [B0OWNED]");
    expect(note).toContain("model: claude-sonnet-5");
    // book link resolves to the readable ficha filename
    expect(note).toContain("[[The Dictator's Handbook|The Dictator's Handbook]]");
    // connects_to link resolves to the read-article basename
    expect(note).toContain("[[why-nations-fail|Why nations fail]]");
    expect(note).toContain("Empezá por lo que ya tenés");
  });

  it("handles zero recommendations gracefully", () => {
    const note = renderRecommendationNote([], {
      date: "2026-07-05",
      model: "m",
      pack: pack(),
      generatedAt: "t",
    });
    expect(note).toContain("No pude generar recomendaciones");
  });
});

describe("wishlist ranking", () => {
  const p = pack({
    wishlist: [
      { asin: "B0WISH", title: "The Narrow Corridor" },
      { asin: "B0TWO", title: "Second Book" },
    ],
  });

  it("parses ranked books, keeps only real asins, sorts by score", () => {
    const text = JSON.stringify({
      ranked: [
        { asin: "B0TWO", score: 55, tier: "soon", reason: "b" },
        { asin: "B0WISH", score: 90, tier: "now", reason: "a" },
        { asin: "B0FAKE", score: 99, tier: "now", reason: "hallucinated" },
      ],
    });
    const ranked = parseWishlistRanking(text, p);
    expect(ranked.map((r) => r.asin)).toEqual(["B0WISH", "B0TWO"]); // fake dropped, sorted
    expect(ranked[0]).toMatchObject({ title: "The Narrow Corridor", score: 90, tier: "now" });
  });

  it("clamps score and falls back to a tier from the score", () => {
    const text = JSON.stringify({ ranked: [{ asin: "B0WISH", score: 250, reason: "x" }] });
    const ranked = parseWishlistRanking(text, p);
    expect(ranked[0]?.score).toBe(100);
    expect(ranked[0]?.tier).toBe("now"); // 100 >= 70
  });

  it("renders tiers with resolvable links", () => {
    const note = renderWishlistRankNote(
      [
        { asin: "B0WISH", title: "The Narrow Corridor", score: 90, tier: "now", reason: "matches macro" },
        { asin: "B0TWO", title: "Second Book", score: 30, tier: "someday", reason: "" },
      ],
      { date: "2026-07-06", model: "claude-sonnet-5", generatedAt: "t" },
    );
    expect(note).toContain("source: readqueue-wishlist-rank");
    expect(note).toContain("📗 Leé ya");
    expect(note).toContain("[[The Narrow Corridor|The Narrow Corridor]]");
    expect(note).toContain("90/100 — matches macro");
    expect(note).toContain("📙 Algún día");
  });

  it("rankWishlist calls the API and parses", async () => {
    const reply = {
      content: [
        { type: "text", text: JSON.stringify({ ranked: [{ asin: "B0WISH", score: 80, tier: "now", reason: "r" }] }) },
      ],
    };
    const res = await rankWishlist(
      p,
      { anthropicApiKey: "sk", recommendModel: "claude-sonnet-5" },
      { fetchJson: async () => ({ status: 200, json: reply }), retry: { retries: 0 } },
    );
    expect(res.status).toBe(200);
    expect(res.ranked[0]?.asin).toBe("B0WISH");
  });
});

describe("batched scoring", () => {
  it("tierFromScore thresholds", () => {
    expect(tierFromScore(90)).toBe("now");
    expect(tierFromScore(70)).toBe("now");
    expect(tierFromScore(55)).toBe("soon");
    expect(tierFromScore(10)).toBe("someday");
  });

  it("parseScoreBatch keeps only asins in the batch, clamps, derives tier", () => {
    const valid = new Set(["A", "B"]);
    const text = JSON.stringify({
      scores: [
        { asin: "A", score: 250, reason: "x" },
        { asin: "B", score: 30, reason: "y" },
        { asin: "GHOST", score: 99, reason: "no" },
      ],
    });
    const scored = parseScoreBatch(text, valid);
    expect(scored.map((s) => s.asin)).toEqual(["A", "B"]);
    expect(scored[0]).toMatchObject({ score: 100, tier: "now" });
    expect(scored[1]).toMatchObject({ score: 30, tier: "someday" });
  });

  it("scoreWishlistBatch calls the API and scores the batch", async () => {
    const reply = {
      content: [{ type: "text", text: JSON.stringify({ scores: [{ asin: "A", score: 80, reason: "r" }] }) }],
    };
    const res = await scoreWishlistBatch(
      pack(),
      [{ asin: "A", title: "Book A" }],
      { anthropicApiKey: "sk", recommendModel: "claude-sonnet-5" },
      { fetchJson: async () => ({ status: 200, json: reply }), retry: { retries: 0 } },
    );
    expect(res.status).toBe(200);
    expect(res.scores[0]).toMatchObject({ asin: "A", score: 80, tier: "now" });
  });
});

describe("generateRecommendations", () => {
  it("returns [] without an API key (no call)", async () => {
    let called = false;
    const res = await generateRecommendations(pack(), { anthropicApiKey: "", recommendModel: "m" }, {
      fetchJson: async () => {
        called = true;
        return { status: 200, json: {} };
      },
    });
    expect(res.recommendations).toEqual([]);
    expect(called).toBe(false);
  });

  it("calls the API and parses the reply", async () => {
    const reply = {
      content: [
        { type: "text", text: JSON.stringify({ recommendations: [{ asin: "B0OWNED", title: "The Dictator's Handbook", source: "owned", reason: "r", connects_to: [] }] }) },
      ],
    };
    const res = await generateRecommendations(
      pack(),
      { anthropicApiKey: "sk", recommendModel: "claude-sonnet-5" },
      { fetchJson: async () => ({ status: 200, json: reply }), retry: { retries: 0 } },
    );
    expect(res.status).toBe(200);
    expect(res.recommendations[0]?.asin).toBe("B0OWNED");
  });

  it("degrades to [] on API error", async () => {
    const res = await generateRecommendations(
      pack(),
      { anthropicApiKey: "sk", recommendModel: "m" },
      { fetchJson: async () => ({ status: 500, json: undefined }), retry: { retries: 0 } },
    );
    expect(res.recommendations).toEqual([]);
    expect(res.status).toBe(500);
  });
});
