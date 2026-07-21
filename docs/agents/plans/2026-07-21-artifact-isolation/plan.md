
# Plan

## Plan Audit Cycles
- Audits: 13 — Plan Auditor v1.6.0
- Architectural Reviews: 4 — Plan Architect Reviewer v2.1.0

## Summary

The Deep Agents middleware stack (`FilesystemMiddleware`, `SummarizationMiddleware`) writes internal artifacts — `large_tool_results/` and `conversation_history/` — to the backend's root. With the current `LocalShellBackend` as the sole backend, these artifacts land on disk inside the target project directory, creating git-noise, confusing agent directory listings, and occasionally causing "file not found" errors when agents misspell offloaded tool result IDs. This plan replaces the bare `LocalShellBackend` with a `CompositeBackend` that routes artifact writes to an ephemeral `StateBackend` via the `artifacts_root` mechanism, keeping all project file operations and shell execution unchanged.

## Architectural Context

The orchestrator's stage node factory `create_stage_node` in `orchestrator/src/nodes/__init__.py` constructs a `LocalShellBackend(root_dir=target_path, virtual_mode=True, inherit_env=True)` per stage invocation. This backend is passed to `create_deep_agent()`, which internally injects `FilesystemMiddleware(backend=backend)` and `SummarizationMiddleware(model, backend)`. Both middlewares derive artifact paths from `backend.artifacts_root` when the backend is a `CompositeBackend`; otherwise they default to `"/"`, placing artifacts at the filesystem root of the `LocalShellBackend` — i.e., inside the target project directory.

## Approach / Architecture

Wrap the existing `LocalShellBackend` in a `CompositeBackend` with:

1. **`default`** = the existing `LocalShellBackend` (unchanged — all file operations and `execute()` continue to route here)
2. **`routes`** = `{"/artifacts/": StateBackend()}` (ephemeral in-memory storage for middleware artifacts)
3. **`artifacts_root`** = `"/artifacts"` (tells both middlewares to prefix artifact paths with `/artifacts/`, which routes them to the `StateBackend`)

This is a ~5-line change in `create_stage_node`'s `node_fn` body. No state schema changes, no CLI changes, no prompt changes.

## Rationale

- **`CompositeBackend` + `artifacts_root`** is a first-class mechanism in `deepagents` v0.6.12 — both middlewares have production code that checks for it.
- **`StateBackend`** stores data in LangGraph agent state (in-memory), never touching the filesystem. Artifacts are inherently per-turn and do not need to survive beyond the agent invocation.
- **Zero behavioral change** for project file operations: `LocalShellBackend` remains the `default` backend, so `read`, `write`, `edit`, `ls`, `glob`, `grep`, and `execute` all route to it as before.
- **Subagent compatibility**: `create_deep_agent` is called with `backend=backend` where `backend` is the new `CompositeBackend`. The `deepagents` v0.6.12 source confirms this `CompositeBackend` is passed directly to `FilesystemMiddleware` and `create_summarization_middleware` for every `SubAgent` spec in the assembly loop — artifact isolation therefore applies to subagents in the same invocation automatically, with no additional implementation required.
- **Cross-platform**: all three backend classes are pure Python with no OS-specific code.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Artifact storage backend | `CompositeBackend` with `StateBackend` route for `/artifacts/` | (a) `.gitignore` entries for `large_tool_results/` and `conversation_history/`; (b) Custom `SandboxBackendProtocol` wrapper around `StateBackend` as `default` | (a) still pollutes the filesystem and shows in `ls /` output — addresses git-noise but not agent confusion; (b) Approach B from the research report, adds ~30 lines of custom code for the same outcome, dismissed because `LocalShellBackend` as `default` preserves `execute()` with zero custom code |
| Artifact route prefix | `/artifacts/` | (a) Root-level names like `/large_tool_results/`, `/conversation_history/` with no routing; (b) `/internal/` or `/.agent/` | `/artifacts/` is descriptive, won't collide with real project directories, and matches the `artifacts_root` parameter name semantically |

## Pattern Alignment

- **Lazy imports inside `node_fn`** — follows the established pattern at `orchestrator/src/nodes/__init__.py` L821–822 where `create_deep_agent` and `LocalShellBackend` are imported inside the closure.
- **Comment-heavy change documentation** — follows the existing pattern where the `LocalShellBackend` construction has a multi-line security decision comment and a Windows path resolution rationale comment.
- **Stage node isolation** (Constraint 7) — each invocation creates a fresh `CompositeBackend` wrapping a fresh `LocalShellBackend`. No state sharing.

## Detailed Steps

### Step 1: Update backend construction in `create_stage_node`

**File:** `orchestrator/src/nodes/__init__.py`

Replace the current `LocalShellBackend` instantiation (L868–L870) with a `CompositeBackend`-wrapped version:

```python
from deepagents.backends import CompositeBackend, LocalShellBackend, StateBackend  # type: ignore[import]

shell = LocalShellBackend(
    root_dir=target_path or None, virtual_mode=True, inherit_env=True
)
# Wrap in CompositeBackend to isolate middleware artifacts
# (large_tool_results/, conversation_history/) from the project
# directory. Both FilesystemMiddleware and SummarizationMiddleware
# derive their artifact paths from artifacts_root when the backend
# is a CompositeBackend, routing writes to the /artifacts/ prefix
# which maps to an ephemeral StateBackend (in-memory, never on disk).
# Shell execution and all project file operations remain on the
# LocalShellBackend (the default).
backend = CompositeBackend(
    default=shell,
    routes={"/artifacts/": StateBackend()},
    artifacts_root="/artifacts",
)
```

The variable name `backend` is preserved — all downstream references (`create_deep_agent(backend=backend, ...)`) continue to work without modification.

Update the import line from:
```python
from deepagents.backends import LocalShellBackend  # type: ignore[import]
```
to:
```python
from deepagents.backends import CompositeBackend, LocalShellBackend, StateBackend  # type: ignore[import]
```

### Step 2: Update test helper `_patch_deep_agent` in `test_nodes.py`

**File:** `orchestrator/tests/test_nodes.py`

The existing `_patch_deep_agent()` helper patches `deepagents.backends.LocalShellBackend` to return a `MagicMock()`. After the change, `node_fn` also imports `CompositeBackend` and `StateBackend`. Both classes are pure attribute-assignment constructors with no I/O and are safe to instantiate in tests, so patching them is for isolation consistency rather than necessity. Note that the 20 inline `patch("deepagents.backends.LocalShellBackend", …)` sites in `test_nodes.py` (e.g., L260, L354, L512, L573) are not routed through `_patch_deep_agent()` and are intentionally left un-updated — they will silently instantiate real `CompositeBackend`/`StateBackend` alongside the mocked `LocalShellBackend`, which is functionally safe.

Add `from contextlib import contextmanager` to the file-level imports in `test_nodes.py` (no existing `contextlib` import):

```python
from contextlib import contextmanager
```

Convert `_patch_deep_agent()` to a `@contextmanager` that patches all four targets and yields the `agent_mock`. This harmonizes the helper with `_patch_backend()` in `test_streaming_capture.py` and reduces per-call-site line count (the assignment line disappears entirely):

```python
@contextmanager
def _patch_deep_agent(response: str = "Done."):
    """Context manager: patches deepagents.create_deep_agent and all backend classes."""
    agent_mock = _make_agent_mock(response)
    with (
        patch("deepagents.create_deep_agent", return_value=agent_mock),
        patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()),
        patch("deepagents.backends.CompositeBackend", return_value=MagicMock()),
        patch("deepagents.backends.StateBackend", return_value=MagicMock()),
    ):
        yield agent_mock
```

Replace `_patch_deep_agent` in-place — do not keep the old 2-tuple version alongside a new function. All 20 call sites that use the helper collapse from two lines to one (the 20 inline `patch("deepagents.backends.LocalShellBackend", …)` sites at L260, L354, L512, L573, and others do not go through the helper and are intentionally left unchanged — see the note above):

```python
# Before (two lines):
create_p, backend_p = _patch_deep_agent(response)
with _patch_persona(), create_p, backend_p:

# After (one line):
with _patch_persona(), _patch_deep_agent(response):
```

The `yield agent_mock` return value is not used at existing call sites — `with _patch_persona(), _patch_deep_agent(response):` is the canonical form. Tests that need to inspect the agent mock should use `as` binding on the inner manager if needed.

### Step 3: Update test helper `_patch_backend` in `test_streaming_capture.py`

**File:** `orchestrator/tests/test_streaming_capture.py`

Same pattern — `_patch_backend()` must also patch `CompositeBackend` and `StateBackend`. Add the `contextlib` import at the top of the file alongside the existing imports (the file has no existing `contextlib` import):

```python
from contextlib import contextmanager
```

Then update the helper:

```python
@contextmanager
def _patch_backend():
    with (
        patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()),
        patch("deepagents.backends.CompositeBackend", return_value=MagicMock()),
        patch("deepagents.backends.StateBackend", return_value=MagicMock()),
    ):
        yield
```

### Step 4: Add tests verifying `CompositeBackend` construction and agent-side integration

#### Step 4a — Construction test in `test_nodes.py`

**File:** `orchestrator/tests/test_nodes.py`

Add a new test class that verifies the backend is constructed correctly:

```python
class TestBackendArtifactIsolation:
    """Verify that create_stage_node wraps LocalShellBackend in CompositeBackend
    with StateBackend artifact routing."""

    async def test_backend_uses_composite_with_artifacts_root(self):
        """create_stage_node must construct a CompositeBackend with
        artifacts_root='/artifacts' and a StateBackend route for '/artifacts/'."""
        from src.nodes import create_stage_node

        captured_kwargs = {}

        def spy_create(**kwargs):
            captured_kwargs.update(kwargs)
            return _make_agent_mock("Done.")

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "test prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        with (
            _patch_persona(),
            patch("deepagents.create_deep_agent", side_effect=spy_create) as _,
        ):
            await node_fn(base_state())

        backend = captured_kwargs.get("backend")
        assert backend is not None

        # Verify it's a CompositeBackend
        from deepagents.backends import CompositeBackend, LocalShellBackend, StateBackend
        assert isinstance(backend, CompositeBackend)

        # Verify the default is a LocalShellBackend
        assert isinstance(backend.default, LocalShellBackend)

        # Verify artifacts_root is set
        assert backend.artifacts_root == "/artifacts"

        # Verify the /artifacts/ route exists and maps to a StateBackend
        assert "/artifacts/" in backend.routes
        assert isinstance(backend.routes["/artifacts/"], StateBackend)
```

#### Step 4b — Integration tests in `test_deep_agent_integration.py`

**File:** `orchestrator/tests/test_deep_agent_integration.py`

The two agent-facing consequences of this change require integration coverage:

1. **`PathNormalizationMiddleware` + `CompositeBackend` compatibility** — Test 2 (`test_path_middleware_rewrites_through_deep_agent`) explicitly uses a bare `LocalShellBackend`. After this change, the production path is `PathNormalizationMiddleware` + `CompositeBackend` + `StateBackend`. This combination has no test.

2. **Artifact prefix derivation by `FilesystemMiddleware`** — The `_large_tool_results_prefix` shifts from `/large_tool_results` to `/artifacts/large_tool_results`. The middleware derives this at construction time based on `isinstance(backend, CompositeBackend)`. A direct check of the computed prefix is the cleanest way to protect AC-04 without needing a full offload-threshold simulation.

**Test 5 — `test_path_middleware_with_composite_backend`:**

Variant of test 2 using the production backend config. Verifies that `PathNormalizationMiddleware` still rewrites absolute host paths correctly when the backend is `CompositeBackend` + `StateBackend`:

```python
@pytest.mark.deepagent
async def test_path_middleware_with_composite_backend() -> None:
    """PathNormalizationMiddleware must rewrite paths identically when the
    backend is CompositeBackend(default=LocalShellBackend, …) rather than a
    bare LocalShellBackend — the production configuration after the
    artifact-isolation change.

    Scripted model: one read_file call with an absolute host path, then Done.
    Expected: middleware rewrites the path to the virtual /-rooted equivalent.
    """
    from deepagents import create_deep_agent
    from deepagents.backends import CompositeBackend, LocalShellBackend, StateBackend

    from src.utils.path_middleware import PathNormalizationMiddleware

    root_dir = "/Users/dev/project"

    rf_calls: list = []
    read_file_tool = _make_read_file_tool(rf_calls)

    fake_model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(
            content="",
            tool_calls=[{
                "name": "read_file",
                "args": {"file_path": "/Users/dev/project/src/main.py"},
                "id": "call-read-composite-001",
                "type": "tool_call",
            }],
        ),
        AIMessage(content="Done."),
    ]))

    path_middleware = PathNormalizationMiddleware(root_dir)
    shell = LocalShellBackend(root_dir=None, virtual_mode=False)
    backend = CompositeBackend(
        default=shell,
        routes={"/artifacts/": StateBackend()},
        artifacts_root="/artifacts",
    )

    agent = create_deep_agent(
        model=fake_model,
        backend=backend,
        system_prompt="You are a helpful assistant.",
        tools=[read_file_tool],
        middleware=[path_middleware],
    )

    run_config = RunnableConfig(
        configurable={"thread_id": "deepagent-test-composite-middleware-001"}
    )

    async for _stream_item in agent.astream(
        {"messages": [{"role": "user", "content": "Read /Users/dev/project/src/main.py"}]},
        stream_mode="messages",
        subgraphs=True,
        config=run_config,
    ):
        pass

    assert len(rf_calls) >= 1
    assert rf_calls[0]["file_path"] == "/src/main.py", (
        f"Expected '/src/main.py' after PathNormalizationMiddleware; got {rf_calls[0]['file_path']!r}"
    )
```

**Test 6 — `test_filesystem_middleware_artifact_prefix_with_composite_backend`:**

Verifies `FilesystemMiddleware` computes the correct `_large_tool_results_prefix` under both configurations — bare `LocalShellBackend` (pre-change baseline) and `CompositeBackend` (post-change production) — making both cases explicit in a single comparative test:

```python
@pytest.mark.deepagent
def test_filesystem_middleware_artifact_prefix_with_composite_backend() -> None:
    """FilesystemMiddleware must compute _large_tool_results_prefix based on
    the backend type:
    - bare LocalShellBackend → '/large_tool_results'
    - CompositeBackend(artifacts_root='/artifacts') → '/artifacts/large_tool_results'

    Both configurations are verified explicitly to document the before-and-after
    behavior of the artifact-isolation change.

    Covers AC-04: agents receive the correct re-read path from the middleware's
    offloading message and can route that read to StateBackend.
    """
    from deepagents.backends import CompositeBackend, LocalShellBackend, StateBackend
    from deepagents.middleware.filesystem import FilesystemMiddleware

    # Configuration 1: bare LocalShellBackend (pre-change baseline)
    bare_middleware = FilesystemMiddleware(
        backend=LocalShellBackend(root_dir=None, virtual_mode=True, inherit_env=False)
    )
    assert bare_middleware._large_tool_results_prefix == "/large_tool_results", (
        f"Expected '/large_tool_results' for bare LocalShellBackend; "
        f"got {bare_middleware._large_tool_results_prefix!r}"
    )

    # Configuration 2: CompositeBackend with artifacts_root (post-change production)
    shell = LocalShellBackend(root_dir=None, virtual_mode=True, inherit_env=False)
    composite_backend = CompositeBackend(
        default=shell,
        routes={"/artifacts/": StateBackend()},
        artifacts_root="/artifacts",
    )
    composite_middleware = FilesystemMiddleware(backend=composite_backend)
    assert composite_middleware._large_tool_results_prefix == "/artifacts/large_tool_results", (
        f"Expected '/artifacts/large_tool_results' for CompositeBackend with artifacts_root='/artifacts'; "
        f"got {composite_middleware._large_tool_results_prefix!r}"
    )
```

Note: this test imports `FilesystemMiddleware` directly to inspect the computed prefix at construction time. If `FilesystemMiddleware` moves the prefix derivation or renames the attribute in a future `deepagents` release, this test will catch the drift immediately.

### Step 5: Add constraint entry to constraints.md

**File:** `orchestrator/docs/agents/project-manifest/constraints.md`

Add a new constraint documenting the artifact isolation pattern. Append it as `### 28.` at the end of the file (currently ends at `### 27.`); this avoids renumbering any existing constraints:

```markdown
### 28. Middleware Artifacts Must Route to Ephemeral Storage

**Rule:** The `CompositeBackend` passed to `create_deep_agent()` must route the `/artifacts/` prefix to a `StateBackend` instance and set `artifacts_root="/artifacts"`. This ensures that `FilesystemMiddleware` and `SummarizationMiddleware` write their internal artifacts (`large_tool_results/`, `conversation_history/`) to ephemeral in-memory storage instead of the target project's filesystem.

**Rationale:** Without artifact isolation, middleware writes `large_tool_results/` and `conversation_history/` directories into the target project's root. This creates git-noise, confuses agents (the directories appear in `ls /` alongside real project files), and occasionally causes errors when agents attempt to re-read offloaded results with misspelled tool IDs from a previous stage invocation.

**Anti-pattern:**
\```python
# ❌ WRONG — bare LocalShellBackend; middleware artifacts land in the project directory
backend = LocalShellBackend(root_dir=target_path or None, virtual_mode=True, inherit_env=True)
\```

**Correct pattern:**
\```python
# ✅ CORRECT — CompositeBackend routes artifacts to ephemeral StateBackend
shell = LocalShellBackend(root_dir=target_path or None, virtual_mode=True, inherit_env=True)
backend = CompositeBackend(
    default=shell,
    routes={"/artifacts/": StateBackend()},
    artifacts_root="/artifacts",
)
\```

**Caveat:** Offloaded tool results are no longer readable from disk after the agent invocation ends. This is the intended behavior — these are per-turn artifacts. Agents can still `read_file /artifacts/large_tool_results/<tool_call_id>` within the same invocation because `StateBackend` serves them from memory. The `/artifacts/` directory structure is self-documented by the comment block in the `CompositeBackend` construction in `nodes/__init__.py` (Step 1) and by this constraint entry — no seeded README file is injected into the agent's file system.
```

### Step 6: Run `ruff check` and test suite

- Run `cd orchestrator && python3 -m ruff check .` and resolve any violations.
- Run `cd orchestrator && python3 -m pytest tests/test_nodes.py tests/test_streaming_capture.py -x` to verify all existing + new tests pass.
- Run `cd orchestrator && python3 -m pytest` for the full suite.

## Dependencies

- `deepagents>=0.6,<1` (confirmed stable in v0.6.12, the current latest stable release) — `CompositeBackend`, `StateBackend`, and `artifacts_root` are all present and production-tested in this version.

## Required Components

- `orchestrator/src/nodes/__init__.py` — modified (backend construction)
- `orchestrator/tests/test_nodes.py` — modified (patch helper + new `TestBackendArtifactIsolation` class)
- `orchestrator/tests/test_streaming_capture.py` — modified (patch helper)
- `orchestrator/tests/test_deep_agent_integration.py` — modified (two new integration tests: `test_path_middleware_with_composite_backend`, `test_filesystem_middleware_artifact_prefix_with_composite_backend`)
- `orchestrator/docs/agents/project-manifest/constraints.md` — modified (new constraint)

## Assumptions

- `deepagents` v0.6.12 (the current latest stable) remains the installed version. The `CompositeBackend.artifacts_root` mechanism is stable and not deprecated.
- `StateBackend` is suitable for ephemeral artifact storage. It stores data in-memory and does not persist across agent invocations.
- Agents do not need to read `large_tool_results` or `conversation_history` across stage boundaries (each stage is a separate `create_deep_agent` invocation with its own backend).

## Constraints

- Must not change the `WorkflowState` schema — no new state fields.
- Must not change the CLI interface — no new flags.
- Must not change prompt templates — no new variables.
- Must not change `PathNormalizationMiddleware` behavior — it operates on the `target_path`, not the backend type.

## Out of Scope

- Multi-root `CompositeBackend` support for cross-repository orchestration (the full multi-root feature from the research report).
- `.gitignore` entries for `large_tool_results/` — the fix eliminates the problem at the source; no filesystem cleanup is needed.
- Cleanup of existing `large_tool_results/` directories in target projects from prior runs — users can delete these manually.
- `PathNormalizationMiddleware` changes — it skips MCP tools and rewrites based on `target_path`, not the backend; unaffected by this change.
- Subagent backend propagation is **confirmed behavior** in v0.6.12 (the `CompositeBackend` is passed directly to `FilesystemMiddleware` and `create_summarization_middleware` for every `SubAgent` spec), not an unverified assumption. No additional implementation is required to extend artifact isolation to subagents.

## Acceptance Criteria

- AC-01: `large_tool_results/` and `conversation_history/` directories no longer appear in the target project's filesystem after an orchestrator run.
- AC-02: Shell execution (`execute`) continues to work with `cwd` at the target project path.
- AC-03: All file operations (`read`, `write`, `edit`, `ls`, `glob`, `grep`) against project files continue to work identically.
- AC-04: Agents can still `read_file /artifacts/large_tool_results/<tool_call_id>` within the same invocation to retrieve offloaded content.
- AC-05: A new test verifies that `create_stage_node` constructs a `CompositeBackend` with `artifacts_root="/artifacts"` and a `StateBackend` route for `/artifacts/`.
- AC-06: A new test class `TestBackendArtifactIsolation` exists in `test_nodes.py` and passes, verifying `CompositeBackend` construction with `artifacts_root="/artifacts"`, a `LocalShellBackend` default, and a `StateBackend` route for `/artifacts/`.
- AC-07: The new constraint is documented in `constraints.md`.
- AC-08: A `@pytest.mark.deepagent` integration test in `test_deep_agent_integration.py` verifies that `PathNormalizationMiddleware` correctly rewrites absolute host paths when wired with `CompositeBackend` + `StateBackend` (the production backend configuration after this change).
## Testing Strategy

The change is small and structurally simple, but it has **two agent-facing behavioral consequences** that require integration test coverage beyond the unit-level construction test:

1. **Artifact path prefix change** — `FilesystemMiddleware._large_tool_results_prefix` shifts from `/large_tool_results` to `/artifacts/large_tool_results`. Agents follow the path the middleware embeds in the offloading message, so they will automatically use the correct new path — but only if the middleware computes it correctly. `deepagents` does not test our specific `artifacts_root` configuration; we must verify the derived prefix directly (AC-04).

2. **`PathNormalizationMiddleware` + `CompositeBackend` compatibility** — Test 2 in `test_deep_agent_integration.py` exercises `PathNormalizationMiddleware` with a bare `LocalShellBackend`. After this change, the production path is `PathNormalizationMiddleware` + `CompositeBackend` + `StateBackend`. That combination has no test. The `CompositeBackend` delegates reads/writes based on path prefix routing, and there is no guarantee that `PathNormalizationMiddleware`'s rewrites compose correctly with that routing without exercising it.

Testing is therefore split across three levels:
- **Patch-level (non-regression)** — existing `test_nodes.py` and `test_streaming_capture.py` tests pass with updated helpers.
- **Construction (unit)** — `TestBackendArtifactIsolation` in `test_nodes.py` verifies the shape of the backend object passed to `create_deep_agent`.
- **Integration** — two new `@pytest.mark.deepagent` tests in `test_deep_agent_integration.py` exercise the production backend configuration through real `create_deep_agent` and middleware stack calls.

## Test Plan

- `orchestrator/tests/test_nodes.py::TestBackendArtifactIsolation::test_backend_uses_composite_with_artifacts_root` — Asserts that `create_stage_node` passes a `CompositeBackend` with `artifacts_root="/artifacts"`, a `LocalShellBackend` default, and a `StateBackend` route for `/artifacts/` to `create_deep_agent`. Covers AC-06.
- `orchestrator/tests/test_nodes.py` (all existing tests) — Non-regression: existing stage node tests must pass with updated patch helpers. Covers AC-05.
- `orchestrator/tests/test_streaming_capture.py` (all existing tests) — Non-regression: streaming capture tests must pass with updated patch helpers. Covers AC-05.
- `orchestrator/tests/test_deep_agent_integration.py` (all existing tests) — Non-regression: existing tests that exercise `create_stage_node` will now run against the real `CompositeBackend` (since `create_deep_agent` is not patched in `test_deep_agent_integration.py`). These tests verify the happy-path lifecycle still completes `stage_success=True`. Covers AC-05.
- `orchestrator/tests/test_deep_agent_integration.py::test_path_middleware_with_composite_backend` — Exercises `PathNormalizationMiddleware` + `CompositeBackend` + `StateBackend` (production configuration) through real `create_deep_agent`; asserts path rewrite succeeds. Covers AC-08.
- `orchestrator/tests/test_deep_agent_integration.py::test_filesystem_middleware_artifact_prefix_with_composite_backend` — Directly verifies `FilesystemMiddleware._large_tool_results_prefix == "/artifacts/large_tool_results"` when constructed with the plan's `CompositeBackend` configuration. Covers AC-04.
## Documentation Updates

- `orchestrator/docs/agents/project-manifest/constraints.md` — Add new numbered constraint documenting the artifact isolation pattern (Step 5).
- `orchestrator/docs/architecture.md` — Update step 5 of the stage node lifecycle description to replace the `LocalShellBackend(root_dir=target_project_path, inherit_env=True)` reference with the `shell` + `CompositeBackend` construction and `artifacts_root="/artifacts"` artifact routing.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Test patch surface increase** — adding `CompositeBackend` and `StateBackend` patches to every test helper increases coupling to the backend construction logic. | `_patch_deep_agent` is replaced in-place and remains the single location to update if backend construction changes again. |
| **`StateBackend` memory usage** — very large tool results stored in `StateBackend` consume LangGraph state memory. | This is already the case with `SummarizationMiddleware`'s conversation history in any backend. The `StateBackend` adds no new memory pressure beyond what was previously on disk. |
| **Agent re-reads of offloaded results across stages** — if an agent in a later stage tries to read `/large_tool_results/toolu_...` from a previous stage, the file won't exist in the new `StateBackend` (each stage gets a fresh instance). | This was already a failure mode with `LocalShellBackend` + `virtual_mode=True` — each stage gets a fresh backend, so cross-stage reads of offloaded results fail regardless. The grep evidence confirms agents already encounter "File not found" errors for these paths. No behavioral change. |
| **`/artifacts/` virtual directory visible in agent `ls /` output** — `CompositeBackend.ls("/")` surfaces route prefixes as virtual directory stubs alongside real project files. Agents performing broad discovery (`ls /`) will see `/artifacts/` in the listing. | The directory name is descriptive and distinct from any conventional project directory. No agent persona currently references `/large_tool_results/` by path in prompts. Agents follow the re-read path embedded in the middleware offloading message, not a hardcoded path. |
| **`FilesystemMiddleware` private attribute dependency** — test 6 (`test_filesystem_middleware_artifact_prefix_with_composite_backend`) inspects `middleware._large_tool_results_prefix` directly. A future `deepagents` release could rename or remove this private attribute, silently breaking the test. | The test will fail loudly (`AttributeError`) if the attribute is removed, and the string comparison will catch a rename. No silent drift is possible. |

