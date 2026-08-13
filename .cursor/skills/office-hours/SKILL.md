---
name: office-hours
description: "YC-style office hours. Use before plan-ceo-review when the user is exploring what to build. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## office-hours

Interview the idea: who it is for, why now, what has been tried. Write a short design note the later plan reviews can read. Do not jump to code.
