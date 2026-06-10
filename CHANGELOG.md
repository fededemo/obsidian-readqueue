# Changelog

All notable changes to this plugin are documented here.

The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
