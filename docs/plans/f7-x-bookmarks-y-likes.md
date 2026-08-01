# F7 — X/Twitter: bookmarks y likes → cola de lectura + base de conocimiento

> **Discovery** (2026-07-28). Todavía no es un ADR: hay 2 decisiones abiertas que dependen de Fede (§8).
> Contexto: cerrar la última fuente de input. Web (F1/F2) ✅, Kindle (F3/F4) ✅, libros (F5) ✅, KB (F6) en curso. Falta X.

---

## 1. Hallazgos duros (esto define todo lo demás)

Cuatro cosas que verifiqué antes de diseñar, porque cada una descarta un camino:

| # | Hallazgo | Consecuencia |
|---|---|---|
| **H1** | **El archive oficial de X (Settings → Download an archive) NO incluye bookmarks.** Incluye posts, DMs, media, listas, followers y **likes**, pero no bookmarks. | El camino gratis-y-limpio para el histórico de bookmarks **no existe**. Hay que ir por API paga o por sesión del browser. Los **likes** sí salen gratis del archive. |
| **H2** | **La X API no devuelve `bookmarked_at`.** El endpoint `GET /2/users/:id/bookmarks` devuelve `created_at` (fecha del *tweet*), nunca la fecha en que lo guardaste. | **No es un problema: usamos `created_at`** (§3.1). Para una cola de lectura la frescura del contenido es mejor señal que la fecha de guardado. Filtro client-side trivial, porque birdclaw ya tiene todo en local. |
| **H3** | **La X API pasó a pay-per-use (feb 2026).** Los "owned reads" — tus propios bookmarks, likes, posts — cuestan **$0.001 por recurso** ($1 cada 1.000). No hay free tier real de lectura; se compran créditos por adelantado, sin cargo mensual base. | El backfill completo cuesta **dólares, no cientos**. Deja de ser un blocker económico. |
| **H4** | **`birdclaw` (steipete, MIT) ya resuelve la ingesta completa.** SQLite local + web UI + CLI. Sincroniza bookmarks, likes, tweets, menciones y DMs; tres transportes (API oficial vía `xurl`, sesión del browser vía `bird`, o archive ZIP); sync incremental con `--early-stop`; export JSON/JSONL; y un `launchd` que corre cada 3 horas. | **No construimos ingesta.** birdclaw es la capa 1. readqueue no habla con X nunca. |

**Implicación de H1+H4**: los likes históricos entran gratis por el ZIP del archive; los bookmarks históricos necesitan API o cookies. Son dos flujos distintos con distinto costo.

---

## 2. Arquitectura: tres capas, cada una con un dueño

El error a evitar es meter el cliente de X adentro del plugin. Ya nos pasó con Kindle y la solución fue una extensión aparte (MX9/MX22) — el mismo patrón aplica acá, y esta vez ni siquiera hay que escribirla.

```
┌─ Capa 1: INGESTA ─────────────── birdclaw (externo, MIT, no lo mantenemos) ─┐
│  X/Twitter ──[xurl | bird | archive.zip]──▶ ~/.birdclaw/*.sqlite            │
│  launchd cada 3h · --early-stop · audit log en ~/.birdclaw/audit/           │
└────────────────────────────────────────────────────────────────────────────┘
                                   │  export JSONL (o lectura directa read-only)
                                   ▼
┌─ Capa 2: TRIAGE ──────────────── src/x-sync.ts (NUEVO, en el plugin) ──────┐
│  1. dedupe contra la vault (url-canon.ts ya canoniza `tweet:<id>`)         │
│  2. filtro determinista de basura (sin LLM, gratis)                        │
│  3. routing: ¿cola de lectura o base de conocimiento?                      │
│  4. clasificación temática (topics.ts, ya existe, Haiku 4.5)               │
└────────────────────────────────────────────────────────────────────────────┘
                     │                              │
                     ▼                              ▼
        Inbox/Pending/ (URL cruda)          Inbox/Legacy/
        → el intake job existente           → material de referencia
          la parsea con defuddle              `source: x-bookmark` / `x-like`
          y la manda a Inbox/Web/             (no entra a la cola) — ADR-004
```

**Lo que ya tenés y se reusa tal cual — esto es el 70% del trabajo, ya hecho:**

- `src/url-canon.ts` — `extractTweetIdentifiers()` y la clave canónica `tweet:<id>`. El dedupe contra lo que ya está en la vault sale gratis.
- `src/intake.ts` — el path FxTwitter (MX1) ya convierte una URL de tweet en nota con autor, fecha y media. Un bookmark que apunta a un artículo entra por el mismo pipeline `defuddle` que cualquier otra URL.
- `src/topics.ts` — clasificación con Claude, 7 temas (`tech`, `producto`, `macro`, `ciencia`, `personal`, `cultura`, `otros`) + mapa por publisher. Default ya es `claude-haiku-4-5`.
- `src/anthropic.ts` — helper con retry.
- El orphan-mover y el dedupe de Web Clipper (MX26).

**Código realmente nuevo**: un módulo `x-sync.ts` (lector + triage + escritor) y un comando. Estimo ~400-600 líneas con tests, no un subsistema.

---

## 3. El problema del triage (la parte que te preocupa: "puede haber mucha basura")

Tenías razón en que es el punto flojo. Lo desarmo en tres decisiones separadas, porque mezclarlas es lo que hace que se sienta imposible.

### 3.1 Decisión A — Ventana temporal: `created_at` y listo

**Resuelto (Fede, 2026-07-28): usamos `created_at` del tweet.** La regla es una línea:

```
created_at < 90 días  →  candidato a cola de lectura
created_at ≥ 90 días  →  KB directo, nunca pasa por la cola
```

Por qué alcanza, y por qué es incluso *mejor* que la fecha de guardado:

- **Para una cola de lectura, lo que importa es la frescura del contenido, no cuándo apretaste el botón.** Un ensayo de 2022 que guardaste ayer no es urgente; un análisis de esta semana sí.
- **En la práctica las dos fechas casi coinciden.** Bookmarkeás lo que ves en el timeline, que es reciente por definición. El caso "tweet viejo guardado hoy" existe pero es minoría, y cuando pasa, mandarlo a la KB en vez de a la cola es el comportamiento correcto de todos modos.
- **Es trivialmente filtrable.** birdclaw baja todo a SQLite local, así que el filtro es un `WHERE` sobre datos locales — no hay paginación que negociar ni estado que reconstruir.

Igual estampamos un `savedAt` propio (la fecha en que la nota entró a la vault) porque es gratis y sirve para auditar el sync. Pero **no hay lógica colgada de ese campo** — el routing se decide solo con `created_at`.

### 3.2 Decisión B — ¿Qué es "leíble"? (esto es más importante que la fecha)

Acá está el insight que te falta y que hace que todo lo demás se ordene: **un bookmark no es una unidad de lectura**. Hay tres especies distintas conviviendo en la misma pila:

| Especie | Ejemplo | Destino |
|---|---|---|
| **Puntero** — tweet cuyo valor es el link que contiene | "must-read: [link a un ensayo]" | **Cola de lectura.** El artículo linkeado es lo que se lee, no el tweet. Va a `Inbox/Pending/` y el intake existente lo parsea con defuddle. El tweet queda como `via:` en el frontmatter. |
| **Contenido** — hilo o insight que se sostiene solo | Un hilo de 15 tweets explicando algo | **Cola de lectura**, pero renderizado como nota vía FxTwitter (ya funciona, MX1). |
| **Referencia** — dato suelto, herramienta, screenshot, chiste, "esto después lo miro" | Un tweet con un nombre de librería | **Solo KB.** Nunca a la cola. Es material de consulta, no de lectura. |

Esa clasificación se hace **casi toda sin LLM**: ¿tiene link externo? ¿es hilo (`conversation_id` con >1 tweet propio)? ¿cuántos caracteres? ¿el link es a un dominio de artículos o a un repo/tienda/imagen? Reglas deterministas resuelven el ~80%. El LLM entra solo en el borde.

### 3.3 Decisión C — Anti-basura (barato primero, LLM después)

Orden de filtros, del más barato al más caro. Todo lo que muere en el paso 1 no cuesta ni un token:

1. **Determinista (gratis)**: descartar de la cola — sin link externo Y <200 caracteres Y no es hilo; links a `t.co` rotos / cuentas suspendidas / tweets borrados; dominios de no-lectura (github.com/*, tiendas, YouTube, imágenes sueltas → van a KB con su propio tag, no a la cola).
2. **Dedupe (gratis)**: `tweet:<id>` y URL canónica contra la vault. Si ese artículo ya lo leíste vía Web Clipper, el bookmark no genera nada nuevo — solo agrega el tweet como fuente.
3. **Clasificación temática (Claude Haiku 4.5, ~$0.0003 por item)**: los que sobreviven se clasifican en tus 7 temas con `topics.ts`. Sin código nuevo.
4. **Score de relevancia (opcional, mismo call)**: pedirle a Haiku, junto con el tema, un `signal: high|medium|low`. Los `low` van a KB, no a la cola. Esto es lo que evita que 3 años de bookmarks te inunden la cola.

**El principio**: nada del histórico entra a la cola de lectura. El histórico entra a la KB, indexado y clasificado, y desde ahí F6/vault-gardener lo conecta. La cola solo recibe lo reciente. Es exactamente lo que pediste, con el matiz de que "reciente" se mide por posición la primera vez y por fecha real de ahí en más.

### 3.4 Likes: regla distinta y más simple

**Confirmado por Fede: todos los likes van a un solo lugar — `Inbox/Legacy/`, con `source: x-like`.** Sin ramificaciones, sin criterio por like.

Los likes **nunca entran a la cola**. Volumen alto, señal baja, y no expresan intención de leer — expresan "me gustó". Y como el archive oficial los incluye (H1), el histórico es gratis.

Además, propongo que los likes **no generen una nota por like**. Miles de notas de una línea contaminan la vault y arruinan el graph de F6. En cambio: **notas agregadas** — una nota por autor-que-likeás-mucho, una nota por tema con los likes destacados del mes. Eso sí sirve para conectar puntos; 4.000 archivos sueltos no.

### 3.5 Frontmatter propuesto

Compatible con `queue-data.ts` y con los filtros existentes:

```yaml
---
source: x-bookmark          # o x-like
url: https://x.com/user/status/123      # el tweet
targetUrl: https://ensayo.com/...       # el link, si es un puntero
author: "@handle"
published: 2026-05-20        # created_at del tweet — ESTE decide cola vs KB (§3.1)
savedAt: 2026-07-28          # cuándo entró a la vault; solo auditoría, sin lógica encima
status: unread               # solo si va a la cola; los de KB no llevan status
kind: pointer | content | reference
signal: high | medium | low
topic: tech
tags: [reader, x]
---
```

---

## 4. Costos (números reales, no rangos vagos)

### 4.1 X API — one-time + recurrente

Owned reads a **$0.001 por recurso**. El backfill es un pago único:

| Tu volumen de bookmarks | Costo del backfill | Recurrente/mes (~50 nuevos) |
|---|---|---|
| 1.000 | **$1** | ~$0.05 |
| 3.000 | **$3** | ~$0.05 |
| 5.000 | **$5** | ~$0.05 |
| 10.000 | **$10** | ~$0.05 |

Los likes históricos: **$0** si salen del archive ZIP; mismo precio por recurso si preferís la API.

**Alternativa a $0**: modo `bird` de birdclaw — usa las cookies de tu sesión del browser contra los endpoints internos de X. Gratis, sin cuenta de developer. Contra: más frágil (X cambia sus endpoints internos sin avisar) y está en zona gris de los ToS de X. Es tu cuenta y tus datos, pero no es la vía oficial.

### 4.2 Claude — clasificación

Con `claude-haiku-4-5` ($1/MTok input, $5/MTok output) y la **Batch API (−50%)**. Un bookmark son ~350 tokens de input (con el prompt cacheado) y ~30 de output:

| Items a clasificar | Haiku 4.5 + Batch | Sonnet 5 + Batch |
|---|---|---|
| 1.000 | **~$0.30** | ~$0.80 |
| 5.000 | **~$1.40** | ~$4.00 |
| 10.000 | **~$2.80** | ~$8.00 |

Haiku 4.5 alcanza y sobra para clasificar en 7 temas. Es el default que ya tenés en `settings.ts` (`classifyModel: "claude-haiku-4-5"`).

### 4.3 Total realista

**Menos de $15 el primer mes** (backfill de API + clasificación de todo el histórico), y **centavos por mes** después. Si vas por cookies, es **~$3 total** (solo Claude). El costo no es el factor de decisión acá.

---

## 5. Automatización y performance en tu Mac

Tu preocupación de "no matar la performance" es razonable pero el perfil real es benigno:

| Componente | Qué corre | Impacto |
|---|---|---|
| birdclaw sync | `launchd` cada 3h, ~5 páginas. Un proceso Node de segundos que escribe SQLite. | **Despreciable.** Es una request HTTP y un INSERT. |
| readqueue triage | Dentro del plugin, mismo patrón que el intake job (`intakeIntervalMin: 5`). Lee el export de birdclaw, no la API. | **Despreciable.** Lectura de archivo local. |
| **Fetch de artículos linkeados** | ← **acá está el único costo real.** Cada puntero dispara un `requestUrl()` + `defuddle`. | **Requiere pacing.** 300 artículos de golpe congelan Obsidian. |
| Clasificación Claude | Batch API asíncrona. | Cero impacto local (corre en el server de Anthropic). |

**Mitigación del punto caliente**: el backfill **no** se hace desde el plugin. Se hace con un script CLI paceado, igual que ya hiciste con `score-wishlist` (batch scoring paceado contra la vault). Corre una vez, de noche, a N artículos por minuto. El plugin en runtime solo procesa el delta (~50 items nuevos por mes = 2 por día), que es exactamente la carga que el intake job ya maneja hoy sin despeinarse.

**Cadencia propuesta**: birdclaw cada 3h (su default) → triage del plugin cada 30 min → clasificación en batch nocturna. Nada corre en el hot path de tu lectura.

---

## 6. Alternativas evaluadas y por qué no

| Alternativa | Veredicto |
|---|---|
| **Extensión Chrome propia** (patrón Kindle MX9/MX22) | Descartada. Funcionaría — es exactamente lo que hicimos con Kindle — pero birdclaw ya lo hace, es MIT, y con `xurl` usa la API oficial en vez de scrapear. Escribir la nuestra sería duplicar trabajo que ya está mantenido. |
| **`sytelus/xarchive`, `prinsss/twitter-web-exporter`, `nornagon/twitter-bookmark-archiver`** (extensiones/userscripts de export) | Descartadas como base. Hacen export one-shot a JSON/CSV, sin sync incremental, sin base local, sin scheduling. Útiles como **plan B** si birdclaw se rompe: exportás a mano y el triage del plugin come el JSON igual. |
| **X API directo desde el plugin** | Descartada. OAuth2 PKCE dentro de Obsidian, manejo de refresh tokens, rate limits y paginación en el plugin. Todo eso ya está resuelto en birdclaw. |
| **Solo el archive ZIP** | Insuficiente para bookmarks (H1). Se usa **igual** para los likes históricos, porque ahí sí funciona y es gratis. |
| **Nota por cada like** | Descartada (§3.4). Rompe el graph de F6 con miles de notas de una línea. |

---

## 7. Plan por fases

Cada fase entrega algo usable sola. Podés parar después de cualquiera.

| Fase | Qué | Quién | Salida |
|---|---|---|---|
| **F7.0** | Instalar birdclaw, elegir transporte (§8), correr **un** sync de bookmarks con `--max-pages 2` y mirar el JSON. Medir volumen real. | Fede (manual) | Sabemos cuántos bookmarks hay y qué campos vienen. Todo lo demás se calibra con eso. |
| **F7.1** | `src/x-sync.ts`: lector del export de birdclaw + dedupe (`url-canon`) + filtros deterministas + router `pointer/content/reference`. Sin LLM todavía. Tests con fixtures reales del F7.0. | builder | Comando "Sincronizar bookmarks de X". Los punteros caen en `Inbox/Pending/` y el intake existente hace el resto. |
| **F7.2** | Backfill del histórico: script CLI paceado (patrón `score-wishlist`) + clasificación en Batch API + escritura a `Knowledge/X/<topic>/`. Nada de esto toca la cola. | builder + Fede | El histórico entero indexado y clasificado en la KB. |
| **F7.3** | Likes: import del archive ZIP + notas **agregadas** por autor/tema (no una por like). | builder | Los likes como material de consulta, sin ensuciar la vault. |
| **F7.4** | Enganche con F6: el vault-gardener empieza a citar y conectar el material de X en `/vault-ask` y `/vault-link`. | system-architect | "Conectar los puntos" — que es lo que realmente querés. |

**F7.1 es el corte mínimo con valor**: a partir de ahí, cada bookmark nuevo que guardes desde el teléfono aparece en tu cola de lectura sin que hagas nada.

---

## 8. Decisiones que necesito de vos

**D1 — Transporte: API oficial de pago vs. cookies del browser.**
- *API oficial (`xurl`)*: ~$3-10 one-time + centavos/mes. Estable, soportada, dentro de los ToS. Requiere crear una app en el developer portal de X y cargar créditos.
- *Cookies (`bird`)*: $0. Más frágil, zona gris de ToS.
- **Mi recomendación: API oficial.** A este precio, la fragilidad no vale el ahorro — y ya pagás Obsidian y Claude, esto es ruido en el presupuesto.

**D2 — Dónde vive la KB de X en la vault. → RESUELTA (Fede, 2026-07-28): `Inbox/Legacy/`, sin carpetas nuevas.**
Mismo patrón que Matter. Los bookmarks viejos y los likes agregados conviven con el histórico existente, distinguidos por `source: x-bookmark` / `source: x-like` — no por carpeta. Formalizado en [ADR-004](../architecture/ADR-004-estructura-y-taxonomia-vault.md), cuya regla de oro es: *no crear una carpeta para algo que el frontmatter ya distingue*.

---

## 9. Prueba real de birdclaw (2026-07-28) — F7.0 parcial

Instalado y verificado en la Mac de Fede. **Funciona.** Lo que se aprendió:

### 9.1 Instalación: la vía `brew` está rota, npm funciona

```bash
brew install steipete/tap/birdclaw
# ✗ Error: Your Command Line Tools are too outdated. (pide las de Xcode 26.3)
```

⚠️ **Hallazgo colateral para Fede**: tus **Command Line Tools están desactualizadas** y eso rompe cualquier fórmula de brew que compile desde fuente. Además dejó el `node` de Homebrew en estado inconsistente (`Cellar/node/22.0.0` con `libicui18n.74.dylib` faltante). Conviene arreglarlo aparte de F7:
> Software Update en System Settings, o `sudo rm -rf /Library/Developer/CommandLineTools && sudo xcode-select --install`

**Vía que sí funcionó** (no compila nada, y no toca tu Node por defecto):

```bash
nvm install 26          # birdclaw exige node >=26.5.0 <27
nvm use 26
npm install -g birdclaw # → birdclaw 0.11.1 ✅
```

Tu `node` default sigue siendo v18.20.8; birdclaw vive aislado en la v26.5.0 de nvm.

### 9.2 Estado del workspace

```
birdclaw init      → ~/.birdclaw/ (config.json + birdclaw.sqlite) ✅
birdclaw archive find → []   (no hay archive de X descargado en disco)
birdclaw auth status  → "xurl not installed. local/archive mode active."
```

**Bloqueo actual**: sin `xurl` (API oficial) o `bird` (cookies) no hay sync live. Ese paso requiere autenticación de Fede — no lo puede hacer un agente (§10).

### 9.3 El esquema SQLite — esto valida el diseño

Inspeccionado directamente. Los campos que importan para el triage:

```sql
tweet_collections(account_id, tweet_id, kind, collected_at, source, raw_json, updated_at)
tweet_account_edges(account_id, tweet_id, kind, first_seen_at, last_seen_at, seen_count, ...)

tweets(id, author_profile_id, text, created_at, reply_to_id, quoted_tweet_id,
       like_count, media_count, entities_json, media_json, deleted_at, ...)

link_occurrences(source_kind, source_id, source_position, short_url, created_at, ...)
url_expansions(short_url, expanded_url, final_url, status,
               title, description, image_url, site_name, error, ...)
```

Cuatro cosas que esto confirma o mejora respecto de lo diseñado en §1-§3:

1. **`collected_at` y `first_seen_at` existen.** La API no da `bookmarked_at` (H2), pero **birdclaw lo estampa localmente**. Ojo con el matiz: en el primer sync todos los bookmarks históricos reciben la fecha *de ese sync*, no la real — no reconstruye el pasado. Osea: **`created_at` sigue siendo la señal correcta para el histórico** (decisión de Fede, §3.1) y `first_seen_at` es exacto de ahí en adelante. La decisión se sostiene, y ahora sabemos en qué columna vive cada cosa.
2. **`url_expansions` ya resuelve los links.** Trae `final_url` (siguiendo redirects, no el `t.co`) **más `title`, `description`, `site_name`**. El router `pointer`/`content`/`reference` (§3.2) puede decidir **sin fetchear nada**: el metadata de OpenGraph ya está en la base. Esto abarata el triage muchísimo.
3. **`reply_to_id` + `quoted_tweet_id` permiten detectar hilos** sin llamadas extra → la especie `content` es detectable de forma determinista.
4. **`deleted_at` existe** → los bookmarks a tweets borrados se filtran gratis, sin generar notas rotas.

### 9.4 La query de triage, ya escribible

Con el esquema real, el corazón de `x-sync.ts` es una query, no un algoritmo:

```sql
SELECT t.id, t.text, t.created_at, t.reply_to_id, t.quoted_tweet_id,
       c.collected_at, x.final_url, x.title, x.site_name
FROM tweet_collections c
JOIN tweets t ON t.id = c.tweet_id
LEFT JOIN link_occurrences lo ON lo.source_id = t.id AND lo.source_kind = 'tweet'
LEFT JOIN url_expansions  x  ON x.short_url = lo.short_url
WHERE c.kind = 'bookmark'
  AND t.deleted_at IS NULL
ORDER BY t.created_at DESC;
```

`final_url IS NOT NULL` → **pointer** · hilo (`reply_to_id` propio) → **content** · resto → **reference**.

### 9.5 Bonus no previsto: birdclaw trae MCP server

`birdclaw serve` levanta la web app local **y un MCP server read-only**. Eso abre una opción que no estaba en el ADR-001: Claude podría consultar el corpus de X vía MCP sin que readqueue duplique nada. **No cambia F7** (el plugin igual necesita materializar notas en la vault), pero es una carta para F6 — vale evaluarlo cuando haya datos reales.

---

## 10. Lo que falta para cerrar F7.0 — solo lo puede hacer Fede

Elegí **una** de estas dos y decime cuál (es la decisión D1 de §8):

**Opción A — API oficial (recomendada, ELEGIDA por Fede 2026-07-29). ~$3-10 one-time.**

Ya instalado y verificado (`xurl` 1.3.1 vía `brew install --cask xdevplatform/tap/xurl` — el cask es binario precompilado, no lo afectan las CLT rotas). `birdclaw auth status` ya reporta `installed: true`. Falta solo la autorización, que es de Fede. Pasos exactos en §10.1.

**Opción B — cookies del browser. $0.**
```bash
# instalar `bird` y tomar la sesión del navegador
birdclaw sync bookmarks --mode bird --limit 20 --max-pages 1
```

**En cualquiera de las dos, la prueba chica es la misma**: `--limit 20 --max-pages 1` trae ~20 bookmarks. Con eso corro el triage contra datos reales, mido cuántos son puntero/contenido/referencia, y recién ahí decidimos si vale el backfill completo. Es exactamente el "probemos con algo chico antes de ir por todo".

**Gratis y en paralelo**: pedí ya el archive de X (Settings → Your account → Download an archive). Tarda ~24h en generarse y trae **todos los likes** sin costo. Cuando llegue: `birdclaw import archive <path>`.

### 10.1 Setup de xurl — pasos exactos

**Las credenciales NO van en birdclaw.** Van en `xurl`, que las guarda en `~/.xurl/auth.yml`; birdclaw lo invoca como transporte. Un solo login habilita bookmarks **y** likes: xurl pide todos los scopes de lectura de una vez (verificado en `auth/auth.go`): `tweet.read`, `users.read`, `bookmark.read`, `like.read`, `follows.read`, `list.read`, `block.read`, `mute.read`, `dm.read`, `broadcast.read`, `users.email` + `offline.access` (refresh token).

**Paso 1 — Developer portal de X** (app → *User authentication settings*):

| Campo | Valor |
|---|---|
| OAuth 2.0 | **activado** |
| App permissions | **Read** (alcanza) |
| Type of App | **Web App / Automated App or Bot** (confidential client → emite Client Secret) |
| Callback URI | `http://localhost:8080/callback` — **exacto**, es el default de xurl |
| Website URL | cualquiera válida |

⚠️ **La trampa más común**: hace falta **Client ID + Client Secret de OAuth 2.0**. Ni el *Bearer Token* (app-only: no tiene contexto de usuario, no puede leer *tus* bookmarks) ni las *API Key/Secret* (OAuth 1.0a) sirven para este endpoint.

**Paso 2 — Registrar la app** (en tu terminal; no pegues el secret en el chat):

```bash
xurl auth apps add readqueue \
  --client-id TU_CLIENT_ID \
  --client-secret TU_CLIENT_SECRET \
  --redirect-uri http://localhost:8080/callback
```

**Paso 3 — Autorizar** (abre el browser):

```bash
xurl auth oauth2
```

**Paso 4 — Verificar**:

```bash
xurl auth status
birdclaw auth status   # debe dejar de decir "local/archive mode active"
```

**Paso 5 — La prueba chica** (~$0.04 en total):

```bash
birdclaw sync bookmarks --limit 20 --max-pages 1
birdclaw sync likes     --limit 20 --max-pages 1
```

**Créditos**: la API es pay-per-use. Si no hay créditos cargados en la consola, el sync devuelve error de cuota. A $0.001/recurso, esta prueba son ~$0.04.

### 10.2 Nota de entorno: wrapper de birdclaw

`birdclaw` se instaló bajo el Node 26 de nvm, pero su shebang es `#!/usr/bin/env node` y el primer `node` del PATH de Fede es el de Homebrew, que está **roto** (`libicui18n.74.dylib` faltante — problema preexistente, ver B-607). Se creó `/opt/homebrew/bin/birdclaw` como wrapper que antepone el Node 26 de nvm. Efecto: `birdclaw` funciona desde cualquier terminal sin activar nvm a mano. Si algún día se actualiza Node, hay que actualizar la ruta en el wrapper.

---

## 11. F7.0 COMPLETADO — la prueba chica con datos reales (2026-07-31)

Auth OK (`oauth2: federicodeleonm`, app `readqueue`), `birdclaw sync bookmarks --mode xurl --limit 20 --max-pages 1` → **`ok: true, count: 20`**. Costo total de la prueba: centavos.

### 11.1 Qué son realmente los bookmarks de Fede

Sobre los **20 más recientes** (rango `2026-05-21` → `2026-07-28`, o sea ~2 meses):

| Medición | Resultado |
|---|---|
| Dentro de la ventana de 90 días | **20 de 20** — la intuición de "últimos 2-3 meses" estaba bien calibrada |
| **Punteros** (≥1 link externo) | **13 de 20 (65%)** |
| Sin link externo | 7 de 20 |
| Son reply (parte de un hilo) | 14 de 20 |
| Texto corto (<200 chars) | 14 de 20 |
| **Concentración por autor** | **@MatiasScalbi = 14 de 20 (70%)**; el resto: 6 autores con 1 c/u |

### 11.2 El hallazgo que cambia el diseño

**Los 13 punteros no apuntan a artículos web — apuntan a PDFs académicos**: `ssrn.com` ×9, `arxiv.org`, `aqr.com`, `efmaefm.org`. Papers de finanzas cuantitativas.

Y el tweet bookmarkeado **no contiene el valor**. Su texto completo es literalmente `Link al paper: https://t.co/…`. Es el *reply final* de un hilo donde @MatiasScalbi resume el paper. El valor está repartido entre el hilo padre (el resumen) y el PDF (la fuente).

**Consecuencia: el pipeline `requestUrl()` + defuddle NO sirve para este material.** Defuddle parsea HTML; estos son PDFs. Si hubiéramos implementado F7.1 según el diseño original, el 65% de los bookmarks habría fallado o generado notas vacías. **Esto justifica solo la prueba chica.**

### 11.3 La solución: `birdclaw research` (ya existe, no hay que construirla)

`birdclaw research <query> --limit N` toma el bookmark, sube al `conversation_id`, trae el hilo (local o con *live ancestor lookup*) y emite markdown. Salida real de la prueba:

```markdown
- Seed text: Link al paper: https://ssrn.com/abstract=1686004
### Thread
- @MatiasScalbi [live] 🔥 "The Flash Crash: The Impact of High Frequency Trading
  on an Electronic Market" Tremendo paper. El E-mini cayó 5.1% en 13 minutos y
  recuperó 6.4% en los 23 siguientes. Los HFT no iniciaron el crash, pero
  aceleraron la caída cuando la liquidez desapareció...
### Links
- https://ssrn.com/abstract=1686004
```

Eso es una **nota de lectura completa sin parsear el PDF**: título del paper, resumen en español, link a la fuente. `x-sync.ts` debe consumir la salida de `research`, no fetchear los links.

**Diseño corregido para la especie `pointer`:**

| Antes (§3.2) | Ahora |
|---|---|
| bookmark → `Inbox/Pending/` → intake + defuddle → nota | bookmark → `birdclaw research` (expande hilo) → nota con resumen + link al PDF |

El path defuddle sigue siendo válido para punteros a artículos HTML de verdad — pero en la muestra de Fede es la minoría.

### 11.4 Correcciones técnicas al diseño (solo visibles con datos reales)

| # | Lo que asumí | La realidad |
|---|---|---|
| 1 | `kind = 'bookmark'` | **`kind = 'bookmarks'`** (plural). La query de §9.4 estaba mal. |
| 2 | `expanded_url` (snake_case, como la API) | **`expandedUrl`** (camelCase). birdclaw normaliza los nombres. |
| 3 | `collected_at` se llena en el sync | **Viene NULL.** Refuerza la decisión de §3.1: `created_at` es la señal. |
| 4 | `link_occurrences` / `url_expansions` se llenan solas | **Quedan en 0.** Los links hay que sacarlos de `tweets.entities_json`, o correr `birdclaw links` aparte. |
| 5 | `--mode auto` usaría xurl si está autenticado | **Elige `bird`** (cookies) y falla con `exec: bird: not found`. **Hay que pasar `--mode xurl` siempre.** |
| 6 | birdclaw registra la cuenta al autenticar | **No existe alta de cuenta para sync live.** Solo se crean cuentas vía `import archive`, `--demo` o restore de backup. Hubo que insertar la fila en `accounts` a mano (id real de la API: `1969417699`). ⚠️ Reportable upstream. |
| 7 | `birdclaw init --demo` era inocuo para explorar | **Contaminó el workspace**: dejó `@steipete` como cuenta default y el sync intentó pedir *sus* bookmarks. Workspace recreado limpio (demo movido a `~/.birdclaw.demo-bak`). |

### 11.5 Sesgo de la muestra — leer con cuidado

20 bookmarks es chico y está **sesgado a lo más reciente**. El 70% de @MatiasScalbi probablemente refleja una racha de papers de estos dos meses, no el histórico de años. **No extrapolar el mix 65/35 al backfill completo.** Antes de F7.2 conviene un sync más grande (`--all --max-pages 10`, ~200 bookmarks, ~$0.20) para medir el mix real.

### 11.6 Likes vs bookmarks — la comparación valida tratarlos distinto

`birdclaw sync likes --mode xurl --limit 20 --max-pages 1` → `ok: true, count: 20`.

| Medición | **Bookmarks** | **Likes** |
|---|---|---|
| Con link externo | **13/20 (65%)** | **7/20 (35%)** |
| Rango que cubren los 20 | 2026-05-21 → 07-28 (**~2 meses**) | 2026-07-17 → 07-29 (**~12 días**) |
| Concentración por autor | @MatiasScalbi **14/20 (70%)** | disperso: 4, 3, 1, 1, 1, 1… |
| **Solapamiento entre ambos** | **0 tweets en común** | |

Tres conclusiones, todas a favor del diseño de §3.4:

1. **Los likes son ~5× más frecuentes.** 20 likes cubren 12 días; 20 bookmarks cubren 2 meses. El volumen histórico de likes va a ser un orden de magnitud mayor — razón de más para las notas agregadas y no una nota por like.
2. **Los likes tienen la mitad de links externos** (35% vs 65%): menos material de lectura, más reacción social. Confirma que **no entran a la cola**.
3. **Solapamiento cero.** Fede no likea lo que bookmarkea ni al revés. Son dos gestos con intenciones distintas — *"quiero volver a esto"* vs *"me gustó"* — y el dato lo confirma empíricamente. Justifica dos flujos separados, no uno con un flag.

### 11.7 Costo real de toda la prueba

~50 recursos consumidos (20 bookmarks + 20 likes + `/2/users/me` + 3 *live ancestor lookups* de `research`) ≈ **$0.05**. Confirma el modelo de costos de §4: el backfill completo son dólares, no cientos.

### 11.8 Estado

✅ birdclaw + xurl instalados y autenticados · ✅ sync real funcionando · ✅ mix medido · ✅ diseño corregido
⏭️ Siguiente: sync de ~200 para medir el mix histórico, y recién ahí F7.1 (`x-sync.ts`).

---

## 12. Taxonomía v2 — clasificar por modalidad de consumo (2026-07-31)

Reemplaza el router `pointer`/`content`/`reference` de §3.2. Origen: Fede pide separar *"lo que es contenido para visualizar después"* (artículos, hilos, **videos** con categoría propia) de los *"link + cinco palabras"* que deberían ir a un cajón "otros".

### 12.1 La trampa medida

La regla intuitiva —*"si es solo un link y pocas palabras, es basura"*— **falla contra los datos de Fede**:

| Texto propio del tweet (sin el link) | Bookmarks |
|---|---:|
| **A. <30 chars — "solo un link"** | **13** |
| B. 30-120 — link + poco | 1 |
| C. 120-280 — algo de texto | 1 |
| D. 280+ — contenido real | 5 |

Los 13 del bucket A **son los papers de finanzas** — el material de más valor de la muestra, el que Fede quiere juntar semanalmente. Aplicar la regla literal mandaría sus papers a "otros".

> **Principio corregido: el largo del texto no mide señal, mide *dónde vive el contenido*.** Un tweet de 15 caracteres puede ser el mejor paper del mes. Lo que decide es **el destino del link**, no el tweet.

### 12.2 Los dos ejes

**Eje 1 — ¿Dónde vive el contenido?** (determinista, gratis)

| Ubicación | Señal técnica |
|---|---|
| En el tweet | texto ≥280 sin link, o hilo del mismo autor |
| En un link externo | `entities_json.urls[].expandedUrl` fuera de x.com |
| En media adjunta | `media_json[].type = video` / `image` |
| En ningún lado | link a perfil/tienda/repo + texto trivial |

**Eje 2 — ¿Cómo se consume?** ← esto es lo que Fede pide, y lo que define el destino

| `kind` | Qué cae acá | Cómo se decide (por **dominio**, no por largo) |
|---|---|---|
| **`read`** | papers, artículos, hilos largos | `ssrn.com`, `arxiv.org`, `*.pdf`, `aqr.com`, sustack/medium/blogs, o hilo ≥3 tweets |
| **`watch`** | videos | `media_json.type=video`, `youtube.com`, `youtu.be`, `x.com/*/video/*` |
| **`reference`** | herramientas, repos, datos sueltos | `github.com`, tiendas, perfiles, o **texto trivial sin link resoluble** |

**Medido en la muestra**: bookmarks → 5 imágenes y **3 videos**; likes → 6 imágenes y 1 video. Los videos existen y merecen su tratamiento, como intuía Fede.

### 12.3 Dónde vive cada uno (respetando ADR-004)

Fede pidió *"una categoría de video"*. **No una carpeta** — eso violaría la regla de oro del ADR-004 (*no crear carpeta para lo que el frontmatter distingue*) y arrancaría el popurrí que queremos evitar.

| `kind` | Carpeta | Frontmatter |
|---|---|---|
| `read` | `Inbox/Web/` (la cola de siempre) | `kind: read`, `status: unread` |
| `watch` | `Inbox/Web/` (misma cola) | `kind: watch`, `status: unread`, `durationMin` si se puede |
| `reference` | `Inbox/Legacy/` | `kind: reference`, sin `status` |

**El "categoría de video" se resuelve en la vista, no en el disco**: la Reading Queue gana un filtro por `kind`. Eso habilita algo mejor que una carpeta — filtrar por **tiempo disponible**: *"tengo 20 minutos → mostrame videos"*, *"tengo una hora → mostrame papers"*. Una carpeta no puede hacer eso; el frontmatter sí.

### 12.4 El caso "papers semanales"

Fede: *"la idea era tener los papers para poder pincharlos"* semana a semana. Con `kind: read` + `topic: macro` + `source: x-bookmark` eso ya es una query. Encaja con el digest que ya existe (`create-daily-digest`): un **digest semanal de papers** es la misma plomería con otro filtro. No hay que construir nada nuevo, solo el filtro.

### 12.5 Lo que se descarta de verdad

Sigue habiendo basura real, pero se detecta por otras señales — no por el largo:

- tweets con `deleted_at` (gratis, ya está en el esquema)
- links que no resuelven (`url_expansions.status` = error)
- links a perfiles de X sin tweet (`x.com/handle` a secas)
- **duplicados**: mismo `final_url` ya presente en la vault (`url-canon.ts` ya lo hace)

### 12.6 Qué queda para el LLM

Casi nada, y eso es la gracia: los tres `kind` salen de **dominio + tipo de media + largo del hilo**, todo determinista y gratis. Claude Haiku entra solo para `topic` (los 7 de siempre) sobre el material que sobrevive. El costo de §4.2 se mantiene o baja.

---

## 13. Validación de la taxonomía v2 sobre 450 bookmarks + 200 likes (2026-07-31)

`sync bookmarks --all --limit 100 --max-pages 5` → **450** · `sync likes --all --limit 100 --max-pages 2` → **200**. Costo acumulado ≈ **$0.65**. (No se llegó al fondo de los bookmarks: hay más.)

### 13.1 La muestra de 20 estaba MUY sesgada

| | Muestra de 20 | **Real (450)** |
|---|---:|---:|
| Punteros a papers | 65% | **3.3%** |
| Concentración @MatiasScalbi | 70% | dispersa |

Los papers de finanzas eran **una racha de dos meses**, no el patrón de Fede. Confirma §11.5: no extrapolar muestras chicas. Si hubiéramos construido F7.1 optimizado para papers, habríamos optimizado para el 3%.

### 13.2 El mix real

| Categoría | N | % |
|---|---:|---:|
| **READ** (tweet/hilo largo 118 · paper 15 · artículo web 15) | **148** | **32.9%** |
| **WATCH** (video) | **110** | **24.4%** |
| **REFERENCE** (suelto/quote 136 · imagen 42 · repo/tool 14) | **192** | **42.7%** |

**Uno de cada cuatro bookmarks es un video.** La intuición de Fede sobre la categoría de video estaba plenamente justificada — es la segunda categoría, no un caso de borde.

Señales que la sostienen: `media_json` → 187 imágenes, 107 videos; links internos de X → 181 `/photo/`, **113 `/video/`**, 86 quotes, 91 perfiles; 249 de 450 (55%) tienen media.

### 13.3 Cuánto le cae realmente a la cola

| | READ → cola | WATCH → cola | REFERENCE → `Legacy/` |
|---|---:|---:|---:|
| **Reciente (<90d)** — 144 | **51** | **41** | 52 |
| Viejo (≥90d) — 306 | 97 | 69 | 140 |

**De 450 bookmarks, solo 92 entran a la cola** (51 para leer + 41 para ver). Es un volumen perfectamente digerible — la ventana de 90 días + el filtro por categoría hacen exactamente lo que Fede pedía: que no se inunde.

### 13.4 Antigüedad: bookmarks jóvenes, likes viejos

- **Bookmarks**: `2025-01` → `2026-07`. **448 de 450 son de 2026.** No hay "años de bookmarks" en este tramo; el histórico profundo, si existe, está más abajo.
- **Likes**: tweets desde **2014**. Doce años de material — confirma §11.6 (los likes son el corpus histórico grande, los bookmarks son recientes).

### 13.5 Refinamientos pendientes

1. **Quote-tweets (86)**: el contenido vive en el tweet citado. Hoy caen en `REFERENCE`; expandiendo `quoted_tweet_id` (como `research` hace con los hilos) algunos serían `READ`. Mejora incremental, no bloquea.
2. **`LISTEN` no se materializó**: los podcasts detectados tenían además video y cayeron en `WATCH`. Se deja la categoría definida pero sin uso; se revisa con más datos.
3. **Imágenes/screenshots (42)**: hoy `REFERENCE`. Algunos son gráficos o tablas con valor real. Un pase de visión podría rescatarlos — fuera de alcance por ahora.

---

## 14. Fuentes

- [Get Bookmarks — X API docs](https://docs.x.com/x-api/users/get-bookmarks) (H2: sin `bookmarked_at`)
- [X API pay-per-usage pricing and credits](https://docs.x.com/x-api/getting-started/pricing) (H3: $0.001/owned read)
- [X API Pricing Update: Owned Reads Now $0.001 — X Developers](https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025)
- [birdclaw](https://birdclaw.sh/) · [steipete/birdclaw en GitHub](https://github.com/steipete/birdclaw) (H4)
- [How to export your X bookmarks in 2026](https://keep.md/blog/export-x-bookmarks) (H1: el archive no trae bookmarks)
- [sytelus/xarchive](https://github.com/sytelus/xarchive) · [prinsss/twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) (plan B)
