/**
 * Lo que hay que escribir hoy. El hecho es siempre el de ayer; rotan la
 * pregunta y la conjetura. El sábado recorre ocho dominios desde el
 * 2026-09-26 (semana 1, pareja).
 */

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

/** Sábado de la semana 1. */
const CYCLE_START_UTC = Date.UTC(2026, 8, 26);

const SATURDAY = [
  {
    name: "Pareja",
    question: "¿Qué sabe ella de mí que yo no le dije?",
    example: "Si pregunto qué necesita esta semana, pide algo que no anticipé — __%",
  },
  {
    name: "Paternidad",
    question: "¿Qué tipo de padre estoy siendo esta semana, no el que pienso ser?",
    example: "En 3 meses voy a cambiar la opinión que tengo hoy sobre la crianza — __%",
  },
  {
    name: "Cuerpo",
    question: "¿Qué me está diciendo el cuerpo que ignoro?",
    example: "Si camino 30 min 4 días, duermo mejor — __%",
  },
  {
    name: "Amigos",
    question: "¿A quién no vi hace demasiado, y por qué?",
    example: "Si le escribo a alguien que extraño, nos vemos antes de fin de mes — __%",
  },
  {
    name: "Juego",
    question: "¿Qué hice solo porque sí?",
    example: "",
  },
  {
    name: "Dinero",
    question: "¿Qué decisión de plata estoy postergando?",
    example: "",
  },
  {
    name: "Identidad",
    question: "¿Quién soy si mañana no tengo cargo?",
    example: "",
  },
  {
    name: "Aprendizaje",
    question: "¿Qué idea me cambió algo este mes? ¿Qué no entiendo y me gustaría entender?",
    example: "",
  },
] as const;

export const JOURNAL_HOY_PATH = "Journal/Hoy.md";

export function saturdayWeekIndex(date: Date): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((utc - CYCLE_START_UTC) / 86_400_000);
  const weeks = Math.floor(days / 7);
  return ((weeks % 8) + 8) % 8;
}

export function isLastSundayOfQuarter(date: Date): boolean {
  if (date.getDay() !== 0) return false;
  const month = date.getMonth();
  if (month !== 2 && month !== 5 && month !== 8 && month !== 11) return false;
  const next = new Date(date.getFullYear(), month, date.getDate() + 7);
  return next.getMonth() !== month;
}

interface DayPrompt {
  q2: string;
  q3: string;
  extra?: string;
}

function promptFor(date: Date): DayPrompt {
  switch (date.getDay()) {
    case 1:
      return {
        q2: "**Problema.** ¿Cuál es el problema más interesante que tengo, en cualquier área, no el más urgente?",
        q3: "¿Qué creo sobre ese problema que podría ser falso?",
      };
    case 2:
      return {
        q2: "**Error.** Puede ser sobre una persona, sobre tu cuerpo o sobre vos. ¿En qué me equivoqué o cambié de opinión, y qué lo refutó?",
        q3: "¿Qué voy a creer distinto, y en qué fecha se puede comprobar?",
      };
    case 3:
      return {
        q2: "**Evitación.** Casi nunca es un proyecto: suele ser una conversación, un chequeo o una decisión con tu pareja. ¿Qué estoy evitando, qué explicación me doy, y cuál sería mejor? En la misma respuesta: ¿qué sigue vivo solo porque no lo maté?",
        q3: "¿Qué prueba de una semana mostraría que esa explicación es falsa?",
      };
    case 4:
      return {
        q2: "**Asignación.** ¿Cómo repartí el tiempo entre trabajo, pareja, hija, cuerpo, amigos y juego, y lo elegiría de nuevo?",
        q3: "Si la semana que viene se parece a esta, ¿qué área queda otra vez abajo?",
      };
    case 5:
      return {
        q2: "**Otros.** Al menos una vez por semana, alguien de tu casa. ¿Qué aprendí de alguien ayer, y a quién le debo una respuesta, un agradecimiento o una conversación difícil?",
        q3: "¿Qué creo de esa deuda que dentro de un mes puede no ser cierto?",
      };
    case 6: {
      const domain = SATURDAY[saturdayWeekIndex(date)];
      if (!domain) {
        return { q2: "**Sábado.**", q3: "Una conjetura sobre este sábado." };
      }
      const example = domain.example
        ? `Ejemplo: \`C: ${domain.example} — fecha — abierta\``
        : undefined;
      return {
        q2: `**${domain.name}** (semana ${saturdayWeekIndex(date) + 1} de 8). ${domain.question}`,
        q3: `Una conjetura sobre ${domain.name.toLowerCase()}, con fecha y %.`,
        extra: example,
      };
    }
    default: {
      const extra = isLastSundayOfQuarter(date)
        ? "Último domingo del trimestre: ¿Qué área de mi vida no apareció nunca en este cuaderno?"
        : undefined;
      return {
        q2: "**Revisión.** ¿Qué conjeturas se cerraron, y acerté o no? ¿Qué maté que todavía se movía? Si no maté nada, escribí «nada».",
        q3: "¿Qué patrón veo que el lunes no veía?",
        extra,
      };
    }
  }
}

export function renderJournalHoy(date: Date): string {
  const day = DIAS[date.getDay()] ?? "hoy";
  const month = MESES[date.getMonth()] ?? "";
  const { q2, q3, extra } = promptFor(date);
  const lines = [
    `# Hoy — ${day} ${date.getDate()} de ${month}`,
    "",
    "Sobre ayer. Las respuestas van en el cuaderno.",
    "",
    "1. **Hecho de ayer**, sin explicarlo.",
    `2. ${q2}`,
    `3. → C: ${q3}`,
    "",
    "`C: … — __% — fecha — abierta`",
    "",
    "Si el día está roto, solo el 1.",
  ];
  if (extra) lines.push("", extra);
  lines.push("", "---", "", "La contratapa completa: [[Guía]]", "");
  return lines.join("\n");
}
