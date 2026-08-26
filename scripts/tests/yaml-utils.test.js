/**
 * scripts/tests/yaml-utils.test.js
 *
 * Tests for scripts/lib/yaml-utils.js — specifically extractYamlText(), which
 * accepts both block scalars (`key: |`) and inline scalars (`key: value`).
 */

import { describe, it, expect } from 'vitest';
import { extractYamlText } from '../lib/yaml-utils.js';

describe('extractYamlText', () => {
  describe('block scalar form', () => {
    it('reads a single-line block scalar', () => {
      const yaml = 'key_behavior: |\n  Delegates to sub-agents\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Delegates to sub-agents');
    });

    it('preserves newlines in a multi-line block scalar', () => {
      const yaml = 'modes: |\n  Onboard\n  Upgrade\nother: x\n';
      expect(extractYamlText(yaml, 'modes')).toBe('Onboard\nUpgrade');
    });

    it('accepts the strip indicator (|-)', () => {
      const yaml = 'key_behavior: |-\n  Verifies before advancing\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Verifies before advancing');
    });
  });

  describe('inline scalar form', () => {
    it('reads a double-quoted scalar', () => {
      const yaml = 'key_behavior: "Delegates to sub-agents"\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Delegates to sub-agents');
    });

    it('reads a single-quoted scalar', () => {
      const yaml = "key_behavior: 'Delegates to sub-agents'\nother: x\n";
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Delegates to sub-agents');
    });

    it('reads a bare scalar', () => {
      const yaml = 'key_behavior: Delegates to sub-agents\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Delegates to sub-agents');
    });

    it('strips a trailing comment from a bare scalar', () => {
      const yaml = 'key_behavior: Delegates  # needs review\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBe('Delegates');
    });
  });

  describe('empty and absent values', () => {
    it('returns undefined when the key is absent', () => {
      expect(extractYamlText('other: x\n', 'key_behavior')).toBeUndefined();
    });

    it('returns undefined for an empty block scalar rather than the bare indicator', () => {
      const yaml = 'key_behavior: |\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBeUndefined();
    });

    it('returns undefined for an empty quoted scalar', () => {
      const yaml = 'key_behavior: ""\nother: x\n';
      expect(extractYamlText(yaml, 'key_behavior')).toBeUndefined();
    });
  });

  it('does not match a key that merely shares a prefix', () => {
    const yaml = 'key_behavior_notes: "Not this one"\nother: x\n';
    expect(extractYamlText(yaml, 'key_behavior')).toBeUndefined();
  });
});
