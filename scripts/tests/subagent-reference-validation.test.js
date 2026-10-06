/**
 * scripts/tests/subagent-reference-validation.test.js
 *
 * Fixture-based tests for the rendered-output sub-agent reference check in
 * scripts/lib/subagent-reference-validation.js.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkRenderedReferences,
  readRenderedName,
  collectPersonas,
  validateSubagentReferences,
} from '../lib/subagent-reference-validation.js';

// slug → identifier each target matches
const index = new Map([
  ['ctx-architect',        { vscode: 'CTX Architect v1.3.3', 'claude-code': 'ctx-architect', 'deep-agents': 'ctx-architect' }],
  ['developer-standalone', { vscode: 'Developer v1.15.2', 'claude-code': 'developer-standalone', 'deep-agents': 'developer-standalone' }],
  ['1-planner',            { vscode: '1 - Planner v2.10.0', 'claude-code': '1-planner', 'deep-agents': '1-planner' }],
]);

const check = (target, text, subagents = ['ctx-architect']) =>
  checkRenderedReferences({ persona: 'suite/p', target, text, subagents, index });

describe('readRenderedName', () => {
  it('reads and unquotes the frontmatter name', () => {
    expect(readRenderedName("---\nid: x\nname: 'CTX Architect v1.3.3'\n---\nbody")).toBe('CTX Architect v1.3.3');
    expect(readRenderedName('---\nname: ctx-architect\n---\n')).toBe('ctx-architect');
  });

  it('returns null without frontmatter', () => {
    expect(readRenderedName('no frontmatter')).toBeNull();
  });
});

describe('checkRenderedReferences', () => {
  it('passes correct dispatches on every target', () => {
    expect(check('vscode', 'Invoke `runSubagent` with `agentName`: `"CTX Architect v1.3.3"`.')).toEqual([]);
    expect(check('claude-code', 'Use the `Task` tool with `subagent_type: "ctx-architect"`.')).toEqual([]);
    expect(check('deep-agents', '   - `subagent_type`: `"ctx-architect"`\n   - `description`: the path')).toEqual([]);
  });

  it('accepts a slug listed in backticks or a bold display name', () => {
    expect(check('claude-code', 'The slugs are `ctx-architect`.')).toEqual([]);
    expect(check('vscode', '| `context.yaml` | **CTX Architect v1.3.3** |')).toEqual([]);
  });

  it('accepts a selector split across lines', () => {
    expect(check('claude-code', 'Use the `Task` tool with `subagent_type:\n   "ctx-architect"`.')).toEqual([]);
  });

  it('fails a declared sub-agent the output never references', () => {
    const errors = check('claude-code', 'No dispatch here.');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('declares sub-agent "ctx-architect"');
  });

  it('fails a selector naming an agent that is not declared', () => {
    const errors = check('claude-code', 'Use `subagent_type: "ctx-architect"`, then `subagent_type: "1-planner"`.');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"1-planner" is not in `subagents`');
  });

  it('fails a selector using the slug where the target matches another name', () => {
    // Claude Code matches `developer-standalone`; the YAML basename `developer` selects nothing.
    const errors = check('claude-code', '`subagent_type: "developer"`', ['developer-standalone']);
    expect(errors.some(e => e.includes('no persona has that claude-code identifier'))).toBe(true);
    expect(errors.some(e => e.includes('declares sub-agent "developer-standalone"'))).toBe(true);
  });

  it('fails a VS Code agentName that is not the rendered display name', () => {
    const errors = check('vscode', '`agentName`: `"1-planner v2.10.0"`', ['1-planner']);
    expect(errors.some(e => e.includes('selects sub-agent "1-planner v2.10.0"'))).toBe(true);
  });

  it('fails a Claude Code dispatch that names the agent only in description', () => {
    const errors = check('claude-code', 'Use the `Task` tool with `description: "CTX Architect v1.3.3"`. `ctx-architect`');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('add `subagent_type`');
  });

  it('fails a deep-agents dispatch passing a task parameter', () => {
    const text = 'Use the `task` tool with `subagent_type: "ctx-architect"`. Pass as `task`: the path.';
    const errors = check('deep-agents', text);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('use `description`');
  });

  it('reports the line of a bad selector', () => {
    const errors = check('claude-code', 'line 1\n`ctx-architect`\n`subagent_type: "nobody"`');
    expect(errors[0]).toContain('suite/p [claude-code]:3:');
  });

  it('flags a declared slug with no matching persona', () => {
    const errors = check('claude-code', 'text', ['ghost']);
    expect(errors[0]).toContain('no persona with that slug exists');
  });
});

describe('collectPersonas — targets derived from results', () => {
  it('derives a persona\'s targets from exactly the target values its own results carry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-refs-'));
    const yamlPath = path.join(root, 'worker.yaml');
    fs.writeFileSync(yamlPath, 'slug: worker\n');

    const results = [
      { suite: 'suite', target: 'claude-code', personaYamlPath: yamlPath, content: '' },
      { suite: 'suite', target: 'vscode', personaYamlPath: yamlPath, content: '' },
    ];

    const personas = collectPersonas(results);
    fs.rmSync(root, { recursive: true, force: true });

    expect(personas.get(yamlPath).targets.sort()).toEqual(['claude-code', 'vscode']);
  });

  it('a persona with no results for a target simply has no entry for it — no YAML is consulted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-refs-'));
    const yamlPath = path.join(root, 'worker.yaml');
    // Note: this YAML has no `targets` field at all — collectPersonas() no
    // longer reads one; the results array is the sole source of truth.
    fs.writeFileSync(yamlPath, 'slug: worker\n');

    const results = [{ suite: 'suite', target: 'claude-code', personaYamlPath: yamlPath, content: '' }];

    const personas = collectPersonas(results);
    fs.rmSync(root, { recursive: true, force: true });

    expect(personas.get(yamlPath).targets).toEqual(['claude-code']);
  });
});

describe('validateSubagentReferences', () => {
  // Fixture: YAML on disk (the validator reads slug / subagents / targets from it),
  // rendered content in memory, shaped like the library's build() results.
  function fixture(yamls, rendered) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-refs-'));
    const results = [];
    for (const [base, yaml] of Object.entries(yamls)) {
      const yamlPath = path.join(root, `${base}.yaml`);
      fs.writeFileSync(yamlPath, yaml);
      for (const [target, content] of Object.entries(rendered[base])) {
        results.push({ suite: 'suite', target, personaYamlPath: yamlPath, content });
      }
    }
    return { results, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  }

  const workerRendered = {
    vscode:        "---\nname: 'Worker v1.0.0'\n---\n",
    'claude-code': '---\nname: worker-cc\n---\n',
    'deep-agents': '---\nname: standalone-worker\n---\n',
  };

  it('reads each target\'s identifier from the rendered frontmatter', () => {
    const { results, cleanup } = fixture(
      { worker: 'slug: worker\n', boss: 'slug: boss\nsubagents:\n  - worker\n' },
      {
        worker: workerRendered,
        boss: {
          vscode:        '---\nname: Boss\n---\n`agentName`: `"Worker v1.0.0"`',
          'claude-code': '---\nname: boss\n---\n`subagent_type: "worker"`',
          'deep-agents': '---\nname: x\n---\n`subagent_type: "worker"`',
        },
      },
    );
    const errors = validateSubagentReferences(results);
    cleanup();

    // Claude Code matches the rendered name `worker-cc`, not the slug; deep-agents matches the slug.
    expect(errors.filter(e => e.includes('[claude-code]'))).toHaveLength(2);
    expect(errors.filter(e => e.includes('[vscode]') || e.includes('[deep-agents]'))).toEqual([]);
  });

  it('a persona built for only some targets (no results supplied for the rest) is only checked on those targets', () => {
    // "boss" is only built for claude-code here — represented by supplying no
    // vscode/deep-agents entries in `rendered`, exactly as the library itself
    // would produce (it skips rendering an excluded target entirely, so no
    // result exists for it — there is no YAML `targets` field to read anymore).
    const { results, cleanup } = fixture(
      { worker: 'slug: worker\n', boss: 'slug: boss\nsubagents:\n  - worker\n' },
      {
        worker: workerRendered,
        boss: {
          'claude-code': '---\nname: boss\n---\n`subagent_type: "worker-cc"`',
        },
      },
    );
    const errors = validateSubagentReferences(results);
    cleanup();
    expect(errors).toEqual([]);
  });

  it('a sub-agent not built for a target produces no rendered-reference error — the library owns that case now', () => {
    // "worker" is only built for claude-code (no vscode/deep-agents entries);
    // "boss" is built for all three and declares `worker` as a sub-agent.
    // Dispatching worker on vscode/deep-agents is exactly the "declared
    // sub-agent not built for this target" case checkRenderedReferences()
    // no longer reports (see WP-014) — it is silently skipped here.
    const { results, cleanup } = fixture(
      { worker: 'slug: worker\n', boss: 'slug: boss\nsubagents:\n  - worker\n' },
      {
        worker: { 'claude-code': workerRendered['claude-code'] },
        boss: {
          vscode:        '---\nname: Boss\n---\n',
          'claude-code': '---\nname: boss\n---\n`subagent_type: "worker-cc"`',
          'deep-agents': '---\nname: x\n---\n',
        },
      },
    );
    const errors = validateSubagentReferences(results);
    cleanup();
    expect(errors).toEqual([]);
  });
});
