# Orchestrator Changelog

## v0.9.6 - Slim Orchestrator Node Prompts

Removed redundant identity declarations, workflow step enumerations, and MCP
tool call guidance from all eight node prompt builder functions. Each
``_build_*_prompt()`` now provides only the runtime context the persona system
prompt cannot know.

**Functions changed:**

- `orchestrator/src/nodes/developer.py` — `_build_developer_prompt()`
- `orchestrator/src/nodes/qa.py` — `_build_qa_prompt()`
- `orchestrator/src/nodes/reviewer.py` — `_build_reviewer_prompt()`
- `orchestrator/src/nodes/security_auditor.py` — `_build_security_auditor_prompt()`
- `orchestrator/src/nodes/release_engineer.py` — `_build_release_engineer_prompt()`
- `orchestrator/src/nodes/docs.py` — `_build_docs_prompt()`
- `orchestrator/src/nodes/pm.py` — `_build_pm_prompt()`
- `orchestrator/src/nodes/synthesis.py` — `_build_synthesis_prompt()`

**What each slim prompt now contains:**

- Standard WP-scoped nodes (developer, qa, reviewer, security_auditor,
  release_engineer, docs): `project_path`, `wp_id`, and the
  `project_path` injection-safety warning.
- PM node: `project_path`, `plan_file`, the `project_path`
  injection-safety warning, and the embedded plan document content (unique
  runtime data the persona cannot know).
- Synthesis node: `project_path` and the `project_path` injection-safety
  warning only — `wp_id` is omitted because synthesis is project-scoped.

**Rationale:**

The persona system prompts (loaded from `personas/ledger/claude-code/`) are
the canonical source of truth for agent behaviour. Duplicating identity,
workflow steps, and tool guidance in the user turn created conflicts with the
persona, wasted input tokens on every agent invocation, and risked the
simplified user-turn instructions overriding the richer persona guidance due
to LLM attention weighting of user-turn content.

- Docs: Updated module-level docstrings in all eight node files to document
  the slim prompt strategy, what fields are included, and what is
  intentionally omitted.
- Tests: Updated orchestrator test suite assertions to reflect slim prompt
  format (slim fields present; identity/role declarations absent).

## v0.9.5 - Defaults & Heartbeat
- Config: `capture_dialogues` default changed from `False` to `True`.
- Config: Added `heartbeat_interval_s` setting (default 120 s).
- Logging: Added heartbeat emitter — sends periodic alive signals during quiet periods.
- Supervisor: Added `dry_run` mode for stub-based runs without a ledger.
- Dialogues: Folder relocated to `{slug}/orchestrator/dialogues/`.
- CLI: Run log archival now targets `{slug}/orchestrator/logs/`.

## v0.9.4 - Run Log Archival to Ledger Storage
- CLI: After run completion, the JSONL log is moved from `orchestrator/logs/` into `mcp-server/storage/ledger/{slug}/` so all project artefacts are co-located in the ledger folder. The final path is printed at run end. Falls back to the original location on `OSError`.
- Utils: Fixed stale docstring in `write_dialogue()` — `slug_dir` parameter now correctly documents the ledger storage path rather than the plan directory.
- Docs: Updated `architecture.md`, `jsonl-log-schema.md`, and `smoke-testing.md` to reflect the new log file location.

## v0.9.3 - Dialogue Capture Integration
- Nodes: `create_stage_node()` now captures full agent dialogue exchanges when `CAPTURE_DIALOGUES=true`. After each `ainvoke()`, the message sequence is serialised to Markdown and written to `{slug_dir}/dialogues/{wp_id}-{stage}-r{N}.md` via `write_dialogue()`. Failures are non-fatal — stage execution continues normally.
- Nodes: Emits a `dialogue_captured` JSONL event (`stage`, `wp_id`, `file_path`, `level="INFO"`) immediately after the `pipeline_result` entry. Only emitted when capture succeeds and `wp_id` is non-empty.
- Logging: Added `dialogue_captured` console-line branch to `_build_stream_console_line()` — formats as `[{stage}] {wp_id} dialogue saved → {filename}`.
- Docs: `orchestrator/docs/jsonl-log-schema.md` updated: `file_path` field added to Full Field Reference table; `dialogue_captured` row added to Action Values table; stage-start/complete ordering section updated to document step 4 (`dialogue_captured`); event count updated to 18.
- Tests: `TestDialogueCaptured` added to `test_nodes.py` (5 tests) and `test_logging.py` (4 tests). Total test suite: 455 tests.

## v0.9.2 - Dialogue Writer Utility
- Utils: Added `src/utils/dialogue_writer.py` with `serialize_messages_to_markdown()` and `write_dialogue()`.
- `serialize_messages_to_markdown()`: renders a Markdown document from a LangChain message sequence — header table, per-message sections (Human/Assistant/Tool Result/System), tool call JSON fences, and token-usage footer.
- `write_dialogue()`: persists Markdown to `{slug_dir}/dialogues/{wp_id}-{stage}-r{N}.md` with auto-incrementing revision numbers.
- Tests: 39 tests in `tests/test_dialogue_writer.py` covering all message types, revision numbering, and filesystem isolation via `tmp_path`.
- Docs: Documented `CAPTURE_DIALOGUES` env var, `dialogue_writer` public API, and supported message roles.

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
- Fix: Replaced unconditional `import fcntl` in `cli.py` with a cross-platform `filelock` module; the orchestrator now starts on Windows without `ModuleNotFoundError`.
- Core: Added `src/utils/filelock.py` — stdlib-only file locking (`fcntl.flock` on Unix, `msvcrt.locking` on Windows, no third-party dependencies).
- Tests: Added `tests/test_filelock.py` with 3 platform-agnostic unit tests: acquire succeeds, contention raises `OSError`, `unlock` is idempotent.
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
This release significantly refactors the orchestration logic, moving execution responsibility to the ledger. Previous local execution patterns may be deprecated.

## v0.1.1 - Logic Cycle Stabilization
- Logic: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial implementation of the LangGraph-based pipeline.
- Core: Completed post-development rework and stabilization.
- Config: Updated `.env.example`.
- Housekeeping: Removed temporary folders.
