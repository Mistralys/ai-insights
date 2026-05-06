# Plan — GUI Orchestrator Integration Rework 1: Synthesis Follow-Ups

## Summary

Address the strategic recommendations from the GUI Orchestrator Integration
synthesis. The changes span `mcp-server/gui/orchestrator-manager.ts`,
`mcp-server/gui/server.ts`, `mcp-server/gui/api.ts`,
`orchestrator/tests/test_run_queue.py`, and their corresponding test files.

The original synthesis listed seven items. This plan consolidates them into
four steps — three substantive changes plus a batch of low-ceremony drive-by
fixes — after an audit determined that three of the original items (JSDoc
comments and a low-ROI integration test) did not warrant individual plan steps.

## Architectural Context

The GUI server lives in `mcp-server/gui/` (separate from the MCP server in
`mcp-server/src/`). Key files touched by this rework:

- `mcp-server/gui/orchestrator-manager.ts` — Queue reader, kill/dismiss actions,
  preflight, and launch. Contains the triple-duplicated effective status logic.
- `mcp-server/gui/server.ts` — HTTP server with `readBody()`, `apiErrorToStatus()`,
  and the request router.
- `mcp-server/gui/api.ts` — Route handler functions; contains `assertSafeQueueId()`,
  `conflict()` helper, and all `handleOrchestrator*` exports.
- `orchestrator/src/utils/run_queue.py` — Python-side queue writer with
  `register()`/`unregister()` and file-locking via `filelock.py`.
- `orchestrator/tests/test_run_queue.py` — Existing 18-test suite for the Python
  run queue module.
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — Existing TS unit tests.
- `mcp-server/tests/gui/api-orchestrator.test.ts` — Existing TS API handler tests.

## Approach / Architecture

Four steps, ordered by priority:

1. **Extract `computeEffectiveStatus()` helper** in `orchestrator-manager.ts`.
2. **Add `readBody()` size cap + CONFLICT → 409 mapping** in `server.ts`.
3. **Add `unregister()` empty-queue test** in `test_run_queue.py`.
4. **Drive-by fixes** — backslash guard in `assertSafeQueueId()`, locking-gap
   `@remarks` on `writeQueueFileAtomic()`, optional smoke integration test.

## Rationale

All items were flagged by at least two pipeline stages (Developer, QA, Reviewer,
or Security) during the original session. None are blocking, but they reduce
duplication, close security gaps, improve test coverage, and prevent future
confusion.

## Detailed Steps

### Step 1 — Extract `computeEffectiveStatus()` helper (Medium priority)

**File:** `mcp-server/gui/orchestrator-manager.ts`

The identical effective-status computation block appears in three locations:

- `getQueue()` loop body (lines ~324–331)
- `killQueueEntry()` body (lines ~462–468)
- `dismissQueueEntry()` body (lines ~520+)

Each instance performs the same three-branch check:
```
if (projectExists)       → 'started'
else if (alive)          → 'pending'
else                     → 'dead'
```

**Action:**

1. Create a private function at the module level:
   ```ts
   function computeEffectiveStatus(
     alive: boolean,
     projectExists: boolean,
   ): EffectiveStatus {
     if (projectExists) return 'started';
     if (alive) return 'pending';
     return 'dead';
   }
   ```
2. Replace the three inline blocks with calls to `computeEffectiveStatus(alive, projectExists)`.
3. Update the existing tests in `orchestrator-manager.test.ts` — no behavioral
   change, so all assertions should pass unchanged.
4. Run the full test suite to confirm zero regressions.

### Step 2 — `readBody()` size cap + CONFLICT → 409 (Medium priority)

**File:** `mcp-server/gui/server.ts`

Two `server.ts` hardening changes grouped into one step because both touch the
same file and are small.

#### 2a — `readBody()` size cap

The current `readBody()` (line ~164) buffers the full request body with no
upper bound. All PUT/PATCH/POST handlers use it (lines ~548, 606, 638, 663).

**Action:**

1. Add a `MAX_BODY_BYTES` constant (1 MB = 1_048_576):
   ```ts
   const MAX_BODY_BYTES = 1_048_576;
   ```
2. Optionally pre-check `Content-Length` at the top of `readBody()` for an
   early reject (covers the common case without mid-stream teardown):
   ```ts
   const declared = Number(req.headers['content-length']);
   if (declared > MAX_BODY_BYTES) {
     req.destroy();
     return Promise.reject(new Error('Payload too large'));
   }
   ```
3. Modify `readBody()` to track accumulated byte length as a streaming
   fallback (handles `Transfer-Encoding: chunked` with no `Content-Length`).
   Use a `rejected` flag to prevent double-resolve — `req.destroy()` can
   still fire the `'end'` event on some Node.js versions:
   ```ts
   function readBody(req: IncomingMessage): Promise<string> {
     return new Promise((resolve, reject) => {
       const declared = Number(req.headers['content-length']);
       if (declared > MAX_BODY_BYTES) {
         req.destroy();
         reject(new Error('Payload too large'));
         return;
       }
       const chunks: Buffer[] = [];
       let totalBytes = 0;
       let rejected = false;
       req.on('data', (chunk: Buffer) => {
         if (rejected) return;
         totalBytes += chunk.length;
         if (totalBytes > MAX_BODY_BYTES) {
           rejected = true;
           req.destroy();
           reject(new Error('Payload too large'));
           return;
         }
         chunks.push(chunk);
       });
       req.on('end', () => {
         if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
       });
       req.on('error', (err) => {
         if (!rejected) reject(err);
       });
     });
   }
   ```
4. In the `handleRequest()` error handling, detect `'Payload too large'` by
   checking `err.message` and return a `413 Payload Too Large` response.
   No typed error class is needed — this is a single callsite.
5. Add a test that sends a body exceeding the limit and asserts a 413 response.

#### 2b — CONFLICT → 409 mapping

The `apiErrorToStatus()` switch (line ~147) handles `NOT_FOUND` (404),
`FORBIDDEN` (403), and `VALIDATION_ERROR` (400), but has no case for
`'CONFLICT'`. The `conflict()` helper in `api.ts` (line ~80) throws
`ApiError('CONFLICT', ...)` and is called by `handleRenameProject()` (line
~1055) when a slug collision occurs. This currently falls through to 500.

**Action:**

1. Add the case:
   ```ts
   case 'CONFLICT':
     return 409;
   ```
2. Add a unit test verifying that a rename to an existing slug returns 409
   rather than 500.

### Step 3 — `unregister()` empty-queue edge case test (Low priority)

**File:** `orchestrator/tests/test_run_queue.py`

The existing `TestUnregisterRemovesCorrectEntry` class tests removal from a
two-entry queue (`test_removes_entry_by_id`, `test_does_not_remove_other_entries`)
but never tests removing the last (and only) entry, which should leave an
empty `[]` array in the queue file.

**Action:**

1. Add a new test method to `TestUnregisterRemovesCorrectEntry`:
   ```python
   def test_removing_last_entry_leaves_empty_list(self, tmp_path: Path) -> None:
       """Unregistering the sole entry must leave a valid empty JSON array."""
       monkeypatch the queue/lock paths to tmp_path
       entry_id = register(pid=1234, plan_path="/plan.md",
                           slug="solo", started_at="2026-01-01T00:00:00+00:00")
       unregister(entry_id)
       data = json.loads(queue_file.read_text("utf-8"))
       assert data == []
   ```
2. Run the test suite to confirm the pass.

### Step 4 — Drive-by fixes (Low priority)

Small changes that don't require design decisions and cannot fail. Grouped
here to avoid inflating the plan with trivial individual steps.

#### 4a — Add backslash to `assertSafeQueueId()` guard

**File:** `mcp-server/gui/api.ts`

The current `assertSafeQueueId()` (line ~127) checks for `/` and `..` but
not backslash `\`. While queue IDs are UUID v4 strings and can never
contain a backslash, adding the check is a single expression that provides
defense-in-depth and eliminates the need for a comment explaining why it was
omitted. Apply the same fix to the sibling `assertSafeWpId()` (line ~112).

```ts
if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
```

#### 4b — Document locking parity gap on `writeQueueFileAtomic()`

**File:** `mcp-server/gui/orchestrator-manager.ts`

The Python side (`run_queue.py`) acquires `.run-queue.lock` via
`filelock.py` before every read/write. The TypeScript side
(`writeQueueFileAtomic()`) performs an atomic write (tmp + rename) but does
**not** acquire the same lock file. Add a `@remarks` block:

```ts
/**
 * ...existing doc...
 *
 * @remarks
 * LOCKING PARITY GAP: The Python writers (run_queue.py) acquire
 * `.run-queue.lock` before reading/writing the queue file. This
 * TypeScript writer does NOT acquire the same lock. A concurrent Python
 * `register()` between the caller's read and this write could silently
 * drop a new entry. At current concurrency levels (single-user localhost
 * tool) the risk is negligible, but this should be addressed if
 * multi-user or high-concurrency scenarios are introduced.
 */
```

#### 4c — Optional: single smoke integration test

Optionally, add **one** integration test that sends `GET /api/orchestrator/queue`
through `handleRequest()` (following the `server-info.test.ts` pattern) to
verify route dispatch. A full four-route integration suite is not warranted
given the existing handler-level coverage in `api-orchestrator.test.ts` and
the mechanical nature of the `server.ts` router.

## Dependencies

- None. All four steps are independent and can be implemented in any order.

## Required Components

- `mcp-server/gui/orchestrator-manager.ts` (steps 1, 4b)
- `mcp-server/gui/server.ts` (step 2)
- `mcp-server/gui/api.ts` (step 4a)
- `mcp-server/tests/gui/orchestrator-manager.test.ts` (step 1 regression check)
- `orchestrator/tests/test_run_queue.py` (step 3)

## Assumptions

- The effective-status logic in all three call sites is truly identical — confirmed
  by code review (same three-branch `projectExists` / `alive` / else pattern).
- The `CONFLICT` error code string used by `api.ts` matches the literal
  `'CONFLICT'` that `apiErrorToStatus()` should handle — confirmed.
- `assertSafeQueueId()` only receives UUID v4 strings from the Python-generated
  queue — confirmed by tracing from `run_queue.py → register() → uuid.uuid4()`.

## Constraints

- No new production dependencies.
- Follow existing test patterns (Vitest for TS, pytest for Python).
- No behavioral changes — all items are refactor, hardening, docs, or test-only.
- Cross-platform: `readBody()` size cap must work identically on Windows, macOS,
  and Linux (Node.js `Buffer` and `IncomingMessage` are platform-agnostic).

## Out of Scope

- UX improvements to `renderLogPreview()` (mentioned in "Next Steps" but not
  a strategic recommendation).
- Cross-platform validation of `isProcessAlive()` on Windows CI.
- Changelog updates (will be handled by the Changelog Curator at release time).
- Full cross-process locking implementation for the TS queue writer (step 7
  documents the gap; full fix is optional and left as a team decision).

## Acceptance Criteria

1. `computeEffectiveStatus()` is a single private function called from all three
   sites; no inline duplication remains. All existing tests pass.
2. `readBody()` rejects payloads > 1 MB with a 413 response (both
   `Content-Length` pre-check and streaming fallback). A test covers the
   rejection path. `apiErrorToStatus('CONFLICT')` returns 409 with a test.
3. `test_run_queue.py` includes a test that unregisters the sole entry and
   asserts the queue file contains `[]`.
4. `assertSafeQueueId()` and `assertSafeWpId()` check for backslash.
   `writeQueueFileAtomic()` has a `@remarks` block documenting the locking
   parity gap.

## Testing Strategy

- **Step 1:** Run existing MCP server test suite (`npm test` from
  `mcp-server/`). No new tests — existing coverage is sufficient.
- **Step 2:** New test for 413 rejection + new test for 409 CONFLICT mapping
  in the server test suite.
- **Step 3:** New pytest test in `orchestrator/tests/test_run_queue.py`.
- **Step 4:** Run existing test suites to confirm no regressions. Optional
  smoke integration test if 4c is implemented.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Step 1: Refactor introduces subtle behavioral difference** | The three blocks are character-for-character identical modulo variable names (Instance 1 has an extra inline comment). Extract exactly the same logic. All existing tests must pass unchanged. |
| **Step 2: `readBody()` change breaks legitimate large payloads** | The largest legitimate body is a `config` update or `start` request — both well under 1 KB. 1 MB is > 1000× headroom. |
| **Step 2: `req.destroy()` causes double-resolve** | `req.destroy()` can fire the `'end'` event on some Node.js versions. The `rejected` flag guards both `resolve()` and `reject()` to prevent a double-settle. |
| **Step 2: Other error codes also missing from switch** | Verified: only `CONFLICT` is used and missing. All other thrown codes (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`) have cases. |
| **Step 4b: Documenting the locking gap without fixing it** | Risk is negligible at current concurrency. The comment makes future implementers aware. Full fix (locking via `proper-lockfile`) is optional. |
