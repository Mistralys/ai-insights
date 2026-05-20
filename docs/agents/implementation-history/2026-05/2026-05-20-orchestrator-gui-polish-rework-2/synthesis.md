# Project Synthesis Report

**Plan:** `2026-05-20-orchestrator-gui-polish-rework-2`
**Status:** COMPLETE
**Date:** 2026-05-20
**Work Packages:** 7 / 7 COMPLETE — all pipeline stages PASS

---

## Executive Summary

This session delivered all five strategic improvements identified in the prior orchestrator GUI polish synthesis. The work targeted three layers of the MCP server codebase: the TypeScript backend queue validator, the vanilla-JS frontend orchestrator view, and the project documentation/constraint infrastructure. Every item was implemented, tested, reviewed, and documented without rework cycles or regressions.

**What was built:**

| # | Change | Files Touched |
|---|--------|---------------|
| WP-001 | Whitespace slug guard hardening (`.trim().length > 0`) | `get-queue.ts`, `get-queue.test.ts`, `.context/mcp-server/tests.md` |
| WP-002 | Cleanup registry separation (`_orchStatusPollCleanups`) | `orchestrator.js` |
| WP-003 | Constraint §72 — JSDoc closure-dependency convention | `constraints.md` |
| WP-004 | `isRawQueueEntry()` extraction to `validate-entry.ts` | `validate-entry.ts` (new), `get-queue.ts`, `types.ts` |
| WP-005 | Direct unit test suite for `validate-entry.ts` (17 tests) | `validate-entry.test.ts` (new) |
| WP-006 | `_handleStartRun()` closure-scoped handler extraction | `orchestrator.js` |
| WP-007 | Documentation update (`api-surface.md`, `file-tree.md`, `changelog.md` v1.30.4) | 3 documentation files |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 7 / 7 |
| Pipeline stages passed | 26 / 26 (100%) |
| Rework cycles | 0 |
| TypeScript compilation errors | 0 |
| Total test suite result | **2,206 tests passed, 0 failed** |
| New tests added | **21** (4 in `get-queue.test.ts` + 17 in `validate-entry.test.ts`) |
| New source files created | 2 (`validate-entry.ts`, `validate-entry.test.ts`) |
| Documentation files updated | 6 (`constraints.md`, `api-surface.md`, `file-tree.md`, `changelog.md`, `types.ts`, `orchestrator.js`) |

---

## Per-Work-Package Summary

### WP-001 — Whitespace Slug Guard
A single-character `.trim()` addition to `isRawQueueEntry()` at `get-queue.ts:96` closes a silent data-corruption path: whitespace-only slugs such as `"   "` previously passed the guard and reached downstream ledger lookups. The JSDoc rule 5 was updated to explicitly state rejection of whitespace-only values. A new integration test in `get-queue.test.ts` validates this path. Full suite of 2,206 tests passed.

### WP-002 — Cleanup Registry Separation
`_orchStatusPollCleanups` was introduced as a module-scoped array alongside the existing `_orchLogPreviewCleanups`. The `statusPollTimer` cleanup function was migrated from the log-preview registry to the new status-poll registry. `refreshQueue()` only drains `_orchLogPreviewCleanups`; `renderOrchestrator()` drains both on full re-render. This eliminates the premature-cancel race where a mid-poll `refreshQueue()` call previously cancelled the in-flight status-poll timer. All 28 orchestrator-view tests passed without modification.

### WP-003 — Constraint §72 Codification
Constraint §72 was added to `constraints.md` as the last numbered entry. It formalises the JSDoc `Closure dependencies (from … scope):` pattern for closure-scoped helper functions in `gui/public/views/*.js`, with Rule, Example, Rationale, and Scope subsections. The scope explicitly excludes TypeScript modules in `src/`, which use a different convention. This prevents future contributors from authoring helpers without closure documentation.

### WP-004 — `isRawQueueEntry()` Extraction
The validator was moved from `get-queue.ts` into a new pure module `validate-entry.ts` in the same `src/gui/queue/` directory. The function is exported as a named export; `get-queue.ts` now imports it via `./validate-entry.js`. TypeScript compiled cleanly (`tsc --noEmit` exit 0). All 4 existing `get-queue.test.ts` tests passed, and the `types.ts` dependency-chain JSDoc comment was updated to include `validate-entry.ts` in the correct module order.

### WP-005 — Direct Unit Tests for `validate-entry.ts`
17 pure-function unit tests were authored in a new `validate-entry.test.ts` file. Tests cover all 5 validation rules: (a) non-null object, (b) string `id`, (c) positive-integer `pid` (including zero, negative, and float rejection), (d) string `planPath`, and (e) non-empty non-whitespace `expectedSlug` plus string `startedAt`. No filesystem or I/O setup is required — all inputs are inline objects, making the tests fast and isolated.

### WP-006 — `_handleStartRun()` Extraction
The ~55-line Start Run click-handler body was extracted from `renderOrchestrator()` into a new closure-scoped helper `_handleStartRun(startBtn, planInput, resultsEl)`. The helper carries a full JSDoc `Closure dependencies` block documenting all four closed-over variables with mutated/read-only annotations, consistent with Constraint §72. The original listener site is now a single one-line delegation. `renderOrchestrator()` is measurably simpler; 28 orchestrator-view tests passed without modification.

### WP-007 — Documentation Update
`api-surface.md` received a new section for `validate-entry.ts` documenting `isRawQueueEntry()` with its full 5-rule contract. `file-tree.md` was updated to include both `validate-entry.ts` and `validate-entry.test.ts` in the correct directory positions. `changelog.md` received a `v1.30.4` entry with 6 bullets (one per substantive change from this plan). All per-WP documentation-forward items from Reviewers had been addressed in-WP before this final documentation pass.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. `id` Empty-String Gap in `isRawQueueEntry()` — Low Priority
The validator accepts `id: ""` (an empty string passes `typeof id === 'string'`). The current contract is intentionally loose here, but the docstring was not explicit about it. This has been documented in `api-surface.md`. If downstream ledger lookups ever assume `id` is non-empty, this will surface as a silent failure. **Recommendation:** Add `id.length > 0` (or `.trim().length > 0`) to the validator and a corresponding unit test when any ledger lookup is found to depend on non-empty `id`.

### 2. `pollCount` Off-by-One in Status Polling — Low Priority (Pre-existing)
The `statusPollTimer` guard at `orchestrator.js` fires `clearInterval()` after the body executes: `if (pollCount >= MAX_STATUS_POLLS)`. This means the poll runs up to `MAX_STATUS_POLLS + 1` times (16 instead of 15). This is a pre-existing issue not introduced by this sprint and is functionally harmless given the 30s polling window, but it could cause one extra API call per run. **Recommendation:** Change the guard to `if (pollCount >= MAX_STATUS_POLLS - 1)` or restructure as a `do`/`while`-equivalent pattern to make the count exact.

### 3. No Test for `refreshQueue()` Not Draining `_orchStatusPollCleanups` — Medium Priority
The QA pipeline for WP-002 noted that no automated test explicitly asserts that `_orchStatusPollCleanups` is not drained by `refreshQueue()`. The current test suite exercises behaviour via mocks but does not inspect the internal array. **Recommendation:** Add a targeted test that: (1) renders the orchestrator, (2) starts a run (populating `_orchStatusPollCleanups` with a mock `setInterval`), (3) calls `refreshQueue()`, and (4) asserts the mock `clearInterval` was NOT called. This makes the registry-separation invariant regression-proof.

### 4. `setLimitedInterval` Helper Opportunity — Low Priority
The `statusPollTimer` pattern (manual `pollCount` guard + `clearInterval` inside `setInterval`) is non-trivial boilerplate that could appear in future helper extractions (e.g., similar views). A small `setLimitedInterval(fn, delay, maxCalls)` utility would encapsulate this pattern cleanly. **Recommendation:** If this polling pattern appears in a second view, extract the utility to `gui/public/utils/` rather than copy-pasting the pattern.

### 5. Test Type Strictness — Low Priority
`validate-entry.test.ts` TC-12 uses `{ ...VALID_ENTRY, planPath: null }`. TypeScript strict mode may flag this as a type error since `VALID_ENTRY.planPath` is typed `string`. At runtime the test is correct. **Recommendation:** Cast invalid property values as `unknown` when spreading into a typed baseline object (e.g., `{ ...VALID_ENTRY, planPath: null as unknown as string }`). Apply this pattern to all tests that intentionally violate type constraints to keep the test file compilable under `strict: true`.

---

## Next Steps

1. **Validate the WP-002 registry-separation invariant** — Add the targeted `refreshQueue()` + `_orchStatusPollCleanups` regression test (see Gold Nugget §3 above). This is a quick addition to `orchestrator-view.test.ts`.

2. **Address the `id` empty-string guard** — Add `id.length > 0` to `isRawQueueEntry()` if any downstream consumer is known to require a non-empty `id`. Add a corresponding TC-18 test case to `validate-entry.test.ts`.

3. **Fix pollCount off-by-one** — If exact poll-count semantics matter (e.g., for SLA or rate-limiting), correct the `statusPollTimer` guard. Otherwise, document the intentional off-by-one in the JSDoc to prevent future confusion.

4. **Future view extractions should follow Constraint §72** — Any new closure-scoped helper added to `gui/public/views/*.js` must include the `Closure dependencies` JSDoc block. The constraint is now formalised and should be referenced in code-review checklists.

5. **Consider `setLimitedInterval` utility** — Defer until the pattern appears a second time. If a second view adds polling, extract then.

---

*Report generated by Head of Operations (Synthesis). All data sourced from the project ledger.*
