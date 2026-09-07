/**
 * scripts/tests/changelog-size-check.test.js
 *
 * Tests for the personas/changelog.md newest-entry size/verbosity check in
 * scripts/lib/changelog-size-check.js.
 */

import { describe, it, expect } from 'vitest';
import {
  extractLatestChangelogEntry,
  checkChangelogEntrySize,
  MAX_ENTRY_LINES,
  MAX_BULLETS,
  MAX_SENTENCES_PER_BULLET,
} from '../lib/changelog-size-check.js';

describe('extractLatestChangelogEntry', () => {
  it('returns null when there is no version heading', () => {
    const md = '# Personas Changelog\n\nNothing here yet.\n';
    expect(extractLatestChangelogEntry(md)).toBeNull();
  });

  it('returns the first entry\'s version, line range, and body when multiple headings exist', () => {
    const md = [
      '# Personas Changelog',
      '',
      '## v3.2.0 - Newest',
      '',
      '- Docs: newest bullet.',
      '',
      '## v3.1.0 - Older',
      '',
      '- Docs: older bullet.',
      '',
    ].join('\n');

    const entry = extractLatestChangelogEntry(md);
    expect(entry.version).toBe('3.2.0');
    expect(entry.startLine).toBe(3);
    expect(entry.lines[0]).toBe('## v3.2.0 - Newest');
  });

  it('excludes a second, larger historical entry from the returned body', () => {
    const olderBullets = Array.from({ length: 40 }, (_, i) => `- Historical bullet ${i + 1}.`).join('\n');
    const md = [
      '# Personas Changelog',
      '',
      '## v3.2.0 - Newest',
      '',
      '- Docs: newest bullet.',
      '',
      '## v3.1.0 - Older',
      '',
      olderBullets,
      '',
    ].join('\n');

    const entry = extractLatestChangelogEntry(md);
    expect(entry.lines.join('\n')).not.toContain('Historical bullet');
    expect(entry.lines.some(l => l.includes('v3.1.0'))).toBe(false);
  });
});

describe('checkChangelogEntrySize', () => {
  function entryWithLines(bodyLineCount) {
    const heading = '## v3.2.0 - Test';
    const filler = Array.from({ length: bodyLineCount - 1 }, () => '- Docs: filler bullet.');
    return [heading, ...filler].join('\n');
  }

  it('produces no line-count warning at exactly MAX_ENTRY_LINES', () => {
    const md = entryWithLines(MAX_ENTRY_LINES);
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings.filter(w => w.includes('lines'))).toEqual([]);
  });

  it('produces exactly one line-count warning one line over MAX_ENTRY_LINES', () => {
    const md = entryWithLines(MAX_ENTRY_LINES + 1);
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings.filter(w => w.includes('lines'))).toHaveLength(1);
  });

  function entryWithBullets(bulletCount) {
    const heading = '## v3.2.0 - Test';
    const bullets = Array.from({ length: bulletCount }, (_, i) => `- Docs: bullet ${i + 1}.`);
    return [heading, ...bullets].join('\n');
  }

  it('produces no bullet-count warning at exactly MAX_BULLETS', () => {
    const md = entryWithBullets(MAX_BULLETS);
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings.filter(w => w.includes('bullets'))).toEqual([]);
  });

  it('produces exactly one bullet-count warning one bullet over MAX_BULLETS', () => {
    const md = entryWithBullets(MAX_BULLETS + 1);
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings.filter(w => w.includes('bullets'))).toHaveLength(1);
  });

  function sentenceBullet(count) {
    return Array.from({ length: count }, (_, i) => `Sentence number ${i + 1} here.`).join(' ');
  }

  it('produces no sentence warning for a bullet at exactly MAX_SENTENCES_PER_BULLET', () => {
    const md = ['## v3.2.0 - Test', `- Docs: ${sentenceBullet(MAX_SENTENCES_PER_BULLET)}`].join('\n');
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings.filter(w => w.includes('sentences'))).toEqual([]);
  });

  it('produces exactly one sentence warning, referencing the bullet\'s own line, one sentence over', () => {
    const md = [
      '## v3.2.0 - Test',
      '',
      `- Docs: ${sentenceBullet(MAX_SENTENCES_PER_BULLET + 1)}`,
    ].join('\n');
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    const sentenceWarnings = warnings.filter(w => w.includes('sentences'));
    expect(sentenceWarnings).toHaveLength(1);
    expect(sentenceWarnings[0]).toMatch(/^changelog\.md:3:/);
  });

  it('folds a wrapped continuation line into one bullet, not two', () => {
    const md = [
      '## v3.2.0 - Test',
      '',
      '- Docs: This bullet wraps onto',
      '  a second physical line that is a continuation, not a new bullet.',
    ].join('\n');
    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings).toEqual([]);
  });

  it('produces no warnings for a realistic clean entry shaped like v3.32.0', () => {
    const md = [
      '## v3.32.0 - **WIP UNRELEASED**',
      '',
      '**A short bold summary paragraph describing the release headline.**',
      '',
      '- Docs: Persona Design Guide reaches v3.2.',
      '- Build: Added a philosophy tone checker.',
      '- Global: Rewrote imperative philosophy principles across several personas.',
      '- Standalone: Added Dependency Curator for dependency audits.',
      '- Standalone: A guide-compliance sweep redesigned most personas.',
      '- Standalone: Persona Curator gained a Philosophy Tone Pass.',
      '- Standalone: Plan Auditor and Plan Refiner share a new research-brief protocol.',
      '- Standalone: Fixed Git Committer\'s corrupted safety rule.',
      '- Docs: Documented downstream fetch of design guide content.',
    ].join('\n');

    const warnings = checkChangelogEntrySize(md, 'changelog.md');
    expect(warnings).toEqual([]);
  });

  it('respects options overrides for maxLines, maxBullets, and maxSentencesPerBullet', () => {
    const md = [
      '## v3.2.0 - Test',
      '- Docs: one.',
      '- Docs: two.',
      '- Docs: three.',
    ].join('\n');

    expect(checkChangelogEntrySize(md, 'changelog.md', { maxLines: 2 })
      .some(w => w.includes('lines'))).toBe(true);
    expect(checkChangelogEntrySize(md, 'changelog.md', { maxBullets: 2 })
      .some(w => w.includes('bullets'))).toBe(true);
    expect(checkChangelogEntrySize(
      md.replace('- Docs: one.', '- Docs: One sentence. Two sentence. Three sentence.'),
      'changelog.md',
      { maxSentencesPerBullet: 1 },
    ).some(w => w.includes('sentences'))).toBe(true);
  });

  it('returns [] when there is no version heading', () => {
    expect(checkChangelogEntrySize('# No heading here.', 'changelog.md')).toEqual([]);
  });
});
