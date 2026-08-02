#!/bin/bash
# Wrapper del gardener para launchd (B-712).
#
# launchd arranca con un PATH mínimo y sin el entorno de la shell interactiva, así
# que node hay que resolverlo a mano: si el binario no está, el job "corre", falla
# en silencio y nadie se entera durante semanas. Por eso el script es ruidoso al
# fallar y deja todo en un log.
set -euo pipefail

REPO="${READQUEUE_REPO:-$HOME/codes/obsidian-readqueue}"
LOG_DIR="$HOME/Library/Logs/readqueue"
LOG="$LOG_DIR/gardener.log"
mkdir -p "$LOG_DIR"

exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') gardener ==="

# Buscar un node que ANDE, no uno que exista.
#
# En esta Mac `/opt/homebrew/bin/node` está instalado y roto: le falta una dylib
# de icu4c (B-607, las Command Line Tools desactualizadas). Un `command -v node`
# lo encuentra feliz y el job muere con "Abort trap: 6" cada domingo. nvm va
# primero justamente por eso, y de todas formas cada candidato se prueba.
NODE_BIN=""
CANDIDATES=()
while IFS= read -r d; do CANDIDATES+=("$d/node"); done < <(
  ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -Vr
)
CANDIDATES+=("$(command -v node 2>/dev/null || true)")
CANDIDATES+=("/opt/homebrew/bin/node" "/usr/local/bin/node")

for c in "${CANDIDATES[@]}"; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  if "$c" --version >/dev/null 2>&1; then
    NODE_BIN="$c"
    break
  fi
  echo "aviso: $c existe pero no arranca — lo salteo"
done

if [ -z "$NODE_BIN" ]; then
  echo "ERROR: no hay ningún node que funcione. El job no puede correr."
  exit 1
fi
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH

cd "$REPO"
echo "node $(node --version) · repo $REPO"
npx tsx scripts/gardener.mts "$@"
echo "=== fin $(date '+%H:%M:%S') ==="
