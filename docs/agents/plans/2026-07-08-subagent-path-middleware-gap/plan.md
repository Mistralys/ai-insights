# Plan

## Plan Audit Cycles
- Audits: 6 — Plan Auditor v1.5.0
- Architectural Reviews: 2 — Plan Architect Reviewer v2.0.0

## Prior Project Context
Three recent projects are directly relevant:

- **`2026-07-04-path-normalization-middleware`** — Introduced `PathNormalizationMiddleware` for Windows drive-letter paths. Established the middleware pattern and constraint §26.
- **`2026-07-07-macos-path-middleware`** — Extended the middleware to activate on POSIX absolute paths (macOS/Linux). This fix made the middleware universally active but did not address the subagent propagation gap.
- **`2026-07-07-deep-agent-integration-tests`** — Built the integration test suite for the orchestrator's Deep Agent execution path. The `ToolCallableFakeChatModel` and mock tool infrastructure from this project will be referenced for test patterns.

The strategic vision prioritises reducing friction ("as easy as possible to set up and use"). Fixing silent path doubling in orchestrator runs directly supports this: users currently encounter ghost directories and infinite retry loops with no indication of what went wrong.

## Summary
Fix four related issues observed during orchestrator runs using Deep Agents subagents. The primary issue is that `PathNormalizationMiddleware` is not propagated to subagent middleware stacks, causing subagent file operations to create doubled host paths. A secondary issue is that the PM's plan-folder rename directive breaks orchestrator state mid-run, causing cascading failures. Issues 3 ("unknown" repo name) and 4 (cross-workspace ledger mismatch) are downstream consequences of Issue 2 and do not require separate fixes.

## Architectural Context
The orchestrator (`orchestrator/src/`) uses Deep Agents to run LLM agent stages. Each stage creates a `LocalShellBackend(virtual_mode=True)` and a `PathNormalizationMiddleware` instance, then passes both to `create_deep_agent()`. The middleware is passed via the `middleware` parameter, which Deep Agents appends to the main agent's middleware stack. However, subagents receive their own middleware stack built from a base set plus any middleware from `spec.get("middleware", [])`. The orchestrator's `load_subagents()` (in `src/utils/subagents.py`) returns spec dicts with only `name`, `description`, and `system_prompt` keys — no `middleware` key. Therefore subagents never receive the path middleware.

The CLI entry point (`src/cli.py`) resolves `plan_dir` and `project_path` at run start and uses them to initialize all downstream state: lock file, sidecar metadata, JSONL logger filename, and the `project_path` injected into MCP tool calls. If the PM renames the plan folder mid-run, all of this state becomes stale.

**Key files:**
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` factory, line ~870–910
- `orchestrator/src/utils/subagents.py` — `load_subagents()` function
- `orchestrator/src/utils/path_middleware.py` — `PathNormalizationMiddleware` class
- `orchestrator/src/cli.py` — `_run()` entry point, `_infer_project_root()`
- `orchestrator/tests/test_path_middleware.py` — Existing middleware unit tests
- `orchestrator/tests/test_nodes.py` — Existing node factory tests (incl. middleware wiring test)
- `orchestrator/tests/test_cli.py` — Existing CLI tests
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint §26

## Approach / Architecture
Two independent fixes applied to the orchestrator sub-project:

**Fix 1: Propagate middleware to subagent specs** — In `src/nodes/__init__.py`, after the `load_subagents()` call and before `create_deep_agent()`, inject the `path_middleware` instance into each subagent spec's `middleware` list. Deep Agents' `create_deep_agent()` already processes `spec.get("middleware", [])` and appends it to each subagent's middleware stack — the orchestrator just needs to populate that key. This is a 5-line change.

**Fix 2: Pre-run plan folder rename** — In `src/cli.py`, add a `_maybe_rename_plan_dir()` function that detects an outdated date prefix in the plan folder slug and renames the folder **before** lock acquisition, state initialization, and logger setup. This pre-empts the PM's rename directive entirely: if the folder already has today's date, the PM has nothing to rename. All downstream state is initialized with the correct path. Skip rename on `--resume` to avoid breaking checkpoint path consistency.

Issues 3 and 4 are downstream of Issue 2: once the plan folder is renamed before state initialization, the `project_path` will be correct from the start, `_derive_slug_dir()` will compute the correct repo name, and MCP tool calls will target the correct storage location.

## Rationale
- **Fix 1** is the minimal, correct solution to the root cause. It requires no upstream Deep Agents changes, no subagent loader interface changes, and no prompt engineering. It follows the existing pattern where the `middleware` parameter is passed to `create_deep_agent()`.
- **Fix 2** eliminates an entire class of mid-run state staleness by moving the rename to the orchestrator's control, before any state is created. This is simpler and more reliable than: (a) detecting the rename post-facto and refreshing state, (b) prohibiting the rename in persona instructions, or (c) adding a cross-boundary rename protocol between PM and orchestrator.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Middleware propagation location | Inject in `__init__.py` after `load_subagents()` | (A) Modify `load_subagents()` to accept and attach middleware; (B) Upstream Deep Agents change to auto-propagate parent middleware | `__init__.py` injection is simpler (no loader interface change), local to the wiring site, and doesn't depend on upstream releases. |
| Plan folder rename timing | Pre-run in `cli.py` before lock/state init | (A) Post-PM state refresh mid-run; (B) Remove rename from PM persona; (C) PM reports rename via tool call | Pre-run avoids all state staleness; PM persona remains correct for IDE workflows; no cross-boundary protocol needed. |
| `general_purpose` subagent middleware | Deferred — not addressed in this plan | Include `general_purpose` subagent middleware override | The `general_purpose` subagent is auto-created by Deep Agents and does not accept per-instance middleware via the spec mechanism. Addressing it requires upstream API changes. Risk is low: the general-purpose subagent is rarely used for file operations. |

## Pattern Alignment
- **Constraint §26** (`orchestrator/docs/agents/project-manifest/constraints.md`): This plan extends its scope to include subagent middleware stacks, which the constraint currently covers only for the main agent. The constraint text will be updated.
- **Test patterns** (`orchestrator/tests/test_path_middleware.py`, `test_nodes.py`): New tests follow the same structure — pure unit tests with mocks, no LLM or MCP server required.
- **CLI pre-processing pattern** (`orchestrator/src/cli.py`): The rename function follows the same pattern as `_infer_project_root()` — a pure function called early in `_run()` before any side effects.
- **Changelog convention** (root `AGENTS.md`): Module changelog only; root changelog is not updated for this plan.

## Detailed Steps

### Step 1: Propagate `PathNormalizationMiddleware` to subagent specs

In `orchestrator/src/nodes/__init__.py`, immediately after the `stage_subagents = load_subagents(...)` call (~line 897) and before the `create_deep_agent()` call:

```python
# Propagate PathNormalizationMiddleware to subagents so they
# receive the same host-path → virtual-path rewriting as the
# main agent.  Without this, subagent file operations with
# absolute host paths create doubled directory structures under
# the virtual_mode root.
if stage_subagents:
    for sub_spec in stage_subagents:
        sub_spec.setdefault("middleware", []).append(path_middleware)
```

This works because Deep Agents' `create_deep_agent()` in `graph.py` line 231 does `subagent_middleware.extend(spec.get("middleware", []))`, appending user-supplied middleware after the base stack.

### Step 2: Add `_maybe_rename_plan_dir()` to `cli.py`

First, add `import re` to the stdlib imports section of `orchestrator/src/cli.py` and add `date` to the existing `from datetime import UTC, datetime` line (making it `from datetime import UTC, date, datetime`). Neither `re` nor `date` is currently imported in the file.

Then add a new function in `orchestrator/src/cli.py` (near the existing `_infer_project_root()` helper, around line 185):

```python
_SLUG_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)$")

def _maybe_rename_plan_dir(plan_dir: Path) -> Path:
    """Rename plan folder to today's date if the slug has an outdated
    date prefix.  Returns the (possibly renamed) plan_dir.

    Must be called before lock acquisition and state initialization so
    all downstream paths (lock, sidecar, log filename, state) are
    consistent.

    Skipped when the date prefix matches today or the folder name has no
    YYYY-MM-DD prefix.  A collision guard prevents overwriting an existing
    target folder.
    """
    m = _SLUG_DATE_RE.match(plan_dir.name)
    if not m:
        return plan_dir
    slug_date_str, suffix = m.groups()
    today_str = date.today().isoformat()
    if slug_date_str == today_str:
        return plan_dir
    new_name = f"{today_str}-{suffix}"
    new_dir = plan_dir.parent / new_name
    if new_dir.exists():
        log.warning(
            "Target folder %s already exists; skipping rename.", new_dir
        )
        return plan_dir
    try:
        plan_dir.rename(new_dir)
    except OSError:
        log.warning(
            "Could not rename plan folder to %s; using original path.", new_dir
        )
        return plan_dir
    log.info("Renamed plan folder: %s → %s", plan_dir.name, new_name)
    return new_dir
```

### Step 3: Wire `_maybe_rename_plan_dir()` into the `_run()` flow

In `orchestrator/src/cli.py`, after the `plan_dir` / `plan_file` assignment (~line 722) and before lock acquisition (~line 738), add:

```python
# Rename plan folder to today's date if slug date is outdated.
# Must happen before lock acquisition and state initialization so
# all downstream paths are consistent.
# Skip on --resume to avoid breaking checkpoint path consistency.
if not args.resume:
    plan_dir = _maybe_rename_plan_dir(plan_dir)
    plan_path = plan_dir / plan_file  # Update plan_path to match
    # NOTE: do NOT recompute _plan_hash or _run_status_path here.
    # TypeScript's startOrchestrator() calls runStatusFilename(resolvedPlan)
    # before spawning the process and the GUI polls that exact filename.
    # The hash must remain stable for the lifetime of the run so the GUI
    # can resolve the tombstone file written at run end.
```

Do **not** recompute `_plan_hash` or `_run_status_path` inside the rename block. TypeScript's `runStatusFilename(resolvedPlan)` is computed **before** spawning the orchestrator process and is returned to the GUI client. If `_plan_hash` were recomputed from the renamed path, the orchestrator would write the run-status tombstone under a different filename than TypeScript computed, breaking GUI run-status polling for all GUI-launched runs where a rename occurs. The original `_plan_hash` / `_run_status_path` assignment earlier in `_run()` (which precedes `plan_dir` resolution) must remain in place for the plan-not-found early-exit path — and must be the only computation of these values.

### Step 4: Add unit tests for subagent middleware propagation

In `orchestrator/tests/test_nodes.py`, add a new test class after the existing `PathNormalizationMiddleware` wiring tests (~line 1928):

```python
class TestSubagentMiddlewarePropagation:
    """Verify that subagent specs receive PathNormalizationMiddleware."""

    def test_subagent_specs_receive_path_middleware(self):
        """After middleware injection, each subagent spec has a 'middleware'
        list containing the PathNormalizationMiddleware instance."""
        # ... (mock load_subagents to return sample specs, verify injection)

    def test_empty_subagent_list_no_error(self):
        """When load_subagents returns [], no injection occurs and
        create_deep_agent receives subagents=None."""

    def test_existing_middleware_key_preserved(self):
        """If a subagent spec already has a 'middleware' key, the
        PathNormalizationMiddleware is appended, not replaced."""
```

### Step 4b: Add `TestRunFlow` test class for `_plan_hash` stability

In `orchestrator/tests/test_cli.py`, add a new `TestRunFlow` class (this class does not yet exist in the file). The test mocks `_run()` internals to verify that `_plan_hash` is computed once from the pre-rename path and never recomputed:

```python
class TestRunFlow:
    """Integration-style tests for the _run() entry-point flow."""

    def test_plan_hash_stable_after_rename(self, tmp_path, monkeypatch):
        """_plan_hash must not be recomputed after _maybe_rename_plan_dir().

        Strategy (observable side-effect approach — no private local access):
        1. Create a plan folder with an outdated date prefix under tmp_path
           (e.g. `2020-01-01-my-feature/plan.md`).
        2. Compute `old_hash = hashlib.sha1(str(old_plan_path).encode()).hexdigest()[:16]`
           and `new_hash` for the would-be renamed path, to confirm they differ.
        3. Run `_run()` with monkeypatch stubs for lock acquisition, graph
           execution, subprocess calls, and any other irrelevant side effects.
        4. Assert that `(logs_dir / f"{old_hash}-run-status.json").exists()` —
           the tombstone was written under the pre-rename hash.
        5. Assert that `not (logs_dir / f"{new_hash}-run-status.json").exists()` —
           the post-rename hash was never used for the tombstone.

        The `_run_status_path` write is a directly observable side effect that
        confirms `_plan_hash` was never recomputed from the renamed path, without
        requiring access to private locals.
        """
```

### Step 5: Add unit tests for `_maybe_rename_plan_dir()`

In `orchestrator/tests/test_cli.py`, add a new test class:

```python
class TestMaybeRenamePlanDir:
    """Unit tests for _maybe_rename_plan_dir()."""

    def test_outdated_date_renames_to_today(self, tmp_path):
        """Folder with old date prefix is renamed to today's date."""

    def test_current_date_no_rename(self, tmp_path):
        """Folder already at today's date is not renamed."""

    def test_no_date_prefix_no_rename(self, tmp_path):
        """Folder without YYYY-MM-DD prefix is not renamed."""

    def test_collision_skips_rename(self, tmp_path):
        """If target folder already exists, original is returned unchanged."""

    def test_non_iso_date_prefix_no_rename(self, tmp_path):
        """A prefix that isn't a valid YYYY-MM-DD is not matched."""

    def test_renamed_dir_returned(self, tmp_path):
        """Return value is the new Path after rename."""

    def test_oserror_returns_original_dir(self, tmp_path, caplog):
        """When Path.rename() raises OSError, the original plan_dir is
        returned unchanged and a warning is logged."""
        # Mock Path.rename to raise OSError, then assert the return value
        # equals the original plan_dir and that caplog contains a warning
        # message referencing the target folder.
```

### Step 6: Update Constraint §26

In `orchestrator/docs/agents/project-manifest/constraints.md`, update constraint §26 to explicitly cover subagent middleware propagation. Add a note after the existing correct/anti-pattern examples:

> **Subagent propagation:** When a stage has subagents (loaded via `load_subagents()`), the `PathNormalizationMiddleware` instance must be injected into each subagent spec's `middleware` list before passing the specs to `create_deep_agent()`. Without this, subagent file operations with absolute host paths create doubled directory structures under the `virtual_mode` root.

### Step 7: Add a new constraint for pre-run plan folder rename

Add a new constraint (§27) documenting the pre-run rename behaviour:

> ### N. Pre-Run Plan Folder Date Prefix Normalisation
>
> **Rule:** On fresh runs (not `--resume`), `_maybe_rename_plan_dir()` must be called after `plan_dir` is resolved but before lock acquisition, state initialization, logger setup, and `_plan_hash` computation. The function renames the plan folder to use today's date prefix if the current prefix is outdated.
>
> **Rationale:** The PM persona has a directive to rename plan folders to the current date. If this happens mid-run, all previously-initialized state (lock file path, `.orchestrator-run.json` sidecar, JSONL log filename, `state["project_path"]`, `inject_project_path` closures) becomes stale. Moving the rename to pre-run eliminates the entire class of mid-run state corruption. When the PM sees the folder already has today's date, it skips the rename directive.

### Step 8: Update orchestrator API surface docs

In `orchestrator/docs/agents/project-manifest/api-surface.md`, add `_maybe_rename_plan_dir` to the CLI utility functions table:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `_maybe_rename_plan_dir` | `(plan_dir: Path) -> Path` | Renames plan folder to today's date if slug date prefix is outdated. Called before lock acquisition. |

### Step 9: Update orchestrator file tree docs

No new files are created — only existing files are modified — so `orchestrator/docs/agents/project-manifest/file-tree.md` requires no change.

### Step 10: Pin Deep Agents upper version bound

In `orchestrator/requirements.txt`, change the `deepagents` constraint from `deepagents>=0.3` to:

```text
deepagents>=0.3,<1  # Upper bound: subagent middleware relies on spec.get("middleware", []) in graph.py; review on major-version bump.
```

In `orchestrator/pyproject.toml`, update the same specifier from `"deepagents>=0.3"` to `"deepagents>=0.3,<1"`. Do **not** add a trailing comment in `pyproject.toml` — inline `#` comments are not valid PEP 508 syntax. The explanatory comment belongs in `requirements.txt` only.

This converts the named risk of silent API breakage on a major-version bump into an explicit guardrail for both install paths (`pip install -r requirements.txt` and `pip install .` / `pip install -e .`). Minor and patch upgrades remain unrestricted; a `1.0` release requires a deliberate upgrade decision.

### Step 11: Update orchestrator changelog

Add entries to `orchestrator/changelog.md` for all three changes (subagent middleware propagation, pre-run plan folder rename, Deep Agents version constraint).

## Dependencies
- No external dependencies are added.
- No upstream Deep Agents changes are required.
- Fix 1 depends on the existing `PathNormalizationMiddleware` class (already in codebase).
- Fix 2 depends on Python's `datetime.date` and `re` modules (stdlib).

## Required Components
- `orchestrator/src/nodes/__init__.py` — Modify to inject middleware into subagent specs (Fix 1)
- `orchestrator/src/cli.py` — Add `_maybe_rename_plan_dir()` and wire into `_run()` (Fix 2)
- `orchestrator/tests/test_nodes.py` — Add subagent middleware propagation tests
- `orchestrator/tests/test_cli.py` — Add plan folder rename tests
- `orchestrator/docs/agents/project-manifest/constraints.md` — Update §26, add new constraint
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add `_maybe_rename_plan_dir` entry
- `orchestrator/changelog.md` — Add entries for all three changes (subagent middleware propagation, pre-run rename, version constraint)
- `orchestrator/requirements.txt` — Change `deepagents>=0.3` to `deepagents>=0.3,<1` with an inline comment
- `orchestrator/pyproject.toml` — Change `"deepagents>=0.3"` to `"deepagents>=0.3,<1"` (no inline comment; PEP 508 prohibits it)

## Assumptions
- Deep Agents' `create_deep_agent()` continues to process `spec.get("middleware", [])` for subagent specs. This is the current behaviour in the installed version.
- The `general_purpose` subagent (auto-created by Deep Agents) does not need the middleware in practice, because it is rarely delegated file-writing tasks. This is acceptable for now.
- The PM's rename directive is limited to changing the date prefix. It does not change the suffix portion of the slug.
- `--resume` runs must use the exact path that was in the checkpoint state, so the rename is skipped.

## Constraints
- No upstream Deep Agents library changes.
- Cross-platform: both fixes use stdlib-only APIs (`pathlib.Path.rename`, `re`, `datetime.date`) that work on Windows, macOS, and Linux.
- The rename block in `_run()` must **not** recompute `_plan_hash` or `_run_status_path`. TypeScript computes `runStatusFilename(resolvedPlan)` before spawning the process; the GUI polls that exact filename throughout the run. `_plan_hash` must remain stable for the lifetime of the run. The original `_plan_hash` / `_run_status_path` assignment that precedes `plan_dir` resolution must remain in place for the plan-not-found early-exit path and must be the only site where these values are computed.

## Out of Scope
- **`general_purpose` subagent middleware:** Would require upstream Deep Agents API changes. Deferred.
- **Cross-workspace ledger storage routing:** The DEV-vs-STABLE mismatch is a consequence of the user running the orchestrator from STABLE against a DEV plan. The pre-run rename fixes the slug staleness; the workspace routing question is a broader concern outside this plan.
- **PM persona directive changes:** The PM's rename directive remains valid for IDE-based workflows. The orchestrator simply pre-empts it.
- **Supervisor state refresh mechanism:** A general-purpose mid-run state refresh is over-engineering for this specific failure. The pre-run rename eliminates the need.

## Acceptance Criteria
- AC-01: Subagent specs passed to `create_deep_agent()` include `PathNormalizationMiddleware` in their `middleware` list when the stage has subagents.
- AC-02: A subagent making a file-tool call with an absolute host path has that path rewritten to a virtual `/`-rooted path (no doubled directory structures).
- AC-03: Plan folders with outdated date prefixes are renamed to today's date before lock acquisition on fresh runs.
- AC-04: Plan folders with current date prefixes, no date prefix, or on `--resume` runs are not renamed.
- AC-05: If the target folder (today's date + suffix) already exists, the rename is skipped and the original folder is used.
- AC-06: All downstream path state (`plan_path`, `plan_dir`, lock path) uses the post-rename path.
- AC-12: `_plan_hash` and `_run_status_path` are **not** recomputed after a folder rename; they retain the values derived from the pre-rename path, matching the filename TypeScript's `runStatusFilename()` computed before spawning the orchestrator process.
- AC-07: Constraint §26 is updated to cover subagent middleware propagation.
- AC-08: A new constraint (§27) documents the pre-run rename behaviour, including the rule that `_plan_hash` and `_run_status_path` must never be recomputed after a folder rename.
- AC-09: All existing tests continue to pass; new tests cover the two fixes.
- AC-10: `orchestrator/changelog.md` is updated with entries for all three changes.
- AC-11: `orchestrator/requirements.txt` specifies `deepagents>=0.3,<1` with a comment documenting the subagent middleware API dependency on `spec.get("middleware", [])` at `graph.py:230`. `orchestrator/pyproject.toml` specifies the matching `"deepagents>=0.3,<1"` specifier (no comment — PEP 508 prohibits inline `#` comments).

## Testing Strategy
Both fixes are tested with pure unit tests that require no LLM, no MCP server, and no file system beyond `tmp_path`. The subagent middleware fix is tested by mocking `load_subagents()` and verifying the spec dicts; the rename fix is tested with real filesystem operations in `tmp_path`.

## Test Plan
- `orchestrator/tests/test_nodes.py::TestSubagentMiddlewarePropagation::test_subagent_specs_receive_path_middleware` — Verifies each subagent spec dict has `PathNormalizationMiddleware` in its `middleware` list after injection. Covers AC-01.
- `orchestrator/tests/test_nodes.py::TestSubagentMiddlewarePropagation::test_empty_subagent_list_no_error` — Verifies empty subagent list causes no injection and `create_deep_agent` receives `subagents=None`. Covers AC-01 (edge case).
- `orchestrator/tests/test_nodes.py::TestSubagentMiddlewarePropagation::test_existing_middleware_key_preserved` — Verifies pre-existing `middleware` entries in a spec are preserved and the new middleware is appended. Covers AC-01.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_outdated_date_renames_to_today` — Creates a folder with an old date, calls the function, verifies the folder is renamed to today. Covers AC-03, AC-06.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_current_date_no_rename` — Creates a folder with today's date, verifies it is not renamed. Covers AC-04.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_no_date_prefix_no_rename` — Creates a folder with no date prefix (e.g. `my-feature`), verifies it is not renamed. Covers AC-04.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_collision_skips_rename` — Creates both old-date and today-date folders, verifies the old folder is not renamed. Covers AC-05.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_non_iso_date_prefix_no_rename` — Creates a folder with a malformed date prefix, verifies it is not renamed. Covers AC-04.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_renamed_dir_returned` — Verifies the return value is the new `Path` after a successful rename. Covers AC-06.
- `orchestrator/tests/test_cli.py::TestMaybeRenamePlanDir::test_oserror_returns_original_dir` — Simulates an `OSError` during `Path.rename()` and verifies the function catches it, logs a warning, and returns the original unmodified `plan_dir`. Covers M-1 / risk mitigation accuracy.
- `orchestrator/tests/test_cli.py::TestRunFlow::test_plan_hash_stable_after_rename` — Wires `_maybe_rename_plan_dir()` into a minimal `_run()` mock and verifies that `_plan_hash` is not recomputed after the folder rename. Covers AC-12.

## Documentation Updates
- `orchestrator/docs/agents/project-manifest/constraints.md` — Update §26 (subagent middleware scope); add new constraint for pre-run rename. Covers AC-07, AC-08.
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add `_maybe_rename_plan_dir` entry.
- `orchestrator/docs/agents/project-manifest/data-flows.md` — In Flow 5 ("Run Metadata Sidecar Write"), add a one-line note to the entry-point description: "On fresh runs, `plan_dir` may have been renamed by `_maybe_rename_plan_dir()` before lock acquisition (see Constraint §27)."
- `orchestrator/changelog.md` — Add entries for subagent middleware propagation fix, pre-run plan folder rename, and Deep Agents version constraint. Covers AC-10.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Deep Agents changes subagent spec processing** | Both `orchestrator/requirements.txt` and `orchestrator/pyproject.toml` are now constrained to `deepagents>=0.3,<1`; a major-version bump requires an explicit upgrade decision regardless of install path (`pip install -r requirements.txt` or `pip install .`). An inline comment in `requirements.txt` documents the dependency on `spec.get("middleware", [])` at `graph.py:230` (comment omitted from `pyproject.toml` — PEP 508 prohibits it). |
| **Plan folder rename on network/slow filesystem fails** | `_maybe_rename_plan_dir()` wraps `Path.rename()` in a `try/except OSError`. On failure, a warning is logged and the original path is returned unchanged; the run continues with the old slug (same as current behaviour). A collision guard prevents overwriting an existing target folder before the rename is attempted. |
| **GUI `runStatusFilename` polling breaks after rename** | `_plan_hash` and `_run_status_path` are **not** recomputed after the rename. TypeScript computes the run-status filename from the pre-rename path before spawning the process; Python writes the tombstone under the same hash. The rename only affects `plan_dir` and `plan_path` in `_run()`. |
| **PM still attempts rename on IDE workflows** | Expected and correct — the PM directive exists for IDE-based runs where no orchestrator pre-empts it. In orchestrator runs, the folder already has today's date so the PM skips the directive naturally. |
