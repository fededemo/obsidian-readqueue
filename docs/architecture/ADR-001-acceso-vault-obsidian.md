# ADR-001: Acceso de Claude a la base de conocimiento de Obsidian (vault `fedenotes`)

## Status

**Accepted** (2026-07-09). Decisión de Fede: costo no es blocker (paga Obsidian); empaquetado = "lo que recomiendes" → governance-first. Defaults tomados por el architect: **local-first** (Path A) y **read-only** (el gate de escritura es por-acción, se puede ampliar sin costo). Ver "Decisión de Fede" abajo.

## Context

Fede quiere que **Claude, trabajando dentro de este proyecto, pueda usar la base de conocimiento de Obsidian** (la vault `fedenotes`, 615 notas). Trajo como candidato el **headless Sync de Obsidian** (`obsidian.md/help/sync/headless`), preguntando si es viable y cuál es la mejor manera de integrarlo en la gobernanza (CLAUDE.md), en un agente nuevo o en un skill.

### Corrección de modelo mental (el punto clave)

**La vault ya es un directorio local en la misma Mac donde corre Claude Code.** Está en:

```
/Users/federico/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes
```

Claude puede `Read`/`Grep`/`Glob` sobre ese directorio **hoy, sin infraestructura nueva y sin costo**. El headless Sync resuelve un problema **distinto**: llevar la vault a una máquina que *no la tiene* (un agente cloud/remoto, un runner de CI, un server Linux headless). Para el caso actual —Claude Code local en la Mac— headless Sync es *estrictamente peor* que leer el filesystem directo.

### Hechos verificados del entorno (2026-07-09)

| Hecho | Valor | Implicancia |
|---|---|---|
| Vault existe local | ✅ 615 `.md` | Lectura directa disponible ya |
| Motor de sync | **iCloud** (no hay `sync.json`) | Fede **no** tiene sub de Obsidian Sync |
| Archivos `.icloud` dataless | **0** (todo materializado) | El dolor de iCloud es *latente*, no activo hoy |
| Plugin Local REST API | ❌ no instalado | Path C requiere instalar plugin nuevo |
| Plugins presentes | highlightr, brat, readqueue | — |

### Qué es realmente el headless Sync (verificado contra el help oficial)

- Paquete npm `obsidian-headless` (open beta): `npm install -g obsidian-headless`, CLI `ob`.
- Comandos: `ob login` → `ob sync-list-remote` → `ob sync-setup --vault "<nombre>"` → `ob sync` / `ob sync --continuous`; config con `ob sync-config` (modos `bidirectional` / `pull-only` / `mirror-remote`, conflict strategy, carpetas/tipos excluidos).
- Corre en macOS/Windows/Linux. Sincroniza los archivos a un directorio local, con el mismo E2EE que el desktop.
- **Requisito duro**: suscripción **activa de Obsidian Sync** (de pago) + cuenta.
- **Limitación crítica**: *"Do not use both the desktop app Sync and Headless Sync on the same device"* → dos motores de sync sobre los mismos archivos = conflictos. En una máquina donde iCloud ya sincroniza la vault, headless Sync **debe apuntar a un directorio separado**.

### Restricciones de gobernanza

- **Escribir en la vault requiere OK explícito de Fede** (el classifier ya lo bloquea). La vault es *single source of truth*; Claude no debe editar/borrar/mover notas del user sin autorización.
- Esto es **meta-tooling / DX**, no una feature del plugin. No entra en el roadmap F5 ni se distribuye por BRAT. Es cómo *Claude* consume la vault, no qué hace el plugin en runtime.

## Options Considered

### Path A — Lectura directa del filesystem (local)

Claude usa `Read`/`Grep`/`Glob` sobre el directorio de la vault. Gobernanza: read-only por defecto, escrituras gated.

- ➕ Cero infra, cero costo, funciona hoy. La vault ES el archivo, siempre actual.
- ➕ No agrega superficie de red ni dependencias.
- ➖ Sin features "vivas" de Obsidian (links resueltos, dataview, backlinks) — solo texto + frontmatter.
- ➖ Riesgo *latente* de iCloud dataless (`.icloud` placeholders si iCloud desaloja contenido). Hoy 0, pero puede aparecer.
- ➖ Requiere disciplina para no escribir por accidente (mitigado por classifier + regla en CLAUDE.md).

### Path B — Headless Sync mirror (`obsidian-headless` / `ob`)

`ob` mantiene un espejo de la vault en un directorio plano (local o en un entorno cloud/CI). Modo `pull-only` o `mirror-remote` para KB read-only.

- ➕ Su **razón de ser**: darle la vault a una máquina que no la tiene (agente cloud/remoto, cron cloud, CI runner).
- ➕ Mirror siempre materializado → esquiva por completo el problema iCloud dataless.
- ➖ **Requiere suscripción de Obsidian Sync de pago** — Fede hoy usa iCloud, no tiene Sync.
- ➖ En la Mac obligaría a un **segundo motor de sync** en directorio aparte (no doble-sync sobre los mismos archivos).
- ➖ Setup + mantenimiento (proceso `--continuous` o cron). Overkill mientras Claude corra local.
- ➖ Beta.

### Path C — Local REST API + MCP server

Plugin community "Local REST API" corre dentro de Obsidian y expone un MCP server (`https://127.0.0.1:27124/mcp/`, bearer token). Claude Code tiene soporte MCP HTTP nativo.

- ➕ Queries **vivas y ricas**: full-text search, JsonLogic, active file, periodic notes, links resueltos, command palette.
- ➕ CRUD real (crear/editar/patch de secciones) — potente para escrituras *gated*.
- ➖ **Obsidian tiene que estar abierto** con el plugin activo; si está cerrado, no hay server. Frágil para automatización.
- ➖ Instalar plugin nuevo + gestionar token + superficie de red local.
- ➖ La superficie de escritura (CRUD) hay que atarla fuerte al gate de Fede.

### Decision matrix

| Escenario | A (FS directo) | B (headless `ob`) | C (REST API + MCP) |
|---|---|---|---|
| Claude Code **local en la Mac** (realidad actual) | ✅ ideal, $0 | ❌ overkill + costo | ⚠️ útil solo si querés queries vivas |
| Agente **cloud/remoto** (Agent remote, cron cloud) | ❌ no tiene la vault | ✅ su razón de ser | ❌ necesita túnel a la Mac |
| **CI runner** necesita la vault | ❌ | ✅ `pull-only` | ❌ |
| Evitar **iCloud dataless** | ⚠️ latente | ✅ mirror materializado | ⚠️ depende |
| **Escrituras** (siempre gated) | Read/Write FS | bidireccional | CRUD API |
| **Costo** | $0 | Sub Obsidian Sync (pago) | $0 (plugin) + Obsidian abierto |
| **Requisito duro** | ninguno | Sync sub + no doble-sync | plugin + token + app corriendo |

## Decision

**Enfoque por fases, empezando por el camino de menor costo y mayor valor inmediato:**

1. **Ahora — Path A con gobernanza.** Habilitar lectura directa de la vault desde Claude, read-only por defecto, escrituras gated (respetando el classifier). Se documenta en CLAUDE.md una sección "Acceso de Claude a la vault". Cero costo, valor inmediato: Claude puede buscar, citar y razonar sobre las 615 notas hoy.

2. **Cuando aparezca la necesidad — Path B en reserva.** Adoptar headless Sync **solo si** se cumple alguna de estas dos condiciones: (a) empezamos a correr agentes cloud/remotos o cron cloud que necesiten la vault sin la Mac, o (b) el dolor de iCloud dataless se vuelve *activo* (aparecen `.icloud` placeholders que rompen lecturas). Recién ahí justifica pagar Obsidian Sync + montar un mirror `pull-only` en directorio separado.

3. **Opcional — Path C para queries vivas.** Si Fede mantiene Obsidian abierto y quiere queries grado dataview (backlinks, búsqueda estructurada, patch de secciones), instalar Local REST API + conectar su MCP. Es una mejora de *riqueza*, no un requisito para leer la KB.

### Empaquetado: skill primero, agente opcional

- **Skill `vault` (recomendado):** codifica el *método* de consultar la KB de forma segura — qué carpetas, regla read-only, cómo grepear frontmatter, el gate de escritura, y (más adelante) cómo hablarle al MCP si se habilita Path C. Reusable por cualquier agente. Proporcionado al tamaño del proyecto (solo-dev).
- **Agente `vault-librarian` (opcional, futuro):** un subagente read-only al que el architect/builder delega "buscá todo lo que hay en la vault sobre X" — útil como *fan-out read* que mantiene limpio el contexto principal. Se justifica solo si las búsquedas sobre la vault se vuelven frecuentes y pesadas. Empezar sin él.

**No** crear un agente pesado ni instalar infra antes de validar que la lectura directa (Path A) cubre el 90% del valor.

## Consequences

### Positivas
- Claude usa la KB **hoy**, sin gastar ni montar nada.
- La gobernanza queda explícita: la vault es read-only para Claude salvo OK de Fede.
- Las opciones caras (B/C) quedan documentadas y listas para activar *cuando* haya una razón concreta, no por FOMO.

### Negativas / costos
- Path A no da features vivas de Obsidian; para eso hay que ir a C.
- Queda una dependencia de disciplina (no escribir la vault) reforzada por el classifier + CLAUDE.md.

### Cambios que dispara esta decisión
1. **CLAUDE.md** — nueva sección "Acceso de Claude a la vault (`fedenotes`)" (texto propuesto abajo).
2. **Backlog** — items B-401..B-404 (meta-tooling / DX).
3. **Skill `vault`** — a crear si Fede aprueba el empaquetado skill-first.

### Texto propuesto para CLAUDE.md (sección nueva)

> #### Acceso de Claude a la vault (`fedenotes`)
> La vault del user es **base de conocimiento read-only** para los agentes.
> - **Lectura**: `Read`/`Grep`/`Glob` directo sobre `…/fedenotes` permitido. Si aparece un placeholder `.icloud` (contenido desalojado por iCloud), avisar — no forzar descargas en masa.
> - **Escritura**: prohibida sin **OK explícito de Fede** (ya lo bloquea el classifier). Ninguna edición/borrado/movimiento de notas del user.
> - **No confundir** la vault del user con el repo del plugin. Lo que el *plugin* escribe en runtime (`Inbox/`, `Books/`, `Inbox/Kindle/`) es otra cosa que Claude tocando la vault a mano.
> - **headless Sync (`ob`) / Local REST API**: no habilitados por ahora. Ver `docs/architecture/ADR-001`.

## Decisión de Fede (2026-07-09)

1. **Dónde corre**: Fede respondió "ya pago Obsidian por las dudas" → costo no es blocker. No confirmó local-vs-cloud explícitamente; el architect toma **local-first** como default (Path A), porque Path B no aporta valor en la Mac (ver Consequences) y el pago solo desbloquea Path B *cuando aparezca una 2da máquina*. **Caveat a confirmar antes de activar Path B**: que su plan de Obsidian incluya el add-on **Sync** (distinto de Catalyst / licencia comercial); headless Sync exige Sync específicamente.
2. **Escritura**: sin respuesta explícita → default **read-only**. Es reversible sin costo: el gate del classifier es por-acción, así que ampliar a escritura gated caso-a-caso no requiere re-diseño.
3. **Empaquetado**: "lo que recomiendes" → **governance-first**. Se aplica la sección en CLAUDE.md (B-401 DONE). El skill `vault` (B-402) queda diferido hasta que los patrones de consulta se estabilicen o duela la repetición.

## Appendix — referencia rápida

**headless Sync (si algún día se activa Path B):**
```bash
npm install -g obsidian-headless
ob login
ob sync-list-remote
ob sync-setup --vault "fedenotes"       # directorio SEPARADO del de iCloud
ob sync-config                          # set mode = pull-only (KB read-only)
ob sync --continuous                    # o cron/launchd
```

**Local REST API + MCP (si se activa Path C):** plugin community "Local REST API" → MCP en `https://127.0.0.1:27124/mcp/`, bearer token → registrar como MCP server en Claude Code. Requiere Obsidian abierto.

**Fuentes:** [Obsidian Headless Sync (help oficial)](https://obsidian.md/help/sync/headless) · [coddingtonbear/obsidian-local-rest-api (REST + MCP)](https://github.com/coddingtonbear/obsidian-local-rest-api) · [Guía Obsidian MCP 2026](https://mcp.directory/blog/obsidian-mcp-complete-guide-2026)
