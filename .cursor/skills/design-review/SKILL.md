---
name: design-review
description: "Visual QA: spacing, contrast, Krug tests, AI slop. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## design-review

Look at the actual UI (browser or screenshots). Check hierarchy, tap targets, contrast, and placeholder-as-label. Propose specific CSS/copy fixes.
