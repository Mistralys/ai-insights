## Synthesis

### Completion Status
- Date: 2026-04-13
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- **Steps 1–3 (`config.py`):** Hoisted `_DEFAULT_STREAM_MAX_RETRIES` and
  `_DEFAULT_STREAM_RETRY_BASE_DELAY_S` from function-locals to module-level
  constants alongside `_CAPTURE_DIALOGUES_FALSY`. Added
  `_MAX_STREAM_RETRIES_CEILING = 10` and the private `_parse_positive_float()`
  utility that rejects `nan` and `inf` via `math.isfinite()`. Updated the
  `Config` dataclass field defaults to reference the module-level constants.
  Replaced the inline `stream_retry_base_delay_s` parsing block with a single
  call to `_parse_positive_float()`. Added ceiling clamp for
  `stream_max_retries` with a `logging.warning()` on overflow. Added `import
  math` to the module's standard-library imports.
- **Step 4 (`nodes/__init__.py`):** Added a `visited: set[int] | None = None`
  parameter to both `_is_fatal_error()` and `_is_retryable_api_error()`.
  Initialised on first call; `id(exc)` is recorded before each recursive step
  and the recursive call is skipped if `id(cause)` is already present. Guards
  against theoretical `__context__` cycles without any change to behaviour on
  acyclic chains.
- **Step 5 (`chunk_writer.py`):** Replaced `try/except FileNotFoundError: pass`
  with the idiomatic `self._path.unlink(missing_ok=True)`. The outer
  `except OSError` log-and-swallow block is unchanged.
- **Step 6 (new `test_error_helpers.py`):** Moved `TestIsRetryableApiError`,
  `_exc_with_status()`, and `_httpx_transport_error()` out of `test_nodes.py`
  into a dedicated new test file. Added `_httpx_status_error()` helper and
  `test_httpx_status_error_400_is_not_retryable()` to lock the disambiguation
  invariant: httpx errors that carry `status_code` are routed through the
  status-code branch, not the transport-error branch.
- **Step 7a (`test_stream_retry.py`):** Updated module docstring to reflect
  WP-004, WP-009, and WP-010 coverage (was "five acceptance criteria for
  WP-004" only).
- **Step 7b (`nodes/__init__.py`):** Normalised the single `if run_logger is
  not None:` guard at line 529 to `if run_logger:`, matching the five existing
  truthy-form guards in the same file.
- **Step 7c (`test_streaming_capture.py`):** Extracted a shared module-level
  `_TrackingChunkWriter` class (tracking `close_calls` and `written_chunks`
  on the instance) to replace the three inline stub classes inside
  `TestChunkWriterAlwaysClosed`. Each test now uses a `_make_tracker` factory
  wrapper to capture the created instance for assertions.

### Documentation Updates
- No documentation updates were required because all changes are internal
  refactors (hardening, code organisation, style normalisation) with no
  public API or user-facing behaviour changes.

### Verification Summary
- Tests run: `tests/test_error_helpers.py`, `tests/test_stream_retry.py`,
  `tests/test_streaming_capture.py`, `tests/test_nodes.py`, full
  `tests/` suite
- Static analysis run: `ruff check` on all modified and new files
- Result: **932 passed, 6 skipped, 0 failures** (full suite). All modified
  and new files pass ruff with zero violations.

### Code Insights
- ~~[low] (improvement) `orchestrator/src/config.py`: The `import logging as
  _logging` inside `load_config()` is a function-level import introduced to
  log the ceiling clamp warning. Consider adding `import logging` to the
  module-level imports for consistency, and using a module-level logger
  (`log = logging.getLogger(__name__)`) like the pattern already used in
  `nodes/__init__.py`. The inline import is functionally correct but deviates
  from the module's existing style.~~ **Fixed 2026-04-13:** Added `import
  logging` to module-level imports and a `log = logging.getLogger(__name__)`
  logger; inline function-level import removed.
- ~~[low] (debt) `orchestrator/tests/test_nodes.py`: The `E402` ruff violation
  (`from tests.conftest import _CaptureConfig, _NoCaptureConfig` at line 926
  is a module-level import not at the top of the file) and two `E501` violations
  are pre-existing in unmodified lines. These are out of scope for this plan
  but are worth cleaning up in a future maintenance pass.~~ **Fixed 2026-04-13:**
  Moved conftest import to the top-level import block (resolves `E402`);
  wrapped the long assertion string in `TestDialogueCaptured` (resolves `E501`).
- ~~[low] (convention) `orchestrator/tests/test_stream_retry.py`: Two pre-existing
  ruff violations (`I001` import sort and `E501` line-too-long on line 338) in
  files touched only by the docstring change. These were not introduced by this
  plan and are left for a separate cleanup.~~ **Fixed 2026-04-13:** Import block
  re-sorted to stdlib-before-third-party order (resolves `I001`); overlong
  `AIMessageChunk` expression split into two local variables (resolves `E501`).

### Additional Comments
- The `_parse_positive_float()` utility is defined at module level and is
  importable — test assertions that verify the default values can import
  `_DEFAULT_STREAM_MAX_RETRIES` and `_DEFAULT_STREAM_RETRY_BASE_DELAY_S`
  directly from `src.config` without relying on hard-coded numeric literals.
- The ceiling constant `_MAX_STREAM_RETRIES_CEILING = 10` is also module-level
  and importable for the same reason.
