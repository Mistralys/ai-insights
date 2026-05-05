# AI Insights Changelog

## v1.22.0 - Cross-WP Dispatch and New Personas
> mcp v1.29.0 · personas v3.17.0

- MCP: Cross-WP dispatch prevents IDE stalls between WP transitions.
- MCP: Synthesis handoff now returns COMPLETE instead of WAIT.
- Personas: Added Plan Auditor and Documentation Curator standalone personas.
- Personas: Rewrote 6 standalone personas to imperative voice.

## v1.21.0 - Handoff Spec Compliance
> mcp v1.28.0

- MCP: Fixed leftover hardcoded handoff routing paths.
- Orchestrator: Fixed a windows-specific test error.

## v1.20.0 - PM Pipeline-Aware Routing
> mcp v1.27.0 · orchestrator v0.18.0 · personas v3.16.1

- MCP: Improved PM handoff for ready WPs.
- Orchestrator: Eliminated a supervisor round-trip during stage transitions.
- Personas: Fixed CRLF line-ending handling in Windows builds.
- Scripts: CLI ported to `@mistralys/cli-menu` library with automatic pre-menu setup check.
- Hooks: Pre-commit hook now resolves Node.js on macOS via extended PATH.

## v1.19.0 - Progress Tracking & Metadata-Driven Subagents
> mcp v1.26.0 · orchestrator v0.17.0 · personas v3.16.0

- MCP: Pipeline-based project progress percentage in the GUI project list.
- Orchestrator: Subagent specs now derived from persona YAML metadata at startup.
- Personas: Added cross-reference validation for subagent slug variables.
- Scripts: Refactored CLI to use the `@mistralys/cli-menu` library.

## v1.18.0 - GUI Stale Instance Detection
> mcp v1.25.0

- MCP: Added stale-instance banner that alerts when component versions change since the GUI booted.

## v1.17.0 - Stream Retry on Transient API Errors
> orchestrator v0.16.0 · personas v3.15.1

- Orchestrator: Automatic retry with exponential backoff on transient API errors during
  streaming, with configurable retry limits and per-attempt JSONL log events.
- Personas: Updated persona design guide.

## v1.16.0 - Streaming Dialogue Capture
> mcp v1.24.0 · orchestrator v0.15.0 · personas v3.15.0

- Orchestrator: Real-time streaming chunk capture during agent runs.
- Orchestrator: Graceful shutdown on SIGTERM/SIGINT (cross-platform).
- MCP: GUI chunk browser renders captured dialogue as Markdown.
- MCP: Stage-scoped handoff routing replaces global WP filtering.
- Personas: Overhauled standalone suite with `ledger-` prefix naming.
- Personas: Added Persona Curator, Claude Coordinator, and
  WP Decomposer personas.
- Scripts: Added `clean-agents` CLI command for persona file cleanup.
- Scripts: Extracted shared publish-locations module.

## v1.15.0 - Deep-Agents Pipeline & Agent Name Resolution
> mcp v1.23.0 · orchestrator v0.13.0 · personas v3.14.0

- Personas: Added `deep-agents` as a third build target for the orchestrator.
- Personas: Added the generated name-mapping JSON file.
- Personas: Now using `elseif` commands.
- Orchestrator: All 9 stages load deep-agents persona files.
- Orchestrator: The PM stage now uses subagents.
- MCP: `auto_handoff` gains per-target agent name fields.
- Scripts: Added `menu.sh` / `menu.cmd` convenience launcher scripts.
- Scripts: Pre-commit hook now blocks commits when changelog versions drift.

## v1.14.0 - Per-Stage Model Configuration
> mcp v1.22.1 · orchestrator v0.12.0 · personas v3.11.1

- Orchestrator: Per-stage model selection driven by persona YAML metadata,
  replacing the global `MODEL_NAME` env var and `--model` CLI flag.
- Orchestrator: Fatal exceptions now correctly halt the iteration loop.
- Personas: Added `model_slug` metadata for persona-driven model routing.
- MCP: GUI renders `fatal_error` events in the run log view.
- Scripts: Preflight check no longer requires `MODEL_NAME` in `.env`.

## v1.13.0 - Template Engine & Cross-WP Hardening
> mcp v1.22.0 · orchestrator v0.11.0 · personas v3.11.0

- Orchestrator: Stage prompts migrated to Markdown template engine.
- Orchestrator: Post-completion guard and cross-WP soft-fail chain added.
- Orchestrator: Windows subprocess encoding and environment inheritance.
- Orchestrator: Real-time tool-call JSONL event logging.
- MCP: GUI renders tool-call events; path traversal now platform-native.
- Personas: Extracted the persona building into a separate library.
- Personas: Added Standalone Developer and Workflow Doctor personas.
- Personas: Local ledger plugin and agent name variables.
- Scripts: Added `preview-prompts` command for template review.

## v1.12.0 - Resilience, Guard Rails & GUI Polish
> mcp v1.21.0 · orchestrator v0.10.0 · personas v3.10.7

- Orchestrator: Pipeline rollback on stage crash auto-cancels the orphaned IN_PROGRESS pipeline and logs a `pipeline_rollback` entry.
- Orchestrator: Supervisor auto-cancels circuit-broken WPs (≥3 failures) before synthesis, satisfying the terminal-state precondition.
- Orchestrator: WP scope guard now injects missing `work_package_id` instead of passing through silently.
- Orchestrator: Terminal marker prevents re-execution of completed runs via `--resume`; UUID collision guard added.
- Orchestrator: Added WP guard — stage nodes reject tool calls that target a different work package.
- Orchestrator: Fixed stale lock file left behind on crashed or interrupted runs.
- Orchestrator: `inject_project_path()` strips `cwd_path` from tool calls to prevent server-side mutual-exclusivity errors.
- MCP: `ledger_cancel_pipeline` gains `auto_cancelled` flag; crash-recovery cancellations are excluded from rework budget.
- MCP: Project reset auto-cancels orphaned IN_PROGRESS pipelines and surfaces counts in the diagnosis output.
- MCP: `project_path` takes precedence over `cwd_path` when both are supplied; mutual-exclusivity error removed.
- MCP: Log migration uses `copyFile()` to preserve files still open by the orchestrator.
- MCP: `complete_pipeline` accepts `handoff_notes` as a string or an array.
- MCP: GUI identifies dry-run orchestrator runs with a "Dry Run" badge in the run list and run log timeline.
- CLI: `printHelp()` auto-generates from `COMMANDS`; `kill-orchestrator.js` gains `--depth N` lock-file scan override.
- Personas: Orchestrator Runner v1.5.1 — log monitoring via `read-log.js`, process cleanup via `kill-orchestrator.js`.
- Personas: Reviewer `documentation-forward` convention expanded with JSON schema and concrete examples.

## v1.11.0 - Dialogue Capture & Heartbeat
> mcp v1.18.6 · orchestrator v0.9.5 · personas v3.10.3

- Orchestrator: Added dialogue capture with per-stage Markdown serialisation.
- Orchestrator: Dialogue capture enabled by default; opt-out via env var.
- Orchestrator: Added heartbeat logging during quiet periods.
- Orchestrator: Artefacts relocated to `orchestrator/` subfolder in ledger.
- MCP: Added dialogue file API endpoints with path-traversal protection.
- MCP: Added Dialogues card to the Work Package detail view.
- MCP: Added dialogue capture toggle to Settings page.
- MCP: Run logs and dialogues relocated to ledger `orchestrator/` subfolder.
- MCP: Orphaned run log migration with two-tier legacy fallback.
- Hooks: Added Ruff as pre-commit hook.
- CLI: Added AGENTS.md → CLAUDE.md content sync command.
- MCP: Added orchestrator run log viewer with auto-refresh to the GUI.
- MCP: GUI now shows project and pipeline duration metrics.
- MCP: Projects capture runner identity; GUI adds runner filtering.
- MCP: Fixed a workflow deadlock when all work packages are blocked.
- Orchestrator: Supervisor emits progress snapshots and status events.
- Orchestrator: Stage nodes emit lifecycle events with duration tracking.
- Orchestrator: Fixed tool wrapper input argument handling.
- Personas: Reviewer now uses three-tier feedback with Fix-Forward.
- Personas: Orchestrator Runner expanded to all 16 JSONL event types.
- Personas: Release Engineer delegates changelog and CTX to sub-agents.
- CI: Bumped GitHub Actions to latest versions.

## v1.10.0 - Cross-Platform & Version Tracking
> mcp v1.15.0 · personas v3.10.0 · orchestrator v0.6.0

- MCP: Server now rejects project init when running a stale version.
- MCP: GUI project detail displays server and spec versions.
- Orchestrator: Fixed Windows startup with cross-platform file locking.
- Personas: AGENTS.md Curator now creates CLAUDE.md companion files.
- Personas: CTX Architect warns about tree vs file source exclusions.
- Docs: Added unified project manifest hub and cross-platform policy.
- Scripts: Added CTX document path normalization.

## v1.9.0 - Orchestrator Checkpoint Support
> mcp v1.14.1 · orchestrator v0.5.0 · personas v3.9.2

- Orchestrator: Added checkpoint support for resumable runs.
- Orchestrator: Added concurrency guard to prevent parallel runs against the same plan.
- Orchestrator: Improved PM phase feedback.
- Orchestrator: Fixed sqlite imports, a runtime bug, and async errors.
- MCP: Improved error messages when no project ledger exists.
- Personas: Simplified Orchestrator Runner preflight to automated script.
- CLI: Added automated pre-flight checks for the orchestrator.
- CLI: Orchestrator launcher no longer relies on `$PATH`.

## v1.8.0 - Extended 9-Agent Workflow
> mcp v1.14.0 · personas v3.9.1 · orchestrator v0.4.0

- Personas: Added Security Auditor. 
- Personas: Added Release Engineer.
- Personas: Project Manager now uses dedicated sub-agents.
- Personas: Added `mcpServers` for standalone Claude Code personas.
- Orchestrator: Updated for the full 9-agent workflow.
- Orchestrator: Derived pipeline routing and stage configuration from the shared workflow manifest.
- MCP: Introduced a shared workflow manifest as the single source of truth for roles and pipeline types.
- MCP: Extended work-package schema for pipeline-stage tracking and atomic writes.
- MCP: Added missing handoff methods for Security Auditor and Release Engineer.
- Build: Standalone personas now included in the build output.
- Build: VS Code output filenames now use `vs_file_name`.
- CLI: Switched interactive menu from number keys to letter keys.
- Docs: Updated `AGENTS.md` and READMEs for the 9-agent workflow.
- CI: Added GitHub Actions CI workflow and Dependabot.

## v1.7.6 - Persona Models
> mcp v1.12.0 · personas v3.9.1 · orchestrator v0.2.1

- Personas: Added per-persona model field.
- Personas: Planner and Project Manager use Claude Opus 4.6.
- CLI: Added a pause after each action in the interactive menu.

## v1.7.5 - Ledger GUI Fix & CTX Architect
- Ledger GUI: Fixed archiving projects changing their last updated time.
- Personas: Added the new standalone CTX Architect persona.

## v1.7.4 - Ledger GUI Improvements
- Ledger GUI: Added project archiving.
- Ledger GUI: Added work package count column.

## v1.7.3 - Ledger GUI Improvements
- Ledger GUI: Improved dark mode.
- Ledger GUI: Added the work package count column.
- Ledger GUI: Added column sorting.

## v1.7.2 - Ledger Path Detection
- Ledger: Improved project path detection.
- Ledger GUI: Added dark mode.

## v1.7.1 - Ledger Bugfix and GUI Improvements
- Ledger GUI: Renaming projects, repository name column.
- Ledger: Fixed broken VS Code agent handoffs.
- Ledger: Fixed project path handling.
- Personas v3.7.1: Improved developer.

## v1.7.0 - CLI and more
- CLI: Added a handy CLI menu.
- Personas: Fixed VS Code subagent call syntax.
- MCP: Tool handling improvements.

## v1.6.1 - Ledger Personas Improvements
- Personas: Simplified the preflight check.
- Personas: Avoiding the first tool call missing the agent role.
- Personas: Improved document formatting with clear sections.
- Personas: Restructured some overly verbose texts into lists.

## v1.6.0 - Ledger Spec Sync & Persona Refinements
- MCP: Synchronized workflow, pipeline, handoff, and work-package tools to the specification.
- MCP: Fixed workflow bug and root folder handling.
- Orchestrator: Delegated all agent logic to the ledger via tool wrappers.
- Orchestrator: Added setup script and replaced the run script.
- Personas: Added orchestrator runner persona.
- Personas: Updated ledger workflow.
- Personas: Readme curator now helps rewrite project readmes.
- Personas: Added philosophy of persona content.
- Personas: Fixed Reviewer logic bug and missing incident logging.
- Personas: QA: Added rework handling information.
- Personas: Simplified tool calls.
- Docs: Added persona tool usage matrix.
- Git: Added pre-commit persona freshness hook.

## v1.5.0 - Ledger Enhancements
- Ledger: Added archiving of the plan and synthesis documents.
- Ledger: GUI: Viewing the archived documents.
- Ledger: GUI: Added full text filter.
- Ledger: GUI: Added completion percentage.
- Ledger: GUI: More Readable Project Name.

## v1.4.0 - LangGraph Orchestrator Tool
- Personas: Added the WHATSNEW curator.
- Personas: Tweaked the sensibility of the changelog curator.
- Orchestrator: Added the CLI orchestrator tool.
- Docs: Added orchestrator troubleshooting entries.

## v1.3.0 - Multi-IDE Persona Builds
- Personas: Added a build process and templating.
- Personas: Now generating Markdown files for VS Code and Claude Code.
- Personas: Files now have to be built locally (`node scripts/sync-personas.js`).
- Personas: Rewrote the README curator to produce better human-centered documents.
- Personas: Improved the Module Intent Architect to create more relevant files.
- Personas: Added the Changelog Curator.
- Personas: Added the Composer Curator.
- Personas: Retired the unused "Vanilla" personas.
- Ledger: Fixed a logic exception in the Developer persona flow.
- Ledger: GUI: Added the "Insights" tab with a comments overview.

## v1.2.0 - Ledger GUI & Handoff Consolidation
- Ledger: Added a GUI to see projects and work package statuses (`node scripts/run-gui.js`).
- Personas: Consolidated handoffs to avoid agents going off script.

## v1.1.0 — Central Ledger & Refined Personas

- Personas: The planner now cross-references the codebase and asks pertinent questions.
- Ledger: The ledger files are now stored centrally - no `.ledger` folders needed anymore.
- Ledger: Agents can identify their project without the plan or work document added as context.
- Personas: All ledger-enabled personas are now built from templates for consistency.
- Ledger: Personas now leverage VS Code's tools to hand off work between themselves. 
- Personas: Tweaked and fixed logic gates and handoffs.
- Core: Maintenance scripts consolidated under a single `scripts/` folder.

## v1.0.0 - Initial release
- Personas with MCP ledger.
