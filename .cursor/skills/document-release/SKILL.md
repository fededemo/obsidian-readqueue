---
name: document-release
description: "After a ship, sync README, FOR_FEDE, ROADMAP with what actually shipped. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## document-release

Diff vs the last documented state. Update FOR_FEDE for non-trivial bugs/decisions, README if setup changed, ROADMAP only in the same PR as the work (or if already on main).
