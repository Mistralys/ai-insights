# Research Report

## Problem Statement

The current plan-quality workflow is a manual two-agent pipeline:

1. **Planner** (`personas/ledger/src/meta/1-planner.yaml`) drafts `plan.md`.
2. **Plan Auditor** (`personas/standalone/vs-code/plan-auditor.agent.md`) produces `audit.md` with findings classified Critical / Major / Minor and a verdict of `PASS`, `PASS WITH FINDINGS`, or `FAIL`.

Empirically, even after one revision pass the audit still surfaces Major (and sometimes Critical) findings, forcing the user to re-invoke the loop manually multiple times. The user wants this loop to run **autonomously** until a quality floor is reached (e.g. zero Critical, zero Major — only Minor findings remain), with safe termination guarantees.

## Problem Decomposition

1. **Loop control** — How is the iterative cycle expressed and orchestrated (chat-mode tool, LangGraph subgraph, or shell-driven runner)?
2. **Termination semantics** — What exit conditions prevent both premature stops and infinite loops (quality threshold + iteration budget + non-improvement detection)?
3. **State carry-over** — What artefacts pass between iterations (prior plan, prior audit, diff of changes, accumulated rationale)?
4. **Critic independence** — Should the Auditor see prior audits/plans, or audit each revision fresh to avoid anchoring bias?
5. **Convergence vs. oscillation** — How to detect that revisions are no longer reducing finding counts, and escalate to the human?
6. **Persona-level changes** — What additions to the existing Planner / Auditor personas are required to support a structured machine-readable handshake?

## Context & Constraints

- Workspace already runs **LangGraph + Deep Agents** in `orchestrator/` — cyclic state graphs are a first-class primitive and the natural home for a self-refining subgraph.
- Personas are generated from YAML+Markdown sources in `personas/` and consumed by both VS Code chat and the orchestrator. Any persona change must flow through `scripts/build-personas.js`, never by editing generated output.
- The Planner persona already supports a **rework mode** (file naming `…-rework-{COUNTER}.md`), which is the right primitive for storing successive iterations without overwriting history.
- The Plan Auditor already emits a structured **Finding Counts** block — machine-parseable with a small regex/JSON contract upgrade.
- Hard constraints: no Git writes from agents; cross-platform (Win/macOS/Linux) per workspace policy; bounded LLM cost.
- Soft preferences: keep the loop usable both inside VS Code chat (lightweight) and inside the orchestrator (deterministic, headless).

## Prior Art & Known Patterns

### Pattern 1: Self-Refine (Madaan et al., 2023)
- **Description:** A single model alternates `generate → self-critique → refine` in a loop until a stopping criterion. No external tools or separate critic identity.
- **Where used:** Original Self-Refine paper (arXiv 2303.17651) demonstrated 20%+ improvements across 7 tasks; widely replicated in code-generation and reasoning benchmarks.
- **Strengths:** Minimal infrastructure — works as a single chained prompt. Cheap to prototype.
- **Weaknesses:** Same model both generates and critiques → bias toward declaring its own work acceptable; convergence often plateaus at 2–3 iterations.
- **Fit:** Weak fit. The user already validated that *separate* critic personas catch issues a single-agent loop misses.

### Pattern 2: Reflexion (Shinn et al., 2023)
- **Description:** Adds a verbal **reflection memory** between iterations — the agent appends "what I got wrong last time" to its context as natural-language self-feedback, distinct from the raw critique.
- **Where used:** arXiv 2303.11366; SOTA on HumanEval at the time of publication; pattern adopted in many agent frameworks (e.g. AutoGen, LangGraph examples).
- **Strengths:** Carrying *why* a previous revision failed (not just *what*) reduces repeat mistakes; pairs well with a separate critic.
- **Weaknesses:** Requires a structured memory schema; adds tokens per cycle.
- **Fit:** Strong fit. Maps directly onto the existing Auditor → Planner handoff if the Planner appends each round's audit summary to a "Lessons Learned" appendix in the rework plan.

### Pattern 3: Generator–Critic (Actor–Critic) Loop with Distinct Roles
- **Description:** Two distinct agents — generator and discriminator/critic — exchange artefacts until the critic accepts. Termination is governed by an explicit verdict the critic emits.
- **Where used:** AlphaCodium (Codium AI, 2024, arXiv 2401.08500) for competitive programming; LangGraph's "reflection" tutorials (`langchain-ai/langgraph` repo, `examples/reflection/`); Anthropic's Constitutional-AI critique-revise loop.
- **Strengths:** Critic independence reduces self-deception bias; verdict field gives a clean termination signal; aligns with the workspace's existing Planner/Auditor split.
- **Weaknesses:** Cost roughly doubles per cycle vs. Self-Refine; risk of critic "moving the goalposts" if its rubric isn't frozen across iterations.
- **Fit:** **Strongest fit.** The Planner and Plan Auditor already implement this pattern manually — the only missing piece is a deterministic loop driver and a machine-readable handshake.

### Pattern 4: CRITIC — Tool-Verified Critique (Gou et al., 2023)
- **Description:** The critic uses external tools (search, code execution, file inspection) to verify each claim before flagging it. arXiv 2305.11738.
- **Where used:** Subsequent agent frameworks like LangGraph and CrewAI expose tool-verified critique as a built-in pattern.
- **Strengths:** Drastically reduces hallucinated findings (false positives); critic findings carry verifiable evidence.
- **Weaknesses:** Tool call latency and cost.
- **Fit:** Already partially implemented — the existing Plan Auditor's "Phase 2: Grounding Verification" and "Phase 3b: Optimization Research" mandate filesystem and web-search verification. The pattern is adopted; the loop is not.

### Pattern 5: Bounded Iterative Refinement with Convergence Detection
- **Description:** Loop runs up to *N* iterations but exits early if (a) quality threshold met, (b) finding count fails to monotonically decrease, or (c) hash of generated artefact is unchanged between rounds.
- **Where used:** Standard practice in compiler optimization passes, fixed-point iteration in static analysis, and modern agent frameworks (LangGraph's `should_continue` conditional edges).
- **Strengths:** Hard cost ceiling; oscillation detection prevents wasting budget on unconvergeable plans.
- **Weaknesses:** Threshold tuning is empirical.
- **Fit:** Mandatory complement to any of the patterns above. Without it, autonomous loops can burn unbounded tokens.

### Pattern 6: LangGraph Cyclic StateGraph
- **Description:** A `StateGraph` with conditional edges that loop back to a prior node based on a state predicate. The framework already powers `orchestrator/` in this workspace.
- **Where used:** `langgraph` >= 0.2 examples; `langchain-ai/langgraph/examples/reflection/reflection.ipynb`.
- **Strengths:** Native checkpointing (resume after crash), built-in iteration limits (`recursion_limit`), introspectable runs (matches existing JSONL log schema).
- **Weaknesses:** Adds orchestrator complexity for a workflow currently run interactively in VS Code chat.
- **Fit:** Best long-term home; chat-mode shim acceptable for short-term.

## Alternative & Creative Approaches

- **Approach: Frozen-Rubric Auditor.** Pin the auditor's evaluation rubric (severity definitions, finding categories) into a versioned external file (e.g. `personas/standalone/src/partials/_audit-rubric.md`) referenced by both the auditor persona and the loop driver. **Rationale:** prevents goalpost-shifting across iterations and lets the loop driver evaluate "did we improve?" against a stable yardstick. **Risk:** rubric staleness if codebase evolves.
- **Approach: Triadic Loop (Planner ↔ Auditor ↔ Arbiter).** Add a third lightweight "Arbiter" persona that only runs when the Planner contests an Auditor finding. **Rationale:** breaks deadlock when the Auditor and Planner disagree on whether something is a real issue (a known failure mode of generator–critic loops). **Risk:** adds cost and a new persona to maintain.
- **Approach: Diff-Driven Rework.** Instead of regenerating the whole plan each cycle, instruct the Planner in rework mode to produce a **structured diff/patch** against the prior plan, addressing each finding by ID. **Rationale:** dramatically reduces tokens, preserves stable sections, and makes "what changed" auditable. **Risk:** Planner must learn a new output mode; merging diffs needs tooling.
- **Approach: Ledger-Backed Loop.** Store each iteration's plan + audit + finding counts as a Work Package in the existing MCP Project Ledger. **Rationale:** reuses the workspace's first-class persistence + status state machine; loop history becomes a permanent record. **Risk:** couples the refinement loop to the ledger MCP server, which may be overkill for plans authored outside ledger projects.
- **Approach: Two-Tier Acceptance Threshold.** Define two stop levels: `STRICT` (zero Critical, zero Major) and `RELAXED` (zero Critical only, with explicit Major-finding sign-off block in the plan). **Rationale:** acknowledges that some Major findings are deliberate trade-offs the user accepts. **Risk:** requires the Planner to author justification text for accepted Majors.

## Comparative Evaluation

| Criterion              | Self-Refine | Reflexion (single agent) | Generator–Critic + Bounded Loop **(recommended)** | Triadic (Planner/Auditor/Arbiter) | Diff-Driven Rework |
|------------------------|-------------|--------------------------|---------------------------------------------------|-----------------------------------|--------------------|
| **Complexity**         | Low         | Low–Medium               | Medium                                            | High                              | Medium–High        |
| **Critic independence**| None        | None                     | Strong                                            | Strongest                         | Strong             |
| **Token cost / cycle** | 1×          | 1.1×                     | ~2×                                               | ~2.5–3×                           | ~1.2× (diff only)  |
| **Convergence speed**  | Plateaus 2–3 cycles | Slightly better      | Good with frozen rubric                           | Good                              | Good               |
| **Infra reuse**        | n/a         | n/a                      | Reuses existing personas + LangGraph              | Needs new persona                 | Needs diff tooling |
| **Time to implement**  | Hours       | Hours                    | 1–2 days                                          | 3–5 days                          | 3–5 days           |
| **Risk**               | Low value gain | Low                   | Low                                               | Medium                            | Medium (diff bugs) |

## Recommendation

Adopt **Pattern 3 (Generator–Critic) layered with Pattern 2 (Reflexion memory) and Pattern 5 (Bounded loop with convergence detection)**, implemented as a **LangGraph cyclic subgraph** in the existing orchestrator and exposed for chat-mode use via a thin standalone driver agent.

Concretely the loop is:

```
                  ┌──────────────────────────────┐
                  │   Planner (rework mode)      │
                  │   inputs: prior plan + audit │
                  │           + lessons-learned  │
                  └──────────────┬───────────────┘
                                 │ plan-N.md
                                 ▼
                  ┌──────────────────────────────┐
                  │   Plan Auditor (frozen rubric)│
                  │   outputs: audit-N.md +       │
                  │   structured Finding Counts   │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │   Loop Controller            │
                  │   • parse counts             │
                  │   • check stop conditions    │
                  │   • detect non-improvement   │
                  └──┬─────────┬─────────┬───────┘
                     │         │         │
              accept │   loop  │   give-up │
                     ▼         ▼         ▼
                   DONE     planner   ESCALATE
```

**Stop conditions (any one terminates):**

1. **Quality met:** `critical == 0 AND major == 0` (or a relaxed threshold the user configures).
2. **Iteration budget:** `iteration >= MAX_ITERATIONS` (default 5; configurable).
3. **Non-improvement:** for two consecutive cycles, `(critical, major)` does not strictly decrease *and* quality threshold not met → escalate to the human with all artefacts.
4. **No-op:** plan content hash unchanged between cycles → escalate.

**Why this combination:**

- Generator–Critic gives critic independence the user already validated empirically (manual loop catches issues self-refine misses).
- Reflexion-style "Lessons Learned" appendix in each rework plan reduces repeat findings without re-prompting the Auditor with prior audits (preserving its independence).
- Bounded loop + non-improvement detection guarantees finite cost and surfaces unconvergeable plans for human triage.
- LangGraph is already the runtime substrate of `orchestrator/` — no new dependency.
- Frozen rubric (extracted partial) eliminates the most common Generator–Critic failure mode (drifting standards).

### Proof‑of‑Concept Outline

1. **Machine-readable handshake.** Extend the Plan Auditor's output template with a fenced JSON block (in addition to the existing Markdown table) so the loop driver can parse counts deterministically:
   ```json
   { "critical": 0, "major": 2, "minor": 5, "verdict": "PASS WITH FINDINGS", "iteration": 1 }
   ```
   Update `personas/standalone/src/meta/plan-auditor.yaml` and the corresponding content partial.
2. **Frozen rubric partial.** Move the "Finding Severity Reference" table out of the Plan Auditor persona body into `personas/standalone/src/partials/_audit-rubric.md` (or a shared partials location) so both auditor and loop driver reference the same versioned definition.
3. **Reflexion appendix in rework plans.** Update Planner persona's rework instructions to require a `## Lessons From Prior Audit` section listing each prior finding ID and the change made to address it.
4. **Loop driver — chat-mode prototype.** New standalone persona `plan-refinement-loop.agent.md` whose body encodes the controller logic in natural language: invoke Planner subagent → invoke Auditor subagent → parse JSON block → decide. Cheap, no orchestrator changes, validates the protocol end-to-end.
5. **Loop driver — orchestrator implementation.** A LangGraph `StateGraph` with three nodes (`planner`, `auditor`, `controller`) and conditional edges back to `planner` or to terminal `done` / `escalate` nodes. Reuse existing `orchestrator/src/utils/subagents.py` to load the standalone personas. Persist iterations under `docs/agents/plans/{date}-{name}/iter-{N}/{plan,audit}.md` (extends the existing `-rework-{COUNTER}` convention to a directory layout).
6. **Acceptance tests.** Run the loop against three known plans: one already clean (should terminate at iter 0–1), one with major findings (should converge in 2–3), one deliberately unconvergeable (should escalate). Assert termination conditions in `orchestrator/tests/`.

## Open Questions

- **Configurable acceptance threshold.** Should the workspace default to `STRICT` (zero Major) or `RELAXED` (zero Critical, Major findings explicitly accepted)? Recommended: `STRICT` default with per-invocation override.
- **Auditor memory policy.** The recommendation assumes the Auditor sees only the *current* plan, never prior audits. Worth A/B testing whether providing a brief "previous-cycle finding IDs the Planner claims to have addressed" hint speeds convergence without inducing rubber-stamping.
- **Cost ceiling.** What is the hard token/dollar budget per loop run? The MAX_ITERATIONS default of 5 should be calibrated against observed per-cycle token usage on real plans.
- **Chat-mode reachability.** VS Code chat does not natively support agent-to-agent delegation in a loop without a host-side runner. The "chat-mode prototype" works only if the user is willing to manually re-invoke the loop persona each cycle, or if the loop is implemented as a single-turn skill that internally fans out subagent calls. Confirm which is acceptable before building the chat-mode tier.
- **Ledger integration.** Should each iteration register as a Work Package status transition in the MCP Project Ledger? Useful for projects already running the ledger workflow; overhead for ad-hoc plans.
- **Diff-driven rework as a follow-up.** Once the basic loop is proven, evaluate whether moving to structured-diff rework (Alternative #3) cuts cost enough to justify the tooling investment.

## References

- Madaan et al., 2023. *Self-Refine: Iterative Refinement with Self-Feedback.* arXiv:2303.17651.
- Shinn et al., 2023. *Reflexion: Language Agents with Verbal Reinforcement Learning.* arXiv:2303.11366.
- Gou et al., 2023. *CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing.* arXiv:2305.11738.
- Ridnik et al., 2024. *Code Generation with AlphaCodium: From Prompt Engineering to Flow Engineering.* arXiv:2401.08500.
- Bai et al., 2022. *Constitutional AI: Harmlessness from AI Feedback.* arXiv:2212.08073.
- LangGraph reflection example — `langchain-ai/langgraph` repository, `examples/reflection/reflection.ipynb` (verified to exist; cyclic critique-revise pattern using `StateGraph` conditional edges).
- Existing workspace assets:
  - [personas/ledger/src/meta/1-planner.yaml](../../../personas/ledger/src/meta/1-planner.yaml) — Planner persona source (rework mode lives here).
  - [personas/standalone/vs-code/plan-auditor.agent.md](../../../personas/standalone/vs-code/plan-auditor.agent.md) — Plan Auditor persona (generated; source under `personas/standalone/src/`).
  - [orchestrator/src/utils/subagents.py](../../../orchestrator/src/utils/subagents.py) — existing subagent loader (target integration point for the loop driver).
  - [shared/workflow-manifest.json](../../../shared/workflow-manifest.json) — single source of truth for roles; a new "Plan Refinement Loop" controller would either be a standalone (no manifest entry needed) or a new ledger role (manifest update required).

AGENT: Research
STATUS: COMPLETE
