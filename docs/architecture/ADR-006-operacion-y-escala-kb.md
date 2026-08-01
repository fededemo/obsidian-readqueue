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
