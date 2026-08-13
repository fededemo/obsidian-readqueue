---
name: gstack-upgrade
description: "Refresh Cursor skill wrappers from pigmistudio cursor-layer, not a raw gstack clone into ~/.claude. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## gstack-upgrade

In this harness, upgrade means: pull pigmistudio, run `node scripts/cursor-layer.mjs --apply` (and `--root` / `--all` for product repos). Do not assume `~/.claude/skills/gstack`.
