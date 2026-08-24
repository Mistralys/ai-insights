# Personas - Standalone Metadata
<INSTRUCTION>
# Personas - Standalone Persona Metadata
YAML metadata for all standalone personas: shared defaults (_shared.yaml) and per-persona overrides - model slug, slugs, descriptions, and feature flags.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: YAML metadata for standalone personas (shared defaults + per-persona overrides)_
# YAML metadata for standalone personas (shared defaults + per-persona overrides)
```
// Structure of documents
└── personas/
    └── standalone/
        └── src/
            └── meta/
                └── _shared.yaml
                └── agents-md-curator.yaml
                └── changelog-curator.yaml
                └── comms-curator.yaml
                └── composer-curator.yaml
                └── ctx-architect.yaml
                └── developer.yaml
                └── documentation-curator.yaml
                └── git-committer.yaml
                └── manifest-curator.yaml
                └── module-intent-architect.yaml
                └── persona-curator.yaml
                └── plan-architect-reviewer.yaml
                └── plan-auditor.yaml
                └── plan-refiner.yaml
                └── planner.yaml
                └── readme-curator.yaml
                └── recipe-curator.yaml
                └── researcher.yaml
                └── unit-test-auditor.yaml
                └── usage-scenarios-curator.yaml
                └── web-gui-specialist.yaml
                └── whatsnew-curator.yaml
                └── workspace-architect.yaml

```
###  Path: `/personas/standalone/src/meta/_shared.yaml`

```yaml
author: Sebastian Mordziol
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
changelog: |
  1.2.1 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.2.0 (2026-04-30): Comprehensive rewrite to imperative voice
  1.1.0 (2026-03-20): Creates CLAUDE.md companion file alongside AGENTS.md
  1.0.0 (2026-02-23): Initial release — operating manual generation for AI agents

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Agent Operations (AgentOps) Architect"
use_when: "Setting up a new repository for agent workflows, or auditing an existing AGENTS.md for completeness"
modes: |
  Create
  Update
  Audit

```
###  Path: `/personas/standalone/src/meta/changelog-curator.yaml`

```yaml
slug: changelog-curator
name: "Changelog Curator"
description: "Produce clean, scannable changelogs from Git history or rewrite verbose agent-generated entries into a concise house style."
vs_file_name: changelog-curator.agent.md
id: standalone-changelog-curator
cc_file_name: changelog-curator.md
changelog: |
  1.4.0 (2026-07-23): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  1.3.0 (2026-07-15): Added importance weighting and promoted-change bold sentence to summary rules
  1.2.0 (2026-07-15): Added release summary feature — optional prose paragraph with house style rules
  1.1.1 (2026-03-04): Added persona ID field for VS Code agent registry
  1.1.0 (2026-02-25): Refined entry verbosity rationales
  1.0.0 (2026-02-24): Initial release — Git-to-changelog summarization with house style

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

# overview metadata
identity: "Release Communications Editor"
use_when: "Preparing a release, cleaning up verbose agent-generated changelog entries"
modes: |
  Generate (from Git history)
  Rewrite (clean up existing entries)

```
###  Path: `/personas/standalone/src/meta/comms-curator.yaml`

```yaml
slug: comms-curator
name: "Communications Curator"
description: "Produce clear, engaging, audience-appropriate content from technical source material — release notes, user responses, stakeholder briefs, and presentation slides."
vs_file_name: comms-curator.agent.md
id: standalone-comms-curator
cc_file_name: comms-curator.md
changelog: |
  1.0.0 (2026-06-19): Initial release — multi-mode content writing for user- and stakeholder-facing communications

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Head of Product Communications"
use_when: "Writing release announcements, responding to users, preparing stakeholder updates or presentation material"
modes: |
  Release Notes
  User Response
  Stakeholder Brief
  Presentation Content
  General

```
###  Path: `/personas/standalone/src/meta/composer-curator.yaml`

```yaml
slug: composer-curator
name: "Composer Curator"
description: "Verify that the project's composer.json file is set up correctly for agentic coding."
vs_file_name: composer-curator.agent.md
id: standalone-composer-curator
cc_file_name: composer-curator.md
changelog: |
  1.0.1 (2026-03-04): Added persona ID field for VS Code agent registry
  1.0.0 (2026-02-24): Initial release — composer.json verification for agentic coding

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

# overview metadata
identity: "Agent Operations (AgentOps) Architect"
use_when: "Setting up a PHP project for agent-assisted development"

```
###  Path: `/personas/standalone/src/meta/ctx-architect.yaml`

```yaml
slug: ctx-architect
name: "CTX Architect"
description: "Design, generate, and maintain CTX Generator context documentation configurations — from root project setup to per-module configs."
vs_file_name: ctx-architect.agent.md
id: standalone-ctx-architect
cc_file_name: ctx-architect.md
changelog: |
  1.2.1 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.2.0 (2026-05-27): Variable examples escaped to fix warnings; integrated knowledge updated
  1.1.0 (2026-03-20): Added tree-source type warnings; exclude package manager artifacts
  1.0.0 (2026-03-12): Initial release — CTX Generator documentation workflows

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

# overview metadata
identity: "Context Documentation Architect"
use_when: "Setting up .context/ documentation infrastructure for a project, adding a new module's context config, or updating existing context docs"
modes: |
  Bootstrap
  New Module
  Update

```
###  Path: `/personas/standalone/src/meta/developer.yaml`

```yaml
slug: developer-standalone
name: "Developer (Standalone)"
description: "Implement scoped plan documents without ledger workflow, including code insights and end-of-plan synthesis."
vs_file_name: developer-standalone.agent.md
id: developer-standalone
cc_file_name: developer-standalone.md
changelog: |
  1.7.2 (2026-08-24): Added sink-compilation authoring instruction to Code Insights template slot; renamed ambiguous 'How to Record Observations' heading to 'Observation Reporting Rules'
  1.7.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  1.7.0 (2026-08-24): Sink opened at session start with marker line as protocol step 1; capture split into its own step gated on each completed file edit (steps 4-5 loop)
  1.6.0 (2026-08-21): Integrated insights.jsonl sidecar — capture partial, compilation partial, action gate in inline Operational Protocol step 3, Code Insights compiled from sink
  1.5.0 (2026-08-18): Preserve optional authored usage-scenarios.md through standalone implementation handoffs without archiving generated coverage reports
  1.4.0 (2026-07-23): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  1.3.1 (2026-07-06): Trimmed verbose plan-folder-date step to a concise one-liner
  1.3.0 (2026-07-06): New step 1 renames plan folder date prefix to today before implementation
  1.2.1 (2026-07-03): Made the archiving step non-optional but not required, as it was skipped too often.
  1.2.0 (2026-07-01): Gained standalone-archiver subagent dispatch for automatic ledger archival after synthesis
  1.1.1 (2026-06-17): Added no-stale-counts constraint to Strict Constraints
  1.1.0 (2026-05-29): Gained browser tool for UI and regression verification
  1.0.0 (2026-03-29): Initial release — plan implementation with code insights, no ledger

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - browser
  - agent
  - todo

cc_tools:
  - Bash
  - Read
  - Edit
  - Grep
  - TodoRead
  - TodoWrite

insight_agent: Developer
insight_report_target: "the **Code Insights** section of `synthesis.md`"

subagents:
  - standalone-archiver

# overview metadata
identity: "Staff Software Engineer"
use_when: "Implementing a plan document outside the ledger workflow (no MCP server needed)"
notes: "Works from a plan document directly instead of Work Packages; includes end-of-plan synthesis"

```
###  Path: `/personas/standalone/src/meta/documentation-curator.yaml`

```yaml
slug: documentation-curator
name: "Documentation (Standalone)"
description: "Analyze codebase changes, identify documentation gaps, and update READMEs, API references, and architecture guides to stay in sync with the code."
vs_file_name: documentation-curator.agent.md
id: standalone-documentation-curator
cc_file_name: documentation-curator.md
changelog: |
  1.0.1 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.0.0 (2026-04-30): Initial release — documentation analysis, gap-filling, and updating

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Technical Writing Manager"
use_when: "Documentation is out of sync with code, or a new documentation artifact is needed"
modes: |
  Update
  Audit
  Create

```
###  Path: `/personas/standalone/src/meta/git-committer.yaml`

```yaml
slug: git-committer
name: "Git Committer"
description: "Analyze uncommitted changes and organize them into comprehensive, categorized commits with plan traceability."
vs_file_name: git-committer.agent.md
id: standalone-git-committer
cc_file_name: git-committer.md
changelog: |
  1.7.0 (2026-08-21): Classify insights.jsonl as generated evidence — relocate with plan folder but never group as source
  1.6.0 (2026-08-18): Treat optional usage-scenarios.md as authored standalone-plan source and exclude generated scenario-coverage.md from grouping and archival
  1.5.0 (2026-08-12): Added "Verify before deleting after moves" constraint — guards against silent git mv failures on untracked files followed by destructive directory removal
  1.4.0 (2026-08-04): Plan archival now includes request.md (if present) alongside plan.md and synthesis.md — supports post-project acceptance verification
  1.3.0 (2026-07-13): Added date-only CTX filtering — excludes generated files whose only change is a timestamp, and drops the entire CTX group when no substantive content changes remain
  1.2.0 (2026-07-03): Clarified that only plan.md and synthesis.md are version-controlled in plan folders — all other artifacts are gitignored and should be ignored during discovery and staging
  1.1.1 (2026-06-29): Audit compliance — added pre-execution checklist, fixed angle bracket placeholders, removed title suffix, added output location, removed horizontal rules, reframed plan archival constraint
  1.1.0 (2026-06-29): Hardened git edge cases — no-remote/no-tracking guards, default branch detection, detached HEAD handling, pre-staged file handling, stash drop after conflict resolution, discovery terminology, diff content analysis for grouping, constraint clarification for filesystem moves
  1.0.6 (2026-06-29): Upstream integration is now a supported task (stash-merge-restore workflow)
  1.0.5 (2026-06-03): Added uncommitted-changes pre-check before commit sequence
  1.0.4 (2026-05-22): Excludes CTX files from commits on feature branches
  1.0.3 (2026-05-20): Checks for upstream and default-branch divergence before committing
  1.0.2 (2026-05-11): Archives both plan.md and synthesis.md to implementation history
  1.0.1 (2026-05-07): Minor fixes and adjustments
  1.0.0 (2026-05-06): Initial release — structured commit workflows with plan traceability

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

# overview metadata
identity: "Configuration Management Engineer"
use_when: "You have a large batch of uncommitted changes that need to be organized into logical, well-described commits"

```
###  Path: `/personas/standalone/src/meta/manifest-curator.yaml`

```yaml
slug: manifest-curator
name: "Manifest Curator"
description: "Create, update, and audit project manifests — the source of truth for AI agent sessions."
vs_file_name: manifest-curator.agent.md
id: standalone-manifest-curator
cc_file_name: manifest-curator.md
changelog: |
  1.0.7 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.0.6 (2026-04-30): Audited and improved content and workflow
  1.0.5 (2026-03-04): Added persona ID field for VS Code agent registry
  1.0.0 (2026-02-23): Initial release — AI agent session documentation creation and maintenance

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Technical Knowledge Architect"
use_when: "Setting up a project for agent-assisted development, or keeping manifest docs in sync after codebase changes"
modes: |
  Create
  Update
  Audit

```
###  Path: `/personas/standalone/src/meta/module-intent-architect.yaml`

```yaml
slug: module-intent-architect
name: "Module Intent Architect"
description: "Infers and documents the purpose, role, and dependencies of specific code modules by analyzing the source."
vs_file_name: module-intent-architect.agent.md
id: standalone-module-intent-architect
cc_file_name: module-intent-architect.md
changelog: |
  1.0.4 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.0.3 (2026-03-04): Added persona ID field for VS Code agent registry
  1.0.2 (2026-02-24): Improved documentation generation guidance
  1.0.1 (2026-02-23): Initial pre-changelog version

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

# overview metadata
identity: "Staff Software Architect"
use_when: "A module lacks documentation and you need a README that explains its purpose, API, and relationships"

```
###  Path: `/personas/standalone/src/meta/persona-curator.yaml`

```yaml
slug: persona-curator
name: "Persona Curator"
description: "Create, audit, and maintain AI agent personas according to the Persona Design Guide."
vs_file_name: persona-curator.agent.md
id: standalone-persona-curator
cc_file_name: persona-curator.md
changelog: |
  1.4.0 (2026-08-24): Replaced "Imperative, Not Suggestive" philosophy with Tone Stratification; updated audit and quality checklist items to enforce two-register tone rule
  1.3.0 (2026-06-13): Updated Create workflow + Version bookkeeping constraint to use changelog: block scalar; prohibit standalone version: and last_updated: fields
  1.2.0 (2026-06-13): Changelog entries now recorded in persona YAML metadata instead of personas/changelog.md
  1.1.0 (2026-04-29): Improved mission statement and operational protocol
  1.0.0 (2026-04-11): Initial release — AI agent persona creation and auditing

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Agent Design Architect"
use_when: "Designing a new agent persona, auditing existing personas for compliance, or applying targeted fixes"
modes: |
  Create
  Audit
  Maintain

```
###  Path: `/personas/standalone/src/meta/plan-architect-reviewer.yaml`

```yaml
slug: plan-architect-reviewer
name: "Plan Architect Reviewer"
description: "Decision-level architectural review of technical plans — weighs each design choice against named alternatives with Confirm/Challenge/Reconsider verdicts. Runs in parallel with the Plan Auditor; never blocks."
vs_file_name: plan-architect-reviewer.agent.md
id: standalone-plan-architect-reviewer
cc_file_name: plan-architect-reviewer.md
changelog: |
  2.2.0 (2026-07-21): Added Research Brief Protocol — self-service research brief usage with orientation, contribute-back, and size guard rules
  2.1.0 (2026-07-16): Added "Favor Durable Structures" principle to Operating Philosophy — prefer growth-accommodating designs over expedient shortcuts
  2.0.0 (2026-07-04): Major rewrite — decision-by-decision analysis replaces holistic shape commentary; Confirm/Challenge/Reconsider verdicts replace Simplification/Concern/Affirmation categories; 3-phase protocol replaces 5-phase; Decision Analysis Table is now the primary deliverable
  1.6.0 (2026-06-05): Improved review philosophy and architectural framing
  1.5.0 (2026-05-29): Gained browser tool for UI verification
  1.4.0 (2026-05-18): Gained Audit Cycle Tracking — increments ## Plan Audit Cycles counters
  1.3.0 (2026-05-12): Initial release — advisory architectural review with Simplifications vocab

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

# overview metadata
identity: "Principal Software Architect"
use_when: "Reviewing a plan's architectural decisions before implementation begins"
notes: "Runs in parallel with the Plan Auditor; never blocks it"

```
###  Path: `/personas/standalone/src/meta/plan-auditor.yaml`

```yaml
slug: plan-auditor
name: "Plan Auditor"
description: "Audit technical plans for technical defects — hallucinated references, missing steps, infeasible sequencing, and pattern inconsistencies. Architectural critique is delegated to the Plan Architect Reviewer."
vs_file_name: plan-auditor.agent.md
id: standalone-plan-auditor
cc_file_name: plan-auditor.md
changelog: |
  1.7.0 (2026-07-21): Added Research Brief Protocol — self-service research brief usage with orientation, contribute-back, and size guard rules
  1.6.0 (2026-07-16): Added "Flag Expedient Shortcuts" principle to Operating Philosophy — catch structures that won't scale before implementation begins
  1.5.0 (2026-06-03): No longer nags about navigational aids; gained browser tool
  1.4.0 (2026-05-20): Implementer-friction filter to suppress low-value findings
  1.3.0 (2026-05-18): Gained Audit Cycle Tracking — increments ## Plan Audit Cycles counters
  1.2.0 (2026-05-12): Narrowed to technical defects; gained Test Plan and Docs section checks
  1.1.0 (2026-04-29): Initial improvements
  1.0.0 (2026-04-29): Initial release — technical plan defect detection

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

# overview metadata
identity: "Senior Technical Plan Auditor"
use_when: "Validating a plan for technical correctness before implementation"
notes: "Runs in parallel with the Plan Architect Reviewer"

```
###  Path: `/personas/standalone/src/meta/plan-refiner.yaml`

```yaml
slug: plan-refiner
name: "Plan Refiner"
description: "Orchestrate iterative plan refinement: architectural review, finding integration, and repeated auditing until audit-clean or ceiling reached."
vs_file_name: plan-refiner.agent.md
id: standalone-plan-refiner
cc_file_name: plan-refiner.md
changelog: |
  1.4.0 (2026-08-18): Added opt-in post-convergence usage scenario verification with GUI-scope exception handling and a bounded integration re-check
  1.3.0 (2026-07-21): Moved research brief handling to sub-agent personas — Auditor and Architect Reviewer now self-manage brief usage; simplified dispatch prompts and removed Sub-Agent Brief Enrichment protocol and brief size guard from Refiner
  1.2.1 (2026-07-21): Operating Philosophy rewrite — replaced constraint-like prohibitions with positive value statements; removed items already covered by Strict Constraints
  1.2.0 (2026-07-21): Refiner-as-Enricher — brief enrichment phase, enriched sub-agent dispatch prompts with research brief references, incremental re-audit for cycles 2+, sub-agent brief enrichment with provenance markers, brief size guard
  1.1.0 (2026-07-17): Design review triage — auto-detect whether the plan warrants architectural review; skip for plans with no design decisions
  1.0.4 (2026-05-31): Minor refinements
  1.0.3 (2026-05-20): Handoff improvements to give subagents more agency
  1.0.2 (2026-05-20): Wording improvements to remove overly imperative instructions
  1.0.0 (2026-05-20): Initial release — iterative plan refinement with repeated auditing

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
  - usage-scenarios-curator

# overview metadata
identity: "Plan Quality Director"
use_when: "You want a plan to go through multiple rounds of review and refinement automatically"

```
###  Path: `/personas/standalone/src/meta/planner.yaml`

```yaml
slug: planner
name: "Planner (Standalone)"
description: "Produce clear, actionable, technically sound plans from feature requests or task descriptions."
vs_file_name: planner.agent.md
id: standalone-planner
cc_file_name: planner.md
changelog: |
  2.0.1 (2026-07-21): Rename Research Brief subsection from "Patterns & Conventions" to "Established Patterns" to reinforce factual-only content
  2.0.0 (2026-07-15): Three-phase workflow (Scope Sketch → Research Brief → Plan) replaces interleaved research-and-plan approach; adds research-brief.md output artifact
  1.0.0 (2026-06-08): Initial release — ledger-independent planning for non-ledger workflows

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Chief Product Officer (CPO)"
use_when: "Creating a plan outside the ledger workflow, or reworking a plan based on synthesis feedback"
modes: |
  Normal Planning
  Synthesis Rework

```
###  Path: `/personas/standalone/src/meta/readme-curator.yaml`

```yaml
slug: readme-curator
name: "README Curator"
description: "Produces a human‑optimized README.md that follows a landing‑page funnel: Hook → Features → Requirements → Quick Start → Learn More."
vs_file_name: readme-curator.agent.md
id: standalone-readme-curator
cc_file_name: readme-curator.md
changelog: |
  1.4.0 (2026-07-23): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  1.3.1 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.3.0 (2026-04-12): Rewritten to imperative voice for consistent style
  1.2.1 (2026-03-01): Added helper section for rewriting entire READMEs
  1.2.0 (2026-02-24): Rewritten to produce better human-oriented output
  1.1.0 (2026-02-23): Initial pre-changelog version

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Developer Experience (DX) Storyteller"
use_when: "A project needs a new or rewritten README"

```
###  Path: `/personas/standalone/src/meta/recipe-curator.yaml`

```yaml
slug: recipe-curator
name: "Recipe Curator"
description: "Curate, adapt, and compose recipes tailored to a home kitchen that values fresh, seasonal, and predominantly organic ingredients."
vs_file_name: recipe-curator.agent.md
id: standalone-recipe-curator
cc_file_name: recipe-curator.md
changelog: |
  1.10.0 (2026-06-29): Recipe identifiers — every recipe gets a short ID (R1, R2, …) that persists across the conversation; IDs appear in previews, weekly plan tables, and full recipe headings for easy back-reference
  1.9.1 (2026-06-29): Template fidelity constraint — output templates (preview, weekly table, recipe format) must be reproduced with exact Markdown structure; Match the User's Language now defers to Template Fidelity for structural formatting; field values must stay compact
  1.9.0 (2026-06-29): Recipe preview step — Single Recipe workflow now presents a compact summary (name, cuisine, key ingredients, effort) for chef approval before generating the full recipe; new Preview Selection protocol in Operational Protocol; workflow grows from 8 to 9 steps
  1.8.0 (2026-06-29): Structural audit — merged Garden First + Seasonal First into Source Smart philosophy (8→6 principles); extracted Operational Protocol (Culinary Direction, Survey Options, Adapt and Compose, Tinkerer's Notes, Verify Targets); both workflows now reference shared protocol, reducing Single Recipe to 8 steps and Weekly Plan to 10; de-duplicated color diversity targets; added alternative actions to Carb Rotation and Repertoire Rotation constraints; added output location
  1.7.0 (2026-06-29): Operating Modes split — added Single Recipe / Weekly Plan mode table; split unified Workflow into two dedicated mode workflows, each with its own clean step sequence; handoff blocks now include MODE field
  1.6.0 (2026-06-29): Plan preview step — weekly plans now show a compact overview table with recipe names, cuisine, and rationale for chef approval before generating detailed recipes
  1.5.0 (2026-06-29): Culinary direction step — new blocking workflow step offers Comfort, Discovery, or Directed modes before recipe search; Survey Options adapts to chosen direction; Novelty Over Familiarity philosophy notes the Comfort override
  1.4.3 (2026-06-29): Meal scope confirmation — extracted lunch-inclusion question into a dedicated blocking workflow step for weekly plans to prevent late rework
  1.4.2 (2026-06-29): Canned fish as side-only — removed sardines/mackerel from pantry examples, recipe ingredients, and substitution suggestions; clarified they are eaten standalone, never cooked into recipes
  1.4.1 (2026-06-14): World cuisine reframing — Mediterranean demoted from home base to geographic influence; culinary identity is global
  1.4.0 (2026-06-14): Consistency audit — de-duplicated Philosophy (12→8), moved Sugar/Salt/Fat to Philosophy as Light Touch on Seasoning, moved Beyond Fresh and Bread to Kitchen Reference, categorized Constraints, moved Session Opener to Workflow, standardized color targets, fixed pronouns and column labels
  1.3.0 (2026-06-14): Creativity and novelty — anti-repetition philosophy, repertoire rotation constraint, session opener, enhanced survey workflow
  1.2.0 (2026-06-14): Rainbow eating integration — color diversity reference, constraint, recipe/plan format, and verification workflow
  1.1.1 (2026-06-14): Ignore leftovers constraint — plan each meal from scratch
  1.1.0 (2026-06-14): Nutrition verification workflow step
  1.0.5 (2026-06-13): Calorie ceiling (2500 kcal/day) and fiber target (30g/day) added
  1.0.4 (2026-06-13): Canned and refrigerated goods as first-class ingredient sources
  1.0.3 (2026-06-13): No fresh fish; Mediterranean as style home base, not a boundary
  1.0.2 (2026-06-13): Weekly plan includes full individual recipes below the overview table
  1.0.1 (2026-06-13): Weekly plan defaults to dinner-only; asks whether to include lunch
  1.0.0 (2026-06-13): Initial release — household recipe curation and meal planning

tools:
  - vscode
  - read
  - search
  - web
  - browser

# overview metadata
identity: "Private Chef & Culinary Consultant"
use_when: "Meal planning or recipe adaptation (non-development persona — personal utility)"
modes: |
  Single Recipe
  Weekly Plan

```
###  Path: `/personas/standalone/src/meta/researcher.yaml`

```yaml
slug: researcher
name: "Researcher"
description: "Research solutions to complex problems through known patterns or creative thinking."
vs_file_name: researcher.agent.md
id: standalone-researcher
cc_file_name: researcher.md
changelog: |
  1.2.0 (2026-05-29): Gained browser tool for research verification
  1.1.0 (2026-04-30): Audited and improved
  1.0.0 (2026-02-23): Initial release — complex problem research via known patterns

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

# overview metadata
identity: "Senior Research Engineer & Solution Architect"
use_when: "Facing a complex problem that needs investigation before implementation"

```
###  Path: `/personas/standalone/src/meta/unit-test-auditor.yaml`

```yaml
slug: unit-test-auditor
name: "Unit Test Auditor"
description: "Audit unit test coverage of specific codebase modules — identify untested paths, weak assertions, and missing edge cases."
vs_file_name: unit-test-auditor.agent.md
id: standalone-unit-test-auditor
cc_file_name: unit-test-auditor.md
changelog: |
  1.1.1 (2026-06-17): Added no-stale-counts philosophy to Operating Philosophy
  1.1.0 (2026-04-30): Audited and improved; rewritten to imperative voice
  1.0.0 (2026-02-23): Initial release — unit test coverage auditing for specific modules

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

# overview metadata
identity: "Lead QA Auditor & Test Architect"
use_when: "Auditing test coverage of specific modules to find the most impactful missing tests"

```
###  Path: `/personas/standalone/src/meta/usage-scenarios-curator.yaml`

```yaml
slug: usage-scenarios-curator
name: "Usage Scenarios Curator"
description: "Generate human-editable user scenarios from a plan and verify deterministic scenario coverage without changing the plan or implementation."
vs_file_name: usage-scenarios-curator.agent.md
id: standalone-usage-scenarios-curator
cc_file_name: usage-scenarios-curator.md
changelog: |
  1.2.0 (2026-08-20): Added Change Management for evolving GUI features: feature changes are scenario
    changes first and the plan references scenarios by [SCnn] ID; materially changed approved
    scenarios get a [MODIFIED] tag with both checkboxes unticked (the sole sanctioned untick), and
    the Approval Gate now blocks verification on leftover [MODIFIED] tags as well as missing
    approvals; removed scenarios are tombstoned to keep their IDs reserved.
  1.1.0 (2026-08-20): Adopted self-contained [SCnn]/MSnn scenario format with human-owned lifecycle
    checkboxes; added Scenario Authoring Conventions and an Approval Gate that blocks verification
    until every scenario is spec-approved; Verify now flags human-vs-evidence checkbox mismatches.
    Curated scenarios now live at docs/references/usage-scenarios.md (or a usage-scenarios/ directory
    split by GUI area with a README index) as stable project documentation.
  1.0.0 (2026-08-18): Initial release - plan-adjacent usage scenario generation and verification

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - browser
  - todo

# overview metadata
identity: "Product Usage Scenario Analyst"
use_when: "Creating or verifying user-facing usage scenarios for a scoped plan, especially when GUI behavior needs an opt-in coverage check"
modes: |
  Generate
  Verify
```
###  Path: `/personas/standalone/src/meta/web-gui-specialist.yaml`

```yaml
slug: web-gui-specialist
name: "Web GUI Specialist"
description: "Design and implement engaging, visually optimized web app and tool interfaces with strong UX, accessibility, and frontend performance discipline."
vs_file_name: web-gui-specialist.agent.md
id: standalone-web-gui-specialist
cc_file_name: web-gui-specialist.md
changelog: |
  1.3.2 (2026-08-24): Added sink-compilation authoring instruction to Interface Insights template slot; renamed ambiguous 'How to Record Observations' heading to 'Observation Reporting Rules'
  1.3.1 (2026-08-24): Insight compilation reads all sink entries regardless of agent instead of filtering to own entries
  1.3.0 (2026-08-24): Sink opened at session start with marker line as protocol step 1; capture split into its own step gated on each verified surface (steps 4-5 loop)
  1.2.0 (2026-08-21): Integrated insights.jsonl sidecar — capture partial, compilation partial, How to Record subsection, action gate in step 3, Interface Insights compiled from sink, added improvement type
  1.1.0 (2026-08-18): Preserve optional authored usage-scenarios.md through GUI implementation handoffs without treating generated coverage as source
  1.0.1 (2026-07-22): Added curated non-obvious GUI heuristics for typography, accessibility, and frontend rendering quality
  1.0.0 (2026-07-22): Initial release - focused web GUI design and implementation specialist for standalone workflows

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - browser
  - agent
  - todo

insight_agent: Web GUI Specialist
insight_report_target: "the **Interface Insights** section of `synthesis.md`"

subagents:
  - standalone-archiver

# overview metadata
identity: "Senior Web Interface Engineer and UX Systems Designer"
use_when: "Building or improving a web interface with strong UX, accessibility, and visual polish requirements"

```
###  Path: `/personas/standalone/src/meta/whatsnew-curator.yaml`

```yaml
slug: whatsnew-curator
name: "WHATSNEW Curator"
description: "Write bilingual WHATSNEW.xml release note entries from the developer changelog, filtering to user-facing changes only."
vs_file_name: whatsnew-curator.agent.md
id: standalone-whatsnew-curator
cc_file_name: whatsnew-curator.md
changelog: |
  1.0.1 (2026-03-04): Added persona ID field for VS Code agent registry
  1.0.0 (2026-02-25): Initial release — bilingual WHATSNEW.xml release note generation

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - agent
  - todo

# overview metadata
identity: "Release Notes Editor"
use_when: "Preparing bilingual (EN/DE) WHATSNEW.xml release note entries from a developer changelog"

```
###  Path: `/personas/standalone/src/meta/workspace-architect.yaml`

```yaml
slug: workspace-architect
name: "Workspace Architect"
description: "Onboard and maintain development repositories for the AI Insights persona ecosystem — orchestrates specialist sub-agents to establish project manifests, AGENTS.md, CTX docs, README, and changelog."
vs_file_name: workspace-architect.agent.md
id: standalone-workspace-architect
cc_file_name: workspace-architect.md
changelog: |
  1.0.0 (2026-06-29): Initial release — workspace onboarding and upgrade orchestration via sub-agent delegation

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
  - manifest-curator
  - agents-md-curator
  - composer-curator
  - ctx-architect
  - readme-curator
  - changelog-curator

# overview metadata
identity: "Workspace Infrastructure Architect"
use_when: "Setting up a new repository for the AI Insights ecosystem, or upgrading an existing repo's infrastructure"
modes: |
  Onboard
  Upgrade

```