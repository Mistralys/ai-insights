# Plan

## Summary

Follow-up hardening and cleanup plan addressing all actionable items from the
strategic recommendations and known issues identified in the stream-retry
synthesis. Covers input validation gaps in `config.py`, test organisation
improvements, minor code modernisation, and style normalisation — all scoped
to the orchestrator sub-project.

## Architectural Context

The stream-retry feature was delivered across three source files and five test
files in the orchestrator:

- [orchestrator/src/config.py](../../../../../../orchestrator/src/config.py) —
  `Config` dataclass and `load_config()` function. Two retry-related fields
  (`stream_max_retries`, `stream_retry_base_delay_s`) are parsed from env vars
  with defaults defined as function-local variables (lines 410, 421). A
  module-level constant pattern already exists (`_CAPTURE_DIALOGUES_FALSY` at
  line 188). No `math.isfinite()` guard exists for the float field.
- [orchestrator/src/nodes/__init__.py](../../../../../../orchestrator/src/nodes/__init__.py) —
  `_is_fatal_error()` and `_is_retryable_api_error()` error classifiers, and
  the `_accumulate_stream()` retry loop. Both chain-walking functions lack a
  `visited` set for `__context__` cycles. `run_logger` guards use mixed
  `is not None` (line 529) vs truthy (lines 647, 725, 830, 912, 928, 957) form.
- [orchestrator/src/utils/chunk_writer.py](../../../../../../orchestrator/src/utils/chunk_writer.py) —
  `ChunkWriter.delete()` uses explicit `except FileNotFoundError: pass`
  instead of `Path.unlink(missing_ok=True)` (line 199).
- [orchestrator/tests/test_nodes.py](../../../../../../orchestrator/tests/test_nodes.py) —
  `TestIsRetryableApiError` (16 tests, line 1868) lives alongside 19 unrelated
  test classes.
- [orchestrator/tests/test_stream_retry.py](../../../../../../orchestrator/tests/test_stream_retry.py) —
  Module docstring (line 3) references only "WP-004" but the file now covers
  WP-004, WP-009, and WP-010.
- [orchestrator/tests/test_streaming_capture.py](../../../../../../orchestrator/tests/test_streaming_capture.py) —
  Three inline `_TrackingChunkWriter` stub classes at lines 446, 485, 519.

## Approach / Architecture

All changes are internal refactors or hardening — no new features, no API
changes, no new dependencies. The work is organised into seven independent
steps that can be sequenced in any order. Each step is atomic and testable
in isolation.

## Rationale

These items were flagged across four independent pipeline stages (QA, Security,
Review, Synthesis) during the stream-retry delivery. Addressing them now
prevents the `nan`/`inf` input validation gap from becoming a production issue
and improves long-term maintainability of the test suite.

## Detailed Steps

### Step 1 — Add `_parse_positive_float()` utility to `config.py`

*Addresses: Strategic Recommendation 1, Known Issue 1.*

Create a private function:

```python
def _parse_positive_float(raw: str, default: float) -> float:
```

- Parse `raw` as `float`.
- Reject negative values, `nan`, and `inf` via `math.isfinite()`.
- Return `default` on any validation failure (empty string, non-numeric,
  negative, non-finite).
- Replace the inline `stream_retry_base_delay_s` parsing block (lines 421–428)
  with a single call to the new utility.
- Position the function near `_CAPTURE_DIALOGUES_FALSY` (module level, before
  `load_config()`).

**Files:** `orchestrator/src/config.py`

### Step 2 — Add upper ceiling on `STREAM_MAX_RETRIES`

*Addresses: Known Issue 2.*

In `load_config()`, after parsing `stream_max_retries`, clamp the value to a
reasonable maximum (10). If the parsed value exceeds the ceiling, log a warning
and use the ceiling value. This prevents `2^attempt` overflow and near-infinite
run times from misconfigured env vars.

Define `_MAX_STREAM_RETRIES_CEILING = 10` at module level.

**Files:** `orchestrator/src/config.py`

### Step 3 — Hoist config default constants to module level

*Addresses: Strategic Recommendation 4.*

Move `_DEFAULT_STREAM_MAX_RETRIES` and `_DEFAULT_STREAM_RETRY_BASE_DELAY_S`
from inside `load_config()` to module level (near `_CAPTURE_DIALOGUES_FALSY`
at line 188). This:
- Eliminates duplication with the dataclass field defaults.
- Makes the defaults importable for test assertions.
- Follows the established pattern in the same file.

Reference the module-level constants in both the dataclass field defaults and
the `load_config()` fallback branches.

**Files:** `orchestrator/src/config.py`

### Step 4 — Add `__context__` cycle guard to exception chain walkers

*Addresses: Known Issue 3.*

Add a `visited: set[int] | None = None` parameter (defaulting to `None`) to
both `_is_fatal_error()` and `_is_retryable_api_error()`. Initialise to an
empty set on the first call, and add `id(exc)` before recursing. Skip the
recursive call if `id(cause)` is already in the set.

This is a defensive hardening against theoretical `__context__` cycles in
Python's implicit exception chaining. No behavioural change for acyclic chains.

**Files:** `orchestrator/src/nodes/__init__.py`

### Step 5 — Use `Path.unlink(missing_ok=True)` in `ChunkWriter.delete()`

*Addresses: Strategic Recommendation 3.*

Replace the explicit `try/except FileNotFoundError: pass` block (line 199) with
the single-line idiomatic form `self._path.unlink(missing_ok=True)`. The project
requires Python 3.11+ so `missing_ok` is available. Keep the outer `except
OSError` catch-and-log for other filesystem errors.

**Files:** `orchestrator/src/utils/chunk_writer.py`

### Step 6 — Extract `test_error_helpers.py` from `test_nodes.py`

*Addresses: Strategic Recommendation 2.*

Move `TestIsRetryableApiError` (and its helper functions `_exc_with_status` and
`_httpx_transport_error`) from `test_nodes.py` into a new file
`orchestrator/tests/test_error_helpers.py`. This improves discoverability and
keeps `test_nodes.py` focused on stage-node behaviour.

Additionally, add a test for `httpx.HTTPStatusError` with a non-retryable
status code (e.g. 400) to lock the disambiguation invariant: httpx status
errors with a `status_code` attribute are routed through the status-code
branch, not the transport-error branch. This addresses the Reviewer's flagged
specificity gap (Next Step 3 in Synthesis).

**Files:**
- `orchestrator/tests/test_nodes.py` (remove class + helpers)
- `orchestrator/tests/test_error_helpers.py` (new file)

### Step 7 — Fix stale docstrings, normalise guard style, extract shared stub

*Addresses: Known Issues 4, 5, 6; Synthesis Next Step 4.*

7a. **Update `test_stream_retry.py` docstring** (line 3): change "WP-004
acceptance criteria" to "WP-004, WP-009, and WP-010 acceptance criteria".

7b. **Normalise `run_logger` guard style** in `nodes/__init__.py`: change the
single `if run_logger is not None:` (line 529) to `if run_logger:` to match
the five existing truthy-form guards in the same file.

7c. **Extract shared `_TrackingChunkWriter`** in `test_streaming_capture.py`:
replace the three inline stub classes (lines 446, 485, 519) with a single
module-level `_TrackingChunkWriter` class that all three tests share. The class
should track both `close()` and `write_chunk()` calls, and include a `delete()`
method that delegates to `close()`.

**Files:**
- `orchestrator/tests/test_stream_retry.py`
- `orchestrator/src/nodes/__init__.py`
- `orchestrator/tests/test_streaming_capture.py`

## Dependencies

- Steps 1, 2, and 3 all touch `config.py` and should be implemented together
  in sequence to avoid merge conflicts.
- Steps 4, 5, 6, and 7 are independent of each other and of Steps 1–3.

## Required Components

- `orchestrator/src/config.py` (existing)
- `orchestrator/src/nodes/__init__.py` (existing)
- `orchestrator/src/utils/chunk_writer.py` (existing)
- `orchestrator/tests/test_nodes.py` (existing)
- `orchestrator/tests/test_stream_retry.py` (existing)
- `orchestrator/tests/test_streaming_capture.py` (existing)
- `orchestrator/tests/test_error_helpers.py` (**new** — Step 6)

## Assumptions

- The project's minimum Python version remains 3.11+ (confirmed in
  `pyproject.toml` and manifest).
- `_is_fatal_error` has no dedicated tests in `test_nodes.py` — its coverage
  comes from `test_stream_retry.py` integration tests. The move in Step 6
  only affects `_is_retryable_api_error` tests.
- The three `_TrackingChunkWriter` stubs in `test_streaming_capture.py` are
  functionally equivalent enough to share a single implementation.

## Constraints

- No new dependencies.
- No public API changes.
- All changes must pass `pytest` (931 tests expected baseline).
- Cross-platform policy: no OS-specific code introduced.

## Out of Scope

- Tuning the `STREAM_RETRY_BASE_DELAY_S` default (10s) based on production
  observation — requires runtime data.
- Moving `_is_fatal_error` tests (they are coverage-tested via
  `test_stream_retry.py` integration tests and don't warrant relocation).
- Manifest / documentation updates beyond docstring fixes — the orchestrator
  manifest does not currently document retry internals at the level affected
  by these changes.

## Acceptance Criteria

- `STREAM_RETRY_BASE_DELAY_S=nan` and `STREAM_RETRY_BASE_DELAY_S=inf` both
  fall back to the default (10.0) without raising.
- `STREAM_MAX_RETRIES=99999` is clamped to 10 with a logged warning.
- `_DEFAULT_STREAM_MAX_RETRIES` and `_DEFAULT_STREAM_RETRY_BASE_DELAY_S`
  are importable from `config.py` at module level.
- `_is_fatal_error()` and `_is_retryable_api_error()` do not infinite-loop
  on a synthetic `__context__` cycle.
- `ChunkWriter.delete()` uses `unlink(missing_ok=True)`.
- `TestIsRetryableApiError` lives in `test_error_helpers.py`, not
  `test_nodes.py`.
- A new test asserts `httpx.HTTPStatusError` with status 400 is classified
  as non-retryable.
- `test_stream_retry.py` docstring reflects WP-004/WP-009/WP-010 scope.
- All `run_logger` guards in `nodes/__init__.py` use the truthy form.
- Only one `_TrackingChunkWriter` definition exists in
  `test_streaming_capture.py`.
- Full test suite passes (≥ 931 tests, 0 failures).

## Testing Strategy

- **Step 1:** Add unit tests for `_parse_positive_float()` covering: valid
  float, empty string, non-numeric, negative, `nan`, `inf`, `-inf`. Add
  integration tests in `test_config.py` for `STREAM_RETRY_BASE_DELAY_S=nan`
  and `inf`.
- **Step 2:** Add unit tests for `STREAM_MAX_RETRIES` values above ceiling
  (11, 99999) asserting the clamped value. Add a test asserting the warning
  is logged.
- **Step 3:** No new tests — existing tests validate behaviour. Assert
  constants are importable.
- **Step 4:** Add a test that constructs a `__context__` cycle and verifies
  both functions return `False` without hanging.
- **Step 5:** No new tests — existing `TestDelete` in `test_chunk_writer.py`
  (6 tests) covers the behaviour.
- **Step 6:** Run moved tests to confirm they pass from the new location.
  Add the `httpx.HTTPStatusError` disambiguation test.
- **Step 7:** No new tests — style and docstring changes only. Verify full
  suite passes.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Step 4 changes `_is_fatal_error` signature** | Use `None` default for the `visited` parameter so all existing call sites work unchanged. |
| **Step 6 import paths break** | Verify `_exc_with_status` and `_httpx_transport_error` helpers are self-contained (no cross-class dependencies in `test_nodes.py`). |
| **Step 7c shared stub doesn't cover all test variants** | Review all three stubs' method signatures before extracting; the shared class should be a superset. |
| **`_parse_positive_float` rejects valid-but-large floats** | Only reject non-finite values (`nan`, `inf`); large finite floats are accepted (the ceiling is applied separately to `max_retries`). |
