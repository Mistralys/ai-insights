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
 * Before forwarding it enforces three guards (prepareBrowserInvocation() in
 * scripts/lib/browser-tool.js):
 *  - a named session is required (`-s=NAME`, `--session NAME`, or
 *    PLAYWRIGHT_CLI_SESSION); `-s=default` opts into the shared session;
 *  - PLAYWRIGHT_MCP_OUTPUT_DIR defaults to {os.tmpdir()}/ai-insights-browser/{session};
 *  - `close-all` / `kill-all` need `--force` (stripped before forwarding).
 *
 *   ai-insights-browser -s=my-task open https://example.com
 *   ai-insights-browser -s=my-task snapshot
 *   ai-insights-browser --help
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import { getBrowserCliEntry, prepareBrowserInvocation, BROWSER_COMMAND } from './lib/browser-tool.js';

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

const result = spawnSync(process.execPath, [entry, ...invocation.args], { stdio: 'inherit', env: invocation.env });
if (result.error) {
  console.error(`${BROWSER_COMMAND}: failed to start the Playwright CLI: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
