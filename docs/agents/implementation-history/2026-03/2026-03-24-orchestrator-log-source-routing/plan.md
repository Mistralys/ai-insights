# Plan

## Summary

Fix the GUI's orchestrator log handling so that viewing logs during an active run no longer destroys the live log file. The current `migrateOrphanedLogs()` function uses `rename()` (a destructive move) to migrate logs from the orchestrator's `logs/` directory into ledger storage. When the GUI lists runs while the orchestrator is still writing, this moves the file out from under the running process, causing the orchestrator to lose its open file handle and the archived copy to be a partial snapshot (often just heartbeats).

The fix introduces a **dual-source log resolver** with clear rules:

- **Active runs** → read directly from the orchestrator's source `logs/` directory (never move/copy mid-run).
- **Completed runs** → read from ledger storage (copy from orchestrator source if not yet archived).
- **Stale archives** → if the orchestrator source file still exists and is newer than the archived copy, refresh the archive via copy.

From the orchestrator's perspective, nothing changes — it continues writing to `orchestrator/logs/` and copying to ledger storage at run completion.

## Architectural Context

### Current log lifecycle

1. **Orchestrator writes** to `orchestrator/logs/{timestamp}-{slug}.jsonl` ([orchestrator/src/utils/logging.py](orchestrator/src/utils/logging.py#L310-L318) — `WorkflowLogger.create()`).
2. **At run completion**, `cli.py` copies the file via `shutil.copy2()` to `{ledgerRoot}/{slug}/orchestrator/logs/` ([orchestrator/src/cli.py](orchestrator/src/cli.py#L585-L596)). The original is intentionally kept.
3. **GUI lists runs** via `GET /api/projects/:slug/runs` → `handleListRunLogs()` ([mcp-server/src/gui/handlers/run-log-handlers.ts](mcp-server/src/gui/handlers/run-log-handlers.ts#L72-L85)).
4. **Server wiring** passes three directories to `handleListRunLogs()` ([mcp-server/gui/server.ts](mcp-server/gui/server.ts#L336)):
   - `logsDir` = `{ledgerRoot}/{slug}/orchestrator/logs/` (primary)
   - `legacyLogsDir` = `{ledgerRoot}/{slug}/` (old flat layout migration)
   - `legacyLogsDir2` = the orchestrator's `logs/` directory (via `resolveOrchestratorLogsDir()`)
5. **`migrateOrphanedLogs()`** ([mcp-server/src/gui/log-resolver.ts](mcp-server/src/gui/log-resolver.ts#L169-L211)) uses `rename()` to **move** files from source to destination — this is the destructive operation that breaks live runs.

### Key files

| File | Role |
|------|------|
| `mcp-server/src/gui/log-resolver.ts` | Core log resolution: `findRunLogs()`, `migrateOrphanedLogs()`, `readLogEntries()`, `isRunActive()` |
| `mcp-server/src/gui/handlers/run-log-handlers.ts` | API handler functions: `handleListRunLogs()`, `handleGetRunLog()` |
| `mcp-server/gui/server.ts` | HTTP routing — wires slug, directories, and query params into handlers |
| `orchestrator/src/utils/logging.py` | `WorkflowLogger` — writes JSONL to `orchestrator/logs/` |
| `orchestrator/src/cli.py` | Post-run `shutil.copy2()` archival to ledger storage |

## Approach / Architecture

Replace the current "migrate-then-read" model with a **read-from-correct-source** model. The handler layer decides *where* to read based on whether a run is active, and archival (copying) only happens for completed runs:

```
GUI request for run logs
  │
  ├─ List runs (GET /runs)
  │   ├─ Scan ledger storage dir → completed run logs
  │   ├─ Scan orchestrator source dir → active + not-yet-archived logs
  │   ├─ Merge, deduplicate (same filename = same run)
  │   ├─ For completed runs not yet in ledger storage → copy (not rename)
  │   └─ Return merged list with source dir metadata
  │
  └─ Read log (GET /runs/:filename)
      ├─ Is the run active? → read from orchestrator source dir
      ├─ Does file exist in ledger storage? → read from there
      ├─ Fallback: read from orchestrator source dir
      └─ If source is newer than archive → refresh archive (copy)
```

### Key design decisions

1. **Copy, never rename.** Replace all `rename()` calls in `migrateOrphanedLogs()` with `copyFile()` from `node:fs/promises`. The orchestrator's `logs/` directory is its territory — the GUI must never mutate it.

2. **Active-run detection drives source selection.** The existing `isRunActive()` helper (checks last JSONL line for `run_end`/`run_error`) is reused. Active runs are always read from the orchestrator source directory.

3. **`handleGetRunLog` becomes source-aware.** It receives the orchestrator source directory as an additional parameter and resolves the correct source before calling `readLogEntries()`.

4. **Legacy flat-directory migration stays.** The first `legacyLogsDir` migration (old `{ledgerRoot}/{slug}/` flat layout) should also use `copyFile()` instead of `rename()`, but its logic is otherwise fine — those files are not being written to by any process.

5. **Stale archive refresh.** When both the orchestrator source file and the archived copy exist, and the source has a newer `mtime`, the archive is silently refreshed via `copyFile()`. This covers the edge case where the orchestrator's post-run copy failed or was interrupted.

## Rationale

- **Root cause is `rename()`**: Using `rename()` to "migrate" files from the orchestrator source directory is fundamentally unsafe because the orchestrator may have the file open for appending. On macOS (and most Unix systems), `rename()` succeeds even with an open file descriptor, but the orchestrator's `_fh` then points to a file in the *new* location while the orchestrator still believes it's writing to the *old* path. New `open()` calls or log reads from the old path find nothing.
- **Read-routing is simpler than synchronization**: Rather than adding locking or IPC between the orchestrator and GUI to coordinate file access, we simply read from the correct location based on run state. This requires zero changes to the orchestrator.
- **`copyFile()` is safe for concurrent reads**: Even if the orchestrator is actively writing, `copyFile()` will snapshot the file at that point in time. For active runs we don't copy at all — we read directly. For just-completed runs, the file is stable.

## Detailed Steps

### 1. Replace `rename()` with `copyFile()` in `migrateOrphanedLogs()`

**File:** `mcp-server/src/gui/log-resolver.ts`

- Import `copyFile` from `node:fs/promises` (add to existing import).
- In `migrateOrphanedLogs()`, replace `await rename(...)` with `await copyFile(...)`.
- Update the JSDoc to reflect that files are now copied, not moved.
- The "skip if destDir already has logs" early-return is fine — it prevents redundant copies.

### 2. Add a new `archiveCompletedLogs()` function

**File:** `mcp-server/src/gui/log-resolver.ts`

Create a new exported function that:
- Takes `archiveDir` (ledger storage), `sourceDir` (orchestrator logs), and `slug`.
- Scans `sourceDir` for `*-{slug}.jsonl` files.
- For each file, checks if the run is completed (not active via `isRunActive()`).
- If completed and not yet in `archiveDir`, copies it there.
- If completed and the source file's `mtime` is newer than the archive's `mtime`, refreshes the archive.
- Active runs are skipped entirely (never copied mid-run).
- Returns a list of filenames that were archived.

### 3. Add a new `resolveLogSource()` function

**File:** `mcp-server/src/gui/log-resolver.ts`

Create a new exported function that:
- Takes `archiveDir`, `sourceDir`, and `filename`.
- Checks if the file exists in `archiveDir`. If so, also check `sourceDir`.
- If the file exists only in `sourceDir`, return `sourceDir`.
- If it exists in both and the source is newer, copy source → archive, return `archiveDir`.
- If it exists only in `archiveDir` (or both with archive being current), return `archiveDir`.
- This function is used by `handleGetRunLog` to resolve which directory to read from.

### 4. Refactor `handleListRunLogs()` to use dual-source scanning

**File:** `mcp-server/src/gui/handlers/run-log-handlers.ts`

- Add `orchestratorLogsDir` as a new parameter (the raw orchestrator source dir).
- After legacy migration, call `archiveCompletedLogs()` to archive any finished-but-not-yet-copied runs.
- Scan both `logsDir` (ledger storage) and `orchestratorLogsDir` for run files.
- Merge results: deduplicate by filename, preferring the file with the most content / newest mtime.
- For active runs found in `orchestratorLogsDir`, include them in the response with their source noted.

### 5. Refactor `handleGetRunLog()` to resolve the correct source

**File:** `mcp-server/src/gui/handlers/run-log-handlers.ts`

- Add `orchestratorLogsDir` as a new parameter.
- Before calling `readLogEntries()`, call `resolveLogSource()` to determine the correct directory.
- Pass the resolved directory to `readLogEntries()`.

### 6. Update server wiring

**File:** `mcp-server/gui/server.ts`

- Pass the `legacyLogsDir` (orchestrator source dir) as the new `orchestratorLogsDir` parameter to both `handleListRunLogs()` and `handleGetRunLog()`.
- The `legacyLogsDir` variable already holds the correct value (`resolveOrchestratorLogsDir(getConfig().orchestrator_logs_dir)`).

### 7. Update existing tests and add new test coverage

**Files:** `mcp-server/tests/gui/` (existing test files for log-resolver)

- Update tests for `migrateOrphanedLogs()` to verify files are copied (source still exists) instead of moved (source deleted).
- Add tests for `archiveCompletedLogs()`: active runs not copied, completed runs copied, stale archives refreshed.
- Add tests for `resolveLogSource()`: all four resolution paths.
- Add tests for `handleListRunLogs()` dual-source merge: deduplication, active-run inclusion from orchestrator dir.
- Add tests for `handleGetRunLog()` source routing: active run reads from orchestrator dir, completed run reads from archive.

## Dependencies

- No new npm packages required — `copyFile` is in `node:fs/promises`.
- No changes to the orchestrator (Python) codebase.
- No changes to the GUI frontend — the API response shape (`RunLogEntry[]` and `{ entries, totalLines }`) is unchanged.

## Required Components

- `mcp-server/src/gui/log-resolver.ts` — modify existing + add `archiveCompletedLogs()`, `resolveLogSource()`
- `mcp-server/src/gui/handlers/run-log-handlers.ts` — modify both handlers' signatures and logic
- `mcp-server/gui/server.ts` — update handler call sites to pass `orchestratorLogsDir`
- `mcp-server/tests/gui/` — test updates + new test files

## Assumptions

- The orchestrator's `logs/` directory path is correctly resolved by `resolveOrchestratorLogsDir()` and available to the GUI server at startup (already the case).
- `isRunActive()` reliably distinguishes active from completed runs (already proven in production).
- `stat().mtime` comparison is sufficient for detecting stale archives (both processes run on the same machine, same filesystem).

## Constraints

- The `RunLogEntry` response type must not change shape — the GUI frontend depends on `{ filename, is_active }`.
- The orchestrator Python codebase must not be modified — the fix is entirely in the GUI/MCP server TypeScript layer.
- Security guards in `readLogEntries()` (filename allowlist, path-escape check) must apply equally to both source directories.
- Cross-platform: `copyFile()` works on Windows, macOS, and Linux. `stat().mtime` is cross-platform.

## Out of Scope

- Cleaning up old log files from the orchestrator's `logs/` directory (garbage collection). This is a separate concern.
- Real-time log streaming (WebSocket). The current polling model (`afterLine` parameter) is retained.
- Changes to the orchestrator's post-run `shutil.copy2()` archival — it remains as a belt-and-suspenders mechanism.

## Acceptance Criteria

- Viewing a project's run logs in the GUI while the orchestrator is running does NOT delete or move the live log file.
- Active runs show live, growing log data when polled from the GUI.
- Completed runs whose logs were never archived (e.g., orchestrator's copy step failed) are automatically archived on first GUI access.
- If an orchestrator source file is newer than its archived copy, the archive is silently refreshed.
- The orchestrator's `logs/` directory is never mutated by the GUI (no renames, no deletes).
- All existing tests pass; new tests cover the dual-source resolution logic.

## Testing Strategy

1. **Unit tests** for `archiveCompletedLogs()`:
   - Active run in source dir → not copied to archive.
   - Completed run in source dir, not in archive → copied.
   - Completed run in both dirs, source newer → archive refreshed.
   - Completed run in both dirs, archive current → no-op.

2. **Unit tests** for `resolveLogSource()`:
   - File only in archive → returns archive dir.
   - File only in source → returns source dir.
   - File in both, source newer → copies and returns archive dir.
   - File in both, archive current → returns archive dir.

3. **Unit tests** for `migrateOrphanedLogs()` (updated):
   - After migration, source file still exists (not moved).

4. **Integration-style tests** for `handleListRunLogs()`:
   - Active run visible from orchestrator source, completed run visible from archive.
   - Same filename in both dirs → deduplicated.

5. **Integration-style tests** for `handleGetRunLog()`:
   - Reads active run from orchestrator source dir.
   - Reads completed run from archive dir.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`copyFile()` on a file being actively written** could produce a partial snapshot in the archive. | For active runs we never copy — we read directly from source. Archive copies only happen for completed runs (stable files). |
| **Disk space: logs now exist in two locations** (orchestrator source + ledger archive) instead of being moved. | This is the existing behavior post-orchestrator-run (`shutil.copy2` already keeps the original). A future cleanup task can prune old orchestrator source files. |
| **Race condition: run completes between `isRunActive()` check and read** | Harmless — worst case we read from the source dir for a just-completed run, which has the full log. The next request will archive it. |
| **`stat().mtime` granularity on some filesystems** (e.g., FAT32 has 2s resolution) | Not a practical concern — the project runs on modern macOS/Linux/NTFS filesystems with sub-second mtime. The comparison is only a freshness hint, not a correctness invariant. |
| **Legacy migration (`legacyLogsDir`) still uses `rename()`** | Step 1 changes it to `copyFile()` too. Those files are not being written to, but consistency is better. |
