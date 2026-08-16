import { describe, expect, it } from "vitest";

import { canonicalizeUrl } from "../src/url-canon";
import {
  allocateFilename,
  classify,
  displayTitle,
  externalUrls,
  itemKey,
  keyFromVaultUrl,
  looksTruncated,
  noteBasename,
  noteTitle,
  vaultUrlKeys,
  planSync,
  renderNote,
  replaceQuoteBlock,
  textWithoutLinks,
  triage,
  hasMediaBlocks,
  insertMediaBlocks,
  hasArticleBody,
  insertArticleBody,
  mediaAssetName,
  mediaAssets,
  mediaMarkdown,
  pickVideoVariant,
  type XItem,
  type XMedia,
} from "../src/x-sync";

const NOW = new Date("2026-08-01T12:00:00Z");
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86400000).toISOString();

function mk(over: Partial<XItem> = {}): XItem {
  return {
    id: "1",
    text: "hola",
    createdAt: daysAgo(1),
    authorHandle: "alguien",
    urls: [],
    media: [],
    collection: "bookmarks",
    ...over,
  };
}

/** Un video nativo con su thumbnail y una sola variante mp4. */
const video = (id = "9"): XMedia[] => [
  {
    type: "video",
    url: `https://pbs.twimg.com/amplify_video_thumb/${id}/img/t.jpg`,
    thumbnailUrl: `https://pbs.twimg.com/amplify_video_thumb/${id}/img/t.jpg`,
    variants: [
      { url: `https://video.twimg.com/amplify_video/${id}/vid/640x360/v.mp4`, contentType: "video/mp4", bitRate: 832000 },
    ],
  },
];

const photo = (name = "AAA"): XMedia[] => [
  { type: "image", url: `https://pbs.twimg.com/media/${name}.png` },
];

describe("externalUrls", () => {
  it("descarta los links internos de X (fotos, videos, quotes)", () => {
    const item = mk({
      urls: [
        "https://x.com/user/status/123/photo/1",
        "https://twitter.com/otro/status/456",
        "https://ssrn.com/abstract=123",
      ],
    });
    expect(externalUrls(item)).toEqual(["https://ssrn.com/abstract=123"]);
  });
});

describe("textWithoutLinks", () => {
  it("mide el texto propio, no el t.co", () => {
    // El caso real: "Link al paper: https://t.co/xxx" son 15 chars propios.
    expect(textWithoutLinks("Link al paper: https://t.co/KLxlljT37g")).toBe("Link al paper:");
  });
});

describe("classify", () => {
  it("papers académicos son lectura aunque el tweet tenga 15 caracteres", () => {
    // El error a evitar: filtrar por largo mandaría los 13 papers de Fede a la basura.
    const item = mk({
      text: "Link al paper: https://t.co/abc",
      urls: ["https://ssrn.com/abstract=1686004"],
    });
    expect(classify(item)).toBe("read");
  });

  it("un PDF suelto también es lectura", () => {
    expect(classify(mk({ urls: ["https://www.aqr.com/docs/hold-the-dip.pdf"] }))).toBe("read");
  });

  it("detecta video por media, por link interno y por dominio externo", () => {
    expect(classify(mk({ media: video() }))).toBe("watch");
    expect(classify(mk({ urls: ["https://x.com/u/status/1/video/1"] }))).toBe("watch");
    expect(classify(mk({ urls: ["https://youtu.be/abc"] }))).toBe("watch");
  });

  it("video gana sobre link externo cuando hay ambos", () => {
    const item = mk({ media: video(), urls: ["https://ssrn.com/abstract=1"] });
    expect(classify(item)).toBe("watch");
  });

  it("un X Article es lectura, no una auto-referencia a x.com", () => {
    // 92 casos reales quedaban como reference y sin link: el tweet solo dice
    // "https://t.co/xxx" y el artículo entero se perdía por filtrar por dominio.
    const item = mk({
      text: "https://t.co/GFF2O1PhOh",
      urls: ["http://x.com/i/article/2059643924369604611"],
    });
    expect(classify(item)).toBe("read");
    expect(externalUrls(item)).toEqual(["http://x.com/i/article/2059643924369604611"]);
  });

  it("un link a un status de X sigue siendo interno", () => {
    expect(externalUrls(mk({ urls: ["https://x.com/u/status/123"] }))).toEqual([]);
  });

  it("repos y tiendas son referencia, no lectura", () => {
    expect(classify(mk({ urls: ["https://github.com/foo/bar"] }))).toBe("reference");
  });

  it("un tweet largo sin links se sostiene solo", () => {
    expect(classify(mk({ text: "x".repeat(300) }))).toBe("read");
  });

  it("un t.co pelado sin link externo es referencia", () => {
    expect(classify(mk({ text: "https://t.co/abc123def", urls: ["https://x.com/u/status/9/photo/1"] })))
      .toBe("reference");
  });

  it("una reply con cuerpo cuenta como hilo legible", () => {
    expect(classify(mk({ text: "una respuesta con contenido real acá", replyToId: "99" })))
      .toBe("read");
  });
});

describe("triage", () => {
  it("manda a la cola lo reciente y legible", () => {
    const t = triage(mk({ urls: ["https://ssrn.com/abstract=1"], createdAt: daysAgo(10) }), { now: NOW });
    expect(t).toMatchObject({ kind: "read", destination: "queue" });
  });

  it("manda a legacy lo viejo aunque sea legible", () => {
    const t = triage(mk({ urls: ["https://ssrn.com/abstract=1"], createdAt: daysAgo(300) }), { now: NOW });
    expect(t.destination).toBe("legacy");
    expect(t.reason).toContain("300 días");
  });

  it("los likes nunca entran a la cola, ni recientes ni legibles", () => {
    const t = triage(
      mk({ collection: "likes", urls: ["https://ssrn.com/abstract=1"], createdAt: daysAgo(1) }),
      { now: NOW },
    );
    expect(t.destination).toBe("legacy");
    expect(t.reason).toBe("like");
  });

  it("la referencia va a legacy aunque sea de hoy", () => {
    const t = triage(mk({ urls: ["https://github.com/x/y"], createdAt: daysAgo(0) }), { now: NOW });
    expect(t.destination).toBe("legacy");
  });

  it("los tweets borrados no generan nota en la cola", () => {
    const t = triage(mk({ deleted: true, urls: ["https://ssrn.com/abstract=1"] }), { now: NOW });
    expect(t.destination).toBe("legacy");
    expect(t.reason).toBe("tweet borrado");
  });

  it("una fecha inválida no rompe: cae a legacy", () => {
    const t = triage(mk({ createdAt: "no-es-fecha", urls: ["https://ssrn.com/a"] }), { now: NOW });
    expect(t.destination).toBe("legacy");
  });
});

describe("itemKey", () => {
  it("un puntero se identifica por su destino, no por el tweet", () => {
    const a = mk({ id: "1", urls: ["https://ssrn.com/abstract=99"] });
    const b = mk({ id: "2", urls: ["https://ssrn.com/abstract=99?utm_source=x"] });
    expect(itemKey(a)).toBe(itemKey(b));
  });

  it("sin link externo cae al id del tweet", () => {
    expect(itemKey(mk({ id: "42" }))).toBe("tweet:42");
  });
});

describe("keyFromVaultUrl", () => {
  it("una nota de X ya escrita produce la misma clave que su tweet", () => {
    // Sin esto, el 91% del material de X (los que no llevan link externo) se
    // vuelve a escribir en cada sync: itemKey cae a tweet:<id> y el índice de
    // la vault solo tenía URLs canonicalizadas.
    const item = mk({ id: "1234567890" });
    expect(keyFromVaultUrl("https://x.com/alguien/status/1234567890")).toBe(itemKey(item));
  });

  it("acepta twitter.com y www, no solo x.com", () => {
    expect(keyFromVaultUrl("https://www.twitter.com/u/status/99")).toBe("tweet:99");
  });

  it("una URL que no es un tweet cae a la canonicalización de siempre", () => {
    const item = mk({ urls: ["https://ssrn.com/abstract=5?utm_source=x"] });
    expect(keyFromVaultUrl("https://ssrn.com/abstract=5")).toBe(itemKey(item));
  });
});

describe("noteBasename", () => {
  it("saca el punto inicial: si no, la nota entra oculta y Obsidian no la ve", () => {
    // Pasó de verdad en E2: 3 tweets que empezaban con ".@alguien" quedaron
    // invisibles en la vault y el dedupe los reescribió al sync siguiente.
    expect(noteBasename(".@Harvard after 12,000 protesters")).toBe(
      "@Harvard after 12,000 protesters",
    );
    expect(noteBasename("...pensándolo bien")).toBe("pensándolo bien");
  });

  it("saca las URLs y los caracteres que no van en un nombre de archivo", () => {
    expect(noteBasename('mirá esto: https://t.co/abc "raro" a/b')).toBe("mirá esto raro a b");
  });

  it("un tweet que es solo un link no queda sin nombre", () => {
    expect(noteBasename("https://t.co/abc123")).toBe("sin-titulo");
    expect(noteBasename("   ")).toBe("sin-titulo");
  });

  it("corta a 70 y no deja el espacio del corte colgando", () => {
    const name = noteBasename(`${"a".repeat(69)} bbbb`);
    expect(name).toBe("a".repeat(69));
  });
});

describe("vaultUrlKeys", () => {
  it("indexa el tweet por sus dos formas, así el sync no oscila", () => {
    // El caso real: una nota vieja guardada con `url: <tweet>` frente a un ítem
    // que ahora resuelve a un X Article. Con una sola forma no matchean, el
    // sync escribe el duplicado y el dedupe del plugin lo borra — en loop.
    const keys = vaultUrlKeys("https://x.com/alguien/status/123");
    expect(keys).toContain("tweet:123");
    expect(keys).toContain(canonicalizeUrl("https://x.com/alguien/status/123"));
  });

  it("una URL común tiene una sola forma", () => {
    expect(vaultUrlKeys("https://ssrn.com/abstract=1")).toHaveLength(1);
  });

  it("el permalink /handle/article/<statusId> indexa como el tweet", () => {
    const keys = vaultUrlKeys("https://x.com/eric/article/2087566447178547494");
    expect(keys).toContain("tweet:2087566447178547494");
  });
});

describe("noteTitle", () => {
  it("un tweet sin texto propio no se llama 'sin-titulo'", () => {
    expect(noteTitle(mk({ text: "https://t.co/a", urls: ["http://x.com/i/article/9"] })))
      .toBe("Artículo de @alguien");
    expect(noteTitle(mk({ text: "https://t.co/a", urls: ["https://ssrn.com/a"] })))
      .toBe("Link de @alguien");
    expect(noteTitle(mk({ text: "https://t.co/a", media: video() })))
      .toBe("Video de @alguien");
    expect(noteTitle(mk({ text: "https://t.co/a" }))).toBe("Post de @alguien");
  });

  it("cuando hay texto, el texto manda", () => {
    expect(noteTitle(mk({ text: "una idea concreta" }))).toBe("una idea concreta");
  });
});

describe("allocateFilename", () => {
  it("colisiones sucesivas del mismo nombre no se pisan", () => {
    const used = new Set<string>();
    expect(allocateFilename("nota", used, "aaa")).toBe("nota");
    expect(allocateFilename("nota", used, "bbb")).toBe("nota (bbb)");
    expect(allocateFilename("nota", used, "ccc")).toBe("nota (ccc)");
  });

  it("dos tweets con el mismo id corto no comparten archivo", () => {
    const used = new Set<string>();
    allocateFilename("nota", used, "aaa");
    expect(allocateFilename("nota", used, "aaa")).toBe("nota (aaa)");
    expect(allocateFilename("nota", used, "aaa")).toBe("nota (aaa-2)");
  });

  it("trata como colisión lo que macOS colapsa: mayúsculas y forma unicode", () => {
    // El primer E2 escribió 537 notas y dejó 534 archivos por exactamente esto.
    const used = new Set<string>();
    expect(allocateFilename("Café", used, "aaa")).toBe("Café");
    expect(allocateFilename("café", used, "bbb")).toBe("café (bbb)");
    expect(allocateFilename("Café", used, "ccc")).toBe("Café (ccc)");
  });

  it("respeta los nombres que ya estaban en disco", () => {
    const used = new Set(["nota"]);
    expect(allocateFilename("nota", used, "aaa")).toBe("nota (aaa)");
  });
});

describe("planSync", () => {
  it("saltea lo que ya está en la vault", () => {
    const item = mk({ urls: ["https://ssrn.com/abstract=99"] });
    const plan = planSync([item], new Set([itemKey(item)]), { now: NOW });
    expect(plan.duplicates).toBe(1);
    expect(plan.items).toHaveLength(0);
  });

  it("deduplica dentro del propio lote", () => {
    const a = mk({ id: "1", urls: ["https://ssrn.com/abstract=99"] });
    const b = mk({ id: "2", urls: ["https://ssrn.com/abstract=99"] });
    const plan = planSync([a, b], new Set(), { now: NOW });
    expect(plan.duplicates).toBe(1);
    expect(plan.items).toHaveLength(1);
  });

  it("cuenta por tipo y destino", () => {
    const plan = planSync(
      [
        mk({ id: "1", urls: ["https://ssrn.com/abstract=1"], createdAt: daysAgo(5) }),
        mk({ id: "2", media: video(), createdAt: daysAgo(5) }),
        mk({ id: "3", urls: ["https://github.com/a/b"], createdAt: daysAgo(5) }),
        mk({ id: "4", urls: ["https://ssrn.com/abstract=4"], createdAt: daysAgo(400) }),
      ],
      new Set(),
      { now: NOW },
    );
    expect(plan.byKind).toEqual({ read: 2, watch: 1, reference: 1 });
    expect(plan.toQueue).toBe(2);
    expect(plan.toLegacy).toBe(2);
  });

  it("un artículo ya clippeado por Web Clipper no se vuelve a escribir", () => {
    // El caso real: la nota vieja se guardó con la URL del tweet, pero el ítem
    // ahora se identifica por la URL del X Article. Sin chequear las dos
    // identidades el sync entra en loop con el dedupe del plugin.
    const item = mk({ id: "777", urls: ["http://x.com/i/article/999"] });
    const plan = planSync([item], new Set(["tweet:777"]), { now: NOW });
    expect(plan.duplicates).toBe(1);
    expect(plan.items).toHaveLength(0);
  });

  it("no explota con lote vacío", () => {
    expect(planSync([], new Set(), { now: NOW }).items).toHaveLength(0);
  });
});

describe("renderNote", () => {
  const opts = { webFolder: "Inbox/Web/", legacyFolder: "Inbox/Legacy/", now: NOW };

  it("lo que va a la cola lleva status; lo de legacy no", () => {
    const a = mk({ urls: ["https://ssrn.com/abstract=1"], createdAt: daysAgo(5) });
    const enCola = renderNote(a, triage(a, { now: NOW }), opts);
    expect(enCola.frontmatter["status"]).toBe("unread");
    expect(enCola.folder).toBe("Inbox/Web/");

    const b = mk({ collection: "likes" });
    const enLegacy = renderNote(b, triage(b, { now: NOW }), opts);
    expect(enLegacy.frontmatter["status"]).toBeUndefined();
    expect(enLegacy.folder).toBe("Inbox/Legacy/");
  });

  it("distingue el origen por source y guarda el link como targetUrl", () => {
    const a = mk({ urls: ["https://ssrn.com/abstract=1"] });
    const n = renderNote(a, triage(a, { now: NOW }), opts);
    expect(n.frontmatter["source"]).toBe("x-bookmark");
    expect(n.frontmatter["targetUrl"]).toBe("https://ssrn.com/abstract=1");

    const like = mk({ collection: "likes" });
    expect(renderNote(like, triage(like, { now: NOW }), opts).frontmatter["source"]).toBe("x-like");
  });

  it("cita el tweet como blockquote, incluso multilínea", () => {
    const a = mk({ text: "uno\ndos" });
    const n = renderNote(a, triage(a, { now: NOW }), opts);
    expect(n.body).toContain("> uno\n> dos");
    expect(n.body).toContain("https://x.com/alguien/status/1");
  });

  it("embebe la imagen local cuando se pudo bajar", () => {
    // El bug que arregla: 277 de 519 notas de X quedaron sin sus imágenes
    // porque el sync guardaba el `type` de cada media y tiraba la URL.
    const a = mk({ media: photo() });
    const n = renderNote(a, triage(a, { now: NOW }), {
      ...opts,
      resolveMedia: (asset) => asset.filename,
    });
    expect(n.body).toContain("![[1-1.png]]");
  });

  it("cae al link del CDN cuando la descarga falló", () => {
    const a = mk({ media: photo() });
    const n = renderNote(a, triage(a, { now: NOW }), { ...opts, resolveMedia: () => undefined });
    expect(n.body).toContain("![](https://pbs.twimg.com/media/AAA.png)");
  });

  it("las imágenes van después de la atribución y antes de los links", () => {
    const a = mk({ media: photo(), urls: ["https://ssrn.com/abstract=1"] });
    const n = renderNote(a, triage(a, { now: NOW }), {
      ...opts,
      resolveMedia: (asset) => asset.filename,
    });
    expect(n.body.indexOf("— [@alguien]")).toBeLessThan(n.body.indexOf("![["));
    expect(n.body.indexOf("![[")).toBeLessThan(n.body.indexOf("## Links"));
  });
});

describe("media", () => {
  it("elige el mejor mp4 que no castigue la conexión del celular", () => {
    const variants = [
      { url: "a.mp4", contentType: "video/mp4", bitRate: 10_368_000 },
      { url: "b.mp4", contentType: "video/mp4", bitRate: 2_176_000 },
      { url: "c.mp4", contentType: "video/mp4", bitRate: 832_000 },
    ];
    expect(pickVideoVariant(variants)?.url).toBe("b.mp4");
  });

  it("si todas superan el techo se queda con la más liviana", () => {
    const variants = [
      { url: "a.mp4", contentType: "video/mp4", bitRate: 10_000_000 },
      { url: "b.mp4", contentType: "video/mp4", bitRate: 8_000_000 },
    ];
    expect(pickVideoVariant(variants)?.url).toBe("b.mp4");
  });

  it("ignora lo que no sea mp4 y tolera la ausencia de variantes", () => {
    expect(pickVideoVariant([{ url: "a.m3u8", contentType: "application/x-mpegURL" }])).toBeUndefined();
    expect(pickVideoVariant(undefined)).toBeUndefined();
  });

  it("saca la extensión del query param, no solo del path", () => {
    // pbs.twimg.com sirve `…/Foo?format=jpg&name=large`: sin esto la vault se
    // llena de archivos sin extensión que Obsidian no sabe mostrar.
    expect(mediaAssetName("55", 0, "https://pbs.twimg.com/media/Foo?format=jpg&name=large"))
      .toBe("55-1.jpg");
    expect(mediaAssetName("55", 1, "https://pbs.twimg.com/media/Bar.png")).toBe("55-2.png");
  });

  it("el nombre es estable: correr el sync dos veces no duplica archivos", () => {
    const item = mk({ id: "77", media: photo() });
    expect(mediaAssets(item)).toEqual(mediaAssets(item));
    expect(mediaAssets(item)[0]?.filename).toBe("77-1.png");
  });

  it("de un video baja el thumbnail y linkea el mp4", () => {
    const blocks = mediaMarkdown(mk({ media: video() }), (a) => a.filename);
    expect(blocks[0]).toContain("[Video ↗](https://video.twimg.com/amplify_video/9/vid/640x360/v.mp4)");
    expect(blocks[0]).toContain("![[1-1.jpg]]");
  });
});

describe("insertMediaBlocks", () => {
  const body = ["> el tweet", "", "— [@alguien](https://x.com/alguien/status/1)"].join("\n");

  it("mete la imagen después de la atribución", () => {
    const out = insertMediaBlocks(body, ["![[1-1.png]]"]);
    expect(out).toBe(`${body}\n\n![[1-1.png]]`);
  });

  it("respeta el orden: antes de los links, después de la atribución", () => {
    const conLinks = `${body}\n\n## Links\n\n- https://ssrn.com/a`;
    const out = insertMediaBlocks(conLinks, ["![[1-1.png]]"]);
    expect(out.indexOf("— [@alguien]")).toBeLessThan(out.indexOf("![["));
    expect(out.indexOf("![[")).toBeLessThan(out.indexOf("## Links"));
  });

  it("es idempotente: correr el backfill dos veces no duplica la imagen", () => {
    const once = insertMediaBlocks(body, ["![[1-1.png]]"]);
    expect(insertMediaBlocks(once, ["![[1-1.png]]"])).toBe(once);
  });

  it("un `![](…)` dentro de la cita no cuenta como imagen ya embebida", () => {
    // Si contara, esa nota nunca recibiría su imagen real.
    const citado = "> mirá esto ![](https://ejemplo.com/x.png)\n\n— [@alguien](https://x.com/a/status/1)";
    expect(hasMediaBlocks(citado)).toBe(false);
    expect(insertMediaBlocks(citado, ["![[1-1.png]]"])).toContain("![[1-1.png]]");
  });

  it("sin bloques no toca nada", () => {
    expect(insertMediaBlocks(body, [])).toBe(body);
  });
});

describe("looksTruncated", () => {
  const largo = "x".repeat(260);

  it("un texto largo que termina en un t.co de su propia foto huele a cortado", () => {
    // El caso medido: 293 caracteres guardados contra 3.247 reales.
    expect(
      looksTruncated({
        text: `${largo} https://t.co/abc`,
        urls: ["https://x.com/u/status/1/photo/1"],
      }),
    ).toBe(true);
  });

  it("un tweet corto no puede estar cortado en 280", () => {
    expect(looksTruncated({ text: "corto https://t.co/abc", urls: [] })).toBe(false);
  });

  it("sin t.co al final no hay nada que sospechar", () => {
    expect(looksTruncated({ text: largo, urls: [] })).toBe(false);
  });

  it("un t.co en el medio no cuenta: el corte va siempre al final", () => {
    expect(looksTruncated({ text: `${largo} https://t.co/abc y sigue`, urls: [] })).toBe(false);
  });
});

describe("replaceQuoteBlock", () => {
  const body = `> uno
> dos

— [@alguien](https://x.com/alguien/status/1)

## Links

- https://ejemplo.com
`;

  it("reemplaza la cita y no toca lo de abajo", () => {
    const next = replaceQuoteBlock(body, "texto completo\ncon dos líneas");
    expect(next).toContain("> texto completo\n> con dos líneas");
    expect(next).not.toContain("> uno");
    expect(next).toContain("— [@alguien](https://x.com/alguien/status/1)");
    expect(next).toContain("- https://ejemplo.com");
  });

  it("las líneas vacías del tweet quedan como cita, no cortan el bloque", () => {
    const next = replaceQuoteBlock(body, "primer párrafo\n\nsegundo párrafo");
    expect(next).toContain("> primer párrafo\n>\n> segundo párrafo");
  });

  it("un cuerpo sin cita queda igual", () => {
    expect(replaceQuoteBlock("sin blockquote\n", "nuevo")).toBe("sin blockquote\n");
  });
});

describe("displayTitle", () => {
  it("la primera línea de un post largo suele ser el titular", () => {
    const item = mk({
      text: "how I’m building an agent company inside my agency.\n\nthe structure looks like this:\n\nAgency gBrain\n→ Orchestrator",
    });
    expect(displayTitle(item)).toBe("how I’m building an agent company inside my agency.");
  });

  it("una primera línea larguísima cae al nombre corto", () => {
    const item = mk({ text: `${"x".repeat(200)}\n\nsigue` });
    expect(displayTitle(item)).toBe(noteTitle(item));
  });

  it("una primera línea de dos palabras no sirve de título", () => {
    const item = mk({ text: "mirá\n\nesto es el contenido de verdad del post" });
    expect(displayTitle(item)).toBe(noteTitle(item));
  });

  it("una línea que termina en `:` es el pie de una lista, no un título", () => {
    // Caso real: "Andrew Ng:" seguido del contenido. Usarlo sería peor que el
    // nombre de archivo cortado que reemplaza.
    const item = mk({ text: "Andrew Ng dijo lo siguiente:\n\n100% of my tasks are now done by AI" });
    expect(displayTitle(item)).toBe(noteTitle(item));
  });

  it("un tweet sin texto propio usa el nombre por tipo", () => {
    const item = mk({ text: "https://t.co/abc", urls: ["http://x.com/i/article/9"] });
    expect(displayTitle(item)).toBe("Artículo de @alguien");
  });
});

describe("renderNote — X Article", () => {
  const opts = { webFolder: "Inbox/Web/", legacyFolder: "Inbox/Legacy/", now: NOW };
  const article = {
    title: "Grok 4.6 – A field guide",
    markdown: "## Information dense communication\n\nIt's collaborative.",
  };

  it("el título de la nota es el del artículo, no el del anuncio", () => {
    const item = mk({
      text: "grok 4.6 is live! https://t.co/abc",
      urls: ["http://x.com/i/article/9"],
    });
    const n = renderNote(item, triage(item, { now: NOW }), { ...opts, article });
    expect(n.frontmatter["title"]).toBe("Grok 4.6 – A field guide");
    expect(n.body).toContain("# Grok 4.6 – A field guide");
    expect(n.body).toContain("## Information dense communication");
    expect(n.body.indexOf("# Grok")).toBeLessThan(n.body.indexOf("## Links"));
  });

  it("sin artículo sigue siendo el anuncio más el link", () => {
    const item = mk({
      text: "grok 4.6 is live!",
      urls: ["http://x.com/i/article/9"],
    });
    const n = renderNote(item, triage(item, { now: NOW }), opts);
    expect(n.body).not.toContain("# Grok");
    expect(n.body).toContain("## Links");
  });
});

describe("insertArticleBody", () => {
  const body = [
    "> grok 4.6 is live! https://t.co/abc",
    "",
    "— [@alguien](https://x.com/alguien/status/1)",
    "",
    "## Links",
    "",
    "- http://x.com/i/article/9",
  ].join("\n");
  const block = "# Grok 4.6 – A field guide\n\nIt's collaborative.";

  it("mete el artículo antes de ## Links", () => {
    const out = insertArticleBody(body, block);
    expect(out).toContain("# Grok 4.6 – A field guide");
    expect(out.indexOf("# Grok")).toBeGreaterThan(out.indexOf("— [@alguien]"));
    expect(out.indexOf("# Grok")).toBeLessThan(out.indexOf("## Links"));
  });

  it("es idempotente", () => {
    const once = insertArticleBody(body, block);
    expect(insertArticleBody(once, block)).toBe(once);
  });

  it("un H1 dentro de la cita no cuenta como cuerpo ya insertado", () => {
    const citado = "> # no es el artículo\n\n— [@alguien](https://x.com/a/status/1)";
    expect(hasArticleBody(citado)).toBe(false);
    expect(insertArticleBody(citado, block)).toContain("# Grok 4.6");
  });

  it("## Links no cuenta como cuerpo del artículo", () => {
    expect(hasArticleBody(body)).toBe(false);
  });

  it("markdown vacío no toca la nota", () => {
    expect(insertArticleBody(body, "  ")).toBe(body);
  });
});
