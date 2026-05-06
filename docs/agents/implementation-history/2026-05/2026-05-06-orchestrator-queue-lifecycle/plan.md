# Plan

## Summary

Fix the orchestrator GUI run queue to correctly transition entries from "pending" to "started" status, populate missing enrichment fields (`lastAction`, `logFilename`) that the front-end expects, and ensure queue entries are properly removed once a run completes. Currently, the queue entry stays permanently stuck at "PENDING / IDLE" because the `computeEffectiveStatus` function relies solely on `project-ledger.json` existence as the "started" signal — but the orchestrator process may run for many minutes before the PM stage creates the ledger (or may fail entirely without creating it).

## Architectural Context

The orchestrator run queue is a cross-process coordination mechanism:

- **Writer:** Python orchestrator process (`orchestrator/src/utils/run_queue.py`) — writes entries to `orchestrator/logs/.run-queue.json` at run start, removes them at run end.
- **Reader:** TypeScript GUI server (`mcp-server/gui/orchestrator-manager.ts`) — reads the queue file, enriches entries with computed lifecycle state and JSONL log progress, returns them via the HTTP API.
- **Consumer:** Browser SPA (`mcp-server/gui/public/views/orchestrator.js`) — polls `GET /api/orchestrator/queue` every 5 seconds, renders the queue table with status badges, progress text, action buttons, and expandable log previews.

Key modules:
- `mcp-server/gui/orchestrator-manager.ts` — `getQueue()`, `computeEffectiveStatus()`, `resolveProgress()`, `formatProgressEntry()`
- `mcp-server/gui/public/views/orchestrator.js` — `renderQueueTable()`, polling via `Router._setPolling()`
- `mcp-server/gui/public/js/orchestrator-widgets.js` — `renderProgressBadge()`, `renderLogPreview()`
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — existing test suite (1104 lines)

The `QueueEntry` interface currently has: `effectiveStatus`, `progress` (plus inherited `RawQueueEntry` fields). The front-end additionally references `entry.lastAction` and `entry.logFilename` which are never populated.

## Approach / Architecture

### 1. Improve `computeEffectiveStatus` to detect "started" from JSONL logs

Instead of relying solely on `project-ledger.json` existence, introduce a secondary "started" signal: the presence of a JSONL log file containing at least one `stage_start` event. This matches the real-world semantics — the orchestrator has started meaningful work.

The logic becomes:
```
computeEffectiveStatus(alive, projectExists, hasLogActivity):
  if (projectExists) return 'started';       // ledger exists — definitive
  if (!alive) return 'dead';                 // process dead — regardless of past log activity
  if (hasLogActivity) return 'started';      // JSONL shows real work — started
  return 'pending';                          // process alive but no activity yet
```

> **Design decision:** Process liveness takes precedence over log activity. A dead process with past log activity is still `'dead'` — the run has crashed. This ensures the "Dismiss" action remains available for crashed runs that got past initialization.

### 2. Enrich `QueueEntry` with `lastAction` and `logFilename`

Extend the `QueueEntry` interface to include:
- `lastAction: string | null` — the `action` field of the JSONL entry from which the `progress` summary was derived (i.e., the same entry for which `formatProgressEntry` returned non-null). This is what `renderProgressBadge()` maps to badge icons.
- `logFilename: string | null` — basename of the most recent matching JSONL log file (for log preview and log link)

These are already computed or discoverable during `resolveProgress()` — the function just needs to return them alongside the text summary.

### 3. Update Python unregister to be more resilient

The Python orchestrator calls `run_queue.unregister()` at run end. However, if the process crashes or is killed externally, the entry remains in the queue file forever. The GUI already handles this with the "dead" status (process not alive). But the `unregister` call also doesn't happen if the run ends without error but the `finally` block has an exception. This is a lesser concern but worth noting.

## Rationale

- **Why not just check log file existence?** A log file is created immediately at `run_start`, so its mere existence doesn't distinguish "just started" from "actively running stages". Checking for `stage_start` events confirms meaningful progress.
- **Why enrich at the backend?** The front-end already expects these fields. Adding them server-side keeps the API contract complete and avoids a second HTTP round-trip for log metadata.
- **Why not change the Python side?** The Python orchestrator already does its job (registers, runs, unregisters). The issue is in the GUI's status computation logic, which was designed for the happy path where the PM creates the ledger quickly.

## Detailed Steps

### Step 1: Refactor `resolveProgress` to return structured data

Modify `resolveProgress()` in `mcp-server/gui/orchestrator-manager.ts` to return an object instead of a plain string:

```typescript
interface ProgressResolution {
  summary: string | null;       // existing human-readable text
  lastAction: string | null;    // action field of the last meaningful entry
  logFilename: string | null;   // basename of the JSONL file read
  hasStageActivity: boolean;    // true if any stage_start was found in the file
}
```

The function already reads the JSONL file and walks backwards — but the loop structure changes from "find first summarizable match and return" to "track both `summary`/`lastAction` AND `hasStageActivity`, short-circuiting only when both are resolved." Specifically, the walk must continue past the first summarizable event if `stage_start` hasn't been encountered yet. This is not a trivial field capture — it's a loop-termination change.

> **Simplification opportunity:** Instead of a separate `hasStageActivity` boolean, derive it from `lastAction`: if `lastAction` is non-null and not `'run_start'`, then meaningful stage work has occurred. This collapses to `const hasStageActivity = lastAction !== null && lastAction !== 'run_start';` and preserves the single-pass backwards walk with no loop restructuring.

### Step 2: Extend `QueueEntry` interface

Add `lastAction` and `logFilename` to the `QueueEntry` interface:

```typescript
export interface QueueEntry extends RawQueueEntry {
  effectiveStatus: EffectiveStatus;
  progress: string | null;
  lastAction: string | null;
  logFilename: string | null;
}
```

### Step 3: Update `computeEffectiveStatus` signature and logic

Change the function to accept a `hasLogActivity` parameter:

```typescript
function computeEffectiveStatus(
  alive: boolean,
  projectExists: boolean,
  hasLogActivity: boolean
): EffectiveStatus {
  if (projectExists) return 'started';
  if (!alive) return 'dead';
  if (hasLogActivity) return 'started';
  return 'pending';
}
```

> **Note:** The `!alive` check comes before `hasLogActivity` — a dead process is always `'dead'` regardless of past log activity. This preserves correct UX for the Dismiss action on crashed runs.

### Step 3b: Update `killQueueEntry` and `dismissQueueEntry` callers

`killQueueEntry` (line 497) and `dismissQueueEntry` (line 530) also call `computeEffectiveStatus(alive, projectExists)` to gate their operations. Two options:

**Option A (recommended):** Keep the 2-parameter signature as an internal overload for kill/dismiss. These mutation paths don't need log enrichment — they operate on raw lifecycle state (pending = killable, dead = dismissable). A process that's alive with log activity is `'started'` from the user's perspective, but kill/dismiss don't need to distinguish `'pending'` from `'started'` — they just need `alive && !projectExists` (killable) or `!alive && !projectExists` (dismissable). Keep the existing 2-param calls unchanged.

**Option B:** Pass `false` as `hasLogActivity` in kill/dismiss paths (conservative — never promotes to `'started'`). This is semantically identical to Option A since `!alive` already returns `'dead'` before `hasLogActivity` is checked.

**Decision:** Use Option A — no changes needed to `killQueueEntry`/`dismissQueueEntry`. Their existing `computeEffectiveStatus(alive, projectExists)` calls remain valid because:
- Kill checks `effectiveStatus !== 'pending'` → with 2 params, `alive + no project = 'pending'` (correct gate)
- Dismiss checks `effectiveStatus !== 'dead'` → with 2 params, `!alive + no project = 'dead'` (correct gate)

To support this, keep the 2-parameter overload signature alongside the 3-parameter one, or default the third parameter: `hasLogActivity = false`.

### Step 4: Update `getQueue()` to use structured progress data

Wire the new `ProgressResolution` into the queue enrichment loop:
- Pass `progressResult.hasStageActivity` to `computeEffectiveStatus`
- Populate `lastAction` and `logFilename` from `progressResult`

### Step 5: Update existing tests

The test file (`mcp-server/tests/gui/orchestrator-manager.test.ts`) has explicit AC tests for `computeEffectiveStatus` transitions. Update:
- AC-2 test: alive + no project + no log activity → pending
- Add new AC: alive + no project + log activity → started
- AC-3 test: verify existing project tests still pass (projectExists takes precedence)
- Add tests for `lastAction` and `logFilename` population in `QueueEntry`
- Add tests for `resolveProgress` returning structured data

### Step 6: (Optional) Update `formatProgressEntry` to handle `tool_call`

Currently `tool_call` events return `null` from `formatProgressEntry`. Since they represent active work, consider adding a summary like `"Tool call: {tool_name}"` so the progress text stays fresh during long PM invocations where many tool calls happen without a new `stage_start`.

### Step 7: Verify front-end consumption

No front-end code changes are needed — the view already references `entry.lastAction`, `entry.logFilename`, and `entry.progress`. Once the backend populates these fields, the UI will:
- Show the correct progress badge (e.g., "⟳ stage_start" instead of "• idle")
- Display the "View Log →" link when a log file exists
- Render the log preview when the row is expanded

## Dependencies

- No new npm dependencies required
- No Python-side changes required
- Changes are entirely within `mcp-server/gui/orchestrator-manager.ts` and its test file
- `killQueueEntry` and `dismissQueueEntry` (same file) also call `computeEffectiveStatus` — they continue using the 2-parameter overload (default `hasLogActivity = false`) and require no logic changes

## Required Components

- `mcp-server/gui/orchestrator-manager.ts` — main logic changes (including `getQueue`, `resolveProgress`, `computeEffectiveStatus`; `killQueueEntry`/`dismissQueueEntry` unchanged due to parameter default)
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — test updates
- No new files needed

## Assumptions

- A `stage_start` event in the JSONL log is a reliable indicator that the orchestrator has moved past initialization and is doing real work.
- The front-end's references to `entry.lastAction` and `entry.logFilename` were always intentional (designed for this enrichment) but the backend implementation lagged behind.
- The polling interval (5 seconds) is sufficient for the GUI to pick up status transitions within a reasonable timeframe.

## Constraints

- The `getQueue()` function must remain read-only with respect to the queue file (never writes to it).
- The `resolveProgress` function reads only the newest JSONL file (sorted by filename prefix). This is correct behavior — the newest file corresponds to the current run.
- Must not break existing AC-2 through AC-8 test assertions.
- Cross-platform: `isProcessAlive` uses `process.kill(pid, 0)` which works on all platforms.

## Out of Scope

- Python orchestrator changes (the unregister logic works correctly; the issue is GUI-side).
- Front-end code changes (the view already handles these fields).
- The `project-ledger.json` creation timing (that's a PM persona issue, not a GUI bug).
- The user's API key authentication failure (separate operational issue).
- Queue file locking parity between TypeScript and Python (documented gap, acceptable risk).

## Acceptance Criteria

- A queue entry with a running process and JSONL log showing `stage_start` events displays `effectiveStatus: 'started'` (not stuck at 'pending').
- The progress badge shows the actual last JSONL action (e.g., "⟳ stage_start") instead of "• idle".
- The "View Log →" link appears when a JSONL log file exists for the entry.
- Expanding a queue row shows the log preview (requires `logFilename` to be populated).
- Entries that complete (synthesis generated) are still excluded from results (AC-6 preserved).
- Entries with dead processes and no project are still shown as "dead" (AC-4 preserved).
- All existing orchestrator-manager tests pass after the change.

## Testing Strategy

All new tests follow the established integration pattern: stub `process.kill` for PID liveness, write controlled JSONL and queue files to temp directories, call `getQueue()`, and assert on the returned `QueueEntry` properties.

- **Integration tests via `getQueue()`** — extend `mcp-server/tests/gui/orchestrator-manager.test.ts`:
  - New test: alive process + JSONL with `stage_start` event + no project ledger → `effectiveStatus: 'started'`
  - New test: alive process + JSONL with only `run_start` event + no project ledger → `effectiveStatus: 'pending'` (run_start alone is not stage activity)
  - New test: dead process + JSONL with `stage_start` event + no project ledger → `effectiveStatus: 'dead'` (process dead regardless of past log activity)
  - New test: alive process + JSONL with `stage_start` + no project → returned `QueueEntry` has `lastAction` populated (e.g., `'stage_start'`)
  - New test: alive process + JSONL file present → returned `QueueEntry` has `logFilename` set to the JSONL basename
  - New test: alive process + no JSONL file → returned `QueueEntry` has `lastAction: null` and `logFilename: null`
  - Verify all existing AC-1 through AC-8 assertions pass unchanged

- **`formatProgressEntry` unit tests** (already exported, direct testing is valid):
  - Existing coverage for `stage_start`, `stage_complete`, `run_start`, etc. remains
  - (Optional) Add `tool_call` coverage if Step 6 is implemented

- **Manual testing:** Start an orchestrator run via the GUI, observe the queue transition from "pending" to "started" within one polling cycle after the first `stage_start` event is logged.

> **Note:** `computeEffectiveStatus` is a private function — it cannot be tested directly. All status-transition assertions go through `getQueue()` with controlled filesystem state, matching the established AC-2 through AC-5 test pattern.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Reading JSONL on every poll (5s) could be slow for large files** | `resolveProgress` already walks backwards from the end and stops at the first summarizable event. For the `hasStageActivity` flag, we only need to find one `stage_start` line — can short-circuit. |
| **Race between log file creation and queue poll** | Acceptable: the entry shows "pending" for at most one poll cycle (5s) before the log file appears. |
| **`computeEffectiveStatus` change could break kill/dismiss logic** | Kill operates on "effectively pending" entries. With the new logic, a running process with log activity is "started" not "pending" — this means Kill is disabled once work begins, which is the correct UX. Dismiss still works on "dead" entries. |
| **Test expectations on `QueueEntry` shape** | Existing tests construct entries manually; they'll need `lastAction` and `logFilename` added to expected shapes or the interface must allow them as optional. Making them nullable (already planned) avoids breaking existing test data. |
