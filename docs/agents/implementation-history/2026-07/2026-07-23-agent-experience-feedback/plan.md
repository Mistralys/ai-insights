# Research Report: Agent Experience (AX) Feedback

## Problem Statement

AI agents across the AI Insights ecosystem — both the 9-agent ledger workflow and the 20+ standalone/support agents — currently have no structured mechanism to report on the quality of their own experience. Friction encountered, tool confusion, insufficient context, ambiguous instructions, or persona gaps go unrecorded unless the human operator manually reads internal agent dialogues and infers pain points. This is effective but labour-intensive, doesn't scale across many agent types and runs, and easily misses patterns. The question: can agents self-report their experience while they still have context, and what is the best design for such a mechanism across the full agent ecosystem?

## Problem Decomposition

1. **Signal fidelity** — Can LLMs produce reliable, calibrated self-assessments of their own process experience, or will reports devolve into generic positivity / hallucinated friction?
2. **Scope** — The mechanism must work for all agent types: 9 sequential ledger agents, standalone agents (Planner, Developer, Documentation), and support/curator agents (Git Committer, README Curator, Manifest Curator, Changelog Curator, AGENTS.md Curator, Persona Curator, etc.). These operate in very different contexts — some have multi-step workflows, others are focused single-task tools.
3. **Capture point** — Where in each agent's workflow should feedback be collected? Every agent already ends with an `AGENT: X / STATUS: COMPLETE` handoff block, but their pre-handoff steps vary widely.
4. **Data model** — What schema captures agent experience in a structured, queryable way without becoming a dumping ground for noise, while being lightweight enough for a curator that runs for 2 minutes and rich enough for a multi-hour ledger workflow?
5. **Actionability** — How does captured AX data translate into concrete persona, tooling, or workflow improvements?
6. **Cost** — What is the token / latency overhead of adding a reflection step, and does the cost-benefit ratio hold for both heavyweight (Developer) and lightweight (Changelog Curator) agents?

## Context & Constraints

### Agent Ecosystem Overview

The AI Insights workspace operates three categories of agents:

| Category | Agents | Typical Session | Ending Pattern |
|----------|--------|-----------------|----------------|
| **Ledger workflow** (9 sequential) | Planner → PM → Developer → QA → Security → Reviewer → Release → Docs → Synthesis | Multi-hour, multi-WP projects | MCP tool handoff (`ledger_get_handoff_status`) |
| **Standalone** | Planner, Developer, Documentation Curator | Minutes to hours, plan-scoped | `AGENT: X / STATUS: COMPLETE` block; Developer writes `synthesis.md` |
| **Ledger-support / Curators** | Git Committer, README Curator, Manifest Curator, Changelog Curator, AGENTS.md Curator, Persona Curator, Ledger Doctor, Knowledge Archiver, Knowledge Curator, WP Decomposer, etc. | Minutes, single-focus tasks | `AGENT: X / STATUS: COMPLETE` block, sometimes with MODE |

### Existing Feedback Channels

- **Codebase observations** (`ledger_add_observation`) — describe what's wrong in the *codebase*, not the agent's experience.
- **Project comments** (`ledger_add_project_comment`) — describe *project events* (incidents, decisions, notes), not process friction.
- **Knowledge insights** (`ledger_add_insight`) — high-bar "Gold Nuggets Only" for *reusable cross-project learnings*, not run-specific friction.
- **Synthesis report** (`synthesis.md`) — aggregates outcomes and metrics; no section for workflow health or agent experience.
- **Orchestrator JSONL** — captures `duration_s`, `tokens_used`, `stage_error`, `stage_retry` (infrastructure-level only).
- **None of these capture the agent's own workflow experience** — what was confusing, what information was missing, what tool was hard to use.

### Key Constraints

- Adding AX feedback must not disrupt existing workflows or significantly increase token cost.
- The mechanism must be lightweight enough for a 2-minute curator session and rich enough for a multi-hour development session.
- All agents end with a status block — this is the universal insertion point.
- The persona build system supports **shared partials** (`personas/shared/partials/`) — a natural vehicle for cross-cutting concerns.
- No shared partial currently exists for session endings — each agent defines its own inline handoff.

## Prior Art & Known Patterns

### Pattern 1: External Observability Platforms (LangSmith, Langfuse, Braintrust)

- **Description:** Instrument agent runs from the outside. Capture traces, latency, token usage, error rates. Add human annotations or LLM-as-a-judge evaluations after the fact. The agent itself is passive — it does not self-report.
- **Where used:** LangSmith (LangChain), Langfuse (open-source), Braintrust. Industry standard for production LLM monitoring.
- **Strengths:** Non-intrusive. Rich quantitative data (latency, cost, error rates). No prompt overhead. Aggregation dashboards. Human-in-the-loop annotation workflows.
- **Weaknesses:** Cannot capture the agent's *subjective experience* — why it struggled, what was confusing, what information was missing. Purely external signal. Requires a separate platform and integration effort.
- **Fit:** The orchestrator's JSONL logger already provides this layer (duration, tokens, errors, retries). Upgrading it with dashboards is orthogonal to the AX question — it answers "what happened" but not "how did the agent experience it."

### Pattern 2: Reflexion (Verbal Self-Reflection for Retry)

- **Description:** Shinn et al. (2023) — agents verbally reflect on task failure signals, maintain reflective text in episodic memory, and use it to improve decisions in *subsequent trials* of the same task. The reflection is a means to improve performance on retries.
- **Where used:** Research (HumanEval coding benchmarks, AlfWorld, HotpotQA). Foundational paper for the self-reflection paradigm.
- **Strengths:** Demonstrated that verbal reflection significantly improves agent performance. Reflection is structured ("What went wrong? What should I try differently?"). The agent generates its own training signal.
- **Weaknesses:** Designed for *retry loops*, not for reporting experience to an operator. The reflection is consumed by the agent itself, not by a human. Does not address the "AX as product telemetry" use case.
- **Fit:** Conceptually foundational — proves that LLMs can produce useful self-assessments. But the AI Insights workflow is not a retry loop; it is a sequential pipeline. The insight is: *verbal self-reflection works*, so AX feedback is feasible.

### Pattern 3: LLM-as-a-Judge (Self-Evaluation)

- **Description:** Use an LLM to evaluate the quality of its own output (or another LLM's output) using structured rubrics. Score outputs on dimensions like helpfulness, correctness, harmlessness. Used for RLHF reward modeling and evaluation pipelines.
- **Where used:** Self-Rewarding Language Models (Yuan et al., 2024 — ICML), Anthropic Constitutional AI, OpenAI evals. Common in production evaluation pipelines.
- **Strengths:** Scalable. Can be structured with rubrics. Can score multiple dimensions. No human bottleneck.
- **Weaknesses:** Self-evaluation bias — models tend toward positive self-assessment. Calibration is non-trivial. Rubric quality determines output quality. Cannot report on things the model is unaware of (unknown unknowns).
- **Fit:** Directly applicable. AX feedback is essentially LLM-as-a-judge applied to *process quality* rather than *output quality*. The rubric would target friction, clarity, tool usability, and information sufficiency rather than answer correctness.

### Pattern 4: Post-Mortem / Retrospective (Human Software Teams)

- **Description:** After a project sprint or incident, team members answer structured questions: "What went well? What didn't? What should we change?" The retrospective is a dedicated ceremony with its own time-box.
- **Where used:** Agile/Scrum retrospectives, incident post-mortems, blameless post-mortems (Google SRE).
- **Strengths:** Proven method for surfacing process friction. Structured but flexible. Action-item oriented. Time-bounded.
- **Weaknesses:** Requires honest participation (not a concern for LLMs). Can devolve into vague feedback without good facilitation. Recency bias — recent pain is over-reported.
- **Fit:** Excellent conceptual fit. The AI Insights workflow already has a "retrospective" agent (Synthesis). Adding structured retrospective questions is a natural extension.

### Pattern 5: Embedded Self-Assessment (Per-Step Confidence)

- **Description:** Each agent appends a structured self-assessment to its handoff data after completing its work. Captures confidence level, difficulties encountered, and information gaps — while the agent still has full context.
- **Where used:** Not widely formalized in multi-agent frameworks. Some custom implementations in enterprise RAG pipelines where retrieval agents report confidence alongside their results.
- **Strengths:** Captures experience at the moment of highest context. Distributed — no single bottleneck. Per-agent granularity allows pinpointing which persona needs improvement.
- **Weaknesses:** Adds latency and tokens to every stage. Agents may lack self-awareness about their own friction points. Risk of noise if every agent generates AX data for every run.
- **Fit:** Good granularity, but adds overhead to all 9 agents. Could be combined with Pattern 4 (retrospective) by having Synthesis aggregate per-agent assessments that are embedded in handoff data.

## Alternative & Creative Approaches

### Approach A: Shared AX Partial — Universal Pre-Handoff Reflection (Recommended)

Create a shared partial (`personas/shared/partials/ax-feedback.md`) that is included in **every agent's persona** as the penultimate step — right before the `AGENT: X / STATUS: COMPLETE` handoff block. Every agent, regardless of type, gets a brief self-reflection step.

The partial adapts to the agent's context through two tiers:

**Tier 1 — Lightweight (curators, support agents):** ~100–150 output tokens. The agent answers 2–3 targeted questions and emits a compact structured block at the end of its response.

**Tier 2 — Full (Developer, Synthesis, multi-step workflows):** ~200–400 output tokens. The agent answers 4–5 targeted questions with richer context and may include friction point details.

The tier is determined by a metadata flag in the persona YAML (e.g., `ax_tier: light | full`), or simply by having two variants of the partial with a conditional include.

**Mechanism:**
- The shared partial provides the reflection prompt and output format.
- The agent writes an `## AX Feedback` block in its final response (visible in the chat/dialogue).
- For ledger agents, the feedback is also optionally persisted via `ledger_add_project_comment` with `type: 'ax-feedback'`.
- For standalone/support agents without MCP access, the chat output *is* the record — the operator (or a future aggregation script) can collect them.

**Rationale:** One partial, all agents. The persona build system's shared partial mechanism makes this trivially deployable across the entire ecosystem without duplicating logic. Every agent reflects while it still has full context of what it just did.

**Risk:** Some curators do very simple work where AX feedback is almost always "no friction." The sparsity expectation (see Prompt Design) mitigates this — a "nothing to report" response is ~20 tokens.

### Approach B: Synthesis-Only Retrospective (Ledger Workflow Only)

Add a dedicated AX feedback step to the Synthesis persona, between step 7 (cross-cutting observations) and step 8 (knowledge collection). Synthesis already reads all WP data, pipeline results, and handoff notes.

**Rationale:** Centralizes AX collection in one agent. No changes to agents 1–8. Synthesis has the richest cross-agent context.

**Risk:** Only covers the ledger workflow. Standalone agents (Planner, Developer, Documentation Curator) and all support/curator agents are excluded. Synthesis assesses *other agents'* experience from artifacts, which means it can only see friction that left traces in handoff data — not friction that the agent experienced internally. Does not address the stated goal of giving *all* agents the opportunity to self-report.

### Approach C: Passive AX Inference from Existing Signals

Derive AX metrics computationally from signals the system already captures:

- **Rework rate:** How many pipelines failed and were reworked? (Available in WP data)
- **Error frequency:** `stage_error` count from orchestrator logs
- **Token inflation:** Abnormally high token usage for a stage suggests struggle/retries
- **Duration outliers:** Stage duration far above baseline suggests friction
- **Handoff completeness:** Parse handoff notes for "insufficient," "missing," "unclear" language

**Rationale:** Zero additional token cost. Uses existing data. Can be computed post-run.

**Risk:** Only works for orchestrator-run ledger workflows (JSONL logs don't exist for IDE-invoked standalone agents). Captures *symptoms* but not *causes*. A high rework rate tells you something went wrong but not whether the friction was in the persona instructions, the tool API, or the codebase.

### Approach D: Dedicated AX Auditor Agent

A new agent whose sole purpose is AX analysis. Could be invoked manually after any session, or automatically after ledger workflow completion. Reads available artifacts (synthesis reports, chat logs, JSONL logs) and produces a structured AX audit.

**Rationale:** Clean separation of concerns. Specialized prompt optimized for friction detection. Can be run selectively.

**Risk:** Highest cost. Another persona to maintain. For standalone/curator agents, the "artifacts" to audit are just the chat dialogue — the auditor would need the full conversation log, which is not always accessible post-session.

### Approach E: Hybrid — Universal Partial (A) + Passive Metrics (C)

Combine Approach A's shared partial (every agent self-reports) with Approach C's computed metrics (for orchestrator runs). This gives:
- First-person AX feedback from every agent type (A)
- Objective validation data for ledger workflow runs (C)
- No blind spots: standalone agents report directly, ledger agents both report and get verified by metrics

**Risk:** Slightly higher implementation effort than A alone, but the passive metrics are a separate concern that can be added independently.

## Comparative Evaluation

| Criterion | A: Shared Partial | B: Synthesis-Only | C: Passive Inference | D: AX Auditor | E: Hybrid (A+C) |
|---|---|---|---|---|---|
| **Agent coverage** | ALL agents | Ledger only (9) | Orchestrator only | Selective | ALL + orchestrator metrics |
| **Signal richness** | High — first-person | Medium — inferred | Low — symptoms only | High — dedicated | High — first-person + objective |
| **Token cost** | Low–Med (~50–400/agent) | Low (~200–500 total) | Zero | High (~2000+) | Low–Med |
| **Implementation** | Low — one shared partial | Low — one persona edit | Medium — script/dashboard | High — new persona | Low–Med |
| **Unknown-unknowns** | Low — agents may lack self-awareness | Very low — second-hand | Low — only logged signals | Medium | Low |
| **Noise risk** | Medium — mitigated by sparsity expectation | Low | Low | Low | Medium |
| **Actionability** | High — per-agent, categorized | Medium — cross-agent only | Low — needs interpretation | High | High |
| **Maintenance** | Minimal — one partial | Minimal — one persona | Low — script | High — new persona | Low |
| **Works for IDE sessions** | Yes | No (ledger only) | No (orchestrator only) | Partially | Yes + orchestrator |

## Recommendation

**Pursue Approach A (Shared AX Partial) as the primary mechanism, with Approach C (Passive Inference) as an independent augmentation for orchestrator runs.**

### Why Universal Self-Report Wins

1. **Coverage is the deciding factor.** The user runs standalone curators, standalone planners/developers, and ledger workflows. Any approach that only covers one category misses the majority of agent sessions. A shared partial covers *all* of them with a single implementation.

2. **First-person beats third-party.** Synthesis assessing other agents' friction from artifacts is inherently limited — it can only see what left traces. An agent that just struggled with an ambiguous persona instruction knows it struggled. That signal is lost by the time Synthesis reads the WP data.

3. **The persona build system makes this cheap.** Shared partials are a first-class feature of `@mistralys/persona-builder`. One file in `personas/shared/partials/` gets included in every persona at build time. No per-persona copy-paste. Updates propagate automatically.

4. **The universal handoff block is the perfect insertion point.** Every single agent — ledger, standalone, support — ends with `AGENT: X / STATUS: COMPLETE`. Inserting a reflection step immediately before this block is architecturally clean and doesn't disrupt any existing workflow logic.

5. **Graceful degradation.** If an agent has nothing to report, the output is ~20 tokens ("No friction encountered."). The cost is negligible for smooth runs and only becomes substantial when there's something worth reporting.

### Proposed Data Model

Two tiers, same schema structure, different expected depth:

```yaml
# AX Feedback — emitted by every agent at end of session
ax_feedback:
  agent: string                    # agent name/role
  session_type: ledger | standalone | support
  overall_friction: none | low | medium | high
  
  # 0–3 friction points (most sessions: 0)
  friction_points:
    - category: tooling | context | instructions | handoff | codebase | other
      severity: low | medium | high
      description: string          # one-sentence, evidence-anchored
      suggestion: string | null    # optional improvement idea
      
  # Optional: what went well (only if genuinely noteworthy)
  positive_note: string | null
```

**Categories explained:**
- `tooling` — MCP tool / IDE tool was confusing, had unexpected behaviour, or was missing a needed capability
- `context` — insufficient information in project manifest, AGENTS.md, plan, or workspace documentation
- `instructions` — persona instructions were unclear, contradictory, or missing a needed scenario
- `handoff` — data passed from a previous agent was incomplete or ambiguous (ledger workflow only)
- `codebase` — the target codebase caused unexpected difficulty (not the agent system's fault, but worth tracking for context)
- `other` — friction that doesn't fit the above categories

### Output Format in Agent Response

The shared partial would instruct agents to emit a block like this at the end of their response, before the status handoff:

**Tier 1 (lightweight — most curators/support agents):**
```
---
## AX Feedback
No friction encountered.
---
AGENT: README Curator
STATUS: COMPLETE
```

Or, when there is something to report:
```
---
## AX Feedback
**Friction:** medium
- **instructions / medium:** The persona instructions don't cover the case 
  where README.md doesn't exist yet but AGENTS.md does. I had to infer the
  correct behaviour. → Consider adding a "missing README" scenario.
---
AGENT: README Curator
STATUS: COMPLETE
```

**Tier 2 (full — Developer, Synthesis, complex workflows):**
```
---
## AX Feedback
**Friction:** low
- **context / low:** The project manifest's api-surface.md was slightly out
  of date for the `parseConfig()` function signature. I verified against 
  source before proceeding. → Flag for Manifest Curator update.
**Positive:** The AGENTS.md navigation reference saved significant time 
finding the right source files.
---
AGENT: Standalone Developer
STATUS: COMPLETE
```

### Storage & Aggregation

**Immediate (Phase 1):** The AX feedback block lives in the agent's chat response. For IDE sessions (VS Code, Claude Code), it is visible in the conversation. For orchestrator runs, it appears in the agent's output captured in the JSONL log. No new storage infrastructure needed.

**Near-term (Phase 2):** For ledger workflow agents, the feedback is also persisted via `ledger_add_project_comment` with `type: 'ax-feedback'`. This makes it queryable within the project ledger.

**Future (Phase 3):** A lightweight aggregation script reads AX feedback from multiple project ledgers and/or orchestrator logs, producing a trend report: "Top friction categories across the last 20 runs", "Agents with highest friction frequency", etc. This is the longitudinal analysis layer.

### Proof-of-Concept Outline

1. **Create `personas/shared/partials/ax-feedback.md`** with the reflection prompt, output format, and sparsity expectations.
2. **Include the partial in 3–5 test personas** across all three categories:
   - Ledger: Developer (agent 3) and Synthesis (agent 9)
   - Standalone: Developer (Standalone)
   - Support: README Curator, Changelog Curator
3. **Run 5–10 sessions** across these agents and evaluate:
   - Are friction reports specific and actionable, or generic/formulaic?
   - Does the "no friction" default work (agents don't manufacture issues)?
   - Is the token overhead acceptable?
   - Do the friction categories cover the actual issues encountered?
4. **Iterate on the partial** based on output quality. Tighten prompts if reports are vague; adjust categories if real friction doesn't fit.
5. **Roll out to all personas** once the partial is validated.

### Prompt Engineering Considerations

The quality of AX feedback depends heavily on prompt design. Key principles:

- **Ask specific questions, not open-ended ones.** "Did you encounter any situation where your persona instructions did not cover the scenario you faced?" beats "How was your experience?"
- **Anchor to observable evidence.** "Cite the specific instruction, tool, or data that caused friction" forces grounded responses and prevents vague complaints.
- **Provide the category taxonomy.** Don't let the agent invent categories — constrain to `tooling | context | instructions | handoff | codebase | other`.
- **Set expectations for sparsity.** "Most sessions should have zero friction points. Only report friction that was genuine and specific — not theoretical improvements." This is the single most important design choice. Without it, agents will manufacture friction to seem thorough.
- **Distinguish friction from feature requests.** "Report friction you *actually experienced*, not improvements you *imagine* might help." Agents are inclined to be helpful by suggesting improvements; the AX mechanism should capture pain, not wishlists.
- **Make "nothing to report" the happy path.** The default is zero friction. The prompt should make clear that reporting nothing is expected and correct for most sessions.
- **Include a positive signal option (sparingly).** Allowing agents to note what worked well provides calibration signal — if an agent reports "AGENTS.md navigation was very helpful" alongside "manifest was outdated", the positive signal confirms the agent is actually evaluating its experience rather than mechanically filling a template.

## Open Questions

- **Calibration baseline:** What does "normal" friction look like? The first 10–20 sessions with AX feedback will establish a baseline. Initially there will be no reference point, so early reports should be read qualitatively (is this specific and actionable?) rather than quantitatively (is this friction level unusual?).
- **Self-assessment reliability for process vs. output:** Research shows LLMs are reasonably calibrated on output quality self-assessment (e.g., Self-Rewarding LMs). Their calibration on *process quality* self-assessment is less studied. The shared partial approach tests this directly — if agents consistently produce generic or formulaic feedback, the mechanism needs tighter prompting or a different approach.
- **Feedback loop closure:** How does AX feedback translate into persona improvements? Phase 1 is manual: the operator reads AX reports and edits personas. Phase 2 could be semi-automated: a trend-analysis script flags recurring friction categories, and the Persona Curator agent is prompted to address them. Full automation (AX data → persona refinement) is a longer-term aspiration.
- **Tier assignment heuristic:** Which agents get Tier 1 (lightweight) vs. Tier 2 (full) AX feedback? The initial proposal is simple: curators and single-task support agents get Tier 1; Developer, Synthesis, and multi-step standalone agents get Tier 2. But this may need adjustment based on which agents actually produce the most valuable feedback.
- **Cross-run trend analysis:** Individual AX reports are useful, but the highest value emerges from comparing friction across many sessions and agent types. The Phase 3 aggregation script should be designed once enough data exists to know what patterns are worth tracking.
- **Partial inclusion strategy:** Should the AX partial be included in *every* persona unconditionally, or gated by a feature flag in persona YAML metadata? A feature flag (`ax_feedback: true | false`) allows gradual rollout and opt-out for agents where AX feedback is consistently empty, but adds a configuration surface. The unconditional approach is simpler and the "nothing to report" output is cheap.

## References

- Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., & Yao, S. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning.* NeurIPS 2023. [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)
- Yuan, W., Pang, R.Y., Cho, K., et al. (2024). *Self-Rewarding Language Models.* ICML 2024. [arXiv:2401.10020](https://arxiv.org/abs/2401.10020)
- [Langfuse — Open-source LLM observability](https://langfuse.com/docs) — Tracing, evaluation, and prompt management for LLM applications.
- [LangSmith — LangChain observability](https://docs.langchain.com/langsmith/observability) — Tracing, monitoring, and evaluation platform.
- [Braintrust — Active observability for agents](https://www.braintrust.dev/docs) — Instrumentation and evaluation platform.
- Agile Retrospectives (Derby & Larsen, 2006) — foundational reference for structured team reflection ceremonies.
