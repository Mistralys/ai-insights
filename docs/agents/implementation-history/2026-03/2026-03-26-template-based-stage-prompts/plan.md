# Plan

## Summary

Replace the procedural prompt-assembly logic in `orchestrator/src/nodes/__init__.py` (`build_stage_prompt()`) and the per-stage `_build_*_prompt()` functions with a template-based system. Each stage gets its own Markdown template file with simple block markers (`{{#if var}}…{{/if}}`) for conditional sections. A lightweight `render_prompt()` function substitutes variables and evaluates conditional blocks, giving full editorial control over prompt layout without touching Python code.

## Architectural Context

The current prompt system has three layers:

1. **Shared builder** — `build_stage_prompt()` in `orchestrator/src/nodes/__init__.py` (lines 100–130). Accepts `project_path`, `wp_id`, `preamble`, `extra` and assembles lines with Python `if` statements and f-strings. Two module-level constants (`_PROJECT_PATH_REMINDER`, `_WP_SCOPE_REMINDER`) hold fixed text.

2. **Per-stage builders** — `_build_*_prompt()` in each node module (`developer.py`, `qa.py`, `reviewer.py`, `docs.py`, `security_auditor.py`, `release_engineer.py`, `pm.py`, `synthesis.py`). Each calls `build_stage_prompt()` passing stage-specific `preamble` / `extra` strings. Most stages pass identical or near-identical arguments.

3. **Node factory** — `create_stage_node()` receives the per-stage builder as a callable, invokes it at runtime, and passes the result as the user message to `create_deep_agent().ainvoke()`.

Key constraints from `orchestrator/docs/agents/project-manifest/constraints.md`:
- **Constraint 1:** Persona files are the source of truth for agent behaviour. User-turn prompts contain only runtime context.
- **Constraint 2:** The `project_path` reminder is permanent and must never be removed.
- **Constraint 3:** WP-scoped prompt builders must all delegate to a centralized helper. PM and synthesis are documented exceptions.

Existing tests in `orchestrator/tests/test_nodes.py` (`TestSlimPromptContent` class, ~150 lines) assert: mandatory fields present, no identity phrases, dynamic `wp_id` substitution, scope restriction presence, and developer-specific `ledger_begin_work` instruction.

## Approach / Architecture

### Template files

Create `orchestrator/src/nodes/templates/` directory with one `.md` file per stage:

```
orchestrator/src/nodes/templates/
├── developer.md
├── qa.md
├── reviewer.md
├── docs.md
├── security_auditor.md
├── release_engineer.md
├── pm.md
└── synthesis.md
```

### Template syntax

A minimal custom syntax — intentionally not a full template engine — supporting only variable substitution and conditional blocks:

| Syntax | Meaning |
|--------|---------|
| `{variable}` | Substitute from the variable dict. Missing keys → empty string. |
| `{{#if variable}}` | Start conditional block — included only when `variable` is truthy. |
| `{{/if}}` | End conditional block. |

Nesting is not required. Block markers must appear on their own line. The renderer strips the marker lines and any resulting consecutive blank lines.

Example template (`developer.md`):

```markdown
{{#if preamble}}
{preamble}
{{/if}}
**Project:** `{project_path}`
{{#if wp_id}}
**Work package:** {wp_id}
{{/if}}

{project_path_reminder}
{{#if wp_id}}

{wp_scope_reminder}
{{/if}}
{{#if extra}}

{extra}
{{/if}}
```

### Renderer

A new module `orchestrator/src/nodes/prompt_renderer.py` with two public functions:

- `load_template(stage: str) -> str` — Reads and caches the template file for a given stage name. Uses `importlib.resources` (or `Path(__file__).parent / "templates"`) to locate the files relative to the package.
- `render_prompt(template: str, variables: dict[str, str]) -> str` — Processes `{{#if}}…{{/if}}` blocks, substitutes `{variable}` placeholders, and collapses excessive blank lines.

### Per-stage builders

Each `_build_*_prompt()` function is simplified to: construct a `dict` of template variables from `state`, then call `render_prompt(load_template(stage), variables)`. The shared `build_stage_prompt()` function is removed.

Example (developer):

```python
from src.nodes.prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("developer")

def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
        "project_path_reminder": PROJECT_PATH_REMINDER,
        "wp_scope_reminder": WP_SCOPE_REMINDER.format(wp_id=wp_id),
        "extra": (
            f'**Step 1 — BEFORE writing any code:** Call `ledger_begin_work` with '
            f'work_package_id={wp_id}, type="implementation", agent_role="Developer".\n\n'
            "**Pipeline to start:** `implementation`\n\n"
            f"**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}. "
            "Do NOT call any MCP tool with a different work_package_id.**"
        ),
    })
```

### Shared constants

`_PROJECT_PATH_REMINDER` and `_WP_SCOPE_REMINDER` remain in `__init__.py` as named exports (`PROJECT_PATH_REMINDER`, `WP_SCOPE_REMINDER`) so all node modules can reference them in their variable dicts. The leading underscore is dropped since they are now part of the internal API consumed by sibling modules.

## Rationale

- **External files** are editable without touching Python. The prompt text is visually inspectable and diffable in PRs. Non-developers can review and adjust wording.
- **Block markers** (`{{#if}}`) make conditional logic visible in the template itself rather than hiding it in Python `if` statements. The syntax is deliberately minimal — no `else`, no nesting, no loops — to stay within the "runtime context only" constraint.
- **Python `string.Template`** was rejected: it has no conditional support, so empty variables leave blank lines or require Python-side pre-processing that defeats the purpose.
- **Jinja2** was rejected: adds a dependency for very little gain given the simplicity of the templates.
- **`importlib.resources`** is preferred over `Path(__file__)` for package-relative file loading as it works correctly with zip imports and is the stdlib-recommended approach. However, since the orchestrator is always run from source (never packaged), `Path(__file__).parent / "templates"` is acceptable and simpler.

## Detailed Steps

1. **Create `orchestrator/src/nodes/prompt_renderer.py`**
   - Implement `load_template(stage)` with in-memory caching (module-level `dict`).
   - Implement `render_prompt(template, variables)` with regex-based `{{#if var}}…{{/if}}` processing and `str.format_map()` for variable substitution (using a `defaultdict(str)` to handle missing keys gracefully).
   - Implement `clear_template_cache()` for test support.

2. **Create `orchestrator/src/nodes/templates/` directory** with 8 template files:
   - `developer.md` — includes `preamble`, `project_path`, `wp_id`, `project_path_reminder`, `wp_scope_reminder`, `extra` (with `ledger_begin_work` instruction and scope restriction baked into the template's `extra` block).
   - `qa.md` — includes project/WP context, reminders, scope restriction in `extra`.
   - `reviewer.md` — identical structure to `qa.md`.
   - `docs.md` — identical structure to `qa.md`.
   - `security_auditor.md` — project/WP context, reminders only (no extra).
   - `release_engineer.md` — project/WP context, reminders only (no extra).
   - `pm.md` — includes `preamble` (with plan file reference), project context, reminder, `extra` (plan content). No `wp_id` blocks.
   - `synthesis.md` — project context and reminder only. No `wp_id` blocks.

3. **Refactor `orchestrator/src/nodes/__init__.py`**
   - Remove `build_stage_prompt()` function.
   - Rename `_PROJECT_PATH_REMINDER` → `PROJECT_PATH_REMINDER` and `_WP_SCOPE_REMINDER` → `WP_SCOPE_REMINDER` (drop leading underscore).
   - Update `__init__.py` module docstring to reflect the new architecture.

4. **Refactor each `_build_*_prompt()` function** in all 8 node modules:
   - Replace `build_stage_prompt()` call with `render_prompt(template, variables)`.
   - Load template at module level with `_TEMPLATE = load_template("stage_name")`.
   - Construct variable dict from state.

5. **Update tests in `orchestrator/tests/test_nodes.py`**
   - Remove any direct tests of the deleted `build_stage_prompt()` if they exist.
   - Update `TestSlimPromptContent` assertions if prompt formatting changes (e.g. blank line patterns).
   - Add tests for `prompt_renderer.py`: `render_prompt` with conditionals, missing variables, nested blank line collapsing.
   - Existing per-stage tests (`test_developer_prompt_has_slim_fields`, etc.) should pass with identical or near-identical assertions since the output content is preserved.

6. **Update `orchestrator/docs/agents/project-manifest/constraints.md`**
   - Rewrite Constraint 3 to reference template files instead of `build_stage_prompt()`.
   - Add a new constraint for template syntax rules (no Jinja2, no nesting, block markers on own line).

7. **Run the full test suite** to verify no regressions.

## Dependencies

- No new external dependencies. The renderer uses only Python stdlib (`re`, `pathlib`, `collections.defaultdict`).

## Required Components

- **New file:** `orchestrator/src/nodes/prompt_renderer.py`
- **New directory:** `orchestrator/src/nodes/templates/`
- **New files:** `orchestrator/src/nodes/templates/{developer,qa,reviewer,docs,security_auditor,release_engineer,pm,synthesis}.md`
- **Modified:** `orchestrator/src/nodes/__init__.py` (remove `build_stage_prompt`, rename constants)
- **Modified:** `orchestrator/src/nodes/developer.py`
- **Modified:** `orchestrator/src/nodes/qa.py`
- **Modified:** `orchestrator/src/nodes/reviewer.py`
- **Modified:** `orchestrator/src/nodes/docs.py`
- **Modified:** `orchestrator/src/nodes/security_auditor.py`
- **Modified:** `orchestrator/src/nodes/release_engineer.py`
- **Modified:** `orchestrator/src/nodes/pm.py`
- **Modified:** `orchestrator/src/nodes/synthesis.py`
- **Modified:** `orchestrator/tests/test_nodes.py`
- **Modified:** `orchestrator/docs/agents/project-manifest/constraints.md`

## Assumptions

- The orchestrator is always run from source (not packaged as a wheel/zip), so `Path(__file__).parent / "templates"` is reliable for file resolution.
- Template files are small (< 1 KB each) so caching is a convenience, not a performance necessity.
- No stage currently needs template inheritance, loops, or `else` branches. If that changes in the future, the renderer can be extended without breaking existing templates.

## Constraints

- **No new dependencies.** The renderer must use only Python stdlib.
- **Output equivalence.** The rendered prompt text for each stage must be semantically equivalent to the current output (same mandatory fields, same conditional sections). Minor whitespace differences are acceptable.
- **Constraint 1 compliance.** Templates must contain only runtime-context placeholders — no identity declarations or workflow instructions.
- **Constraint 2 compliance.** `PROJECT_PATH_REMINDER` must appear in every template.
- **Cross-platform.** Template files must use UTF-8 encoding. Path resolution must use `pathlib`.

## Out of Scope

- Jinja2 or any third-party template engine.
- Changing the persona system-prompt loading mechanism (`load_persona()`).
- Modifying `create_stage_node()` — it continues to receive a `build_prompt` callable; only the internal implementation of each callable changes.
- Changing the content/wording of the prompt reminders or scope restrictions (pure refactor).
- Template nesting or inheritance.

## Acceptance Criteria

- All 8 stage prompts are rendered from external `.md` template files.
- `build_stage_prompt()` is removed from `__init__.py`.
- A `render_prompt()` function in `prompt_renderer.py` handles `{variable}` substitution and `{{#if var}}…{{/if}}` conditional blocks.
- Template files are cacheable and loaded via `load_template()`.
- The existing `TestSlimPromptContent` test class passes (with minimal assertion adjustments for whitespace only).
- New unit tests cover `render_prompt()` edge cases: missing variables, falsy conditionals, consecutive blank line collapsing.
- `orchestrator/docs/agents/project-manifest/constraints.md` is updated to document the template-based architecture.
- `python3 -m pytest` passes with zero failures from the orchestrator root.

## Testing Strategy

1. **Unit tests for `prompt_renderer.py`:**
   - `render_prompt` with all variables populated → correct substitution.
   - `render_prompt` with missing/empty variables → graceful fallback (empty string).
   - `render_prompt` with falsy `{{#if}}` variable → block removed.
   - `render_prompt` with truthy `{{#if}}` variable → block preserved.
   - Consecutive blank lines after block removal → collapsed to single blank line.
   - `load_template` with valid stage → returns cached content.
   - `load_template` with invalid stage → raises `KeyError` or `FileNotFoundError`.

2. **Existing `TestSlimPromptContent` tests** — run as-is. If whitespace differences cause failures, adjust assertions to normalize whitespace before comparison.

3. **Integration regression** — run full `pytest` suite from `orchestrator/`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Whitespace-sensitive test assertions break** | Normalize whitespace in test comparisons. Review each failing assertion to confirm the change is cosmetic. |
| **Template syntax conflicts with prompt content** | The `{variable}` syntax could conflict with literal braces in prompt text (e.g. JSON examples). Mitigate by using `{{` literal escape for braces that should not be substituted, documented in the renderer. |
| **Future stages need richer template logic** | The renderer is designed for extension. Adding `{{#else}}` or nested conditionals later is straightforward without breaking existing templates. |
| **`{variable}` collides with Python `str.format_map`** | Use `string.Formatter` subclass or regex-based substitution instead of raw `str.format_map` to avoid `KeyError` on literal brace patterns. A `defaultdict(str)` fallback handles missing keys. |
