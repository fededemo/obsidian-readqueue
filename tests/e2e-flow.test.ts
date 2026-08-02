import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

import { processPending, type IntakeDeps } from "../src/intake";
import {
  articleFromFile,
  filterByStatus,
  sourceCategory,
  type ReadFrontmatter,
} from "../src/queue-data";
import { rankQueue } from "../src/priority";

/**
 * El hilo completo: guardar una URL → intake → aparece en la cola → se lee.
 *
 * Los 650 tests unitarios cubren cada módulo por separado, y por eso mismo no
 * cubren lo que los une: **que lo que el intake escribe sea lo que la cola sabe
 * leer**. Un cambio de nombre de campo o de formato del frontmatter rompe la
 * cola en silencio con toda la suite en verde.
 *
 * No es hipotético: durante el pase de X un script reensambló el frontmatter
 * perdiendo el salto de línea que va después del `---` de apertura, y Obsidian
 * dejó de reconocer el bloque entero en 446 notas. Nada lo detectó.
 */

const pendingFile = (basename: string): TFile =>
  ({ basename, path: `Inbox/Pending/${basename}.md` }) as unknown as TFile;

const webFile = (basename: string): TFile =>
  ({
    basename,
    path: `Inbox/Web/${basename}.md`,
    stat: { size: 4200, ctime: 0, mtime: 0 },
  }) as unknown as TFile;

/** Serializador con la forma que emite Obsidian: escalares planos, listas `[a, b]`. */
const realisticYaml = (value: unknown): string =>
  Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
      const s = String(v);
      return /[:#]/.test(s) ? `${k}: "${s.replace(/"/g, '\\"')}"` : `${k}: ${s}`;
    })
    .join("\n");

const htmlToMd = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Parser mínimo del frontmatter, con la misma forma que devuelve el
 * metadataCache de Obsidian. Solo entiende lo que el intake emite — si el
 * intake empieza a emitir otra cosa, este parser no la entiende y el test falla,
 * que es exactamente lo que se quiere detectar.
 */
function parseFrontmatter(md: string): Record<string, unknown> {
  const end = md.indexOf("\n---", 3);
  const fm: Record<string, unknown> = {};
  for (const line of md.slice(4, end).split("\n")) {
    const m = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = (m[2] ?? "").trim();
    const key = m[1] as string;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      fm[key] = raw
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    } else {
      fm[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return fm;
}

function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    app: {
      vault: { read: vi.fn(), create: vi.fn(), delete: vi.fn() },
      fileManager: {
        processFrontMatter: vi.fn(
          async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
            fn({});
          },
        ),
      },
    } as unknown as App,
    pendingFolder: "Inbox/Pending/",
    webFolder: "Inbox/Web/",
    htmlToMarkdown: htmlToMd,
    yamlStringify: realisticYaml,
    parseDom: (html: string) => new DOMParser().parseFromString(html, "text/html"),
    fetchUrl: async () => ({
      status: 200,
      text: readFileSync(join(__dirname, "fixtures", "blog-article.html"), "utf-8"),
    }),
    now: () => new Date("2026-05-30T12:00:00Z"),
    ...overrides,
  };
}

/** Corre el intake y devuelve el markdown que quedó escrito en la vault. */
async function runIntake(pendingBody: string, overrides: Partial<IntakeDeps> = {}) {
  const deps = makeDeps(overrides);
  const f = pendingFile("pending-1");
  (deps.app.vault.read as ReturnType<typeof vi.fn>).mockResolvedValue(pendingBody);
  const outcome = await processPending(f, deps);
  const create = deps.app.vault.create as ReturnType<typeof vi.fn>;
  const [path, markdown] = (create.mock.calls[0] ?? []) as [string, string];
  return { outcome, path, markdown, deps };
}

const WEB_PENDING = "---\nurl: https://example.com/post\n---\n";

describe("E2E — guardar una URL termina en la cola (B-101)", () => {
  it("el intake escribe y la cola lo lee como no leído", async () => {
    const { outcome, path, markdown } = await runIntake(WEB_PENDING);
    expect(outcome.ok).toBe(true);
    expect(path).toMatch(/^Inbox\/Web\/.+\.md$/);

    const fm = parseFrontmatter(markdown) as ReadFrontmatter;
    const article = articleFromFile(webFile("nota"), fm);

    expect(article.url).toBe("https://example.com/post");
    expect(article.status).toBe("unread");
    expect(filterByStatus([article], "unread")).toHaveLength(1);
  });

  it("el frontmatter que escribe es el que Obsidian sabe parsear", async () => {
    // El bug real: `---source: x` en una línea. Obsidian deja de reconocer el
    // bloque entero y la nota pierde source, topic y tags de una sola vez.
    const { markdown } = await runIntake(WEB_PENDING);
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toMatch(/\n---\n/);
    expect(markdown).not.toMatch(/^---\S/m);

    const end = markdown.indexOf("\n---", 3);
    for (const line of markdown.slice(4, end).split("\n")) {
      if (!line.trim()) continue;
      expect(line).toMatch(/^[a-zA-Z][\w-]*:/);
      expect(line).not.toContain("\t");
    }
  });

  it("la nota escrita es rankeable: la cola puede ordenarla", async () => {
    const { markdown } = await runIntake(WEB_PENDING);
    const article = articleFromFile(
      webFile("nota"),
      parseFrontmatter(markdown) as ReadFrontmatter,
    );
    const ranked = rankQueue([article], { read: [], now: new Date("2026-06-01T00:00:00Z") });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.reason).toBeTruthy();
    expect(Number.isFinite(ranked[0]?.score ?? NaN)).toBe(true);
  });

  it("un tweet guardado desde la app entra por el mismo hilo", async () => {
    const tweet = JSON.parse(
      readFileSync(join(__dirname, "fixtures", "tweet-fxtwitter.json"), "utf-8"),
    ) as unknown;
    const { outcome, markdown } = await runIntake(
      "---\nurl: https://x.com/alguien/status/123\n---\n",
      { fetchUrl: async () => ({ status: 200, text: JSON.stringify(tweet) }) },
    );
    expect(outcome.ok).toBe(true);

    const article = articleFromFile(
      webFile("tweet"),
      parseFrontmatter(markdown) as ReadFrontmatter,
    );
    expect(article.status).toBe("unread");
    // El filtro por fuente de la vista tiene que saber de dónde vino.
    expect(sourceCategory(article)).toBe("x");
  });

  it("marcar como leído la saca de la cola", async () => {
    const { markdown } = await runIntake(WEB_PENDING);
    const fm = parseFrontmatter(markdown) as ReadFrontmatter;
    const read = articleFromFile(webFile("nota"), { ...fm, status: "read" });
    expect(filterByStatus([read], "unread")).toHaveLength(0);
    expect(filterByStatus([read], "read")).toHaveLength(1);
  });
});
