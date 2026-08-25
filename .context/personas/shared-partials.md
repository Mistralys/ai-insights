# Personas - Shared Partials
<INSTRUCTION>
# Personas - Shared Partials
Cross-suite Markdown partials shared between ledger and standalone suites: operational protocols, output format standards, and incident logging conventions.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Cross-suite Markdown partials (operational protocols, output formats, incident logging)_
# Cross-suite Markdown partials (operational protocols, output formats, incident logging)
```
// Structure of documents
└── personas/
    └── shared/
        └── partials/
            └── agent-roster.md
            └── ax-feedback.md
            └── incident-logging.md
            └── insight-capture.md
            └── insight-compilation.md
            └── mcp-insight-capture.md
            └── pm-subagent-roster.md
            └── summary-crafting-guide.md

```
###  Path: `/personas/shared/partials/agent-roster.md`

```md
You operate within a larger agentic workflow:

{{roster_rendered}}

```
###  Path: `/personas/shared/partials/ax-feedback.md`

```md
## AX Feedback

Before the final handoff, report any genuine friction you encountered with your tooling, instructions, context, handoff data, or the target codebase. **Most sessions are expected to have zero friction.**

**Format** (emit immediately before the handoff status block):

```
---
## AX Feedback
{Either "No friction encountered." OR up to 3 bullet points:}
- **{category} / {severity}:** {One sentence citing specific evidence.}
  → {Optional: concrete improvement suggestion.}
```

```
###  Path: `/personas/shared/partials/incident-logging.md`

```md
If you encounter a system-level issue that is not caused by your own mistake (e.g., terminal output not visible, tool returning unexpected errors, file operations silently failing), note it clearly in your response and describe any workaround you found. Do not investigate root causes beyond what is needed to continue.
```
###  Path: `/personas/shared/partials/insight-capture.md`

```md
### Incremental Insight Capture

#### Step 1 — Open the sink at session start

Before your first substantive action, resolve the sink path and create the file:

1. Plan-driven session (`plan.md` is present in the working folder, or a plan folder path was supplied by the pre-flight): `{plan folder}/insights.jsonl`.
2. Otherwise: `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl` relative to the repository root (create the directory if absent). Derive `{slug}` from the same source you use to title your report to guarantee consistent naming.

Write a marker line on file creation. If the file already exists, append your marker — do not overwrite earlier agents' entries.

```jsonl
{"agent": "{{insight_agent}}", "type": "session-start", "priority": "low", "loc": "-", "text": "Ignore — bookkeeping marker, not a finding."}
```

#### Step 2 — Append at every gate during the work

Your Operational Protocol names the gate for your role: an observable action you actually take — a file edited, a test run, an audit area finished, a document updated. On completing one, append the observations it surfaced *before* starting the next. If an action surfaced nothing, append nothing.

Append exactly one flat JSON line per observation, at the moment you notice it:

```jsonl
{"agent": "{{insight_agent}}", "priority": "medium", "type": "code-smell", "loc": "src/utils/parser.ts", "text": "Parser mixes validation and transformation — extract a validate() step."}
```

| Field | Value |
|---|---|
| `agent` | Always `{{insight_agent}}` |
| `priority` | `high` / `medium` / `low` |
| `type` | From your observation type vocabulary (lowercase kebab-case) |
| `loc` | File path, module, or component the observation concerns |
| `text` | Specific and actionable — state what could be done. Markdown-enabled, and can be as detailed as needed |

#### Constraints

- **Append-only sink.** Never re-read, edit, truncate, or reorganise the file mid-session.
- **Never overwrite or truncate an existing sink.**
- **Gate on actions, not judgment.** Tie appends to observable actions (file edit, test run, document saved) — never to self-assessed boundaries like "when I have enough." Self-assessed boundaries produce zero appends — the moment never feels right, so the write never fires.
- **No observation hoarding.** Write each observation before starting the next gated action. Never let findings accumulate unwritten across multiple actions.
- **Sink failures do not block work.** If an append fails, capture the observation in your report instead. Never let the sink interrupt your primary task.

```
###  Path: `/personas/shared/partials/insight-compilation.md`

```md
### Compiling from the Insight Sink

When writing the report, read every entry in `insights.jsonl` from the resolved sink path. The aim is to compile {{insight_report_target}} from these entries.

**Curation rules:**

- Deduplicate across agents: when multiple agents recorded the same finding, treat the corroboration as a priority signal — elevate the merged entry's priority accordingly, collapse it into a single entry, and note the corroboration (e.g., "also flagged by QA").
- Refine wording and confirm priorities for the remaining entries.
{{#if insight_consumer_only}}
- Group entries by `agent` first, then by priority within each group.
{{else}}
- Surface high-priority findings first; within the same priority, group by type.
{{/if}}
- Attribute an entry to the agent that recorded it whenever the origin adds weight or context to the finding.

{{#if insight_consumer_only}}
**Sink state handling:** This agent is a consumer-only compiler — it never writes to the sink, so it has no `session-start` marker of its own. Check each contributing agent's marker individually: if an agent that participated in this project has no `session-start` marker, note that its insight capture did not run rather than implying it found nothing.
{{else}}
**Sink state handling:** Use the `{{insight_agent}}` `session-start` marker to distinguish the sink states below — reporting a skipped duty as a clean result destroys the sidecar's value.

| What the sink contains | What it means | What to report |
|---|---|---|
| A `{{insight_agent}}` marker, plus entries from any agent | Capture ran and produced material | Every entry, curated per the rules above |
| A `{{insight_agent}}` marker, and no observations from any agent | Capture was live and genuinely found nothing | A single `improvement` observation confirming the material covered was clean |
| No `{{insight_agent}}` marker at all, or the file is missing | Capture never ran — the duty was skipped this session | Say so explicitly: record a single `improvement` observation stating that incremental capture did not run, so this report's insights are incomplete. Still compile whatever other agents contributed. |
{{/if}}

#### Constraints

- **No silent data loss.** Never silently discard unparseable lines — treat them as free-text observations and salvage their content.
- **No back-filling from memory.** When capture did not run (no `{{insight_agent}}` marker), report the gap honestly. Do not reconstruct observations from recall — back-filled insights omit everything that was only salient in the moment, which is precisely what the sink exists to preserve.
- **No empty sections.** Every compilation produces at least one observation — either curated findings or an honest gap note per the forcing function table.

```
###  Path: `/personas/shared/partials/mcp-insight-capture.md`

```md
### MCP Insight Capture Discipline

After each observable action defined by your operational protocol's capture step, call `ledger_add_observation` with the current work package:

| Parameter | Value |
|---|---|
| `work_package_id` | Current WP ID |
| `pipeline_type` | `"{{insight_pipeline_type}}"` |
| `type` | From your observation type vocabulary (lowercase kebab-case) |
| `priority` | `high` / `medium` / `low` |
| `note` | Specific and actionable — state what could be done |
| `loc` | File path, module, or component the observation concerns |

**Action-gate rule:** Call once per observable action — do not batch observations from multiple actions into a single call. If an action surfaced nothing, make no call.

**Fallback on failure:** If the call fails, retry once. If it still fails, note the pending observation (type, priority, one-line description) in a short per-session scratch list and fold every pending item into your `ledger_complete_pipeline` comments at pipeline completion. Do not rely on unaided end-of-session recall for failed calls.

```
###  Path: `/personas/shared/partials/pm-subagent-roster.md`

```md
You are a sub-agent of the **Project Manager** (Technical Program Manager). You operate as one step in a 4-stage decomposition pipeline:

1. **{{agent_ledger_wp_decomposer}}** — Breaks the plan into atomic Work Package definitions
2. **{{agent_ledger_dependency_sequencer}}** — Maps dependencies and determines execution order
3. **{{agent_ledger_pipeline_configurator}}** — Assigns pipeline stages to each Work Package
4. **{{agent_ledger_bootstrapper}}** — Initializes the project ledger with all Work Packages

Your input comes from the previous stage. Your output feeds into the next stage.
```
###  Path: `/personas/shared/partials/summary-crafting-guide.md`

```md
- **Factual and concise** — describe what the project does and why, not how it is implemented
- **Plain text only** — no Markdown formatting (no bold, bullets, backticks, or headers)
- **Focused on intent** — avoid implementation details, tool names, and technical specifics unless essential to understanding the project's purpose

```