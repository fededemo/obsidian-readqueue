import {
  clearHandle,
  loadHandle,
  queryHandlePermission,
  requestHandlePermission,
  saveHandle,
  verifyPermission,
} from "./handle-store";

// Full-page folder setup. Unlike the popup, a normal extension tab is NOT
// dismissed when the File System Access directory picker / permission prompt
// opens, so showDirectoryPicker + requestPermission complete and persist
// reliably. The popup just links here.

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function refresh(): Promise<void> {
  const statusEl = $<HTMLDivElement>("status");
  const detailEl = $<HTMLParagraphElement>("detail");
  const handle = await loadHandle();

  if (!handle) {
    statusEl.textContent = "Sin carpeta configurada.";
    statusEl.className = "warn";
    detailEl.textContent = "Elegí la carpeta Inbox/Kindle de tu vault para empezar.";
    return;
  }
  const perm = await queryHandlePermission(handle);
  if (perm === "granted") {
    statusEl.textContent = `✅ Carpeta: ${handle.name} — permiso OK`;
    statusEl.className = "ok";
    detailEl.textContent =
      "Todo listo. Volvé al popup de la extensión y tocá «Sincronizar ahora».";
  } else {
    statusEl.textContent = `⚠ Carpeta: ${handle.name} — falta el permiso (${perm})`;
    statusEl.className = "warn";
    detailEl.textContent =
      "Tocá «Reautorizar carpeta» y aceptá el permiso de Chrome. Si no funciona, tocá «Elegir carpeta» y reelegila.";
  }
}

$<HTMLButtonElement>("choose").addEventListener("click", async () => {
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts: { mode: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite" });
    if (!(await verifyPermission(handle))) {
      alert("Permiso denegado. Probá de nuevo y elegí «Editar archivos».");
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

$<HTMLButtonElement>("reauth").addEventListener("click", async () => {
  const handle = await loadHandle();
  if (!handle) {
    await refresh();
    return;
  }
  try {
    const granted = await requestHandlePermission(handle);
    if (granted !== "granted") {
      alert(
        "Chrome no otorgó el permiso. Probá «Elegir carpeta de la vault» y reelegí Inbox/Kindle.",
      );
    }
  } catch (err) {
    alert(`No pude pedir el permiso: ${err instanceof Error ? err.message : err}`);
  }
  await refresh();
});

$<HTMLButtonElement>("forget").addEventListener("click", async () => {
  if (!confirm("¿Olvidar la carpeta seleccionada?")) return;
  await clearHandle();
  await refresh();
});

void refresh();
