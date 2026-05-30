import { loadHandle, verifyPermission } from "./handle-store";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "write-kindle-books") return false;
  void handleWrite(msg.books as Array<{ slug: string; content: string }>).then(
    (res) => sendResponse(res),
  );
  return true;
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
      const fileHandle = await handle.getFileHandle(`${slug}.md`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      written++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push(`${slug}: ${reason}`);
    }
  }
  return { written, errors };
}
