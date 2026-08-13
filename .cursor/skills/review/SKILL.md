---
name: review
description: "Code review of the current diff: correctness, security, tests, scope drift. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## review

Review the branch vs main. Flag bugs, missing tests, security, and scope creep. Independent of the author. Do not implement unless asked to fix a finding.
