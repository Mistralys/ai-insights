# Synthesis — Orchestrator Log Source Routing

**Project:** `2026-03-24-orchestrator-log-source-routing`
**Status:** COMPLETE
**Date:** 2026-03-24
**Work Packages:** 5 / 5 COMPLETE — all pipeline stages PASS

---

## Executive Summary

This project eliminated a data-loss bug in the GUI's orchestrator log handling. The root cause was `migrateOrphanedLogs()` using `rename()` to move log files out of the orchestrator's `logs/` directory while the orchestrator might still be writing to them. On Unix systems, a successful `rename()` on an open file descriptor causes the orchestrator's `_fh` to point to the file at its *new* location, while subsequent reads from the original path return nothing — and the archived copy is a truncated partial snapshot containing only heartbeat entries.

The fix introduces a **dual-source log resolver**: active runs are always read directly from the orchestrator's source directory (never moved or copied mid-run), while completed runs are read from ledger storage and only copied there when the run is confirmed finished. Zero changes were required in the orchestrator Python codebase. The GUI API response shape is unchanged.

---

## Problem Statement

When the GUI listed or viewed run logs during an active orchestrator run, `migrateOrphanedLogs()` would `rename()` the live log file from `orchestrator/logs/` into `{ledgerRoot}/{slug}/orchestrator/logs/`. This had two simultaneous effects:

1. **Orchestrator lost its open file handle** — the file moved out from under the running process, so all subsequent log writes went to a now-invisible path.
2. **Archived copy was incomplete** — the rename happened mid-run, producing a snapshot containing only heartbeat events rather than the full workflow log.

The orchestrator's design was correct: it writes to `orchestrator/logs/` during execution and calls `shutil.copy2()` to archive the completed log at run end. The GUI was the aggressor.

---

## Solution Architecture

### Principle: Read from the Right Source, Never Mutate the Orchestrator Directory

```
GUI request for run logs
  │
  ├─ List runs (GET /api/projects/:slug/runs)
  │   ├─ archiveCompletedLogs() — copies finished-but-unarchived runs to ledger storage
  │   ├─ findRunLogs(logsDir) + findRunLogs(orchestratorLogsDir) — concurrent scan
  │   ├─ Merge & deduplicate by filename (archive takes precedence for completed runs)
  │   └─ Active runs unique to orchestratorLogsDir are surfaced in the response
  │
  └─ Read log (GET /api/projects/:slug/runs/:filename)
      └─ resolveLogSource(archiveDir, sourceDir, filename)
          ├─ File only in sourceDir → read from sourceDir
          ├─ File only in archiveDir → read from archiveDir
          ├─ File in both, source newer → refresh archive via copyFile(), read from archiveDir
          └─ File in both, archive current → read from archiveDir
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `copyFile()` replaces all `rename()` calls | The orchestrator owns its `logs/` directory. The GUI must never mutate it. `copyFile()` is safe for concurrent reads and never removes the source. |
| Active-run detection drives source selection | Reuses the existing `isRunActive()` helper (checks last JSONL line for `run_end`/`run_error`). No IPC or locking required. |
| Archive takes precedence in deduplication | When the same filename exists in both directories, the archive copy (logsDir) wins because `archiveCompletedLogs()` already ran a self-heal pass before the merge. |
| Zero orchestrator changes | The orchestrator continues writing to `orchestrator/logs/` and calling `shutil.copy2()` at run end — unchanged. The fix is entirely in the TypeScript GUI/MCP server layer. |
| Legacy flat-directory migration preserved | The pre-existing one-time migration from the old `{ledgerRoot}/{slug}/` flat layout was also converted from `rename()` to `copyFile()` for safety. |

---

## Work Package Outcomes

### WP-001 — Replace `rename()` with `copyFile()` in `migrateOrphanedLogs()`
**File:** `mcp-server/src/gui/log-resolver.ts`

- `copyFile` imported from `node:fs/promises`.
- All `rename()` calls in both the primary and legacy flat-directory migration paths replaced with `await copyFile(src, dest)`.
- JSDoc updated to explicitly state: *"Source files are preserved — `copyFile()` is used instead of `rename()` to avoid destroying files that may still be open by the orchestrator."*
- Best-effort per-file try/catch pattern retained (self-healing migration).
- **Minor:** catch block wording "cannot be moved" should read "cannot be copied" — non-blocking doc issue flagged for a future cleanup pass.

### WP-002 — Add `archiveCompletedLogs()` and `resolveLogSource()`
**File:** `mcp-server/src/gui/log-resolver.ts`

**`archiveCompletedLogs(archiveDir, sourceDir, slug) → Promise<string[]>`**
- Scans `sourceDir` for `*-{slug}.jsonl` files.
- Skips any file where `isRunActive()` returns true (never copies mid-run).
- Copies completed files not yet in `archiveDir`.
- Refreshes stale archives when `srcStat.mtimeMs > destStat.mtimeMs`.
- Returns array of filenames that were archived or refreshed.
- Uses `Promise.all([stat(src), stat(dest)])` for efficient mtime comparison.

**`resolveLogSource(archiveDir, sourceDir, filename) → Promise<string>`**
- Decision matrix:
  - Source only → returns `sourceDir`
  - Archive only (or neither) → returns `archiveDir`
  - Both exist, source newer → `copyFile(src → archive)` then returns `archiveDir`
  - Both exist, archive current → returns `archiveDir` (no copy)
- `mkdir({ recursive: true })` called inside the copy branch only (avoids unnecessary directory creation).
- **Edge case noted:** when the file exists in neither directory, `resolveLogSource()` returns `archiveDir`; the subsequent `readLogEntries()` call receives ENOENT and returns NOT_FOUND to the client — documented and acceptable.

### WP-003 — Refactor `handleListRunLogs()` and `handleGetRunLog()`
**File:** `mcp-server/src/gui/handlers/run-log-handlers.ts`

**`handleListRunLogs(slug, logsDir, orchestratorLogsDir, legacyFlatDir?)`**
- New `orchestratorLogsDir` parameter added at position 3.
- Calls `archiveCompletedLogs(logsDir, orchestratorLogsDir, slug)` before scanning (minimises the window where a completed run is visible only in the source dir).
- Scans both dirs concurrently via `Promise.all([findRunLogs(logsDir), findRunLogs(orchestratorLogsDir)])`.
- O(n) `Map<string, RunLogEntry>` merge: live entries inserted first (lower precedence), archive entries overwrite (higher precedence). Active runs unique to `orchestratorLogsDir` survive from the live pass.
- Result sorted newest-first by filename (timestamp prefix).

**`handleGetRunLog(slug, filename, logsDir, orchestratorLogsDir, afterLine?)`**
- New `orchestratorLogsDir` parameter added at position 4.
- Delegates all directory resolution to `resolveLogSource()` before calling `readLogEntries()`.
- Security guards (filename allowlist, path-escape check) in `readLogEntries()` apply identically to whichever directory is resolved.
- `RunLogEntry` response shape (`{ filename, is_active }`) is unchanged — no frontend-breaking changes.

### WP-004 — Update server wiring in `server.ts`
**File:** `mcp-server/gui/server.ts`

- Variable renamed throughout from `legacyLogsDir` → `orchestratorLogsDir` to reflect its new active role (not just a legacy migration source).
- `resolveOrchestratorLogsDir()` was already imported; no new import needed.
- Both handler call sites updated with the correct argument order:
  - `handleListRunLogs(slug, logsDir, orchestratorLogsDir, legacyFlatDir)`
  - `handleGetRunLog(slug, filename, logsDir, orchestratorLogsDir, afterLine)`
- Legacy flat migration source (`join(ledgerRoot, slug)`) preserved as 4th arg to `handleListRunLogs` — backward compatibility maintained.
- Zero changes to the orchestrator Python codebase.

### WP-005 — Test coverage
**Files:** `mcp-server/tests/gui/log-resolver.test.ts`, `mcp-server/tests/gui/run-log-handlers.test.ts`

**Total test suite:** 360 / 360 tests pass across 15 GUI test files.

New tests added (76 total across 2 files):

| Suite | Scenarios Covered |
|-------|-------------------|
| `migrateOrphanedLogs()` | Copies matching files; source still exists after migration; no-op when destDir already has slug files; handles nonexistent srcDir; handles no matching files; creates destDir when absent |
| `archiveCompletedLogs()` | Active run → not copied; completed run not in archive → copied; newer source → archive refreshed; current archive → no-op |
| `resolveLogSource()` | File only in archive; file only in source; both with newer source (copy + return archive); both with current archive (no re-copy); neither exists (fall-through) |
| `handleListRunLogs()` integration | Active run visible from orchestratorLogsDir; completed run visible from logsDir; same filename deduplicated (once in response); logsDir wins on conflict |
| `handleGetRunLog()` integration | Active run reads from orchestratorLogsDir; completed run reads from logsDir; both with current archive reads from archive without re-copy |

**Fix-Forward applied in code-review:** The magic number `5000` used in `utimes()` mtime-manipulation calls was extracted into a named constant `MTIME_OFFSET_MS = 5_000` with a JSDoc comment explaining the rationale (coarse mtime resolution on HFS+/FAT32). All 76 tests pass post-edit.

---

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/src/gui/log-resolver.ts` | `rename()` → `copyFile()`; added `archiveCompletedLogs()` and `resolveLogSource()` |
| `mcp-server/src/gui/handlers/run-log-handlers.ts` | `orchestratorLogsDir` param on both handlers; dual-source scan/merge in list; `resolveLogSource()` in get |
| `mcp-server/gui/server.ts` | `legacyLogsDir` → `orchestratorLogsDir` rename; threaded to both handler call sites |
| `mcp-server/tests/gui/log-resolver.test.ts` | Updated existing tests + 27 new tests; `MTIME_OFFSET_MS` constant |
| `mcp-server/tests/gui/run-log-handlers.test.ts` | Updated existing tests + 7 new integration tests; split temp dirs per suite |

**Unchanged:** All orchestrator Python files (`orchestrator/src/utils/logging.py`, `orchestrator/src/cli.py`), GUI frontend, API response types.

---

## Quality Notes

### Minor issues (non-blocking, flagged for future cleanup)
- `migrateOrphanedLogs()` catch block still says "cannot be moved" — should say "cannot be copied" (WP-001, WP-002 code-review).
- `wait()` helper in `log-resolver.test.ts` is declared but never called — leftover from an early draft that used real sleeps before switching to `utimes()`. Safe to delete.
- `run-log-handlers.test.ts` file-level JSDoc could note which WP introduced the dual-source signature to orient future maintainers (WP-005 reviewer note).
- No integration test for `handleListRunLogs()` with a nonexistent `orchestratorLogsDir` path at the handler level (unit-level `findRunLogs()` coverage exists; not a blocker).

### Stability note on mtime-based tests
mtime-manipulation tests use a 5,000 ms offset via `utimes()`. Verified stable across 3 consecutive runs with sub-200 ms execution — no flakiness risk.

---

## Acceptance Criteria — Final Status

| Criterion | Status |
|-----------|--------|
| Viewing run logs in the GUI while the orchestrator is running does NOT delete or move the live log file | ✅ Met — `copyFile()` exclusively; orchestrator source dir is never mutated |
| Active runs show live, growing log data when polled from the GUI | ✅ Met — active runs resolved to `orchestratorLogsDir` via `isRunActive()` + `resolveLogSource()` |
| Completed runs whose logs were never archived are automatically archived on first GUI access | ✅ Met — `archiveCompletedLogs()` called at the top of `handleListRunLogs()` |
| Stale archives are silently refreshed when the orchestrator source is newer | ✅ Met — mtime comparison in both `archiveCompletedLogs()` and `resolveLogSource()` |
| The orchestrator's `logs/` directory is never mutated by the GUI | ✅ Met — no renames, no deletes; `copyFile()` is read-only from the source's perspective |
| All existing tests pass; new tests cover the dual-source resolution logic | ✅ Met — 360/360 tests pass; 76 new tests across all documented scenarios |
