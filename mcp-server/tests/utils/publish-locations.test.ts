import { describe, it, expect, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getVSCodeAgentsDir } from '../../src/utils/publish-locations.js';

describe('getVSCodeAgentsDir', () => {
  const original = process.env.COPILOT_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = original;
  });

  it('resolves to ~/.copilot/agents', () => {
    delete process.env.COPILOT_HOME;
    expect(getVSCodeAgentsDir()).toBe(join(homedir(), '.copilot', 'agents'));
  });

  it('is rebased onto COPILOT_HOME when set', () => {
    process.env.COPILOT_HOME = '/tmp/custom-copilot';
    expect(getVSCodeAgentsDir()).toBe(join(resolve('/tmp/custom-copilot'), 'agents'));
  });
});
