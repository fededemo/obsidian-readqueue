import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import type { QueueArticle } from "../src/queue-data";
import {
  collectSignals,
  daypart,
  progressOf,
  renderSignals,
  slotKey,
} from "../src/reading-signals";

const mkFile = (name: string): TFile =>
  ({ basename: name, path: `Inbox/Web/${name}.md` }) as unknown as TFile;

function mk(overrides: Partial<QueueArticle> = {}): QueueArticle {
  return {
    file: mkFile(overrides.title ?? "x"),
    title: "x",
    url: undefined,
    source: undefined,
    topic: undefined,
    shelfLife: undefined,
    tldr: undefined,
    kindLabel: undefined,
    author: undefined,
    published: undefined,
    savedAt: undefined,
    status: "unread",
    tags: [],
    snoozedUntil: undefined,
    readAt: undefined,
    postponedAt: [],
    ...overrides,
  };
}

// Domingo 11 de octubre de 2026, 21:00 hora local.
const NOW = new Date(2026, 9, 11, 21, 0);
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);
const noConcepts = new Map<string, string[]>();

describe("daypart / slotKey", () => {
  it("parte el día en mañana, tarde y noche", () => {
    expect(daypart(new Date(2026, 9, 11, 8))).toBe("mañana");
    expect(daypart(new Date(2026, 9, 11, 15))).toBe("tarde");
    expect(daypart(new Date(2026, 9, 11, 23))).toBe("noche");
    expect(daypart(new Date(2026, 9, 11, 2))).toBe("noche");
  });

  it("la franja combina día de la semana y momento", () => {
    expect(slotKey(NOW)).toBe("dom-noche");
  });
});

describe("progressOf", () => {
  const a = mk({ title: "largo" });

  it("sin progreso guardado es sin-empezar", () => {
    expect(progressOf(a, {}, NOW).state).toBe("sin-empezar");
  });

  it("empezado hace poco es empezado; olvidado hace +7 días es abandonado", () => {
    const recent = { [a.file.path]: { scroll: 40, ratio: 0.4, updatedAt: daysAgo(2).getTime() } };
    const old = { [a.file.path]: { scroll: 40, ratio: 0.4, updatedAt: daysAgo(10).getTime() } };
    expect(progressOf(a, recent, NOW).state).toBe("empezado");
    expect(progressOf(a, old, NOW).state).toBe("abandonado");
  });

  it("llegar al final no es abandonar", () => {
    const done = { [a.file.path]: { scroll: 400, ratio: 0.99, updatedAt: daysAgo(30).getTime() } };
    expect(progressOf(a, done, NOW).state).toBe("sin-empezar");
  });
});

describe("collectSignals", () => {
  it("terminar y likear suben un tema; posponer y abandonar lo bajan", () => {
    const filo = mk({ title: "filo", topic: "filosofia", status: "read", readAt: daysAgo(1) });
    const like = mk({ title: "tweet", topic: "filosofia", source: "x-like", savedAt: daysAgo(1) });
    const ia = mk({ title: "ia", topic: "ia", postponedAt: [daysAgo(1), daysAgo(3)] });
    const iaLargo = mk({ title: "ia-largo", topic: "ia" });
    const s = collectSignals({
      queue: [ia, iaLargo],
      read: [filo],
      liked: [like],
      scroll: { [iaLargo.file.path]: { scroll: 10, ratio: 0.3, updatedAt: daysAgo(20).getTime() } },
      conceptsByNote: noConcepts,
      now: NOW,
    });
    const byName = new Map(s.affinities.map((x) => [x.concept, x]));
    expect(byName.get("filosofia")?.score).toBeGreaterThan(0);
    expect(byName.get("filosofia")).toMatchObject({ finished: 1, liked: 1 });
    expect(byName.get("ia")?.score).toBeLessThan(0);
    expect(byName.get("ia")).toMatchObject({ postponed: 2, abandoned: 1 });
    expect(s.abandoned).toEqual(["ia-largo"]);
    expect(s.totals).toMatchObject({ read: 1, liked: 1, queue: 2, postponed: 2, abandoned: 1 });
  });

  it("prefiere los conceptos del grafo al topic", () => {
    const read = mk({ title: "nota", topic: "tech", status: "read", readAt: daysAgo(1) });
    const s = collectSignals({
      queue: [],
      read: [read],
      liked: [],
      scroll: {},
      conceptsByNote: new Map([["nota", ["agentes"]]]),
      now: NOW,
    });
    expect(s.affinities.map((a) => a.concept)).toEqual(["agentes"]);
  });

  it("una señal vieja pesa menos que una nueva", () => {
    const s = collectSignals({
      queue: [],
      read: [
        mk({ title: "a", topic: "nuevo", status: "read", readAt: daysAgo(1) }),
        mk({ title: "b", topic: "viejo", status: "read", readAt: daysAgo(180) }),
      ],
      liked: [],
      scroll: {},
      conceptsByNote: noConcepts,
      now: NOW,
    });
    const [first, second] = s.affinities;
    expect(first?.concept).toBe("nuevo");
    expect(second?.score).toBeLessThan(0.2);
  });

  it("cuenta terminadas y posposiciones por franja", () => {
    const sundayNight = new Date(2026, 9, 4, 22);
    const s = collectSignals({
      queue: [mk({ title: "p", postponedAt: [sundayNight] })],
      read: [mk({ title: "r", status: "read", readAt: sundayNight })],
      liked: [],
      scroll: {},
      conceptsByNote: noConcepts,
      now: NOW,
    });
    expect(s.slots).toEqual([{ slot: "dom-noche", finished: 1, postponed: 1 }]);
  });
});

describe("renderSignals", () => {
  it("escribe hechos contados, legibles para el prompt", () => {
    const text = renderSignals(
      collectSignals({
        queue: [],
        read: [mk({ title: "Ensayo largo", topic: "filosofia", status: "read", readAt: daysAgo(1) })],
        liked: [mk({ title: "Hilo sobre Spinoza", source: "x-like", savedAt: daysAgo(2) })],
        scroll: {},
        conceptsByNote: noConcepts,
        now: NOW,
      }),
    );
    expect(text).toContain("1 leídas");
    expect(text).toContain("filosofia");
    expect(text).toContain("Ensayo largo");
    expect(text).toContain("Hilo sobre Spinoza");
  });
});
