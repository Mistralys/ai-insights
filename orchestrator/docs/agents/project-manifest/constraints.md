# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas for the **AI Insights Orchestrator**.

### Constraint Entry Format

New constraint entries should follow this structure:

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Prompt Architecture Constraints

### 1. Persona Files Are the Source of Truth for Agent Behaviour

**Rule:** All identity declarations, workflow step enumerations, and MCP tool-call instructions live exclusively in persona system prompts (`personas/ledger/claude-code/`). User-turn prompts in `_build_*_prompt()` functions must contain only runtime context that the persona file cannot know: concrete `project_path`, `wp_id`, and plan content. Each prompt builder assembles a variables dict and calls the template renderer — it must not embed workflow logic or behavioural instructions in Python string literals. Any change to agent behaviour must be made in the persona source files or the stage template (`.md`), **not** in Python `_build_*_prompt()` function bodies.

**Rationale:** Splitting identity from runtime context keeps persona files reviewable, versionable, and reusable across different orchestration surfaces without coupling them to Python implementation details. Template files (`.md`) make runtime context editable without touching Python.

**Anti-pattern:**
```python
# ❌ WRONG — workflow instructions embedded in the user-turn prompt
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return f"""
    CRITICAL — EVERY MCP TOOL CALL MUST include `project_path='{state["project_path"]}'`.

    Your workflow:
    1. Call ledger_get_next_action with agent_role: "Developer"
    2. Read the WP spec
    3. Implement the changes
    """
```

**Correct pattern:**
```python
# ✅ CORRECT — cache template at module level, assemble variables and delegate to the renderer
from src.nodes.prompt_renderer import load_template, render_prompt

_TEMPLATE = load_template("developer")

def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

---

### 2. The `project_path` Reminder Is Permanent

**Rule:** The user-turn prompt must always include a reminder to use the specified `project_path` for all ledger tool calls. The reminder text lives in `templates/partials/project-path-reminder.md` and is included in every stage template via `{{> project-path-reminder}}`. Persona Markdown files are static and cannot contain runtime values, so this text lives in the user-turn prompt layer. The `{{> project-path-reminder}}` include in each stage template must never be removed.

**Rationale:** Without the reminder the agent may omit `project_path` from MCP tool calls, causing every ledger operation to fail.

---

### 3. Prompt Templates Are Structurally Uniform Within Their Category

**Rule:** The six WP-scoped prompt builder functions (`_build_developer_prompt`, `_build_qa_prompt`, `_build_security_auditor_prompt`, `_build_reviewer_prompt`, `_build_release_engineer_prompt`, `_build_docs_prompt`) must each call `render_prompt(load_template("<stage>"), variables)` from `src.nodes.prompt_renderer`. The variables dict must include `project_path` and `wp_id` (at minimum). Shared text fragments — path reminders, scope enforcement, and stage-specific instructions — are embedded in templates via `{{> partial-name}}` directives rather than passed as Python variables. Any change to what the six WP-scoped prompts share must be made in the shared template structure or the relevant partial file, not in individual Python function bodies. The PM and synthesis builders are documented exceptions (no `wp_id` block; PM adds plan content; synthesis omits WP scope).

**Rationale:** Structural uniformity makes the prompt layer auditable at a glance and prevents silent divergence between nodes that should behave identically. Template files (`.md`) are the canonical source — editing Python string literals in `_build_*_prompt()` bodies is the anti-pattern.

---

### 3a. Template Syntax Rules

**Rule:** All stage templates MUST follow these constraints:

1. **Location:** `orchestrator/src/nodes/templates/<stage>.md` — one file per stage, named exactly as the stage identifier (e.g. `developer.md`).
2. **Variable substitution:** Use `{variable}` placeholders. Missing keys resolve to empty string — do not rely on this as a feature; always pass expected variables explicitly.
3. **Conditional blocks:** Use `{{#if variable}}` … `{{/if}}`. Both markers must appear **on their own line** — inline markers are not treated as conditionals (they are consumed as Python format-string double-brace escapes instead, producing `{#if variable}` in the output).
4. **No nesting:** Nested `{{#if}}` blocks are not supported.
5. **No `{{else}}`:** Absent from the renderer — factor into two separate `{{#if}}` / `{{#if not}}` blocks (or pre-process in Python).
6. **No external template engines:** Do not add Jinja2, Mako, or similar libraries. The renderer uses Python stdlib only (`re`, `pathlib`, `collections.defaultdict`).
7. **Double-brace escaping:** `{{variable}}` is **not** a valid syntax marker — only `{{#if}}` / `{{/if}}` are recognised by the renderer. A literal `{{...}}` in output cannot be produced via the current renderer.
8. **Include directives:** Stage templates may reference shared Markdown fragments in `templates/partials/` using `{{> partial-name}}` (filename without `.md` extension). Includes are expanded **before** `{{#if}}` evaluation and variable substitution, so included content participates fully in all downstream processing steps. Partials may themselves contain one level of `{{> ...}}` includes — these are expanded (the partial's partial is inlined), but any `{{> ...}}` directives inside that second-level partial are **not** further resolved. Fully recursive expansion is not supported.

**Rationale:** The minimal syntax keeps prompts editable by non-developers and prevents the template layer from growing into a Turing-complete DSL that defeats the "runtime context only" principle.

---

## Supervisor & Routing Constraints

### 4. No LLM Calls in the Supervisor

**Rule:** The supervisor node must not make LLM calls. All routing decisions must come from the MCP server's `ledger_get_next_action` tool. The supervisor is a pure-Python router.

**Rationale:** LLM-based routing introduces non-determinism into an otherwise deterministic pipeline. Delegating routing to the ledger tools ensures the supervisor's behaviour is fully specified by the workflow manifest.

---

### 5. Manifest-Derived Constants

**Rule:** `PIPELINE_ROLES`, `PIPELINE_SEQUENCE`, and action→role maps in `src/config.py` must be derived from `shared/workflow-manifest.json` at import time. Never hardcode role names or pipeline ordering as bare string literals.

**Rationale:** The workflow manifest is the canonical source of pipeline ordering and role naming. Hardcoded constants drift silently when the manifest is updated.

---

### 6. Circuit-Breaker Threshold: 3 Consecutive Failures

**Rule:** A work package that accumulates ≥3 consecutive stage failures must be skipped for the remainder of the run. The threshold value must be read from configuration, not hardcoded.

**Rationale:** Without a circuit-breaker a pathologically failing WP will stall the entire orchestration run indefinitely.

---

## Node Implementation Constraints

### 7. Stage Node Isolation

**Rule:** Each stage node must create its own Deep Agent instance per invocation. No state — including LLM client instances, MCP connections, or tool objects — may be shared between stage invocations.

**Rationale:** Shared state between stage invocations introduces subtle coupling that makes failures hard to diagnose and prevents clean retry semantics.

---

### 8. Cross-Platform File Locking

**Rule:** File locking for the JSONL run log must use `msvcrt` on Windows and `fcntl` on Unix. All path construction must use `pathlib.Path`, never bare string concatenation.

**Rationale:** The orchestrator must run in CI environments on both Linux and Windows. Platform-specific locking ensures log integrity without blocking on a missing system call.

---

## LangGraph-Specific Constraints

### 9. LangGraph Config Annotations Require `Optional[RunnableConfig]`

**Rule:** In files that use `from __future__ import annotations`, always annotate LangGraph config parameters as `Optional[RunnableConfig]`, **not** `RunnableConfig | None`.

**Rationale:** `from __future__ import annotations` causes Python to stringify all type hints at parse time. The union syntax `RunnableConfig | None` becomes the string `"RunnableConfig | None"`, which LangGraph's config injection does not recognise. `Optional[RunnableConfig]` produces `"Optional[RunnableConfig]"`, which is in the allowlist.

**Symptom:** `get_run_logger: config is None` warnings; JSONL events only flushed at run end rather than incrementally.

**Anti-pattern:**
```python
# ❌ WRONG — union syntax is stringified to an unrecognised form
from __future__ import annotations
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: RunnableConfig | None = None) -> WorkflowState:
    ...
```

**Correct pattern:**
```python
# ✅ CORRECT — Optional[] form is in LangGraph's annotation allowlist
from __future__ import annotations
from typing import Optional
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: Optional[RunnableConfig] = None) -> WorkflowState:
    ...
```

---

## Review & Documentation Conventions

### 10. `documentation-forward` Is the Named Review-to-Documentation Handoff Convention

**Rule:** When a code-review pipeline identifies documentation gaps, the reviewer must record them as structured pipeline comments with type `documentation-forward`. The documentation stage resolves these comments. This is the standard cross-pipeline handoff mechanism for documentation work identified during review.

**Format:** Comment objects in the code-review pipeline result must use:
```json
{
  "type": "documentation-forward",
  "priority": "medium",
  "note": "[documentation-forward] <description of documentation gap and suggested resolution>"
}
```

**Rationale:** Naming the convention enforces a consistent, machine-readable handoff signal between the reviewer and documentation agents, preventing documentation gaps from being silently dropped when the code-review pipeline completes.

**Who resolves it:** The documentation stage agent reads open `documentation-forward` comments from the most recent code-review pipeline and addresses each one before marking the WP complete.

---

### 11. Cross-WP Guard Exempts Read-Only Tools

**Rule:** `restrict_to_wp()` in `src/utils/tool_wrappers.py` must only guard *write* tools. Read-only MCP tools — those listed in the `_READ_ONLY_TOOLS` frozenset — must be completely exempt: no `ainvoke` wrapper, no WP-ID injection, no cross-WP rejection. The exemption set must be maintained as a module-level constant in `tool_wrappers.py` and covered by dedicated tests.

**Rationale:** Agents legitimately need to read other work packages for context (pipeline comments, handoff notes, dependency status). When read operations triggered the guard, stages failed spuriously. Combined with the circuit-breaker (constraint 6), this caused false cancellation of work packages whose pipelines had actually completed successfully.

**Current read-only tools:** `ledger_get_work_package`, `ledger_list_work_packages`, `ledger_get_next_action`, `ledger_get_project_status`, `ledger_get_handoff_status`, `ledger_detect_project`, `ledger_list_projects`, `ledger_help`.

**Anti-pattern:**
```python
# ❌ WRONG — guard applied uniformly to all tools, blocking cross-WP reads
for tool in tools:
    object.__setattr__(tool, "ainvoke", _guarded_ainvoke)
```

**Correct pattern:**
```python
# ✅ CORRECT — read-only tools skip the guard entirely
for tool in tools:
    if getattr(tool, "name", "") in _READ_ONLY_TOOLS:
        continue
    object.__setattr__(tool, "ainvoke", _guarded_ainvoke)
```

---

### 12. Cross-WP Guard Soft-Fails Before Hard Kill

**Rule:** `restrict_to_wp()` in `src/utils/tool_wrappers.py` must use a soft-fail strategy for cross-WP write attempts before escalating to a hard exception. The first two violations return a descriptive error string to the agent; the third violation raises `ValueError` (hard kill). The strike counter must be shared across all tool closures within a single `restrict_to_wp` invocation.

**Rationale:** LLM agents sometimes hallucinate or reuse tool call templates with incorrect WP IDs. Throwing a hard exception immediately bypasses the agent's ability to see the error and self-correct, often resulting in dialogue loss if safety nets are not in place. Soft-failing gives the agent two chances to fix the ID; the hard kill on the third strike prevents infinite retry loops.

---

### 13. Error-Path Dialogue Capture Must Be Non-Fatal

**Rule:** When an agent invocation crashes (e.g. from context overflow or token limits) after partial messages have been collected, `create_stage_node()` in `src/nodes/__init__.py` must attempt to write those messages to a Markdown file. This capture must execute inside a broad `except Exception` block that silently swallows any filesystem errors, ensuring the original pipeline exception is re-raised and preserved.

**Rationale:** If writing the partial dialogue to disk triggers a secondary error (e.g. `PermissionError`), it would overshadow the original exception that broke the stage, destroying critical debugging context.

---

## MCP Server Dependency

### 14. MCP Server Must Be Pre-Built

**Rule:** The orchestrator spawns the MCP server as a subprocess. `mcp-server/dist/index.js` must exist before any orchestration run begins. Use `node scripts/run-orchestrator.js` for automatic build-freshness checks rather than launching `orchestrator` directly.

**Rationale:** The orchestrator has no fallback if the MCP server subprocess fails to start — all ledger operations will fail silently or with unhelpful errors.

---

## Cross-WP Escape Prevention

### 15. Post-Completion Guard Is the Authoritative Cross-WP Escape Mechanism

**Rule:** When `ledger_complete_pipeline` succeeds for the active work package, all subsequent `ledger_get_next_action` calls within the same stage turn must be intercepted and must return a synthetic `{"action": "WAIT"}` response. This interception is implemented programmatically in `_install_post_completion_guard` / `_install_complete_pipeline_tracker` (in `src/nodes/__init__.py`) and must not be replicated or replaced by prompt-based mechanisms.

**Rationale:** Without interception, the LLM agent receives cross-WP routing instructions from `ledger_get_next_action` immediately after completing the active pipeline, causing it to escape to the next work package within the same stage turn. The programmatic guard is a hard guarantee that the LLM cannot ignore.

---

### 16. Rejected Pattern: User-Turn Prompt WP-Scoping

**Rule:** Do not add `wp_id` template variables or explicit WP-scope instructions to stage prompts with the intent of preventing cross-WP escape. Do not emit "you are scoped to WP-XXX" strings in user-turn prompts or persona system prompts for this purpose.

**Rationale:** Both the supervisor and the implementing agent use the ledger to determine the current work package — they are always in sync. Prior experience with WP-scoping in prompts created agent confusion without providing meaningful safety. The programmatic post-completion guard in `nodes/__init__.py` (constraint 15) is the sole authoritative mechanism for preventing cross-WP escape. Adding prompt-based scoping alongside it does not improve safety; it introduces redundant, fragile instructions that the LLM may misinterpret.

**Anti-pattern:**
```python
# ❌ WRONG — prompt-based WP scoping to prevent cross-WP escape
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
        "scope_warning": f"You are ONLY permitted to work on {wp_id}.",  # ← rejected
    })
```

**Correct pattern:**
```python
# ✅ CORRECT — runtime context only; scope enforcement is programmatic
def _build_developer_prompt(state: WorkflowState) -> str:
    wp_id = state.get("current_wp_id", "")
    return render_prompt(_TEMPLATE, {
        "project_path": state["project_path"],
        "wp_id": wp_id,
    })
```

---

## Code Quality

### 17. Run `ruff check` After Every Code Change

**Rule:** After making any change to Python source files in `orchestrator/`, run `python3 -m ruff check .` from the `orchestrator/` directory and resolve all reported violations before considering the task complete. This applies to every change — including single-line edits, refactors, and new files.

**Rationale:** Ruff is the project's linter and catches style violations, unused imports, undefined names, and common bugs at near-zero cost. Skipping the check after a change allows lint errors to accumulate silently and compounds the cleanup burden for future agents.

**How to run:**
```bash
cd orchestrator
python3 -m ruff check .
```

**Forbidden shortcut:** Do not mark a coding task complete, write a changelog entry, or hand off to the next pipeline stage without a clean ruff output.

---

## Model Configuration Constraints

### 18. Model Selection Is Persona-Driven — No MODEL_NAME

**Rule:** The orchestrator must never read a `MODEL_NAME` environment variable or accept a `--model` CLI flag for LLM model selection. Each stage's model slug is resolved exclusively via `Config.resolve_model_for_stage(stage)`, which reads from `Config.stage_models`. That dict is populated once at startup by `extract_persona_model_slugs()` from `personas/ledger/src/meta/` YAML files (`model_slug` per-persona, falling back to `default_model_slug` in `_shared.yaml`). The resolved model is passed directly to `create_deep_agent()` and logged in every `stage_start`, `stage_complete`, and `stage_error` JSONL entry.

**Rationale:** Persona YAML files are the single source of truth for which model each agent role uses. Centralising model resolution there ensures that swapping models for a specific role requires only a one-field change in the persona metadata — no environment overrides or command-line flags to remember. A global `MODEL_NAME` override would silently apply to all stages, invalidating the per-stage selection.

**Anti-pattern:**
```python
# ❌ WRONG — reading MODEL_NAME from environment
model = os.environ.get("MODEL_NAME", "claude-sonnet-4-6")
agent = create_deep_agent(model=model, ...)
```

**Correct pattern:**
```python
# ✅ CORRECT — resolve from Config.stage_models via Config.resolve_model_for_stage
resolved_model: str = _app_config.resolve_model_for_stage(stage)
agent = create_deep_agent(model=resolved_model, ...)
```

**Forbidden patterns:**
- `os.environ.get("MODEL_NAME", ...)` anywhere in the orchestrator source
- `argparse` / `click` flags for `--model` that override per-stage selection
- Hardcoding a model slug string in `create_stage_node()` or any node factory
