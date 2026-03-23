# Plan — Orchestrator Progress Reporting & Duration Tracking

## Summary

Extend the orchestrator's JSONL logging system with richer progress events and
pervasive duration tracking so that consumers (humans watching the console,
post-run analysis tools, and the MCP server GUI) can observe meaningful progress
as a run unfolds. The current system logs routing decisions and stage pass/fail
outcomes but omits stage transitions, WP lifecycle changes, aggregate progress
snapshots, pipeline artifacts (including modified-file lists), cumulative token
budgets, and — critically — **timing information at every level**.

This plan covers three layers:
1. **Orchestrator JSONL events** — new event types + duration fields
2. **MCP server storage** — computed `duration_ms` on pipelines; aggregated
   timing on WP and project levels
3. **MCP server GUI** — surface durations per-pipeline, per-WP, and per-project

## Architectural Context

The orchestrator is a LangGraph `StateGraph` with a central **supervisor**
node (pure-Python router, no LLM) and 8 **pipeline stage** nodes (each wraps
a Deep Agent with MCP tools). Flow is:

```
supervisor → stage → supervisor → stage → … → synthesis → END
```

Relevant modules:

| Module | Path | Role |
|--------|------|------|
| Supervisor | `orchestrator/src/supervisor.py` | Reads ledger, emits `route` events, returns `Command(goto=…)` |
| Node factory | `orchestrator/src/nodes/__init__.py` | Generic wrapper: invokes Deep Agent, emits `stage_complete` / `stage_error` |
| State | `orchestrator/src/state.py` | `WorkflowState` TypedDict with `run_log` (append-only reducer) |
| Logger | `orchestrator/src/utils/logging.py` | `WorkflowLogger`: writes JSONL + stderr console line per entry |
| CLI | `orchestrator/src/cli.py` | Creates logger, prints end-of-run summary |
| JSONL schema doc | `orchestrator/docs/jsonl-log-schema.md` | Documents event types and field reference |
| Pipeline tool | `mcp-server/src/tools/pipeline.ts` | `ledger_complete_pipeline` sets `completed_at`; `ledger_start_pipeline` sets `started_at` |
| Pipeline schema | `mcp-server/src/schema/work-package.ts` | `Pipeline` type with `started_at?`, `completed_at?` (no `duration_ms` yet) |
| GUI API | `mcp-server/gui/api.ts` | REST endpoints serving project/WP data to frontend |
| GUI views | `mcp-server/gui/public/views/` | `project-detail.js`, `work-package.js` — display pipelines, timestamps |
| GUI utils | `mcp-server/gui/public/utils.js` | `formatDate()` — human-readable timestamps (no duration formatter yet) |

### Current event types (10)

`run_start`, `run_end`, `route`, `stage_complete`, `stage_error`,
`mcp_error`, `safety_limit`, `halted_repeated_failure`, `dry_run`, `run_error`

### Data already available in state / ledger

| Data point | Source | Currently logged? |
|------------|--------|-------------------|
| Routing destination + reason | Supervisor `route` event | Yes (destination, agent_role, ledger_action) |
| Stage pass/fail | Node factory `stage_complete` | Yes (result, tokens_used) |
| WP status (READY/IN_PROGRESS/COMPLETE/…) | `ledger_list_work_packages` (called every supervisor iteration) | **No** — only `pending_wp_count` in state |
| Pipeline artifacts (files_modified, commit_hash, PR) | `ledger_complete_pipeline` → stored on WP | **No** |
| Pipeline metrics (test counts, coverage, security issues) | `ledger_complete_pipeline` → stored on WP | **No** |
| Pipeline summary lines | `ledger_complete_pipeline` → stored on WP | **No** |
| Acceptance criteria progress | `ledger_get_work_package` → `acceptance_criteria[].met` | **No** |
| Rework counts | `ledger_get_work_package` → `rework_counts` | **No** (only `consecutive_failures` circuit breaker) |
| Cumulative token usage | Computable from `run_log` entries | **No** |
| Elapsed wall-clock time | Computable (start time known) | **No** |
| `wps_completed_this_run` | State field (incremented manually) | **No** — only in end-of-run summary |
| Pipeline `started_at` / `completed_at` | Set by `ledger_start_pipeline` / `ledger_complete_pipeline` | **No** — stored on WP but never read back or displayed as duration |
| Project `date_created` / `last_updated` | Root index + meta | **No** — shown as absolute timestamps in GUI, never as elapsed duration |
| Per-stage execution duration | Computable (stage start → stage end wallclock) | **No** |

## Approach / Architecture

Add **6 new JSONL event types**, **1 enriched existing event**, and
**pervasive duration tracking** across three layers:

1. **Orchestrator** — new events + `duration_s` on `stage_complete`, run
   elapsed time in `progress_snapshot`
2. **MCP server** — computed `duration_ms` stored on `Pipeline` at completion;
   aggregated timing fields on WP and project API responses
3. **GUI** — display durations inline on pipeline items, WP summary cards,
   and project detail headers; add `formatDuration()` utility

No new LLM calls. One new MCP call (`ledger_get_work_package`) per
successful stage completion in the orchestrator.

The design philosophy is: **emit events at natural boundaries that already
exist in the code flow**, **enrich them with data that is already being
fetched but discarded**, and **compute durations from timestamps that
already exist**.

### New event types

| # | Event type | Emitter | Trigger | Key fields |
|---|-----------|---------|---------|------------|
| 1 | `stage_start` | Node factory | Before Deep Agent invocation | `stage`, `wp_id`, `iteration` |
| 2 | `wp_status_change` | Supervisor | WP status differs from previous iteration | `wp_id`, `old_status`, `new_status` |
| 3 | `progress_snapshot` | Supervisor | Every supervisor iteration (lightweight) | `total_wps`, `completed`, `in_progress`, `blocked`, `pending`, `wps_completed_this_run`, `cumulative_tokens`, **`elapsed_s`**, **`run_start_ts`** |
| 4 | `pipeline_result` | Node factory | After stage completes, if WP detail can be read back | `wp_id`, `pipeline_type`, `status`, `files_modified`, `metrics`, `summary`, **`duration_s`** |
| 5 | `wp_complete` | Supervisor | WP transitions to COMPLETE (subset of `wp_status_change`) | `wp_id`, `acceptance_criteria_met`, `pipelines_passed` |
| 6 | `rework_detected` | Supervisor | Action is REWORK for any role | `wp_id`, `pipeline_type`, `rework_count`, `agent_role` |

### Enriched existing events

| Event | New fields |
|-------|-----------|
| `route` | `prev_stage`, `prev_wp_id`, `prev_result` (what just finished) |
| `stage_complete` | **`duration_s`** (wallclock seconds from `stage_start` to completion) |
| `run_start` | **`run_start_ts`** (ISO timestamp, also stored in state for elapsed-time math) |
| `run_end` | **`total_duration_s`** (wallclock seconds for the entire orchestrator run) |

### Console output enrichment

The `stream_entry` console formatter will be enhanced to print richer
human-readable lines for the new event types (e.g., progress bars, WP status
transitions, file lists). Duration fields will be formatted as human-readable
strings (e.g., "3m 24s", "1h 12m").

### MCP server — computed duration storage

The `ledger_complete_pipeline` handler already sets `completed_at = now()`
and has `started_at` available on the pipeline object. It will additionally
compute and store `duration_ms = completed_at - started_at` on the pipeline.

### GUI — duration display

A new `formatDuration(ms)` utility renders milliseconds as human-readable
strings. Durations are shown:
- **Per-pipeline**: next to status badges on the WP detail view
- **Per-WP aggregate**: sum of all pipeline durations, shown on WP header
- **Per-project**: total elapsed time (`last_updated - date_created`) and,
  if available, sum of all pipeline durations across all WPs

## Rationale

- **`stage_start`**: Currently there's no event between `route` and
  `stage_complete`. Deep Agent invocations can take minutes — knowing "QA has
  started on WP-003" is essential for progress monitoring.
- **`wp_status_change`**: The supervisor already fetches the full WP list every
  iteration but discards the diff. Comparing against the previous iteration's
  snapshot is trivial and surface high-value lifecycle transitions.
- **`progress_snapshot`**: Aggregated counters per iteration give a
  time-series of project health. Cheap to compute from data already in state.
- **`pipeline_result`**: The MCP server stores rich artifacts (files_modified,
  test metrics, summary) when agents call `ledger_complete_pipeline`, but the
  orchestrator currently ignores them. One `ledger_get_work_package` call
  after a stage completes is enough to capture what the agent produced.
- **`wp_complete`**: Dedicated event for dashboards/alerts — a WP reaching
  COMPLETE is a milestone worth explicit logging.
- **`rework_detected`**: Rework loops are the primary source of wasted tokens.
  Making them visible in logs helps identify problematic WPs early.
- **Enriched `route`**: Knowing "DEV finished PASS on WP-003, now routing to
  QA for WP-003" in a single log entry is much more useful than correlating
  two separate events.
- **`duration_s` on `stage_complete`**: The single most requested metric.
  Trivially computed from wallclock delta between `stage_start` and completion.
- **`total_duration_s` on `run_end`**: Answers "how long did this entire run
  take?" — essential for capacity planning and cost estimation.
- **`duration_ms` on Pipeline (MCP server)**: `started_at` and `completed_at`
  already exist but durations are never pre-computed. Storing `duration_ms`
  at write time avoids repeated client-side parsing of ISO strings.
- **GUI duration display**: Timestamps are already shown but humans don't
  intuitively diff ISO strings. "3m 24s" next to a pipeline badge is
  immediately actionable.

## Detailed Steps

### 1. Extend state with previous-iteration WP snapshot and run start time

In `orchestrator/src/state.py`, add new fields to `WorkflowState`:

```python
prev_wp_summaries: list     # Previous iteration's WP list (for diff)
run_start_ts: str           # ISO timestamp of run start (set once by CLI)
```

The supervisor will populate `prev_wp_summaries` before overwriting
`wp_summaries`. The CLI sets `run_start_ts` in the initial state dict so all
nodes can compute elapsed time.

### 2. Store run start time in CLI and enrich `run_start` event

In `orchestrator/src/cli.py`, when creating the initial state and emitting the
`run_start` log entry:

```python
run_start_ts = datetime.now(UTC).isoformat()
# ... existing run_start log entry ...
run_logger.log(stage="cli", wp_id="", action="run_start",
               thread_id=thread_id, dry_run=dry_run,
               run_start_ts=run_start_ts)  # NEW field

# Pass to graph initial state
initial_state["run_start_ts"] = run_start_ts
```

At the end of the run, compute total duration for the `run_end` event:

```python
run_end_ts = datetime.now(UTC).isoformat()
total_duration_s = (datetime.fromisoformat(run_end_ts)
                    - datetime.fromisoformat(run_start_ts)).total_seconds()
run_logger.log(stage="cli", wp_id="", action="run_end",
               total_duration_s=round(total_duration_s, 1))
```

### 3. Add `stage_start` event and `duration_s` tracking to node factory

In `orchestrator/src/nodes/__init__.py`, emit a `stage_start` log entry at the
top of `node_fn`, before the Deep Agent is created, and capture the wallclock
start time for duration calculation:

```python
stage_start_time = datetime.now(UTC)
start_entry = {
    "timestamp": stage_start_time.isoformat(),
    "stage": stage,
    "wp_id": state.get("current_wp_id", ""),
    "action": "stage_start",
    "level": "INFO",
    "iteration": state.get("iteration", 0),
}
if run_logger:
    run_logger.stream_entry(start_entry)
```

After the Deep Agent completes (success or failure), compute the duration:

```python
stage_end_time = datetime.now(UTC)
duration_s = round((stage_end_time - stage_start_time).total_seconds(), 1)
```

Include `duration_s` in both the `stage_complete` log entry:

```python
log_entry = {
    "timestamp": stage_end_time.isoformat(),
    "stage": stage,
    "wp_id": state.get("current_wp_id", ""),
    "action": "stage_complete",
    "result": "PASS",
    "level": "INFO",
    "tokens_used": tokens_used,
    "duration_s": duration_s,      # NEW
}
```

...and in the `stage_error` log entry (with whatever duration elapsed before
the exception):

```python
log_entry = {
    ...
    "action": "stage_error",
    "result": "FAIL",
    "duration_s": duration_s,      # NEW — time until failure
    ...
}
```

Include `start_entry` in the returned `run_log` list (before the
complete/error entry).

### 4. Add `pipeline_result` read-back to node factory

After the Deep Agent completes successfully in `node_fn`, attempt to read back
the WP detail from the ledger to capture pipeline artifacts and timing:

```python
# Best-effort read-back of pipeline artifacts
pipeline_detail = None
wp_id = state.get("current_wp_id", "")
if wp_id and wrapped_tools:
    try:
        get_wp_tool = next((t for t in wrapped_tools if t.name == "ledger_get_work_package"), None)
        if get_wp_tool:
            raw = await get_wp_tool.ainvoke({"work_package_id": wp_id, "project_path": project_path})
            # Parse response (same pattern as supervisor._call_tool)
            wp_detail = _parse_tool_response(raw)
            if isinstance(wp_detail, dict):
                # Find the most recently completed pipeline
                pipelines = wp_detail.get("pipelines", [])
                if pipelines:
                    latest = pipelines[-1]
                    # Duration from pipeline timestamps (server-side computed)
                    pipeline_duration_s = None
                    if latest.get("duration_ms") is not None:
                        pipeline_duration_s = round(latest["duration_ms"] / 1000, 1)
                    pipeline_detail = {
                        "timestamp": datetime.now(UTC).isoformat(),
                        "stage": stage,
                        "wp_id": wp_id,
                        "action": "pipeline_result",
                        "level": "INFO",
                        "pipeline_type": latest.get("type", ""),
                        "pipeline_status": latest.get("status", ""),
                        "files_modified": (latest.get("artifacts") or {}).get("files_modified", []),
                        "metrics": latest.get("metrics"),
                        "summary": latest.get("summary", []),
                        "duration_s": pipeline_duration_s,  # From MCP server
                    }
    except Exception:
        log.debug("Could not read back WP detail for pipeline_result event", exc_info=True)
```

This is best-effort — if the read fails, no `pipeline_result` event is
emitted, and the stage still completes normally.

Extract `_parse_tool_response` as a shared helper in `orchestrator/src/utils/` (reuse the same logic from
supervisor's `_call_tool`).

### 4. Add WP-status-change detection and `progress_snapshot` to supervisor

In `supervisor.py`, after fetching `wp_summaries` and before the routing logic:

**a) Detect WP status changes:**

```python
prev_summaries = state.get("prev_wp_summaries", [])
prev_status_map = {wp["id"]: wp.get("status") for wp in prev_summaries}

for wp in wp_summaries:
    wp_id = wp.get("id", "")
    new_status = wp.get("status", "")
    old_status = prev_status_map.get(wp_id)
    if old_status is not None and old_status != new_status:
        change_entry = _log_entry(
            stage="supervisor", wp_id=wp_id,
            action="wp_status_change",
            destination="",
            old_status=old_status, new_status=new_status,
        )
        # run_logger.stream_entry(change_entry)
        # append to extra_log_entries

        # Dedicated wp_complete event
        if new_status == "COMPLETE":
            # Could read WP detail here for acceptance criteria, or just note it
            complete_entry = _log_entry(
                stage="supervisor", wp_id=wp_id,
                action="wp_complete",
                destination="",
            )
            # run_logger.stream_entry(complete_entry)
```

**b) Emit progress snapshot (with elapsed time):**

```python
# Aggregate WP status counts
status_counts = {}
for wp in wp_summaries:
    s = wp.get("status", "UNKNOWN")
    status_counts[s] = status_counts.get(s, 0) + 1

# Elapsed time since run start
elapsed_s = None
run_start_ts = state.get("run_start_ts", "")
if run_start_ts:
    try:
        elapsed_s = round(
            (datetime.now(UTC) - datetime.fromisoformat(run_start_ts)).total_seconds(), 1
        )
    except (ValueError, TypeError):
        pass

snapshot_entry = _log_entry(
    stage="supervisor", wp_id="", action="progress_snapshot", destination="",
    total_wps=len(wp_summaries),
    status_breakdown=status_counts,
    pending=pending_count,
    wps_completed_this_run=state.get("wps_completed_this_run", 0),
    iteration=new_iteration,
    max_iterations=max_iterations,
    elapsed_s=elapsed_s,
)
```

**c) Store previous WP summaries in base_update:**

```python
base_update["prev_wp_summaries"] = wp_summaries  # for next iteration's diff
```

### 5. Enrich `route` events with previous-stage context

In the supervisor, when building `route` log entries, include:

```python
log_entry = _log_entry(
    stage="supervisor",
    wp_id=wp_id,
    action="route",
    destination=destination,
    agent_role=role,
    ledger_action=action,
    # NEW: context from the stage that just completed
    prev_stage=state.get("current_stage", ""),
    prev_wp_id=prev_wp_id,
    prev_result="PASS" if prev_success else "FAIL" if prev_wp_id else "",
)
```

### 6. Add `rework_detected` event

In the supervisor's role-iteration loop, when the ledger action is `"REWORK"`,
emit a dedicated event:

```python
if action == "REWORK":
    rework_entry = _log_entry(
        stage="supervisor", wp_id=wp_id,
        action="rework_detected",
        destination=destination,
        agent_role=role,
        pipeline_type=action_data.get("pipeline_type", ""),
        rework_count=action_data.get("rework_count"),
    )
    if run_logger:
        run_logger.stream_entry(rework_entry)
    extra_log_entries.append(rework_entry)
```

### 7. Enhance console output formatting

In `WorkflowLogger.stream_entry`, add richer formatting for new event types:

| Event | Console output |
|-------|---------------|
| `stage_start` | `[developer] WP-003 ▶ stage_start` |
| `stage_complete` | `[developer] WP-003 stage_complete → PASS (3m 24s, 1850 tokens)` |
| `wp_status_change` | `[supervisor] WP-003 status: IN_PROGRESS → COMPLETE` |
| `wp_complete` | `[supervisor] ✓ WP-003 COMPLETE` |
| `progress_snapshot` | `[supervisor] Progress: 3/5 WPs done · 2 in-progress · iter 12/100 · 14m 32s elapsed` |
| `pipeline_result` | `[developer] WP-003 pipeline: PASS · 4 files modified · 3m 24s` |
| `rework_detected` | `[supervisor] ⟳ WP-003 rework #2 (qa → developer)` |

### 8. Update JSONL schema documentation

Update `orchestrator/docs/jsonl-log-schema.md` to document all 6 new event
types, the enriched `route`/`stage_complete`/`run_start`/`run_end` fields,
and the `duration_s` / `elapsed_s` / `total_duration_s` conventions.

### 9. MCP server — compute and store `duration_ms` on pipeline completion

In `mcp-server/src/tools/pipeline.ts`, inside the `ledger_complete_pipeline`
handler, after setting `pipeline.completed_at = now()`:

```typescript
// Compute duration if started_at is available
if (pipeline.started_at) {
  const startMs = new Date(pipeline.started_at).getTime();
  const endMs = new Date(pipeline.completed_at).getTime();
  if (!isNaN(startMs) && !isNaN(endMs)) {
    pipeline.duration_ms = endMs - startMs;
  }
}
```

Update the `Pipeline` type in `mcp-server/src/schema/work-package.ts` to add:

```typescript
duration_ms?: number;  // Computed: completed_at - started_at (milliseconds)
```

Update the Zod validation schema to accept the optional `duration_ms` field.

> This is a **write-time computation** — no extra reads needed. The value is
> persisted to the JSON file and available to all consumers (GUI, API, future
> analytics) without client-side parsing of ISO strings.

### 10. MCP server GUI — add `formatDuration()` utility

In `mcp-server/gui/public/utils.js`, add a duration formatter:

```javascript
/**
 * Format milliseconds as a human-readable duration string.
 * Examples: "3m 24s", "1h 12m", "45s", "< 1s"
 */
function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return '< 1s';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');
  if (seconds > 0 && hours === 0) parts.push(seconds + 's');
  return parts.join(' ') || '< 1s';
}
```

### 11. MCP server GUI — display pipeline duration on WP detail view

In `mcp-server/gui/public/views/work-package.js`, where pipeline items are
rendered (the line showing `Started:` / `Completed:` timestamps), add the
computed duration:

```javascript
// Existing: 'Started: ' + formatDate(p.started_at) + ...
// Add after completed_at display:
if (p.duration_ms != null) {
  html += ' &nbsp; <strong>Duration:</strong> ' + formatDuration(p.duration_ms);
}
```

Also show a per-pipeline duration badge next to the status badge:

```javascript
// Next to the PASS/FAIL badge:
if (p.duration_ms != null) {
  html += '<span class="badge badge-neutral">' + formatDuration(p.duration_ms) + '</span>';
}
```

### 12. MCP server GUI — aggregate WP-level timing

In the WP detail header area (above the pipeline list), compute and display
aggregate timing for the work package:

```javascript
// Sum all pipeline durations for this WP (including rework runs)
const totalPipelineDuration = wp.pipelines
  .filter(p => p.duration_ms != null)
  .reduce((sum, p) => sum + p.duration_ms, 0);

// Time from first pipeline start to last pipeline completion
const wpFirstStart = wp.pipelines
  .filter(p => p.started_at)
  .map(p => new Date(p.started_at).getTime())
  .sort((a, b) => a - b)[0];
const wpLastEnd = wp.pipelines
  .filter(p => p.completed_at)
  .map(p => new Date(p.completed_at).getTime())
  .sort((a, b) => b - a)[0];
const wpWallclockDuration = (wpFirstStart && wpLastEnd)
  ? wpLastEnd - wpFirstStart : null;

// Display
html += '<div class="wp-timing">';
html += '<strong>Active time:</strong> ' + formatDuration(totalPipelineDuration);
if (wpWallclockDuration != null) {
  html += ' &nbsp; <strong>Wall-clock:</strong> ' + formatDuration(wpWallclockDuration);
}
html += '</div>';
```

**Two timing metrics per WP:**
- **Active time** = sum of all pipeline `duration_ms` values (actual LLM work
  time, including rework runs)
- **Wall-clock** = elapsed time from first pipeline start to last pipeline
  completion (includes idle time between stages)

### 13. MCP server GUI — project-level timing on project detail view

In `mcp-server/gui/public/views/project-detail.js`, in the project header area
where `Created:` and `Updated:` are already shown:

```javascript
// Elapsed project duration (wall-clock from creation)
const projectCreated = new Date(meta.date_created).getTime();
const projectUpdated = new Date(meta.last_updated).getTime();
if (!isNaN(projectCreated) && !isNaN(projectUpdated)) {
  const projectDuration = projectUpdated - projectCreated;
  html += ' &nbsp; <strong>Duration:</strong> ' + formatDuration(projectDuration);
}
```

For a richer project-level summary, the API response for
`GET /api/projects/:slug` can be extended with a computed `timing` object.
In `mcp-server/gui/api.ts`, when building the project detail response:

```typescript
// Compute aggregate timing from all WPs
let totalActiveDuration = 0;
let pipelineCount = 0;
for (const wp of workPackages) {
  for (const p of wp.pipelines ?? []) {
    if (p.duration_ms != null) {
      totalActiveDuration += p.duration_ms;
      pipelineCount++;
    }
  }
}

response.timing = {
  project_elapsed_ms: updatedAt - createdAt,
  total_active_ms: totalActiveDuration,
  pipeline_runs: pipelineCount,
};
```

Display this on the project detail view:

```
Duration: 2h 45m · Active: 1h 12m across 14 pipeline runs
```

### 14. Update tests

- **Unit tests** for supervisor: assert `wp_status_change`, `progress_snapshot`
  (with `elapsed_s`), `rework_detected`, and enriched `route` entries appear
  in returned `run_log`.
- **Unit tests** for node factory: assert `stage_start` and `stage_complete`
  (with `duration_s`) and `pipeline_result` (with `duration_s`) entries appear
  in returned `run_log`.
- **MCP server tests**: assert `ledger_complete_pipeline` stores `duration_ms`
  on the pipeline object when `started_at` is present.
- **Integration test**: verify new events appear in JSONL output file.

### 15. Update project manifests

- `orchestrator/docs/agents/project-manifest/` — update `api-surface.md` for new
  event types in the logging module, and `data-flows.md` if the flow changes.
- `mcp-server/docs/agents/project-manifest/` — update `api-surface.md` with
  `duration_ms` on Pipeline, and note the enriched GUI API response.

## Dependencies

- `ledger_get_work_package` MCP tool (already exists) — used for `pipeline_result` read-back
- `shared/workflow-manifest.json` — no changes needed (all role/status constants already derived)
- `Pipeline` Zod schema in `mcp-server/src/schema/work-package.ts` — must accept new `duration_ms` field
- GUI static files in `mcp-server/gui/public/` — no build step, changes are immediate

## Required Components

### Modified files

| File | Changes |
|------|---------|
| `orchestrator/src/state.py` | Add `prev_wp_summaries` and `run_start_ts` fields |
| `orchestrator/src/cli.py` | Set `run_start_ts` in initial state; `total_duration_s` in `run_end` |
| `orchestrator/src/supervisor.py` | WP status diff, progress snapshot (with `elapsed_s`), enriched route, rework detection |
| `orchestrator/src/nodes/__init__.py` | `stage_start` event, `duration_s` on `stage_complete`/`stage_error`, `pipeline_result` read-back |
| `orchestrator/src/utils/logging.py` | Enhanced console formatting for new event types (including duration) |
| `orchestrator/docs/jsonl-log-schema.md` | Document new events + duration fields |
| `mcp-server/src/schema/work-package.ts` | Add optional `duration_ms` to `Pipeline` type + Zod schema |
| `mcp-server/src/tools/pipeline.ts` | Compute `duration_ms` in `ledger_complete_pipeline` |
| `mcp-server/gui/public/utils.js` | Add `formatDuration(ms)` utility |
| `mcp-server/gui/public/views/work-package.js` | Show per-pipeline and per-WP aggregate durations |
| `mcp-server/gui/public/views/project-detail.js` | Show project-level elapsed + active duration |
| `mcp-server/gui/api.ts` | Add computed `timing` object to project detail response |
| `orchestrator/tests/test_supervisor.py` | Tests for new supervisor events |
| `orchestrator/tests/test_nodes.py` | Tests for `stage_start`, `duration_s`, `pipeline_result` |
| `mcp-server/tests/tools/` | Tests for `duration_ms` computation in `ledger_complete_pipeline` |

### New files

| File | Purpose |
|------|---------|
| `orchestrator/src/utils/mcp_parse.py` | Shared MCP tool response parser (extracted from supervisor's `_call_tool`) |

## Assumptions

- `ledger_get_work_package` returns pipeline data including `artifacts`,
  `metrics`, and `summary` — confirmed via API surface research.
- The `pipeline_result` read-back adds one extra MCP call per successful stage.
  This is acceptable since MCP calls are fast (local JSON file reads) and the
  data is high-value for observability.
- `ledger_get_next_action` returns `rework_count` or `pipeline_type` fields
  when the action is `REWORK` — to be verified; if not, the `rework_detected`
  event can be emitted with only `wp_id` and `agent_role`.

## Constraints

- All new events must follow the existing JSONL schema conventions: `timestamp`,
  `stage`, `wp_id`, `action`, `level` as core fields; everything else as extras.
- No new LLM calls. Only one new MCP call (`ledger_get_work_package`) per
  successful stage completion.
- `progress_snapshot` must not add measurable latency — it's computed from
  data already in memory.
- Best-effort pattern: if the `pipeline_result` read-back fails, the stage
  still reports success. Never let observability break the pipeline.
- Cross-platform: no OS-specific code (all changes are pure Python dict
  operations, JSON serialization, and browser JavaScript).
- `duration_ms` is a write-time computation in the MCP server — no extra reads
  or API calls required.
- GUI changes are vanilla JS (no build step). Must work in all modern browsers.
- Duration formatting must gracefully handle `null`, `undefined`, and negative
  values (display "—").

## Out of Scope

- Real-time WebSocket/SSE streaming to external dashboards (future work)
- Git integration (auto-detecting modified files via `git diff`)
- Per-token cost estimation (would require model pricing data)
- Historical timing trends / charting (the raw data is stored; visualization
  can be added later)
- Modifying the CLI's end-of-run summary to use the new events (natural
  follow-up but not required here)

## Acceptance Criteria

### Orchestrator JSONL events
- `stage_start` event is emitted before every Deep Agent invocation and
  appears in the JSONL log
- `stage_complete` and `stage_error` events include a `duration_s` field
  representing wallclock seconds for the stage execution
- `wp_status_change` events fire whenever a WP's status differs between
  consecutive supervisor iterations
- `progress_snapshot` is emitted on every supervisor iteration with accurate
  counters and `elapsed_s` (seconds since run start)
- `pipeline_result` is emitted after successful stage completions when the
  WP has pipeline data (files_modified, metrics, summary, duration_s)
- `wp_complete` fires when a WP transitions to COMPLETE
- `rework_detected` fires when the supervisor dispatches a REWORK action
- `route` events include `prev_stage`, `prev_wp_id`, and `prev_result` fields
- `run_start` includes `run_start_ts`; `run_end` includes `total_duration_s`
- Console output (stderr) shows human-readable formatted lines for all new
  event types, including formatted durations

### MCP server
- `ledger_complete_pipeline` computes and stores `duration_ms` on the pipeline
  object when `started_at` is present
- `Pipeline` schema accepts optional `duration_ms` (number)
- Project detail API response includes a `timing` object with
  `project_elapsed_ms`, `total_active_ms`, and `pipeline_runs`

### GUI
- Work package detail view shows duration next to each pipeline's
  status badge and in the timestamps area
- Work package detail view shows aggregated "Active time" and "Wall-clock"
  durations in the WP header
- Project detail view shows project duration and aggregate active time
- `formatDuration()` correctly handles edge cases (null, < 1s, hours)

### Tests & docs
- All new events are documented in `orchestrator/docs/jsonl-log-schema.md`
- Existing tests continue to pass
- New tests cover each new event type and `duration_ms` computation

## Testing Strategy

- **Unit tests (supervisor):** Mock `_call_tool` to return controlled WP lists
  across iterations. Assert that `wp_status_change`, `progress_snapshot`
  (with `elapsed_s`), `rework_detected`, and enriched `route` entries appear
  in the returned `run_log` with correct fields.
- **Unit tests (node factory):** Mock Deep Agent and MCP tools. Assert
  `stage_start` appears at the start, `stage_complete` includes `duration_s`,
  and `pipeline_result` appears after completion with `duration_s`. Test the
  best-effort fallback when `ledger_get_work_package` fails.
- **Unit tests (MCP server):** Call `ledger_complete_pipeline` on a pipeline
  with a known `started_at`. Assert `duration_ms` is computed correctly and
  stored on the pipeline. Test edge cases: missing `started_at`, invalid
  dates.
- **Integration test:** Run a dry-run (or minimal real run) and parse the
  JSONL output file to verify new event types are present and well-formed,
  and that `duration_s` / `total_duration_s` are positive numbers.
- **GUI manual test:** Open the GUI, navigate to a project with completed
  pipelines, and verify durations appear per-pipeline, per-WP, and per-project.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`pipeline_result` read-back adds latency** | It's a single local JSON file read via MCP (~ms). Acceptable for the data quality gain. |
| **`ledger_get_next_action` may not return `rework_count`** | Emit `rework_detected` with available fields only; omit `rework_count` if absent. |
| **Large WP lists make `progress_snapshot` verbose** | Only emit aggregate counters, not per-WP detail. Full WP list is already in `wp_summaries` state field. |
| **Console output becomes noisy** | New events use concise single-line formatting. `progress_snapshot` is the densest at ~80 chars. |
| **State size growth from `prev_wp_summaries`** | WP summaries are small dicts (id + status + title). Even 50 WPs is < 5KB. Negligible. |
| **Breaking existing JSONL consumers** | All new events are additive — existing event types and fields are unchanged. Consumers that filter by `action` are unaffected. |
| **`duration_ms` precision on very fast pipelines** | Sub-second pipelines report `duration_ms < 1000`. `formatDuration()` renders these as "< 1s". |
| **Old pipeline data has no `duration_ms`** | GUI uses `if (p.duration_ms != null)` guard — omits duration display for pre-existing pipelines. `formatDuration(null)` returns "—". Backward-compatible. |
| **Clock skew between orchestrator and MCP server** | `duration_ms` is computed server-side from its own timestamps — no cross-process clock dependency. Orchestrator's `duration_s` uses its own monotonic wallclock. |
