/**
 * scripts/lib/build-checks.js
 *
 * Generic check-runner for scripts/build-personas.js — runs an ordered list
 * of check descriptors, reports their results under a consistent
 * [ERROR]/[WARN] prefix, and resolves a single exit code from the outcome.
 *
 * This replaces the five scattered `process.exit` calls that used to live
 * inline in build-personas.js: previously, any one failing check (or the
 * library CLI itself) skipped every check and post-build step that came
 * after it in file order. A descriptor list run through `runBuildChecks()`
 * always runs every descriptor, in order, regardless of an earlier one's
 * outcome — including one whose `run()` throws or rejects.
 */

/**
 * @typedef {object} CheckDescriptor
 * @property {string} id - stable identifier for the check (used in synthetic-failure messages)
 * @property {string} label - human-readable label printed above its findings
 * @property {'error'|'warn'} severity - default severity for this descriptor's findings
 * @property {() => (string[] | Promise<string[]>)} run - returns an array of finding strings
 *   (empty = no findings); may be async
 */

/**
 * Run every descriptor in `checks`, in order, awaiting async ones. Each
 * descriptor's non-empty result is printed under its `label` with an
 * `[ERROR]` or `[WARN]` prefix per finding (per its declared `severity`).
 *
 * A descriptor whose `run()` throws synchronously or returns a rejected
 * promise is recorded as a single error-severity finding for that
 * descriptor — regardless of its declared `severity` — printed as
 * `[ERROR] <label>: check failed to run: <message>`, counted in
 * `errorCount`, and the loop continues with the next descriptor.
 *
 * @param {CheckDescriptor[]} checks
 * @param {{ log?: (msg: string) => void, warn?: (msg: string) => void, error?: (msg: string) => void }} [io]
 * @returns {Promise<{ errorCount: number, warningCount: number }>}
 */
export async function runBuildChecks(checks, io = {}) {
  const log   = io.log   ?? ((msg) => console.log(msg));
  const warn  = io.warn  ?? ((msg) => console.warn(msg));
  const error = io.error ?? ((msg) => console.error(msg));

  let errorCount = 0;
  let warningCount = 0;

  for (const check of checks) {
    let findings;
    try {
      findings = await check.run();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      error(`[ERROR] ${check.label}: check failed to run: ${message}`);
      errorCount += 1;
      continue;
    }

    if (!findings || findings.length === 0) continue;

    const prefix = check.severity === 'warn' ? '[WARN]' : '[ERROR]';
    const report = check.severity === 'warn' ? warn : error;

    report(`\n${prefix} ${check.label}:\n`);
    for (const finding of findings) {
      report(`  ${finding}`);
    }

    if (check.severity === 'warn') {
      warningCount += findings.length;
    } else {
      errorCount += findings.length;
    }
  }

  return { errorCount, warningCount };
}

/**
 * Resolve the process exit code from the library CLI's own exit status and
 * the aggregated check results.
 *
 * - A non-zero `libraryStatus` always wins — the library CLI itself failed
 *   (e.g. an error-severity validation result, or a crash), which is a
 *   stronger signal than anything the wrapper's own checks found.
 * - Otherwise, `1` when any check reported an error-severity finding (or
 *   failed to run).
 * - Otherwise, `0`.
 *
 * @param {number} libraryStatus - exit status captured from the library CLI invocation
 * @param {{ errorCount: number }} results - the result of `runBuildChecks()`
 * @returns {number}
 */
export function resolveExitCode(libraryStatus, { errorCount }) {
  if (libraryStatus !== 0) return libraryStatus;
  if (errorCount > 0) return 1;
  return 0;
}
