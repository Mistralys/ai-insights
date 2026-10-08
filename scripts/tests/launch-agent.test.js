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

import { describe, it, expect, afterEach, vi } from 'vitest';
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
  runInteractivePicker,
  parseLaunchArgs,
} from '../lib/launch-agent-core.js';
import { LaunchToggles, LAUNCH_TOGGLES } from '../lib/launch-toggles.js';

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


// ─── Skip-permissions toggle (AC-03..AC-10) ──────────────────────────────────

const stripAnsi = (str) => str.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '');
const sampleAgents = [
  { id: 'alpha', label: 'Alpha', description: 'first', file: 'a.md' },
  { id: 'beta', label: 'Beta', description: 'second', file: 'b.md' },
];

describe('buildLaunchEntries() with toggles', () => {
  it('places the toggle row between the session row and the agents', () => {
    const entries = buildLaunchEntries(sampleAgents, LAUNCH_TOGGLES);
    expect(entries[0].kind).toBe('session');
    expect(entries[1]).toMatchObject({
      id: 'toggle:skip-permissions',
      kind: 'toggle',
      toggleId: 'skip-permissions',
      claudeArgs: [],
    });
    expect(entries.slice(2).map((e) => e.id)).toEqual(['alpha', 'beta']);
  });

  it('without defs returns the pre-toggle list', () => {
    expect(buildLaunchEntries(sampleAgents).map((e) => e.kind)).toEqual(['session', 'agent', 'agent']);
  });
});

describe('firstAgentIndex() with toggles', () => {
  it('skips session and toggle rows', () => {
    expect(firstAgentIndex(buildLaunchEntries(sampleAgents, LAUNCH_TOGGLES))).toBe(2);
  });

  it('returns 0 for a toggle-only list', () => {
    expect(firstAgentIndex(buildLaunchEntries([], LAUNCH_TOGGLES).slice(1))).toBe(0);
  });
});

describe('renderPickerLines() with toggles', () => {
  const entries = buildLaunchEntries(sampleAgents, LAUNCH_TOGGLES);
  const state = { query: '', cursor: 2 };
  const divider = (lines) => lines.filter((l) => stripAnsi(l).includes('─────')).length;

  it('renders ON/OFF per the toggle model', () => {
    const t = new LaunchToggles();
    expect(renderPickerLines(state, entries, 15, t).map(stripAnsi).join('\n')).toContain(
      'Skip permission prompts: OFF',
    );
    t.toggle('skip-permissions');
    expect(renderPickerLines(state, entries, 15, t).map(stripAnsi).join('\n')).toContain(
      'Skip permission prompts: ON',
    );
    expect(renderPickerLines(state, entries).map(stripAnsi).join('\n')).toContain(': OFF');
  });

  it('draws one divider after the pinned block', () => {
    const lines = renderPickerLines(state, entries, 15, new LaunchToggles()).map(stripAnsi);
    expect(divider(lines)).toBe(1);
    const dividerAt = lines.findIndex((l) => l.includes('─────'));
    expect(lines[dividerAt - 1]).toContain('Skip permission prompts');
    expect(lines[dividerAt + 1]).toContain('Alpha');
  });

  it('draws no divider for a pinned-only list', () => {
    expect(divider(renderPickerLines(state, entries.slice(0, 2), 15, new LaunchToggles()))).toBe(0);
  });

  it('keeps the row budget bounded', () => {
    const lines = renderPickerLines({ query: '', cursor: 0 }, entries, 1, new LaunchToggles());
    expect(lines.length).toBeLessThanOrEqual(1 + CHROME_ROWS);
    expect(CHROME_ROWS).toBe(5);
  });

  it('shows the warning on the instructions line even when the toggle row is filtered out', () => {
    const t = new LaunchToggles(LAUNCH_TOGGLES, ['skip-permissions']);
    const agentsOnly = entries.filter((e) => e.kind === 'agent');
    const lines = renderPickerLines(state, agentsOnly, 15, t).map(stripAnsi);
    expect(lines[1]).toContain('⚠ Skip permission prompts ON');
  });

  it('shows no warning when off or when toggles is null', () => {
    expect(stripAnsi(renderPickerLines(state, entries, 15, new LaunchToggles())[1])).not.toContain('⚠');
    expect(stripAnsi(renderPickerLines(state, entries, 15, null)[1])).not.toContain('⚠');
  });
});

describe('runNonInteractivePicker() with toggles', () => {
  const entries = buildLaunchEntries(sampleAgents, LAUNCH_TOGGLES);

  it('flips the toggle then resolves with the next selected agent', async () => {
    const toggles = new LaunchToggles();
    const result = await runNonInteractivePicker(entries, '', {
      readlineFactory: makeStubReadlineFactory(['2', '3']),
      toggles,
    });
    expect(toggles.isOn('skip-permissions')).toBe(true);
    expect(result.id).toBe('alpha');
  });

  it('flipping twice leaves it off and an empty answer cancels', async () => {
    const toggles = new LaunchToggles();
    const result = await runNonInteractivePicker(entries, '', {
      readlineFactory: makeStubReadlineFactory(['2', '2', '']),
      toggles,
    });
    expect(toggles.isOn('skip-permissions')).toBe(false);
    expect(result).toBeNull();
  });

  it('ignores a toggle selection when no toggle model is supplied', async () => {
    const result = await runNonInteractivePicker(entries, '', {
      readlineFactory: makeStubReadlineFactory(['2', '']),
    });
    expect(result).toBeNull();
  });
});

describe('runInteractivePicker() with toggles', () => {
  it('flips on Enter over a toggle row without resolving, then resolves on an agent row', async () => {
    const writes = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const setRaw = process.stdin.setRawMode;
    process.stdin.setRawMode = () => process.stdin;
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    const pause = vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
    const entries = buildLaunchEntries(sampleAgents, LAUNCH_TOGGLES);
    const toggles = new LaunchToggles();
    try {
      let settled = false;
      const promise = runInteractivePicker(entries, '', toggles).then((r) => {
        settled = true;
        return r;
      });
      const press = (name) => process.stdin.emit('keypress', '', { name });

      press('up'); // first agent (cursor 2) -> toggle row (1)
      press('return');
      await Promise.resolve();
      expect(toggles.isOn('skip-permissions')).toBe(true);
      expect(settled).toBe(false);

      press('down');
      press('return');
      const result = await promise;
      expect(result.id).toBe('alpha');
      expect(toggles.isOn('skip-permissions')).toBe(true);
    } finally {
      process.stdin.removeAllListeners('keypress');
      process.stdin.setRawMode = setRaw;
      writes.mockRestore();
      resume.mockRestore();
      pause.mockRestore();
    }
  });
});

describe('parseLaunchArgs()', () => {
  it('handles no args', () => {
    expect(parseLaunchArgs([])).toEqual({ filter: '', ownArgs: [], passthroughArgs: [] });
  });

  it('extracts --filter', () => {
    expect(parseLaunchArgs(['--filter', 'plan'])).toEqual({
      filter: 'plan',
      ownArgs: ['--filter', 'plan'],
      passthroughArgs: [],
    });
  });

  it('splits own and passthrough args on --', () => {
    expect(parseLaunchArgs(['--skip-permissions', '--', '--x'])).toEqual({
      filter: '',
      ownArgs: ['--skip-permissions'],
      passthroughArgs: ['--x'],
    });
  });

  it('treats --filter after -- as passthrough', () => {
    const r = parseLaunchArgs(['--', '--filter', 'y']);
    expect(r.filter).toBe('');
    expect(r.passthroughArgs).toEqual(['--filter', 'y']);
  });
});
