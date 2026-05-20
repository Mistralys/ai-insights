# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.3.0
- Architectural Reviews: none — Plan Architect Reviewer v1.4.0

## Summary

Address actionable strategic recommendations from the `2026-05-20-orchestrator-gui-polish-rework-2` synthesis. Two items are in scope: (1) add an empty-string `id` guard to `isRawQueueEntry()`, and (2) add a regression test for registry-separation invariant. Two synthesis recommendations are explicitly excluded: the `pollCount` off-by-one (synthesis Gold Nugget §2 — analysis was incorrect; current code already produces exactly 15 API calls) and the `setLimitedInterval` helper (deferred per synthesis recommendation).

## Architectural Context

All changes target the MCP server codebase — two files in the backend queue validator and one in the existing test suite:

- **Backend validator:** `mcp-server/src/gui/queue/validate-entry.ts` — pure `isRawQueueEntry()` function with 5 validation rules. Currently accepts empty-string `id` values (only checks `typeof id === 'string'`). The `id` check is at line 36; the `expectedSlug` non-empty guard pattern (`.trim().length > 0`) to be replicated is at line 39.
- **Validator tests:** `mcp-server/tests/gui/queue/validate-entry.test.ts` — 17 pure-function unit tests covering all 5 validation rules.
- **View tests:** `mcp-server/tests/gui/orchestrator-view.test.ts` — jsdom-based test suite that loads `orchestrator.js` via `vm.runInThisContext`. Uses `flushPromises()` (10-iteration microtask flush) for async assertions. The API stub declares `orchestratorStart`, `orchestratorGetQueue`, `orchestratorKill`, and `orchestratorDismiss`; `orchestratorGetRunStatus` must be added for the registry-separation test.
- **Queue types:** `mcp-server/src/gui/queue/types.ts` — defines `RawQueueEntry` with `id: string`.
- **Frontend view:** `mcp-server/gui/public/views/orchestrator.js` — contains the registry-separation invariant (`_orchStatusPollCleanups` drained only by `renderOrchestrator()`, not by `refreshQueue()`). The `Router._setPolling(refreshQueue, 5000)` call at line 429 registers the queue polling callback; in the test, `Router._setPolling` is a mock (not a real interval).

## Approach / Architecture

Two independent, low-risk improvements ordered by priority:

1. **Registry-separation regression test** (Medium Priority) — Add a targeted test to `orchestrator-view.test.ts` that asserts `refreshQueue()` does NOT drain `_orchStatusPollCleanups`. Test sequence: render orchestrator → start a run (populating the status-poll cleanup registry) → invoke `refreshQueue()` by extracting the callback from the `Router._setPolling` mock → assert the status-poll `clearInterval` mock was NOT called.

2. **Empty-string `id` guard** (Low Priority) — Add `.trim().length > 0` to the `id` check in `isRawQueueEntry()`. Add corresponding TC-18/TC-19 test cases to `validate-entry.test.ts`. Note: this deliberately tightens the existing documented contract (which explicitly states `id` non-emptiness is not enforced); the change is justified because downstream ledger lookups assume non-empty `id`.

## Rationale

- **Item 1** is Medium Priority because it guards the correctness invariant of WP-002 (the registry separation). Without this test, a future refactor could accidentally re-merge the cleanup arrays and no test would catch it.
- **Item 2** is a defence-in-depth fix that deliberately tightens the existing documented contract. The current `api-surface.md` explicitly states that `id` non-emptiness is not enforced ("that constraint is left to the upstream orchestrator"). However, downstream ledger lookups assume non-empty `id`; an empty-string `id` would cause silent lookup failures. The one-expression change has no impact on valid data, and the documentation will be updated to reflect the new stricter contract.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `id` guard strength | `.trim().length > 0` | `id.length > 0` (no whitespace check); UUID regex | `.trim().length > 0` matches the `expectedSlug` guard pattern already in place; UUID regex is scope creep since `id` values are opaque strings |
| Registry-separation test approach | Extract `refreshQueue` callback from `Router._setPolling` mock + add `orchestratorGetRunStatus` mock + assert `clearInterval` NOT called | Expose internal array for inspection; snapshot testing; advance fake timers to trigger Router polling | Mock-based approach is consistent with existing test patterns; `Router._setPolling` is a mock (not a real interval) so timer advancement won't trigger it; internal exposure breaks encapsulation |

## Pattern Alignment

- `validate-entry.ts` guard pattern: follows the existing `expectedSlug` check at line 39 (`.trim().length > 0`). Same shape applied to `id` at line 36.
- `orchestrator-view.test.ts` test structure: follows the existing `describe`/`it` grouping with `flushPromises()` + mock assertions. The existing test at line 243 accesses `Router._setPolling.mock.calls[0]` to verify the callback and delay — the registry-separation test should use the same pattern to invoke `refreshQueue` directly.

## Detailed Steps

### Step 1: Add registry-separation regression test

1. Open `mcp-server/tests/gui/orchestrator-view.test.ts`.
2. Add `orchestratorGetRunStatus: vi.fn().mockResolvedValue(null)` to the global API stub in `beforeAll` (alongside the existing 4 methods) and in the `beforeEach` mock reset block.
3. Add a new `describe` block for registry-separation (AC for the invariant: "`refreshQueue()` does NOT drain `_orchStatusPollCleanups`").
4. Inside the describe block, add a test that:
   - Uses `vi.useFakeTimers()` to control `setInterval`/`clearInterval`.
   - Renders the orchestrator view.
   - Sets `planInput.value` and triggers preflight (all checks pass) + start run. Mock `API.orchestratorStart` to return `{ started: true, runStatusFilename: 'run-status.json' }` on the second call (first call is preflight with `{ checks: [...], started: false }`).
   - Flushes promises to let the start-run handler fire, which registers a `statusPollTimer` in `_orchStatusPollCleanups`.
   - Captures the `clearInterval` spy call count at this point.
   - Extracts the `refreshQueue` callback from `(Router._setPolling as Mock).mock.calls[0][0]` and invokes it directly (since `Router._setPolling` is a mock that doesn't create a real interval, timer advancement won't trigger it).
   - Flushes promises for the `API.orchestratorGetQueue` response.
   - Asserts `clearInterval` call count did NOT increase — proving the status-poll timer survived the queue refresh.
5. Clean up with `vi.useRealTimers()` in an `afterEach`.

### Step 2: Add empty-string `id` guard to `isRawQueueEntry()`

1. Open `mcp-server/src/gui/queue/validate-entry.ts`.
2. Change line 36 from:
   ```ts
   typeof e['id'] === 'string' &&
   ```
   to:
   ```ts
   typeof e['id'] === 'string' && (e['id'] as string).trim().length > 0 &&
   ```
3. Update the JSDoc rule 2 to mention rejection of empty/whitespace-only `id` values:
   ```
   2. **String fields** — `id`, `planPath`, and `startedAt` are strings; `id` must be non-empty and non-whitespace-only.
   ```

### Step 3: Add TC-18 test for empty-string `id`

1. Open `mcp-server/tests/gui/queue/validate-entry.test.ts`.
2. In the `isRawQueueEntry — (b) string id` describe block, add:
   ```ts
   it('TC-18: returns false when id is an empty string', () => {
     expect(isRawQueueEntry({ ...VALID_ENTRY, id: '' })).toBe(false);
   });

   it('TC-19: returns false when id is whitespace-only', () => {
     expect(isRawQueueEntry({ ...VALID_ENTRY, id: '   ' })).toBe(false);
   });
   ```

### Step 4: Run the test suite

1. Run `npm test` in `mcp-server/` to confirm all tests pass.
2. Run `npx tsc --noEmit` in `mcp-server/` to confirm no type errors.

### Step 5: Update documentation

1. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — update `isRawQueueEntry()` rule 2 to state `id` must be non-empty/non-whitespace; remove the existing note that says non-emptiness is not enforced.
2. Update `mcp-server/changelog.md` with a new version entry documenting the 2 changes.

## Dependencies

- Steps 2 and 3 are sequentially dependent (guard must exist before its test).
- Step 1 is independent of Steps 2–3.
- Step 4 depends on all code changes (Steps 1–3).
- Step 5 depends on Step 4 passing.

## Required Components

- `mcp-server/src/gui/queue/validate-entry.ts` — modified (add `id` guard)
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — modified (add TC-18/TC-19)
- `mcp-server/tests/gui/orchestrator-view.test.ts` — modified (registry-separation test + `orchestratorGetRunStatus` mock)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — modified (id guard docs)
- `mcp-server/changelog.md` — modified (new version entry)

## Assumptions

- The `RawQueueEntry.id` field is never intentionally an empty string in production queue files. Empty or whitespace-only `id` values would represent corrupt data.
- The existing `orchestrator-view.test.ts` test infrastructure (jsdom + `vm.runInThisContext` + fake timers) supports asserting on `clearInterval` call counts.
- `Router._setPolling` is a mock (`vi.fn()`) that captures the `refreshQueue` callback but does not create a real interval; the callback must be extracted and invoked directly.

## Constraints

- The `validate-entry.ts` function must remain pure (no I/O, no side effects) — Constraint from module design.
- All test changes must keep the full suite green (`npm test` exit 0, `tsc --noEmit` exit 0).

## Out of Scope

- **`setLimitedInterval` helper extraction** (Gold Nugget §4) — The synthesis explicitly recommends deferring until the polling pattern appears in a second view. Currently only one view uses it.
- **`pollCount` off-by-one "fix"** (Gold Nugget §2) — Audit verified the current code already produces exactly MAX_STATUS_POLLS (15) API calls. `pollCount++` executes before the guard check, so on the 15th callback pollCount=15 satisfies `>= 15` and `clearInterval` fires. The synthesis analysis was incorrect; no code change is needed.
- **`RawQueueEntry` interface change** — The TypeScript interface type `id: string` remains unchanged; the runtime guard is stricter than the type.
- **Test type-cast changes** — Since `isRawQueueEntry` accepts `unknown`, all test inputs compile cleanly regardless of value types. The project tsconfig also excludes `tests/` from compilation. No casts are needed.

## Acceptance Criteria

- AC-1: `isRawQueueEntry({ ...valid, id: '' })` returns `false`.
- AC-2: `isRawQueueEntry({ ...valid, id: '   ' })` returns `false`.
- AC-3: A new test in `orchestrator-view.test.ts` proves that `refreshQueue()` does NOT call `clearInterval` on the status-poll timer.
- AC-4: Full test suite passes (`npm test` in `mcp-server/`).
- AC-5: TypeScript compiles cleanly (`tsc --noEmit` exit 0).
- AC-6: `api-surface.md` documents the updated `id` validation rule.
- AC-7: `changelog.md` has a new version entry covering the changes.

## Testing Strategy

All changes are testable via the existing Vitest infrastructure. No new test infrastructure is required.

- **Item 1 (registry-separation):** Integration-level test in `orchestrator-view.test.ts` using fake timers and mock assertions. Requires adding `orchestratorGetRunStatus` to the API mock stub.
- **Item 2 (id guard):** Two new unit tests (TC-18, TC-19) in `validate-entry.test.ts` — pure function, no I/O.

## Test Plan

- `mcp-server/tests/gui/orchestrator-view.test.ts` — New test: "refreshQueue does not drain _orchStatusPollCleanups" — asserts clearInterval not called on status-poll timer during queue refresh — AC-3
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — TC-18: "returns false when id is an empty string" — asserts `isRawQueueEntry` rejects empty id — AC-1
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — TC-19: "returns false when id is whitespace-only" — asserts `isRawQueueEntry` rejects whitespace id — AC-2
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — (all 19 tests pass) — AC-4

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `isRawQueueEntry()` rule 2 to state `id` must be non-empty/non-whitespace; remove the existing note that says `id` non-emptiness is not enforced — AC-6
- `mcp-server/changelog.md` — New version entry (v1.30.5) with 2 bullets: id guard, registry-separation regression test — AC-7

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Empty-id guard rejects currently-valid queue entries** | The Python orchestrator always generates UUID-based `id` values. An empty `id` in the queue file would indicate corruption, which should be rejected. |
| **Registry-separation test is brittle with fake timers** | Follow the same fake-timer pattern already proven in the existing test suite. Use `vi.useFakeTimers()` / `vi.useRealTimers()` with explicit timer control. Extract `refreshQueue` from `Router._setPolling.mock.calls[0][0]` rather than relying on timer advancement. |
| **Missing `orchestratorGetRunStatus` mock causes unrelated test failures** | Add the mock globally in `beforeAll` (with safe `null` default) so existing tests are not affected; only the new test relies on the status-poll path. |
