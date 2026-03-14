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

**Rule:** When updating both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use `LedgerStore.updateWorkPackageWithSync()` or manually wrap with `withLock(store.storageDir, ...)`. **`store.storageDir` is the only acceptable first argument to `withLock` — never pass `projectPath`, `ledgerRoot`, or `ledgerRoot ?? projectPath`.** Once a `LedgerStore` is constructed, use its `.storageDir` property to obtain the canonical lock directory.

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
// ✅ CORRECT — atomic dual-file update
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... update both wp and root ...
  return { wp: updatedWp, root: updatedRoot };
});
```

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

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync).

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

**Rationale:** Enforces the 7-stage workflow at the MCP server level. Previously this was a persona-level convention only; the guard was added after the 2026-02-22 workflow failure where a Developer agent set COMPLETE directly.

> Full specification: [Workflow Specification §6.5, §21.10](../workflow-specification/state-machines.md#65-agent-guards).

---

### 13b. Auto-Finalize on Documentation Pipeline PASS (§WP-006)

**Rule:** When `ledger_complete_pipeline` is called with `type: "documentation"`, `status: "PASS"`, and `agent_role: "Documentation"`, the server automatically evaluates whether all acceptance criteria are met **after** applying `acceptance_criteria_updates`. If all criteria are met, the WP is transitioned to `COMPLETE` **within the same lock scope** as the pipeline completion — no separate `ledger_update_work_package_status` call is required.

**Conditions (all must apply):**
- `type === 'documentation'`
- `status === 'PASS'`
- `agent_role === 'Documentation'` (PM overrides bypass auto-finalize)
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

**Rule:** Pipelines must be started in order: `implementation` → `qa` → `code-review` → `documentation`. Attempting to start a pipeline without the **most recent** prerequisite pipeline having a `PASS` status throws a descriptive error. A historical PASS followed by a FAIL is not sufficient — the most recent entry is the only one that counts (per §8.2 most-recent-wins semantics).

**Enforcement:** `ledger_start_pipeline` looks up the `PIPELINE_PREREQUISITES` map, finds the most recent pipeline of the prerequisite type via `.at(-1)`, and rejects if it is absent or its status is not `PASS`.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** `implementation` has no prerequisite and can always be started (subject to other constraints).

> Full specification: [Workflow Specification §8](../workflow-specification/pipeline-routing.md).

---

### 20. Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to the `PIPELINE_AGENT_MAP`:

| Pipeline type | Assigned agent |
|---|---|
| `implementation` | `Developer` |
| `qa` | `QA` |
| `code-review` | `Reviewer` |
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

### 22. Handoff Notes Are Routed via NEXT_AGENT_MAP / FAIL_ROUTING_MAP

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined automatically based on pipeline status:

- **On PASS:** `NEXT_AGENT_MAP` routes to the next agent in the chain.
- **On FAIL:** `FAIL_ROUTING_MAP` routes to the agent responsible for fixing the failure.

| Pipeline type | PASS → to_agent (NEXT_AGENT_MAP) | FAIL → to_agent (FAIL_ROUTING_MAP) |
|---|---|---|
| `implementation` | `QA` | `Developer` |
| `qa` | `Reviewer` | `Developer` |
| `code-review` | `Documentation` | `Developer` |
| `documentation` | `Synthesis` | `Documentation` |

> Documentation is the only pipeline type with self-rework on FAIL. All other FAIL paths route back to the Developer.

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // PIPELINE_AGENT_MAP[type], or 'Project Manager (PM Override)' when PM override is active
  to_agent: string;   // NEXT_AGENT_MAP (PASS) or FAIL_ROUTING_MAP (FAIL)
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

**Additional effect:** On `COMPLETE → IN_PROGRESS`, rework state is fully reset: `rework_counts` is set to `{}`, `rework_count` is set to `0`, and `root.synthesis_generated` is cleared. This ensures that a reopened WP starts with a clean rework slate and prevents the Synthesis agent from being gated by stale synthesis state.

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
- **`synthesis_generated` reset:** If any WP was re-blocked (i.e., `candidates.length > 0`), `root.synthesis_generated` is reset to `false` to ensure the Synthesis agent must re-run.
- If no candidates were re-blocked, `synthesis_generated` is **not** changed.

**Enforcement:** `propagateDependencyReblock()` in `src/tools/work-package.ts`.

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

**Invariant:** Summaries must always match the corresponding detail files. This is enforced by `updateWorkPackageWithSync()`.

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

### 57. Mutual Exclusivity of `project_path` and `cwd_path` — Runtime Guard via `resolveProjectPath()`

**Rule:** Mutual exclusivity of `project_path` and `cwd_path` is enforced at runtime by `resolveProjectPath()`, **not** by a Zod `.refine()` on the outer schema. Do **not** add `.refine()`, `.transform()`, or `.superRefine()` to the outer `z.object()` of any tool schema.

**Enforcement:**
- `resolveProjectPath()` (`src/utils/path-validator.ts`) throws `Error(MUTUAL_EXCLUSIVITY_PATH_MSG)` at the top of its body when both `project_path` and `cwd_path` are truthy. Every tool handler that accepts both optional path fields calls `resolveProjectPath()` — the guard fires unconditionally.
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
// ✅ CORRECT — plain ZodObject; mutual exclusivity is enforced inside resolveProjectPath()
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('…'),
  cwd_path:     z.string().optional().describe('…'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
});
```

**Rationale:** `.refine()` (and `.transform()`, `.superRefine()`) on the outer `z.object()` converts it from `ZodObject` to `ZodEffects`. The MCP SDK's `zodToJsonSchema` cannot extract properties from `ZodEffects` — every affected tool emits empty `{ properties: {}, required: [] }` in the `tools/list` response, preventing AI agents from passing arguments. Centralising the check in `resolveProjectPath()` keeps all tool schemas as plain `ZodObject` instances. (Background: 2026-03-05 Zod `.refine()` empty schema fix — 18 of 22 tools were affected.)

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

**Reference:** `AGENT_ROLES` is defined in `src/utils/constants.ts`. `ProjectCommentSchema` is in `src/schema/validators.ts`.

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

## Runtime Config Monitoring

- `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`).
- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.
