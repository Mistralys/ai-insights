# Implementation Audit Report

## Work Under Review
- **Plan/Implementation:** [docs/agents/plans/2026-05-06-orchestrator-gui-error-surfacing/plan.md](plan.md)
- **Date:** 2026-05-06
- **Auditor:** Plan Auditor Agent

## Verdict: PASS WITH FINDINGS

### Summary
The fix is correct, well-targeted, and solves the diagnosed root cause. The hash
algorithm is consistent between the Python and TypeScript sides, the closure
captures are sound, and the early-exit paths now correctly write error status
files. Two minor findings around code quality and missing test coverage warrant
follow-up but do not block the fix.

### Finding Counts
- **Critical:** 0
- **Major:** 0
- **Minor:** 3

---

## Findings

### Critical

_None._

### Major

_None._

### Minor

| # | Category | Finding | Location | Recommendation |
|---|----------|---------|----------|----------------|
| 1 | Code Quality | `_write_error_status()` uses `open(_run_status_path, "w")` passed directly to `json.dump()` without a `with` statement or explicit `.close()`. The file handle is only closed when the garbage collector reclaims the temporary object. On CPython this is immediate (refcount), but on PyPy or future Python runtimes it's non-deterministic. The `# noqa: SIM115` suppresses the linter warning rather than fixing it. | `orchestrator/src/cli.py` line 523 | Wrap in `with open(...) as f: json.dump(..., f)` for deterministic resource release. Marginal issue since the function is best-effort and the process typically exits immediately after. |
| 2 | Test Coverage | No unit test covers the new `_write_error_status()` helper or the early-exit status-file writes. The orchestrator test suite (`tests/test_cli.py`) tests `_print_run_summary` but not the run-status tombstone mechanism. | `orchestrator/tests/test_cli.py` | Consider adding a test that simulates the lock-held early exit and asserts a valid JSON status file is written to the expected path. Low urgency given this is a best-effort mechanism. |
| 3 | Documentation | No changelog entry in `orchestrator/changelog.md` for this bug fix. | `orchestrator/changelog.md` | Add a bullet under the next version: `- CLI: Fixed GUI error-surfacing for early-exit paths (lock-held, resume-terminal) that left the UI hanging.` |

---

## Verification Evidence

### Hash Algorithm Consistency ✓
- **Python** (`cli.py` line 498–500): `hashlib.sha1(str(plan_path).encode("utf-8")).hexdigest()[:16]`
- **TypeScript** (`orchestrator-manager.ts` line 762): `createHash('sha1').update(resolvedPlanPath).digest('hex').slice(0, 16)`
- Both receive the same resolved absolute plan path (TS resolves it before spawning, Python receives it as `args.plan` and re-resolves).
- Node.js `createHash('sha1').update(string)` defaults to UTF-8 encoding, matching Python's explicit `.encode("utf-8")`.

### Closure Captures ✓
- `_run_status_path` defined at line 500 (before the function definition at line 511). ✓
- `plan_dir` defined at line 506 (before the function definition at line 511). ✓
- The `plan-not-found` exit at line 502 returns BEFORE `plan_dir` is defined, and `_write_error_status` is not called on that path. ✓

### GUI Polling Integration ✓
- GUI requests start → receives `runStatusFilename` in the response (line 901 of `orchestrator-manager.ts`).
- GUI polls `GET /api/orchestrator/run-status/:filename` every 2s up to 15 times (30s window).
- API validates filename against allowlist regex `/^[0-9a-f]{16}-run-status\.json$/`. ✓
- If status file contains `result: "ERROR"`, GUI shows error banner. ✓

### Lock-Held Path ✓
- `_write_error_status` called at line 544 (before entering the inner `try` block).
- Lock file handle is closed immediately before the call (line 542–543). ✓
- The stale-file deletion at line 557 only runs for successful lock acquisition — no conflict. ✓

### Resume-Terminal Path ✓
- `_write_error_status` called at line 577 (inside the inner `try` block).
- `finally` at line 812 handles lock cleanup on this return. ✓
- `logFilename` defaults to `""` — correct since no JSONL log exists yet for this path. ✓

---

## Recommended Follow-Up Work

| Priority | Task | Rationale |
|----------|------|-----------|
| Low | Refactor `_write_error_status` to use `with` statement | Deterministic file handle cleanup, removes the `# noqa` suppression. |
| Low | Add a unit test for the early-exit status-file write | Regression protection; verifiable with a simple mock of the lock acquisition. |
| Normal | Add changelog entry for orchestrator v0.18.1 (or next) | Keeps the changelog current for the release engineer. |
| Optional | Consider writing error status on the `plan-not-found` path too | Currently unreachable from the GUI, but would make the mechanism robust against future direct CLI invocations from other tools. |
