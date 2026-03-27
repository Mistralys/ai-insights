# Template Variable Reference

Documents the expected `variables` dict for each stage template. Use this when
calling `render_prompt(load_template(stage), variables)`.

> **Note:** As of WP-003, shared text fragments (project-path reminder, scope
> reminders, stage-specific instructions) are embedded directly in templates via
> `{{> partial-name}}` include directives rather than being passed as Python
> variables. The variables dict is now minimal — only runtime-dynamic values.

---

## Variable Descriptions

| Variable | Required? | Description |
|---|---|---|
| `project_path` | **required** | Absolute path to the plan directory. Source: `state["project_path"]`. |
| `wp_id` | optional | Active work package ID, e.g. `"WP-001"`. Pass empty string when absent — `{{#if wp_id}}` blocks (scope reminders, stage instructions) are then suppressed. Source: `state.get("current_wp_id", "")`. |
| `plan_file` | pm only | Relative path of the plan document within the project, e.g. `"plan.md"`. Substituted into the `{{> pm-preamble}}` partial. Source: `state.get("plan_file", "plan.md")`. |
| `extra` | pm only | Plan document content block rendered after the standard header. Source: `plan_path.read_text(...)`. |

> `render_prompt()` uses `defaultdict(str)`, so any key that is omitted or left as
> empty string safely resolves to `""`. Shared text is now supplied by partial
> files in `templates/partials/` rather than Python constants — see the partials
> directory for content that was previously in `PROJECT_PATH_REMINDER`,
> `WP_SCOPE_REMINDER`, and the f-string `extra` builders.

---

## Per-Template Variable Matrix

**Key:** ✅ = required · opt = optional · — = not used

| Template | `project_path` | `wp_id` | `plan_file` | `extra` | Partials used |
|---|:---:|:---:|:---:|:---:|---|
| `developer.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`†, `begin-work-developer`† |
| `qa.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`†, `scope-restriction`† |
| `reviewer.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`†, `scope-restriction`† |
| `docs.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`†, `scope-restriction`† |
| `security_auditor.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`† |
| `release_engineer.md` | ✅ | opt | — | — | `project-path-reminder`, `wp-scope-reminder`† |
| `pm.md` | ✅ | — | ✅ | opt | `pm-preamble`, `project-path-reminder` |
| `synthesis.md` | ✅ | — | — | — | `project-path-reminder` |

† = included only when `wp_id` is truthy (inside `{{#if wp_id}}` block).

---

## Template Partials

Partials are reusable Markdown fragments stored in `templates/partials/`. Include them
in a stage template using the `{{> partial-name}}` directive (filename without the
`.md` extension):

```
{{> partial-name}}
```

Partials are resolved **before** `{{#if}}` evaluation and variable substitution, so
included content participates fully in all downstream processing steps (conditionals,
`{variable}` substitution, blank-line collapse).

**Limitation:** Partials support **one level** of `{{> ...}}` nesting. A `{{> ...}}`
directive found inside a partial is expanded (its content inserted), but any
`{{> ...}}` directives inside that second-level partial are **not** resolved.
Fully recursive includes are not supported.

### Partial Catalogue

| Partial file | Placeholder variables | Used by |
|---|---|---|
| `project-path-reminder.md` | _(none)_ | All templates |
| `wp-scope-reminder.md` | `{wp_id}` | All WP-scoped templates |
| `scope-restriction.md` | `{wp_id}` | `developer` (via `begin-work-developer`), `qa`, `reviewer`, `docs` |
| `begin-work-developer.md` | `{wp_id}` | `developer` |
| `pm-preamble.md` | `{plan_file}` | `pm` |

> Placeholder variables listed above are resolved from the outer template's variable
> dict after the partial content is inlined — they are **not** passed separately to
> `load_partial()`.

---

## Usage Patterns

### WP-scoped stages (`developer`, `qa`, `reviewer`, `docs`, `security_auditor`, `release_engineer`)

```python
from src.nodes import create_stage_node
from src.nodes.prompt_renderer import load_template, render_prompt

def _build_security_auditor_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(load_template("security_auditor"), {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

### PM stage

```python
from src.nodes import create_stage_node
from src.nodes.prompt_renderer import load_template, render_prompt

def _build_pm_prompt(state: WorkflowState) -> str:
    project_path = state["project_path"]
    plan_file = state.get("plan_file", "plan.md")
    plan_content = Path(project_path, plan_file).read_text(encoding="utf-8")
    return render_prompt(load_template("pm"), {
        "project_path": project_path,
        "plan_file": plan_file,
        "extra": f"---\n\n# Plan Document\n\n{plan_content}",
    })
```

### Synthesis stage (no wp_id)

```python
from src.nodes import create_stage_node
from src.nodes.prompt_renderer import load_template, render_prompt

def _build_synthesis_prompt(state: WorkflowState) -> str:
    return render_prompt(load_template("synthesis"), {
        "project_path": state["project_path"],
    })
```

---

## Notes

- `developer`, `qa`, `reviewer`, and `docs` apply a **two-layer scope reinforcement**:
  `{{> wp-scope-reminder}}` (Layer 3a, baseline) plus `{{> scope-restriction}}`
  (Layer 3b, per-node). `security_auditor` and `release_engineer` use Layer 3a only.
  See [architecture.md — Two-layer prompt scope reinforcement](../../../docs/architecture.md).
- All four WP-scoped-with-extra templates (`developer`, `qa`, `reviewer`, `docs`) share
  an identical template structure. Likewise `security_auditor` and `release_engineer`
  are structurally identical. This is by design — template inheritance is deliberately
  out of scope to keep each file independently readable.
