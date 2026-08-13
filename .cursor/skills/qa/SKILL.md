---
name: qa
description: "QA the diff: identify affected surfaces, test them, fix with atomic commits, re-verify. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## qa

1. Diff against main: which routes/modules changed?
2. Test each affected surface (unit + browser if UI).
3. Fix bugs at the root cause; one commit per fix.
4. Re-run the failing check.
5. Report pass/fail with evidence.
