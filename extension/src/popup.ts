import {
  clearHandle,
  loadHandle,
  queryHandlePermission,
  requestHandlePermission,
  saveHandle,
  verifyPermission,
} from "./handle-store";
import type { DeliveredByAsin } from "../../src/kindle-sync-plan";

interface StoredState {
  knownAsins?: string[];
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

/** Turns machine error codes into something a human can act on. */
function friendlyError(code: string): string {
  if (code === "no-handle") return "No hay carpeta configurada. Elegí la carpeta Inbox/Kindle de tu vault.";
  if (code === "permission-denied") return "Perdí el permiso sobre la carpeta. Tocá «Reautorizar carpeta».";
  if (code === "no-books-parsed")
    return "No encontré libros en el notebook. Sesión expirada o Amazon cambió el HTML: abrí read.amazon.com/notebook y verificá que ves tus libros.";
  if (/^library-http-(401|403|302)$/.test(code))
    return "Sesión de Amazon expirada. Abrí read.amazon.com/notebook y logueate; después reintentá.";
  if (/^library-http-/.test(code)) return `Amazon respondió ${code.replace("library-http-", "HTTP ")}. ¿Caído o cambió?`;
  if (/^list-failed/.test(code)) return "No pude leer la carpeta de la vault. Revisá el permiso.";
  return `⚠ ${code}`;
}

/** Tracks whether the saved handle currently has write permission, so the
 * folder button can offer "Reautorizar" (a gesture that can call
 * requestPermission) instead of re-opening the picker. */
let needsReauth = false;

async function refresh(): Promise<void> {
  const folderStatus = $<HTMLDivElement>("folder-status");
  const folderBtn = $<HTMLButtonElement>("choose-folder");
  const stateInfo = $<HTMLDivElement>("state");
  const errorEl = $<HTMLDivElement>("error");

  const handle = await loadHandle();
  needsReauth = false;
  if (handle) {
    const perm = await queryHandlePermission(handle);
    if (perm === "granted") {
      folderStatus.textContent = `Carpeta: ${handle.name}`;
      folderStatus.classList.remove("warn");
      folderBtn.textContent = "Cambiar carpeta";
    } else {
      needsReauth = true;
      folderStatus.textContent = `⚠ Sin permiso sobre «${handle.name}». El auto-sync está pausado.`;
      folderStatus.classList.add("warn");
      folderBtn.textContent = "Reautorizar carpeta";
    }
  } else {
    folderStatus.textContent = "Sin carpeta configurada.";
    folderStatus.classList.remove("warn");
    folderBtn.textContent = "Elegir carpeta de la vault";
  }

  const state = (await new Promise<StoredState>((resolve) =>
    chrome.storage.local.get(null, (s) => resolve(s as StoredState)),
  )) ?? {};
  const known = state.knownAsins?.length ?? 0;
  stateInfo.textContent = `Última sync: ${relativeTime(state.lastSync)} · ${known} libros conocidos`;

  if (state.lastError) {
    errorEl.textContent = friendlyError(state.lastError);
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }
}

$<HTMLButtonElement>("choose-folder").addEventListener("click", async () => {
  try {
    // Re-grant path: an existing handle whose permission lapsed only needs a
    // requestPermission gesture — no need to re-pick the folder.
    if (needsReauth) {
      const handle = await loadHandle();
      if (handle) {
        const granted = await requestHandlePermission(handle);
        if (granted === "granted") {
          await refresh();
          return;
        }
      }
    }
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
  if (
    !confirm(
      "¿Olvidar el estado de sincronización y re-escanear desde cero?\n\n" +
        "No se pierden tus ediciones: las notas de Kindle que ya existen se re-adoptan tal cual y solo se recrean las que hayas borrado de la vault.",
    )
  ) {
    return;
  }
  await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "reset-known" }, resolve),
  );
  await refresh();
});

$<HTMLButtonElement>("clear-folder").addEventListener("click", async () => {
  if (!confirm("¿Olvidar la carpeta seleccionada? Vas a tener que elegirla de nuevo.")) return;
  await clearHandle();
  await refresh();
});

void refresh();
