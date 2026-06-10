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
| `project-detail-runs.test.ts` | `views/project-detail.js` |
| `project-detail-auto-update.test.ts` | `views/project-detail.js` (DOM identity + polling invariants) |
| `project-detail-snapshot.test.ts` | `views/project-detail.js` (`_snapshotProjectState`) |
| `project-detail-diff.test.ts` | `views/project-detail.js` (`_diffProjectState`) |
| `dialogue-qa.test.ts` | `views/project-detail.js`, `views/work-package.js` |
| `orchestrator-widgets.test.ts` | `js/orchestrator-widgets.js` |
| `run-log.test.ts` | `views/run-log.js` |

### Shared Test Helpers — Per-File vs. Shared Fixture

Some view scripts are exercised by more than one test file. When two or more test
files need an identical (or nearly-identical) factory helper, the options are:

**Option A — inline helper per file (current practice)**
Both `project-detail-snapshot.test.ts` and `project-detail-diff.test.ts` define
their own `makeProject` factory. This avoids a shared-module dependency and keeps
each test file self-contained, at the cost of duplicated boilerplate that can drift.

**Option B — shared fixture file**
Extract the helper into `tests/gui/helpers/` (the `helpers/` subdirectory already
exists) and import it from each test file. Example:

```typescript
// tests/gui/helpers/project-detail-fixtures.ts
export function makeProject(overrides: Record<string, unknown> = {}) { … }
export function makeSnapshot(overrides: Partial<Snapshot> = {}) { … }
```

```typescript
// project-detail-snapshot.test.ts
import { makeProject } from './helpers/project-detail-fixtures';
```

**Guidance:** prefer **Option B** (shared fixture) when the same helper is used in
three or more test files, or when the helper is complex enough that keeping it in
sync manually is error-prone. For simple two-file duplication (like the current
`makeProject` case), either approach is acceptable — choose consistency with the
surrounding test file's style.

#### `makeProject()` shape divergence across the project-detail test files

Several `project-detail-*.test.ts` files define a local `makeProject()` helper, but
the helpers are **not identical**. The two main patterns are:

**Escape-hatch pattern** (`project-detail-auto-update.test.ts`):
```typescript
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      // base fields …
      ...(overrides._metaOverrides as Record<string, unknown> ?? {}),
      ...overrides,                    // ← spreads ALL overrides into meta
    },
    work_packages: (overrides.work_packages as unknown[] | undefined) ?? [],
    synthesis_generated: !!(overrides.synthesis_generated),
    ...(overrides._rootOverrides as Record<string, unknown> ?? {}),
  };
}
```
This helper merges the full `overrides` bag into `meta`, which means top-level
sentinel keys (`_metaOverrides`, `_rootOverrides`, `work_packages`,
`synthesis_generated`) also appear as `meta` keys when those overrides are passed.
The runtime is unaffected because `project-detail.js` reads only known keys from
`meta`, but the resulting fixture object does not accurately represent the API shape.
The `_metaOverrides` / `_rootOverrides` escape hatches go unused by any current test.

**Flat spread pattern** (`project-detail-runs.test.ts`):
```typescript
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      // base fields …
      ...overrides,                    // ← flat merge directly into meta
    },
    work_packages: [],
    synthesis_generated: false,
  };
}
```
This is simpler but equally has no separation between meta-level and root-level
overrides.

**What this means for contributors:** when writing new tests across these files,
do not rely on the fixture shape for inference about the real API response structure.
If you need to set a root-level field (e.g. `synthesis_generated: true`), pass it
as an override and verify the fixture builds what you expect. If this helper is
extracted to a shared fixture file in the future, the intent should be to use
separate `metaOverrides` and `rootOverrides` parameters to make the two levels
explicit and eliminate the leakage.

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
