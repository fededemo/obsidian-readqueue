# FOR_FEDE.md — obsidian-readqueue

> Lo que necesitás leer (incluso meses después) para entender este proyecto profundamente.

## Qué es esto y por qué existe

Veniás de usar **Matter** (getmatter.com) hace años. Te funcionaba: clipeabas artículos del browser, leías cómodo en mobile, subrayabas con un swipe, y Matter exportaba los highlights a Obsidian, que es tu base de conocimiento.

Tres cosas te empezaron a molestar:

1. **Matter es servicio externo**. Ya pasó por una adquisición y un cambio de modelo. Mañana puede cerrar como cerró Omnivore en noviembre 2024.
2. **Querés vault como single source of truth**. Que TODO tu conocimiento (artículos, tweets, highlights de Kindle, bookmarks) viva en Obsidian. Hoy Matter es la parte que no controlás.
3. **Estás pagando dos suscripciones** (Matter + Obsidian Sync) que cubren parcialmente lo mismo.

Exploraste el camino "Karakeep self-host en VPS" y lo descartaste (más infra, más mantenimiento, vault deja de ser source of truth).

Después exploraste "todo en Obsidian crudo con Web Clipper". El problema: Obsidian Web Clipper guarda artículos OK pero no tiene **gestión de cola de lectura**. Te deja una carpeta plana de `.md` sin agrupar, sin shuffle, sin "qué leo hoy". Matter te daba justamente esa capa.

**Este proyecto construye solo esa capa que falta**: un plugin de Obsidian con vista de cola, group-by-topic, shuffle, "Read random", botón "Mark as read", y un intake job que parsea URLs guardadas desde apps que no soportan Web Clipper (Twitter, Reddit, WhatsApp en iPhone).

## Por qué un plugin de Obsidian y no una extensión de browser

Cuando arrancaste pensabas en "una extensión que guarde y maneje cola". Tres razones por las que pivoteamos a plugin de Obsidian:

1. **Web Clipper ya hace el save** (Safari Mac/iOS + Chromium). Reescribirlo es regalarse trabajo.
2. **El "Open in reading view" no se puede hacer desde el browser**. La URI `obsidian://open?vault=X&file=Y` no acepta parámetro de modo. Solo desde adentro de Obsidian con `WorkspaceLeaf.setViewState({state: {mode: 'preview'}})`.
3. **Mobile**: extensiones de Safari iOS son sandbox al browser. No corren UI persistente, no acceden a la vault, y no aparecen en el share sheet de otras apps. Un plugin de Obsidian Mobile sí: corre nativo dentro de la app, accede a la vault directo, registra vistas custom.

Esto te lo llevó tiempo de descubrir — el plan original tenía "extensión de browser". Cambió cuando verificamos que **Web Clipper de Safari iOS NO aparece en el share sheet de Twitter app**. Ahí cayó el plan original y se diseñó el que tenemos: combinar Web Clipper (donde aplica) con la share extension nativa de Obsidian Mobile (donde Web Clipper no llega), y el plugin parsea las URLs crudas con `defuddle`.

## Arquitectura — explicada con analogías

Pensá esto como **una oficina de correo + un lector personal**:

- **Web Clipper** es el cartero rápido que ya conoce los sobres lindos (artículos en Safari). Entra, los procesa entero (título, autor, imágenes, parseo limpio) y los deposita en `Inbox/Web/` listos para leer.
- **Share extension nativa de Obsidian Mobile** es el cartero general que acepta cualquier sobre (tweets, links de Reddit, mensajes de WhatsApp) pero solo deja la URL — no abre el sobre. Los deposita en `Inbox/Pending/`.
- **Intake job del plugin** es el clasificador interno: cuando abrís Obsidian, revisa `Inbox/Pending/`, abre cada sobre con `requestUrl()` + `defuddle` (el mismo cuchillo del cartero rápido), reescribe el contenido limpio en `Inbox/Web/`, y tira el sobre crudo. Resultado: indistinguible del clip directo.
- **Vista de cola del plugin** es tu mesa de lectura: agrupa los sobres por temática, te deja elegir uno random, los abre en el modo de lectura cómoda y te avisa cuáles ya leíste.

## Estructura del codebase

- **`src/main.ts`** — entry point. Registra la view, los comandos, el ribbon icon, el URI handler `obsidian://readqueue-random`, y arranca el intake job. Es el "router" del plugin.
- **`src/queue-view.ts`** — la vista lateral. Renderiza cards de artículos con título + source + topic + date. Maneja interacciones (click "Leer", click "Mark as read", dropdown group-by).
- **`src/queue-data.ts`** — la capa de datos. Lee `Inbox/Web/` con `app.vault.getMarkdownFiles()`, filtra por frontmatter (`status: unread`), agrupa por topic/source/date, aplica shuffle (Fisher-Yates) cuando se pide.
- **`src/read-action.ts`** — el "abridor". Recibe un `TFile`, abre con `leaf.openFile(file, {state: {mode: 'preview'}})` para forzar reading view. También maneja el "Mark as read" actualizando frontmatter con `app.fileManager.processFrontMatter`.
- **`src/intake.ts`** — la pieza crítica. Scanea `Inbox/Pending/`, para cada `.md` con URL: `requestUrl({url})` → `defuddle.parse(html)` → escribe `Inbox/Web/{slug}.md` → borra el pending. Maneja errores guardando `intake-error: <reason>` para no perder links si falla el fetch.
- **`src/settings.ts`** — config del plugin (carpetas source/destination, intervalo del intake, lista de tópicos válidos).

## Decisiones técnicas clave (y por qué)

### 1. `defuddle` como parser

Es el mismo motor que usa Web Clipper. Open source (MIT), maintainer es kepano (CEO de Obsidian). Decisión simple: si parsea bien para Web Clipper, parsea bien para nosotros. No reinventamos parsing HTML. Si en algún momento defuddle no alcanza para un sitio puntual (paywalls raros, JS-heavy SPAs), podemos agregar parsers específicos por URL pattern adentro de `intake.ts`.

### 2. Frontmatter como source of truth, no índice paralelo

Originalmente pensé en mantener un `Inbox/queue.json` o algo similar como índice. Lo descarté: si la fuente es markdown con frontmatter, dataview-style queries son posibles, y otros plugins pueden leer/escribir lo mismo sin coordinación. El precio: tenés que leer N archivos para listar la cola, pero con `app.metadataCache` Obsidian ya tiene eso cacheado.

### 3. Intake corre cuando Obsidian abre, no como daemon

Obsidian no es un servidor — cuando está cerrado, no corre nada. Eso es OK porque los items en `Inbox/Pending/` no se pierden, solo se procesan cuando abrís la app. Si guardás 5 tweets en el subte sin internet, cuando abrís Obsidian en casa el intake los procesa a todos. Trade-off aceptable.

### 4. No usar Obsidian Sync por ahora — usar iCloud

Tu vault `fedenotes` vive en iCloud Drive. Originalmente recomendé `MyNotes` con Obsidian Sync (más limpio), pero elegiste seguir con fedenotes/iCloud y desactivaste Sync. **Esto introduce un riesgo**: iCloud tiene problemas conocidos sincronizando `.obsidian/plugins/`. Para mitigar, distribuimos el plugin vía BRAT (que tiene su propio mecanismo de sync). Si BRAT se rompe, fallback es copia manual de los 3 archivos a iPhone.

## Bugs encontrados y cómo se resolvieron

*(vacío al momento del bootstrap — iremos llenando)*

## Trampas que ya están mapeadas (errores potenciales y cómo evitarlos)

### Trampa #1: editar templates de Web Clipper desde iOS
La UI de iOS no expone el campo `path`. Editar templates SOLO desde Mac, exportar JSON, importar en iOS. (Ya pasamos por esto — el user clipeó desde iOS y todo se fue a `Clippings/` porque el iOS no aplicaba el path correcto).

### Trampa #2: doble sync sobre la misma vault
Si dejás Obsidian Sync activo + iCloud + BRAT, vas a tener race conditions. Regla: una sola fuente de sync por vault. Para fedenotes elegiste iCloud, mantener Sync desactivado.

### Trampa #3: el `path` en Web Clipper es per-template, no global
No existe un "default destination folder global" en Web Clipper. Cada template tiene su `path`. Si creás un template nuevo y no setteás su path, va al de Obsidian default (carpeta root). Siempre revisar el path al duplicar templates.

### Trampa #4: `requestUrl()` puede fallar silencioso en mobile
La doc de Obsidian dice que funciona cross-platform, pero hay reportes de timeouts en mobile con conexiones flaky. El intake guarda `intake-error` en frontmatter para que veas qué falló sin perder el link.

### Trampa #5: `WorkspaceLeaf.setViewState({state: {mode: 'preview'}})` necesita que el view ya esté cargado
Si llamás setViewState antes de que `openFile` termine, no hace nada. Usar `await leaf.openFile(...)` antes de setViewState, o pasar el mode dentro del openFile call.

## Lecciones de ingeniería

### Cómo pensar este sistema

No es un read-it-later monolítico. Son **piezas chicas que se hablan vía frontmatter**:
- Web Clipper escribe `.md` → no sabe del plugin.
- Share extension nativa escribe `.md` → no sabe del plugin.
- El plugin lee `.md`, los muestra y los modifica → no sabe quién los escribió.

Esto es lo que hace que el sistema sea robusto: cualquier pieza puede romperse o cambiarse sin romper las otras. Si mañana sale un Web Clipper alternativo mejor, lo enchufás y el plugin sigue funcionando. Si defuddle es discontinuado, swappeás por otro parser sin tocar la vista de cola.

### Cuándo NO construir tu propia abstracción

El plan original era una extensión de browser propia con UI completa. Sería 2-3 semanas de trabajo. La realidad: Web Clipper ya hace 80% de eso y es mantenido por el equipo de Obsidian. Construir tu propio botón "Save" para reemplazar el del Web Clipper sería regalo gratis a la deuda técnica futura. **Regla**: si una herramienta oficial cubre tu caso al 70%+, integrala y construí solo el delta.

### Cuándo SÍ vale la pena escribir código propio

La gestión de cola SÍ vale construir porque:
1. No hay plugin existente que la haga (busqué).
2. La UX es opinable y específica para tu uso (group-by-topic + shuffle es raro).
3. El "force reading view on open" requiere un hook que solo un plugin puede instalar.
4. El intake cross-app es esencial para que el plan funcione en mobile y nadie más lo cubre.

Regla: codeás cuando el delta es único + pequeño + sin equivalente oficial.

## Si empezara de nuevo

- Habría arrancado por verificar el flujo "Share from Twitter iOS → Web Clipper" ANTES de planear todo el sistema. Ese fue el descubrimiento que mandó el plan original al tacho.
- Habría preguntado por la vault desde el primer turno en vez de asumir. Cambiar de MyNotes a fedenotes cambia varias cosas (sync strategy, BRAT vs symlink).
- Habría leído pigmistudio CLAUDE.md antes de proponer estructura de proyecto. El "Core Management Bundle" + `.claude/agents/` mínimo son convenciones que se aplican a todo.

## Próximos pasos (al momento del bootstrap)

1. ✅ Plan aprobado.
2. ✅ Fase 0 user-side: Web Clipper template apuntando a `Inbox/Web/`, share extension nativa apuntando a `Inbox/Pending/`, Sync desactivado en fedenotes.
3. ✅ Scaffold del proyecto + governance docs + repo.
4. ⏳ Implementar Fase 1 — orden recomendado:
   1. `queue-data.ts` + tests (la base de datos en memoria sobre la vault).
   2. `queue-view.ts` (UI del side panel).
   3. `read-action.ts` (open + force preview + mark as read).
   4. `intake.ts` (defuddle pipeline) — pieza más arriesgada, dejarla para cuando lo demás esté firme.
   5. URI handler `obsidian://readqueue-random` y settings tab.
5. ⏳ Distribuir a iPhone vía BRAT.
6. ⏳ 2 semanas de uso real. Si OK, declarar Fase 1 done y evaluar Fase 2 (CSS de reader, time-to-read, snooze).

## Última actualización

2026-05-30 — Bootstrap del repo y plan completo. Aún no hay implementación.
