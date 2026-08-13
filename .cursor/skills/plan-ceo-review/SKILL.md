---
name: plan-ceo-review
description: "CEO/founder plan review. Use before building a feature to check we are building the right thing. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## plan-ceo-review

Challenge the brief before architecture:

1. What problem does this solve for the user, in one sentence?
2. What is the 10-star version hiding in the request?
3. What should we explicitly NOT build?
4. Failure modes if we ship the obvious interpretation.
5. Write the verdict in the plan or as a short note in `docs/backlog.md` if this blocks work.

Do not implement. Hand off to `plan-eng-review` or `system-architect`.
