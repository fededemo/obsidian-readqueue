import type { ArticleSource } from "./highlights-data";

/**
 * El ritual diario (C1): un highlight, con qué se conecta, y qué leer hoy.
 *
 * La restricción de diseño es dura y no negociable: **tiene que caber en 60
 * segundos de lectura**. Un digest de 40 ítems no se lee, y un ritual que no
 * se lee no existe. Por eso es UN highlight, no cinco.
 *
 * Determinista por fecha: el mismo día produce lo mismo, así que abrirlo dos
 * veces no cambia nada y se puede regenerar sin miedo.
 */

export interface RitualHighlight {
  text: string;
  note: string;
  articleSource: ArticleSource;
  topic: string | undefined;
}

export interface RitualLink {
  note: string;
  why: string;
}

export interface RitualPick {
  note: string;
  why: string;
}

export interface DailyRitual {
  date: string;
  highlight: RitualHighlight | undefined;
  connections: RitualLink[];
  toRead: RitualPick[];
}

export interface BuildRitualInput {
  date: string;
  highlights: readonly RitualHighlight[];
  /** Notas ya leídas: título + topic. Fuente de las conexiones. */
  read: ReadonlyArray<{ note: string; topic: string | undefined }>;
  /** Notas-concepto: título + topic. Son los nodos del grafo. */
  concepts: ReadonlyArray<{ note: string; topic: string | undefined }>;
  /** Top de la cola ya priorizado (C2), con su motivo. */
  queueTop: ReadonlyArray<{ note: string; why: string }>;
  rng: () => number;
}

const MAX_CONNECTIONS = 2;
const MAX_TO_READ = 2;

/**
 * Elige el highlight del día. Round-robin por fuente igual que el resurfacing
 * existente, para que una vault con 700 highlights de Kindle no tape los de
 * web; la fuente arranca rotando por día.
 */
export function pickHighlightOfDay(
  highlights: readonly RitualHighlight[],
  rng: () => number,
): RitualHighlight | undefined {
  if (highlights.length === 0) return undefined;
  const sources: ArticleSource[] = ["web", "kindle", "matter"];
  const start = Math.floor(rng() * sources.length);
  for (let i = 0; i < sources.length; i++) {
    const source = sources[(start + i) % sources.length];
    const pool = highlights.filter((h) => h.articleSource === source);
    if (pool.length > 0) {
      return pool[Math.floor(rng() * pool.length)];
    }
  }
  return highlights[0];
}

/**
 * Con qué se conecta el highlight. Los conceptos van primero: son los nodos
 * del grafo, así que conectar con uno vale más que conectar con otra fuente
 * suelta.
 */
export function findConnections(
  highlight: RitualHighlight,
  input: Pick<BuildRitualInput, "read" | "concepts">,
): RitualLink[] {
  const topic = highlight.topic?.toLowerCase();
  if (!topic) return [];
  const out: RitualLink[] = [];

  for (const c of input.concepts) {
    if (c.topic?.toLowerCase() === topic) {
      out.push({ note: c.note, why: "concepto del mismo tema" });
    }
    if (out.length >= MAX_CONNECTIONS) return out;
  }
  for (const r of input.read) {
    if (r.note === highlight.note) continue;
    if (r.topic?.toLowerCase() === topic) {
      out.push({ note: r.note, why: `también leíste esto sobre ${topic}` });
    }
    if (out.length >= MAX_CONNECTIONS) return out;
  }
  return out;
}

export function buildDailyRitual(input: BuildRitualInput): DailyRitual {
  const highlight = pickHighlightOfDay(input.highlights, input.rng);
  return {
    date: input.date,
    highlight,
    connections: highlight ? findConnections(highlight, input) : [],
    toRead: input.queueTop.slice(0, MAX_TO_READ).map((q) => ({
      note: q.note,
      why: q.why,
    })),
  };
}

const wikilink = (note: string): string => `[[${note}]]`;

export function renderDailyRitual(ritual: DailyRitual): string {
  const lines = [`# Repaso — ${ritual.date}`, ""];

  if (!ritual.highlight) {
    lines.push("_Todavía no hay highlights para repasar._", "");
  } else {
    const h = ritual.highlight;
    lines.push("## Recordá esto", "");
    for (const l of h.text.split("\n")) lines.push(`> ${l}`);
    lines.push("", `— de ${wikilink(h.note)}`, "");

    if (ritual.connections.length > 0) {
      lines.push("## Se conecta con", "");
      for (const c of ritual.connections) {
        lines.push(`- ${wikilink(c.note)} — ${c.why}`);
      }
      lines.push("");
    }
  }

  if (ritual.toRead.length > 0) {
    lines.push("## Si tenés un rato", "");
    for (const t of ritual.toRead) {
      lines.push(`- ${wikilink(t.note)} — ${t.why}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
