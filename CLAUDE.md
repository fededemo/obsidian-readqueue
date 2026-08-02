# CLAUDE.md — obsidian-readqueue

> Estado vigente de arquitectura, stack y convenciones. Lo que cualquier agente nuevo necesita leer primero para orientarse.

## Identidad

**obsidian-readqueue** es un plugin de Obsidian que reemplaza la UX de Matter (read-it-later) dentro de la vault. Resuelve la pieza floja de Obsidian Web Clipper: gestionar la cola de lectura.

- **Estado**: **v0.3.0 publicado**; todo lo de F5 en adelante está en `[Unreleased]` (655 tests verdes, TS estricto). F1–F4 shipped. **F5** (Kindle + wishlist + recomendador) code-complete, falta la puesta en marcha real. **F6/F7/F8 cerrados del lado del código**: el segundo cerebro tiene capa cruda, capa wiki (`Concepts/`), priorizador por grafo, ritual diario, X completo y gardener semanal. **Sin release hasta OK explícito de Fede.** Ver «Última actualización» al final y `docs/SEGUNDO-CEREBRO.md`.
- **Plan original**: `~/.claude/plans/imperative-sparking-dusk.md`
- **Vault target del user**: `fedenotes` en `~/fedenotes` (local, versionada con git, sincronizada con **Obsidian Sync**). Migrada desde iCloud el 2026-08-01 — ver `docs/SEGUNDO-CEREBRO.md` §4.7.

## Stack canónico

- **Lenguaje**: TypeScript estricto (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`).
- **Bundler**: esbuild → `main.js` (formato CJS, target ES2022).
- **Plataforma**: Obsidian Plugin API (desktop + mobile, `isDesktopOnly: false`).
- **Testing**: Vitest (unit + intake job logic).
- **Dependencia clave**: `defuddle` (npm) — el parser HTML→markdown que usa Web Clipper, escrito por kepano (CEO de Obsidian).

## Estructura del proyecto

```
obsidian-readqueue/
├── .claude/
│   ├── agents/                # system-architect, builder, qa-tester, vault-gardener (F6)
│   ├── agent-memory/          # auto-creada por cada agente (gitignored)
│   └── skills/                # symlinks al Core Management Bundle de gstack
├── docs/
│   ├── ROADMAP.md             # fases + deploy log (estándar pigmi)
│   ├── backlog.md             # P0/P1/P2/P3 con estado
│   └── architecture/          # ADRs
├── src/
│   ├── main.ts                # plugin entry — registra views, comandos, ribbon, intake job
│   ├── queue-view.ts          # ItemView del side panel "Reading Queue"
│   ├── queue-data.ts          # lee vault, filtra por frontmatter, agrupa
│   ├── read-action.ts         # abre nota + setViewState a 'preview'
│   ├── intake.ts              # parsea URLs en Inbox/Pending/ con defuddle
│   └── settings.ts            # carpetas, intervalo intake, etc
├── tests/
│   └── *.test.ts              # vitest
├── manifest.json              # config del plugin (obligatorio Obsidian)
├── versions.json              # compatibility matrix
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css                 # estilos del plugin (usa CSS vars de Obsidian)
├── CLAUDE.md                  # este archivo
├── FOR_FEDE.md                # conocimiento narrativo del proyecto
├── README.md                  # setup y desarrollo
└── .gitignore
```

## Arquitectura

### División de responsabilidades

| Pieza | Quién la hace |
|---|---|
| Capturar URL del browser (Safari Mac/iOS) | Obsidian Web Clipper (extension, no parte de este proyecto) |
| Capturar URL desde apps no-Safari (X, Reddit, WhatsApp) en iOS | Share extension nativa de Obsidian Mobile → escribe a `Inbox/Pending/` |
| Parsear URL pendiente a `.md` completo | **Intake job de este plugin** — `requestUrl()` + `defuddle` → escribe a `Inbox/Web/` |
| Listar la cola, agrupar, shuffle, "leer" | **Vista lateral de este plugin** |
| Forzar reading view al abrir nota | **Hook `workspace.on('file-open')` de este plugin** |
| Sync entre devices | Obsidian Sync o iCloud (no parte del plugin) |

### Frontmatter standard

Web Clipper escribe (template "Read Later" configurado por el user):

```yaml
---
source: web-clipper
url: https://...
author: ...
published: 2026-05-20
savedAt: 2026-05-30T14:30:00
status: unread
topic:                 # opcional, llenado por interpreter o manual
tags: [reader]
---
```

El intake job genera lo mismo más `intake: defuddle` para distinguir su origen.

### Carpetas en la vault del user

- `Inbox/Web/` — destino final de artículos parseados (Web Clipper directo o intake).
- `Inbox/Pending/` — buffer de URLs crudas guardadas por share extension nativa de Obsidian Mobile. El intake las procesa y borra.
- `Matter/` — histórico legacy del user, intacto.
- `Clippings/` — carpeta legacy del Web Clipper default, no se usa más.

## Convenciones de código

- **Idioma**: código en inglés (variables, funciones, types, componentes). Comentarios solo cuando el WHY es no-obvio. UI strings del plugin en español (es el user el único usuario).
- **No comentar el QUÉ**: los identificadores hablan. Comentás cuando hay un workaround, un invariante oculto, o algo que sorprendería al lector.
- **TypeScript estricto sin escapes**: no `any` implícito, no `// @ts-ignore`. Si necesitás un cast, justificalo.
- **Async-first**: la Obsidian API es async; no bloqueés el UI thread.
- **No mocks en tests de intake**: los tests de parsing usan HTML fixtures reales (snapshots de páginas conocidas) guardados en `tests/fixtures/`.

## Comandos útiles

```bash
# Dev — esbuild watch mode, regenera main.js al guardar
npm run dev

# Build de producción (minified, sin sourcemaps)
npm run build

# Typecheck sin emit
npm run typecheck

# Tests
npm run test
npm run test:watch

# Instalar en la vault local para probar
ln -s "$(pwd)" "/Users/federico/fedenotes/.obsidian/plugins/readqueue"
# (a mobile llega solo: Obsidian Sync propaga .obsidian/plugins/)
```

## Distribución a mobile

**RESUELTO 2026-08-01**: la vault salió de iCloud (`~/fedenotes`) y usa **Obsidian Sync**, que propaga `.obsidian/plugins/` nativamente. El plugin llega al iPhone solo, sin rodeos. Esto cerró B-006.

Alternativas históricas (ya no necesarias):

1. ~~**BRAT**~~: era la decisión previa por el problema de iCloud. `obsidian42-brat` sigue instalado; se puede desinstalar.
2. **Copia manual a iPhone**: vía Files app + Obsidian Mobile, depositar `main.js`, `manifest.json`, `styles.css` en `.obsidian/plugins/readqueue/`.
3. **Community store**: review largo (~1 semana), público.

Decisión actual: **Obsidian Sync**.

## Mandatory rules — heredadas de governance pigmi

1. **Pre-flight CI check antes de implementar cada feature**: `gh run list --branch main --limit 5 --json conclusion`. Main rojo → fix CI primero, no implementar feature.
2. **Plan Mode obligatorio** si hay >1 camino arquitectónico o si la implementación toca >2 archivos críticos del plugin.
3. **Verify, don't narrate**: cada cierre de feature corre `npm run typecheck && npm run test` antes de marcar como done.
4. **Code in English, UI en español** (este proyecto user-facing es 1 sola persona, FedeUI en español).
5. **No implementar sobre main rojo** (regla saccum 2026-04-08).

## Setup local del user

- **Vault**: `/Users/federico/fedenotes` (local + git + Obsidian Sync). **Ya no está en iCloud.**
- **GitHub**: `fededemo` (token con repo + workflow scopes)
- **Repo privado**: `github.com/fededemo/obsidian-readqueue`

## Acceso de Claude a la vault (`fedenotes`)

> La vault del user es **base de conocimiento read-only** para los agentes. Diseño completo en `docs/architecture/ADR-001-acceso-vault-obsidian.md`.

- **Lectura**: `Read`/`Grep`/`Glob` directo sobre `~/fedenotes` está permitido y es el camino canónico hoy (676 notas al 2026-08-01, todas materializadas localmente). Claude puede buscar, citar y razonar sobre la KB.
- **Placeholders `.icloud`**: ya no aplica — la vault salió de iCloud (2026-08-01). Todo está materializado localmente.
- **Escritura**: prohibida sin **OK explícito de Fede** (ya lo bloquea el classifier). Ninguna edición/borrado/movimiento de notas del user a mano.
- **No confundir** la vault del user con el repo del plugin. Lo que el *plugin* escribe en runtime (`Inbox/`, `Books/`, `Inbox/Kindle/`) es otra cosa que Claude tocando la vault.
- **headless Sync (`ob`) / Local REST API + MCP**: NO habilitados. Son para máquinas que *no tienen* la vault (agente cloud/CI) o para queries vivas grado dataview. En la Mac son redundantes con la lectura directa. Activar solo con el trigger del ADR-001.

## Decisiones arquitectónicas tomadas (referenciar ADRs cuando se escriban)

- ✅ **ADR-001 — Claude lee la vault por filesystem directo (Path A), read-only, escrituras gated**. headless Sync (`ob`, requiere sub Obsidian Sync) queda en reserva para una 2da máquina (cloud/CI) sin la vault; Local REST API + MCP queda opcional para queries vivas. Costo no es blocker (Fede paga Obsidian) pero Path B **no aporta valor en la Mac** y arriesga doble-sync. Ver `docs/architecture/ADR-001-acceso-vault-obsidian.md`.

- ✅ **No construir extensión de browser propia**. Web Clipper de Obsidian (Safari Mac/iOS + Chromium) cubre el flujo de save desde browsers; share extension nativa de Obsidian Mobile cubre apps no-Safari. Razón: cero duplicación, mantenimiento mínimo.
- ✅ **Defuddle como parser único**. Es el mismo motor que usa Web Clipper internamente, open source MIT, mantenido por kepano. Evita divergencia entre el parsing del Web Clipper y del intake job.
- ✅ **Intake job vive en el plugin, no en un sync service externo**. `requestUrl()` de Obsidian bypassea CORS y funciona en mobile. No hay infra externa.
- ❌ **Karakeep self-host descartado**. Era el plan A. Se descartó para mantener vault como single source of truth, sin VPS.

## Riesgos conocidos

- ~~iCloud + `.obsidian/plugins/`~~ — **RESUELTO 2026-08-01**: la vault salió de iCloud y usa Obsidian Sync, que propaga plugins nativamente.
- **Highlighter de Web Clipper en iOS Safari**: si resulta áspero, plan B es vivir con `==texto==` manual.
- **API de Obsidian con breaking changes**: revisar `minAppVersion` cada release del plugin.
- **defuddle en mobile**: package no testeado por nosotros en el WebView de Obsidian iOS. Si falla, fallback a un parser más simple basado en `<meta property="og:*">`.

## Test Coverage

Minimum: 50% (proyecto en early stage)
Target: 75%

Cobertura prioritaria:
- `intake.ts` (parsing de URL → markdown) — 80%+
- `queue-data.ts` (filtros y group-by) — 80%+
- `queue-view.ts` (UI) — 40%+ (E2E manual cubre el resto)

## Última actualización

2026-08-01 — **Segundo cerebro: fases A–F cerradas del lado del código.** El detalle vive en `docs/SEGUNDO-CEREBRO.md` (documento maestro) y `docs/backlog.md`. Lo que cambió y conviene saber antes de tocar nada:

- **La vault tiene ~1.400 notas** y `topic` al 100% en todo lo de lectura, incluidas las **519 de X** (`Inbox/Legacy/X`, E2) y los 34 libros de Kindle.
- **`Concepts/` existe**: 29 notas-concepto con estándar propio (`docs/vault-gardener/ESTANDAR-NOTAS-CONCEPTO.md`) y un gate automático (`src/concept-note.ts`).
- **El priorizador usa el grafo de conceptos**, no el `topic`: con 7 topics para 284 notas había 7 valores de contexto distintos; con conceptos hay 28.
- **El gardener** (`scripts/gardener.mts` + `scripts/launchd/`) mantiene el grafo solo, semanalmente. Escribe únicamente en `Concepts/` y `Diario/`.

**Lecciones que costaron caro y conviene no repetir:**

1. **Lo que decide identidad va en un módulo puro con tests, no en un script.** Los cuatro bugs de idempotencia del sync de X (B-739) vivían todos en `scripts/sync-x.ts`, que no tenía tests. Uno habría reescrito 487 notas en el siguiente sync — la misma forma que B-327 en Kindle.
2. **El contenido es la verdad de terreno; la metadata es una pista.** Clasificar libros por título dejaba 33 de 34 en `topic: otros`; clasificarlos por sus highlights los reparte bien (B-506).
3. **Los pases que escriben en la vault son upgrade-only.** El clasificador oscila en casos de frontera, y sin ese guard cada corrida pisa una corrección que hizo Fede a mano.
4. **Un gate que rechaza sus propios ejemplos está roto.** El checklist de notas-concepto rechazaba una nota que el estándar cita como modelo; la respuesta correcta fue mover el largo de bloqueo a aviso, no subir el umbral hasta que pasara.

**Pendiente de Fede** (ningún agente lo puede hacer): aplicar las conexiones a `Concepts/` (B-731) y los conceptos latentes (B-741), instalar el LaunchAgent del gardener, el primer sync real de Kindle (F5.0, B-321), el spike del Cloud Reader (B-324) y `xcode-select --install` (B-607 — `/opt/homebrew/bin/node` está roto).

2026-07-05 — **F5 en curso** (plan: `docs/plans/f5-libros-y-recomendaciones.md`). Shipped en código, en `[Unreleased]`:
- **MX22** — confiabilidad del sync Kindle: fix del bug fatal `DOMParser` en el service worker (parseo movido al offscreen document), sidecar `.kindle-sync-state.json` en la vault como fuente de verdad (módulo puro `src/kindle-sync-plan.ts`, "Reset libros" ya no pisa ediciones), permisos/errores visibles en el popup, `extension/README.md` reescrito.
- **MX24** — wishlist de Amazon: `src/wishlist.ts` trae la lista pública con `requestUrl()` (verificado contra la wishlist real de Fede) → fichas `shelf: wishlist` en `Books/`. Comando "Sincronizar wishlist de Amazon".
- **MX25** — recomendador `src/recommend.ts` (context pack → Claude → nota en `Books/Recomendaciones/`), helper compartido `src/anthropic.ts` con retry (classify lo usa también). Comandos `recommend-books` + "Empezar este libro". Default `recommendModel: claude-sonnet-5`.
- **MX23 (modelo)** — `Books/` en la raíz, `src/books-data.ts` (fichas + reconcile), setting `booksFolder`, orphan-mover lo protege.

Pendiente de Fede (no lo puede hacer un agente): **F5.0** (correr el primer sync Kindle real — instructivo en `docs/obsidian-readqueue-builder/F5-INSTRUCTIVO.md`) y el **spike de endpoints del Cloud Reader** para la biblioteca completa (MX23, necesita sesión autenticada en DevTools). 438 tests verdes, TS estricto pasa, extensión buildea. **Sin release hasta OK explícito de Fede.** MX15 sigue sin cortar v0.3.1. Bitácora por hito en `docs/ROADMAP.md`.

2026-07-09 — **Meta-tooling / DX (no es feature del plugin)**: ADR-001 (`docs/architecture/ADR-001-acceso-vault-obsidian.md`) define cómo Claude usa la base de conocimiento de Obsidian. Decisión: **lectura directa del filesystem (Path A), read-only, escrituras gated**; headless Sync (`ob`) y Local REST API + MCP quedan en reserva. Sección de gobernanza nueva arriba ("Acceso de Claude a la vault"). Backlog B-401 DONE, B-402/403/404 en reserva.
