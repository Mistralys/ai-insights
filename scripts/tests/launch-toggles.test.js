/**
 * scripts/tests/launch-toggles.test.js
 *
 * Unit tests for scripts/lib/launch-toggles.js
 *
 * Acceptance Criteria verified:
 *   AC-01: LaunchToggles defaults off, toggle() flips, toClaudeArgs(), unknown id throws.
 *   AC-02: fromArgs() seeds from own/passthrough flags and strips the passthrough flag.
 *   AC-05: activeWarnings() reflects the enabled state.
 *   AC-09: composed argv contains the flag exactly once.
 */

import { describe, it, expect } from 'vitest';
import { LaunchToggles, LAUNCH_TOGGLES } from '../lib/launch-toggles.js';

const FLAG = '--dangerously-skip-permissions';

describe('LaunchToggles', () => {
  it('defaults every toggle to off', () => {
    const t = new LaunchToggles();
    expect(t.isOn('skip-permissions')).toBe(false);
    expect(t.toClaudeArgs()).toEqual([]);
    expect(t.activeWarnings()).toEqual([]);
  });

  it('toggle() flips state and returns the new value', () => {
    const t = new LaunchToggles();
    expect(t.toggle('skip-permissions')).toBe(true);
    expect(t.isOn('skip-permissions')).toBe(true);
    expect(t.toClaudeArgs()).toEqual([FLAG]);
    expect(t.activeWarnings()).toEqual(['Skip permission prompts']);
    expect(t.toggle('skip-permissions')).toBe(false);
    expect(t.toClaudeArgs()).toEqual([]);
  });

  it('throws on an unknown id', () => {
    expect(() => new LaunchToggles().toggle('nope')).toThrow(/Unknown launch toggle/);
  });

  it('rejects unknown enabled ids in the constructor', () => {
    expect(() => new LaunchToggles(LAUNCH_TOGGLES, ['nope'])).toThrow(/Unknown launch toggle/);
  });

  it('exposes the registry as frozen definitions', () => {
    expect(new LaunchToggles().definitions).toBe(LAUNCH_TOGGLES);
    expect(Object.isFrozen(LAUNCH_TOGGLES)).toBe(true);
  });
});

describe('LaunchToggles.fromArgs()', () => {
  it('seeds from the own --skip-permissions flag', () => {
    const { toggles, passthroughArgs } = LaunchToggles.fromArgs(['--skip-permissions'], []);
    expect(toggles.isOn('skip-permissions')).toBe(true);
    expect(passthroughArgs).toEqual([]);
  });

  it('seeds from the passthrough flag and strips every occurrence', () => {
    const pass = ['--verbose', FLAG, '--x', FLAG];
    const { toggles, passthroughArgs } = LaunchToggles.fromArgs([], pass);
    expect(toggles.isOn('skip-permissions')).toBe(true);
    expect(passthroughArgs).toEqual(['--verbose', '--x']);
    expect(pass).toEqual(['--verbose', FLAG, '--x', FLAG]);
  });

  it('does not mutate the own args and leaves the toggle off without seeds', () => {
    const own = ['--filter', 'plan'];
    const { toggles, passthroughArgs } = LaunchToggles.fromArgs(own, ['--verbose']);
    expect(toggles.isOn('skip-permissions')).toBe(false);
    expect(passthroughArgs).toEqual(['--verbose']);
    expect(own).toEqual(['--filter', 'plan']);
  });

  it('composes an argv with the flag exactly once', () => {
    const { toggles, passthroughArgs } = LaunchToggles.fromArgs([], [FLAG, '--verbose']);
    const argv = [...['--agent', 'x'], ...toggles.toClaudeArgs(), ...passthroughArgs];
    expect(argv.filter((a) => a === FLAG)).toHaveLength(1);
    expect(argv).toEqual(['--agent', 'x', FLAG, '--verbose']);
  });
});
