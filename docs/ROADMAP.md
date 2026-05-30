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

## Phase F1 — Plugin MVP (IN PROGRESS)

> Implementación del plugin. Esta fase tiene un único deliverable: plugin instalable vía BRAT en Mac + iPhone, funcional al 100% del MVP definido en el plan.

### F1.0 — Bootstrap del repo (DONE, 2026-05-30)

- ✅ `~/codes/obsidian-readqueue/` creado con scaffold de plugin Obsidian (manifest, package.json, tsconfig, esbuild config, src/main.ts stub).
- ✅ Governance docs (CLAUDE.md, FOR_FEDE.md, README.md, este ROADMAP).
- ✅ Agentes pigmi inicializados en `.claude/agents/`.
- ✅ Skills del Core Management Bundle symlinkeadas.
- ⏳ git init + repo privado en GitHub `fededemo/obsidian-readqueue`.

### F1.1 — queue-data.ts (PLANNED)

**Acceptance criteria:**
- Lee `Inbox/Web/*.md` de la vault.
- Filtra por frontmatter (`status: unread` por default, configurable).
- Agrupa por `topic` / `source domain` / `savedAt` bucket (esta semana / antes).
- Ordena por nuevo / viejo / shuffle (Fisher-Yates).
- Tests unit con vault mockeada — happy path + empty vault + frontmatter inválido + 100+ archivos.

### F1.2 — queue-view.ts (PLANNED)

**Acceptance criteria:**
- ItemView registrado, abrible desde ribbon icon + comando.
- Renderiza cards (título + source domain + savedAt + topic) en grupos colapsables.
- Dropdown "Group by" funcional, dropdown "Sort" funcional.
- Funciona en mobile (touch targets ≥44px, sin hover-only).

### F1.3 — read-action.ts (PLANNED)

**Acceptance criteria:**
- Botón "Leer" abre `TFile` en main pane con `state: { mode: 'preview' }`.
- Hook `workspace.on('file-open')` cambia a preview si frontmatter tiene `source: web-clipper` y modo actual es 'source'.
- Botón "Mark as read" updatea frontmatter (`status: read`, `readAt: <now>`) via `app.fileManager.processFrontMatter`.

### F1.4 — intake.ts (PLANNED) — la pieza más arriesgada

**Acceptance criteria:**
- Scanea `Inbox/Pending/` al startup + cada N min (configurable).
- Para cada `.md` con URL: `requestUrl({url})` → `defuddle.parse(html)` → escribe `.md` en `Inbox/Web/{slug}.md` con frontmatter completo (`source: intake-defuddle`, etc).
- Borra el pending después de éxito.
- En error: guarda `intake-error: <reason>` en frontmatter del pending y NO borra. User puede ver y reintentar.
- Tests con HTML fixtures de Twitter, Reddit, artículo blog estándar, artículo con paywall.

### F1.5 — URI handler + settings + commands (PLANNED)

**Acceptance criteria:**
- `obsidian://readqueue-random` registrado, abre artículo random unread en preview.
- Comando paleta "Read random article".
- Comando paleta "Open Reading Queue".
- Comando paleta "Mark current note as read".
- Settings tab: source folder, pending folder, intake interval, topic list.

### F1.6 — Distribution vía BRAT + 2 semanas de uso (PLANNED)

**Acceptance criteria:**
- Plugin instalable via BRAT en Mac + iPhone.
- 2 semanas de uso real sin volver a Matter, sin bugs P0/P1 abiertos.
- Métrica: cola activa de 10+ artículos, ≥5 leídos via "Read random" desde mobile.

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

2026-05-30 — Bootstrap del repo.
