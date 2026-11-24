/**
 * Unit tests for the tolerant `personas/name-mapping.json` loader.
 *
 * Covers the full state machine:
 *   - path resolution against a mocked `WORKSPACE_ROOT` (per call, not cached)
 *   - present / missing / malformed / non-array JSON
 *   - mtime-based reload vs. cache hit
 *   - stderr warning dedup per failure kind, reset on success
 *   - stdout discipline (never written to)
 *
 * `WORKSPACE_ROOT` is mocked via `../../src/utils/ledger-root.js` with a
 * getter, following the pattern already used in `tests/gui/api-models.test.ts`,
 * so `resolveNameMappingPath()` resolves against a clean temp directory per
 * test rather than the real (pretest-built) workspace mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempWorkspaceRoot = '';

vi.mock('../../src/utils/ledger-root.js', () => ({
  get WORKSPACE_ROOT() {
    return tempWorkspaceRoot;
  },
  ORCHESTRATOR_LOGS_DIR: '/tmp/orchestrator-logs',
  resolveLedgerRoot: () => '/tmp/ledger',
  projectSlugFromPath: (p: string) => p,
  inferProjectRootFromPlanPath: () => null,
  deriveRepoName: () => 'unknown',
}));

// Import AFTER the mock is registered.
import {
  resolveNameMappingPath,
  isNameMappingPresent,
  getAgentNames,
  _resetNameMappingCache,
} from '../../src/utils/name-mapping.js';

function nameMappingDir(root: string): string {
  return join(root, 'personas');
}

function nameMappingFile(root: string): string {
  return join(nameMappingDir(root), 'name-mapping.json');
}

async function writeMapping(root: string, content: string): Promise<void> {
  await mkdir(nameMappingDir(root), { recursive: true });
  await writeFile(nameMappingFile(root), content, 'utf8');
}

/** Bumps a file's mtime forward by `deltaMs` so a subsequent read is forced to re-parse. */
async function bumpMtime(filePath: string, deltaMs: number): Promise<void> {
  const future = new Date(Date.now() + deltaMs);
  await utimes(filePath, future, future);
}

const sampleEntry = (role: string, agentName: string) => ({
  number: 3,
  id: `ledger-${role.toLowerCase()}`,
  role,
  version: '1.0.0',
  suite: 'ledger',
  model: 'Claude Sonnet 5',
  model_slug: 'claude-sonnet-5',
  cc_model: 'inherit',
  vscode: { file_name: `${role}.agent.md`, agent_name: `${agentName} (VS Code)` },
  claude_code: { file_name: `${role}.md`, agent_name: `${agentName.toLowerCase()}` },
  deep_agents: { file_name: `${role}.da.md`, agent_name: `${agentName} (DA)` },
});

describe('name-mapping loader', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), 'name-mapping-test-'));
    _resetNameMappingCache();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    _resetNameMappingCache();
    await rm(tempWorkspaceRoot, { recursive: true, force: true });
  });

  // ─── Path resolution ────────────────────────────────────────────────────

  it('resolveNameMappingPath() resolves against the (mocked) WORKSPACE_ROOT on every call', () => {
    const originalRoot = tempWorkspaceRoot;
    expect(resolveNameMappingPath()).toBe(join(originalRoot, 'personas', 'name-mapping.json'));

    // Changing the mocked root and calling again must reflect the new value
    // immediately — proving the path is read per call, not cached at
    // module load into a constant.
    const otherRoot = join(originalRoot, 'other-root');
    tempWorkspaceRoot = otherRoot;
    expect(resolveNameMappingPath()).toBe(join(otherRoot, 'personas', 'name-mapping.json'));
    tempWorkspaceRoot = originalRoot; // restore for the afterEach cleanup (rm targets originalRoot)
  });

  // ─── isNameMappingPresent() ─────────────────────────────────────────────

  it('isNameMappingPresent() returns false when the file does not exist, true once it is written', async () => {
    expect(isNameMappingPresent()).toBe(false);
    await writeMapping(tempWorkspaceRoot, JSON.stringify([sampleEntry('Developer', 'Dev')]));
    expect(isNameMappingPresent()).toBe(true);
  });

  // ─── Missing file ───────────────────────────────────────────────────────

  it('getAgentNames() returns {} without throwing when the file is missing, and writes nothing to stdout', () => {
    expect(() => getAgentNames()).not.toThrow();
    expect(getAgentNames()).toEqual({});
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  // ─── Malformed JSON ─────────────────────────────────────────────────────

  it('getAgentNames() returns {} without throwing when the file is malformed JSON', async () => {
    await writeMapping(tempWorkspaceRoot, '{ not valid json');
    expect(() => getAgentNames()).not.toThrow();
    expect(getAgentNames()).toEqual({});
  });

  // ─── Non-array JSON ─────────────────────────────────────────────────────

  it('getAgentNames() returns {} without throwing when the file parses but is not a JSON array', async () => {
    await writeMapping(tempWorkspaceRoot, JSON.stringify({ not: 'an array' }));
    expect(() => getAgentNames()).not.toThrow();
    expect(getAgentNames()).toEqual({});
  });

  // ─── Present & valid ────────────────────────────────────────────────────

  it('getAgentNames() returns ledger entries keyed by role when the file exists and is valid', async () => {
    const devEntry = sampleEntry('Developer', 'Dev');
    const qaEntry = sampleEntry('QA', 'QA Agent');
    const standaloneEntry = { ...sampleEntry('Git Committer', 'Git Committer'), suite: 'standalone' };
    await writeMapping(tempWorkspaceRoot, JSON.stringify([devEntry, qaEntry, standaloneEntry]));

    const names = getAgentNames();
    expect(names['Developer' as never]).toEqual(devEntry);
    expect(names['QA' as never]).toEqual(qaEntry);
    // Non-ledger suite entries are filtered out, matching the prior AGENT_NAMES behaviour.
    expect(Object.keys(names)).not.toContain('Git Committer');
  });

  // ─── mtime reload vs. cache hit ─────────────────────────────────────────

  it('reflects a rewritten file (changed mtimeMs) without a process restart', async () => {
    await writeMapping(tempWorkspaceRoot, JSON.stringify([sampleEntry('Developer', 'Dev v1')]));
    const first = getAgentNames();
    expect(first['Developer' as never].vscode.agent_name).toBe('Dev v1 (VS Code)');

    await writeMapping(tempWorkspaceRoot, JSON.stringify([sampleEntry('Developer', 'Dev v2')]));
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 5000);

    const second = getAgentNames();
    expect(second['Developer' as never].vscode.agent_name).toBe('Dev v2 (VS Code)');
  });

  it('does not re-read the file when mtime is unchanged (cache hit)', async () => {
    await writeMapping(tempWorkspaceRoot, JSON.stringify([sampleEntry('Developer', 'Dev v1')]));
    const first = getAgentNames();
    const second = getAgentNames();

    // The loader builds a fresh object via Object.fromEntries() on every real
    // parse, so reference equality across calls is only possible when the
    // second call served the cached value instead of re-reading and
    // re-parsing the (untouched) file — i.e. this proves the mtime-unchanged
    // path is a true cache hit, not merely content that happens to match.
    expect(second).toBe(first);
    expect(second['Developer' as never].vscode.agent_name).toBe('Dev v1 (VS Code)');
  });

  // ─── Warning dedup / reset on success ───────────────────────────────────

  it('writes exactly one stderr warning per failure kind, deduplicated across repeated calls, reset on success', async () => {
    // Missing — first call warns, second call (still missing) does not warn again.
    getAgentNames();
    getAgentNames();
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    // Switch to malformed — new failure kind, warns again once; repeating does not.
    await writeMapping(tempWorkspaceRoot, 'not json at all {');
    getAgentNames();
    getAgentNames();
    expect(stderrSpy).toHaveBeenCalledTimes(2);

    // Switch to non-array — new failure kind, warns again once.
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 1000);
    await writeMapping(tempWorkspaceRoot, JSON.stringify({ nope: true }));
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 2000);
    getAgentNames();
    expect(stderrSpy).toHaveBeenCalledTimes(3);

    // Fix the file — success resets the dedup state, no new warning on success itself.
    await writeMapping(tempWorkspaceRoot, JSON.stringify([sampleEntry('Developer', 'Dev')]));
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 3000);
    const names = getAgentNames();
    expect(names['Developer' as never]).toBeDefined();
    expect(stderrSpy).toHaveBeenCalledTimes(3);

    // Regressing back to missing warns again — dedup state was reset by the success above.
    await rm(nameMappingFile(tempWorkspaceRoot));
    getAgentNames();
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  it('never writes to stdout across any failure path', async () => {
    getAgentNames(); // missing
    await writeMapping(tempWorkspaceRoot, '{ bad');
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 1000);
    getAgentNames(); // malformed
    await writeMapping(tempWorkspaceRoot, JSON.stringify({ nope: true }));
    await bumpMtime(nameMappingFile(tempWorkspaceRoot), 2000);
    getAgentNames(); // non-array

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
