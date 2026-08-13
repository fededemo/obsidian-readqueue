---
name: design-shotgun
description: "Generate several visual mockup directions for comparison. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## design-shotgun

If image generation exists, produce 3–8 distinct directions. If not, produce HTML/CSS mock variations. Label trade-offs; do not pick silently.
