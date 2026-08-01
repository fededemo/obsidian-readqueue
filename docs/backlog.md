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
| B-006 | ~~Setup BRAT en Mac + iPhone~~ → **CERRADO por B-725**: Obsidian Sync propaga `.obsidian/plugins/` nativamente, BRAT ya no hace falta | DONE | user (manual) | B-725 | Vault migrada a `~/fedenotes` + Sync activo (2026-08-01) |

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
| B-327 | 🐛 **BUG GRAVE — highlights de Kindle duplicados. RESUELTO 2026-08-01.** Medido: 2410 highlights, solo **777 únicos** (ratio 3.10×; 19 libros en 4×, 12 en 2×), 34/34 afectados. **Root cause**: el sidecar `.kindle-sync-state.json` (delivered-keys) desapareció de la vault y cada re-sync appendeó el set completo; el `highlightCount` salía bien porque se calcula desde las keys deduplicadas, lo que enmascaró el problema | **DONE** | builder | — | ✅ Fix en 2 capas (`dedupeHighlights` en el build + `isAlreadyInFile` en el merge → idempotente aunque el sidecar se pierda), 5 tests de regresión, y limpieza de la vault: 1633 duplicados borrados, **0 únicos perdidos** (verificado por diff contra HEAD). Repo `c4a8a38`, vault `7f438a6` |
| B-326 | MX27 — Reconciliar leídos de Kindle (notas `Inbox/Kindle/` → fichas `Books/`, matcher título+autor) | DONE | builder | B-322 | `src/kindle-books-reconcile.ts` puro; flip wishlist→owned+read (upgrade-only), `highlightsNote`, fichas semilla; startup sweep + comando; 27 tests |

## F6 — Knowledge graph / segundo cerebro (ADR-002 + vision doc)

> De colección a red neuronal. Diseño en `docs/architecture/knowledge-graph-vision.md` + `ADR-002`. Decisiones: casa = readqueue-F6, escritura = suggestion-only, arranque = Fase 1.

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-501 | F6.0 — Vision doc + ADR-002 (modelo de nodos/aristas, fases, decisiones) | DONE | system-architect | — | ✅ `knowledge-graph-vision.md` + `ADR-002` (2026-07-13) |
| B-502 | F6.1 — Fase 1 suggestion-only: Ask-your-vault + descubrimiento de conexiones. Demo real sobre un cluster + `docs/vault-gardener/proposals/` | IN_PROGRESS (1er demo entregado) | system-architect | B-501 | 1er pase `producto`/`tech`: 10 conexiones + 3 notas-concepto + Q&A en `proposals/2026-07-13-producto-tech-connections.md`. **Pendiente: validación de Fede** |
| B-503 | F6.2 — Agente `vault-gardener` (modos `/vault-ask` + `/vault-link`), read-only, suggestion-only, cost-min (Sonnet default) | IN_PROGRESS | system-architect | B-502 | ✅ Agente creado `.claude/agents/vault-gardener.md`. Pendiente: 1ra query real de Fede para validar |
| B-503b | F6.2b — Contrato de extracción de conceptos (ADR-003) | DONE | system-architect | — | ✅ `ADR-003` (identidad, home registro, canon 2-pasadas, gates, cost-min Haiku) |
| B-504 | F6.3 — Plomería determinística `src/graph-data.ts` (huérfanos, salud del grafo, bidireccionalidad) + git en la vault | TODO | builder | B-502 validado | Módulo puro + vitest (patrón `books-data.ts`); git como backbone de undo antes de mutar |
| B-505 | F6.4 — Enrichment + construcción del grafo (notas-concepto, 8 MOCs de dominio, Canvas) — primera mutación real | TODO | builder + vault-gardener | B-504 + postura batches-on-git | Batches revisados sobre git; preserva ediciones humanas |
| B-506 | **Fix clase de error "identidad de libros" (highlights = verdad de terreno).** (1) Clasificar libros Kindle desde una muestra de sus highlights, no del título/metadata → arregla `topic: otros`; (2) guard de desambiguación de títulos near-duplicate en el matching de wishlist/recommender (autor + ASIN exacto + confidence); (3) coherence-check que flaggea fichas cuyo subject no matchea los highlights | TODO | builder | — | Repro: *Infinity Machine* (Mallaby/Hassabis, leído) confundido con *Infinite Machine* (Russo/Ethereum, wishlist). Corre en Haiku (cost-min). Converge con la extracción de conceptos de F6 (contenido = verdad). **Avance MX27/B-326**: el ítem (2) quedó implementado para el camino notas-Kindle→fichas (`kindle-books-reconcile.ts`: ASIN exacto → título normalizado → guard de autor, sin fuzzy); falta aplicarlo al recommender y (1)+(3) siguen TODO |

## Meta-tooling / DX (acceso de Claude a la vault — ADR-001)

> No es feature del plugin ni entra en el roadmap F. Es cómo Claude consume la base de conocimiento de Obsidian. Diseño en `docs/architecture/ADR-001-acceso-vault-obsidian.md`.

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-401 | Sección "Acceso de Claude a la vault" en CLAUDE.md (read-only por defecto, escrituras gated) | DONE | system-architect | ADR-001 Accepted | ✅ Sección aplicada en CLAUDE.md + ADR-001 Accepted (2026-07-09) |
| B-402 | Skill `vault` — método de consulta segura de la KB (carpetas, grep de frontmatter, gate de escritura) | TODO (diferido) | — | B-401 | Diferido por decisión governance-first. Invocable; encapsula gobernanza de lectura |
| B-403 | Path B headless Sync mirror (`ob` pull-only) — SOLO si hay agentes cloud/cron o dolor iCloud activo | TODO | user + builder | 2da máquina sin la vault + confirmar add-on **Sync** en el plan de Fede | Mirror materializado en dir separado; no doble-sync |
| B-404 | Path C Local REST API + MCP — opcional, queries vivas (dataview/backlinks/search) | TODO | user + builder | Fede quiere instalar plugin + Obsidian abierto | MCP server registrado en Claude Code |

## F7 — X/Twitter: bookmarks y likes (discovery)

> Discovery en `docs/plans/f7-x-bookmarks-y-likes.md` (2026-07-28). Ingesta = `birdclaw` (externo, MIT), no construimos cliente de X. Ventana de cola = `created_at` del tweet < 90 días (decidido por Fede). Pendiente: D1 (transporte API vs cookies) y D2 (carpeta de la KB).

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-600 | ADR-004 — Estructura de carpetas y taxonomía de la vault (3 ejes: carpeta=ciclo de vida, frontmatter=naturaleza, links=sentido). Mide la deuda real: 3 nombres para "fecha de entrada", 2 vocabularios de estado, `status` ausente en `Inbox/Web` | PROPOSED | system-architect | — | `ADR-004`. Pendiente OK de Fede a §2.2 (estructura) y §2.4 (normalización, = escritura en vault, gated) |
| B-601 | F7.0 — **COMPLETADO**: birdclaw + xurl instalados y autenticados, sync real `ok:true count:20`. Mix medido: 13/20 punteros, 70% de un solo autor, punteros a **PDFs académicos** (no HTML). 7 correcciones al diseño (§11.4) | DONE | user + system-architect | D1 (API oficial) | ✅ Datos reales en `~/.birdclaw`; hallazgos en `f7-...md` §11 |
| B-606 | F7.0b — **COMPLETADO**: 450 bookmarks + 200 likes sincronizados (~$0.65). Mix real: **33% READ / 24% WATCH / 43% REFERENCE**. Los papers eran 3%, no 65% (la muestra de 20 era una racha). Solo **92 de 450** entran a la cola | DONE | system-architect | B-601 | ✅ §13 del plan. Taxonomía v2 validada con datos |
| B-609 | Refinamiento: expandir **quote-tweets** (86 en la muestra) vía `quoted_tweet_id` — hoy caen en REFERENCE pero el contenido vive en el tweet citado; algunos serían READ | TODO | builder | B-608 | Reclasificación medida antes/después |
| B-608 | **Diseño corregido**: la especie `pointer` NO se resuelve con defuddle (los links son PDFs de ssrn/arxiv). Usar `birdclaw research` (expande el hilo padre → resumen + link). Reescribir §3.2 del plan en F7.1 | TODO | builder | B-606 | `x-sync.ts` consume salida de `research`, no fetchea PDFs |
| B-607 | **Fuera de F7, colateral**: Command Line Tools desactualizadas en la Mac de Fede — rompe cualquier fórmula brew que compile desde fuente y dejó `Cellar/node/22.0.0` con dylib faltante | TODO | user (manual) | — | `xcode-select --install` (o Software Update); `brew doctor` limpio |
| B-602 | F7.1 — `src/x-sync.ts`: lector del SQLite de birdclaw + dedupe vía `url-canon` + router `read`/`watch`/`reference` (taxonomía v2, §12 del plan). **Bloqueante de E1 y E2** | TODO | builder | B-601 ✅, B-606 ✅ | Comando "Sincronizar bookmarks de X"; tests con fixtures reales de los 450 |
| B-603b | **E1 — la punta de X**: ~92 bookmarks recientes y consumibles (`<90d` + READ/WATCH) → `Inbox/Web/` con `status: unread`. **Se adelanta**: va después del priorizador (B-732), no al final | TODO | builder | B-602, B-732 | 92 notas en la cola, ya ordenadas por señal; la cola pasa de 175 a ~267 sin abrumar |
| B-603c | **E2 — el volumen de X**: ~358 bookmarks restantes + 200+ likes → `Inbox/Legacy/`. Sigue último: necesita la capa de conceptos para ser navegable | TODO | builder | B-603b, B-724 | Material indexado y consultable, sin competir por atención |
| B-603 | F7.2 — Backfill del histórico: CLI paceado (patrón `score-wishlist`) + clasificación Batch API + escritura a la KB | TODO | builder + user | B-602, D2 decidida | Histórico clasificado en la KB; la cola no se inunda |
| B-604 | F7.3 — Likes desde el archive ZIP → notas **agregadas** por autor/tema (no una nota por like) | TODO | builder | B-602 | Likes consultables sin ensuciar el graph de F6 |
| B-605 | F7.4 — Enganche con F6: vault-gardener cita y conecta material de X en `/vault-ask` y `/vault-link` | TODO | system-architect | B-603, B-502 | 1 pase real que conecte notas de X con notas existentes |

## Secuencia unificada del segundo cerebro (`docs/SEGUNDO-CEREBRO.md` §5)

> El hilo que conecta F6 + F7 + F8 en 5 pasos donde cada uno alimenta al siguiente. Confirmado por Fede 2026-07-31.

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-720 | **Paso 1** — Validar el demo de F6.1 (mismo que B-711). ~20 min de Fede. Calibra el linking antes de escribir nada | TODO | **user (manual)** | — | 10 conexiones marcadas sirve/no-sirve |
| B-725 | **Paso 1b** — Migrar la vault de iCloud a Obsidian Sync | **DONE** | user (manual) | — | ✅ 2026-08-01: vault en `~/fedenotes`, 676 notas, 3 plugins y `data.json` intactos, 0 rastros en iCloud. Cierra B-006 |
| B-726 | **Paso 2** — Git en la vault (backbone de undo) | **DONE** | builder | B-725 | ✅ 2026-08-01: `git init` + `.gitignore` + commit baseline `9ce8ee3`, 702 archivos versionados. Habilita §4.2 (escritura libre en `Concepts/`) |
| B-721 | **C1** — Ritual diario | **DONE** | builder | — | ✅ `4b860bc`: `src/daily-ritual.ts` puro + comando "Repaso del día" → `Diario/Repaso YYYY-MM-DD.md`. 1 highlight + ≤2 conexiones + ≤2 lecturas (cabe en 60s). Determinista por fecha; conexiones priorizan notas-concepto. 11 tests |
| B-722 | **B2a** — `shelfLife` en el intake | **DONE** | builder | — | ✅ `af9c18f`: lista cerrada validada, opcional end-to-end, badge "caduca" en la card. **Pendiente: pase retroactivo sobre las 175 de `Inbox/Web` (~$0.15, escritura en vault → gated)** |
| B-723 | **B2b** — `tldr` en el intake + card | **DONE** | builder | B-722 | ✅ `af9c18f`: una línea de "por qué te importaría", truncado a 200, nunca pisa un tldr existente; en la card a 2 líneas. 8 tests |
| B-724 | **Fase D** — Primeras notas-concepto de `tech`+`producto`. **Regla corregida (ADR-005 §9-bis.3): NO se excluye lo no leído, se MARCA.** Cada concepto lleva estatus `conocido` (≥2 leídas, síntesis completa) / `emergente` (1 leída) / `latente` (solo no leídas → se lista, no se sintetiza) | TODO | builder + vault-gardener | B-731, B-726 ✅ | Notas-concepto con estatus explícito; los `latente` se promueven solos al leer |
| B-730 | ⬆️ **SUBE A BLOQUEANTE** — `status: unread` explícito en las 175 notas de `Inbox/Web` (hoy 0 lo tienen; se infiere por ausencia). Con el estado de lectura en el centro del modelo de relevancia (ADR-005 §9-bis), deja de ser cosmético | TODO | builder | B-726 (git ✅) | Las 175 con `status: unread`; queries de relevancia funcionan sin inferencia |
| B-731 | **Bug de diseño de `vault-gardener`**: el 1er pase ignoró el estado de lectura — 15 de 17 notas conectadas estaban SIN LEER. Debe clasificar cada conexión en **consolidar** (leída↔leída) / **atraer** (leída↔no leída) / **agrupar** (no leída↔no leída) | TODO | system-architect | B-730 | Nuevo pase con los 3 tipos separados; las "atraer" alimentan la priorización de la cola |
| B-732 | **C2 — Priorizador de cola** | **DONE** | builder | B-722 ✅ | ✅ `8814b81`: `src/priority.ts` puro + modo de orden "Vale la pena". Contexto (log2, rendimientos decrecientes) × shelfLife × topic activo. **Cada card explica por qué** quedó donde quedó. 14 tests |
| B-724c | **Canon de conceptos sobre las 238 notas leídas** — 27 conceptos canónicos cubriendo 149 notas (63%), incluidas las 170 de `Legacy/Matter` que tenían 0% de cobertura. Enfoque top-down (vocabulario cerrado → etiquetado); el bottom-up falló | **DONE** | builder | — | ✅ `proposals/2026-08-01-canon-conceptos.md` + `concept-canon.json`. 2 de los 3 conceptos manuales reaparecieron solos = validación cruzada |
| B-733 | Reintentar las notas sin cubrir | **DONE** | builder | B-724c | ✅ `relabel-missing.mjs` (incremental, idempotente, usa el canon filtrado como vocabulario): **cobertura 63% → 89%** (213/238), +64 encajes, 22 sin encaje real. Cluster mayor verificado, no degradado |
| B-735 | Ajustar el prompt del vocabulario para que no genere conceptos-paraguas (6 se descartaron por >20 fuentes en el 1er pase) | TODO | builder | B-733 | Ningún cluster nace con más de ~20 fuentes |
| B-734 | Materializar el canon como notas-concepto en la vault | **DONE** | builder | B-733 | ✅ vault `2121d89`: `write-concept-notes.mjs` → **Concepts/ de 3 a 29 notas**, 516 wikilinks, **0 rotos** (verifica stems reales antes de escribir). No pisa las manuales; dedupe explícito de "Contra-posicionamiento" |
| B-736 | Enriquecer a mano las 4-6 notas-concepto más densas (*Herramientas sin agencia propia* 25, *Manipulación institucional de la verdad* 22, *Incomodidad deliberada* 22, *Compounding* 21) con síntesis redactada, como las 3 primeras. Las generadas tienen evidencia pero no argumento | TODO | vault-gardener | B-734 | Síntesis en primera persona anclada en highlights, no lista de citas |
| B-724b | **3 notas-concepto escritas** (estatus `conocido`) | **DONE** | builder | B-726 ✅ | ✅ vault `6d24e55`: *Poder de mercado y contra-posicionamiento* · *Asignación de un recurso finito* · *Inventar la técnica, no aplicarla*. 22 wikilinks, 0 rotos. Cada una lista sus pendientes |

## Operación y escala de la KB (ADR-006)

> Modelo de ejecución en ADR-006 §4-bis: determinista = el plugin (gratis, runtime) · semántico = Claude (por lotes, programado) · git = detector de cambios para mantenimiento incremental.

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-710 | ADR-006 — modelo operativo (PULL/PUSH/DISCOVERY), 3 capas de acceso para escalar a 3.000+ notas, rituales por frecuencia, gobernanza consolidada. **Corolario: F6 es prerequisito de F7, no al revés** | PROPOSED | system-architect | — | `ADR-006`. Pendiente OK de Fede a la secuencia de §6 |
| B-712 | **Gardener programado** — `~/bin/gardener.sh` + LaunchAgent semanal. Usa `git diff` desde el último run para procesar **solo lo cambiado** (centavos en vez de dólares). Escribe únicamente en `Concepts/` y `Daily/`; no corre si el árbol está sucio; log auditable en `Daily/gardener.md` | TODO | builder + user | B-724 (que existan conceptos) | 1 corrida real que promueva ≥1 concepto y deje log |
| B-713 | **Pase retroactivo de `shelfLife`+`tldr`** sobre `Inbox/Web` | **DONE** | builder | B-722 ✅ | ✅ 2026-08-01: **169/175** vía `scripts/backfill-shelflife.mjs` (idempotente, concurrencia 6). **evergreen 100 · seasonal 61 · perishable 8** — la cola es 59% atemporal, o sea hay poco que descartar y mucho que priorizar |
| B-714 | 🧹 **6 notas huérfanas en `Inbox/Web`** — solo frontmatter, sin título/URL/cuerpo (97-178 bytes): *Getting started with loops*, *On Grindslop* (×2), *The AI Future Is for Everyone*, *The Most Human Technology Ever Made*, *The Reverse Information Paradox*. El clasificador les puso `topic`+`tags` sobre nada. Ocupan lugar en la cola y no se pueden leer | TODO | builder | — | Investigar por qué el intake las dejó vacías; re-procesar desde la URL original o borrarlas |
| B-711 | ⚠️ **BLOQUEANTE DE TODO F6** — validar el demo `proposals/2026-07-13-producto-tech-connections.md` (10 conexiones + 3 notas-concepto + ask-your-vault sobre 19 notas). Esperando desde 2026-07-13 | TODO | **user (manual)** | — | Fede dice qué conexiones sirven y cuáles no → calibra antes de escalar a 8 dominios |

## F8 — Relevancia y resurfacing unificado (ADR-005)

> De "variedad aleatoria" a "relevancia". Un solo ranking sobre todo el corpus (highlights web/Kindle/Matter/X + artículos + bookmarks). Caso de uso guía: la impresora diaria — obliga a que no haya silos por fuente. Diseño en `ADR-005`.

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-700 | ADR-005 — modelo de relevancia (2 ejes: fuerza del acto × estado de resolución), score determinista, 3 intenciones de resurfacing (Recordar/Reconsiderar/Conectar), impresora desacoplada por archivo | PROPOSED | system-architect | — | `ADR-005`. Pendiente OK de Fede a los pesos del Eje A y a "Reconsiderar" |
| B-701 | R1 — `ArticleSource` += `"x"`: los highlights/tweets de X entran al resurfacing existente | TODO | builder | B-700, B-608 | `pickDailyHighlights` mezcla 4 fuentes; tests |
| B-702 | R2 — `score()` determinista + `pickDailyHighlights` pasa a **round-robin ponderado** (hoy todas las fuentes pesan igual y dentro de cada una es azar puro) | TODO | builder | B-701 | Módulo puro + tests; mismo día = mismo resultado |
| B-703 | R3 — Intención **Reconsiderar**: no-leídos >6 meses + acción "sube a la cola / descartar". Cap ≤1 por semana (riesgo: máquina de culpa) | TODO | builder | B-702 | Query + comando; no aparece más de 1×/semana |
| B-704 | R4 — Intención **Conectar**: par de ítems de fuentes distintas con `topic` común en el digest. Es el mecanismo real de "que no sean cosas independientes" | TODO | builder | B-702 | Sección nueva en el digest diario |
| B-705 | R5 — `Daily/print-queue.md` + script externo (LaunchAgent, ESC/POS). El plugin no habla con hardware | TODO | builder + user | B-702 | Nota generada; impresión verificada con hardware real |

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
