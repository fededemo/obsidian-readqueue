/**
 * Edición y auditoría de notas-concepto (B-712 / B-737).
 *
 * El gardener corre solo y sin supervisión, así que necesita dos garantías que
 * un script suelto no da: que editar una nota no la rompa, y que nada que no
 * cumpla el estándar entre a la vault. Las dos viven acá, puras y testeadas.
 *
 * El estándar está en docs/vault-gardener/ESTANDAR-NOTAS-CONCEPTO.md.
 */

export const READ_HEADING = "## Fuentes";
export const UNREAD_HEADING = "## Todavía no leídas";

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

interface SectionRange {
  /** Índice de la línea del heading. */
  start: number;
  /** Índice de la primera línea DESPUÉS de la sección. */
  end: number;
}

function findSection(lines: readonly string[], heading: string): SectionRange | undefined {
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end] ?? "")) end++;
  return { start, end };
}

/**
 * Inserta o reemplaza una sección.
 *
 * `after` decide dónde nace si no existía. Va después de la sección indicada y
 * no al final porque el orden narrativo de la nota es idea → fuentes → qué
 * falta; enterrar lo pendiente abajo de todo lo hace invisible.
 */
export function upsertSection(
  content: string,
  heading: string,
  body: string,
  after: string,
): string | undefined {
  const lines = content.split("\n");
  const section = [heading, "", ...body.split("\n"), ""];
  const existing = findSection(lines, heading);
  if (existing) {
    return [...lines.slice(0, existing.start), ...section, ...lines.slice(existing.end)].join("\n");
  }
  const anchor = findSection(lines, after);
  if (!anchor) return undefined;
  return [...lines.slice(0, anchor.end), ...section, ...lines.slice(anchor.end)].join("\n");
}

export function removeSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const section = findSection(lines, heading);
  if (!section) return content;
  return [...lines.slice(0, section.start), ...lines.slice(section.end)].join("\n");
}

export function linksInSection(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const section = findSection(lines, heading);
  if (!section) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = section.start + 1; i < section.end; i++) {
    for (const m of (lines[i] ?? "").matchAll(WIKILINK)) {
      const target = (m[1] ?? "").trim();
      if (target && !seen.has(target)) {
        seen.add(target);
        out.push(target);
      }
    }
  }
  return out;
}

/**
 * Saca una nota de "Todavía no leídas" — la leíste.
 *
 * NO la agrega a "## Fuentes": esa sección lleva las fuentes que la síntesis
 * efectivamente usa, y agregar una línea suelta ahí mentiría sobre el cuerpo de
 * la nota, que sigue sin mencionarla. El gardener la deja anotada como pendiente
 * de integrar y ahí sí interviene un humano (o un pase de reescritura completo).
 */
export function dropFromUnread(content: string, note: string): string {
  const lines = content.split("\n");
  const section = findSection(lines, UNREAD_HEADING);
  if (!section) return content;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const inSection = i > section.start && i < section.end;
    if (inSection && /^\s*[-*]\s/.test(line)) {
      const targets = [...line.matchAll(WIKILINK)].map((m) => (m[1] ?? "").trim());
      if (targets.length === 1 && targets[0] === note) continue;
    }
    kept.push(line);
  }
  const next = kept.join("\n");
  // Si la sección quedó sin ítems ya no aporta nada: se va entera.
  return linksInSection(next, UNREAD_HEADING).length === 0
    ? removeSection(next, UNREAD_HEADING)
    : next;
}

// --- Auditoría contra el estándar (B-737) -----------------------------------

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  /** Los puntos de criterio no bloquean: se marcan para revisión humana. */
  advisory: boolean;
  detail?: string;
}

/**
 * ~250 palabras por minuto; el estándar pide leer la nota en menos de dos.
 *
 * El límite se calibró contra las cuatro notas que el propio estándar nombra
 * como referencia: si una de ellas no pasa, el que está mal es el umbral.
 */
const MAX_WORDS = 550;

const INDEX_HEADINGS = [
  "## Fuentes",
  UNREAD_HEADING,
  "## Pendientes sobre este concepto",
];

/**
 * Prosa: lo que efectivamente se lee.
 *
 * Las secciones de índice y las filas de tabla no son lectura, son navegación —
 * medirlas hacía que notas de 10 fuentes fallaran por tener 10 fuentes, que es
 * exactamente al revés de lo que premia el estándar.
 */
function proseOf(content: string): string {
  const lines = content.replace(/^---[\s\S]*?\n---\n/, "").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) skipping = INDEX_HEADINGS.includes(line.trim());
    if (skipping) continue;
    if (/^\s*\|/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

const OPENING_SMELLS = [
  "este concepto agrupa",
  "reflexiones sobre",
  "resumen de",
  "en esta nota",
  "el siguiente concepto",
];

function sectionText(content: string, heading: string): string {
  const lines = content.split("\n");
  const section = findSection(lines, heading);
  if (!section) return "";
  return lines.slice(section.start + 1, section.end).join("\n").trim();
}

const bodyOf = (content: string): string => content.replace(/^---[\s\S]*?\n---\n/, "");

/**
 * Corre el checklist del estándar sobre una nota.
 *
 * Seis de los ocho puntos son mecánicos y se verifican de verdad. Los otros dos
 * —"cada fuente dice desde dónde habla" y "se anotó lo que se descartó"— son
 * juicio, y fingir que un regex los mide sería peor que no medirlos: daría luz
 * verde a notas que no la merecen. Van marcados como advisory.
 */
export function auditConceptNote(
  content: string,
  opts: { knownStems?: ReadonlySet<string> } = {},
): CheckResult[] {
  const body = bodyOf(content);

  /**
   * Una nota `latente` no tiene tesis ni tensión, y no es un defecto: no leíste
   * ninguna de sus fuentes, así que afirmar algo sería inventarlo. El estándar
   * describe cómo se escribe una **síntesis**; una latente es un marcador de
   * que hay material acumulándose. Exigirle lo mismo haría que el gardener
   * reporte quince fallas para siempre, y un reporte que siempre falla no se
   * mira. Lo único que sí tiene que cumplir es no ensuciar el grafo.
   */
  if (/^status:\s*latente\s*$/m.test(content)) {
    const links = [...body.matchAll(WIKILINK)].map((m) => (m[1] ?? "").trim());
    const stems = opts.knownStems;
    const broken = stems ? links.filter((l) => !stems.has(l)) : [];
    return [
      {
        id: "wikilinks",
        label: "Cero wikilinks rotos",
        passed: broken.length === 0,
        advisory: false,
        detail: broken.length > 0 ? `rotos: ${broken.slice(0, 5).join(", ")}` : undefined,
      },
      {
        id: "fuentes",
        label: "Lista las fuentes que la sostendrían",
        passed: links.length > 0,
        advisory: false,
      },
      {
        id: "sintesis",
        label: "Escribir la síntesis cuando haya 2 fuentes leídas",
        passed: true,
        advisory: true,
        detail: "latente: se promueve sola al leer",
      },
    ];
  }

  const idea = sectionText(content, "## La idea");
  // "Arriba" es todo lo que va antes de la lista de fuentes: ahí tiene que estar
  // la cita que ancla la tesis. Cortar en el primer `##` dejaría afuera la
  // propia sección «La idea», que es justo donde vive.
  const top = body.split(/\n##\s+Fuentes/)[0] ?? body;
  const tensionHeading = content
    .split("\n")
    .find((l) => /^##\s+La tensión/i.test(l.trim()));
  const tension = tensionHeading ? sectionText(content, tensionHeading.trim()) : "";
  const words = proseOf(content).split(/\s+/).filter(Boolean).length;

  const links = [...body.matchAll(WIKILINK)].map((m) => (m[1] ?? "").trim());
  const stems = opts.knownStems;
  const broken = stems ? links.filter((l) => !stems.has(l)) : [];

  const results: CheckResult[] = [
    {
      id: "afirma",
      label: "La apertura afirma algo discutible",
      passed: idea.length > 0 && !OPENING_SMELLS.some((s) => idea.toLowerCase().startsWith(s)),
      advisory: false,
      detail: idea ? undefined : "falta la sección «La idea»",
    },
    {
      id: "cita",
      label: "Hay una cita textual arriba",
      passed: /^>\s*\S/m.test(top),
      advisory: false,
    },
    {
      id: "dialogo",
      label: "Cada fuente dice desde dónde habla",
      passed: true,
      advisory: true,
      detail: "criterio humano — no se verifica automáticamente",
    },
    {
      id: "tension",
      label: "Existe una sección de tensión",
      passed: tension.length > 0,
      advisory: false,
    },
    {
      id: "pregunta",
      label: "Cierra con una pregunta abierta",
      passed: tension.includes("?"),
      advisory: false,
    },
    {
      id: "filtrado",
      label: "Las fuentes están filtradas y se anotó lo descartado",
      passed: true,
      advisory: true,
      detail: "criterio humano — no se verifica automáticamente",
    },
    {
      id: "wikilinks",
      label: "Cero wikilinks rotos",
      passed: broken.length === 0,
      advisory: false,
      detail: broken.length > 0 ? `rotos: ${broken.slice(0, 5).join(", ")}` : undefined,
    },
    {
      id: "largo",
      label: "Se lee en menos de dos minutos",
      passed: words <= MAX_WORDS,
      // Advisory a propósito. Con el umbral en 550 falla *Asignación de un
      // recurso finito*, que el propio estándar nombra como nota modelo — y un
      // gate que rechaza sus propios ejemplos está roto. Subir el umbral hasta
      // que pase lo vuelve inútil. La respuesta correcta es que el largo es un
      // olor, no un defecto: se reporta para podar, no bloquea.
      advisory: true,
      detail: words > MAX_WORDS ? `${words} palabras — se puede podar` : undefined,
    },
  ];
  return results;
}

/**
 * El gate: una nota entra solo si pasa todos los puntos que bloquean.
 *
 * Bloquean los defectos verificables —falta la tensión, no hay cita, hay
 * wikilinks rotos, la apertura describe en vez de afirmar—. No bloquean los
 * puntos de criterio ni el largo: sobre esos el robot informa y decide un humano.
 */
export function passesStandard(results: readonly CheckResult[]): boolean {
  return results.every((r) => r.advisory || r.passed);
}

/** Lo que no bloquea pero conviene mirar. */
export function advisories(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((r) => r.advisory && !r.passed);
}
