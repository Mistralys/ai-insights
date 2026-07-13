# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context

This plan directly extends the path middleware evolution tracked across three prior projects:

- **`2026-07-07-macos-path-middleware`** — Extended `PathNormalizationMiddleware` from Windows-only to cross-platform (macOS/Linux). Introduced the `_active` flag for POSIX roots with length > 1.
- **`2026-07-07-deep-agent-integration-tests`** — Built integration test infrastructure (`ToolCallableFakeChatModel`, mock tool helpers, conftest stubs) for the Deep Agent execution path, including middleware flow tests.
- **`2026-07-09-subagent-path-middleware-gap`** — Propagated `PathNormalizationMiddleware` to subagent specs via `setdefault/append`. Established Constraint §26 (all Deep Agents must include the middleware) and §27 (pre-run folder rename).

The current bug was surfaced by a live orchestrator run (`2026-07-13-improved-dialogue-render`) where the PM stage looped 15 times because every MCP `ledger_initialize_project` call received a virtual `/docs/agents/plans/…` path instead of the absolute host path.

## Summary

The `PathNormalizationMiddleware` indiscriminately rewrites absolute host paths to virtual `/`-rooted paths in **all** tool call arguments — including MCP tool calls that require absolute host paths. This causes every MCP server call where the LLM passes or the wrapper injects a `project_path` value matching the `root_dir` prefix to receive a truncated virtual path, which the MCP server cannot resolve.

This plan implements **Pattern 3 (dynamic tool-name exclusion)** from the research paper: add a `skip_tools` parameter to `PathNormalizationMiddleware` that short-circuits rewriting for named tools, and derive the skip set dynamically from the `mcp_tools` list at middleware construction time in `create_stage_node`. This is self-maintaining — new MCP tools are automatically excluded without any list maintenance.

## Architectural Context

The orchestrator's Deep Agents execution path involves three layers of tool-call interception:

1. **`PathNormalizationMiddleware.awrap_tool_call`** (middleware layer) — Intercepts every tool call at the Deep Agents dispatch layer, before any tool's `ainvoke` is called. Rewrites absolute host paths to virtual `/`-rooted paths for Deep Agents' `LocalShellBackend(virtual_mode=True)`.
2. **`inject_project_path`** (wrapper layer) — Monkeypatches `tool.ainvoke` to auto-inject the absolute `project_path` from state when absent. Uses `setdefault` semantics — does not overwrite an explicitly-provided value.
3. **`restrict_to_wp` / `log_tool_calls`** (guard/logging layer) — Cross-WP contamination guard and JSONL logging.

The execution order is: middleware `awrap_tool_call` → `tool.ainvoke` (which hits the outermost wrapper, `log_tool_calls`, then `restrict_to_wp`, then `inject_project_path`, then the actual MCP call).

The bug: middleware runs first and rewrites `project_path` from `/Users/.../plans/2026-07-13-…` to `/docs/agents/plans/2026-07-13-…`. By the time `inject_project_path` runs, the path is already present (rewritten), so `setdefault` is a no-op.

Key files:
- `orchestrator/src/utils/path_middleware.py` — `PathNormalizationMiddleware` class
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` (middleware wiring, lines 870–910)
- `orchestrator/src/utils/tool_wrappers.py` — `inject_project_path` wrapper
- `orchestrator/tests/test_path_middleware.py` — 30+ existing tests covering path rewriting
- `orchestrator/docs/agents/project-manifest/constraints.md` — §26 documents the middleware requirement

## Approach / Architecture

Add a `skip_tools` parameter (type `frozenset[str]`, default `frozenset()`) to `PathNormalizationMiddleware.__init__`. In `awrap_tool_call`, check `request.tool_call["name"]` against `self._skip_tools` and short-circuit to `handler(request)` when matched.

In `create_stage_node`, derive the skip set from the `mcp_tools` objects passed to the function:

```python
mcp_tool_names = frozenset(t.name for t in mcp_tools)
path_middleware = PathNormalizationMiddleware(target_path, skip_tools=mcp_tool_names)
```

This approach:
- Fixes the root cause at the correct architectural layer (the middleware that does the indiscriminate rewriting)
- Is self-maintaining: every MCP tool, present and future, is automatically excluded by construction
- Requires zero changes outside the orchestrator
- Preserves all existing shell/file tool path rewriting behaviour

## Rationale

Pattern 3 was chosen over Pattern 4 (rename `project_path` → `project_absolute_path`) because:
- **Layer correctness:** The bug exists entirely within the orchestrator layer. The MCP server has no concept of virtual paths or path middleware. Renaming its parameter to satisfy an orchestrator-internal rewriting convention would leak orchestrator concerns into the MCP API contract.
- **Blast radius:** Pattern 3 touches 2 source files + tests in the orchestrator. Pattern 4 would touch 21 Zod schemas, the resolver, help content, 18 MCP test files, and 3 persona source files.
- **No breaking changes:** Pattern 3 is fully backward-compatible. The default `skip_tools=frozenset()` preserves existing behaviour.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How to exclude MCP tools from path rewriting | Dynamic tool-name exclusion via `skip_tools` parameter derived from `mcp_tools` objects | Pattern 4: Rename `project_path` → `project_absolute_path` (breaks 21+ schemas); Alt A: Add parallel `project_absolute_path` parameter (permanent schema noise); Alt B: Exclude by argument name (too narrow, couples middleware to MCP contract); Alt D: Static tool-name list (brittle, must be manually maintained) | Dynamic exclusion is self-maintaining by construction, stays within the orchestrator layer, and has zero blast radius outside the orchestrator. |

## Pattern Alignment

- **Middleware pattern** (`orchestrator/src/utils/path_middleware.py`): Follows the existing `AgentMiddleware` pattern with `awrap_tool_call`. The `skip_tools` parameter extends the constructor without changing the middleware contract.
- **Tool wrapper pattern** (`orchestrator/src/utils/tool_wrappers.py`): No departure. `inject_project_path` continues to work as a Layer 2 safety net; with the middleware no longer rewriting MCP tool arguments, `inject_project_path`'s `setdefault` semantics work correctly again.
- **Subagent middleware propagation** (Constraint §27, `create_stage_node` lines 898–901): The same `path_middleware` instance with `skip_tools` populated is propagated to subagent specs. If subagents are given MCP tools in the future, the pattern extends naturally.
- **Test pattern** (`orchestrator/tests/test_path_middleware.py`): Follows the existing `TestAwrapToolCall` class structure with mock requests and async handler capture.

## Detailed Steps

### Step 1: Add `skip_tools` parameter to `PathNormalizationMiddleware`

**File:** `orchestrator/src/utils/path_middleware.py`

1. Add a `skip_tools` parameter to `__init__` with type `frozenset[str]` and default `frozenset()`.
2. Store it as `self._skip_tools`.
3. Add a short-circuit at the top of `awrap_tool_call`: if `request.tool_call["name"]` is in `self._skip_tools`, delegate directly to `handler(request)` without rewriting.
4. Add a docstring note to the `skip_tools` parameter explaining its purpose and that it is derived dynamically from MCP tool objects.

### Step 2: Derive skip set from `mcp_tools` in `create_stage_node`

**File:** `orchestrator/src/nodes/__init__.py`

1. In `create_stage_node`, after the `mcp_tools` parameter is available, compute: `mcp_tool_names = frozenset(t.name for t in mcp_tools)`.
2. Pass `skip_tools=mcp_tool_names` to the `PathNormalizationMiddleware` constructor (line ~879).
3. Update the inline comment to explain that MCP tools are excluded from path rewriting because they expect absolute host paths.

### Step 3: Add tests for `skip_tools` behaviour

**File:** `orchestrator/tests/test_path_middleware.py`

Add a new test class `TestSkipTools` with the following test cases:

1. **`test_skipped_tool_passes_through_unchanged`** — A tool whose name is in `skip_tools` has its arguments passed through unchanged, even when values start with `root_dir`.
2. **`test_non_skipped_tool_still_rewritten`** — A tool whose name is NOT in `skip_tools` is rewritten as before (regression guard).
3. **`test_default_skip_tools_empty`** — Default `skip_tools=frozenset()` preserves existing behaviour (no tools skipped).
4. **`test_skipped_tool_with_posix_path`** — POSIX variant: a skipped MCP tool with a macOS absolute path in its args is not rewritten.
5. **`test_skip_tools_with_real_request`** — Smoke test using `_make_real_request` with a skipped tool name.

### Step 4: Update Constraint §26 documentation

**File:** `orchestrator/docs/agents/project-manifest/constraints.md`

Update §26 to document the `skip_tools` parameter:
- Add a paragraph explaining that when constructing the middleware in `create_stage_node`, the MCP tool names are passed as `skip_tools` to prevent path rewriting for MCP tools that expect absolute host paths.
- Update the "Correct pattern" code example to show `skip_tools=mcp_tool_names`.

### Step 5: Update module docstring

**File:** `orchestrator/src/utils/path_middleware.py`

Update the module-level docstring to mention the `skip_tools` parameter and the rationale for excluding MCP tools from path rewriting.

## Dependencies

- No external dependencies. All changes are within the orchestrator sub-project.
- The fix depends on `mcp_tools` being available as a parameter to `create_stage_node` — this is already the case (it's part of the function signature).

## Required Components

- `orchestrator/src/utils/path_middleware.py` — Modified (add `skip_tools` parameter)
- `orchestrator/src/nodes/__init__.py` — Modified (derive and pass `skip_tools`)
- `orchestrator/tests/test_path_middleware.py` — Modified (add test class)
- `orchestrator/docs/agents/project-manifest/constraints.md` — Modified (update §26)

## Assumptions

- The `mcp_tools` parameter in `create_stage_node` always contains all MCP tools available to the agent. This is verified by inspecting the existing code — `mcp_tools` is passed directly from the caller and used for `inject_project_path` wrapping.
- Tool names from `mcp_tools` objects are stable and match the names used in `request.tool_call["name"]` at middleware dispatch time. This is guaranteed by the LangChain MCP adapter, which preserves tool names from the MCP server schema.

## Constraints

- The fix must not break Windows path resolution for shell/file tools (the original purpose of the middleware).
- The `skip_tools` default must be `frozenset()` to preserve backward compatibility for any direct construction of the middleware (e.g., in tests).
- The middleware must remain a zero-cost pass-through when `_active` is `False` (empty or bare `/` root), regardless of `skip_tools` content.

## Out of Scope

- Renaming `project_path` to `project_absolute_path` in MCP server schemas (Pattern 4 — rejected as disproportionate).
- Adding `project_absolute_path` as a parallel parameter (Alternative A — rejected as permanent schema noise).
- Fixing the `general_purpose` subagent middleware gap (known limitation in Constraint §26; requires upstream Deep Agents API change).
- Adding argument-level exclusion (`excluded_arg_names`) — too narrow and couples middleware to MCP contract details.

## Acceptance Criteria

- AC-01: `PathNormalizationMiddleware` accepts a `skip_tools: frozenset[str]` parameter, defaulting to `frozenset()`.
- AC-02: `awrap_tool_call` short-circuits to the handler without rewriting when the tool name is in `skip_tools`.
- AC-03: Tools not in `skip_tools` continue to have their arguments rewritten as before (no regression).
- AC-04: `create_stage_node` derives the skip set from `mcp_tools` objects and passes it to the middleware constructor.
- AC-05: The same `path_middleware` instance (with `skip_tools` populated) is propagated to subagent specs.
- AC-06: All new tests pass; all existing tests pass without modification.
- AC-07: Constraint §26 documentation is updated to reflect the `skip_tools` parameter.

## Testing Strategy

Unit tests only. The existing test infrastructure in `test_path_middleware.py` uses mock `ToolCallRequest` objects and async handler capture, which is sufficient to verify the skip-tools behaviour without requiring a live MCP server or Deep Agents runtime.

## Test Plan

- `orchestrator/tests/test_path_middleware.py :: TestSkipTools :: test_skipped_tool_passes_through_unchanged` — Verifies a tool in `skip_tools` has args passed through unchanged even with matching paths. Covers AC-02.
- `orchestrator/tests/test_path_middleware.py :: TestSkipTools :: test_non_skipped_tool_still_rewritten` — Verifies a tool NOT in `skip_tools` is still rewritten. Covers AC-03.
- `orchestrator/tests/test_path_middleware.py :: TestSkipTools :: test_default_skip_tools_empty` — Verifies default `frozenset()` preserves existing behaviour. Covers AC-01, AC-03.
- `orchestrator/tests/test_path_middleware.py :: TestSkipTools :: test_skipped_tool_with_posix_path` — POSIX variant of the skip-tools passthrough. Covers AC-02.
- `orchestrator/tests/test_path_middleware.py :: TestSkipTools :: test_skip_tools_with_real_request` — Smoke test using `_make_real_request`. Covers AC-02.

## Documentation Updates

- `orchestrator/docs/agents/project-manifest/constraints.md` — Update §26 to document `skip_tools` parameter, updated code example, and rationale for MCP tool exclusion.
- `orchestrator/src/utils/path_middleware.py` — Update module docstring and `__init__` docstring to describe `skip_tools`.
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Update `PathNormalizationMiddleware.__init__` signature (L268) to reflect the new `skip_tools: frozenset[str] = frozenset()` parameter. Update `awrap_tool_call` description (L271) to note that when the tool name is in `skip_tools` the method short-circuits directly to `handler(request)` without calling `_rewrite_args`. Update `create_stage_node` inline description (L103) to mention `skip_tools=mcp_tool_names` in the middleware construction.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Tool name mismatch between `mcp_tools` objects and middleware dispatch** | LangChain MCP adapter preserves tool names from the MCP server schema. Verified by existing integration tests in `test_deep_agent_integration.py` that exercise the full tool dispatch chain. |
| **Subagent MCP tools in the future** | The same `path_middleware` instance (with `skip_tools`) is already propagated to subagent specs. If subagents receive MCP tools, those tools must be included in the skip set at construction time — the pattern extends naturally. |
| **Regression in shell/file tool path rewriting** | The existing 30+ tests in `test_path_middleware.py` are not modified and serve as a regression suite. The new `test_non_skipped_tool_still_rewritten` test explicitly guards this. |
