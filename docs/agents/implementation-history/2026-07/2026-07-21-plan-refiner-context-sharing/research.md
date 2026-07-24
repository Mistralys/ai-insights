# Research Report

## Problem Statement

The Plan Refiner workflow orchestrates three sub-agents (Planner, Plan Architect Reviewer, Plan Auditor) across 5–9+ agent invocations per refinement run. Each agent operates in full isolation — by design, to bring fresh eyes. However, all three agents independently perform extensive, overlapping codebase research (reading AGENTS.md, project manifests, source files, verifying patterns and conventions). This redundant research dominates the token budget. The question: can parts of this shared research be pre-computed and provided as context without compromising the fresh-perspective benefit of agent isolation?

## Problem Decomposition

1. **What research is truly shared** — Identify which codebase exploration work is identical across agents vs. which is agent-specific.
2. **What "fresh eyes" actually protects** — Determine which aspects of isolation produce the quality benefit, so we don't accidentally destroy it.
3. **What delivery mechanism** — How could shared context be injected: file artifact, prompt injection, tool pre-loading, or something else?
4. **How to handle staleness** — In a multi-cycle audit loop, the plan itself changes. How does shared context stay valid across iterations?
5. **What the cost/benefit envelope looks like** — Estimate the token savings vs. quality risk for each approach.
6. **What attention-quality risks the delivery mechanism introduces** — Adding shared context increases prompt length; transformer attention degradation ("lost in the middle") may reduce reasoning quality on the plan itself, even if net tokens decrease.

## Context & Constraints

- Agents are invoked as sub-agents via `runSubagent` (VS Code) or `Task` (Claude Code) — each gets a fresh context window with no memory of prior agents.
- The orchestrator enforces Stage Node Isolation (Constraint 7): no shared state beyond the `WorkflowState` execution cursor.
- The Planner already produces a `research-brief.md` containing verified file paths, type signatures, existing patterns, and constraints — but this artifact is currently only consumed by the Planner itself.
- The Plan Refiner agent (the orchestrator of the workflow) sees all intermediate artifacts (`design-review.md`, `audit.md`) but does not inject research context into sub-agent prompts.
- All three sub-agents have filesystem access and can read any file in the workspace independently.
- The shared evidence format (`{file_path, line_range, claim}`) is already standardized across Auditor and Architect Reviewer.

---

## Prior Art & Known Patterns

### Pattern 1: Shared Context Document (a.k.a. "Research Brief Promotion")

- **Description:** The Planner's existing `research-brief.md` is promoted to a shared artifact. The Plan Refiner's sub-agent prompts include a pointer to it: "Before beginning your analysis, read the research brief at `{path}`. It contains verified codebase references. You are not bound by its findings — verify independently any reference you deem suspicious."
- **Where used:** This is the standard pattern in retrieval-augmented agent architectures. Microsoft's AutoGen framework uses a "shared scratchpad" file that agents can read. The Planner already writes this file — it just needs to be referenced in downstream prompts.
- **Strengths:**
  - Zero new infrastructure — the artifact already exists.
  - Agents retain full autonomy to verify, challenge, or ignore the brief.
  - The brief is a stable snapshot of verified facts, not opinions or judgments — so it doesn't bias architectural or audit assessments.
  - Saves the most expensive operation: the initial manifest/AGENTS.md ingestion path (which is identical for all agents).
  - The Planner integration invocations (2–4 per run) are the safest, highest-ROI beneficiary — since the Planner *authored* the brief, anchoring risk is zero. These calls currently may re-research the codebase to understand findings they're integrating; pointing them back to their own research brief is pure upside.
- **Weaknesses:**
  - The brief is authored by the Planner, who is also the entity being reviewed. Agents may anchor on the Planner's framing of what's relevant, potentially missing areas the Planner overlooked.
  - Brief may become stale across audit cycles if the plan's scope shifts during rework.
  - Adds token cost from reading the brief — though this is largely academic: a typical research brief is ~2–4K tokens, while a full AGENTS.md + manifest ingestion path consumes 10–20K tokens per agent. The net saving ratio is roughly 5:1.
- **Fit:** High. This is the most conservative, lowest-risk approach and can be implemented as a prompt-only change in the Plan Refiner persona.

### Pattern 2: Pre-Computed Codebase Snapshot

- **Description:** Before dispatching any sub-agent, the Plan Refiner itself (or a dedicated "Context Builder" sub-agent) generates a comprehensive codebase snapshot covering the plan's scope areas: directory trees, key file contents, API surfaces, pattern documentation. This snapshot is saved as a file and referenced by all downstream agents.
- **Where used:** Google's agent frameworks use "context compilation" phases. The `.context/` CTX Generator in this workspace already produces comprehensive codebase snapshots — the mechanism exists.
- **Strengths:**
  - Neutral authorship — not written by the Planner, so no framing bias.
  - Can be richer than the research brief (include actual file contents, not just references).
  - Identical for all agents — no asymmetric information.
- **Weaknesses:**
  - Requires a new agent invocation or significant orchestrator work — adds upfront cost.
  - A comprehensive snapshot may be very large, potentially exceeding what's useful and adding unnecessary token load.
  - The CTX Generator is a CLI tool, not an agent tool — would need integration work.
  - Determining "what's in scope" requires understanding the plan, which requires reading the plan — chicken-and-egg.
- **Fit:** Medium. Higher implementation cost, but eliminates authorship bias. Worth considering if Pattern 1 proves insufficient.
- **Lightweight variant:** The existing `.context/{module}/` files (auto-generated by the CTX Generator, tracked in VCS) already provide neutral-authorship codebase snapshots for each module — no build work required. Pointing sub-agents to the relevant `.context/` file for their scope area is a hybrid between Pattern 1 and Pattern 2: neutral authorship, zero implementation cost, but less targeted than a plan-specific research brief. This is a viable fallback if the research brief proves too anchoring.

### Pattern 3: Layered Context — Separate Facts from Judgments

- **Description:** Split the shared context into two layers: (a) a **facts layer** — verified file paths, type signatures, directory structures, dependency versions — that is objective and safe to share; and (b) an **interpretation layer** — pattern assessments, architectural framing, design rationale — that stays private to each agent. Only the facts layer is shared.
- **Where used:** This mirrors the data/view separation in software architecture. In multi-agent research, Microsoft Research's "Society of Mind" paper (Park et al., 2023) demonstrates that sharing factual observations while keeping interpretations agent-private preserves diverse reasoning.
- **Strengths:**
  - Precisely targets the redundancy (factual verification) while protecting the value (independent interpretation).
  - The Planner's research brief is already structured this way — `Verified References` and `Constraints` are facts; `Patterns & Conventions` straddle the line.
  - Easy to implement by filtering the existing research brief template.
- **Weaknesses:**
  - The fact/interpretation boundary is not always crisp. "This codebase uses the repository pattern" is a fact, but it frames how agents think about alternatives.
  - Requires discipline in the brief template to maintain the separation.
- **Fit:** High. This is an evolution of Pattern 1 that makes the safety boundary explicit.

### Pattern 4: Auditor-Specific Optimization — Incremental Re-Audit

- **Description:** Instead of the Auditor re-verifying the entire plan from scratch on each cycle, the Plan Refiner passes the previous `audit.md` alongside the plan and instructs the Auditor: "The previous audit found these issues. The plan has been revised to address them. Focus your verification on: (a) whether the revisions actually fix the flagged issues, and (b) whether the revisions introduced new issues. You may spot-check previously-verified references but do not need to re-verify every claim."
- **Where used:** Standard practice in code review tools (GitHub's "changes since last review" feature). Differential auditing is well-established in security auditing (re-audit only changed scope).
- **Strengths:**
  - Directly addresses the most expensive part of the workflow: the Auditor re-verifying everything 1–3 times.
  - Naturally converges — each cycle verifies less as fewer things change.
  - Does not compromise fresh eyes on *new* issues — the Auditor still independently discovers problems in changed sections.
- **Weaknesses:**
  - Risks anchoring the Auditor to the previous audit's framing — it might miss issues in unchanged sections that the first audit also missed.
  - The Auditor's value partly comes from its adversarial completeness — "verify everything" is a feature, not a bug.
  - Implementing "what changed" detection requires either the Plan Refiner to diff the plan or the Auditor to read two plan versions.
- **Fit:** Medium-High. Significant savings on multi-cycle runs (the most expensive scenario), but requires careful wording to avoid audit quality regression.

### Pattern 5: Tool-Level Caching (Infrastructure Approach)

- **Description:** Rather than sharing research at the prompt level, cache the results of expensive tool calls (file reads, grep searches, symbol lookups) at the infrastructure level. When Agent B reads the same file Agent A already read, the cached result is returned without consuming tokens for the tool call roundtrip.
- **Where used:** LangChain's `InMemoryCache` and `SQLiteCache` for LLM calls. MCP server-side response caching. Browser caching.
- **Strengths:**
  - Completely transparent to agents — no prompt changes, no bias risk, no anchoring.
  - Perfectly preserves fresh-eyes semantics: the agent still decides *what* to read, it just gets the answer faster.
  - Technically possible in the MCP layer or the orchestrator's tool management.
- **Weaknesses:**
  - Reduces tool call roundtrip cost but does **not** reduce prompt tokens — the agent still processes the file content in its context window.
  - With VS Code sub-agents, each agent has its own tool connections — caching would need to happen at the IDE level or MCP server level, which is outside the persona system's control.
  - The primary cost is prompt tokens from processing file content, not tool call latency. This pattern addresses the wrong bottleneck.
- **Fit:** Low. Addresses latency but not the token cost, which is the actual problem.

---

## Alternative & Creative Approaches

### Approach A: "Briefing Packet" Model

- **Description:** Combine Patterns 1 and 3. The Plan Refiner assembles a structured "Briefing Packet" before each sub-agent invocation. The packet contains: (a) the facts layer from the research brief (verified references, file paths, type signatures), (b) the plan's scope areas and directory map, and (c) for audit cycles 2+, a diff summary of what changed since the last audit. The packet is saved as a file and referenced in the prompt with an explicit autonomy clause: "This briefing contains pre-verified codebase facts to save you time. You must independently verify any reference you find suspicious, and you must search beyond the briefing for issues the Planner may have missed."
- **Rationale:** Combines the savings of research sharing with the safety of explicit autonomy. The "search beyond the briefing" instruction directly counters anchoring risk. The diff summary for later cycles captures Pattern 4's efficiency without fully constraining the Auditor.
- **Risk:** The autonomy clause adds meta-instructions that consume prompt tokens and may be partially ignored by models under token pressure. The briefing packet itself must be kept concise to avoid becoming a net-negative on token cost.

### Approach A+ (Extension): Include `design-review.md` Facts Layer

- **Description:** Extend the Briefing Packet to include the facts layer from the Architect Reviewer's `design-review.md` — specifically its verified file references and architectural observations, but *not* its Confirm/Challenge/Reconsider verdicts. On audit cycles, the Auditor independently re-discovers architectural context the Reviewer already verified; sharing the factual subset eliminates this duplication.
- **Rationale:** A natural extension of Pattern 3's fact/judgment boundary. The Architect Reviewer's verified references are objective codebase facts ("file X exists, has structure Y"), while the verdicts are interpretive judgments ("this design choice should be Reconsidered"). Sharing the former without the latter preserves audit independence.
- **Risk:** The boundary between "architectural observation" and "architectural judgment" requires careful curation. The Plan Refiner would need to extract the facts layer rather than passing the full `design-review.md`.

### Approach B: "Scope-Scoped" Agent Prompts

- **Description:** Instead of sharing research, make each agent's research phase cheaper by providing the plan's scope sketch (the bullet list of affected areas from the research brief) in the prompt. Each agent then researches only those areas, rather than independently discovering what areas are relevant by reading the entire plan first and then exploring the codebase.
- **Rationale:** The most expensive part of each agent's research isn't reading specific files — it's figuring out *which* files to read. The scope sketch (which areas of the codebase are affected, which directories to look in) is objective metadata that doesn't bias interpretation.
- **Risk:** If the scope sketch misses an area (because the Planner didn't realize it was relevant), downstream agents won't look there either. This directly undermines the fresh-eyes benefit: one of the things fresh eyes catch is "you forgot about this entire subsystem."
- **Mitigating factor:** The scope sketch is not solely the Planner's opinion — the Planner persona (Workflow step 5) requires confirming the scope with the user before proceeding. This human validation materially reduces the anchoring concern, since missed areas would represent both the Planner *and* the user overlooking a subsystem.

### Approach C: "Research-on-Demand" via MCP Knowledge Store

- **Description:** Extend the existing `ledger_add_insight` / `ledger_search_insights` MCP tools to support intra-run scoped knowledge. The Planner's research phase stores verified facts as insights with a `scope: 'run'` tag. Downstream agents can query the knowledge store for relevant facts before (or instead of) doing filesystem reads. Facts are tagged with confidence and source, so agents can decide whether to trust or re-verify.
- **Rationale:** Leverages existing infrastructure (knowledge store, MCP tools). The query-based model preserves agent autonomy — they choose what to look up and whether to trust it.
- **Risk:** Significant implementation work. The knowledge store currently supports `global` and `repository` scopes — adding `run` scope requires schema and tooling changes. The query/retrieval overhead may not justify the savings for a 5-minute workflow.

### Approach E: Refiner-as-Enricher

- **Description:** Instead of sharing the Planner's research brief as-is (Pattern 1) or delegating enrichment to downstream agents (Approach D), the Plan Refiner itself enriches the research brief before dispatching sub-agents. The Refiner already reads both the plan and the research brief during its triage phase (to decide whether to skip design review). With that context loaded, it performs targeted codebase exploration — scanning the plan's affected areas for type signatures, interface definitions, cross-module dependencies, test patterns, and error-handling conventions not already in the brief — and appends what it finds. The enriched brief is then referenced in sub-agent prompts.
- **Rationale:** The Refiner is uniquely positioned for this role. It (a) already pays the token cost of reading the plan and research brief for triage, so enrichment is incremental cost on a sunk investment; (b) is not the Planner, so its additions carry neutral authorship — addressing Pattern 1's framing-bias weakness without the new-agent cost of Pattern 2; (c) knows *which* sub-agents it will dispatch (Reviewer, Auditor, or both), enabling agent-aware enrichment — interface/type definitions at module boundaries for the Reviewer, test patterns and error handling for the Auditor; and (d) has substantial unused context capacity, since its current triage work is lightweight.
- **Separation of concerns — enrichment as a dedicated workflow phase.** The Refiner's workflow naturally decomposes into discrete phases: read plan → triage → **enrich** → dispatch → integrate → loop. Making enrichment a structurally isolated phase — rather than something interleaved with triage or dispatch logic — ensures the Refiner can concentrate fully on codebase research during that step. Each phase has a single responsibility: triage decides *what to do*; enrichment gathers *what sub-agents will need*; dispatch sends them off. This separation makes the enrichment work more predictable, easier to bound, and easier to evaluate. It also yields a cleaner persona implementation — the enrichment instructions are a self-contained workflow step, not interleaved with control-flow logic.
- **Adaptive extent judgment.** The Refiner holds three pieces of context simultaneously: (a) the plan's affected areas, (b) the research brief's existing coverage, and (c) which sub-agents it will dispatch. This lets it *diff* the plan's needs against the brief's coverage and calibrate its enrichment effort accordingly:
  - Brief already covers 4 of 5 affected areas → enrich only the 5th, ~2–3 tool calls.
  - Brief is thin because the Planner skipped deep research → substantial enrichment, ~8–10 tool calls.
  - Brief is comprehensive and the plan is narrow → skip enrichment entirely, 0 tool calls.
  This makes the ≤10 tool call cap a *ceiling*, not a target. The Refiner adaptively decides how much work is needed rather than blindly spending a fixed budget. This directly neutralizes the "diminishing returns if the brief is thorough" risk — the Refiner simply recognizes thoroughness and moves on. No other approach has this adaptive quality: Pattern 1 is static (share what exists), Approach D is additive (always append), and Pattern 2 always builds a full snapshot regardless of what's already available.
- **Risk:**
  - **Scope creep:** Adding research duties to the Refiner changes its role from lightweight orchestrator to active context curator. The separation-of-concerns design mitigates this: enrichment is a bounded, structurally isolated phase, not an open-ended expansion of the Refiner's responsibilities. The adaptive extent judgment further constrains it — the Refiner only enriches what's actually missing, and a practical ceiling of ≤10 tool calls prevents runaway research.
  - **Increased upfront latency.** The Refiner spends more time before dispatching sub-agents. Net savings depend on whether enrichment actually prevents sub-agent research — the POC must measure the Refiner's added tool calls vs. the reduction in sub-agent tool calls.
  - **Single point of enrichment quality.** Unlike Approach D (where multiple agents contribute and errors are distributed), all enrichment comes from one agent. If the Refiner misidentifies a reference, all downstream agents inherit the error. However, the error surface is smaller than Approach D — one author is easier to calibrate than three.
- **Relationship to other approaches:** This largely supersedes Approach D (Collaborative Brief Enrichment) as the primary enrichment strategy. If the Refiner pre-enriches the brief, downstream agents' independent discoveries are less likely to be novel — Approach D becomes a safety net ("if the Refiner missed something") rather than a primary mechanism. This also subsumes the per-agent brief views concept from Phase 1 step 4: the Refiner can tag its additions with audience markers (`[arch]`, `[verify]`) since it knows which agents will consume them.

### Approach D: Collaborative Brief Enrichment

- **Description:** Instead of the research brief being a static, Planner-authored artifact, downstream agents contribute their own codebase discoveries back to it. When the Architect Reviewer or Auditor verifies a file path, discovers a relevant type signature, or identifies a constraint not in the brief, they append it to the appropriate `## Area` section (or add a new Area section). Over audit cycles, the brief becomes a progressively richer, multi-author artifact.
- **Rationale:** Directly addresses the "Planner-only authorship" weakness of Pattern 1. The Architect Reviewer often discovers architectural context (interface hierarchies, cross-module dependencies) that the Planner didn't investigate because it wasn't relevant to plan *construction* but is relevant to plan *evaluation*. The Auditor often verifies edge cases and error paths the Planner didn't explore. Capturing these discoveries means subsequent agents — particularly the Planner during rework integration — get richer context without repeating the research. In multi-cycle runs, this compounds: the cycle-2 Auditor benefits from both the Planner's original research *and* the cycle-1 Auditor's verified references.
- **Risk:**
  - **Unbounded growth:** Without discipline, the brief could grow large enough to become a net-negative on token cost. A size cap or "append only to existing Area sections" rule would mitigate this.
  - **Fact/judgment leakage:** Agents must be explicitly instructed to add only verified factual references — not interpretations or findings. An Auditor appending "this method has no error handling" is an interpretation; appending "`file.ts` (L45–L60): `processItem()` method, no try/catch" is a fact.
  - **Error propagation:** If an agent writes an *incorrect* fact to the brief (e.g., the Architect Reviewer misidentifies a type signature), downstream agents inherit the error. The brief becomes a vector for error propagation across the agent chain. Mitigation: treat enriched entries as "unverified additions" with a distinct marker (e.g., `[added by: Architect Reviewer, unverified]`) so downstream agents know to treat them with lower trust than the Planner's original verified references.
  - **Structural consistency:** Multiple agents appending to the same file may create formatting inconsistencies. The brief template's structured `## Area` / `### Verified References` format helps, but agents may not follow it perfectly.
  - **File write coordination:** In rare cases, if two sub-agents ran concurrently (not current architecture, but possible future), concurrent writes would conflict. Currently safe since the Plan Refiner dispatches sub-agents sequentially.

---

## Comparative Evaluation

| Criterion | Pattern 1: Brief Promotion | Pattern 3: Facts/Judgment Split | Pattern 4: Incremental Re-Audit | Approach A: Briefing Packet | Approach B: Scope-Scoped | Approach D: Brief Enrichment | Approach E: Refiner-as-Enricher |
|---|---|---|---|---|---|---|---|
| **Token savings** | Moderate (30-40%) | Moderate (30-40%) | High for cycles 2+ (50-60%) | High (40-60%) | Low-Moderate (15-25%) | High, compounding (45-65%) | High (45-60%) |
| **Fresh-eyes preservation** | Good — agents retain full autonomy | Very good — only facts shared | Moderate — anchors to prior audit | Good — explicit autonomy clause | Poor — constrains search scope | Good — only facts added | Very good — neutral author, facts only |
| **Implementation complexity** | Trivial — prompt-only change | Low — template restructuring | Low — prompt-only change | Low — combines existing patterns | Trivial — prompt-only change | Low — prompt + output instruction | Low — Refiner persona change only |
| **Risk of quality regression** | Low — agents can ignore brief | Very low — no judgments shared | Medium — may miss issues in unchanged code | Low — autonomy clause mitigates | Medium — missed scope areas | Low — additive facts only | Very low — neutral author + autonomy clause |
| **Staleness risk across cycles** | Low — brief is stable facts | Low — facts don't change often | N/A — differential by design | Low-Medium — needs diff updates | Low — scope rarely shifts | Very low — brief grows, not stales | Low — Refiner re-enriches each cycle |
| **Attention degradation risk** | Low — brief is 2–4K tokens | Low — same size as Pattern 1 | None — no added context | Medium — combined packet may be large | None — no added context | Medium-High — brief grows each cycle | Low-Medium — bounded by tool-call cap |
| **Error propagation risk** | Low — Planner-authored, self-verified | Low — same provenance | None — no shared facts | Low — same as Pattern 1 | None — no shared facts | Medium — multi-author, unverified additions | Low — single author, easier to calibrate |
| **Works in IDE (VS Code/CC)** | Yes — file reference in prompt | Yes — file reference in prompt | Yes — prompt instruction change | Yes — file + prompt | Yes — prompt-only | Yes — file read + append | Yes — file write + prompt reference |
| **Works in Orchestrator** | Yes — file path in state | Yes — file path in state | Yes — prompt template change | Yes — both mechanisms | Yes — prompt template change | Yes — file artifact in state | Yes — file artifact in state |

---

## Recommendation

**Pursue a layered combination of Patterns 1, 3, and 4, with Approach E (Refiner-as-Enricher) as the primary enrichment strategy — implemented in three phases.**

### Phase 1: Refiner-Enriched Brief Promotion (Immediate, Low Risk)

1. **Restructure the Planner's Research Brief template** to explicitly separate the facts layer (verified references, file paths, type signatures, directory structures, dependency versions) from the interpretive layer (pattern assessments, architectural framing). The current template is already close — the main change is making the separation intentional and labeled.

2. **Add a dedicated Refiner enrichment phase before sub-agent dispatch.** After triage and before dispatch, the Refiner enters a structurally isolated enrichment phase where its sole focus is codebase research. This separation of concerns ensures the Refiner concentrates fully on supplementing the brief without interleaving enrichment with control-flow logic.

   The Refiner first assesses the enrichment extent by diffing the plan's affected areas against the brief's existing coverage:
   - If the brief already covers most areas → minimal enrichment (2–3 tool calls for the gaps).
   - If the brief is thin → substantial enrichment (up to ~10 tool calls).
   - If the brief is comprehensive and the plan is narrow → skip enrichment entirely.

   When enrichment is warranted, the Refiner targets its research based on which sub-agents it will dispatch:
   - For Architect Reviewer dispatch: scan the plan's affected module boundaries for interface definitions, type hierarchies, cross-module dependencies, and architectural patterns not already in the brief. Tag additions with `[arch]`.
   - For Auditor dispatch: scan for method signatures at referenced line ranges, test patterns in affected areas, error-handling conventions, and constraint documentation. Tag additions with `[verify]`.
   - Ceiling: ≤10 tool calls on enrichment, focused on the plan's explicitly listed scope areas. Do not re-research areas already covered in the brief.
   - Append findings to the research brief's `## Area` sections using the existing format, with a provenance marker: `[added by: Refiner]`.

3. **Modify the Plan Refiner's sub-agent prompts** to reference the enriched research brief:
   - For Architect Reviewer: `"A research brief with verified codebase references is available at {PATH}. Sections tagged [arch] are particularly relevant to your analysis. The brief may save you time on initial codebase orientation, but you must independently verify any reference you find suspicious and search beyond the briefing for design concerns the Planner may have missed."`
   - For Auditor: Same structure, pointing to `[verify]`-tagged sections.

4. **Add a scope sketch summary** to the prompt (Approach B's lightweight variant): include the bullet list of affected areas from the research brief. This is strictly additive — agents can explore beyond these areas, but they don't have to independently discover the scope.

5. **Position the autonomy clause at the end of the prompt.** Research on transformer attention patterns (Liu et al., 2023 — "Lost in the Middle") shows models attend more strongly to information at the beginning and end of long inputs. The brief pointer itself is fine early in the prompt (system-level orientation), but the independence instruction ("search beyond the briefing") should be placed at the *end* of the sub-agent prompt — the highest-attention region — to maximize the probability that the model follows it.

### Phase 2: Incremental Re-Audit (After Validating Phase 1)

6. **For audit cycles 2+**, the Plan Refiner includes a brief diff summary in the Auditor's prompt: "The following sections were modified to address the previous audit's findings: {list of changed sections}. Verify that these revisions address the flagged issues and check whether they introduced new problems. You should also spot-check other sections, but prioritize the changed areas."

7. This is opt-in and conservative — the Auditor is told to "spot-check" unchanged areas, not ignore them entirely.

### Phase 3: Sub-Agent Brief Enrichment as Safety Net (After Validating Phases 1–2)

8. **Optionally instruct sub-agents to contribute discoveries back to the research brief.** Since the Refiner already pre-enriches the brief (Phase 1, step 2), sub-agent enrichment serves as a safety net for references the Refiner missed — not the primary enrichment mechanism. Add output instructions to the Architect Reviewer and Auditor prompts: `"If you discover verified codebase references not present in the research brief (new file paths, type signatures, constraints, or relevant code sections), append them to the appropriate Area section in {PATH}. Add only factual references — not interpretations or findings. If the area is not yet represented, add a new Area section following the existing format."`

9. **Add a size guard** to the Plan Refiner: if the research brief exceeds a threshold (e.g., 5K tokens), the Plan Refiner stops instructing agents to append and treats the brief as read-only for remaining cycles. This prevents unbounded growth in long-running refinement loops. The 5K threshold also serves as a guard against attention degradation — a brief beyond this size risks pushing the plan itself into the low-attention "middle" zone of the context window.

10. **Mark sub-agent enriched entries as unverified.** Instruct agents to prefix their additions with a provenance marker (e.g., `[added by: Architect Reviewer, unverified]`). This distinguishes Planner-verified and Refiner-verified references from downstream additions, allowing subsequent agents to calibrate their trust level. (The Refiner's own additions use `[added by: Refiner]` without the "unverified" qualifier, since the Refiner is a neutral party that verified against the codebase directly.)

11. This phase is most impactful in multi-cycle runs, where each agent's discoveries compound — the cycle-2 Auditor benefits from the Refiner's enrichment *and* the cycle-1 sub-agents' residual discoveries, without re-doing that research.

### Why This Combination

- **Approach E (Refiner-as-Enricher)** is the centerpiece. The Refiner already pays the token cost of reading the plan and research brief for triage — enrichment is incremental cost on a sunk investment. Its neutral authorship (not the Planner) eliminates framing bias. Its knowledge of which sub-agents it will dispatch enables targeted, agent-aware enrichment. And its lightweight current workload means it has ample context capacity. This subsumes Pattern 2's goal (neutral-authorship context building) without Pattern 2's cost (a dedicated agent invocation). Two structural properties make this approach especially robust: (a) separation of concerns — enrichment is a dedicated workflow phase (triage → enrich → dispatch), so the Refiner concentrates fully on codebase research without interleaving it with control-flow decisions; and (b) adaptive extent judgment — the Refiner can diff the plan's needs against the brief's existing coverage and calibrate effort from 0 tool calls (brief is already comprehensive) to ~10 (brief is thin), making it self-limiting rather than mechanically spending a fixed budget.
- **Pattern 1 (Brief Promotion)** remains the foundation: the Planner's research brief is the artifact being enriched and shared. The Planner integration calls (design integration, audit rework) are the safest, highest-ROI beneficiary — since the Planner authored the original brief, anchoring risk is zero, and these invocations currently re-research the codebase to understand findings they're integrating.
- **Pattern 3 (Facts/Judgment Split)** protects the fresh-eyes benefit by ensuring the shared content is objective facts, not the Planner's design opinions. An Architect Reviewer who knows "file X has method Y at line Z" is not biased — an Architect Reviewer who's told "the repository pattern is well-suited here" might be. The Refiner's enrichment follows this same discipline — facts only, tagged by audience.
- **Pattern 4 (Incremental Re-Audit)** targets the most expensive scenario: multi-cycle runs where the Auditor re-verifies everything 2–3 times. The savings compound across cycles.
- **Approach B (Scope Sketch)** is included as a lightweight addition, not a constraint — agents receive the scope as helpful orientation, not as a boundary.
- **Approach D (Sub-Agent Enrichment)** is demoted to a safety net. With the Refiner pre-enriching the brief, sub-agents are less likely to discover novel references — but when they do, capturing those discoveries still benefits subsequent cycles. Approach D's risks (unbounded growth, structural inconsistency, error propagation across multiple authors) are mitigated by making it optional and secondary.

### What NOT to do

- **Do not share the previous audit.md with the next audit iteration's Auditor.** The Auditor's fresh-eyes adversarial stance is its primary value. Showing it the previous audit anchors it to those findings and reduces the probability of catching previously-missed issues. The Plan Refiner can share a *summary of what changed* without sharing the audit's framing.
- **Do not constrain agents to only the scope areas.** The whole point of fresh eyes is catching what the Planner missed. The scope sketch is orientation, not a fence.
- **Do not invest in infrastructure-level caching (Pattern 5) or MCP knowledge store extensions (Approach C).** The token cost is in prompt processing, not tool latency. These approaches address the wrong problem.
- **Do not let agents append interpretations or findings to the brief.** The enrichment instruction must be explicit: only verified factual references (file paths, type signatures, code structure observations). An Auditor finding like "Step 3 references a non-existent method" belongs in `audit.md`, not in the research brief. The brief is a shared factual map of the codebase, not a findings log.
- **Do not place the brief at the prompt midpoint.** Transformer attention is weakest in the middle of long inputs (Liu et al., 2023). Place the brief reference early (system-level orientation) and the autonomy/independence clause at the end (highest attention). Never sandwich both in the middle of the sub-agent task instructions.

### Estimated Impact

| Scenario | Current (est. tokens) | With Phase 1 (Refiner-enriched) | With Phase 1+2 | With Phase 1+2+3 |
|---|---|---|---|---|
| 1-cycle run (5 invocations) | 100% baseline | ~65% (35% savings) | ~65% (no re-audit) | ~63% (marginal) |
| 2-cycle run (7 invocations) | ~140% of baseline | ~88% (~37% savings) | ~75% (~46% savings) | ~72% (~49% savings) |
| 3-cycle run (9 invocations) | ~180% of baseline | ~115% (~36% savings) | ~95% (~47% savings) | ~90% (~50% savings) |

*Token estimates are relative. Phase 1 savings are higher than the previous (passive brief promotion) estimate because the Refiner's targeted enrichment eliminates more sub-agent research tool calls — agents find the references they need already in the brief rather than discovering them independently. The Refiner's enrichment cost (~10 tool calls, ~2K additional tokens) is more than offset by the cumulative reduction across 2–3 downstream agents.*

*Phase 3 (sub-agent enrichment) shows diminishing returns because the Refiner already covers most of the high-value references. Its primary benefit is in long multi-cycle runs where agents discover edge-case references the Refiner didn't anticipate.*

*Note: When the `Skip Design Review` flag is set (Plan Refiner re-entry), the Architect Reviewer is not invoked — but the Refiner still enriches the brief with `[verify]`-tagged references for the Auditor, maintaining most of the Phase 1 benefit.*

### Proof-of-Concept Outline

1. Modify `personas/standalone/src/content/plan-refiner.md` to add a Refiner enrichment step between triage and sub-agent dispatch: after reading the plan and research brief for the Skip Design Review decision, the Refiner scans the plan's affected areas for references the brief doesn't cover (interface definitions, type signatures, test patterns, cross-module dependencies). Append findings to the research brief with `[added by: Refiner]` markers and `[arch]`/`[verify]` audience tags. Cap at ≤10 tool calls.
2. Modify the sub-agent dispatch prompts to reference the enriched brief: `"A research brief with verified codebase references is available at {PATH}. Sections tagged [arch]/[verify] are particularly relevant to your analysis. You must independently verify any reference you find suspicious and search beyond the briefing for concerns the Planner may have missed."`
3. Modify the Phase 2 audit loop prompt for cycles 2+ to include: `"This is audit cycle {N}. The previous audit identified {summary_of_findings}. The plan has been revised — the following sections were modified: {changed_sections}. Focus your verification on the revised sections and spot-check the remainder."`
4. Run the refiner on two real plans and compare: (a) total token usage (including the Refiner's enrichment cost), (b) number of tool calls per agent (expect Refiner increase, sub-agent decrease), (c) audit quality (same findings caught?), (d) **independent discovery rate** — the percentage of Auditor/Reviewer findings that reference codebase locations *not present* in the enriched research brief. A significant drop in this metric (vs. a control run without enrichment) indicates anchoring.
5. For Phase 3 validation: compare the research brief before and after a full refinement cycle. Count unique references added by sub-agents (vs. by the Refiner). Track whether the Planner's rework integration calls made fewer tool calls when the enriched brief was available. Verify that no enriched entries (from either the Refiner or sub-agents) contain incorrect facts that propagated into downstream findings.

---

## Open Questions

- **Anchoring measurement via "independent discovery rate":** Track the percentage of Auditor/Reviewer findings that reference codebase locations *not present* in the research brief. If this "independent discovery rate" drops significantly when the brief is shared (vs. a control run without it), anchoring is occurring. This metric is cheap to compute from existing audit output — compare the set of file paths in `audit.md` findings against the set of file paths in `research-brief.md`. A healthy target: ≥30% of findings should reference locations the agent discovered independently, indicating the brief accelerates known-area verification without suppressing exploration of unknown areas.
- **Brief scope completeness:** The research brief only covers areas the Planner identified. If the Planner's scope sketch misses an area, the brief won't contain references for it. Should the Plan Refiner instruct sub-agents to explicitly flag "I found relevant areas not covered in the research brief" as part of their output?
- **Orchestrator integration:** The current orchestrator runs the 9-stage ledger workflow, not the standalone Plan Refiner. If the Plan Refiner workflow is ever ported to the orchestrator, the briefing packet approach would need to be represented in `WorkflowState` or as a file artifact.
- **Model sensitivity:** Different models may respond differently to the autonomy clause. Claude models tend to follow "verify independently" instructions well; other models may anchor more strongly to provided context. Testing across model providers is advisable.
- **Token savings measurement:** The orchestrator already logs per-stage token usage in JSONL entries (`stage_start`/`stage_complete`). If this workflow is ported to the orchestrator, A/B measurement of token savings is straightforward. Even in IDE mode, sub-agent invocations report token counts in the conversation — manual comparison is feasible for the proof-of-concept. The POC outline (step 3) should leverage these existing metrics rather than building new instrumentation.
- **Attention degradation risk:** Adding a 2–4K token research brief to an already-long sub-agent prompt may trigger "lost in the middle" attention degradation (Liu et al., 2023), where models attend more weakly to information positioned between the beginning and end of long inputs. This is a mechanical limitation of transformer attention, distinct from cognitive anchoring. The POC should measure not just token count but finding quality (precision/recall of audit findings) to detect cases where the brief's presence causes the model to reason less carefully about the plan itself. Per-agent brief views (pointing agents to relevant sections rather than the whole brief) and the 5K size guard both mitigate this risk.
- **"Brief as crutch" behavioral degradation:** If the refiner is used routinely with the same persona prompts, models may learn to rely on the brief as a shortcut and reduce independent exploration even when the autonomy clause is present. This is a long-term behavioral risk distinct from one-shot anchoring — it manifests as a gradual decline in independent discovery rate over many runs. Periodically running without the brief (or with a deliberately incomplete brief that omits one known area) as a calibration check could detect this degradation before it becomes entrenched.
- **Error propagation in enriched briefs:** When multiple agents contribute to the research brief (Phase 3), incorrect facts can propagate across the agent chain. An Architect Reviewer who misidentifies a type signature, or an Auditor who records a wrong line range, creates a poisoned reference that downstream agents may trust without re-verification. The provenance markers (`[added by: ..., unverified]`) mitigate this, but the POC should track whether any enriched-brief entries are later contradicted by downstream agents' independent verification, to quantify the real-world error rate.

---

## References

- Plan Refiner persona: `personas/standalone/src/content/plan-refiner.md`
- Plan Auditor persona: `personas/standalone/src/content/plan-auditor.md`
- Plan Architect Reviewer persona: `personas/standalone/src/content/plan-architect-reviewer.md`
- Planner (Standalone) persona: `personas/standalone/src/content/planner.md`
- Orchestrator isolation constraint: `orchestrator/docs/agents/project-manifest/constraints.md` (Constraint 7)
- Research Brief template: defined in Planner persona, `## Research Brief Template` section
- Shared evidence format: defined in both Auditor and Architect Reviewer personas
- Park et al. (2023), "Generative Agents: Interactive Simulacra of Human Behavior" — demonstrates factual observation sharing with private interpretation in multi-agent systems
- Liu et al. (2023), "Lost in the Middle: How Language Models Use Long Contexts" — demonstrates that transformer models attend more weakly to information positioned in the middle of long inputs, with strongest attention at the beginning and end
