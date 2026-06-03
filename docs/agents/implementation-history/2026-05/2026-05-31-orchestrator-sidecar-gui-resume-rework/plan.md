# Plan — Orchestrator Sidecar & GUI Resume: Synthesis Rework

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.4.0
- Architectural Reviews: none — Plan Architect Reviewer v1.5.0

## Summary

This rework plan addresses all actionable items from the `synthesis.md` generated after the
initial 5-WP implementation of the orchestrator sidecar and GUI resume feature. It closes:

1. **High:** Namespaced `run-metadata` API route parity gap.
2. **Medium:** Missing `api-client.test.ts` coverage for `getRunMetadata()` and 3-arg
   `orchestratorStart()`.
3. **Medium:** Missing jsdom-based resume-button visibility tests.
4. **Medium:** Stale CTX context regeneration.
5. **Low:** Error-banner duplication cleanup in `project-detail.js`.
6. **Low:** Improved `INTERRUPTED` detection robustness in `cli.py`.

Items explicitly deferred (not addressed here):
- Tombstone deprecation (separate plan; requires broader impact analysis).
- `startOrchestrator()` options-object refactor (speculative; no 5th param exists yet).
- UUID_V4 regex extraction (no second use site exists yet).

---

## Architectural Context

### MCP Server GUI Routing (`mcp-server/gui/server.ts`)

The router uses a segment-counting dispatch in `matchRoute()`. All data resources follow a
dual-route pattern:

- **Single-segment:** `GET /api/projects/:slug/<resource>` — used by the frontend SPA.
- **Namespaced:** `GET /api/projects/:repo/:slug/<resource>` — for multi-root workspaces.

Namespaced routes validate both `repo` and `slug` via `SAFE_SLUG_REGEX`, call
`resolveRepoName()` for .meta.json existence check, and pass `repoName` to the handler.
Existing namespaced routes: `plan`, `synthesis`, `health`, `work-packages`, `dialogues`,
`chunks`, `runs`, `archive`, `unarchive`, `complete`. The `run-metadata` resource is the
sole route missing its namespaced counterpart.

### API Client (`mcp-server/gui/public/api-client.js`)

Browser-side object (`globalThis.API`) with methods that call `request()` helper. Tests live
in `mcp-server/tests/gui/api-client.test.ts` using jsdom + `vm.runInThisContext`.

### Resume Button (`mcp-server/gui/public/views/project-detail.js`)

Vanilla JS SPA. The resume button appears in `#orch-resume-cell` when 7 conditions are met.
Error-banner creation is duplicated in both the `.then(else)` and `.catch` branches. Tests
use jsdom in `mcp-server/tests/gui/project-detail-runs.test.ts`.

### Orchestrator INTERRUPTED detection (`orchestrator/src/cli.py`, line 972)

```python
_is_interrupted = any("Interrupted" in e for e in outside_errors) or (
    bool(interrupt_before) and not outside_errors and not _meta_fatal
)
```

All interrupt sources (`Interrupted by signal.`, `Interrupted by user.`,
`Interrupted during MCP server startup.`) share the substring `"Interrupted"`. The secondary
condition uses `interrupt_before` (set by the signal handler). The fragility is that new error
messages not containing that substring would slip through.

---

## Approach / Architecture

1. Add `GET /api/projects/:repo/:slug/run-metadata` to `server.ts` following the exact
   pattern of the adjacent namespaced `health` route (rest.length === 4, rest[3] ===
   'run-metadata', keyword exclusion guards).

2. Add tests for `getRunMetadata()` and `orchestratorStart(planPath, dryRun, threadId)` to
   `api-client.test.ts` following the existing `describe` + `mockFetch` pattern.

3. Add jsdom-based resume-button tests to `project-detail-runs.test.ts`: stub
   `API.getRunMetadata`, verify `#orch-resume-btn` visibility under the 7 condition
   combinations.

4. Extract the duplicated error-banner creation in `project-detail.js` into a local
   `showResumeError(msg)` helper at the top of the resume-button scope.

5. Replace the string-contains check in `cli.py` with a module-level `_interrupted` flag set
   directly by each interrupt source, removing reliance on error-message substring matching.

6. Run `node scripts/cli.js ctx-generate` to refresh `.context/orchestrator/overview.md` (and
   any other stale snapshots).

---

## Rationale

- The namespaced route restores API surface parity. Without it, multi-root workspace users
  cannot retrieve run metadata for projects that share slug names across repos.
- Test coverage for the client methods prevents silent regressions if the fetch URL format
  changes.
- The resume-button tests lock down the 7-condition visibility logic against accidental
  breakage.
- The error-banner dedup is a low-risk one-touch cleanup that reduces copy-paste drift.
- The interrupt-flag approach is more robust than substring matching and requires zero
  behavioral change (all existing sources already set `_is_interrupted` indirectly).

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Namespaced route placement | rest.length === 4 with `rest[3] === 'run-metadata'` | Adding `'run-metadata'` to the `rest[2]` exclusion list of the `:repo/:slug` catch-all only (defensive-only fix) | The catch-all guard already exists but provides no positive routing — clients would get 404. Full route is needed. |
| INTERRUPTED detection | Module-level `_interrupted` flag | Enum return value from signal handler; dedicated Exception class | Flag is simplest; enum requires plumbing through multiple contexts; exception would need try/except around every checkpoint. |
| Error-banner dedup | Local `showResumeError(msg)` function | Shared utility in `utils.js` | The helper is used in exactly one component; extracting further violates locality. |

---

## Pattern Alignment

- **Namespaced route pattern** (`mcp-server/gui/server.ts`): follows the established
  rest.length === 4 / `rest[3] === '<keyword>'` pattern with keyword exclusion guards.
  No departure.
- **API client test pattern** (`mcp-server/tests/gui/api-client.test.ts`): uses `describe` +
  `mockFetch` + `expect(calls[0].url)` assertion style. No departure.
- **jsdom SPA test pattern** (`mcp-server/tests/gui/project-detail-runs.test.ts`): uses
  `renderWithAPI` helper with stub API methods. Will extend the `apiStubs` type to include
  `getRunMetadata`. Minor additive extension, not a departure.
- **Orchestrator result detection** (`orchestrator/src/cli.py`): currently uses
  `outside_errors` list + substring check. The flag approach is a simplification within the
  same module; no new abstraction introduced.

---

## Detailed Steps

### Step 1 — Add namespaced `run-metadata` route

In `mcp-server/gui/server.ts`, add a `GET /api/projects/:repo/:slug/run-metadata` block at
rest.length === 4 in the namespaced routes section (immediately after the namespaced `health`
route block, before `work-packages`). Pattern:

```typescript
// GET /api/projects/:repo/:slug/run-metadata
// rest.length === 4, rest[3] === 'run-metadata'
if (
  method === 'GET' &&
  rest.length === 4 &&
  rest[0] === 'projects' &&
  rest[3] === 'run-metadata' &&
  rest[2] !== 'plan' &&
  rest[2] !== 'synthesis' &&
  rest[2] !== 'health' &&
  rest[2] !== 'work-packages' &&
  rest[2] !== 'dialogues' &&
  rest[2] !== 'chunks' &&
  rest[2] !== 'runs'
) {
  const repoUrlParam = decodeURIComponent(rest[1]!);
  const slug = decodeURIComponent(rest[2]!);
  return async () => {
    if (!SAFE_SLUG_REGEX.test(repoUrlParam) || !SAFE_SLUG_REGEX.test(slug)) {
      throw new ApiError('NOT_FOUND', 'Invalid repo or slug parameter.');
    }
    const repoName = await resolveRepoName(ledgerRoot, repoUrlParam, slug);
    return handleGetRunMetadata(ledgerRoot, slug, repoName);
  };
}
```

### Step 2 — Add `api-client.test.ts` tests

Add two new `describe` blocks:

```typescript
describe('API.getRunMetadata', () => {
  it('calls GET /api/projects/{slug}/run-metadata', ...);
  it('encodes the slug via encodeURIComponent', ...);
});

describe('API.orchestratorStart (3-arg)', () => {
  it('includes resumeThreadId in the body when provided', ...);
  it('omits resumeThreadId when undefined', ...);
});
```

### Step 3 — Add resume-button visibility tests

In `project-detail-runs.test.ts`, extend `renderWithAPI` stubs to include `getRunMetadata`.
Add a new `describe('Resume Run button')` section with tests:

- Shows button when: no active run, status IN_PROGRESS, metadata has thread_id, not dry_run,
  result !== SUCCESS.
- Hides button when: status is COMPLETE.
- Hides button when: status is ARCHIVED.
- Hides button when: getRunMetadata returns null/no thread_id.
- Hides button when: metadata.dry_run is true.
- Hides button when: metadata.result is SUCCESS.
- Hides button when: an active run exists (queue has entry).

### Step 4 — Extract `showResumeError` helper

In `project-detail.js`, inside the resume-button scope (after the `resumeBtn` declaration),
add:

```javascript
function showResumeError(msg) {
  var errEl = document.getElementById('orch-resume-error');
  if (!errEl) {
    errEl = document.createElement('p');
    errEl.id = 'orch-resume-error';
    errEl.className = 'error-banner';
    resumeCell.appendChild(errEl);
  }
  errEl.textContent = msg;
}
```

Replace both duplicated blocks with `showResumeError(...)` calls.

### Step 5 — Improve INTERRUPTED detection in `cli.py`

Introduce a module-scoped `_was_interrupted = False` variable. In each interrupt source (the
`signal_handler` closure and the `KeyboardInterrupt` handler), set `_was_interrupted = True`
in addition to appending to `outside_errors`. Replace line 972:

```python
_is_interrupted = _was_interrupted or (
    bool(interrupt_before) and not outside_errors and not _meta_fatal
)
```

This eliminates the substring match entirely. All three interrupt paths
(`Interrupted by signal.`, `Interrupted by user.`, `Interrupted during MCP server startup.`)
already execute code that can set the flag.

### Step 6 — Regenerate CTX context

Run `node scripts/cli.js ctx-generate` from the workspace root. Verify that
`.context/orchestrator/overview.md` reflects the updated orchestrator README.

---

## Dependencies

- Step 2 depends on Step 1 being complete (the namespaced route must exist before deciding
  whether to extend client tests to cover it — but the client doesn't call the namespaced
  route directly, so implementation order is flexible).
- Step 3 depends on Step 4 (the error-banner helper extracted in Step 4 simplifies the DOM
  structure that Step 3's tests assert against).
- Step 6 depends on all prior steps (regeneration should capture any doc changes).

Suggested execution order: 1 → 4 → 2 → 3 → 5 → 6.

---

## Required Components

### Modified files:
- `mcp-server/gui/server.ts` — new namespaced route (Step 1)
- `mcp-server/gui/public/views/project-detail.js` — extract `showResumeError` (Step 4)
- `mcp-server/tests/gui/api-client.test.ts` — new test describes (Step 2)
- `mcp-server/tests/gui/project-detail-runs.test.ts` — resume button tests (Step 3)
- `orchestrator/src/cli.py` — interrupt flag (Step 5)

### No new files required.

---

## Assumptions

- `handleGetRunMetadata()` already accepts an optional `repoName` parameter (verified:
  signature is `(ledgerRoot, slug, repoName?)` — the handler was implemented to support
  namespaced resolution from the start).
- The `renderWithAPI` helper in `project-detail-runs.test.ts` can be extended to accept
  `getRunMetadata` without breaking existing tests (additive change to the stubs object).
- The CTX generator binary (`ctx`) is available on PATH.

---

## Constraints

- No changes to the Python public API (`orchestrate` CLI arguments or exit codes).
- The `_was_interrupted` flag must be set atomically (no race — Python GIL guarantees this
  for the signal handler).
- Keyword exclusion guards in the namespaced route must include all existing rest[2] keywords
  (per the established pattern).
- Frontend JS must remain ES5-compatible (no arrow functions, `const`/`let`, template
  literals).

---

## Out of Scope

- Tombstone deprecation (requires its own plan with migration path).
- `startOrchestrator()` options-object refactor (no 5th param exists to trigger it).
- UUID_V4 regex extraction (only one use site).
- Namespaced `orchestratorStart` endpoint (the POST endpoint is global, not per-project).
- Updates to `api-surface.md` for the namespaced route (handler signature already documented;
  only the routing registration is new — no manifest update needed per the maintenance rules).

---

## Acceptance Criteria

1. `GET /api/projects/:repo/:slug/run-metadata` returns the same JSON as
   `GET /api/projects/:slug/run-metadata` when called with valid repo/slug parameters.
2. `GET /api/projects/:repo/:slug/run-metadata` returns 404 for unknown repo/slug
   combinations (via `resolveRepoName` existence check).
3. `GET /api/projects/:repo/:slug/run-metadata` returns 404 for path-traversal attempts
   (e.g., `../` in repo or slug segments).
4. `api-client.test.ts` has at least 2 tests covering `API.getRunMetadata()` URL
   construction.
5. `api-client.test.ts` has at least 2 tests covering `API.orchestratorStart()` with and
   without `resumeThreadId`.
6. `project-detail-runs.test.ts` has at least 5 tests covering resume-button show/hide
   conditions.
7. The duplicated error-banner creation in `project-detail.js` is replaced by a single helper
   function; both call sites use it.
8. `orchestrator/src/cli.py` no longer uses `"Interrupted" in e` substring matching for
   result determination.
9. All existing tests pass without modification (regression-free).
10. `.context/orchestrator/overview.md` is regenerated and reflects the current README.

---

## Testing Strategy

- **Unit tests** (Vitest, jsdom): Steps 1–4 are covered by TypeScript/JS tests.
- **Unit tests** (pytest): Step 5 is covered by existing `test_run_metadata.py` — verify the
  INTERRUPTED result is still produced correctly with the flag approach.
- **Integration**: The namespaced route is testable via the existing `api-run-metadata.test.ts`
  pattern (create a temporary ledger directory with `.meta.json`, invoke the route).
- **Regression**: Full test suite run (`npm test` in `mcp-server/`, `pytest` in
  `orchestrator/`) after all changes.

---

## Test Plan

- `mcp-server/tests/gui/api-client.test.ts` — `describe('API.getRunMetadata')`: asserts
  correct URL construction (`/api/projects/{slug}/run-metadata`) and slug encoding. Covers
  AC-4.
- `mcp-server/tests/gui/api-client.test.ts` — `describe('API.orchestratorStart (3-arg)')`:
  asserts `resumeThreadId` is included in request body when provided, omitted when undefined.
  Covers AC-5.
- `mcp-server/tests/gui/project-detail-runs.test.ts` — `describe('Resume Run button')`:
  7 tests covering each show/hide condition. Covers AC-6.
- `mcp-server/tests/gui/api-run-metadata.test.ts` — add 2–3 tests for the namespaced route
  (`GET /api/projects/:repo/:slug/run-metadata`): happy path, unknown repo 404,
  path-traversal 404. Covers AC-1, AC-2, AC-3.
- `orchestrator/tests/test_run_metadata.py` — verify that the `_was_interrupted` flag
  produces `result="INTERRUPTED"` (existing tests may already pass; add one if needed).
  Covers AC-8.

---

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add the namespaced route entry
  in the GUI Server Routes table (one line addition mirroring the existing `health` row).
- `mcp-server/docs/agents/project-manifest/file-tree.md` — no changes (no new files).
- `orchestrator/docs/agents/project-manifest/constraints.md` — update constraint 24 to note
  the flag-based detection (minor wording change).
- `.context/` — fully regenerated in Step 6 (covers all stale snapshots).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Namespaced route shadows another rest.length===4 route** | Keyword exclusion guards explicitly list all existing keywords; test confirms 404 for keyword-named repos. |
| **`showResumeError` extraction breaks existing DOM in edge cases** | The helper produces identical DOM structure to the current inline code; test coverage from Step 3 validates. |
| **Signal handler race with `_was_interrupted` flag** | Python's GIL guarantees atomic boolean assignment; no lock needed. |
| **CTX generation fails (binary not on PATH)** | Non-blocking — manual regeneration can be deferred; acceptance criterion is soft. |
| **Existing `test_run_metadata.py` tests fail after flag change** | The tests exercise the public contract (sidecar file content), not internal detection logic; risk is minimal. Run tests immediately after the change. |
