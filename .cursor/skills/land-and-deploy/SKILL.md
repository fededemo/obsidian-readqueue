---
name: land-and-deploy
description: "Merge to main, wait CI, deploy from main, verify. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## land-and-deploy

Merge only when the PR is reviewable. Deploy from `main` (ADR-004). Dry-run destructive syncs. Write the ROADMAP deploy line in the same change if this repo is pigmi-web.
