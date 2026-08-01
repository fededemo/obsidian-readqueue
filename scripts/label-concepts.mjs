#!/usr/bin/env node
/**
 * Canon de conceptos, versión top-down (reemplaza a canonicalize-concepts.mjs).
 *
 * El enfoque bottom-up no funcionó: extraer conceptos nota por nota produce un
 * nombre distinto por nota ("agencia de decisiones cotidianas", "perspectiva
 * temporal sobre eventos"), y agrupar 744 nombres divergentes a posteriori
 * devuelve clusters genéricos de 3 fuentes. El modelo renombra en vez de
 * fusionar.
 *
 * Acá se invierte: primero se destila un vocabulario CERRADO de conceptos
 * mirando toda la evidencia junta, después se etiqueta cada nota contra él.
 * Los clusters salen por construcción, no por coincidencia de strings.
 *
 *   node scripts/label-concepts.mjs [--vocab N] [--min 3]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = join(HERE, "../docs/vault-gardener/concept-candidates.json");
const OUT = join(HERE, "../docs/vault-gardener/concept-canon.json");
const VAULT = join(homedir(), "fedenotes");

const args = process.argv.slice(2);
const num = (flag, def) =>
  args.indexOf(`--${flag}`) >= 0 ? Number(args[args.indexOf(`--${flag}`) + 1]) : def;
const VOCAB = num("vocab", 45);
const MIN = num("min", 3);
const CONCURRENCY = 8;

const apiKey = JSON.parse(
  await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8"),
).anthropicApiKey;

async function ask(model, prompt, maxTokens) {
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
      // Sin esto, Sonnet 5 corre adaptive thinking y se come el presupuesto
      // entero pensando: vuelve stop_reason max_tokens y solo un bloque thinking.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j?.content ?? []).find((b) => b?.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`sin JSON (stop=${j?.stop_reason})`);
  return JSON.parse(m[0]);
}

const rows = JSON.parse(await readFile(IN, "utf-8"));

// ---------- Paso 1: destilar el vocabulario ----------
// Se muestrea la evidencia, no los nombres: los nombres ya divergieron, la
// evidencia textual es lo que deja ver qué ideas se repiten de verdad.
const evidence = rows
  .flatMap((r) => r.concepts.map((c) => `[${r.topic ?? "?"}] ${c.name}: ${c.evidence.slice(0, 110)}`))
  .filter((_, i) => i % 2 === 0)
  .slice(0, 380);

console.log(`destilando vocabulario desde ${evidence.length} muestras…`);

const vocabPrompt = `Abajo hay conceptos extraídos de las lecturas de una persona (libros, ensayos, artículos), cada uno con la evidencia que lo sostiene.

Tu tarea NO es renombrarlos uno por uno. Es destilar los **${VOCAB} temas recurrentes** que mejor capturan lo que esta persona lee y piensa.

Reglas:
- Cada concepto debe ser una IDEA que aparezca en VARIAS lecturas distintas, no el resumen de una.
- Nombre en español, 2-6 palabras, específico y con contenido. "Contra-posicionamiento competitivo" sí; "Arquitectura de datos" no (demasiado genérico para agrupar nada).
- Cubrí el espectro: negocios/estrategia, tecnología/IA, macro/finanzas, ciencia, vida personal, cultura.
- Preferí conceptos que un lector reconocería como "sí, eso es un tema mío" antes que categorías de biblioteca.

Evidencia:
${evidence.join("\n")}

Respondé SOLO JSON:
{"vocab":[{"name":"...","gloss":"una línea de qué significa"}]}`;

const { vocab } = await ask("claude-sonnet-5", vocabPrompt, 8000);
console.log(`vocabulario: ${vocab.length} conceptos`);

// ---------- Paso 2: etiquetar cada nota contra el vocabulario cerrado ----------
const vocabList = vocab.map((v) => `- ${v.name}: ${v.gloss}`).join("\n");

const labelPrompt = (row) => `Vocabulario cerrado de conceptos:
${vocabList}

Lectura: "${row.note}" (tema: ${row.topic ?? "?"})
Ideas que se extrajeron de ella:
${row.concepts.map((c) => `- ${c.name}: ${c.evidence.slice(0, 200)}`).join("\n")}

¿Cuáles conceptos del vocabulario aparecen realmente en esta lectura? Máximo 3.
Solo los que estén claramente sostenidos por la evidencia — si ninguno encaja, devolvé lista vacía. No inventes conceptos fuera del vocabulario.

Respondé SOLO JSON: {"concepts":["<nombre exacto del vocabulario>"]}`;

const valid = new Map(vocab.map((v) => [v.name.toLowerCase(), v.name]));
const byConcept = new Map();
let done = 0,
  failed = 0;

const queue = [...rows];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      try {
        const r = await ask("claude-haiku-4-5", labelPrompt(row), 300);
        for (const name of (r.concepts ?? []).slice(0, 3)) {
          const canon = valid.get(String(name).toLowerCase().trim());
          if (!canon) continue;
          if (!byConcept.has(canon)) byConcept.set(canon, []);
          byConcept.get(canon).push({
            note: row.note,
            zone: row.zone,
            topic: row.topic,
            evidence: row.concepts[0]?.evidence ?? "",
          });
        }
        if (++done % 50 === 0) console.log(`  ${done}/${rows.length}…`);
      } catch {
        failed++;
      }
    }
  }),
);

const clusters = [...byConcept.entries()]
  .map(([name, sources]) => ({
    name,
    gloss: vocab.find((v) => v.name === name)?.gloss ?? "",
    count: sources.length,
    sources,
  }))
  .filter((c) => c.count >= MIN)
  .sort((a, b) => b.count - a.count);

await writeFile(OUT, JSON.stringify(clusters, null, 1), "utf-8");

console.log(`\netiquetadas: ${done} · fallidas: ${failed}`);
console.log(`clusters con >=${MIN} fuentes: ${clusters.length}`);
console.log(`\n${"fuentes".padStart(8)}  concepto`);
for (const c of clusters.slice(0, 22)) {
  console.log(`${String(c.count).padStart(8)}  ${c.name}`);
}
console.log(`\n-> ${OUT}`);
