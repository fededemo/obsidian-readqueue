#!/usr/bin/env node
/**
 * Escribe las notas-concepto `latente` en la vault (B-741).
 *
 * No llama a la API: consume `latent-concepts.json`, que ya produjo
 * `extract-latent-concepts.mjs`. Es solo leer JSON y escribir markdown.
 *
 * Una latente **no lleva tesis**. No leíste ninguna de sus fuentes, así que
 * afirmar algo sería inventarlo — el gloss que trae el JSON es una *hipótesis*
 * deducida de los resúmenes, y va marcada como tal. Cuando leas dos fuentes el
 * concepto pasa a `conocido` y ahí sí vale escribir la síntesis con el estándar.
 *
 * Idempotente y conservador: **no pisa una nota que ya exista**. Si Fede la
 * editó o la promovió a mano, el script no tiene nada mejor que decir.
 *
 *   node scripts/write-latent-concepts.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { vaultStems } from "./lib/concepts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "../docs/vault-gardener/latent-concepts.json");
const VAULT = join(homedir(), "fedenotes");
const CONCEPTS = "Concepts";
const DRY = process.argv.includes("--dry-run");

const { latent } = JSON.parse(await readFile(DATA, "utf-8"));
const stems = vaultStems(VAULT);

/** Un `/` o `:` en el nombre rompe el path; el título va igual en el H1. */
const fileNameFor = (name) => name.replace(/[/\\:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();

let written = 0,
  skipped = 0,
  broken = 0;

for (const c of latent) {
  // Ver la nota en link-unread-to-concepts: los nombres del JSON pueden traer
  // el espacio final que tenían los archivos antes de sanearlos.
  const sources = [...new Set(c.sources.map((x) => x.trim()))].filter((x) => stems.has(x));
  broken += c.sources.length - sources.length;
  if (sources.length < 2) {
    skipped++;
    continue;
  }

  const path = join(VAULT, CONCEPTS, `${fileNameFor(c.name)}.md`);
  if (existsSync(path)) {
    console.log(`  · ya existe, no se toca: ${c.name}`);
    skipped++;
    continue;
  }

  const body = `---
type: concept
status: latente
sources: ${sources.length}
sourcesRead: 0
updated: 2026-08-01
tags: [concept]
---

# ${c.name}

> **\`latente\`** — ${sources.length} fuentes, **ninguna leída**. Todavía no es conocimiento tuyo: es un tema que venís juntando.

## La hipótesis

${c.gloss}

Ojo: esto **no es una síntesis**. Es lo que estas fuentes *parecen* sostener, deducido
de sus resúmenes, no de haberlas leído. Sirve para decidir si vale la pena entrar,
no para citarlo.

## Todavía no leídas

${sources.map((s) => `- [[${s}]]`).join("\n")}

## Cómo se promueve

Al leer **dos** de estas fuentes el concepto pasa a \`conocido\` y recién ahí vale
escribir la tesis, las fuentes en diálogo y la tensión, con el estándar de
\`docs/vault-gardener/ESTANDAR-NOTAS-CONCEPTO.md\`. El gardener semanal las va
sacando de la lista a medida que las leas.
`;

  if (!DRY) {
    await mkdir(join(VAULT, CONCEPTS), { recursive: true });
    await writeFile(path, body, "utf-8");
  }
  written++;
  console.log(`  ✓ ${c.name} — ${sources.length} fuentes`);
}

console.log(
  `\n${DRY ? "DRY RUN · " : ""}escritas: ${written} · salteadas: ${skipped} · ` +
    `wikilinks descartados por rotos: ${broken}`,
);
