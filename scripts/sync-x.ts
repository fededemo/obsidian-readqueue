#!/usr/bin/env tsx
/**
 * Sincroniza bookmarks y likes de X desde birdclaw a la vault (F7 / E1).
 *
 * birdclaw baja los datos a `~/.birdclaw/birdclaw.sqlite`; este CLI los lee,
 * delega el triage al módulo puro `src/x-sync.ts` y escribe las notas. La
 * separación es la misma que en Kindle: la lógica es testeable sin base, el
 * acceso a disco vive acá.
 *
 *   npm run sync-x -- --dry-run
 *   npm run sync-x -- --limit 50
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { addToUrlIndex, type UrlIndex } from "../src/url-canon";
import {
  allocateFilename,
  keyFromVaultUrl,
  noteBasename,
  planSync,
  renderNote,
  type XItem,
} from "../src/x-sync";

const VAULT = join(homedir(), "fedenotes");
const DB = join(homedir(), ".birdclaw", "birdclaw.sqlite");
const WEB = "Inbox/Web";
const LEGACY = "Inbox/Legacy/X";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
/**
 * E1 vs E2 (F7 §Fase E): la punta primero. `--queue-only` escribe solo lo
 * reciente y consumible; el volumen de referencia espera a que exista la capa
 * de conceptos, o inunda la vault sin nada que lo indexe.
 */
const QUEUE_ONLY = args.includes("--queue-only");
const LIMIT = args.indexOf("--limit") >= 0 ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

/**
 * `sqlite3` en vez de una dependencia npm: la base la produce birdclaw, no
 * nosotros, y el plugin nunca la lee en runtime. Traer un binding nativo para
 * un script de sync sería costo sin beneficio.
 *
 * Modo `-json`, no un separador: los campos traen texto libre y JSON anidado
 * (`entities_json`), así que cualquier delimitador aparece dentro de los datos.
 */
function query<T>(sql: string): T[] {
  const out = execFileSync("sqlite3", ["-json", DB, sql], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  return out ? (JSON.parse(out) as T[]) : [];
}

interface Row {
  kind: string;
  id: string | number;
  text: string | null;
  created_at: string | null;
  handle: string | null;
  reply_to_id: string | null;
  quoted_tweet_id: string | null;
  entities_json: string | null;
  media_json: string | null;
  deleted_at: string | null;
}

const jsonOr = <T,>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

function loadItems(): XItem[] {
  // `kind` es 'bookmarks'/'likes' en plural — se verificó contra la base real.
  const rows = query<Row>(`
    SELECT c.kind, t.id, t.text, t.created_at, p.handle, t.reply_to_id,
           t.quoted_tweet_id, t.entities_json, t.media_json, t.deleted_at
    FROM tweet_collections c
    JOIN tweets t ON t.id = c.tweet_id
    LEFT JOIN profiles p ON p.id = t.author_profile_id
    ORDER BY t.created_at DESC;
  `);

  return rows.map((r): XItem => {
    const entities = jsonOr<{ urls?: Array<{ expandedUrl?: string }> }>(r.entities_json ?? undefined, {});
    const media = jsonOr<Array<{ type?: string }>>(r.media_json ?? undefined, []);
    return {
      id: String(r.id ?? ""),
      text: r.text ?? "",
      createdAt: r.created_at ?? "",
      // El handle viene con @ en la base; se normaliza para armar la URL.
      authorHandle: (r.handle ?? "").replace(/^@/, ""),
      replyToId: r.reply_to_id ?? undefined,
      quotedTweetId: r.quoted_tweet_id ?? undefined,
      urls: (entities.urls ?? []).map((u) => u.expandedUrl ?? "").filter(Boolean),
      mediaTypes: media.map((m) => m.type ?? "").filter(Boolean),
      collection: r.kind === "likes" ? "likes" : "bookmarks",
      deleted: Boolean(r.deleted_at),
    };
  });
}

/** Índice de lo que ya está en la vault, para no duplicar. */
function existingKeys(): Set<string> {
  const index: UrlIndex = new Map();
  const keys = new Set<string>();
  const walk = (rel: string): void => {
    const abs = join(VAULT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        walk(join(rel, e.name));
        continue;
      }
      if (!e.name.endsWith(".md")) continue;
      const text = readFileSync(join(abs, e.name), "utf-8");
      for (const field of ["url", "targetUrl"]) {
        const m = text.match(new RegExp(`^${field}:\\s*"?([^"\\s]+)"?`, "m"));
        if (m?.[1]) {
          keys.add(keyFromVaultUrl(m[1]));
          addToUrlIndex(index, m[1], {
            path: join(rel, e.name),
            title: e.name.replace(/\.md$/, ""),
            status: "unread",
          });
        }
      }
    }
  };
  walk("Inbox");
  return keys;
}

const yaml = (fm: Record<string, unknown>): string =>
  Object.entries(fm)
    .map(([k, v]) =>
      Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${JSON.stringify(v)}`,
    )
    .join("\n");

// ---- main ----
if (!existsSync(DB)) {
  console.error(`No existe ${DB}. Corré: birdclaw sync bookmarks --mode xurl`);
  process.exit(1);
}

const items = loadItems();
const known = existingKeys();
const plan = planSync(items, known);

console.log(`birdclaw: ${items.length} items · ya en la vault: ${known.size} urls`);
console.log(
  `plan -> cola ${plan.toQueue} · legacy ${plan.toLegacy} · duplicados ${plan.duplicates}`,
);
console.log(
  `tipos -> read ${plan.byKind.read} · watch ${plan.byKind.watch} · reference ${plan.byKind.reference}`,
);

if (DRY) {
  console.log("\nDRY RUN — no se escribió nada. Muestra:");
  for (const { item, triage } of plan.items.slice(0, 8)) {
    console.log(`  [${triage.kind}/${triage.destination}] ${item.text.slice(0, 62).replace(/\n/g, " ")}`);
  }
  process.exit(0);
}

let written = 0;
const target = plan.items.filter((x) => !QUEUE_ONLY || x.triage.destination === "queue");
/** Nombres ya tomados, por carpeta. Se siembra con lo que hay en disco. */
const taken = new Map<string, Set<string>>();
const usedIn = (dir: string): Set<string> => {
  const cached = taken.get(dir);
  if (cached) return cached;
  const set = new Set(
    existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => n.endsWith(".md"))
          .map((n) => n.replace(/\.md$/, "").normalize("NFC").toLowerCase())
      : [],
  );
  taken.set(dir, set);
  return set;
};

for (const { item, triage } of target.slice(0, LIMIT)) {
  const note = renderNote(item, triage, { webFolder: WEB, legacyFolder: LEGACY });
  const dir = join(VAULT, note.folder);
  mkdirSync(dir, { recursive: true });
  const base = noteBasename(item.text);
  const name = allocateFilename(base, usedIn(dir), item.id.slice(-6));
  writeFileSync(
    join(dir, `${name}.md`),
    `---\n${yaml(note.frontmatter)}\n---\n\n${note.body}\n`,
    "utf-8",
  );
  written++;
}

console.log(`\nescritas: ${written}${QUEUE_ONLY ? " (solo cola — el resto con un run sin --queue-only)" : ""}`);
