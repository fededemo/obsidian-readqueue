import {
  extractTextFromMessage,
  postMessagesWithRetry,
  type AnthropicFetchDeps,
  type RetryOpts,
} from "./anthropic";

/**
 * "¿Qué leo ahora?" para la cola de artículos: Claude arma el orden.
 *
 * Dos llamadas, ninguna en el camino caliente de la UI:
 * - el PERFIL: Claude lee las señales contadas (reading-signals) y escribe una
 *   nota legible. Fede la corrige y la corrección manda sobre los datos.
 * - el RANKING: Claude ordena ~40 candidatos con ese perfil, el día y la hora.
 *
 * Todo puro y con fetch inyectable; main.ts junta los datos y persiste.
 */

export const DEFAULT_CURATE_MODEL = "claude-sonnet-5-5";

/** Modelos que aceptan `fallbacks: "default"` (rescate server-side si hay refusal). */
function supportsDefaultFallback(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

export interface CurateSettings {
  anthropicApiKey: string;
  curateModel: string;
}

export interface CurateDeps extends AnthropicFetchDeps {
  retry?: RetryOpts;
}

async function ask(
  prompt: string,
  settings: CurateSettings,
  deps: CurateDeps,
  maxTokens: number,
): Promise<{ status: number; text: string | undefined }> {
  const key = settings.anthropicApiKey?.trim();
  if (!key) return { status: 0, text: undefined };
  const model = settings.curateModel || DEFAULT_CURATE_MODEL;
  const fallback = supportsDefaultFallback(model);
  const res = await postMessagesWithRetry(
    deps.fetchJson,
    key,
    {
      model,
      max_tokens: maxTokens,
      // Sin `thinking`: en los modelos 5.x corre adaptativo y `disabled` es un 400.
      // `low` alcanza para ordenar y escribir; el criterio está en el prompt.
      output_config: { effort: "low" },
      ...(fallback ? { fallbacks: "default" } : {}),
      messages: [{ role: "user", content: prompt }],
    },
    { ...deps.retry, betas: fallback ? ["server-side-fallback-2026-07-01"] : [] },
  );
  if (res.status !== 200) return { status: res.status, text: undefined };
  const stop = (res.json as { stop_reason?: string } | undefined)?.stop_reason;
  if (stop === "refusal") return { status: res.status, text: undefined };
  return { status: res.status, text: extractTextFromMessage(res.json) };
}

// --- Perfil -------------------------------------------------------------------

export const CORRECTIONS_HEADING = "## Correcciones";

/**
 * Lo que Fede escribió bajo «Correcciones». Se preserva tal cual: la promesa de
 * "lo editás y aprende" es falsa si la próxima regeneración lo pisa.
 */
export function extractCorrections(profile: string | undefined): string {
  if (!profile) return "";
  const lines = profile.split("\n");
  const start = lines.findIndex((l) => l.trim() === CORRECTIONS_HEADING);
  if (start < 0) return "";
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Cuerpo sin frontmatter, para mandar el perfil anterior como contexto. */
export function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export function buildProfilePrompt(opts: {
  signals: string;
  previousProfile: string | undefined;
  today: string;
}): string {
  const corrections = extractCorrections(opts.previousProfile);
  return [
    "Sos el curador de lectura de Fede. Escribís su perfil de lectura: una nota corta, en español rioplatense, que después vas a usar vos mismo para decidir qué le conviene leer de su cola.",
    "",
    "Reglas:",
    "- Cada afirmación tiene que salir de las señales de abajo. Citá el dato (\"terminaste 9 de filosofía, 6 un domingo\"). Si algo es una sospecha con poca evidencia, decilo como sospecha.",
    "- Nada de halagos ni de frases genéricas (\"te gusta aprender\"). Si no hay patrón, no lo inventes.",
    "- Las CORRECCIONES de Fede son verdad por encima de los datos. Si contradicen una señal, gana la corrección y no la discutas.",
    "- Distinguí lo que guarda (likes, bookmarks) de lo que efectivamente termina: suelen no coincidir y esa diferencia es lo más útil del perfil.",
    "",
    "Formato: devolvé SOLO markdown con estas secciones, en este orden, sin título principal:",
    "## Lo que terminás",
    "## Lo que guardás pero no leés",
    "## Cuándo leés qué",
    "## Lo que pateás",
    "## Hipótesis a confirmar",
    "Viñetas cortas. Máximo ~250 palabras en total.",
    "",
    `Hoy: ${opts.today}`,
    "",
    "<correcciones_de_fede>",
    corrections || "(ninguna todavía)",
    "</correcciones_de_fede>",
    "",
    "<perfil_anterior>",
    opts.previousProfile ? stripFrontmatter(opts.previousProfile) : "(no hay: es la primera vez)",
    "</perfil_anterior>",
    "",
    "<senales>",
    opts.signals,
    "</senales>",
  ].join("\n");
}

export function renderProfileNote(opts: {
  body: string;
  corrections: string;
  generatedAt: string;
  model: string;
}): string {
  const body = opts.body
    .replace(/^```(?:markdown|md)?\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();
  return [
    "---",
    `generatedAt: ${opts.generatedAt}`,
    `model: ${opts.model}`,
    "---",
    "# Perfil de lectura",
    "",
    "> Lo escribe Claude con lo que hacés en la cola: lo que terminás, posponés y abandonás, y tus likes de X. Lo usa para ordenar la cola. Si algo no es cierto, escribilo en **Correcciones**: esa sección no se pisa nunca y manda sobre los datos.",
    "",
    CORRECTIONS_HEADING,
    "",
    opts.corrections || "- ",
    "",
    body,
    "",
  ].join("\n");
}

export async function generateProfile(
  opts: { signals: string; previousProfile: string | undefined; today: string; now?: Date },
  settings: CurateSettings,
  deps: CurateDeps,
): Promise<{ status: number; note: string | undefined }> {
  const { status, text } = await ask(buildProfilePrompt(opts), settings, deps, 6000);
  if (!text) return { status, note: undefined };
  return {
    status,
    note: renderProfileNote({
      body: text,
      corrections: extractCorrections(opts.previousProfile),
      generatedAt: (opts.now ?? new Date()).toISOString(),
      model: settings.curateModel || DEFAULT_CURATE_MODEL,
    }),
  };
}

// --- Ranking ------------------------------------------------------------------

export interface RankCandidate {
  path: string;
  title: string;
  themes: string[];
  source: string | undefined;
  shelfLife: string | undefined;
  ageDays: number | undefined;
  minutes: number | undefined;
  postponed: number;
  progress: string;
  tldr: string | undefined;
  /** Motivo del orden determinista, como pista y no como mandato. */
  hint: string;
}

export interface RankPick {
  path: string;
  why: string;
}

export function buildRankPrompt(opts: {
  candidates: readonly RankCandidate[];
  profile: string | undefined;
  signals: string;
  nowLabel: string;
}): string {
  const rows = opts.candidates.map((c, i) => {
    const bits = [
      c.themes.length ? `temas: ${c.themes.join(", ")}` : undefined,
      c.source ? `fuente: ${c.source}` : undefined,
      c.minutes ? `~${c.minutes} min` : undefined,
      c.ageDays !== undefined ? `${Math.round(c.ageDays)} días` : undefined,
      c.shelfLife,
      c.postponed > 0 ? `pospuesto ${c.postponed}x` : undefined,
      c.progress !== "sin-empezar" ? c.progress : undefined,
      `pista: ${c.hint}`,
    ].filter(Boolean);
    const tldr = c.tldr ? `\n    tldr: ${c.tldr}` : "";
    return `[${i}] ${c.title}\n    ${bits.join(" · ")}${tldr}`;
  });
  return [
    "Sos el curador de lectura de Fede. Ordená su cola: qué le conviene leer AHORA, con este día y esta hora.",
    "",
    "Criterio:",
    "- Pesa más lo que efectivamente termina que lo que guarda. Usá el perfil y las señales.",
    "- Mirá la franja: si en esta franja suele terminar cosas cortas, no le subas un ensayo de 40 minutos.",
    "- Algo empezado y abandonado no va arriba salvo que haya una razón concreta para retomarlo hoy.",
    "- Algo pospuesto muchas veces baja: si lo seguís subiendo, lo vuelve a patear.",
    "- Exploración: entre los primeros 5, dejá 1 lugar para un tema donde la señal es poca o nula, así el perfil no lo encierra.",
    "- El `why` es una línea (máx. 15 palabras), en español rioplatense, hablándole de vos, citando una señal concreta (\"terminás estos los domingos a la noche\"). Prohibido el relleno (\"interesante\", \"vale la pena\", \"te va a gustar\"). Si no hay una razón fuerte, decí la más honesta.",
    "",
    "Devolvé SOLO JSON, sin texto alrededor:",
    '{"ranking":[{"i":<índice>,"why":"<una línea>"}, ...]}',
    "Incluí todos los índices, del más conveniente al menos.",
    "",
    `Ahora: ${opts.nowLabel}`,
    "",
    "<perfil>",
    opts.profile ? stripFrontmatter(opts.profile) : "(todavía no hay perfil: guiate por las señales)",
    "</perfil>",
    "",
    "<senales>",
    opts.signals,
    "</senales>",
    "",
    "<candidatos>",
    ...rows,
    "</candidatos>",
  ].join("\n");
}

/**
 * Índices, no títulos: un índice fuera de rango o repetido se descarta. Claude
 * no puede colar en la cola algo que no estaba.
 */
export function parseRanking(text: string, candidates: readonly RankCandidate[]): RankPick[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { ranking?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { ranking?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.ranking)) return [];
  const seen = new Set<number>();
  const out: RankPick[] = [];
  for (const raw of parsed.ranking as Array<{ i?: unknown; why?: unknown }>) {
    const i = typeof raw?.i === "number" ? raw.i : Number.NaN;
    if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue;
    seen.add(i);
    const why = typeof raw.why === "string" ? raw.why.trim() : "";
    out.push({ path: (candidates[i] as RankCandidate).path, why });
  }
  return out;
}

export async function rankWithClaude(
  opts: Parameters<typeof buildRankPrompt>[0],
  settings: CurateSettings,
  deps: CurateDeps,
): Promise<{ status: number; picks: RankPick[] }> {
  if (opts.candidates.length === 0) return { status: 0, picks: [] };
  const { status, text } = await ask(buildRankPrompt(opts), settings, deps, 8000);
  return { status, picks: text ? parseRanking(text, opts.candidates) : [] };
}

// --- Cache y aplicación -------------------------------------------------------

export interface CuratedRanking {
  /** "2026-10-11|tarde": un orden vale para una franja de un día. */
  slot: string;
  generatedAt: string;
  picks: RankPick[];
}

/**
 * Reordena una lista ya rankeada con el orden de Claude. Lo que Claude no vio
 * (llegó después, o quedó fuera del prefiltro) mantiene su orden determinista
 * debajo. Puro y barato: corre en cada render.
 */
export function applyCuratedRanking<T extends { path: string; reason: string }>(
  ranked: readonly T[],
  curated: CuratedRanking | undefined,
): { items: T[]; curated: boolean } {
  if (!curated || curated.picks.length === 0) return { items: [...ranked], curated: false };
  const byPath = new Map(ranked.map((r) => [r.path, r]));
  const used = new Set<string>();
  const head: T[] = [];
  for (const p of curated.picks) {
    const item = byPath.get(p.path);
    if (!item || used.has(p.path)) continue;
    used.add(p.path);
    head.push(p.why ? { ...item, reason: p.why } : item);
  }
  if (head.length === 0) return { items: [...ranked], curated: false };
  return { items: [...head, ...ranked.filter((r) => !used.has(r.path))], curated: true };
}
