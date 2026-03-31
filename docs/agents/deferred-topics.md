# Deferred Topics

This document tracks implementation decisions that were deliberately deferred — where a simpler approach was chosen now, with a known future hardening path. Entries are organized by sub-project and use a structured format to keep them scannable and actionable.

---

## Orchestrator

### Curated Environment Injection (Pattern 2)

| Field | Detail |
|-------|--------|
| **Topic** | Curated environment injection for agent subprocesses |
| **Current State** | `LocalShellBackend` is constructed with `inherit_env=True`, which copies the full `os.environ` into every agent subprocess. This unblocks host CLI access (`python`, `npm`, `git`, etc.) on developer machines. |
| **Target State** | Switch to a curated allowlist of safe environment keys — e.g. `PATH`, `HOME`, `USER`, `LANG`, `VIRTUAL_ENV`, `NVM_DIR`, `PYENV_ROOT` — to prevent leaking host secrets (e.g. `AWS_ACCESS_KEY_ID`, API tokens) to agent subprocesses. This is Pattern 2 from the research paper. |
| **Trigger / Timeline** | Before any CI or shared-infrastructure deployment of the orchestrator. Not required for local developer use. |
| **Reference** | `docs/agents/research/2026-03-30-orchestrator-cli-access.md`; inline comment at `orchestrator/src/nodes/__init__.py` (`LocalShellBackend` call site). |

### Wrapper-Class Replacement for `_patch_tool()` Monkeypatching

| Field | Detail |
|-------|--------|
| **Topic** | Replace in-place `ainvoke` monkeypatching with a composition-based wrapper class |
| **Current State** | `_patch_tool()` centralises all `object.__setattr__` calls (9 → 1) for setting `ainvoke` and sentinel attributes on LangChain tool objects. The three frozen dataclass contexts (`_InjectCtx`, `_GuardCtx`, `_LogCtx`) group per-tool closure state cleanly, but the fundamental mechanism is still in-place mutation of Pydantic `BaseModel` instances. |
| **Target State** | A proper `ToolWrapper` class that composes (wraps) the original tool instead of mutating it. This would eliminate the `object.__setattr__` bypass entirely and make wrapper ordering explicit. |
| **Blocker** | LangGraph's `ToolNode` performs `isinstance(tool, BaseTool)` checks internally, and the Deep Agents SDK may do the same. A non-`BaseTool` wrapper would require dynamic subclassing or a `__class__` hack — both worse than the current approach. |
| **Trigger / Timeline** | When LangGraph introduces middleware hooks, a `ToolWrapper` protocol, or relaxes the `isinstance` check. The `_patch_tool()` centralisation makes the future migration a single-point change. |
| **Reference** | `orchestrator/src/utils/tool_wrappers.py` → `_patch_tool()`; plan doc `docs/agents/plans/2026-03-30-tool-wrapper-closure-refactor/plan.md` → "Non-Goals" section. |

### `_make_tool_response()` as a Dataclass Method

| Field | Detail |
|-------|--------|
| **Topic** | Consider making `_make_tool_response()` a method on a shared context base class |
| **Current State** | `_make_tool_response()` is a standalone module-level helper that wraps content in a `ToolMessage` when a `tool_call_id` is present. It is called by both `inject_project_path` (short-circuit path) and `restrict_to_wp` (soft-fail path). |
| **Target State** | If the three frozen dataclass contexts ever gain shared behaviour or additional response-formatting needs, `_make_tool_response` could become a method on a shared base class or a classmethod on the dataclasses. |
| **Trigger / Timeline** | Only if additional response-formatting logic is added that would benefit from access to context state. Currently over-engineering — the function is stateless and 10 lines. |
| **Reference** | `orchestrator/src/utils/tool_wrappers.py` → `_make_tool_response()`; synthesis `docs/agents/plans/2026-03-30-tool-wrapper-closure-refactor/synthesis.md` → Code Insights. |

---

## MCP Server

No deferred topics.

---

## Personas

No deferred topics.
