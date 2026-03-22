# Project Ledger MCP Server - Changelog

## v1.16.0 - Project Runner Metadata & GUI Filtering
- Utils: Added `classifyRunner()` in `src/utils/runner.ts` — normalises raw MCP `clientInfo.name` into a stable `RunnerType` enum (`vscode` | `claude-code` | `orchestrator` | `unknown`) using case-insensitive substring matching with a fixed priority order.
- Schema: Added optional `runner`, `runner_client`, and `runner_version` fields to `ProjectMetaSchema` and `RootIndexSchema`; all fields optional for full backward compatibility with existing projects.
- Lifecycle: `initializeProject` now calls `classifyRunner(getClientInfo())` and persists runner metadata (`runner`, `runner_client`, `runner_version`) to both `project-ledger.json` and `.meta.json` at project creation time.
- Server: Exported `getClientInfo()` accessor from `src/index.ts` -- exposes the connected MCP client identity (`{ name, version }`) to tool handlers without threading per-request context.
- Compatibility: Runner fields default to `{ runner: "unknown" }` when the client does not identify itself; existing projects without runner fields load without errors.
- Tests: Added `tests/utils/runner.test.ts` (10 unit tests for `classifyRunner`), `tests/schema/project-meta-runner.test.ts` (10 backward-compatibility schema tests), and `tests/tools/runner-integration.test.ts` (9 integration tests verifying end-to-end runner capture in `initializeProject`).
- API: Extended `GET /api/projects` response with a `runner` field per project (normalized to `'unknown'` for projects without a stored runner) and a `runner_counts` object (keyed by runner value, computed from the search-filtered set before any status or runner filter is applied — mirrors `status_counts` semantics).
- API: Added `runner` query parameter to `GET /api/projects` for server-side filtering; unrecognized runner values return an empty set without a 500 error; added `'runner'` to `ProjectSortField` and `SORT_FIELDS` for sortable runner column support.
- GUI: Added runner filter dropdown to the project list with live counts drawn from `runner_counts`; runner selection is localStorage-persisted (`mcp-runner-filter` key) and survives page reload.
- GUI: Added sortable `Runner` column to the project table; runner badges rendered via `runnerBadge()` with XSS-safe `escapeHtml` on both the class suffix and label text; `badge-runner-{type}` CSS classes added to `styles.css` for runner-specific badge colors (light and dark variants).
- Tests: Added 7 GUI API unit tests in `tests/gui/api.test.ts` covering all 5 WP-003 acceptance criteria: `runner` field presence and `'unknown'` default, `runner_counts` object shape and values, `runner=orchestrator` filtering, `runner_counts` unaffected by the active runner filter, and unrecognized runner values returning an empty set without a 500 error.
- Fix: `buildRunnerOptions()` in `project-list.js` now builds dropdown options dynamically from the `runner_counts` API response rather than hardcoding all 4 runner types unconditionally — previously zero-count runners would appear in the dropdown even when no matching projects existed; fixed to include only runners with `count > 0`.
- Fix: `runnerBadge()` in `project-list.js` now emits the correct CSS class `badge-runner badge-runner-unknown` for null/unknown runners — previously emitted `badge-unknown` (no matching CSS rule), leaving unknown runner badges unstyled; all 5 runner badge variants now render with consistent `badge-runner-{type}` classes.
- GUI: `buildRunnerOptions()` preserves stale localStorage runner selections (runner values absent from `runner_counts`) as a zero-count dropdown entry so users can see and clear a stale filter without the value silently disappearing.
- Tests: Added `handleListProjects` runner filter suite in `tests/gui/api.test.ts` (6 tests, WP-005): `runner` field present and `'unknown'` default for projects without a stored runner (AC1), `runner_counts` object shape and values (AC1), `runner=orchestrator` filter returns only matching projects (AC2), `runner_counts` computed from full unfiltered set and unaffected by the active runner filter (AC3), `runner: 'unknown'` filter returns projects with no stored runner field (AC4), unrecognized runner query returns empty set without 500 error (AC5), and combined `status + runner` filter.
- Tests: Verified `tests/utils/runner.test.ts` (10 unit tests) covers all four `classifyRunner` output variants plus edge cases: `undefined` input (no throw), empty-string name, unrecognized client name, case-insensitive substring matching, raw `runner_client`/`runner_version` value preservation.
- Tests: Verified `tests/tools/runner-integration.test.ts` (9 integration tests) covers all four runner types via mocked `getClientInfo()`, runner fields written to both root index and `.meta.json` (AC1/AC2), graceful `'unknown'` default when `getClientInfo()` returns `undefined` (AC3), and no runner info written to stdout (AC5).
- Tests: Verified `tests/schema/project-meta-runner.test.ts` (10 backward-compatibility tests) confirms `ProjectMetaSchema` and `RootIndexSchema` accept optional runner fields when present, parse cleanly without them, reject invalid enum values, and parse a full real-world legacy `project-ledger.json` fixture that predates runner fields.

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
