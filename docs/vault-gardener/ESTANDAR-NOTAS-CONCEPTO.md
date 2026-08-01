# Estándar de calidad — notas-concepto

> **Por qué existe este documento.** El primer pase automático generó 26 notas-concepto técnicamente correctas y **frías**: glosa de una línea más una lista de citas. Fede: *"me gustaba mucho más la forma anterior… esto está bien pero es más frío"*. Tenía razón. Este archivo fija la vara para que ningún pase futuro vuelva a producir índices en vez de pensamiento.
>
> Complementa a [ADR-003](../architecture/ADR-003-contrato-extraccion-conceptos.md), que define **cómo se extraen** los conceptos. Esto define **cómo se escriben**.

---

## La regla de una línea

**Una nota-concepto tiene que afirmar algo que se pueda discutir.** Si nadie puede estar en desacuerdo con ella, es una etiqueta, no un concepto.

| ❌ Etiqueta | ✅ Tesis |
|---|---|
| *"Control del relato histórico y desinformación como herramientas de poder"* | *"El poder durable no viene de tener el mejor producto: viene de ocupar una posición que el titular no puede copiar sin hacerse daño a sí mismo."* |
| Describe un tema | Afirma algo, y por lo tanto se puede refutar |

---

## Las cuatro partes

### 1. La idea — una tesis, no un resumen

Abre afirmando. Dos o tres oraciones que digan **qué sostiene este concepto**, en indicativo. Si empieza con "Este concepto agrupa…" o "Reflexiones sobre…", está mal.

El mejor movimiento es dar vuelta la observación obvia hacia algo que sorprenda:

> *Los modelos no quieren nada. No tienen metas, ni criterio, ni dirección propia — y eso, que suena a límite técnico, es en realidad una afirmación **sobre el humano**.*

Anclala inmediatamente en **una cita textual** de la fuente que mejor la formule.

### 2. Las fuentes en diálogo — no en lista

Cada fuente entra diciendo **desde dónde** habla y **qué agrega** que las otras no:

> *[[How To Actually Design With AI]] lo dice desde el oficio… [[A frontier without an ecosystem is not stable]] lo dice desde la estrategia… Y [[The rise of vibe lawyering]] muestra el costo de olvidarlo.*

Eso es lo que faltaba en las generadas. Una lista de seis citas bajo un título común no es una idea: es un cajón ordenado.

### 3. La tensión — la parte que más vale

**Buscá activamente las fuentes que complican la tesis y dales el lugar de honor.** Un concepto donde todas las fuentes asienten no enseña nada; uno donde dos se contradicen obliga a pensar.

> *Dos fuentes leídas complican la tesis, y por eso valen más que las que la confirman.*

Si de verdad no hay tensión en el material, decilo — no la inventes. Pero buscala primero: casi siempre está.

Cerrá con una **pregunta abierta** que quede viva:

> *Si el valor está en la dirección humana, ¿qué pasa cuando la herramienta ejecuta tan bien que dirigirla ya no requiere entender el oficio?*

### 4. Las fuentes — filtradas y clasificadas

Agrupadas por rol, no por carpeta:

```
**Sostienen la tesis** — …
**La complican** — …
**Ver también** — [[concepto vecino]] — por qué se relaciona
```

---

## Filtrar es parte del trabajo

**Es mejor una nota con 9 fuentes que sostienen la idea que una con 25 que comparten vocabulario.**

El clustering automático agrupa por proximidad léxica, y eso arrastra ruido: en *Herramientas sin agencia propia* traía *Project Hail Mary* (que habla de relatividad), Selenium (automatizar navegadores) y una entrevista a Buterin (eficiencia vs. seguridad). Ninguna sostiene la tesis.

**Anotá lo que descartaste y por qué**, al pie:

> *El cluster automático traía 25 fuentes; se descartaron 16 que compartían vocabulario pero no la idea.*

Sin esa nota, el filtrado parece pérdida de información. Con ella, es criterio.

---

## Reglas duras

| Regla | Por qué |
|---|---|
| **Solo fuentes leídas** | Una síntesis de material sin leer es resumen ajeno, no conocimiento (ADR-005 §9-bis.3) |
| **Citas textuales, no paráfrasis** | La cita es lo que hace auditable la afirmación contra la fuente |
| **Todo wikilink verificado** | Un link a un archivo inexistente es ruido en el grafo — verificar contra los stems reales de la vault |
| **Sin relleno** | Nada de "en conclusión", "es importante notar", "cabe destacar" |
| **≥2 fuentes leídas** | Menos que eso es una nota de lectura, no un concepto |

---

## Checklist antes de dar por buena una nota

- [ ] La apertura **afirma** algo con lo que se podría estar en desacuerdo
- [ ] Hay al menos una **cita textual** en los primeros dos párrafos
- [ ] Cada fuente entra diciendo **desde dónde habla**, no solo listada
- [ ] Existe una sección de **tensión** con al menos una fuente que complica la tesis (o se explica por qué no hay)
- [ ] Cierra con una **pregunta abierta**, no con un resumen
- [ ] Las fuentes están **filtradas**: se descartó lo que comparte vocabulario pero no idea, y se anotó
- [ ] **Cero wikilinks rotos**
- [ ] Se lee en **menos de dos minutos**

---

## Referencias vivas

Notas que cumplen el estándar y sirven de modelo:

| Nota | Qué mostrar de ella |
|---|---|
| `Concepts/Herramientas sin agencia propia.md` | La tensión bien hecha: Hassabis y *the-intelligence-of-bodies* atacando la tesis desde ángulos distintos. Y el filtrado de 25 → 9 documentado al pie |
| `Concepts/Poder de mercado y contra-posicionamiento.md` | Marco teórico (7 Powers) + caso vivo (Nvidia) contra el mismo Intel. La tensión final: ¿el poder es estructural o lo decide la ejecución? |
| `Concepts/Asignación de un recurso finito.md` | Tres fuentes que dicen lo mismo **en monedas distintas** (talento, atención, tiempo contable) |
| `Concepts/Inventar la técnica, no aplicarla.md` | La misma biografía dos veces (Simons, Hassabis) + el costo + la pregunta de si es repetible |

---

## Qué NO es una nota-concepto

- Un **resumen** de una lectura → eso va en la nota de la fuente
- Una **categoría** (`tech`, `producto`) → eso es el `topic`
- Un **índice** de notas relacionadas → eso lo hace el grafo solo
- Una **lista de citas** bajo un título → es el error del primer pase automático
