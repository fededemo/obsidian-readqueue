# obsidian-readqueue

Reading queue management plugin for Obsidian. Replaces Matter-style read-it-later UX inside your vault.

## What it does

- **Reading Queue view** — side panel listing articles with `status: unread`, grouped by topic / source / date.
- **Read random** — pick a random unread article and open it in reading view (great for "I have 20 minutes, surprise me").
- **Force reading view** — articles with `source: web-clipper` open in preview mode automatically, no editing-view flicker.
- **Mark as read** — one click updates frontmatter and removes from queue.
- **Cross-app intake** — parses URLs saved by Obsidian Mobile's share extension (Twitter, Reddit, WhatsApp on iOS) using `defuddle`, the same engine Obsidian Web Clipper uses. Result: clipping a tweet from the X app produces the same clean markdown as clipping from Safari.
- **iOS Shortcut friendly** — exposes `obsidian://readqueue-random` for a one-tap "Read Now" shortcut on the home screen.

## How it fits together

This plugin is one of three pieces:

1. **Obsidian Web Clipper** (Safari Mac/iOS + all Chromium browsers) → saves articles directly to `Inbox/Web/` with rich frontmatter and highlights.
2. **Obsidian Mobile's native "Share to Obsidian"** → catches URLs from any iOS app (Twitter, Reddit, WhatsApp), writes them to `Inbox/Pending/`.
3. **This plugin** → manages the queue + intakes the URLs in `Inbox/Pending/`, parsing them with `defuddle` into proper notes in `Inbox/Web/`.

## Requirements

- Obsidian 1.5.0+
- A vault with `Inbox/Web/` and `Inbox/Pending/` folders (created automatically by Web Clipper and the share extension respectively).
- Web Clipper template configured to write to `Inbox/Web/` with `status: unread` and `source: web-clipper` frontmatter.

## Development

```bash
# Install deps
npm install

# Watch mode (regenerates main.js on save)
npm run dev

# Production build (minified)
npm run build

# Typecheck
npm run typecheck

# Tests
npm run test
```

### Installing in a local vault for testing

```bash
ln -s "$(pwd)" "/path/to/your/vault/.obsidian/plugins/readqueue"
```

Then enable the plugin in Settings → Community plugins → Installed plugins.

## Distribution

This plugin is currently private. Mobile distribution is via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from the community store.
2. Add `fededemo/obsidian-readqueue` as a beta plugin.
3. BRAT will sync the plugin to all devices where BRAT is installed.

## Kindle highlights sync

### Recommended: Chrome extension (auto-poll daily, zero touch)

The `extension/` folder is a Chrome Manifest V3 extension that uses
your active browser session at `read.amazon.com/notebook` and writes
new books directly to a folder you choose in your vault, every 24
hours. Cero cookies to copy, cero scripts to run, cero visible UI.

```bash
npm run build:extension
# Then in Chrome: chrome://extensions → Developer mode → Load unpacked → pick extension/
```

See `extension/README.md` for setup walk-through.

### Fallback: standalone CLI

If Chrome isn't available or you prefer a one-shot pull, the CLI
scrapes the same data using a manually-exported cookie.

```bash
npm run sync-kindle -- \
  --cookie "session-id=...; ubid-main=...; ..." \
  --dest "/path/to/vault/Inbox/Kindle" \
  --anthropic-key "$ANTHROPIC_API_KEY"   # optional
```

Flags:
- `--cookie "<raw>"` — paste the full `Cookie:` header from a logged-in
  request to `read.amazon.com/notebook`. **OR** `--cookie-file path` to
  read it from a file.
- `--dest` (required) — destination folder.
- `--anthropic-key` (optional) — classifies each book into a topic with
  Claude Haiku 4.5. Without it, every book gets `topic: otros`.
- `--dry-run` — parses + classifies but doesn't write.
- `--force` — overwrite existing files.

### How to get the cookie

1. Open https://read.amazon.com/notebook in Chrome/Safari/Firefox.
2. Log in.
3. Open DevTools → Network tab → reload → click the `notebook` request.
4. In the request headers, copy the entire `Cookie:` header value (long
   string with `session-id=…; ubid-main=…; at-main=…; …`).
5. Paste it as the `--cookie` argument (quote it). Keep it secret —
   anyone with this cookie can act as you on Amazon.

### When the scrape breaks

Amazon mutates the HTML periodically. If a sync run reports "Found 0
books" or fails to extract highlights, the CSS selectors in
`scripts/sync-kindle.ts` need updating. Inspect the live HTML in
DevTools and patch `parseLibrary` / `parseBookHighlights`. Tests use
captured fixtures so they keep passing; bump fixtures when you refresh
the selectors.

## License

MIT — see source.

## Status

Fase 1 in development. Plan: `~/.claude/plans/imperative-sparking-dusk.md`.
