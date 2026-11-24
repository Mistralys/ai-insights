/**
 * Hands the console's stdin over to a child process spawned with
 * `stdio: 'inherit'`, so that the parent process stops consuming keystrokes
 * meant for the child.
 *
 * Why this is needed (Windows only):
 *
 * `@mistralys/cli-menu`'s `restoreTerminal()` calls `setRawMode(false)` and
 * then `pause()`. Neither of these actually stops the underlying libuv read:
 *
 * - libuv's `uv_tty_set_mode()` *restarts* an active read in the new mode, so
 *   switching back to cooked mode while reading starts a line-mode read.
 *   On Windows, a line-mode read is a `ReadConsoleW` call parked on a
 *   libuv worker thread — it keeps running even while the event loop is
 *   blocked (e.g. inside `spawnSync()`).
 * - `Readable#pause()` on a `tty.ReadStream` only flips the stream into
 *   paused mode; the handle's `readStop()` is called lazily, once the
 *   internal buffer fills up.
 *
 * The result: the parent's worker thread and the child both read from the
 * same console input buffer, and the parent wins. Arrow keys, typing, Esc
 * and Ctrl+C (which arrives as a plain key while the child is in raw mode)
 * never reach the child — the picker launched from the CLI menu appears
 * frozen. macOS/Linux are unaffected because their TTY reads happen on the
 * (blocked or idle) event loop thread rather than on a worker thread.
 *
 * {@link releaseStdinForChild} stops the handle read explicitly and resets
 * the two "reading" flags Node uses to decide whether a later `resume()`
 * must restart it, so the parent can take stdin back afterwards with the
 * usual `setRawMode(true)` + `resume()` sequence (as cli-menu does).
 */

/**
 * Stop the parent process from reading stdin so an inherited-stdio child
 * receives every keystroke. Safe to call repeatedly and on non-TTY stdin.
 *
 * @param {object} [opts]
 * @param {NodeJS.ReadStream} [opts.stdin=process.stdin] - stream to release (injectable for tests)
 * @param {string} [opts.platform=process.platform] - only `win32` needs the handle-level stop
 * @param {(msg: string) => void} [opts.onError] - receives a diagnostic when the handle refuses to stop
 * @returns {boolean} `true` when an active handle read was stopped
 */
export function releaseStdinForChild(opts = {}) {
  const {
    stdin = process.stdin,
    platform = process.platform,
    onError = (msg) => console.error(msg),
  } = opts;

  if (!stdin) return false;

  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    try {
      stdin.setRawMode(false);
    } catch {
      // A closed/detached console can reject mode changes; nothing to undo.
    }
  }
  if (typeof stdin.pause === 'function') stdin.pause();

  if (platform !== 'win32') return false;

  // Internal Node fields, accessed defensively: `_handle` is the libuv TTY
  // wrap and `_handle.reading` is the flag net.Socket#_read() checks before
  // calling readStart() again.
  const handle = stdin._handle;
  if (!handle || !handle.reading || typeof handle.readStop !== 'function') return false;

  const err = handle.readStop();
  if (err) {
    onError(`[stdin-handoff] Could not stop reading stdin (libuv error ${err}); keyboard input may not reach the child process.`);
    return false;
  }
  handle.reading = false;

  // Readable#read() skips _read() while `reading` is set, which would leave
  // stdin dead on the next resume() because the pending read never completes.
  if (stdin._readableState) {
    try {
      stdin._readableState.reading = false;
    } catch {
      // Older/newer Node versions without a writable flag: resume() may then
      // need a keystroke to wake up, but the child handoff itself succeeded.
    }
  }
  return true;
}
