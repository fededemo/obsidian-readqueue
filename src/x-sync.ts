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

/** Una de las calidades en las que X sirve el mismo video. */
export interface XMediaVariant {
  url: string;
  contentType?: string | undefined;
  bitRate?: number | undefined;
}

/**
 * Una media adjunta al tweet, tal como la guarda birdclaw en `media_json`.
 *
 * Ojo con `url` en los videos: X pone ahí el **thumbnail**, no el `.mp4`. El
 * reproducible vive en `variants`, una por bitrate.
 */
export interface XMedia {
  /** "image" | "video" | "animated_gif" */
  type: string;
  /** La imagen si es foto; el thumbnail si es video. */
  url: string;
  thumbnailUrl?: string | undefined;
  variants?: readonly XMediaVariant[] | undefined;
}

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
  /**
   * Las media adjuntas, con su URL.
   *
   * Reemplazó a un `mediaTypes: string[]` que guardaba solo el `type` y tiraba
   * la URL: por eso 277 de las 519 notas de X quedaron sin sus imágenes aunque
   * el dato estaba en la base. Un solo campo, sin copia que pueda divergir.
   */
  media: readonly XMedia[];
  collection: "bookmarks" | "likes";
  deleted?: boolean | undefined;
}

const mediaTypes = (item: Pick<XItem, "media">): string[] =>
  item.media.map((m) => m.type);

const hasNativeVideo = (item: Pick<XItem, "media">): boolean =>
  mediaTypes(item).some((t) => t === "video" || t === "animated_gif");

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

/**
 * X Articles: el formato largo de X. Viven en un dominio de X pero NO son una
 * auto-referencia — son el contenido. Descartarlos por dominio dejaba 92 notas
 * como `reference` y sin siquiera el link: el cuerpo quedaba en un `t.co` pelado
 * y ni el clasificador de topics podía sacarles nada.
 */
const X_ARTICLE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i;

const isInternal = (url: string): boolean => {
  if (X_ARTICLE.test(url)) return false;
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
  if (hasNativeVideo(item)) return true;
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

/**
 * A partir de acá el texto huele a truncado por la API.
 *
 * X corta en 280 y engancha un `t.co`; el texto completo viaja aparte y birdclaw
 * no lo guarda. Medido sobre los 650 de Fede: **ningún tweet supera los 500
 * caracteres**, lo cual es imposible en un corpus real donde los posts largos
 * llegan a miles. Un caso concreto: 293 guardados contra 3.247 reales.
 */
const TRUNCATION_SUSPECT_MIN = 240;

/**
 * ¿Vale la pena ir a buscar el texto completo de este tweet?
 *
 * Es un **prefiltro**, no un veredicto: la decisión real se toma comparando con
 * lo que devuelve FxTwitter. Acá solo se evita gastar una request por cada tweet
 * corto, que por definición no puede estar cortado en 280.
 */
export function looksTruncated(item: Pick<XItem, "text" | "urls">): boolean {
  if (item.text.length < TRUNCATION_SUSPECT_MIN) return false;
  const trailing = /(https:\/\/t\.co\/\w+)\s*$/.exec(item.text);
  if (!trailing) return false;
  // Si lo último es un link a algo externo, el tweet termina ahí a propósito.
  // El corte de X engancha un puntero a su propio contenido (foto, video, hilo).
  return item.urls.every((u) => !u || isInternal(u) || !item.text.endsWith(u));
}

/**
 * Reemplaza la cita del tweet dejando el resto de la nota intacto.
 *
 * Se toca solo el primer bloque `>`: lo que sigue es la atribución al autor y la
 * lista de links, y el frontmatter ya trae `topic`, `tldr` y `shelfLife` que
 * costaron plata. Regenerar la nota entera los perdería.
 */
export function replaceQuoteBlock(body: string, text: string): string {
  const lines = body.split("\n");
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if (!/^>/.test(lines[start] ?? "")) return body;
  let end = start;
  while (end < lines.length && /^>/.test(lines[end] ?? "")) end++;
  const quoted = text.split("\n").map((l) => (l ? `> ${l}` : ">"));
  return [...lines.slice(0, start), ...quoted, ...lines.slice(end)].join("\n");
}

/**
 * ¿Esta nota ya muestra sus imágenes?
 *
 * Solo cuenta lo que está fuera de la cita: un tweet cuyo texto menciona
 * `![](…)` no significa que la nota tenga la imagen embebida, y tomarlo como
 * señal dejaría esa nota sin backfill para siempre.
 */
export function hasMediaBlocks(body: string): boolean {
  return body
    .split("\n")
    .some((l) => !/^\s*>/.test(l) && (l.includes("![](") || l.includes("![[")));
}

/**
 * Agrega los bloques de media a una nota ya escrita, dejando todo lo demás
 * intacto.
 *
 * Van después de la atribución al autor y antes de `## Links`, que es el mismo
 * orden que produce `renderNote` — una nota vieja backfilleada y una nueva
 * tienen que ser indistinguibles.
 *
 * Es idempotente: si la nota ya tiene media, vuelve tal cual. Correr el backfill
 * dos veces no duplica nada.
 */
export function insertMediaBlocks(body: string, blocks: readonly string[]): string {
  if (blocks.length === 0 || hasMediaBlocks(body)) return body;
  const lines = body.split("\n");
  const attribution = lines.findIndex((l) => /^—\s*\[@/.test(l.trim()));
  const links = lines.findIndex((l) => /^##\s+Links\s*$/.test(l.trim()));

  let at: number;
  if (attribution >= 0) at = attribution + 1;
  else if (links >= 0) at = links;
  else {
    // Sin ninguna de las dos anclas la nota no tiene la forma esperada; al final
    // es el único lugar que no puede romper nada.
    at = lines.length;
  }
  while (at > 0 && (lines[at - 1] ?? "").trim() === "") at--;

  const inserted = blocks.flatMap((b) => ["", b]);
  return [...lines.slice(0, at), ...inserted, ...lines.slice(at)].join("\n");
}

/** Clave canónica para deduplicar contra lo que ya está en la vault. */
export function itemKey(item: XItem): string {
  const ext = externalUrls(item);
  // Un puntero se identifica por su destino: si el artículo ya está en la
  // vault vía Web Clipper, el bookmark no debe generar una nota nueva.
  return ext[0] ? canonicalizeUrl(ext[0]) : `tweet:${item.id}`;
}

/**
 * Todas las identidades bajo las que este ítem puede estar ya en la vault.
 *
 * Un tweet que apunta a un X Article se identifica por el artículo, pero si Fede
 * ya clippeó ese artículo con Web Clipper la nota quedó guardada con la URL del
 * TWEET. Con una sola clave no matchean: el sync escribe el duplicado, el dedupe
 * del plugin lo manda a la papelera un segundo después, y en el próximo sync
 * vuelve a faltar. Pasó con 6 notas, en loop.
 */
export function itemKeys(item: XItem): string[] {
  const primary = itemKey(item);
  const byTweet = `tweet:${item.id}`;
  return primary === byTweet ? [primary] : [primary, byTweet];
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
 * TODAS las claves bajo las que una nota de la vault puede reconocerse.
 *
 * Un mismo tweet se identifica distinto según lo que lleve adentro: por su id si
 * no tiene link externo, por la URL de destino si lo tiene. Una nota vieja
 * guardada con `url: <tweet>` y un ítem que ahora resuelve a un X Article no
 * matchean si se elige una sola forma — y el sync escribe un duplicado que el
 * dedupe del plugin borra un segundo después, en loop. Indexar por las dos
 * cierra el círculo.
 */
export function vaultUrlKeys(url: string): string[] {
  const canonical = canonicalizeUrl(url);
  const id = STATUS_URL.exec(url)?.[1];
  return id ? [canonical, `tweet:${id}`] : [canonical];
}

/**
 * Título de la nota. Un tweet sin texto propio —solo un link— igual merece un
 * nombre: "sin-titulo (167475)" en la cola de lectura no dice nada y hace que
 * la cola parezca rota.
 */
export function noteTitle(item: XItem): string {
  const base = noteBasename(item.text);
  if (base !== "sin-titulo") return base;
  const handle = item.authorHandle ? `@${item.authorHandle}` : "X";
  if (item.urls.some((u) => X_ARTICLE.test(u))) return `Artículo de ${handle}`;
  if (externalUrls(item).length > 0) return `Link de ${handle}`;
  if (hasNativeVideo(item)) return `Video de ${handle}`;
  if (item.media.length > 0) return `Imagen de ${handle}`;
  return `Post de ${handle}`;
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

/**
 * Título para mostrar en la cola, distinto del nombre de archivo.
 *
 * El nombre de archivo son los primeros 70 caracteres saneados, que en un post
 * largo corta a mitad de palabra. La primera línea de un tweet, en cambio, suele
 * ser el titular —"how I'm building an agent company inside my agency."— y ahora
 * que recuperamos el texto completo esa línea está disponible de verdad.
 *
 * Va en el frontmatter y no en el nombre del archivo a propósito: renombrar
 * dispara el watcher de dedupe del plugin, que manda la nota a la papelera.
 * `articleFromFile` ya prefiere `title` sobre el basename.
 */
export function displayTitle(item: XItem): string {
  const firstLine = textWithoutLinks((item.text.split("\n")[0] ?? "").trim());
  const words = firstLine.split(/\s+/).filter(Boolean).length;
  // Una línea que termina en `:` es el pie de una lista —"Andrew Ng:"— y una de
  // tres palabras es una etiqueta. Ninguna de las dos sirve de título, y usarlas
  // sería peor que el nombre de archivo cortado que reemplazan.
  const esTitular =
    firstLine.length >= 25 && firstLine.length <= 100 && words >= 4 && !firstLine.endsWith(":");
  return esTitular ? firstLine : noteTitle(item);
}

/**
 * Techo de bitrate al elegir la calidad de un video.
 *
 * X sirve el mismo clip hasta en 10 Mbps: un video de 39 minutos a esa calidad
 * son cientos de MB para abrir desde el iPhone. 2.5 Mbps es el 720p típico —
 * mirable en cualquier pantalla sin castigar la conexión.
 */
const VIDEO_BITRATE_CEILING = 2_500_000;

/**
 * El `.mp4` que conviene linkear, o undefined si no hay ninguno.
 *
 * El mejor por debajo del techo; si todos lo superan, el más liviano — es
 * preferible un video feo que se abre a uno perfecto que no carga.
 */
export function pickVideoVariant(
  variants: readonly XMediaVariant[] | undefined,
): XMediaVariant | undefined {
  const mp4s = (variants ?? []).filter(
    (v) => v.url && (v.contentType ?? "").includes("mp4"),
  );
  if (mp4s.length === 0) return undefined;
  const byRate = [...mp4s].sort((a, b) => (a.bitRate ?? 0) - (b.bitRate ?? 0));
  const under = byRate.filter((v) => (v.bitRate ?? 0) <= VIDEO_BITRATE_CEILING);
  return under[under.length - 1] ?? byRate[0];
}

/**
 * Extensión del asset. X sirve tanto `…/foo.png` como `…/foo?format=jpg`, así
 * que el query param manda sobre el path — sin esto media vault se llena de
 * archivos `.twimg` que Obsidian no sabe mostrar.
 */
function assetExtension(url: string): string {
  const fromQuery = /[?&]format=([a-z0-9]+)/i.exec(url)?.[1];
  if (fromQuery) return fromQuery.toLowerCase();
  const path = url.split("?")[0] ?? "";
  const fromPath = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1];
  return (fromPath ?? "jpg").toLowerCase();
}

/**
 * Nombre del archivo descargado. Determinístico a propósito: correr el sync dos
 * veces reusa el mismo archivo en vez de acumular copias, y el backfill puede
 * saber si ya lo bajó sin llevar un índice aparte.
 *
 * Lleva el id del tweet, no un hash de la URL: al mirar la carpeta se ve de qué
 * post viene cada imagen.
 */
export function mediaAssetName(
  tweetId: string,
  index: number,
  url: string,
): string {
  return `${tweetId}-${index + 1}.${assetExtension(url)}`;
}

/**
 * Lo que hay que bajar para una nota: la foto si es imagen, el thumbnail si es
 * video. Los `.mp4` se linkean, no se descargan — pesan demasiado para el peso
 * que tienen en la vault.
 */
export interface XMediaAsset {
  url: string;
  filename: string;
  /** El `.mp4` a linkear, solo en videos. */
  videoUrl?: string | undefined;
}

export function mediaAssets(item: XItem): XMediaAsset[] {
  return item.media.map((m, i) => {
    const poster = m.type === "image" ? m.url : (m.thumbnailUrl ?? m.url);
    const variant = m.type === "image" ? undefined : pickVideoVariant(m.variants);
    return {
      url: poster,
      filename: mediaAssetName(item.id, i, poster),
      videoUrl: variant?.url,
    };
  });
}

/**
 * Dado el nombre de archivo, dónde quedó en la vault — o undefined si no se
 * pudo bajar. Permite que el módulo siga siendo puro: la descarga vive en el CLI.
 */
export type MediaResolver = (asset: XMediaAsset) => string | undefined;

/**
 * Los bloques markdown de las media del tweet.
 *
 * Mismo formato que produce el intake para una URL pegada a mano
 * (`tweetToArticle`): los dos caminos de entrada tienen que dar la misma nota.
 *
 * Cuando la descarga falla se cae al link remoto en vez de omitir la imagen —
 * una imagen que quizás no cargue es mejor que ninguna.
 */
export function mediaMarkdown(item: XItem, resolve?: MediaResolver): string[] {
  const blocks: string[] = [];
  for (const asset of mediaAssets(item)) {
    const local = resolve?.(asset);
    const embed = local ? `![[${local}]]` : `![](${asset.url})`;
    blocks.push(asset.videoUrl ? `[Video ↗](${asset.videoUrl})\n\n${embed}` : embed);
  }
  return blocks;
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
  /** Ausente = las media se linkean al CDN de X en vez de embeberse locales. */
  resolveMedia?: MediaResolver | undefined;
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
    title: displayTitle(item),
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
  for (const block of mediaMarkdown(item, opts.resolveMedia)) {
    lines.push("", block);
  }
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
    const keys = itemKeys(item);
    const key = keys[0] as string;
    if (keys.some((k) => existingKeys.has(k) || seen.has(k))) {
      plan.duplicates++;
      continue;
    }
    for (const k of keys) seen.add(k);
    const t = triage(item, opts);
    plan.byKind[t.kind]++;
    if (t.destination === "queue") plan.toQueue++;
    else plan.toLegacy++;
    plan.items.push({ item, triage: t, key });
  }
  return plan;
}
