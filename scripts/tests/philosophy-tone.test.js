/**
 * scripts/tests/philosophy-tone.test.js
 *
 * Tests for the Operating Philosophy mood check in
 * scripts/lib/philosophy-tone.js (Persona Design Guide v3.0 mood rule).
 */

import { describe, it, expect } from 'vitest';
import { checkPhilosophyTone, extractPhilosophyPrinciples } from '../lib/philosophy-tone.js';

function persona(philosophyBody) {
  return [
    '# Test Persona',
    '',
    '## Mission',
    '',
    'Produce something.',
    '',
    '## Operating Philosophy',
    '',
    philosophyBody,
    '',
    '## Inputs',
    '',
    '- **Prefer This Input:** Use it always.',
  ].join('\n');
}

describe('extractPhilosophyPrinciples', () => {
  it('returns an empty list when there is no philosophy section', () => {
    const md = '# P\n\n## Mission\n\nDo it.\n\n## Inputs\n\n- **A:** b.\n';
    expect(extractPhilosophyPrinciples(md)).toEqual([]);
  });

  it('stops at the next top-level heading', () => {
    const found = extractPhilosophyPrinciples(persona('- **Evidence Over Availability:** A newer version is not a reason.'));
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Evidence Over Availability');
  });

  it('includes bullets under sub-headings inside the section', () => {
    const md = persona('### Group\n\n- **Depth Outranks Breadth:** Thorough coverage is worth more.');
    expect(extractPhilosophyPrinciples(md)).toHaveLength(1);
  });

  it('matches a named-metaphor philosophy heading', () => {
    const md = [
      '## Operating Philosophy — The Funnel',
      '',
      '- **Structure Before Content:** Layout outranks prose.',
      '',
      '## Inputs',
    ].join('\n');
    expect(extractPhilosophyPrinciples(md)).toHaveLength(1);
  });
});

describe('checkPhilosophyTone', () => {
  it('flags a verb-initial title', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Prefer the Smallest Sufficient Move:** Distance drives risk.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('verb-initial');
  });

  it('flags an imperative body opening', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Version Distance:** Prefer the version closest to what is installed.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('imperative');
  });

  it('flags title and body independently', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Read the Changelog:** Treat the version number as a hint.'),
      'p.md',
    );
    expect(warnings).toHaveLength(2);
  });

  it('accepts indicative principles', () => {
    const warnings = checkPhilosophyTone(
      persona([
        '- **Advisories Outrank Freshness:** An advisory is an open door.',
        '- **Evidence Over Availability:** A newer version existing is not a reason to move.',
        '- **The Changelog Decides:** Semantic versioning is a convention, not a guarantee.',
      ].join('\n')),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('does not treat a verb-initial subject followed by a copula as a command', () => {
    const warnings = checkPhilosophyTone(
      persona('- **State Is Measured, Rationale Is Remembered:** Report is authoritative.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('ignores imperative bullets outside the philosophy section', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Exposure Shapes Urgency:** The same advisory carries different weight.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('reports the source line of each hit', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Keep It Current:** Data goes stale.'),
      'p.md',
    );
    expect(warnings[0]).toMatch(/^p\.md:9:/);
  });

  it('exempts bare-verb comparison idioms, which the guide permits as titles', () => {
    for (const title of ['Show Over Describe', 'Merge Before Multiply', 'Quantify Over Qualify', 'Exhaust Before Inventing']) {
      const warnings = checkPhilosophyTone(
        persona(`- **${title}:** A working example earns more trust.`),
        'p.md',
      );
      expect(warnings, title).toEqual([]);
    }
  });

  it('still flags a verb phrase with a real object', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Read the Changelog, Not the Version Number:** Versioning is a convention.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
  });

  it('treats noun-reading heads without a determiner as nominal', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Map, Not Copy:** The manifest is a navigational map.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('flags a noun-reading head once a determiner makes it a verb phrase', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Map the Codebase:** Coverage is what matters.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
  });

  it('does not let a subordinate-clause copula mask an imperative', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Quality:** Apply the rule that is documented in the guide.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
  });

  it('accepts a declarative whose subject is a verb-initial phrase', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Growth:** Design for growth is cheaper than retrofitting it.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('flags an imperative in a trailing sentence, not just the opener', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Tone:** Command voice earns its weight from scarcity. Reserve imperative language for the sections that enforce something.'),
      'p.md',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sentence 2 is imperative');
  });

  it('flags every imperative sentence in a body', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Tone:** Scarcity is what gives it weight. Reserve the imperative. Never spend it elsewhere.'),
      'p.md',
    );
    expect(warnings).toHaveLength(2);
  });

  it('ignores imperatives inside quoted illustrations', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Mood Matters:** Polarity and mood are independent. "Prefer X over Y" carries no prohibition yet still instructs.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });

  it('ignores imperatives inside inline code', () => {
    const warnings = checkPhilosophyTone(
      persona('- **Naming:** The rule is mechanical. `Keep the manifest current` reads as a command.'),
      'p.md',
    );
    expect(warnings).toEqual([]);
  });
});
