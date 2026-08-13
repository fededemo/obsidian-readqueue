---
name: setup-deploy
description: "One-time deploy setup (Fly, Render, Vercel, VM). Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## setup-deploy

Read existing deploy docs first. Do not invent a second pipeline. Prefer the host the project already uses.
