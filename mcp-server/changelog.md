# Project Ledger MCP Server - Changelog

## v1.3.0 - Workflow Hardening

### Added
- **WP-005:** `rework_count` field on `WorkPackageDetail` — automatically incremented each time a pipeline is restarted after a previous FAIL, providing visibility into rework cycles.
- **WP-005:** `ledger_update_pipeline_progress` tool — appends progress notes to an IN_PROGRESS pipeline's summary without completing it, useful for long-running pipelines.
- **WP-006:** `handoff_notes` parameter on `ledger_complete_pipeline` — agents can pass structured notes to the next agent in the pipeline chain. Notes are stored as `HandoffNote` objects (`from_agent`, `to_agent`, `timestamp`, `notes`) and automatically routed via `NEXT_AGENT_MAP`.
- **WP-006:** `HandoffNote` schema and `handoff_notes` array on `WorkPackageDetail`.
- **WP-006:** `ledger_get_next_actions` (plural) tool — batch version of `ledger_get_next_action` that returns ALL currently actionable work packages for an agent role (up to `max_results`, default 5).
- **WP-006:** `getHandoffNotesForAgent` internal helper — surfaces handoff notes addressed to the requesting agent in `ledger_get_next_action` and `ledger_get_next_actions` responses.

### Changed
- **WP-001:** Corrected `isMostRecentPipelineFail` semantics — REWORK is triggered only when the *most recent* pipeline of a type has FAIL status. A `[FAIL, PASS]` history no longer triggers spurious REWORK recommendations.
- **WP-001:** Improved workflow handoff logic and action type coverage.
- **WP-002:** `ledger_claim_work_package` now validates all dependency WPs are COMPLETE before transitioning to IN_PROGRESS.
- **WP-003:** `ledger_start_pipeline` now enforces pipeline ordering (`implementation → qa → code-review → documentation`). Attempting to start an out-of-order pipeline returns a descriptive error.
- **WP-003:** `ledger_start_pipeline` now auto-updates `assigned_to` on the work package and root index summary via `PIPELINE_AGENT_MAP`.
- **WP-004:** `ledger_update_work_package_status` (COMPLETE transition) now triggers `propagateDependencyUnblock`, automatically transitioning eligible downstream BLOCKED WPs to READY.


- Fixed `ledger_get_handoff_status` to allow agent-specific logic to handle mixed WP states (BLOCKED + COMPLETE)
- The early BLOCKED check now only triggers when ALL WPs are blocked with no COMPLETE work
- Documentation agent can now properly route to Developer when some WPs are COMPLETE and others are BLOCKED
- Resolves confusion where Documentation would receive "BLOCKED" status instead of "READY_FOR_DEVELOPER"

## v1.2.2 - Reviewer Dependency-Aware Handoff
- Fixed deadlock scenario where Reviewer would hand to Developer when remaining work packages were blocked by dependencies
- Reviewer now checks if unimplemented WPs are actually ready or blocked before deciding handoff
- When all remaining WPs are blocked, Reviewer correctly hands to Documentation to complete current WPs first
- Added test coverage for blocked dependency handoff scenarios

## v1.2.1 - Handoff Logic Fix
- The QA agent will no longer hand off to the reviewer when there are open DEV packages.

## v1.2.0 - Property Handling
- Tools now allow additional properties to be more flexible when weaker models send unneeded metadata. 

## v1.1.0 - Help Tool
- New `ledger_help` tool to help some models along that can get confused using the ledger.
- All tools now have more helpful descriptions.

## v1.0.1 - Version Information
- MCP server now logs its version at startup in STDERR output.
- Added a script that extracts the version from `changelog.md` and updates `package.json` automatically.
- Fixed `ledger_get_handoff_status` to only report `BLOCKED` status when *all* work packages are blocked. 

## v1.0.0 - Initial Release
- Release with the first 13 tools.
