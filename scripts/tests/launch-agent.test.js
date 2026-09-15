/**
 * scripts/tests/launch-agent.test.js
 *
 * Unit tests for scripts/lib/launch-agent-core.js
 *
 * Imports discoverAgents, filterAgents, reducePickerInput, and
 * runNonInteractivePicker directly from scripts/lib/launch-agent-core.js —
 * never from scripts/launch-agent.js, whose main() runs unconditionally on
 * import (see plan Structural Improvements, cycle-2 rework).
 *
 * Acceptance Criteria verified:
 *   AC-01: discoverAgents() returns a sorted-by-label list.
 *   AC-02: role: frontmatter → label, else filename-without-extension.
 *   AC-03: filterAgents() substring matching; reducePickerInput() state transitions.
 *   AC-04: runNonInteractivePicker() number-select / re-filter / cancel behavior.
 *   AC-05: discoverAgents() returns [] for a non-existent directory.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { discoverAgents, filterAgents, reducePickerInput, runNonInteractivePicker } from '../lib/launch-agent-core.js';

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

// ─── filterAgents() ────────────────────────────────────────────────────────────

describe('filterAgents()', () => {
  const agents = [
    { id: '1-planner', label: 'Planner', description: 'Plans and strategizes.' },
    { id: 'developer-standalone', label: 'developer-standalone', description: 'Turns plans into working code.' },
  ];

  it('with an empty query returns the full list unchanged', () => {
    expect(filterAgents(agents, '')).toEqual(agents);
    expect(filterAgents(agents, '   ')).toEqual(agents);
  });

  it('matches case-insensitively against label, id, and description', () => {
    expect(filterAgents(agents, 'STRATEGIZ').map((a) => a.id)).toEqual(['1-planner']);
    expect(filterAgents(agents, 'developer-standalone').map((a) => a.id)).toEqual(['developer-standalone']);
    expect(filterAgents(agents, 'working code').map((a) => a.id)).toEqual(['developer-standalone']);
  });

  it('with no matches returns an empty array', () => {
    expect(filterAgents(agents, 'nonexistent-term-xyz')).toEqual([]);
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
    expect(reducePickerInput({ query: '', cursor: 0 }, { str: '', key: { ctrl: true, name: 'c' } }, 2).action).toBe(
      'cancel',
    );
  });
});

// ─── runNonInteractivePicker() ─────────────────────────────────────────────────

describe('runNonInteractivePicker()', () => {
  const agents = [
    { id: '1-planner', label: 'Planner', description: 'Plans things.' },
    { id: 'developer-standalone', label: 'developer-standalone', description: 'Implements plans.' },
  ];

  it('selects the correct agent when the user answers with a valid list number', async () => {
    const readlineFactory = makeStubReadlineFactory(['2']);

    const result = await runNonInteractivePicker(agents, '', { readlineFactory });

    expect(result).toBe('developer-standalone');
  });

  it('re-filters and re-prompts (loop continues) when the user answers with free text instead of a number', async () => {
    // First answer narrows to "planner" (a single match), second answer selects it.
    const readlineFactory = makeStubReadlineFactory(['planner', '1']);

    const result = await runNonInteractivePicker(agents, '', { readlineFactory });

    expect(result).toBe('1-planner');
  });

  it('cancels (resolves null) when the user answers with empty input', async () => {
    const readlineFactory = makeStubReadlineFactory(['']);

    const result = await runNonInteractivePicker(agents, '', { readlineFactory });

    expect(result).toBeNull();
  });
});
