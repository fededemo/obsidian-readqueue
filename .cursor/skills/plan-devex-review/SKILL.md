---
name: plan-devex-review
description: "DX review for APIs, CLIs, MCP servers, skills. Use when the change is developer-facing. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## plan-devex-review

Score getting-started, error messages, naming, and the time-to-first-success. Propose the smallest DX fix that unblocks a new user of the interface.
