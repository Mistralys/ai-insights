# MCP Server - Manifest (Data Flows)
<INSTRUCTION>
# MCP Server - Manifest: Data Flows
Tool invocation lifecycle, storage paths, inter-module data movement, and ledger read/write patterns.

</INSTRUCTION>
------------------------------------------------------------
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── project-manifest/
                └── data-flows.md

```
###  Path: `/mcp-server/docs/agents/project-manifest/data-flows.md`

```md
# Key Data Flows

This document describes the main interaction paths through the system.

---

## Storage Layout

The centralized ledger uses a **two-level repo-namespaced directory structure**:

```
{ledgerRoot}/
├── .migration-state.json        # Written on first startup after migration; absent on first run
├── .migration-in-progress       # Transient sentinel; only present during an active migration
├── .repositories.json           # Central repository registry (loadRegistry/saveRegistry)
├── gui-config.json              # Runtime config (auto_handoff_enabled, max_handoff_depth, …)
├── ai-insights/                 # Example repo-namespace dir
│   └── 2026-05-01-my-plan/          # Per-project subfolder
│       ├── .meta.json
│       ├── .lock
│       ├── project-ledger.json
│       └── WP-001.json
├── other-repo/                  # Second repo-namespace dir (independent repository)
│   └── 2026-06-01-another-plan/
│       └── …
└── unknown/                     # Fallback namespace (repo root failed slug validation)
    └── …
```

**`{repoName}`** is derived by `deriveRepoName(projectPath)`: walks 4 directory levels up from the plan folder to the project root, takes its basename, lowercases it, and validates against `SAFE_SLUG_REGEX` (`/^[a-z0-9][a-z0-9-]*$/`). Falls back to `'unknown'` when the name is empty, `'.'`, `'..'`, or fails slug validation.

**Two-level scan (`LedgerStore.listAllProjects`):** reads the top level of `{ledgerRoot}`. For every depth-1 directory that has a direct `.meta.json` it reads it as a legacy flat-layout project (backward compatibility). For directories without a direct `.meta.json` it treats them as repo-namespace dirs and scans one level deeper, reading `{repoName}/{slug}/.meta.json` for each depth-2 entry. Dot-prefixed directories are skipped at both levels.

**One-time idempotent migration (`migrateToNamespacedLayout`):** on first startup after upgrade, moves each flat-layout `{ledgerRoot}/{slug}/` directory to `{ledgerRoot}/{repoName}/{slug}/` using the `repository_name` field stored in each project's `.meta.json`. The migration writes `.migration-state.json` on success and uses `.migration-in-progress` as a crash-recovery sentinel. Safe to call on every startup — skips immediately when `storage_version >= 2` is already written.

---

## Flow 1: Project Initialization

**Entry Point:** Agent invokes `ledger_initialize_project` tool

```
Agent → ledger_initialize_project(project_path, plan_file)
  ↓
LedgerStore.writeRootIndex()
  ↓
atomicWriteJson(storage/ledger/{repoName}/{slug}/project-ledger.json)
  ↓
  1. Create parent directories (mkdir -p)
  2. Write to {file}.tmp.{pid}
  3. Atomically rename to storage/ledger/{repoName}/{slug}/project-ledger.json
  ↓
store.writeProjectMeta() — auto-synced after root index write
  ↓
atomicWriteJson(storage/ledger/{repoName}/{slug}/.meta.json)
  ↓
store.archiveDocuments([plan_file])  — best-effort; outside lock scope
  ↓
  copyFile(join(planPath, plan_file), join(storageDir, plan_file))
  ENOENT and all other copy errors → file appended to skipped[], warning → stderr
  Success → file appended to archived[]
  ↓
Return RootIndex + { archived_documents, archive_skipped? } to agent
```

**Result:** New project ledger created with empty work packages array and a `.meta.json` file in the centralized storage directory. A copy of `plan_file` is stored in `storage/ledger/{repoName}/{slug}/` as archived reference (best-effort; missing source is silently skipped).

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
For each depth-1 entry (excluding .archive/):
  If entry has a direct .meta.json → old flat-layout project; read it.
  If entry has no .meta.json → treat as repo-namespace dir; scan depth-2:
    For each depth-2 slug entry:
      readFile(storage/ledger/{repoName}/{slug}/.meta.json)
      ProjectMetaSchema.parse(data)   ← missing/invalid entries skipped, warning → stderr
  ↓
Optional filter by status
  ↓
Return ProjectMeta[] to agent
```

**Result:** Array of project metadata for all valid projects in the central ledger (both legacy flat-layout and new repo-namespaced layout), optionally filtered by status. Read-only — no lock acquired.

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
Pre-lock validation (outside lock scope):
  - Validate dependencies exist
  - Validate active_pipeline_stages if provided:
      validateActiveStages(args.active_pipeline_stages, CANONICAL_PIPELINE_ORDERING)
        Hard guardrails (reject with error — creation aborted):
          - empty array
          - entries not in PIPELINE_TYPES
          - duplicate entries
          - entries not a subsequence of CANONICAL_PIPELINE_ORDERING
        Soft guardrails (warning appended to success response — creation NOT aborted):
          - 'implementation' present without 'qa'
          - single-stage chain
      Default when omitted: DEFAULT_PIPELINE_STAGES (['implementation', 'qa', 'code-review', 'documentation'])
  ↓
LedgerStore.createWorkPackageWithSync(creator)  ← primary choke point for WP creation
  ↓
withLock(store.storageDir) — acquire storage/ledger/{repoName}/{slug}/.lock
  ↓
LedgerStore.readRootIndex()
  ↓
creator callback:
  Generate next WP ID (max-based):
    - Scan existing work_packages for highest numeric suffix
    - Next ID = max + 1 (e.g., if highest is WP-003, next is WP-004)
    - Empty project → WP-001
  ↓
  Cycle detection: hasCycle(newWpId, deps, allExistingWps) [BFS]
    If cycle detected → throw error (no write occurs)
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
  Return { wpId, wp: detail, root: updatedRoot }
  ↓
Auto-stamp wp.last_updated = now()  ← overrides any caller-set value
Zod validation: WorkPackageDetailSchema.parse(wp)
Zod validation: RootIndexSchema.parse(root)
  If either fails → throw error (no write occurs)
  ↓
LedgerStore.writeWorkPackage(WP-###, detail)    ← atomicWriteJson  [@internal — called by createWorkPackageWithSync only]
LedgerStore.writeRootIndex(root)                 ← atomicWriteJson, auto-syncs .meta.json  [@internal — called by createWorkPackageWithSync only]
  ↓
Release lock
  ↓
Return created WorkPackageDetail to agent
```

**Result:** Both `storage/ledger/{repoName}/{slug}/WP-###.json` and `storage/ledger/{repoName}/{slug}/project-ledger.json` are created/updated atomically within a single lock scope inside `createWorkPackageWithSync`. `.meta.json` is automatically synced. The `last_updated` field on the new WP is always set by the method, not by the caller. Tool code never calls `writeWorkPackage` or `writeRootIndex` directly — see Constraint 2c.

---

## Flow 3: Claiming a Work Package

**Entry Point:** Agent invokes `ledger_claim_work_package` tool

```
Agent → ledger_claim_work_package(project_path, work_package_id, agent)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{repoName}/{slug}/.lock
  ↓
Read WorkPackageDetail (storage/ledger/{repoName}/{slug}/WP-###.json) — validated with Zod
Read RootIndex (storage/ledger/{repoName}/{slug}/project-ledger.json) — validated with Zod
  ↓
updater function:
  1. Validate current status is READY
  1b. CLAIMABLE_ROLES guard: verify agent maps to a claimable role (Planner and Synthesis excluded) — fires unconditionally before assignment/override checks
  2. Assignment guard: reject cross-agent claims unless override is set
  2b. Override auth guard: if override:true, verify caller is PM or current assigned_to
  3. Check dependencies via canStartWorkPackage()
  4. Validate status transition READY → IN_PROGRESS
  5. Update WP status, assigned_to, and status_changed_at
  6. Update root index summary status and assigned_to
  ↓
Validate updated WP and root with Zod
  ↓
atomicWriteJson(storage/ledger/{repoName}/{slug}/WP-###.json, updatedWP)
atomicWriteJson(storage/ledger/{repoName}/{slug}/project-ledger.json, updatedRoot)
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
Agent → ledger_start_pipeline(project_path, work_package_id, type, agent_role)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{repoName}/{slug}/.lock
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate WP status is IN_PROGRESS
  2. Check for duplicate in-progress pipeline of same type
  3. Enforce pipeline ordering via resolvePrerequisite(type, activeStages):
       activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
       Filters CANONICAL_PIPELINE_ORDERING by activeStages; returns the
       immediately preceding active stage as the prerequisite (null if first stage)
     If prerequisite not null and most recent prerequisite pipeline is not PASS
       → throw descriptive error:
         "Cannot start '<type>' pipeline: requires a PASS '<prereq>' pipeline first.
          Active pipeline order: <activeStages joined with →>."
  4. Role check: agent_role must match PIPELINE_AGENT_MAP owner for the type.
       Exception: agent_role === 'Project Manager' bypasses check (PM Override).
       If mismatch → throw descriptive error.
  4b. checkRevalidationGuard(): if a prior PASS of the prerequisite type is stale
       relative to upstream rework → reject with descriptive explanation.
  5. Rework detection (auto-cancelled pipelines excluded from all checks):
       Direct rework: last same-type completed pipeline has FAIL status → increment rework_counts[type]
       Downstream rework: prerequisite pipeline type reworked after last PASS → increment rework_counts[type]
       Effective count for circuit breaker: rework_counts?.[type] ?? 0
       If effective count ≥ MAX_REWORK_COUNT (5) → reject with error
  6. Create new Pipeline object (status: IN_PROGRESS, started_at: now())
  7. Append to WP.pipelines array
  8. Update WP.assigned_to via PIPELINE_AGENT_MAP:
       implementation      → 'Developer'
       qa                  → 'QA'
       security-audit      → 'Security Auditor'
       code-review         → 'Reviewer'
       release-engineering → 'Release Engineer'
       documentation       → 'Documentation'
  9. Update root index summary assigned_to to match
  10. Update root.last_updated timestamp
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
Agent → ledger_complete_pipeline(project_path, work_package_id, type, agent_role, status, summary, ...)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  0. WP status guard: verify WP.status === 'IN_PROGRESS' → throw if not (defense-in-depth)
  0b. Agent role guard: verify agent_role matches PIPELINE_AGENT_MAP[type]
       Exception: agent_role === 'Project Manager' → bypass (PM Override)
       isPmOverride = (agent_role === 'Project Manager')
  1. Find most recent IN_PROGRESS pipeline of given type
  2. Update pipeline status (PASS or FAIL)
  3. Set completed_at timestamp
  4. Set summary, artifacts, metrics, comments
  5. Update acceptance_criteria if provided (merge by exact criterion text: known → update met; unknown → append new entry)
  6. If handoff_notes provided:
       fromAgent = isPmOverride ? 'Project Manager (PM Override)' : PIPELINE_AGENT_MAP[type]
       toAgent   = (status === FAIL)
                     ? resolveFailAgent(type, activeStages)
                     : resolveNextAgent(type, activeStages)
       Append HandoffNote { from_agent, to_agent, timestamp, notes } to WP.handoff_notes
       NOTE: On FAIL, implementation/qa/security-audit/code-review route to Developer;
             release-engineering routes to Release Engineer (self-rework);
             documentation routes to Documentation (self-rework).
             Fallback: if the base fail-target's stage is absent from activeStages,
             routes to the first active stage's agent.
  7. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
If auto-finalize fired (autoFinalizeResult === 'finalized'):
  propagateDependencyUnblock(projectPath, work_package_id)
  [uses batchUpdateWorkPackagesWithSync — acquires its own separate lock — §12.2, Gotcha 8]
    Pre-check (outside lock): readRootIndex() — if no BLOCKED WP has this WP in its dependencies, return immediately (skip lock, skip all WP reads)
    If candidates exist: acquire lock via batchUpdateWorkPackagesWithSync
    For each BLOCKED WP whose dependencies include this WP:
      If all dependencies are now COMPLETE and blocked_by.type === 'dependency' (or absent):
        Transition BLOCKED → READY, clear blocked_by
    All eligible WPs updated atomically in a single lock scope
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Pipeline marked as complete with all metadata captured. When auto-finalize fires, eligible BLOCKED dependents are also transitioned to READY.

---

## Flow 6: Updating Work Package Status

**Entry Point:** Agent invokes `ledger_update_work_package_status` tool

```
Agent → ledger_update_work_package_status(project_path, work_package_id, status, agent, blocked_by?)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate status transition with isValidStatusTransition()
  1a. BLOCKED → BLOCKED early path: replace blocker (PM/assignee guard; dependency-type guard)
        → set status_changed_at, update root.last_updated, return early
  1b. READY → IN_PROGRESS redirect: reject with 'use ledger_claim_work_package' error
  2. Special validation for COMPLETE:
       a. Check all acceptance criteria are met (canCompleteWorkPackage)
       b. Freshness check: most recent non-auto-cancelled doc PASS must post-date most recent impl start
       c. Only 'Documentation' (or 'Documentation Agent') allowed
  3. Special validation for BLOCKED: require blocked_by object
  4. IN_PROGRESS → READY guard: reject if any pipeline is currently IN_PROGRESS;
       clear assigned_to in WP detail and root index summary
  5. Pipeline auto-cancellation:
       IN_PROGRESS → BLOCKED: cancel all IN_PROGRESS pipelines (auto_cancelled: true)
       IN_PROGRESS → CANCELLED: cancel all IN_PROGRESS pipelines
  6. Update WP status
  7. Set status_changed_at = now()
  8. Handle special transitions:
       BLOCKED → IN_PROGRESS: clear blocker
       BLOCKED → READY: clear blocker
       Any → BLOCKED: set blocker
       COMPLETE → IN_PROGRESS: increment revision; reset rework_counts to {};
                                 clearSynthesisState(root) — clears synthesis_generated and synthesis_generated_at (Project Manager or Documentation agent only)
  9. Update root index summary status
  10. Update pending_work_packages counter if transitioning to/from a terminal status (COMPLETE or CANCELLED)
  11. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
If new status is COMPLETE or CANCELLED:
  propagateDependencyUnblock(projectPath, completedWpId)
  ↓
  Pre-check (outside lock): readRootIndex() — if no BLOCKED WP has completedWpId in its dependencies, return immediately (skip lock, skip all WP reads)
  If candidates exist:
  LedgerStore.batchUpdateWorkPackagesWithSync(callback)  ← single lock acquisition
    Acquire lock (separate lock acquisition — §12.2, Gotcha 8)
    Read root index (inside lock)
    callback:
      For each BLOCKED WP that lists completedWpId as a dependency:
        readWp(wpId) — read WP detail inside the lock
        Run canStartWorkPackage() — checks ALL dependencies are COMPLETE or CANCELLED
        If not eligible: skip
        If blocked_by.type is external, decision, or technical: skip (non-dependency blocker; not cleared automatically)
        Transition BLOCKED → READY and clear blocked_by field
        Update root index summary status
        Add to updatedWps Map
      Return { updatedWps, root: updatedRoot }
    Auto-stamp last_updated on each WP; Zod-validate all WPs + root (two-pass validate-then-write)
    Write all updated WP files atomically; write root index; sync .meta.json once
    Release lock
  ↓
If old status was COMPLETE and new status is IN_PROGRESS (reopen):
  propagateDependencyReblock(projectPath, reopenedWpId)
  ↓
  Pre-check (outside lock): readRootIndex() — if no WP with status READY, IN_PROGRESS, or COMPLETE has reopenedWpId in its dependencies, return immediately (skip lock, skip all WP reads)
  If candidates exist:
  LedgerStore.batchUpdateWorkPackagesWithSync(callback)  ← single lock acquisition
    Acquire lock (separate lock acquisition)
    Read root index (inside lock)
    callback:
      Phase 1 — Re-block non-COMPLETE/non-CANCELLED/non-BLOCKED dependents:
        For each such WP that lists reopenedWpId as a dependency:
          readWp(wpId) — read WP detail inside the lock
          Auto-cancel any IN_PROGRESS pipelines (status=FAIL, auto_cancelled=true, completed_at=now())
          Transition WP to BLOCKED with blocked_by: {type: "dependency", blocking_work_package: reopenedWpId}
          Update root index summary status
          Add to updatedWps Map
      Phase 2 — Warn COMPLETE dependents:
        For each COMPLETE WP that lists reopenedWpId as a dependency:
          readWp(wpId) — read WP detail inside the lock
          Append warning comment to last pipeline (if any): {type:"warning",priority:"high",note:"..."}
          Add to updatedWps Map
      Phase 3 — Update root index:
        If any WPs were re-blocked (candidates.length > 0): clearSynthesisState(root) — sets synthesis_generated = false and synthesis_generated_at = null
        Recompute pending_work_packages
      Return { updatedWps, root: updatedRoot }
    Auto-stamp last_updated on each WP; Zod-validate all WPs + root (two-pass validate-then-write)
    Write all updated WP files atomically; write root index; sync .meta.json once
    Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package status updated with all business rules enforced. If transitioned to COMPLETE or CANCELLED, all eligible downstream dependents are automatically unblocked (both terminal statuses satisfy dependency requirements).

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
  - All terminal (COMPLETE or CANCELLED)? → Recommend GENERATE_SYNTHESIS (for Synthesis, if `synthesis_generated` is absent/false) or WAIT
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic:
  - Project Manager: 6-priority algorithm (§14.1.2):
                     P1 UNBLOCK_WP — BLOCKED WPs with decision/external/technical blocker.
                     P2 REVIEW_REWORK_LIMIT — IN_PROGRESS WPs with rework_counts entry >= MAX_REWORK_COUNT.
                     P3 REVIEW_STALE — IN_PROGRESS WPs with a stale active pipeline.
                     P3b REVIEW_ABANDONED — IN_PROGRESS WPs with no active pipelines and no
                          recent activity (grace period: status_changed_at within STALE_PIPELINE_HOURS).
                     P3c REPAIR_ORPHAN_BLOCKED — BLOCKED WPs whose dependency block is stale
                          (canStartWorkPackage returns allowed:true).
                     P3d ROUTE_PIPELINE_AGENT — non-terminal, non-dependency-blocked IN_PROGRESS WPs
                          where the next active pipeline stage needs work. Applies the same guards as
                          §13.1 step 2b: FAIL stages are skipped (downstream FAIL routing), IN_PROGRESS
                          stages are skipped (stage already in flight), upstream IN_PROGRESS stages are
                          skipped (premature routing prevention). Returns ROUTE_PIPELINE_AGENT with
                          next_agent and pipeline_type. Covers stage-transition routing (e.g. impl PASS
                          → next stage) and freshly-claimed WPs with zero pipelines.
                     Final Fallback WAIT — no actionable items.
  - Developer: 7-priority per-WP algorithm (§14.2, evaluated for each IN_PROGRESS/READY WP):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.implementation >= MAX_REWORK_COUNT.
                     P2 RESUME_OR_CANCEL — stale implementation pipeline (>STALE_PIPELINE_HOURS).
                     P3 CONTINUE_PIPELINE — active non-stale implementation pipeline in progress.
                     P4 REWORK (direct) — most recent implementation pipeline is FAIL (precedes IMPLEMENT).
                     P5 REWORK (downstream) — downstream FAIL + hasDownstreamReengagedSince=true.
                     P5b WAIT_FOR_DOWNSTREAM — downstream FAIL + hasDownstreamReengagedSince=false.
                     P6 IMPLEMENT — IN_PROGRESS WP with no implementation pipeline.
                     P7 CLAIM_WP — READY WP with dependencies satisfied.
                     Fallback WAIT.
  - QA: 7+1b per-WP algorithm (§14.3):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.qa >= MAX_REWORK_COUNT.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — rework_counts.implementation >= MAX_REWORK_COUNT.
                     P2 RESUME_OR_CANCEL — stale qa pipeline.
                     P3 CONTINUE_PIPELINE — active non-stale qa pipeline.
                     P4 RUN_QA (re-engagement) — prior qa pipeline exists + hasNewUpstreamPassSince.
                     P5 WAIT_FOR_REWORK — most recent qa pipeline is FAIL and P4 guard is false.
                     P6 RUN_QA (first-run) — implementation PASS, no qa pipeline.
                     P7 CLAIM_WP — READY WP assigned to QA with dependencies satisfied.
  - Reviewer: 7+1b per-WP algorithm (§14.4, mirrors QA for code-review pipeline):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts['code-review'] >= MAX_REWORK_COUNT.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — rework_counts.implementation OR .qa >= MAX.
                     P2–P3 same stale/active pattern for code-review pipeline.
                     P4 RUN_REVIEW (re-engagement) — prior code-review + hasNewUpstreamPassSince('qa').
                     P5 WAIT_FOR_REWORK, P6 RUN_REVIEW (first-run), P7 CLAIM_WP.
  - Documentation: 7+1b per-WP algorithm (§14.5):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.documentation >= MAX.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — any of impl|qa|code-review >= MAX.
                     P2 RESUME_OR_CANCEL, P3 CONTINUE_PIPELINE (same stale/active pattern).
                     P4 REWORK (self) — documentation FAIL + !hasNewUpstreamPassSince guard.
                     P5 FINALIZE_WP — doc PASS + all criteria met + freshness check
                          (doc completed_at >= latest impl started_at). Replaces MARK_COMPLETE.
                     P5b UPDATE_CRITERIA — doc PASS + freshness + at least one criterion not met.
                     P6 WRITE_DOCS — code-review PASS + fresh or first documentation run.
                     P7 CLAIM_WP — READY WP assigned to Documentation.
  - Synthesis: Wait until all work packages are terminal (COMPLETE or CANCELLED)
  ↓
Return recommendation:
  {
    action: "IMPLEMENT" | "CLAIM_WP" | "CONTINUE_PIPELINE" | "REWORK" |
            "WAIT_FOR_DOWNSTREAM" | "BLOCK_FOR_REWORK_LIMIT" | "WAIT_FOR_REWORK" |
            "WAIT_FOR_UPSTREAM_REWORK_LIMIT" |
            "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | "REWORK_DOCS" |
            "FINALIZE_WP" | "UPDATE_CRITERIA" |
            "RESUME_OR_CANCEL" | "REVIEW_STALE" | "REVIEW_ABANDONED" | "REVIEW_REWORK_LIMIT" |
            "UNBLOCK_WP" | "REPAIR_ORPHAN_BLOCKED" | "ROUTE_PIPELINE_AGENT" |
            "GENERATE_SYNTHESIS" | "WAIT" | ...,
    work_package_id?: "WP-###",
    reason: "...",
    // RESUME_OR_CANCEL includes: pipeline_type, started_at, age_hours
    // ROUTE_PIPELINE_AGENT includes: next_agent, pipeline_type
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
  - Planner: If no WPs have been created → READY_FOR_PM (signal PM to begin task decomposition)
             Otherwise → READY_FOR_PM or WAIT based on overall completion state

  - Developer (§5.1): Operates on non-terminal, non-dependency-blocked WPs ("activeWps")
      1. Temporal guard — for each activeWP: if the most recent downstream pipeline (qa or
         code-review) is FAIL AND hasDownstreamReengagedSince(implementation) = true
         → IN_PROGRESS  (Developer must rework; downstream has already re-engaged)
      2. Needs QA — for each non-dependency-blocked WP: PASS implementation exists AND
         hasNewUpstreamPassSince("implementation", "qa") = true
         → READY_FOR_QA  (covers first-run and post-rework re-delivery)
      3. All terminal — all WPs are COMPLETE or CANCELLED → READY_FOR_SYNTHESIS
      4. Active work — any WP is IN_PROGRESS with assigned_to === "Developer" → IN_PROGRESS
      → WAIT

  - QA (§5.2): Operates on non-terminal, non-dependency-blocked WPs
      1. Re-engagement (BEFORE FAIL short-circuit) — most recent QA pipeline is FAIL AND
         hasNewUpstreamPassSince("implementation", "qa") = true
         → IN_PROGRESS  (QA should re-engage; Developer has since re-delivered)
      2. FAIL short-circuit — most recent QA pipeline is FAIL (step 1 guard was false)
         → READY_FOR_DEVELOPER
      3. READY_FOR_REVIEW — non-terminal WPs where PASS QA exists AND
         hasNewUpstreamPassSince("qa", "code-review") = true; check if all such are
         dependency-blocked → if non-empty unblocked subset → READY_FOR_REVIEW
      4. All terminal → READY_FOR_SYNTHESIS
      5. IN_PROGRESS assigned to QA → IN_PROGRESS
      → WAIT

  - Reviewer (§5.3): Mirror of QA applied to the code-review pipeline stage
      1. Re-engagement (BEFORE FAIL short-circuit) — most recent code-review pipeline is FAIL
         AND hasNewUpstreamPassSince("qa", "code-review") = true → IN_PROGRESS
      2. FAIL short-circuit — most recent code-review is FAIL (step 1 guard was false)
         → READY_FOR_QA
      3. READY_FOR_DOCUMENTATION — non-terminal WPs where PASS code-review exists AND
         hasNewUpstreamPassSince("code-review", "documentation") = true; dependency-block
         routing applies → READY_FOR_DOCUMENTATION or READY_FOR_SYNTHESIS
      4. All terminal → READY_FOR_SYNTHESIS
      5. IN_PROGRESS assigned to Reviewer → IN_PROGRESS
      → WAIT

  - Documentation (§5.4, §14.5 priority — ready-for-docs BEFORE self-rework FAIL):
      1. Ready-for-docs — non-terminal WPs where PASS code-review exists AND
         (no documentation pipeline yet OR hasNewUpstreamPassSince("code-review", "documentation")
         = true) → IN_PROGRESS  (new docs or re-engagement after upstream rework)
      2. FAIL self-rework — most recent documentation pipeline is FAIL (step 1 guard was false)
         → IN_PROGRESS  (handled internally; never forwarded to Developer)
      3. allDocsPassed — all non-dependency-blocked unreviewed WPs have PASS documentation →
           non-empty unblocked subset → READY_FOR_SYNTHESIS; all dep-blocked → WAIT
      4. wpsNotYetReviewed remain — dependency-block routing:
           not all dep-blocked → READY_FOR_REVIEW; all dep-blocked → READY_FOR_SYNTHESIS
      → WAIT

  - Project Manager (§13.1): Operates on full WP list
      1. Non-dependency blockers — BLOCKED WP with technical/external/decision blocker
         → IN_PROGRESS  (PM must intervene; dependency-blocked WPs are skipped here)
      2. READY WPs — readyStatusForAgent(wp.assigned_to) routes to READY_FOR_QA,
         READY_FOR_DEVELOPER, etc. based on assigned agent; unassigned WPs route via
         PIPELINE_AGENT_MAP[firstActiveStage(wp)] to the first-stage owner
      2b. IN_PROGRESS WPs needing next pipeline stage (fires only when no READY WPs in step 2):
          For each non-terminal, non-dependency-blocked IN_PROGRESS WP, scans ordered active stages:
            - PASS stage → continue to next; FAIL stage → break (downstream handles it)
            - IN_PROGRESS stage → break (already in flight); upstream IN_PROGRESS → break
            - otherwise → readyStatusForAgent(PIPELINE_AGENT_MAP[stage])
          Covers stage-transition routing (e.g. impl PASS → READY_FOR_QA) and freshly-claimed
          WPs with zero pipelines (routes to first active stage's agent).
      3. All terminal → READY_FOR_SYNTHESIS
      → WAIT
  ↓
Return handoff block:
  {
    agent: "QA" | "Reviewer" | "Documentation" | "Synthesis" | "Developer" | ...,
    status: "READY_FOR_QA" | "READY_FOR_REVIEWER" | "READY_FOR_SYNTHESIS" | ...
  }
```

**Key invariant:** The dependency-blocked check is applied symmetrically across all handoff functions. A work package is considered dependency-blocked when `wp.status === 'BLOCKED'` and `blocked_by` is absent or `blocked_by.type === 'dependency'` (single-parameter `isBlockedByDependencies(wp)`). WPs blocked by incomplete dependencies are excluded from "work remaining" counts — they do not prevent progression to the next stage.

**Temporal guard invariant:** Re-engagement detection (`hasDownstreamReengagedSince`, `hasNewUpstreamPassSince`) is applied before FAIL short-circuits in all handoff functions. Auto-cancelled pipelines are excluded from both the upstream PASS lookup and downstream timestamp comparisons during these checks.

**Result:** Agent receives the `AGENT: <next> / STATUS: <status>` handoff block.

---

## Flow 9: Self-Healing Counter and Status Correction

**Entry Point:** Agent invokes `ledger_get_project_status` tool

```
Agent → ledger_get_project_status(project_path)
  ↓
LedgerStore.readRootIndex()
  ↓
computeHealedStatus(rootIndex)  [pure function — no I/O]
  ↓
  Recompute counters from work_packages array:
    - totalWps = work_packages.length
    - pendingWps = count where status is not terminal (not COMPLETE and not CANCELLED)
  ↓
  Corruption mitigation (§17.2 known-gap):
    If synthesis_generated === true AND pendingWps > 0:
      → treat synthesisGenerated as false for all rule evaluation
      → set corruptionDetected = true
      → (write callback will call clearSynthesisState(fresh) to prevent a repeated-write loop)
  ↓
  Auto-heal project status (first-match-wins; 16 rules from §17.2):
    1.    (IN_PROGRESS|READY) + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
    1b.   READY  + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    1c.   IN_PROGRESS + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS (preserve)
    2.    COMPLETE + pendingWps>0 → IN_PROGRESS  (reopen / drift repair)
    2b.   COMPLETE + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    3.    READY + hasInProgressWp → IN_PROGRESS
    3b.   READY + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
    3c.   IN_PROGRESS + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
    4.    BLOCKED + hasInProgressWp → IN_PROGRESS
    4b.   BLOCKED + hasReadyWp + !hasInProgressWp → READY
    5a.   BLOCKED + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
    5b.   BLOCKED + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    6b.   (IN_PROGRESS|BLOCKED) + totalWps==0 → READY
    6c.   COMPLETE + totalWps==0 → READY
    (CANCELLED projects fall through all rules unchanged)
  ↓
  needsWrite = true when any counter differs, status changed, or corruptionDetected
  ↓
  Return { totalWps, pendingWps, healedStatus, needsWrite, corruptionDetected }
  ↓
If needsWrite is false:
  computePipelineHealth(rootIndex, store)  [outside lock — read-only, no write path]
    Iterate rootIndex.work_packages; skip any with status === 'CANCELLED'
    For each non-CANCELLED WP: store.readWorkPackage(wpId)
      If readable: getPassedStages(wpDetail) → passed Set<string>
        activeCount = wp.active_pipeline_stages.length (if field is set and non-empty)
                   OR DEFAULT_PIPELINE_STAGES.length (4 — legacy default when field is absent)
        missing = activeCount − passed.size
        If missing === 0: increment wps_with_all_stages_pass
        Else: increment wps_missing_stages; add missing to total_stages_missing
      If unreadable: silently skip (catch{}, contributes nothing)
    → { wps_with_all_stages_pass, wps_missing_stages, total_stages_missing }
  Return { ...rootIndex, pipeline_health } to agent

  (No legacy repairs run on this path — repairs are triggered only when needsWrite,
   needsLegacyVersionBackfill, or needsForwardCompatWarning is true.)
  ↓
Pre-lock computation (outside lock — safe because these only read, not write):
  validatePipelineOrdering(rootIndex, store) — reads WP detail files only
    For each WP: read detail, check that pipeline started_at timestamps are monotonically
    non-decreasing. Any violation captured as a warning string. Read failures silently skipped.
  Pre-compute synthesis repair comment dedup check (note text match against project_comments)
  Pre-compute forward-compat warning dedup check (note text match against project_comments)
  ↓
If needsWrite OR needsLegacyVersionBackfill OR needsForwardCompatWarning
   OR orderingWarnings.length > 0 OR needsSynthesisRepairComment is true:
  withLock(store.storageDir)  ← SINGLE lock scope for ALL repairs (consolidated from 3)
    ↓
    Re-read rootIndex under lock (fresh copy) — TOCTOU symmetry
    computeHealedStatus(fresh) again
    Re-check all dedup conditions against fresh copy
    ↓
    needsAnyWrite = freshHealed.needsWrite || freshNeedsVersionBackfill ||
                    freshNeedsForwardCompatWarning || orderingWarnings.length > 0 ||
                    freshNeedsSynthesisRepairComment
    ↓
    If needsAnyWrite:
      Status/counter corrections (if freshHealed.needsWrite):
        fresh.total_work_packages = totalWps
        fresh.pending_work_packages = pendingWps
        fresh.status = healedStatus
        if corruptionDetected: clearSynthesisState(fresh)  ← prevents repeated-write loop
      Legacy synthesis_generated_at repair (if legacySynthesisTimestampRepair):
        fresh.synthesis_generated_at = fresh.last_updated
      Legacy ledger_version backfill (if absent):
        fresh.ledger_version = SPEC_VERSION (silent — no comment)
      Forward-compat warning (if ledger_version > SPEC_VERSION, deduplicated):
        Emit warning project_comment
        (semver comparison uses isFinite() guard — pre-release segments like '2.5.0-beta' that
         produce NaN are skipped gracefully, preventing false forward-compat warnings)
      Pipeline ordering warnings:
        Append each captured warning as project_comment { type:'warning', priority:'low', agent:'system' }
      Synthesis timestamp repair comment (deduplicated — pre-lock + in-lock pattern):
        Append soft warning project_comment if not already present
      fresh.last_updated = now()
      LedgerStore.writeRootIndex(fresh)
    Release lock
  ↓
  computePipelineHealth(corrected, store)  [same as no-write path; uses corrected root index]
    → { wps_with_all_stages_pass, wps_missing_stages, total_stages_missing }
  Return { ...corrected, pipeline_health } to agent
```

**Result:** Root index counters, project status, and legacy fields are automatically corrected if they drift out of sync. The corruption mitigation prevents a premature `synthesis_generated` flag from causing a repeated-write loop on every `getProjectStatus` call. Pipeline ordering warnings are appended as system comments whenever healing was triggered. Disk writes only occur when corrections are needed and are always performed under lock with a fresh re-read to avoid race conditions. In all response paths, the response includes a `pipeline_health` sub-object reporting aggregate stage completeness across all non-CANCELLED WPs (see `ledger_get_project_status` in `api-surface.md` for the full schema).

---

## Flow 10: Pipeline Cancellation

**Entry Point:** Agent invokes `ledger_cancel_pipeline` tool

```
Agent → ledger_cancel_pipeline(project_path, work_package_id, type, reason)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
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
withLock(store.storageDir)
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
  - All terminal (COMPLETE or CANCELLED)? → Return single GENERATE_SYNTHESIS (for Synthesis) or empty array
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic (same as Flow 7, but collects ALL matches):
  - Project Manager: Find all actionable WPs across P1–P3c (UNBLOCK_WP, REVIEW_REWORK_LIMIT,
                     REVIEW_STALE, REVIEW_ABANDONED, REPAIR_ORPHAN_BLOCKED)
  - Developer: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, RESUME_OR_CANCEL,
                     CONTINUE_PIPELINE, REWORK, WAIT_FOR_DOWNSTREAM, IMPLEMENT, CLAIM_WP)
  - QA: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, WAIT_FOR_UPSTREAM_REWORK_LIMIT,
                     RESUME_OR_CANCEL, CONTINUE_PIPELINE, RUN_QA, WAIT_FOR_REWORK, CLAIM_WP)
  - Reviewer: Find all WPs across P1–P7 (same pattern for code-review pipeline)
  - Documentation: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, WAIT_FOR_UPSTREAM_REWORK_LIMIT,
                     RESUME_OR_CANCEL, CONTINUE_PIPELINE, REWORK, FINALIZE_WP, UPDATE_CRITERIA,
                     WRITE_DOCS, REWORK_DOCS, CLAIM_WP)
  - Synthesis: Wait until all work packages are terminal (COMPLETE or CANCELLED)
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

**Context:** `auto_handoff_depth` is a safeguard against infinite agent-chain loops. `buildHandoffResponse` in `src/tools/workflow-handoff.ts` manages the increment on every handoff-status response. The reset to `0` is performed by `completeSynthesis` in `src/tools/project-lifecycle.ts` per §18.4.

**Ceiling:** `effectiveMaxDepth(root.total_work_packages ?? 0)` — dynamic per §18.2.1: `max(configMax, totalWorkPackages × 30)`, where `configMax = getMaxHandoffDepth()` (default 50, runtime-configurable via `gui-config.json`). The floor ensures small projects still get a meaningful ceiling (50+ handoffs); larger projects scale proportionally.

### 13a: Storage Location

```
root index (storage/ledger/{repoName}/{slug}/project-ledger.json)
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
  [currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)?]
    YES → store.writeRootIndex({ ...root, auto_handoff_depth: currentDepth + 1 })
          agentId = getAgentId(nextAgent)          // null when persona has no id: frontmatter field
          agentNames = AGENT_NAMES[nextAgent]       // loaded from personas/name-mapping.json at startup
          auto_handoff object is included in the response payload:
            {
              agent_name:    agentHandle,                        // VS Code display name from Agent Registry
              agent_id:      agentId ?? (omitted),               // omitted when null — not serialized
              cc_agent_name: agentNames.claude_code.agent_name,  // e.g. "3-developer"
              vs_agent_name: agentNames.vscode.agent_name,       // e.g. "3 - Developer v3.6.1"
              da_agent_name: agentNames.deep_agents.agent_name,  // e.g. "3-developer"
              prompt:        buildHandoffPrompt(projectPath, agentId)
            }
    NO  → auto_handoff is omitted from the response (depth exceeded — see 13d)
```

### 13c: Reset Path (synthesis complete)

```
Agent invokes ledger_complete_synthesis
  ↓
completeSynthesis() — src/tools/project-lifecycle.ts
  ↓
withLock() callback
  ↓
store.readRootIndex()
  ↓
rootIndex.synthesis_generated = true
rootIndex.outcome_summary = args.outcome_summary  ← required 2–3 sentence summary
rootIndex.auto_handoff_depth = 0
rootIndex.status = 'COMPLETE'  (if all WPs are done)
  ↓
store.writeRootIndex(rootIndex)  ← single atomic write
  propagates outcome_summary to .meta.json via key-presence check ('outcome_summary' in validated)
  ↓
Response includes: { synthesis_generated: true, outcome_summary, project_status, ... }
```

The reset is performed atomically alongside `synthesis_generated: true` in the same `writeRootIndex` call, inside the `withLock` callback. `buildHandoffResponse` no longer performs the reset. `outcome_summary` is echoed in the success response body so callers receive confirmation of what was persisted.

### 13d: Depth-Exceeded Path (chain terminated)

```
currentDepth >= effectiveMaxDepth(root.total_work_packages ?? 0)
  ↓
auto_handoff key is NOT included in the response payload
  ↓
No error thrown — no warning emitted
  ↓
Agent chain terminates; manual routing by the user is required
```

**Result:** The automatic handoff chain allows up to `effectiveMaxDepth(totalWorkPackages)` consecutive agent invocations (floor 50, scales to `totalWPs × 20` for larger projects per §18.2.1) before requiring human intervention, preventing runaway loops while preserving normal multi-agent workflows.

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
READY ──────────────────────────────────────────────────► CANCELLED (PM-only, terminal)
  │  ↑                                                         ▲
  │  │ (unclaim, §21.13)                                       │
  ▼  │                                                         │ (PM-only)
IN_PROGRESS ──────────────────────────────────────────────────┤
  │  ▲                                                         │
  │  │                                                         │
  ▼  │                                                         │
BLOCKED                                                        │
  │                                                            │
  ▼                                                            │
IN_PROGRESS → COMPLETE ──────────────────────────────────────┘
                   │
                   ▼
             IN_PROGRESS (revision++)
```

Simplified table view:

| From        | To            |
|-------------|---------------|
| READY       | IN_PROGRESS   |
| READY       | BLOCKED       |
| READY       | CANCELLED     |
| IN_PROGRESS | COMPLETE      |
| IN_PROGRESS | BLOCKED       |
| IN_PROGRESS | READY         |
| IN_PROGRESS | CANCELLED     |
| BLOCKED     | IN_PROGRESS   |
| BLOCKED     | READY         |
| BLOCKED     | CANCELLED     |
| COMPLETE    | IN_PROGRESS   |
| COMPLETE    | CANCELLED     |

`CANCELLED` is the only fully terminal status — no outward transitions. Every transition is validated before being applied.

---

## Flow 14: Synthesis Completion

**Entry Point:** Synthesis agent (or Project Manager) invokes `ledger_complete_synthesis` tool

```
Agent → ledger_complete_synthesis(project_path, agent_role, outcome_summary, synthesis_file?)
  ↓
withLock(store.storageDir, async () => {
  Guard 1 (§19.1): agent_role must be "Synthesis" or "Project Manager"
    → Error if not
    ↓
  LedgerStore.readRootIndex()
    ↓
  Guard 2 (§19.1): compute fresh totalWps and pendingWps from work_packages array
    (ignores stale pending_work_packages counter)
    ↓
  Guard 3 (§19.1): totalWps must be > 0
    → Error "Cannot complete synthesis: no work packages exist"
    ↓
  Guard 4 (§19.1): pendingWps must be 0
    → Error if any WPs remain non-terminal (uses freshly computed count)
    ↓
  Set synthesis_generated = true
  Set outcome_summary = args.outcome_summary  ← required; Zod rejects absent/null
  Reset auto_handoff_depth = 0  (§18.4)
  Set last_updated = now()
    ↓
  Set project status to COMPLETE (all guards passed)
    ↓
  LedgerStore.writeRootIndex(updatedRoot)
    propagates outcome_summary to .meta.json via 'outcome_summary' in validated check
    ↓
  store.archiveDocuments([synthesis_file])  — best-effort; inside lock scope
    ↓
    copyFile(join(planPath, synthesis_file), join(storageDir, synthesis_file))
    Error → appended to skipped[], warning → stderr
    Success → appended to archived[]
    ↓
  Assign result content block to outer-scope 'let result!'
})
  ↓
Return result + { outcome_summary, archived_documents, archive_skipped? }
```

**Result:** All four §19.1 guards must pass before `synthesis_generated` is set. The `outcome_summary` field (required, non-nullable in the input schema) is persisted to both the root index (`project-ledger.json`) and the `.meta.json` enrichment cache, and echoed in the success response. The `synthesis_generated` flag prevents re-triggering `GENERATE_SYNTHESIS`. The `auto_handoff_depth` reset (§18.4) prevents stale depth counts on future projects. Not idempotent with respect to guard failures — a call with a pending WP or wrong role returns an error. The full read-modify-write cycle is protected by `withLock` to prevent TOCTOU races when multiple agents run concurrently. A copy of `synthesis_file` (default `synthesis.md`) is stored inside the lock scope in `storage/ledger/{repoName}/{slug}/` as an archived reference (best-effort; missing source is silently skipped).

---

## Flow 15: Acceptance Criteria Management

**Entry Point:** Project Manager invokes `ledger_update_acceptance_criteria` tool

```
PM → ledger_update_acceptance_criteria(project_path, work_package_id, agent_role, operations)
  ↓
Guard: agent_role must be "Project Manager"
  → Error if not (checked before file lock is acquired)
  ↓
withLock(store.storageDir, async () => {
  LedgerStore.readRootIndex() + LedgerStore.readWorkPackage()
    ↓
  Guard: WP must not be CANCELLED
    → Error if CANCELLED
    ↓
  Clone acceptance_criteria array
    ↓
  Apply operations sequentially on clone:
    remove:       find exact criterion text match → remove entry
                  → Error if no match found
    modify_text:  find exact old_criterion match → replace criterion text
                  new_criterion must be non-empty/non-whitespace
                  met flag is preserved (text change only)
                  → Error if old_criterion not found or new_criterion blank
    ↓
  Guard: post-mutation clone must have ≥ 1 criterion remaining
    → Error if all criteria were removed
    ↓
  Commit cloned array atomically to WP detail + root index
})
  ↓
Return success message listing applied operations
```

**Result:** The PM can remove stale or incorrect criteria and fix criterion text without altering evaluation state (`met` flags). The zero-criteria guard ensures every WP always has at least one testable acceptance criterion. All mutations are atomic — a partial batch never leaves the WP in an intermediate state.

---

## Flow 16: Synthesis Document View (GUI)

**Entry Point:** User navigates to `#/projects/:repo/:slug/synthesis` in the dashboard

```
Browser hash → #/projects/:repo/:slug/synthesis
  ↓
Router.dispatch()
  ↓
synthesisMatch = path.match(/^\/projects\/([^/]+)\/([^/]+)\/synthesis$/)
  ↓
renderSynthesis(app, decodeURIComponent(synthesisMatch[1]), decodeURIComponent(synthesisMatch[2]))
  ↓
  app.innerHTML = '<p class="loading">Loading synthesis…</p>'   ← immediate feedback
  ↓
  API.getSynthesisDocument(slug)
  → fetch('GET', '/api/projects/:slug/synthesis')
  ↓
  server.ts routes to handleGetSynthesisDocument(ledgerRoot, slug)
    ↓
    assertSafeSlug(slug)
    LedgerStore.ledgerDirExists()   ← NOT_FOUND if project absent
    readFile(storage/ledger/{repoName}/{slug}/synthesis.md, 'utf-8')
    → Return { content: "<markdown>" }
    ← 404 NOT_FOUND if synthesis.md absent or project absent
  ↓
  marked.parse(result.content)   ← client-side Markdown → HTML
  ↓
  app.innerHTML =
    <breadcrumb: Projects / {slug} / Synthesis> +
    <div class="synthesis-content">{html}</div>

On NOT_FOUND:
  app.innerHTML =
    <breadcrumb: Projects / {slug} / Synthesis> +
    <p class="empty-state">Synthesis document not available for this project.</p>

On other errors:
  app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>'
```

**Synthesis link on Project Detail page:**

```
User navigates to #/projects/:repo/:slug
  ↓
renderProjectDetail(app, repo, slug) calls Promise.all([API.getProject(slug), API.getPlanDocument(slug)])
  ↓
project.synthesis_generated === true?
  YES → inject <div class="synthesis-link-row"><a href="#/projects/:repo/:slug/synthesis">View synthesis →</a></div>
  NO  → nothing rendered (no HTTP call)
```

**Key design:**
- The synthesis link is driven by `project.synthesis_generated` (already in the `GET /api/projects/:slug` response — no extra HTTP call).
- The "not available" empty state handles projects where `synthesis_generated` is `true` but `synthesis.md` was not archived (e.g. race or skipped archival).
- `.synthesis-content` shares all typography CSS rules with `.plan-content` via multi-selector (DRY — no duplicated rules).

---

## Flow 12: Auto-Archive Background Service

**Entry Point:** `gui/server.ts` startup (and every 10 minutes thereafter)

### Flow 12a: Timer initialization (server startup)

```
gui/server.ts main()
  ↓
readConfigFromDisk(configPath)    ← populates in-memory config cache
startConfigWatcher(configPath)    ← watches for GUI-driven config changes
  ↓
startAutoArchiveTimer(ledgerRoot)
  ↓
  _intervalHandle !== null?
    YES → no-op (idempotency guard)
    NO  →
      tick()              ← runs immediately on startup
      setInterval(tick, 600_000)   ← then every 10 minutes
```

### Flow 12b: Single archive scan tick

```
tick()
  ↓
getConfig().auto_archive_days   ← reads live in-memory config (no disk I/O)
  ↓
auto_archive_days === 0?
  YES → return (archiving disabled)
  NO  →
    runAutoArchive(ledgerRoot, maxAgeDays)
      ↓
      LedgerStore.listAllProjects(ledgerRoot)
        → readdir(storage/ledger/)
        → parse each .meta.json
      ↓
      For each ProjectMeta:
        status !== 'COMPLETE'? → skip
        last_updated unparseable? → skip + stderr warning
        ageMs < thresholdMs? → skip (not stale enough)
        ↓ (eligible)
        withLock(store.storageDir, async () => {
          store.readRootIndex()
          store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' })
            → atomicWriteJson(project-ledger.json)
            → store.writeProjectMeta()   ← synced automatically
              → atomicWriteJson(.meta.json)
        })
        ↓
        archived.push(meta.slug)
        process.stderr.write('[auto-archive] Archived ...')

      Any per-project error → caught, logged to stderr, scan continues
      ↓
      Return archived[]
```

**Key properties:**
- `maxAgeDays === 0` short-circuits before any disk I/O (no `listAllProjects` call).
- Per-project errors are isolated — one corrupted project never aborts the full scan.
- Both `.meta.json` and `project-ledger.json` are updated atomically inside a single `withLock` scope.
- Timer reads `getConfig()` on every tick; changing `auto_archive_days` in the GUI takes effect on the next interval without restarting the server.
- Only `COMPLETE` projects are eligible — `IN_PROGRESS`, `READY`, `BLOCKED`, and already-`ARCHIVED` projects are never touched.
- All output (archived confirmations, skips, errors) goes to `stderr` only.

---

## Flow 14: GUI — Orchestrator Run Log Listing (with Self-Healing)

**Entry Point:** Browser sends `GET /api/projects/:slug/runs` when the project detail page loads.

```
GET /api/projects/:slug/runs
  ↓
gui/server.ts → assertSafeSlug(slug) → handleListRunLogs(slug, logsDir, legacyLogsDir?)
  ↓
src/gui/handlers/run-log-handlers.ts — handleListRunLogs
  assertSafeSlug(slug)   ← throws ApiError NOT_FOUND for empty / '/' / '..'
  migrateOrphanedLogs(logsDir, legacyLogsDir, slug)  ← if legacyLogsDir supplied;
                                                         moves *-{slug}.jsonl files from legacy dir
                                                         into logsDir when logsDir has none; no-op otherwise
  findRunLogs(logsDir, slug)
  ↓
src/gui/log-resolver.ts — findRunLogs
  readdir(logsDir)       ← returns [] if directory absent/unreadable
  filter by suffix "-{slug}.jsonl" (prefix required — exact suffix rejected)
  for each matching filename:
    isRunActive(filePath) ← reads last non-empty JSONL line;
                            active = no terminal action (run_end / run_error);
                            empty file = active; parse error = inactive
  sort descending by filename (lexicographic; timestamp prefix makes this chronological)
  ↓
Self-healing pass (entries at index 1+):
  for each non-newest entry where is_active === true:
    appendFile(filePath, '\n' + JSON.stringify({ action: 'run_error', error: '...healed...', ts: '...' }) + '\n')
    entry.is_active = false
  (failures swallowed — best-effort only; newest run at index 0 is never touched)
  ↓
Return RunLogEntry[]
  [{ filename: '20260325T090000-slug.jsonl', is_active: true  },   ← newest, potentially running
   { filename: '20260324T120000-slug.jsonl', is_active: false },   ← healed if was stale
   { filename: '20260323T100000-slug.jsonl', is_active: false }]   ← completed or healed
```

**Frontend rendering (`views/project-detail.js`):**
- Array is already sorted newest-first by the server
- Assigns chronological run numbers: oldest = #1, newest = #N (index 0 = #N)
- Only index 0 can show a "Running" badge (`is_active` on older entries is ignored client-side as a second defence)
- Timestamp parsed from filename prefix (YYYYMMDDTHHmmss) and formatted via `formatDate()`

**Key properties:**
- Self-healing is idempotent: once a stale file gains a `run_error` closing entry, it will never be re-healed
- Healing runs as a side-effect of the GET — no dedicated endpoint or background job needed
- `logsDir` is the project's ledger storage directory (`{ledger_root}/{slug}/`); logs written there by the orchestrator post-run
- `legacyLogsDir` (optional) is the old flat `orchestrator/logs/` directory — passed by `server.ts` to enable lazy migration of pre-archival runs
- Security: slug validated in both `server.ts` dispatch and handler; filename validated in `readLogEntries` (allowlist + path escape check)

---

## Flow 13: GUI — Paginated Project Listing

**Entry Point:** Browser or client sends `GET /api/projects` (with optional query params)

```
GET /api/projects?page=1&limit=50&status=ACTIVE&search=&sort=last_updated&dir=desc
  ↓
gui/server.ts
  → URLSearchParams.parse(request.url query string)
  → handleListProjects(ledgerRoot, rawParams)
  ↓
gui/api.ts — handleListProjects processing pipeline:

  Step 1: Enrich all projects
    LedgerStore.listAllProjects(ledgerRoot)   ← readdir + .meta.json parse
    For each ProjectMeta (concurrent Promise.all):
      Cache fast-path (WP-006):
        meta.total_work_packages defined AND meta.project_name defined?
          YES → use cached values directly (no disk I/O)
          NO  → readRootIndex() + readManifestFile() → enrich + write cache to .meta.json
    → ProjectSummary[]
  ↓
  Step 2: Search filter (if search param present)
    case-insensitive string.includes() on slug, project_name, repository_name
    → filtered ProjectSummary[]
  ↓
  Step 3: Compute status_counts
    Reduce filtered set (BEFORE status filter) into Record<status, count>
    → e.g. { COMPLETE: 12, IN_PROGRESS: 3, ARCHIVED: 5 }
  ↓
  Step 4: Status filter
    ACTIVE  → exclude only status === 'ARCHIVED'
    ALL     → include everything
    specific value → include only exact status match
  ↓
  Step 5: Sort (by sort+dir params)
    'last_updated' | 'date_created' | 'title' | 'slug' | 'status' | 'done'
    string fields use localeCompare; desc default
  ↓
  Step 6: Paginate
    start = (page - 1) * limit
    projects = sorted.slice(start, start + limit)
    total_pages = Math.max(1, Math.ceil(total / limit))
  ↓
  Return ProjectListEnvelope {
    projects: ProjectSummary[];  // page slice only
    total: number;               // post-filter count
    page: number;
    limit: number;
    total_pages: number;
    status_counts: Record<string, number>;
  }
```

**Param validation (before pipeline runs):**
- `page`: parseInt; NaN or <1 → clamped to 1
- `limit`: parseInt; NaN → 50; 0 → 1; >200 → 200
- `status`: must be in `VALID_STATUS_FILTERS` Set; unknown → 'ACTIVE'
- `sort`: must be in `SORT_FIELDS` Set; unknown → 'last_updated'
- `dir`: must be 'asc' or 'desc'; otherwise → 'desc'
- `search`: trimmed; empty → no filter applied

**Key properties:**
- `status_counts` reflects the search-filtered universe (not the status-filtered page). Supports UI badge counts that show totals per status regardless of active filter.
- Per-project enrichment failures are isolated; one unreadable project never breaks the full response.
- Out-of-range page returns empty `projects[]` with `total` and `total_pages` still correctly set.
- The entire enrichment step runs in memory; pagination is applied last (no streaming).

---

## Flow 14: Frontend Namespace Resolution

**Entry Point:** Browser navigates to a project page, triggering `handleListProjects` or direct project API calls.

This flow describes how the frontend resolves the `repository_name` (repo namespace) from the project listing and uses it to construct namespaced `/:repo/:slug` API URLs for all subsequent per-project requests.

```
Browser → GET /api/projects[?page&limit&status&search&sort&dir]
  ↓
gui/server.ts → handleListProjects(ledgerRoot, rawParams)
  ↓
gui/api.ts — handleListProjects():
  LedgerStore.listAllProjects(ledgerRoot)
  → ProjectSummary[] (each includes repository_name from .meta.json)
  ↓
ProjectListEnvelope returned to browser:
  {
    projects: [{
      slug: string,
      repository_name: string,   ← repo-namespace key
      ...
    }, ...],
    ...
  }
  ↓
Browser (gui/public/views/project-list.js):
  For each project in the list, stores both project.slug and project.repository_name
  Navigation link: #/projects/{repository_name}/{slug}
  ↓
Router dispatches to renderProjectDetail(app, repo, slug)
  where repo = project.repository_name, slug = project.slug
  ↓
gui/public/views/project-detail.js — renderProjectDetail(app, repo, slug):
  All API calls use namespaced pattern:
    GET /api/projects/{repo}/{slug}
    GET /api/projects/{repo}/{slug}/plan
    GET /api/projects/{repo}/{slug}/synthesis
    GET /api/projects/{repo}/{slug}/work-packages
    GET /api/projects/{repo}/{slug}/work-packages/overview
    POST /api/projects/{repo}/{slug}/reset
    ...
  ↓
gui/server.ts → resolveRepoName(ledgerRoot, repoUrlParam, slugUrlParam)
  Validates repoUrlParam and slugUrlParam via assertSafeSlug()
  Reads {ledgerRoot}/{repoUrlParam}/{slugUrlParam}/.meta.json
  Returns stored repository_name (falls back to repoUrlParam if absent/malformed)
  ↓
Handler called with (ledgerRoot, resolvedRepo, slug):
  Constructs storage path: {ledgerRoot}/{resolvedRepo}/{slug}/project-ledger.json
  ↓
Returns project data to browser
```

**Key invariant:** `repository_name` is the canonical namespace — it is stored in `.meta.json` at project initialization time and flows from the server to the browser in every `ProjectSummary`. The browser never constructs repo segments from user input; it always reads `repository_name` from the API response.

**Legacy fallback:** Non-namespaced `/:slug` routes (deprecated) call `resolveRepoName()` to derive the correct repo segment from disk before delegating to the same handlers. This ensures backward compatibility for any client still using the old URL form.

**`resolveRepoName()` guard:** Both `repoUrlParam` and `slugUrlParam` are validated via the file-local `assertSafeSlug()` guard before any filesystem access. Invalid segments and missing meta files both throw `ApiError NOT_FOUND` (information-hiding — distinguishable from the client side only by intent, not by error shape).

---

## Flow N: Knowledge Accumulation (Synthesis → Insight Store)

**Entry Point:** Synthesis agent calls `ledger_search_insights` and/or `ledger_add_insight` during the Knowledge Collection phase (before `ledger_complete_synthesis`).

### N.1 Deduplication Check

```
Synthesis agent → ledger_search_insights(query, scope?, category?, repository_name?, limit?)
  ↓
resolveLedgerRoot()  ← centralised ledger root (same root used by all ledger operations)
  ↓
KnowledgeStoreManager.searchInsights(query, filters)
  ↓
_loadInsights(filters)
  Store selection:
    scope: 'repository' + repository_name → readRepositoryStore(repoName)   only
    scope: 'global'                        → readGlobalStore()                only
    no filters                             → readGlobalStore() +
                                             all {repository_name}-insights.json stores
  ↓
For each loaded KnowledgeStore:
  InsightSchema.parse() on each entry  ← schema validation; malformed entries skipped
  Filter by scope / category (if specified)
  ↓
Substring match (case-insensitive) against title, content, each tag
  ↓
Post-filter by tags array (AND semantics, if provided)
Apply limit slice (if provided)
  ↓
Return matched Insight[] (each augmented with formatted_id: 'KN-NNNN') to agent
```

**Result:** Agent receives a list of matching insights. If a substantively similar insight exists, agent skips the commit (deduplication). If no match or a complementary match, agent proceeds to commit.

### N.2 Insight Commit

```
Synthesis agent → ledger_add_insight(scope, repository_name?, title, content, category, tags, source?, confidence?)
  ↓
KnowledgeStoreManager.addInsight(fields)
  ↓
Scope guard: scope === 'repository' && !repository_name → throw Error (repository_name required)
  ↓
withLock(knowledgeDir(), async () => {        ← single lock scope for entire read-modify-write
  storePath = scope === 'global'
    ? globalStorePath()
    : repositoryStorePath(repoName)   ← _validateSlug(repoName) enforced (SLUG_REGEX); 'global' is reserved
    ↓
  store = await _readStore(storePath)          ← returns empty KnowledgeStore if file absent
    ↓
  insight = { id: store.next_id, ...fields, created_at: now() }
  store.insights.push(insight)
  store.next_id += 1
  store.last_updated = now()
    ↓
  await atomicWriteJson(storePath, store)      ← write-to-temp-then-rename
})
  ↓
Return { ...insight, formatted_id: 'KN-NNNN' } to agent
```

**Result:** New insight committed to `{ledgerRoot}/.knowledge/global-insights.json` (scope: global) or `{ledgerRoot}/.knowledge/{repository_name}-insights.json` (scope: repository). The `.knowledge/` directory is created on first write. All reads are lock-free; only write operations acquire the lock.

**Storage layout:**
```
{ledgerRoot}/.knowledge/
  .lock                              — lock file created by withLock
  global-insights.json               — scope: 'global' insights
  {repository_name}-insights.json    — scope: 'repository' insights for each repository
```

---

## Flow O: GUI Knowledge Endpoints (HTTP)

These five HTTP endpoints expose the knowledge store to the browser dashboard. All routes are registered in `gui/server.ts` and delegate to handler functions in `gui/api-knowledge.ts` (extracted from `gui/api.ts` in WP-003), which call `KnowledgeStoreManager` for storage operations.

**Dispatch tier summary:**

| Tier | Routes | Mechanism |
|------|--------|-----------|
| Body-free | `GET /api/knowledge`, `DELETE /api/knowledge/:id`, `POST /api/knowledge/:id/promote` | `matchRoute()` — segment-count and method guards; params from query string |
| Body-parsing | `PATCH /api/knowledge/:id`, `POST /api/knowledge/:id/move` | `handleRequest()` special cases — regex path match, `readJsonBody`, 1 MiB body limit |

---

### O.1: GET /api/knowledge — List or Search Insights

```
Browser → GET /api/knowledge?scope=global&category=testing&tags=ts,vitest&query=timeout&limit=20&offset=0
  ↓
gui/server.ts matchRoute()
  method === 'GET', rest === ['knowledge']
  → parse query string: scope, category, tags (comma-split), repository_name, query, limit, offset
  ↓
handleListKnowledge(ledgerRoot, params)
  ↓
  query present?
    YES → KnowledgeStoreManager.searchInsights(query, { scope, category, repository_name, tags, limit, offset })
          (substring match → tag intersection filter → offset/limit pagination — all in searchInsights())
    NO  → KnowledgeStoreManager.listInsights({ scope, category, tags, repository_name, limit, offset })
  ↓
  Return Insight[] (each augmented with formatted_id)
  ↓
gui/server.ts → HTTP 200 { data: Insight[] }
```

**Key notes:**
- `scope` validated via `InsightScope.safeParse()` — unrecognised non-undefined values throw `VALIDATION_ERROR` (HTTP 400). Omitting `scope` (undefined) means "no scope filter" and returns all insights. This brings `handleListKnowledge` into contract parity with all four mutating handlers: `handleDeleteKnowledge`, `handlePromoteKnowledge`, `handleUpdateKnowledge`, and `handleMoveKnowledge`, which all throw `VALIDATION_ERROR` for absent or unrecognised scope values (WP-001 hardening).
- `tags` is comma-separated: `"ts,vitest"` → `["ts", "vitest"]`.
- `limit` and `offset` coerced to non-negative integers; invalid values default to `undefined`/`0`.
- When `query` is present, `tags`, `limit`, and `offset` are forwarded to `searchInsights()` — full-text search, tag filtering (AND semantics), and pagination can be combined in a single call.

---

### O.2: DELETE /api/knowledge/:id — Delete Insight

```
Browser → DELETE /api/knowledge/42?scope=repository&repository_name=my-repo
  ↓
gui/server.ts matchRoute()
  method === 'DELETE', rest === ['knowledge', '42']
  → parse :id (decodeURIComponent, raw string)
  → parse scope, repository_name from query string
  ↓
handleDeleteKnowledge(ledgerRoot, rawId, scope, repository_name)
  ↓
  parseKnowledgeId(rawId)  ← throws VALIDATION_ERROR for non-integer, zero, or float
  InsightScope.safeParse(scope)  ← throws VALIDATION_ERROR if absent or not 'global'|'repository'
  repository_name required when scope === 'repository'  ← throws VALIDATION_ERROR if absent
  SLUG_REGEX.test(repository_name)  ← throws VALIDATION_ERROR for malformed slugs (WP-004)
  ↓
  KnowledgeStoreManager.deleteInsight(id, { scope, repository_name })
    withLock(knowledgeDir())
      readStore → find insight by id → splice → atomicWriteJson
  ↓
  Return null
  ↓
gui/server.ts → HTTP 204 No Content
```

**ID validation order:** ID is validated first; scope validation runs second. When both are invalid, the caller receives a VALIDATION_ERROR for the ID.

---

### O.3: POST /api/knowledge/:id/promote — Promote Project Insight to Global

```
Browser → POST /api/knowledge/42/promote?scope=repository&repository_name=my-repo
  ↓
gui/server.ts matchRoute()
  method === 'POST', rest === ['knowledge', '42', 'promote']
  → parse :id (decodeURIComponent)
  → parse scope, repository_name from query string
  ↓
handlePromoteKnowledge(ledgerRoot, rawId, scope, repository_name)
  ↓
  parseKnowledgeId(rawId)  ← throws VALIDATION_ERROR for non-integer, zero, or float
  scope must be 'repository'  ← scope='global' throws VALIDATION_ERROR ("already global")
  repository_name required    ← throws VALIDATION_ERROR if absent
  SLUG_REGEX.test(repository_name)  ← throws VALIDATION_ERROR for malformed slugs (WP-004)
  ↓
  KnowledgeStoreManager.moveInsight(id, { scope: 'repository', repository_name }, 'global')
    ← atomic: reads both stores, writes target then source in a single withLock(knowledgeDir()) span
    → new insight assigned next_id from global store; new ID differs from original
    → throws 'Insight with id N not found' on miss (caught → ApiError NOT_FOUND)
  ↓
  Return new global Insight (new numeric ID — NOT the original repository-scoped ID)
  ↓
gui/server.ts → HTTP 200 { data: Insight }
```

**⚠ ID-change semantics:** The returned insight's `id` is the new global store ID, NOT the pre-promote repository-scoped ID. Frontend consumers that track which insight was promoted must capture the original ID before calling this endpoint — see `handlePromoteKnowledge` in `api-surface.md`.

**Atomicity (WP-002/WP-003):** `moveInsight()` performs the cross-store read-modify-write inside a single `withLock(knowledgeDir())` span — eliminating the TOCTOU race between the former separate add and delete calls. No intermediate state is observable.

---

### O.4: PATCH /api/knowledge/:id — Update Insight Fields

```
Browser → PATCH /api/knowledge/42
  Body: { "scope": "repository", "repository_name": "my-repo", "title": "Updated title", "tags": ["ts"] }
  ↓
gui/server.ts handleRequest() special case
  knowledgePatchMatch = /^\/api\/knowledge\/([^/]+)$/.exec(path)
  method === 'PATCH' && knowledgePatchMatch !== null
  → rawId = decodeURIComponent(knowledgePatchMatch[1])
  ↓
  readJsonBody(req)  ← enforces MAX_BODY_BYTES (1 MiB) limit
    PayloadTooLargeError → HTTP 413
  ↓
handleUpdateKnowledge(ledgerRoot, rawId, body)
  ↓
  parseKnowledgeId(rawId)  ← throws VALIDATION_ERROR for non-integer, zero, or float
  KnowledgeUpdateBodySchema.safeParse(body)
    .strict() — unknown fields rejected
    scope required; repository_name required when scope === 'repository'
    superseded_by: null is valid (field-clearing semantics)
    → throws VALIDATION_ERROR on parse failure
  ↓
  superseded_by: null → mapped to undefined before forwarding
  ↓
  KnowledgeStoreManager.updateInsight(id, updates, { scope, repository_name })
    withLock(knowledgeDir())
      readStore → find insight by id → merge updates → sets updated_at → atomicWriteJson
  ↓
  Return updated Insight
  ↓
gui/server.ts → HTTP 200 { data: Insight }
```

**Immutable fields:** `id`, `scope`, `repository_name`, `created_at` cannot be changed via PATCH — they are excluded from `KnowledgeUpdateBodySchema`.

---

### O.5: POST /api/knowledge/:id/move — Move Insight to Another Repository

```
Browser → POST /api/knowledge/42/move
  Body: { "source_scope": "global", "repository_name": "target-repo" }
  ↓
gui/server.ts handleRequest() special case
  knowledgeMoveMatch = /^\/api\/knowledge\/([^/]+)\/move$/.exec(path)
  method === 'POST' && knowledgeMoveMatch !== null
  → rawId = decodeURIComponent(knowledgeMoveMatch[1])
  ↓
  readJsonBody(req)  ← enforces MAX_BODY_BYTES (1 MiB) limit
    PayloadTooLargeError → HTTP 413
  ↓
handleMoveKnowledge(ledgerRoot, rawId, body)
  ↓
  parseKnowledgeId(rawId)  ← throws VALIDATION_ERROR for non-integer, zero, or float
  KnowledgeMoveBodySchema.safeParse(body)
    .strict() — unknown fields rejected
    source_scope required; source_repository_name required (handler-enforced) when source_scope === 'repository'
    repository_name required (destination)
    source and destination must differ (source_scope='repository' + source_repository_name === repository_name → VALIDATION_ERROR)
    → throws VALIDATION_ERROR on parse failure
  ↓
  KnowledgeStoreManager.moveInsight(id, { scope: source_scope, repository_name: source_repository_name }, 'repository', repository_name)
    ← atomic: reads both stores, writes target then source in a single withLock(knowledgeDir()) span
    → new insight assigned next_id from target store; new ID differs from original
    → throws 'Insight with id N not found' on miss (caught → ApiError NOT_FOUND)
  ↓
  Return new target Insight (new numeric ID — NOT the original source ID)
  ↓
gui/server.ts → HTTP 200 { data: Insight }
```

**Supported move variants:**
- `global → repository`: moves a global insight into a named repository store.
- `repository → repository`: moves a repository insight to a different repository (`source_repository_name !== repository_name` enforced).

**Atomicity (WP-002/WP-003):** `moveInsight()` performs the cross-store read-modify-write inside a single `withLock(knowledgeDir())` span — the former non-atomic add→delete compose pattern (which left a TOCTOU window) is fully replaced. No intermediate state is observable.

---

## Flow O.6: GUI — Resume Run

**Entry Point:** User clicks "Resume Run" button in the project detail view

```
project-detail.js (no active queue entry, run-metadata cell rendered)
  ↓
API.getRunMetadata(slug)
  ↓
GET /api/projects/:slug/run-metadata
  ↓
handleGetRunMetadata(ledgerRoot, slug, repoName?)
  ↓
  resolveProjectPlanPath(ledgerRoot, slug, repoName?) → planPath
    → NOT_FOUND if project has no meta.plan_path
    → path-traversal check via assertSafeSlug()
  ↓
  fs.readFile(path.join(planPath, '.orchestrator-run.json'))
    → NOT_FOUND (HTTP 404) if file absent
  ↓
  JSON.parse(content)
  → RunMetadata { thread_id, plan_path, slug, result, dry_run, … }
  ↓
HTTP 200 { data: RunMetadata }
  ↓
project-detail.js resume-button condition check:
  thread_id present AND dry_run === false
  AND result !== 'SUCCESS' AND result !== null
  AND project status not COMPLETE or ARCHIVED
  → render <button class="btn-resume">Resume Run</button>

User clicks Resume Run
  ↓
btn.disabled = true
API.orchestratorStart(planPath, false, threadId)
  ↓
POST /api/orchestrator/start
  Body: { planPath, dryRun: false, resumeThreadId: threadId }
  ↓
handleOrchestratorStart(workspaceRoot, body)
  ↓
  Zod: body.planPath — required string
  Zod: body.resumeThreadId — optional; if present must match UUID v4 regex
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    → HTTP 400 VALIDATION_ERROR if invalid
  ↓
  startOrchestrator(planPath, workspaceRoot, dryRun=false, resumeThreadId)
  ↓
  (pre-flight checks: binary exists, plan file exists, no active process)
  ↓
  spawn(['--resume', resumeThreadId, resolvedPlan], { detached: true, … })
    child.unref()  ← survives GUI server exit
  ↓
HTTP 200 { started: true, pid }
  ↓
project-detail.js polls run queue every 3 s
  → re-renders project detail once active entry appears
  → if no entry within timeout: re-enables button + shows inline error
```

**Result:** The orchestrator process resumes the existing LangGraph thread identified by
`resumeThreadId`, continuing from the last checkpoint. The GUI polls the queue until the
new run entry appears, then re-renders the project detail view to reflect the active run.

```