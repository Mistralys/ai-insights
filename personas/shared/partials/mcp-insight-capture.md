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
