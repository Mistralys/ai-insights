# Personas Changelog

## v3.32.0 - **WIP UNRELEASED**
- Design Guide v2.9: accepted guide deviations had nowhere to live, so every audit re-derived the same
  findings and each auditor had to independently reason its way to the same conclusion; a new
  Governance Metadata section documents `design_notes` alongside the existing audit stamp fields.
- Standalone: Persona Curator now reads `design_notes` before evaluating and reports covered
  deviations at a new Accepted severity rather than as defects, with constraints preventing the field
  from being used to silence legitimate findings.
- Standalone: Recipe Curator records its inline reference material as an accepted deviation — the
  persona ships as a web-LLM system prompt, where external documents cannot be reached.
- Standalone: Recipe Curator maintained its conversation-wide recipe counter entirely from recall with
  no artefact, so a long session silently reset or duplicated IDs; a Recipe Ledger now opens at session
  start with a liveness line and is appended in its own workflow step after each recipe is written.
- Standalone: Recipe Curator stated its metric, chef's-language and template-fidelity rules hundreds of
  lines from where they fire; all three now appear as authoring instructions inside the output templates
  they govern, which is where the recorded regressions originated.
- Standalone: Recipe Curator's Survey Options gathered candidates and picked a winner in one phase, so
  selection began before the option set existed; gathering now closes with a candidate brief that a
  separate selection step consumes.
- Standalone: Recipe Curator read as an all-imperative monotone — Philosophy, Operational Protocol and
  both workflows commanded, and three philosophy principles were prohibitions in disguise.
- Standalone: Recipe Curator had no self-validation despite being terminal, and its optional Bread Plan
  had no rehearsal; a Quality Checklist and a Bread Plan Check step now close both gaps.
- Standalone: Recipe Curator's household prohibitions lived inside the Culinary Identity reference
  rather than the constraints; they now form a Household Boundaries rule group alongside new Process
  Discipline and Output Fidelity groups under a renamed Core Rules heading.
- Standalone: Workspace Architect repeated the same target-conditional delegation block six times and
  never named an expected output or ran a verification check, so a sub-agent that returned without
  writing its artefact let the next stage proceed on a dependency that did not exist.
- Standalone: Workspace Architect's summary offered only CREATED/UPDATED/SKIPPED, making a failed
  stage indistinguishable from a deliberately skipped one; FAILED and a BLOCKED handoff now separate
  them, and every non-created stage must name its cause.
- Standalone: Workspace Architect resolved its operating mode inside an optional input description
  and declared a scope constraint no step ever consumed; both now have their own Session Entry steps.
- Standalone: Workspace Architect's Upgrade mode collapsed all six delegations into one compound
  step and mixed presence discovery with staleness judgment; stage execution is now a shared protocol
  and the audit is split from the assessment.
- Standalone: Workspace Architect framed two philosophy principles as prohibitions and wrote its
  detection, triage and stage sections in imperative voice, leaving the constraints without signal.
- Standalone: Communications Curator described five output shapes in prose with no templates, so the
  no-superlative, no-counts and no-implementation-detail rules never reached the point where they
  fire; each mode now has an Output Template carrying those rules as authoring instructions.
- Standalone: Communications Curator gathered facts, chose a mode and drafted inside overlapping
  workflow steps; reading, brief compilation, structure and prose are now four separate phases.
- Standalone: Communications Curator's ask-before-writing and gap-reporting duties were sub-clauses
  with no mandatory slot, so a skipped check and a clean run read identically; both now have their
  own workflow step and the brief's Gaps section requires an explicit nothing-found statement.
- Standalone: Communications Curator read as an all-imperative monotone — Philosophy, Inputs,
  Outputs and the content type guidelines all commanded, and two philosophy principles duplicated
  constraints outright.
- Standalone: Communications Curator held edit tools with no file-write boundary and no
  meta-commentary rail, and four of its constraints named no alternative action.
- Standalone: Web GUI Specialist read as an all-imperative monotone — Philosophy, Inputs, Outputs
  and the GUI heuristics reference all commanded, leaving the constraints section without signal.
- Standalone: Web GUI Specialist's GUI heuristics reference sat after the protocol that needs it,
  and its single "Verification Stack" step merged functional, accessibility and static checks into
  one phase; verification is now three separate phases with the reference moved ahead of them.
- Standalone: Web GUI Specialist's workflow restated the Operational Protocol's documentation,
  verification and compilation steps, creating two competing procedures for the same work.
- Standalone: Web GUI Specialist had no Rework Handling path, so a second pass would rename the
  plan folder again and desynchronise the slug already recorded in the ledger.
- Standalone: Web GUI Specialist gained a Self-Validation Checklist — as a terminal standalone
  agent only the archiver ran after it, and the archiver validates the ledger entry, not the UI.
- Standalone: Web GUI Specialist could rewrite `plan.md` or an authored `usage-scenarios.md`
  unchallenged; both are now protected by constraints, and the optional-scenarios rule gained a
  workflow checkpoint so it is rehearsed every session rather than only when it applies.
- Standalone: Web GUI Specialist's no-counts rule fired at generation time but was stated only in
  the constraints; it is now restated inside the synthesis template slots where it applies.
- Standalone: Web GUI Specialist's observation reporting rules scattered prohibitions across
  numbered items, and its archiver delegation named no expected output or verification step.
- Standalone: Unit Test Auditor cited functions and line numbers with no rule requiring they be
  verified first, and nothing bounded the audit to the files the user actually named.
- Standalone: Unit Test Auditor's report was written from recall of the analysis phase; findings
  are now consolidated into a brief with verified paths before any report prose is written.
- Standalone: Unit Test Auditor's no-counts rule was philosophy-only and absent from the template
  slot where it fires; it is now a constraint and an authoring instruction in the summary slot.
- Standalone: Unit Test Auditor's Technical Debt slot read identically whether the agent found
  nothing or never looked, and now requires an explicit "testable as written" statement.
- Standalone: Unit Test Auditor gained a self-validation Quality Checklist, an Out of Scope report
  section for adjacent risks, and the file-write boundary it lacked despite holding edit tools.
- Standalone: Unit Test Auditor's Output Template mixed placeholders with worked example rows; the
  examples moved into their own Worked Example section.
- Standalone: Documentation Curator's Update mode had no verification step at all, and Create mode
  verified claims only after writing them — all three modes now share one research protocol that
  gathers and verifies facts into a brief before any prose is written.
- Standalone: Documentation Curator's README, manifest and CTX delegations lived only in a rules
  list; they now carry conditions, inputs, expected outputs, a review step and a scope boundary
  table, plus a session-start checkpoint that rehearses all three conditions every session.
- Standalone: Documentation Curator gained a self-validation Quality Checklist — as a terminal
  standalone agent it had nothing catching errors before the user saw them.
- Standalone: Documentation Curator's no-stale-counts rule was philosophy-only and unenforced; it
  is now a constraint and is restated inside the report and summary template slots where it fires.
- Standalone: Documentation Curator's Update mode produced an untemplated freeform summary — the
  one place a stale count most easily leaks — and now has a change summary template.
- Standalone: Documentation Curator's audit-mode read-only rule and create-mode approval gate were
  buried inside workflow steps; both are now constraints.
- Standalone: README Curator's Guiding Principles were a list of prohibitions ("avoid jargon",
  "never use 'As an AI…'") competing with Constraints; they now read as values.
- Standalone: README Curator gained the scope, deletion-bounding and no-Git-write rails it lacked
  despite holding `rm` authority, and its three overlapping grounding constraints merged into one.
- Standalone: README Curator's Quality Checklist asserted every link exists, but nothing verified
  them — link targets are now checked against the filesystem in their own workflow step.
- Standalone: README Curator separates capability gathering from benefit rewriting and compiles a
  verified README brief before any prose is written.
- Standalone: README Curator checks for a Synthesis Report and settles the rewrite-vs-edit choice
  at session start, so both conditionals are rehearsed even when they do not apply.
- Standalone: README Curator's no-counts, no-architecture and copy-paste rules are restated inside
  the Output Template slots where they fire, not only in Constraints.
- Standalone: Git Committer's `git mv` safety constraint had a line break mid-word ("not move d"),
  corrupting the one rule that guards against permanently destroying un-moved plan files.
- Standalone: Git Committer's plan archival inventory is now defined once as the "archival set" —
  four separate restatements had drifted apart, two of them omitting `usage-scenarios.md`.
- Standalone: Git Committer separates plan inventory gathering from thematic grouping, so folder
  scanning and synthesis checks complete before any grouping decision is committed to.
- Standalone: Git Committer's optional companion files (`request.md`, `usage-scenarios.md`,
  `insights.jsonl`) are checked every session rather than only when a plan happens to match.
- Standalone: Git Committer's subject-line rules are restated inside the review template slot
  where they fire, and the Upstream Integration procedure consolidates its own constraints.
- Standalone: Developer gained an Operating Philosophy, a Rework Handling section, and a
  Self-Validation Checklist — as the terminal agent for standalone plans it previously had no
  safety net before the user, and no guidance for the judgment calls implementation demands.
- Standalone: Developer's rework re-entry no longer renames an already-archived plan folder,
  which broke `plan.md` path references and desynchronised the recorded ledger slug.
- Standalone: Developer's verification step split into build/regression, acceptance-test
  authoring, and static-analysis phases, separating test production from test execution.
- Standalone: Developer's Workflow no longer repeats the documentation, verification and insight
  steps its own Operational Protocol already performed, and the archiver dispatch now states its
  expected output and verifies the returned slug.
- Standalone: Developer's Code Insight Observer consolidates its prohibitions under a Constraints
  heading, and the no-stale-counts rule is restated inside the synthesis template slots where it
  fires rather than only in Constraints.
- Standalone: Changelog Curator no longer writes to the changelog before the user approves the
  draft — Generate presented its entry after inserting it, and Rewrite never wrote at all.
- Standalone: Changelog Curator gained the Inputs, Capabilities, Outputs and Quality Checklist
  sections it was missing, plus an Operating Philosophy for its impact-weighting judgment calls.
- Standalone: Changelog Curator drafts from a compact change inventory rather than from recall of
  the Git history, and checks its breaking, deprecation and file-heading cases every session.
- Standalone: Changelog Curator's line-length and no-identifiers rules restated inside the Entry
  Format template slots where they fire, and a scope boundary drawn against the WHATSNEW Curator.
- Shared: New `research-brief-protocol` partial replaces the near-duplicate protocol previously
  maintained in both the Plan Auditor and Plan Architect Reviewer, parameterised over five
  `brief_*` variables so the two personas keep their distinct tags, purposes, and report files.
- Standalone: Plan Auditor gained a research-brief existence checkpoint, a contribute-back step,
  and a **Research brief** report line, so the brief's read-only and absent cases are
  distinguishable rather than silent.
- Standalone: Plan Auditor gained a Scope Boundaries table against the Plan Architect Reviewer,
  replacing the territory assertions previously repeated across six locations.
- Standalone: Plan Auditor's "Flag Expedient Shortcuts" principle replaced by a Structural
  Durability dimension bounded to in-repo precedent, resolving the contradiction with its own
  no-architectural-critique scope.
- Standalone: Plan Auditor no longer edits `plan.md` or its audit-cycle counter, matching the
  Plan Architect Reviewer and the Planner-owns-the-pen model; a plan-integrity checkpoint enforces it.
- Standalone: Plan Auditor redesigned for Design Guide v2.8 compliance — tone stratification
  restored in Philosophy and Operational Protocol, finding discipline restated inside the output
  template where it fires, and the Quality Checklist moved below Core Rules.
- Standalone: Plan Architect Reviewer now gathers and verifies alternatives in a phase of its own
  before any verdict is formed, so no Challenge verdict rests on an unverified premise.
- Standalone: Plan Architect Reviewer's three overlapping criteria lists collapsed into one
  canonical Evaluation Dimensions set that the protocol and output template both draw from.
- Standalone: Plan Architect Reviewer gained a Scope Boundaries table against the Plan Auditor,
  replacing the border assertions previously scattered across five blockquotes.
- Standalone: Plan Architect Reviewer's Researcher delegation restructured as its own workflow
  step with declared inputs, expected output, and a verifiability review.
- Standalone: Plan Architect Reviewer gained research-brief and contribute-back workflow
  checkpoints, so the brief's read-only and absent cases are distinguishable in the report.
- Standalone: Removed the Plan Architect Reviewer's unreachable Audit Cycle Tracking rule, which
  contradicted its own do-not-rewrite-the-plan constraint; the Planner owns the counter.
- Standalone: Plan Refiner's scenario phase brought up to the structural standard of its older
  phases — stale-artifact deletion, a write confirmation, and one sub-agent per workflow step,
  replacing a single step that bundled three delegations.
- Standalone: Plan Refiner's filesystem capability no longer authorizes plan writes, resolving the
  contradiction with its own let-the-Planner-hold-the-pen constraint.
- Standalone: Plan Refiner halts rather than proceeding when a delegated sub-agent produces no
  artifact, and validates a user-supplied audit-cycle ceiling against its declared 1–10 bound.
- Standalone: Plan Refiner gained an explicit divergence-comparison step in the audit loop, so the
  DIVERGING verdict its Decision Logic defines is now actually detected.
- Standalone: Plan Refiner declares the INCOMPLETE terminal status in Decision Logic and its
  refinement log template, matching the status its workflow could already emit.
- Standalone: Plan Refiner redesigned for Design Guide v2.8 compliance — protocol prohibitions
  consolidated under their own Constraints headings, the usage scenario check folded in as
  Phase 5, and its compound workflow step split into detect, resolve, and verify steps.
- Standalone: Module Intent Architect redesigned for Design Guide v2.8 compliance \u2014 the workflow
  now separates fact-gathering from drafting via a module brief, and a `docs/` existence check
  plus a dependency-link survey run every session.
- Standalone: Module Intent Architect gained scope boundaries against the README and Manifest
  Curators, link-integrity and stay-inside-the-module constraints, a self-validation step, and
  no-counts authoring instructions in its output template slots.
- Standalone: Module Intent Architect restored tone stratification \u2014 the no-counts prohibition
  moved out of Operating Philosophy into Strict Constraints as a "Durable Over Precise" value.
- Standalone: Manifest Curator now applies tone stratification to the manifests it generates — a
  Register Map marks `constraints.md` as the only imperative document and the rest as descriptive.
- Standalone: Manifest Curator redesigned for Design Guide v2.8 compliance — added Scope
  Boundaries against the AGENTS.md Curator and CTX Architect, an audit severity scale, a
  read-only Audit constraint, and the previously missing no-counts rule.
- Standalone: Manifest Curator CTX delegation extracted into one self-contained sub-section with
  its own constraints, replacing the block duplicated across the Create and Update workflows.
- Standalone: Manifest Curator gained explicit CTX-status checkpoints in all three modes, so a
  project that became CTX-enabled after its manifest was written is detected.
- Standalone: Fixed the Manifest Curator discrepancy report template rendering as broken
  Markdown from unescaped pipes in its example row.
- Standalone: CTX Architect redesigned for Design Guide v2.8 compliance — restored tone
  stratification across Philosophy, Outputs and the CTX Generator Reference, and moved the
  prohibitions those sections carried into Strict Constraints.
- Standalone: CTX Architect gained safety-rail constraints (no Git writes, no silent overwrite
  of an existing README or module config, read-only Audit mode), an Audit Report template, and
  handoff plus self-validation steps in all four mode workflows.
- Standalone: CTX Architect Audit mode is now declared in its overview metadata, so the
  generated agents overview reports all four modes.
- Standalone: AGENTS.md Curator now applies tone stratification to the documents it generates,
  not just to itself — a Register Map assigns each AGENTS.md section an imperative or
  descriptive voice, replacing the blanket "Authoritative Tone" principle.
- Standalone: AGENTS.md Curator gained a Document Voice rule group, a matching self-validation
  item, and an Audit-mode voice check that flags all-imperative documents.
- Standalone: AGENTS.md Curator redesigned for Design Guide v2.8 compliance — reversed the
  v1.2.0 imperative-voice rewrite to restore tone stratification, promoted Operating Modes to
  its own section, and regrouped Core Rules into scannable imperative rule groups.
- Standalone: AGENTS.md Curator gained a severity scale for audit reports, handoff steps in all
  three mode workflows, and a no-counts authoring instruction in the Project Stats template
  slot; dropped the redundant Workflow Summary flowchart.
- Standalone: Researcher consolidated — merged Research Depth and Hallucination Prevention into
  a single Grounding & Verification rule group, removed rules duplicating Operating Philosophy,
  and re-framed philosophy principles as values rather than prohibitions. No behaviour change.
- Standalone: WHATSNEW Curator redesigned for Design Guide v2.8 compliance — added Operating
  Philosophy, Capabilities, Outputs with location, scope boundary against the Changelog
  Curator, and a Quality Checklist; reordered sections to guide order.
- Standalone: Fixed WHATSNEW Curator Rewrite mode never writing its approved entries, and
  added a Generate checkpoint for unmapped categories and user-facing database changes.
- Standalone: Composer Curator redesigned for Design Guide v2.8 compliance — added Outputs
  and Strict Constraints sections, extracted Capabilities, reformatted Workflow with bold
  step names, applied tone stratification, promoted AGENTS.md check to explicit workflow step.

## v3.31.0 - Insight Channel Consolidation and Usage Scenarios Curator

**Ledger agents now route code observations through `ledger_add_observation` instead of writing
to a local sidecar file, giving each observation permanent storage and an optional `loc` field
for file-level context.** A new Usage Scenarios Curator joins the standalone roster for plan
scenario generation and deterministic coverage checks.

- Ledger: Developer, QA, Security Auditor, Reviewer, Documentation, and Synthesis now
  capture observations via `ledger_add_observation` with per-persona `insight_pipeline_type`.
- Ledger: Fixed stale `outputs` metadata in 5 personas still referencing insights.jsonl.
- Shared: Reviewer Deep Dive split into review + capture loop for Pattern 15 compliance.
- Shared: Added nothing-found forcing functions to QA, Security Auditor, Reviewer, and
  Documentation observer sections (Pattern 6 parity with Developer).
- Shared: Added `mcp-insight-capture` partial; drives per-action MCP observation calls with
  action-gating and pipeline-completion fallback for failed calls.
- Shared: Insight compilation partial gains `insight_consumer_only` mode; reads all sink
  entries regardless of author for accurate cross-agent compilation.
- Shared: Re-integrated all single-use partials into their respective ledger personas.
- Standalone: Developer, Web GUI Specialist, and Git Committer gain sidecar insight capture.
- LedgerSupport: Archiver personas classify insight files at the archival boundary.
- Standalone: Added Usage Scenarios Curator for plan scenario generation and coverage checks.
- Standalone: Plan Refiner gains opt-in scenario verification with a bounded re-check.
- Standalone: Key handoff agents preserve usage-scenarios.md through handoffs.
- Standalone: Git Committer gains delete guard and request.md archival support.
- Ledger: Retired WP spec file mechanism; agents 3–9 now source specs from the ledger.
- Ledger: PM uses the ping tool for preflight instead of help.
- Ledger: Security Auditor — removed incorrect REWORK action from the workflow.
- LedgerSupport: Bootstrapper protocol reduced from 7 to 5 steps.
- Docs: Persona Design Guide v2.7 — Tone Stratification added to Core Philosophy.
- Standalone: Persona Curator v1.4.0 — updated to reflect Tone Stratification.
- Build: Added agents-overview generator with overview metadata fields.
- Build: Model assignments updated to claude-sonnet-4-6; added `insight_agent` validation.
- Build: Fixed model assignment resolution to use model name instead of internal slug.

## v3.30.0 - New Personas and AX Feedback

- LedgerSupport: Added Orchestrator Archaeologist persona for forensic run artifact analysis.
- Standalone: Added Web GUI Specialist persona for engaging, visually optimized web interfaces.
- Ledger/Standalone: All key agents gain an AX Feedback pre-handoff step for structured
  self-reporting; extracted into a reusable shared partial.
- Standalone: Plan Refiner overhauled with research brief enrichment, incremental re-audit,
  sub-agent contribution, and a brief size guard; gains skip-architectural-review mode.
- Standalone: Plan Auditor and Plan Architect Reviewer gain Research Brief Protocol for
  self-managed brief usage and contribution.
- Standalone: Planner now includes a workflow recommendation section in plan output.

## v3.29.0 - Operating Philosophy and Project Summary Protocols

- Ledger: Planner, Developer, and Reviewer gain an Operating Philosophy section.
- Standalone: Plan Architect Reviewer and Plan Auditor gain an Operating Philosophy section.
- LedgerSupport: Bootstrapper and Archiver gain `project_summary` crafting protocol.
- Shared: Extracted summary-crafting guide into a reusable shared partial.

## v3.28.0 - Planner Research Phase and Archiver Modes
- Standalone: Changelog Curator gains release summary — optional prose paragraph with house style rules.
- Ledger: Planner gains a dedicated codebase research phase before plan design begins.
- Standalone: Planner gains same dedicated codebase research phase.
- LedgerSupport: Standalone Archiver gains Import/Update operating modes.
- LedgerSupport: Standalone Archiver integrates `ledger_update_synthesis` in Update mode.
- Standalone: Git Committer gains timestamp guard for generated-file commit filtering.

## v3.27.0 - Plan Folder Date-Rename and WP Enforcement Hardening
- Ledger: PM gains step 2 to rename plan folder date prefix to today before decomposition.
- Standalone: Developer gains step 1 to rename plan folder date prefix to today before implementation.
- LedgerSupport: WP Decomposer gains deliverable-AC parity enforcement for state-changing operations.
- LedgerSupport: Pipeline Configurator gains state-changing operation guardrail for verification-only WPs.

## v3.26.0 - Standalone Archiver and New Curators
- Build: Replaced hardcoded persona list with a dynamic directory scan.
- Build: Updated persona-builder dependency.
- Ledger: WP decomposition and AC setup hardening across the board.
- Ledger: Developer gains subagent archival dispatch for completed standalone work.
- Ledger: Planner Synthesis Rework triages deferred items; top items promoted into plan steps.
- Ledger: Planner handoff now includes a recommended workflow.
- LedgerSupport: Added the standalone-archiver persona.
- LedgerSupport: Dependency Sequencer audit compliance and codebase verification.
- LedgerSupport: WP Decomposer gains codebase verification with Code Observations output.
- LedgerSupport: Dependency Sequencer consumes upstream Code Observations.
- Standalone: Added Workspace Architect for repo onboarding and ecosystem maintenance.
- Standalone: Added Communications Curator for stakeholder briefs and release notes.
- Standalone: Git Committer hardened with upstream integration and edge-case guards.
- Standalone: Plan Architect Reviewer improvements.
- Standalone: Recipe Curator restructured into Operating Modes with preview step.
- Docs: Updated Persona Design Guide to v2.2 with separator-handling guidance.

## v3.25.0 - Ledger-Support Suite
- Build: Introduced `ledger-support` as a dedicated third suite for MCP-dependent support personas.
- Global: Added a "Counts are a maintenance liability" to multiple personas.
- Global: Added persona-integrated YAML changelogs.

## v3.24.0 - Recipe Curator and Per-Persona Changelogs
- Standalone: Added Recipe Curator for household meal planning with rainbow eating principles,
  nutritional targets, world cuisine variety, and weekly recipe generation.
- Standalone: Added Ledger Knowledge Curator for knowledge store management with deletion guard.
- Standalone: Knowledge Archiver renamed to Ledger Knowledge Archiver.
- Standalone: Knowledge Curator: Deletions now require explicit user confirmation.
- Standalone: Persona Curator: Create workflow updated to use `changelog:` block scalar.
- All: All 37 persona YAML source files gain an integrated `changelog:` metadata field.

## v3.23.0 - Planner Repository History and Standalone Planner
- Ledger: Planner gains repository history access via `ledger_get_repository_context`.
- Ledger: Planner content restructured; shared partials inlined.
- Standalone: Added Planner — ledger-independent variant for non-ledger workflows.
- Ledger: Synthesis gains deferred items collection to the operational protocol.
- Standalone: Plan Architect Reviewer: Improved review philosophy.
- Standalone: Knowledge Archiver gains local archiving task marker file support.

## v3.22.0 - Persona Improvements
- Standalone: Ledger Doctor: Added holistic repair philosophy and routing verification.
- Standalone: Ledger Doctor: Refreshed workflow knowledge.
- Standalone: Ledger Doctor: Added project recovery tool, improved repair procedure.
- Standalone: Plan Refiner: Wording improvements to remove overly imperative instructions.
- Standalone: Plan Refiner: Handoff improvements to give subagents more agency.
- Standalone: Plan Auditor: No longer nags about navigational aids like line positions.
- Standalone: CTX Architect Variable examples escaped to fix warnings.
- Standalone: CTX Architect: Updated integrated knowledge.
- Standalone: WP Decomposer: Integrated some live usage insights.
- Standalone: WP Decomposer: Added the test-bundling rule within the same WPs.
- Standalone: Added Knowledge Archiver persona for retrospective extraction from archived projects.
- Standalone: Researcher, Plan Architect Reviewer, Plan Auditor, and Developer gain `browser` tool.
- Standalone: Git Committer: Excludes CTX files from commits on feature branches.
- Standalone: Git Committer: Checks for upstream and default-branch divergence before committing.
- Ledger: Synthesis: Knowledge extraction now delegated to the Knowledge Archiver.
- Ledger: Developer, QA, Security Auditor, and Reviewer gain `ledger_search_insights` for lookups.
- Ledger: Developer, QA, and Security Auditor gain `browser` tool for UI and security verification.
- Build: Upgraded Persona Builder to [v2.5.1](https://github.com/Mistralys/ai-persona-builder/releases/tag/v2.5.1).

## v3.21.0 - Plan Refiner and Persona Improvements
- Standalone: Added Plan Refiner — orchestrates iterative plan refinement with repeated auditing.
- Standalone: Plan Auditor gained implementer-friction filter to suppress low-value findings.
- Standalone: Git Committer now handles `implementation-history` organized into subfolders.
- Ledger: Planner gained a Synthesis rework mode.

## v3.20.0 - Plan Audit Tracking and WP Context Preservation
- Standalone: Plan Auditor (v1.3.0) and Plan Architect Reviewer (v1.4.0) gain Audit
  Cycle Tracking — increment `## Plan Audit Cycles` counters when directly modifying `plan.md`.
- Ledger: Planner (v1.4.2) initializes `## Plan Audit Cycles` on new plans and updates
  counters during rework; shared output template gains the section.
- Standalone: WP Decomposer (v1.0.5) adds `Plan Context`, `Rationale`, and
  `Rejected Approaches` fields so implementing agents have full design intent in isolation.
- Standalone: WP Decomposer handoff now emits `NEXT`, `WORK_PACKAGES`, and
  `PLAN_DOCUMENT` fields; instructs invoker to pass file paths to the Dependency Sequencer.
- Standalone: Bootstrapper (v1.1.0) expands WP spec template to carry all draft fields
  verbatim; forbidden from summarizing or dropping any section.
- Ledger: PM (v3.7.3) verification gate now enumerates all WP fields, catching stripped
  spec files.
- Standalone: Pipeline Configurator write step references Output Location instead of
  repeating the path; Dependency Sequencer gains the missing write step.
- Ledger: Improved PM (v3.7.2) subagent invocations.

## v3.19.0 - Plan Review Toolchain
- Standalone: Added Plan Architect Reviewer (v1.3.0) — advisory architectural design
  review with `Simplifications`, `Concerns`, and `Affirmations` vocabulary; runs in
  parallel with Plan Auditor and never blocks the workflow.
- Standalone: Plan Auditor (v1.2.0) narrowed to technical defects only; gained
  Test Plan and Documentation Updates required-sections checks in Phase 1.
- Ledger: Planner (v1.4.1) gains Considered Alternatives, Pattern Alignment, Test Plan,
  and Documentation Updates plan sections; adds Proportionality and Pattern Alignment
  Core Rules; adds plan-stage rework step to address pre-merged review findings.

## v3.18.1 - Git Committer Plan Relocation Fix
- Standalone: Git Committer now moves both `plan.md` and `synthesis.md` to implementation history (was only moving `synthesis.md`).

## v3.18.0 - Git Committer Persona
- Standalone: Added Git Committer persona for structured commit workflows.
- PM: Fixed preflight partial to be target-aware for headless orchestrator runs.

## v3.17.0 - New Personas and Standalone Rewrites
- Standalone: Added Plan Auditor persona.
- Standalone: Added Documentation Curator persona.
- Standalone: Rewrote 6 personas to imperative voice.
- Standalone: Comprehensive AGENTS.md Curator rewrite.
- Standalone: Improved Persona Curator mission statement.
- Ledger: Documentation now delegates to CTX Architect sub-agent.
- Ledger: Fixed Dependency Sequencer missing edit capabilities.
- Docs: Improved persona design guide.

## v3.16.1 - Windows Compatibility Fix
- Build: Fixed CRLF line-ending handling in the YAML scalar parser.

## v3.16.0 - Subagent Slug Validation
- Build: Added `{{agent_slug_*}}` cross-reference validation to the build.
- Build: Upgraded `@mistralys/persona-builder` to v2.4.1.
- PM: Fixed `subagent:` → `subagent_type:` in deep-agents dispatch blocks.
- PM: Declared subagents for the orchestrator.

## v3.15.0 - Standalone Persona Overhaul
- Standalone: Renamed 6 ledger-related personas with `ledger-` prefix.
- Standalone: Added Persona Curator, Ledger Claude Coordinator,
  and Ledger WP Decomposer personas.
- Standalone: Removed legacy Workflow Orchestrator and WP Decomposer.
- Standalone: Audited and improved all existing personas.
- Standalone: Restructured PM subagents and updated roster partial.
- Ledger: Brought subagents up to spec.
- Ledger: Improved Project Manager and Synthesis persona content.
- Build: Output directories pre-cleaned before each build.
- Docs: Improved persona design guide; fixed guide contradiction.

## v3.14.1 - Build Pre-Clean

- Build: Output directories are now cleaned before each build, removing
  stale files from renamed or deleted personas.
- Build: Pre-clean is skipped in `--check` / `--dry-run` mode.

## v3.14.0 - Deep-Agents, Elseif & Name Mapping

- Build: Added `deep-agents` as a third persona output target; 81 files built across
  3 targets (vs-code, claude-code, deep-agents).
- Build: Added `da_file_name` metadata field to all 9 ledger persona YAMLs.
- Build: Added `personas/name-mapping.json` generation with per-target agent names for
  `vscode`, `claude_code`, and `deep_agents`.
- Build: Updated persona builder to [v2.3.0](https://github.com/Mistralys/ai-persona-builder/releases/tag/2.3.0).
- Engine: Fixed nested `{{#if}}` resolution with innermost-first multi-pass algorithm.
- Project Manager: Deep-agents output uses `task(subagent: ...)` calls; subagent handoffs
  now declare all targets explicitly.
- CC Handoff: Simplified partial to use `auto_handoff.cc_agent_name` reference.
- Personas: Added deep agent handoff blocks across all ledger personas.
- Personas: Applied `elseif` to eliminate duplicate conditional branches.
- CTX Architect: Fixed import glob syntax for newer CTX versions.

## v3.11.1 - Model Slug Metadata
- Build: Added `model_slug` and `default_model_slug` metadata fields.
- Build: Ledger plugin now exposes `model_slug` as a template variable.

## v3.11.0 - New Personas & Local Ledger Plugin
- Core: Extracted the persona building into the node library `@mistralys/persona-builder`.
- New Agent: Standalone Developer persona.
- New Agent: Ledger Workflow Doctor persona.
- Build: Migrated ledger plugin to local `personas/plugins/ledger/`.
- Build: Added agent name variables (e.g. `{{agent_researcher}}`).
- Project Manager: Fixed subagent calls not using custom agent names.

## v3.10.7 - Orchestrator Runner: Document --depth N Flag
- Orchestrator Runner v1.5.1 — troubleshooting table now mentions `--depth N`
  for `kill-orchestrator.js` lock-file scan depth (default 20).

## v3.10.6 - Orchestrator Runner: Log & Process Scripts
- Orchestrator Runner v1.5.0 — replaced jq/grep/tail log monitoring with read-log.js.
- Orchestrator Runner v1.5.0 — added kill-orchestrator.js for process-conflict resolution.

## v3.10.5 - Orchestrator Runner Feature Sync and Fixes
- Orchestrator Runner v1.4.0 — updated JSONL event count from 16 → 20.
- Orchestrator Runner v1.4.0 — added `CAPTURE_DIALOGUES` and `HEARTBEAT_INTERVAL_S` env vars.
- Orchestrator Runner v1.4.0 — documented log archival to `{slug}/orchestrator/logs/`.
- Orchestrator Runner v1.4.0 — removed stale `--checkpoint` extra requirement (now default).
- Orchestrator Runner v1.4.1: Polling the terminal in a tight loop.
- Orchestrator Runner v1.4.1: Misreading the JSONL log schema.
- Orchestrator Runner v1.4.1: Making incorrect go/no-go decisions after a dry run.

## v3.10.4 - Reviewer Documentation-Forward Protocol
- Partials: Expanded Reviewer `documentation-forward` convention with a named-convention spec, JSON `pipeline_comment` schema with `priority` field, and four concrete examples.

## v3.10.3 - Reviewer Feedback Tiers
- Reviewer now uses three-tier feedback (Blocking,
  Fix-Forward, Documentation-Forward) instead of binary pass/fail.
- Reviewer applies trivial non-behavioral fixes directly.
- Documentation agent checks reviewer-forwarded items.

## v3.10.2 - Orchestrator Runner: JSONL Event Coverage
- Orchestrator Runner v1.3.0 — restructured progress
  monitoring to use live terminal output as primary channel.
- Orchestrator Runner v1.3.0 — expanded event coverage
  to all 16 JSONL event types with duration fields reference.

## v3.10.1 - Release Engineer: Delegate Changelog & CTX
- Release Engineer v3.7.0 — delegates changelog curation
  to Changelog Curator sub-agent.
- Release Engineer v3.7.0 — delegates CTX updates to CTX
  Architect sub-agent.
- Partials: Updated release engineer operational protocol.

## v3.10.0 - AGENTS.md Curator: CLAUDE.md Companion
- AGENTS.md Curator v1.1.0 — now creates a CLAUDE.md companion file.
- Docs: Split constraints into build-system and cross-system sub-documents.
- Docs: Added persona versioning constraint.

## v3.9.3 - CTX Architect: Tree Exclusion Guidance
- CTX Architect v1.1.0 — added `notPath` vs `excludePatterns` warning
  for tree vs file source types (silent ignore bug).
- CTX Architect v1.1.0 — added constraint to always exclude package
  manager artifacts (`node_modules/`, `vendor/`, `.venv/`, etc.) from tree sources.

## v3.9.2 - Preflight & Docs Cleanup
- Simplified Orchestrator Runner preflight to a single script call.
- Docs: Removed `file-tree.md` from the persona manifest.

## v3.9.1 - Helper Unification & Strict-Mode Robustness
- Build: Unified `validateCcFileName` and `validateVsFileName` into a single `validateFileName` helper.
- Build: Fixed `--strict` false-positive by stripping fenced code blocks before scanning for unresolved markers.
- Updated Unit Test Auditor description to verb-forward, purpose-specific text.
- Docs: Added named anchors to all 47 constraints; updated cross-references.

## v3.9.0 - Build Pipeline Fixes & `mcpServers` Auto-Injection
- Build: Fixed VS Code output filenames to use YAML-declared `vs_file_name` instead of template basename.
- Build: Standalone Claude Code personas with MCP tools now receive `mcpServers` auto-injection in frontmatter.
- `ledger-bootstrapper` Claude Code build now includes `mcpServers: central_pm` in frontmatter.
- Docs: Renumbered all constraints to a clean sequential 1–47 scheme.
- Docs: Updated standalone README to document MCP server auto-injection.

## v3.8.1 - 9-Agent Personas (Post-Synthesis Polish)
- Docs: Added `personas/standalone/README.md` — user-facing guide for all 15 standalone personas.
- Docs: Added pipeline stage ordering and WP ID auto-generation constraints.
- Docs: Updated `personas/ledger/README.md` for the 9-agent workflow layout.
- Reviewer (6) mission statement now scopes security to the dedicated Security Auditor.
- Partials: Added explicit comment type documentation to `release-engineer-output-format.md`.

---

## v3.8.0 - 9-Agent Personas & PM Sub-Agents
- Added Security Auditor v3.6.1 at pipeline position 5 with OWASP A01–A10 coverage.
- Added Release Engineer v3.6.1 at pipeline position 7.
- Renumbered Reviewer (5→6), Documentation (6→8), and Synthesis (7→9).
- Project Manager now delegates WP decomposition to four focused sub-agents.
- Developer now requires all modified files listed in `artifacts.files_modified`.
- Reviewer security review scope delegated to Security Auditor.
- Added WP Decomposer, Dependency Sequencer, Pipeline Configurator, and Ledger Bootstrapper standalone sub-agents.
- Partials: Added shared partials for Security Auditor and Release Engineer protocols and output formats.

## v3.7.3 - Per-Persona Model Field
- Ledger: Added `default_model` to `_shared.yaml`; Planner and Project Manager use Claude Opus 4.6.
- Build: Added model field and resolution chain to persona frontmatter templates.
- Docs: Documented model resolution chain across manifest.

## v3.7.2 - CTX Architect Persona
- CTX Architect v1.0.0: New standalone persona for CTX Generator documentation workflows.
- Build: Extracted shared Claude Code frontmatter fields into a helper to eliminate duplication.
- Docs: Added Log-Prefix Convention section documenting severity prefixes.
- Docs: Updated frontmatter templates to reflect helper extraction.

## v3.7.1 - Developer
- Developer v3.6.1: Compressed overly verbose operational protocol.

## v3.7.0 - ID Update
- All Personas: Added `id` fields to all personas for `runSubagent` handoffs in VS Code.

## v3.6.3 - Strict Mode Limitations (2026-02-23)
- Docs: Documented strict-mode code-fence false-positive risk.
- Docs: Documented `--check` + `--strict` exit ordering behavior.
- Docs: Added `--strict` to quick-commands sections in suite READMEs.
- Build: Added inline comment documenting code-fence false-positive.

## v3.6.2 - cc_file_name Validation Guard (2026-02-23)
- Build: Added fail-fast guard when `cc_file_name` is missing from persona YAML.
- Build: Removed silent empty-string fallback for missing `cc_file_name`.
- Docs: Updated `cc_file_name` schema rows to document required-field behavior.

## v3.6.1 - Remove Vanilla Flat Files (2026-02-23)
- Vanilla: Deleted seven legacy flat persona files predating the template system.
- Docs: Updated vanilla README with canonical output directory redirect.

## v3.6.0 - Multi-IDE Persona Support (2026-02-23)
- Build: Added dual output directories for VS Code and Claude Code frontmatter.
- Build: Added `--target` CLI flag (`vscode`, `claude-code`, `all`).
- Template: Added `{{else}}` branch support to conditionals.
- Partials: Split handoff and preflight partials into platform-specific variants.
- Build: Added Claude Code frontmatter template with all required CC fields.
- Metadata: Added `cc_file_name`, `cc_tools` to persona YAML; CC settings to shared.
- Build: Added `cc_name`, `cc_description`, `cc_tools_json` computed variables.
- Standalone: Added Claude Code variants of all 6 standalone personas.
- Sync: Added Claude Code sync, validation, and directory-resolution functions.

## v3.5.4 - Preflight Simplification (2026-02-22)
- Project Manager v3.5.1: Simplified preflight and verbose sections.
- Developer v3.5.2: Simplified preflight and verbose sections.
- QA v3.5.3: Simplified preflight and verbose sections.
- Reviewer v3.5.4: Simplified preflight and verbose sections.
- Documentation v3.5.3: Simplified preflight and verbose sections.
- Synthesis v3.5.2: Simplified preflight and verbose sections.

## v3.5.3 - Reviewer Workflow Fix (2026-02-22)
- Reviewer v3.5.3: Removed phantom REWORK_REVIEW action; added acceptance criteria field.

## v3.5.2 - Incident Logging & Rework Handling (2026-02-22)
- QA v3.5.2: Added incident logging block and REWORK_QA handling.
- Reviewer v3.5.2: Added incident logging block.
- Documentation v3.5.2: Fixed REWORK action name; added rework handling and status tool.

## v3.5.1 - Persona Capabilities & Logging (2026-02-22)
- Developer v3.5.1: Added capabilities and rework sections; added observation tool.
- QA v3.5.1: Enabled incident logging.
- Reviewer v3.5.1: Enabled incident logging.
- Documentation v3.5.1: Removed unneeded handoff status tool.
- Synthesis v3.5.1: Demoted ledger help tool to note-only.
- Planner v1.3.1: Added clause for naming synthesis rework plans.

## v3.5.0 - Role Boundaries & Mandatory Handoffs (2026-02-22)
- Partials: Added `role-boundaries` fragment restricting tool use and WP scope.
- Partials: Changed handoff heading to "Handoff (mandatory)".
- Developer v3.5.0: Added repeat-loop workflow step and role scope constraints.
- All Ledger Personas v3.5.0, Planner v1.3.0: Initial changelogged versions.

## v3.4.1 - Standalone Persona Updates
- README Curator v1.2.1: Added helper section for rewriting entire READMEs.
- README Curator v1.2.0: Rewritten to produce better human-oriented output.
- Module Intent Architect v1.0.2: Improved documentation generation guidance.
- Changelog Curator v1.1.0: Refined entry verbosity rationales.
- Orchestrator Runner v1.0.1: Minor updates and fixes.

## v3.4.0 - Standalone Personas
- Changelog Curator v1.0.0: Initial release.
- Module Intent Architect v1.0.1: Initial pre-changelog version.
- Orchestrator Runner v1.0.0: Initial release.
- README Curator v1.1.0: Initial pre-changelog version.
- WHATSNEW Curator v1.0.0: Initial release.

## v3.3.0 - Two-Phase Pre-flight with Auto-Detect (2026-02-21)
- Ledger Personas 3–7: Replaced single-step pre-flight with detect + verify.
- Ledger Personas 3–7: Added `ledger_detect_project` to tools tables.

## v3.1.2 - Role Value Cross-Validation (2026-02-20)
- Sync: Added `KNOWN_ROLES` cross-validation for role frontmatter values.

## v3.1.1 - Automatic Handoffs
- Ledger Personas 2–7: Added automatic handoff via `ledger_get_handoff_status`.
- Sync: Added `validateLedgerFrontmatter()` for role/name field validation.

## v3.1.0 - Role Field in Persona Frontmatter
- Ledger Personas 1–7: Added `role:` field mapping to `AGENT_ROLES` constants.

## v3.0.2 - Pre-Flight Optimization
- Ledger Personas: Improved pre-flight tool discovery instructions.

## v3.0.1 - Pre-Flight Wording
- Ledger Personas: Tweaked pre-flight to avoid "Tools not found" messages.

## v3.0.0 - MCP Ledger
- Ledger Personas: Migrated ledger to dedicated MCP server.
- Ledger Personas: Refined pre-flight check sequence.

## v2.1.1 - Developer Fixes
- Developer: Small fixes.
- Developer, QA, Documentation: Added error logging.

## v2.1.0 - Split Work Packages
- Workflow: Introduced split-file architecture with per-WP specification files.
- Project Manager: Creates per-WP files in `work/` subfolder.
- Consumer Personas: Updated to reference individual WP files.

## v2.0.0 - Ledger Architecture (Breaking-S)
- Ledger: Switched to split-file architecture with per-WP detail files.
- Ledger: Renamed root index to `project-ledger.json`.

### Breaking Changes

The ledger switched from a single JSON file to a split-file architecture. The root
`project-ledger.json` is now a lightweight index; full WP data lives in `.ledger/WP-###.json`.

## v1.0.8 - Code Improvement Tracking
- Developer: Made commenting code a foundational role.

## v1.0.7 - Testing and Analysis
- Developer: Added testing and analysis capabilities.

## v1.0.6 - Autoloader Update Step
- Developer: Added step to regenerate autoloaders after adding new classes.

## v1.0.5 - Plan Folders
- Workflow: Per-project folders with simplified file names.
- Ledger: Moved to ledger personas folder; fixed paths.

## v1.0.4 - Agent Identification
- All Personas: Added `AGENT: Name` to ending status messages.

## v1.0.3 - Git Command Fix
- Planner, Developer: Added constraint against Git write commands.

## v1.0.2 - QA Handoff Fix
- QA: Clarified handoff for open WPs not assigned to Developer.

## v1.0.1 - VS Code Frontmatter Fix
- All Personas: Removed unsupported YAML properties; moved metadata to HTML comment.
- All Personas: Added version string to YAML `name`.

## v1.0.0 - Initial Release
- All Personas: Finalized workflow prompts with YAML frontmatter.
