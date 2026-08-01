#!/usr/bin/env node
/**
 * Pase de conexiones con los 3 tipos (B-731 / ADR-005 §9-bis).
 *
 * El primer demo del gardener mezcló leído con no leído — 15 de 17 notas
 * conectadas estaban sin leer — y por eso Fede no lo pudo validar: no se puede
 * juzgar "esto se conecta con aquello" si no leíste ninguna de las dos.
 *
 * Acá cada conexión queda tipada:
 *
 *   consolidar  leída ↔ leída       podés juzgarla hoy; es la que valida el modelo
 *   atraer      leída ↔ no leída    el motor de la cola: "leé esto porque ya sabés aquello"
 *   agrupar     no leída ↔ no leída solo señala un bloque temático, no afirma nada
 *
 * No escribe en la vault ni llama a la API: cruza `concept-canon.json` (leídas)
 * con `unread-concepts.json` (no leídas) y saca el reporte.
 *
 *   node scripts/connection-pass.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadConcepts } from "./lib/concepts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = join(homedir(), "fedenotes");
const UNREAD = join(HERE, "../docs/vault-gardener/unread-concepts.json");
const OUT_DATA = join(HERE, "../docs/vault-gardener/connections.json");
const OUT_DOC = join(HERE, "../docs/vault-gardener/proposals/2026-08-01-conexiones-3-tipos.md");

const concepts = await loadConcepts(VAULT);
const unread = JSON.parse(await readFile(UNREAD, "utf-8"));

/** concepto -> { read: [notas], unread: [notas] } */
const byConcept = new Map(
  concepts.map((c) => [c.name, { gloss: c.gloss, read: c.readSources, unread: [] }]),
);
for (const row of unread) {
  for (const name of row.concepts) byConcept.get(name)?.unread.push(row.note);
}

/**
 * Pares dentro de un concepto. No los enumeramos: con 25 leídas y 56 no leídas
 * un solo concepto genera 1.400 pares, y una lista de 1.400 filas no es un
 * hallazgo, es ruido. Lo que importa es el conteo por tipo y, sobre todo, los
 * vecinos por nota — que es lo que consume el priorizador.
 */
const pairs = (n) => (n * (n - 1)) / 2;
let consolidar = 0,
  atraer = 0,
  agrupar = 0;
for (const c of byConcept.values()) {
  consolidar += pairs(c.read.length);
  atraer += c.read.length * c.unread.length;
  agrupar += pairs(c.unread.length);
}

/** Por nota no leída: cuántas LEÍDAS distintas comparten alguno de sus conceptos. */
const neighbours = new Map();
for (const row of unread) {
  const set = new Set();
  for (const name of row.concepts) for (const r of byConcept.get(name)?.read ?? []) set.add(r);
  neighbours.set(row.note, { n: set.size, concepts: row.concepts, topic: row.topic });
}

const values = [...neighbours.values()].map((v) => v.n);
const distinct = new Set(values).size;
const withContext = values.filter((v) => v > 0).length;

// Baseline: lo que da hoy el priorizador, que cuenta vecinos por `topic`.
const readByTopic = new Map();
// Recursivo a propósito: `Inbox/Read` se archiva por mes y `Inbox/Legacy` tiene
// `Matter/`, así que un readdir plano cuenta solo Kindle y el baseline sale mal.
const countTopics = async (rel) => {
  const dir = join(VAULT, rel);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      await countTopics(join(rel, entry.name));
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const text = await readFile(join(dir, entry.name), "utf-8");
    const topic = text.match(/^topic:\s*(.*)$/m)?.[1]?.trim();
    if (topic) readByTopic.set(topic, (readByTopic.get(topic) ?? 0) + 1);
  }
};
for (const folder of ["Inbox/Read", "Inbox/Legacy", "Inbox/Kindle"]) await countTopics(folder);
const topicValues = [...neighbours.values()].map((v) => readByTopic.get(v.topic) ?? 0);

/** Cuántas PENDIENTES hay por topic — para ilustrar el achatamiento del baseline. */
const topicCounts = new Map();
for (const v of neighbours.values()) {
  if (v.topic) topicCounts.set(v.topic, (topicCounts.get(v.topic) ?? 0) + 1);
}

const summary = {
  conceptos: byConcept.size,
  leidas: new Set(concepts.flatMap((c) => c.readSources)).size,
  noLeidas: unread.length,
  noLeidasConConcepto: unread.filter((r) => r.concepts.length > 0).length,
  conexiones: { consolidar, atraer, agrupar },
  vecinos: {
    porConcepto: { valoresDistintos: distinct, conContexto: withContext, max: Math.max(...values) },
    porTopic: { valoresDistintos: new Set(topicValues).size },
  },
};

console.log(JSON.stringify(summary, null, 2));

const top = [...neighbours.entries()]
  .filter(([, v]) => v.n > 0)
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 15);

await writeFile(
  OUT_DATA,
  JSON.stringify(
    {
      generado: "2026-08-01",
      summary,
      conceptos: [...byConcept.entries()].map(([name, c]) => ({
        name,
        gloss: c.gloss,
        read: c.read,
        unread: c.unread,
      })),
      vecinos: Object.fromEntries([...neighbours].map(([k, v]) => [k, v.n])),
    },
    null,
    1,
  ),
  "utf-8",
);

const fmt = (n) => n.toLocaleString("es-AR");
const doc = `# Pase de conexiones con los 3 tipos — B-731

> Generado por \`scripts/connection-pass.mjs\` el 2026-08-01. Datos: \`connections.json\`.
> Reemplaza al demo del 2026-07-13, que mezclaba leído con no leído (15 de 17 notas conectadas estaban sin leer).

## Qué cambió respecto del primer demo

El demo viejo proponía conexiones sin decir si Fede había leído las notas de cada lado.
Eso lo hacía **imposible de validar**: no se puede juzgar si dos textos se conectan
cuando no leíste ninguno de los dos. Ahora cada conexión lleva tipo.

| Tipo | Qué une | Cuántas | Para qué sirve |
|---|---|--:|---|
| **consolidar** | leída ↔ leída | ${fmt(consolidar)} | La única que Fede puede juzgar hoy. Valida el modelo |
| **atraer** | leída ↔ no leída | ${fmt(atraer)} | El motor de la cola: "leé esto porque ya sabés aquello" |
| **agrupar** | no leída ↔ no leída | ${fmt(agrupar)} | Señala un bloque temático. No afirma nada todavía |

Base: **${summary.conceptos} conceptos**, ${summary.leidas} notas leídas, ${summary.noLeidas} no leídas
(${summary.noLeidasConConcepto} encajaron en el vocabulario, ${summary.noLeidas - summary.noLeidasConConcepto} no).

## Por qué esto arregla el priorizador

Hoy \`rankQueue\` cuenta vecinos leídos **por \`topic\`**. Como hay ${summary.vecinos.porTopic.valoresDistintos} topics para ${summary.noLeidas} notas,
solo existen **${summary.vecinos.porTopic.valoresDistintos} valores distintos de contexto**: las ${topicCounts.get("tech") ?? 0} notas \`tech\` reciben todas el mismo número.
El factor de contexto varía 1,45× mientras \`shelfLife\` varía 20×, así que el contexto
que la card presenta como razón ("conecta con 48 notas que ya leíste") hoy es
técnicamente cierto y prácticamente inútil.

Con conceptos hay **${summary.vecinos.porConcepto.valoresDistintos} valores distintos** y ${summary.vecinos.porConcepto.conContexto} de ${summary.noLeidas} notas tienen contexto real
(máximo ${summary.vecinos.porConcepto.max}). Las ${summary.noLeidas - summary.vecinos.porConcepto.conContexto} restantes quedan **honestamente en cero**: material sobre el que
todavía no leíste nada. Eso también es información — es la cola "para explorar".

## Las 15 conexiones "atraer" más fuertes

Notas de tu cola con más material leído detrás. Son las que más rinde leer ahora.

| Nota pendiente | Vecinos leídos | Concepto que las conecta |
|---|--:|---|
${top.map(([note, v]) => `| ${note} | ${v.n} | ${v.concepts.join(" · ")} |`).join("\n")}

## Conceptos por peso de cola

Cuánto material pendiente cuelga de cada concepto. Un concepto con muchas no leídas
y pocas leídas es un tema que **venís juntando pero no atacaste**.

| Concepto | Leídas | No leídas |
|---|--:|--:|
${[...byConcept.entries()]
  .sort((a, b) => b[1].unread.length - a[1].unread.length)
  .map(([name, c]) => `| ${name} | ${c.read.length} | ${c.unread.length} |`)
  .join("\n")}

## Lo que este pase NO puede producir

El vocabulario es **cerrado** — las no leídas se etiquetan contra las ${summary.conceptos} notas-concepto
que ya existen, y todas salieron de material leído. Por construcción, entonces,
**ningún concepto puede nacer \`latente\`** (solo fuentes no leídas): todos heredan
al menos las lecturas que los originaron.

Los ${summary.noLeidas - summary.noLeidasConConcepto} pendientes sin encaje son justamente los candidatos a conceptos nuevos:
temas que Fede viene guardando y sobre los que todavía no leyó nada. Extraerlos
es lo que completa el modelo de tres estatus de forma honesta.
`;

await writeFile(OUT_DOC, doc, "utf-8");
console.log(`\nreporte -> ${OUT_DOC.replace(/^.*obsidian-readqueue\//, "")}`);
