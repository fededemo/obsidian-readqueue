# Propuestas de conexión — cluster `producto` + `tech`

> **Fase 1 (suggestion-only).** Generado por Claude el 2026-07-13 leyendo 19 notas. **Nada de esto está escrito en la vault** — es una propuesta para que Fede revise y aplique a mano lo que le cierre. Ver `ADR-002`.
>
> Tema del cluster: **"construir empresas y productos en la era de la IA."** Empareja el canon de startups (Paul Graham) con las notas actuales de negocio-IA y mecánica-IA, para linkear ideas viejas con sus instancias nuevas.

## Notas leídas (19)

**producto:** The Wu Tapes (Scott Wu / Cognition) · AI's Biggest Winners Have the Lowest Margins · The case for headcount in the age of AI · Hiring is Obsolete · Do Things that Don't Scale · How to Get Startup Ideas · What Business Can Learn from Open Source · Startup = Growth · You can't unit test for taste · The Anatomy of Determination · What I've Learned from Users · The Patriot (Shyam Sankar / Palantir)

**tech:** How LLMs Actually Work · How we contain Claude across products · Why Token Optimization Is a Gift to the Hyperscalers · A harness for every task (dynamic workflows in Claude Code) · Anthropic's Safety Superpower · AI models' values are very different from most people's · How To Actually Design With AI

---

## Conexiones propuestas

Relación ∈ {relacionado, extiende, contradice, prerequisito, mismo-concepto}. ⭐ = alta confianza (grounded en afirmaciones textuales de **ambas** notas).

1. ⭐ **[[Do Things that Don't Scale]] —(mismo-concepto)→ [[The Patriot: Shyam Sankar of Palantir]]** — La prescripción de PG (fundadores reclutando a mano y metiéndose físicamente con los primeros usuarios) es exactamente la doctrina "Forward Deployed Engineer" que Sankar inventó en Palantir: se embebió con los ingenieros de los bancos porque "el spec en San Francisco no coincidía con la realidad del terreno". Misma idea, una como consejo de YC y otra como perfil de defense-tech.
2. ⭐ **[[AI's Biggest Winners Have the Lowest Margins]] —(extiende)→ [[Do Things that Don't Scale]]** — "Vendé IA como infraestructura, no como herramienta"; embebé el agente "dentro del workflow existente" para que el valor llegue "sin que un empleado adopte un sistema nuevo". Es la extensión enterprise de la regla de PG: no construís mejor ratonera y esperás, vas al usuario y le sacás toda la fricción de adopción.
3. **[[How to Get Startup Ideas]] —(mismo-concepto)→ [[The Wu Tapes]]** — PG: "viví en el futuro y construí lo que falta… estímulo externo pegando en una mente preparada". Wu "predijo antes que la mayoría que la industria convergería en agentes 24/7" — la mente preparada en el filo de un campo que cambia rápido.
4. **[[The Anatomy of Determination]] —(relacionado)→ [[The Wu Tapes]]** — PG: la determinación (voluntad + disciplina), no la inteligencia, predice el éxito del fundador. Wu, obsesivamente competitivo, "dispuesto a shipear temprano y absorber el backlash" (Devin a 13% SWE-Bench → ~90%), es el caso de estudio de voluntad+disciplina superando al talento crudo.
5. ⭐ **[[Why Token Optimization Is a Gift to the Hyperscalers]] —(extiende)→ [[What Business Can Learn from Open Source]]** — PG (2005): el open source commoditiza el software propietario porque "Microsoft no puede pagar lo suficiente para superar a hackers inspirados que lo construyen gratis". La nota de tokens muestra esa dinámica pegándole a los labs de IA — el "margen del model-provider tiende a cero" y el valor migra al "peaje" del hyperscaler. **Un ensayo de hace 20 años prediciendo el colapso de la capa de modelo de hoy.**
6. **[[Hiring is Obsolete]] —(contradice)→ [[The case for headcount in the age of AI]]** — PG: el costo colapsante de construir → necesitás menos gente. Revolut: "la narrativa AI = equipos chicos es mayormente un cuento", la IA "expuso lo mal recurseada que estaba mi ambición" → peleo por contratar más. *(Tensión de superficie real, pero es en parte un mismatch de etapa — ver honestidad.)*
7. **[[You can't unit test for taste]] —(mismo-concepto)→ [[How To Actually Design With AI]]** — Desde una pipeline de datos y desde un workflow de diseño, misma conclusión: el LLM ejecuta reglas bien pero "no entiende el gusto"; el humano aporta significado; y el gusto resiste verificación ("no hay unit tests red/green para el gusto" · "los mejores resultados no vienen de mejores prompts sino de mejor gusto"). Ambas degradan la IA de "el producto" a "una herramienta más".
8. ⭐ **[[How LLMs Actually Work]] —(relacionado)→ [[You can't unit test for taste]]** — La nota de mecánica documenta el "lost in the middle" (los modelos usan mejor el principio/final del prompt que el medio). Karl reporta el síntoma como folk-wisdom: "los contextos grandes degradan rápido la calidad del agente", así que arranca sesión nueva por hito. **Una nota es la explicación ML de la práctica vivida de la otra** — invisible desde los títulos.
9. ⭐ **[[A harness for every task]] —(relacionado)→ [[What I've Learned from Users]]** — Los tres modos de falla de un contexto sobrecargado (pereza agéntica, sesgo auto-preferencial, deriva de objetivo) mapean uno-a-uno a las patologías que PG documenta en fundadores humanos (perder foco, mal-juzgar qué importa, no verificar las corazonadas propias). Y el fix es el mismo: PG "shardeó" su carga O(n²) de advising en pods dedicados con loops semanales; el harness "fanea" en context windows aislados con verificadores adversariales. *(Es mi síntesis, no de los autores — ver honestidad y serendipia.)*
10. **[[How LLMs Actually Work]] —(prerequisito)→ [[Why Token Optimization Is a Gift to the Hyperscalers]]** — No podés seguir la economía de tokens (Jevons sobre inferencia, $/millón-token) sin entender antes qué es un token: la tokenización y el pipeline "texto entra, enteros salen".

---

## Notas-concepto candidatas (las neuronas)

**[[Taste as the human residue in AI work]]** — `concepts: taste`
Fuentes: You can't unit test for taste · How To Actually Design With AI · A harness for every task · The Wu Tapes.
*Síntesis:* A través de una pipeline de datos, un workflow de diseño, una guía de orquestación de agentes y la autodescripción de un olímpico de matemática, Fede convergió en una creencia estable: la IA ejecuta con confianza trabajo estructurado y reglado, pero no origina gusto, significado ni dirección — eso queda humano. El gusto además resiste verificación automática (no hay ground truth), así que el loop es humano-define → IA-ejecuta → humano-juzga. Curiosamente las fuentes coinciden en que el modelo *sí* tiene "gusto subjetivo latente en sus pesos" que podés hacer aflorar con rúbricas y torneos, aunque no lo puedas unit-testear.

**[[Do things that don't scale / forward-deployed]]** — `concepts: forward-deployed`
Fuentes: Do Things that Don't Scale · The Patriot (Palantir FDE) · AI's Biggest Winners… · What I've Learned from Users · How to Get Startup Ideas.
*Síntesis:* La lección recurrente: los buenos productos vienen del embedding no-escalable y de alto contacto con usuarios reales, no de un spec escrito lejos del terreno. Aparece como reclutamiento manual (Airbnb/Stripe), ingenieros forward-deployed llevando un producto con bugs a un banco o a una zona de guerra (Palantir), e IA cableada en el workflow existente en vez de vendida como herramienta. La fricción de adopción es el enemigo; ganás absorbiéndola vos y aprendiendo del ground truth del uso.

**[[Commoditization of the model layer]]** — `concepts: value-capture`
Fuentes: Why Token Optimization… · Anthropic's Safety Superpower · What Business Can Learn from Open Source · AI models' values are very different…
*Síntesis:* El valor en IA se está drenando del modelo en sí — la destilación open-weight (DeepSeek/Qwen) más la optimización de tokens llevan el margen del model-provider hacia cero — y se acumula en las capas que quedan pegajosas: infraestructura (el peaje del hyperscaler), la orquestación/harness, el touchpoint del usuario, y el loop de aprendizaje privado de cada empresa. PG nombró el mecanismo en 2005: el open source commoditiza porque el amor supera al dinero. La pregunta estratégica: ¿qué capa no-commoditizada dueñás?

---

## Ask-your-vault (demo)

**P: "En todo lo que leí, ¿dónde se acumula el valor durable en IA — el modelo, o en otro lado?"**
Consenso de la vault: **no el modelo.** *Why Token Optimization…* dice que el margen por-token se comprime sobre la capa de modelo mientras el "peaje" del hyperscaler y la orquestación quedan pegajosos; *Anthropic's Safety Superpower* dice que los modelos frontier se "destilan y commoditizan por open source", así que los labs deben "dueñar el touchpoint del usuario"; y *AI's Biggest Winners…* ubica la ganancia en infraestructura-de-workflow embebida, no en la llamada al modelo. *What Business Can Learn from Open Source* da el mecanismo de hace 20 años detrás de las tres.

**P: "¿Cómo sé que estoy construyendo algo que la gente realmente quiere?"**
Construí algo que vos mismo necesitás con urgencia y del que sos usuario de vanguardia (*How to Get Startup Ideas* — "¿quién lo quiere tanto que usaría un v1 malo?"), después embebete con usuarios reales en vez de confiar en tu spec (*Do Things that Don't Scale*; los forward-deployed de *The Patriot* encontrando que "el spec no coincidía con la realidad"). Testealo con la pregunta de PG en *What I've Learned from Users*: "¿lo usarías vos, si no lo hubieras construido?"

---

## Serendipia

**[[A harness for every task]] es en secreto [[What I've Learned from Users]].** Un hilo de ingeniería de Anthropic sobre orquestar agentes de Claude Code y un ensayo de Paul Graham sobre correr Y Combinator describen el mismo problema y la misma solución. Los modos de falla de un contexto sobrecargado (pereza agéntica, sesgo auto-preferencial, deriva de objetivo) son las mismas patologías que PG documenta en fundadores humanos; y el fix es la misma descomposición (PG "shardeó" su O(n²); el harness "fanea" en contextos aislados con verificadores). **Por qué importa para el segundo cerebro de Fede:** implica que orquestar agentes sobre 629 notas es un problema de *diseño organizacional* — y que las notas-concepto atómicas son ellas mismas una estrategia de "sharding" contra la misma degradación de contexto que *How LLMs Actually Work* llama "lost in the middle".

---

## Honestidad (lo que hace confiable esto)

- **La conexión #6 es la más débil:** es en parte un mismatch de etapa, no un choque real. PG habla de necesitar *menos gente para arrancar*; Revolut de perseguir *más apuestas* una vez que sube el techo. La etiqueté `contradice` porque la tensión de superficie es real y productiva, pero un lector cuidadoso las reconcilia.
- **La #9 (serendipia) es síntesis mía, no de los autores.** Ninguna nota referencia a la otra; la isomorfía es una analogía que impongo. Es la conexión más impresionante y, correspondientemente, la más interpretativa.
- **`topic` es grueso.** The Patriot, The Wu Tapes y varios perfiles largos están bajo `producto`; una búsqueda por similitud ingenua se ahogaría en el contenido de gala/política y perdería el core FDE. Confirma que **los conceptos hay que extraerlos**, no derivarlos de `topic`.
- **Algunas "notas" son marketing, no conocimiento.** *AI's Biggest Winners…* termina en un CTA de ventas; *How To Actually Design With AI* tiene affiliate links. El grafo debería ponderar por calidad de fuente o estas piezas promocionales van a sobre-conectar.
- **Higiene de datos que el grafo necesita primero:** hay un **duplicado** — `Franchising has quietly made countless Americans rich.md` y `…rich 1.md` son el mismo artículo (dedupe antes de linkear). Y las notas de `Inbox/Legacy/Matter/` son mayormente stubs de 100-400 palabras (bajo señal); las ideas reales viven en `Inbox/Web/` long-form → ponderar por longitud.
- **Hallazgo estructural para el build:** la vault tiene un **canon de Paul Graham (11+ ensayos)** que funciona como "textos fuente" no-declarados de muchas notas nuevas de la era-IA. Las notas-concepto serán más fuertes ancladas en estos ensayos canónicos, con las notas recientes colgando como instancias modernas — **el grafo ya tiene una forma hub-and-spoke latente en el contenido.**
