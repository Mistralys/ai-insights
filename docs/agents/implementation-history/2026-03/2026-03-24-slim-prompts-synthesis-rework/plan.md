# Plan

## Summary

Address the six strategic recommendations from the 2026-03-24-slim-orchestrator-prompts synthesis report. The work codifies the persona-as-source-of-truth constraint, documents the prompt architecture permanently in the orchestrator docs, fixes stale docstrings/cross-references, and formalises the "documentation-forward" review convention — turning project-specific insights into permanent codebase knowledge.

## Architectural Context

The orchestrator (`orchestrator/`) is a LangGraph-based headless pipeline executor with 8 stage nodes, each backed by a `_build_*_prompt()` function. The recent slim-prompts project established a critical design boundary: **persona files** (in `personas/ledger/claude-code/`) own agent identity, workflow, and MCP usage; **user-turn prompts** carry only runtime context (`project_path`, `wp_id`, injection-safety warning).

Key files and documentation:
- **Orchestrator manifest:** `orchestrator/docs/agents/project-manifest/README.md` — hub document, contains inline constraints section but no standalone `constraints.md`
- **Architecture doc:** `orchestrator/docs/architecture.md` — stage node lifecycle, MCP wrapping, WorkflowState fields; no prompt design section
- **Node source files:** `orchestrator/src/nodes/{pm,developer,qa,reviewer,security_auditor,release_engineer,docs,synthesis}.py` — each has a module docstring recently updated to mention slim prompts
- **Test file:** `orchestrator/tests/test_nodes.py` — stale "six Deep Agent stage nodes" docstring (line 2)
- **MCP server constraints:** `mcp-server/docs/agents/project-manifest/constraints.md` — has a well-established "source of truth" pattern (Constraint #0: Workflow Specification)
- **Cancelled WP files:** `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/WP-{004,006,007,009}.json` — contain stale cross-references from mid-session plan revision
- **Synthesis source:** `docs/agents/implementation-history/2026-03/2026-03-24-slim-orchestrator-prompts/synthesis.md`

The orchestrator manifest currently lacks a standalone `constraints.md` file (unlike the MCP server), which is the natural home for codifying the persona-as-source-of-truth constraint. The architecture doc lacks any prompt design section.

## Approach / Architecture

Six deliverables, mapped to the six strategic recommendations:

1. **Create `orchestrator/docs/agents/project-manifest/constraints.md`** — codify the persona-as-source-of-truth constraint and the static-persona / dynamic-user-turn distinction (recommendations #1, #3).
2. **Add a "Prompt Architecture" section to `orchestrator/docs/architecture.md`** — document the three prompt templates (WP-scoped, PM, synthesis), the persona vs. user-turn boundary, and the `project_path` injection-safety warning as a permanent fixture (recommendations #1, #3).
3. **Fix stale docstring in `orchestrator/tests/test_nodes.py`** — change "six" to "eight" (technical debt item #1 from synthesis).
4. **Add supersession notes to cancelled WP files** — update WP-004, WP-006, WP-007, WP-009 JSON files in the ledger to add explicit `superseded_by` metadata and clarify the stale cross-references (recommendation #5).
5. **Formalise "documentation-forward" convention** — add this as a named convention in the reviewer persona source and in the orchestrator constraints, defining what a documentation-forward comment looks like and how it flows from code-review to the documentation stage (recommendation #6).
6. **Update orchestrator manifest README.md** — add the new `constraints.md` to the manifest sections table and update the file tree (recommendation #1).

Recommendation #2 (token efficiency) is informational — no action needed. Recommendation #4 (monitor first run) is an operational observation task, not a code change, but should be noted as an acceptance criterion in the constraints doc.

## Rationale

- **Constraints as a standalone file** mirrors the MCP server's established pattern (`mcp-server/docs/agents/project-manifest/constraints.md`), which agents already know how to find and consume via the AGENTS.md ingestion path.
- **Architecture.md is the right home for prompt design** because it already documents the stage node lifecycle (steps 1–9) but currently skips over prompt design principles. Adding a section there keeps the information discoverable.
- **Modifying the persona YAML source** (not the generated output) for the documentation-forward convention follows the workspace's MUST rule: "Never edit generated persona files."
- **Updating cancelled WP JSON files** directly is acceptable because they are ledger storage, not generated output — they are the canonical records of what happened.

## Detailed Steps

### Step 1: Create orchestrator constraints.md

Create `orchestrator/docs/agents/project-manifest/constraints.md` with the following constraints:

1. **Persona files are the source of truth for agent behaviour.** All identity declarations, workflow step enumerations, and MCP tool-call instructions live exclusively in persona system prompts (`personas/ledger/claude-code/`). User-turn prompts in `_build_*_prompt()` functions must contain only runtime context that the persona file cannot know (concrete `project_path`, `wp_id`, plan content, injection-safety warning). Any change to agent behaviour must be made in the persona source files, not in prompt builder functions.

2. **The `project_path` injection-safety warning is permanent.** Persona Markdown files are static and cannot contain runtime values. The user-turn prompt must always include the verbatim injection-safety warning to prevent path manipulation. This warning must never be removed or weakened.

3. **Prompt templates are structurally uniform within their category.** The six WP-scoped prompt functions must remain structurally identical (same f-string layout, same fields, same annotations). Any change to the minimal prompt pattern must be applied consistently across all six. The PM and synthesis templates are documented exceptions with justified divergences.

4. **No LLM calls in the supervisor** (existing constraint from README — promote to constraints.md).

5. **Manifest-derived constants** (existing constraint — promote).

6. **Circuit-breaker threshold: 3 consecutive failures** (existing constraint — promote).

7. **Stage node isolation** (existing constraint — promote).

8. **`documentation-forward` is a named review convention.** When a code-review pipeline identifies documentation gaps, the reviewer must record them as structured comments with the prefix `[documentation-forward]`. The documentation stage (WP-008 pattern) resolves these comments. This is the standard cross-pipeline handoff mechanism for documentation work.

### Step 2: Add "Prompt Architecture" section to architecture.md

Insert a new section after the existing "Stage Nodes (Deep Agents)" section in `orchestrator/docs/architecture.md`. Content:

- **Design Principle:** Persona owns identity; user-turn owns runtime context
- **Three Prompt Templates:** WP-scoped (6 nodes), PM (plan content), Synthesis (project-scoped, no wp_id)
- **Fields per template:** Table showing which fields each template includes
- **`project_path` injection-safety warning:** Why it exists and why it's permanent
- **Relationship to persona files:** Pointer to `personas/ledger/claude-code/` and the persona build system

### Step 3: Fix stale test_nodes.py docstring

In `orchestrator/tests/test_nodes.py`, line 2: change `"six Deep Agent stage nodes"` to `"eight Deep Agent stage nodes"`.

### Step 4: Add supersession notes to cancelled WP files

For each of WP-004, WP-006, WP-007, WP-009 in `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/`:
- Read the current JSON content
- Add a `superseded_by` field indicating which active WP absorbed the scope
- Add a `supersession_note` field explaining why this WP was cancelled

Mapping (based on the synthesis):
- WP-004 → superseded by WP-001 (restructured to cover all 6 WP-scoped nodes)
- WP-006 → superseded by WP-002 (PM node handled directly)
- WP-007 → superseded by WP-005 (test updates consolidated)
- WP-009 → superseded by WP-008 (documentation consolidated)

### Step 5: Formalise "documentation-forward" convention

In `personas/ledger/src/` — locate the reviewer persona's body partial (the Markdown content file for the reviewer role) and add a section defining the `[documentation-forward]` convention:
- What it is: a structured comment left by the code-review pipeline
- Format: `[documentation-forward] <description of documentation gap>`
- Where it goes: in the pipeline result summary or as a project-level comment
- Who resolves it: the documentation stage agent
- Example

Also reference this convention in the new `constraints.md` (Step 1, constraint #8).

### Step 6: Update orchestrator manifest README.md

- Add `constraints.md` to the "Manifest Sections" table in `orchestrator/docs/agents/project-manifest/README.md`
- Update the file tree to include `constraints.md`
- Update the inline "Constraints & Conventions" section to reference the new standalone file rather than listing constraints inline

## Dependencies

- Step 1 must complete before Step 6 (the manifest update references the new file)
- Step 5 depends on identifying the correct reviewer persona source partial
- Steps 2, 3, and 4 are independent of each other and of Steps 1/5/6

## Required Components

### Existing files to modify
- `orchestrator/docs/architecture.md` — add Prompt Architecture section
- `orchestrator/docs/agents/project-manifest/README.md` — update manifest table + file tree
- `orchestrator/tests/test_nodes.py` — fix docstring (line 2)
- `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/WP-004.json` — add supersession metadata
- `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/WP-006.json` — add supersession metadata
- `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/WP-007.json` — add supersession metadata
- `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/WP-009.json` — add supersession metadata
- Reviewer persona body partial in `personas/ledger/src/` (exact file TBD by engineer)

### New files to create
- `orchestrator/docs/agents/project-manifest/constraints.md` — standalone constraints document

## Assumptions

- The cancelled WP JSON files accept additional metadata fields without breaking the ledger schema (the schema is permissive for extra fields — verify with `mcp-server/src/schema/`)
- The reviewer persona body content is in a Markdown partial under `personas/ledger/src/content/` or similar directory
- The inline "Constraints & Conventions" section in the orchestrator manifest README can be replaced with a reference to the new standalone file

## Constraints

- Never edit generated persona files (`personas/ledger/vs-code/*.agent.md`, `personas/ledger/claude-code/*.md`) — edit source files in `personas/ledger/src/` only
- Follow the MCP server's constraints.md established format for consistency
- Cross-platform policy applies to any new documentation (no OS-specific assumptions)
- All changes must be compatible with `node scripts/build-personas.js --check` (persona build must still pass)

## Out of Scope

- Recommendation #2 (token efficiency gains) — informational, no action needed
- Recommendation #4 (monitor first orchestrator run) — operational observation, not a code change; noted in constraints doc as a one-time validation
- Creating a full `CONTRIBUTING.md` or ADR framework — the constraints.md addresses the immediate need; a broader contributing guide is a separate initiative
- Updating the orchestrator changelog — the Release Engineer will handle this as part of the standard pipeline
- Regenerating `.context/` files — will be done after all changes via `node scripts/cli.js ctx-generate`

## Acceptance Criteria

1. `orchestrator/docs/agents/project-manifest/constraints.md` exists and contains at least 8 numbered constraints, including the persona-as-source-of-truth rule, `project_path` injection-safety warning permanence, prompt structural uniformity, and the `documentation-forward` convention
2. `orchestrator/docs/architecture.md` contains a "Prompt Architecture" section documenting the three prompt templates, design principles, and field tables
3. `orchestrator/tests/test_nodes.py` line 2 reads "eight Deep Agent stage nodes"
4. WP-004, WP-006, WP-007, WP-009 JSON files each contain `superseded_by` and `supersession_note` fields
5. The reviewer persona source (not generated output) contains a `[documentation-forward]` convention definition
6. `orchestrator/docs/agents/project-manifest/README.md` lists `constraints.md` in its manifest sections table
7. `node scripts/build-personas.js --check` passes (persona build is not broken)
8. All existing orchestrator tests pass (`pytest` in `orchestrator/`)

## Testing Strategy

- Run `pytest` in `orchestrator/` to confirm the docstring fix doesn't break anything and all 466+ tests pass
- Run `node scripts/build-personas.js --check` to verify persona build integrity after modifying reviewer source files
- Run `node scripts/validate-workflow-manifest.js` to confirm no manifest drift
- Manual review of the new constraints.md and architecture.md sections for completeness and accuracy

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP JSON schema rejects extra fields** | Verify the ledger schema allows additional properties before modifying WP files; if strict, add `superseded_by` as a comment in the `description` field instead |
| **Reviewer persona partial structure unclear** | Engineer should explore `personas/ledger/src/content/` to find the correct file; the build system's `--check` flag will catch any structural errors |
| **Constraints.md duplicates manifest README inline constraints** | Actively migrate inline constraints from the README to the new file, replacing them with a cross-reference to avoid dual maintenance |
| **Documentation-forward convention may be too prescriptive** | Keep the convention lightweight — define the prefix format and resolution responsibility, but don't mandate specific tooling or automation |
