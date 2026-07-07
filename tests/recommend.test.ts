import { describe, expect, it } from "vitest";

import {
  buildRecommendPrompt,
  generateRecommendations,
  parseRecommendations,
  renderRecommendationNote,
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
