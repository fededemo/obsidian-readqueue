# Vision — De colección a segundo cerebro: la red neuronal de conocimiento de Fede

> Documento-faro (north star). No es un ADR: las decisiones puntuales que salgan de acá se escriben como ADR-002, ADR-003… a medida que las comprometemos. Owner: `system-architect`.

## 1. La visión en una frase

Convertir las **629 notas** de `fedenotes` —hoy una pila de artículos, highlights y fichas de libros— en un **segundo cerebro vivo e interconectado**: cada idea es una neurona, cada link una sinapsis, y **Claude es el jardinero** que extrae conceptos, teje conexiones, mantiene mapas y hace aflorar lo que Fede no vería solo. Obsidian (wikilinks, graph view, MOCs, Canvas, Dataview) es el sustrato; Claude es la inteligencia.

## 2. El sustrato hoy (medido 2026-07-13)

| Dimensión | Estado | Lectura |
|---|---|---|
| Notas totales | 629 | Colección grande y sana |
| Estructura de carpetas | `Inbox/` (375: Web, Kindle, Read, Legacy/Matter, Pending) + `Books/` (247: fichas, Wishlist, Rankings, Recomendaciones) | Capa de **consumo madura** (readqueue hizo su trabajo) |
| Frontmatter | consistente y rico: `topic` (619), `source` (609), `title` (606), `author` (587), `url` (447) + `asin/shelf/matchScore` en Books | **Data contract ya existe** — base sólida |
| **Links entre notas** | **130 notas con link, 499 SIN ningún link de salida (79%)**; 444 wikilinks totales (~0.7/nota) | **Es una colección, NO una red** |
| **Qué son esos links** | casi todos **bibliográficos**: `[[The Economist]]`, `[[Kevin Simler]]`, `[[Título de libro]]` | **Cero conexiones entre ideas**. El grafo de ideas es greenfield |
| `topic` | solo **8 valores**: macro, producto, tech, personal, cultura, otros, ciencia, tweet | Sirve como **8 dominios/MOCs de alto nivel**, NO como conceptos finos |
| Tags inline | dominados por artefactos de parseo (`#f1n`, `#f2n`, `#right-ref-B21` = footnotes de defuddle) | Los `#tags` inline son **ruido**, no señal semántica |
| Control de versiones | **NO hay git** | **Cuello de botella de seguridad #1** para cualquier mutación |
| MOCs / daily notes | ninguno | Capa de síntesis: **hoja en blanco** |

**Diagnóstico:** la capa de *entrada* (leer, guardar, subrayar) está resuelta. Lo que falta —y es exactamente lo que Fede intuye— es la **capa de síntesis**: las conexiones entre ideas, las notas-concepto que cruzan fuentes, el grafo emergente. Hoy hay una biblioteca; queremos un cerebro.

## 3. El modelo de conocimiento (la data contract del grafo)

Cinco tipos de nodo. La clave del diseño: **las neuronas no son los artículos, son las ideas dentro de ellos.** Un artículo de 200 líneas no es una neurona; los 3-4 conceptos que contiene sí.

| Nodo | Qué es | Estado |
|---|---|---|
| **Source** | artículo web, libro Kindle, clipping, tweet | ✅ existen (629) — enriquecer + linkear |
| **Concept** (NUEVO) | nota atómica, evergreen, una idea, densamente linkeada. Ej: `[[Interés compuesto]]`, `[[Attention mechanism]]`. Agrega todo lo que Fede leyó sobre eso | ❌ 0 hoy — **acá está la creación de valor** |
| **MOC** (Map of Content, NUEVO) | hub navegable por dominio. Ej: `[[Macro MOC]]`, `[[Tech MOC]]`. Semilla directa: los 8 `topic` | ❌ 0 hoy — arranque casi automático |
| **Highlight** | la cita atómica (readqueue F4 ya los gestiona) | ✅ existen — promover a conceptos |
| **Book ficha** | metadata + estado de lectura | ✅ existen (247) — linkear a los conceptos del libro |

**Aristas tipadas** (no todos los links son iguales — esto evita el "hairball"):
- Source → Concept: *"este artículo discute [[X]]"*
- Concept ↔ Concept: `relacionado con` / `contradice` / `extiende` / `prerequisito de`
- Concept → Source: evidencia/cita
- MOC → Concept/Source: curaduría

**Decisión de sustrato:** el grafo se teje con **`[[wikilinks]]` + un campo frontmatter `concepts:`**, NO con `#tags` inline (contaminados por los footnotes de defuddle). Los wikilinks alimentan graph view + backlinks nativos; `concepts:` es queryable por Dataview.

## 4. La arquitectura: la costura determinístico / semántico

El sistema se parte en dos mitades con una costura limpia:

| Mitad | Qué hace | Dónde vive | Costo/riesgo |
|---|---|---|---|
| **Plomería determinística** | detección de huérfanos, análisis del grafo, métricas de salud, bidireccionalidad de links, scaffolding de MOCs, bloques Dataview | **plugin** (`src/graph-data.ts`, patrón puro + vitest como `books-data.ts`/`highlights-data.ts`) o scripts | barato, seguro, testeable, **sin LLM** |
| **Inteligencia semántica** | extracción de conceptos, juicio de qué linkear, síntesis temática, descubrimiento de conexiones, redacción de digests | **agente Claude + skills** (`.claude/`) | caro (tokens), requiere human-in-the-loop |

**Patrón de escala — recall barato + precisión cara:** una capa de **embeddings** sobre las 629 notas (índice local o plugin Smart Connections) propone *candidatos* de conexión (recall barato, corre sobre todo el corpus); Claude **juzga y cura** los candidatos (precisión cara, solo sobre el shortlist). Es "RAG sobre tu propio cerebro": embeddings para no perder nada, Claude para no ensuciar el grafo.

**Reutilización de patrones que ya existen en readqueue:**
- Caché por-nota en frontmatter (como `matchScore`/`matchScoredAt` de Books) → `conceptsExtractedAt` para procesar solo lo nuevo/cambiado.
- Merge que preserva ediciones humanas (como `kindle-merge.ts`) → Claude **nunca pisa** anotaciones de Fede; escribe en secciones marcadas (`%% claude %%`) o campos separados.

## 5. El plan por fases

Principio rector: **probar calidad de lectura → enriquecer sin riesgo → construir el grafo → mantenerlo.** Cada fase entrega valor y de-riskea la siguiente.

### Fase 0 — Fundaciones y seguridad (habilitador, va primero)
- **Git en la vault** (o copia de trabajo): cada edición de Claude = commit reviewable y **revertible**. Es EL backbone de seguridad. Vía Obsidian Git plugin o commits de Claude. Sin esto, no hay mutación en masa.
- **Frontmatter contract v1**: formalizar el schema + campo `concepts:`. Documentar en ADR-002.
- **Workflow propuesta→revisión→aplicación**: Claude nunca escribe en silencio. Produce un batch de cambios propuestos (diff o nota de revisión), Fede aprueba, se aplica. Batches chicos (10-20 notas), idempotentes.
- **Plomería determinística v1** en el plugin: huérfanos, métricas, salud del grafo.

### Fase 1 — Consulta y descubrimiento (SIN mutación, valor inmediato, valida a Claude)
- **Ask-your-vault**: Q&A en lenguaje natural sobre toda la KB.
- **Síntesis temática**: *"escribime todo lo que leí sobre X, citando mis notas"*.
- **Descubrimiento de conexiones como SUGERENCIAS** (no aplicadas): *"estas 3 notas hablan en secreto de lo mismo, ¿las linkeo?"*. Así testeamos la calidad del linking **antes** de dejar que escriba.
- **Serendipia**: conexión diaria entre dos notas distantes para gatillar pensamiento.

### Fase 2 — Enriquecimiento (mutación por-nota, gated, sobre git)
- TL;DR / resumen sintético al tope de cada source.
- **Auto-linking**: insertar `[[concepto]]` en las sources — en batches revisados.
- Poblar `concepts:` desde la semilla `topic` + extracción.
- **Limpieza de tags-artefacto** (`#f1n` y compañía).

### Fase 3 — Construcción del grafo (la red neuronal)
- Generar **notas-concepto** desde clusters de sources que comparten tema/highlights.
- Generar los **8 MOCs de dominio** (semilla `topic`) + MOCs finos emergentes.
- Cablear aristas **bidireccionales y tipadas** (extiende/contradice/prerequisito).
- **Canvas** auto-generados: mapas espaciales de clusters de conceptos (regiones del cerebro).

### Fase 4 — Rituales y mantenimiento (continuo, semi-automatizado)
- **Digest semanal**: qué leíste, qué conexiones nuevas se formaron, qué huérfanos adoptar.
- **Resurfacing diario** (readqueue F4 ya lo hace con highlights → extender a conceptos).
- **Loop de jardinería**: adopción de huérfanos, refresh de MOCs stale, dedup.
- **Dashboard de salud**: densidad de links, cobertura de conceptos, ratio de huérfanos, en el tiempo.
- Candidato a **agente cloud programado** (nightly gardener) — acá recién el headless Sync / Path B del ADR-001 gana sentido: una máquina sin la vault que la jardinea de noche.

## 6. Exprimir Obsidian nativo (sacarle todo el jugo)

| Feature nativa | Cómo la explotamos |
|---|---|
| Wikilinks + backlinks + **graph view** | el core; nuestros links lo pueblan. Colorear nodos por tipo (source/concept/MOC) con graph groups |
| **Dataview** (plugin) | dashboards dinámicos: cola de lectura, huérfanos, cobertura de conceptos, "libros por leer sobre X". Generamos los bloques |
| **Canvas** | mapas espaciales de conceptos; "pizarras" de un tema |
| **Properties** (frontmatter tipado) | `concepts:`, `related:`, `status:` con la UI de Properties |
| **Transclusión** `![[nota]]` | notas de síntesis que embeben highlights/conceptos |
| **Local graph** | vecindario por-nota para navegar el pensamiento |
| Plugins community candidatos | **Dataview** (queries), **Obsidian Git** (versionado+sync), **Smart Connections** (embeddings/related) |

## 7. Seguridad y modos de falla (sistemático)

| Riesgo | Mitigación |
|---|---|
| **Corrupción / links alucinados** por el LLM | git (undo total) + propuesta→revisión + umbral de confianza + **verificación adversarial** (2do agente chequea links propuestos) + en fases tempranas solo *append*, nunca reescribir el body |
| **Conflicto con iCloud** (ediciones concurrentes multi-device) | git como fuente de verdad de la copia de trabajo de Claude; editar en batches con devices quietos; Obsidian Git para reconciliar |
| **Escala / costo** (629 notas × pasadas LLM) | incremental (solo nuevo/cambiado vía git diff o mtime) + caché por-nota en frontmatter + embeddings para recall + modelos baratos para extracción, fuertes para síntesis |
| **Over-linking / hairball** (todo conecta con todo → grafo inútil) | linkear *poco y tipado*; preferir hubs concepto sobre links source-source densos; calidad > cantidad |
| **Pisar la voz/ediciones de Fede** | disciplina merge de `kindle-merge.ts`: nunca clobber contenido humano; append en bloques `%% claude %%` o campos separados |
| **Subjetividad del "relacionado"** | human-in-the-loop; el agente aprende de los accept/reject de Fede (su memoria) |

## 8. Empaquetado

- **Nuevo agente `vault-gardener`** (o `librarian` / `knowledge-synthesist`): persona dedicada a curar/linkear/sintetizar con disciplina de seguridad estricta y **memoria propia** del mapa de conocimiento de Fede. El scope ahora **sí** justifica un agente (a diferencia de ADR-001, donde recomendé skill-first para simple lectura). Owner de `docs/vault-gardener/`.
- **Skills invocables** (los verbos): `/vault-ask`, `/vault-synth`, `/vault-link` (propone), `/vault-concept` (extrae nota-concepto), `/vault-digest`, `/vault-garden`.
- **Módulo de plugin** `graph-data.ts` + vista de salud del grafo (la plomería determinística).

**Un repo, dos superficies:** el plugin shipeado (plomería + vistas) y la tooling de Claude (`.claude/`, no va en `main.js`). Esto encaja como **F6 de readqueue** —la evolución natural: queue → highlights → books → **grafo que conecta todo lo que leés**— aunque también podría ser un proyecto hermano. Ver decisiones abiertas.

## 9. Decisiones abiertas (para Fede)

1. **Casa/scope**: ¿esto es **readqueue-F6** (coherente, un repo) o un **proyecto hermano** nuevo?
2. **Postura de escritura**: ¿arrancamos **suggestion-only** (Claude propone, Fede aplica a mano), **batches con aprobación** (Claude aplica lo aprobado sobre git), o algo más autónomo? — define el riesgo y las fases.
3. **Git en la vault**: prerequisito de todo lo que sea mutación. ¿Lo adoptamos ya (Obsidian Git o `git init` en la vault)?
4. **Por dónde arrancar**: recomiendo Fase 1 (Ask-your-vault + descubrimiento de conexiones como sugerencias) — cero riesgo, valor inmediato, y valida si Claude "entiende" tu cerebro antes de dejarlo escribir.
