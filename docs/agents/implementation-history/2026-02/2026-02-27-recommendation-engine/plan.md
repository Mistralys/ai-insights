# Plan

## Summary

Phase 4 rewrites the `getNextAction` recommendation engine to fully comply with §14.1–§14.13 and related edge-case sections of the Agent Workflow Specification. The current implementation is structurally sound but has four categories of defects: (1) missing action types — nine new action strings must be added across all roles; (2) missing priorities — every role-specific function is missing one or more priority steps from the spec's ordered algorithm; (3) wrong priority ordering — Developer's REWORK (direct) and IMPLEMENT checks are inverted; Documentation's REWORK(self) is positioned after WRITE_DOCS instead of before; (4) PM action logic is almost entirely missing and uses a non-spec action name (`RESOLVE_BLOCKERS` → `UNBLOCK_WP`). Phases 1–3 have delivered all algorithmic building blocks (`checkRevalidationGuard`, `hasDownstreamReengagedSince`, `hasNewUpstreamPassSince`, per-pipeline `rework_counts`, `auto_cancelled`, `mostRecentEffectivePipeline`). Phase 4 is therefore a **wiring and completeness** phase: connect existing helpers to call sites, fill missing priorities, correct orderings, and expand the test suite.

---

## Architectural Context

### Sub-project scope

All changes are confined to `mcp-server/src/tools/workflow-next-action.ts` and `mcp-server/src/utils/workflow-helpers.ts`. No new files are required. No changes to `src/schema/`, `src/storage/`, or the MCP registration layer.

### Relevant specification sections

| Section | Document | Topic |
|---------|----------|-------|
| §14.1 | `handoff-and-recommendations.md` | Common pre-checks |
| §14.1.2 | `handoff-and-recommendations.md` | PM action logic (5 priorities) |
| §14.2 | `handoff-and-recommendations.md` | Developer action logic (7 priorities + 5b) |
| §14.3 | `handoff-and-recommendations.md` | QA action logic (7 priorities + 1b) |
| §14.4 | `handoff-and-recommendations.md` | Reviewer action logic (7 priorities + 1b) |
| §14.5 | `handoff-and-recommendations.md` | Documentation action logic (7 priorities + 1b) |
| §14.6 | `handoff-and-recommendations.md` | `hasNewUpstreamPassSince` algorithm |
| §14.11 | `handoff-and-recommendations.md` | `mostRecentEffectivePipeline` |
| §14.13 | `handoff-and-recommendations.md` | `hasDownstreamReengagedSince` |
| §21.33 | `edge-cases.md` | `CONTINUE_PIPELINE` semantics |
| §21.34 | `edge-cases.md` | `FINALIZE_WP` gap |
| §21.40 | `edge-cases.md` | `REVIEW_ABANDONED` detection |
| §21.52 | `edge-cases.md` | `WAIT_FOR_DOWNSTREAM` rationale |
| §21.53 | `edge-cases.md` | Upstream circuit-breaker propagation |
| Appendix B | `walkthrough.md` | Canonical action-type enum |

### Confirmed current state (post Phase 3)

**Algorithms already available in `src/utils/workflow-helpers.ts`:**
- `hasDownstreamReengagedSince(pipelines, upstreamType)` — temporal guard for Developer priority 5 vs 5b
- `hasNewUpstreamPassSince(pipelines, upstreamType, downstreamType)` — re-engagement detection (auto_cancelled-aware, >= comparison)
- `isMostRecentPipelineFail(pipelines, type)` — auto_cancelled-aware most-recent FAIL check
- `extractStalePipelineAction(wp, type)` — stale pipeline detection (>24h)
- `hasDependencyBlocked(wp, rootIndex)` — dependency-blocked exclusion
- `mostRecentEffectivePipeline(wp)` — most recent non-auto_cancelled pipeline (added Phase 2)
- `MAX_REWORK_COUNT` — circuit breaker constant

**Schema already in place (Phase 1):**
- `rework_counts: Record<string, number>` on `WorkPackageDetail`
- `auto_cancelled: boolean | undefined` on `Pipeline`
- `status_changed_at: string | undefined` on `WorkPackageDetail`

**Test baseline:** 621+ tests passing (post Phase 3), 0 TypeScript errors.

### Gap audit — current vs spec

The following table documents every confirmed gap in `workflow-next-action.ts` (source-read 2026-02-27):

| Role | Priority | Gap Type | Current Behaviour | Spec Behaviour |
|------|----------|----------|-------------------|----------------|
| PM | ALL | MISSING | Returns generic `RESOLVE_BLOCKERS` for any BLOCKED WP, then WAIT | 5-priority algorithm: UNBLOCK_WP (non-dep blockers only), REVIEW_REWORK_LIMIT, REVIEW_STALE, REVIEW_ABANDONED, REPAIR_ORPHAN_BLOCKED |
| Developer | 3 | MISSING | Jumps from stale-check to IMPLEMENT/REWORK | `CONTINUE_PIPELINE` for active non-stale implementation pipeline |
| Developer | 4 vs 6 | WRONG ORDER | `IMPLEMENT` (no-pipeline) checked before `REWORK` (direct FAIL) | REWORK(direct) is priority 4; IMPLEMENT is priority 6 |
| Developer | 5 | MISSING GUARD | Downstream FAIL always routes to REWORK without temporal check | `hasDownstreamReengagedSince` guard — only REWORK if downstream re-engaged since latest impl PASS |
| Developer | 5b | MISSING | No `WAIT_FOR_DOWNSTREAM` action | Emit `WAIT_FOR_DOWNSTREAM` when downstream-fail exists but developer already re-passed impl |
| Developer | 1 | COMPAT ONLY | Uses `rework_counts?.implementation ?? rework_count` | Should use `rework_counts.implementation` (Phase 1 migration complete) |
| QA | 1 | MISSING | No rework-limit check | `BLOCK_FOR_REWORK_LIMIT` when `rework_counts.qa >= MAX_REWORK_COUNT` |
| QA | 1b | MISSING | No upstream circuit-breaker check | `WAIT_FOR_UPSTREAM_REWORK_LIMIT` when `rework_counts.implementation >= MAX_REWORK_COUNT` |
| QA | 3 | MISSING | No active-pipeline check | `CONTINUE_PIPELINE` for active non-stale QA pipeline |
| QA | 4 vs 6 | MERGED | `hasNewUpstreamPassSince` used for both first-run and re-engagement | Priority 4 (re-engagement) requires "at least one prior QA pipeline" guard; priority 6 is first-run only |
| QA | 5 | WRONG NAME | Returns `WAIT` with message | Should return `WAIT_FOR_REWORK` action type |
| QA | 7 | MISSING | No CLAIM_WP for READY WPs assigned to QA | `CLAIM_WP` for READY WPs with `assigned_to == "QA"` |
| Reviewer | 1 | MISSING | No rework-limit check | `BLOCK_FOR_REWORK_LIMIT` when `rework_counts["code-review"] >= MAX_REWORK_COUNT` |
| Reviewer | 1b | MISSING | No upstream circuit-breaker check | `WAIT_FOR_UPSTREAM_REWORK_LIMIT` when `implementation` or `qa` rework count >= MAX |
| Reviewer | 3 | MISSING | No active-pipeline check | `CONTINUE_PIPELINE` for active non-stale code-review pipeline |
| Reviewer | 4 vs 6 | MERGED | Same as QA | Same fix: add "at least one prior code-review pipeline" guard for priority 4 |
| Reviewer | 5 | WRONG NAME | Returns `WAIT` with message | Should return `WAIT_FOR_REWORK` action type |
| Reviewer | 7 | MISSING | No CLAIM_WP for Reviewer | `CLAIM_WP` for READY WPs with `assigned_to == "Reviewer"` |
| Documentation | 1 | MISSING | No rework-limit check | `BLOCK_FOR_REWORK_LIMIT` when `rework_counts.documentation >= MAX_REWORK_COUNT` |
| Documentation | 1b | MISSING | No upstream circuit-breaker check | `WAIT_FOR_UPSTREAM_REWORK_LIMIT` when impl, qa, or code-review rework count >= MAX |
| Documentation | 3 | MISSING | No active-pipeline check | `CONTINUE_PIPELINE` for active non-stale documentation pipeline |
| Documentation | 4 vs 5 | WRONG ORDER | WRITE_DOCS checked before REWORK(self) | REWORK(self) is priority 4; WRITE_DOCS is priority 6 |
| Documentation | 5 | WRONG NAME/COND | `MARK_COMPLETE` (non-spec) — checks all 4 pipelines PASS, no freshness/criteria check | `FINALIZE_WP` — docs PASS + all criteria met + freshness check (doc PASS post-dates impl start) |
| Documentation | 5b | MISSING | No UPDATE_CRITERIA action | `UPDATE_CRITERIA` — docs PASS + freshness OK but not all criteria met |
| Documentation | 7 | MISSING | No CLAIM_WP for Documentation | `CLAIM_WP` for READY WPs with `assigned_to == "Documentation"` |

---

## Approach / Architecture

The existing per-role function structure (`getProjectManagerAction`, `getDeveloperAction`, `getQaAction`, `getReviewerAction`, `getDocumentationAction`) is retained. Each function is rewritten in priority order as a single sequential switch-case equivalent (top-down early returns), making the priority ordering explicit and auditable against the spec. No new exported functions are added — the helper `mostRecentEffectivePipeline` already exists in `workflow-helpers.ts`.

**Helper needed:**

One utility is absent from the current helpers: `isActivePipeline(wp, type)` — returns true if the WP has an IN_PROGRESS pipeline of the given type that is NOT stale (i.e., `extractStalePipelineAction` returns null). This is needed by the `CONTINUE_PIPELINE` priority (§21.33) for all four pipeline-owning roles. It should be added to `workflow-helpers.ts` alongside `extractStalePipelineAction` for symmetry.

**Work package decomposition strategy:**

Work packages are ordered by role complexity and inter-dependency. PM is self-contained; Developer has the most novel logic (temporal guards); QA and Reviewer share the same pattern and can be done together; Documentation introduces two new action types (FINALIZE_WP, UPDATE_CRITERIA). Tests are bundled with each WP rather than deferred to a separate test-only WP.

---

## Rationale

- **Per-function rewrite rather than patch:** The current functions have structural ordering errors (IMPLEMENT before REWORK, WRITE_DOCS before REWORK) that cannot be safely fixed by inserting missing cases. A clean rewrite with explicit spec-aligned priority ordering is less error-prone and easier to audit.
- **`WAIT_FOR_REWORK` as a named action type:** The spec (Appendix B) lists `WAIT_FOR_REWORK` as a distinct action. Keeping it as a generic `WAIT` obscures the reason from calling agents and from auto-handoff orchestration, which may inspect the action type for routing decisions.
- **`CONTINUE_PIPELINE` before rework/new-work:** Per §21.33, an agent with active in-progress work should finish the current pipeline before context-switching. Without this check, an agent that calls `getNextAction` mid-pipeline might receive a REWORK recommendation for a different WP and start a conflicting second pipeline.
- **PM rewrite:** The current PM function is a stub (any BLOCKED WP returns RESOLVE_BLOCKERS). The full 5-priority PM algorithm is critical for auto-handoff correctness in stalled workflows (REVIEW_ABANDONED, REPAIR_ORPHAN_BLOCKED).

---

## Detailed Steps

1. **Add `isActivePipeline` helper to `workflow-helpers.ts`** — returns true for IN_PROGRESS non-stale pipelines of a given type; used by CONTINUE_PIPELINE logic across all four pipeline-owning roles.

2. **Rewrite `getProjectManagerAction`** — implement the 5-priority algorithm:
   - Priority 1: UNBLOCK_WP — BLOCKED WP with `blocked_by.type` in `["decision", "external", "technical"]`
   - Priority 2: REVIEW_REWORK_LIMIT — any WP has any `rework_counts[*] >= MAX_REWORK_COUNT`
   - Priority 3: REVIEW_STALE — any IN_PROGRESS WP with stale pipeline (via `extractStalePipelineAction`)
   - Priority 3b: REVIEW_ABANDONED — IN_PROGRESS WP with no IN_PROGRESS pipeline, using `mostRecentEffectivePipeline` to determine last activity; grace period via `status_changed_at` or fallback to `STALE_PIPELINE_HOURS`
   - Priority 3c: REPAIR_ORPHAN_BLOCKED — BLOCKED WP with `blocked_by.type == "dependency"` or null `blocked_by` where `canStartWorkPackage` returns allowed
   - Priority 4 / fallback: WAIT

3. **Rewrite `getDeveloperAction`** — correct priority order and add missing steps:
   - Priority 1: BLOCK_FOR_REWORK_LIMIT (`rework_counts.implementation >= MAX_REWORK_COUNT`)
   - Priority 2: RESUME_OR_CANCEL (stale implementation pipeline — existing logic, keep)
   - Priority 3: CONTINUE_PIPELINE (active non-stale implementation pipeline — **new**)
   - Priority 4: REWORK (direct — most recent implementation is FAIL — move above IMPLEMENT)
   - Priority 5: REWORK (downstream-triggered — most recent qa or code-review FAIL AND `hasDownstreamReengagedSince("implementation")`) — add temporal guard
   - Priority 5b: WAIT_FOR_DOWNSTREAM (downstream FAIL but temporal guard false — **new**)
   - Priority 6: IMPLEMENT (no implementation pipeline yet — was priority ~2 in current code)
   - Priority 7: CLAIM_WP (READY WPs unassigned or assigned to Developer)

4. **Rewrite `getQaAction`** — full 7+1b priority algorithm:
   - Priority 1: BLOCK_FOR_REWORK_LIMIT (`rework_counts.qa >= MAX_REWORK_COUNT`) — **new**
   - Priority 1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (`rework_counts.implementation >= MAX_REWORK_COUNT`) — **new**
   - Priority 2: RESUME_OR_CANCEL (stale qa pipeline — existing logic, keep)
   - Priority 3: CONTINUE_PIPELINE (active non-stale qa pipeline — **new**)
   - Priority 4: RUN_QA re-engagement — prior qa pipeline exists (excluding auto-cancelled) AND `hasNewUpstreamPassSince("implementation", "qa")` — split from current merged check
   - Priority 5: WAIT_FOR_REWORK (most recent qa FAIL AND NOT re-engagement) — **rename** WAIT → WAIT_FOR_REWORK
   - Priority 6: RUN_QA first-run — PASS implementation, no qa pipeline yet
   - Priority 7: CLAIM_WP — READY WP with `assigned_to == "QA"` — **new**

5. **Rewrite `getReviewerAction`** — same pattern as QA mirrored for `code-review`:
   - Priority 1: BLOCK_FOR_REWORK_LIMIT (`rework_counts["code-review"] >= MAX_REWORK_COUNT`)
   - Priority 1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (`implementation` or `qa` rework count >= MAX)
   - Priority 2: RESUME_OR_CANCEL
   - Priority 3: CONTINUE_PIPELINE
   - Priority 4: RUN_REVIEW re-engagement (prior code-review pipeline AND `hasNewUpstreamPassSince("qa", "code-review")`)
   - Priority 5: WAIT_FOR_REWORK
   - Priority 6: RUN_REVIEW first-run
   - Priority 7: CLAIM_WP

6. **Rewrite `getDocumentationAction`** — full 7+1b priority algorithm:
   - Priority 1: BLOCK_FOR_REWORK_LIMIT (`rework_counts.documentation >= MAX_REWORK_COUNT`)
   - Priority 1b: WAIT_FOR_UPSTREAM_REWORK_LIMIT (any of `implementation`, `qa`, `code-review` >= MAX)
   - Priority 2: RESUME_OR_CANCEL
   - Priority 3: CONTINUE_PIPELINE
   - Priority 4: REWORK self (most recent documentation FAIL — **move before WRITE_DOCS**)
   - Priority 5: FINALIZE_WP — doc PASS + all criteria met + freshness (doc PASS post-dates most recent impl start) — **replaces MARK_COMPLETE with proper conditions**
   - Priority 5b: UPDATE_CRITERIA — doc PASS + freshness OK but not all criteria met — **new**
   - Priority 6: WRITE_DOCS — PASS code-review, no docs yet OR `hasNewUpstreamPassSince("code-review", "documentation")`
   - Priority 7: CLAIM_WP

7. **Expand tests in `tests/tools/workflow-next-action.test.ts`** — one `describe` block per new/changed priority per role; key scenarios listed in Testing Strategy.

---

## Dependencies

- Phase 1 schema: `rework_counts`, `auto_cancelled`, `status_changed_at` — **complete**
- Phase 2 algorithms: `hasDownstreamReengagedSince`, `hasNewUpstreamPassSince` (auto_cancelled-aware), `isMostRecentPipelineFail`, `mostRecentEffectivePipeline` — **complete**
- Phase 3 tools: `canStartWorkPackage` dependency check, `rework_counts` populated by `startPipeline` — **complete**

---

## Required Components

| File | Role |
|------|------|
| `mcp-server/src/tools/workflow-next-action.ts` | Primary change — all 5 role functions rewritten |
| `mcp-server/src/utils/workflow-helpers.ts` | Add `isActivePipeline` helper |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | Expand — new describe blocks for all new/changed priorities |

No new files. No changes to `src/schema/`, `src/storage/`, `src/index.ts`, or `src/tools/workflow.ts`.

---

## Assumptions

- `mostRecentEffectivePipeline` is already exported from `workflow-helpers.ts` (Phase 2 deliverable). If absent it must be added before WP-002 (PM rewrite) begins.
- `canStartWorkPackage` (used by REPAIR_ORPHAN_BLOCKED) is available in `work-package.ts` or `workflow-helpers.ts` and can be imported into `workflow-next-action.ts`.
- `STALE_PIPELINE_HOURS` constant is already exported from `workflow-helpers.ts` or `constants.ts` for use in REVIEW_ABANDONED grace-period calculation.
- The `rework_counts` migration from Phase 1 means all WP objects read from disk will have the `rework_counts` map; the legacy scalar `rework_count` compat shim can be removed from Developer priority 1.

---

## Constraints

- All changes remain within `mcp-server/` — no cross-project changes.
- No new MCP tools registered in this phase.
- TypeScript `noUncheckedIndexedAccess` rule must be respected — all array index accesses via `.at(-1)` or guarded `if (arr[0] !== undefined)`.
- Action response shape must remain consistent with existing callers: `{ action: string, work_package_id?: string, reason: string, next_steps?: string[] }`.

---

## Out of Scope

- Handoff engine rewrites (Phase 5).
- Self-healing rules and synthesis completion (Phase 6).
- `ledger_reset_rework_count` and `ledger_update_acceptance_criteria` tools (Phase 6).
- Manifest updates to `api-surface.md` — deferred to Phase 6 Documentation agent (covers all new action types from Phases 4–6 in one pass).

---

## Acceptance Criteria

- [ ] All nine new action types (`CONTINUE_PIPELINE`, `WAIT_FOR_REWORK`, `WAIT_FOR_DOWNSTREAM`, `FINALIZE_WP`, `UPDATE_CRITERIA`, `REVIEW_ABANDONED`, `REPAIR_ORPHAN_BLOCKED`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`, and renamed `UNBLOCK_WP` replacing `RESOLVE_BLOCKERS`) are returned by the appropriate role functions under the correct conditions.
- [ ] Developer priority ordering is correct: REWORK(direct) fires before IMPLEMENT; WAIT_FOR_DOWNSTREAM fires when downstream FAIL exists but `hasDownstreamReengagedSince` is false.
- [ ] QA and Reviewer priority 4 (re-engagement) requires "at least one prior pipeline excluding auto-cancelled" guard; priority 6 (first-run) is distinct and reachable.
- [ ] QA and Reviewer priority 5 returns `WAIT_FOR_REWORK` (not `WAIT`) as action type.
- [ ] Documentation priority 4 (REWORK self) fires before WRITE_DOCS.
- [ ] Documentation priority 5 (`FINALIZE_WP`) validates all criteria `met: true` AND freshness check (doc PASS `completed_at` > most recent `implementation` pipeline `started_at`).
- [ ] Documentation priority 5b (`UPDATE_CRITERIA`) fires when freshness passes but at least one criterion has `met: false` or `met` absent.
- [ ] PM function correctly filters BLOCKED WPs by `blocked_by.type` for UNBLOCK_WP (non-dependency only); REVIEW_STALE uses `extractStalePipelineAction`; REVIEW_ABANDONED uses `mostRecentEffectivePipeline` with grace period.
- [ ] All role functions pass `rework_counts[pipelineType]` directly (no legacy scalar compat shim).
- [ ] All existing tests continue to pass (no regressions).
- [ ] New tests cover every priority for every role, including temporal guard scenarios.
- [ ] `npx tsc --noEmit` passes with zero errors.
- [ ] Full test suite passes: `npx vitest run`.

---

## Testing Strategy

New tests are added to `tests/tools/workflow-next-action.test.ts` using the existing fixture pattern (build synthetic `RootIndex` + `WorkPackageDetail` objects with crafted `pipelines` arrays). One `describe` block per new or changed priority per role. Key scenarios:

**Developer:**
- `CONTINUE_PIPELINE`: WP IN_PROGRESS with active (non-stale) implementation pipeline → expect `CONTINUE_PIPELINE`
- `REWORK` before `IMPLEMENT`: WP IN_PROGRESS with FAIL implementation pipeline AND another WP with no implementation pipeline → expect `REWORK` not `IMPLEMENT`
- `WAIT_FOR_DOWNSTREAM` temporal guard off: impl-1 PASS → qa-1 FAIL → impl-2 PASS (downstream not re-engaged) → expect `WAIT_FOR_DOWNSTREAM`
- `REWORK` temporal guard on: impl-1 PASS → qa-1 FAIL → impl-2 PASS → qa-2 FAIL → expect `REWORK`

**QA:**
- `BLOCK_FOR_REWORK_LIMIT`: `rework_counts.qa == 3` → expect `BLOCK_FOR_REWORK_LIMIT`
- `WAIT_FOR_UPSTREAM_REWORK_LIMIT`: `rework_counts.implementation == 3` → expect `WAIT_FOR_UPSTREAM_REWORK_LIMIT`
- `CONTINUE_PIPELINE`: active qa pipeline → `CONTINUE_PIPELINE`
- Priority 4 vs 6 split: prior qa FAIL + new impl PASS (re-engagement) → `RUN_QA` (priority 4); no prior qa + impl PASS (first-run) → `RUN_QA` (priority 6) — both correct but via different code paths
- `WAIT_FOR_REWORK`: most recent qa FAIL AND no new upstream impl pass → action === `WAIT_FOR_REWORK`
- `CLAIM_WP`: READY WP assigned to QA → `CLAIM_WP`

**Reviewer:** mirror of QA tests for `code-review` + upstream rework limit checks both `implementation` and `qa`.

**Documentation:**
- `BLOCK_FOR_REWORK_LIMIT`: `rework_counts.documentation == 3` → `BLOCK_FOR_REWORK_LIMIT`
- `WAIT_FOR_UPSTREAM_REWORK_LIMIT`: `rework_counts["code-review"] == 3` → `WAIT_FOR_UPSTREAM_REWORK_LIMIT`
- `REWORK` before `WRITE_DOCS`: FAIL docs pipeline AND new code-review PASS ready → `REWORK` not `WRITE_DOCS`
- `FINALIZE_WP`: docs PASS, all criteria `met: true`, doc `completed_at` > impl `started_at` → `FINALIZE_WP`
- `UPDATE_CRITERIA`: docs PASS, freshness OK, one criterion `met: false` → `UPDATE_CRITERIA`
- `FINALIZE_WP` not issued when freshness fails (doc PASS predates latest impl start) → `WRITE_DOCS` instead
- `CLAIM_WP`: READY WP assigned to Documentation → `CLAIM_WP`

**PM:**
- `UNBLOCK_WP`: BLOCKED WP with `blocked_by.type == "technical"` → `UNBLOCK_WP`
- `UNBLOCK_WP` NOT issued for dependency blocker → falls through to lower priority
- `REVIEW_REWORK_LIMIT`: `rework_counts.qa == 3` → `REVIEW_REWORK_LIMIT`
- `REVIEW_STALE`: PM action when stale pipeline detected
- `REVIEW_ABANDONED`: IN_PROGRESS WP, no IN_PROGRESS pipeline, last effective pipeline completed > 24h ago, WP claimed > 24h ago → `REVIEW_ABANDONED`
- `REVIEW_ABANDONED` grace period: WP claimed < 24h ago → skip, fall through to WAIT
- `REPAIR_ORPHAN_BLOCKED`: BLOCKED WP with null `blocked_by`, all dependencies terminal → `REPAIR_ORPHAN_BLOCKED`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`canStartWorkPackage` not importable into `workflow-next-action.ts`** | Verify import availability before WP-002 starts. If circular, extract to a shared utility function in `workflow-helpers.ts`. |
| **`mostRecentEffectivePipeline` absent or not exported (Phase 2 gap)** | Verify export at start of Phase 4. Add to `workflow-helpers.ts` immediately if missing — it's a one-liner (`wp.pipelines.filter(p => !p.auto_cancelled).at(-1) ?? null`). |
| **`REVIEW_ABANDONED` false positives from grace-period implementation** | Use `status_changed_at` on WP detail as the claim timestamp; fall back to `STALE_PIPELINE_HOURS` comparison against `now()` only if absent. Add explicit test for the grace-period boundary. |
| **Priority 4/6 split for QA/Reviewer breaks existing `hasNewUpstreamPassSince` tests** | The existing test suite uses `hasNewUpstreamPassSince` in both first-run and re-engagement scenarios without the "prior pipeline" guard. Audit all 3 existing `describe` blocks in `workflow-next-action.test.ts` before rewriting — preserve existing test intent, adjust expectations to match new action granularity. |
| **FINALIZE_WP freshness check conditions** | The freshness check compares doc `completed_at` to impl `started_at` (not `completed_at`) per §14.5. Ensure the implementation reads the most recent non-auto_cancelled implementation pipeline's `started_at`. Test with a fixture where impl PASS `completed_at` < doc PASS `completed_at` but impl `started_at` > doc PASS `completed_at` (rework scenario). |
| **MARK_COMPLETE removal breaks external callers** | `MARK_COMPLETE` is not a spec action type. No external callers are known — confirm with a workspace grep before removing. |
