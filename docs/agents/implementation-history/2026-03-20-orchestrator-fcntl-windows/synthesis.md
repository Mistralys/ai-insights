# Project Synthesis Report

**Plan:** 2026-03-20-orchestrator-fcntl-windows  
**Date:** 2026-03-20  
**Status:** COMPLETE  

---

## Executive Summary

The orchestrator CLI (`orchestrator/src/cli.py`) unconditionally imported the Unix-only `fcntl` module at module scope, crashing the entire CLI on Windows with `ModuleNotFoundError: No module named 'fcntl'`. This session delivered a clean, self-contained fix across three work packages:

1. **WP-001** — Created `orchestrator/src/utils/filelock.py`, a stdlib-only cross-platform file-lock utility (`fcntl.flock` on Unix, `msvcrt.locking` on Windows), replaced all `fcntl` call sites in `cli.py`, and added a dedicated test module.
2. **WP-002** — Verified complete removal of `import fcntl` from `cli.py` and confirmed `orchestrate --version` succeeds on Windows without `ModuleNotFoundError`.
3. **WP-003** — Validated the full test suite (287 tests) on Windows and confirmed the three new `test_filelock.py` tests cover all required paths.

All 14 acceptance criteria across the three WPs are met. The orchestrator is now fully functional on Windows.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 3 / 3 COMPLETE |
| Pipeline stages | 12 / 12 PASS (implementation → qa → code-review → documentation × 3 WPs) |
| Total tests passed | 287 |
| Total tests failed | 0 |
| Tests skipped | 1 (pre-existing, unrelated) |
| New tests added | 3 (TestLockExclusiveSucceeds, TestLockExclusiveContention, TestUnlockIdempotent) |
| Pre-existing warnings | 27 (aiosqlite event-loop teardown + LangGraph RunnableConfig typing — unrelated, pre-existing) |
| New regressions | 0 |
| Third-party dependencies added | 0 |

---

## Files Modified

| File | Change |
|------|--------|
| `orchestrator/src/utils/filelock.py` | **Created** — cross-platform lock_exclusive / unlock using fcntl (Unix) and msvcrt (Windows) |
| `orchestrator/src/cli.py` | Removed `import fcntl`; added module-scope import of `lock_exclusive, unlock`; replaced both fcntl call sites |
| `orchestrator/tests/test_filelock.py` | **Created** — 3 unit tests (happy path, contention, idempotent unlock) |
| `orchestrator/docs/public-api.md` | Added lock_exclusive(fd) and unlock(fd) to the Utilities table; documented FP invariant and non-re-entrancy |
| `orchestrator/README.md` | Added test_filelock.py row to Running Tests table; updated test count from 269 → 287; added 'cross-platform file locking' to src/utils/ description |
| `orchestrator/changelog.md` | Added v0.6.0 entry documenting the Windows cross-platform fix |

---

## Strategic Recommendations (Gold Nuggets)

### 1. msvcrt.locking Non-Re-Entrancy Asymmetry (Medium Priority)
`msvcrt.locking` on Windows raises `OSError(EACCES)` if `lock_exclusive` is called twice on the same fd without an intervening `unlock`. In contrast, `fcntl.flock` on Linux is re-entrant (subsequent calls on the same fd upgrade/replace the lock silently). The current caller never double-locks, but this platform asymmetry is a latent trap for future callers. The docstring in `filelock.py` should be updated to include a "Not re-entrant: do not call lock_exclusive twice on the same fd without an intervening unlock" warning.

### 2. File-Pointer Invariant Is Undocumented at the Call Site (Low Priority)
`msvcrt.locking` locks bytes at the current file pointer position. The FP=0 invariant is maintained because `cli.py` opens the lock file in `'w'` mode and never writes to it. This is correct but relies on undocumented caller discipline. A defensive `os.lseek(fd, 0, os.SEEK_SET)` inside the Windows `lock_exclusive()` implementation would make the module self-enforcing and safe for future callers opening in `'a'` (append) mode.

### 3. Lazy-Import Pattern in cli.py Has an Exception (Low Priority)
All other `from src.*` imports in `cli.py` are lazy (inside function bodies) to keep fast-exit paths like `--version` from loading heavy LangGraph/MCP modules. The new `from src.utils.filelock import lock_exclusive, unlock` is at module scope — an intentional and correct exception, since filelock is extremely lightweight (stdlib only). However, this inconsistency is a maintenance signal: a future pass should audit all lazy imports in `cli.py` and either document the pattern explicitly or standardize it.

### 4. Hardcoded Test Count in README Will Drift (Low Priority)
`orchestrator/README.md` contains a hardcoded test count comment (287). As tests are added this will go stale. Consider replacing it with a dynamic badge (e.g., via pytest-badge or GitHub Actions status) or removing the count altogether in favour of `pytest tests/ -v` instructions.

### 5. Lock-Release-Reacquire Cycle Not Tested (Low Priority)
`test_filelock.py` covers acquire, contention, and idempotent unlock. A lock-release-reacquire cycle test (lock → unlock → lock again on the same fd) would increase confidence that `LK_UNLCK` fully releases the byte on Windows so `LK_NBLCK` can be re-acquired. Not required, but a low-cost addition for a future polish pass.

---

## Next Steps

| Priority | Action |
|----------|--------|
| Medium | Update `filelock.py` Windows `lock_exclusive` docstring with explicit non-re-entrancy warning (`unlock` docstring too) |
| Low | Add `os.lseek(fd, 0, os.SEEK_SET)` inside Windows `lock_exclusive` as a defensive FP guard |
| Low | Audit and document (or normalize) the lazy-import pattern in `cli.py` |
| Low | Add lock-release-reacquire cycle test to `test_filelock.py` |
| Low | Replace hardcoded test count in `orchestrator/README.md` with dynamic badge or remove it |
