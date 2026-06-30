# Personas - Standalone Metadata
<INSTRUCTION>
# Personas - Standalone Persona Metadata
YAML metadata for all standalone personas: shared defaults (_shared.yaml) and per-persona overrides - model slug, slugs, descriptions, and feature flags.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: YAML metadata for all 19 standalone personas (shared defaults + per-persona overrides)_
# YAML metadata for all 19 standalone personas (shared defaults + per-persona overrides)
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

```
###  Path: `/personas/standalone/src/meta/plan-architect-reviewer.yaml`

```yaml
slug: plan-architect-reviewer
name: "Plan Architect Reviewer"
description: "Advisory architectural review of technical plans — challenges design shape, surfaces simplifications, and proposes ecosystem-level alternatives. Runs in parallel with the Plan Auditor; never blocks."
vs_file_name: plan-architect-reviewer.agent.md
id: standalone-plan-architect-reviewer
cc_file_name: plan-architect-reviewer.md
changelog: |
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

```