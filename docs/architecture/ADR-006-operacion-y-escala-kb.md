# ADR-006 — Operación y escala del segundo cerebro

- **Estado**: Proposed (2026-07-31)
- **Autor**: system-architect
- **Contexto**: Fede: *"cómo vamos gestionando la base de conocimiento y cómo empezamos a buscar contenido que pueda vincularlo… ayuda-memoria, conectar ideas… está bueno ir priorizando a medida que este contenido sea enorme"*. Y: *"cómo voy nutriéndome de todo lo que he leído y cómo voy refrescando todos los puntos"*.
- **Relacionados**: [ADR-002](./ADR-002-f6-knowledge-graph.md) (grafo), [ADR-003](./ADR-003-contrato-extraccion-conceptos.md), [ADR-004](./ADR-004-estructura-y-taxonomia-vault.md) (estructura), [ADR-005](./ADR-005-relevancia-y-resurfacing.md) (relevancia).

> **Nota de alcance**: la impresora de ADR-005 era *ilustrativa*, no un pedido. El requisito real es el de arriba: nutrirse y refrescar. La impresora sigue siendo útil como prueba de fuego del ranking, pero no es prioridad.

---

## 1. Los tres modos de uso (esto es "cómo se gestiona")

La KB se usa de tres formas distintas. Confundirlas es lo que hace que un segundo cerebro se sienta abrumador.

| Modo | Quién inicia | Para qué | Estado hoy |
|---|---|---|---|
| **PULL** — *ayuda-memoria* | **Fede pregunta** | *"¿qué leí sobre dónde se captura el valor en IA?"* | ✅ **Existe**: `/vault-ask` |
| **PUSH** — *refrescar* | **El sistema trae** | Resurfacing diario/semanal de lo que ya leíste | 🟡 Parcial: highlights sí (MX13), sin relevancia (ADR-005) |
| **DISCOVERY** — *conectar ideas* | **El sistema explora** | *"estas dos notas hablan en secreto de lo mismo"* | ✅ **Existe**: `/vault-link`, demo entregado |

**El error a evitar**: tratar de hacer todo con PULL. Preguntar requiere saber qué preguntar — y lo más valioso de una KB es justamente **lo que olvidaste que sabías**. Por eso PUSH y DISCOVERY no son lujos: son los que atacan el material que nunca vas a buscar por tu cuenta.

## 2. El problema de escala (la pregunta central de Fede)

Hoy: **664 notas**. Con F7 (bookmarks + likes de X): potencialmente **3.000+**.

**Qué se rompe exactamente**: no la vault (Obsidian aguanta decenas de miles), sino **el acceso de Claude**. Hoy `/vault-ask` funciona porque 664 notas se pueden grepear y leer por muestreo. Con 3.000 notas de tweets sueltos, el corpus deja de caber en cualquier estrategia de lectura directa: demasiado ruido por unidad de señal.

### 2.1 La solución: tres capas de acceso

| Capa | Qué contiene | Tamaño objetivo | Cómo se accede |
|---|---|---:|---|
| **1. Índice** | Notas-concepto + MOCs de dominio | 50–150 notas | **Se lee entera.** Es el mapa. |
| **2. Fuentes** | Artículos leídos, libros, highlights | ~500–800 | Búsqueda dirigida por `topic`/`concepts` desde la capa 1 |
| **3. Corpus frío** | Bookmarks/likes de X, legacy | 3.000+ | **Nunca se lee entero.** Solo por query específica |

**El movimiento clave**: Claude lee la capa 1 (150 notas de conceptos), y desde ahí sabe *dónde* buscar en las capas 2 y 3. Sin capa 1, buscar en 3.000 notas es adivinar.

> **Por eso las notas-concepto no son un lujo estético — son el requisito de escala.** Hoy, con 664 notas, se puede vivir sin ellas. A partir de F7, son la única cosa que mantiene el corpus navegable. **F6 deja de ser "la fase linda" y pasa a ser el habilitador de F7.**

### 2.2 Corolario para F7

El material de X **no entra a la capa 1 ni a la 2**. Entra como capa 3: indexado, clasificado por `topic`, consultable — pero **no compite por atención** con lo que leíste de verdad. Esto es exactamente lo que ADR-004 ya decidió (`Inbox/Legacy/`, sin `status`), ahora con la justificación de escala.

## 3. Los rituales (cómo se "refresca")

Frecuencia distinta para intención distinta. Todo determinista, sin LLM salvo donde se indica.

| Ritual | Frecuencia | Qué hace | Costo |
|---|---|---|---|
| **Resurfacing diario** | diario | 3–5 highlights ponderados por relevancia (ADR-005), mezclando las 4 fuentes | $0 |
| **Conexión del día** | diario | 1 par de ítems de fuentes distintas con `topic` común | $0 (determinista) |
| **Digest semanal** | semanal | Qué leíste, qué conexiones nuevas, qué huérfanos adoptar | centavos |
| **Pase de jardinería** | mensual | `/vault-link` sobre un dominio → propuestas de conexiones y notas-concepto | ~$1–3 |
| **Salud del grafo** | mensual | Huérfanos, densidad de links, cobertura de conceptos | $0 |

**Regla anti-abrumamiento**: el ritual diario tiene que caber en **60 segundos de lectura**. Si no, se abandona. Un digest de 40 ítems no se lee — es peor que nada.

## 4. Los agentes y skills

| Agente / skill | Qué hace | Estado |
|---|---|---|
| **`vault-gardener`** | `/vault-ask` (Q&A citado) + `/vault-link` (conexiones) — read-only, suggestion-only | ✅ Existe (`.claude/agents/vault-gardener.md`) |
| **`system-architect`** | Diseño, ADRs, backlog | ✅ Existe |
| **`obsidian-readqueue-builder`** | Implementación en el plugin | ✅ Existe |
| **`qa-tester`** | Tests | ✅ Existe |
| **Nightly gardener** (cloud) | Pase de jardinería programado sin intervención | ❌ Falta. Es donde el Path B del ADR-001 (headless Sync) recién gana sentido |
| **Skill `vault`** | Encapsula la gobernanza de lectura/escritura de la vault | 🟡 B-402, diferido |

**Lo que falta no es más agentes** — es el **ritual** que los invoca. Un `/vault-link` que se corre cuando Fede se acuerda no construye un grafo; uno que corre el primer lunes de cada mes, sí.

## 4-bis. Cómo se ejecuta Claude (agregado 2026-08-01)

> Fede: *"¿cómo vamos a ejecutar Claude para conceptos y mantener todo actualizado?"*. Es **la** pregunta que decide si el sistema vive o se abandona en dos semanas.

### 4-bis.1 El principio: separar lo determinista de lo semántico

| Capa | Quién | Cuándo | Costo |
|---|---|---|---|
| **Determinista** | El plugin (TypeScript) | Continuo, en runtime | **$0** |
| **Semántico** | Claude | Por lotes, programado | centavos |

**Nunca mandar a Claude lo que un `filter()` resuelve.** Resurfacing, priorización, filtros por `shelfLife`, huérfanos, salud del grafo, dedupe: todo eso es código y corre gratis. Claude entra **solo donde hace falta juicio**: clasificar, conectar, sintetizar.

Confundirlos es lo que hace que estos sistemas terminen caros, lentos y frágiles.

### 4-bis.2 Los tres modos de ejecución

| Modo | Qué corre | Cómo se dispara | Estado |
|---|---|---|---|
| **Runtime** | Clasificación al intake (`topic`+`shelfLife`+`tldr`), resurfacing diario, priorización de la cola | El plugin, solo | ✅ intake ya; ritual = C1 |
| **Programado** | Pase de jardinería: conceptos nuevos, conexiones, promociones de estatus | **LaunchAgent + `claude -p`** | ❌ a construir |
| **A demanda** | `/vault-ask`, `/vault-link` | Fede, cuando quiere algo puntual | ✅ existe |

Verificado en la Mac de Fede: `claude` 2.1.220 en `~/.local/bin/claude`, LaunchAgents funcionando, sin crontab previo.

### 4-bis.3 El truco que lo hace barato: git como detector de cambios

**Re-analizar 674 notas cada semana es caro y redundante.** El 99% no cambió.

Con git en la vault (ya está, B-726), *"qué cambió desde el último pase"* es una sola línea:

```bash
git diff --name-only "$(cat .gardener-last-run)"..HEAD -- 'Inbox/**/*.md'
```

**Git deja de ser solo el undo y pasa a ser el motor del mantenimiento incremental.** El pase solo mira lo nuevo y lo que cambió de estado. Si en la semana leíste 3 artículos y entraron 8, el pase procesa 11 notas — **centavos, no dólares**, y segundos en vez de minutos.

### 4-bis.4 Los eventos que importan

No todo cambio merece re-análisis. Solo tres:

| Evento | Detección por git | Qué dispara |
|---|---|---|
| **Nota nueva** | archivo agregado en `Inbox/` | Clasificar (ya lo hace el plugin) + buscarle conexiones |
| **Nota leída** | `status: unread` → `read`, o movida a `Inbox/Read/` | **Promoción de conceptos**: un `latente` puede pasar a `emergente` o `conocido` |
| **Highlight nuevo** | diff dentro de `Inbox/Kindle/` | La evidencia más fuerte (ADR-005 §3): re-evaluar el concepto que toca |

El segundo es el interesante: **leer un artículo cambia el estado del grafo**, y eso es detectable sin que Fede haga nada.

### 4-bis.5 El pase, concreto

```bash
#!/bin/sh
# ~/bin/gardener.sh — corre semanal por LaunchAgent
cd "$HOME/fedenotes" || exit 1
LAST=$(cat .gardener-last-run 2>/dev/null || echo HEAD~50)
CHANGED=$(git diff --name-only "$LAST"..HEAD -- 'Inbox/*' | head -60)
[ -z "$CHANGED" ] && exit 0          # nada cambió: no gastes un token

claude -p "Pase de jardinería semanal. Notas cambiadas desde el último run:
$CHANGED
Seguí docs/architecture/ADR-005 §9-bis: clasificá conexiones en consolidar/
atraer/agrupar, y promové conceptos latente→emergente→conocido según lo leído.
Escribí en Concepts/ (zona libre) y dejá el reporte en Daily/gardener.md."

git rev-parse HEAD > .gardener-last-run
```

**Cadencia**: semanal (domingo a la noche). El diario ya lo cubre el plugin sin costo.

**Por qué semanal y no diario**: el pase solo aporta cuando hay masa crítica de cambios. Con ~8 notas nuevas por semana, correrlo a diario procesa 1 nota y no encuentra nada — puro ruido y tokens quemados.

### 4-bis.6 Salvaguardas

- **`--max-turns`** para acotar el costo por corrida.
- **Escribe solo en `Concepts/` y `Daily/`** (zonas regenerables, §4.2 del doc maestro). Nunca en `Inbox/` ni `Books/`.
- **Git es el undo**: si un pase hace desastre, `git revert`. Por eso el pase corre *después* de que el árbol está limpio.
- **Log en `Daily/gardener.md`**: qué miró, qué escribió, qué costó. Sin log, un agente programado es una caja negra que nadie audita.
- **Si el árbol está sucio, no corre** — no mezclar ediciones de Fede a medio hacer con escrituras del agente.

## 5. Gobernanza (quién escribe qué)

Heredado de ADR-001 y ADR-002, sin cambios — se consolida acá:

| Acción | Quién | Gate |
|---|---|---|
| Leer la vault | Claude | Libre (filesystem directo, ADR-001) |
| Proponer conexiones / notas-concepto | `vault-gardener` | Escribe a `docs/vault-gardener/proposals/`, **nunca a la vault** |
| Escribir en la vault | Claude | **OK explícito de Fede**, por batch, sobre git |
| Escribir notas el plugin (runtime) | readqueue | Libre — es su función (`Inbox/`, `Books/`) |

**Backbone de undo**: git en la vault (Fase 0 de F6, B-504) es prerequisito de cualquier mutación en masa. **Sin eso, no se aplica ni un batch.**

## 6. La secuencia correcta

El orden importa y hoy está invertido:

```
1. VALIDAR el demo de F6.1  ← BLOQUEADO EN FEDE desde 2026-07-13
2. Git en la vault (B-504)        ← prerequisito de toda mutación
3. Notas-concepto del 1er dominio ← la capa 1 empieza a existir
4. F7 backfill de X               ← recién acá, con la capa 1 lista
5. Rituales (ADR-005 R1-R4)       ← el refresco continuo
```

**F7 empujando 3.000 notas a la vault antes del paso 3 es exactamente lo que Fede teme**: contenido enorme sin forma de priorizarlo. El orden de arriba lo evita.

## 7. Lo que está bloqueado esperando a Fede

1. **Validar el demo** `docs/vault-gardener/proposals/2026-07-13-producto-tech-connections.md` (B-502, hace 18 días). Son 10 conexiones + 3 notas-concepto + 2 respuestas de ask-your-vault, sobre 19 notas reales. **Es el gate de todo F6**: si la calidad sirve, se escala a los 8 dominios; si no, se recalibra antes de escribir nada.
2. **Git en la vault** (B-504): ¿Obsidian Git plugin, o commits desde Claude?
3. **Cadencia del pase de jardinería**: ¿mensual está bien?
