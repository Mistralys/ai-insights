/**
 * setup-gui-globals.ts — Shared Vitest setup for GUI (jsdom) tests.
 *
 * Loaded via `test.setupFiles` in vitest.config.ts before every test file.
 * Guarded by `typeof document !== 'undefined'` so it is a no-op in the
 * default Node environment used by server-side tests.
 *
 * What this file does (jsdom environment only):
 *   1. Loads `utils.js` into globalThis (escapeHtml, formatDate, showLoading,
 *      showError, statusBadge, ProjectNameCache, breadcrumb, …).
 *   2. Loads `components.js` into globalThis (UI.badge, UI.banner, …).
 *   3. Provides a `localStorage` stub on the Node `global` so that view scripts
 *      executed via `vm.runInThisContext` can call `localStorage.getItem/setItem`
 *      without throwing. (jsdom's `window.localStorage` is invisible to the Node
 *      global scope that vm contexts resolve against.)
 *
 * What this file intentionally does NOT do:
 *   - Load view-specific scripts (project-list.js, run-log.js, etc.) — those
 *     remain in each test file's `beforeAll`.
 *   - Override the real `showLoading`/`showError` implementations — tests that
 *     need spy versions set them in their own `beforeAll`.
 *   - Set up `Router` — each test file provides its own stub or loads router.js.
 */

import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import vm               from 'node:vm';

// Only execute in jsdom environments (test files annotated with
// @vitest-environment jsdom). Server-side tests run in Node and skip this.
if (typeof document !== 'undefined') {
  const publicDir = join(__dirname, '../../gui/public');

  vm.runInThisContext(readFileSync(join(publicDir, 'utils.js'),      'utf-8'));
  vm.runInThisContext(readFileSync(join(publicDir, 'components.js'), 'utf-8'));

  // Provide a localStorage stub on the Node global (not the jsdom window).
  // view scripts that reference `localStorage` as a bare name in
  // `vm.runInThisContext` resolve it against the Node global, not the jsdom
  // window, so `window.localStorage` is invisible to them.
  // Tests that need a fresh stub per-test can overwrite this in their
  // `beforeAll` (e.g. project-list.test.ts).
  if (!(global as Record<string, unknown>)['localStorage']) {
    const store: Record<string, string> = {};
    (global as Record<string, unknown>)['localStorage'] = {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { for (const k in store) delete store[k]; },
    };
  }
}
