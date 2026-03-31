# Plan

## Summary

Remove redundant WP-scope directives, pipeline-type instructions, and
begin-work commands from the orchestrator's stage prompt templates.
The agent personas already contain the full workflow logic (call
`ledger_get_next_action` → follow `next_steps`), and the tool wrappers
(`restrict_to_wp`, `inject_project_path`) enforce scope programmatically.
The current prompt-level duplication creates an instruction conflict
between the persona system prompt and the orchestrator user-turn prompt,
and hardcodes pipeline-type strings that belong solely in the MCP server.

After this change, all WP-scoped stage prompts will match the minimal
pattern already used by the `synthesis` and no-WP templates — providing
only `project_path` and the `project-path-reminder` partial. The
`current_wp_id` state field and all tool wrappers remain unchanged.

## Architectural Context

### Current Prompt Architecture

The orchestrator uses a template engine (`orchestrator/src/nodes/prompt_renderer.py`)
to render Markdown templates into user-turn prompts sent to Deep Agent
instances. Each agent gets:
- **System prompt:** Full persona file from `personas/ledger/claude-code/`
- **User prompt:** Rendered stage template from `orchestrator/src/nodes/templates/`

### Relevant Files

| File | Role |
|------|------|
| `orchestrator/src/nodes/templates/developer.md` | Developer stage template |
| `orchestrator/src/nodes/templates/qa.md` | QA stage template |
| `orchestrator/src/nodes/templates/reviewer.md` | Reviewer stage template |
| `orchestrator/src/nodes/templates/docs.md` | Docs stage template |
| `orchestrator/src/nodes/templates/security_auditor.md` | Security Auditor stage template |
| `orchestrator/src/nodes/templates/release_engineer.md` | Release Engineer stage template |
| `orchestrator/src/nodes/templates/synthesis.md` | Synthesis template (already minimal — reference) |
| `orchestrator/src/nodes/templates/pm.md` | PM template (no WP scope — no change) |
| `orchestrator/src/nodes/templates/partials/wp-scope-reminder.md` | Partial: "CRITICAL: Every MCP tool call MUST use work_package_id=..." |
| `orchestrator/src/nodes/templates/partials/begin-work-developer.md` | Partial: "Step 1 — call ledger_begin_work..." + pipeline type + scope-restriction |
| `orchestrator/src/nodes/templates/partials/scope-restriction.md` | Partial: scope restriction directive |
| `orchestrator/src/nodes/templates/partials/project-path-reminder.md` | Partial: project path reminder (keep) |
| `orchestrator/src/nodes/templates/VARIABLES.md` | Template variable reference doc |
| `orchestrator/src/nodes/developer.py` | Developer node — `_build_developer_prompt()` |
| `orchestrator/src/nodes/qa.py` | QA node — `_build_qa_prompt()` |
| `orchestrator/src/nodes/reviewer.py` | Reviewer node — `_build_reviewer_prompt()` |
| `orchestrator/src/nodes/docs.py` | Docs node — `_build_docs_prompt()` |
| `orchestrator/src/nodes/security_auditor.py` | Security Auditor node — `_build_security_auditor_prompt()` |
| `orchestrator/src/nodes/release_engineer.py` | Release Engineer node — `_build_release_engineer_prompt()` |
| `orchestrator/src/nodes/__init__.py` | `create_stage_node()` — reads `current_wp_id` for tool wrappers and logging (no change) |
| `orchestrator/src/supervisor.py` | Sets `current_wp_id` in state (no change) |
| `orchestrator/src/utils/tool_wrappers.py` | `restrict_to_wp`, `inject_project_path` (no change) |
| `orchestrator/tests/test_nodes.py` | Tests for prompt content and slim-prompt assertions |
| `orchestrator/tests/test_prompt_renderer.py` | Tests for template rendering engine |
| `scripts/preview-prompts.py` | Preview renderer — produces `dist/stage-prompts/` files |

### Key Patterns

- Templates use `{{#if wp_id}}` conditional blocks to include WP-scoped
  content. After this change, these blocks are removed entirely — not
  just the partial references within them.
- The `wp_id` variable is still passed to `render_prompt()` by each
  node's prompt builder, but after the template changes it will have no
  effect on the rendered output (no `{wp_id}` placeholders remain).
  It can optionally be removed from the `render_prompt()` calls, but
  this is harmless to leave since `defaultdict(str)` handles unused vars.
- The tool wrappers in `create_stage_node()` still read `current_wp_id`
  from state for `restrict_to_wp` and `_install_begin_work_tracker` —
  this is unchanged.

## Approach / Architecture

1. Simplify all 6 WP-scoped templates to the same minimal pattern as
   `synthesis.md`:
   ```markdown
   **Project:** `{project_path}`

   {{> project-path-reminder}}
   ```
2. Delete the 3 now-unused partials.
3. Remove `wp_id` from the prompt builder calls in each node file.
4. Update `VARIABLES.md` to reflect the simplified variable matrix.
5. Update `scripts/preview-prompts.py` — WP-scoped stages no longer
   produce two variants; a single output suffices.
6. Update tests to match the new prompt content.

## Rationale

- **Single source of truth:** The persona system prompt already contains
  the complete workflow (call `ledger_get_next_action`, follow `next_steps`,
  call `ledger_begin_work`). Adding the same instructions in the user
  prompt creates a competing authority.
- **Deterministic enforcement:** `restrict_to_wp` and `inject_project_path`
  wrappers enforce WP scope and path injection at the tool-call level —
  these are deterministic, unlike prompt instructions which are
  probabilistic.
- **Drift risk:** The `begin-work-developer` partial hardcodes
  `type="implementation"` and `agent_role="Developer"`, duplicating the
  canonical role→pipeline mapping in the MCP server. Removing it
  eliminates a maintenance liability.
- **Parity with manual usage:** When running agents manually, the prompt is
  simply `Please start with the project /path/to/project.` — the agent
  self-orients via the ledger. The orchestrator should match this pattern.

## Detailed Steps

### Step 1: Simplify the 6 WP-scoped templates

Replace the content of each template with the minimal pattern. All 6
templates become identical in structure to `synthesis.md`:

**Files to modify:**
- `orchestrator/src/nodes/templates/developer.md`
- `orchestrator/src/nodes/templates/qa.md`
- `orchestrator/src/nodes/templates/reviewer.md`
- `orchestrator/src/nodes/templates/docs.md`
- `orchestrator/src/nodes/templates/security_auditor.md`
- `orchestrator/src/nodes/templates/release_engineer.md`

**New content for each (identical):**
```markdown
**Project:** `{project_path}`

{{> project-path-reminder}}
```

### Step 2: Delete unused partials

**Files to delete:**
- `orchestrator/src/nodes/templates/partials/wp-scope-reminder.md`
- `orchestrator/src/nodes/templates/partials/begin-work-developer.md`
- `orchestrator/src/nodes/templates/partials/scope-restriction.md`

**Files to keep (unchanged):**
- `orchestrator/src/nodes/templates/partials/project-path-reminder.md`
- `orchestrator/src/nodes/templates/partials/pm-preamble.md`

### Step 3: Remove `wp_id` from prompt builder functions

In each of the 6 WP-scoped node files, remove the `wp_id` extraction
and the `"wp_id"` key from the `render_prompt()` variables dict.

**Before (all 6 files follow this pattern):**
```python
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

**After:**
```python
def _build_developer_prompt(state: WorkflowState) -> str:
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
    })
```

**Files to modify:**
- `orchestrator/src/nodes/developer.py`
- `orchestrator/src/nodes/qa.py`
- `orchestrator/src/nodes/reviewer.py`
- `orchestrator/src/nodes/docs.py`
- `orchestrator/src/nodes/security_auditor.py`
- `orchestrator/src/nodes/release_engineer.py`

**Important: Do NOT touch `orchestrator/src/nodes/__init__.py`.** The
`current_wp_id` extraction there feeds the tool wrappers and logging,
not the prompt template. It must remain.

### Step 4: Update VARIABLES.md

Rewrite `orchestrator/src/nodes/templates/VARIABLES.md` to reflect:
- `wp_id` variable is no longer used by any template.
- The per-template matrix simplifies: all WP-scoped templates now use
  only `project_path` and `project-path-reminder`.
- The partial catalogue shrinks to `project-path-reminder.md` and
  `pm-preamble.md`.
- Remove the `† = included only when wp_id is truthy` footnote.

### Step 5: Update `scripts/preview-prompts.py`

The `wp_scoped` flag and two-variant rendering logic are no longer needed.
All stages produce a single output file.

**Changes:**
- Remove `wp_scoped` key from `STAGES` entries (or set all to `False`).
- Simplify `render_and_write()` to always render a single file:
  `{stage['name']}.md` (no `-with-wp` / `-without-wp` suffix).
- Remove `wp_id` from `_render_stage()` parameters and the variables
  dict.
- Delete the existing `dist/stage-prompts/` output files and regenerate.

### Step 6: Update tests in `test_nodes.py`

**Tests to delete (assert content that no longer exists in prompts):**
- `test_developer_prompt_step1_is_bold_markdown` — asserts `**Step 1`
- `test_developer_prompt_contains_scope_restriction` — asserts `SCOPE RESTRICTION`
- `test_qa_prompt_contains_scope_restriction` — asserts `SCOPE RESTRICTION`
- `test_qa_prompt_scope_restriction_is_dynamic` — asserts WP ID in scope restriction
- `test_reviewer_prompt_contains_scope_restriction` — asserts `SCOPE RESTRICTION`
- `test_reviewer_prompt_scope_restriction_is_dynamic` — asserts WP ID in scope restriction

**Tests to update:**
- `_assert_slim_fields_present()` helper: When `expect_wp=True`, it
  currently asserts `_SLIM_WP_ID in prompt`. Change `expect_wp` to
  `False` in all WP-scoped test calls, OR remove the `expect_wp`
  parameter entirely since no template now includes WP IDs.
- The `test_developer_prompt_is_unique_per_wp` test asserts that different
  WP IDs produce different prompts — this test should be removed since
  the prompt no longer varies by WP ID.
- All `test_*_prompt_has_slim_fields` calls for WP-scoped stages:
  change `expect_wp=True` to `expect_wp=False`.

**Tests to keep unchanged:**
- `test_synthesis_prompt_does_not_use_wp_id` — still valid.
- `test_synthesis_node_works_without_wp_id` — still valid.
- All `test_*_prompt_has_no_identity_declarations` — still valid.
- All supervisor tests in `test_supervisor.py` — `current_wp_id`
  setting/clearing is still done by the supervisor for tool wrapper use.
- All tool wrapper tests in `test_tool_wrappers.py` — `restrict_to_wp`
  is still applied.
- Stage-start logging tests that assert `wp_id` in log entries — this
  is logged from `current_wp_id` in state, not from the prompt template.

### Step 7: Update prompt renderer test

In `test_prompt_renderer.py`, the test that creates a `wp-scope-reminder.md`
partial in a temp directory and verifies its inclusion (lines ~487–492)
can remain as a generic test of the partial-include mechanism. But if it
references deleted partials by name, update the test to use a different
example partial name.

### Step 8: Regenerate preview files

Run `python scripts/preview-prompts.py` to regenerate
`orchestrator/dist/stage-prompts/`. Delete the old `-with-wp` /
`-without-wp` files that are no longer produced.

### Step 9: Run full test suite

```bash
cd orchestrator && python -m pytest tests/ -v
```

Verify all tests pass with the updated assertions.

## Dependencies

- No external dependency changes.
- No MCP server changes.
- No persona changes.

## Required Components

- `orchestrator/src/nodes/templates/*.md` — 6 template files
- `orchestrator/src/nodes/templates/partials/` — 3 files deleted
- `orchestrator/src/nodes/templates/VARIABLES.md` — documentation update
- `orchestrator/src/nodes/{developer,qa,reviewer,docs,security_auditor,release_engineer}.py` — 6 node files
- `scripts/preview-prompts.py` — preview renderer
- `orchestrator/tests/test_nodes.py` — test updates
- `orchestrator/tests/test_prompt_renderer.py` — test review
- `orchestrator/dist/stage-prompts/` — regenerated output

## Assumptions

- The persona system prompts already contain sufficient instructions for
  agents to self-orient via `ledger_get_next_action`. This is verified
  by the research report.
- The `restrict_to_wp` tool wrapper will catch any WP mismatch between
  what the supervisor intended and what the agent discovers from the
  ledger. This is verified by the wrapper implementation.
- The `_install_begin_work_tracker` wrapper still needs `current_wp_id`
  from the state to function — this is unaffected since it reads from
  `create_stage_node()`, not from the prompt template.

## Constraints

- Do NOT remove `current_wp_id` from the workflow state or from the
  supervisor's routing logic — it is still used by tool wrappers,
  logging, and the begin-work tracker.
- Do NOT modify persona files — this is purely an orchestrator change.
- Do NOT modify `orchestrator/src/nodes/__init__.py` — the `current_wp_id`
  reading there feeds tool wrappers and logging, not prompt content.
- Do NOT modify `orchestrator/src/supervisor.py` — routing logic is
  unchanged.
- Do NOT modify `orchestrator/src/utils/tool_wrappers.py` — enforcement
  layer is unchanged.

## Out of Scope

- Persona changes (adding orchestrator-mode conditional).
- Changes to the MCP server.
- Changes to the supervisor routing logic.
- Removing `current_wp_id` from the state definition.
- Changes to tool wrapper logic.

## Acceptance Criteria

1. All 6 WP-scoped templates contain only `project_path` and the
   `project-path-reminder` partial — no WP IDs, no scope restrictions,
   no pipeline types, no begin-work directives.
2. The 3 unused partials are deleted.
3. Prompt builder functions no longer reference `wp_id` or
   `current_wp_id`.
4. `VARIABLES.md` accurately reflects the simplified template system.
5. `scripts/preview-prompts.py` produces a single output file per
   stage (no `-with-wp` / `-without-wp` variants). All WP-scoped stage
   previews are identical in structure to the synthesis preview.
6. All orchestrator tests pass (`python -m pytest tests/ -v`).
7. `restrict_to_wp` and `inject_project_path` tool wrappers remain
   fully functional — verified by `test_tool_wrappers.py` passing.
8. Supervisor tests continue to pass — `current_wp_id` is still set
   correctly on routing decisions.

## Testing Strategy

- **Unit tests:** Update `test_nodes.py` assertions to match new prompt
  content. Delete tests that asserted removed content. Verify all
  prompt builder tests pass.
- **Prompt renderer tests:** Verify `test_prompt_renderer.py` still
  passes (partial-include mechanism unchanged).
- **Integration:** Regenerate preview files and visually verify they
  match the expected minimal pattern.
- **Tool wrapper tests:** Run `test_tool_wrappers.py` unchanged —
  these validate the programmatic safety net is intact.
- **Supervisor tests:** Run `test_supervisor.py` unchanged — routing
  logic and `current_wp_id` management are unaffected.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Agent calls `ledger_get_next_action` and gets a different WP than supervisor intended** | `restrict_to_wp` wrapper rejects cross-WP tool calls. In practice, no state change occurs between supervisor query and agent query since the orchestrator is single-threaded. |
| **Agent ignores persona instructions and doesn't call `ledger_get_next_action`** | This would be a persona-level bug, not an orchestrator issue. The persona's pre-flight instruction is tested and proven in manual agent runs. |
| **Extra MCP call (`ledger_get_next_action`) per agent increases latency** | One additional MCP call is negligible vs. the 5–15 calls each agent makes during its work. This is the accepted tradeoff. |
| **Tests that asserted removed content are deleted rather than replaced** | Tests for the _absence_ of identity phrases and for the _presence_ of project_path remain. The removed tests asserted orchestrator-specific scope text that is no longer part of the design. |
