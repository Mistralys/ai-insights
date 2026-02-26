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

| # | Condition | Healed Status |
|---|-----------|---------------|
| 1 | (`IN_PROGRESS` or `READY`) AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 1b | `READY` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis) |
| 1c | `IN_PROGRESS` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | Preserve `IN_PROGRESS` (no change — awaiting synthesis) |
| 2 | `COMPLETE` AND `pending > 0` | `IN_PROGRESS` (reopen/drift repair) |
| 2b | `COMPLETE` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (synthesis not yet run — project completion requires synthesis) |
| 3 | `READY` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` |
| 3b | `READY` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (all remaining WPs are blocked) |
| 3c | `IN_PROGRESS` AND `pending > 0` AND no WP is `READY` or `IN_PROGRESS` | `BLOCKED` (drift repair: all remaining WPs are blocked) |
| 4 | `BLOCKED` AND any WP is `IN_PROGRESS` | `IN_PROGRESS` (progress possible despite some WPs still blocked) |
| 5a | `BLOCKED` AND no WP is `BLOCKED` AND `pending == 0` AND `total > 0` AND `synthesis_generated` | `COMPLETE` |
| 5b | `BLOCKED` AND no WP is `BLOCKED` AND any WP is `READY` (none `IN_PROGRESS`) | `READY` |
| 5c | `BLOCKED` AND no WP is `BLOCKED` AND `pending == 0` AND `total > 0` AND NOT `synthesis_generated` | `IN_PROGRESS` (all WPs done, awaiting synthesis) |
| 6 | Empty project (no WPs) | Never auto-healed to `COMPLETE` |
| 6b | (`IN_PROGRESS` or `BLOCKED`) AND `total == 0` | `READY` (drift repair: no WPs exist to process) |

> **Rule 6b rationale:** If data corruption or an interrupted operation leaves a project `IN_PROGRESS` or `BLOCKED` with zero work packages, no agent can make progress and no other healing rule matches. Healing to `READY` is the most conservative repair — the Project Manager can then re-create work packages.

> **Rule 4 rationale:** A project should not stay `BLOCKED` when some WPs can make progress. Even if other WPs remain `BLOCKED`, the presence of an `IN_PROGRESS` WP means at least one agent can advance. This mirrors rule 3 (which handles the `READY` → `IN_PROGRESS` case) for the `BLOCKED` → `IN_PROGRESS` case. Note that former rule 5b (`BLOCKED` AND no WP is `BLOCKED` AND any WP is `IN_PROGRESS`) was removed as unreachable — rule 4 already matches the broader condition (`BLOCKED` AND any WP is `IN_PROGRESS`) regardless of whether other WPs are blocked.

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
effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 20)
```

| Project Size | Effective Max | Rationale |
|-------------|--------------|----------|
| 0 WPs (pre-planning) | 50 | Static floor applies |
| 3 WPs | 60 | 3 × 20 = 60 |
| 6 WPs | 120 | 6 × 20 = 120 |
| 8 WPs | 160 | 8 × 20 = 160 |

The `× 20` multiplier accounts for:
- **4 happy-path handoffs** per WP (Dev → QA → Reviewer → Doc)
- **~6–9 rework handoffs** per WP for typical rework patterns (2–3 QA → Dev cycles, plus occasional Review → Dev cycles that restart the Dev → QA → Review chain)
- **~7–11 headroom** per WP for atypical rework or blocker resolution

> **Design intent:** The auto-handoff depth counter is a **safeguard against infinite loops**, not a throttle. The effective maximum should be high enough that a legitimate project completes without ever hitting it. If the counter is reached, it indicates a pathological loop — not normal workflow activity.

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
  effectiveMax = max(MAX_HANDOFF_DEPTH, root.total_work_packages * 20)
  
  if currentDepth < effectiveMax:
    root.auto_handoff_depth = currentDepth + 1
    store.writeRootIndex(root)
    include auto_handoff in response payload:
      { agent_name: nextAgentHandle, prompt: buildHandoffPrompt(projectPath) }
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

> **Concurrency note:** The depth-increment read-modify-write cycle (`readRootIndex` → increment → `writeRootIndex`) must be protected by the storage directory lock ([§20](#20-concurrency-model)) to prevent parallel handoff chains from racing past the depth limit. Implementations should acquire the lock before reading the depth counter.

### 18.4 Reset Path

```
When project status == "COMPLETE":
  if (root.auto_handoff_depth ?? 0) != 0:
    root.auto_handoff_depth = 0
    store.writeRootIndex(root)
```

The depth counter resets only when the **project** reaches COMPLETE status (via `completeSynthesis`). Individual WP completions do **not** reset the counter. This prevents the counter from being reset N times in a project with N work packages, which would allow `MAX_HANDOFF_DEPTH × N` total handoffs and undermine the loop guard.

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
5. `auto_handoff_depth` < `effectiveMax` (where `effectiveMax = max(MAX_HANDOFF_DEPTH, total_work_packages × 20)` — see [§18.2.1](#1821-dynamic-effective-maximum))

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
  
  // Guard: All WPs must be terminal before synthesis can complete
  if root.pending_work_packages > 0:
    release lock
    ERROR("Cannot complete synthesis: {root.pending_work_packages} work packages still pending")
  
  // Guard: At least one WP must exist
  if root.work_packages.length == 0:
    release lock
    ERROR("Cannot complete synthesis: no work packages exist")
  
  root.synthesis_generated = true
  root.status = "COMPLETE"
  root.last_updated = now()
  
  writeRootIndex(root)
  release lock
```

### 19.2 Idempotency

Calling `completeSynthesis` multiple times after all WPs are terminal is safe. The flag is simply set to `true` again. However, calling it while WPs are still pending is rejected (not silently ignored).

### 19.3 Project Completion Condition

A project is `COMPLETE` when:
- All WPs have terminal status (COMPLETE or CANCELLED) ⟹ `pending_work_packages == 0`
- At least one WP exists ⟹ `total_work_packages > 0`
- `synthesis_generated == true`

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
