/**
 * Integration tests for `ledger_get_repository_context`'s identity
 * resolution and `mirror` field (WP-010).
 *
 * Unlike `repository-context.test.ts`, this suite does not mock
 * `../../src/utils/ledger-root.js` — it exercises the real
 * `resolveRepositoryIdentity()` → `findProjectRoot()` /
 * `loadProjectDeclaration()` / `findEntryInStores()` chain against a real
 * `mkdtemp` tree, per `constraints-testing.md`'s filesystem-unit convention.
 *
 * Coverage:
 *   - AC-01, AC-18b: an undeclared project resolves through the derived
 *     tier to the identical repository name as before the refactor, for a
 *     bare cwd_path workspace root.
 *   - AC-14, AC-15: a declared repository_id resolves where the basename
 *     matches no folder_names entry; an unknown declared id errors, naming
 *     the id and the store searched, with no fallback.
 *   - AC-20: the mirror field is present only for a declared project with
 *     the strategic-vision output enabled, absent for an undeclared project
 *     and for a disabled output.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { _internal } from '../../src/tools/repository-context.js';
import { deriveRepoNameFromCwd } from '../../src/utils/ledger-root.js';
import { saveRegistry } from '../../src/storage/repository-registry.js';
import { renderStrategicVision } from '../../src/outputs/strategic-vision.js';
import type { RepositoryEntry } from '../../src/schema/repository-registry.js';

const { getRepositoryContext } = _internal;

// ─── Helpers ────────────────────────────────────────────────────────────

function parseResult(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0]!.text);
}

function isError(result: { isError?: boolean }): boolean {
  return result.isError === true;
}

function makeEntry(id: string, folderNames: string[] = [id]): RepositoryEntry {
  return {
    id,
    label: id,
    folder_names: folderNames,
    vision: { short_term: 'Ship MVP', mid_term: null, long_term: null },
    created_at: '2026-01-01T00:00:00Z',
    last_modified: '2026-01-01T00:00:00Z',
  };
}

async function declareProject(
  projectRoot: string,
  repositoryId: string,
  outputs?: Record<string, { enabled: boolean; path?: string }>
): Promise<void> {
  await mkdir(join(projectRoot, '.ledger'), { recursive: true });
  await writeFile(
    join(projectRoot, '.ledger', 'settings.json'),
    JSON.stringify({ schema_version: 1, repository_id: repositoryId, outputs }),
    'utf-8'
  );
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────

let tempDir: string;
let ledgerRoot: string;
let originalArgv: string[];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'repo-ctx-identity-test-'));
  ledgerRoot = join(tempDir, 'ledger');
  await mkdir(ledgerRoot, { recursive: true });
  originalArgv = [...process.argv];
  process.argv = [...process.argv, '--ledger-dir', ledgerRoot];
});

afterEach(async () => {
  process.argv = originalArgv;
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Derived tier (undeclared project) ────────────────────────────────────

describe('ledger_get_repository_context — identity resolution — derived tier', () => {
  it('resolves an undeclared bare workspace root to the same name deriveRepoNameFromCwd() would produce', async () => {
    const projectRoot = join(tempDir, 'my-undeclared-workspace');
    await mkdir(projectRoot, { recursive: true });

    const result = await getRepositoryContext({
      cwd_path: projectRoot,
      include_insights: false,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);
    expect(data.repository_name).toBe(deriveRepoNameFromCwd(projectRoot));
    expect(data.mirror).toBeUndefined();
  });
});

// ─── Declared tier ─────────────────────────────────────────────────────────

describe('ledger_get_repository_context — identity resolution — declared tier', () => {
  it('resolves by repository_id even when the directory basename matches no folder_names entry (AC-14)', async () => {
    await saveRegistry(ledgerRoot, {
      repositories: [makeEntry('the-real-repo', ['registered-folder-name'])],
    });

    const projectRoot = join(tempDir, 'a-totally-unrelated-basename');
    await declareProject(projectRoot, 'the-real-repo');

    const result = await getRepositoryContext({
      cwd_path: projectRoot,
      include_insights: false,
    });

    expect(isError(result as any)).toBe(false);
    const data = parseResult(result as any);
    expect(data.repository_name).toBe('the-real-repo');
    expect(data.repository_id).toBe('the-real-repo');
    expect(data.repository_label).toBe('the-real-repo');
  });

  it('errors, naming the id and the store searched, when the declared repository_id matches no entry (AC-15)', async () => {
    await saveRegistry(ledgerRoot, { repositories: [] });

    const projectRoot = join(tempDir, 'declared-project');
    await declareProject(projectRoot, 'ghost-repo');

    const result = await getRepositoryContext({
      cwd_path: projectRoot,
      include_insights: false,
    });

    expect(isError(result as any)).toBe(true);
    expect(result.content[0]!.text).toContain('ghost-repo');
    expect(result.content[0]!.text).toContain(ledgerRoot);
  });
});

// ─── mirror field ───────────────────────────────────────────────────────────

describe('ledger_get_repository_context — mirror field (AC-20)', () => {
  it('omits mirror for an undeclared project', async () => {
    const projectRoot = join(tempDir, 'undeclared');
    await mkdir(projectRoot, { recursive: true });

    const result = await getRepositoryContext({ cwd_path: projectRoot, include_insights: false });
    const data = parseResult(result as any);
    expect(data.mirror).toBeUndefined();
  });

  it('omits mirror for a declared project whose strategic-vision output is disabled', async () => {
    await saveRegistry(ledgerRoot, { repositories: [makeEntry('my-repo')] });
    const projectRoot = join(tempDir, 'declared-disabled');
    await declareProject(projectRoot, 'my-repo', { 'strategic-vision': { enabled: false } });

    const result = await getRepositoryContext({ cwd_path: projectRoot, include_insights: false });
    const data = parseResult(result as any);
    expect(data.mirror).toBeUndefined();
  });

  it('reports mirror as stale with generated_at null when the output is enabled but no file has been synced yet', async () => {
    await saveRegistry(ledgerRoot, { repositories: [makeEntry('my-repo')] });
    const projectRoot = join(tempDir, 'declared-not-yet-synced');
    await declareProject(projectRoot, 'my-repo', { 'strategic-vision': { enabled: true } });

    const result = await getRepositoryContext({ cwd_path: projectRoot, include_insights: false });
    const data = parseResult(result as any);
    expect(data.mirror).toBeDefined();
    expect(data.mirror.path).toBe(join(projectRoot, '.ledger', 'strategic-vision.md'));
    expect(data.mirror.generated_at).toBeNull();
    expect(data.mirror.stale).toBe(true);
    expect(typeof data.mirror.vision_hash).toBe('string');
  });

  it('reports mirror as not stale when an existing mirror file matches the current vision', async () => {
    const entry = makeEntry('my-repo');
    await saveRegistry(ledgerRoot, { repositories: [entry] });
    const projectRoot = join(tempDir, 'declared-up-to-date');
    await declareProject(projectRoot, 'my-repo', { 'strategic-vision': { enabled: true } });

    const generatedAt = '2026-03-01T00:00:00.000Z';
    const rendered = renderStrategicVision(entry, generatedAt);
    await writeFile(join(projectRoot, '.ledger', 'strategic-vision.md'), rendered, 'utf-8');

    const result = await getRepositoryContext({ cwd_path: projectRoot, include_insights: false });
    const data = parseResult(result as any);
    expect(data.mirror).toBeDefined();
    expect(data.mirror.stale).toBe(false);
    expect(data.mirror.generated_at).toBe(generatedAt);
  });

  it('reports mirror as stale when an existing mirror file predates a vision change', async () => {
    const oldEntry = makeEntry('my-repo');
    const generatedAt = '2026-03-01T00:00:00.000Z';
    const staleRendered = renderStrategicVision(oldEntry, generatedAt);

    const updatedEntry: RepositoryEntry = {
      ...oldEntry,
      vision: { ...oldEntry.vision, short_term: 'Ship the sequel' },
    };
    await saveRegistry(ledgerRoot, { repositories: [updatedEntry] });

    const projectRoot = join(tempDir, 'declared-stale');
    await declareProject(projectRoot, 'my-repo', { 'strategic-vision': { enabled: true } });
    await writeFile(join(projectRoot, '.ledger', 'strategic-vision.md'), staleRendered, 'utf-8');

    const result = await getRepositoryContext({ cwd_path: projectRoot, include_insights: false });
    const data = parseResult(result as any);
    expect(data.mirror).toBeDefined();
    expect(data.mirror.stale).toBe(true);
  });
});
