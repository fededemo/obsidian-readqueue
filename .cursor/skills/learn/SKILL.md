---
name: learn
description: "Capture or search project learnings so the same mistake is not repeated. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## learn

If the user found a lesson, append it to the agent memory or `docs/backlog.md` with date. If they ask what we learned about X, search `.claude/agent-memory/` and FOR_FEDE.md. Do not invent learnings.
