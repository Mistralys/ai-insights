# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas.

---

## File System Constraints

### 1. All File I/O Must Be Atomic

**Rule:** Never write directly to target files. Always use the `atomicWriteJson()` function.

**Rationale:** Ensures readers never see partial writes or corrupt JSON.

**Implementation:** Write to `{file}.tmp.{pid}`, then atomically rename to target.

---

### 2. Dual-File Updates Require Locking

**Rule:** When updating both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use `LedgerStore.updateWorkPackageWithSync()` or manually wrap with `withLock(store.storageDir, ...)`. Pass `store.storageDir`, not `project_path`.

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

---

### 13. Only Documentation Agent Can Set COMPLETE

**Rule:** The `ledger_update_work_package_status` tool rejects transitions to `COMPLETE` from any agent other than `"Documentation"` or `"Documentation Agent"`.

**Enforcement:** Hard guard in `updateWorkPackageStatus()`. The error message includes the full workflow reminder (Developer → QA → Reviewer → Documentation → COMPLETE).

**Rationale:** Enforces the 7-stage workflow at the MCP server level. Previously this was a persona-level convention only; the guard was added after the 2026-02-22 workflow failure where a Developer agent set COMPLETE directly.

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

**Rule:** When writing tests that involve the agent registry (`discoverAgents`, `isRegistryLoaded`, `getAgentHandle`) or `LedgerStore`, use the real implementations backed by a temporary directory rather than `vi.mock`.

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

---

## Runtime Config Monitoring

- `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`).
- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.
