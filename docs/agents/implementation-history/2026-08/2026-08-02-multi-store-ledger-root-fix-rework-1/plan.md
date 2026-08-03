# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0 (findings M-1, M-2, m-1, m-2 addressed)
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context

The parent project `2026-08-02-multi-store-ledger-root-fix` fixed multi-store mode failures across the entire AI Insights codebase — 18 MCP tool handlers, GUI API layer, auto-archive service, standalone-import tool, and orchestrator path helpers. This rework plan addresses all deferred and out-of-scope items from that project's synthesis report, closing the remaining technical debt.

## Summary

Address all actionable deferred and out-of-scope items from the `2026-08-02-multi-store-ledger-root-fix` synthesis report. This includes: fixing `createWorkPackage` write routing to use `resolveStoreForWrite` (D-1), introducing a typed `StoreNotRegisteredError` to eliminate fragile string matching (O-1), aligning the auto-archive guard to the established two-condition pattern (O-3), adding debug logging to the Python `_load_json()` helper (O-5), adding `_stores_config_path` pass-through to orchestrator helper functions for direct testability (D-2), documenting the autouse fixture pattern in the orchestrator test README (Gold Nugget #3), and regenerating stale `.context/` snapshots (O-4).

## Architectural Context

The multi-store system routes ledger operations to the correct store based on repository name. Two resolution patterns exist:

- **Read resolution** (`resolveMultiStoreLedgerRoot`): Falls back to the default store for unregistered repos. Used by most MCP tool handlers per Constraint 86.
- **Write resolution** (`resolveStoreForWrite`): Rejects unregistered repos with an error. Used by `initializeProject()` and `importStandalone()` — operations that create new ledger state.

Error discrimination between these patterns currently relies on string matching (`msg.includes('not registered in any store')`), which is fragile if the error message changes.

The orchestrator mirrors the TypeScript store resolution in Python (`store_resolution.py`) using stdlib-only modules. Its helper functions (`_derive_slug_dir`, `_derive_ledger_log_dir`) call `resolve_store_for_repo()` but do not expose the `_stores_config_path` parameter, making direct multi-store testing impossible.

## Approach / Architecture

1. **Typed error class**: Introduce `StoreNotRegisteredError` in `store-router.ts`, thrown by `resolveStoreForWrite()` and `knowledge.ts`. Callers in `project-lifecycle.ts` and `standalone-import.ts` switch from string matching to `instanceof` checks.
2. **Write routing for `createWorkPackage`**: Replace the `resolveMultiStoreLedgerRoot` call with the full `resolveStoreForWrite` pattern (matching `initializeProject()`), and amend Constraint 86 to note the write-routing exception.
3. **Auto-archive guard alignment**: Add the `getStoreRouter().isMultiStoreMode()` check to match the established two-condition pattern.
4. **Python improvements**: Add `logging.debug()` to `_load_json()`, expose `_stores_config_path` on `_derive_slug_dir` and `_derive_ledger_log_dir`, update the test classes to call the actual helpers, and document the autouse fixture pattern in the test README.
5. **CTX regeneration**: Run `node scripts/cli.js ctx-generate` to refresh stale snapshots.

## Rationale

Each item was identified during the parent project's pipeline (code review, QA, or implementation observations) and deferred because it was not in scope of the multi-store fix. Collectively, these items eliminate string-matching fragility, improve test coverage fidelity, and ensure documentation stays current.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Typed error class location | New `StoreNotRegisteredError` class in `store-router.ts` alongside the throw site | Separate `errors.ts` module; generic `StoreError` base class | A single error class co-located with its throw site is simpler. A separate module would be warranted if more typed errors are added later. |
| `createWorkPackage` routing | Full `resolveStoreForWrite` pattern with multi-store guard | Keep `resolveMultiStoreLedgerRoot` and document the silent fallback | Silent fallback on writes is a correctness bug — new WPs end up in the wrong store. The explicit pattern matches the other two write handlers. |
| Python `_stores_config_path` pass-through | Add optional parameter to `_derive_slug_dir` and `_derive_ledger_log_dir` | Keep testing via `resolve_store_for_repo()` only | The current test classes claim to test the helpers but don't call them. Direct testing catches regressions in the helper logic itself. |

## Pattern Alignment

- `resolveStoreForWrite` write-routing pattern — follows `mcp-server/src/tools/project-lifecycle.ts` and `standalone-import.ts`. No departure.
- Two-condition multi-store guard (`isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`) — follows `gui/api.ts`, `gui/server.ts`, `gui/api-repos.ts`. No departure.
- `_stores_config_path` test injection parameter — follows `orchestrator/src/utils/store_resolution.py`. No departure.
- `StoreNotRegisteredError` is the first typed error class in the MCP server. Justified because string-matching error discrimination is fragile and affects two production code paths.

## Detailed Steps

### Step 1: Introduce `StoreNotRegisteredError` typed error class

Create a `StoreNotRegisteredError` class in `mcp-server/src/storage/store-router.ts` (co-located with `resolveStoreForWrite` which throws it):

```typescript
export class StoreNotRegisteredError extends Error {
  public readonly repoName: string;
  constructor(repoName: string) {
    super(`Repository "${repoName}" is not registered in any store`);
    this.name = 'StoreNotRegisteredError';
    this.repoName = repoName;
  }
}
```

Update `resolveStoreForWrite()` to throw `new StoreNotRegisteredError(repoName)` instead of `new Error(...)`.

Update `mcp-server/src/tools/knowledge.ts` (L77) to throw `new StoreNotRegisteredError(args.repository_name!)` instead of `new Error(...)`.

### Step 2: Refactor callers to use `instanceof` instead of string matching

In `mcp-server/src/tools/project-lifecycle.ts` (`initializeProject`, ~L565–L590):
- Import `StoreNotRegisteredError` from `store-router.ts`.
- Replace the `try/catch` block around `resolveStoreForWrite` to use `if (err instanceof StoreNotRegisteredError)` instead of `if (!msg.includes('not registered in any store'))`.

In `mcp-server/src/tools/standalone-import.ts` (`importStandalone`, ~L175–L200):
- Same refactor: import `StoreNotRegisteredError`, switch to `instanceof` check.

### Step 3: Fix `createWorkPackage` write routing

In `mcp-server/src/tools/work-package.ts`, replace the current `resolveMultiStoreLedgerRoot` call in `createWorkPackage()` (~L270–L272) with the full write-routing pattern used by `initializeProject()`:

```typescript
let store: LedgerStore;
if (isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()) {
  const projectRoot = inferProjectRootFromPlanPath(projectPath);
  const repoName = deriveRepoName(projectPath, projectRoot);
  let targetLedgerRoot: string;
  try {
    targetLedgerRoot = await getStoreRouter().resolveStoreForWrite(repoName);
  } catch (err) {
    if (err instanceof StoreNotRegisteredError) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: Repository "${repoName}" is not registered in any store. ` +
            `Register it via the store CLI (node scripts/cli.js store repo add) before creating a work package.`,
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text' as const,
        text: `Error: Failed to resolve store for repository "${repoName}": ${(err as Error).message}`,
      }],
      isError: true,
    };
  }
  store = new LedgerStore(projectPath, targetLedgerRoot);
} else {
  const ledgerRoot = await resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot);
  store = new LedgerStore(projectPath, ledgerRoot);
}
```

This requires adding imports for `isStoreContextInitialized`, `getStoreRouter`, `inferProjectRootFromPlanPath`, `deriveRepoName`, and `StoreNotRegisteredError`. The existing `resolveMultiStoreLedgerRoot` import (from `store-resolution.ts`) handles both the test-override path and the legacy-mode fallback in the else branch — no additional imports needed for the else branch. The `resolveMultiStoreLedgerRoot` import stays regardless (other handlers in this file still use it).

### Step 4: Amend Constraint 86 documentation

Update `mcp-server/docs/agents/project-manifest/constraints.md` Constraint 86 to note the write-routing exception:

Add a paragraph after the migration scope note:

> **Write-routing exception:** Handlers that create new ledger state (e.g., `createWorkPackage`) must use the `resolveStoreForWrite()` pattern instead. This enforces that the target repository is registered in a store, preventing silent phantom directory creation in the default store. See `initializeProject()` in `project-lifecycle.ts` for the reference pattern.

### Step 5: Align auto-archive guard

In `mcp-server/src/gui/auto-archive.ts` (~L46–L48), change:

```typescript
const projects = isStoreContextInitialized()
  ? await getMultiStoreManager().listAllProjects()
  : await LedgerStore.listAllProjects(ledgerRoot);
```

to:

```typescript
const projects = isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()
  ? await getMultiStoreManager().listAllProjects()
  : await LedgerStore.listAllProjects(ledgerRoot);
```

Add `getStoreRouter` to the import from `store-context.ts`.

### Step 6: Add debug logging to Python `_load_json()`

In `orchestrator/src/utils/store_resolution.py`, add a module-level logger and a `logging.debug()` call in the `except` branch of `_load_json()`:

```python
import logging

_logger = logging.getLogger(__name__)

def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text)
    except Exception:  # noqa: BLE001
        _logger.debug("store_resolution: could not load %s", path, exc_info=True)
        return None
```

### Step 7: Add `_stores_config_path` parameter to orchestrator helpers

In `orchestrator/src/cli.py`, add `_stores_config_path: Path | None = None` parameter to `_derive_ledger_log_dir()` and pass it through to `resolve_store_for_repo()`:

```python
def _derive_ledger_log_dir(
    plan_dir: Path,
    workspace_root: Path,
    _stores_config_path: Path | None = None,
) -> Path:
    slug = plan_dir.name
    repo_name = _derive_repo_name(plan_dir, "unknown")
    store_root = resolve_store_for_repo(repo_name, workspace_root, _stores_config_path=_stores_config_path)
    return store_root / repo_name / slug / "orchestrator" / "logs"
```

In `orchestrator/src/nodes/__init__.py`, add `_stores_config_path: Path | None = None` parameter to `_derive_slug_dir()` and pass it through:

```python
def _derive_slug_dir(
    project_path: str,
    workspace_root: Path,
    _stores_config_path: Path | None = None,
) -> Path | None:
    try:
        p = Path(project_path)
        slug = p.name
        if not slug:
            return None
        try:
            repo_name = p.parents[3].name or "unknown"
        except IndexError:
            repo_name = "unknown"
        store_root = resolve_store_for_repo(repo_name, workspace_root, _stores_config_path=_stores_config_path)
        return store_root / repo_name / slug
    except Exception:  # noqa: BLE001
        return None
```

Production call sites pass no override (backward compatible).

### Step 8: Update orchestrator test classes to call actual helpers

In `orchestrator/tests/test_store_resolution.py`:

- `TestDeriveSlugDirMultiStore.test_produces_correct_path_for_non_default_store()`: Import `_derive_slug_dir` from `src.nodes` and call it directly with the `_stores_config_path` parameter, instead of calling `resolve_store_for_repo()` and manually computing the expected path.

- `TestDeriveLedgerLogDirMultiStore.test_produces_correct_path_for_non_default_store()`: Import `_derive_ledger_log_dir` from `src.cli` and call it directly with the `_stores_config_path` parameter.

### Step 9: Document autouse fixture pattern in orchestrator test README

Add a new section to `orchestrator/tests/README.md` (before "## Running Tests") documenting the store-resolution isolation pattern:

```markdown
## Store Resolution Isolation

Any test that calls `_derive_slug_dir()` or `_derive_ledger_log_dir()` — or any
function that transitively calls `resolve_store_for_repo()` — **must** patch the
resolution function to prevent the user's real `~/.ai-insights/stores.json` from
affecting test results.

Use an autouse fixture:

\`\`\`python
@pytest.fixture(autouse=True)
def _isolate_store_resolution(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    default = tmp_path / "storage" / "ledger"
    default.mkdir(parents=True, exist_ok=True)
    _default = lambda *_a, **_kw: default
    monkeypatch.setattr("src.nodes.resolve_store_for_repo", _default)
    monkeypatch.setattr("src.cli.resolve_store_for_repo", _default)
\`\`\`

**Rationale:** The developer's real `stores.json` may register the repository in a
non-default store. Without the fixture, tests resolve the wrong store path and fail
with incorrect assertions or unexpected ENOENT errors.

**Existing examples:** `test_slug_dir.py` (patches both `src.nodes.resolve_store_for_repo` and `src.cli.resolve_store_for_repo`), `test_streaming_capture.py` (patches `src.nodes.resolve_store_for_repo` only).
```

### Step 10: Regenerate CTX snapshots

Run `node scripts/cli.js ctx-generate` to refresh `.context/` after the documentation changes in Steps 4 and 9.

### Step 11: Update manifest documentation

Update `mcp-server/docs/agents/project-manifest/api-surface.md` to:
- Add `StoreNotRegisteredError` to the exports of `store-router.ts`.
- Amend the existing "Error contract" paragraph for `store-router.ts` (currently: "The error message `"not registered in any store"` is hardcoded and tested verbatim; do not change without updating the test suite"): note that `StoreNotRegisteredError` is the typed class thrown by `resolveStoreForWrite()`, that callers should discriminate via `instanceof StoreNotRegisteredError`, and that the `.message` property preserves the original string for backward compatibility with any existing message-based assertions.

Update `mcp-server/docs/agents/project-manifest/data-flows.md`:
- Flow 2 (Work Package Creation) currently shows no store-routing step. Add a store-routing step at the entry point: multi-store mode → `resolveStoreForWrite(repoName)` → storePath or rejection; single-store/legacy mode → `resolveMultiStoreLedgerRoot(projectPath, _ledgerRoot)` → `undefined` (LedgerStore default). This mirrors the structure of Flow P.

## Dependencies

- Steps 1–2 must complete before Steps 3 (Step 3 uses `StoreNotRegisteredError` and `instanceof`).
- Steps 6–7 must complete before Step 8 (Step 8 calls the modified helpers).
- All code steps (1–9, 11) must complete before Step 10 (CTX regeneration captures final state).
- Steps 4–5 are independent of all other steps.

## Required Components

- `mcp-server/src/storage/store-router.ts` — new `StoreNotRegisteredError` class + modified throw
- `mcp-server/src/tools/project-lifecycle.ts` — refactored catch block
- `mcp-server/src/tools/standalone-import.ts` — refactored catch block
- `mcp-server/src/tools/knowledge.ts` — updated throw
- `mcp-server/src/tools/work-package.ts` — full write-routing pattern
- `mcp-server/src/gui/auto-archive.ts` — aligned guard
- `mcp-server/docs/agents/project-manifest/constraints.md` — Constraint 86 amendment
- `mcp-server/docs/agents/project-manifest/api-surface.md` — new export
- `orchestrator/src/utils/store_resolution.py` — debug logging
- `orchestrator/src/cli.py` — `_stores_config_path` parameter
- `orchestrator/src/nodes/__init__.py` — `_stores_config_path` parameter
- `orchestrator/tests/test_store_resolution.py` — updated test classes
- `orchestrator/tests/README.md` — autouse fixture documentation

## Assumptions

- The `createWorkPackage` handler is the only remaining MCP tool handler that writes ledger state but uses `resolveMultiStoreLedgerRoot` instead of `resolveStoreForWrite`.
- `StoreNotRegisteredError` is the only typed error class needed at this time. If more emerge, a dedicated `errors.ts` module can be introduced later.
- The autouse fixture pattern in the orchestrator tests is stable and will not change.

## Constraints

- Constraint 86 must be amended (not violated) — the write-routing exception is a deliberate architectural decision, not a constraint violation.
- The Python `_stores_config_path` parameter must be optional with `None` default to preserve backward compatibility at all production call sites.
- The `StoreNotRegisteredError` class must extend `Error` to preserve compatibility with existing catch blocks that don't discriminate by type.

## Out of Scope

- **`resolveProjectDir()` existence check (O-2):** The qualified-slug path in `resolveProjectDir()` does not verify directory existence before returning. While this is a leaky abstraction, the current design is correctly handled by all callers (`.meta.json` read catches ENOENT). The change risks altering error semantics for the GUI API layer's `resolveProjectStore()` function which relies on the ENOENT/AMBIGUOUS/corrupt-JSON triaging documented in the synthesis. Benefit is low (cosmetic cleanup) relative to the risk of introducing regressions in a security-sensitive resolution function.

## Acceptance Criteria

- AC-01: `StoreNotRegisteredError` is exported from `store-router.ts` and thrown by `resolveStoreForWrite()` and `knowledge.ts`.
- AC-02: `project-lifecycle.ts` and `standalone-import.ts` use `instanceof StoreNotRegisteredError` instead of `msg.includes('not registered in any store')`.
- AC-03: `createWorkPackage()` uses `resolveStoreForWrite()` in multi-store mode and rejects unregistered repositories with a user-friendly error message.
- AC-04: `createWorkPackage()` continues to work in single-store/legacy mode (test override path preserved).
- AC-05: Constraint 86 documents the write-routing exception.
- AC-06: `auto-archive.ts` uses the two-condition guard `isStoreContextInitialized() && getStoreRouter().isMultiStoreMode()`.
- AC-07: Python `_load_json()` emits `logging.debug()` on caught exceptions.
- AC-08: `_derive_slug_dir()` and `_derive_ledger_log_dir()` accept `_stores_config_path` parameter and pass it through to `resolve_store_for_repo()`.
- AC-09: `TestDeriveSlugDirMultiStore` and `TestDeriveLedgerLogDirMultiStore` call the actual helper functions instead of `resolve_store_for_repo()` directly.
- AC-10: Orchestrator test README documents the autouse fixture pattern for store-resolution isolation.
- AC-11: `.context/` snapshots are regenerated and current.
- AC-12: All existing tests pass with zero regressions.

## Testing Strategy

- **TypeScript**: Add unit tests for `StoreNotRegisteredError` (class identity, `instanceof`, message format). Add an integration test for `createWorkPackage` in multi-store mode verifying that unregistered repos are rejected. Verify all existing tests pass.
- **Python**: Update the two test classes to call the actual helpers. Add a test for `_load_json()` debug logging (verify log output via `caplog`). Verify all existing tests pass.

## Test Plan

- `mcp-server/tests/storage/store-router.test.ts` — new test: `StoreNotRegisteredError instanceof Error`, `.repoName` property, `.message` format — covers AC-01
- `mcp-server/tests/tools/multi-store-tool-resolution.test.ts` — new test: `createWorkPackage rejects unregistered repo in multi-store mode` — covers AC-03, AC-04
- `mcp-server/tests/tools/multi-store-tool-resolution.test.ts` — verify existing `createWorkPackage` test still passes in single-store mode — covers AC-04
- `orchestrator/tests/test_store_resolution.py` — updated `TestDeriveSlugDirMultiStore` calls `_derive_slug_dir()` directly — covers AC-09
- `orchestrator/tests/test_store_resolution.py` — updated `TestDeriveLedgerLogDirMultiStore` calls `_derive_ledger_log_dir()` directly — covers AC-09
- `orchestrator/tests/test_store_resolution.py` — new test: `_load_json debug logging on failure` using `caplog` — covers AC-07
- Full regression run: `npm test` (MCP server), `python -m pytest tests/ -m "not live"` (orchestrator) — covers AC-12

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Amend Constraint 86 with write-routing exception paragraph (Step 4)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `StoreNotRegisteredError` export entry (Step 11)
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update `createWorkPackage` flow if documented (Step 11)
- `orchestrator/tests/README.md` — Add "Store Resolution Isolation" section (Step 9)
- `.context/` — Full regeneration via `node scripts/cli.js ctx-generate` (Step 10)

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | `resolveProjectDir()` existence check for qualified slugs (O-2) | Synthesis O-2 / WP-002 (impl) | The leaky abstraction is correctly handled by all callers via `.meta.json` ENOENT detection. Changing the function risks altering error semantics in `resolveProjectStore()` which relies on nuanced ENOENT/AMBIGUOUS/corrupt-JSON triaging. Low benefit relative to regression risk. | Reconsider if `resolveProjectDir` callers proliferate or if a new caller doesn't follow the ENOENT convention. |
| 2 | Dedicated `errors.ts` module | New (this plan) | Only one typed error class exists (`StoreNotRegisteredError`). A dedicated module is not justified for a single class. | Reconsider when a second typed error class is needed. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`createWorkPackage` behavior change breaks existing callers** | The change only affects multi-store mode for unregistered repos — a case that previously produced silent phantom directories (a bug). Single-store mode and registered-repo paths are unchanged. Integration test validates both paths. |
| **`instanceof` check breaks across module boundaries** | `StoreNotRegisteredError` is defined and thrown in the same package (`mcp-server/src/`). All callers import from the same package. No cross-boundary `instanceof` issues. |
| **Python `_stores_config_path` parameter changes production behavior** | Parameter defaults to `None`, which preserves exact existing behavior. Only test code passes non-`None` values. |
| **CTX regeneration produces large diff** | Expected — the `.context/` files are regenerated snapshots. The diff is noise, not a regression. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All items are small, well-understood modifications within established patterns — no new architecture, no cross-cutting concerns, and a single developer session suffices with self-review.
