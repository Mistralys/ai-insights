/**
 * Tests for `src/outputs/strategic-vision.ts` (WP-009).
 *
 * Coverage:
 *   - visionHash(): depends only on the three horizon strings, unaffected
 *     by label/folder_names/last_modified; null vs. empty distinguishability
 *     via the sentinel — AC-07, AC-09
 *   - renderStrategicVision(): deterministic header + body, LF endings, no
 *     trailing whitespace, explicit "not yet authored" text, an all-null
 *     entry still renders a complete file — AC-05, AC-09
 *   - parseGeneratedHeader(): round-trips a rendered file exactly; rejects
 *     text without the exact marker as its first line — AC-05, AC-11
 */

import { describe, it, expect } from 'vitest';
import {
  MARKER,
  parseGeneratedHeader,
  renderStrategicVision,
  renderStrategicVisionBody,
  visionHash,
} from '../../src/outputs/strategic-vision.js';
import type { RepositoryEntry, StrategicVision } from '../../src/schema/repository-registry.js';

function makeEntry(overrides: Partial<RepositoryEntry> = {}): RepositoryEntry {
  return {
    id: 'my-repo',
    label: 'My Repo',
    folder_names: ['my-repo'],
    vision: { short_term: 'Ship v1', mid_term: 'Grow adoption', long_term: 'Become the default' },
    created_at: '2026-01-01T00:00:00.000Z',
    last_modified: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('strategic-vision', () => {
  describe('visionHash()', () => {
    it('is unaffected by label, folder_names, or last_modified', () => {
      const base = makeEntry();
      const changed = makeEntry({
        label: 'A Totally Different Label',
        folder_names: ['other-name', 'yet-another'],
        last_modified: '2030-12-31T23:59:59.999Z',
      });

      expect(visionHash(changed.vision)).toBe(visionHash(base.vision));
    });

    it('changes when a horizon string changes', () => {
      const base = makeEntry();
      const changed = makeEntry({ vision: { ...base.vision, short_term: 'Ship v2' } });

      expect(visionHash(changed.vision)).not.toBe(visionHash(base.vision));
    });

    it('is deterministic for the same vision', () => {
      const vision: StrategicVision = { short_term: 'a', mid_term: 'b', long_term: 'c' };
      expect(visionHash(vision)).toBe(visionHash({ ...vision }));
    });

    it('produces a 64-character lowercase hex digest', () => {
      const hash = visionHash({ short_term: 'a', mid_term: null, long_term: null });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes an all-null vision to a stable, non-empty digest', () => {
      const hash = visionHash({ short_term: null, mid_term: null, long_term: null });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(visionHash({ short_term: null, mid_term: null, long_term: null }));
    });

    it('distinguishes a null horizon from any ordinary string value', () => {
      const withNull = visionHash({ short_term: null, mid_term: 'b', long_term: 'c' });
      const withString = visionHash({ short_term: 'not yet authored', mid_term: 'b', long_term: 'c' });
      expect(withNull).not.toBe(withString);
    });
  });

  describe('renderStrategicVision()', () => {
    it('renders the exact header contract in order', () => {
      const entry = makeEntry();
      const text = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');
      const lines = text.split('\n');

      expect(lines[0]).toBe(MARKER);
      expect(lines[1]).toBe('<!-- repository-id: my-repo -->');
      expect(lines[2]).toBe(`<!-- vision-hash: sha256:${visionHash(entry.vision)} -->`);
      expect(lines[3]).toBe('<!-- generated-at: 2026-09-16T12:00:00.000Z -->');
      expect(lines[4]).toContain('DO NOT EDIT');
      expect(lines[4]).toContain('ai-insights ledger sync');
      expect(lines[4]).toContain('Strategy page');
    });

    it('excludes source-last-modified from the header', () => {
      const text = renderStrategicVision(makeEntry(), '2026-09-16T12:00:00.000Z');
      expect(text).not.toContain('source-last-modified');
    });

    it('uses LF line endings, ends with exactly one trailing newline, and has no trailing whitespace on any line', () => {
      const text = renderStrategicVision(makeEntry(), '2026-09-16T12:00:00.000Z');

      expect(text).not.toContain('\r');
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);

      const lines = text.split('\n');
      for (const line of lines) {
        expect(line).toBe(line.trimEnd());
      }
    });

    it('renders each horizon value verbatim', () => {
      const text = renderStrategicVision(makeEntry(), '2026-09-16T12:00:00.000Z');
      expect(text).toContain('Ship v1');
      expect(text).toContain('Grow adoption');
      expect(text).toContain('Become the default');
    });

    it('renders a null horizon as an explicit "not yet authored" line', () => {
      const entry = makeEntry({ vision: { short_term: null, mid_term: 'Grow adoption', long_term: 'Become the default' } });
      const text = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');

      expect(text).toContain('_Not yet authored._');
    });

    it('renders a complete file for an all-null vision', () => {
      const entry = makeEntry({ vision: { short_term: null, mid_term: null, long_term: null } });
      const text = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');

      expect(text).toContain('## Short Term');
      expect(text).toContain('## Mid Term');
      expect(text).toContain('## Long Term');
      const notYetAuthoredCount = text.split('_Not yet authored._').length - 1;
      expect(notYetAuthoredCount).toBe(3);
      expect(parseGeneratedHeader(text)).not.toBeNull();
    });

    it('is deterministic across two calls with the same generatedAt', () => {
      const entry = makeEntry();
      const a = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');
      const b = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');
      expect(a).toBe(b);
    });
  });

  describe('renderStrategicVisionBody()', () => {
    it('is unaffected by the generatedAt timestamp — matches the body portion of renderStrategicVision()', () => {
      const entry = makeEntry();
      const full = renderStrategicVision(entry, '2026-09-16T12:00:00.000Z');
      const parsed = parseGeneratedHeader(full);

      expect(parsed).not.toBeNull();
      expect(parsed!.body).toBe(renderStrategicVisionBody(entry));
    });
  });

  describe('parseGeneratedHeader()', () => {
    it('round-trips a rendered file exactly', () => {
      const entry = makeEntry();
      const generatedAt = '2026-09-16T12:00:00.000Z';
      const text = renderStrategicVision(entry, generatedAt);

      const parsed = parseGeneratedHeader(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.repositoryId).toBe(entry.id);
      expect(parsed!.visionHash).toBe(visionHash(entry.vision));
      expect(parsed!.generatedAt).toBe(generatedAt);
      expect(parsed!.body).toBe(renderStrategicVisionBody(entry));
    });

    it('returns null when the first line is not the exact marker', () => {
      const text = '<!-- some other comment -->\n\n# Not generated\n';
      expect(parseGeneratedHeader(text)).toBeNull();
    });

    it('returns null for a hand-authored file with no header at all', () => {
      expect(parseGeneratedHeader('# My own notes\n\nDo not touch.\n')).toBeNull();
    });

    it('returns null when the marker line matches but a subsequent header line is malformed', () => {
      const text = [MARKER, 'not a valid repository-id line', 'also not valid', 'still not valid', 'and not this either', '', 'body'].join(
        '\n'
      );
      expect(parseGeneratedHeader(text)).toBeNull();
    });
  });
});
