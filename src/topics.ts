import {
  extractTextFromMessage,
  postMessagesWithRetry,
  type RetryOpts,
} from "./anthropic";

export const DEFAULT_TOPIC_LIST: readonly string[] = [
  "tech",
  "producto",
  "macro",
  "ciencia",
  "personal",
  "cultura",
  "otros",
];

export const DEFAULT_TOPIC_DESCRIPTIONS: Readonly<Record<string, string>> = {
  tech: "software engineering, AI/ML, LLMs, programming, infrastructure, developer tooling, hardware, semiconductors, technical how-it-works explainers",
  producto:
    "startups, founders, business strategy, product, growth, investing, company or founder profiles and biographies, venture",
  macro: "economics, finance, monetary policy, geopolitics, trade, public policy, regulation, monopolies, economic history",
  ciencia:
    "scientific research, biology, genetics, medicine, health, neuroscience, physics, energy, progress studies, data",
  personal:
    "productivity, habits, focus, creativity, self-improvement, life advice, psychology of the self, mental health",
  cultura:
    "history, society, philosophy, urbanism and cities, transport and infrastructure history, anthropology, social status and human behavior, arts, books, fiction, culture commentary",
  otros: "use ONLY if the article genuinely fits none of the topics above",
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
};

export interface ClassifyInput {
  title: string;
  excerpt: string;
  domain: string;
  source: string | undefined;
  description?: string;
  tags?: readonly string[];
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
  retry?: RetryOpts;
}

export const FALLBACK_TOPIC = "otros";
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

export interface ClassifyPromptInput {
  title: string;
  excerpt: string;
  domain?: string;
  description?: string;
  tags?: readonly string[];
}

export function buildClassifyPrompt(
  topics: readonly string[],
  descriptions: Readonly<Record<string, string>>,
  input: ClassifyPromptInput,
): string {
  const list = topics
    .map((t) => `- ${t}: ${descriptions[t] ?? "specific topic"}`)
    .join("\n");
  const tags = (input.tags ?? []).filter((t) => t && t !== "clippings");
  const lines = [
    "You are categorizing a saved reading-queue article into ONE topic from a closed list.",
    "Pick the single best fit by SUBJECT MATTER. Almost every article fits a named topic; use 'otros' only as a true last resort.",
    "",
    "Topics:",
    list,
    "",
    `Title: ${input.title}`,
  ];
  if (input.domain) lines.push(`Domain: ${input.domain}`);
  if (input.description) lines.push(`Summary: ${input.description}`);
  if (tags.length > 0) lines.push(`Existing tags: ${tags.join(", ")}`);
  lines.push(
    "",
    "First 600 characters of the content:",
    input.excerpt.slice(0, 600),
    "",
    'Reply with ONLY a JSON object on a single line: {"topic":"<one>","tags":["t1","t2"]}. Lowercase, no spaces in tags, no leading #. Use the closed topic list above.',
  );
  return lines.join("\n");
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
  const prompt = buildClassifyPrompt(topics, descriptions, {
    title: input.title,
    excerpt: input.excerpt,
    domain: input.domain,
    description: input.description,
    tags: input.tags,
  });
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const response = await postMessagesWithRetry(
    fetchJson,
    key,
    {
      model: settings.classifyModel ?? DEFAULT_MODEL,
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    },
    deps.retry,
  );

  if (response.status !== 200) return undefined;
  const text = extractTextFromMessage(response.json);
  if (!text) return undefined;

  return parseClassifyReply(text, topics);
}

export async function classifyTopic(
  input: ClassifyInput,
  settings: ClassifySettings,
  deps: ClassifyDeps = {},
): Promise<ClassifyResult> {
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
