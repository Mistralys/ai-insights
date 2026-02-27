# Plan

## Summary

Fix 10 issues (3 critical, 4 moderate, 3 minor) identified in the [workflow specification audit](../../workflow-specification-audit.md). The work spans three layers: the specification document itself ([workflow-specification.md](../../workflow-specification.md)), the MCP server TypeScript implementation (`mcp-server/`), and the Python orchestrator (`orchestrator/`). All fixes must keep these three layers consistent.

## Architectural Context

The workflow system has three authoritative layers that must stay synchronized:

1. **Specification** — [docs/agents/workflow-specification.md](../../workflow-specification.md) — the language-agnostic behavioral contract.
2. **MCP Server** — TypeScript implementation in `mcp-server/src/`:
   - Self-healing logic: [src/tools/project-lifecycle.ts](../../../../mcp-server/src/tools/project-lifecycle.ts) → `computeHealedStatus()`
   - Dependency propagation: [src/tools/work-package.ts](../../../../mcp-server/src/tools/work-package.ts) → `propagateDependencyUnblock()`
   - Handoff routing: [src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts) → `getDocumentationHandoff()`, `getPlannerHandoff()`, `buildHandoffResponse()`
   - Status validators: [src/schema/validators.ts](../../../../mcp-server/src/schema/validators.ts) → `isValidStatusTransition()`, `canStartWorkPackage()`
3. **Orchestrator** — Python implementation in `orchestrator/src/`:
   - Supervisor routing: [src/supervisor.py](../../../../orchestrator/src/supervisor.py) → `supervisor_node()`, `_route_for_wp()`

Existing test suites:
- [mcp-server/tests/tools/project-lifecycle.test.ts](../../../../mcp-server/tests/tools/project-lifecycle.test.ts)
- [mcp-server/tests/tools/work-package.test.ts](../../../../mcp-server/tests/tools/work-package.test.ts)
- [mcp-server/tests/tools/workflow-handoff.test.ts](../../../../mcp-server/tests/tools/workflow-handoff.test.ts)
- [orchestrator/tests/test_supervisor.py](../../../../orchestrator/tests/test_supervisor.py)

## Approach / Architecture

Each audit finding is addressed as a discrete, independently testable change. Fixes are grouped into four work packages by affected subsystem:

- **WP-001: Spec-only fixes** — editorial corrections and clarifications in the specification document that require no code changes.
- **WP-002: Self-healing & propagation** — critical logic fixes in the MCP server's `computeHealedStatus` and `propagateDependencyUnblock` functions, plus corresponding spec updates.
- **WP-003: Handoff routing** — fixes to `getDocumentationHandoff`, `getPlannerHandoff`, `buildHandoffResponse`, including adding a `READY_FOR_PM` handoff status.
- **WP-004: Orchestrator supervisor** — fix the "all terminal" check in the Python supervisor; define `stage_success`.

WP-001 has no dependencies. WP-002 and WP-003 each depend on WP-001 (spec must be updated first). WP-004 depends on WP-001.

## Rationale

- **Spec-first approach**: The specification is the authoritative source of truth per the AGENTS.md contract. Fixing the spec first ensures code changes have a clear, reviewed target.
- **Discrete WPs**: Each WP touches a different file cluster, enabling parallel implementation/review where possible.
- **Conservative scope**: Issue #10 (vacuous unblocking for manual transitions) is addressed as documentation only, not a code change, because adding a runtime guard against manual PM transitions introduces friction that may be unwanted.

## Detailed Steps

### WP-001: Specification Document Fixes (audit issues #4, #5, #7, #8, #9, #10)

1. **§11.1 — Fix "all COMPLETE" to "all terminal" (issue #4)**
   - In the Supervisor Routing Algorithm decision tree, change `IF all WPs are COMPLETE` to `IF all WPs are terminal (COMPLETE or CANCELLED)`.

2. **§15.5 — Clarify auto-handoff eligibility condition (issue #5)**
   - Replace "Project status is not COMPLETE, BLOCKED, or IN_PROGRESS" with "Handoff status is not COMPLETE, BLOCKED, IN_PROGRESS, or WAIT (i.e., only READY_FOR_* handoff statuses are eligible for auto-handoff)."
   - Add a note: "This refers to the handoff status value returned by `get_handoff_status`, NOT the `ProjectStatus` enum."

3. **§11.3 — Define `stage_success` (issue #7)**
   - Add a new subsection §11.3.1 defining: "A stage is considered successful (`stage_success = true`) if the agent node completed without raising an error AND at least one pipeline was completed with status `PASS` during the agent's turn. If the agent raised an error, produced no pipeline completions, or only produced `FAIL` pipeline completions, `stage_success = false`."

4. **§19.2 — Remove editorial note (issue #8)**
   - Remove the line `└─ Wait — this is wrong. The Developer would start a new implementation pipeline.` from the QA Failure walkthrough.
   - Replace with a corrected note explaining that since the most recent implementation was PASS, `rework_count` is not incremented on the new pipeline.

5. **§20.7 — Add explicit Planner fallthrough (issue #9)**
   - Add a Planner subsection to §20 (after §20.1): "Planner: The Planner agent does not participate in pipeline-level routing. If WPs exist, it returns WAIT. The pre-routing checks (§20.1) handle the Planner's primary scenarios."

6. **§6.2 / §12.2 — Document non-dependency blocker edge case (issue #10)**
   - Add a note to §6.2: "When a WP is blocked for a non-dependency reason (e.g., `type: "decision"`) and has no WP dependencies, the condition 'all dependencies COMPLETE or CANCELLED' is vacuously true. The PM should ensure `blocked_by` is explicitly cleared via a manual status transition, not rely on automatic unblocking."

7. **§14.1 — Update healing rule documentation (issue #1)**
   - Update the pseudocode to match the fix in WP-002: generalize Rule 3 to cover both `IN_PROGRESS` and `READY`.

8. **§12.2 — Update propagation documentation (issue #3)**
   - Add a guard: "Before transitioning a BLOCKED WP to READY, check that `blocked_by.type == 'dependency'` or `blocked_by` is absent. WPs blocked for non-dependency reasons (decision, external, technical) are skipped even if all WP dependencies are satisfied."

9. **§21.3 — Update Planner handoff documentation (issue #6)**
   - Add `READY_FOR_PM` to the handoff status table in §21.1.
   - Update §21.3 to route `IF no WPs exist → READY_FOR_PM` and `IF any WP is READY or IN_PROGRESS → READY_FOR_DEVELOPER`.

10. **§21.8 — Update Documentation handoff documentation (issue #2)**
    - Correct §21.8 to note that Documentation failure routes `IN_PROGRESS` (self-rework), not `READY_FOR_DEVELOPER`. Add explicit note: "Unlike QA and Reviewer, Documentation performs self-rework per the Fail Routing Map (§9.3). The 'mirrors Reviewer' description applies only to the PASS and dependency-blocked branches, NOT the FAIL branch."

### WP-002: Self-Healing & Dependency Propagation Fixes (audit issues #1, #3)

**Depends on:** WP-001

11. **Fix `computeHealedStatus` — add READY → COMPLETE healing path (issue #1)**
    - File: `mcp-server/src/tools/project-lifecycle.ts`, function `computeHealedStatus()`
    - Current code has `if (rootIndex.status === 'IN_PROGRESS' && pendingWps === 0 && totalWps > 0)` as the only path to COMPLETE.
    - Generalize to: `if ((rootIndex.status === 'IN_PROGRESS' || rootIndex.status === 'READY') && pendingWps === 0 && totalWps > 0)`. When matched, set `healedStatus = rootIndex.synthesis_generated ? 'COMPLETE' : rootIndex.status` (don't change to IN_PROGRESS when currently READY and synthesis is false).
    - Also add a fallthrough for the BLOCKED branch: when no WP is BLOCKED and `pendingWps === 0 && totalWps > 0 && synthesis_generated`, heal to COMPLETE instead of leaving status unchanged.

12. **Fix `propagateDependencyUnblock` — respect non-dependency blockers (issue #3)**
    - File: `mcp-server/src/tools/work-package.ts`, function `propagateDependencyUnblock()`
    - After the `canStartWorkPackage` check passes, add a guard: if `wpDetail.blocked_by` exists and `wpDetail.blocked_by.type !== 'dependency'`, skip this WP (do not transition to READY).
    - This preserves `external`, `decision`, and `technical` blockers even when all WP dependencies are satisfied.

13. **Add unit tests for both fixes**
    - File: `mcp-server/tests/tools/project-lifecycle.test.ts` — add test: "heals READY to COMPLETE when all WPs terminal and synthesis generated".
    - File: `mcp-server/tests/tools/project-lifecycle.test.ts` — add test: "heals BLOCKED to COMPLETE when no WPs blocked, all terminal, synthesis generated".
    - File: `mcp-server/tests/tools/work-package.test.ts` — add test: "propagateDependencyUnblock preserves external blockers even when deps satisfied".
    - File: `mcp-server/tests/tools/work-package.test.ts` — add test: "propagateDependencyUnblock clears dependency blockers normally".

### WP-003: Handoff Routing Fixes (audit issues #2, #5, #6)

**Depends on:** WP-001

14. **Fix `getDocumentationHandoff` — FAIL routes to self, not Developer (issue #2)**
    - File: `mcp-server/src/tools/workflow-handoff.ts`, function `getDocumentationHandoff()`
    - The `needsWork` branch (around line 725) currently returns `IN_PROGRESS` — this is actually **correct** in the implementation. The spec was wrong, not the code. Verify this by reading the existing code: the `needsWork` check includes both "no documentation pipeline" and "FAIL documentation pipeline" and routes to `IN_PROGRESS` with the message "still need documentation or rework."
    - **Action**: Verify that the existing code matches the corrected spec. If it does, this is a spec-only fix (already handled in WP-001, step 10). Add a regression test to lock in the correct behavior.

15. **Fix auto-handoff eligibility — use handoff status, not project status (issue #5)**
    - File: `mcp-server/src/tools/workflow-handoff.ts`, function `buildHandoffResponse()`
    - Current code (line ~170): `status !== 'COMPLETE' && status !== 'BLOCKED' && status !== 'IN_PROGRESS'` — the `status` variable here is already the **handoff** status, not the project status. The code is correct; only the spec was ambiguous.
    - **Action**: Verify the code uses handoff status. Add a code comment clarifying that `status` here is the handoff status value, not `ProjectStatus`. This is primarily a spec fix (WP-001, step 2).

16. **Add `READY_FOR_PM` handoff status and fix Planner handoff (issue #6)**
    - File: `mcp-server/src/tools/workflow-handoff.ts`
    - Update the `nextAgentFromStatus` map to include `READY_FOR_PM: 'Project Manager'`.
    - Update `getPlannerHandoff()`: when `wpDetails.length === 0`, return status `READY_FOR_PM` instead of `WAIT`. This enables auto-handoff from Planner to PM.
    - When WPs exist and are READY/IN_PROGRESS, keep the existing `READY_FOR_DEVELOPER` routing.
    - File: `mcp-server/src/utils/workflow-helpers.ts` — if there is a list of valid handoff statuses used elsewhere, add `READY_FOR_PM`.

17. **Add/update tests for handoff fixes**
    - File: `mcp-server/tests/tools/workflow-handoff.test.ts` — add test: "Documentation handoff returns IN_PROGRESS when WPs have FAIL documentation pipelines (self-rework)".
    - File: `mcp-server/tests/tools/workflow-handoff.test.ts` — add test: "Planner handoff returns READY_FOR_PM when no WPs exist".
    - File: `mcp-server/tests/tools/workflow-handoff.test.ts` — add test: "auto-handoff is included for READY_FOR_PM status with loaded registry".

### WP-004: Orchestrator Supervisor Fix (audit issue #4, #7)

**Depends on:** WP-001

18. **Fix "all COMPLETE" check to "all terminal" (issue #4)**
    - File: `orchestrator/src/supervisor.py`, function `supervisor_node()`
    - Current code (line ~311): `if all(wp.get("status") == "COMPLETE" for wp in wp_summaries)`
    - Change to: `if all(wp.get("status") in ("COMPLETE", "CANCELLED") for wp in wp_summaries)`
    - Also fix `pending_count` calculation (line ~278): currently `if wp.get("status") != "COMPLETE"` — change to `if wp.get("status") not in ("COMPLETE", "CANCELLED")`.

19. **Define `stage_success` semantics in state and node contracts (issue #7)**
    - File: `orchestrator/src/state.py` — add a docstring to the `stage_success` field explaining when it should be `True` vs `False`.
    - File: `orchestrator/src/nodes/` — in each pipeline node's epilogue, verify that `stage_success` is set based on whether at least one pipeline was completed with PASS.
    - This is primarily documentation + verification; ensure existing nodes conform.

20. **Add tests for supervisor terminal-status fix**
    - File: `orchestrator/tests/test_supervisor.py` — add test: "routes to synthesis when all WPs are mix of COMPLETE and CANCELLED".
    - File: `orchestrator/tests/test_supervisor.py` — add test: "pending_count excludes CANCELLED WPs".

## Dependencies

```
WP-001 (spec fixes) ← no dependencies
WP-002 (self-healing & propagation) ← depends on WP-001
WP-003 (handoff routing) ← depends on WP-001
WP-004 (orchestrator supervisor) ← depends on WP-001
```

WP-002, WP-003, WP-004 can be implemented in parallel once WP-001 is complete.

## Required Components

### Existing files to modify:
- `docs/agents/workflow-specification.md` — specification document (WP-001)
- `mcp-server/src/tools/project-lifecycle.ts` — `computeHealedStatus()` (WP-002)
- `mcp-server/src/tools/work-package.ts` — `propagateDependencyUnblock()` (WP-002)
- `mcp-server/src/tools/workflow-handoff.ts` — `getDocumentationHandoff()`, `getPlannerHandoff()`, `buildHandoffResponse()`, `nextAgentFromStatus` (WP-003)
- `orchestrator/src/supervisor.py` — `supervisor_node()` (WP-004)

### Existing test files to extend:
- `mcp-server/tests/tools/project-lifecycle.test.ts` (WP-002)
- `mcp-server/tests/tools/work-package.test.ts` (WP-002)
- `mcp-server/tests/tools/workflow-handoff.test.ts` (WP-003)
- `orchestrator/tests/test_supervisor.py` (WP-004)

### New components:
- None. All changes are modifications to existing files.

## Assumptions

- The specification document is the source of truth. Where code and spec disagree, the fix target depends on which one is logically correct (determined during the audit).
- Issue #2 (Documentation handoff FAIL routing): verification during research confirmed the **code is already correct** — the `getDocumentationHandoff` function returns `IN_PROGRESS` for WPs needing documentation work/rework. Only the spec needs correction.
- Issue #5 (auto-handoff eligibility): verification confirmed the **code is already correct** — `buildHandoffResponse` checks the handoff `status` parameter, not the project status. Only the spec and a clarifying comment need updating.
- The `READY_FOR_PM` handoff status (issue #6) is a new addition. It must be registered in the `nextAgentFromStatus` map and referenced in the agent registry for auto-handoff to work.

## Constraints

- All changes must pass existing test suites (`npm test` in `mcp-server/`, `pytest` in `orchestrator/`) before new tests are added.
- The MCP server's STDIO discipline must be preserved — no `console.log` in server code.
- File writes must follow the atomic write pattern (write-to-tmp-then-rename).
- The specification version should be bumped to 1.1.0 after all fixes land.

## Out of Scope

- **Issue #10 runtime guard**: Adding a code-level guard to prevent manual `BLOCKED → READY` transitions when `blocked_by.type != "dependency"` is out of scope. The PM is trusted to manage manual transitions correctly. This is documented as a known edge case.
- **Planner persona changes**: The Planner persona instructions are not updated as part of this plan. The Planner doesn't interact with the ledger, so no code changes are needed there.
- **Changelog entries**: Version bumps and changelog entries for the MCP server and orchestrator are not included in the plan steps; they should be handled during the documentation stage.

## Acceptance Criteria

1. `computeHealedStatus` correctly heals a project from READY to COMPLETE when `pendingWps == 0`, `totalWps > 0`, and `synthesis_generated == true`.
2. `computeHealedStatus` correctly heals a project from BLOCKED to COMPLETE via the same path (BLOCKED → healed away → COMPLETE on next pass).
3. `propagateDependencyUnblock` skips WPs with non-dependency `blocked_by.type` (external, decision, technical) even when all WP dependencies are terminal.
4. `propagateDependencyUnblock` still correctly unblocks WPs with `blocked_by.type == "dependency"` or absent `blocked_by`.
5. `getDocumentationHandoff` returns `IN_PROGRESS` (not `READY_FOR_DEVELOPER`) when WPs have FAIL documentation pipelines.
6. `getPlannerHandoff` returns `READY_FOR_PM` when no WPs exist, enabling auto-handoff to PM.
7. `buildHandoffResponse` includes `auto_handoff` payload for `READY_FOR_PM` status when registry is loaded.
8. The orchestrator supervisor routes to synthesis when all WPs are a mix of COMPLETE and CANCELLED.
9. The orchestrator `pending_count` excludes CANCELLED WPs.
10. The specification document is internally consistent — all 10 audit findings are addressed.
11. All existing tests continue to pass.
12. New regression tests cover each code fix.

## Testing Strategy

- **Unit tests (MCP server)**: Each code fix in `project-lifecycle.ts`, `work-package.ts`, and `workflow-handoff.ts` gets targeted unit tests using the existing `createTempStore` / `cleanupTempStore` test helpers. Run with `npm test` from `mcp-server/`.
- **Unit tests (orchestrator)**: The supervisor fix gets targeted tests using mocked MCP tools in `test_supervisor.py`. Run with `pytest` from `orchestrator/`.
- **Regression coverage**: Each test explicitly reproduces the failure scenario from the audit to prevent regressions.
- **Spec review**: The specification document changes should be manually reviewed for internal consistency before code changes begin.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`READY_FOR_PM` breaks existing auto-handoff consumers** | The change is additive — no existing status values are modified. Consumers that don't recognize `READY_FOR_PM` will simply not auto-handoff (safe degradation). |
| **Self-healing fix causes unexpected project completion** | The fix is narrowly scoped: only fires when `pendingWps == 0 AND totalWps > 0 AND synthesis_generated`. These conditions can only be true when the project is genuinely complete. Add a test that verifies READY is preserved when synthesis is not generated. |
| **Non-dependency blocker guard breaks existing workflows** | The guard is conservative: it only *skips* WPs that have a non-dependency blocker type. WPs without a `blocked_by` field or with `type: "dependency"` are unaffected. Existing test suite validates normal unblocking. |
| **Orchestrator `CANCELLED` handling introduces unexpected synthesis runs** | The fix makes the supervisor explicitly route to synthesis for CANCELLED WPs, replacing an accidental fallthrough that already produced the same result. Net behavior is unchanged; test confirms. |
