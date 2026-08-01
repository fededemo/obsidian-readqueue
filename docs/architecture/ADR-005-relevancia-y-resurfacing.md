# ADR-005 — Modelo de relevancia y resurfacing unificado

- **Estado**: Proposed (2026-07-31)
- **Autor**: system-architect
- **Contexto**: Fede: *"lo que me preocupa es cómo ir estructurando esto de forma que vaya quedando vinculado y no sean cosas independientes"*. Caso de uso guía: una impresora conectada a Obsidian que imprima **una cosa por día** — un highlight de Kindle, un tweet, un subrayado de artículo.
- **Relacionados**: [ADR-002](./ADR-002-f6-knowledge-graph.md), [ADR-003](./ADR-003-contrato-extraccion-conceptos.md), [ADR-004](./ADR-004-estructura-y-taxonomia-vault.md), [F7](../plans/f7-x-bookmarks-y-likes.md).

---

## 1. Por qué la impresora es el requisito, no un capricho

Parece un extra divertido. En realidad es **la prueba de fuego del modelo**: si el sistema tiene que elegir **una sola cosa** para imprimir hoy, entre highlights de Kindle, subrayados de artículos, tweets y bookmarks viejos, entonces **no puede haber silos por fuente**. Obliga a un ranking global sobre todo el corpus.

Cualquier diseño que no pueda responder *"¿qué es lo más valioso que puedo mostrarte hoy?"* con un solo número está incompleto. Por eso la impresora ordena todo el resto de este ADR.

## 2. Estado actual (medido)

`src/highlights-data.ts` ya tiene el 60% de la plomería:

```ts
export type ArticleSource = "web" | "kindle" | "matter";
export function pickDailyHighlights<T extends { articleSource: ArticleSource }>(
  highlights, count, rng): T[]
```

Hace **round-robin por fuente** con shuffle determinístico por fecha (`rngFromSeed(fecha)` → "mismo día = mismas elecciones"). Garantiza *variedad* — una vault con 500 highlights de Kindle y 10 de web igual muestra web todos los días.

**Lo que le falta**: todas las fuentes pesan igual y dentro de cada una la elección es azar puro. **No hay noción de relevancia.** Y `ArticleSource` no contempla X.

Punto ya resuelto y correcto: **los highlights de Matter pesan igual que los de Kindle**, tal como pide Fede (*"los highlights de Matter son algo que dije en un momento, es como un highlight de Kindle hoy"*).

## 3. Decisión: dos ejes, no uno

El pedido de Fede mezcla dos cosas distintas. Separarlas es lo que hace el problema tratable.

### Eje A — Fuerza de la señal (qué tan deliberado fue el acto)

Cuánto compromiso puso Fede al marcar eso. Es una propiedad **del acto**, no del contenido:

| Acto | Peso | Por qué |
|---|---:|---|
| **Highlight + nota propia** (`==texto==` + `%%comentario%%`) | **5** | Máximo: subrayó *y* escribió algo. Pensamiento propio. |
| **Highlight** (Kindle, web, Matter — indistinto) | **4** | Decisión deliberada sobre una frase específica |
| **Artículo/libro terminado** | **3** | Consumió el material entero |
| **Bookmark** | **2** | Intención declarada, no consumada |
| **Like** | **1** | Reacción, no compromiso |

### Eje B — Estado de resolución (qué tan cerrado está el ciclo)

| Estado | Qué significa |
|---|---|
| Leído + subrayado | **Capital**. Listo para conectar. |
| Leído sin subrayar | Consumido, sin destilar |
| **Guardado hace mucho, nunca leído** | **Deuda de interés** ← el insight de Fede |

> **El insight de Fede, y es el mejor de la conversación**: *"un contenido que todavía no leí pero que marqué hace tiempo... significa que en su momento me despertó interés"*.
>
> **La antigüedad de un ítem no leído no lo devalúa — lo convierte en una pregunta abierta.** No es material para releer: es material para **decidir**. Un bookmark de hace 8 meses que nunca abriste merece aparecer una vez y preguntarte *"¿esto todavía te importa?"*. Si decís que no, muere; si decís que sí, sube a la cola. Eso es distinto de resurfacing y hay que modelarlo distinto.

## 4. El score

```
relevancia = peso_del_acto × factor_temporal × factor_de_conexión
```

- **`peso_del_acto`**: la tabla del Eje A (1–5).
- **`factor_temporal`**: **no es decaimiento**. Lo viejo no vale menos — vale *distinto*. Es una curva de "hace cuánto que no lo ves": sube con el tiempo sin ver (lo que hace meses no aparece merece turno) y cae a 0 justo después de mostrarlo. Es *anti*-decaimiento — evita repetir, no castiga la edad.
- **`factor_de_conexión`**: bonus si el ítem está enlazado a una nota-concepto (F6). Lo que ya está tejido en la red vale más que lo suelto, porque al aparecer arrastra contexto.

Determinista y auditable: mismo día + misma vault = mismo resultado. Sin LLM en el ranking (el LLM ya puso el `topic`).

## 5. Las tres intenciones del resurfacing

Un solo stream no alcanza. La impresora rota entre tres **intenciones distintas**, y cada una tiene su propia consulta:

| Intención | Qué muestra | Pregunta que te hace |
|---|---|---|
| **Recordar** | Un highlight (Kindle / web / Matter / X) | *"Esto te pareció importante"* |
| **Reconsiderar** | Algo guardado hace >6 meses y nunca leído | *"¿Todavía te importa?"* → sube a la cola o muere |
| **Conectar** | **Dos ítems de fuentes distintas con el mismo `topic`** | *"¿Estas dos cosas hablan de lo mismo?"* |

## 6. La vinculación real (lo que más te preocupa)

**"Que no sean cosas independientes" no se resuelve con metadata.** Podés tener el frontmatter más prolijo del mundo y seguir teniendo 664 notas aisladas.

Se resuelve con dos mecanismos, en este orden:

1. **Coincidencia temática en el resurfacing** (barato, hoy). Mostrar el mismo día un highlight de Kindle y un bookmark de X que comparten `topic: tech`. **El sistema no inventa la conexión — pone los materiales lo bastante cerca como para que vos la veas.** Es la intención "Conectar" de §5, y es implementable ya: `topic` está al 100% en las 409 notas de lectura (ADR-004 §1.1).
2. **Notas-concepto** (F6/ADR-003). Cuando notás la conexión, se materializa en una nota que ambos enlazan. **Ahí nace la neurona.** El resurfacing es lo que alimenta ese proceso; las notas-concepto son lo que lo persiste.

El orden importa: **primero el encuentro, después el nodo.** Construir notas-concepto sin resurfacing es escribir un índice que nadie consulta.

## 7. La impresora

**Arquitectura desacoplada** — el plugin no habla con hardware:

```
readqueue (plugin)                    proceso externo (LaunchAgent)
   │ elige el ítem del día                    │
   │ según §4 + §5                            │
   ▼                                          ▼
Daily/print-queue.md  ────────────▶  lee, imprime, marca como impreso
(markdown plano)                     (ESC/POS por USB/red)
```

Por qué así:
- Obsidian no puede hablar con USB de forma confiable (y en mobile, nunca).
- El contrato es **un archivo markdown**: testeable sin hardware, versionable, y si la impresora no está, no se pierde nada — la nota queda.
- Sirve igual para otros destinos: e-ink, un mail diario, un widget.

Hardware sugerido: impresora térmica de recibos (58/80mm, ESC/POS, USB o red). Son baratas, no usan tinta y el formato "ticket" encaja perfecto con un highlight.

**El plugin solo necesita**: elegir el ítem y escribir la nota. Eso es reusar `pickDailyHighlights` con score + `buildDigestHighlightsSection`, que ya existen.

## 8. Plan incremental

Cada paso entrega valor solo; ninguno requiere el siguiente.

| Paso | Qué | Reusa |
|---|---|---|
| **R1** | `ArticleSource` += `"x"`. Los tweets/highlights de X entran al resurfacing que ya existe | `highlights-data.ts` |
| **R2** | `score()` determinista (§4) y `pickDailyHighlights` pasa de round-robin puro a **round-robin ponderado** | mismo módulo, mismos tests |
| **R3** | Intención **Reconsiderar**: query de no-leídos >6 meses + acción "sube a la cola / descartar" | `queue-data.ts` |
| **R4** | Intención **Conectar**: par de ítems de fuentes distintas con `topic` común, en el digest diario | `topics.ts` |
| **R5** | `Daily/print-queue.md` + script externo de impresión | nuevo, chico |

**R1+R2 es el corte mínimo**: con eso el digest diario ya mezcla las cuatro fuentes con relevancia real.

## 9. Consecuencias

**Positivas**: un solo ranking sobre todo el corpus; la impresora se vuelve un consumidor trivial; el resurfacing pasa de "variedad aleatoria" a "relevancia"; se aprovecha `topic` que ya está al 100%.

**Riesgos**:
- **Los pesos del Eje A son un juicio, no una medición.** Hay que calibrarlos con uso real. Empezar con los de §4 y ajustar.
- **"Reconsiderar" puede volverse una máquina de culpa** si muestra deuda todos los días. Debe ser ≤1 por semana.
- **El factor de conexión favorece lo ya conectado** — riesgo de rich-get-richer, donde lo suelto nunca aparece. Mitigación: el factor temporal (anti-decaimiento) empuja en contra.

## 9-bis. Los tres tipos de conexión (agregado 2026-08-01)

**Origen**: Fede, al validar el demo: *"hay varias que yo todavía no leí… falta la diferenciación entre lo que se leyó y lo que no"*.

**Medido**: de las 17 notas del demo localizadas en la vault, **15 están en `Inbox/Web` (no leídas)** y solo 2 en `Inbox/Read`. El primer pase de `vault-gardener` **ignoró por completo el estado de lectura** — es un bug de diseño del agente, no de las conexiones.

### 9-bis.1 El mapa de lectura de la vault

| Zona | Estado | Notas |
|---|---|---:|
| `Inbox/Kindle/` | **leído** (highlights = prueba de lectura) | 34 |
| `Inbox/Read/` | **leído** (`status: read`) | 39 |
| `Inbox/Legacy/Matter/` | **leído**, hace tiempo | 172 |
| `Inbox/Web/` | **NO leído** — la cola | 175 |

### 9-bis.2 Una conexión significa cosas distintas según el estado

| Tipo | Entre | Qué te dice | Para qué sirve |
|---|---|---|---|
| **Consolidar** | leída ←→ leída | *"estas dos cosas que ya sabés son la misma idea"* | Segundo cerebro puro. **Solo estas generan notas-concepto sólidas** |
| **Atraer** | leída ←→ **no leída** | *"esto que tenés pendiente conecta con lo que ya sabés"* | **Priorizar la cola** |
| **Agrupar** | no leída ←→ no leída | *"tenés 3 pendientes sobre lo mismo"* | Leé uno y decidí si los otros valen |

> **El insight: una conexión hacia material no leído es el mejor priorizador de cola que existe.**
> *"Leé esto porque conecta con 3 cosas que ya sabés"* es una señal infinitamente mejor que *"leé esto porque es reciente"*. Y sale del mismo motor que ya tenemos — no hay que construir nada nuevo.

### 9-bis.3 Consecuencia para las notas-concepto — **corregido 2026-08-01**

> **Versión anterior (descartada)**: *"una nota-concepto necesita ≥2 fuentes leídas; las no leídas no alimentan la síntesis"*.
> **Objeción de Fede**: *"si agrego un artículo porque me parece interesante, puede ser que nunca lo lea… igual me pareció interesante en su momento, entonces está bueno considerarlo en los conceptos"*.
> **Tiene razón, con un matiz.** El error era excluir. Lo correcto es **marcar**.

**El dato que lo respalda**: la distribución temática de lo no leído es casi idéntica a la de lo leído (tech 22/26%, macro 20/24%, producto 21/19%…). **Fede guarda sobre los mismos temas que lee.** No hay un universo paralelo de material acumulado a ciegas, así que incorporarlo no distorsiona el grafo.

**Pero la distinción que sí hay que preservar no es si el concepto existe — es quién es el autor de la síntesis.** Si una nota-concepto se redacta desde artículos que Fede nunca abrió, esa síntesis es de Claude leyendo por él. Mezclarlas produce una wiki que "sabe" cosas que Fede no sabe, y al consultarla no puede distinguir qué es propio y qué es ajeno. **Eso destruye la confianza en el segundo cerebro.**

### Tres estatus de concepto

| Estatus | Composición | Qué significa | Cómo se escribe |
|---|---|---|---|
| **`conocido`** | ≥2 fuentes leídas | *"Esto lo sabés"* | Síntesis completa, anclada en tus highlights y tus lecturas |
| **`emergente`** | 1 leída + N no leídas | *"Estás por saberlo"* | Síntesis parcial + *"tenés N pendientes acá"* |
| **`latente`** | solo no leídas | *"Te interesó y no lo abriste"* | **No se sintetiza — se lista.** Es un interés declarado, no conocimiento |

Los tres existen en el grafo. Ninguno se descarta. Lo que cambia es el **contrato de lectura**: cuando abrís un concepto sabés exactamente qué estás mirando.

### Por qué el `latente` es valioso (y no un problema)

*"Guardaste 7 cosas sobre agentes y no leíste ninguna"* es **más informativo que cualquier resumen**. Te muestra un interés que declaraste pero no ejecutaste, y te fuerza a decidir: o te importa y le bloqueás tiempo, o no tanto y lo dejás ir sin culpa. Es exactamente el triage que Fede pide.

### Los conceptos se promueven solos

Un `latente` con 7 fuentes se vuelve `emergente` cuando leés una, y `conocido` cuando leés dos. **El grafo evoluciona con tu lectura, sin intervención.** Y el resurfacing puede empujar en esa dirección: *"leé este artículo y el concepto X pasa a conocido"* — gamificación honesta de la cola.

### 9-bis.4 El ranking que pidió Fede

*"Criterio uno: lo leí. Dos: no lo leí. Tres: es viejo y quedó desactualizado."*

Se combina con `shelfLife` (§4.3 de `SEGUNDO-CEREBRO.md`) en un solo score de **"¿vale la pena leer esto?"**:

```
prioridad_de_lectura =
      (nº de notas LEÍDAS conectadas)     ← la señal fuerte: ya tenés contexto
    × factor_shelfLife                    ← perishable + viejo → tiende a 0
    × factor_topic_activo                 ← ¿el tema aparece en lo que leés hoy?
```

Un artículo que conecta con 4 cosas que ya leíste y es `evergreen` va arriba de todo. Uno `perishable` de hace 8 meses sin conexiones se descarta sin culpa.

### 9-bis.5 Deuda técnica que esto expone

`Inbox/Web` **no tiene `status`** en ninguna de sus 175 notas (ya detectado en ADR-004 §1.2). Hoy el sistema infiere "sin status = no leído", que funciona pero es implícito y frágil. **Con el estado de lectura ahora en el centro del modelo de relevancia, esto pasa de cosmético a bloqueante**: agregar `status: unread` explícito sube de prioridad.

## 10. Pendiente de Fede

1. **¿Los pesos del Eje A (§3) reflejan tu intuición?** En particular: ¿un like debería aparecer alguna vez en la impresora, o nunca?
2. **¿"Reconsiderar" te suena útil o ansiógeno?** Es el mecanismo que convierte bookmarks viejos en decisiones.
3. **Impresora**: ¿ya tenés uno en mente o hay que elegir hardware?
