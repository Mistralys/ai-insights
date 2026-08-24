### Incremental Insight Capture

Resolve the sink path **once** at session start, then use it for the entire session:

1. If the session is plan-driven (`plan.md` is present in the working folder, or a plan folder path was supplied by the pre-flight), write to `{plan folder}/insights.jsonl`.
2. Otherwise, write to `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl` relative to the repository root (create the directory if absent). Derive `{slug}` from the same source you use to title your report — never invent a new slug.

**Entry format** — append exactly one flat JSON line per observation, at the moment you notice it:

```jsonl
{"agent": "{{insight_agent}}", "priority": "medium", "type": "code-smell", "loc": "src/utils/parser.ts", "text": "Parser mixes validation and transformation — extract a validate() step."}
```

| Field | Type | Allowed values |
|---|---|---|
| `agent` | string | `{{insight_agent}}` (always use this value) |
| `priority` | string | `high` / `medium` / `low` |
| `type` | string | From your observation type vocabulary (lowercase kebab-case) |
| `loc` | string | File path, module, or component the observation concerns |
| `text` | string | Specific and actionable — state what could be done |

**Rules:** Append-only — never re-read, edit, or reorganise the file mid-session. Duplicates across agents are welcome (independent corroboration). If an append fails, continue working and capture observations in your report instead — never let the sink block your primary task. The file is generated working evidence; retain it in the plan folder after your report is written.
