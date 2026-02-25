# Key Data Flows

This document describes the main interaction paths through the system.

---

## Flow 1: Project Initialization

**Entry Point:** Agent invokes `ledger_initialize_project` tool

```
Agent → ledger_initialize_project(project_path, plan_file)
  ↓
LedgerStore.writeRootIndex()
  ↓
atomicWriteJson(storage/ledger/{slug}/project-ledger.json)
  ↓
  1. Create parent directories (mkdir -p)
  2. Write to {file}.tmp.{pid}
  3. Atomically rename to storage/ledger/{slug}/project-ledger.json
  ↓
store.writeProjectMeta() — auto-synced after root index write
  ↓
atomicWriteJson(storage/ledger/{slug}/.meta.json)
  ↓
Return RootIndex to agent
```

**Result:** New project ledger created with empty work packages array and a `.meta.json` file in the centralized storage directory.

---

## Flow 1b: List All Projects

**Entry Point:** Agent invokes `ledger_list_projects` tool

```
Agent → ledger_list_projects(status?)
  ↓
LedgerStore.listAllProjects(ledgerRoot)
  ↓
readdir(storage/ledger/)
  ↓
For each entry (excluding .archive/):
  readFile(storage/ledger/{slug}/.meta.json)
  ProjectMetaSchema.parse(data)   ← invalid entries skipped, logged to stderr
  ↓
Optional filter by status
  ↓
Return ProjectMeta[] to agent
```

**Result:** Array of project metadata for all valid projects in the central ledger, optionally filtered by status. Read-only — no lock acquired.

---

## Flow 1c: Detect Project by Working Directory

**Entry Point:** Agent invokes `ledger_detect_project` tool (typically during pre-flight when `project_path` is not explicitly known)

```
Agent → ledger_detect_project(cwd_path)
  ↓
LedgerStore.detectProjectByCwd(cwd_path)
  ↓
LedgerStore.listAllProjects(ledgerRoot)  ← same scan as Flow 1b
  ↓
For each ProjectMeta:
  inferProjectRootFromPlanPath(meta.plan_path)
    → Replace \ with /
    → posix.dirname() × 4  (walks up docs/agents/plans/{slug})
    → returns normalized project root string
  ↓
  Normalize cwd_path (\ → /, lowercase on Windows)
  Normalize project root (\ → /, lowercase on Windows)
  ↓
  Match if:
    normalizedCwd === normalizedRoot           (exact project-root match)
    OR normalizedCwd.startsWith(root + '/')   (cwd is inside project root)
  ↓
Collect all matching projects
  ↓
  matches.length === 1 → status: FOUND  (return meta)
  matches.length  >  1 → status: AMBIGUOUS  (return all candidates)
  matches.length === 0 → status: NOT_FOUND
  ↓
On FOUND:   Return { plan_path, slug, title?, status } to agent
On AMBIGUOUS: Return error listing all candidate plan_path values
On NOT_FOUND: Return error with guidance to initialize the project
```

**Result:** Pure path-string comparison — no lock, no writes, no state mutation. The derived project root is computed from each project's `plan_path` using the established `{root}/docs/agents/plans/{slug}` convention (4-level depth). A parent of the project root does NOT match (matching is downward-only).

---

## Flow 2: Work Package Creation

**Entry Point:** Agent invokes `ledger_create_work_package` tool

```
Agent → ledger_create_work_package(project_path, assigned_to, dependencies, ...)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
LedgerStore.readRootIndex()
  ↓
Generate next WP ID (max-based):
  - Scan existing work_packages for highest numeric suffix
  - Next ID = max + 1 (e.g., if highest is WP-003, next is WP-004)
  - Empty project → WP-001
  ↓
Validate dependencies exist
  ↓
Determine initial status (READY or BLOCKED based on dependencies)
  ↓
Create WorkPackageDetail object
Create WorkPackageSummary object
  ↓
Update root index:
  - Append summary to work_packages array
  - Increment total_work_packages
  - Increment pending_work_packages
  - Set status to IN_PROGRESS (if was READY)
  ↓
LedgerStore.writeWorkPackage(WP-###, detail)
LedgerStore.writeRootIndex(root)  ← auto-syncs .meta.json
  ↓ (both use atomicWriteJson)
Release lock
  ↓
Return created WorkPackageDetail to agent
```

**Result:** Both `storage/ledger/{slug}/WP-###.json` and `storage/ledger/{slug}/project-ledger.json` are created/updated atomically within a single lock. `.meta.json` is automatically synced.

---

## Flow 3: Claiming a Work Package

**Entry Point:** Agent invokes `ledger_claim_work_package` tool

```
Agent → ledger_claim_work_package(project_path, work_package_id, agent)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
Read WorkPackageDetail (storage/ledger/{slug}/WP-###.json) — validated with Zod
Read RootIndex (storage/ledger/{slug}/project-ledger.json) — validated with Zod
  ↓
updater function:
  1. Validate current status is READY
  2. Check dependencies via canStartWorkPackage()
  3. Validate status transition READY → IN_PROGRESS
  4. Update WP status and assigned_to
  5. Update root index summary status and assigned_to
  ↓
Validate updated WP and root with Zod
  ↓
atomicWriteJson(storage/ledger/{slug}/WP-###.json, updatedWP)
atomicWriteJson(storage/ledger/{slug}/project-ledger.json, updatedRoot)
store.writeProjectMeta() — auto-synced inside same lock
  ↓
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package transitioned from `READY` to `IN_PROGRESS` with both files updated atomically.

---

## Flow 4: Starting a Pipeline

**Entry Point:** Agent invokes `ledger_start_pipeline` tool

```
Agent → ledger_start_pipeline(project_path, work_package_id, type)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate WP status is IN_PROGRESS
  2. Check for duplicate in-progress pipeline of same type
  3. Enforce pipeline ordering via PIPELINE_PREREQUISITES map:
       implementation → no prerequisite
       qa             → requires PASS implementation
       code-review    → requires PASS qa
       documentation  → requires PASS code-review
     If prerequisite not met → throw descriptive error
  4. If any existing pipeline of same type has FAIL status → increment WP.rework_count
  5. Create new Pipeline object (status: IN_PROGRESS, started_at: now())
  6. Append to WP.pipelines array
  7. Update WP.assigned_to via PIPELINE_AGENT_MAP:
       implementation → 'Developer'
       qa             → 'QA'
       code-review    → 'Reviewer'
       documentation  → 'Documentation'
  8. Update root index summary assigned_to to match
  9. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** New pipeline added to work package with `IN_PROGRESS` status.

---

## Flow 5: Completing a Pipeline

**Entry Point:** Agent invokes `ledger_complete_pipeline` tool

```
Agent → ledger_complete_pipeline(project_path, work_package_id, type, status, summary, ...)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(project_path)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Find most recent IN_PROGRESS pipeline of given type
  2. Update pipeline status (PASS or FAIL)
  3. Set completed_at timestamp
  4. Set summary, artifacts, metrics, comments
  5. Update acceptance_criteria if provided
  6. If handoff_notes provided:
       fromAgent = PIPELINE_AGENT_MAP[type]
       toAgent   = NEXT_AGENT_MAP[type]
       Append HandoffNote { from_agent, to_agent, timestamp, notes } to WP.handoff_notes
  7. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Pipeline marked as complete with all metadata captured.

---

## Flow 6: Updating Work Package Status

**Entry Point:** Agent invokes `ledger_update_work_package_status` tool

```
Agent → ledger_update_work_package_status(project_path, work_package_id, status, agent, blocked_by?)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(project_path)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate status transition with isValidStatusTransition()
  2. Special validation for COMPLETE (check acceptance criteria)
  3. Special validation for BLOCKED (require blocked_by)
  4. Update WP status
  5. Handle special transitions:
     - BLOCKED → IN_PROGRESS: clear blocker
     - BLOCKED → READY: clear blocker
     - Any → BLOCKED: set blocker
     - COMPLETE → IN_PROGRESS: increment revision (Project Manager or Documentation agent only)
  6. Update root index summary status
  7. Update pending_work_packages counter if transitioning to/from COMPLETE
  ↓
Write both files atomically
Release lock
  ↓
If new status is COMPLETE:
  propagateDependencyUnblock(projectPath, completedWpId)
  ↓
  Acquire lock (separate lock acquisition)
  Read root index
  For each BLOCKED WP that lists completedWpId as a dependency:
    Read WP detail
    Run canStartWorkPackage() — checks ALL dependencies are COMPLETE
    If eligible:
      Update WP detail status BLOCKED → READY
      Clear blocked_by field
      Update root index summary status
      Write both files atomically
  Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package status updated with all business rules enforced. If transitioned to COMPLETE, all eligible downstream dependents are automatically unblocked.

---

## Flow 7: Workflow Coordination (Get Next Action)

**Entry Point:** Agent invokes `ledger_get_next_action` tool

```
Agent → ledger_get_next_action(project_path, agent_role)
  ↓
LedgerStore.readRootIndex()
  ↓
Check project state:
  - No work packages? → Recommend CREATE_WORK_PACKAGES (for PM) or WAIT
  - All complete? → Recommend GENERATE_SYNTHESIS (for Synthesis) or WAIT
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic:
  - Project Manager: Check for BLOCKED work packages
  - Developer: If any IN_PROGRESS implementation pipeline is stale (>24h) → RESUME_OR_CANCEL
               Look for WPs needing implementation, or where the MOST RECENT
               implementation pipeline has FAIL status [FAIL,PASS] → NOT REWORK
  - QA: Same stale check for qa pipelines, then look for WPs with PASS implementation
  - Reviewer: Same stale check for code-review pipelines, then PASS QA
  - Documentation: Same stale check for documentation pipelines, then PASS code-review
  - Synthesis: Wait until all complete
  ↓
Return recommendation:
  {
    action: "IMPLEMENT" | "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | "WAIT" |
            "RESUME_OR_CANCEL" | ...,
    work_package_id?: "WP-###",
    reason: "..."
    // RESUME_OR_CANCEL includes: pipeline_type, started_at, age_hours
  }
```

**Result:** Agent receives actionable recommendation based on project state and their role.

---

## Flow 8: Workflow Coordination (Get Handoff Status)

**Entry Point:** Agent invokes `ledger_get_handoff_status` tool

```
Agent → ledger_get_handoff_status(project_path, current_agent)
  ↓
LedgerStore.readRootIndex()
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific handoff logic:
  - Developer: If any WP needs QA → READY_FOR_QA
               If all WPs are complete → READY_FOR_SYNTHESIS
               Otherwise → continue or wait
  - QA: If WPs unreviewed (no code-review PASS) →
          Check if all such WPs are dependency-blocked
          If yes → READY_FOR_SYNTHESIS (not READY_FOR_REVIEWER)
          If no → READY_FOR_REVIEWER
  - Reviewer: Same pattern as QA for documentation stage
  - Documentation: If WPs not yet documented →
                     Check if all such WPs are dependency-blocked
                     If yes → READY_FOR_SYNTHESIS (not READY_FOR_DEVELOPER)
                     If no → READY_FOR_DEVELOPER
  - Others: Synthesize based on overall completion state
  ↓
Return handoff block:
  {
    agent: "QA" | "Reviewer" | "Documentation" | "Synthesis" | "Developer" | ...,
    status: "READY_FOR_QA" | "READY_FOR_REVIEWER" | "READY_FOR_SYNTHESIS" | ...
  }
```

**Key invariant:** The dependency-blocked check is applied symmetrically in the QA, Reviewer, and Documentation handoff functions. A work package is considered unblocked only when its dependencies are `COMPLETE`. WPs blocked by incomplete dependencies are excluded from the "work remaining" count — they do not prevent progression to the next stage.

**Result:** Agent receives the `AGENT: <next> / STATUS: <status>` handoff block.

---

## Flow 9: Self-Healing Counter and Status Correction

**Entry Point:** Agent invokes `ledger_get_project_status` tool

```
Agent → ledger_get_project_status(project_path)
  ↓
LedgerStore.readRootIndex()
  ↓
Recompute counters from work_packages array:
  - total_work_packages = work_packages.length
  - pending_work_packages = count where status !== COMPLETE
  ↓
If counters are incorrect:
  ↓
  Update root index counters
  Set last_updated timestamp
  ↓
Auto-heal project status (rules applied in order; first match wins):
  - If status === 'READY' and any WP is IN_PROGRESS → set status to IN_PROGRESS
  - If status === 'BLOCKED' and no WP is BLOCKED → set status to IN_PROGRESS (pending > 0) or READY (pending = 0)
  - If status === 'IN_PROGRESS' and pending === 0 and WPs exist → set status to COMPLETE
  - If status === 'COMPLETE' and pending > 0 → set status back to IN_PROGRESS
  - Empty project (no WPs) is never marked COMPLETE
  ↓
LedgerStore.writeRootIndex(correctedRoot) [if any correction was made]
  ↓
Return corrected RootIndex to agent
```

**Result:** Root index counters and project status are automatically corrected if they drift out of sync.

---

## Flow 10: Pipeline Cancellation

**Entry Point:** Agent invokes `ledger_cancel_pipeline` tool

```
Agent → ledger_cancel_pipeline(project_path, work_package_id, type, reason)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(project_path)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Find most recent IN_PROGRESS pipeline of given type
  2. If not found → throw error
  3. Set pipeline status to FAIL
  4. Set completed_at to now()
  5. Set summary to [reason]
  6. Update root.last_updated
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Stale or abandoned pipeline is closed as FAIL, allowing a fresh pipeline to be started.

---

## Flow 11: Pipeline Progress Update

**Entry Point:** Agent invokes `ledger_update_pipeline_progress` tool

```
Agent → ledger_update_pipeline_progress(project_path, work_package_id, type, summary)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(project_path)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Find most recent IN_PROGRESS pipeline of given type
  2. If not found → throw error
  3. Append new summary strings to pipeline.summary array
  4. Update root.last_updated
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Pipeline summary updated with incremental progress notes without closing the pipeline.

---

## Flow 12: Workflow Coordination (Get Next Actions — Batch)

**Entry Point:** Agent invokes `ledger_get_next_actions` tool

```
Agent → ledger_get_next_actions(project_path, agent_role, max_results?)
  ↓
LedgerStore.readRootIndex()
  ↓
Check project state:
  - No work packages? → Return empty array or single CREATE_WORK_PACKAGES recommendation
  - All complete? → Return single GENERATE_SYNTHESIS (for Synthesis) or empty array
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic (same as Flow 7, but collects ALL matches):
  - Project Manager: Find all BLOCKED WPs needing unblock
  - Developer: Find all WPs needing implementation or with stale/failed implementation pipelines
  - QA: Find all WPs with PASS implementation needing QA or with stale/failed QA pipelines
  - Reviewer: Find all WPs with PASS QA needing review or with stale/failed review pipelines
  - Documentation: Find all WPs with PASS review needing docs or with stale/failed docs pipelines
  - Synthesis: Wait until all complete
  ↓
Collect actions up to max_results limit (default: 5)
  ↓
Return array of recommendations:
  [
    {
      action: "IMPLEMENT" | "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | ...,
      work_package_id: "WP-###",
      reason: "...",
      handoff_notes?: string[]  // If addressed to this agent
    },
    ...
  ]
```

**Result:** Agent receives multiple actionable recommendations, enabling parallel work on independent work packages.

---

## Flow 13: Auto-Handoff Depth Counter Lifecycle

**Context:** `auto_handoff_depth` is a safeguard against infinite agent-chain loops. `buildHandoffResponse` in `src/tools/workflow.ts` manages the counter on every handoff-status response.

**Constant:** `MAX_HANDOFF_DEPTH = 10` (defined at the top of `src/tools/workflow.ts`).

### 13a: Storage Location

```
root index (storage/ledger/{slug}/project-ledger.json)
  └── auto_handoff_depth: number   ← current chain depth (0 when absent)
```

The field is optional on the root index schema; a missing value is treated as `0` everywhere.

### 13b: Increment Path (normal handoff)

```
Agent invokes ledger_get_handoff_status (or ledger_get_next_action)
  ↓
buildHandoffResponse() — src/tools/workflow.ts
  ↓
Registry check: isRegistryLoaded() === true
  ↓
Eligibility check:
  - status not in { COMPLETE, BLOCKED, IN_PROGRESS }
  - nextAgent resolves to a known VS Code agent handle
  ↓
store.readRootIndex()
  ↓
currentDepth = root.auto_handoff_depth ?? 0
  ↓
  [currentDepth < MAX_HANDOFF_DEPTH?]
    YES → store.writeRootIndex({ ...root, auto_handoff_depth: currentDepth + 1 })
          auto_handoff object is included in the response payload
    NO  → auto_handoff is omitted from the response (depth exceeded — see 13d)
```

### 13c: Reset Path (project complete)

```
buildHandoffResponse() detects status === 'COMPLETE'
  ↓
store.readRootIndex()
  ↓
  [(root.auto_handoff_depth ?? 0) !== 0?]
    YES → store.writeRootIndex({ ...root, auto_handoff_depth: 0 })
    NO  → no-op (already reset)
```

The reset is performed by `buildHandoffResponse` in `src/tools/workflow.ts`, triggered whenever any workflow tool returns a COMPLETE status response.

### 13d: Depth-Exceeded Path (chain terminated)

```
currentDepth >= MAX_HANDOFF_DEPTH (10)
  ↓
auto_handoff key is NOT included in the response payload
  ↓
No error thrown — no warning emitted
  ↓
Agent chain terminates; manual routing by the user is required
```

**Result:** The automatic handoff chain allows up to `MAX_HANDOFF_DEPTH` (10) consecutive agent invocations before requiring human intervention, preventing runaway loops while preserving normal multi-agent workflows.

---

## Data Flow Patterns

### Pattern 1: Read-Validate-Process-Return

All read operations follow this pattern:
1. Read JSON file
2. Parse JSON
3. Validate with Zod schema
4. Return typed object (or throw error)

### Pattern 2: Validate-Write-Atomically

All write operations follow this pattern:
1. Validate data with Zod schema
2. Serialize to pretty JSON (2-space indent, trailing newline)
3. Write to temp file
4. Atomically rename to target file

### Pattern 3: Lock-Read-Update-Write-Release

All dual-file updates follow this pattern:
1. Acquire file lock
2. Read both files (validated)
3. Apply update logic
4. Validate updated data
5. Write both files atomically
6. Release lock in `finally` block

### Pattern 4: Status Transition State Machine

Work package status transitions are enforced via state machine:
```
READY → IN_PROGRESS → COMPLETE → IN_PROGRESS (revision++)
  ↓         ↓
BLOCKED → IN_PROGRESS
```

Every transition is validated before being applied.
