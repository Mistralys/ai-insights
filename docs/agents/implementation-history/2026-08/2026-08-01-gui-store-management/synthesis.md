# Synthesis — GUI Store Management

**Project:** GUI Store Management  
**Plan folder:** `docs/agents/plans/2026-08-01-gui-store-management`  
**Date:** 2026-08-01  
**Status:** COMPLETE — 8/8 work packages  
**Pipeline health:** 8/8 WPs with all stages passing

---

## Executive Summary

This project delivered a full CRUD **Stores tab** for the MCP Server GUI Configuration screen. Users can now view, add, import, edit, remove, reorder, and set the default store entirely through the GUI without any CLI commands.

The implementation spans the full stack:

- **Backend schema:** `StoreListItem` enriched with five new fields (`is_default`, `is_git`, `ahead?`, `behind?`, `sync?`); `StoreRouter` gained a `skipDirCreate` option for hot-reload safety.
- **Backend service:** `reloadStoreContext()` — a new function in `store-context.ts` that re-reads `stores.json` at runtime and updates the module-level singletons without a server restart.
- **Backend API:** New domain-split file `gui/api-stores.ts` implementing eight CRUD handlers; handlers extracted from `gui/api.ts` following the established split pattern.
- **Server routing:** `buildStoreRoutes()` in `server.ts` wires all eight routes with correct literal-path-before-`:storeId` ordering.
- **Frontend:** New 700-line ES5 module `config-stores.js` with a nine-column store table, add/edit modal, import-with-warning banner, copy-to-clipboard paths, sync hover popovers, Git ahead/behind badges, and a reorder sub-view. Integrated into `config.js` with proper state isolation and tab-switch cleanup.
- **Manifest documentation:** Seven project-manifest documents updated; `.context/` snapshots regenerated.

---

## Metrics

| Dimension | Value |
|-----------|-------|
| Work packages | 8 / 8 COMPLETE |
| Pipeline stages executed | 30 (across 8 WPs) |
| Rework cycles (WP-006) | 2 implementation · 2 QA · 2 code-review |
| Security audit (WP-004) | 0 Critical · 0 High · 1 Medium (resolved) |
| New test files | 2 (`store-context-reload.test.ts`, full rewrite of `api-stores.test.ts`) |
| Tests in targeted suites | 65 (api-stores: 58 · store-context-reload: 7) |
| Full regression suite | **3,944 / 3,944** tests pass · 138 files · 0 regressions |
| TypeScript build | Clean — `tsc --noEmit` exit 0 throughout |
| Reviewer Fix-Forwards applied | 3 (`store-context.ts` JSDoc, `UpdateStoreBodySchema.label`, `csReorderMode` guard) |

### Files Created or Modified

**Backend (production code)**

| File | Change |
|------|--------|
| `mcp-server/src/schema/store-config.ts` | +5 fields on `StoreListItem`; JSDoc on all new fields |
| `mcp-server/src/storage/store-router.ts` | `skipDirCreate` constructor option; class-level JSDoc update |
| `mcp-server/src/storage/store-context.ts` | New `reloadStoreContext()` function; JSDoc corrected |
| `mcp-server/gui/api-stores.ts` | **New file** — 8 CRUD handlers + Git enrichment |
| `mcp-server/gui/api.ts` | Removed `handleGetStores` / `handleGetStoreConflicts` |
| `mcp-server/gui/server.ts` | `buildStoreRoutes()` fully wired; imports migrated from api.ts → api-stores.ts |

**Frontend (production code)**

| File | Change |
|------|--------|
| `mcp-server/gui/public/views/config-stores.js` | **New file** — 700-line ES5 Stores tab module |
| `mcp-server/gui/public/views/config.js` | Stores tab integration, Promise.all fetch, cleanup |
| `mcp-server/gui/public/api-client.js` | 6 new store write methods; version bumped to v=5 |
| `mcp-server/gui/public/index.html` | Script tag + cache-bust version bumps |
| `mcp-server/gui/public/styles.css` | All `.cs-*` CSS classes for Stores tab |

**Tests**

| File | Change |
|------|--------|
| `mcp-server/tests/storage/store-router.test.ts` | +3 `skipDirCreate` tests |
| `mcp-server/tests/storage/store-context-reload.test.ts` | **New file** — 7 tests for `reloadStoreContext()` |
| `mcp-server/tests/gui/api-stores.test.ts` | Full rewrite — 58 assertions across all 8 handlers |
| `mcp-server/tests/gui/api-store-conflicts.test.ts` | Import path fix (api.ts → api-stores.ts) |

**Documentation (manifest + .context)**

- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/docs/agents/project-manifest/constraints.md` (§62 — domain-split rule for api-stores.ts)
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md`
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` (§13 — Store Management data flow)
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` (§16 — hot-reload; §17 renumbered)
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` (§11b Stores Tab classes; §11b reorder classes)
- `.context/mcp-server/manifest-constraints.md` (regenerated)
- `.context/mcp-server/manifest-file-tree.md` (regenerated)

---

## Strategic Recommendations

### Gold Nuggets

**1. Hot-reload pattern is now established — extend it.**  
`reloadStoreContext()` proves that in-process config reloading works safely for the store layer. The same pattern (read config → construct new singletons → swap module-level refs atomically) could be applied to other runtime-configurable components (e.g., repository registry, model assignments). The `configPath` override for test isolation is the correct pattern to carry forward.

**2. `skipDirCreate` is a contract, not just a flag.**  
The reviewer's comment that `{ skipDirCreate?: boolean }` should eventually become a named `StoreRouterOptions` interface is worth tracking. Inline anonymous option bags are fine at one field; they become a maintenance liability at three. The first time a second constructor option is added, extract the interface.

**3. ES5 event-delegation requires an explicit `removeEventListener` lifecycle.**  
WP-006 required three code-review cycles because the initial ES5 implementation accumulated event listeners on a persistent DOM element. The correct pattern — `var csClickHandler = null`, `removeEventListener(csClickHandler)` before `addEventListener`, `removeEventListener` in the cleanup block before nulling — is now established in `config-stores.js` and `config.js`. All future ES5 modules that register listeners on persistent elements (e.g., future config tab modules) must follow this pattern from the start.

**4. Route literal-path ordering is a load-bearing constraint.**  
`buildStoreRoutes()` documents with inline comments that `POST /api/stores/import` and `PUT /api/stores/order` must appear before `PUT /api/stores/:storeId`. This pattern repeats across every domain-split route builder. The Security Auditor's recommendation to apply `assertSafeSlug()` / `SLUG_REGEX` to extracted `:storeId` URL parameters was incorporated in WP-005 via `decodeURIComponent` at call sites. This pairing (ordering + slug validation) should be the default checklist for every future parameterized route addition.

**5. ES5 modal accessibility gap is documented — close it in the next GUI session.**  
`csCloseModal()` does not restore focus to the triggering element. This violates WCAG 2.1 SC 3.2.2 and was explicitly documented in `api-surface.md`. The fix is small (capture `document.activeElement` before modal insertion; call `triggerEl.focus()` on close). Given that the GUI is increasingly used by non-CLI users, accessibility improvements should graduate from "documentation-forward" to acceptance criteria in the next modal-touching WP.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed from this plan)

| Source | Agent | Description | Priority |
|--------|-------|-------------|----------|
| WP-006 × 3 code-reviews | Reviewer | `csCloseModal()` does not restore focus to the trigger element (WCAG 2.1 SC 3.2.2). Fix: capture `document.activeElement` before modal insertion; call `triggerEl.focus()` after `overlay.remove()`. | Low (accessibility) |
| WP-006 code-review | Reviewer | Label field renders "(optional)" in both add and edit modes. In edit mode, clearing an existing label shows a required-field error — making the hint misleading. Conditionally render hint based on mode and existing-label state. | Low (cosmetic) |
| WP-005 QA | QA | No integration test asserts that `PUT /api/stores/order` is not caught by the `:storeId` regex — route dispatch ordering is untested at server integration level. | Low |
| WP-004 code-review | Reviewer | `api-stores.test.ts` missing a test case for `handleUpdateStore()` when `label` is entirely absent from the body (to complement the existing whitespace-only test). | Low |
| WP-003 code-review | Reviewer | No concurrency guard on `reloadStoreContext()` — two overlapping calls race and the last writer wins. Acceptable for user-triggered GUI use; worth guarding if a high-frequency reload path is added. | Low |
| WP-001 code-review | Reviewer | `StoreRouterOptions` inline type `{ skipDirCreate?: boolean }` should be extracted to a named interface when a second constructor option is added. | Low (future-proofing) |

### Out of Scope (beyond this plan's boundaries)

| Source | Agent | Description |
|--------|-------|-------------|
| WP-007 code-review | Reviewer | `csShowTableError()` is a no-op in reorder mode (`#cs-table-error` only exists in the main table view). Failed `API.reorderStores()` calls lose their error message before `csRefreshTab()` restores state. Consider adding an error target element to `csRenderReorderView()`. |
| WP-004 implementation | Developer | `runGit()` passes both `-C {path}` args AND `cwd: {path}` to `execFileAsync` — redundant but harmless. A `gitRevList()` parsing helper would reduce the parsing surface to one place. |
| WP-006 implementation | Developer | `csRefreshWithStores()` double-banner edge case: if a `cs-notification-banner` is already in the DOM when `renderStoresTab()` runs AND a new import warning is passed, two banners can briefly coexist. Dismissible and very low probability. |
| WP-006 implementation | Developer | Sync popover (`cs-sync-popover`) uses `position:absolute` on the sync cell. Near the right viewport edge the popover may overflow right. No other GUI popovers have a flip-left guard; this can be addressed in a dedicated GUI polish WP. |
| WP-001 code-review | Reviewer | `StoreListItem` fields lack JSDoc explaining what `is_git: false` implies for `ahead`/`behind` (both should be undefined) and when `sync` is populated vs undefined — **addressed in WP-001 documentation pipeline; not actually deferred**. |
| WP-003 documentation | Documentation | `.context/mcp-server/manifest-api-surface.md` mirrors `api-surface.md` and will be stale after WP-003 changes. Regenerate with `node scripts/cli.js ctx-generate` before the next release. |

---

## Next Steps

1. **Changelog update** — Add entries to `mcp-server/changelog.md` and the root `changelog.md` for this feature. The store management GUI is a significant user-facing addition that warrants a minor version bump.

2. **CTX regeneration** — Run `node scripts/cli.js ctx-generate` to sync `.context/mcp-server/manifest-api-surface.md` (stale since WP-003/WP-004 documentation updates).

3. **Accessibility pass (WP-006 carry-forward)** — Implement focus restoration in `csCloseModal()` as part of the next GUI-touching WP. Elevate this to an acceptance criterion rather than a documentation-forward.

4. **Route dispatch ordering test** — Add a server-level integration test asserting that `PUT /api/stores/order` routes to `handleReorderStores` and NOT to `handleUpdateStore`. Low risk at present but the constraint is load-bearing.

5. **`handleUpdateStore` test coverage** — Add the absent-label test case to `api-stores.test.ts` alongside the existing whitespace-only test.

6. **`reloadStoreContext()` — apply to other config domains** — Explore whether the hot-reload pattern can be generalized (e.g., a `reloadRepositoryRegistry()` analogue) to give other GUI write operations the same zero-restart property.
