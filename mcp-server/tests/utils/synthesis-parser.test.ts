import { describe, it, expect } from 'vitest';
import { parseOutcomeSummary } from '../../src/utils/synthesis-parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(sections: string): string {
  return `# Synthesis Report\n\n${sections}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseOutcomeSummary', () => {
  // ── Scenario 1: ### Outcome Summary present ──────────────────────────────

  describe('when ### Outcome Summary is present', () => {
    it('returns the section content trimmed', () => {
      const md = doc(
        '### Outcome Summary\n\nAll goals achieved.\n\n### Next Steps\nDone.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('All goals achieved.');
    });

    it('returns multi-paragraph content trimmed', () => {
      const md = doc(
        '### Outcome Summary\n\nParagraph one.\n\nParagraph two.\n\n### Next Steps\nDone.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('Paragraph one.\n\nParagraph two.');
    });

    it('handles leading and trailing whitespace in section body', () => {
      const md = doc('### Outcome Summary\n\n\n  Trimmed result.  \n\n');
      expect(parseOutcomeSummary(md)).toBe('Trimmed result.');
    });

    it('returns content when Outcome Summary is the last section (no following ###)', () => {
      const md = doc('### Outcome Summary\n\nFinal summary.\n');
      expect(parseOutcomeSummary(md)).toBe('Final summary.');
    });

    it('ignores heading case differences', () => {
      const md = doc('### outcome summary\n\nLower-case heading.\n');
      expect(parseOutcomeSummary(md)).toBe('Lower-case heading.');
    });
  });

  // ── Scenario 2: ### Outcome Summary absent → fallback ────────────────────

  describe('when ### Outcome Summary is absent', () => {
    it('returns the first bullet of ### Implementation Summary', () => {
      const md = doc(
        '### Implementation Summary\n\n- First bullet text\n- Second bullet\n\n### Notes\nDone.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('First bullet text');
    });

    it('trims the first bullet text', () => {
      const md = doc('### Implementation Summary\n\n-  Bullet with spaces  \n');
      expect(parseOutcomeSummary(md)).toBe('Bullet with spaces');
    });

    it('works when bullets use * instead of -', () => {
      const md = doc('### Implementation Summary\n\n* Asterisk bullet\n');
      expect(parseOutcomeSummary(md)).toBe('Asterisk bullet');
    });

    it('ignores non-bullet content before the first bullet', () => {
      const md = doc(
        '### Implementation Summary\n\nSome prose.\n\n- Actual first bullet\n',
      );
      expect(parseOutcomeSummary(md)).toBe('Actual first bullet');
    });
  });

  // ── Scenario 2b: Outcome Summary present but empty → fallback ────────────

  describe('when ### Outcome Summary exists but is empty', () => {
    it('falls back to ### Implementation Summary', () => {
      const md = doc(
        '### Outcome Summary\n\n   \n\n### Implementation Summary\n\n- Fallback bullet\n',
      );
      expect(parseOutcomeSummary(md)).toBe('Fallback bullet');
    });

    it('returns null when both sections are empty', () => {
      const md = doc(
        '### Outcome Summary\n\n\n\n### Implementation Summary\n\n\n',
      );
      expect(parseOutcomeSummary(md)).toBeNull();
    });
  });

  // ── Scenario 3: both sections absent ─────────────────────────────────────

  describe('when both sections are absent', () => {
    it('returns null', () => {
      const md = doc('### Some Other Section\n\nContent here.\n');
      expect(parseOutcomeSummary(md)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseOutcomeSummary('')).toBeNull();
    });

    it('returns null for a string with no headings', () => {
      expect(parseOutcomeSummary('Just plain text.')).toBeNull();
    });
  });

  // ── Scenario 4: malformed Markdown ───────────────────────────────────────

  describe('malformed Markdown', () => {
    it('returns null when ### Outcome Summary heading has no content before EOF', () => {
      const md = '### Outcome Summary\n';
      expect(parseOutcomeSummary(md)).toBeNull();
    });

    it('handles content without a trailing newline', () => {
      const md = '### Outcome Summary\n\nNo newline at end';
      expect(parseOutcomeSummary(md)).toBe('No newline at end');
    });

    it('does not confuse #### (h4) for a section boundary', () => {
      const md = doc(
        '### Outcome Summary\n\n#### Sub-heading\n\nPart of the summary.\n\n### Next\nDone.\n',
      );
      // #### does not start with "### " so it should be included in the section body
      expect(parseOutcomeSummary(md)).toBe(
        '#### Sub-heading\n\nPart of the summary.',
      );
    });
  });

  // ── Scenario 5: mixed heading levels (## and ###) ────────────────────────

  describe('when the document mixes ## and ### headings', () => {
    it('stops at a ## heading that follows a ### Outcome Summary section', () => {
      // Regression test: a document whose only other top-level marker between
      // the summary and the end of the file is a `##` heading (e.g. a
      // trailing `## Rework Log`) used to have its `## Metrics` section (and
      // everything after it, including the Rework Log) swallowed into the
      // extracted body, because the old boundary regex only recognized `###`.
      const md = doc(
        '### Outcome Summary\n\nAll goals achieved.\n\n## Metrics\n\nSome metrics here.\n\n## Rework Log\n\n### 2026-09-28 — Follow-up\nDetails.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('All goals achieved.');
    });

    it('recognizes a ## Outcome Summary heading (not just ###)', () => {
      const md = doc(
        '## Outcome Summary\n\nAchieved via a level-2 heading.\n\n## Next Steps\nDone.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('Achieved via a level-2 heading.');
    });

    it('falls back to Implementation Summary when it is a ## heading', () => {
      const md = doc(
        '## Implementation Summary\n\n- First bullet\n\n## Notes\nDone.\n',
      );
      expect(parseOutcomeSummary(md)).toBe('First bullet');
    });
  });
});
