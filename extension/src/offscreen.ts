import { mergeHighlightsIntoMarkdown } from "../../src/kindle-merge";
import type { KindleHighlight } from "../../src/kindle";
import { loadHandle, verifyPermission } from "./handle-store";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "write-kindle-books") {
    void handleWrite(msg.books as Array<{ slug: string; content: string }>).then(
      (res) => sendResponse(res),
    );
    return true;
  }
  if (msg && msg.type === "merge-kindle-books") {
    void handleMerge(msg.books as MergeBook[]).then((res) => sendResponse(res));
    return true;
  }
  return false;
});

async function handleWrite(
  books: Array<{ slug: string; content: string }>,
): Promise<{ written: number; errors: string[] }> {
  const handle = await loadHandle();
  if (!handle) return { written: 0, errors: ["no-handle"] };
  if (!(await verifyPermission(handle))) {
    return { written: 0, errors: ["permission-denied"] };
  }
  let written = 0;
  const errors: string[] = [];
  for (const { slug, content } of books) {
    try {
      await writeFile(handle, slug, content);
      written++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push(`${slug}: ${reason}`);
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
  if (!(await verifyPermission(handle))) {
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
      const reason = err instanceof Error ? err.message : String(err);
      results.push({ slug: book.slug, ok: false, recreated: false, error: reason });
    }
  }
  return { results };
}

async function readFileIfPresent(
  handle: FileSystemDirectoryHandle,
  slug: string,
): Promise<string | undefined> {
  try {
    const fileHandle = await handle.getFileHandle(`${slug}.md`);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err) {
    // Only a missing file means "recreate" — any other read error must NOT
    // silently overwrite the user's edits with a full rebuild.
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
  const fileHandle = await handle.getFileHandle(`${slug}.md`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
