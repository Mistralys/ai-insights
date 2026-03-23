# Project Ledger MCP Server - Changelog

## v1.18.4 - Dialogues Card in WP Detail View
- GUI Frontend: Added Dialogues card to the Work Package detail view (`views/work-package.js`). The card is rendered asynchronously after the Handoff Notes section via a `#wp-dialogues-section` placeholder injected synchronously into `app.innerHTML`.
- GUI Frontend: Dialogues are fetched via `API.getDialogues(slug, wpId)` and grouped by stage name. Each stage shows pill buttons for every revision (`stage-r0`, `stage-r1`, …) with the latest revision highlighted (`.dialogue-btn-latest`).
- GUI Frontend: Clicking a revision button fetches the Markdown via `API.getDialogueContent()` and renders it inline with `marked.parse()`. Clicking a second button collapses the first; clicking the same button again toggles it off.
- GUI Frontend: Fetch errors (both list and content) render as inline `.text-danger` messages without crashing the surrounding WP view.
- API Client: Added `API.getDialogues(slug, wpId)` → `GET /api/projects/:slug/dialogues?wp={wpId}`, returns parsed JSON.
- API Client: Added `API.getDialogueContent(slug, filename)` → `GET /api/projects/:slug/dialogues/:filename`, returns raw Markdown text via `res.text()` (uses direct `fetch()`, not the `request()` helper, which calls `res.json()`).
- Styles: Added `.dialogue-stage`, `.dialogue-stage-label`, `.dialogue-btn`, `.dialogue-btn-latest`, `.dialogue-btn-active`, `.dialogue-content`, `.dialogue-markdown`, and `.text-danger` CSS classes to `styles.css`, with dark-mode overrides.
- Tests: Added 22 new jsdom tests in `tests/gui/dialogue-qa.test.ts` covering all 10 acceptance criteria and 3 edge cases. Full suite: 1665 tests passing, 0 regressions.

## v1.18.3 - Dialogue File API Endpoints
- API: Added `GET /api/projects/:slug/dialogues` — returns a sorted array of `.md` filenames from the project's `dialogues/` directory; supports optional `?wp=WP-001` prefix filter; returns `[]` when the directory is absent.
- API: Added `GET /api/projects/:slug/dialogues/:filename` — returns the raw Markdown content of a single dialogue file.
- Security: `handleGetDialogueFile` enforces a dual-layer path-traversal defence: (1) `DIALOGUE_FILENAME_RE` allowlist (`/^[A-Za-z0-9_-]+\.md$/`) applied after `decodeURIComponent()`; (2) `path.resolve()` prefix check as a second containment layer. Both layers return `NOT_FOUND` on violation.
- Tests: Added 11 new tests in `tests/gui/api.test.ts` covering absent directory, sorted listing, WP prefix filter, slug traversal rejection, file content serving, filename traversal rejections, missing file, and underscore filenames. All 110 api.test.ts tests pass.

## v1.18.2 - Dialogue Capture GUI Toggle
- GUI: Added "Capture agent dialogues" checkbox to the Settings page (`/#/config`), inserted between Max handoff depth and Auto-archive after (days).
- GUI: Checkbox is pre-populated from `config.capture_dialogues` on load and included as `capture_dialogues` in the `API.updateConfig()` payload on submit.
- GUI: Form note explains that the setting takes effect on the next orchestrator run.
- All existing settings form fields (auto-handoff, max-depth, auto-archive-days, ledger-root) are unchanged.

## v1.18.1 - Dialogue Capture Config
- Config: Added `capture_dialogues: boolean` (default `false`) to `GuiConfigSchema` and `DEFAULT_CONFIG`.
- Config: `GuiConfigPartialSchema` inherits `capture_dialogues` automatically — a PUT body with only `{ capture_dialogues: true }` is accepted by `writeConfig()`.
- Constants: Exported `DIALOGUES_DIR = 'dialogues' as const` from `src/utils/constants.ts` to keep the dialogues subdirectory name in sync with the Python orchestrator's `write_dialogue()`.
- Tests: Added 6 new tests in `config.test.ts` covering default value, read-back with field absent/present, round-trip (true and false), and partial body preservation.

## v1.18.0 - Deadlock Fix & Artifact Restrictions
- Workflow: Fixed a deadlock when all work packages are blocked.
- Pipeline: Artifacts now required only for edit pipelines.
- Docs: Updated workflow specification for deadlock edge case.
- Tests: Added deadlock, begin-work, and pipeline-map tests.

## v1.17.0 - Run Log Viewer & GUI Progress
- GUI: Added orchestrator run log viewer with auto-refresh.
- GUI: Project detail shows run history and timing metrics.
- GUI: Work package detail shows pipeline duration badges.
- Backend: Added log resolver with path-traversal protection.
- Tests: Added run log, log resolver, and API client test suites.

## v1.16.0 - Runner Metadata & Pipeline Duration
- Lifecycle: Projects now capture runner identity at creation time.
- Schema: Added runner and duration fields to project and pipeline schemas.
- GUI: Added runner filter and sortable runner column to project list.
- GUI: Added pipeline and project duration display.
- API: Extended project list with runner filtering and counts.
- Tests: Added runner classification, schema, and integration test suites.

## v1.15.0 - Version Tracking & Freshness Guard
- Lifecycle: Project init now rejects stale server instances.
- Schema: Added `server_version` to the root index.
- GUI: Project detail now displays server and spec versions.
- Fix: Fixed a startup error in the server entry point.
- Tests: Added version freshness guard test suite.

## v1.14.1 - Improved Error Messages
- Ledger: Improved error messages when no project ledger exists.

## v1.14.0 - Shared Workflow Manifest
- Shared: Added `workflow-manifest.json` as single source of truth for roles, pipeline types, and statuses.
- Schema: Added Zod manifest schema for startup validation; `AgentRole` type now inferred via enum.
- Utils: Role and status constants now derived from the shared manifest at module load.
- Utils: Added `ROLE_IDS` role-to-ID map; deprecated `hasDependencyBlocked` alias.
- Pipeline: Fail-agent resolution now fully manifest-derived.
- Workflow: Added `getSecurityAuditorHandoff()` and `getReleaseEngineerHandoff()` dispatch handlers.
- Workflow: Refactored handoff dispatch to a typed record keyed by `AgentRole`.
- Tests: Added drift-detection suite for workflow manifest schema invariants.

## v1.13.0 - Spec v2.4 & Atomic Writes
- Schema: Added `synthesis_generated_at`, `ledger_version`, `active_pipeline_stages` to root-index.
- Storage: Added `createWorkPackageWithSync` and `batchUpdateWorkPackagesWithSync` sync methods.
- Storage: Consolidated all WP write paths through sync methods; primitives marked `@internal`.
- Pipeline: Added `firstActiveStage`, `lastActiveStage`, and `validateActiveStages` helpers.
- Pipeline: Added advisory dependency staleness check on PASS completion.
- Workflow: Tracked `synthesis_generated_at` across all reset and synthesis-completion paths.
- Workflow: Populated `active_pipeline_stages` on work package summary entries.
- Workflow: Added `SPEC_VERSION` constant; stamps `ledger_version` on project initialization.
- Workflow: Added self-healing for legacy ledgers with forward-compatibility warning.
- Tests: Added 83 new tests for schema, storage, pipeline, and workflow lifecycle modules.

## v1.12.0 - Work Package Pipeline Visualization
- API: Added work-package overview endpoint with per-stage pipeline status, rework counts, and blocked-by details.
- GUI: Replaced the WP table Title column with colored pipeline stage badges showing status and agent names.
- GUI: Added pipeline progression bar to the WP detail view.
- Tests: Added test suite for the new overview endpoint.

## v1.11.3 - Dynamic Pipeline & Agent Annotation Helpers
- Utils: Added `describePipelineTypes()` and `describePipelineAgents()` helpers.
- Utils: Pipeline-type and agent-role annotations now derive dynamically from canonical constants instead of hardcoded strings.
- Tools: Updated all pipeline-type and agent-role annotation strings to use the new dynamic helpers.
- Tests: Added drift-detection tests for both new helpers.
- Docs: Updated API surface and constraints documentation.

## v1.11.2 - GUI Archive Fix
- GUI: Fixed the "Archive" row action displaying the alert twice.

## v1.11.1 - GUI Fix
- GUI: Fixed archiving projects changing their last updated time.
- GUI: Removed the grayed-out styling of archived projects.

## v1.11.0 - GUI Improvements
- GUI: Replaced per-row action buttons with a kebab-menu.
- Backend: Added endpoint to mark all active work packages and the project index as COMPLETE.
- GUI: Refactored front-end code into focused modules.
- GUI: Added interactive, keyboard-accessible column sorting.
- GUI: Fixed search input losing spaces after a sort click.
- GUI: Fixed string column sort to be locale-deterministic.
- GUI: Corrected dark-mode contrast ratios.
- GUI: Added work package count column.

## v1.10.0 - Dark Mode Dashboard
- GUI: Added dark mode with toggle button (🌙 / ☀️) in the nav header.
- MCP: Improved project detection accuracy.

## v1.9.2 - Independent Title / Slug Rename
- GUI: Added slug and title renaming.
- GUI: Added the repository folder column.
- Tools: Fixed invisible arguments confusing agents.
- Tools: Clarified project path argument documentation.
- Tests: Added regression guard for missing tool docs.

## v1.9.0 - VS Code Persona IDs
- MCP: More lenient parameters for the complete pipeline tool.
- Personas: Added unique `id` field to all ledger and standalone persona definitions.
- Registry: Extended agent discovery to cache and resolve agents by ID alongside handles.
- Workflow: Updated handoff logic to propagate stable agent IDs in auto-handoff payloads.
- Build: Updated persona build and sync scripts to validate the new `id` field.
- Tests: Added coverage for ID-based agent resolution and handoff payload structure.

## v1.8.1 - begin_work Handoff Guard Fix & Micro-Debt Cleanup
- Workflow: Fixed cross-agent handoffs failing when agents used `ledger_begin_work`.
- Workflow: Optimized project manager action checks.

## v1.8.0 - Phase 4: Recommendation Engine Rewrite
- Recommendations: Rewrote all action recommendations for consistency and coverage.
- Recommendations: Adjusted priority orderings for Developer and Documentation roles.
- Recommendations: Added new action types spanning all agent roles.
- Workflow: Separated re-engagement from first-run action paths for QA and Reviewer.
- Workflow: Added temporal guard preventing duplicate rework cycles for Developers.
- Workflow: Improved freshness checks for finalized documentation packages.

## v1.7.0 - Schema Foundations & GUI Enhancements
- GUI: Added total and pending work package counters to project list.
- GUI: Improved table visualization with progress bars and project names.
- GUI: Introduced text search filtering for the project list.
- Schema: Allowed initial package revisions to start at zero.
- Schema: Added support for tracking unassigned work packages.
- Schema: Expanded work package IDs to support four digits and beyond.
- Workflow: Added tracking for auto-cancelled pipelines and status timestamps.
- Storage: Added backward-compatible rework metrics tracking.

## v1.6.0 - Workflow Specification Audit Fixes
- Handoff: Handled cancelled pipelines as terminal statuses.
- Workflow: Prevented infinite waits when batch items are exclusively in terminal states.
- Security: Enforced strict authorization for overriding work package claims.
- Concurrency: Applied file locks to prevent race conditions during synthesis completion.
- Docs: Updated specification constraints, gotchas, and flow documentation.

## v1.5.1 - Constraint Numbering Cleanup
- Docs: Renumbered constraints to a clean sequential scheme.

## v1.5.0 - Centralized Ledger Storage
- Storage: Centralized ledger files mapped by project slug instead of current directory.
- Tools: Added `ledger_list_projects` to discover initialized workspaces.
- CLI: Added `--ledger-dir` flag to specify global storage location.
- Project: Automated project metadata creation and synchronization.

## v1.4.3 - Strategic Recommendations
- Code: Resolved potential untyped array access errors.

## v1.4.2 - Gold Nuggets Housekeeping
- Code: Applied minor refactoring and consistency updates.

## v1.4.1 - Synthesis Next Steps
- Personas: Enforced role definitions across all agents with validation warnings.
- Server: Prevented silent failures by properly surfacing internal handoff errors.

## v1.4.0 - Automatic Handoffs
- Personas: Added specific role tags to all agent definitions.
- Server: Automatically detected system environment to locate agent prompts.
- Workflow: Introduced depth-limited automatic agent handoffs between phases.
- Tools: Updated handoff status tool to surface the next responsible agent.

## v1.3.2 - Micro Debt Followup
- Code: Unified pipeline routing types and enhanced timezone safety.

## v1.3.1 - Technical Debt Remediation
- Code: Extracted reusable helpers for detecting stale or reworked pipelines.
- Code: Standardized timestamps to ISO 8601 preserving backwards compatibility.

## v1.3.0 - Workflow Hardening
- Schema: Added tracking for rework counts and structured handoff notes.
- Tools: Included handoff notes automatically in pipeline completion tools.
- Tools: Added tool for retrieving multiple next actions simultaneously.
- Workflow: Limited rework triggers exclusively to the most recent failure.
- Workflow: Required dependencies to be fully complete before allowing claim overrides.
- Workflow: Propagated unblock states sequentially to downstream work packages.

## v1.2.2 - Reviewer Dependency-Aware Handoff
- Workflow: Rerouted Reviewer handoffs to Documentation when remaining items are blocked.

## v1.2.1 - Handoff Logic Fix
- Workflow: Stopped QA from handing off to Reviewer when Developer packages remain open.

## v1.2.0 - Property Handling
- Tools: Tolerated unneeded metadata gracefully to support weaker models.

## v1.1.0 - Help Tool
- Tools: Added `ledger_help` tool and refined descriptions across all tools.

## v1.0.1 - Version Information
- Server: Surfaced version information in startup logs.
- Workflow: Required all active work packages to be blocked to reach blocked status.

## v1.0.0 - Initial Release
- Server: Initial release providing 13 foundational project management tools.
