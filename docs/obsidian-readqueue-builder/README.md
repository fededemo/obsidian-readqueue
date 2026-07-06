# obsidian-readqueue-builder — workspace

Estado vivo del trabajo de implementación del builder. El estado canónico del
proyecto vive en `CLAUDE.md` + `docs/ROADMAP.md` + `CHANGELOG.md` (raíz).

## En vuelo / recién shipped (F5, 2026-07-05)

Todo en `[Unreleased]`, **sin release** (requiere OK de Fede). 438 tests verdes,
TS estricto pasa, plugin + extensión buildean.

- **MX22** — confiabilidad del sync Kindle shipped. Ver `CHANGELOG` [Unreleased].
- **MX24** — wishlist de Amazon → `Books/`.
- **MX25** — recomendador "¿Qué leo ahora?" + helper retry compartido.
- **MX23 (modelo)** — `Books/` + `books-data.ts` + reconcile. El **sync de
  biblioteca en la extensión está BLOQUEADO** en el spike de endpoints del Cloud
  Reader (necesita la sesión autenticada de Fede).

**Instructivo operativo para Fede**: `F5-INSTRUCTIVO.md` (Kindle + wishlist +
recomendador, paso a paso).

## Archivos nuevos de F5 (todos `src/`, puros y testeados)

| Módulo | Qué hace | Tests |
|---|---|---|
| `kindle-sync-plan.ts` | Planner de sync de biblioteca Kindle (offscreen + sidecar), espejo del CLI | `tests/kindle-sync-plan.test.ts` |
| `wishlist.ts` | Parse + paginación de wishlist pública de Amazon | `tests/wishlist.test.ts` (fixtures reales) |
| `books-data.ts` | Modelo de fichas de libro + `reconcileWishlist`/`reconcileLibrary` | `tests/books-data.test.ts` |
| `anthropic.ts` | Helper Messages API compartido: retry/backoff + extractText | `tests/anthropic.test.ts` |
| `recommend.ts` | Context pack + prompt + parser anti-alucinación + render de nota | `tests/recommend.test.ts` |

Extensión tocada: `background.ts` (parseo→offscreen + sidecar + `planLibrarySync`),
`offscreen.ts` (handlers `parse-library`/`parse-book`/`get-vault-state`/`write-sync-state`),
`popup.ts`+`popup.html` (permisos/errores), `handle-store.ts` (query/request permiso),
`extension/README.md` (reescrito).

## Decisiones tomadas en F5

- **F5.2 va por camino (a)**: el plugin trae la wishlist con `requestUrl()`
  server-side (verificado: HTTP 200 sin sesión). Cero permisos nuevos, funciona
  en mobile. No hizo falta scrapear con la extensión.
- **`source` de fichas**: `kindle-library` (biblioteca) / `readqueue-wishlist`
  (wishlist). El campo que distingue semántica es `shelf`, no `source`. (Pequeña
  desviación del label `source: kindle-library` genérico del plan §3.2, porque
  una ficha de wishlist puede ser un libro físico — flag para system-architect.)
- **`Books/` en la raíz** (no bajo `Inbox/`): es catálogo, no bandeja. Queda fuera
  del orphan-mover y de la cola.
- **`recommendModel` default `claude-sonnet-5`**; el recomend call va con
  `thinking: {type:"disabled"}` para que un `requestUrl` no-streaming devuelva JSON
  plano sin que el thinking adaptativo se coma `max_tokens`.

## Gotchas descubiertos

Ver `implementation-log.md`.
