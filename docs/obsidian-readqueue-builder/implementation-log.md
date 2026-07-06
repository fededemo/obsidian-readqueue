# Implementation log — obsidian-readqueue-builder

## 2026-07-05 — F5 (MX22 + MX23 modelo + MX24 + MX25)

### Gotchas / cosas que sorprendieron

- **`DOMParser` NO existe en el service worker MV3.** `extension/src/background.ts`
  creaba `new DOMParser()` y lo pasaba a `parseLibrary`/`parseBookHighlights` en
  el SW → `ReferenceError` en runtime → el sync **nunca pudo haber funcionado** en
  la primera corrida (confirmado por lectura del código; el fallback regex de
  `parseLibrary` tampoco se alcanzaba porque `parseDom(html)` tira antes). Fix:
  parseo delegado al offscreen document (que sí tiene DOM). `parseBookHighlights`
  no tiene fallback regex, así que regex-only no alcanzaba — el offscreen era la
  única opción correcta.

- **La extensión NO se typechequea.** `tsconfig.json` incluye solo
  `src/**`, `tests/**`, `scripts/**` — no `extension/**`. Y no hay `@types/chrome`.
  Así que `npm run typecheck` no cubre la extensión; solo `esbuild` la bundlea (sin
  chequear tipos). → El código compartido va en `src/` (testeable + typechequeado)
  e importado por la extensión desde `../../src/`. Verificar la extensión con
  `npm run build:extension` (atrapa imports rotos/sintaxis, no tipos).

- **Wishlist pública fetcheable server-side.** `requestUrl()` (equivalente a curl
  `--compressed`, sin cookies) trae la wishlist compartida en HTTP 200, sin captcha.
  Estructura estable: `<a id="itemName_<ID>" title="..." href="/dp/<ASIN>/...">`,
  byline en `item-byline-<ID>`, paginación en
  `<input name="showMoreUrl" value="/hz/wishlist/slv/items?...&paginationToken=...">`.
  El byline trae el binding entre paréntesis (`(Kindle Edition)`) → hay que sacarlo
  del autor. Página 2+ devuelve un fragmento `<ul id="g-items">` con el mismo shape.

- **Modelos que emiten thinking rompen `content[0].text`.** El lector viejo de
  classify hacía `data.content[0].text`. Con Sonnet 5 (thinking adaptativo por
  omisión) `content[0]` puede ser un bloque `thinking` con texto vacío. `src/anthropic.ts`
  → `extractTextFromMessage` junta **todos** los bloques `text` (robusto). Y el
  recomend call manda `thinking: {type:"disabled"}` para evitar que el thinking se
  coma `max_tokens` en una llamada no-streaming.

- **Reset seguro por construcción.** Unificar la extensión al flujo `planMerge`
  del CLI (vía `planLibrarySync`) hace que "Reset libros" (sidecar vacío + archivos
  presentes) caiga en `init-state` → re-adopta sin reescribir. No hizo falta un
  confirm defensivo; la seguridad es estructural.

### Verificación

- 438 tests (baseline 379 → +59: kindle-sync-plan 9, wishlist 14, books-data 15,
  anthropic 10, recommend 11). `npm run typecheck` limpio. `npm run build` y
  `npm run build:extension` OK. CI de main verde al arrancar.

### Bloqueado (no es código)

- **Spike de endpoints del Cloud Reader (MX23 biblioteca)**: requiere la sesión
  autenticada de Fede en DevTools para descubrir el JSON de "Your Library". Todo
  downstream (fichas, `reconcileLibrary`, comando de reconcile por manifiesto) está
  listo. Backlog B-324.
