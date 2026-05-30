# obsidian-readqueue — ROADMAP

> Fuente de verdad unificada del registro de deploys + plan de alto nivel + handoff formal a `qa-tester`.
>
> **Distinto de:**
> - `FOR_FEDE.md` → historia narrativa, decisiones con "por qué"
> - `CLAUDE.md` → estado vigente de arquitectura y convenciones
> - `docs/backlog.md` → backlog operativo P0/P1/P2/P3 con estado y agente asignado
> - **Este archivo** → fases + handoff a QA + bitácora de releases

---

## 🧪 Listo para QA en staging

Cola formal de trabajo pendiente de validación. `qa-tester` lee esto en paso 0 de su QA Flow.

| Release | SHA merge | Fecha | Pendiente de QA | Owner |
|---------|-----------|-------|-----------------|-------|
| _(vacío — no hay items pendientes de QA al momento)_ | | | | |

---

## 📦 Release log

Bitácora cronológica de releases del plugin (más reciente primero). Cada entrada referencia la fase donde está consolidado el detalle.

| Fecha | Versión | SHA | PRs | Notas |
|-------|---------|-----|-----|-------|
| _(vacío — primer release aún no registrado)_ | | | | |

---

## Phase F0 — Setup user-side (DONE)

> Trabajo manual del user, sin código. Validación antes de invertir en el plugin.

### F0.1 — Web Clipper template "Read Later" (DONE, 2026-05-30)

- ✅ Web Clipper instalado en Chrome Mac + Safari Mac + Safari iOS.
- ✅ Template Default editado: `path = Inbox/Web/`, frontmatter con `source: web-clipper`, `status: unread`, `savedAt`, `url`, `author`, `published`, `topic`, `tags: [reader]`.
- ✅ Template exportado y reimportado en Safari iOS para mismo destino.
- ✅ Probado: clip desde Safari Mac y Safari iOS deposita en `Inbox/Web/`.

### F0.2 — Share extension nativa de Obsidian Mobile (DONE, 2026-05-30)

- ✅ Obsidian Mobile settings → Files & Links → Default location: `Inbox/Pending/`.
- ✅ Probado: share desde app de Twitter iOS → "Save to Obsidian" → nota aparece en `Inbox/Pending/`.

### F0.3 — Sync strategy (DONE, 2026-05-30)

- ✅ Vault elegida: `fedenotes` (iCloud Drive, no MyNotes).
- ✅ Obsidian Sync **desactivado** en fedenotes para evitar doble-sync con iCloud.
- ⚠️ Riesgo asumido: iCloud puede no sincronizar `.obsidian/plugins/` confiable. Mitigación = BRAT.

---

## Phase F1 — Plugin MVP (CODE-COMPLETE, awaiting F1.6 user testing)

> Implementación del plugin. Esta fase tiene un único deliverable: plugin instalable vía BRAT en Mac + iPhone, funcional al 100% del MVP definido en el plan.

### F1.0 — Bootstrap del repo (DONE, 2026-05-30)

- ✅ `~/codes/obsidian-readqueue/` creado con scaffold de plugin Obsidian (manifest, package.json, tsconfig, esbuild config, src/main.ts stub).
- ✅ Governance docs (CLAUDE.md, FOR_FEDE.md, README.md, este ROADMAP).
- ✅ Agentes pigmi inicializados en `.claude/agents/`.
- ✅ Skills del Core Management Bundle symlinkeadas.
- ✅ git init + repo privado en GitHub `fededemo/obsidian-readqueue` (commit `35f4d4b`).

### F1.1 — queue-data.ts (DONE, 2026-05-30, commit `5865d3b`)

- ✅ `articleFromFile` mapea TFile + frontmatter a `QueueArticle` con fallbacks (title→basename, status→unread, savedAt inválido→undefined, tags string→array).
- ✅ `filterByStatus` con default "unread" + "read" + "all".
- ✅ `groupArticles` por `topic` / `source` (hostname sin www) / `date` (Hoy / Esta semana / Este mes / Antes) / `none`.
- ✅ `sortArticles` newest/oldest (undefined dates last) + shuffle Fisher-Yates con RNG inyectable.
- ✅ `randomArticle` con RNG inyectable.
- ✅ Tests: 34, incluyendo chi-square sobre 2000 trials para shuffle uniformity (df=9, chi2 < 27.88).

### F1.3 — read-action.ts (DONE, 2026-05-30, commit `7704edc`)

- ✅ `shouldForcePreview` reconoce `source: web-clipper` y `source: intake-defuddle`.
- ✅ `markAsReadMutation` + `applyMarkAsRead` (idempotentes, timestamp ISO).
- ✅ `openInReadingView` usa `leaf.openFile(file, { state: { mode: "preview" } })`.
- ✅ `markAsRead` via `fileManager.processFrontMatter` (YAML-safe).
- ✅ `ensureReadingView` no-op si ya en preview, preserva otras state keys al cambiar.
- ✅ Tests: 15, todas las funciones pure cubiertas, side-effectful smoke-testeadas con vi.fn.

### F1.4 — intake.ts (DONE, 2026-05-30, commit `756608e`)

- ✅ `parseHtmlToArticle` con `defuddle` corriendo sobre `Document` (DOMParser inyectable).
- ✅ `articleToMarkdown` genera `{frontmatter, body}` con `source: intake-defuddle`.
- ✅ `bundleNote` con YAML frontmatter + cuerpo.
- ✅ `slugifyForFilename` con NFD + accents strip + cap a 80 chars.
- ✅ `extractUrlFromPending` prioriza frontmatter `url:`, fallback a primer URL del body, strip de markdown-link punct.
- ✅ `processPending` end-to-end con manejo de errores: no-URL / HTTP ≥400 / fetch throw → mark `intake-error` + KEEP pending.
- ✅ `scanPendingFolder` itera con lister inyectable.
- ✅ Tests: 21, con happy-dom + fixture HTML real + mocks de Vault/FileManager.
- ✅ Infrastructure: `tests/setup/obsidian-mock.ts` con alias en `vitest.config.ts`.

### F1.2 + F1.5 — queue-view + settings + main wire-up (DONE, 2026-05-30, commit `55a392b`)

- ✅ `QueueView` (ItemView) con toolbar (group / sort / refresh), cards con título + meta + botón "✓ Leído", empty state.
- ✅ `ReadQueueSettingsTab` con webFolder, pendingFolder, intakeIntervalMin (clamp ≥0), topics CSV.
- ✅ `main.ts`: registerView, ribbon icon, comandos paleta (open/random/mark), URI handler `obsidian://readqueue-random`, file-open hook con `shouldForcePreview`, `onLayoutReady → runIntakeOnce`, `setInterval` opcional.
- ✅ Build de producción: `main.js` 467KB, sin errores.
- ✅ Tests acumulados: 70 (3 suites), TypeScript estricto pasa.

### F1.6 — Distribution vía BRAT + 2 semanas de uso (PENDING — trabajo del user)

**Acceptance criteria:**
- Plugin instalable via BRAT en Mac + iPhone.
- 2 semanas de uso real sin volver a Matter, sin bugs P0/P1 abiertos.
- Métrica: cola activa de 10+ artículos, ≥5 leídos via "Read random" desde mobile.

**Pasos para el user (en orden):**

1. **Build local**: `cd ~/codes/obsidian-readqueue && npm run build` → genera `main.js` en la raíz.
2. **Install en la vault Mac** (path symlink): `ln -s ~/codes/obsidian-readqueue "/Users/federico/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes/.obsidian/plugins/readqueue"`.
3. **Activar en Obsidian Mac**: Settings → Community plugins → Installed → toggle ReadQueue.
4. **Instalar BRAT en Obsidian Mobile (iPhone)** desde Community plugins.
5. **Agregar este repo a BRAT**: Settings → BRAT → "Add Beta Plugin" → `fededemo/obsidian-readqueue` (BRAT requiere el repo público o un token; si privado, el camino alterno es copia manual de `main.js` + `manifest.json` + `styles.css` vía Files app).
6. **Verificación end-to-end del plan** (ver `/Users/federico/.claude/plans/imperative-sparking-dusk.md` sección "Verificación end-to-end").

---

## Phase F2 — Polish (PLANNED, opcional)

Solo si F1 deja fricciones reales después de 2 semanas:

- Reading-mode CSS snippet (typography serif, max-width, line-height).
- Time-to-read estimado en cards.
- Snooze (`snoozedUntil` frontmatter + filtro).
- Daily digest (comando que arma una nota con 5 recomendados).

---

## Phase F3 — Multi-source expansion (PLANNED, futura)

- Kindle highlights via plugin `hadynz/obsidian-kindle-plugin`.
- Twitter likes vía BookmarkRapture export → script intake.
- Podcasts/video con mismo frontmatter standard.

---

## Última actualización

2026-05-30 — F1.0–F1.5 mergeados a main. 70 tests verdes, TypeScript estricto pasa, build de prod 467KB. Pendiente: F1.6 (BRAT install + 2 semanas de uso).
