# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas.

### Constraint Entry Format

New constraint entries should follow this structure (modelled on Constraint 2):

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Workflow Specification Governance

### 0. The Workflow Specification Is the Source of Truth for All Workflow Logic

**Rule:** The [Workflow Specification](../workflow-specification/README.md) is the authoritative definition of all workflow logic — state machines, pipeline routing, status transitions, handoff behavior, recommendation engine behavior, edge cases, and constants. Implementation code must conform to the specification. When code contradicts the specification, the code is wrong.

**Spec-first development:** Changes to workflow logic MUST be made in the specification first, then implemented in code, then validated by tests, then documented in the project manifest — in that order.

**Test traceability:** Test descriptions SHOULD reference the workflow specification section they validate (e.g., `// §14.13 row 1: returns true when QA FAIL started after impl PASS completed`). This convention is already practiced in several test files and should be followed consistently.

**Rationale:** The specification was designed to be a language-agnostic, formally reviewed reference. Treating code as the source of truth defeats this purpose and leads to silent behavioral drift between the TypeScript (MCP server) and Python (orchestrator) implementations.

**Scope:** This constraint applies to workflow logic only — file I/O, schema validation, concurrency primitives, and other infrastructure concerns are governed by their respective constraints below and the project manifest.

---

## File System Constraints

### 1. All File I/O Must Be Atomic

**Rule:** Never write directly to target files. Always use the `atomicWriteJson()` function.

**Rationale:** Ensures readers never see partial writes or corrupt JSON.

**Implementation:** Write to `{file}.tmp.{pid}`, then atomically rename to target.

**Anti-pattern:**
```typescript
// ❌ WRONG — direct write; a crash mid-write leaves the target file truncated or corrupt
await fs.writeFile(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
```

**Correct pattern:**
```typescript
// ✅ CORRECT — write to .tmp.{pid}, then rename; readers never see a partial file
await atomicWriteJson(targetPath, data);
```

---

### 2. Dual-File Updates Require Locking

**Rule:** When writing both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use the appropriate high-level method: `LedgerStore.createWorkPackageWithSync()` for creating a new WP, `LedgerStore.updateWorkPackageWithSync()` for updating a single existing WP, or `LedgerStore.batchUpdateWorkPackagesWithSync()` for updating multiple WPs in one operation (see Constraint 2b). Only fall back to a manual `withLock(store.storageDir, ...)` scope when none of these methods covers the use case. **`store.storageDir` is the only acceptable first argument to `withLock` — never pass `projectPath`, `ledgerRoot`, or `ledgerRoot ?? projectPath`.** Once a `LedgerStore` is constructed, use its `.storageDir` property to obtain the canonical lock directory.

**Extension — Single-File Read-Modify-Write:** Even when updating only the root index, any read-modify-write sequence must also be wrapped in `withLock(store.storageDir, ...)` to prevent TOCTOU races. Example: `completeSynthesis` reads the root index, mutates `synthesis_generated` and project status, then writes it back — this entire sequence must occur inside a single lock scope.

**Rationale:** Prevents race conditions and dual-file desync when multiple agents run concurrently.

**Anti-pattern:**
```typescript
// ❌ WRONG — race condition risk
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — atomic dual-file creation (new WP)
await store.createWorkPackageWithSync(async (root) => {
  // ... build new WP detail and updated root ...
  return { wpId, wp: newWpDetail, root: updatedRoot };
});

// ✅ CORRECT — atomic dual-file update (existing WP)
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... update both wp and root ...
  return { wp: updatedWp, root: updatedRoot };
});
```

---

### 2b. Batch Multi-WP Writes Must Use `batchUpdateWorkPackagesWithSync`

**Rule:** When updating multiple work packages and the root index in a single operation, always use `LedgerStore.batchUpdateWorkPackagesWithSync()`. Never loop over `updateWorkPackageWithSync()` calls or acquire multiple separate `withLock` scopes to write a batch of WPs — this produces one lock acquisition per WP instead of one per operation.

**Rationale:** A loop of per-WP lock acquisitions is not atomic at the operation level: a crash or concurrent write between iterations can leave some WPs updated while others are not, desynchronizing WP state and the root index. `batchUpdateWorkPackagesWithSync` consolidates all reads, validation, writes, and the root index sync into a single lock scope.

**Atomicity invariant (two-pass validate-then-write):** The method validates all WPs via Zod **before** writing any of them. A validation failure on any WP in the batch aborts the entire operation with no disk writes. This is stronger than the per-WP atomicity provided by `updateWorkPackageWithSync`, which validates and writes one WP at a time.

**Note on lock-scope vs. rollback-scope atomicity:** If a file write succeeds for WP-A but a subsequent I/O error prevents writing WP-B, WP-A's write is not rolled back. This characteristic is shared with `updateWorkPackageWithSync`. Validation failures are fully atomic (no writes); I/O failures after the write phase begin are not.

**Anti-pattern:**
```typescript
// ❌ WRONG — multiple lock acquisitions; not atomic across the batch
for (const wpId of candidateIds) {
  await store.updateWorkPackageWithSync(wpId, (wp, root) => {
    // ...
    return { wp: updatedWp, root: updatedRoot };
  });
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — single lock; all WPs validated before any write
await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
  const updatedWps = new Map<string, WorkPackageDetail>();
  for (const wpId of candidateIds) {
    const wp = await readWp(wpId);
    // ... mutate wp ...
    updatedWps.set(wpId, wp);
  }
  // ... mutate root ...
  return { updatedWps, root: updatedRoot };
});
```

**Known callers:** `propagateDependencyUnblock` and `propagateDependencyReblock` in `src/tools/work-package.ts`; `applyProjectReset` and `markProjectComplete` in `src/utils/project-reset.ts`.

---

### 2c. `writeWorkPackage` and `writeRootIndex` Are `@internal` — Tool Code Must Not Call Them Directly

**Rule:** `LedgerStore.writeWorkPackage()` and `LedgerStore.writeRootIndex()` are marked `@internal` in source. Tool functions (`src/tools/`) and shared helpers (`src/utils/`) must never call these methods directly. All WP+root writes must go through one of the three sync methods (Constraints 2 and 2b).

**Rationale:** Bypassing the sync methods skips `last_updated` auto-stamping, Zod validation, `.meta.json` sync, and the single-lock atomicity guarantee. The `@internal` tag is documentation-only (TypeScript does not enforce it) — this constraint encodes the boundary as a project rule.

**Legitimate direct callers of `writeRootIndex` (non-tool code):**
- `src/tools/project-lifecycle.ts` — `getProjectStatus()` self-healing: repairs stale counter fields under an explicit `withLock` scope; `initializeProject()` and `completeSynthesis()` for root-index-only transitions that don't involve any WP file write
- `auto-archive.ts` — sets `status: 'ARCHIVED'` with `preserveLastUpdated: true` (root-index write only; sync methods do not apply)
- `observations.ts` — appends a project-level comment (root-index write only; no WP file involved)
- `workflow-handoff.ts` — `buildHandoffResponse()`: increments or caps the `auto_handoff_depth` counter on every handoff-status response; root-index-only write with no WP file involvement

**`writeWorkPackage` — zero external callers (post-WP-002):** As of the WP-002 migration (consolidate-wp-writes), `writeWorkPackage` has no legitimate external callers. Every previously-direct caller (e.g., `project-reset.ts`) has been migrated to a sync method. The `@internal` boundary for `writeWorkPackage` is now absolute.

**Anti-pattern:**
```typescript
// ❌ WRONG — bypasses auto-stamping, validation, and .meta.json sync
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:** Use `updateWorkPackageWithSync`, `createWorkPackageWithSync`, or `batchUpdateWorkPackagesWithSync` as shown in Constraints 2 and 2b.

---

### 3. Paths Must Be Absolute

**Rule:** All MCP tool inputs require absolute paths for `project_path`.

**Rationale:** The server has no concept of "current working directory" — it must be told explicitly where files live.

---

### 4. Plan Folders Must Remain Human-Readable Markdown Only

**Rule:** No machine-generated files (JSON, lock files, etc.) may be written inside plan folders.

**Rationale:** Plan folders are the authoritative human source-of-truth. Machine output lives in the centralized ledger at `{mcp-server}/storage/ledger/{slug}/`.

**Archiving clarification:** `archiveDocuments()` copies files **from** the plan folder **into** the centralized storage directory (`storage/ledger/{slug}/`). The direction is one-way: plan folder → ledger. The archived copy is read-only from the agent's perspective — it exists for retrieval by the GUI and tooling, not for editing. The original file in the plan folder remains the authoritative source and is never modified by the server. This is fully consistent with Constraint 4: no writes ever occur inside the plan folder.

**`plan_file` validation:** the `plan_file` argument accepted by `ledger_initialize_project` is enforced at parse time by a Zod `.refine()` check: `v === PLAN_ARCHIVE_FILENAME`. Calls with any value other than `'plan.md'` are rejected with a Zod validation error before reaching handler logic. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on the archived plan document having the fixed filename `plan.md`.

**Archive error contract:** `archiveDocuments()` uses a discriminated error strategy:
- Missing source file (`ENOENT`) — the filename is silently added to `skipped[]` and a warning is written to `stderr`. The operation continues with remaining files.
- All other I/O errors (e.g., `EACCES`, `ENOSPC`, `EISDIR`) — the error is **re-thrown** to the caller. Callers must not assume all errors from `archiveDocuments()` are benign; they must be prepared to handle re-thrown non-ENOENT errors.

---

### 5. `.meta.json` Must Be Written Under the Project Lock

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync). Note: `writeRootIndex` is `@internal` — see Constraint 2c for the list of legitimate direct callers.

**Rationale:** Prevents `.meta.json` from lagging behind the root index in a concurrent environment.

---

### 6. Central Ledger Root Is Resolved Once at Startup

**Rule:** `resolveLedgerRoot()` is called once at server startup. The `--ledger-dir <path>` CLI argument overrides the default `{mcp-server}/storage/ledger/` location. The resolved path is logged to stderr.

**Usage:**
```bash
# Override ledger root:
node dist/index.js --ledger-dir /custom/path/to/ledger
```

**Default:** `{mcp-server}/storage/ledger/` (relative to the server package root).

---

### 6b. Ledger Storage Paths Must Include the Repository Namespace Level

**Rule:** Never construct a ledger storage path as `join(ledgerRoot, slug)` or `join(ledgerRoot, slug, filename)`. The canonical storage layout is `{ledgerRoot}/{repoName}/{slug}/` — all paths into the centralized ledger **must** include the `{repoName}` tier. Use one of the two canonical resolution functions:

| Input available | Function | Returns |
|-----------------|----------|---------|
| Absolute plan folder path | `LedgerStore(planPath, ledgerRoot)` constructor | Instance whose `.storageDir` is `join(ledgerRoot, deriveRepoName(planPath), slug)` |
| Bare slug or qualified `{repo}/{slug}` | `resolveProjectDir(slugOrQualified, ledgerRoot)` | Absolute `storageDir` path; then read `.meta.json` to obtain `plan_path` for the constructor |

**Anti-pattern:**
```typescript
// ❌ WRONG — missing the repo-namespace level; two repos with the same slug collide
const store = new LedgerStore(slug, ledgerRoot);
// storageDir resolves to join(ledgerRoot, 'unknown', slug) for most inputs
// — correct only when deriveRepoName(planPath) happens to return 'unknown'
```

**Correct pattern — constructing from plan path (most common):**
```typescript
// ✅ CORRECT — LedgerStore(planPath, ledgerRoot) calls deriveRepoName internally
const store = new LedgerStore(planPath, ledgerRoot);
// storageDir === join(ledgerRoot, deriveRepoName(planPath), slug)
```

**Correct pattern — resolving from a URL slug parameter (GUI handlers):**
```typescript
// ✅ CORRECT — resolveProjectDir probes all namespace dirs to find the one containing slug
const storageDir = await resolveProjectDir(slug, ledgerRoot);
const meta = JSON.parse(await readFile(join(storageDir, '.meta.json'), 'utf-8'));
const store = new LedgerStore(meta.plan_path, ledgerRoot);
```

**Rationale:** The repo-namespaced layout eliminates slug collisions when multiple repositories create identically-named plan folders (e.g., two developers each have a `2026-01-01-initial-setup` plan). Bypassing the namespace level causes different projects to share a storage directory, silently corrupting each other's ledger data.

**See also:** `data-flows.md` §Storage Layout for the full directory structure; `api-surface.md` for `deriveRepoName()`, `resolveProjectDir()`, and `migrateToNamespacedLayout()` signatures.

---

### 7. STDIO Logging Discipline

**Rule:** Never log to `stdout`. All logs must go to `stderr`.

**Rationale:** `stdout` is reserved for the MCP protocol. Logging to `stdout` breaks protocol communication.

**Implementation:**
```typescript
// ✅ CORRECT
console.error('[project-ledger-mcp] Server started');

// ❌ WRONG — breaks MCP protocol
console.log('[project-ledger-mcp] Server started');
```

---

## Schema Constraints

### 8. Work Package IDs Must Follow WP-### Format

**Rule:** All work package IDs must match the regex `/^WP-\d{3,}$/` (e.g., `WP-001`, `WP-042`, `WP-999`, `WP-1000`). The minimum is three digits; there is no upper bound to future-proof projects beyond WP-999.

**Enforcement:** Validated by Zod schemas in `GetWorkPackageSchema`, `CreateWorkPackageSchema` (dependencies array), `ClaimWorkPackageSchema`, `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`, and `AddObservationSchema`, as well as utility functions (`formatWpId()`, `parseWpId()`).

---

### 9. Timestamps Must Use UTC ISO 8601 Format (YYYY-MM-DDTHH:MM:SSZ)

**Rule:** All timestamp fields use UTC ISO 8601 format with a trailing `Z`. Always use the `now()` utility function.

**Anti-pattern:**
```typescript
// ❌ WRONG — local time, inconsistent format
const timestamp = new Date().toLocaleString();
```

**Correct pattern:**
```typescript
// ✅ CORRECT — UTC with trailing Z
const timestamp = now(); // "2026-02-16T18:00:00Z"
```

**Backward compatibility:** `parseTimestamp()` accepts legacy formats (`YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` without Z) for ledger files written by earlier versions.

---

### 10. JSON Must Be Pretty-Printed

**Rule:** All JSON files written by the server must use 2-space indentation and include a trailing newline.

**Rationale:** Human readability and clean git diffs.

**Enforcement:** `atomicWriteJson()` automatically formats as `JSON.stringify(data, null, 2) + '\n'`.

---

## Business Rule Constraints

### 11. Status Transitions Are Enforced

**Rule:** Work package status transitions must follow the legal transition table:

| From | To | Special Conditions |
|------|----|--------------------|
| `READY` | `IN_PROGRESS` | Dependencies must be `COMPLETE` or `CANCELLED` |
| `READY` | `BLOCKED` | None |
| `READY` | `CANCELLED` | PM-only agent guard |
| `IN_PROGRESS` | `COMPLETE` | All acceptance criteria must be met; Documentation agent only |
| `IN_PROGRESS` | `BLOCKED` | None |
| `IN_PROGRESS` | `READY` | None (unclaim path, spec §21.13) |
| `IN_PROGRESS` | `CANCELLED` | PM-only agent guard |
| `BLOCKED` | `IN_PROGRESS` | None (implicitly means blocker resolved); clears `blocked_by` |
| `BLOCKED` | `READY` | All dependencies COMPLETE (auto-unblock); clears `blocked_by` |
| `BLOCKED` | `CANCELLED` | PM-only agent guard |
| `COMPLETE` | `IN_PROGRESS` | Triggers revision increment; Project Manager or Documentation agent only |
| `COMPLETE` | `CANCELLED` | PM-only agent guard |

`CANCELLED` is the only fully **terminal status** — it has no outward transitions. This includes `CANCELLED → CANCELLED` self-transitions — re-cancelling an already-cancelled WP is rejected. `COMPLETE` allows one outward transition (to `CANCELLED`, PM-only).
**Rule:** A work package cannot be marked `COMPLETE` unless all acceptance criteria have `met: true`.

**Enforcement:** `canCompleteWorkPackage()` validator in `ledger_update_work_package_status` tool.

**Error message format:**
```
Cannot mark work package as COMPLETE: the following acceptance criteria are not met:
  - Criterion 1
  - Criterion 2
```

> Full specification: [Workflow Specification §6.2](../workflow-specification/state-machines.md#62-transition-table).

---

### 13. Only Documentation Agent Can Set COMPLETE

**Rule:** The `ledger_update_work_package_status` tool rejects transitions to `COMPLETE` from any agent other than `"Documentation"` or `"Documentation Agent"`.

**Enforcement:** Hard guard in `updateWorkPackageStatus()`. The error message includes the full workflow reminder (Developer → QA → Reviewer → Documentation → COMPLETE).

**Rationale:** Enforces the multi-stage workflow at the MCP server level. Previously this was a persona-level convention only; the guard was added after the 2026-02-22 workflow failure where a Developer agent set COMPLETE directly. As of WP-005, auto-finalize on terminal-stage PASS (see Constraint 13b) is the preferred COMPLETE path — `ledger_update_work_package_status` remains registered for PM and edge-case use only.

> Full specification: [Workflow Specification §6.5, §21.10](../workflow-specification/state-machines.md#65-agent-guards).

---

### 13b. Auto-Finalize on Terminal-Stage Pipeline PASS (WP-005)

**Rule:** When `ledger_complete_pipeline` is called with `status: "PASS"` and the calling agent owns the WP's **last active stage** (terminal stage), the server automatically evaluates whether all acceptance criteria are met **after** applying `acceptance_criteria_updates`. If all criteria are met, the WP is transitioned to `COMPLETE` **within the same lock scope** as the pipeline completion — no separate `ledger_update_work_package_status` call is required.

The terminal stage is determined dynamically: `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t)).at(-1)`. For default WPs (`DEFAULT_PIPELINE_STAGES`), this is `documentation` (Documentation agent). For custom-stage WPs it may be any stage.

**Conditions (all must apply):**
- `type === lastActiveStage` (the last entry in the WP's ordered active stages)
- `status === 'PASS'`
- `agent_role === PIPELINE_AGENT_MAP[lastActiveStage]` (PM overrides bypass auto-finalize)
- All `wp.acceptance_criteria[*].met === true` after applying `acceptance_criteria_updates`

**Response signals:**
- `auto_finalized: true` — WP transitioned to COMPLETE; `pending_work_packages` decremented.
- `auto_finalize_blocked: true` + `unmet_criteria: string[]` — criteria check failed; WP stays IN_PROGRESS.

**Enforcement:** Logic in `completePipeline()` in `src/tools/pipeline.ts` (added in WP-006).

**Dependency unblocking side-effect (§6.3):** When auto-finalize transitions the WP to `COMPLETE`, `propagateDependencyUnblock` is called **after** the main lock is released (consistent with §12.2, Gotcha 8). This transitions eligible BLOCKED dependents to `READY`. Only dependents whose `blocked_by.type` is `'dependency'` (or absent) are eligible — WPs blocked by `'external'`, `'decision'`, or `'technical'` reasons remain BLOCKED.

**Rationale:** The Documentation agent always called `ledger_update_work_package_status` immediately after a PASS pipeline — the transition was unconditional and never conditional. Automating it server-side removes a mandatory extra tool call from every Documentation pipeline, shortening the agent loop by one step.

**`ledger_update_work_package_status` remains registered** for PM and edge-case use (e.g., re-opening a WP, manually completing a WP with prior pipeline history).

---

### 14. Claiming a WP Assigned to Another Agent Requires Override

**Rule:** `ledger_claim_work_package` rejects the claim when the work package's `assigned_to` field differs from the calling `agent` parameter, unless `override: true` is explicitly passed.

**Authorization:** Only the **Project Manager** (`"Project Manager"`) and the **current assignee** (`wp.assigned_to`) are permitted to use `override: true`. Any other agent passing `override: true` will receive a hard rejection error. The guard is conditional on `wp.assigned_to` being set — unassigned WPs bypass the identity check.

**Error message (unauthorized override):**
```
override is restricted to "Project Manager" or the current assignee ("Developer"). You are "Reviewer".
```

**Enforcement:** Hard guard in `claimWorkPackage()` before dependency and status-transition checks.

**Error message format:**
```
Cannot claim work package WP-002: it is assigned to "Documentation" but you are "Developer".

If you need to re-assign this WP, pass override: true.
Otherwise, only claim work packages assigned to your role.
```

**Rationale:** Prevents agents from silently re-assigning WPs outside their remit — the root cause of the 2026-02-22 workflow failure where the Developer agent claimed and completed a Documentation WP.

---

### 15. Dependencies Must Exist Before Creation

**Rule:** When creating a work package, all dependency IDs must already exist in the root index.

**Enforcement:** `ledger_create_work_package` validates dependencies before creating the work package.

**Rationale:** Prevents dangling references.

---

### 16. BLOCKED Status Requires Blocker Object

**Rule:** When transitioning a work package to `BLOCKED`, the `blocked_by` field must be provided.

**Enforcement:** `ledger_update_work_package_status` throws an error if `status: 'BLOCKED'` is passed without `blocked_by`.

---

### 17. Pipelines Require IN_PROGRESS Work Package

**Rule:** A pipeline can only be started on a work package with status `IN_PROGRESS`.

**Enforcement:** `ledger_start_pipeline` validates WP status before creating pipeline.

**Rationale:** Prevents starting work before a work package is claimed.

---

### 18. No Duplicate IN_PROGRESS Pipelines

**Rule:** Only one pipeline of a given type can be `IN_PROGRESS` at a time for a work package.

**Enforcement:** `ledger_start_pipeline` checks for existing `IN_PROGRESS` pipeline of the same type before creating a new one.

**Rationale:** Forces agents to complete or fail a pipeline before retrying.

---

### 19. Pipelines Must Follow the Required Ordering

**Rule:** Pipelines must be started in the order defined by the work package's `active_pipeline_stages` (defaults to `DEFAULT_PIPELINE_STAGES` — `['implementation', 'qa', 'code-review', 'documentation']` — when omitted). Each stage requires a PASS on its immediately preceding active stage. Attempting to start a pipeline without the **most recent** prerequisite pipeline having a `PASS` status throws a descriptive error. A historical PASS followed by a FAIL is not sufficient — the most recent entry is the only one that counts (per §8.2 most-recent-wins semantics).

**Enforcement:** `ledger_start_pipeline` calls `resolvePrerequisite(type, activeStages)` — which filters `CANONICAL_PIPELINE_ORDERING` by the WP's `active_pipeline_stages` and returns the immediately preceding active stage — then finds the most recent pipeline of that prerequisite type via `.at(-1)`, and rejects if it is absent or its status is not `PASS`.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Active pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** The first active stage in the WP's ordering has no prerequisite and can always be started (subject to other constraints). For `DEFAULT_PIPELINE_STAGES`, this is `implementation`.

> Full specification: [Workflow Specification §8](../workflow-specification/pipeline-routing.md).

---

### 20. Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to the `PIPELINE_AGENT_MAP`:

| Pipeline type | Assigned agent |
|---|---|
| `implementation` | `Developer` |
| `qa` | `QA` |
| `security-audit` | `Security Auditor` |
| `code-review` | `Reviewer` |
| `release-engineering` | `Release Engineer` |
| `documentation` | `Documentation` |

**Enforcement:** `ledger_start_pipeline` applies the map atomically alongside the pipeline creation. Both WP detail and root index summary are updated.

---

### 21. Rework Count Increments on Pipeline Retry

**Rule:** When `ledger_start_pipeline` detects a rework, the work package's rework counters are automatically incremented. Rework is detected when either:
- **Direct rework:** The most recent completed pipeline of the same type has `FAIL` status.
- **Downstream rework:** A prerequisite pipeline type was reworked (re-failed) after the last PASS of the current pipeline type.

Auto-cancelled pipelines (`.auto_cancelled === true`) are excluded from both rework-detection checks. This exclusion also applies to **temporal comparison functions** such as `checkRevalidationGuard` — a pipeline with `auto_cancelled: true` is invisible to all time-based guard logic. Auto-cancelled pipelines must never be counted by rework detection, circuit breakers, or any temporal comparison function.

**Primary field:** `rework_counts` — a per-pipeline-type map (`{ implementation?, qa?, code-review?, documentation? }`). This is the authoritative counter going forward.

**Legacy field:** `rework_count` — a scalar counter that was maintained during a prior transition period. **Fully retired as of 2026-02-28.** No production code path writes this field anymore. The in-memory migration in `LedgerStore.readWorkPackage()` (see below) handles any on-disk files that still contain it, but no new writes are emitted.

**Backward-compat migration:** `LedgerStore.readWorkPackage()` performs a lazy in-memory migration: if a file contains `rework_count` but no `rework_counts`, it synthesises `rework_counts: { implementation: rework_count, qa: 0, 'code-review': 0, documentation: 0 }` and removes `rework_count`. This migration is **in-memory only** — no write is triggered; the on-disk file is updated lazily on the next `updateWorkPackageWithSync()` call.

**Enforcement:** `ledger_start_pipeline` applies both rework-detection checks and excludes auto-cancelled pipelines. A history of `[FAIL, PASS]` does **not** trigger an increment because the most recent is `PASS`.

**Initial value:** Both fields are absent (`undefined`) until the first rework; neither is ever initialised to `0` on creation.

| Rework condition | rework_counts change |
|---|---|
| None (no prior failure, no downstream rework) | No increment |
| Direct rework (last same-type FAIL) | rework_counts[type] +1 |
| Downstream rework (prerequisite reworked after last PASS) | rework_counts[type] +1 |

**Circuit breaker:** After incrementing, the effective count is computed as `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), `ledger_start_pipeline` rejects with an error guiding the caller to cancel or restructure. The `getDeveloperAction` function also surfaces `BLOCK_FOR_REWORK_LIMIT` as the highest-priority action for affected WPs.

---

### 22. Handoff Notes Are Routed via resolveNextAgent / resolveFailAgent

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined dynamically based on pipeline status and the WP's `active_pipeline_stages`:

- **On PASS:** `resolveNextAgent(type, activeStages)` returns the owner of the next active stage in canonical order, or `'Synthesis'` when the type is the last active stage.
- **On FAIL:** `resolveFailAgent(type, activeStages)` uses a base routing map extended to all 6 stages. If the base fail-target's stage is absent from `activeStages`, the fallback is the agent that owns the first active stage.

**Routing for the default 4-stage pipeline (`DEFAULT_PIPELINE_STAGES`):**

| Pipeline type | PASS → to_agent | FAIL → to_agent |
|---|---|---|
| `implementation` | `QA` | `Developer` |
| `qa` | `Reviewer` | `Developer` |
| `code-review` | `Documentation` | `Developer` |
| `documentation` | `Synthesis` | `Documentation` |

**Additional types (dynamic, per-WP routing):**

| Pipeline type | PASS → to_agent (next active stage) | FAIL → to_agent (base routing) |
|---|---|---|
| `security-audit` | `Reviewer` (if `code-review` is next active) or subsequent active stage | `Developer` |
| `release-engineering` | `Documentation` (if `documentation` is next active) or subsequent active stage | `Release Engineer` (self-rework) |

> `documentation` and `release-engineering` self-rework on FAIL. All other FAIL paths route to the Developer (base routing). When the base fail-target's stage is absent from the WP's `active_pipeline_stages`, routing falls back to the first active stage's agent.

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // PIPELINE_AGENT_MAP[type], or 'Project Manager (PM Override)' when PM override is active
  to_agent: string;   // resolveNextAgent(type, activeStages) on PASS; resolveFailAgent(type, activeStages) on FAIL
  timestamp: string;
  notes: string[];    // The strings passed in handoff_notes
}
```

**`ledger_complete_pipeline` guards (applied before pipeline lookup):**
1. **WP status guard:** Rejects if `wp.status !== 'IN_PROGRESS'` (defense-in-depth).
2. **Agent role guard:** `agent_role` must match `PIPELINE_AGENT_MAP[type]`. Exception: `agent_role === 'Project Manager'` bypasses this check (PM Override). When PM override is active, `from_agent` is set to `'Project Manager (PM Override)'`.

**Consumption:** `ledger_get_next_action` and `ledger_get_next_actions` include any handoff notes addressed to the requesting agent in their response, so the next agent sees the notes immediately when they ask for their next action.

> Full specification: [Workflow Specification §9, §12](../workflow-specification/pipeline-routing.md).

---

### 22b. PM Handoff Detects Pending Pipeline Stages on IN_PROGRESS WPs (Step 2b Invariant)

**Rule:** Both `getProjectManagerHandoff()` (§13.1, `workflow-handoff.ts`) and `getProjectManagerAction()` (§14.1.2, `workflow-next-action.ts`) MUST scan non-terminal, non-dependency-blocked `IN_PROGRESS` work packages for pending pipeline stages when no `READY` WPs exist. This scan — called **step 2b** in the handoff function and **Priority 3d** in the recommendation engine — is the only mechanism that advances a WP between pipeline stages after a stage PASS, and that bootstraps freshly-claimed WPs with zero pipelines to their first active stage.

**Invariant:** An IN_PROGRESS WP that has a PASS on stage N and no pipeline started for stage N+1 MUST surface as actionable by the PM (either via `ROUTE_PIPELINE_AGENT` action or the equivalent `READY_FOR_<AGENT>` handoff status) before the affected agent can be dispatched. Failure to implement step 2b would leave such WPs silently stuck — the PM would return `WAIT` instead of routing the next agent.

**Guards (all must be applied):**
1. **FAIL guard** — If the most recent non-auto-cancelled pipeline for the current stage is FAIL, break the stage scan for this WP. The stage's own agent handles rework; the PM does not route.
2. **IN_PROGRESS guard** — If the most recent non-auto-cancelled pipeline for the current stage is IN_PROGRESS, break. The stage is already being worked on.
3. **Upstream IN_PROGRESS guard** — If the preceding stage's most recent non-auto-cancelled pipeline is IN_PROGRESS, break. Routing the next stage now would be premature.
4. **Dependency-blocked exclusion** — WPs where `wp.status === 'BLOCKED'` and `blocked_by.type === 'dependency'` (or `blocked_by` is absent) are excluded from step 2b entirely.

**Coverage scenarios:**
- **Stage-transition routing:** WP has implementation PASS and no QA pipeline → PM routes to QA.
- **Zero-pipeline bootstrap:** Freshly-claimed IN_PROGRESS WP with no pipelines → PM routes to first active stage's agent (e.g., Developer for default stages).

**Rationale:** The PM is the only agent whose action/handoff functions have visibility into all WPs simultaneously. Without step 2b, a WP that just received a pipeline PASS would not advance until something else triggered a re-scan. This invariant was added in v2.4.3 (WP-002/WP-003) to eliminate the gap where stage transitions required manual PM intervention.

> Implementation: `workflow-handoff.ts` `getProjectManagerHandoff()` §13.1 step 2b; `workflow-next-action.ts` `getProjectManagerAction()` §14.1.2 Priority 3d.

---

### 23. Pipeline Comments Have No Agent Field

**Rule:** Pipeline-level comments do not include an `agent` field. The agent is inferred from the pipeline type.

**Convention:**
- `implementation` pipeline → Developer
- `qa` pipeline → QA
- `code-review` pipeline → Reviewer
- `documentation` pipeline → Documentation

**Contrast:** Project-level comments include an explicit `agent` field because they are not tied to a specific pipeline.

---

### 24. Incident Comments Require Context

**Rule:** When adding a project comment with `type: 'incident'`, the `context` field is required.

**Enforcement:** `ledger_add_project_comment` throws an error if `type === 'incident'` and `context` is missing.

**Required context fields:**
- `os` — Operating system where incident occurred
- `tool` — Tool or command that caused the incident
- `work_package` (optional) — Associated work package
- `resolved` — Whether the incident is resolved
- `workaround` (optional) — Workaround description

---

## Concurrency Constraints

### 25. Lock Timeout Is 10 Seconds

**Rule:** File locks have a stale timeout of 10 seconds. Locks older than this are considered abandoned and can be forcibly acquired.

**Implication:** If a process crashes while holding a lock, other processes will wait up to 10 seconds before retrying.

---

### 26. Lock Retry Count Is 50

**Rule:** Lock acquisition is retried up to 50 times with 200ms–1000ms exponential backoff before failing.

**Total retry window:** ~10–50 seconds, ensuring coverage of the 10s stale timeout.

---

## Testing Constraints

> **CI gate:** The MCP server Vitest test suite (`npm test` in `mcp-server/`) is enforced on every push and pull request to `main` via `.github/workflows/ci.yml` (`mcp-server-tests` job, Node.js 20). All tests must pass before a PR can be merged.

### 27. Test Timeout Is 10 Seconds

**Rule:** All Vitest tests have a default timeout of 10 seconds.

**Configuration:** Set in `vitest.config.ts`.

**Rationale:** Integration tests may involve multiple file I/O operations and lock acquisitions.

---

### 28. Prefer Real Implementations Over `vi.mock` for Agent Registry and Ledger Tests

**Rule:** When writing tests that involve the agent registry (`discoverAgents`, `isRegistryLoaded`, `getAgentHandle`, `getAgentId`) or `LedgerStore`, use the real implementations backed by a temporary directory rather than `vi.mock`.

**Pattern:**
```typescript
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'test-'));
  agentDir = join(tempDir, 'agents');
  await mkdir(agentDir);
  store = new LedgerStore(tempDir);
});

afterEach(async () => {
  resetRegistry();
  await rm(tempDir, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
});
```

**Rationale:** `vi.mock` creates module-level side-effects that can leak across test files, especially with ES module hoisting. Using real implementations with `resetRegistry()` cleanup eliminates mock side-effects, provides genuine end-to-end coverage, and is consistent with the approach in `tests/utils/agent-registry.test.ts`.

**Reserve `vi.mock` for:** Code paths that touch the network, spawn child processes, or produce uncontrollable side-effects that cannot be isolated with a temp directory.

---

### 29. Always Supply an Isolated Ledger Root When Constructing `LedgerStore` in Tests

**Rule:** Every test file that constructs a `LedgerStore` **must** pass a `mkdtemp`-based temporary directory as the second `ledgerRoot` argument. Omitting the argument (or passing the real `storage/ledger/` path) causes the store to write to production storage, accumulating stale artifact directories across CI and local runs.

**Preferred pattern — use the shared helper:**
```typescript
import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';

let handle: Awaited<ReturnType<typeof createTempStore>>;

beforeEach(async () => {
  handle = await createTempStore(join(tmpdir(), '2026-01-01-test-project'));
});

afterEach(async () => {
  await cleanupTempStore(handle);
});
```

**Why a helper?** `createTempStore(planPath)` in `tests/helpers/create-temp-store.ts` always injects a fresh `mkdtemp` root, making correct isolation the path of least resistance. Never construct `new LedgerStore(path)` with a single argument inside any test.

**Anti-pattern (forbidden):**
```typescript
// ❌ WRONG — writes to production storage/ledger/
const store = new LedgerStore('/absolute/path/to/my-plan');
```

---

### 30. `afterEach` Teardown Variables Must Be Declared in the Same `describe` Scope

**Rule:** Variables cleaned up in an `afterEach` block (e.g. a temp directory path) must be declared in the same `describe` block's scope, not in an outer scope. Referencing a variable from an outer scope is a silent bug — the inner `afterEach` compiles and runs but cleans up the *outer* variable, leaving the inner temp directory on disk.

**Pattern:**
```typescript
describe('my feature', () => {
  let tempDir: string;          // ← declared here
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'my-feature-'));
    store = new LedgerStore(MY_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }); // ← same scope ✅
  });
});
```

**Anti-pattern:**
```typescript
let tempLedgerRoot: string; // ← outer scope

describe('nested', () => {
  let tempDir: string;      // ← different name / inner scope

  beforeEach(async () => { tempDir = await mkdtemp(…); });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true }); // ❌ wrong variable
  });
});
```

---

## Module System Constraints

### 31. All Imports Must Use .js Extensions

**Rule:** Even when importing TypeScript files, use `.js` extensions.

**Example:**
```typescript
// ✅ CORRECT
import { LedgerStore } from '../storage/ledger-store.js';

// ❌ WRONG
import { LedgerStore } from '../storage/ledger-store';
```

**Rationale:** Node16 module resolution requires explicit file extensions for ESM.

---

### 32. No Default Exports

**Convention:** All exports are named exports. No default exports are used.

**Rationale:** Improves refactoring and tooling support.

---

## Validation Constraints

### 33. All Reads Are Validated

**Rule:** Every file read operation validates the JSON against a Zod schema before returning data.

**Enforcement:** `LedgerStore.readRootIndex()` and `LedgerStore.readWorkPackage()` both parse and validate.

**Failure modes:**
- File not found → `ENOENT` error
- Malformed JSON → `SyntaxError`
- Schema mismatch → Zod validation error

---

### 34. All Writes Are Validated

**Rule:** Every file write operation validates data against a Zod schema before writing.

**Enforcement:** `LedgerStore.writeRootIndex()` and `LedgerStore.writeWorkPackage()` call `Schema.parse()` before writing.

**Rationale:** Prevents writing invalid data to disk.

---

## Counter Self-Healing

### 35. Project Status Tool Auto-Corrects Counters and Project Status

**Rule:** `ledger_get_project_status` recomputes `total_work_packages`, `pending_work_packages`, and the project `status` from the `work_packages` array on every invocation.

**Behavior:**
- If counters are incorrect, they are silently corrected.
- If `status === 'READY'` and any WP is `IN_PROGRESS`, status is healed to `IN_PROGRESS`.
- If `status === 'BLOCKED'` and no WP is actually `BLOCKED`, status is healed to `IN_PROGRESS` (pending WPs exist) or `READY` (no pending WPs).
- If `status === 'IN_PROGRESS'` and all WPs are complete (pending = 0, WPs exist), status is healed to `COMPLETE`.
- If `status === 'COMPLETE'` and pending WPs exist, status is healed back to `IN_PROGRESS`.
- An empty project (no WPs) is never auto-healed to `COMPLETE`.
- Healing rules are mutually exclusive and applied in order; only the first matching rule fires.
- The root index is rewritten only when a correction is made.

**Rationale:** Provides fault tolerance against bugs that might cause counter or status drift.

---

## Development & Build Constraints

### 36. Changelog Is the Source of Truth for Versioning

**Rule:** All version changes must be made in `changelog.md` first, then synced to `package.json`.

**Rationale:** Maintains a single source of truth and ensures version history is documented.

**Process:**
1. Update `changelog.md` with new version header:
   ```markdown
   ## v1.0.2 - 2026-02-20
   
   ### Added
   - New feature...
   ```
2. Run `npm run sync-version` to extract version and update `package.json`
3. The MCP server will display the version at startup in STDERR

**Anti-pattern:**
```bash
# ❌ WRONG — manually editing package.json version
vim package.json  # Don't do this!
```

**Correct pattern:**
```bash
# ✅ CORRECT — update changelog first, then sync
vim changelog.md  # Add new version
npm run sync-version
```

---

### 37. Version Sync Runs Automatically Before Dev

**Rule:** The `predev` hook ensures version is synced before running the development server.

**Implication:** You can skip manual `npm run sync-version` if running `npm run dev` — it happens automatically.

**Manual sync needed when:**
- Building for distribution
- Running in production
- CI/CD pipelines
- Testing version display without starting server

---

### 38. Server Version Displays at Startup

**Rule:** The MCP server logs its version to STDERR on startup.

**Example output:**
```
[project-ledger-mcp] Server v1.0.1 started successfully
[project-ledger-mcp] Transport: STDIO
[project-ledger-mcp] Registered tools: ledger_get_project_status, ...
```

**Purpose:** Allows users and CI systems to verify which version is running in their project.

---

### 39. Reopening a COMPLETE Work Package Requires Project Manager or Documentation Agent

**Rule:** When transitioning a work package from `COMPLETE` back to `IN_PROGRESS`, the calling `agent` MUST be `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`). All other agents are rejected.

**Enforcement:** Hard guard in `updateWorkPackageStatus()` in `src/tools/work-package.ts`, applied before the status mutation.

**Error message format:**
```
Cannot reopen work package WP-XXX: only the Project Manager or Documentation agent may transition COMPLETE → IN_PROGRESS.
Hand off to the Project Manager or Documentation agent to formally reopen this work package.
```

**Rationale:** Prevents developer or QA agents from silently reopening completed work, bypassing the formal re-planning and documentation steps.

**Additional effect:** On `COMPLETE → IN_PROGRESS`, rework state is fully reset: `rework_counts` is set to `{}`, `rework_count` is set to `0`, `root.synthesis_generated` is cleared, and `root.synthesis_generated_at` is set to `null`. This ensures that a reopened WP starts with a clean rework slate and prevents the Synthesis agent from being gated by stale synthesis state.

---

### 40. `READY → IN_PROGRESS` Must Use `ledger_claim_work_package`

**Rule:** `ledger_update_work_package_status` rejects `status: 'IN_PROGRESS'` when the WP is currently `READY`. The caller must use `ledger_claim_work_package` instead.

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` that throws an actionable error naming `ledger_claim_work_package` as the correct tool.

**Rationale:** `ledger_claim_work_package` enforces dependency checks and agent identity checks that `ledger_update_work_package_status` does not replicate.

---

### 41. `IN_PROGRESS → READY` (Unclaim) Requires No Active Pipelines

**Rule:** When transitioning a WP from `IN_PROGRESS` back to `READY`, all pipelines must be in a terminal state (non-`IN_PROGRESS`). If any pipeline is currently `IN_PROGRESS`, the transition is rejected with an actionable error.

**Side effect:** On success, `assigned_to` is cleared in both the WP detail file and the root index summary.

**Enforcement:** Guard in `updateWorkPackageStatus()` step 4 in `src/tools/work-package.ts`.

---

### 42. `BLOCKED → BLOCKED` Replaces the Blocker with Guards

**Rule:** A `BLOCKED` work package can be re-blocked with a different `blocked_by` object. This early-return path:
1. **Agent guard:** Only the `"Project Manager"` (or `"Project Manager Agent"`) or the current `wp.assigned_to` may replace a blocker.
2. **Type guard:** Changing a `'dependency'`-type blocker to a non-dependency type (or vice versa) is rejected. Dependency blockers are managed automatically by the system; manual replacement of dependency blockers is disallowed.
3. **Side effect:** `status_changed_at` and `root.last_updated` are set; `pending_work_packages` is unchanged (status remains `BLOCKED`).

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` step 1a.

---

### 43. `IN_PROGRESS → BLOCKED` and `IN_PROGRESS → CANCELLED` Auto-Cancel Active Pipelines

**Rule:** When a WP transitions from `IN_PROGRESS` to `BLOCKED` or `CANCELLED`, all currently `IN_PROGRESS` pipelines are automatically cancelled. Each cancelled pipeline receives `auto_cancelled: true` to distinguish it from deliberate FAIL pipelines.

**Effect on rework detection:** Auto-cancelled pipelines are excluded from both direct and downstream rework detection in `ledger_start_pipeline` (see constraint 21).

**Enforcement:** Pipeline auto-cancellation via `autoCancelActivePipelines(wp, reason)` helper called at steps 8a/8b in `updateWorkPackageStatus()` in `src/tools/work-package.ts`.

---

### 44. `→ COMPLETE` Freshness Check

**Rule:** When transitioning a WP to `COMPLETE`, a freshness check is applied: the most recent non-auto-cancelled `documentation` pipeline PASS must have been recorded **after** the most recent `implementation` pipeline start. If the doc PASS predates the impl start (stale doc), the transition is rejected.

**Exception:** If no `implementation` pipeline exists, or if no `documentation` pipeline has a PASS, the check is skipped (absent timestamps are accepted).

**Absent timestamp permissive default:** If the most recent `documentation` pipeline lacks a `completed_at` timestamp, or if the most recent `implementation` pipeline lacks a `started_at` timestamp, the freshness check is skipped and the `→ COMPLETE` transition is allowed.

**Enforcement:** Freshness check in `canCompleteWorkPackage()` or in `updateWorkPackageStatus()` step 2b.

**Rationale:** Prevents a WP from being completed with documentation that was written before the current implementation cycle, ensuring the docs always reflect the current implementation.

---

### 45. `status_changed_at` Is Set on Every Status Transition

**Rule:** The `status_changed_at` field on a work package is updated on every successful status transition, including `BLOCKED → BLOCKED` blocker replacements (even though the status value itself doesn't change).

**Field type:** UTC ISO 8601 timestamp string (same format as `now()`).

**Enforcement:** Set in `updateWorkPackageStatus()` after every mutation path (early-return paths and main path).

---

### 46. Work Package `assigned_to` Always Starts as `null`

**Rule:** When creating a work package via `ledger_create_work_package`, the `assigned_to` input field is accepted silently but **ignored**. Both the WP detail file and the root index summary are written with `assigned_to: null`.

**Rationale (§9b.1):** Assignment is managed by `ledger_claim_work_package` (transitions to `IN_PROGRESS`) and cleared by `IN_PROGRESS → READY` (unclaim). Pre-populating at creation time bypasses these guards.

**Enforcement:** `createWorkPackage()` in `src/tools/work-package.ts` overwrites the input value.

---

### 47. New BLOCKED Work Packages Receive An Auto-Assigned `blocked_by`

**Rule:** When a work package's initial status is `BLOCKED` (because at least one dependency is not terminal), `blocked_by` is automatically populated:
```typescript
{ type: 'dependency', description: 'Dependency WP-XXX is not complete', blocking_work_package: 'WP-XXX' }
```
where `WP-XXX` is the first unmet dependency.

**Enforcement:** Inside `createWorkPackage()` initial status determination.

---

### 48. Creating a Work Package Must Not Introduce a Dependency Cycle

**Rule:** Before persisting, `createWorkPackage` calls `hasCycle(newWpId, deps, allExistingWps)` (BFS) to verify the new dependency edges don't form a circular dependency. If a cycle is detected, the creation is rejected.

**Error message format:**
```
Dependency cycle detected: WP X would create a circular dependency.
```

**Scope:** `hasCycle` checks forward-reference cycles among existing WPs. Simultaneous batch creation bypasses cycle detection — WPs should be created sequentially.

**Enforcement:** `hasCycle()` pure function at module scope in `src/tools/work-package.ts`, called in `createWorkPackage` step 3b.

---

### 49. Acceptance Criteria Cannot Be Empty or Whitespace-Only

**Rule:** Each string in the `acceptance_criteria` array must be non-empty and non-whitespace after trimming. An empty string or a string containing only spaces/tabs/newlines is rejected.

**Error message format:**
```
Acceptance criteria cannot be empty or whitespace-only.
```

**Enforcement:** Validation loop in `createWorkPackage()` before WP creation, supplementing the Zod-level `.min(1)` array constraint.

---

### 50. Only CLAIMABLE_ROLES Can Claim Work Packages

**Rule:** The `agent` field passed to `ledger_claim_work_package` must be a claimable role. 

**Non-claimable roles:** `Planner`, `Planner Agent`, `Synthesis`, `Synthesis Agent` — these orchestrating roles are excluded from claiming WPs.

**Claimable roles:** `Developer`, `Developer Agent`, `QA`, `QA Agent`, `Reviewer`, `Reviewer Agent`, `Documentation`, `Documentation Agent`, `Project Manager`, `Project Manager Agent`.

**Guard ordering:** The CLAIMABLE_ROLES guard fires at step 1b — unconditionally, immediately after the `READY` status guard and **before** the assignment guard (step 2) and override-auth guard (step 2b). Consequence: a non-claimable role always receives the role error regardless of the WP's `assigned_to` field or whether `override: true` is passed.

**Enforcement:** `CLAIMABLE_ROLES` is a named export at module scope in `src/tools/work-package.ts`, checked in `claimWorkPackage` step 1b. It is derived programmatically from `AGENT_ROLES` by filtering out `ORCHESTRATING_ROLES` (defined in `src/utils/constants.ts`), so adding a new orchestrating role automatically removes it from the claimable set without requiring manual updates.

---

### 52. `agent_role` Is Required for `ledger_start_pipeline` and `ledger_complete_pipeline`

**Rule:** Both `ledger_start_pipeline` and `ledger_complete_pipeline` require an `agent_role` parameter. The value must match the pipeline type's owner role (per `PIPELINE_AGENT_MAP`). Calls that omit `agent_role` or provide a mismatched role are rejected with a descriptive error.

**Exception:** `agent_role: 'Project Manager'` (or `'Project Manager Agent'`) bypasses the type-to-agent match check for any pipeline type (PM Override). When PM override is active, `startPipeline` adds a `[PM Override]` marker to the pipeline summary and `completePipeline` sets the handoff note's `from_agent` to `'Project Manager (PM Override)'`.

**Enforcement:** Agent role guard in `startPipeline()` and `completePipeline()` in `src/tools/pipeline.ts` (steps 1b and 2b respectively), applied after the WP status guard.

**Rationale:** Prevents agents from starting or completing pipelines outside their designated stage, ensuring the pipeline type-to-agent assignment invariant is upheld at runtime.

---

### 51. `propagateDependencyReblock` Auto-Cancels IN_PROGRESS Pipelines

**Rule:** When `propagateDependencyReblock` transitions a non-COMPLETE, non-CANCELLED, non-BLOCKED dependent WP back to `BLOCKED`, all currently `IN_PROGRESS` pipelines on that WP are automatically cancelled with `auto_cancelled: true` (consistent with the `IN_PROGRESS → BLOCKED` behavior enforced by `updateWorkPackageStatus`).

**Additional behaviors:**
- **COMPLETE dependents:** For each `COMPLETE` WP that lists the reopened WP as a dependency, a warning comment is appended to its last pipeline (type: `"warning"`, priority: `"high"`).
- **`synthesis_generated` reset:** If any WP was re-blocked (i.e., `candidates.length > 0`), `root.synthesis_generated` is reset to `false` and `root.synthesis_generated_at` is set to `null` to ensure the Synthesis agent must re-run.
- If no candidates were re-blocked, `synthesis_generated` and `synthesis_generated_at` are **not** changed.

**Enforcement:** `propagateDependencyReblock()` in `src/tools/work-package.ts`.

---

## Manifest Documentation Constraints

### 53. No Implementation Provenance in Manifest Documents

**Rule:** Project manifest documents (`api-surface.md`, `constraints.md`, `data-flows.md`, etc.) describe the **current state** of the codebase. They must not contain work package IDs, plan references, or other implementation-history markers (e.g., `WP-003`, `added in WP-005`, `wired in WP-004`).

**Where provenance belongs:** Plan documents, synthesis reports, and changelog entries — not the manifest.

**Rationale:** WP IDs are scoped to individual plans. A reader who has not ingested the plan history cannot resolve `WP-006` to a meaningful context. Provenance markers also accumulate over time and add noise without aiding comprehension of current behavior.

**What is allowed:** References to `WP-###` as a *data format specifier* (e.g., `work_package_id: string // WP-### format`) are fine — these describe the runtime data model, not implementation history.

---

## GUI API Constraints

### 40. All Slug- and WpId-Accepting GUI Handlers Must Call Their Path-Traversal Guard First

**Rule:** Every GUI API handler in `gui/api.ts` that accepts a path segment parameter must call its corresponding guard as the **first** (slug) or **second** (wpId) statement, before any other processing.

**Guards:**

| Guard | Parameter | Placement | Affected handlers |
|-------|-----------|-----------|-------------------|
| `assertSafeSlug(slug)` | project slug | 1st statement | `handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument` |
| `assertSafeWpId(wpId)` | work-package ID | 2nd statement (after `assertSafeSlug`) | `handleGetWorkPackage` |

**Rejection criteria (both guards):** throws `ApiError` with code `NOT_FOUND` (HTTP 404) if the value:
- is empty (`''`)
- contains a forward slash (`/`)
- contains a double dot (`..`)

**Rationale:** Returning `NOT_FOUND` (rather than `FORBIDDEN`) on traversal attempts is intentional — it avoids leaking structural information about the server's file system to potential attackers. Using HTTP 404 is consistent with the standard "project not found" response.

**Implementation:** Both guards are module-private to `gui/api.ts` (not exported). They must not be bypassed or called after other parameter-dependent operations.

**Acceptance criteria wording:** When writing AC for test cases that exercise `assertSafeSlug` rejection, use:
> *"Invalid slug (e.g. path-traversal attempt) returns 404 NOT_FOUND."*

Do **not** write `"400 VALIDATION_ERROR"` — the guard deliberately returns `NOT_FOUND` (not `VALIDATION_ERROR`) to mask traversal detection. (See [error-ledger.md](../../../../../history/error-ledger.md) — deviation recorded in 2026-03-04-project-reset-rework-1 synthesis.)

---

### 55. Non-PM Handoff Functions Must Dispatch to the Next READY Work Package Before Returning WAIT

**Rule:** Each of the five non-PM handoff functions — `getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`, `getReleaseEngineerHandoff`, and `getDocumentationHandoff` — MUST call `findNextReadyDispatch(wpDetails, '<RoleName>')` as the penultimate step, immediately before the final `return WAIT` fallthrough. If `findNextReadyDispatch` returns a non-null result, the function MUST return that dispatch rather than falling through to WAIT.

**Rationale:** Without this step, completing the last pipeline stage on WP-N leaves the IDE in a stalled state when WP-N+1 is READY but has no pipelines yet. The five affected functions previously returned a bare `WAIT` in this scenario, requiring manual PM intervention to unblock the IDE workflow. The PM handoff already implements this cross-WP dispatch pattern (§13.1 Step 2); this rule extends the same behaviour to all non-PM handoff functions.

**`findNextReadyDispatch` algorithm:**
1. Finds the first READY work package whose dependencies are satisfied (using `isBlockedByDependencies`).
2. Routes to the agent owning its first active pipeline stage (`PIPELINE_AGENT_MAP[firstActiveStage(wp.active_pipeline_stages ?? null)]`).
3. If all WPs are terminal, returns `READY_FOR_SYNTHESIS` (safety-net branch for handoff functions that position cross-WP dispatch before their own all-terminal check).
4. Returns `null` when no deterministic dispatch is possible — the caller falls through to WAIT.

**Self-routing is intentional:** `findNextReadyDispatch` does NOT filter out cases where the target role equals the calling role (`targetRole === currentRole`). Self-routing causes the IDE to visibly declare a new handoff step for the new work package, improving auditability and keeping orchestrator and IDE behaviors aligned.

**Scope:** This is a best-effort optimization for IDE runners. The orchestrator does not depend on it — its supervisor polling loop re-dispatches independently.

**Correct pattern:**
```typescript
// ✅ CORRECT — penultimate step, just before final WAIT return
const dispatch = findNextReadyDispatch(wpDetails, 'Documentation');
if (dispatch) {
  return buildHandoffResponse(
    'Documentation', dispatch.status, dispatch.reason,
    undefined, projectPath, store
  );
}
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

**Anti-pattern:**
```typescript
// ❌ WRONG — returns WAIT without checking for READY WPs
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

---

## Cross-Platform Constraints

### 54. All Code Must Run on Windows, macOS, and Linux

**Rule:** The MCP server must work on all three supported platforms (Windows, macOS, Linux). Do not introduce OS-specific APIs without a cross-platform fallback. Use `path.join()` / `path.resolve()` for all file paths — never hardcode `/` or `\` separators.

**File locking:** Uses `proper-lockfile` (cross-platform npm package). Do not replace with a platform-specific alternative.

**Rationale:** The workspace-wide cross-platform policy (see root `AGENTS.md` → Cross-Platform Policy) applies to all sub-projects. The MCP server runs alongside the user's IDE on their desktop OS.

---

## Gotchas

### ⚠️ Gotcha 1: Revision Only Increments on COMPLETE → IN_PROGRESS

The `revision` field only increments when a work package transitions from `COMPLETE` back to `IN_PROGRESS`. It does not increment on other status changes.

---

### ⚠️ Gotcha 2: Lock File Persists After Server Exit

The `.lock` file inside `storage/ledger/{slug}/` is not automatically deleted when the server exits. It will be left on disk and overwritten on the next lock acquisition.

**Implication:** Safe to ignore — the lock system handles stale locks automatically.

---

### ⚠️ Gotcha 3: Metrics Object Is Extensible

The `metrics` object in pipelines uses `.passthrough()` in Zod, meaning it accepts additional fields beyond the predefined ones (`test_coverage`, `tests_passed`, etc.).

**Use case:** Custom metrics for different pipeline types (e.g., `build_time`, `bundle_size`).

---

### ⚠️ Gotcha 4: Work Package Summaries Are Duplicates

Work package summaries in the root index duplicate a subset of data from the work package detail files.

**Reason:** Performance — agents can list work packages without loading all detail files.

**Invariant:** Summaries must always match the corresponding detail files. This is enforced by `createWorkPackageWithSync()` (creation) and `updateWorkPackageWithSync()` (updates).

---

### ⚠️ Gotcha 6: REWORK Is Triggered Only by the Most Recent FAIL

The REWORK recommendation in `ledger_get_next_action` is based **only on the most recent pipeline** of a given type, not any historical FAIL. A work package with pipeline history `[FAIL, PASS]` does NOT receive a REWORK recommendation — the PASS pipeline means the issue was resolved.

**Why it matters:** Before this was corrected, a WP that failed and then passed (e.g., tests failed, bugs were fixed, tests re-run and passed) would permanently trigger a REWORK recommendation, even though the work was complete. Now only a WP whose most recent pipeline is still `FAIL` will trigger REWORK.

**Implementation:** `isMostRecentPipelineFail(pipelines, pipelineType)` — see [Internal Testing Utilities](api-surface.md#internal-testing-utilities).

---

### ⚠️ Gotcha 7: Documentation Handoff Skips Dependency-Blocked WPs

`getDocumentationHandoff` (and `getQaHandoff`, `getReviewerHandoff`) treat WPs blocked by incomplete dependencies as ineligible for their stage. If all unreviewed/undocumented WPs are dependency-blocked, the handoff returns `READY_FOR_SYNTHESIS` rather than routing the agent back to the Developer.

**Why it matters:** Without this check, a project where the only remaining WPs are blocked by incomplete dependencies would incorrectly route the Documentation Agent back to the Developer stage, stalling the workflow.

---

### ⚠️ Gotcha 8: Dependency Auto-Unblocking Uses a Separate Lock

When a work package transitions to `COMPLETE`, `propagateDependencyUnblock` automatically transitions eligible downstream dependents from `BLOCKED` to `READY`. This runs **after** the main lock in `updateWorkPackageStatus` is released — it acquires its own lock.

**Eligibility rule:** A BLOCKED WP is auto-unblocked only when **all its dependencies are terminal (COMPLETE or CANCELLED) AND its `blocked_by.type` is `"dependency"` or absent**. WPs blocked by `"external"`, `"decision"`, or `"technical"` reasons are intentionally skipped — their blockers must be resolved manually, even if all WP dependencies complete.

**Implication:** There is a brief window between the COMPLETE write and the unblocking write during which the root index shows the WP as COMPLETE but dependents are still BLOCKED. This is safe for single-user workflows, but would be a race condition risk in a concurrent multi-agent environment.

---

### ⚠️ Gotcha 9: WP ID Generation Is Max-Based, Not Length-Based

Work package IDs are generated by scanning the highest existing numeric suffix and adding 1. This means:
- Deleting a WP does not cause ID collisions (unlike a length+1 approach)
- IDs are monotonically increasing but may have gaps (e.g., WP-001, WP-003 if WP-002 was removed)
- IDs can be 3+ digits: the schema regex `/^WP-\d{3,}$/` supports WP-001 through WP-9999+

---

### ⚠️ Gotcha 5: READY Status After Creation Depends on Dependencies

When creating a work package:
- If dependencies are empty or all `COMPLETE` → Initial status is `READY`
- If any dependency is not `COMPLETE` → Initial status is `BLOCKED`

This logic is automatic and transparent to the caller.

---

### ⚠️ Gotcha 10: `acceptance_criteria` Must Have At Least One Entry

The `ledger_create_work_package` tool rejects requests with an empty `acceptance_criteria` array. Zod validation enforces `.min(1)` — at least one criterion string is required. This prevents the degenerate case of a WP that auto-passes all criterion checks.

---

### ⚠️ Gotcha 11: Unknown Criteria Text in `acceptance_criteria_updates` Is Appended

When `ledger_complete_pipeline` is called with `acceptance_criteria_updates`, each update item is matched by exact criterion text:
- **Matched:** updates the `met` flag on the existing entry.
- **Not matched (unknown text):** appends a new `AcceptanceCriterion` entry `{ criterion, met }` to the WP's `acceptance_criteria` array.

---

### ⚠️ Gotcha 12: Pre-mutation State Capture in `updateWorkPackageWithSync` Callbacks

**Rule:** Any variable holding pre-mutation WP or root-index state that is needed **after** the `updateWorkPackageWithSync` callback must be declared with `let` in the **outer scope** and assigned inside the callback. Variables declared with `const` inside the callback are lexically scoped to that callback and are invisible at the call site.

**Anti-pattern:**
```typescript
// ❌ WRONG — const inside callback is NOT visible at the call site
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  const previousStatus = wp.status; // const → invisible outside callback
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
// TS2304: Cannot find name 'previousStatus'  ← compile error
console.log(previousStatus); // ReferenceError at runtime if somehow not caught by TS
```

**Correct pattern:**
```typescript
// ✅ CORRECT — let declared in outer scope, assigned inside callback
let previousStatus = '';
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  previousStatus = wp.status; // assigns to outer-scope let
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
console.log(previousStatus); // ✅ 'READY' — visible after lock completes
```

**Rationale:** `updateWorkPackageWithSync` (and `withLock`) discard the callback's return value for the state-capture use case. Any data produced inside the callback that is needed after it completes must be captured via closure by assigning to an outer-scope `let` variable before the callback runs. This pattern appears throughout `work-package.ts` (e.g., `let createdWpId = ''` in `createWorkPackage`). Failure to follow it produces a TS2304 compile error or, if TypeScript somehow does not catch it, a `ReferenceError` at the call site.

**Alternative correct pattern (`| undefined` union):** When the captured value has no meaningful zero value, use `| undefined` union rather than a non-null assertion (`!`):

```typescript
// ✅ ALSO CORRECT — | undefined union (used in project-lifecycle.ts completeSynthesis)
let result: { status: string } | undefined;
await withLock(store.storageDir, async () => {
  // ... read-modify-write ...
  result = { status: 'COMPLETE' };
});
if (!result) throw new Error('Expected result to be set inside lock');
// result is narrowed to { status: string } here
```

Prefer `| undefined` over non-null assertion (`!`) when the accumulator cannot have a meaningful zero state.

---

### ⚠️ Gotcha 13: `resolveProjectDir()` NOT_FOUND Error Embeds the Absolute `ledgerRoot` Path

The `NOT_FOUND` error thrown by `resolveProjectDir()` includes the absolute filesystem path to `ledgerRoot` in its message:

```
NOT_FOUND: project slug 'my-plan' was not found in any repo namespace under '/absolute/path/to/storage/ledger'.
```

**Caller responsibility:** When `resolveProjectDir()` is wired to a GUI or API handler, the handler **must sanitise this error message before returning it to callers** — strip the filesystem path and retain it only in server-side logs. Returning the raw message to an API consumer leaks internal infrastructure details (A09 — Information Disclosure).

**The `AMBIGUOUS` error is safe** — it contains only `{repo}/{slug}` qualified path strings and does not embed any filesystem path.

**Correct handler pattern:**
```typescript
try {
  const projectPath = await resolveProjectDir(slug, ledgerRoot);
  // ...
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('NOT_FOUND:')) {
    // Sanitise: strip the filesystem path before returning to the caller
    throw new ApiError('NOT_FOUND', `Project '${slug}' was not found.`);
  }
  throw err;
}
```

---

## Code Style Conventions

### 53. Test-Only Exports Must Use the `_internal` Naming Convention

**Rule:** Any module that exposes private symbols for unit testing must export them under a single named export called `_internal`. Do **not** introduce alternative names such as `_schemas`, `_test`, or `_utils`.

**Pattern:**
```typescript
/**
 * @internal — exported for unit testing only.
 */
export const _internal = {
  MyPrivateClass,
  MyInternalSchema,
  myHelperFunction,
};
```

**Rationale:** Consistency and grep-ability. A single naming convention makes it trivial to audit test-only surface (`grep -r '_internal'`) and eliminates `_schemas` / `_test` divergence. The convention was introduced in `work-package.ts` and standardised across all modules in 2026-02-28 (WP-009).

**Enforcement:** `_schemas` exports were renamed to `_internal` in `pipeline.ts` and `observations.ts`. Do not re-introduce `_schemas` or any alternate name.

---

### 54. Prefer `for-of` Loops Over Indexed `for` Loops

**Rule:** Use `for-of` loops for array iteration. Avoid `for (let i = 0; i < arr.length; i++)` indexed loops unless the index itself is required for logic, or a performance constraint is documented.

**When an indexed loop is unavoidable** (e.g. pairwise comparison where both `i-1` and `i` are needed), use non-null-asserted access (`arr[i]!`) with an inline comment explaining the in-bounds guarantee:

```typescript
// TypeScript is compiled with noUncheckedIndexedAccess so array[i] returns T | undefined.
// The loop invariant (i < arr.length) guarantees arr[i] is defined — safe to assert.
for (let i = 1; i < pipelines.length; i++) {
  const prev = pipelines[i - 1]!; // in-bounds: i >= 1
  const curr = pipelines[i]!;     // in-bounds: i < pipelines.length
}
```

**Context:** The project enables `noUncheckedIndexedAccess` in `tsconfig.json`. This means array element access returns `T | undefined`, which requires either a null-check or a `!` assertion. The `for-of` pattern avoids indexed access entirely and is therefore preferred.

---

### 55. Test Helper Infrastructure Mandate

**Rule:** All new test files **must** import shared fixture factories and test utilities from `tests/helpers/fixtures.ts` and `tests/helpers/test-utils.ts`.

**(a)** Any new test file that needs a project root index, WP detail object, or ledger directory must use the canonical factories from `tests/helpers/fixtures.ts` (e.g. `makeProject`, `makeWpDetail`, `injectLedgerDir`, `nowFloor`).

**(b)** Defining a local test-scope fixture factory function is **prohibited** when a canonical equivalent already exists in `tests/helpers/fixtures.ts`. If the helper does not yet exist and is needed by multiple tests, add it to `tests/helpers/` first rather than duplicating it inline.

**(c)** **Rationale:** Prevents per-file fixture divergence, eliminates test-replica maintenance burden, and ensures fixture behaviour (field defaults, schema shape, timestamps) stays consistent across the entire test suite.

**Anti-pattern:**
```typescript
// ❌ WRONG — local factory duplicates the canonical makeWpDetail from tests/helpers/fixtures.ts
function makeTestWp(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    status: 'READY',
    revision: 0,
    pipelines: [],
    assigned_to: null,
    dependencies: [],
    acceptance_criteria: [],
    ...overrides,
  };
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — import the canonical factory; field defaults and schema shape are guaranteed
import { makeWpDetail } from '../helpers/fixtures.js';

const wp = makeWpDetail({ work_package_id: 'WP-001', status: 'READY' });
```

---

### 56. JSDoc Convention for Captured-Closure Variables

**Rule:** When using the captured-closure pattern (an outer-scope `let` written inside a `withLock` / `updateWorkPackageWithSync` callback and read after the call returns), add a brief `// captured via closure in lock callback` inline comment on the `let` declaration.

**Example:**
```typescript
let autoFinalizeResult: 'finalized' | 'blocked' | null = null; // captured via closure in lock callback
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... logic that may set autoFinalizeResult ...
  autoFinalizeResult = 'finalized';
  return { wp, root };
});
if (autoFinalizeResult === 'finalized') { /* ... */ }
```

**Rationale:** The pattern is non-obvious to contributors unfamiliar with the lock-callback design. Without the comment, reviewers may assume the variable is always `null` after the call (it isn't — the callback executed synchronously within the lock and the `let` is live). See Gotcha 12 for a full explanation of the captured-closure mechanics.

---

### 57. `project_path` Takes Precedence Over `cwd_path` When Both Are Provided

**Rule:** When a caller supplies both `project_path` and `cwd_path`, `resolveProjectPath()` uses `project_path` and silently ignores `cwd_path`. Supplying both parameters is **not** an error. Do **not** add `.refine()`, `.transform()`, or `.superRefine()` to the outer `z.object()` of any tool schema to enforce exclusivity.

**Precedence rule (in `resolveProjectPath()`, `src/utils/path-validator.ts`):**
1. If `project_path` is provided (truthy) → use it directly; `cwd_path` is ignored.
2. If only `cwd_path` is provided → auto-detect the active project from the workspace root.
3. If neither is provided → throw a missing-path error.

**Guidance for callers:**
- If you already have `project_path` (the plan folder path from a prior tool response), pass it — it is the fastest path with no auto-detection overhead.
- If you only know your workspace root, pass `cwd_path` and let the server detect the project.
- If you pass both, `project_path` wins; `cwd_path` is a no-op in that call.

**Enforcement:**
- `resolveProjectPath()` (`src/utils/path-validator.ts`) applies the precedence rule at the top of its body. Every tool handler that accepts both optional path fields calls `resolveProjectPath()`.
- The predicate `mutuallyExclusivePaths` and the constant `MUTUAL_EXCLUSIVITY_PATH_MSG` remain exported from `src/utils/path-validator.ts` for backward compatibility and test coverage. They are **not used in production tool files**.
- Schemas that only contain `project_path` (mandatory) or only `cwd_path` — but not both as optional fields — are exempt from this consideration. `DetectProjectSchema`, `InitializeProjectSchema`, and `ListProjectsSchema` fall into this category.

**Anti-pattern:**
```typescript
// ❌ WRONG — .refine() converts ZodObject → ZodEffects. The MCP SDK cannot extract properties
// from ZodEffects, resulting in empty { properties: {}, required: [] } in tools/list responses.
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('…'),
  cwd_path:     z.string().optional().describe('…'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — plain ZodObject; project_path-wins precedence is enforced inside resolveProjectPath()
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('…'),
  cwd_path:     z.string().optional().describe('…'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
});
```

**Rationale:** `.refine()` (and `.transform()`, `.superRefine()`) on the outer `z.object()` converts it from `ZodObject` to `ZodEffects`. The MCP SDK's `zodToJsonSchema` cannot extract properties from `ZodEffects` — every affected tool emits empty `{ properties: {}, required: [] }` in the `tools/list` response, preventing AI agents from passing arguments. Centralising the precedence logic in `resolveProjectPath()` keeps all tool schemas as plain `ZodObject` instances and eliminates spurious errors when callers pass both parameters. (Background: 2026-03-05 Zod `.refine()` empty schema fix — 18 of 22 tools were affected.)

**See also:** §63 for the general rule covering all outer-schema uses of `.refine()`, `.transform()`, and `.superRefine()`.

---

### 58. MCP SDK Injects `RequestHandlerExtra` — Handler Registration Must Use Wrapper Functions

**Rule:** Every internal tool handler that has a second positional parameter (`_ledgerRoot?: string`) **must** be registered via an arrow-function wrapper, **not** passed directly as the handler. Additionally, each such handler **must** apply a defensive type guard before using `_ledgerRoot`.

**Root cause:** The MCP SDK (v1.0.4+) calls every registered tool handler as:
```typescript
typedHandler(args, extra)   // extra is RequestHandlerExtra
```
If the handler has a second positional parameter (`_ledgerRoot?: string`), the `extra` object is captured by it. Because `extra` is truthy, `_ledgerRoot ?? projectPath` resolves to the `extra` object, causing downstream `path.join()` calls to throw:
```
TypeError: The "path" argument must be of type string. Received an instance of Object
```

**Two-layer defence (belt-and-suspenders):**

*Layer 1 — Registration wrapper (primary):*
```typescript
// ✅ CORRECT — extra never reaches the internal handler
server.registerTool('ledger_create_work_package', { ... }, (args) => createWorkPackage(args));

// ❌ WRONG — extra leaks into _ledgerRoot
server.registerTool('ledger_create_work_package', { ... }, createWorkPackage as any);
```

*Layer 2 — Defensive type guard inside the handler (secondary):*
```typescript
async function createWorkPackage(args: ..., _ledgerRoot?: string) {
  // ✅ Guard against the MCP SDK injecting a RequestHandlerExtra object
  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  // Use ledgerRoot throughout — never use _ledgerRoot directly after this line
}
```

**Affected handlers (both layers applied as of 2026-03-01):**
- `createWorkPackage` — `src/tools/work-package.ts`
- `claimWorkPackage` — `src/tools/work-package.ts`
- `updateWorkPackageStatus` — `src/tools/work-package.ts`
- `resetReworkCount` — `src/tools/work-package.ts`
- `updateAcceptanceCriteria` — `src/tools/work-package.ts`
- `completeSynthesis` — `src/tools/project-lifecycle.ts`

**Why single-argument handlers are unaffected:** Handlers with only one parameter (`initializeProject`, `getProjectStatus`, etc.) silently ignore any surplus arguments passed by the SDK — `extra` is discarded before it can cause harm.

**Rationale:** A bug introduced when the SDK began passing `extra` went undetected because all unit tests call internal functions directly with an explicit string `_ledgerRoot`. The registration layer, where the SDK's extra injection occurs, had no test coverage. The two-layer defence ensures correctness both at the registration boundary and inside the function itself.

---

### 59. Acceptance Criteria Field-Name Verification

**Rule:** Acceptance criteria text that references specific JSON field names, TypeScript parameter names, or object property names (e.g., `store`, `rootIndex`, `wpDetails`, `storageDir`) **must** be verified against the actual implementation source before the AC is committed to a work package. If the implementation uses a different name than what the AC states, the AC text must be updated to match.

**Rationale:** Stale field-name references in ACs cause false-negative review outcomes. When a reviewer checks `wpDetails` against acceptance criteria but the implementation uses `allWpDetails`, the criterion is technically not met — yet neither the agent nor the QA reviewer notices. This constraint formalises the verification step that was retroactively identified in synthesis #4 of the Ledger Tool Simplification rework-1 cycle.

**Anti-pattern:**
```
// AC text: "getNextActionsCollector receives `wpDetails` as a pre-loaded array"
// Implementation: loads wp details internally, no wpDetails parameter
// → AC text silently passes review because no one checks the parameter name
```

**Correct pattern:**
```
// AC text uses the exact parameter/field name from the source:
// "getNextActionsCollector receives `rootIndex: RootIndex` and `store: LedgerStore`"
// Verified against src/tools/workflow-next-action.ts before committing
```

---

### 60. No Unused Locals (`noUnusedLocals`)

**Rule:** `tsconfig.json` enables `"noUnusedLocals": true`. Every import, variable, parameter, and type alias that is declared must be consumed within its file. Dead imports and unused variables are compile errors — fix, never suppress.

**Rationale:** Unused imports are structural noise left behind by refactors (e.g., when symbols move to a new module). They mislead agents and developers into thinking a dependency exists when it does not, and they obscure intent. The `noUnusedLocals` flag makes these errors hard build failures so they cannot accumulate silently.

**Anti-pattern:**
```typescript
// ❌ WRONG — AGENT_PIPELINE_MAP moved to workflow-next-action-batch.ts but was
// left in the import list of workflow-next-action.ts after a file-split refactor.
import {
  PIPELINE_TYPES,
  AGENT_PIPELINE_MAP,   // ← never referenced in this file
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Correct pattern:**
```typescript
// ✅ CORRECT — only symbols actually used in this file are imported.
import {
  PIPELINE_TYPES,
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Forbidden patterns:**
- Adding `// @ts-ignore` or `// eslint-disable` to suppress unused-local errors.
- Importing a symbol "for re-export" without an explicit re-export statement.
- Leaving a symbol in an import group after moving its last consumer to another file.

---

### 61. `assigned_to` Requires a Canonical AgentRole; `project_comments.agent` Does Not

**Rule:** The `assigned_to` field on a work package (`WorkPackageSchema.assigned_to`) must be a value from the `AGENT_ROLES` constant (a validated `AgentRole` union). The `agent` field on a project-level comment (`ProjectCommentSchema.agent`) is typed as `z.string()` and is intentionally **not** constrained to `AGENT_ROLES`.

**Rationale:** `assigned_to` drives workflow routing, gate checks, and pipeline agent-map lookups — it must be a machine-readable canonical role value. `project_comments.agent` is a human-readable audit identifier; it records who wrote the comment as a narrative label, not as a workflow actor, so free-form strings are appropriate.

**Anti-pattern:**
```typescript
// ❌ WRONG — using a non-canonical value in the role-validated field
await claimWorkPackage({ ..., agent: "Developer Agent" });
// Zod rejects "Developer Agent" — not a member of AGENT_ROLES
```

**Correct pattern:**
```typescript
// ✅ CORRECT — canonical AgentRole value required for assigned_to/agent in claim
await claimWorkPackage({ ..., agent: "Developer" });

// ✅ ALSO CORRECT — free-text is acceptable in project_comments.agent
await addProjectComment({ ..., agent: "Developer Agent" });
// z.string() accepts arbitrary strings here; this is intentional
```

**Forbidden patterns:**
- Using `"Developer Agent"` (or any multi-word variant) as the `agent` argument to `ledger_claim_work_package` or `ledger_start_pipeline`.
- Assuming `project_comments.agent` and `assigned_to` share the same validation rules — they do not.
- Hardcoding role strings anywhere other than constants. Use `AGENT_ROLES` entries or the `AgentRole` type for `assigned_to`-typed fields.

**Reference:** `AGENT_ROLES` is derived from `shared/workflow-manifest.json` (`roles[].name`) and re-exported from `src/utils/constants.ts`. `ProjectCommentSchema` is in `src/schema/validators.ts`. See [tech-stack.md — Architectural Pattern 10](tech-stack.md#10-manifest-derived-constants) for the full list of manifest-derived constants.

---

### 62. `ledger_begin_work` IN_PROGRESS Guard Accepts Pipeline-Type Owners

**Rule:** When `ledger_begin_work` is called on a work package that is already `IN_PROGRESS`, the call is allowed if **either** condition holds:

1. **Idempotent re-entry:** `wp.assigned_to === args.agent_role` (the same agent is continuing their own work).
2. **Cross-agent handoff:** `PIPELINE_AGENT_MAP[args.type] === args.agent_role` (the caller is the legitimate pipeline-type owner per the workflow spec).

If neither condition holds, the call is rejected.

**Rationale (§9.1, §16.5):** The `assigned_to` field is a trailing bookkeeping field — a side-effect updated by the pipeline-start phase, not a security gate. Pipeline authorisation is defined by `PIPELINE_AGENT_MAP`. Using `assigned_to` as a hard gate would block every cross-agent handoff where `ledger_begin_work` is used instead of the two-step `ledger_claim_work_package + ledger_start_pipeline` sequence. This constraint restores consistency with `ledger_start_pipeline`, which enforces `PIPELINE_AGENT_MAP` only.

**Contrast with `ledger_claim_work_package`:** Constraint 14 governs `ledger_claim_work_package`, which operates on `READY` WPs and does require an explicit `override: true` for cross-agent claims. The `READY → IN_PROGRESS` transition is a deliberate re-assignment; `ledger_begin_work` on an `IN_PROGRESS` WP is a pipeline-start handoff, not a RE-assignment.

**Enforcement:** `isPipelineOwner` compound check in `beginWork()` in `src/tools/begin-work.ts`.

**Error message (guard fires):**
```
Cannot begin work on WP-002: it is IN_PROGRESS and assigned to "Reviewer" but you are "Developer".
Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.
```

---

### 63. Do Not Use `.refine()`, `.transform()`, or `.superRefine()` on Outer Tool Schemas

**Rule:** Never chain `.refine()`, `.transform()`, or `.superRefine()` on the outer `z.object({...})` schema passed as `inputSchema` to `server.registerTool()`. These methods convert a `ZodObject` into a `ZodEffects` wrapper, which the MCP SDK's JSON Schema converter cannot introspect — it emits `{ properties: {}, required: [] }` instead of the actual field list.

**Reason:** The MCP `tools/list` response uses the JSON Schema to populate the tool definition shown to AI clients. An empty `properties` object means the client cannot see any parameters, so agents cannot pass arguments to the tool. This bug silently affects all callers, including VS Code Copilot agent mode.

**Correct pattern:** Move cross-field validation inside the handler function (or a helper it calls, such as `resolveProjectPath()`):

```typescript
// ✅ CORRECT — plain ZodObject; SDK emits correct properties
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
});

async function myToolHandler(args: z.infer<typeof MyToolSchema>) {
  // Mutual exclusivity enforced at runtime by resolveProjectPath()
  const projectPath = await resolveProjectPath(args);
  // ...
}
```

**Anti-pattern:**

```typescript
// ❌ WRONG — .refine() converts ZodObject → ZodEffects
// SDK emits { properties: {}, required: [] } — agent cannot pass arguments
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
}).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });
```

**Exception:** Field-level `.refine()` applied to an individual field definition (e.g., `z.string().refine(...)`, `plan_file: z.string().refine(v => v === 'plan.md', ...)`) is safe — the outer `z.object()` remains a `ZodObject`.

**Regression guard:** `tests/tools/schema-integrity.test.ts` converts all 22 registered tool schemas to JSON Schema and asserts non-empty `properties`. This test fails if a `.refine()` / `.transform()` / `.superRefine()` is re-added to any outer schema.

**Background:** Fixed in plan `2026-03-05-zod-refine-empty-schema`. All 18 affected tools previously emitted empty JSON Schemas due to this pattern.

---

### 64. Mock `McpServer` Intercept Pattern for Tool Metadata Tests

**Rule:** When writing tests that need to inspect tool metadata (input schema shape, parameter constraints, tool descriptions) without spinning up a real MCP server, use the mock `McpServer` intercept pattern: create a plain object with a `registerTool` method that captures schemas into a `Map`, cast it `as unknown as McpServer`, and call each tool module's `register()` function with it in `beforeAll`.

**Rationale:** This pattern exercises the exact production registration path — same `register()` call, same `inputSchema` reference — without a network socket or real server lifecycle. It is safe with `beforeAll` because `register()` calls are synchronous.

**Correct pattern:**

```typescript
import { beforeAll, describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerPipeline } from '../../src/tools/pipeline.js';

const capturedSchemas = new Map<string, z.ZodTypeAny>();

const mockServer = {
  registerTool: (
    name: string,
    config: { description: string; inputSchema: z.ZodTypeAny },
    _handler: unknown
  ) => {
    capturedSchemas.set(name, config.inputSchema);
  },
} as unknown as McpServer;

beforeAll(() => {
  registerPipeline(mockServer);
});

describe('pipeline schemas', () => {
  it('ledger_start_pipeline has non-empty properties', () => {
    const schema = capturedSchemas.get('ledger_start_pipeline')!;
    const json = zodToJsonSchema(schema) as { properties?: object };
    expect(Object.keys(json.properties ?? {})).not.toHaveLength(0);
  });
});
```

**When to use:** Any test that needs to verify tool schema shape, description content, or parameter constraints without full server lifecycle overhead. See `tests/tools/schema-integrity.test.ts` for the canonical usage.

**Note on `zod-to-json-schema`:** This package is currently a transitive dependency (via `@modelcontextprotocol/sdk`) and is not declared as an explicit `devDependency` in `mcp-server/package.json`. Tests relying on it work today, but if the SDK drops the transitive dep in a future update, imports will fail without a clear error. Prefer adding it explicitly when introducing new test files that import it directly.

---

### 65. All Six Pipeline Stages Are PM-Composable — No Mandatory/Optional Distinction

**Rule:** All six pipeline stages (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) are equally composable by the Project Manager. There is no inherent "mandatory" or "optional" designation for any stage. The PM selects any valid subsequence of `CANONICAL_PIPELINE_ORDERING` per work package via the `active_pipeline_stages` field.

**Default:** When `active_pipeline_stages` is omitted, `DEFAULT_PIPELINE_STAGES` (`['implementation', 'qa', 'code-review', 'documentation']`) is used for backward compatibility.

**Rationale:** The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired. The PM-composable model enables custom workflows (e.g., skipping QA for documentation-only WPs, adding a security audit before code review) without encoding assumptions into the server.

**Extension:** The `CANONICAL_PIPELINE_ORDERING` constant (`['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation']`) defines the only valid execution order — stages may be omitted but not reordered. `resolvePrerequisite`, `resolveNextAgent`, and `resolveFailAgent` derive routing dynamically from the per-WP `active_pipeline_stages` array.

**Enforcement:** `ledger_create_work_package` validates the `active_pipeline_stages` input (see Constraint 66). Pipeline start and completion routing use the dynamic resolve functions, not static maps.

> Full specification: [Workflow Specification §4.2, §9b](../workflow-specification/data-model.md#42-pipeline-stage-constants).

---

### 66. `active_pipeline_stages` Validation: Hard Guardrails (Reject) and Soft Guardrails (Warn)

**Rule:** When `ledger_create_work_package` receives an `active_pipeline_stages` value, it validates the array before persisting the work package.

**Hard guardrails (reject with error — creation is aborted):**
- Empty array (`[]`)
- Entries that are not valid `PIPELINE_TYPES` values
- Duplicate entries
- Entries that are not a subsequence of `CANONICAL_PIPELINE_ORDERING` (relative ordering must be preserved; gaps are allowed)

**Soft guardrails (warning appended to the success response message — creation is NOT aborted):**
- `implementation` present without `qa` (unusual composition)
- Single-stage chain (degenerate case)

**Omitted field:** When `active_pipeline_stages` is omitted (the common case for standard 4-stage workflows), validation is bypassed entirely. The field is absent on the WP detail and dynamic resolve functions substitute `DEFAULT_PIPELINE_STAGES` at runtime.

**Enforcement:** `validateActiveStages()` helper called inside `createWorkPackage()` in `src/tools/work-package.ts`. Hard rejection throws before the WP is written; soft warning is appended to the response string after the WP is written.

> Full specification: [Workflow Specification §9b.2](../workflow-specification/operations.md#9b2-active-pipeline-stages-validation).

---

### 67. Artifact Declaration Expectation — Soft Warning on Empty `files_modified`

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` and the `artifacts.files_modified` array is either absent or empty, the server appends a soft-warning note **only if the pipeline type is in `ARTIFACT_EXPECTED_PIPELINE_TYPES`** (`implementation`, `code-review`, `release-engineering`, `documentation`). Verification-only pipeline types (`qa`, `security-audit`) are exempt because those agents verify but do not modify files. `code-review` is included because the Reviewer may apply Fix-Forward edits. This is a non-blocking warning — the pipeline completion is still accepted.

**Rationale:** Agents often forget to populate `files_modified`, reducing the value of the pipeline record for auditing and documentation. The soft warning creates a visible signal in the response without blocking legitimate zero-file-change completions. Verification-only agents are exempt to avoid noisy false-positive warnings.

**Exception:** The warning is only emitted on `PASS` completions — `FAIL` pipelines are not expected to declare modified files.

**Enforcement:** Soft check in `completePipeline()` in `src/tools/pipeline.ts` (step 3b), gated by `ARTIFACT_EXPECTED_PIPELINE_TYPES` from `src/utils/pipeline-maps.ts`. Does not reject the call; appended as a text note in the response body only.

---

### 68. Zod `.describe()` Annotations for Pipeline Type Must Use `describePipelineTypes()`

**Rule:** All Zod `.describe()` strings that enumerate pipeline type values MUST be generated by calling `describePipelineTypes(prefix)` from `src/utils/pipeline-maps.ts`. Hardcoding a pipeline type list inline in a `.describe()` string is forbidden.

**Rationale:** `PIPELINE_TYPES` is the single source of truth for the canonical pipeline type list. Hardcoded `.describe()` strings drift silently when a new pipeline type is added — as demonstrated when `observations.ts` still listed only 4 types after `security-audit` and `release-engineering` were introduced. `describePipelineTypes()` derives the annotation from `PIPELINE_TYPES` at schema definition time, so any future addition to `PIPELINE_TYPES` propagates automatically to all MCP JSON Schema annotations.

❌ **Anti-pattern:**
```typescript
PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", "documentation"')
```

✅ **Correct pattern:**
```typescript
import { describePipelineTypes } from '../utils/pipeline-maps.js';
// ...
PipelineTypeEnum.describe(describePipelineTypes('Pipeline type:'))
```

**Enforcement:** A drift-detection test in `tests/utils/pipeline-maps.test.ts` asserts that the output of `describePipelineTypes()` contains every entry in `PIPELINE_TYPES` — future additions to `PIPELINE_TYPES` that are not reflected in the helper will be caught automatically.

---

### 69. CSS Class Derivation from API Values Is Only Safe for Zod-Enum-Validated Fields

**Rule:** CSS class derivation from raw API values is only safe when the field is a Zod-enum-validated type. For non-enum fields, apply `escapeHtml()` or a whitelist map.

**Rationale:** The pattern `(field).toLowerCase().replace(/ /g, '_')` generates a CSS class string from a server-supplied value. If the field is a closed Zod enum, the server guarantees the value is one of a finite safe set — class injection is not possible. If the field is a free-form string (`z.string()`), a tampered ledger JSON (or a future schema relaxation) could insert arbitrary characters into a `class=""` attribute, enabling CSS injection or layout-breaking attacks.

**Anti-pattern:**
```javascript
// ❌ WRONG — open string field; output is injected into class="" without escaping
var cls = (someOpenStringField || '').toLowerCase().replace(/ /g, '_');
el.innerHTML = `<span class="badge ${cls}">…</span>`;
```

**Correct patterns:**
```javascript
// ✅ OPTION A — field is a closed Zod enum (safe by schema contract)
// p.status is WorkPackageStatus — a Zod enum with a fixed value set
var cls = (p.status || '').toLowerCase().replace(/ /g, '_');

// ✅ OPTION B — whitelist map (safe for any field type)
var STATUS_CLASS = { READY: 'ready', IN_PROGRESS: 'in_progress', COMPLETE: 'complete', BLOCKED: 'blocked', CANCELLED: 'cancelled' };
var cls = STATUS_CLASS[p.status] ?? 'unknown';

// ✅ OPTION C — escapeHtml() before insertion (safe for any field type)
var cls = escapeHtml((someField || '').toLowerCase().replace(/ /g, '_'));
```

**Scope:** This convention applies to all client-side JavaScript in `mcp-server/gui/public/` (currently `views/work-package.js`, `utils.js`). When adding new attribute values derived from API data, determine whether the field is enum-backed before using the raw-derivation pattern.

---

## Runtime Config Monitoring

- `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`).
- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.

---

### 70. Advisory Dependency Freshness Check on PASS Completion (§21.59)

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` on a WP that has `dependencies`, the server performs an advisory staleness check. For each dependency, the server reads the full WP detail (pre-lock, before lock acquisition) and uses `dep.last_updated` directly. Inside the lock callback, if `dep.last_updated` is later than `pipeline.started_at` (using Date-based comparison via `new Date().getTime()` instead of lexicographic string comparison), a project comment is appended:

```typescript
{ type: 'warning', priority: 'low', agent: 'system', note: '<dep WP-XXX was modified after this pipeline started>' }
```

**PASS is never blocked.** This check is purely advisory — no pipeline status is changed, no error is thrown.

**Skip conditions:** The check is entirely skipped when:
- `pipeline.started_at` is absent (unstarted or legacy pipeline record), OR
- the WP's `dependencies` array is empty.

**`last_updated` field:** `WorkPackageDetail` now includes a dedicated `last_updated: z.string().optional()` field that is auto-stamped with `now()` on every WP detail write path (status transitions, claim, pipeline start/complete/cancel, creation, cascade reblock/unblock). The previous composite proxy (`max(status_changed_at, latest_pipeline.completed_at)`) is no longer used. The `last_updated` field is auto-stamped via `updateWorkPackageWithSync` (the primary choke point), plus explicit setting in `createWorkPackage`, `propagateDependencyUnblock`, and `propagateDependencyReblock` (which bypass the choke point). Existing WP detail files without the field parse without error (the field is optional).

**Race window (acceptable):** Dependency WP files are read before lock acquisition. A dependency could theoretically be modified between the pre-read and the lock. For an advisory-only check this race window is acceptable — false negatives do not affect correctness.

---

### 71. `gui/server.ts` Two-Tier Routing Convention — Preserve the Route-Map Comment Block

**Rule:** `gui/server.ts` uses a deliberate two-tier routing architecture. When adding a new route, use the correct tier and keep the route-map comment block at the bottom of `matchRoute()` up-to-date.

**Tier 1 — `matchRoute()`:** Handles segment-count-based dispatch. Receives pre-parsed path segments (`rest`), the request method, `ledgerRoot`, and `orchestratorLogsDir`. Suitable for routes that need only path-derived parameters (no body, no dynamic path-tail extraction). Returns a `() => Promise<unknown>` thunk, or `null` if no route matches. The function contains a **route-map comment block** before its final `return null` that lists every route handled outside `matchRoute()` (i.e., in `handleRequest()` special-case blocks). **This comment block must be kept current.** When a new route is handled in `handleRequest()` rather than `matchRoute()`, add a line to that block.

**Tier 2 — `handleRequest()` special-case blocks:** Handles routes that require body parsing (via `readBody()`) or path-tail extraction (via `path.slice()` + `decodeURIComponent()`). Each block is a guarded early-return placed before the `matchRoute()` fallback call.

**Current split (as of WP-009):**

| Tier | Routes |
|------|--------|
| `matchRoute()` | All GET routes; DELETE, POST, PATCH routes with only path-derived params |
| `handleRequest()` special-case | `PUT /api/config`, `POST /api/projects/:slug/reset`, `POST /api/projects/:repo/:slug/reset`, `PATCH /api/projects/:slug`, `PATCH /api/projects/:repo/:slug`, `POST /api/orchestrator/start`, `POST /api/orchestrator/kill/:id`, `POST /api/orchestrator/dismiss/:id`, `GET /api/server-info` (configPath dependency) |

**Why it matters:** The comment block is the only place that enumerates routes handled outside `matchRoute()`. Without it, future contributors adding a new `matchRoute()` branch for an already-handled path could create silent shadowing bugs.

**Test coverage note:** As of WP-009, orchestrator routes have strong handler-level test coverage in `tests/gui/api-orchestrator.test.ts` but no `handleRequest()`-level integration test (unlike `tests/gui/api.test.ts` which exercises `handleRequest()` directly). A future `handleRequest()` integration test for orchestrator routes would provide defence-in-depth.

---

### 72. JSDoc Closure-Dependency Documentation for GUI Helpers

**Rule:** Every closure-scoped helper function in `gui/public/views/*.js` that reads or mutates variables from its enclosing scope MUST include a `Closure dependencies (from <parent>() scope):` JSDoc block listing each closed-over variable with a one-line description of whether it is read-only or mutated by this helper.

**Example:**
```javascript
/** Injects action buttons into the rendered table.
 *
 *  Closure dependencies (from renderOrchestrator() scope):
 *    `expandedIds`   — mutated; toggle clicks update row expansion state.
 *    `refreshQueue`  — read-only; called after Kill/Dismiss actions. */
function _bindQueueActions(container, entries) { /* ... */ }
```

**Rationale:** Vanilla JS files lack module-level imports that make dependencies visible. Without explicit documentation, future contributors cannot determine which outer-scope variables a helper depends on without reading the entire enclosing function. This convention was established during the `2026-05-20-orchestrator-gui-polish-rework` sprint and should be applied to all new closure-scoped helpers going forward.

**Scope:** Applies only to `gui/public/views/*.js` files (vanilla JS, no module system). TypeScript modules in `src/` use explicit imports and do not need this pattern.

---

## Known Limitations

### KL-1. `'unknown'` Namespace Collision When Repo Root Fails Slug Validation

**Affected components:** `LedgerStore.storageDir` (via `deriveRepoName()` in `src/utils/ledger-root.ts`) and `migrateToNamespacedLayout()` (via `repository_name` field in `.meta.json`)

**Trigger condition — `LedgerStore.storageDir`:** `deriveRepoName()` derives the repo name by lowercasing the project-root directory basename and delegates to `assertSafeSegment()` (which encapsulates `SAFE_SLUG_REGEX`) for validation (alphanumeric + hyphens only). When a repo's root directory name contains characters that fail this check — such as dots (e.g. `my.project`), underscores, non-ASCII characters, or a path too shallow to extract four levels — `deriveRepoName()` falls back to `'unknown'`. If two or more such repos exist on the same machine, their projects will share the `{ledgerRoot}/unknown/` namespace and can **collide by slug** — two projects with the same plan folder basename will map to the same `storageDir`.

**Trigger condition — `migrateToNamespacedLayout()`:** The migration function uses `repository_name` from each project's `.meta.json` as the namespace. If `repository_name` is absent, `null`, or an empty string, the project is moved to `{ledgerRoot}/unknown/{slug}/`. Additionally, if a user has a repository literally named `'unknown'` (a valid, slug-compatible name), its projects will share the `{ledgerRoot}/unknown/` namespace with all fallback projects, and slug collisions may occur.

**Mitigation:** Rename the repository root directory to a slug-compatible name (lowercase alphanumeric and hyphens only, e.g. rename `My.Project` → `my-project`). This is the only reliable fix; there is no server-side escape hatch once two repos produce the same `repoName`. For the migration-layer scenario, also avoid naming a repository `'unknown'`.

**Detection:** If you suspect a collision, inspect `{ledgerRoot}/unknown/` — multiple slug subdirectories there indicate affected projects. Each `.meta.json` inside will identify the originating `plan_path`.

---

### KL-2. `listAllProjects()` Two-Level Scan Has No Direct Unit Tests *(Resolved — WP-004)*

**Affected component:** `LedgerStore.listAllProjects()` in `src/storage/ledger-store.ts`

**Status:** Resolved by WP-004 (2026-05-27). A dedicated test suite `tests/storage/list-all-projects.test.ts` was added with 10 tests covering:

- New namespaced layout (`{ledgerRoot}/{repoName}/{slug}/`)
- Old flat layout (`{ledgerRoot}/{slug}/`) for backward compatibility
- Mixed flat-layout and namespaced-layout projects coexisting in the same ledger root
- Dot-prefix filtering at depth-1 and depth-2
- Empty namespace directories (no valid subdirectories)
- Namespace directories containing invalid (non-project) subdirectories
- Same-slug cross-namespace collision prevention
- `detectProjectByCwd()` delegation with both layout types
- The `stderr` log path for depth-2 slug directories with a missing `.meta.json` file

All 97 storage tests pass. The known limitation below is retained for historical context only.

**Historical details (pre-WP-004):** The two-level scan introduced in WP-002 was exercised indirectly through `detectProjectByCwd` tests but lacked a dedicated test suite. Mixed-layout coexistence and the `stderr` log path had no direct coverage.

**See also:** `api-surface.md` §`LedgerStore` static methods — the canonical `listAllProjects()` architectural constraint (slug-only callers must use this method before constructing a `LedgerStore`).

---

### KL-3. `assertSafeSlug` Is Defined in Three Files — Storage Layer and GUI Layer *(Resolved)*

**Affected components:** `src/utils/ledger-root.ts` (storage layer), `src/gui/handlers/run-log-handlers.ts` (GUI layer), and `gui/api.ts` (GUI layer)

**Was:** All three files defined a local, module-private `assertSafeSlug` using an inline `SAFE_SLUG_REGEX.test()` call. The regex check was duplicated, requiring all three files to be updated in lockstep when validation logic changed.

**Resolution:** All three `assertSafeSlug` implementations now delegate to `assertSafeSegment()` from `src/utils/path-validator.ts`, which encapsulates the `SAFE_SLUG_REGEX` check. The throw-type variants are preserved (`Error` in the storage layer; `ApiError NOT_FOUND` in the GUI layer) — the layer separation is unchanged. `deriveRepoName()` in `src/utils/ledger-root.ts` also delegates to `assertSafeSegment()` directly, completing the consolidation — `src/utils/ledger-root.ts` no longer imports `SAFE_SLUG_REGEX`.

**Ongoing invariant:** When slug-segment validation logic changes, update `assertSafeSegment()` in `path-validator.ts` only — all three `assertSafeSlug` wrappers and `deriveRepoName()` pick up the change automatically.
