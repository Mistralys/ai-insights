# Design Note: `subagents` Manifest Key

> **Status:** Proposal — not yet approved for implementation.
> **Date:** 2026-04-08
> **Related plan:** `2026-04-07-extensible-targets-deep-agents-rework-1`

## Problem

`orchestrator/src/config.py` maintains a static `STAGE_SUBAGENT_FILES` dict that maps graph stage names to their subagent persona file specs. This constant must be updated manually whenever:

- A stage gains or loses a subagent delegation.
- A subagent persona file is renamed or moved.
- A new stage is added that requires subagent support.

This creates an undocumented sync burden as subagent usage grows and is not covered by the existing manifest validation scripts.

## Proposed Schema Extension

Add an optional `subagents` array to each role item in `shared/workflow-manifest.json`:

```json
{
  "id": "pm",
  "name": "Project Manager",
  "number": 1,
  "orchestrating": true,
  "pipeline": null,
  "persona_file": "personas/ledger/claude-code/1-pm.md",
  "persona_file_deep_agents": "personas/ledger/deep-agents/1-pm.md",
  "subagents": [
    {
      "persona_file": "personas/standalone/deep-agents/wp-decomposer.md",
      "name": "WP Decomposer",
      "description": "Analyze a plan document and decompose it into atomic, actionable Work Package definitions."
    }
  ]
}
```

### JSON Schema addition (for `workflow-manifest.schema.json`)

```json
"subagents": {
  "type": "array",
  "description": "Subagent persona specs for stages that delegate sub-tasks. Empty array or omitted means no subagents.",
  "items": {
    "type": "object",
    "required": ["persona_file", "name", "description"],
    "additionalProperties": false,
    "properties": {
      "persona_file": {
        "type": "string",
        "minLength": 1,
        "description": "Relative path from workspace root to the subagent's persona file."
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "description": "Display name for the subagent."
      },
      "description": {
        "type": "string",
        "minLength": 1,
        "description": "Delegation guidance — what the subagent does and when to use it."
      }
    }
  }
}
```

## Migration Path

1. Add the `subagents` field to the schema as **optional** (do not add to `required[]`).
2. Populate `subagents` for the `pm` role with the existing WP Decomposer entry.
3. Update `orchestrator/src/config.py` to derive `STAGE_SUBAGENT_FILES` from the manifest:
   ```python
   STAGE_SUBAGENT_FILES: dict[str, list[dict[str, str]]] = {
       r["id"]: r["subagents"]
       for r in _roles
       if r.get("subagents")
   }
   ```
4. Add a validation check in `scripts/validate-workflow-manifest.js` confirming that every `subagents[].persona_file` path exists on disk.
5. Update `AGENTS.md` cross-system dependencies table to note the new sync point.

## Impact on `config.py`

- The `STAGE_SUBAGENT_FILES` constant becomes a 3-line manifest derivation instead of a manually maintained dict.
- No runtime behavior change — the shape of the data is identical.
- `subagents.py` continues to work unchanged since it reads from `STAGE_SUBAGENT_FILES` regardless of how it's populated.

## Risks

- **Optional field means old manifests still validate.** This is intentional — forward-compatible.
- **File existence check adds a validation step** but catches typos in persona paths that currently fail silently at orchestrator startup.

## Decision Required

Approve this design for implementation in a separate plan, or modify the schema shape before proceeding.
