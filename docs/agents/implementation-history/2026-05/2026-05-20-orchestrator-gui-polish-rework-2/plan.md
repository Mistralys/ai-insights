# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.3.0
- Architectural Reviews: none — Plan Architect Reviewer v1.4.0

## Summary

Address all five strategic recommendations from the `2026-05-20-orchestrator-gui-polish-rework` synthesis. Items span a one-character validator fix, a cleanup-registry separation, a module extraction for direct testability, a documentation convention codification, and an optional complexity audit of the Start Run handler.

## Architectural Context

All changes target the MCP server GUI layer and its test/documentation infrastructure:

- **Frontend view:** `mcp-server/gui/public/views/orchestrator.js` (409 lines) — contains the `renderOrchestrator()` function, the `_orchLogPreviewCleanups` module-scoped cleanup array, the `statusPollTimer` registration (line 176), and the four `renderQueueTable` helpers (`_clearSuccessBanner`, `_buildQueueHtml`, `_bindQueueActions`, `_mountLogPreviews`).
- **Backend validator:** `mcp-server/src/gui/queue/get-queue.ts` — `isRawQueueEntry()` is a module-private function (line 89) that validates raw JSON entries with 5 rules. The empty-slug guard currently uses `(e['expectedSlug'] as string).length > 0`.
- **Queue module directory:** `mcp-server/src/gui/queue/` — contains `get-queue.ts`, `types.ts`, `compute-effective-status.ts`, `resolve-progress.ts`, `format-progress-entry.ts`.
- **Queue tests:** `mcp-server/tests/gui/queue/get-queue.test.ts` — integration-level tests that exercise `isRawQueueEntry()` only indirectly via `getQueue()`.
- **View tests:** `mcp-server/tests/gui/orchestrator-view.test.ts` — uses `flushPromises()` (10-iteration microtask flush, line 165).
- **Constraints doc:** `mcp-server/docs/agents/project-manifest/constraints.md` — currently has 71 numbered constraints; constraint 56 documents a JSDoc convention for captured-closure variables in lock callbacks (TypeScript scope).

## Approach / Architecture

Five independent improvements, ordered by risk (lowest first):

1. **Whitespace slug guard** — Change `.length > 0` to `.trim().length > 0` in `isRawQueueEntry()`. One-line change + one new test.
2. **Split cleanup registries** — Separate `_orchLogPreviewCleanups` into two arrays: `_orchLogPreviewCleanups` (log-preview callbacks only, drained by `refreshQueue()`) and `_orchStatusPollCleanups` (status-poll timers only, drained only by `renderOrchestrator()`). This eliminates the premature-cancel risk identified in the synthesis.
3. **Export `isRawQueueEntry()` for direct testing** — Move the validator to a new `mcp-server/src/gui/queue/validate-entry.ts` module. Export it. Add targeted unit tests that exercise each of the 5 validation rules directly without I/O.
4. **Codify JSDoc closure-dependency convention for GUI helpers** — Add a new constraint (§72) to `constraints.md` formalizing the pattern already introduced by `_bindQueueActions()` and `_mountLogPreviews()`.
5. **`renderOrchestrator()` Start Run handler extraction** — Extract the Start Run submit-handler logic (lines ~100–185) into a `_handleStartRun()` helper, following the same pattern used for `renderQueueTable`'s helpers.

## Rationale

- **Item 1** is a defence-in-depth fix. A whitespace-only slug passes the current guard but silently fails downstream ledger lookups. One-character change with no behavioural impact on valid data.
- **Item 2** eliminates a fragility where `refreshQueue()` drains the cleanup array that also holds `statusPollTimer`, causing premature timer cancellation if a queue poll fires before the status poll resolves. The fix separates concerns with no runtime cost.
- **Item 3** makes the 5 validation rules directly testable without filesystem setup. The synthesis noted that the validator is tested only indirectly; extracting it into its own module is consistent with the existing pattern of small focused modules in `mcp-server/src/gui/queue/` (each ≤ 80 lines).
- **Item 4** codifies a pattern already in production code (the JSDoc `Closure dependencies` blocks on `_bindQueueActions` and `_mountLogPreviews`). Without documentation, future contributors will not know to follow it.
- **Item 5** reduces `renderOrchestrator()` complexity. Currently the function spans ~190 lines (skeleton render + preflight + Start Run handler + queue setup). Extracting the Start Run handler brings it in line with the `renderQueueTable` refactor from the previous sprint.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Whitespace slug guard | `.trim().length > 0` | Regex `/\S/`; full slug format validation (`/^[a-z0-9-]+$/`) | `.trim().length` is minimal, readable, and matches the existing style; a full format regex is scope creep |
| Cleanup registry split | Two module-scoped arrays | Single array with tagged entries `{ type, fn }`; WeakRef-based cleanup | Two arrays are the simplest separation; tagged entries add allocation overhead for no benefit in vanilla JS |
| Validator extraction location | New `validate-entry.ts` in same directory | Export from `get-queue.ts`; move to `mcp-server/src/gui/queue/validators/` subdirectory | A single file alongside the existing module is proportional; a subdirectory is premature for one function |
| Convention documentation | Constraint §72 in `constraints.md` | Entry in `AGENTS.md`; separate `CONVENTIONS.md` file; README note | `constraints.md` is where all code-style rules live; it's the first place agents check |
| Start Run extraction | Single `_handleStartRun()` closure-scoped helper | Extract to a separate file; use a class | Same rationale as the `renderQueueTable` helpers from the previous sprint — closure-scoped maintains locality |

## Pattern Alignment

- `mcp-server/src/gui/queue/` — existing pattern: one small module per concern (`get-queue.ts`, `compute-effective-status.ts`, `resolve-progress.ts`, `format-progress-entry.ts`, `types.ts`). Adding `validate-entry.ts` follows this exactly.
- `mcp-server/gui/public/views/orchestrator.js` — existing pattern: closure-scoped helpers with JSDoc `Closure dependencies` blocks. The Start Run extraction follows this established convention.
- `mcp-server/docs/agents/project-manifest/constraints.md` — existing pattern: numbered constraints (§1–§71), each with Rule / Rationale / Example sections. §72 follows this format.
- `mcp-server/tests/gui/queue/` — existing pattern: describe blocks with `beforeEach`/`afterEach` setup/teardown. Direct validator tests will use a simpler pure-function testing style (no I/O).

## Detailed Steps

### Step 1 — Whitespace slug guard

In `mcp-server/src/gui/queue/get-queue.ts`, line 96, change:

```typescript
typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).length > 0 &&
```

To:

```typescript
typeof e['expectedSlug'] === 'string' && (e['expectedSlug'] as string).trim().length > 0 &&
```

Update the JSDoc for rule 5 (line 81) to read: "Non-empty slug — `expectedSlug` is a string with at least one non-whitespace character (rejects missing, empty-string, or whitespace-only slugs)."

### Step 2 — Add whitespace slug test

In `mcp-server/tests/gui/queue/get-queue.test.ts`, add a new test case in the existing `getQueue — validator: rejects entry with empty expectedSlug` describe block:

```typescript
it('filters out an entry whose expectedSlug is whitespace-only', async () => {
  const invalidEntry = {
    id:           'test-whitespace-slug',
    pid:          999_999_999,
    planPath:     '/fake/plans/whitespace-slug',
    expectedSlug: '   ',
    startedAt:    '2026-05-20T00:00:00Z',
    status:       'pending',
  };
  await writeFile(
    join(env.logsDir, QUEUE_FILENAME),
    JSON.stringify([invalidEntry]),
    'utf-8',
  );

  const entries = await getQueue({ logsDir: env.logsDir, ledgerRoot: env.ledgerRoot });
  expect(entries).toHaveLength(0);
});
```

### Step 3 — Split cleanup registries

In `mcp-server/gui/public/views/orchestrator.js`:

1. Rename the existing `_orchLogPreviewCleanups` declaration (line 32) and add a second array:
   ```javascript
   var _orchLogPreviewCleanups = [];
   var _orchStatusPollCleanups = [];
   ```

2. In `renderOrchestrator()` (the initial drain at lines 42–43), drain both arrays:
   ```javascript
   _orchLogPreviewCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
   _orchLogPreviewCleanups = [];
   _orchStatusPollCleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
   _orchStatusPollCleanups = [];
   ```

3. Change the `statusPollTimer` registration (line 176) from:
   ```javascript
   _orchLogPreviewCleanups.push(function () { clearInterval(statusPollTimer); });
   ```
   To:
   ```javascript
   _orchStatusPollCleanups.push(function () { clearInterval(statusPollTimer); });
   ```

4. In `refreshQueue()` (lines 195–197), drain **only** `_orchLogPreviewCleanups` — do NOT drain `_orchStatusPollCleanups`. This is the key behavioural change: queue refreshes no longer prematurely cancel the status poll timer.

5. Update the file header comment to document the second array.

### Step 4 — Extract `isRawQueueEntry()` to its own module

1. Create `mcp-server/src/gui/queue/validate-entry.ts`:
   ```typescript
   import type { RawQueueEntry } from './types.js';

   /**
    * Type-guard that validates a raw JSON value as a `RawQueueEntry`.
    * (Move existing JSDoc from get-queue.ts here unchanged.)
    */
   export function isRawQueueEntry(entry: unknown): entry is RawQueueEntry {
     // (Move existing implementation here unchanged, including the .trim() fix from Step 1.)
   }
   ```

2. In `mcp-server/src/gui/queue/get-queue.ts`:
   - Remove the `isRawQueueEntry()` function definition.
   - Add an import: `import { isRawQueueEntry } from './validate-entry.js';`
   - The `readQueueFile()` call site (`data.filter(isRawQueueEntry)`) remains unchanged.

3. Update `get-queue.ts` file header JSDoc to note that `isRawQueueEntry` has been extracted.

### Step 5 — Add direct unit tests for `isRawQueueEntry()`

Create `mcp-server/tests/gui/queue/validate-entry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isRawQueueEntry } from '../../../src/gui/queue/validate-entry.js';

describe('isRawQueueEntry', () => {
  const validEntry = {
    id: 'abc', pid: 123, planPath: '/x', expectedSlug: 'slug', startedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid entry', () => { expect(isRawQueueEntry(validEntry)).toBe(true); });
  it('rejects null', () => { expect(isRawQueueEntry(null)).toBe(false); });
  it('rejects non-object', () => { expect(isRawQueueEntry('string')).toBe(false); });
  it('rejects missing id', () => { expect(isRawQueueEntry({ ...validEntry, id: 123 })).toBe(false); });
  it('rejects float pid', () => { expect(isRawQueueEntry({ ...validEntry, pid: 1.5 })).toBe(false); });
  it('rejects zero pid', () => { expect(isRawQueueEntry({ ...validEntry, pid: 0 })).toBe(false); });
  it('rejects negative pid', () => { expect(isRawQueueEntry({ ...validEntry, pid: -1 })).toBe(false); });
  it('rejects empty expectedSlug', () => { expect(isRawQueueEntry({ ...validEntry, expectedSlug: '' })).toBe(false); });
  it('rejects whitespace-only expectedSlug', () => { expect(isRawQueueEntry({ ...validEntry, expectedSlug: '   ' })).toBe(false); });
  it('rejects missing startedAt', () => { expect(isRawQueueEntry({ ...validEntry, startedAt: undefined })).toBe(false); });
});
```

### Step 6 — Codify JSDoc closure-dependency convention (Constraint §72)

Add a new section at the end of `mcp-server/docs/agents/project-manifest/constraints.md`:

```markdown
---

### 72. JSDoc Closure-Dependency Documentation for GUI Helpers

**Rule:** Every closure-scoped helper function in `gui/public/views/*.js` that reads or mutates variables from its enclosing scope MUST include a `Closure dependencies (from <parent>() scope):` JSDoc block listing each closed-over variable with a one-line description of whether it is read-only or mutated by this helper.

**Example:**
```javascript
/** Injects action buttons into the rendered table.
 *
 *  Closure dependencies (from renderOrchestrator() scope):
 *    `expandedIds`   — mutated; toggle clicks update row expansion state.
 *    `refreshQueue`  — read-only; called after Kill/Dismiss actions. */
function _bindQueueActions(container, entries) { /* ... */ }
```

**Rationale:** Vanilla JS files lack module-level imports that make dependencies visible. Without explicit documentation, future contributors cannot determine which outer-scope variables a helper depends on without reading the entire enclosing function. This convention was established during the `2026-05-20-orchestrator-gui-polish-rework` sprint and should be applied to all new closure-scoped helpers going forward.

**Scope:** Applies only to `gui/public/views/*.js` files (vanilla JS, no module system). TypeScript modules in `src/` use explicit imports and do not need this pattern.
```

### Step 7 — Extract `_handleStartRun()` from `renderOrchestrator()`

In `mcp-server/gui/public/views/orchestrator.js`, extract the Start Run submit-handler logic (the `startBtn.addEventListener('click', function() { ... })` body, approximately lines 133–189) into a closure-scoped helper `_handleStartRun()`.

The helper receives the DOM elements it needs as parameters (`startBtn`, `planInput`, `resultsEl`) and closes over:
- `allChecksPassed` — **mutated**; reset to `false` after successful launch to re-gate the Start Run button.
- `refreshQueue` — read-only; called on success.
- `renderPreflightResults` — read-only; called in the else branch when the server returns re-evaluated checks instead of starting.
- `_orchStatusPollCleanups` — mutated; the status-poll cleanup is pushed here (after Step 3's registry split).

Add the standard JSDoc Closure-dependency block per the convention codified in Step 6.

`renderOrchestrator()` then becomes:
```javascript
startBtn.addEventListener('click', function () { _handleStartRun(startBtn, planInput, resultsEl); });
```

### Step 8 — Update documentation and manifest

1. **`mcp-server/docs/agents/project-manifest/api-surface.md`** — Add `isRawQueueEntry` to the exported functions list under the queue module section. Update the slug validation note to document the whitespace guard.
2. **`mcp-server/docs/agents/project-manifest/file-tree.md`** — Add `validate-entry.ts` to the `src/gui/queue/` directory listing.
3. **`mcp-server/changelog.md`** — Add a v1.30.4 entry documenting: whitespace slug guard, cleanup registry split, `isRawQueueEntry` extraction, Start Run handler extraction, and the new constraint §72.

## Dependencies

- Steps 1–2 must precede Step 4 (the validator code moves to a new file, so the `.trim()` fix should be in place first).
- Step 4 must precede Step 5 (direct tests import from the new module).
- Step 6 should precede Step 7 (the convention is codified before the new helper is written).
- All other steps are independent.

## Required Components

- `mcp-server/src/gui/queue/get-queue.ts` — Steps 1, 4
- `mcp-server/src/gui/queue/validate-entry.ts` — Step 4 (new file)
- `mcp-server/tests/gui/queue/get-queue.test.ts` — Step 2
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — Step 5 (new file)
- `mcp-server/gui/public/views/orchestrator.js` — Steps 3, 7
- `mcp-server/docs/agents/project-manifest/constraints.md` — Step 6
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Step 8
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Step 8
- `mcp-server/changelog.md` — Step 8

## Assumptions

- The `RawQueueEntry` type is importable from `./types.js` (confirmed — it's already exported from `types.ts`).
- The `_orchLogPreviewCleanups` array is only consumed in two places: `renderOrchestrator()` (full drain) and `refreshQueue()` (preview-only drain). No other consumer exists.
- The `statusPollTimer` is the only non-log-preview item currently stored in `_orchLogPreviewCleanups`.
- The Start Run handler logic does not reference `renderQueueTable` or the four queue helpers — it only calls `refreshQueue()` on success, making it safe to extract independently.

## Constraints

- No new npm dependencies.
- Frontend code remains vanilla JS (no modules, no build step).
- Extracted validator must remain a named export (not default) for tree-shaking compatibility.
- All existing ~2,205 tests must continue to pass.

## Out of Scope

- Full slug format validation (regex pattern matching) — the `.trim()` fix is sufficient for now.
- Replacing `flushPromises()` with `vi.runAllTimers()` — noted in synthesis but requires broader test infrastructure discussion.
- WebSocket-based real-time updates.
- Splitting `orchestrator.js` into ES modules (would require a build step for the frontend).

## Acceptance Criteria

- AC-1: `isRawQueueEntry()` rejects entries with a whitespace-only `expectedSlug` (e.g. `'   '`).
- AC-2: A dedicated test verifies that whitespace-only slugs are filtered out by the validator.
- AC-3: `_orchStatusPollCleanups` is a separate module-scoped array; `refreshQueue()` does NOT drain it; `renderOrchestrator()` drains both arrays.
- AC-4: `isRawQueueEntry()` is exported from `mcp-server/src/gui/queue/validate-entry.ts` and imported by `get-queue.ts`.
- AC-5: At least 10 direct unit tests in `validate-entry.test.ts` cover all 5 validation rules (including edge cases: null, non-object, float PID, zero PID, negative PID, empty slug, whitespace slug, missing fields).
- AC-6: Constraint §72 exists in `constraints.md` documenting the JSDoc closure-dependency convention for GUI helpers.
- AC-7: The Start Run handler is extracted into `_handleStartRun()` with a JSDoc closure-dependency block; `renderOrchestrator()` delegates to it via a one-line event listener.
- AC-8: `api-surface.md` documents `isRawQueueEntry()` as a public export; `file-tree.md` lists `validate-entry.ts`.
- AC-9: All existing ~2,205 tests pass after all changes; no TypeScript compile errors.

## Testing Strategy

- **Unit tests (Steps 2, 5):** Pure-function tests for `isRawQueueEntry()` and an integration-level test for the whitespace slug via `getQueue()`. Run via `npm test` in `mcp-server/`.
- **Regression (all steps):** Full test suite must remain green.
- **Manual verification (Steps 3, 7):** Load `http://localhost:3420/#/orchestrator`, start a run, verify the status poll timer survives a queue refresh, verify Start Run handler works correctly.

## Test Plan

- `mcp-server/tests/gui/queue/get-queue.test.ts` — **New:** "filters out an entry whose expectedSlug is whitespace-only" — asserts whitespace slug rejected — AC-1, AC-2
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "accepts a valid entry" — asserts true for well-formed input — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects null" — asserts false for null — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects non-object" — asserts false for string — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects missing id" — asserts false for numeric id — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects float pid" — asserts false for 1.5 — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects zero pid" — asserts false for 0 — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects negative pid" — asserts false for -1 — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects empty expectedSlug" — asserts false for '' — AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects whitespace-only expectedSlug" — asserts false for '   ' — AC-1, AC-5
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — **New:** "rejects missing startedAt" — asserts false for undefined — AC-5
- Full test suite (`npm test` from `mcp-server/`) — all ~2,205+ tests pass — AC-9

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `isRawQueueEntry()` export; update slug validation note with whitespace guard — AC-8
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `validate-entry.ts` to `src/gui/queue/` listing — AC-8
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add §72 (JSDoc closure-dependency convention for GUI helpers) — AC-6
- `mcp-server/changelog.md` — Add v1.30.4 entry — all items

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Splitting cleanup arrays introduces a regression where status poll timer never fires** | The status poll is only drained by `renderOrchestrator()` (full view re-render), which already clears everything. The change only prevents `refreshQueue()` from draining it — the timer self-cancels on resolution anyway. |
| **Moving `isRawQueueEntry()` to a new module breaks the internal filter call** | The import path is straightforward (`./validate-entry.js`). TypeScript compilation will catch any broken reference immediately. |
| **Start Run handler extraction changes event timing** | The extraction is purely structural — the same code executes in the same order. The event listener still calls the function synchronously. |
| **Whitespace `.trim()` changes behaviour for existing queue entries** | The Python orchestrator always derives slugs from plan filenames (`pathlib.Path.stem`), which cannot produce whitespace-only strings. This is purely defensive. |
| **New constraint §72 is too prescriptive for future GUI patterns** | The scope is explicitly limited to `gui/public/views/*.js` (vanilla JS files only). TypeScript modules are excluded. |
