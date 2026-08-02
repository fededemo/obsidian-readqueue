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
  /** "¿Todavía te importa?" — como mucho una por semana (ADR-005 §5). */
  reconsider: RitualReconsider | undefined;
}

export interface RitualReconsider {
  note: string;
  months: number;
  tldr: string | undefined;
}

/** Candidata a reconsiderar: pendiente, vieja y todavía vigente. */
export interface ReconsiderCandidate {
  note: string;
  shelfLife: string | undefined;
  /** Antigüedad en días desde que entró a la cola. */
  ageDays: number;
  tldr?: string | undefined;
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
  /** Cola completa con antigüedad y vida útil, para "Reconsiderar". */
  queue?: readonly ReconsiderCandidate[];
  rng: () => number;
}

const MAX_CONNECTIONS = 2;
const MAX_TO_READ = 2;
/** Medio año sin abrirla ya es una respuesta; antes de eso preguntar es apurar. */
const RECONSIDER_MIN_DAYS = 180;
/** Día de la semana fijo: así "como mucho una por semana" es una garantía, no un promedio. */
const RECONSIDER_WEEKDAY = 0;

/**
 * "¿Todavía te importa?" — pero solo sobre lo que sigue valiendo.
 *
 * ADR-005 §5 marcaba el riesgo: preguntar por cualquier cosa vieja convierte la
 * vault en una máquina de culpa. `shelfLife` lo resuelve. Un `perishable` de
 * hace ocho meses no hay que reconsiderarlo, hay que descartarlo sin culpa; un
 * `seasonal` viejo ya perdió el tren. El único caso donde la pregunta es honesta
 * es el `evergreen`: sigue vigente, y no lo leíste. Ahí sí es una decisión.
 *
 * Determinista por fecha y acotada a un día de la semana, así que aparece como
 * mucho una vez cada siete días — el cap que pedía el ADR, garantizado por
 * construcción y no por un contador que hay que persistir.
 */
export function pickReconsider(
  queue: readonly ReconsiderCandidate[],
  date: string,
  rng: () => number,
): RitualReconsider | undefined {
  const day = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.getUTCDay() !== RECONSIDER_WEEKDAY) return undefined;
  const eligible = queue.filter(
    (c) => c.shelfLife === "evergreen" && c.ageDays >= RECONSIDER_MIN_DAYS,
  );
  if (eligible.length === 0) return undefined;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  if (!pick) return undefined;
  return {
    note: pick.note,
    months: Math.round(pick.ageDays / 30),
    tldr: pick.tldr,
  };
}

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
    reconsider: pickReconsider(input.queue ?? [], input.date, input.rng),
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

  if (ritual.reconsider) {
    const r = ritual.reconsider;
    lines.push("## ¿Todavía te importa?", "");
    lines.push(`${wikilink(r.note)} — hace ${r.months} meses que está en la cola.`);
    if (r.tldr) lines.push("", `> ${r.tldr}`);
    lines.push(
      "",
      "Sigue vigente (`evergreen`), así que la pregunta es de verdad: **leelo o borralo.**",
      "Dejarlo ahí un año más no es una tercera opción.",
      "",
    );
  }
  return lines.join("\n");
}
