/**
 * scripts/tests/publish-locations.test.js
 *
 * COPILOT_HOME handling of the shared deploy-location resolver.
 */

import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';

import {
  getVSCodeAgentsDir,
  getVSCodeSkillsDir,
  getCopilotMcpConfigPath,
  getClaudeCodeSkillsDir,
} from '../publish-locations.js';

describe('publish-locations COPILOT_HOME', () => {
  const original = process.env.COPILOT_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = original;
  });

  it('defaults to ~/.copilot when COPILOT_HOME is unset', () => {
    delete process.env.COPILOT_HOME;
    const home = path.join(os.homedir(), '.copilot');
    expect(getVSCodeAgentsDir()).toBe(path.join(home, 'agents'));
    expect(getVSCodeSkillsDir()).toBe(path.join(home, 'skills'));
    expect(getCopilotMcpConfigPath()).toBe(path.join(home, 'mcp-config.json'));
  });

  it('rebases every Copilot location onto COPILOT_HOME when set', () => {
    process.env.COPILOT_HOME = '/tmp/custom-copilot';
    const home = path.resolve('/tmp/custom-copilot');
    expect(getVSCodeAgentsDir()).toBe(path.join(home, 'agents'));
    expect(getVSCodeSkillsDir()).toBe(path.join(home, 'skills'));
    expect(getCopilotMcpConfigPath()).toBe(path.join(home, 'mcp-config.json'));
  });

  it('ignores a blank COPILOT_HOME', () => {
    process.env.COPILOT_HOME = '  ';
    expect(getVSCodeSkillsDir()).toBe(path.join(os.homedir(), '.copilot', 'skills'));
  });

  it('never rebases Claude Code locations', () => {
    process.env.COPILOT_HOME = '/tmp/custom-copilot';
    expect(getClaudeCodeSkillsDir()).toBe(path.join(os.homedir(), '.claude', 'skills'));
  });
});
