# Personas Changelog

## v3.38.0 - Check-Only Chains Prevented, Handoffs Fixed

**Planning personas no longer produce work packages that only run checks.** Sub-agent handoffs and
dispatches now start the intended agent on Claude Code. The Synthesis Maintainer composes outcome
summaries and applies requested synthesis edits.

- Ledger, Ledger-Support: No check-only work packages; the Ledger Doctor diagnoses legacy ones.
- Ledger: Claude Code handoffs and sub-agent dispatches start the intended agent.
- Ledger: QA re-engages when requested and narrows its run only after a failed QA pipeline.
- Ledger-Support: Synthesis Maintainer composes summaries, applies edits, picks Archive or Refresh.
- Standalone: Changelog and WHATSNEW Curators gained Archive mode for older releases.
- Ledger, Standalone: Synthesis records archival failures and writes an Outcome Summary section.
- Planning: Releases stay out of plans; gates on a person count as dependencies.
- Planning: Baseline-capture guidance now runs through the whole planning chain.
- Ledger: Project Manager, Bootstrapper and Dependency Sequencer keep WP numbering in step.
- Developer: Never publishes or tags; Release Engineer prepares releases without running them.
- Ledger, Standalone: Changelog writers collect changes in one WIP version based on the last tag.
- Standalone: AGENTS.md Curator infers its mode from the request and never re-asks a decision.
- Standalone: Manifest Curator documents generated files; other curators and Git Committer use it.
- Standalone: Workspace Architect gained Amend mode, a plan file, return passes, artefact handling.
- Standalone: Documentation curators leave work to a caller's plan and may still call specialists.
- Standalone: WHATSNEW Curator writes self-contained items and completes existing versions.
- Ledger, Standalone: Documentation personas check docblocks against README prose.
- Deep Agents: Sub-agent dispatches pass the task in the correct field.
- Build: Wrong-name sub-agent dispatches and tool-grant mismatches now fail the build.
- Standalone, Build: Verb-initial philosophy titles are flagged without exception; four renamed.
- Build: Every check runs on each build; template comments are inert; personas can limit targets.
- Docs: Design Guide v3.6–3.8 covers sub-agent dispatch arguments and Nested Delegation.
- Shared: Added an outcome-summary crafting guide covering both suites.

## v3.37.0 - Self-Advancing Chains and Unattended Runs

**The Ledger Claude Coordinator no longer dispatches every stage by hand — it seeds a run and
restarts it only when the chain stalls.** Plans can no longer trap a work package behind a step
that only a person can do, and the WP Decomposer now checks its own finished draft in a second
pass before downstream agents ever read it.

- Changed: Ledger Claude Coordinator rebuilt as a chain monitor that restarts a stalled run from
  wherever the ledger says it stopped, instead of dispatching every stage itself.
- Changed: Planner and WP Decomposer keep human actions out of work packages entirely, tracking
  them in a new Human Actions section completed before or after the run.
- Changed: WP Decomposer gained a Consistency Pass mode that checks the finished draft as a set,
  catching gaps and duplicates no single-WP checklist can see.
- Fixed: A repeat Decompose dispatch over an already-decomposed plan no longer stalls waiting for
  someone to delete the draft by hand.
- Changed: Cross-model plan refinement passes now record which model made which pass, instead of
  a single combined tally.
- Renamed: Standalone Archiver is now Ledger Synthesis Maintainer; its Update mode now covers any
  completed project the ledger tracks, not just standalone imports.

## v3.33.0 - Agent Picker Role Labels

- Outputs: Standalone Claude Code personas now emit a `role` field for picker-friendly labels.

## v3.32.1 - Claude Code tool Access Fix

**Fixed MCP server and tools naming scheme when running Claude Code in agent
mode from the command line.**

- Outputs: Added & renamed the Claude Code specific MCP ledger tool names.
- Outputs: Better support for Claude Code when running `--agent agentname`.

## v3.32.0 - Design Guide v3.5 & Research Briefs

**The Persona Design Guide reaches v3.5 after a compliance sweep that touched nearly every 
persona in the roster.** Research briefs are now a first-class workflow artifact — the 
Project Manager verifies one exists before dispatching sub-agents, and the Git Committer 
manages its lifecycle alongside the plan. The Security Auditor now blocks releases on 
medium-severity findings, and a new Dependency Curator joins the standalone roster for 
dependency health audits. 

- Ledger: PM verifies research-brief.md exists before dispatching sub-agents, with a dedicated
  missing-brief report; gained the Task tool for Claude Code sub-agent dispatch.
- Ledger: Security Auditor now blocks on medium-severity findings (previously high only).
- LedgerSupport: WP Decomposer consumes the research brief's structural findings as verified
  input.
- LedgerSupport: Bootstrapper and Standalone Archiver gained a title-crafting guide for
  curated project display titles.
- Standalone: Git Committer now stages research-brief.md with the plan and removes it (rather
  than archiving it) on completion; fixed a corrupted safety rule.
- Standalone: Fixed WHATSNEW Curator's silent Rewrite mode and Changelog Curator writing
  entries before user approval.
- Standalone: Added Dependency Curator for dependency maintenance, major-version migration
  planning, and an Audit mode producing an A-E health scorecard per dependency.
- Standalone: Persona Curator gained a Reduce mode that trims bloat accumulated across
  repeated audits.
- Standalone: Documentation, README, AGENTS.md, and Manifest curators now correct small
  out-of-scope issues directly and dispatch the owning agent only for larger ones; Manifest
  Curator also gained a curation log and Git-history verification.
- Standalone: A guide-compliance sweep redesigned most personas with tone fixes, scope
  boundaries, self-validation checklists, and clearer workflow phase separation.
- LedgerSupport: Every ledger-support persona (Dependency Sequencer, WP Decomposer, Pipeline
  Configurator, Bootstrapper, Knowledge Curator, Knowledge Archiver, Standalone Archiver)
  passed its first design-guide audit.
- Global: Code insights now split into implementation decisions and follow-up items for
  clearer reporting.
- Global: Stored insights are mutable only by the Knowledge Curator, which gained a Targeted
  Reconciliation mode for entries a completed plan overtook; the Knowledge Archiver now reads
  live pipeline comments instead of the retired insight sidecar file.
- Global: Shared partials now cover the Planner and Developer personas across the ledger
  and standalone suites, reducing duplicated maintenance.
- Docs: Persona Design Guide reached v3.5 — added a Concept Index, a canonical principle
  registry, a bloat-trimming Reduction Pass, and a Prose Density pass.
- Build: Added automated checks for imperative-voice philosophy principles, oversized
  changelog entries, and missing Claude subagent tool declarations.

## v3.31.0 - Insight Channel Consolidation and Usage Scenarios Curator

**Ledger agents now route code observations through `ledger_add_observation` instead of writing
to a local sidecar file, giving each observation permanent storage and an optional `loc` field
for file-level context.** A new Usage Scenarios Curator joins the standalone roster for plan
scenario generation and deterministic coverage checks.

- Ledger: Developer, QA, Security Auditor, Reviewer, Documentation, and Synthesis now
  capture observations via `ledger_add_observation` with per-persona `insight_pipeline_type`.
- Ledger: Fixed stale `outputs` metadata in 5 personas still referencing insights.jsonl.
- Shared: Reviewer Deep Dive split into review + capture loop for Pattern 15 compliance.
- Shared: Added nothing-found forcing functions to QA, Security Auditor, Reviewer, and
  Documentation observer sections (Pattern 6 parity with Developer).
- Shared: Added `mcp-insight-capture` partial; drives per-action MCP observation calls with
  action-gating and pipeline-completion fallback for failed calls.
- Shared: Insight compilation partial gains `insight_consumer_only` mode; reads all sink
  entries regardless of author for accurate cross-agent compilation.
- Shared: Re-integrated all single-use partials into their respective ledger personas.
- Standalone: Developer, Web GUI Specialist, and Git Committer gain sidecar insight capture.
- LedgerSupport: Archiver personas classify insight files at the archival boundary.
- Standalone: Added Usage Scenarios Curator for plan scenario generation and coverage checks.
- Standalone: Plan Refiner gains opt-in scenario verification with a bounded re-check.
- Standalone: Key handoff agents preserve usage-scenarios.md through handoffs.
- Standalone: Git Committer gains delete guard and request.md archival support.
- Ledger: Retired WP spec file mechanism; agents 3–9 now source specs from the ledger.
- Ledger: PM uses the ping tool for preflight instead of help.
- Ledger: Security Auditor — removed incorrect REWORK action from the workflow.
- LedgerSupport: Bootstrapper protocol reduced from 7 to 5 steps.
- Docs: Persona Design Guide v2.7 — Tone Stratification added to Core Philosophy.
- Standalone: Persona Curator v1.4.0 — updated to reflect Tone Stratification.
- Build: Added agents-overview generator with overview metadata fields.
- Build: Model assignments updated to claude-sonnet-4-6; added `insight_agent` validation.
- Build: Fixed model assignment resolution to use model name instead of internal slug.

## v3.30.0 - New Personas and AX Feedback

- LedgerSupport: Added Orchestrator Archaeologist persona for forensic run artifact analysis.
- Standalone: Added Web GUI Specialist persona for engaging, visually optimized web interfaces.
- Ledger/Standalone: All key agents gain an AX Feedback pre-handoff step for structured
  self-reporting; extracted into a reusable shared partial.
- Standalone: Plan Refiner overhauled with research brief enrichment, incremental re-audit,
  sub-agent contribution, and a brief size guard; gains skip-architectural-review mode.
- Standalone: Plan Auditor and Plan Architect Reviewer gain Research Brief Protocol for
  self-managed brief usage and contribution.
- Standalone: Planner now includes a workflow recommendation section in plan output.

## v3.29.0 - Operating Philosophy and Project Summary Protocols

- Ledger: Planner, Developer, and Reviewer gain an Operating Philosophy section.
- Standalone: Plan Architect Reviewer and Plan Auditor gain an Operating Philosophy section.
- LedgerSupport: Bootstrapper and Archiver gain `project_summary` crafting protocol.
- Shared: Extracted summary-crafting guide into a reusable shared partial.

## v3.28.0 - Planner Research Phase and Archiver Modes
- Standalone: Changelog Curator gains release summary — optional prose paragraph with house style rules.
- Ledger: Planner gains a dedicated codebase research phase before plan design begins.
- Standalone: Planner gains same dedicated codebase research phase.
- LedgerSupport: Standalone Archiver gains Import/Update operating modes.
- LedgerSupport: Standalone Archiver integrates `ledger_update_synthesis` in Update mode.
- Standalone: Git Committer gains timestamp guard for generated-file commit filtering.

## v3.27.0 - Plan Folder Date-Rename and WP Enforcement Hardening
- Ledger: PM gains step 2 to rename plan folder date prefix to today before decomposition.
- Standalone: Developer gains step 1 to rename plan folder date prefix to today before implementation.
- LedgerSupport: WP Decomposer gains deliverable-AC parity enforcement for state-changing operations.
- LedgerSupport: Pipeline Configurator gains state-changing operation guardrail for verification-only WPs.

---

Older versions are archived in [../docs/changelog-history/personas](../docs/changelog-history/personas).
Most recent archive: [v3.26](../docs/changelog-history/personas/v3/v3.26.md).
