# F6 Fase 1.5 — Plan (v2, endurecido con crítica adversarial)

> Estado: **v2 — convergido**. Draft (it.1) → crítica adversarial verificada contra el código (it.2) → esta reescritura resuelve las 6 fallas críticas. Owner: `system-architect`. Base: `knowledge-graph-vision.md`, `ADR-002`, demo `proposals/2026-07-13-producto-tech-connections.md`.

## El reencuadre honesto (corregido en it.2)

La idea de Fede —"cuando leemos el artículo para clasificarlo, extraigamos los conceptos"— es correcta en el **timing** (extraer una vez, en la ingesta, cachear). Pero la verificación contra el código la matiza:

- El `classify` real (`src/topics.ts:135`, `src/main.ts:842`) usa solo `excerpt.slice(0, 600)`, **Haiku**, `max_tokens: 80`. Alcanza para bucketear en 7 topics; **no** para extraer ideas atómicas de un ensayo largo.
- Por lo tanto la extracción de conceptos es un **call propio, más grande** (full body + registro + modelo fuerte), disparado en el momento del intake, **no un rider del classify** (meterla ahí arriesga regresionar la clasificación, que ya funciona y está shipeada).

**El win real no es "gratis con classify" — es "extraer una vez y cachear".** Y una segunda verdad honesta: el grafo determinístico de conceptos compartidos da **volumen** (scaffolding); el **insight** (las conexiones "wow" del demo: harness↔PG, ensayo open-source de 2005 prediciendo el colapso de la capa de modelo) sigue viniendo del **pase LLM cross-concepto caro**. No nos engañamos: lo determinístico es andamiaje, no el producto.

## Los 5 pilares del diseño de extracción

1. **Extracción = call propio.** Módulo `src/extract-concepts.ts` espejando `topics.ts`. Full body, modelo fuerte (Sonnet), output amplio, registro inyectado. `classify` queda intacto.
2. **Vocabulario controlado vía DOS pasadas** (single-pass "prefer-existing" NO converge — es orden-dependiente y el LLM no colapsa solo `forward-deployed`/`FDE`/`forward deployed engineers`):
   - Pasada 1: extracción **open-vocabulary** (candidatos crudos por nota).
   - Pasada 2: **canonicalización** (clustering por embeddings o merge LLM sobre el set completo de candidatos) → vocabulario controlado + **alias map `raw→canonical`** → normalizar. Acá converge el vocabulario, no en el orden de llegada.
3. **Identidad de nota estable** (la vault no tiene UID, filenames con espacios, slugs cambian, hay dup de iCloud): clave primaria `url` (presente en 447) / `asin` (books), fallback content-hash, **paso de dedup explícito**. Se decide en **A1**.
4. **Grafo = star topology + IDF, NO shared-≥1** (shared-≥1 es generador de hairball y contradice `vision §7`):
   - Aristas note→**concept-hub**, no cliques note↔note.
   - Co-ocurrencia ponderada por **rareza del concepto (IDF)**: compartir un concepto raro es señal; compartir `AI` es ruido.
   - Candidato note-note solo si comparten **≥2 conceptos o 1 concepto raro**. Cap duro de aristas por nodo.
5. **Caché incremental + prompt caching.** `conceptsExtractedAt`/`conceptsModel` (patrón `matchScoredAt`, `books-data.ts:176`). **Prompt caching del prefijo del registro** (`cache_control` no se usa hoy en ningún lado) — mayor palanca de costo en un run de ~629 calls con prefijo compartido.

## Home del registro (load-bearing, se decide en A1)

- **Backfill** (script tsx, Node `fs`): el registro vive como archivo del repo — sin problema.
- **Plugin futuro (A4, extracción en intake):** el plugin corriendo en Obsidian **NO puede leer un archivo del repo**. Necesita una copia **in-vault** (write gated) o **bundleada** en el plugin. **Si esto no se resuelve en A1, A4 no es construible.** Marcado como bloqueante.

## Costo honesto (la crítica lo destapó)

- La infra de `score-wishlist` reusa el **loop de pacing/retry/resume** (`anthropic.ts:postMessagesWithRetry`, `retry-after`, cost-cap USD) — eso sí transfiere. Pero la **economía de batching NO**: wishlist mete 50 items (asin+title) por call → ~13 calls totales; la extracción es **1 nota full-body por call → ~629 calls**.
- Estimado: ~3M input + ~0.2M output → **~$9-15 en Sonnet**; bastante menos con prompt-caching del registro. Con cost-cap como el script de wishlist. No es aterrador, pero es otro orden que el run de ~$4 del wishlist — y hay que decirlo.

## Scope de 1.5 (recortado)

Solo **`concepts:`** (+ `conceptsExtractedAt`, `conceptsModel`). **`entities:` y `claims:` se difieren a Fase 2** — nada en 1.5 los consume y `claims:` es la extracción más cara y menos confiable (era scope creep).

## Workstreams

### WS-A — Extracción de conceptos (keystone)
- **A1 — Schema + estrategia (ADR-003).** Incluye explícitamente: identidad de nota (pilar 3), **home del registro** (bloqueante), las dos pasadas de canonicalización (pilar 2), **gate de min-content-length + exclusión por calidad de fuente** (marketing/affiliate + stubs de Matter emiten conceptos basura — filtrar ANTES de extraer, no ponderar después). Granularidad del vocabulario: **validar empíricamente en D1**, no fijar a 50-200 a ciegas.
- **A2 — `extract-concepts.ts`** (call propio, Sonnet, full body, prompt-cache del registro). Salida al sidecar repo.
- **A2b — Canonicalización** (pasada 2): cluster/merge de candidatos → vocab controlado + alias map.
- **A3 — Backfill 629 → sidecar** `docs/vault-gardener/concept-index.json`. Con gate de A1 + dedup. Paced + cost-capped. **Sin tocar la vault** (suggestion-only).

### WS-B — Escalar discovery (item 1 del menú)
- **B1 — Grafo determinístico** desde el sidecar: star topology + IDF + ≥2-shared-o-1-raro + cap (pilar 4). Es **scaffolding**, no el producto.
- **B2 — Discovery semántica cross-concepto** (8 pasadas del `vault-gardener`) — **acá está el valor**. Usa el sidecar como scaffold. → proposals docs.
- **B3 — Consolidar** en índice de propuestas + notas-concepto candidatas, **rankeadas por confianza** (alimenta D2).

### WS-C — Agente `vault-gardener` + skills (item 2 del menú)
- **C1 — Agent def** `.claude/agents/vault-gardener.md`: persona jardinero, read-only en fase suggestion, memoria propia (mapa de conceptos + historial accept/reject de Fede), owner de `docs/vault-gardener/`.
- **C2 — `/vault-ask <pregunta>`**: RAG sobre notas crudas, cita títulos. **No necesita nada de WS-A → se puede construir YA, en paralelo.**
- **C3 — `/vault-link [dominio|nota]`**: envuelve B2.
- **C4 — Wire** on-demand.

### WS-D — Evaluación + ancho de banda humano (NUEVO — el cuello de botella real)
La visión entera muere si producimos un sidecar de 629 notas sin medir si es basura, o si volcamos ~330 links + ~100 conceptos que Fede no puede revisar.
- **D1 — Eval antes de confiar.** Gold set: etiquetar conceptos a mano en ~30 notas, medir acuerdo con la extracción. Muestrear N links candidatos, medir precisión. Fija empíricamente la granularidad del vocab. **No shipear el sidecar a ciegas.**
- **D2 — Triage de atención humana.** Ranking por confianza + budget "top-N esta semana" (D2 depende de cuántas propuestas/semana quiera revisar Fede). Es el **límite de escala real** de toda la visión.
- **D3 — Drift.** Cadencia de re-canonicalización + owner de merges a medida que entran notas nuevas.

## Coexistencia y política

- **444 wikilinks bibliográficos existentes** (autor/publicación): los concept-links son una capa distinta; **no tocarlos**.
- **Seam de permisos = política, no línea arquitectónica limpia.** `rankMyWishlist` ya hace un bulk write de 244 fichas en runtime → la distinción "runtime vs bulk" ya filtra. La extracción en intake se habilita como **política** (OK de Fede + cost-cap, como hizo score-wishlist), no como frontera limpia.

## Secuencia (revisada)

```
A1 (schema · identidad · home-registro · canonicalización · gates)
  ├─> A2 → A2b → A3 (backfill → sidecar)  ──┐
  └─> D1 (eval sobre muestra ANTES de confiar en el sidecar completo)
C1 + C2 (/vault-ask — sin dependencia de WS-A) ──────────────────────┤ (paralelo desde el día 1)
                                                                     ├─> B1/B2 vía C3 (discovery con sidecar)
                                                                     └─> B3 + D2 (consolidar + triage)
A4 (flush concepts → frontmatter + integración intake del plugin) = FASE 2 (git), diferido
```

Todo suggestion-only, sidecar en repo, **sin git y sin escribir la vault** en esta fase.

## Decisiones abiertas para Fede

1. **Granularidad del vocabulario** — se valida empíricamente en D1 (no fijar a ciegas). ¿Preferís un vocab chico y grueso o grande y fino?
2. **¿Extracción en intake como feature del plugin YA** (solo notas nuevas, política + cost-cap) **o espera a Fase 2?** — depende de resolver el home del registro (A1).
3. **Canonicalización: embeddings vs merge LLM** (A2b) — embeddings es más barato y determinístico; el merge LLM entiende mejor sinónimos conceptuales.
4. **Ancho de banda:** ¿cuántas propuestas por semana querés revisar? Define D2 y todo el ritmo de la fase de escritura.

---
*Historial de iteraciones del loop:*
- **It.1 (2026-07-13)** — draft inicial.
- **It.2 (2026-07-13)** — crítica adversarial (verificada contra código: `topics.ts`, `main.ts`, `anthropic.ts`, `score-wishlist.ts`). Resueltas 6 fallas críticas: (1) extracción = call propio, no rider de classify; (2) canonicalización en 2 pasadas; (3) identidad de nota estable; (4) star topology + IDF anti-hairball; (5) costo honesto ~$9-15 + prompt caching; (6) home del registro decidido en A1. Agregado WS-D (eval + ancho de banda humano). Recortado `entities:`/`claims:`. **Convergido.**
