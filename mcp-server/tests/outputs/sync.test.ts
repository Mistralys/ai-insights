/**
 * Tests for `src/outputs/sync.ts` (WP-009).
 *
 * Coverage:
 *   - syncProjectOutputs() writes an enabled output at its default path with
 *     the exact header contract; a second run with no vision change reports
 *     `unchanged` and leaves the file byte-identical, including
 *     `generated-at` — AC-05, AC-06
 *   - a non-vision registry edit (label / folder_names) writes nothing and
 *     reports `unchanged`; a horizon edit rewrites with a new
 *     `vision-hash` — AC-07, AC-08
 *   - an overridden path writes only there; a disabled output removes a
 *     marker-carrying file and leaves an unmarked one untouched, reporting
 *     `blocked` — AC-10, AC-11
 *   - `check` mode writes nothing and correctly reports staleness for a
 *     stale, a missing, and a current file — AC-12
 *   - every non-null path in the returned write set is within `.ledger/` or
 *     a declared output path, including an override outside `.ledger/` —
 *     AC-13
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, symlink } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { syncProjectOutputs } from '../../src/outputs/sync.js';
import { renderStrategicVision, visionHash } from '../../src/outputs/strategic-vision.js';
import type { ProjectSettings } from '../../src/schema/project-declaration.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';

function makeEntry(overrides: Partial<RepositoryEntry> = {}): RepositoryEntry {
  return {
    id: 'my-repo',
    label: 'My Repo',
    folder_names: ['my-repo'],
    vision: { short_term: 'Ship v1', mid_term: 'Grow adoption', long_term: 'Become the default' },
    created_at: '2026-01-01T00:00:00.000Z',
    last_modified: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('sync', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sync-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('AC-05 / AC-06 — write then re-sync unchanged', () => {
    it('writes the enabled output at its default path with the exact header contract', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };

      const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      expect(records).toHaveLength(1);
      expect(records[0]!.outputId).toBe('strategic-vision');
      expect(records[0]!.kind).toBe('written');
      expect(records[0]!.path).toBe(resolve(tempDir, '.ledger', 'strategic-vision.md'));

      const written = await readFile(records[0]!.path!, 'utf-8');
      expect(written).toContain(`<!-- repository-id: ${entry.id} -->`);
      expect(written).toContain(`vision-hash: sha256:${visionHash(entry.vision)}`);
    });

    it('reports unchanged and leaves the file byte-identical (including generated-at) on a second run with no vision change', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };

      const first = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });
      const firstContent = await readFile(first[0]!.path!, 'utf-8');

      const second = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });
      const secondContent = await readFile(second[0]!.path!, 'utf-8');

      expect(second[0]!.kind).toBe('unchanged');
      expect(second[0]!.stale).toBe(false);
      expect(secondContent).toBe(firstContent);
    });
  });

  describe('AC-07 / AC-08 — non-vision edit vs. horizon edit', () => {
    it('writes nothing and reports unchanged when only label or folder_names changes', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };

      await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      const relabeled = makeEntry({ label: 'Renamed Repo', folder_names: ['renamed', 'legacy-name'] });
      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry: relabeled, mode: 'write' }))[0]!;

      expect(record.kind).toBe('unchanged');
      expect(record.stale).toBe(false);
    });

    it('rewrites the file with a new vision-hash when a horizon changes', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };

      const first = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;
      const firstContent = await readFile(first.path!, 'utf-8');

      const revisedEntry = makeEntry({ vision: { ...entry.vision, short_term: 'Ship v2' } });
      const second = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry: revisedEntry, mode: 'write' }))[0]!;
      const secondContent = await readFile(second.path!, 'utf-8');

      expect(second.kind).toBe('written');
      expect(second.stale).toBe(true);
      expect(secondContent).not.toBe(firstContent);
      expect(secondContent).toContain(`vision-hash: sha256:${visionHash(revisedEntry.vision)}`);
    });
  });

  describe('AC-10 — path override', () => {
    it('writes only at the overridden path, not the default path', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true, path: 'docs/strategic-vision.md' } },
      };

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;

      expect(record.path).toBe(resolve(tempDir, 'docs', 'strategic-vision.md'));
      expect(await fileExists(join(tempDir, 'docs', 'strategic-vision.md'))).toBe(true);
      expect(await fileExists(join(tempDir, '.ledger', 'strategic-vision.md'))).toBe(false);
    });
  });

  describe('AC-11 — disabled-output cleanup', () => {
    it('removes a marker-carrying file at the configured path when disabled', async () => {
      const entry = makeEntry();
      const enabledSettings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const written = (await syncProjectOutputs({ projectRoot: tempDir, settings: enabledSettings, entry, mode: 'write' }))[0]!;
      expect(await fileExists(written.path!)).toBe(true);

      const disabledSettings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: false } },
      };
      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings: disabledSettings, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('removed');
      expect(await fileExists(record.path!)).toBe(false);
    });

    it('leaves an unmarked file untouched, reports blocked, when disabled', async () => {
      const entry = makeEntry();
      const outputPath = join(tempDir, '.ledger', 'strategic-vision.md');
      await mkdir(join(tempDir, '.ledger'), { recursive: true });
      await writeFile(outputPath, '# Hand-authored notes\n\nDo not overwrite this.\n', 'utf-8');

      const disabledSettings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: false } },
      };
      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings: disabledSettings, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('blocked');
      expect(record.reason).toBeDefined();
      const stillThere = await readFile(outputPath, 'utf-8');
      expect(stillThere).toBe('# Hand-authored notes\n\nDo not overwrite this.\n');
    });

    it('refuses to overwrite an unmarked file even when the output is enabled', async () => {
      const entry = makeEntry();
      const outputPath = join(tempDir, '.ledger', 'strategic-vision.md');
      await mkdir(join(tempDir, '.ledger'), { recursive: true });
      await writeFile(outputPath, '# Hand-authored notes\n', 'utf-8');

      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('blocked');
      const stillThere = await readFile(outputPath, 'utf-8');
      expect(stillThere).toBe('# Hand-authored notes\n');
    });
  });

  describe('AC-12 — check mode', () => {
    it('writes nothing and reports stale for a missing file', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'check' }))[0]!;

      expect(record.stale).toBe(true);
      expect(await fileExists(record.path!)).toBe(false);
    });

    it('writes nothing and reports stale for an out-of-date file', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const written = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;
      const beforeCheck = await readFile(written.path!, 'utf-8');

      const revisedEntry = makeEntry({ vision: { ...entry.vision, short_term: 'Ship v2' } });
      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry: revisedEntry, mode: 'check' }))[0]!;

      expect(record.stale).toBe(true);
      const afterCheck = await readFile(written.path!, 'utf-8');
      expect(afterCheck).toBe(beforeCheck);
    });

    it('writes nothing and reports not stale for a current file', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const written = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;
      const beforeCheck = await readFile(written.path!, 'utf-8');

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'check' }))[0]!;

      expect(record.stale).toBe(false);
      const afterCheck = await readFile(written.path!, 'utf-8');
      expect(afterCheck).toBe(beforeCheck);
    });
  });

  describe('AC-13 — write set stays within the allowlist', () => {
    it('keeps the default-path record within .ledger/', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      for (const record of records) {
        if (record.path === null) continue;
        const relToRoot = record.path.startsWith(resolve(tempDir)) ? record.path.slice(resolve(tempDir).length + 1) : record.path;
        expect(relToRoot.startsWith('.ledger')).toBe(true);
      }
    });

    it('accepts a declared path outside .ledger/, and the write set contains only that declared path', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true, path: 'docs/strategic-vision.md' } },
      };
      const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      expect(records).toHaveLength(1);
      const declaredAbsolute = resolve(tempDir, 'docs', 'strategic-vision.md');
      expect(records[0]!.path).toBe(declaredAbsolute);
      // The declared path sits outside .ledger/, but it is the output's own
      // declared path — the allowlist accepts it precisely because it was
      // configured explicitly, not because it happens to live under .ledger/.
      const relToRoot = declaredAbsolute.slice(resolve(tempDir).length + 1);
      expect(relToRoot.startsWith('.ledger')).toBe(false);
      expect(await fileExists(declaredAbsolute)).toBe(true);
    });

    it('never returns a path outside projectRoot across every mode and enabled/disabled combination', async () => {
      const entry = makeEntry();
      const scenarios: ProjectSettings[] = [
        { schema_version: 1, repository_id: entry.id, outputs: { 'strategic-vision': { enabled: true } } },
        { schema_version: 1, repository_id: entry.id, outputs: { 'strategic-vision': { enabled: false } } },
        {
          schema_version: 1,
          repository_id: entry.id,
          outputs: { 'strategic-vision': { enabled: true, path: 'nested/dir/out.md' } },
        },
      ];

      for (const settings of scenarios) {
        for (const mode of ['write', 'check'] as const) {
          const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode });
          for (const record of records) {
            if (record.path === null) continue;
            expect(record.path.startsWith(resolve(tempDir))).toBe(true);
          }
        }
      }
    });

    it('blocks a symlink escape: a declared output path that traverses a symlinked intermediate directory pointing outside projectRoot', async () => {
      const entry = makeEntry();
      const outsideDir = await mkdtemp(join(tmpdir(), 'sync-outside-'));
      try {
        // .ledger/escape -> {outsideDir}, and the declared output path
        // reaches through that symlink — lexically ('.ledger/escape/pwned.md')
        // this still reads as inside .ledger/, but the real file would land
        // entirely outside projectRoot.
        await mkdir(join(tempDir, '.ledger'), { recursive: true });
        await symlink(outsideDir, join(tempDir, '.ledger', 'escape'), 'dir');

        const settings: ProjectSettings = {
          schema_version: 1,
          repository_id: entry.id,
          outputs: { 'strategic-vision': { enabled: true, path: '.ledger/escape/pwned.md' } },
        };

        const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

        expect(records).toHaveLength(1);
        expect(records[0]!.kind).toBe('blocked');
        expect(records[0]!.reason).toMatch(/escapes the real .*project root/i);
        // No file was written into the symlink target outside projectRoot.
        expect(await fileExists(join(outsideDir, 'pwned.md'))).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks a symlink escape: the declared output path is itself a symlink to a file outside projectRoot', async () => {
      const entry = makeEntry();
      const outsideDir = await mkdtemp(join(tmpdir(), 'sync-outside-'));
      try {
        // The declared output path itself (not an intermediate directory) is
        // a symlink pointing to a file outside projectRoot. Lexically this
        // reads as a plain file inside .ledger/, but writing "through" the
        // symlink would overwrite the out-of-root target.
        const outsideTarget = join(outsideDir, 'pwned.md');
        await writeFile(outsideTarget, 'untouched\n', 'utf-8');
        await mkdir(join(tempDir, '.ledger'), { recursive: true });
        await symlink(outsideTarget, join(tempDir, '.ledger', 'strategic-vision.md'), 'file');

        const settings: ProjectSettings = {
          schema_version: 1,
          repository_id: entry.id,
          outputs: { 'strategic-vision': { enabled: true } },
        };

        const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

        expect(records).toHaveLength(1);
        expect(records[0]!.kind).toBe('blocked');
        expect(records[0]!.reason).toMatch(/escapes the real .*project root/i);
        // The out-of-root target file is unchanged.
        expect(await readFile(outsideTarget, 'utf-8')).toBe('untouched\n');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks a directory-shaped declared output path (".") instead of crashing with EISDIR', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true, path: '.' } },
      };

      const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      expect(records).toHaveLength(1);
      expect(records[0]!.kind).toBe('blocked');
      expect(records[0]!.reason).toMatch(/directory/i);
    });

    it('blocks a directory-shaped declared output path when the output is disabled (the removal path)', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: false, path: '.' } },
      };

      const records = await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' });

      expect(records).toHaveLength(1);
      expect(records[0]!.kind).toBe('blocked');
      expect(records[0]!.reason).toMatch(/directory/i);
    });
  });

  describe('undeclared output configuration', () => {
    it('treats a missing outputs map as disabled and writes nothing', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = { schema_version: 1, repository_id: entry.id };

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('skipped');
      expect(await fileExists(join(tempDir, '.ledger', 'strategic-vision.md'))).toBe(false);
    });

    it('treats undefined settings (undeclared project) as disabled and writes nothing', async () => {
      const entry = makeEntry();

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings: undefined, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('skipped');
    });
  });

  describe('idempotence composition with renderStrategicVision()', () => {
    it('a pre-seeded file rendered by renderStrategicVision() with the current vision is reported unchanged', async () => {
      const entry = makeEntry();
      const settings: ProjectSettings = {
        schema_version: 1,
        repository_id: entry.id,
        outputs: { 'strategic-vision': { enabled: true } },
      };
      const outputPath = join(tempDir, '.ledger', 'strategic-vision.md');
      await mkdir(join(tempDir, '.ledger'), { recursive: true });
      await writeFile(outputPath, renderStrategicVision(entry, '2020-01-01T00:00:00.000Z'), 'utf-8');

      const record = (await syncProjectOutputs({ projectRoot: tempDir, settings, entry, mode: 'write' }))[0]!;

      expect(record.kind).toBe('unchanged');
      const content = await readFile(outputPath, 'utf-8');
      // generated-at is untouched — the original (older) timestamp survives.
      expect(content).toContain('<!-- generated-at: 2020-01-01T00:00:00.000Z -->');
    });
  });
});
