# Plan

## Summary

The orchestrator's CLI (`orchestrator/src/cli.py`) unconditionally imports `fcntl` — a Unix-only standard-library module — at module scope. This crashes the entire CLI on Windows with `ModuleNotFoundError: No module named 'fcntl'`, blocking all orchestrator usage on that platform. The fix introduces a small cross-platform file-locking helper that uses `fcntl.flock` on Unix and `msvcrt.locking` on Windows, keeping the concurrent-run protection fully functional on both platforms.

## Architectural Context

- **Affected file:** `orchestrator/src/cli.py` — the single CLI entry point (`orchestrate` console script).
- **`fcntl` usage locations:**
  - Line 31: unconditional `import fcntl` at module scope.
  - ~Line 416: `fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)` to acquire a non-blocking exclusive lock.
  - ~Line 552: `fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)` to release the lock.
- **Purpose of the lock:** Prevents concurrent orchestrator runs against the same plan directory by taking an exclusive lock on `<plan_dir>/.orchestrator.lock`.
- **Utility layer:** `orchestrator/src/utils/` contains small focused modules (`logging.py`, `persona.py`, `plan_parser.py`, `tool_wrappers.py`). A new file-lock utility fits this pattern.
- **Test file:** `orchestrator/tests/test_cli.py` already imports `platform` and `sys` (lines 17-18), so platform-aware test helpers are natural.
- **No existing tests** cover the locking behaviour.

## Approach / Architecture

Rather than skipping locking on Windows (a no-op guard), implement a proper **cross-platform file lock** using only stdlib modules:

| Platform | Module | Lock API |
|----------|--------|----------|
| Unix/macOS | `fcntl` | `fcntl.flock(fd, LOCK_EX \| LOCK_NB)` / `fcntl.flock(fd, LOCK_UN)` |
| Windows | `msvcrt` | `msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)` / `msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)` |

A new utility module `orchestrator/src/utils/filelock.py` will expose two functions:

```python
def lock_exclusive(fd: int) -> None: ...   # raises OSError on contention
def unlock(fd: int) -> None: ...           # best-effort release
```

`cli.py` replaces all `fcntl` references with calls to `lock_exclusive` / `unlock` from the new module. The `import fcntl` line is removed entirely from `cli.py`.

### Why not a no-op on Windows?

The locking prevents genuine corruption scenarios (two terminals running the orchestrator against the same plan). `msvcrt.locking` is a stdlib module available on all Windows Python installs, so there is zero extra dependency cost to provide real cross-platform protection.

## Rationale

- **OS-agnostic by default.** Both `fcntl` and `msvcrt` are stdlib; no third-party packages needed.
- **Single responsibility.** Isolating the lock logic in `filelock.py` keeps `cli.py` focused on orchestration flow and makes the lock testable independently.
- **Consistent with existing patterns.** The `orchestrator/src/utils/` directory already groups small focused utilities (`logging.py`, `persona.py`, etc.).
- **No behavioural change on Unix.** Existing macOS/Linux users see identical locking semantics.

## Detailed Steps

### 1. Create `orchestrator/src/utils/filelock.py`

**New file.** Implement the cross-platform locking helper:

```python
"""Cross-platform file locking (Unix fcntl / Windows msvcrt)."""
from __future__ import annotations

import sys

if sys.platform == "win32":
    import msvcrt

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention."""
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

    def unlock(fd: int) -> None:
        """Release the lock."""
        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention."""
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def unlock(fd: int) -> None:
        """Release the lock."""
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
```

Key design points:
- Platform branch is at module scope (import time), so the correct implementation is selected once.
- Both branches expose identical signatures: `lock_exclusive(fd)` and `unlock(fd)`.
- Both raise `OSError` on contention, matching the existing `except OSError` handler in `cli.py`.
- `unlock` swallows `OSError` internally to keep the release best-effort (matching current behavior).

### 2. Update `orchestrator/src/cli.py` — remove `import fcntl`

Replace:
```python
import fcntl
```
with:
```python
from src.utils.filelock import lock_exclusive, unlock
```

### 3. Update `orchestrator/src/cli.py` — acquire block (~line 416)

Replace:
```python
fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
```
with:
```python
lock_exclusive(lock_file.fileno())
```

### 4. Update `orchestrator/src/cli.py` — release block (~line 552)

Replace:
```python
fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
```
with:
```python
unlock(lock_file.fileno())
```

### 5. Add unit tests for the new `filelock` module

Create `orchestrator/tests/test_filelock.py`:

- **`test_lock_exclusive_succeeds`** — Open a temp file, call `lock_exclusive(fd)`, assert no exception, then `unlock(fd)`.
- **`test_lock_exclusive_contention_raises`** — Lock a file, then attempt `lock_exclusive` from within the same process against a second fd (on Unix `flock` is per-fd, so open the same file twice; on Windows `msvcrt.locking` is per-byte). Assert `OSError` is raised.
- **`test_unlock_is_idempotent`** — Call `unlock(fd)` on an unlocked fd; assert no exception (the function swallows `OSError`).

### 6. Run existing test suite

Execute `pytest orchestrator/tests/` to verify no regressions. The existing `test_cli.py` tests should continue to pass since they test argument parsing and summary printing, not locking.

### 7. Manual smoke test on Windows

```powershell
cd orchestrator
.venv\Scripts\Activate.ps1
orchestrate --version
```

This should now succeed instead of crashing with `ModuleNotFoundError`.

## Dependencies

- No new external dependencies. `msvcrt` is part of the Python standard library on Windows. `fcntl` is part of the Python standard library on Unix.

## Required Components

- **New file:** `orchestrator/src/utils/filelock.py` — cross-platform lock/unlock functions
- **New file:** `orchestrator/tests/test_filelock.py` — unit tests for the above
- **Modified file:** `orchestrator/src/cli.py` — remove `import fcntl`, use new utility

## Assumptions

- `msvcrt.locking` with `LK_NBLCK` on a 1-byte range is sufficient for advisory process-level locking on Windows (it is — this is the standard pattern).
- The orchestrator is never invoked concurrently against the same plan via multiple processes on Windows in any regular workflow (the lock is a safety net, not a critical synchronization primitive).

## Constraints

- **No new dependencies.** Only stdlib modules may be used.
- **No behavioral change on macOS/Linux.** `fcntl.flock` semantics must be preserved exactly.
- **Module must remain importable on both platforms.** The top-level `import fcntl` in `cli.py` is the root cause; the fix must ensure no platform-specific import at module scope in `cli.py`.

## Out of Scope

- Implementing a full-featured lock manager (e.g., timeout, retry, blocking mode).
- Adding `portalocker` or any third-party locking library.
- Addressing any other Windows compatibility issues beyond `fcntl`.

## Acceptance Criteria

- `orchestrate --version` completes without error on Windows.
- `orchestrate <plan> --dry-run` runs on Windows without `ModuleNotFoundError`.
- `pytest orchestrator/tests/` passes on both Windows and Unix with zero new failures.
- New `test_filelock.py` tests pass on the current platform.
- No `import fcntl` remains in `orchestrator/src/cli.py`.

## Testing Strategy

- **Unit tests:** New `test_filelock.py` validates `lock_exclusive`, `unlock`, and contention handling on the current platform.
- **Regression tests:** Existing `test_cli.py` suite runs unmodified.
- **Manual smoke:** `orchestrate --version` on a Windows machine confirms the import crash is resolved.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`msvcrt.locking` semantics differ from `fcntl.flock`** (byte-range vs. whole-file) | Locking 1 byte is sufficient for an advisory process lock; the lock file is a dedicated sentinel, not shared data. Both raise `OSError` on contention. |
| **Tests on CI may only run on one platform** | The `filelock.py` module uses a platform branch at import time, so the correct branch is always tested on whatever platform runs the suite. Tests should be written to be platform-agnostic. |
| **`msvcrt.locking` requires seeking to position 0** | The file is freshly opened for writing, so the position is already 0. No seek needed. |
