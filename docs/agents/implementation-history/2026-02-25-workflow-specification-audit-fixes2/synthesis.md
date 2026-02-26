# Project Synthesis — Workflow Specification Audit & Fixes (Round 2)

**Plan:** `2026-02-25-workflow-specification-audit-fixes2`
**Date:** 2026-02-26
**Synthesized by:** Head of Operations (Synthesis Agent)
**Status:** COMPLETE — 8/8 work packages delivered

---

## Executive Summary

This session performed a targeted correctness and completeness pass on the MCP server's agentic workflow engine. Eight work packages were executed in parallel, collectively resolving five runtime defects, three spec ambiguities, one infrastructure fix batch, and two new first-class capabilities. The session grew the test suite from **436 to 489 tests** (all passing), and produced comprehensive spec, manifest, and help-content updates across 30+ files.

The work falls into four themes:

| Theme | WPs | Description |
|-------|-----|-------------|
| **Rework loop correctness** | WP-001, WP-002 | Correct FAIL routing; correct rework_count semantics |
| **New capabilities** | WP-003, WP-006 | Synthesis lifecycle gate; CANCELLED status + rework circuit breaker |
| **Infrastructure fixes** | WP-004, WP-005, WP-007 | Cascade-reblock; lock/timestamp/ID hardening; self-healing improvement |
| **Spec & manifest hygiene** | WP-008 | 8 ambiguities resolved; all manifests synchronized |

---

## Work Package Outcomes

### WP-001 — FAIL Routing Overhaul ✅
**What changed:** Introduced `FAIL_ROUTING_MAP` routing QA/code-review FAIL handoffs to Developer; removed self-rework actions from QA and Reviewer agents; Documentation retains `REWORK`. A 3-way handoff split (needsNew / inProgress / fail) was added for QA/Reviewer.
**Test delta:** +31 tests (436 → 467), including 12 new rework-loop integration tests.
**All pipelines:** PASS on first attempt.

### WP-002 — rework_count Semantics Fix ✅
**What changed:** `at(-1)` check replaces `some()` — `rework_count` now increments only when the *most recent* pipeline of the same type has FAIL status. The [FAIL, PASS] → no-increment edge case is now covered with a dedicated test.
**Test delta:** Consistent at 437 → 467.
**All pipelines:** PASS on first attempt.

### WP-003 — Synthesis Lifecycle Gate ✅
**What changed:** Added `synthesis_generated?: boolean` to `RootIndexSchema` and a new `ledger_complete_synthesis` MCP tool. `GENERATE_SYNTHESIS` returns `WAIT` after the flag is set, and self-healing no longer transitions a project to COMPLETE until synthesis has run.
**Test delta:** +14 tests (12 in new `synthesis-terminal.test.ts`).
**Notable debt:** `completeSynthesis` writes without `proper-lockfile` guard — acceptable at single-agent terminal step but noted for future hardening.
**All pipelines:** PASS on first attempt.

### WP-004 — Cascade Dependency Reblock ✅
**What changed:** `propagateDependencyReblock()` cascades BLOCKED state to READY/IN_PROGRESS dependents when a COMPLETE WP is reopened (COMPLETE → IN_PROGRESS).
**Rework:** Code review FAIL × 2 — `oldStatus` was captured inside the `updateWorkPackageWithSync` callback but referenced outside (TypeScript TS2304 / runtime ReferenceError). Hoisting to `let oldStatus` in outer scope resolved it.
**Note:** Tests used an `inline simulateReblock` replica, which masked the scoping bug. An integration test calling the actual MCP tool with COMPLETE→IN_PROGRESS was added after review.
**Final state:** All pipelines PASS.

### WP-005 — Infrastructure Hardening ✅
**What changed (3 fixes):**
- Lock retry: `5 → 50` retries, covering the 10 s stale timeout
- `now()`: switched to `getUTC*()` methods with trailing `Z` (ISO 8601 UTC)
- WP ID regex: `\d{3}` → `\d{3,}` (supports WP-1000+)
**Test delta:** +3 tests.
**All pipelines:** PASS on first attempt.

### WP-006 — CANCELLED Status + Rework Circuit Breaker ✅
**What changed:**
- `CANCELLED` added as a terminal WP status (PM-only transitions from READY/IN_PROGRESS/BLOCKED)
- Rework circuit breaker: `MAX_REWORK_COUNT = 5`; `start_pipeline` rejects when limit reached; `BLOCK_FOR_REWORK_LIMIT` action surfaced to Developer
**Rework:** QA FAIL — `CANCELLED` missing from `UpdateWorkPackageStatusSchema` z.enum, causing Zod to reject it at the API boundary despite handler logic being correct. Code review FAIL — 5 locations in `workflow-helpers.ts` and `project-lifecycle.ts` that check terminal status were missed (see Gold Nuggets).
**Final state:** All pipelines PASS after 2-step rework.

### WP-007 — Self-Healing & Documentation FAIL Routing ✅
**What changed:**
- `computeHealedStatus()` extracted as a pure function — separates computation from I/O
- `get_project_status` now only writes to disk when `needsWrite === true`; corrective write uses `withLock` + fresh re-read
- Documentation FAIL routing clarified in spec §8.1 (self-rework with technical-blocker escalation path)
**Test delta:** +5 tests for `computeHealedStatus`.
**All pipelines:** PASS on first attempt.

### WP-008 — Spec Audit, Ambiguity Resolution & Manifest Sync ✅
**What changed:** All 8 spec ambiguities (A-1 through A-8) resolved with normative language:
- A-3: `acceptance_criteria_updates` unknown criterion → append (code fix added)
- A-4: `acceptance_criteria` minimum 1 item enforced via Zod `.min(1)`
- A-6: override authorization documented (PM/assignee only — see open gap below)
- A-1, A-2, A-5, A-7, A-8: spec-only clarifications
**Rework:** QA FAIL — two unescaped backticks in `help-content.ts` template literals caused `tsc` syntax errors and silently corrupted `dist/tools/help-content.js` (see Gold Nuggets).
**Final state:** All pipelines PASS after 1-step rework.

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Work packages completed | 8 / 8 |
| Total tests (final) | 489 |
| Tests failed | 0 |
| Pipeline rework events | 5 (WP-004 ×2, WP-006 ×2, WP-008 ×1) |
| New test files | 5 |
| Source files modified | ~30+ (across src/, tests/, docs/) |
| New MCP tools | 1 (`ledger_complete_synthesis`) |
| Spec sections updated | 20+ (§6, §7, §8, §9, §11, §12, §13, §14, §15) |

---

## Failed Pipeline Log

| WP | Pipeline | Failure Cause |
|----|----------|---------------|
| WP-004 | code-review (×2) | `oldStatus` scoping bug — captured inside callback, referenced outside |
| WP-006 | qa | `CANCELLED` missing from `UpdateWorkPackageStatusSchema` z.enum |
| WP-006 | code-review | 5 terminal-status check sites missed during CANCELLED propagation |
| WP-008 | qa | Unescaped backticks in `help-content.ts` — tsc build failure + corrupted dist |

---

## Strategic Recommendations (Gold Nuggets)

### GN-1 — Extract `isTerminalStatus()` as a Shared Utility (HIGH PRIORITY)

**Source:** Reviewer project comment + WP-006 code-review FAIL

The codebase has at least 4 independent implementations of "is this status terminal?":
- `isTerminal` closure in `work-package.ts`
- `status !== 'COMPLETE'` in `project-lifecycle.ts`
- `hasDependencyBlocked` and `isBlockedByDependencies` in `workflow-helpers.ts`

Adding `CANCELLED` required updating all of these, and 5 locations were missed, resulting in a code-review FAIL. A single `isTerminalStatus(status: WorkPackageStatus): boolean` function in `validators.ts` or `workflow-helpers.ts` would reduce this to a single-point-of-change for any future terminal status addition.

**Recommended action:** Refactor all inline terminal-status checks to use a shared `isTerminalStatus()` utility before adding any further status values.

---

### GN-2 — Add `noEmitOnError: true` to `mcp-server/tsconfig.json` (HIGH PRIORITY)

**Source:** Reviewer project comment + WP-008 QA FAIL

TypeScript's `noEmitOnError` defaults to `false`, meaning `tsc` emits JS output even on syntax errors. In WP-008, two unescaped backticks in `help-content.ts` caused tsc to emit **garbled JS**. The `npm test` suite (using Vitest/tsx) never invokes `tsc` and therefore reported all 489 tests as passing while the running MCP server was returning malformed help text.

**Recommended action:** Add `"noEmitOnError": true` to `mcp-server/tsconfig.json`, or introduce a `tsc --noEmit` step before `npm test` in `package.json`. Either closes this class of silent build corruption permanently.

---

### GN-3 — Hoist Convention for `updateWorkPackageWithSync` Callers (MEDIUM PRIORITY)

**Source:** Reviewer project comment + WP-004 code-review FAIL (×2)

`updateWorkPackageWithSync` receives a callback that captures pre-mutation state. Any variable holding pre-mutation state that is needed *after* the callback must be declared in the outer scope (`let`) and assigned inside the callback. When declared with `const` inside the callback, the variable is invisible at the call site, producing a TypeScript TS2304 error (runtime ReferenceError in JS).

**Recommended action:** Add a code convention note to `mcp-server/AGENTS.md` and `constraints.md` explicitly requiring outer-scope hoisting of any pre-mutation state captured in `updateWorkPackageWithSync` callbacks. Consider a linting rule or a typed wrapper API that forces callers to declare the "capture" variables externally.

---

### GN-4 — `completeSynthesis` Needs File Lock (LOW PRIORITY)

**Source:** WP-003 code-review comment

`completeSynthesis` reads and writes the root index directly (`readRootIndex` + `writeRootIndex`) without `proper-lockfile` protection. The project constraints mandate atomic writes with the lock library. Current risk is negligible (Synthesis is a single-agent terminal step), but if multi-agent orchestration ever allows concurrent synthesis calls, this could produce a lost-update race on the root index.

**Recommended action:** Wrap `completeSynthesis` root-index mutation in a `withLock()` call to comply with the atomic-write constraint established in `mcp-server/docs/agents/project-manifest/constraints.md`.

---

### GN-5 — Override Flag Authorization Gap (MEDIUM PRIORITY)

**Source:** WP-008 implementation comment (A-6)

The spec now documents that only the Project Manager or current assignee may pass `override: true` to `ledger_claim_work_package`. The code enforces the cross-agent assignment guard (rejects cross-agent claims *without* `override`) but does not validate that the caller invoking `override: true` is actually a PM or the assignee. Any agent can currently bypass the assignment check by supplying `override: true`.

**Recommended action:** Add an identity-check guard: if `override: true`, verify that `agent` equals either the current `assigned_to` or `"Project Manager"`. This closes the authorization gap described in spec §6.4.

---

### GN-6 — Test Infrastructure: Prefer Actual MCP Tool over Inline Replicas (LOW PRIORITY)

**Source:** WP-004 coverage-gap comment

`cascade-reblock.test.ts` originally used an inline `simulateReblock()` function that replicated the production reblock logic but did not call the actual `updateWorkPackageStatus` tool. This made the `oldStatus` scoping bug invisible to the test suite. The pattern of building test replicas to avoid MCP tool call overhead can mask call-site integration bugs.

**Recommended action:** For functions triggered at the call site of another tool (such as cascade propagators), write at least one test that exercises the full end-to-end path through the MCP tool, in addition to any unit tests on the extracted function itself.

---

## Next Steps for Planner / Project Manager

1. **Immediate (before next feature cycle):**
   - Add `"noEmitOnError": true` to `mcp-server/tsconfig.json` *(GN-2)*
   - Extract `isTerminalStatus()` shared utility and replace all inline checks *(GN-1)*
   - Fix `override: true` authorization in `ledger_claim_work_package` *(GN-5)*

2. **Short-term (next sprint):**
   - Add hoisting convention to `AGENTS.md` + `constraints.md` for `updateWorkPackageWithSync` *(GN-3)*
   - Add `withLock()` to `completeSynthesis` *(GN-4)*
   - Establish a policy requiring at least one end-to-end MCP tool test per cascade propagator *(GN-6)*

3. **Backlog:**
   - Consider a `tsc --noEmit` pre-test step in `package.json` as a belt-and-suspenders check
   - Monitor `workflow-batch-actions.ts` `buildBatchNextSteps` complexity — the merged REWORK case grows brittle as more action types are added; consider strategy-map refactor
   - Audit `workflow-handoff.ts` QA/Reviewer 3-way split for extraction as a shared helper if a fourth pipeline type is introduced

---

## Project Status

**All 8 work packages: COMPLETE**
**Project ledger status: COMPLETE**
