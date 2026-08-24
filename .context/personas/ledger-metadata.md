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
changelog: |
  2.2.0 (2026-07-17): Recommended Workflow section added to Plan Output Template; workflow assessment persisted in plan.md
  2.1.0 (2026-07-16): Added Operating Philosophy — design for growth, no deferred quality, right abstraction first time
  2.0.0 (2026-07-15): Three-phase workflow (Scope Sketch → Research Brief → Plan) replaces interleaved research-and-plan approach; adds research-brief.md output artifact
  1.9.0 (2026-07-06): Handoff now includes RECOMMENDED_WORKFLOW field with ledger vs standalone assessment and rationale
  1.8.0 (2026-07-03): Plan Output Template Acceptance Criteria section now uses numbered AC-{NN}: prefix format with zero-padded sequential IDs and an explanatory instruction
  1.7.0 (2026-06-19): Synthesis Rework mode now triages deferred items; most valuable promoted into plan, rest preserved in Deferred Items table
  1.6.3 (2026-06-08): Content restructured; shared partials inlined; repository history access added
  1.6.0 (2026-05-19): Added standalone Planner variant (ledger version refactored accordingly)
  1.5.0 (2026-05-20): Gained Synthesis rework mode
  1.4.2 (2026-05-18): Initializes Plan Audit Cycles; updates counters during rework
  1.4.1 (2026-05-12): Gained Considered Alternatives, Pattern Alignment, Test Plan sections
  1.3.1 (2026-02-22): Added clause for naming synthesis rework plans
  1.3.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
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
has_detect_project: false
self_documenting_note: false
has_incident_logging: false

mcp_tools:
  - tool: ledger_get_repository_context
    purpose: "Retrieve the repository's strategic vision (short/mid/long-term goals) and prior project history (timeline, outcome summaries) to align planning with declared strategy."
  - tool: ledger_search_insights
    purpose: "Search the knowledge base for reusable insights and patterns relevant to the current planning request."

# overview metadata
identity: "Chief Product Officer (CPO)"
description: "Produce a clear, actionable, technically sound plan that fully describes how to accomplish the requested task. The plan must be complete, coherent, and structured. The Technical Program Manager will use the plan to create the necessary work packages."
inputs: "Feature request, bug report, or task description from the user"
outputs: "Structured plan document with summary, scope, technical approach, and acceptance criteria"
key_behavior: |
  Researches the codebase before planning; produces plans that are implementation-ready without guesswork
modes: |
  Normal Planning
  Synthesis Rework

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
changelog: |
  3.8.0 (2026-08-04): Removed Spec File Verification protocol and AC fidelity check; WP specs now live exclusively in the ledger, no work/ directory
  3.7.7 (2026-07-24): Replace ledger_help with ledger_ping in mcp_tools for MCP server reachability preflight
  3.7.6 (2026-07-06): Trimmed verbose plan-folder-date step to a concise one-liner
  3.7.5 (2026-07-06): Extracted spec file verification into Operational Protocol to reduce workflow density
  3.7.4 (2026-07-06): New step 2 renames plan folder date prefix to today before decomposition
  3.7.3 (2026-05-19): Verification gate enumerates all WP fields, catching stripped spec files
  3.7.2 (2026-04-08): Improved subagent invocations; deep-agents handoffs declare all targets
  3.5.1 (2026-02-22): Simplified preflight and verbose sections
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs

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
  - tool: ledger_ping
    purpose: Verify MCP server reachability and detect stale instances (preflight check).
  - tool: ledger_initialize_project
    purpose: Create the root ledger for a new project.
  - tool: ledger_create_work_package
    purpose: Create a work package with auto-generated WP ID (validates dependency order).
  - tool: ledger_get_project_status
    purpose: Read the root index (self-heals incorrect counters). Use to verify the ledger after creation.
  - tool: ledger_get_work_package
    purpose: Read full detail for a specific WP — used in Step 9 to compare ledger AC against spec file AC and self-heal mismatches.
  - tool: ledger_get_handoff_status
    purpose: Compute the AGENT/STATUS handoff block at the end of your turn.

# overview metadata
identity: "Technical Program Manager (TPM)"
description: "Split the provided plan into distinct work packages that can be implemented incrementally, with all required context to pick this up again even later when the session context is no longer available."
inputs: "Plan document from Stage 1"
outputs: "Work Package definitions with acceptance criteria, dependencies, and implementation notes"
key_behavior: |
  Orchestrates sub-agents for WP decomposition, dependency sequencing, and pipeline configuration. Ensures each WP is self-contained and atomic.

```
###  Path: `/personas/ledger/src/meta/3-developer.yaml`

```yaml
number: 3
role: Developer
vs_file_name: 3-dev.agent.md
id: ledger-3-dev
cc_file_name: 3-developer.md
da_file_name: 3-developer.md
changelog: |
  3.9.2 (2026-08-24): Renamed ambiguous 'How to Record Observations' heading to 'Observation Reporting Rules'
  3.9.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  3.9.0 (2026-08-24): Sink opened at session start with marker line; capture split into its own protocol step gated on each completed file edit (steps 4-5 loop); rework continuation re-gated per file
  3.8.0 (2026-08-21): Integrated insights.jsonl sidecar — capture partial after Priority Guidelines, compilation partial beside output-format, action gate in Operational Protocol step 3, rework continuation in step 6
  3.7.2 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.7.1 (2026-07-23): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  3.7.0 (2026-07-16): Added Operating Philosophy — long-term stability over expediency, assume growth, completeness over deferral
  3.6.5 (2026-07-03): Added Verbatim AC Text constraint — copy criterion strings verbatim from ledger_get_work_package when populating acceptance_criteria_updates; exact-match comparison, phantom duplicate warning
  3.6.4 (2026-06-17): Added no-stale-counts constraint via shared developer-strict-constraints partial
  3.6.3 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.6.1 (2026-02-23): Compressed overly verbose operational protocol
  3.5.2 (2026-02-22): Simplified preflight and verbose sections
  3.5.1 (2026-02-22): Added capabilities and rework sections; added observation tool
  3.5.0 (2026-02-22): Initial changelogged version — repeat-loop workflow; role scope constraints

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

insight_agent: Developer
insight_report_target: "your `ledger_complete_pipeline` comments"

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

# overview metadata
identity: "Staff Software Engineer"
description: "Dual role: (1) Implementation — take a structured Work Package and transform it into high-quality, production-ready code. (2) Code Insight Observer — while working hands-on in the codebase, actively watch for code smells, localised improvements, and minor technical debt. Both roles run in parallel."
inputs: "Work Package with acceptance criteria and implementation notes"
outputs: "Implemented code changes + code insight observations recorded to the ledger and insights.jsonl sidecar"
key_behavior: |
  Reads constraints and project manifests before coding; runs tests; records insights about code quality issues encountered during implementation

```
###  Path: `/personas/ledger/src/meta/4-qa.yaml`

```yaml
number: 4
role: QA
vs_file_name: 4-qa.agent.md
id: ledger-4-qa
cc_file_name: 4-qa.md
da_file_name: 4-qa.md
changelog: |
  3.8.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  3.8.0 (2026-08-24): Sink opened at session start with marker line as Verification Stack step 1; capture gated on each completed verification layer; rework continuation re-gated per re-verification
  3.7.0 (2026-08-21): Integrated insights.jsonl sidecar — Test Insight Observer section with scope boundaries, action gate in Verification Stack step 5, compilation beside output-format, rework continuation
  3.6.4 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.6.3 (2026-07-03): Added Verbatim AC Text step to Verification Stack — copy criterion strings verbatim from ledger_get_work_package when populating acceptance_criteria_updates; exact-match comparison, phantom duplicate warning
  3.6.2 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.5.3 (2026-02-22): Simplified preflight and verbose sections
  3.5.2 (2026-02-22): Added incident logging block and REWORK_QA handling
  3.5.1 (2026-02-22): Enabled incident logging
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs

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

insight_agent: QA
insight_report_target: "your `ledger_complete_pipeline` comments"

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

# overview metadata
identity: "SDET (Software Engineer in Test)"
description: "Be the final gatekeeper for code quality. Do not trust code just because it was written; verify it through execution, edge-case analysis, and strict adherence to the Work Package Acceptance Criteria (AC)."
inputs: "Implemented code from Stage 3 + Work Package acceptance criteria"
outputs: "QA verdict (PASS/FAIL) with test results, edge-case analysis, rework instructions, and test insight observations recorded to insights.jsonl"
key_behavior: |
  Runs existing tests, writes new tests for untested paths, performs edge-case analysis. Can bounce work back to the Developer if AC are not met.

```
###  Path: `/personas/ledger/src/meta/5-security-auditor.yaml`

```yaml
number: 5
role: Security Auditor
vs_file_name: 5-security-auditor.agent.md
id: ledger-5-security-auditor
cc_file_name: 5-security-auditor.md
da_file_name: 5-security-auditor.md
changelog: |
  3.8.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  3.8.0 (2026-08-24): Sink opened at session start with marker line as protocol step 1; capture gated on each completed audit category; protocol renumbered
  3.7.1 (2026-08-21): Removed incorrect REWORK action from workflow step 6 and tool purpose — security-audit re-engagement uses RUN_SECURITY_AUDIT
  3.7.0 (2026-08-21): Integrated insights.jsonl sidecar — Security Insight Observer section with non-blocking-only vocabulary, action gate in audit-pass step 4, compilation beside output-format
  3.6.5 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.6.4 (2026-07-06): Verbatim AC Text guidance added to operational protocol
  3.6.3 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.6.1 (2026-02-23): Initial release — OWASP A01–A10 coverage at pipeline position 5

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

insight_agent: Security Auditor
insight_report_target: "your `ledger_complete_pipeline` comments"

mcp_tools:
  - tool: ledger_get_next_action
    purpose: "Get your next task (`RUN_SECURITY_AUDIT`, `CLAIM_WP`, or `WAIT`)."
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

# overview metadata
identity: "Security Auditor"
description: "Perform a focused security audit on the code produced by the implementation team. Identify OWASP Top 10 vulnerabilities, dependency risks, authentication/authorization gaps, and any secrets or sensitive data exposure."
inputs: "Code changes from the current Work Package"
outputs: "Security audit report with findings categorized by severity (Critical/High/Medium/Low/Info) and non-blocking observations recorded to insights.jsonl"
key_behavior: |
  Reviews diffs, checks dependency vulnerabilities, scans for hardcoded secrets. Can block release if critical/high findings exist.

```
###  Path: `/personas/ledger/src/meta/6-reviewer.yaml`

```yaml
number: 6
role: Reviewer
vs_file_name: 6-reviewer.agent.md
id: ledger-6-reviewer
cc_file_name: 6-reviewer.md
da_file_name: 6-reviewer.md
changelog: |
  3.9.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  3.9.0 (2026-08-24): Sink opened at session start with marker line as protocol step 1; Deep Dive capture gated per reviewed file instead of per noticed pattern; protocol renumbered
  3.8.0 (2026-08-21): Integrated insights.jsonl sidecar — Review Insight Observer section with positive split rule, action gate in Deep Dive step 2, compilation beside output-format
  3.7.1 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.7.0 (2026-07-16): Added Operating Philosophy — long-term lens, challenge expediency, reward durable design
  3.6.2 (2026-07-06): Verbatim AC Text guidance added to operational protocol
  3.6.1 (2026-04-08): Gained ledger_search_insights for in-context lookups
  3.5.5 (2026-04-08): Three-tier feedback (Blocking, Fix-Forward, Documentation-Forward)
  3.5.4 (2026-04-08): Documentation-forward convention with named spec and priority field
  3.5.3 (2026-02-22): Removed phantom REWORK_REVIEW action; added acceptance criteria field
  3.5.2 (2026-02-22): Added incident logging block
  3.5.1 (2026-02-22): Enabled incident logging
  3.5.0 (2026-02-22): Initial changelogged version; security review delegated to Security Auditor

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

insight_agent: Reviewer
insight_report_target: "your `ledger_complete_pipeline` comments"

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

# overview metadata
identity: "Principal Systems Architect"
description: "Perform a rigorous Peer Review on the code produced by the Software Engineer. Look beyond just whether it works to ensure the code is maintainable, well-architected, and follows architectural best practices."
inputs: "Implemented code + QA results + Security audit results"
outputs: "Review verdict (APPROVE/REQUEST CHANGES) with detailed findings and review insight observations recorded to insights.jsonl"
key_behavior: |
  Evaluates architectural fit, code maintainability, naming conventions, error handling, and test quality. Can request changes that bounce work back to the Developer.

```
###  Path: `/personas/ledger/src/meta/7-release-engineer.yaml`

```yaml
number: 7
role: Release Engineer
vs_file_name: 7-release-engineer.agent.md
id: ledger-7-release-engineer
cc_file_name: 7-release-engineer.md
da_file_name: 7-release-engineer.md
changelog: |
  3.7.4 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.7.3 (2026-07-06): Verbatim AC Text guidance added to operational protocol
  3.7.2 (2026-04-08): Updated release protocol and output format documentation
  3.7.0 (2026-04-08): Delegates changelog curation to Changelog Curator; delegates CTX updates
  3.6.1 (2026-02-23): Initial release — release curation at pipeline position 7

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

# overview metadata
identity: "Release Engineer"
description: "Curate the release for this work package. Version the artifact, update the changelog, validate package manifests, generate release notes, and ensure the deliverable is ready for distribution."
inputs: "Approved code changes + project version history"
outputs: "Updated changelog, bumped version numbers, validated package manifests"
key_behavior: |
  Determines the correct SemVer bump, writes changelog entries in house style, syncs version across all project files

```
###  Path: `/personas/ledger/src/meta/8-documentation.yaml`

```yaml
number: 8
role: Documentation
vs_file_name: 8-docs.agent.md
id: ledger-8-docs
cc_file_name: 8-documentation.md
da_file_name: 8-documentation.md
changelog: |
  3.9.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  3.9.0 (2026-08-24): Sink opened at session start with marker line as protocol step 1; capture split into its own step gated on each saved document (steps 5-6 loop); rework continuation re-gated per document
  3.8.0 (2026-08-21): Integrated insights.jsonl sidecar — Documentation Insight Observer section with scope boundaries, action gate in Update step 4, compilation beside output-format, rework continuation
  3.7.3 (2026-08-04): WP input source changed from spec file to ledger_get_work_package; removed work/WP-###.md references
  3.7.2 (2026-07-06): Verbatim AC Text guidance added to operational protocol
  3.7.1 (2026-06-17): Added no-stale-counts quality guideline via shared docs-operational-protocol partial
  3.7.0 (2026-04-30): Delegates to CTX Architect sub-agent
  3.5.4 (2026-02-22): Simplified preflight and verbose sections
  3.5.3 (2026-02-22): Fixed REWORK action name; added rework handling and status tool
  3.5.2 (2026-02-22): Removed unneeded handoff status tool
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs

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

insight_agent: Documentation
insight_report_target: "your `ledger_complete_pipeline` comments"

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

# overview metadata
identity: "Technical Writing Manager"
description: "Ensure the project documentation stays synchronized with the codebase. Do not write code; analyze changes and update README.md, API references, and architecture guides to reflect the new reality."
inputs: "Code changes from the Work Package + existing documentation"
outputs: "Updated documentation files (READMEs, API docs, architecture guides, project manifests) and documentation insight observations recorded to insights.jsonl"
key_behavior: |
  Identifies documentation gaps created by code changes; updates only what needs updating; never writes application code

```
###  Path: `/personas/ledger/src/meta/9-synthesis.yaml`

```yaml
number: 9
role: Synthesis
vs_file_name: 9-synthesis.agent.md
id: ledger-9-synthesis
cc_file_name: 9-synthesis.md
da_file_name: 9-synthesis.md
insight_agent: Synthesis
insight_report_target: "the Code Insights section of `synthesis.md`"
insight_consumer_only: true

changelog: |
  3.10.0 (2026-08-24): Delegates insight curation to the shared insight-compilation partial — adds deduplication, priority elevation, no-backfill, and no-empty-sections constraints; consumer-only mode handled natively via insight_consumer_only flag
  3.9.0 (2026-08-24): Excludes session-start markers from rendered insights and uses them to distinguish agents that captured nothing from agents that never captured
  3.8.0 (2026-08-21): Integrated insights.jsonl compilation — reads all agents' entries from sink, renders Code Insights section in synthesis.md, fixed project_storage_path derivation (= plan_path, no dirname)
  3.7.2 (2026-08-04): Split single Inputs item into separate Project Overview and Work Package Detail entries
  3.7.1 (2026-07-23): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  3.7.0 (2026-06-05): Deferred items collection added to operational protocol
  3.6.0 (2026-05-29): Knowledge extraction delegated to Knowledge Archiver sub-agent
  3.5.4 (2026-02-22): Simplified preflight and verbose sections
  3.5.1 (2026-02-22): Demoted ledger help tool to note-only
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs

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
  - ledger-knowledge-archiver

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
    purpose: "Archive the synthesis document, set `synthesis_generated: true`, and transition the project to `COMPLETE`. Pass `outcome_summary` — a 2–3 sentence summary of what was accomplished, the approach taken, and any notable results or limitations. Write this summary before calling the tool."
  - tool: ledger_get_handoff_status
    purpose: Compute the final AGENT/STATUS handoff block.
  - tool: ledger_help
    note_only: true
    purpose: "Get usage documentation and examples for any ledger tool."

# overview metadata
identity: "Head of Operations (OPS)"
description: "Consolidate the results of the development cycle into a coherent Project Status Report. Analyze the Project Ledger to extract achievements, metrics, and strategic insights left by other agents, ensuring the user has a clear view of the session's outcome."
inputs: "Complete project ledger with all WP results, code insights, agent observations, and insights.jsonl sidecar"
outputs: "Project Status Report with achievements, metrics, code insights compiled from insights.jsonl, and recommendations"
key_behavior: |
  Aggregates data from all pipeline stages; extracts and archives reusable knowledge to the knowledge base; produces a human-readable summary of the entire development session

```
###  Path: `/personas/ledger/src/meta/_shared.yaml`

```yaml
author: Sebastian Mordziol
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