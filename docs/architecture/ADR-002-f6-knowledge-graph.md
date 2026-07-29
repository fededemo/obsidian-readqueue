# ADR-002: F6 — Knowledge graph (segundo cerebro) como evolución de readqueue

## Status

**Accepted** (2026-07-13). Decisiones tomadas por Fede sobre la base de `docs/architecture/knowledge-graph-vision.md`.

## Context

Fede quiere que Claude no solo lea la vault (ADR-001) sino que la transforme en una red neuronal de conocimiento: extraer conceptos, tejer conexiones entre ideas, mantener mapas. El sustrato medido (2026-07-13): 629 notas, capa de consumo madura pero **capa de síntesis inexistente** (79% de notas sin links; los 444 links que hay son bibliográficos, no conceptuales; 0 notas-concepto; 0 MOCs; vault sin git). Detalle completo en el vision doc.

## Decisions

1. **Casa: readqueue-F6.** Es la evolución natural del plugin (queue → highlights → books → grafo que conecta todo lo que se lee). Un repo, dos superficies: el plugin shipeado (plomería determinística + vistas) y la tooling de Claude en `.claude/` (inteligencia semántica, no va en `main.js`).

2. **Postura de escritura: suggestion-only para arrancar.** Claude **propone** conceptos/links/síntesis; Fede los aplica a mano. Cero riesgo de mutación. Escala a "batches con aprobación sobre git" (Fase 2) **solo después** de validar la calidad en Fase 1. El gate del classifier sigue vigente.

3. **Primer slice: Fase 1 — consultar + descubrir conexiones.** Ask-your-vault + descubrimiento de conexiones como sugerencias. Valida si Claude "entiende" el cerebro de Fede antes de darle permiso de escritura.

### Corolarios

- **Las propuestas viven en el REPO, no en la vault.** Mientras estemos en suggestion-only, los outputs de discovery/síntesis se escriben en `docs/vault-gardener/proposals/` (repo), nunca en notas de la vault. Respeta el gate de ADR-001 y evita ensuciar el grafo antes de validar.
- **Git en la vault se difiere hasta Fase 2** (primera mutación real). No es necesario para Fase 1 (solo lectura). Cuando lleguemos a mutación, git es prerequisito no-negociable (backbone de undo).
- **Empaquetado diferido:** el agente `vault-gardener` + skills (`/vault-ask`, `/vault-link`, …) se crean cuando Fase 1 valide el enfoque. Por ahora el `system-architect` corre/delega la discovery a mano.
- **Patrón de escala** (para cuando crezca): embeddings para recall barato sobre todo el corpus + Claude para precisión sobre el shortlist. No hace falta en Fase 1 (clusters chicos, lectura directa).

## Consequences

- ➕ Valor inmediato sin riesgo: Claude consulta y propone, Fede decide qué entra a la vault.
- ➕ De-riskea la mutación: validamos calidad de linking antes de escribir una sola nota.
- ➖ Suggestion-only tiene fricción (Fede copia a mano lo que aprueba). Aceptable para validar; se automatiza en Fase 2.
- ➖ El grafo no crece "solo" todavía — es un trade-off deliberado contra el riesgo de corrupción.

## References

- `docs/architecture/knowledge-graph-vision.md` — el north star completo (modelo de nodos/aristas, fases 0-4, plomería vs inteligencia, riesgos).
- `docs/architecture/ADR-001-acceso-vault-obsidian.md` — acceso read-only base + gate de escritura.
