<!--
  PUBLISHED ARTIFACT — domain-neutral, no project-specific content.
  Downstream projects fetch this file over HTTPS and overwrite their local copy
  on every sync, across non-coding domains (recipes, curation, research).
  Project-specific inventories and conventions belong in that project's own
  constraints. Top-level headings are a downstream anchor contract: renaming one 
  is a breaking change.
-->

# Persona Design Guide

> A blueprint for creating AI agent personas. Domain-neutral: the structure and philosophy apply to any persona suite, whether it covers software engineering, content curation, research, or an unrelated field.

**Version:** 3.2
**Last Updated:** 2026-08-26
**License:** MIT 
**Author:** Sebastian Mordziol
**Source:** https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md

**Changelog**

- v3.2 - 2026-08-26: Added "Metadata Without a Build System" — separates build-input metadata from governance metadata, and makes both optional for personas authored directly as system prompts (Gemini Gems, Claude Projects, custom GPTs); the Governance Metadata section no longer presupposes a metadata file or a build step.
- v3.1 - 2026-08-26: Added "Recurring Principles Across a Persona Suite" — name forking vs. name collision, the general-claim-over-symptom rule, and when a shared bullet warrants a partial (whole sections only); the vocabulary itself stays project-local. Clarified that the mood rule applies to every sentence of a principle body, not just its opener.
- v3.0 - 2026-08-26: Separated polarity from mood in Operating Philosophy — positive framing no longer implies imperative phrasing; replaced the v2.3 "Prefer X over Y" templates with indicative ones; added the "You should" test with a rewrite table; added the verb-initial title rule; added two checklist items and the "Positively framed commands in philosophy" pitfall.
- v2.9 - 2026-08-26: Added Governance Metadata section documenting `audit_guide_version`, `audit_date` and the new `design_notes` field; documented deviations are now accepted exceptions rather than repeat audit findings; added related checklist item.
- v2.8 - 2026-08-24: Added design rule for self-contained sub-sections: reusable partials and dedicated procedure blocks consolidate their constraints into their own Constraints heading rather than scattering them inline.
- v2.7 - 2026-08-24: Added Core Philosophy principle 7 (Tone Stratification); reserved imperative voice for Rules & Constraints only; rewrote checklist tone item to enforce stratification; added "All-imperative monotone" pitfall; fixed Mission template wording.
- v2.6 - 2026-08-24: Added Pattern 15 rules for observable-action gating, own-step placement, and skipped-duty visibility; expanded Pattern 6 with session-start sink opening and liveness markers; added related checklist items and two pitfalls.
- v2.5 - 2026-08-21: Added Pattern 15 (Trigger Anchoring — duty and constraint salience classes); expanded Pattern 6 with forcing functions and incremental capture; added Core Philosophy principle 6 (Salience Beats Volume); added related checklist items and pitfalls.
- v2.4 - 2026-07-15: Added Pattern 14 (Task Separation); added workflow design rule, quality checklist item, and common pitfall for phase homogeneity.
- v2.3 - 2026-07-13: Added positive-framing rule and litmus test to Operating Philosophy; added "Philosophy reads like constraints" pitfall; added checklist item for philosophy tone.
- v2.2 - 2026-06-29: Added Markdown separator handling; added License, Author and Source metadata to the header.
- v2.1 - 2026-04-29: Added "Lead with a verb, not You" guidance to the Mission section; documented second-person voice as an anti-pattern.
- v2.0 - 2026-04-11: Major revision — expanded section-by-section guides with templates; added Placeholder Syntax with curly braces (`{}`).
- v1.1 - 2026-04-11: Fixed missing Outputs entry in the recommended section order table.
- v1.0 - 2026-03-26: Initial release.

---

## Core Philosophy

Every persona in this system is built on five foundational principles:

1. **The Professional Identity Model.** Each agent is modeled after a real-world senior professional role — not a generic "AI assistant." A Staff Software Engineer writes code differently than a Security Auditor reads it. The professional metaphor constrains behavior, sets expectations, and gives the agent a clear lens through which to evaluate its work.

2. **Specialists Over Generalists.** Each persona owns exactly one domain. A QA agent does not fix bugs. A Developer does not write changelogs. A Planner does not implement. Narrow scope produces higher-quality output because the agent's full context window is spent on depth, not breadth.

3. **Gatekeeping Through Structure.** Every persona guards a quality gate: the Planner guards plan coherence, the Developer guards implementation correctness, QA guards acceptance criteria, the Reviewer guards architectural integrity. The gate is explicit — each persona has a **Decision Logic** that defines Pass/Fail criteria.

4. **Predictable, Machine-Readable Output.** Every persona produces structured output in a known format and ends with a standardized handoff block. This makes personas composable — one agent's output becomes the next agent's input without ambiguity.

5. **Constraints Prevent Drift.** Agent behavior degrades when scope is implicit. Every persona includes explicit guardrails: what it must do, what it must not do, what it delegates. Constraints are not suggestions — they are load-bearing rules that prevent the agent from wandering.

6. **Salience Beats Volume.** A persona's practical limit is not its word count — models recall long personas without difficulty. The limit is how many instructions must fire *spontaneously*, without a trigger, while the agent is absorbed in its primary task. What degrades in long sessions is not memory of an instruction but its *activation* at the moment it should apply. Therefore every duty and constraint is designed around an explicit trigger: an action, a workflow checkpoint, or an output slot. Pattern 15 defines the salience classes and their conversion rules.

7. **Tone Stratification Creates Signal.** A persona uses two distinct registers: *descriptive prose* for sections that teach the agent its role (Mission, Philosophy, Inputs, Workflow), and *imperative commands* reserved exclusively for the Rules & Constraints section. This separation is load-bearing. If the entire document is written in imperative voice ("Do X", "Never Y", "Must Z"), the constraints section loses its visual and cognitive weight — it sounds the same as everything else, so nothing reads as especially important. The imperative register works precisely *because* the rest of the document does not use it. Descriptive sections explain, describe, and guide; constraint sections command. When a model encounters a shift from explanatory prose to terse imperatives, it treats the imperatives as hard boundaries — which is exactly the intent.

---

## Persona Anatomy

Every persona follows a consistent structural skeleton. Sections are ordered deliberately — early sections establish identity and context; later sections provide procedural detail.

### Recommended Section Order

The ordering below is deliberate: identity and context come first, then domain knowledge and evaluation criteria, then constraints, then procedure. An agent reading top-to-bottom internalizes the role before learning the rules before executing the steps.

| # | Section | Required? | Purpose |
|---|---------|-----------|----------|
| 1 | **Mission** | Yes | Identity + core responsibility in 2–4 sentences |
| 2 | **Operating Philosophy** | No | Guiding principles that shape how the agent thinks |
| 3 | **Operating Modes** | No | Named modes with different triggers and workflows |
| 4 | **Inputs** | Yes | What the agent receives to do its work |
| 5 | **Outputs** | Yes | What the agent produces and where it goes |
| 6 | **Tool Integration** | No | How the agent interacts with external tools or services |
| 7 | **Operational Protocol** | No | Detailed execution procedure for the core task |
| 8 | **Evaluation Criteria / Review Dimensions** | No | Named dimensions the agent evaluates before deciding |
| 9 | **Rework Handling** | No | Focused re-entry procedure for bounced work |
| 10 | **Decision Logic** | No | Explicit PASS/FAIL gate criteria |
| 11 | **Output Template / Output Format** | No | Literal template or structure for the output |
| 12 | **Rules & Constraints** | Yes | Hard boundaries the agent must not cross |
| 13 | **Workflow** | Yes | Numbered step-by-step procedure from start to finish |
| 14 | **Handoff** | Yes | Standardized terminal block signaling completion (final workflow step) |

> **Why this order?** Mission and philosophy give the agent its identity. Inputs and tool sections provide the operating context. Protocol and criteria sections load domain knowledge. Constraints set the guardrails. The workflow is last because by the time the agent reaches it, it already understands *who it is*, *what it knows*, and *what it must not do* — it only needs to know *what to do next*.

### Required Sections

These sections appear in every well-formed persona, regardless of complexity:

| # | Section | Purpose |
|---|---------|----------|
| 1 | **Mission** | Identity + core responsibility in 2–4 sentences |
| 2 | **Inputs** | What the agent receives to do its work |
| 3 | **Outputs** | What the agent produces and where it goes |
| 4 | **Rules & Constraints** | Hard boundaries the agent must not cross (see naming guidance below) |
| 5 | **Workflow** | Numbered step-by-step procedure from start to finish |
| 6 | **Handoff** | Standardized terminal block signaling completion |

### Optional Sections

Add these when the persona's role demands them:

| Section | When to Include | Example Personas |
|---------|-----------------|------------------|
| **Operating Philosophy** | When the persona needs guiding principles beyond the mission statement — typically for complex or judgment-heavy roles. This is often what separates a good persona from a great one. | Documentation Curator, README Writer, Config Generator |
| **Operating Modes** | When the persona operates in distinct modes triggered by different conditions (e.g., Create / Update / Audit). | Changelog Writer, Manifest Writer, Documentation Curator |
| **Operational Protocol** | When the workflow's core execution step is complex enough to warrant its own detailed procedure. Extract it when the same procedure applies to both normal work and rework. | Developer, QA, Security Auditor, Reviewer |
| **Evaluation Criteria** | When the persona must evaluate complex work along multiple named dimensions *before* reaching a pass/fail decision. Distinct from Decision Logic. | Reviewer (Review Dimensions: Maintainability, Best Practices, Performance, Future Context) |
| **Decision Logic** | When the persona makes a binary pass/fail judgment. Define the criteria for each outcome. | QA, Security Auditor, Reviewer, Documentation Writer, Release Engineer |
| **Rework Handling** | When the persona may receive bounced work from a downstream agent and needs focused re-entry instructions. | Developer, QA, Release Engineer, Documentation Writer |
| **Output Template** | When the output must follow a specific document structure. Provide the literal template. | Planner, Researcher, Test Auditor, Changelog Writer |
| **Worked Examples** | When the output format involves transformation of input data and the template alone is insufficient to convey the expected quality. | Release Notes Writer (changelog → XML transformation) |
| **Self-Validation Checklist** | When the persona's output is complex enough that the agent should self-check before handing off. Distinct from Decision Logic (which evaluates someone else's work). | Task Decomposer (quality checklist before submission) |
| **Scope Boundaries Table** | When the persona's scope borders another persona's territory and the line must be made explicit. | Developer (vs. Reviewer), Security Auditor (vs. Reviewer) |
| **Value/Priority Matrix** | When the persona must categorize findings by severity or value. | Test Auditor (stability value), Security Auditor (OWASP severity) |
| **Tool Integration** | When the persona interacts with an external system (API server, test runner, CI, package manager). Keeps tool-specific instructions separate from the core workflow. | Developer (external API tools), QA (API tools + test environment) |
| **Reference Material** | When the persona needs domain-specific reference data embedded in the persona (style guides, schemas, mappings). Place before the workflow so the agent has internalized it before executing. | Changelog Writer (house style), Config Generator (YAML schema), Release Notes Writer (category mappings, translation guide) |

---

## Section-by-Section Guide

### 1. Mission

The Mission is the persona's identity card. It answers: *Who is this agent, and what does it do?*

**Structure:**

```markdown
## Mission

**Identity: {PROFESSIONAL_TITLE}.**

{1–3 sentences describing the core responsibility. Focus on the outcome the agent produces, not the mechanics of how it works. Lead with an active verb.}
```

**Design Rules:**

- **Open with the Identity line.** Format: `**Identity: {TITLE}.**` — always bold, always a recognized professional role. This is not decoration; it anchors the agent's behavior throughout the session.
- **Choose the identity carefully.** The title shapes how the agent approaches its work. "Staff Software Engineer" produces different behavior than "Junior Developer." "Chief Product Officer" thinks strategically; "Technical Writer" thinks about clarity. Pick the seniority and domain that match the persona's responsibilities.
- **State the outcome, not the process.** "Produce a clear, actionable plan" is better than "Analyze requirements and write planning documents." The workflow section covers process — the mission covers purpose.
- **Lead with a verb, not "You."** The mission body opens with an imperative or declarative verb: "Produce…", "Initialize…", "Focus on…", "Audit…". This voice keeps the mission anchored to the *role's purpose* rather than addressing the agent in second person. Compare: "Produce clean, scannable changelogs" (imperative — states the outcome) vs. "You specialize in producing changelogs" (second-person — describes the agent). Save "You" for the Workflow and Inputs sections where conversational address is natural.
- **One responsibility per persona.** If the mission statement requires "and" to connect two unrelated activities, you probably need two personas.

**Examples from existing personas:**

| Persona | Identity | Mission Focus |
|---------|----------|---------------|
| Planner | Chief Product Officer (CPO) | Produce a clear, actionable, technically sound plan |
| Project Manager | Technical Program Manager (TPM) | Split plans into work packages for incremental implementation |
| Developer | Staff Software Engineer | Implementation + Code Insight observation (dual role, but both are “hands in the code”) |
| QA | SDET (Software Engineer in Test) | Be the final gatekeeper for code quality |
| Security Auditor | Security Auditor | Focused security audit on produced code |
| Reviewer | Principal Systems Architect | Rigorous Peer Review — beyond “does it work?” |
| Synthesis | Head of Operations (OPS) | Consolidate development cycle results into a status report |
| Changelog Writer | Release Communications Editor | Produce clean, scannable changelogs |
| README Writer | Developer Experience (DX) Storyteller | Write the README that makes someone *want* to use the project |
| Researcher | Senior Research Engineer & Solution Architect | Investigate, compare, and recommend — does not implement |

**Anti-patterns:**

- "You are an AI assistant that helps with..." — too generic, no identity anchor.
- "You specialize in…" / "You are the…" — second-person address weakens the mission. Rewrite as a verb-led outcome: "Audit plans for grounding errors" instead of "You specialize in auditing plans."
- A mission that lists five different responsibilities — scope is too wide.
- A mission that describes *how* rather than *what* — that's the workflow's job.

---

### 2. Operating Philosophy

The Operating Philosophy encodes the *judgment framework* the agent applies at every decision point. It is distinct from both the Mission (which defines *what* the agent does) and the Constraints (which define *what it must not do*). The philosophy shapes *how the agent thinks* when facing ambiguity.

This section is optional but highly recommended for complex or judgment-heavy roles. It is the distinguishing feature of the highest-quality personas.

**Structure:**

```markdown
## Operating Philosophy

- **{Nominal or declarative title — never verb-initial}:** {One–two sentences stating the principle as a claim about the domain, not an instruction to the agent.}
- **{Nominal or declarative title}:** {Statement of the principle.}
```

Or, when a unifying metaphor applies:

```markdown
## Operating Philosophy — The {METAPHOR_NAME}

{Brief framing paragraph.}

| # | Section | Goal |
|---|---------|------|
| 1 | **{STAGE}** | {What this stage achieves} |
| 2 | **{STAGE}** | {What this stage achieves} |
```

**Design Rules:**

- **Name each principle.** Bold term + explanation sentence. This makes principles scannable and referenceable (e.g., “Apply the 30-Second Rule here”).
- **Encode judgment, not procedure.** Principles describe *how to think*, not *what to do*. Steps belong in the Workflow.
- **Frame positively — values over prohibitions.** Philosophy principles express what the agent *prioritizes* or *values*, not what it must avoid. A principle that opens with "Do not" or "Never" is a constraint and belongs in Rules & Constraints.
- **State principles in the indicative mood.** Polarity and mood are independent axes, and the philosophy section requires both: *positive* polarity and *indicative* mood. A principle is a statement about the world the agent works in ("Advisories outrank freshness"), not an instruction addressed to the agent ("Prefer advisories over freshness"). Both are positively framed; only the first is descriptive. Imperative phrasings — "Prefer X", "Favor X", "Use X", "Read X", "Keep X", "Treat X as…" — are positively framed *commands*, and they belong in Rules & Constraints. See Core Philosophy §7 (Tone Stratification).
- **Titles are nominal or declarative, never verb-initial.** A principle's title sets the mood its body follows, so drift starts in the title. "Read the Changelog, Not the Version Number" is a command and pulls the body into command voice; "The Changelog Decides, Not the Version Number" is a claim and pulls the body into prose. Titles take the form of a noun phrase ("Evidence Over Availability"), a comparison ("Maintenance Status Outranks Version Distance"), or a statement ("State Is Measured, Rationale Is Remembered").
- **Keep it short.** 3–6 principles is the sweet spot. More than that and the agent can't hold them all in working memory.
- **Use when the agent faces frequent ambiguity.** Not every persona needs a philosophy. A mechanical agent (like a Ledger Initializer) can operate entirely from its workflow. A judgment-heavy agent (like a README Writer or Documentation Curator) needs principles to navigate the gray areas.

**The "You Should" Test:**

Prepend *"You should"* to a principle's title and to the first clause of its body. If the result reads naturally, the principle is imperative and needs rewriting as a statement about the world.

| Imperative (fails the test) | Indicative (passes) |
|---|---|
| Prefer the Smallest Sufficient Move | The Smallest Sufficient Move Carries the Least Risk |
| Favor Depth Over Breadth | Depth Outranks Breadth |
| Value Structure Over Prose | Structure Before Content |
| Keep the Reference Authoritative | The Reference Is Authoritative |
| Treat Seasonality as a Constraint | Seasonality Bounds the Menu |
| Choose Fewer, Better Ingredients | Fewer Ingredients Carry More Flavour |
| Verify Figures Before Reporting Them | Verified Figures Only |
| Read the Source, Not the Summary | The Source Decides, Not the Summary |

The rewrite is mechanical: the imperative verb becomes a claim about how the domain behaves, and the agent's obligation to act on it is left implicit. Where an obligation genuinely must be enforced, the principle stays as a value statement here and a matching hard rule is added to Rules & Constraints.

**Philosophy vs. Constraint — Litmus Test:**

| If the principle… | It belongs in… | Example |
|---|---|---|
| Describes what the agent *values or prioritizes* | Operating Philosophy | "**Structure Before Content:** A well-structured document with average prose outperforms brilliant prose in a disorganized layout." |
| Expresses a *preference between two valid approaches* | Operating Philosophy | "**Depth Outranks Breadth:** Thorough coverage of a few items is worth more than shallow coverage of many." |
| States what the agent *must not do* | Rules & Constraints | "Do not modify files outside the current work package." |
| Defines a *hard boundary with an alternative action* | Rules & Constraints | "Never invent APIs — verify existence using filesystem tools before referencing." |

**Examples:**

| Persona | Philosophy Section | Key Principles |
|---------|-------------------|----------------|
| Documentation Curator | Manifest-First Protocol | Manifest First, Context Efficiency, High Integrity, The 30-Second Rule, Authoritative Tone |
| Module Documenter | Code-Discovery Protocol | The 30-Second Rule, Intent Over Implementation, Ecosystem View, Documentation Tiering |
| README Writer | The README Funnel | Landing-page funnel: Hook → Features → Requirements → Quick Start → Learn More |
| Config Generator | (unnamed) | Documentation as Infrastructure, Generated Over Hand-Written, README = Why / Architecture = What, Convention Over Configuration, Minimal Viable Coverage |

#### Recurring Principles Across a Persona Suite

Once a collection grows past a handful of personas, some principles begin to recur. Naming a principle is what makes it referenceable — the value of "Apply the 30-Second Rule here" depends on that name meaning one thing everywhere it appears. Two failure modes follow, and they are opposites:

| Failure | Symptom | Consequence |
|---|---|---|
| **Name forking** | One principle acquires several names across personas ("Counts Age Badly", "Durable Over Precise", "Counts Are a Maintenance Liability") | The principle cannot be referenced, and an audit cannot distinguish a persona that lacks it from one that calls it something else |
| **Name collision** | One name covers two unrelated principles in different domains | A shared name asserts a shared principle that does not exist, and a reader who follows the reference finds something else |

**Design Rules:**

- **One meaning per name.** Two personas using the same name state the same underlying principle. Where two principles differ in substance, they take different names.
- **Prefer the general claim over its symptom.** Where a principle and its most common illustration compete for the name, the principle wins — it extends to illustrations not yet encountered. "Durable Over Precise" covers stale counts, stale dates, and stale version numbers; "Counts Age Badly" covers only the first.
- **Bodies are authored, not copied.** Each persona illustrates the principle with its own domain's examples. A count in an audit report is not a count in a README, and a principle about ingredient quality is not one about knowledge-base quality. Verbatim duplication across personas is a signal the principle belongs in a shared partial instead.
- **Extraction into a partial is reserved for whole sections.** A single recurring bullet stays inline under its canonical name. Partials are warranted when two personas share an *entire* philosophy section — typically the same role under two deployment contexts — not when they overlap on one principle.
- **Maintain the vocabulary where the personas live.** A collection large enough to fork names is large enough to need a registry of canonical names, their meanings, and the personas carrying them. That registry is project-specific and belongs with the project's own conventions, not in this guide.

> **Scope note:** This guide is domain-neutral. A persona suite may cover software engineering, content curation, cooking, research, or anything else, and the principles that recur within one suite are rarely meaningful to another. The rules above describe how to keep a vocabulary coherent; the vocabulary itself is always local to the project.

---

### 3. Inputs

The Inputs section defines what the agent receives before it starts working. Think of it as the function signature — what arguments does this persona accept?

**Structure:**

```markdown
## Inputs

You will be provided with:

- **{INPUT_NAME}:** {Brief description of what this is and where it comes from.}
- **{INPUT_NAME}:** {Description.}
- **Optional: {INPUT_NAME}:** {Description — mark clearly as optional.}
```

**Design Rules:**

- **Be specific about the source.** "The plan document produced by the Planner Agent" is better than "A plan." Agents need to know where to look.
- **Distinguish required from optional.** Prefix optional inputs with `Optional:`.
- **Name the format when it matters.** If the input is a Markdown file, a JSON ledger, or a YAML config, say so.
- **Separate capabilities from data inputs.** If the agent needs filesystem access, test execution ability, or shell access, list these in a `### Capabilities` sub-section. Capabilities explicitly authorize the agent to use tools — without them, agents may self-limit.

**Capabilities Sub-Section:**

Use this when the agent needs explicit authorization to perform actions beyond passive reading:

```markdown
## Inputs

You will be provided with:

- **{DATA_INPUT}:** {Description.}
- **{DATA_INPUT}:** {Description.}

### Capabilities

- **Filesystem Access:** Read existing files and write new ones.
- **Test Environment:** Run the project's test suite and verify acceptance criteria.
- **Static Analysis:** Run the project's static analysis tools and address violations.
```

The Capabilities sub-section is used by the Developer, QA, and other action-oriented personas. Analytical personas (Researcher, Manifest Writer) that only read and write documents typically don't need one.

---

### 4. Outputs

The Outputs section defines what the agent produces. This is the "return type" of the persona.

**Structure:**

```markdown
## Outputs

{Brief overview of what is produced.}

### Output Location

{Where the output is saved — file path pattern, directory convention, etc.}
```

For complex outputs, break them into named sub-sections:

```markdown
## Outputs

### 1. {PRIMARY_OUTPUT}
{Description of what it contains and its structure.}

### 2. {SECONDARY_OUTPUT}
{Description.}

### Output Location
{Path conventions.}
```

**Design Rules:**

- **Define the output location explicitly.** "Save to `/docs/agents/plans/{date}-{name}/plan.md`" leaves no ambiguity. Agents perform better when they know exactly where to write.
- **Describe the output's structure.** If the output is a Markdown document, describe its sections. If it's structured data, describe the schema.
- **Link outputs to the next consumer.** If the Planner's output feeds into the Technical Program Manager, say so. This creates traceable handoff chains.

---

### 5. Rules & Constraints

Constraints are the load-bearing walls of a persona. They prevent the agent from drifting outside its role, making unauthorized changes, or producing unreliable output.

**Naming:** Two naming conventions are used across the persona library, each suited to a different role type:

| Section Name | Style | Used By |
|---|---|---|
| `## Strict Constraints` | Flat bullet list of imperatives | Execution-focused roles (Developer, QA, Security Auditor, Changelog Writer) |
| `## Core Rules` | Categorized sub-sections with named rule groups | Analytical/judgment-heavy roles (Planner, Researcher, Manifest Writer, Documentation Curator) |

Choose the style that matches the persona's nature. Action-oriented roles benefit from a terse, scannable list. Roles that make nuanced judgments benefit from grouped, contextual rules.

**Flat style (Strict Constraints):**

```markdown
## Strict Constraints

- **{CONSTRAINT_NAME}:** {What the agent must or must not do, and why.}
- **{CONSTRAINT_NAME}:** {Rule.}
```

**Categorized style (Core Rules):**

```markdown
## Core Rules

### Clarifying Questions
{When and how the agent should ask for clarification.}

### Scope & Boundaries
- {Rule about what is in scope.}
- {Rule about what is out of scope.}

### Strict Grounding & Verification
- {Rule about accuracy and hallucination prevention.}
```

**Design Rules:**

- **Imperative voice is reserved for this section.** The Rules & Constraints section is the only part of a persona that uses imperative commands ("Do not", "Never", "Must"). All other sections — Mission, Philosophy, Inputs, Workflow — use descriptive, explanatory prose. This tonal contrast is what gives constraints their weight: a shift from explanatory prose to terse imperatives signals "these are hard boundaries." If the whole persona reads as a list of commands, constraints become invisible. See Core Philosophy §7 (Tone Stratification).
- **Frame each constraint as a direct command.** "Do not fix bugs unrelated to your task" is clearer than "Bugs unrelated to the task should generally be left alone."
- **Include the *why* when it's not obvious.** "No Git write operations — the user manages version control" explains the rationale.
- **Be specific: state the boundary + the alternative action.** Every strong constraint tells the agent what it *cannot* do *and* what it *should* do instead:

| Weak (boundary only) | Strong (boundary + alternative) |
|---|---|
| "Do not fix unrelated bugs." | "If you see a bug unrelated to your task, record it as a Code Insight observation but **do not fix it** unless it blocks your implementation." |
| "Do not modify other agents' work packages." | "Only claim and work on work packages assigned to your role. Never claim, modify, or complete a WP assigned to another agent — use the coordinator API to determine your work." |
| "Do not reference non-existent files." | "Never reference files, modules, APIs, or services unless they exist in the codebase. Always verify existence using filesystem tools before including them in the plan." |

- **Cover these categories:**

| Category | Example |
|----------|---------|
| **Scope guardrails** | Only implement what is defined in the current Work Package. |
| **Role boundaries** | Do not claim work assigned to another agent's role. |
| **Output integrity** | Never output `// ... existing code ...` — always provide full context. |
| **Safety rails** | No Git write operations (add, commit, push, branch). |
| **Quality floors** | All new features must include error handling and logging. |
| **Delegation rules** | Note out-of-scope issues but do not fix them. |
| **Hallucination prevention** | Do not invent libraries or APIs that do not exist. |

- **Constraints that apply to multiple personas should be extracted into shared partials** (or equivalent reusable blocks) rather than duplicated.
- **Self-contained sub-sections consolidate their own constraints.** When a persona includes a reusable sub-section (a shared partial or a dedicated procedure block), that sub-section collects its constraints into its own Constraints heading rather than scattering them as inline asides across procedural steps. Workflow steps describe the positive action; the constraints block lists the prohibitions. This mirrors the full persona's structure at sub-section scale and gives agents a single scannable block for "what am I not allowed to do" within that sub-task.

---

### 6. Workflow

The Workflow is the agent's main execution loop. It provides a numbered, sequential procedure from session start to session end.

**Structure:**

```markdown
## Workflow

1. **{STEP_NAME}:** {What to do in this step.}
2. **{STEP_NAME}:** {What to do.}
3. ...
N. **Handoff:** End the response with:
   ```
   AGENT: {PERSONA_NAME}
   STATUS: {TERMINAL_STATUS}
   ```
```

**Design Rules:**

- **Number every step.** Agents follow numbered sequences more reliably than prose paragraphs.
- **Bold the step name.** It serves as a scannable anchor: `1. **Pre-flight:**`, `2. **Determine Action:**`.
- **Include decision points.** If a step branches ("If X, do Y; otherwise do Z"), make it explicit *within* the step rather than splitting it into separate steps.
- **End with a handoff.** Every workflow terminates with a structured status block that signals completion to the user or the next agent in the chain.
- **Keep it high-level.** The workflow is an outline, not a tutorial. If a step requires a detailed procedure, extract it into a separate **Operational Protocol** section and reference it from the workflow step (e.g., "Execute the Verification Stack (see Operational Protocol above).").
- **Include repeat/loop instructions when applicable.** If the agent should process multiple items (e.g., multiple Work Packages), include an explicit "Repeat" step.
- **Separate research from production.** Do not combine fact-gathering and deliverable-writing in the same workflow step. Split them into distinct phases — gather and verify first, then produce the output. See Pattern 14 (Task Separation) for rationale and structure.

**When to extract an Operational Protocol:**

Extract the core execution steps into a separate `## Operational Protocol` section when:
- The same procedure applies to both normal work and rework modes (Developer, QA, Reviewer).
- The procedure is multi-phase with its own sequential structure (e.g., QA's "Verification Stack": Build → AC Check → Regression → Edge Cases).
- The workflow would exceed 8–10 steps if the procedure were inlined.

Keep the procedure inline in the workflow when it runs exactly once per invocation with no reuse (Planner, Researcher, Module Documenter).

**Common Workflow Patterns:**

| Pattern | Used By | Description |
|---------|---------|-------------|
| **Linear** | Planner, Researcher, Module Documenter | Scan → Analyze → Produce → Handoff |
| **Loop** | Developer, QA, Reviewer | Get next action → Execute → Complete → Repeat until WAIT |
| **Delegating** | Project Manager, Release Engineer | Orchestrate sub-agents, then verify their output |
| **Multi-Mode** | Changelog Writer, Manifest Writer | Branch into different workflows based on operating mode |

---

### 7. Handoff

Every persona terminates with a handoff block — a machine-readable status signal.

**Structure:**

```markdown
End the response with:
```
AGENT: {PERSONA_NAME}
STATUS: {TERMINAL_STATUS}
```
```

**Design Rules:**

- **Use consistent status values.** Examples: `COMPLETE`, `READY_FOR_PM`, `AUDIT_COMPLETE`. The status should tell the user (or the orchestrator) what to do next.
- **Place the handoff as the final step in the workflow.** It is always the last thing the agent outputs.
- **For orchestrator-based personas,** the handoff block is typically retrieved from a coordination server rather than hardcoded — this keeps it dynamic and orchestrator-compatible.

---

## Design Patterns

These patterns recur across the persona library. Apply them when designing new personas.

### Pattern 1: The Professional Metaphor

Every persona is framed as a senior professional in a specific discipline. This is not cosmetic — it meaningfully shapes agent behavior:

| Professional Role | Behavioral Effect |
|-------------------|-------------------|
| Chief Product Officer | Thinks strategically, prioritizes outcomes over implementation |
| Technical Program Manager | Orchestrates sub-agents, manages decomposition and sequencing |
| Staff Software Engineer | Hands-on, detail-oriented, writes production-ready code |
| SDET | Skeptical of code, tests everything, trusts nothing by default |
| Security Auditor | Looks for vulnerabilities, thinks adversarially |
| Principal Systems Architect | Evaluates architecture, thinks long-term, reviews holistically |
| Head of Operations | Synthesizes cross-cutting data, produces executive summaries |
| Technical Writing Manager | Focuses on clarity, accuracy, and reader experience |
| Release Communications Editor | Focuses on conciseness and scannability |
| Context Documentation Architect | Treats documentation as infrastructure, favors generated over hand-written |

**Guideline:** Choose a title that implies the right level of seniority and the right mode of thinking for the task. "Staff" and "Principal" level titles produce more autonomous, confident behavior than "Junior" titles.

### Pattern 2: Scope Boundary Tables

When two personas have adjacent territories, use an explicit table to draw the line:

```markdown
| In Scope (This Agent) | Out of Scope (Other Agent's Territory) |
|---|---|
| Code smells in files you touch | System-wide architectural decisions |
| Missing error handling in your changes | Compliance or regulatory concerns |
```

This prevents territorial overlap — one of the most common failure modes in multi-agent systems.

### Pattern 3: Operating Modes

When a persona does fundamentally different things depending on context, define named **Operating Modes** with a trigger table:

```markdown
## Operating Modes

| Mode | Trigger | Description |
|---|---|---|
| **Create** | No artifact exists | Generate from scratch |
| **Update** | Artifact exists but is stale | Reconcile against current state |
| **Audit** | Accuracy is uncertain | Compare without modifying |
```

Each mode then gets its own **Workflow** sub-section. This is cleaner than a single monolithic workflow packed with conditionals.

### Pattern 4: Decision Logic (The Go/No-Go Gate)

Any persona that makes a judgment call (pass/fail, approve/reject) needs an explicit Decision Logic section:

```markdown
## Decision Logic

- **PASS:** {Precise criteria for approval.}
- **FAIL (Bounce):** {Precise criteria for rejection. Specify what information must be provided in the failure report.}
```

Being explicit about the pass/fail threshold prevents inconsistent behavior across sessions.

### Pattern 5: Output Templates

When the persona produces a structured document, include the literal template:

```markdown
## Output Template

```markdown
# {DOCUMENT_TITLE}

## Section 1
{what goes here}

## Section 2
{what goes here}
```
```

Templates work significantly better than prose descriptions of what the output should "generally contain." The agent follows a template faithfully; it interprets prose loosely.

### Pattern 6: The Observation Side-Channel

Some personas have a secondary responsibility that runs in parallel with their primary task. The Developer's "Code Insight Observer" role is the canonical example — while implementing code, the developer also watches for code smells and records them.

This pattern works when:
- The secondary task is lightweight and doesn't compete with the primary mission
- The secondary output is structured (categories, priorities)
- The secondary output feeds into a downstream agent (Reviewer reads Developer observations)

**Why this pattern is fragile.** A side-channel is a *continuous, triggerless duty*: nothing in the session ever prompts the agent to perform it. It relies on the model spontaneously re-surfacing the instruction while deep in the primary task — and that is precisely the class of instruction that degrades first as sessions grow long (see Pattern 15). The failure is silent: the agent implements flawlessly and simply stops observing.

**Two required mitigations.** Every side-channel must include both:

1. **A forcing function.** A mandatory output slot that cannot be legitimately left empty — including an explicit nothing-found form: *"If you found nothing noteworthy, record a single observation stating that the touched files are clean."* This converts the continuous duty into a checkpoint duty: the slot is guaranteed to be filled at handoff time.

2. **An incremental capture sink.** Instruct the agent to record each observation *the moment it occurs* — appended to a scratch file (e.g., `observations.md`) or the todo list — and have the synthesis step *compile from the sink* rather than write from recall. Without the sink, the forcing function alone produces **end-of-session reconstruction**: an agent that stopped observing mid-session will, at synthesis time, look back over its context and back-fill plausible observations. The result often looks acceptable but misses everything that was only salient in the moment (a test that was flaky on first run, a momentary confusion caused by a misleading name). The sink turns each observation into its own micro-checkpoint. It is the side-channel's analog of Pattern 14's research brief: a compact artifact that survives attention decay.

**Two properties the sink must have.** A sink that is merely *described* still fails; these two properties are what make it fire:

- **Open it at session start, before the primary task begins.** Have the agent resolve the path and create the file immediately — with a `session-start` marker line, even though it has no observations yet. This removes every trace of setup cost from the working phase (no path resolution, no create-or-append decision, no first-use hesitation while mid-task), leaving only a one-line append at each gate. A sink the agent must first *set up* while absorbed in the primary task is a sink it will defer.
- **Make the marker a liveness signal.** The start marker converts an ambiguous empty sink into a diagnosable one: marker present with no observations means capture ran and genuinely found nothing; no marker means capture never ran. Require the report to distinguish these two cases explicitly (see Pattern 15's visibility rule). Without the distinction, a forgotten duty and a clean codebase produce identical reports, and the mechanism can never detect its own failure.

**Gate the appends on observable actions.** Bind each append to something that visibly happens — a file edited, a test run, a document saved — never to an agent-judged boundary like "after each chunk." See Pattern 15 for the full rule; it is the single most common reason a well-designed sink still ends up written from recall.

**Limit: one side-channel per persona.** Each additional triggerless duty competes for the same scarce resource — spontaneous re-surfacing. A persona with one well-instrumented side-channel is reliable; a persona with three simultaneous "continuously watch for X" duties will silently convert most of them into end-of-session reconstruction, even on strong models. If a role seems to need more, the extra duties belong to a downstream agent (e.g., a Reviewer) or must be restructured as checkpoint duties.

### Pattern 7: Rework Handling

Any persona that may receive bounced work needs a dedicated Rework section:

```markdown
## Rework Handling

1. **Read the bounce feedback:** {Where to find it.}
2. **Narrow your focus:** {Only address flagged issues.}
3. **Reference the feedback:** {Explicitly note which issues were resolved.}
```

The key insight: rework should not re-run the full workflow. It focuses narrowly on the flagged issues. This prevents thrashing.

### Pattern 8: Reference-Heavy Roles

Some personas need domain-specific reference material embedded in the persona (not linked externally). A Changelog Writer's "House Style Reference," a Release Notes Writer's category mapping and translation guide, and a Config Generator's YAML schema reference are exemplars.

Use this pattern when:
- The reference is essential to every invocation (not occasionally consulted)
- The reference is short enough to fit in the persona without bloating it
- External links would be unreliable or unavailable to the agent

**Structuring embedded reference material:**

- **Use tables for mappings** (e.g., changelog prefix → release notes category, source language → target language terms).
- **Use fenced code blocks for schemas and templates** (e.g., YAML structure, XML format).
- **Use clear section headers** to separate reference from instruction.
- **Place reference material before the workflow** so the agent has internalized it before executing.

### Pattern 9: Sub-Agent Delegation

When a persona needs to invoke specialized sub-agents to complete part of its work. For example, a Project Manager might delegate decomposition to sub-agents (Task Decomposer, Dependency Mapper, Stage Configurator, Tracker Initializer). A Release Engineer might delegate to a Changelog Writer and a Config Generator.

**Structure for each delegation step:**

```markdown
5. **Delegate {TASK_NAME}:**
   Use `runSubagent` with the `@{SUB_AGENT_NAME}` agent.
   Pass: {exact inputs to provide}.
   Expected output: {what the sub-agent should return}.
   Review the returned output for accuracy and completeness before proceeding.
```

**Design Rules:**

- **Specify exact inputs.** Name each piece of data the sub-agent needs — do not say "pass the context."
- **Specify the expected output.** The persona must know what to verify when the sub-agent returns.
- **Include a validation step.** The orchestrating persona always reviews sub-agent output before using it.
- **One sub-agent per step.** Each delegation is its own numbered workflow step, not a sub-bullet.
- **Guard with a condition when optional.** "If the project has a `context.yaml`… skip this step if not."

This pattern preserves single-responsibility: the orchestrating persona manages coordination, not execution.

### Pattern 10: Named Evaluation Criteria

When a persona must evaluate complex work along multiple dimensions *before* reaching a pass/fail decision. Distinct from Decision Logic (which is the gate) — evaluation criteria are the *lens*.

The Reviewer's "Review Dimensions" section is the canonical example:

```markdown
## Review Dimensions

Evaluate the submission based on these criteria:

* **Maintainability:** Is the code readable? Are variable names descriptive?
* **Best Practices:** Does it follow the project's patterns (SOLID, DRY, framework idioms)?
* **Performance:** Are there significant performance bottlenecks?
* **Future Context:** Does this change align with the long-term vision?
```

Use this pattern when:
- The persona evaluates against more than two criteria
- The criteria are domain-specific (not just "good/bad")
- The evaluation feeds into a Decision Logic section downstream

### Pattern 11: Worked Examples

When the output format involves transformation of input data and the Output Template alone is insufficient to convey the expected quality. For example, a Release Notes Writer might include a worked example showing a developer changelog entry (before) and the resulting XML output (after), including notes on what was excluded and why.

**Structure:**

```markdown
## Worked Example

Given this input:

```
{the raw input data}
```

The resulting output:

```
{the transformed output}
```

**Excluded:** {explanation of what was filtered out and why.}
```

Use this pattern when:
- The output format is non-obvious (e.g., XML, structured data)
- The transformation applies complex filtering rules
- The agent needs to see correct output alongside the reasoning for exclusions

### Pattern 12: Self-Validation Checklist

When the persona's output is complex enough that the agent should self-check before handing off. Distinct from Decision Logic (which evaluates *someone else's* work) — this is self-verification of the persona's own output.

The Task Decomposer includes an inline checklist:

```markdown
## Quality Checklist

Before submitting your output, verify:

- [ ] Every WP has at least 2 acceptance criteria
- [ ] No WP mixes file renames with logic changes unless inseparable
- [ ] No WP is a catch-all (e.g., "Update all the things")
- [ ] Every deliverable is concrete and observable
- [ ] Large WPs have a noted justification for not splitting further
```

Use this pattern when:
- The output has multiple independently verifiable dimensions
- Common mistakes can be caught by a checklist
- The persona has no downstream agent to catch errors before the user sees the output

### Pattern 13: Tool Integration Sections

When a persona interacts with an external system (coordination server, test runner, CI pipeline, package manager, API), include a dedicated section explaining the tool interface. This keeps tool-specific instructions separate from the core workflow.

**Structure:**

```markdown
## {TOOL_NAME} Tools

{Brief description of the tool and its role.}

### Available Commands

| Command | Purpose |
|---|---|
| `{COMMAND}` | {What it does} |
| `{COMMAND}` | {What it does} |

### Usage Notes

- {Important behavioral note about the tool.}
- {Error handling or fallback guidance.}
```

**Design Rules:**

- **Place after Inputs, before Operational Protocol.** The agent needs to know its tools before executing procedure.
- **Document the tool's response format** when the agent must parse or act on responses.
- **Include fallback instructions** for when the tool is unavailable or returns errors.

### Pattern 14: Task Separation

LLMs generate text one word at a time, always moving forward. Once a sentence is written, the model cannot revise it — even if later information contradicts it. This architectural property (autoregressive generation) means that mixing different cognitive tasks in the same workflow step degrades both tasks. Three failure modes emerge when research and production are combined:

| Failure Mode | Mechanism | Effect |
|---|---|---|
| **Premature commitment** | The model starts forming conclusions before it has all the facts. Because it cannot revise earlier output, it bends later findings to fit. | Claims that don't quite match the data; contradictory evidence is ignored. |
| **Attention decay** | Facts gathered early in a long session carry less weight by the time the model reaches later sections. | Early research is underweighted; later output relies on incomplete recall. |
| **Forward momentum bias** | The model feels pressure to use each finding immediately rather than waiting for the full picture. | Premature design decisions; output shaped by arrival order rather than importance. |

**The fix: phase separation.** Split any complex workflow into phases where each phase has one cognitive job:

```markdown
1. **Scope:** Identify what areas the task touches. Output: bullet list.
2. **Research:** For each area, gather and verify the relevant facts.
   Record them in a compact brief. No decisions in this phase.
3. **Produce:** With all verified facts consolidated nearby,
   write the deliverable. Every claim draws from the brief.
```

This eliminates all three failure modes:
- No premature commitment — decisions wait until all facts are in.
- No attention decay — verified facts are consolidated in a compact artifact close to where the model needs them.
- No forward momentum bias — the research phase has no obligation to produce decisions.

**The broader principle: phase homogeneity.** Each workflow phase should involve a single type of cognitive task. Mixing discovery and decision-making in the same step causes reasoning styles to bleed across boundaries — the model starts making assertions during fact-gathering, or hedges its conclusions with discovery-flavored uncertainty when it should be committing.

Apply this pattern when:
- The persona gathers information before producing a deliverable (Planner, Researcher, Documentation Curator)
- The workflow involves both analysis and synthesis
- The output quality depends on complete, accurate information

**Design Rules:**

- **Never combine research and production in a single workflow step.** If a step says "gather X and then write Y", split it into two steps.
- **Label each phase's cognitive type.** Use step names that signal the mode: "Gather", "Analyze", "Verify" for research; "Draft", "Produce", "Write" for production.
- **Consolidate research output before production begins.** The research phase should produce a compact artifact (brief, checklist, inventory) that the production phase consumes.
- **Apply to Operational Protocols too.** The same separation applies inside extracted protocols — each sub-phase should have one cognitive job.

> **Source:** [Why LLMs Make Mistakes — and How Task Separation Fixes It](../../docs/discussions/task-separation.md)

### Pattern 15: Trigger Anchoring

A persona's instructions do not degrade uniformly. What predicts whether an instruction survives a long session is not its position, phrasing, or importance — it is the instruction's **trigger structure**: what, if anything, in the session forces the model to check it at the right moment. Instructions with a concrete trigger fire reliably; instructions that depend on spontaneous recall while the agent is absorbed in its primary task degrade first, and degrade silently.

**Salience classes**, from most to least durable:

| Class | Trigger | Durability | Example |
|---|---|---|---|
| **Foreground task** | *Is* the task — carries the session's momentum | Never dropped | "Implement the plan" |
| **Action-gated constraint** | The forbidden or required action itself | Very high — checked at the moment of the tool call | "No Git write operations" |
| **Checkpoint duty** | A numbered workflow step with a mandatory output slot | High — the step and slot force the check | Handoff block; a feedback section emitted at a fixed step |
| **Generation-time constraint** | Fires only while writing output, far from where it was stated | Medium — holds at the template, leaks into intermediate outputs | "No stale counts in summaries" |
| **Rarely-fired conditional** | An uncommon input condition | Medium-low — no rehearsal; fumbled when it finally applies | "Preserve the optional companion file when present" |
| **Continuous triggerless duty** | None | Lowest — depends entirely on spontaneous re-surfacing | "Actively watch for code smells while working" |

**Design Rules:**

- **Every duty must be foreground, action-gated, or checkpoint-slotted.** A duty that is none of these is a continuous triggerless duty and must be converted using Pattern 6's mitigations (forcing function + incremental capture sink) — or moved to a persona for which it *is* the foreground task.
- **Gate on an observable action, never on an agent-defined boundary.** This is the difference between a real action gate and one that only looks like an action gate. "After each chunk of work", "once you have enough to report", "at a natural stopping point" all delegate the trigger back to the agent's own judgment — and that judgment is exactly what the primary task has captured. Such boundaries never announce themselves, so the duty silently reverts to the lowest salience class despite reading like a gated instruction. Bind the duty to something that visibly happens: a file edited, a test run, a document saved, a category completed. Compare: "after each chunk, append your observations" (agent-defined — degrades) vs. "after each file edit, before opening the next file, append your observations" (observable — fires).
- **Split the gated duty into its own numbered step.** A duty appended as a trailing sub-clause to a step whose headline is the primary task inherits that step's momentum and is skipped with it. Give the duty its own numbered step and, where the pair repeats, state the loop explicitly: *"Repeat steps 4–5 until complete."* The numbered step is re-read on every pass; a sub-clause is read once.
- **Make skipped duties visible, not absorbable.** A forcing function that accepts the same output for "did the work and found nothing" and "never did the work" cannot detect its own failure — the agent fills the slot either way and the omission is invisible. Give the mechanism a cheap liveness signal (an opened sink, a start marker, an initialized artifact) and require the report to distinguish the two cases. Without this, the only thing standing between a silent process failure and the user is the agent volunteering that it forgot.
- **Restate generation-time constraints at the point where they fire.** The Constraints section may be dozens of tool calls behind by the time the agent writes its output; the Output Template is read at generation time. Embed the constraint as an authoring instruction inside the template slot itself — e.g., `{2–3 sentence summary — no numeric counts}` — in addition to stating it in Constraints. The template placement does the enforcing; the Constraints entry documents the rule.
- **Give rarely-fired conditionals a checkpoint.** Do not rely on the agent remembering an "if present" rule when the condition finally holds. Add an explicit workflow step that forces the check: *"Step 2: Check whether `{COMPANION_FILE}` exists. If it does, …; if not, proceed."* The step fires every session, so the conditional is rehearsed even when it does not apply.
- **Expect momentum conflicts and route the impulse.** Constraints that oppose the pull of helpfulness ("do not fix unrelated bugs") are under constant pressure and weaken as sessions lengthen. The existing boundary-plus-alternative rule is the mitigation — but ensure the alternative gives the impulse *somewhere to go* (record it in the side-channel), not merely a prohibition.
- **Budget by session length, not persona length.** Reliability declines with tool-call count and context churn, not with persona word count. A persona whose sessions routinely run very long needs *mid-workflow checkpoints* (re-verification steps, incremental sinks), not additional constraint prose — more prose adds volume without adding triggers.

**Relationship to other patterns:** Pattern 6 is the conversion procedure for the lowest salience class. Pattern 14 addresses the same underlying mechanics (attention decay, forward momentum) for *sequential* phases; Pattern 15 addresses them for *parallel* duties and constraints. Pattern 5 (Output Templates) is the delivery mechanism for generation-time constraint restatement.

---

## Quality Checklist

Before shipping a new persona, verify:

- [ ] **Mission opens with `Identity: {TITLE}.`** — bold, professional role, period at the end.
- [ ] **Single responsibility.** The mission describes one clear outcome.
- [ ] **Operating Philosophy is present** if the role requires judgment in ambiguous situations.
- [ ] **Operating Philosophy uses positive framing.** Principles express values and preferences, not prohibitions. Any "Do not" / "Never" statements belong in Constraints.
- [ ] **Every philosophy principle passes the "You should" test.** Prepend "You should" to each title and to the first clause of each body. Anything that reads naturally is imperative and needs rewriting as a statement about the domain. Applied bullet by bullet, not to the section as a whole.
- [ ] **No philosophy title is verb-initial.** Titles are noun phrases, comparisons, or statements — never commands ("Read X", "Prefer X", "Keep X", "Use X", "Treat X…").
- [ ] **Every sentence of a principle body is indicative, not just the first.** Drift commonly appears in a trailing sentence where a principle slides from claim into instruction ("… Reserve imperative language for …").
- [ ] **Recurring principles use their canonical name** as recorded by the project's own principle vocabulary, where one exists. A principle appearing in a second persona is registered at that point.
- [ ] **Inputs are specific.** Each input names its source and format.
- [ ] **Capabilities sub-section exists** if the agent needs to run tests, execute commands, or write files.
- [ ] **Outputs have a defined location.** The agent knows exactly where to save its work.
- [ ] **Constraints cover scope, safety, and quality.** At minimum: scope guardrails, no unauthorized writes, output integrity.
- [ ] **Constraints specify alternatives.** Each constraint states what the agent *should* do instead, not just what it must not do.
- [ ] **Constraint style matches persona type.** Flat list for action roles; categorized sub-sections for analytical roles.
- [ ] **Workflow is numbered.** Every step has a bold name and a clear action.
- [ ] **Workflow ends with a handoff block.** The terminal status is defined.
- [ ] **Operational Protocol is extracted** when the procedure is reused across normal work and rework.
- [ ] **Decision Logic exists if the persona judges pass/fail.**
- [ ] **Evaluation Criteria exist** if the persona evaluates across multiple named dimensions.
- [ ] **Scope boundaries are explicit** when the persona's territory borders another.
- [ ] **Output template is provided** if the output must follow a structured format.
- [ ] **Worked example is provided** if the output involves non-obvious data transformation.
- [ ] **Self-validation checklist is included** if the persona's output has no downstream agent to catch errors.
- [ ] **Sub-agent delegations specify inputs, expected output, and a validation step.**
- [ ] **Workflow respects task separation.** Research/gathering steps are separate from production/writing steps. No step combines fact-finding with deliverable production. (See Pattern 14.)
- [ ] **Every duty is trigger-anchored.** Each duty is foreground, action-gated, or checkpoint-slotted. Any continuous side-channel duty has *both* a forcing function and an incremental capture sink. (See Patterns 6 and 15.)
- [ ] **Every gate names an observable action.** No duty is gated on an agent-defined boundary ("after each chunk", "when you have enough"). Each names something that visibly happens: a file edited, a test run, a document saved. (See Pattern 15.)
- [ ] **Gated duties occupy their own numbered step.** The duty is not a trailing sub-clause on a primary-task step, and any repeating pair states its loop ("repeat steps N–M").
- [ ] **Incremental sinks are opened at session start.** The persona creates the sink artifact with a liveness marker before the primary task begins, so the working phase carries no setup cost.
- [ ] **Skipped duties are visible, not absorbable.** The report distinguishes "ran and found nothing" from "never ran"; the forcing function cannot be satisfied identically by both.
- [ ] **At most one continuous side-channel per persona.** Additional parallel observation duties are moved to a downstream persona or restructured as checkpoints.
- [ ] **Generation-time constraints are restated in the output template.** Style rules that fire while writing (e.g., "no counts") appear as authoring instructions inside the relevant template slots, not only in the Constraints section.
- [ ] **Rarely-fired conditionals have a workflow checkpoint.** Every "if present / if applicable" rule is backed by an explicit workflow step that forces the check each session.
- [ ] **No duplicated instructions.** Content shared across personas is extracted into reusable partials.
- [ ] **Tone is stratified: descriptive prose for content sections, imperative commands for constraints only.** Mission, Philosophy, Inputs, Workflow, and Operational Protocol use explanatory language. Only Rules & Constraints use imperative voice ("Do not", "Never", "Must"). If the whole persona reads like a list of commands, the constraints section loses its signal. See Core Philosophy §7.
- [ ] **Placeholders use curly braces.** Named slots use `{SCREAMING_SNAKE}`, authoring instructions use `{Sentence case}`. Never `<angle brackets>`.
- [ ] **Sections follow the recommended ordering.** Identity → knowledge → constraints → procedure.
- [ ] **The persona can be read in 60 seconds.** If it takes longer, the structure is too dense — extract detail into sub-sections or operational protocols.
- [ ] **Deliberate guide deviations are recorded in `design_notes`,** where the persona carries metadata. Any rule the persona knowingly breaks has an entry naming the rule and the constraint forcing the deviation. (See Governance Metadata.)

---

## Persona Templates

### Minimal Template

Use this for simple, single-mode personas with a linear workflow:

```markdown
# {PERSONA_DISPLAY_NAME}

## Mission

**Identity: {PROFESSIONAL_TITLE}.**

{1–3 sentences: what this agent does and what outcome it produces.}

---

## Inputs

You will be provided with:

- **{INPUT_NAME}:** {Description and source.}
- **{INPUT_NAME}:** {Description.}
- **Optional: {INPUT_NAME}:** {Description.}

---

## Outputs

{What the agent produces.}

### Output Location

{Where the output is saved — path pattern or convention.}

---

## Strict Constraints

- **{CONSTRAINT}:** {Rule and rationale.}
- **{CONSTRAINT}:** {Rule and rationale.}

---

## Workflow

1. **{STEP}:** {Action.}
2. **{STEP}:** {Action.}
3. **{STEP}:** {Action.}
4. **Handoff:** End the response with:
   ```
   AGENT: {PERSONA_NAME}
   STATUS: COMPLETE
   ```
```

### Full Template

Use this for complex, judgment-heavy, or multi-agent personas. Remove sections that don't apply.

```markdown
# {PERSONA_DISPLAY_NAME}

## Mission

**Identity: {PROFESSIONAL_TITLE}.**

{1–3 sentences: what this agent does and what outcome it produces.}

---

## Operating Philosophy

- **{Nominal or declarative title}:** {The principle as a claim about the domain, in the indicative mood.}
- **{Nominal or declarative title}:** {Statement of the principle.}
- **{Nominal or declarative title}:** {Statement of the principle.}

---

## Inputs

You will be provided with:

- **{INPUT_NAME}:** {Description and source.}
- **{INPUT_NAME}:** {Description.}
- **Optional: {INPUT_NAME}:** {Description.}

### Capabilities

- **{CAPABILITY}:** {What the agent is authorized to do.}
- **{CAPABILITY}:** {Authorization.}

---

## {TOOL_NAME} Integration

{How the agent interacts with an external tool or service.}

---

## Operational Protocol

{Detailed, reusable execution procedure for the core task.}

1. **{PHASE}:** {What to do.}
2. **{PHASE}:** {What to do.}

---

## Evaluation Criteria

Evaluate based on these dimensions:

* **{CRITERION}:** {What to assess.}
* **{CRITERION}:** {What to assess.}

---

## Rework Handling

1. **Read the bounce feedback:** {Where to find it.}
2. **Narrow your focus:** {Only address flagged issues.}
3. **Reference the feedback:** {Explicitly note which issues were resolved.}

---

## Decision Logic

- **PASS:** {Precise criteria for approval.}
- **FAIL (Bounce):** {Precise criteria for rejection and required information.}

---

## Output Template

```markdown
{Literal output structure}
```

---

## Strict Constraints

- **{CONSTRAINT}:** {Rule, rationale, and alternative action.}
- **{CONSTRAINT}:** {Rule, rationale, and alternative action.}

---

## Quality Checklist

Before submitting, verify:

- [ ] {Self-validation criterion}
- [ ] {Self-validation criterion}

---

## Workflow

1. **{STEP}:** {Action.}
2. **{STEP}:** {Action.}
3. **Delegate {TASK}:** Use `runSubagent` with `@{AGENT}`. Pass: {inputs}. Expected: {output}.
4. **{STEP}:** {Action.}
5. **Handoff:** End the response with:
   ```
   AGENT: {PERSONA_NAME}
   STATUS: COMPLETE
   ```
```

Remove sections that don’t apply. The structural order should be preserved even when sections are omitted.

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| **Persona Display Name** | Descriptive, human-readable. No version numbers in the content — those live in metadata. | `Changelog Writer Agent` |
| **Identity Title** | Real-world professional title at senior+ level. Parenthetical abbreviations are acceptable. | `Release Communications Editor`, `Developer Experience (DX) Storyteller` |
| **Handoff Agent Name** | Short form of the persona name | `AGENT: Changelog Writer` |
| **Status Values** | `SCREAMING_SNAKE_CASE` | `READY_FOR_PM`, `AUDIT_COMPLETE` |

### Placeholder Syntax

Personas and templates use curly-brace placeholders — **never angle brackets** (`<...>`). Angle brackets are parsed as HTML in Markdown, causing placeholders to silently disappear in rendered output.

Two tiers distinguish named slots from authoring instructions:

| Tier | Style | Meaning | Examples |
|------|-------|---------|----------|
| **Named slot** | `{SCREAMING_SNAKE_CASE}` | Replace with a specific, concrete value | `{PERSONA_NAME}`, `{FILENAME}`, `{STATUS}`, `{COUNT}` |
| **Authoring instruction** | `{Sentence case description}` | Write content matching this guidance | `{1–3 sentences describing the core responsibility}`, `{What the agent produces}` |

**The litmus test:** Can you name this slot in ≤ 3 words? → `{SCREAMING_SNAKE}`. Do you need a phrase to explain what goes here? → `{Sentence case description}`.

**Rules:**

- Named slots use `SCREAMING_SNAKE_CASE` to signal "this is a variable."
- Authoring instructions use sentence case to read naturally as fill-in-the-blank prompts.
- The same convention applies inside inline code: `` `**Identity: {TITLE}.**` ``.

### Markdown Separators (`---`)

Markdown horizontal rules (`---`) are **redundant** in persona content files and do not need to be included. Headings already provide a strictly stronger structural signal — they mark boundaries *and* carry semantic labels. Adding `---` between headed sections provides negligible additional value.

This applies to persona source files in `src/content/`. The build system and templates may use `---` in generated output for visual formatting, but persona authors should not add them manually.

**Rules:**

- Do not add `---` between sections in persona content files. Headings are sufficient.
- Do not add `---` after every section heading — this is a redundant pattern that adds no structural value.
- Existing `---` in persona files are harmless but unnecessary. Remove them when editing a file for other reasons; do not make separator-only cleanup passes.

---

## Governance Metadata

A persona's metadata carries three fields that exist purely to govern the persona's relationship with this guide. None of them is read by a build system or rendered into persona output — they are durable records for the humans and agents who audit and maintain the persona over time.

| Field | Type | Purpose |
|-------|------|---------|
| `audit_guide_version` | `string` | The version of this guide the persona was last audited against (e.g. `"2.9"`). |
| `audit_date` | `string` | ISO date of that audit (e.g. `"2026-08-26"`). |
| `design_notes` | block scalar | Deliberate, documented deviations from this guide, each with its rationale. |

### Metadata Without a Build System

Not every persona is compiled. A persona written as a system prompt for a web-based assistant — a Gemini Gem, a Claude Project, a custom GPT — is authored once and pasted into a text field, with no build step and no output targets. Metadata serves two distinct purposes, and only one of them survives that context:

| Purpose | Examples | Needed without a build system? |
|---|---|---|
| **Build inputs** | Per-target output filenames, tool lists, template flags, slugs and ids the build resolves | No. These describe a compilation step that does not exist. |
| **Governance and provenance** | `version`, changelog, `audit_guide_version`, `audit_date`, `design_notes` | Optional, and valuable for any persona expected to be maintained over time. |

**Rules:**

- **Carry only the metadata the persona's deployment needs.** A build-driven persona declares whatever its build requires. A hand-maintained persona carries governance fields at most, and the build-input fields are simply inapplicable — their absence is not a defect.
- **The author chooses where governance metadata lives, or whether to keep it.** With no metadata file to hold them, the options are frontmatter at the top of the persona document, a short header block in prose, or nothing at all. For a persona the author maintains alone and revises in place, omitting them entirely is a legitimate choice — the fields exist to answer questions across time and across maintainers, and a persona with neither has nothing to record.
- **Ask rather than assume.** Adding a metadata block to a persona destined for a system-prompt text field imposes structure the author may not want, and some assistants render frontmatter as literal text. Where the deployment context is not stated, the author's intent decides.
- **A missing audit stamp is not a failed audit.** Where a persona carries no metadata, an audit reports its verdict to the author directly instead of stamping it. The absence of a stamp says nothing about compliance.

### Audit Stamps

`audit_guide_version` and `audit_date` are written **only** when a persona passes an audit. A persona that fails retains its previous stamp (or none) until the findings are fixed and it is re-audited. Together the two fields answer the maintenance question this guide's evolution creates: *which personas predate the rules I just added?* Comparing a persona's stamp against the guide's current version identifies stale personas without re-reading them.

```yaml
audit_guide_version: "2.9"
audit_date: "2026-08-26"
```

### Design Notes

Some personas cannot follow every rule in this guide, and the reason is legitimate. A persona deployed as a system prompt for a web-based LLM cannot reference external documents, so the usual advice to extract bulky reference material into a separate file does not apply — and neither does the 60-Second Rule that the inline material breaks. Without a record, each audit re-derives the same finding, and each auditor must independently reason its way to the same conclusion.

`design_notes` makes that reasoning durable. Each entry names the rule being deviated from and the constraint that forces the deviation:

```yaml
design_notes: |
  Reference material stays inline (equipment table, Rainbow Eating Reference): this persona is
  deployed as a system prompt for web LLMs, where external documents cannot be reliably
  accessed. The "extract reference material" guidance and the 60-Second Rule do not apply.
```

**Design Rules:**

- **Name the rule and the reason.** An entry that states only what the persona does ("keeps its reference tables inline") is not actionable — an auditor cannot tell whether it is an accepted exception or an undocumented defect. The rule being waived and the constraint forcing the waiver both belong in the entry.
- **Reserve it for guide deviations.** This field is not a general comment field. Implementation notes, ideas for future revisions, and observations about the persona's behavior belong in the persona's changelog or in project documentation. A field that accumulates unrelated notes loses the property that makes it useful: everything in it is binding.
- **Deviations are accepted, not re-flagged.** A documented deviation is a decision already made. Audits report these as accepted exceptions rather than findings — see the Persona Curator's audit workflow.
- **Undocumented deviations remain defects.** The field records decisions; it does not grant blanket permission. A deviation with no entry is a finding, and adding an entry to silence a legitimate finding without a real constraint behind it defeats the mechanism.

---

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| **Mission too broad** | Agent makes unauthorized changes or produces inconsistent output | Split into two personas or add stricter constraints |
| **Missing scope boundaries** | Agent overlaps with another persona's territory | Add a Scope Boundaries table |
| **Workflow too vague** | Agent invents its own procedure, skips steps | Number every step, bold step names, add explicit decision points |
| **No Decision Logic** | Agent inconsistently approves or rejects work | Add an explicit Pass/Fail section with measurable criteria |
| **Constraints are suggestions** | Agent ignores soft language like "try to" or "generally" | Use imperative language: "Do not", "Must", "Never" |
| **Output format is described, not templated** | Agent produces loosely structured output | Replace prose descriptions with a literal Markdown template |
| **Rework re-runs the full workflow** | Agent wastes time and context re-doing work that was fine | Add a Rework Handling section that narrows focus to flagged issues |
| **Shared content is copy-pasted** | Inconsistencies creep in across personas when one is updated | Extract shared instructions into reusable partials |
| **No Operating Philosophy** | Agent makes inconsistent judgment calls across sessions | Add named guiding principles that encode how to think |
| **Philosophy reads like constraints** | Philosophy section is full of "Do not" and "Never" — duplicates or competes with Constraints | Rewrite principles as positive value statements ("X outranks Y"); move prohibitions into Rules & Constraints |
| **Positively framed commands in philosophy** | Principles avoid "Do not" but still address the agent directly — "Prefer X", "Favor Y", "Read Z, not W". Polarity is correct, mood is not, so the section still reads as instructions and drains signal from Constraints | Apply the "You should" test to every principle. Convert each imperative into a claim about the domain: "Prefer the smallest sufficient move" → "The smallest sufficient move carries the least risk". Fix verb-initial titles first — the body usually follows |
| **All-imperative monotone** | Every section — Mission, Philosophy, Inputs, Workflow — uses command voice ("Do X", "Never Y"), making the Constraints section indistinguishable from the rest of the document | Reserve imperative language for Rules & Constraints only. Rewrite other sections in descriptive, explanatory prose: explain *what* and *why*, not *must* and *must not*. The tonal contrast is what makes constraints visible. See Core Philosophy §7 (Tone Stratification) |
| **Constraints lack alternatives** | Agent knows what not to do but freezes on what to do instead | Add the alternative action to each constraint |
| **Inline procedure bloats the workflow** | Workflow exceeds 10 steps and is hard to follow | Extract the core procedure into an Operational Protocol |
| **Tool instructions mixed into workflow** | Agent confuses tool mechanics with task logic | Extract tool integration into its own section |
| **Research and production in one step** | Agent commits to conclusions before gathering all facts; output quality degrades with context length | Split into separate phases: gather/verify first, then produce (Pattern 14) |
| **Multiple triggerless background duties** | Side-channel output is thin, generic, or visibly reconstructed at handoff rather than gathered during work | Keep one side-channel maximum; equip it with a forcing function and an incremental capture sink (Patterns 6, 15) |
| **Pseudo action gate** | A duty is gated on an agent-defined boundary ("after each chunk", "at a natural pause") and reads as gated, but the sink stays empty until handoff | Re-gate on an observable action — a file edited, a test run, a document saved (Pattern 15) |
| **Self-absorbing forcing function** | "Found nothing" and "forgot to look" produce identical reports, so the mechanism never surfaces its own failure | Add a liveness marker at session start and require the report to distinguish the two cases (Patterns 6, 15) |
| **Constraint stated far from where it fires** | Rule holds in the final templated output but is violated in intermediate outputs (e.g., counts appear in a mid-session summary) | Restate the constraint as an authoring instruction inside the output template slot where it applies (Pattern 15) |
| **Conditional rule with no rehearsal** | "If present, do X" rules are skipped in the rare sessions where the condition actually holds | Add an explicit workflow step that performs the check every session (Pattern 15) |
| **Redundant `---` separators** | Horizontal rules between headed sections add no structural value | Remove `---` separators; headings are sufficient section boundaries |
