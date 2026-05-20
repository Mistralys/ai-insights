# Synthesis Report — Orchestrator GUI Polish

**Project:** `2026-05-19-orchestrator-gui-polish`
**Date:** 2026-05-20
**Status:** COMPLETE
**Work Packages:** 5 / 5 complete

---

## Executive Summary

This sprint delivered five targeted polish improvements to the orchestrator GUI run queue view. All five features were scoped, implemented, validated, reviewed, and documented within a single session. The changes are low-risk and confined to three files in the MCP server GUI layer:

| Feature | Description | Files Changed |
|---|---|---|
| **`projectExists` field + View Project gating** | Backend exposes a `projectExists: boolean` field so the UI can gate the "View Project" button on actual ledger existence rather than heuristic `effectiveStatus` inference. | `types.ts`, `get-queue.ts`, `orchestrator.js`, `get-queue.test.ts` |
| **Auto-clear launch success banner** | The "Waiting for the run…" success banner is automatically removed once the run queue renders with at least one entry. Error banners are unaffected. | `orchestrator.js` |
| **Human-friendly log preview labels** | `formatLogAction(entry)` maps all 13 JSONL action types to readable strings (e.g., `tool_call` → `"Tool call: ledger_help"`). The progress badge is intentionally unchanged. | `orchestrator-widgets.js`, `orchestrator-widgets.test.ts` |
| **Most-recent-first log ordering** | Log preview entries are prepended rather than appended — newest events always appear at the top without scrolling. | `orchestrator-widgets.js`, `orchestrator-widgets.test.ts` |
| **Scroll position preservation** | `window.scrollY` is saved before and restored after every `renderQueueTable()` call, preventing the 5-second polling cycle from jumping the viewport back to the top. | `orchestrator.js` |

---

## Metrics

| Metric | Value |
|---|---|
| Total tests passing | **2,201** |
| Tests failing | **0** |
| Work packages | **5 / 5 COMPLETE** |
| Rework cycles | 1 (WP-003: one QA bounce + one documentation rework; both resolved) |
| Pipeline stages passed | **18 / 20** (WP-004 and WP-005 did not require documentation pipelines) |
| Files modified (net) | `orchestrator.js`, `orchestrator-widgets.js`, `types.ts`, `get-queue.ts`, `get-queue.test.ts`, `orchestrator-view.test.ts`, `orchestrator-widgets.test.ts`, + docs/CTX |

---

## Work Package Summaries

### WP-001 — Auto-clear Launch Success Banner
**Status:** COMPLETE (4/4 pipeline stages PASS, 0 reworks)

Added a 5-line banner-clearing block inside `renderQueueTable` in `orchestrator.js`. When entries are present, `resultsEl.querySelector('.success-banner')` removes the banner. Error banners (`error-banner` class) are never touched. All 3 ACs met, 66 existing tests green.

**Open items flagged (non-blocking):**
- No dedicated unit tests for the banner-clearing path in `orchestrator-view.test.ts`. Three test cases recommended: (1) success banner cleared on non-empty render, (2) error banner NOT cleared, (3) banner preserved when queue is empty.
- `statusPollTimer` (Start Run handler, lines ~143–161) is not cleared on view teardown — orphaned interval is benign but mild resource debt.

---

### WP-002 — Human-Friendly Log Preview Labels (`formatLogAction`)
**Status:** COMPLETE (4/4 pipeline stages PASS, 0 reworks)

Added `formatLogAction(entry)` to the `OrchestratorWidgets` IIFE with a `switch` over 13 JSONL action types and a graceful title-case + JSON fallback for unknowns. Updated `renderLogPreview` to call this helper. 18 new unit tests added; all 59 widget tests pass. JSDoc `@param` updated to `{object|null|undefined}` documenting the falsy-entry fallback. `api-surface.md` and `file-tree.md` updated; CTX context regenerated.

**Open items flagged (non-blocking):**
- The `(entry.stage || '')` and `(entry.wp_id || '')` graceful-suffix patterns for dynamic fields are not explicitly unit tested (low risk).

---

### WP-003 — `projectExists` Field + Scroll Position Preservation
**Status:** COMPLETE (4/4 documentation stages PASS; 1 implementation rework + 1 QA bounce + 1 documentation rework)

This WP contained the most activity of the sprint. Two features were delivered:

**`projectExists` feature (work/WP-005.md):**
- `QueueEntry` interface extended with `projectExists: boolean` in `types.ts` with `@remarks` documenting the enriched-field composition.
- `getQueue()` in `get-queue.ts` populates the field via `{ exists: projectExists }` destructuring from `getProjectLedgerStatus()`.
- `orchestrator.js` action-button branch order corrected to `pending → dead → projectExists` (critical fix: a dead entry with a known slug was incorrectly reaching the View Project branch).
- `makeEntry()` factory in `orchestrator-view.test.ts` updated to include `projectExists: true` as a default field.
- `getProjectLedgerStatus()` `@returns` tag added; `writeQueue()` PID comment tightened; CTX context gap resolved (new `source-gui.md` context document, 62.6 KB).
- 2,201 tests green.

**Scroll position preservation (work/WP-003.md — resolved late in the pipeline):**
- `var savedScrollY = window.scrollY;` added at the start of `renderQueueTable()`.
- `window.scrollTo(0, savedScrollY);` added as the final statement after all post-render DOM manipulation (action buttons → log previews → toggle listeners).
- Inline comments explain the `window.scrollY` vs. `container.scrollTop` design decision.

> **Ledger anomaly (resolved):** WP-003's ledger entry initially contained misattributed scroll-preservation ACs (belonging to `work/WP-003.md`) alongside `projectExists` ACs (from `work/WP-005.md`). The Documentation agent implemented the scroll logic to satisfy all 9 ACs, resolving the anomaly without PM intervention. Future PM action: audit WP spec file–to–ledger entry mappings at plan creation time.

---

### WP-004 — Most-Recent-First Log Preview Order
**Status:** COMPLETE (3/4 pipeline stages PASS; documentation pipeline not active for this WP)

Changed `renderLogPreview` from `appendChild` to a reverse-order for-loop with `insertBefore(div, container.firstChild)`. Within a polled batch, chronological order is preserved by iterating in reverse. 1 new cross-poll ordering test added; all 2,201 tests pass.

**Open items flagged (non-blocking):**
- Test file header comment (line 13) still reads `"appends new events"` — should read `"prepends new events (most-recent-first ordering)"`.
- `.catch` in `fetchEntries` silently swallows API errors; a failed fetch won't advance `afterLine`, creating potential momentary duplication on retry. Acceptable for best-effort log preview.

---

### WP-005 — `projectExists` (duplicate verification WP)
**Status:** COMPLETE (3/4 pipeline stages PASS; documentation pipeline not active for this WP)

> **Context:** WP-005's `work_package_file` pointed to `work/WP-001.md` (the "Clear launch success banner" spec) but its acceptance criteria mirrored WP-003's `projectExists` criteria exactly — a ledger configuration anomaly noted at project-level comments. The Developer found all 6 ACs already satisfied by WP-003's implementation, and the full pipeline completed cleanly.

All 6 ACs verified: `projectExists` field in `types.ts`, `getQueue()` population, button gating with strict `=== true`, truthy-slug check, unit tests for both branches, 2,201 tests green. The `effectiveStatus === 'started'` with `projectExists === false` edge case is structurally impossible (confirmed by inspecting `compute-effective-status.ts`). `encodeURIComponent` applied to slug in href.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. The `makeEntry()` Factory Anti-Pattern — Address Soon
**Priority: Medium**

The `makeEntry()` helper in `orchestrator-view.test.ts` uses `Record<string, unknown>` rather than `Partial<QueueEntry>`, meaning the TypeScript compiler cannot catch missing required fields at test-authoring time. The `projectExists` regression in WP-003 was directly caused by this gap. Recommendation: convert the factory to `(overrides: Partial<QueueEntry> = {}): QueueEntry` once the test file can import the TypeScript type. This prevents the same class of regression from recurring with every `QueueEntry` extension.

### 2. `renderQueueTable` — Complexity Debt Accumulating
**Priority: Low (watch)**

`renderQueueTable` in `orchestrator.js` has grown to ~130 lines and now mixes HTML string building, DOM injection, event binding, banner-clearing, and scroll-position save/restore. Three agents independently flagged this. Consider extracting helpers (`_buildQueueHtml`, `_bindQueueEvents`, `_mountLogPreviews`) in a future refactor to improve readability and testability.

### 3. `statusPollTimer` Resource Leak — Minor Hygiene
**Priority: Low**

The `statusPollTimer` in the Start Run handler (lines ~143–161) is never cleared on view teardown. While benign today (the callback no-ops on a stale `resultsEl`), adding a cleanup registration to `_orchLogPreviewCleanups` would eliminate the orphaned interval and prevent the pattern from being replicated as the view grows.

### 4. Add Banner-Clearing Tests — Coverage Gap
**Priority: Medium**

The banner-clearing path added in WP-001 has no dedicated test coverage. Three recommended test cases for `orchestrator-view.test.ts`:
1. Success banner is removed when `renderQueueTable` receives non-empty entries.
2. Error banner is NOT removed when `renderQueueTable` receives non-empty entries.
3. Banner remains when queue is empty on refresh.

### 5. CTX Context Gap Resolved — Source GUI Layer Now Visible
**Priority: Informational**

`src/gui/**/*.ts` was entirely absent from `mcp-server/module-context.yaml` before this sprint. The Documentation agent added a new `"MCP Server - Source (GUI)"` document entry and generated `source-gui.md` (62.6 KB). All future agents working on the GUI queue backend layer will now have correct context.

### 6. `isRawQueueEntry()` Validator — Minor Tightening Opportunity
**Priority: Low**

`isRawQueueEntry()` in `get-queue.ts` validates `typeof e['expectedSlug'] === 'string'` but does not reject empty strings. While the UI guard (`entry.projectExists === true && entry.expectedSlug`) correctly handles this, a validator-level empty-string guard would harden the contract. Consider adding `&& e['expectedSlug'].length > 0`.

---

## Ledger Anomalies (for Post-Sprint PM Review)

| Anomaly | Severity | Recommended Action |
|---|---|---|
| WP-003 ledger contained scroll-preservation ACs from `work/WP-003.md` but `work_package_file` pointed to `work/WP-005.md`. | Medium | Documentation agent self-resolved by implementing the scroll feature. PM should audit spec-file–to–WP mappings at plan creation. |
| WP-005 ledger had `work_package_file = work/WP-001.md` (banner spec) but `projectExists` ACs — a mismatch noted by Documentation agent. | Low | WP was completed cleanly. No active risk, but the root mapping confusion should be prevented by schema-level validation in the ledger tooling. |

---

## Next Steps for Planner / Manager

1. **[High]** Add 3 banner-clearing unit tests to `orchestrator-view.test.ts` (WP-001 coverage gap).
2. **[Medium]** Convert `makeEntry()` to `Partial<QueueEntry>` typed factory to prevent future regression classes.
3. **[Low]** Fix the `AC-4` header comment in `orchestrator-widgets.test.ts` line 13 (`"appends"` → `"prepends"`).
4. **[Low]** Address `statusPollTimer` cleanup in the Start Run handler.
5. **[Low]** Consider extracting sub-functions from `renderQueueTable` as it continues to grow.
6. **[Future]** Consider a dedicated ledger WP for `work/WP-003.md` scroll-preservation spec tracking — the feature was implemented inline as part of WP-003's documentation rework, but a standalone WP would have provided cleaner traceability.

---

*Report generated by Head of Operations (Synthesis Agent) — 2026-05-20*
