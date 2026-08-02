import { describe, expect, it } from "vitest";

import {
  advisories,
  auditConceptNote,
  dropFromUnread,
  linksInSection,
  passesStandard,
  removeSection,
  UNREAD_HEADING,
  upsertSection,
} from "../src/concept-note";

const note = (extra = ""): string => `---
type: concept
---

# Un concepto

## La idea

El poder durable no viene del mejor producto.

> Una cita textual que ancla la tesis.

## Fuentes

- [[Leída A]]
- [[Leída B]]
${extra}
## La tensión que vale la pena

[[Leída B]] complica la tesis. ¿Y si el poder lo decide la ejecución?
`;

describe("upsertSection", () => {
  it("una sección nueva nace después de Fuentes, no al final", () => {
    const next = upsertSection(note(), UNREAD_HEADING, "- [[Pendiente A]]", "## Fuentes");
    expect(next).toBeDefined();
    const lines = (next as string).split("\n");
    const fuentes = lines.findIndex((l) => l.trim() === "## Fuentes");
    const pendientes = lines.findIndex((l) => l.trim() === UNREAD_HEADING);
    const tension = lines.findIndex((l) => l.startsWith("## La tensión"));
    expect(fuentes).toBeLessThan(pendientes);
    expect(pendientes).toBeLessThan(tension);
  });

  it("re-correr reemplaza la sección en vez de duplicarla", () => {
    const once = upsertSection(note(), UNREAD_HEADING, "- [[A]]", "## Fuentes") as string;
    const twice = upsertSection(once, UNREAD_HEADING, "- [[B]]", "## Fuentes") as string;
    expect(twice.split(UNREAD_HEADING)).toHaveLength(2);
    expect(linksInSection(twice, UNREAD_HEADING)).toEqual(["B"]);
  });

  it("sin el ancla no inventa dónde ponerla: devuelve undefined", () => {
    expect(upsertSection("# vacío\n", UNREAD_HEADING, "- [[A]]", "## Fuentes")).toBeUndefined();
  });

  it("no toca las otras secciones", () => {
    const next = upsertSection(note(), UNREAD_HEADING, "- [[A]]", "## Fuentes") as string;
    expect(linksInSection(next, "## Fuentes")).toEqual(["Leída A", "Leída B"]);
    expect(next).toContain("¿Y si el poder lo decide la ejecución?");
  });
});

describe("dropFromUnread", () => {
  const withPending = (): string =>
    upsertSection(note(), UNREAD_HEADING, "- [[P1]]\n- [[P2]]", "## Fuentes") as string;

  it("saca la nota que se leyó y deja las otras", () => {
    const next = dropFromUnread(withPending(), "P1");
    expect(linksInSection(next, UNREAD_HEADING)).toEqual(["P2"]);
  });

  it("cuando no queda ninguna, la sección entera se va", () => {
    let next = dropFromUnread(withPending(), "P1");
    next = dropFromUnread(next, "P2");
    expect(next).not.toContain(UNREAD_HEADING);
    // Y no se lleva puesto lo demás.
    expect(next).toContain("## Fuentes");
    expect(next).toContain("## La tensión que vale la pena");
  });

  it("no toca la sección de fuentes leídas aunque el nombre coincida", () => {
    const next = dropFromUnread(withPending(), "Leída A");
    expect(linksInSection(next, "## Fuentes")).toEqual(["Leída A", "Leída B"]);
  });

  it("una nota que no está no cambia nada", () => {
    const before = withPending();
    expect(dropFromUnread(before, "Inexistente")).toBe(before);
  });
});

describe("removeSection", () => {
  it("se lleva solo su sección", () => {
    const next = removeSection(note(), "## Fuentes");
    expect(next).not.toContain("[[Leída A]]");
    expect(next).toContain("## La tensión que vale la pena");
  });
});

describe("auditConceptNote", () => {
  const stems = new Set(["Leída A", "Leída B"]);

  it("una nota que cumple pasa el gate", () => {
    const results = auditConceptNote(note(), { knownStems: stems });
    expect(passesStandard(results)).toBe(true);
  });

  it("una apertura que describe en vez de afirmar no pasa", () => {
    const bad = note().replace(
      "El poder durable no viene del mejor producto.",
      "Este concepto agrupa notas sobre poder de mercado.",
    );
    const results = auditConceptNote(bad, { knownStems: stems });
    expect(results.find((r) => r.id === "afirma")?.passed).toBe(false);
    expect(passesStandard(results)).toBe(false);
  });

  it("sin cita textual arriba no pasa", () => {
    const bad = note().replace("> Una cita textual que ancla la tesis.\n", "");
    expect(auditConceptNote(bad, { knownStems: stems }).find((r) => r.id === "cita")?.passed)
      .toBe(false);
  });

  it("sin tensión, y sin pregunta abierta, no pasa", () => {
    const bad = note().replace(
      /## La tensión que vale la pena[\s\S]*$/,
      "## Otra cosa\n\nnada\n",
    );
    const results = auditConceptNote(bad, { knownStems: stems });
    expect(results.find((r) => r.id === "tension")?.passed).toBe(false);
    expect(results.find((r) => r.id === "pregunta")?.passed).toBe(false);
  });

  it("un wikilink roto bloquea y dice cuál", () => {
    const bad = note().replace("[[Leída A]]", "[[No existe]]");
    const check = auditConceptNote(bad, { knownStems: stems }).find((r) => r.id === "wikilinks");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("No existe");
  });

  it("sin el set de stems no inventa links rotos", () => {
    const results = auditConceptNote(note().replace("[[Leída A]]", "[[Lo que sea]]"));
    expect(results.find((r) => r.id === "wikilinks")?.passed).toBe(true);
  });

  it("una nota larguísima se marca para podar, pero no se bloquea", () => {
    // Con el umbral en 550 falla «Asignación de un recurso finito», que el
    // estándar nombra como nota modelo. Un gate que rechaza sus propios
    // ejemplos está roto: el largo es un olor, no un defecto.
    const long = note().replace(
      "El poder durable no viene del mejor producto.",
      `El poder durable no viene del mejor producto. ${"palabra ".repeat(700)}`,
    );
    const results = auditConceptNote(long, { knownStems: stems });
    expect(results.find((r) => r.id === "largo")?.passed).toBe(false);
    expect(passesStandard(results)).toBe(true);
    expect(advisories(results).map((r) => r.id)).toEqual(["largo"]);
  });

  it("la tabla de fuentes no cuenta como prosa", () => {
    // Medirla hacía que una nota fallara por tener muchas fuentes, que es
    // justo lo contrario de lo que premia el estándar.
    const rows = Array.from({ length: 40 }, (_, i) => `| [[Leída A]] | fila ${i} larga de tabla |`);
    const withTable = note().replace("- [[Leída A]]", rows.join("\n"));
    expect(auditConceptNote(withTable).find((r) => r.id === "largo")?.passed).toBe(true);
  });

  it("los puntos de criterio se marcan pero no bloquean", () => {
    const results = auditConceptNote(note(), { knownStems: stems });
    const advisory = results.filter((r) => r.advisory).map((r) => r.id);
    // Fingir que un regex mide "cada fuente dice desde dónde habla" sería peor
    // que no medirlo: daría luz verde a notas que no la merecen.
    expect(advisory).toEqual(["dialogo", "filtrado", "largo"]);
  });
});

describe("auditConceptNote sobre notas latentes", () => {
  const latente = `---
type: concept
status: latente
---

# Un tema que se viene acumulando

> **\`latente\`** — 8 fuentes, ninguna leída.

## Todavía no leídas

- [[Pendiente A]]
- [[Pendiente B]]
`;

  it("no le exige tesis ni tensión: no leíste nada, afirmar sería inventar", () => {
    const results = auditConceptNote(latente, { knownStems: new Set(["Pendiente A", "Pendiente B"]) });
    expect(passesStandard(results)).toBe(true);
    expect(results.map((r) => r.id)).not.toContain("tension");
    expect(results.map((r) => r.id)).not.toContain("afirma");
  });

  it("pero sigue sin poder ensuciar el grafo", () => {
    const roto = latente.replace("[[Pendiente A]]", "[[No existe]]");
    const results = auditConceptNote(roto, { knownStems: new Set(["Pendiente B"]) });
    expect(passesStandard(results)).toBe(false);
    expect(results.find((r) => r.id === "wikilinks")?.detail).toContain("No existe");
  });

  it("una latente sin fuentes no tiene razón de existir", () => {
    const vacia = latente.replace(/- \[\[.*\]\]\n/g, "");
    expect(passesStandard(auditConceptNote(vacia))).toBe(false);
  });

  it("una nota conocida sigue pasando por el checklist completo", () => {
    const results = auditConceptNote(note(), { knownStems: new Set(["Leída A", "Leída B"]) });
    expect(results.map((r) => r.id)).toContain("tension");
  });
});
