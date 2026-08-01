/**
 * Lee la capa wiki (`Concepts/`) y la convierte en señal para la cola (B-731).
 *
 * Las notas-concepto son la única fuente de verdad de qué se conecta con qué:
 * listan sus fuentes como wikilinks, separadas por estado de lectura. Este
 * módulo las parsea y responde la pregunta que le importa al priorizador:
 * **para esta nota pendiente, ¿cuánto material YA LEÍDO hay detrás?**
 *
 * Por qué acá y no en el frontmatter de cada artículo: `Inbox/` es la capa
 * cruda —de Fede, gated— y `Concepts/` es la wiki regenerable donde Claude
 * escribe libre (SEGUNDO-CEREBRO §4.2). Meter `concepts:` en 284 notas de
 * `Inbox/` sería escribir en la capa equivocada, y además duplicaría un dato
 * que ya vive en un solo lugar.
 *
 * Módulo puro: recibe el contenido de los `.md`, no toca el vault.
 */

/** Un concepto es `conocido` si ≥2 fuentes leídas lo sostienen (ADR-005 §9-bis.3). */
export type ConceptStatus = "conocido" | "emergente" | "latente";

export interface ConceptNote {
  name: string;
  readSources: string[];
  unreadSources: string[];
  status: ConceptStatus;
}

/**
 * Headings que delimitan cada lista de fuentes. Se buscan por texto porque es
 * lo que un humano ve y edita: si Fede renombra la sección, la conexión se
 * pierde de forma visible en vez de silenciosamente.
 */
const READ_HEADING = "## Fuentes";
const UNREAD_HEADING = "## Todavía no leídas";

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/** Wikilinks de la sección que arranca en `heading`, hasta el próximo `## `. */
function linksInSection(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^##\s/.test(line)) break;
    for (const m of line.matchAll(WIKILINK)) {
      const target = (m[1] ?? "").trim();
      if (!target || seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

export function statusFor(readCount: number): ConceptStatus {
  if (readCount >= 2) return "conocido";
  if (readCount === 1) return "emergente";
  return "latente";
}

export function parseConceptNote(name: string, content: string): ConceptNote {
  const readSources = linksInSection(content, READ_HEADING);
  const unreadSources = linksInSection(content, UNREAD_HEADING);
  return {
    name,
    readSources,
    unreadSources,
    status: statusFor(readSources.length),
  };
}

export interface ConceptIndex {
  /** Título de nota pendiente → nº de notas LEÍDAS distintas que comparten concepto. */
  readNeighbours: Map<string, number>;
  /** Título de nota pendiente → conceptos que la mencionan, del más cargado al menos. */
  conceptsByNote: Map<string, string[]>;
}

export const emptyConceptIndex = (): ConceptIndex => ({
  readNeighbours: new Map(),
  conceptsByNote: new Map(),
});

/**
 * `readNeighbours` cuenta notas leídas **distintas**, no suma por concepto: una
 * pendiente que aparece en dos conceptos que comparten diez lecturas tiene diez
 * vecinos, no veinte. Contar dos veces la misma lectura infla el score de los
 * clusters solapados, que son justamente los más grandes.
 */
export function buildConceptIndex(notes: readonly ConceptNote[]): ConceptIndex {
  const index = emptyConceptIndex();
  const neighbourSets = new Map<string, Set<string>>();

  for (const concept of notes) {
    if (concept.readSources.length === 0) continue;
    for (const pending of concept.unreadSources) {
      let set = neighbourSets.get(pending);
      if (!set) {
        set = new Set<string>();
        neighbourSets.set(pending, set);
      }
      for (const read of concept.readSources) set.add(read);

      const list = index.conceptsByNote.get(pending);
      if (list) list.push(concept.name);
      else index.conceptsByNote.set(pending, [concept.name]);
    }
  }

  const weight = new Map(notes.map((c) => [c.name, c.readSources.length]));
  for (const concepts of index.conceptsByNote.values()) {
    concepts.sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
  }
  for (const [pending, set] of neighbourSets) {
    index.readNeighbours.set(pending, set.size);
  }
  return index;
}
