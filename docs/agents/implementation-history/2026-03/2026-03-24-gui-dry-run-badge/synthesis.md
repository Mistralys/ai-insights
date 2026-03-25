# Synthesis Report: GUI Dry Run Badge

**Project:** `2026-03-24-gui-dry-run-badge`
**Date:** 2026-03-24
**Release:** mcp-server v1.19.0
**Status:** COMPLETE — all 5 work packages passed

---

## Executive Summary

This session delivered end-to-end visual identification of dry-run orchestrator executions in the GUI. Prior to this work, dry-run log files were indistinguishable from real runs in the project detail view and run-log viewer. The feature now surfaces a purple dashed "Dry Run" badge at every point in the GUI where run status is displayed.

**Five work packages completed in sequence:**

| WP | Scope | Key Deliverable |
|----|-------|-----------------|
| WP-001 | Backend | `RunLogEntry.is_dry_run` field; `isDryRun()` helper; populated by `findRunLogs()` |
| WP-002 | CSS | `.badge-dry-run` with light and dark mode variants |
| WP-003 | Frontend | Dry Run badge in project-detail run list and `run_start` timeline card |
| WP-004 | Frontend | Dry-run event renderers for `dry_run`, `dry_run_no_ledger`, `dry_run_complete` |
| WP-005 | QA | Integration validation; 144 tests passing across all 5 scope files |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed (WP-005 QA) | **144** |
| Tests failed | **0** |
| Pre-existing unrelated failures | 14 (api.test.ts, dialogue-qa.test.ts — not regressions) |
| Files modified (total across session) | 7 |
| All acceptance criteria met | **Yes (19/19)** |
| Pipeline health (all stages PASS) | **5/5 WPs** |

**Files modified:**
- `mcp-server/src/gui/log-resolver.ts`
- `mcp-server/gui/public/styles.css`
- `mcp-server/gui/public/views/project-detail.js`
- `mcp-server/gui/public/views/run-log.js`
- `mcp-server/tests/gui/log-resolver.test.ts`
- `mcp-server/tests/gui/run-log-handlers.test.ts`
- `mcp-server/tests/gui/run-log.test.ts`
- `mcp-server/tests/gui/project-detail-runs.test.ts`

---

## Strategic Recommendations

### High Priority

**Fix the 14 pre-existing test failures.** Two test files — `api.test.ts`
(handleGetDialogueFile returns `{content:…}` object instead of raw string) and
`dialogue-qa.test.ts` (`#wp-dialogues-section` not found, `res.json` not a
function) — have been broken for at least this session. These are unrelated to
the dry-run feature but create noise in the test suite and obscure regressions.
Track these in a dedicated WP and resolve them before the next GUI feature
session.

### Medium Priority

**Document the `is_dry_run` vs `dry_run` naming split in the GUI API surface
docs.** The RunEntry list endpoint exposes `item.is_dry_run` (populated by the
log resolver) while the individual log-event schema uses `entry.dry_run`
(directly from the JSONL event). Both are correct and intentional — but without
documentation, future contributors will be confused. Add a note to the GUI API
surface docs clarifying the two origins.

**Add JSDoc clarification to `RunLogEntry.is_dry_run`.** The interface field
should document that it defaults to `false` for unreadable, malformed, or empty
files, consistent with the fail-safe behavior already documented on `isDryRun()`
itself. This prevents defensive over-engineering by future callers who might
otherwise guard against undefined.

### Low Priority (Refactor Backlog)

**Merge `isDryRun()` and `isRunActive()` into a single file read.** Both
helpers currently read the same log file independently per entry. For typical
log sizes this is acceptable, but a combined helper that extracts both the
first and last non-empty line in one pass would halve I/O per file. Surfaced by
both Developer and Reviewer.

**Extract a `buildRunBadges(item, isActive)` helper in `project-detail.js`.**
Badge rendering logic is currently inline HTML string concatenation. As more
badge types are added this becomes harder to maintain. A small extraction would
pay off immediately.

**Move badge spacing from inline `style` to a CSS utility class.** Both the
Running and Dry Run badges use `style="margin-right:6px"` inline. A
`.badge + .badge` spacing rule in `styles.css` would eliminate the repetition
and make badge spacing consistent across all future badge types.

**Convert `var` to `const`/`let` in run-log.js switch cases.** The three new
dry-run action cases declare bindings via `var` following the existing
convention. A future pass converting all affected cases to block-scoped
declarations would eliminate the theoretical risk of silent failures if the
switch is ever de-blocked.

**Unique dark mode background for `.badge-dry-run`.** The dark mode variant
currently shares the `#2e1065` background with `.badge-runner`. The dashed
border is the effective differentiator. A distinct background would make the
class independently identifiable, but this is a cosmetic trade-off.

---

## Technical Observations

- **Badge placement convention split (non-blocking):** Dry-run action event
  cards (`dry_run`, etc.) lead with the badge before the action heading, while
  the `run_start` card appends the badge after the heading. Both conventions are
  consistent within their event types and cause no user confusion, but future
  event card authors should be aware which convention applies.

- **`escapeHtml(String(entry.stage).replace(/_/g, ' '))` order is correct:**
  stringify → underscore-replace → HTML-escape. Matches the pattern in
  `stage_start` and `stage_complete`. Worth calling out explicitly since HTML
  escaping must always be the final step.

- **Minor coverage gap (non-blocking):** The `handleListRunLogs` dual-source
  merge integration tests do not include an `is_dry_run: true` variant for an
  `orchestratorLogsDir`-side dry run. `isDryRun()` unit tests own the logic
  comprehensively; this gap is low risk but a single additional test would
  close it.

---

## Next Steps for Planner / Manager

1. **Track the 14 pre-existing GUI test failures** in a new WP — they are
   blocking clean CI for any future GUI work.
2. **Documentation sprint:** Update the GUI API surface docs with the
   `is_dry_run` vs `dry_run` naming rationale (can be a one-line note).
3. **Refactor candidate:** The `isDryRun() + isRunActive()` dual-read is the
   most impactful low-effort refactor; consider bundling it with the next
   `log-resolver.ts` touch.
4. **Changelog:** Root changelog entry and mcp-server v1.19.0 module entry
   should be updated to document this feature release.
