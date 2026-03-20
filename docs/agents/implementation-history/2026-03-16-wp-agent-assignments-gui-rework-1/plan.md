# Plan: WP Agent Assignments GUI — Post-Synthesis Rework

## Summary

Address the six strategic recommendations and prioritized action items identified in the [synthesis report](../2026-03-16-wp-agent-assignments-gui/synthesis.md) for the pipeline stage visibility feature (v1.12.0). The rework covers: jsdom-based client rendering tests, eliminating a hardcoded stage-list duplication, an XSS defence-in-depth fix, type narrowing for two GUI interfaces, a misleading variable name in the static file server, and a documentation heading update in the project manifest.

## Architectural Context

### Existing modules involved

| File | Role |
|------|------|
| [mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js) | `buildWpDetailBar()` — WP detail pipeline progression bar; `WP_DEFAULT_STAGES` constant (hardcoded duplicate); tooltip with unescaped `rawSt` |
| [mcp-server/gui/public/views/project-detail.js](mcp-server/gui/public/views/project-detail.js) | `buildPipelineTrack()` — project detail WP table pipeline badges |
| [mcp-server/gui/api.ts](mcp-server/gui/api.ts) | `WpPipelineStage` and `WpOverviewEntry` interfaces (lines 1040–1053); `handleGetWpOverview` handler |
| [mcp-server/gui/server.ts](mcp-server/gui/server.ts) | `serveStatic()` — `const resolved = filePath` without `path.resolve()` |
| [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) | `PipelineType` type, `DEFAULT_PIPELINE_STAGES` constant (canonical source) |
| [mcp-server/src/schema/enums.ts](mcp-server/src/schema/enums.ts) | `WorkPackageStatus` type |
| [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) | "**`app.js` structure:**" section heading (line 2011) — stale, should reflect modular layout |
| [mcp-server/tests/gui/](mcp-server/tests/gui/) | Existing test files: `api-reset.test.ts`, `api-wp-overview.test.ts`, `api.test.ts`, `auto-archive.test.ts`, `config.test.ts`, `handoff-config-integration.test.ts` |

### Relevant types already in scope

- `PipelineType` — exported from `mcp-server/src/utils/pipeline-maps.ts` (union of 6 pipeline stage strings)
- `WorkPackageStatus` — exported from `mcp-server/src/schema/enums.ts` (union: `'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED'`)

### Current frontend module layout

The GUI client code is split across multiple files — `app.js` is now a 7-line bootstrap that just wires the router:

| File | Contents |
|------|----------|
| `gui/public/app.js` | Bootstrap only (imports router, starts it) |
| `gui/public/api-client.js` | `API` object — async fetch wrappers for all REST endpoints |
| `gui/public/router.js` | Hash-based `Router` with route dispatch |
| `gui/public/utils.js` | `escapeHtml()`, `formatDate()`, `statusBadge()`, `showLoading()`, `showError()`, etc. |
| `gui/public/theme.js` | Dark/light theme toggle |
| `gui/public/views/project-list.js` | `renderProjectList()` |
| `gui/public/views/project-detail.js` | `renderProjectDetail()`, `buildPipelineTrack()`, `showResetModal()` |
| `gui/public/views/work-package.js` | `renderWorkPackageDetail()`, `buildWpDetailBar()` |
| `gui/public/views/config.js` | `renderConfig()` |
| `gui/public/views/insights.js` | `renderInsights()` |

## Approach / Architecture

Six independent changes, each mapping to one synthesis recommendation. They have no ordering dependencies and can be implemented in parallel or any sequence. The jsdom test WP (step 1) is the highest priority because it covers the blind spot that allowed the mutation bug in the original session.

## Rationale

Each item was flagged in the synthesis as deferred debt, a test gap, or a convention misalignment. Addressing them now — while the context is fresh — prevents silent divergence (stage duplication), hardens XSS defence, improves type safety, and corrects misleading documentation and code.

## Detailed Steps

### Step 1: Add jsdom Unit Tests for Client Rendering Functions (Medium priority)

Create a new test file `mcp-server/tests/gui/client-rendering.test.ts` that exercises `buildWpDetailBar` and `buildPipelineTrack` in a jsdom environment.

**Test cases to cover:**

For `buildWpDetailBar(wp)`:
- All stages pending (no pipelines) → all badges have `stage-pending` class
- Mixed statuses → correct class per stage (`stage-pass`, `stage-fail`, `stage-in-progress`, `stage-pending`)
- Rework count display → `.rework-indicator` badge present with correct count
- `rework_counts` object takes precedence over pipeline-count heuristic
- Empty `pipelines` array → graceful rendering (no crash, all pending)
- Custom `active_pipeline_stages` used instead of `WP_DEFAULT_STAGES`
- Missing `active_pipeline_stages` → falls back to 4-stage default

For `buildPipelineTrack(overviewEntry)`:
- Null/undefined input → returns `'—'`
- Empty `pipeline_stages` array → returns `'—'`
- All stages present → one `.stage-badge` per stage
- Rework indicator rendered only when `rework_count > 0`
- Stage abbreviation uses `STAGE_ABBREV` mapping when available, else first 3 chars uppercased

**Implementation approach:**
- Use Vitest + jsdom environment (`// @vitest-environment jsdom` pragma or per-file config)
- Both `buildWpDetailBar` and `buildPipelineTrack` are plain functions that return HTML strings — they can be tested by parsing the returned HTML string with DOM methods (`document.createElement('div').innerHTML = result`) and asserting on the resulting DOM structure
- The client JS files use `var` declarations and attach to `window` globals — the test file will need to load them via a script evaluation approach (e.g., `eval(readFileSync(...))`) or by extracting the functions. Using `eval` + `readFileSync` is the most pragmatic approach since these are not ES modules
- Provide a minimal `escapeHtml` stub (or load `utils.js`) and a `STAGE_ABBREV` stub in the jsdom global scope before loading the view files

**Dependencies:** `vitest` already supports jsdom environments. No new dev dependency needed (jsdom is bundled with Vitest).

### Step 2: Eliminate `WP_DEFAULT_STAGES` Duplication (Low priority)

**Problem:** `WP_DEFAULT_STAGES` in [mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js) (line 8) is a hardcoded copy of `DEFAULT_PIPELINE_STAGES` from [mcp-server/src/utils/pipeline-maps.ts](mcp-server/src/utils/pipeline-maps.ts) (line 42). If the server-side default changes, the client fallback silently diverges.

**Solution:** Expose the default pipeline stages in the WP detail API response so the client reads from the canonical source.

1. In the `handleGetWorkPackage` handler in [mcp-server/gui/api.ts](mcp-server/gui/api.ts), add a `default_pipeline_stages` field to the response payload. This field should contain the value of `DEFAULT_PIPELINE_STAGES` from `pipeline-maps.ts`. The WP detail endpoint is the right place because `buildWpDetailBar` consumes WP detail data.

2. In [mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js), update `buildWpDetailBar` to accept a second parameter `defaultStages` (or read it from the `wp` object if embedded there). Replace the `WP_DEFAULT_STAGES` reference:
   ```javascript
   var rawStages = (wp.active_pipeline_stages && wp.active_pipeline_stages.length)
     ? wp.active_pipeline_stages
     : (wp.default_pipeline_stages || WP_DEFAULT_STAGES);
   ```
   Keep `WP_DEFAULT_STAGES` as a last-resort fallback for backward compatibility (if the response is from an older server version), but the primary path now reads the server-provided value.

3. Add a test in the existing `mcp-server/tests/gui/api.test.ts` (or the new client-rendering test file) to verify the `default_pipeline_stages` field is present in the WP detail response.

### Step 3: Apply `escapeHtml(rawSt)` in Tooltip (Low priority)

**Problem:** In [mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js), `buildWpDetailBar` line 39:
```javascript
if (rawSt !== 'pending') tooltip += ' — ' + rawSt;
```
`rawSt` is appended without `escapeHtml()`. The value is schema-constrained (always one of `pending`, `in_progress`, `in-progress`, `pass`, `fail`), so there is no current XSS vector, but it is inconsistent with the codebase convention where every dynamic value is escaped.

**Fix:** Change to:
```javascript
if (rawSt !== 'pending') tooltip += ' — ' + escapeHtml(rawSt);
```

One-line change. Include a test case in the new jsdom test file (Step 1) that verifies the tooltip content is escaped.

### Step 4: Narrow `WpPipelineStage.type` and `WpOverviewEntry.status` Types (Low priority)

**Problem:** In [mcp-server/gui/api.ts](mcp-server/gui/api.ts) lines 1040–1053:
- `WpPipelineStage.type` is `string` — should be `PipelineType`
- `WpOverviewEntry.status` is `string` — should be `WorkPackageStatus`

**Fix:**

1. Add imports at the top of `gui/api.ts`:
   ```typescript
   import type { PipelineType } from '../src/utils/pipeline-maps.js';
   import type { WorkPackageStatus } from '../src/schema/enums.js';
   ```
   (`PipelineType` may already be imported — check before adding. `DEFAULT_PIPELINE_STAGES` is already imported from `pipeline-maps.ts` at line 28, so `PipelineType` can be added to that existing import.)

2. Update the interfaces:
   ```typescript
   export interface WpPipelineStage {
     type: PipelineType;    // was: string
     agent: string;
     status: 'pending' | 'in-progress' | 'pass' | 'fail';
     rework_count: number;
   }

   export interface WpOverviewEntry {
     work_package_id: string;
     status: WorkPackageStatus;    // was: string
     assigned_to: string | null;
     dependencies: string[];
     pipeline_stages: WpPipelineStage[];
     acceptance_criteria: { met: number; total: number };
     blocked_by?: { type: string; description: string };
   }
   ```

3. Verify that no downstream TypeScript compilation errors are introduced — the handler already produces values of these narrower types, so the change should be fully backward-compatible at the type level. Run `npx tsc --noEmit` to confirm.

### Step 5: Fix `serveStatic` Resolver Naming (Low priority)

**Problem:** In [mcp-server/gui/server.ts](mcp-server/gui/server.ts), `serveStatic()` contains:
```typescript
const resolved = filePath;
```
The variable name `resolved` implies `path.resolve()` was called, but it was not. The path traversal guard relies on `path.join()`'s normalization of `..` segments — functionally correct, but the variable name is misleading.

**Fix:** Replace the misleading assignment with an actual `path.resolve()` call:
```typescript
const resolved = resolve(filePath);
```

Ensure `resolve` is imported from `node:path` (check existing imports — `join` and `extname` are already imported; add `resolve` to that import).

This makes the traversal guard more robust (resolve fully canonicalizes the path) and eliminates the naming mismatch. Verify the path traversal test (if one exists in `api.test.ts`) still passes, or add one.

### Step 6: Update `api-surface.md` Frontend Section Heading (Low priority)

**Problem:** The "**`app.js` structure:**" heading in [mcp-server/docs/agents/project-manifest/api-surface.md](mcp-server/docs/agents/project-manifest/api-surface.md) (line 2011) attributes all frontend function descriptions to `app.js`, but `app.js` is now a 7-line bootstrap. The actual logic lives in:
- `api-client.js` — `API` fetch wrappers
- `router.js` — `Router` hash dispatch
- `utils.js` — `escapeHtml()`, `formatDate()`, etc.
- `views/project-list.js` — `renderProjectList()`
- `views/project-detail.js` — `renderProjectDetail()`, `buildPipelineTrack()`, `showResetModal()`
- `views/work-package.js` — `renderWorkPackageDetail()`, `buildWpDetailBar()`
- `views/config.js` — `renderConfig()`
- `views/insights.js` — `renderInsights()`

**Fix:** Replace the heading and re-attribute each function to its actual module file. Update the file table at the top of the GUI section to list each file. This is a documentation-only change.

The existing descriptions are accurate and well-written — they just need to be moved under the correct file attribution. The recommended new structure:

```markdown
**`app.js`** — Bootstrap module; imports router and starts it. No business logic.

**`api-client.js`** — `API` object with async fetch wrappers for all 14 REST endpoints...

**`router.js`** — Hash-based `Router`; routes: ...

**`utils.js`** — Shared utilities: `escapeHtml()`, `formatDate()`, `statusBadge()`, ...

**`views/project-list.js`** — `renderProjectList(app)`: ...

**`views/project-detail.js`** — `renderProjectDetail(app, slug)`: ... `buildPipelineTrack(overviewEntry)`: ... `showResetModal(slug, diagnosis)`: ...

**`views/work-package.js`** — `renderWorkPackageDetail(app, slug, wpId)`: ... `buildWpDetailBar(wp)`: ...

**`views/config.js`** — `renderConfig(app)`: ...

**`views/insights.js`** — `renderInsights(app)`: ...
```

Also update the file table earlier in the section (around line 1926) to list all frontend files instead of only `app.js`.

## Dependencies

- No new npm dependencies required. Vitest already includes jsdom support.
- Steps are independent — no ordering dependency between them.

## Required Components

| Component | Action | WP Scope |
|-----------|--------|----------|
| `mcp-server/tests/gui/client-rendering.test.ts` | **New file** — jsdom unit tests for `buildWpDetailBar` and `buildPipelineTrack` | Step 1 |
| `mcp-server/gui/api.ts` | Edit — add `default_pipeline_stages` to WP detail response; narrow `WpPipelineStage.type` and `WpOverviewEntry.status` types | Steps 2, 4 |
| `mcp-server/gui/public/views/work-package.js` | Edit — use server-provided default stages; apply `escapeHtml(rawSt)` | Steps 2, 3 |
| `mcp-server/gui/server.ts` | Edit — replace `const resolved = filePath` with `const resolved = resolve(filePath)` | Step 5 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Edit — replace "app.js structure" heading; re-attribute functions to actual files | Step 6 |

## Assumptions

- The existing jsdom support in Vitest works without additional configuration for evaluating plain `var`-declared JS files  
- The path traversal guard in `serveStatic` is currently functional (only the variable name is misleading) — adding `resolve()` is a hardening measure, not a bugfix
- The `default_pipeline_stages` field in the WP detail API response is additive and backward-compatible

## Constraints

- Do not change any existing API response shapes in a breaking way — additive fields only
- Client JS must remain ES5-compatible (no arrow functions, no `const`/`let`, no template literals) per existing codebase conventions
- XSS escaping convention: every dynamic value passed to HTML must go through `escapeHtml()`

## Out of Scope

- Consolidating `.insights-filters` and `.filter-bar` CSS classes (noted as separate debt in api-surface.md)
- Adding a dedicated `/api/config` endpoint (the WP detail response embedding was chosen as the simpler path)
- Refactoring the client JS files to ES modules
- Updating the file table in `file-tree.md` (already reflects the current modular layout per the v1.12.0 docs update)

## Acceptance Criteria

1. **jsdom tests pass:** `npx vitest run tests/gui/client-rendering.test.ts` passes with ≥12 test cases covering `buildWpDetailBar` and `buildPipelineTrack`
2. **Stage duplication eliminated:** `buildWpDetailBar` reads default stages from the server-provided `default_pipeline_stages` field when available; `WP_DEFAULT_STAGES` remains as last-resort fallback only
3. **XSS consistency:** `rawSt` in the `buildWpDetailBar` tooltip is wrapped in `escapeHtml()`
4. **Type narrowing compiles:** `npx tsc --noEmit` passes with `WpPipelineStage.type` as `PipelineType` and `WpOverviewEntry.status` as `WorkPackageStatus`
5. **Path resolution correct:** `serveStatic` uses `resolve(filePath)` and the path traversal security check still prevents `..` escapes
6. **Documentation accurate:** api-surface.md frontend section attributes each function to its actual module file; no reference to "app.js structure" as a catch-all heading
7. **All existing tests pass:** `npx vitest run` shows zero regressions

## Testing Strategy

| Step | Test Approach |
|------|---------------|
| 1 (jsdom tests) | New test file with ≥12 cases; Vitest jsdom environment; DOM assertion on rendered HTML strings |
| 2 (default stages) | Existing `api-wp-overview.test.ts` or `api.test.ts` extended to verify `default_pipeline_stages` in WP detail response; jsdom test verifies fallback chain |
| 3 (escapeHtml) | jsdom test case verifies tooltip attribute contains escaped value |
| 4 (type narrowing) | `tsc --noEmit` compile check — no new errors |
| 5 (resolve) | Manual verification + existing/new integration test for path traversal rejection |
| 6 (docs) | Manual review — documentation-only change |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **jsdom environment incompatible with `var`-declared client JS** | Test with `eval(readFileSync(...))` approach first; if it fails, extract functions into a testable wrapper |
| **`resolve()` changes path behavior on Windows vs. POSIX** | `path.resolve()` is cross-platform; `join()` already normalizes separators — `resolve` adds full canonicalization; verify with existing traversal test |
| **Adding `default_pipeline_stages` to WP detail response increases payload** | Array of 4 short strings — negligible; only sent on individual WP detail fetch, not the overview list |
| **Type narrowing introduces downstream compile errors** | The handler already produces values matching the narrower types; run `tsc --noEmit` before committing |
