import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  activeTopics,
  rankQueue,
  scoreArticle,
  shelfLifeFactor,
} from "../src/priority";
import type { QueueArticle } from "../src/queue-data";

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
    ...overrides,
  };
}

const NOW = new Date("2026-08-01T12:00:00Z");
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86400000).toISOString();

describe("shelfLifeFactor", () => {
  it("evergreen no envejece: 5 años vale igual que ayer", () => {
    expect(shelfLifeFactor("evergreen", 1)).toBe(1);
    expect(shelfLifeFactor("evergreen", 1825)).toBe(1);
  });

  it("perishable se desploma pasados 3 meses", () => {
    expect(shelfLifeFactor("perishable", 10)).toBe(1);
    expect(shelfLifeFactor("perishable", 100)).toBeLessThan(0.1);
  });

  it("seasonal baja gradual, no de golpe", () => {
    expect(shelfLifeFactor("seasonal", 30)).toBe(1);
    expect(shelfLifeFactor("seasonal", 200)).toBeLessThan(1);
    expect(shelfLifeFactor("seasonal", 400)).toBeLessThan(
      shelfLifeFactor("seasonal", 200),
    );
  });

  it("sin clasificar queda neutro, ni premiado ni castigado", () => {
    expect(shelfLifeFactor(undefined, 500)).toBe(0.9);
  });
});

describe("scoreArticle", () => {
  it("el contexto previo manda: con vecinos leídos gana a sin ellos", () => {
    const con = scoreArticle({ readNeighbours: 5, shelfLife: "evergreen", ageDays: 10, topicActive: false });
    const sin = scoreArticle({ readNeighbours: 0, shelfLife: "evergreen", ageDays: 10, topicActive: false });
    expect(con.score).toBeGreaterThan(sin.score);
  });

  it("rendimientos decrecientes: de 0 a 1 salta más que de 8 a 9", () => {
    const base = { shelfLife: "evergreen", ageDays: 1, topicActive: false };
    const s = (n: number) => scoreArticle({ ...base, readNeighbours: n }).score;
    expect(s(1) - s(0)).toBeGreaterThan(s(9) - s(8));
  });

  it("un evergreen viejo con contexto le gana a una noticia fresca sin contexto", () => {
    const ensayo = scoreArticle({ readNeighbours: 4, shelfLife: "evergreen", ageDays: 2000, topicActive: false });
    const noticia = scoreArticle({ readNeighbours: 0, shelfLife: "perishable", ageDays: 1, topicActive: false });
    expect(ensayo.score).toBeGreaterThan(noticia.score);
  });

  it("explica el porqué en vez de dar un número solo", () => {
    expect(scoreArticle({ readNeighbours: 3, shelfLife: "evergreen", ageDays: 1, topicActive: false }).reason)
      .toBe("conecta con 3 notas que ya leíste");
    expect(scoreArticle({ readNeighbours: 1, shelfLife: "evergreen", ageDays: 1, topicActive: false }).reason)
      .toBe("conecta con 1 nota que ya leíste");
    expect(scoreArticle({ readNeighbours: 0, shelfLife: "perishable", ageDays: 200, topicActive: false }).reason)
      .toContain("caducado");
  });
});

describe("activeTopics", () => {
  it("solo cuenta lo leído dentro de la ventana", () => {
    const read = [
      mk({ topic: "tech", readAt: new Date(NOW.getTime() - 5 * 86400000) }),
      mk({ topic: "macro", readAt: new Date(NOW.getTime() - 200 * 86400000) }),
    ];
    const active = activeTopics(read, NOW, 30);
    expect(active.has("tech")).toBe(true);
    expect(active.has("macro")).toBe(false);
  });
});

describe("rankQueue", () => {
  it("ordena por señal, no por fecha", () => {
    const read = [
      mk({ topic: "tech", readAt: NOW }),
      mk({ topic: "tech", readAt: NOW }),
      mk({ topic: "tech", readAt: NOW }),
    ];
    const ranked = rankQueue(
      [
        mk({ title: "noticia-nueva", topic: "cultura", shelfLife: "perishable", published: daysAgo(1) }),
        mk({ title: "ensayo-viejo", topic: "tech", shelfLife: "evergreen", published: daysAgo(900) }),
      ],
      { read, now: NOW },
    );
    expect(ranked[0]?.article.title).toBe("ensayo-viejo");
    expect(ranked[0]?.reason).toContain("3 notas que ya leíste");
  });

  it("hunde lo perecedero y vencido al fondo", () => {
    const ranked = rankQueue(
      [
        mk({ title: "vencido", topic: "macro", shelfLife: "perishable", published: daysAgo(300) }),
        mk({ title: "vigente", topic: "macro", shelfLife: "evergreen", published: daysAgo(300) }),
      ],
      { read: [], now: NOW },
    );
    expect(ranked[0]?.article.title).toBe("vigente");
    expect(ranked[1]?.article.title).toBe("vencido");
  });

  it("no explota con la cola vacía ni sin material leído", () => {
    expect(rankQueue([], { read: [], now: NOW })).toEqual([]);
    expect(rankQueue([mk({ title: "a" })], { read: [], now: NOW })).toHaveLength(1);
  });
});
