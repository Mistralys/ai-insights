> Question: I have a semi-philosophical question for you. When creating plans with my planner agent, I found out that the first iteration of the plan always has minor to critial errors, and sometimes even architectural issues. 

> To fix this, I have created the small plan refiner workflow which puts a plan through an architectural review, and up to three technical audits. 

> This works very well: I have seen the implementation quality increase drastically.

> Still, I wonder if there are ways to make sure that the original plan starts off more accurate than it currently is. The planner agent already knows that it should verify everything, but that still does not prevent these mistakes, even if I exclusively use Claude Opus to create the plans.

> It is quite possible that the current models are not advanced enough to do better.

> What do you think, any ideas / thoughts? 

Good question. Let me dig deeper into the Planner's actual instructions and research known patterns for improving first-pass generation quality.

Here's the executive summary:

**Your Plan Refiner already implements the research-backed approach.** Kambhampati et al. (ICML 2024) formally argue that autoregressive LLMs *cannot* reliably self-verify — external verification loops are necessary, not a workaround. Your architecture is the LLM-Modulo pattern. The errors you see in first drafts are the expected behaviour of any generator in such a system.

That said, three interventions can raise the first-pass baseline:

1. **Error-Pattern Priming** (zero cost) — Distill the top 5–10 recurring errors from past audit findings into a compact "anti-patterns" section in the Planner persona. Models are better at avoiding demonstrated failures than following abstract "verify everything" instructions.

2. **Research → Plan split** (highest impact) — The current workflow intermixes codebase research (steps 3–5) with plan writing (steps 6–8). Restructuring so the research phase produces a verified **Fact Sheet** (confirmed file paths, API signatures, applicable patterns) *before* plan writing begins converts planning from an open-ended generation task into a constrained assembly task. The model is much better at assembling from verified inputs than at discovering and composing simultaneously.

3. **Knowledge-base seeded context** (compounding returns) — Query `ledger_search_insights` for planning anti-patterns at the start of every session, injecting accumulated experience into the planning context.

**On model limitations:** The issue is architectural (autoregressive generation can't backtrack), not capability-based. Even with better models, your generate-then-verify loop will remain valuable. Better models will produce better first drafts — but the verification pipeline will keep adding value.

---

> Question: Regarding the research > plan split, how would you propose to do this? It makes a lot of sense, but I don't quite see how to do the research before the plan. I would have to start off every plan with a lightweight project description?


Good question — there's a chicken-and-egg feel to it, but the key insight is that **scoping is much cheaper than planning**. You don't need a plan to know what to research. You need a *scope sketch* — which is a far simpler cognitive task that models handle reliably.

Here's the concrete shape:

### The Planner's workflow becomes three phases, not two passes

**Phase 1: Scope (3–5 minutes, minimal error risk)**

After reading the user request, the Planner produces a lightweight scope sketch — not architecture, not a plan, just an inventory of *what areas of the codebase this request touches*:

```markdown
## Scope Sketch

Request: "Add pipeline-level comments to work packages"

Areas involved:
1. WP detail schema (mcp-server/src/storage/) — adding a comments field
2. MCP tool handlers — new tool or extension of existing tool
3. Type definitions — WP detail interface changes
4. Test infrastructure — existing WP tests to extend
5. Persona templates — if any persona references pipeline comments
```

This takes a few lines and is almost impossible to get wrong — the model is just categorizing the request, not designing anything.

**Phase 2: Research (targeted, per-area)**

For each area in the scope sketch, the Planner does focused, verifiable research:

- Read the actual files (not recall them from training data)
- Record verified paths, function signatures, type shapes, and existing patterns
- Note constraints from manifests/AGENTS.md that apply

The output is a **Research Brief** — essentially a fact sheet appended to the scope sketch:

```markdown
## Research Brief

### Area 1: WP detail schema
- File: mcp-server/src/storage/ledger-store.ts (L142–L180)
- Current WP detail shape: { id, title, status, pipelines: [...], handoff_notes }
- No existing comments field
- Pattern: comments already exist at project level via ProjectMeta.comments (mcp-server/src/types/project.ts L45)

### Area 2: MCP tool handlers
- Existing comment tool: ledger_add_project_comment (mcp-server/src/tools/comments.ts)
- Signature: (slug, comment, author?) → void
- Pattern to follow: same structure, different scope
...
```

**Phase 3: Plan (constrained assembly)**

Now the Planner writes the plan, drawing from the Research Brief. Every file path, every API reference, every pattern citation comes from verified Phase 2 output. If the Planner needs to reference something not in the brief, it must go verify it first.

### Why this works

The current workflow is: *think about the architecture while simultaneously discovering the codebase*. That's cognitively similar to writing an essay while simultaneously doing the library research — you fill gaps with plausible-sounding guesses (hallucinations).

The split turns it into: *learn the terrain, then draw the map*. The Planner in Phase 3 isn't guessing at file paths or API shapes — it has them right there in its context from Phase 2.

### How to implement it in the persona

You wouldn't need a separate agent or a user-facing artifact. The Research Brief is an internal working document — the Planner produces it for itself *within the same session*, then writes the plan from it. The workflow steps would change from:

```
3. Gather strategy & project history (MCP)
4. Research the codebase
5. Search for insights
6. Guide user through refining
7. Produce the plan
```

To:

```
3. Produce a Scope Sketch (bullet list of areas the request touches)
4. For each area: research, verify, record findings → Research Brief
5. Gather strategy context & insights (MCP) → append to Research Brief
6. Confirm scope with user (optional, for complex plans)
7. Produce the plan from the Research Brief
```

The Scope Sketch is the lightweight project description you're asking about — but the user doesn't write it. The Planner infers it from the request. It's a 5-line categorization, not a design document. The model is excellent at this kind of classification task.

### Would this be a separate file or inline?

Either works. You could have the Planner write the Research Brief as a separate `research-brief.md` in the plan folder (auditable, reusable if the plan needs re-generation). Or it could be inline thinking that doesn't get saved — but having it as an artifact means the Plan Auditor could later verify that the plan's claims match the brief's verified facts, giving you a second layer of grounding assurance.


> Question: So for my understanding: Having this research be done in a separate step in itself will help the agent simply because it will not mix its thinking with research interspersed in it?

Exactly, but there are actually three distinct mechanisms at play:

**1. Cognitive mode separation.** When the model researches and plans simultaneously, it's doing two fundamentally different tasks in the same autoregressive stream: *discovery* (what exists?) and *design* (what should we build?). Design requires the model to hold an evolving architectural vision while also making tool calls and processing file contents. When a file read returns something unexpected, the model must reconcile it with the design it's already partially committed to in its output — and because autoregressive generation can't revise earlier tokens, it often just... doesn't. It papers over the conflict with a plausible-sounding claim. Separating the phases means the model is never in a position where it has to reconcile new facts with an already-written design.

**2. Context window freshness.** When research and planning are interleaved, the verified facts from early file reads are far away in the context by the time the model writes the later sections of the plan. The model's attention to those facts degrades with distance. With a Research Brief, all verified facts are consolidated into a compact artifact that sits close to the plan-writing phase in the context — the model has everything it needs in a tight, nearby window.

**3. Commitment pressure.** During interleaved research-and-planning, the model feels pressure to *use* what it just read — to justify the cost of the tool call by immediately incorporating the finding into the plan. This creates a "forward momentum" bias: the model reads a file, makes a design decision based on it, and moves on — even if a better decision would require reading two more files first. The Research Brief removes this pressure. Phase 2 is purely about collecting facts with no obligation to make decisions. Phase 3 can see *all* the facts before making *any* design choices.

So it's not just "don't mix thinking with research" — it's that the separation eliminates three specific failure modes: premature commitment to partially-informed decisions, attention degradation over long contexts, and the inability to revise earlier output when later facts contradict it.

> Question: Got it. So it's really about grouping similar tasks together, in order for the agent to fully concentrate on what it's supposed to be doing in each phase without distractions or memory issues.

Yes. And there's a useful analogy from human cognitive science: **task switching cost**. Decades of research show that humans perform measurably worse when alternating between tasks than when batching similar work — even when the tasks are individually simple. The cost isn't in the tasks themselves but in the context switch.

LLMs have an analogous problem, though the mechanism is different. For humans it's working memory reloading. For autoregressive models it's that each token is conditioned on everything before it — so when the model switches from "reading a file" mode to "designing architecture" mode and back, the reasoning style bleeds across boundaries. The model starts making design-flavored assertions during what should be pure fact-gathering, or hedges its architecture with discovery-flavored uncertainty when it should be committing to decisions.

Homogeneous phases eliminate that bleed. Phase 2 is pure fact-gathering: read, record, move on. Phase 3 is pure design: all facts are available, commit to decisions. Each phase has one job and one success criterion.


