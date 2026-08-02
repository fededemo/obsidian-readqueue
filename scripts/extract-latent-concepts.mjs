#!/usr/bin/env node
/**
 * Conceptos `latente`: lo que Fede viene juntando y todavía no leyó (B-731).
 *
 * El pase de conexiones etiqueta las pendientes contra las notas-concepto que ya
 * existen, y todas nacieron de material leído. Por construcción, entonces, nunca
 * puede aparecer un concepto `latente` — el estatus existe en el modelo
 * (ADR-005 §9-bis.3) pero no se puede instanciar. Las pendientes que no encajan
 * en ningún concepto son exactamente los candidatos que faltan.
 *
 * Método **top-down**, igual que B-724c: primero se destila un vocabulario
 * cerrado sobre el conjunto entero, después se etiqueta contra él. El bottom-up
 * (extraer conceptos nota por nota y fusionar) ya se probó y falló: el modelo
 * renombra en vez de fusionar y el vocabulario crece en vez de converger.
 *
 * No escribe en la vault. Deja una propuesta en el repo.
 *
 *   node scripts/extract-latent-concepts.mjs [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadConcepts } from "./lib/concepts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNREAD = join(HERE, "../docs/vault-gardener/unread-concepts.json");
const OUT_DATA = join(HERE, "../docs/vault-gardener/latent-concepts.json");
const OUT_DOC = join(HERE, "../docs/vault-gardener/proposals/2026-08-01-conceptos-latentes.md");
const VAULT = join(homedir(), "fedenotes");
const DISTILL_MODEL = "claude-opus-5";
const LABEL_MODEL = "claude-haiku-4-5";
const CONCURRENCY = 8;
/** B-735: un cluster de más de 20 fuentes es un paraguas, no un concepto. */
const MAX_SOURCES = 20;
const MIN_SOURCES = 2;
const DRY = process.argv.includes("--dry-run");

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;

async function ask(model, prompt, maxTokens, adaptive) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Sonnet/Opus 5 corren adaptive thinking por default: omitirlo consume el
      // presupuesto pensando y devuelve stop_reason max_tokens sin texto.
      thinking: adaptive ? { type: "adaptive" } : { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
}

const json = (text) => {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("sin JSON en la respuesta");
  return JSON.parse(m[0]);
};

const rows = JSON.parse(await readFile(UNREAD, "utf-8"));
const existing = (await loadConcepts(VAULT)).map((c) => c.name);

/** El tldr no se guardó al etiquetar; se relee de la vault en vez de re-clasificar. */
const orphans = [];
for (const r of rows.filter((x) => x.concepts.length === 0)) {
  let tldr = "";
  try {
    const text = await readFile(join(VAULT, r.path), "utf-8");
    tldr =
      text.match(/^tldr:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ??
      text.replace(/^---[\s\S]*?\n---/, "").replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    // Nota borrada entre pases: entra igual, con el título como única señal.
  }
  orphans.push({ ...r, tldr });
}

console.log(
  `pendientes sin concepto: ${orphans.length} · vocabulario existente: ${existing.length}` +
    (DRY ? " · DRY RUN" : ""),
);
if (DRY || orphans.length === 0) process.exit(0);

// --- 1. Destilar el vocabulario nuevo -------------------------------------

const list = orphans.map((r, i) => `${i + 1}. [${r.topic ?? "?"}] ${r.note} — ${r.tldr ?? ""}`.slice(0, 220)).join("\n");

const distillPrompt = `Estas son ${orphans.length} lecturas PENDIENTES de alguien. Ninguna encajó en su vocabulario
de conceptos actual, que es este:

${existing.map((n) => `- ${n}`).join("\n")}

Las pendientes:

${list}

Destilá un vocabulario CERRADO de conceptos nuevos que cubra estas lecturas.

Reglas duras:
- Un concepto tiene que AFIRMAR algo discutible, no nombrar un tema. "Los agentes
  de IA fallan por falta de contexto, no de capacidad" es un concepto; "IA" es una
  etiqueta. Si nadie puede estar en desacuerdo, no sirve.
- Ninguno puede solaparse con el vocabulario existente de arriba.
- Ninguno debe ser tan amplio que cubra más de ~20 de estas lecturas.
- Preferí 8-15 conceptos filosos antes que 30 vagos o 4 paraguas.
- Está bien que algunas lecturas queden afuera. No fuerces cobertura.

Para cada uno devolvé nombre (frase nominal en español, sin comillas) y gloss
(1-2 oraciones que afirmen la tesis).

Respondé SOLO JSON: {"concepts":[{"name":"...","gloss":"..."}]}`;

console.log(`\ndestilando vocabulario con ${DISTILL_MODEL}…`);
const distilled = json(await ask(DISTILL_MODEL, distillPrompt, 8000, true)).concepts ?? [];
console.log(`propuestos: ${distilled.length}`);
for (const c of distilled) console.log(`  · ${c.name}`);

// --- 2. Etiquetar contra el vocabulario nuevo ------------------------------

const vocabList = distilled.map((c) => `- ${c.name}: ${c.gloss}`).join("\n");
const valid = new Map(distilled.map((c) => [c.name.toLowerCase(), c.name]));
const buckets = new Map(distilled.map((c) => [c.name, []]));

const labelPrompt = (row) => `Vocabulario cerrado de conceptos:
${vocabList}

Lectura pendiente: "${row.note}" (tema: ${row.topic ?? "?"})
De qué trata: ${row.tldr ?? ""}

¿Cuáles conceptos del vocabulario aparecen realmente en esta lectura? Máximo 2.
Si ninguno encaja de verdad, devolvé lista vacía — es preferible a forzar.

Respondé SOLO JSON: {"concepts":["<nombre exacto>"]}`;

console.log(`\netiquetando ${orphans.length} pendientes con ${LABEL_MODEL}…`);
const queue = [...orphans];
let failed = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const names = json(await ask(LABEL_MODEL, labelPrompt(row), 250, false)).concepts ?? [];
        for (const raw of names.slice(0, 2)) {
          const name = valid.get(String(raw).toLowerCase().trim());
          if (name) buckets.get(name).push(row.note);
        }
      } catch {
        failed++;
      }
    }
  }),
);

// --- 3. Filtrar a conceptos que se sostienen -------------------------------

const latent = distilled
  .map((c) => ({ ...c, sources: buckets.get(c.name) ?? [] }))
  .filter((c) => c.sources.length >= MIN_SOURCES && c.sources.length <= MAX_SOURCES)
  .sort((a, b) => b.sources.length - a.sources.length);

const descartados = distilled.length - latent.length;
const cubiertas = new Set(latent.flatMap((c) => c.sources)).size;

console.log(
  `\nconceptos latentes: ${latent.length} (descartados ${descartados} por <${MIN_SOURCES} o >${MAX_SOURCES} fuentes)` +
    ` · cubren ${cubiertas}/${orphans.length} pendientes · fallaron ${failed}`,
);

await writeFile(
  OUT_DATA,
  JSON.stringify({ generado: "2026-08-01", latent, orphans: orphans.length }, null, 1),
  "utf-8",
);

const doc = `# Conceptos latentes — lo que venís juntando y no leíste

> Generado por \`scripts/extract-latent-concepts.mjs\` el 2026-08-01. Datos: \`latent-concepts.json\`.
> Propuesta: **no está escrito en la vault**.

## Por qué existe este pase

El modelo de ADR-005 §9-bis.3 tiene tres estatus de concepto:

| Estatus | Cuándo |
|---|---|
| \`conocido\` | ≥2 fuentes **leídas** lo sostienen |
| \`emergente\` | 1 leída |
| \`latente\` | **solo fuentes no leídas** — se lista, no se sintetiza |

Hasta acá las 29 notas-concepto eran **todas \`conocido\`**, y no por casualidad: el
vocabulario se destiló sobre material leído, así que ningún concepto podía nacer
sin lecturas detrás. El estatus \`latente\` existía en el diseño y no se podía
instanciar.

Este pase toma las **${orphans.length} pendientes que no encajaron en ningún concepto existente** y
les destila un vocabulario propio. Lo que sale son temas sobre los que Fede
acumuló material y todavía no leyó nada.

## Los ${latent.length} conceptos latentes

Cubren ${cubiertas} de las ${orphans.length} pendientes huérfanas. Se descartaron ${descartados} candidatos por
tener menos de ${MIN_SOURCES} fuentes (no se sostienen) o más de ${MAX_SOURCES} (son paraguas — B-735).

${latent
  .map(
    (c) => `### ${c.name}

${c.gloss}

**${c.sources.length} fuentes, ninguna leída:**

${c.sources.map((s) => `- [[${s}]]`).join("\n")}
`,
  )
  .join("\n")}

## Qué hacer con esto

Un concepto \`latente\` **no se sintetiza**: no hay nada que sintetizar, no leíste
ninguna. Se lista. Su función es doble:

1. **Mostrar el sesgo de tu cola** — dónde acumulás sin consumir.
2. **Promoverse solo**: al leer 2 fuentes de un latente, pasa a \`conocido\` y ahí
   sí vale escribir la síntesis con el estándar de \`ESTANDAR-NOTAS-CONCEPTO.md\`.

Por eso estas notas se escriben con la sección de fuentes y **sin tesis** — poner
una tesis sobre material no leído sería inventarla.
`;

await writeFile(OUT_DOC, doc, "utf-8");
console.log(`reporte -> ${OUT_DOC.replace(/^.*obsidian-readqueue\//, "")}`);
