# Plan — GUI Dry Run Badge: Synthesis Follow-Up

## Summary

Address all actionable items from the `2026-03-24-gui-dry-run-badge` synthesis report. This covers three categories: (1) fixing 14 pre-existing GUI test failures that block clean CI, (2) updating documentation to reflect the new `is_dry_run` field and naming conventions, and (3) a targeted refactor pass to reduce I/O redundancy, eliminate inline styles, modernize variable declarations, and improve dark-mode badge differentiation.

## Architectural Context

The GUI subsystem lives in `mcp-server/gui/` (static frontend) and `mcp-server/src/gui/` (backend handlers). Key files touched by the preceding dry-run badge session:

- **Backend:** `mcp-server/src/gui/log-resolver.ts` — `RunLogEntry` interface, `isDryRun()`, `isRunActive()`, `findRunLogs()`
- **Handlers:** `mcp-server/src/gui/handlers/run-log-handlers.ts` — thin API wrappers
- **Frontend:** `mcp-server/gui/public/views/project-detail.js` — run list rendering with badge HTML
- **Frontend:** `mcp-server/gui/public/views/run-log.js` — event card rendering (`dry_run`, `dry_run_no_ledger`, `dry_run_complete`)
- **Styles:** `mcp-server/gui/public/styles.css` — `.badge-dry-run`, `.badge-runner` classes
- **Docs:** `mcp-server/docs/agents/project-manifest/api-surface.md` — GUI API surface (currently stale)

Pre-existing test failures are in:

- `mcp-server/tests/gui/api.test.ts` — `handleGetDialogueFile` tests expect raw string but handler returns `{ content: … }`
- `mcp-server/tests/gui/dialogue-qa.test.ts` — `#wp-dialogues-section` not found, `res.json` not a function

## Approach / Architecture

Three parallel workstreams, ordered by priority:

1. **Test fixes (High):** Diagnose and fix the 14 pre-existing failures in `api.test.ts` and `dialogue-qa.test.ts`. These are test/handler contract mismatches, not dry-run regressions.
2. **Documentation (Medium):** Update `api-surface.md` to include `is_dry_run` in the `RunLogEntry` interface and document the `is_dry_run` vs `dry_run` naming rationale. Add JSDoc to the `RunLogEntry.is_dry_run` field.
3. **Refactor pass (Low):** Merge `isDryRun()` + `isRunActive()` into a single-read helper, extract a badge-building helper in `project-detail.js`, move inline badge spacing to CSS, convert `var` to `const`/`let` in `run-log.js` dry-run cases, and give `.badge-dry-run` a unique dark-mode background.

## Rationale

- The test failures create noise that masks future regressions — fixing them is a CI hygiene prerequisite.
- The stale `api-surface.md` violates the manifest-as-source-of-truth principle from AGENTS.md.
- The `isDryRun()` + `isRunActive()` merge halves file I/O per log entry — the most impactful low-effort refactor identified by both Developer and Reviewer in the synthesis.
- The remaining refactors are small, contained, and prevent pattern drift as more badges/event types are added.

## Detailed Steps

### Workstream 1 — Fix Pre-Existing GUI Test Failures (High Priority)

1. **Diagnose `handleGetDialogueFile` contract mismatch.** Read the current `handleGetDialogueFile` implementation in `mcp-server/src/gui/handlers/` and compare its return type against the 6 test assertions in `mcp-server/tests/gui/api.test.ts` (around L1354+). Determine whether the handler was intentionally changed to return `{ content: string }` or whether the tests should use `.content`.
2. **Fix `api.test.ts` assertions.** Update the 6 `handleGetDialogueFile` tests to match the handler's actual return contract. If the handler returns `{ content }`, change assertions from `expect(result).toBe(content)` to `expect(result.content).toBe(content)` (or vice versa if the handler should be reverted).
3. **Diagnose `dialogue-qa.test.ts` failures.** Identify why `#wp-dialogues-section` is not found in the jsdom render output. Check whether `renderWorkPackageDetail` still emits the `<div id="wp-dialogues-section">` placeholder. Also check the `res.json` issue — verify whether `API.getDialogueContent` calls `res.text()` or `res.json()` and ensure the test's fetch mock provides the matching method.
4. **Fix `dialogue-qa.test.ts`.** Update the DOM expectations and/or fetch mock to match the current implementation. Ensure all 8+ tests in this file pass.
5. **Run full GUI test suite** (`npm test -- tests/gui/`) and confirm zero failures.

### Workstream 2 — Documentation (Medium Priority)

6. **Update `RunLogEntry` in `api-surface.md`.** Add `is_dry_run: boolean` to the `RunLogEntry` interface definition (currently at line ~1862). The field description: `true when the first JSONL entry is a run_start with dry_run: true; defaults to false for unreadable/empty files`.
7. **Add naming rationale note.** Below the updated `RunLogEntry` interface in `api-surface.md`, add a note explaining the naming split: the list endpoint exposes `item.is_dry_run` (derived by `log-resolver.ts` from the file's first event) while individual log events use `entry.dry_run` (directly from the JSONL schema). Both are correct — one is a computed summary field, the other is the raw event property.
8. **Add JSDoc to `RunLogEntry.is_dry_run`.** In `mcp-server/src/gui/log-resolver.ts` (line ~67), add a JSDoc comment to the `is_dry_run` field documenting that it defaults to `false` for unreadable, malformed, or empty files — consistent with `isDryRun()`'s fail-safe behavior.

### Workstream 3 — Refactor Pass (Low Priority)

9. **Merge `isDryRun()` + `isRunActive()` into `readLogStatus()`.** In `mcp-server/src/gui/log-resolver.ts`, replace the two separate functions with a single `readLogStatus(filePath): Promise<{ is_active: boolean; is_dry_run: boolean }>` that reads the file once, parses the first line for dry-run detection and the last line for active detection. Update `findRunLogs()` to call the merged helper instead of `Promise.all([isRunActive(…), isDryRun(…)])`.
10. **Update tests for merged helper.** The existing unit tests for `isDryRun()` and `isRunActive()` (in `mcp-server/tests/gui/log-resolver.test.ts`) should be refactored to test `readLogStatus()` instead. Preserve all existing assertions.
11. **Extract `buildRunBadges(item, isActive)` in `project-detail.js`.** In `mcp-server/gui/public/views/project-detail.js` (around line 487), extract the badge-building logic into a function `buildRunBadges(item, isActive)` that returns the concatenated badge HTML. Call it from the run list rendering.
12. **Move badge spacing to CSS.** In `mcp-server/gui/public/styles.css`, add a `.badge + .badge { margin-left: 6px; }` rule (or equivalent `.badge:not(:last-child)` spacing rule). Remove the inline `style="margin-right:6px"` from both badge `<span>` elements in `project-detail.js`.
13. **Convert `var` to `const` in `run-log.js` dry-run cases.** In `mcp-server/gui/public/views/run-log.js`, change the `var` declarations in the `dry_run`, `dry_run_no_ledger`, `dry_run_complete`, and `run_start` dry-run badge cases to `const`. Each case is already block-scoped with `{ }`.
14. **Unique dark-mode background for `.badge-dry-run`.** In `mcp-server/gui/public/styles.css` (around line 1503), change the `[data-theme="dark"] .badge-dry-run` background from `#2e1065` (shared with `.badge-runner`) to a distinct value (e.g., `#3b0764` — slightly different purple shade). The dashed border already differentiates visually; this makes the class independently identifiable.
15. **Run full test suite.** Verify all GUI tests pass after refactoring. Verify no visual regressions in badge rendering.

## Dependencies

- Workstream 2 (docs) and Workstream 3 (refactor) are independent of each other.
- Workstream 1 (test fixes) should be completed first so Workstream 3's test modifications start from a green baseline.
- Step 10 depends on step 9 (merged helper must exist before tests are refactored).
- Step 12 depends on step 11 (badge helper extraction simplifies removal of inline styles).

## Required Components

- `mcp-server/tests/gui/api.test.ts` — test assertions to fix
- `mcp-server/tests/gui/dialogue-qa.test.ts` — DOM expectations and fetch mock to fix
- `mcp-server/src/gui/handlers/` — handler implementations to read (diagnosis only)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — manifest update for `RunLogEntry`
- `mcp-server/src/gui/log-resolver.ts` — JSDoc addition + `readLogStatus()` refactor
- `mcp-server/tests/gui/log-resolver.test.ts` — test refactor for merged helper
- `mcp-server/gui/public/views/project-detail.js` — badge helper extraction + inline style removal
- `mcp-server/gui/public/views/run-log.js` — `var` → `const` conversion
- `mcp-server/gui/public/styles.css` — badge spacing rule + dark-mode background tweak

## Assumptions

- The 14 pre-existing failures are test/mock contract mismatches, not deeper implementation bugs. If root-cause analysis reveals handler-side bugs, scope may expand.
- The `handleGetDialogueFile` return type was intentionally changed to `{ content: string }` (matching the pattern of `handleGetPlanDocument` and `handleGetSynthesisDocument`), so the tests need updating rather than the handler.
- The merged `readLogStatus()` helper maintains identical external behavior — no functional change to `findRunLogs()` output.

## Constraints

- No changes to the JSONL log file schema. The `dry_run` field name in events is locked.
- The GUI frontend uses ES5-style vanilla JS by convention — no module imports, no build step. `const`/`let` are fine but no `import`/`export`.
- Cross-platform: all path operations must use `path.join()`/`path.resolve()`.
- Manifest-first: `api-surface.md` must be updated before or alongside any API-facing code changes.

## Out of Scope

- Adding the `is_dry_run: true` variant to the `handleListRunLogs` dual-source merge integration test (mentioned as a minor coverage gap in the synthesis — too narrow for this plan).
- Badge placement convention unification (synthesis explicitly called this non-blocking).
- Full `var` → `const`/`let` sweep across all of `run-log.js` and `project-detail.js` (only the dry-run cases are in scope).
- Changelog updates (already completed: mcp-server v1.19.0, root v1.12.0).

## Acceptance Criteria

- All 14 pre-existing GUI test failures in `api.test.ts` and `dialogue-qa.test.ts` are resolved.
- Full GUI test suite (`npm test -- tests/gui/`) passes with 0 failures.
- `api-surface.md` `RunLogEntry` interface includes `is_dry_run: boolean` with documentation.
- `api-surface.md` contains a naming rationale note for `is_dry_run` vs `dry_run`.
- `RunLogEntry.is_dry_run` has a JSDoc comment in `log-resolver.ts`.
- `isDryRun()` and `isRunActive()` are replaced by a single `readLogStatus()` helper.
- Each log file is read once (not twice) by `findRunLogs()`.
- Badge rendering in `project-detail.js` uses an extracted helper function.
- No inline `style="margin-right:6px"` remains on badge elements — spacing is CSS-driven.
- `var` declarations in `run-log.js` dry-run cases are `const`.
- `.badge-dry-run` has a distinct dark-mode background color (not identical to `.badge-runner`).

## Testing Strategy

- **Workstream 1:** Run the specific failing test files first (`api.test.ts`, `dialogue-qa.test.ts`) to confirm fixes, then run the full GUI suite.
- **Workstream 3:** After each refactor step, run the relevant test file to catch regressions immediately. After the `readLogStatus()` merge, run `log-resolver.test.ts`. After badge/CSS changes, do a visual spot-check in the browser.
- **Final gate:** Full `npm test` across the entire mcp-server to ensure no cross-contamination.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Test failures have deeper root cause than contract mismatch** | Diagnose before fixing — read handler implementations first. If a handler bug is found, flag it as expanded scope. |
| **`readLogStatus()` merge changes edge-case behavior** | Preserve all existing test assertions. The merged helper must return identical results for empty files, unreadable files, single-line files, and multi-line files. |
| **Badge CSS spacing rule affects non-badge elements** | Scope the rule narrowly: `.badge + .badge` selector only targets adjacent badges. |
| **`const` in switch cases causes issues in older browsers** | Each dry-run case is already wrapped in `{ }` block scope. `const` inside block-scoped cases is safe in all supported environments. |
