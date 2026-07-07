// Shared Anthropic Messages API plumbing (MX25). Both the topic classifier and
// the book recommender talk to /v1/messages via an injectable fetchJson (wired
// to Obsidian's requestUrl in main.ts, which bypasses CORS). Centralizing this
// pays down existing debt: the classifier had no retry, so a transient 429/5xx
// silently produced `undefined`. Now both paths get one bounded retry.

export interface AnthropicFetchDeps {
  fetchJson: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: unknown; headers?: Record<string, string> }>;
}

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };
}

const RETRYABLE = (status: number): boolean => status === 429 || status >= 500;

export interface RetryOpts {
  /** Extra attempts after the first (default 1 → up to 2 total). */
  retries?: number;
  baseDelayMs?: number;
  /** Injectable for tests (default real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Honors the API's `retry-after` header (seconds) on a 429/529, capped. */
function retryAfterMs(headers: Record<string, string> | undefined): number {
  if (!headers) return 0;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  const secs = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(secs) ? Math.min(Math.max(secs, 0), 90) * 1000 : 0;
}

/**
 * POST a Messages request with a bounded retry on 429/5xx (and on thrown network
 * errors). Returns the last {status, json}; on repeated network failure returns
 * status 0. Never throws — callers degrade gracefully (no classification / no
 * recommendation) rather than blowing up a background job.
 */
export async function postMessagesWithRetry(
  fetchJson: AnthropicFetchDeps["fetchJson"],
  apiKey: string,
  body: Record<string, unknown>,
  opts: RetryOpts = {},
): Promise<{ status: number; json: unknown }> {
  const retries = opts.retries ?? 1;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const init = {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body),
  };

  let last: { status: number; json: unknown; headers?: Record<string, string> } = {
    status: 0,
    json: undefined,
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      last = await fetchJson(ANTHROPIC_MESSAGES_URL, init);
    } catch {
      last = { status: 0, json: undefined };
    }
    if (last.status === 200) return last;
    if (attempt < retries && (last.status === 0 || RETRYABLE(last.status))) {
      // Rate limit / overload: obey retry-after when given, else exponential
      // backoff. This is what lets a burst of scoring batches drain instead of
      // failing under the per-minute token limit.
      const backoff = baseDelayMs * Math.pow(2, attempt);
      await sleep(Math.max(retryAfterMs(last.headers), backoff));
      continue;
    }
    return last;
  }
  return last;
}

interface AnthropicMessage {
  content?: Array<{ type?: string; text?: string }>;
}

/**
 * Joins every `text`-type content block. Robust to models that emit `thinking`
 * blocks first (e.g. Sonnet with adaptive thinking) — reading `content[0].text`
 * would return the empty thinking block instead of the answer.
 */
export function extractTextFromMessage(json: unknown): string | undefined {
  const data = json as AnthropicMessage | undefined;
  if (!data?.content || !Array.isArray(data.content)) return undefined;
  const text = data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  return text || undefined;
}
