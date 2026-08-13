---
name: benchmark
description: "Performance regression: load, bundle, Core Web Vitals. Use in Cursor/Grok; this is the portable wrapper, not the Claude gstack binary."
---

<!-- pigmi:generated cursor-layer skill wrapper -->

You are in Cursor, possibly Grok. Do not call Claude-only tools (`AskUserQuestion`, `mcp__claude-in-chrome__*`). Do not run `~/.claude/skills/gstack/bin/*`. Execute this workflow with Read, Shell, Grep, and the Task tool. Persistent memory stays in `.claude/agent-memory/`.

## benchmark

Measure what the project already measures (bundle size, Lighthouse, pytest benches). Report before/after. Do not add a new APM stack.
