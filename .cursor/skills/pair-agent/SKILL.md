---
name: pair-agent
description: "Pair an external agent with this session. Usually skip in Cursor Cloud. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## pair-agent

If the user wants another harness involved, say what this session can and cannot see. Do not exfiltrate secrets to a third agent.
