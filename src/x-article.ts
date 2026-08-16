/**
 * X Articles (`x.com/i/article/…`) → markdown.
 *
 * El HTML de esas URLs es un shell de JS: curl/defuddle ven un 404 con
 * `<title>X</title>` y cero cuerpo. El contenido viaja en el tweet que
 * anuncia el artículo, campo `tweet.article` de FxTwitter — Draft.js
 * (`blocks` + `entityMap` + `media_entities`). El sync y el intake ya
 * pedían FxTwitter y tiraban ese campo.
 */

export interface XArticleMediaInfo {
  __typename?: string;
  original_img_url?: string;
}

export interface XArticleMedia {
  media_id?: string;
  media_info?: XArticleMediaInfo;
}

export interface XArticleEntityData {
  url?: string;
  markdown?: string;
  tweetId?: string;
  mediaItems?: Array<{ mediaId?: string }>;
}

export interface XArticleEntityValue {
  type?: string;
  data?: XArticleEntityData;
}

export interface XArticleEntityEntry {
  key?: string | number;
  value?: XArticleEntityValue;
}

export interface XArticleRange {
  key?: number | string;
  offset?: number;
  length?: number;
  style?: string;
}

export interface XArticleBlock {
  type?: string;
  text?: string;
  entityRanges?: readonly XArticleRange[];
  inlineStyleRanges?: readonly XArticleRange[];
}

export interface XArticleContent {
  blocks?: readonly XArticleBlock[];
  entityMap?: readonly XArticleEntityEntry[] | Record<string, XArticleEntityValue | XArticleEntityEntry>;
}

export interface XArticle {
  id?: string;
  title?: string;
  preview_text?: string;
  cover_media?: XArticleMedia;
  media_entities?: readonly XArticleMedia[];
  content?: XArticleContent;
}

const X_ARTICLE_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i;

export function isXArticleUrl(url: string): boolean {
  return X_ARTICLE_URL.test(url);
}

export interface XArticleImageAsset {
  url: string;
  filename: string;
}

export type ArticleImageResolver = (asset: XArticleImageAsset) => string | undefined;

function imageUrl(media: XArticleMedia | undefined): string | undefined {
  const url = media?.media_info?.original_img_url;
  return url && url.trim() ? url : undefined;
}

function assetExtension(url: string): string {
  const fromQuery = /[?&]format=([a-z0-9]+)/i.exec(url)?.[1];
  if (fromQuery) return fromQuery.toLowerCase();
  const path = url.split("?")[0] ?? "";
  const fromPath = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1];
  return (fromPath ?? "jpg").toLowerCase();
}

/**
 * Nombre determinístico: el stem del CDN de X. Prefijo `xa-` para no chocar
 * con las fotos de tweets (`<tweetId>-<n>.jpg`).
 */
export function articleImageFilename(url: string): string {
  const path = (url.split("?")[0] ?? "").replace(/\/+$/, "");
  const base = path.split("/").pop() ?? "img";
  const stem = base.replace(/\.[a-z0-9]{2,4}$/i, "") || "img";
  return `xa-${stem}.${assetExtension(url)}`;
}

export function xArticleImageAssets(article: XArticle): XArticleImageAsset[] {
  const seen = new Set<string>();
  const out: XArticleImageAsset[] = [];
  const add = (url: string | undefined): void => {
    if (!url) return;
    const filename = articleImageFilename(url);
    if (seen.has(filename)) return;
    seen.add(filename);
    out.push({ url, filename });
  };
  add(imageUrl(article.cover_media));
  for (const m of article.media_entities ?? []) add(imageUrl(m));
  return out;
}

function embedImage(url: string, resolve?: ArticleImageResolver): string {
  const filename = articleImageFilename(url);
  const local = resolve?.({ url, filename });
  return local ? `![[${local}]]` : `![](${url})`;
}

const REMOTE_PBS = /!\[\]\((https?:\/\/pbs\.twimg\.com\/[^)]+)\)/g;

/**
 * Reemplaza `![](cdn)` por `![[archivo]]` cuando el asset ya está en disco.
 * Idempotente: un wikilink no matchea el regex.
 */
export function localizeRemoteImages(
  markdown: string,
  available: ReadonlySet<string>,
): string {
  return markdown.replace(REMOTE_PBS, (full, url: string) => {
    const name = articleImageFilename(url);
    return available.has(name) ? `![[${name}]]` : full;
  });
}

/** URLs remotas que todavía hay que bajar, a partir del markdown ya escrito. */
export function remoteImagesInMarkdown(markdown: string): XArticleImageAsset[] {
  const seen = new Set<string>();
  const out: XArticleImageAsset[] = [];
  REMOTE_PBS.lastIndex = 0;
  for (const m of markdown.matchAll(REMOTE_PBS)) {
    const url = m[1];
    if (!url) continue;
    const filename = articleImageFilename(url);
    if (seen.has(filename)) continue;
    seen.add(filename);
    out.push({ url, filename });
  }
  return out;
}

function lookupEntity(
  map: XArticleContent["entityMap"],
  key: number | string,
): XArticleEntityValue | undefined {
  const k = String(key);
  if (Array.isArray(map)) {
    for (const entry of map) {
      if (String(entry?.key) === k) return entry.value;
    }
    return undefined;
  }
  if (!map) return undefined;
  const rec = map as Record<string, XArticleEntityValue | XArticleEntityEntry>;
  const hit = rec[k];
  if (!hit || typeof hit !== "object") return undefined;
  if ("type" in hit && !("value" in hit)) return hit;
  return (hit as XArticleEntityEntry).value;
}

function imageForMediaId(
  entities: readonly XArticleMedia[] | undefined,
  mediaId: string | undefined,
): string | undefined {
  if (!mediaId || !entities) return undefined;
  return imageUrl(entities.find((m) => m.media_id === mediaId));
}

function applyStyle(text: string, style: string): string {
  switch (style.toUpperCase()) {
    case "BOLD":
      return `**${text}**`;
    case "ITALIC":
      return `*${text}*`;
    case "CODE":
      return `\`${text}\``;
    case "STRIKETHROUGH":
      return `~~${text}~~`;
    default:
      return text;
  }
}

/**
 * Aplica links y estilos de Draft.js de atrás para adelante, para que los
 * offsets no se corran al insertar markup.
 */
function decorateText(
  text: string,
  entityRanges: readonly XArticleRange[] | undefined,
  styleRanges: readonly XArticleRange[] | undefined,
  entityMap: XArticleContent["entityMap"],
): string {
  type Span = { start: number; end: number; wrap: (s: string) => string };
  const spans: Span[] = [];

  for (const r of entityRanges ?? []) {
    const start = r.offset ?? 0;
    const end = start + (r.length ?? 0);
    if (end <= start || start >= text.length) continue;
    const entity = lookupEntity(entityMap, r.key ?? "");
    if (entity?.type === "LINK" && entity.data?.url) {
      const url = entity.data.url;
      spans.push({ start, end, wrap: (s) => `[${s}](${url})` });
    }
  }
  for (const r of styleRanges ?? []) {
    const start = r.offset ?? 0;
    const end = start + (r.length ?? 0);
    if (end <= start || start >= text.length || !r.style) continue;
    const style = r.style;
    spans.push({ start, end, wrap: (s) => applyStyle(s, style) });
  }

  spans.sort((a, b) => b.start - a.start || a.end - b.end);
  let out = text;
  for (const span of spans) {
    const inner = out.slice(span.start, span.end);
    if (!inner) continue;
    out = out.slice(0, span.start) + span.wrap(inner) + out.slice(span.end);
  }
  return out;
}

function resolveAtomic(
  block: XArticleBlock,
  entityMap: XArticleContent["entityMap"],
  media: readonly XArticleMedia[] | undefined,
  resolve?: ArticleImageResolver,
): string | undefined {
  const key = block.entityRanges?.[0]?.key;
  if (key === undefined) return undefined;
  const entity = lookupEntity(entityMap, key);
  if (!entity) return undefined;
  switch (entity.type) {
    case "MEDIA": {
      const mediaId = entity.data?.mediaItems?.[0]?.mediaId;
      const url = imageForMediaId(media, mediaId);
      return url ? embedImage(url, resolve) : undefined;
    }
    case "MARKDOWN":
      return entity.data?.markdown?.trim() || undefined;
    case "TWEET":
      return entity.data?.tweetId
        ? `[Tweet ↗](https://x.com/i/status/${entity.data.tweetId})`
        : undefined;
    case "LINK":
      return entity.data?.url ? `[${entity.data.url}](${entity.data.url})` : undefined;
    default:
      return undefined;
  }
}

function headingPrefix(type: string): string | undefined {
  if (type === "header-one") return "# ";
  if (type === "header-two") return "## ";
  if (type === "header-three") return "### ";
  return undefined;
}

function isListItem(type: string): "ul" | "ol" | undefined {
  if (type === "unordered-list-item") return "ul";
  if (type === "ordered-list-item") return "ol";
  return undefined;
}

/**
 * Cuerpo markdown del artículo, sin el H1 del título — eso lo pone quien
 * arma la nota (`renderNote` / `articleToMarkdown`) para no duplicarlo.
 */
export function xArticleToMarkdown(
  article: XArticle,
  resolve?: ArticleImageResolver,
): string {
  const blocks = article.content?.blocks ?? [];
  const entityMap = article.content?.entityMap;
  const media = article.media_entities;
  const parts: string[] = [];

  const cover = imageUrl(article.cover_media);
  if (cover) parts.push(embedImage(cover, resolve), "");

  let listKind: "ul" | "ol" | undefined;
  let listIndex = 0;
  const flushList = (): void => {
    listKind = undefined;
    listIndex = 0;
  };

  for (const block of blocks) {
    const type = block.type ?? "unstyled";
    const list = isListItem(type);
    if (!list && listKind) {
      flushList();
      parts.push("");
    }

    if (type === "atomic") {
      const resolved = resolveAtomic(block, entityMap, media, resolve);
      if (resolved) parts.push(resolved, "");
      continue;
    }

    const heading = headingPrefix(type);
    const raw = (block.text ?? "").replace(/\u00a0/g, " ");
    const decorated = decorateText(
      raw,
      block.entityRanges,
      block.inlineStyleRanges,
      entityMap,
    ).trim();

    if (heading) {
      if (decorated) parts.push(`${heading}${decorated}`, "");
      continue;
    }
    if (type === "blockquote") {
      if (decorated) parts.push(`> ${decorated.replace(/\n/g, "\n> ")}`, "");
      continue;
    }
    if (type === "code-block") {
      parts.push("```", raw.replace(/\n$/, ""), "```", "");
      continue;
    }
    if (list) {
      if (listKind !== list) {
        listKind = list;
        listIndex = 0;
      }
      listIndex++;
      const bullet = list === "ol" ? `${listIndex}.` : "-";
      parts.push(`${bullet} ${decorated || ""}`);
      continue;
    }

    if (decorated) parts.push(decorated, "");
  }

  return parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
