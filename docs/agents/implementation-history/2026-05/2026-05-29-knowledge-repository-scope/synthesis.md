# Synthesis Report — Knowledge Repository Scope

**Plan:** 2026-05-29-knowledge-repository-scope  
**Date:** 2026-05-30  
**Status:** COMPLETE  
**Work Packages:** 11 / 11 COMPLETE  
**Pipeline Health:** 11/11 WPs all stages passing  
**Rework Cycles:** 1 (WP-008 QA → Implementation → QA)

---

## Executive Summary

This session replaced the `global` + `project` knowledge scope model with `global` +
`repository` across the entire knowledge subsystem. The change spans four architectural
layers: schema, storage, MCP tools/help, and GUI (REST API + frontend JS). Persona
documents and project documentation were updated in parallel.

The core semantic shift: knowledge is now stored either globally (cross-codebase truths)
or scoped to a specific repository (`hcp-editor-insights.json`), rather than to a
short-lived plan slug. A new `origin_plan` provenance field records which plan originally
produced a repository-scoped insight, enabling the GUI to link back to the originating
project.

**Breaking change:** `scope: 'project'` is no longer accepted by any MCP tool, REST
handler, or schema. No data migration was required — existing project-scoped files had
been manually deleted before the work began.

---

## Work Package Summary

| WP | Title | Pipelines | Tests Passed | Status |
|----|-------|-----------|--------------|--------|
| WP-001 | Schema layer (InsightScope, InsightSchema) | impl · qa · review · docs | 44 | COMPLETE |
| WP-002 | Persona documents (synthesis + knowledge-archiver) | docs | — | COMPLETE |
| WP-003 | Storage layer + tools + GUI API + test updates | impl · qa · review · docs | 2681 | COMPLETE |
| WP-004 | MCP tools: origin_plan field + test fixes | impl · qa · review · docs | 2687 | COMPLETE |
| WP-005 | GUI API: schemas + handler functions | impl · qa · sec · review · docs | 2700 | COMPLETE |
| WP-006 | Help content strings | impl · qa · review · docs | — | COMPLETE |
| WP-007 | GUI server.ts query-param renames | impl · qa · review · docs | 2700 | COMPLETE |
| WP-008 | Frontend JS (knowledge.js, api-client.js, styles.css) | impl · qa(F) · impl · qa · sec · review · docs | — | COMPLETE |
| WP-009 | New test suite (knowledge-repository-scope.test.ts) | impl · qa · review · docs | 31 (suite) | COMPLETE |
| WP-010 | Existing test file updates | impl · qa · review · docs | 321 | COMPLETE |
| WP-011 | Documentation (api-surface, file-tree, constraints, changelogs, AGENTS.md) | docs | — | COMPLETE |

---

## Metrics

- **Total test suite (final):** ~2731 tests across 88 files — all passing
- **New tests added:** 31 (knowledge-repository-scope.test.ts) + 6 AC-specific tests in
  knowledge.test.ts + 13 AC-specific tests in api-knowledge.test.ts = **50 new tests**
- **Security audits:** 2 (WP-005 — GUI API handlers; WP-008 — frontend JS) — both PASS
- **Rework cycles:** 1 — WP-008 QA correctly flagged a missing `.badge-scope-repository`
  CSS rule; fixed in a targeted rework pass
- **Pre-existing bug fixed:** WP-004 resolved 9 stale test assertions in
  `knowledge-store.test.ts` left when the WP-003 Reviewer fixed the `_validateSlug()`
  error message but did not update test expectations

### Files Modified

| Layer | Files |
|-------|-------|
| Schema | `src/schema/knowledge.ts` |
| Storage | `src/storage/knowledge-store.ts` |
| MCP tools | `src/tools/knowledge.ts`, `src/tools/help-content.ts` |
| GUI API | `gui/api-knowledge.ts`, `gui/server.ts` |
| GUI frontend | `gui/public/views/knowledge.js`, `gui/public/api-client.js`, `gui/public/styles.css` |
| Tests (updated) | `tests/schema/knowledge.test.ts`, `tests/storage/knowledge-store.test.ts`, `tests/tools/knowledge.test.ts`, `tests/gui/knowledge-api.test.ts`, `tests/gui/api-knowledge.test.ts`, `tests/gui/server-knowledge-routes.test.ts` |
| Tests (new) | `tests/gui/knowledge-repository-scope.test.ts` |
| Personas | `personas/shared/partials/synthesis-knowledge-collection.md`, `personas/standalone/src/content/knowledge-archiver.md` (+ 3 built variants each) |
| Docs | `mcp-server/docs/agents/project-manifest/api-surface.md`, `file-tree.md`, `constraints.md`, `mcp-server/changelog.md`, `changelog.md`, `AGENTS.md`, `.context/agents.md`, `.context/mcp-server/manifest.md` |

---

## Acceptance Criteria — Final Status

All 17 acceptance criteria from the plan are met:

- AC-1–3: Repository scope creates `{repo-name}-insights.json`; missing `repository_name` errors; `'global'` reserved name rejected ✓
- AC-4–7: List/search filtering by scope and repository_name works correctly ✓
- AC-8: Update with `repository_name` disambiguates correctly ✓
- AC-9–11: Promote, Move, Delete REST endpoints all handle repository scope ✓
- AC-12–14: GUI shows Global + Repository tabs; cards display `repository_name` and `origin_plan` provenance link; actions work ✓
- AC-15: `global-insights.json` is unaffected ✓
- AC-16–17: `scope: 'project'` is no longer accepted by any tool or handler ✓

---

## Strategic Recommendations

### Gold Nuggets

**1. Schema-layer vs storage-layer co-constraint pattern**  
The co-constraint `scope='repository' requires repository_name` is intentionally kept out
of the Zod schema and delegated to the storage layer. This avoids discriminated-union
complexity and keeps the schema context-free, composable, and friendly to partial-update
patterns. Replicate this pattern for future nullable-conditional fields.

**2. Reserved-name guard at the storage boundary**  
Rejecting `'global'` as a repository name in `repositoryStorePath()` is clean, trivial to
enforce, and avoids filename collisions without needing a subdirectory. A single
`if (repoName === 'global')` guard is more readable than a `repos/` subdirectory.

**3. Flat file layout for open-ended stores**  
With project stores removed, enumerating `*-insights.json && !== 'global-insights.json'`
is a robust pattern for flat-directory open-ended stores. No disambiguation issue arises
because the set of fixed-name files is small (one: `global-insights.json`).

**4. `origin_plan` as provenance metadata, not routing key**  
The semantic distinction between `origin_plan` (a planning artefact slug) and `source` (a
URL/reference) should be explicit in architecture documentation and API descriptions.
Agents need to know that `origin_plan` is never used for storage routing — it is pure
traceability data. Document this contrast clearly wherever `InsightSchema` is described.

**5. QA FAIL as a workflow asset**  
WP-008's QA FAIL (missing CSS badge class) is a healthy workflow signal — the QA agent
caught a cosmetic but real UX regression that the Developer missed. The rework cycle added
one file and 22 lines. This demonstrates that a FAIL/rework cycle at QA is far cheaper
than shipping invisible-badge regressions.

---

## Known Technical Debt & Follow-up Items

### Medium Priority

- **Handler-level slug validation gap (HTTP 500 vs 400):** `handleDeleteKnowledge` and
  `handlePromoteKnowledge` do not validate `repository_name` against `PROJECT_SLUG_REGEX`
  at the handler level. Malformed slugs (e.g. `'../evil'`) reach the storage layer, which
  throws a `NOT_FOUND`-style error resulting in an HTTP 500 rather than a clean HTTP 400
  `VALIDATION_ERROR`. The storage layer's `_validateSlug()` does catch path-traversal
  attempts safely, but the error surface is inconsistent with the other handlers. A future
  hardening pass should add explicit regex rejection at these two handler entry points.

- **`handleListKnowledge` scope rejection inconsistency:** `handleListKnowledge` uses
  `InsightScope.safeParse()` (graceful ignore) for invalid scope values, while all other
  handlers return `VALIDATION_ERROR`. A future pass should standardise these to return
  `VALIDATION_ERROR` for `scope: 'project'` consistently across all five handlers.

### Low Priority

- **`PROJECT_SLUG_REGEX` naming:** The constant now validates both `repository_name` and
  `origin_plan` fields but retains the `PROJECT_SLUG_REGEX` name. A rename to
  `SLUG_REGEX` or `IDENTIFIER_REGEX` would improve clarity. Defer until a breaking-change
  window since the constant is exported.

- **`projectInsightId` variable name in tests/tools/knowledge.test.ts (line 392):** A
  minor artifact of the old `project` terminology; rename to `repositoryInsightId` in a
  future cleanup pass.

- **`origin_plan` missing from `ledger_add_insight` example JSON in help-content.ts:** The
  Optional Parameters section documents `origin_plan` correctly, but the inline example
  JSON does not show it. A future polish pass could add it to illustrate the provenance
  use-case.

- **`api-client.js` `|| undefined` pattern:** Using `repositoryName || undefined`
  silently drops the falsy string `'0'`. A future refactor to
  `repositoryName != null ? repositoryName : undefined` provides stricter semantics.

---

## Next Steps

1. **Immediate:** Run `node scripts/cli.js ctx-generate` to regenerate `.context/` after
   any further changes — WP-011 already updated `.context/agents.md` and
   `.context/mcp-server/manifest.md` during its CTX regeneration pass.

2. **Short-term hardening:** Address the two medium-priority items above (handler-level
   slug validation for delete/promote; `handleListKnowledge` scope rejection consistency).

3. **Future:** Consider automatic `repository_name` inference from `cwd_path` at the
   storage layer (currently out of scope — agents pass it explicitly). This would simplify
   the agent call signature for the common case.

4. **Knowledge base:** The `origin_plan` provenance pattern and the flat-store enumeration
   approach are worth archiving as reusable patterns in the global knowledge store for
   future sessions touching the knowledge subsystem.
