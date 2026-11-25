#!/usr/bin/env node
/**
 * scripts/ai-insights-browser.js
 *
 * Global shim behind the stable `ai-insights-browser` command (a `bin` entry
 * of the workspace root package.json, registered by `npm link`). It forwards
 * every argument to the Playwright CLI installed under tools/browser/, so
 * agents get one predictable command that is independent of any global
 * Playwright or `playwright-cli` install.
 *
 *   ai-insights-browser open https://example.com
 *   ai-insights-browser snapshot
 *   ai-insights-browser --help
 */

import { spawnSync } from 'child_process';
import { getBrowserCliEntry, BROWSER_COMMAND } from './lib/browser-tool.js';

const entry = getBrowserCliEntry();
if (!entry) {
  console.error(
    `${BROWSER_COMMAND}: the Playwright CLI is not installed in the AI Insights workspace.\n` +
    'Install it with: ai-insights setup --components browser'
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(`${BROWSER_COMMAND}: failed to start the Playwright CLI: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
