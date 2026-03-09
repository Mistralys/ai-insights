# Plan — Post-Archiving Technical Debt Remediation

## Summary

Resolve the five technical debt items identified in the [2026-03-06-project-archiving synthesis](../2026-03-06-project-archiving/synthesis.md). The work covers three backend schema/logic fixes (items 1–3) and two frontend quality improvements (items 4–5) in the MCP server GUI. All changes are internal refactors with no new features or API contract changes.

## Architectural Context

### Schema layer

- **`ProjectStatus`** is the canonical Zod enum defined in [mcp-server/src/schema/enums.ts](mcp-server/src/schema/enums.ts) with values `READY | IN_PROGRESS | COMPLETE | BLOCKED | ARCHIVED`.
- **`ProjectMetaSchema`** in [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts) declares its own `status` field as a hardcoded `z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED'])` instead of referencing `ProjectStatus`.
- Other schemas (`RootIndexSchema`, `WorkPackageStatus`, etc.) already import and reference their shared enum from `enums.ts`.

### GUI config layer

- **`GuiConfigSchema`** is defined in [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts) with four fields: `auto_handoff_enabled`, `max_handoff_depth`, `auto_archive_days`, `ledger_root`.
- **`GuiConfigPartialSchema`** is a hand-maintained mirror in [mcp-server/gui/api.ts](mcp-server/gui/api.ts) (line 730) that duplicates three of those four fields as `.optional()`. `ledger_root` is intentionally excluded (read-only in the GUI).
- If a field is added to `GuiConfigSchema`, the partial schema must also be updated manually — a drift risk.

### `initializeProject` enrichment

- In [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) (lines 478–525), steps 4 (root index write), 5 (meta enrichment write), and 6 (plan archival) share a single `try/catch`. If meta enrichment (step 5) fails — e.g. `readProjectName` throws — the entire initialization reports failure even though the root index was already persisted. The caller has no way to distinguish "enrichment failed but project was created" from "project creation itself failed".

### Frontend (`app.js`)

- [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) is a plain-JavaScript SPA (no ES modules, no frameworks) organized into numbered comment-delimited sections: 1-API Client, 2-Theme, 3-Router, 4-Utilities + Views, 5-Bootstrap.
- File is **1 540 lines** with all view renderers, event wiring, and utilities in one file.
- `getProjects()` builds query strings via manual `if` / `parts.push('key=' + encodeURIComponent(value))` concatenation (lines 33–43).

## Approach / Architecture

Five independent, low-risk refactors — each can be implemented and tested in isolation:

1. **Schema dedup:** Replace the hardcoded `z.enum(...)` in `ProjectMetaSchema.status` with a reference to the shared `ProjectStatus` import from `enums.ts`.
2. **Config partial derivation:** Replace the hand-maintained `GuiConfigPartialSchema` in `gui/api.ts` with `GuiConfigSchema.omit({ ledger_root: true }).partial()`, imported from `config.ts`.
3. **Enrichment resilience:** Wrap step 5 (meta enrichment) in `initializeProject` in its own `try/catch` so enrichment failures are non-fatal and observable (add `enrichment_cached: boolean` to the success response).
4. **`app.js` modular extraction:** Split the single 1 540-line file into separate `<script>` files loaded by `index.html`, one per logical section.
5. **`buildQueryString` helper:** Extract a reusable `buildQueryString(params)` utility function within the API client module to replace the manual concatenation in `getProjects`.

Items 1, 2, 3 are backend TypeScript changes. Items 4 and 5 are frontend plain-JS changes. Item 5 is a prerequisite-of or included-in item 4 (the helper naturally lives in the extracted API-client module).

## Rationale

| Decision | Why |
|----------|-----|
| Import `ProjectStatus` rather than re-export or inline | Follows the existing pattern used by `RootIndexSchema` and other schemas; single source of truth in `enums.ts` |
| Use `.omit().partial()` derivation | Zod's composability makes this a one-liner; guarantees the partial schema always tracks `GuiConfigSchema` minus the read-only field |
| Non-fatal enrichment with response flag | Avoids regressing project creation on upstream I/O issues; `enrichment_cached` flag lets callers (or future UIs) surface warnings |
| File-level module split (not ES modules) | `app.js` is a plain `<script>` SPA with IIFE-based module pattern; introducing ES modules would require a bundler or significant architecture change — out of scope. Script-tag splitting preserves the existing pattern while improving navigability and testability |
| Implement `buildQueryString` as part of the extraction | The two items share the same file; combining them avoids touching `app.js` twice |

## Detailed Steps

### Step 1 — `ProjectMetaSchema` status dedup

1. In [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts):
   - Add `import { ProjectStatus } from './enums.js';` to the imports.
   - Replace the `status: z.enum(['READY', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'ARCHIVED'])` field with `status: ProjectStatus`.
2. Run the full test suite (`npm test`) to verify no regressions.
3. Update [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) if it documents `ProjectMetaSchema` field definitions — note that `status` is now derived from the shared enum.

### Step 2 — `GuiConfigPartialSchema` derivation

1. In [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts):
   - Export a new `GuiConfigPartialSchema`:
     ```ts
     export const GuiConfigPartialSchema = GuiConfigSchema.omit({ ledger_root: true }).partial();
     ```
   - Export its inferred type if useful: `export type GuiConfigPartial = z.infer<typeof GuiConfigPartialSchema>;`
2. In [mcp-server/gui/api.ts](mcp-server/gui/api.ts):
   - Remove the local `GuiConfigPartialSchema` definition (lines 730–735).
   - Add `GuiConfigPartialSchema` to the import from `../src/gui/config.js`.
3. Run the full test suite to confirm no regressions.
4. Update [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) to note the schema derivation.

### Step 3 — `initializeProject` enrichment resilience

1. In [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts), refactor the `initializeProject` function (lines ~478–525):
   - Keep step 4 (`writeRootIndex`) in the existing `try/catch`.
   - Wrap step 5 (meta enrichment: `inferProjectRootFromPlanPath`, `readProjectName`, `writeProjectMeta`) in a **nested** `try/catch`. On failure, set a local `enrichmentCached = false` flag and log the error to `stderr`.
   - Step 6 (document archival) remains in the outer `try/catch`.
   - Add `enrichment_cached: enrichmentCached` to the success JSON response object.
2. Write/extend tests in `tests/tools/` to verify:
   - When `readProjectName` throws, `initializeProject` still succeeds and `enrichment_cached === false`.
   - When enrichment succeeds, `enrichment_cached === true`.
3. Update [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) — add `enrichment_cached` to the `initializeProject` response documentation.

### Step 4 — `app.js` modular extraction

1. Create the following new files under [mcp-server/gui/public/](mcp-server/gui/public/):
   - **`api-client.js`** — the `API` IIFE (section 1) + a `buildQueryString` helper (addresses item 5).
   - **`theme.js`** — the `Theme` IIFE (section 2).
   - **`router.js`** — the `Router` IIFE (section 3).
   - **`utils.js`** — shared utility functions: `escapeHtml`, `formatDate`, `statusBadge`, `showLoading`, `showError`.
   - **`views/project-list.js`** — `renderProjectList` (section 4a).
   - **`views/project-detail.js`** — `renderProjectDetail`, `renderPlan`, `renderSynthesis`, `extractSynopsis`, `showResetModal` (sections 4b–4d).
   - **`views/work-package.js`** — `renderWorkPackageDetail` (section 4e).
   - **`views/config.js`** — `renderConfig` (section 4f).
   - **`views/insights.js`** — `renderInsights` (section 4g).
   - **`app.js`** — reduced to Bootstrap only (section 5): `Theme.init(); Router.init();`
2. Update [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) to load the new scripts via `<script>` tags **in dependency order** (api-client → theme → router → utils → views → app).
3. Verify the dashboard works end-to-end by running the GUI server and manually testing all views.
4. Update [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) to reflect the new files.

### Step 5 — `buildQueryString` helper (included in step 4)

1. In the extracted `api-client.js`, add a private helper:
   ```js
   function buildQueryString(params) {
     if (!params) return '';
     var parts = Object.keys(params)
       .filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
       .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
     return parts.length ? '?' + parts.join('&') : '';
   }
   ```
2. Refactor `getProjects` to call `buildQueryString(params)` instead of the manual `if`-chain.
3. This helper is available for any future endpoint that needs query parameters.

## Dependencies

- Steps 1, 2, 3 are independent of each other and of steps 4–5.
- Step 5 is logically merged into step 4 (same file extraction).
- No external dependency changes — all work uses existing libraries (Zod, Node.js built-ins).

## Required Components

### Modified files

| File | Step |
|------|------|
| [mcp-server/src/schema/project-meta.ts](mcp-server/src/schema/project-meta.ts) | 1 |
| [mcp-server/src/gui/config.ts](mcp-server/src/gui/config.ts) | 2 |
| [mcp-server/gui/api.ts](mcp-server/gui/api.ts) | 2 |
| [mcp-server/src/tools/project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) | 3 |
| [mcp-server/gui/public/app.js](mcp-server/gui/public/app.js) | 4 |
| [mcp-server/gui/public/index.html](mcp-server/gui/public/index.html) | 4 |

### New files

| File | Step |
|------|------|
| `mcp-server/gui/public/api-client.js` | 4, 5 |
| `mcp-server/gui/public/theme.js` | 4 |
| `mcp-server/gui/public/router.js` | 4 |
| `mcp-server/gui/public/utils.js` | 4 |
| `mcp-server/gui/public/views/project-list.js` | 4 |
| `mcp-server/gui/public/views/project-detail.js` | 4 |
| `mcp-server/gui/public/views/work-package.js` | 4 |
| `mcp-server/gui/public/views/config.js` | 4 |
| `mcp-server/gui/public/views/insights.js` | 4 |

### Manifest updates

| Document | Step |
|----------|------|
| [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) | 1, 2, 3 |
| [mcp-server/docs/agents/project-manifest/file-tree.md](mcp-server/docs/agents/project-manifest/file-tree.md) | 4 |

## Assumptions

- The existing test suite (1 200 tests) provides sufficient coverage to detect regressions from steps 1–3.
- The `app.js` plain-JS IIFE pattern will be preserved for the extraction; no bundler or ES module conversion.
- All extracted modules communicate via globals (`API`, `Theme`, `Router`) — the same pattern currently in use within the single file.
- The `views/` sub-directory is acceptable for organizing view modules; the GUI server already serves static files from `public/`.

## Constraints

- **No ES modules or build tooling** for the frontend. The SPA must remain loadable as plain `<script>` tags.
- **No new npm dependencies.** All changes use existing Zod APIs and plain JavaScript.
- **STDIO discipline** must be maintained: `project-lifecycle.ts` logs enrichment failures to `stderr`, never `stdout`.
- **Atomic write patterns** remain unchanged — `writeProjectMeta` already uses `atomicWriteJson` internally.

## Out of Scope

- Converting `app.js` to a framework-based SPA or adding a JS bundler.
- Adding unit tests for the frontend JavaScript (no test framework exists for the GUI frontend).
- Migrating existing `.meta.json` files to include `enrichment_cached` retroactively.
- Addressing the TOCTOU window in archive/unarchive (noted in synthesis as accepted, low-risk).

## Acceptance Criteria

1. `ProjectMetaSchema.status` is defined as a reference to `ProjectStatus` from `enums.ts`; no duplicate enum values exist in `project-meta.ts`.
2. `GuiConfigPartialSchema` is derived from `GuiConfigSchema` via `.omit().partial()`; no hand-maintained field list exists in `gui/api.ts`.
3. `initializeProject` succeeds even when meta enrichment throws; the response includes `enrichment_cached: true | false`.
4. `app.js` is split into ≥ 8 separate files; each file contains one logical module; `index.html` loads them in order.
5. `getProjects` uses a `buildQueryString` helper instead of manual concatenation.
6. Full test suite passes with zero regressions (`npm test` in `mcp-server/`).
7. GUI dashboard loads and renders all views correctly after the `app.js` split.
8. All relevant project manifest documents are updated.

## Testing Strategy

| Step | Test approach |
|------|---------------|
| 1 — Schema dedup | Existing schema tests (`tests/schema/project-archiving-schema.test.ts` and others) validate that `ProjectMetaSchema` accepts all valid statuses. Run full suite. |
| 2 — Config partial | Existing `handleUpdateConfig` tests in `tests/gui/api.test.ts` validate the partial schema behavior. Run full suite. |
| 3 — Enrichment resilience | **New tests** in `tests/tools/` — mock `readProjectName` to throw and verify `initializeProject` returns success with `enrichment_cached: false`. Verify normal path returns `enrichment_cached: true`. |
| 4 — `app.js` split | Manual end-to-end verification: start GUI server, navigate all views (project list, detail, work packages, config, insights), verify all interactions (archive, unarchive, delete, pagination, search, theme toggle). |
| 5 — `buildQueryString` | Covered by step 4 manual testing — the project list view exercises `getProjects` with all parameter combinations. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`app.js` split introduces script-load-order bugs** | Keep the same global-variable pattern; load scripts in strict dependency order in `index.html`; test all views manually |
| **`GuiConfigPartialSchema` derivation subtly changes validation** | The `.omit().partial()` chain produces identical constraints to the current hand-written schema; verify via existing tests |
| **`enrichment_cached` field breaks downstream consumers** | The field is added to the tool's JSON response only; MCP tool responses are untyped text — no schema contract is broken |
| **Missing reference in `ProjectMetaSchema` breaks circular import** | `project-meta.ts` → `enums.ts` is a one-way leaf import; no circularity possible |
