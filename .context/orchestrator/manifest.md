# Orchestrator - Manifest
_SOURCE: Project manifest (overview, tech stack, constraints, API surface, architecture)_
# Project manifest (overview, tech stack, constraints, API surface, architecture)
```
// Structure of documents
└── orchestrator/
    └── docs/
        └── agents/
            └── project-manifest/
                └── README.md
                └── api-surface.md
                └── constraints.md

```
###  Path: `/orchestrator/docs/agents/project-manifest/README.md`

```md
# Orchestrator — Project Manifest

> Manifest hub for the **AI Insights Orchestrator** — a headless, deterministic alternative to IDE-based agent workflows using LangGraph + Deep Agents.

---

## Quick Reference

| Property | Value |
|----------|-------|
| **Language** | Python 3.11+ |
| **Runtime** | CPython |
| **Architecture** | LangGraph StateGraph + Deep Agents |
| **Package Manager** | pip (setuptools) |
| **Test Framework** | pytest (374 tests) |
| **Entry Point** | `orchestrate` CLI (`src/cli.py`) |

### Development Commands

```bash
cd orchestrator
pip install -e ".[dev,anthropic]"   # Install with dev + Anthropic extras
pytest                               # Run all tests
pytest -m "not live"                 # Skip tests requiring API keys
ruff check src/ tests/               # Lint
```

---

## Manifest Sections

The orchestrator's documentation lives in `orchestrator/docs/`. The documents below together form its project manifest.

| Section | Document | Contents |
|---------|----------|----------|
| **Overview & Usage** | [README.md](../../../README.md) | Prerequisites, installation, configuration, CLI reference, architecture overview, troubleshooting |
| **Architecture & Data Flows** | [architecture.md](../../architecture.md) | Stage node lifecycle, MCP tool wrapping, `WorkflowState` fields, JSONL log entry types |
| **Routing Logic** | [supervisor-routing.md](../../supervisor-routing.md) | Deterministic supervisor algorithm, special exits, action sets, circuit-breaker mechanics |
| **Public API Surface** | [public-api.md](../../public-api.md) | CLI entry point, graph construction, supervisor factory, utility functions |
| **Constraints & Conventions** | [project-manifest/constraints.md](constraints.md) | Numbered constraints and conventions governing orchestrator development: prompt architecture rules, LLM boundaries, circuit-breaker, cross-platform policy |
| **API Surface (manifest)** | [project-manifest/api-surface.md](api-surface.md) | Quick-reference: 16 JSONL event types, enriched fields, `_format_duration`, `parse_tool_response`, progress-tracking state fields |
| **Log Schema** | [jsonl-log-schema.md](../../jsonl-log-schema.md) | JSONL schema reference: 16 event types, full field reference, duration conventions, JSON examples |
| **Smoke Testing** | [smoke-testing.md](../../smoke-testing.md) | Dispatch loop verification runbook |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Graph framework | LangGraph ≥0.4 | StateGraph-based workflow with deterministic routing |
| Agent execution | Deep Agents ≥0.3 (via LangChain) | Coding-agent execution within each pipeline stage |
| MCP integration | langchain-mcp-adapters ≥0.2 | Wraps MCP tools for LangChain tool interface |
| LLM providers | langchain-anthropic / langchain-google-genai | Claude (Anthropic) or Gemini (Google) |
| Checkpointing | langgraph-checkpoint-sqlite | SQLite-backed run resume via `--resume` |
| Configuration | python-dotenv | `.env`-based config with auto-detected LLM provider |
| Testing | pytest + pytest-asyncio | Async-aware tests with integration and live marks |
| Linting | ruff | Line-length 100, target Python 3.11 |

### Architectural Patterns

- **Deterministic supervisor**: Pure-Python router with no LLM calls — delegates all routing to the MCP server's `ledger_get_next_action` tool.
- **Stage node factories**: Each of the 8 stages (pm, developer, qa, security_auditor, reviewer, release_engineer, docs, synthesis) is a factory-generated node that loads a persona prompt, wraps MCP tools, and creates a Deep Agent.
- **Manifest-derived constants**: Pipeline routing maps and role names are derived from `shared/workflow-manifest.json` at import time.
- **Cross-platform file locking**: `msvcrt` (Windows) / `fcntl` (Unix) for the JSONL run log.

---

## Constraints & Conventions

The authoritative constraint list has been promoted to a dedicated file:

> **[project-manifest/constraints.md](constraints.md)** — 11 numbered constraints covering persona authority, injection-safety, prompt uniformity, LLM routing, manifest-derived constants, MCP pre-build, circuit-breaker, stage isolation, cross-platform locking, documentation-forward convention, and LangGraph config annotations.

---

## File Tree

```
orchestrator/
├── pyproject.toml              # Package metadata, extras, scripts
├── README.md                   # Full user-facing documentation
├── requirements.txt            # Pinned dependencies
├── changelog.md                # Version history
├── module-context.yaml         # CTX Generator config
├── docs/
│   ├── agents/
│   │   └── project-manifest/
│   │       ├── README.md       # ← You are here
│   │       ├── constraints.md  # Numbered constraint catalogue (11 rules)
│   │       └── api-surface.md  # JSONL event types, enriched fields, utility refs
│   ├── architecture.md         # Stage nodes, state management, log types
│   ├── supervisor-routing.md   # Routing algorithm, exits, circuit-breaker
│   ├── public-api.md           # Public functions and entry points
│   ├── jsonl-log-schema.md     # Run log field reference
│   └── smoke-testing.md        # Dispatch loop verification
├── src/
│   ├── __init__.py
│   ├── cli.py                  # CLI entry point (orchestrate command)
│   ├── config.py               # .env loading, provider detection, constants
│   ├── graph.py                # StateGraph assembly and compilation
│   ├── state.py                # WorkflowState TypedDict with reducers
│   ├── supervisor.py           # Deterministic router (no LLM)
│   ├── mcp_client.py           # MCP server subprocess lifecycle
│   ├── nodes/                  # Stage node factories (8 stages)
│   └── utils/                  # Tool wrappers, persona loader, logger, filelock
├── tests/                      # 374 tests (unit, integration, live)
└── checkpoints/                # SQLite checkpoint storage
```

```
###  Path: `/orchestrator/docs/agents/project-manifest/api-surface.md`

```md
# Orchestrator — API Surface

> **Parent:** [project-manifest/README.md](README.md) · **Detailed refs:** [public-api.md](../../public-api.md) · [jsonl-log-schema.md](../../jsonl-log-schema.md)

Quick-reference for public symbols, JSONL event types, and utility functions.
For complete signatures and full field descriptions see the linked documents above.

---

## JSONL Event Types — Logging Module (`src/utils/logging.py`)

The schema supports **23 event types** across three emitters. For the full field reference,
duration conventions, JSON examples, and backward-compatibility notes see
[jsonl-log-schema.md](../../jsonl-log-schema.md).

### Node factory events (`src/nodes/__init__.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `stage_start` | `stage`, `wp_id`, `iteration`, `model` | **New.** Emitted before Deep Agent creation. Always first entry in a stage's log sequence. |
| `stage_complete` | `stage`, `wp_id`, `result="PASS"`, `tokens_used`, **`duration_s`**, `model` | `duration_s` — wallclock seconds from `stage_start` to completion (float, 1 dp). |
| `stage_error` | `stage`, `wp_id`, `result="FAIL"`, `error`, **`duration_s`**, `model` | `duration_s` — time elapsed before the exception was raised. |
| `pipeline_result` | `stage`, `wp_id`, `pipeline_type`, `pipeline_status`, `files_modified`, `metrics`, `summary`, `duration_s` | **New.** Best-effort read-back of latest WP pipeline after success. `duration_s` derived from `pipeline.duration_ms`; `null` when absent. Omitted on read-back failure. |
| `pipeline_rollback` | `stage`, `wp_id`, `pipeline_type`, `level="INFO"` | Emitted when error-path rollback successfully cancels an orphaned IN_PROGRESS pipeline after an unhandled stage exception. Only fires when `ledger_begin_work` was called before the crash. |

### Tool wrapper events (`src/utils/tool_wrappers.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `tool_call` | `stage`, `wp_id`, `tool_name`, `tool_wp_id`, `level="DEBUG"` | Emitted before every MCP tool `ainvoke` by `log_tool_calls()`. `tool_wp_id` is extracted from call arguments; the full argument payload is **never** logged (privacy constraint). Filtered out of normal console output due to `level: DEBUG`. |

### Supervisor events (`src/supervisor.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `wp_status_change` | `wp_id`, `old_status`, `new_status` | **New.** Fired when a WP's status differs between consecutive iterations. |
| `wp_complete` | `wp_id` | **New.** Subset of `wp_status_change` — fired specifically on `→ COMPLETE` transitions. |
| `progress_snapshot` | `total_wps`, `status_breakdown`, `pending`, `wps_completed_this_run`, `iteration`, `max_iterations`, **`elapsed_s`**, `run_start_ts` (optional) | **New.** Emitted every iteration. `elapsed_s` — seconds since `run_start_ts`; omitted when `run_start_ts` absent. `run_start_ts` — echoes `WorkflowState.run_start_ts`; `None` when unavailable. |
| `rework_detected` | `wp_id`, `agent_role`, `pipeline_type`, `rework_count` | **New.** Fired when supervisor dispatches a `REWORK` action. |
| `halted_wp_cancelled` | `stage="supervisor"`, `wp_id`, `destination`, `reason`, `level="WARNING"` | Emitted for each halted WP transitioned to CANCELLED before synthesis dispatch (when all remaining WPs exceeded the 3-consecutive-failure threshold). |
| `route` | `destination`, `agent_role`, `ledger_action`, **`prev_stage`**, **`prev_wp_id`**, **`prev_result`** | Enriched: `prev_stage`, `prev_wp_id`, `prev_result` (`"PASS"` / `"FAIL"` / `""`) added to provide previous-stage context. |
| `dry_run_no_ledger` | `destination`, `detail` | **New.** Emitted in `--dry-run` mode when the ledger is missing (expected). Replaces `mcp_error` at INFO level. |
| `dry_run_complete` | `destination=END`, `reason` | **New.** Emitted in `--dry-run` mode on second iteration with no WPs — clean termination signal. |

### Heartbeat events (`src/utils/logging.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `heartbeat` | `stage="heartbeat"`, `silence_s` | Emitted by `WorkflowLogger._heartbeat_loop` when no log entry has been written for `HEARTBEAT_INTERVAL_S` seconds. Console line: `[heartbeat] ♥ alive (quiet for 2m 0s)`. Configure via `HEARTBEAT_INTERVAL_S` env var (default `120`, `0` to disable). |

### CLI events (`src/cli.py`)

| `action` | Key fields | Notes |
|----------|-----------|-------|
| `run_start` | `thread_id`, `dry_run`, `plan`, **`run_start_ts`**, `stage_models` | Enriched: `run_start_ts` — ISO 8601 UTC timestamp stored in state for elapsed-time math. `plan` — resolved path of the plan file passed as `--plan`. `stage_models` — snapshot of `Config.stage_models` at run start (dict of stage name → model slug). |
| `run_end` | `result`, `thread_id`, **`total_duration_s`** | Enriched: `total_duration_s` — wallclock seconds for the full run (float, 1 dp); omitted when `run_start_ts` unavailable. |

### Duration field conventions

| Field | Scope | Present on |
|-------|-------|-----------|
| `duration_s` | Single stage or pipeline execution | `stage_complete`, `stage_error`, `pipeline_result` |
| `elapsed_s` | Time since run start | `progress_snapshot` |
| `total_duration_s` | Entire run | `run_end` |

All duration values are floats rounded to 1 decimal place.

---

## Template Renderer (`src/nodes/prompt_renderer.py`)

Shared by all stage node modules to assemble user-turn prompts from `.md` templates.
Template files live at `src/nodes/templates/<stage>.md`.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `load_template` | `load_template(stage: str) -> str` | Reads and caches the Markdown template for *stage* from `src/nodes/templates/{stage}.md`. *stage* must match `[\w-]+`; raises `ValueError` for invalid names (empty string, path separators, dots, spaces). Raises `FileNotFoundError` if the file is missing. Cached in-process; subsequent calls for the same stage bypass disk I/O. |
| `render_prompt` | `render_prompt(template: str, variables: dict[str, str]) -> str` | Four-step pipeline: (0) resolve `{{> partial-name}}` include directives — partials are expanded with one additional pass for nested `{{> ...}}` within partial content (one level deep; directives inside second-level partials are not resolved); (1) evaluate `{{#if var}}`…`{{/if}}` conditional blocks; (2) substitute `{variable}` placeholders (`defaultdict(str)` fallback for missing keys); (3) collapse 3+ consecutive newlines to one blank line. |
| `clear_template_cache` | `clear_template_cache() -> None` | Resets the in-memory cache. For test use only. |
| `load_partial` | `load_partial(name: str) -> str` | Reads and caches a Markdown partial for *name* from `src/nodes/templates/partials/{name}.md`. *name* must match `[\w-]+`; raises `ValueError` for invalid names (empty string, path separators, dots, spaces). Raises `FileNotFoundError` if the file is missing. Cached in-process alongside templates. |

### Template Partials (`src/nodes/templates/partials/`)

Shared Markdown fragments included in stage templates via `{{> partial-name}}`. Variables
listed are resolved from the enclosing template's variable dict after inlining.

| Partial file | Placeholder variables | Used by |
|---|---|---|
| `project-path-reminder.md` | _(none)_ | All WP-scoped templates + `synthesis` (7 of 8; `pm` inlines its content) |

---

## Utilities

### `src/utils/logging.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `WorkflowLogger` | `WorkflowLogger.create(label)` → context manager | JSONL + console logger. `stream_entry(entry)` writes a log entry dict to JSONL and emits event-type-specific console output for 9 named action types: `stage_start`, `stage_complete` (with duration + token count), `wp_status_change`, `wp_complete`, `progress_snapshot`, `pipeline_result`, `rework_detected`, `dialogue_captured`, and `tool_call` (`[stage] 🔧 tool_name (tool_wp_id)`, parenthetical omitted when `tool_wp_id` is empty); all other event types fall through to the generic `action → result` format. `log(...)` writes a freeform entry. `flush_unstreamed(run_log)` writes any `run_log` entries not already persisted via `stream_entry` (safety net for when the logger is unreachable inside graph nodes). `start_heartbeat(interval_s)` / `stop_heartbeat()` — async methods managing a background heartbeat task. |
| `_format_duration` | `_format_duration(seconds: float \| None) -> str` | Formats a float of seconds as a human-readable string. Examples: `"3m 24s"`, `"1h 12m"`, `"45s"`, `"0s"`. Returns `"0s"` for `None` or zero. Used internally by `stream_entry` for console output of `stage_complete`, `progress_snapshot`, and `pipeline_result` events. **Private** — not part of the public API but documented here as it drives all human-readable duration display. |
| `get_run_logger` | `get_run_logger(config) -> WorkflowLogger \| None` | Extracts the `WorkflowLogger` instance from a LangGraph `RunnableConfig`. Returns `None` when no logger is attached (e.g. in unit tests). |

### `src/utils/mcp_parse.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `parse_tool_response` | `parse_tool_response(raw: Any) -> dict \| list \| str \| None` | Parses an MCP tool response into a usable Python object. Handles `langchain-mcp-adapters` content-block lists, JSON strings, `ToolMessage` objects, and direct dicts. Used by the supervisor's `_call_tool` helper and the node factory's `pipeline_result` read-back. |

### `src/utils/persona_models.py`

Stdlib-only utility that reads persona YAML metadata and returns the API model slug for
each orchestrator stage. Uses hand-rolled `_extract_yaml_scalar()` / `_strip_inline_comment()`
helpers to avoid a PyYAML dependency.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `extract_persona_model_slugs` | `extract_persona_model_slugs(workspace_root: Path \| str) -> dict[str, str]` | Resolves the API model slug for every orchestrator stage. Resolution order: (1) per-persona `model_slug` field if present; (2) `default_model_slug` from `_shared.yaml`. Scans `personas/ledger/src/meta/[1-9]-*.yaml` files and cross-references role numbers against `shared/workflow-manifest.json`. **Constraint:** the glob pattern `[1-9]-*.yaml` only matches single-digit numeric prefixes (roles 1–9); a role file with prefix `10-` or higher would be silently skipped. Update the pattern if the role count ever exceeds 9. Returns a `{stage_id: model_slug}` mapping — one entry per manifest role that has a matching YAML file; roles with no YAML file are skipped with a `WARNING` log. Raises `OSError` if the metadata directory does not exist; `FileNotFoundError` if `_shared.yaml` or `workflow-manifest.json` is missing; `ValueError` if `default_model_slug` is absent from `_shared.yaml` or the `roles` key is missing from the manifest. |

---

### `src/config.py`

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `Config` | `@dataclass Config` | Immutable configuration bundle populated by `load_config()`. Key fields: `stage_models` (`dict[str, str]`) — map of stage name → model slug for the run (populated from persona YAML by `extract_persona_model_slugs()`); `max_iterations`, `checkpoint_dir`, `mcp_server_cmd`, `workspace_root`, `log_level`, `heartbeat_interval_s`, `capture_dialogues`. |
| `Config.resolve_model_for_stage` | `resolve_model_for_stage(stage: str) -> str` | Returns the model slug for *stage* from `Config.stage_models`. Raises `KeyError` when *stage* is not present — this is a programming error (all valid stages must be populated at config load time by `extract_persona_model_slugs()`). Called by `create_stage_node()` **before** the try block so that an unrecognised stage name fails loudly rather than producing a silent `stage_error` log entry. |


Three defensive wrappers applied to every MCP tool in a stage node. **Canonical application order:**

```
inject_project_path(tools, project_path)
    → restrict_to_wp(tools, wp_id)
        → log_tool_calls(tools, stage, wp_id, logger)
```

All three functions are **idempotent** (sentinel attributes prevent closure stacking) and handle both flat-dict and ToolCall `{"args": {...}}` input structures.

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `inject_project_path` | `inject_project_path(tools: list[Any], project_path: str) -> list[Any]` | **Layer 2 safety net.** Auto-injects `project_path` into every tool call when absent. Uses `setdefault` semantics — explicit `project_path` values are never overwritten. Strips redundant `cwd_path` from call arguments. Sentinel: `_orig_ainvoke`. |
| `restrict_to_wp` | `restrict_to_wp(tools: list[Any], wp_id: str) -> list[Any]` | **Layer 3 safety net (write tools only).** Auto-injects `work_package_id` when absent; soft-fails cross-WP calls (2 strikes) before raising `ValueError`. Read-only tools (in `_READ_ONLY_TOOLS`) are exempt — no wrapping, no injection, no rejection. No-op when `wp_id` is empty (synthesis stages). Sentinel: `_orig_ainvoke_wp`. |
| `log_tool_calls` | `log_tool_calls(tools: list[Any], stage: str, wp_id: str, logger: WorkflowLogger \| None) -> list[Any]` | Emits a `tool_call` JSONL event (`level: "DEBUG"`) before each `ainvoke` call. Records `stage`, `wp_id`, `tool_name`, and `tool_wp_id`; full argument payload excluded (privacy constraint). Returns tools unchanged when `logger` is `None`. Sentinel: `_orig_ainvoke_log`. |

### Writing a New Tool Wrapper

Before adding a fourth wrapper, check the three-wrapper threshold note below. If a new
wrapper is justified, follow this canonical pattern:

```python
def my_new_wrapper(tools: list[Any], extra_arg: str) -> list[Any]:
    """One-line description.

    Idempotent — sentinel attribute ``_orig_ainvoke_<suffix>`` prevents stacking.
    """
    SENTINEL = "_orig_ainvoke_<suffix>"          # unique per wrapper

    for tool in tools:
        if hasattr(tool, SENTINEL):
            continue                              # already wrapped; skip

        if not hasattr(tool, "_orig_ainvoke_<suffix>"):
            object.__setattr__(tool, SENTINEL, tool.ainvoke)
        _orig = getattr(tool, SENTINEL)

        async def _wrapped_ainvoke(
            input: Any,                          # noqa: A002
            *args: Any,
            _orig: Any = _orig,                  # closure capture — avoids late-binding bug
            _extra: str = extra_arg,
            **kwargs: Any,
        ) -> Any:
            # ... wrapper logic using _extra ...
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _wrapped_ainvoke)

    return tools
```

**Invariants every wrapper must satisfy:**

- **Sentinel naming:** `_orig_ainvoke_<suffix>` — choose a unique suffix, never reuse one.
- **Idempotency check:** `if hasattr(tool, SENTINEL): continue` — prevents double-wrapping when
  the factory is called more than once on the same tool object.
- **Closure capture:** pass loop-local variables as default arguments (e.g. `_orig=_orig`) to
  avoid the Python late-binding closure bug.
- **Frozen attributes:** use `object.__setattr__` — LangChain tool objects are often Pydantic
  models whose `__setattr__` is overridden or frozen.
- **Application order = execution order (reversed):** the wrapper applied *last* executes *first*.
  `log_tool_calls` is applied last so it fires before inner wrappers inject `project_path` or
  `work_package_id`, capturing the arguments as the agent supplied them.
- **Three-wrapper threshold:** if this would be the fourth wrapper, extract a shared
  `_wrap_ainvoke(tool, sentinel_attr, async_factory)` helper instead of repeating the pattern a
  fourth time.

---

## State Fields (progress-tracking additions)

These `WorkflowState` fields support the new event types. See
[architecture.md](../../architecture.md) for the full state schema.

| Field | Type | Description |
|-------|------|-------------|
| `prev_wp_summaries` | `list` | Previous supervisor iteration's WP summary list. Diffed against `wp_summaries` to emit `wp_status_change` / `wp_complete` events. |
| `run_start_ts` | `str` | ISO 8601 UTC timestamp of run start. Set once by CLI. Used to compute `elapsed_s` in `progress_snapshot` and `total_duration_s` in `run_end`. |
| `wps_completed_this_run` | `int` | WPs that transitioned to COMPLETE during this run. Included in `progress_snapshot`. |

```
###  Path: `/orchestrator/docs/agents/project-manifest/constraints.md`

```md
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

```