import type { QueueArticle } from "./queue-data";
import { END_OF_ARTICLE_THRESHOLD, RESTORE_MIN_RATIO, type ScrollStore } from "./scroll-memory";

/**
 * Lo que Fede HIZO con cada nota, resumido para que Claude arme el perfil y el
 * ranking. Sin log de eventos aparte: todo sale del frontmatter (viaja por Sync)
 * y del progreso de lectura que ya guarda scroll-memory.
 *
 * El módulo no decide nada: cuenta. El criterio lo pone el LLM, pero sobre datos
 * que son ciertos — si dice "lo abandonaste dos veces", es porque acá lo contamos.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sin volver a tocarla en este tiempo, una nota empezada cuenta como abandonada. */
export const ABANDON_AFTER_DAYS = 7;
/** Una señal de hace HALF_LIFE_DAYS pesa la mitad que una de hoy: el gusto cambia. */
export const HALF_LIFE_DAYS = 60;

export type Daypart = "mañana" | "tarde" | "noche";
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

export function daypart(d: Date): Daypart {
  const h = d.getHours();
  if (h >= 5 && h < 13) return "mañana";
  if (h >= 13 && h < 20) return "tarde";
  return "noche";
}

/** "dom-noche": la franja en la que se decide qué leer. */
export function slotKey(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}-${daypart(d)}`;
}

export type Progress = "sin-empezar" | "empezado" | "abandonado";

export function progressOf(
  article: QueueArticle,
  scroll: ScrollStore,
  now: Date,
): { state: Progress; ratio: number | undefined } {
  const entry = scroll[article.file.path];
  const ratio = entry?.ratio;
  if (!entry || ratio === undefined || ratio < RESTORE_MIN_RATIO || ratio >= END_OF_ARTICLE_THRESHOLD) {
    return { state: "sin-empezar", ratio };
  }
  const idle = now.getTime() - entry.updatedAt;
  return { state: idle > ABANDON_AFTER_DAYS * DAY_MS ? "abandonado" : "empezado", ratio };
}

function decay(when: Date | undefined, now: Date): number {
  if (!when) return 0.5;
  const age = Math.max(0, (now.getTime() - when.getTime()) / DAY_MS);
  return Math.pow(0.5, age / HALF_LIFE_DAYS);
}

export interface SignalsInput {
  /** Notas sin leer (la cola). */
  queue: readonly QueueArticle[];
  /** Notas leídas, estén donde estén (Web o archivo de leídos). */
  read: readonly QueueArticle[];
  /** Likes y bookmarks de X que no entraron a la cola: señal de gusto, no de lectura. */
  liked: readonly QueueArticle[];
  scroll: ScrollStore;
  conceptsByNote: ReadonlyMap<string, readonly string[]>;
  now: Date;
}

export interface ConceptAffinity {
  concept: string;
  /** Positivo = terminás y likeás; negativo = posponés y abandonás. Con decaimiento. */
  score: number;
  finished: number;
  liked: number;
  postponed: number;
  abandoned: number;
}

export interface SlotHabit {
  slot: string;
  finished: number;
  postponed: number;
}

export interface ReadingSignals {
  affinities: ConceptAffinity[];
  slots: SlotHabit[];
  recentFinished: Array<{ title: string; when: string; concepts: string[] }>;
  recentLiked: string[];
  abandoned: string[];
  inProgress: string[];
  totals: { read: number; liked: number; queue: number; postponed: number; abandoned: number };
}

function themesOf(a: QueueArticle, conceptsByNote: SignalsInput["conceptsByNote"]): string[] {
  const concepts = conceptsByNote.get(a.title) ?? conceptsByNote.get(a.file.basename);
  if (concepts && concepts.length > 0) return [...concepts];
  return a.topic ? [a.topic.toLowerCase()] : [];
}

export function collectSignals(input: SignalsInput): ReadingSignals {
  const { now, conceptsByNote } = input;
  const aff = new Map<string, ConceptAffinity>();
  const bump = (
    themes: string[],
    field: "finished" | "liked" | "postponed" | "abandoned",
    weight: number,
  ): void => {
    for (const c of themes) {
      const cur = aff.get(c) ?? { concept: c, score: 0, finished: 0, liked: 0, postponed: 0, abandoned: 0 };
      cur[field] += 1;
      cur.score += weight;
      aff.set(c, cur);
    }
  };
  const slots = new Map<string, SlotHabit>();
  const slot = (d: Date): SlotHabit => {
    const k = slotKey(d);
    const cur = slots.get(k) ?? { slot: k, finished: 0, postponed: 0 };
    slots.set(k, cur);
    return cur;
  };

  for (const a of input.read) {
    const themes = themesOf(a, conceptsByNote);
    bump(themes, "finished", 1 * decay(a.readAt, now));
    if (a.readAt) slot(a.readAt).finished++;
  }
  for (const a of input.liked) {
    bump(themesOf(a, conceptsByNote), "liked", 0.5 * decay(a.savedAt, now));
  }
  let postponedTotal = 0;
  const abandoned: string[] = [];
  const inProgress: string[] = [];
  for (const a of input.queue) {
    const themes = themesOf(a, conceptsByNote);
    for (const p of a.postponedAt) {
      postponedTotal++;
      bump(themes, "postponed", -0.5 * decay(p, now));
      slot(p).postponed++;
    }
    const { state } = progressOf(a, input.scroll, now);
    if (state === "abandonado") {
      abandoned.push(a.title);
      const touched = input.scroll[a.file.path]?.updatedAt;
      bump(themes, "abandoned", -0.75 * decay(touched ? new Date(touched) : undefined, now));
    } else if (state === "empezado") {
      inProgress.push(a.title);
    }
  }

  const recentFinished = [...input.read]
    .filter((a) => a.readAt)
    .sort((x, y) => (y.readAt?.getTime() ?? 0) - (x.readAt?.getTime() ?? 0))
    .slice(0, 25)
    .map((a) => ({
      title: a.title,
      when: slotKey(a.readAt as Date),
      concepts: themesOf(a, conceptsByNote),
    }));
  const recentLiked = [...input.liked]
    .sort((x, y) => (y.savedAt?.getTime() ?? 0) - (x.savedAt?.getTime() ?? 0))
    .slice(0, 25)
    .map((a) => a.title);

  return {
    affinities: [...aff.values()].sort((a, b) => b.score - a.score),
    slots: [...slots.values()].sort((a, b) => b.finished + b.postponed - (a.finished + a.postponed)),
    recentFinished,
    recentLiked,
    abandoned,
    inProgress,
    totals: {
      read: input.read.length,
      liked: input.liked.length,
      queue: input.queue.length,
      postponed: postponedTotal,
      abandoned: abandoned.length,
    },
  };
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** Texto compacto para el prompt: cada línea es un hecho contado, nada inferido. */
export function renderSignals(s: ReadingSignals): string {
  const lines: string[] = [];
  const t = s.totals;
  lines.push(
    `Totales: ${t.read} leídas · ${t.liked} likes/bookmarks de X · ${t.queue} en cola · ${t.postponed} posposiciones · ${t.abandoned} abandonadas.`,
  );
  if (s.affinities.length > 0) {
    lines.push("", "Afinidad por tema (score con decaimiento de 60 días; terminadas/likes/pospuestas/abandonadas):");
    const top = s.affinities.slice(0, 15);
    const bottom = s.affinities.filter((a) => a.score < 0 && !top.includes(a)).slice(-8);
    for (const a of [...top, ...bottom]) {
      lines.push(`- ${a.concept}: ${r1(a.score)} (${a.finished}/${a.liked}/${a.postponed}/${a.abandoned})`);
    }
  }
  if (s.slots.length > 0) {
    lines.push("", "Por franja (terminadas / pospuestas):");
    for (const h of s.slots.slice(0, 21)) lines.push(`- ${h.slot}: ${h.finished} / ${h.postponed}`);
  }
  if (s.recentFinished.length > 0) {
    lines.push("", "Últimas terminadas (franja · temas):");
    for (const f of s.recentFinished) lines.push(`- ${f.title} (${f.when}${f.concepts.length ? ` · ${f.concepts.join(", ")}` : ""})`);
  }
  if (s.recentLiked.length > 0) {
    lines.push("", "Últimos likes/bookmarks de X:");
    for (const l of s.recentLiked) lines.push(`- ${l}`);
  }
  if (s.abandoned.length > 0) {
    lines.push("", `Empezadas y abandonadas (+${ABANDON_AFTER_DAYS} días sin volver):`);
    for (const a of s.abandoned.slice(0, 15)) lines.push(`- ${a}`);
  }
  if (s.inProgress.length > 0) {
    lines.push("", "Empezadas hace poco:");
    for (const a of s.inProgress.slice(0, 10)) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}
