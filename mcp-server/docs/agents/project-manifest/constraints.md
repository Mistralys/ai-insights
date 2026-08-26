# Constraints & Conventions — Core

> **Scope:** Infrastructure rules that apply across the whole server — file I/O, storage layout,
> schema, module system, validation, concurrency, build, and manifest authoring.
>
> **Companion documents:**
> [Workflow](constraints-workflow.md) ·
> [Testing](constraints-testing.md) ·
> [Code Style](constraints-code-style.md) ·
> [Storage & Knowledge](constraints-storage.md) ·
> [GUI](../../../gui/docs/agents/project-manifest/constraints.md)

## Contents

- [Constraint Entry Format](#constraint-entry-format)
- [Workflow Specification Governance](#workflow-specification-governance)
- [File System Constraints](#file-system-constraints)
- [Schema Constraints](#schema-constraints)
- [Concurrency Constraints](#concurrency-constraints)
- [Module System Constraints](#module-system-constraints)
- [Validation Constraints](#validation-constraints)
- [Counter Self-Healing](#counter-self-healing)
- [Development & Build Constraints](#development--build-constraints)
- [Manifest Documentation Constraints](#manifest-documentation-constraints)
- [Cross-Platform Constraints](#cross-platform-constraints)

### Constraint Entry Format

Entries are cited by heading, not by number. Numbers were removed after repeated collisions made
citations ambiguous — link to the heading anchor instead.

New entries follow this structure:

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Workflow Specification Governance

### The Workflow Specification Is the Source of Truth for All Workflow Logic

**Rule:** The [Workflow Specification](../workflow-specification/README.md) is the authoritative definition of all workflow logic — state machines, pipeline routing, status transitions, handoff behavior, recommendation engine behavior, edge cases, and constants. Implementation code must conform to the specification. When code contradicts the specification, the code is wrong.

**Spec-first development:** Changes to workflow logic MUST be made in the specification first, then implemented in code, then validated by tests, then documented in the project manifest — in that order.

**Test traceability:** Test descriptions SHOULD reference the workflow specification section they validate (e.g., `// §14.13 row 1: returns true when QA FAIL started after impl PASS completed`). This convention is already practiced in several test files and should be followed consistently.

**Rationale:** The specification was designed to be a language-agnostic, formally reviewed reference. Treating code as the source of truth defeats this purpose and leads to silent behavioral drift between the TypeScript (MCP server) and Python (orchestrator) implementations.

**Scope:** This constraint applies to workflow logic only — file I/O, schema validation, concurrency primitives, and other infrastructure concerns are governed by the constraints below.

**Consequence for this manifest:** Workflow rules are not restated in the manifest. [constraints-workflow.md](constraints-workflow.md) carries only the server-side enforcement details the specification does not cover — which function enforces a rule, what error text it emits — and points at the spec for the rules themselves.

---

## File System Constraints

### All File I/O Must Be Atomic

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

### Dual-File Updates Require Locking

**Rule:** When writing both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use the appropriate high-level method: `LedgerStore.createWorkPackageWithSync()` for creating a new WP, `LedgerStore.updateWorkPackageWithSync()` for updating a single existing WP, or `LedgerStore.batchUpdateWorkPackagesWithSync()` for updating multiple WPs in one operation. Only fall back to a manual `withLock(store.storageDir, ...)` scope when none of these methods covers the use case. **`store.storageDir` is the only acceptable first argument to `withLock` — never pass `projectPath`, `ledgerRoot`, or `ledgerRoot ?? projectPath`.** Once a `LedgerStore` is constructed, use its `.storageDir` property to obtain the canonical lock directory.

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

### Batch Multi-WP Writes Must Use `batchUpdateWorkPackagesWithSync`

**Rule:** When updating multiple work packages and the root index in a single operation, always use `LedgerStore.batchUpdateWorkPackagesWithSync()`. Never loop over `updateWorkPackageWithSync()` calls or acquire multiple separate `withLock` scopes to write a batch of WPs — this produces one lock acquisition per WP instead of one per operation.

**Rationale:** A loop of per-WP lock acquisitions is not atomic at the operation level: a crash or concurrent write between iterations can leave some WPs updated while others are not, desynchronizing WP state and the root index. `batchUpdateWorkPackagesWithSync` consolidates all reads, validation, writes, and the root index sync into a single lock scope.

**Atomicity invariant (two-pass validate-then-write):** The method validates all WPs via Zod **before** writing any of them. A validation failure on any WP in the batch aborts the entire operation with no disk writes. This is stronger than the per-WP atomicity provided by `updateWorkPackageWithSync`, which validates and writes one WP at a time.

**Note on lock-scope vs. rollback-scope atomicity:** If a file write succeeds for WP-A but a subsequent I/O error prevents writing WP-B, WP-A's write is not rolled back. This characteristic is shared with `updateWorkPackageWithSync`. Validation failures are fully atomic (no writes); I/O failures after the write phase begins are not.

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

### `writeWorkPackage` and `writeRootIndex` Are Internal — Tool Code Must Not Call Them

**Rule:** `LedgerStore.writeWorkPackage()` and `LedgerStore.writeRootIndex()` are marked `@internal` in source. Tool functions (`src/tools/`) and shared helpers (`src/utils/`) must never call these methods directly. All WP+root writes must go through one of the three sync methods above.

**Rationale:** Bypassing the sync methods skips `last_updated` auto-stamping, Zod validation, `.meta.json` sync, and the single-lock atomicity guarantee. The `@internal` tag is documentation-only (TypeScript does not enforce it) — this constraint encodes the boundary as a project rule.

**Legitimate direct callers of `writeRootIndex` (non-tool code):**
- `src/tools/project-lifecycle.ts` — `getProjectStatus()` self-healing: repairs stale counter fields under an explicit `withLock` scope; `initializeProject()` and `completeSynthesis()` for root-index-only transitions that don't involve any WP file write
- `auto-archive.ts` — sets `status: 'ARCHIVED'` with `preserveLastUpdated: true` (root-index write only; sync methods do not apply)
- `observations.ts` — appends a project-level comment (root-index write only; no WP file involved)
- `workflow-handoff.ts` — `buildHandoffResponse()`: increments or caps the `auto_handoff_depth` counter on every handoff-status response; root-index-only write with no WP file involvement
- `importStandaloneProject()` (internal `LedgerStore` method) — bootstraps a standalone project from scratch; manages its own `withLock(storageDir)` scope; architecturally equivalent to `initializeProject()`, so listing it in the allowlist prevents it being incorrectly refactored to a sync method

**`writeWorkPackage` — no external callers; one approved internal exception:** `writeWorkPackage` has no legitimate external callers. The sole approved internal exception is `importStandaloneProject()`, which bootstraps a standalone project from scratch inside `LedgerStore` and manages its own lock scope. The `@internal` restriction targets tool code outside `LedgerStore`; internal bootstrap methods that create a complete project state from scratch may call `writeWorkPackage` directly.

**Anti-pattern:**
```typescript
// ❌ WRONG — bypasses auto-stamping, validation, and .meta.json sync
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:** Use `updateWorkPackageWithSync`, `createWorkPackageWithSync`, or `batchUpdateWorkPackagesWithSync` as shown above.

---

### Paths Must Be Absolute

**Rule:** All MCP tool inputs require absolute paths for `project_path`.

**Rationale:** The server has no concept of "current working directory" — it must be told explicitly where files live.

---

### Plan Folders Must Remain Human-Readable Markdown Only

**Rule:** No machine-generated files (JSON, lock files, etc.) may be written inside plan folders.

**Rationale:** Plan folders are the authoritative human source-of-truth. Machine output lives in the centralized ledger at `{mcp-server}/storage/ledger/{slug}/`.

**Archiving clarification:** `archiveDocuments()` copies files **from** the plan folder **into** the centralized storage directory. The direction is one-way: plan folder → ledger. The archived copy is read-only from the agent's perspective — it exists for retrieval by the GUI and tooling, not for editing. The original file in the plan folder remains the authoritative source and is never modified by the server. No writes ever occur inside the plan folder.

**`plan_file` validation:** the `plan_file` argument accepted by `ledger_initialize_project` is enforced at parse time by a Zod `.refine()` check: `v === PLAN_ARCHIVE_FILENAME`. Calls with any value other than `'plan.md'` are rejected with a Zod validation error before reaching handler logic. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on the archived plan document having the fixed filename `plan.md`.

**Archive error contract:** `archiveDocuments()` uses a discriminated error strategy:
- Missing source file (`ENOENT`) — the filename is silently added to `skipped[]` and a warning is written to `stderr`. The operation continues with remaining files.
- All other I/O errors (e.g., `EACCES`, `ENOSPC`, `EISDIR`) — the error is **re-thrown** to the caller. Callers must not assume all errors from `archiveDocuments()` are benign.

---

### `.meta.json` Must Be Written Under the Project Lock

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync). Note: `writeRootIndex` is `@internal` — see the allowlist above for legitimate direct callers.

**Rationale:** Prevents `.meta.json` from lagging behind the root index in a concurrent environment.

---

### Central Ledger Root Is Resolved Once at Startup

**Rule:** `resolveLedgerRoot()` is called once at server startup. The `--ledger-dir <path>` CLI argument overrides the default `{mcp-server}/storage/ledger/` location. The resolved path is logged to stderr.

**Usage:**
```bash
# Override ledger root:
node dist/index.js --ledger-dir /custom/path/to/ledger
```

**Default:** `{mcp-server}/storage/ledger/` (relative to the server package root).

---

### Ledger Storage Paths Must Include the Repository Namespace Level

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

### Project-Directory Discovery Must Be Centralized in `listAllProjectDirs()`

**Rule:** The flat-vs-namespaced two-level scan (`{ledgerRoot}/{slug}/` vs. `{ledgerRoot}/{repoName}/{slug}/`) has changed shape multiple times as the storage layout evolved. `LedgerStore.listAllProjectDirs()` in `src/storage/ledger-store.ts` is the single source of truth for this scan; `LedgerStore.listAllProjects()` delegates to it. **Never re-implement depth-1/depth-2 layout detection anywhere else** — including in root-level `scripts/` utilities.

Root-level Node scripts that need to enumerate ledger project directories MUST import `listAllProjectDirs()` from `scripts/lib/ledger-dirs.js`, which loads the compiled `LedgerStore` from `mcp-server/dist/` (rebuilding it when stale) rather than duplicating the scan logic in plain JavaScript. Current consumers: `scripts/backfill-duration.js`, `scripts/import-standalone.js` (`collectKnownSlugs()`), and `scripts/lib/store-commands.js` (`storeList()`).

**See also:** `api-surface.md` §`LedgerStore` static methods — `listAllProjectDirs()` signature and delegation contract.

---

### STDIO Logging Discipline

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

### Work Package IDs Must Follow WP-### Format

**Rule:** All work package IDs must match the regex `/^WP-\d{3,}$/` (e.g., `WP-001`, `WP-042`, `WP-999`, `WP-1000`). The minimum is three digits; there is no upper bound to future-proof projects beyond WP-999.

**Enforcement:** Validated by Zod schemas in `GetWorkPackageSchema`, `CreateWorkPackageSchema` (dependencies array), `ClaimWorkPackageSchema`, `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`, and `AddObservationSchema`, as well as the utility functions `formatWpId()` and `parseWpId()`.

---

### Timestamps Must Use UTC ISO 8601 Format

**Rule:** All timestamp fields use UTC ISO 8601 format (`YYYY-MM-DDTHH:MM:SSZ`) with a trailing `Z`. Always use the `now()` utility function.

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

### JSON Must Be Pretty-Printed

**Rule:** All JSON files written by the server must use 2-space indentation and include a trailing newline.

**Rationale:** Human readability and clean git diffs.

**Enforcement:** `atomicWriteJson()` automatically formats as `JSON.stringify(data, null, 2) + '\n'`.

---

## Concurrency Constraints

### Lock Timeout Is 10 Seconds

**Rule:** File locks have a stale timeout of 10 seconds. Locks older than this are considered abandoned and can be forcibly acquired.

**Implication:** If a process crashes while holding a lock, other processes will wait up to 10 seconds before retrying.

---

### Lock Retry Count Is 50

**Rule:** Lock acquisition is retried up to 50 times with 200ms–1000ms exponential backoff before failing.

**Total retry window:** ~10–50 seconds, ensuring coverage of the 10s stale timeout.

---

## Module System Constraints

### All Imports Must Use .js Extensions

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

### No Default Exports

**Convention:** All exports are named exports. No default exports are used.

**Rationale:** Improves refactoring and tooling support.

---

## Validation Constraints

### All Reads Are Validated

**Rule:** Every file read operation validates the JSON against a Zod schema before returning data.

**Enforcement:** `LedgerStore.readRootIndex()` and `LedgerStore.readWorkPackage()` both parse and validate.

**Failure modes:**
- File not found → `ENOENT` error
- Malformed JSON → `SyntaxError`
- Schema mismatch → Zod validation error

---

### All Writes Are Validated

**Rule:** Every file write operation validates data against a Zod schema before writing.

**Enforcement:** `LedgerStore.writeRootIndex()` and `LedgerStore.writeWorkPackage()` call `Schema.parse()` before writing.

**Rationale:** Prevents writing invalid data to disk.

---

## Counter Self-Healing

### Project Status Tool Auto-Corrects Counters and Project Status

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

### Changelog Is the Source of Truth for Versioning

**Rule:** All version changes must be made in `changelog.md` first, then synced to `package.json`.

**Rationale:** Maintains a single source of truth and ensures version history is documented.

**Process:**
1. Update `changelog.md` with a new version header.
2. Run `npm run sync-version` to extract the version and update `package.json`.
3. The MCP server displays the version at startup in STDERR.

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

### Version Sync Runs Automatically Before Dev

**Rule:** The `predev` hook ensures the version is synced before running the development server.

**Implication:** You can skip manual `npm run sync-version` if running `npm run dev` — it happens automatically.

**Manual sync needed when:**
- Building for distribution
- Running in production
- CI/CD pipelines
- Testing version display without starting the server

---

### Server Version Displays at Startup

**Rule:** The MCP server logs its version to STDERR on startup.

**Example output:**
```
[project-ledger-mcp] Server v1.0.1 started successfully
[project-ledger-mcp] Transport: STDIO
[project-ledger-mcp] Registered tools: ledger_get_project_status, ...
```

**Purpose:** Allows users and CI systems to verify which version is running in their project.

---

### Runtime Config Is Read From an In-Memory Cache

**Rule:** `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`). The following apply:

- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.

---

## Manifest Documentation Constraints

### No Implementation Provenance in Manifest Documents

**Rule:** Project manifest documents (`api-surface.md`, `constraints*.md`, `data-flows.md`, etc.) describe the **current state** of the codebase. They must not contain work package IDs, plan references, or other implementation-history markers (e.g., `WP-003`, `added in WP-005`, `wired in WP-004`).

**Where provenance belongs:** Plan documents, synthesis reports, and changelog entries — not the manifest.

**Rationale:** WP IDs are scoped to individual plans. A reader who has not ingested the plan history cannot resolve `WP-006` to a meaningful context. Provenance markers also accumulate over time and add noise without aiding comprehension of current behavior.

**What is allowed:** References to `WP-###` as a *data format specifier* (e.g., `work_package_id: string // WP-### format`) are fine — these describe the runtime data model, not implementation history.

---

### No Counts, Tallies, or Inventories in Manifest Documents

**Rule:** Do not state how many tests, files, handlers, or constraints exist. Write the durable fact without the number — "all affected handler functions", not "all 18 affected handler functions". Include a figure only when it carries analytical value that inspection cannot supply, such as a threshold or a configured limit.

**Rationale:** Counts decay silently on the next commit while continuing to look authoritative. Any reader can obtain the current figure on demand; a stale one actively misleads.

**Anti-pattern:** "All 97 storage tests pass." · "Six view JS files inject HTML." · "12 helper classes."

**Correct pattern:** "The storage test suite passes." · "Several view JS files inject HTML." · "The helper classes in this module."

---

### Resolved Limitations Are Deleted, Not Annotated

**Rule:** When a known limitation is resolved, remove the entry. Do not retain it with a *(Resolved)* marker and a historical narrative. The resolution belongs in the changelog; the manifest describes only current state.

**Rationale:** A resolved limitation is not a limitation. Retained entries mislead readers into planning around a constraint that no longer exists, and their historical detail is exactly the provenance the rule above excludes.

---

### Constraints Are Cited by Heading, Not by Number

**Rule:** Do not number constraint entries, and do not cite them by number in source comments, tests, or sibling manifest documents. Reference the heading text or link to its anchor.

**Rationale:** Numbers collided repeatedly as the document grew — the same number came to identify two unrelated constraints, making every citation in that range ambiguous. Headings survive reordering, insertion, and redistribution across documents; numbers do not.

**Anti-pattern:** `// See Constraint 55.` · `**See also:** §63 for the general rule.`

**Correct pattern:** `// See "Non-PM Handoff Functions Must Dispatch…" in constraints-workflow.md.`

---

## Cross-Platform Constraints

### All Code Must Run on Windows, macOS, and Linux

**Rule:** The MCP server must work on all three supported platforms. Do not introduce OS-specific APIs without a cross-platform fallback. Use `path.join()` / `path.resolve()` for all file paths — never hardcode `/` or `\` separators.

**File locking:** Uses `proper-lockfile` (cross-platform npm package). Do not replace with a platform-specific alternative.

**Rationale:** The workspace-wide cross-platform policy (see root `AGENTS.md` → Cross-Platform Policy) applies to all sub-projects. The MCP server runs alongside the user's IDE on their desktop OS.
