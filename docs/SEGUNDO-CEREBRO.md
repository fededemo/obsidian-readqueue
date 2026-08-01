# El segundo cerebro — documento maestro

> **Qué es esto**: el documento único que baja todo. Qué queremos, dónde estamos, **qué cambia respecto de cómo lo hacemos hoy**, y los próximos pasos.
> Consolida ADR-002 a ADR-006 + F7 + la secuencia. Si vas a leer un solo documento, es este.
> Última actualización: 2026-08-01.

---

## 1. El objetivo

Que Obsidian deje de ser un depósito de cosas leídas y pase a ser **el sistema de gestión de todo lo que Fede consume** — donde el material se conecta solo, se refresca solo, y se puede preguntar.

Fede lo dijo así: *"cómo voy nutriéndome de todo lo que he leído y cómo voy refrescando todos los puntos"*, *"que no sean puchos de cosas que después nunca se conecten"*.

## 2. El modelo de referencia: LLM Wiki (Karpathy, abril 2026)

Fede pidió alinearse con esto, y es la referencia correcta. [El tweet original](https://x.com/karpathy/status/2039805659525644595) (16M+ views; el gist siguiente pasó los 5.000 stars):

> *"Using LLMs to build personal knowledge bases… a large fraction of my recent token throughput is going less into manipulating code, and more into **manipulating knowledge** (stored as markdown and images)… I index source documents into a `raw/` directory, then I use an LLM to incrementally compile a wiki of .md files"*

**La arquitectura, en una línea**: separar el material crudo de la síntesis, y que el LLM compile la segunda desde el primero — con resúmenes, backlinks y conceptos enlazados.

```
raw/     ← fuentes: artículos, papers, highlights, bookmarks. INTOCABLE.
wiki/    ← conceptos y artículos sintetizados. LO MANTIENE EL LLM. REGENERABLE.
```

**La diferencia con RAG**: RAG re-deriva la respuesta desde los documentos en cada query. La LLM Wiki **compila una vez y mantiene actualizado**. El conocimiento queda materializado, navegable y linkeado — no escondido en un vector store.

### 2.1 Qué tomamos y qué no

| Aspecto | Karpathy | Nosotros | Decisión |
|---|---|---|---|
| Separar `raw/` de wiki | ✅ central | Implícito, no explícito | **Adoptar** (§4.1) |
| El LLM mantiene la wiki | ✅ escribe libremente | ADR-002: suggestion-only, gated | **Ajustar** (§4.2) |
| Backlinks + conceptos | ✅ | ✅ ADR-003 ya lo especifica | Ya alineado |
| Config por `agents.md` en la vault | ✅ | Tenemos `.claude/agents/vault-gardener.md` en el repo | Ya cubierto |
| Reemplazar el pipeline de lectura | ❌ no lo tiene | ✅ readqueue: cola, highlights, Kindle, X | **Nuestra ventaja** |

**Lo que tenemos y Karpathy no**: el pipeline de *ingesta y lectura*. Su modelo asume que ya tenés el material en `raw/`. Nosotros construimos exactamente eso durante F1–F7 — Web Clipper, intake, Kindle, wishlist, X. **Somos fuertes justo donde su spec no dice nada.**

## 3. Dónde estamos hoy (medido, 2026-08-01)

| | Estado |
|---|---|
| **Notas en la vault** | **674** (`Books/Wishlist` 244 · `Inbox/Web` 175 · `Inbox/Legacy` 172 · `Inbox/Read` 39 · `Inbox/Kindle` 34) |
| **Metadata** | `topic` y `tags` al **100%** en las 420 notas de lectura. `status` explícito al 100% (2026-08-01) |
| **Capa `raw/`** | ✅ **Existe de hecho**: todo `Inbox/` + `Books/`. Local, versionada con git, fuera de iCloud |
| **Capa wiki/conceptos** | ❌ **No existe.** Cero notas-concepto |
| **Ingesta** | ✅ Web, Kindle, libros. 🟡 X (F7: 450 bookmarks + 200 likes ya bajados) |
| **Consulta** | ✅ `/vault-ask` + `/vault-link`. El 1er demo quedó superado: mezclaba leído con no leído (ADR-005 §9-bis) → se rehace en B1 |
| **Refresco** | 🟡 Resurfacing de highlights sin relevancia |

**El diagnóstico en una frase**: tenés `raw/` muy bien resuelto y **la wiki no existe**. Todo lo demás son detalles.

## 4. Qué cambia respecto de cómo lo hacemos hoy

Esta es la sección que Fede pidió: *"qué cambios hay que hacer sobre cómo lo estamos haciendo ahora"*.

### 4.1 Cambio 1 — Hacer explícita la separación raw / wiki

| Hoy | Cambia a |
|---|---|
| `Inbox/`, `Books/` (todo mezclado conceptualmente) | **`raw/`** = `Inbox/` + `Books/` — sin tocar nada, solo se declara |
| — | **`Concepts/`** = la wiki. Carpeta nueva, mantenida por el LLM |

**No hay migración.** Tu material queda donde está; se agrega una carpeta. Es el único cambio estructural, y ADR-004 ya lo tenía previsto como la excepción deliberada.

### 4.2 Cambio 2 — Aflojar el gate de escritura (solo en la wiki)

**Este es el cambio importante, y lo habilita Karpathy.**

Veníamos con `suggestion-only` para todo (ADR-002): Claude propone en `docs/proposals/`, Fede aprueba, se aplica. Eso es correcto para el material crudo — tus notas, tus highlights, tu criterio. **Pero es una fricción innecesaria para la wiki**, y es la razón por la que F6 está parado hace 18 días.

> **El insight que desbloquea todo: si la wiki es regenerable desde `raw/`, no necesita gate.**
> El miedo a que Claude escriba viene de tratar todo como igualmente precioso. No lo es. Perder una nota-concepto no cuesta nada — se regenera. Perder un highlight tuyo sí.

| Zona | Quién escribe | Gate | Por qué |
|---|---|---|---|
| `Inbox/`, `Books/` (**raw**) | Fede + el plugin | **OK explícito para Claude** | Irreemplazable |
| `Concepts/` (**wiki**) | **Claude, libremente** | Solo git | **Regenerable**. Si sale mal, se borra y se rehace |

Requisito: **git en la vault** (B-504). Con git, el peor caso de una escritura mala es `git revert`.

### 4.3 Cambio 3 — El intake clasifica más

| Hoy | Cambia a |
|---|---|
| El intake pone `topic` (Claude Haiku) | Pone `topic` + **`shelfLife`** + **`tldr`** — mismo call, costo marginal ~0 |

**`shelfLife`** resuelve *"¿esto quedó desactualizado?"*. El problema con "hace 8 meses" es que no dice nada por sí solo: el demo encontró que *What Business Can Learn from Open Source* (**PG, 2005**) explica el colapso de la capa de modelo de 2026 — 21 años y sigue vigente. Un tweet sobre un release caduca en dos semanas.

> **La antigüedad no mide obsolescencia. La vida útil del contenido, sí.**

| Valor | Qué es | Ejemplos en la vault | Envejece |
|---|---|---|---|
| `evergreen` | principios, ensayos, papers | PG, SSRN, *How LLMs Actually Work* | **nunca** |
| `seasonal` | análisis de una situación en curso | Stratechery, estado de un mercado | 6–12 meses |
| `perishable` | noticias, releases, benchmarks | "X lanzó Y" | semanas |

Y se convierte en reglas de descarte:

| Situación | Decisión |
|---|---|
| `perishable` + >3 meses sin leer | **descartar sin culpa** |
| `seasonal` + >12 meses | descartar, salvo que el `topic` esté activo hoy |
| `evergreen` + cualquier antigüedad | **sigue valiendo** |

Bonus: arregla el *Reconsiderar* de ADR-005 §5 — en vez de preguntarte por cualquier cosa vieja, la deuda de interés se filtra a los `evergreen`, los únicos donde *"¿todavía te importa?"* tiene sentido.

**`tldr`**: 1–2 líneas de *"por qué te importaría a vos"* — no el resumen del artículo. Convierte la cola de una lista de títulos en una lista de decisiones.

### 4.4 Cambio 4 — Aparece un ritual diario

| Hoy | Cambia a |
|---|---|
| Abrís la cola cuando te acordás | Una nota diaria: **1 highlight + 1-2 notas relacionadas + por qué se conectan** |

Restricción dura: **60 segundos de lectura**. Un digest de 40 ítems no se lee.

### 4.5 Cambio 5 — X entra como capa fría

| Hoy | Cambia a |
|---|---|
| Los bookmarks viven en X, inaccesibles | Van a `Inbox/Legacy/` con `source: x-bookmark`, clasificados. **No compiten por tu atención** |

Solo los recientes y consumibles (~92 de cada 450) entran a la cola.

### 4.6 Lo que NO cambia

Tu flujo de captura y lectura queda **igual**: Web Clipper, share sheet de iOS, la cola, subrayar con `==texto==`, Kindle. Nada de eso se toca. **Todos los cambios son aditivos.**

## 4.7 Cambio 6 — Infraestructura: salir de iCloud, usar Obsidian Sync

**Medido 2026-07-31**: vault = **9.2 MB / 698 archivos**, **0 placeholders `.icloud`** (el riesgo de desalojo del ADR-001 no se materializó), sin git.

**Decisión: migrar de iCloud a Obsidian Sync.** El argumento decisivo es nuevo y viene del propio plan:

> **El paso 2 requiere git en la vault, y git sobre iCloud es riesgoso.** iCloud sincroniza archivo por archivo; `.git/` son miles de archivos chicos interdependientes (índices, packfiles, refs). Una sincronización parcial corrompe el repo.
>
> Sin git no hay escritura libre en `Concepts/` (§4.2). Con git sobre iCloud hay riesgo de corrupción. **Migrar es lo que destraba el dilema.**

Beneficios adicionales:

| Beneficio | Impacto |
|---|---|
| **Sincroniza `.obsidian/plugins/` nativamente** | **Resuelve B-006** (distribuir el plugin al iPhone), trabado desde F1. Elimina el rodeo de BRAT. `CLAUDE.md` ya documenta que iCloud falla ahí |
| Historial de versiones (1 mes en Standard) | Red de seguridad encima de git |
| E2E encrypted | — |
| Ya está pagado | Sub de $5/mes de Fede |

**Capacidad**: Standard = 1 vault, **1 GB**, historial 1 mes. Con 9.2 MB sobra ~100×; aun con las 3.000 notas de X serían ~40 MB.

⚠️ **Límite a vigilar**: Standard topea archivos en **5 MB**. Hoy no afecta. Si en el futuro se bajaran PDFs de papers (SSRN) a la vault, varios lo superan y haría falta el plan Plus ($10). Por ahora los papers quedan como link, no como archivo.

**Riesgo de la migración**: tener iCloud + Obsidian Sync + git simultáneamente es peligroso (tres mecanismos compitiendo). La vault debe **salir** de `~/Library/Mobile Documents/…` y quedar en un directorio local normal antes de activar Sync. Es un movimiento de carpeta, con backup previo.

## 5. La secuencia

Cada paso alimenta al siguiente. Detalle en §5 de este documento.

### Fase A — Cimientos ✅ **COMPLETA** (2026-08-01)

| # | Paso | Estado |
|---|---|---|
| A1 | Migrar iCloud → Obsidian Sync (§4.7) | ✅ 676 notas en `~/fedenotes`; cerró B-006 |
| A2 | Git en la vault | ✅ commit baseline `9ce8ee3` |
| A3 | `status: unread` explícito en `Inbox/Web` | ✅ 175/175, commit `8f7412f` |

Con A2+A3 la vault tiene **red de undo** y **estado de lectura explícito** — los dos prerequisitos de todo lo demás.

### Fase B — Entender qué tengo ⏭️ **ACÁ ESTAMOS**

| # | Paso | Quién | Por qué ahora |
|---|---|---|---|
| **B1** | **Nuevo pase de conexiones con los 3 tipos** (ADR-005 §9-bis): consolidar / atraer / agrupar | Claude (~$1-3) | Da **valor inmediato** (priorización de cola) **y** la validación real. No necesita código nuevo |
| **B2** | `shelfLife` + `tldr` en el intake | builder | El triage de "¿vale la pena?" |

**B1 reemplaza al viejo "paso 1"**: el primer demo mezcló leído con no leído, así que Fede no podía validarlo del todo. El pase nuevo separa los tres tipos — y las conexiones *consolidar* (entre material leído) son las que él **sí** puede juzgar.

### Fase C — El refresco

| # | Paso | Quién |
|---|---|---|
| C1 | Ritual diario (1 highlight + sus conexiones, 60s de lectura) | builder |
| C2 | Priorizador de cola: `nº leídas conectadas × shelfLife × topic activo` | builder |

### Fase D — El grafo

| # | Paso | Regla |
|---|---|---|
| D1 | `Concepts/`: primeras notas-concepto | **≥2 fuentes LEÍDAS por nota** (ADR-005 §9-bis.3) |

### Fase E — X entra, en dos tandas

> **Corregido 2026-08-01**: la versión anterior dejaba *todo* X al final. Es innecesario — el material se parte en dos, y la primera tanda puede entrar mucho antes.

Los datos de F7 §13.3 sobre 450 bookmarks reales:

| Tanda | Qué | Volumen | Destino | Cuándo |
|---|---|---:|---|---|
| **E1 — la punta** | Bookmarks **recientes y consumibles** (`<90d` + `READ` o `WATCH`) | **~92** | `Inbox/Web/`, `status: unread` | **Después de C2** (el priorizador), no al final |
| **E2 — el volumen** | El resto de bookmarks + **todos** los likes | ~358 + 200+ | `Inbox/Legacy/`, sin `status` | Después de Fase D (conceptos) |

**Por qué E1 puede adelantarse**: son 92 notas de material que Fede efectivamente quiere leer. No son ruido — son la cola que hoy vive inaccesible dentro de X. El único riesgo es de volumen (la cola pasa de 175 a ~267), y **eso lo neutraliza C2**: con el priorizador puesto, 267 notas ordenadas por señal real son más manejables que 175 sin ordenar.

**Por qué E2 sigue último**: son ~560 ítems de referencia que solo tienen sentido si existe la capa de conceptos para indexarlos. Sin ella, es exactamente el problema que Fede teme.

**Nota sobre el estatus**: los bookmarks de X son **no leídos por definición**. Con el modelo de tres estatus (§9-bis.3 del ADR-005) entran como fuentes de conceptos `latente` — lo cual es correcto y honesto, no un defecto.

**Bloqueante técnico de ambas**: `src/x-sync.ts` (B-602 + B-608) — el lector del export de birdclaw + triage + escritor. Es el módulo más grande pendiente, pero ya tiene esquema conocido, taxonomía validada sobre datos reales y fixtures disponibles.

### 5.1 Lo que NO hacemos todavía (anti-dispersión)

Tan importante como la lista de arriba. Cada uno tiene un prerequisito que aún no está:

| Idea | Por qué se posterga |
|---|---|
| **Impresora térmica** | Fede lo aclaró: era ilustrativo. El ritual diario en Obsidian lo cubre |
| Auto-linking masivo en las fuentes | Requiere el pase B1 validado. Escribir en 400 notas sin calibrar es caro de revertir |
| MOCs + Canvas | Necesitan notas-concepto primero |
| Nightly gardener en la nube | Primero el ritual manual tiene que funcionar |
| Categoría `LISTEN` (podcasts) | Sin datos suficientes (F7 §13.5) |
| Rescatar screenshots con visión | Fuera de alcance |
| Renombrar `Inbox/` → `Library/` | Correcto en lo semántico, pero rompe settings y links a cambio de nada funcional (ADR-004 §4) |
| Plugin `karpathywiki` de la comunidad | Evaluar recién cuando `Concepts/` exista y sepamos qué nos falta |

### 5.2 Por qué esto no son "puchos de cosas"

Lo que conecta todo no es una feature: **es el `topic`**. Está al 100% en las 420 notas de lectura y es lo que permite que:

- el ritual diario cruce fuentes (C1),
- el triage sepa qué está activo (B2),
- las notas-concepto emerjan de clusters reales (D),
- las 560 notas frías de X sean consultables (E2).

**El sustrato que conecta todo ya existe.** El roadmap es, en el fondo, aprender a usarlo.

## 6. Decisiones abiertas

1. **¿Aflojamos el gate en `Concepts/`?** (§4.2) Es el cambio que desatasca F6. Mi recomendación: sí, con git puesto.
2. **Git en la vault**: ¿Obsidian Git plugin, o commits desde Claude?
3. **Validar el demo** — sigue siendo el bloqueante real.
4. **¿Miramos el plugin `karpathywiki` de la comunidad** antes de escribir el nuestro? Puede que resuelva parte de la capa wiki sin código propio.

## 7. Fuentes

- [Karpathy — LLM Knowledge Bases (tweet original)](https://x.com/karpathy/status/2039805659525644595) · encontrado en los propios bookmarks de Fede
- [Is Karpathy's viral LLM wiki helpful? Mostly yes — R&D World](https://www.rdworldonline.com/is-karpathys-viral-llm-wiki-helpful-mostly-yes-one-month-in/)
- [How to Build Karpathy's LLM Wiki — Starmorph](https://blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide)
- [Karpathy LLM Wiki — plugin de Obsidian](https://community.obsidian.md/plugins/karpathywiki)
- [NicholasSpisak/second-brain — implementación para Obsidian](https://github.com/NicholasSpisak/second-brain)
- **En tus bookmarks también**: @AliAbdaal (*"an LLM-maintained knowledge base that compiles raw sources into articles that surface where experts disagree"*), @garrytan (implementación con pgvector), @Tocelot, @karpathy (*Farzapedia*)
