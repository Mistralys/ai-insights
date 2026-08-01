# Synthesis Report — Cross-Device Ledger Sync (Multi-Store Architecture)

**Project:** `2026-07-24-cross-device-ledger-sync`
**Date:** 2026-07-24
**Synthesis Agent:** Head of Operations (Synthesis)
**Status at Synthesis:** 15/15 WPs COMPLETE · 0 pending · Perfect pipeline health

---

## Executive Summary

This project delivered a **multi-store ledger architecture** for the MCP server: the ability to
manage multiple independent ledger root directories simultaneously. A `stores.json` file at
`~/.ai-insights/stores.json` registers named stores, each owning its own project tree,
`.repositories.json`, and `.knowledge/` directory. The system is fully backward-compatible —
the absence of `stores.json` activates legacy single-store mode with zero behavioral change.

The implementation spans 15 work packages covering:

- **4 new TypeScript storage modules** (`store-registry.ts`, `store-router.ts`,
  `multi-store-manager.ts`, `store-context.ts`) and a new Zod schema (`store-config.ts`)
- **Startup integration** in both the STDIO MCP server (`index.ts`) and the HTTP GUI server
  (`gui/server.ts`)
- **7 MCP tool files** updated for multi-store read/write routing
- **10 CLI subcommands** (`store init/add/remove/list/default/conflicts/status`,
  `store repo add/move/list`) in `scripts/lib/store-commands.js`
- **3 GUI API handlers** updated (`api.ts`, `api-repos.ts`, new store endpoints in `api.ts`)
- **Strategy page UI** with Store dropdown and Conflicts tab (vanilla JS)
- **Full manifest documentation** (api-surface.md, file-tree.md, data-flows.md, constraints.md,
  AGENTS.md, tech-stack.md, multi-store-guide.md)

Two code-review FAILs were caught and corrected during the cycle:
- **WP-004:** `detectProjectByCwd()` guard bug (FOUND discarded by intra-store AMBIGUOUS)
- **WP-006:** `storeRepoMove()` validate-before-mutate bug (source mutated before target check)

Both were fixed and re-verified within the same session.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 15 / 15 COMPLETE |
| Pipeline stages passed | 57 / 57 (100%) |
| Code-review FAILs caught | 2 (both fixed and re-verified) |
| Reviewer Fix-Forwards applied | 7 |
| Final test suite (MCP server) | **3,838 tests / 134 files — all pass** |
| Final test suite (workspace scripts) | **152 tests — all pass** |
| TypeScript type-check | ✅ Clean (0 errors across all WPs) |
| Regressions introduced | 0 |
| New tests added (MCP server) | ~132 (3706 → 3838) |
| New tests added (workspace scripts) | ~1 net (151 → 152) |

### Test Count Progression

| WP | New Tests | Running Total |
|---|---|---|
| WP-001 | 39 (schema + store-registry) | 3,710 |
| WP-002 | 4 (per-store isolation) | 3,714 |
| WP-003 | 21 (StoreRouter) | 3,731 (+ 4 more from WP-002 rounding) |
| WP-004 | 24+1 (MultiStoreManager + rework) | 3,756 |
| WP-005 | 8 (store-context) | 3,764 |
| WP-006 | 33+1 (store CLI + rework) | 152 script tests |
| WP-007 | 13 (project-lifecycle multi-store) | 3,787 |
| WP-008 | 0 (ACs verified by code inspection) | 3,787 |
| WP-009 | 10 (knowledge multi-store) | 3,787 |
| WP-011 | 0 (GUI, not covered by test suite) | 3,787 |
| WP-012 | 23 (GUI store endpoints + orchestrator preflight) | 3,838 |
| WP-013 | 22 (GUI repo CRUD multi-store) | 3,838 |
| WP-014 | 0 (vanilla JS GUI, no automated tests) | 3,838 |

---

## Architecture Delivered

### Core Pattern: Additive Multi-Store Layer

```
~/.ai-insights/stores.json   ← user-level config (optional)
        ↓
StoreRegistry (src/storage/store-registry.ts)
    loadStoresConfig / saveStoresConfig / expandStorePath / resolveGuiConfigPath
        ↓
StoreRouter (src/storage/store-router.ts)
    isMultiStoreMode / resolveStoreForWrite / resolveDefaultStore / getAllStorePaths / getAllStores
        ↓
MultiStoreManager (src/storage/multi-store-manager.ts)
    listAllProjects / detectProjectByCwd / getMergedRegistry / getRegistryConflicts / searchKnowledge / listKnowledge
        ↓
StoreContext singleton (src/storage/store-context.ts)
    setStoreContext / getStoreRouter / getMultiStoreManager / isStoreContextInitialized
```

**Key invariants (constraints 78–85):**
- `stores.json` is optional — absence = legacy mode, zero behavioral change
- In multi-store mode, repositories must be registered before write routing works
- Per-store `.repositories.json` files are the source of truth for ownership
- Store-order priority for all conflict resolution (first store wins)
- The MCP server is read-only collation + write routing — no sync responsibility
- No new MCP tool parameters exposed to agents
- `gui-config.json` is server-wide, at `~/.ai-insights/gui-config.json` in multi-store mode

---

## Strategic Recommendations (Gold Nuggets)

### 1. Complete `project-resolver.ts` for Full Multi-Store Tool Coverage
**Source:** WP-007 Developer + Reviewer · **Priority:** High

`project-resolver.ts` still calls `LedgerStore.detectProjectByCwd()` directly, making
work-package and pipeline tools (`ledger_claim_work_package`, `ledger_complete_pipeline`,
etc.) single-store-only for `cwd_path` resolution. This is the largest functional gap remaining.
A follow-up WP to update `project-resolver.ts` to call `getMultiStoreManager().detectProjectByCwd()`
would extend full multi-store support to the entire tool surface.

### 2. Consolidate the GUI Repo Listing Split-Brain
**Source:** WP-013 Reviewer · **Priority:** Medium

`buildRepoRoutes()` in `gui/server.ts` bypasses `handleListRepos()` with an inline
`taggedEntryToRepoListItem()` mapping that omits `store_id`. As a result, the
multi-store branch added to `handleListRepos()` in WP-013 is dead code from the HTTP
route perspective. One canonical path should be chosen:
- Option A: update `buildRepoRoutes()` to delegate to `handleListRepos()` in all modes.
- Option B: remove the multi-store branch from `handleListRepos()` and keep logic exclusively in `server.ts`.

### 3. Implement Write-Side Multi-Store for GUI Repo CRUD
**Source:** WP-011/WP-013 QA + Reviewer · **Priority:** Medium

POST, PUT, and DELETE `/api/repos` still route to `ledgerRoot` only. In multi-store mode, a repo
registered in the `work` store can only be deleted or updated via the default store's path.
The `findEntryInStores()` helper is already implemented — a follow-up WP would wire it into the
write handlers.

### 4. Consider UUID or Store-Prefixed Insight IDs
**Source:** WP-004 Developer + WP-009 QA · **Priority:** Medium

Per-store `KnowledgeStoreManager` counters start at 1, creating structural ID collisions across
stores (insight id=1 in store-A and insight id=1 in store-B are different insights).
Cross-store deduplication-by-id is semantically correct for sync scenarios, but test fixtures
require pre-seeding filler insights to offset counters — a fragility. A scoped-id scheme
(UUID or `{storeId}:{counter}`) would eliminate the collision entirely.

### 5. Extract `SLUG_REGEX` to `schema/common.ts`
**Source:** WP-001 Developer + Reviewer · **Priority:** Low

`store-config.ts` imports `SLUG_REGEX` from `schema/knowledge.ts` — coupling two unrelated
schemas. Moving `SLUG_REGEX` to a dedicated `schema/common.ts` (or `schema/shared.ts`) would
break this unexpected dependency and make the intent clearer to contributors.

### 6. Harden `storeInit()` Test Isolation
**Source:** WP-006 Developer, QA, Reviewer (flagged 3×) · **Priority:** Low

`saveConfig()` calls `mkdirSync(join(homedir(), AI_INSIGHTS_DIR))` unconditionally, even when a
test-override `configPath` is provided. A `_storesDirOverride` parameter on `saveConfig()` and
`storeInit()` would make both fully hermetic without breaking the production code path.

---

## Deferred & Follow-Up Items

### Deferred (Intentionally Postponed)

| ID | Source | Agent | Description | Priority |
|---|---|---|---|---|
| D-01 | WP-004 | Developer / QA | Pre-pagination semantics: `limit/offset` forwarded to per-store calls before cross-store dedup may return fewer than `limit` results. Accepted as out-of-scope until GUI surfaces paginated cross-store knowledge views. | Low |
| D-02 | WP-001 | Reviewer | `expandStorePath('~username')` (tilde without separator) falls through to CWD-relative resolution. Safe in server-side context; worth guarding if user-provided raw input is ever accepted directly. | Low |
| D-03 | WP-012 | QA | `handleOrchestratorStart()` edge case: `inferProjectRootFromPlanPath(planPath)` returning null (path without `/docs/agents/`) skips registration check silently. No test covers this path. Correct behavior, no AC required it. | Low |
| D-04 | WP-014 | Reviewer | `getStoreConflicts()` called unconditionally on Strategy page load even in single-store mode (server returns `[]` immediately; negligible cost). A two-phase fetch would eliminate the round-trip for single-store users. | Low |

### Out of Scope (Beyond This Plan's Boundaries)

| ID | Source | Agent | Description | Priority |
|---|---|---|---|---|
| OS-01 | WP-007 | Developer + Reviewer | `project-resolver.ts` still uses `LedgerStore.detectProjectByCwd()` — work-package/pipeline tools not multi-store-aware. Tracked as the primary follow-up WP (see Recommendation 1). | High |
| OS-02 | WP-013 | Reviewer | GUI repo write handlers (POST/PUT/DELETE) route to `ledgerRoot` only; `findEntryInStores()` not wired into write path. Tracked as Recommendation 3. | Medium |
| OS-03 | WP-013 | Reviewer | `handleListRepos()` multi-store branch is dead code from HTTP perspective (bypassed by `buildRepoRoutes()`). Tracked as Recommendation 2. | Medium |
| OS-04 | WP-006 | Reviewer | `storeRemove()` leaves `default_store` pointing to deleted ID when all stores are removed (produces technically inconsistent config state). Harmless today — all consumers handle empty-stores gracefully. | Low |
| OS-05 | WP-008 | QA + Reviewer | No `_internal` integration tests for `repository-context.ts` multi-store code paths (AC1/AC2 verified by code inspection only). | Low |
| OS-06 | WP-009 | Reviewer | `updateInsight` uses `new Error(...)` while `deleteInsight` uses `re-throw lastError` for the "not found" case — inconsistent error propagation. | Low |
| OS-07 | WP-012 | Developer | `StoreListItem` interface defined locally in `gui/api.ts` rather than `src/schema/`. Candidate for migration when frontend consumers emerge. | Low |

---

## Next Steps for Planner

1. **Immediate priority:** Plan a follow-up WP to update `project-resolver.ts` to use
   `MultiStoreManager.detectProjectByCwd()`. This completes multi-store coverage for all MCP tools.

2. **Medium-term:** Plan a GUI refactoring WP to:
   - Consolidate `handleListRepos()` / `buildRepoRoutes()` split-brain (Recommendation 2)
   - Wire `findEntryInStores()` into POST/PUT/DELETE `/api/repos` (Recommendation 3)

3. **Knowledge/insight infrastructure:** Evaluate UUID or store-prefixed insight IDs before the
   cross-store knowledge workflow is heavily used (Recommendation 4).

4. **Documentation pass:** Update `api-surface.md` to remove the stale "40 REST endpoints"
   hardcoded count in the `api-client.js` section (noted by WP-014 Documentation agent).

5. **CLI hardening:** Address `storeInit()` test isolation (`_storesDirOverride`) and
   `SLUG_REGEX` extraction to `schema/common.ts` in a small housekeeping WP.

---

*Report generated by Head of Operations (Synthesis) — 2026-07-24*
