#!/usr/bin/env node
/**
 * Materializa el canon como notas-concepto en la vault (`Concepts/`).
 *
 * El canon vive en el repo como JSON — útil para analizar, invisible en
 * Obsidian. Estas notas son los nodos del grafo: lo que hace que 213 fuentes
 * dejen de ser archivos sueltos y queden conectadas por idea.
 *
 * NO pisa notas escritas a mano: las tres primeras (`Poder de mercado…`,
 * `Asignación de un recurso finito`, `Inventar la técnica…`) tienen síntesis
 * redactada con citas de highlights, que es mejor que lo que genera un script.
 *
 *   node scripts/write-concept-notes.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANON = join(HERE, "../docs/vault-gardener/concept-canon.json");
const VAULT = join(homedir(), "fedenotes");
const DEST = join(VAULT, "Concepts");
const DRY = process.argv.includes("--dry-run");

const canon = JSON.parse(await readFile(CANON, "utf-8"));

// Los stems reales de la vault: un wikilink a un nombre que no existe es ruido
// en el grafo, así que se verifica antes de escribirlo.
const stems = new Set();
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith(".md")) stems.add(e.name.replace(/\.md$/, ""));
  }
}
await walk(VAULT);

const ZONE_LABEL = { kindle: "Kindle", read: "Leído", legacy: "Matter" };

/**
 * Conceptos del canon ya cubiertos por una nota escrita a mano. Las manuales
 * llevan síntesis redactada con citas de highlights; duplicarlas con una
 * versión generada partiría el grafo en dos nodos para la misma idea.
 */
const SUPERSEDED = new Map([
  ["Contra-posicionamiento y nichos defendibles", "Poder de mercado y contra-posicionamiento"],
]);

/** Conceptos vecinos que conviene enlazar aunque no sean el mismo. */
const SEE_ALSO = new Map([
  ["Aprendizaje amplio antes que especialización temprana", "Inventar la técnica, no aplicarla"],
]);
const slug = (s) => s.replace(/[/\\:*?"<>|]/g, "-").trim();

/** Un topic representativo: el más frecuente entre las fuentes. */
function mainTopic(sources) {
  const counts = new Map();
  for (const s of sources) {
    if (!s.topic || s.topic === "otros") continue;
    counts.set(s.topic, (counts.get(s.topic) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function render(c) {
  const topic = mainTopic(c.sources);
  const linked = c.sources.filter((s) => stems.has(s.note));
  const byZone = { kindle: [], read: [], legacy: [] };
  for (const s of linked) (byZone[s.zone] ?? byZone.legacy).push(s);

  const fm = [
    "---",
    "type: concept",
    "status: conocido",
    `sources: ${linked.length}`,
    `sourcesRead: ${linked.length}`,
    ...(topic ? [`topic: ${topic}`] : []),
    "updated: 2026-08-01",
    "tags: [concept]",
    "---",
    "",
    `# ${c.name}`,
    "",
    `> **\`conocido\`** — ${linked.length} fuentes, todas leídas. Extraído del canon sobre las 238 notas de lectura.`,
    "",
    "## La idea",
    "",
    c.gloss || "_(sin glosa)_",
    "",
  ];

  // La evidencia es lo que hace verificable el concepto: sin ella es una
  // etiqueta, con ella es una afirmación que se puede auditar contra la fuente.
  const withEvidence = linked.filter((s) => s.evidence && s.evidence.length > 40).slice(0, 6);
  if (withEvidence.length > 0) {
    fm.push("## Evidencia", "");
    for (const s of withEvidence) {
      fm.push(`- **[[${s.note}]]** — ${s.evidence.slice(0, 240)}`);
    }
    fm.push("");
  }

  const seeAlso = SEE_ALSO.get(c.name);
  if (seeAlso && stems.has(seeAlso)) {
    fm.push("## Ver también", "", `- [[${seeAlso}]]`, "");
  }

  fm.push("## Fuentes", "");
  for (const [zone, list] of Object.entries(byZone)) {
    if (list.length === 0) continue;
    fm.push(`**${ZONE_LABEL[zone]}** (${list.length})`, "");
    for (const s of list) fm.push(`- [[${s.note}]]`);
    fm.push("");
  }
  return fm.join("\n");
}

await mkdir(DEST, { recursive: true });

let written = 0,
  skipped = 0,
  links = 0,
  dropped = 0;

for (const c of canon) {
  const superseded = SUPERSEDED.get(c.name);
  if (superseded) {
    console.log(`  omitido "${c.name}" -> ya cubierto por "${superseded}"`);
    skipped++;
    continue;
  }
  const path = join(DEST, `${slug(c.name)}.md`);
  if (existsSync(path)) {
    skipped++;
    continue;
  }
  const body = render(c);
  links += (body.match(/\[\[/g) ?? []).length;
  dropped += c.sources.filter((s) => !stems.has(s.note)).length;
  if (!DRY) await writeFile(path, body, "utf-8");
  written++;
}

console.log(
  `${DRY ? "DRY RUN · " : ""}escritas: ${written} · ya existían (no pisadas): ${skipped}`,
);
console.log(`wikilinks generados: ${links} · fuentes sin archivo (omitidas): ${dropped}`);
