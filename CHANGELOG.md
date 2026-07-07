# Changelog

All notable changes to this plugin are documented here.

The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.4] — 2026-07-06

### Fixed

- **Ranking de wishlist devolvía vacío** ("No pude rankear") con listas grandes:
  el `max_tokens` (3000) truncaba el JSON del modelo a mitad de lista (200 OK pero
  imposible de parsear). Subido a 8000 (es un techo, se factura por output real).
  Además, si vuelve a fallar, ahora loguea la respuesta cruda a la consola.

### Changed

- **Fichas de wishlist en `Books/Wishlist/`** en vez de la raíz de `Books/`. Las
  nuevas caen ahí; las que ya estaban en la raíz se reubican solas en el próximo
  "Sincronizar wishlist".

## [0.4.3] — 2026-07-06

### Changed

- **Prompt del ranking de wishlist, nivel "advisor".** Rúbrica de scoring
  calibrada (90-100 raro / 70-89 fuerte / 40-69 plausible / 0-39 débil, sin
  inflar), jerarquía de señales explícita (highlights >> lo leído >> anti-backlog)
  y cada razón obligada a citar un highlight/título concreto (no genéricos).

## [0.4.2] — 2026-07-06

### Added

- **Comando "Rankear mi wishlist (¿cuál leer?)".** Sincroniza tu wishlist y le
  pide a Claude que rankee **todos** tus libros de la lista por match con lo que
  venís leyendo y subrayando, en 3 tiers accionables (Leé ya / Para pronto /
  Algún día) con un score 0-100 y un porqué de una línea. Reusa el context pack
  del recomendador; pesa fuerte los highlights y aplica anti-compra-compulsiva.
  Nota en `Books/Rankings/<fecha>.md`. Default `claude-sonnet-5` (~5-8 ¢/corrida).

### Fixed

- **Highlights de Kindle duplicados.** Cuando un highlight no tenía nota tuya, el
  markup de Amazon exponía el texto del highlight dentro del elemento de nota →
  se generaba un "📝 Note: <el mismo highlight>" duplicado. Ahora se descarta la
  nota cuando solo repite el highlight (se conservan las notas reales).

## [0.4.1] — 2026-07-06

### Fixed

- **Frontmatter YAML inválido → "Invalid properties" en Obsidian.** Un valor con
  `: ` (dos puntos + espacio), típicamente un autor tipo `By: Ayn Rand`, YAML lo
  lee como un mapping. El serializador ahora entrecomilla cualquier valor que no
  sea un escalar plano seguro (las URLs `https://…` siguen sin comillas). Aplica a
  las notas de Kindle y a las fichas de `Books/`. Además, el prefijo `By:`/`Por:`
  del autor ahora se limpia bien.
- **Nombres de nota legibles.** Las notas de libros usan el título tal cual
  (`Atomic Habits.md`) en vez del slug en minúsculas con el ASIN pegado
  (`atomic-habits-b07jthxnxx.md`). El ASIN queda en el frontmatter como identidad;
  los `[[links]]` del recomendador siguen el mismo esquema.

## [0.4.0] — 2026-07-06

> F5: puesta en marcha del ecosistema de libros. Kindle sync confiable + wishlist
> de Amazon + catálogo de libros + recomendador "¿Qué leo ahora?". Nota: el código
> de esta versión pasa typecheck + 438 tests + builds, pero se publica como beta
> (BRAT) sin haber corrido dentro de Obsidian/Chrome. La biblioteca Kindle
> *completa* (MX23) queda pendiente de un spike de endpoints del Cloud Reader.

### Fixed

- **Kindle sync: bug fatal del `DOMParser` en el service worker (MX22-a).** La
  extensión creaba `new DOMParser()` dentro del service worker MV3 (contexto que
  no lo expone) → el sync fallaba en la primera corrida. El parseo del notebook
  se movió al **offscreen document** (que sí tiene DOM) vía mensajes nuevos
  `parse-library` / `parse-book`. El service worker solo hace fetch + orquesta.

### Added

- **Sidecar `.kindle-sync-state.json` en la vault (MX22-b).** El estado de
  highlights ya entregados vive ahora en la carpeta de Kindle de la vault (mismo
  formato v1 que el CLI), con `chrome.storage.local` como cache y precedencia
  vault > cache. Lógica de reconciliación en el módulo puro `src/kindle-sync-plan.ts`
  (`planLibrarySync`), espejo del flujo `planMerge` del CLI. Efecto: **"Reset
  libros" y reinstalar son seguros** — las notas existentes se re-adoptan
  (`init-state`) sin pisar ediciones; solo se recrean las que borraste.
- **Wishlist de Amazon → fichas de libros (MX24).** Comando "Sincronizar wishlist
  de Amazon": trae tu lista pública compartida con `requestUrl()` (sin sesión,
  funciona en mobile), paginando `showMoreUrl`, y crea/actualiza fichas
  `shelf: wishlist` en `Books/`. Módulo puro `src/wishlist.ts` + `src/books-data.ts`.
- **Recomendador "¿Qué leo ahora?" (MX25).** Comando `recommend-books`: arma un
  context pack de la vault (lo leído, lo subrayado, la cola, tus libros, tu
  wishlist) y le pide a Claude 3–5 recomendaciones rankeadas, priorizando lo que
  YA tenés sin leer antes que comprar algo nuevo (anti-compra-compulsiva).
  Escribe `Books/Recomendaciones/AAAA-MM-DD.md` con `[[links]]` navegables.
  Módulo puro `src/recommend.ts` con parser anti-alucinación. Comando "Empezar
  este libro" (`readingStatus: reading`).
- **Modelo de catálogo de libros (MX23).** Carpeta `Books/` en la raíz (setting
  `booksFolder`), fichas con `shelf` (owned/sample/borrowed/wishlist) y
  `readingStatus` (propiedad del user, nunca la pisa una máquina). El orphan-mover
  protege `booksFolder`. Comando "Reconciliar biblioteca Kindle" (lee un
  manifiesto `.kindle-library.json`; el productor —sync de biblioteca en la
  extensión— queda pendiente del spike de endpoints del Cloud Reader).
- **Helper compartido `src/anthropic.ts`** con retry/backoff acotado (1 reintento
  en 429/5xx/errores de red) que ahora usan tanto la clasificación como el
  recomendador — la clasificación antes fallaba en silencio ante un 429 transitorio.

### Changed

- **Popup de la extensión (MX22-c):** estado de permiso al abrir, botón
  "Reautorizar carpeta" cuando el permiso caduca (con gesto), errores legibles
  (sin carpeta / sin permiso / sesión expirada / Amazon cambió el HTML), y confirm
  honesto de "Reset libros" (explica que no se pierden ediciones).
- **`extension/README.md` reescrito (MX22-d):** prerrequisitos (`npm install`,
  Chromium-only), crear `Inbox/Kindle/` primero, alineación carpeta-picker ↔
  `kindleFolder`, cadencia de sync (solo con Chrome abierto) y por qué el sidecar
  hace todo no-destructivo.

## [0.3.6] — 2026-06-22

### Changed

- **El auto-move de huérfanos ya no corre solo** (raíz del vaciado de
  `Inbox/Read`): `moveWebClipperOrphans` corría en cada arranque, gateado por
  `autoMoveOrphans`. Aunque v0.3.4 protegió `Inbox/Read`, un build viejo en
  cualquier dispositivo (propagado por iCloud) podía seguir vaciando Read.
  - `autoMoveOrphans` ahora es **`false` por defecto**: el rescate de clips
    sueltos pasa a ser solo manual (comando "Move Web Clipper orphans"). Como
    el gate vive en `data.json` (sincronizado por iCloud) y lo respetan todos
    los builds, apagarlo protege a TODOS los dispositivos sin importar la
    versión instalada.
  - El orphan-mover ahora protege **todo el árbol `Inbox/`** (no solo carpetas
    sueltas), además de la defensa por `status: read`. Estructuralmente no
    puede tocar Web/Read/Pending/Legacy/Kindle.

## [0.3.5] — 2026-06-22

### Added

- **Ir al siguiente al marcar como leído** (MX21): marcar un artículo como
  leído (desde el botón de fin de lectura o el comando "Mark current note as
  read") ahora abre automáticamente el siguiente de la cola en modo lectura,
  para leer en continuo. Al terminar la cola avisa "terminaste la cola 🎉".
  El "siguiente" respeta el orden y filtros actuales de la vista. Se puede
  desactivar con el toggle "Ir al siguiente al marcar como leído" (default on).

## [0.3.4] — 2026-06-22

### Fixed

- **`Inbox/Read` se vaciaba en cada reinicio** (regresión crítica de MX18):
  el job de mover huérfanos del Web Clipper (`moveWebClipperOrphans`, corre en
  cada `onLayoutReady`) no protegía `Inbox/Read/`. Como los artículos
  archivados conservan su frontmatter de clipping (source URL, tag
  `clippings`), el job los trataba como huérfanos y los devolvía a la cola en
  cada arranque, deshaciendo el archivado. Ahora `Inbox/Read/` (vía
  `readFolder`) está protegido y, como segunda defensa, ningún archivo con
  `status: read` se mueve nunca, esté donde esté. La detección se extrajo a
  `isWebClipperOrphan` (función pura) con cobertura de tests.

## [0.3.3] — 2026-06-22

### Added

- **Categorización automática al llegar un artículo** (MX19): antes la
  clasificación solo corría al abrir Obsidian (`classifyOnLoad`), así que un
  artículo guardado mientras el plugin ya estaba abierto se quedaba sin
  `topic` hasta el siguiente reinicio. Ahora un handler de
  `vault.on("create")` / `vault.on("rename")` dispara una pasada de
  clasificación (debounced 4s, coalescente para ráfagas de sync de iCloud)
  cuando aparece un `.md` nuevo en la carpeta de la cola. Reusa el gate de
  `classifyAllWithoutTopic`: respeta el marcador `classified` y los topics
  ya asignados.

### Changed

- **La cola abre sin agrupar por defecto** (MX19): el group-by por defecto
  pasó de "Por tópico" a "Sin agrupar". Al ordenar por "Más nuevos" se ve
  una lista plana por fecha con la categoría como un dato más en cada fila
  (entre la fecha y la duración), en vez de quedar agrupada. Agrupar por
  tópico/fuente/fecha sigue disponible en el control.

## [0.3.2] — 2026-06-22

### Added

- **Archivado automático al marcar como leído** (MX18): marcar un artículo
  como leído ahora lo mueve a `Inbox/Read/AAAA-MM/` (mes tomado de su
  `readAt`), además de fijar `status: read`. Antes solo cambiaba el
  frontmatter y el archivo quedaba en `Inbox/Web/`, por lo que la carpeta
  de leídos por mes nunca se llenaba. La carpeta base (`Inbox/Read/`) y el
  comportamiento son configurables (toggle "Archivar al marcar como leído",
  default on). Colisiones de nombre se resuelven con sufijo ` (n)`; si el
  archivo ya está en destino es no-op; un move fallido se loguea sin
  bloquear el marcado. Nuevo helper puro `readArchiveMonth` con 4 tests.

## [0.3.1] — 2026-06-22

### Added

- **Highlight by selection now works in edit mode** (MX17): the "Subrayar
  selección" command (and its `Cmd/Ctrl+Shift+H` hotkey) previously only
  fired in reading view — in Live Preview / source mode it was disabled,
  so pressing the hotkey appeared to do nothing. It now also operates
  directly on the editor selection in edit mode, wrapping it in `==…==`
  (surrounding whitespace kept outside the markers) with an optional
  `%%note%%` via "Subrayar selección + nota". Pressing it on an
  already-highlighted span toggles the marks off. Reading view keeps its
  existing DOM-snapshot path. New pure helper `wrapSelectionAsHighlight`
  in `src/highlight.ts` with 8 unit tests.

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
