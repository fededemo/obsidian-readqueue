/**
 * Lo que hay que escribir hoy. El hecho es siempre el de ayer; rotan la
 * pregunta y la conjetura, que trae ejemplo y receta porque en blanco no
 * sale. El sábado recorre ocho dominios desde el
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
    example: "Si le pregunto qué necesita esta semana, pide algo que no anticipé — 60%",
  },
  {
    name: "Paternidad",
    question: "¿Qué tipo de padre estoy siendo esta semana, no el que pienso ser?",
    example: "Si dejo el teléfono en otro cuarto durante la cena, ella me cuenta algo de su día sin que le pregunte — 50%",
  },
  {
    name: "Cuerpo",
    question: "¿Qué me está diciendo el cuerpo que ignoro?",
    example: "Si camino 30 min 4 días, duermo más de 7 horas al menos 3 noches — 55%",
  },
  {
    name: "Amigos",
    question: "¿A quién no vi hace demasiado, y por qué?",
    example: "Si le escribo hoy a alguien que extraño, quedamos en una fecha antes del domingo — 40%",
  },
  {
    name: "Juego",
    question: "¿Qué hice solo porque sí?",
    example: "Si me reservo una hora sin objetivo, la termino usando para trabajar — 70%",
  },
  {
    name: "Dinero",
    question: "¿Qué decisión de plata estoy postergando?",
    example: "Si le dedico 30 minutos esta semana, la tomo antes del domingo — 50%",
  },
  {
    name: "Identidad",
    question: "¿Quién soy si mañana no tengo cargo?",
    example: "Si en una charla me presento sin decir en qué trabajo, me incomoda y lo termino diciendo — 75%",
  },
  {
    name: "Aprendizaje",
    question: "¿Qué idea me cambió algo este mes? ¿Qué no entiendo y me gustaría entender?",
    example: "Si la leo una vez más, puedo explicarle esa idea a alguien de casa en dos minutos — 45%",
  },
] as const;

export const JOURNAL_HOY_PATH = "Journal/Hoy.md";

/** Fecha local `YYYY-MM-DD`: cuando cambia, Hoy hay que reescribirlo. */
export function journalDayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

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
  /** Pasos bajo el 2: el domingo es un procedimiento, no una pregunta. */
  steps?: string[];
  q3: string;
  /** Una C: posible para ese día, con su %; la fecha la pone el render. */
  example: string;
  extra?: string;
}

function promptFor(date: Date): DayPrompt {
  switch (date.getDay()) {
    case 1:
      return {
        q2: "**Problema.** ¿Cuál es el problema más interesante que tengo, en cualquier área, no el más urgente?",
        q3: "¿Qué creo sobre ese problema que podría ser falso?",
        example:
          "Si le dedico dos horas seguidas a ese problema, descubro que el cuello de botella no es el que creo — 40%",
      };
    case 2:
      return {
        q2: "**Error.** Puede ser sobre una persona, sobre tu cuerpo o sobre vos. ¿En qué me equivoqué o cambié de opinión, y qué lo refutó?",
        q3: "¿Qué voy a creer distinto, y en qué fecha se puede comprobar?",
        example:
          "La próxima vez que alguien llegue tarde, cuando le pregunte va a tener una razón que yo no imaginé — 70%",
      };
    case 3:
      return {
        q2: "**Evitación.** Casi nunca es un proyecto: suele ser una conversación, un chequeo o una decisión con tu pareja. ¿Qué estoy evitando, qué explicación me doy, y cuál sería mejor? En la misma respuesta: ¿qué sigue vivo solo porque no lo maté?",
        q3: "¿Qué prueba de una semana mostraría que esa explicación es falsa?",
        example:
          "Si tengo esa conversación esta semana, dura menos de 15 minutos y sale mejor de lo que temo — 65%",
      };
    case 4:
      return {
        q2: "**Asignación.** ¿Cómo repartí el tiempo entre trabajo, pareja, hija, cuerpo, amigos y juego, y lo elegiría de nuevo?",
        q3: "Si la semana que viene se parece a esta, ¿qué área queda otra vez abajo?",
        example: "La semana que viene paso menos de una hora con amigos — 80%",
      };
    case 5:
      return {
        q2: "**Otros.** Al menos una vez por semana, alguien de tu casa. ¿Qué aprendí de alguien ayer, y a quién le debo una respuesta, un agradecimiento o una conversación difícil?",
        q3: "¿Qué creo de esa deuda que dentro de un mes puede no ser cierto?",
        example: "Si le agradezco en persona, me contesta algo que no esperaba — 50%",
      };
    case 6: {
      const week = saturdayWeekIndex(date);
      const domain = SATURDAY[week];
      if (!domain) {
        return {
          q2: "**Sábado.**",
          q3: "Una conjetura sobre este sábado.",
          example: "Si mañana hago algo solo porque sí, el lunes arranco con más ganas — 50%",
        };
      }
      return {
        q2: `**${domain.name}** (semana ${week + 1} de 8). ${domain.question}`,
        q3: `Una conjetura sobre ${domain.name.toLowerCase()}, con fecha y %.`,
        example: domain.example,
      };
    }
    default: {
      const extra = isLastSundayOfQuarter(date)
        ? "Último domingo del trimestre: ¿Qué área de mi vida no apareció nunca en este cuaderno?"
        : undefined;
      return {
        q2: "**Revisión.** Abrí las páginas de la semana y copiá cada C: a una lista, en el cuaderno o en `Journal/Conjeturas.md`.",
        steps: [
          "Las que vencieron: `acertó` o `falló`, y una línea sobre qué te sorprendió.",
          "Las que no vencieron: ¿subirías o bajarías el %? Anotá el nuevo al lado.",
          "Si no venció ninguna (pasa las primeras semanas): elegí la más cercana y anotá qué viste esta semana a favor o en contra.",
          "¿Qué maté que todavía se movía? Si no maté nada, escribí «nada».",
        ],
        q3: "¿Qué patrón veo que el lunes no veía? Mirá la lista: ¿de qué área son casi todas? ¿Los % son todos altos? ¿Cuál te costó escribir? El patrón vuelve como C: sobre la semana que viene.",
        example: "La semana que viene, más de la mitad de mis C: son de trabajo — 60%",
        extra,
      };
    }
  }
}

/**
 * Fecha sugerida para cerrar una C: el primer domingo a 5 días o más, así
 * vence en una revisión cercana pero hay tiempo para que pase algo.
 */
export function suggestedCloseDate(date: Date): Date {
  const daysToSunday = (7 - date.getDay()) % 7;
  const offset = daysToSunday >= 5 ? daysToSunday : daysToSunday + 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function howToConjecture(closeKey: string): string[] {
  return [
    "> [!tip]- Cómo armar la C:",
    "> Partí de lo que escribiste en el 2.",
    ">",
    "> 1. ¿Qué espero que pase por eso? Una sola cosa.",
    "> 2. ¿Cómo lo vería? Algo que pasa o no pasa, no «me siento mejor».",
    `> 3. ¿Para cuándo? Por defecto, el domingo ${closeKey}. Más lejos solo si de verdad lleva más.`,
    "> 4. ¿Cuánto %? 50 = no tengo idea, 90 = me sorprendería que falle. Si es 100, no es conjetura.",
    ">",
    "> Prueba: el día de la fecha, ¿podés decir acertó o falló sin discutir con vos mismo? Si no, achicala.",
    ">",
    "> Para qué: una opinión vaga no se puede revisar; una C: con % y fecha, sí. Los domingos muestran en qué áreas tu intuición acierta y en cuáles no. Las que fallan son las que enseñan.",
  ];
}

export function renderJournalHoy(date: Date): string {
  const day = DIAS[date.getDay()] ?? "hoy";
  const month = MESES[date.getMonth()] ?? "";
  const { q2, steps, q3, example, extra } = promptFor(date);
  const closeKey = journalDayKey(suggestedCloseDate(date));
  const lines = [
    `# Hoy — ${day} ${date.getDate()} de ${month}`,
    "",
    "Sobre ayer. Las respuestas van en el cuaderno.",
    "",
    "1. **Hecho de ayer**, sin explicarlo.",
    `2. ${q2}`,
    ...(steps ?? []).map((step) => `   - ${step}`),
    `3. → C: ${q3}`,
    "",
    "`C: … — __% — fecha — abierta`",
    "",
    `Ejemplo: \`C: ${example} — ${closeKey} — abierta\``,
    "",
    ...howToConjecture(closeKey),
    "",
    "Si el día está roto, solo el 1.",
  ];
  if (extra) lines.push("", extra);
  lines.push("", "---", "", "La contratapa completa: [[Guía]]", "");
  return lines.join("\n");
}
