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
atomicWriteJson(project-ledger.json)
  ↓
  1. Create parent directories (mkdir -p)
  2. Write to {file}.tmp.{pid}
  3. Atomically rename to project-ledger.json
  ↓
Return RootIndex to agent
```

**Result:** New project ledger created with empty work packages array.

---

## Flow 2: Work Package Creation

**Entry Point:** Agent invokes `ledger_create_work_package` tool

```
Agent → ledger_create_work_package(project_path, assigned_to, dependencies, ...)
  ↓
withLock(project_path) — acquire .ledger.lock
  ↓
LedgerStore.readRootIndex()
  ↓
Generate next WP ID (e.g., WP-001)
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
LedgerStore.writeRootIndex(root)
  ↓ (both use atomicWriteJson)
Release lock
  ↓
Return created WorkPackageDetail to agent
```

**Result:** Both `ledger/WP-###.json` and `project-ledger.json` are created/updated atomically within a single lock.

---

## Flow 3: Claiming a Work Package

**Entry Point:** Agent invokes `ledger_claim_work_package` tool

```
Agent → ledger_claim_work_package(project_path, work_package_id, agent)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(project_path) — acquire .ledger.lock
  ↓
Read WorkPackageDetail (ledger/WP-###.json) — validated with Zod
Read RootIndex (project-ledger.json) — validated with Zod
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
atomicWriteJson(ledger/WP-###.json, updatedWP)
atomicWriteJson(project-ledger.json, updatedRoot)
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
withLock(project_path) — acquire .ledger.lock
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate WP status is IN_PROGRESS
  2. Check for duplicate in-progress pipeline of same type
  3. Create new Pipeline object (status: IN_PROGRESS, started_at: now())
  4. Append to WP.pipelines array
  5. Update root.last_updated timestamp
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
  6. Update root.last_updated timestamp
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
Agent → ledger_update_work_package_status(project_path, work_package_id, status, blocked_by?)
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
     - Any → BLOCKED: set blocker
     - COMPLETE → IN_PROGRESS: increment revision
  6. Update root index summary status
  7. Update pending_work_packages counter if transitioning to/from COMPLETE
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package status updated with all business rules enforced.

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
  - Developer: Look for WPs needing implementation or with FAIL pipelines
  - QA: Look for WPs with PASS implementation but no QA pipeline
  - Reviewer: Look for WPs with PASS QA but no review pipeline
  - Documentation: Look for WPs with PASS review but no docs pipeline
  - Synthesis: Wait until all complete
  ↓
Return recommendation:
  {
    action: "IMPLEMENT" | "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | "WAIT" | ...,
    work_package_id?: "WP-###",
    reason: "..."
  }
```

**Result:** Agent receives actionable recommendation based on project state and their role.

---

## Flow 8: Self-Healing Counter Correction

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
  LedgerStore.writeRootIndex(correctedRoot)
  ↓
Return corrected RootIndex to agent
```

**Result:** Root index counters are automatically corrected if they drift out of sync.

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
