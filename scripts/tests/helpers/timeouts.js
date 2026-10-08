/**
 * scripts/tests/helpers/timeouts.js
 *
 * Shared timeout constant for Vitest suites whose tests (or the library code
 * they exercise) spawn a real child process — `spawnSync`/`execFileSync` to
 * run a script or CLI, a `git` invocation via scripts/lib/store-commands.js,
 * etc. Vitest's default per-test timeout is 5000 ms, which is comfortable
 * for pure-unit suites but has intermittently timed out these
 * subprocess-spawning suites under parallel test-file load.
 *
 * Applied as the suite-level `timeout` option on a `describe()` block's own
 * tests, e.g.:
 *
 *   describe('my-subprocess-suite', () => {
 *     // ...
 *   }, SUBPROCESS_TEST_TIMEOUT_MS);
 *
 * Deliberately not folded into the global `testTimeout` in
 * `vitest.config.ts`: raising the global default would also hide genuine
 * hangs in the many pure-unit suites that never spawn a subprocess. This
 * file is not itself a `*.test.*` module, so it is never picked up by
 * Vitest's `include` glob — it is a plain helper, imported by the suites
 * that need it.
 */

export const SUBPROCESS_TEST_TIMEOUT_MS = 30_000;
