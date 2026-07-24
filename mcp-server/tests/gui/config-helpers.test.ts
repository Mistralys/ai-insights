// @vitest-environment jsdom

/**
 * Unit tests for pure-function helpers in the config view modules.
 *
 * Covers:
 *   - mrDeriveSlug    (config-model-registry.js)
 *   - mrValidateSlug  (config-model-registry.js)
 *   - mrHasChanges    (config-model-registry.js)  — reads mrModels / mrOriginal globals
 *   - pmCloneAssignments (config-persona-models.js)
 *
 * Loading strategy: vm.runInThisContext() evaluates the vanilla JS files in the
 * jsdom globalThis context so that their `var` and `function` declarations become
 * accessible as globalThis properties — no module system required.
 *
 * Minimal stubs for dependencies referenced by non-target functions (UI,
 * escapeHtml, API, configDirty) are provided in beforeAll so that loading the
 * files does not throw ReferenceErrors.  The stub values are never exercised by
 * the pure helpers under test.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import vm               from 'node:vm';

// ---------------------------------------------------------------------------
// Load source files via vm.runInThisContext
// ---------------------------------------------------------------------------

const publicDir = join(__dirname, '../../gui/public');

beforeAll(() => {
  // Stubs required to prevent ReferenceErrors when the broader function bodies
  // in the loaded files are *parsed* (not executed — only the pure helpers are
  // called, but the JS engine still needs all referenced globals to be in scope
  // for `vm.runInThisContext` to succeed when `var` declarations reference them
  // in other function bodies).
  //
  // escapeHtml and UI are loaded by setup-gui-globals.ts in jsdom environments.
  // We only need to stub references that setup-gui-globals does NOT provide.

  if (!(globalThis as Record<string, unknown>)['API']) {
    (globalThis as Record<string, unknown>)['API'] = {};
  }
  if (!(globalThis as Record<string, unknown>)['configDirty']) {
    (globalThis as Record<string, unknown>)['configDirty'] = {
      modelRegistry:   false,
      personaModels:   false,
    };
  }

  // Load the two view modules into globalThis.
  vm.runInThisContext(readFileSync(join(publicDir, 'views/config-model-registry.js'),  'utf-8'));
  vm.runInThisContext(readFileSync(join(publicDir, 'views/config-persona-models.js'),  'utf-8'));
});

// ---------------------------------------------------------------------------
// TypeScript global declarations for the functions under test
// ---------------------------------------------------------------------------

declare global {
  // config-model-registry.js
  // eslint-disable-next-line no-var
  var mrDeriveSlug:   (name: string | null | undefined) => string;
  // eslint-disable-next-line no-var
  var mrValidateSlug: (slug: string | null | undefined) => string;
  // eslint-disable-next-line no-var
  var mrHasChanges:   () => boolean;
  // eslint-disable-next-line no-var
  var mrModels:       Array<Record<string, unknown>> | null;
  // eslint-disable-next-line no-var
  var mrOriginal:     Array<Record<string, unknown>> | null;

  // config-persona-models.js
  // eslint-disable-next-line no-var
  var pmCloneAssignments: (a: Record<string, unknown> | null | undefined) => {
    default_model_uuid?: string;
    persona_models: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// mrDeriveSlug
// ---------------------------------------------------------------------------

describe('mrDeriveSlug', () => {
  it('lowercases the name', () => {
    expect(globalThis.mrDeriveSlug('ClaudeOpus')).toBe('claudeopus');
  });

  it('replaces spaces with hyphens', () => {
    expect(globalThis.mrDeriveSlug('Claude Opus 4')).toBe('claude-opus-4');
  });

  it('collapses multiple consecutive spaces into a single hyphen', () => {
    expect(globalThis.mrDeriveSlug('Claude  Opus   4')).toBe('claude-opus-4');
  });

  it('strips special characters', () => {
    expect(globalThis.mrDeriveSlug('Claude (Opus) 4!')).toBe('claude-opus-4');
  });

  it('collapses consecutive hyphens produced by stripping', () => {
    // "Foo & Bar" → "foo--bar" → "foo-bar"
    expect(globalThis.mrDeriveSlug('Foo & Bar')).toBe('foo-bar');
  });

  it('strips leading and trailing hyphens', () => {
    // "---hello---" → keeps "hello"
    expect(globalThis.mrDeriveSlug('---hello---')).toBe('hello');
  });

  it('handles unicode characters by stripping non-ASCII', () => {
    // "Ünïcödé Mödel" → lowercase, spaces→hyphens, non-[a-z0-9-] stripped
    // Ü→ü→'' ï→'' c→c ö→'' d→d é→'' → "ncd" then " " → "-" then M→m ö→'' d→d e→e l→l → "mdel"
    expect(globalThis.mrDeriveSlug('Ünïcödé Mödel')).toBe('ncd-mdel');
  });

  it('returns empty string for an empty string input', () => {
    expect(globalThis.mrDeriveSlug('')).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(globalThis.mrDeriveSlug(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(globalThis.mrDeriveSlug(undefined)).toBe('');
  });

  it('handles a name that is entirely special characters', () => {
    expect(globalThis.mrDeriveSlug('!@#$%^&*()')).toBe('');
  });

  it('preserves numbers mixed with letters', () => {
    expect(globalThis.mrDeriveSlug('GPT 4o Mini')).toBe('gpt-4o-mini');
  });
});

// ---------------------------------------------------------------------------
// mrValidateSlug
// ---------------------------------------------------------------------------

describe('mrValidateSlug', () => {
  it('returns error for empty string', () => {
    expect(globalThis.mrValidateSlug('')).toBe('Slug is required.');
  });

  it('returns error for whitespace-only string', () => {
    expect(globalThis.mrValidateSlug('   ')).toBe('Slug is required.');
  });

  it('returns error for null input', () => {
    expect(globalThis.mrValidateSlug(null)).toBe('Slug is required.');
  });

  it('returns error for undefined input', () => {
    expect(globalThis.mrValidateSlug(undefined)).toBe('Slug is required.');
  });

  it('returns error for the reserved slug "inherit"', () => {
    expect(globalThis.mrValidateSlug('inherit')).toBe('The slug "inherit" is reserved.');
  });

  it('returns empty string for a valid single-segment slug', () => {
    expect(globalThis.mrValidateSlug('mymodel')).toBe('');
  });

  it('returns empty string for a valid multi-segment slug', () => {
    expect(globalThis.mrValidateSlug('claude-opus-4')).toBe('');
  });

  it('returns empty string for a slug with uppercase letters', () => {
    expect(globalThis.mrValidateSlug('ClaudeOpus')).toBe('');
  });

  it('returns error when slug has a leading hyphen', () => {
    expect(globalThis.mrValidateSlug('-my-model')).not.toBe('');
  });

  it('returns empty string for a slug with a trailing hyphen', () => {
    expect(globalThis.mrValidateSlug('my-model-')).toBe('');
  });

  it('returns empty string for a slug with spaces', () => {
    expect(globalThis.mrValidateSlug('Claude Opus 4.6 (anthropic)')).toBe('');
  });

  it('returns error when slug contains special characters', () => {
    const msg = globalThis.mrValidateSlug('my_model!');
    expect(msg).not.toBe('');
  });

  it('returns empty string for a slug with consecutive hyphens', () => {
    expect(globalThis.mrValidateSlug('my--model')).toBe('');
  });

  it('returns empty string for slug with numbers', () => {
    expect(globalThis.mrValidateSlug('gpt-4o')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mrHasChanges — manipulates mrModels / mrOriginal globals directly
// ---------------------------------------------------------------------------

describe('mrHasChanges', () => {
  /** Reset global state before each test to prevent cross-test leakage. */
  beforeEach(() => {
    globalThis.mrModels   = null;
    globalThis.mrOriginal = null;
  });

  it('returns false when both mrModels and mrOriginal are null', () => {
    expect(globalThis.mrHasChanges()).toBe(false);
  });

  it('returns false when mrModels is null but mrOriginal is set', () => {
    globalThis.mrOriginal = [{ id: '1', name: 'A', slug: 'a', cc_model: 'inherit', _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(false);
  });

  it('returns false when mrOriginal is null but mrModels is set', () => {
    globalThis.mrModels = [{ id: '1', name: 'A', slug: 'a', cc_model: 'inherit', _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(false);
  });

  it('returns false when working copy matches original exactly', () => {
    const model = { id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: false };
    globalThis.mrModels   = [{ ...model }];
    globalThis.mrOriginal = [{ ...model }];
    expect(globalThis.mrHasChanges()).toBe(false);
  });

  it('returns false for multiple identical models', () => {
    const m1 = { id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: false };
    const m2 = { id: '2', name: 'Beta',  slug: 'beta',  cc_model: 'inherit', _deleted: false };
    globalThis.mrModels   = [{ ...m1 }, { ...m2 }];
    globalThis.mrOriginal = [{ ...m1 }, { ...m2 }];
    expect(globalThis.mrHasChanges()).toBe(false);
  });

  it('returns true when a model has been added (arrays differ in length)', () => {
    const m1 = { id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: false };
    const m2 = { id: '2', name: 'Beta',  slug: 'beta',  cc_model: 'inherit', _deleted: false };
    globalThis.mrModels   = [{ ...m1 }, { ...m2 }];
    globalThis.mrOriginal = [{ ...m1 }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });

  it('returns true when a model has been removed (arrays differ in length)', () => {
    const m1 = { id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: false };
    const m2 = { id: '2', name: 'Beta',  slug: 'beta',  cc_model: 'inherit', _deleted: false };
    globalThis.mrModels   = [{ ...m1 }];
    globalThis.mrOriginal = [{ ...m1 }, { ...m2 }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });

  it('returns true when a model name has been modified', () => {
    globalThis.mrModels   = [{ id: '1', name: 'New Name', slug: 'alpha', cc_model: 'inherit', _deleted: false }];
    globalThis.mrOriginal = [{ id: '1', name: 'Old Name', slug: 'alpha', cc_model: 'inherit', _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });

  it('returns true when a model slug has been modified', () => {
    globalThis.mrModels   = [{ id: '1', name: 'Alpha', slug: 'alpha-new', cc_model: 'inherit', _deleted: false }];
    globalThis.mrOriginal = [{ id: '1', name: 'Alpha', slug: 'alpha',     cc_model: 'inherit', _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });

  it('returns true when a model cc_model has been modified', () => {
    globalThis.mrModels   = [{ id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'claude-opus',  _deleted: false }];
    globalThis.mrOriginal = [{ id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit',       _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });

  it('returns true when _deleted flag is toggled on a model', () => {
    globalThis.mrModels   = [{ id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: true }];
    globalThis.mrOriginal = [{ id: '1', name: 'Alpha', slug: 'alpha', cc_model: 'inherit', _deleted: false }];
    expect(globalThis.mrHasChanges()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pmCloneAssignments
// ---------------------------------------------------------------------------

describe('pmCloneAssignments', () => {
  it('returns a default empty object when called with null', () => {
    const result = globalThis.pmCloneAssignments(null);
    expect(result).toEqual({ persona_models: {} });
  });

  it('returns a default empty object when called with undefined', () => {
    const result = globalThis.pmCloneAssignments(undefined);
    expect(result).toEqual({ persona_models: {} });
  });

  it('clones default_model_uuid correctly', () => {
    const input = { default_model_uuid: 'uuid-1234', persona_models: {} };
    const result = globalThis.pmCloneAssignments(input);
    expect(result.default_model_uuid).toBe('uuid-1234');
  });

  it('preserves persona_models entries in the clone', () => {
    const input = {
      default_model_uuid: 'uuid-1234',
      persona_models: { 'persona-a': 'uuid-a', 'persona-b': 'uuid-b' },
    };
    const result = globalThis.pmCloneAssignments(input);
    expect(result.persona_models).toEqual({ 'persona-a': 'uuid-a', 'persona-b': 'uuid-b' });
  });

  it('produces a shallow clone — mutations to persona_models in clone do not affect original', () => {
    const input = {
      default_model_uuid: 'uuid-1234',
      persona_models: { 'persona-a': 'uuid-a' },
    };
    const result = globalThis.pmCloneAssignments(input);
    (result.persona_models as Record<string, string>)['persona-new'] = 'uuid-new';

    // Original must be unaffected
    expect((input.persona_models as Record<string, string>)['persona-new']).toBeUndefined();
  });

  it('mutations to default_model_uuid in clone do not affect original', () => {
    const input = { default_model_uuid: 'original-uuid', persona_models: {} };
    const result = globalThis.pmCloneAssignments(input);
    (result as Record<string, unknown>).default_model_uuid = 'mutated-uuid';

    expect((input as Record<string, unknown>).default_model_uuid).toBe('original-uuid');
  });

  it('handles input with undefined default_model_uuid', () => {
    const input = { persona_models: { 'persona-a': 'uuid-a' } };
    const result = globalThis.pmCloneAssignments(input);
    expect(result.default_model_uuid).toBeUndefined();
    expect(result.persona_models).toEqual({ 'persona-a': 'uuid-a' });
  });

  it('handles input with null or undefined persona_models gracefully', () => {
    const input = { default_model_uuid: 'uuid-1', persona_models: null };
    const result = globalThis.pmCloneAssignments(input);
    expect(result.persona_models).toEqual({});
  });
});
