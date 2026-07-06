# F5 — Instructivo para Fede (Kindle + Wishlist + Recomendador)

> Todo lo de código está shipped y verde (438 tests). Esto es lo que tenés que
> hacer **vos** para ponerlo a andar. Nada de esto pide un release: corre desde
> el working tree / tu build local de BRAT.

---

## Parte 1 — Extensión de Kindle (highlights) · ~20 min

La extensión sincroniza tus **highlights de Kindle** a la vault, en background,
mientras Chrome esté abierto. Ojo: **solo funciona en Chromium** (Chrome / Edge /
Brave / Arc). En Safari no carga (usa APIs que Safari no tiene).

### 1.1 Preparar

1. En Obsidian (o Finder), creá la carpeta **`Inbox/Kindle/`** en tu vault
   `fedenotes`. **Tiene que existir antes** — el selector de la extensión no la
   crea. (Ya es el default del setting `kindleFolder`.)
2. En el repo:
   ```bash
   cd ~/codes/obsidian-readqueue
   npm install          # si no lo corriste antes
   npm run build:extension
   ```
   Eso genera `extension/background.js`, `popup.js`, `offscreen.js`.

### 1.2 Cargar en Chrome

3. Abrí Chrome → `chrome://extensions/` → activá **Developer mode** (arriba a la
   derecha) → **Load unpacked** → elegí la carpeta `extension/`.

### 1.3 Conectar la carpeta de la vault

4. Click en el ícono de la extensión → **"Elegir carpeta de la vault"**.
5. Navegá a:
   `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/fedenotes/Inbox/Kindle`
   y seleccionala.
6. En el prompt de Chrome, elegí **"Allow on every visit"** (importante: sin esto
   el auto-sync se pausa y hay que reautorizar cada vez).

### 1.4 Loguearte en Amazon

7. Abrí `https://read.amazon.com/notebook` en una pestaña de Chrome y logueate
   (si no lo estabas). La extensión reusa esa misma sesión — no copiás cookies.
   > Tu cuenta es **amazon.com (US)** — lo confirmé: la wishlist responde en
   > `.com` (los precios salen en UYU, pero el marketplace es US). El scraper ya
   > apunta a `read.amazon.com`, así que estás cubierto.

### 1.5 Primer sync + verificación

8. Popup → **"Sincronizar ahora"** → esperá la notificación
   (`N libros nuevos · M highlights`). Mirá que aparezcan `.md` en `Inbox/Kindle/`.
9. En Obsidian: abrí la vista **Highlights** (ícono de resaltador en el ribbon) →
   deberían verse los libros con badge kindle. Corré **"Repasar highlights de hoy"**
   y confirmá que mezcla fuentes (web + Kindle + Matter).
10. **Corré "Sincronizar ahora" una segunda vez** → tiene que decir "Sin novedades"
    (cero duplicados). Si duplica, avisame.
11. Verás un archivo `Inbox/Kindle/.kindle-sync-state.json` — es el sidecar que
    hace todo no-destructivo (es normal, dejalo ahí; viaja por iCloud).

### 1.6 Cosas a saber

- **Auto-sync**: corre cada 24h **solo con Chrome abierto**. Si usás Safari y abrís
  Chrome poco, no pasa nada: los highlights se acumulan en Amazon y el merge se
  pone al día en una corrida. No hay nada que perder.
- **Sesión de Amazon** expira ~cada 14 días → el sync avisa con notificación clara;
  reabrís `read.amazon.com/notebook`, te logueás, "Sincronizar ahora", listo.
- **"Reset libros"** ahora es seguro: re-escanea sin pisar tus ediciones (las notas
  existentes se re-adoptan, solo se recrean las que hayas borrado).
- Detalle técnico completo: `extension/README.md`.

---

## Parte 2 — Wishlist de Amazon → fichas en `Books/` · ~2 min

**Dónde dejar tu wishlist: en un setting del plugin, como link compartido.** No
hace falta tocar la extensión ni permisos nuevos — el plugin la trae solo con
`requestUrl()` (lo verifiqué contra tu lista real: responde HTTP 200 sin sesión).

1. Asegurate de que tu wishlist esté **compartida por link** en Amazon
   (Wishlist → "…" / Share → "View only" / link público). La tuya ya lo está:
   `https://www.amazon.com/hz/wishlist/ls/TA4HR5QISRKH`
2. En Obsidian → Settings → **ReadQueue** → sección **"Books y recomendaciones"**
   → pegá esa URL en **"URL de la wishlist de Amazon"**.
   (Podés pegar la URL completa o solo el id `TA4HR5QISRKH` — el plugin extrae el
   id solo.)
3. Paleta de comandos → **"Sincronizar wishlist de Amazon"**.
4. Aparecen fichas en **`Books/`** (una por libro, `shelf: wishlist`), con título,
   autor, ASIN y link a Amazon. La notificación te dice cuántas creó/actualizó.
   - Si un libro se cae de la wishlist sin comprarlo → la ficha queda marcada
     `wishlistRemoved: true` (señal para el recomendador), no se borra.
   - Cadencia sugerida: semanal, a demanda (no hay job automático en v1).

> Tu primer sync trae ~20+ libros (Outlive, A Philosophy of Software Design,
> Hidden Champions, The Narrow Corridor, la biografía de LBJ, etc.).

---

## Parte 3 — Recomendador "¿Qué leo ahora?" · ~1 min

Cruza lo que **leíste** + lo que **subrayaste** + tu **cola** + tus **libros** +
tu **wishlist** y le pide a Claude 3–5 recomendaciones rankeadas. Regla de oro:
**primero lo que ya tenés sin leer, después wishlist, y solo al final sugerencias
nuevas** (es recomendador y anti-compra-compulsiva a la vez).

1. Necesitás tu **Anthropic API key** cargada en Settings → ReadQueue (la misma
   que usás para clasificar). El modelo por defecto es `claude-sonnet-5` (1 llamada
   por vez, centavos).
2. Paleta → **"¿Qué leo ahora? (recomendar libros)"**.
3. Se crea/abre `Books/Recomendaciones/AAAA-MM-DD.md` con las recomendaciones,
   el porqué de cada una (conectando con artículos/highlights concretos, con
   `[[links]]` navegables) y una sección "Empezá por lo que ya tenés".
4. Cuando arranques un libro, abrí su ficha y corré **"Empezar este libro"**
   (marca `readingStatus: reading`); la próxima corrida del recomendador lo tiene
   en cuenta.

> **Privacidad**: el recomendador manda a la API de Anthropic títulos, topics y
> fragmentos de tus highlights (mismo destino que la clasificación, mayor volumen
> por llamada). Está documentado en el setting. Decisión consciente tuya.

---

## Parte 4 — Lo que NO pude hacer yo (necesita tu mano)

### 4.1 Biblioteca Kindle *completa* (los libros que TENÉS, con o sin highlights)

El notebook de Kindle solo lista libros **con** anotaciones. Para la biblioteca
completa hay que descubrir los endpoints JSON internos del **Cloud Reader**
(`read.amazon.com`) — y eso requiere abrir DevTools **con tu sesión logueada** y
capturar las respuestas. **No lo puedo hacer yo** (no tengo tu sesión de Amazon).

Todo lo *downstream* ya está listo y testeado: el modelo de fichas, el reconcile
(`reconcileLibrary`: wishlist→owned al comprar, no borra históricos), y el comando
**"Reconciliar biblioteca Kindle"** que lee un manifiesto `Books/.kindle-library.json`.
Cuando quieras encarar esto, es una sesión de *spike*: te guío para capturar el
endpoint (DevTools → Network → filtrar por `read.amazon.com`, abrir "Your Library",
copiar la respuesta JSON anonimizada como fixture), y con eso escribo el parser +
el sync de biblioteca en la extensión. Está en el backlog como **B-324**.

### 4.2 Validación de uso real (F5.0)

El criterio de salida de F5.0 no es técnico sino de **uso**: una semana usando
"Repasar highlights de hoy". Eso valida F5.4 (repaso espaciado) antes de construirla.

---

## Checklist rápido

- [ ] `Inbox/Kindle/` existe en la vault
- [ ] `npm run build:extension` + Load unpacked en Chrome
- [ ] Carpeta de la vault elegida + "Allow on every visit"
- [ ] Logueado en `read.amazon.com/notebook`
- [ ] "Sincronizar ahora" → highlights en la vault → 2do sync sin duplicados
- [ ] URL de wishlist pegada en Settings → "Sincronizar wishlist de Amazon"
- [ ] API key cargada → "¿Qué leo ahora?"
- [ ] (Cuando quieras) sesión de spike para la biblioteca completa
