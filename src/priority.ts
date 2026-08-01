import type { QueueArticle } from "./queue-data";

/**
 * Ordena la cola por señal real en vez de por fecha (C2 / B-732).
 *
 * La pregunta que contesta es "¿por qué me conviene leer ESTO ahora?", y la
 * respuesta más fuerte medida sobre la vault de Fede resultó ser el contexto
 * previo: un artículo que se conecta con material que ya leíste rinde más que
 * uno reciente sobre un tema del que no sabés nada.
 *
 * Determinista y sin LLM: el `topic` ya está al 100% y `shelfLife` lo puso el
 * intake. Ver docs/architecture/ADR-005 §9-bis.4.
 */

export interface PriorityInput {
  /** Cuántas notas YA LEÍDAS comparten tema o concepto con esta. */
  readNeighbours: number;
  shelfLife: string | undefined;
  /** Antigüedad del contenido, en días. */
  ageDays: number | undefined;
  /** ¿El topic aparece en lo que Fede viene leyendo últimamente? */
  topicActive: boolean;
}

export interface PriorityScore {
  score: number;
  /** Motivo legible para mostrar en la card — sin esto el orden es magia. */
  reason: string;
}

/**
 * Un vecino leído vale mucho, pero con rendimientos decrecientes: el salto de
 * 0 a 1 es el que importa (pasás de no tener contexto a tenerlo). De 8 a 9 no
 * cambia nada.
 */
function contextFactor(readNeighbours: number): number {
  if (readNeighbours <= 0) return 1;
  return 1 + Math.log2(1 + readNeighbours) * 2;
}

/**
 * No es decaimiento por antigüedad — es caducidad por tipo de contenido.
 * Un evergreen de 2019 vale igual que uno de ayer; una noticia de hace 4 meses
 * ya no aplica. Medido sobre la vault: 100 evergreen, 61 seasonal, 8 perishable.
 */
export function shelfLifeFactor(
  shelfLife: string | undefined,
  ageDays: number | undefined,
): number {
  const age = ageDays ?? 0;
  switch (shelfLife) {
    case "perishable":
      if (age > 90) return 0.05;
      if (age > 30) return 0.4;
      return 1;
    case "seasonal":
      if (age > 365) return 0.25;
      if (age > 180) return 0.6;
      return 1;
    case "evergreen":
      return 1;
    default:
      // Sin clasificar: no lo premiamos ni lo castigamos.
      return 0.9;
  }
}

export function scoreArticle(input: PriorityInput): PriorityScore {
  const ctx = contextFactor(input.readNeighbours);
  const shelf = shelfLifeFactor(input.shelfLife, input.ageDays);
  const active = input.topicActive ? 1.25 : 1;
  const score = ctx * shelf * active;

  let reason: string;
  if (input.readNeighbours > 0) {
    const n = input.readNeighbours;
    reason = `conecta con ${n} ${n === 1 ? "nota que ya leíste" : "notas que ya leíste"}`;
  } else if (input.topicActive) {
    reason = "tema activo en lo que venís leyendo";
  } else {
    reason = "sin contexto previo";
  }
  if (shelf <= 0.4) {
    reason = `${reason} · caducado`;
  }
  return { score, reason };
}

export interface RankOptions {
  /** Notas ya leídas, para contar vecinos por tema. */
  read: readonly QueueArticle[];
  now?: Date;
  /** Cuántos días atrás cuentan como "lo que venís leyendo". */
  activeWindowDays?: number;
}

export interface RankedArticle {
  article: QueueArticle;
  score: number;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Topics que aparecen en lo leído recientemente. */
export function activeTopics(
  read: readonly QueueArticle[],
  now: Date,
  windowDays: number,
): Set<string> {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const out = new Set<string>();
  for (const a of read) {
    if (!a.topic) continue;
    if (a.readAt && a.readAt.getTime() >= cutoff) out.add(a.topic.toLowerCase());
  }
  return out;
}

export function rankQueue(
  articles: readonly QueueArticle[],
  opts: RankOptions,
): RankedArticle[] {
  const now = opts.now ?? new Date();
  const active = activeTopics(opts.read, now, opts.activeWindowDays ?? 30);

  const readByTopic = new Map<string, number>();
  for (const a of opts.read) {
    if (!a.topic) continue;
    const k = a.topic.toLowerCase();
    readByTopic.set(k, (readByTopic.get(k) ?? 0) + 1);
  }

  return articles
    .map((article) => {
      const topic = article.topic?.toLowerCase();
      const published = article.published
        ? new Date(article.published)
        : article.savedAt;
      const ageDays =
        published && !Number.isNaN(published.getTime())
          ? Math.max(0, (now.getTime() - published.getTime()) / DAY_MS)
          : undefined;
      const { score, reason } = scoreArticle({
        readNeighbours: topic ? (readByTopic.get(topic) ?? 0) : 0,
        shelfLife: article.shelfLife,
        ageDays,
        topicActive: topic ? active.has(topic) : false,
      });
      return { article, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}
