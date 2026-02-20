# Project Ledger MCP Server - Changelog

## v1.4.1 - Synthesis Next Steps (2026-02-20)

### Added
- **WP-002:** New module `src/utils/constants.ts` — canonical single source of truth for `AGENT_ROLES` (the seven-item `as const` array of valid agent role names) and the derived `AgentRole` string-literal type. Both `workflow.ts` and `agent-registry.ts` now import from this module; their local `AGENT_ROLES` / `KNOWN_AGENT_ROLES` duplicates have been removed.
- **WP-007:** `discoverAgents()` in `src/utils/agent-registry.ts` gains an optional `strict?: boolean` second parameter (default `false`, non-breaking). When `true`, an unknown `role:` value causes `discoverAgents()` to throw `RangeError: [discoverAgents] Unknown role "<role>" in <filePath>` instead of the default warn-and-continue behaviour. Additionally, when two `.agent.md` files share the same `role:` value, a `process.stderr.write()` warning is now emitted naming both files before the last-wins assignment. 7 new unit tests added to `tests/utils/agent-registry.test.ts`; `src/index.ts` unchanged.
- **WP-005:** `sync-personas.js` — `validateLedgerFrontmatter()` extended to cross-validate the `role:` value against a `KNOWN_ROLES` constant (mirrors the seven role names in `AGENT_ROLES`). When `role:` is present but not in `KNOWN_ROLES`, a `console.warn` names the file path and the unrecognised value. Exit code remains `0`; warnings are advisory only. `KNOWN_ROLES` is hardcoded inline with a comment to keep it in sync with `src/utils/constants.ts`.
- **WP-006:** `docs/agents/project-manifest/data-flows.md` — new **Flow 13: Auto-Handoff Depth Counter Lifecycle** section documenting the `auto_handoff_depth` field: where the counter lives (root index), when it increments (`buildHandoffResponse`, gated by `depth < MAX_HANDOFF_DEPTH = 10`), when it resets (project reaches COMPLETE), and what happens when the limit is reached (auto-handoff suppressed; manual routing fallback; no error).

### Fixed
- **WP-001:** Replaced two silent `catch {}` blocks in `buildHandoffResponse` (`src/tools/workflow.ts`) with `catch (err)` blocks that call `process.stderr.write()`, emitting a structured `[buildHandoffResponse] storage error: <err>` message. Previously, storage failures during auto-handoff depth updates and COMPLETE resets were silently swallowed with no trace. Follows the stderr convention established in `agent-registry.ts`.
- **WP-003:** Resolved three TS7053 (implicit-any element access) errors in `getNextActions` (`src/tools/workflow.ts`). The maps `agentNameMap`, `actionNameMap`, and `reworkActionMap` are typed as `Record<PostImplPipelineType, string>` but were indexed with a `string`-typed variable (`pipelineType`). Fixed by adding `pipelineType as PostImplPipelineType` at each of the three index sites (lines 1717, 1719, and 1731). `PostImplPipelineType` was already in scope via import — no new types or files introduced. Zero logic changes; zero test regressions.
- **WP-004:** `validatePlanPath` in `src/utils/path-validator.ts` now normalises backslash separators (`\`) to forward slashes before calling `basename()`. Fixes a pre-existing test failure on macOS/Linux where Node's `path.basename` does not split on backslashes, causing Windows-style paths (e.g. `f:\\Webserver\\...\\2026-02-16-cleanup`) to fail the date-prefix format check. The raw path is still passed to filesystem calls since all platforms accept forward slashes.

## v1.4.0 - Automatic Handoffs (2026-02-20)

### Added
- **WP-001:** `role:` field added to YAML frontmatter of all 7 `personas/ledger/*.agent.md` files. Value matches the corresponding `AGENT_ROLES` constant in `workflow.ts` (e.g. `Developer`, `QA`). Required by the agent registry for runtime role-to-handle mapping.
- **WP-002:** New module `src/utils/agent-registry.ts` — scans a directory of `*.agent.md` files at startup, parses YAML frontmatter for `name:` and `role:` fields, and builds an in-memory `AGENT_HANDLE_MAP` (role → VS Code agent handle). Exports `discoverAgents()`, `getAgentHandle()`, `isRegistryLoaded()`, and `resetRegistry()`.
- **WP-003:** `--agents-dir <path>` CLI parameter accepted by `src/index.ts`. If omitted, the server auto-detects the VS Code User prompts folder for the current platform (macOS / Linux / Windows). If the directory is missing or contains no `*.agent.md` files, a warning is logged and auto-handoff is silently disabled.
- **WP-004:** `auto_handoff_depth` field (integer, default `0`) added to the root index ledger schema. Incremented server-side on every `auto_handoff` emission; checked against `MAX_HANDOFF_DEPTH = 10` before each auto-handoff is allowed to fire. Reaching COMPLETE resets the counter to `0`. No agent cooperation required.
- **WP-005:** `ledger_get_handoff_status` now returns an optional `auto_handoff` object `{ agent_name, prompt }` when the next agent is resolvable from the registry and the depth limit has not been reached. `buildHandoffResponse()` in `workflow.ts` manages the depth increment/check atomically. When `auto_handoff` is absent, agents fall back to the existing manual handoff block.
- **WP-006:** Auto-handoff instruction paragraph added to personas 2–7 (`Project Manager` through `Synthesis`). Each persona now checks for `auto_handoff` in the `ledger_get_handoff_status` response and calls `runSubagent` if present, otherwise emits the standard `CURRENT AGENT / NEXT AGENT / STATUS` block for manual routing. The `Planner → Project Manager` transition remains manual by design (no ledger exists yet).
- **WP-007:** `tests/utils/agent-registry.test.ts` — unit tests for the agent registry covering discovery, role lookup, error paths, and `resetRegistry` semantics.
- **WP-008:** `tests/tools/workflow-handoff.test.ts` — unit tests for the auto-handoff block in `buildHandoffResponse` / `getHandoffStatus`, covering depth increment, depth limit enforcement, COMPLETE reset, and graceful degradation when the registry is unloaded.
- **WP-009:** `tests/integration/auto-handoff.test.ts` — 23 integration tests (5 suites) exercising the full auto-handoff chain end-to-end against a real `LedgerStore` and a mock agents directory in a temp folder:
  - **Full chain** (6 tests): PM → Developer → QA → Reviewer → Documentation → Synthesis; `auto_handoff` verified at each step; `auto_handoff_depth` increments 0 → 5.
  - **Chain termination** (3 tests): Synthesis returns COMPLETE with no `auto_handoff`; depth resets to 0 from any starting value.
  - **Depth limit enforcement** (4 tests): `auto_handoff` omitted once `MAX_HANDOFF_DEPTH` is reached; standard handoff block still present; counter not incremented beyond the limit; boundary crossing verified (MAX−1 eligible, MAX not eligible).
  - **Rework cycle** (3 tests): QA FAIL → Developer rework → QA PASS with correct depth tracking through the rework loop.
  - **Graceful degradation** (7 tests): All 5 agent paths omit `auto_handoff` when the registry is unloaded; standard handoff block always present; depth counter unchanged.
- **WP-010:** `sync-personas.js` now validates `role:` field presence in persona frontmatter during sync, warning when a `*.agent.md` file in the `ledger/` personas set is missing the field.

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
