# Synthesis Report — WP Title & Description

**Date:** 2026-08-01  
**Project:** Add `title` and `description` fields to the Work Package data model  
**Status:** COMPLETE — all 4 work packages passed all pipeline stages  

---

## Executive Summary

This project added `title` and `description` fields to the Work Package data model across the full stack of the Project Ledger MCP Server. The `title` (a short human-readable label) is now stored in WP detail files and the root index summary, surfacing in the GUI project list view and all MCP tool output. The `description` (the full WP spec body) is stored in the WP detail file and rendered as a Markdown card in the GUI WP detail view. Both fields are backward-compatible — optional in all storage schemas so existing 280+ WPs parse without modification — but `title` is required when creating new WPs via `ledger_create_work_package`.

The Bootstrapper persona was updated in parallel to extract title and description from the WP Decomposer's structured headers and pass them to the create-WP tool automatically, closing the loop between plan authoring and ledger storage.

---

## Work Package Summary

| WP | Scope | Stages | Result |
|----|-------|--------|--------|
| **WP-001** | Core schema + MCP tool changes | impl → qa → review → docs | ✅ PASS |
| **WP-002** | GUI project detail — WP table title display | impl → qa → review → docs | ✅ PASS |
| **WP-003** | GUI WP detail — title in `<h1>`, description as Markdown card | impl → qa → review → docs | ✅ PASS |
| **WP-004** | Bootstrapper persona — extract and pass title + description | impl → qa → review → docs | ✅ PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 4 / 4 COMPLETE |
| Pipeline stages | 16 / 16 PASS |
| Tests passing (post-project) | 3969 / 3969 |
| Net new tests added | +9 (3960 → 3969) |
| TypeScript errors | 0 (tsc --noEmit clean throughout) |
| Persona output files rebuilt | 126 files across 3 targets (vs-code, claude-code, deep-agents) |
| Files modified (implementation) | 14 source + test files, 5 doc files, 4 persona files |
| Rework cycles | 0 |

---

## Strategic Recommendations

### 1. Add `.min(1)` to `CreateWorkPackageSchema.title`

The most consistently flagged gap across the entire project: `CreateWorkPackageSchema` uses `z.string()` for `title` without `.min(1)`, meaning an empty string title silently passes Zod validation. This was independently flagged by the QA agent (WP-001), the Reviewer (WP-001), and repeated in WP-002 QA. Since `title` is now required and carries semantic meaning, an empty string is not a valid title.

**Recommendation:** Micro-WP — change `z.string()` to `z.string().min(1)` for `title` in `CreateWorkPackageSchema`, update `constraints.md` Gotcha 10b, and ensure the existing "rejects missing title" test is updated to also reject an empty string.

### 2. Export `CreateWorkPackageSchema` for Direct Test Access

The "rejects missing title" test in `work-package.test.ts` validates a local `MinimalCreateSchema` replica rather than the actual `CreateWorkPackageSchema`, which is module-private. If the real schema is accidentally made permissive (e.g., `title` marked `.optional()`), the test would still pass.

**Recommendation:** Export `CreateWorkPackageSchema` from `work-package.ts` (or move it to the schema layer) so test coverage can reference the live schema directly. Alternatively, add a round-trip integration test that exercises the full `ledger_create_work_package` tool handler with a missing title.

### 3. Decouple `.dialogue-markdown` CSS Class from WP Description Rendering

`work-package.js` reuses the `.dialogue-markdown` CSS class for the WP description card. This creates latent coupling: any dialogue-specific CSS added to `.dialogue-markdown` in future will also affect WP description rendering.

**Recommendation:** At the next GUI refactor pass, introduce `.wp-description-markdown` (scoped) or `.rendered-markdown` (generic utility) to eliminate the coupling. Low urgency until dialogue-specific styles are added.

### 4. Address the Pre-existing `api-surface.md` Gap for `WorkPackageDetail`

The `WorkPackageDetail` interface in `api-surface.md` is missing a `passed_stages` field that exists on `WorkPackageSummary`. This was flagged independently by the Implementation and Reviewer agents on WP-001 as a pre-existing documentation gap.

**Recommendation:** Add a small documentation-only WP to audit `WorkPackageDetail` in `api-surface.md` against the live schema and bring it fully current.

---

## Deferred & Follow-Up Items

| # | Type | Source | Agent | Description | Priority |
|---|------|--------|-------|-------------|----------|
| 1 | **deferred** | WP-001 | QA, Reviewer | Add `.min(1)` to `CreateWorkPackageSchema.title` to reject empty string titles | low |
| 2 | **deferred** | WP-001 | Reviewer | Export `CreateWorkPackageSchema` or add integration test through full tool handler to close the module-private test gap | low |
| 3 | **out-of-scope** | WP-001 | Developer, Reviewer | `api-surface.md` `WorkPackageDetail` interface is missing `passed_stages` field — pre-existing gap, not introduced by this project | low |
| 4 | **deferred** | WP-003 | Developer, Reviewer | Decouple `.dialogue-markdown` CSS from WP description card — introduce `.wp-description-markdown` or `.rendered-markdown` at next GUI refactor | low |
| 5 | **out-of-scope** | WP-001 | QA | No max-length constraint on `description` field — intentional (spec body container), but UI-level truncation guidance worth considering for future | low |
| 6 | **out-of-scope** | WP-002 | QA | `.wp-title-label` CSS class was not listed in `api-surface.md` CSS tables at QA time — addressed by the Documentation pipeline, now resolved | resolved |
| 7 | **out-of-scope** | WP-004 | Reviewer | Bootstrapper title-extraction rule had no fallback for WP headers without em-dash separator — addressed by Documentation pipeline, now resolved | resolved |

---

## Next Steps

**Immediate (next planning cycle):**

1. **Micro-WP: `.min(1)` guard on `title`** — Close the empty-string title gap in `CreateWorkPackageSchema`. Small, well-understood, low-risk.
2. **Micro-WP: `CreateWorkPackageSchema` testability** — Export the schema or add an integration test for the full tool handler path. Improves test correctness for a critical validation path.

**Medium-term:**

3. **Doc WP: `WorkPackageDetail` api-surface.md audit** — Bring the `WorkPackageDetail` interface fully current with the live schema. Pre-existing gap that will grow as fields are added.
4. **GUI refactor: CSS class decoupling** — Batch with other GUI cleanup work. Not urgent, but worth including in the next GUI-focused planning cycle.

**Strategic:**

5. **Backfill UX review** — With `title` now surfacing in the WP table and detail views, consider whether a truncation limit or tooltip should be applied to long titles in the GUI. The current implementation renders the full title string inline.
6. **WP description rendering trust model** — `description` is currently rendered via `marked.parse()` without additional HTML sanitization, consistent with the plan/synthesis rendering pattern. This is acceptable for server-authored content; document the trust boundary explicitly if the system ever accepts description content from untrusted sources.
