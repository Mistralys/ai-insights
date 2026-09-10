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
                └── dependency-curator.yaml
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
  2.1.1 (2026-09-10): Added cc_tools override — Task required for sub-agent dispatch; builder resolves cc_tools→tools, never default_cc_tools
  2.1.0 (2026-09-08): Findings outside `AGENTS.md` are now acted on rather than only reported — the shared
    ownership table carries a size triage that corrects small errors in place and dispatches the owning agent
    for anything larger, without asking the user first. The previous "never edit, never dispatch" pair read as
    an absolute prohibition to rule-following models, which left a one-word path error standing while the report
    named an owner nobody invoked. The triage is stated once in the partial and referenced from there; only the
    two persona-specific exceptions are spelled out here — a manifest gap always dispatches however small it
    looks, and a project with no manifest at all still goes to the user
  2.0.0 (2026-09-08): Reduction pass, and nested-repository support. The persona had accreted across three
    successive design-guide audits until it took longer to review than the file it maintains, so everything an
    agent does without being told came out: Audit mode is gone and Update now reports what it changed, the five
    section descriptions collapse into one table, the four overlapping statements of the write surface into one,
    and the checklist from seventeen items to six — Create runs eight steps rather than thirteen, Update seven
    rather than ten. Nested repositories are handled for the first time: a sub-project earns its own file once it
    has a manifest to route to, each file names those beneath it with the condition for preferring one, and a
    rule is stated only in the topmost file it applies to. Nesting is unbounded, so a file's parent is the
    nearest one above it, and each file sources facts from its own manifest with no other standing as a
    fallback. The boundary check now covers every section, since a fact stated inside a MUST row reads as a rule
    and is never re-examined as a claim
  1.6.1 (2026-09-02): Audit fixes — merged Manifest First and High Integrity into Truth Upstream, Routing Downstream; added the Findings Travel Further Than Fixes principle shared with the Manifest Curator; tightened the Manifest Boundary opener
  1.6.0 (2026-09-02): Added The Manifest Boundary — the manifest states what is true, AGENTS.md states what to do about it; every codebase fact is now sourced from the manifest or reported as a gap, Project Stats is sourced from tech-stack.md, and all three workflows carry a boundary check
  1.5.1 (2026-08-26): Rewrote a trailing imperative sentence in the Stratified Authority philosophy principle into indicative mood
  1.5.0 (2026-08-26): Routes agents to decision documents that sit outside the manifest, including the dependency decision ledger
  1.4.0 (2026-08-25): Register Map — tone stratification now applies to the generated AGENTS.md
  1.3.0 (2026-08-25): Tone stratification and a dedicated Operating Modes section
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

# cc_tools: explicit list required — the builder resolves cc_tools from
# cc_tools → tools (never default_cc_tools), so the VS Code tools list
# would be used otherwise, which lacks Task.
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
  - TodoRead
  - TodoWrite

# Owning agents named in the documentation-ownership routing table, dispatched for
# changes the triage classifies as large. The deep-agents target takes its tools
# from the orchestrator's built-in suite, not from this file.
subagents:
  - manifest-curator
  - documentation-curator
  - readme-curator
  - changelog-curator
  - ctx-architect

# overview metadata
identity: "Agent Operations (AgentOps) Architect"
use_when: "Setting up a new repository for agent workflows, or reconciling a stale AGENTS.md against the current codebase"
modes: |
  Create
  Update


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
  1.5.0 (2026-08-25): Design Guide v2.8 audit fixes — added Inputs with Capabilities, Operating Philosophy, Quality Checklist, Outputs with a location, and a WHATSNEW Curator scope boundary; fixed both modes writing before user approval; added a change inventory between history gathering and drafting; added conditional checkpoints for breaking/deprecation subsections and the file heading; restated style rules inside the Entry Format template; reordered sections and de-imperativised reference prose
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

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.1.0 (2026-08-26): Design Guide v2.8 audit fixes — added per-mode Output Templates with the no-superlative, no-counts and no-implementation-detail rules restated inside the slots; split the mixed research/production workflow into read, brief, structure and prose phases with a content brief between them; added a session-start checkpoint for audience, format and source material; gave the gap-reporting duty a mandatory Gaps slot with a nothing-found form and its own workflow step; reframed the Operating Philosophy as positive values and de-imperativised Inputs, Outputs, Modes, Workflow and the content type reference; added no-meta-commentary and write-only-the-named-destination constraints and alternatives to the boundary-only ones; moved Strict Constraints ahead of the Quality Checklist; added the AX Feedback step; specified input paths and formats; removed redundant separators
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

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.1.0 (2026-08-25): Design Guide v2.8 audit — added Outputs and Strict Constraints sections, extracted Capabilities sub-section, reformatted Workflow with bold step names, applied tone stratification, promoted AGENTS.md check to explicit workflow step, removed redundant separators
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

audit_guide_version: "3.3"
audit_date: "2026-08-27"

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
  1.3.3 (2026-08-27): Renamed "Minimal Viable Coverage" to the canonical "Every Artefact Earns Its Place" per the personas constraint C5c principle registry, resolving a name fork with the Workspace Architect
  1.3.2 (2026-08-26): Renamed "Counts Are a Maintenance Liability" to the canonical "Durable Over Precise" per the personas constraint C5c principle registry
  1.3.1 (2026-08-26): Rewrote three Operating Philosophy principles from imperative into indicative mood per design guide v3.0
  1.3.0 (2026-08-25): Tone stratification, safety-rail constraints, audit report template, anchored self-validation
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
  Audit

audit_guide_version: "3.3"
audit_date: "2026-08-27"

```
###  Path: `/personas/standalone/src/meta/dependency-curator.yaml`

```yaml
slug: dependency-curator
name: "Dependency Curator"
description: "Survey third-party dependencies for security advisories, upstream abandonment and in-constraint updates, grade the whole tree in a health scorecard, and produce migration plans for major-version upgrades."
vs_file_name: dependency-curator.agent.md
id: standalone-dependency-curator
cc_file_name: dependency-curator.md
changelog: |
  1.3.0 (2026-09-10): Added an Audit mode producing a Dependency Health Scorecard — every declared dependency graded A–E on security, currency, upstream activity and support window, with the worst dimension setting the grade rather than an average, an unmeasured dimension marked `?` instead of assumed healthy, and integration depth (foundational/structural/peripheral, derived from call sites) carried as a separate column that never moves the grade; the survey reuses Maintenance phases 1–8 across the whole declaration set rather than restating them, and Maintenance was re-scoped in the mode table as the prescriptive counterpart to Audit's descriptive one
  1.2.1 (2026-08-26): Rewrote two Operating Philosophy principles from imperative into indicative mood per design guide v3.0
  1.2.0 (2026-08-26): Added the Dependency Decision Ledger and a Record mode — decisions and rationale accumulate across sessions, expired decisions surface as findings, and deferred upgrade research is revalidated rather than re-derived
  1.1.0 (2026-08-26): Added upstream maintenance status, lock file integrity, declaration hygiene and exposure-tiered advisory priority; corrected Yarn and Poetry commands; added transitive override, license, support window, workspace and update automation coverage
  1.0.0 (2026-08-26): Initial release — dependency maintenance auditing and major-version upgrade planning across Composer, npm, pip, Cargo and Go

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

audit_guide_version: "3.2"
audit_date: "2026-08-26"

# overview metadata
identity: "Dependency & Supply Chain Engineer"
use_when: "Reviewing dependency health, chasing security advisories, grading the whole dependency tree, or planning a major-version upgrade"
modes: |
  Maintenance (in-constraint updates and advisories — what needs doing)
  Audit (health scorecard grading every dependency A–E — where the project stands)
  Upgrade (major-version migration planning)
  Record (write a dependency decision to the ledger)

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
  1.15.0 (2026-09-10): Gained optional research-brief.md consumption via the shared research-brief-reference partial — Contextual Analysis starts from its verified references; the brief is read-only here (only the Planner writes it, and it is deleted at archival), so it joins the byte-for-byte unchanged check and the plan folder now names three artefact classes
  1.14.0 (2026-09-10): Code Insights split into Implementation Decisions and Follow-Up Items via a new `decision` type in the shared insight-scope-and-types partial; synthesis template renders both subsections, omitting whichever is empty
  1.13.0 (2026-08-27): Paired v3.3 audit with the ledger twin — cc_tools regained Task, Write and Glob, which the archiver dispatch and synthesis writes required but the override had removed; gained the Atomic Changes constraint; No Stale Counts moved to a shared partial
  1.12.0 (2026-08-26): Dual-role mission block, observer intro and observation reporting rules extracted into three further shared partials with the ledger Developer; the Code Insight Observer section is now entirely partial-driven
  1.11.0 (2026-08-26): Observer scope table, observation categories and priority guidelines extracted into the shared insight-scope-and-types partial with the ledger Developer
  1.10.0 (2026-08-26): Scope & Boundaries now states where out-of-scope observations go — compiled into synthesis.md Code Insights, which a Planner reads to produce a rework plan — and why refactor scope is decided before implementation rather than during it
  1.9.0 (2026-08-26): Operating Philosophy moved to the shared developer-philosophy partial; deployment-specific sink references genericised, since naming a sink is procedure and belongs outside a philosophy principle
  1.8.1 (2026-08-26): Rewrote Operating Philosophy into indicative mood per design guide v3.0; "Assume Growth" retitled "Growth Is the Default"
  1.8.0 (2026-08-25): Design guide v2.8 audit fixes — added Operating Philosophy, Rework Handling, Self-Validation Checklist; consolidated Code Insight Observer constraints under own heading; split verification into three protocol phases; de-duplicated workflow against protocol; retoned content sections to descriptive prose; completed archiver delegation spec
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

# Differs from default: no WebFetch/WebSearch, matching the vs-code grant (no `web` tool)
cc_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
  - TodoRead
  - TodoWrite

audit_guide_version: "3.3"
audit_date: "2026-08-27"

# developer-dual-role partial substitutions
dev_work_unit: "a scoped plan document (generated by the Planner Agent)"
dev_work_scope: "the plan"

# no-stale-counts partial substitution
stale_counts_targets: "documentation, summaries, or synthesis output"

# insight-reporting-rules partial substitutions
insight_reporting_intro: "The `### Code Insights` section of `synthesis.md` is where observations reach the reader."
insight_compile_source: "The section is assembled from `insights.jsonl` entries; the sink-state table below governs what to write when the sink is empty or absent."
insight_nothing_found: "When the sink holds a `session-start` marker and no findings, record a single observation with type `improvement` and the note `No observations — code in the touched files is clean and consistent.`"

# insight-scope-and-types partial substitutions
insight_reviewer_ref: "a formal reviewer"
insight_routing: "An observation recorded in the sink is compiled into the **Code Insights** section of `synthesis.md`, and that file is what a Planner reads to produce a rework plan."
insight_type_context: "These are the `type` values available when appending an observation to the sink:"

insight_agent: Developer
insight_report_target: "the **Code Insights** section of `synthesis.md`"

# research-brief-protocol partial substitutions
brief_orientation: "Every area of the brief is in scope, whatever tags its entries carry"
brief_purpose: "Contextual Analysis"
brief_authority: "the current state of the code"

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
  1.3.1 (2026-09-10): Added cc_tools override — Task required for sub-agent dispatch; builder resolves cc_tools→tools, never default_cc_tools
  1.3.0 (2026-09-08): The shared ownership table gained a size triage, so a document belonging to another agent
    is now corrected here when the fix is small and dispatched to its owner when it is not; the dispatch
    mechanics block moved into that partial, the delegation table narrowed to the three recurring briefs, and
    the Update summary gained a Documents Routed block. The triage itself is stated only in the partial — this
    persona references it rather than restating it. Audit mode is exempt and says so: it writes nothing and
    dispatches nobody
  1.2.0 (2026-09-03): Scope boundaries replaced with the shared documentation ownership table, which names concepts
    documents and glossaries as this persona's own territory and gives changelogs and diagrams an explicit owner \u2014
    previously all three fell outside every routing table, so a wrong one had nowhere to go
  1.1.1 (2026-08-26): Renamed "Counts Age Badly" to the canonical "Durable Over Precise" per the personas constraint C5c principle registry
  1.1.0 (2026-08-26): Design Guide v2.8 audit fixes — reframed Operating Philosophy as positive values and de-imperativised the Mission, Modes, Inputs, Outputs and all three workflows; extracted a shared Documentation Research operational protocol so every mode gathers and verifies facts into a brief before writing, and reordered Create mode to verify before writing; added a Session Conditionals checkpoint rehearsing the three delegation conditions every session; replaced the Delegation rules with a Sub-Agent Delegation section carrying a scope boundary table, per-agent inputs, expected outputs and a mandatory review step; added Update-mode change summary template and restated the no-counts rule inside the template slots; added a self-validation Quality Checklist, a no-stale-counts constraint, and audit-mode and approval rails; hoisted the Output Template above Core Rules; specified input formats; removed redundant separators
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

# cc_tools: explicit list required — the builder resolves cc_tools from
# cc_tools → tools (never default_cc_tools), so the VS Code tools list
# would be used otherwise, which lacks Task.
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
  - TodoRead
  - TodoWrite

# Owning agents named in the documentation-ownership routing table, dispatched for
# changes the triage classifies as large. The deep-agents target takes its tools
# from the orchestrator's built-in suite, not from this file.
subagents:
  - agents-md-curator
  - readme-curator
  - manifest-curator
  - changelog-curator
  - ctx-architect

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.9.0 (2026-09-10): research-brief.md classified as the Research material plan file class — staged with the plan while in plans/, removed rather than archived on completion since a git mv would keep an already-tracked brief tracked past the ignore rule; Capabilities gained git rm and brief deletion, inventory records tracked state, review table surfaces the removal before approval
  1.8.0 (2026-08-25): Audit compliance (guide v2.8) — repaired corrupted git-mv constraint, single-sourced the plan archival set, consolidated sub-section constraints, split plan inventory from thematic grouping, restated message rules in the review template
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

audit_guide_version: "3.3"
audit_date: "2026-08-27"

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
  1.6.0 (2026-09-02): Added the Changed-Code Intersection — comparing documents only to each other cannot catch a coherent document the code moved out from under, so Update and Audit now read the diff of every changed file the manifest names; added the emphatic-claims rule, since a fact stated absolutely is re-checked least and falsified most; delegation briefs now carry fact provenance
  1.5.0 (2026-09-02): Gained read-only Git history as a verification capability, applied at the agent's discretion; added the Reverted Decisions search as one named use of it, since a decision made and later undone is a constraint nobody wrote down; curation log entries gained a Commit line that anchors the next pass's search range
  1.4.2 (2026-09-02): Curation log entries no longer link the Discrepancy Report — the report is a temporary artefact the user deletes after acting on it, so audit findings are now written into the log entry itself
  1.4.1 (2026-09-02): Audit fixes — the Adjacent Document Check now mirrors the AGENTS.md Curator's boundary, catching unsourced codebase facts and divergent Project Stats entries; the file-absence conditional gained a workflow checkpoint; added the Findings Travel Further Than Fixes principle shared with the AGENTS.md Curator
  1.4.0 (2026-09-02): Added the Adjacent Document Check — Update and Audit now compare the root README.md and AGENTS.md against the reconciled manifest and route what they get wrong to the owning curator, without editing either file
  1.3.0 (2026-09-01): Added curation-log.md — standing decisions plus a dated trail of curation passes, written by all three modes and read back in Update and Audit; manifest Version and Last Updated header fields are retired in its favour
  1.2.1 (2026-08-26): Retitled "Preserve Author Intent" to "Author Intent Survives Updates" per design guide v3.0 mood rule
  1.2.0 (2026-08-26): Scope boundary separates dependency facts in tech-stack.md from dependency decisions in the Dependency Curator's ledger
  1.1.0 (2026-08-25): Register Map — tone stratification now applies to the generated manifest
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

audit_guide_version: "3.4"
audit_date: "2026-09-02"

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
  1.1.1 (2026-08-26): Tightened the 30-Second Rule principle - replaced weak "should" phrasing and added the consequence clause that makes the budget actionable
  1.1.0 (2026-08-25): Redesigned for Design Guide v2.8 compliance
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

audit_guide_version: "3.3"
audit_date: "2026-08-27"

# overview metadata
identity: "Staff Software Architect"
use_when: "A module lacks documentation and you need a README that explains its purpose, API, and relationships"

```
###  Path: `/personas/standalone/src/meta/persona-curator.yaml`

```yaml
# PUBLISHED ARTIFACT — src/content/persona-curator.md is fetched by downstream
# projects and overwritten locally on every sync. Keep instructions project-neutral
# (conditional references only) and treat top-level heading renames as breaking:
# nexus-personas injects a partial by anchoring on "\n\n## Operating Philosophy\n".
# See personas/docs/agents/project-manifest/constraints.md (C5d).
slug: persona-curator
name: "Persona Curator"
description: "Create, audit, and maintain AI agent personas according to the Persona Design Guide."
vs_file_name: persona-curator.agent.md
id: standalone-persona-curator
cc_file_name: persona-curator.md
audit_guide_version: "3.4"
audit_date: "2026-08-27"

changelog: |
  1.16.0 (2026-09-08): Added Reduce mode — an audit's unit is the single statement and its remedy is almost
    always an addition, so repeated auditing grew personas past the point their owners could review them while
    reporting no defect; the mode judges what each statement buys, cuts modes before features and features
    before rules, and puts the scope decisions to the user. Guide v3.5 carries the domain-neutral procedure
  1.15.0 (2026-08-27): Added a Prose Density Pass alongside the Philosophy Tone Pass - overloaded explanatory prose costs an instruction its trigger as well as its readability, and like imperative mood it survives an unaided review, so it now has its own numbered step in all three modes and a Minor-or-Major audit criterion; guide v3.4 carries the domain-neutral rules
  1.14.0 (2026-08-27): Rendered output is now verified rather than assumed - guide v3.3 requires reading the assembled persona end to end after every build, since partials and variables keep duplication, wrong substitutions and tone breaks out of the source diff; Create and Maintain gained a build-and-read step, Audit evaluates rendered coherence, and a clean build no longer counts as verification
  1.13.0 (2026-08-26): Constraints are now grouped under Core Rules - the guide pairs that heading with categorized rule groups, so the twelve flat bullets became six named groups (authority, scope, source integrity, published artifacts, documented deviations, bookkeeping); the rename was cleared with the user first, since the heading sits in a published artifact
  1.12.0 (2026-08-26): Self-audit fixes - added the missing Outputs section and a Decision Logic section defining the PASS/NEEDS WORK threshold the audit stamp hangs on; the reproduced Quality Checklist was replaced by a reference to the guide's own after drifting eleven items behind it; constraints and the tone-pass protocol now precede the mode workflows per the guide's ordering, the mode table moved into its own Operating Modes section, and the tone principle adopted the registry's canonical Stratified Authority name
  1.11.0 (2026-08-26): Metadata handling is now conditional on deployment - a persona pasted into a system-prompt field has no build step, so build-input fields are inapplicable and governance fields are the author's choice; Create asks where the persona will be deployed, Audit skips the stamp where no metadata exists, and bookkeeping no longer assumes a changelog to update
  1.10.1 (2026-08-26): Added an explicit guide lookup order - the filename is invariant, so the two conventional directories are probed first and a repository-wide search is the documented last resort rather than the default
  1.10.0 (2026-08-26): Replaced every hardcoded AI-Insights path with role terms - downstream consumers use a flat source layout, so the previous paths resolved to nothing outside this workspace; concrete values now live in the personas constraints (C5e)
  1.9.0 (2026-08-26): Added published-artifact constraints - project-specific content must not enter externally consumed files, and top-level heading renames in them are breaking changes because downstream sync scripts anchor on literal headings
  1.8.0 (2026-08-26): Philosophy Tone Pass extended to every sentence of a principle body, not just the opener; comparison-idiom titles exempted; added a canonical-name check against the project's principle vocabulary, reported as a finding where no registry exists
  1.7.0 (2026-08-26): Philosophy Tone Pass - dedicated protocol with its own workflow step in all three modes, catching positively framed imperatives in Operating Philosophy sections via the "You should" test; own philosophy section rewritten into the indicative mood
  1.6.0 (2026-08-26): design_notes metadata field - Audit mode reads documented guide deviations before evaluating and records them at the new Accepted severity instead of re-flagging them; Create and Maintain modes write entries; constraints guard against using the field to silence findings
  1.5.0 (2026-08-25): Audit mode stamps audit_guide_version and audit_date on persona YAML metadata for declarative compliance tracking
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
  Reduce

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
  2.3.2 (2026-09-10): research-brief-protocol split into a nested reader half (research-brief-reference, shared with the implementer personas) and an author half carrying the size guard and append rules — brief_tag replaced by brief_orientation, contribute-back trigger-anchored via brief_contribution_point, status line derived from brief_report_file; rendered review behaviour unchanged
  2.3.1 (2026-08-26): Rewrote all five Operating Philosophy principles into indicative mood per design guide v3.0; retitled "Confirm What Works", "Stay Within the Scope Boundary" and "Favor Durable Structures"
  2.3.0 (2026-08-25): Guide v2.8 audit — split alternative gathering from verdict assignment into separate phases; consolidated three overlapping criteria lists into one canonical Evaluation Dimensions set; added Scope Boundaries table; structured the Researcher delegation as its own workflow step; added research brief and contribute-back workflow checkpoints; removed the unreachable Audit Cycle Tracking rule
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

# research-brief-protocol partial
brief_orientation: "Entries tagged `[arch]`, and untagged entries, are the ones this review draws on"
brief_purpose: "orienting on the existing architecture"
brief_contribution_point: "during the design review"
brief_contributor: "Plan Architect Reviewer"
brief_authority: "independent exploration"
brief_report_file: "design-review.md"

# overview metadata
identity: "Principal Software Architect"
use_when: "Reviewing a plan's architectural decisions before implementation begins"
notes: "Runs in parallel with the Plan Auditor; never blocks it"

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.9.2 (2026-09-10): research-brief-protocol split into a nested reader half (research-brief-reference, shared with the implementer personas) and an author half carrying the size guard and append rules — brief_tag replaced by brief_orientation, contribute-back trigger-anchored via brief_contribution_point, status line derived from brief_report_file; rendered audit behaviour unchanged
  1.9.1 (2026-08-26): Retitled "Verify, Don't Trust" to "Claims Await Verification" per design guide v3.0 mood rule
  1.9.0 (2026-08-25): Design Guide v2.8 audit fixes — added Scope Boundaries table against the Plan
    Architect Reviewer, collapsed rules duplicated across Philosophy/Protocol/Checklist into single
    authoritative entries, restored tone stratification in Philosophy and Operational Protocol,
    replaced the "Flag Expedient Shortcuts" principle with a precedent-bounded Structural Durability
    dimension, aligned plan-edit rules with the Planner-owns-the-pen model and added a plan-integrity
    checkpoint, moved the Quality Checklist below Core Rules, restated finding discipline inside the
    output template, and normalised placeholders to SCREAMING_SNAKE
  1.8.0 (2026-08-25): Research Brief Protocol extracted into the shared research-brief-protocol partial; prohibitions consolidated under their own Constraints heading per Design Guide v2.8
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

# research-brief-protocol partial
brief_orientation: "Entries tagged `[verify]`, and untagged entries, are the ones this audit draws on"
brief_purpose: "grounding verification"
brief_contribution_point: "during the audit phases"
brief_contributor: "Plan Auditor"
brief_authority: "independent verification"
brief_report_file: "audit.md"

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.6.2 (2026-09-10): Added cc_tools override — Read, Grep, Glob, Task, TodoRead, TodoWrite; Task required for subagent dispatch
  1.6.1 (2026-08-26): Rewrote the Token Economy philosophy principle into indicative mood per design guide v3.0
  1.6.0 (2026-08-25): Design Guide v2.8 re-audit fixes — Phase 5 brought up to the structural standard of Phases 2–4 with stale-artifact deletion and write confirmation, the compound scenario step split into three single-delegation steps, a missing-artifact halt constraint added, the filesystem capability narrowed so it no longer authorizes plan writes, a max-audit-cycles bound check added to step 1, and CEILING_REACHED spelling unified with the emitted status token
  1.5.0 (2026-08-25): Design Guide v2.8 compliance — added an explicit divergence-comparison step to the audit loop, declared the INCOMPLETE terminal status, consolidated protocol constraints under their own headings, folded the scenario check in as Phase 5, and split the compound scenario workflow step
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

# cc_tools differs from default: Plan Refiner reads plan files and dispatches subagents only —
# no shell execution, no writes, no web access; Task is required for subagent dispatch.
cc_tools:
  - Read
  - Grep
  - Glob
  - Task
  - TodoRead
  - TodoWrite

subagents:
  - plan-architect-reviewer
  - plan-auditor
  - usage-scenarios-curator

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  2.3.0 (2026-08-31): v3.3/v3.4 delta pass — prose density applied to the shared philosophy partial
    and two workflow steps; rendered output read end to end for the first time
  2.2.0 (2026-08-26): Philosophy gained Refactoring Is Always on the Table and Adjacent Improvement Is the Only Improvement; maintenance surface folded into Long-Term Stability Over Expediency; Proportionality replaced by Justified Structure (anticipated growth is now a valid justification) plus a Refactoring & Adjacent Improvement group; new ## Structural Improvements plan section with brief observations and a promote-or-reject workflow step
  2.1.0 (2026-08-26): Shared content extracted into six planner-* partials with the ledger twin; gained Operating Philosophy, Capabilities, Rework Handling and a self-validation Quality Checklist; Core Rules gained role-boundary and output-integrity groups; deferred items now triaged instead of discarded; acceptance criteria gained AC-{NN} IDs; handoff now emits AGENT: Planner
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

# leaves the ledger-only plan sections out of planner-output-template.md
has_ledger_workflow: false
planner_implementer_ref: "implementer"

audit_guide_version: "3.4"
audit_date: "2026-08-31"

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
  1.6.1 (2026-09-10): Added cc_tools override — Task required for sub-agent dispatch; builder resolves cc_tools→tools, never default_cc_tools
  1.6.0 (2026-09-08): Added the An Adjective Is a Claim principle
    and a wording-verification step, and made The Manifest Wins Ties fire on the existing README's own claims —
    both close gaps where invented wording or stale claims survived a rewrite by looking like existing content.
    Displaced content is now placed, not just named: a size triage decides between a direct edit and dispatching
    the owning agent, with its own workflow step so stripped material never ends the session unplaced. Reduction
    pass: cut three Guiding Principles (Link Over Inline, A Plain Human Voice, Emojis as Anchors) that duplicated
    an existing Strict Constraint or the Output Template note with no added "why", and merged the Terminal Access
    and Whole-File Rewrite capability bullets, which described the same rm+create_file mechanic twice
  1.5.1 (2026-08-26): Renamed "Counts Age Badly" to the canonical "Durable Over Precise" per the personas constraint C5c principle registry
  1.5.0 (2026-08-26): Design Guide v2.8 audit fixes — reframed Operating Philosophy as positive values and de-imperativised the funnel table, Inputs, and Outputs; consolidated the three overlapping grounding constraints and added scope, deletion, link-verification, no-Git-write and no-meta-commentary rails; split the mixed research/production workflow steps and added a consolidated README brief between gathering and writing; added a session-start conditional checkpoint for the Synthesis Report and the rewrite-vs-edit decision; gave link verification its own step; restated the no-counts, no-architecture and copy-paste rules inside the Output Template slots; specified input paths and formats; removed redundant separators
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

# cc_tools: explicit list required — the builder resolves cc_tools from
# cc_tools → tools (never default_cc_tools), so the VS Code tools list
# would be used otherwise, which lacks Task.
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
  - TodoRead
  - TodoWrite

# Owning agents named in the documentation-ownership routing table, dispatched for
# changes the triage classifies as large. The deep-agents target takes its tools
# from the orchestrator's built-in suite, not from this file.
subagents:
  - agents-md-curator
  - documentation-curator
  - manifest-curator
  - changelog-curator
  - ctx-architect

audit_guide_version: "3.4"
audit_date: "2026-09-03"

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
  1.11.1 (2026-08-26): Documented the inline-reference-material deviation in design_notes - web-LLM deployment cannot access external documents, so the 60-Second Rule and reference extraction do not apply
  1.11.0 (2026-08-26): Design Guide v2.8 audit fixes - tone stratification across Philosophy, Protocol and both workflows; Recipe Ledger added as a durable counter sink with liveness marker; metric, language and template-fidelity rules restated inside the output templates; Survey Options split into Gather Candidates and Select; Session Opener, Bread Plan Check and Quality Checklist added; constraints regrouped as Core Rules with Household Boundaries, Process Discipline and Output Fidelity
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

audit_guide_version: "3.3"
audit_date: "2026-08-27"

design_notes: |
  Reference material stays inline (Household Kitchen Reference incl. the 19-row equipment table,
  Rainbow Eating Reference): this persona is deployed as a system prompt for web-based LLMs, where
  external documents cannot be reliably accessed. The usual "extract bulky reference material into
  a separate document" refactor is therefore not available, and the 60-Second Rule that the inline
  material breaks does not apply. Condensing the equipment table would drop capability detail the
  recipes actively use when mapping techniques onto available tools.

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
  1.3.1 (2026-08-26): Rewrote four Operating Philosophy principles from imperative into indicative mood per design guide v3.0
  1.3.0 (2026-08-25): Consolidated duplicated philosophy and rules content; positive-framed philosophy
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

audit_guide_version: "3.3"
audit_date: "2026-08-27"

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
  1.2.1 (2026-08-26): Renamed "Counts Age Badly" to the canonical "Durable Over Precise" per the personas constraint C5c principle registry
  1.2.0 (2026-08-26): Design Guide v2.8 audit fixes — reframed Operating Philosophy as positive values and de-imperativised Inputs and Outputs; added scope, file-write, reference-verification, coverage-padding and no-stale-counts constraints; converted the Output Template to a fenced block and moved its example rows into a Worked Example; added an Out of Scope report section and a nothing-found form for Technical Debt Observations; restated the no-counts and path-plus-line rules inside the template slots; split the workflow into audit and writing phases with a consolidated findings brief between them; added a Quality Checklist and the AX Feedback step; renamed Audit Protocol to Operational Protocol; specified input sources and the no-test-suite case; documented read-only command execution as a capability; removed redundant separators
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

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.2.1 (2026-08-26): Rewrote three Operating Philosophy principles from imperative into indicative mood per design guide v3.0
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
  1.7.2 (2026-09-10): Added cc_tools override — Task required for sub-agent dispatch; builder resolves cc_tools→tools, never default_cc_tools
  1.7.0 (2026-09-10): Gained optional research-brief.md consumption via the shared research-brief-reference partial — Interface Recon starts from its verified references; the brief is read-only here (only the Planner writes it, and it is deleted at archival), so it joins the byte-for-byte unchanged check and the plan folder now names three artefact classes
  1.6.0 (2026-09-10): Interface Insights split into Implementation Decisions and Follow-Up Items via a new `decision` type, added to the persona's own Observation Categories table and the shared insight-compilation partial's grouping rules; synthesis template renders both subsections, omitting whichever is empty
  1.5.0 (2026-09-10): Added Ad-Hoc Entry - authors a slim plan.md (with the Summary section archival needs) when the user requests GUI work directly with no plan document, so insight capture, synthesis, and archival run unchanged
  1.4.0 (2026-08-26): Design Guide v2.8 audit fixes - tone stratification across content sections; reference material moved before the protocol; verification split into three phases; added Rework Handling, Self-Validation Checklist, plan-source constraints, AX feedback and archival verification; scenarios checkpoint added to the workflow
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

# research-brief-protocol partial substitutions
brief_orientation: "Every area of the brief is in scope, whatever tags its entries carry"
brief_purpose: "Interface Recon"
brief_authority: "the current state of the code"

# cc_tools: explicit list required — the builder resolves cc_tools from
# cc_tools → tools (never default_cc_tools), so the VS Code tools list
# would be used otherwise, which lacks Task.
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
  - TodoRead
  - TodoWrite

subagents:
  - standalone-archiver

audit_guide_version: "3.2"
audit_date: "2026-08-26"

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
  1.1.1 (2026-08-26): Rewrote trailing imperative sentences in two philosophy principles into indicative mood
  1.1.0 (2026-08-25): Design Guide v2.8 audit — added Operating Philosophy, Capabilities, Outputs with location, scope boundary against the Changelog Curator, and a Quality Checklist; reordered sections to guide order; added the missing Rewrite-mode apply step and a conditional-case checkpoint to Generate; de-duplicated formatting rules against constraints; applied tone stratification; removed redundant separators
  1.0.1 (2026-03-04): Added persona ID field for VS Code agent registry
  1.0.0 (2026-02-25): Initial release — bilingual WHATSNEW.xml release note generation

audit_guide_version: "3.3"
audit_date: "2026-08-27"

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
  1.2.1 (2026-09-10): Added cc_tools override — Task required for sub-agent dispatch; builder resolves cc_tools→tools, never default_cc_tools
  1.2.0 (2026-08-27): Design Guide v3.3 audit fixes — the Delegation Protocol table no longer collapses into a paragraph in rendered output, a deep-agents branch replaced the wrong Claude Code invocation shape on that target, the duplicate Onboarding Stages table merged into a single Stage Table, Upgrade mode's "stale" classification gained criteria, two Strict Constraints duplicating sub-section constraint blocks were removed, and "Minimal Footprint" was renamed to the canonical "Every Artefact Earns Its Place" per the C5c principle registry
  1.1.1 (2026-08-26): Rewrote two Operating Philosophy principles into indicative mood per design guide v3.0; "Delegate, Don't Duplicate" retitled "Delegation Over Duplication"
  1.1.0 (2026-08-26): Design Guide v2.8 audit fixes — the six repeated delegation blocks were consolidated into one Delegation Protocol table carrying expected output and a verification check per stage, a shared Stage Execution protocol replaced Upgrade mode's single compound delegation step, a Session Entry workflow gave mode detection and the previously orphaned scope constraint their own rehearsed steps, a FAILED status and BLOCKED handoff made a failed stage distinguishable from a skipped one, two philosophy principles were reframed from prohibitions into values, and the content sections were rewritten out of imperative voice
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

# cc_tools: explicit list required — the builder resolves cc_tools from
# cc_tools → tools (never default_cc_tools), so the VS Code tools list
# would be used otherwise, which lacks Task.
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
  - TodoRead
  - TodoWrite

subagents:
  - manifest-curator
  - agents-md-curator
  - composer-curator
  - ctx-architect
  - readme-curator
  - changelog-curator

audit_guide_version: "3.3"
audit_date: "2026-08-27"

# overview metadata
identity: "Workspace Infrastructure Architect"
use_when: "Setting up a new repository for the AI Insights ecosystem, or upgrading an existing repo's infrastructure"
modes: |
  Onboard
  Upgrade

```