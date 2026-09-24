
## Synthesis

### Completion Status
- Date: 2026-09-24
- Status: COMPLETE
- Completed by: Web GUI Specialist Agent
- Research brief: none found
- Archived in Ledger: 2026-09-24

### Outcome Summary

Diagnosed and repaired a GUI-unopenable project caused by an uppercase segment in its ledger-storage slug, then closed the validation gap at its creation-time source so the same class of project can no longer be produced. The fix is a backend/tooling change (ledger MCP server) triggered by, and directly protecting the correctness of, the GUI's project-detail routes — no browser-rendered surface was added or altered in this pass.

### Interface Implementation Summary
- No new or changed UI components, views, or interaction flows — this work targeted the ledger MCP server's project-creation validation layer (`mcp-server/src/utils/path-validator.ts`, `mcp-server/src/tools/project-lifecycle.ts`, `mcp-server/src/tools/standalone-import.ts`), not `gui/`.
- The GUI's own `assertSafeSlug()` / `SAFE_SLUG_REGEX` route guard (`gui/server.ts`, `src/utils/constants.ts`) was read and traced as the authority the new guard mirrors, but was not modified — it was already correct; the gap was that nothing enforced the same rule upstream, at the point a slug is created.
- Repaired the specific broken project (`hcp-editor` store, `2026-09-22-MS01-coma-config-model-decomposition`): renamed its ledger-storage folder to the all-lowercase form and corrected the matching `slug` field in its `.meta.json`, since the GUI's project-list links are built from that cached field rather than the live directory name.
- Added `validateSlugSafety()` to `path-validator.ts` and wired it into the two project-creation entry points (`initializeProject()`, `importStandalone()`) only, so a non-conforming slug is rejected with an actionable, lowercase-suggesting error before any ledger write occurs — never at read/update call sites, to avoid breaking legitimate pre-existing legacy projects.
- Updated the `project_path`/`cwd_path` Zod `.describe()` strings on both tool schemas so the lowercase requirement is visible to any agent calling these tools directly, ahead of a rejection.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/constraints.md` — added a "Slug casing validation" paragraph documenting the gap, the fix, and the explicit exclusion of read/update call sites from the guard.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — added the `validateSlugSafety()` export entry to the `path-validator.ts` listing, matching the file's existing documentation style.
- `gui/docs/agents/project-manifest/` was not touched — no GUI-owned behavior changed.

### Verification Summary
- Browser checks: not applicable — no UI surface was implemented or modified in this pass. The originally reported GUI symptom ("Failed to load project: Invalid repo or slug parameter.") was resolved by the on-disk repair in the prior session and was confirmed resolved by the user before this backfill/archival request.
- Accessibility and responsive audit: not applicable — no UI code touched.
- Tests run: full `mcp-server` Vitest suite (`npx vitest run`) — 146 test files / 4165 tests, all passing, no regressions. New regression coverage added and passing: `tests/utils/path-validator.test.ts` (`validateSlugSafety` describe block), `tests/tools/project-lifecycle.test.ts` (uppercase-slug rejection at `initializeProject()`), `tests/tools/standalone-import.test.ts` (uppercase-slug rejection at `importStandalone()`, added to the existing validation-errors block).
- Static analysis run: `npx tsc --noEmit -p .` — clean, no errors introduced.
- Additional verification: `mcp-server/dist/` rebuilt via `npm run build` and spot-checked (`grep validateSlugSafety dist/...`) to confirm the guard is present in the compiled output the running MCP server process actually loads — the fix is live, not just committed to source.
- Result: PASS. All verification green; no known regressions.

### Interface Insights

No `insights.jsonl` sink was opened for this session — incremental capture per the Web GUI Specialist Operational Protocol did not run. This is an honest gap, not a "clean" result: the work was carried out as direct backend/tooling troubleshooting across two conversational turns (GUI error diagnosis → root-cause prevention) rather than as a plan-driven Implement loop with per-surface capture gates, and none of the implement-and-capture loop's UI "surfaces" apply here since no UI code was touched. No observations are being back-filled from memory to avoid fabricating sink provenance.

Two implementation decisions worth recording for a future reader, stated here directly since no sink exists to source them from:

#### Implementation Decisions
- [high] (decision) `mcp-server/src/utils/path-validator.ts` / `project-lifecycle.ts` / `standalone-import.ts`: Scoped the new `validateSlugSafety()` guard to the two project-*creation* entry points only (`initializeProject()`, `importStandalone()`), explicitly excluding `planFolderBasename()` itself and all read/update call sites (`getProjectStatus`, `updateSynthesis`, pipeline/work-package tools). Reason: those call sites construct `LedgerStore` from potentially pre-existing on-disk projects whose slugs may predate this rule (as MS01's did before manual repair) — tightening validation there would turn a creation-time safety net into a landmine that breaks reads of legitimate legacy projects the next time any tool touches them.
- [medium] (decision) Did not modify any persona source file (e.g. Planner/PM instructions that name plan folders upstream) as part of the prevention fix. Reason: the code-level guard at the MCP tool boundary is the reliable backstop regardless of which persona or human names a folder — persona-level guidance can drift or be skipped, but a rejected tool call cannot.

### Additional Comments
- This plan folder was created via **Ad-Hoc Entry**-style backfill (dispatched to the Planner agent) specifically for ledger traceability of already-completed work; the Planner's `plan.md` reflects completed scope in retrospective framing rather than forward-looking direction.
- If the "MS01"/"MS02"-style milestone naming convention is expected to recur across future plan folders, consider a lightweight persona-side reminder (e.g. in whichever persona authors the initial plan-folder name) to use lowercase from the outset — the code guard will catch a violation, but catching it earlier avoids the rejected round-trip entirely. This is a suggestion, not something implemented here.
