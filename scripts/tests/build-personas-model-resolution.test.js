/**
 * scripts/tests/build-personas-model-resolution.test.js
 *
 * Unit tests for the persona model resolution helpers used by the
 * name-mapping build pass in build-personas.js.
 *
 * Exercises:
 *   - resolveModel() — all priority chain cases
 *   - loadModelRegistry() — file-loading, graceful degradation
 *
 * Tests are self-contained: fixtures are declared inline; no real filesystem
 * I/O beyond a temporary directory created by loadModelRegistry tests.
 *
 * Acceptance Criteria verified:
 *   AC-5: For standalone and ledger-support suites, when no model override exists,
 *         the entry resolves to model: "Inherit / Auto", model_slug: "inherit", cc_model: "inherit"
 *   AC-7: The model resolution in build-personas.js follows the same priority chain as the
 *         build plugin: assignments.json > per-persona YAML > _shared.yaml default
 *   AC-9: Model resolution tests pass
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveModel, loadModelRegistry } from '../lib/persona-model-resolution.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Registry entries used across tests */
const REGISTRY_ENTRIES = [
  { id: '00000000-0000-0000-0000-000000000000', name: 'Inherit / Auto',   slug: 'inherit',          cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000001', name: 'Claude Opus 4.6',  slug: 'claude-opus-4-6',  cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Claude Sonnet 4.6', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Gemini 3.5 Flash', slug: 'gemini-3-5-flash', cc_model: 'gemini-3-5-flash' },
];

/** UUID → slug map derived from REGISTRY_ENTRIES */
function buildUuidToSlug(entries = REGISTRY_ENTRIES) {
  const map = new Map();
  for (const e of entries) map.set(e.id, e.slug);
  return map;
}

// ---------------------------------------------------------------------------
// resolveModel() — priority chain
// ---------------------------------------------------------------------------

describe('resolveModel()', () => {

  // AC-7, chain step 1: per-persona assignment overrides everything else
  it('returns the per-persona assignment when present (priority 1)', () => {
    const assignments = {
      default_model_uuid: '00000000-0000-0000-0000-000000000001', // Opus — should be ignored
      persona_models: {
        'my-persona-id': '00000000-0000-0000-0000-000000000003', // Gemini
      },
    };

    const result = resolveModel(
      'my-persona-id',
      'claude-sonnet-4-6',       // per-persona YAML slug — should be ignored
      'claude-opus-4-6',         // shared default slug  — should be ignored
      'Claude Opus 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Gemini 3.5 Flash',
      model_slug: 'gemini-3-5-flash',
      cc_model:   'gemini-3-5-flash',
    });
  });

  // AC-7, chain step 2: per-persona YAML slug used when no persona assignment
  it('returns the per-persona YAML slug when no assignment for this persona (priority 2)', () => {
    const assignments = {
      default_model_uuid: '00000000-0000-0000-0000-000000000001', // Opus — should be ignored
      persona_models: {}, // no entry for this persona
    };

    const result = resolveModel(
      'my-persona-id',
      'gemini-3-5-flash',    // per-persona YAML slug
      'claude-opus-4-6',     // shared default — should be ignored
      'Claude Opus 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Gemini 3.5 Flash',
      model_slug: 'gemini-3-5-flash',
      cc_model:   'gemini-3-5-flash',
    });
  });

  // AC-7, chain step 3: default_model_uuid used when no persona assignment and no YAML slug
  it('returns the default assignment slug when no per-persona assignment or YAML slug (priority 3)', () => {
    const assignments = {
      default_model_uuid: '00000000-0000-0000-0000-000000000003', // Gemini
      persona_models: {},
    };

    const result = resolveModel(
      'my-persona-id',
      undefined,         // no per-persona YAML slug
      'claude-opus-4-6', // shared default — should be ignored (assignment takes priority)
      'Claude Opus 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Gemini 3.5 Flash',
      model_slug: 'gemini-3-5-flash',
      cc_model:   'gemini-3-5-flash',
    });
  });

  // AC-7, chain step 4: _shared.yaml default used when no assignments and no YAML slug
  it('falls back to _shared.yaml default model slug (priority 4)', () => {
    const result = resolveModel(
      'my-persona-id',
      undefined,             // no per-persona YAML slug
      'claude-sonnet-4-6',   // shared default slug
      'Claude Sonnet 4.6',
      buildUuidToSlug(),
      null,                  // no assignments
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Claude Sonnet 4.6',
      model_slug: 'claude-sonnet-4-6',
      cc_model:   'inherit',
    });
  });

  // AC-5: no model configured → inherit sentinel
  it('returns the inherit sentinel when no model is configured anywhere (priority 5)', () => {
    const result = resolveModel(
      'my-persona-id',
      undefined,   // no per-persona YAML slug
      undefined,   // no shared default
      undefined,
      new Map(),   // empty UUID map
      null,        // no assignments
      [],          // empty registry
    );

    expect(result).toEqual({
      model:      'Inherit / Auto',
      model_slug: 'inherit',
      cc_model:   'inherit',
    });
  });

  // AC-2 (from WP-004, mirrored here for the name-mapping): per-persona assignment
  // with "inherit" slug → skip and fall back to next level
  it('skips a per-persona assignment when its resolved slug is "inherit" and falls through to YAML', () => {
    const assignments = {
      default_model_uuid: '00000000-0000-0000-0000-000000000001', // Opus — also below inherit
      persona_models: {
        'my-persona-id': '00000000-0000-0000-0000-000000000000', // inherit UUID
      },
    };

    const result = resolveModel(
      'my-persona-id',
      'gemini-3-5-flash',    // per-persona YAML slug — should be used after inherit skip
      'claude-opus-4-6',
      'Claude Opus 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Gemini 3.5 Flash',
      model_slug: 'gemini-3-5-flash',
      cc_model:   'gemini-3-5-flash',
    });
  });

  it('skips default_model_uuid when its resolved slug is "inherit" and falls through to shared YAML default', () => {
    const assignments = {
      default_model_uuid: '00000000-0000-0000-0000-000000000000', // inherit UUID
      persona_models: {},
    };

    const result = resolveModel(
      'my-persona-id',
      undefined,             // no per-persona YAML slug
      'claude-sonnet-4-6',   // shared default
      'Claude Sonnet 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    expect(result).toEqual({
      model:      'Claude Sonnet 4.6',
      model_slug: 'claude-sonnet-4-6',
      cc_model:   'inherit',
    });
  });

  it('returns model name from shared default name parameter when registry entry is absent', () => {
    // Simulate a model slug that exists in the shared YAML but not in the registry
    const result = resolveModel(
      'my-persona-id',
      undefined,
      'custom-model',
      'My Custom Model',
      new Map(),
      null,
      [],
    );

    expect(result).toEqual({
      model:      'My Custom Model',
      model_slug: 'custom-model',
      cc_model:   'inherit',
    });
  });

  it('falls back to slug as name when sharedModelName is absent and slug has no registry entry', () => {
    const result = resolveModel(
      'my-persona-id',
      undefined,
      'some-unknown-slug',
      undefined,
      new Map(),
      null,
      [],
    );

    expect(result).toEqual({
      model:      'some-unknown-slug',
      model_slug: 'some-unknown-slug',
      cc_model:   'inherit',
    });
  });

  // Partial assignments: only specified personas are overridden
  it('leaves unspecified personas unaffected (partial assignments)', () => {
    const assignments = {
      default_model_uuid: undefined,
      persona_models: {
        'other-persona': '00000000-0000-0000-0000-000000000003', // Gemini for other
      },
    };

    // 'my-persona-id' is NOT in persona_models
    const result = resolveModel(
      'my-persona-id',
      undefined,
      'claude-sonnet-4-6',
      'Claude Sonnet 4.6',
      buildUuidToSlug(),
      assignments,
      REGISTRY_ENTRIES,
    );

    // Falls through to shared default
    expect(result.model_slug).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// loadModelRegistry() — file loading and graceful degradation
// ---------------------------------------------------------------------------

describe('loadModelRegistry()', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-model-resolution-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty uuidToSlug and null assignments when registry dir has no files', () => {
    const result = loadModelRegistry(tmpDir);

    expect(result.uuidToSlug.size).toBe(0);
    expect(result.registryEntries).toEqual([]);
    expect(result.assignments).toBeNull();
  });

  it('reads default.json when local.json is absent', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'default.json'),
      JSON.stringify(REGISTRY_ENTRIES),
      'utf8',
    );

    const result = loadModelRegistry(tmpDir);

    expect(result.uuidToSlug.get('00000000-0000-0000-0000-000000000002')).toBe('claude-sonnet-4-6');
    expect(result.registryEntries).toHaveLength(REGISTRY_ENTRIES.length);
  });

  it('prefers local.json over default.json when both exist', () => {
    const localEntries = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Custom Model', slug: 'custom', cc_model: 'custom-api' },
    ];
    fs.writeFileSync(path.join(tmpDir, 'default.json'), JSON.stringify(REGISTRY_ENTRIES), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'local.json'),   JSON.stringify(localEntries),    'utf8');

    const result = loadModelRegistry(tmpDir);

    expect(result.uuidToSlug.get('aaaaaaaa-0000-0000-0000-000000000001')).toBe('custom');
    // default.json entries should NOT be present (local.json is used exclusively)
    expect(result.uuidToSlug.has('00000000-0000-0000-0000-000000000001')).toBe(false);
  });

  it('loads assignments.json when present', () => {
    const assignmentsData = {
      default_model_uuid: '00000000-0000-0000-0000-000000000002',
      persona_models: { 'ledger-3-dev': '00000000-0000-0000-0000-000000000001' },
    };
    fs.writeFileSync(path.join(tmpDir, 'local.json'),     JSON.stringify(REGISTRY_ENTRIES), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'assignments.json'), JSON.stringify(assignmentsData), 'utf8');

    const result = loadModelRegistry(tmpDir);

    expect(result.assignments).toEqual(assignmentsData);
  });

  it('returns null assignments when assignments.json is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'local.json'), JSON.stringify(REGISTRY_ENTRIES), 'utf8');

    const result = loadModelRegistry(tmpDir);

    expect(result.assignments).toBeNull();
  });

  it('warns and returns empty data when local.json is malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'local.json'), 'not valid json', 'utf8');

    const warnings = [];
    const result = loadModelRegistry(tmpDir, { warn: (msg) => warnings.push(msg) });

    expect(result.uuidToSlug.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/failed to parse/i);
  });

  it('warns and returns null assignments when assignments.json is malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'local.json'),     JSON.stringify(REGISTRY_ENTRIES), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'assignments.json'), 'not valid json', 'utf8');

    const warnings = [];
    const result = loadModelRegistry(tmpDir, { warn: (msg) => warnings.push(msg) });

    expect(result.assignments).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
