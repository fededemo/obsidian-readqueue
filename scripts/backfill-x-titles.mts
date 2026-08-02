#!/usr/bin/env tsx
/**
 * Pone un `title` legible en las notas de X que ya están en la vault (B-743).
 *
 * El nombre del archivo son los primeros 70 caracteres saneados, que en un post
 * largo corta a mitad de palabra: *"how I'm building an agent company inside my
 * agency. the structure look"*. La primera línea del tweet suele ser el titular
 * de verdad, y recién ahora sirve — antes venía truncada por la API (B-742).
 *
 * **Escribe `title` en el frontmatter, no renombra el archivo.** Renombrar una
 * nota de `Inbox/Web` dispara el watcher de dedupe del plugin, que la manda a la
 * papelera; ya destruyó 13 notas una vez. `articleFromFile` prefiere `title`
 * sobre el basename, así que el efecto visible es el mismo sin el riesgo.
 *
 * No llama a la API. Idempotente: no pisa un `title` que ya exista.
 *
 *   npx tsx scripts/backfill-x-titles.mts [--dry-run]
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { displayTitle, type XItem } from "../src/x-sync";

const VAULT = join(homedir(), "fedenotes");
const FOLDERS = ["Inbox/Web", "Inbox/Legacy/X"];
const DRY = process.argv.includes("--dry-run");

const collect = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (r: string): void => {
    const abs = join(VAULT, r);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(join(r, e.name));
      else if (e.name.endsWith(".md")) out.push(join(r, e.name));
    }
  };
  walk(rel);
  return out;
};

/** El texto del tweet: el primer bloque `>` del cuerpo. */
function readQuote(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  const buf: string[] = [];
  while (i < lines.length && /^>/.test(lines[i] ?? "")) {
    buf.push((lines[i] ?? "").replace(/^>[ \t]?/, ""));
    i++;
  }
  return buf.join("\n").trim();
}

const field = (fm: string, name: string): string | undefined =>
  /^\s*$/.test(fm) ? undefined : new RegExp(`^${name}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim();

let written = 0,
  already = 0,
  sinCambio = 0;
const ejemplos: string[] = [];

for (const folder of FOLDERS) {
  for (const path of collect(folder)) {
    const content = await readFile(join(VAULT, path), "utf-8");
    if (!/^source:\s*"?x-(bookmark|like)"?\s*$/m.test(content)) continue;
    const end = content.indexOf("\n---", 3);
    if (end < 0) continue;
    const fm = content.slice(4, end);
    if (field(fm, "title")) {
      already++;
      continue;
    }
    const body = content.slice(end + 4);
    const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");

    // Se arma un XItem mínimo: `displayTitle` solo mira texto, urls, media y handle.
    const item: XItem = {
      id: "",
      text: readQuote(body),
      createdAt: "",
      authorHandle: (field(fm, "author") ?? "").replace(/^"?@/, "").replace(/"$/, ""),
      urls: field(fm, "targetUrl") ? [field(fm, "targetUrl") as string] : [],
      mediaTypes: field(fm, "kind") === "watch" ? ["video"] : [],
      collection: /x-like/.test(content) ? "likes" : "bookmarks",
    };
    const title = displayTitle(item);
    if (title === basename) {
      sinCambio++;
      continue;
    }

    if (!DRY) {
      await writeFile(
        join(VAULT, path),
        `---\n${fm}\ntitle: ${JSON.stringify(title)}\n---${body}`,
        "utf-8",
      );
    }
    written++;
    if (ejemplos.length < 6) ejemplos.push(`${basename.slice(0, 45)}…  →  ${title.slice(0, 60)}`);
  }
}

for (const e of ejemplos) console.log(`  ${e}`);
console.log(
  `\n${DRY ? "DRY RUN · " : ""}con título nuevo: ${written} · ya tenían: ${already} · ` +
    `el nombre ya servía: ${sinCambio}`,
);
