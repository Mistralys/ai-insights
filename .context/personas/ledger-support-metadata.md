# Personas - Ledger Support Metadata
<INSTRUCTION>
# Personas - Ledger Support Persona Metadata
YAML metadata for all 9 ledger-support personas: shared defaults (_shared.yaml) and per-persona overrides - slugs, descriptions, MCP tools, and feature flags.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: YAML metadata for all 9 ledger-support personas (shared defaults + per-persona overrides)_
# YAML metadata for all 9 ledger-support personas (shared defaults + per-persona overrides)
```
// Structure of documents
└── personas/
    └── ledger-support/
        └── src/
            └── meta/
                └── _shared.yaml
                └── ledger-bootstrapper.yaml
                └── ledger-claude-coordinator.yaml
                └── ledger-dependency-sequencer.yaml
                └── ledger-doctor.yaml
                └── ledger-knowledge-archiver.yaml
                └── ledger-knowledge-curator.yaml
                └── ledger-orchestrator-archaeologist.yaml
                └── ledger-orchestrator-runner.yaml
                └── ledger-pipeline-configurator.yaml
                └── ledger-wp-decomposer.yaml
                └── standalone-archiver.yaml

```
###  Path: `/personas/ledger-support/src/meta/_shared.yaml`

```yaml
author: Sebastian Mordziol
default_version: "1.0.0"
mcp_server_name: central_pm
cc_permission_mode: "acceptEdits"    # Autonomous workflow default
cc_model: "inherit"                  # Defer to user's configured model
cc_memory: "project"                 # Project-scoped memory
default_cc_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
  - WebFetch
  - WebSearch
  - TodoRead
  - TodoWrite

```
###  Path: `/personas/ledger-support/src/meta/ledger-bootstrapper.yaml`

```yaml
slug: ledger-bootstrapper
name: "Ledger Bootstrapper"
description: "Mechanically initialize the project ledger: create all Work Package entries via MCP tools and verify the setup is complete."
vs_file_name: ledger-bootstrapper.agent.md
id: standalone-ledger-bootstrapper
cc_file_name: ledger-bootstrapper.md
audit_guide_version: "3.4"
audit_date: "2026-08-28"
changelog: |
  1.4.0 (2026-08-28): First audit (guide v3.4) — Inputs restructured around the PM's two-argument dispatch; every ledger_create_work_package parameter now names its source document; added Stage Ownership table so assigned_to is derived rather than guessed; added a protocol Constraints block; report gained Failures and Flagged slots with explicit none-forms; dropped the unused edit tool grant
  1.3.0 (2026-08-04): Removed spec file creation and verification steps; protocol reduced from 7 to 5 steps; description promoted to required field in ledger_create_work_package
  1.2.0 (2026-07-16): Extracted summary-crafting guidelines to shared partial
  1.1.0 (2026-05-19): WP spec template carries all draft fields verbatim; no summarization
  1.0.0 (2026-03-16): Initial release — ledger WP initialization via MCP tools

tools:
  - vscode
  - execute
  - read
  - search
  - central_pm/*

# overview metadata
identity: "Technical Program Manager — Ledger Initialization Operator"
use_when: "Invoked by the Project Manager (Stage 2) as the last of the four decomposition stages, once the WP definitions, dependency analysis, and pipeline configuration are all written"
key_behavior: |
  Creates the project in the ledger, then registers each WP in execution-phase order — drawing its description and criteria from the WP definitions, its dependency edges from the dependency analysis, and its stage list and assigned agent from the pipeline configuration — and verifies the final state matches expectations

```
###  Path: `/personas/ledger-support/src/meta/ledger-claude-coordinator.yaml`

```yaml
slug: ledger-claude-coordinator
name: "Ledger Claude Coordinator"
description: "Coordinate the multi-stage agentic pipeline by consulting the central_pm ledger and dispatching work to the correct sub-agent."
vs_file_name: ledger-claude-coordinator.agent.md
id: standalone-ledger-claude-coordinator
cc_file_name: ledger-claude-coordinator.md
changelog: |
  1.0.0 (2026-03-19): Initial release — coordinate multi-stage pipeline via central_pm ledger

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - mcp

cc_tools:
  - Task
  - Read
  - Grep

# overview metadata
identity: "Technical Workflow Director"
use_when: "Experimental — originally designed to coordinate the ledger pipeline in Claude Code, but currently unused because Claude Code does not reliably follow ledger routing. Retained for future evaluation"
modes: |
  Interactive (default)
  Autonomous

```
###  Path: `/personas/ledger-support/src/meta/ledger-dependency-sequencer.yaml`

```yaml
slug: ledger-dependency-sequencer
name: "Ledger Dependency Sequencer"
description: "Map dependencies between Work Packages, identify parallelization opportunities, and determine optimal execution ordering."
vs_file_name: ledger-dependency-sequencer.agent.md
id: standalone-ledger-dependency-sequencer
cc_file_name: ledger-dependency-sequencer.md
audit_guide_version: "3.4"
audit_date: "2026-08-27"

changelog: |
  1.4.4 (2026-08-28): Renamed the philosophy principle "The Decomposer Already Looked" to the canonical "The Upstream Stage Already Looked" (C5c) — the WP Decomposer now carries the same principle for the research brief, and a per-predecessor name forks on every new consumer
  1.4.3 (2026-08-27): Prose Density Pass (guide v3.4) — split three philosophy bodies that carried a second idea past their main claim
  1.4.2 (2026-08-27): Rewrote the philosophy principles, protocol prose and constraints in plain language — same meaning, concrete phrasing, no abstract-noun density
  1.4.1 (2026-08-27): Inputs now state the Project Manager's actual dispatch contract — one plan folder path holding both required files — replacing three separately-supplied inputs and a wrongly optional plan document
  1.4.0 (2026-08-27): Audit compliance (guide v3.3) — added Operating Philosophy; split evidence-gathering from edge assertion per Pattern 14; added cycle-detection checkpoint; consolidated protocol constraints into their own block
  1.3.0 (2026-07-06): Step 1 now consumes Code Observations from upstream WP Decomposer to avoid redundant codebase reads
  1.2.0 (2026-07-06): Added codebase verification capability; Step 2 now includes code-level coupling checks for import graphs, shared types, and module boundaries
  1.1.0 (2026-07-06): Audit compliance — agent name variables, section reorder, capabilities, strengthened constraints, separator cleanup
  1.0.4 (2026-05-18): Gains missing write step; subagent handoff precision improved
  1.0.3 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — Work Package dependency mapping and ordering

tools:
  - read
  - edit
  - search

# overview metadata
identity: "Technical Program Manager — Dependency Analyst"
use_when: "Invoked by the Project Manager to determine WP execution order"

```
###  Path: `/personas/ledger-support/src/meta/ledger-doctor.yaml`

```yaml
slug: ledger-doctor
name: "Ledger Doctor"
description: "Audit and repair ledger workflow projects: diagnose deadlocks, fix state corruption, unlock stalled pipelines, and resolve technical issues."
vs_file_name: ledger-doctor.agent.md
id: standalone-ledger-doctor
cc_file_name: ledger-doctor.md
changelog: |
  1.3.1 (2026-08-26): Rewrote all six Operating Philosophy principles from imperative into indicative mood per design guide v3.0
  1.3.0 (2026-06-04): Holistic repair philosophy; project recovery tool; routing verification
  1.2.0 (2026-06-03): Refreshed workflow knowledge
  1.1.0 (2026-04-12): Audited and improved
  1.0.1 (2026-03-29): Collected fixes
  1.0.0 (2026-03-28): Initial release — ledger workflow diagnostics and repair

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - mcp
  - todo
  - central_pm/*

cc_tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
  - WebFetch
  - TodoRead
  - TodoWrite

# overview metadata
identity: "Senior Workflow Reliability Engineer"
use_when: "A ledger project is stuck, has state corruption, or pipelines are deadlocked"
modes: |
  Diagnose
  Repair
  Audit

```
###  Path: `/personas/ledger-support/src/meta/ledger-knowledge-archiver.yaml`

```yaml
slug: ledger-knowledge-archiver
name: "Ledger Knowledge Archiver"
description: "Extract and commit reusable knowledge from completed ledger project folders into the knowledge base."
vs_file_name: ledger-knowledge-archiver.agent.md
id: standalone-ledger-knowledge-archiver
cc_file_name: ledger-knowledge-archiver.md
changelog: |
  1.9.0 (2026-08-28): First full audit at guide v3.4 — 14 findings, all resolved. Mode A no longer reads
    the insights.jsonl sidecar, which ledger agents stopped writing on 2026-08-24; pipeline comments read
    via ledger_get_work_package are named as its live replacement. Added a Resolve Provenance workflow step
    and a repository resolution protocol (ledger_get_repository_context via cwd_path), closing a gap where
    repository_name and origin_plan had no documented Mode A source despite being required for repository
    scope. Capabilities table now authorises the chunk-log reads and the Mode B marker write the protocol
    already performed. Added an Output Template so the report's per-item skip reasons and nothing-committed
    case are stated where they fire, plus a Scope Boundaries table against the Knowledge Curator and a
    constraint forbidding entry edits. Confidence bands no longer contradict the philosophy. Philosophy:
    two imperative principles rewritten as claims; prohibitions consolidated into Strict Constraints.
  1.8.1 (2026-08-26): Rewrote trailing imperative sentences in three philosophy principles into indicative mood
  1.8.0 (2026-08-21): Add insights.jsonl as optional low-priority source in both reading orders
  1.7.0 (2026-07-31): Philosophy rewritten with positive framing; constraint-like items moved to Strict Constraints
  1.6.0 (2026-06-09): Renamed to Ledger Knowledge Archiver; slug and name updated
  1.5.0 (2026-06-08): Gained local archiving task marker file support
  1.4.0 (2026-05-30): Fixed agent naming for correct subagent registry references
  1.3.0 (2026-05-30): Fixed slug field for proper persona registry matching
  1.2.0 (2026-05-30): Knowledge collection delegation from Synthesis integrated
  1.1.0 (2026-05-30): Refined operational protocol
  1.0.0 (2026-05-29): Initial release — retrospective knowledge extraction from completed projects

audit_guide_version: "3.4"
audit_date: "2026-08-28"

tools:
  - vscode
  - read
  - edit
  - search
  - central_pm/*

# overview metadata
identity: "Head of Operations — Retrospective Knowledge Analyst"
use_when: "After a project completes, to capture lessons learned into the knowledge base"
modes: |
  Live (Subagent — invoked by Synthesis)
  Archive (Retrospective — user-invoked)

```
###  Path: `/personas/ledger-support/src/meta/ledger-knowledge-curator.yaml`

```yaml
slug: ledger-knowledge-curator
name: "Ledger Knowledge Curator"
description: "Audit knowledge base entries for value, accuracy, and relevance — edit, merge, or delete entries that fail quality thresholds."
vs_file_name: ledger-knowledge-curator.agent.md
id: standalone-ledger-knowledge-curator
cc_file_name: ledger-knowledge-curator.md
changelog: |
  1.4.0 (2026-08-28): Added a third mode, Targeted Reconciliation — a bounded pass over entries a caller
    names after a completed change overtook what they claim, with its own Reconciliation Protocol, report
    template and workflow. Its constraints forbid widening into an audit, rewriting on a caller's
    description without verifying the change landed, and reconciling an unresolved or ambiguous
    identifier. Added a Locating a Named Entry protocol, since no tool fetches an insight by id.
  1.3.0 (2026-08-28): First full audit at guide v3.4 — 15 findings, all resolved. MERGE now retires the
    duplicate via superseded_by + confidence 0 instead of deleting it, closing a contradiction where the
    approval gate and the "non-destructive" workflow step disagreed about whether a merge could delete.
    RESCOPE no longer instructs the agent to recreate the entry, which the no-creation constraint forbade.
    Output template reports insight UUIDs instead of the retired KN-NNNN format. Added a repository
    resolution protocol (ledger_get_repository_context via cwd_path) for the previously undocumented
    repository_name. Added a decision log opened at session start with a session-start marker, so the
    action and reporting steps read decisions rather than reconstruct them. Added a batch-narrowing step
    for oversized knowledge bases and a coverage line to the report. Philosophy: three trailing
    imperatives rewritten as claims; adopted the Archiver's canonical "Context Completes the Insight"
    name and surfaced "Quality Over Quantity" as a named principle.
  1.2.1 (2026-08-26): Rewrote trailing imperative sentences in the One Canonical Entry philosophy principle into indicative mood
  1.2.0 (2026-06-09): Deletions now require user confirmation before execution
  1.0.0 (2026-06-09): Initial release — knowledge base auditing and curation

audit_guide_version: "3.4"
audit_date: "2026-08-28"

tools:
  - vscode
  - read
  - search
  - central_pm/*

# overview metadata
identity: "Knowledge Base Librarian"
use_when: "The knowledge base has grown and needs quality review — removing low-value entries, merging duplicates, improving clarity — or a completed change has overtaken specific stored insights"
modes: |
  Global Maintenance
  Project Maintenance
  Targeted Reconciliation

```
###  Path: `/personas/ledger-support/src/meta/ledger-orchestrator-archaeologist.yaml`

```yaml
slug: ledger-orchestrator-archaeologist
name: "Ledger Orchestrator Archaeologist"
description: "Excavate stored orchestrator run artifacts to identify technical issues, friction points, and behavioral anomalies in LangGraph Deep Agents pipeline execution."
vs_file_name: ledger-orchestrator-archaeologist.agent.md
id: standalone-ledger-orchestrator-archaeologist
cc_file_name: ledger-orchestrator-archaeologist.md
changelog: |
  1.0.2 (2026-08-26): Rewrote trailing imperative sentences in two philosophy principles into indicative mood
  1.0.1 (2026-07-23): Domain knowledge audit fixes — remove non-existent `halt` action, add `halted_wp_cancelled`; fix `route` field description to distinguish WP-routing vs early-routing fields; fix `metadata.checkpoint_ns` → `metadata.langgraph_checkpoint_ns`; fix `lc_versions` key casing (`langchain-core` → `langchain_core`)
  1.0.0 (2026-07-23): Initial release — forensic analysis of orchestrator logs and dialogue chunks

tools:
  - vscode
  - read
  - search

# overview metadata
identity: "Forensic Operations Analyst"
use_when: "Analyzing a completed orchestrator run to understand what went wrong or identify improvement opportunities"

```
###  Path: `/personas/ledger-support/src/meta/ledger-orchestrator-runner.yaml`

```yaml
slug: ledger-orchestrator-runner
name: "Ledger Orchestrator Runner"
description: "Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run from a plan document."
vs_file_name: ledger-orchestrator-runner.agent.md
id: standalone-ledger-orchestrator-runner
cc_file_name: ledger-orchestrator-runner.md
da_file_name: ledger-orchestrator-runner.md
changelog: |
  1.5.1 (2026-03-26): Troubleshooting table updated with --depth N flag for kill-orchestrator
  1.5.0 (2026-03-25): Replaced log monitoring with read-log.js; kill-orchestrator.js added
  1.4.1 (2026-03-25): Fixed terminal polling; JSONL schema reading; dry-run go/no-go decisions
  1.4.0 (2026-03-23): Updated JSONL event count to 20; added env vars; log archival docs
  1.3.0 (2026-03-23): Restructured progress monitoring; expanded JSONL event type coverage
  1.2.0 (2026-03-20): Simplified preflight to single script call
  1.0.1 (2026-02-24): Minor updates and fixes
  1.0.0 (2026-02-24): Initial release — orchestrator pre-flight, launch, and monitoring

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - todo

cc_tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Task
  - TodoRead
  - TodoWrite

# overview metadata
identity: "AI Insights Workflow Operator"
use_when: "Launching an automated orchestrator run from a plan document"
key_behavior: |
  Runs preflight checks, starts the orchestrator, monitors for completion

```
###  Path: `/personas/ledger-support/src/meta/ledger-pipeline-configurator.yaml`

```yaml
slug: ledger-pipeline-configurator
name: "Ledger Pipeline Configurator"
description: "Determine which pipeline stages should be active for each Work Package based on the nature of the work."
vs_file_name: ledger-pipeline-configurator.agent.md
id: standalone-ledger-pipeline-configurator
cc_file_name: ledger-pipeline-configurator.md
audit_guide_version: "3.4"
audit_date: "2026-08-28"

changelog: |
  1.2.0 (2026-08-28): First full audit (guide v3.4) — 14 findings, all resolved. Inputs rewritten to match the PM's single-folder-path dispatch contract, replacing the four-item list and the "if the plan document is available" hedge. Added an Operating Philosophy with four principles, two of them the canonical "The Upstream Stage Already Looked" and "A Few Right Files Beat Many" (C5c). Added a Codebase Verification capability — the narrowing pre-requisites always required reading source that Capabilities never authorised. Split the fused classify-and-verify workflow step into triage / verify / assign per Pattern 14, and gave the Guardrail Notes slot an explicit nothing-found form so a clean run reads differently from a skipped one. Decision Criteria gained its own Constraints block; headings de-imperativised; handoff now emits the full persona name
  1.1.0 (2026-07-09): Verification-only chain gains state-changing operation pre-requisite; Workflow Step 2 adds AC coverage check for CLI commands; quality checklist item added for side-effect verification
  1.0.2 (2026-05-18): Write step references Output Location; subagent handoff precision improved
  1.0.1 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — pipeline stage activation per Work Package type

tools:
  - read
  - edit
  - search

# overview metadata
identity: "Technical Program Manager — Pipeline Stage Analyst"
use_when: "Invoked by the Project Manager to determine which pipeline stages each WP should go through"

```
###  Path: `/personas/ledger-support/src/meta/ledger-wp-decomposer.yaml`

```yaml
slug: ledger-wp-decomposer
name: "Ledger WP Decomposer"
description: "Analyze a plan document and decompose it into atomic, actionable Work Package definitions."
vs_file_name: ledger-wp-decomposer.agent.md
id: standalone-ledger-wp-decomposer
cc_file_name: ledger-wp-decomposer.md
audit_guide_version: "3.4"
audit_date: "2026-08-27"

changelog: |
  1.5.2 (2026-09-10): Missing-brief report drops the stale gitignore rationale — the remedy is a fresh Planner write against the current codebase, not a workaround
  1.5.1 (2026-08-28): A missing research brief is now reported as a gitignored file only the Planner can regenerate, instead of as a failed upstream stage; the PM gates the check before dispatch
  1.5.0 (2026-08-28): Consumes the Planner's research-brief.md as a required input — Step 3 now checks Verified References and the Scope Sketch before opening any source file, Code Observations mark each finding [brief] or [verified], and the brief's Structural Observations are barred as a WP source since the Planner already resolved them
  1.4.0 (2026-08-27): Audit compliance (guide v3.4) — Inputs now state the Project Manager's dispatch contract instead of hedging against an absent plan; split boundary evidence-gathering from boundary assertion per Pattern 14; promoted two protocol imperatives into philosophy principles; consolidated protocol constraints into their own block; deliverable-AC parity now stated once
  1.3.1 (2026-08-26): Rewrote Operating Philosophy into indicative mood per design guide v3.0
  1.3.0 (2026-07-09): Deliverable-AC parity enforcement; Step 4 gains coverage test for state-changing operations; two quality checklist items added; strict constraint added requiring every deliverable to trace to a covering AC
  1.2.0 (2026-07-06): Added codebase verification capability; Step 2 gains targeted code checks for scope sizing, coupling detection, and separation confirmation; output template gains Code Observations field for downstream reuse by Dependency Sequencer
  1.1.0 (2026-07-03): Decomposition Protocol gains Step 3 (Map Plan AC to WPs); Step 4 Write WP Definitions renumbered; Plan AC Coverage table added to Output Template; quality checklist item added for full AC coverage
  1.0.7 (2026-06-04): Minor output format tweaks
  1.0.6 (2026-06-03): Minor refinements
  1.0.5 (2026-05-19): Added Plan Context, Rationale, Rejected Approaches; improved handoff
  1.0.4 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — plan decomposition into atomic WP definitions

tools:
  - read
  - edit
  - search

# overview metadata
identity: "Technical Program Manager — Work Package Analyst"
use_when: "Invoked by the Project Manager to break a plan into implementable Work Packages"
key_behavior: |
  Ensures WPs are atomic, self-contained, and properly scoped for single-session completion

```
###  Path: `/personas/ledger-support/src/meta/standalone-archiver.yaml`

```yaml
slug: standalone-archiver
name: "Ledger Standalone Archiver"
description: "Import a completed standalone plan folder into the project ledger for archival and project history, or update the ledger when the user has edited synthesis.md after archival."
vs_file_name: standalone-archiver.agent.md
id: ledger-support-standalone-archiver
cc_file_name: standalone-archiver.md
changelog: |
  1.7.0 (2026-08-21): Exclude insights.jsonl from import sources and archived-file reporting alongside scenario-coverage.md
  1.6.0 (2026-08-18): Preserve optional usage-scenarios.md source companions while excluding generated scenario-coverage.md from standalone archival
  1.5.0 (2026-07-16): Extracted summary-crafting guidelines to shared partial
  1.4.0 (2026-07-13): Audit compliance — added Operating Modes section (Import/Update); split workflow into mode-specific sections; added constraint alternatives; renamed MCP Tools to MCP Server Tools
  1.3.0 (2026-07-13): Added ledger_update_synthesis tool for updating synthesis after post-import edits
  1.2.0 (2026-07-03): Added read and edit tools for synthesis.md archival date stamp
  1.1.0 (2026-07-03): Audit compliance — added Strict Constraints section, Capabilities sub-section, handoff block; removed separators and meta-commentary; refactored workflow to numbered list format
  1.0.2 (2026-07-03): After successful import, stamp "Archived in Ledger: YYYY-MM-DD" into synthesis.md Completion Status section
  1.0.1 (2026-07-03): Renamed to Ledger Standalone Archiver for consistency with other ledger-support agents
  1.0.0 (2026-07-01): Initial release — import standalone plan folders into the ledger via ledger_import_standalone

tools:
  - read
  - edit
  - central_pm/ledger_import_standalone
  - central_pm/ledger_update_synthesis

# overview metadata
identity: "Ledger Archivist"
use_when: "A standalone plan has been completed and should be tracked in the project ledger for historical reference"
modes: |
  Import
  Update

```