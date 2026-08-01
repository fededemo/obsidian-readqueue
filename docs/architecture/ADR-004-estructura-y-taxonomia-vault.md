# ADR-004 — Estructura de carpetas y taxonomía de la vault

- **Estado**: Proposed (2026-07-28)
- **Autor**: system-architect
- **Contexto**: F7 (X/Twitter) va a agregar volumen a la vault. Antes de meter miles de notas nuevas hay que fijar dónde vive cada cosa, o queda un popurrí. Fede: *"que no sea un popurrí... me lo imagino como una serie de neuronas conectadas entre sí"*.
- **Relacionados**: [ADR-001](./ADR-001-acceso-vault-obsidian.md) (acceso read-only), [ADR-002](./ADR-002-f6-knowledge-graph.md) (knowledge graph), [ADR-003](./ADR-003-contrato-extraccion-conceptos.md) (extracción de conceptos), [F7](../plans/f7-x-bookmarks-y-likes.md).

---

## 1. Estado actual (medido, no asumido)

664 notas al 2026-07-28:

| Carpeta | Notas | Qué es |
|---|---:|---|
| `Books/Wishlist` | 244 | Fichas de libros de la wishlist de Amazon |
| `Inbox/Legacy` | 172 | Histórico de Matter (read-it-later anterior) |
| `Inbox/Web` | 165 | **La cola de lectura activa** |
| `Inbox/Read` | 39 | Leídos, archivados |
| `Inbox/Kindle` | 33 | Notas de libros con highlights |
| `Books/Recomendaciones` + `Books/Rankings` | 4 | Salidas del recomendador |
| `vibecoder/` | 3 | Notas de proyectos propios |
| (raíz) | 4 | Sueltas |

**La buena noticia**: la vault está lejos de ser un desastre. Son 3 carpetas top-level y una jerarquía de un nivel. El problema no es el caos actual — es que F7 puede duplicar el volumen y romper lo que hoy funciona por ser chico.

### 1.1 Lo que ya está sano

`topic` y `tags` están presentes en el **100%** de las notas de lectura: 172/172 en Legacy, 165/165 en Web, 39/39 en Read, 33/33 en Kindle. **El eje temático ya es universal y confiable.** No hay que inventar una taxonomía: hay que documentar la que ya existe y extenderla.

`source` también está casi universal (100% en Legacy y Kindle, 151/165 en Web).

### 1.2 Lo que está roto (deuda real, medida)

| Problema | Evidencia | Impacto |
|---|---|---|
| **Tres nombres para "cuándo entró"** | `savedAt` (Legacy, Kindle) · `created` (Web, Read) · `firstSeenAt` (Books) | No se puede ordenar ni filtrar por antigüedad de forma uniforme. Una query de dataview necesita 3 ramas. |
| **Dos vocabularios de estado** | `status` (Inbox/*) vs `readingStatus` + `shelf` (Books) | Lo mismo. |
| **`status` ausente en `Inbox/Web`** | 0 de 165 notas de la cola lo tienen; sí lo tienen Legacy (172), Read (39) y Kindle (33) | El filtro de la cola depende de "ausencia = unread". Funciona, pero es implícito y frágil. |
| **14 notas en `Web` sin `title`/`source`/`author`** | 151 de 165 tienen esas claves | Casos degradados del intake. Poco, pero conviene saber por qué. |
| **`Inbox/` ya no es un inbox** | 409 de 664 notas (62%) viven bajo `Inbox/`, incluyendo 172 legacy y 39 leídas | El nombre miente. Un inbox con archivo histórico adentro es la definición de popurrí. |

---

## 2. Decisión

### 2.1 Los tres ejes (la regla que evita el popurrí)

La causa raíz de las vaults-popurrí es usar carpetas para responder preguntas que el frontmatter responde mejor. Por eso: **cada eje tiene un mecanismo, y uno solo.**

| Eje | Pregunta | Mecanismo | Cardinalidad |
|---|---|---|---|
| **Ciclo de vida** | ¿Dónde está esto en su viaje? | **Carpeta** | Pocas, estables, una sola respuesta posible |
| **Naturaleza** | ¿Qué es y de dónde vino? | **Frontmatter** (`source`, `topic`, `author`, `status`) | Muchos ejes, combinables |
| **Sentido** | ¿Con qué se conecta? | **Links `[[ ]]`** + notas-concepto (F6) | Ilimitada — acá viven las "neuronas" |

> **Regla de oro: no crear una carpeta para algo que el frontmatter ya distingue.**
> Si la respuesta a "¿por qué está en esta carpeta y no en aquella?" es un valor de frontmatter, la carpeta sobra.

Corolario directo del pedido de Fede: los bookmarks de X **no llevan carpeta propia**. Los viejos van a `Inbox/Legacy/` junto al histórico de Matter, distinguidos por `source: x-bookmark`. Cero carpetas nuevas.

### 2.2 Estructura de carpetas — canónica

```
Inbox/
├── Pending/     URLs crudas sin procesar (buffer del share sheet). Efímero.
├── Web/         LA COLA. Todo lo pendiente de leer, venga de donde venga.
├── Read/        Leído y archivado.
├── Kindle/      Libros con highlights (no entra a la cola — decisión F3).
└── Legacy/      EL ARCHIVO. Material de referencia que no se lee activamente:
                 Matter histórico + bookmarks viejos de X + likes agregados.
Books/
├── (raíz)       Fichas de libros: wishlist, owned, read.
├── Recomendaciones/
└── Rankings/
vibecoder/       Notas de proyectos propios.
Concepts/        [F6, aún no existe] Notas-concepto: los nodos del grafo.
```

**Reglas de admisión** (esto es lo que hace que la estructura se sostenga sola):

1. **`Inbox/Web/` es la única cola.** Si tiene `status: unread` y se pretende leer, va acá — sin importar la fuente. Web Clipper, intake, bookmark de X: mismo destino, distinto `source:`.
2. **`Inbox/Legacy/` es el archivo, no "las cosas de Matter".** Su definición es *material de referencia consultable, no material de lectura pendiente*. Matter fue el primer inquilino, no el único.
3. **Ninguna fuente nueva justifica una carpeta nueva.** Se justifica un valor de `source:` nuevo. Una carpeta nueva solo se crea si el material tiene un **ciclo de vida distinto** (Kindle lo tiene: se relee, no se "termina"; los highlights son la unidad, no la nota).
4. **`Concepts/` es la excepción deliberada**: no es material capturado sino material *escrito*, con ciclo de vida propio (se edita para siempre). Es la carpeta de las neuronas.

### 2.3 Taxonomía — vocabulario controlado del frontmatter

**`topic`** — eje temático. Ya existe, ya es universal, **no se toca**. 7 valores cerrados definidos en `src/topics.ts`:
`tech` · `producto` · `macro` · `ciencia` · `personal` · `cultura` · `otros`

**`source`** — de dónde vino. Vocabulario cerrado y extensible:

| Valor | Origen |
|---|---|
| `web-clipper` | Obsidian Web Clipper |
| `intake-defuddle` | Intake job del plugin (URL → artículo) |
| `intake-fxtwitter` | Intake job, tweet renderizado (MX1) |
| `kindle` | Extensión Chrome de Kindle |
| `matter` | Import histórico de Matter |
| `amazon-wishlist` | Sync de wishlist |
| **`x-bookmark`** | **F7 — bookmark de X** |
| **`x-like`** | **F7 — like de X (agregado)** |

**`status`** — ciclo de vida de lectura: `unread` · `read` · (`snoozedUntil` como modificador).

**`kind`** — [F7, nuevo] naturaleza del material: `pointer` (el valor es el link) · `content` (se sostiene solo) · `reference` (consulta, no lectura).

**`tags`** — libre, pero con dos convenciones: `reader` marca material de lectura (ya en uso); el resto es tuyo.

### 2.4 Normalización de la deuda (§1.2)

| Fix | De → A | Alcance |
|---|---|---|
| Fecha de entrada | `created`, `firstSeenAt` → **`savedAt`** | Es el nombre más usado (205 notas) y el más claro |
| Estado | `readingStatus` → **`status`** | `shelf` sobrevive: es un eje distinto (wishlist/owned), no estado de lectura |
| Cola explícita | agregar `status: unread` a las 165 de `Inbox/Web` | Elimina la dependencia de "ausencia = unread" |

**Estas migraciones son escrituras en la vault → gated por OK explícito de Fede** (ADR-001). Van con dry-run + git commit previo como red de undo (B-504).

---

## 3. Por qué esto habilita las "neuronas conectadas"

Lo que Fede quiere no lo dan las carpetas — lo dan tres cosas, en este orden:

1. **Metadata uniforme** → hace que el *search* funcione. `topic: tech AND source: x-bookmark` es una pregunta respondible solo si el vocabulario es consistente. Hoy lo es en un 90%; §2.4 cierra el resto.
2. **Notas-concepto** (F6/ADR-003) → son las neuronas. Una nota `[[Capture de valor en IA]]` que 8 artículos, 2 libros y 5 bookmarks enlazan. **El concepto es el nodo; el material es la evidencia.** Sin esta capa, el grafo de Obsidian solo muestra carpetas — que es exactamente el grafo inútil.
3. **Links desde el momento de lectura** → cuando subrayás (MX11) y ese highlight se conecta a un concepto, la neurona se forma sola. Es el punto de Fede sobre "ya que vamos a hacer la lectura, aprovechar eso".

**El aporte de F7 al grafo no son los bookmarks — es el volumen de evidencia.** 3.000 bookmarks clasificados no valen por sí solos; valen porque hacen que las notas-concepto tengan de qué colgarse.

---

## 4. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Carpeta por fuente** (`X/`, `Matter/`, `Kindle/`, `Newsletters/`…) | Es el camino directo al popurrí. La fuente ya está en `source:`. Cada fuente nueva = carpeta nueva = navegación imposible. |
| **Carpeta por tema** (`tech/`, `producto/`…) | Peor: obliga a elegir *un* tema por nota, cuando el material real es multi-tema. Los tags no tienen ese límite. |
| **Estructura PARA / Zettelkasten puro** | Sobre-ingeniería para 664 notas de una sola persona. PARA asume proyectos y áreas de responsabilidad que no aplican a una vault de lectura. |
| **Todo plano en la raíz** | Funciona hasta ~1.000 notas y después no. F7 nos lleva ahí. |
| **Renombrar `Inbox/` → `Library/`** | Correcto en lo semántico (62% de la vault no es "inbox"), pero rompe todos los settings del plugin, los links existentes y la memoria muscular de Fede. **Diferido**: el costo supera el beneficio hoy. Se reevalúa si `Inbox/` pasa de ~2.000 notas. |

---

## 5. Consecuencias

**Positivas**: F7 no agrega ni una carpeta. El vocabulario queda documentado y validable por código. El search se vuelve confiable. F6 tiene el terreno preparado.

**Negativas / riesgos**:

- **`Inbox/Legacy/` puede llegar a miles de archivos.** El file explorer de Obsidian se vuelve inútil ahí — pero el acceso previsto es por search/tags, no por navegación. Si molesta, se sub-particiona por año (`Legacy/2024/`), que sigue siendo ciclo de vida, no tema.
- **iCloud + miles de archivos nuevos de golpe.** El backfill de F7 debe ser paceado, no un dump. Ya está contemplado en el plan (CLI nocturno).
- **El nombre `Legacy` va a mentir un poco** al alojar bookmarks de X que no son "legacy" de nada. Se acepta a cambio de no crear carpetas. Renombre diferido junto al de `Inbox/`.

---

## 6. Pendiente de Fede

1. **OK a la estructura** de §2.2 (en particular: bookmarks viejos + likes → `Inbox/Legacy/`, sin carpetas nuevas).
2. **OK a la normalización** de §2.4 — son escrituras en la vault, gated. Se puede hacer por partes.
