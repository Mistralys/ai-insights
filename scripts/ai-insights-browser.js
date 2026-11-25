#!/usr/bin/env node
/**
 * scripts/ai-insights-browser.js
 *
 * Global shim behind the stable `ai-insights-browser` command (a `bin` entry
 * of the workspace root package.json, registered by `npm link`). It forwards
 * the arguments to the Playwright CLI installed under tools/browser/, so
 * agents get one predictable command that is independent of any global
 * Playwright or `playwright-cli` install.
 *
 * Before forwarding it applies guards and defaults (prepareBrowserInvocation()
 * in scripts/lib/browser-tool.js):
 *  - a named session is required (`-s=NAME`, `--session NAME`,
 *    PLAYWRIGHT_CLI_SESSION, or the bound browser name of `attach <name>`);
 *    `-s=default` opts into the shared session;
 *  - PLAYWRIGHT_MCP_OUTPUT_DIR defaults to {os.tmpdir()}/ai-insights-browser/{session};
 *  - PLAYWRIGHT_MCP_FILE_PATHS defaults to "absolute", so reported files are absolute paths;
 *  - `close-all` / `kill-all` need `--force` (stripped before forwarding).
 * Output streams through unchanged, except the global help, which is buffered
 * so its `Agent skill:` path can be made absolute (absolutizeHelpOutput()).
 *
 *   ai-insights-browser -s=my-task open https://example.com
 *   ai-insights-browser -s=my-task snapshot
 *   ai-insights-browser --help
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import {
  getBrowserCliEntry, prepareBrowserInvocation, absolutizeHelpOutput, BROWSER_COMMAND,
} from './lib/browser-tool.js';

const invocation = prepareBrowserInvocation({ argv: process.argv.slice(2) });
if (!invocation.ok) {
  console.error(invocation.message);
  process.exit(1);
}

const entry = getBrowserCliEntry();
if (!entry) {
  console.error(
    `${BROWSER_COMMAND}: the Playwright CLI is not installed in the AI Insights workspace.\n` +
    'Install it with: ai-insights setup --components browser'
  );
  process.exit(1);
}

try {
  fs.mkdirSync(invocation.outputDir, { recursive: true });
} catch (err) {
  // Playwright creates the directory itself when it writes; only warn.
  console.error(`${BROWSER_COMMAND}: could not create output directory ${invocation.outputDir}: ${err.message}`);
}

// Global help is short and printed at once, so it is buffered for the
// `Agent skill:` rewrite; every other command streams straight through.
const stdout = invocation.rewriteHelp ? 'pipe' : 'inherit';
const result = spawnSync(process.execPath, [entry, ...invocation.args], {
  stdio: ['inherit', stdout, 'inherit'],
  env: invocation.env,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (result.error) {
  console.error(`${BROWSER_COMMAND}: failed to start the Playwright CLI: ${result.error.message}`);
  process.exit(1);
}
const status = result.status ?? 1;
if (invocation.rewriteHelp && result.stdout) {
  // Exit only once the write has flushed: pipe writes can be asynchronous.
  process.stdout.write(absolutizeHelpOutput(result.stdout), () => process.exit(status));
} else {
  process.exit(status);
}
