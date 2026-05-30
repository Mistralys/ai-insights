# Personas - Ledger Metadata
<INSTRUCTION>
# Personas - Ledger Persona Metadata
YAML metadata for all 9 ledger personas: shared defaults (_shared.yaml) and per-persona overrides - model slug, role name, file names, and feature flags.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: YAML metadata for all 9 ledger personas (shared defaults + per-persona overrides)_
# YAML metadata for all 9 ledger personas (shared defaults + per-persona overrides)
```
// Structure of documents
└── personas/
    └── ledger/
        └── src/
            └── meta/
                └── 1-planner.yaml
                └── 2-project-manager.yaml
                └── 3-developer.yaml
                └── 4-qa.yaml
                └── 5-security-auditor.yaml
                └── 6-reviewer.yaml
                └── 7-release-engineer.yaml
                └── 8-documentation.yaml
                └── 9-synthesis.yaml
                └── _shared.yaml

```
###  Path: `/personas/ledger/src/meta/1-planner.yaml`

```yaml
number: 1
role: Planner
model: "Claude Opus 4.6"
model_slug: "claude-opus-4-6"
vs_file_name: 1-planner.agent.md
id: ledger-1-planner
cc_file_name: 1-planner.md
da_file_name: 1-planner.md
version: "1.5.0"
last_updated: "2026-05-20"
tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

has_mcp: false
has_detect_project: false
self_documenting_note: false
has_incident_logging: false

```
###  Path: `/personas/ledger/src/meta/2-project-manager.yaml`

```yaml
number: 2
role: Project Manager
model: "Claude Opus 4.6"
model_slug: "claude-opus-4-6"
vs_file_name: 2-pm.agent.md
id: ledger-2-pm
cc_file_name: 2-project-manager.md
da_file_name: 2-project-manager.md
version: "3.7.3"
last_updated: "2026-05-19"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo
  - central_pm/*

subagents:
  - ledger-wp-decomposer
  - ledger-dependency-sequencer
  - ledger-pipeline-configurator
  - ledger-bootstrapper

has_mcp: true
has_detect_project: false
self_documenting_note: false
has_incident_logging: false

mcp_tools:
  - tool: ledger_initialize_project
    purpose: Create the root ledger for a new project.
  - tool: ledger_create_work_package
    purpose: Create a work package with auto-generated WP ID (validates dependency order).
  - tool: ledger_get_project_status
    purpose: Read the root index (self-heals incorrect counters). Use to verify the ledger after creation.
  - tool: ledger_get_handoff_status
    purpose: Compute the AGENT/STATUS handoff block at the end of your turn.

```
###  Path: `/personas/ledger/src/meta/3-developer.yaml`

```yaml
number: 3
role: Developer
vs_file_name: 3-dev.agent.md
id: ledger-3-dev
cc_file_name: 3-developer.md
da_file_name: 3-developer.md
version: "3.6.3"
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
  - central_pm/*

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get the recommended action for your role (which WP to implement, or WAIT)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `implementation` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_complete_pipeline
    purpose: "Finalize the pipeline with status, summary, artifacts, acceptance criteria updates, handoff notes for the next agent, and Code Insight Observer comments. This is the **primary tool for updating acceptance criteria**."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_add_project_comment
    purpose: "Add a project-level comment (e.g., incident reports)."
  - tool: ledger_add_observation
    purpose: "Add a Code Insight observation to a completed pipeline (use when you discover something after calling `ledger_complete_pipeline`)."
  - tool: ledger_get_work_package
    purpose: "Read full WP detail (status, pipelines, acceptance criteria)."
  - tool: ledger_search_insights
    purpose: "Search knowledge store for coding principles and patterns relevant to the current implementation."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/4-qa.yaml`

```yaml
number: 4
role: QA
vs_file_name: 4-qa.agent.md
id: ledger-4-qa
cc_file_name: 4-qa.md
da_file_name: 4-qa.md
version: "3.6.2"
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
  - central_pm/*

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`RUN_QA`, `REWORK_QA`, `CLAIM_WP`, or `WAIT`)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `qa` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_get_work_package
    purpose: Read WP detail including implementation artifacts and AC.
  - tool: ledger_complete_pipeline
    purpose: "Finalize pipeline with status, summary, metrics, comments, AC updates, and handoff notes for the next agent."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_add_project_comment
    purpose: "Add project-level comments (e.g., observations, notes)."
  - tool: ledger_search_insights
    purpose: "Search knowledge for prior findings and recurring patterns before starting verification."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/5-security-auditor.yaml`

```yaml
number: 5
role: Security Auditor
vs_file_name: 5-security-auditor.agent.md
id: ledger-5-security-auditor
cc_file_name: 5-security-auditor.md
da_file_name: 5-security-auditor.md
version: "3.6.3"
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
  - central_pm/*

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`RUN_SECURITY_AUDIT`, `REWORK`, `CLAIM_WP`, or `WAIT`)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `security-audit` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_get_work_package
    purpose: Read WP detail including implementation and QA pipeline artifacts.
  - tool: ledger_complete_pipeline
    purpose: "Finalize pipeline with status, summary, security findings, and handoff notes for the next agent."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_add_project_comment
    purpose: "Add project-level security observations or incident reports."
  - tool: ledger_search_insights
    purpose: "Search knowledge for prior findings and recurring patterns before starting verification."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/6-reviewer.yaml`

```yaml
number: 6
role: Reviewer
vs_file_name: 6-reviewer.agent.md
id: ledger-6-reviewer
cc_file_name: 6-reviewer.md
da_file_name: 6-reviewer.md
version: "3.6.1"
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
  - central_pm/*

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`RUN_REVIEW`, `CLAIM_WP`, `CONTINUE_PIPELINE`, or `WAIT`)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `code-review` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_get_work_package
    purpose: Read WP detail including implementation and QA pipeline artifacts.
  - tool: ledger_complete_pipeline
    purpose: "Finalize pipeline with status, summary, metrics, comments, and handoff notes for the next agent."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_add_project_comment
    purpose: Add project-level comments for cross-cutting architectural insights.
  - tool: ledger_search_insights
    purpose: "Search prior review findings and recurring patterns before beginning the code review."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/7-release-engineer.yaml`

```yaml
number: 7
role: Release Engineer
vs_file_name: 7-release-engineer.agent.md
id: ledger-7-release-engineer
cc_file_name: 7-release-engineer.md
da_file_name: 7-release-engineer.md
version: "3.7.2"
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
  - central_pm/*

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`RUN_RELEASE_ENGINEERING`, `REWORK`, `CLAIM_WP`, or `WAIT`)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `release-engineering` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_get_work_package
    purpose: Read WP detail including implementation, QA, and code-review pipeline artifacts.
  - tool: ledger_complete_pipeline
    purpose: "Finalize pipeline with status, summary, release artifacts, and handoff notes for the next agent."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_add_project_comment
    purpose: "Add project-level release observations or incident reports."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/8-documentation.yaml`

```yaml
number: 8
role: Documentation
vs_file_name: 8-docs.agent.md
id: ledger-8-docs
cc_file_name: 8-documentation.md
da_file_name: 8-documentation.md
version: "3.7.0"
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
  - central_pm/*

subagents:
  - ctx-architect

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`WRITE_DOCS`, `REWORK`, `FINALIZE_WP`, `UPDATE_CRITERIA`, `CLAIM_WP`, or `WAIT`)."
  - tool: ledger_begin_work
    purpose: "Claim a READY WP and start the `documentation` pipeline in a single atomic call. Replaces the two-step `ledger_claim_work_package` + `ledger_start_pipeline` sequence."
  - tool: ledger_get_work_package
    purpose: Read WP detail including implementation pipeline artifacts.
  - tool: ledger_list_work_packages
    purpose: List WP summaries, optionally filtered by status.
  - tool: ledger_complete_pipeline
    purpose: "Finalize pipeline with status, summary, comments, and handoff notes. When `status: PASS` and all acceptance criteria are met, the WP is automatically transitioned to `COMPLETE` — no separate call needed."
  - tool: ledger_cancel_pipeline
    purpose: "Cancel a stale IN_PROGRESS pipeline (use when `ledger_get_next_action` returns `RESUME_OR_CANCEL`)."
  - tool: ledger_update_work_package_status
    purpose: "Mark a WP as COMPLETE when `ledger_get_next_action` returns `FINALIZE_WP` (all criteria met, doc fresh). Only needed when auto-finalize did not fire during `ledger_complete_pipeline`."
  - tool: ledger_add_project_comment
    purpose: "Add project-level comments (e.g., incident reports)."
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/9-synthesis.yaml`

```yaml
number: 9
role: Synthesis
vs_file_name: 9-synthesis.agent.md
id: ledger-9-synthesis
cc_file_name: 9-synthesis.md
da_file_name: 9-synthesis.md
version: "3.6.0"
last_updated: "2026-05-30"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo
  - central_pm/*

subagents:
  - standalone-knowledge-archiver

has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: false

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Confirm the project is ready for synthesis (expects `GENERATE_SYNTHESIS`)."
  - tool: ledger_get_project_status
    purpose: Read the root index with project overview, WP summaries, and comments.
  - tool: ledger_list_work_packages
    purpose: List all WP summaries for iteration.
  - tool: ledger_get_work_package
    purpose: Read full WP detail including all pipelines, metrics, and comments.
  - tool: ledger_add_project_comment
    purpose: Add project-level synthesis observations.
  - tool: ledger_complete_synthesis
    purpose: "Archive the synthesis document, set `synthesis_generated: true`, and transition the project to `COMPLETE`."
  - tool: ledger_get_handoff_status
    purpose: Compute the final AGENT/STATUS handoff block.
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

```
###  Path: `/personas/ledger/src/meta/_shared.yaml`

```yaml
author: Sebastian Mordziol
last_updated: "2026-03-01 12:00"
default_version: "3.22.0"
default_model: "Claude Sonnet 4.6"    # Human-readable model name; override per-persona via `model:` field
default_model_slug: "claude-sonnet-4-6"  # API-compatible slug; override per-persona via `model_slug:` field
mcp_server_name: "central_pm"
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

roster:
  - number: 1
    title: Chief Product Officer
    short: Planning & Strategy
  - number: 2
    title: Technical Program Manager
    short: Task Decomposition & Project Management
  - number: 3
    title: Staff Software Engineer
    short: Implementation & Verification
  - number: 4
    title: SDET
    short: QA & Validation
  - number: 5
    title: Security Auditor
    short: Security Review & Threat Analysis
  - number: 6
    title: Principal Systems Architect
    short: Code Review & Quality Check
  - number: 7
    title: Release Engineer
    short: Release Curation & Version Management
  - number: 8
    title: Technical Writing Manager
    short: Documentation & README Curation
  - number: 9
    title: Head of Operations
    short: Synthesis & Project Reporting

```