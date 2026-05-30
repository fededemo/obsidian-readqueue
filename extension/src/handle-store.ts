const DB_NAME = "readqueue-kindle";
const STORE = "handles";
const KEY = "vault";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb();
  return new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      db.close();
      const value = req.result as FileSystemDirectoryHandle | undefined;
      resolve(value);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function clearHandle(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type PermissionState = "granted" | "denied" | "prompt";

export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  const opts = { mode };
  const queried = (await handle.queryPermission(opts)) as PermissionState;
  if (queried === "granted") return true;
  const requested = (await handle.requestPermission(opts)) as PermissionState;
  return requested === "granted";
}
