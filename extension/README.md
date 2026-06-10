# ReadQueue Kindle Sync — Chrome extension

Auto-syncs your Kindle highlights into a folder of your Obsidian vault, **once a day, in the background, while Chrome is open**. No cookies to copy, no scripts to run.

## What it does

- Uses your **active Chrome session** at `read.amazon.com/notebook` — no manual cookie export.
- Reads your full library + highlights of every book.
- Writes each new book as `<slug>.md` directly to a folder you choose **inside your Obsidian vault** (via the File System Access API).
- **Re-checks already-imported books on every sync** (MX12): if you kept reading a book and added highlights, only the new ones get appended to the existing `.md` — your edits to the file are preserved, and highlights you deleted from it never come back.
- Runs automatically every 24h via `chrome.alarms`. Service worker sleeps in between — zero footprint when idle.
- **Cero visible to you**: no tabs, no popups, no URL prompts. Notifications only when something new arrives or something fails.

## What gets created in your vault

For each book:

```yaml
---
source: kindle-scrape
title: "Atomic Habits"
asin: "B07JTHXNXX"
author: "James Clear"
cover: "https://m.media-amazon.com/images/I/cover.jpg"
url: "https://read.amazon.com/notebook?asin=B07JTHXNXX"
savedAt: 2026-05-30T18:50:00.000Z
status: read
readAt: 2026-05-30T18:50:00.000Z
tags: [reader, kindle, legacy]
topic: otros
highlightCount: 47
---

# Atomic Habits

> by James Clear

[Original ↗](https://read.amazon.com/notebook?asin=B07JTHXNXX)

## Highlights

> You do not rise to the level of your goals. You fall to the level of your systems.
*Location 312*

> Every action you take is a vote for the type of person you wish to become.
*Location 588*

📝 Important framing for identity-based habits.

…
```

When the ReadQueue plugin runs `classifyAllWithoutTopic` (it does automatically on plugin load if `classifyOnLoad: true` and the Anthropic API key is set), the topic gets reclassified from "otros" to something real.

## Install

1. **Build the extension** (once):
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
   - In the picker, navigate to your vault and select `Inbox/Kindle/` (create it first if it doesn't exist).
   - On the prompt "Allow this site to view files in '…/Inbox/Kindle'?", click **Allow on every visit**.
   - Status switches to `Carpeta: Kindle`.

4. **Authenticate with Amazon** (once):
   - Open `https://read.amazon.com/notebook` in any Chrome tab.
   - Log in if you aren't already.
   - That's it — the extension uses the same session.

5. **Test the first sync**:
   - Click the extension icon → **Sincronizar ahora**.
   - A notification appears: `N libros nuevos importados`.
   - Open Obsidian — the new `.md` files are already in `Inbox/Kindle/`.

After that, auto-sync runs every 24h. Chrome can be in the background; the service worker wakes for ~5 seconds and goes back to sleep.

## Incremental re-sync of known books (MX12)

Every sync re-fetches each already-imported book (with a 1.2s delay between requests, to be polite with Amazon — it runs once a day) and compares against what was **ever delivered** to your vault:

- Highlight identity = normalized text (whitespace collapsed) + location. Per book, the set of delivered keys lives in `chrome.storage.local` (`bookStates`).
- New highlights = scraped − ever-delivered. They get appended at the end of the `## Highlights` section of the existing file, in the same format as a fresh import, and `highlightCount` in the frontmatter is updated (= count of delivered keys). Nothing else in the file is touched.
- Because the state tracks "ever delivered" rather than file contents, a highlight you deleted from the `.md` does **not** reappear.
- If you deleted the whole `.md` from the vault, the next sync with new highlights recreates it in full.
- **Migration**: books imported before MX12 only have their ASIN tracked. The first re-sync initializes the delivered set with the currently scraped highlights **without touching the file** — nothing gets duplicated.
- Notification only when there is something new: "N highlights nuevos en M libros".

The merge logic is a pure module: `src/kindle-merge.ts` (tests in `tests/kindle-merge.test.ts`). The CLI has parity via `npm run sync-kindle -- --merge`, storing state in `.kindle-sync-state.json` inside `--dest`.

After rebuilding (`npm run build:extension`), reload the extension in `chrome://extensions` (↻ on the card) to pick up the new code.

## When the session expires

Amazon cookies expire every ~14 days. When that happens:

- Next auto-sync fails silently and shows a notification: "Sesión expirada o sin acceso. Abrí read.amazon.com/notebook en Chrome y volvé a intentar."
- Open `read.amazon.com/notebook`, log in.
- Click the extension popup → **Sincronizar ahora**. Back to normal.

## When Amazon changes the HTML

Selectors are in `src/kindle.ts`. If a sync reports "Found 0 books" or "0 highlights", inspect the live HTML in DevTools and patch the selectors. Tests in `tests/kindle.test.ts` use captured fixtures — bump fixtures when you refresh selectors.

## Manual CLI (fallback)

If Chrome isn't available, `scripts/sync-kindle.ts` (the CLI from MX8) still works with a manual cookie. See main README.

## Files

- `manifest.json` — Manifest V3.
- `background.ts` — service worker. Alarm 24h + fetch + parse + incremental diff of known books + delegate write/merge to offscreen.
- `offscreen.ts` — DOM context that has File System Access. Receives the markdown payload from the SW and writes via `FileSystemDirectoryHandle`; for known books it reads the existing file and appends only the new highlights (`src/kindle-merge.ts`).
- `popup.ts` + `popup.html` — UI for setup + manual sync + status.
- `handle-store.ts` — IndexedDB persistence of the `FileSystemDirectoryHandle`.
- `esbuild.config.mjs` — bundle TS → JS for each entry.

## Permissions

- `storage` — track known ASINs + delivered highlight keys per book + last sync.
- `alarms` — daily auto-sync.
- `notifications` — surface success / errors without opening the popup.
- `offscreen` — Manifest V3 mechanism to access DOM APIs (File System Access) from a service worker context.
- `host_permissions: read.amazon.com/*` — fetch with the user's session.
