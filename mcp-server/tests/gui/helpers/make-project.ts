/**
 * Shared test fixture factory: makeProject
 *
 * ## Purpose
 * Provides a reusable factory that creates a minimal valid project API response
 * fixture for GUI tests exercising `views/project-detail.js`. Replaces the
 * independent and diverged local `makeProject()` definitions that previously
 * existed across the `project-detail-*.test.ts` files.
 *
 * ## API
 *
 * ```ts
 * makeProject({
 *   meta?:                Partial<Record<string, unknown>>;  // merged into meta
 *   work_packages?:       unknown[];
 *   synthesis_generated?: boolean;
 *   timing?:              unknown;
 *   project_comments?:    unknown[];
 *   project_name?:        string;
 *   server_version?:      string | null;
 *   ledger_version?:      string | null;
 * })
 * ```
 *
 * The `meta` key overrides individual properties of the `meta` sub-object.
 * All other named keys map directly to root-level fields of the returned fixture.
 *
 * This clean separation avoids the leakage of root-level sentinel keys
 * (e.g. `synthesis_generated`, `_metaOverrides`) into the `meta` object that
 * was present in the old flat-override implementations.
 *
 * ## Usage
 *
 * ```ts
 * import { makeProject } from './helpers/make-project.js';
 *
 * makeProject()                                            // defaults only
 * makeProject({ meta: { status: 'COMPLETE' } })           // override meta field
 * makeProject({ work_packages: [wp] })                    // override root field
 * makeProject({ synthesis_generated: true })              // override root field
 * makeProject({ meta: { runner: 'orchestrator' } })       // override meta field
 * makeProject({ meta: { status: 'IN_PROGRESS',
 *                        plan_path: '/my/path' } })        // multiple meta fields
 * ```
 *
 * ## Type safety
 * `MakeProjectOpts` declares explicit optional fields for every root-level key
 * returned by the factory. TypeScript will catch root-level key typos at compile
 * time (e.g. `makeProject({ statues: 'COMPLETE' })` is a type error). All fields
 * are fully typed — no index signature escape hatch.
 *
 * ## Convention contract
 * Every GUI test that needs a minimal project fixture SHOULD use this shared
 * helper rather than defining a local `makeProject()`. The `create-namespaced-project.ts`
 * helper covers a different scenario: namespaced storage layout with real on-disk
 * LedgerStore fixtures. Use `makeProject()` for jsdom view tests; use
 * `createNamespacedProject()` for storage/handler integration tests.
 */

export interface MakeProjectOpts {
  /** Partial overrides applied to the `meta` sub-object. */
  meta?: Partial<Record<string, unknown>>;
  /** Root-level `work_packages` array (default: `[]`). */
  work_packages?: unknown[];
  /** Root-level `project_comments` array (default: `[]`). */
  project_comments?: unknown[];
  /** Root-level `project_name` string (default: `'Test Project'`). */
  project_name?: string;
  /** Root-level `synthesis_generated` flag (default: `false`). */
  synthesis_generated?: boolean;
  /** Root-level `timing` field (default: `null`). */
  timing?: unknown;
  /** Root-level `server_version` field (default: `null`). */
  server_version?: string | null;
  /** Root-level `ledger_version` field (default: `null`). */
  ledger_version?: string | null;
}

/**
 * Returns a minimal valid project API response fixture.
 *
 * @param opts - Structured opts separating meta overrides from root overrides.
 */
export function makeProject(opts: MakeProjectOpts = {}) {
  const {
    meta: metaOverrides = {},
    work_packages,
    project_comments,
    project_name,
    synthesis_generated,
    timing,
    server_version,
    ledger_version,
  } = opts;

  return {
    meta: {
      status: 'IN_PROGRESS',
      title: 'Test Project',
      plan_path: '/some/path',
      date_created: '2026-01-01T00:00:00Z',
      last_updated: '2026-01-01T00:00:00Z',
      ...metaOverrides,
    },
    work_packages: work_packages ?? [],
    project_comments: project_comments ?? [],
    project_name: project_name ?? 'Test Project',
    timing: timing ?? null,
    server_version: server_version ?? null,
    ledger_version: ledger_version ?? null,
    synthesis_generated: synthesis_generated ?? false,
  };
}
