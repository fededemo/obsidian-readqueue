<!-- pigmi:generated cursor-layer AGENTS.md -->

# AGENTS.md — obsidian-readqueue

Entrypoint de Cursor. Agentes en `.cursor/agents/` (`model: inherit`).

## Agentes (`.cursor/agents/`, `model: inherit`)

| Agente | Cuándo | Nunca |
|--------|--------|-------|
| `obsidian-readqueue-builder` | Use this agent to implement features, fix bugs, write TypeScript code, modify the Obsidian Plugin API integ… | ver el agente |
| `qa-tester` | Use this agent to write, run, or maintain tests for the obsidian-readqueue project. | ver el agente |
| `system-architect` | Use this agent when you need to plan, design, or coordinate work across obsidian-readqueue. | ver el agente |
| `vault-gardener` | Use this agent to query, synthesize, and discover connections across Fede's Obsidian knowledge base (the `f… | ver el agente |

## Loop

<!-- pigmi:begin loop -->
1. Implementar en este hilo. No spawnear un agente por un fix chico.
2. Dominio / UI / deploy: invocá al especialista de la tabla.
3. Cierre si el diff es grande o toca motor / auth / UI: `qa-tester` siempre. Hallazgo sin `file:line` no cuenta.
4. Merge a `main`: gate = tests del repo, en esta máquina. Deploy solo desde `main`.
<!-- pigmi:end loop -->

## Cursor Cloud specific instructions

<!-- pigmi:begin cloud -->
Completar: qué no hay en el VM (Docker, secrets, SSH), cómo verificar sin eso, y a qué host se deploya (solo desde `main`).
<!-- pigmi:end cloud -->

Skills: leé `.cursor/skills/<nombre>/SKILL.md` solo si el cambio la dispara. Docs bajo demanda. Memoria: `.claude/agent-memory/<agente>/`.
