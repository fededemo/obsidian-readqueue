#!/usr/bin/env tsx
/**
 * Reclasifica las notas de X cuyo texto se recuperó completo (B-742, 2do orden).
 *
 * El bug del truncado tuvo una consecuencia que no se ve: el `topic` y el `tldr`
 * de esas notas se calcularon leyendo el texto cortado. En los casos peores, el
 * "por qué te importaría leer esto" se escribió viendo el 9% del post — y ese
 * mismo `tldr` fue después el input para asignarle concepto, que es lo que
 * alimenta el orden "Vale la pena". El error se propagó hacia arriba.
 *
 * Solo toca las notas con cuerpo largo: si el tweet siempre fue corto, la
 * clasificación vieja se hizo con el texto completo y no hay nada que arreglar.
 *
 *   npx tsx scripts/reclassify-x.mts [--folder Inbox/Web] [--min 400]
 *                                    [--topic-only] [--dry-run] [--limit N]
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const VAULT = join(homedir(), "fedenotes");
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 6;

const TOPICS: Record<string, string> = {
  tech: "software, IA/ML, LLMs, programación, infraestructura, herramientas de desarrollo, hardware",
  producto: "diseño de producto, startups, growth, negocio, estrategia, marketing, ventas, management",
  macro: "economía, mercados, finanzas, geopolítica, política, energía, industria",
  ciencia: "biología, medicina, física, salud, longevidad, clima, investigación",
  personal: "hábitos, productividad, aprendizaje, carrera, relaciones, dinero personal",
  cultura: "arte, historia, filosofía, deporte, cine, música, sociedad, humor",
  otros: "no encaja en ninguno de los anteriores",
};
const SHELF = ["evergreen", "seasonal", "perishable"];

const args = process.argv.slice(2);
const flag = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const DRY = args.includes("--dry-run");
const TOPIC_ONLY = args.includes("--topic-only");
const FOLDER = flag("folder", "Inbox/Web");
const MIN = Number(flag("min", "400"));
const LIMIT = Number(flag("limit", "Infinity"));

const apiKey = (
  JSON.parse(await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8")) as {
    anthropicApiKey?: string;
  }
).anthropicApiKey;
if (!apiKey) throw new Error("anthropicApiKey vacía en data.json");

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

interface Target {
  path: string;
  quote: string;
  title: string;
}

const targets: Target[] = [];
for (const path of collect(FOLDER)) {
  const content = await readFile(join(VAULT, path), "utf-8");
  if (!/^source:\s*"?x-(bookmark|like)"?\s*$/m.test(content)) continue;
  const end = content.indexOf("\n---", 3);
  if (end < 0) continue;
  const quote = readQuote(content.slice(end + 4));
  if (quote.length < MIN) continue;
  targets.push({
    path,
    quote,
    title: /^title:\s*"?([^"\n]+)"?/m.exec(content)?.[1] ?? path.replace(/^.*\//, ""),
  });
}

console.log(
  `${FOLDER}: ${targets.length} notas con cuerpo >= ${MIN} chars` +
    (TOPIC_ONLY ? " · solo topic" : "") +
    (DRY ? " · DRY RUN" : ""),
);
if (DRY || targets.length === 0) process.exit(0);

const vocab = Object.entries(TOPICS)
  .map(([k, v]) => `  ${k} — ${v}`)
  .join("\n");
const TOPIC_KEYS = Object.keys(TOPICS);

/**
 * Rescata el tema cuando el modelo devuelve la **descripción** en vez del nombre.
 *
 * Pasó de verdad: con el vocabulario escrito como `- tech: software, IA/ML,
 * programación…` el modelo contestaba `"programación"` o `"herramientas de
 * desarrollo"`, que son pedazos de la glosa. El prompt ya está arreglado; esto
 * es la red por si vuelve a pasar.
 */
function resolveTopic(raw: string): string | undefined {
  const v = raw.toLowerCase().trim();
  if (TOPICS[v]) return v;
  const hit = TOPIC_KEYS.find((k) => (TOPICS[k] ?? "").toLowerCase().includes(v) && v.length >= 4);
  return hit;
}

/**
 * Un intento. Devuelve los campos, o tira con el motivo — el caller reintenta.
 *
 * Los fallos son transitorios (fallan notas distintas en cada corrida), así que
 * el reintento es la respuesta correcta y no un parche sobre un bug de prompt.
 */
async function classifyOnce(t: Target): Promise<Record<string, string>> {
  const prompt = `Post de X, texto completo:

${t.quote.slice(0, 3000)}

Devolvé:
- topic: **exactamente una de estas siete palabras**, tal cual, sin traducir ni
  reemplazar por su descripción: ${TOPIC_KEYS.join(" | ")}
  (qué cubre cada una:
${vocab})
${
    TOPIC_ONLY
      ? ""
      : `- shelfLife: qué tan rápido envejece — evergreen (principios, ensayos: sigue valiendo en 5 años) · seasonal (análisis de una situación en curso, pierde filo en 6-12 meses) · perishable (noticias, lanzamientos, polémicas)
- tldr: UNA oración en español, máximo 25 palabras, que responda "¿por qué valdría MI tiempo leer esto?". El payoff concreto, no un resumen. Sin preámbulo.`
  }

Respondé SOLO ese objeto JSON, en una línea, con **exactamente esas claves y
ninguna más**: nada de "reasoning", "confidence" ni explicaciones.

{"topic":"<uno>"${TOPIC_ONLY ? "" : ',"shelfLife":"<uno>","tldr":"<una oración>"'}}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [
        { role: "user", content: prompt },
        // Prefill: arrancarle la respuesta con `{` le saca la opción de escribir
        // un preámbulo antes del JSON.
        { role: "assistant", content: "{" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = `{${(j.content ?? []).find((b) => b.type === "text")?.text ?? ""}`;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`sin JSON (stop_reason: ${j.stop_reason ?? "?"})`);
  const p = JSON.parse(m[0]) as Record<string, string>;
  const topic = resolveTopic(String(p["topic"] ?? ""));
  if (!topic) throw new Error(`topic fuera del vocabulario: ${p["topic"] ?? "(vacío)"}`);
  const out: Record<string, string> = { topic };
  if (!TOPIC_ONLY) {
    const shelf = String(p["shelfLife"] ?? "").toLowerCase().trim();
    if (SHELF.includes(shelf)) out["shelfLife"] = shelf;
    const tldr = String(p["tldr"] ?? "").trim();
    if (tldr) out["tldr"] = tldr.length > 200 ? `${tldr.slice(0, 197)}…` : tldr;
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function classify(t: Target): Promise<Record<string, string>> {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await classifyOnce(t);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error(last);
}

let done = 0,
  failed = 0,
  cambios = 0;
const fallos: string[] = [];
const ejemplos: string[] = [];

const queue = targets.slice(0, Number.isFinite(LIMIT) ? LIMIT : targets.length);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      let fields: Record<string, string> | undefined;
      let error = "";
      try {
        fields = await classify(t);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        fields = undefined;
      }
      if (!fields) {
        failed++;
        if (fallos.length < 5) fallos.push(`${error} · ${t.title.slice(0, 45)}`);
        continue;
      }
      const content = await readFile(join(VAULT, t.path), "utf-8");
      const end = content.indexOf("\n---", 3);
      let fm = content.slice(4, end);
      const antesTopic = /^topic:\s*(.*)$/m.exec(fm)?.[1]?.trim();
      for (const [k, v] of Object.entries(fields)) {
        const value = k === "tldr" ? JSON.stringify(v) : v;
        fm = new RegExp(`^${k}:`, "m").test(fm)
          ? fm.replace(new RegExp(`^${k}:.*$`, "m"), `${k}: ${value}`)
          : `${fm}\n${k}: ${value}`;
      }
      await writeFile(join(VAULT, t.path), `---\n${fm}\n---${content.slice(end + 4)}`, "utf-8");
      done++;
      if (fields["topic"] !== antesTopic) {
        cambios++;
        if (ejemplos.length < 8) {
          ejemplos.push(`${antesTopic ?? "—"} → ${fields["topic"]}  ${t.title.slice(0, 55)}`);
        }
      }
    }
  }),
);

for (const e of ejemplos) console.log(`  ${e}`);
for (const f of fallos) console.log(`  ✗ ${f}`);
console.log(`\nreclasificadas: ${done} · cambió el topic en ${cambios} · fallaron: ${failed}`);
