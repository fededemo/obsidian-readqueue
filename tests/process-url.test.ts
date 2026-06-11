import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

import { processUrl, type ProcessUrlDeps } from "../src/intake";

const fakeYaml = (value: unknown): string =>
  Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

const fakeHtmlToMd = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const ARTICLE_HTML =
  "<!DOCTYPE html><html><head><title>Direct Add Title</title></head>" +
  "<body><article><h1>Direct Add Title</h1><p>Body text.</p></article></body></html>";

function makeDeps(overrides: Partial<ProcessUrlDeps> = {}): ProcessUrlDeps {
  return {
    app: {
      vault: {
        create: vi.fn(),
      },
    } as unknown as App,
    webFolder: "Inbox/Web/",
    htmlToMarkdown: fakeHtmlToMd,
    yamlStringify: fakeYaml,
    parseDom: (html: string) =>
      new DOMParser().parseFromString(html, "text/html"),
    fetchUrl: async () => ({ status: 200, text: ARTICLE_HTML }),
    now: () => new Date("2026-06-10T12:00:00Z"),
    ...overrides,
  };
}

describe("processUrl (shared intake core)", () => {
  it("fetches, parses, and writes the note to the web folder", async () => {
    const deps = makeDeps();
    const outcome = await processUrl("https://example.com/post", deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.destination).toMatch(/^Inbox\/Web\/.+\.md$/);
    expect(outcome.title).toBe("Direct Add Title");
    expect(deps.app.vault.create).toHaveBeenCalledTimes(1);
    const [dest, content] = (deps.app.vault.create as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, string];
    expect(dest).toBe(outcome.destination);
    expect(content).toContain('source: "intake-defuddle"');
    expect(content).toContain('url: "https://example.com/post"');
    expect(content).toContain("# Direct Add Title");
  });

  it("returns http-NNN error without writing on non-2xx", async () => {
    const deps = makeDeps({ fetchUrl: async () => ({ status: 500, text: "" }) });
    const outcome = await processUrl("https://example.com/post", deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("http-500");
    expect(deps.app.vault.create).not.toHaveBeenCalled();
  });

  it("returns the error message when fetch throws", async () => {
    const deps = makeDeps({
      fetchUrl: async () => {
        throw new Error("network down");
      },
    });
    const outcome = await processUrl("https://example.com/post", deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("network down");
  });

  it("returns the error when the note already exists (vault.create throws)", async () => {
    const deps = makeDeps();
    (deps.app.vault.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("File already exists."),
    );
    const outcome = await processUrl("https://example.com/post", deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("File already exists.");
  });

  it("applies the classifier topic and merged tags", async () => {
    const deps = makeDeps({
      classify: async () => ({ topic: "tech", tags: ["ai"] }),
    });
    const outcome = await processUrl("https://example.com/post", deps);
    expect(outcome.ok).toBe(true);
    const [, content] = (deps.app.vault.create as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, string];
    expect(content).toContain('topic: "tech"');
    expect(content).toContain('tags: ["reader","ai"]');
  });

  it("uses the FxTwitter pipeline for twitter-like URLs", async () => {
    const tweetJson = JSON.stringify({
      code: 200,
      message: "OK",
      tweet: {
        id: "123",
        url: "https://x.com/someone/status/123",
        text: "Hello from the bird site",
        author: { name: "Some One", screen_name: "someone" },
      },
    });
    const fetchUrl = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.fxtwitter.com/")) {
        return { status: 200, text: tweetJson };
      }
      throw new Error("should not fetch the page directly");
    });
    const deps = makeDeps({ fetchUrl });
    const outcome = await processUrl(
      "https://x.com/someone/status/123",
      deps,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.title).toContain("@someone");
    const [, content] = (deps.app.vault.create as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, string];
    expect(content).toContain('source: "intake-fxtwitter"');
  });
});
