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
| **atraer** | leída ↔ no leída | 3.464 | El motor de la cola: "leé esto porque ya sabés aquello" |
| **agrupar** | no leída ↔ no leída | 2.465 | Señala un bloque temático. No afirma nada todavía |

Base: **29 conceptos**, 208 notas leídas, 284 no leídas
(164 encajaron en el vocabulario, 120 no).

## Por qué esto arregla el priorizador

Hoy `rankQueue` cuenta vecinos leídos **por `topic`**. Como hay 7 topics para 284 notas,
solo existen **7 valores distintos de contexto**: las 92 notas `tech` reciben todas el mismo número.
El factor de contexto varía 1,45× mientras `shelfLife` varía 20×, así que el contexto
que la card presenta como razón ("conecta con 48 notas que ya leíste") hoy es
técnicamente cierto y prácticamente inútil.

Con conceptos hay **28 valores distintos** y 164 de 284 notas tienen contexto real
(máximo 37). Las 120 restantes quedan **honestamente en cero**: material sobre el que
todavía no leíste nada. Eso también es información — es la cola "para explorar".

## Las 15 conexiones "atraer" más fuertes

Notas de tu cola con más material leído detrás. Son las que más rinde leer ahora.

| Nota pendiente | Vecinos leídos | Concepto que las conecta |
|---|--:|---|
| Big Food vs. The People | 37 | Manipulación institucional de la verdad · Poder empresarial mediante integración vertical |
| how I’m building an agent company inside my agency. the structure look | 35 | Cultura organizacional como ventaja fundamental · Sobrecapacidad e incompetencia a escala |
| AI closed 90% of your support tickets. you released 10 new features th | 34 | Adopción de IA sin impacto material inmediato · Sobrecapacidad e incompetencia a escala |
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
| How Amsterdam invented the fire department - Works in Progress Magazine | 29 | Cultura organizacional como ventaja fundamental · Instituciones como barreras invisibles |

## Conceptos por peso de cola

Cuánto material pendiente cuelga de cada concepto. Un concepto con muchas no leídas
y pocas leídas es un tema que **venís juntando pero no atacaste**.

| Concepto | Leídas | No leídas |
|---|--:|--:|
| Herramientas sin agencia propia | 10 | 37 |
| Compounding de capital humano y tecnológico | 9 | 29 |
| Adopción de IA sin impacto material inmediato | 16 | 21 |
| Identidad como precondición del cambio personal | 10 | 20 |
| Captura de valor desigual en cadenas globales | 10 | 17 |
| Cultura organizacional como ventaja fundamental | 18 | 16 |
| Concentración de riqueza en individuos y plataformas | 11 | 13 |
| Asignación de un recurso finito | 5 | 13 |
| Instituciones como barreras invisibles | 11 | 12 |
| Aprendizaje amplio antes que especialización temprana | 7 | 12 |
| Punto único de fallo por dependencia humana | 7 | 12 |
| Distinción entre experiencia valiosa y desechable | 7 | 11 |
| Autoconciencia como base de vínculos | 14 | 9 |
| Poder empresarial mediante integración vertical | 14 | 9 |
| Progreso como proceso recursivo e imperfecto | 12 | 9 |
| Path dependence y límites de transformar personas | 5 | 9 |
| Inventar la técnica, no aplicarla | 3 | 9 |
| Incomodidad deliberada como motor de mejora | 20 | 7 |
| Ventaja competitiva imitable erosionándose | 12 | 7 |
| Sobrecapacidad e incompetencia a escala | 19 | 6 |
| Motivación intrínseca y trabajo significativo | 13 | 6 |
| Concentración geográfica como vulnerabilidad estratégica | 8 | 6 |
| Poder de mercado y contra-posicionamiento | 3 | 6 |
| Manipulación institucional de la verdad | 24 | 5 |
| Crecimiento que oculta disfunción | 12 | 5 |
| Selección y retención de talento como inversión | 12 | 5 |
| Costos de cambio y efectos de red como barrera | 10 | 5 |
| Discriminación de precios y opacidad algorítmica | 10 | 4 |
| Incentivos económicos alineados con desempeño | 10 | 1 |

## Lo que este pase NO puede producir

El vocabulario es **cerrado** — las no leídas se etiquetan contra las 29 notas-concepto
que ya existen, y todas salieron de material leído. Por construcción, entonces,
**ningún concepto puede nacer `latente`** (solo fuentes no leídas): todos heredan
al menos las lecturas que los originaron.

Los 120 pendientes sin encaje son justamente los candidatos a conceptos nuevos:
temas que Fede viene guardando y sobre los que todavía no leyó nada. Extraerlos
es lo que completa el modelo de tres estatus de forma honesta.
