
# Research Brief

## Scope Sketch

- **Orchestrator stage node factory** — `orchestrator/src/nodes/__init__.py` — modification (backend construction)
- **Orchestrator test suite** — `orchestrator/tests/test_nodes.py`, `orchestrator/tests/test_streaming_capture.py` — modification (patch updates + new test)
- **Orchestrator constraints** — `orchestrator/docs/agents/project-manifest/constraints.md` — new constraint entry

## Area: Orchestrator Stage Node Factory

### Verified References

- `orchestrator/src/nodes/__init__.py` (L868–L870): Current backend construction:
  ```python
  backend = LocalShellBackend(
      root_dir=target_path or None, virtual_mode=True, inherit_env=True
  )
  ```
  This is the sole place where the Deep Agent backend is instantiated. All 8 stages share this factory via `create_stage_node`.

- `orchestrator/src/nodes/__init__.py` (L822): Current import:
  ```python
  from deepagents.backends import LocalShellBackend  # type: ignore[import]
  ```
  The import is inside `node_fn` (lazy import pattern — consistent with `create_deep_agent` import on L821).

- `orchestrator/src/nodes/__init__.py` (L912–L918): The `backend` variable is passed directly to `create_deep_agent(backend=backend, ...)`. No other code in `node_fn` references the backend after construction.

### Patterns & Conventions

- **Lazy imports inside `node_fn`** — all `deepagents` imports are deferred to the closure body, not at module level. New imports (`CompositeBackend`, `StateBackend`) must follow this pattern. Established in `orchestrator/src/nodes/__init__.py` L821–822.
- **Stage node isolation** (Constraint 7) — each stage invocation creates its own Deep Agent instance; no state sharing between invocations. Established in `orchestrator/docs/agents/project-manifest/constraints.md`.
- **Comment-heavy change documentation** — existing backend construction has a multi-line security decision comment and a cross-platform rationale comment. New code should follow this pattern.

### Constraints

- Constraint 7 (Stage Node Isolation): Backend must be created fresh per invocation — no singleton `CompositeBackend`.
- Constraint 17 (ruff check): Must pass `ruff check .` after changes.
- Cross-Platform Policy (root AGENTS.md): Must work on Windows, macOS, and Linux. `CompositeBackend`, `StateBackend`, and `LocalShellBackend` are all platform-agnostic — no concern here.

## Area: deepagents Library Internals (v0.6.12)

### Verified References

- `deepagents/backends/__init__.py`: Exports `CompositeBackend`, `StateBackend`, `LocalShellBackend` — all importable from `deepagents.backends`.

- `deepagents/backends/composite.py` (L133–L160): `CompositeBackend.__init__` signature:
  ```python
  def __init__(
      self,
      default: BackendProtocol | StateBackend,
      routes: dict[str, BackendProtocol],
      *,
      artifacts_root: str = "/",
  ) -> None:
  ```

- `deepagents/backends/composite.py` (L535–L570): `CompositeBackend.execute()` delegates to `self.default` when `isinstance(self.default, SandboxBackendProtocol)`. `LocalShellBackend` implements `SandboxBackendProtocol` — shell execution is preserved.

- `deepagents/middleware/filesystem.py` (L877–L879): `FilesystemMiddleware` artifact path derivation:
  ```python
  artifacts_root = self.backend.artifacts_root if isinstance(self.backend, CompositeBackend) else "/"
  _root = artifacts_root.rstrip("/")
  self._large_tool_results_prefix = f"{_root}/large_tool_results"
  ```

- `deepagents/middleware/summarization.py` (L611–L614): `SummarizationMiddleware` identical derivation:
  ```python
  artifacts_root = backend.artifacts_root if isinstance(backend, CompositeBackend) else "/"
  _root = artifacts_root.rstrip("/")
  self._history_path_prefix = f"{_root}/conversation_history"
  self._large_tool_results_prefix = f"{_root}/large_tool_results"
  ```

- `deepagents/backends/composite.py` (L175–L233): `CompositeBackend.ls("/")` aggregates default backend entries plus route prefixes as virtual directories. When `artifacts_root="/artifacts"` and a route `"/artifacts/"` → `StateBackend()` is configured, `ls /` will show `/artifacts/` in the listing. The agent can still `ls /artifacts/large_tool_results/` to see offloaded files — they're stored in ephemeral `StateBackend` memory.

### Patterns & Conventions

- **`artifacts_root` is a first-class concept** — both middlewares check for it via `isinstance(backend, CompositeBackend)` at construction time. This is documented, tested, and stable in v0.6.12.
- **`StateBackend` is ephemeral** — stores files in-memory within the LangGraph agent state. Data is lost when the agent invocation ends. This is the desired behavior for `large_tool_results` (they are per-turn artifacts, not persistent project files).

### Constraints

- The `"/artifacts/"` route prefix must end with `/` (required by `CompositeBackend` routing semantics).
- `artifacts_root` must match the route prefix path (both set to `"/artifacts"`).
- `StateBackend()` does not implement `SandboxBackendProtocol` — but it's only used for the `/artifacts/` route, not as `default`. Shell execution goes through the `default` (`LocalShellBackend`).

## Area: Test Infrastructure

### Verified References

- `orchestrator/tests/test_nodes.py` (L85–L97): `_patch_deep_agent()` helper patches both `deepagents.create_deep_agent` and `deepagents.backends.LocalShellBackend`. After the change, the `LocalShellBackend` patch target becomes `deepagents.backends.LocalShellBackend` used inside `CompositeBackend(default=...)`. The patch must still mock `LocalShellBackend` since it's now wrapped in `CompositeBackend`.

- `orchestrator/tests/test_streaming_capture.py` (L60–L61): `_patch_backend()` helper:
  ```python
  def _patch_backend():
      return patch("deepagents.backends.LocalShellBackend", return_value=MagicMock())
  ```

- `orchestrator/tests/test_nodes.py`: 16+ test methods use `backend_p` (the `LocalShellBackend` patch) via `_patch_deep_agent()`. These continue to work because `CompositeBackend(default=<mocked LocalShellBackend>, ...)` accepts any object as `default`.

- `orchestrator/tests/test_deep_agent_integration.py` (L307–L334): Integration tests create a real `LocalShellBackend` — these should be updated to verify `CompositeBackend` wrapping in a new dedicated test.

### Patterns & Conventions

- **Patch at the import location** — tests patch `deepagents.backends.LocalShellBackend` (where the class is imported), not the module-level reference. This pattern continues to work because `node_fn` does `from deepagents.backends import LocalShellBackend` at call time.
- **Test helpers centralize patches** — `_patch_deep_agent()` and `_patch_backend()` are the canonical places to update.

### Constraints

- Existing tests must continue to pass without modification to their bodies — only the helpers may need updating.
- A new test should verify the `CompositeBackend` construction with `artifacts_root` and `/artifacts/` route.

## Area: Evidence of the Problem

### Verified References

- `mcp-server/storage/ledger/` (multiple chunk JSONL files): The grep search found 97 matches across 35 files showing `large_tool_results` paths in actual orchestrator run logs. This demonstrates the problem is real and recurring:
  - Agents see `/large_tool_results/` directories in `ls /` output (clutters project view)
  - Agents attempt to `read_file /large_tool_results/toolu_...` and sometimes get "File not found" errors when tool IDs are misspelled
  - Target project directory listings show `/large_tool_results/` as a visible entry alongside real project directories

