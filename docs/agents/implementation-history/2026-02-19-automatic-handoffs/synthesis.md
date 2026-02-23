# Synthesis Report — Automatic Handoffs

**Plan:** `2026-02-19-automatic-handoffs`
**Report Date:** 2026-02-20
**Status:** COMPLETE ✓
**Version shipped:** MCP server v1.4.0 (bumped from v1.3.2)

---

## Executive Summary

This plan delivered end-to-end automatic inter-agent handoffs for the 7-stage MCP ledger workflow. Agents now chain from one stage to the next via VS Code's `runSubagent` mechanism without manual user intervention, while the MCP server remains the single source of truth for all routing decisions.

The implementation rests on four architectural pillars:

1. **Agent Registry** (`src/utils/agent-registry.ts`) — scans `*.agent.md` files at startup, parses YAML frontmatter `role:` and `name:` fields, and builds an in-memory `role → VS Code handle` map.
2. **Extended Handoff Response** — `buildHandoffResponse()` emits an `auto_handoff: { agent_name, prompt }` block when all eligibility conditions are satisfied.
3. **Ledger-Managed Depth Counter** — `auto_handoff_depth` in the root index is incremented server-side on every emitted auto-handoff and checked against `MAX_HANDOFF_DEPTH = 10`, preventing runaway loops without any agent cooperation.
4. **Persona Instructions** — Agents 2–7 each received one standardised paragraph instructing them to invoke `runSubagent` when `auto_handoff` is present, with a manual fallback block for all other cases.

All 10 work packages completed. Zero rework cycles. Zero blocking issues raised in any review pipeline.

---

## Metrics

### Test Coverage

| Scope | Tests Added | Total Suite | Pass | Fail |
|---|---|---|---|---|
| `src/utils/agent-registry.ts` | 30 | — | 30 | 0 |
| `src/tools/workflow.ts` (auto-handoff) | 13 | 79 | 79 | 0 |
| Integration: `auto-handoff.test.ts` | 23 | — | 23 | 0 |
| **Full regression (final)** | **+66** | **244** | **243** | **1 (pre-existing)** |

The single failing test (`path-validator.test.ts: should accept valid plan paths with date prefix`) is a pre-existing macOS/Windows-path fixture issue that predates this plan. It was present from the first WP and was confirmed unchanged at every pipeline stage.

### Code Review Scores

| WP | Subject | Score |
|---|---|---|
| WP-001 | Persona role: frontmatter | 10/10 |
| WP-002 | `agent-registry.ts` | 93/100 |
| WP-003 | `index.ts` startup integration | 91/100 |
| WP-004 | `auto_handoff_depth` schema field | 10/10 |
| WP-005 | `buildHandoffResponse()` auto-handoff logic | 89/100 |
| WP-006 | Persona auto-handoff instructions | 97/100 |
| WP-007 | Agent-registry unit tests | 93/100 |
| WP-008 | Workflow-handoff auto-handoff tests | 90/100 |
| WP-009 | Integration test suite | 91/100 |
| WP-010 | `sync-personas.js` frontmatter validation | 91/100 |

**Weighted average: 92.5/100.** No critical issues in any WP.

### Security

Zero security issues identified across all pipelines.

---

## Failed / Blocked Findings

None. All 10 WPs passed all four pipeline stages (implementation → QA → code-review → documentation) on first run.

### Pre-existing Technical Debt Surfaced

These issues were not introduced by this plan but were clearly identified during review passes:

| ID | Severity | Location | Issue |
|---|---|---|---|
| TD-01 | Medium | `src/tools/workflow.ts` | 3× TS7053 implicit-any errors on `agentNameMap`/`actionNameMap`/`reworkActionMap` indexing (predates plan) |
| TD-02 | Low | `tests/utils/path-validator.test.ts` | Failing fixture test for Windows-path handling on macOS |
| TD-03 | Low | `src/tools/workflow.ts` | `buildHandoffResponse` makes two `readRootIndex()` calls in some code paths; consolidating would reduce I/O |

---

## Strategic Recommendations (Gold Nuggets)

These cross-cutting insights emerged from reviewer and QA observations across multiple WPs and represent durable guidance for the project.

### 1. Prefer Real Implementations Over `vi.mock` for Registry/Store Tests

Captured as **Constraint #19** in `docs/agents/project-manifest/constraints.md`. WP-008's implementation consciously diverged from the spec's suggestion to mock the registry, instead using the real `discoverAgents` + `resetRegistry` cycle with temp directories. The reviewer endorsed this explicitly as architecturally superior — better end-to-end coverage, no module mock side-effects. All future WP specs for test additions should default to real-impl with temp dirs; reserve `vi.mock` for network-touching or filesystem-irreplaceable code only.

### 2. Shallow-Copy Mutation Test Pattern

WP-007's test suite includes a `'returns a shallow copy — mutating return value does not corrupt the cache'` test that validates the `{…newMap}` spread in `discoverAgents()`. The reviewer flagged this as a reusable contract-test pattern for any future registry-style or cache module in this codebase.

### 3. Silent `catch {}` Blocks Are a Debugging Anti-Pattern

A cross-cutting note from the Reviewer Agent (recorded as a `project_comments` entry): the `catch {}` blocks in `buildHandoffResponse` for depth increment and depth reset are entirely silent. When auto-handoff mysteriously stops working, there will be no trace in any log. All internal `catch` blocks in the workflow pipeline should write to `process.stderr` at minimum, consistent with the convention already established in `agent-registry.ts`. This applies to both the depth-increment and depth-reset paths in `workflow.ts` (approx. lines 1043–1044 and 1058–1059).

### 4. Constants Duplication — Extract `src/utils/constants.ts`

`KNOWN_AGENT_ROLES` in `agent-registry.ts` is a manual duplicate of `AGENT_ROLES` in `workflow.ts`. Both arrays must stay in sync manually. A micro-debt WP should extract a shared `src/utils/constants.ts` module exported from both files. This is the minimum friction fix before the role list grows or diverges.

### 5. Role Validation in `sync-personas.js` or CI

WP-001 reviewer recommendation: add a validation step to `sync-personas.js` (or a pre-commit hook) that reads `AGENT_ROLES` from `workflow.ts` and cross-checks them against the `role:` values in all `personas/ledger/*.md` files. WP-010 implemented part of this (advisory warnings for missing fields), but does not yet validate that values exactly match `AGENT_ROLES`. One follow-up WP is needed to close this gap.

### 6. `buildHandoffResponse` Post-Connect Placement

WP-003's reviewer flagged a spec deviation: `discoverAgents()` was specified to run before `server.connect()` but was placed after it. The post-connect placement is pragmatically safer (transport is live before FS scan) and has no runtime impact since the registry is consumed at request time, not at startup. The spec comment in WP-003's work document should be updated to reflect this architectural decision — and future plans should consider the settled convention: registry initialisation happens post-connect.

---

## Artifacts Produced

| File | Change |
|---|---|
| `src/utils/agent-registry.ts` | New module: role→handle map |
| `src/index.ts` | Startup integration: `--agents-dir`, `resolveAgentsDir()`, `discoverAgents()` call |
| `src/schema/root-index.ts` | Added `auto_handoff_depth?: number` |
| `src/tools/workflow.ts` | `buildHandoffResponse()` async conversion, auto-handoff logic, depth tracking |
| `tests/utils/agent-registry.test.ts` | 30 unit tests |
| `tests/tools/workflow-handoff.test.ts` | +13 auto-handoff tests |
| `tests/integration/auto-handoff.test.ts` | 23 integration tests (new file) |
| `personas/ledger/1-7.md` | Added `role:` frontmatter field (all 7) |
| `personas/ledger/2-7.md` | Added auto-handoff instruction paragraph (6 files) |
| `sync-personas.js` | Added `validateLedgerFrontmatter()` for advisory drift detection |
| `mcp-server/README.md` | Documented `--agents-dir`, platform defaults, `auto_handoff` payload, depth counter, running tests |
| `mcp-server/changelog.md` | v1.4.0 entry |
| `mcp-server/package.json` | Bumped to v1.4.0 |
| `docs/agents/project-manifest/api-surface.md` | Agent Registry API, `_internal` workflow exports, handoff response shape |
| `docs/agents/project-manifest/file-tree.md` | New module and test file entries |
| `docs/agents/project-manifest/constraints.md` | Constraint #19: real-impl-over-mock |
| `personas/changelog.md` | v3.1.0 (role: field), v3.1.1 (auto-handoff instructions) |

---

## Next Steps

### Immediate (Micro-debt)

1. **Fix silent `catch {}` blocks** in `buildHandoffResponse` — add `process.stderr.write()` for depth-increment and depth-reset failures. Two-line fix in `src/tools/workflow.ts`.
2. **Fix pre-existing TS7053 errors** in `workflow.ts` — replace untyped string indexing on `Record<...>` maps with `keyof` assertions or type-safe lookup helpers.
3. **Extract `src/utils/constants.ts`** — export `AGENT_ROLES` and import from both `workflow.ts` and `agent-registry.ts` to eliminate duplication.

### Near-term

4. **Cross-validate `role:` values in `sync-personas.js`** — extend WP-010's frontmatter validator to read `AGENT_ROLES` from `workflow.ts` and flag mismatches.
5. **Fix path-validator.test.ts** Windows-path fixture on macOS — the pre-existing test failure has been deferred across multiple plans.
6. **Update data-flows.md** to document the `auto_handoff_depth` increment/reset lifecycle (noted as a forward-reference in WP-004 documentation).

### Architectural / Future Plans

7. **Optional strict-mode for `discoverAgents()`** — add an optional `strict` parameter that rejects unknown roles rather than silently adding them. Useful for tightly controlled deployments.
8. **Role collision warning in agent-registry** — when two `.agent.md` files share the same `role:`, the current last-wins behavior is silent. A `stderr` warning on collision would make debugging misrouted handoffs tractable (noted by WP-003 reviewer).
9. **Planner → PM auto-handoff** — the Planner→Project Manager transition is intentionally manual today (no ledger exists at Planner stage). If a lightweight ledger bootstrap step is added, this gap could be closed.
