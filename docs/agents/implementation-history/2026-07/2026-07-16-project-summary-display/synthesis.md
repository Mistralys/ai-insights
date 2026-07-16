# Synthesis Report — Project Summary Display

**Plan:** `2026-07-16-project-summary-display`  
**Date:** 2026-07-16  
**Status:** COMPLETE — All 6 work packages passed all pipeline stages  
**Synthesised by:** Head of Operations (Synthesis Agent)

---

## Executive Summary

This project resolved a long-standing GUI friction point: the project detail page's `.plan-synopsis` block silently truncated long plan summaries with a hard `overflow: hidden`, with no visual cue that content was missing. The solution was delivered in two complementary phases.

**Phase 1 (WP-001)** applied an immediate CSS/JS fix: a gradient fade-out bottom edge and a "Show more / Show less" toggle button, implemented using an inner `__body` wrapper and BEM modifier classes (`--fits`, `--expanded`) toggled by a measurement IIFE. No data-model changes. Zero regression risk.

**Phase 2 (WP-002 → WP-006)** introduced a `project_summary` field to the MCP server data model (`RootIndexSchema`, `ProjectMetaSchema`, `InitializeProjectSchema`), wired it through the storage layer via key-presence semantics, updated the GUI to prefer it over the regex-based fallback, added a new `.outcome-synopsis` block displaying the `outcome_summary` for completed projects, updated the Ledger Bootstrapper persona to craft and pass the field during initialization, and propagated documentation across manifests, `AGENTS.md`, and `CLAUDE.md`.

The result is a fully curated, backward-compatible project summary pipeline from initialization (Bootstrapper crafts `project_summary`) through storage (dual-schema / `.meta.json` enrichment cache) to display (GUI prefers curated text, gracefully falls back for legacy projects).

---

## Metrics

| WP | Pipeline Stages | Tests | Result |
|----|-----------------|-------|--------|
| WP-001 | implementation · qa · code-review · documentation | 7 ACs (manual browser) | ✅ PASS |
| WP-002 | implementation · qa · code-review · documentation | 3425/3425 automated | ✅ PASS |
| WP-003 | implementation · qa · code-review · documentation | 8 ACs (manual browser) | ✅ PASS |
| WP-004 | implementation · qa · code-review · documentation | 104/104 automated | ✅ PASS |
| WP-005 | implementation · qa · code-review · documentation | 5 ACs (build+content check) | ✅ PASS |
| WP-006 | documentation | 5 ACs (manifest audit) | ✅ PASS |

**Total automated test suite:** 3,432 tests passing (net +7 from this project) across 115 test files.  
**Persona build:** 120 persona files rebuilt; `--check` confirms no stale output.  
**Failed stages:** 0. **Rework cycles:** 0.  
**Files modified:** 20 files across GUI, schema, storage, tools, tests, persona source, and documentation.

---

## Artifacts

### MCP Server — Backend

| File | Change |
|------|--------|
| `mcp-server/src/schema/root-index.ts` | Added `project_summary: z.string().nullable().optional()` |
| `mcp-server/src/schema/project-meta.ts` | Same nullable-optional field added |
| `mcp-server/src/storage/ledger-store.ts` | `MetaCacheUpdates` interface extended; `writeRootIndex()` and `writeProjectMeta()` wired with key-presence semantics |
| `mcp-server/src/tools/project-lifecycle.ts` | `InitializeProjectSchema` extended with `project_summary: z.string().min(1).optional()` |
| `mcp-server/tests/schema/project-meta.test.ts` | Schema acceptance/rejection tests |
| `mcp-server/tests/storage/project-meta.test.ts` | Write/preserve/override storage tests |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | 7 new tests for schema + persistence |

### MCP Server — GUI

| File | Change |
|------|--------|
| `mcp-server/gui/public/styles.css` | `.plan-synopsis` BEM refactor (inner `__body`, gradient, `--fits`/`--expanded` modifiers); new `.outcome-synopsis` CSS block; cross-reference comment added |
| `mcp-server/gui/public/views/project-detail.js` | Synopsis IIFE updated (prefer `project_summary`, fallback to `extractSynopsis()`); outcome-synopsis IIFE added; toggle IIFE unchanged |

### Personas

| File | Change |
|------|--------|
| `personas/ledger-support/src/content/ledger-bootstrapper.md` | Step 2 extended with `project_summary` curation instructions |
| `personas/ledger-support/vs-code/ledger-bootstrapper.agent.md` | Regenerated |
| `personas/ledger-support/claude-code/ledger-bootstrapper.md` | Regenerated |
| `personas/ledger-support/deep-agents/ledger-bootstrapper.md` | Regenerated |

### Documentation

| File | Change |
|------|--------|
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `ledger_initialize_project` signature updated; `RootIndex` and `ProjectMeta` interface entries extended; `writeProjectMeta()` JSDoc corrected |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Flow 1 updated with `project_summary` parameter and omission semantics |
| `mcp-server/docs/agents/project-manifest/constraints.md` | §75 extended with `project_summary` as second instance of dual-schema / key-presence pattern |
| `mcp-server/gui/docs/agents/project-manifest/ui-components.md` | `.plan-synopsis` and `.outcome-synopsis` entries added |
| `mcp-server/gui/docs/agents/project-manifest/data-flows.md` | §12 added (Project Detail Synopsis & Outcome Rendering) |
| `AGENTS.md` | Cross-System Dependencies table updated with `project_summary` row (including Bootstrapper source) |
| `CLAUDE.md` | Synced to match AGENTS.md (the `project_summary` row had been missing since WP-004's documentation pass) |

---

## Strategic Recommendations

### 1. The Key-Presence Semantic Pattern Is Now Established Twice — Formalize It

Both `outcome_summary` (set by Synthesis) and `project_summary` (set at initialization) use identical key-presence propagation through `writeRootIndex()` and `writeProjectMeta()`. Any future optional nullable field that needs dual-storage propagation should follow this pattern. The pattern is now documented in `constraints.md §75` with two concrete examples. Future reviewers should treat it as a convention, not a coincidence.

### 2. CLAUDE.md Drift Is a Recurring Risk — Automate or Deprecate the File

During WP-005 documentation, CLAUDE.md was found missing the `project_summary` cross-system dependency row that had been present in AGENTS.md since WP-004. The file's own header states it is auto-generated from AGENTS.md, but this regeneration is not wired into the pre-commit hook. Either: (a) add `node scripts/cli.js ctx-generate` to the pre-commit hook's non-blocking warning checks, or (b) retire CLAUDE.md and redirect all Claude Code reads to AGENTS.md directly.

### 3. GUI Synopsis Rendering Has Two Structurally Different Paths — Document the Asymmetry

The `project_summary` path renders plain text wrapped in `<p>` via `escapeHtml()`. The `extractSynopsis()` fallback path renders Markdown via `marked.parse()`, which produces block-level HTML (`<p>` tags included). Both render correctly due to the `p { margin: 0 0 0.4em }` CSS rule, but the structural difference is subtle for future contributors. Code-review noted this; the documentation agent did not add an inline code comment. A one-line comment above the synopsis IIFE in `project-detail.js` noting the asymmetry would prevent confusion when debugging render differences.

### 4. Toggle IIFE's Synchronous Height Measurement Is a Low-Risk Latent Bug

The toggle overflow check (`scrollHeight <= offsetHeight`) runs synchronously after `app.innerHTML` is set. If async font loading has not completed at that point, the measured content height will be inaccurate, potentially showing no toggle for content that is actually truncated. This was flagged by both Developer and QA as acceptable for the current manual browser testing strategy. If the GUI ever adds a content security policy that defers font loading more aggressively, wrapping the IIFE call in `requestAnimationFrame(fn)` or `document.fonts.ready.then(fn)` would close this gap with minimal code change.

### 5. Outcome-Synopsis Block Has No Live-Update Mechanism

The `.outcome-synopsis` block is rendered once at page load. If a project's synthesis completes while the user is on the detail page, the block will not appear dynamically — a page refresh is required. This is a narrow race condition (synthesis takes minutes; the user may have already navigated away), but the pattern for dynamic reveal already exists in the codebase: `synthesis-link-row` uses a pre-rendered hidden container and a `_patchSynthesisLinkRow()` function called by the polling loop. A future WP could add a matching pre-rendered container + `_patchOutcomeSynopsis()` function to close this gap.

---

## Deferred & Follow-Up Items

These items were explicitly noted as out-of-scope during the project cycle or identified as future improvement opportunities.

| # | Source | Agent | Description | Priority | Category |
|---|--------|-------|-------------|----------|----------|
| 1 | WP-001 · implementation | Developer | `requestAnimationFrame` or `document.fonts.ready.then()` deferral for the toggle IIFE, to guard against async font loading producing a false "content fits" measurement | Low | deferred |
| 2 | WP-001 · implementation | Developer | CSS custom property `--synopsis-fade-height` for the hard-coded 3rem gradient height, to ease future tuning | Low | deferred |
| 3 | WP-001 · code-review | Reviewer | Add explicit `font-family: inherit` to `.plan-synopsis__toggle` button for an explicit style contract | Low | deferred |
| 4 | WP-001 · code-review | Reviewer | Cross-reference comment in `styles.css` linking `--fits`/`--expanded` modifiers to their managing IIFE in `project-detail.js` | Low | completed by Documentation (WP-001 doc pipeline) |
| 5 | WP-003 · implementation | Developer | `.outcome-synopsis` toggle/expand mechanism if long `outcome_summary` values become common | Low | deferred |
| 6 | WP-003 · code-review | Reviewer | Pre-rendered hidden `outcome-synopsis` container + `_patchOutcomeSynopsis()` poll function for live-update without page refresh | Low | deferred |
| 7 | WP-003 · code-review | Reviewer | Inline comment above the synopsis IIFE documenting the structural difference between `project_summary` (plain-text path) and `extractSynopsis()` (Markdown path) | Low | deferred |
| 8 | WP-005 · code-review | Reviewer | Bootstrapper fallback guard: if `## Summary` is present but too brief for 2–3 sentences, omit `project_summary` rather than inventing content (add guidance to Step 2 of `ledger-bootstrapper.md`) | Low | deferred |
| 9 | WP-005 · implementation | Developer | Bootstrapper fallback: consider falling back to the plan's first paragraph when no `## Summary` section exists, rather than omitting the field entirely | Low | out-of-scope |

---

## Next Steps

The Planner / Project Manager should consider the following for the next cycle:

1. **CLAUDE.md automation or deprecation (Strategic Rec #2)** — This is a small, high-leverage improvement. Adding CTX generation (or at minimum a diff warning) to the pre-commit hook would eliminate drift recurrence.

2. **Outcome-synopsis live-update (Deferred #6)** — If the GUI's live project view is commonly used during agent runs, closing this gap would improve the real-time monitoring experience.

3. **Toggle IIFE font-load robustness (Deferred #1)** — Low risk today; implement with `document.fonts.ready.then()` if a content security policy tightens font loading behavior.

4. **Bootstrapper guidance edge case (Deferred #8)** — A single sentence addition to `ledger-bootstrapper.md` Step 2 would close the "too-brief Summary" edge case flagged by the Reviewer. Small, targeted, no build output impact beyond the Bootstrapper's 3 generated files.

5. **Synopsis asymmetry comment (Deferred #7)** — A one-line inline comment in `project-detail.js` above the synopsis IIFE noting the two structurally different rendering paths. Zero functional change; high future-contributor value.
