# Plan

## Summary

Fix the orchestrator GUI error-surfacing mechanism so that when a run started
from the GUI fails before appearing in the run queue, the error is shown to the
user instead of leaving the UI stuck at "Waiting for the run to appear in the
queue below…" forever.

## Root Cause (Diagnosed)

The status-file tombstone mechanism (Python writes, GUI polls) was already
implemented and works correctly for the **normal error path** (e.g., invalid
API key causing a `fatal_error` in the graph state). However, the mechanism
failed for **early-exit paths** in `_run()`:

1. The `_run_status_path` variable was computed INSIDE the outer try block
   (line ~530), AFTER lock acquisition.
2. If a prior failed run left a **stale lock file**, subsequent GUI-launched
   runs would hit the lock-held early exit (line ~514) — BEFORE
   `_run_status_path` was ever defined — and could never write a status file.
3. The GUI polled for 30 s, found nothing, and timed out silently.

**Cascade:** First run fails (e.g. network timeout) → leaves stale lock →
all subsequent GUI runs exit at lock check → no status file → GUI hangs.

## Fix Applied

Three changes to `orchestrator/src/cli.py`:

1. **Moved status path computation to earliest possible point** — immediately
   after `plan_path` is resolved, before the plan-not-found check and before
   lock acquisition. Uses `Path(__file__).resolve().parent.parent / "logs"`
   (deterministic, no dependency on `WorkflowLogger`).

2. **Added `_write_error_status()` helper** — best-effort function that writes
   a minimal ERROR status file. Called at:
   - Lock-held early exit
   - Resume-terminal early exit
   (The plan-not-found exit is harmless because the GUI preflight already
   validates plan existence, but the status path IS in scope there for future
   use if needed.)

3. **Broadened exception handler** for the main status file write from
   `except (OSError, AttributeError)` to `except Exception` — ensures no
   unexpected exception type silently prevents the write.

## Files Changed

- `orchestrator/src/cli.py` — All three changes above

## Follow-Up Work (from Audit)

### 1. Fix file handle leak in `_write_error_status()` (Low priority)

**File:** `orchestrator/src/cli.py` line 523

The helper passes a bare `open()` to `json.dump()` without closing the handle.
On CPython the refcount GC closes it immediately, but this is non-deterministic
on other runtimes and suppresses a linter warning with `# noqa: SIM115`.

**Action:** Replace:

```python
_wes_json.dump(
    {...},
    open(_run_status_path, "w"),  # noqa: SIM115
)
```

With:

```python
with open(_run_status_path, "w") as f:
    _wes_json.dump({...}, f)
```

Remove the `# noqa: SIM115` comment.

---

### 2. Add unit test for early-exit status-file writes (Low priority)

**File:** `orchestrator/tests/test_cli.py`

No test covers the new `_write_error_status()` helper or the early-exit paths
that call it. A regression test should:

- Simulate the lock-held early exit (create a locked `.orchestrator.lock` file).
- Assert a valid JSON file is written to `logs/{hash}-run-status.json`.
- Assert the JSON contains `"result": "ERROR"` and a non-empty `"error"` string.

---

### 3. Add changelog entry (Normal priority)

**File:** `orchestrator/changelog.md`

Add under the next version heading (e.g. `## v0.18.1`):

```
- CLI: Fixed GUI error-surfacing for early-exit paths (lock-held, resume-terminal)
  that left the UI hanging indefinitely.
```

---

### 4. (Optional) Write error status on plan-not-found path

**File:** `orchestrator/src/cli.py` line 502

Currently the `plan-not-found` exit returns without writing a status file. This
is unreachable from the GUI (preflight validates plan existence), but adding a
`_write_error_status(...)` call there would make the mechanism robust if other
tools invoke the CLI directly in the future.

**Action:** After `sys.stderr.write(...)` and before `return EXIT_ERROR`, add:

```python
_write_error_status(f"Plan file not found: {plan_path}")
```

Note: `plan_dir` is not yet defined at that point — the helper would need to
use `plan_path.parent.name` as the slug, or accept the slug as a parameter.
Consider whether this complexity is warranted for a currently-unreachable path.
