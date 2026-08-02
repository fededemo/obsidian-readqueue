import { describe, expect, it } from "vitest";

import {
  buildDailyRitual,
  findConnections,
  pickHighlightOfDay,
  pickReconsider,
  renderDailyRitual,
  type BuildRitualInput,
  type ReconsiderCandidate,
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

describe("Reconsiderar (B-703)", () => {
  const DOMINGO = "2026-08-02";
  const LUNES = "2026-08-03";
  const rng = () => 0;

  const cand = (over: Partial<ReconsiderCandidate> = {}): ReconsiderCandidate => ({
    note: "vieja",
    shelfLife: "evergreen",
    ageDays: 400,
    ...over,
  });

  it("solo pregunta por lo evergreen: es el único caso donde la pregunta es honesta", () => {
    // Un perishable de hace 8 meses no se reconsidera, se descarta sin culpa;
    // un seasonal viejo ya perdió el tren. Preguntar por todo es una máquina de culpa.
    expect(pickReconsider([cand({ shelfLife: "perishable" })], DOMINGO, rng)).toBeUndefined();
    expect(pickReconsider([cand({ shelfLife: "seasonal" })], DOMINGO, rng)).toBeUndefined();
    expect(pickReconsider([cand({ shelfLife: undefined })], DOMINGO, rng)).toBeUndefined();
    expect(pickReconsider([cand()], DOMINGO, rng)?.note).toBe("vieja");
  });

  it("no pregunta antes de los 6 meses", () => {
    expect(pickReconsider([cand({ ageDays: 100 })], DOMINGO, rng)).toBeUndefined();
    expect(pickReconsider([cand({ ageDays: 180 })], DOMINGO, rng)).toBeDefined();
  });

  it("aparece un solo día de la semana: el cap es estructural, no un contador", () => {
    expect(pickReconsider([cand()], LUNES, rng)).toBeUndefined();
    expect(pickReconsider([cand()], "2026-08-04", rng)).toBeUndefined();
    expect(pickReconsider([cand()], DOMINGO, rng)).toBeDefined();
  });

  it("con la cola vacía o una fecha inválida no rompe", () => {
    expect(pickReconsider([], DOMINGO, rng)).toBeUndefined();
    expect(pickReconsider([cand()], "no-es-fecha", rng)).toBeUndefined();
  });

  it("redondea la antigüedad a meses para que se lea", () => {
    expect(pickReconsider([cand({ ageDays: 365 })], DOMINGO, rng)?.months).toBe(12);
  });

  it("el render fuerza la decisión en vez de dejarla abierta", () => {
    const ritual = {
      date: DOMINGO,
      highlight: undefined,
      connections: [],
      toRead: [],
      reconsider: { note: "vieja", months: 13, tldr: "por qué importaría" },
    };
    const md = renderDailyRitual(ritual);
    expect(md).toContain("¿Todavía te importa?");
    expect(md).toContain("[[vieja]]");
    expect(md).toContain("hace 13 meses");
    expect(md).toContain("leelo o borralo");
  });

  it("sin candidata, la sección no existe", () => {
    const md = renderDailyRitual({
      date: LUNES,
      highlight: undefined,
      connections: [],
      toRead: [],
      reconsider: undefined,
    });
    expect(md).not.toContain("¿Todavía te importa?");
  });
});
