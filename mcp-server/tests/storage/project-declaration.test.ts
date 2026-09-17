/**
 * Tests for `src/storage/project-declaration.ts` (WP-006).
 *
 * Coverage:
 *   - findProjectRoot(): nearest-ancestor hit from both a bare project-root
 *     path and a nested plan-folder path; null when no ancestor carries a
 *     declaration; depth bound — AC-18
 *   - loadProjectDeclaration(): not_declared / declared / invalid; malformed
 *     JSON surfaces as invalid, not silently empty; local override deep
 *     merges; local repository_id rejected by name — AC-16, AC-17
 *   - resolveOutputPath(): rejects absolute paths, `..` escapes and the
 *     three reserved `.ledger/` filenames; accepts a declared `docs/`
 *     path — AC-10, AC-16
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  findProjectRoot,
  loadProjectDeclaration,
  resolveOutputPath,
} from '../../src/storage/project-declaration.js';
import type { ProjectSettings } from '../../src/schema/project-declaration.js';

describe('project-declaration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-declaration-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function declareProject(root: string, settings: unknown, local?: unknown): Promise<void> {
    const ledgerDir = join(root, '.ledger');
    await mkdir(ledgerDir, { recursive: true });
    await writeFile(join(ledgerDir, 'settings.json'), JSON.stringify(settings), 'utf-8');
    if (local !== undefined) {
      await writeFile(join(ledgerDir, 'settings.local.json'), JSON.stringify(local), 'utf-8');
    }
  }

  // ─── findProjectRoot() ─────────────────────────────────────────────────

  describe('findProjectRoot()', () => {
    it('finds the declared root from a bare project-root path', async () => {
      await declareProject(tempDir, { schema_version: 1, repository_id: 'my-repo' });

      const found = await findProjectRoot(tempDir);
      expect(found).toBe(tempDir);
    });

    it('finds the declared root from a nested plan-folder path', async () => {
      await declareProject(tempDir, { schema_version: 1, repository_id: 'my-repo' });
      const planFolder = join(tempDir, 'docs', 'agents', 'plans', '2026-01-01-my-plan');
      await mkdir(planFolder, { recursive: true });

      const found = await findProjectRoot(planFolder);
      expect(found).toBe(tempDir);
    });

    it('returns null when no ancestor carries a declaration', async () => {
      const nested = join(tempDir, 'a', 'b', 'c');
      await mkdir(nested, { recursive: true });

      const found = await findProjectRoot(nested);
      expect(found).toBeNull();
    });

    it('returns the nearest ancestor when declarations exist at multiple levels', async () => {
      await declareProject(tempDir, { schema_version: 1, repository_id: 'outer-repo' });
      const inner = join(tempDir, 'inner');
      await declareProject(inner, { schema_version: 1, repository_id: 'inner-repo' });
      const nested = join(inner, 'a', 'b');
      await mkdir(nested, { recursive: true });

      const found = await findProjectRoot(nested);
      expect(found).toBe(inner);
    });
  });

  // ─── loadProjectDeclaration() ──────────────────────────────────────────

  describe('loadProjectDeclaration()', () => {
    it('returns not_declared when settings.json is missing', async () => {
      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('not_declared');
    });

    it('returns declared for a valid settings.json with no local override', async () => {
      await declareProject(tempDir, { schema_version: 1, repository_id: 'my-repo' });

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('declared');
      if (result.kind === 'declared') {
        expect(result.settings.repository_id).toBe('my-repo');
        expect(result.sourcePaths.settings).toBe(join(tempDir, '.ledger', 'settings.json'));
        expect(result.sourcePaths.local).toBeNull();
      }
    });

    it('returns invalid for malformed JSON', async () => {
      const ledgerDir = join(tempDir, '.ledger');
      await mkdir(ledgerDir, { recursive: true });
      await writeFile(join(ledgerDir, 'settings.json'), '{ not valid json', 'utf-8');

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') {
        expect(result.errors[0]).toContain('malformed JSON');
      }
    });

    it('returns invalid for an unknown schema_version', async () => {
      await declareProject(tempDir, { schema_version: 99, repository_id: 'my-repo' });

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('invalid');
    });

    it('returns invalid for an unknown output key', async () => {
      await declareProject(tempDir, {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'not-a-real-output': { enabled: true } },
      });

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('invalid');
    });

    it('deep-merges settings.local.json over settings.json', async () => {
      await declareProject(
        tempDir,
        {
          schema_version: 1,
          repository_id: 'my-repo',
          outputs: { 'strategic-vision': { enabled: false, path: 'docs/vision.md' } },
        },
        { outputs: { 'strategic-vision': { enabled: true } } }
      );

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('declared');
      if (result.kind === 'declared') {
        // enabled overridden by local; path preserved from base (deep merge, not replace)
        expect(result.settings.outputs?.['strategic-vision']).toEqual({
          enabled: true,
          path: 'docs/vision.md',
        });
        expect(result.sourcePaths.local).toBe(join(tempDir, '.ledger', 'settings.local.json'));
      }
    });

    it('preserves the base enabled value when a local override specifies only path', async () => {
      await declareProject(
        tempDir,
        {
          schema_version: 1,
          repository_id: 'my-repo',
          outputs: { 'strategic-vision': { enabled: true, path: 'docs/vision.md' } },
        },
        { outputs: { 'strategic-vision': { path: 'docs/local-vision.md' } } }
      );

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('declared');
      if (result.kind === 'declared') {
        // Local override touches only `path` — `enabled: true` from the base
        // must survive, not be silently clobbered by a zod-fabricated default.
        expect(result.settings.outputs?.['strategic-vision']).toEqual({
          enabled: true,
          path: 'docs/local-vision.md',
        });
      }
    });

    it('honors an explicit enabled: false in a local override', async () => {
      await declareProject(
        tempDir,
        {
          schema_version: 1,
          repository_id: 'my-repo',
          outputs: { 'strategic-vision': { enabled: true, path: 'docs/vision.md' } },
        },
        { outputs: { 'strategic-vision': { enabled: false } } }
      );

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('declared');
      if (result.kind === 'declared') {
        expect(result.settings.outputs?.['strategic-vision']).toEqual({
          enabled: false,
          path: 'docs/vision.md',
        });
      }
    });

    it('rejects a settings.local.json carrying repository_id, naming the file', async () => {
      await declareProject(
        tempDir,
        { schema_version: 1, repository_id: 'my-repo' },
        { repository_id: 'sneaky-redirect' }
      );

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') {
        expect(result.errors[0]).toContain('settings.local.json');
        expect(result.errors[0]).toContain('repository_id');
      }
    });

    it('returns invalid for malformed JSON in settings.local.json', async () => {
      const ledgerDir = join(tempDir, '.ledger');
      await mkdir(ledgerDir, { recursive: true });
      await writeFile(
        join(ledgerDir, 'settings.json'),
        JSON.stringify({ schema_version: 1, repository_id: 'my-repo' }),
        'utf-8'
      );
      await writeFile(join(ledgerDir, 'settings.local.json'), '{ not valid json', 'utf-8');

      const result = await loadProjectDeclaration(tempDir);
      expect(result.kind).toBe('invalid');
    });
  });

  // ─── resolveOutputPath() ────────────────────────────────────────────────

  describe('resolveOutputPath()', () => {
    it('accepts the default path when settings does not override it', () => {
      const result = resolveOutputPath(tempDir, 'strategic-vision', undefined);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.path).toBe(join(tempDir, '.ledger', 'strategic-vision.md'));
      }
    });

    it('accepts a declared docs/ path', () => {
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'strategic-vision': { enabled: true, path: 'docs/strategic-vision.md' } },
      };
      const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.path).toBe(join(tempDir, 'docs', 'strategic-vision.md'));
      }
    });

    it('rejects an absolute path', () => {
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'strategic-vision': { enabled: true, path: '/etc/passwd' } },
      };
      const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
      expect(result.kind).toBe('rejected');
    });

    it('rejects a path escaping the project root via ..', () => {
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'strategic-vision': { enabled: true, path: '../outside.md' } },
      };
      const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
      expect(result.kind).toBe('rejected');
    });

    it('rejects a deeply nested path that still escapes the project root', () => {
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'strategic-vision': { enabled: true, path: 'a/b/../../../outside.md' } },
      };
      const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
      expect(result.kind).toBe('rejected');
    });

    for (const reserved of ['settings.json', 'settings.local.json', 'README.md']) {
      it(`rejects the reserved .ledger/${reserved} filename`, () => {
        const settings: ProjectSettings = {
          schema_version: 1,
          repository_id: 'my-repo',
          outputs: { 'strategic-vision': { enabled: true, path: `.ledger/${reserved}` } },
        };
        const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
        expect(result.kind).toBe('rejected');
      });
    }

    it('rejects a reserved .ledger/ filename declared with different casing (case-insensitive filesystems)', () => {
      // Both macOS (APFS) and Windows (NTFS) are case-insensitive by default,
      // so '.ledger/SETTINGS.JSON' resolves to the same file on disk as
      // '.ledger/settings.json' and must be rejected identically.
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: 'my-repo',
        outputs: { 'strategic-vision': { enabled: true, path: '.ledger/SETTINGS.JSON' } },
      };
      const result = resolveOutputPath(tempDir, 'strategic-vision', settings);
      expect(result.kind).toBe('rejected');
    });
  });
});
