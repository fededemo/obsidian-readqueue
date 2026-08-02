/**
 * Identidad de un libro a partir de su contenido, no de su tapa (B-506).
 *
 * Clasificar libros por título deja 33 de 34 en `topic: otros` — *1929: Inside
 * the Greatest Crash in Wall Street History* etiquetado "otros" no es un error
 * del modelo, es que el título solo no alcanza y la metadata de Amazon tampoco.
 *
 * Lo que sí sabe de qué trata un libro son **sus highlights**: es lo que Fede
 * efectivamente marcó leyéndolo. Este módulo saca la muestra; el juicio lo hace
 * el clasificador afuera.
 *
 * Es la misma tesis que ADR-003 aplica a los conceptos: el contenido es la
 * verdad de terreno, la metadata es una pista.
 */

/** Un highlight de Kindle es un bloque `>` en el cuerpo de la nota. */
export function extractQuotes(content: string): string[] {
  const lines = content.replace(/^---[\s\S]*?\n---\n/, "").split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (/^>/.test(line)) {
      buf.push(line.replace(/^>[ \t]?/, ""));
      continue;
    }
    if (buf.length > 0) {
      const text = buf.join("\n").trim();
      if (text) out.push(text);
      buf = [];
    }
  }
  if (buf.length > 0) {
    const text = buf.join("\n").trim();
    if (text) out.push(text);
  }
  return out;
}

export interface SampleOptions {
  /** Cuántos highlights tomar. */
  count?: number;
  /** Tope de caracteres del texto devuelto. */
  maxChars?: number;
}

/**
 * Muestra representativa de los highlights de un libro.
 *
 * Repartida a lo largo del libro y no los primeros N: el principio de un libro
 * es prólogo, agradecimientos y encuadre, que es justo la parte que menos dice
 * de qué trata. Las marcas del medio y del final son las que tienen la tesis.
 *
 * Determinista: mismo libro, misma muestra. Reclasificar no puede dar distinto
 * por azar, porque entonces el coherence-check estaría midiendo ruido.
 */
export function sampleQuotes(quotes: readonly string[], opts: SampleOptions = {}): string[] {
  const count = opts.count ?? 8;
  const maxChars = opts.maxChars ?? 2400;
  if (quotes.length === 0) return [];

  const picked: string[] =
    quotes.length <= count
      ? [...quotes]
      : Array.from({ length: count }, (_, i) => {
          const idx = Math.round((i * (quotes.length - 1)) / (count - 1));
          return quotes[idx] as string;
        });

  const out: string[] = [];
  let budget = maxChars;
  for (const q of picked) {
    const trimmed = q.length > 400 ? `${q.slice(0, 400)}…` : q;
    if (trimmed.length > budget && out.length > 0) break;
    out.push(trimmed);
    budget -= trimmed.length;
  }
  return out;
}

export interface BookIdentity {
  title: string | undefined;
  author: string | undefined;
  asin: string | undefined;
  topic: string | undefined;
  quoteCount: number;
}

const field = (fm: string, name: string): string | undefined => {
  const m = fm.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  return v || undefined;
};

export function readBookIdentity(content: string): BookIdentity {
  const end = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
  const fm = end > 0 ? content.slice(4, end) : "";
  return {
    title: field(fm, "title"),
    author: field(fm, "author"),
    asin: field(fm, "asin"),
    topic: field(fm, "topic"),
    quoteCount: extractQuotes(content).length,
  };
}

export interface CoherenceFlag {
  reason: string;
  confidence: "alta" | "media";
}

/**
 * ¿La ficha dice de este libro lo mismo que dicen sus highlights?
 *
 * El caso que motiva esto: *The Infinity Machine* (Mallaby, sobre DeepMind, que
 * Fede leyó) se confundió con *The Infinite Machine* (Russo, sobre Ethereum,
 * que está en la wishlist). Un carácter de diferencia en el título, dos libros
 * que no tienen nada que ver. El autor y el ASIN los separan; el título solo, no.
 */
export function checkCoherence(
  book: BookIdentity,
  fromHighlights: { topic: string | undefined; author: string | undefined },
): CoherenceFlag | undefined {
  if (book.quoteCount === 0) {
    return { reason: "la ficha no tiene highlights: nada con qué verificarla", confidence: "media" };
  }
  if (book.author && fromHighlights.author && !sameAuthor(book.author, fromHighlights.author)) {
    return {
      reason: `el autor de la ficha (${book.author}) no coincide con el del contenido (${fromHighlights.author})`,
      confidence: "alta",
    };
  }
  // `otros` no es una afirmación distinta, es la ausencia de una: marcarlo como
  // incoherencia convierte todo el backfill inicial en 33 falsas alarmas.
  if (
    book.topic &&
    book.topic !== "otros" &&
    fromHighlights.topic &&
    book.topic !== fromHighlights.topic
  ) {
    return {
      reason: `la ficha dice \`${book.topic}\` pero los highlights dicen \`${fromHighlights.topic}\``,
      confidence: "media",
    };
  }
  return undefined;
}

const JOINERS = new Set(["and", "y", "&", "with", "con"]);

/** Nombres comparables: sin acentos, sin puntos de iniciales, sin orden fijo. */
export function normalizeAuthor(name: string): string {
  return authorTokens(name).join(" ");
}

function authorTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !JOINERS.has(t))
    .sort();
}

/**
 * ¿Es el mismo autor? Por contención, no por igualdad.
 *
 * Un libro con tres firmas se cita muchas veces por el principal: la ficha dice
 * "Gene Kim, Kevin Behr and George Spafford" y el contenido dice "Gene Kim".
 * Exigir igualdad marcaba eso como libro distinto — 3 de las 4 alarmas del
 * primer pase eran esto, y un check con 75% de ruido no lo mira nadie.
 */
export function sameAuthor(a: string, b: string): boolean {
  const ta = new Set(authorTokens(a));
  const tb = new Set(authorTokens(b));
  if (ta.size === 0 || tb.size === 0) return true;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * ¿Estos dos títulos son el mismo libro?
 *
 * Deliberadamente **sin fuzzy**: *Infinity* vs *Infinite* están a una letra de
 * distancia y cualquier umbral que los una también une libros distintos. Sin el
 * ASIN, la igualdad exacta del título normalizado más el autor es lo único que
 * no inventa coincidencias.
 */
export function sameBook(
  a: { title?: string | undefined; author?: string | undefined; asin?: string | undefined },
  b: { title?: string | undefined; author?: string | undefined; asin?: string | undefined },
): boolean {
  if (a.asin && b.asin) return a.asin === b.asin;
  const norm = (t: string | undefined): string =>
    (t ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[:\-–—,.!?'"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const ta = norm(a.title);
  const tb = norm(b.title);
  if (!ta || !tb || ta !== tb) return false;
  if (a.author && b.author) return sameAuthor(a.author, b.author);
  return true;
}
