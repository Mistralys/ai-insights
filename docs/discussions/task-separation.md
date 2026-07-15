# Why LLMs Make Mistakes — and How Task Separation Fixes It

A summary of practical insights into how large language models work, why they produce errors even when instructed not to, and a structural technique that measurably improves output quality.

---

## The core problem: LLMs can't go back and fix what they already wrote

Large language models generate text one word at a time, always moving forward. Once a sentence is written, the model cannot revise it — even if information it encounters later contradicts what it said earlier. This is called **autoregressive generation**, and it has a fundamental consequence: the model cannot reliably catch its own mistakes.

This is not a matter of the model being "not smart enough." Academic research (Kambhampati et al., ICML 2024) has formally demonstrated that self-verification is an architectural limitation of how these models work. Telling a model to "double-check everything" helps marginally, but it cannot eliminate the problem — the model is still generating its checks in the same forward-only stream.

**Practical implication:** If you need reliable output from an LLM, build a review step into your process. Have a separate pass (or a separate agent) verify the output. This is not a workaround — it is the correct architecture.

---

## Why mixing research and writing degrades quality

When you ask an LLM to gather information and produce a deliverable at the same time — for example, researching a topic while writing a report — three failure modes emerge:

### 1. Premature commitment

The model starts forming conclusions before it has all the facts. Because it cannot revise earlier output, it bends later findings to fit what it already wrote rather than updating its position. In practice, this looks like the model ignoring contradictory evidence or making claims that don't quite match the data.

**Analogy:** Writing an essay while still in the library. You write your thesis after reading one book, then skim the remaining sources looking for confirmation rather than reading them with an open mind.

### 2. Attention decay over distance

LLMs have a limited ability to recall information from earlier in a conversation. Facts gathered at the start of a long session carry less weight by the time the model reaches the final sections of its output. This is a well-documented property of transformer architectures — information in the middle of a long context receives the least attention.

**Analogy:** Reading ten reports in sequence, then writing a summary from memory. The first few reports are fuzzy by the time you start writing.

### 3. Forward momentum bias

When the model reads a piece of information, it feels implicit pressure to use it immediately — to justify the effort of retrieving it. This causes premature design decisions: the model incorporates each finding as it arrives, rather than waiting until it has the complete picture before making choices.

**Analogy:** A chef who starts cooking each ingredient as it arrives from the market, rather than waiting for all the ingredients before deciding on the recipe.

---

## The fix: separate research from production

The most effective structural improvement is to split any complex LLM task into distinct phases where each phase has one job:

### Phase 1 — Scope

Identify *what areas* the task touches. This is a classification task — the model is excellent at it and almost never gets it wrong. The output is a short bullet list, not a plan or a design.

### Phase 2 — Research

For each area identified in Phase 1, gather and verify the relevant facts. Record them in a compact brief. No decisions are made in this phase — it is purely about collecting verified information.

### Phase 3 — Produce the deliverable

With all verified facts consolidated in a nearby, compact document, the model now writes the actual output. Every claim it makes can draw from the research brief rather than from memory or guesswork.

### Why this works

- **No premature commitment.** The model makes no decisions until it has all the facts.
- **No attention decay.** All verified facts are consolidated in a compact artifact close to where the model needs them — not scattered across a long conversation history.
- **No forward momentum bias.** The research phase has no obligation to produce decisions, so the model reads with genuine openness rather than looking for confirmation.

This is the same principle behind how humans work effectively: gather your materials first, then write. The difference is that for LLMs, this separation is not just a best practice — it directly addresses architectural limitations of how the technology works.

---

## The broader principle: task homogeneity

The research-then-produce pattern is a specific case of a more general principle: **LLMs perform better when each phase of work involves a single type of cognitive task.**

Human psychology research calls this "task switching cost" — performance degrades when alternating between different types of work, even when each task is individually simple. LLMs have an analogous limitation, though the mechanism differs. For humans, the cost is working memory reloading. For LLMs, it is that each word is conditioned on everything before it — so when the model switches between "gathering facts" mode and "making decisions" mode, the reasoning styles bleed across boundaries. The model starts making decision-flavored assertions during what should be pure fact-gathering, or hedges its conclusions with discovery-flavored uncertainty when it should be committing.

Homogeneous phases eliminate this bleed. Each phase has one job and one success criterion.

---

## Key takeaways

1. **LLMs cannot reliably self-verify.** This is architectural, not a capability gap. Always build external review into your process.

2. **Separate research from production.** When asking an LLM to produce complex work, split the task into a fact-gathering phase and a writing phase. This eliminates premature commitment, attention decay, and forward momentum bias.

3. **Keep phases homogeneous.** Each phase should involve one type of thinking. Mixing discovery and decision-making in the same step degrades both.

4. **Show the model what to avoid.** Models respond better to concrete examples of past mistakes ("don't do X — here's what it looked like") than to abstract instructions ("be careful" or "verify everything").

5. **Better models don't eliminate the need for structure.** Future models will produce better first drafts, but the architectural limitations of autoregressive generation mean that verification loops and phase separation will continue to add value.
