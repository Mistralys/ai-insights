#### Refinement Pass Label

A plan is often refined more than once, by a different model each time. The `## Plan Audit Cycles` counters stay attributable across those passes by carrying a per-model tally beside the total:

```markdown
## Plan Audit Cycles
- Audits: 4 (Sonnet 4.6 ×2, GPT-5.6 ×2) — {{agent_plan_auditor}}
- Architectural Reviews: 2 (Sonnet 4.6 ×1, GPT-5.6 ×1) — {{agent_plan_architect_reviewer}}
```

The section keeps its two lines however many passes run. A line grows only when a model new to the plan joins the tally.

The **pass label** is the model driving the refinement session — the one the user selected when starting the refinement, not the models its sub-agents run under. Its form is the model family and its major version, with the host left out: `Sonnet 4.6`, `Opus 4.6`, `GPT-5.6`, `Gemini 3.6`. The same model reached through a different host carries the same label, so a Copilot-hosted Sonnet 4.6 pass and an Anthropic-hosted one share a tally.
