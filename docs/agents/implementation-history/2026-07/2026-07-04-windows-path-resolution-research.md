# Research Report: Orchestrator Windows Path Issues

## Problem Statement

The orchestrator fails to complete runs on Windows. Across 4 consecutive
attempts for the `2026-06-10-improved-dialogue-render` project, agent stages
either stall or error because agents cannot access files via the Deep Agents
sandbox — all file tool calls (`read_file`, `ls`, `write_file`) are rejected
with "Windows absolute paths are not supported." Meanwhile, MCP ledger tools
(which run server-side) work correctly. The net effect is that agents cannot
read plan documents, work package specs, or source code, making meaningful
progress impossible.

## Problem Decomposition

1. **Why do agents pass Windows paths to file tools?**
2. **Why do MCP tools work but file tools fail?**
3. **Why does `virtual_mode=True` not fully fix the problem?**
4. **Why does the PM re-initialize an existing ledger?**

## Context & Constraints

- Orchestrator runs on Windows (`F:\Webserver\www\htdocs\tools\...`)
- Deep Agents library v0.4.5 with `LocalShellBackend`
- MCP tools run server-side in Node.js (handle Windows paths natively)
- File tools (`read_file`, `ls`, `write_file`, `execute`, `grep`) run inside
  the Deep Agents sandbox with virtual filesystem
- `virtual_mode=True` was recently added to `LocalShellBackend` (plan
  `2026-07-04-windows-path-resolution`) — already deployed in code
- Cross-platform support (Windows/macOS/Linux) is a hard constraint

## Detailed Analysis

### Issue 1: Agents use Windows paths for file tools

**Evidence** (from `project-pm-r0.jsonl` and `WP-001-developer-r0.jsonl`):

```
read_file(file_path="F:\\Webserver\\...\\plan.md")
→ "Error: Windows absolute paths are not supported"

ls(path="F:\\Webserver\\...\\ai-insights-dev")
→ "Error: Windows absolute paths are not supported"
```

**Root cause chain:**

1. `cli.py` line 879: `initial_state["project_path"] = str(plan_dir)` —
   raw `Path.resolve()` result (Windows absolute path).
2. Every stage template includes `partials/project-path-reminder.md`:
   ```
   Please start using the project path: `{project_path}`.
   > NOTE: You can use this project path for all ledger tool calls...
   ```
3. Agent sees `F:\Webserver\...\slug` and uses it for ALL tool calls.
4. MCP tools accept it (server-side). File tools reject it (sandboxed).

**Same issue hits other projects too** — `comfyui-json-nodes` shows identical
errors for WP-003 developer and QA stages.

### Issue 2: MCP tools work, file tools fail

Two completely separate execution contexts:

| Tool Category | Execution Context | Path Handling |
|---------------|-------------------|---------------|
| MCP `ledger_*` tools | Node.js MCP server process (host) | `project_path` is a Windows path → works natively |
| `read_file`, `ls`, etc. | Deep Agents `LocalShellBackend` (sandboxed) | `validate_path()` rejects `^[a-zA-Z]:` patterns |

The `inject_project_path` wrapper in `tool_wrappers.py` correctly injects
the Windows path into MCP calls. No translation needed for those.

### Issue 3: `virtual_mode=True` is insufficient alone

The fix applied by plan `2026-07-04-windows-path-resolution` correctly
switches path *resolution* to virtual mode. However:

- `validate_path()` in `deepagents/backends/utils.py` runs **before**
  `_resolve_path()` and rejects any path matching `^[a-zA-Z]:`
  unconditionally — `virtual_mode` has no effect on this check.
- Even if validation were bypassed, agent prompts still embed Windows
  paths, so agents will always attempt Windows paths first.
- `virtual_mode=True` IS needed for the case where agents correctly use
  `/`-rooted virtual paths. Without it, POSIX-style root-anchored paths
  mis-resolve on Windows due to pathlib drive-letter replacement.

**Conclusion:** `virtual_mode=True` is necessary but insufficient.

### Issue 4: PM re-initialization loop

**Timeline across 4 runs:**

| Run | Time | Supervisor Status | PM Action | Result |
|-----|------|-------------------|-----------|--------|
| 1 | 04:52 | "Root index not found" | `ledger_help` → stall | Killed |
| 2 | 05:25 | "Root index not found" | (no calls captured) | Killed |
| 3 | 05:27 | "Root index not found" | `ledger_initialize_project` | Succeeded, then killed |
| 4 | 07:22 | "no work packages found" (0 WPs) | `ledger_initialize_project` | "already exists" error |

**Root cause:** The PM's first useful action (`ledger_help` →
`read_file(plan.md)`) fails because `read_file` rejects the Windows path.
Without reading the plan, the PM falls back to re-initialization. This is
a downstream symptom of Issue 1 — fixing path handling resolves it.

## Approaches Considered

### Approach 1: Prompt-only fix (dual-path instructions)

Update prompts to tell agents to use `/`-rooted virtual paths for file
tools and Windows paths for MCP tools.

- **Pro:** Simple template change.
- **Con:** Adds cognitive load on models; agents may still use the Windows
  path from context. Fragile — depends on model compliance.

### Approach 2: Upstream `validate_path()` patch

Modify `validate_path()` in Deep Agents to auto-translate Windows paths
under `root_dir` instead of rejecting them.

- **Pro:** Fixes the problem at the source.
- **Con:** Requires upstream PR or local monkey-patch. Deep Agents is
  deliberately moving toward mandatory virtual mode (deprecation warning
  since v0.5.0, default change in v0.6.0). Unlikely to accept Windows
  path accommodation.

### Approach 3: `AgentMiddleware.wrap_tool_call()` — path rewriting

Use the official LangChain agent middleware API to intercept tool calls
and rewrite Windows paths to virtual paths before `validate_path()` runs.

- **Pro:** Official API, no monkey-patching, no upstream changes,
  transparent to agents, zero tool-name maintenance.
- **Con:** Adds one new file and one line change.

## Recommendation: `PathNormalizationMiddleware`

**Approach 3 is the recommended solution.** A single `AgentMiddleware`
subclass that intercepts all tool calls and rewrites Windows absolute paths
to virtual paths. Combined with the existing `virtual_mode=True`, this
resolves all observed failures.

### How `AgentMiddleware.wrap_tool_call` works

The `ToolCallRequest` object exposes:
- `request.tool_call["name"]` — tool name (e.g., `"read_file"`)
- `request.tool_call["args"]` — tool arguments (e.g., `{"file_path": "F:\\..."}`)
- `request.override(tool_call=modified_call)` — creates a new request with
  modified args (immutable pattern)

Middleware composes as "first in list = outermost". `create_deep_agent()`
builds its internal stack then **appends** user-supplied middleware, placing
it as the **innermost** layer — running immediately before the tool function.

### Value-based matching (no tool-name list to maintain)

The middleware scans every string arg in every tool call for the
`^[a-zA-Z]:` Windows drive-letter pattern and only rewrites values whose
normalized form starts with the known `root_dir` prefix. This is
zero-maintenance — it works for any tool, present or future.

**Safety with MCP tools:** Both MCP tools and filesystem tools flow through
`wrap_tool_call`. However, MCP tools are safe because `inject_project_path`
(in `tool_wrappers.py`) overwrites `project_path` via the separate `ainvoke`
monkeypatch. In practice, the agent never supplies `project_path` for MCP
calls — it's auto-injected — so there is nothing to rewrite.

### Sketch implementation

```python
class PathNormalizationMiddleware(AgentMiddleware):
    def __init__(self, root_dir: str):
        self._root = root_dir.replace("\\", "/").rstrip("/")

    def _to_virtual(self, value: str) -> str:
        normalized = value.replace("\\", "/")
        if normalized.lower().startswith(self._root.lower()):
            suffix = normalized[len(self._root):].lstrip("/")
            return "/" + suffix if suffix else "/"
        return value

    def _rewrite_args(self, args: dict) -> dict | None:
        changed = False
        new_args = {}
        for k, v in args.items():
            if isinstance(v, str) and re.match(r"^[a-zA-Z]:", v):
                rewritten = self._to_virtual(v)
                if rewritten != v:
                    new_args[k] = rewritten
                    changed = True
                    continue
            new_args[k] = v
        return new_args if changed else None

    async def awrap_tool_call(self, request, handler):
        new_args = self._rewrite_args(request.tool_call.get("args", {}))
        if new_args is not None:
            modified = {**request.tool_call, "args": new_args}
            request = request.override(tool_call=modified)
        return await handler(request)
```

### What does NOT work (investigated and ruled out)

- **`FilesystemMiddleware` hooks** — has no path transformer configuration;
  `validate_path()` is hardcoded inside each tool closure.
- **`tool_wrappers.py` ainvoke monkeypatch** — filesystem tools bypass
  `ainvoke`; they're invoked through the graph's ToolNode/middleware chain.
- **LangGraph `ToolNode` hooks** — ToolNode delegates to the middleware
  chain; no separate hooks exist.

### Required changes

1. **New file:** `orchestrator/src/utils/path_middleware.py` — the
   `PathNormalizationMiddleware` class (~30 lines of logic).
2. **One edit in** `orchestrator/src/nodes/__init__.py` — pass the
   middleware to `create_deep_agent()`:
   ```python
   agent = create_deep_agent(
       ...,
       middleware=[PathNormalizationMiddleware(target_path)],
   )
   ```

### What stays as-is

- `virtual_mode=True` on `LocalShellBackend` — still needed for correct
  resolution of `/`-rooted paths on Windows.
- `inject_project_path` wrapper — still needed for MCP tool path injection.
- `project-path-reminder.md` prompt partial — no changes needed; agents can
  keep using Windows paths naturally.

### Companion task: Persona hint for virtual path results

The middleware silently rewrites outgoing args, but tool *results* (e.g.,
`ls` entries, `grep` match paths) come back as `/`-rooted virtual paths
from the Deep Agents backend. An agent that sent
`read_file("F:\...\src\file.ts")` will see results referencing
`/src/file.ts`. While models generally recover, a brief persona-level hint
would prevent unnecessary "why did the path change?" reasoning loops.

This hint:
- Is only relevant for the **deep-agents output target** (not VS Code or
  Claude Code personas, which don't use the Deep Agents sandbox).
- Should be placed by the **Persona Curator** in the appropriate persona
  partial or deep-agents-specific conditional section.
- Should inform agents that both path formats are accepted and that results
  use virtual `/`-rooted paths — without requiring agents to convert paths
  themselves.

The Planner should include this as a low-priority companion task alongside
the middleware implementation.

## Open Questions

- **Should `read_file`-equivalent MCP tools be added?** An alternative
  approach: expose file reading via MCP tools (server-side) so agents never
  need the sandbox file tools at all. This would be a larger architectural
  change but would eliminate the path domain mismatch entirely.

## References

- `deepagents/backends/utils.py` — `validate_path()` Windows rejection
  (`^[a-zA-Z]:` regex)
- `deepagents/backends/filesystem.py` — `_resolve_path()` virtual mode
- `deepagents/middleware/filesystem.py` — `FilesystemMiddleware` tool
  creation (hardcoded `validate_path()` in each tool closure)
- `langchain/agents/middleware/types.py` — `AgentMiddleware.wrap_tool_call`
  / `awrap_tool_call` API
- `langgraph/prebuilt/tool_node.py` — `ToolCallRequest.override()` API
- `orchestrator/src/nodes/__init__.py` lines 852-864 — backend setup,
  `create_deep_agent()` call
- `orchestrator/src/nodes/templates/partials/project-path-reminder.md` —
  current prompt partial
- `orchestrator/src/utils/tool_wrappers.py` — `inject_project_path` wrapper
- `orchestrator/src/cli.py` lines 879-882 — initial state construction
- Plan `2026-07-04-windows-path-resolution` — prior `virtual_mode=True` fix
- Log files: `mcp-server/storage/ledger/ai-insights-dev/2026-06-10-improved-dialogue-render/orchestrator/logs/`
- Captured dialogues: `orchestrator/chunks/project-pm-r0.jsonl` and
  `WP-001-developer-r0.jsonl`
