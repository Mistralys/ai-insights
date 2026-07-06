# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The repository's recent project history includes two related efforts:
- `2026-07-04-windows-path-resolution` — added `virtual_mode=True` to `LocalShellBackend`, which fixed POSIX path resolution on Windows but did not address the `validate_path()` rejection of Windows drive-letter paths.
- `2026-07-04-windows-path-resolution-rework-1` — implemented `_infer_project_root()` so the orchestrator correctly infers `target_project_path` from the plan path.

Both are prerequisites for this plan. The research report `docs/agents/research/2026-07-04-orchestrator-windows-path-issues.md` documents 4 consecutive failed orchestrator runs where agents could not access files via Deep Agents sandbox tools because all file tool calls were rejected with "Windows absolute paths are not supported." This plan implements the recommended fix from that research.

A global insight on Windows path handling (reserved device names causing silent data loss) reinforces the importance of robust Windows path normalization in this codebase.

## Summary
Implement a `PathNormalizationMiddleware` that intercepts all Deep Agents tool calls and rewrites Windows absolute paths to virtual `/`-rooted paths before `validate_path()` runs. This is the final piece needed to make orchestrator runs succeed on Windows: `virtual_mode=True` (already deployed) handles path resolution, and this middleware handles path validation rejection.

## Architectural Context
The orchestrator creates a Deep Agents agent per stage via `create_deep_agent()` in `orchestrator/src/nodes/__init__.py` (~line 886). The agent receives:
- **MCP tools** (wrapped by `inject_project_path` in `orchestrator/src/utils/tool_wrappers.py`) — these run server-side via Node.js and accept Windows paths natively.
- **Built-in file tools** (`read_file`, `ls`, `write_file`, `edit_file`, `glob`, `grep`, `execute`) — these run inside the Deep Agents sandbox where `validate_path()` rejects Windows drive-letter patterns (`^[a-zA-Z]:`) before `_resolve_path()` can translate them.

The `create_deep_agent()` API accepts a `middleware: Sequence[AgentMiddleware]` parameter. User-supplied middleware is appended after the standard stack (`TodoListMiddleware`, `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, etc.), making it the innermost layer — running immediately before the tool function. This is the correct insertion point for path rewriting: it runs after the agent constructs its tool call but before the sandbox validates the path.

Key files:
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` / `node_fn()`, the `create_deep_agent()` call site
- `orchestrator/src/utils/tool_wrappers.py` — existing `inject_project_path`, `restrict_to_wp`, `log_tool_calls` wrappers
- `orchestrator/src/nodes/templates/partials/project-path-reminder.md` — prompt partial that embeds `{project_path}` (Windows path) into agent context
- `deepagents/backends/utils.py` — `validate_path()` with `^[a-zA-Z]:` rejection
- `deepagents/graph.py` — `create_deep_agent()` with `middleware` parameter
- `langchain/agents/middleware/types.py` — `AgentMiddleware` base class with `awrap_tool_call()`
- `langgraph/prebuilt/tool_node.py` — `ToolCallRequest` with `.tool_call` dict and `.override()` method

## Approach / Architecture
Create a single `PathNormalizationMiddleware(AgentMiddleware)` class that:
1. Receives the `root_dir` (same value passed to `LocalShellBackend`) at construction time.
2. Implements `awrap_tool_call()` to scan every string argument in every tool call for the Windows drive-letter pattern `^[a-zA-Z]:`.
3. For matching values whose normalized form starts with the known `root_dir` prefix, rewrites them to `/`-rooted virtual paths (stripping the `root_dir` prefix and normalizing separators).
4. Uses `request.override(tool_call=modified_call)` to pass the rewritten args to the handler.
5. Passes non-matching values through unchanged.

This middleware is **value-based** (scans arg values, not tool names), so it requires zero maintenance when tools are added or renamed. MCP tools are safe because `inject_project_path` overwrites `project_path` via the separate `ainvoke` monkeypatch — agents never supply `project_path` for MCP calls, so there is nothing to rewrite.

The middleware is instantiated once per stage in `node_fn()` and passed to `create_deep_agent(middleware=[...])`.

## Rationale
- **AgentMiddleware is the official API** for intercepting tool calls in LangChain/Deep Agents. No monkey-patching or upstream patches required.
- **Value-based matching** is zero-maintenance — no tool-name list to keep in sync.
- **Innermost positioning** ensures the rewrite happens after all other middleware has processed the call but before `validate_path()` runs.
- **Prompt changes are unnecessary** — agents can keep using Windows paths naturally from `{project_path}`; the middleware transparently rewrites them.
- **`virtual_mode=True` remains necessary** — it handles the resolution of `/`-rooted paths on Windows. The middleware and virtual mode are complementary.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Path rewriting mechanism | `AgentMiddleware.awrap_tool_call()` | (A) Prompt-only fix (dual-path instructions), (B) Upstream `validate_path()` patch, (C) `tool_wrappers.py` ainvoke monkeypatch | (A) Fragile — depends on model compliance; adds cognitive load. (B) Requires upstream PR; Deep Agents is moving toward mandatory virtual mode, unlikely to accept. (C) File tools bypass `ainvoke` — they're invoked through ToolNode/middleware chain, not via the monkeypatched path. |
| Matching strategy | Value-based (scan all string args for drive-letter pattern) | Tool-name-based (maintain a list of file tools to intercept) | Value-based is zero-maintenance and future-proof; tool-name-based requires updating when tools are added/renamed. |

## Pattern Alignment
- **Follows `orchestrator/src/utils/` utility module pattern** — new file alongside `tool_wrappers.py`, `filelock.py`, etc. (see `orchestrator/src/utils/` directory listing).
- **Follows frozen dataclass context pattern** from `tool_wrappers.py` — but simplified since no closure stacking is needed.
- **Follows cross-platform policy** from root `AGENTS.md` — the middleware normalizes Windows paths to platform-agnostic virtual paths; on macOS/Linux where `root_dir` never starts with `[a-zA-Z]:`, the middleware is a no-op.
- **Follows existing middleware usage** — Deep Agents' own `SubAgentMiddleware` and `SummarizationMiddleware` use the same `AgentMiddleware` base class.

## Detailed Steps

### Step 1: Create `PathNormalizationMiddleware` class
Create `orchestrator/src/utils/path_middleware.py` with:
- `PathNormalizationMiddleware(AgentMiddleware)` that takes `root_dir: str` in `__init__`.
- `_to_virtual(self, value: str) -> str` — normalize backslashes, case-insensitive prefix match against `self._root`, strip prefix, prepend `/`.
- `_rewrite_args(self, args: dict) -> dict | None` — iterate string values, apply `_to_virtual` on those matching `^[a-zA-Z]:`, return `None` if no changes.
- `awrap_tool_call(self, request, handler)` — call `_rewrite_args` on `request.tool_call.get("args", {})`, use `request.override()` if changes were made, delegate to `handler`.

### Step 2: Wire middleware into `create_deep_agent()` call
In `orchestrator/src/nodes/__init__.py`, in `node_fn()`:
- Import `PathNormalizationMiddleware` from `src.utils.path_middleware`.
- After the `backend = LocalShellBackend(...)` line, instantiate the middleware: `path_middleware = PathNormalizationMiddleware(target_path)` (same `target_path` passed to `LocalShellBackend`).
- Add `middleware=[path_middleware]` to the `create_deep_agent()` call.

### Step 3: Write unit tests for `PathNormalizationMiddleware`
Create `orchestrator/tests/test_path_middleware.py` with tests covering:
- Basic Windows path rewriting (`F:\Webserver\...\src\file.ts` → `/src/file.ts`).
- Case-insensitive root matching (`f:\webserver\...` matches `F:\Webserver\...`).
- Backslash normalization (both `\` and `/` in input).
- Non-matching Windows paths are left unchanged (path outside `root_dir`).
- Non-Windows values (POSIX paths, plain strings) pass through unchanged.
- No-op when no args need rewriting (returns unmodified request).
- Multiple args in one call — only matching ones are rewritten.
- Empty args dict handled gracefully.
- Root-dir-only path rewrites to `/`.

### Step 4: Write integration test for middleware wiring
In `orchestrator/tests/test_nodes.py`, add a test that verifies:
- `create_deep_agent` is called with a `middleware` keyword argument.
- The middleware list contains a `PathNormalizationMiddleware` instance.
- The middleware's `_root` is set to the expected `target_path`.

### Step 5: Add constraint entry to orchestrator manifest
Add a new constraint entry to `orchestrator/docs/agents/project-manifest/constraints.md` documenting:
- **Rule:** All Deep Agents agent instantiations must include `PathNormalizationMiddleware` in the `middleware` parameter. The middleware rewrites Windows drive-letter paths to virtual `/`-rooted paths before `validate_path()` runs.
- **Rationale:** Deep Agents' `validate_path()` unconditionally rejects `^[a-zA-Z]:` paths. Without the middleware, agents on Windows cannot use any file tool.
- **Correct pattern:** The `create_deep_agent()` call with `middleware=[PathNormalizationMiddleware(target_path)]`.

### Step 6: Update `project-path-reminder.md` with virtual path hint
Extend the existing orchestrator runtime partial `orchestrator/src/nodes/templates/partials/project-path-reminder.md` with a brief note informing agents that:
- The `project_path` value should be used for all **ledger MCP tool calls** (existing behaviour, unchanged).
- For **file tools** (`read_file`, `ls`, `write_file`, `edit_file`, `glob`, `grep`, `execute`), both the full project path and `/`-rooted virtual paths are accepted — the system normalizes them automatically.
- Tool results from file tools (e.g., `ls` entries, `grep` match paths) use `/`-rooted virtual paths relative to the project root.
- No manual path conversion is required.

This partial is already included by all 8 stage templates via `{{> project-path-reminder}}` and uses Python single-brace `{variable}` syntax (part of the orchestrator runtime template system, not the persona builder). The addition is a few lines appended to the existing content.

This hint prevents unnecessary model reasoning loops when an agent sends a Windows path but receives virtual-path results back.

## Dependencies
- `virtual_mode=True` must remain on `LocalShellBackend` (already deployed by `2026-07-04-windows-path-resolution`).
- `_infer_project_root()` must be in place for correct `target_path` inference (already deployed by `2026-07-04-windows-path-resolution-rework-1`).
- Deep Agents v0.4.5+ with `AgentMiddleware` support (already installed).
- LangChain agents middleware API (`langchain.agents.middleware.types.AgentMiddleware`) — already available in the installed version.

## Required Components
- **New file:** `orchestrator/src/utils/path_middleware.py` — `PathNormalizationMiddleware` class
- **New file:** `orchestrator/tests/test_path_middleware.py` — unit tests
- **Modified file:** `orchestrator/src/nodes/__init__.py` — import + wire middleware into `create_deep_agent()` call
- **Modified file:** `orchestrator/tests/test_nodes.py` — integration test for middleware wiring
- **Modified file:** `orchestrator/docs/agents/project-manifest/constraints.md` — new constraint entry
- **Modified file:** `orchestrator/src/nodes/templates/partials/project-path-reminder.md` — add virtual path hint for file tools
- **Modified file:** `orchestrator/src/nodes/templates/VARIABLES.md` — update partial documentation if the partial's contract changes

## Assumptions
- `AgentMiddleware.awrap_tool_call()` is called for all tool invocations including built-in file tools (confirmed by API documentation and Deep Agents source: user middleware runs as innermost layer after `FilesystemMiddleware`).
- `target_path` in `node_fn()` is the same directory path passed to `LocalShellBackend(root_dir=...)` and represents the project root on disk (confirmed by reading the call site).
- The `ToolCallRequest.tool_call` dict uses the standard LangChain `ToolCall` structure: `{"name": str, "args": dict, "id": str}` (confirmed by `langgraph/prebuilt/tool_node.py`).
- String comparison for the `root_dir` prefix match is case-insensitive (Windows filesystem is case-insensitive).

## Constraints
- The middleware must be a no-op on macOS/Linux — no path should be rewritten when `root_dir` doesn't start with `[a-zA-Z]:`.
- MCP tool args must not be corrupted — the middleware must not rewrite paths that don't start with the known `root_dir`.
- Cross-platform test compatibility — tests must not use hardcoded Windows paths; use parameterized test data with both Windows and POSIX scenarios.
- No new dependencies — uses only the existing `langchain.agents.middleware.types.AgentMiddleware` and `re` from stdlib.

## Out of Scope
- Exposing file reading via MCP tools (server-side) to bypass the sandbox entirely — this is a larger architectural change mentioned in the research's Open Questions but not recommended for this plan.
- Modifying `validate_path()` upstream in Deep Agents — the library is moving toward mandatory virtual mode; a local middleware is the appropriate approach.
- Changing `inject_project_path` or other `tool_wrappers.py` functions — they operate on MCP tools via `ainvoke` monkeypatching, which is orthogonal to the middleware chain.

## Acceptance Criteria
- AC1: Orchestrator runs on Windows without "Windows absolute paths are not supported" errors from file tools.
- AC2: `PathNormalizationMiddleware` correctly rewrites Windows drive-letter paths matching `root_dir` to `/`-rooted virtual paths.
- AC3: Paths outside `root_dir` and non-Windows paths are not modified by the middleware.
- AC4: MCP tool calls are unaffected (no arg corruption).
- AC5: The middleware is a no-op on macOS/Linux.
- AC6: `create_deep_agent()` in `node_fn()` receives the middleware in its `middleware` parameter.
- AC7: All existing orchestrator tests continue to pass.
- AC8: New unit tests cover rewriting, passthrough, case-insensitivity, and edge cases.
- AC9: `project-path-reminder.md` partial informs agents that file tool results use `/`-rooted virtual paths and that both path formats are accepted.

## Testing Strategy
The solution is tested at two levels:
1. **Unit tests** for `PathNormalizationMiddleware` in isolation — verify path rewriting logic with parameterized test data covering Windows paths, POSIX paths, case sensitivity, edge cases, and no-op scenarios.
2. **Integration test** in `test_nodes.py` — verify that the middleware is correctly wired into the `create_deep_agent()` call with the expected `root_dir`, following the existing pattern of patching `deepagents.create_deep_agent` and inspecting kwargs.

No live orchestrator run is required for validation — the middleware logic is deterministic string manipulation that can be fully verified with unit tests.

## Test Plan
- `orchestrator/tests/test_path_middleware.py::test_basic_windows_path_rewrite` — Verifies `F:\root\src\file.ts` → `/src/file.ts` — AC2
- `orchestrator/tests/test_path_middleware.py::test_case_insensitive_root_match` — Verifies `f:\Root\src\file.ts` matches `F:\root` — AC2
- `orchestrator/tests/test_path_middleware.py::test_backslash_normalization` — Verifies mixed `\` and `/` separators — AC2
- `orchestrator/tests/test_path_middleware.py::test_path_outside_root_unchanged` — Verifies `D:\other\file.ts` is not rewritten — AC3
- `orchestrator/tests/test_path_middleware.py::test_posix_path_unchanged` — Verifies `/usr/local/file.ts` passes through — AC3, AC5
- `orchestrator/tests/test_path_middleware.py::test_plain_string_unchanged` — Verifies non-path strings pass through — AC3
- `orchestrator/tests/test_path_middleware.py::test_no_rewrite_returns_none` — Verifies `_rewrite_args` returns `None` when no changes needed — AC3
- `orchestrator/tests/test_path_middleware.py::test_multiple_args_partial_rewrite` — Verifies only matching args are rewritten in a multi-arg call — AC2, AC3
- `orchestrator/tests/test_path_middleware.py::test_empty_args` — Verifies empty args dict is handled — AC3
- `orchestrator/tests/test_path_middleware.py::test_root_dir_only_rewrites_to_slash` — Verifies `F:\root` → `/` — AC2
- `orchestrator/tests/test_path_middleware.py::test_awrap_tool_call_rewrites` — Verifies full middleware flow with `ToolCallRequest` mock and `override()` — AC2, AC6
- `orchestrator/tests/test_path_middleware.py::test_awrap_tool_call_passthrough` — Verifies handler is called with unmodified request when no rewriting needed — AC3
- `orchestrator/tests/test_nodes.py::test_middleware_passed_to_create_deep_agent` — Verifies `create_deep_agent` receives `middleware` kwarg with `PathNormalizationMiddleware` instance whose `_root` matches `target_path` — AC6

## Documentation Updates
- `orchestrator/docs/agents/project-manifest/constraints.md` — Add new constraint entry for `PathNormalizationMiddleware` requirement
- `orchestrator/src/nodes/templates/VARIABLES.md` — Update partial documentation to reflect new virtual-path hint content
- `orchestrator/changelog.md` — Add entry for path normalization middleware (handled by downstream Documentation agent)
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add a `### src/utils/path_middleware.py` section documenting `PathNormalizationMiddleware.__init__(root_dir)`, `_to_virtual()`, `_rewrite_args()`, and `awrap_tool_call()`.
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add `path_middleware.py` entry to the `src/utils/` directory listing.
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add a `### src/utils/path_middleware.py` section documenting `PathNormalizationMiddleware.__init__(root_dir)`, `_to_virtual()`, `_rewrite_args()`, and `awrap_tool_call()`.
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add `path_middleware.py` entry to the `src/utils/` directory listing.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Middleware rewriting corrupts MCP tool args** | MCP tools receive `project_path` via `inject_project_path`'s `ainvoke` monkeypatch, not through agent-supplied args. The middleware only rewrites values that case-insensitively match the `root_dir` prefix — MCP tools don't carry such values in agent-supplied args. Unit tests verify no corruption. |
| **`ToolCallRequest` API changes in future LangChain versions** | The `override()` API is the officially documented immutable pattern. Pin LangChain version in `requirements.txt` and test on upgrades. |
| **Case-insensitive comparison causes false positives on case-sensitive filesystems** | The middleware only activates when `root_dir` starts with `[a-zA-Z]:` (Windows drive letter). On case-sensitive OSes, `root_dir` never matches this pattern, so case-insensitive comparison is never used. |
| **Nested or escaped backslashes in tool args** | `_rewrite_args` replaces `\\` with `/` during normalization, handling both raw and escaped backslashes. Test coverage for this case. || **Subagent file tools bypass path normalization** | The `middleware` parameter passed to `create_deep_agent()` is appended only to the main agent's middleware stack; the general-purpose subagent's `gp_middleware` list is built independently and does not receive user-supplied middleware. In practice, the orchestrator's subagents perform task coordination via MCP tools rather than direct file operations, so the probability of a Windows-path file call from a subagent is low. If a future stage exposes subagents that require file access on Windows, extend `PathNormalizationMiddleware` to the subagent's `middleware` list in the subagent spec. |