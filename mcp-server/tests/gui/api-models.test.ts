/**
 * Integration tests for gui/api-models.ts (WP-006 model settings).
 *
 * Uses vi.mock to redirect WORKSPACE_ROOT to a temp directory, giving each test
 * a clean, isolated model-registry directory. All assertions exercise the
 * public handler functions imported from `gui/api-models.ts`.
 *
 * Test coverage:
 *   AC-1:  GET /api/models — auto-initializes local.json from defaults on first access
 *   AC-2:  PUT /api/models — auto-assigns UUIDv4; persists all entries
 *   AC-3:  PUT /api/models — duplicate slug → 400 VALIDATION_ERROR
 *   AC-4:  PUT /api/models — reserved slug "inherit" on non-sentinel entry → 400
 *   AC-5:  PUT /api/models — delete referenced model → 409 CONFLICT
 *   AC-6:  PUT /api/models — delete unreferenced model → succeeds
 *   AC-7:  POST /api/models/load-defaults — merges without overwriting; returns conflicts
 *   AC-8:  GET /api/model-assignments — stale detection (3 cases)
 *   AC-9:  PUT /api/model-assignments — UUID + persona key validation; 400 when name-mapping absent; batch UUID validation with count
 *   AC-10: POST /api/model-assignments/replace — swap all; reject when not referenced; reject same-model
 *   AC-11: GET /api/personas — returns all / empty array when file absent
 *   AC-12: POST /api/personas/rebuild — success / failure with output
 *   AC-13: POST /api/personas/rebuild — 409 concurrency guard; finally cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'fs/promises';
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
  ORCHESTRATOR_LOGS_DIR: '/tmp/orchestrator-logs',
  resolveLedgerRoot: () => '/tmp/ledger',
  projectSlugFromPath: (p: string) => p,
  inferProjectRootFromPlanPath: () => null,
  repositoryNameFromPlanPath: () => 'unknown',
}));

// Import handlers AFTER the mock is registered
import {
  handleGetModels,
  handleSaveModels,
  handleLoadDefaults,
  handleGetAssignments,
  handleUpdateAssignments,
  handleReplaceAssignedModel,
  handleGetPersonas,
  handleRebuildPersonas,
  _resetBuildInProgress,
  ApiError,
} from '../../gui/api-models.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGISTRY_DIR = 'personas/model-registry';
const INHERIT_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_1 = '00000000-0000-0000-0000-000000000001';
const UUID_2 = '00000000-0000-0000-0000-000000000002';
const UUID_3 = '00000000-0000-0000-0000-000000000003';

const DEFAULT_ENTRIES = [
  { id: INHERIT_UUID, name: 'Inherit / Auto', slug: 'inherit', cc_model: 'inherit' },
  { id: UUID_1, name: 'Claude Opus 4.6', slug: 'claude-opus-4-6', cc_model: 'inherit' },
  { id: UUID_2, name: 'Claude Sonnet 4.6', slug: 'claude-sonnet-4-6', cc_model: 'inherit' },
  { id: UUID_3, name: 'Gemini 3.5 Flash', slug: 'gemini-3-5-flash', cc_model: 'gemini-3-5-flash' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registryDir(): string {
  return join(tempWorkspaceRoot, REGISTRY_DIR);
}

function nameMappingPath(): string {
  return join(tempWorkspaceRoot, 'personas', 'name-mapping.json');
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

async function seedNameMapping(entries: unknown[]): Promise<void> {
  await writeJson(nameMappingPath(), entries);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('api-models.ts — Model Registry API Handlers', () => {
  beforeEach(async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'api-models-test-'));
    // Create registry directory and personas directory
    await mkdir(join(tempWorkspaceRoot, REGISTRY_DIR), { recursive: true });
    await mkdir(join(tempWorkspaceRoot, 'personas'), { recursive: true });
    // Always reset the concurrency guard
    _resetBuildInProgress();
  });

  afterEach(async () => {
    _resetBuildInProgress();
    await rm(tempWorkspaceRoot, { recursive: true, force: true });
  });

  // ─── handleGetModels (AC-1) ───────────────────────────────────────────────

  describe('handleGetModels — GET /api/models (AC-1)', () => {
    it('AC-1: auto-initializes local.json from default.json on first access', async () => {
      await seedDefaultJson();

      const models = await handleGetModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models).toHaveLength(4);
      const slugs = models.map((m) => m.slug);
      expect(slugs).toContain('inherit');
      expect(slugs).toContain('claude-opus-4-6');
    });

    it('AC-1: returns existing local.json entries when file already exists', async () => {
      const local = [{ id: UUID_1, name: 'My Model', slug: 'my-model', cc_model: 'inherit' }];
      await seedLocalJson(local);

      const models = await handleGetModels();

      expect(models).toHaveLength(1);
      expect(models[0]!.slug).toBe('my-model');
    });
  });

  // ─── handleSaveModels (AC-2, 3, 4, 5, 6) ─────────────────────────────────

  describe('handleSaveModels — PUT /api/models', () => {
    it('AC-2: auto-assigns UUIDv4 to entries missing id', async () => {
      await seedDefaultJson();

      // Entry without id
      const body = [
        { name: 'New Model', slug: 'new-model', cc_model: 'inherit' },
      ];

      const result = await handleSaveModels(body) as { models: Array<{ id: string; slug: string }> };

      expect('models' in result).toBe(true);
      expect(result.models).toHaveLength(1);
      expect(result.models[0]!.id).toBeTruthy();
      // Should be a valid UUID format
      expect(result.models[0]!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(result.models[0]!.slug).toBe('new-model');
    });

    it('AC-2: persists all entries after save', async () => {
      await seedDefaultJson();

      const body = [
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
      ];

      const result = await handleSaveModels(body) as { models: Array<{ id: string }> };

      expect(result.models).toHaveLength(2);

      // Verify by reading back
      const readBack = await handleGetModels();
      expect(readBack).toHaveLength(2);
    });

    it('AC-3: returns VALIDATION_ERROR for duplicate slugs', async () => {
      const body = [
        { id: UUID_1, name: 'Model A', slug: 'same-slug', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'same-slug', cc_model: 'inherit' },
      ];

      await expect(handleSaveModels(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('AC-4: returns VALIDATION_ERROR for reserved slug "inherit" on non-sentinel entry', async () => {
      const body = [
        // Non-sentinel UUID using "inherit" slug
        { id: UUID_1, name: 'Bad Model', slug: 'inherit', cc_model: 'inherit' },
      ];

      await expect(handleSaveModels(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('AC-4: allows "inherit" slug on the sentinel entry (INHERIT_UUID)', async () => {
      const body = [
        { id: INHERIT_UUID, name: 'Inherit / Auto', slug: 'inherit', cc_model: 'inherit' },
        { id: UUID_1, name: 'Other Model', slug: 'other-model', cc_model: 'inherit' },
      ];

      const result = await handleSaveModels(body) as { models: unknown[] };
      expect(result.models).toHaveLength(2);
    });

    it('AC-5: returns 409 CONFLICT when removing a referenced model', async () => {
      // Seed local.json with two models
      await seedLocalJson([
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
      ]);

      // Assign UUID_1 in assignments
      await seedAssignmentsJson({
        persona_models: { 'ledger-1-planner': UUID_1 },
      });

      // Try to remove UUID_1 (keep only UUID_2)
      const body = [{ id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' }];

      await expect(handleSaveModels(body)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('AC-5: returned CONFLICT includes referencedModels details', async () => {
      await seedLocalJson([
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
      ]);

      await seedAssignmentsJson({
        persona_models: { 'ledger-1-planner': UUID_1 },
      });

      try {
        await handleSaveModels([{ id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' }]);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('CONFLICT');
        expect(apiErr.details).toBeDefined();
      }
    });

    it('AC-6: removing an unreferenced model succeeds', async () => {
      await seedLocalJson([
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
      ]);

      // No assignments referencing UUID_1 — remove it
      const body = [{ id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' }];
      const result = await handleSaveModels(body) as { models: unknown[] };

      expect(result.models).toHaveLength(1);
    });

    it('AC-2: slug-change preserves id stability (same UUID, new slug)', async () => {
      await seedLocalJson([
        { id: UUID_1, name: 'Old Name', slug: 'old-slug', cc_model: 'inherit' },
      ]);

      const body = [{ id: UUID_1, name: 'New Name', slug: 'new-slug', cc_model: 'inherit' }];
      const result = await handleSaveModels(body) as { models: Array<{ id: string; slug: string }> };

      expect(result.models[0]!.id).toBe(UUID_1);
      expect(result.models[0]!.slug).toBe('new-slug');
    });
  });

  // ─── handleLoadDefaults (AC-7) ────────────────────────────────────────────

  describe('handleLoadDefaults — POST /api/models/load-defaults (AC-7)', () => {
    it('AC-7: merges defaults into empty local registry', async () => {
      await seedDefaultJson();

      const result = await handleLoadDefaults();

      expect(result.models).toHaveLength(4);
      expect(result.conflicts).toHaveLength(0);
    });

    it('AC-7: does not overwrite existing local entries by UUID', async () => {
      // Local has UUID_1 with different name
      await seedLocalJson([
        { id: UUID_1, name: 'Local Override', slug: 'claude-opus-4-6', cc_model: 'my-model' },
      ]);
      await seedDefaultJson();

      const result = await handleLoadDefaults();

      // UUID_1 should preserve the local values
      const opus = result.models.find((m) => m.id === UUID_1);
      expect(opus!.name).toBe('Local Override');
      expect(opus!.cc_model).toBe('my-model');
    });

    it('AC-7: reports slug collision conflict when default slug matches a local entry with different UUID', async () => {
      // Local has a different UUID but same slug as a default entry
      await seedLocalJson([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Custom', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      await seedDefaultJson();

      const result = await handleLoadDefaults();

      // claude-opus-4-6 slug is already taken — conflict
      const conflicted = result.conflicts.find((c) => c.defaultEntry.slug === 'claude-opus-4-6');
      expect(conflicted).toBeDefined();
      expect(conflicted!.reason).toBe('slug_collision');
    });

    it('AC-7: appends new defaults that are not already present', async () => {
      // Only UUID_1 exists locally
      await seedLocalJson([
        { id: UUID_1, name: 'Claude Opus 4.6', slug: 'claude-opus-4-6', cc_model: 'inherit' },
      ]);
      await seedDefaultJson();

      const result = await handleLoadDefaults();

      // Should have merged the other 3 defaults
      expect(result.models.length).toBeGreaterThan(1);
    });
  });

  // ─── handleGetAssignments / staleness (AC-8) ──────────────────────────────

  describe('handleGetAssignments — GET /api/model-assignments (AC-8)', () => {
    it('AC-8: returns stale: false when neither user file exists', async () => {
      // No local.json or assignments.json
      const result = await handleGetAssignments();
      expect(result.stale).toBe(false);
    });

    it('AC-8: returns stale: false when only default.json is newer', async () => {
      // Create name-mapping.json
      await seedNameMapping([{ id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' }]);
      // Create default.json with a later mtime (default.json is excluded from stale check)
      await seedDefaultJson();

      // Set name-mapping.json mtime to "now"
      // Set default.json mtime to "future" - but we don't set mtime on assignments/local
      // so stale should still be false (no user files)
      const result = await handleGetAssignments();
      expect(result.stale).toBe(false);
    });

    it('AC-8: returns stale: true when local.json is newer than name-mapping.json', async () => {
      // Create name-mapping.json with an old mtime
      await seedNameMapping([{ id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' }]);

      // Set name-mapping.json mtime to a past time
      const past = new Date(Date.now() - 10_000);
      await utimes(nameMappingPath(), past, past);

      // Create local.json with current (newer) mtime
      await seedLocalJson([{ id: UUID_1, name: 'Model', slug: 'model', cc_model: 'inherit' }]);

      const result = await handleGetAssignments();
      expect(result.stale).toBe(true);
    });

    it('AC-8: returns stale: true when assignments.json is newer than name-mapping.json', async () => {
      await seedNameMapping([{ id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' }]);

      const past = new Date(Date.now() - 10_000);
      await utimes(nameMappingPath(), past, past);

      await seedAssignmentsJson({ persona_models: { 'ledger-1-planner': UUID_1 } });

      const result = await handleGetAssignments();
      expect(result.stale).toBe(true);
    });

    it('AC-8: includes assignment data in the response', async () => {
      await seedAssignmentsJson({
        default_model_uuid: UUID_1,
        persona_models: { 'ledger-1-planner': UUID_2 },
      });

      const result = await handleGetAssignments();
      expect(result.default_model_uuid).toBe(UUID_1);
      expect(result.persona_models['ledger-1-planner']).toBe(UUID_2);
    });
  });

  // ─── handleUpdateAssignments (AC-9) ──────────────────────────────────────

  describe('handleUpdateAssignments — PUT /api/model-assignments (AC-9)', () => {
    beforeEach(async () => {
      // Set up registry with known models
      await seedLocalJson([
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
      ]);
    });

    it('AC-9: returns 400 when name-mapping.json does not exist', async () => {
      const body = {
        persona_models: { 'ledger-1-planner': UUID_1 },
      };

      await expect(handleUpdateAssignments(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('AC-9: returns 400 for invalid persona key not in name-mapping.json', async () => {
      await seedNameMapping([
        { id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' },
      ]);

      const body = {
        persona_models: { 'not-a-real-persona': UUID_1 },
      };

      await expect(handleUpdateAssignments(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('AC-9: returns 400 for non-existent model UUID', async () => {
      await seedNameMapping([
        { id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' },
      ]);

      const nonExistentUUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const body = {
        persona_models: { 'ledger-1-planner': nonExistentUUID },
      };

      await expect(handleUpdateAssignments(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('AC-9: persists valid assignments successfully', async () => {
      await seedNameMapping([
        { id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' },
        { id: 'ledger-2-pm', role: 'Project Manager', suite: 'ledger' },
      ]);

      const body = {
        default_model_uuid: UUID_1,
        persona_models: {
          'ledger-1-planner': UUID_2,
          'ledger-2-pm': UUID_1,
        },
      };

      const result = await handleUpdateAssignments(body);
      expect(result.default_model_uuid).toBe(UUID_1);
      expect(result.persona_models['ledger-1-planner']).toBe(UUID_2);
    });

    it('AC-9: accepts empty persona_models', async () => {
      await seedNameMapping([{ id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' }]);

      const body = { persona_models: {} };
      const result = await handleUpdateAssignments(body);
      expect(result.persona_models).toEqual({});
    });

    it('AC-9: batch-validates persona_models UUIDs — returns a single error with the invalid count', async () => {
      const UUID_BAD_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const UUID_BAD_2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      const UUID_BAD_3 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      await seedNameMapping([
        { id: 'ledger-1-planner', role: 'Planner', suite: 'ledger' },
        { id: 'ledger-2-pm', role: 'Project Manager', suite: 'ledger' },
        { id: 'ledger-3-dev', role: 'Developer', suite: 'ledger' },
      ]);

      const body = {
        persona_models: {
          'ledger-1-planner': UUID_BAD_1,
          'ledger-2-pm': UUID_BAD_2,
          'ledger-3-dev': UUID_BAD_3,
        },
      };

      try {
        await handleUpdateAssignments(body);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('VALIDATION_ERROR');
        // Single error with the count — not three separate errors, not fail-fast
        expect(apiErr.message).toContain('3');
        // Must not reflect any user-submitted UUID string
        expect(apiErr.message).not.toContain(UUID_BAD_1);
        expect(apiErr.message).not.toContain(UUID_BAD_2);
        expect(apiErr.message).not.toContain(UUID_BAD_3);
      }
    });
  });

  // ─── handleReplaceAssignedModel (AC-10) ──────────────────────────────────

  describe('handleReplaceAssignedModel — POST /api/model-assignments/replace (AC-10)', () => {
    beforeEach(async () => {
      await seedLocalJson([
        { id: UUID_1, name: 'Model A', slug: 'model-a', cc_model: 'inherit' },
        { id: UUID_2, name: 'Model B', slug: 'model-b', cc_model: 'inherit' },
        { id: UUID_3, name: 'Model C', slug: 'model-c', cc_model: 'inherit' },
      ]);
    });

    it('AC-10: swaps all occurrences of old_model_id with new_model_id', async () => {
      await seedAssignmentsJson({
        default_model_uuid: UUID_1,
        persona_models: {
          'ledger-1-planner': UUID_1,
          'ledger-2-pm': UUID_2,
          'ledger-3-dev': UUID_1,
        },
      });

      const result = await handleReplaceAssignedModel({
        old_model_id: UUID_1,
        new_model_id: UUID_3,
      });

      expect(result.default_model_uuid).toBe(UUID_3);
      expect(result.persona_models['ledger-1-planner']).toBe(UUID_3);
      expect(result.persona_models['ledger-2-pm']).toBe(UUID_2); // unchanged
      expect(result.persona_models['ledger-3-dev']).toBe(UUID_3);
    });

    it('AC-10: rejects when old_model_id is not referenced (400)', async () => {
      // UUID_3 not referenced
      await seedAssignmentsJson({
        persona_models: { 'ledger-1-planner': UUID_1 },
      });

      await expect(
        handleReplaceAssignedModel({ old_model_id: UUID_3, new_model_id: UUID_2 })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('AC-10: rejects when old_model_id === new_model_id (400 "Source and target models must be different")', async () => {
      await seedAssignmentsJson({
        persona_models: { 'ledger-1-planner': UUID_1 },
      });

      try {
        await handleReplaceAssignedModel({ old_model_id: UUID_1, new_model_id: UUID_1 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('VALIDATION_ERROR');
        expect(apiErr.message).toContain('Source and target models must be different');
      }
    });

    it('AC-10: also replaces default_model_uuid when it matches old_model_id', async () => {
      await seedAssignmentsJson({
        default_model_uuid: UUID_1,
        persona_models: {},
      });

      const result = await handleReplaceAssignedModel({
        old_model_id: UUID_1,
        new_model_id: UUID_2,
      });

      expect(result.default_model_uuid).toBe(UUID_2);
    });
  });

  // ─── handleGetPersonas (AC-11) ────────────────────────────────────────────

  describe('handleGetPersonas — GET /api/personas (AC-11)', () => {
    it('AC-11: returns empty array when name-mapping.json does not exist', async () => {
      const result = await handleGetPersonas();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('AC-11: returns all personas from name-mapping.json when it exists', async () => {
      await seedNameMapping([
        { id: 'ledger-1-planner', role: 'Planner', suite: 'ledger', number: 1 },
        { id: 'ledger-2-pm', role: 'Project Manager', suite: 'ledger', number: 2 },
      ]);

      const result = await handleGetPersonas();
      expect(result).toHaveLength(2);
      const ids = result.map((p) => p.id);
      expect(ids).toContain('ledger-1-planner');
      expect(ids).toContain('ledger-2-pm');
    });

    it('AC-11: preserves all fields from name-mapping.json entries', async () => {
      const persona = {
        id: 'ledger-1-planner',
        role: 'Planner',
        suite: 'ledger',
        model: 'Claude Sonnet 4.6',
        model_slug: 'claude-sonnet-4-6',
        cc_model: 'inherit',
        number: 1,
      };
      await seedNameMapping([persona]);

      const result = await handleGetPersonas();
      expect(result[0]).toMatchObject(persona);
    });
  });

  // ─── handleRebuildPersonas (AC-12, 13) ───────────────────────────────────

  describe('handleRebuildPersonas — POST /api/personas/rebuild (AC-12, 13)', () => {
    it('AC-12: returns { success: true, output } when script exits 0', async () => {
      // Create a scripts directory with a fake build-personas.js that exits 0
      const scriptsDir = join(tempWorkspaceRoot, 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(
        join(scriptsDir, 'build-personas.js'),
        'process.stdout.write("build ok\\n"); process.exit(0);\n',
        'utf-8'
      );

      const result = await handleRebuildPersonas(tempWorkspaceRoot);

      expect(result.success).toBe(true);
      expect((result as { success: true; output: string }).output).toContain('build ok');
    });

    it('AC-12: returns { success: false, output, exitCode } with non-zero exit', async () => {
      const scriptsDir = join(tempWorkspaceRoot, 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(
        join(scriptsDir, 'build-personas.js'),
        'process.stderr.write("build failed\\n"); process.exit(2);\n',
        'utf-8'
      );

      const result = await handleRebuildPersonas(tempWorkspaceRoot);

      expect(result.success).toBe(false);
      const failure = result as { success: false; output: string; exitCode: number };
      expect(failure.output).toContain('build failed');
      expect(failure.exitCode).toBe(2);
    });

    it('AC-13: returns 409 CONFLICT when a build is already in progress', async () => {
      // Manually set the flag (simulates a concurrent build)
      // We do this by starting a slow build and checking for concurrency
      const scriptsDir = join(tempWorkspaceRoot, 'scripts');
      await mkdir(scriptsDir, { recursive: true });

      // First script: slow (uses a timeout)
      await writeFile(
        join(scriptsDir, 'build-personas.js'),
        'setTimeout(() => { process.exit(0); }, 5000);\n',
        'utf-8'
      );

      // Start the first build (don't await — let it run in background)
      const firstBuild = handleRebuildPersonas(tempWorkspaceRoot);

      // Small delay to ensure the first build has set buildInProgress = true
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second attempt should be rejected with 409
      await expect(handleRebuildPersonas(tempWorkspaceRoot)).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      // Cleanup: wait for the first build to finish (it'll time out in CI, so force-kill is not needed)
      // We reset the flag to prevent leaking state
      _resetBuildInProgress();
      // Abandon the firstBuild promise — it will eventually resolve
      firstBuild.catch(() => { /* ignore */ });
    });

    it('AC-13: clears buildInProgress flag even when process errors', async () => {
      // Point to a non-existent script — child.on("error") fires
      const result = await handleRebuildPersonas(join(tempWorkspaceRoot, 'does-not-exist'));

      // Should return failure (not throw)
      expect(result.success).toBe(false);

      // buildInProgress should be cleared by the finally block
      // Test by attempting a second build immediately
      const scriptsDir = join(tempWorkspaceRoot, 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(
        join(scriptsDir, 'build-personas.js'),
        'process.exit(0);\n',
        'utf-8'
      );

      // This should not throw CONFLICT — the flag was cleared
      const result2 = await handleRebuildPersonas(tempWorkspaceRoot);
      expect(result2.success).toBe(true);
    });
  });
});
