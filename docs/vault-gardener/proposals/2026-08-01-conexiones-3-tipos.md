# Pase de conexiones con los 3 tipos — B-731

> Generado por `scripts/connection-pass.mjs` el 2026-08-01. Datos: `connections.json`.
> Reemplaza al demo del 2026-07-13, que mezclaba leído con no leído (15 de 17 notas conectadas estaban sin leer).

## Qué cambió respecto del primer demo

El demo viejo proponía conexiones sin decir si Fede había leído las notas de cada lado.
Eso lo hacía **imposible de validar**: no se puede juzgar si dos textos se conectan
cuando no leíste ninguno de los dos. Ahora cada conexión lleva tipo.

| Tipo | Qué une | Cuántas | Para qué sirve |
|---|---|--:|---|
| **consolidar** | leída ↔ leída | 1.967 | La única que Fede puede juzgar hoy. Valida el modelo |
| **atraer** | leída ↔ no leída | 3.729 | El motor de la cola: "leé esto porque ya sabés aquello" |
| **agrupar** | no leída ↔ no leída | 3.033 | Señala un bloque temático. No afirma nada todavía |

Base: **44 conceptos**, 208 notas leídas, 316 no leídas
(185 encajaron en el vocabulario, 131 no).

## Por qué esto arregla el priorizador

Hoy `rankQueue` cuenta vecinos leídos **por `topic`**. Como hay 7 topics para 316 notas,
solo existen **7 valores distintos de contexto**: las 101 notas `tech` reciben todas el mismo número.
El factor de contexto varía 1,45× mientras `shelfLife` varía 20×, así que el contexto
que la card presenta como razón ("conecta con 48 notas que ya leíste") hoy es
técnicamente cierto y prácticamente inútil.

Con conceptos hay **30 valores distintos** y 184 de 316 notas tienen contexto real
(máximo 37). Las 132 restantes quedan **honestamente en cero**: material sobre el que
todavía no leíste nada. Eso también es información — es la cola "para explorar".

## Las 15 conexiones "atraer" más fuertes

Notas de tu cola con más material leído detrás. Son las que más rinde leer ahora.

| Nota pendiente | Vecinos leídos | Concepto que las conecta |
|---|--:|---|
| Big Food vs. The People | 37 | Manipulación institucional de la verdad · Poder empresarial mediante integración vertical |
| Nuevo paper junto al Presidente @JMilei Minimum Viable Scale . El Pres | 35 | Sobrecapacidad e incompetencia a escala · Cultura organizacional como ventaja fundamental |
| The case for headcount in the age of AI | 34 | Sobrecapacidad e incompetencia a escala · Adopción de IA sin impacto material inmediato |
| it is simultaneously possible to spend a lot on AI and still underuse  | 34 | Adopción de IA sin impacto material inmediato · Sobrecapacidad e incompetencia a escala |
| Ads Don’t Work That Way | 31 | Discriminación de precios y opacidad algorítmica · Manipulación institucional de la verdad |
| Charisma  Power | 31 | Incomodidad deliberada como motor de mejora · Autoconciencia como base de vínculos |
| How to Disagree | 31 | Autoconciencia como base de vínculos · Cultura organizacional como ventaja fundamental |
| Dario Amodei — Policy on the AI Exponential | 30 | Instituciones como barreras invisibles · Manipulación institucional de la verdad |
| How Quake ruined id Software. There has been a lot of praise of Quake  | 30 | Cultura organizacional como ventaja fundamental · Crecimiento que oculta disfunción |
| How to lie about radiation - | 30 | Manipulación institucional de la verdad · Instituciones como barreras invisibles |
| MEMORY IS THE MOAT @nikesharora, Chairman &amp; CEO of @PaloAltoNtwks  | 30 | Adopción de IA sin impacto material inmediato · Poder empresarial mediante integración vertical |
| Severance | 30 | Manipulación institucional de la verdad · Punto único de fallo por dependencia humana |
| The Origins of Wokeness | 30 | Cultura organizacional como ventaja fundamental · Progreso como proceso recursivo e imperfecto |
| How Quake ruined id Software. There has been a lot of praise of Quake | 30 | Cultura organizacional como ventaja fundamental · Crecimiento que oculta disfunción |
| Notes on 100+ Recent Technical Interviews I interview a ton of enginee | 30 | Sobrecapacidad e incompetencia a escala · Selección y retención de talento como inversión |

## Conceptos por peso de cola

Cuánto material pendiente cuelga de cada concepto. Un concepto con muchas no leídas
y pocas leídas es un tema que **venís juntando pero no atacaste**.

| Concepto | Leídas | No leídas |
|---|--:|--:|
| Herramientas sin agencia propia | 10 | 43 |
| Compounding de capital humano y tecnológico | 9 | 37 |
| Identidad como precondición del cambio personal | 10 | 22 |
| Cultura organizacional como ventaja fundamental | 18 | 16 |
| Captura de valor desigual en cadenas globales | 10 | 16 |
| Adopción de IA sin impacto material inmediato | 16 | 15 |
| Poder empresarial mediante integración vertical | 14 | 14 |
| Aprendizaje amplio antes que especialización temprana | 7 | 13 |
| Distinción entre experiencia valiosa y desechable | 7 | 13 |
| Concentración de riqueza en individuos y plataformas | 11 | 12 |
| Instituciones como barreras invisibles | 11 | 12 |
| Punto único de fallo por dependencia humana | 7 | 12 |
| Inventar la técnica, no aplicarla | 3 | 11 |
| Incomodidad deliberada como motor de mejora | 20 | 10 |
| Asignación de un recurso finito | 5 | 10 |
| Progreso como proceso recursivo e imperfecto | 12 | 9 |
| Path dependence y límites de transformar personas | 5 | 9 |
| Autoconciencia como base de vínculos | 14 | 8 |
| Ventaja competitiva imitable erosionándose | 12 | 8 |
| Concentración geográfica como vulnerabilidad estratégica | 8 | 8 |
| Poder de mercado y contra-posicionamiento | 3 | 8 |
| Crecimiento que oculta disfunción | 12 | 7 |
| Selección y retención de talento como inversión | 12 | 7 |
| Sobrecapacidad e incompetencia a escala | 19 | 6 |
| Motivación intrínseca y trabajo significativo | 13 | 6 |
| Costos de cambio y efectos de red como barrera | 10 | 6 |
| Manipulación institucional de la verdad | 24 | 5 |
| Discriminación de precios y opacidad algorítmica | 10 | 4 |
| El contexto manda sobre la capacidad del modelo | 0 | 4 |
| Fortunas construidas en negocios invisibles y equipos mínimos | 0 | 3 |
| Incentivos económicos alineados con desempeño | 10 | 2 |
| Mercados como agregadores falibles de información | 0 | 2 |
| Aprendizaje denso en lugar de consumo pasivo | 0 | 1 |
| Estratificación de la inteligencia por precio | 0 | 1 |
| La energía física como cuello de botella del cómputo | 0 | 1 |
| La valuación y el reporting como narrativa a auditar | 0 | 1 |
| Software rediseñado para consumidores agénticos | 0 | 1 |
| Contención como condición de despliegue de capacidades frontera | 0 | 0 |
| Ficción especulativa como método prospectivo | 0 | 0 |
| Instrumentos financieros nuevos como formas viejas redefinidas | 0 | 0 |
| La filosofía como disputa de definiciones | 0 | 0 |
| Pesos abiertos como palanca geopolítica | 0 | 0 |
| Reacción política contra la IA como riesgo material | 0 | 0 |
| Reducción mecanicista de lo subjetivo | 0 | 0 |

## Lo que este pase NO puede producir

El vocabulario es **cerrado** — las no leídas se etiquetan contra las 44 notas-concepto
que ya existen, y todas salieron de material leído. Por construcción, entonces,
**ningún concepto puede nacer `latente`** (solo fuentes no leídas): todos heredan
al menos las lecturas que los originaron.

Los 131 pendientes sin encaje son justamente los candidatos a conceptos nuevos:
temas que Fede viene guardando y sobre los que todavía no leyó nada. Extraerlos
es lo que completa el modelo de tres estatus de forma honesta.
