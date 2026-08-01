import { describe, expect, it } from "vitest";

import {
  buildConceptIndex,
  emptyConceptIndex,
  parseConceptNote,
  statusFor,
  type ConceptNote,
} from "../src/concept-graph";

const note = (body: string): string => `---
type: concept
status: conocido
---

# Un concepto

${body}
`;

function mk(over: Partial<ConceptNote> = {}): ConceptNote {
  const readSources = over.readSources ?? [];
  return {
    name: "C",
    readSources,
    unreadSources: [],
    status: statusFor(readSources.length),
    ...over,
  };
}

describe("parseConceptNote", () => {
  it("separa las fuentes leídas de las pendientes por sección", () => {
    const c = parseConceptNote(
      "Compounding",
      note(`## Fuentes

| Nota | Estado |
|---|---|
| [[Leída A]] | ✅ leído |
| [[Leída B]] | ✅ leído |

## Todavía no leídas

- [[Pendiente A]]
- [[Pendiente B]]
`),
    );
    expect(c.readSources).toEqual(["Leída A", "Leída B"]);
    expect(c.unreadSources).toEqual(["Pendiente A", "Pendiente B"]);
  });

  it("corta en el próximo heading, no se come la sección siguiente", () => {
    const c = parseConceptNote(
      "C",
      note(`## Fuentes

- [[Leída A]]

## Pendientes sobre este concepto

- [[Otra cosa]] que no es una fuente
`),
    );
    expect(c.readSources).toEqual(["Leída A"]);
  });

  it("resuelve alias y anclas al nombre real de la nota", () => {
    const c = parseConceptNote(
      "C",
      note(`## Fuentes

- [[Nota larga|un alias]]
- [[Otra nota#Una sección]]
`),
    );
    expect(c.readSources).toEqual(["Nota larga", "Otra nota"]);
  });

  it("no cuenta dos veces la misma nota citada dos veces", () => {
    const c = parseConceptNote(
      "C",
      note(`## Fuentes

- [[Leída A]]
- [[Leída A]]
`),
    );
    expect(c.readSources).toEqual(["Leída A"]);
  });

  it("una nota sin la sección de pendientes no rompe: queda sin conexiones atraer", () => {
    const c = parseConceptNote("C", note(`## Fuentes\n\n- [[Leída A]]\n`));
    expect(c.unreadSources).toEqual([]);
  });
});

describe("statusFor", () => {
  it("hacen falta 2 lecturas para afirmar algo (ADR-005 §9-bis.3)", () => {
    expect(statusFor(2)).toBe("conocido");
    expect(statusFor(1)).toBe("emergente");
    expect(statusFor(0)).toBe("latente");
  });
});

describe("buildConceptIndex", () => {
  it("cuenta lecturas distintas, no suma por concepto", () => {
    // La pendiente está en dos conceptos que comparten "Leída A". Son 3
    // vecinos reales, no 4: contar dos veces infla justo los clusters grandes.
    const index = buildConceptIndex([
      mk({ name: "Uno", readSources: ["Leída A", "Leída B"], unreadSources: ["P"] }),
      mk({ name: "Dos", readSources: ["Leída A", "Leída C"], unreadSources: ["P"] }),
    ]);
    expect(index.readNeighbours.get("P")).toBe(3);
  });

  it("atribuye la pendiente al concepto con más lecturas detrás", () => {
    const index = buildConceptIndex([
      mk({ name: "Flaco", readSources: ["A"], unreadSources: ["P"] }),
      mk({ name: "Gordo", readSources: ["A", "B", "C"], unreadSources: ["P"] }),
    ]);
    expect(index.conceptsByNote.get("P")?.[0]).toBe("Gordo");
  });

  it("un concepto latente no aporta contexto: no hay nada leído detrás", () => {
    const index = buildConceptIndex([
      mk({ name: "Latente", readSources: [], unreadSources: ["P"] }),
    ]);
    expect(index.readNeighbours.has("P")).toBe(false);
  });

  it("las pendientes fuera del grafo simplemente no aparecen", () => {
    const index = buildConceptIndex([
      mk({ name: "Uno", readSources: ["A"], unreadSources: ["P"] }),
    ]);
    expect(index.readNeighbours.get("Otra")).toBeUndefined();
  });

  it("sin notas-concepto devuelve un índice vacío, no explota", () => {
    expect(buildConceptIndex([]).readNeighbours.size).toBe(0);
    expect(emptyConceptIndex().conceptsByNote.size).toBe(0);
  });
});
