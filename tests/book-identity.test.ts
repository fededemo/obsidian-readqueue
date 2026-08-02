import { describe, expect, it } from "vitest";

import {
  checkCoherence,
  extractQuotes,
  normalizeAuthor,
  readBookIdentity,
  sameAuthor,
  sameBook,
  sampleQuotes,
} from "../src/book-identity";

const book = (quotes: string[]): string =>
  `---
source: kindle-scrape
title: "1929: Inside the Greatest Crash"
author: Andrew Ross Sorkin
asin: B0DXMZWTYM
topic: otros
---

${quotes.map((q) => `> ${q}\n`).join("\n")}`;

describe("extractQuotes", () => {
  it("saca los highlights y no el frontmatter", () => {
    const qs = extractQuotes(book(["uno", "dos"]));
    expect(qs).toEqual(["uno", "dos"]);
  });

  it("un highlight multilínea es uno solo", () => {
    expect(extractQuotes("---\na: 1\n---\n\n> una\n> sola cita\n")).toEqual(["una\nsola cita"]);
  });

  it("una nota sin highlights no rompe", () => {
    expect(extractQuotes("---\na: 1\n---\n\ntexto suelto\n")).toEqual([]);
  });
});

describe("sampleQuotes", () => {
  const many = Array.from({ length: 100 }, (_, i) => `cita ${i}`);

  it("reparte a lo largo del libro, no toma los primeros", () => {
    // El principio de un libro es prólogo y agradecimientos: justo la parte
    // que menos dice de qué trata.
    const s = sampleQuotes(many, { count: 4 });
    expect(s[0]).toBe("cita 0");
    expect(s[3]).toBe("cita 99");
    expect(s[1]).not.toBe("cita 1");
  });

  it("es determinista: reclasificar no puede dar distinto por azar", () => {
    expect(sampleQuotes(many, { count: 5 })).toEqual(sampleQuotes(many, { count: 5 }));
  });

  it("con menos highlights que el cupo los devuelve todos", () => {
    expect(sampleQuotes(["a", "b"], { count: 8 })).toEqual(["a", "b"]);
  });

  it("respeta el tope de caracteres pero nunca devuelve vacío", () => {
    const huge = Array.from({ length: 20 }, () => "x".repeat(500));
    const s = sampleQuotes(huge, { count: 8, maxChars: 100 });
    expect(s.length).toBeGreaterThan(0);
    expect(s.join("").length).toBeLessThan(1000);
  });

  it("sin highlights devuelve lista vacía", () => {
    expect(sampleQuotes([])).toEqual([]);
  });
});

describe("readBookIdentity", () => {
  it("lee lo que identifica al libro", () => {
    const id = readBookIdentity(book(["a", "b", "c"]));
    expect(id.title).toBe("1929: Inside the Greatest Crash");
    expect(id.author).toBe("Andrew Ross Sorkin");
    expect(id.asin).toBe("B0DXMZWTYM");
    expect(id.quoteCount).toBe(3);
  });
});

describe("normalizeAuthor", () => {
  it("el orden y los puntos de las iniciales no cambian la persona", () => {
    expect(normalizeAuthor("Kyle, Albert S.")).toBe(normalizeAuthor("Albert S Kyle"));
  });

  it("los acentos tampoco", () => {
    expect(normalizeAuthor("Ramón Pérez")).toBe(normalizeAuthor("Ramon Perez"));
  });
});

describe("sameBook", () => {
  it("el ASIN manda cuando está", () => {
    expect(sameBook({ asin: "A1", title: "x" }, { asin: "A1", title: "y" })).toBe(true);
    expect(sameBook({ asin: "A1" }, { asin: "A2" })).toBe(false);
  });

  it("Infinity y Infinite NO son el mismo libro", () => {
    // El repro de B-506: una letra de diferencia, dos libros que no tienen nada
    // que ver (Mallaby/DeepMind vs Russo/Ethereum). Cualquier fuzzy los une.
    expect(
      sameBook(
        { title: "The Infinity Machine", author: "Sebastian Mallaby" },
        { title: "The Infinite Machine", author: "Camila Russo" },
      ),
    ).toBe(false);
  });

  it("mismo título con puntuación distinta sí es el mismo libro", () => {
    expect(
      sameBook(
        { title: "1929: Inside the Crash", author: "Sorkin" },
        { title: "1929 — Inside the Crash", author: "Sorkin" },
      ),
    ).toBe(true);
  });

  it("mismo título pero otro autor no alcanza", () => {
    expect(sameBook({ title: "Range", author: "David Epstein" }, { title: "Range", author: "Otro" }))
      .toBe(false);
  });
});

describe("checkCoherence", () => {
  const id = readBookIdentity(book(["a", "b"]));

  it("un autor distinto es la señal fuerte de que la ficha es de otro libro", () => {
    const flag = checkCoherence(id, { topic: "macro", author: "Camila Russo" });
    expect(flag?.confidence).toBe("alta");
    expect(flag?.reason).toContain("Camila Russo");
  });

  it("un topic distinto se marca, pero con menos confianza", () => {
    const clasificado = readBookIdentity(
      `---\ntitle: x\nauthor: Andrew Ross Sorkin\ntopic: cultura\n---\n\n> cita\n`,
    );
    expect(checkCoherence(clasificado, { topic: "macro", author: "Andrew Ross Sorkin" })?.confidence)
      .toBe("media");
  });

  it("`otros` no cuenta como desacuerdo: es la ausencia de clasificación", () => {
    // Sin esto el backfill inicial escupe 33 falsas alarmas, porque TODOS los
    // libros arrancan en `otros`.
    expect(checkCoherence(id, { topic: "macro", author: "Andrew Ross Sorkin" })).toBeUndefined();
  });

  it("una ficha sin highlights no se puede verificar y eso se dice", () => {
    const empty = readBookIdentity(book([]));
    expect(checkCoherence(empty, { topic: "macro", author: "x" })?.reason)
      .toContain("no tiene highlights");
  });

  it("cuando todo coincide no hay flag", () => {
    const ok = readBookIdentity(`---\ntitle: x\nauthor: Sorkin\ntopic: macro\n---\n\n> cita\n`);
    expect(checkCoherence(ok, { topic: "macro", author: "Sorkin" })).toBeUndefined();
  });
});

describe("sameAuthor", () => {
  it("un libro de tres firmas se cita por el principal", () => {
    // 3 de las 4 alarmas del primer pase sobre la vault eran esto. Un check con
    // 75% de ruido no lo mira nadie.
    expect(sameAuthor("Gene Kim, Kevin Behr, and George Spafford", "Gene Kim")).toBe(true);
    expect(sameAuthor("Adrian Newey and David Coulthard", "Adrian Newey")).toBe(true);
  });

  it("el conector 'and' no es parte del nombre", () => {
    expect(sameAuthor("Gene Kim, Kevin Behr, and George Spafford", "Gene Kim, Kevin Behr, George Spafford"))
      .toBe(true);
  });

  it("autores realmente distintos siguen sin coincidir", () => {
    expect(sameAuthor("Sebastian Mallaby", "Camila Russo")).toBe(false);
  });

  it("si de un lado no hay autor, no se afirma nada", () => {
    expect(sameAuthor("", "Camila Russo")).toBe(true);
  });
});
