# AI Insights Changelog

## v2.15.0 - Outcome Summaries and Safer Chains
> mcp v2.11.0 · personas v3.38.0

**Work packages whose verifier stage cannot be fixed are now rejected at creation.** Planning
personas also stop producing check-only work packages. Agents now write project outcome summaries
themselves, and Claude Code handoffs reliably start the intended agent. VS Code personas, skills
and MCP config now deploy to the global Copilot home.

- MCP: Work package creation rejects chains whose verifier stage has no stage able to fix it.
- Personas: Planning personas no longer produce check-only work packages.
- MCP: Standalone import and synthesis refresh accept agent-supplied outcome summaries.
- Personas: Synthesis Maintainer composes summaries and applies requested synthesis edits.
- Personas: Claude Code handoffs and sub-agent dispatches start the intended agent.
- CLI: Persona sync, skill publishing and MCP install now target the global Copilot home.
- CLI: Files deployed to the old VS Code locations are not removed automatically.
- MCP: Agent registry looks for agents in the same folder as persona sync.
- Personas: Workspace Architect gained Amend mode and keeps its session plan in a file.
- Personas: Manifest Curator documents generated files; related curators and Git Committer follow.
- Personas: Documentation curators defer to a caller's plan and check docblocks against READMEs.
- Personas: Changelog and WHATSNEW Curators can now archive older releases.
- Personas: WHATSNEW Curator writes self-contained items; changelog writers use one WIP version.
- Personas: Releases stay out of plans; developers and release engineers never publish or tag.
- Personas: Work-package renumbering and ordering are handled consistently across planning.
- CLI: Claude agent picker gained a toggle to launch with permission prompts skipped.
- CLI: New `audit-orchestrator` command scans the orchestrator venv for security advisories.
- MCP: Artifact-declaration warnings now follow each pipeline type's policy.
- MCP: Fixed synthesis refresh clearing a stored summary it could not replace.
- GUI: Persona model settings flag obsolete assignments and offer to remove them.
- Build: Persona build runs every check and verifies sub-agent dispatch on all targets.
- Build: Generated context bundle no longer duplicates `AGENTS.md`; related docs corrected.
- Dependencies: Updated JS and Python packages to clear known security advisories.

## v2.14.1 - CLI Claude Resume

- CLI: The Claude Code agent selector now links to the resume tool.

## v2.14.0 - Self-Advancing Pipeline Chains
> mcp v2.10.1 · personas v3.37.0

**The Ledger Claude Coordinator now monitors and restarts a self-advancing chain instead of
dispatching every stage by hand.** Plans can no longer trap work behind a step only a person can
do, and the WP Decomposer validates its own draft in a second consistency-check pass.

- Personas: Ledger Claude Coordinator now monitors and restarts a stalled chain instead of
  dispatching every stage itself.
- Personas: Plans can no longer trap work behind a step that only a person can complete.
- Personas: WP Decomposer now validates its finished draft in a second consistency-check pass.
- Personas: Standalone Archiver renamed to Ledger Synthesis Maintainer; Update mode now serves
  any completed project.
- MCP: `ledger_update_synthesis` can now refresh any completed project's summary, not just
  standalone imports.

## v2.13.0 - Active Duration Tracking & Numeric Input Tolerance
> mcp v2.10.0

**Numeric tool inputs like confidence, limit, and offset now accept string-encoded values,
fixing failures some clients hit when passing numbers as strings.** Confidence values are
also validated to stay within the 0–1 range, and project duration now displays active work
time instead of wall-clock time.

- MCP: Numeric tool inputs like confidence, limit, and offset now accept string values.
- MCP: Confidence values are now validated to stay within the 0–1 range.
- GUI: List column, sort, and detail-page labels now display active time.

## v2.11.0 - Global Agent Launcher
> personas v3.33.0

**Added `ai-insights agent`, a command that launches any deployed persona from any terminal
directory via a type-to-filter picker.** The CLI can now be linked globally with `ai-insights
link-cli`, and Claude Code agents show friendlier role names when picking one to launch.

- Scripts: Added `ai-insights agent`, a picker to launch any persona via `claude --agent`.
- Scripts: Added `ai-insights link-cli` to register the CLI globally, with a health check.
- Personas: Claude Code agents now show friendly role names in the launcher picker.

## v2.10.1 - Claude Code tool Access Fix
> personas v3.32.1

**Fixed MCP server and tools naming scheme when running Claude Code in agent
mode from the command line.**

- Personas: Added & renamed the Claude Code specific MCP ledger tool names.

## v2.10.0 - Research Briefs and Curated Project Titles
> mcp v2.9.0 · personas v3.32.0

**Projects can now carry an agent-curated display title instead of a slug-derived name, and
research briefs are now enforced as a first-class workflow artifact.** The Project Manager
verifies a research brief exists before dispatching work, and the Persona Design Guide reaches
v3.5 after a compliance sweep that touched nearly every persona in the roster.

- MCP: Added a `title` field so projects can carry an agent-curated display name.
- MCP: Fixed the Model Registry save button becoming unresponsive.
- Personas: Research briefs are now enforced — the PM verifies one exists before dispatching
  sub-agents, and the Git Committer manages its lifecycle alongside the plan.
- CLI: Global Claude ledger MCP config fix & config refresh when stale.
- Personas: Added the Dependency Curator for dependency health audits and migration planning.
- Personas: Security Auditor now blocks releases on medium-severity findings.
- Personas: Persona Design Guide reached v3.5 after a compliance sweep across nearly the
  entire roster, gaining a bloat-trimming Reduction Pass and a Prose Density pass.

## v2.9.0 - Multi-Store Ledger and Insight Channel Consolidation
> mcp v2.8.0 · orchestrator v1.4.0 · personas v3.31.0

**This release ships the multi-store storage layer, enabling cross-device ledger sync by
registering multiple store roots in the new Stores GUI tab.** Ledger agents now route code
observations through `ledger_add_observation` MCP calls — replacing the local sidecar file —
with an optional `loc` field for file-level context.

- MCP: Multi-store storage layer with Stores CRUD tab, cross-store repo scanning, and
  store-aware knowledge and repository handlers.
- MCP: Knowledge insight IDs migrated from integers to UUID v4.
- MCP: Work packages now carry title and description fields; spec files retired.
- MCP: Added `ledger_ping` tool; `ledger_get_next_action` now returns `plan_path`.
- MCP: Added `loc` to `ledger_add_observation` and `insight_pipeline_type` routing.
- MCP: Fixed release engineering PASS routing on multi-stage pipelines.
- GUI: Sortable repos and project list, project filter, breadcrumbs, and modal dialogs.
- GUI: Project duration column added; duration cached on synthesis completion.
- Orchestrator: Added store resolution utility for multi-store ledger lookup.
- Personas: Ledger agents route observations through `ledger_add_observation` with
  `insight_pipeline_type`; standalone agents gain sidecar insight capture.
- Personas: Added Usage Scenarios Curator; Plan Refiner gains scenario verification.
- Personas: Retired WP spec file mechanism; PM gains ping-based preflight.
- Scripts: Added store management CLI subcommands and knowledge UUID migration script.
- Scripts: Added `backfill-duration` and canonical ledger-directory discovery helper.
- Build: Added `insight_agent` field validation; fixed model assignment resolution.

## v2.8.0 - Model Settings & GUI Improvements
> mcp v2.7.0 · orchestrator v1.3.2 · personas v3.30.0

**This release ships the LLM Model Registry with per-persona model assignments, giving users
fine-grained control over which model powers each agent stage. The GUI receives a broad round of
improvements: cleaner navigation, better typography, a Text Only tab for work-package panels,
repository breadcrumbs, and an improved orchestrator dialogue renderer. Two new standalone
personas — Orchestrator Archaeologist and Web GUI Specialist — join the roster.**

- MCP: Now supporting per-persona model assignments.
- GUI: Improved main navigation styling.
- GUI: Improved typography and readability in project detail screens.
- GUI: Added Text Only tab to work-package panels.
- GUI: Repository display and breadcrumbs added to the project detail views.
- GUI: Improved Orchestrator dialogue rendering.
- GUI: Added the LLM Model Registry.
- GUI: Added the possibility to assign models to personas.
- GUI: Removed the unused Insights tab (Knowledge supersedes it).
- Orchestrator: Extended persona YAML glob to support agents with two-digit role numbers.
- Personas: Added the Orchestrator Archaeologist (Standalone).
- Personas: Added the Web GUI Specialist (Standalone).
- Personas: AX Feedback pre-handoff step added across ledger and standalone agents.
- Personas: Plan Refiner improved with brief enrichment and design review triage.
- Scripts: Added `extract-dialogue` CLI command for JSONL chunk file text extraction.

## v2.7.0 - Project Summaries and Persona philosophy
> mcp v2.6.0 · personas v3.29.0

**Projects now carry a human-readable summary that surfaces throughout the interface, giving
agents and users immediate context at a glance.** The core personas' philosophy now includes
stronger long-term stability aspects.

- MCP: Added `project_summary` parameter to init and import tools.
- GUI: Updated project synopsis from the agent-curated summary.
- GUI: Dialogue chunk renderer extended with structured format support.
- Scripts: Added skills build and publish pipeline.
- Skills: Added the `insights-audit-persona` skill to the build pipeline.
- Personas: Added long-term stability aspects to the operating philosophy.
- Personas: Bootstrapper and Archiver now generate project summaries.

## v2.6.0 - Orchestrator Fix, Persona Improvements
> mcp v2.5.0 · orchestrator v1.3.1 · personas v3.28.0

**This release fixes the Orchestrator's path handling issues.** Additionally, the Planner now opens with a dedicated codebase research phase, keeping exploration separate from plan design for more grounded results. The Standalone Archiver gains distinct Import and Update modes to be able to add updates to an already archived synthesis. 

- MCP: Added `ledger_update_synthesis` tool to refresh archived synthesis post-import.
- MCP: Introduced chat-style dialogue renderer for WP chunk panel views.
- MCP: Fixed tool call list not rendering in the orchestrator run log.
- Orchestrator: PathNormalizationMiddleware now exempts MCP tools from path rewriting.
- Personas: Planner gains a dedicated codebase research phase before plan design.
- Personas: Standalone Archiver gains Import/Update modes with synthesis update support.
- Personas: Git Committer gains timestamp guard to skip commits with no content change.
- Personas: Changelog curator will now generate a short summary of changes.
- Scripts: Improved orchestrator build staleness detection in the health check system.

## v2.5.0 - Path Middleware, Plan Rename, and Multi-Term Search
> mcp v2.4.1 · orchestrator v1.3.0 · personas v3.27.0

- MCP: Added multi-term support to `ledger_search_insights` for broader knowledge queries.
- Orchestrator: Added cross-platform PathNormalizationMiddleware for Deep Agents tool calls.
- Orchestrator: Reclassified HTTP 401 as retryable; added pre-run plan folder date-rename.
- Orchestrator: Added Deep Agent integration test tier with fake LLM driver.
- Scripts: Added `orchestrator-tests` CLI command for integration and deepagent test tiers.
- Personas: PM and Developer gain a plan-folder date-rename step before work begins.
- Personas: WP Decomposer and Pipeline Configurator gain enforcement hardening for WP quality.

---

Older versions are archived in [docs/changelog-history/root](docs/changelog-history/root).
Most recent archive: [v2.4](docs/changelog-history/root/v2/v2.4.md).
