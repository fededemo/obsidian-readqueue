# ADR-003: Contrato de extracción de conceptos (WS-A de F6 Fase 1.5)

## Status

**Proposed** (2026-07-13). Registra las decisiones de diseño de la extracción de conceptos, forzadas por la crítica adversarial del plan (it.2). **No se ejecuta todavía** — en esta etapa minimizamos costos (regla de Fede): primero se construye `vault-gardener` + `/vault-ask` (créditos, cero API), y el backfill (que sí cuesta API) se difiere hasta validar en un gold set.

## Context

La keystone de F6 es extraer `concepts:` una vez por nota y derivar el grafo. La crítica (verificada contra el código) desarmó la versión ingenua: la extracción **no** es un piggyback gratis sobre `classify` (que usa 600 chars, Haiku, 80 tokens → 7 topics). Este ADR fija el contrato correcto. Detalle en `docs/plans/f6-fase-1.5-plan.md`.

## Decisions

1. **Extracción = call propio, no rider de `classify`.** Módulo nuevo `src/extract-concepts.ts` (espeja `topics.ts`). Full body, output amplio, registro inyectado. `classify` queda intacto (ya funciona, no lo regresionamos).

2. **Identidad de nota estable.** Clave primaria `url` (447 notas) / `asin` (books); fallback content-hash; **paso de dedup explícito** (hay al menos un duplicado de iCloud). Sin esto el sidecar no es mergeable ni cacheable de forma confiable.

3. **Home del registro (bloqueante para el futuro plugin).**
   - Backfill (script tsx, Node `fs`): registro = archivo del repo. OK.
   - Plugin en Obsidian (extracción en intake, A4 diferido): **no puede leer un archivo del repo** → necesita copia in-vault (write gated) o bundleada. **Si no se resuelve, A4 no es construible.** Se decide antes de A4, no ahora.

4. **Vocabulario controlado en DOS pasadas** (single-pass "prefer-existing" no converge):
   - Pasada 1: extracción open-vocabulary (candidatos crudos).
   - Pasada 2: canonicalización (clustering por embeddings — barato/determinístico — o merge LLM para los bordes) → vocab controlado + alias map `raw→canonical` → normalizar.

5. **Gates ANTES de extraer** (no ponderar después): min-content-length + exclusión por calidad de fuente (marketing/affiliate + stubs de Matter emiten conceptos basura).

6. **Costo minimizado (regla de esta etapa):**
   - Backfill por default en **Haiku** (~$3-4 las 629 notas) — escalar a Sonnet solo si el gold set (D1) muestra que Haiku no alcanza.
   - **Prompt caching** del prefijo del registro (mayor palanca; `cache_control` no se usa hoy en el repo).
   - **Cost-cap en USD** como hizo `scripts/score-wishlist.ts`. Reusar su loop de pacing/retry/resume (`anthropic.ts:postMessagesWithRetry`), NO su economía de batching (extracción = 1 nota full-body por call).
   - Caché incremental `conceptsExtractedAt`/`conceptsModel` (patrón `matchScoredAt`).

7. **Scope recortado:** solo `concepts:` en 1.5. `entities:` y `claims:` diferidos a Fase 2 (scope creep; `claims:` es la extracción más cara y menos confiable).

8. **Suggestion-only:** el backfill escribe al sidecar `docs/vault-gardener/concept-index.json` (repo), NO al frontmatter de la vault. El flush a frontmatter + la integración en intake del plugin (A4) son Fase 2, con git.

## Consequences

- ➕ El costo real (billetera API) queda acotado y diferido: ~$0.50 de eval antes de comprometer ~$3-4 de backfill; nada se gasta a ciegas.
- ➕ El sidecar queda mergeable y cacheable (identidad estable), y el vocabulario converge (2 pasadas).
- ➖ Dos pasadas + canonicalización + gates = más piezas que la versión ingenua. Es el precio de que el sustrato no sea basura.
- ➖ `entities:`/`claims:` diferidos: algunas queries ricas esperan a Fase 2.

## References

- `docs/plans/f6-fase-1.5-plan.md` — el plan v2 completo (workstreams, secuencia, WS-D eval + ancho de banda).
- `ADR-002` — home = readqueue-F6, suggestion-only. `ADR-001` — read-only + gate de escritura.
- Código citado por la crítica: `src/topics.ts:135`, `src/main.ts:842,1309`, `src/anthropic.ts`, `scripts/score-wishlist.ts`, `src/books-data.ts:176`.
