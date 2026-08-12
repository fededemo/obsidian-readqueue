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

# shellcheck source=lib/resolve-node.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/resolve-node.sh"
resolve_node || true

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
