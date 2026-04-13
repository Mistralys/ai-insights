# Plan

## Summary

Add application-level retry with exponential backoff to the orchestrator's streaming loop (`_accumulate_stream`) so that transient Anthropic API errors — specifically `overloaded_error` (HTTP 529) arriving as mid-stream SSE error events — are retried automatically instead of immediately failing the stage.

## Architectural Context

The orchestrator's stage execution pipeline is in `orchestrator/src/nodes/__init__.py`. Each stage calls `_accumulate_stream()` which iterates over `agent.astream()` (Deep Agents → LangGraph → `langchain_anthropic` → Anthropic SDK). The function accumulates `AIMessageChunk` fragments into complete messages while writing raw chunks to a JSONL file via `ChunkWriter`.

**Error flow today:**
1. `_accumulate_stream()` has no retry — any exception from `astream()` propagates to `node_fn()`'s `except` block.
2. `node_fn()` catches all exceptions, emits a `stage_error` JSONL entry, attempts rollback, and returns `stage_success: False`.
3. The supervisor increments the WP's consecutive failure counter. After 3 consecutive failures the WP is halted.

**Why mid-stream errors bypass SDK retries:**
The Anthropic SDK's `max_retries` (default 2 in `langchain_anthropic`) operates at the HTTP request level — it retries when the *initial* HTTP response returns 4xx/5xx. However, `overloaded_error` can arrive as an SSE `error` event *after* the HTTP connection succeeds and streaming begins (`anthropic/_streaming.py:234`). At that point the SDK has no retry mechanism; the error is raised directly into the application's `async for` loop.

**Related components:**
- `orchestrator/src/nodes/__init__.py` — `_accumulate_stream()` (lines ~338–450) and `node_fn()` (lines ~670–875)
- `orchestrator/src/config.py` — `Config` dataclass (lines ~243–285)
- `orchestrator/src/utils/chunk_writer.py` — JSONL chunk file writer
- `_is_fatal_error()` (lines ~56–70) — detects 401/403 auth errors that must NOT be retried
- Supervisor circuit breaker in `orchestrator/src/supervisor.py` (lines ~206–223) — consecutive failure counter

## Approach / Architecture

Wrap the streaming loop inside `_accumulate_stream()` in a retry loop with exponential backoff. On a retryable error:
1. Close the current `ChunkWriter` and discard partially accumulated state.
2. Wait with exponential backoff + jitter.
3. Open a fresh `ChunkWriter` and restart `astream()` from scratch.

Fatal errors (401, 403) are excluded from retry via the existing `_is_fatal_error()` check. A new `_is_retryable_api_error()` helper classifies which exceptions warrant a retry (overloaded, rate-limited, 5xx server errors).

Retry parameters are configurable via `.env` (`STREAM_MAX_RETRIES`, `STREAM_RETRY_BASE_DELAY_S`) with sensible defaults.

## Rationale

- **Retry at the application level** because the SDK's built-in retry does not cover mid-stream SSE errors.
- **Restart the stream from scratch** rather than resuming, because the Anthropic Messages API is not resumable — a partial response from an interrupted stream cannot be continued.
- **Discard partial chunks** on retry because they represent an incomplete/corrupted agent turn. The LLM will produce a fresh response.
- **Exponential backoff with jitter** prevents thundering herd problems and gives the API time to recover.
- **Configurable parameters** let operators tune retry behavior for their workload without code changes.

## Detailed Steps

### 1. Add `_is_retryable_api_error()` helper

Create a new function in `orchestrator/src/nodes/__init__.py` (near `_is_fatal_error()`) that returns `True` for transient API errors:
- Anthropic `overloaded_error` (status 529)
- Rate limit errors (status 429)
- Generic server errors (status >= 500)
- Connection/timeout errors from `httpx`

It must return `False` for fatal errors (delegating to `_is_fatal_error()`). The function should walk the exception chain (same pattern as `_is_fatal_error()`).

### 2. Add retry configuration to `Config`

Add two new fields to `orchestrator/src/config.py` → `Config`:
- `stream_max_retries: int = 2` — maximum number of retry attempts (0 disables retry)
- `stream_retry_base_delay_s: float = 10.0` — base delay in seconds for exponential backoff

Read them from environment variables `STREAM_MAX_RETRIES` and `STREAM_RETRY_BASE_DELAY_S` in `load_config()`. Document them alongside the existing env vars.

### 3. Refactor `_accumulate_stream()` to accept retry config

Update the function signature to accept `max_retries: int = 0` and `base_delay_s: float = 10.0`. Wrap the existing streaming loop in a retry loop:

```
for attempt in range(1 + max_retries):
    reset accumulators
    create ChunkWriter (if enabled)
    try:
        async for chunk in agent.astream(...):
            accumulate + write chunk
        break  # success → exit retry loop
    except Exception as exc:
        close ChunkWriter
        if attempt == max_retries or _is_fatal_error(exc) or not _is_retryable_api_error(exc):
            raise  # propagate to node_fn's except handler
        delay = base_delay_s * (2 ** attempt) * (0.5 + random() * 0.5)
        log.warning("Transient API error (attempt %d/%d, retrying in %.1fs): %s", ...)
        await asyncio.sleep(delay)
```

The `finally` block must still reconstruct messages from whatever state the accumulators hold (which will be fresh if a retry was started).

### 4. Wire retry config through `node_fn()`

Pass `config.stream_max_retries` and `config.stream_retry_base_delay_s` from the `node_fn()` closure to `_accumulate_stream()`.

### 5. Log retry attempts

Each retry attempt should emit a `stage_retry` JSONL entry (via `run_logger.stream_entry()`) recording the attempt number, the error message, and the delay. This gives operators visibility into retry behavior without needing to grep Python logs.

### 6. Add `ChunkWriter` cleanup for retried streams

When a stream is retried, the partially-written chunk file from the failed attempt should be deleted (or renamed with a `.partial` suffix) to avoid confusing downstream consumers. The new `ChunkWriter` for the retry attempt gets a fresh file path (append `-retry-N` before the extension, or use the existing naming convention with a retry disambiguator).

### 7. Update `.env.example` / documentation

Add the new environment variables to:
- `orchestrator/.env.example` (or `.env.dist` if that's the convention)
- The orchestrator's project manifest `constraints.md` or relevant documentation section

### 8. Write tests

Add tests in `orchestrator/tests/` covering:
- `_is_retryable_api_error()` with mock exceptions for overloaded (529), rate-limited (429), server error (500), auth error (401), and generic `ValueError`
- `_accumulate_stream()` retry behavior using a mock agent whose `astream()` fails on the first call with a retryable error and succeeds on the second
- Verify that fatal errors (401) are NOT retried
- Verify that the retry counter, delay, and jitter are respected
- Verify partial chunk files are cleaned up on retry

## Dependencies

- No new third-party dependencies required. Uses stdlib `asyncio.sleep()` and `random.random()`.
- The `anthropic` SDK's exception hierarchy (specifically `APIStatusError` and its `status_code` attribute) is used for classification, but only via duck-typing (`getattr(exc, "status_code", None)`), so no direct import dependency on the SDK is needed.

## Required Components

- `orchestrator/src/nodes/__init__.py` — primary changes (retry loop, retryable-error classifier)
- `orchestrator/src/config.py` — new config fields + env var parsing
- `orchestrator/src/utils/chunk_writer.py` — may need a `delete()` or `cleanup()` method for partial files
- `orchestrator/tests/test_nodes_retry.py` — new test file
- `orchestrator/.env.example` or equivalent — document new env vars

## Assumptions

- The Anthropic Messages API is not stream-resumable; a failed stream requires a full restart from the user prompt.
- `overloaded_error` (529) is always transient and safe to retry (Anthropic documentation confirms this).
- The `deepagents.create_deep_agent()` returns a stateless graph that can be re-invoked with the same inputs without side effects (tools may be called again, but since the ledger state is idempotent for `begin_work`/`claim`, this is acceptable).
- The existing `_is_fatal_error()` logic (checking 401/403) is correct and complete for non-retryable errors.

## Constraints

- The retry logic must NOT retry on fatal authentication errors (401, 403) — those must still terminate immediately.
- Retry delays must use jitter to prevent synchronized retries from multiple orchestrator instances.
- The maximum total retry time for a single stage should not exceed the heartbeat interval (120s default) to avoid false "alive" signals. With `max_retries=2` and `base_delay_s=10`, worst case is ≈10 + 20 = 30s of delay, well within bounds.
- Chunk files from failed attempts must not pollute the dialogue capture directory.
- Cross-platform: `asyncio.sleep()` and `random.random()` are cross-platform. No OS-specific code needed.

## Out of Scope

- Retry logic for non-streaming `ainvoke()` calls (not currently used in the orchestrator pipeline).
- Circuit-breaker changes in the supervisor — the existing consecutive-failure counter already handles the case where all retries are exhausted.
- Increasing `max_retries` in the `ChatAnthropic` model constructor — that addresses a different failure mode (initial HTTP connection failures) and is handled adequately by the SDK default of 2.
- Rate-limit-aware backoff using `Retry-After` headers — desirable but not required for the `overloaded_error` case.
- Notification/alerting on transient errors — out of scope for this plan.

## Acceptance Criteria

- An `overloaded_error` (529) mid-stream triggers a retry with exponential backoff instead of immediately failing the stage.
- After `stream_max_retries` exhausted retries, the error propagates normally and the stage fails as before.
- Fatal errors (401, 403) are never retried.
- Retry attempts are logged both to Python logging and to the JSONL run log.
- Partial chunk files from failed attempts are cleaned up.
- `STREAM_MAX_RETRIES=0` disables retry entirely (preserving current behavior).
- All new code has corresponding test coverage.

## Testing Strategy

1. **Unit tests for `_is_retryable_api_error()`**: Mock exceptions with various `status_code` attributes; verify classification is correct for 429, 500, 529, 401, 403, and plain `ValueError`.
2. **Unit tests for retry loop in `_accumulate_stream()`**: Use a mock async iterable that raises a retryable error on the first invocation and yields valid chunks on the second. Verify that the function returns successfully after retry. Verify that non-retryable errors propagate immediately.
3. **Integration-like test**: Mock the full `agent.astream()` path to verify ChunkWriter cleanup on retry.
4. **Configuration tests**: Verify `load_config()` parses `STREAM_MAX_RETRIES` and `STREAM_RETRY_BASE_DELAY_S` from environment variables correctly, including edge cases (missing, non-numeric, negative).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Retry causes duplicate tool calls** (e.g., `ledger_create_work_package` called twice) | The PM stage where this error occurred was mid-subagent. On retry, the agent restarts from the user prompt and re-evaluates ledger state. Ledger operations are either idempotent or produce clear "already exists" errors that agents handle. |
| **Retry extends stage duration beyond heartbeat** | Default config: max 30s of retry delay (2 retries × 10/20s). Heartbeat interval is 120s. Well within bounds. Document this constraint. |
| **Persistent API overload exhausts all retries** | After retries are exhausted, the error propagates normally. The supervisor's circuit breaker halts the WP after 3 consecutive stage failures. This is the correct behavior — a persistently overloaded API is not recoverable by retrying. |
| **ChunkWriter partial file left on disk** | Explicit cleanup in the retry loop's `except` block deletes partial files. A `finally` guard ensures cleanup even if cleanup itself fails. |
