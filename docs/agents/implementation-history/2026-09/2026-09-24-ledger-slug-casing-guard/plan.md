# Plan

## Summary

A just-completed ledger project whose plan-folder name contained an uppercase segment (`2026-09-22-MS01-coma-config-model-decomposition`) could be listed in the AI Insights GUI but never opened, failing with "Failed to load project: Invalid repo or slug parameter." The cause was a validation gap: the GUI's `assertSafeSlug()` enforces the lowercase-only `SAFE_SLUG_REGEX` on every `/api/projects/:repo/:slug` route, while `planFolderBasename()` in `mcp-server/src/utils/path-validator.ts` only ever checked the `{YYYY-MM-DD}-` date prefix, so an uppercase folder name passed project creation and import unnoticed and only broke later at GUI-open time. This work repaired the affected project on disk and closed the gap at its source by adding a `validateSlugSafety()` guard to the two ledger project-creation entry points, so a non-conforming slug is now rejected up front with an actionable message instead of producing an unopenable project.

## Scope

- Repaired the broken project on disk: renamed its ledger-storage folder in the `hcp-editor` store to the all-lowercase form and corrected the matching `slug` field inside its `.meta.json` (the GUI builds project-list links from `.meta.json`, not the live directory name).
- Added a new exported `validateSlugSafety(folderName)` to `mcp-server/src/utils/path-validator.ts` — a non-throwing check against the same `SAFE_SLUG_REGEX` / `assertSafeSegment()` rule the GUI enforces, returning an actionable error including a suggested lowercase form.
- Wired the guard into the two project-creation entry points only: `initializeProject()` in `mcp-server/src/tools/project-lifecycle.ts` and `importStandalone()` in `mcp-server/src/tools/standalone-import.ts`, each calling it immediately after deriving the slug and before any ledger write.
- Updated the `project_path` / `cwd_path` Zod `.describe()` strings on `InitializeProjectSchema` and `ImportStandaloneSchema` so the all-lowercase requirement is visible in the tools' own parameter docs.
- Added regression coverage in `mcp-server/tests/utils/path-validator.test.ts`, `mcp-server/tests/tools/project-lifecycle.test.ts`, and `mcp-server/tests/tools/standalone-import.test.ts`, reproducing the exact `MS01`-style folder name and asserting rejection with no ledger directory created.
- Updated `mcp-server/docs/agents/project-manifest/constraints.md` (new "Slug casing validation" paragraph) and `mcp-server/docs/agents/project-manifest/api-surface.md` (new `validateSlugSafety()` export entry).
- Verified the change: `npx tsc --noEmit` clean, full `npx vitest run` suite green (146 test files / 4165 tests, no regressions), and `mcp-server/dist/` rebuilt so the guard is live in the compiled output the running MCP server uses.

## Out of Scope

- Adding the casing check inside `planFolderBasename()` itself, or at any read/update call site (`getProjectStatus`, `updateSynthesis`, pipeline and work-package tools). Those construct `LedgerStore` from pre-existing on-disk projects that may predate this rule, and tightening them would risk breaking reads of legitimate legacy projects.
- Changes to persona source files (Planner, PM, or any other persona that names plan folders upstream). The code-level guard was judged the reliable backstop regardless of which persona produces the name.
- Changelog entry or version bump — release-engineering territory, not requested here.
- `.context/` regeneration.
