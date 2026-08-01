# Canon de conceptos — las 238 notas leídas

**2026-08-01.** Cierra el pedido *"apliquemos a todo"*: extraer los conceptos de **todo** el material leído, no solo del cluster `tech`/`producto` que ya habíamos mirado.

## Resultado

| | |
|---|---:|
| Notas leídas procesadas | **238** (Kindle 33 · Read 35 · Legacy/Matter 170) |
| Conceptos candidatos extraídos | 744 |
| **Conceptos canónicos útiles** | **27** |
| Notas cubiertas por el canon | **213 / 238 (89%)** |

**El mayor aporte está en `Legacy/Matter`**: 189 de las 238 apariciones de fuentes vienen de ahí — las 170 notas que Fede leyó en su era Matter y que nunca habíamos tocado (cobertura previa: 0%).

---

## Qué funcionó y qué no (importa para el próximo pase)

**El primer enfoque falló.** Extraer conceptos nota por nota y agrupar después no funciona: cada nota genera un nombre único ("agencia de decisiones cotidianas", "perspectiva temporal sobre eventos"), y agrupar 744 nombres divergentes a posteriori da clusters genéricos de 3 fuentes. El merge global **empeoró** el resultado (392 → 433 canónicos): el modelo renombra en vez de fusionar.

**El fix fue invertir el orden.** Destilar primero un **vocabulario cerrado** de 45 conceptos mirando toda la evidencia junta, y después etiquetar cada nota contra él. Los clusters salen por construcción.

| | Bottom-up | Top-down |
|---|---:|---:|
| Clusters ≥3 fuentes | 29 | **41** |
| Cluster más grande | 4 fuentes | 46 fuentes |
| Calidad de los nombres | genéricos | reconocibles |

**Pero los clusters grandes son cajón de sastre.** *"Reorganización estructural post-tecnología"* juntó 46 notas incluyendo *Breath: The New Science of a Lost Art* (un libro sobre respiración) y *Why more women should get an epidural*. El concepto es tan abstracto que todo entra. Por eso el canon se filtró al rango **5–20 fuentes**:

- **6 descartados por genéricos** (>20 fuentes)
- **8 descartados por ralos** (<5 fuentes)
- **27 conservados**

### Pase incremental (mismo día)

Las 89 notas que quedaron fuera —29 por errores de API, el resto descartadas al filtrar— se reintentaron con `relabel-missing.mjs`, usando **el canon ya filtrado como vocabulario**. Eso es mejor que el original de 45: los conceptos-paraguas ya no están, así que no hay dónde forzar un encaje falso.

| | |
|---|---:|
| Encajaron | **+64** |
| Sin encaje real (lista vacía) | 22 |
| **Cobertura** | **149 → 213 / 238 (89%)** |

Las 22 sin encaje son la respuesta correcta, no una falla: el prompt permite devolver lista vacía explícitamente, y material que no comparte ideas con el resto **no debería** entrar al grafo a la fuerza.

**Verificación tras el crecimiento**: el cluster que más creció (*Herramientas sin agencia propia*, 12 → 25) se revisó para descartar que se hubiera degradado. Sigue coherente — *gpt-4*, *vibe lawyering*, *agents-over-bubbles*, *on-policy vs off-policy learning*, *why AI will save the world* — con un par de dudosos (*Project Hail Mary*). No repitió el problema del cluster de 46.

---

## El canon

### Estrategia y captura de valor

| Concepto | Fuentes |
|---|---:|
| **Captura de valor desigual en cadenas globales** — quién se queda el margen frente a quien hace el trabajo | 13 |
| **Poder empresarial mediante integración vertical** | 10 |
| **Discriminación de precios y opacidad algorítmica** | 10 |
| **Concentración de riqueza en individuos y plataformas** | 8 |
| **Contra-posicionamiento y nichos defendibles** | 6 |
| **Costos de cambio y efectos de red como barrera** | 6 |
| **Ventaja competitiva imitable erosionándose** | 6 |

> *Captura de valor desigual*: Apple in China · Why the world needs more franchises · el truco de precios de las aerolíneas · call centres en África · Las Vegas.

### Organizaciones y gente

| Concepto | Fuentes |
|---|---:|
| **Cultura organizacional como ventaja fundamental** | 12 |
| **Selección y retención de talento como inversión** | 12 |
| **Sobrecapacidad e incompetencia a escala** | 13 |
| **Incentivos económicos alineados con desempeño** | 10 |
| **Crecimiento que oculta disfunción** | 9 |
| **Punto único de fallo por dependencia humana** | 7 |
| **Path dependence y límites de transformar personas** | 6 |

> *Sobrecapacidad e incompetencia a escala*: The Phoenix Project · *You just hired a million bad employees* · 3G Capital · cloud exit.

### Tecnología e IA

| Concepto | Fuentes |
|---|---:|
| **Compounding de capital humano y tecnológico** | **17** |
| **Herramientas sin agencia propia** — los modelos no tienen metas propias; amplifican intención humana | 12 |
| **Adopción de IA sin impacto material inmediato** | 10 |
| **Concentración geográfica como vulnerabilidad estratégica** | 7 |

> *Herramientas sin agencia propia*: How To Actually Design With AI · The rise of vibe lawyering · agents-over-bubbles · gpt-4.

### Poder e instituciones

| Concepto | Fuentes |
|---|---:|
| **Manipulación institucional de la verdad** | 13 |
| **Instituciones como barreras invisibles** | 8 |

> *Manipulación institucional de la verdad*: **1984** · Red Rising · el club secreto de Peter Thiel · Facebook sabe que Instagram es tóxico para adolescentes · Deloitte.
> **Cruza ficción y periodismo de investigación** — de las conexiones más interesantes del canon.

### Vida y desarrollo personal

| Concepto | Fuentes |
|---|---:|
| **Incomodidad deliberada como motor de mejora** | 13 |
| **Identidad como precondición del cambio personal** | 9 |
| **Motivación intrínseca y trabajo significativo** | 9 |
| **Autoconciencia como base de vínculos** | 8 |
| **Aprendizaje amplio antes que especialización temprana** | 6 |
| **Distinción entre experiencia valiosa y desechable** | 5 |
| **Progreso como proceso recursivo e imperfecto** | 5 |

> *Incomodidad deliberada*: **Meditations** · Scaling People · The Stranger in the Woods · How to become so creative it feels illegal.

---

## Validación cruzada con el trabajo manual

Dos de los tres conceptos escritos a mano el 2026-08-01 **reaparecieron solos** en el canon automático:

| Escrito a mano | Emergió como |
|---|---|
| *Poder de mercado y contra-posicionamiento* | **Contra-posicionamiento y nichos defendibles** (6) |
| *Inventar la técnica, no aplicarla* (vía Range) | **Aprendizaje amplio antes que especialización temprana** (6) |

Que el pipeline los redescubra de forma independiente es la mejor señal de que el vocabulario no está inventado.

*Asignación de un recurso finito* no apareció — el canon lo fragmentó en *Motivación intrínseca* e *Identidad como precondición del cambio*. El concepto manual es mejor que sus partes automáticas.

---

## Qué hacer con esto

1. **Los 27 conceptos son candidatos, no notas.** Escribirlos todos sería ruido; conviene elegir los 6–8 con más fuentes leídas y redactarlos con citas, como los tres primeros.
2. **Los mejores candidatos a nota** por densidad y coherencia: *Compounding de capital humano y tecnológico* (17), *Manipulación institucional de la verdad* (13), *Captura de valor desigual en cadenas globales* (13), *Sobrecapacidad e incompetencia a escala* (13).
3. ~~Reintentar las notas fallidas~~ ✅ hecho — cobertura 89%.
4. **Ajustar el prompt del vocabulario** para que no genere conceptos-paraguas: los 6 descartados por genéricos indican que pedir "45 conceptos" empuja a inventar categorías anchas cuando el material no da para tantas.

Datos crudos: `concept-candidates.json` (744 candidatos con evidencia) y `concept-canon.json` (los 27 con sus fuentes).
