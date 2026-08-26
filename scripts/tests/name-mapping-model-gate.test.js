/**
 * scripts/tests/name-mapping-model-gate.test.js
 *
 * Verifies the model-field gate in the name-mapping build pass: model fields are
 * emitted only when a local model registry exists.
 *
 * Rationale — without local.json/assignments.json, resolution falls back to the
 * shipped default.json and yields machine-dependent values, so committing them
 * churns name-mapping.json on every clone. Naming fields must always be present
 * because the MCP server require()s this file at startup (see AGENT_NAMES in
 * mcp-server/src/utils/constants.ts) and would throw on a missing file.
 *
 * The build is invoked as a subprocess against the real workspace, with the
 * registry directory temporarily swapped. Cleanup restores the registry files to
 * their original state and then runs one final build, so name-mapping.json is
 * left consistent with whatever registry state the machine actually has rather
 * than with captured bytes (which would depend on when capture happened).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT         = path.resolve(import.meta.dirname, '..', '..');
const REGISTRY_DIR = path.join(ROOT, 'personas', 'model-registry');
const MAPPING      = path.join(ROOT, 'personas', 'name-mapping.json');
const LOCAL_JSON   = path.join(REGISTRY_DIR, 'local.json');
const ASSIGNMENTS  = path.join(REGISTRY_DIR, 'assignments.json');
const DEFAULT_JSON = path.join(REGISTRY_DIR, 'default.json');

/** Registry files this suite creates or replaces. */
const VOLATILE = [LOCAL_JSON, ASSIGNMENTS];

/** @type {Map<string, string|null>} */
const original = new Map();

beforeAll(() => {
  for (const f of VOLATILE) {
    original.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  }
});

afterAll(() => {
  for (const [f, content] of original) {
    if (content === null) fs.rmSync(f, { force: true });
    else fs.writeFileSync(f, content, 'utf8');
  }
  build();
});

/** Run a real (non-check) persona build. */
function build() {
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'build-personas.js')], {
    cwd: ROOT, encoding: 'utf8', shell: false,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** @returns {Array<Record<string, unknown>>} */
function readMapping() {
  return JSON.parse(fs.readFileSync(MAPPING, 'utf8'));
}

const MODEL_KEYS = ['model', 'model_slug', 'cc_model'];
const NAMING_KEYS = ['id', 'role', 'version', 'suite', 'vscode', 'claude_code', 'deep_agents'];

describe('name-mapping model gate — no local registry', () => {
  /** @type {Array<Record<string, unknown>>} */
  let entries;

  beforeAll(() => {
    fs.rmSync(LOCAL_JSON, { force: true });
    fs.rmSync(ASSIGNMENTS, { force: true });
    expect(build().status).toBe(0);
    entries = readMapping();
  });

  it('omits every model field from every entry', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      for (const k of MODEL_KEYS) {
        expect(k in e, `${e.id} should not carry "${k}"`).toBe(false);
      }
    }
  });

  it('still emits all naming fields', () => {
    for (const e of entries) {
      for (const k of NAMING_KEYS) {
        expect(e[k], `${e.id}.${k}`).toBeDefined();
      }
    }
  });

  it('still emits per-target agent names the MCP server depends on', () => {
    for (const e of entries) {
      for (const target of ['vscode', 'claude_code', 'deep_agents']) {
        expect(typeof e[target].file_name,  `${e.id}.${target}.file_name`).toBe('string');
        expect(typeof e[target].agent_name, `${e.id}.${target}.agent_name`).toBe('string');
      }
    }
  });

  it('retains the ledger entries keyed by role that AGENT_NAMES requires', () => {
    const ledger = entries.filter(e => e.suite === 'ledger');
    expect(ledger.length).toBeGreaterThan(0);
    for (const e of ledger) {
      expect(typeof e.role).toBe('string');
      expect(typeof e.number).toBe('number');
    }
  });
});

describe('name-mapping model gate — local registry present', () => {
  /** @type {Array<Record<string, unknown>>} */
  let entries;

  beforeAll(() => {
    fs.copyFileSync(DEFAULT_JSON, LOCAL_JSON);
    fs.rmSync(ASSIGNMENTS, { force: true });
    expect(build().status).toBe(0);
    entries = readMapping();
  });

  it('emits model fields for every entry', () => {
    for (const e of entries) {
      for (const k of MODEL_KEYS) {
        expect(typeof e[k], `${e.id}.${k}`).toBe('string');
      }
    }
  });

  it('still emits all naming fields alongside the model fields', () => {
    for (const e of entries) {
      for (const k of NAMING_KEYS) {
        expect(e[k], `${e.id}.${k}`).toBeDefined();
      }
    }
  });
});

describe('name-mapping model gate — assignments.json alone', () => {
  it('is sufficient to enable model fields', () => {
    fs.rmSync(LOCAL_JSON, { force: true });
    fs.writeFileSync(ASSIGNMENTS, JSON.stringify({ persona_models: {} }, null, 2));
    expect(build().status).toBe(0);
    for (const e of readMapping()) {
      expect('model' in e, `${e.id} should carry model fields`).toBe(true);
    }
  });
});
