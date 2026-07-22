/**
 * Tests for src/gui/model-registry.ts (WP-002)
 *
 * Uses real temp directories and the real filesystem — no mocks.
 * The module-under-test is re-imported per describe block via a path override
 * technique: we pass explicit file paths to each function rather than relying
 * on the module-level WORKSPACE_ROOT constant, so the module is called with
 * temp-dir paths via its exported public functions.
 *
 * Because WORKSPACE_ROOT is compiled in at module load time, we exercise the
 * public API directly and pass paths by constructing test-specific registries
 * in temp directories.  All tested functions accept derived paths from
 * `getModelRegistryPath()` internally, so we test them end-to-end by writing
 * the right files into the temp dir and letting the module use its own path
 * resolution — BUT since we cannot redirect WORKSPACE_ROOT in tests, all tests
 * that need filesystem isolation use the module's exported functions after
 * pre-seeding a temp dir AND leverage the fact that each function resolves its
 * own paths.
 *
 * IMPORTANT: To isolate tests from the real filesystem (personas/model-registry/)
 * we mock the path resolution by re-exporting a test-scoped version via the
 * tested module's dependency on `join(WORKSPACE_ROOT, 'personas', 'model-registry')`.
 * Since we cannot easily swap WORKSPACE_ROOT, we instead import and re-export
 * *all public functions* and inject the test temp dir by temporarily symlinking
 * or — more practically — by writing a thin test harness that calls the
 * underlying logic with injected paths.
 *
 * ACTUALLY: The cleanest approach for this module is to verify each function's
 * behavior by seeding the real model-registry path (personas/model-registry/)
 * with test data and restoring it after.  However, this risks data loss.
 *
 * PREFERRED: We expose the path constants as injectable parameters via an
 * optional second argument pattern.  Since the module doesn't support this
 * directly, we instead test using vitest's module mock feature (`vi.mock`) to
 * override the path utilities.
 *
 * FINAL DECISION: Use `vi.mock` to intercept `../utils/ledger-root.js` and
 * return a temp directory as WORKSPACE_ROOT.  This is the standard approach
 * for testing modules with baked-in path constants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Module mocking — redirect WORKSPACE_ROOT to a temp dir
// ---------------------------------------------------------------------------

let tempWorkspaceRoot = '';

vi.mock('../../src/utils/ledger-root.js', () => ({
  get WORKSPACE_ROOT() {
    return tempWorkspaceRoot;
  },
  // Provide other exports that may be imported transitively
  ORCHESTRATOR_LOGS_DIR: '/tmp/orchestrator-logs',
  resolveLedgerRoot: () => '/tmp/ledger',
  projectSlugFromPath: (p: string) => p,
  inferProjectRootFromPlanPath: () => null,
  repositoryNameFromPlanPath: () => 'unknown',
}));

// Import module AFTER the mock is registered
import {
  ModelEntrySchema,
  ModelRegistrySchema,
  ModelAssignmentsSchema,
  getModelRegistryPath,
  readModels,
  writeModels,
  readAssignments,
  writeAssignments,
  loadDefaults,
  isModelReferenced,
  getResolvedAssignments,
} from '../../src/gui/model-registry.js';

// ---------------------------------------------------------------------------
// Test data fixtures
// ---------------------------------------------------------------------------

const DEFAULT_ENTRIES = [
  { id: '00000000-0000-0000-0000-000000000000', name: 'Inherit / Auto', slug: 'inherit', cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000001', name: 'Claude Opus 4.6', slug: 'claude-opus-4-6', cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Claude Sonnet 4.6', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Gemini 3.5 Flash', slug: 'gemini-3-5-flash', cc_model: 'gemini-3-5-flash' },
];

const REGISTRY_DIR = 'personas/model-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registryDir(): string {
  return join(tempWorkspaceRoot, REGISTRY_DIR);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function seedDefaultJson(entries = DEFAULT_ENTRIES): Promise<void> {
  await writeJson(join(registryDir(), 'default.json'), entries);
}

async function seedLocalJson(entries: unknown[]): Promise<void> {
  await writeJson(join(registryDir(), 'local.json'), entries);
}

async function seedAssignmentsJson(data: unknown): Promise<void> {
  await writeJson(join(registryDir(), 'assignments.json'), data);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('model-registry.ts', () => {
  beforeEach(async () => {
    // Create a fresh temp workspace with the model-registry subdirectory
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'model-registry-test-'));
    await mkdir(join(tempWorkspaceRoot, REGISTRY_DIR), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempWorkspaceRoot, { recursive: true, force: true });
  });

  // ─── ModelEntrySchema ────────────────────────────────────────────────────

  describe('ModelEntrySchema (AC-1)', () => {
    it('accepts a valid entry with all required fields', () => {
      const result = ModelEntrySchema.safeParse({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'My Model',
        slug: 'my-model',
        cc_model: 'my-model',
      });
      expect(result.success).toBe(true);
    });

    it('validates UUID format for id', () => {
      const result = ModelEntrySchema.safeParse({
        id: 'not-a-uuid',
        name: 'My Model',
        slug: 'my-model',
        cc_model: 'inherit',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = ModelEntrySchema.safeParse({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: '',
        slug: 'my-model',
        cc_model: 'inherit',
      });
      expect(result.success).toBe(false);
    });

    it('accepts slug matching /^[a-z0-9]+(-[a-z0-9]+)*$/', () => {
      const validSlugs = ['mymodel', 'my-model', 'claude-opus-4-6', 'abc123', 'a1b2-c3d4'];
      for (const slug of validSlugs) {
        const result = ModelEntrySchema.safeParse({
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'X',
          slug,
          cc_model: 'inherit',
        });
        expect(result.success, `slug "${slug}" should be valid`).toBe(true);
      }
    });

    it('rejects invalid slugs', () => {
      const invalidSlugs = ['My-Model', 'my_model', '-my-model', 'my-model-', 'my--model', 'my model'];
      for (const slug of invalidSlugs) {
        const result = ModelEntrySchema.safeParse({
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'X',
          slug,
          cc_model: 'inherit',
        });
        expect(result.success, `slug "${slug}" should be invalid`).toBe(false);
      }
    });

    it('defaults cc_model to "inherit" when omitted', () => {
      const result = ModelEntrySchema.safeParse({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'My Model',
        slug: 'my-model',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cc_model).toBe('inherit');
      }
    });

    it('rejects empty cc_model string', () => {
      const result = ModelEntrySchema.safeParse({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'My Model',
        slug: 'my-model',
        cc_model: '',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── ModelAssignmentsSchema ──────────────────────────────────────────────

  describe('ModelAssignmentsSchema', () => {
    it('accepts a valid assignments object', () => {
      const result = ModelAssignmentsSchema.safeParse({
        default_model_uuid: '00000000-0000-0000-0000-000000000001',
        persona_models: {
          'ledger-1-planner': '00000000-0000-0000-0000-000000000001',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts missing default_model_uuid (optional)', () => {
      const result = ModelAssignmentsSchema.safeParse({ persona_models: {} });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID values in persona_models', () => {
      const result = ModelAssignmentsSchema.safeParse({
        persona_models: { 'ledger-1-planner': 'not-a-uuid' },
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── getModelRegistryPath ────────────────────────────────────────────────

  describe('getModelRegistryPath', () => {
    it('returns a path ending with personas/model-registry', () => {
      const p = getModelRegistryPath();
      expect(p).toContain(join('personas', 'model-registry'));
    });
  });

  // ─── readModels — auto-initialization ────────────────────────────────────

  describe('readModels — auto-initialization (AC-2)', () => {
    it('auto-initializes local.json from default.json when local.json does not exist', async () => {
      await seedDefaultJson();

      const models = await readModels();

      expect(models).toHaveLength(4);
      expect(models[0]!.slug).toBe('inherit');
      expect(models[1]!.slug).toBe('claude-opus-4-6');
      expect(models[2]!.slug).toBe('claude-sonnet-4-6');
      expect(models[3]!.slug).toBe('gemini-3-5-flash');
    });

    it('creates local.json on disk after auto-initialization', async () => {
      await seedDefaultJson();
      await readModels();

      // Verify local.json was written
      const { readFile: rf } = await import('fs/promises');
      const raw = await rf(join(registryDir(), 'local.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(4);
    });

    it('returns exactly the 4 default entries after auto-initialization', async () => {
      await seedDefaultJson();
      const models = await readModels();

      expect(models).toHaveLength(4);
      const ids = models.map((m) => m.id);
      expect(ids).toContain('00000000-0000-0000-0000-000000000000');
      expect(ids).toContain('00000000-0000-0000-0000-000000000001');
      expect(ids).toContain('00000000-0000-0000-0000-000000000002');
      expect(ids).toContain('00000000-0000-0000-0000-000000000003');
    });
  });

  // ─── readModels — existing local.json ────────────────────────────────────

  describe('readModels — existing local.json (AC-3)', () => {
    it('reads existing local.json without touching default.json', async () => {
      const localEntries = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000000', name: 'Custom Model', slug: 'custom-model', cc_model: 'inherit' },
      ];
      await seedLocalJson(localEntries);
      // No default.json created — if readModels touches it we'd get an error

      const models = await readModels();

      expect(models).toHaveLength(1);
      expect(models[0]!.slug).toBe('custom-model');
    });

    it('returns the user-defined models from local.json, not defaults', async () => {
      // Seed default.json with 4 entries
      await seedDefaultJson();
      // Seed local.json with different entries
      const localEntries = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'My GPT', slug: 'my-gpt', cc_model: 'inherit' },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'My Llama', slug: 'my-llama', cc_model: 'my-llama' },
      ];
      await seedLocalJson(localEntries);

      const models = await readModels();

      expect(models).toHaveLength(2);
      expect(models[0]!.slug).toBe('my-gpt');
      expect(models[1]!.slug).toBe('my-llama');
    });
  });

  // ─── writeModels — duplicate slug rejection ───────────────────────────────

  describe('writeModels — duplicate slug rejection (AC-4)', () => {
    it('rejects a model list containing duplicate slugs', async () => {
      await seedDefaultJson();
      await seedLocalJson([]); // so readModels does not call auto-init

      const duplicates = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Model A', slug: 'same-slug', cc_model: 'inherit' },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Model B', slug: 'same-slug', cc_model: 'inherit' },
      ];

      const { ApiError } = await import('../../src/gui/errors.js');
      await expect(writeModels(duplicates)).rejects.toThrow(ApiError);
      await expect(writeModels(duplicates)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('does not write local.json when duplicate slugs are detected', async () => {
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Original', slug: 'original', cc_model: 'inherit' },
      ]);

      const duplicates = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Dup A', slug: 'dup', cc_model: 'inherit' },
        { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Dup B', slug: 'dup', cc_model: 'inherit' },
      ];

      try {
        await writeModels(duplicates);
      } catch {
        // expected
      }

      // Original local.json should be unchanged
      const models = await readModels();
      expect(models[0]!.slug).toBe('original');
    });
  });

  // ─── writeModels — reserved slug enforcement ──────────────────────────────

  describe('writeModels — reserved slug enforcement (AC-5)', () => {
    it('rejects the "inherit" slug on non-sentinel entries', async () => {
      await seedLocalJson([]);

      const badEntries = [
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Fake Inherit', slug: 'inherit', cc_model: 'inherit' },
      ];

      const { ApiError } = await import('../../src/gui/errors.js');
      await expect(writeModels(badEntries)).rejects.toThrow(ApiError);
      await expect(writeModels(badEntries)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('accepts the "inherit" slug on the sentinel entry (UUID 00000000-...)', async () => {
      await seedLocalJson([]);

      const sentinelEntry = [
        { id: '00000000-0000-0000-0000-000000000000', name: 'Inherit / Auto', slug: 'inherit', cc_model: 'inherit' },
      ];

      const result = await writeModels(sentinelEntry);
      expect(result.saved).toBe(true);
    });
  });

  // ─── writeModels — deletion guard (referenced models) ────────────────────

  describe('writeModels — deletion guard (AC-6)', () => {
    it('rejects deletion of a model referenced in assignments.json', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      await seedLocalJson([
        { id: modelId, name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
        { id: '00000000-0000-0000-0000-000000000002', name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
      ]);
      await seedAssignmentsJson({
        default_model_uuid: modelId,
        persona_models: { 'ledger-1-planner': modelId },
      });

      // Attempt to save without the referenced model
      const remainingModels = [
        { id: '00000000-0000-0000-0000-000000000002', name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
      ];

      const result = await writeModels(remainingModels);

      expect(result.saved).toBe(false);
      if (!result.saved) {
        expect(result.referencedModels).toHaveLength(1);
        expect(result.referencedModels[0]!.model.id).toBe(modelId);
        expect(result.referencedModels[0]!.usages).toContain('default');
        expect(result.referencedModels[0]!.usages).toContain('ledger-1-planner');
      }
    });

    it('returns usages listing both "default" and persona IDs', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      await seedLocalJson([
        { id: modelId, name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      await seedAssignmentsJson({
        default_model_uuid: modelId,
        persona_models: {
          'ledger-1-planner': modelId,
          'ledger-2-pm': modelId,
        },
      });

      const result = await writeModels([]);
      expect(result.saved).toBe(false);
      if (!result.saved) {
        const usages = result.referencedModels[0]!.usages;
        expect(usages).toContain('default');
        expect(usages).toContain('ledger-1-planner');
        expect(usages).toContain('ledger-2-pm');
      }
    });

    it('rejects write when local.json is corrupt JSON (PARSE_ERROR bypasses deletion guard)', async () => {
      // Write invalid JSON to local.json — simulates on-disk corruption
      await writeFile(join(registryDir(), 'local.json'), '{ not valid json !!!', 'utf-8');
      // writeModels must NOT silently proceed; it must throw ApiError (PARSE_ERROR)
      await expect(
        writeModels([{ id: '00000000-0000-0000-0000-000000000001', name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' }])
      ).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    });

    it('rejects write when local.json fails schema validation (VALIDATION_ERROR bypasses deletion guard)', async () => {
      // Write structurally valid JSON but with entries that fail ModelEntrySchema
      await writeFile(
        join(registryDir(), 'local.json'),
        JSON.stringify([{ id: 'not-a-uuid', name: 'Bad', slug: 'bad', cc_model: 'inherit' }]),
        'utf-8'
      );
      await expect(
        writeModels([{ id: '00000000-0000-0000-0000-000000000001', name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' }])
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  // ─── writeModels — succeeds for unreferenced removals ────────────────────

  describe('writeModels — unreferenced removal succeeds (AC-7)', () => {
    it('succeeds when removing a model not referenced in assignments', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      const keepId = '00000000-0000-0000-0000-000000000002';
      await seedLocalJson([
        { id: modelId, name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
        { id: keepId, name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
      ]);
      // assignments.json does NOT reference modelId
      await seedAssignmentsJson({ persona_models: {} });

      const keepOnly = [{ id: keepId, name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' }];
      const result = await writeModels(keepOnly);

      expect(result.saved).toBe(true);
      if (result.saved) {
        expect(result.models).toHaveLength(1);
        expect(result.models[0]!.id).toBe(keepId);
      }
    });

    it('persists the updated list to local.json after unreferenced removal', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      const keepId = '00000000-0000-0000-0000-000000000002';
      await seedLocalJson([
        { id: modelId, name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
        { id: keepId, name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
      ]);
      await seedAssignmentsJson({ persona_models: {} });

      await writeModels([{ id: keepId, name: 'Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' }]);

      const afterRead = await readModels();
      expect(afterRead).toHaveLength(1);
      expect(afterRead[0]!.id).toBe(keepId);
    });
  });

  // ─── writeModels — slug rename stability ─────────────────────────────────

  describe('writeModels — slug rename leaves assignments.json unchanged (AC-8)', () => {
    it('assignments.json is not modified when a slug is renamed', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      await seedLocalJson([
        { id: modelId, name: 'Old Name', slug: 'old-slug', cc_model: 'inherit' },
      ]);
      const originalAssignments = {
        default_model_uuid: modelId,
        persona_models: { 'ledger-1-planner': modelId },
      };
      await seedAssignmentsJson(originalAssignments);

      // Rename the slug
      const renamedModel = [{ id: modelId, name: 'New Name', slug: 'new-slug', cc_model: 'inherit' }];
      const result = await writeModels(renamedModel);

      expect(result.saved).toBe(true);

      // assignments.json must still contain the original UUID values
      const assignments = await readAssignments();
      expect(assignments.default_model_uuid).toBe(modelId);
      expect(assignments.persona_models['ledger-1-planner']).toBe(modelId);
    });
  });

  // ─── loadDefaults ─────────────────────────────────────────────────────────

  describe('loadDefaults — merge logic (AC-9)', () => {
    it('adds default entries not already in local.json by id', async () => {
      await seedDefaultJson();
      // Start with one custom local entry (different ID, different slug)
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Custom', slug: 'custom', cc_model: 'inherit' },
      ]);

      const { models, conflicts } = await loadDefaults();

      // Custom entry + all 4 defaults = 5
      expect(models).toHaveLength(5);
      expect(conflicts).toHaveLength(0);
      const slugs = models.map((m) => m.slug);
      expect(slugs).toContain('custom');
      expect(slugs).toContain('inherit');
      expect(slugs).toContain('claude-opus-4-6');
    });

    it('does not overwrite existing local entries when their id matches a default', async () => {
      await seedDefaultJson();
      // local.json contains the "inherit" entry with the same UUID but different name
      await seedLocalJson([
        { id: '00000000-0000-0000-0000-000000000000', name: 'RENAMED Inherit', slug: 'inherit', cc_model: 'inherit' },
      ]);

      const { models } = await loadDefaults();

      const inheritEntry = models.find((m) => m.id === '00000000-0000-0000-0000-000000000000');
      expect(inheritEntry).toBeDefined();
      // Local entry wins — name should not be overwritten
      expect(inheritEntry!.name).toBe('RENAMED Inherit');
    });

    it('preserves existing local entries unchanged', async () => {
      await seedDefaultJson();
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000099', name: 'My Local', slug: 'my-local', cc_model: 'custom-model' },
      ]);

      const { models } = await loadDefaults();

      const local = models.find((m) => m.id === 'aaaaaaaa-0000-0000-0000-000000000099');
      expect(local).toBeDefined();
      expect(local!.name).toBe('My Local');
      expect(local!.cc_model).toBe('custom-model');
    });
  });

  // ─── loadDefaults — slug collision detection ──────────────────────────────

  describe('loadDefaults — slug collision detection (AC-10)', () => {
    it('detects slug collision when a default entry has a different id but same slug as a local entry', async () => {
      await seedDefaultJson([
        // The default "inherit" entry has id 00000000-...
        { id: '00000000-0000-0000-0000-000000000000', name: 'Inherit / Auto', slug: 'inherit', cc_model: 'inherit' },
        { id: '00000000-0000-0000-0000-000000000001', name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      // Local has a different entry with the same slug "claude-opus-4-6" but different UUID
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'My Opus Clone', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);

      const { models, conflicts } = await loadDefaults();

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.reason).toBe('slug_collision');
      expect(conflicts[0]!.defaultEntry.id).toBe('00000000-0000-0000-0000-000000000001');
      expect(conflicts[0]!.localEntry.id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
      // Conflicting default entry should NOT be added
      const opusEntries = models.filter((m) => m.slug === 'claude-opus-4-6');
      expect(opusEntries).toHaveLength(1); // Only the local copy
    });

    it('returns conflicts array containing conflicting entries', async () => {
      await seedDefaultJson();
      // Two local slugs that collide with defaults
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000010', name: 'Custom Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
        { id: 'aaaaaaaa-0000-0000-0000-000000000011', name: 'Custom Sonnet', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
      ]);

      const { conflicts } = await loadDefaults();
      expect(conflicts).toHaveLength(2);
    });

    it('does not add conflicting default entries to the merged list', async () => {
      await seedDefaultJson([
        { id: '00000000-0000-0000-0000-000000000001', name: 'Opus Default', slug: 'opus', cc_model: 'inherit' },
      ]);
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Opus Local', slug: 'opus', cc_model: 'inherit' },
      ]);

      const { models, conflicts } = await loadDefaults();

      expect(conflicts).toHaveLength(1);
      // Only the local version should appear
      const opusEntries = models.filter((m) => m.slug === 'opus');
      expect(opusEntries).toHaveLength(1);
      expect(opusEntries[0]!.id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    });
  });

  // ─── readAssignments — missing file ──────────────────────────────────────

  describe('readAssignments — missing file (AC-11)', () => {
    it('returns default structure when assignments.json does not exist', async () => {
      // Do not create assignments.json
      const result = await readAssignments();

      expect(result).toEqual({ default_model_uuid: undefined, persona_models: {} });
    });

    it('default_model_uuid is undefined in the default structure', async () => {
      const result = await readAssignments();
      expect(result.default_model_uuid).toBeUndefined();
    });

    it('persona_models is an empty object in the default structure', async () => {
      const result = await readAssignments();
      expect(result.persona_models).toEqual({});
    });
  });

  // ─── readAssignments — existing file ─────────────────────────────────────

  describe('readAssignments — existing file', () => {
    it('reads and returns existing assignments correctly', async () => {
      const data = {
        default_model_uuid: '00000000-0000-0000-0000-000000000002',
        persona_models: {
          'ledger-1-planner': '00000000-0000-0000-0000-000000000001',
          'ledger-2-pm': '00000000-0000-0000-0000-000000000002',
        },
      };
      await seedAssignmentsJson(data);

      const result = await readAssignments();
      expect(result.default_model_uuid).toBe('00000000-0000-0000-0000-000000000002');
      expect(result.persona_models['ledger-1-planner']).toBe('00000000-0000-0000-0000-000000000001');
    });
  });

  // ─── writeAssignments ─────────────────────────────────────────────────────

  describe('writeAssignments', () => {
    it('writes and reads back assignments correctly', async () => {
      const data = {
        default_model_uuid: '00000000-0000-0000-0000-000000000001' as string | undefined,
        persona_models: { 'standalone-developer': '00000000-0000-0000-0000-000000000002' },
      };
      await writeAssignments(data);
      const result = await readAssignments();
      expect(result.default_model_uuid).toBe('00000000-0000-0000-0000-000000000001');
      expect(result.persona_models['standalone-developer']).toBe('00000000-0000-0000-0000-000000000002');
    });

    it('creates assignments.json atomically', async () => {
      const { stat } = await import('fs/promises');
      await writeAssignments({ default_model_uuid: undefined, persona_models: {} });
      const stats = await stat(join(registryDir(), 'assignments.json'));
      expect(stats.isFile()).toBe(true);
    });
  });

  // ─── isModelReferenced ────────────────────────────────────────────────────

  describe('isModelReferenced', () => {
    it('returns referenced: false when assignments.json does not exist', async () => {
      const result = await isModelReferenced('00000000-0000-0000-0000-000000000001');
      expect(result.referenced).toBe(false);
      expect(result.usages).toEqual([]);
    });

    it('returns referenced: true with usages when model is the default', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      await seedAssignmentsJson({ default_model_uuid: modelId, persona_models: {} });

      const result = await isModelReferenced(modelId);
      expect(result.referenced).toBe(true);
      expect(result.usages).toContain('default');
    });

    it('returns persona IDs in usages when model is assigned to personas', async () => {
      const modelId = '00000000-0000-0000-0000-000000000001';
      await seedAssignmentsJson({
        default_model_uuid: undefined,
        persona_models: { 'ledger-3-dev': modelId, 'standalone-developer': modelId },
      });

      const result = await isModelReferenced(modelId);
      expect(result.referenced).toBe(true);
      expect(result.usages).toContain('ledger-3-dev');
      expect(result.usages).toContain('standalone-developer');
      expect(result.usages).not.toContain('default');
    });

    it('returns referenced: false when model UUID is not found in assignments', async () => {
      await seedAssignmentsJson({
        default_model_uuid: '00000000-0000-0000-0000-000000000002',
        persona_models: { 'ledger-1-planner': '00000000-0000-0000-0000-000000000002' },
      });

      const result = await isModelReferenced('aaaaaaaa-0000-0000-0000-000000000099');
      expect(result.referenced).toBe(false);
    });
  });

  // ─── getResolvedAssignments ───────────────────────────────────────────────

  describe('getResolvedAssignments (AC-12)', () => {
    it('returns null default_model_slug and empty persona_models when assignments.json does not exist', async () => {
      await seedLocalJson(DEFAULT_ENTRIES);

      const result = await getResolvedAssignments();
      expect(result.default_model_slug).toBeNull();
      expect(result.persona_models).toEqual({});
    });

    it('resolves default_model_uuid to its slug', async () => {
      await seedLocalJson(DEFAULT_ENTRIES);
      await seedAssignmentsJson({
        default_model_uuid: '00000000-0000-0000-0000-000000000002',
        persona_models: {},
      });

      const result = await getResolvedAssignments();
      expect(result.default_model_slug).toBe('claude-sonnet-4-6');
    });

    it('resolves persona_models UUID values to slugs', async () => {
      await seedLocalJson(DEFAULT_ENTRIES);
      await seedAssignmentsJson({
        default_model_uuid: undefined,
        persona_models: {
          'ledger-1-planner': '00000000-0000-0000-0000-000000000001',
          'ledger-3-dev': '00000000-0000-0000-0000-000000000002',
        },
      });

      const result = await getResolvedAssignments();
      expect(result.persona_models['ledger-1-planner']).toBe('claude-opus-4-6');
      expect(result.persona_models['ledger-3-dev']).toBe('claude-sonnet-4-6');
    });

    it('omits persona entries with unresolvable UUIDs (graceful degradation)', async () => {
      await seedLocalJson([
        { id: '00000000-0000-0000-0000-000000000001', name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      await seedAssignmentsJson({
        default_model_uuid: undefined,
        persona_models: {
          'ledger-1-planner': '00000000-0000-0000-0000-000000000001', // resolvable
          'ledger-2-pm': 'ffffffff-ffff-ffff-ffff-ffffffffffff', // unresolvable
        },
      });

      const result = await getResolvedAssignments();
      expect(result.persona_models['ledger-1-planner']).toBe('claude-opus-4-6');
      expect('ledger-2-pm' in result.persona_models).toBe(false);
    });

    it('returns null for default_model_slug when default_model_uuid is unresolvable', async () => {
      await seedLocalJson([
        { id: '00000000-0000-0000-0000-000000000001', name: 'Opus', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      await seedAssignmentsJson({
        default_model_uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff', // unknown UUID
        persona_models: {},
      });

      const result = await getResolvedAssignments();
      expect(result.default_model_slug).toBeNull();
    });

    it('returns null for default_model_slug when default_model_uuid is absent', async () => {
      await seedLocalJson(DEFAULT_ENTRIES);
      await seedAssignmentsJson({ persona_models: {} });

      const result = await getResolvedAssignments();
      expect(result.default_model_slug).toBeNull();
    });
  });
});
