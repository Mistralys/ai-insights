# Template Variable Reference

Documents the expected `variables` dict for each stage template. Use this when
calling `render_prompt(load_template(stage), variables)`.

> **Note:** Shared text fragments (project-path reminder) are embedded directly
> in templates via `{{> partial-name}}` include directives rather than being
> passed as Python variables. The variables dict is now minimal — only
> runtime-dynamic values.

---

## Variable Descriptions

| Variable | Required? | Description |
|---|---|---|
| `project_path` | **required** | Absolute path to the plan directory. Source: `state["project_path"]`. |
| `plan_file` | pm only | Relative path of the plan document within the project, e.g. `"plan.md"`. Substituted into the `{{> pm-preamble}}` partial. Source: `state.get("plan_file", "plan.md")`. |
| `extra` | pm only | Plan document content block rendered after the standard header. Source: `plan_path.read_text(...)`. |

> `render_prompt()` uses `defaultdict(str)`, so any key that is omitted or left as
> empty string safely resolves to `""`. Shared text is now supplied by partial
> files in `templates/partials/` rather than Python constants.

---

## Per-Template Variable Matrix

**Key:** ✅ = required · — = not used

| Template | `project_path` | `plan_file` | `extra` | Partials used |
|---|:---:|:---:|:---:|---|
| `developer.md` | ✅ | — | — | `project-path-reminder` |
| `qa.md` | ✅ | — | — | `project-path-reminder` |
| `reviewer.md` | ✅ | — | — | `project-path-reminder` |
| `docs.md` | ✅ | — | — | `project-path-reminder` |
| `security_auditor.md` | ✅ | — | — | `project-path-reminder` |
| `release_engineer.md` | ✅ | — | — | `project-path-reminder` |
| `pm.md` | ✅ | ✅ | opt | `pm-preamble`, `project-path-reminder` |
| `synthesis.md` | ✅ | — | — | `project-path-reminder` |

---

## Template Partials

Partials are reusable Markdown fragments stored in `templates/partials/`. Include them
in a stage template using the `{{> partial-name}}` directive (filename without the
`.md` extension):

```
{{> partial-name}}
```

Partials are resolved **before** variable substitution, so included content
participates fully in all downstream processing steps (`{variable}` substitution,
blank-line collapse).

**Limitation:** Partials support **one level** of `{{> ...}}` nesting. A `{{> ...}}`
directive found inside a partial is expanded (its content inserted), but any
`{{> ...}}` directives inside that second-level partial are **not** resolved.
Fully recursive includes are not supported.

### Partial Catalogue

| Partial file | Placeholder variables | Used by |
|---|---|---|
| `project-path-reminder.md` | _(none)_ | All templates |
| `pm-preamble.md` | `{plan_file}` | `pm` |

> Placeholder variables listed above are resolved from the outer template's variable
> dict after the partial content is inlined — they are **not** passed separately to
> `load_partial()`.

---

## Usage Patterns

### Stage nodes (`developer`, `qa`, `reviewer`, `docs`, `security_auditor`, `release_engineer`)

```python
from src.nodes import create_stage_node
from src.nodes.prompt_renderer import load_template, render_prompt

def _build_security_auditor_prompt(state: WorkflowState) -> str:
    return render_prompt(load_template("security_auditor"), {
        "project_path": state["project_path"],
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

### Synthesis stage

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

- All six stage templates (`developer`, `qa`, `reviewer`, `docs`, `security_auditor`,
  `release_engineer`) share an identical structure: project-path header + the
  `{{> project-path-reminder}}` partial. This is by design — template inheritance is
  deliberately out of scope to keep each file independently readable.
- Role-specific instructions (workflow steps, tool guidance, persona identity) live
  entirely in the agent's system prompt, loaded from `personas/ledger/claude-code/`.
