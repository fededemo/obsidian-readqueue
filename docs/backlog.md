# Backlog — obsidian-readqueue

> Backlog priorizado P0/P1/P2/P3 con estado y agente asignado. Owner: `system-architect`.

## Convenciones

- **ID**: `B-NNN` secuencial
- **Priority**: P0 (crítico/bloqueante), P1 (importante), P2 (nice to have), P3 (futuro)
- **Status**: TODO, IN_PROGRESS, BLOCKED, DONE
- **Agent**: agente al que está asignado (o "—" si pendiente de assign)
- **Dependencies**: items que tienen que cerrar antes

## P0 — Bloqueantes para F1

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-006 | Setup BRAT en Mac + iPhone, distribuir plugin | TODO | user (manual) | B-001..B-005 (todos DONE) | F1.6 del ROADMAP |

## P1 — Important, no bloqueantes

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-101 | Tests E2E del flujo "save desde Twitter app → intake → cola → lectura" | TODO | qa-tester | B-002, B-004 | 1 test corriendo en CI |
| B-102 | README + screenshots para BRAT users | TODO | — | B-006 | screenshots actualizados |

## P2 — Nice to have

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-201 | Reading-mode CSS snippet (typography serif) | DONE | builder | F1 done | Shipped: `enableReaderStyles` + `styles.css` (`readqueue-reader-active`) |
| B-202 | Time-to-read estimado en cards | DONE | builder | B-002 | Shipped MX4: `estimateReadingMinutesFromSize`, card muestra "X min" |
| B-203 | Snooze (`snoozedUntil` frontmatter) | DONE | builder | B-002 | Shipped MX3: comandos Snooze 1d/1w/1m + `filterBySnoozedUntil` |

## P3 — Futuro

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-301 | Integración con Kindle highlights | DONE | builder | F1 done | Shipped MX8/9/12 (CLI + extensión + merge incremental). Kindle vive en `Inbox/Kindle/`, no en la cola (decisión F3). Puesta en marcha real = F5.0 |
| B-302 | Integración con Twitter likes batch (BookmarkRapture) | SUPERSEDED | builder | F1 done | Reemplazado por intake vía FxTwitter (MX1): captura por URL individual, no batch nocturno |

## P3 — F5 (Kindle en marcha + Biblioteca + Recomendaciones)

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-320 | MX22 — Confiabilidad del sync Kindle shipped (fix DOMParser SW, sidecar en vault, permisos/errores, docs) | DONE | builder | — | `planLibrarySync` + offscreen parse + sidecar; typecheck + tests verdes |
| B-321 | F5.0 — Puesta en marcha real del sync (setup + 1 sync exitoso + 1 semana de repaso) | TODO | user (manual) | B-320 | Highlights de Kindle reales en la vault; 2do sync idempotente |
| B-322 | MX24 — Wishlist de Amazon a fichas `Books/` (fetch público + paginación + reconcile) | DONE | builder | B-320 | `wishlist.ts` + `books-data.ts`; comando "Sincronizar wishlist"; fixtures reales |
| B-323 | MX25 — Recomendador "¿Qué leo ahora?" (context pack + Claude + nota) | DONE | builder | B-322 | `recommend.ts` + helper retry `anthropic.ts`; comando `recommend-books` |
| B-324 | MX23 — Biblioteca Kindle completa: **spike de endpoints Cloud Reader** + sync en la extensión | TODO | user + builder | B-321 | BLOQUEADO: requiere sesión autenticada de Fede en DevTools para descubrir el endpoint JSON. Reconcile + fichas ya listos (`reconcileLibrary`, manifiesto `.kindle-library.json`) |
| B-325 | F5.4 — Spaced repetition real + notas de síntesis | TODO | — | B-321 (uso real) | Diseño aparte tras validar F5.3 |

## Archivo

| ID | Descripción | Closed | Commit |
|----|-------------|--------|--------|
| MX15 | Fix (bug reportado por Fede): búsqueda de la Reading Queue inusable en mobile — al tipear una letra se perdía el foco y se reseteaba el scroll. Causa: `searchEl.oninput` llamaba a `render()` completo, que reconstruía la vista entera y recreaba el `<input>` en cada tecla. Fix: `oninput` (y group/sort/collapse) re-renderizan solo el contenedor de lista vía `renderList()` nuevo; toolbar/search/pill quedan montados → foco, caret y scroll sobreviven. Empty state diferenciado (filtro vs cola vacía). Test de regresión DOM (happy-dom) que verifica identidad del nodo input + foco; falla con el código viejo | 2026-06-18 | `4fdb939` |
| MX14 | Polish del flujo de lectura — (1) retomar lectura donde quedaste: scroll por nota persistido en data.json (LRU cap 200, restore solo si > 10%, se limpia al marcar leído); (2) botón inline «✓ Marcar como leído» al llegar al ~97% del artículo (toggle en settings, nunca auto-marca); (3) comando «Agregar URL a la cola» con modal + clipboard prefill reusando `processUrl` extraído del intake; (4) flash efímero de 2s sobre el highlight al saltar desde la vista (reduced-motion fallback). Módulos puros `scroll-memory.ts` / `add-url.ts` / `flash.ts` con 32 tests nuevos | 2026-06-10 | `2caed44` |
| MX12 | Re-sync incremental de Kindle highlights — la extensión re-chequea libros conocidos cada sync y mergea solo highlights nuevos en el `.md` existente (ediciones del usuario preservadas, highlights borrados no reaparecen, archivo borrado se recrea); migración sin duplicar para libros pre-MX12; CLI `--merge` con sidecar `.kindle-sync-state.json`; módulo puro `src/kindle-merge.ts` con 24 tests | 2026-06-10 | `dadb367` |
| MX13 | Vista unificada de highlights (web + Kindle + Matter, search, jump-to-highlight) + resurfacing diario determinístico por fecha con sección en el digest — módulo puro `src/highlights-data.ts` con 21 tests | 2026-06-10 | `036a180` |
| MX11 | Subrayado por selección en reading view — botón flotante (desktop + iOS) + comandos de paleta, `==...==` + nota `%%...%%`, módulo puro `src/highlight.ts` con 43 tests | 2026-06-10 | `9536d1c` |
| B-001 | `queue-data.ts` con tests | 2026-05-30 | `5865d3b` |
| B-002 + B-005 | `queue-view.ts` + URI handler + settings tab + comandos paleta (mergeados en un solo wire-up) | 2026-05-30 | `55a392b` |
| B-003 | `read-action.ts` (open + force preview + mark as read) | 2026-05-30 | `7704edc` |
| B-004 | `intake.ts` con defuddle + tests con fixtures | 2026-05-30 | `756608e` |

---

**Última actualización**: 2026-05-30 — F1.0–F1.5 code-complete (5 commits feat en main). Solo queda B-006 (BRAT install + 2 semanas de uso real).
