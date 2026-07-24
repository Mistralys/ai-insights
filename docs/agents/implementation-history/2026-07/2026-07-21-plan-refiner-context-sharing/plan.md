# Research Report — Refiner-as-Enricher: Implementation Specification

## Problem Statement

The Plan Refiner workflow dispatches 5–9+ sub-agent invocations per refinement run (Planner, Plan Architect Reviewer, Plan Auditor). Each sub-agent independently performs extensive, overlapping codebase research — reading AGENTS.md, project manifests, source files, and verifying patterns. This redundant research dominates the token budget.

The parent research paper ([2026-07-21-plan-refiner-context-sharing.md](2026-07-21-plan-refiner-context-sharing.md)) evaluated five patterns and five creative approaches. **Approach E (Refiner-as-Enricher)** was selected as the primary strategy, combined with elements of Pattern 1 (Brief Promotion), Pattern 3 (Facts/Judgment Split), and Pattern 4 (Incremental Re-Audit).

This document is a **Persona Curator implementation specification**: it defines the exact persona changes required to implement Approach E across three phases.

## Context

### Current State

The Planner produces a `research-brief.md` during planning (Workflow steps 3–4). This file contains verified codebase references, patterns, and constraints organized by scope area. Currently:

- The research brief is **only consumed by the Planner itself** during plan assembly (step 6).
- The Plan Refiner **does not reference** the research brief in any sub-agent prompt.
- Sub-agents (Architect Reviewer, Auditor) **independently re-discover** the same codebase facts the Planner already verified.
- The Plan Refiner reads the plan during triage (Phase 0) but does **no codebase research** — its context capacity is largely unused.

### Research Brief Template (Current)

The Planner's research brief uses this structure:

```markdown
# Research Brief

## Scope Sketch
- {Area name} — `{directory or module path}` — {type of change}

## Area: {Area Name}

### Verified References
- `{file path}` (L{start}–L{end}): {What was found}

### Patterns & Conventions
- {Pattern observed} — `{file path where it is established}`

### Constraints
- {Constraint discovered during research}
```

### Sub-Agent Dispatch (Current)

The Plan Refiner currently passes **only file paths** to sub-agents — no research context is inlined or referenced:

| Phase | Sub-Agent | Current Prompt |
|-------|-----------|----------------|
| Design Review | Architect Reviewer | `"Please start with the following plan: {PATH_TO_PLAN}. {concerns}"` |
| Design Integration | Planner | `"Please integrate all useful findings from the architect reviewer into the plan.\n\nPlan document: {PATH}\nReview document: {PATH}"` |
| Audit | Auditor | The current plan document path |
| Audit Rework | Planner | `"Please add all recommendations from the audit to the plan.\n\nPlan document: {PATH}\nAudit document: {PATH}"` |

### Affected Personas

| Persona | File | Changes Required |
|---------|------|-----------------|
| **Plan Refiner** | `personas/standalone/src/content/plan-refiner.md` | Major — new enrichment phase, modified dispatch prompts, incremental audit support |
| **Plan Refiner (meta)** | `personas/standalone/src/meta/plan-refiner.yaml` | Version bump + changelog entry |
| **Planner (Standalone)** | `personas/standalone/src/content/planner.md` | Minor — restructure Research Brief Template to separate facts from interpretations |
| **Planner (meta)** | `personas/standalone/src/meta/planner.yaml` | Version bump + changelog entry |
| **Plan Auditor** | `personas/standalone/src/content/plan-auditor.md` | None — receives context via prompt, not persona change |
| **Plan Architect Reviewer** | `personas/standalone/src/content/plan-architect-reviewer.md` | None — receives context via prompt, not persona change |

> The Auditor and Architect Reviewer personas do **not** change. They receive enriched context through the Plan Refiner's modified dispatch prompts. This preserves their independence — they are not told *how* to use the brief, only that it exists.

---

## Implementation — Phase 1: Refiner-Enriched Brief Promotion

Phase 1 is the core change. It adds three capabilities to the Plan Refiner: (a) a dedicated enrichment phase, (b) modified sub-agent dispatch prompts that reference the enriched brief, and (c) a scope sketch in the prompt for orientation.

### Change 1: Restructure the Research Brief Template (Planner persona)

**File:** `personas/standalone/src/content/planner.md`
**Section:** `## Research Brief Template`

The current template intermixes factual references with interpretive observations. Restructure it to make the boundary explicit. The `### Verified References` and `### Constraints` subsections are **facts** (safe to share). The `### Patterns & Conventions` subsection straddles the line — some entries are factual ("uses repository pattern — `file.ts`") and some are interpretive ("this pattern is well-suited for...").

**New Research Brief Template:**

```markdown
# Research Brief

## Scope Sketch
{Bullet list of codebase areas the request touches — produced in
Workflow step 3}

- {Area name} — `{directory or module path}` — {type of change:
  new code | modification | integration}

## Area: {Area Name}

### Verified References
- `{file path}` (L{start}–L{end}): {What was found — current shape,
  relevant types, existing patterns}

### Established Patterns
- {Pattern observed} — `{file path where it is established}`

### Constraints
- {Constraint discovered during research}

{Repeat "## Area:" for each area in the Scope Sketch}
```

The change is minimal: rename `### Patterns & Conventions` to `### Established Patterns` to signal that entries should be **observed facts** ("this codebase uses X pattern, as established in `file.ts`") rather than interpretive judgments ("X pattern is well-suited for this use case"). The Planner's existing instructions about the research brief being "verified codebase facts" already encourage this — the rename reinforces the intent.

### Change 2: Add Enrichment Phase to Plan Refiner

**File:** `personas/standalone/src/content/plan-refiner.md`

Add a new workflow step between the current triage (step 2) and design review dispatch (step 3). This step is a **dedicated, structurally isolated enrichment phase** — the Refiner's sole focus during this step is codebase research to supplement the brief.

#### New Workflow Step (insert between current steps 2 and 3)

Add the following as a new step in the `## Workflow` section, after the triage step and before the design review step. All subsequent step numbers shift by one.

**New step — "Enrich Research Brief":**

> **3. Enrich Research Brief:** If a research brief exists alongside the plan (`research-brief.md` in the same directory), read it and assess whether enrichment is needed. Compare the plan's affected areas against the brief's existing coverage:
>
> - **Brief already covers most areas** → Enrich only the gaps (2–3 tool calls).
> - **Brief is thin or missing key areas** → Substantial enrichment (up to 10 tool calls).
> - **Brief is comprehensive and the plan is narrow** → Skip enrichment entirely.
> - **No research brief exists** → Skip this step. Do not create a brief from scratch — that is the Planner's responsibility.
>
> When enrichment is warranted, target research based on which sub-agents you will dispatch:
>
> - **For Architect Reviewer dispatch:** Scan the plan's affected module boundaries for interface definitions, type hierarchies, cross-module dependencies, and architectural patterns not already in the brief. Tag additions with `[arch]`.
> - **For Auditor dispatch:** Scan for method signatures at referenced line ranges, test patterns in affected areas, error-handling conventions, and constraint documentation. Tag additions with `[verify]`.
> - **For both:** Include both `[arch]` and `[verify]` tagged additions as appropriate.
>
> Append findings to the appropriate `## Area` section in the research brief using the existing format. If an area is not yet represented, add a new `## Area` section. Mark all additions with a provenance marker: `[added by: Refiner]`.
>
> **Skip Design Review scenario:** When the `Skip Design Review` flag is set (Plan Refiner re-entry after a previous cycle), the Architect Reviewer is not invoked. In this case, the Refiner still enriches the brief — but targets only `[verify]`-tagged references for the Auditor. This maintains most of Phase 1's benefit even when the design review phase is bypassed.
>
> **Ceiling:** ≤10 tool calls on enrichment. Do not re-research areas already covered in the brief.
>
> **Example enrichment entry:**
> ```
> - `mcp-server/src/tools/knowledge.ts` (L12–L45): `addInsight()` method —
>   accepts InsightInput, validates scope enum, writes to JSON store [added by: Refiner] [verify]
> ```

This step must also be reflected in the `## Operational Protocol — Refinement Cycle` section as a new phase between Phase 0 (Triage) and Phase 1 (Design Review). Add it as **Phase 0.5: Brief Enrichment** or renumber to make it **Phase 1** (shifting current Phase 1–3 to Phase 2–4).

#### Corresponding additions to Operating Philosophy

Add the following bullet to the `## Operating Philosophy` section:

> - **Enrich, Don't Author:** The research brief is the Planner's artifact. Supplement it with targeted codebase facts that sub-agents would otherwise discover independently, but never rewrite it, restructure it, or add interpretive content. The Refiner is a neutral fact-gatherer, not a co-author.

#### Corresponding addition to Strict Constraints

Add the following bullet to the `## Strict Constraints` section:

> - **Facts only in enrichment.** When enriching the research brief, add only verified factual references — file paths, type signatures, method signatures, test patterns, code structure observations. Never add interpretations, assessments, design opinions, or findings. "This method has no error handling" is an interpretation that belongs in `audit.md`; "`file.ts` (L45–L60): `processItem()` method, no try/catch block" is a factual observation suitable for the brief.

### Change 3: Modify Sub-Agent Dispatch Prompts

**File:** `personas/standalone/src/content/plan-refiner.md`

Modify the dispatch prompts in the `## Workflow` section to reference the enriched research brief. The changes affect four dispatch points.

#### Design Review dispatch (currently step 3, becomes step 4)

**Current prompt:**
```
Please start with the following plan: {PATH_TO_PLAN}. {concerns}
```

**New prompt:**
```
Please start with the following plan: {PATH_TO_PLAN}. {concerns}

A research brief with verified codebase references is available at
{PATH_TO_RESEARCH_BRIEF}. Sections tagged [arch] are particularly
relevant to your analysis. The brief may save you time on initial
codebase orientation, but you must independently verify any reference
you find suspicious and search beyond the briefing for design concerns
the Planner may have missed.
```

> Only append the research brief paragraph if the research brief file exists. If it does not exist (e.g., the user wrote the plan manually without using the Planner), omit the paragraph entirely.

#### Design Integration dispatch (currently step 4, becomes step 5)

**Current prompt:**
```
Please integrate all useful findings from the architect reviewer into
the plan.

Plan document: {PATH_TO_PLAN}
Review document: {PATH_TO_REVIEW}
```

**New prompt:**
```
Please integrate all useful findings from the architect reviewer into
the plan.

Plan document: {PATH_TO_PLAN}
Review document: {PATH_TO_REVIEW}
Research brief: {PATH_TO_RESEARCH_BRIEF}
```

> The Planner authored the research brief, so anchoring risk is zero — this is the highest-ROI, lowest-risk change. The Planner can use its own brief to quickly re-orient on the codebase facts it already verified, rather than re-reading source files.

#### Audit dispatch (currently step 5, becomes step 6)

**Current prompt:** The current plan document path only.

**New prompt:**
```
{PATH_TO_PLAN}

A research brief with verified codebase references is available at
{PATH_TO_RESEARCH_BRIEF}. Sections tagged [verify] are particularly
relevant to your analysis. The brief may save you time on initial
codebase orientation, but you must independently verify any reference
you find suspicious and search beyond the briefing for issues the
Planner may have missed.
```

> Only append the research brief paragraph if the research brief file exists.

#### Audit Rework dispatch (currently step 5 sub-step, becomes step 6 sub-step)

**Current prompt:**
```
Please add all recommendations from the audit to the plan.

Plan document: {PATH_TO_PLAN}
Audit document: {PATH_TO_AUDIT}
```

**New prompt:**
```
Please add all recommendations from the audit to the plan.

Plan document: {PATH_TO_PLAN}
Audit document: {PATH_TO_AUDIT}
Research brief: {PATH_TO_RESEARCH_BRIEF}
```

> Same rationale as the Design Integration change — the Planner authored the brief, so re-providing it for rework orientation is pure upside.

### Change 4: Add Scope Sketch to Sub-Agent Prompts

For the Architect Reviewer and Auditor dispatch prompts (but **not** the Planner integration prompts), append a scope sketch extracted from the research brief's `## Scope Sketch` section. This tells sub-agents which areas of the codebase are affected without constraining their exploration:

```
Affected areas (for orientation, not a constraint — explore beyond
these if you discover relevant concerns):
- {scope sketch bullets from research brief}
```

> Only include if the research brief exists and has a populated Scope Sketch section.

> **Per-agent brief views (future optimization):** The `[arch]` and `[verify]` audience tags enable a future refinement: instead of pointing agents to the entire research brief, the Refiner could extract only the relevant-tagged sections into a per-agent view. This would reduce prompt length further and focus attention. For Phase 1, pointing agents to the whole brief with a tag hint is sufficient — the tags provide soft filtering without the implementation cost of generating separate views.

### Prompt Placement Guideline

Add the following note to the Plan Refiner persona, in the dispatch instructions or as a constraint:

> **Prompt structure for sub-agent dispatch:** Place the research brief reference early in the prompt (system-level orientation). Place the independence instruction ("search beyond the briefing") and scope sketch at the **end** of the prompt. Research on transformer attention patterns shows models attend most strongly to information at the beginning and end of long inputs — the independence clause benefits from end-of-prompt placement.

### Fallback: `.context/` Files as Neutral-Authorship Alternative

If the research brief proves too anchoring in practice (independent discovery rate drops below the ≥30% target), a lightweight fallback exists: point sub-agents to the relevant `.context/{module}/` files instead of (or in addition to) the research brief. These auto-generated CTX snapshots provide neutral-authorship codebase orientation — they were not written by the Planner and carry no plan-specific framing. This is a hybrid between Pattern 1 (brief promotion) and Pattern 2 (pre-computed snapshot): neutral authorship, zero implementation cost, but less targeted than a plan-specific research brief. No persona changes are needed — the Refiner simply substitutes the `.context/` path for the research brief path in dispatch prompts.

---

## Implementation — Phase 2: Incremental Re-Audit

Phase 2 modifies the audit loop for cycles 2+ to provide differential context. This reduces re-verification of unchanged plan sections.

### Change 5: Add Diff Context to Audit Cycles 2+

**File:** `personas/standalone/src/content/plan-refiner.md`
**Section:** `## Workflow`, step 6 (renumbered from step 5) — the audit loop

For the **first** audit cycle, the dispatch prompt is as defined in Change 3 above.

For **audit cycles 2 and beyond**, the Plan Refiner modifies the Auditor's dispatch prompt to include a brief summary of what changed:

**Cycle 2+ audit prompt:**
```
{PATH_TO_PLAN}

This is audit cycle {N}. The previous audit identified {count}
findings ({summary: e.g., "3 Major, 2 Minor"}). The plan has been
revised to address them — the following sections were modified:
{list of changed section headers or bullet summary of changes}.

Verify that these revisions address the flagged issues and check
whether they introduced new problems. You should also spot-check
other sections, but prioritize the changed areas.

A research brief with verified codebase references is available at
{PATH_TO_RESEARCH_BRIEF}. Sections tagged [verify] are particularly
relevant to your analysis. You must independently verify any reference
you find suspicious and search beyond the briefing for issues the
Planner may have missed.
```

**How the Refiner determines "what changed":** The Refiner already reads both the audit findings and the revised plan. After the Planner integrates audit findings (step 6 sub-step), the Refiner should note which plan sections the Planner reported modifying, or compare section headers before and after integration. A lightweight approach: track which `## Section` headers existed before rework and which are new/modified.

### Corresponding addition to Operating Philosophy

> - **Differential, Not Diminished:** On audit cycles 2+, guide the Auditor toward changed sections — but never tell it to *skip* unchanged sections. The instruction is "prioritize," not "restrict." Spot-checking unchanged areas is essential because the first audit may have missed issues too.

---

## Implementation — Phase 3: Sub-Agent Brief Enrichment (Safety Net)

Phase 3 allows sub-agents to contribute their codebase discoveries back to the research brief. This is a **safety net** — the Refiner's enrichment (Phase 1) handles the primary case. Phase 3 captures references the Refiner missed, particularly in multi-cycle runs where discoveries compound.

### Change 6: Add Enrichment Output Instructions to Sub-Agent Prompts

**File:** `personas/standalone/src/content/plan-refiner.md`
**Section:** `## Workflow`, sub-agent dispatch prompts

Append the following to the Architect Reviewer and Auditor dispatch prompts (all cycles):

```
If you discover verified codebase references not present in the
research brief — new file paths, type signatures, constraints, or
relevant code sections — append them to the appropriate Area section
in {PATH_TO_RESEARCH_BRIEF}. Add only factual references, not
interpretations or findings. Use the existing format and prefix each
addition with [added by: {your role}, unverified].
```

> **Important:** This instruction is **only appended when the research brief exists**. If there is no research brief, sub-agents have nothing to enrich.

### Change 7: Add Size Guard to Plan Refiner

**File:** `personas/standalone/src/content/plan-refiner.md`
**Section:** `## Workflow` or `## Strict Constraints`

Add a size guard that prevents unbounded brief growth:

> **Brief size guard:** Before each sub-agent dispatch, check the research brief's size. If it exceeds approximately 5,000 tokens (~3,500 words or ~200 reference entries), stop instructing sub-agents to append to it — treat the brief as read-only for remaining cycles. This prevents unbounded growth in long-running refinement loops and guards against attention degradation from oversized context.
>
> **Attention degradation vs. anchoring — distinct risks:** The 5K size guard addresses *attention degradation* — a mechanical limitation of transformer architectures where models attend more weakly to information positioned in the middle of long inputs (Liu et al., 2023). This is distinct from *cognitive anchoring*, where agents over-rely on provided context and reduce independent exploration. Both risks increase with brief size, but they require different mitigations: attention degradation is addressed by keeping the brief concise and placing key instructions at prompt boundaries; anchoring is addressed by the autonomy clause and measured via the independent discovery rate. The POC should track both metrics independently.

### Change 8: Provenance Markers

The enrichment system uses three trust levels, distinguished by provenance markers:

| Marker | Trust Level | Author |
|--------|-------------|--------|
| *(no marker)* | Highest — Planner-verified | Planner (original author) |
| `[added by: Refiner]` | High — neutral party, verified against codebase | Plan Refiner |
| `[added by: {Role}, unverified]` | Standard — downstream discovery, not independently verified | Architect Reviewer or Auditor |

Sub-agents can calibrate their verification effort based on these markers: unmarked and Refiner-added entries can be trusted unless suspicious; `unverified` entries should be spot-checked before relying on them.

---

## Implementation Summary

### Phased Rollout

| Phase | Changes | Risk | Effort |
|-------|---------|------|--------|
| **Phase 1** | Changes 1–4: Research brief restructure, Refiner enrichment phase, modified dispatch prompts, scope sketch | Low | Medium — Refiner persona rewrite, Planner template tweak |
| **Phase 2** | Change 5: Incremental re-audit prompts for cycles 2+ | Low | Low — prompt template addition in Refiner |
| **Phase 3** | Changes 6–8: Sub-agent enrichment output instructions, size guard, provenance markers | Low-Medium | Low — prompt additions in Refiner |

**Recommendation:** Implement Phase 1 first and validate with 2–3 real refinement runs before adding Phases 2 and 3. Phase 1 delivers the majority of the token savings (~35–40%) with the lowest risk. Phases 2 and 3 are incremental improvements that primarily benefit multi-cycle runs.

### Validation Criteria

After implementation, validate with real refinement runs:

1. **Token usage:** Compare total tokens (including Refiner enrichment cost) against a baseline run without enrichment. Target: ≥30% reduction.
2. **Tool call distribution:** Expect Refiner tool calls to increase by 2–10; sub-agent tool calls to decrease by a larger amount.
3. **Finding quality:** Audit findings should be comparable in quantity and severity to baseline runs. No regression in finding types caught.
4. **Independent discovery rate:** Track the percentage of Auditor/Reviewer findings that reference codebase locations *not present* in the enriched research brief. Target: ≥30%. A significant drop indicates anchoring — the autonomy clause may need strengthening.
5. **Brief growth (Phase 3 only):** Monitor research brief size across cycles. The 5K token guard should prevent runaway growth.

### Estimated Impact

Token savings estimates from the parent research paper (relative to baseline without enrichment):

| Scenario | Current (est. tokens) | With Phase 1 (Refiner-enriched) | With Phase 1+2 | With Phase 1+2+3 |
|---|---|---|---|---|
| 1-cycle run (5 invocations) | 100% baseline | ~65% (35% savings) | ~65% (no re-audit) | ~63% (marginal) |
| 2-cycle run (7 invocations) | ~140% of baseline | ~88% (~37% savings) | ~75% (~46% savings) | ~72% (~49% savings) |
| 3-cycle run (9 invocations) | ~180% of baseline | ~115% (~36% savings) | ~95% (~47% savings) | ~90% (~50% savings) |

Phase 1 savings are higher than a passive brief promotion because the Refiner's targeted enrichment eliminates more sub-agent research tool calls — agents find the references they need already in the brief rather than discovering them independently. The Refiner's enrichment cost (~10 tool calls, ~2K additional tokens) is more than offset by the cumulative reduction across 2–3 downstream agents.

Phase 3 (sub-agent enrichment) shows diminishing returns because the Refiner already covers most of the high-value references. Its primary benefit is in long multi-cycle runs where agents discover edge-case references the Refiner didn't anticipate.

### What NOT to Change

- **Do not modify the Plan Auditor or Plan Architect Reviewer personas.** They receive enriched context through the Refiner's dispatch prompts, not through their own persona instructions. This preserves their independence.
- **Do not share `audit.md` or `design-review.md` content with subsequent Auditor/Reviewer invocations.** Fresh-eyes adversarial stance is their primary value.
- **Do not constrain sub-agents to only the scope areas.** The scope sketch is orientation, not a fence.
- **Do not let sub-agents append interpretations to the brief.** The enrichment instruction must be explicit: factual references only.
- **Do not create a research brief from scratch in the Refiner.** If the Planner did not produce one, the Refiner skips all enrichment-related steps. Brief authorship is the Planner's responsibility.

---

## Open Questions

The following questions from the parent research paper remain relevant to implementation and validation:

- **"Brief as crutch" behavioral degradation:** If the refiner is used routinely with the same persona prompts, models may learn to rely on the brief as a shortcut and reduce independent exploration even when the autonomy clause is present. This is a long-term behavioral risk distinct from one-shot anchoring — it manifests as a gradual decline in independent discovery rate over many runs. Mitigation: periodically run without the brief (or with a deliberately incomplete brief that omits one known area) as a calibration check to detect this degradation before it becomes entrenched.
- **Model sensitivity:** Different models may respond differently to the autonomy clause. Claude models tend to follow "verify independently" instructions well; other models may anchor more strongly to provided context. If the Plan Refiner workflow is used across model providers, testing the autonomy clause's effectiveness per model is advisable.
- **Orchestrator integration:** The current orchestrator runs the 9-stage ledger workflow, not the standalone Plan Refiner. If the Plan Refiner workflow is ever ported to the orchestrator, the enriched research brief would need to be represented in `WorkflowState` or as a file artifact passed between stage nodes. The orchestrator already logs per-stage token usage in JSONL entries (`stage_start`/`stage_complete`), which would enable A/B measurement of token savings.
- **Error propagation in enriched briefs:** When multiple agents contribute to the research brief (Phase 3), incorrect facts can propagate across the agent chain. The provenance markers (`[added by: ..., unverified]`) mitigate this, but the POC should track whether any enriched-brief entries are later contradicted by downstream agents' independent verification, to quantify the real-world error rate.
- **Brief scope completeness:** The research brief only covers areas the Planner identified. Should the Plan Refiner instruct sub-agents to explicitly flag "I found relevant areas not covered in the research brief" as part of their output? This would surface scope gaps without constraining exploration.

---

## References

- Parent research paper: [2026-07-21-plan-refiner-context-sharing.md](2026-07-21-plan-refiner-context-sharing.md)
- Plan Refiner persona: `personas/standalone/src/content/plan-refiner.md`
- Plan Refiner meta: `personas/standalone/src/meta/plan-refiner.yaml`
- Planner (Standalone) persona: `personas/standalone/src/content/planner.md`
- Planner (Standalone) meta: `personas/standalone/src/meta/planner.yaml`
- Plan Auditor persona: `personas/standalone/src/content/plan-auditor.md`
- Plan Architect Reviewer persona: `personas/standalone/src/content/plan-architect-reviewer.md`
- Research Brief template: Planner persona, `## Research Brief Template` section
- Liu et al. (2023), "Lost in the Middle: How Language Models Use Long Contexts" — attention placement guidance
