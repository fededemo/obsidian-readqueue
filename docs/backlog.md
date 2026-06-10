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
| B-006 | Setup BRAT en Mac + iPhone, distribuir plugin | TODO | user (manual) | B-001..B-005 (todos DONE) | F1.6 del ROADMAP |

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

| ID | Descripción | Closed | Commit |
|----|-------------|--------|--------|
| MX13 | Vista unificada de highlights (web + Kindle + Matter, search, jump-to-highlight) + resurfacing diario determinístico por fecha con sección en el digest — módulo puro `src/highlights-data.ts` con 21 tests | 2026-06-10 | `036a180` |
| MX11 | Subrayado por selección en reading view — botón flotante (desktop + iOS) + comandos de paleta, `==...==` + nota `%%...%%`, módulo puro `src/highlight.ts` con 43 tests | 2026-06-10 | `9536d1c` |
| B-001 | `queue-data.ts` con tests | 2026-05-30 | `5865d3b` |
| B-002 + B-005 | `queue-view.ts` + URI handler + settings tab + comandos paleta (mergeados en un solo wire-up) | 2026-05-30 | `55a392b` |
| B-003 | `read-action.ts` (open + force preview + mark as read) | 2026-05-30 | `7704edc` |
| B-004 | `intake.ts` con defuddle + tests con fixtures | 2026-05-30 | `756608e` |

---

**Última actualización**: 2026-05-30 — F1.0–F1.5 code-complete (5 commits feat en main). Solo queda B-006 (BRAT install + 2 semanas de uso real).
