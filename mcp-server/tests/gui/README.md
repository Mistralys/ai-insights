# GUI Test Suite — `tests/gui/`

This directory contains tests for the MCP Server Dashboard GUI: both server-side
handlers (`api.ts`, `orchestrator-manager.ts`, etc.) and browser-side view scripts
(`public/views/*.js`, `public/js/orchestrator-widgets.js`).

---

## Browser-Side View Tests

View tests use `@vitest-environment jsdom` and load frontend JavaScript files
directly via `node:fs` + `node:vm` rather than a real browser. This gives
deterministic, fast tests without Playwright overhead while still exercising the
DOM rendering logic.

### Shared Setup File — `setup-gui-globals.ts`

`mcp-server/vitest.config.ts` registers `tests/gui/setup-gui-globals.ts` as a
`setupFiles` entry. This file runs automatically **before every test file** and:

1. Loads `utils.js` into `globalThis` (provides `escapeHtml`, `formatDate`,
   `showLoading`, `showError`, `statusBadge`, `breadcrumb`, `ProjectNameCache`, …).
2. Loads `components.js` into `globalThis` (provides the `UI` namespace — `UI.badge`,
   `UI.banner`, `UI.emptyState`, `UI.card`, `UI.filterBar`).
3. Installs a `localStorage` stub on the Node `global` so that view scripts calling
   `localStorage.getItem/setItem` inside `vm.runInThisContext` don't throw.

The setup file is guarded by `typeof document !== 'undefined'`, so it is a no-op for
server-side tests that run in the default Node environment.

> **`localStorage` stub limitations:** The stub implements `getItem`, `setItem`,
> `removeItem`, and `clear` only. It does **not** implement `key()`, `length`, or
> `storage` events. If a view script begins iterating `localStorage.length` or
> listening for `StorageEvent`, the stub must be extended (or replaced with jsdom's
> built-in `window.localStorage`). Server-side test files that run in the Node
> environment are unaffected — the stub is only installed when `document` exists.

> **`showError()` delegates to `UI.banner()`:** Since WP-2 rework, `showError()`
> in `utils.js` calls `UI.banner('error', message)` and therefore emits
> `<p class="error-banner">…</p>`. Tests that need to intercept `showError` should
> override it with a `vi.fn()` spy in their own `beforeAll` (after the setup file
> has loaded `utils.js`).

### Script Loading Order — Per-Test Pattern

Each test file only needs to load its **view-specific** scripts in `beforeAll`.
`utils.js` and `components.js` are already loaded by the shared setup file — do not
re-load them.

```typescript
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import vm               from 'node:vm';

const publicDir = join(__dirname, '../../gui/public');
// utils.js and components.js are loaded by setup-gui-globals.ts — omit them here.
const myViewJs  = readFileSync(join(publicDir, 'views/my-view.js'), 'utf-8');

beforeAll(() => {
  // Set any view-specific stubs or overrides first, then load the view script.
  vm.runInThisContext(myViewJs);
});
```

**⚠️ Do not re-load `utils.js` or `components.js`.** The setup file already loads
them once per test file. Duplicate `vm.runInThisContext` calls are harmless but
wasteful.

### Dependency Graph

```
utils.js            → defines escapeHtml, formatDate, breadcrumb, statusBadge,
                      showLoading, showError (→ UI.banner), etc.
components.js       → defines UI (badge, banner, emptyState, card, filterBar);
                      depends on escapeHtml from utils.js
api-client.js       → defines API; depends on nothing (uses fetch)
orchestrator-widgets.js → defines OrchestratorWidgets; depends on escapeHtml, UI
views/*.js          → depend on utils.js + components.js; some also need API / OrchestratorWidgets
```

### TypeScript Global Declarations

View scripts write to `globalThis` via IIFE assignments. TypeScript needs matching
`declare global` entries so the test file can reference these names without type errors:

```typescript
declare global {
  // eslint-disable-next-line no-var
  var UI: {
    badge:      (type: string, label: string, opts?: { attrs?: Record<string, string> }) => string;
    banner:     (type: string, message: string) => string;
    emptyState: (message: string) => string;
  };
  // eslint-disable-next-line no-var
  var escapeHtml: (s: any) => string;
  // ... declare other globals consumed by the view under test
}
```

### Examples

The following test files demonstrate the complete pattern (script loading + type
declarations + `beforeAll` setup + jsdom helpers):

| Test file | View exercised |
|-----------|---------------|
| `client-rendering.test.ts` | `views/work-package.js`, `views/project-detail.js` |
| `project-list.test.ts` | `views/project-list.js` |
| `orchestrator-view.test.ts` | `views/orchestrator.js` |
| `project-detail-runs.test.ts` | `views/project-detail.js` — Orchestrator Runs section, queue-aware active run |
| `project-detail-resume.test.ts` | `views/project-detail.js` — `showResumeError` helper, Resume Run button |
| `project-detail-poll-modes.test.ts` | `views/project-detail.js` — inline-edit under polling, single-interval invariant, modal/archive under polling |
| `project-detail-auto-update.test.ts` | `views/project-detail.js` (DOM identity + polling invariants) |
| `project-detail-snapshot.test.ts` | `views/project-detail.js` (`_snapshotProjectState`) |
| `project-detail-diff.test.ts` | `views/project-detail.js` (`_diffProjectState`) |
| `dialogue-qa.test.ts` | `views/project-detail.js`, `views/work-package.js` |
| `orchestrator-widgets.test.ts` | `js/orchestrator-widgets.js` |
| `run-log.test.ts` | `views/run-log.js` |

### Shared Test Helpers — Per-File vs. Shared Fixture

All eight `project-detail-*.test.ts` files that exercise `views/project-detail.js` share a single canonical fixture factory
defined in `tests/gui/helpers/make-project.ts` and imported into each test file:

```typescript
import { makeProject } from './helpers/make-project.js';
```

#### `makeProject()` API

```typescript
export interface MakeProjectOpts {
  meta?: Partial<Record<string, unknown>>;  // merged into meta object
  work_packages?: unknown[];                // root-level array
  project_comments?: unknown[];             // root-level array (default: [])
  project_name?: string;                    // root-level string (default: 'Test Project')
  synthesis_generated?: boolean;            // root-level flag
  timing?: unknown;                         // root-level timing field
  server_version?: string | null;           // root-level field (default: null)
  ledger_version?: string | null;           // root-level field (default: null)
}

export function makeProject(opts: MakeProjectOpts = {}): ProjectFixture
```

The factory separates meta-level and root-level overrides explicitly — pass meta
field overrides under the `meta` key, and root-level overrides at the top level:

```typescript
// Override a meta field:
makeProject({ meta: { status: 'COMPLETE' } })

// Override a root-level field:
makeProject({ synthesis_generated: true })
makeProject({ work_packages: [wp1, wp2] })

// Both at once:
makeProject({ meta: { status: 'IN_PROGRESS' }, work_packages: [wp] })
```

Default meta fields: `status: 'IN_PROGRESS'`, `title: 'Test Project'`,
`plan_path: '/some/path'`, `date_created`, `last_updated`.
Default root fields: `work_packages: []`, `project_comments: []`,
`synthesis_generated: false`, `timing: null`, `server_version: null`,
`ledger_version: null`.


### `project-detail` Test File Map

`views/project-detail.js` is exercised by a family of focused test files. Each file
is **self-contained** — it has its own imports, `beforeAll`/`beforeEach` setup, and
`declare global` block — so it can be run in isolation without any cross-file
dependencies. Files that drive the view via the `API` layer include a local
`renderWithAPI` helper (see stub-keys note below).

| File | Feature area | Key describe blocks |
|------|-------------|---------------------|
| `project-detail-runs.test.ts` | Orchestrator Runs section; queue-aware active run (WP-013) | `renderProjectDetail — Orchestrator Runs section`, `queue-aware active run` |
| `project-detail-resume.test.ts` | Resume Run feature (WP-004, WP-005) | `renderProjectDetail — WP-004: showResumeError helper`, `Resume Run button` |
| `project-detail-poll-modes.test.ts` | Polling behaviour (WP-005) | `Inline edit survives data-only poll ticks`, `Single-interval invariant across combined ↔ resume transitions`, `Modal and archive/unarchive remain functional under active polling` |
| `project-detail-poll.test.ts` | `_pollProjectDetail` and `pollController` state machine (WP-003) | `Combined poll registration`, `_pollProjectDetail data-only patches`, `_pollProjectDetail structural re-render`, `_pollProjectDetail interactive-state guard`, `Synthesis auto-reveal`, `Poll state is render-scoped` |
| `project-detail-scroll.test.ts` | Flicker-free DOM patching and scroll preservation (WP-004) | `_orchRunsStructureKey`, `_patchOrchStatusCard`, `renderRunsList scrollTop preservation`, `pollQueue — in-place patch vs. structural rebuild`, `Log preview widget lifecycle`, `Event handlers after in-place status card updates` |
| `project-detail-auto-update.test.ts` | DOM identity + auto-update invariants | _(see file)_ |
| `project-detail-snapshot.test.ts` | `_snapshotProjectState` internals | _(see file)_ |
| `project-detail-diff.test.ts` | `_diffProjectState` internals | _(see file)_ |

> **`renderWithAPI` stub keys:** Each of the four files `*-runs`, `*-resume`,
> `*-poll-modes`, and `*-scroll` contains a **local** `renderWithAPI` helper whose
> `apiStubs` parameter is typed as `Partial<ProjectDetailApiStubs>` — defined in
> `helpers/api-stubs.ts`. Default stub implementations live in the `createApiStubs()`
> factory in that same file. The current stub keys are:
> `getProject`, `getPlanDocument`, `getWorkPackageOverview`, `getProjectHealth`,
> `getRunLogs`, `orchestratorGetQueue`, `getRunMetadata`, `orchestratorStart`.
>
> If a new API method is added to the production `API` object in `api-client.js`
> and consumed by `renderProjectDetail`, **update `helpers/api-stubs.ts` only** —
> add the field to the `ProjectDetailApiStubs` interface and a default to
> `createApiStubs()`. All four files inherit the new key automatically via the
> shared type and factory.

---

## Server-Side Tests

Server-side tests (e.g., `api.test.ts`, `config.test.ts`, `auto-archive.test.ts`) run
in the default Node environment and do not need to load any frontend scripts. They
test TypeScript handlers directly by importing from `../../gui/api.ts` and related
modules.

---

## Running the Suite

```bash
# From mcp-server/
npx vitest run tests/gui/

# With coverage
npx vitest run tests/gui/ --coverage
```
