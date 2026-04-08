# Personas - Standalone Metadata
_SOURCE: YAML metadata for all 16 standalone personas (shared defaults + per-persona overrides)_
# YAML metadata for all 16 standalone personas (shared defaults + per-persona overrides)
```
// Structure of documents
└── personas/
    └── standalone/
        └── src/
            └── meta/
                └── _shared.yaml
                └── agents-md-curator.yaml
                └── changelog-curator.yaml
                └── composer-curator.yaml
                └── ctx-architect.yaml
                └── dependency-sequencer.yaml
                └── developer.yaml
                └── ledger-bootstrapper.yaml
                └── manifest-curator.yaml
                └── module-intent-architect.yaml
                └── orchestrator-runner.yaml
                └── pipeline-configurator.yaml
                └── readme-curator.yaml
                └── researcher.yaml
                └── unit-test-auditor.yaml
                └── whatsnew-curator.yaml
                └── workflow-doctor.yaml
                └── workflow-orchestrator.yaml
                └── wp-decomposer.yaml

```
###  Path: `/personas/standalone/src/meta/_shared.yaml`

```yaml
author: Sebastian Mordziol
last_updated: "2026-02-23"
default_version: "1.0.0"
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
###  Path: `/personas/standalone/src/meta/agents-md-curator.yaml`

```yaml
slug: agents-md-curator
name: "AGENTS.md Curator"
description: "Generate, update, and maintain AGENTS.md files — the operating manual for AI agents entering a codebase."
vs_file_name: agents-md-curator.agent.md
id: standalone-agents-md-curator
cc_file_name: agents-md-curator.md
version: "1.1.0"
last_updated: "2026-03-20"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/changelog-curator.yaml`

```yaml
slug: changelog-curator
name: "Changelog Curator"
description: "Produce clean, scannable changelogs from Git history or rewrite verbose agent-generated entries into a concise house style."
vs_file_name: changelog-curator.agent.md
id: standalone-changelog-curator
cc_file_name: changelog-curator.md
version: "1.1.1"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/composer-curator.yaml`

```yaml
slug: composer-curator
name: "Composer Curator"
description: "Verify that the project's composer.json file is set up correctly for agentic coding."
vs_file_name: composer-curator.agent.md
id: standalone-composer-curator
cc_file_name: composer-curator.md
version: "1.0.1"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/ctx-architect.yaml`

```yaml
slug: ctx-architect
name: "CTX Architect"
description: "Design, generate, and maintain CTX Generator context documentation configurations — from root project setup to per-module configs."
vs_file_name: ctx-architect.agent.md
id: standalone-ctx-architect
cc_file_name: ctx-architect.md
version: "1.1.1"
last_updated: "2026-04-08"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

cc_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
  - WebFetch
  - WebSearch

```
###  Path: `/personas/standalone/src/meta/dependency-sequencer.yaml`

```yaml
slug: dependency-sequencer
name: "Dependency Sequencer"
description: "Map dependencies between Work Packages, identify parallelization opportunities, and determine optimal execution ordering."
vs_file_name: dependency-sequencer.agent.md
id: standalone-dependency-sequencer
cc_file_name: dependency-sequencer.md
version: "1.0.0"
last_updated: "2026-03-14"

tools:
  - read
  - edit
  - search

```
###  Path: `/personas/standalone/src/meta/developer.yaml`

```yaml
slug: developer-standalone
name: "Developer (Standalone)"
description: "Implement scoped plan documents without ledger workflow, including code insights and end-of-plan synthesis."
vs_file_name: developer-standalone.agent.md
id: developer-standalone
cc_file_name: developer-standalone.md
version: "1.0.0"
last_updated: "2026-03-29"

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
  - TodoRead
  - TodoWrite

```
###  Path: `/personas/standalone/src/meta/ledger-bootstrapper.yaml`

```yaml
slug: ledger-bootstrapper
name: "Ledger Bootstrapper"
description: "Mechanically initialize the project ledger: create all Work Package entries via MCP tools and verify the setup is complete."
vs_file_name: ledger-bootstrapper.agent.md
id: standalone-ledger-bootstrapper
cc_file_name: ledger-bootstrapper.md
version: "1.0.0"
last_updated: "2026-03-14"
mcp_server_name: central_pm

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - central_pm/*

```
###  Path: `/personas/standalone/src/meta/manifest-curator.yaml`

```yaml
slug: manifest-curator
name: "Manifest Curator"
description: "Create, update, and audit project manifests — the source of truth for AI agent sessions."
vs_file_name: manifest-curator.agent.md
id: standalone-manifest-curator
cc_file_name: manifest-curator.md
version: "1.0.4"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/module-intent-architect.yaml`

```yaml
slug: module-intent-architect
name: "Module Intent Architect"
description: "Infers and documents the purpose, role, and dependencies of specific code modules by analyzing the source."
vs_file_name: module-intent-architect.agent.md
id: standalone-module-intent-architect
cc_file_name: module-intent-architect.md
version: "1.0.3"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent

# cc_tools differs from default: module-intent-architect has no TodoRead/TodoWrite
cc_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
  - WebFetch
  - WebSearch

```
###  Path: `/personas/standalone/src/meta/orchestrator-runner.yaml`

```yaml
slug: orchestrator-runner
name: "Orchestrator Runner"
description: "Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run from a plan document."
vs_file_name: orchestrator-runner.agent.md
id: standalone-orchestrator-runner
cc_file_name: orchestrator-runner.md
version: "1.5.1"
last_updated: "2026-03-26"

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
###  Path: `/personas/standalone/src/meta/pipeline-configurator.yaml`

```yaml
slug: pipeline-configurator
name: "Pipeline Configurator"
description: "Determine which pipeline stages should be active for each Work Package based on the nature of the work."
vs_file_name: pipeline-configurator.agent.md
id: standalone-pipeline-configurator
cc_file_name: pipeline-configurator.md
version: "1.0.0"
last_updated: "2026-03-14"

tools:
  - read
  - edit
  - search

```
###  Path: `/personas/standalone/src/meta/readme-curator.yaml`

```yaml
slug: readme-curator
name: "README Curator"
description: "Produces a human‑optimized README.md that follows a landing‑page funnel: Hook → Features → Requirements → Quick Start → Learn More."
vs_file_name: readme-curator.agent.md
id: standalone-readme-curator
cc_file_name: readme-curator.md
version: "1.2.2"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/researcher.yaml`

```yaml
slug: researcher
name: "Researcher"
description: "Research solutions to complex problems through known patterns or creative thinking."
vs_file_name: researcher.agent.md
id: standalone-researcher
cc_file_name: researcher.md
version: "1.0.2"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/unit-test-auditor.yaml`

```yaml
slug: unit-test-auditor
name: "Unit Test Auditor"
description: "Audit unit test coverage of specific codebase modules — identify untested paths, weak assertions, and missing edge cases."
vs_file_name: unit-test-auditor.agent.md
id: standalone-unit-test-auditor
cc_file_name: unit-test-auditor.md
version: "1.0.2"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/whatsnew-curator.yaml`

```yaml
slug: whatsnew-curator
name: "WHATSNEW Curator"
description: "Write bilingual WHATSNEW.xml release note entries from the developer changelog, filtering to user-facing changes only."
vs_file_name: whatsnew-curator.agent.md
id: standalone-whatsnew-curator
cc_file_name: whatsnew-curator.md
version: "1.0.1"
last_updated: "2026-03-04"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/workflow-doctor.yaml`

```yaml
slug: workflow-doctor
name: "Workflow Doctor"
description: "Audit and repair ledger workflow projects: diagnose deadlocks, fix state corruption, unlock stalled pipelines, and resolve technical issues."
vs_file_name: workflow-doctor.agent.md
id: standalone-workflow-doctor
cc_file_name: workflow-doctor.md
version: "1.0.0"
last_updated: "2026-03-28"
mcp_server_name: central_pm

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
###  Path: `/personas/standalone/src/meta/workflow-orchestrator.yaml`

```yaml
slug: workflow-orchestrator
name: "Workflow Orchestrator"
description: "Coordinate the multi-stage agentic pipeline by consulting the central_pm ledger and dispatching work to the correct sub-agent."
vs_file_name: workflow-orchestrator.agent.md
id: standalone-workflow-orchestrator
cc_file_name: workflow-orchestrator.md
version: "1.0.0"
last_updated: "2026-03-19"
mcp_server_name: central_pm

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
###  Path: `/personas/standalone/src/meta/wp-decomposer.yaml`

```yaml
slug: wp-decomposer
name: "WP Decomposer"
description: "Analyze a plan document and decompose it into atomic, actionable Work Package definitions."
vs_file_name: wp-decomposer.agent.md
id: standalone-wp-decomposer
cc_file_name: wp-decomposer.md
version: "1.0.0"
last_updated: "2026-03-14"

tools:
  - read
  - edit
  - search

```