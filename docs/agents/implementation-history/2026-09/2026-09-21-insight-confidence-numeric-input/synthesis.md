
## Synthesis

### Completion Status
- Date: 2026-09-21
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-09-21

### Outcome Summary

The MCP server's numeric tool inputs now tolerate string-encoded values (e.g. `"0.9"`) instead of hard-rejecting them, and `confidence` finally enforces its documented `[0, 1]` range at the tool boundary rather than only deep inside the storage layer. The fix centres on a small set of field-level Zod helpers in `schema/common.ts` — `confidenceInput()`, `positiveIntInput()`, `nonNegativeIntInput()`, `numberInput()` — deliberately built on `z.preprocess()` rather than `z.coerce.number()` so that `null`, booleans, and `""` keep failing loudly instead of silently becoming `0` (a value `confidence` treats as an insight-retirement marker). The helpers were applied at every numeric tool-input call site the research brief identified, the GUI write path was aligned to match, and `ledger_help` plus the manifest now document both the accepted input forms and the new shared-helper convention.

### Implementation Summary
- Added `numericInput()` and four named constructors to `mcp-server/src/schema/common.ts`, each documented against the `z.coerce` hazard and the field-level-only restriction.
- Applied the helpers to `confidence` (both knowledge write tools, now range-enforced), `limit`/`offset` (search/list), `max_results`, `max_projects` (preserving its `.optional().default(5)` ordering), and the three `ledger_complete_pipeline` metrics counters.
- Aligned `mcp-server/gui/api-knowledge.ts`'s `KnowledgeUpdateBodySchema.confidence` to the same helper, so both write paths into the stored field now validate identically.
- Updated `ledger_help` content for both knowledge write tools with the decimal-range wording, string-encoding acceptance, and a worked 0.8 → 0.9 recalibration example.
- Closed a pre-existing gap in `tests/tools/schema-integrity.test.ts`: `repository-context.ts` was never registered with the harness, so `ledger_get_repository_context` had no path into the regression guard at all; it is now registered and included, and the stale tool-count comments were corrected.
- `InsightSchema` and the other storage schemas were left untouched by design — they validate persisted data, not agent-supplied arguments, and a string-encoded number there should keep failing as data corruption.

### Documentation Updates
- `mcp-server/docs/agents/project-manifest/api-surface.md` — signature comments for `confidence`, `limit`, `offset`, `max_results`, `max_projects`, and the pipeline `metrics` tool input now state the accepted forms; the separate storage-schema `Metrics` interface further down the same file was annotated with a clarifying note instead, since it documents the persisted shape rather than the tool boundary.
- `mcp-server/docs/agents/project-manifest/constraints-code-style.md` — added a new "Numeric Tool Inputs Use the Shared Coercing Helpers" section (rule, pattern, rationale, storage-schema exemption, field-level-only restriction, regression guard), added it to the Contents list, and extended the existing outer-tool-schema exception to name `.preprocess()`.
- `mcp-server/changelog.md` and root `changelog.md` — new entries following house style, with the root entry referencing the module version.
- `.context/` — regenerated via `node scripts/cli.js build-maintain`, which also synced `mcp-server/package.json` and root `package.json` against their changelogs.

### Verification Summary
- Tests run: `npx vitest run` (full `mcp-server` suite, including every new/modified spec file), targeted runs of each touched test file during development.
- Static analysis run: `npx tsc --noEmit` (no dedicated linter is configured for this project); `npm run build` to confirm a clean compile.
- Result: PASS — all suites green, no regressions, no new tsc diagnostics. All fifteen acceptance criteria (AC-01 through AC-15) are demonstrated by a corresponding test.

### Code Insights

#### Implementation Decisions
- [medium] (decision) `mcp-server/tests/tools/knowledge.test.ts`: Argument validation happens at the MCP SDK boundary, not inside the handler body, so tests calling the internal handlers directly with already-typed args never exercise the `confidenceInput()` preprocess or the `[0,1]` range check. New tests parse the exported Zod schema first (as the SDK would) and only then invoke the handler, so the schema-level behavior is what's actually under test — this pattern was then reused across the workflow-next-action, repository-context, and pipeline test additions.
- [low] (decision) `mcp-server/src/schema/common.ts`: Let TypeScript infer the helper functions' return types rather than hand-annotating `z.ZodEffects<T>`, since `z.preprocess()` actually returns `ZodEffects<T, T['_output'], unknown>` and the explicit annotation required an unsafe cast.
- [low] (decision) `mcp-server/src/tools/workflow-next-action.ts`: Added `GetNextActionSchema` to the file's `_internal` export — it was the one tool file omitting its schema from `_internal`, unlike `knowledge.ts`, `repository-context.ts`, and `pipeline.ts` — so the string-tolerance behavior could be tested the same way as elsewhere.
- [low] (decision) `mcp-server/docs/agents/project-manifest/api-surface.md`: Documented the tool-boundary tolerance note only on the `ledger_complete_pipeline` tool-input signature, not on the separate storage-schema `Metrics` interface later in the same file — the latter documents the persisted shape, which stays strict by design.
- [low] (decision) `mcp-server/changelog.md`, root `changelog.md`: Bumped both to a minor version (not patch) since the change adds new exported public helpers and a new accepted-input surface across seven call sites, not just a bug fix.
- [low] (decision) `mcp-server/tests/schema/common.test.ts`, `mcp-server/tests/tools/schema-integrity.test.ts`: Closed the pre-existing `repository-context.ts` registration gap in the schema-integrity harness before adding new field-type assertions, since `max_projects` had no regression coverage at all until that gap closed.

#### Follow-Up Items
- [medium] (improvement) MCP SDK tool-registration layer (`src/index.ts` / `server.registerTool()` call sites): Zod schema-validation failures at the SDK boundary — including the new rejections this change adds — bypass every tool handler's own `try`/`catch` and reach the caller as a raw Zod error string rather than a curated `isError` payload. This was confirmed while tracing the validation path for this plan and is explicitly out of scope here (see the plan's own Structural Improvements table), but a server-wide wrapper that reformats SDK-level `ZodError`s into the handlers' existing `isError` shape would give agents a consistent, actionable error surface for every tool — worth its own plan.

### Additional Comments
- The plan's research brief was thorough and pre-verified; every file reference, line range, and behavioral claim it made matched the current code exactly, so no assumption in it had to be corrected during implementation.
- `mcp-server/tests/tools/pipeline.test.ts`, `workflow-next-action.test.ts`, and `repository-context.test.ts` are large files; new tests were inserted adjacent to the most closely related existing test (e.g. the batch-mode / lenient-input describe blocks) to keep the additions discoverable rather than appended in an unrelated location.
