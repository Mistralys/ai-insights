# Synthesis Report — Knowledge Accumulation System

**Project:** `2026-05-28-knowledge-accumulation-system`
**Session Date:** 2026-05-28
**Duration:** ~2.5 hours (13:00–15:33 UTC)
**Status:** COMPLETE — 7/7 work packages passed all pipeline stages

---

## Executive Summary

The Knowledge Accumulation System is fully implemented and deployed. The Synthesis agent can
now commit reusable insights ("gold nuggets") to a persistent, file-backed knowledge store and
all workflow agents can query that store during their pipelines. Specifically:

- A new **`.knowledge/` directory** at the ledger root stores global insights
  (`global-insights.json`) and per-project insights (`{slug}-insights.json`).
- A **Zod schema layer** (`src/schema/knowledge.ts`) defines `Insight` and `KnowledgeStore`
  types with full TypeScript inference and a dual-layer path-traversal guard on `project_slug`.
- A **`KnowledgeStoreManager`** (`src/storage/knowledge-store.ts`) provides all CRUD
  operations — atomic writes, file-lock serialization, ID sequencing (`KN-NNNN`), and
  case-insensitive search — with `.knowledge/` excluded from project enumeration.
- **4 new MCP tools** (`ledger_add_insight`, `ledger_search_insights`, `ledger_list_insights`,
  `ledger_update_insight`) are registered in the server, appear in the tool registry (30 total),
  and have help content wired into `ledger_help`.
- The **Synthesis persona** (`9-synthesis.yaml`) has a new dedicated Knowledge Collection phase
  (partial + numbered workflow step 8), with confidence heuristics and a deduplication
  pre-flight step.
- **4 consumer personas** (Developer, QA, Security Auditor, Reviewer) have `ledger_search_insights`
  added with role-appropriate purpose descriptions.
- A **batch migration script** (`scripts/migrate-synthesis-insights.js`) can extract insights
  from all existing `synthesis.md` files via the Anthropic API with `--dry-run`, `--project`,
  `--limit`, and `--resume` flags.
- All **manifest documents** are updated (api-surface.md, file-tree.md, data-flows.md,
  constraints.md, AGENTS.md) and both module changelogs are bumped (mcp-server v1.31.0,
  personas v3.22.0).

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 7 / 7 COMPLETE |
| Pipeline stages passed | 29 / 29 (100%) |
| Security FAIL → rework cycles | 1 (WP-002: A01 path traversal — remediated) |
| Code-review FAIL → rework cycles | 1 (WP-002: `_loadInsights()` correctness — remediated) |
| New tests added (schema) | 33 |
| New tests added (storage) | 65 + 4 exclusion |
| New tests added (MCP tools) | 66 + 8 help |
| New tests added (persona build) | 51 |
| Full suite after WP-003 | 2 365 / 2 368 (3 pre-existing GUI failures) |
| Security findings — Critical / High | 0 / 1 (resolved) |
| Security findings — Medium | 0 |
| Security findings — Low (deferred) | 2 |
| Persona files rebuilt | 99 |
| MCP tool count (before → after) | 26 → 30 |
| Module version — mcp-server | v1.30.2 → v1.31.0 |
| Module version — personas | v3.21.x → v3.22.0 |

---

## Failed / Blocked Pipelines

### WP-002 — Security Audit FAIL (A01 Path Traversal, High)

The Security Auditor identified that `projectStorePath(slug)` interpolated `slug` directly into
`path.join()` without validation. A `../evil` or `../../etc/passwd` slug could escape the
`.knowledge/` directory.

**Resolution:** Dual-layer defense:
1. `_validateSlug(slug)` private guard in `KnowledgeStoreManager` — rejects slugs not matching
   `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` before any file I/O.
2. Matching Zod `.regex(...)` refinement on `InsightSchema.project_slug` — closes the attack
   surface at parse time for `addInsight()`.

Both layers share `PROJECT_SLUG_REGEX` (exported constant from `schema/knowledge.ts`) to
prevent pattern drift.

### WP-002 — Code Review FAIL (`_loadInsights()` silently over-returned)

The Reviewer identified that `_loadInsights({ project_slug: 'x' })` without an explicit `scope`
loaded all stores rather than narrowing to project `x`. This would have caused `searchInsights`
and `listInsights` to silently return over-broad results to MCP tool callers.

**Resolution:** Fixed in the same implementation rework cycle as the security remediation,
before the MCP tool layer (WP-003) was built.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Share validation constants across schema + storage layers

`PROJECT_SLUG_REGEX` is the single source of truth for slug validation, exported from
`schema/knowledge.ts` and consumed by both `InsightSchema.project_slug` and
`KnowledgeStoreManager._validateSlug()`. This pattern — define once in the schema, reference
in the storage guard — eliminates drift risk and should be adopted for any future string-format
constraints that must be enforced at both schema-parse time and runtime.

### 2. Fix the 3 pre-existing GUI test failures as a standalone WP

Every WP in this session flagged 3 failing tests as noise:
- `tests/gui/api-client.test.ts` (×2) — `orchestratorDismiss` endpoint URL mismatch
- `tests/gui/orchestrator-view.test.ts` (×1) — missing `.orch-project-link` element

These failures pre-date this implementation cycle and inflate the "tests failed" count in every
pipeline report. They should be fixed in a dedicated work package to restore a clean baseline.

### 3. Numbered workflow steps in persona files must include all phases ✓

WP-004 revealed that the Synthesis persona's numbered steps (1–9) did not reference the new
Knowledge Collection phase, meaning an agent following only those steps would skip it
entirely. The Documentation agent caught and fixed this, but the root cause is structural:
numbered step lists in persona templates can fall out of sync with additive partials.

**Recommendation:** Treat persona workflow step lists as immutable contracts. Any new phase
partial must be paired with a numbered-step addition in the same implementation PR. The
Documentation pipeline's responsibility should include cross-checking partial count against
step count.

> **Integrated:** Added as constraint `5a.` (`c4a`) in
> `personas/docs/agents/project-manifest/constraints.md` — Persona Content Philosophy section
> (2026-05-28).

### 4. CJS/ESM boundary limits script reuse of TypeScript storage modules — **RESOLVED**

`scripts/migrate-synthesis-insights.js` previously reimplemented knowledge store read/write
operations inline because the TypeScript `KnowledgeStoreManager` could not be `require()`d
from a CJS script.

**Resolution implemented (2026-05-28):** Option (b) — the entire `scripts/` directory was
migrated to ESM by adding `"type": "module"` to the root `package.json`. All 19 scripts
were converted:
- `require()` → `import` / named `import { ... }`
- `__dirname` → `import.meta.dirname` (Node 26 native)
- `__filename` → `import.meta.filename`
- `module.exports` → `export { ... }`
- Inter-script local import: `require('./publish-locations')` → `import { ... } from './publish-locations.js'`
- JSON file require: `require('../shared/workflow-manifest.json')` →
  `JSON.parse(fs.readFileSync(...))`
- CJS interop for `personas/persona-build.config.js` (which remains CJS in the `personas/`
  sub-package): `createRequire(import.meta.url)` wrapper in `build-personas.js`

`migrate-synthesis-insights.js` now imports `KnowledgeStoreManager` directly from the built
MCP server dist (`../mcp-server/dist/storage/knowledge-store.js`), replacing ~100 lines of
inline storage reimplementation. The inline `readStore`, `writeStore`, `storePath`, `nextId`,
`loadExistingTitles`, `projectHasInsights`, and `commitInsight` functions were replaced by
`manager.listInsights({})`, `manager.listInsights({ project_slug })`, and
`manager.addInsight()` calls. All three callers in `main()` are now properly `await`ed.

All 51 workspace tests pass. All 19 scripts pass `node --check` syntax validation.
`build-personas.js --check` (99 personas), `validate-workflow-manifest.js`, and
`check-version-sync.js` all run correctly at runtime.

**Note:** Future scripts that need the MCP server storage layer can now import directly from
`../mcp-server/dist/storage/*.js`. The dist must be built (`npm run build` in `mcp-server/`)
before any such import resolves at runtime.

### 5. `updateInsight` needs an optional scope filter to avoid ambiguous store resolution — **RESOLVED**

`updateInsight` and `deleteInsight` scan stores alphabetically, so `global-insights.json` is
always searched before `{slug}-insights.json`. An agent holding a numeric ID that exists in
both stores will update the global insight silently. This was flagged by QA, the Security
Auditor, and the Reviewer independently — strong signal that the API surface has a clarity
gap.

**Resolution implemented (2026-05-28):** `scope?` and `project_slug?` parameters added as an
optional `filter` object to both `KnowledgeStoreManager.updateInsight()` and
`KnowledgeStoreManager.deleteInsight()` at the storage layer. A new private helper
`_storePathsForFilter()` centralises store-selection logic (mirrors `_loadInsights`).
The `ledger_update_insight` MCP tool surface exposes both new optional params with clear
disambiguating descriptions. Help content and tool registration description updated.
`api-surface.md` updated to document the new signatures. 14 new tests added (10 storage,
3 tool-level scope-filter tests + existing suite remains green at 2 375 / 2 378).

### 6. Confidence field semantics should be finalized before production use — **RESOLVED**

`InsightSchema.confidence` is `z.number()` with no range constraint. The migration script and
the persona guidance assume 0–1 semantics (high: 0.9–1.0), but `Infinity` and negative values
are silently accepted. Before the knowledge store accumulates significant data, the field should
be locked to `z.number().min(0).max(1)` to prevent silent data quality issues.

**Resolution implemented (2026-05-28):** `z.number().min(0).max(1)` constraint added to
`InsightSchema.confidence` in `mcp-server/src/schema/knowledge.ts`. The field JSDoc updated to
document the enforced range. Tests updated: the "accepts out-of-range values" test replaced by
two new tests — "rejects confidence values outside 0–1" (verifies 1.5 and -0.1 are rejected)
and "accepts confidence boundary values 0 and 1". All 34 schema tests pass.

---

## Next Steps for Planner / Manager

1. **Fix pre-existing GUI test failures** — Create a WP targeting
   `tests/gui/api-client.test.ts` and `tests/gui/orchestrator-view.test.ts` to restore a
   clean test baseline (0 failures in the full suite).

2. **Run the batch migration** — Execute `node scripts/migrate-synthesis-insights.js --dry-run`
   against the existing project ledgers to preview extractable insights, then run without
   `--dry-run` once the dry-run output is reviewed. Requires `ANTHROPIC_API_KEY` in the
   environment.

3. **Add scope filter to `ledger_update_insight`** — Low-effort follow-up to make the update
   tool unambiguous (see Gold Nugget #5 above).

4. **Finalize `confidence` field constraints** — Add `z.number().min(0).max(1)` to
   `InsightSchema` once the 0–1 semantic is confirmed and update the migration script's
   heuristic table accordingly.

5. **GUI Knowledge page (Phase 6)** — Deferred at plan inception; now unblocked. Implement
   a `/knowledge` route in the MCP server GUI to surface insights across projects.

6. **Root changelog entry** — The module changelogs (mcp-server v1.31.0, personas v3.22.0)
   are complete. A root `changelog.md` entry should be written to create a Git-tagged release
   that captures this feature.

---

## Files Delivered

| File | Change |
|------|--------|
| `mcp-server/src/schema/knowledge.ts` | New — Zod schemas + types |
| `mcp-server/src/storage/knowledge-store.ts` | New — KnowledgeStoreManager |
| `mcp-server/src/tools/knowledge.ts` | New — 4 MCP tool handlers |
| `mcp-server/src/tools/help-content.ts` | Modified — 4 new help entries |
| `mcp-server/src/index.ts` | Modified — tool registration + startup log |
| `mcp-server/tests/schema/knowledge.test.ts` | New — 33 schema tests |
| `mcp-server/tests/storage/knowledge-store.test.ts` | New — 65 storage tests |
| `mcp-server/tests/storage/knowledge-store-exclusion.test.ts` | New — 4 exclusion tests |
| `mcp-server/tests/tools/knowledge.test.ts` | New — 66 tool tests |
| `mcp-server/tests/tools/knowledge-help.test.ts` | New — 8 help tests |
| `mcp-server/tests/tools/schema-integrity.test.ts` | Modified — count 22→30, 4 new names |
| `scripts/migrate-synthesis-insights.js` | New — batch migration script |
| `personas/shared/partials/synthesis-knowledge-collection.md` | New — Knowledge Collection partial |
| `personas/ledger/src/content/9-synthesis.md` | Modified — step 8 added |
| `personas/ledger/src/meta/9-synthesis.yaml` | Modified — 2 new MCP tools |
| `personas/ledger/src/meta/3-developer.yaml` | Modified — ledger_search_insights |
| `personas/ledger/src/meta/4-qa.yaml` | Modified — ledger_search_insights |
| `personas/ledger/src/meta/5-security-auditor.yaml` | Modified — ledger_search_insights |
| `personas/ledger/src/meta/6-reviewer.yaml` | Modified — ledger_search_insights |
| `personas/ledger/vs-code/` (5 files) | Regenerated |
| `personas/ledger/claude-code/` (5 files) | Regenerated |
| `personas/ledger/deep-agents/` (2 files) | Regenerated |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Updated |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | Updated |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | Updated |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Updated |
| `AGENTS.md` | Updated — Knowledge Collection cross-system dep row |
| `mcp-server/changelog.md` | New entry — v1.31.0 |
| `mcp-server/package.json` | Bumped to v1.31.0 |
| `personas/changelog.md` | New entry — v3.22.0 |
| `personas/package.json` | Bumped to v3.22.0 |
| `personas/ledger/src/meta/_shared.yaml` | Bumped default_version to v3.22.0 |
