<!-- pigmi:generated cursor-layer AGENTS.md -->

# AGENTS.md — Readqueue

Capa portable para Cursor (Grok u otro modelo), Claude Code y el resto de harnesses. El detalle Claude-only (gstack, slash commands) vive en `CLAUDE.md`. Si estás en Cursor, este archivo manda sobre esas partes.

Los especialistas se invocan por nombre desde `.cursor/agents/` (`model: inherit`). Las skills viven en `.cursor/skills/` (wrappers del bundle + copias de skills locales). Regenerar con:

```bash
node ~/pigmistudio/scripts/cursor-layer.mjs --root . --apply
# o, desde pigmistudio, todos los ~/codes/* :
node scripts/cursor-layer.mjs --all --apply
```

## Principios

1. Ejecutable > declarativo.
2. Arreglá el loop, no el output.
3. El juez antes que el trabajo.
4. Contención por construcción.
5. El criterio de Fede se ubica, no se difunde.

## Stack

ver CLAUDE.md del proyecto

## Workflow

0. `gh run list --branch main --limit 5` — no implementar sobre main rojo.
1. Plan si hay más de un camino o se tocan 3+ archivos.
2. Implementar. Verificar (tests / typecheck).
3. Estado terminal: en `main`, o anotado en `docs/backlog.md` por qué no.
4. Documentar en el mismo PR.

## Commits (resumen)

PR chico, draft con motivo, docs con el cambio, push si hay commit, deploy desde `main`. Detalle en los bloques `pigmi:git` de cada agente.

## Memoria

`.claude/agent-memory/<agente>/` — compartida entre Claude Code y Cursor. No duplicar en `.cursor/`.
