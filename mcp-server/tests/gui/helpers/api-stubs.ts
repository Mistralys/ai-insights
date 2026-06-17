import { makeProject } from './make-project.js';

/**
 * Shared type and factory for `renderWithAPI` stub bags.
 *
 * ## Purpose
 *
 * Four test files (`project-detail-runs`, `project-detail-resume`,
 * `project-detail-poll-modes`, `project-detail-scroll`) each contain a local
 * `renderWithAPI` helper that installs a `globalThis.API` stub and calls
 * `renderProjectDetail`. Previously, each file defined an identical 8-key
 * `apiStubs` parameter type and identical default implementations inline,
 * requiring manual synchronisation.
 *
 * This module centralises the type and defaults so that:
 * - The stub-key inventory has a single source of truth.
 * - Adding a new API method to `api-client.js` consumed by `renderProjectDetail`
 *   requires updating this file only — all four files inherit the new key.
 * - TypeScript catches unknown stub key names at compile time (no index signature
 *   escape hatch).
 *
 * The `renderWithAPI` function body (including wait logic) remains file-local per
 * strategic recommendation #4 from rework-2 (per-file wait logic intentionally
 * diverges: `*-scroll` uses 400 ms + 10 extra micro-task flushes; the rest use
 * 200 ms).
 *
 * ## Stub keys
 *
 * Each field corresponds to a production `API` method consumed by
 * `renderProjectDetail` (see `gui/public/api-client.js`):
 *
 * | Key | Default |
 * |---|---|
 * | `getProject` | `() => Promise.resolve(makeProject())` |
 * | `getPlanDocument` | `() => Promise.reject({ code: 'NOT_FOUND' })` |
 * | `getWorkPackageOverview` | `() => Promise.resolve(null)` |
 * | `getProjectHealth` | `() => Promise.resolve({ work_packages_needing_reset: 0 })` |
 * | `getRunLogs` | `() => Promise.resolve([])` |
 * | `orchestratorGetQueue` | `() => Promise.resolve([])` |
 * | `getRunMetadata` | `() => Promise.reject(new Error('not stubbed'))` |
 * | `orchestratorStart` | `() => Promise.reject(new Error('not stubbed'))` |
 */
export interface ProjectDetailApiStubs {
  /** Returns the project detail payload. Default: `makeProject()`. */
  getProject: () => Promise<unknown>;
  /** Returns the plan document markdown. Default: rejects with `{ code: 'NOT_FOUND' }`. */
  getPlanDocument: () => Promise<unknown>;
  /** Returns the work-package overview array or null. Default: resolves with `null`. */
  getWorkPackageOverview: () => Promise<unknown>;
  /** Returns a project health object. Default: resolves with `{ work_packages_needing_reset: 0 }`. */
  getProjectHealth: () => Promise<unknown>;
  /** Returns the array of orchestrator run log entries. Default: resolves with `[]`. */
  getRunLogs: () => Promise<unknown>;
  /** Returns the orchestrator queue array. Default: resolves with `[]`. */
  orchestratorGetQueue: () => Promise<unknown>;
  /** Returns the run metadata sidecar. Default: rejects with `new Error('not stubbed')`. */
  getRunMetadata: () => Promise<unknown>;
  /** Starts an orchestrator run. Default: rejects with `new Error('not stubbed')`. */
  orchestratorStart: () => Promise<unknown>;
}

/**
 * Returns a complete `ProjectDetailApiStubs` object with sensible defaults,
 * merging caller-supplied overrides via object spread.
 *
 * Usage in a `renderWithAPI` helper:
 *
 * ```ts
 * import { createApiStubs, type ProjectDetailApiStubs } from './helpers/api-stubs.js';
 *
 * async function renderWithAPI(
 *   app: HTMLElement,
 *   repo: string,
 *   slug: string,
 *   apiStubs: Partial<ProjectDetailApiStubs> = {}
 * ) {
 *   (globalThis as Record<string, unknown>)['API'] = createApiStubs(apiStubs);
 *   globalThis.renderProjectDetail(app, repo, slug);
 *   // ... file-specific wait logic
 * }
 * ```
 *
 * @param overrides - Optional partial overrides to merge into the default stubs.
 */
export function createApiStubs(overrides: Partial<ProjectDetailApiStubs> = {}): ProjectDetailApiStubs {
  return {
    getProject:             () => Promise.resolve(makeProject()),
    getPlanDocument:        () => Promise.reject({ code: 'NOT_FOUND' }),
    getWorkPackageOverview: () => Promise.resolve(null),
    getProjectHealth:       () => Promise.resolve({ work_packages_needing_reset: 0 }),
    getRunLogs:             () => Promise.resolve([]),
    orchestratorGetQueue:   () => Promise.resolve([]),
    getRunMetadata:         () => Promise.reject(new Error('not stubbed')),
    orchestratorStart:      () => Promise.reject(new Error('not stubbed')),
    ...overrides,
  };
}
