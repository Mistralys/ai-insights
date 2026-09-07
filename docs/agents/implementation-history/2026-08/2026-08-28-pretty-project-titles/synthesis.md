# Synthesis Report — Pretty Project Titles
**Plan:** `2026-08-28-pretty-project-titles`
**Date:** 2026-08-28
**Status:** COMPLETE

---

## Executive Summary

This plan delivered end-to-end support for agent-curated project display titles across the MCP server and persona system. An optional `title` parameter was added to `ledger_initialize_project` and `ledger_import_standalone`, threading through schemas, interfaces, storage, and help content. In parallel, a new `title-crafting-guide.md` shared partial was created and both the Ledger Bootstrapper and Standalone Archiver personas were updated to craft human-readable titles from plan slugs before calling these tools — mirroring the established `project_summary` pattern exactly.

The net result: projects like `2026-08-04-gui-api-enhancements-rework-1` can now surface in the GUI as **"GUI API Enhancements - Rework 1"** instead of the slug-derived title-cased fallback, without any automated pattern-matching or acronym list maintenance.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 2 / 2 COMPLETE |
| Pipeline Stages Completed | 8 (4 per WP: impl → qa → code-review → documentation) |
| Acceptance Criteria Met | 23 / 23 (14 in WP-001, 9 in WP-002) |
| MCP Server Tests Passing | 4,089 (0 failures) |
| Net New Tests | +11 (covering title storage, omission, and schema boundary rejection) |
| Persona Output Files Rebuilt | 129 (0 errors) |
| Build (TypeScript `--noEmit`) | ✅ Clean |
| Rework Cycles | 0 |

---

## Strategic Recommendations (Gold Nuggets)

### 1. Shared Partial + HTML Comment Convention is the Canonical Pattern for Agent Formatting Rules
> *Source: WP-002 / Reviewer*

The `{{> partial-name}}` tag at column 0, preceded by an explanatory HTML comment, is a robust approach for injecting formatting rules into agent personas without indentation artifacts. The self-documenting comment explains the column-0 constraint inline for future maintainers. This should be the **standard** for all future shared formatting rules in the persona suite — no rule set should be embedded inline in individual persona source files.

### 2. The `project_summary` Pattern is a Reusable Template for Agent-Curated Fields
> *Source: WP-001 / Developer*

The implementation mirrors `project_summary` at every layer: same Zod schema shape (`z.string().min(1).optional()`), same `MetaCacheUpdates` field semantics, same persona instruction placement, same shared-partial delivery. Future agent-curated metadata fields (e.g., `tags`, `category`) should follow this exact template to minimize cognitive load for both agents and developers.

### 3. Asymmetric Skip-Guard Design for Always-Available vs. Conditional Sources
> *Source: WP-002 / Reviewer*

`project_summary` skip-guard callouts (for when the plan's Summary section is absent or thin) are correctly retained, while `title` skip-guards are intentionally absent — because the slug is always a valid derivation source. This asymmetry is the right design and should inform how skip-guard callouts are structured for future curated fields: only add guards when the source material may genuinely be missing.

---

## Code Insights

### WP-001 — MCP Schema & Storage

**Developer (Implementation)**
- The enrichment `writeProjectMeta` block in `initializeProject()` is inside a non-fatal `try/catch`. If it throws, `title` (like all enrichment fields) is silently discarded. This is acceptable by design but creates a subtle gap vs. `project_summary`, which also survives at the `writeRootIndex` level. *Low priority — consider storing `title` in the root index as well for resilience.*
- `writeProjectMeta()` uses mixed semantics: `'key' in cacheUpdates` for nullable fields, `!== undefined` for non-nullable ones. `title` correctly uses `!== undefined`. This pre-existing asymmetry is internally consistent but worth noting for contributors adding new cacheable fields.

**QA**
- Whitespace-only title strings (e.g. `"   "`) pass the schema's `min(1)` since it counts characters, not non-whitespace. This is consistent with the pre-existing `project_summary` behavior. *Future improvement: add `.trim().min(1)` to both `title` and `project_summary` for tighter validation.*

**Reviewer (Fix-Forward Applied)**
- Updated the `writeProjectMeta()` `@param cacheUpdates` JSDoc to list `title` alongside all other supported keys, including an explanation of its non-nullable semantics and why `importStandaloneProject` uses `updateTitle()` directly instead.
- Schema boundary tests in the new suites mirror the schema shape inline (`z.object`) rather than importing the actual `InitializeProjectSchema`/`ImportStandaloneSchema`. A constraint change (e.g., `.max(200)` → `.max(100)`) would not be caught by these tests. *Low priority — future schema boundary tests should import the actual schema as Suite 1 does with `ProjectMetaSchema`.*

### WP-002 — Persona System

**Developer, QA, Reviewer** — No blocking observations. The implementation follows the established patterns precisely. See Strategic Recommendations § 1–3 above for the positive findings elevated from this WP.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Type | Description | Priority |
|---|---|---|---|---|---|
| 1 | WP-001 / Documentation pipeline | Documentation | **Deferred** | Persona source files (`ledger-bootstrapper.md`, `standalone-archiver.md`) need to be updated to instruct agents to pass the new `title` parameter. This was explicitly noted as a deliverable of a *future* WP (WP-002 of the same plan) — confirmed complete by WP-002, so this item is now resolved. *(Listed for completeness; no action needed.)* | — |
| 2 | WP-001 / Implementation | Developer | **Follow-up** | Consider storing `title` in the root index (not only in `.meta.json` enrichment) to ensure it survives enrichment failures, paralleling `project_summary`'s dual-path durability. | Low |
| 3 | WP-001 / QA | QA | **Follow-up** | Add `.trim().min(1)` validation to both `title` and `project_summary` Zod schemas to reject whitespace-only strings. Currently consistent with prior behavior but represents a latent input quality gap. | Low |
| 4 | WP-001 / Code Review | Reviewer | **Follow-up** | Schema boundary tests for `title` use inline `z.object` mirrors rather than importing the real schemas. Update these tests to import `InitializeProjectSchema` / `ImportStandaloneSchema` directly to avoid silent drift if constraints change. | Low |
| 5 | WP-001 / Documentation | Documentation | **Follow-up** | The `MetaCacheUpdates.title` JSDoc was expanded to explain `!== undefined` vs. `'key' in cacheUpdates` semantics. Consider extending this guidance to a shared developer doc (e.g., a `CONTRIBUTING.md` section on cacheable fields) so contributors don't need to read the source to discover the distinction. | Low |

---

## Next Steps

The Planner/Manager should consider the following for the next cycle:

1. **Title resilience (follow-up item 2):** Evaluate writing `title` to both the root index and `.meta.json` to survive enrichment failures — similar to how `project_summary` is stored at the `writeRootIndex` level. Low-risk, small scope.
2. **Schema input validation hardening (follow-up item 3):** Add `.trim().min(1)` to `title` and `project_summary` Zod schemas across all tools to close the whitespace-only string gap.
3. **Test hygiene (follow-up item 4):** Refactor schema boundary tests to import real schemas rather than mirroring them inline.
4. **GUI integration verification:** Confirm the GUI's `project_name` display path correctly surfaces `meta.title` for both `initializeProject` and `importStandalone` flows in an end-to-end smoke test (the current coverage is via existing GUI unit tests, not an integration scenario with a real slug→title round-trip).
5. **Extend the pattern:** The `project_summary` / `title` agent-curated field pattern is now proven and documented. Consider applying it to other display-enhancing fields (e.g., `tags`, `category`) in a future plan.
