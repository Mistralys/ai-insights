import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  discoverAgents,
  getAgentHandle,
  isRegistryLoaded,
  resetRegistry,
} from '../../src/utils/agent-registry.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Writes a minimal *.agent.md file with optional frontmatter fields. */
async function writeAgentFile(
  dir: string,
  filename: string,
  fm: { name?: string; role?: string; extra?: string } = {},
): Promise<void> {
  const lines: string[] = ['---'];
  if (fm.name !== undefined) lines.push(`name: ${fm.name}`);
  if (fm.role !== undefined) lines.push(`role: ${fm.role}`);
  if (fm.extra) lines.push(fm.extra);
  lines.push('---', '', '# Body text');
  await writeFile(join(dir, filename), lines.join('\n'), 'utf8');
}

// ─── setup / teardown ───────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  resetRegistry();
  tmpDir = await mkdtemp(join(tmpdir(), 'agent-registry-test-'));
});

afterEach(async () => {
  resetRegistry();
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── AC: exports exist ───────────────────────────────────────────────────────

describe('AC: module exports', () => {
  it('exports discoverAgents as a function', () => {
    expect(typeof discoverAgents).toBe('function');
  });

  it('exports getAgentHandle as a function', () => {
    expect(typeof getAgentHandle).toBe('function');
  });

  it('exports isRegistryLoaded as a function', () => {
    expect(typeof isRegistryLoaded).toBe('function');
  });

  it('exports resetRegistry as a function', () => {
    expect(typeof resetRegistry).toBe('function');
  });
});

// ─── AC: isRegistryLoaded before discovery ───────────────────────────────────

describe('AC: isRegistryLoaded()', () => {
  it('returns false before any discoverAgents call', () => {
    expect(isRegistryLoaded()).toBe(false);
  });

  it('returns true after a successful discovery with at least one valid agent', async () => {
    await writeAgentFile(tmpDir, '3-developer.agent.md', {
      name: '3 - Developer v3.1.2',
      role: 'Developer',
    });
    await discoverAgents(tmpDir);
    expect(isRegistryLoaded()).toBe(true);
  });

  it('returns false after discovery that finds no valid agent files', async () => {
    // A file without role: should be skipped → map stays empty → loaded = false
    await writeAgentFile(tmpDir, 'standalone.agent.md', { name: 'Researcher v1.0.0' });
    await discoverAgents(tmpDir);
    expect(isRegistryLoaded()).toBe(false);
  });
});

// ─── AC: discoverAgents builds correct role→handle map ───────────────────────

describe('AC: discoverAgents() builds role→handle map', () => {
  it('maps role to name for a single file with quoted name', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: "'4 - QA v3.1.2'",
      role: 'QA',
    });
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({ QA: '4 - QA v3.1.2' });
  });

  it('maps role to name for a single file with unquoted name', async () => {
    await writeAgentFile(tmpDir, '3-developer.agent.md', {
      name: '3 - Developer v3.1.2',
      role: 'Developer',
    });
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({ Developer: '3 - Developer v3.1.2' });
  });

  it('maps role to name for a single file with double-quoted name', async () => {
    await writeAgentFile(tmpDir, '5-reviewer.agent.md', {
      name: '"5 - Reviewer v3.1.2"',
      role: 'Reviewer',
    });
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({ Reviewer: '5 - Reviewer v3.1.2' });
  });

  it('builds a complete map from multiple valid agent files', async () => {
    await writeAgentFile(tmpDir, '1-planner.agent.md', {
      name: '1 - Planner v1.0.4',
      role: 'Planner',
    });
    await writeAgentFile(tmpDir, '3-developer.agent.md', {
      name: '3 - Developer v3.1.2',
      role: 'Developer',
    });
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });

    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({
      Planner: '1 - Planner v1.0.4',
      Developer: '3 - Developer v3.1.2',
      QA: '4 - QA v3.1.2',
    });
  });

  it('returns a shallow copy — mutating return value does not corrupt the cache', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    const map = await discoverAgents(tmpDir);
    map['QA'] = 'MUTATED';
    // The cached handle should remain unchanged
    expect(getAgentHandle('QA')).toBe('4 - QA v3.1.2');
  });

  it('only picks up *.agent.md files, not generic *.md files', async () => {
    await writeFile(
      join(tmpDir, 'README.md'),
      '---\nname: Should Be Ignored\nrole: Planner\n---\n',
      'utf8',
    );
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({ QA: '4 - QA v3.1.2' });
    expect(map['Planner']).toBeUndefined();
  });

  it('last file wins when two files share the same role', async () => {
    // Write both files; directory listing order may vary — we only verify
    // that exactly one of the two names wins (no crash or partial result).
    await writeAgentFile(tmpDir, 'a-developer.agent.md', {
      name: 'Dev A',
      role: 'Developer',
    });
    await writeAgentFile(tmpDir, 'z-developer.agent.md', {
      name: 'Dev Z',
      role: 'Developer',
    });
    const map = await discoverAgents(tmpDir);
    expect(['Dev A', 'Dev Z']).toContain(map['Developer']);
  });

  it('returns empty map when directory has no *.agent.md files', async () => {
    await writeFile(join(tmpDir, 'notes.txt'), 'nothing here', 'utf8');
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({});
  });
});

// ─── AC: files without role: are silently skipped ────────────────────────────

describe('AC: files without role: are silently skipped', () => {
  it('omits files that have no role: field', async () => {
    await writeAgentFile(tmpDir, 'standalone.agent.md', { name: 'Researcher v1.0.0' });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const map = await discoverAgents(tmpDir);

    expect(map).toEqual({});
    // No warning should be emitted for a missing role: field
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const roleWarning = calls.some((msg) => msg.includes('Researcher'));
    expect(roleWarning).toBe(false);

    stderrSpy.mockRestore();
  });

  it('includes valid files while silently skipping no-role files', async () => {
    await writeAgentFile(tmpDir, 'standalone.agent.md', { name: 'Researcher v1.0.0' });
    await writeAgentFile(tmpDir, '4-qa.agent.md', { name: '4 - QA v3.1.2', role: 'QA' });

    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({ QA: '4 - QA v3.1.2' });
  });
});

// ─── AC: files with role: but no name: emit a stderr warning ─────────────────

describe('AC: files with role: but no name: warn on stderr', () => {
  it('writes a warning to stderr for a file that has role: but not name:', async () => {
    await writeAgentFile(tmpDir, 'broken.agent.md', { role: 'QA' });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await discoverAgents(tmpDir);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const hasWarning = calls.some(
      (msg) => msg.includes('broken.agent.md') && msg.includes('role:') && msg.includes('QA'),
    );
    expect(hasWarning).toBe(true);

    stderrSpy.mockRestore();
  });

  it('does not add the broken file to the map', async () => {
    await writeAgentFile(tmpDir, 'broken.agent.md', { role: 'Developer' });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const map = await discoverAgents(tmpDir);
    expect(map['Developer']).toBeUndefined();

    stderrSpy.mockRestore();
  });
});

// ─── AC: non-existent directory returns empty map without throwing ────────────

describe('AC: non-existent directory', () => {
  it('does not throw when passed a non-existent directory', async () => {
    await expect(
      discoverAgents('/absolutely/non/existent/directory/12345'),
    ).resolves.not.toThrow();
  });

  it('returns an empty map for a non-existent directory', async () => {
    const map = await discoverAgents('/absolutely/non/existent/directory/12345');
    expect(map).toEqual({});
  });

  it('writes a warning to stderr for a non-existent directory', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await discoverAgents('/absolutely/non/existent/directory/12345');

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const hasWarning = calls.some((msg) => msg.includes('agent-registry'));
    expect(hasWarning).toBe(true);

    stderrSpy.mockRestore();
  });
});

// ─── AC: getAgentHandle() ────────────────────────────────────────────────────

describe('AC: getAgentHandle()', () => {
  it('returns the correct handle for a known role', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    await discoverAgents(tmpDir);
    expect(getAgentHandle('QA')).toBe('4 - QA v3.1.2');
  });

  it('returns null for an unknown role', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    await discoverAgents(tmpDir);
    expect(getAgentHandle('NonExistentRole')).toBeNull();
  });

  it('returns null before discoverAgents has been called', () => {
    expect(getAgentHandle('Developer')).toBeNull();
  });

  it('returns null after resetRegistry even if discovery was performed', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    await discoverAgents(tmpDir);
    resetRegistry();
    expect(getAgentHandle('QA')).toBeNull();
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles a file with no frontmatter block at all', async () => {
    await writeFile(
      join(tmpDir, 'no-frontmatter.agent.md'),
      '# Just a heading\nSome body text.',
      'utf8',
    );
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({});
  });

  it('handles a file with an unclosed frontmatter block', async () => {
    await writeFile(
      join(tmpDir, 'unclosed.agent.md'),
      '---\nname: Some Agent\nrole: QA\n',
      'utf8',
    );
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({});
  });

  it('handles a completely empty file', async () => {
    await writeFile(join(tmpDir, 'empty.agent.md'), '', 'utf8');
    const map = await discoverAgents(tmpDir);
    expect(map).toEqual({});
  });

  it('discoverAgents is idempotent — second call overwrites the cache', async () => {
    await writeAgentFile(tmpDir, '4-qa.agent.md', {
      name: '4 - QA v3.1.2',
      role: 'QA',
    });
    await discoverAgents(tmpDir);
    expect(getAgentHandle('QA')).toBe('4 - QA v3.1.2');

    // Overwrite with different content
    await writeFile(
      join(tmpDir, '4-qa.agent.md'),
      '---\nname: 4 - QA v4.0.0\nrole: QA\n---\n',
      'utf8',
    );
    await discoverAgents(tmpDir);
    expect(getAgentHandle('QA')).toBe('4 - QA v4.0.0');
  });
});
