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
| `dialogue-qa.test.ts` | `views/project-detail.js`, `views/work-package.js` |
| `orchestrator-widgets.test.ts` | `js/orchestrator-widgets.js` |
| `run-log.test.ts` | `views/run-log.js` |

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
