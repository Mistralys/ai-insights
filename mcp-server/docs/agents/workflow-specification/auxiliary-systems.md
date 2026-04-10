# Auxiliary Systems

> Part of the [Agent Workflow Specification](README.md).

---

## 17. Self-Healing

The project status tool auto-corrects counters and project status on every read.

### 17.1 Healed Fields

- `total_work_packages`: recomputed as `work_packages.length`
- `pending_work_packages`: recomputed as count of non-terminal WPs
- `status`: corrected based on rules below

### 17.2 Healing Rules (Applied in Order — First Match Wins)

> **Numbering convention:** Rules are grouped by the project status they match against. Sub-rules (e.g., 1b, 1c) share the same status condition as their parent but differ in secondary conditions. Rules 1/1b/1c all match `pending == 0 AND total > 0` but diverge on `synthesis_generated` and the current project status.

| # | Condition | Healed Status |
|---|-----------|---------------|
| 1 | (`IN_PROGRESS` or `READY`) AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 1b | `READY` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis — see note below) |
| 1c | `IN_PROGRESS` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | Preserve `IN_PROGRESS` (no change — awaiting synthesis) |
| 2 | `COMPLETE` AND `pending > 0` | `IN_PROGRESS` (reopen/drift repair) |
| 2b | `COMPLETE` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (synthesis not yet run — project completion requires synthesis) |
| 3 | `READY` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` |
| 3b | `READY` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (all remaining WPs are blocked) |
| 3c | `IN_PROGRESS` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (drift repair: all remaining WPs are blocked) |
| 4 | `BLOCKED` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` (progress possible despite some WPs still blocked) |
| 4b | `BLOCKED` AND any WP is `READY` (none `IN_PROGRESS`) | `READY` (progress possible via READY WPs, even if other WPs remain blocked) |
| 5a | `BLOCKED` AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 5b | `BLOCKED` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis) |
| 6 | Empty project (no WPs) | Never auto-healed to `COMPLETE` |
| 6b | (`IN_PROGRESS` or `BLOCKED`) AND `total == 0` | `READY` (drift repair: no WPs exist to process) |
| 6c | `COMPLETE` AND `total == 0` | `READY` (drift repair: project marked complete with no WPs — see note below) |

> **Rule 1b/1c/5b semantic note:** In the "all WPs terminal, awaiting synthesis" state, no WP is actively being worked on, yet the project is healed to `IN_PROGRESS`. This extends the §5.2 definition of `IN_PROGRESS` beyond its literal meaning ("at least one WP is being worked on") to also cover the post-completion, pre-synthesis phase. `IN_PROGRESS` is the best available status — the project is neither `READY` (work has been done), `BLOCKED` (synthesis can proceed), nor `COMPLETE` (synthesis hasn't run). Implementations should treat `IN_PROGRESS` with `pending == 0` and `synthesis_generated == false` as the "awaiting synthesis" sub-state.

> **Rule 6b rationale:** If data corruption or an interrupted operation leaves a project `IN_PROGRESS` or `BLOCKED` with zero work packages, no agent can make progress and no other healing rule matches. Healing to `READY` is the most conservative repair — the Project Manager can then re-create work packages.

> **Rule 6c rationale:** A `COMPLETE` project with zero work packages is contradictory — `completeSynthesis` (§19.1) explicitly requires at least one WP. This state can only arise from data corruption (e.g., WP files deleted after synthesis). Healing to `READY` allows the Project Manager to re-create work packages. Without this rule, a COMPLETE-but-empty project would persist in an inconsistent state with no self-repair path.

> **Rule 4 rationale:** A project should not stay `BLOCKED` when some WPs can make progress. Even if other WPs remain `BLOCKED`, the presence of an `IN_PROGRESS` WP means at least one agent can advance. This mirrors rule 3 (which handles the `READY` → `IN_PROGRESS` case) for the `BLOCKED` → `IN_PROGRESS` case.

> **Rule 4b rationale:** Extends rule 4 to the `READY` case. After a partial auto-unblock (§15.4), some WPs may become `READY` while others remain `BLOCKED`. Per §5.2, the project should not be `BLOCKED` when any WP is `READY` or `IN_PROGRESS`. Without rule 4b, a partially-unblocked project would remain stuck in `BLOCKED` until all blocked WPs resolved — the prior rule 5b required "no WP is `BLOCKED`" in its condition, missing the mixed READY/BLOCKED case. Rule 4b subsumes former rule 5b (which was removed as unreachable once 4b was added). Rules 5a and 5b were renumbered (formerly 5a and 5c) and their "no WP is `BLOCKED`" condition was removed as redundant — after rules 4 and 4b filter out any project with `IN_PROGRESS` or `READY` WPs, a `BLOCKED` project with `pending == 0` can only contain terminal WPs (none `BLOCKED`).

> **Completeness note:** The healing rules above are designed for the four-status model (`READY`, `IN_PROGRESS`, `COMPLETE`, `BLOCKED`). The initial project state — `READY` with `total == 0` — intentionally matches no rule: self-healing is a no-op for this state because it is already correct (the PM has not yet created WPs). No catch-all rule exists — if a project enters a state that matches no rule (e.g., due to a future status value being added without corresponding healing rules), self-healing silently does nothing. Implementations that extend the status model MUST add corresponding healing rules to maintain the self-repair guarantee.

> **Known gap — stale `synthesis_generated` with pending WPs:** If data corruption sets `synthesis_generated = true` while WPs are still pending (`pending > 0`) and the project is `IN_PROGRESS`, no healing rule resets `synthesis_generated`. Self-healing only corrects project `status`, not the `synthesis_generated` flag (which is reset by COMPLETE → IN_PROGRESS transitions §6.2, cascade reblock §15.5, and WP creation on COMPLETE projects §21.51). If the pending WPs subsequently complete, rule 1 fires (`IN_PROGRESS AND pending == 0 AND synthesis_generated`) and auto-completes the project with a stale synthesis. **Mitigation:** Implementations SHOULD add a defensive check: if `synthesis_generated == true` AND `pending > 0`, reset `synthesis_generated = false` during self-healing. This is a corruption-only scenario (no normal operation produces this combination), so the risk is low, but the impact (silent stale completion) is high.

### 17.3 Write Optimization

```
function healProject(root):
  healed = computeHealedStatus(root)    // Pure function, no I/O
  
  if not healed.needsWrite:
    return root                          // No correction needed
  
  acquire lock
  freshRoot = readRootIndex()            // Re-read under lock
  freshHealed = computeHealedStatus(freshRoot)
  
  if freshHealed.needsWrite:
    apply corrections to freshRoot
    writeRootIndex(freshRoot)
  
  release lock
  return corrected root
```

The double-check (compute → lock → re-read → re-compute → write) prevents race conditions.

### 17.4 Optional Pipeline Ordering Validation

The `pipelines` array ordering invariant ([§3.4](data-model.md#34-pipeline)) is critical to the correctness of prerequisite checks, rework detection, and freshness checks. Implementations SHOULD add a defensive check during self-healing: verify that `started_at` timestamps across all pipelines in each WP are monotonically non-decreasing. If a violation is detected, emit a `"warning"` project comment identifying the affected WP. Self-healing does not attempt to reorder pipelines (the correct order may be ambiguous if timestamps were corrupted), but surfacing the violation allows the PM to investigate and repair the data.

---

## 18. Auto-Handoff Depth Counter

Prevents infinite agent-chain loops.

### 18.1 Storage

`auto_handoff_depth` field on the root index. Optional; absent = 0.

### 18.2 Constants

```
MAX_HANDOFF_DEPTH = 50    // Static floor; configurable at runtime via gui-config
```

### 18.2.1 Dynamic Effective Maximum

The static constant serves as a floor. Once work packages exist, the effective maximum scales with project size:

```
effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 30)
```

| Project Size | Effective Max | Rationale |
|-------------|--------------|----------|
| 0 WPs (pre-planning) | 50 | Static floor applies |
| 1 WP | 50 | 1 × 30 = 30 < 50, floor applies |
| 3 WPs | 90 | 3 × 30 = 90 |
| 5 WPs | 150 | 5 × 30 = 150 |
| 8 WPs | 240 | 8 × 30 = 240 |

The `× 30` multiplier accounts for:
- **4–6 happy-path handoffs** per WP (Dev → QA → Security Auditor → Reviewer → Release Engineer → Doc; varies by active stages — 4 for the default pipeline, up to 6 when all stages are active)
- **~6–9 rework handoffs** per WP for typical rework patterns (2–3 QA/security-audit → Dev cycles, plus occasional Review → Dev cycles that restart the Dev → QA → [Security Audit] → Review chain)
- **~10–15 headroom** per WP for atypical rework, blocker resolution, self-rework cycles (Release Engineering, Documentation), and wasted handoff cycles from handoff/recommendation priority mismatches

> **Multiplier increased from 20 to 30 (v2.4.1):** Operational experience showed that the original `× 20` multiplier was insufficient for projects with complex rework patterns, multi-stage WPs, and the overhead of wasted handoff cycles (§18.4). The increased multiplier provides adequate headroom without compromising the loop-guard safety net.

> **Formula dependency on `MAX_REWORK_COUNT`:** The `× 30` multiplier assumes a `MAX_REWORK_COUNT` of 5 (the default). If `MAX_REWORK_COUNT` is configured higher, the rework handoff budget increases proportionally — roughly `MAX_REWORK_COUNT × 4` handoffs per WP for implementation rework (each cycle involves Dev → QA → potentially Security Auditor → Reviewer handoffs). Implementations that configure `MAX_REWORK_COUNT > 5` SHOULD increase the multiplier accordingly or adjust `MAX_HANDOFF_DEPTH` to ensure the effective maximum does not constrain legitimate rework.

> **Design intent:** The auto-handoff depth counter is a **safeguard against infinite loops**, not a throttle. The effective maximum should be high enough that a legitimate project completes without ever hitting it. If the counter is reached, it indicates a pathological loop — not normal workflow activity.

> **⚠ Shrinking effective maximum on WP cancellation:** The depth counter only resets on `completeSynthesis` (§18.4). If WPs are cancelled mid-project, `total_work_packages` decreases and `effectiveMax` shrinks accordingly (computed at handoff time via §18.3). However, the counter retains its accumulated value. This can retroactively exhaust the handoff budget — for example, a project that consumed 120 handoffs across 5 WPs has `effectiveMax = 150`; if 3 WPs are then cancelled, `effectiveMax = max(50, 2 × 30) = 60`, and the counter (120) already exceeds the new limit. No further auto-handoffs are possible. This is consistent with the design intent (loop guard, not throttle) but may surprise implementations. If this becomes a practical issue, implementations MAY add a PM action to manually reset the counter, or reset the counter as a side effect of WP cancellation.

### 18.3 Increment Path

```
function buildHandoffResponse(currentAgent, status, ..., store):
  if status in ["COMPLETE", "BLOCKED", "IN_PROGRESS"]:
    skip auto-handoff
  
  nextAgent = resolveNextAgent(status, currentAgent)
  if nextAgent is null:
    skip auto-handoff
  
  root = store.readRootIndex()
  currentDepth = root.auto_handoff_depth ?? 0
  effectiveMax = max(MAX_HANDOFF_DEPTH, root.total_work_packages * 30)
  
  if currentDepth < effectiveMax:
    root.auto_handoff_depth = currentDepth + 1
    store.writeRootIndex(root)
    agentId = getAgentId(nextAgent)  // null when persona has no id: field
    names = AGENT_NAMES[nextAgent]   // loaded from personas/name-mapping.json at startup
    include auto_handoff in response payload:
      {
        agent_name: nextAgentHandle,
        ...(agentId !== null ? { agent_id: agentId } : {}),
        cc_agent_name: names.claude_code.agent_name,   // e.g. "3-developer"
        vs_agent_name: names.vscode.agent_name,        // e.g. "3 - Developer v3.6.1"
        da_agent_name: names.deep_agents.agent_name,   // e.g. "3-developer"
        prompt: buildHandoffPrompt(projectPath, agentId ?? undefined)
        // prompt starts with "@{agentId}\n" when agentId is present — VS Code routes to the matching persona
      }
  else:
    omit auto_handoff from response
    // Emit warning for observability
    root.project_comments.append({
      type: "warning",
      priority: "high",
      timestamp: now(),
      agent: "system",
      note: "Auto-handoff depth limit reached ({currentDepth}/{effectiveMax}). "
            + "Agent chain terminated. Manual routing required."
    })
    store.writeRootIndex(root)
```

> **Name fields source:** `cc_agent_name`, `vs_agent_name`, and `da_agent_name` are loaded from `personas/name-mapping.json` (generated by `scripts/build-personas.js`) via the `AGENT_NAMES` constant in `mcp-server/src/utils/constants.ts`. The existing `agent_name` field (VS Code display name from the Agent Registry) is preserved for backward compatibility.

> **Concurrency note:** The depth-increment read-modify-write cycle (`readRootIndex` → increment → `writeRootIndex`) must be protected by the storage directory lock ([§20](#20-concurrency-model)) to prevent parallel handoff chains from racing past the depth limit. Implementations should acquire the lock before reading the depth counter.

### 18.4 Reset Path

The depth counter is reset to `0` **atomically inside `completeSynthesis`** (§19.1) when the project status transitions to `COMPLETE`. This ensures no window exists where the project is COMPLETE but the counter is stale.

```
// Inside completeSynthesis, after setting root.status = "COMPLETE":
if (root.auto_handoff_depth ?? 0) != 0:
  root.auto_handoff_depth = 0
// Written as part of the same writeRootIndex(root) call
```

Individual WP completions do **not** reset the counter. This prevents the counter from being reset N times in a project with N work packages, which would allow `MAX_HANDOFF_DEPTH × N` total handoffs and undermine the loop guard.

> **Wasted handoff cycles:** When the handoff function (§13.1) and the recommendation engine (§14) have different priority orderings (e.g., Documentation handoff checks new-work WPs before FAIL self-rework, while `getNextAction` checks FAIL self-rework first — see §14.5), a handoff may invoke an agent that immediately prioritizes different work than the handoff intended. Each such “wasted” handoff still increments the depth counter. Over many such cycles, this can consume depth budget without productive handoff progress. The dynamic scaling (§18.2.1) provides generous headroom to absorb this, but implementations that observe frequent wasted handoffs MAY consider aligning handoff and recommendation priorities for specific roles, or skipping the depth increment when the receiving agent's `getNextAction` targets a different WP than the handoff intended. Such optimizations are beyond the core specification.

### 18.5 Depth-Exceeded Behavior

- No error thrown
- `auto_handoff` key simply omitted from response
- A project comment of type `"warning"` with priority `"high"` is emitted: `"Auto-handoff depth limit reached ({currentDepth}/{effectiveMax}). Agent chain terminated. Manual routing required."`
- Agent chain terminates; manual routing required

> **Rationale:** Silent termination (without any diagnostic output) would cause headless orchestrators to stop processing with no indication of why. The warning comment ensures the Project Manager has visibility into the termination cause, mirroring the pattern used for null timestamp anomalies (§21.18).

### 18.6 Auto-Handoff Eligibility

`auto_handoff` is included in the response **only when ALL conditions are true**:

1. `auto_handoff_enabled` is `true` in runtime config
2. Agent registry is loaded (agent files discovered)
3. Next agent has a known handle in the registry
4. Status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` < `effectiveMax` (where `effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 30)` — see [§18.2.1](#1821-dynamic-effective-maximum))

---

## 19. Synthesis Completion

### 19.1 Algorithm

```
function completeSynthesis(projectPath, agentRole):
  // Guard: Only Synthesis agent (or PM override) can complete synthesis
  if agentRole != "Synthesis" AND agentRole != "Project Manager":
    ERROR("Only Synthesis agent can complete synthesis (PM override allowed)")
  
  acquire lock
  root = readRootIndex()
  
  // Heal counters before checking (guard against stale pending count from
  // a prior crash or interrupted write — see §17)
  root.total_work_packages = root.work_packages.length
  root.pending_work_packages = count(wp in root.work_packages where not isTerminalStatus(wp.status))
  
  // Guard: All WPs must be terminal before synthesis can complete
  if root.pending_work_packages > 0:
    release lock
    ERROR("Cannot complete synthesis: {root.pending_work_packages} work packages still pending")
  
  // Guard: At least one WP must exist
  if root.work_packages.length == 0:
    release lock
    ERROR("Cannot complete synthesis: no work packages exist")
  
  root.synthesis_generated = true
  root.synthesis_generated_at = now()   // §21.57: enables staleness detection
  root.status = "COMPLETE"
  root.last_updated = now()
  
  // Reset auto-handoff depth counter atomically with project completion (§18.4)
  if (root.auto_handoff_depth ?? 0) != 0:
    root.auto_handoff_depth = 0
  
  writeRootIndex(root)
  release lock
```

### 19.2 Idempotency

Calling `completeSynthesis` multiple times after all WPs are terminal is safe. The flag is simply set to `true` again (and `synthesis_generated_at` is updated to the current time). However, calling it while WPs are still pending is rejected (not silently ignored).

> **Crash recovery and statelessness:** Unlike pipeline-owning agents, the Synthesis agent has no pipeline-based state tracking — its only persistent artifact is the binary `synthesis_generated` flag. If the Synthesis agent crashes or is interrupted during report generation, there is no "synthesis in progress" state to resume from. The `synthesis_generated` flag remains `false`, and `getNextAction` for the Synthesis role will return `GENERATE_SYNTHESIS` again. Implementations MUST treat Synthesis as a **stateless, idempotent operation**: each invocation regenerates the complete synthesis report from scratch using the current state of all work packages. The Synthesis agent should not attempt to resume or append to a partial report from a prior session.

### 19.3 Project Completion Condition

A project is `COMPLETE` when:
- All WPs have terminal status (COMPLETE or CANCELLED) ⟹ `pending_work_packages == 0`
- At least one WP exists ⟹ `total_work_packages > 0`
- `synthesis_generated == true` (and `synthesis_generated_at` records when)

---

## 20. Concurrency Model

### 20.1 Atomic Writes

All file writes use a write-to-temp-then-rename pattern:
1. Write data to `{file}.tmp.{pid}`
2. Atomically rename to target file

This ensures readers never see partial writes.

### 20.2 File Locking

Dual-file updates (WP detail + root index) are protected by file locks:
- Lock file: `{storageDir}/.lock`
- Stale timeout: 10 seconds (locks older than this are forcibly acquired)
- Retry: 50 attempts with 200ms–1000ms exponential backoff
- Lock is always released in a `finally` block

### 20.3 Lock Scoping

| Operation | Lock Required? | Lock Scope |
|-----------|---------------|------------|
| Read-only (get status, list WPs) | No | — |
| Single-file write (synthesis completion) | Yes | Root index |
| Auto-handoff depth increment | Yes | Root index |
| Dual-file write (WP + root) | Yes | Storage directory |
| Dependency cascade (unblock/reblock) | Yes (separate) | Storage directory |

### 20.4 Cascade Lock Separation

`propagateDependencyUnblock` and `propagateDependencyReblock` acquire their own locks **after** the main update lock is released. This is intentional:
- Avoids holding a lock during potentially slow cascade reads
- Safe because cascade operations are idempotent
- Brief window between locks where state may appear inconsistent

> **Crash recovery:** If the process crashes during the gap between the main update lock release and cascade lock acquisition, WP-level blocking state may be left stale (e.g., a WP remains BLOCKED despite all its dependencies being terminal). Since `propagateDependencyUnblock` and `propagateDependencyReblock` are **idempotent and re-entrant**, the recovery path is to re-invoke the cascade function with the same arguments. This produces the correct end state regardless of how many times it runs.
>
> Self-healing (§17) repairs **project-level** status drift. For **WP-level** blocking inconsistency after a suspected cascade failure, re-invoking the cascade is the prescribed repair. Implementations SHOULD detect this condition (WP is BLOCKED but all dependencies are terminal and blocker type is `dependency`) during `getNextAction` and either auto-repair or surface it as a PM action.

> **⚠ Stale PASS on direct dependents:** The lock gap can also produce **stale PASS pipelines** on direct dependents, not just stale blocking state. If a dependent WP's pipeline completes with PASS during the gap between the main update (reopening the dependency) and the cascade lock acquisition, the PASS result validated pre-reopen output. Since PASS is terminal (§7.2), cascade reblock cannot retroactively cancel it. The dependent WP now carries a PASS pipeline that validated stale assumptions. This is analogous to the transitive-dependent issue documented in §21.42, but affects **direct** dependents during the lock gap. Implementations SHOULD add a dependency-status re-check to `completePipeline` (verifying that all of the WP's dependencies are still terminal before accepting a PASS result) to guard against this race. This adds minor overhead to every pipeline completion but prevents stale PASS results from propagating through the dependency graph undetected. See [§21.59](edge-cases.md#2159-cross-wp-staleness-after-dependency-reopens) for the full dependency freshness check recommendation.

> **Side-effect idempotency on concurrent unblock:** When two dependencies of the same WP complete near-simultaneously, `propagateDependencyUnblock` may be invoked twice. The state mutation is idempotent (both calls write `READY`), but **side effects** such as notifications, project comments, or webhook emissions may double-fire. Implementations SHOULD ensure that unblock side effects are either idempotent or deduplicated (e.g., via an idempotency key derived from the WP ID and target status).
