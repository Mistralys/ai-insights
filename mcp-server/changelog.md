# Project Ledger MCP Server - Changelog

## v1.3.2 - Micro Debt Followup (2026-02-18)

### Changed
- **WP-001:** Derived `AGENT_PIPELINE_MAP` from `PIPELINE_AGENT_MAP` via `Object.fromEntries`; removes manual duplicate
- **WP-001:** Introduced `PipelineType` string union type; all four pipeline maps now have compile-time exhaustiveness checking
- **WP-002:** Added UTC-trap inline comment to `now()` in `timestamp.ts`
- **WP-003:** Hoisted `agentNameMap`, `actionNameMap`, `reworkActionMap` to module-level in `workflow.ts`
- **WP-003:** Relocated `_internal` export in `workflow.ts` to after imports, matching `pipeline.ts` convention
- **WP-004:** Added inline source comment above registration block in `index.ts` noting manual tool-list sync requirement
- **WP-006:** Updated `api-surface.md` to document the new `PipelineType` export

## v1.3.1 - Technical Debt Remediation

### Changed
- **WP-001:** Extracted shared pipeline routing constants (`PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`, `AGENT_PIPELINE_MAP`) into `src/utils/pipeline-maps.ts`. Both `pipeline.ts` and `workflow.ts` now import from this single source of truth — no local duplicate definitions remain.
- **WP-002:** `now()` in `src/utils/timestamp.ts` now returns ISO 8601 T-separator format (`YYYY-MM-DDTHH:MM:SS`) instead of legacy space-separated format. Added `parseTimestamp()` helper that normalises both old and new formats via `.replace(' ', 'T')` before parsing — ensures backward compatibility with existing ledger data. `isStalePipeline` and all `ageHours` calculations now use `parseTimestamp()` exclusively.
- **WP-004:** Added `extractStalePipelineAction()` and `extractReworkAction()` private helpers to `workflow.ts`, eliminating the duplicated stale-pipeline detection and rework-response logic that existed separately in all four `get*Action` functions. Both helpers return `ToolActionResponse | null` and are exported via `_internal` for unit-testability.
- **WP-005:** Added a `DESIGN NOTE` inline comment above the `propagateDependencyUnblock` call in `updateWorkPackageStatus` (`work-package.ts`) explaining the two-lock sequential pattern, its safety via idempotency, and why holding the first lock during the cascade is deliberately avoided.
- **WP-006 (batch):**
  - Added cross-reference comments between `hasDependencyBlocked` and `isBlockedByDependencies` clarifying their different input granularity.
  - Replaced `Math.max(...existingNumbers)` spread in `createWorkPackage` with `reduce`-based max, preventing `RangeError` on large WP lists.
  - Added 4 gap-resilience tests to `wp-id.test.ts` (empty list, contiguous IDs, gap scenario, single-item list).
  - Added `NOTE` comment on `getDeveloperHandoff` explaining why `isMostRecentPipelineFail` is intentionally not used (conservative FAIL detection).
  - Replaced all `[...arr].reverse().find()` / `.map().reverse().find()` patterns in `pipeline.ts` with `.filter().at(-1)` (ES2022-compatible alternative to `.findLast()`).
  - Added priority-explanation comment on the `continue` statement in the stale-pipeline check inside `getNextActions`.
  - Added maintenance comment to `index.ts` tool registration block noting that the listing requires manual sync when new tools are added.

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
