# Synthesis Report — Knowledge UUID Migration

**Project:** `2026-08-04-knowledge-uuid-migration`
**Date:** 2026-08-04
**Status:** COMPLETE
**Work Packages:** 8 / 8 COMPLETE

---

## Executive Summary

This project replaced the per-store auto-increment numeric `id` on knowledge insights with a UUID v4 string identifier across the entire ai-insights MCP server stack. The change eliminates cross-store ID collisions, enables stable IDs across `moveInsight()` operations, and removes the `formatInsightId()` / `KN-NNNN` display-layer abstraction that had become unnecessary. The work touched 9 production source files, 12 test files, 5 manifest documents, the root tooling docs, and all 10 live knowledge store files across two storage locations. Beyond the planned scope, the review cycle caught and fixed a latent XSS vulnerability in the GUI (missing `escapeHtml` on `superseded_by`) and a functional regression (`parseInt()` returning `NaN` for UUID-based `data-id` attributes that would have silently broken all interactive card mutations).

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 8 / 8 |
| Pipeline stages passed | 26 (incl. 2 rework cycles) |
| Final test suite (full) | **4031 / 4031** (146 files) |
| Targeted test files (WP-007) | 8 files, 294 tests |
| Knowledge store files migrated | **10 / 10** |
| Insights migrated to UUID v4 | **159** |
| Security issues (critical/high) | **0** |
| Security issues (medium — resolved) | 1 (XSS — `escapeHtml` on `superseded_by`) |
| Code-review rework cycles | 2 (WP-005: stale test mirror; WP-006: `parseInt` regression) |
| Schema version bump | `1.0.0` → `2.0.0` |
| New npm dependencies added | **0** |

### Pipeline Health (all WPs)

| WP | Stages | Outcome |
|----|--------|---------|
| WP-001 | impl → qa → code-review → docs | PASS |
| WP-002 | impl → qa → code-review → docs | PASS |
| WP-003 | impl → qa → code-review → docs | PASS |
| WP-004 | docs | PASS |
| WP-005 | impl → qa → code-review(FAIL) → impl → qa → code-review → docs | PASS (1 rework) |
| WP-006 | impl → qa → security-audit → code-review(FAIL) → impl → code-review → docs | PASS (1 rework) |
| WP-007 | impl → qa → code-review → docs | PASS |
| WP-008 | qa → code-review | PASS |

---

## Files Modified

### New File
- `scripts/migrate-knowledge-uuids.js` — one-time batch migration script

### Schema / Storage Core
- `mcp-server/src/schema/knowledge.ts`
- `mcp-server/src/storage/knowledge-store.ts`

### Tool / MCP Layer
- `mcp-server/src/tools/knowledge.ts`
- `mcp-server/src/storage/multi-store-manager.ts`
- `mcp-server/src/tools/repository-context.ts`
- `mcp-server/src/tools/help-content.ts`

### GUI Layer
- `mcp-server/gui/api-knowledge.ts`
- `mcp-server/gui/public/views/knowledge.js`

### Tests (12 files)
- `mcp-server/tests/schema/knowledge.test.ts`
- `mcp-server/tests/storage/knowledge-store.test.ts`
- `mcp-server/tests/tools/knowledge.test.ts`
- `mcp-server/tests/tools/knowledge-multi-store.test.ts`
- `mcp-server/tests/storage/multi-store-manager.test.ts`
- `mcp-server/tests/storage/cross-device-portability.test.ts`
- `mcp-server/tests/tools/repository-context.test.ts`
- `mcp-server/tests/tools/repository-context-multi-store.test.ts`
- `mcp-server/tests/gui/knowledge-repository-scope.test.ts`
- `mcp-server/tests/gui/knowledge-api.test.ts`
- `mcp-server/tests/gui/api-knowledge.test.ts`
- `mcp-server/tests/gui/server-knowledge-routes.test.ts`

### Manifest / Docs
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `mcp-server/docs/agents/project-manifest/data-flows.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/changelog.md` (v2.8.0 entry)
- `AGENTS.md` / `CLAUDE.md` (migration script entry)

### Live Data (migrated)
- `ledger-storage/store/.knowledge/` (7 files)
- `nexus-ledger-storage/store/.knowledge/` (3 files)

---

## Strategic Recommendations (Gold Nuggets)

1. **UUID v4 via `crypto.randomUUID()` is the right choice for distributed IDs.** It is a Node.js built-in (stable since v19), requires no new dependency, and eliminates the entire class of cross-store collision problems at zero cost. Model-registry (`assignments.json`) used the same pattern first — UUID adoption is now consistent across all identity-bearing schemas in the codebase.

2. **Preserve IDs across move/promote operations.** The decision to preserve the original UUID in `moveInsight()` (rather than assigning a new one from the target store's counter) is architecturally cleaner: it keeps `superseded_by` references valid, removes the counter-reads from move paths, and simplifies the API contract — callers no longer need to capture pre-operation IDs. This pattern should be applied to any future store-relocation operation.

3. **Test mirrors are an anti-pattern — always import and test the real function.** The `parseKnowledgeIdMirror` stale test mirror (WP-005 rework) was the most impactful quality failure in this cycle. The mirror replicated the old integer logic and gave false assurance that integer IDs were still valid post-migration. Rule: if a function is exported (or can be exported cheaply), the test file must import it directly.

4. **All user-visible HTML fields must use `escapeHtml()`.** The security audit (WP-006) caught a missing `escapeHtml` on `ins.superseded_by` in `knowledge.js`. Every other user-visible field in `buildKnowledgeHtml()` was correctly wrapped; `superseded_by` was the sole gap. A systematic audit pattern — "for each new field rendered in HTML, verify `escapeHtml` is applied before the PR is merged" — would prevent this class of issue.

5. **`parseInt()` on ID attributes must be audited during any ID type change.** The GUI regression (WP-006 code-review FAIL) where `parseInt(rawId, 10)` returned `NaN` for UUID strings and silently broke all card mutations is a predictable consequence of changing an ID from numeric to string. Checklist item for future type migrations: grep for `parseInt` / `Number()` / `+value` patterns in any JS/TS file that consumes IDs.

6. **One-shot batch migration scripts are simpler than lazy/eager runtime migration.** The design decision to reject lazy `_readStore()` migration in favor of a one-time batch script (WP-001) was validated: no permanent version-gating code in production paths, no startup penalty, and no schema branching. The idempotency guard (`version === '2.0.0'` skip) makes re-running safe. This pattern is reusable for future schema bumps.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Type | Priority |
|---|--------|-------|-------------|------|----------|
| 1 | WP-007 | Documentation | `knowledge-store.test.ts` line 919: `typeof id === 'string'` should be tightened to `expect(...).toMatch(UUID_REGEX)` — only non-regex UUID assertion in the file | deferred | low |
| 2 | WP-007 | Developer | `knowledge.test.ts`: four `next_id` backward-compat schema tests were removed; no explicit test now covers that `KnowledgeStoreSchema` silently strips `next_id` via Zod `.strip()`. Consider a single schema-layer test to document this behavior | deferred | low |
| 3 | WP-005 | Reviewer | `tests/gui/api-knowledge.test.ts` and `tests/gui/knowledge-api.test.ts` have confusingly similar names and overlapping scope; a future consolidation WP would reduce maintenance confusion | out-of-scope | low |
| 4 | WP-008 | Reviewer | `scripts/migrate-knowledge-uuids.js` lines ~140–145: the `superseded_by` cross-file drop behavior lacks a rationale comment explaining *why* dropping is safe (cross-file references are structurally invalid since each knowledge file is a self-contained scope unit) | deferred | low |
| 5 | WP-006 | Documentation | CTX docs are stale after changes to `api-surface.md` and `knowledge.js`; run `node scripts/cli.js ctx-generate` to regenerate `.context/mcp-server/manifest-api-surface.md` and `.context/mcp-server/source-gui-frontend.md` | deferred | medium |
| 6 | WP-002 | Reviewer | `knowledge-store.ts` `moveInsight()`: the comment on `const movedAt = now()` is slightly inaccurate (step 6 uses a fresh `now()` for `sourceStore.last_updated`). Low-risk cosmetic fix | deferred | low |

---

## Next Steps

1. **Run `node scripts/cli.js ctx-generate`** to regenerate stale `.context/` docs after this migration. Both `manifest-api-surface.md` and `source-gui-frontend.md` are out of sync with the UUID changes and the `knowledge.js` wireEvents comment additions.

2. **Bump the MCP server version and release.** `mcp-server/changelog.md` v2.8.0 entry is already written by WP-004. The Planner / Release Engineer should sync `mcp-server/package.json` via `npm run sync-version` and tag a root release.

3. **Address the deferred items** (items 1–4 above) in a lightweight maintenance WP in a future cycle. None are blocking; the three low-priority test improvements can be batched into a single small PR.

4. **Consider extending the UUID pattern to other schema counters.** The `next_id` pattern was isolated to the knowledge store in this codebase, but any future ID-bearing schema introduced in the MCP server should default to `crypto.randomUUID()` rather than auto-increment from day one.
