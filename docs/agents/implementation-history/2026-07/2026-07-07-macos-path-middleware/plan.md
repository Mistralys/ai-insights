# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context

The repository has a completed project `2026-07-04-path-normalization-middleware` that introduced `PathNormalizationMiddleware` to solve Windows drive-letter path rejection in Deep Agents' `validate_path()`. That project explicitly scoped the middleware as a no-op on POSIX systems. The `2026-06-10-improved-dialogue-render` project was the first orchestrator run on macOS after the middleware shipped, and its PM stage burned 16 retries (2h 33m) due to the POSIX path gap this plan addresses.

Global insight #1 ("Input validation must be applied symmetrically to every branch") is directly relevant: the Windows branch is secured, but the POSIX branch is unguarded — the same asymmetric-validation anti-pattern.

## Summary

Extend `PathNormalizationMiddleware` to detect and rewrite POSIX absolute paths that match the `root_dir` prefix, making the middleware active on macOS and Linux — not just Windows. This eliminates the failure mode where agents pass absolute host paths (e.g. `/Users/smordziol/.../project/src/file.ts`) to Deep Agents file tools, which `_resolve_path()` silently treats as relative paths under the project root in virtual mode, creating ghost directory structures.

## Architectural Context

The middleware lives at `orchestrator/src/utils/path_middleware.py` and is tested at `orchestrator/tests/test_path_middleware.py`. It implements the `AgentMiddleware` interface from `langchain.agents.middleware.types` and is wired into every `create_deep_agent()` call in `orchestrator/src/nodes/__init__.py` (line ~877). Constraint §26 in the orchestrator project manifest mandates its presence on all Deep Agents instantiations.

The middleware's current architecture:
- `__init__`: Sets `_active = True` only when `root_dir` matches `^[a-zA-Z]:` (Windows drive letter).
- `_to_virtual`: Strips the `root_dir` prefix and prepends `/`. Currently only called for Windows paths.
- `_rewrite_args`: Scans string args for `_WIN_PATH_RE` matches and rewrites via `_to_virtual`. Returns `None` (fast path) when inactive.
- `awrap_tool_call`: Entry point — calls `_rewrite_args`, overrides the request if changes were made, delegates to handler.

The existing test suite has 25+ tests organized in 5 test classes: `TestToVirtual`, `TestRewriteArgs`, `TestActiveFlag`, `TestAwrapToolCall`, `TestAwrapToolCallWithRealRequest`.

## Approach / Architecture

Generalize the middleware from "Windows path rewriter" to "absolute host path rewriter" by:

1. **Broadening activation**: `_active = True` when `root_dir` is any non-trivial absolute path (Windows drive letter OR POSIX path with length > 1). The bare `/` root is excluded to prevent rewriting all virtual paths.
2. **Generalizing detection**: `_rewrite_args` checks both `_WIN_PATH_RE` match (existing) and POSIX-prefix match (new) when deciding if a string value should be rewritten.
3. **Reusing `_to_virtual`**: The existing rewrite logic (strip prefix, prepend `/`) is already OS-agnostic — it works for both Windows and POSIX paths. No changes needed to its core logic, only to its docstring.
4. **Updating documentation**: Module docstring, class docstring, method docstrings, constraint §26, and inline comments in `nodes/__init__.py` must all be updated to reflect the new cross-platform scope.

This approach keeps the middleware as a single class with a unified code path. No new classes, no feature flags, no conditional imports.

## Rationale

- **Single class, unified code path**: The rewrite logic (strip prefix, prepend `/`) is inherently OS-agnostic. Splitting into OS-specific subclasses would add complexity for no benefit.
- **Case-insensitive matching preserved**: macOS APFS is case-insensitive by default; the existing `lower().startswith(lower())` comparison is correct and safe. On case-sensitive Linux, paths from the same system will always match exactly, so case-insensitive comparison produces no false positives in practice.
- **`/` excluded from activation**: If `root_dir="/"`, every absolute path would be rewritten, breaking virtual paths. The `len(root_dir) > 1` guard prevents this.
- **Extends, not replaces**: All existing Windows behaviour is preserved unchanged. The POSIX extension uses the same rewrite logic and code path.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where to fix | Extend `PathNormalizationMiddleware` | (a) Upstream `validate_path()` enhancement in Deep Agents; (b) Prompt engineering to hide absolute paths | (a) requires upstream library changes with unpredictable timeline; (b) is fragile and incomplete — agents discover absolute paths from `ls` results, error messages, and file contents |
| Activation strategy | `_active` on any non-trivial absolute path | (a) OS detection via `sys.platform`; (b) Always active regardless of `root_dir` format | (a) couples to OS rather than path format, breaking containerized/WSL scenarios; (b) would process every tool call even when `root_dir=""`, adding unnecessary overhead |
| Case sensitivity | Always case-insensitive (existing behaviour) | OS-dependent: case-insensitive on macOS, case-sensitive on Linux | Adds complexity for a scenario (case-differing paths from the same system) that is extremely unlikely in practice; always-insensitive is the safer default |

## Pattern Alignment

- **Follows**: `orchestrator/src/utils/path_middleware.py` — extends the existing middleware pattern with the same rewrite logic, same `_active` guard strategy, same test structure.
- **Follows**: Orchestrator constraint §26 — middleware remains mandatory on all `create_deep_agent()` calls; the constraint's scope expands from "Windows fix" to "cross-platform fix".
- **Follows**: Cross-platform policy in root `AGENTS.md` — the fix makes the middleware genuinely cross-platform rather than Windows-only.
- **No departures**: All changes follow existing patterns.

## Detailed Steps

### Step 1: Generalize `_active` flag in `__init__`

In `orchestrator/src/utils/path_middleware.py`, modify `__init__` to activate the middleware for any non-trivial absolute path:

```python
def __init__(self, root_dir: str) -> None:
    self._root: str = root_dir.replace("\\", "/")
    # Active when root_dir is any absolute path (Windows drive letter or POSIX).
    # Bare "/" is excluded: it would rewrite every virtual path.
    self._active: bool = bool(
        _WIN_PATH_RE.match(root_dir)
        or (root_dir.startswith("/") and len(root_dir) > 1)
    )
```

### Step 2: Generalize `_rewrite_args` to detect POSIX paths

Modify `_rewrite_args` to check for POSIX absolute paths matching the `_root` prefix, not just `_WIN_PATH_RE` matches:

```python
def _rewrite_args(self, args: dict[str, Any]) -> dict[str, Any] | None:
    if not self._active:
        return None

    changed: dict[str, Any] = {}
    for key, val in args.items():
        if isinstance(val, str) and self._is_rewritable(val):
            rewritten = self._to_virtual(val)
            if rewritten != val:
                changed[key] = rewritten

    return {**args, **changed} if changed else None
```

Extract a new `_is_rewritable` method to encapsulate the detection logic:

```python
def _is_rewritable(self, value: str) -> bool:
    """Check if a string looks like an absolute host path matching root_dir."""
    if _WIN_PATH_RE.match(value):
        return True
    # POSIX absolute path matching the root prefix.
    norm = value.replace("\\", "/")
    return norm.startswith("/") and norm.lower().startswith(self._root.lower())
```

This ensures virtual paths like `/src/file.ts` are NOT rewritten (they don't match the `root_dir` prefix like `/Users/dev/project`), while host paths like `/Users/dev/project/src/file.ts` ARE rewritten.

### Step 3: Update `_to_virtual` docstring

The method body is already OS-agnostic. Update the docstring to remove the Windows-specific language:

- Remove "Convert a Windows path" → "Convert an absolute host path"
- Remove the `^[a-zA-Z]:` precondition note
- Describe that it works for both Windows and POSIX paths

### Step 4: Update module and class docstrings

Update the module-level docstring and `PathNormalizationMiddleware` class docstring:
- Remove statements like "On macOS / Linux `root_dir` never starts with `[a-zA-Z]:` so the middleware is an inert no-op"
- Replace with cross-platform description: the middleware is active for any non-trivial absolute path and rewrites host paths to virtual `/`-rooted equivalents
- Update the "Behaviour" section of the class docstring to describe both Windows and POSIX activation

### Step 5: Add POSIX test cases to test suite

Add the following test cases to `orchestrator/tests/test_path_middleware.py`:

**In `TestActiveFlag`:**
- `test_active_for_macos_root` — `PathNormalizationMiddleware("/Users/dev/project")` → `_active is True`
- `test_active_for_linux_root` — `PathNormalizationMiddleware("/home/user/project")` → `_active is True`
- `test_inactive_for_bare_slash` — `PathNormalizationMiddleware("/")` → `_active is False`
- Modify `test_inactive_for_posix_root` → remove or rename since POSIX roots are now active

**In `TestToVirtual`:**
- `test_basic_posix_path_rewrite` — `_to_virtual("/Users/dev/project/src/file.ts")` with root `/Users/dev/project` → `"/src/file.ts"`
- `test_posix_root_dir_only_rewrites_to_slash` — `_to_virtual("/Users/dev/project")` → `"/"`
- `test_posix_path_outside_root_unchanged` — `_to_virtual("/other/path/file.ts")` with root `/Users/dev/project` → unchanged
- `test_posix_case_insensitive_match` — `_to_virtual("/users/dev/project/file.ts")` → `"/file.ts"` (macOS APFS scenario)

**In `TestRewriteArgs`:**
- `test_posix_matching_arg_is_rewritten` — macOS path matching root is rewritten
- `test_posix_non_matching_arg_unchanged` — POSIX path NOT matching root returns `None`
- `test_posix_virtual_path_passes_through` — `/src/file.ts` is not rewritten when root is `/Users/dev/project`
- `test_posix_mixed_args` — only matching POSIX args rewritten
- `test_windows_path_with_posix_root_unchanged` — Windows path is not rewritten when middleware has a POSIX root (no `_WIN_PATH_RE` match for the Windows path since it doesn't match the POSIX root prefix)
- Remove or update `test_inactive_on_posix_root_returns_none` since the middleware is now active on POSIX

**In `TestAwrapToolCall`:**
- `test_awrap_tool_call_rewrites_posix_path` — full flow test: POSIX root rewrites matching macOS path
- `test_awrap_tool_call_posix_virtual_path_passes_through` — virtual path `/src/file.ts` passes through unchanged with POSIX root
- Update `test_awrap_tool_call_inactive_on_posix_root` — the middleware is now active, so this test must change to verify rewriting occurs (or be removed and replaced by the new test above)

**In `TestAwrapToolCallWithRealRequest`:**
- `test_real_request_rewrites_posix_path` — full flow with real `ToolCallRequest` dataclass and POSIX root

### Step 6: Update inline comment in `nodes/__init__.py`

Update the comment block at `orchestrator/src/nodes/__init__.py` (lines ~871-876) to remove the macOS/Linux no-op language:

```python
# PathNormalizationMiddleware rewrites absolute host paths
# (e.g. F:\Webserver\src\file.ts or /Users/dev/project/src/file.ts)
# to virtual /-rooted paths (/src/file.ts) before validate_path()
# runs inside Deep Agents. This is complementary to virtual_mode=True:
# virtual mode resolves /-rooted paths; the middleware ensures they
# reach validation clean.
# See docs/agents/project-manifest/constraints.md §26.
```

### Step 7: Update constraint §26 in project manifest

Update `orchestrator/docs/agents/project-manifest/constraints.md` (lines 597-640):
- Remove "The middleware is a zero-cost no-op on macOS/Linux" from the Rationale
- Replace with description of cross-platform activation
- Update the "Correct pattern" comment from "no-op on macOS/Linux" to "active on all platforms"

### Step 8: Run tests and verify

Run the full path middleware test suite and the full orchestrator test suite to verify:
1. All new POSIX tests pass
2. All existing Windows tests pass (no regression)
3. No other orchestrator tests are affected

## Dependencies

- No external dependencies. All changes are within the orchestrator sub-project.
- Deep Agents library is unchanged — this plan works around its `validate_path()` limitation.

## Required Components

- `orchestrator/src/utils/path_middleware.py` — main implementation (modify)
- `orchestrator/tests/test_path_middleware.py` — test suite (modify)
- `orchestrator/src/nodes/__init__.py` — inline comment update (modify)
- `orchestrator/docs/agents/project-manifest/constraints.md` — constraint §26 update (modify)

## Assumptions

- The `AgentMiddleware` interface and `awrap_tool_call` signature in `langchain.agents.middleware.types` remain unchanged.
- Deep Agents' `validate_path()` continues to accept POSIX absolute paths (does not add new rejection logic that would interfere with the middleware's output).
- `root_dir` passed to the middleware always matches the `root_dir` passed to `LocalShellBackend`.
- Agents will continue to receive absolute host paths in system prompts (via `project_path` variables), making the middleware's rewriting necessary.

## Constraints

- All existing Windows test cases must continue to pass unchanged.
- The middleware must remain a zero-cost pass-through when `root_dir` is empty.
- Case-insensitive matching is maintained for all platforms.
- Cross-platform compatibility (Windows, macOS, Linux) per workspace policy.

## Out of Scope

- Upstream enhancement to Deep Agents' `validate_path()` — worth filing as a feature request but not actionable in this plan.
- Prompt engineering changes to hide absolute paths from agents — complementary improvement but insufficient alone and addressed separately.
- Cleanup of ghost directories created by prior failed runs — manual cleanup, not automated.
- Adding OS-dependent case sensitivity logic — the research paper identified this as an open question; this plan keeps the existing always-case-insensitive approach as the safer default.
- Making `root_dir="/"` activate the middleware — explicitly excluded to avoid rewriting all virtual paths.

## Acceptance Criteria

- AC-01: `PathNormalizationMiddleware("/Users/dev/project")._active` is `True`.
- AC-02: `PathNormalizationMiddleware("/home/user/project")._active` is `True`.
- AC-03: `PathNormalizationMiddleware("/")._active` is `False`.
- AC-04: `PathNormalizationMiddleware("")._active` is `False` (existing behaviour preserved).
- AC-05: `_to_virtual("/Users/dev/project/src/file.ts")` returns `"/src/file.ts"` when `root_dir="/Users/dev/project"`.
- AC-06: `_to_virtual("/Users/dev/project")` returns `"/"` when `root_dir="/Users/dev/project"`.
- AC-07: `_to_virtual("/other/path/file.ts")` returns unchanged when `root_dir="/Users/dev/project"`.
- AC-08: `_rewrite_args({"path": "/Users/dev/project/src/file.ts"})` returns a rewritten dict when `root_dir="/Users/dev/project"`.
- AC-09: `_rewrite_args({"path": "/src/file.ts"})` returns `None` (virtual path, no `root_dir` prefix match) when `root_dir="/Users/dev/project"`.
- AC-10: `awrap_tool_call` rewrites a matching POSIX path and delegates to the handler.
- AC-11: All existing Windows path rewriting tests pass without modification (no regression).
- AC-12: Module docstring, class docstring, and method docstrings reflect cross-platform scope.
- AC-13: Constraint §26 in `orchestrator/docs/agents/project-manifest/constraints.md` reflects cross-platform scope.
- AC-14: Inline comment in `orchestrator/src/nodes/__init__.py` reflects cross-platform scope.

## Testing Strategy

Extend the existing test suite with symmetric POSIX test cases mirroring the Windows tests. Every test class that has Windows-specific tests gets corresponding POSIX equivalents. The existing Windows tests are preserved unchanged to guarantee regression-free behaviour.

## Test Plan

- `TestActiveFlag::test_active_for_macos_root` — POSIX macOS root activates middleware — AC-01
- `TestActiveFlag::test_active_for_linux_root` — POSIX Linux root activates middleware — AC-02
- `TestActiveFlag::test_inactive_for_bare_slash` — Bare `/` does not activate — AC-03
- `TestActiveFlag::test_inactive_for_empty_root` (existing) — Empty string does not activate — AC-04
- `TestToVirtual::test_basic_posix_path_rewrite` — macOS path rewritten to virtual — AC-05
- `TestToVirtual::test_posix_root_dir_only_rewrites_to_slash` — Root-only rewrites to `/` — AC-06
- `TestToVirtual::test_posix_path_outside_root_unchanged` — Non-matching path unchanged — AC-07
- `TestToVirtual::test_posix_case_insensitive_match` — Case-insensitive match works — AC-05
- `TestRewriteArgs::test_posix_matching_arg_is_rewritten` — Matching POSIX arg rewritten — AC-08
- `TestRewriteArgs::test_posix_virtual_path_passes_through` — Virtual path not rewritten — AC-09
- `TestRewriteArgs::test_posix_non_matching_arg_unchanged` — Non-matching POSIX arg unchanged — AC-07
- `TestRewriteArgs::test_posix_mixed_args` — Only matching args rewritten — AC-08, AC-09
- `TestRewriteArgs::test_windows_path_with_posix_root_unchanged` — Windows path not rewritten with POSIX root — AC-11
- `TestAwrapToolCall::test_awrap_tool_call_rewrites_posix_path` — Full flow POSIX rewrite — AC-10
- `TestAwrapToolCall::test_awrap_tool_call_posix_virtual_path_passes_through` — Virtual path passes through — AC-09
- `TestAwrapToolCallWithRealRequest::test_real_request_rewrites_posix_path` — Real dataclass POSIX rewrite — AC-10
- All existing `TestToVirtual`, `TestRewriteArgs`, `TestActiveFlag`, `TestAwrapToolCall`, `TestAwrapToolCallWithRealRequest` tests — Windows regression — AC-11

## Documentation Updates

- `orchestrator/src/utils/path_middleware.py` — Module docstring, class docstring, `_to_virtual` docstring, `_rewrite_args` docstring — AC-12
- `orchestrator/src/nodes/__init__.py` — Inline comment block at lines ~871-876 — AC-14
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint §26 text — AC-13

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **False positive rewrites on POSIX** — a non-path string starting with `/` could accidentally match `root_dir` | The `_is_rewritable` method requires the string to match the full `root_dir` prefix (e.g. `/Users/dev/project`), not just start with `/`. Short strings like `/src/file.ts` will not match a long `root_dir` prefix. |
| **Regression in Windows behaviour** | All existing Windows tests are preserved unchanged. The `_is_rewritable` method checks `_WIN_PATH_RE` first, maintaining the identical code path for Windows. |
| **`_active` flag edge case with root-only `/`** | Explicitly excluded by the `len(root_dir) > 1` guard. Tested with `test_inactive_for_bare_slash`. |
| **Case sensitivity mismatch on Linux** | Kept case-insensitive for safety. In practice, `root_dir` and agent paths come from the same system so case always matches. The risk of a false positive (two different paths differing only by case on Linux) is negligible. |
