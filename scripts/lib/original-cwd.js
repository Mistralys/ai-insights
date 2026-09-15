/**
 * scripts/lib/original-cwd.js
 *
 * Shared accessor for the invoking terminal's working directory.
 *
 * `process.cwd()` is captured once, at module-load time -- the earliest
 * point in any `ai-insights` process's lifetime, before any command logic
 * runs and before any intermediate child process could change it. This
 * matters for `ai-insights agent`: `scripts/cli.js`'s `cmdAgent` spawns
 * `scripts/launch-agent.js` as a child process, which in turn spawns
 * `claude --agent <id>` as a further child process. Without an explicit,
 * named value to carry the user's real directory through both hops, it is
 * easy to lose it by copy-pasting a sibling command's `{ cwd: WORKSPACE_ROOT }`
 * pattern (which is correct for every other command, but not for this one --
 * see `scripts/cli.js`'s `cmdAgent`).
 *
 * Consumers:
 *   - `scripts/cli.js` (`cmdAgent`) -- passes `{ cwd: getOriginalCwd() }` to
 *     `runScript()` so the intermediate `launch-agent.js` process starts in
 *     the user's actual invocation directory, not the workspace root.
 *   - `scripts/launch-agent.js` -- passes `{ cwd: getOriginalCwd() }` to its
 *     `spawn('claude', ...)` call, so the launched Claude Code session
 *     explicitly starts in the same directory, rather than relying on an
 *     unlabelled implicit default.
 *
 * This module is a read-only capture-once accessor, not a `chdir`/restore
 * pair -- no code in this repository calls `process.chdir()`, so a restore
 * capability has no current consumer and is not built speculatively.
 */

const ORIGINAL_CWD = process.cwd();

/**
 * Returns the working directory the current process was started from,
 * captured once at module-load time.
 *
 * @returns {string}
 */
export function getOriginalCwd() {
  return ORIGINAL_CWD;
}
