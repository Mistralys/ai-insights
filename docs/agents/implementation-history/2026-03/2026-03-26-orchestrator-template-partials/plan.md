# Plan

## Summary

Extract hardcoded prompt text fragments from Python constants and f-strings into
editable Markdown partial files, and add a `{{> partial}}` include directive to the
template renderer so that shared text can be maintained as easily as stage templates.

## Architectural Context

The orchestrator's prompt system lives in `orchestrator/src/nodes/`:

- **`prompt_renderer.py`** — Lightweight renderer supporting `{variable}` substitution,
  `{{#if var}}…{{/if}}` conditional blocks, and blank-line collapse. Stdlib only.
- **`templates/*.md`** — One Markdown template per stage (8 files).
- **`__init__.py`** — Defines `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER` as Python
  string constants, plus `create_stage_node()`.
- **`developer.py`, `qa.py`, `reviewer.py`, `docs.py`** — Each `_build_*_prompt()`
  constructs a stage-specific `extra` block as an f-string (scope restriction,
  begin-work instructions).
- **`pm.py`** — Constructs a preamble f-string and an `extra` block containing the
  plan document.

**Problem:** Five distinct text fragments that users want to tweak are buried in Python
code — either as module-level constants or as f-string expressions inside prompt builders.
Editing them requires modifying Python files and understanding the surrounding code.

**Existing constraint (constraint 1):** _"Any change to agent behaviour must be made in
the persona source files or the stage template (`.md`), **not** in Python
`_build_*_prompt()` function bodies."_ — The hardcoded extras currently violate this.

## Approach / Architecture

### 1. Introduce `{{> partial}}` include directive

Extend `render_prompt()` with a new processing step — resolved **before** `{{#if}}`
evaluation — that replaces `{{> partial-name}}` markers with the content of
`templates/partials/{partial-name}.md`. Included content participates in all
subsequent steps (conditionals, variable substitution, blank-line collapse).

Processing pipeline becomes:

```
Step 0 — Resolve {{> partial}} includes  (NEW)
Step 1 — Evaluate {{#if}} … {{/if}} blocks
Step 2 — Substitute {variable} placeholders
Step 3 — Collapse 3+ consecutive newlines
```

### 2. Create a `templates/partials/` directory

Extract five text fragments into individual `.md` files:

| Partial file | Current source | Content synopsis |
|---|---|---|
| `project-path-reminder.md` | `PROJECT_PATH_REMINDER` constant in `__init__.py` | Fixed reminder about `project_path` in tool calls |
| `wp-scope-reminder.md` | `WP_SCOPE_REMINDER` constant in `__init__.py` | Critical `{wp_id}` scope enforcement (has `{wp_id}` placeholder) |
| `scope-restriction.md` | f-string in `qa.py`, `reviewer.py`, `docs.py` | Bold scope restriction warning (has `{wp_id}` placeholder) |
| `begin-work-developer.md` | f-string in `developer.py` | Step-1 begin_work instruction + pipeline type (has `{wp_id}` placeholder) |
| `pm-preamble.md` | f-string in `pm.py` | PM start instruction with plan file reference (has `{plan_file}` placeholder) |

### 3. Update stage templates to use includes

Replace `{project_path_reminder}` and `{wp_scope_reminder}` variable placeholders with
`{{> project-path-reminder}}` and `{{> wp-scope-reminder}}` include directives. Absorb
stage-specific extras directly into the respective templates as `{{> ...}}` includes
(inside appropriate `{{#if wp_id}}` guards), eliminating the `extra` variable for stages
that use static-pattern extras (developer, qa, reviewer, docs).

### 4. Simplify Python node modules

- Remove `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER` constants from `__init__.py`.
- Remove `extra` construction from `developer.py`, `qa.py`, `reviewer.py`, `docs.py`.
- Remove preamble construction from `pm.py`.
- Each prompt builder only passes **runtime-dynamic** variables: `project_path`,
  `wp_id`, `plan_file` (PM), `plan_content` (PM).

### 5. Expose `load_partial()` as public API

Add `load_partial(name: str) -> str` to `prompt_renderer.py` alongside `load_template()`.
Same caching strategy. This also provides programmatic access for cases that need
partial content outside of templates (future use).

## Rationale

- **Aligns with constraint 1:** Moving prompt text out of Python into `.md` files.
- **Consistent editing experience:** Partials and templates are both `.md` files in
  the same directory tree, edited with the same tools.
- **Minimal syntax addition:** `{{> name}}` follows the established Mustache-inspired
  convention already used by `{{#if}}`. No external dependencies.
- **Backwards-compatible processing:** Includes are resolved first, so existing
  `{{#if}}` and `{variable}` syntax works within partials.
- **Alternative considered — load-and-pass:** Have Python call `load_partial()` and
  pass content as variables. Rejected because it still requires Python edits to change
  which partials are used, and doesn't simplify templates.

## Detailed Steps

### Step 1: Add `load_partial()` to `prompt_renderer.py`

- Define `_PARTIALS_DIR = _TEMPLATES_DIR / "partials"`.
- Implement `load_partial(name: str) -> str` — reads and caches
  `templates/partials/{name}.md`. Raises `FileNotFoundError` if missing.
- Add a `_partial_cache` dict (separate from `_cache`).
- Update `clear_template_cache()` to also clear `_partial_cache`.

### Step 2: Add `{{> partial}}` include resolution to `render_prompt()`

- Define a regex `_INCLUDE_RE` matching `{{> partial-name}}` on its own line
  (`^\{\{>\s*([\w-]+)\s*\}\}\n?`).
- In `render_prompt()`, add Step 0 before conditional evaluation: replace each
  `{{> name}}` match with the content of `load_partial(name)`.
- Recursive includes are not supported (no nesting of `{{> ...}}` within partials);
  document this explicitly.

### Step 3: Create partial files

Create `orchestrator/src/nodes/templates/partials/` directory with:

**`project-path-reminder.md`:**
```
Always use the project path above for all ledger tool calls.
```

**`wp-scope-reminder.md`:**
```
CRITICAL: Every MCP tool call MUST use `work_package_id={wp_id}`.
Do NOT reference or operate on any other work package.
```

**`scope-restriction.md`:**
```
**SCOPE RESTRICTION — You must ONLY operate on work package {wp_id}.
Do NOT call any MCP tool with a different work_package_id.**
```

**`begin-work-developer.md`:**
```
**Step 1 — BEFORE writing any code:** Call `ledger_begin_work` with
work_package_id={wp_id}, type="implementation", agent_role="Developer".

**Pipeline to start:** `implementation`
```

**`pm-preamble.md`:**
```
Please start your work on the project.

**Plan file:** {plan_file}
```

### Step 4: Update stage templates

Rewrite each template to use `{{> partial}}` includes instead of `{variable}`
pass-through for the extracted texts. The `extra` variable is retained only for
truly dynamic content (PM plan content). Specific changes per template:

**`developer.md`** — Replace `{project_path_reminder}`, `{wp_scope_reminder}`,
and `{extra}` block with three partial includes inside `{{#if wp_id}}`.

**`qa.md`, `reviewer.md`, `docs.md`** — Replace `{project_path_reminder}`,
`{wp_scope_reminder}`, and `{extra}` block with two partial includes.

**`security_auditor.md`, `release_engineer.md`** — Replace
`{project_path_reminder}` and `{wp_scope_reminder}` with partial includes.
No `extra` block exists (unchanged).

**`pm.md`** — Replace `{project_path_reminder}` with partial include. Replace
`{preamble}` conditional with `{{> pm-preamble}}` include. Retain `{extra}` for
plan content.

**`synthesis.md`** — Replace `{project_path_reminder}` with partial include. This
is the simplest template.

### Step 5: Simplify Python node modules

**`__init__.py`:**
- Remove `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER` constants.
- Keep export of `create_stage_node` unchanged.

**`developer.py`:**
- Remove import of `PROJECT_PATH_REMINDER`, `WP_SCOPE_REMINDER`.
- Remove the `extra` f-string construction.
- Variables dict: only `project_path` and `wp_id`.

**`qa.py`, `reviewer.py`, `docs.py`:**
- Remove import of `PROJECT_PATH_REMINDER`, `WP_SCOPE_REMINDER`.
- Remove the `extra` f-string construction.
- Variables dict: only `project_path` and `wp_id`.

**`security_auditor.py`, `release_engineer.py`:**
- Remove import of `PROJECT_PATH_REMINDER`, `WP_SCOPE_REMINDER`.
- Remove `.format(wp_id=wp_id)` call.
- Variables dict: only `project_path` and `wp_id`.

**`pm.py`:**
- Remove import of `PROJECT_PATH_REMINDER`.
- Remove preamble f-string; add `plan_file` as a variable.
- Variables dict: `project_path`, `plan_file`, `extra` (plan content).

**`synthesis.py`:**
- Remove import of `PROJECT_PATH_REMINDER`.
- Variables dict: only `project_path`.

### Step 6: Update `VARIABLES.md`

Rewrite the variable reference to reflect the simplified variable sets. Document
the new partial include system and list all partials with their placeholder
variables.

### Step 7: Update tests (`tests/test_prompt_renderer.py`)

- Add `TestLoadPartial` class — mirrors `TestLoadTemplate` tests (cache,
  FileNotFoundError, clear).
- Add `TestRenderPromptIncludes` class — tests for `{{> partial}}` resolution:
  truthy/falsy interaction, variable substitution in included content, missing
  partial raises error, recursive include not supported.
- Update `TestRenderPromptPipeline` — update the realistic template fragment
  to use `{{> ...}}` includes instead of `{project_path_reminder}`.
- Update `TestNodeModuleImports.test_public_constants_importable_from_nodes` —
  remove the assertion that `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER` are
  importable (they no longer exist). Replace with a test that verifies partials
  directory exists and contains the expected files.
- Update `TestModuleStructure` — add assertions about `load_partial`.

### Step 8: Update manifest documentation

**`constraints.md`:**
- Update constraint 1 to reference partials as a sanctioned location for prompt text.
- Update constraint 2 to note the project_path_reminder is now a partial file.
- Update constraint 3 to reference the simplified variables dict.
- Add constraint 3a item 8: `{{> partial-name}}` include syntax, resolution order,
  no recursive includes.

**`api-surface.md`:**
- Add `load_partial` to the Template Renderer table.
- Remove `PROJECT_PATH_REMINDER` / `WP_SCOPE_REMINDER` from the constants table.
- Add a Partials section listing all partial files and their placeholder variables.

## Dependencies

- No new external dependencies. The include directive uses Python stdlib (`re`,
  `pathlib`) just like the existing renderer.

## Required Components

### New files
- `orchestrator/src/nodes/templates/partials/project-path-reminder.md`
- `orchestrator/src/nodes/templates/partials/wp-scope-reminder.md`
- `orchestrator/src/nodes/templates/partials/scope-restriction.md`
- `orchestrator/src/nodes/templates/partials/begin-work-developer.md`
- `orchestrator/src/nodes/templates/partials/pm-preamble.md`

### Modified files
- `orchestrator/src/nodes/prompt_renderer.py` — add `load_partial()`,
  `_PARTIALS_DIR`, `_partial_cache`, include resolution step
- `orchestrator/src/nodes/__init__.py` — remove two constants
- `orchestrator/src/nodes/developer.py` — simplify prompt builder
- `orchestrator/src/nodes/qa.py` — simplify prompt builder
- `orchestrator/src/nodes/reviewer.py` — simplify prompt builder
- `orchestrator/src/nodes/docs.py` — simplify prompt builder
- `orchestrator/src/nodes/security_auditor.py` — simplify prompt builder
- `orchestrator/src/nodes/release_engineer.py` — simplify prompt builder
- `orchestrator/src/nodes/pm.py` — simplify prompt builder
- `orchestrator/src/nodes/synthesis.py` — simplify prompt builder
- `orchestrator/src/nodes/templates/developer.md` — use includes
- `orchestrator/src/nodes/templates/qa.md` — use includes
- `orchestrator/src/nodes/templates/reviewer.md` — use includes
- `orchestrator/src/nodes/templates/docs.md` — use includes
- `orchestrator/src/nodes/templates/security_auditor.md` — use includes
- `orchestrator/src/nodes/templates/release_engineer.md` — use includes
- `orchestrator/src/nodes/templates/pm.md` — use includes
- `orchestrator/src/nodes/templates/synthesis.md` — use includes
- `orchestrator/src/nodes/templates/VARIABLES.md` — rewrite
- `orchestrator/tests/test_prompt_renderer.py` — update and add tests
- `orchestrator/docs/agents/project-manifest/constraints.md` — update constraints
- `orchestrator/docs/agents/project-manifest/api-surface.md` — update API docs

## Assumptions

- The `preamble` template variable is only used by PM (always set) and other stages
  (never set); no stage dynamically decides whether to include a preamble at runtime
  based on conditional logic beyond "always" or "never." Verified by reading all 8 node
  modules.
- The `extra` variable after this change is only needed by PM (plan document content).
  All other `extra` uses are replaced by partial includes.
- No external code imports `PROJECT_PATH_REMINDER` or `WP_SCOPE_REMINDER` from
  `src.nodes`. These constants are internal to the orchestrator.

## Constraints

- **Stdlib only:** The renderer must not gain any non-stdlib imports (constraint 3a.6).
- **No recursive includes:** `{{> ...}}` directives inside partial files are not
  resolved. Document this limitation. Avoids infinite-loop risk and keeps the
  renderer predictable.
- **Include marker must be on its own line:** Consistent with the `{{#if}}` marker
  rule (constraint 3a.3). Inline `{{> name}}` is not processed.
- **Cross-platform:** Partial file loading must use `pathlib.Path`, not hardcoded
  separators (cross-platform policy).

## Out of Scope

- Template inheritance or layout blocks (unnecessary for this use case).
- Recursive partial includes.
- Parameterized partials (e.g., `{{> partial arg=value}}`). Variables in partials
  are resolved by the same dict passed to `render_prompt()`.
- Changes to persona system prompt files — they are unaffected.
- Orchestrator changelog entry — handled by a separate workflow step.

## Acceptance Criteria

- All 5 partial files exist in `templates/partials/` and contain the expected text.
- `load_partial("project-path-reminder")` returns the file content.
- `render_prompt()` resolves `{{> partial-name}}` directives before evaluating
  conditionals and substituting variables.
- Variables inside included partials (e.g., `{wp_id}`) are substituted correctly.
- Missing partial in a `{{> name}}` directive raises `FileNotFoundError`.
- `clear_template_cache()` also clears the partial cache.
- All 8 stage templates use `{{> ...}}` includes for shared text.
- All 8 node modules no longer import `PROJECT_PATH_REMINDER` / `WP_SCOPE_REMINDER`.
- `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER` no longer exist in `__init__.py`.
- The rendered output of each stage prompt is identical to the current output
  (verified via snapshot/regression tests).
- All existing tests pass; new tests cover `load_partial()` and `{{> ...}}` includes.
- `VARIABLES.md`, `api-surface.md`, and `constraints.md` are updated.

## Testing Strategy

1. **Unit tests for `load_partial()`:** Cache behaviour, FileNotFoundError for
   missing partials, clear_template_cache interaction, returns `str`.
2. **Unit tests for `{{> partial}}` resolution:** Single include, multiple includes,
   interaction with `{{#if}}` blocks, variable substitution within included content,
   inline `{{> ...}}` not processed, missing partial raises error.
3. **Regression tests:** For each of the 8 stages, render the template with the same
   variables as before and assert the output matches the previous output exactly.
   This ensures the refactor is behaviour-preserving.
4. **Integration tests:** Verify all stage modules still import cleanly
   (`test_stage_module_importable`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Rendered output diverges from current output** | Regression tests comparing pre/post output for all 8 stages. Run before merging. |
| **Include regex collides with existing template content** | The `{{> name}}` pattern is new — no existing template uses `{{>`. The regex requires own-line placement, matching the `{{#if}}` convention. |
| **Partial file not found at runtime** | Each `load_template()` call already happens at module import time (e.g., `_TEMPLATE = load_template("developer")`). Include resolution happens at render time, so a missing partial would fail on first prompt render. Mitigated by: (a) tests that render every template, (b) the preflight script could optionally validate partial existence. |
| **Developers add recursive includes** | Renderer does not recurse. Document the limitation in constraints.md and VARIABLES.md. A future enhancement could add one level of recursion if needed. |
| **External code depends on removed constants** | Grep confirms only orchestrator-internal code uses them. `.context/` files are auto-generated and will be refreshed. |
