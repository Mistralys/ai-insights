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

### 3a. Plan Folders Must Remain Human-Readable Markdown Only

**Rule:** No machine-generated files (JSON, lock files, etc.) may be written inside plan folders.

**Rationale:** Plan folders are the authoritative human source-of-truth. Machine output lives in the centralized ledger at `{mcp-server}/storage/ledger/{slug}/`.

---

### 3b. `.meta.json` Must Be Written Under the Project Lock

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync).

**Rationale:** Prevents `.meta.json` from lagging behind the root index in a concurrent environment.

---

### 3c. Central Ledger Root Is Resolved Once at Startup

**Rule:** `resolveLedgerRoot()` is called once at server startup. The `--ledger-dir <path>` CLI argument overrides the default `{mcp-server}/storage/ledger/` location. The resolved path is logged to stderr.

**Usage:**
```bash
# Override ledger root:
node dist/index.js --ledger-dir /custom/path/to/ledger
```

**Default:** `{mcp-server}/storage/ledger/` (relative to the server package root).

---

### 4. STDIO Logging Discipline

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

### 5. Work Package IDs Must Follow WP-### Format

**Rule:** All work package IDs must match the regex `/^WP-\d{3}$/` (e.g., `WP-001`, `WP-042`, `WP-123`).

**Enforcement:** Validated by Zod schemas and utility functions (`formatWpId()`, `parseWpId()`).

---

### 6. Timestamps Must Use YYYY-MM-DD HH:MM:SS Format

**Rule:** All timestamp fields use this exact format. Always use the `now()` utility function.

**Anti-pattern:**
```typescript
// ❌ WRONG — inconsistent format
const timestamp = new Date().toISOString(); // "2026-02-16T18:00:00.000Z"
```

**Correct pattern:**
```typescript
// ✅ CORRECT — consistent format
const timestamp = now(); // "2026-02-16 18:00:00"
```

---

### 7. JSON Must Be Pretty-Printed

**Rule:** All JSON files written by the server must use 2-space indentation and include a trailing newline.

**Rationale:** Human readability and clean git diffs.

**Enforcement:** `atomicWriteJson()` automatically formats as `JSON.stringify(data, null, 2) + '\n'`.

---

## Business Rule Constraints

### 8. Status Transitions Are Enforced

**Rule:** Work package status transitions must follow the legal transition table:

| From | To | Special Conditions |
|------|----|--------------------|
| `READY` | `IN_PROGRESS` | Dependencies must be `COMPLETE` |
| `READY` | `BLOCKED` | None |
| `IN_PROGRESS` | `COMPLETE` | All acceptance criteria must be met |
| `IN_PROGRESS` | `BLOCKED` | None |
| `BLOCKED` | `IN_PROGRESS` | None (implicitly means blocker resolved) |
| `COMPLETE` | `IN_PROGRESS` | Triggers revision increment |

**Enforcement:** `isValidStatusTransition()` validator. Illegal transitions throw errors.

---

### 9. COMPLETE Requires All Acceptance Criteria Met

**Rule:** A work package cannot be marked `COMPLETE` unless all acceptance criteria have `met: true`.

**Enforcement:** `canCompleteWorkPackage()` validator in `ledger_update_work_package_status` tool.

**Error message format:**
```
Cannot mark work package as COMPLETE: the following acceptance criteria are not met:
  - Criterion 1
  - Criterion 2
```

---

### 10. Dependencies Must Exist Before Creation

**Rule:** When creating a work package, all dependency IDs must already exist in the root index.

**Enforcement:** `ledger_create_work_package` validates dependencies before creating the work package.

**Rationale:** Prevents dangling references.

---

### 11. BLOCKED Status Requires Blocker Object

**Rule:** When transitioning a work package to `BLOCKED`, the `blocked_by` field must be provided.

**Enforcement:** `ledger_update_work_package_status` throws an error if `status: 'BLOCKED'` is passed without `blocked_by`.

---

### 12. Pipelines Require IN_PROGRESS Work Package

**Rule:** A pipeline can only be started on a work package with status `IN_PROGRESS`.

**Enforcement:** `ledger_start_pipeline` validates WP status before creating pipeline.

**Rationale:** Prevents starting work before a work package is claimed.

---

### 13. No Duplicate IN_PROGRESS Pipelines

**Rule:** Only one pipeline of a given type can be `IN_PROGRESS` at a time for a work package.

**Enforcement:** `ledger_start_pipeline` checks for existing `IN_PROGRESS` pipeline of the same type before creating a new one.

**Rationale:** Forces agents to complete or fail a pipeline before retrying.

---

### 13a. Pipelines Must Follow the Required Ordering

**Rule:** Pipelines must be started in order: `implementation` → `qa` → `code-review` → `documentation`. Attempting to start a pipeline without the prerequisite having a `PASS` status throws a descriptive error.

**Enforcement:** `ledger_start_pipeline` checks the `PIPELINE_PREREQUISITES` map before creating a pipeline.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** `implementation` has no prerequisite and can always be started (subject to other constraints).

---

### 13b. Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to the `PIPELINE_AGENT_MAP`:

| Pipeline type | Assigned agent |
|---|---|
| `implementation` | `Developer` |
| `qa` | `QA` |
| `code-review` | `Reviewer` |
| `documentation` | `Documentation` |

**Enforcement:** `ledger_start_pipeline` applies the map atomically alongside the pipeline creation. Both WP detail and root index summary are updated.

---

### 13c. Rework Count Increments on Pipeline Retry

**Rule:** When `ledger_start_pipeline` is called for a pipeline type that already has a previous `FAIL` pipeline, the work package's `rework_count` field is automatically incremented.

**Enforcement:** `ledger_start_pipeline` checks for any previous FAIL pipeline of the same type before creating the new pipeline entry; if found, `rework_count` is incremented atomically.

**Initial value:** The field is absent (`undefined`) until the first rework; it is never initialised to `0` on creation.

| Previous pipelines for type | rework_count change |
|---|---|
| None or only PASS | No increment |
| At least one FAIL | +1 |

---

### 13d. Handoff Notes Are Routed via NEXT_AGENT_MAP

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined automatically by `NEXT_AGENT_MAP`:

| Pipeline type | Next agent (to_agent) |
|---|---|
| `implementation` | `QA` |
| `qa` | `Reviewer` |
| `code-review` | `Documentation` |
| `documentation` | `Synthesis` |

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // Inferred from PIPELINE_AGENT_MAP
  to_agent: string;   // Inferred from NEXT_AGENT_MAP
  timestamp: string;
  notes: string[];    // The strings passed in handoff_notes
}
```

**Consumption:** `ledger_get_next_action` and `ledger_get_next_actions` include any handoff notes addressed to the requesting agent in their response, so the next agent sees the notes immediately when they ask for their next action.

---

### 14. Pipeline Comments Have No Agent Field

**Rule:** Pipeline-level comments do not include an `agent` field. The agent is inferred from the pipeline type.

**Convention:**
- `implementation` pipeline → Developer
- `qa` pipeline → QA
- `code-review` pipeline → Reviewer
- `documentation` pipeline → Documentation

**Contrast:** Project-level comments include an explicit `agent` field because they are not tied to a specific pipeline.

---

### 15. Incident Comments Require Context

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

### 16. Lock Timeout Is 10 Seconds

**Rule:** File locks have a stale timeout of 10 seconds. Locks older than this are considered abandoned and can be forcibly acquired.

**Implication:** If a process crashes while holding a lock, other processes will wait up to 10 seconds before retrying.

---

### 17. Lock Retry Count Is 5

**Rule:** Lock acquisition is retried up to 5 times with 200ms intervals before failing.

**Total wait time:** ~5 × 200ms = ~1 second (plus stale timeout consideration).

---

## Testing Constraints

### 18. Test Timeout Is 10 Seconds

**Rule:** All Vitest tests have a default timeout of 10 seconds.

**Configuration:** Set in `vitest.config.ts`.

**Rationale:** Integration tests may involve multiple file I/O operations and lock acquisitions.

---

### 19. Prefer Real Implementations Over `vi.mock` for Agent Registry and Ledger Tests

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

### 20. Always Supply an Isolated Ledger Root When Constructing `LedgerStore` in Tests

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

### 21. `afterEach` Teardown Variables Must Be Declared in the Same `describe` Scope

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

### 19. All Imports Must Use .js Extensions

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

### 20. No Default Exports

**Convention:** All exports are named exports. No default exports are used.

**Rationale:** Improves refactoring and tooling support.

---

## Validation Constraints

### 21. All Reads Are Validated

**Rule:** Every file read operation validates the JSON against a Zod schema before returning data.

**Enforcement:** `LedgerStore.readRootIndex()` and `LedgerStore.readWorkPackage()` both parse and validate.

**Failure modes:**
- File not found → `ENOENT` error
- Malformed JSON → `SyntaxError`
- Schema mismatch → Zod validation error

---

### 22. All Writes Are Validated

**Rule:** Every file write operation validates data against a Zod schema before writing.

**Enforcement:** `LedgerStore.writeRootIndex()` and `LedgerStore.writeWorkPackage()` call `Schema.parse()` before writing.

**Rationale:** Prevents writing invalid data to disk.

---

## Counter Self-Healing

### 23. Project Status Tool Auto-Corrects Counters and Project Status

**Rule:** `ledger_get_project_status` recomputes `total_work_packages`, `pending_work_packages`, and the project `status` from the `work_packages` array on every invocation.

**Behavior:**
- If counters are incorrect, they are silently corrected.
- If `status === 'IN_PROGRESS'` and all WPs are complete (pending = 0, WPs exist), status is healed to `COMPLETE`.
- If `status === 'COMPLETE'` and pending WPs exist, status is healed back to `IN_PROGRESS`.
- An empty project (no WPs) is never auto-healed to `COMPLETE`.
- The root index is rewritten only when a correction is made.

**Rationale:** Provides fault tolerance against bugs that might cause counter or status drift.

---

## Development & Build Constraints

### 16. Changelog Is the Source of Truth for Versioning

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

### 17. Version Sync Runs Automatically Before Dev

**Rule:** The `predev` hook ensures version is synced before running the development server.

**Implication:** You can skip manual `npm run sync-version` if running `npm run dev` — it happens automatically.

**Manual sync needed when:**
- Building for distribution
- Running in production
- CI/CD pipelines
- Testing version display without starting server

---

### 18. Server Version Displays at Startup

**Rule:** The MCP server logs its version to STDERR on startup.

**Example output:**
```
[project-ledger-mcp] Server v1.0.1 started successfully
[project-ledger-mcp] Transport: STDIO
[project-ledger-mcp] Registered tools: ledger_get_project_status, ...
```

**Purpose:** Allows users and CI systems to verify which version is running in their project.

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

**Implication:** There is a brief window between the COMPLETE write and the unblocking write during which the root index shows the WP as COMPLETE but dependents are still BLOCKED. This is safe for single-user workflows, but would be a race condition risk in a concurrent multi-agent environment.

---

### ⚠️ Gotcha 9: WP ID Generation Is Max-Based, Not Length-Based

Work package IDs are generated by scanning the highest existing numeric suffix and adding 1. This means:
- Deleting a WP does not cause ID collisions (unlike a length+1 approach)
- IDs are monotonically increasing but may have gaps (e.g., WP-001, WP-003 if WP-002 was removed)

---

### ⚠️ Gotcha 5: READY Status After Creation Depends on Dependencies

When creating a work package:
- If dependencies are empty or all `COMPLETE` → Initial status is `READY`
- If any dependency is not `COMPLETE` → Initial status is `BLOCKED`

This logic is automatic and transparent to the caller.
