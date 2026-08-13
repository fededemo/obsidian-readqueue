---
name: setup-browser-cookies
description: "Import a real browser session before QA on authenticated pages. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## setup-browser-cookies

If cookie import tools exist, use them. Otherwise tell the user you need a test account or a storageState file. Never paste session cookies into logs.
