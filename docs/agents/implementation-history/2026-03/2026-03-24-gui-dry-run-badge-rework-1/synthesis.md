# Synthesis Report — GUI Dry Run Badge: Synthesis Follow-Up

**Project:** `2026-03-24-gui-dry-run-badge-rework-1`
**Date:** 2026-03-24
**Status:** COMPLETE
**Work Packages:** 6 / 6 COMPLETE

---

## Executive Summary

This project addressed all actionable items from the `2026-03-24-gui-dry-run-badge` synthesis report across three parallel workstreams: (1) fixing 14 pre-existing GUI test failures that were masking regressions, (2) updating documentation to reflect the new `is_dry_run` field and naming conventions, and (3) a targeted refactor pass consolidating I/O helpers, eliminating inline styles, modernising variable declarations, and differentiating dark-mode badge colours.

All 6 work packages completed with no rework cycles. The full `mcp-server` test suite returned to a green baseline: 1731/1731 tests pass.

### What Was Built

| WP | Workstream | Outcome |
|----|------------|---------|
| WP-001 | Test fix — `api.test.ts` | Fixed 2 failing `handleGetDialogueFile` assertions (raw string → `{ content }` return type) |
| WP-002 | Test fix — `dialogue-qa.test.ts` | Fixed 12 failing dialogue-QA tests (JSON mock body + unconditional `json()`/`text()` helper) |
| WP-003 | Documentation — `is_dry_run` | Added `is_dry_run` to `RunLogEntry` in `api-surface.md` + naming rationale + JSDoc in `log-resolver.ts` |
| WP-004 | Refactor — `readLogStatus()` | Merged `isDryRun()` + `isRunActive()` into a single-read helper; halves file I/O per log entry |
| WP-005 | Refactor — style/CSS hygiene | `var` → `const`/`let` in dry-run switch cases; unique dark-mode colour for `.badge-dry-run` |
| WP-006 | Refactor — badge extraction | Extracted `buildRunBadges(item, isActive)` helper; removed inline `style="margin-right:6px"`; added `.badge + .badge` CSS spacing rule |

### Files Modified

- `mcp-server/tests/gui/api.test.ts`
- `mcp-server/tests/gui/dialogue-qa.test.ts`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/src/gui/log-resolver.ts`
- `mcp-server/gui/public/views/run-log.js`
- `mcp-server/gui/public/views/project-detail.js`
- `mcp-server/gui/public/styles.css`

---

## Metrics

| Metric | Value |
|--------|-------|
| WPs completed | 6 / 6 |
| Pipeline stages passed | 19 / 19 (implementation × 6, qa × 6, code-review × 6, security-audit × 1, documentation × 1) — all PASS |
| Tests passed (full suite) | 1731 / 1731 |
| Tests passed (GUI suite) | 383 / 383 |
| TypeScript compiler errors | 0 |
| Security findings (WP-004) | 0 Critical · 0 High · 0 Medium |
| Rework cycles | 0 |
| Reviewer Fix-Forwards applied | 2 (WP-003: naming note moved outside code fence; WP-004: stale JSDoc reference updated) |

---

## Strategic Recommendations ("Gold Nuggets")

### 1. `dialogue-qa.test.ts` lacks `try/finally` teardown guards — medium-priority fragility (MEDIUM)

Every test in `dialogue-qa.test.ts` follows the pattern:

```js
document.body.appendChild(app);
// assertions
document.body.removeChild(app);  // ← no try/finally
```

If any assertion throws, `removeChild` is never called. The stale `#wp-dialogues-section` node then cascades failures to all subsequent tests in the file — exactly the mechanism that caused the original 12-test failure chain. This was identified by Developer, QA, and Reviewer independently, and intentionally deferred from WP-002.

**Recommendation:** Create a follow-up WP to wrap all ~10 test bodies in a `try/finally { document.body.removeChild(app) }` pattern. This is a resilience improvement only — it does not affect the currently passing state.

### 2. Mixed `var`/`const` in `buildRunEventContent()` switch — low-priority consistency gap (LOW)

WP-005 converted `var` → `const`/`let` in the four dry-run cases (`run_start`, `dry_run`, `dry_run_no_ledger`, `dry_run_complete`) of the switch statement. The remaining cases (`run_end`, `run_error`, `stage_start`, etc.) still use `var`. This creates a visually inconsistent codebase that may cause confusion for contributors unfamiliar with the partial migration.

**Recommendation:** A follow-up cleanup WP to normalize all remaining switch cases in `run-log.js` to `const`/`let` would complete the modernisation started here.

### 3. `installFetchMock` silent fallback could mask misconfigured routes (LOW)

`installFetchMock` falls back to `routes[routes.length - 1]` when no route matches a request URL. This is a silent fallback — a misconfigured route pattern (e.g., `'/dialogues/file.md'` vs `'/dialogues/file'`) will match the last route without warning. Root cause of the WP-002 failures was this exact class of silent mismatch.

**Recommendation:** Add a `console.warn` (or `throw`) in the fallback path for unmatched URLs in test environments. This is a low-cost guard that would surface misconfigurations immediately in future test authoring.

### 4. `readLogStatus()` is private but high-value for direct unit testing (LOW)

`readLogStatus()` is the new single-read log-status helper in `log-resolver.ts`, replacing `isDryRun()` + `isRunActive()`. It is currently private (non-exported), with test coverage exercised indirectly through `findRunLogs()`. No combined `is_dry_run: true + is_active: true` test (in-progress dry run) exists.

**Recommendation:** Exporting `readLogStatus()` would allow a targeted describe block to be added without any behavioral change, and the combined case could be covered directly. Low priority but useful for documentation-by-test.

### 5. `archiveCompletedLogs()` now reads first-line on every file (LOW, accepted trade-off)

The `readLogStatus()` consolidation causes `archiveCompletedLogs()` to read the first line of every log file (to detect `is_dry_run`) where previously it only read the last line (via `isRunActive()`). For archival workloads scanning large numbers of completed files, this doubles the per-file read. The Security Auditor and Reviewer both confirmed this is acceptable, but noted a lighter targeted helper (`readActiveStatus()`) could be reintroduced if archival ever becomes a hot path.

---

## Next Steps for Planner

1. **[WP] Fix `try/finally` teardown guards in `dialogue-qa.test.ts`** — ~10 test functions, medium priority. Prevents DOM pollution cascades from partial test failures.
2. **[WP] Normalize remaining `var` → `const`/`let` in `buildRunEventContent()` switch** — non-dry-run cases (`run_end`, `run_error`, `stage_start`, etc.) in `run-log.js`. Low priority, consistency improvement.
3. **[Optional] Add URL-mismatch warning to `installFetchMock`** — a single `console.warn` in the fallback path would surface silent route mismatches during test authoring. Low effort.
4. **[Optional] Export `readLogStatus()` and add direct unit tests** — add a combined `is_dry_run: true + is_active: true` test case. Low priority.
