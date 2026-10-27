# Project Ledger MCP Server - Changelog

## v2.11.0 - Outcome Summaries and Stricter Chain Validation

**A work package whose verifier stage cannot be fixed now fails at creation, not at run time.**
Agents can also supply the project outcome summary themselves, and artifact-declaration
warnings now follow each pipeline type's policy.

- Tools: Work package creation rejects chains where a verifier has no stage able to fix it.
- Tools: Standalone import and synthesis refresh accept an agent-supplied outcome summary.
- Tools: Artifact-declaration warnings now follow each pipeline type's policy.
- Tools: Reviewer, Release Engineer and Documentation may declare an empty modified-files list.
- Tools: Unmatched acceptance-criteria updates now surface in the result and leave an audit comment.
- Tools: Synthesis refresh no longer clears a stored summary it cannot replace.
- Tools: Outcome summaries are found under level-2 and level-3 headings anywhere in synthesis.md.
- Tools: Agent registry looks for agents in the shared persona deploy folder.
- GUI: Obsolete persona model assignments show a banner with an option to remove them.
- GUI: Saving persona model assignments now names every unknown persona.
- Docs: Tool help, manifest and workflow specification describe the new rules.

## v2.10.1 - Synthesis Updates for Every Runner

`ledger_update_synthesis` no longer requires the `standalone` runner — any COMPLETE project
tracked by the ledger (standalone, claude-code, or orchestrator) can now have its outcome
summary and archived synthesis.md refreshed after synthesis.md is edited post-archival. The
90-day staleness guard and all other guards are unchanged, and the update path still never
writes the project's `runner` field.

- Tools: Removed the standalone-only runner guard from `ledger_update_synthesis`.
- Docs: Updated the tool description and help text to describe the runner-agnostic behavior.
- Docs: `ledger_update_synthesis` parameter descriptions no longer call the target a standalone plan folder — these are the hints an agent sees at call time. `ledger_import_standalone`'s own descriptions still say standalone, which remains correct.
- Tests: Replaced the runner-rejection test with coverage proving a non-standalone project
  updates successfully and its `runner` value is left untouched.

## v2.10.0 - Active Duration Tracking & Numeric Input Tolerance

Project duration now reflects actual active work instead of wall-clock time, and several
tool and GUI inputs are more forgiving of string-encoded numbers, fixing failures some
clients hit when passing numeric values as strings.

- Tools: Numeric parameters like confidence, limit, and offset now accept string-encoded values.
- Tools: Confidence values are now validated to stay within the 0–1 range.
- GUI: Duration displays now show active work time instead of wall-clock, moved to a tooltip.
- GUI: Editing a knowledge entry now accepts a string-encoded confidence value.
- Scripts: `backfill-duration` now also backfills active time and pipeline run counts.
- Docs: Updated tool help and the manifest with the newly accepted input formats.

## v2.9.0 - Curated Project Titles

**Projects can now carry an agent-curated display title, replacing slug-derived title-casing
with a human-readable name curated by the agent that creates or imports the project.**

- Tools: Added a `title` parameter to project init and import tools for curated display names.
- Schema: Title and summary fields now trim surrounding whitespace before validation.
- GUI: Fixed the Model Registry save button becoming unresponsive.
- Tests: Expanded lifecycle and standalone-import coverage for the new title field.

## v2.8.0 - Multi-Store Ledger and Observation Routing

**This release introduces the multi-store storage layer, allowing users to register multiple
ledger roots for cross-device sync via the new Stores GUI tab.** Knowledge insight IDs are
migrated from integers to UUID v4. Observations can now include a `loc` field pointing to the
affected file or module, enabling the insight channel consolidation in ledger personas.

- Storage: Added multi-store layer with store router, registry, manager, and cross-store
  undeclared repo scanning.
- Storage: Centralized project-directory discovery shared across all tools and scripts.
- GUI: Added Stores CRUD tab with hot-reload backend for managing store configurations.
- GUI: Multi-store API handlers for repositories and knowledge operations.
- GUI: Sortable repository list, project filter, breadcrumb navigation, and modal dialogs.
- GUI: Fixed Windows path handling in project resolution.
- Schema: Added `duration_ms` to project metadata; auto-computed on synthesis and import.
- Knowledge: Migrated insight IDs from integers to UUID v4; fixed multi-store pagination.
- Tools: Added `ledger_ping` health-check tool.
- Tools: Added `title` and `description` fields to work packages.
- Tools: Added optional `loc` parameter to `ledger_add_observation` for file/module context.
- Tools: Added `insight_pipeline_type` to the observation routing model.
- Tools: Removed `work_package_file`; sorted repositories in list responses.
- Tools: Fixed release engineering PASS routing stalling on multi-stage pipelines.
- Tools: Standalone imports optionally archive `usage-scenarios.md`.
- Tools: `ledger_get_next_action` now includes `plan_path` in every JSON response.
- Scripts: Added `backfill-duration` command for populating duration on existing projects.
- Tests: Added coverage for multi-store, duration, knowledge pagination, import flows,
  and `loc` field persistence on observations.

## v2.6.0 - Project Summary Field and Structured Dialogues

**This release adds `project_summary` to lifecycle tools, displaying it as a synopsis on the
project detail page.** The dialogue chunk renderer gains structured format support, enabling
richer output in work-package panel views.

- GUI: Extended chunk renderer with structured format support for improved dialogue output.
- GUI: Project detail page shows a synopsis from `project_summary` when set.
- GUI: Updated styles and dialogue views to support the new rendering modes.
- Tools: Added `project_summary` parameter to project init and import tools.
- Schema: Added `project_summary` to project metadata and root index schemas.
- Tests: Added coverage for structured format routing, dialogue rendering, and project summary.

## v2.5.0 - Synthesis Update Tool and Dialogue Renderer
- Tools: Added `ledger_update_synthesis` to refresh archived synthesis after post-import edits.
- Tools: Guarded by status check, runner check, and 90-day staleness window.
- GUI: Introduced `renderChunksToDialogue()` for chat-style WP chunk panel rendering.
- GUI: Extracted chunk-accumulation logic into standalone `chunk-accumulator.ts` module.
- GUI: Fixed tool call list not rendering in the orchestrator run log view.
- Dependencies: Updated packages to resolve security warnings.

## v2.4.1 - Insight Search
- Tools: Added multi-term support to searching insights.

## v2.4.0 - Standalone Import and Project Dialogues
- Tools: Added `ledger_import_standalone` to import standalone plan folders into the ledger.
- Tools: Added synthesis log parser for extracting structured data from standalone run logs.
- GUI: Added standalone runner display on the project list view.
- GUI: Fixed silent failure in the Kill button for active orchestrator runs.
- GUI: Removed noisy ENOENT messages when scanning projects without metadata folders.
- GUI: Added Project Dialogues section to the project detail view for PM and Synthesis transcripts.
- GUI: Added admin delete button for queued orchestrator runs.
- GUI: Suppressed terminal window when launching orchestrator processes on Windows.
- GUI: Adjusted badge colors to differentiate standalone runner from completed project state.
- Tests: Added test coverage for standalone import, synthesis parser, and utility modules.
- Tests: Added Project Dialogues API and view test suites.
- GUI: Preflight now displays the resolved project path.
- Core: Fixed a Windows-specific LangGraph-induced path issue breaking paths with drive letters.
- Core: Fixed path mixups between the project and AI Insights.
- Core: Removed project path fallback when it cannot be auto-detected.
- Docs: Updated project manifest for standalone import feature.

---

Older versions are archived in [../docs/changelog-history/mcp-server](../docs/changelog-history/mcp-server).
Most recent archive: [v2.3](../docs/changelog-history/mcp-server/v2/v2.3.md).
