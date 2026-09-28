/**
 * scripts/tests/launch-agent.test.js
 *
 * Unit tests for scripts/lib/launch-agent-core.js
 *
 * Imports discoverAgents, buildLaunchEntries, filterEntries, firstAgentIndex,
 * reducePickerInput, renderPickerLines, CHROME_ROWS, and
 * runNonInteractivePicker directly from scripts/lib/launch-agent-core.js —
 * never from scripts/launch-agent.js, whose main() runs unconditionally on
 * import (see plan Structural Improvements, cycle-2 rework).
 *
 * Acceptance Criteria verified:
 *   AC-01: buildLaunchEntries() prepends the session entry, preserves agent order/fields.
 *   AC-02: buildLaunchEntries([]) returns exactly the session entry.
 *   AC-03: filterEntries() substring matching, including the session entry.
 *   AC-04: firstAgentIndex() returns the first kind === 'agent' index, else 0.
 *   AC-05: runNonInteractivePicker() number-select / re-filter / cancel resolve with entries.
 *   AC-06: runNonInteractivePicker() can select the session entry via --filter.
 *   AC-11: discoverAgents() / reducePickerInput() are unchanged (non-regression).
 *   AC-12, AC-15: renderPickerLines() divider placement and row-budget bound.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  discoverAgents,
  buildLaunchEntries,
  filterEntries,
  firstAgentIndex,
  reducePickerInput,
  renderPickerLines,
  CHROME_ROWS,
  runNonInteractivePicker,
} from '../lib/launch-agent-core.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-agent-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeAgentFile(dir, filename, frontmatterLines) {
  const content = ['---', ...frontmatterLines, '---', '', 'Body text.'].join('\n');
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

/** A stub readline.Interface-shaped object scripted with canned answers. */
function makeStubReadlineFactory(answers) {
  let call = 0;
  return () => ({
    question(_prompt, callback) {
      const answer = answers[call] ?? '';
      call += 1;
      callback(answer);
    },
    close() {},
  });
}

// ─── discoverAgents() ──────────────────────────────────────────────────────────

describe('discoverAgents()', () => {
  it('returns [] for a non-existent directory', () => {
    const missingDir = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    expect(discoverAgents(missingDir)).toEqual([]);
  });

  it('uses role: as the label when present', () => {
    const dir = makeTempDir();
    writeAgentFile(dir, '1-planner.md', ['name: 1-planner', 'role: Planner', 'description: Plans things.']);

    const agents = discoverAgents(dir);

    expect(agents).toEqual([{ id: '1-planner', label: 'Planner', description: 'Plans things.', file: path.join(dir, '1-planner.md') }]);
  });

  it('falls back to the filename without extension when role: is absent', () => {
    const dir = makeTempDir();
    writeAgentFile(dir, 'developer-standalone.md', ['name: developer-standalone', 'description: Implements plans.']);

    const agents = discoverAgents(dir);

    expect(agents[0].label).toBe('developer-standalone');
    expect(agents[0].id).toBe('developer-standalone');
  });

  it('falls back to the filename without extension when the file has no parseable frontmatter at all', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'no-frontmatter.md'), 'Just body text.', 'utf8');

    const agents = discoverAgents(dir);

    expect(agents[0].label).toBe('no-frontmatter');
    expect(agents[0].id).toBe('no-frontmatter');
  });

  it('returns results sorted by label', () => {
    const dir = makeTempDir();
    writeAgentFile(dir, 'z-agent.md', ['name: z-agent', 'role: Alpha']);
    writeAgentFile(dir, 'a-agent.md', ['name: a-agent', 'role: Zulu']);

    const agents = discoverAgents(dir);

    expect(agents.map((a) => a.label)).toEqual(['Alpha', 'Zulu']);
  });
});

// ─── buildLaunchEntries() ──────────────────────────────────────────────────────

describe('buildLaunchEntries()', () => {
  const agents = [
    { id: '1-planner', label: 'Planner', description: 'Plans things.', file: '/x/1-planner.md' },
    { id: 'developer-standalone', label: 'developer-standalone', description: 'Implements plans.', file: '/x/developer-standalone.md' },
  ];

  it('returns the session entry first, followed by every agent in order, with kind and claudeArgs added', () => {
    const entries = buildLaunchEntries(agents);

    expect(entries[0]).toMatchObject({ id: 'resume-session', kind: 'session', claudeArgs: ['--resume'] });
    expect(entries.slice(1)).toEqual([
      { ...agents[0], kind: 'agent', claudeArgs: ['--agent', '1-planner'] },
      { ...agents[1], kind: 'agent', claudeArgs: ['--agent', 'developer-standalone'] },
    ]);
  });

  it('returns exactly the session entry for an empty agent list', () => {
    const entries = buildLaunchEntries([]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'session', claudeArgs: ['--resume'] });
  });
});

// ─── filterEntries() ────────────────────────────────────────────────────────────

describe('filterEntries()', () => {
  const entries = buildLaunchEntries([
    { id: '1-planner', label: 'Planner', description: 'Plans and strategizes.' },
    { id: 'developer-standalone', label: 'developer-standalone', description: 'Turns plans into working code.' },
  ]);

  it('with an empty query returns the full list unchanged', () => {
    expect(filterEntries(entries, '')).toEqual(entries);
    expect(filterEntries(entries, '   ')).toEqual(entries);
  });

  it('matches case-insensitively against label, id, and description', () => {
    expect(filterEntries(entries, 'STRATEGIZ').map((e) => e.id)).toEqual(['1-planner']);
    expect(filterEntries(entries, 'developer-standalone').map((e) => e.id)).toEqual(['developer-standalone']);
    expect(filterEntries(entries, 'working code').map((e) => e.id)).toEqual(['developer-standalone']);
  });

  it('with no matches returns an empty array', () => {
    expect(filterEntries(entries, 'nonexistent-term-xyz')).toEqual([]);
  });

  it('matches the session entry for the queries "resume" and "session", excluding it for a persona-specific query', () => {
    expect(filterEntries(entries, 'resume').map((e) => e.id)).toEqual(['resume-session']);
    expect(filterEntries(entries, 'session').map((e) => e.id)).toEqual(['resume-session']);
    expect(filterEntries(entries, 'strategiz').map((e) => e.id)).not.toContain('resume-session');
  });
});

// ─── firstAgentIndex() ──────────────────────────────────────────────────────────

describe('firstAgentIndex()', () => {
  it('returns 1 for a session-then-agents list', () => {
    const entries = buildLaunchEntries([{ id: 'a', label: 'A', description: '' }]);
    expect(firstAgentIndex(entries)).toBe(1);
  });

  it('returns 0 for an agents-only list', () => {
    const entries = [{ id: 'a', label: 'A', kind: 'agent' }];
    expect(firstAgentIndex(entries)).toBe(0);
  });

  it('returns 0 for a session-only list', () => {
    const entries = buildLaunchEntries([]);
    expect(firstAgentIndex(entries)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(firstAgentIndex([])).toBe(0);
  });
});

// ─── reducePickerInput() ───────────────────────────────────────────────────────

describe('reducePickerInput()', () => {
  it('appends a printable character to query and resets cursor to 0', () => {
    const state = { query: 'pl', cursor: 3 };
    const result = reducePickerInput(state, { str: 'a', key: {} }, 5);

    expect(result.query).toBe('pla');
    expect(result.cursor).toBe(0);
    expect(result.action).toBeNull();
  });

  it('on backspace removes the last character and resets cursor', () => {
    const state = { query: 'plan', cursor: 2 };
    const result = reducePickerInput(state, { str: '', key: { name: 'backspace' } }, 5);

    expect(result.query).toBe('pla');
    expect(result.cursor).toBe(0);
  });

  it('on up/down clamps cursor to [0, filteredLength - 1], including at the boundaries and when filteredLength is 0', () => {
    // Already at 0, moving up stays at 0.
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'up' } }, 3).cursor).toBe(0);
    // Moving down within range.
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'down' } }, 3).cursor).toBe(1);
    // Moving down at the top boundary stays clamped.
    expect(reducePickerInput({ query: '', cursor: 2 }, { key: { name: 'down' } }, 3).cursor).toBe(2);
    // filteredLength 0 clamps cursor to 0 regardless of direction.
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'down' } }, 0).cursor).toBe(0);
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'up' } }, 0).cursor).toBe(0);
  });

  it('on return yields { action: "select" } only when filteredLength > 0, else { action: null }', () => {
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'return' } }, 2).action).toBe('select');
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'return' } }, 0).action).toBeNull();
  });

  it('on escape and on Ctrl+C both yield { action: "cancel" }', () => {
    expect(reducePickerInput({ query: '', cursor: 0 }, { key: { name: 'escape' } }, 2).action).toBe('cancel');
    expect(reducePickerInput({ query: '', cursor: 0 }, { str: '', key: { ctrl: true, name: 'c' } }, 2).action).toBe(
      'cancel',
    );
  });
});

// ─── renderPickerLines() ────────────────────────────────────────────────────────

describe('renderPickerLines()', () => {
  const mixed = buildLaunchEntries([
    { id: 'a', label: 'Alpha', description: '' },
    { id: 'b', label: 'Beta', description: '' },
    { id: 'c', label: 'Gamma', description: '' },
  ]);
  const sessionOnly = buildLaunchEntries([]);
  const agentsOnly = mixed.filter((e) => e.kind === 'agent');

  it('renders a divider between the session block and the agent block when both are within budget', () => {
    const lines = renderPickerLines({ query: '', cursor: 1 }, mixed, 10);

    expect(lines.some((l) => l.includes('─────'))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(10 + CHROME_ROWS);
  });

  it('renders no divider for a session-only filtered list', () => {
    const lines = renderPickerLines({ query: '', cursor: 0 }, sessionOnly, 10);
    expect(lines.some((l) => l.includes('─────'))).toBe(false);
  });

  it('renders no divider for an agents-only filtered list', () => {
    const lines = renderPickerLines({ query: '', cursor: 0 }, agentsOnly, 10);
    expect(lines.some((l) => l.includes('─────'))).toBe(false);
  });

  it('still renders the divider when maxVisibleRows is small enough that only the session row is visible', () => {
    const lines = renderPickerLines({ query: '', cursor: 0 }, mixed, 1);

    expect(lines.some((l) => l.includes('─────'))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(1 + CHROME_ROWS);
  });
});

// ─── runNonInteractivePicker() ─────────────────────────────────────────────────

describe('runNonInteractivePicker()', () => {
  const entries = buildLaunchEntries([
    { id: '1-planner', label: 'Planner', description: 'Plans things.' },
    { id: 'developer-standalone', label: 'developer-standalone', description: 'Implements plans.' },
  ]);

  it('selects the correct entry object when the user answers with a valid list number', async () => {
    const readlineFactory = makeStubReadlineFactory(['3']);

    const result = await runNonInteractivePicker(entries, '', { readlineFactory });

    expect(result.id).toBe('developer-standalone');
    expect(result.claudeArgs).toEqual(['--agent', 'developer-standalone']);
  });

  it('re-filters and re-prompts (loop continues) when the user answers with free text instead of a number', async () => {
    // First answer narrows to "planner" (a single match), second answer selects it.
    const readlineFactory = makeStubReadlineFactory(['planner', '1']);

    const result = await runNonInteractivePicker(entries, '', { readlineFactory });

    expect(result.id).toBe('1-planner');
  });

  it('cancels (resolves null) when the user answers with empty input', async () => {
    const readlineFactory = makeStubReadlineFactory(['']);

    const result = await runNonInteractivePicker(entries, '', { readlineFactory });

    expect(result).toBeNull();
  });

  it('resolves with the session entry when initialQuery narrows to it and "1" is entered', async () => {
    const readlineFactory = makeStubReadlineFactory(['1']);

    const result = await runNonInteractivePicker(entries, 'resume', { readlineFactory });

    expect(result).toMatchObject({ id: 'resume-session', kind: 'session', claudeArgs: ['--resume'] });
  });
});
