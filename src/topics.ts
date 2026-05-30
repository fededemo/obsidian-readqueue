export const DEFAULT_TOPIC_LIST: readonly string[] = [
  "tech",
  "producto",
  "macro",
  "ciencia",
  "personal",
  "cultura",
  "tweet",
  "otros",
];

export const DEFAULT_TOPIC_DESCRIPTIONS: Readonly<Record<string, string>> = {
  tech: "software engineering, AI/ML, programming, infrastructure, developer tooling",
  producto: "startups, business strategy, product management, growth, design decisions",
  macro: "economics, finance, geopolitics, markets, monetary policy",
  ciencia: "scientific research, data, biology, progress studies, energy, physics",
  personal: "habits, productivity, psychology, life advice, self-improvement",
  cultura: "society, philosophy, history, arts, books, culture commentary",
  tweet: "any short-form social media post (Twitter/X)",
  otros: "anything that does not clearly fit the other topics",
};

export const DEFAULT_PUBLISHER_TOPIC_MAP: Readonly<Record<string, string>> = {
  "paulgraham.com": "tech",
  "pragmaticengineer.com": "tech",
  "thorstenball.com": "tech",
  "lawsofsoftwareengineering.com": "tech",
  "techcrunch.com": "tech",
  "tryolabs.com": "tech",
  "stratechery.com": "producto",
  "hey.com": "producto",
  "world.hey.com": "producto",
  "joincolossus.com": "producto",
  "every.to": "producto",
  "lennysnewsletter.com": "producto",
  "economist.com": "macro",
  "wsj.com": "macro",
  "noahpinion.substack.com": "macro",
  "noahpinion.blog": "macro",
  "ft.com": "macro",
  "bloomberg.com": "macro",
  "ourworldindata.org": "ciencia",
  "rootsofprogress.org": "ciencia",
  "worksinprogress.co": "ciencia",
  "nature.com": "ciencia",
  "jamesclear.com": "personal",
  "blog.jamesclear.com": "personal",
  "nesslabs.com": "personal",
  "fs.blog": "personal",
  "theatlantic.com": "cultura",
  "newyorker.com": "cultura",
  "twitter.com": "tweet",
  "x.com": "tweet",
  "fxtwitter.com": "tweet",
  "fixupx.com": "tweet",
  "vxtwitter.com": "tweet",
};

export interface ClassifyInput {
  title: string;
  excerpt: string;
  domain: string;
  source: string | undefined;
}

export interface ClassifySettings {
  topics: readonly string[];
  publisherTopicMap: Readonly<Record<string, string>>;
  topicDescriptions?: Readonly<Record<string, string>>;
  anthropicApiKey?: string;
  classifyModel?: string;
  useClaudeForClassification?: boolean;
}

export interface ClassifyDeps {
  fetchJson?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: unknown }>;
}

const FALLBACK_TOPIC = "otros";
const DEFAULT_MODEL = "claude-haiku-4-5";

const normalizeDomain = (raw: string): string =>
  raw.trim().toLowerCase().replace(/^www\./, "");

export function classifyFromPublisher(
  domain: string,
  map: Readonly<Record<string, string>> = DEFAULT_PUBLISHER_TOPIC_MAP,
): string | undefined {
  const key = normalizeDomain(domain);
  if (!key) return undefined;
  return map[key];
}

export function buildClassifyPrompt(
  topics: readonly string[],
  descriptions: Readonly<Record<string, string>>,
  title: string,
  excerpt: string,
): string {
  const list = topics
    .map((t) => `- ${t}: ${descriptions[t] ?? "specific topic"}`)
    .join("\n");
  return [
    "Classify the following article. Pick ONE topic from this closed list and 2-3 short lowercase tags that describe the article more specifically.",
    "",
    list,
    "",
    `Title: ${title}`,
    "",
    `First 600 characters of the content:`,
    excerpt.slice(0, 600),
    "",
    'Reply with ONLY a JSON object on a single line: {"topic":"<one>","tags":["t1","t2"]}. Lowercase, no spaces in tags, no leading #. Use the closed topic list above.',
  ].join("\n");
}

export interface ClassifyResult {
  topic: string;
  tags: string[];
}

function sanitizeTag(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  if (!cleaned || cleaned.length > 32) return undefined;
  return cleaned;
}

function parseClassifyReply(
  text: string,
  topics: readonly string[],
): ClassifyResult | undefined {
  const lower = text.trim();
  if (!lower) return undefined;
  let parsed: { topic?: unknown; tags?: unknown } | undefined;
  const jsonMatch = lower.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]) as { topic?: unknown; tags?: unknown };
    } catch {
      parsed = undefined;
    }
  }

  let topic: string | undefined;
  if (parsed && typeof parsed.topic === "string") {
    const t = parsed.topic.toLowerCase().trim();
    topic = topics.find((x) => x.toLowerCase() === t);
  }
  if (!topic) {
    const lowerText = lower.toLowerCase();
    topic = topics.find((x) => lowerText.includes(x.toLowerCase()));
  }
  if (!topic) return undefined;

  const tags: string[] = [];
  if (parsed && Array.isArray(parsed.tags)) {
    for (const raw of parsed.tags) {
      const clean = sanitizeTag(raw);
      if (clean && !tags.includes(clean)) tags.push(clean);
      if (tags.length >= 4) break;
    }
  }
  return { topic, tags };
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

const defaultFetchJson: NonNullable<ClassifyDeps["fetchJson"]> = async (
  url,
  init,
) => {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
};

export async function classifyWithClaude(
  input: ClassifyInput,
  settings: ClassifySettings,
  deps: ClassifyDeps = {},
): Promise<ClassifyResult | undefined> {
  const key = settings.anthropicApiKey?.trim();
  if (!key) return undefined;

  const topics = settings.topics.length > 0 ? settings.topics : DEFAULT_TOPIC_LIST;
  const descriptions = settings.topicDescriptions ?? DEFAULT_TOPIC_DESCRIPTIONS;
  const prompt = buildClassifyPrompt(
    topics,
    descriptions,
    input.title,
    input.excerpt,
  );
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const body = JSON.stringify({
    model: settings.classifyModel ?? DEFAULT_MODEL,
    max_tokens: 80,
    messages: [{ role: "user", content: prompt }],
  });

  let response: { status: number; json: unknown };
  try {
    response = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body,
    });
  } catch {
    return undefined;
  }

  if (response.status !== 200) return undefined;
  const data = response.json as AnthropicResponse | undefined;
  const text = data?.content?.[0]?.text?.trim();
  if (!text) return undefined;

  return parseClassifyReply(text, topics);
}

export async function classifyTopic(
  input: ClassifyInput,
  settings: ClassifySettings,
  deps: ClassifyDeps = {},
): Promise<ClassifyResult> {
  if (input.source === "intake-fxtwitter") return { topic: "tweet", tags: [] };

  if (settings.useClaudeForClassification !== false && settings.anthropicApiKey?.trim()) {
    const fromClaude = await classifyWithClaude(input, settings, deps);
    if (fromClaude) return fromClaude;
  }

  const fromPublisher = classifyFromPublisher(
    input.domain,
    settings.publisherTopicMap,
  );
  if (fromPublisher) return { topic: fromPublisher, tags: [] };

  return { topic: FALLBACK_TOPIC, tags: [] };
}
