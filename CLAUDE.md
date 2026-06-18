# CLAUDE.md — obsidian-readqueue

> Estado vigente de arquitectura, stack y convenciones. Lo que cualquier agente nuevo necesita leer primero para orientarse.

## Identidad

**obsidian-readqueue** es un plugin de Obsidian que reemplaza la UX de Matter (read-it-later) dentro de la vault. Resuelve la pieza floja de Obsidian Web Clipper: gestionar la cola de lectura.

- **Estado**: **v0.3.0 publicado** (GitHub Release con artefactos BRAT). MVP (F1) + polish (F2) shipped; Kindle highlights integrado con **solución propia** (extensión Chrome + CLI, no plugin ajeno); highlights como producto (F4) shipped. Último: MX11–MX15 (subrayado por selección, re-sync incremental Kindle, vista unificada de highlights + repaso diario, polish de lectura, fix búsqueda mobile). MX15 está en `main` pero **sin release** todavía → pendiente cortar v0.3.1 para que BRAT lo propague. Detalle por hito en `docs/ROADMAP.md` + `CHANGELOG.md`.
- **Plan original**: `~/.claude/plans/imperative-sparking-dusk.md`
- **Vault target del user**: `fedenotes` (iCloud Drive). El plugin debe funcionar con iCloud-backed vaults.

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
│   ├── agents/                # system-architect, builder, qa-tester
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
ln -s "$(pwd)" "/Users/federico/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes/.obsidian/plugins/readqueue"
# (en mobile usar BRAT o copiar main.js+manifest.json+styles.css a mano)
```

## Distribución a mobile

La vault del user es **fedenotes en iCloud**. iCloud tiene problemas conocidos sincronizando `.obsidian/plugins/`. Tres caminos:

1. **BRAT** (recomendado): user instala BRAT desde el community store, agrega `fededemo/obsidian-readqueue` como beta plugin. BRAT propaga a iPhone vía sus propios mecanismos.
2. **Copia manual a iPhone**: vía Files app + Obsidian Mobile, depositar `main.js`, `manifest.json`, `styles.css` en `.obsidian/plugins/readqueue/`.
3. **Community store**: review largo (~1 semana), público.

Decisión actual: BRAT.

## Mandatory rules — heredadas de governance pigmi

1. **Pre-flight CI check antes de implementar cada feature**: `gh run list --branch main --limit 5 --json conclusion`. Main rojo → fix CI primero, no implementar feature.
2. **Plan Mode obligatorio** si hay >1 camino arquitectónico o si la implementación toca >2 archivos críticos del plugin.
3. **Verify, don't narrate**: cada cierre de feature corre `npm run typecheck && npm run test` antes de marcar como done.
4. **Code in English, UI en español** (este proyecto user-facing es 1 sola persona, FedeUI en español).
5. **No implementar sobre main rojo** (regla saccum 2026-04-08).

## Setup local del user

- **Vault**: `/Users/federico/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes`
- **GitHub**: `fededemo` (token con repo + workflow scopes)
- **Repo privado**: `github.com/fededemo/obsidian-readqueue`

## Decisiones arquitectónicas tomadas (referenciar ADRs cuando se escriban)

- ✅ **No construir extensión de browser propia**. Web Clipper de Obsidian (Safari Mac/iOS + Chromium) cubre el flujo de save desde browsers; share extension nativa de Obsidian Mobile cubre apps no-Safari. Razón: cero duplicación, mantenimiento mínimo.
- ✅ **Defuddle como parser único**. Es el mismo motor que usa Web Clipper internamente, open source MIT, mantenido por kepano. Evita divergencia entre el parsing del Web Clipper y del intake job.
- ✅ **Intake job vive en el plugin, no en un sync service externo**. `requestUrl()` de Obsidian bypassea CORS y funciona en mobile. No hay infra externa.
- ❌ **Karakeep self-host descartado**. Era el plan A. Se descartó para mantener vault como single source of truth, sin VPS.

## Riesgos conocidos

- **iCloud + `.obsidian/plugins/`**: sync flaky, archivos fantasma. Mitigación: BRAT o instalación manual.
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

2026-06-18 — v0.3.0 publicado (MX11–MX14). MX15 (fix: la búsqueda de la Reading Queue era inusable en mobile porque `oninput` recreaba el `<input>` en cada tecla; ahora `renderList()` re-renderiza solo la lista) en `main`, [Unreleased], pendiente de verificación mobile + corte de v0.3.1. 337 tests verdes, TS estricto pasa, CI verde. Bitácora por hito en `docs/ROADMAP.md`; bootstrap original en `~/.claude/plans/imperative-sparking-dusk.md`.
