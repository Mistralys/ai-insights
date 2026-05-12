# Research Report

## Problem Statement

The current `Plan Auditor` persona (`personas/standalone/src/content/plan-auditor.md`) reliably catches **technical defects** in plans — hallucinated file paths, invented APIs, vague acceptance criteria — but consistently under-delivers on **architectural critique**: it rarely questions whether the planned design is the simplest, most appropriate shape for the problem, even though the persona's instructions explicitly ask for that (see Phase 3 "Design Evaluation", Phase 3b "Optimization Research", and the "Optimize, Don't Just Verify" philosophy bullet).

The user wants to know whether the right response is to **split the persona in two** — one technical auditor and one architectural reviewer — and how that split would interact with the autonomous plan-refinement loop already being designed (see `2026-05-08-autonomous-plan-refinement.md`).

## Problem Decomposition

1. **Diagnosis** — *Why* does the current single persona under-deliver on architecture despite explicit instructions? Is this a persona-design failure, a cognitive-mode conflict, or a workflow-position problem?
2. **Split rationale** — Are the two activities sufficiently distinct in inputs, evidence types, and outputs to justify two personas, or is a single persona with stronger structural cues sufficient?
3. **Boundary definition** — If split, where exactly is the line drawn between "technical" and "architectural"? What belongs to each?
4. **Workflow integration** — How does the split slot into the autonomous-refinement loop (parallel? serial? gating?), and how does it interact with the Planner's rework cycle?
5. **Termination & non-blocking semantics** — Architectural critique is advisory by nature; how should its verdict differ from the technical auditor's blocking verdict to avoid infinite loops on subjective "could be simpler" findings?
6. **Persona-vocabulary contamination** — If both personas use the same severity scale (Critical/Major/Minor), the Planner cannot distinguish blocking grounding errors from advisory design suggestions. What vocabulary keeps them visibly distinct?
7. **Adjacent persona opportunities** — Are there other latent personas (YAGNI/scope reducer, security-by-design reviewer) that the same diagnosis would justify carving out?

## Context & Constraints

- **Existing personas live in `personas/standalone/src/`** and are built via `scripts/build-personas.js`. Adding a new persona requires a YAML metadata file under `personas/standalone/src/meta/` and a content file under `personas/standalone/src/content/`. The build is deterministic and validated against `shared/workflow-manifest.json`.
- **An autonomous-refinement loop is already in design** (`docs/agents/research/2026-05-08-autonomous-plan-refinement.md`), recommending a LangGraph subgraph with bounded iterations, Reflexion-style memory, and an explicit verdict-driven termination. Any split of the Plan Auditor must compose cleanly with that loop.
- **The Planner persona supports rework mode** (`…-rework-{COUNTER}.md`), giving a natural home for successive iterations.
- **Soft preference:** keep the new persona usable both inside VS Code chat (one-shot manual invocation) and inside the orchestrator (deterministic, headless). This rules out designs that require shared in-memory state between the two reviewers.
- **Hard preference from the user:** the architectural reviewer must be **distinct enough not to be re-merged** into the technical auditor by a future curator who notices overlap.

## Prior Art & Known Patterns

### Pattern 1: Single-Persona Multi-Phase Audit (status quo)
- **Description:** One persona executes ordered phases (structural completeness → grounding → design evaluation → optimization research → risk). All findings flow into one severity-graded report.
- **Where used:** Current `plan-auditor.md`. Common in code-review checklists (e.g. GitHub Actions reviewer templates, OWASP audit guides).
- **Strengths:** Single artefact for the Planner to consume; one invocation; lower token cost than two passes.
- **Weaknesses:** Empirically observed in this workspace — the cheap, mechanical phases dominate the cognitive budget. Phase 2 grounding produces dozens of falsifiable findings; Phase 3/3b design critique requires holistic judgment and gets squeezed out. This is a documented failure mode in checklist-driven review (Atul Gawande, *The Checklist Manifesto*: checklists optimise for completeness of mechanical items, not for depth of judgment items).
- **Fit:** Weak. Current evidence is that the persona's design-critique output is consistently shallow despite explicit instructions to perform it.

### Pattern 2: Generator–Critic with Specialised Critics (chain of critics)
- **Description:** Multiple critics with non-overlapping scopes review the same artefact in parallel or sequence. Each critic has a single concern (correctness, security, performance, style, design). The generator integrates all critic outputs in the next iteration.
- **Where used:** AlphaCodium's multi-stage flow (correctness tests → AI-generated tests → public tests); ChatDev's role-specialised reviewer agents (arXiv 2307.07924); CrewAI and AutoGen reviewer-pool examples; classic IDE review pipelines (lint → type-check → test → human design review).
- **Strengths:** Each critic operates in a single cognitive mode and produces consistent depth within its scope. Easy to add or remove critics independently. Aligns naturally with the workspace's existing standalone-persona model.
- **Weaknesses:** N× token cost vs. single-persona; requires a coordinator that aggregates verdicts; risk of contradictory recommendations across critics.
- **Fit:** **Strongest fit.** Maps directly onto the existing standalone-persona infrastructure and the planned LangGraph refinement loop.

### Pattern 3: Architecture Decision Record (ADR) Reviewer
- **Description:** A reviewer focused exclusively on architectural decisions documented as ADRs — challenges the chosen option against alternatives, surfaces unstated trade-offs, checks for over-flexibility/premature abstraction.
- **Where used:** Michael Nygard's original ADR pattern (2011); ThoughtWorks Tech Radar reviewer practices; the `adr-tools` ecosystem.
- **Strengths:** Tightly scoped vocabulary ("Considered Alternatives", "Consequences", "Status") that is naturally non-blocking and advisory.
- **Weaknesses:** ADR formalism is heavier than the workspace's plan documents typically warrant; full adoption would require restructuring the Planner's output.
- **Fit:** Moderate. The *vocabulary* (advisory verdicts, alternatives-first framing) is directly transferable to a new persona without adopting the full ADR document format.

### Pattern 4: YAGNI / Simplicity Reviewer (DHH, Kent Beck lineage)
- **Description:** A reviewer whose sole concern is "do we need this at all?" — challenges scope, premature flexibility, speculative generality, and abstraction layers added "just in case."
- **Where used:** Extreme Programming literature; "rule of three" refactoring guidance; widely codified in code-review style guides (Google's CL guidelines, Microsoft's secure-by-design docs).
- **Strengths:** A single, sharp question forces depth on a different axis than design soundness. Findings are typically high-impact when they hit.
- **Weaknesses:** Easily turns into bikeshedding if not bounded by evidence requirements; cognitive overlap with architectural review is real.
- **Fit:** Possible third persona. Worth considering, but secondary to the technical/architectural split.

### Pattern 5: Two-Track Code Review (Google / Phabricator practice)
- **Description:** Reviews are explicitly split into a **blocking track** (correctness, security, contract violations — must be fixed before merge) and a **non-blocking track** (style, design suggestions, alternative approaches — author may decline). Tooling enforces the distinction visibly (e.g. "Required Changes" vs "Suggestions").
- **Where used:** Google's internal code-review culture (documented by Caitlin Sadowski et al., *Modern Code Review*, ICSE 2018); Gerrit/Phabricator conventions; GitHub PR review comment severity tags (`nit:`, `suggestion:`, `blocking:`).
- **Strengths:** Solves the severity-contamination problem cleanly: the author cannot confuse "this blocks merge" with "I'd consider doing this differently". Empirically reduces back-and-forth churn in industrial settings.
- **Weaknesses:** Requires both tracks to maintain discipline — non-blocking comments can accidentally be treated as blocking by anxious authors.
- **Fit:** **Direct mapping** for the proposed split: technical auditor = blocking track, architectural reviewer = non-blocking track.

## Alternative & Creative Approaches

### Alternative A: Single persona with hard structural quotas
- **Approach:** Keep one persona but enforce in the output template that exactly N architectural findings or simplification proposals must appear (or be explicitly justified as absent). Make Phase 3 and 3b *required output sections* with their own quality checklist items.
- **Rationale:** Avoids doubling token cost; addresses the cognitive-mode imbalance via output structure rather than persona split.
- **Risk:** Likely produces forced, low-value architectural findings to satisfy the quota — a known pathology of mandatory-section reviewers ("must list 3 risks" → 3 generic risks). Does not address the underlying cognitive-mode conflict.

### Alternative B: Two-pass single persona (technical pass, then architectural pass)
- **Approach:** Same persona file, invoked twice with different mode flags (e.g. `--mode=technical` then `--mode=architectural`). Each pass is single-mode and produces a separate report.
- **Rationale:** Captures most of the benefit of a split without creating a second persona.
- **Risk:** The persona's identity statement and operating philosophy are mode-agnostic; the persona will drift toward its dominant cognitive mode (technical) regardless of the flag. Identity-as-prompt research (e.g. role-prompting effect studies, Salewski et al., 2023) suggests that identity framing dominates flag-based mode switching.

### Alternative C: Three-persona split (technical / architectural / scope)
- **Approach:** Carve out a third "Scope Reducer / YAGNI Reviewer" persona alongside the two-way split.
- **Rationale:** Architectural soundness and YAGNI are different questions ("is this the right shape?" vs "do we need any of this?"). A reviewer asked to do both will tend to do one well and the other poorly.
- **Risk:** Three reviewers triple the cost and increase the chance of contradictory advice. Worth deferring until evidence shows the architectural reviewer drifting into scope arguments.

### Alternative D: Parallel critique aggregation
- **Approach:** Run the technical auditor and architectural reviewer **in parallel** (they consume the same plan + codebase, and their outputs are independent). The Planner integrates both reports in a single rework cycle.
- **Rationale:** Reviewers operate above the line of each other's specific findings, so serial execution buys little. Parallel halves wall-clock time.
- **Risk:** None substantial. The architectural reviewer's recommendations almost never depend on grounding details the auditor would surface — design critique operates at a level above specific API references. Adopt this as the default execution mode.

## Comparative Evaluation

| Criterion | Pattern 1 (status quo) | Pattern 2 (specialised critics) | Alt A (quotas) | Alt B (two-pass) |
|-----------|------------------------|----------------------------------|----------------|-------------------|
| **Architectural depth** | Low (observed) | High | Medium (forced) | Medium |
| **Token cost per cycle** | 1× | 2× | ~1.2× | 2× |
| **Cognitive-mode separation** | None | Strong | Weak | Weak (identity dominates) |
| **Severity-vocabulary clarity** | Mixed | Clean (separate vocabularies) | Mixed | Mixed |
| **Composes with refinement loop** | Yes | Yes (parallel or serial) | Yes | Yes |
| **Risk of forced/low-value findings** | Low | Low | High | Medium |
| **Implementation effort** | None | New persona + loop wiring | Persona edit | Persona edit + flag |
| **Future-proofing (resists re-merge)** | N/A | High (separate files, vocabularies) | Low | Low |

## Recommendation

**Adopt Pattern 2 (specialised critics) by splitting the current `Plan Auditor` into two distinct standalone personas, executed in parallel within the autonomous-refinement loop.**

### Persona 1 — Plan Auditor (revised, technical scope)
- **Scope:** Phase 1 (structural completeness), Phase 2 (grounding verification), Phase 4 (risk coverage). Trim Phase 3 to **pattern consistency with the existing codebase** only — verifiable claims about whether the plan follows established conventions in the repo.
- **Drop entirely:** Phase 3b "Optimization Research" and the "Optimize, Don't Just Verify" philosophy bullet — these move to Persona 2.
- **Verdict vocabulary:** `PASS` / `PASS WITH FINDINGS` / `FAIL`. Severity: Critical / Major / Minor. **Blocking** by design — `FAIL` halts the loop and returns to the Planner.
- **Output:** `audit.md` (unchanged location).

### Persona 2 — Plan Architect Reviewer (new)
- **Scope:** Architectural soundness, simplification opportunities, over-engineering and premature flexibility, library/framework fit, ecosystem-level alternatives. Operates above the line of specific API references — reads the plan holistically against several alternative shapes.
- **Verdict vocabulary:** Deliberately **distinct** from the auditor's. Suggested categories: `Simplifications` (high-conviction reductions), `Concerns` (design risks worth discussing), `Affirmations` (decisions the reviewer endorses). **Advisory only** — never blocks the loop. The Planner decides which suggestions to incorporate.
- **Output:** `design-review.md` (new file, alongside `audit.md`).
- **Source location:** `personas/standalone/src/meta/plan-architect-reviewer.yaml` + `personas/standalone/src/content/plan-architect-reviewer.md`, built via `scripts/build-personas.js`.

### Workflow integration

```
Plan (or Plan-rework-N) ─┬─► Plan Auditor       ──► audit.md         (blocking)
                         └─► Plan Architect      ──► design-review.md (advisory)
                                                    │
                                                    ▼
                  Planner integrates BOTH reports in next rework cycle
```

- **Parallel execution** is the default — the two reviewers share inputs but produce independent outputs.
- **Loop termination is governed by the Auditor only.** The Architect's output is fed to the Planner but never blocks convergence. This avoids the infinite-loop trap that subjective "could be simpler" findings would otherwise create.
- **Bounded architectural passes:** to prevent perpetual simplification churn, the loop driver should stop forwarding Architect output to the Planner after N=2 rounds (configurable). After that, remaining `Concerns` are surfaced to the human for a decision.

### Cross-cutting design rules
1. **Vocabularies must not collide.** The Architect must not use Critical/Major/Minor; the Auditor must not use Simplifications/Concerns/Affirmations. This makes a future curator's accidental re-merge structurally obvious.
2. **Shared evidence format.** Both personas cite findings using `{file_path, line_range, claim}` tuples so the Planner can cross-reference without parsing two different schemas.
3. **No merged report.** Two files, two filenames, always. Document the separation in the personas' own headers.
4. **Architect persona must verify its own recommendations** with the same grounding rigor the Auditor applies — any library or pattern it proposes must be confirmed via web search or codebase inspection.

### Proof-of-Concept Outline

1. **Draft `plan-architect-reviewer.md`** (content) and `plan-architect-reviewer.yaml` (metadata) in `personas/standalone/src/`. Borrow the Researcher persona's "exhaust before inventing" philosophy and the ADR pattern's alternatives-first framing.
2. **Trim `plan-auditor.md`**: remove Phase 3b, scope Phase 3 to codebase-pattern consistency, remove the "Optimize, Don't Just Verify" bullet. Add a cross-reference note pointing to the new Architect persona.
3. **Build and validate:** `node scripts/build-personas.js` then `--check` for staleness; verify both personas appear in VS Code prompts and Claude Code agents.
4. **Smoke test on a real plan:** pick a recent plan in `docs/agents/plans/`, run both reviewers manually, confirm the outputs are visibly different in vocabulary and depth.
5. **Wire into the refinement loop** (post-merge with `2026-05-08-autonomous-plan-refinement.md`): add the Architect as a parallel branch in the LangGraph subgraph; Auditor remains the verdict authority for termination.

## Open Questions

- **Should the Architect persona also propose YAGNI/scope reductions, or is that a future third persona?** Recommendation: start with Architect doing both; carve out a YAGNI persona only if observed drift between architectural-soundness and scope-reduction findings becomes a quality problem.
- **How should the Planner's rework template surface design-review feedback distinctly from audit findings?** The Planner persona's "Lessons Learned" appendix (proposed in `2026-05-08-autonomous-plan-refinement.md`) likely needs a parallel "Design Decisions Reconsidered" section. Defer to that work package.
- **Should the orchestrator's stage map gain a `design-review` pipeline alongside `audit`?** Likely yes for headless runs, but this depends on the broader autonomous-loop design and is out of scope for this report.
- **Cost ceiling.** Doubling reviewer cost per refinement cycle is real. Worth measuring on a representative plan before committing to parallel-by-default in the orchestrator. Manual VS Code use is unaffected.

## References

- Madaan et al., *Self-Refine: Iterative Refinement with Self-Feedback* (2023), arXiv:2303.17651.
- Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning* (2023), arXiv:2303.11366.
- Gou et al., *CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing* (2023), arXiv:2305.11738.
- Qian et al., *ChatDev: Communicative Agents for Software Development* (2023), arXiv:2307.07924.
- Ridnik et al., *Code Generation with AlphaCodium* (2024), arXiv:2401.08500.
- Salewski et al., *In-Context Impersonation Reveals Large Language Models' Strengths and Biases* (2023), arXiv:2305.14930. (Identity framing dominates mode flags.)
- Sadowski et al., *Modern Code Review: A Case Study at Google* (ICSE 2018). (Two-track blocking vs. non-blocking review.)
- Nygard, *Documenting Architecture Decisions* (2011). (ADR pattern; advisory verdicts.)
- Gawande, *The Checklist Manifesto* (2009). (Checklist failure modes for judgment-heavy items.)
- Companion: `docs/agents/research/2026-05-08-autonomous-plan-refinement.md` (autonomous refinement loop design).
- Current persona under review: `personas/standalone/src/content/plan-auditor.md`.
