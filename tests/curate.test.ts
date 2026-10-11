import { describe, expect, it } from "vitest";

import {
  applyCuratedRanking,
  buildProfilePrompt,
  buildRankPrompt,
  extractCorrections,
  generateProfile,
  parseRanking,
  rankWithClaude,
  renderProfileNote,
  type RankCandidate,
} from "../src/curate";

const cand = (path: string, over: Partial<RankCandidate> = {}): RankCandidate => ({
  path,
  title: path.replace(".md", ""),
  themes: ["filosofia"],
  source: undefined,
  shelfLife: "evergreen",
  ageDays: 10,
  minutes: 12,
  postponed: 0,
  progress: "sin-empezar",
  tldr: undefined,
  hint: "sin contexto previo",
  ...over,
});

const reply = (text: string, stop = "end_turn") => ({
  stop_reason: stop,
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
});

const PROFILE_WITH_FIX = [
  "---",
  "generatedAt: 2026-10-01T00:00:00.000Z",
  "---",
  "# Perfil de lectura",
  "",
  "## Correcciones",
  "",
  "- No me interesa más el crypto, aunque haya likes.",
  "",
  "## Lo que terminás",
  "- Ensayos de filosofía los domingos.",
].join("\n");

describe("extractCorrections", () => {
  it("devuelve lo que Fede escribió bajo Correcciones, hasta la próxima sección", () => {
    expect(extractCorrections(PROFILE_WITH_FIX)).toBe(
      "- No me interesa más el crypto, aunque haya likes.",
    );
  });

  it("sin perfil o sin sección, vacío", () => {
    expect(extractCorrections(undefined)).toBe("");
    expect(extractCorrections("# Perfil\n\n## Lo que terminás\n- x")).toBe("");
  });
});

describe("perfil", () => {
  it("el prompt lleva las correcciones, el perfil anterior y las señales", () => {
    const p = buildProfilePrompt({ signals: "Totales: 3 leídas", previousProfile: PROFILE_WITH_FIX, today: "2026-10-11" });
    expect(p).toContain("No me interesa más el crypto");
    expect(p).toContain("Ensayos de filosofía los domingos");
    expect(p).toContain("Totales: 3 leídas");
    expect(p).not.toContain("generatedAt");
  });

  it("al regenerar, las correcciones sobreviven aunque Claude no las repita", async () => {
    const res = await generateProfile(
      { signals: "s", previousProfile: PROFILE_WITH_FIX, today: "2026-10-11", now: new Date("2026-10-11T12:00:00Z") },
      { anthropicApiKey: "sk", curateModel: "claude-sonnet-5-5" },
      { fetchJson: async () => ({ status: 200, json: reply("## Lo que terminás\n- Filosofía.") }), retry: { retries: 0 } },
    );
    expect(res.note).toContain("- No me interesa más el crypto, aunque haya likes.");
    expect(res.note).toContain("## Lo que terminás\n- Filosofía.");
    expect(res.note).toContain("generatedAt: 2026-10-11T12:00:00.000Z");
  });

  it("renderProfileNote limpia un fence de markdown alrededor del cuerpo", () => {
    const note = renderProfileNote({ body: "```markdown\n## A\n- b\n```", corrections: "", generatedAt: "t", model: "m" });
    expect(note).toContain("## A\n- b");
    expect(note).not.toContain("```");
  });

  it("sin API key no llama", async () => {
    let called = false;
    const res = await generateProfile(
      { signals: "s", previousProfile: undefined, today: "x" },
      { anthropicApiKey: "", curateModel: "m" },
      { fetchJson: async () => { called = true; return { status: 200, json: {} }; } },
    );
    expect(res.note).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe("ranking", () => {
  const cands = [cand("a.md"), cand("b.md", { postponed: 3 }), cand("c.md", { progress: "abandonado" })];

  it("el prompt numera los candidatos y lleva sus señales", () => {
    const p = buildRankPrompt({ candidates: cands, profile: undefined, signals: "sig", nowLabel: "domingo, noche" });
    expect(p).toContain("[0] a");
    expect(p).toContain("pospuesto 3x");
    expect(p).toContain("abandonado");
    expect(p).toContain("domingo, noche");
  });

  it("parseRanking descarta índices inventados, repetidos o no enteros", () => {
    const text = 'acá va: {"ranking":[{"i":2,"why":"retomalo"},{"i":7,"why":"no existe"},{"i":2,"why":"dup"},{"i":"0"},{"i":0.5},{"i":0,"why":" corto "}]}';
    expect(parseRanking(text, cands)).toEqual([
      { path: "c.md", why: "retomalo" },
      { path: "a.md", why: "corto" },
    ]);
  });

  it("parseRanking tolera basura", () => {
    expect(parseRanking("no hay json", cands)).toEqual([]);
    expect(parseRanking("{roto", cands)).toEqual([]);
    expect(parseRanking('{"ranking":"x"}', cands)).toEqual([]);
  });

  it("manda el modelo, effort bajo y el fallback server-side, sin thinking", async () => {
    let sent: { body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    const res = await rankWithClaude(
      { candidates: cands, profile: undefined, signals: "", nowLabel: "x" },
      { anthropicApiKey: "sk", curateModel: "claude-sonnet-5-5" },
      {
        fetchJson: async (_url, init) => {
          sent = { body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers };
          return { status: 200, json: reply('{"ranking":[{"i":1,"why":"w"}]}') };
        },
        retry: { retries: 0 },
      },
    );
    expect(res.picks).toEqual([{ path: "b.md", why: "w" }]);
    expect(sent?.body["model"]).toBe("claude-sonnet-5-5");
    expect(sent?.body["output_config"]).toEqual({ effort: "low" });
    expect(sent?.body["fallbacks"]).toBe("default");
    expect(sent?.body["thinking"]).toBeUndefined();
    expect(sent?.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
  });

  it("un modelo sin fallback default no manda el beta", async () => {
    let headers: Record<string, string> = {};
    await rankWithClaude(
      { candidates: cands, profile: undefined, signals: "", nowLabel: "x" },
      { anthropicApiKey: "sk", curateModel: "claude-haiku-4-5" },
      {
        fetchJson: async (_url, init) => {
          headers = init.headers;
          return { status: 200, json: reply("{}") };
        },
        retry: { retries: 0 },
      },
    );
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("un refusal o un error dejan el orden determinista", async () => {
    const refused = await rankWithClaude(
      { candidates: cands, profile: undefined, signals: "", nowLabel: "x" },
      { anthropicApiKey: "sk", curateModel: "claude-sonnet-5-5" },
      { fetchJson: async () => ({ status: 200, json: reply('{"ranking":[{"i":0}]}', "refusal") }), retry: { retries: 0 } },
    );
    expect(refused.picks).toEqual([]);
    const failed = await rankWithClaude(
      { candidates: cands, profile: undefined, signals: "", nowLabel: "x" },
      { anthropicApiKey: "sk", curateModel: "claude-sonnet-5-5" },
      { fetchJson: async () => ({ status: 529, json: undefined }), retry: { retries: 0 } },
    );
    expect(failed).toEqual({ status: 529, picks: [] });
  });
});

describe("applyCuratedRanking", () => {
  const ranked = [
    { path: "a.md", reason: "det a" },
    { path: "b.md", reason: "det b" },
    { path: "c.md", reason: "det c" },
    { path: "d.md", reason: "det d" },
  ];

  it("pone arriba lo que eligió Claude con su motivo; el resto queda en orden determinista", () => {
    const { items, curated } = applyCuratedRanking(ranked, {
      slot: "s",
      generatedAt: "t",
      picks: [
        { path: "c.md", why: "hoy es domingo" },
        { path: "gone.md", why: "ya no está" },
        { path: "a.md", why: "" },
      ],
    });
    expect(curated).toBe(true);
    expect(items.map((i) => i.path)).toEqual(["c.md", "a.md", "b.md", "d.md"]);
    expect(items[0]?.reason).toBe("hoy es domingo");
    expect(items[1]?.reason).toBe("det a");
  });

  it("sin orden de Claude, o si ninguno sigue en la cola, no toca nada", () => {
    expect(applyCuratedRanking(ranked, undefined)).toEqual({ items: ranked, curated: false });
    expect(
      applyCuratedRanking(ranked, { slot: "s", generatedAt: "t", picks: [{ path: "x.md", why: "" }] }).curated,
    ).toBe(false);
  });
});
