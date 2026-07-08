# Research Report: macOS Path Middleware Gap

## Problem Statement

Orchestrator runs on macOS fail or waste significant time because the
`PathNormalizationMiddleware` — originally designed to rewrite Windows
drive-letter paths — is explicitly inactive on POSIX systems. Agents receive
absolute host paths in their system prompts (e.g. `project_path`,
`plan_path`), then pass those absolute paths to Deep Agents file tools (`ls`,
`read_file`, `write_file`). On macOS, `validate_path()` accepts these paths
(only Windows drive-letter paths are rejected), and `_resolve_path()` in
`virtual_mode=True` treats them as relative paths under the project root,
creating ghost directory structures that mirror the host filesystem.

Evidence: the `2026-06-10-improved-dialogue-render` run on 2026-07-06 burned
16 consecutive PM retries (2h 33m) before succeeding. The agent repeatedly
called `ls` with the full macOS path
`/Users/smordziol/.../2026-06-10-improved-dialogue-render`, which
`_resolve_path` silently treated as
`cwd/Users/smordziol/.../2026-06-10-improved-dialogue-render`. The `write_file`
tool then created nested directories mirroring the host path inside the
project root.

## Problem Decomposition

1. **Why does `PathNormalizationMiddleware` ignore POSIX absolute paths?**
2. **Why does `validate_path()` accept macOS absolute paths?**
3. **What is the observable failure mode on macOS?**
4. **How should the middleware be extended for POSIX?**
5. **Can the fix be validated with tests?**

## Context & Constraints

- Orchestrator constraint §26 mandates `PathNormalizationMiddleware` on all
  Deep Agents instantiations.
- The middleware was designed during the Windows path fix (plan
  `2026-07-04-windows-path-resolution`). Its docstring explicitly states:
  > On macOS / Linux `root_dir` never starts with `[a-zA-Z]:` so the
  > middleware is an inert no-op.
- Deep Agents v0.5.2 `validate_path()` only rejects `^[a-zA-Z]:` patterns.
  POSIX absolute paths (`/Users/...`) pass through as valid virtual paths.
- `LocalShellBackend(virtual_mode=True)` uses `_resolve_path()` which
  strips the leading `/` and joins to `cwd`, so `/Users/foo` becomes
  `cwd/Users/foo`.
- Cross-platform support (Windows, macOS, Linux) is a hard constraint.
- The existing Windows path rewriting logic is correct and must not regress.

## Prior Art & Known Patterns

### Pattern 1: Current Windows-Only Middleware

- **Description:** `PathNormalizationMiddleware` intercepts every tool call.
  When `root_dir` starts with a Windows drive letter (`^[a-zA-Z]:`), the
  middleware is active: it rewrites matching drive-letter paths in tool call
  arguments to virtual `/`-rooted paths. On POSIX, `_active` is `False` and
  every call is a zero-cost pass-through.
- **Where used:** `orchestrator/src/utils/path_middleware.py`, tested in
  `orchestrator/tests/test_path_middleware.py`.
- **Strengths:** Clean design, zero overhead on POSIX, well-tested for
  Windows scenarios.
- **Weaknesses:** Completely ignores the identical problem on POSIX — agents
  still pass absolute host paths, which are silently mishandled by Deep
  Agents' virtual filesystem.
- **Fit:** Must be extended, not replaced.

### Pattern 2: Deep Agents `validate_path()` Enhancement

- **Description:** Modify `validate_path()` upstream in Deep Agents to detect
  and reject POSIX absolute paths that match the `root_dir` prefix, or
  automatically rewrite them to virtual paths.
- **Strengths:** Would fix the problem at the source for all consumers.
- **Weaknesses:** Requires an upstream library change. `validate_path()` has
  no access to `root_dir` — it's a stateless utility function. Would need
  API changes in Deep Agents.
- **Fit:** Not actionable in the short term. Worth filing as an upstream
  feature request.

### Pattern 3: Prompt Engineering — Avoid Absolute Paths

- **Description:** Rewrite `project-path-reminder.md` and system prompts to
  never expose absolute host paths, always using virtual `/`-rooted paths.
- **Strengths:** Would prevent agents from ever seeing absolute paths.
- **Weaknesses:** Cannot fully prevent — agents discover absolute paths from
  `ls` results, error messages, and file contents. MCP tools (`ledger_*`)
  still need the real absolute `project_path` to function. Both path forms
  must coexist.
- **Fit:** Complementary improvement but insufficient alone.

## Detailed Root Cause Analysis

### The Failure Chain (macOS)

```
1. cli.py builds initial_state with absolute project_path:
   project_path = "/Users/smordziol/.../DEV/ai-insights"
   target_project_path = "/Users/smordziol/.../DEV/ai-insights"

2. System prompt includes: "project path: /Users/.../slug"

3. Agent calls ls(path="/Users/.../slug")

4. validate_path("/Users/.../slug") → OK (not ^[a-zA-Z]:)
   Returns: "/Users/.../slug" (unchanged — already starts with /)

5. _resolve_path("/Users/.../slug") in virtual_mode:
   vpath = "/Users/.../slug" (already starts with /)
   full = (cwd / "Users/.../slug").resolve()
   → cwd/Users/.../slug  (nested path under project root)

6a. If cwd/Users/.../slug does NOT exist:
    → ls returns empty → agent is confused, retries

6b. If write_file creates files at cwd/Users/.../slug:
    → Ghost directories created, mirroring host path
    → Subsequent ls returns entries with _to_virtual_path():
      virtual = "/" + (cwd/Users/.../slug).relative_to(cwd)
             = "/Users/.../slug"  ← looks like an absolute path!
    → Agent uses these "virtual" paths for MCP tools
    → MCP tools interpret them as host paths → works accidentally

7. PathNormalizationMiddleware._active = False (POSIX root_dir)
   → Middleware does nothing, absolute paths pass through unchanged
```

### Why It Sometimes Works

The run eventually succeeded on the 17th PM attempt because the PM managed
to use the MCP tools (which accept absolute paths directly) without relying
on file tools. Later stages (developer, QA, reviewer, docs, synthesis) also
partially worked because:

- MCP ledger tools accepted absolute paths natively (server-side)
- Some file tool calls with absolute paths accidentally resolved to the
  correct files (the ghost directory structure duplicated real content)
- The developer used `execute` (shell commands) which bypass the virtual
  filesystem entirely

### Evidence from Chunk Files

**PM chunk (project-pm-r0.jsonl):**
- Lines 35-51: Agent calls `ls` with full absolute macOS path
- Line 55: `ls` returns entries with absolute-looking virtual paths
- All 16 PM retries failed with "Project ledger already exists" because the
  agent used the wrong paths for MCP initialization

**Developer chunk (WP-001-developer-r0.jsonl):**
- Line 133, 419: `read_file` errors for files at absolute host paths
- Lines 218-356: `ls` returns absolute-looking paths consistently
- Tests eventually passed via `execute` (shell commands, not sandboxed)

**Ghost directories created in DEV workspace:**
```
DEV/ai-insights/Users/smordziol/Webserver/Workspaces/ai-insights/DEV/
  ai-insights/docs/agents/plans/2026-06-10-improved-dialogue-render/
    work/WP-001.md
    work/WP-002.md
```

## Recommended Fix

### Extend `PathNormalizationMiddleware` for POSIX

The middleware's `_active` flag and rewriting logic must be extended to handle
POSIX absolute paths that match the `root_dir` prefix.

**Key changes to `orchestrator/src/utils/path_middleware.py`:**

1. Remove the Windows-only activation gate. The middleware should be active
   whenever `root_dir` is a non-empty absolute path (Windows or POSIX).
2. Generalize `_to_virtual` to handle POSIX paths: strip the `root_dir`
   prefix and prepend `/`.
3. Generalize `_rewrite_args` to detect absolute POSIX paths matching the
   root prefix, not just Windows drive-letter paths.

**Pseudocode:**

```python
class PathNormalizationMiddleware(AgentMiddleware):
    def __init__(self, root_dir: str) -> None:
        self._root = root_dir.replace("\\", "/")
        # Active when root_dir is any absolute path (Windows or POSIX)
        self._active = bool(
            _WIN_PATH_RE.match(root_dir)
            or (root_dir.startswith("/") and len(root_dir) > 1)
        )

    def _to_virtual(self, value: str) -> str:
        norm = value.replace("\\", "/")
        if norm.lower().startswith(self._root.lower()):
            stripped = norm[len(self._root):]
            if stripped.startswith("/"):
                stripped = stripped[1:]
            return "/" + stripped if stripped else "/"
        return value

    def _rewrite_args(self, args: dict) -> dict | None:
        if not self._active:
            return None
        changed = {}
        for key, val in args.items():
            if isinstance(val, str) and self._is_rewritable(val):
                rewritten = self._to_virtual(val)
                if rewritten != val:
                    changed[key] = rewritten
        return {**args, **changed} if changed else None

    def _is_rewritable(self, value: str) -> bool:
        """Check if a string looks like an absolute path matching root_dir."""
        norm = value.replace("\\", "/")
        if _WIN_PATH_RE.match(value):
            return True
        # POSIX absolute path matching root prefix
        if norm.startswith("/") and norm.lower().startswith(self._root.lower()):
            return True
        return False
```

**Note on case sensitivity:** macOS default filesystem (APFS) is
case-insensitive, so the existing case-insensitive comparison
(`lower().startswith(...)`) is correct. Linux is case-sensitive, so the
comparison should be exact on Linux. However, since the paths come from the
same system that produced `root_dir`, case will always match in practice.
Keeping case-insensitive is the safer default.

### Complementary Consideration

The `_is_rewritable` method must avoid false positives: not every string
starting with `/` is a path. The method should require the string to match
the `root_dir` prefix specifically, which naturally filters out non-path
strings like `/src/file.ts` (virtual paths that should pass through
unchanged).

## Comparative Evaluation

| Criterion          | Extend Middleware | Upstream validate_path | Prompt Engineering |
|--------------------|-------------------|------------------------|--------------------|
| **Complexity**     | Low               | Medium                 | Low                |
| **Performance**    | Negligible        | Negligible             | Zero               |
| **Maintainability**| Good              | Out of our control     | Fragile            |
| **Risk**           | Low (tested)      | Upstream dependency    | Incomplete fix     |
| **Time to impl.**  | Small             | Unpredictable          | Small              |
| **Completeness**   | Full fix          | Full fix               | Partial            |

## Recommendation

**Extend `PathNormalizationMiddleware`** to activate on POSIX absolute paths.
This is a contained change in a single file with an existing comprehensive
test suite. The fix is symmetric with the Windows implementation and follows
the same architectural pattern.

### Test Plan

Add the following test cases to `orchestrator/tests/test_path_middleware.py`:

1. **`_active` flag tests:**
   - Active for macOS root: `PathNormalizationMiddleware("/Users/dev/project")`
     → `_active is True`
   - Active for Linux root: `PathNormalizationMiddleware("/home/user/project")`
     → `_active is True`
   - Inactive for root-only `/`: `PathNormalizationMiddleware("/")` → behaviour
     TBD (may want to keep inactive to avoid rewriting all virtual paths)
   - Existing Windows tests still pass unchanged

2. **`_to_virtual` tests for POSIX:**
   - Basic macOS path rewrite:
     `_to_virtual("/Users/dev/project/src/file.ts")` → `"/src/file.ts"`
   - Root-dir-only path: `_to_virtual("/Users/dev/project")` → `"/"`
   - Path outside root unchanged:
     `_to_virtual("/other/path/file.ts")` → `"/other/path/file.ts"`
   - Case-insensitive match (macOS):
     `_to_virtual("/users/dev/project/file.ts")` → `"/file.ts"`

3. **`_rewrite_args` tests for POSIX:**
   - Matching macOS arg rewritten
   - Non-matching POSIX arg unchanged
   - Virtual path (`/src/file.ts`) passes through unchanged
   - Mixed args: only matching ones rewritten
   - Windows path with POSIX root returns unchanged

4. **`awrap_tool_call` integration tests:**
   - POSIX root rewrites macOS path in tool call
   - POSIX root passes through virtual paths unchanged
   - Handler result is returned correctly

5. **Regression tests:**
   - All existing Windows tests pass unchanged
   - Empty root still produces `_active = False`

### Proof-of-Concept Outline

1. Modify `PathNormalizationMiddleware.__init__` to set `_active = True` for
   POSIX absolute roots.
2. Modify `_rewrite_args` to detect POSIX absolute paths matching `_root`
   prefix (not just `_WIN_PATH_RE` matches).
3. Add test cases per the test plan above.
4. Run `cd orchestrator && python -m pytest tests/test_path_middleware.py -v`.
5. Verify no regression on existing Windows tests.

## Open Questions

- **Should case-insensitive matching be OS-dependent?** macOS APFS is
  case-insensitive by default; Linux ext4 is case-sensitive. The current
  approach (always case-insensitive) is safe but could produce false positive
  rewrites on Linux if two paths differ only by case. In practice this is
  extremely unlikely since `root_dir` and agent-supplied paths come from the
  same system.
- **Should `/` as root_dir activate the middleware?** If `root_dir="/"`, then
  every absolute path would be rewritten to a virtual path. This might be
  correct for containerized environments but could cause issues. Recommend
  keeping `_active = False` for root-only `/` paths (length <= 1).
- **Upstream Deep Agents enhancement:** Should `validate_path()` be enhanced
  to accept a `root_dir` parameter and perform stripping? This would be the
  ideal long-term fix but is outside our control. Consider filing an issue.
- **Ghost directory cleanup:** The failed run left ghost directories at
  `DEV/ai-insights/Users/smordziol/...`. These should be cleaned up manually
  and possibly detected by a preflight check.

## References

- `orchestrator/src/utils/path_middleware.py` — current middleware
  implementation
- `orchestrator/tests/test_path_middleware.py` — existing test suite
- `orchestrator/src/nodes/__init__.py` lines 850-910 — backend + middleware
  creation
- `deepagents/backends/utils.py:388` — `validate_path()` function
- `deepagents/backends/filesystem.py:135-194` — `_resolve_path()` and
  `_to_virtual_path()` methods
- `docs/agents/implementation-history/2026-07/2026-07-04-windows-path-resolution-research.md`
  — original Windows research
- `orchestrator/docs/agents/project-manifest/constraints.md` §26 —
  middleware constraint
- Failed run log:
  `storage/ledger/ai-insights/2026-06-10-improved-dialogue-render/orchestrator/logs/20260706T125743-*.jsonl`
- PM chunk file:
  `storage/ledger/ai-insights/2026-06-10-improved-dialogue-render/orchestrator/chunks/project-pm-r0.jsonl`
