import { describe, expect, it } from "vitest";

import {
  isLastSundayOfQuarter,
  journalDayKey,
  renderJournalHoy,
  saturdayWeekIndex,
  suggestedCloseDate,
} from "../src/journal-hoy";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("renderJournalHoy", () => {
  it("el hecho es siempre el de ayer", () => {
    for (const d of [21, 22, 23, 24, 25, 26, 27]) {
      const md = renderJournalHoy(day(2026, 9, d));
      expect(md).toContain("**Hecho de ayer**");
      expect(md).not.toContain("qué pasó hoy");
    }
  });

  it("el jueves pregunta por la asignación del tiempo", () => {
    const md = renderJournalHoy(day(2026, 9, 24));
    expect(md).toContain("jueves 24 de septiembre");
    expect(md).toContain("trabajo, pareja, hija, cuerpo, amigos y juego");
    expect(md).toContain("→ C:");
  });

  it("el miércoles junta la evitación con lo que no maté, y la prueba cierra en C:", () => {
    const md = renderJournalHoy(day(2026, 9, 23));
    expect(md).toContain("conversación");
    expect(md).toContain("solo porque no lo maté");
    expect(md).toContain("prueba de una semana");
  });

  it("el viernes pide a alguien de casa", () => {
    expect(renderJournalHoy(day(2026, 9, 25))).toContain("alguien de tu casa");
  });

  it("el sábado 26 de septiembre es la semana 1, pareja", () => {
    expect(saturdayWeekIndex(day(2026, 9, 26))).toBe(0);
    const md = renderJournalHoy(day(2026, 9, 26));
    expect(md).toContain("Pareja");
    expect(md).toContain("semana 1 de 8");
    expect(md).toContain("qué necesita esta semana");
  });

  it("ocho sábados después vuelve a pareja", () => {
    expect(saturdayWeekIndex(day(2026, 11, 21))).toBe(0);
    expect(renderJournalHoy(day(2026, 11, 14))).toContain("Aprendizaje");
  });

  it("el último domingo del trimestre suma la pregunta de lo que faltó", () => {
    expect(isLastSundayOfQuarter(day(2026, 9, 27))).toBe(true);
    expect(renderJournalHoy(day(2026, 9, 27))).toContain("no apareció nunca");
    expect(isLastSundayOfQuarter(day(2026, 9, 20))).toBe(false);
    expect(renderJournalHoy(day(2026, 9, 20))).not.toContain("no apareció nunca");
  });
});

describe("guía de la conjetura", () => {
  it("todos los días traen ejemplo con fecha real y la receta plegada", () => {
    for (let d = 21; d <= 27; d++) {
      const md = renderJournalHoy(day(2026, 9, d));
      expect(md).toMatch(/Ejemplo: `C: .+ — \d+% — 2026-\d\d-\d\d — abierta`/);
      expect(md).toContain("> [!tip]- Cómo armar la C:");
      expect(md).toContain("Para qué:");
    }
  });

  it("los ocho sábados tienen ejemplo", () => {
    for (let w = 0; w < 8; w++) {
      const md = renderJournalHoy(day(2026, 9, 26 + 7 * w));
      expect(md).toMatch(/Ejemplo: `C: .+ — \d+% — /);
    }
  });

  it("la fecha sugerida es el primer domingo a 5 días o más", () => {
    const key = (d: Date) => journalDayKey(suggestedCloseDate(d));
    expect(key(day(2026, 9, 21))).toBe("2026-09-27"); // lunes: 6 días
    expect(key(day(2026, 9, 22))).toBe("2026-09-27"); // martes: 5 días
    expect(key(day(2026, 9, 23))).toBe("2026-10-04"); // miércoles: 4, salta
    expect(key(day(2026, 9, 27))).toBe("2026-10-04"); // domingo: el próximo
    expect(renderJournalHoy(day(2026, 9, 21))).toContain("el domingo 2026-09-27");
  });

  it("el domingo es un procedimiento y cubre la semana sin vencidas", () => {
    const md = renderJournalHoy(day(2026, 9, 27));
    expect(md).toContain("   - Las que vencieron");
    expect(md).toContain("Si no venció ninguna");
    expect(md).toContain("¿de qué área son casi todas?");
    expect(md).toContain("Si no maté nada");
  });
});

describe("journalDayKey", () => {
  it("cambia a medianoche local, no en UTC", () => {
    expect(journalDayKey(new Date(2026, 8, 25, 23, 59))).toBe("2026-09-25");
    expect(journalDayKey(new Date(2026, 8, 26, 0, 1))).toBe("2026-09-26");
  });
});
