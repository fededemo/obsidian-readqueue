---
name: autoplan
description: "Run CEO + design + eng (+ DX if developer-facing) reviews in sequence with recorded decisions. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## autoplan

Run, in order, the intent of `plan-ceo-review`, then `plan-design-review` if there is UI, then `plan-eng-review`, then `plan-devex-review` if the surface is an API/CLI/MCP/skill. Stop if a review would block. Write one combined plan; do not spawn a ceremony per section unless the user asked.
