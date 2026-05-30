import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PUBLISHER_TOPIC_MAP,
  DEFAULT_TOPIC_LIST,
  buildClassifyPrompt,
  classifyFromPublisher,
  classifyTopic,
  classifyWithClaude,
  type ClassifyDeps,
  type ClassifyInput,
  type ClassifySettings,
} from "../src/topics";

function makeSettings(
  overrides: Partial<ClassifySettings> = {},
): ClassifySettings {
  return {
    topics: DEFAULT_TOPIC_LIST,
    publisherTopicMap: DEFAULT_PUBLISHER_TOPIC_MAP,
    anthropicApiKey: undefined,
    classifyModel: "claude-haiku-4-5",
    useClaudeForClassification: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    title: "A Title",
    excerpt: "Some excerpt about a topic.",
    domain: "example.com",
    source: undefined,
    ...overrides,
  };
}

describe("classifyFromPublisher", () => {
  it("returns topic for a known publisher (exact match)", () => {
    expect(classifyFromPublisher("paulgraham.com")).toBe("tech");
    expect(classifyFromPublisher("stratechery.com")).toBe("producto");
    expect(classifyFromPublisher("economist.com")).toBe("macro");
    expect(classifyFromPublisher("ourworldindata.org")).toBe("ciencia");
    expect(classifyFromPublisher("jamesclear.com")).toBe("personal");
    expect(classifyFromPublisher("theatlantic.com")).toBe("cultura");
  });

  it("strips www.", () => {
    expect(classifyFromPublisher("www.paulgraham.com")).toBe("tech");
  });

  it("is case-insensitive", () => {
    expect(classifyFromPublisher("PaulGraham.COM")).toBe("tech");
  });

  it("returns undefined for unknown publisher", () => {
    expect(classifyFromPublisher("never-heard.com")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(classifyFromPublisher("")).toBeUndefined();
    expect(classifyFromPublisher("   ")).toBeUndefined();
  });

  it("uses a custom map when supplied", () => {
    expect(
      classifyFromPublisher("custom.io", { "custom.io": "tech" }),
    ).toBe("tech");
  });

  it("twitter / x map to 'tweet'", () => {
    expect(classifyFromPublisher("twitter.com")).toBe("tweet");
    expect(classifyFromPublisher("x.com")).toBe("tweet");
  });
});

describe("buildClassifyPrompt", () => {
  it("includes every topic with its description", () => {
    const prompt = buildClassifyPrompt(
      ["tech", "otros"],
      { tech: "engineering", otros: "catchall" },
      "Title",
      "Excerpt",
    );
    expect(prompt).toContain("- tech: engineering");
    expect(prompt).toContain("- otros: catchall");
    expect(prompt).toContain("Title: Title");
    expect(prompt).toContain("Excerpt");
  });

  it("truncates excerpt to 600 chars", () => {
    const long = "a".repeat(1000);
    const prompt = buildClassifyPrompt(["tech"], { tech: "x" }, "T", long);
    expect(prompt).toContain("a".repeat(600));
    expect(prompt).not.toContain("a".repeat(601));
  });
});

describe("classifyWithClaude", () => {
  const apiResponse = (text: string): unknown => ({
    content: [{ type: "text", text }],
  });

  it("returns undefined when no API key", async () => {
    const fetchJson = vi.fn();
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "" }),
      { fetchJson },
    );
    expect(result).toBeUndefined();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("calls the Anthropic API with the right headers and body", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValue({ status: 200, json: apiResponse("tech") });
    await classifyWithClaude(
      makeInput({ title: "T", excerpt: "E" }),
      makeSettings({ anthropicApiKey: "sk-ant-test", classifyModel: "model-x" }),
      { fetchJson },
    );
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(init.body) as { model: string };
    expect(parsed.model).toBe("model-x");
  });

  it("returns the matched topic when the API answers exactly", async () => {
    const fetchJson = async () => ({ status: 200, json: apiResponse("tech") });
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "sk" }),
      { fetchJson },
    );
    expect(result).toBe("tech");
  });

  it("matches when the API returns the topic embedded in a longer answer", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => ({
      status: 200,
      json: apiResponse("This is about producto, the startup topic."),
    });
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "sk" }),
      { fetchJson },
    );
    expect(result).toBe("producto");
  });

  it("returns undefined when the API returns non-200", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => ({
      status: 500,
      json: undefined,
    });
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "sk" }),
      { fetchJson },
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when API answer doesn't match any topic", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => ({
      status: 200,
      json: apiResponse("not-a-topic"),
    });
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "sk" }),
      { fetchJson },
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when fetch throws", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => {
      throw new Error("network");
    };
    const result = await classifyWithClaude(
      makeInput(),
      makeSettings({ anthropicApiKey: "sk" }),
      { fetchJson },
    );
    expect(result).toBeUndefined();
  });
});

describe("classifyTopic orchestrator", () => {
  it("short-circuits to 'tweet' for source: intake-fxtwitter", async () => {
    const fetchJson = vi.fn();
    const result = await classifyTopic(
      makeInput({ source: "intake-fxtwitter", domain: "example.com" }),
      makeSettings({ anthropicApiKey: "sk", useClaudeForClassification: true }),
      { fetchJson },
    );
    expect(result).toBe("tweet");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("uses Claude when API key + toggle on, and falls back to heuristic if Claude returns nothing", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => ({
      status: 500,
      json: undefined,
    });
    const result = await classifyTopic(
      makeInput({ domain: "paulgraham.com" }),
      makeSettings({
        anthropicApiKey: "sk",
        useClaudeForClassification: true,
      }),
      { fetchJson },
    );
    expect(result).toBe("tech");
  });

  it("returns Claude result when API succeeds", async () => {
    const fetchJson: ClassifyDeps["fetchJson"] = async () => ({
      status: 200,
      json: { content: [{ type: "text", text: "macro" }] },
    });
    const result = await classifyTopic(
      makeInput({ domain: "paulgraham.com" }),
      makeSettings({
        anthropicApiKey: "sk",
        useClaudeForClassification: true,
      }),
      { fetchJson },
    );
    expect(result).toBe("macro");
  });

  it("uses heuristic when Claude toggle off but publisher is known", async () => {
    const fetchJson = vi.fn();
    const result = await classifyTopic(
      makeInput({ domain: "economist.com" }),
      makeSettings({
        anthropicApiKey: "sk",
        useClaudeForClassification: false,
      }),
      { fetchJson },
    );
    expect(result).toBe("macro");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("falls back to 'otros' when nothing matches", async () => {
    const result = await classifyTopic(
      makeInput({ domain: "unknown.example" }),
      makeSettings({ anthropicApiKey: undefined }),
    );
    expect(result).toBe("otros");
  });
});
