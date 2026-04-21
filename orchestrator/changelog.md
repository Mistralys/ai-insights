# Orchestrator Changelog

## v0.18.0 - Direct Pipeline Stage Routing
- Supervisor: Added `ROUTE_PIPELINE_AGENT` to dispatch actions.
- Supervisor: PM stage routes directly to the target pipeline agent using `next_agent`,
  eliminating a supervisor round-trip on stage transitions.
- Tests: Added supervisor routing tests for `ROUTE_PIPELINE_AGENT`.

## v0.17.0 - Metadata-Driven Subagent Loading
- Utils: Subagent specs now derived from persona YAML metadata at startup.
- Utils: Added stage-to-persona YAML resolver shared by subagent and model loaders.
- Utils: Added YAML list parser for subagent field extraction.
- Config: Removed static subagent file mapping.
- Error Handling: Suppressed verbose traces during API key issues.
- Tests: Rewrote subagent tests with fixtures; added 16 persona-model helper tests.
- Docs: Updated architecture guide, public API, and manifest for metadata-driven approach.

## v0.16.0 - Streaming Retry with Backoff
- Nodes: Automatic retry with exponential backoff when streaming hits overloaded,
  rate-limit, 5xx, or network errors.
- Nodes: Fixed exception-chain cycle guard in fatal error detection.
- Config: Added `STREAM_MAX_RETRIES` and `STREAM_RETRY_BASE_DELAY_S` env-var controls.
- ChunkWriter: Added `delete()` to discard partial chunk files between retries.
- Logs: Added `stage_retry` JSONL event emitted per retry with attempt count and delay.
- Docs: Updated JSONL log schema with `stage_retry` entry and revised event ordering.
- Tests: Added stream retry and error classification tests.

## v0.15.0 - Streaming Capture & Signal Handling
- Nodes: Real-time chunk capture via `ChunkWriter` during `astream()`.
- CLI: Graceful shutdown on SIGTERM/SIGINT with `signal_shutdown` event.
- CLI: Cross-platform signal handler (Unix event-loop, Windows fallback).
- Config: Fixed incorrect agent name in stage configuration.
- Tests: Added streaming capture, chunk writer, and revision tests.
- Docs: Updated project manifest, public API, and README.

## v0.14.0 - Streaming Dialogue Capture
- Utils: Added chunk writer for raw stream capture to JSONL files.
- ChunkWriter: Versioned headers, immediate-flush writes, revision numbering.
- Tests: +42 new tests (825 total, 0 failures).
- Docs: Updated public API and README.

## v0.13.0 - Deep-Agents Persona Files & Subagent Wiring
- Config: Persona files now derived from workflow manifest deep-agents paths.
- Config: Added per-stage subagent file path mapping.
- Utils: Added subagent loader with per-stage caching.
- Nodes: PM stage passes loaded subagents to the deep agent creator.
- Tests: +19 net new tests (783 total, 0 failures).

## v0.12.0 - Per-Stage Model Configuration
- Config: Replaced global model setting with per-stage persona-driven selection.
- Config: Startup validation ensures all 9 roles have a resolved model.
- Config: API key values now trimmed of whitespace.
- Utils: Added persona model slug extraction from YAML metadata.
- Nodes: Resolved model logged in stage lifecycle events.
- CLI: Removed `--model` flag (superseded by persona metadata).
- Tests: +25 net new tests (770 total, 0 failures).

## v0.11.1 - Fatal Error Handling
- CLI: Fixed fatal exceptions not halting the iteration loop.
- Nodes: Removed noisy cross-WP guard exception traces from logs.

## v0.11.0 - Template Engine, Cross-WP Guards & Windows Support
- Nodes: Stage prompts migrated to Markdown template engine with partials.
- Nodes: Post-completion guard prevents cross-WP escape after pipeline ends.
- Nodes: Error-path dialogue capture preserves partial transcripts on crash.
- Nodes: Agent nodes now inherit the machine environment.
- ToolWrappers: Added real-time tool-call event logging.
- ToolWrappers: Cross-WP writes soft-fail twice then hard-kill; reads exempt.
- Utils: Added Windows subprocess-encoding support.
- Supervisor: Clears active WP when routing to synthesis.
- Fix: Resolved langchain type compatibility and aiosql handling issues.

## v0.10.0 - Resilience Overhaul
- Nodes: Stage crash triggers pipeline rollback with a JSONL event.
- Nodes: Missing work package ID now auto-injected on tool calls.
- Nodes: Stage prompts include a critical WP ID scope reminder.
- Supervisor: Auto-cancels circuit-broken WPs before routing to synthesis.
- CLI: Terminal marker prevents re-execution of completed runs.
- CLI: UUID collision guard on checkpoint DB conflicts.
- Tests: +31 new tests; 526 passing.

## v0.9.7 - WP Guard & CLI Resilience
- ToolWrappers: Added cross-WP tool call rejection guard.
- ToolWrappers: Fixed path injection mutual-exclusivity error.
- ToolWrappers: Fixed tool call argument handling errors.
- Nodes: Consolidated stage prompt construction across all node builders.
- CLI: Fixed stale lock file left behind after crashes.
- CLI: Suppressed asyncio deprecation warning.
- Supervisor: Removed noisy warnings during normal operation.
- Tests: Expanded tool-wrapper and node test suites.

## v0.9.6 - Slim Orchestrator Node Prompts
- Nodes: Removed redundant identity and workflow guidance from prompts.
- Nodes: Prompts now include only runtime context the persona cannot know.
- Tests: Updated assertions for slim prompt format.

## v0.9.5 - Defaults & Heartbeat
- Config: Dialogue capture now enabled by default.
- Config: Added heartbeat interval setting (default 120 s).
- Logging: Added heartbeat emitter for periodic alive signals.
- Supervisor: Added dry-run mode for stub-based runs.
- Dialogues: Folder relocated to project storage directory.
- CLI: Run log archival now targets project storage directory.

## v0.9.4 - Run Log Archival to Ledger Storage
- CLI: Run logs moved into the project ledger storage on completion.
- Docs: Updated architecture and log-schema docs for new log location.

## v0.9.3 - Dialogue Capture Integration
- Nodes: Agent dialogues serialised to Markdown and saved per stage.
- Nodes: Emits a dialogue-captured event after each successful capture.
- Logging: Added dialogue-captured console rendering.
- Docs: Updated JSONL log schema with dialogue capture event.
- Tests: +9 tests; 455 passing.

## v0.9.2 - Dialogue Writer Utility
- Utils: Added dialogue writer for message sequence serialisation.
- Tests: 39 tests covering all message types and revision numbering.
- Docs: Documented dialogue capture env var and writer public API.

## v0.9.1 - Dialogue Capture Flag
- Config: Added dialogue capture toggle (default off).
- Docs: Added env var reference and example configuration.

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
- Fix: Replaced Unix-only file locking with cross-platform module.
- Core: Added stdlib-only file lock with per-platform implementations.
- Tests: Added 3 platform-agnostic file-lock tests.
- Docs: Created project manifest documentation.

## v0.5.0 - Checkpoint Support & Stability
- Core: Added checkpoint support for resumable runs.
- CLI: Added concurrency guard to prevent parallel runs.
- CLI: Improved PM phase feedback.
- Fix: Fixed sqlite imports, tool wrapper bug, and async runtime errors.
- Tests: Added tool wrapper tests.

## v0.4.0 - Manifest-Driven Configuration
- Config: Pipeline routing now derived from workflow manifest at startup.
- Supervisor: Routing aligned with manifest-defined role and pipeline maps.
- Tests: Added config and expanded supervisor routing test suites.
- Docs: Added CTX Generator module context file.

## v0.3.0 - Nine-Stage Pipeline Support
- Nodes: Added security auditor and release engineer stage stubs.
- Config: Extended pipeline routing for two new stages.
- Docs: Updated README and architecture docs for 9-stage pipeline.

## v0.2.1 - Documentation Structure
- Docs: Updated and split READMEs for clarity.

## v0.2.0 - Ledger Delegation Architecture (Breaking-S)
- Architecture: Delegated all logic execution to the ledger system.
- Scripts: Replaced the primary execution script.

### Breaking Changes
This release moves all execution responsibility to the ledger.
Previous local execution patterns are superseded.

## v0.1.1 - Logic Cycle Stabilization
- Core: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial LangGraph-based pipeline implementation.
