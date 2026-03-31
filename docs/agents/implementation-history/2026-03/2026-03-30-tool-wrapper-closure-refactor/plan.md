# Plan — tool_wrappers.py Closure Refactor & Monkeypatch Encapsulation

## Summary

Refactor `orchestrator/src/utils/tool_wrappers.py` to address two code-quality issues from the ToolMessage-fix synthesis: (1) replace default-argument closure captures with frozen dataclasses that group wrapper state, and (2) encapsulate the brittle `object.__setattr__` monkeypatching into a single helper, paving the way for a future wrapper-class replacement.

## Architectural Context

**Module:** `orchestrator/src/utils/tool_wrappers.py` — three public functions (`inject_project_path`, `restrict_to_wp`, `log_tool_calls`) that sequentially wrap each tool's `ainvoke` method to add project-path injection, cross-WP guarding, and call logging.

**Current pattern — closure state via default arguments:**
Each wrapper function iterates over a list of tool objects and defines an inner `async def` whose default parameters capture per-tool state. For example, `_guarded_ainvoke` captures `_orig`, `_active_wp`, `_counter`, `_max_soft`, and `_tool_name` as defaults. This pattern is functional but doesn't scale: adding a parameter requires modifying the closure signature, updating all callers, and adjusting test assertions.

**Current pattern — `object.__setattr__` monkeypatching:**
Because LangChain tools extend Pydantic `BaseModel` (which validates `__setattr__`), the module uses `object.__setattr__(tool, "ainvoke", wrapper_fn)` to bypass Pydantic's setter. This call appears **9 times** across the three wrappers (3 for `ainvoke` assignment, 6 for sentinel attributes). The pattern is correct but brittle — any future Pydantic change to `__setattr__` resolution or slot handling could break it silently.

**Callers:** `orchestrator/src/nodes/__init__.py` imports all three functions and applies them in sequence (line 207–220). The public API signatures (`inject_project_path(tools, project_path)`, `restrict_to_wp(tools, wp_id)`, `log_tool_calls(tools, stage, wp_id, logger)`) do not change.

**Test suite:** `orchestrator/tests/test_tool_wrappers.py` — 125 tests, 2197 lines. Tests use `_SimpleTool` and `_GuardTool` plain-class stubs (not Pydantic models) for most tests, plus dedicated `TestPydanticModelCompatibility` tests that exercise the `object.__setattr__` path.

**Constraints:**
- Constraint 11 (cross-WP guard exempts read-only tools) and Constraint 12 (soft-fail before hard kill) govern `restrict_to_wp` behaviour — must not be altered.
- Python 3.11+ is the minimum runtime (dataclasses with `slots=True` are available).
- No new dependencies allowed (stdlib only).

## Approach / Architecture

### Part A — Dataclass Contexts for Closure State

Introduce three frozen dataclasses, one per wrapper, to group the per-tool closure state:

```python
@dataclass(frozen=True, slots=True)
class _InjectCtx:
    orig: Any              # original ainvoke callable
    project_path: str
    tool_name: str

@dataclass(frozen=True, slots=True)
class _GuardCtx:
    orig: Any
    active_wp: str
    counter: list[int]     # shared mutable strike counter (list[int] is hashable-irrelevant for frozen)
    max_soft: int
    tool_name: str

@dataclass(frozen=True, slots=True)
class _LogCtx:
    orig: Any
    tool_name: str
    stage: str
    wp_id: str
    logger: Any
```

Each closure then captures a single `_ctx` default parameter:

```python
async def _guarded_ainvoke(input, *args, _ctx=ctx, **kwargs):
    if isinstance(input, dict):
        ...
        if call_wp_id != _ctx.active_wp:
            _ctx.counter[0] += 1
            ...
```

**Note on frozen + mutable field:** `_GuardCtx.counter` is a `list[int]`, which is mutable despite the dataclass being frozen. This is intentional — the frozen constraint prevents accidental rebinding of `counter` to a new list, while the list interior remains mutable for strike counting. Add a `field(hash=False)` annotation to suppress the unhashable-type linter warning.

### Part B — Encapsulate `object.__setattr__` into `_patch_tool()`

Introduce a single private helper at module level:

```python
def _patch_tool(tool: Any, **attrs: Any) -> None:
    """Set attributes on a tool object, bypassing Pydantic's __setattr__."""
    for name, value in attrs.items():
        object.__setattr__(tool, name, value)
```

Replace all 9 occurrences of `object.__setattr__(tool, ...)` with calls to `_patch_tool()`. This:
- Reduces the brittleness surface to **one line** of `object.__setattr__`
- Makes the monkeypatch grep-able and auditable
- Creates a single insertion point for a future migration (e.g. switching to `model_config` allowlisting or a proper wrapper class when LangGraph supports it)

### Non-Goals (Explicit)

A full **wrapper class** (composition-based, replacing in-place mutation) was considered but deferred. LangGraph's `ToolNode` performs `isinstance(tool, BaseTool)` checks internally, and the Deep Agents SDK may do the same. A non-`BaseTool` wrapper would require either:
- Dynamically subclassing `BaseTool` per tool (fragile, unclear lifecycle)
- A `__class__` hack that tricks `isinstance` (worse than the current monkeypatch)

Until LangGraph provides middleware hooks or a `ToolWrapper` protocol, the `_patch_tool()` encapsulation is the pragmatic middle ground.

## Rationale

- **Dataclasses over NamedTuple:** Frozen dataclasses with `slots=True` provide type-safe attribute access, immutability (preventing accidental state mutation), and IDE autocompletion — without requiring positional construction like NamedTuple.
- **Per-wrapper dataclass over a shared one:** The three wrappers have different state shapes. A single union-type context with many optional fields would be confusing and lose type safety.
- **`_patch_tool` over a full wrapper class:** Pragmatic encapsulation that maintains the current in-place mutation semantics (which callers depend on) while isolating the brittle `object.__setattr__` to one function.
- **Frozen dataclass for `_GuardCtx` despite mutable `counter`:** The freeze prevents accidental replacement of `counter` (e.g. `_ctx.counter = [0]`), while the list's interior mutability is the intended mechanism for strike counting.

## Detailed Steps

1. **Add `from dataclasses import dataclass, field` import** to `tool_wrappers.py`.

2. **Define `_patch_tool()` helper** immediately after the `_READ_ONLY_TOOLS` constant (before the public functions). One function, one `object.__setattr__` call site.

3. **Define `_InjectCtx` dataclass** above `inject_project_path()`.

4. **Refactor `inject_project_path()`:**
   - Replace the `object.__setattr__(tool, "_orig_ainvoke", tool.ainvoke)` sentinel-set with `_patch_tool(tool, _orig_ainvoke=tool.ainvoke)`.
   - Create an `_InjectCtx` instance per tool in the loop.
   - Rewrite `_wrapped_ainvoke` to accept a single `_ctx: _InjectCtx = ctx` default parameter instead of `_orig`, `_proj`, `_tool_name`.
   - Replace the `object.__setattr__(tool, "ainvoke", ...)` with `_patch_tool(tool, ainvoke=_wrapped_ainvoke)`.
   - Update internal references from `_orig(...)` to `_ctx.orig(...)`, `_proj` to `_ctx.project_path`, `_tool_name` to `_ctx.tool_name`.

5. **Define `_GuardCtx` dataclass** above `restrict_to_wp()`.

6. **Refactor `restrict_to_wp()`:**
   - Replace sentinel `object.__setattr__` calls with `_patch_tool()`.
   - Create a `_GuardCtx` instance per tool.
   - Rewrite `_guarded_ainvoke` to use `_ctx: _GuardCtx = ctx`.
   - Update internal references accordingly.

7. **Define `_LogCtx` dataclass** above `log_tool_calls()`.

8. **Refactor `log_tool_calls()`:**
   - Replace sentinel `object.__setattr__` calls with `_patch_tool()`.
   - Create a `_LogCtx` instance per tool.
   - Rewrite `_logged_ainvoke` to use `_ctx: _LogCtx = ctx`.
   - Update internal references accordingly.

9. **Update the module docstring** to mention the dataclass pattern and `_patch_tool()` helper as the module's wrapping mechanism.

10. **Run the test suite** — all 125 existing tests must pass without modification (the refactor is internal; the public API is unchanged). If any tests inspect closure default arguments directly, update them.

11. **Run `ruff check`** on both source and test files.

## Dependencies

- None. All changes are internal to `orchestrator/src/utils/tool_wrappers.py`. The public API is unchanged.

## Required Components

- `orchestrator/src/utils/tool_wrappers.py` — primary refactor target
- `orchestrator/tests/test_tool_wrappers.py` — validation (no changes expected, but may need minor updates if tests inspect default arg names)

## Assumptions

- The 125 existing tests do not assert on closure default-argument names (e.g. inspecting `__defaults__` or `__kwdefaults__`). If they do, those assertions will need updating.
- `dataclass(frozen=True, slots=True)` is available (Python 3.11+ guaranteed by `orchestrator/pyproject.toml`).
- `_patch_tool` does not need to handle non-Pydantic tools differently — `object.__setattr__` works on all Python objects.

## Constraints

- Public API signatures of `inject_project_path`, `restrict_to_wp`, and `log_tool_calls` must not change.
- Constraint 11 (read-only tool exemption) and Constraint 12 (soft-fail before hard kill) behaviour must be preserved.
- No new external dependencies.
- `_make_tool_response()` helper (added in the ToolMessage fix) is untouched — it already uses function parameters, not closure state.

## Out of Scope

- Full wrapper-class replacement for `object.__setattr__` monkeypatching (blocked by LangGraph `isinstance` checks; documented as future migration path).
- Refactoring the test file's E501 line-length violations (pre-existing, separate concern).
- Changing the wrapping application order in `orchestrator/src/nodes/__init__.py`.

## Acceptance Criteria

- All three inner closures (`_wrapped_ainvoke`, `_guarded_ainvoke`, `_logged_ainvoke`) accept a single `_ctx` default parameter of their respective dataclass type, replacing multi-parameter default captures.
- All 9 `object.__setattr__` calls are replaced with `_patch_tool()` calls.
- `_patch_tool()` is the only function in the module that calls `object.__setattr__`.
- All 125 existing tests pass without modification (or with minimal assertion updates if tests inspect default args).
- `ruff check` reports no new violations.
- Module docstring and design notes are updated to describe the dataclass pattern.

## Testing Strategy

**Primary:** Run the full existing test suite (`python3 -m pytest tests/test_tool_wrappers.py -v`). The 125 tests exercise all wrapper behaviours including idempotency, Pydantic model compatibility, ToolCall structure handling, strike counting, and sentinel management. Since the refactor is purely internal, all tests should pass unchanged.

**Secondary:** Run `ruff check src/utils/tool_wrappers.py` to verify no new lint violations.

**No new tests required** — the refactoring does not add, remove, or alter any observable behaviour. The dataclasses are private implementation details. `_patch_tool()` is exercised transitively by every existing test that triggers `object.__setattr__`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Frozen dataclass with mutable `list[int]` field causes linter/type-checker warnings** | Use `field(hash=False)` annotation on `_GuardCtx.counter`; suppress with `# type: ignore[frozen-dataclass]` if needed. |
| **Tests inspect closure `__kwdefaults__` or default arg names** | Unlikely (tests use behavioural assertions), but a quick grep before implementation will confirm. If found, update the specific assertions. |
| **`_patch_tool()` hides the `object.__setattr__` call, making debugging harder** | The function is 3 lines with a clear docstring. `grep _patch_tool` finds all call sites instantly. |
| **Future Pydantic version changes `__setattr__` resolution** | Centralised in `_patch_tool()` — a single fix point instead of 9 scattered call sites. |
