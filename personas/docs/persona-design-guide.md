# Persona Design Guide

> A blueprint for creating AI agent personas that follow the structure and philosophy established across the Ledger and Standalone persona suites.

**Version:** 2.0.  
**Last Updated:** 2026-04-11.  

---

## Core Philosophy

Every persona in this system is built on five foundational principles:

1. **The Professional Identity Model.** Each agent is modeled after a real-world senior professional role — not a generic "AI assistant." A Staff Software Engineer writes code differently than a Security Auditor reads it. The professional metaphor constrains behavior, sets expectations, and gives the agent a clear lens through which to evaluate its work.

2. **Specialists Over Generalists.** Each persona owns exactly one domain. A QA agent does not fix bugs. A Developer does not write changelogs. A Planner does not implement. Narrow scope produces higher-quality output because the agent's full context window is spent on depth, not breadth.

3. **Gatekeeping Through Structure.** Every persona guards a quality gate: the Planner guards plan coherence, the Developer guards implementation correctness, QA guards acceptance criteria, the Reviewer guards architectural integrity. The gate is explicit — each persona has a **Decision Logic** that defines Pass/Fail criteria.

4. **Predictable, Machine-Readable Output.** Every persona produces structured output in a known format and ends with a standardized handoff block. This makes personas composable — one agent's output becomes the next agent's input without ambiguity.

5. **Constraints Prevent Drift.** Agent behavior degrades when scope is implicit. Every persona includes explicit guardrails: what it must do, what it must not do, what it delegates. Constraints are not suggestions — they are load-bearing rules that prevent the agent from wandering.

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

{1–3 sentences describing the core responsibility. Focus on the outcome the agent produces, not the mechanics of how it works. Use active, imperative language.}
```

**Design Rules:**

- **Open with the Identity line.** Format: `**Identity: {TITLE}.**` — always bold, always a recognized professional role. This is not decoration; it anchors the agent's behavior throughout the session.
- **Choose the identity carefully.** The title shapes how the agent approaches its work. "Staff Software Engineer" produces different behavior than "Junior Developer." "Chief Product Officer" thinks strategically; "Technical Writer" thinks about clarity. Pick the seniority and domain that match the persona's responsibilities.
- **State the outcome, not the process.** "Produce a clear, actionable plan" is better than "Analyze requirements and write planning documents." The workflow section covers process — the mission covers purpose.
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
- A mission that lists five different responsibilities — scope is too wide.
- A mission that describes *how* rather than *what* — that's the workflow's job.

---

### 2. Operating Philosophy

The Operating Philosophy encodes the *judgment framework* the agent applies at every decision point. It is distinct from both the Mission (which defines *what* the agent does) and the Constraints (which define *what it must not do*). The philosophy shapes *how the agent thinks* when facing ambiguity.

This section is optional but highly recommended for complex or judgment-heavy roles. It is the distinguishing feature of the highest-quality personas.

**Structure:**

```markdown
## Operating Philosophy

- **{PRINCIPLE_NAME}:** {One–two sentence explanation of the principle.}
- **{PRINCIPLE_NAME}:** {Explanation.}
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
- **Keep it short.** 3–6 principles is the sweet spot. More than that and the agent can’t hold them all in working memory.
- **Use when the agent faces frequent ambiguity.** Not every persona needs a philosophy. A mechanical agent (like a Ledger Initializer) can operate entirely from its workflow. A judgment-heavy agent (like a README Writer or Documentation Curator) needs principles to navigate the gray areas.

**Examples:**

| Persona | Philosophy Section | Key Principles |
|---------|-------------------|----------------|
| Documentation Curator | Manifest-First Protocol | Manifest First, Context Efficiency, High Integrity, The 30-Second Rule, Authoritative Tone |
| Module Documenter | Code-Discovery Protocol | The 30-Second Rule, Intent Over Implementation, Ecosystem View, Documentation Tiering |
| README Writer | The README Funnel | Landing-page funnel: Hook → Features → Requirements → Quick Start → Learn More |
| Config Generator | (unnamed) | Documentation as Infrastructure, Generated Over Hand-Written, README = Why / Architecture = What, Convention Over Configuration, Minimal Viable Coverage |

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

- **Frame as imperatives.** "Do not fix bugs unrelated to your task" is clearer than "Bugs unrelated to the task should generally be left alone."
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

---

## Quality Checklist

Before shipping a new persona, verify:

- [ ] **Mission opens with `Identity: {TITLE}.`** — bold, professional role, period at the end.
- [ ] **Single responsibility.** The mission describes one clear outcome.
- [ ] **Operating Philosophy is present** if the role requires judgment in ambiguous situations.
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
- [ ] **No duplicated instructions.** Content shared across personas is extracted into reusable partials.
- [ ] **Language is imperative, not suggestive.** "Do X" not "You might consider X."
- [ ] **Placeholders use curly braces.** Named slots use `{SCREAMING_SNAKE}`, authoring instructions use `{Sentence case}`. Never `<angle brackets>`.
- [ ] **Sections follow the recommended ordering.** Identity → knowledge → constraints → procedure.
- [ ] **The persona can be read in 60 seconds.** If it takes longer, the structure is too dense — extract detail into sub-sections or operational protocols.

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

- **{PRINCIPLE_NAME}:** {Explanation of the guiding principle.}
- **{PRINCIPLE_NAME}:** {Explanation.}
- **{PRINCIPLE_NAME}:** {Explanation.}

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
| **Constraints lack alternatives** | Agent knows what not to do but freezes on what to do instead | Add the alternative action to each constraint |
| **Inline procedure bloats the workflow** | Workflow exceeds 10 steps and is hard to follow | Extract the core procedure into an Operational Protocol |
| **Tool instructions mixed into workflow** | Agent confuses tool mechanics with task logic | Extract tool integration into its own section |
