# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.4.0 (2026-05-30, 2026-05-30, 2026-05-30)
- Architectural Reviews: 1 — Plan Architect Reviewer v1.5.0

## Summary

Add a "Resume Run" button to the MCP GUI's project detail view that allows resuming a previously interrupted or failed orchestrator run when no runs are currently active and the project is not completed. A new **run metadata file** (`{plan_dir}/.orchestrator-run.json`) is written by the Python orchestrator at start-up (right after acquiring the lock and generating the thread ID), providing all the information consumers need — including the GUI — without parsing JSONL log files. The GUI reads this file via a new API endpoint and uses it to spawn the orchestrator with `--resume <thread_id>`.

## Architectural Context

The MCP GUI is a vanilla JavaScript SPA served by a Node.js HTTP server (`mcp-server/gui/server.ts`). The frontend uses hash-based routing and DOM manipulation via `innerHTML`.

Key existing components:
- **`mcp-server/gui/orchestrator-manager.ts`** — Preflight checks, process spawning (`startOrchestrator()`), queue reading, kill logic.
- **`mcp-server/gui/public/views/project-detail.js`** — Project detail view with an "Orchestrator Runs" section that polls the queue and renders run entries with kill buttons for active runs.
- **`mcp-server/gui/public/views/orchestrator.js`** — Dedicated orchestrator launch view (plan path input + start button).
- **`mcp-server/gui/public/api-client.js`** — Fetch-based API client exposing `orchestratorStart()`, `orchestratorGetQueue()`, etc.
- **`mcp-server/gui/server.ts`** — HTTP routing layer, delegates to `handleOrchestratorStart()` in `api.ts`.
- **`mcp-server/gui/api.ts`** — `handleOrchestratorStart()` validates body params and calls `startOrchestrator()`.
- **`mcp-server/src/gui/log-resolver.ts`** — `findRunLogs()` returns `RunLogEntry[]` with `is_active` and `is_dry_run` flags.
- **`mcp-server/src/gui/handlers/run-log-handlers.ts`** — `handleGetRunLog()` reads JSONL entries from a log file.

Orchestrator resume mechanism:
- CLI: `orchestrate <plan-path> --resume <thread-id>`
- The `thread_id` is recorded in the `run_start` JSONL event of every run log file.
- A run is resumable when no `.terminal` marker exists in the checkpoint directory for that thread.
- The GUI cannot check the `.terminal` marker directly (it's in the Python orchestrator's checkpoint dir), but can infer resumability: if a run's last event is `run_end` with `result: "COMPLETE"` AND no `--interrupt-on` was used, the run is terminal. All other cases (error, interruption, crash) are presumed resumable.

Current gap: no standalone metadata file records the `thread_id` or run state in a consumer-friendly format. The JSONL log is the only persistent artefact containing it today.

## Approach / Architecture

**New artefact — run metadata file (Python orchestrator):**

The orchestrator writes `{plan_dir}/.orchestrator-run.json` immediately after acquiring the process lock and resolving the thread ID (between lock acquisition at line 571 and JSONL `run_start` at line 638 in `cli.py`). This file persists after the run ends and is overwritten on the next run of the same plan.

**Written at run start:**
```json
{
  "thread_id": "50b940be-dba4-4f15-aa26-ac44d39a82a9",
  "plan_path": "/abs/path/to/plan.md",
  "slug": "2026-05-30-feature-name",
  "started_at": "2026-05-30T15:35:45.606888+00:00",
  "is_resume": false,
  "dry_run": false,
  "log_filename": "20260530T153545-2026-05-30-feature-name.jsonl",
  "pid": 12345,
  "result": null,
  "error": null,
  "duration_s": null
}
```

**Updated at run end (same file, atomic rewrite):**
```json
{
  "thread_id": "50b940be-dba4-4f15-aa26-ac44d39a82a9",
  "plan_path": "/abs/path/to/plan.md",
  "slug": "2026-05-30-feature-name",
  "started_at": "2026-05-30T15:35:45.606888+00:00",
  "is_resume": false,
  "dry_run": false,
  "log_filename": "20260530T153545-2026-05-30-feature-name.jsonl",
  "pid": 12345,
  "result": "SUCCESS",
  "error": null,
  "duration_s": 1986.1
}
```

`result` may be `"SUCCESS"`, `"ERROR"`, or `"INTERRUPTED"`. When `interrupt_before` was set and no errors occurred, the value is `"INTERRUPTED"` — the button condition `result !== "SUCCESS"` already handles this correctly without special-casing.

This file:
- Is written atomically (write to temp + `os.replace()`) to prevent partial reads.
- Is overwritten on every run of the same plan — always reflects the most recent attempt.
- Is never deleted by the orchestrator — it persists after exit for consumers to read.
- Is located next to the plan (same directory as `.orchestrator.lock`), discoverable by any consumer that knows the plan path.
- Carries the same run-end data (`result`, `error`, `duration_s`) as the existing hash-based tombstone (`{hash}-run-status.json`). Tombstone deprecation is deferred to a follow-up plan; both files are written during this plan's scope.

**Consumers that benefit from this file (scope of this plan):**

| Consumer | Current approach | New approach |
|----------|-----------------|--------------|
| GUI resume button | N/A (new feature) | Read `thread_id` from metadata file |
| `resolveProgress()` | `readdir` + sort + filter to find newest JSONL filename | Read `log_filename` from metadata file directly (deferred to follow-up) |
| `kill-orchestrator.js` lock cleanup | Parse up to 20 JSONL files for `run_start` → `entry.plan` | Read `.orchestrator-run.json` → `plan_path` from each plan dir (deferred to follow-up) |
| Run-status tombstone polling (GUI) | Hash-based `{hash}-run-status.json` in shared logs dir | Deferred to follow-up — tombstone deprecation is out of scope for this plan |
| `getRunStatus()` + `runStatusFilename()` | SHA-1 hash of plan path → tombstone filename | Deferred to follow-up — tombstone deprecation is out of scope for this plan |

**Backend changes (MCP GUI server):**

1. **New API endpoint** `GET /api/projects/:slug/run-metadata` — Resolves the plan path from the project's ledger metadata using slug lookup, reads `{plan_dir}/.orchestrator-run.json`, and returns its contents (or 404 if it doesn't exist).

2. **Extend `startOrchestrator()` signature** to accept an optional `resumeThreadId` parameter. When provided, pass `['--resume', resumeThreadId, resolvedPlan]` to the spawned process instead of `[resolvedPlan]`.

3. **Extend `handleOrchestratorStart()`** to accept an optional `resumeThreadId` field from the request body. When present, validate it matches UUID v4 format and reject with a 400 error if it does not; pass the validated value to `startOrchestrator()`.

4. **Simplify `resolveProgress()`** — when the slug's project has a `meta.plan_path`, pass the metadata file's `log_filename` to skip directory scanning. Fall back to the current directory-scan approach when the metadata file is unavailable. *(Deferred to follow-up.)*

5. **Tombstone deprecation and `kill-orchestrator.js` simplification** — deferred to a follow-up plan. The tombstone (`{hash}-run-status.json`) continues to be written alongside the new metadata file. `orchestrator.js` retains its existing tombstone poll. `getRunStatus()` / `runStatusFilename()` / `handleGetRunStatus()` remain unchanged.

**Frontend changes:**

6. **Extend the API client** with `getRunMetadata(slug)` and a `resumeThreadId` parameter on `orchestratorStart()`.

7. **Add resume button to project-detail.js** — rendered in the "Orchestrator Runs" section when:
   - The project status is NOT `COMPLETE` and NOT `ARCHIVED`
   - No run is currently active (`!activeItem`)
   - Run metadata exists with a valid `thread_id`
   - The metadata does not indicate a dry run
   - `result` is not `"SUCCESS"` (i.e. the last run did not complete successfully)
   - The project has a valid `meta.plan_path`

8. **Tombstone polling in `orchestrator.js`** — unchanged. `orchestrator.js` retains its existing tombstone poll; the tombstone migration is deferred to a follow-up plan.

## Rationale

- **Proper metadata over log-file parsing:** A dedicated JSON metadata file is the right abstraction for run identity. Parsing JSONL logs for structural metadata conflates logging with state — the metadata file serves multiple consumers cleanly.
- **Timing guarantees:** Written after lock acquisition and thread_id resolution but before graph execution. If the orchestrator doesn't get this far, there's nothing to resume anyway. Updated at run end with final status.
- **Persistence:** Unlike the run queue (deleted on exit) or the lock file (released on exit), the metadata file persists indefinitely — exactly what the resume use case and post-run status queries need.
- **Foundation for tombstone deprecation (deferred):** The metadata file carries a strict superset of the tombstone's data (thread_id, full timing, dry_run flag, discoverable location). Tombstone removal is deferred to a follow-up plan after this plan ships and is verified.
- **Simplifies directory scanning:** `resolveProgress()` and `kill-orchestrator.js` currently scan directories and parse JSONL to discover metadata that the metadata file provides directly. This removes O(N) file reads in favour of O(1) JSON reads.
- **Safety:** The orchestrator itself validates whether a thread is truly resumable (checks terminal marker, checkpoint existence). The GUI button is a convenience; the orchestrator is the authority.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How to store thread_id for consumers | Dedicated `.orchestrator-run.json` metadata file in plan dir | Extract from JSONL log first line; extend run-status tombstone; add to run queue | Metadata file is purpose-built, persists across all exit paths, doesn't conflate logging with state, and serves multiple consumers (GUI, CLI, scripts). JSONL parsing is fragile; tombstone only exists on clean exit; queue entry is deleted on exit. |
| Tombstone deprecation | Subsume tombstone into metadata file (same data, richer schema, better location) | Keep both files side-by-side; only add metadata file for new use cases | Keeping both creates redundancy and dual-source confusion. The metadata file carries a strict superset of tombstone data. Deprecating the tombstone simplifies the codebase. |
| Where to place the resume button | Project detail view (Orchestrator Runs section) | Dedicated orchestrator view, separate "Resume" route | Project detail is where users see run history and status — it's the natural context for resume. The orchestrator view is for starting fresh runs with a plan path input. |
| How to pass --resume to spawn | Extend existing `startOrchestrator()` with optional param | New `resumeOrchestrator()` function | Single function with an optional param avoids code duplication while keeping the interface simple. |
| How to determine resumability | Metadata file exists + `result !== "SUCCESS"` + project not COMPLETE + no active run | Parse JSONL for run_end result; check terminal marker via new endpoint | The orchestrator validates terminal state at launch time — the GUI only needs basic heuristics. False positives are handled gracefully by the orchestrator's error message. |

## Pattern Alignment

- **Follows:** Orchestrator file-writing pattern in `orchestrator/src/cli.py` — writes structured files alongside the plan (`.orchestrator.lock`, run-status tombstone). The new `.orchestrator-run.json` is a natural sibling.
- **Follows:** `startOrchestrator()` pattern in `mcp-server/gui/orchestrator-manager.ts` — extends existing function signature rather than creating a parallel one.
- **Follows:** Request body extension pattern used by `handleOrchestratorStart()` in `mcp-server/gui/api.ts` — optional fields on the body object.
- **Follows:** Button rendering pattern in project-detail.js — conditional DOM insertion based on state (cf. Kill button, Unarchive button, Reset button).
- **Follows:** API client extension pattern in `api-client.js` — adding optional params to existing methods and new endpoint methods.
- **Follows:** Ledger metadata resolution pattern — the GUI resolves `meta.plan_path` to locate artefacts on disk (same as plan document serving).

## Detailed Steps

### Phase 1: Orchestrator metadata file (Python)

1. **Write `.orchestrator-run.json` at run start** (`orchestrator/src/cli.py`):
   - After thread_id is resolved (~line 633) and `run_start_ts` is captured (~line 635), write `{plan_dir}/.orchestrator-run.json` atomically (write to `{plan_dir}/.orchestrator-run.json.tmp` then `os.replace()`).
   - Contents: `thread_id`, `plan_path` (str), `slug`, `started_at`, `is_resume` (bool), `dry_run` (bool), `log_filename` (from `str(run_logger._path.name)`, consistent with the existing tombstone write at `cli.py` line 882), `pid` (os.getpid()), `result` (null), `error` (null), `duration_s` (null).
   - Extract the atomic-write helper into a small utility function (`_write_run_metadata()`) since it's called twice (start + end).

2. **Update `.orchestrator-run.json` at run end** (`orchestrator/src/cli.py`, ~line 878):
   - After computing the final status payload (currently written to the tombstone), call `_write_run_metadata()` again with the same dict but `result`, `error`, and `duration_s` populated.
   - When `interrupt_before` was active and `not outside_errors`, write `result = "INTERRUPTED"` instead of `"SUCCESS"`.
   - The existing tombstone write at line 885 (`_run_status_path.write_text(...)`) is retained unchanged; tombstone deprecation is deferred to a follow-up plan.

3. **Update `_write_error_status()` for the `_is_run_terminal` early exit only** (`orchestrator/src/cli.py`):
   - The `_write_error_status()` call sites for **plan-not-found** and **lock-contention** must NOT write to `.orchestrator-run.json`: at plan-not-found, `plan_dir` is unknown; at lock-contention, `thread_id` is not yet resolved (it is generated inside the `try:` block after lock acquisition), and writing here would overwrite the running process's valid metadata file with an incomplete record.
   - Only the `_is_run_terminal` guard inside the `if args.resume:` block is safe to update: at that call site, `plan_dir` is known and `thread_id = args.resume` is available. Write the metadata file with `result = "ERROR"` and `error = "Thread {thread_id} is a completed run"` in addition to the tombstone (tombstone removal is deferred).

4. **Add `.orchestrator-run.json` to `.gitignore`** patterns (if not already covered by existing patterns for the plan directories).

### Phase 2: GUI server — new metadata endpoint

5. **Add `handleGetRunMetadata()` handler** in `mcp-server/gui/api.ts`:
   - Call `assertSafeSlug(slug)` as the first line of the handler (path-traversal guard, consistent with all other slug-based handlers; `resolveProjectStore` validates `repoName` internally but not `slug`).
   - Accept `slug` parameter only (no `repoName`).
   - Resolve the project's `meta.plan_path` from the ledger store.
   - Construct the metadata file path: `path.join(planPath, '.orchestrator-run.json')` — `store.planPath` IS the plan directory (the slug folder), so no `dirname` is needed. This is consistent with how the Python orchestrator writes the file (`plan_dir / ".orchestrator-run.json"`).
   - Read and parse the file; return contents as JSON or throw `ApiError NOT_FOUND`.

6. **Add route** `GET /api/projects/:slug/run-metadata` in `mcp-server/gui/server.ts` dispatching to the new handler.

### Phase 3: GUI server — resume support

7. **Extend `startOrchestrator()` signature** in `mcp-server/gui/orchestrator-manager.ts` to accept an optional `resumeThreadId?: string` parameter. When provided, set spawn args to `['--resume', resumeThreadId, resolvedPlan]` instead of `[resolvedPlan]`.

8. **Extend `handleOrchestratorStart()`** in `mcp-server/gui/api.ts` to extract optional `resumeThreadId` from the request body. When present, validate it matches UUID v4 format (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`) and reject with a 400 error if it does not. Pass the validated value to `startOrchestrator()`.

### Phase 4: Tombstone deprecation (deferred — see Out of Scope)

Tombstone deprecation is out of scope for this plan. The orchestrator continues to write the hash-based `{hash}-run-status.json` alongside the new `.orchestrator-run.json`. `orchestrator.js` retains its existing tombstone poll. `getRunStatus()`, `runStatusFilename()`, `handleGetRunStatus()`, `orchestratorGetRunStatus()`, and `StartResult.runStatusFilename` remain unchanged. Tombstone removal and the `orchestrator.js` polling migration are deferred to a dedicated follow-up plan.

### Phase 5: Frontend — resume button

*(Phase 4 deferred — no implementation steps; numbering continues at 10.)*

10. **Extend API client** in `mcp-server/gui/public/api-client.js`:
    - Add `getRunMetadata(slug)` method.
    - Add optional `resumeThreadId` parameter to `orchestratorStart()`.

11. **Add resume button rendering** to `mcp-server/gui/public/views/project-detail.js`:
    - After the runs list is rendered and no active run is detected, fetch run metadata via `API.getRunMetadata(slug)`.
    - If metadata exists with a valid `thread_id`, `dry_run === false`, `result !== "SUCCESS"`, and project status is not COMPLETE/ARCHIVED: render a "Resume Run" button.
    - On click: call `API.orchestratorStart(planPath, false, threadId)`, show preflight/status feedback, then trigger queue polling.
    - Button disappears once a new run appears in the queue.

12. **Add CSS styles** for the resume button in `mcp-server/gui/public/styles.css`.

## Dependencies

- `orchestrator/src/cli.py` — Metadata file write at start + update at end
- `mcp-server/gui/orchestrator-manager.ts` — `startOrchestrator()` signature change
- `mcp-server/gui/api.ts` — New `handleGetRunMetadata()` handler; extend `handleOrchestratorStart()` (UUID validation)
- `mcp-server/gui/server.ts` — New route for run-metadata endpoint
- `mcp-server/gui/public/api-client.js` — Add `getRunMetadata()` method; extend `orchestratorStart()`
- `mcp-server/gui/public/views/project-detail.js` — Resume button UI
- `mcp-server/gui/public/styles.css` — Resume button styling

## Required Components

- `orchestrator/src/cli.py` — Write + update `.orchestrator-run.json` (tombstone writes unchanged)
- `mcp-server/gui/api.ts` — New `handleGetRunMetadata()` + extend `handleOrchestratorStart()` (UUID validation for `resumeThreadId`)
- `mcp-server/gui/server.ts` — Route `GET /api/projects/:slug/run-metadata`
- `mcp-server/gui/orchestrator-manager.ts` — Extend `startOrchestrator()` optional `resumeThreadId` param
- `mcp-server/gui/public/api-client.js` — Add `getRunMetadata()`; extend `orchestratorStart()`
- `mcp-server/gui/public/views/project-detail.js` — Resume button UI
- `mcp-server/gui/public/styles.css` — Resume button styling

## Assumptions

- The `.orchestrator-run.json` file is written after thread_id resolution and before graph execution. If the orchestrator fails before this point (plan not found, lock contention), there is nothing to resume and no metadata file is written.
- The orchestrator binary path resolution (`resolveOrchestrateBin`) is already correct and cross-platform.
- The orchestrator itself will reject the resume (with a clear error) if the thread is actually terminal, which is an acceptable UX for edge cases.
- The `meta.plan_path` stored in the project ledger is an absolute path that remains valid for resume.
- Runs that hit the `EXIT_SAFETY_LIMIT` circuit breaker complete all stages and write `result = "SUCCESS"` in the metadata file. The resume button will not appear for these runs, which is correct (safety-limit runs are terminal).
- The JSONL `run_end` event uses `result: "COMPLETE"` while the metadata file uses `result: "INTERRUPTED"` for the same `--interrupt-on` run. These values are intentionally different: `"COMPLETE"` in JSONL means all requested stages ran; `"INTERRUPTED"` in the metadata file signals the GUI that the run did not reach full SUCCESS and is resumable.

## Constraints

- Must not break existing start-run flow (the `resumeThreadId` parameter is optional).
- Must respect the cross-platform policy (no Unix-specific path handling).
- The resume button must not appear when a run is already active (the queue shows it as `pending` or `started`).
- The resume button must not appear when the last run succeeded (`result === "SUCCESS"`).
- Dry-run logs are not resumable (no meaningful checkpoint is written).
- The orchestrator is the authority on resumability — the GUI shows the button as a convenience; the orchestrator validates the thread state at launch time.
- `resumeThreadId` must match UUID v4 format before being passed to spawn. `handleOrchestratorStart()` must reject with 400 if it does not.
- The resume button may briefly appear right after a fresh run starts when `result === null` and the queue poll has not yet propagated to `!activeItem`. This is a benign visual artifact; the next poll cycle will hide the button. Explicitly accepted as a known edge case.
- The tombstone (`{hash}-run-status.json`) continues to be written alongside the metadata file in this plan's scope. Tombstone removal is deferred.
- `kill-orchestrator.js` must fall back to JSONL scanning when metadata files are absent (runs from before this change).

## Out of Scope

- Showing which specific checkpoint the run will resume from (would require reading the SQLite checkpoint DB).
- Allowing users to pick which historical run to resume (always resumes the most recent via metadata file).
- Adding resume functionality to the dedicated orchestrator view (can be done later).
- Modifying the Python orchestrator's resume/checkpoint logic itself.
- Adding a terminal-marker check API endpoint (the orchestrator's own validation is sufficient).
- Cleaning up / rotating old `.orchestrator-run.json` files (overwritten naturally on next run).
- Completely removing the `_write_error_status()` fallback for the plan-not-found early exit path (where `plan_dir` is unknown).
- Consumer simplifications (`resolveProgress()` shortcut, `kill-orchestrator.js` metadata reads) — deferred to a follow-up plan.
- **Tombstone deprecation** — removal of `{hash}-run-status.json`, `getRunStatus()`, `runStatusFilename()`, `handleGetRunStatus()`, `orchestratorGetRunStatus()`, and `StartResult.runStatusFilename`; migration of `orchestrator.js` polling to the metadata endpoint. All deferred to a dedicated follow-up plan.
- **"Resumable" badge** in `buildRunBadges()` — the resume button is the actionable signal; the badge is decorative. Deferred.

## Acceptance Criteria

1. The orchestrator writes `{plan_dir}/.orchestrator-run.json` atomically at startup, containing `thread_id`, `plan_path`, `slug`, `started_at`, `is_resume`, `dry_run`, `log_filename`, `pid`, `result` (`null` at start), `error` (null), `duration_s` (null). `result` may be `null` (run in progress), `"SUCCESS"`, `"INTERRUPTED"`, or `"ERROR"` at run end.
2. The orchestrator updates the same file at run end with `result` (`"SUCCESS"`, `"INTERRUPTED"`, or `"ERROR"`), `error` (message or null), and `duration_s`. The existing tombstone (`{hash}-run-status.json`) continues to be written unchanged.
3. A "Resume Run" button appears in the project detail view's Orchestrator Runs section when: (a) no run is active, (b) the project status is not COMPLETE or ARCHIVED, (c) run metadata exists with a valid `thread_id`, `dry_run === false`, and `result !== "SUCCESS"` (this condition covers `"INTERRUPTED"` and `"ERROR"` as well as crashed runs where `result` is still `null`).
4. Clicking the button triggers the orchestrator with `--resume <thread_id>` using the metadata file's thread ID.
5. All existing preflight checks run before the resume spawn (same as a fresh start).
6. The button disappears once a new run appears in the queue (polling picks it up).
7. If the orchestrator rejects the resume (terminal thread), it exits with `result = "ERROR"` and writes the updated metadata file before exiting. Because the resume command exits before registering a queue entry, no queue update occurs. The error becomes visible after the next metadata poll cycle or a manual page refresh re-fetches the updated metadata file.
8. `GET /api/projects/:slug/run-metadata` returns the metadata file contents or 404.
9. A `resumeThreadId` that does not match UUID v4 format is rejected by `handleOrchestratorStart()` with a 400 error.
10. The existing start-run flow is unaffected (no regression in fresh-start behaviour).

## Testing Strategy

Python changes tested via pytest. Backend TypeScript changes tested via Vitest unit tests. Frontend changes tested manually (the GUI is a vanilla JS SPA without a test harness). Integration tested by starting and interrupting a run, then verifying the resume button appears and works.

## Test Plan

### Phase 1 — Orchestrator metadata file
- `orchestrator/tests/test_run_metadata.py` (new) — Test: metadata file is written with correct schema at start (all run-end fields null) — Covers AC 1
- `orchestrator/tests/test_run_metadata.py` — Test: metadata file is written atomically (temp + os.replace) — Covers AC 1
- `orchestrator/tests/test_run_metadata.py` — Test: `is_resume` is `true` when `--resume` is used — Covers AC 1
- `orchestrator/tests/test_run_metadata.py` — Test: metadata file is updated at run end with `result`, `error`, `duration_s` — Covers AC 2
- `orchestrator/tests/test_run_metadata.py` — Test: tombstone file is STILL written at run end (both artefacts coexist) — Covers AC 2
- `orchestrator/tests/test_run_metadata.py` — Test: when `--resume` is called with a terminal thread_id, the `_is_run_terminal` path writes metadata file with `result = "ERROR"` before returning EXIT_ERROR — Covers AC 7

### Phase 2 — GUI server metadata endpoint
- `mcp-server/tests/gui/api-run-metadata.test.ts` (new) — Test: `handleGetRunMetadata()` returns metadata when file exists — Covers AC 8
- `mcp-server/tests/gui/api-run-metadata.test.ts` (new) — Test: `handleGetRunMetadata()` returns 404 when file doesn't exist — Covers AC 8
- `mcp-server/tests/gui/api-run-metadata.test.ts` (new) — Test: `handleGetRunMetadata()` returns 404 when project has no plan_path — Covers AC 8
- `mcp-server/tests/gui/api-run-metadata.test.ts` (new) — Test: `handleGetRunMetadata()` rejects an unsafe slug with 400 — Covers AC 8 (guard)

### Phase 3 — Resume support
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — Test: `startOrchestrator()` with `resumeThreadId` passes `--resume` flag to spawn args — Covers AC 4, 5
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — Test: `startOrchestrator()` without `resumeThreadId` spawns without `--resume` flag — Covers AC 10
- `mcp-server/tests/gui/api-orchestrator.test.ts` — Test: `handleOrchestratorStart()` passes valid `resumeThreadId` through — Covers AC 4
- `mcp-server/tests/gui/api-orchestrator.test.ts` — Test: `handleOrchestratorStart()` rejects malformed `resumeThreadId` with 400 — Covers AC 9
- `mcp-server/tests/gui/api-orchestrator.test.ts` — Test: `handleOrchestratorStart()` without `resumeThreadId` works as before — Covers AC 10

### Phase 4 — Frontend (manual)
- Manual test: interrupt a run (Ctrl+C or kill), verify "Resume Run" button appears on project detail — Covers AC 3, 6
- Manual test: run with `--interrupt-on` to get `result = "INTERRUPTED"`, verify "Resume Run" button appears — Covers AC 3
- Manual test: click "Resume Run", verify orchestrator starts with `--resume`, verify button disappears once queue shows new entry — Covers AC 4, 6
- Manual test: verify button does NOT appear when project is COMPLETE — Covers AC 3
- Manual test: verify button does NOT appear when a run is currently active — Covers AC 3
- Manual test: verify button does NOT appear when last run was SUCCESS — Covers AC 3
- Manual test: verify button does NOT appear for a dry run (`dry_run === true` in metadata) — Covers AC 3

## Documentation Updates

- `orchestrator/docs/agents/project-manifest/data-flows.md` — Add `.orchestrator-run.json` write/update lifecycle (written at run start, updated at run end)
- `orchestrator/docs/agents/project-manifest/constraints.md` — Document the atomic-write protocol (`write to .tmp + os.replace()`) and persistence contract (never deleted, overwritten on next run) for the metadata file
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add `.orchestrator-run.json` as a new plan-directory artefact
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document new `GET /api/projects/:slug/run-metadata` endpoint; updated `startOrchestrator()` signature (optional `resumeThreadId`); updated `handleOrchestratorStart()` body schema (optional `resumeThreadId` with UUID validation)
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add resume flow: project-detail button → run-metadata API → orchestrator-manager → spawn with --resume
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `handleGetRunMetadata()` to `gui/api.ts` annotations and new route to `gui/server.ts` annotations; add new test file `tests/gui/api-run-metadata.test.ts`
- `mcp-server/changelog.md` — Add entry for: resume button, metadata endpoint
- `orchestrator/changelog.md` — Add entry for: `.orchestrator-run.json` metadata file
- Root `AGENTS.md` → Cross-System Dependencies table — Add `.orchestrator-run.json` as a new cross-system dependency (orchestrator writes, GUI reads)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Stale plan_path in meta** — The plan file may have been moved/deleted since the original run. | Preflight check `checkPlanFile()` already validates the plan path exists before spawning. The button uses `meta.plan_path` which is the recorded path; if invalid, preflight fails with a clear error. |
| **Thread already terminal** — User clicks resume on a run that completed successfully. | The orchestrator itself checks the terminal marker and exits with a clear error. The GUI surfaces this via the metadata file's error update. |
| **Metadata file from a different plan version** — User edits the plan between runs. | The orchestrator resumes from the checkpoint state, which includes the original plan content. This is inherent to checkpoint-based resume and not a new risk. |
| **Race condition** — User clicks resume while another run is starting from another source. | The orchestrator uses a process lock file (file locking). If a run is already in progress, the new process exits with a lock-contention error. The existing preflight `checkNoConflict()` also guards against this. |
| **Metadata file read failure** — File permission error or corruption. | The GUI endpoint returns 404 on any read error; the button simply won't appear. Graceful degradation. |
| **Backward compatibility** — Runs started before this change have no metadata file. | `kill-orchestrator.js` falls back to JSONL scanning. The resume button simply won't appear (metadata file missing = 404). |
