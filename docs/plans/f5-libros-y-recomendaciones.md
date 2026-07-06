# F5 — Puesta en marcha de Kindle + Biblioteca + Recomendaciones de lectura

> **Estado: PLAN — nada de esto está implementado.** Documento de arquitectura para revisión de Fede.
> Escrito 2026-07-05. Autor: system-architect (sesión Claude).
> Contexto: v0.3.6 en `main`. El pipeline de Kindle highlights (MX8/MX9/MX12/MX13) está *shipped en código* pero **nunca corrió en la realidad**: la extensión de Chrome jamás se instaló ni configuró, el CLI jamás se ejecutó, `Inbox/Kindle/` no existe en la vault. Este plan arranca desde ese punto de partida real.

---

## 0. Resumen ejecutivo

**Objetivo de fondo**: que la vault sea un sistema de conocimiento que potencia el aprendizaje: capturar (artículos + libros) → leer → subrayar → repasar → conectar → decidir qué leer después. Las piezas de captura/lectura/subrayado de artículos ya funcionan. Lo que falta, en orden de dependencia:

| Fase | Qué | Depende de | Tipo de trabajo |
|---|---|---|---|
| **F5.0** | Poner en marcha el sync de highlights que ya existe (setup real + fixes de los bugs que bloquean) | — | Operativo + fixes chicos |
| **F5.1** | Biblioteca Kindle completa en la vault (libros que TENÉS, con o sin highlights) | F5.0 | Extensión + módulo nuevo |
| **F5.2** | Wishlist de Amazon en la vault | F5.1 (modelo de datos) | Scrape nuevo |
| **F5.3** | Recomendador "¿Qué leo ahora?" (Claude + context pack de la vault) | F5.1 (F5.2 suma pero no bloquea) | Plugin, reusa infra Claude |
| **F5.4** | Cerrar el loop: spaced repetition real + notas de síntesis | F5.0 | Plugin (visión, diseño aparte) |

**Principio rector** (ya decidido en el proyecto, se mantiene): la vault es la única fuente de verdad. Nada de VPS, servicios externos ni bases de datos: todo es markdown con frontmatter, y la inteligencia (clasificar, recomendar, sintetizar) son llamadas a la API de Claude que ya están integradas al plugin.

**Errores a evitar** (decisiones de este plan): no construir un motor de recomendación "en vivo" (una nota regenerada a demanda es el 90 % del valor); no tocar el merge de highlights que ya funciona y tiene 24 tests; no mezclar libros dentro de la Reading Queue en v1.

---

## 1. Punto de partida real — lo que hay vs. lo que corre

### 1.1 Lo que existe en código (verificado en el repo)

- **Extensión Chrome** (`extension/`): MV3, service worker + offscreen document. Scrapea `read.amazon.com/notebook` con la sesión del browser (`credentials: "include"`), escribe `.md` directo a una carpeta elegida con File System Access API (handle persistido en IndexedDB), auto-sync diario vía `chrome.alarms` (solo dispara con Chrome abierto). Estado (ASINs conocidos, highlights ya entregados) en `chrome.storage.local`. Los `.js` compilados están commiteados, así que se puede cargar sin buildear — pero pueden estar desactualizados respecto de `extension/src/*.ts`.
- **CLI** (`scripts/sync-kindle.ts`): one-shot con cookie manual copiada de DevTools, flags `--dest`, `--merge` (incremental con sidecar `.kindle-sync-state.json`), `--anthropic-key` (clasifica topic), `--dry-run`, `--force`.
- **Núcleo compartido** (`src/kindle.ts` + `src/kindle-merge.ts`): parseo del notebook, formato de nota (frontmatter `source: kindle-scrape`, `asin`, `status: read`, `tags: [reader, kindle, legacy]`, body con `## Highlights` en formato `> quote` + `*location*` + `📝 nota`), y merge incremental que appendea solo highlights nuevos sin pisar ediciones del usuario. 24 tests.
- **Plugin**: `kindleFolder` (default `Inbox/Kindle/`) se escanea solo para la vista de highlights y el repaso diario — **no** para la cola de lectura.

### 1.2 Lo que NUNCA pasó

- La extensión no está instalada en ningún browser.
- `Inbox/Kindle/` no existe en fedenotes; cero notas de libros.
- La vista unificada de highlights solo muestra web + Matter legacy.
- Nadie validó el scrape contra la cuenta real de Amazon de Fede (dominio, idioma, cantidad de libros, edge cases reales).

### 1.3 Bugs y fricciones detectados en la exploración (bloquean o degradan F5.0)

Ordenados por severidad:

1. **🔴 Posible bug fatal — `DOMParser` en el service worker.** `extension/src/background.ts` crea `new DOMParser()` y parsea el HTML del notebook **dentro del service worker MV3**, contexto que no expone `DOMParser`. El offscreen document (que sí tiene DOM) se declara con reason `DOM_PARSER` pero solo se usa para escribir archivos, no para parsear. Si esto es lo que parece, **el sync entero falla en la primera corrida**. Hay que verificarlo en runtime antes que nada; el fix natural es mover el parseo al offscreen (o usar el fallback regex que ya existe en `parseLibrary`).
2. **🟠 Permiso de File System Access que caduca.** "Allow on every visit" no siempre sobrevive reinicios de Chrome. Si degrada a `prompt`, re-pedirlo requiere un gesto del usuario — que no existe en el path del alarm — y el auto-sync muere con una notificación genérica. Mitigación: re-verificar/re-pedir permiso cada vez que se abre el popup, y que el error distinga "sin permiso" de "sin carpeta".
3. **🟠 El estado de sync vive solo en `chrome.storage.local`.** Si se desinstala la extensión o se toca "Reset libros", el próximo sync re-importa TODO como nuevo y `writeFile({create:true})` **pisa los `.md` existentes con tus ediciones**. El CLI ya resuelve esto con el sidecar `.kindle-sync-state.json` en la carpeta destino; la extensión debería leer/escribir ese mismo sidecar en la vault como fuente de verdad compartida (además el estado viaja por iCloud a otros dispositivos).
4. **🟡 "Reset libros" no advierte que es destructivo** para ediciones manuales.
5. **🟡 Dominio hardcodeado a `read.amazon.com`** (US) en scraper, manifest y URLs de nota. Si la cuenta de Fede es de otro marketplace, el fetch devuelve vacío o redirige. → pregunta abierta §10.
6. **🟡 Sesión de Amazon expira (~14 días).** El auto-sync empieza a fallar con "Sesión expirada" hasta que alguien reabre `read.amazon.com/notebook` y se loguea. Inevitable; hay que hacerlo visible, no silencioso.
7. **⚪ Doc de setup incompleta**: `extension/README.md` no menciona `npm install` previo, ni que solo funciona en Chromium (File System Access + offscreen no existen en Safari/Firefox), ni que la carpeta del picker debe coincidir a mano con el setting `kindleFolder` del plugin (son dos configs independientes).
8. **⚪ `topic: otros` hasta que el plugin clasifique.** La extensión no clasifica; depende de `classifyOnLoad` + `anthropicApiKey` en el plugin. Ya funciona así por diseño; solo documentarlo.

---

## 2. F5.0 — Puesta en marcha del sync de highlights

**Objetivo**: que al final de esta fase el pipeline shipped esté *operando de verdad*: highlights de Kindle en la vault, repaso diario mostrándolos, segundo sync sin duplicados.

### 2.1 Pre-trabajo de código (hito MX22 — "hacer confiable lo shipped")

Antes de pedirle a Fede que instale nada, resolver en este orden:

- **MX22-a — Verificar/arreglar el parseo en el service worker** (ítem 1 de §1.3). Test manual instrumentado primero (cargar la extensión, correr sync, mirar el service worker console); si `DOMParser` no existe, mover el parseo del HTML al offscreen document (mensaje nuevo `parse-notebook` → devuelve JSON al SW) o parsear con las regex de fallback. Tests: los fixtures de `tests/fixtures/` ya cubren el parser puro; agregar test del camino de mensajes si se mueve al offscreen.
- **MX22-b — Sidecar en la vault también desde la extensión** (ítem 3): el offscreen ya sabe leer/escribir archivos en la carpeta; persistir `.kindle-sync-state.json` ahí (mismo formato v1 del CLI: `{version, books: {asin: {deliveredKeys}}}`), con `chrome.storage.local` como cache. Regla de precedencia: sidecar de la vault gana. Esto convierte "Reset libros" y reinstalaciones en operaciones seguras.
- **MX22-c — Permisos y errores visibles** (ítems 2, 4, 6): re-request de permiso al abrir el popup; mensajes de error diferenciados (sin carpeta / sin permiso / sesión expirada / Amazon cambió el HTML); confirm de "Reset libros" que diga explícitamente que puede pisar ediciones (o mejor: con el sidecar de MX22-b, que ya no las pise).
- **MX22-d — Doc de setup completa** (ítem 7): prerrequisitos (Node, `npm install`, Chromium), el paso "crear `Inbox/Kindle/` primero", la alineación carpeta-picker ↔ `kindleFolder`, y la limitación "auto-sync solo con Chrome abierto".

Gobernanza: pre-flight `gh run list` (main verde), `npm run typecheck && npm run test` al cierre, sin release hasta OK de Fede.

### 2.2 Setup operativo (checklist para Fede, ~20 min)

1. En la vault (Obsidian o Finder): crear la carpeta `Inbox/Kindle/`.
2. En el repo: `npm install` (si no está) → `npm run build:extension`.
3. Chrome → `chrome://extensions` → activar **Developer mode** → **Load unpacked** → carpeta `extension/`.
4. Click en el ícono de la extensión → **"Elegir carpeta de la vault"** → navegar a `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes/Inbox/Kindle` → **"Allow on every visit"**.
5. En una pestaña: `https://read.amazon.com/notebook` → login con la cuenta de Amazon.
6. Popup → **"Sincronizar ahora"** → verificar que aparecen `.md` en `Inbox/Kindle/`.
7. En Obsidian: abrir la vista **Highlights** → deberían aparecer los libros con badge kindle; correr "Repasar highlights de hoy" y confirmar que mezcla fuentes.
8. Verificación de merge: correr "Sincronizar ahora" otra vez → cero duplicados, `highlightCount` estable.
9. Al día siguiente, con Chrome abierto: confirmar que el alarm disparó solo (popup muestra `lastSync`).

### 2.3 Decisión operativa: ¿cómo convive esto con un usuario Safari-first?

Fede usa Safari; la extensión requiere Chromium y el alarm solo corre con Chrome abierto. Opciones evaluadas:

| Opción | Pro | Contra |
|---|---|---|
| **A. Aceptar sync oportunista** (recomendada): el alarm corre cuando Chrome esté abierto; si pasan días, no pasa nada — el merge incremental se pone al día en una corrida | Cero trabajo extra; los highlights de Kindle no son urgentes (se acumulan en Amazon sin perderse) | Frescura variable |
| B. `launchd` que abre Chrome minimizado a la mañana | Frescura diaria | Fragilidad + Chrome siempre corriendo por un solo motivo |
| C. CLI vía `launchd`/cron con cookie | Sin Chrome | La cookie expira ~14 días → mantenimiento manual constante; peor que A |

**Decisión propuesta: A.** El dato que importa (¿leíste y subrayaste algo nuevo?) cambia a ritmo semanal, no horario. Reevaluar solo si en el uso real molesta.

### 2.4 Riesgo específico iCloud

La extensión escribe directo en una carpeta iCloud mientras el iPhone puede estar sincronizando. Mitigaciones ya presentes: el merge relee el archivo antes de tocar y cualquier error de lectura distinto de "no existe" aborta sin escribir. Riesgo residual: "conflicted copies" de iCloud si Obsidian iOS edita el mismo `.md` en la misma ventana — improbable (las notas de Kindle casi no se editan a mano) y detectable (archivos ` 2.md`). Aceptado; documentar en README.

### 2.5 Criterio de salida de F5.0

- ≥1 sync real exitoso con la cuenta de Fede; libros con highlights visibles en la vista unificada.
- Segundo sync idempotente (sin duplicados).
- `.kindle-sync-state.json` presente en `Inbox/Kindle/` (post MX22-b).
- Fede usó "Repasar highlights de hoy" al menos una semana → esto valida F5.4 antes de construirla.

---

## 3. F5.1 — Biblioteca Kindle completa en la vault (hito MX23)

**Objetivo**: la vault sabe qué libros TENÉS — comprados, samples, empezados, sin abrir — no solo los que tienen highlights. Es el insumo #1 del recomendador: "empezá por lo que ya compraste".

### 3.1 Fuente de datos — decisión con spike previo

El notebook solo lista libros **con** anotaciones. Para la biblioteca completa:

| Opción | Cómo | Pro | Contra |
|---|---|---|---|
| **(a) API interna del Cloud Reader** (`read.amazon.com`) — recomendada | El Cloud Reader carga la biblioteca vía endpoints JSON internos (mismo dominio que ya scrapeamos) | La extensión **ya tiene** `host_permissions` para `read.amazon.com` — cero permisos nuevos; JSON > HTML para parsear | Endpoint no oficial, no documentado; hay que descubrirlo |
| (b) Content & Devices (`www.amazon.com/hz/mycd/digital-console/contentlist`) | AJAX interno con CSRF token | Datos más ricos (fecha de compra, tipo) | Nuevo host permission (`www.amazon.com/*` — permiso amplio), CSRF, HTML/JSON más frágil |
| (c) Export manual periódico | — | Robusto | Fricción manual permanente; mata la idea |

**Plan**: spike de una sesión (MX23-a) con la sesión real de Fede: abrir el Cloud Reader con DevTools, capturar los endpoints de biblioteca, guardar las respuestas **anonimizadas como fixtures** en `tests/fixtures/`. Con eso se decide (a) vs (b) con datos, no supuestos. El spike es bloqueante del resto de MX23.

### 3.2 Modelo de datos: fichas de libro en `Books/`

**Decisión propuesta: fichas separadas de las notas de highlights.**

- Carpeta nueva **`Books/`** en la **raíz de la vault** (no bajo `Inbox/`): los libros no son "bandeja de entrada", son un catálogo permanente. Beneficio extra: queda estructuralmente fuera del alcance del orphan-mover y de la cola. Setting nuevo `booksFolder` (default `"Books/"`), siguiendo el patrón exacto de las 5 carpetas existentes en `settings.ts`.
- **Una ficha por libro**, nombrada con el mismo `slugifyForFilename(título-asin)` que las notas de highlights (consistencia + match trivial). Frontmatter:

```yaml
source: kindle-library        # nuevo source, distinto de kindle-scrape
asin: B0XXXXXXX
title: ...
author: ...
cover: https://m.media-amazon.com/...
shelf: owned                  # owned | sample | borrowed | wishlist (F5.2)
readingStatus: unread         # unread | reading | read | abandoned — PROPIEDAD DEL USER
acquiredAt: 2025-11-02        # si la fuente lo da
hasHighlights: true           # campo de máquina
highlightsNote: "[[<slug de la nota en Inbox/Kindle>]]"   # si hasHighlights
topic:                        # lo llena classifyOnLoad del plugin, como los artículos
```

- **Por qué fichas separadas y no extender las notas de highlights**: (1) el merge de highlights funciona y tiene 24 tests — no se toca; (2) `kindle.ts` hardcodea `status: read` y `tags: [reader, kindle, legacy]` en esas notas, semántica que no aplica a un libro sin abrir; (3) la ficha existe aunque el libro no tenga ni un highlight, que es justamente el caso que nos interesa (owned-unread).

### 3.3 Semántica de sync de fichas (crítico: quién es dueño de cada campo)

Regla simple para no repetir la clase de bug que ya mordió al proyecto (orphan-mover pisando estado):

- **La extensión solo CREA fichas que no existen.** Nunca reescribe una ficha existente.
- Campos **del usuario**: `readingStatus`, `topic`, tags, y todo el body (notas personales sobre el libro). Jamás los toca una máquina, salvo la clasificación de `topic` del plugin que ya tiene su gate (`classified`).
- Campos **de máquina** con update permitido: `shelf` (transición wishlist→owned al detectar compra, F5.2), `hasHighlights`/`highlightsNote` (cuando aparece el primer highlight). Estas actualizaciones las hace **el plugin** (que tiene `processFrontMatter`, atómico y respetuoso), no la extensión: la extensión deposita un manifiesto (`.kindle-library.json` en `Books/`, misma filosofía sidecar) y el plugin lo reconcilia al cargar. Así el código que toca frontmatter existente vive en un solo lado, testeado con Vitest.
- Módulo puro nuevo **`src/kindle-library.ts`**: parseo del JSON de biblioteca + planner de reconciliación (`create | update-machine-fields | skip`), espejo del diseño de `kindle-merge.ts`. Tests con los fixtures del spike, sin mocks (convención del proyecto).

### 3.4 Edge cases a cubrir en tests

- Samples y docs personales (send-to-kindle): `shelf: sample` / excluir docs (decidir con datos del spike).
- Prime Reading / Kindle Unlimited prestados y luego devueltos: `shelf: borrowed`; si desaparece de la biblioteca, la ficha NO se borra (historial > espejo).
- Libro comprado que ya estaba en wishlist: transición de `shelf` sin tocar lo demás.
- Títulos larguísimos / caracteres no-latinos (el slug de 80 chars ya lo resuelve — test explícito).
- Duplicados de ASIN o ediciones múltiples del mismo libro: last-write-wins por ASIN, es la key natural.
- Biblioteca grande (cientos de libros): paginación del endpoint + escritura batcheada (el offscreen escribe secuencial; medir, y si molesta, batch de a N con yield).

### 3.5 UI mínima

- Popup de la extensión: botón "Sincronizar biblioteca" separado del sync de highlights (cadencias distintas: biblioteca semanal, highlights diario) + contadores.
- Plugin: sección "Books" en settings (`booksFolder`); comando "Reconciliar biblioteca Kindle" (corre el planner a demanda); las fichas NO aparecen en la Reading Queue (§7 de decisiones).

---

## 4. F5.2 — Wishlist de Amazon (hito MX24)

**Realidad**: Amazon mató la API pública de wishlists hace años. Solo hay dos caminos, ambos scraping:

| Opción | Cómo | Pro | Contra |
|---|---|---|---|
| **(a) Lista compartida por link** — recomendada si es viable | La URL pública `amazon.com/hz/wishlist/ls/<id>` es HTML fetcheable **sin sesión**; hasta podría hacerlo el propio plugin con `requestUrl()` (patrón intake), sin tocar la extensión | Muchísimo más simple; cero permisos nuevos; corre también en mobile | Requiere que Fede ponga la lista como "compartida"; paginación por scroll infinito (parámetro `lastEvaluatedKey` en el HTML); riesgo moderado de bot-detection/captcha en fetch server-side |
| (b) Extensión con sesión | Nuevo `host_permission` para `www.amazon.com/*`, scrape autenticado | Funciona con lista privada | Permiso amplio; más código en la extensión; mismo parseo frágil |

**Plan**: preguntar a Fede si puede compartir la lista por link (§10). Si sí → (a) con spike de paginación primero (guardar fixtures). Si no → (b).

- **Modelo**: fichas en `Books/` con `shelf: wishlist`. Campos disponibles públicamente: título, autor, ASIN, cover, prioridad/comentario si la lista los expone. `addedAt` no está disponible público — se acepta; se registra `firstSeenAt` propio.
- **Transiciones**: ítem que desaparece de la wishlist y aparece en la biblioteca → `shelf: owned` (match por ASIN, lo hace el planner del plugin). Ítem borrado de la wishlist sin comprar → `shelf: wishlist` se mantiene con marca `wishlistRemoved: true` (señal para el recomendador: "te dejó de interesar").
- **Cadencia**: semanal alcanza. Si va por (a), job del plugin con `registerInterval` (patrón intake); si va por (b), alarm propio en la extensión.
- **Múltiples wishlists**: v1 soporta una sola (setting con la URL/id). Extensible después.

---

## 5. F5.3 — Recomendador "¿Qué leo ahora?" (hito MX25)

La pieza que motiva todo. Diseño alineado al patrón `topics.ts`: **módulo puro `src/recommend.ts`** con `deps.fetchJson` inyectable (testeable sin red), cableado en `main.ts` con el mismo wrapper de `requestUrl` que ya evita CORS.

### 5.1 Context pack — qué señales entran y de dónde

Todo ya está en memoria del plugin o a un scan de distancia; no hay I/O nuevo salvo leer `Books/`:

1. **Lo que leíste**: últimos ~30 artículos con `status: read` (título, topic, `readAt`) + distribución de topics a 30/90 días (extensión natural de `computeStats`).
2. **Lo que te resonó** (mejor señal que "leído"): highlights de los últimos ~60 días vía `collectHighlights()`, con su fuente y nota del usuario si la hay. Cap de tamaño: los N más recientes, texto truncado.
3. **Lo que ya tenés pendiente**: cola actual (unread + snoozed) — para que no recomiende comprar algo sobre un tema del que ya tenés 12 artículos sin leer.
4. **Lo que ya es tuyo**: fichas `Books/` con `shelf: owned` + `readingStatus: unread` (prioridad máxima) y `readingStatus: reading` (para decir "terminá X antes de empezar otro del mismo tema").
5. **Lo que querés**: `shelf: wishlist` (prioridad 2), incluyendo `wishlistRemoved` como señal negativa.
6. **Feedback previo**: las notas de recomendación anteriores (frontmatter `recommendedAsins`) + qué pasó con ellas (¿alguno pasó a `reading`? ¿fue ignorado 3 veces?).

Presupuesto estimado: 5–15k tokens de input. Aceptable para una llamada semanal/a demanda.

### 5.2 La llamada a Claude

- **Modelo**: setting nuevo `recommendModel`, default `claude-sonnet-5` (no Haiku: acá el valor está en el razonamiento cruzado, es 1 llamada por semana, el costo es centavos). `max_tokens` ~2000 (la infra actual usa 80 — es solo un parámetro del body).
- **Prompt (contrato de salida)**: 3–5 recomendaciones rankeadas en JSON: `{asin|null, title, source: "owned"|"wishlist"|"new", reason, connects_to: [títulos/highlights concretos del pack]}`. Regla de oro en el prompt: **primero owned-unread que matchee lo que venís leyendo/subrayando, después wishlist, y solo al final sugerencias nuevas** — con la instrucción explícita de que "nuevo" requiere justificar por qué nada de lo que ya tenés lo cubre. Es recomendador y anti-compra-compulsiva a la vez.
- **Parser robusto** estilo `parseClassifyReply` (regex de bloque JSON + validación campo a campo + descarte de ASINs que no existan en el pack cuando `source != "new"` — anti-alucinación).
- **Robustez de red — pagar deuda existente**: la infra de clasificación no tiene retry ni backoff (falla → `undefined` silencioso). Antes de sumar una segunda llamada a la API, extraer un helper compartido con retry simple (1 reintento con backoff en 429/5xx) que usen classify y recommend. Alcance chico y testeable.

### 5.3 Salida: nota de recomendaciones

Patrón digest (no sobrescribe si existe): **`Books/Recomendaciones/<AAAA-MM-DD>.md`** con:

- Frontmatter: `source: readqueue-recommend`, `recommendedAsins: [...]`, `model`, `generatedAt`.
- Body: por cada recomendación, título con `[[link a la ficha]]` (si existe), el porqué conectando con lecturas y highlights concretos (con `[[links]]` a las notas — eso lo vuelve navegable, que es el punto de hacerlo EN la vault), y una sección final "Empezá por lo que ya tenés" si aplica.

### 5.4 Triggers

- **v1: comando manual** "¿Qué leo ahora?" (`recommend-books`). Punto.
- v1.1 (si el uso real lo pide): job semanal opcional con gate "no regenerar si ya existe la nota de esta semana" — patrón exacto de `createDailyDigest`. Nunca un interval agresivo: es una llamada paga.

### 5.5 Privacidad

El context pack manda títulos, topics y fragmentos de highlights a la API de Anthropic. Ya pasa hoy con la clasificación (título + 600 chars de excerpt por artículo); esto amplía el volumen por llamada. Se documenta en settings junto al toggle, decisión consciente de Fede.

### 5.6 Feedback loop (v1 implícito, suficiente)

No construir UI de feedback en v1: el loop ya existe gratis — cuando Fede empieza un libro, edita `readingStatus: reading` en la ficha (o un comando "Empezar este libro" que lo haga); la próxima corrida del recomendador lee eso y las notas previas, y ajusta. V2 posible: checkboxes en la nota de recomendación que un job lea. Solo si el v1 se queda corto.

---

## 6. F5.4 — Cerrar el loop de aprendizaje (visión, diseño aparte cuando toque)

Se lista para que el norte quede escrito; **no entra en este ciclo**:

- **Spaced repetition real sobre highlights**: hoy el repaso diario es determinístico por fecha (round-robin por fuente). Upgrade: estado de repaso por highlight (visto N veces, intervalos crecientes tipo SM-2 simplificado) en un sidecar `.review-state.json` — nunca en el frontmatter de las notas (ruido). Requiere datos de uso real de F5.0 para diseñar bien.
- **Notas de síntesis sugeridas**: cuando ≥K highlights de ≥2 fuentes comparten topic, comando que arma un pack y Claude propone borrador de nota de síntesis con links a las fuentes. Es donde el conocimiento compone de verdad — y es exactamente el mismo esqueleto técnico que el recomendador (context pack → Claude → nota), por eso conviene DESPUÉS de validar F5.3.
- **Libros en la Reading Queue**: decisión explícita de NO mezclar en v1. La cola es de artículos (unidades de una sesión de lectura); los libros viven en fichas + recomendaciones. Si el uso real pide "quiero ver 'estoy leyendo X' en la cola", se revisa con datos.

---

## 7. Inventario de cambios (por archivo — sin código, para dimensionar)

### Extensión (`extension/`)
- `src/background.ts`: fix parseo DOMParser→offscreen o regex (MX22-a); orquestación de sync de biblioteca (MX23); precedencia sidecar vault > storage (MX22-b).
- `src/offscreen.ts`: handler `parse-notebook` (si aplica MX22-a); lectura/escritura de `.kindle-sync-state.json` y `.kindle-library.json`; escritura de fichas nuevas en `Books/`.
- `src/popup.ts` + `popup.html`: re-request de permiso al abrir; botón "Sincronizar biblioteca"; estados de error diferenciados; confirm honesto en "Reset libros".
- `manifest.json`: sin cambios de permisos si F5.1 va por Cloud Reader y F5.2 por lista compartida (ese es parte del valor de esas decisiones).

### Plugin (`src/`)
- `settings.ts`: `booksFolder` (default `"Books/"`), `recommendModel` (default `claude-sonnet-5`), sección "Books"; texto de privacidad.
- `kindle-library.ts` (nuevo, puro): parser del JSON de biblioteca + planner de reconciliación de fichas.
- `books-data.ts` (nuevo, puro): leer fichas de `Books/` (shelf, readingStatus) para el context pack y la reconciliación.
- `recommend.ts` (nuevo, puro): armado del context pack, prompt, parser de respuesta, render de la nota.
- `topics.ts` / helper nuevo compartido: extraer fetch con retry/backoff usado por classify y recommend.
- `main.ts`: comandos `recommend-books`, `reconcile-kindle-library`, "Empezar este libro"; job de reconciliación on-load (gate por setting); `booksFolder` agregado a `protectedPrefixes` del orphan-mover.
- `wishlist.ts` (nuevo, puro — MX24): fetch+parse de lista compartida con paginación (si va por la opción a, cableado con `requestUrl` en main).

### Tests y docs
- Fixtures nuevos: JSON de biblioteca Cloud Reader (anonimizado), HTML de wishlist paginada. Convención sin mocks se mantiene.
- Tests: `kindle-library` (parser + planner, target 80 %+ como intake), `recommend` (pack + parser anti-alucinación), `wishlist` (paginación), transición de shelf.
- Docs: `extension/README.md` (prerrequisitos + Chromium-only + alineación de carpetas), `docs/ROADMAP.md` (F5), `docs/backlog.md` (limpiar B-201/202/203/301/302 que figuran TODO pero están shipped — deuda documental detectada), `CLAUDE.md` al cierre de cada hito.

---

## 8. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| `DOMParser` roto en SW → sync nunca funcionó | Alta | Bloquea todo | MX22-a primero, con verificación en runtime antes de cualquier otra cosa |
| Amazon cambia HTML/endpoints internos | Media (por año) | Sync muere hasta parchear | Fixtures reales + parsers en módulos puros (parche barato); errores visibles, nunca silenciosos |
| Bot-detection/captcha en fetch de wishlist server-side | Media | F5.2-(a) inviable | Fallback diseñado: opción (b) vía extensión con sesión real |
| Permiso FSA degrada → auto-sync muerto en silencio | Media | Datos viejos sin saberlo | MX22-c: re-request en popup + error específico; `lastSync` visible |
| Sesión Amazon expira ~14 días | Alta | Sync pausado | Notificación clara; el merge se pone al día al reloguear — no se pierde nada |
| iCloud conflicted copies | Baja | Nota duplicada | Merge relee antes de escribir; notas kindle casi no se editan a mano; documentado |
| Costo/privacidad API (pack más grande que classify) | — | Centavos/semana; datos de lectura a Anthropic | Modelo y trigger manuales; texto explícito en settings; decisión de Fede |
| Sobre-ingeniería del recomendador | Media | Semanas perdidas | v1 = comando manual + nota; nada de UI de feedback ni jobs hasta validar con uso real |
| Fede no adopta el flujo (riesgo real #1 del proyecto: F1.6 "uso real sostenido" sigue abierto) | — | Todo lo demás es irrelevante | F5.0 tiene criterio de salida de USO (una semana de repaso diario), no solo técnico |

---

## 9. Secuencia de trabajo y estimaciones

Numeración: continúa MX22+ (último usado: MX21). Cada hito cierra con `npm run typecheck && npm run test`, CI verde, CHANGELOG en [Unreleased]; releases solo con OK explícito de Fede.

| Hito | Contenido | Estimación (sesiones) | Gate de entrada |
|---|---|---|---|
| **MX22** | Confiabilidad de lo shipped: fix DOMParser, sidecar en vault, permisos/errores visibles, docs de setup | 1–2 | main verde |
| **F5.0 op** | Setup real en la máquina de Fede + checklist §2.2 + una semana de uso | — (Fede) | MX22 |
| **MX23** | Spike endpoints biblioteca → `kindle-library.ts` + fichas `Books/` + reconciliación en plugin + UI mínima | 2–3 | F5.0 validada |
| **MX24** | Wishlist (camino según respuesta de Fede §10) | 1–2 | MX23 (modelo de fichas) |
| **MX25** | Recomendador: helper retry compartido, `recommend.ts`, comando, nota de salida | 2 | MX23 (MX24 suma señal pero no bloquea) |
| **MX26+** | F5.4 (repaso espaciado, síntesis) — diseño aparte | — | Uso real de F5.3 |

Total estimado del ciclo F5.0–F5.3: **6–9 sesiones de trabajo** + la semana de validación operativa en el medio. El camino crítico pasa por MX22-a (si el sync nunca funcionó, nada de lo demás tiene datos).

---

## 10. Preguntas abiertas para Fede (bloquean decisiones marcadas arriba)

1. **¿Tu cuenta de Amazon es de amazon.com (US)?** Si es de otro marketplace (`.es`, `.com.mx`, etc.), hay que parametrizar el dominio antes del primer sync (hoy está hardcodeado a `read.amazon.com`).
2. **¿Tenés Chrome (o Edge/Brave) instalado y lo abrís con alguna frecuencia?** La extensión es Chromium-only. Si tu respuesta es "casi nunca", el plan operativo sigue siendo válido (sync oportunista, §2.3-A) pero conviene saberlo.
3. **¿Tu wishlist de libros es una sola, y podés ponerla como "compartida por link"?** Define el camino de F5.2 (simple vs. extensión con permisos amplios).
4. **¿`Books/` en la raíz de la vault te cierra?** (vs. meterla bajo `Inbox/` — el plan recomienda raíz: es catálogo, no bandeja).
5. **¿OK con que el recomendador mande títulos + fragmentos de highlights a la API de Anthropic** (misma API que ya usás para clasificar), ~1 llamada Sonnet por semana?

---

*Este documento es el entregable de plan mode para F5. Nada se implementa hasta el OK de Fede sobre las decisiones propuestas y las preguntas de §10.*
