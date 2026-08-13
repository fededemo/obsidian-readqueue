---
name: retro
description: "Weekly or post-phase retro: metrics, trends, what to change in the loop. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## retro

Look at git log, open PRs, backlog, and recent incidents. Output: what worked, what repeated, which rule in the rulebook should change. One page. No blame.
