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
changelog: |
  1.2.0 (2026-07-16): Extracted summary-crafting guidelines to shared partial
  1.1.0 (2026-05-19): WP spec template carries all draft fields verbatim; no summarization
  1.0.0 (2026-03-16): Initial release — ledger WP initialization via MCP tools

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - central_pm/*

# overview metadata
identity: "Technical Program Manager — Ledger Initialization Operator"
use_when: "Invoked by the Project Manager (Stage 2) after WP definitions are ready"
key_behavior: |
  Creates the project in the ledger, registers all WPs, sets dependencies and pipeline stages, and verifies the final state matches expectations

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
changelog: |
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
  1.7.0 (2026-07-31): Philosophy rewritten with positive framing; constraint-like items moved to Strict Constraints
  1.6.0 (2026-06-09): Renamed to Ledger Knowledge Archiver; slug and name updated
  1.5.0 (2026-06-08): Gained local archiving task marker file support
  1.4.0 (2026-05-30): Fixed agent naming for correct subagent registry references
  1.3.0 (2026-05-30): Fixed slug field for proper persona registry matching
  1.2.0 (2026-05-30): Knowledge collection delegation from Synthesis integrated
  1.1.0 (2026-05-30): Refined operational protocol
  1.0.0 (2026-05-29): Initial release — retrospective knowledge extraction from completed projects

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
  1.2.0 (2026-06-09): Deletions now require user confirmation before execution
  1.0.0 (2026-06-09): Initial release — knowledge base auditing and curation

tools:
  - vscode
  - read
  - search
  - central_pm/*

# overview metadata
identity: "Knowledge Base Librarian"
use_when: "The knowledge base has grown and needs quality review — removing low-value entries, merging duplicates, improving clarity"
modes: |
  Global Maintenance
  Project Maintenance

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
changelog: |
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
changelog: |
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