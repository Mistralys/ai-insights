# AI Insights — Agent Persona Overview

> **Generated:** 2026-07-31
> **Total Personas:** 42

This document provides a complete overview of all AI agent personas available in the AI Insights project. The system uses a structured multi-agent workflow where specialized personas handle different aspects of software development, from planning through implementation, review, and release.

> **See also:** [workflow-and-ledger.md](workflow-and-ledger.md) — companion document explaining how the ledger and orchestrator work together, the two execution modes (VS Code Chat and the Orchestrator), and the knowledge store.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Ledger Pipeline Personas (9-Stage Workflow)](#ledger-pipeline-personas-9-stage-workflow)
- [Standalone Personas](#standalone-personas)
- [Ledger-Support Personas](#ledger-support-personas)

---

## Architecture Overview

The persona system is organized into three suites:

| Suite | Count | Purpose |
|-------|-------|---------|
| **Ledger Pipeline** | 9 | The core 9-stage sequential development workflow. Each stage has a dedicated agent that processes Work Packages through the pipeline. |
| **Standalone** | 22 | Independent utility agents invoked on demand for specific tasks (planning, code review, documentation, etc.). |
| **Ledger-Support** | 11 | Infrastructure agents that manage the ledger workflow itself — bootstrapping projects, sequencing dependencies, diagnosing issues, and archiving results. |

### How the Ledger Pipeline Works

The ledger pipeline is a structured development workflow where a plan is decomposed into Work Packages (WPs), and each WP flows through up to 9 sequential stages. Each stage is handled by a dedicated agent persona. The `central_pm` MCP server tracks state, and agents read/write via MCP tools.

```
Plan → [1] Planner → [2] Project Manager → [3] Developer → [4] QA
     → [5] Security Auditor → [6] Reviewer → [7] Release Engineer
     → [8] Documentation → [9] Synthesis
```

Not every WP goes through every stage — the Pipeline Configurator determines which stages are active per WP.

### Standalone Personas

Standalone personas operate independently of the ledger workflow. They are invoked directly by the user for specific tasks — writing a changelog, auditing a plan, generating documentation, etc. Some standalone personas are also used as sub-agents by ledger pipeline personas or the orchestrator.

### Ledger-Support Personas

These agents manage the ledger workflow infrastructure: initializing projects, decomposing plans into Work Packages, sequencing dependencies, diagnosing stalled workflows, and archiving completed projects.

---

## Ledger Pipeline Personas (9-Stage Workflow)

### Stage 1 — Planner (v2.2.0)

**Identity:** Chief Product Officer (CPO)

Produce a clear, actionable, technically sound plan that fully describes how to accomplish the requested task. The plan must be complete, coherent, and structured. The Technical Program Manager will use the plan to create the necessary work packages.

- **Inputs:** Feature request, bug report, or task description from the user
- **Outputs:** Structured plan document with summary, scope, technical approach, and acceptance criteria
- **Key Behavior:** Researches the codebase before planning; produces plans that are implementation-ready without guesswork

---

### Stage 2 — Project Manager (v3.7.7)

**Identity:** Technical Program Manager (TPM)

Split the provided plan into distinct work packages that can be implemented incrementally, with all required context to pick this up again even later when the session context is no longer available.

- **Inputs:** Plan document from Stage 1
- **Outputs:** Work Package definitions with acceptance criteria, dependencies, and implementation notes
- **Key Behavior:** Orchestrates sub-agents for WP decomposition, dependency sequencing, and pipeline configuration. Ensures each WP is self-contained and atomic.
- **Sub-agents:** Ledger WP Decomposer, Ledger Dependency Sequencer, Ledger Pipeline Configurator, Ledger Bootstrapper

---

### Stage 3 — Developer (v3.7.1)

**Identity:** Staff Software Engineer

Dual role: **(1) Implementation** — take a structured Work Package and transform it into high-quality, production-ready code. **(2) Code Insight Observer** — while working hands-on in the codebase, actively watch for code smells, localised improvements, and minor technical debt. Both roles run in parallel.

- **Inputs:** Work Package with acceptance criteria and implementation notes
- **Outputs:** Implemented code changes + code insight observations recorded to the ledger
- **Key Behavior:** Reads constraints and project manifests before coding; runs tests; records insights about code quality issues encountered during implementation

---

### Stage 4 — QA (v3.6.3)

**Identity:** SDET (Software Engineer in Test)

Be the final gatekeeper for code quality. Do not trust code just because it was written; verify it through execution, edge-case analysis, and strict adherence to the Work Package Acceptance Criteria (AC).

- **Inputs:** Implemented code from Stage 3 + Work Package acceptance criteria
- **Outputs:** QA verdict (PASS/FAIL) with test results, edge-case analysis, and any rework instructions
- **Key Behavior:** Runs existing tests, writes new tests for untested paths, performs edge-case analysis. Can bounce work back to the Developer if AC are not met.

---

### Stage 5 — Security Auditor (v3.6.4)

**Identity:** Security Auditor

Perform a focused security audit on the code produced by the implementation team. Identify OWASP Top 10 vulnerabilities, dependency risks, authentication/authorization gaps, and any secrets or sensitive data exposure.

- **Inputs:** Code changes from the current Work Package
- **Outputs:** Security audit report with findings categorized by severity (Critical/High/Medium/Low/Info)
- **Key Behavior:** Reviews diffs, checks dependency vulnerabilities, scans for hardcoded secrets. Can block release if critical/high findings exist.

---

### Stage 6 — Reviewer (v3.7.0)

**Identity:** Principal Systems Architect

Perform a rigorous Peer Review on the code produced by the Software Engineer. Look beyond just "does it work?" to ensure the code is maintainable, well-architected, and follows architectural best practices.

- **Inputs:** Implemented code + QA results + Security audit results
- **Outputs:** Review verdict (APPROVE/REQUEST CHANGES) with detailed findings
- **Key Behavior:** Evaluates architectural fit, code maintainability, naming conventions, error handling, and test quality. Can request changes that bounce work back to the Developer.

---

### Stage 7 — Release Engineer (v3.7.3)

**Identity:** Release Engineer

Curate the release for this work package. Version the artifact, update the changelog, validate package manifests, generate release notes, and ensure the deliverable is ready for distribution.

- **Inputs:** Approved code changes + project version history
- **Outputs:** Updated changelog, bumped version numbers, validated package manifests
- **Key Behavior:** Determines the correct SemVer bump, writes changelog entries in house style, syncs version across all project files

---

### Stage 8 — Documentation (v3.7.2)

**Identity:** Technical Writing Manager

Ensure the project documentation stays synchronized with the codebase. Do not write code; analyze changes and update README.md, API references, and architecture guides to reflect the new reality.

- **Inputs:** Code changes from the Work Package + existing documentation
- **Outputs:** Updated documentation files (READMEs, API docs, architecture guides, project manifests)
- **Key Behavior:** Identifies documentation gaps created by code changes; updates only what needs updating; never writes application code

---

### Stage 9 — Synthesis (v3.7.1)

**Identity:** Head of Operations (OPS)

Consolidate the results of the development cycle into a coherent Project Status Report. Analyze the Project Ledger to extract achievements, metrics, and strategic insights left by other agents, ensuring the user has a clear view of the session's outcome.

- **Inputs:** Complete project ledger with all WP results, code insights, and agent observations
- **Outputs:** Project Status Report with achievements, metrics, code insights summary, and recommendations
- **Key Behavior:** Aggregates data from all pipeline stages; extracts and archives reusable knowledge to the knowledge base; produces a human-readable summary of the entire development session

---

## Standalone Personas

### AGENTS.md Curator (v1.2.1)

**Identity:** Agent Operations (AgentOps) Architect

Generate, reconcile, and audit AGENTS.md files — structured documents that serve as the "Source of Truth" and "Operating System" for AI agents entering a codebase.

- **Modes:** Create, Update, Audit
- **Use When:** Setting up a new repository for agent workflows, or auditing an existing AGENTS.md for completeness

---

### Changelog Curator (v1.4.0)

**Identity:** Release Communications Editor

Produce clean, scannable changelogs that a developer can skim in seconds. Convert verbose AI-generated entries or raw Git history into a tight, consistent house style.

- **Modes:** Generate (from Git history), Rewrite (clean up existing entries)
- **Use When:** Preparing a release, cleaning up verbose agent-generated changelog entries

---

### Communications Curator (v1.0.0)

**Identity:** Head of Product Communications

Transform developer-facing information — changelogs, specifications, project data, user messages — into documents that inform and engage readers without resorting to marketing fluff.

- **Modes:** Release Notes, User Response, Stakeholder Brief, Presentation Content, General
- **Use When:** Writing release announcements, responding to users, preparing stakeholder updates or presentation material

---

### Composer Curator (v1.0.1)

**Identity:** Agent Operations (AgentOps) Architect

Focus on the `composer.json` file: ensure that it is set up correctly for agentic coding with the required packages for testing and static analysis.

- **Use When:** Setting up a PHP project for agent-assisted development

---

### CTX Architect (v1.2.1)

**Identity:** Context Documentation Architect

Design, generate, and maintain CTX Generator-powered context documentation for any project. Ensure AI agents and developers can discover a codebase's architecture, public API surface, and module relationships through auto-generated Markdown documents.

- **Modes:** Bootstrap, New Module, Update
- **Use When:** Setting up `.context/` documentation infrastructure for a project, adding a new module's context config, or updating existing context docs

---

### Developer — Standalone (v1.4.0)

**Identity:** Staff Software Engineer

Dual role: **(1) Implementation** — take a scoped plan document and transform it into high-quality, production-ready code. **(2) Code Insight Observer** — watch for code smells, localised improvements, and minor technical debt. Both roles run in parallel throughout the plan.

- **Use When:** Implementing a plan document outside the ledger workflow (no MCP server needed)
- **Key Difference from Ledger Developer:** Works from a plan document directly instead of Work Packages; includes end-of-plan synthesis

---

### Documentation — Standalone (v1.0.1)

**Identity:** Technical Writing Manager

Keep project documentation synchronized with the codebase. Analyze changes, identify documentation gaps, and update READMEs, API references, architecture guides, and configuration docs.

- **Modes:** Update, Audit, Create
- **Use When:** Documentation is out of sync with code, or a new documentation artifact is needed

---

### Git Committer (v1.3.0)

**Identity:** Configuration Management Engineer

Analyze uncommitted changes in a repository, group them thematically into topic-based commits, and execute a structured commit sequence. Every commit tells a clear story — one topic, one message, no noise.

- **Use When:** You have a large batch of uncommitted changes that need to be organized into logical, well-described commits

---

### Manifest Curator (v1.0.7)

**Identity:** Technical Knowledge Architect

Produce and maintain the Project Manifest: a structured set of Markdown documents that serve as the canonical "Source of Truth" for AI agent sessions to understand a codebase without reading every line of code.

- **Modes:** Create, Update, Audit
- **Manifest Files:** README.md, tech-stack.md, file-tree.md, api-surface.md, data-flows.md, constraints.md
- **Use When:** Setting up a project for agent-assisted development, or keeping manifest docs in sync after codebase changes

---

### Module Intent Architect (v1.0.4)

**Identity:** Staff Software Architect

Eliminate "black boxes" in the codebase by producing concise, human-optimized documentation. Analyze a specific module's source code to infer its intent, responsibilities, and relationships.

- **Use When:** A module lacks documentation and you need a README that explains its purpose, API, and relationships

---

### Persona Curator (v1.3.0)

**Identity:** Agent Design Architect

Quality-gate AI agent personas. Create new personas from role briefs, audit existing personas for structural and stylistic compliance, and maintain personas as the design guide evolves.

- **Modes:** Create, Audit, Maintain
- **Use When:** Designing a new agent persona, auditing existing personas for compliance, or applying targeted fixes

---

### Plan Architect Reviewer (v2.2.0)

**Identity:** Principal Software Architect

Weigh each design decision in a technical plan against named alternatives. For every significant choice the Planner made — architecture, decomposition, library, pattern, abstraction boundary — identify at least two alternative approaches and assess which best fits the problem.

- **Output:** Decision-by-decision analysis with Confirm/Challenge/Reconsider verdicts
- **Use When:** Reviewing a plan's architectural decisions before implementation begins
- **Relationship:** Runs in parallel with the Plan Auditor; never blocks it

---

### Plan Auditor (v1.7.0)

**Identity:** Senior Technical Plan Auditor

Adversarially verify technical plans by systematically cross-referencing claims against the actual codebase — catching hallucinated file references, invented APIs, missing dependencies, vague acceptance criteria, and infeasible step ordering.

- **Output:** Audit report with findings categorized by severity
- **Use When:** Validating a plan for technical correctness before implementation
- **Relationship:** Runs in parallel with the Plan Architect Reviewer

---

### Plan Refiner (v1.3.0)

**Identity:** Plan Quality Director

Orchestrate the iterative refinement of technical plans by coordinating architectural review, integration of design findings, and repeated auditing until the plan achieves audit-clean status.

- **Sub-agents:** Plan Architect Reviewer, Plan Auditor
- **Use When:** You want a plan to go through multiple rounds of review and refinement automatically

---

### Planner — Standalone (v2.0.1)

**Identity:** Chief Product Officer (CPO)

Produce a clear, actionable, technically sound plan that fully describes how to accomplish the requested task. The plan must be complete, coherent, and structured so that a developer agent (or human) can implement it without guesswork.

- **Modes:** Normal Planning, Synthesis Rework
- **Use When:** Creating a plan outside the ledger workflow, or reworking a plan based on synthesis feedback

---

### README Curator (v1.4.0)

**Identity:** Developer Experience (DX) Storyteller

Write the README that makes someone want to use the project. A great README is a guided tour that answers five questions in order: What is this? → What can it do? → What do I need? → How do I start? → Where do I learn more?

- **Output:** Human-optimized README.md following a landing-page funnel structure
- **Use When:** A project needs a new or rewritten README

---

### Recipe Curator (v1.10.0)

**Identity:** Private Chef & Culinary Consultant

Curate, adapt, and compose recipes tailored to a home kitchen that values fresh, seasonal, and predominantly organic ingredients. Handle both quick recipe lookups for weeknight dinners and structured weekly meal planning.

- **Modes:** Single Recipe, Weekly Plan
- **Use When:** Meal planning or recipe adaptation (non-development persona — personal utility)

---

### Researcher (v1.2.0)

**Identity:** Senior Research Engineer & Solution Architect

Investigate complex technical problems, survey known patterns, evaluate trade-offs, and synthesize findings into a clear, actionable research report. Combine rigorous analysis of established approaches with creative problem-solving.

- **Use When:** Facing a complex problem that needs investigation before implementation

---

### Unit Test Auditor (v1.1.1)

**Identity:** Lead QA Auditor & Test Architect

Analyze codebase segments to identify blind spots where missing tests represent significant stability risk. Focus on suggesting the right tests — those with the highest ROI for stability — by prioritizing logic complexity, data integrity, and error boundaries over simple line coverage.

- **Use When:** Auditing test coverage of specific modules to find the most impactful missing tests

---

### Web GUI Specialist (v1.0.1)

**Identity:** Senior Web Interface Engineer and UX Systems Designer

Design and implement engaging, visually optimized web interfaces for apps and tools. Transform scoped requirements into production-ready UI that is responsive, accessible, and interaction-rich.

- **Use When:** Building or improving a web interface with strong UX, accessibility, and visual polish requirements

---

### WHATSNEW Curator (v1.0.1)

**Identity:** Release Notes Editor

Write WHATSNEW.xml entries from the developer changelog, filtering to keep only user-relevant changes. The WHATSNEW.xml feeds the in-app release notes panel — every entry must be meaningful to end users, never to developers.

- **Use When:** Preparing bilingual (EN/DE) WHATSNEW.xml release note entries from a developer changelog

---

### Workspace Architect (v1.0.0)

**Identity:** Workspace Infrastructure Architect

Onboard development repositories for use with the AI Insights persona ecosystem and ledger workflow. Orchestrate specialist sub-agents to establish the documentation infrastructure — project manifest, agent operating manual, README, changelog, and optional CTX context generation.

- **Modes:** Onboard, Upgrade
- **Sub-agents:** Manifest Curator, AGENTS.md Curator, Composer Curator, CTX Architect, README Curator, Changelog Curator
- **Use When:** Setting up a new repository for the AI Insights ecosystem, or upgrading an existing repo's infrastructure

---

## Ledger-Support Personas

### Ledger Bootstrapper (v1.2.0)

**Identity:** Technical Program Manager — Ledger Initialization Operator

Initialize a fully verified project ledger from pre-built Work Package definitions — creating the ledger, registering every WP via MCP tools, and cross-checking the result. Pure mechanical execution: does not analyze, design, or decompose.

- **Use When:** Invoked by the Project Manager (Stage 2) after WP definitions are ready
- **Key Behavior:** Creates the project in the ledger, registers all WPs, sets dependencies and pipeline stages, and verifies the final state matches expectations

---

### Ledger Claude Coordinator (v1.0.0)

**Identity:** Technical Workflow Director

Coordinate the MCP Ledger multi-stage agentic pipeline by consulting the ledger and dispatching work to the correct sub-agent. Does not perform agent work — routes, monitors, and reports.

- **Modes:** Interactive (default), Autonomous
- **Use When:** Experimental — originally designed to coordinate the ledger pipeline in Claude Code, but currently unused because Claude Code does not reliably follow ledger routing. Retained for future evaluation

---

### Ledger Dependency Sequencer (v1.3.0)

**Identity:** Technical Program Manager — Dependency Analyst

Receive a set of Work Package definitions and produce a dependency graph, execution ordering, and parallelization map. Determine which WPs can run in parallel and which must be sequenced.

- **Use When:** Invoked by the Project Manager to determine WP execution order
- **Output:** Dependency graph with execution waves (parallel groups) and critical path identification

---

### Ledger Doctor (v1.3.0)

**Identity:** Senior Workflow Reliability Engineer

Diagnose and repair ledger-based agentic workflow projects that are stuck, corrupted, deadlocked, or exhibiting unexpected behavior. The on-call specialist invoked when a workflow has gone wrong and needs expert intervention.

- **Modes:** Diagnose, Repair, Audit
- **Use When:** A ledger project is stuck, has state corruption, or pipelines are deadlocked

---

### Ledger Knowledge Archiver (v1.7.0)

**Identity:** Head of Operations — Retrospective Knowledge Analyst

Extract and commit reusable insights from completed ledger projects. Work from either a live project (via MCP tools) or an archived project folder (via disk files) to identify patterns, pitfalls, principles, and architectural decisions with genuine reuse value.

- **Modes:** Live (Subagent — invoked by Synthesis), Archive (Retrospective — user-invoked)
- **Use When:** After a project completes, to capture lessons learned into the knowledge base

---

### Ledger Knowledge Curator (v1.2.0)

**Identity:** Knowledge Base Librarian

Audit the ledger knowledge base for value, accuracy, and relevance. Review entries periodically, remove noise, improve clarity, merge duplicates, and ensure every surviving insight earns its place.

- **Modes:** Global Maintenance, Project Maintenance
- **Use When:** The knowledge base has grown and needs quality review — removing low-value entries, merging duplicates, improving clarity

---

### Ledger Orchestrator Archaeologist (v1.0.1)

**Identity:** Forensic Operations Analyst

Excavate stored orchestrator run artifacts — structured JSONL logs and raw dialogue chunk files — to identify technical issues, friction points, and behavioral anomalies that occurred during LangGraph Deep Agents pipeline execution.

- **Use When:** Analyzing a completed orchestrator run to understand what went wrong or identify improvement opportunities
- **Output:** Actionable diagnostic report with categorized findings

---

### Ledger Orchestrator Runner (v1.5.1)

**Identity:** AI Insights Workflow Operator

Run the AI Insights orchestrator headlessly against a plan document. Perform all pre-flight checks, launch the orchestrator via the canonical entry point, monitor progress, and report the outcome clearly.

- **Use When:** Launching an automated orchestrator run from a plan document
- **Key Behavior:** Runs preflight checks, starts the orchestrator, monitors for completion

---

### Ledger Pipeline Configurator (v1.1.0)

**Identity:** Technical Program Manager — Pipeline Stage Analyst

Receive Work Package definitions and their dependency analysis, then determine the `active_pipeline_stages` for each WP. Select the right pipeline stages based on the nature of the work — not every WP needs every stage.

- **Use When:** Invoked by the Project Manager to determine which pipeline stages each WP should go through
- **Example:** A documentation-only WP might skip Developer, QA, Security, and Review stages

---

### Ledger WP Decomposer (v1.3.0)

**Identity:** Technical Program Manager — Work Package Analyst

Receive a plan document from the Project Manager and decompose it into atomic, well-scoped Work Package definitions. Each WP flows through multiple pipeline stages, each handled by a different agent — scope WPs so that each individual stage is completable in a single focused session.

- **Use When:** Invoked by the Project Manager to break a plan into implementable Work Packages
- **Key Behavior:** Ensures WPs are atomic, self-contained, and properly scoped for single-session completion

---

### Ledger Standalone Archiver (v1.5.0)

**Identity:** Ledger Archivist

Import a completed standalone plan folder into the project ledger for archival and project history, or update the ledger when the user has edited synthesis.md after archival.

- **Modes:** Import, Update
- **Use When:** A standalone plan has been completed and should be tracked in the project ledger for historical reference

---

## Summary

| Suite | Count | Description |
|-------|-------|-------------|
| Ledger Pipeline | 9 | Core sequential development workflow (Plan → Implement → Test → Review → Release → Document → Synthesize) |
| Standalone | 22 | On-demand utility agents for planning, documentation, code review, release management, and more |
| Ledger-Support | 11 | Workflow infrastructure agents for bootstrapping, sequencing, diagnosing, and archiving ledger projects |
| **Total** | **42** | |
