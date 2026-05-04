# Plan

## Summary

Bring the per-role handoff functions in `mcp-server/src/tools/workflow-handoff.ts` back into compliance with the workflow specification (`mcp-server/docs/agents/workflow-specification/handoff.md`), restoring **dynamic upstream/downstream resolution** via `resolvePrerequisite()` and `resolveNextAgent()`. The current implementation drifted from the spec when the optional `security-audit` and `release-engineering` stages were added: `getReviewerHandoff`, `getQaHandoff`, and `getSecurityAuditorHandoff` still hard-code `qa:PASS` / `implementation:PASS` as upstream prerequisites and contain unauthorized "auto-engagement" branches that emit `IN_PROGRESS` even when the agent has no assigned work. The result is a contradictory handoff payload (`current_agent == next_agent == Reviewer`, `IN_PROGRESS`) returned alongside a `WAIT` recommendation from `ledger_get_next_action`, which silently breaks the auto-handoff loop in the orchestrator.

This plan removes the unauthorized branches, replaces them with the spec-mandated five-step structure (re-engagement → FAIL → next-stage routing → assigned-to fallback → WAIT), updates affected tests to assert the spec-correct behavior, and adds regression coverage for the 5-stage pipeline composition that triggered the bug report.

> **Audit findings (2026-04-29):** This plan was audited against the workflow specification and current implementation before commitment. Confirmed: the bug reproduction is exact (current `getReviewerHandoff` produces the contradiction verbatim for the ffmpeg ledger), every claimed helper exists, `auto_handoff` is correctly gated to non-`IN_PROGRESS` statuses (so removing unauthorized `IN_PROGRESS` branches will not break the orchestrator chain), and `getDocumentationHandoff` is the spec-correct reference pattern. Soft spots flagged during the audit are folded into the Detailed Steps below — see the `partitionWpsAwaitingNextStage` mixed-routing rule (Phase 1), the corrected R2.6 narrative (Phase 6), and the explicit `assigned_to` fixture choice in Phase 7.

> **Re-verification (2026-04-29 — after remote pull):** Remote commits `6a09915` (Handoff fixes and rework) and `52aeecb` (PM pipeline-aware routing) were fetched and reviewed. **The core bug is unchanged** — `wpsNeedingNewReview`/`wpsWithReviewInProgress` (L1022), `wpsNeedingNewQa`/`wpsWithQaInProgress` (L709), and hardcoded `qa:PASS` upstream in `getReviewerHandoff` remain. Four implementation-relevant updates folded into Detailed Steps below: (1) `scopeToStage()` was already added to all three functions — keep those lines when rewriting the bodies. (2) `getDocumentationHandoff` was already updated to use dynamic `resolvePrerequisite` — Phase 5 will confirm no further changes needed. (3) `latestNonCancelledPipeline` and `getOrderedActiveStages` are already imported; only `resolveNextAgent` needs to be added to imports. (4) `makeWp` test helper now accepts `assignedTo` as a 5th parameter (default `'Developer'`) — use it directly in Phase 6 fixtures instead of constructing objects manually. Line numbers shifted: `getQaHandoff` L585, `getSecurityAuditorHandoff` L784, `getReviewerHandoff` L903, `getDocumentationHandoff` L1164; test line references shifted ±1 (L86→L87, L102→L103, L163→L164).

## Architectural Context

**Affected module:** [mcp-server/src/tools/workflow-handoff.ts](../../../../mcp-server/src/tools/workflow-handoff.ts)

**Relevant existing infrastructure (do not modify):**

- [`mcp-server/src/utils/pipeline-maps.ts`](../../../../mcp-server/src/utils/pipeline-maps.ts) — Already exposes the dynamic-routing helpers we need:
  - `resolvePrerequisite(pipelineType, activeStages)` — returns the immediately preceding active stage, or `null` if `pipelineType` is the first active stage.
  - `resolveNextAgent(pipelineType, activeStages)` — returns the agent that should receive the WP after `pipelineType` PASSes.
  - `AGENT_PIPELINE_MAP[role]` — reverse lookup: agent role → pipeline stage they own.
  - `PIPELINE_AGENT_MAP[stage]` — forward lookup.
  - `scopeToStage(wpDetails, stage)` — filters WPs whose `active_pipeline_stages` include `stage`.
  - `DEFAULT_PIPELINE_STAGES` — fallback for legacy WPs missing `active_pipeline_stages`.
- [`mcp-server/src/utils/constants.ts`](../../../../mcp-server/src/utils/constants.ts) — `READY_STATUS_FOR_ROLE[role]` returns the `READY_FOR_*` handoff status string for a target role.
- [`mcp-server/src/utils/workflow-helpers.ts`](../../../../mcp-server/src/utils/workflow-helpers.ts) — Provides `isMostRecentPipelineFail`, `hasNewUpstreamPassSince`, `isBlockedByDependencies`. No changes required.
- [`mcp-server/src/schema/validators.ts`](../../../../mcp-server/src/schema/validators.ts) — `isTerminalStatus(status)` used everywhere already.

**Current handoff dispatch:** `HANDOFF_DISPATCH` (typed `Record<AgentRole, HandoffHandler>`) at [workflow-handoff.ts L47](../../../../mcp-server/src/tools/workflow-handoff.ts#L47). No changes required to the dispatch table — only the per-handler functions change.

**Already-present imports (do not re-add):** `latestNonCancelledPipeline`, `getOrderedActiveStages`, `scopeToStage`, `PIPELINE_AGENT_MAP`, `firstActiveStage`, `resolvePrerequisite`, `DEFAULT_PIPELINE_STAGES` are all already imported. **Only add:** `resolveNextAgent` to the `pipeline-maps.js` import block.

**Caller surfaces:**

1. `getHandoffStatus()` — exposed as the `ledger_get_handoff_status` MCP tool ([workflow-handoff.ts L83](../../../../mcp-server/src/tools/workflow-handoff.ts#L83)).
2. `computeHandoffStatus()` — called from `workflow-next-action-batch.ts` to embed `handoff_status` directly inside `ledger_get_next_action` responses ([workflow-handoff.ts L1291](../../../../mcp-server/src/tools/workflow-handoff.ts#L1291), consumer at [workflow-next-action-batch.ts L63](../../../../mcp-server/src/tools/workflow-next-action-batch.ts#L63)).

Both surfaces dispatch through `HANDOFF_DISPATCH`, so a single fix in each per-role function corrects both paths.

**Spec source of truth:** [`mcp-server/docs/agents/workflow-specification/handoff.md`](../../../../mcp-server/docs/agents/workflow-specification/handoff.md), specifically:

- §QA Handoff (lines 60–98) — six-condition pseudocode; explicit "Implementation note (hardcoded upstream)" call-out documents that the **re-engagement check** may keep `'implementation'` hard-coded for null-prerequisite-loop safety, but does **not** authorize hard-coding upstream in any other branch.
- §Reviewer Handoff (lines 98–130) — six-condition pseudocode plus a "Dynamic upstream (v2.0.0)" note explicitly requiring `resolvePrerequisite("code-review", activeStages)` and `resolveNextAgent("code-review", activeStages)`.
- §Security Auditor Handoff (lines 132–155) — six-condition pseudocode applied to `security-audit`.
- §Documentation handoff (existing implementation already spec-compliant — no changes needed; included only as the reference pattern to mirror).

**Bug report reference:** `docs/agents/bug-reports/report.md` and `docs/agents/bug-reports/chat.json`. Project triggering the bug: [`mcp-server/storage/ledger/2026-04-28-ffmpeg-provisioning/`](../../../../mcp-server/storage/ledger/2026-04-28-ffmpeg-provisioning/) (5-stage WPs with `qa:PASS` but `security-audit` not yet started).

## Approach / Architecture

For each of the three affected per-role handoff functions, replace the body **after** the all-terminal early exit and the existing re-engagement check with the spec's remaining four conditions, in this strict order:

1. **Re-engagement** (already correct in `getReviewerHandoff`; keep as-is — uses `resolvePrerequisite`).
2. **FAIL → READY_FOR_DEVELOPER** (only when re-engagement did not fire — meaning upstream has not re-PASSed).
3. **PASS current-stage with next stage not started → READY_FOR_<next agent>** computed via `resolveNextAgent(currentStage, wp.active_pipeline_stages)`. When all such WPs are dependency-blocked, return `WAIT`.
4. **`assigned_to == <currentAgent>` IN_PROGRESS WP exists → IN_PROGRESS** ("active work" branch — the only spec-authorized `IN_PROGRESS` branch besides re-engagement).
5. **Fallthrough → WAIT.**

The unauthorized branches that must be removed:

- The `wpsWithImpl` / `wpsWithQa` filter that hard-codes upstream as a string.
- The `wpsNeedingNewQa` / `wpsNeedingNewReview` "no current-stage pipeline yet" auto-engagement branch.
- The `wpsWithQaInProgress` / `wpsWithReviewInProgress` "any pipeline IN_PROGRESS" branch (replaced by the `assigned_to`-based check).
- The `wpsStillNeedingImpl` / `wpsNotYetReviewed` "WPs haven't reached this stage" branch (orchestrator + `ledger_get_next_action` already handle this — handoff should fall through to `WAIT`).

The Documentation handoff (`getDocumentationHandoff`) is **already spec-compliant** (it uses `hasPassedEffectiveUpstream` with `resolvePrerequisite` and gates on `assigned_to`-equivalent conditions). Keep it as the reference pattern but verify against the spec one more time before closing the plan.

## Rationale

- **The spec already supports dynamic upstream.** The v2.0.0 note in §Reviewer Handoff explicitly mandates `resolvePrerequisite` / `resolveNextAgent` for code-review. The QA section permits a single intentional shortcut (hard-coded `'implementation'` in the re-engagement check) for null-prerequisite-loop safety; everything else must be dynamic.
- **`ledger_get_next_action` is the source of truth for "is there work?"** — it already evaluates `resolvePrerequisite` per WP and per stage. The handoff functions are not supposed to duplicate that logic; they only need to express **routing intent** (who comes next) plus a small set of agent-specific re-engagement and FAIL signals. The unauthorized branches were attempting to do work-discovery inside the handoff, which is what produced the contradiction with `WAIT`.
- **`assigned_to` is the correct in-flight signal.** When `ledger_begin_work` claims a WP, it sets `assigned_to` to the claiming agent. Returning `IN_PROGRESS` only while `assigned_to == currentAgent` exactly matches the spec's condition 5 and avoids the false-positive auto-engagement seen in the ffmpeg project.
- **Single-source-of-truth reuse.** All routing decisions go through `resolveNextAgent`, `resolvePrerequisite`, `READY_STATUS_FOR_ROLE`, and `AGENT_PIPELINE_MAP` — the same maps used by `getReviewerAction` / `getQaAction`. This eliminates the duplicate routing logic that drifted out of sync.
- **Documentation handoff already proves the pattern works.** Its `hasPassedEffectiveUpstream` helper plus null-prerequisite handling is exactly the shape the QA / Reviewer / SecAud handoffs need. We copy that pattern.

## Detailed Steps

### Phase 1 — Add a shared helper

1. In `mcp-server/src/tools/workflow-handoff.ts`, add a private helper near the top of the file (next to `readyStatusForAgent`):

   ```ts
   /**
    * Returns true if the WP has a PASS pipeline of the prerequisite stage for `currentStage`,
    * given its active_pipeline_stages. When the prerequisite resolves to null (currentStage
    * is the first active stage), the prerequisite is vacuously satisfied (returns true).
    *
    * Mirrors the `hasPassedEffectiveUpstream` pattern already used in getDocumentationHandoff.
    */
   function hasPassedDynamicUpstream(
     wp: WorkPackageDetail,
     currentStage: PipelineType,
   ): boolean {
     const activeStages =
       (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
     const upstream = resolvePrerequisite(currentStage, activeStages);
     if (upstream === null) return true;
     return wp.pipelines.some((p) => p.type === upstream && p.status === 'PASS');
   }
   ```

2. Add a second private helper for the next-stage routing:

   ```ts
   /**
    * Given a list of WPs that have PASSed `currentStage`, returns the WPs whose
    * resolved next stage has not yet started, partitioned into ready and dependency-blocked.
    * Also returns the canonical READY_FOR_* status to emit.
    *
    * Mixed-routing safety rule (audit 2026-04-29): if the `ready` set contains WPs
    * routing to two or more distinct next agents (e.g., a project mixing
    * `[..., code-review, documentation]` with `[..., code-review, release-engineering, documentation]`),
    * `nextStatus` is returned as `null` so the caller falls through to WAIT. The
    * orchestrator's per-agent `ledger_get_next_action` ticks then dispatch each WP
    * individually. Emitting a single `next_agent` for a heterogeneous set would
    * misroute the WPs that don't match.
    *
    * Last-stage edge case: when `currentStage` is the last active stage for a WP,
    * `resolveNextAgent` returns 'Synthesis' and `AGENT_PIPELINE_MAP['Synthesis']`
    * is undefined (Synthesis owns no pipeline). Such WPs are skipped here — they
    * are handled by the all-terminal early exit once every WP reaches a terminal
    * status. Partial completion falls through to WAIT, which is the correct
    * spec-mandated behavior.
    */
   function partitionWpsAwaitingNextStage(
     wpsPassedCurrent: WorkPackageDetail[],
     currentStage: PipelineType,
   ): {
     ready: WorkPackageDetail[];
     blocked: WorkPackageDetail[];
     nextStatus: string | null;
   } {
     const awaiting = wpsPassedCurrent.filter((wp) => {
       const activeStages =
         (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
       const nextAgent = resolveNextAgent(currentStage, activeStages);
       const nextStage = AGENT_PIPELINE_MAP[nextAgent];
       // No next stage (currentStage is the last active stage) → routes to Synthesis,
       // handled separately by the all-terminal check.
       if (!nextStage) return false;
       return !wp.pipelines.some((p) => p.type === nextStage);
     });
     const ready = awaiting.filter((wp) => !isBlockedByDependencies(wp));
     const blocked = awaiting.filter((wp) => isBlockedByDependencies(wp));

     // Mixed-routing guard: collect the set of distinct next agents across all ready WPs.
     const nextAgents = new Set(
       ready.map((wp) => {
         const activeStages =
           (wp.active_pipeline_stages as PipelineType[] | undefined) ?? DEFAULT_PIPELINE_STAGES;
         return resolveNextAgent(currentStage, activeStages);
       }),
     );

     // Only emit a single READY_FOR_* status when ALL ready WPs route to the same next agent.
     // If the set is heterogeneous, return null → caller falls through to WAIT.
     const nextStatus =
       nextAgents.size === 1
         ? (READY_STATUS_FOR_ROLE[[...nextAgents][0] as AgentRole] ?? null)
         : null;

     return { ready, blocked, nextStatus };
   }
   ```

   These helpers stay private (not exported) — they are implementation detail of the handoff functions.

   When `partitionWpsAwaitingNextStage` returns `ready.length > 0` but `nextStatus === null` (the mixed-routing case), each per-role handoff function must treat it as a WAIT result with a `details` message naming the heterogeneous next-agent set. Example: `"5 WPs ready for next stage but route to multiple agents (Documentation, Release Engineer). Per-agent ledger_get_next_action ticks will dispatch each WP individually."`.

### Phase 2 — Rewrite `getReviewerHandoff`

3. Replace the body of `getReviewerHandoff` ([workflow-handoff.ts L903](../../../../mcp-server/src/tools/workflow-handoff.ts#L903)) with:

   - Keep the all-terminal early exit (unchanged).
   - Keep the `scopeToStage(wpDetails, 'code-review')` line that produces `reviewWps` (added in commit `6a09915` — already correct).
   - Keep the existing re-engagement loop (unchanged — already uses `resolvePrerequisite`).
   - Replace everything from `// Check if all WPs (scoped to reviewWps) with QA pipelines have PASS code-review pipelines` to the end of the function with the spec's remaining conditions:

     ```ts
     // Step 2 (§5.3): FAIL → READY_FOR_DEVELOPER (only reached when re-engagement did not fire).
     const failWps = reviewWps.filter((wp) =>
       !isTerminalStatus(wp.status) &&
       !isBlockedByDependencies(wp) &&
       isMostRecentPipelineFail(wp.pipelines, 'code-review')
     );
     if (failWps.length > 0) {
       return buildHandoffResponse(
         'Reviewer',
         'READY_FOR_DEVELOPER',
         `Code review FAIL on ${failWps.length} work package(s): ${failWps.map((wp) => wp.work_package_id).join(', ')}. Developer must rework.`,
         undefined,
         projectPath,
         store,
       );
     }

     // Step 3 (§5.3): WPs with PASS code-review and next stage not started → READY_FOR_<next agent>.
     const wpsPassedReview = reviewWps.filter(
       (wp) => !isTerminalStatus(wp.status) &&
               wp.pipelines.some((p) => p.type === 'code-review' && p.status === 'PASS')
     );
     const { ready, blocked, nextStatus } =
       partitionWpsAwaitingNextStage(wpsPassedReview, 'code-review');
     if (ready.length > 0 && nextStatus !== null) {
       return buildHandoffResponse('Reviewer', nextStatus, /* details */, undefined, projectPath, store);
     }
     if (ready.length === 0 && blocked.length > 0) {
       return buildHandoffResponse('Reviewer', 'WAIT', /* details */, undefined, projectPath, store);
     }

     // Step 4 (§5.3): assigned_to == "Reviewer" with IN_PROGRESS status → active work.
     const activeReviewerWp = reviewWps.find(
       (wp) => wp.status === 'IN_PROGRESS' && wp.assigned_to === 'Reviewer',
     );
     if (activeReviewerWp) {
       return buildHandoffResponse(
         'Reviewer',
         'IN_PROGRESS',
         `Reviewer has active work on ${activeReviewerWp.work_package_id}.`,
         `Call ledger_get_next_action with agent_role: "Reviewer" to continue.`,
         projectPath,
         store,
       );
     }

     // Step 5 (§5.3): Fallthrough → WAIT.
     return buildHandoffResponse(
       'Reviewer',
       'WAIT',
       'No actionable work for Reviewer.',
       undefined,
       projectPath,
       store,
     );
     ```

### Phase 3 — Rewrite `getQaHandoff`

4. Apply the analogous transformation to `getQaHandoff` ([workflow-handoff.ts L585](../../../../mcp-server/src/tools/workflow-handoff.ts#L585)):

   - **Keep** the all-terminal early exit.
   - **Keep** the `scopeToStage(wpDetails, 'qa')` line that produces `qaWps` (added in commit `6a09915` — already correct).
   - **Keep** the re-engagement loop **as-is** with the hard-coded `'implementation'` upstream — the spec explicitly authorizes this single shortcut as the "intentional simplification" for null-prerequisite-loop safety.
   - **Replace** everything from `// Check if all WPs (scoped to qaWps) with implementation pipelines have PASS QA pipelines` onward with the same five-step structure used in `getReviewerHandoff`, substituting `'qa'` for `'code-review'` and `'QA'` for `'Reviewer'`.

### Phase 4 — Rewrite `getSecurityAuditorHandoff`

5. Apply the analogous transformation to `getSecurityAuditorHandoff` ([workflow-handoff.ts L784](../../../../mcp-server/src/tools/workflow-handoff.ts#L784)):

   - **Keep** the `scopeToStage(wpDetails, 'security-audit')` line that produces `auditWps` (added in commit `6a09915` — already correct).
   - **Keep** the all-terminal early exit and re-engagement loop (the SecAud re-engagement check uses `hasNewUpstreamPassSince(wp.pipelines, 'qa', 'security-audit')` — `'qa'` is hard-coded but currently `qa` is the only legal upstream for `security-audit`. Document this as intentional in a code comment matching the QA pattern.)
   - **Replace** the `failWps` / `passedAudit` / `inProgress` branches with the same five-step structure, substituting `'security-audit'` for `'code-review'` and `'Security Auditor'` for `'Reviewer'`. The spec already routes PASS sec-audit to Reviewer via `resolveNextAgent` — no special-casing needed.

### Phase 5 — Verify `getDocumentationHandoff`

6. Read [workflow-handoff.ts L1164](../../../../mcp-server/src/tools/workflow-handoff.ts#L1164) and confirm it already follows the spec. **Commit `6a09915` already updated this function to use `resolvePrerequisite` dynamically via the `hasPassedEffectiveUpstream` local helper.** Verify it matches the spec pseudocode condition-by-condition. No code changes are expected. If any residual drift is found, refactor to use `partitionWpsAwaitingNextStage` and `hasPassedDynamicUpstream` for consistency with the other three.

### Phase 6 — Update tests

7. Edit `mcp-server/tests/tools/workflow-handoff.test.ts` to reflect the spec-correct behavior. Specifically:

   - **Delete or invert** these tests (they encode the buggy auto-engagement behavior):
     - L103 `it('returns IN_PROGRESS when some implemented WPs still need QA', ...)` — under the spec, this scenario returns `READY_FOR_REVIEW` (or `WAIT` if all dep-blocked) because condition 3 fires for the implemented WPs and condition 5 only fires when `assigned_to == "QA"`.
     - **R2.6 — re-audit only.** Audit confirmed the existing fixture already sets `assigned_to: 'QA'` and `status: 'IN_PROGRESS'`, so the spec-compliant condition 4 (`assigned_to === currentAgent` active-work branch) fires and the assertion stays valid **without modification**. Verify during implementation — if drift is found, set `assigned_to: 'QA'` explicitly using the 5th parameter of `makeWp`. Do not delete this test; it is the canonical condition-4 coverage for QA.
     - Any analogous Reviewer-side and SecAud-side tests in the same file (audit during implementation — search for `IN_PROGRESS` assertions in the QA / Reviewer / SecAud blocks). For each one, classify as: (a) buggy auto-engagement (delete/invert), (b) condition-1 re-engagement (keep), or (c) condition-4 active-work with `assigned_to` set (keep, possibly add `assigned_to` for safety).

   - **Update** these tests to use `assigned_to`-based fixtures:
     - L87 `'returns READY_FOR_REVIEW when ALL WPs are implemented and QA passed'` — should still pass after the rewrite; verify.
     - L164 `'returns READY_FOR_DOCUMENTATION when ALL WPs have passed review'` — should still pass; verify.
     - All `R*` tests that depend on auto-engagement need fixtures updated to set `status: 'IN_PROGRESS'` AND `assigned_to: '<role>'` to keep their `IN_PROGRESS` assertions valid. Use the 5th parameter of `makeWp(id, status, pipelines, deps, assignedTo)` — added in commit `52aeecb`, available now.

   - **Add** a new `describe` block: **`getReviewerHandoff — 5-stage pipeline regression (bug report 2026-04-28)`** with at least these test cases:

     1. `does NOT return IN_PROGRESS when WPs have qa:PASS but security-audit is the active upstream and not yet started` — fixture: WP with `active_pipeline_stages: ['implementation','qa','security-audit','code-review','documentation']`, pipelines `[impl:PASS, qa:PASS]`, `assigned_to: null`. Expected: `WAIT`.
     2. `returns READY_FOR_REVIEW when WP has security-audit:PASS and no code-review yet` — same active stages, pipelines `[impl:PASS, qa:PASS, security-audit:PASS]`. Expected: `READY_FOR_REVIEW`.
     3. `returns IN_PROGRESS only when assigned_to == "Reviewer"` — pipelines `[impl:PASS, qa:PASS, security-audit:PASS]`, `status: 'IN_PROGRESS'`, `assigned_to: 'Reviewer'`. Expected: `IN_PROGRESS`, `next_agent: Reviewer`.
     4. Mirror tests 1–3 for `getQaHandoff` and `getSecurityAuditorHandoff` with appropriate stage compositions.

8. Update `mcp-server/tests/integration/auto-handoff.test.ts` — re-run the suite and update any fixture that relies on the removed auto-engagement branches. Most cases should already pass because `auto_handoff` is only emitted for `READY_FOR_*` statuses (not `IN_PROGRESS`), so the auto-handoff chain itself is unaffected when `IN_PROGRESS` is correctly suppressed.

### Phase 7 — Verify against the bug report

9. Recreate the bug-report scenario as **two distinct end-to-end fixtures** (the choice depends on which spec branch is being verified):

   **Fixture A — `assigned_to: null` (verifies the bug-report contradiction is gone):**
   - WP-001 COMPLETE; WP-002/003/004/008 IN_PROGRESS with `[impl:PASS, qa:PASS]`, 5-stage active stages, **`assigned_to: null`**; WP-006/009 IN_PROGRESS with `[impl:PASS, qa:PASS, code-review:PASS]`, 4-stage active stages, **`assigned_to: null`**; plus the BLOCKED WPs.
   - Expected: `getReviewerHandoff` returns `READY_FOR_DOCUMENTATION` (WP-006/009 trigger condition 3 next-stage routing) **or** `WAIT` if those two are dep-blocked. Must **never** return `IN_PROGRESS` with `next_agent: Reviewer`.

   **Fixture B — `assigned_to: 'Reviewer'` (verifies condition 4 active-work):**
   - Same as Fixture A but with WP-006 / WP-009 having `assigned_to: 'Reviewer'` (matching the literal ledger snapshot).
   - Expected: `getReviewerHandoff` returns `IN_PROGRESS` with `current_agent: Reviewer`, `next_agent: Reviewer` — the spec-correct outcome of condition 4 firing **before** condition 5 falls through. Acceptance criterion #1 explicitly permits this case.

   - For both fixtures, confirm by running `ledger_get_next_action` against the same state and checking that the embedded `handoff_status` block is consistent with the top-level `action` field. The bug was the inconsistency between them — both fixtures must produce a coherent payload.

### Phase 8 — Build + full test suite

10. Run `cd mcp-server ; npm run build` to verify the TypeScript compiles.
11. Run `cd mcp-server ; npm test` and ensure the full Vitest suite passes. Expected delta: a small number of test fixtures need `assigned_to` field additions; any other failure indicates additional drift to investigate.
12. Run `node scripts/validate-workflow-manifest.js` from the workspace root for a final manifest sanity check (no manifest changes expected, but this catches accidental drift).

## Dependencies

- No new npm dependencies.
- No spec changes. The spec is already correct; the implementation is the deviant.
- No changes to the MCP tool surface, schema, or `.context/` configuration.

## Required Components

- **Modified:** `mcp-server/src/tools/workflow-handoff.ts` — three function bodies rewritten + two new private helpers added.
- **Modified:** `mcp-server/tests/tools/workflow-handoff.test.ts` — delete/invert ~5 tests, add ~12 new regression tests in a new `describe` block.
- **Modified (likely minor):** `mcp-server/tests/integration/auto-handoff.test.ts` — fixture tweaks if any test depends on the buggy `IN_PROGRESS` branches.
- **Verified, not modified:** `mcp-server/src/utils/pipeline-maps.ts`, `mcp-server/src/utils/constants.ts`, `mcp-server/src/utils/workflow-helpers.ts`, `mcp-server/docs/agents/workflow-specification/handoff.md`.

## Assumptions

- **Audit-verified (2026-04-29):**
  - `resolvePrerequisite`, `resolveNextAgent`, `AGENT_PIPELINE_MAP`, `PIPELINE_AGENT_MAP`, `scopeToStage`, `READY_STATUS_FOR_ROLE`, `isMostRecentPipelineFail`, `hasNewUpstreamPassSince`, `isBlockedByDependencies`, `isTerminalStatus`, and `DEFAULT_PIPELINE_STAGES` all exist with the documented signatures.
  - `auto_handoff` is gated to `status !== 'IN_PROGRESS'` (and `!== 'WAIT'`, `!== 'COMPLETE'`, `!== 'BLOCKED'`) in `buildHandoffResponse`, so removing unauthorized `IN_PROGRESS` branches will not break the auto-handoff chain.
  - The bug reproduces exactly: tracing the ffmpeg ledger through the current `getReviewerHandoff`, the `wpsNeedingNewReview` filter matches WP-002/003/004/008 verbatim and emits the contradictory `IN_PROGRESS` payload from the bug report.
  - `getReviewerHandoff`'s existing re-engagement loop already uses dynamic `resolvePrerequisite` and is spec-correct.
- **To be confirmed during implementation:**
- The Documentation handoff is already spec-compliant (verified in Phase 5 — confirm before closing).
- `assigned_to` is reliably set by `ledger_begin_work` when an agent claims a WP (verified by reading the existing implementation; the value is already used by `getProjectManagerHandoff`).
- The existing re-engagement check in `getReviewerHandoff` (top of the function, uses `resolvePrerequisite`) is correct and stays untouched.
- The hard-coded `'implementation'` in `getQaHandoff`'s re-engagement check is **intentional** per the spec's "Implementation note (hardcoded upstream)" — keep it. Same for `'qa'` in `getSecurityAuditorHandoff`'s re-engagement check.
- Tests asserting `IN_PROGRESS` for "some WPs still need stage X" without `assigned_to` set are testing the buggy behavior and must be inverted, not preserved.

## Constraints

- **No spec changes.** The spec is the source of truth. If any branch you're tempted to keep cannot be derived from the six conditions in the spec pseudocode, it must be removed.
- **No new public API.** The two new helpers are private to `workflow-handoff.ts`.
- **Preserve auto-handoff eligibility.** `buildHandoffResponse` already gates `auto_handoff` to `READY_FOR_*` statuses; do not change that.
- **No process.exit, no breaking schema changes, no new dependencies.**
- **Order matters.** Re-engagement MUST be checked before FAIL (per the v1.2.0 spec note in the QA / Reviewer sections).

## Out of Scope

- Changing the workflow specification (it's already correct).
- Modifying `getReviewerAction` / `getQaAction` / etc. in `workflow-next-action.ts` — these are already correct (they use `resolvePrerequisite` per WP).
- Changes to `getDeveloperHandoff`, `getProjectManagerHandoff`, `getPlannerHandoff`, `getReleaseEngineerHandoff` (`getDeveloperHandoff` and `getReleaseEngineerHandoff` have different state machines and are not affected by the dynamic-upstream regression).
- Refactoring `getDocumentationHandoff` for cosmetic consistency unless drift is found in Phase 5.
- Repairing the existing `2026-04-28-ffmpeg-provisioning` ledger state. After this fix, the next call to `ledger_get_next_action` from any agent will produce the correct, consistent handoff payload — no manual state surgery needed.

## Acceptance Criteria

1. For the ffmpeg project state captured in the bug report, `ledger_get_next_action` with `agent_role: "Reviewer"` returns `action: WAIT` (or `READY_FOR_DOCUMENTATION` for WP-006/009, depending on dependency state) and the embedded `handoff_status` block has `current_agent: Reviewer` with **`next_agent != Reviewer`** unless `status === IN_PROGRESS` AND a WP has `assigned_to === "Reviewer"`.
2. The contradiction in the bug report — `next_agent == current_agent == Reviewer` with `status: IN_PROGRESS` despite `action: WAIT` — cannot be reproduced.
3. All four spec conditions for QA / Reviewer / SecAud handoffs are exercised by tests with explicit `it()` cases per condition, per role.
4. New regression tests in Phase 6 step 9 all pass.
5. Full `npm test` suite in `mcp-server/` passes.
6. `npm run build` in `mcp-server/` succeeds with no TypeScript errors.
7. `node scripts/validate-workflow-manifest.js` succeeds.
8. Reading `mcp-server/docs/agents/workflow-specification/handoff.md` and the rewritten `getReviewerHandoff`, `getQaHandoff`, `getSecurityAuditorHandoff` side by side, every branch in the implementation maps 1:1 to a numbered condition in the spec.

## Testing Strategy

- **Unit tests (Vitest)** in `mcp-server/tests/tools/workflow-handoff.test.ts`:
  - Per role (QA, Reviewer, SecAud), one test per spec condition (5 conditions × 3 roles = ~15 base tests).
  - One test per role asserting that `IN_PROGRESS` is **only** emitted when `assigned_to === <role>` (or via re-engagement).
  - One regression test per role for the 5-stage composition (security-audit between qa and code-review).
  - One regression test for the documentation-only WP composition (single-stage active, null prerequisite).
- **Integration tests** in `mcp-server/tests/integration/auto-handoff.test.ts`:
  - Verify the auto-handoff chain still completes correctly through the spec-compliant handoff sequence (Developer → QA → SecAud → Reviewer → Documentation).
- **End-to-end verification** of the bug-report scenario via the fixture in Phase 7 step 9.
- **Manual verification:** after the build, run `node scripts/cli.js` (or the equivalent MCP-tool path) against the actual ffmpeg ledger and confirm the contradiction is gone.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Removing the auto-engagement branch makes the orchestrator stall waiting for an agent to claim work.** | The orchestrator already calls `ledger_get_next_action` per agent on each tick. `ledger_get_next_action` returns CONTINUE / RESUME / BLOCK_FOR_REWORK_LIMIT correctly. Once any agent claims a WP via `ledger_begin_work`, `assigned_to` is set and the spec's condition 5 fires on the next handoff — the loop continues normally. Verify with the integration test in Phase 6 step 8. |
| **Existing tests encode the buggy behavior and will fail.** | Expected. Phase 6 explicitly enumerates the tests to delete/invert and the new tests to add. The plan treats failing tests as a signal of correctness, not regression. |
| **`getDocumentationHandoff` may also have undetected drift.** | Phase 5 mandates a side-by-side spec comparison before closing the plan. If drift is found, apply the same five-step rewrite. |
| **The bug report scenario also exercises Documentation routing.** | Phase 7 step 9 asserts the full chain from Reviewer onward, not just the Reviewer handoff in isolation. |
| **`partitionWpsAwaitingNextStage` could misroute mixed-routing WPs.** | Audit-resolved: the helper computes a `Set<nextAgent>` across all ready WPs and only emits `nextStatus` when the set has exactly one element. Heterogeneous sets return `nextStatus: null`, and the caller emits a `WAIT` with a message naming the conflicting agents. The orchestrator's per-agent `ledger_get_next_action` ticks dispatch each WP individually on the next round. See Phase 1 helper definition for the implementation. |
| **Last-active-stage WPs (next agent = Synthesis) fall through to WAIT when only some WPs are terminal.** | Audit-resolved: `AGENT_PIPELINE_MAP['Synthesis']` is `undefined`, so the `awaiting` filter skips them. Spec-correct: the all-terminal early exit handles full completion, partial completion correctly waits for the remaining WPs. Documented in the helper's JSDoc. |
| **The hard-coded re-engagement upstream in `getQaHandoff` (`'implementation'`) and `getSecurityAuditorHandoff` (`'qa'`) is non-adaptive.** | Spec-authorized intentional shortcut. Keep, but add an inline comment linking to the relevant spec section so future changes do not "fix" it accidentally. |
| **`READY_STATUS_FOR_ROLE[role]` may not contain an entry for a future role.** | The map is typed `Record<AgentRole, string>` so TypeScript enforces completeness. No runtime risk. |
