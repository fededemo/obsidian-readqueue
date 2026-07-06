import {
  LIBRARY_URL,
  bookUrl,
  type KindleBook,
  type KindleHighlight,
} from "../../src/kindle";
import {
  mergeDeliveredState,
  planLibrarySync,
  type DeliveredByAsin,
  type MergeRequest,
  type ScrapedBook,
} from "../../src/kindle-sync-plan";

const ALARM = "kindle-sync";
const SYNC_INTERVAL_MIN = 24 * 60;
// One Amazon request per book on every sync — be polite.
const BOOK_DELAY_MS = 800;

interface StoredState {
  knownAsins?: string[];
  /** asin → highlight keys EVER delivered (cache of the vault sidecar, MX22-b). */
  bookStates?: DeliveredByAsin;
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
    void resetKnown().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

/**
 * "Reset libros": forget all delivered-key state (cache + vault sidecar) and
 * re-scan from scratch. Non-destructive thanks to MX22-b — the next sync
 * re-adopts existing notes via `init-state` (never rewriting the user's edits)
 * and only recreates notes that were actually deleted from the vault.
 */
async function resetKnown(): Promise<void> {
  await setState({ knownAsins: [], bookStates: {}, lastSync: undefined });
  await ensureOffscreen();
  try {
    await sendToOffscreen({ type: "write-sync-state", delivered: {} });
  } catch {
    // No folder/permission yet — the empty cache alone still resets state.
  } finally {
    await closeOffscreen();
  }
}

async function fetchHtml(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const text = await res.text();
  return { status: res.status, text };
}

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
    reasons: [
      "DOM_PARSER" as chrome.offscreen.Reason,
      "BLOBS" as chrome.offscreen.Reason,
    ],
    justification:
      "Parse Amazon HTML (DOMParser) and write files to the vault (File System Access) — neither exists in the MV3 service worker.",
  });
}

async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // already closed
  }
}

async function sendToOffscreen<T>(msg: Record<string, unknown>): Promise<T> {
  return (await chrome.runtime.sendMessage(msg)) as T;
}

// --- Offscreen-delegated parsing (MX22-a: no DOMParser in the SW) ---

async function parseLibraryViaOffscreen(html: string): Promise<KindleBook[]> {
  const reply = await sendToOffscreen<{ books?: KindleBook[] }>({
    type: "parse-library",
    html,
  });
  return reply?.books ?? [];
}

async function parseBookViaOffscreen(
  html: string,
  book: KindleBook,
): Promise<KindleHighlight[]> {
  const reply = await sendToOffscreen<{ highlights?: KindleHighlight[] }>({
    type: "parse-book",
    html,
    book,
  });
  return reply?.highlights ?? [];
}

interface VaultStateReply {
  delivered: DeliveredByAsin;
  existingSlugs: string[];
  error?: string;
}

interface MergeReply {
  results: Array<{ slug: string; ok: boolean; recreated: boolean; error?: string }>;
  fatal?: string;
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

function emptyResult(status: SyncResult["status"], errors: string[]): SyncResult {
  return {
    status,
    newBooks: 0,
    totalBooks: 0,
    written: 0,
    mergedBooks: 0,
    newHighlights: 0,
    errors,
  };
}

export async function syncOnce(trigger: SyncTrigger): Promise<SyncResult> {
  await ensureOffscreen();
  try {
    return await runSync(trigger);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await setState({ lastError: reason });
    await notify("ReadQueue Kindle", `Error inesperado: ${reason}`);
    return emptyResult("error", [reason]);
  } finally {
    await closeOffscreen();
  }
}

async function runSync(trigger: SyncTrigger): Promise<SyncResult> {
  const lib = await fetchHtml(LIBRARY_URL);
  if (lib.status !== 200) {
    await setState({ lastError: `library-http-${lib.status}` });
    await notify(
      "ReadQueue Kindle",
      lib.status === 401 || lib.status === 403 || lib.status === 302
        ? `Sesión de Amazon expirada (HTTP ${lib.status}). Abrí read.amazon.com/notebook y logueate; después reintentá.`
        : `No pude leer tu biblioteca (HTTP ${lib.status}). ¿Amazon caído o cambió?`,
    );
    return emptyResult("session-expired", [`library-http-${lib.status}`]);
  }

  const books = await parseLibraryViaOffscreen(lib.text);
  if (books.length === 0) {
    // 200 but zero books usually means a login/interstitial page, not an empty
    // library — surface it instead of silently "succeeding".
    await setState({ lastSync: new Date().toISOString(), lastError: "no-books-parsed" });
    await notify(
      "ReadQueue Kindle",
      "No encontré libros en el notebook. Puede ser sesión expirada o que Amazon cambió el HTML. Abrí read.amazon.com/notebook y verificá que ves tus libros.",
    );
    return emptyResult("session-expired", ["no-books-parsed"]);
  }

  const vault = await sendToOffscreen<VaultStateReply>({ type: "get-vault-state" });
  if (vault?.error === "no-handle" || vault?.error === "permission-denied") {
    await setState({ lastError: vault.error });
    await notify(
      "ReadQueue Kindle",
      vault.error === "no-handle"
        ? "No hay carpeta de la vault configurada. Abrí el popup y elegí la carpeta Inbox/Kindle."
        : "Perdí el permiso sobre la carpeta. Abrí el popup y volvé a autorizarla.",
    );
    return { ...emptyResult("no-folder", [vault.error]), totalBooks: books.length };
  }
  const existingSlugs = new Set(vault?.existingSlugs ?? []);
  const storage = await getState();
  const deliveredByAsin = mergeDeliveredState(vault?.delivered, storage.bookStates);
  const knownBefore = new Set(Object.keys(deliveredByAsin));

  // Fetch + parse each book (fetch in SW, parse in offscreen).
  const scraped: ScrapedBook[] = [];
  const fetchErrors: string[] = [];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (!book) continue;
    try {
      const detail = await fetchHtml(bookUrl(book.asin));
      if (detail.status !== 200) {
        fetchErrors.push(`${book.asin}: HTTP ${detail.status}`);
        continue;
      }
      const highlights = await parseBookViaOffscreen(detail.text, book);
      scraped.push({ book, highlights });
    } catch (err) {
      fetchErrors.push(`${book.asin}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (i < books.length - 1) await sleep(BOOK_DELAY_MS);
    }
  }

  const plan = planLibrarySync({ scraped, deliveredByAsin, existingSlugs });

  // Dispatch file writes (recreate + append) to the offscreen document.
  let written = 0;
  let mergedBooks = 0;
  let newHighlights = 0;
  const writeErrors: string[] = [];
  const okBySlug = new Map<string, boolean>();
  if (plan.writes.length > 0) {
    const reply = await sendToOffscreen<MergeReply>({
      type: "merge-kindle-books",
      books: plan.writes.map(({ slug, fullContent, newHighlights: nh, highlightCount }) => ({
        slug,
        fullContent,
        newHighlights: nh,
        highlightCount,
      })),
    });
    if (!reply) {
      writeErrors.push("no-reply-from-offscreen");
    } else if (reply.fatal) {
      // Lost folder/permission mid-run — report as no-folder, don't advance state.
      await setState({ lastError: reply.fatal });
      await notify(
        "ReadQueue Kindle",
        "No pude escribir en la carpeta (permiso o carpeta perdida). Abrí el popup y reautorizá.",
      );
      return { ...emptyResult("no-folder", [reply.fatal]), totalBooks: books.length };
    } else {
      for (const r of reply.results) okBySlug.set(r.slug, r.ok);
      for (const r of reply.results.filter((x) => !x.ok)) {
        writeErrors.push(`${r.slug}: ${r.error ?? "write-failed"}`);
      }
    }
  }

  // Advance delivered state ONLY for books whose write succeeded (or that needed
  // no write). A failed write keeps its old state so the next sync retries it.
  const newDelivered: DeliveredByAsin = { ...deliveredByAsin };
  const writeMetaBySlug = new Map<string, MergeRequest>(
    plan.writes.map((w) => [w.slug, w]),
  );
  for (const item of plan.items) {
    if (item.action === "init-state" || item.action === "none") {
      newDelivered[item.asin] = item.deliveredKeys;
      continue;
    }
    const ok = okBySlug.get(item.slug);
    if (ok) {
      newDelivered[item.asin] = item.deliveredKeys;
      const meta = writeMetaBySlug.get(item.slug);
      if (item.action === "recreate") written++;
      if (item.action === "append") {
        mergedBooks++;
        newHighlights += meta?.newHighlights.length ?? 0;
      }
    }
  }

  const errors = [...fetchErrors, ...writeErrors];
  await sendToOffscreen({ type: "write-sync-state", delivered: newDelivered });
  await setState({
    knownAsins: Object.keys(newDelivered),
    bookStates: newDelivered,
    lastSync: new Date().toISOString(),
    lastError: errors.length > 0 ? errors[0] : undefined,
    lastResult: { written, failed: errors.length, newHighlights, mergedBooks },
  });

  const newBooks = books.filter((b) => !knownBefore.has(b.asin)).length;
  if (written > 0 || newHighlights > 0) {
    const parts: string[] = [];
    if (written > 0) parts.push(`${written} libros nuevos`);
    if (newHighlights > 0) {
      parts.push(
        `${newHighlights} highlights nuevos en ${mergedBooks} ${mergedBooks === 1 ? "libro" : "libros"}`,
      );
    }
    if (errors.length > 0) parts.push(`${errors.length} fallos`);
    await notify("ReadQueue Kindle", `${parts.join(" · ")}.`);
  } else if (errors.length > 0) {
    await notify("ReadQueue Kindle", `Sin cambios escritos · ${errors.length} fallos.`);
  } else if (trigger === "manual") {
    await notify("ReadQueue Kindle", "Sin novedades.");
  }

  return {
    status: errors.length > 0 && written === 0 && newHighlights === 0 ? "error" : "ok",
    newBooks,
    totalBooks: books.length,
    written,
    mergedBooks,
    newHighlights,
    errors,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
