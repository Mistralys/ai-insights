# Project Synthesis Report

**Plan:** Stream Retry on Transient API Errors
**Date:** 2026-04-13
**Status:** COMPLETE
**Work Packages:** 10 / 10 complete
**Pipelines passed:** 10 / 10 (all stages PASS)

---

## Executive Summary

This session delivered application-level retry with exponential backoff for the orchestrator's streaming loop (`_accumulate_stream` in `orchestrator/src/nodes/__init__.py`). The motivation was a class of mid-stream Anthropic API errors — specifically the `overloaded_error` (HTTP 529) delivered as an SSE `error` event after a successful HTTP handshake — that bypasses the Anthropic SDK's own retry mechanism entirely and would previously fail the stage after 3 consecutive supervisor-counted failures.

The implementation wraps the streaming loop in a configurable retry loop, resets all accumulators and cleans up partial `ChunkWriter` files on each failed attempt, and re-opens a fresh stream. Fatal auth errors (401, 403) are explicitly excluded from retry via an existing guard. A new `_is_retryable_api_error()` classifier correctly routes transient errors (529, 429, ≥500, httpx transport) to the retry path while propagating all others immediately. Retry parameters are tunable via `.env` without code changes. Each retry attempt emits a structured `stage_retry` JSONL entry for observability.

All 30 acceptance criteria across 10 work packages were met. The full test suite ended at **931 passed, 6 skipped, 0 failures**. No security issues were found across 4 security audits.

---

## Work Packages

| WP | Description | AC | Test Count | Security Issues | Status |
|----|-------------|----|-----------|-----------------|--------|
| WP-001 | `_is_retryable_api_error()` helper | 4/4 | 16 new | 0 | PASS |
| WP-002 | `ChunkWriter.delete()` | 3/3 | 6 new | 0 | PASS |
| WP-003 | Config fields + env var parsing | 3/3 | 14 new | 0 | PASS |
| WP-004 | Retry loop in `_accumulate_stream()` | 5/5 | 16 new | 0 | PASS |
| WP-005 | Documentation | 2/2 | — | n/a | PASS |
| WP-006 | QA + review for error classifier tests | 3/3 | — (existing) | n/a | PASS |
| WP-007 | QA + review for config tests | 3/3 | — (existing) | n/a | PASS |
| WP-008 | Config wiring tests | 2/2 | 3 new | 0 | PASS |
| WP-009 | `stage_retry` JSONL log entry | 3/3 | 5 new | 0 | PASS |
| WP-010 | Retry integration tests | 4/4 | — (existing in test_stream_retry.py) | n/a | PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total tests (final suite) | 931 passed, 6 skipped, 0 failed |
| Tests at project start | 907 |
| New tests added | ~60 across 5 test files |
| Security issues (Critical/High/Medium) | 0 across all audits |
| Acceptance criteria met | 30 / 30 |
| Files modified (source) | 3 (`nodes/__init__.py`, `config.py`, `chunk_writer.py`) |
| Files modified (tests) | 5 |
| Files modified (docs) | 3 (`.env.example`, `README.md`, `jsonl-log-schema.md`) |

### Test Progression

| After WP | Suite Count |
|----------|-------------|
| WP-001 / WP-002 (baseline) | 907 passed |
| WP-003 | 97 test_config.py pass |
| WP-004 | 923 full suite |
| WP-006 / WP-007 / WP-008 | 926–931 |
| Final (WP-009 / WP-010) | **931 passed** |

---

## Files Modified

### Source

- `orchestrator/src/nodes/__init__.py` — Added `_is_retryable_api_error()` helper; refactored `_accumulate_stream()` with retry loop, accumulator reset, `ChunkWriter.delete()` on failure, exponential backoff (formula: `base * 2^attempt * jitter[0.5, 1.0)`), fatal-error short-circuit, exhausted-retry re-raise, `stage_retry` JSONL emission via `run_logger`; updated `create_stage_node` call site to pass all three new parameters.
- `orchestrator/src/config.py` — Added `stream_max_retries: int = 2` and `stream_retry_base_delay_s: float = 10.0` to `Config` dataclass; added parsing logic for `STREAM_MAX_RETRIES` and `STREAM_RETRY_BASE_DELAY_S` env vars with silent fallback to defaults on invalid/negative values.
- `orchestrator/src/utils/chunk_writer.py` — Added `ChunkWriter.delete()` method: closes the writer (idempotent) then deletes the partial file; `FileNotFoundError` silently swallowed, other `OSError`s logged at DEBUG.

### Tests

- `orchestrator/tests/test_nodes.py` — `TestIsRetryableApiError` (16 tests), `TestConfigRetryWiring` (3 tests)
- `orchestrator/tests/test_config.py` — `TestStreamRetryConfig` (14 tests)
- `orchestrator/tests/test_chunk_writer.py` — `TestDelete` (6 tests)
- `orchestrator/tests/test_stream_retry.py` — 16 core retry tests + 5 `TestStageRetryLogEntry` + retry integration tests (WP-010 ACs)
- `orchestrator/tests/test_streaming_capture.py` — Added `delete()` stub to two inline `_TrackingChunkWriter` classes

### Documentation

- `orchestrator/.env.example` — `STREAM_MAX_RETRIES` and `STREAM_RETRY_BASE_DELAY_S` with inline comments, defaults, and backoff formula
- `orchestrator/README.md` — Environment variable reference table updated with both new vars
- `orchestrator/docs/jsonl-log-schema.md` — `stage_retry` entry documented (all fields, types, example)

---

## Known Issues & Technical Debt

These items were consistently flagged across multiple pipeline stages but did not block completion. They are listed in descending priority.

### Medium Priority

**1. `math.isfinite()` guard missing for `stream_retry_base_delay_s`**
`float('nan') < 0` evaluates `False` in Python, so `STREAM_RETRY_BASE_DELAY_S=nan` stores `NaN` in `Config` (causing `ValueError` when `asyncio.sleep(NaN)` is called) and `STREAM_RETRY_BASE_DELAY_S=inf` causes an indefinite sleep. A `math.isfinite()` check after the negativity guard in `load_config()` would close both gaps. Affects `orchestrator/src/config.py` (~line 440).

**2. No upper ceiling on `STREAM_MAX_RETRIES`**
Very large values (e.g., 99999) approach near-infinite run time; above attempt ~1074, `base * 2^attempt` overflows float to `inf` and `asyncio.sleep(inf)` hangs. Both require deliberate env var misconfiguration. A reasonable cap (e.g., max 10) with a warning in `load_config()` would prevent accidental misconfiguration.

### Low Priority

**3. `__context__` cycle guard in exception chain walking**
Both `_is_fatal_error()` and `_is_retryable_api_error()` walk the exception chain recursively without a `visited` set for `__context__` cycles. Python prevents `__cause__` cycles but `__context__` can form them. A `visited` set would be a defensive hardening. Pre-existing pattern.

**4. Inline `_TrackingChunkWriter` stubs in `test_streaming_capture.py`**
Three inline `_TrackingChunkWriter` stubs are defined in different test methods. `delete()` was patched in two of them to delegate to `close()`, making the `close_called` assertion variable misleadingly named. Extracting a shared module-level stub class would prevent this class of fix in future.

**5. `if run_logger is not None:` vs. `if run_logger:` inconsistency**
New guard in `_accumulate_stream()` uses `is not None`; existing guards in `_handle_rollback()` and `_read_pipeline_result()` use the truthy form. Both are functionally equivalent. Worth normalising in a future cleanup pass.

**6. `test_stream_retry.py` module docstring scope is stale**
The module docstring still references "WP-004 acceptance criteria" but the file now also covers WP-009 and WP-010. Low-priority doc cleanup.

---

## Security Review Summary

Four work packages (WP-001, WP-002, WP-003, WP-004/WP-008/WP-009) received full OWASP Top 10 reviews. Combined findings:

- **Critical/High/Medium:** 0
- **Low risk (informational):** 5 items, all requiring deliberate misconfiguration or pre-existing patterns

The security-critical invariant was confirmed by every audit: `_is_fatal_error(exc)` is called as the first guard in `_is_retryable_api_error()`, ensuring that 401/403 authentication errors are never retried regardless of exception wrapping depth. This is the correct architecture for an auth-error short-circuit guard.

The `str(_exc)` in `stage_retry` JSONL logs is JSON-serialized before being written to the local developer log file (A09). No injection risk; LLM provider SDKs do not embed API key material in exception messages.

---

## Strategic Recommendations

### 1. Add `_parse_positive_float()` utility to `config.py`
The `nan`/`inf` gap affects any float config field, not just the retry delay. A shared `_parse_positive_float(value: str, default: float) -> float` that includes `math.isfinite()` would generalise the fix and prevent the same gap from re-emerging as new float fields are added.

### 2. Introduce `test_error_helpers.py`
`test_nodes.py` now hosts both `_is_fatal_error` tests (pre-existing) and `TestIsRetryableApiError` (WP-001). As the error classifier set grows with future API providers, a dedicated `test_error_helpers.py` would improve discoverability and reduce the risk of related tests being spread across unrelated test classes.

### 3. Use `Path.unlink(missing_ok=True)` in `ChunkWriter.delete()`
The project requires Python 3.11+. The explicit `except FileNotFoundError: pass` in `delete()` is correct but could be replaced by the single-line idiomatic form. Minor refactor, no behavioural change.

### 4. Hoist config default constants to module level in `config.py`
`_DEFAULT_STREAM_MAX_RETRIES` and `_DEFAULT_STREAM_RETRY_BASE_DELAY_S` are currently function-local. The module-level pattern already exists (`_CAPTURE_DIALOGUES_FALSY` at line 188). Hoisting these eliminates duplication with the dataclass field defaults and keeps the module consistent.

### 5. Address retry ceiling and `isfinite` in the same PR
Items 1 and 2 from the Known Issues list (ceiling + nan/inf) are closely related and small. Bundling them into a single follow-up fix in `load_config()` would be efficient and complete the robustness gap identified across four pipeline stages.

---

## Next Steps for the Planner

1. **Follow-up hardening PR**: Apply the `math.isfinite()` guard and `STREAM_MAX_RETRIES` ceiling to `config.py` (addresses medium-priority items 1 and 2 above).
2. **Monitor production runs**: With default `max_retries=2` and `base_delay=10s`, a single 529 mid-stream error will now recover within ~20–30 seconds rather than failing the stage. Observe whether the 10s base delay is appropriate for typical Anthropic overload windows, and tune if needed.
3. **Consider `httpx.HTTPStatusError` disambiguation test**: The Reviewer flagged a specificity gap — a test using a fake httpx-module exception with a non-retryable status_code would lock the disambiguation invariant in `_is_retryable_api_error()` more directly. Low priority but tightens the contract.
4. **Update `test_stream_retry.py` docstring** to reflect that the file now covers WP-004, WP-009, and WP-010 scope.
