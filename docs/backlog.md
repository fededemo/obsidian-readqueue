# Backlog — obsidian-readqueue

> Backlog priorizado P0/P1/P2/P3 con estado y agente asignado. Owner: `system-architect`.

## Convenciones

- **ID**: `B-NNN` secuencial
- **Priority**: P0 (crítico/bloqueante), P1 (importante), P2 (nice to have), P3 (futuro)
- **Status**: TODO, IN_PROGRESS, BLOCKED, DONE
- **Agent**: agente al que está asignado (o "—" si pendiente de assign)
- **Dependencies**: items que tienen que cerrar antes

## P0 — Bloqueantes para F1

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-001 | Implementar `queue-data.ts` con tests | TODO | obsidian-readqueue-builder | — | F1.1 del ROADMAP |
| B-002 | Implementar `queue-view.ts` (UI side panel) | TODO | obsidian-readqueue-builder | B-001 | F1.2 del ROADMAP |
| B-003 | Implementar `read-action.ts` (open + force preview + mark as read) | TODO | obsidian-readqueue-builder | B-001 | F1.3 del ROADMAP |
| B-004 | Implementar `intake.ts` con defuddle + tests con fixtures | TODO | obsidian-readqueue-builder | — | F1.4 del ROADMAP |
| B-005 | URI handler + settings tab + comandos paleta | TODO | obsidian-readqueue-builder | B-002, B-003 | F1.5 del ROADMAP |
| B-006 | Setup BRAT en Mac + iPhone, distribuir plugin | TODO | obsidian-readqueue-builder | B-001..B-005 | F1.6 del ROADMAP |

## P1 — Important, no bloqueantes

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-101 | Tests E2E del flujo "save desde Twitter app → intake → cola → lectura" | TODO | qa-tester | B-002, B-004 | 1 test corriendo en CI |
| B-102 | README + screenshots para BRAT users | TODO | — | B-006 | screenshots actualizados |

## P2 — Nice to have

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-201 | Reading-mode CSS snippet (typography serif) | TODO | — | F1 done | Toggle desde settings |
| B-202 | Time-to-read estimado en cards | TODO | — | B-002 | Card muestra "X min" |
| B-203 | Snooze (`snoozedUntil` frontmatter) | TODO | — | B-002 | Botón "Snooze 1 día" |

## P3 — Futuro

| ID | Descripción | Status | Agent | Dependencies | Acceptance |
|----|-------------|--------|-------|--------------|------------|
| B-301 | Integración con Kindle highlights | TODO | — | F1 done | `source: kindle` aparece en cola |
| B-302 | Integración con Twitter likes batch (BookmarkRapture) | TODO | — | F1 done | Sync nocturno funciona |

## Archivo

*(vacío — no hay items completados aún)*

---

**Última actualización**: 2026-05-30
