# obsidian-readqueue

Plugin de Obsidian: cola de lectura e intake desde apps de iOS que no son Safari.

## Gate

`./scripts/verificar.sh` (typecheck + test + build). Listo = ese script en verde. No hay Actions.

## Gotchas

- La vault del usuario se lee por filesystem, read-only. Las escrituras van con compuerta.
- A mobile llega por Obsidian Sync (`.obsidian/plugins/`).
- Un tag se publica desde esta máquina: `npm run build` y `gh release create` con `main.js`, `manifest.json`, `styles.css`, `versions.json`.
- Frontmatter, carpetas y riesgos: `docs/contexto.md`.
