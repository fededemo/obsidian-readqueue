# Conceptos latentes — lo que venís juntando y no leíste

> Generado por `scripts/extract-latent-concepts.mjs` el 2026-08-01. Datos: `latent-concepts.json`.
> Propuesta: **no está escrito en la vault**.

## Por qué existe este pase

El modelo de ADR-005 §9-bis.3 tiene tres estatus de concepto:

| Estatus | Cuándo |
|---|---|
| `conocido` | ≥2 fuentes **leídas** lo sostienen |
| `emergente` | 1 leída |
| `latente` | **solo fuentes no leídas** — se lista, no se sintetiza |

Hasta acá las 29 notas-concepto eran **todas `conocido`**, y no por casualidad: el
vocabulario se destiló sobre material leído, así que ningún concepto podía nacer
sin lecturas detrás. El estatus `latente` existía en el diseño y no se podía
instanciar.

Este pase toma las **120 pendientes que no encajaron en ningún concepto existente** y
les destila un vocabulario propio. Lo que sale son temas sobre los que Fede
acumuló material y todavía no leyó nada.

## Los 15 conceptos latentes

Cubren 60 de las 120 pendientes huérfanas. Se descartaron 0 candidatos por
tener menos de 2 fuentes (no se sostienen) o más de 20 (son paraguas — B-735).

### El contexto manda sobre la capacidad del modelo

Los fallos de los LLM y agentes se explican más por el contexto, las reglas y el formato que reciben que por límites del modelo; ingeniar el contexto rinde más que esperar la próxima versión.

**15 fuentes, ninguna leída:**

- [[Algo que me resultó muy útil es crear tests para los flujos más import]]
- [[As many people know, I'm a CTO, and work a lot with my engineering tea]]
- [[Automation is a lie. CLIs are over. The SaaSpocalypse is dumb. A year ]]
- [[Anthropic AI team just dropped the Prompting Playbook that beats most ]]
- [[How we contain Claude across products]]
- [[How we built our knowledge base]]
- [[I’ve had very good results running autoresearch with local qwen 3.6 26]]
- [[Hay un repo que ya tiene más de 142k stars y +14k forks en GitHub. Tom]]
- [[Lots of people asked how I used Fable to edit its own launch video so ]]
- [[New podcast, new format. Three founders join us. Waste Tokens, Save Ti]]
- [[Si quisiera aprender Hermes desde cero, empezaría por estos 6 concepto]]
- [[Si hoy tuviese que aprender Claude Code, arrancaría por esto 1) Agent ]]
- [[The new rules of context engineering for Claude 5 generation models]]
- [[instead of watching 2 hours of Netflix tonight, watch this 40-minute m]]
- [[a prompt I've been using a lot recently implement &lt;SPEC&gt; and whi]]

### Software rediseñado para consumidores agénticos

Las herramientas, APIs y bases de conocimiento construidas para humanos se vuelven obsoletas: el stack se rediseña asumiendo que el usuario principal es un agente automático.

**11 fuentes, ninguna leída:**

- [[As many people know, I'm a CTO, and work a lot with my engineering tea]]
- [[Automation is a lie. CLIs are over. The SaaSpocalypse is dumb. A year ]]
- [[Claude FULL COURSE 1 HOUR (Build &amp; Automate Anything)]]
- [[Introducing the all-new Hydrogen agent-first, any stack]]
- [[How we built our knowledge base]]
- [[Lots of people asked how I used Fable to edit its own launch video so ]]
- [[Making a Billion Intelligent Machines]]
- [[Me and codex were busy. 🔊 — Sonos 🗃️ — WhatsApp 🪶 — X archive 🧰 — ]]
- [[Si quisiera aprender Hermes desde cero, empezaría por estos 6 concepto]]
- [[Si hoy tuviese que aprender Claude Code, arrancaría por esto 1) Agent ]]
- [[instead of watching 2 hours of Netflix tonight, watch this 40-minute m]]

### Mercados como agregadores falibles de información

Los precios incorporan información dispersa mejor que los expertos, pero se desvían de forma detectable en burbujas y crisis; medir esa desviación es una actividad legítima y rentable.

**11 fuentes, ninguna leída:**

- [[Can prediction markets win over Wall Street?]]
- [[I made a live stock market bubble detector that shows bubble indicator]]
- [[Link al paper (043537)]]
- [[Link al paper (592416)]]
- [[Link al paper (164699)]]
- [[Link al paper (150666)]]
- [[Link]]
- [[Matthew Smith has spent the last 18 months modeling every well, pipeli]]
- [[SpaceX a clôturé son premier jour de cotation à 2 100 milliards de dol]]
- [[The Making of a Market Maker]]
- [[🔥 Les comento mi nuevo proyecto HEDGE FUND IEM Les enseño el diagrama]]

### Fortunas construidas en negocios invisibles y equipos mínimos

Los imperios más grandes suelen nacer de negocios aburridos, sin prensa ni hype, y hoy la escala mínima viable para crear valor cae hasta el operador único.

**7 fuentes, ninguna leída:**

- [[David Siegel was programming supercomputers at age 12 at NYU. By 40 he]]
- [[How to Earn a Billion Dollars]]
- [[Invisible Companies]]
- [[Tengo un sideproject por ahí medio muerto y a veces lo uso de laborato]]
- [[The Making of a Market Maker]]
- [[The age of the solopreneur]]
- [[Today, Ramp raised $750M at a $44B valuation. Last time we grew this f]]

### Aprendizaje denso en lugar de consumo pasivo

Una hora de material técnico concentrado de quien construye el sistema sustituye con ventaja meses de contenido pago o entretenimiento; el cuello de botella es la atención asignada, no el acceso.

**7 fuentes, ninguna leída:**

- [[Claude FULL COURSE 1 HOUR (Build &amp; Automate Anything)]]
- [[Anthropic AI team just dropped the Prompting Playbook that beats most ]]
- [[How You Know]]
- [[Hay un repo que ya tiene más de 142k stars y +14k forks en GitHub. Tom]]
- [[Mechanical Watch – Bartosz Ciechanowski]]
- [[Tengo un sideproject por ahí medio muerto y a veces lo uso de laborato]]
- [[The age of the solopreneur]]

### Estratificación de la inteligencia por precio

La demanda de inteligencia es prácticamente infinita, así que el mercado se parte en modelos baratos de alto volumen y modelos premium de razonamiento; elegir bien el modelo por tarea importa más que usar siempre el mejor.

**6 fuentes, ninguna leída:**

- [[Anthropic describe opus 4.7 como un modelo orientado a complex reasoni]]
- [[Good take My guess is - demand for intelligence is near infinite - but]]
- [[I’ve had very good results running autoresearch with local qwen 3.6 26]]
- [[Making a Billion Intelligent Machines]]
- [[New podcast, new format. Three founders join us. Waste Tokens, Save Ti]]
- [[🔥 Les comento mi nuevo proyecto HEDGE FUND IEM Les enseño el diagrama]]

### Contención como condición de despliegue de capacidades frontera

Las capacidades de frontera solo pueden liberarse si vienen acompañadas de mecanismos explícitos de contención y evaluación de riesgo; acelerar sin ese andamiaje es la vía más probable al desastre.

**6 fuentes, ninguna leída:**

- [[A Framework for Frontier AI and the Dawning of a New Age]]
- [[America should not imprison frontier AI]]
- [[Avoiding Death on the Yellow Brick Road]]
- [[How we contain Claude across products]]
- [[Sarah's Wager]]
- [[Our position on open-weights models]]

### Reducción mecanicista de lo subjetivo

Fenómenos que parecen irreducibles —conciencia, posesión, honestidad, herencia biológica— se explican mejor cuando se los descompone en mecanismos físicos concretos, sin negar la experiencia vivida.

**6 fuentes, ninguna leída:**

- [[Honesty and the Human Body]]
- [[How to Do Philosophy]]
- [[How bacteria solved the mystery of inheritance - Works in Progress Magazine]]
- [[Mechanical Watch – Bartosz Ciechanowski]]
- [[Neurons Gone Wild  Melting Asphalt]]
- [[Mr. Jaynes’ Wild Ride]]

### La valuación y el reporting como narrativa a auditar

El precio de mercado y la forma en que una empresa comunica sus métricas son actos narrativos: hay que reconstruir los números por cuenta propia para saber qué se está comprando.

**5 fuentes, ninguna leída:**

- [[How to Earn a Billion Dollars]]
- [[Link al paper (164699)]]
- [[Los directivos de Mercado Libre deberían tomar nota de la llamada con ]]
- [[SpaceX a clôturé son premier jour de cotation à 2 100 milliards de dol]]
- [[Today, Ramp raised $750M at a $44B valuation. Last time we grew this f]]

### Reacción política contra la IA como riesgo material

El rechazo social y político a la IA en Occidente recién empieza y será una restricción más dura que las limitaciones técnicas para quienes construyen con ella.

**4 fuentes, ninguna leída:**

- [[America should not imprison frontier AI]]
- [[Avoiding Death on the Yellow Brick Road]]
- [[Open Weights and American AI Leadership]]
- [[The AI backlash is only getting started]]

### Pesos abiertos como palanca geopolítica

Publicar o retener los pesos de los modelos es una decisión de política exterior, no técnica: define quién fija el estándar global de IA frente a China.

**3 fuentes, ninguna leída:**

- [[Can China dominate AI exports, too?]]
- [[Open Weights and American AI Leadership]]
- [[Our position on open-weights models]]

### La energía física como cuello de botella del cómputo

El límite real de la expansión de la IA no es el silicio ni el talento sino el suministro energético y material; escasez de gas, redes y hardware reciclado deciden qué se puede computar.

**3 fuentes, ninguna leída:**

- [[A low-carbon computing platform from your retired phones]]
- [[Letter III - Got Gas]]
- [[Matthew Smith has spent the last 18 months modeling every well, pipeli]]

### Instrumentos financieros nuevos como formas viejas redefinidas

Stablecoins, mercados de predicción o impuestos a la riqueza no son categorías inéditas sino equivalencias de instrumentos existentes; regularlos bien exige demostrar la equivalencia antes que inventar reglas.

**3 fuentes, ninguna leída:**

- [[Are stablecoins money?]]
- [[Can prediction markets win over Wall Street?]]
- [[How to Convert Between Wealth and Income Tax]]

### La filosofía como disputa de definiciones

Buena parte de los desacuerdos duros (propiedad, autoría, diseño) se disuelven al precisar definiciones; pensar bien es sobre todo clarificar términos, no acumular doctrina.

**3 fuentes, ninguna leída:**

- [[Defining Property]]
- [[How to Do Philosophy]]
- [[Me and codex were busy. 🔊 — Sonos 🗃️ — WhatsApp 🪶 — X archive 🧰 — ]]

### Ficción especulativa como método prospectivo

Escribir escenarios, sátiras y futuros imaginados es una forma rigurosa de análisis tecnológico: revela dinámicas de poder e incentivos que el pronóstico cuantitativo esconde.

**2 fuentes, ninguna leída:**

- [[Mall of America]]
- [[Sarah's Wager]]


## Qué hacer con esto

Un concepto `latente` **no se sintetiza**: no hay nada que sintetizar, no leíste
ninguna. Se lista. Su función es doble:

1. **Mostrar el sesgo de tu cola** — dónde acumulás sin consumir.
2. **Promoverse solo**: al leer 2 fuentes de un latente, pasa a `conocido` y ahí
   sí vale escribir la síntesis con el estándar de `ESTANDAR-NOTAS-CONCEPTO.md`.

Por eso estas notas se escriben con la sección de fuentes y **sin tesis** — poner
una tesis sobre material no leído sería inventarla.
