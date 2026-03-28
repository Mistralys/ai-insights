# Orchestrator Changelog

## v0.12.0 - Stage Prompt Templating
- PromptRenderer: Added Markdown template engine with partial includes, conditionals, and variable substitution.
- Nodes: Migrated all eight stage prompts from inline Python to Markdown templates.
- Nodes: Simplified stage prompts — stripped WP details and scope restrictions; project path is the only runtime variable.
- Nodes: Removed `build_stage_prompt()` helper; template renderer replaces it.
- Supervisor: Clears `current_wp_id` when routing to synthesis.
- Deps: Bumped `langchain-core` minimum from `0.3.45` to `1.2.22`.
- Tests: Added prompt renderer and supervisor test suites.

## v0.11.0 - Tool-Call Activity Logging
- ToolWrappers: Added `log_tool_calls()` — emits a `tool_call` JSONL event per MCP tool call.
- ToolWrappers: Events capture stage, tool name, and WP ID; argument payloads excluded for privacy.
- Logging: Added `tool_call` console rendering with stage, tool name, and WP ID.
- Nodes: All stage nodes now emit real-time tool-call events via `log_tool_calls()`.
- Docs: Documented `tool_call` event type in the JSONL log schema.
- Tests: +46 unit tests; 572 passing.

## v0.10.0 - Resilience Overhaul
- Nodes: Stage crash triggers pipeline rollback and emits a `pipeline_rollback` event.
- Nodes: `restrict_to_wp()` auto-injects missing `work_package_id` instead of passing through silently.
- Nodes: Stage prompts include a CRITICAL WP ID scope reminder.
- Supervisor: Auto-cancels circuit-broken WPs (≥3 failures) before routing to synthesis.
- CLI: Terminal marker prevents re-execution of completed runs via `--resume`.
- CLI: UUID collision guard regenerates thread ID on checkpoint DB conflicts.
- Tests: +31 new tests; 526 passing.

## v0.9.7 - WP Guard & CLI Resilience
- ToolWrappers: Added `restrict_to_wp()` — rejects tool calls targeting a different work package.
- ToolWrappers: `inject_project_path()` strips `cwd_path` to avoid mutual-exclusivity errors.
- ToolWrappers: Fixed tool call argument handling errors.
- Nodes: Stage node factory applies `restrict_to_wp()` after `inject_project_path()`.
- Nodes: Extracted shared `build_stage_prompt()` helper; all eight node builders now use it.
- CLI: Fixed stale lock file left behind after a crashed or interrupted run.
- CLI: Suppressed asyncio deprecation warning.
- Supervisor: Removed noisy warning messages emitted during normal operation.
- Tests: Expanded tool-wrapper and node test suites.

## v0.9.6 - Slim Orchestrator Node Prompts
- Nodes: Removed redundant identity, workflow steps, and tool guidance from all eight node prompts.
- Nodes: Each `_build_*_prompt()` now includes only runtime context the persona cannot know.
- Tests: Updated assertions to reflect slim prompt format.

## v0.9.5 - Defaults & Heartbeat
- Config: `capture_dialogues` default changed from `False` to `True`.
- Config: Added `heartbeat_interval_s` setting (default 120 s).
- Logging: Added heartbeat emitter — sends periodic alive signals during quiet periods.
- Supervisor: Added `dry_run` mode for stub-based runs without a ledger.
- Dialogues: Folder relocated to `{slug}/orchestrator/dialogues/`.
- CLI: Run log archival now targets `{slug}/orchestrator/logs/`.

## v0.9.4 - Run Log Archival to Ledger Storage
- CLI: Run logs moved into the project's ledger storage folder on completion.
- Docs: Updated architecture and log-schema docs to reflect the new log location.

## v0.9.3 - Dialogue Capture Integration
- Nodes: Agent dialogue exchanges serialised to Markdown and saved to ledger storage per stage.
- Nodes: Emits a `dialogue_captured` JSONL event after each successful capture.
- Logging: Added `dialogue_captured` console-line rendering.
- Docs: Updated JSONL log schema with `file_path` field and `dialogue_captured` event.
- Tests: +9 tests; 455 passing.

## v0.9.2 - Dialogue Writer Utility
- Utils: Added dialogue writer — serialises LangChain message sequences to Markdown.
- Tests: 39 tests covering all message types, revision numbering, and filesystem isolation.
- Docs: Documented `CAPTURE_DIALOGUES` env var and dialogue writer public API.

## v0.9.1 - Dialogue Capture Flag
- Config: Added `capture_dialogues: bool` field to `Config` dataclass (default `False`).
- Config: `CAPTURE_DIALOGUES` env var enables dialogue capture when set to `true`, `1`, or `yes` (case-insensitive).
- Docs: Added `CAPTURE_DIALOGUES` to the environment variable reference and `.env.example`.

## v0.9.0 - Tool Wrapper Fix
- Fix: Fixed tool wrapper input argument handling.
- Tests: Added tool wrapper test suite.

## v0.8.1 - Dev Dependency Hygiene
- Fix: Added missing dev dependency for async tests.
- Docs: Simplified test setup instructions.

## v0.8.0 - Supervisor Progress & Status Events
- Supervisor: Emits progress snapshots and WP status change events.
- Supervisor: Emits rework detection and enriched route entries.
- Tests: Added progress, status change, and rework event tests.
- Docs: Updated JSONL log schema and architecture docs.

## v0.7.0 - Stage Lifecycle Events & Pipeline Read-back
- Nodes: Emits stage start/complete events with duration tracking.
- Nodes: Added pipeline result read-back after stage completion.
- Utils: Extracted shared MCP response parser.
- Tests: Added stage lifecycle and pipeline result test suites.

## v0.6.0 - Windows Cross-Platform Fix
- Fix: Replaced `import fcntl` with a cross-platform `filelock` module; orchestrator now starts on Windows.
- Core: Added stdlib-only `filelock` module with platform-specific locking for Unix and Windows.
- Tests: Added 3 platform-agnostic file-lock unit tests.
- Docs: Created project manifest documentation.

## v0.5.0 - Checkpoint Support & Stability
- Core: Added checkpoint support for resumable runs.
- CLI: Added concurrency guard to prevent parallel runs against the same plan.
- CLI: Improved PM phase feedback.
- Fix: Fixed sqlite imports.
- Fix: Fixed a runtime bug in tool wrappers.
- Fix: Fixed async runtime errors in graph builder and checkpointer.
- Tests: Added tool wrapper tests.

## v0.4.0 - Manifest-Driven Configuration
- Config: Pipeline routing constants now derived from `shared/workflow-manifest.json` at startup.
- Supervisor: Updated routing to align with manifest-defined role and pipeline definitions.
- Tests: Added config test suite covering manifest-derived constants.
- Tests: Expanded supervisor routing test coverage.
- Docs: Added CTX Generator module context file.

## v0.3.0 - Nine-Stage Pipeline Support
- Nodes: Added stub implementations for the security auditor and release engineer stages.
- Config: Extended pipeline routing to include `security-audit` and `release-engineering` stages.
- Docs: Updated README and architecture documentation to reflect the expanded 9-stage pipeline.

## v0.2.1 - Documentation Structure
- Docs: Updated and split READMEs for clarity.

## v0.2.0 - Ledger Delegation Architecture (Breaking-S)
- Architecture: Delegated all logic execution to the ledger system.
- Scripts: Replaced the primary execution script.

### Breaking Changes
This release moves all execution responsibility to the ledger. Previous local execution patterns are superseded.

## v0.1.1 - Logic Cycle Stabilization
- Logic: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial implementation of the LangGraph-based pipeline.
- Core: Completed post-development rework and stabilization.
- Config: Updated `.env.example`.
