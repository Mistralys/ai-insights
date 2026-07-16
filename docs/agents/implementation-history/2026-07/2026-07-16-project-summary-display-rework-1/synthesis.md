# Synthesis Report — project-summary-display-rework-1

**Plan:** `2026-07-16-project-summary-display-rework-1`
**Date:** 2026-07-16
**Status:** COMPLETE
**Work Packages:** 6 / 6 complete
**Pipeline Stages:** 21 / 21 passed (6 WPs × average 3.5 stages)

---

## Executive Summary

This project delivered seven improvements across four areas: (1) `ledger_import_standalone`
gains full `project_summary` support, mirroring `ledger_initialize_project` and completing the
MCP tool parity promised by the earlier `project-summary-display` project; (2) `CLAUDE.md` drift
is structurally eliminated by replacing 900+ lines of duplicated content with a single
`@AGENTS.md` include directive; (3) the GUI project-detail view is hardened with a
`document.fonts.ready` guard, a rendering-asymmetry comment, and `font-family: inherit` CSS;
(4) the outcome-synopsis block now updates in-place during poll cycles without requiring a full
page reload; and (5–6) both the Ledger Bootstrapper and Standalone Archiver personas are updated
with explicit, measurable guards for when to omit `project_summary` — anchoring the
agent-side contract to match the newly expanded MCP tool surface.

All 20 files were changed by implementation or documentation agents. The MCP server test suite
passed at 3436/3436 with zero regressions throughout the cycle.

---

## Metrics

| Metric | Value |
|---|---|
| MCP server tests passed | 3436 |
| MCP server tests failed | 0 |
| Test files | 115 |
| Personas checked (--check) | 120 |
| New test cases added | 6 (4 standalone-import + 2 diff-detection) |
| Reviewer Fix-Forwards applied | 2 (WP-004, WP-006) |
| WPs complete | 6 / 6 |
| Pipeline stages passed | 21 / 21 |
| Blocking issues | 0 |
| TypeScript compile errors | 0 |

---

## Work Package Outcomes

### WP-001 — `ledger_import_standalone` `project_summary` parameter

**Scope:** MCP tool schema, storage, help content, tests, docs, AGENTS.md
**Stages:** implementation → qa → code-review → documentation (all PASS)

Added `project_summary?: string` (min 1) to `ImportStandaloneSchema` with key-presence spread
through `importStandalone()` → `LedgerStore.importStandaloneProject()` → `writeRootIndex()`
auto-sync to `.meta.json`. Backward-compatible: omitting the field leaves root index shape
unchanged. Help content updated with an `## Optional Parameters` section, including a note that
whitespace-only strings technically pass `min(1)`. 4 new tests cover all cases
(persistence, .meta.json sync, backward compat, empty-string rejection). Manifest docs updated
across api-surface.md, file-tree.md, AGENTS.md, and CLAUDE.md.

**Files modified:** `standalone-import.ts`, `ledger-store.ts`, `help-content.ts`,
`standalone-import.test.ts`, `api-surface.md`, `file-tree.md`, `AGENTS.md`, `CLAUDE.md`

---

### WP-002 — CLAUDE.md drift elimination

**Scope:** Root CLAUDE.md
**Stages:** documentation (PASS)

Replaced the 900+-line CLAUDE.md (which was a full copy of AGENTS.md plus a stale auto-generated
NOTE comment) with a single `@AGENTS.md` include directive. The pattern was already in production
in `ai-persona-builder/CLAUDE.md` and `cli-menu/CLAUDE.md`. All future AGENTS.md edits now
propagate to Claude Code without any manual sync.

**Files modified:** `CLAUDE.md`

---

### WP-003 — GUI synopsis toggle hardening

**Scope:** `project-detail.js`, `styles.css`, `api-surface.md`
**Stages:** implementation → qa → code-review → documentation (all PASS)

Three targeted GUI changes:
- **`document.fonts.ready` guard:** Wraps the synopsis toggle IIFE in a `fontsReady.then()`
  callback, with `Promise.resolve()` fallback for jsdom and legacy browsers. Prevents incorrect
  truncation detection when fonts have not finished loading.
- **Rendering-asymmetry comment:** 4-line inline comment above the synopsis IIFE explicitly
  documenting that `project_summary` is plain text (render directly) while `extractSynopsis()`
  returns Markdown (render via `marked`). Prevents accidental double-escaping in future work.
- **`font-family: inherit` CSS:** Added to `.plan-synopsis__toggle` to prevent button font
  inheritance failures on certain OS/browser combinations.

**Files modified:** `project-detail.js`, `styles.css`, `api-surface.md`

---

### WP-004 — Outcome-synopsis live-update (poll-loop integration)

**Scope:** `project-detail.js`, `project-detail-helpers.js`, `project-detail-diff.test.ts`,
`file-tree.md`
**Stages:** implementation → qa → code-review → documentation (all PASS)

The outcome-synopsis block now follows the synthesis-link-row pattern exactly: a
`<div id="outcome-synopsis">` is always pre-rendered (hidden when empty), populated and
revealed by `_patchOutcomeSynopsis()` during data-only poll cycles. `_snapshotProjectState()`
captures `outcome_summary`; `_diffProjectState()` classifies changes as `data-only` and triggers
the patch function — so synthesis completion appears without a page reload.

**Reviewer Fix-Forward:** Added `outcome_summary` to the `Snapshot` type and two test cases
(`null → value` and `value → null`) to `project-detail-diff.test.ts` (23/23 tests green),
addressing the coverage gap flagged by QA.

**Files modified:** `project-detail.js`, `project-detail-helpers.js`,
`project-detail-diff.test.ts`, `file-tree.md`

---

### WP-005 — Bootstrapper too-brief summary guard

**Scope:** `personas/ledger-support/src/content/ledger-bootstrapper.md` + 3 generated outputs
**Stages:** implementation → qa → code-review → documentation (all PASS)

Added an explicit boundary-condition guard to Bootstrapper Step 2: agents must omit
`project_summary` when `## Summary` is a single phrase or fewer than two complete sentences. The
guard is deliberately phrased as a measurable test, not a vague judgment call. 120 personas
rebuilt and verified clean.

**Files modified:** `ledger-bootstrapper.md`, `vs-code/ledger-bootstrapper.agent.md`,
`claude-code/ledger-bootstrapper.md`, `deep-agents/ledger-bootstrapper.md`

---

### WP-006 — Standalone Archiver `project_summary` workflow

**Scope:** `personas/ledger-support/src/content/standalone-archiver.md` + 3 generated outputs,
`AGENTS.md`
**Stages:** implementation → qa → code-review → documentation (all PASS)

The Standalone Archiver Import Mode gains a new Step 1: read `plan.md`, locate `## Summary`,
craft a 2–3 sentence plain-text summary, and pass it as `project_summary` to
`ledger_import_standalone`. Skip guards match the Bootstrapper (missing section or too-brief
section). Subsequent steps renumbered 1–5. Error-handler references updated.

**Reviewer Fix-Forward:** Added a `> Example:` blockquote to Step 1 (mirroring
`ledger-bootstrapper.md Step 2`) to give agents a concrete calibration cue for expected summary
quality.

AGENTS.md cross-system dependency table extended: `project_summary` row now references
`standalone-archiver.md` (Workflow — Import Mode, Step 1) alongside the existing bootstrapper
entry.

**Files modified:** `standalone-archiver.md`, 3 generated outputs, `AGENTS.md`

---

## Strategic Recommendations

### Gold Nugget 1 — Extract shared summary-crafting guidelines into a partial

WP-005 and WP-006 both flag that the summary-crafting guidelines in `ledger-bootstrapper.md`
and `standalone-archiver.md` are near-verbatim duplicates. If these guidelines ever evolve (e.g.,
the boundary condition changes from "two complete sentences" to something else), both files must
be updated manually.

**Recommendation:** Extract to `personas/shared/partials/summary-crafting-guide.md` and include
it in both files. This is a low-urgency refactor, but the duplication is already flagged in two
separate pipelines — addressing it proactively avoids a drift bug in a future cycle.

---

### Gold Nugget 2 — Standardize the `document.fonts.ready` guard pattern

The double-guard pattern introduced in WP-003 (`var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve()`) is already flagged as a candidate for reuse if additional deferral points are needed in `project-detail.js` (e.g., an outcome-synopsis toggle). Document this as a named pattern in a comment or a helper variable to prevent future code from calling `document.fonts.ready` directly without the jsdom fallback.

---

### Gold Nugget 3 — Export `ImportStandaloneSchema` (or a sub-schema) for integration tests

Currently the schema rejection test for `project_summary` constructs a local `z.object({...})`
rather than exercising `ImportStandaloneSchema` directly, because the schema is not exported.
If integration tests grow more complex (e.g., testing full-tool invocations against the live
Zod schema), exporting a named type or sub-schema would enable precise, non-fragile assertions.
Low urgency at current test-suite scale, but worth tracking.

---

### Gold Nugget 4 — Pre-render + patch-function DOM pattern is now established

WP-003 and WP-004 together solidify the GUI pattern: always pre-render hidden containers, reveal
and populate them in-place via dedicated `_patch*()` functions, and hook into `_diffProjectState`
for poll-loop updates. New GUI features should follow this pattern — it avoids full-page
re-renders and is compatible with jsdom tests.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Priority | Type |
|---|---|---|---|---|---|
| 1 | WP-001 QA | QA | `project_summary` has no `trim()` guard — whitespace-only strings (e.g. `'   '`) pass `min(1)` validation. Not a practical concern for agent-provided fields but inconsistent. | Low | Deferred |
| 2 | WP-001 QA | QA | No `max-length` constraint on `project_summary` — consistent with `ledger_initialize_project`. Acceptable at current scale. | Low | Deferred |
| 3 | WP-001 Code Review | Reviewer | `ImportStandaloneSchema` is not exported; the schema rejection test constructs a local stub. Consider exporting for future integration tests. | Low | Deferred |
| 4 | WP-004 QA | QA | AC4/AC5 (outcome_summary diff detection) had no dedicated unit tests at QA time — fixed by Reviewer Fix-Forward. No remaining gap. | — | Resolved |
| 5 | WP-005/006 Implementation | Developer | Summary-crafting guidelines are near-verbatim in `ledger-bootstrapper.md` and `standalone-archiver.md`. Shared partial at `personas/shared/partials/summary-crafting-guide.md` recommended. | Low | Deferred |
| 6 | WP-006 Documentation | Documentation | `.context/agents.md` is stale after AGENTS.md edits. Run `node scripts/cli.js ctx-generate` to regenerate. | Low | Follow-Up |

---

## Next Steps

1. **CTX regeneration:** Run `node scripts/cli.js ctx-generate` to sync `.context/agents.md` and
   `.context/mcp-server/manifest-api-surface.md` with the documentation changes from this cycle.
2. **Shared partial (deferred):** When the summary-crafting guidelines next need to change,
   extract them to `personas/shared/partials/summary-crafting-guide.md` before editing both
   source files independently.
3. **Version sync:** Consider a `mcp-server` minor version bump and a `personas` patch bump to
   document the `project_summary` expansion and persona updates respectively — run
   `node scripts/cli.js check-versions` to verify current state.
4. **Import existing standalone plans:** With `ledger_import_standalone` now supporting
   `project_summary`, the Standalone Archiver agent can be deployed to retroactively enrich
   project records in the knowledge store.
