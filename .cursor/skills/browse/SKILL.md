---
name: browse
description: "Use a real browser for UI verification. In Cursor, use the computer/browser tools you have — never claude-in-chrome. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## browse

Verify the UI with the browser/computer tools available in this session. Screenshots of the actual flow, not guesses. If no browser tool exists, say so and fall back to Playwright/curl.
