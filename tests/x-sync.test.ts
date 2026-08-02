import { describe, expect, it } from "vitest";

import { canonicalizeUrl } from "../src/url-canon";
import {
  allocateFilename,
  classify,
  externalUrls,
  itemKey,
  keyFromVaultUrl,
  noteBasename,
  noteTitle,
  vaultUrlKeys,
  planSync,
  renderNote,
  textWithoutLinks,
  triage,
  type XItem,
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
    mediaTypes: [],
    collection: "bookmarks",
    ...over,
  };
}

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
    expect(classify(mk({ mediaTypes: ["video"] }))).toBe("watch");
    expect(classify(mk({ urls: ["https://x.com/u/status/1/video/1"] }))).toBe("watch");
    expect(classify(mk({ urls: ["https://youtu.be/abc"] }))).toBe("watch");
  });

  it("video gana sobre link externo cuando hay ambos", () => {
    const item = mk({ mediaTypes: ["video"], urls: ["https://ssrn.com/abstract=1"] });
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
});

describe("noteTitle", () => {
  it("un tweet sin texto propio no se llama 'sin-titulo'", () => {
    expect(noteTitle(mk({ text: "https://t.co/a", urls: ["http://x.com/i/article/9"] })))
      .toBe("Artículo de @alguien");
    expect(noteTitle(mk({ text: "https://t.co/a", urls: ["https://ssrn.com/a"] })))
      .toBe("Link de @alguien");
    expect(noteTitle(mk({ text: "https://t.co/a", mediaTypes: ["video"] })))
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
        mk({ id: "2", mediaTypes: ["video"], createdAt: daysAgo(5) }),
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
});
