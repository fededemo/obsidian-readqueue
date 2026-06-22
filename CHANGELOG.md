# Changelog

All notable changes to this plugin are documented here.

The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Auto-classification skipped every Web Clipper article** (MX16): the
  Web Clipper "Read Later" template writes `topic: otros` literally, but
  `classifyAllWithoutTopic` only ran on notes with an *empty* topic, so it
  treated the template default as "already classified" and never touched
  it — leaving the whole queue stuck in `otros`. The classify gate now
  also reclassifies notes whose topic is the fallback `otros`, guarded by
  a new `classified: true` frontmatter marker so genuinely-`otros`
  verdicts are written once and never re-hit the API on later loads.

### Changed

- **Richer classification signal** (MX16): the Claude prompt now includes
  the article's domain, its Web Clipper summary, and the descriptive tags
  the clipper already generated — not just title + first 600 chars. Topic
  descriptions were tuned to the real reading corpus (progress studies,
  urbanism, social science, business/founder profiles, AI).
- **`tweet` removed as a topic** (MX16): it described the *source*, not the
  content. A tweet about Claude Code is `tech`; a tweet about creativity is
  `personal`. Tweets are now classified by their subject like any other
  article (the FxTwitter intake still fetches the tweet body, so there is
  real content to classify; "it's a tweet" is preserved via the `source`
  field and `tweet` tag).
- New command **"Re-classify ALL articles in queue (force)"** to re-run
  classification over the whole queue after taxonomy changes.

- **Reading Queue search was unusable on mobile** (MX15): typing a single
  letter dropped keyboard focus and reset the scroll. The `oninput`
  handler called the full `render()`, which rebuilt the whole view —
  destroying and recreating the `<input>` on every keystroke. Now search
  (and group/sort/collapse) only rebuild the list container; the toolbar,
  search box and filter pill stay mounted, so focus, caret and scroll
  survive. The empty state now distinguishes "no results for this filter"
  from "nothing in the queue". The Highlights view (MX13) already did this
  correctly and was unaffected.

## [0.3.0] — 2026-06-10

### Added

- **Reading flow polish** (MX14): four quality-of-life improvements to
  the reading loop. (1) *Resume where you left off*: the scroll position
  of queue notes is captured while you read and persisted in the
  plugin's `data.json` (LRU-capped at 200 notes), then restored when the
  note is reopened — only if you were past ~10% of the article; the
  entry is dropped when the note is marked as read. (2) *Mark as read at
  the end*: scrolling past ~97% of an unread article reveals a subtle
  inline "✓ Marcar como leído" button after the content (Notice on
  click, never auto-marks; toggle in settings, default on). (3) New
  palette command **"Agregar URL a la cola"**: a modal pre-filled from
  the clipboard when it holds a URL, running the exact same intake
  pipeline as the pending-folder scan (defuddle, FxTwitter for
  twitter-likes, topic classification) — the shared core was extracted
  as `processUrl()` in `src/intake.ts` — and ending with a Notice that
  shows the resulting title plus an "Abrir" action. (4) *Highlight
  flash*: jumping to a highlight from the Highlights view now flashes
  the rendered `==mark==` with a ~2s accent fade (static outline under
  `prefers-reduced-motion`; degrades silently if the element can't be
  located). Pure logic in `src/scroll-memory.ts`, `src/add-url.ts`, and
  `src/flash.ts` with 32 new tests.
- **Unified highlights view + daily resurfacing** (MX13): new
  "Highlights" side panel (palette command + ribbon icon) that scans the
  web, Kindle, and Matter-legacy folders (all configurable) and lists
  every highlight grouped by note — `==inline==` marks with their
  adjacent `%%note%%` (code blocks excluded) plus blockquotes under
  `## Highlights` sections with `*Location N*` and `📝` notes. Realtime
  search filters the in-memory cache (invalidated on vault
  modify/create/delete); clicking a highlight opens the note scrolled to
  its line. New command "Repasar highlights de hoy" picks N highlights
  (default 5, configurable) deterministically per date — same day, same
  picks — weighting source variety (web → kindle → matter round-robin),
  and writes a `## Highlights para repasar` section into today's reading
  digest (idempotent; the digest command also includes it, toggle in
  settings, default on).
- **Incremental Kindle re-sync** (MX12): the Chrome extension no longer
  skips already-imported books — every daily sync re-fetches each known
  book (1.2s delay between requests) and appends only the highlights
  never delivered before to the existing `.md` in the vault, preserving
  the user's edits (frontmatter changes, own notes, deleted highlights
  never reappear). Highlight identity = normalized text + location; per
  book the set of ever-delivered keys lives in `chrome.storage.local`.
  Books imported pre-MX12 migrate on first re-sync by marking the
  currently scraped highlights as delivered without touching the file.
  If the `.md` was deleted from the vault it gets recreated in full.
  Notification only on news: "N highlights nuevos en M libros". The CLI
  gains parity via `npm run sync-kindle -- --merge` with state in
  `.kindle-sync-state.json` inside `--dest`. Pure merge module in
  `src/kindle-merge.ts` with 24 new tests.
- **Highlight-on-select in reading view** (MX11): selecting text in the
  preview (mouse on desktop, long-press on iOS) shows a floating button
  with "Subrayar" and "Subrayar + nota" — the selection is located in
  the markdown source (whitespace-tolerant, skips `**bold**` /
  `*italic*` / `[link](url)` markers, disambiguates repeated text using
  surrounding context) and wrapped in `==...==` without leaving reading
  view. Notes are appended as `%%comment%%` (invisible in preview,
  editable in source mode). Palette commands "Subrayar selección"
  (suggested hotkey Cmd/Ctrl+Shift+H) and "Subrayar selección + nota"
  work even with the floating button disabled (settings toggle, default
  on). Multi-paragraph selections, selections inside an existing
  highlight, and ambiguous fragments are rejected with a clear Notice.
  Atomic writes via `vault.process`.

## [0.2.0] — 2026-05-30

The "make it usable" release. Sums up M1–M10 (Twitter intake fix, Claude
classification, Matter migration) plus six post-MVP iterations: clean
side-panel UX, real reading actions, premium reader styles, smart
discovery, richer AI classification.

### Added

- **Tweet intake via FxTwitter** (M1): URLs from twitter.com / x.com /
  fxtwitter.com / fixupx.com / vxtwitter.com bypass defuddle and use the
  community FxTwitter API instead — the resulting note now has the real
  tweet text, author, date, and media. Falls back to defuddle if
  FxTwitter is unreachable.
- **Topic classification** (M2): two-layer classifier. Heuristic by
  publisher (33-entry default map seeded from your Matter history) for
  free, optional Claude Haiku 4.5 layer (~$0.0007/article) when an
  Anthropic API key is set. Closed-list topics:
  `tech / producto / macro / ciencia / personal / cultura / tweet / otros`.
- **Auto-tagging via Claude** (MX6): same API call that returns the
  topic now also returns 2–3 lowercase tags. They merge into the
  article's `tags` frontmatter so dataview queries like `tag:#anthropic`
  work across topics.
- **Smart title cleanup** (MX6): trims publisher suffixes ("Article |
  Stratechery" → "Article") when safe (head ≥ 8 chars, tail ≤ 30 chars,
  tail doesn't end with punctuation).
- **Matter migration CLI** (M3): `npm run import-matter -- --source X
  --dest Y [--anthropic-key sk-ant-...]` walks a Matter-export folder,
  parses `## Metadata` + `## Highlights`, writes proper YAML frontmatter
  to `Inbox/Legacy/Matter/`, classifies every article. Idempotent
  (skips existing). 172 of the user's legacy articles migrated.
- **readTag setting** (M4): mark-as-read now appends a configurable tag
  ("leido" default) to `tags` in addition to flipping `status` and
  `readAt`.
- **"Classify all articles without topic" command** (M6): batch pass
  over the queue folder for pre-M2 articles.
- **Auto-classify on plugin load** (M7): on startup, after intake, the
  plugin silently classifies any articles missing a topic. Configurable
  toggle.
- **"Test Claude API connection" command** (M9): one-shot diagnostic
  that shows the actual Anthropic response in a Notice — no DevTools
  needed.
- **Collapsible group headers** (M10): click any group header (Por
  tópico / Por fuente / Por fecha) to fold / unfold. State persists
  across plugin reloads via `data.json`.
- **Inline API-key validation** (MX1): if the value in the API-key
  field doesn't start with `sk-ant-`, a warning shows in the settings
  description.
- **Hot-reload of settings on each classify** (MX1): a new API key
  takes effect on the next call without toggling the plugin off/on.
- **Snooze and Postpone** (MX3): each card gains "✓ Leído", "💤 1 sem"
  and "↓ Después". Snoozed articles disappear from the queue until
  their date. Paleta commands for snooze 1d / 1w / 1m and postpone.
- **Keyboard shortcuts** (MX3): with the queue view focused — `J`/`K`
  to navigate, `Enter` to open, `R` to mark read, `S` to snooze 1 day,
  `⌘+F` to focus search (MX2).
- **Premium reader typography** (MX4): notes with
  `source: web-clipper / intake-* / matter-legacy` open with serif
  font, 720px max-width, 1.7 line-height, sutil link underlines.
  Toggle in settings.
- **Time-to-read** (MX4): each card shows an estimated reading time
  computed from `file.stat.size` (instant, no I/O).
- **Search box** (MX2): realtime input in the toolbar, filters across
  title + topic + url + source + author.
- **Topic badges with click-to-filter** (MX2): each card's topic is a
  color-coded pill (10 colors). Click filters the queue to that topic;
  a pill banner with "× Limpiar" returns to the full view.
- **Sticky group headers** (MX2): the current topic header stays pinned
  at the top of the side panel while scrolling.
- **Unread count in the tab title** (MX2): "Reading Queue (47)".
- **Auto-open the queue on plugin load** (MX2): the view opens in the
  right side panel without needing to click the ribbon icon. Toggle in
  settings.
- **Stats panel** (MX5): one-line summary above the toolbar — `47
  unread · 3 💤 · 8 leídos esta semana · top mes: tech`.
- **"Pick today's reading" command** (MX5): chooses 5 articles —
  shortest + longest + random — and badges them with "★ Hoy" in the
  queue.
- **"Create today's reading digest note" command** (MX5): creates
  `Diario/YYYY-MM-DD lectura.md` listing the picks, opens it. Idempotent.

### Changed

- `classifyTopic` and `classifyWithClaude` now return
  `{ topic, tags }` instead of a topic string. Internal API breakage —
  the script wrapper preserves the previous behavior for the migration
  CLI.
- Plugin commands and view actions are now snooze-aware: the queue
  filter pipeline excludes articles whose `snoozedUntil` is in the
  future.

### Fixed

- **Anthropic CORS / browser-direct-access** (M8): the classify path
  now uses Obsidian's `requestUrl` instead of `fetch` and sends the
  `anthropic-dangerous-direct-browser-access: true` header. Before this,
  every Claude classification silently 4xx'd and fell back to "otros".
- **Script decoupling** (M5): `slugifyForFilename` lives in its own
  `src/slugify.ts` so `scripts/import-matter.ts` runs under tsx in
  plain Node — the previous import chain pulled in `obsidian`-only
  value exports.

## [0.1.0] — Bootstrap

Initial scaffold and F1 MVP (queue-data + read-action + intake +
queue-view + main wire-up + BRAT distribution). See git history.
