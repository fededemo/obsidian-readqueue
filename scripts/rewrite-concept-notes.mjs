#!/usr/bin/env node
/**
 * Reescribe las notas-concepto según docs/vault-gardener/ESTANDAR-NOTAS-CONCEPTO.md.
 *
 * El primer generador producía glosa + lista de citas: correcto y frío. Este
 * pide tesis, fuentes en diálogo y tensión — y, sobre todo, **filtrado**: el
 * clustering agrupa por proximidad léxica, así que arrastra fuentes que
 * comparten vocabulario pero no la idea. Descartarlas es parte del trabajo,
 * no una pérdida.
 *
 * Usa Sonnet: escribir una tesis con su contra-tesis es juicio, no formato.
 *
 *   node scripts/rewrite-concept-notes.mjs [--only "nombre"] [--limit N]
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANON = join(HERE, "../docs/vault-gardener/concept-canon.json");
const VAULT = join(homedir(), "fedenotes");
const DEST = join(VAULT, "Concepts");
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const only = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1] : null;
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;

const canon = JSON.parse(await readFile(CANON, "utf-8"));

// Stems reales: un wikilink a un archivo inexistente es ruido en el grafo.
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

/** Ya escritas a mano con el estándar: no se tocan. */
const HAND_WRITTEN = new Set([
  "Poder de mercado y contra-posicionamiento",
  "Asignación de un recurso finito",
  "Inventar la técnica, no aplicarla",
  "Herramientas sin agencia propia",
]);

const conceptNames = canon.map((c) => c.name).filter((n) => !HAND_WRITTEN.has(n));

const prompt = (c) => `Escribí una nota-concepto para el segundo cerebro de alguien, en español rioplatense.

CONCEPTO: ${c.name}
Idea de partida: ${c.gloss}

FUENTES CANDIDATAS (todas leídas por esta persona), con la evidencia extraída:
${c.sources
  .filter((s) => stems.has(s.note))
  .slice(0, 22)
  .map((s) => `- [[${s.note}]] (${s.zone}) :: ${s.evidence.slice(0, 260)}`)
  .join("\n")}

OTROS CONCEPTOS del cerebro (para "Ver también", usá solo si hay relación real):
${conceptNames.filter((n) => n !== c.name).slice(0, 26).join(" · ")}

=== EL ESTÁNDAR ===

Una nota-concepto tiene que AFIRMAR algo que se pueda discutir. Si nadie puede estar en desacuerdo, es una etiqueta, no un concepto.

1. **## La idea** — Abrí AFIRMANDO, en indicativo, 2-3 oraciones. Nada de "este concepto agrupa" ni "reflexiones sobre". El mejor movimiento es dar vuelta lo obvio hacia algo que sorprenda. Anclá enseguida en UNA cita textual de la fuente que mejor lo formule (con > blockquote).

2. **Las fuentes en DIÁLOGO, no en lista.** Cada una entra diciendo desde dónde habla y qué agrega que las otras no: "X lo dice desde el oficio… Y lo dice desde la estrategia… Z muestra el costo de olvidarlo". Una lista de citas bajo un título común es un cajón ordenado, no una idea.

3. **## La tensión que vale la pena** — Buscá ACTIVAMENTE las fuentes que complican la tesis y dales el lugar de honor. Un concepto donde todas asienten no enseña nada. Si de verdad no hay tensión, decilo, no la inventes. Cerrá con una **pregunta abierta** que quede viva.

4. **## Fuentes** — agrupadas por rol: "**Sostienen la tesis**", "**La complican**", "**Ver también**" (a otro concepto, con una línea de por qué).

FILTRAR ES PARTE DEL TRABAJO. Mejor 8 fuentes que sostienen la idea que 22 que comparten vocabulario. El clustering agrupa por proximidad léxica y arrastra ruido. Descartá sin culpa y anotá al pie, en cursiva: "*El cluster automático traía N fuentes; se descartaron M que compartían vocabulario pero no la idea (ejemplos).*"

REGLAS DURAS:
- Citas TEXTUALES de la evidencia dada, nunca inventadas ni parafraseadas.
- Wikilinks EXACTOS como aparecen arriba entre [[ ]]. No inventes ni edites nombres.
- Sin relleno: nada de "en conclusión", "es importante notar", "cabe destacar".
- Se lee en menos de 2 minutos.

Devolvé SOLO el markdown del cuerpo, empezando por "# ${c.name}". Sin frontmatter (se agrega aparte). Sin bloque de código envolvente.`;

async function write(c) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt(c) }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  let body = (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  body = body.replace(/^```(?:markdown)?\n/, "").replace(/\n```\s*$/, "").trim();
  if (!body.startsWith("#")) throw new Error("no empieza con encabezado");

  // Un link inventado es peor que uno de menos: se eliminan antes de escribir.
  const bad = [...body.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((m) => m[1])
    .filter((l) => !stems.has(l));
  for (const b of bad) body = body.replaceAll(`[[${b}]]`, b);

  const topic = (() => {
    const counts = new Map();
    for (const s of c.sources) {
      if (!s.topic || s.topic === "otros") continue;
      counts.set(s.topic, (counts.get(s.topic) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  })();
  const kept = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].length;

  const fm = [
    "---",
    "type: concept",
    "status: conocido",
    `sources: ${kept}`,
    `sourcesRead: ${kept}`,
    ...(topic ? [`topic: ${topic}`] : []),
    "updated: 2026-08-01",
    "tags: [concept]",
    "---",
    "",
  ].join("\n");

  await writeFile(join(DEST, `${c.name.replace(/[/\\:*?"<>|]/g, "-")}.md`), fm + body, "utf-8");
  return { bad: bad.length, links: kept };
}

const todo = canon
  .filter((c) => !HAND_WRITTEN.has(c.name))
  .filter((c) => !only || c.name.toLowerCase().includes(only.toLowerCase()))
  .slice(0, LIMIT);

console.log(`reescribiendo ${todo.length} notas (${HAND_WRITTEN.size} a mano, intactas)…`);

let ok = 0,
  failed = 0,
  badLinks = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const c = queue.shift();
      try {
        const r = await write(c);
        badLinks += r.bad;
        console.log(`  ✓ ${c.name} (${r.links} links${r.bad ? `, ${r.bad} inventados removidos` : ""})`);
        ok++;
      } catch (e) {
        console.error(`  ✗ ${c.name}: ${e.message}`);
        failed++;
      }
    }
  }),
);

console.log(`\nreescritas: ${ok} · fallidas: ${failed} · wikilinks inventados removidos: ${badLinks}`);
