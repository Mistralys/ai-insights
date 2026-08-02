
## Synthesis

### Completion Status
- Date: 2026-08-02
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-08-02

### Outcome Summary

All nine deferred/out-of-scope items from the `2026-08-01-wp-title-description` parent project were implemented in a single session. The schema hardening, test improvements, CSS decoupling, title truncation UX, documentation audit, and trust boundary documentation are all live. All 3970 existing tests continue to pass with zero TypeScript errors.

### Implementation Summary

- **Schema hardening (Step 1):** Added `.min(1)` to `title` in `CreateWorkPackageSchema` — empty-string titles are now rejected at the Zod validation layer alongside missing titles.
- **Test improvement (Step 3):** Renamed the existing "rejects missing title via Zod validation" test to "rejects missing title (schema replica)" and updated the `MinimalCreateSchema` replica to include `.min(1)` on `title`. Added a companion test "rejects empty-string title (schema replica)" that asserts `title: ''` fails the same schema.
- **CSS decoupling (Step 4):** Added `.rendered-markdown` utility class to `styles.css` immediately after `.dialogue-markdown` with identical rules, establishing a clean separation between dialogue-specific and general markdown rendering.
- **Class swap (Step 5):** Switched the WP description card in `work-package.js` from `.dialogue-markdown` to `.rendered-markdown`. The dialogue content renderer at L292 retains `.dialogue-markdown`.
- **Title truncation (Step 6):** Added `max-width: 260px`, `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` to `.wp-title-label`. Added `title="..."` attribute to the WP title `<div>` in `project-detail.js` for native browser tooltip.
- **Doc audit — WorkPackageSummary (Step 7):** Added `passed_stages?: number` to the `WorkPackageSummary` interface in `api-surface.md`, matching the live `WorkPackageSummarySchema`.
- **Doc audit — RootIndex (Step 8):** Added `server_version`, `runner`, `runner_client`, and `runner_version` fields to the `RootIndex` interface in `api-surface.md`, matching the live `RootIndexSchema`.
- **Gotcha 10b update (Step 2):** Replaced the "Empty-string note" paragraph (which warned the guard was absent) with an "Empty-string rejection" paragraph documenting the new enforcement.
- **Gotcha 14 — trust boundary (Step 9):** Added a new Gotcha 14 entry in `constraints.md` documenting the `marked.parse()` trust model and the condition under which sanitization must be added.
- **ui-components.md (AC-16):** Added `.rendered-markdown` to the Utility Classes table in Section 14.
- **CTX snapshots (Step 10):** Regenerated `.context/` after all documentation edits.

### Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Updated Gotcha 10b blockquote; added Gotcha 14 (marked.parse trust boundary).
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Added `passed_stages` to `WorkPackageSummary`; added 4 runner/version fields to `RootIndex`.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Added `.rendered-markdown` to Section 14 Utility Classes table.
- `.context/` — Regenerated via `node scripts/cli.js ctx-generate`.

### Verification Summary
- Tests run: `npm test` (mcp-server) — 3970 tests across 140 test files
- Static analysis run: `tsc --noEmit` (mcp-server)
- Result: PASS — 3970/3970 tests green, 0 TypeScript errors

### Code Insights
- [low] (convention) `mcp-server/gui/public/styles.css`: `.rendered-markdown` and `.dialogue-markdown` now share identical rules with no shared selector. If this pattern repeats for a third render context, introducing a shared base selector (e.g., `.md-content`) and per-context overrides would avoid further duplication. No action needed at current scale.
- [low] (debt) `mcp-server/docs/agents/project-manifest/api-surface.md`: The pre-existing `ledger_version` comment said "Semantic version string of the MCP server that last wrote this ledger" — identical wording to the newly added `server_version`. Investigation confirmed they are distinct: `ledger_version` = `SPEC_VERSION` (workflow spec version from `shared/workflow-manifest.json`), `server_version` = `SERVER_VERSION` (MCP server package version). The `ledger_version` comment was corrected as part of this plan.

### Additional Comments
- The plan's note "Gotcha N" for the new trust boundary entry resolved to Gotcha 14 (last numbered entry before this plan was Gotcha 13).
- AC-14 (ctx-generate) was executed last, after all other steps were complete.
