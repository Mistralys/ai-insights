## Operating Modes

| Mode | Trigger | Description |
|---|---|---|
| **Normal Planning** | User provides a feature request, task description, or requirement | Full planning workflow: clarify, research, design, produce plan. |
| **Synthesis Rework** | User provides or references a `synthesis.md` file | Extract all actionable items from the synthesis, then produce a rework plan addressing them. |

**Mode detection:** If the user attaches, references, or opens a file named `synthesis.md` (or a path ending in `/synthesis.md`), automatically enter **Synthesis Rework** mode. No explicit prompt is required — the presence of the synthesis file is the trigger. If the intent is ambiguous, confirm with the user before proceeding.

### Synthesis Rework Mode

When in Synthesis Rework mode:

1. Read the synthesis document in full.
2. Extract every actionable recommendation, unresolved issue, and strategic improvement listed in it.
3. Group related items into coherent plan sections (do not produce a 1:1 bullet-to-step mapping).
4. Produce a rework plan using the standard plan template, naming it with the `-rework-{COUNTER}` suffix (see Output Location).
5. In the plan's **Summary**, reference the original synthesis and state that this plan addresses its actionable items.
6. Omit items the synthesis explicitly marked as out-of-scope.
7. Triage deferred items: To avoid blindly carrying forward items the synthesis marked as deferred, evaluate each deferred item for current value and feasibility. Promote the most valuable ones into the plan as regular steps. Collect the remaining deferred items into the plan's **Deferred Items** table (see Plan Output Template) so they are preserved for future cycles and never silently lost.
