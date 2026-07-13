# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.0.0

## Prior Project Context
The repository has 110 tracked projects, with extensive use of the standalone import flow (`ledger_import_standalone`). The user regularly revisits synthesis documents after archival — e.g. marking deferred improvements as done — and currently has no way to propagate those edits back into the ledger. The feature aligns with the strategic vision of reducing friction in daily usage.

## Summary
Add a new MCP tool `ledger_update_synthesis` that allows updating the `outcome_summary` and the archived `synthesis.md` file for an already-imported project. The tool re-reads the on-disk `synthesis.md` from the plan folder, re-extracts the outcome summary, re-archives the file into the centralized storage directory, and updates both the root index and `.meta.json`. A 3-month staleness guard prevents modifications to projects imported more than 90 days ago.

## Architectural Context

The standalone import flow lives in two layers:

- **Tool handler:** [mcp-server/src/tools/standalone-import.ts](mcp-server/src/tools/standalone-import.ts) — validates inputs, reads `synthesis.md`, calls `parseOutcomeSummary()`, and delegates storage writes to `LedgerStore.importStandaloneProject()`.
- **Storage layer:** [mcp-server/src/storage/ledger-store.ts](mcp-server/src/storage/ledger-store.ts) — `importStandaloneProject()` creates the full project structure (root index, WP-001, `.meta.json`, archived documents) inside a single `withLock` scope.

The synthesis outcome flows through three data stores:
1. **Root index** (`project-ledger.json`): `outcome_summary`, `synthesis_generated_at`, `last_updated`
2. **`.meta.json`**: `outcome_summary`, `last_updated` (auto-synced via `writeRootIndex()`)
3. **Archived file**: `synthesis.md` copied to `storageDir` via `archiveDocuments()`

Key existing patterns:
- `archiveDocuments()` uses `copyFile()` which overwrites by default — re-archiving is safe.
- `writeRootIndex()` auto-syncs `.meta.json` including `outcome_summary` via key-presence semantics.
- `parseOutcomeSummary()` in [mcp-server/src/utils/synthesis-parser.ts](mcp-server/src/utils/synthesis-parser.ts) extracts the summary from Markdown.
- `completeSynthesis()` in [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) is the closest existing pattern — it reads a root index, mutates `outcome_summary`, writes it back, and archives `synthesis.md`, all inside a `withLock` scope.
- `parseTimestamp()` in [mcp-server/src/utils/timestamp.ts](mcp-server/src/utils/timestamp.ts) already handles both legacy and ISO formats.

## Approach / Architecture

Add a **new tool handler** `ledger_update_synthesis` alongside the existing `ledger_import_standalone` in the same file ([mcp-server/src/tools/standalone-import.ts](mcp-server/src/tools/standalone-import.ts)). This keeps the standalone lifecycle operations co-located.

The tool will:
1. Resolve the project via standard `project_path` / `cwd_path` resolution.
2. Verify the project exists in the ledger (`ledgerDirExists`).
3. Read the root index and apply guards (status, runner, staleness).
4. Re-read `synthesis.md` from the original plan folder.
5. Re-extract the outcome summary via `parseOutcomeSummary()`.
6. Inside a `withLock` scope: update `outcome_summary` and `last_updated` on the root index, write it (auto-syncing `.meta.json`), and re-archive `synthesis.md`.

No new `LedgerStore` method is needed — the tool composes existing primitives (`readRootIndex`, `writeRootIndex`, `archiveDocuments`) inside a lock scope, following the `completeSynthesis()` pattern exactly.

### Staleness constant

A `MAX_SYNTHESIS_UPDATE_AGE_DAYS = 90` constant will be added to the tool file (not to `constants.ts`, since it's tool-specific policy, not a shared workflow constant). The guard compares `synthesis_generated_at` (or `date_created` as fallback for older imports that may lack it) against the current wall clock.

## Rationale
- **Minimal risk**: The project is uniquely identified by slug in the ledger. The tool only mutates `outcome_summary`, `last_updated`, and the archived `synthesis.md` — no structural changes to WP data, pipeline state, or project status.
- **Existing primitives suffice**: `writeRootIndex`, `archiveDocuments`, and `parseOutcomeSummary` already handle all the mechanics. No new storage methods needed.
- **Co-location**: Placing the tool in `standalone-import.ts` keeps all standalone lifecycle operations together and avoids a new file for a small handler.
- **3-month guard**: Prevents accidental modification of old historical records while allowing the natural revisit window the user describes.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Tool location | Add to `standalone-import.ts` | New file `standalone-update.ts`; add to `project-lifecycle.ts` | Co-location wins: the import and update tools share the same schema patterns, helpers, and conceptual scope. A separate file adds navigation overhead for a ~60-line handler. |
| Staleness reference timestamp | `synthesis_generated_at` with `date_created` fallback | `last_updated`; `date_created` only | `synthesis_generated_at` captures when the synthesis was *completed/imported*, which is the most semantically correct anchor for "how long ago was this imported". Fallback to `date_created` handles pre-existing imports that lack the field. |
| Allow outcome_summary override | Re-extract from synthesis.md only | Accept an explicit `outcome_summary` parameter | Re-extraction is safer: it guarantees the summary always reflects the actual document content. An explicit override could desync summary and document. |
| Guard: restrict to standalone runner | Yes — `runner === 'standalone'` | Allow any runner | The use case is specifically for standalone plans revisited after archival. Ledger workflow projects have their own synthesis lifecycle (`completeSynthesis`). Restricting to standalone keeps the tool focused and prevents misuse. |

## Pattern Alignment
- Follows the `completeSynthesis()` pattern in [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts): read root index → mutate → write root index → archive document, all inside `withLock(store.storageDir)`.
- Follows the `_internal` export convention (Constraint §53) for test access.
- Follows the `register(server: McpServer)` pattern for tool registration.
- Follows the standard `project_path` / `cwd_path` input schema pattern used across all tools.
- Follows Constraint §1 (atomic writes via `writeRootIndex`) and Constraint §2 (read-modify-write under lock).

## Detailed Steps

### Step 1: Add the `UpdateSynthesisSchema` Zod schema

In [mcp-server/src/tools/standalone-import.ts](mcp-server/src/tools/standalone-import.ts), add a new Zod schema after the existing `ImportStandaloneSchema`:

```typescript
const UpdateSynthesisSchema = z.object({
  project_path: z.string().optional().describe('...'),
  cwd_path: z.string().optional().describe('...'),
});
```

This follows the standard two-path resolution pattern.

### Step 2: Add the `MAX_SYNTHESIS_UPDATE_AGE_DAYS` constant

Add a constant at the top of the tool file:

```typescript
const MAX_SYNTHESIS_UPDATE_AGE_DAYS = 90;
```

### Step 3: Implement the `updateSynthesis` handler

Add the handler function after `importStandalone`:

1. Resolve `planPath` from `project_path` / `cwd_path` (same pattern as `importStandalone`).
2. Validate slug via `planFolderBasename()`.
3. Construct a `LedgerStore` from the plan path.
4. Guard: `ledgerDirExists()` — the project must already be imported.
5. Guard: read root index; verify `status === 'COMPLETE'`.
6. Guard: verify `runner === 'standalone'`.
7. Guard: compute age from `synthesis_generated_at` (falling back to `date_created`); reject if older than `MAX_SYNTHESIS_UPDATE_AGE_DAYS`.
8. Guard: verify `synthesis.md` exists in the plan folder.
9. Read `synthesis.md` from the plan folder.
10. Extract `outcome_summary` via `parseOutcomeSummary()`.
11. Inside `withLock(store.storageDir)`:
    - Re-read root index (TOCTOU safety).
    - Update `outcome_summary` and `last_updated`.
    - Call `store.writeRootIndex(rootIndex)` (auto-syncs `.meta.json`).
    - Call `store.archiveDocuments(['synthesis.md'])` to overwrite the archived copy.
12. Return a success response with the updated `outcome_summary`, `archived_files`, and `slug`.

### Step 4: Export via `_internal` for testing

Add `updateSynthesis` to the existing `_internal` export object.

### Step 5: Register the new tool

In the existing `register()` function, add a second `server.registerTool()` call for `ledger_update_synthesis`.

### Step 6: Update the tool registration log line in `index.ts`

In [mcp-server/src/index.ts](mcp-server/src/index.ts), add `ledger_update_synthesis` to the registered-tools log line.

### Step 7: Add help content

In [mcp-server/src/tools/help-content.ts](mcp-server/src/tools/help-content.ts), add:
- A row in the quick-reference table for `ledger_update_synthesis`.
- A detailed help entry in the `TOOL_HELP` record.

### Step 8: Write tests

Add a new `describe` block in [mcp-server/tests/tools/standalone-import.test.ts](mcp-server/tests/tools/standalone-import.test.ts) covering:
- Successful update: synthesis re-read, outcome_summary updated, file re-archived.
- Guard: project not found (not imported) → error.
- Guard: project status is not COMPLETE → error.
- Guard: runner is not 'standalone' → error.
- Guard: staleness — synthesis older than 90 days → error.
- Guard: synthesis.md missing from plan folder → error.
- Verify root index `outcome_summary` and `last_updated` are updated on disk.
- Verify `.meta.json` `outcome_summary` is synced.
- Verify archived `synthesis.md` in storage dir reflects the updated content.

### Step 9: Update the Standalone Archiver persona YAML metadata

In [personas/ledger-support/src/meta/standalone-archiver.yaml](personas/ledger-support/src/meta/standalone-archiver.yaml):

1. Add `central_pm/ledger_update_synthesis` to the `tools` list (below the existing `ledger_import_standalone` entry).
2. Add a new changelog entry at the top: `1.3.0 (YYYY-MM-DD): Added ledger_update_synthesis tool for updating synthesis after post-import edits`.
3. Update the `description` to mention both import and update capabilities.

### Step 10: Update the Standalone Archiver persona content

In [personas/ledger-support/src/content/standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md):

1. **Mission section:** Expand to mention the update capability: "…or update the ledger when the user has edited `synthesis.md` after archival."
2. **Inputs section:** Add a second input mode — the user may provide a plan folder path for an already-archived project whose synthesis has been edited.
3. **MCP Tools table:** Add a row for `ledger_update_synthesis` with purpose: "Update the outcome summary and archived synthesis.md for an already-imported standalone project".
4. **Workflow section:** Add a new Step 3 ("Update synthesis after edits") that describes when and how to call `ledger_update_synthesis`:
   - Trigger: the user explicitly says they edited the synthesis after archival, or the user asks to "update" an already-archived project.
   - Action: call `ledger_update_synthesis` with `project_path`.
   - Error handling table: cover `not found`, `not COMPLETE`, `not standalone`, `older than 90 days`, and `synthesis.md not found` errors.

### Step 11: Rebuild persona outputs

Run `node scripts/build-personas.js` from the workspace root to regenerate the `vs-code/`, `claude-code/`, and `deep-agents/` output files for the Standalone Archiver persona.

## Dependencies
- No new npm dependencies.
- No new shared workflow manifest changes.
- No orchestrator changes needed (tool is IDE-only).
- Persona rebuild depends on Step 1–7 being complete (the tool must exist before the persona can reference it).

## Required Components
- [mcp-server/src/tools/standalone-import.ts](mcp-server/src/tools/standalone-import.ts) — new tool handler + schema + registration
- [mcp-server/src/tools/help-content.ts](mcp-server/src/tools/help-content.ts) — help text for new tool
- [mcp-server/src/index.ts](mcp-server/src/index.ts) — log line update
- [mcp-server/tests/tools/standalone-import.test.ts](mcp-server/tests/tools/standalone-import.test.ts) — new test cases
- [personas/ledger-support/src/meta/standalone-archiver.yaml](personas/ledger-support/src/meta/standalone-archiver.yaml) — add tool to `tools` list, bump changelog
- [personas/ledger-support/src/content/standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md) — add update workflow, tool table row, expanded mission

## Assumptions
- `synthesis_generated_at` is set during `importStandaloneProject()` and is available on all imported projects. For older imports that predate this field, `date_created` serves as a reasonable fallback.
- The plan folder remains at its original path after import (so `synthesis.md` can be re-read from there). This is the same assumption that `importStandalone` makes.
- `copyFile()` overwrites existing files by default (Node.js documented behavior), making re-archival safe without explicit delete-then-copy.

## Constraints
- Constraint §1 (atomic writes): Satisfied — all writes go through `writeRootIndex()` → `atomicWriteJson()`.
- Constraint §2 (locking): Satisfied — the read-modify-write cycle is wrapped in `withLock(store.storageDir)`.
- Constraint §2c (storage access via LedgerStore): Satisfied — no direct file I/O to storage dir; only `LedgerStore` methods used.
- Cross-platform: No new path handling — reuses existing `join()` and `LedgerStore` path utilities.

## Out of Scope
- Updating `plan.md` after import (separate concern, not requested).
- Updating non-standalone (ledger workflow) projects — those have their own synthesis lifecycle.
- Batch update of multiple projects at once.
- Extending the staleness window beyond 90 days (configurable via parameter) — can be added later if needed.

## Acceptance Criteria

- AC-01: `ledger_update_synthesis` re-reads `synthesis.md` from the plan folder, re-extracts `outcome_summary`, and updates the root index and `.meta.json`.
- AC-02: The archived `synthesis.md` in the storage directory is overwritten with the current plan-folder version.
- AC-03: The tool rejects updates when the project does not exist in the ledger.
- AC-04: The tool rejects updates when the project status is not `COMPLETE`.
- AC-05: The tool rejects updates when the project runner is not `standalone`.
- AC-06: The tool rejects updates when the project was imported more than 90 days ago (based on `synthesis_generated_at` or `date_created` fallback).
- AC-07: The tool rejects updates when `synthesis.md` does not exist in the plan folder.
- AC-08: All existing tests continue to pass (zero regressions).
- AC-09: The Standalone Archiver persona's `mcp_tools` list includes `central_pm/ledger_update_synthesis` and the persona content describes when and how to use it.
- AC-10: Persona outputs (`vs-code/`, `claude-code/`, `deep-agents/`) are regenerated and reflect the updated tool and workflow.

## Testing Strategy
Tests drive the handler directly via `_internal.updateSynthesis`, using the same `process.argv` injection pattern as the existing standalone import tests to redirect storage to a temporary directory.

## Test Plan

- `standalone-import.test.ts` — `describe('ledger_update_synthesis — successful update')` — Verifies outcome_summary is updated on root index and .meta.json, archived file is overwritten — AC-01, AC-02
- `standalone-import.test.ts` — `'updates outcome_summary when synthesis is edited'` — Import, modify synthesis.md, call update, verify new summary — AC-01
- `standalone-import.test.ts` — `'re-archives synthesis.md to storage directory'` — Verify archived file content matches updated source — AC-02
- `standalone-import.test.ts` — `'syncs outcome_summary to .meta.json'` — Read .meta.json after update and verify outcome_summary field — AC-01
- `standalone-import.test.ts` — `'rejects when project does not exist in ledger'` — Call update without prior import → error — AC-03
- `standalone-import.test.ts` — `'rejects when project status is not COMPLETE'` — Manually set status to IN_PROGRESS → error — AC-04
- `standalone-import.test.ts` — `'rejects when runner is not standalone'` — Set runner to 'orchestrator' → error — AC-05
- `standalone-import.test.ts` — `'rejects when project is older than 90 days'` — Set synthesis_generated_at to 91 days ago → error — AC-06
- `standalone-import.test.ts` — `'rejects when synthesis.md is missing from plan folder'` — Delete synthesis.md before update → error — AC-07
- Persona YAML — verify `tools` list includes `central_pm/ledger_update_synthesis` — AC-09
- Persona content — verify MCP tools table has `ledger_update_synthesis` row and workflow includes update step — AC-09
- Persona build — `node scripts/build-personas.js --check` exits 0 (outputs are fresh) — AC-10

## Documentation Updates

- [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) — Add `ledger_update_synthesis` tool signature and description
- [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) — No changes needed (no new files)
- [mcp-server/docs/agents/project-manifest/data-flows.md](mcp-server/docs/agents/project-manifest/data-flows.md) — Add a synthesis update data flow if a standalone lifecycle section exists
- [personas/ledger-support/src/meta/standalone-archiver.yaml](personas/ledger-support/src/meta/standalone-archiver.yaml) — Tool list, changelog, description
- [personas/ledger-support/src/content/standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md) — Mission, MCP tools table, workflow step
- Generated persona outputs (`vs-code/`, `claude-code/`, `deep-agents/`) — Rebuilt via `node scripts/build-personas.js`

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Plan folder moved/deleted after import** | Tool returns a clear error when `synthesis.md` is not found at the original path. This is the same assumption `importStandalone` makes — no new risk. |
| **Concurrent updates to the same project** | `withLock(store.storageDir)` serializes access. Re-read inside lock (TOCTOU safety) ensures guards are checked against fresh state. |
| **Staleness guard too restrictive** | 90 days is generous for the described use case (revisiting shortly after archival). If needed, the constant can be increased or made configurable in a follow-up. |
| **Pre-existing imports lack `synthesis_generated_at`** | Fallback to `date_created` ensures the staleness guard works for all imported projects. |
