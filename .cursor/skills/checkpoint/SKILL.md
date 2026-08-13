---
name: checkpoint
description: "Save or resume working state: git, decisions, unfinished work. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## checkpoint

Write a handoff: branch, uncommitted files, decisions made, next command. Prefer a file under `docs/` or agent memory. To resume, read that file first.
