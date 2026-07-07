import { describe, expect, it, vi } from "vitest";

import {
  extractTextFromMessage,
  postMessagesWithRetry,
} from "../src/anthropic";

const noSleep = { sleep: async () => {} };

describe("postMessagesWithRetry", () => {
  it("returns immediately on 200 (single call)", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: 200, json: { ok: true } });
    const res = await postMessagesWithRetry(fetchJson, "sk", { model: "m" }, noSleep);
    expect(res.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("retries once on 500 then succeeds", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, json: undefined })
      .mockResolvedValueOnce({ status: 200, json: { ok: true } });
    const res = await postMessagesWithRetry(fetchJson, "sk", { model: "m" }, noSleep);
    expect(res.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("retries on 429", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, json: undefined })
      .mockResolvedValueOnce({ status: 200, json: {} });
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, noSleep);
    expect(res.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: 400, json: undefined });
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, noSleep);
    expect(res.status).toBe(400);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("recovers from a thrown network error by retrying", async () => {
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ status: 200, json: {} });
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, noSleep);
    expect(res.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("returns status 0 when all attempts throw", async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error("network"));
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, noSleep);
    expect(res.status).toBe(0);
    expect(fetchJson).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  it("obeys the retry-after header on a 429", async () => {
    const sleeps: number[] = [];
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, json: undefined, headers: { "retry-after": "2" } })
      .mockResolvedValueOnce({ status: 200, json: {} });
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    expect(res.status).toBe(200);
    expect(sleeps[0]).toBe(2000); // waited the retry-after 2s, not the shorter backoff
  });

  it("respects retries: 0 (no retry, no sleep)", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: 500, json: undefined });
    const res = await postMessagesWithRetry(fetchJson, "sk", {}, { retries: 0 });
    expect(res.status).toBe(500);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("sends the canonical Anthropic endpoint + headers", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: 200, json: {} });
    await postMessagesWithRetry(fetchJson, "sk-ant-x", { model: "m" }, noSleep);
    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-ant-x");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body)).toEqual({ model: "m" });
  });
});

describe("extractTextFromMessage", () => {
  it("joins text blocks and skips thinking blocks", () => {
    const json = {
      content: [
        { type: "thinking", text: "" },
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(extractTextFromMessage(json)).toBe("hello world");
  });

  it("returns undefined for empty / malformed", () => {
    expect(extractTextFromMessage(undefined)).toBeUndefined();
    expect(extractTextFromMessage({})).toBeUndefined();
    expect(extractTextFromMessage({ content: [{ type: "thinking", text: "" }] })).toBeUndefined();
  });
});
