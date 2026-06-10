import { clearHandle, loadHandle, saveHandle, verifyPermission } from "./handle-store";

interface StoredState {
  knownAsins?: string[];
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

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function relativeTime(iso: string | undefined): string {
  if (!iso) return "nunca";
  const ts = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

async function refresh(): Promise<void> {
  const folderStatus = $<HTMLDivElement>("folder-status");
  const folderBtn = $<HTMLButtonElement>("choose-folder");
  const stateInfo = $<HTMLDivElement>("state");
  const errorEl = $<HTMLDivElement>("error");

  const handle = await loadHandle();
  if (handle) {
    folderStatus.textContent = `Carpeta: ${handle.name}`;
    folderBtn.textContent = "Cambiar carpeta";
  } else {
    folderStatus.textContent = "Sin carpeta configurada.";
    folderBtn.textContent = "Elegir carpeta de la vault";
  }

  const state = (await new Promise<StoredState>((resolve) =>
    chrome.storage.local.get(null, (s) => resolve(s as StoredState)),
  )) ?? {};
  const known = state.knownAsins?.length ?? 0;
  stateInfo.textContent = `Última sync: ${relativeTime(state.lastSync)} · ${known} libros conocidos`;

  if (state.lastError) {
    errorEl.textContent = `⚠ ${state.lastError}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }
}

$<HTMLButtonElement>("choose-folder").addEventListener("click", async () => {
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts: { mode: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite" });
    if (!(await verifyPermission(handle))) {
      alert("Permiso denegado. Probá de nuevo.");
      return;
    }
    await saveHandle(handle);
    await refresh();
  } catch (err) {
    if (err instanceof Error && err.name !== "AbortError") {
      alert(`Error eligiendo carpeta: ${err.message}`);
    }
  }
});

$<HTMLButtonElement>("sync-now").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("sync-now");
  btn.disabled = true;
  btn.textContent = "Sincronizando…";
  try {
    const res = await new Promise<{
      status: string;
      written: number;
      newBooks: number;
      newHighlights: number;
      mergedBooks: number;
      errors: string[];
    }>((resolve) => chrome.runtime.sendMessage({ type: "sync-now" }, resolve));
    if (res) {
      btn.textContent = `${res.written} nuevos · ${res.newHighlights ?? 0} highlights`;
    } else {
      btn.textContent = "Listo";
    }
  } catch (err) {
    btn.textContent = `Error: ${err instanceof Error ? err.message : err}`;
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Sincronizar ahora";
      void refresh();
    }, 1500);
  }
});

$<HTMLButtonElement>("reset-known").addEventListener("click", async () => {
  if (!confirm("Olvidar todos los libros conocidos y reimportar todo en el próximo sync?")) {
    return;
  }
  await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "reset-known" }, resolve),
  );
  await refresh();
});

$<HTMLButtonElement>("clear-folder").addEventListener("click", async () => {
  if (!confirm("Olvidar la carpeta seleccionada?")) return;
  await clearHandle();
  await refresh();
});

void refresh();
