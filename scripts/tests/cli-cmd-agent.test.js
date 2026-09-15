/**
 * scripts/tests/cli-cmd-agent.test.js
 *
 * Regression test for the cwd-forcing bug fixed by the
 * 2026-09-15-agent-launcher-cwd-fix plan.
 *
 * scripts/cli.js's cmdX delegates are not exported (the file invokes
 * createMenu(...) unconditionally at module top level, with no run-guard —
 * see scripts/tests/launch-agent.test.js for the analogous constraint on
 * scripts/launch-agent.js's main()). Regression coverage here is therefore
 * a static source-text assertion against the relevant function bodies,
 * rather than an imported/executed unit test.
 *
 * Acceptance Criteria verified:
 *   AC-04: scripts/cli.js's cmdAgent passes { cwd: getOriginalCwd() } to
 *          runScript(), in place of { cwd: WORKSPACE_ROOT }.
 *   AC-05: scripts/launch-agent.js's spawn('claude', ...) call explicitly
 *          sets cwd: getOriginalCwd().
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractFunctionBody(source, functionSignaturePattern) {
  const match = source.match(functionSignaturePattern);
  if (!match) {
    throw new Error(`Could not locate a function matching ${functionSignaturePattern} in source text.`);
  }

  const startIndex = match.index + match[0].length - 1; // position of the opening '{'
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  throw new Error('Could not find a matching closing brace for the extracted function.');
}

describe('scripts/cli.js cmdAgent()', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
  const cmdAgentBody = extractFunctionBody(cliSource, /function cmdAgent\([^)]*\)\s*\{/);

  it('uses getOriginalCwd() to source the runScript() cwd option', () => {
    expect(cmdAgentBody).toContain('getOriginalCwd()');
  });

  it('no longer forces cwd to WORKSPACE_ROOT', () => {
    expect(cmdAgentBody).not.toContain('WORKSPACE_ROOT');
  });

  it('still delegates to launch-agent.js via runScript()', () => {
    expect(cmdAgentBody).toContain('runScript(');
    expect(cmdAgentBody).toContain('launch-agent.js');
  });

  it('imports getOriginalCwd from the shared accessor module', () => {
    expect(cliSource).toMatch(/import\s*\{\s*getOriginalCwd\s*\}\s*from\s*['"]\.\/lib\/original-cwd\.js['"]/);
  });
});

describe('scripts/launch-agent.js spawn(\'claude\', ...) call', () => {
  const launchAgentSource = fs.readFileSync(path.join(__dirname, '..', 'launch-agent.js'), 'utf8');
  const mainBody = extractFunctionBody(launchAgentSource, /async function main\(\)\s*\{/);

  it('explicitly sets cwd via getOriginalCwd() on the spawn() call', () => {
    const spawnCallIndex = mainBody.indexOf("spawn('claude'");
    expect(spawnCallIndex).toBeGreaterThan(-1);

    const spawnCallEnd = mainBody.indexOf(');', spawnCallIndex);
    const spawnCallText = mainBody.slice(spawnCallIndex, spawnCallEnd);

    expect(spawnCallText).toContain('getOriginalCwd()');
  });

  it('imports getOriginalCwd from the shared accessor module', () => {
    expect(launchAgentSource).toMatch(/import\s*\{\s*getOriginalCwd\s*\}\s*from\s*['"]\.\/lib\/original-cwd\.js['"]/);
  });
});
