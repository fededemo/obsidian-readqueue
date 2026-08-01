#!/usr/bin/env node
/**
 * Pase incremental: etiqueta las notas que quedaron fuera del canon.
 *
 * Complementa a label-concepts.mjs, que re-destila el vocabulario y re-etiqueta
 * las 238 en cada corrida. Acá el vocabulario es el canon YA filtrado — que es
 * mejor que el original de 45, porque los conceptos-paraguas ("Reorganización
 * estructural post-tecnología", que juntó 46 notas incluyendo un libro sobre
 * respiración) ya se descartaron.
 *
 * Idempotente: solo toca las notas ausentes del canon, así que se puede
 * re-correr sin gastar de nuevo en las que ya encajaron.
 *
 *   node scripts/relabel-missing.mjs [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = join(HERE, "../docs/vault-gardener/concept-candidates.json");
const CANON = join(HERE, "../docs/vault-gardener/concept-canon.json");
const VAULT = join(homedir(), "fedenotes");
const CONCURRENCY = 8;
const DRY = process.argv.includes("--dry-run");

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;

const rows = JSON.parse(await readFile(CANDIDATES, "utf-8"));
const canon = JSON.parse(await readFile(CANON, "utf-8"));

const covered = new Set(canon.flatMap((c) => c.sources.map((s) => s.note)));
const missing = rows.filter((r) => !covered.has(r.note));

console.log(
  `canon: ${canon.length} conceptos · cubiertas ${covered.size}/${rows.length} · ` +
    `a reintentar: ${missing.length}` + (DRY ? " · DRY RUN" : ""),
);
if (DRY || missing.length === 0) process.exit(0);

const vocabList = canon.map((c) => `- ${c.name}: ${c.gloss}`).join("\n");
const valid = new Map(canon.map((c) => [c.name.toLowerCase(), c.name]));

const prompt = (row) => `Vocabulario cerrado de conceptos:
${vocabList}

Lectura: "${row.note}" (tema: ${row.topic ?? "?"})
Ideas que se extrajeron de ella:
${row.concepts.map((c) => `- ${c.name}: ${c.evidence.slice(0, 200)}`).join("\n")}

¿Cuáles conceptos del vocabulario aparecen realmente en esta lectura? Máximo 2.
Solo los que estén claramente sostenidos por la evidencia. Si ninguno encaja de
verdad, devolvé lista vacía — es una respuesta válida y preferible a forzar un
encaje débil. No inventes conceptos fuera del vocabulario.

Respondé SOLO JSON: {"concepts":["<nombre exacto del vocabulario>"]}`;

async function ask(row) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt(row) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  const text = (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]).concepts ?? []) : [];
}

const byName = new Map(canon.map((c) => [c.name, c]));
let added = 0,
  empty = 0,
  failed = 0;

const queue = [...missing];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const names = await ask(row);
        let hit = false;
        for (const raw of names.slice(0, 2)) {
          const name = valid.get(String(raw).toLowerCase().trim());
          if (!name) continue;
          byName.get(name).sources.push({
            note: row.note,
            zone: row.zone,
            topic: row.topic,
            evidence: row.concepts[0]?.evidence ?? "",
          });
          hit = true;
        }
        if (hit) added++;
        else empty++;
      } catch {
        failed++;
      }
    }
  }),
);

for (const c of byName.values()) c.count = c.sources.length;
const out = [...byName.values()].sort((a, b) => b.count - a.count);
await writeFile(CANON, JSON.stringify(out, null, 1), "utf-8");

const nowCovered = new Set(out.flatMap((c) => c.sources.map((s) => s.note)));
console.log(`\nencajaron: ${added} · sin encaje real: ${empty} · fallaron: ${failed}`);
console.log(
  `cobertura: ${covered.size} -> ${nowCovered.size}/${rows.length} ` +
    `(${Math.round((100 * nowCovered.size) / rows.length)}%)`,
);
console.log(`\n${"fuentes".padStart(8)}  concepto`);
for (const c of out.slice(0, 12)) {
  console.log(`${String(c.count).padStart(8)}  ${c.name}`);
}
