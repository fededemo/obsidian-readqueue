# ReadQueue Kindle Sync — Chrome extension

Auto-syncs your Kindle highlights into a folder of your Obsidian vault, **once a day, in the background, while Chrome is open**. No cookies to copy, no scripts to run.

> **Chromium only.** This extension needs two APIs that exist only in Chromium
> browsers (Chrome, Edge, Brave, Arc): the **File System Access API** (to write
> into your vault) and **offscreen documents** (Manifest V3's way to reach the
> DOM). It will **not** load in Safari or Firefox. If you live in Safari, keep
> Chrome around just for this — see "Sync cadence" below.

## What it does

- Uses your **active Chrome session** at `read.amazon.com/notebook` — no manual cookie export.
- Reads your full library + highlights of every book.
- Writes each new book as `<slug>.md` directly to a folder you choose **inside your Obsidian vault** (via the File System Access API).
- **Re-checks already-imported books on every sync**: if you kept reading a book and added highlights, only the new ones get appended to the existing `.md` — your edits to the file are preserved, and highlights you deleted from it never come back.
- Runs automatically every 24h via `chrome.alarms`. The service worker sleeps in between — zero footprint when idle.
- **Invisible to you**: no tabs, no popups, no URL prompts. Notifications only when something new arrives or something fails.

## Prerequisites (do these first)

1. **Node.js** installed (v18+), and the repo dependencies:
   ```bash
   cd ~/codes/obsidian-readqueue
   npm install          # once, if you haven't already
   ```
2. A **Chromium browser** (Chrome / Edge / Brave / Arc).
3. In your vault, the **destination folder must already exist**. Create
   `Inbox/Kindle/` in Obsidian (or Finder) before configuring the extension —
   the folder picker cannot create it for you.
4. That folder must be the **same one** the ReadQueue plugin scans for Kindle
   highlights: plugin setting **`kindleFolder`** (default `Inbox/Kindle/`). The
   extension's picker and the plugin's `kindleFolder` are **two independent
   settings** — if they don't point at the same folder, the plugin's Highlights
   view won't see what the extension writes.

## Install

1. **Build the extension** (re-run after any code change):
   ```bash
   cd ~/codes/obsidian-readqueue
   npm run build:extension
   ```
   Outputs `extension/background.js`, `popup.js`, `offscreen.js`.

2. **Load unpacked in Chrome**:
   - Chrome → `chrome://extensions/`
   - Toggle **Developer mode** (top right).
   - Click **Load unpacked**.
   - Pick the `extension/` folder.

3. **Set up the vault folder** (one time, requires a real user click):
   - Click the extension icon in the toolbar.
   - Click **Elegir carpeta de la vault**.
   - In the picker, navigate to your vault and select
     `…/fedenotes/Inbox/Kindle` (create it first if it doesn't exist).
   - On the prompt "Allow this site to view files in '…/Inbox/Kindle'?", click
     **Allow on every visit**.
   - Status switches to `Carpeta: Kindle`.

4. **Authenticate with Amazon** (once):
   - Open `https://read.amazon.com/notebook` in any Chrome tab.
   - Log in if you aren't already.
   - That's it — the extension reuses the same session.

5. **Test the first sync**:
   - Click the extension icon → **Sincronizar ahora**.
   - A notification appears: `N libros nuevos · M highlights nuevos`.
   - Open Obsidian — the new `.md` files are already in `Inbox/Kindle/`.
   - Run **Sincronizar ahora** a second time → it should report "Sin novedades"
     (idempotent; no duplicates).

After that, auto-sync runs every 24h. Chrome can be in the background; the
service worker wakes for a few seconds and goes back to sleep.

> After rebuilding (`npm run build:extension`), reload the extension in
> `chrome://extensions` (↻ on the card) to pick up the new code.

## Sync cadence (and the Safari-first reality)

The 24h alarm **only fires while Chrome is running**. If you use Safari as your
daily browser and open Chrome rarely, that's fine: Kindle highlights are not
urgent — they pile up safely in Amazon, and the **incremental merge catches up
in a single run** whenever Chrome next opens. There's nothing to lose by
syncing weekly instead of daily.

## Where sync state lives (and why "Reset libros" is safe)

The set of highlights **ever delivered** to your vault is stored in two places:

- **`.kindle-sync-state.json`** — a small sidecar written into your Kindle
  folder (`Inbox/Kindle/.kindle-sync-state.json`). This is the **source of
  truth**. It travels with your vault (iCloud/Obsidian Sync), so every device
  and both the extension and the CLI agree on what's already been imported.
- `chrome.storage.local` — a per-browser cache. On conflict, the vault sidecar
  wins.

Because delivered-state lives in the vault, uninstalling the extension, moving
to a new machine, or clicking **Reset libros** is **non-destructive**:

- **Reset libros / a cleared sidecar**: the next sync sees your existing Kindle
  notes and *re-adopts* them (`init-state`) — it re-marks their current
  highlights as delivered **without rewriting the files**, so your manual edits
  survive. Only notes you actually **deleted** from the vault get recreated.

This closes the old failure mode where a reset re-imported everything and
overwrote hand-edited notes.

## When the session expires

Amazon cookies expire every ~14 days. When that happens:

- The next sync fails and shows a notification: *"Sesión de Amazon expirada.
  Abrí read.amazon.com/notebook y logueate; después reintentá."*
- Open `read.amazon.com/notebook`, log in.
- Click the extension popup → **Sincronizar ahora**. Back to normal — nothing is
  lost, the merge catches up.

## When the folder permission lapses

"Allow on every visit" doesn't always survive a Chrome restart; it can silently
degrade to "ask". When it does, the popup shows **⚠ Sin permiso sobre «Kindle»**
and the folder button becomes **Reautorizar carpeta** — one click restores it
(auto-sync can't prompt on its own, so it pauses until you do).

## When Amazon changes the HTML

Selectors live in `src/kindle.ts`. If a sync reports "No encontré libros" or a
book comes back with 0 highlights, inspect the live HTML in DevTools and patch
the selectors. Tests in `tests/kindle.test.ts` use captured fixtures — refresh
the fixtures when you change selectors. Parsing runs in the **offscreen
document** (it has a real `DOMParser`; the MV3 service worker does not).

## Manual CLI (fallback)

If Chrome isn't available, `scripts/sync-kindle.ts` still works with a manual
cookie and shares the **same** `.kindle-sync-state.json` sidecar format:
```bash
npm run sync-kindle -- --dest "…/Inbox/Kindle" --merge
```
See the main README.

## Architecture

- `manifest.json` — Manifest V3. `host_permissions: read.amazon.com/*`.
- `background.ts` — **service worker**. Alarm 24h → `fetch` library + each book
  (with a delay, to be polite) → delegates **parsing** to the offscreen document
  → runs the pure `planLibrarySync` (`src/kindle-sync-plan.ts`) against the
  sidecar → dispatches file writes to the offscreen document → writes the sidecar
  back. Holds **no** DOM: it never touches `DOMParser` or the filesystem.
- `offscreen.ts` — the only context with a DOM. Handles: `parse-library`,
  `parse-book` (DOMParser), `get-vault-state` (read sidecar + list existing
  slugs), `write-sync-state`, and `merge-kindle-books` (read existing file →
  append only new highlights, or recreate if missing).
- `popup.ts` + `popup.html` — setup, manual sync, status, permission reauth.
- `handle-store.ts` — IndexedDB persistence of the `FileSystemDirectoryHandle`.
- `esbuild.config.mjs` — bundle TS → JS per entry.

## Permissions

- `storage` — cache of delivered highlight keys per book + last sync.
- `alarms` — daily auto-sync.
- `notifications` — surface success / errors without opening the popup.
- `offscreen` — Manifest V3 mechanism to reach DOM APIs (DOMParser + File System
  Access) from a service-worker-triggered flow.
- `host_permissions: read.amazon.com/*` — fetch with the user's session.
