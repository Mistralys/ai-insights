# Plan: GUI Orchestrator Integration

## Summary

Add first-class orchestrator process management to the MCP Server Dashboard GUI, built around a **unified run queue** with a **CLI-first, self-registration** design. Every orchestrator run — whether started from the GUI, the CLI, or any other method — registers itself in the shared queue file on startup. This introduces: (1) a new Python module (`orchestrator/src/utils/run_queue.py`) that the orchestrator calls on startup to self-register and on clean exit to self-unregister, (2) a top-level **"Orchestrator"** view in the GUI with a plan path input to launch runs and a queue table showing all tracked runs, (3) a **queue lifecycle** where runs transition from "Pending" (process running, project not yet initialized in ledger) → "Started" (project detected in ledger) → auto-removed on project completion (synthesis generated), (4) an **orchestrator section** in the project detail view for started projects showing live run status and kill controls, and (5) a **CLI commands reference card** for manual terminal management. Multiple runs for different plans can be active simultaneously. GUI-spawned processes run detached (survive GUI server restarts). The queue file (`orchestrator/logs/.run-queue.json`) is written by the orchestrator (Python) and read by the GUI server (TypeScript) — the GUI never writes queue entries and computes lifecycle states in-memory on every poll (no write-back). Only explicit user actions (kill, dismiss) mutate the queue file.

## Architectural Context

### GUI server (`gui/server.ts`)

A standalone Node.js HTTP server (separate process from the MCP server). Routes `/api/*` requests to handler functions in `gui/api.ts` and serves static SPA files from `gui/public/`. The server process receives `ledgerRoot` and `orchestratorLogsDir` at startup. Request handling is split between a `matchRoute()` dispatcher (for GET/DELETE/POST without bodies) and special-case blocks in `handleRequest()` (for PUT/PATCH/POST with body parsing).

### GUI frontend (`gui/public/`)

A vanilla JavaScript SPA using hash-based routing (`router.js`). Views are organized as IIFE modules in `gui/public/views/`. The API client is a single IIFE (`api-client.js`) exposing methods on a global `API` object. No build step — raw ES5-compatible JS files loaded via `<script>` tags in `index.html`.

### Orchestrator launch chain

The recommended launch path is `node scripts/run-orchestrator.js <plan-path> [flags]`, which:
1. Checks mcp-server dist freshness and rebuilds if stale.
2. Resolves the `orchestrate` binary from `orchestrator/.venv/bin/orchestrate`.
3. Spawns the binary with forwarded arguments via `spawnSync`.

The orchestrator creates a `.orchestrator.lock` file in the plan's parent directory. There is no PID file — external detection currently relies on `pgrep -fl orchestrate`.

### Existing run log infrastructure

- **Backend**: `src/gui/log-resolver.ts` provides `findRunLogs(logsDir, slug)` and `readLogEntries(logsDir, filename, afterLine)`. Logs are JSONL files at `orchestrator/logs/{timestamp}-{slug}.jsonl`, archived into `{ledgerRoot}/{slug}/orchestrator/logs/` after completion.
- **Frontend**: `views/run-log.js` renders run log entries as event cards. The project detail view (`views/project-detail.js`) already has an "Orchestrator Runs" section that appears when logs exist.
- **API**: `GET /api/projects/:slug/runs` lists run logs; `GET /api/projects/:slug/runs/:filename` returns JSONL entries with `?after=N` pagination.

### Preflight checks (`scripts/preflight-orchestrator.js`)

Validates: venv existence, `.env` API keys, mcp-server dist freshness, no conflicting process. Returns structured check results. Supports `--json` output.

### Process kill logic (`scripts/kill-orchestrator.js`)

Uses `pgrep -fl orchestrate` to find processes, sends SIGTERM then SIGKILL after 3s grace, cleans up `.orchestrator.lock` files from plan directories found in recent JSONL logs.

## Approach / Architecture

### Three-layer addition

```
┌──────────────────────────────────────────────────────┐
│  Frontend (gui/public/)                              │
│  ┌─────────────────┐  ┌───────────────────────────┐  │
│  │ views/           │  │ views/project-detail.js   │  │
│  │  orchestrator.js │  │  (enhanced)               │  │
│  │  (new view)      │  │                           │  │
│  └────────┬─────────┘  └────────┬──────────────────┘  │
│           │                     │                     │
│  ┌────────▼─────────────────────▼──────────────────┐  │
│  │ api-client.js (new methods)                     │  │
│  └────────┬────────────────────────────────────────┘  │
└───────────┼───────────────────────────────────────────┘
            │ HTTP
┌───────────▼───────────────────────────────────────────┐
│  Backend (gui/server.ts + gui/api.ts)                 │
│  ┌────────────────────────────────────────────────┐   │
│  │ New routes:                                    │   │
│  │  POST /api/orchestrator/start                  │   │
│  │  GET  /api/orchestrator/queue                  │   │
│  │  POST /api/orchestrator/kill/:id               │   │
│  └────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────┐   │
│  │ src/gui/orchestrator-manager.ts (new module)   │   │
│  │  - start(), getQueue(), kill(id)               │   │
│  │  - Queue file read + lifecycle transitions     │   │
│  │  - Detached process spawning (GUI start only)  │   │
│  └────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
            ▲
            │ reads
┌───────────┴───────────────────────────────────────────┐
│  Shared run queue file                                │
│  orchestrator/logs/.run-queue.json                    │
│  (written by orchestrator Python process on startup,  │
│   read by GUI server for lifecycle transitions)       │
└───────────────────────────────────────────────────────┘
            ▲
            │ writes
┌───────────┴───────────────────────────────────────────┐
│  Orchestrator (Python)                                │
│  ┌────────────────────────────────────────────────┐   │
│  │ src/utils/run_queue.py (new module)            │   │
│  │  - register(): write entry on startup          │   │
│  │  - unregister(): remove entry on clean exit    │   │
│  └────────────────────────────────────────────────┘   │
│  Called from cli.py immediately after run_start log   │
└───────────────────────────────────────────────────────┘
```

### Run queue with self-registration (CLI-first design)

The run queue is a **shared contract** between the orchestrator (Python, writes) and the GUI server (TypeScript, reads). Every orchestrator run — whether started from the GUI, the CLI, or any other method — self-registers in the queue on startup.

**Queue file**: `orchestrator/logs/.run-queue.json` (no longer GUI-specific).

**Writer**: The orchestrator's `cli.py` calls a new `run_queue.register()` function immediately after logging `run_start`. This writes a queue entry with the PID, plan path, slug, and timestamp. On clean exit (after `run_end` is logged), `run_queue.unregister()` removes the entry.

**Reader**: The GUI server's `orchestrator-manager.ts` reads the queue file and computes lifecycle transitions **in-memory** (pending→started, pending→dead, started→removed), enriching entries with JSONL progress data. The GUI server **never writes lifecycle state changes** back to the queue file — it returns the computed effective status to the frontend on every poll. Only explicit user actions (`killQueueEntry`, `dismissQueueEntry`) mutate the queue file. This read-only design eliminates a cross-language race condition: since the Python orchestrator acquires `filelock.py` locks for its writes, a TypeScript read-modify-write cycle (without the same lock) could silently drop a concurrent Python `register()` call.

Each entry tracks a single process through its lifecycle:

```
PENDING ──→ STARTED ──→ (auto-removed)
   │                         ▲
   │                         │
   └──→ DEAD            synthesis_generated === true
```

| State | Meaning | Controls |
|-------|---------|----------|
| `pending` | Process running; project not yet initialized in ledger | Kill button, progress summary, status info |
| `started` | Project detected in ledger (slug exists, `rootIndexExists()`) | Kill disabled, link to project detail |
| `dead` | Process died before project was initialized | Dismiss button |

**Automatic transitions** (evaluated on every `GET /api/orchestrator/queue` call by the GUI server):
- `pending` → `started`: when `LedgerStore(expectedSlug, ledgerRoot).rootIndexExists()` returns `true`.
- `pending` → `dead`: when process is no longer alive (`process.kill(pid, 0)` fails) and project was never initialized.
- `started` → **removed from queue**: when `rootIndex.synthesis_generated === true` (project completed).
- `started` + process dead: stays `started` (the project exists in the ledger — the user manages it via project detail).

**Slug derivation**: Both the orchestrator and the GUI derive the slug from the plan directory name. The orchestrator uses `plan_dir.name` (Python `pathlib`); the GUI uses `planFolderBasename()` from `src/utils/path-validator.ts`. These produce identical results for standard plan paths.

### JSONL progress for pending runs

The orchestrator writes a JSONL log file to `orchestrator/logs/{timestamp}-{slug}.jsonl` from the moment it starts — well before the project is initialized in the ledger. The existing `findRunLogs(logsDir, slug)` and `readLogEntries(logsDir, filename, afterLine)` functions from `src/gui/log-resolver.ts` can locate and read these files using the queue entry's `expectedSlug`.

For pending queue entries, `getQueue()` reads the latest JSONL events to produce a **progress summary** — a compact status line (e.g. "PM stage running — 3 tool calls", "Waiting for stage_start") derived from the most recent meaningful event. This gives the user visibility into what the orchestrator is doing during the gap before the project appears in the ledger.

The full run log viewer (already implemented) remains accessible via a link from each queue entry — the slug and log filename are known, so `#/projects/{slug}/runs/{filename}` works even before the project exists in the ledger (the run-log view reads from `orchestrator/logs/` as a fallback). For this to work, `handleGetRunLog` must also accept reading from the live `orchestratorLogsDir` when the project doesn't exist in the ledger yet — this is already the case in the current dual-scan merge logic.

### Detached processes (GUI-spawned)

When starting a run from the GUI, the backend spawns the orchestrator via `child_process.spawn()` with `detached: true` and `unref()`, so it survives GUI server restarts. The spawned orchestrator self-registers in the queue like any CLI-started run — the GUI does not write the queue entry.

Each plan can only appear once in the queue (enforced by both the orchestrator's `run_queue.register()` and the `.orchestrator.lock` mechanism). Different plans run concurrently.

### Consolidated preflight + start

The backend exposes a single `POST /api/orchestrator/start` endpoint that handles both preflight checks and process spawning. When called with `dryRun: true`, it runs all preflight checks (same checks as `preflight-orchestrator.js`, ported as in-process TypeScript functions) and returns structured results without spawning. When called with `dryRun: false` (or omitted), it runs the same preflight checks first — if any fail, it returns the preflight results with a `started: false` flag and no process is spawned; if all pass, it spawns the orchestrator and returns `started: true` with the PID.

This consolidation eliminates the stale-preflight race (where checks pass but conditions change before the user clicks "Start") and removes redundant validation code from the spawn path. The "no-conflict" check is plan-scoped: it reads the queue file to check whether the given plan is already registered (not whether any orchestrator is running). The frontend displays each check as a pass/fail row with fix suggestions.

## Rationale

- **CLI-first, orchestrator self-registration**: The orchestrator writes its own queue entry on startup (`run_queue.register()`), and removes it on clean exit (`run_queue.unregister()`). This means CLI-started runs, GUI-started runs, and any future launch method all appear in the same queue with identical data. The GUI server only reads the queue and manages lifecycle transitions — it never writes entries.
- **Run queue for multi-run tracking**: The user may start multiple orchestrator runs for different plans. Each plan gets its own `.orchestrator.lock` (per-plan-directory), so concurrent runs are natively supported.
- **Pending → Started lifecycle**: There is a gap between spawning the orchestrator and the project appearing in the ledger (the PM agent must first initialize it). During this window, the queue gives the user visibility and kill control. Once the project exists, management shifts to the project detail view.
- **Auto-removal on completion**: Completed projects (synthesis generated) are automatically pruned from the queue. This keeps the queue focused on active/pending work. Clean exits also self-unregister.
- **Detached process (GUI)**: GUI-spawned orchestrators run detached so they survive GUI server restarts. The queue file persists on disk.
- **Top-level nav item**: The orchestrator view is independent of existing projects — a new run creates a project that may not exist yet.
- **Reuse of existing infrastructure**: Run logs, log resolution, and run-log rendering already exist. The project detail view reuses `findRunLogs()` to detect active runs and adds kill controls.
- **New runs only**: No resume support in the GUI — keeps the initial implementation focused. Resume can be done via CLI.
- **In-process preflight**: Avoids spawning a subprocess just to run checks; the logic is simple enough to port to TypeScript functions.
- **Consolidated preflight + start endpoint**: A single `POST /api/orchestrator/start` with a `dryRun` flag handles both preflight-only and preflight+spawn requests. This eliminates the stale-preflight race (conditions change between clicking "Run Preflight" and "Start") and removes redundant validation code from the spawn path. The frontend simply calls the same endpoint twice — once with `dryRun: true` for the preflight checklist, once without for the actual start.

## Detailed Steps

### Phase 1: Orchestrator — Self-Registration in Run Queue (Python)

1. **Create `orchestrator/src/utils/run_queue.py`** — a small Python module with two functions:

   ```python
   QUEUE_FILE = Path(__file__).resolve().parent.parent.parent / "logs" / ".run-queue.json"

   def register(pid: int, plan_path: str, slug: str, started_at: str) -> str:
       """Append a new entry to the run queue. Returns the entry ID (UUID)."""

   def unregister(entry_id: str) -> None:
       """Remove an entry from the run queue by ID. No-op if not found."""
   ```

   **Queue file format** — JSON array at `orchestrator/logs/.run-queue.json`:
   ```json
   [
     {
       "id": "a1b2c3d4-...",
       "pid": 12345,
       "planPath": "/absolute/path/to/docs/agents/plans/2026-05-05-feature/plan.md",
       "expectedSlug": "2026-05-05-feature",
       "startedAt": "2026-05-05T10:00:00.000Z",
       "status": "pending"
     }
   ]
   ```

   **Implementation details:**
   - Both `register()` and `unregister()` acquire an exclusive file lock on `orchestrator/logs/.run-queue.lock` (using the existing `filelock.py` module at `orchestrator/src/utils/filelock.py`) before reading or writing the queue file. This prevents two orchestrator processes starting near-simultaneously for different plans from racing on the shared queue file — the per-plan `.orchestrator.lock` does not serialize access to the shared queue.
   - `register()` reads the existing queue (or `[]` if missing/corrupt), appends a new entry with `status: "pending"`, writes the file atomically (write to `.tmp` then rename). Returns the new entry's UUID.
   - `unregister()` reads the queue, removes the entry with matching `id`, writes back. If the file doesn't exist or the entry isn't found, it's a silent no-op.
   - File I/O uses `json` and `pathlib` — no external dependencies beyond the existing `filelock.py`.
   - The queue file directory (`orchestrator/logs/`) is already auto-created by the `WorkflowLogger`.
   - Field names use **camelCase** (matching the JSON convention used by the GUI server and all other shared JSON files in the workspace).

2. **Modify `orchestrator/src/cli.py`** — add two calls:
   - **Initialize `entry_id`** before the inner `try` block (around the existing `lock_file = None` initialization, ~line 503): set `entry_id: str | None = None`. This prevents a `NameError` in the `finally` block if `register()` itself raises an exception before assigning the variable.
   - **After `run_start` is logged** (after the `run_logger.log(action="run_start", ...)` call, before `_register_signal_handlers`): call `entry_id = run_queue.register(pid=os.getpid(), plan_path=str(plan_path), slug=plan_dir.name, started_at=run_start_ts)`.
   - **In the `finally` block** (alongside lock file cleanup, around the `unlock()` / `lock_file.close()` / `lock_path.unlink()` code): guard with `if entry_id is not None:` before calling `run_queue.unregister(entry_id)`. This covers all exit paths: normal completion, signal shutdown (`signal_shutdown` + `run_end` are already written by this point), and error-then-`run_end`. The only path that skips `unregister()` is an actual process crash (SIGKILL, OOM kill) — which cannot execute cleanup code anyway.

   This means:
   - Clean successful run: entry is registered → project initialized (→ `started`) → synthesis generated (→ auto-removed by GUI) or → run_end logged → `unregister()` removes it.
   - Signal-interrupted run (SIGTERM/SIGINT): signal handler writes `signal_shutdown` + `run_end` → `finally` block runs → `unregister()` removes the entry cleanly.
   - Killed/crashed run (SIGKILL, OOM): `finally` block never runs → entry stays as `pending` → GUI detects dead PID → transitions to `dead`.

   Note: `unregister()` and the GUI's auto-removal of completed `started` entries (when `synthesis_generated === true`) are intentionally redundant and order-independent. If the GUI poll removes a completed entry before `unregister()` runs, the `unregister()` call is a silent no-op. If `unregister()` runs first, the GUI never sees the entry. Both paths produce the correct final state.

3. **Add unit test `orchestrator/tests/test_run_queue.py`**:
   - Test `register()` creates file, appends entry, returns UUID.
   - Test `register()` with existing entries preserves them.
   - Test `unregister()` removes correct entry by ID.
   - Test `unregister()` is no-op for unknown ID.
   - Test `register()` handles corrupt/missing file gracefully.
   - Test atomic write (no partial writes on concurrent access).

### Phase 2: Backend — Orchestrator Manager Module (TypeScript)

4. **Create `mcp-server/src/gui/orchestrator-manager.ts`** — a module that **reads** the queue file and manages lifecycle transitions. Unlike the previous plan, this module does **not** write new queue entries — that's the orchestrator's job.

   **Types:**
   ```ts
   interface QueueEntry {
     id: string;             // UUID v4, written by orchestrator
     pid: number;            // OS process ID
     planPath: string;       // Absolute path to the plan .md file
     expectedSlug: string;   // plan_dir.name (written by orchestrator)
     startedAt: string;      // ISO 8601 timestamp
     status: 'pending' | 'started' | 'dead';
   }

   interface EnrichedQueueEntry extends QueueEntry {
     processAlive: boolean;  // Result of process.kill(pid, 0)
     projectSlug: string | null; // Non-null when status === 'started'
     elapsedMs: number;      // Date.now() - Date.parse(startedAt)
     logFilename: string | null; // JSONL log filename (if found)
     progress: string | null;    // Human-readable summary of latest JSONL event
     lastAction: string | null;  // Raw action type of the latest event
   }

   interface PreflightResult {
     name: string;
     pass: boolean;
     detail: string;
     fix?: string;
   }

   interface StartResult {
     checks: PreflightResult[];  // Always present — preflight results
     started: boolean;           // true only when dryRun is false and all checks pass
     pid?: number;               // Present only when started === true
   }
   ```

   **Functions:**
   - `startOrchestrator(planPath: string, workspaceRoot: string, dryRun?: boolean): Promise<StartResult>` — consolidated preflight + start endpoint. Runs all 4 preflight checks (venv, env, mcp-dist, no-conflict) plus plan-file validation **and plan-path prefix validation** (the resolved `planPath` must start with `workspaceRoot` — reject paths outside the workspace with a failed preflight check to prevent path traversal). When `dryRun` is `true`, returns only the preflight results. When `dryRun` is `false`/omitted: if any check fails, returns the results with `started: false`; if all pass, resolves the `orchestrate` binary, spawns detached, and returns `started: true` with the PID. The orchestrator process self-registers in the queue — this function does **not** write queue entries. The "no-conflict" check reads the queue file to see if the plan is already registered. Note: `planFolderBasename()` throws on non-standard plan paths — catch the validation error and surface it as a failed preflight check ("Plan path does not follow naming convention") rather than letting it propagate as an unhandled exception.
   - `getQueue(ledgerRoot: string, orchestratorLogsDir: string): Promise<EnrichedQueueEntry[]>` — reads the queue file (written by orchestrator processes), computes lifecycle transitions **in-memory** for each entry (pending→started, pending→dead, started→removed), resolves JSONL log progress, and returns the enriched entries. **Does not write state changes back to the queue file** — the `status` field on disk remains as the orchestrator wrote it (`pending`); the effective status is recomputed on every call by checking process liveness and ledger state. If the queue file or its parent directory does not exist, returns `[]` (matching the `findRunLogs` pattern in `log-resolver.ts`).
   - `killQueueEntry(id: string): Promise<{ killed: boolean }>` — finds entry by ID in the queue file, validates it is effectively in `pending` status (recomputed: process alive + no project in ledger) with a live process, sends SIGTERM → wait 3s → SIGKILL if needed, removes the entry from the queue file, cleans up the `.orchestrator.lock` file. Kill is restricted to effectively-pending entries only — once a project exists in the ledger (`started` status), the user manages it through project-level controls.
   - `dismissQueueEntry(id: string): Promise<void>` — removes a dead entry (recomputed: process not alive + no project in ledger) from the queue file.

   **Queue file path**: `path.join(workspaceRoot, 'orchestrator', 'logs', '.run-queue.json')` — same file the orchestrator writes to.

5. **Lifecycle transition logic inside `getQueue()` (computed in-memory, never written back)**:
   ```
   Read queue file → entries[] (return [] if file or directory missing)

   For each entry in entries:
     // Compute effective status in-memory (do NOT mutate queue file):
     effectiveStatus = entry.status  // on disk, always 'pending' as written by orchestrator

     is process alive? (process.kill(pid, 0))
       NO  → does rootIndex exist for expectedSlug?
         YES → effectiveStatus = 'started' (project exists, process finished or crashed)
         NO  → effectiveStatus = 'dead' (process died before project init)
       YES → does rootIndex exist for expectedSlug?
         YES → effectiveStatus = 'started'
         NO  → effectiveStatus = 'pending'

     if effectiveStatus === 'started':
       read rootIndex for expectedSlug
       if synthesis_generated === true → exclude entry from returned array

     // JSONL progress resolution (for all non-excluded entries):
     call findRunLogs(orchestratorLogsDir, entry.expectedSlug)
     if log found:
       set logFilename = most recent matching filename
       read last few JSONL lines via readLogEntries()
       derive progress summary from the latest meaningful event:
         run_start       → "Starting…"
         stage_start      → "{Stage} stage running (WP-{id})…"
         tool_call        → "{Stage} stage — {tool_name}"
         stage_complete   → "{Stage} complete ({PASS/FAIL})"
         route            → "Routing → {destination}"
         heartbeat        → "Running (idle {N}s)"
         run_end          → "Completed"
         run_error        → "Error: {message}"
         (other)          → action name as fallback
       set progress = derived summary string
       set lastAction = raw action type
     else:
       set logFilename = null, progress = null, lastAction = null

     Return enriched entry with effectiveStatus as the 'status' field.
   ```

   **Design rationale for read-only approach:** The queue file is written exclusively by Python orchestrator processes (via `filelock.py`-guarded `register()`/`unregister()`). If the TypeScript GUI server also performed read-modify-write on the file, a race condition would exist: the GUI could read the file, a Python process could register concurrently (under its own lock), and the GUI's write-back would silently overwrite the new entry. By computing lifecycle state in-memory on every poll, the GUI avoids writing to the file entirely — only explicit user actions (`killQueueEntry`, `dismissQueueEntry`) perform targeted mutations. Entries left behind by crashed processes (SIGKILL/OOM) are never cleaned up on disk, but they are shown as `dead` in the UI and removed when the user clicks Dismiss.

6. **Detached spawn details** (in `startOrchestrator()`):
   - Use `child_process.spawn()` with `{ detached: true, stdio: ['ignore', 'ignore', 'ignore'] }`. The orchestrator manages its own JSONL log internally and self-registers in the queue.
   - Call `child.unref()` so the GUI server can exit without waiting.
   - The spawned command is the `orchestrate` binary from the venv (same resolution as `run-orchestrator.js`: `orchestrator/.venv/bin/orchestrate` on Unix, `orchestrator/.venv/Scripts/orchestrate.exe` on Windows).
   - Before spawning, run the MCP dist freshness check and rebuild if needed (port the logic from `run-orchestrator.js`).

### Phase 3: Backend — API Routes

7. **Add route handlers in `gui/api.ts`**:
   - `handleOrchestratorStart(workspaceRoot, body)` → validates `body.planPath`, calls `startOrchestrator()` with `body.dryRun`, returns preflight results and optional PID.
   - `handleGetOrchestratorQueue(ledgerRoot, orchestratorLogsDir)` → calls `getQueue()`, returns enriched entries array including JSONL progress.
   - `handleOrchestratorKill(id)` → calls `killQueueEntry(id)`, returns result.
   - `handleOrchestratorDismiss(id)` → calls `dismissQueueEntry(id)`, returns 204.

8. **Wire routes in `gui/server.ts`**:

   **Route placement — `handleRequest()` vs `matchRoute()` split:**

   `POST /api/orchestrator/start` requires a JSON body (`{ planPath: string, dryRun?: boolean }`), so it **must** be handled as a special-case block in `handleRequest()` with explicit `readBody()` + `JSON.parse()` — following the same pattern as the existing `POST /api/projects/:slug/reset` handler. Routes without bodies go in `matchRoute()`.

   | Route | Body? | Placement | Pattern |
   |-------|-------|-----------|---------|
   | `POST /api/orchestrator/start` | Yes (`{ planPath, dryRun? }`) | `handleRequest()` special-case block | Like `POST /api/projects/:slug/reset` |
   | `GET /api/orchestrator/queue` | No | `matchRoute()` | Like `GET /api/projects` |
   | `POST /api/orchestrator/kill/:id` | No | `matchRoute()` | Like `POST /api/projects/:slug/archive` |
   | `DELETE /api/orchestrator/queue/:id` | No | `matchRoute()` | Like `DELETE /api/projects/:slug` |

   These are **non-project-scoped** routes (under `/api/orchestrator/`), since runs are started before a project may exist in the ledger.

   **`workspaceRoot` threading:** Export the existing `workspaceRoot` constant from `src/utils/ledger-root.ts` (add `export` to the existing `const workspaceRoot = join(serverDir, '..');` declaration at line 12). Import it in `orchestrator-manager.ts` directly. For routes in `matchRoute()` that need `workspaceRoot` (e.g. to locate the queue file), either: (a) add `workspaceRoot` as a parameter to `matchRoute()` alongside the existing `ledgerRoot` and `orchestratorLogsDir`, or (b) import it directly in `server.ts` from `ledger-root.ts` and pass it into handler calls. Option (a) is consistent with the existing parameter-passing pattern.

### Phase 4: Frontend — Shared Orchestrator UI Helper

8b. **Create `gui/public/views/orchestrator-widgets.js`** — a shared IIFE (`OrchestratorWidgets`) providing reusable rendering functions consumed by both the orchestrator queue view and the project detail view. This avoids duplicating the status card, kill flow, and log preview logic.

   **Exported functions:**
   - `renderStatusCard(entry)` — returns an HTML string for the live status card: PID, elapsed time (auto-formatted via `formatDuration`), progress summary, status badge. Accepts an `EnrichedQueueEntry` shape from the API.
   - `renderKillButton(entryId, onKilled)` — returns a `<button>` element (not HTML string) with a confirmation prompt (`confirm()`). Calls `API.orchestratorKill(entryId)` on confirm, then invokes the `onKilled` callback. Disabled when entry status is not `pending`.
   - `renderDismissButton(entryId, onDismissed)` — returns a `<button>` element for dead entries. Calls `API.orchestratorDismiss(entryId)` and invokes `onDismissed`.
   - `renderLogPreview(slug, logFilename, containerEl)` — renders a compact, auto-updating JSONL log preview into `containerEl`. Uses `API.getRunLogEntries(slug, logFilename, afterLine)` with incremental polling (reuses the `?after=N` cursor). Shows the last ~10 events as compact one-line summaries (action + key detail). New events are appended on each poll; the container auto-scrolls to bottom. Includes a "View full log →" link to `#/projects/{slug}/runs/{logFilename}`. **Returns a cleanup function** that stops the internal polling interval — the calling view must invoke this on unmount or re-render to prevent leaked intervals. (Note: `Router._clearPolling()` manages only a single global interval; the log preview uses its own independent interval, so explicit cleanup is required.)

   **Log preview cleanup protocol:** Since the vanilla JS SPA has no lifecycle hooks (setting `app.innerHTML` destroys DOM elements but does not stop `setInterval` timers), each consuming view must manage cleanup explicitly. Both `orchestrator.js` and `project-detail.js` must maintain a **module-scoped array** of cleanup functions returned by `renderLogPreview()`. At the top of each view's render function (e.g. `renderOrchestrator(app)`), iterate the array, call each cleanup function, and clear the array — before creating any new log preview widgets. This ensures that navigating away or re-rendering stops all active preview intervals.
   - `renderProgressBadge(progress, lastAction)` — returns an HTML string for the progress summary with an appropriate icon/color based on `lastAction` (reuses `runEventSeverity()` logic from `run-log.js`).
   - `renderCliReference()` — returns the CLI commands reference card HTML (static content, shared between views).

   This module is loaded before `orchestrator.js` and `project-detail.js` in `index.html`.

### Phase 5: Frontend — Top-Level Orchestrator View

9. **Create `gui/public/views/orchestrator.js`** — new view with two sections:

   **Section A: Start New Run**
   - Plan path input field (text input, full file path).
   - "Run Preflight" button → calls `API.orchestratorStart({ planPath, dryRun: true })`.
   - Preflight results displayed as a checklist (✓/✗ per check, with fix hint on failure).
   - "Start Run" button (enabled only when all preflight checks pass).
   - On start: calls `API.orchestratorStart({ planPath })`, clears the input, refreshes the queue table.

   **Section B: Run Queue Table**
   - Table columns: Plan (basename of plan path, tooltip with full path), Status (badge), Elapsed Time, Actions.
   - Auto-polls `API.orchestratorQueue()` every 5 seconds (registered via `Router._setPolling(pollFn, 5000)` so the router clears it automatically on route change). Note: `Router._setPolling()` manages a single global interval — it must be called to register the queue poll so `dispatch()` clears it on navigation.
   - Per-row rendering based on status:

   | Status | Badge | Elapsed | Progress | Actions |
   |--------|-------|---------|----------|---------|
   | `pending` | 🟡 Pending | Live counter | JSONL progress summary + log preview | Kill button (via `OrchestratorWidgets.renderKillButton`) |
   | `started` | 🟢 Started | Live counter | Latest stage info + log preview | Link to project detail (`#/projects/{slug}`) |
   | `dead` | 🔴 Dead | Final duration | Last known event | Dismiss button (via `OrchestratorWidgets.renderDismissButton`) |

   The **Progress** column shows:
   - The `progress` string via `OrchestratorWidgets.renderProgressBadge()`.
   - A clickable "View Log →" link pointing to `#/projects/{expectedSlug}/runs/{logFilename}` (the existing run-log view). This works even for pending runs because the run-log viewer reads from `orchestrator/logs/` as a fallback.
   - If no log file is found yet (rare — `run_start` is written almost immediately), show "Waiting for log…".

   Each row can be **expanded** (click/toggle) to show an inline log preview rendered by `OrchestratorWidgets.renderLogPreview()`. This shows the last ~10 JSONL events as compact one-line summaries, auto-updating on each poll.

   **CLI commands reference** (always visible at the bottom, rendered by `OrchestratorWidgets.renderCliReference()`).

10. **Add `API` client methods in `api-client.js`**:
   - `orchestratorStart(body)` → `POST /api/orchestrator/start`. Accepts `{ planPath, dryRun? }`. When `dryRun: true`, returns preflight results only. When `false`/omitted, returns preflight results + optional PID.
   - `orchestratorQueue()` → `GET /api/orchestrator/queue`.
   - `orchestratorKill(id)` → `POST /api/orchestrator/kill/{id}`.
   - `orchestratorDismiss(id)` → `DELETE /api/orchestrator/queue/{id}`.

11. **Add nav link in `index.html`**: Add `<a href="#/orchestrator">Orchestrator</a>` to the `<nav>` element.

12. **Add route in `router.js`**: Add `/orchestrator` path dispatching to `renderOrchestrator(app)`.

13. **Load scripts in `index.html`**: Add two `<script>` tags — `orchestrator-widgets.js` **before** `orchestrator.js` (dependency order).

### Phase 6: Frontend — Enhanced Project Detail View

14. **Enhance `views/project-detail.js`** — modify the existing "Orchestrator Runs" section for active runs:
    - The existing section already checks `findRunLogs` for `is_active` runs and renders run badges.
    - **New**: When the most recent run has `is_active: true`, fetch `API.orchestratorQueue()` and find the matching entry (by `expectedSlug === slug`). If found:
      - Display a **live status card** via `OrchestratorWidgets.renderStatusCard(entry)`.
      - "Kill Process" button via `OrchestratorWidgets.renderKillButton(entry.id, refreshFn)`.
      - **Inline JSONL log preview** via `OrchestratorWidgets.renderLogPreview(slug, entry.logFilename, containerEl)` — shows the last ~10 events with auto-updating, identical to the queue view's expanded row.
      - Direct link to the full run log view.
    - If no matching queue entry is found (e.g. a very old run or the queue file was deleted), but the most recent run is active, still show the **inline log preview** using the log filename from `findRunLogs`. The kill button is omitted (PID is unknown), and a note suggests using `kill-orchestrator.js` from the terminal.
    - The log preview auto-polls every 5 seconds (same interval as the queue view), registered via `Router._setPolling(pollFn, 5000)`. Polling stops when navigating away from the project detail view (cleaned up automatically by `Router._clearPolling()` in `dispatch()`). Any log preview cleanup functions returned by `OrchestratorWidgets.renderLogPreview()` must also be invoked before re-rendering or navigating away. **Cleanup mechanism:** `project-detail.js` maintains a module-scoped array of cleanup functions. At the top of the render function, iterate and call each, then clear the array (same protocol as `orchestrator.js` — see Phase 4 Step 8b).

### Phase 7: Styling

15. **Add CSS for orchestrator view in `styles.css`**:
    - Preflight checklist styles (`.preflight-check`, `.preflight-pass`, `.preflight-fail`).
    - Queue table styles (`.orch-queue-table`).
    - Status card styles (`.orch-status-card`) — shared between queue rows and project detail.
    - Log preview styles (`.orch-log-preview`, `.orch-log-entry`) — compact event list with auto-scroll.
    - Status badges (`.badge-pending`, `.badge-started`, `.badge-dead`).
    - CLI reference card (`.cli-reference`).
    - Plan path input styling.
    - Kill/dismiss button styles.
    - Expandable row toggle (`.orch-row-expand`).

### Phase 8: Tests

16. **Create `tests/gui/orchestrator-manager.test.ts`**:
    - Unit test `runPreflight()` with mocked filesystem (missing venv, missing .env, stale dist).
    - Unit test `getQueue()` JSONL progress resolution:
      - Log file found → progress and logFilename populated.
      - No log file yet → progress and logFilename are null.
      - Various last-event types → correct human-readable summary.
    - Unit test `getQueue()` lifecycle transitions (computed in-memory, not written to file):
      - pending + alive + no project → effective status stays pending.
      - pending + alive + project exists → effective status is started.
      - pending + dead process + no project → effective status is dead.
      - pending + dead process + project exists → effective status is started.
      - started + synthesis generated → excluded from returned array.
      - Verify that `getQueue()` does NOT modify the queue file on disk (read-only assertion).
    - Unit test `startOrchestrator()` with duplicate plan path rejection.
    - Unit test `startOrchestrator()` dry-run mode returns preflight results without spawning.
    - Unit test `startOrchestrator()` real mode runs preflight first, only spawns if all pass.
    - Unit test `planFolderBasename()` validation error is caught and surfaced as a failed preflight check.
    - Unit test queue file read/write/cleanup.
    - Unit test `killQueueEntry()` only works on effectively-pending entries (rejects entries where project exists in ledger or process is already dead).
    - Unit test `dismissQueueEntry()` only works on effectively-dead entries (process not alive + no project in ledger).
    - Mock `process.kill`, `LedgerStore`, and filesystem — do NOT spawn real processes.

17. **Create `tests/gui/orchestrator-api.test.ts`**:
    - Integration tests for the four new API routes via the handler functions.
    - Test start with `dryRun: true` returns preflight results without spawning.
    - Test start with all checks passing returns `started: true` and PID.
    - Test start with failing checks returns `started: false` and preflight results.
    - Test start with invalid plan path (validation error).
    - Test start with duplicate plan path (conflict error via preflight no-conflict check).
    - Test queue returns enriched entries with `processAlive`, `elapsedMs`, `logFilename`, `progress`, and `lastAction`.
    - Test kill on non-existent ID (not found).
    - Test kill on started entry (forbidden — kill restricted to effectively-pending).
    - Test dismiss on non-dead entry (forbidden — dismiss restricted to effectively-dead).

## Dependencies

- Node.js `child_process.spawn` (stdlib — no new dependencies).
- `node:fs/promises` for queue file reading (read-only in `getQueue()`; write only in `killQueueEntry` / `dismissQueueEntry`).
- `workspaceRoot` exported from `src/utils/ledger-root.ts` — for resolving the queue file path, venv binary, and MCP dist path in `orchestrator-manager.ts`.
- `LedgerStore` from `src/storage/ledger-store.ts` — for `rootIndexExists()` and reading `synthesis_generated` from the root index during lifecycle transitions.
- `findRunLogs` and `readLogEntries` from `src/gui/log-resolver.ts` — for locating JSONL log files and reading progress events for queue entries.
- `planFolderBasename` from `src/utils/path-validator.ts` — for slug derivation in the GUI (preflight duplicate check).
- Python `json`, `pathlib`, `uuid`, `os` (stdlib — no new Python dependencies) for the orchestrator's `run_queue.py`.
- Existing `filelock.py` at `orchestrator/src/utils/filelock.py` for queue file mutual exclusion (already cross-platform).
- Existing `scripts/run-orchestrator.js` logic for MCP dist freshness check (ported, not imported, since scripts are CJS and the GUI server is ESM).
- Existing `scripts/preflight-orchestrator.js` check logic (ported to TypeScript).

## Required Components

### New files
- `orchestrator/src/utils/run_queue.py` — Python module with `register()` and `unregister()` functions that write to the shared queue file.
- `orchestrator/tests/test_run_queue.py` — Python unit tests for the run queue module.
- `mcp-server/src/gui/orchestrator-manager.ts` — queue reading, lifecycle transitions, process spawning, preflight.
- `mcp-server/gui/public/views/orchestrator-widgets.js` — shared IIFE with reusable rendering functions (status card, kill/dismiss buttons, log preview, progress badge, CLI reference).
- `mcp-server/gui/public/views/orchestrator.js` — frontend view (start form + queue table).
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — unit tests.
- `mcp-server/tests/gui/orchestrator-api.test.ts` — API integration tests.

### Modified files
- `orchestrator/src/cli.py` — import and call `run_queue.register()` after `run_start`, `run_queue.unregister()` in the `finally` block (alongside lock file cleanup).
- `mcp-server/gui/api.ts` — four new handler functions.
- `mcp-server/gui/server.ts` — one new special-case block in `handleRequest()` for `POST /api/orchestrator/start` (body parsing); three new entries in `matchRoute()` for GET/POST/DELETE orchestrator routes; `workspaceRoot` threading (import from `ledger-root.ts`).
- `mcp-server/src/utils/ledger-root.ts` — export the existing `workspaceRoot` constant (add `export` keyword).
- `mcp-server/gui/public/api-client.js` — four new API methods.
- `mcp-server/gui/public/index.html` — nav link + script tag.
- `mcp-server/gui/public/router.js` — orchestrator route.
- `mcp-server/gui/public/styles.css` — orchestrator-specific styles.
- `mcp-server/gui/public/views/project-detail.js` — active run controls in orchestrator section (queue-aware).

## Assumptions

- The GUI server always runs on the same machine as the orchestrator venv. There is no remote process management.
- The orchestrator and GUI server access the same `orchestrator/logs/.run-queue.json` file. Cross-language file access (Python writes JSON, TypeScript reads JSON) works seamlessly since both use standard JSON serialization.
- Multiple concurrent runs are supported for different plans. The same plan cannot be started twice (enforced by both the orchestrator's `.orchestrator.lock` and the queue's duplicate check).
- The `orchestrate` binary path is resolved the same way as in `run-orchestrator.js` (`orchestrator/.venv/bin/orchestrate` on Unix, `orchestrator/.venv/Scripts/orchestrate.exe` on Windows).
- The workspace root is already computed in `src/utils/ledger-root.ts` as `const workspaceRoot = join(serverDir, '..');`. This constant will be exported and imported by `orchestrator-manager.ts` and `server.ts`.
- Slug derivation is consistent between Python (`plan_dir.name`) and TypeScript (`planFolderBasename()`). Both extract the basename of the plan's parent directory.

## Constraints

- **Cross-platform**: All process management must work on macOS, Linux, and Windows. The queue file PID approach avoids `pgrep` dependency. `kill-orchestrator.js` remains the fallback for killing processes that can't be matched by queue entry.
- **No new npm dependencies**: All TypeScript functionality uses Node.js stdlib (`child_process`, `fs`, `path`).
- **No new Python dependencies**: The `run_queue.py` module uses only stdlib (`json`, `pathlib`, `uuid`, `os`, `tempfile`) plus the existing `filelock.py` module.
- **STDIO discipline**: `orchestrator-manager.ts` must not write to `process.stdout` (it's imported by `api.ts` which enforces this rule). Use `process.stderr` for any diagnostics.
- **Security**: The plan path input is user-provided. Validate it resolves to an existing `.md` file **and** that the resolved absolute path starts with `workspaceRoot` (prefix check to prevent path traversal — reject paths like `/tmp/evil/2026-05-05-exploit/plan.md` that pass naming convention checks but operate outside the workspace). Do not expose arbitrary filesystem operations. The queue file path is fixed (not user-controlled).
- **Queue file atomicity (Python writer)**: The orchestrator uses atomic write (write to `.tmp` then rename) to prevent partial writes. Additionally, both `register()` and `unregister()` acquire an exclusive file lock on `.run-queue.lock` (via `filelock.py`) to prevent concurrent registrations for different plans from racing on the shared queue file. Only one orchestrator process registers at a time per plan (enforced by `.orchestrator.lock`), but multiple plans may register concurrently.
- **Queue file reads (TypeScript reader)**: `getQueue()` is **read-only** — it computes lifecycle state in-memory and never writes back to the queue file. This eliminates the cross-language race condition where a TypeScript read-modify-write could overwrite a concurrent Python `register()` call (the Python writer uses `filelock.py` locks, but the TypeScript side does not participate in that lock protocol). Only explicit user actions (`killQueueEntry`, `dismissQueueEntry`) write to the queue file — these are infrequent, targeted mutations with a negligible race window.
- **PID reuse detection (Windows limitation)**: On Unix, `ps -o command= <pid>` verifies the process command line matches `orchestrate` before acting on a PID. On Windows, only the PID-only check is used — PID reuse within a session is unlikely but not impossible. The `.orchestrator.lock` file provides a secondary guard against accidental kills. This is a known limitation.

## Out of Scope

- **Resume support**: The GUI does not support `--resume <thread-id>`. Users can resume via CLI.
- **Real-time log streaming**: The run log view already supports `?after=N` pagination. WebSocket-based streaming is not added.
- **Custom orchestrator flags**: The GUI start only accepts a plan path. Advanced flags (`--dry-run`, `--max-iterations`, `--log-level`, `--interrupt-on`) are CLI-only.
- **Notifications**: No desktop/browser notifications when a run completes.

## Acceptance Criteria

- [ ] A top-level "Orchestrator" link appears in the dashboard nav.
- [ ] The orchestrator view displays a plan path input and "Run Preflight" button.
- [ ] Preflight results show as a checklist with pass/fail status and fix hints.
- [ ] "Start Run" button is disabled until all preflight checks pass.
- [ ] Clicking "Start Run" spawns the orchestrator detached. The orchestrator self-registers in the queue.
- [ ] Clicking "Run Preflight" and "Start Run" both use the same `POST /api/orchestrator/start` endpoint (with `dryRun: true` for preflight-only).
- [ ] CLI-started orchestrator runs also self-register and appear in the queue identically.
- [ ] Multiple runs for different plans can be started and appear simultaneously in the queue.
- [ ] Starting the same plan twice is rejected with an error.
- [ ] Pending entries show PID, elapsed time, JSONL progress summary, and a Kill button.
- [ ] Each queue entry with a detected JSONL log file shows a "View Log" link to the full run log viewer.
- [ ] The progress summary updates on each 5-second poll (reflects latest JSONL event).
- [ ] When the project is initialized in the ledger, the queue entry transitions to "Started" automatically.
- [ ] Started entries show a link to the project detail view; kill is disabled.
- [ ] When the project's synthesis is generated, the entry is automatically removed from the queue.
- [ ] Dead entries (process died before project init) show a Dismiss button.
- [ ] In project detail, an active orchestrator run (matched via queue) shows a status card with PID, elapsed time, kill button, and inline JSONL log preview.
- [ ] The inline log preview auto-updates every 5 seconds and stops polling on navigation.
- [ ] On clean orchestrator exit (run_end), the entry is self-removed from the queue.
- [ ] On signal-interrupted exit (SIGTERM/SIGINT), the entry is self-removed from the queue (unregister runs in the `finally` block).
- [ ] Shared orchestrator UI components (`OrchestratorWidgets`) are used by both the orchestrator view and the project detail view — no duplicate rendering logic.
- [ ] CLI commands reference card is displayed in the orchestrator view.
- [ ] The orchestrator process survives GUI server restarts (detached spawning).
- [ ] After a GUI server restart, the queue is re-read from disk and status checks correctly identify alive/dead processes.
- [ ] All new backend logic has unit/integration tests.
- [ ] Cross-platform: no `pgrep` dependency in the new code; queue-file approach works on all OSes.

## Testing Strategy

- **Python unit tests** (`orchestrator/tests/test_run_queue.py`): Test `register()` creates queue file, appends entry, returns UUID. Test `register()` preserves existing entries. Test `unregister()` removes correct entry. Test `unregister()` is a no-op for unknown IDs. Test atomic write behavior. Test handling of corrupt/missing queue file. Test that concurrent `register()` calls for different plans are serialized by file lock (no lost entries). Run via `pytest` from the orchestrator venv.
- **TypeScript unit tests** (`orchestrator-manager.test.ts`): Test `startOrchestrator()` dry-run mode returns preflight results without spawning. Test `startOrchestrator()` real mode runs preflight first, only spawns if all pass. Test `startOrchestrator()` surfaces `planFolderBasename()` validation errors as failed preflight checks. Test `startOrchestrator()` rejects plan paths outside `workspaceRoot` (path traversal prevention). Test queue lifecycle transitions exhaustively (all state × condition combinations) and verify `getQueue()` does not modify the queue file (read-only). Test duplicate plan rejection. Test kill restricted to effectively-pending entries only (rejects started and dead). Test dismiss restricted to effectively-dead entries. Mock `process.kill`, `LedgerStore`, and filesystem — do NOT spawn real processes.
- **API integration tests** (`orchestrator-api.test.ts`): Test handler functions directly (same pattern as existing `api.test.ts`). Mock `orchestrator-manager.ts` functions to test route handling, validation, and error cases. Test consolidated start endpoint in both dry-run and real modes.
- **Manual testing**: Start a run from the GUI, verify it appears in the queue. Start a run from the CLI, verify it also appears in the queue identically. Start multiple runs for different plans. Verify pending → started transition when PM agent initializes the project. Kill a pending run, verify it transitions to dead. Dismiss a dead entry. Verify a started entry auto-removes when synthesis completes. Restart the GUI server mid-run, verify queue persistence. Navigate to project detail during an active run and verify the inline log preview shows live events. Verify that on clean exit, the orchestrator removes its own queue entry.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Orphaned queue entries** (process dies without cleanup) | `getQueue()` self-heals in-memory: entries with dead processes and no project in ledger are shown as `dead` in the UI (user can dismiss). Entries with dead processes but an existing project are shown as `started` (user manages via project detail). The queue file on disk retains stale entries until explicitly dismissed by the user or removed by a future `register()`/`unregister()` call. |
| **PID reuse by OS** (stale entry points to a different process) | On status check, verify the process command line matches `orchestrate` (use `ps -o command= <pid>` on Unix). On Windows, accept the PID-only check as sufficient — PID reuse within a session is unlikely. The `.orchestrator.lock` file provides a secondary guard. See Constraints section for the documented Windows limitation. |
| **MCP dist rebuild blocks the start** | Show a "Rebuilding MCP server…" progress indicator. The consolidated start endpoint detects staleness via preflight and rebuilds during spawn. |
| **Plan path validation** | Backend validates the path exists and is a file before spawning. `planFolderBasename()` validation errors are caught and surfaced as a failed preflight check. Frontend shows an inline error for invalid paths. |
| **Slug derivation mismatch** | Use the same `planFolderBasename()` function that the MCP server uses. If the plan path doesn't follow the expected convention, the slug may not match — the entry stays pending until manually killed. |
| **JSONL log not yet created** (race between spawn and file creation) | `progress` and `logFilename` are null; frontend shows "Waiting for log…". Next poll picks it up. |
| **Queue file corruption** | Wrap read/write in try/catch (both Python and TypeScript). If the queue file is unparseable, treat it as empty (log warning). The Python writer uses atomic rename to minimize partial-write risk. Concurrent writes are serialized by `filelock.py`. |
| **Cross-language queue access timing** | Brief window after spawn where the queue entry hasn't been written yet (orchestrator is starting up). The GUI handles this gracefully — the process isn't visible in the queue for ~1-2 seconds. On next poll it appears. |
| **Windows compatibility** | Use `process.platform` guards for venv path resolution (`Scripts/` vs `bin/`). Avoid `pgrep`. The `child_process.spawn` detached behavior differs on Windows (uses `CREATE_NEW_PROCESS_GROUP`) — test on Windows or document as a known limitation. |
