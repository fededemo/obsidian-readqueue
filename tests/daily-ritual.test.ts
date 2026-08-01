import { describe, expect, it } from "vitest";

import {
  buildDailyRitual,
  findConnections,
  pickHighlightOfDay,
  renderDailyRitual,
  type BuildRitualInput,
  type RitualHighlight,
} from "../src/daily-ritual";
import { rngFromSeed } from "../src/highlights-data";

const hl = (
  text: string,
  note: string,
  articleSource: RitualHighlight["articleSource"],
  topic?: string,
): RitualHighlight => ({ text, note, articleSource, topic });

const base = (over: Partial<BuildRitualInput> = {}): BuildRitualInput => ({
  date: "2026-08-01",
  highlights: [],
  read: [],
  concepts: [],
  queueTop: [],
  rng: rngFromSeed("2026-08-01"),
  ...over,
});

describe("pickHighlightOfDay", () => {
  it("no rompe con la vault vacía", () => {
    expect(pickHighlightOfDay([], rngFromSeed("x"))).toBeUndefined();
  });

  it("es determinista: el mismo día elige lo mismo", () => {
    const hs = [
      hl("a", "n1", "kindle"),
      hl("b", "n2", "web"),
      hl("c", "n3", "matter"),
    ];
    const uno = pickHighlightOfDay(hs, rngFromSeed("2026-08-01"));
    const otro = pickHighlightOfDay(hs, rngFromSeed("2026-08-01"));
    expect(uno).toEqual(otro);
  });

  it("no deja que 500 highlights de Kindle tapen a los de web", () => {
    const hs = [
      ...Array.from({ length: 500 }, (_, i) => hl(`k${i}`, `libro`, "kindle")),
      hl("el de web", "articulo", "web"),
    ];
    const fuentes = new Set(
      Array.from({ length: 30 }, (_, i) =>
        pickHighlightOfDay(hs, rngFromSeed(`dia-${i}`))?.articleSource,
      ),
    );
    expect(fuentes.has("web")).toBe(true);
  });
});

describe("findConnections", () => {
  const h = hl("texto", "origen", "kindle", "tech");

  it("prioriza conceptos por sobre fuentes sueltas", () => {
    const links = findConnections(h, {
      concepts: [{ note: "Un concepto", topic: "tech" }],
      read: [{ note: "Una fuente", topic: "tech" }],
    });
    expect(links[0]?.note).toBe("Un concepto");
    expect(links[0]?.why).toContain("concepto");
  });

  it("nunca se enlaza a sí mismo", () => {
    const links = findConnections(h, {
      concepts: [],
      read: [{ note: "origen", topic: "tech" }],
    });
    expect(links).toHaveLength(0);
  });

  it("no inventa conexiones cuando no hay tema en común", () => {
    const links = findConnections(h, {
      concepts: [{ note: "Otro", topic: "cultura" }],
      read: [{ note: "Otro más", topic: "macro" }],
    });
    expect(links).toHaveLength(0);
  });

  it("sin topic no conecta (no adivina)", () => {
    const links = findConnections(hl("t", "n", "web", undefined), {
      concepts: [{ note: "C", topic: "tech" }],
      read: [],
    });
    expect(links).toHaveLength(0);
  });
});

describe("renderDailyRitual", () => {
  it("cabe en 60 segundos: como mucho 1 highlight, 2 conexiones y 2 lecturas", () => {
    const ritual = buildDailyRitual(
      base({
        highlights: [hl("Un highlight", "Libro", "kindle", "tech")],
        concepts: [
          { note: "C1", topic: "tech" },
          { note: "C2", topic: "tech" },
          { note: "C3", topic: "tech" },
        ],
        queueTop: [
          { note: "L1", why: "conecta con 3" },
          { note: "L2", why: "conecta con 2" },
          { note: "L3", why: "conecta con 1" },
        ],
      }),
    );
    expect(ritual.connections).toHaveLength(2);
    expect(ritual.toRead).toHaveLength(2);
    const md = renderDailyRitual(ritual);
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
  });

  it("renderiza wikilinks reales y cita el highlight como blockquote", () => {
    const md = renderDailyRitual(
      buildDailyRitual(
        base({
          highlights: [hl("La cita", "El Libro", "kindle", "tech")],
          read: [{ note: "Otra nota", topic: "tech" }],
        }),
      ),
    );
    expect(md).toContain("> La cita");
    expect(md).toContain("— de [[El Libro]]");
    expect(md).toContain("[[Otra nota]]");
  });

  it("degrada con gracia cuando no hay nada que mostrar", () => {
    const md = renderDailyRitual(buildDailyRitual(base()));
    expect(md).toContain("Todavía no hay highlights");
    expect(md).not.toContain("Se conecta con");
  });

  it("multilínea queda como blockquote válido", () => {
    const md = renderDailyRitual(
      buildDailyRitual(base({ highlights: [hl("uno\ndos", "N", "web", "tech")] })),
    );
    expect(md).toContain("> uno\n> dos");
  });
});
