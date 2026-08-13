---
name: open-gstack-browser
description: "Stealth/headed browser for scraping. Prefer Cursor browser tools. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## open-gstack-browser

Use available browser tools. Respect robots and auth boundaries. Do not build a new scraper stack.
