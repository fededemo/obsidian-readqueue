# Busca un node que ANDE, no uno que exista. Se sourcea; define $NODE_BIN.
#
# En esta Mac `/opt/homebrew/bin/node` está instalado y roto: le falta una dylib
# de icu4c (B-607, las Command Line Tools desactualizadas). Un `command -v node`
# lo encuentra feliz y el job muere con "Abort trap: 6". nvm va primero
# justamente por eso, y de todas formas cada candidato se prueba antes de usarlo.
#
# Vive en un archivo aparte porque lo necesitan los dos wrappers (gardener y
# sync-x) y una copia divergida es la forma exacta en que B-744 se hizo cara:
# arreglar un camino no arregla al gemelo.
resolve_node() {
  NODE_BIN=""
  local candidates=()
  local d c
  while IFS= read -r d; do candidates+=("$d/node"); done < <(
    ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -Vr
  )
  candidates+=("$(command -v node 2>/dev/null || true)")
  candidates+=("/opt/homebrew/bin/node" "/usr/local/bin/node")

  for c in "${candidates[@]}"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" --version >/dev/null 2>&1; then
      NODE_BIN="$c"
      return 0
    fi
    echo "aviso: $c existe pero no arranca — lo salteo"
  done
  return 1
}
