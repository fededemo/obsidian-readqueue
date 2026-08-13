---
name: plan-design-review
description: "Design review of a plan: hierarchy, copy, forms, Krug usability. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## plan-design-review

Rate the proposed UI on scanning, wayfinding, forms, and goodwill. Flag placeholder-as-label, body text under 16px, missing visited-link distinction. Output concrete copy and layout changes, not vibe.
