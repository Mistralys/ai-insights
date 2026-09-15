/**
 * scripts/tests/frontmatter.test.js
 *
 * Unit tests for scripts/lib/frontmatter.js
 *
 * Acceptance Criteria verified:
 *   AC-02: parseFrontmatter() extracts frontmatter fields (role, name, etc.)
 *          used to derive an agent's display label.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseFrontmatter } from '../lib/frontmatter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmatter-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ─── parseFrontmatter() ───────────────────────────────────────────────────────

describe('parseFrontmatter()', () => {
  it('extracts all top-level scalar fields from a ---delimited block', () => {
    const dir = makeTempDir();
    const filePath = writeFile(
      dir,
      'agent.md',
      ['---', 'name: 1-planner', 'role: Planner', "description: Plans things.", '---', '', 'Body text.'].join('\n'),
    );

    const fields = parseFrontmatter(filePath);

    expect(fields).toEqual({
      name: '1-planner',
      role: 'Planner',
      description: 'Plans things.',
    });
  });

  it('returns null for a file with no frontmatter block', () => {
    const dir = makeTempDir();
    const filePath = writeFile(dir, 'no-frontmatter.md', 'Just some body text, no frontmatter here.');

    expect(parseFrontmatter(filePath)).toBeNull();
  });

  it('tolerates an optional leading <!--…--> HTML comment before the frontmatter block', () => {
    const dir = makeTempDir();
    const filePath = writeFile(
      dir,
      'agent.md',
      ['<!-- generated file -->', '---', 'name: developer-standalone', '---', '', 'Body text.'].join('\n'),
    );

    const fields = parseFrontmatter(filePath);

    expect(fields).toEqual({ name: 'developer-standalone' });
  });

  it('strips surrounding single/double quotes from values', () => {
    const dir = makeTempDir();
    const filePath = writeFile(
      dir,
      'agent.md',
      ['---', 'name: "quoted-double"', "role: 'Quoted Single'", '---', ''].join('\n'),
    );

    const fields = parseFrontmatter(filePath);

    expect(fields).toEqual({ name: 'quoted-double', role: 'Quoted Single' });
  });
});
