# Plan

## Summary

Slim down the 8 orchestrator node user-turn prompts to remove identity declarations, workflow instructions, and MCP tool call guidance that duplicate (and potentially conflict with) the persona system prompts already injected via `system_prompt=persona_prompt`. The user-turn prompts should provide only the runtime context the persona cannot know: `project_path`, `wp_id`, and the `project_path`-injection safety warning.

## Architectural Context

The orchestrator creates Deep Agents via `create_stage_node()` in `orchestrator/src/nodes/__init__.py`. Each agent receives:

- **System prompt** — the full persona Markdown file (loaded via `src/utils/persona.py` from `personas/ledger/claude-code/`). These are comprehensive multi-thousand-line documents defining identity, mission, operational protocol, constraints, MCP tool usage, and handoff logic.
- **User prompt** — built by a per-stage `_build_*_prompt()` function in `orchestrator/src/nodes/{stage}.py`. These currently re-declare identity ("You are the X agent"), enumerate MCP tool call sequences, and prescribe workflow steps — all redundant with the persona.

The persona files are the canonical source of truth for agent behaviour. The user-turn prompt should provide immediate execution context, not re-teach the agent its role.

**Affected files:**

- `orchestrator/src/nodes/developer.py` — `_build_developer_prompt()`
- `orchestrator/src/nodes/qa.py` — `_build_qa_prompt()`
- `orchestrator/src/nodes/reviewer.py` — `_build_reviewer_prompt()`
- `orchestrator/src/nodes/security_auditor.py` — `_build_security_auditor_prompt()`
- `orchestrator/src/nodes/release_engineer.py` — `_build_release_engineer_prompt()`
- `orchestrator/src/nodes/docs.py` — `_build_docs_prompt()`
- `orchestrator/src/nodes/synthesis.py` — `_build_synthesis_prompt()`
- `orchestrator/src/nodes/pm.py` — `_build_pm_prompt()`

**Not affected:**

- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` is unchanged (persona loading + agent creation stays the same)
- `orchestrator/src/utils/persona.py` — persona loader is unchanged
- `orchestrator/src/config.py` — `PERSONA_FILES` mapping is unchanged

## Approach / Architecture

Replace each `_build_*_prompt()` function body with a minimal prompt that provides only:

1. **Project path** — the concrete runtime value for MCP tool calls.
2. **Work package ID** — which WP to operate on (omitted for synthesis, which operates project-wide).
3. **`project_path` injection warning** — a one-line reminder that every MCP tool call must include the `project_path` parameter, since the persona cannot know this value at build time.

### Template for WP-scoped stages (developer, qa, reviewer, security_auditor, release_engineer, docs)

```
Please start your work on the project.

**Project path:** {project_path}
**Active work package:** {wp_id}

**CRITICAL — EVERY MCP TOOL CALL MUST include
`project_path='{project_path}'`.** Omitting it will cause the call
to fail.
```

### Template for PM (special: embeds plan content)

The PM prompt currently embeds the full plan document content. This is legitimate runtime data the persona cannot know, so it stays — but the identity declaration and step-by-step workflow instructions are removed.

```
Please start your work on the project.

**Project path:** {project_path}
**Plan file:** {plan_file}

**CRITICAL — EVERY MCP TOOL CALL MUST include
`project_path='{project_path}'`.** Omitting it will cause the call
to fail.

---

# Plan Document

{plan_content}
```

### Template for Synthesis (no WP)

```
Please start your work on the project.

**Project path:** {project_path}

**CRITICAL — EVERY MCP TOOL CALL MUST include
`project_path='{project_path}'`.** Omitting it will cause the call
to fail.
```

## Rationale

- **Conflict elimination.** The orchestrator prompt says "Developer agent"; the persona says "Staff Software Engineer." The persona defines a nuanced 5-step operational protocol with Code Insight Observer duties, rework handling, and 9 constraints — the user prompt's oversimplified 5 steps could override or confuse the model's adherence to the persona.
- **Token efficiency.** Removing ~15 lines of redundant instructions per stage saves input tokens on every agent invocation across all 8 stages.
- **Single source of truth.** Persona behaviour is defined once in the persona files. Changes to workflow don't need to be mirrored in two places.
- **LLM attention priorities.** User-turn content often receives higher attention weight than system prompts. By eliminating competing instructions from the user turn, the model is more likely to follow the persona's richer, more nuanced guidance.

## Detailed Steps

1. **Rewrite `_build_developer_prompt()`** in `orchestrator/src/nodes/developer.py` — remove identity declaration and workflow steps; keep only project_path, wp_id, and the project_path warning.
2. **Rewrite `_build_qa_prompt()`** in `orchestrator/src/nodes/qa.py` — same pattern.
3. **Rewrite `_build_reviewer_prompt()`** in `orchestrator/src/nodes/reviewer.py` — same pattern.
4. **Rewrite `_build_security_auditor_prompt()`** in `orchestrator/src/nodes/security_auditor.py` — same pattern.
5. **Rewrite `_build_release_engineer_prompt()`** in `orchestrator/src/nodes/release_engineer.py` — same pattern.
6. **Rewrite `_build_docs_prompt()`** in `orchestrator/src/nodes/docs.py` — same pattern.
7. **Rewrite `_build_pm_prompt()`** in `orchestrator/src/nodes/pm.py` — remove identity and workflow steps; retain plan document embedding.
8. **Rewrite `_build_synthesis_prompt()`** in `orchestrator/src/nodes/synthesis.py` — remove identity and workflow steps; omit wp_id (synthesis is project-scoped).
9. **Update tests** — if any tests assert on prompt content, update them to match the new slim format.
10. **Update module docstrings** — adjust the module-level docstrings in each node file to reflect the simplified prompt strategy.
11. **Update orchestrator changelog** — add entry for the prompt simplification.

## Dependencies

- Persona files in `personas/ledger/claude-code/` must already contain complete workflow instructions for each role (already the case).
- No code dependencies between the 8 prompt builders — they can be modified in any order.

## Required Components

- `orchestrator/src/nodes/developer.py` (modify)
- `orchestrator/src/nodes/qa.py` (modify)
- `orchestrator/src/nodes/reviewer.py` (modify)
- `orchestrator/src/nodes/security_auditor.py` (modify)
- `orchestrator/src/nodes/release_engineer.py` (modify)
- `orchestrator/src/nodes/docs.py` (modify)
- `orchestrator/src/nodes/pm.py` (modify)
- `orchestrator/src/nodes/synthesis.py` (modify)
- `orchestrator/tests/` (modify if prompt assertions exist)

## Assumptions

- The persona files already contain all necessary workflow instructions, MCP tool call guidance, and role identity definitions — confirmed by cross-referencing `personas/ledger/claude-code/3-developer.md` against the current developer prompt builder.
- The `project_path` injection warning is necessary because the persona Markdown files are static and cannot contain the runtime project path.
- The PM stage legitimately needs the plan content embedded in the user prompt since no other mechanism provides it to the agent.

## Constraints

- The `project_path` injection warning MUST remain — this is runtime context the persona cannot provide.
- The PM's plan document embedding MUST remain — this is unique runtime data.
- No changes to `create_stage_node()` or the persona loading mechanism.
- The module docstrings in each node file should remain accurate (just update to reflect the new minimal prompt approach).

## Out of Scope

- Changes to persona file content.
- Changes to `create_stage_node()` or `persona.py`.
- Adding persona content to dialogue captures (separate enhancement).
- Modifying the supervisor routing logic.

## Acceptance Criteria

- Each of the 8 `_build_*_prompt()` functions produces only runtime context (project_path, wp_id where applicable, project_path warning) — no identity declarations, no workflow step enumerations, no MCP tool call instructions.
- The PM prompt still embeds the plan document content.
- The synthesis prompt omits wp_id (project-scoped stage).
- Existing orchestrator tests pass (updated if they assert on prompt content).
- `ruff check orchestrator/` passes with no new warnings.

## Testing Strategy

- Run `pytest orchestrator/tests/` — verify all existing tests pass after prompt content updates.
- If any tests assert on prompt builder output (e.g. checking for "You are the Developer agent"), update assertions to match the new slim format.
- Manual verification: run a short orchestrator workflow and confirm agents still execute correctly with the slimmed prompts.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Agents lose workflow adherence without explicit user-turn instructions** | The persona system prompt provides the same instructions in far greater detail. Monitor first orchestrator run after the change for any workflow deviations. |
| **project_path not reaching the agent** | The project_path injection warning remains in the user turn, and `inject_project_path()` in `create_stage_node()` wraps tools with auto-injection as a safety net. |
| **PM agent fails without step-by-step plan bootstrapping instructions** | The PM persona already contains detailed ledger initialization and work package creation instructions. The plan content embedding is preserved. |
