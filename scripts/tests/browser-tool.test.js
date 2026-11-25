/**
 * scripts/tests/browser-tool.test.js
 *
 * Unit tests for scripts/lib/browser-tool.js and the shim entry declared in
 * the workspace root package.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import {
  BROWSER_COMMAND,
  getBrowserCliEntry,
  isBrowserToolInstalled,
  isBrowserShimOnPath,
  areBrowsersInstalled,
} from '../lib/browser-tool.js';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-tool-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function fakeInstall(dir, bin = { 'playwright-cli': 'cli.js' }, writeEntry = true) {
  const pkgDir = path.join(dir, 'node_modules', '@playwright', 'cli');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@playwright/cli', bin }));
  if (writeEntry) fs.writeFileSync(path.join(pkgDir, 'cli.js'), '');
  return pkgDir;
}

describe('getBrowserCliEntry / isBrowserToolInstalled', () => {
  it('returns null when nothing is installed', () => {
    expect(getBrowserCliEntry(tmp)).toBeNull();
    expect(isBrowserToolInstalled(tmp)).toBe(false);
  });

  it('resolves the entry script from the package bin field', () => {
    const pkgDir = fakeInstall(tmp);
    expect(getBrowserCliEntry(tmp)).toBe(path.join(pkgDir, 'cli.js'));
    expect(isBrowserToolInstalled(tmp)).toBe(true);
  });

  it('accepts a string bin field', () => {
    const pkgDir = fakeInstall(tmp, 'cli.js');
    expect(getBrowserCliEntry(tmp)).toBe(path.join(pkgDir, 'cli.js'));
  });

  it('returns null when the declared entry file is missing', () => {
    fakeInstall(tmp, { 'playwright-cli': 'cli.js' }, false);
    expect(getBrowserCliEntry(tmp)).toBeNull();
  });
});

describe('isBrowserShimOnPath', () => {
  it('finds the command in a PATH directory', () => {
    const file = process.platform === 'win32' ? `${BROWSER_COMMAND}.cmd` : BROWSER_COMMAND;
    fs.writeFileSync(path.join(tmp, file), '');
    expect(isBrowserShimOnPath({ pathEnv: tmp, pathExt: '.CMD' })).toBe(true);
  });

  it('is false when the command is absent from PATH', () => {
    expect(isBrowserShimOnPath({ pathEnv: tmp, pathExt: '.CMD' })).toBe(false);
  });

  it('is false for an empty PATH', () => {
    expect(isBrowserShimOnPath({ pathEnv: '' })).toBe(false);
  });
});

describe('areBrowsersInstalled', () => {
  it('detects a chromium build in PLAYWRIGHT_BROWSERS_PATH', () => {
    fs.mkdirSync(path.join(tmp, 'chromium-1234'));
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: tmp } })).toBe(true);
  });

  it('ignores non-chromium builds', () => {
    fs.mkdirSync(path.join(tmp, 'firefox-1234'));
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: tmp } })).toBe(false);
  });

  it('is false when the browsers directory does not exist', () => {
    expect(areBrowsersInstalled({ env: { PLAYWRIGHT_BROWSERS_PATH: path.join(tmp, 'nope') } })).toBe(false);
  });
});

describe('global command registration', () => {
  it('declares the shim as a bin entry of the workspace package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin[BROWSER_COMMAND]).toBe('./scripts/ai-insights-browser.js');
    expect(fs.existsSync(path.join(WORKSPACE_ROOT, 'scripts', 'ai-insights-browser.js'))).toBe(true);
  });

  it('keeps the tool dependency in tools/browser, not in the root package', () => {
    const tool = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'tools', 'browser', 'package.json'), 'utf8'));
    expect(tool.dependencies).toHaveProperty('@playwright/cli');
    const root = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
    expect(root.dependencies ?? {}).not.toHaveProperty('@playwright/cli');
  });
});
