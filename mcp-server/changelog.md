# Project Ledger MCP Server - Changelog

## v1.9.1 - Zod Refine Empty Schema Fix
- Tools: Fixed invisible arguments confusing agents.
- Tools: Moved `project_path`/`cwd_path` mutual exclusivity enforcement from Zod schema to runtime validation.
- Tests: Added regression guard for missing tool docs.

## v1.9.0 - VS Code Persona IDs
- MCP: More lenient parameters for the complete pipeline tool.
- Personas: Added unique \id\ field to all ledger and standalone persona definitions.
- Registry: Extended agent discovery to cache and resolve agents by ID alongside handles.
- Workflow: Updated handoff logic to propagate stable agent IDs in auto-handoff payloads.
- Build: Updated persona build and sync scripts to validate the new \id\ field.
- Tests: Added coverage for ID-based agent resolution and handoff payload structure.

## v1.8.1 - begin_work Handoff Guard Fix & Micro-Debt Cleanup
- Workflow: Fixed cross-agent handoffs failing when agents used `ledger_begin_work`.
- Workflow: Eliminated redundant disk reads during project manager action checks.

## v1.8.0 - Phase 4: Recommendation Engine Rewrite
- Recommendations: Rewrote all action recommendations to comply with spec §14.1–§14.5.
- Recommendations: Adjusted priority orderings for Developer and Documentation roles.
- Recommendations: Added 13 new action types spanning all agent roles.
- Workflow: Separated re-engagement from first-run action paths for QA and Reviewer.
- Workflow: Added temporal guard preventing duplicate rework cycles for Developers.
- Workflow: Improved freshness checks for finalized documentation packages.

## v1.7.0 - Schema Foundations & GUI Enhancements
- Gui: Added total and pending work package counters to project list.
- Gui: Improved table visualization with progress bars and project names.
- Gui: Introduced text search filtering for the project list.
- Schema: Allowed initial package revisions to start at zero.
- Schema: Added support for tracking unassigned work packages.
- Schema: Expanded work package IDs to support four digits and beyond.
- Workflow: Added tracking for auto-cancelled pipelines and status timestamps.
- Storage: Introduced dual-field backward compatibility for rework metrics.

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
