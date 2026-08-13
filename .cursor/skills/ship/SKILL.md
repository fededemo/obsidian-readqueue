---
name: ship
description: "Ship: tests, push, PR. Terminal state is main (or backlog note why not). Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## ship

Follow ADR-003/004:

1. Pre-flight CI on main.
2. Run the project's tests.
3. Commit if needed; push.
4. Open/update the PR. Draft only with a named blocker.
5. Docs of the change travel in the same PR.
6. Do not deploy from the branch. Deploy from `main`.
