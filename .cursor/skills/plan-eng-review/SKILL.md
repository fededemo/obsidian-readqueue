---
name: plan-eng-review
description: "Engineering review of a plan: architecture, data flow, edge cases, test matrix. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## plan-eng-review

Given a product decision, produce:

- Architecture and data flow
- Files that will change
- Failure modes and edge cases
- Test matrix (happy path, auth, empty, error)
- What is out of scope

Do not implement until this exists for non-trivial work.
