---
name: careful
description: "Warn before destructive commands: rm -rf, DROP, force-push, rsync --delete. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## careful

Before any destructive command, state blast radius and wait for an explicit go-ahead unless the user already ordered that exact command. Always dry-run `rsync --delete`.
