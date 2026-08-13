---
name: cso
description: "Security audit (OWASP, auth, secrets, supply chain). Read-only unless asked to fix. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## cso

Audit the diff or the scoped area for injection, authz holes, secrets in git, logging of PII. Report by severity. Do not log secrets while investigating.
