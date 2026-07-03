# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The parent project `2026-06-30-standalone-ledger-integration` (COMPLETE, 10 WPs, 43/43 stages passed) delivered the `ledger_import_standalone` MCP tool, `standalone-archiver` persona, and CLI batch-import command. Its synthesis identified one high-priority scope gap (GUI detail page verification for `runner: 'standalone'` imported projects — the original WP-008 spec was displaced by a ledger setup anomaly), one medium-priority dependency upgrade (persona-builder ≥ 2.6.0 for changelog-based frontmatter version derivation), and four low-priority cleanup items. This rework plan addresses all actionable items from the synthesis. The repository's short-term strategic goal (minimal-friction setup and usage) is served by the GUI verification, startup log accuracy, and the persona-builder upgrade (correct version display).

## Summary
This rework plan addresses six actionable items from the `2026-06-30-standalone-ledger-integration` synthesis: (1) GUI detail page verification for standalone-imported projects — the sole user-visible scope gap; (2) persona-builder library upgrade from 2.4.1 to ≥ 2.6.0 to activate changelog-based frontmatter version derivation; (3) CTX document regeneration; (4) startup tool log correction in `index.ts`; (5) `repositoryName` derivation unification to use `deriveRepoName()`; and (6) `collectKnownSlugs()` error-swallowing fix. Items are sequenced to resolve foundation issues first, then verification, then documentation.

## Architectural Context
The changes span three layers of the ai-insights workspace:

- **MCP Server (`mcp-server/`)**: The `index.ts` startup log at L131 is a hardcoded string listing registered tools — manually maintained per the L78 comment. Three tools (`ledger_list_projects`, `ledger_detect_project`, `ledger_complete_synthesis`) are registered via `projectLifecycleTools.register()` but absent from the log string. The `project-lifecycle.ts` L596 inline `repositoryName` derivation bypasses `deriveRepoName()` from `mcp-server/src/utils/ledger-root.ts`, which applies lowercase normalization and `assertSafeSegment()` validation. The GUI detail page (`mcp-server/gui/public/views/project-detail.js` and sub-modules) currently has zero `runner`-specific rendering — runner badges and labels are only shown in the project list view (`project-list.js`).

- **Personas (`personas/`)**: The `personas/package.json` declares `"@mistralys/persona-builder": "^2.6.0"`, but the installed version is 2.4.1. The library source in the companion `ai-persona-builder` workspace is at v2.5.1 (package.json) with a v2.6.0 changelog entry for the changelog-derived versioning feature, but it hasn't been published. Once published and installed, standalone persona frontmatter will show correct versions derived from each persona's YAML `changelog` field instead of always showing `v1.0.0`.

- **Root scripts (`scripts/`)**: `scripts/import-standalone.js` L110-142 `collectKnownSlugs()` silently swallows `readdirSync` errors in a bare `catch {}` block, risking false "not tracked" results when directory permissions prevent reading.

## Approach / Architecture
Six targeted fixes, each scoped to a single file or small cluster of files. No new abstractions, services, or architectural changes. The approach follows the existing patterns in each layer:

1. **GUI verification** (Step 1): Manually verify detail page rendering for an imported standalone project, adding defensive guards in the rendering helpers only if issues are found. This follows the existing WP-008.md spec.
2. **Persona-builder upgrade** (Step 2): Publish the persona-builder library at v2.6.0, install it in `personas/`, and rebuild all personas to activate changelog-derived version frontmatter.
3. **Startup tool log** (Step 3): Add the three missing tool names to the hardcoded log string in `mcp-server/src/index.ts`.
4. **`repositoryName` derivation** (Step 4): Replace the inline path split/pop at `project-lifecycle.ts` L596 with a call to the existing `deriveRepoName()` utility.
5. **`collectKnownSlugs()` logging** (Step 5): Replace the empty `catch {}` with a `console.warn()` log.
6. **CTX regeneration** (Step 6): Run `node scripts/cli.js ctx-generate` to refresh all `.context/` snapshots.

## Rationale
Each fix addresses a specific synthesis recommendation. No speculative improvements are included. The GUI verification (Step 1) is the only user-visible gap. Steps 3–5 are low-effort correctness fixes that reduce technical debt. The persona-builder upgrade (Step 2) depends on the library being published first — this is the only external dependency. CTX regeneration (Step 6) is a mechanical step deferred to the end since it captures all prior changes.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Runner display in detail page | Verify existing rendering; add guards only if needed | Add runner badge to detail page header proactively | The WP-008 spec is a verification pass, not a feature request; adding badges proactively exceeds scope |
| `repositoryName` fix | Call `deriveRepoName()` | Inline the lowercase + validation logic at the call site | `deriveRepoName()` already exists and is the canonical utility — duplicating its logic would violate DRY |
| Startup log fix | Add missing tools to the hardcoded string | Auto-generate tool list from registered tool modules | Auto-generation would require MCP SDK API changes; the comment at L78 explicitly documents this as manual |

## Pattern Alignment
- **Startup log maintenance** follows the convention documented at `mcp-server/src/index.ts` L78-80: manual sync when tools are added/removed.
- **`deriveRepoName()` usage** follows the pattern established in `mcp-server/src/utils/ledger-root.ts` and used by `LedgerStore` for all storage path construction.
- **`console.warn()` for non-fatal errors** follows the pattern in `scripts/import-standalone.js` where other non-critical errors use `console.warn()` (e.g., L192 for batch mode warnings).
- **CTX regeneration via `node scripts/cli.js ctx-generate`** follows the documented workspace convention in `AGENTS.md` and `context.yaml`.
- No patterns are departed from.

## Detailed Steps

### Step 1 — GUI Detail Page Verification for Imported Standalone Projects
Verify that the project detail page renders correctly for a `runner: 'standalone'` imported project. This implements the original WP-008.md spec that was displaced during the parent project.

1. Open the MCP GUI dashboard and navigate to an imported standalone project's detail page.
2. Verify all six acceptance criteria from `work/WP-008.md`:
   - Plan content is linked and viewable.
   - Synthesis content is linked and viewable via the synthesis link row.
   - WP-001 appears in the work package table with a `COMPLETE` status badge.
   - A single `implementation` pipeline track renders without errors.
   - The timing info section renders without NaN values or layout errors.
   - No JavaScript console errors occur.
3. If any rendering element fails for single-WP/single-stage projects, add minimal defensive guards in `mcp-server/gui/public/views/project-detail.js` or its sub-modules (`project-detail-helpers.js`).
4. Document findings (even if zero code changes are needed) in the pipeline summary.

**Files:** `mcp-server/gui/public/views/project-detail.js`, `mcp-server/gui/public/views/project-detail-helpers.js` (only if fixes needed)

### Step 2 — Persona-Builder Library Upgrade
Upgrade `@mistraljs/persona-builder` from 2.4.1 to ≥ 2.6.0 to activate changelog-based frontmatter version derivation for the standalone suite.

1. In the `ai-persona-builder` workspace, verify the v2.6.0 changelog entry is implemented and all tests pass (`npm test`).
2. Bump `package.json` version to `2.6.0` and publish (`npm version 2.6.0 && npm publish`).
3. In the `ai-insights` workspace, install the new version: `cd personas && npm install @mistraljs/persona-builder@^2.6.0`.
4. Rebuild all personas: `node scripts/build-personas.js`.
5. Verify the standalone developer persona output now shows the correct version derived from its YAML `changelog` field (e.g., `v1.2.0`) instead of `v1.0.0`.
6. Remove the known limitation entry from `personas/docs/agents/project-manifest/constraints.md` (if it was documented there; research shows it is not currently present — verify `constraints-build-system.md` or equivalent).

**Files:** `ai-persona-builder/package.json`, `personas/package.json`, `personas/node_modules/`, all generated persona output files

### Step 3 — Startup Tool Log Correction
Add the three missing tools to the hardcoded startup log string in `mcp-server/src/index.ts`.

1. Add `ledger_list_projects`, `ledger_detect_project`, and `ledger_complete_synthesis` to the log string at L131.
2. Maintain alphabetical grouping consistent with the existing list (lifecycle tools grouped together).
3. Update the count comment if one exists.

**Files:** `mcp-server/src/index.ts`

### Step 4 — Unify `repositoryName` Derivation
Replace the inline path derivation at `mcp-server/src/tools/project-lifecycle.ts` L596 with a call to the existing `deriveRepoName()` utility.

1. Import `deriveRepoName` from `../utils/ledger-root.js` (if not already imported).
2. Replace:
   ```ts
   const repositoryName = projectRoot
     ? (projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? null)
     : null;
   ```
   with:
   ```ts
   const repositoryName = projectRoot
     ? deriveRepoName(projectRoot)
     : null;
   ```
3. Note: `deriveRepoName()` returns `'unknown'` on failure (never `null`), which is an acceptable behavioral change — storing `'unknown'` is better than storing `null` for the `repository_name` meta field.
4. Verify the import path uses the `.js` ESM extension suffix.

**Files:** `mcp-server/src/tools/project-lifecycle.ts`

### Step 5 — `collectKnownSlugs()` Error Logging
Replace the silent error swallowing in `scripts/import-standalone.js` with a warning log.

1. In `collectKnownSlugs()` at L110-142, replace the empty `catch {}` block with:
   ```js
   catch (err) {
     console.warn(`  ⚠ Could not read ${repoDir}: ${err.message}`);
   }
   ```
2. This follows the existing pattern of `console.warn()` with an indented warning prefix used elsewhere in the same script.

**Files:** `scripts/import-standalone.js`

### Step 6 — CTX Document Regeneration
Regenerate all `.context/` documentation snapshots to capture Phase 1+2 changes from the parent project plus all changes from this rework.

1. Run `node scripts/cli.js ctx-generate` from the workspace root.
2. Verify that `.context/personas/standalone-suite.md` now references the standalone-archiver persona dispatch.
3. Verify that `.context/personas/ledger-support-suite.md` includes the `standalone-archiver` persona.
4. Commit the regenerated `.context/` files.

**Files:** All files under `.context/`

## Dependencies
- Step 1 requires an imported standalone project in the GUI (already exists from parent project QA).
- Step 2 depends on the `ai-persona-builder` library being publishable at v2.6.0 (external workspace).
- Step 6 should run last to capture all preceding changes.
- Steps 3, 4, and 5 are independent of each other and can be parallelized.

## Required Components
- `mcp-server/gui/public/views/project-detail.js` — verification target
- `mcp-server/gui/public/views/project-detail-helpers.js` — potential fix target
- `mcp-server/src/index.ts` — startup log string
- `mcp-server/src/tools/project-lifecycle.ts` — `repositoryName` derivation
- `mcp-server/src/utils/ledger-root.ts` — `deriveRepoName()` utility (existing)
- `scripts/import-standalone.js` — `collectKnownSlugs()` function
- `personas/package.json` — dependency version
- `ai-persona-builder/package.json` — library version (external workspace)

## Assumptions
- The `ai-persona-builder` library's v2.6.0 feature (changelog-derived versioning) is complete and tested in the companion workspace.
- An imported standalone project already exists in the GUI for verification (from parent project QA runs).
- The `ctx` binary is available on PATH for CTX regeneration.

## Constraints
- Step 2 requires cross-workspace coordination (publishing the persona-builder library before installing it in ai-insights).
- The startup log (Step 3) is manually maintained — this is a documented constraint, not a design choice to override.
- `deriveRepoName()` returns `'unknown'` instead of `null` — this is an acceptable semantic change for the `repository_name` meta field.

## Out of Scope
- Adding a runner badge to the project detail page header (not in the WP-008 spec).
- Auto-generating the startup tool log from registered modules (would require MCP SDK changes).
- Real-world batch import of 187 historical plans (synthesis Priority 4 — deferred to a future pass).
- `ledger_import_standalone` cwd_path semantic callout in top-level guides (LOW — documented in api-surface.md already).

## Acceptance Criteria
1. The GUI detail page renders correctly for an imported `runner: 'standalone'` project with no JS console errors, no NaN values, and all links functional.
2. The standalone developer persona output shows the correct version derived from its YAML `changelog` field (e.g., `v1.2.0`) instead of `v1.0.0`.
3. The startup log in `mcp-server/src/index.ts` lists all registered tools including `ledger_list_projects`, `ledger_detect_project`, and `ledger_complete_synthesis`.
4. `project-lifecycle.ts` uses `deriveRepoName()` for `repositoryName` derivation, ensuring lowercase normalization and segment validation.
5. `collectKnownSlugs()` logs a warning when a directory read fails instead of silently swallowing the error.
6. `.context/` snapshots are regenerated and include the standalone-archiver persona and developer dispatch changes.

## Testing Strategy
Steps 1 and 2 are verified through manual inspection (GUI rendering) and persona build output comparison. Steps 3–5 are verified through existing test suites (`npm test` in `mcp-server/`) — no new test files are needed since the changes are single-line fixes to existing behaviors. Step 6 is verified by content inspection of the regenerated `.context/` files.

## Test Plan
- **Step 1**: Manual verification against the 6 acceptance criteria from `work/WP-008.md` — AC1
- **Step 2**: Verify persona build output (`personas/standalone/vs-code/developer.agent.md` frontmatter `version` field) — AC2
- **Step 3**: Run `npm test` in `mcp-server/` — no existing tests assert on the startup log string, so verification is by code inspection — AC3
- **Step 4**: Run `npm test` in `mcp-server/` — existing `project-lifecycle` tests cover the `initializeProject` code path; verify `repositoryName` is now lowercase-normalized in test output — AC4
- **Step 5**: Code inspection of the `catch` block in `collectKnownSlugs()` — AC5
- **Step 6**: Grep `.context/personas/standalone-suite.md` for `standalone-archiver` and verify it appears — AC6

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update if `initializeProject` behavior changes materially from the `deriveRepoName()` switch (the return value changes from `null` to `'unknown'` on failure)
- `.context/` — Full regeneration (Step 6)
- `personas/docs/agents/project-manifest/constraints.md` — Remove known limitation for persona-builder version if documented there

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Standalone import real-world batch testing (187 historical plans) | Synthesis Priority 4 | Operational validation, not a code change; better suited as a manual QA pass | Run `node scripts/cli.js import-standalone --batch` against `docs/agents/implementation-history/` after this rework ships |
| 2 | `ledger_import_standalone` cwd_path semantic callout in top-level guide | Synthesis WP-006 code-review | Already documented in `api-surface.md`; low incremental value of duplicating in README | Reconsider when writing a standalone import user guide |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Persona-builder v2.6.0 not ready to publish** | The changelog entry exists and the feature appears implemented in the companion workspace; if tests fail, defer Step 2 and proceed with the other 5 steps |
| **`deriveRepoName()` returning `'unknown'` breaks downstream consumers** | `'unknown'` is the existing fallback in all other call sites of `deriveRepoName()` — consistency is improved, not degraded |
| **GUI detail page has rendering issues for single-WP projects** | The WP-008 spec explicitly allows zero code changes if rendering is correct; defensive guards are added only if issues are found |
| **CTX generator (`ctx`) not on PATH** | Document the prerequisite; if unavailable, skip Step 6 and flag for follow-up |
