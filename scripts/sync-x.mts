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
  looksTruncated,
  mediaAssets,
  noteTitle,
  planSync,
  renderNote,
  vaultUrlKeys,
  type XItem,
  type XMediaVariant,
} from "../src/x-sync";
import { fetchFullText, sleep, tweetIdFromUrl } from "./lib/fx.mjs";
import { downloadAll } from "./lib/media.mjs";

const VAULT = join(homedir(), "fedenotes");
const DB = join(homedir(), ".birdclaw", "birdclaw.sqlite");
const WEB = "Inbox/Web";
const LEGACY = "Inbox/Legacy/X";
/**
 * Carpeta única para las imágenes, fuera de `Web/` y de `Legacy/X/`.
 *
 * Los wikilinks de Obsidian resuelven por nombre de archivo en toda la vault,
 * así que una nota en cualquiera de las dos encuentra su imagen sin ruta
 * relativa. Y el dedupe y el orphan-mover del plugin solo miran markdown, así
 * que acá adentro nada se les cruza.
 */
const MEDIA = "Inbox/x-media";

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

/** El shape de `media_json` en la base de birdclaw. */
interface RawMedia {
  type?: string;
  url?: string;
  thumbnailUrl?: string;
  variants?: XMediaVariant[];
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
    const media = jsonOr<RawMedia[]>(r.media_json ?? undefined, []);
    return {
      id: String(r.id ?? ""),
      text: r.text ?? "",
      createdAt: r.created_at ?? "",
      // El handle viene con @ en la base; se normaliza para armar la URL.
      authorHandle: (r.handle ?? "").replace(/^@/, ""),
      replyToId: r.reply_to_id ?? undefined,
      quotedTweetId: r.quoted_tweet_id ?? undefined,
      urls: (entities.urls ?? []).map((u) => u.expandedUrl ?? "").filter(Boolean),
      media: media
        .filter((m) => m.url)
        .map((m) => ({
          type: m.type ?? "",
          url: m.url as string,
          thumbnailUrl: m.thumbnailUrl,
          variants: m.variants,
        })),
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
      // `source` va incluido a propósito: el template viejo del Web Clipper
      // guarda la URL ahí y no en `url`. El plugin ya lo resuelve así
      // (`articleFromFile`); si acá no, el sync ve como nueva una nota que ya
      // existe y el dedupe del plugin la borra apenas se escribe.
      for (const field of ["url", "targetUrl", "source"]) {
        const m = text.match(new RegExp(`^${field}:\\s*"?([^"\\s]+)"?`, "m"));
        if (m?.[1] && /^https?:\/\//i.test(m[1])) {
          for (const k of vaultUrlKeys(m[1])) keys.add(k);
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

/**
 * Antes de escribir, recuperar el texto de los que vinieron cortados.
 *
 * La API de X trunca en 280 caracteres y engancha un `t.co`; el post entero
 * viaja aparte y birdclaw no lo guarda. Medido: 293 caracteres archivados
 * contra 3.247 reales. FxTwitter lo devuelve completo, gratis.
 *
 * Solo sobre lo que efectivamente se va a escribir — enriquecer los 650 en cada
 * corrida sería castigar un servicio público para nada.
 */
let written = 0;
const target = plan.items.filter((x) => !QUEUE_ONLY || x.triage.destination === "queue");

const truncated = target.filter((x) => looksTruncated(x.item));
if (truncated.length > 0 && !DRY) {
  console.log(`\nrecuperando texto completo de ${truncated.length} tweets cortados…`);
  let ok = 0;
  const queue = [...truncated];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;
        const id = tweetIdFromUrl(`https://x.com/x/status/${entry.item.id}`);
        const full = id ? await fetchFullText(id) : undefined;
        await sleep(250);
        if (full && full.length > entry.item.text.length) {
          entry.item = { ...entry.item, text: full };
          ok++;
        }
      }
    }),
  );
  console.log(`  recuperados: ${ok}/${truncated.length}`);
}
/**
 * Bajar las imágenes antes de escribir las notas.
 *
 * El orden importa: `renderNote` necesita saber qué asset quedó en disco para
 * elegir entre `![[local]]` y el link al CDN. Los `.mp4` no se bajan — se
 * linkean; lo que se guarda es el thumbnail, que es una imagen normal.
 */
const assets = target.slice(0, LIMIT).flatMap((x) => mediaAssets(x.item));
const mediaDir = join(VAULT, MEDIA);
let availableMedia = new Set<string>();
if (assets.length > 0) {
  console.log(`\nbajando ${assets.length} imágenes a ${MEDIA}/…`);
  const { available, stats } = await downloadAll(assets, mediaDir);
  availableMedia = available;
  console.log(
    `  nuevas ${stats.ok} · ya estaban ${stats.cached} · fallaron ${stats.failed}` +
      (stats.failed > 0 ? " (esas quedan linkeadas al CDN de X)" : ""),
  );
}

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
  const note = renderNote(item, triage, {
    webFolder: WEB,
    legacyFolder: LEGACY,
    resolveMedia: (a) => (availableMedia.has(a.filename) ? a.filename : undefined),
  });
  const dir = join(VAULT, note.folder);
  mkdirSync(dir, { recursive: true });
  const base = noteTitle(item);
  const name = allocateFilename(base, usedIn(dir), item.id.slice(-6));
  writeFileSync(
    join(dir, `${name}.md`),
    `---\n${yaml(note.frontmatter)}\n---\n\n${note.body}\n`,
    "utf-8",
  );
  written++;
}

console.log(`\nescritas: ${written}${QUEUE_ONLY ? " (solo cola — el resto con un run sin --queue-only)" : ""}`);
