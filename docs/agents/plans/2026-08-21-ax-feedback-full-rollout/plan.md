# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context

The proof-of-concept AX Feedback rollout (2026-07-23, `2026-07-23-agent-experience-feedback`) validated
the shared partial approach with 5 representative personas: ledger Developer and Synthesis, standalone
Developer, README Curator, and Changelog Curator. The synthesis explicitly noted "The full rollout (all
personas) and Phase 2 (ledger persistence) remain open follow-up work." This plan completes the first
of those two items.

The strategic vision's long-term primary goal — iterative persona improvement via the "Personas First"
philosophy — is directly served by giving every agent the ability to self-report friction encountered
during work, which feeds back into persona refinement cycles.

Since that proof-of-concept, the Persona Design Guide reached **v2.5** (2026-08-21), adding Pattern 15
(Trigger Anchoring) and expanding Pattern 6 (Observation Side-Channel) with two *required* mitigations
for any observation duty: a forcing function **and** an incremental capture sink. AX Feedback is
squarely an observation side-channel and currently satisfies only the first. Rolling it out unchanged
would replicate a known design-guide violation across the entire persona suite, so this plan corrects
the partial before replicating it.

---

## Summary

Fix three defects in the existing `ax-feedback.md` shared partial, then roll it out to all 38 personas
that do not yet include it, across all three suites (ledger, standalone, ledger-support). The partial
must be corrected **before** replication: its current form emits a section-terminating `## AX Feedback`
H2 inside the `## Workflow` section, its literal template is mangled by the build system's separator
handling, and it lacks the incremental capture sink that Persona Design Guide Pattern 6 requires of
every observation side-channel. Replicating the current form would multiply all three defects by 48.

The capture sink is the agent's todo list. Making it universally available requires edits on two of
the three targets, which use different field names *and* different tool names: `tools: [todo]` for
VS Code, `cc_tools: [TodoRead, TodoWrite]` for Claude Code. Deep Agents needs no edit at all — its
generated frontmatter carries no tools field, and `create_deep_agent()` merges `write_todos` into
every agent's tool suite unconditionally. Claude Code's tool list falls back from `cc_tools:` directly
to `tools:` when a persona declares no override — the 9 ledger personas never override `cc_tools:`, so
they already inherit a Claude Code sink from the VS Code `tools:` list, including the Developer and
Synthesis personas already running AX Feedback. The real Claude Code gap is limited to the 4 personas
that declare their own `cc_tools:` override without Todo tools; overrides do not benefit from the
fallback. No persona gains filesystem write access.

After the partial is fixed, the rollout is mechanical: for each persona, add a numbered "AX Feedback"
workflow step before the handoff, bump the handoff step number, and add a changelog entry to the
persona's YAML metadata. Three follow-on steps close the gaps the rollout opens: fold the overlapping
`incident-logging` constraint into AX Feedback, register AX Feedback as a standard persona element in
the Persona Design Guide and the Persona Curator's checklist, and regenerate `docs/agents-overview.md`
(whose per-persona versions are derived from the changelog entries this plan rewrites).

---

## Architectural Context

The AX Feedback mechanism is a shared partial (`personas/shared/partials/ax-feedback.md`) that adds a
pre-handoff reflection step to persona content templates. When included, the agent emits a structured
`## AX Feedback` block at the end of its response — either "No friction encountered." or up to 3
categorized bullet points citing specific evidence.

The partial is included via `{{> ax-feedback}}` in each persona's content template
(`personas/*/src/content/*.md`), placed as the penultimate numbered workflow step — immediately before
the handoff step. This follows the established pattern in the 5 personas already using it.

Three distinct handoff patterns exist across the 38 remaining personas:

| Pattern | Count | Example |
|---------|-------|---------|
| Conditional `{{> handoff-block-*}}` | 6 ledger files | `3-developer.md` (already done) |
| Plain text `STATUS: …` block | 29 files | `readme-curator.md` (already done) |
| Separate `## Handoff` section (not numbered) | 3 standalone files | `agents-md-curator.md`, `ctx-architect.md`, `usage-scenarios-curator.md` |

Additionally, 7 multi-mode personas require one `ax-feedback` insertion per mode (following the
`changelog-curator.md` precedent):

| Persona | Modes | Insertions |
|---------|-------|------------|
| `persona-curator.md` | Create, Audit, Maintain | 3 |
| `manifest-curator.md` | Create, Update, Audit | 3 |
| `whatsnew-curator.md` | Generate, Rewrite | 2 |
| `standalone-archiver.md` | Import, Update | 2 |
| `documentation-curator.md` | Update, Audit, Create | 3 |
| `workspace-architect.md` | Onboard, Upgrade | 2 |
| `recipe-curator.md` | Single Recipe, Weekly Plan | 2 |

`documentation-curator.md`, `workspace-architect.md`, and `recipe-curator.md` are each structured as
separate `## Mode: …` / `## Workflow — … Mode` sections with their own numbered workflow and their own
plain-text `STATUS:` handoff — the same multi-mode shape as `changelog-curator.md`, not a single
workflow with one handoff. They are reclassified here accordingly.

Two further personas end a **single** workflow step with two alternative `STATUS:` variants
(`plan-refiner.md` steps 9/10, `ledger-doctor.md` step 10). These are terminal-status alternatives
within one handoff, not separate modes — each receives **one** insertion placed before the first
handoff step.

### Defects in the current partial

The proof-of-concept shipped the partial with three defects, all visible in the generated output at
`personas/standalone/vs-code/changelog-curator.agent.md` L140–L160:

| # | Defect | Evidence |
|---|--------|----------|
| D1 | The partial opens with an `## AX Feedback` H2. Rendered inside `## Workflow`, this H2 structurally terminates the Workflow section, leaving the handoff step orphaned outside it. Multi-mode personas render 4 identical H2 headings in one document. | Generated L142 (`## AX Feedback`) sits between numbered steps 10 and 11. |
| D2 | The literal template inside the partial's fenced code block is mangled by the build system's Markdown separator handling: the `---` and the following `## AX Feedback` are separated by injected blank lines *inside* the fence. The agent is shown a template that does not match the source. | Generated L146–L152 vs. source `ax-feedback.md` L7–L13. |
| D3 | The partial has a forcing function (the mandatory `"No friction encountered."` form) but **no incremental capture sink**. Persona Design Guide Pattern 6 requires both. Without a sink, the agent performs end-of-session reconstruction — back-filling plausible friction at handoff rather than reporting what was actually salient in the moment. | Design Guide v2.5, Pattern 6, "Two required mitigations". |

D1 and D2 are rendering defects; D3 is a design-compliance defect that materially degrades output
quality for long-session personas (ledger Developer, QA, Reviewer, `plan-refiner`,
`workspace-architect`, `ledger-doctor`).

### Overlap with `incident-logging`

Five ledger personas directly carry an **Environment Incident Logging** constraint via the
`{{> incident-logging}}` partial: `4-qa.md` (L54), `5-security-auditor.md` (L53), `6-reviewer.md`
(L70), `7-release-engineer.md` (L49), `8-documentation.md` (L50). A sixth persona carries the same
scope indirectly: `3-developer.md` (L137) includes `{{> developer-strict-constraints}}`, and that
shared partial itself embeds `{{> incident-logging}}` (L13) as its own "Environment Incident Logging"
bullet. `3-developer.md` already shipped as a Step-0 proof-of-concept persona, so it enters this fold
alongside the 5 direct-inclusion personas. Its scope ("tool returning unexpected errors, file
operations silently failing") is a strict subset of AX Feedback's. Two overlapping duties covering the
same information means the agent reports it once, in whichever slot it reaches first —
non-deterministically. This plan resolves the overlap by folding all non-blocking reporting into AX
Feedback (see Step 5).

### Sub-agent propagation

Ten personas dispatch work via `runSubagent` / the `Task` tool: `2-project-manager.md`,
`7-release-engineer.md`, `8-documentation.md`, `9-synthesis.md`, `developer.md` (standalone),
`documentation-curator.md`, `manifest-curator.md`, `plan-refiner.md`, `web-gui-specialist.md`,
`workspace-architect.md`. After the rollout, every sub-agent returns an AX Feedback block inside its
output. Without an explicit rule, these blocks nest and duplicate as they bubble up through the
parent's own AX Feedback section. Step 0 adds the propagation rule to the partial.

---

## Approach / Architecture

No new architecture. The `ax-feedback.md` shared partial is corrected in place, then reused. The work
is a fix-then-replicate sequence: repair the partial (Step 0), verify the repair against the 5
personas that already include it, then perform 48 `{{> ax-feedback}}` insertions across 38 content
templates, with corresponding changelog entries in 38 YAML metadata files, an `incident-logging`
reconciliation across 6 ledger personas, Design Guide and Persona Curator updates, an
`agents-overview.md` regeneration, and one suite-level changelog update.

**Sequencing rationale:** Step 0 must complete and be verified before Steps 1–3 begin. Every defect
left in the partial is replicated 48 times; fixing it afterwards requires re-touching all 38 files.

### Insertion pattern

For every persona, the same two-line pattern is inserted before the handoff step:

```
N. **AX Feedback:** Before handing off, reflect on your session experience.

{{> ax-feedback}}
```

The handoff step's number is incremented by 1. For multi-mode personas, this pattern is repeated
before each mode's handoff block. For personas with a shared `## Handoff` section (not numbered),
the pattern is placed before the heading without a step number.

### Insertion count

| Category | Files | Insertions |
|----------|-------|------------|
| Single-handoff (incl. two-STATUS-variant personas) | 31 | 31 |
| `persona-curator.md` (3 modes) | 1 | 3 |
| `manifest-curator.md` (3 modes) | 1 | 3 |
| `whatsnew-curator.md` (2 modes) | 1 | 2 |
| `standalone-archiver.md` (2 modes) | 1 | 2 |
| `documentation-curator.md` (3 modes) | 1 | 3 |
| `workspace-architect.md` (2 modes) | 1 | 2 |
| `recipe-curator.md` (2 modes) | 1 | 2 |
| **Total** | **38** | **48** |

Generated output affected: 38 personas × 3 targets (`vs-code`, `claude-code`, `deep-agents`) = **114
generated files**, plus the 15 already-generated files for the 5 proof-of-concept personas re-emitted
by the Step 0 partial fix.

---

## Rationale

**Why the partial is fixed before rollout.** The partial's *content design* is sound and validated:
it is universal, suite-agnostic, contains no MCP-specific content (C18-compliant), and adapts to any
agent type — lightweight curators produce "No friction encountered." while heavyweight agents produce
categorized observations. The "Most sessions are expected to have zero friction" framing is a
deliberate anti-confabulation guard and is retained verbatim. What requires correction is its
*rendering* (D1, D2) and its *Pattern 6 compliance* (D3) — none of which the proof-of-concept's
5-persona scope made visible as a systemic cost. At 48 insertions the cost becomes structural.

**Why an incremental capture sink.** Design Guide Pattern 6 states that a forcing function without a
sink produces end-of-session reconstruction: "an agent that stopped observing mid-session will, at
synthesis time, look back over its context and back-fill plausible observations. The result often
looks acceptable but misses everything that was only salient in the moment." AX Feedback's entire
value is capturing in-the-moment friction; reconstruction produces exactly the plausible-but-hollow
output that makes the mechanism worthless for persona refinement. The sink is one sentence of
instruction and applies uniformly, so no tiering is needed to gate it.

**Why per-mode insertion for multi-mode personas.** The `changelog-curator.md` precedent includes the
partial once per mode. Each mode is a self-contained workflow with its own handoff; an agent executing
a single mode should encounter the AX Feedback step regardless of which mode was activated.

**Why not a feature flag.** The proof-of-concept synthesis noted the absence of a YAML-based opt-out
flag (`ax_feedback: true|false`) as potential debt. With universal rollout, every persona includes the
partial unconditionally, so an opt-out flag adds complexity without a current consumer. If selective
exclusion becomes needed in the future, a flag can be added then.

**Why fold `incident-logging` into AX Feedback.** Both partials collect the same class of
information — problems the agent hit that were not its own fault. Keeping both means the agent
resolves the ambiguity itself, and the same incident lands in whichever slot it encounters first.
Folding all *non-blocking* reporting into AX Feedback gives the information one destination with one
trigger. `incident-logging`'s genuinely distinct residue — an incident that **blocks** the agent from
completing its work — is not feedback at all; it belongs in the handoff status, where it changes
routing. The two concerns separate cleanly along the blocking boundary.

**Why patch-level version bumps.** The change is behaviour-neutral for the persona's primary task: it
adds a reporting step, alters no decision logic, no constraints, and no outputs the downstream agent
consumes. Thirty-eight simultaneous minor bumps would inflate every version in the system for a
mechanical inclusion. The 6 ledger personas that also receive the `incident-logging` fold (Step 5)
are the exception — a constraint is removed there, so those take a minor bump.

**Why the Design Guide must be updated in the same plan.** After this rollout, AX Feedback is a
universal structural element of every persona in the system, but it appears in neither the Guide's
Recommended Section Order nor its Quality Checklist. The next persona authored in Create mode would
ship non-compliant on day one, and the Persona Curator's audit mode would not flag it. Registering
the element is what makes the rollout durable rather than a one-time sweep.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Rollout scope | All 38 remaining personas at once | Incremental rollout in 2–3 batches | The change is mechanical and identical for each persona — batching adds coordination overhead without reducing risk. A single rollout ensures consistent coverage. |
| Partial changes | Fix D1–D3 first, then replicate | Replicate as-is and fix later; add tiering (light vs. full) by persona complexity | Replicating known defects 48× turns a one-file fix into a 38-file cleanup. Tiering is separately rejected: the proof-of-concept validated a single tier across all agent types, and tiering introduces YAML fields and conditional logic without demonstrated need. |
| Heading level of the emitted block (D1) | `###` sub-block under the numbered step | Keep `## AX Feedback`; move the whole block into a dedicated section after `## Workflow` | `##` terminates the enclosing Workflow section and orphans the handoff step. A dedicated post-Workflow section would fix nesting but breaks the checkpoint-duty anchoring that gives the step its trigger (Pattern 15) — the step must stay inside the numbered workflow. |
| Capture sink medium (D3) | The todo list, mandated | A dedicated `ax-friction.md` scratch file; or leaving the medium to the agent's choice | A todo entry is ephemeral and touches no filesystem, so it conflicts with no read-only guardrail — including the four personas deliberately denied `edit`. A scratch file collides with constraints like "never create project files" and forces case-by-case adjudication. Leaving the medium open was rejected because an unmandated sink is weakly triggered: Pattern 6 requires the sink be a concrete, named destination, not an intention. |
| Enabling the sink for personas lacking a sink capability | Grant todo tools on the two YAML-declared targets — `tools: [todo]` and, for the 4 personas with an explicit `cc_tools:` override, `cc_tools: [TodoRead, TodoWrite]`; Deep Agents needs no grant | Grant `edit` to the 4 personas without it so they can write scratch files | Only 4 of 43 personas lack `edit`, and in every case the omission is deliberate (write-free curation, forensic analysis, chat-only output, commit-only scope). Granting write access to enable friction capture would weaken a real safety property to obtain something the todo list already provides. The todo gaps, by contrast, are incidental — the ledger-support suite was authored without `todo`, and 4 personas' explicit `cc_tools:` overrides omit the Todo tools that the suite defaults include. |
| Scope of the todo grant | Fix `tools:` (11 files) and the 4 per-persona `cc_tools:` overrides lacking Todo tools | Also edit each suite's `_shared.yaml` `default_cc_tools` | `default_cc_tools` is not read anywhere in `@mistralys/persona-builder`'s merge chain (`persona-builder.ts` L311–313) — the real fallback for personas with no `cc_tools:` override is `cc_tools:` → `tools:` directly. Editing `_shared.yaml` would touch a field with zero effect on generated output while leaving the actual gap (the 4 overrides) unaddressed. |
| Sink wording in the shared partial | Target-neutral prose ("your todo list") | Name the tool explicitly; or branch with `{{#if target_vscode}}` / `{{#if target_claude_code}}` | The tool is `todo` on VS Code, `TodoWrite` on Claude Code, and `write_todos` on Deep Agents. A hard-coded name is wrong on two of three targets. Conditional branching would work but adds template complexity for no gain, since the prose form is accurate everywhere. |
| Multi-mode handling | One insertion per mode | One insertion at the end of the file, outside any mode section | Agents follow a single mode per session; placing AX Feedback outside all modes risks it being skipped by an agent that stops after its mode's handoff. |
| Two-STATUS-variant personas | One insertion before the first handoff step | One insertion per STATUS variant | The variants are alternative terminal statuses of a single handoff, not separate modes. Two insertions would emit the AX Feedback block twice in one workflow. |
| `incident-logging` overlap | Fold all non-blocking reporting into AX Feedback | Keep both with scoped boundaries (incident = blocked-me-now, AX = design friction); delete `incident-logging` outright | Two partials for one information class forces the agent to arbitrate at report time. Deleting outright would lose the blocking-incident case, which legitimately affects handoff status rather than feedback — so that residue moves to the handoff instead. |
| Version bump level | Patch for the 33 inclusion-only rollout personas, minor for the 5 rollout personas with the `incident-logging` fold | Minor for all 38 | Inclusion is behaviour-neutral for the persona's primary task; a uniform minor bump inflates every version in the system. The fold personas lose a constraint, which warrants minor. |

---

## Pattern Alignment

- **Follows** the proof-of-concept insertion pattern established in `personas/ledger/src/content/3-developer.md` (L148–L156) — numbered "AX Feedback" step, `{{> ax-feedback}}`, then handoff.
- **Follows** the multi-mode precedent of `personas/standalone/src/content/changelog-curator.md` — one `{{> ax-feedback}}` per mode's handoff.
- **Follows** C4a (numbered workflow steps must match included partials) — every `{{> ax-feedback}}` inclusion has a corresponding numbered step in the same change.
- **Follows** C18 (shared partials must not contain MCP content) — the Step 0 edits to `ax-feedback.md` introduce no MCP references; the sink instruction names the agent's todo list, not ledger tools.
- **Follows** Persona Design Guide Pattern 6 (Observation Side-Channel) — Step 0 supplies the second required mitigation (incremental capture sink) alongside the existing forcing function.
- **Follows** Pattern 15 (Trigger Anchoring) — AX Feedback is a checkpoint duty: a numbered workflow step with a mandatory output slot. The heading fix (D1) preserves this anchoring by keeping the block inside the numbered workflow rather than relocating it to its own section.
- **Follows** the guide's one-side-channel-per-persona limit — Step 5's `incident-logging` fold prevents the 6 affected ledger personas from carrying two competing observation duties.

---

## Detailed Steps

### Step 0: Fix the shared partial (1 file) — BLOCKING

Edit `personas/shared/partials/ax-feedback.md` to resolve D1–D3 and add the sub-agent propagation
rule. **No other step may begin until this step is verified.**

**D1 — Heading level.** Change the partial's opening `## AX Feedback` to a bolded label or `###`
sub-block so it nests under the numbered workflow step instead of terminating the `## Workflow`
section. The `## AX Feedback` heading *inside the fenced template block* stays as-is — that is the
literal output format the agent must emit, not persona structure.

**D2 — Fenced-block mangling.** The build system's Markdown separator handling injects blank lines
around the `---` inside the fenced template. Determine whether the fix belongs in the partial (escape
or restructure the template so the separator is not treated as a section break) or in the build
system's separator handling. Prefer the partial-side fix: it is local and does not risk regressing
other partials. After the fix, the rendered fenced block must be byte-identical to the source.

**D3 — Incremental capture sink.** Add a sentence instructing the agent to record friction **in its
todo list** the moment it occurs, and to compile the AX Feedback block *from that record* rather than
from recall at handoff time. Retain the existing "Most sessions are expected to have zero friction."
framing verbatim — it is the anti-confabulation guard and the sink must not undermine it.

The sink is the **todo list**, not a scratch file. A todo entry is ephemeral and has zero filesystem
footprint, so it conflicts with no persona's read-only guardrail. A scratch file would collide with
constraints such as `ledger-knowledge-curator`'s "never modify, create, or delete project files" and
would force every reader to adjudicate whether a friction note counts as a project file. Step 0a
closes the remaining gaps on the two targets that declare tools in YAML; Deep Agents already has the
sink built in.

**Write the instruction target-neutrally.** The shared partial is rendered for VS Code, Claude Code,
and Deep Agents, where the tool is named `todo`, `TodoWrite`, and `write_todos` respectively. The
sink sentence must refer to "your todo list" in prose rather than naming a specific tool, so it reads
correctly on every target. Do not hard-code `todo`, `TodoWrite`, or `write_todos` into the partial,
and do not use `{{#if target_*}}` branching for this — the prose form is accurate everywhere.

**Sub-agent propagation rule.** Add a rule covering what a persona does with AX Feedback returned by a
sub-agent it dispatched. Recommended: the parent does **not** re-emit the sub-agent's block verbatim;
it may merge a genuinely distinct item into its own list (attributed to the sub-agent, counting
against the 3-bullet cap) and otherwise drops it. Without this rule, blocks nest and duplicate through
`runSubagent` chains in the 10 dispatching personas.

**Verification before proceeding:**
- Run `node scripts/build-personas.js`.
- Inspect the 15 regenerated files for the 5 proof-of-concept personas (ledger `3-developer`,
  `9-synthesis`; standalone `developer`, `readme-curator`, `changelog-curator` — each × 3 targets).
- Confirm: no `## AX Feedback` H2 appears between numbered workflow steps; the `## Workflow` section
  is unbroken through to the handoff step; the fenced template renders byte-identically to source;
  `changelog-curator` (2 modes) renders 2 correctly-nested blocks, not 4 H2 headings.
- Add a changelog entry for each of the 5 proof-of-concept personas covering the partial fix.

### Step 0a: Grant todo tools on the two YAML-declared targets (15 personas)

The capture sink requires a todo list. **The tool has different names per target and is declared in
two separate YAML fields** — granting it on one target does not grant it on the other. Deep Agents is
not YAML-driven at all and needs no edit.

| Target | YAML field | Tool name(s) | Fallback chain |
|--------|-----------|--------------|----------------|
| VS Code | `tools:` | `todo` | none — the field is authoritative |
| Claude Code | `cc_tools:` | `TodoRead` **and** `TodoWrite` | `cc_tools:` → `tools:` directly if `cc_tools:` is absent |
| Deep Agents | — (no tools field) | `write_todos` | n/a — built in at runtime; see below |

**Deep Agents needs no edit.** The `deep-agents` target's frontmatter template is `name` +
`description` only (`DEFAULT_FRONTMATTER_DEEP_AGENTS` in `@mistralys/persona-builder`
→ `src/targets/types.ts`), and no persona content template references `{{da_tools_list}}`,
`{{da_tools_json}}`, or `{{da_tools_block}}` — so the generated Deep Agents files declare no tools at
all. Tool availability is decided at runtime by `create_deep_agent()` in
`orchestrator/src/nodes/__init__.py`, which is called with `tools=wrapped_tools` (MCP tools only) and
merges its built-in suite — `write_todos`, filesystem tools, `execute`, `task` — into every agent
unconditionally ("passing tools here is additive — it never removes a built-in"). Every Deep Agents
persona therefore already has the capture sink, and adding a `da_tools:` field would not change that.

**`default_cc_tools` in each suite's `_shared.yaml` is not consumed by the build system.** No code
path in `@mistralys/persona-builder` reads it — `buildContext()` (`persona-builder.ts` L311–313)
computes the effective Claude Code tool list as `Array.isArray(merged['cc_tools']) ? merged['cc_tools']
: tools`, i.e. **`cc_tools:` if present, else `tools:` directly.** `default_cc_tools` is unreferenced
YAML data in all three suites' `_shared.yaml` files; the library's own test suite
(`tools-block-fields.test.ts`, `'falls back to tools when cc_tools is absent'`) confirms `tools:` is
the only fallback target. Personas without a `cc_tools:` override therefore already inherit their
Claude Code tool list from `tools:` — verified against generated output: `personas/ledger/claude-code/
1-planner.md`, `4-qa.md`, and `9-synthesis.md` all render `tools:` (not a separate `default_cc_tools`
list) with `todo` already present. **No edit to any `_shared.yaml` has any effect on generated output**
and no such edit is included in this step.

The real gap is therefore limited to personas that declare their own `cc_tools:` override, since an
override does not benefit from the `tools:` fallback at all.

**Current state — the gap is on personas with an explicit `cc_tools:` override:**

| Target | Personas lacking a todo capability | Cause |
|--------|-----------------------------------|-------|
| VS Code (`todo`) | 11 | 9 ledger-support personas + `git-committer` + `recipe-curator` |
| Claude Code (`TodoRead`/`TodoWrite`) | 4 | the 4 personas with an explicit `cc_tools:` override lacking Todo tools: `ctx-architect`, `git-committer`, `module-intent-architect`, `ledger-claude-coordinator` |

Two personas lack it on both targets: `git-committer`, `recipe-curator` (`recipe-curator` has no
`cc_tools:` override, so its VS Code gap does not carry over to Claude Code). All 15 persona-file gaps
(11 VS Code + 4 Claude Code) are closed by this step — there are no exclusions.

**0a-1 — Add `- todo` to `tools:` (11 files):**

| Persona | Suite |
|---------|-------|
| `ledger-bootstrapper` | ledger-support |
| `ledger-claude-coordinator` | ledger-support |
| `ledger-dependency-sequencer` | ledger-support |
| `ledger-knowledge-archiver` | ledger-support |
| `ledger-knowledge-curator` | ledger-support |
| `ledger-orchestrator-archaeologist` | ledger-support |
| `ledger-pipeline-configurator` | ledger-support |
| `ledger-wp-decomposer` | ledger-support |
| `standalone-archiver` | ledger-support |
| `git-committer` | standalone |
| `recipe-curator` | standalone |

Nine of the eleven are the ledger-support suite, authored without `todo` throughout — only
`ledger-doctor` and `ledger-orchestrator-runner` have it. This is an incidental gap, not a deliberate
restriction: nothing in those personas' constraints forbids task tracking. This edit affects the
VS Code target only; Deep Agents is unaffected either way.

**0a-2 — Add `TodoRead` and `TodoWrite` to per-persona `cc_tools:` overrides (4 files):**

| Persona | Why it needs an explicit override |
|---------|----------------------------------|
| `ctx-architect` | Declares its own `cc_tools:` without Todo entries, so it does not inherit the standalone default. No comment explains the omission — treat as incidental. |
| `git-committer` | Declares `cc_tools: [Bash, Read, Grep, Glob]`. Add both Todo tools. |
| `module-intent-architect` | Declares its own `cc_tools:` without Todo entries. Add both Todo tools **and delete the stale comment** above the field (see below). |
| `ledger-claude-coordinator` | Declares `cc_tools: [Task, Read, Grep]`. Add both Todo tools (see below). |

**`module-intent-architect` — delete the stale comment.** Its YAML carries the line
`# cc_tools differs from default: module-intent-architect has no TodoRead/TodoWrite`. This looks like
a documented decision but is not: it states *what* differs and never *why*. Git history shows it is a
leftover, not a rationale:

| Commit | Date | Effect |
|--------|------|--------|
| `aad1438` | 2026-02-23 | Build-system migration. `tools:` had **no** `todo` and `cc_tools:` had no Todo tools — the two lists agreed, and the comment merely flagged the divergence from `default_cc_tools`. |
| `6bc3423` | 2026-04-30 | Added `- todo` to `tools:` and **did not touch `cc_tools:`**. The comment was left behind. |

Since April the comment has described an unintentional inconsistency rather than a decision. Nothing
in the persona's content or constraints argues against task tracking, and it runs a normal multi-step
workflow like its peers. Treat it as the same incidental gap as `ctx-architect`, add the Todo tools,
and remove the comment so it does not mislead a future reader.

**`ledger-claude-coordinator` — the read-only allowlist does not cover `todo`.** Its constraints read
"You may call only these **ledger tools**", followed by eight `ledger_*` entries, and the preceding
constraint scopes the boundary explicitly: "Any `ledger_*` tool not on that list is forbidden." The
allowlist governs the `ledger_*` namespace, not the persona's entire toolset. `todo` is not a ledger
tool and was never in scope.

The persona's own metadata confirms this reading: its `tools:` list includes `execute` and `edit`
even though its constraints say "No direct work" and "No file edits." Those boundaries are enforced
as behavioural rules, not by withholding tools. Withholding `todo` would be inconsistent with how
every other constraint in this persona is enforced.

It is also the strongest candidate for a todo list in the suite: it runs a dispatch loop over every
WP in a project — spawn, wait, report, repeat, plus rework cycles — which is the longest-running
session shape in the system. Tracking dispatch state across that loop is a direct benefit beyond the
AX Feedback sink.

**No deliberate exclusions remain.** Every persona ends up with a todo capability on every target —
by YAML grant on VS Code and Claude Code, and by runtime built-in on Deep Agents. The two
divergences that initially looked intentional — `module-intent-architect`'s YAML comment and
`ledger-claude-coordinator`'s narrow `cc_tools` — were both found to be incidental on inspection. When
evaluating an apparent exclusion, require a rationale stated in the persona's content that actually
covers the tool in question; a YAML comment restating a diff, or a constraint scoped to a different
tool namespace, does not qualify.

**Do not grant `edit` to any persona.** Only 4 personas lack it, and each omission is deliberate:
`ledger-knowledge-curator` (write-free curation), `ledger-orchestrator-archaeologist` (forensic
analysis, not remediation), `recipe-curator` (chat output only), `git-committer` (stages and commits
rather than authors). Granting write access purely to enable a friction sink would trade a real safety
property for a capability the todo list already provides.

Fold these metadata edits into Step 4's changelog entries; the entry text for affected personas should
mention the todo grant.

### Step 1: Add AX Feedback to ledger persona content templates (7 files)

For each file in `personas/ledger/src/content/`, insert the AX Feedback step before the handoff step
and bump the handoff step number:

| File | Current handoff step | New AX step | New handoff step |
|------|---------------------|-------------|------------------|
| `1-planner.md` | 10 | 10 | 11 |
| `2-project-manager.md` | 10 | 10 | 11 |
| `4-qa.md` | 7 | 7 | 8 |
| `5-security-auditor.md` | 7 | 7 | 8 |
| `6-reviewer.md` | 8 | 8 | 9 |
| `7-release-engineer.md` | 9 | 9 | 10 |
| `8-documentation.md` | 8 | 8 | 9 |

All 7 use the conditional `{{> handoff-block-*}}` pattern (except `1-planner.md` which uses a plain
text `STATUS: READY_FOR_PM` block). Follow the exact pattern from `3-developer.md` L148–L163.

### Step 2: Add AX Feedback to standalone persona content templates (20 files)

**Single-handoff personas (11 files):** Insert the AX Feedback step before the handoff step and bump
the handoff step number. Follow the pattern from `readme-curator.md` L147–L152.

| File | Current handoff step | New AX step | New handoff step |
|------|---------------------|-------------|------------------|
| `comms-curator.md` | 7 | 7 | 8 |
| `composer-curator.md` | 7 | 7 | 8 |
| `git-committer.md` | 10 | 10 | 11 |
| `module-intent-architect.md` | 7 | 7 | 8 |
| `plan-architect-reviewer.md` | 7 | 7 | 8 |
| `plan-auditor.md` | 11 | 11 | 12 |
| `planner.md` | 7 | 7 | 8 |
| `researcher.md` | 10 | 10 | 11 |
| `unit-test-auditor.md` | 5 | 5 | 6 |
| `web-gui-specialist.md` | 9 | 9 | 10 |
| `plan-refiner.md` | 9 and 10 (alternative terminal statuses) | 9 | 10 and 11 |

**`plan-refiner.md` — single insertion.** Steps 9 (`CONVERGED`) and 10 (`CEILING_REACHED |
DIVERGING | INCOMPLETE`) are mutually exclusive terminal outcomes of one handoff, not modes. Insert
**one** AX Feedback step as the new step 9, and renumber both existing handoff steps to 10 and 11.

**Shared-section handoff personas (3 files):** Insert an unnumbered AX Feedback block before the
`## Handoff` section heading.

| File | Insertion point |
|------|----------------|
| `agents-md-curator.md` | Before `## Handoff` section (L323) |
| `ctx-architect.md` | Before `## Handoff` section (L397) |
| `usage-scenarios-curator.md` | Before `## Handoff` section (L352) |

**Multi-mode personas (6 files):** Insert one AX Feedback step before each mode's handoff, following
the `changelog-curator.md` multi-mode precedent.

| File | Mode | Handoff location |
|------|------|-----------------|
| `persona-curator.md` | Create | Before handoff at L86 |
| `persona-curator.md` | Audit | Before handoff at L107 |
| `persona-curator.md` | Maintain | Before handoff at L173 |
| `manifest-curator.md` | Create | Before handoff at L126 |
| `manifest-curator.md` | Update | Before handoff at L163 |
| `manifest-curator.md` | Audit | Before handoff at L184 |
| `whatsnew-curator.md` | Generate | Before handoff at L155 |
| `whatsnew-curator.md` | Rewrite | Before handoff at L170 |
| `documentation-curator.md` | Update | Before handoff at L111 |
| `documentation-curator.md` | Audit | Before handoff at L133 |
| `documentation-curator.md` | Create | Before handoff at L201 |
| `workspace-architect.md` | Onboard | Before handoff at L180 |
| `workspace-architect.md` | Upgrade | Before handoff at L211 |
| `recipe-curator.md` | Single Recipe | Before handoff at L330 |
| `recipe-curator.md` | Weekly Plan | Before handoff at L357 |

`documentation-curator.md`, `workspace-architect.md`, and `recipe-curator.md` were previously
misclassified as single-handoff insertions (see Architectural Context); each is reclassified here as
multi-mode, following the same `changelog-curator.md` precedent as the other four multi-mode files.

### Step 3: Add AX Feedback to ledger-support persona content templates (11 files)

**Single-handoff personas (10 files):** Insert the AX Feedback step before the handoff step and
bump the handoff step number.

| File | Current handoff step | New AX step | New handoff step |
|------|---------------------|-------------|------------------|
| `ledger-bootstrapper.md` | 4 | 4 | 5 |
| `ledger-claude-coordinator.md` | 5 | 5 | 6 |
| `ledger-dependency-sequencer.md` | 5 | 5 | 6 |
| `ledger-doctor.md` | 10 (two STATUS variants in one step) | 10 | 11 |
| `ledger-knowledge-archiver.md` | 11 | 11 | 12 |
| `ledger-knowledge-curator.md` | 8 | 8 | 9 |
| `ledger-orchestrator-archaeologist.md` | 9 | 9 | 10 |
| `ledger-orchestrator-runner.md` | 9 | 9 | 10 |
| `ledger-pipeline-configurator.md` | 7 | 7 | 8 |
| `ledger-wp-decomposer.md` | 5 | 5 | 6 |

**Mid-file handoff notes:** `ledger-pipeline-configurator.md` has a Quality Checklist after its
handoff, and `ledger-orchestrator-archaeologist.md` has a developer note after its handoff. The AX
Feedback step goes before the handoff step, not at EOF.

**`ledger-doctor.md` — single insertion.** Step 10 ends with two alternative status blocks
(`DIAGNOSIS_COMPLETE` / `REPAIRS_APPLIED`) inside one step. Insert one AX Feedback step as the new
step 10 and renumber the handoff step to 11.

**Multi-mode persona (1 file):** `standalone-archiver.md` — insert one AX Feedback step before each
mode's handoff:

| Mode | Handoff location |
|------|-----------------|
| Import | Before handoff at L126 |
| Update | Before handoff at L154 |

### Step 4: Add changelog entries to persona YAML metadata (43 files)

For each persona whose content template was modified in Steps 1–3, add a changelog entry to its YAML
metadata file (`personas/*/src/meta/*.yaml`). The entry format follows the established pattern:

```yaml
changelog: |
  {version} ({date}): Added AX Feedback pre-handoff step via shared partial for agent experience self-reporting
  {existing entries...}
```

Prepend the new entry as the first line of the existing `changelog:` block scalar. **Every** persona
metadata file across all three suites already has a `changelog:` block — verified, no file needs one
created, and no persona is currently resolving its version from `default_version`. Never add or edit
standalone `version:` or `last_updated:` fields; the build system derives both from the first
changelog entry.

**Version bump level:**

| Group | Count | Bump | Reason |
|-------|-------|------|--------|
| Inclusion only (of the 38 rollout personas) | 33 | Patch | Behaviour-neutral addition of a reporting step. |
| Inclusion + `incident-logging` fold (of the 38 rollout personas; Step 5) | 5 | Minor | A constraint is removed from the persona. |
| Proof-of-concept personas without the fold (Step 0 partial fix only) | 4 | Patch | Rendering and sink correction only. |
| Proof-of-concept persona with the fold — `3-developer` (Step 0 fix + Step 5) | 1 | Minor | `3-developer.md` already received a patch bump at Step 0 for the partial-fix rollout; the `incident-logging` fold (Critical Finding #4 — its `developer-strict-constraints.md` inclusion carries the same overlap as the 5 direct-inclusion ledger personas) is a constraint removal layered on top. One persona gets one changelog entry per release cycle, so its single entry for this plan reflects the more significant change and takes a minor bump, not two separate patch bumps. |

The exact next version per persona is derived from the current first entry in its `changelog:` block.

### Step 5: Fold `incident-logging` into AX Feedback (7 files)

Six ledger personas carry both duties after Steps 1–3: the 5 with a direct `{{> incident-logging}}`
inclusion, plus `3-developer.md`, which carries it indirectly via `{{> developer-strict-constraints}}`
(that shared partial embeds `{{> incident-logging}}` as its own "Environment Incident Logging"
bullet — see Architectural Context, "Overlap with `incident-logging`"). Resolve the overlap by folding
all **non-blocking** reporting into AX Feedback and routing the **blocking** residue to the handoff.

**5a — Confirm the AX Feedback partial covers the folded scope.** Verify that the Step 0 partial
already covers what `incident-logging` collected (tooling errors, silently failing file operations,
unexpected tool behaviour). Its current category list — "tooling, instructions, context, handoff data,
or the target codebase" — covers this. Add the workaround-reporting element from `incident-logging`
("describe any workaround you found") if it is not already implied, plus its
do-not-over-investigate guard ("do not investigate root causes beyond what is needed to continue"),
which is a useful scope limiter for AX Feedback generally.

**5b — Handle the blocking residue.** An incident that prevents the agent from completing its work is
not feedback — it changes the handoff status and downstream routing. Confirm each of the 6 personas'
existing handoff/decision logic already covers "blocked by environment" as a terminal state. Where it
does not, add a single line to that persona's handoff or Decision Logic section. Do **not** add it to
the shared partial.

**5c — Remove the `{{> incident-logging}}` inclusion**, conditional block and all, from the 6 sites:

| File | Line | Removal target |
|------|------|-----------------|
| `personas/ledger/src/content/4-qa.md` | L53–L55 | `{{#if has_incident_logging}}` block |
| `personas/ledger/src/content/5-security-auditor.md` | L52–L54 | `{{#if has_incident_logging}}` block |
| `personas/ledger/src/content/6-reviewer.md` | L69–L71 | `{{#if has_incident_logging}}` block |
| `personas/ledger/src/content/7-release-engineer.md` | L48–L50 | `{{#if has_incident_logging}}` block |
| `personas/ledger/src/content/8-documentation.md` | L49–L51 | `{{#if has_incident_logging}}` block |
| `personas/shared/partials/developer-strict-constraints.md` | L13 | `* **Environment Incident Logging:** {{> incident-logging}}` bullet (unconditional — this shared partial has no `{{#if}}` guard) |

The 5 ledger content templates each wrap their `* **Environment Incident Logging:**
{{> incident-logging}}` bullet in a per-persona `{{#if has_incident_logging}}...{{/if}}` conditional
(YAML flag, all 5 currently `true`). Remove the **entire conditional block**, not just the inner
bullet — leaving the empty `{{#if}}...{{/if}}` wrapper behind would be dead template syntax. Also
remove the now-unused `has_incident_logging: true` flag from each of the 5 personas' YAML metadata
files (`personas/ledger/src/meta/4-qa.yaml`, `5-security-auditor.yaml`, `6-reviewer.yaml`,
`7-release-engineer.yaml`, `8-documentation.yaml`). `developer-strict-constraints.md` has no such
conditional — its bullet is unconditional — so removing the bullet there is sufficient; it carries no
`has_incident_logging` flag of its own since the flag lives on the content template, not the partial,
and `3-developer.md` does not gate its `{{> developer-strict-constraints}}` inclusion on one.

**5d — Delete `personas/shared/partials/incident-logging.md`** once no content template or shared
partial references it. Verify with a grep for `incident-logging` across `personas/` before deleting.

**5e — Bump these 6 personas to a minor version** (not patch) in Step 4's changelog entries, and note
the constraint removal in the entry text. `3-developer.md` already received a patch-level changelog
entry for the Step 0 partial fix as a proof-of-concept persona (see Step 4's version-bump table); its
single entry for this plan is minor, reflecting both changes together rather than two separate bumps.

### Step 6: Register AX Feedback in the Design Guide and Persona Curator (2 files)

AX Feedback is now a universal structural element. Without registration, newly authored personas omit
it and audits do not flag its absence.

**6a — `personas/docs/persona-design-guide.md`:**
- Add AX Feedback to the **Recommended Section Order** table as a penultimate entry, between
  *Workflow* (#13) and *Handoff* (#14), marked Required, with the purpose "Structured pre-handoff
  report of session friction."
- Add it to the **Required Sections** table.
- Add a Quality Checklist item: *"AX Feedback step is present as the penultimate workflow step,
  immediately before the handoff."*
- Extend **Pattern 6** with AX Feedback as a second worked example alongside the Developer's Code
  Insight Observer, noting how its forcing function and capture sink are realised.
- Bump the guide to **v2.6** and prepend a changelog line describing the addition.

**6b — `personas/standalone/src/content/persona-curator.md`:**
- Add the matching Quality Checklist item so Create and Audit modes enforce it.
- Add the AX Feedback row to the Create-mode recommended section order list.
- Bump the persona version (minor — behaviour change to its checklist) and add a changelog entry.

### Step 7: Update personas suite changelog

Add a new version entry to `personas/changelog.md` summarizing the rollout:

```markdown
## v3.33.0 - AX Feedback Full Rollout

- Shared partials: Fixed AX Feedback heading nesting and template rendering; added incremental
  capture sink and sub-agent propagation rule.
- All suites: Granted todo tools where missing so the AX Feedback capture sink works on VS Code and
  Claude Code; the ledger suite's Claude Code defaults now include `TodoRead`/`TodoWrite`. No persona
  gained filesystem write access.
- All suites: Every persona now includes an AX Feedback pre-handoff step for structured agent
  experience self-reporting; completes the full rollout started in v3.30.0.
- Ledger: Folded the Environment Incident Logging constraint into AX Feedback across 6 personas;
  removed the `incident-logging` partial.
- Docs: Registered AX Feedback as a required persona section in the Persona Design Guide (v2.6).
```

### Step 8: Regenerate the agents overview

`scripts/generate-agents-overview.js` derives each persona's displayed version from the first entry
of its `changelog:` block. Step 4 rewrites all 38, so `docs/agents-overview.md` becomes stale.

Run `node scripts/cli.js generate-overview` (or `node scripts/generate-agents-overview.js`) and commit
the result. Verify with `node scripts/generate-agents-overview.js --check` that no staleness remains.

### Step 9: Build and verify

Run `node scripts/build-personas.js` to regenerate all output files across all three suites and
targets. Verify:
- No build errors or warnings related to the `ax-feedback` partial.
- The generated output for each modified persona contains the AX Feedback block.
- No `## AX Feedback` H2 appears between numbered workflow steps in any generated file (D1 regression
  check).
- The fenced template block inside the rendered AX Feedback section matches the partial source
  byte-for-byte (D2 regression check).
- Run the mechanical per-file audit described in the Test Plan rather than ad-hoc spot-checks.

---

## Dependencies

- **Step 0 blocks everything.** The partial fix must be applied and verified against the 5
  proof-of-concept personas before any of Steps 1–3 begin. Replicating an unfixed partial converts a
  one-file correction into a 38-file cleanup.
- **Step 0a must land with Step 0.** The sink instruction added in Step 0 names the todo list; the
  personas lacking a todo capability cannot comply until the grants are in place. Step 0a spans both
  target-specific fields (`tools:` and per-persona `cc_tools:` overrides) — completing only one leaves
  a whole target without a sink for the personas that need it.
- Steps 1–3 (content templates) are independent of each other per file.
- Step 4 (YAML metadata) depends on Steps 1–3 and 5 being settled, since Step 5 determines which
  6 personas take a minor rather than a patch bump.
- Step 5 (`incident-logging` fold) depends on Step 0 — the fold assumes the corrected partial covers
  the folded scope.
- Step 6 (Design Guide / Persona Curator) depends on Step 0, since the guide documents the partial's
  final shape.
- Step 8 (agents overview) depends on Step 4 — it reads the rewritten changelog entries.
- Step 9 (build and verify) is last.

---

## Required Components

- `personas/shared/partials/ax-feedback.md` — **modified** (D1, D2, D3, sub-agent propagation rule)
- 11 persona metadata files gain a `- todo` entry in their `tools:` list (Step 0a-1): 9 in
  `personas/ledger-support/src/meta/`, 2 in `personas/standalone/src/meta/`
- 4 persona metadata files gain `TodoRead`/`TodoWrite` in their per-persona `cc_tools:` override
  (Step 0a-2): `personas/standalone/src/meta/ctx-architect.yaml`,
  `personas/standalone/src/meta/git-committer.yaml`,
  `personas/standalone/src/meta/module-intent-architect.yaml` (which also loses a stale comment),
  `personas/ledger-support/src/meta/ledger-claude-coordinator.yaml`
- `personas/shared/partials/incident-logging.md` — **deleted** (folded into AX Feedback)
- `personas/shared/partials/developer-strict-constraints.md` — **modified** (Step 5c): loses its
  `{{> incident-logging}}` bullet
- `personas/ledger/src/content/*.md` — 7 files modified for AX Feedback; 5 of them additionally lose
  their `{{#if has_incident_logging}}...{{/if}}` conditional block
- `personas/standalone/src/content/*.md` — 20 files modified
- `personas/standalone/src/content/persona-curator.md` — additionally modified for the checklist item
- `personas/ledger-support/src/content/*.md` — 11 files modified
- `personas/ledger/src/meta/*.yaml` — 7 files modified (+2 proof-of-concept personas: `3-developer`,
  `9-synthesis`); the 5 with the `incident-logging` fold also lose their `has_incident_logging` flag
- `personas/standalone/src/meta/*.yaml` — 20 files modified (+3 proof-of-concept personas:
  `developer`, `readme-curator`, `changelog-curator`)
- `personas/ledger-support/src/meta/*.yaml` — 11 files modified
- `personas/docs/persona-design-guide.md` — modified, bumped to v2.6
- `personas/changelog.md` — 1 file modified
- `docs/agents-overview.md` — regenerated
- `personas/docs/agents/project-manifest/api-surface.md`, `data-flows.md`, `constraints.md`,
  `variables.md` — **modified** (Documentation Updates): corrects the pre-existing `default_cc_tools`
  fallback documentation bug (see Documentation Updates)
- `.context/personas/manifest.md`, `.context/personas/shared-partials.md` — regenerated via
  `node scripts/cli.js ctx-generate` (mirror the manifest and partial changes above)
- `scripts/build-personas.js` — existing, no changes (used for verification)
- `scripts/generate-agents-overview.js` — existing, no changes (used in Step 8)

---

## Assumptions

- The `ax-feedback.md` partial's *content design* (categories, 3-bullet cap, zero-friction framing)
  works unchanged for all agent types. The proof-of-concept validated this across ledger, standalone,
  and support categories. Only its rendering and Pattern 6 compliance require correction.
- D2's fenced-block mangling is fixable partial-side. If investigation in Step 0 shows the defect
  originates in the build system's separator handling and cannot be worked around in the partial, the
  build-system fix becomes part of Step 0 and its scope grows accordingly.
- The 6 personas losing `incident-logging` already have a terminal state for "blocked by environment"
  in their handoff or Decision Logic. Step 5b verifies this per persona rather than assuming it.
- The absence of `todo` in the 9 ledger-support personas is an incidental authoring gap, not a
  deliberate restriction — no constraint in those personas forbids task tracking. Verified by reading
  their constraint sections; if any turns out to forbid it, that persona keeps the sink instruction
  but relies on in-context tracking.
- `default_cc_tools` in each suite's `_shared.yaml` is unreferenced by `@mistralys/persona-builder`'s
  merge chain — confirmed by reading `persona-builder.ts` and the library's test suite. The 9 ledger
  personas' effective Claude Code tool list is rendered from `tools:` (which already contains `todo`)
  via the real `cc_tools:` → `tools:` fallback, not from `default_cc_tools`. No edit to `_shared.yaml`
  is included in this plan for that reason.
- Neither of the two apparently-deliberate divergences survives inspection.
  `module-intent-architect`'s YAML comment is stale rather than intentional — verified against Git
  history (`aad1438`, `6bc3423`). `ledger-claude-coordinator`'s read-only allowlist is scoped to the
  `ledger_*` namespace and never covered `todo`; the persona already holds `execute` and `edit`
  despite constraints forbidding their use, so its boundaries are enforced behaviourally rather than
  by withholding tools. No persona is excluded from the todo grant.
- Granting todo tools has no side effects on persona behaviour beyond enabling task tracking. They
  confer no filesystem write access and therefore cannot weaken any read-only guardrail.
- The Deep Agents target declares no tools in its generated frontmatter and no content template
  references the `da_tools_*` context variables, so `da_tools:` has no effect there. Tool
  availability is set at runtime by `create_deep_agent()`, whose built-in suite always includes
  `write_todos`. If a future change starts rendering a tools list into Deep Agents output, the sink
  must be re-verified.
- No consumer outside the persona suites reads `incident-logging.md`. Step 5d verifies by grep before
  deleting.

---

## Constraints

- C4a: Every `{{> ax-feedback}}` inclusion must have a corresponding numbered workflow step.
- C18: The shared partial must not contain MCP-specific content — the Step 0 sink instruction must
  name the agent's todo list, never ledger tools such as `ledger_add_project_comment`.
- C1: Never edit generated output files — only edit `src/` templates.
- C3: After editing, run `build-personas.js` to regenerate output.
- The emitted AX Feedback block must not use an `##` heading level, which would terminate the
  enclosing `## Workflow` section.
- Persona metadata must never carry standalone `version:` or `last_updated:` fields; both are derived
  from the first `changelog:` entry.

---

## Out of Scope

- **Phase 2 (ledger persistence):** Persisting AX Feedback via `ledger_add_project_comment` is a
  separate initiative, not covered here.
- **Tiering (light vs. full):** The proof-of-concept considered tiering by agent complexity. No
  evidence has emerged that different tiers are needed — all agents use the same partial successfully.
- **Opt-out flag:** A YAML-based `ax_feedback: true|false` flag is not needed when every persona
  includes the partial unconditionally.
- **Partial content redesign:** Step 0 corrects rendering, adds the capture sink, and adds the
  sub-agent propagation rule. Rewording the category taxonomy, changing the 3-bullet cap, or altering
  the severity scheme is out of scope.
- **Aggregating AX Feedback across runs:** Collecting and analysing emitted feedback to drive persona
  refinement is the point of the mechanism but is a separate initiative (see Phase 2).
- **`incident-logging` semantics beyond the fold:** Step 5 removes the partial and routes its two
  halves (non-blocking → AX Feedback, blocking → handoff status). Redesigning how blocking incidents
  affect ledger routing is out of scope.

---

## Acceptance Criteria

**Partial fix (Step 0)**

- AC-01: `ax-feedback.md` emits no `##`-level heading as persona structure; the emitted block nests
  under its numbered workflow step.
- AC-02: In every generated file, the `## Workflow` section runs unbroken from its heading through the
  handoff step — no heading of level `##` appears between numbered workflow steps.
- AC-03: The fenced template block inside the rendered AX Feedback section is byte-identical to the
  corresponding block in `personas/shared/partials/ax-feedback.md`.
- AC-04: The partial instructs the agent to capture friction incrementally in its todo list as it
  occurs, and to compile the final block from that record rather than from recall.
- AC-04a: The sink instruction names the todo list in target-neutral prose — it does not hard-code
  `todo`, `TodoWrite`, `write_todos`, or any other target-specific tool name.
- AC-04b: All 43 persona metadata files declare `todo` in their `tools:` list (VS Code target).
- AC-04c: The 4 personas with an explicit `cc_tools:` override (`ctx-architect`, `git-committer`,
  `module-intent-architect`, `ledger-claude-coordinator`) include `TodoRead` and `TodoWrite` in that
  override.
- AC-04d: Every persona's *effective* Claude Code tool list — resolved as its own `cc_tools:` if
  present, otherwise its `tools:` list directly (never a suite `default_cc_tools`) — includes
  `TodoWrite`. There are no exclusions — all 43 personas.
- AC-04f: The stale `# cc_tools differs from default: module-intent-architect has no
  TodoRead/TodoWrite` comment is removed from
  `personas/standalone/src/meta/module-intent-architect.yaml`.
- AC-04e: No persona gains the `edit` tool as part of this plan; the 4 personas currently without it
  still lack it.
- AC-05: The partial retains the verbatim sentence "Most sessions are expected to have zero friction."
- AC-06: The partial states what a dispatching persona does with a sub-agent's returned AX Feedback.

**Rollout (Steps 1–4)**

- AC-07: All 38 persona content templates include `{{> ax-feedback}}` before their handoff step(s),
  for a total of 48 inclusions across the suite.
- AC-08: Multi-mode personas include one `{{> ax-feedback}}` per mode's handoff block
  (`persona-curator` 3, `manifest-curator` 3, `whatsnew-curator` 2, `standalone-archiver` 2,
  `documentation-curator` 3, `workspace-architect` 2, `recipe-curator` 2).
- AC-09: `plan-refiner.md` and `ledger-doctor.md` each contain exactly **one** inclusion despite their
  two terminal-status variants.
- AC-10: Every `{{> ax-feedback}}` inclusion has a corresponding numbered "AX Feedback" workflow step
  (or, for the 3 shared `## Handoff` sections, an unnumbered block before the heading).
- AC-11: Handoff step numbers are correctly bumped in all modified files; no numbered workflow list
  contains a duplicate or skipped ordinal.
- AC-12: All 38 persona YAML metadata files have a changelog entry for the AX Feedback addition, plus
  the 5 proof-of-concept personas for the Step 0 fix (43 entries total).
- AC-13: Version bumps follow Step 4's table — patch for the 37 inclusion-only personas (33 rollout +
  4 proof-of-concept personas without the fold), minor for the 6 `incident-logging` fold personas
  (5 rollout + `3-developer`, whose single changelog entry for this plan covers both the Step 0 fix
  and the fold).
- AC-14: No persona metadata file contains a standalone `version:` or `last_updated:` field.

**`incident-logging` fold (Step 5)**

- AC-15: No content template or shared partial references `{{> incident-logging}}`, and
  `personas/shared/partials/incident-logging.md` is deleted. This includes
  `personas/shared/partials/developer-strict-constraints.md`.
- AC-15a: The 5 ledger content templates' `{{#if has_incident_logging}}...{{/if}}` conditional blocks
  are removed in full (not just the inner bullet), and the now-dead `has_incident_logging` YAML flag
  is removed from all 5 affected persona metadata files.
- AC-16: Each of the 6 affected personas has a terminal handoff state covering "blocked by
  environment", verified or added.
- AC-17: The AX Feedback partial covers the folded scope, including workaround reporting and the
  do-not-over-investigate scope limiter.

**Guide registration (Step 6)**

- AC-18: `persona-design-guide.md` lists AX Feedback in both the Recommended Section Order and the
  Required Sections tables, has a matching Quality Checklist item, and is bumped to v2.6 with a
  changelog line.
- AC-19: `persona-curator.md`'s Quality Checklist contains the matching AX Feedback item.

**Build and overview (Steps 7–9)**

- AC-20: `personas/changelog.md` has a new version entry covering the partial fix, the rollout, the
  fold, and the guide update.
- AC-21: `node scripts/generate-agents-overview.js --check` reports no staleness.
- AC-22: `node scripts/build-personas.js` completes without errors after all changes.
- AC-23: All 114 generated persona files (38 × 3 targets) contain an AX Feedback block, as do the 15
  regenerated proof-of-concept files.

---

## Testing Strategy

This is a persona-source-only change with no runtime code. Verification is mechanical, not
spot-check-based: 114 generated files cannot be sampled reliably.

1. **Step 0 gate:** Before any rollout edit, rebuild and verify the 15 proof-of-concept generated
   files against AC-01 through AC-06.
2. **Per-file invariant audit:** For each of the 38 source templates, assert the three counts match:
   `count("{{> ax-feedback}}") == count("**AX Feedback:**" steps) == count(handoff blocks)`. For the
   3 shared-`## Handoff` personas the step count is 0 and the inclusion count is 1. For
   `plan-refiner` and `ledger-doctor` the handoff-block count is 2 while the inclusion count is 1 —
   list these as explicit expected exceptions rather than letting the audit fail open.
3. **Structural regression check:** Scan every generated file for an `##` heading occurring between
   the `## Workflow` heading and the handoff block. Zero matches expected (AC-02).
4. **Template fidelity check:** Diff the rendered fenced block against the partial source (AC-03).
5. **Ordinal continuity check:** For each modified numbered workflow list, verify the ordinals form an
   unbroken ascending sequence (AC-11).
6. **Build validation:** `node scripts/build-personas.js` must complete without errors across all
   suites and targets.
7. **Overview staleness:** `node scripts/generate-agents-overview.js --check` must report clean.

---

## Test Plan

- `node scripts/build-personas.js` after Step 0 only — inspect the 15 proof-of-concept generated files for correct nesting and template fidelity — AC-01, AC-02, AC-03
- Read `personas/shared/partials/ax-feedback.md` — confirm todo-list sink instruction, retained zero-friction sentence, and sub-agent propagation rule — AC-04, AC-05, AC-06
- Grep the partial for `TodoWrite`, `TodoRead`, `write_todos`, and `` `todo` `` — zero matches; the instruction is target-neutral prose — AC-04a
- Count persona metadata files whose `tools:` list contains `todo` — 43 of 43 — AC-04b
- Read the 4 `cc_tools:`-override metadata files (`ctx-architect`, `git-committer`,
  `module-intent-architect`, `ledger-claude-coordinator`) — each override contains `TodoRead` and
  `TodoWrite` — AC-04c
- Resolve each persona's effective Claude Code tool list as the build system actually computes it —
  own `cc_tools:` if present, else `tools:` directly, never a suite `default_cc_tools` — and assert
  `TodoWrite` present — 43 of 43, no exclusions — AC-04d
- Grep `personas/standalone/src/meta/module-intent-architect.yaml` for `cc_tools differs from default` — zero matches — AC-04f
- Count persona metadata files whose `tools:` list contains `edit` — still 39 of 43; the same 4 personas lack it — AC-04e
- Inspect a generated Claude Code ledger persona with no `cc_tools:` override (e.g.
  `personas/ledger/claude-code/3-developer.md`) — frontmatter `tools:` includes the Todo entries,
  rendered from `tools:` rather than a separate `default_cc_tools`-derived list — AC-04d
- Per-file count audit across all 38 source templates (inclusions vs. steps vs. handoffs, with the documented exceptions) — AC-07, AC-08, AC-09, AC-10
- Ordinal continuity scan of every modified numbered workflow list — AC-11
- Grep all persona metadata for `^version:` and `^last_updated:` — zero matches — AC-14
- Diff each metadata file's first changelog entry against the Step 4 bump table — AC-12, AC-13
- Grep `personas/` for `incident-logging` — zero matches; confirm the partial file is deleted, including its former reference in `developer-strict-constraints.md` — AC-15
- Grep the 5 ledger content templates for `has_incident_logging` — zero matches; grep their metadata files for the same flag — zero matches — AC-15a
- Read the 6 folded personas' handoff/Decision Logic sections for a blocked-by-environment terminal state — AC-16
- Read the AX Feedback partial for workaround reporting and the investigation scope limiter — AC-17
- Read `persona-design-guide.md` tables, checklist, and version header — AC-18
- Read `persona-curator.md`'s Quality Checklist — AC-19
- Read `personas/changelog.md` topmost entry — AC-20
- `node scripts/generate-agents-overview.js --check` — clean — AC-21
- `node scripts/build-personas.js` — full build across all suites/targets succeeds without errors — AC-22
- Grep all 114 generated persona files for the AX Feedback block — present in every one — AC-23
- Structural regression scan: no `##` heading between `## Workflow` and the handoff block in any generated file — AC-02

---

## Documentation Updates

- `personas/changelog.md` — new version entry for the partial fix, rollout, fold, and guide update
  (Step 7 of this plan).
- `personas/docs/persona-design-guide.md` — AX Feedback registered as a required section; Pattern 6
  extended with AX Feedback as a worked example; bumped to v2.6 (Step 6a).
- `personas/standalone/src/content/persona-curator.md` — Quality Checklist item added (Step 6b).
- `docs/agents-overview.md` — regenerated after the 38 version bumps (Step 8).
- **Personas manifest:** `personas/docs/agents/project-manifest/api-surface.md` documents the shared
  partial inventory. Step 5d deletes `incident-logging.md`; update the partial list accordingly.
  Verify whether `data-flows.md` or `constraints.md` reference the partial before deleting.
- **Pre-existing documentation bug, independent of this plan's changes:**
  `personas/docs/agents/project-manifest/api-surface.md`, `data-flows.md`, `constraints.md`, and
  `variables.md` currently describe `default_cc_tools` as a live fallback in the
  `cc_tools → default_cc_tools → tools` chain — this mechanism does not exist in
  `@mistralys/persona-builder` (see Architectural Context / Step 0a). It was real until the 2026-03-26
  migration to the `@mistralys/persona-builder` library (commit `65b78cb5`), which dropped the
  `persona.cc_tools || sharedMeta.default_cc_tools || []` fallback from `scripts/build-personas.js`
  without the replacement library ever implementing an equivalent — the four manifest documents were
  never updated to match. Since this plan's own research corrected the same false premise, fix all
  four documents' `default_cc_tools` rows to state the real chain (`cc_tools:` → `tools:` directly)
  while other Documentation Updates in this plan are applied, so the fix isn't deferred to a future,
  unrelated change. `constraints.md` L84 and `variables.md` L85–93 currently repeat the same false
  claim as `api-surface.md`/`data-flows.md` and must be corrected identically.
- `.context/` regeneration: required since the previous two items modify files under
  `personas/docs/agents/project-manifest/` (`api-surface.md`, `data-flows.md`, `constraints.md`,
  `variables.md`) and `personas/shared/partials/`, all of which `.context/personas/manifest.md` and
  `.context/personas/shared-partials.md` mirror. Run `node scripts/cli.js ctx-generate`.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Rolling out before fixing the partial** — the single highest-cost failure mode; every defect is multiplied by 48 and cleanup requires re-touching all 38 files | Step 0 is declared blocking, with an explicit verification gate against the 5 proof-of-concept personas before Steps 1–3 begin. |
| **D2's fenced-block mangling turns out to originate in the build system** | Step 0 investigates before editing; if the partial-side workaround is impossible, the build-system fix is absorbed into Step 0 and the scope grows there rather than leaking into the rollout steps. |
| **Step numbering errors across the 48 insertions** | Mechanical per-file count audit (inclusions vs. steps vs. handoffs) plus an ordinal continuity scan, not spot-checks. |
| **Missing a multi-mode handoff point** | The research brief enumerates every handoff location with line numbers; the per-file count audit fails if a mode is missed. |
| **Double-inserting in the two-STATUS-variant personas** (`plan-refiner`, `ledger-doctor`) | Both are called out explicitly in Steps 2 and 3 and recorded as expected exceptions in the count audit (1 inclusion vs. 2 handoff blocks). |
| **The `incident-logging` fold silently drops blocking-incident reporting** | Step 5b verifies a blocked-by-environment terminal state exists in each of the 6 personas before the constraint is removed, and adds one where it does not. |
| **Deleting `incident-logging.md` breaks an unnoticed consumer** | Step 5d greps all of `personas/` before deletion; Documentation Updates additionally checks the personas manifest for references. |
| **The sink instruction pushes personas toward writing scratch files they lack permission to create** | The sink is the todo list, which has no filesystem footprint and conflicts with no read-only guardrail. Step 0a grants todo tools across targets; no persona gains `edit`. |
| **Granting todo to a persona that deliberately avoids task tracking** | Step 0a reads each persona's constraint sections before granting. Both apparent exclusions were investigated and found incidental, so no persona is excluded — but the investigation is recorded so the reasoning can be re-checked. |
| **Mistaking a stale YAML comment for a design decision** — `module-intent-architect`'s comment restates a diff without giving a reason, and Git history shows it was orphaned when `todo` was added to `tools:` in April | Step 0a-2 records the two commits behind the divergence, adds the Todo tools, and deletes the comment so it cannot mislead again. |
| **Mistaking a namespace-scoped constraint for a global one** — `ledger-claude-coordinator`'s "read-only tool allowlist" governs only `ledger_*` tools, but reads at a glance like a restriction on its whole toolset | Step 0a-2 quotes the constraint's actual wording and notes that the persona already holds `execute` and `edit` despite constraints forbidding their use. General rule recorded in the step: an exclusion requires a rationale in the persona content that covers the specific tool in question. |
| **Fixing only the VS Code `tools:` field and missing the 4 personas whose `cc_tools:` override doesn't benefit from the `cc_tools:` → `tools:` fallback** — the two targets use different field names *and* different tool names | Step 0a is split into two sub-steps covering `tools:` (11 files) and the 4 per-persona `cc_tools:` overrides. AC-04d resolves each persona's *effective* Claude Code list (own `cc_tools:` else `tools:` directly) rather than assuming a `default_cc_tools` mechanism that does not exist in the build system. |
| **Hard-coding a target-specific tool name into the shared partial**, producing an instruction that names a nonexistent tool on two of three targets — the tool is `todo`, `TodoWrite`, and `write_todos` on VS Code, Claude Code, and Deep Agents respectively | The sink sentence uses target-neutral prose ("your todo list"); AC-04a greps the partial for `TodoWrite`/`TodoRead`/`write_todos`/`todo` and requires zero matches. |
| **Sub-agent AX Feedback blocks nest and duplicate through `runSubagent` chains** in the 10 dispatching personas | Step 0 adds an explicit propagation rule to the partial. |
| **Stale `docs/agents-overview.md` after 38 version bumps** | Step 8 regenerates it and AC-21 gates on `--check` reporting clean. |
| **Version inflation across the whole persona suite** | Patch bumps for the 37 inclusion-only personas; minor reserved for the 6 that lose a constraint. |
| **The Design Guide update is deferred and forgotten**, leaving newly authored personas non-compliant from day one | Step 6 is part of this plan, not a follow-up, and is gated by AC-18 and AC-19. |

---

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Still a single-concern, source-only change confined to `personas/` — no new
  architecture, no cross-module changes, no runtime code. The expanded scope adds a blocking partial
  fix, a constraint fold, and documentation registration, but all are the same class of work on the
  same module, and verification remains a build plus mechanical file audits. The sequencing
  constraint (Step 0 before all else) is the one thing the implementer must not reorder.
