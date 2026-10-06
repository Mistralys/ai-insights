/**
 * scripts/tests/agent-slug-validation.test.js
 *
 * Unit tests for scripts/lib/agent-slug-validation.js — the {{agent_slug_*}}
 * cross-reference check extracted from build-personas.js (WP-006/WP-007 of
 * the 2026-09-30-persona-targets-and-tool-validation-rework-1 plan).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { extractSubagentsList, validateAgentSlugReferences } from '../lib/agent-slug-validation.js';

const tempDirs = [];

function makeSuiteFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slug-validation-'));
  tempDirs.push(root);

  const metaDir    = path.join(root, 'meta');
  const contentDir = path.join(root, 'content');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  return { metaDir, contentDir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('extractSubagentsList', () => {
  it('collects a dash-prefixed block list under the given key', () => {
    const yaml = [
      'slug: planner',
      'subagents:',
      '  - developer',
      '  - "qa-engineer"',
      "  - 'reviewer'",
    ].join('\n');

    expect(extractSubagentsList(yaml, 'subagents')).toEqual(['developer', 'qa-engineer', 'reviewer']);
  });

  it('returns [] when the key is absent', () => {
    expect(extractSubagentsList('slug: planner\n', 'subagents')).toEqual([]);
  });

  it('returns [] when the key has an inline scalar value instead of a block list', () => {
    expect(extractSubagentsList('subagents: none\n', 'subagents')).toEqual([]);
  });

  it('stops collecting at the next top-level key', () => {
    const yaml = [
      'subagents:',
      '  - developer',
      'description: A persona.',
    ].join('\n');

    expect(extractSubagentsList(yaml, 'subagents')).toEqual(['developer']);
  });
});

describe('validateAgentSlugReferences', () => {
  it('produces the same message shape as the original inline block for an undeclared slug', () => {
    const { metaDir, contentDir } = makeSuiteFixture({
      'meta/1-planner.yaml': 'slug: planner\nsubagents:\n  - developer\n',
      'content/1-planner.md': 'Dispatch to {{agent_slug_qa_engineer}}.\n',
    });

    const errors = validateAgentSlugReferences(metaDir, contentDir);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Persona "1-planner"');
    expect(errors[0]).toContain('{{agent_slug_qa_engineer}}');
    expect(errors[0]).toContain('references slug "qa-engineer"');
    expect(errors[0]).toContain('not declared in the subagents list');
    expect(errors[0]).toContain('Add "qa-engineer" to the subagents field in 1-planner.yaml');
  });

  it('passes when every {{agent_slug_*}} reference has a matching declared slug', () => {
    const { metaDir, contentDir } = makeSuiteFixture({
      'meta/1-planner.yaml': 'slug: planner\nsubagents:\n  - developer\n  - qa-engineer\n',
      'content/1-planner.md': 'Dispatch to {{agent_slug_developer}} or {{agent_slug_qa_engineer}}.\n',
    });

    expect(validateAgentSlugReferences(metaDir, contentDir)).toEqual([]);
  });

  it('ignores a persona YAML with no matching content file', () => {
    const { metaDir, contentDir } = makeSuiteFixture({
      'meta/1-planner.yaml': 'slug: planner\n',
    });

    expect(validateAgentSlugReferences(metaDir, contentDir)).toEqual([]);
  });

  it('returns [] when the meta directory does not exist', () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slug-validation-content-'));
    tempDirs.push(contentDir);
    const missingMetaDir = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());

    expect(validateAgentSlugReferences(missingMetaDir, contentDir)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Comment-awareness — an undeclared slug referenced only inside a template
  // comment must never be flagged, when a real stripComments is supplied.
  // ---------------------------------------------------------------------------

  it('ignores a slug reference written inside a comment, given a real stripComments', () => {
    const { metaDir, contentDir } = makeSuiteFixture({
      'meta/1-planner.yaml': 'slug: planner\nsubagents:\n  - developer\n',
      'content/1-planner.md':
        'Dispatch to {{agent_slug_developer}}.\n{{!-- {{agent_slug_qa_engineer}} --}}\n',
    });

    // Minimal real stripComments stand-in: removes {{!-- ... --}} blocks,
    // mirroring @mistralys/persona-builder's stripComments() contract
    // closely enough for this unit test (exact whitespace handling is
    // covered by the library's own tests).
    const stripComments = (text) => text.replace(/\{\{!--[\s\S]*?--\}\}/g, '');

    const errors = validateAgentSlugReferences(metaDir, contentDir, { stripComments });

    expect(errors).toEqual([]);
  });

  it('flags the same undeclared slug reference when stripComments is the identity default', () => {
    const { metaDir, contentDir } = makeSuiteFixture({
      'meta/1-planner.yaml': 'slug: planner\nsubagents:\n  - developer\n',
      'content/1-planner.md':
        'Dispatch to {{agent_slug_developer}}.\n{{!-- {{agent_slug_qa_engineer}} --}}\n',
    });

    // No stripComments option supplied — falls back to the identity
    // function, so the reference inside the (unrecognised) comment text is
    // still scanned and flagged. This is the stale-dist/ fallback behaviour.
    const errors = validateAgentSlugReferences(metaDir, contentDir);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('qa-engineer');
  });
});
