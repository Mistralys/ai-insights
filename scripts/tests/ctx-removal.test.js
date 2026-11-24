/**
 * scripts/tests/ctx-removal.test.js
 *
 * Guard for the 2026-11-24-remove-ctx-generation plan: CTX Generator usage was
 * removed from this repository. The unmerged `feature-pipeline-adjustments`
 * branch adds new CTX files (scripts/lib/ctx-generate.js and its tests) that
 * Git would merge in without conflict; this test fails if they, or any CTX
 * wiring, return.
 *
 * scripts/cli.js cannot be imported (top-level createMenu(...).run(...)), so
 * the CLI is checked as source text.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('CTX removal guard', () => {
  const cliSource = read('scripts/cli.js');

  it('scripts/cli.js has no ctx-generate command or cmdCtxGenerate', () => {
    for (const needle of ['cmdCtxGenerate', "'ctx-generate'", 'normalize-ctx-paths', "spawnSync('ctx'"]) {
      expect(cliSource, needle).not.toContain(needle);
    }
  });

  it('cmdBuildMaintain does not run CTX', () => {
    const start = cliSource.indexOf('function cmdBuildMaintain');
    const end = cliSource.indexOf('\nfunction ', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(cliSource.slice(start, end)).not.toMatch(/ctx/i);
    const desc = cliSource.match(/id:\s*'build-maintain'[\s\S]*?description:\s*'([^']*)'/);
    expect(desc).not.toBeNull();
    expect(desc[1]).not.toMatch(/CTX/i);
  });

  it('pre-commit hook has no .context warning', () => {
    const hook = read('.githooks/pre-commit');
    expect(hook).not.toContain('.context');
    expect(hook).toContain('build-personas.js --check');
  });

  it('CTX files are absent', () => {
    const paths = [
      'context.yaml',
      'mcp-server/module-context.yaml',
      'personas/module-context.yaml',
      'orchestrator/module-context.yaml',
      'scripts/normalize-ctx-paths.js',
      'scripts/lib/ctx-generate.js',
      'scripts/tests/ctx-generate.test.js',
      'scripts/tests/cli-ctx-generate.test.js',
    ];
    for (const rel of paths) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(false);
    }
  });

  it('no .context rule in .gitattributes', () => {
    const file = path.join(ROOT, '.gitattributes');
    if (!fs.existsSync(file)) return;
    expect(fs.readFileSync(file, 'utf8')).not.toContain('.context');
  });
});
