# Personas - Standalone Metadata
<INSTRUCTION>
# Personas - Standalone Persona Metadata
YAML metadata for all standalone personas: shared defaults (_shared.yaml) and per-persona overrides - model slug, slugs, descriptions, and feature flags.
</INSTRUCTION>
------------------------------------------------------------
_SOURCE: YAML metadata for all 25 standalone personas (shared defaults + per-persona overrides)_
# YAML metadata for all 25 standalone personas (shared defaults + per-persona overrides)
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
                └── developer.yaml
                └── documentation-curator.yaml
                └── git-committer.yaml
                └── ledger-bootstrapper.yaml
                └── ledger-claude-coordinator.yaml
                └── ledger-dependency-sequencer.yaml
                └── ledger-doctor.yaml
                └── ledger-orchestrator-runner.yaml
                └── ledger-pipeline-configurator.yaml
                └── ledger-wp-decomposer.yaml
                └── manifest-curator.yaml
                └── module-intent-architect.yaml
                └── persona-curator.yaml
                └── plan-architect-reviewer.yaml
                └── plan-auditor.yaml
                └── plan-refiner.yaml
                └── readme-curator.yaml
                └── researcher.yaml
                └── standalone-knowledge-archiver.yaml
                └── unit-test-auditor.yaml
                └── whatsnew-curator.yaml

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
version: "1.2.0"
last_updated: "2026-04-30"

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
version: "1.2.0"
last_updated: "2026-05-27"

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
###  Path: `/personas/standalone/src/meta/developer.yaml`

```yaml
slug: developer-standalone
name: "Developer (Standalone)"
description: "Implement scoped plan documents without ledger workflow, including code insights and end-of-plan synthesis."
vs_file_name: developer-standalone.agent.md
id: developer-standalone
cc_file_name: developer-standalone.md
version: "1.1.0"
last_updated: "2026-05-29"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - browser
  - todo

cc_tools:
  - Bash
  - Read
  - Edit
  - Grep
  - TodoRead
  - TodoWrite

```
###  Path: `/personas/standalone/src/meta/documentation-curator.yaml`

```yaml
slug: documentation-curator
name: "Documentation (Standalone)"
description: "Analyze codebase changes, identify documentation gaps, and update READMEs, API references, and architecture guides to stay in sync with the code."
vs_file_name: documentation-curator.agent.md
id: standalone-documentation-curator
cc_file_name: documentation-curator.md
version: "1.0.0"
last_updated: "2026-04-30"

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
###  Path: `/personas/standalone/src/meta/git-committer.yaml`

```yaml
slug: git-committer
name: "Git Committer"
description: "Analyze uncommitted changes and organize them into comprehensive, categorized commits with plan traceability."
vs_file_name: git-committer.agent.md
id: standalone-git-committer
cc_file_name: git-committer.md
version: "1.0.5"
last_updated: "2026-06-03"

tools:
  - vscode
  - execute
  - read
  - search

cc_tools:
  - Bash
  - Read
  - Grep
  - Glob

```
###  Path: `/personas/standalone/src/meta/ledger-bootstrapper.yaml`

```yaml
slug: ledger-bootstrapper
name: "Ledger Bootstrapper"
description: "Mechanically initialize the project ledger: create all Work Package entries via MCP tools and verify the setup is complete."
vs_file_name: ledger-bootstrapper.agent.md
id: standalone-ledger-bootstrapper
cc_file_name: ledger-bootstrapper.md
version: "1.1.0"
last_updated: "2026-05-19"
mcp_server_name: central_pm

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - central_pm/*

```
###  Path: `/personas/standalone/src/meta/ledger-claude-coordinator.yaml`

```yaml
slug: ledger-claude-coordinator
name: "Ledger Claude Coordinator"
description: "Coordinate the multi-stage agentic pipeline by consulting the central_pm ledger and dispatching work to the correct sub-agent."
vs_file_name: ledger-claude-coordinator.agent.md
id: standalone-ledger-claude-coordinator
cc_file_name: ledger-claude-coordinator.md
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
###  Path: `/personas/standalone/src/meta/ledger-dependency-sequencer.yaml`

```yaml
slug: ledger-dependency-sequencer
name: "Ledger Dependency Sequencer"
description: "Map dependencies between Work Packages, identify parallelization opportunities, and determine optimal execution ordering."
vs_file_name: ledger-dependency-sequencer.agent.md
id: standalone-ledger-dependency-sequencer
cc_file_name: ledger-dependency-sequencer.md
version: "1.0.4"
last_updated: "2026-05-18"

tools:
  - read
  - edit
  - search

```
###  Path: `/personas/standalone/src/meta/ledger-doctor.yaml`

```yaml
slug: ledger-doctor
name: "Ledger Doctor"
description: "Audit and repair ledger workflow projects: diagnose deadlocks, fix state corruption, unlock stalled pipelines, and resolve technical issues."
vs_file_name: ledger-doctor.agent.md
id: standalone-ledger-doctor
cc_file_name: ledger-doctor.md
version: "1.3.0"
last_updated: "2026-06-04"
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
###  Path: `/personas/standalone/src/meta/ledger-orchestrator-runner.yaml`

```yaml
slug: ledger-orchestrator-runner
name: "Ledger Orchestrator Runner"
description: "Pre-flight checks, launch, and monitor an AI Insights orchestrator workflow run from a plan document."
vs_file_name: ledger-orchestrator-runner.agent.md
id: standalone-ledger-orchestrator-runner
cc_file_name: ledger-orchestrator-runner.md
da_file_name: ledger-orchestrator-runner.md
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
###  Path: `/personas/standalone/src/meta/ledger-pipeline-configurator.yaml`

```yaml
slug: ledger-pipeline-configurator
name: "Ledger Pipeline Configurator"
description: "Determine which pipeline stages should be active for each Work Package based on the nature of the work."
vs_file_name: ledger-pipeline-configurator.agent.md
id: standalone-ledger-pipeline-configurator
cc_file_name: ledger-pipeline-configurator.md
version: "1.0.2"
last_updated: "2026-05-18"

tools:
  - read
  - edit
  - search

```
###  Path: `/personas/standalone/src/meta/ledger-wp-decomposer.yaml`

```yaml
slug: ledger-wp-decomposer
name: "Ledger WP Decomposer"
description: "Analyze a plan document and decompose it into atomic, actionable Work Package definitions."
vs_file_name: ledger-wp-decomposer.agent.md
id: standalone-ledger-wp-decomposer
cc_file_name: ledger-wp-decomposer.md
version: "1.0.7"
last_updated: "2026-06-04"

tools:
  - read
  - edit
  - search

```
###  Path: `/personas/standalone/src/meta/manifest-curator.yaml`

```yaml
slug: manifest-curator
name: "Manifest Curator"
description: "Create, update, and audit project manifests — the source of truth for AI agent sessions."
vs_file_name: manifest-curator.agent.md
id: standalone-manifest-curator
cc_file_name: manifest-curator.md
version: "1.0.6"
last_updated: "2026-04-30"

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
  - todo

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
###  Path: `/personas/standalone/src/meta/persona-curator.yaml`

```yaml
slug: persona-curator
name: "Persona Curator"
description: "Create, audit, and maintain AI agent personas according to the Persona Design Guide."
vs_file_name: persona-curator.agent.md
id: standalone-persona-curator
cc_file_name: persona-curator.md
version: "1.1.0"
last_updated: "2026-04-29"

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
###  Path: `/personas/standalone/src/meta/plan-architect-reviewer.yaml`

```yaml
slug: plan-architect-reviewer
name: "Plan Architect Reviewer"
description: "Advisory architectural review of technical plans — challenges design shape, surfaces simplifications, and proposes ecosystem-level alternatives. Runs in parallel with the Plan Auditor; never blocks."
vs_file_name: plan-architect-reviewer.agent.md
id: standalone-plan-architect-reviewer
cc_file_name: plan-architect-reviewer.md
version: "1.5.0"
last_updated: "2026-05-29"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - browser
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/plan-auditor.yaml`

```yaml
slug: plan-auditor
name: "Plan Auditor"
description: "Audit technical plans for technical defects — hallucinated references, missing steps, infeasible sequencing, and pattern inconsistencies. Architectural critique is delegated to the Plan Architect Reviewer."
vs_file_name: plan-auditor.agent.md
id: standalone-plan-auditor
cc_file_name: plan-auditor.md
version: "1.5.0"
last_updated: "2026-06-03"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - browser
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/plan-refiner.yaml`

```yaml
slug: plan-refiner
name: "Plan Refiner"
description: "Orchestrate iterative plan refinement: architectural review, finding integration, and repeated auditing until audit-clean or ceiling reached."
vs_file_name: plan-refiner.agent.md
id: standalone-plan-refiner
cc_file_name: plan-refiner.md
version: "1.0.4"
last_updated: "2026-05-31"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

subagents:
  - plan-architect-reviewer
  - plan-auditor

```
###  Path: `/personas/standalone/src/meta/readme-curator.yaml`

```yaml
slug: readme-curator
name: "README Curator"
description: "Produces a human‑optimized README.md that follows a landing‑page funnel: Hook → Features → Requirements → Quick Start → Learn More."
vs_file_name: readme-curator.agent.md
id: standalone-readme-curator
cc_file_name: readme-curator.md
version: "1.3.0"
last_updated: "2026-04-12"

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
version: "1.2.0"
last_updated: "2026-05-29"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - browser
  - agent
  - todo

```
###  Path: `/personas/standalone/src/meta/standalone-knowledge-archiver.yaml`

```yaml
slug: standalone-knowledge-archiver
name: "Knowledge Archiver"
description: "Extract and commit reusable knowledge from completed ledger project folders into the knowledge base."
vs_file_name: knowledge-archiver.agent.md
id: standalone-knowledge-archiver
cc_file_name: knowledge-archiver.md
version: "1.4.0"
last_updated: "2026-05-30"
mcp_server_name: central_pm

tools:
  - vscode
  - read
  - search
  - central_pm/*

```
###  Path: `/personas/standalone/src/meta/unit-test-auditor.yaml`

```yaml
slug: unit-test-auditor
name: "Unit Test Auditor"
description: "Audit unit test coverage of specific codebase modules — identify untested paths, weak assertions, and missing edge cases."
vs_file_name: unit-test-auditor.agent.md
id: standalone-unit-test-auditor
cc_file_name: unit-test-auditor.md
version: "1.1.0"
last_updated: "2026-04-30"

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