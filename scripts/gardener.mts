#!/usr/bin/env tsx
/**
 * Gardener — mantenimiento incremental del grafo de conceptos (B-712 / B-737).
 *
 * Todo lo que construimos hasta acá funciona pero **lo dispara alguien a mano**.
 * Este es el paso que lo vuelve un sistema: corre semanal, mira qué cambió desde
 * la última vez, y toca solo eso.
 *
 * Hace dos cosas, que son las dos mitades del ciclo de lectura:
 *
 *   atraer   una nota nueva en la cola entra a los conceptos que le corresponden,
 *            para que el priorizador sepa cuánto contexto previo tenés
 *   promover una nota que leíste sale de "Todavía no leídas" del concepto, y el
 *            concepto queda marcado como listo para reescribir con esa fuente
 *
 * **Solo escribe en `Concepts/` y `Diario/`.** `Inbox/` y `Books/` son la capa
 * cruda de Fede y no se tocan (SEGUNDO-CEREBRO §4.2).
 *
 * Detecta cambios contra un manifiesto propio, no contra `git diff`: el diff
 * depende de que alguien commitee la vault, y si Fede no commitea durante un mes
 * el gardener no vería nada mientras el manifiesto sí. git sigue siendo la red de
 * undo — el gardener commitea lo suyo al terminar.
 *
 *   npx tsx scripts/gardener.ts [--dry-run] [--no-commit]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  advisories,
  auditConceptNote,
  dropFromUnread,
  linksInSection,
  passesStandard,
  UNREAD_HEADING,
  upsertSection,
} from "../src/concept-note";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "../docs/vault-gardener/gardener-state.json");
const VAULT = join(homedir(), "fedenotes");
const CONCEPTS = "Concepts";
const QUEUE = "Inbox/Web";
const READ_FOLDERS = ["Inbox/Read", "Inbox/Kindle", "Inbox/Legacy/Matter"];
const LOG = "Diario/gardener.md";
const MODEL = "claude-haiku-4-5";
const CONCURRENCY = 6;
/** Un pase incremental que quiere tocar cientos de notas no es incremental. */
const MAX_NEW_PER_RUN = 120;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NO_COMMIT = args.includes("--no-commit");

const git = (...a: string[]): string =>
  execFileSync("git", ["-C", VAULT, ...a], { encoding: "utf-8" }).trim();

interface State {
  lastRun?: string;
  /** path de la nota → estado de lectura la última vez que corrimos. */
  notes: Record<string, "unread" | "read">;
}

interface NoteInfo {
  path: string;
  title: string;
  status: "unread" | "read";
  topic?: string | undefined;
  tldr?: string | undefined;
}

const field = (text: string, name: string): string | undefined => {
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
};

async function collectNotes(): Promise<NoteInfo[]> {
  const out: NoteInfo[] = [];
  const walk = async (rel: string, fallback: "unread" | "read"): Promise<void> => {
    const abs = join(VAULT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        await walk(join(rel, e.name), fallback);
        continue;
      }
      if (!e.name.endsWith(".md")) continue;
      const path = join(rel, e.name);
      const text = await readFile(join(VAULT, path), "utf-8");
      out.push({
        path,
        title: e.name.replace(/\.md$/, ""),
        status: field(text, "status") === "read" ? "read" : fallback,
        topic: field(text, "topic"),
        tldr: field(text, "tldr"),
      });
    }
  };
  await walk(QUEUE, "unread");
  // La carpeta ya implica lectura: Kindle y Matter no llevan `status` propio.
  for (const f of READ_FOLDERS) await walk(f, "read");
  return out;
}

interface Concept {
  name: string;
  path: string;
  content: string;
  gloss: string;
  read: string[];
  unread: string[];
}

function glossFrom(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## La idea");
  if (start < 0) return "";
  const buf: string[] = [];
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
  return buf.join(" ").replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, "$1").replace(/\*\*/g, "").slice(0, 260);
}

async function loadConcepts(): Promise<Concept[]> {
  const dir = join(VAULT, CONCEPTS);
  if (!existsSync(dir)) return [];
  const out: Concept[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const path = join(CONCEPTS, e.name);
    const content = await readFile(join(VAULT, path), "utf-8");
    out.push({
      name: e.name.replace(/\.md$/, ""),
      path,
      content,
      gloss: glossFrom(content),
      read: linksInSection(content, "## Fuentes"),
      unread: linksInSection(content, UNREAD_HEADING),
    });
  }
  return out.sort((a, b) => b.read.length - a.read.length);
}

// --- clasificación ----------------------------------------------------------

async function apiKey(): Promise<string> {
  const raw = await readFile(join(VAULT, ".obsidian/plugins/readqueue/data.json"), "utf-8");
  const key = (JSON.parse(raw) as { anthropicApiKey?: string }).anthropicApiKey;
  if (!key) throw new Error("anthropicApiKey vacía en data.json");
  return key;
}

async function labelAgainst(
  key: string,
  vocab: string,
  valid: Map<string, string>,
  note: NoteInfo,
): Promise<string[]> {
  const prompt = `Vocabulario cerrado de conceptos:
${vocab}

Lectura pendiente: "${note.title}" (tema: ${note.topic ?? "?"})
De qué trata: ${note.tldr ?? ""}

¿Cuáles conceptos del vocabulario aparecen realmente en esta lectura? Máximo 2.
Si ninguno encaja de verdad, devolvé lista vacía — es preferible a forzar.

Respondé SOLO JSON: {"concepts":["<nombre exacto>"]}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 250, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (j.content ?? []).find((b) => b.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  const names = m ? ((JSON.parse(m[0]) as { concepts?: unknown[] }).concepts ?? []) : [];
  return names
    .slice(0, 2)
    .map((raw) => valid.get(String(raw).toLowerCase().trim()))
    .filter((x): x is string => Boolean(x));
}

// --- main -------------------------------------------------------------------

const state: State = existsSync(STATE)
  ? (JSON.parse(await readFile(STATE, "utf-8")) as State)
  : { notes: {} };
const firstRun = Object.keys(state.notes).length === 0;

/**
 * Guarda: si alguien está editando `Concepts/` o `Diario/` a mano, no corremos.
 * No exigimos el árbol entero limpio porque Fede edita sus notas todo el tiempo
 * y eso bloquearía el gardener para siempre — solo importan las carpetas que
 * este proceso escribe.
 */
let dirty: string[] = [];
try {
  dirty = git("status", "--porcelain", "--", CONCEPTS, "Diario")
    .split("\n")
    .filter(Boolean);
} catch {
  console.error("gardener: la vault no es un repo git — abortando (sin red de undo)");
  process.exit(1);
}
if (dirty.length > 0 && !DRY) {
  console.error(`gardener: hay ${dirty.length} cambios sin commitear en Concepts/ o Diario/. Abortando.`);
  for (const d of dirty.slice(0, 5)) console.error(`  ${d}`);
  process.exit(1);
}

const notes = await collectNotes();
const concepts = await loadConcepts();
if (concepts.length === 0) {
  console.error("gardener: no hay notas-concepto todavía — nada que mantener");
  process.exit(0);
}

const byTitle = new Map(notes.map((n) => [n.title, n]));
const conceptByName = new Map(concepts.map((c) => [c.name, c]));

// 1. Promover: lo que estaba pendiente en un concepto y ahora está leído.
const promoted: Array<{ concept: string; note: string }> = [];
for (const c of concepts) {
  for (const pending of c.unread) {
    if (byTitle.get(pending)?.status === "read") promoted.push({ concept: c.name, note: pending });
  }
}

// 2. Atraer: notas de la cola que el manifiesto no vio nunca.
const known = new Set(Object.keys(state.notes));
const fresh = notes.filter((n) => n.status === "unread" && !known.has(n.path));
const alreadyLinked = new Set(concepts.flatMap((c) => c.unread));
const toLabel = fresh.filter((n) => !alreadyLinked.has(n.title)).slice(0, MAX_NEW_PER_RUN);

console.log(
  `gardener${firstRun ? " (primer run)" : ""}: ${notes.length} notas · ${concepts.length} conceptos\n` +
    `  a promover: ${promoted.length} · nuevas a clasificar: ${toLabel.length}` +
    (fresh.length > toLabel.length ? ` (de ${fresh.length}, tope ${MAX_NEW_PER_RUN})` : "") +
    (DRY ? " · DRY RUN" : ""),
);

const attracted = new Map<string, string[]>();
if (toLabel.length > 0 && !DRY) {
  const key = await apiKey();
  const vocab = concepts.map((c) => `- ${c.name}: ${c.gloss}`).join("\n");
  const valid = new Map(concepts.map((c) => [c.name.toLowerCase(), c.name]));
  const queue = [...toLabel];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const note = queue.shift();
        if (!note) break;
        try {
          for (const name of await labelAgainst(key, vocab, valid, note)) {
            const list = attracted.get(name);
            if (list) list.push(note.title);
            else attracted.set(name, [note.title]);
          }
        } catch {
          // Una nota que falla se reintenta el próximo run: no entra al manifiesto.
        }
      }
    }),
  );
}

// 3. Aplicar los cambios a las notas-concepto.
const touched: string[] = [];
if (!DRY) {
  for (const c of concepts) {
    let content = c.content;
    for (const p of promoted.filter((x) => x.concept === c.name)) {
      content = dropFromUnread(content, p.note);
    }
    const incoming = attracted.get(c.name) ?? [];
    if (incoming.length > 0) {
      const stillPending = c.unread
        .filter((u) => !promoted.some((p) => p.concept === c.name && p.note === u))
        .concat(incoming);
      const body =
        `${stillPending.length} ${stillPending.length === 1 ? "nota de tu cola toca" : "notas de tu cola tocan"} este concepto. ` +
        `Leer cualquiera de estas te conecta con ${c.read.length === 1 ? "la lectura" : `las ${c.read.length} lecturas`} de arriba.\n\n` +
        stillPending.map((n) => `- [[${n}]]`).join("\n");
      content = upsertSection(content, UNREAD_HEADING, body, "## Fuentes") ?? content;
    }
    if (content !== c.content) {
      await writeFile(join(VAULT, c.path), content, "utf-8");
      touched.push(c.name);
    }
  }
}

// 4. Auditar contra el estándar (B-737).
const stems = new Set<string>();
const walkStems = (rel: string): void => {
  const abs = join(VAULT, rel);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) walkStems(join(rel, e.name));
    else if (e.name.endsWith(".md")) stems.add(e.name.replace(/\.md$/, ""));
  }
};
for (const r of ["Inbox", "Books", CONCEPTS]) walkStems(r);

const failures: Array<{ name: string; failed: string[] }> = [];
const warnings: Array<{ name: string; notes: string[] }> = [];
for (const c of await loadConcepts()) {
  const results = auditConceptNote(c.content, { knownStems: stems });
  if (!passesStandard(results)) {
    failures.push({
      name: c.name,
      failed: results
        .filter((r) => !r.advisory && !r.passed)
        .map((r) => `${r.label}${r.detail ? ` (${r.detail})` : ""}`),
    });
  }
  const warn = advisories(results).filter((r) => r.detail);
  if (warn.length > 0) {
    warnings.push({ name: c.name, notes: warn.map((r) => r.detail as string) });
  }
}

// 5. Log auditable.
const stamp = git("log", "-1", "--format=%cI").slice(0, 16).replace("T", " ");
const lines = [
  `## Run ${stamp}`,
  "",
  `- notas: ${notes.length} · conceptos: ${concepts.length}`,
  `- promovidas (las leíste): ${promoted.length}`,
  ...promoted.map((p) => `  - **${p.note}** → sale de pendientes en *${p.concept}*`),
  `- atraídas (nuevas en la cola): ${[...attracted.values()].flat().length}`,
  ...[...attracted.entries()].map(([c, ns]) => `  - *${c}*: ${ns.length}`),
  `- notas-concepto modificadas: ${touched.length}${touched.length > 0 ? ` (${touched.join(", ")})` : ""}`,
  `- auditoría del estándar: ${failures.length === 0 ? "✅ todas cumplen" : `⚠️ ${failures.length} no cumplen`}`,
  ...failures.map((f) => `  - **${f.name}**: ${f.failed.join(" · ")}`),
  ...(warnings.length > 0 ? [`- para podar (no bloquea): ${warnings.length}`] : []),
  ...warnings.map((w) => `  - *${w.name}*: ${w.notes.join(" · ")}`),
];
if (promoted.length > 0) {
  lines.push(
    "",
    "> Las promovidas salieron de la lista de pendientes pero **no entraron a la síntesis**:",
    "> el cuerpo del concepto sigue sin mencionarlas. Reescribir esos conceptos es",
    "> trabajo de criterio, no automatizable — quedan acá anotados.",
  );
}
lines.push("");

console.log(`\n${lines.join("\n")}`);

if (!DRY) {
  await mkdir(join(VAULT, "Diario"), { recursive: true });
  const logPath = join(VAULT, LOG);
  const previous = existsSync(logPath) ? await readFile(logPath, "utf-8") : "# Gardener — bitácora\n";
  await writeFile(logPath, `${previous.trimEnd()}\n\n${lines.join("\n")}`, "utf-8");

  const manifest: State["notes"] = {};
  for (const n of notes) manifest[n.path] = n.status;
  await writeFile(
    STATE,
    JSON.stringify({ lastRun: stamp, notes: manifest }, null, 1),
    "utf-8",
  );

  if (!NO_COMMIT) {
    const changed = git("status", "--porcelain", "--", CONCEPTS, "Diario").split("\n").filter(Boolean);
    if (changed.length > 0) {
      git("add", "--", CONCEPTS, "Diario");
      git("commit", "-q", "-m", `chore(gardener): ${promoted.length} promovidas · ${touched.length} conceptos actualizados`);
      console.log(`\ncommit: ${git("log", "-1", "--format=%h %s")}`);
    }
  }
}
