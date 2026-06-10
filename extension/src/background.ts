import {
  LIBRARY_URL,
  bookUrl,
  buildBookMarkdown,
  parseBookHighlights,
  parseLibrary,
  type KindleHighlight,
} from "../../src/kindle";
import {
  diffNewHighlights,
  highlightKey,
  uniqueHighlightKeys,
} from "../../src/kindle-merge";

const ALARM = "kindle-sync";
const SYNC_INTERVAL_MIN = 24 * 60;
const NEW_BOOK_DELAY_MS = 300;
// Re-checking known books hits Amazon once per book on every sync — be polite.
const KNOWN_BOOK_DELAY_MS = 1200;

interface StoredState {
  knownAsins?: string[];
  /** asin → highlight keys EVER delivered to the vault (MX12). Missing entry for a known asin = imported pre-MX12 → migration path. */
  bookStates?: Record<string, string[]>;
  lastSync?: string;
  lastError?: string;
  lastResult?: {
    written: number;
    failed: number;
    newHighlights?: number;
    mergedBooks?: number;
  };
}

async function getState(): Promise<StoredState> {
  return new Promise((resolve) =>
    chrome.storage.local.get(null, (s) => resolve(s as StoredState)),
  );
}

async function setState(patch: Partial<StoredState>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(patch, resolve));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: SYNC_INTERVAL_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    void syncOnce("alarm");
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "sync-now") {
    void syncOnce("manual").then((res) => sendResponse(res));
    return true;
  }
  if (msg && msg.type === "reset-known") {
    void setState({ knownAsins: [], bookStates: {}, lastSync: undefined }).then(
      () => sendResponse({ ok: true }),
    );
    return true;
  }
  return false;
});

async function fetchHtml(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const text = await res.text();
  return { status: res.status, text };
}

const parseDom = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon-128.png",
      title,
      message,
      priority: 0,
    });
  } catch {
    // notifications might be denied — continue silently
  }
}

async function ensureOffscreen(): Promise<void> {
  const ctxes = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  if (ctxes.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER" as chrome.offscreen.Reason, "BLOBS" as chrome.offscreen.Reason],
    justification: "File System Access API requires DOM context to write files to the vault",
  });
}

interface MergeRequest {
  slug: string;
  asin: string;
  /** Full rebuild used when the file was deleted from the vault. */
  fullContent: string;
  newHighlights: KindleHighlight[];
  highlightCount: number;
  deliveredKeys: string[];
}

interface MergeReply {
  results: Array<{ slug: string; ok: boolean; recreated: boolean; error?: string }>;
  fatal?: string;
}

interface VaultOutcome {
  written: number;
  mergeResults: MergeReply["results"];
  errors: string[];
}

async function applyToVault(
  files: { slug: string; content: string }[],
  merges: MergeRequest[],
): Promise<VaultOutcome> {
  await ensureOffscreen();
  try {
    let written = 0;
    const errors: string[] = [];
    if (files.length > 0) {
      const reply = (await chrome.runtime.sendMessage({
        type: "write-kindle-books",
        books: files,
      })) as { written: number; errors: string[]; error?: string } | undefined;
      if (!reply) errors.push("no-reply-from-offscreen");
      else if (reply.error) errors.push(reply.error);
      else {
        written = reply.written;
        errors.push(...reply.errors);
      }
    }
    let mergeResults: MergeReply["results"] = [];
    if (merges.length > 0) {
      const reply = (await chrome.runtime.sendMessage({
        type: "merge-kindle-books",
        books: merges.map(({ slug, fullContent, newHighlights, highlightCount }) => ({
          slug,
          fullContent,
          newHighlights,
          highlightCount,
        })),
      })) as MergeReply | undefined;
      if (!reply) errors.push("no-reply-from-offscreen");
      else if (reply.fatal) errors.push(reply.fatal);
      else {
        mergeResults = reply.results;
        errors.push(
          ...reply.results.filter((r) => !r.ok).map((r) => `${r.slug}: ${r.error ?? "write-failed"}`),
        );
      }
    }
    return { written, mergeResults, errors };
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // already closed
    }
  }
}

export type SyncTrigger = "manual" | "alarm" | "test";

export interface SyncResult {
  status: "ok" | "no-folder" | "session-expired" | "error";
  newBooks: number;
  totalBooks: number;
  written: number;
  mergedBooks: number;
  newHighlights: number;
  errors: string[];
}

export async function syncOnce(trigger: SyncTrigger): Promise<SyncResult> {
  const lib = await fetchHtml(LIBRARY_URL);
  if (lib.status !== 200) {
    await setState({ lastError: `library-http-${lib.status}` });
    await notify(
      "ReadQueue Kindle",
      `Sesión expirada o sin acceso (HTTP ${lib.status}). Abrí read.amazon.com/notebook en Chrome y volvé a intentar.`,
    );
    return {
      status: "session-expired",
      newBooks: 0,
      totalBooks: 0,
      written: 0,
      mergedBooks: 0,
      newHighlights: 0,
      errors: [`library-http-${lib.status}`],
    };
  }

  const books = parseLibrary(lib.text, parseDom);
  const state = await getState();
  const knownAsins = new Set(state.knownAsins ?? []);
  const bookStates: Record<string, string[]> = { ...(state.bookStates ?? {}) };
  const newBooks = books.filter((b) => !knownAsins.has(b.asin));
  const knownBooks = books.filter((b) => knownAsins.has(b.asin));

  const fetchErrors: string[] = [];

  // --- New books: full import ---
  const files: { slug: string; content: string; asin: string; keys: string[] }[] = [];
  for (const book of newBooks) {
    try {
      const detail = await fetchHtml(bookUrl(book.asin));
      if (detail.status !== 200) {
        fetchErrors.push(`${book.asin}: HTTP ${detail.status}`);
        continue;
      }
      const data = parseBookHighlights(detail.text, book, parseDom);
      const md = buildBookMarkdown(data, "otros");
      files.push({
        slug: md.slug,
        content: md.content,
        asin: book.asin,
        keys: uniqueHighlightKeys(data.highlights),
      });
      await sleep(NEW_BOOK_DELAY_MS);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fetchErrors.push(`${book.asin}: ${reason}`);
    }
  }

  // --- Known books: incremental re-sync (MX12) ---
  const merges: MergeRequest[] = [];
  for (const book of knownBooks) {
    try {
      const detail = await fetchHtml(bookUrl(book.asin));
      if (detail.status !== 200) {
        fetchErrors.push(`${book.asin}: HTTP ${detail.status}`);
        continue;
      }
      const data = parseBookHighlights(detail.text, book, parseDom);
      const delivered = bookStates[book.asin];
      if (!delivered) {
        // Migration: book imported pre-MX12. Mark what's scraped today as already
        // delivered WITHOUT touching the file — avoids duplicating everything.
        bookStates[book.asin] = uniqueHighlightKeys(data.highlights);
        continue;
      }
      const fresh = diffNewHighlights(data.highlights, delivered);
      if (fresh.length === 0) continue;
      const deliveredKeys = [...delivered, ...fresh.map(highlightKey)];
      const md = buildBookMarkdown(data, "otros");
      merges.push({
        slug: md.slug,
        asin: book.asin,
        fullContent: md.content,
        newHighlights: fresh,
        highlightCount: deliveredKeys.length,
        deliveredKeys,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fetchErrors.push(`${book.asin}: ${reason}`);
    } finally {
      await sleep(KNOWN_BOOK_DELAY_MS);
    }
  }

  if (files.length === 0 && merges.length === 0) {
    await setState({
      bookStates,
      lastSync: new Date().toISOString(),
      lastError: fetchErrors.length > 0 ? fetchErrors[0] : undefined,
    });
    if (trigger === "manual") {
      await notify("ReadQueue Kindle", "Sin novedades.");
    }
    return {
      status: fetchErrors.length > 0 && newBooks.length > 0 ? "error" : "ok",
      newBooks: newBooks.length,
      totalBooks: books.length,
      written: 0,
      mergedBooks: 0,
      newHighlights: 0,
      errors: fetchErrors,
    };
  }

  const outcome = await applyToVault(
    files.map(({ slug, content }) => ({ slug, content })),
    merges,
  );

  if (
    outcome.errors.includes("permission-denied") ||
    outcome.errors.includes("no-handle")
  ) {
    await setState({ lastError: outcome.errors[0] });
    await notify(
      "ReadQueue Kindle",
      "Carpeta no configurada o sin permiso. Abrí el popup y elegí la carpeta de la vault.",
    );
    return {
      status: "no-folder",
      newBooks: newBooks.length,
      totalBooks: books.length,
      written: 0,
      mergedBooks: 0,
      newHighlights: 0,
      errors: outcome.errors,
    };
  }

  // Track only the asins that actually got written
  const writtenFiles = files.slice(0, outcome.written);
  for (const f of writtenFiles) {
    knownAsins.add(f.asin);
    bookStates[f.asin] = f.keys;
  }

  let mergedBooks = 0;
  let newHighlights = 0;
  const mergeBySlug = new Map(merges.map((m) => [m.slug, m]));
  for (const result of outcome.mergeResults) {
    if (!result.ok) continue;
    const req = mergeBySlug.get(result.slug);
    if (!req) continue;
    bookStates[req.asin] = req.deliveredKeys;
    mergedBooks++;
    newHighlights += req.newHighlights.length;
  }

  const allErrors = [...fetchErrors, ...outcome.errors];
  await setState({
    knownAsins: [...knownAsins],
    bookStates,
    lastSync: new Date().toISOString(),
    lastError: allErrors.length > 0 ? allErrors[0] : undefined,
    lastResult: {
      written: outcome.written,
      failed: allErrors.length,
      newHighlights,
      mergedBooks,
    },
  });

  if (outcome.written > 0 || newHighlights > 0) {
    const parts: string[] = [];
    if (outcome.written > 0) parts.push(`${outcome.written} libros nuevos importados`);
    if (newHighlights > 0) {
      parts.push(
        `${newHighlights} highlights nuevos en ${mergedBooks} ${mergedBooks === 1 ? "libro" : "libros"}`,
      );
    }
    if (allErrors.length > 0) parts.push(`${allErrors.length} fallos`);
    await notify("ReadQueue Kindle", `${parts.join(" · ")}.`);
  } else if (allErrors.length > 0) {
    await notify("ReadQueue Kindle", "Ningún cambio pudo escribirse.");
  }

  return {
    status: "ok",
    newBooks: newBooks.length,
    totalBooks: books.length,
    written: outcome.written,
    mergedBooks,
    newHighlights,
    errors: allErrors,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
