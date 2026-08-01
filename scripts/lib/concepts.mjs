/**
 * Lee el vocabulario de conceptos desde la vault, no desde el canon JSON.
 *
 * El canon (`concept-canon.json`) es el *residuo* de cómo se destiló el
 * vocabulario, no su estado actual: le faltan las 3 notas-concepto que Fede y
 * Claude escribieron a mano, y le sobra una entrada ("Contra-posicionamiento y
 * nichos defendibles") que en B-734 se fusionó con otra. Las notas de
 * `Concepts/` sí son el estado actual.
 *
 * Además el gloss sale de la tesis curada de cada nota, que es mejor input para
 * el clasificador que la definición autogenerada del canon.
 *
 * Espeja a `src/concept-graph.ts`: mismo contrato de secciones, para que lo que
 * etiqueta el script y lo que lee el plugin no puedan divergir.
 */
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export function linksInSection(content, heading) {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const out = [];
  const seen = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? "")) break;
    for (const m of (lines[i] ?? "").matchAll(WIKILINK)) {
      const target = (m[1] ?? "").trim();
      if (target && !seen.has(target)) {
        seen.add(target);
        out.push(target);
      }
    }
  }
  return out;
}

/** Primer párrafo real de "## La idea" — la tesis, sin la línea de estatus. */
function glossFrom(content) {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## La idea");
  if (start < 0) return "";
  const buf = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (/^##\s/.test(line)) break;
    if (!line) {
      if (buf.length > 0) break;
      continue;
    }
    if (line.startsWith(">")) continue;
    buf.push(line);
  }
  return buf
    .join(" ")
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .slice(0, 260);
}

export async function loadConcepts(vault, folder = "Concepts") {
  const dir = join(vault, folder);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(join(dir, entry.name), "utf-8");
    out.push({
      name: entry.name.replace(/\.md$/, ""),
      gloss: glossFrom(content),
      readSources: linksInSection(content, "## Fuentes"),
    });
  }
  return out.sort((a, b) => b.readSources.length - a.readSources.length);
}

/** Basenames reales de la vault: un wikilink a algo inexistente es un link roto. */
export function vaultStems(vault, roots = ["Inbox", "Books", "Concepts"]) {
  const stems = new Set();
  const walk = (rel) => {
    const abs = join(vault, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(join(rel, e.name));
      else if (e.name.endsWith(".md")) stems.add(e.name.replace(/\.md$/, ""));
    }
  };
  for (const r of roots) walk(r);
  return stems;
}
