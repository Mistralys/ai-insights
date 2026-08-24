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
