# Project Synthesis: CC Agent Slug in Auto Handoff

**Plan:** `2026-04-08-cc-agent-slug-in-auto-handoff`  
**Date:** 2026-04-08  
**Status:** COMPLETE — 9/9 work packages  
**MCP Server:** v1.23.0 · **Personas:** v3.13.0

---

## Executive Summary

This session eliminated a class of brittle runtime name-derivation from Claude Code persona
handoff instructions and replaced it with a deterministic, ledger-sourced lookup. Previously,
each Claude Code persona instructed the agent to _derive_ the next sub-agent's slug by
manipulating `agent_name` at runtime (regex, lowercase, strip-version). This was fragile:
any naming convention change would break every persona silently.

The solution introduced a **build-time name mapping** (`personas/name-mapping.json`) generated
by `scripts/build-personas.js`. The MCP server loads this mapping at startup as `AGENT_NAMES`
and injects three new fields into every `auto_handoff` response payload:

- `cc_agent_name` — Claude Code sub-agent name (e.g. `3-developer`)
- `vs_agent_name` — VS Code display name (e.g. `3 - Developer v3.6.1`)
- `da_agent_name` — Deep Agents name (e.g. `3-developer`)

Claude Code personas now reference `auto_handoff.cc_agent_name` directly — one field, zero
derivation logic. The VS Code persona build path was confirmed unaffected.

---

## Work Package Summary

| WP | Scope | Stages | Result |
|----|-------|--------|--------|
| WP-001 | Generate `personas/name-mapping.json` in `build-personas.js` | impl → qa → review → docs | PASS |
| WP-002 | Update workflow spec §18.3 pseudocode (`auxiliary-systems.md`) | docs | PASS |
| WP-003 | Update `AGENTS.md` cross-system deps + root manifest README | docs | PASS |
| WP-004 | Add `AGENT_NAMES` constant to `constants.ts` | impl → qa → review → docs | PASS |
| WP-005 | Inject `cc/vs/da_agent_name` into `auto_handoff` in `workflow-handoff.ts` | impl → qa → review → docs | PASS |
| WP-006 | Simplify CC handoff partial (remove derivation logic) | impl → qa → review → docs | PASS |
| WP-007 | Update `api-surface.md` + `data-flows.md` for mcp-server manifest | docs | PASS |
| WP-008 | Add test assertions for `cc/vs/da_agent_name` to integration test | qa | PASS |
| WP-009 | Full-build verification (name-mapping + CC personas) | impl → qa | PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 9 / 9 |
| Pipeline stages total | 24 (all PASS) |
| MCP server tests (final) | **1743 / 1743** |
| New integration tests added | 8 (`auto-handoff.test.ts`) |
| New test assertions added | 3 (`handoff-config-integration.test.ts`) |
| Persona files rebuilt | 81 (27 per target: CC, VS Code, Deep Agents) |
| CC personas simplified | 7 (Planner and Synthesis are terminal — no `runSubagent`) |
| New files created | `personas/name-mapping.json` (9 entries) |
| Rework cycles | 0 |
| Blocking issues | 0 |

---

## Key Artifacts Modified

### New / Generated
- `personas/name-mapping.json` — 9 entries, one per ledger persona; fields: `role`, `number`,
  `id`, `version`, `vscode`, `claude_code`, `deep_agents` (each with `file_name` +
  `agent_name`).

### Implementation
- `scripts/build-personas.js` — post-build step to produce `name-mapping.json`; `_shared.yaml`
  default-version fallback added by Reviewer fix-forward.
- `mcp-server/src/utils/constants.ts` — `TargetNames`, `NameMappingEntry` interfaces and
  `AGENT_NAMES` constant (loaded via `createRequire` at module-init time).
- `mcp-server/src/tools/workflow-handoff.ts` — two-line additive change; injects
  `cc_agent_name`, `vs_agent_name`, `da_agent_name` into the `auto_handoff` payload.
- `personas/ledger/src/partials/handoff-block-claude-code.md` — 3 lines of regex-derivation
  logic replaced with 1 direct `auto_handoff.cc_agent_name` reference.

### Tests
- `mcp-server/tests/integration/auto-handoff.test.ts` — 8 new tests (3 transitions,
  backward-compat, structural sanity, graceful degradation).
- `mcp-server/tests/gui/handoff-config-integration.test.ts` — 3 new assertions for
  `cc_agent_name`, `vs_agent_name`, `da_agent_name` using live `AGENT_NAMES` values (not
  hardcoded strings).

### Documentation
- `mcp-server/docs/agents/workflow-specification/auxiliary-systems.md` — §18.3 pseudocode.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — `AGENT_NAMES`,
  `HandoffStatusPayload` shape.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Flow 13b expanded; stale
  depth-ceiling multiplier corrected (× 20 → × 30).
- `mcp-server/docs/agents/project-manifest/file-tree.md` — `constants.ts` annotation.
- `mcp-server/README.md` — `auto_handoff` example JSON refreshed (all 7 fields).
- `AGENTS.md` + `docs/agents/project-manifest/README.md` — cross-system dep table updated
  with full producer → consumer chain.
- `personas/docs/agents/project-manifest/api-surface.md` + `data-flows.md` +
  `constraints-cross-system.md` — name-mapping generation documented.
- `mcp-server/changelog.md` v1.23.0 + `personas/changelog.md` v3.13.0.
- `mcp-server/package.json` (v1.23.0), `personas/package.json` (v3.13.0).

---

## Strategic Recommendations

### 1. Guard `writeFileSync` in `build-personas.js` with a content equality check
The name-mapping generation block always writes the file even when the content is identical,
causing unnecessary mtime drift and Git noise. A read-then-compare guard (like the existing
`pkg.version !== newVersion` check in the version-sync block) would suppress spurious diffs.
**Priority:** low.

### 2. Add a dedicated unit test for `AGENT_NAMES` in `tests/utils/constants.test.ts`
Code review filed a documentation-forward noting that integration tests exercise `AGENT_NAMES`
indirectly. A targeted unit test verifying all 9 roles are present, each entry has the correct
`vscode`/`claude_code`/`deep_agents` shape, and `role` fields match `AGENT_ROLES` would
improve coverage isolation without depending on the handoff flow.
**Priority:** medium.

### 3. Consider a Zod schema for `name-mapping.json` at module load
`createRequire` throws a JSON parse error if the file is malformed — acceptable but opaque.
A lightweight Zod `.parse()` call in `constants.ts` would surface structural regressions
(e.g. a missing `claude_code.agent_name`) at startup with a clear error message rather than
a runtime crash deep in a tool call.
**Priority:** low — deferred by design per plan constraints, but worth tracking.

### 4. Document `da_file_name` fallback explicitly in persona YAML conventions
The `da_file_name || cc_file_name` fallback in `build-personas.js` is correct and tested,
but currently not exercised by any production YAML (all 9 personas define `da_file_name`).
A one-line note in the personas `constraints.md` would prevent a future persona author from
being confused when their `da_file_name` omission silently works.
**Priority:** low.

---

## Failure / Warning Register

| Source | Priority | Note |
|--------|----------|------|
| Reviewer (WP-004 code-review) | low | Pipeline declared no `artifacts.files_modified` — traceability gap only |
| Reviewer (WP-005 code-review) | low | Pipeline declared no `artifacts.files_modified` — traceability gap only |
| Reviewer (WP-006 code-review) | low | Pipeline declared no `artifacts.files_modified` — traceability gap only |

All three warnings are process/traceability notes, not functional defects. No blockers.

---

## Next Steps for Planner / Manager

1. **Root changelog entry** — The module changelogs (`mcp-server` v1.23.0, `personas` v3.13.0)
   are written. A root `changelog.md` entry summarizing this release is the remaining step
   before tagging.
2. **Sync personas to IDE targets** — Run `node scripts/sync-personas.js` to deploy the
   rebuilt CC + VS Code personas to the active VS Code prompts directory and/or
   `~/.claude/agents/`. The build produced fresh output; deployment was not in scope for this
   plan.
3. **CTX regeneration** — Several `.context/` files were updated during doc passes. A final
   `node scripts/cli.js ctx-generate` pass would ensure the snapshot is fully current.
4. **Unit test gap** — Track Recommendation #2 (dedicated `AGENT_NAMES` unit test) as a
   follow-up task.
