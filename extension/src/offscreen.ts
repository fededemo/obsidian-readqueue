import { mergeHighlightsIntoMarkdown } from "../../src/kindle-merge";
import {
  parseBookHighlights,
  parseLibrary,
  type KindleBook,
  type KindleHighlight,
} from "../../src/kindle";
import {
  deliveredToSyncState,
  parseSyncState,
  SYNC_STATE_FILENAME,
  syncStateToDelivered,
  type DeliveredByAsin,
} from "../../src/kindle-sync-plan";
import { loadHandle, queryHandlePermission } from "./handle-store";

// The offscreen document is a background context with NO user activation, so it
// must NEVER call requestPermission (that throws SecurityError: "User activation
// is required"). It only QUERIES the persisted permission; re-granting a lapsed
// permission happens in the popup ("Reautorizar carpeta"), which has a gesture.
const hasPermission = async (
  handle: FileSystemDirectoryHandle,
): Promise<boolean> => (await queryHandlePermission(handle)) === "granted";

// The offscreen document is the ONLY extension context with a real DOM, so all
// HTML parsing (MX22-a) and all File System Access writes happen here. The MV3
// service worker has neither DOMParser nor FSA — it only fetches + orchestrates.

const parseDom = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  switch (msg.type) {
    case "parse-library":
      sendResponse({ books: parseLibrary(msg.html as string, parseDom) });
      return false;
    case "parse-book":
      sendResponse({
        highlights: parseBookHighlights(
          msg.html as string,
          msg.book as KindleBook,
          parseDom,
        ).highlights,
      });
      return false;
    case "get-vault-state":
      void handleGetVaultState().then(sendResponse);
      return true;
    case "write-sync-state":
      void handleWriteSyncState(msg.delivered as DeliveredByAsin).then(
        sendResponse,
      );
      return true;
    case "write-kindle-books":
      void handleWrite(msg.books as Array<{ slug: string; content: string }>).then(
        sendResponse,
      );
      return true;
    case "merge-kindle-books":
      void handleMerge(msg.books as MergeBook[]).then(sendResponse);
      return true;
    default:
      return false;
  }
});

interface VaultState {
  syncState: ReturnType<typeof parseSyncState>;
  delivered: DeliveredByAsin;
  existingSlugs: string[];
  error?: string;
}

async function handleGetVaultState(): Promise<VaultState> {
  const empty = parseSyncState("{}");
  const handle = await loadHandle();
  if (!handle) {
    return { syncState: empty, delivered: {}, existingSlugs: [], error: "no-handle" };
  }
  if (!(await hasPermission(handle))) {
    return {
      syncState: empty,
      delivered: {},
      existingSlugs: [],
      error: "permission-denied",
    };
  }

  const existingSlugs: string[] = [];
  try {
    // FileSystemDirectoryHandle async iteration — available in Chromium.
    for await (const [name] of (
      handle as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>;
      }
    ).entries()) {
      if (name.endsWith(".md")) existingSlugs.push(name.slice(0, -3));
    }
  } catch (err) {
    return {
      syncState: empty,
      delivered: {},
      existingSlugs: [],
      error: `list-failed: ${errMessage(err)}`,
    };
  }

  let syncState = empty;
  const stateRaw = await readNamedFileIfPresent(handle, SYNC_STATE_FILENAME);
  if (stateRaw !== undefined) syncState = parseSyncState(stateRaw);

  return {
    syncState,
    delivered: syncStateToDelivered(syncState),
    existingSlugs,
  };
}

async function handleWriteSyncState(
  delivered: DeliveredByAsin,
): Promise<{ ok: boolean; error?: string }> {
  const handle = await loadHandle();
  if (!handle) return { ok: false, error: "no-handle" };
  if (!(await hasPermission(handle))) {
    return { ok: false, error: "permission-denied" };
  }
  try {
    const content = `${JSON.stringify(deliveredToSyncState(delivered), null, 2)}\n`;
    await writeNamedFile(handle, SYNC_STATE_FILENAME, content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

async function handleWrite(
  books: Array<{ slug: string; content: string }>,
): Promise<{ written: number; errors: string[] }> {
  const handle = await loadHandle();
  if (!handle) return { written: 0, errors: ["no-handle"] };
  if (!(await hasPermission(handle))) {
    return { written: 0, errors: ["permission-denied"] };
  }
  let written = 0;
  const errors: string[] = [];
  for (const { slug, content } of books) {
    try {
      await writeFile(handle, slug, content);
      written++;
    } catch (err) {
      errors.push(`${slug}: ${errMessage(err)}`);
    }
  }
  return { written, errors };
}

interface MergeBook {
  slug: string;
  fullContent: string;
  newHighlights: KindleHighlight[];
  highlightCount: number;
}

interface MergeResult {
  slug: string;
  ok: boolean;
  recreated: boolean;
  error?: string;
}

async function handleMerge(
  books: MergeBook[],
): Promise<{ results: MergeResult[]; fatal?: string }> {
  const handle = await loadHandle();
  if (!handle) return { results: [], fatal: "no-handle" };
  if (!(await hasPermission(handle))) {
    return { results: [], fatal: "permission-denied" };
  }
  const results: MergeResult[] = [];
  for (const book of books) {
    try {
      const existing = await readFileIfPresent(handle, book.slug);
      // File deleted from the vault → recreate it in full; otherwise append
      // only the new highlights, preserving the user's edits.
      const content =
        existing === undefined
          ? book.fullContent
          : mergeHighlightsIntoMarkdown(
              existing,
              book.newHighlights,
              book.highlightCount,
            );
      await writeFile(handle, book.slug, content);
      results.push({ slug: book.slug, ok: true, recreated: existing === undefined });
    } catch (err) {
      results.push({ slug: book.slug, ok: false, recreated: false, error: errMessage(err) });
    }
  }
  return { results };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readFileIfPresent(
  handle: FileSystemDirectoryHandle,
  slug: string,
): Promise<string | undefined> {
  return readNamedFileIfPresent(handle, `${slug}.md`);
}

async function readNamedFileIfPresent(
  handle: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  try {
    const fileHandle = await handle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    // Only a missing file means "not there" — any other read error must NOT be
    // swallowed (e.g. it would let a merge silently overwrite the user's edits).
    if (err instanceof DOMException && err.name === "NotFoundError") {
      return undefined;
    }
    throw err;
  }
}

async function writeFile(
  handle: FileSystemDirectoryHandle,
  slug: string,
  content: string,
): Promise<void> {
  await writeNamedFile(handle, `${slug}.md`, content);
}

async function writeNamedFile(
  handle: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
