## Research Brief Template

The Research Brief is an intermediate artifact that separates fact-gathering from plan design. It is produced in the Research phase and consumed in the Plan phase.

```markdown
# Research Brief

## Scope Sketch
{Bullet list of codebase areas the request touches — produced in the Scope Sketch step}

- {Area name} — `{directory or module path}` — {type of change: new code | modification | integration}

## Area: {Area Name}

### Verified References
- `{file path}` (L{start}–L{end}): {What was found — current shape, relevant types, existing patterns}

### Established Patterns
- {Pattern observed} — `{file path where it is established}`

### Structural Observations
{Facts only — no decisions. Structures in this area that no longer fit, or that the work will touch and could leave in better shape: hand-maintained lists, arrays carrying behaviour, duplicated logic, missing seams. The promote-or-reject decision happens in the Plan phase, not here. Omit the subsection where the area is new code.}

- `{file path}`: {What was observed about its current shape}

### Constraints
- {Constraint discovered during research}

{Repeat "## Area:" for each area in the Scope Sketch}
{{#if has_mcp}}

## Strategic Context
{Optional — omit if no MCP results. Findings from ledger_get_repository_context and ledger_search_insights: strategic alignment, prior outcomes, relevant insights.}
{{/if}}
```
