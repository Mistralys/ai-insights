/**
 * scripts/tests/agents-overview.test.js
 *
 * Tests for scripts/lib/agents-overview.js, plus static assertions on how
 * scripts/build-personas.js and scripts/cli.js wire it in. The lib tests use
 * temp copies of the output (`outputFile`), never the tracked file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  renderAgentsOverview,
  checkAgentsOverview,
  writeAgentsOverview,
} from '../lib/agents-overview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

describe('agents-overview lib', () => {
  let tmpDir;
  let outputFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-overview-'));
    outputFile = path.join(tmpDir, 'agents-overview.md');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('checkAgentsOverview returns no findings for a fresh copy', () => {
    fs.writeFileSync(outputFile, renderAgentsOverview({ root: ROOT }), 'utf8');
    expect(checkAgentsOverview({ root: ROOT, outputFile })).toEqual([]);
  });

  it('checkAgentsOverview reports a stale or missing file naming it and the regenerate command', () => {
    const missing = checkAgentsOverview({ root: ROOT, outputFile });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('docs/references/agents-overview.md');
    expect(missing[0]).toContain('node scripts/build-personas.js');

    fs.writeFileSync(outputFile, renderAgentsOverview({ root: ROOT }) + '\nstale line\n', 'utf8');
    const stale = checkAgentsOverview({ root: ROOT, outputFile });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('docs/references/agents-overview.md');
    expect(stale[0]).toContain('node scripts/build-personas.js');
  });

  it('checkAgentsOverview ignores a differing Generated date line', () => {
    const rendered = renderAgentsOverview({ root: ROOT });
    fs.writeFileSync(outputFile, rendered.replace(/^> \*\*Generated:\*\* .+$/m, '> **Generated:** 2000-01-01'), 'utf8');
    expect(checkAgentsOverview({ root: ROOT, outputFile })).toEqual([]);
  });

  it('writeAgentsOverview writes a stale or missing file and reports written: true', () => {
    expect(writeAgentsOverview({ root: ROOT, outputFile }).written).toBe(true);
    expect(checkAgentsOverview({ root: ROOT, outputFile })).toEqual([]);

    fs.writeFileSync(outputFile, 'stale\n', 'utf8');
    expect(writeAgentsOverview({ root: ROOT, outputFile }).written).toBe(true);
    expect(checkAgentsOverview({ root: ROOT, outputFile })).toEqual([]);
  });

  it('writeAgentsOverview leaves a file that differs only in its date line byte-identical and reports written: false', () => {
    const rendered = renderAgentsOverview({ root: ROOT });
    const oldDated = rendered.replace(/^> \*\*Generated:\*\* .+$/m, '> **Generated:** 2000-01-01');
    fs.writeFileSync(outputFile, oldDated, 'utf8');

    expect(writeAgentsOverview({ root: ROOT, outputFile }).written).toBe(false);
    expect(fs.readFileSync(outputFile, 'utf8')).toBe(oldDated);
  });
});

describe('build wiring (static source checks)', () => {
  const buildSource = fs.readFileSync(path.join(ROOT, 'scripts', 'build-personas.js'), 'utf8');
  const cliSource = fs.readFileSync(path.join(ROOT, 'scripts', 'cli.js'), 'utf8');

  it('build-personas.js registers an agents-overview check descriptor', () => {
    expect(buildSource).toMatch(/id:\s*'agents-overview'/);
  });

  it('build-personas.js writes the overview before it runs the checks', () => {
    const writeAt = buildSource.indexOf('writeAgentsOverview({');
    const checksAt = buildSource.indexOf('runBuildChecks(checks)');
    expect(writeAt).toBeGreaterThan(-1);
    expect(checksAt).toBeGreaterThan(-1);
    expect(writeAt).toBeLessThan(checksAt);
  });

  it('cmdBuildMaintain no longer invokes generate-agents-overview.js', () => {
    const start = cliSource.indexOf('function cmdBuildMaintain');
    const end = cliSource.indexOf('\nfunction ', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(cliSource.slice(start, end)).not.toContain('generate-agents-overview.js');
  });
});
