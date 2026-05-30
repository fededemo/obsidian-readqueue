import {
  LIBRARY_URL,
  bookUrl,
  buildBookMarkdown,
  parseBookHighlights,
  parseLibrary,
  type KindleBook,
} from "../../src/kindle";

const ALARM = "kindle-sync";
const SYNC_INTERVAL_MIN = 24 * 60;

interface StoredState {
  knownAsins?: string[];
  lastSync?: string;
  lastError?: string;
  lastResult?: { written: number; failed: number };
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
    void setState({ knownAsins: [], lastSync: undefined }).then(() =>
      sendResponse({ ok: true }),
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

async function writeBooks(
  files: { slug: string; content: string }[],
): Promise<{ written: number; errors: string[] }> {
  await ensureOffscreen();
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: "write-kindle-books",
      books: files,
    })) as { written: number; errors: string[]; error?: string } | undefined;
    if (!reply) return { written: 0, errors: ["no-reply-from-offscreen"] };
    if (reply.error) return { written: 0, errors: [reply.error] };
    return { written: reply.written, errors: reply.errors };
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
      errors: [`library-http-${lib.status}`],
    };
  }

  const books = parseLibrary(lib.text, parseDom);
  const state = await getState();
  const knownAsins = new Set(state.knownAsins ?? []);
  const newBooks = books.filter((b) => !knownAsins.has(b.asin));

  if (newBooks.length === 0) {
    await setState({ lastSync: new Date().toISOString(), lastError: undefined });
    if (trigger === "manual") {
      await notify("ReadQueue Kindle", "Sin libros nuevos.");
    }
    return {
      status: "ok",
      newBooks: 0,
      totalBooks: books.length,
      written: 0,
      errors: [],
    };
  }

  const files: { slug: string; content: string; asin: string }[] = [];
  const fetchErrors: string[] = [];
  for (const book of newBooks) {
    try {
      const detail = await fetchHtml(bookUrl(book.asin));
      if (detail.status !== 200) {
        fetchErrors.push(`${book.asin}: HTTP ${detail.status}`);
        continue;
      }
      const data = parseBookHighlights(detail.text, book, parseDom);
      const md = buildBookMarkdown(data, "otros");
      files.push({ slug: md.slug, content: md.content, asin: book.asin });
      await sleep(300);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fetchErrors.push(`${book.asin}: ${reason}`);
    }
  }

  if (files.length === 0) {
    await setState({
      lastError: fetchErrors[0] ?? "all-fetches-failed",
      lastSync: new Date().toISOString(),
    });
    await notify("ReadQueue Kindle", "Ningún libro nuevo pudo descargarse.");
    return {
      status: "error",
      newBooks: newBooks.length,
      totalBooks: books.length,
      written: 0,
      errors: fetchErrors,
    };
  }

  const writeOutcome = await writeBooks(
    files.map(({ slug, content }) => ({ slug, content })),
  );

  if (writeOutcome.errors.includes("permission-denied") || writeOutcome.errors.includes("no-handle")) {
    await setState({ lastError: writeOutcome.errors[0] });
    await notify(
      "ReadQueue Kindle",
      "Carpeta no configurada o sin permiso. Abrí el popup y elegí la carpeta de la vault.",
    );
    return {
      status: "no-folder",
      newBooks: newBooks.length,
      totalBooks: books.length,
      written: 0,
      errors: writeOutcome.errors,
    };
  }

  // Track only the asins that actually got written
  const writtenSlugs = new Set(
    files.slice(0, writeOutcome.written).map((f) => f.asin),
  );
  await setState({
    knownAsins: [...knownAsins, ...writtenSlugs],
    lastSync: new Date().toISOString(),
    lastError: writeOutcome.errors.length > 0 ? writeOutcome.errors[0] : undefined,
    lastResult: { written: writeOutcome.written, failed: writeOutcome.errors.length },
  });

  await notify(
    "ReadQueue Kindle",
    `${writeOutcome.written} libros nuevos importados${
      writeOutcome.errors.length > 0
        ? ` (${writeOutcome.errors.length} fallos)`
        : ""
    }.`,
  );

  return {
    status: "ok",
    newBooks: newBooks.length,
    totalBooks: books.length,
    written: writeOutcome.written,
    errors: [...fetchErrors, ...writeOutcome.errors],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
