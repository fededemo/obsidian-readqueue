#!/bin/bash
# Wrapper del sync de X para launchd (B-745).
#
# La cadena tiene dos escalones y el que faltaba automatizar era el primero:
# `birdclaw sync` baja de X al SQLite local y recién después `sync-x.mts` lo
# vuelca a la vault. Durante 14 días el segundo estuvo al día con un primero
# que nadie corría, así que el dry-run decía "0 pendientes" mientras los
# bookmarks se acumulaban del otro lado de la API.
#
# Por eso este script corre los dos y, sobre todo, es ruidoso al fallar: un job
# silencioso que se rompe reproduce exactamente el problema que vino a resolver.
set -uo pipefail

REPO="${READQUEUE_REPO:-$HOME/codes/obsidian-readqueue}"
LOG_DIR="$HOME/Library/Logs/readqueue"
LOG="$LOG_DIR/sync-x.log"
STATE="$LOG_DIR/sync-x.state"
LOCK="$LOG_DIR/sync-x.lock"
mkdir -p "$LOG_DIR"

# Log rotado por tamaño: esto corre a diario y nadie va a podarlo a mano.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ]; then
  mv "$LOG" "$LOG.1"
fi
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') sync-x ==="

# Aviso en pantalla, solo cuando algo se rompe. El fallo tiene que llegarle a
# Fede el día que pasa, no dentro de dos semanas cuando note la cola vacía.
notify() {
  osascript -e "display notification \"$1\" with title \"readqueue · sync de X\"" >/dev/null 2>&1 || true
}
fail() {
  echo "ERROR: $1"
  echo "$(date '+%Y-%m-%dT%H:%M:%S') FAIL $1" >>"$STATE"
  notify "$1"
  rmdir "$LOCK" 2>/dev/null || true
  exit 1
}

# Lock por directorio: `mkdir` es atómico y no necesita flock (que macOS no
# trae). Si una corrida quedó colgada bajando media, la de mañana no se le monta
# encima; pero un lock eterno silenciaría el sync para siempre, así que a las 3
# horas se considera muerto.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
    echo "aviso: lock viejo (>3h), lo rompo — la corrida anterior quedó colgada"
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || fail "no pude tomar el lock"
  else
    echo "ya hay una corrida en curso, salgo"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# shellcheck source=lib/resolve-node.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/resolve-node.sh"
resolve_node || true
[ -n "$NODE_BIN" ] || fail "no hay ningún node que funcione (ver B-607)"

# `/opt/homebrew/bin` a mano: launchd arranca con un PATH mínimo y ahí viven
# `birdclaw` y el `xurl` que usa para hablar con la API. birdclaw ya resuelve su
# propio node (exige >=26.5.0), así que no hay que elegírselo.
PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:$PATH"
export PATH
command -v birdclaw >/dev/null 2>&1 || fail "birdclaw no está en el PATH"

cd "$REPO" 2>/dev/null || fail "no existe el repo en $REPO"
echo "node $(node --version) · birdclaw $(birdclaw --version 2>/dev/null) · repo $REPO"

# Escalón 1: X → SQLite.
#
# `--early-stop` corta apenas una página ya está entera en la base: con sync
# diario eso es la primera, y evita repaginar 450 bookmarks todos los días
# contra una API con rate limit. `--refresh` saltea la caché de 120s, que en un
# job diario nunca ayuda.
#
# Un fallo acá NO aborta: la API de X puede tirar 429 o vencerse el token de
# xurl, y en ese caso todavía vale la pena correr el escalón 2 por si quedó algo
# de una corrida anterior sin volcar. Pero se avisa.
downstream_ok=1
for collection in bookmarks likes; do
  echo "--- birdclaw sync $collection ---"
  if birdclaw sync "$collection" --mode xurl --all --early-stop --refresh >/dev/null 2>&1; then
    echo "ok"
  else
    echo "FALLÓ birdclaw sync $collection (¿rate limit? ¿token de xurl vencido?)"
    downstream_ok=0
  fi
done
[ "$downstream_ok" -eq 1 ] || notify "birdclaw no pudo bajar de X — revisá el token de xurl"

# Escalón 2: SQLite → vault. Idempotente: si no hay nada nuevo escribe 0.
echo "--- sync-x.mts ---"
OUT="$(npx tsx scripts/sync-x.mts 2>&1)"
RC=$?
echo "$OUT"
[ $RC -eq 0 ] || fail "sync-x.mts salió con código $RC"

WRITTEN="$(printf '%s' "$OUT" | sed -n 's/^escritas: \([0-9]*\).*/\1/p' | tail -1)"
WRITTEN="${WRITTEN:-0}"
echo "$(date '+%Y-%m-%dT%H:%M:%S') OK escritas=$WRITTEN birdclaw=$downstream_ok" >>"$STATE"
echo "=== fin $(date '+%H:%M:%S') · $WRITTEN notas nuevas ==="
