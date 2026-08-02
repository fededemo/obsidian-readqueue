#!/usr/bin/env node
/**
 * Escribe las conexiones **atraer** en las notas-concepto (B-731, apply).
 *
 * Agrega a cada nota de `Concepts/` una sección `## Todavía no leídas` con las
 * notas de la cola que tocan ese concepto. Con eso:
 *
 *  - Fede abre un concepto y ve de un lado lo que ya leyó y del otro lo que le
 *    falta, que es la pregunta que el primer demo no podía contestar.
 *  - El plugin (`src/concept-graph.ts`) parsea esa sección y el orden
 *    "Vale la pena" pasa de 7 valores de contexto distintos a 33.
 *
 * Solo toca `Concepts/`, que es la capa wiki regenerable (SEGUNDO-CEREBRO §4.2).
 * Las notas de `Inbox/` no se tocan: son la capa cruda.
 *
 * Idempotente: reemplaza la sección si ya existe, no la duplica.
 *
 *   node scripts/link-unread-to-concepts.mjs [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "../docs/vault-gardener/connections.json");
const VAULT = join(homedir(), "fedenotes");
const CONCEPTS = "Concepts";
const HEADING = "## Todavía no leídas";
const DRY = process.argv.includes("--dry-run");

const { conceptos } = JSON.parse(await readFile(DATA, "utf-8"));

/** Basenames reales de la vault: un wikilink a algo inexistente es un link roto. */
const stems = new Set();
const walk = (rel) => {
  const abs = join(VAULT, rel);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) walk(join(rel, e.name));
    else if (e.name.endsWith(".md")) stems.add(e.name.replace(/\.md$/, ""));
  }
};
walk("Inbox");
walk("Books");
walk(CONCEPTS);

/**
 * Inserta la sección después de `## Fuentes` — que existe en las 29 — y antes
 * del heading siguiente. Va ahí y no al final porque el orden narrativo de la
 * nota es idea → fuentes → qué falta; enterrarla abajo la hace invisible.
 */
function upsert(content, section) {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === HEADING);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^##\s/.test(lines[end] ?? "")) end++;
    return [...lines.slice(0, start), ...section.split("\n"), ...lines.slice(end)].join("\n");
  }
  const fuentes = lines.findIndex((l) => l.trim() === "## Fuentes");
  if (fuentes < 0) return null;
  let after = fuentes + 1;
  while (after < lines.length && !/^##\s/.test(lines[after] ?? "")) after++;
  return [...lines.slice(0, after), ...section.split("\n"), ...lines.slice(after)].join("\n");
}

let written = 0,
  skipped = 0,
  broken = 0,
  missing = 0;

for (const c of conceptos) {
  if (c.unread.length === 0) continue;
  const path = join(VAULT, CONCEPTS, `${c.name}.md`);
  if (!existsSync(path)) {
    console.log(`  ✗ sin nota-concepto: ${c.name}`);
    missing++;
    continue;
  }
  // Los nombres del JSON se capturaron antes de sanear los archivos con espacio
  // final: se recortan acá para que matcheen con lo que hay en disco.
  const ok = [...new Set(c.unread.map((n) => n.trim()))].filter((n) => stems.has(n));
  broken += c.unread.length - ok.length;
  if (ok.length === 0) {
    skipped++;
    continue;
  }

  const section = `${HEADING}

${ok.length} ${ok.length === 1 ? "nota de tu cola toca" : "notas de tu cola tocan"} este concepto. Leer cualquiera de estas te conecta con ${
    c.read.length === 1 ? "la lectura" : `las ${c.read.length} lecturas`
  } de arriba.

${ok.map((n) => `- [[${n}]]`).join("\n")}

`;

  const content = await readFile(path, "utf-8");
  const next = upsert(content, section);
  if (next === null) {
    console.log(`  ✗ sin '## Fuentes': ${c.name}`);
    skipped++;
    continue;
  }
  if (next === content) {
    skipped++;
    continue;
  }
  if (!DRY) await writeFile(path, next, "utf-8");
  written++;
  console.log(`  ✓ ${c.name} — ${ok.length} pendientes / ${c.read.length} leídas`);
}

console.log(
  `\n${DRY ? "DRY RUN · " : ""}notas actualizadas: ${written} · sin cambios: ${skipped} · ` +
    `sin nota-concepto: ${missing} · wikilinks descartados por rotos: ${broken}`,
);
