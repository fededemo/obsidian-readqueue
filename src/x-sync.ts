import { canonicalizeUrl } from "./url-canon";

/**
 * Triage de bookmarks y likes de X (F7).
 *
 * Módulo puro: recibe filas ya leídas del SQLite de birdclaw y decide qué es
 * cada una y dónde va. El acceso a la base vive en el CLI, así que todo esto
 * se testea sin dependencias.
 *
 * La taxonomía es por **modalidad de consumo**, no por "qué es" — leer, ver,
 * o solo guardar el dato. Ver docs/plans/f7-x-bookmarks-y-likes.md §12.
 *
 * Medido sobre los 450 bookmarks reales de Fede: 33% read · 24% watch ·
 * 43% reference. Uno de cada cuatro es video, y los punteros son en su
 * mayoría PDFs académicos, no artículos HTML.
 */

export type XKind = "read" | "watch" | "reference";
export type XDestination = "queue" | "legacy";

export interface XItem {
  id: string;
  text: string;
  /** ISO. Es la fecha del TWEET: la API no expone cuándo se guardó (F7 §3.1). */
  createdAt: string;
  authorHandle: string;
  replyToId?: string | undefined;
  quotedTweetId?: string | undefined;
  /** `expandedUrl` de cada link — ya sin el envoltorio t.co. */
  urls: readonly string[];
  /** `type` de cada media adjunta: "video" | "image" | … */
  mediaTypes: readonly string[];
  collection: "bookmarks" | "likes";
  deleted?: boolean | undefined;
}

export interface XTriage {
  kind: XKind;
  destination: XDestination;
  /** Por qué quedó así — sin esto el routing es magia que nadie puede auditar. */
  reason: string;
}

/** Un tweet cuyo texto es solo un t.co pelado ronda los 23 caracteres. */
const BARE_LINK_MAX = 30;
/**
 * A partir de acá el tweet se sostiene solo como lectura.
 *
 * 200, no 280: ese era el límite *viejo* de Twitter, y exigirlo sobre el texto
 * propio (sin los t.co) descarta tweets con contenido real — medido sobre los
 * 650 de Fede, sube de 52 a 345 los que califican, y los que entran entre 200
 * y 280 son claramente lectura ("My daily health stack: …").
 */
const LONG_TEXT_MIN = 200;
const QUEUE_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const isInternal = (url: string): boolean => {
  const h = host(url);
  return h === "x.com" || h === "twitter.com" || h.endsWith(".x.com");
};

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "ted.com"];
const PAPER_HOSTS = ["ssrn.com", "arxiv.org", "aqr.com", "efmaefm.org", "nber.org"];
/** Repos, tiendas y herramientas: material de consulta, no de lectura. */
const REFERENCE_HOSTS = ["github.com", "gitlab.com", "npmjs.com", "producthunt.com"];

export function externalUrls(item: XItem): string[] {
  return item.urls.filter((u) => u && !isInternal(u));
}

/** Texto sin los t.co: lo que queda es lo que el autor realmente escribió. */
export function textWithoutLinks(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function isVideo(item: XItem): boolean {
  if (item.mediaTypes.some((t) => t === "video" || t === "animated_gif")) return true;
  // Un link interno a /video/ es un video nativo aunque media_json venga vacío.
  if (item.urls.some((u) => isInternal(u) && /\/video\//.test(u))) return true;
  return externalUrls(item).some((u) => VIDEO_HOSTS.includes(host(u)));
}

export function classify(item: XItem): XKind {
  if (isVideo(item)) return "watch";

  const ext = externalUrls(item);
  const hosts = ext.map(host);

  // Papers primero: el dominio manda por sobre el largo del texto. Los tweets
  // de "Link al paper: …" tienen 15 caracteres y son el material de más valor
  // de la muestra — filtrarlos por brevedad sería exactamente el error.
  if (hosts.some((h) => PAPER_HOSTS.includes(h)) || ext.some((u) => /\.pdf($|\?)/i.test(u))) {
    return "read";
  }
  if (hosts.some((h) => REFERENCE_HOSTS.includes(h))) return "reference";
  if (ext.length > 0) return "read";

  // Sin link externo: se sostiene solo si tiene cuerpo o es parte de un hilo.
  const bare = textWithoutLinks(item.text);
  if (bare.length >= LONG_TEXT_MIN) return "read";
  if (item.replyToId && bare.length > BARE_LINK_MAX) return "read";
  return "reference";
}

export interface TriageOptions {
  now?: Date;
  /** Días de antigüedad del contenido que siguen contando como "reciente". */
  queueWindowDays?: number;
}

export function triage(item: XItem, opts: TriageOptions = {}): XTriage {
  const now = opts.now ?? new Date();
  const windowDays = opts.queueWindowDays ?? QUEUE_WINDOW_DAYS;

  if (item.deleted) {
    return { kind: "reference", destination: "legacy", reason: "tweet borrado" };
  }

  // Los likes nunca entran a la cola: expresan "me gustó", no intención de
  // leer. Medido: 0 solapamiento con bookmarks, y ~5x más frecuentes.
  if (item.collection === "likes") {
    return { kind: classify(item), destination: "legacy", reason: "like" };
  }

  const kind = classify(item);
  if (kind === "reference") {
    return { kind, destination: "legacy", reason: "material de consulta" };
  }

  const created = new Date(item.createdAt);
  const ageDays = Number.isNaN(created.getTime())
    ? Number.POSITIVE_INFINITY
    : (now.getTime() - created.getTime()) / DAY_MS;

  if (ageDays > windowDays) {
    return { kind, destination: "legacy", reason: `contenido de hace ${Math.round(ageDays)} días` };
  }
  return { kind, destination: "queue", reason: kind === "watch" ? "video reciente" : "lectura reciente" };
}

/** Clave canónica para deduplicar contra lo que ya está en la vault. */
export function itemKey(item: XItem): string {
  const ext = externalUrls(item);
  // Un puntero se identifica por su destino: si el artículo ya está en la
  // vault vía Web Clipper, el bookmark no debe generar una nota nueva.
  return ext[0] ? canonicalizeUrl(ext[0]) : `tweet:${item.id}`;
}

const STATUS_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i;

/**
 * Clave de una nota que YA está en la vault, a partir de su `url`.
 *
 * Sin esto el dedupe tiene un agujero: `itemKey` cae a `tweet:<id>` cuando el
 * tweet no lleva link externo, y eso es el 91% del material de X. Como el índice
 * de la vault se armaba solo con URLs canonicalizadas, esas claves no matcheaban
 * nunca y un segundo sync habría reescrito 487 notas. Es la misma forma del bug
 * B-327 con los highlights de Kindle: idempotencia que se rompe en silencio.
 */
export function keyFromVaultUrl(url: string): string {
  const id = STATUS_URL.exec(url)?.[1];
  return id ? `tweet:${id}` : canonicalizeUrl(url);
}

/**
 * Nombre de archivo para el texto de un tweet.
 *
 * El punto inicial no es cosmético: un `.md` que arranca con punto es un archivo
 * oculto, y Obsidian ignora los ocultos. Tres tweets que empezaban con `.@alguien`
 * entraron a la vault sin ser visibles ni indexables — y como el walk del dedupe
 * también saltea los ocultos, el sync siguiente los volvió a escribir.
 */
export function noteBasename(text: string): string {
  return (
    text
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[/\\:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.\s]+/, "")
      .trim()
      .slice(0, 70)
      .trim() || "sin-titulo"
  );
}

/**
 * Nombre de archivo libre para `base`, dado lo ya usado.
 *
 * `used` guarda claves normalizadas porque macOS colapsa nombres que difieren
 * solo en mayúsculas o en forma unicode (NFC/NFD): comparar el string crudo deja
 * pasar colisiones que el filesystem sí tiene, y la escritura pisa la nota
 * anterior en silencio. Pasó en el primer E2 — 537 escrituras, 534 archivos.
 */
export function allocateFilename(
  base: string,
  used: Set<string>,
  discriminator: string,
): string {
  const norm = (s: string): string => s.normalize("NFC").toLowerCase();
  const take = (name: string): string => {
    used.add(norm(name));
    return name;
  };
  if (!used.has(norm(base))) return take(base);
  const withId = `${base} (${discriminator})`;
  if (!used.has(norm(withId))) return take(withId);
  for (let i = 2; ; i++) {
    const candidate = `${base} (${discriminator}-${i})`;
    if (!used.has(norm(candidate))) return take(candidate);
  }
}

export interface XNote {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Carpeta destino, relativa a la vault. */
  folder: string;
}

export interface RenderOptions {
  webFolder: string;
  legacyFolder: string;
  now?: Date;
}

export function renderNote(
  item: XItem,
  t: XTriage,
  opts: RenderOptions,
): XNote {
  const url = `https://x.com/${item.authorHandle}/status/${item.id}`;
  const ext = externalUrls(item);
  const source = item.collection === "likes" ? "x-like" : "x-bookmark";

  const frontmatter: Record<string, unknown> = {
    source,
    url,
    author: `@${item.authorHandle}`,
    published: item.createdAt.slice(0, 10),
    savedAt: (opts.now ?? new Date()).toISOString(),
    kind: t.kind,
    tags: ["reader", "x"],
  };
  if (ext[0]) frontmatter["targetUrl"] = ext[0];
  // Solo lo que va a la cola lleva status: en Legacy no hay nada que leer.
  if (t.destination === "queue") frontmatter["status"] = "unread";

  const lines = [`> ${item.text.replace(/\n/g, "\n> ")}`, "", `— [@${item.authorHandle}](${url})`];
  if (ext.length > 0) {
    lines.push("", "## Links", "");
    for (const u of ext) lines.push(`- ${u}`);
  }

  return {
    frontmatter,
    body: lines.join("\n"),
    folder: t.destination === "queue" ? opts.webFolder : opts.legacyFolder,
  };
}

export interface SyncPlan {
  toQueue: number;
  toLegacy: number;
  duplicates: number;
  byKind: Record<XKind, number>;
  items: Array<{ item: XItem; triage: XTriage; key: string }>;
}

/**
 * Decide qué hacer con un lote entero. `existingKeys` son las claves canónicas
 * que ya están en la vault — un bookmark cuyo artículo ya leíste no genera
 * nota nueva.
 */
export function planSync(
  items: readonly XItem[],
  existingKeys: ReadonlySet<string>,
  opts: TriageOptions = {},
): SyncPlan {
  const plan: SyncPlan = {
    toQueue: 0,
    toLegacy: 0,
    duplicates: 0,
    byKind: { read: 0, watch: 0, reference: 0 },
    items: [],
  };
  const seen = new Set<string>();

  for (const item of items) {
    const key = itemKey(item);
    if (existingKeys.has(key) || seen.has(key)) {
      plan.duplicates++;
      continue;
    }
    seen.add(key);
    const t = triage(item, opts);
    plan.byKind[t.kind]++;
    if (t.destination === "queue") plan.toQueue++;
    else plan.toLegacy++;
    plan.items.push({ item, triage: t, key });
  }
  return plan;
}
