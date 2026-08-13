---
name: devex-review
description: "Live DX audit of docs and first-run after something shipped. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## devex-review

Follow README from a clean clone in your head (or actually). Time-to-first-success. Fix the docs in the same PR if they lie.
