# Validación del demo de conexiones

**Qué estás validando**: Claude leyó 19 notas tuyas de `tech` + `producto` y propuso 10 conexiones entre ellas. Necesito saber cuáles son **reales y útiles** y cuáles son **asociaciones forzadas** (suenan bien pero no aportan).

**Por qué importa**: si la mayoría sirve, escalamos esto a tus 8 dominios y empezamos a escribir las notas-concepto. Si la mayoría es ruido, hay que recalibrar antes de escribir nada en tu vault. **Las que te parezcan forzadas son la información más valiosa** — me dicen dónde el modelo se pasa de listo.

**Cómo responder**: lo más rápido es decirme por chat *"me sirven la 1, 5, 8 y 10; la 3 y la 9 son forzadas"*. No hace falta que edites este archivo. Si preferís, marcá con una X acá.

---

## 1. Do Things that Don't Scale ←→ The Patriot (Shyam Sankar, Palantir)

La receta de Paul Graham —fundadores reclutando usuarios a mano, metiéndose físicamente con los primeros clientes— es exactamente la doctrina "Forward Deployed Engineer" que Sankar inventó en Palantir: se embebió con los ingenieros de los bancos porque *"el spec en San Francisco no coincidía con la realidad del terreno"*. Misma idea, una como consejo de YC y otra como perfil de defense-tech.

`[ ] sirve` · `[ ] forzada`

## 2. AI's Biggest Winners Have the Lowest Margins → *extiende* → Do Things that Don't Scale

"Vendé IA como infraestructura, no como herramienta": embebé el agente dentro del workflow existente para que el valor llegue sin que nadie tenga que adoptar un sistema nuevo. Es la versión enterprise de la regla de PG — no construís mejor ratonera y esperás, vas al usuario y le sacás la fricción de adopción.

`[ ] sirve` · `[ ] forzada`

## 3. How to Get Startup Ideas ←→ The Wu Tapes

PG: *"viví en el futuro y construí lo que falta… estímulo externo pegando en una mente preparada"*. Wu *"predijo antes que la mayoría que la industria convergería en agentes 24/7"* — la mente preparada parada en el filo de un campo que se mueve rápido.

`[ ] sirve` · `[ ] forzada`

## 4. The Anatomy of Determination ←→ The Wu Tapes

PG: la determinación (voluntad + disciplina), no la inteligencia, predice el éxito del fundador. Wu, obsesivamente competitivo, *"dispuesto a shipear temprano y absorber el backlash"* (Devin de 13% a ~90% en SWE-Bench), es el caso de estudio de voluntad+disciplina ganándole al talento crudo.

`[ ] sirve` · `[ ] forzada`

## 5. Why Token Optimization… → *extiende* → What Business Can Learn from Open Source ⭐

PG en **2005**: el open source commoditiza el software propietario porque *"Microsoft no puede pagar lo suficiente para superar a hackers inspirados que lo construyen gratis"*. La nota de tokens muestra esa misma dinámica pegándole a los labs de IA — el margen del model-provider tiende a cero y el valor migra al peaje del hyperscaler. **Un ensayo de hace 21 años prediciendo el colapso de la capa de modelo de hoy.**

`[ ] sirve` · `[ ] forzada`

## 6. Hiring is Obsolete ←*contradice*→ The case for headcount in the age of AI

PG: el costo de construir colapsa → necesitás menos gente. Revolut: *"la narrativa AI = equipos chicos es mayormente un cuento"*, la IA *"expuso lo mal recurseada que estaba mi ambición"* → peleo por contratar más. *(Nota: puede ser en parte un mismatch de etapa, no una contradicción pura.)*

`[ ] sirve` · `[ ] forzada`

## 7. You can't unit test for taste ←→ How To Actually Design With AI

Desde una pipeline de datos y desde un workflow de diseño, misma conclusión: el LLM ejecuta reglas bien pero no entiende el gusto; el humano aporta significado; y el gusto resiste verificación (*"no hay unit tests red/green para el gusto"* · *"los mejores resultados no vienen de mejores prompts sino de mejor gusto"*).

`[ ] sirve` · `[ ] forzada`

## 8. How LLMs Actually Work ←→ You can't unit test for taste ⭐

La nota técnica documenta el *"lost in the middle"* (los modelos usan mejor el principio y el final del prompt que el medio). Karl reporta el síntoma como folk-wisdom: *"los contextos grandes degradan rápido la calidad del agente"*, así que arranca sesión nueva por hito. **Una nota es la explicación ML de la práctica vivida de la otra** — invisible desde los títulos.

`[ ] sirve` · `[ ] forzada`

## 9. A harness for every task ←→ What I've Learned from Users

Los tres modos de falla de un contexto sobrecargado (pereza agéntica, sesgo auto-preferencial, deriva de objetivo) mapean uno a uno con las patologías que PG documenta en fundadores humanos (perder foco, mal-juzgar qué importa, no verificar las corazonadas propias). Y el fix es el mismo: PG "shardeó" su carga de advising en pods con loops semanales; el harness "fanea" en contextos aislados con verificadores. *(Es síntesis de Claude, no de los autores — la más especulativa de las 10.)*

`[ ] sirve` · `[ ] forzada`

## 10. How LLMs Actually Work → *prerequisito* → Why Token Optimization…

No podés seguir la economía de tokens (Jevons sobre inferencia, $/millón-token) sin entender antes qué es un token: la tokenización y el pipeline "texto entra, enteros salen".

`[ ] sirve` · `[ ] forzada`

---

## Y las 3 notas-concepto candidatas

Estas son "las neuronas": notas nuevas que agruparían varias fuentes bajo una idea. ¿Valen la pena?

**A. `Taste as the human residue in AI work`**
Junta: *You can't unit test for taste* · *How To Actually Design With AI* · *A harness for every task* · *The Wu Tapes*.
La idea: la IA ejecuta trabajo estructurado con confianza, pero no origina gusto, significado ni dirección — eso queda humano. Y el gusto resiste verificación automática, así que el loop es humano-define → IA-ejecuta → humano-juzga.

`[ ] vale` · `[ ] no`

**B. `Do things that don't scale / forward-deployed`**
Junta: *Do Things that Don't Scale* · *The Patriot* · *AI's Biggest Winners* · *What I've Learned from Users* · *How to Get Startup Ideas*.
La idea: los buenos productos vienen del contacto no-escalable con usuarios reales, no de un spec escrito lejos del terreno. La fricción de adopción es el enemigo; ganás absorbiéndola vos.

`[ ] vale` · `[ ] no`

**C. `Commoditization of the model layer`**
Junta: *Why Token Optimization* · *Anthropic's Safety Superpower* · *What Business Can Learn from Open Source* · *AI models' values are very different*.
La idea: el valor se drena del modelo (destilación open-weight + optimización de tokens llevan el margen a cero) y se acumula en infraestructura, orquestación, el touchpoint del usuario y el loop de aprendizaje privado. PG nombró el mecanismo en 2005. La pregunta: ¿qué capa no-commoditizada dueñás?

`[ ] vale` · `[ ] no`

---

## Preguntas extra (opcionales, pero ayudan)

1. ¿Alguna te hizo pensar algo que no habías notado? ¿Cuál?
2. ¿Preferís **pocas conexiones muy sólidas** o **muchas aunque algunas sean flojas**?
3. Las notas-concepto, ¿las querés cortas (3-4 líneas) o desarrolladas (un párrafo por fuente)?
