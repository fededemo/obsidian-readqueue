#!/usr/bin/env node
/**
 * Pasada 2 del canon (ADR-003): agrupa los conceptos candidatos en un
 * vocabulario canónico.
 *
 * La pasada 1 devuelve un nombre distinto por nota ("contra-posicionamiento
 * competitivo", "posicionamiento contrario", "counter-positioning"...), así
 * que sin este paso no hay clusters y no hay grafo. Acá se ve todo junto y se
 * decide qué es lo mismo.
 *
 * Usa Sonnet: agrupar sinónimos entre 700+ candidatos es una tarea de juicio,
 * no de clasificación.
 *
 *   node scripts/canonicalize-concepts.mjs [--min 3]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "../docs/vault-gardener/concept-candidates.json");
const OUT = join(HERE, "../docs/vault-gardener/concept-canon.json");
const VAULT = join(homedir(), "fedenotes");
const MODEL = "claude-sonnet-5";

const args = process.argv.slice(2);
const MIN = Number(
  args.indexOf("--min") >= 0 ? args[args.indexOf("--min") + 1] : 3,
);

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;

const rows = JSON.parse(await readFile(IN, "utf-8"));
const names = [...new Set(rows.flatMap((r) => r.concepts.map((c) => c.name)))];
console.log(`${rows.length} notas · ${names.length} nombres candidatos`);

const BATCH = 130;

const batchPrompt = (chunk) => `Abajo hay ${chunk.length} nombres de conceptos extraídos de las lecturas de una persona.
Cada lectura generó los suyos por separado, así que la MISMA idea aparece con
muchos nombres distintos.

Agrupalos en conceptos canónicos.

Reglas:
- Agrupá agresivamente lo que es la misma idea aunque cambie el nombre
  ("contra-posicionamiento competitivo" y "posicionamiento contrario" = uno).
- Nombre canónico en español, 2-5 palabras, reutilizable.
- NO agrupes cosas que solo comparten dominio: "poder de mercado" y
  "economías de escala" son distintos aunque ambos sean de estrategia.
- Descartá los que son resumen de un texto puntual y no idea reutilizable.

Nombres:
${chunk.map((n) => `- ${n}`).join("\n")}

Respondé SOLO JSON, sin explicación previa:
{"canon":[{"name":"<canónico>","aliases":["<de la lista>"]}]}`;

async function askCanon(chunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      // Sonnet 5 corre adaptive thinking si se omite `thinking`, y en una tarea
      // de agrupación mecánica se comía el presupuesto entero pensando: la
      // respuesta llegaba con stop_reason max_tokens y solo un bloque thinking.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: batchPrompt(chunk) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = await res.json();
  // Sonnet emite un bloque `thinking` antes del texto.
  const text = (json?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`sin JSON (stop=${json?.stop_reason})`);
  return JSON.parse(m[0]).canon ?? [];
}

const chunks = [];
for (let i = 0; i < names.length; i += BATCH) chunks.push(names.slice(i, i + BATCH));
console.log(`canonicalizando en ${chunks.length} lotes de <=${BATCH}…`);

const canonRaw = (
  await Promise.all(
    chunks.map(async (c, i) => {
      try {
        const r = await askCanon(c);
        console.log(`  lote ${i + 1}/${chunks.length}: ${r.length} canónicos`);
        return r;
      } catch (e) {
        console.error(`  lote ${i + 1} falló: ${e.message}`);
        return [];
      }
    }),
  )
).flat();

// Los lotes no se vieron entre sí, así que cada uno inventó sus propios
// nombres: un merge por string exacto casi no agrupa. Segunda pasada sobre los
// canónicos parciales — ahora sí todos juntos, que es lo que permite fusionar.
const partial = new Map();
for (const c of canonRaw) {
  const key = c.name.toLowerCase().trim();
  if (!partial.has(key)) partial.set(key, { name: c.name.trim(), aliases: [] });
  partial.get(key).aliases.push(...(c.aliases ?? []));
}
console.log(`\nmerge global de ${partial.size} canónicos parciales…`);

const partialNames = [...partial.values()].map((c) => c.name);
let canon;
try {
  const mergedCanon = await askCanon(partialNames);
  // Reexpandir: cada alias del merge es un canónico parcial que arrastra los suyos.
  const byPartial = new Map(
    [...partial.entries()].map(([k, v]) => [k, v.aliases]),
  );
  canon = mergedCanon.map((m) => {
    const aliases = new Set();
    for (const a of [...(m.aliases ?? []), m.name]) {
      const k = a.toLowerCase().trim();
      aliases.add(a);
      for (const orig of byPartial.get(k) ?? []) aliases.add(orig);
    }
    return { name: m.name, aliases: [...aliases] };
  });
  console.log(`  ${partial.size} -> ${canon.length} canónicos finales`);
} catch (e) {
  console.error(`  merge global falló (${e.message}); uso los parciales`);
  canon = [...partial.values()];
}

// alias -> canónico
const map = new Map();
for (const c of canon) {
  for (const a of c.aliases ?? []) map.set(a.toLowerCase(), c.name);
  map.set(c.name.toLowerCase(), c.name);
}

// Reagrupar las notas bajo el nombre canónico
const byConcept = new Map();
for (const row of rows) {
  for (const c of row.concepts) {
    const key = map.get(c.name.toLowerCase());
    if (!key) continue;
    if (!byConcept.has(key)) byConcept.set(key, []);
    byConcept.get(key).push({
      note: row.note,
      zone: row.zone,
      topic: row.topic,
      evidence: c.evidence,
    });
  }
}

const clusters = [...byConcept.entries()]
  .map(([name, sources]) => {
    // Una nota puede aportar dos alias del mismo concepto: contar una vez.
    const uniq = [...new Map(sources.map((s) => [s.note, s])).values()];
    return { name, count: uniq.length, sources: uniq };
  })
  .filter((c) => c.count >= MIN)
  .sort((a, b) => b.count - a.count);

await writeFile(OUT, JSON.stringify(clusters, null, 1), "utf-8");

console.log(`\ncanónicos propuestos: ${canon.length}`);
console.log(`clusters con >=${MIN} fuentes: ${clusters.length}`);
console.log(`\n${"fuentes".padStart(8)}  concepto`);
for (const c of clusters.slice(0, 25)) {
  console.log(`${String(c.count).padStart(8)}  ${c.name}`);
}
console.log(`\n-> ${OUT}`);
