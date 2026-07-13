
## Synthesis

### Completion Status
- Date: 2026-07-13
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-13

### Outcome Summary

Implemented the `ledger_update_synthesis` MCP tool — a post-import lifecycle operation for standalone projects that re-reads `synthesis.md`, re-extracts the outcome summary, syncs it to the root index and `.meta.json`, and overwrites the archived copy in storage. The tool is guarded by status, runner, and a 90-day staleness check. The Standalone Archiver persona was updated to describe both import and update workflows.

### Implementation Summary
- Added `ledger_update_synthesis` tool handler in `mcp-server/src/tools/standalone-import.ts` with `MAX_SYNTHESIS_UPDATE_AGE_DAYS = 90` constant and `UpdateSynthesisSchema` Zod schema
- Implemented all 7 guards: path required, naming convention, project exists, status COMPLETE, runner standalone, staleness, synthesis.md present
- Registered the tool in `register()` in `standalone-import.ts` and updated the startup log in `src/index.ts`
- Added detailed help entry and quick-reference table row in `src/tools/help-content.ts`
- Added `updateSynthesis` to `_internal` export for test access
- Added comprehensive test suite in `tests/tools/standalone-import.test.ts` covering all 7 ACs (successful update, 6 guard rejections)
- Updated `personas/ledger-support/src/meta/standalone-archiver.yaml`: added `central_pm/ledger_update_synthesis` to tools, bumped changelog to v1.3.0
- Updated `personas/ledger-support/src/content/standalone-archiver.md`: expanded mission, inputs, MCP tools table, and workflow with update step and error-handling table
- Rebuilt all persona outputs (`vs-code/`, `claude-code/`, `deep-agents/`) via `node scripts/build-personas.js`
- Updated `mcp-server/docs/agents/project-manifest/api-surface.md` with full tool signature and guard documentation

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — added `ledger_update_synthesis` signature, guards, storage semantics, and response shape
- `personas/ledger-support/src/meta/standalone-archiver.yaml` — tool list and changelog updated
- `personas/ledger-support/src/content/standalone-archiver.md` — mission, inputs, MCP tools table, and workflow updated with update capability
- No `file-tree.md` changes needed (no new files added)

### Verification Summary
- Tests run: `mcp-server/tests/tools/standalone-import.test.ts` (25 tests: 17 existing + 8 new)
- Full test suite: all 3311 tests across 114 test files passed
- Static analysis: `tsc` build clean with no errors
- Persona freshness: `node scripts/build-personas.js --check` exits 0
- Result: PASS

### Code Insights
- [low] (improvement) ~~`mcp-server/src/tools/standalone-import.ts`: The pre-lock guard reads the root index and then the lock scope reads it again (TOCTOU safety). A future refactor could unify these if the lock scope can be entered earlier — though the current two-read pattern is sound and consistent with the `completeSynthesis` pattern it mirrors.~~ **DONE** — inline comment added explaining the intentional double-read pattern.
- [low] (convention) ~~`mcp-server/src/tools/standalone-import.ts`: `importStandalone` does not use `withLock` (it delegates entirely to `LedgerStore.importStandaloneProject()` which manages its own lock). The new `updateSynthesis` holds the lock directly following the `completeSynthesis` pattern. Both approaches are correct but the asymmetry is worth noting for future contributors.~~ **DONE** — inline comment added explaining the locking asymmetry.

### Additional Comments
- `MAX_SYNTHESIS_UPDATE_AGE_DAYS = 90` is file-local (not in `constants.ts`) because it is tool-specific policy, as prescribed by the plan.
- The `synthesis_generated_at → date_created` fallback ensures the staleness guard works for projects imported before `synthesis_generated_at` was introduced.
