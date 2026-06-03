# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.4.0
- Architectural Reviews: 2 — Plan Architect Reviewer v1.5.0

## Summary

Address all actionable follow-up items from the `2026-05-31-orchestrator-sidecar-gui-resume-rework-2` synthesis. This plan covers the two medium-priority security hardening items (path-segment guards), a Python DRY refactor, a GUI cache-key centralization helper, a `ProjectNameCache` TTL/eviction mechanism, and a dedicated jsdom test file for the project-list view.

## Architectural Context

### Queue Path Resolution (Security Gap)

`mcp-server/src/gui/queue/get-queue.ts` exports `getProjectLedgerStatus(ledgerRoot, slug, expectedRepo)` which constructs a filesystem path via `path.join(ledgerRoot, expectedRepo, slug, ...)` when `expectedRepo` is non-null. The `expectedRepo` and `slug` values originate from the JSON queue file (`orchestrator/logs/run-queue.json`) — written by the Python orchestrator. While these values are under developer control (local-only tool), the project already enforces `assertSafeSegment()` from `mcp-server/src/utils/path-validator.ts` at other path-construction boundaries for defense-in-depth.

`mcp-server/src/gui/queue/validate-entry.ts` contains `isRawQueueEntry()`, a type-guard with a documented side-effect: it normalizes missing `expectedRepo` to `null`. However, it does **not** reject empty-string `expectedRepo` values, which would pass the `typeof === 'string'` check and subsequently produce an invalid path like `ledgerRoot//slug/...`.

### Orchestrator CLI (Python)

`orchestrator/src/cli.py` derives `repo_name` from `plan_dir.parents[3].name` in two independent locations (lines ~119 and ~785), each with its own try/except fallback. The synthesis recommends a shared `_derive_repo_name()` helper.

### GUI Cache-Key Pattern

The composite key `repo + '/' + slug` is constructed in three places: `project-list.js` (line 138), `project-detail.js` (line 181), and `utils.js` (line 93 — in `breadcrumb().project()`). The synthesis recommends a `makeProjectCacheKey(repo, slug)` helper in `utils.js`.

### ProjectNameCache Growth

The `ProjectNameCache` in `mcp-server/gui/public/utils.js` is an unbounded IIFE-based map. In long SPA sessions with many projects, it grows without bound. No existing eviction mechanism.

### Key Reference Files

| File | Relevance |
|------|-----------|
| `mcp-server/src/gui/queue/get-queue.ts` | `getProjectLedgerStatus()` — path construction with `expectedRepo` |
| `mcp-server/src/gui/queue/validate-entry.ts` | `isRawQueueEntry()` — empty-string gap |
| `mcp-server/gui/orchestrator-manager.ts` | `killQueueEntry()`, `dismissQueueEntry()` — consumers of `getProjectLedgerStatus()` |
| `mcp-server/src/utils/path-validator.ts` | `assertSafeSegment()` — existing guard utility |
| `mcp-server/gui/public/utils.js` | `ProjectNameCache`, breadcrumb helpers |
| `mcp-server/gui/public/views/project-list.js` | `buildTable()`, action-menu logic |
| `mcp-server/gui/public/views/project-detail.js` | Cache-key usage |
| `orchestrator/src/cli.py` | `_derive_ledger_log_dir()`, queue registration |

## Approach / Architecture

1. **Security hardening (Steps 1–3):** Add `assertSafeSegment()` validation at the queue-entry read boundary, immediately after `isRawQueueEntry()` succeeds. Reject entries with empty-string `expectedRepo` inside the type guard by normalizing `''` → `null`. Add a guard in `getProjectLedgerStatus()` as a defense-in-depth second layer.

2. **Python DRY refactor (Step 4):** Extract `_derive_repo_name(plan_dir: Path, fallback)` as a module-level helper in `cli.py`, replacing the two inline derivations.

3. **Cache-key helper (Step 5):** Add `makeProjectCacheKey(repo, slug)` to `utils.js` and update all three call sites.

4. **ProjectNameCache eviction (Step 6):** Add a simple max-size cap (LRU-like: evict oldest entries when exceeding threshold). This is vanilla JS (no framework) so a lightweight array-based access-order tracker suffices.

5. **jsdom test file (Step 7):** Create `tests/gui/project-list.test.ts` with tests for `buildTable()` rendering (null-repo rows, action-menu attributes, cache population).

## Rationale

- The `assertSafeSegment()` utility already exists and is used at other boundaries — applying it here maintains consistency and closes the gap with minimal code.
- Empty-string normalization inside `isRawQueueEntry()` matches the existing pattern (it already normalizes missing → `null`); extending to empty-string is a one-line addition.
- The Python helper is a corrective behavioral change that aligns Python with TypeScript's `deriveRepoName()` lowercasing convention in `ledger-root.ts`, ensuring the queue's `expectedRepo` always satisfies `SAFE_SLUG_REGEX`. The `.lower()` call is intentional and required — omitting it would cause `assertSafeSegment()` (Step 2) to reject uppercase repo names written by unpatched code.
- The cache-key helper eliminates a class of separator-drift bugs if additional views are added.
- A max-size cap on `ProjectNameCache` is proportional to the risk (only matters in very long sessions with many projects) — no full LRU data structure needed, just a bounded map.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Guard placement for `expectedRepo` | Dual-layer: type-guard normalization + `getProjectLedgerStatus()` early-return | Guard only at type-guard level | Defense-in-depth is cheap here (one `if` statement) and protects against future callers that bypass the type guard |
| Empty-string handling | Normalize `'' → null` in type guard | Throw/reject the entire entry | Normalizing is consistent with how missing `expectedRepo` is already handled; rejecting would break otherwise-valid legacy entries that accidentally write `""` |
| Cache eviction strategy | Simple max-size with oldest-entry eviction | Full LRU with doubly-linked list; WeakRef-based cache; per-navigation clear | A 200-entry cap with `delete _cache[oldestKey]` is trivially simple; LRU is over-engineered for a UI cache; per-navigation clear would cause visible re-fetch flicker |
| Test approach for project-list | jsdom unit tests in Vitest | Playwright/E2E; manual verification | jsdom tests are fast, run in CI, and match the existing `tests/gui/` pattern (e.g. `dialogue-qa.test.ts`) |

## Pattern Alignment

- `assertSafeSegment()` usage at path-construction boundaries — follows `mcp-server/src/storage/ledger-store.ts` pattern (per `constraints.md` §path-validation).
- In-place normalization inside `isRawQueueEntry()` — extends the existing documented side-effect pattern (WP-004 of the previous plan established this).
- `_derive_repo_name()` helper pattern — mirrors existing `_derive_ledger_log_dir()` structure in `orchestrator/src/cli.py`.
- `makeProjectCacheKey()` helper in `utils.js` — follows the project convention of placing shared GUI utilities in `utils.js` (existing: `escapeHtml`, `breadcrumb`, `ProjectNameCache`).
- jsdom tests in `tests/gui/` — follows the existing `dialogue-qa.test.ts` pattern.

## Detailed Steps

### Step 1: Harden `isRawQueueEntry()` — reject empty-string `expectedRepo`

In `mcp-server/src/gui/queue/validate-entry.ts`, extend the normalization block:

```typescript
// Current:
if (typeof e['expectedRepo'] !== 'string') {
  e['expectedRepo'] = null;
}

// Change to:
if (typeof e['expectedRepo'] !== 'string' || (e['expectedRepo'] as string).trim() === '') {
  e['expectedRepo'] = null;
}
```

This ensures empty-string or whitespace-only values are normalized to `null` (same as missing values), preventing invalid paths downstream.

### Step 2: Add `assertSafeSegment()` guard in `getProjectLedgerStatus()`

In `mcp-server/src/gui/queue/get-queue.ts`, add an early-return guard at the top of `getProjectLedgerStatus()`:

```typescript
import { assertSafeSegment } from '../../utils/path-validator.js';

export async function getProjectLedgerStatus(
  ledgerRoot: string,
  slug: string,
  expectedRepo: string | null = null,
): Promise<{ exists: boolean; synthesisGenerated: boolean }> {
  // Defense-in-depth: reject path-traversal attempts and invalid segments
  if (!assertSafeSegment(slug)) {
    return { exists: false, synthesisGenerated: false };
  }
  if (expectedRepo !== null && !assertSafeSegment(expectedRepo)) {
    return { exists: false, synthesisGenerated: false };
  }
  // ... existing path construction ...
}
```

### Step 3: Add unit tests for path-segment guards

Add tests to the two existing test files:
- In `mcp-server/tests/gui/queue/validate-entry.test.ts`: `isRawQueueEntry()` normalizes `expectedRepo: ''` → `null` and `expectedRepo: '  '` → `null` (these new cases belong alongside the existing `TC-20–TC-22` normalization describe block)
- In `mcp-server/tests/gui/queue/get-queue.test.ts`: `getProjectLedgerStatus()` returns `{ exists: false }` for path-traversal attempts (`../etc`) and for empty slug. New describe blocks must use a plan-specific label — e.g. `describe('getProjectLedgerStatus — path-segment guard (this plan AC-2)', ...)` — to distinguish from the existing `describe('getQueue — AC-2')` block (WP-005 criterion) already present in the file.

### Step 4: Extract `_derive_repo_name()` helper in Python CLI

In `orchestrator/src/cli.py`, add a module-level helper:

```python
def _derive_repo_name(plan_dir: Path, fallback: str | None = "unknown") -> str | None:
    """Extract the repository name from the plan directory ancestry.

    Convention: plan paths follow ``{repo}/docs/agents/plans/{slug}/plan.md``,
    so the repo name is ``plan_dir.parents[3].name``.

    The name is lowercased to mirror the TypeScript ``deriveRepoName()``
    convention in ``ledger-root.ts``, ensuring the queue's ``expectedRepo``
    value always satisfies ``SAFE_SLUG_REGEX`` and aligns with the ledger's
    storage key.

    Returns *fallback* when the path has fewer than four ancestor levels or the
    ancestor name is empty.
    """
    try:
        name = plan_dir.parents[3].name
        return name.lower() if name else fallback
    except IndexError:
        return fallback
```

Replace the two inline derivations:
- `_derive_ledger_log_dir()` line ~119: replace `try...except` block with `_derive_repo_name(plan_dir, fallback="unknown")`
- Queue registration block line ~785: replace `try...except` block with `_derive_repo_name(plan_dir, fallback=None)`

### Step 5: Add `makeProjectCacheKey()` helper and update call sites

In `mcp-server/gui/public/utils.js`, add:

```javascript
/**
 * Construct the composite cache key for a namespaced project.
 * @param {string} repo - Repository name.
 * @param {string} slug - Project slug.
 * @returns {string} Composite key in the form `repo/slug`.
 */
function makeProjectCacheKey(repo, slug) {
  return repo + '/' + slug;
}
```

Update the three call sites:
- `project-list.js` line 138: `ProjectNameCache.set(makeProjectCacheKey(p.repository_name, p.slug), ...)`
- `project-detail.js` line 181: `ProjectNameCache.set(makeProjectCacheKey(repo, slug), ...)`
- `utils.js` line 93 (breadcrumb): `ProjectNameCache.get(makeProjectCacheKey(repo, slug))`

### Step 6: Add eviction to `ProjectNameCache`

Replace the current IIFE with a bounded version:

```javascript
var ProjectNameCache = (function () {
  var _cache = {};
  var _keys = [];          // insertion-order tracking
  var MAX_SIZE = 200;

  function _evict() {
    while (_keys.length > MAX_SIZE) {
      var oldest = _keys.shift();
      delete _cache[oldest];
    }
  }

  return {
    set: function (key, name) {
      if (key && name && name.trim()) {
        if (!_cache[key]) _keys.push(key);
        _cache[key] = name.trim();
        _evict();
      }
    },
    get: function (key) {
      if (_cache[key]) return _cache[key];
      var lastSlash = key ? key.lastIndexOf('/') : -1;
      return lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    },
    /** @internal — exposed for testing only */
    _size: function () { return _keys.length; },
  };
}());
```

### Step 7: Add jsdom unit tests for `project-list.js`

Create `mcp-server/tests/gui/project-list.test.ts` covering:
- `buildTable()` renders clickable link for projects with `repository_name`
- `buildTable()` renders read-only cell for projects with `null` `repository_name`
- `buildTable()` populates `ProjectNameCache` with composite key
- Action-menu wrapper has correct `data-repo` and `data-slug` attributes
- Action-menu click handler skips actions when `data-repo` is empty

These tests follow the existing jsdom pattern in `tests/gui/dialogue-qa.test.ts`.

## Dependencies

- Step 2 depends on Step 1 (the guard in `getProjectLedgerStatus()` is defense-in-depth; the primary fix is the type-guard normalization)
- Step 3 depends on Steps 1–2 (tests verify both layers)
- Step 5 depends on Step 6 being coordinated (same file `utils.js`), but they are logically independent
- Step 7 depends on Steps 5–6 (tests verify the final shape of `ProjectNameCache` and `makeProjectCacheKey`)
- Step 4 is fully independent

## Required Components

- `mcp-server/src/gui/queue/validate-entry.ts` — modify existing
- `mcp-server/src/gui/queue/get-queue.ts` — modify existing
- `mcp-server/gui/public/utils.js` — modify existing
- `mcp-server/gui/public/views/project-list.js` — modify existing (one line)
- `mcp-server/gui/public/views/project-detail.js` — modify existing (one line)
- `orchestrator/src/cli.py` — modify existing
- `mcp-server/tests/gui/queue/get-queue.test.ts` — new or extend existing
- `mcp-server/tests/gui/project-list.test.ts` — new file

## Assumptions

- `assertSafeSegment()` in `mcp-server/src/utils/path-validator.ts` validates against the `SAFE_SLUG_REGEX` pattern (`/^[a-z0-9][a-z0-9-]*$/`) and returns `false` for empty strings, path-traversal sequences, and non-lowercase strings.
- The Python orchestrator always writes `expectedRepo` as either a valid lowercased repo name string or omits the field entirely. `_derive_repo_name()` applies `.lower()` before returning, aligning with TypeScript's `deriveRepoName()` and ensuring all queue entries satisfy `SAFE_SLUG_REGEX`. The empty-string case is a defensive guard against malformed manual edits or future bugs.
- The existing `dialogue-qa.test.ts` pattern for jsdom GUI tests provides a working model for `project-list.test.ts`.
- `makeProjectCacheKey()` will be globally available in the browser context (same as `escapeHtml`, `ProjectNameCache`).

## Constraints

- `mcp-server/gui/public/` is vanilla JavaScript (no modules, no bundler) — the helper must be a plain function declaration, not an ES module export.
- `orchestrator/src/cli.py` is the single entry point for orchestrator runs — the refactor must not change behavior, only DRY the implementation.
- The `isRawQueueEntry()` mutation side-effect pattern is intentional and documented — the empty-string normalization must follow the same inline-mutation style.

## Out of Scope

- Removal of the 21 deprecated non-namespaced route blocks in `server.ts` (reserved for next major version).
- Extraction of `renderRunsList` nested closure in `project-detail.js` (marked as future refactor).
- Revisiting the `isRawQueueEntry()` side-effect pattern toward a pure two-step approach (only needed if a second consumer is added).
- Full LRU cache implementation for `ProjectNameCache` (the simple max-size cap is sufficient).
- Updating `_derive_slug_dir()` in `orchestrator/src/nodes/__init__.py` to match the lowercasing behavior introduced in `_derive_repo_name()` — same inconsistency, separate refactor.

## Acceptance Criteria

- AC-1: `isRawQueueEntry()` normalizes `expectedRepo: ''` and `expectedRepo: '   '` to `null`.
- AC-2: `getProjectLedgerStatus()` returns `{ exists: false, synthesisGenerated: false }` when `slug` or `expectedRepo` fails `assertSafeSegment()`.
- AC-3: All existing queue tests continue to pass unchanged.
- AC-4: `_derive_repo_name()` helper exists in `cli.py`; the two inline derivations are replaced; the helper lowercases the repo name; `ruff check` passes.
- AC-5: `makeProjectCacheKey(repo, slug)` is defined in `utils.js` and used at all three composite-key construction sites.
- AC-6: `ProjectNameCache` evicts entries when size exceeds 200; `._size()` method available for testing.
- AC-7: `tests/gui/project-list.test.ts` exists with ≥ 5 passing tests covering table rendering, null-repo handling, cache population, and action-menu attributes.
- AC-8: Full test suite (`npm test` in `mcp-server/`) passes with no regressions.
- AC-9: `pytest` in `orchestrator/` passes with no regressions.

## Testing Strategy

- **Unit tests (TypeScript):** New tests in `tests/gui/queue/` for the path-segment guards and `isRawQueueEntry()` normalization. New `tests/gui/project-list.test.ts` for DOM rendering.
- **Unit tests (Python):** Add at minimum one test asserting that `_derive_repo_name()` lowercases the repo name (e.g. `Path('/a/b/c/MyRepo/docs/agents/plans/2026-01-01-slug')` → `'myrepo'`). This is a new behavioral change (`.lower()`) not covered by any pre-existing test.
- **Regression:** Full `npm test` in `mcp-server/` and `pytest` in `orchestrator/` must pass after all changes.

## Test Plan

- `mcp-server/tests/gui/queue/validate-entry.test.ts` — `isRawQueueEntry()` normalizes empty-string `expectedRepo` to null — AC-1
- `mcp-server/tests/gui/queue/validate-entry.test.ts` — `isRawQueueEntry()` normalizes whitespace-only `expectedRepo` to null — AC-1
- `mcp-server/tests/gui/queue/get-queue.test.ts` — `getProjectLedgerStatus()` rejects traversal slug (`../etc`) — AC-2
- `mcp-server/tests/gui/queue/get-queue.test.ts` — `getProjectLedgerStatus()` rejects traversal `expectedRepo` (`../../root`) — AC-2
- `mcp-server/tests/gui/queue/get-queue.test.ts` — `getProjectLedgerStatus()` rejects empty-string slug — AC-2
- `orchestrator/tests/` — `_derive_repo_name()` returns lowercased name for mixed-case input (e.g. `'MyRepo'` → `'myrepo'`) — AC-4
- `mcp-server/tests/gui/project-list.test.ts` — renders link for project with `repository_name` — AC-7
- `mcp-server/tests/gui/project-list.test.ts` — renders read-only cell for project with null `repository_name` — AC-7
- `mcp-server/tests/gui/project-list.test.ts` — populates `ProjectNameCache` with composite key — AC-7
- `mcp-server/tests/gui/project-list.test.ts` — action-menu wrapper has correct `data-repo`/`data-slug` attributes — AC-7
- `mcp-server/tests/gui/project-list.test.ts` — action handler skips when `data-repo` is empty — AC-7
- Full `npm test` in `mcp-server/` — no regressions — AC-3, AC-8
- `pytest` in `orchestrator/` — no regressions — AC-9

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `makeProjectCacheKey()` to GUI utilities section; update `getProjectLedgerStatus()` signature description to note segment validation; remove stale "planned for WP-009/WP-013" note from `ProjectNameCache` description and mark composite-key keying as implemented
- `mcp-server/docs/agents/project-manifest/constraints.md` — Add note under path-validation section: queue-entry `expectedRepo`/`expectedSlug` are validated via `assertSafeSegment()` at the read boundary
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add entry for `tests/gui/project-list.test.ts`; update `validate-entry.test.ts` annotation to reflect new empty-string/whitespace-only normalization test cases; update `validate-entry.ts` annotation to include the empty-string normalization side-effect
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add `_derive_repo_name()` to internal helpers section (if module-private helpers are documented there)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`assertSafeSegment()` rejects valid `expectedRepo` values (e.g., uppercase repo names)** | `_derive_repo_name()` (Step 4) applies `.lower()` before returning, mirroring TypeScript's `deriveRepoName()` in `ledger-root.ts`. The queue's `expectedRepo` is therefore always lowercase and always satisfies `SAFE_SLUG_REGEX`. |
| **Empty-string normalization breaks a Python codepath that writes `""` intentionally** | Review `run_queue.register()` in Python — it receives `repo_name=_repo_name` where `_repo_name` is `name or None` (empty string already becomes `None`). No `""` is written. |
| **`ProjectNameCache` eviction removes entries still visible on screen** | The 200-entry cap is far larger than the visible project count. Eviction only triggers after navigating away from many projects. Breadcrumb fallback (slug extraction) ensures graceful degradation. |
| **jsdom tests are brittle against HTML structure changes** | Tests should assert semantic attributes (`data-repo`, `data-slug`, link `href`) rather than full HTML string equality. |
