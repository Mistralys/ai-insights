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
                └── ledger-orchestrator-runner.yaml
                └── ledger-pipeline-configurator.yaml
                └── ledger-wp-decomposer.yaml

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
  1.1.0 (2026-05-19): WP spec template carries all draft fields verbatim; no summarization
  1.0.0 (2026-03-16): Initial release — ledger WP initialization via MCP tools

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - central_pm/*

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
  1.0.4 (2026-05-18): Gains missing write step; subagent handoff precision improved
  1.0.3 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — Work Package dependency mapping and ordering

tools:
  - read
  - edit
  - search

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
  1.0.2 (2026-05-18): Write step references Output Location; subagent handoff precision improved
  1.0.1 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — pipeline stage activation per Work Package type

tools:
  - read
  - edit
  - search

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
  1.0.7 (2026-06-04): Minor output format tweaks
  1.0.6 (2026-06-03): Minor refinements
  1.0.5 (2026-05-19): Added Plan Context, Rationale, Rejected Approaches; improved handoff
  1.0.4 (2026-04-30): Overall improvements
  1.0.0 (2026-04-11): Initial release — plan decomposition into atomic WP definitions

tools:
  - read
  - edit
  - search

```