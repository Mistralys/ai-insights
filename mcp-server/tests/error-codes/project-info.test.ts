import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { resolveRepositoryInfo } from '../../src/error-codes/project-info.js';

describe('project-info', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-info-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('finds .git as a directory and returns its parent as root_path', async () => {
    const repoRoot = join(tempDir, 'my-repo');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });

    const info = await resolveRepositoryInfo(join(repoRoot, 'src'));
    expect(info).not.toBeNull();
    expect(info?.root_path).toBe(repoRoot);
    expect(info?.folder_name).toBe('my-repo');
  });

  it('returns null outside a repository', async () => {
    const outside = join(tempDir, 'not-a-repo');
    await mkdir(outside, { recursive: true });
    const info = await resolveRepositoryInfo(outside);
    expect(info).toBeNull();
  });

  it('picks up package_name via readProjectName', async () => {
    const repoRoot = join(tempDir, 'named-repo');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: '@scope/named-repo' }), 'utf-8');

    const info = await resolveRepositoryInfo(repoRoot);
    expect(info?.package_name).toBe('@scope/named-repo');
  });

  describe('linked worktree resolution', () => {
    /**
     * Builds a main checkout + linked-worktree fixture matching git's
     * documented layout:
     *
     *   main-checkout/.git/                 (directory)
     *   main-checkout/.git/worktrees/wt1/commondir   -> "../.."
     *   worktree-folder/.git                (file: "gitdir: {relative-or-absolute path to worktrees/wt1}")
     */
    async function buildWorktreeFixture(gitdirStyle: 'relative' | 'absolute'): Promise<{
      mainRoot: string;
      worktreeRoot: string;
    }> {
      const mainRoot = join(tempDir, 'main-checkout');
      const worktreeRoot = join(tempDir, 'worktree-folder');

      const mainGitDir = join(mainRoot, '.git');
      const worktreesEntryDir = join(mainGitDir, 'worktrees', 'wt1');
      await mkdir(worktreesEntryDir, { recursive: true });
      await mkdir(worktreeRoot, { recursive: true });

      // commondir is resolved relative to the worktree's own git dir
      // (worktrees/wt1), and names the shared main .git directory.
      await writeFile(join(worktreesEntryDir, 'commondir'), join('..', '..'), 'utf-8');

      const gitdirTarget =
        gitdirStyle === 'relative' ? relative(worktreeRoot, worktreesEntryDir) : worktreesEntryDir;
      await writeFile(join(worktreeRoot, '.git'), `gitdir: ${gitdirTarget}\n`, 'utf-8');

      return { mainRoot, worktreeRoot };
    }

    it('resolves a relative gitdir: worktree to the main checkout root', async () => {
      const { mainRoot, worktreeRoot } = await buildWorktreeFixture('relative');

      const subDir = join(worktreeRoot, 'src');
      await mkdir(subDir, { recursive: true });

      const fromWorktree = await resolveRepositoryInfo(subDir);
      const fromMain = await resolveRepositoryInfo(mainRoot);

      expect(fromWorktree).not.toBeNull();
      expect(fromWorktree?.root_path).toBe(mainRoot);
      expect(fromWorktree?.folder_name).toBe('main-checkout');
      expect(fromWorktree).toEqual(fromMain);
    });

    it('resolves an absolute gitdir: worktree to the main checkout root', async () => {
      const { mainRoot, worktreeRoot } = await buildWorktreeFixture('absolute');

      const info = await resolveRepositoryInfo(worktreeRoot);
      expect(info?.root_path).toBe(mainRoot);
      expect(info?.folder_name).toBe('main-checkout');
    });
  });

  it('resolves a submodule (.git file with no commondir) to the submodule folder itself', async () => {
    const parentRoot = join(tempDir, 'parent-repo');
    await mkdir(join(parentRoot, '.git'), { recursive: true });

    const submoduleRoot = join(parentRoot, 'sub');
    const submoduleGitDir = join(parentRoot, '.git', 'modules', 'sub');
    await mkdir(submoduleGitDir, { recursive: true });
    await mkdir(submoduleRoot, { recursive: true });
    await writeFile(join(submoduleRoot, '.git'), `gitdir: ${submoduleGitDir}\n`, 'utf-8');

    const info = await resolveRepositoryInfo(submoduleRoot);
    expect(info?.root_path).toBe(submoduleRoot);
    expect(info?.folder_name).toBe('sub');
  });

  it('falls back to the walked directory when a .git file points at a missing directory', async () => {
    const repoRoot = join(tempDir, 'broken-repo');
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(repoRoot, '.git'), 'gitdir: /does/not/exist\n', 'utf-8');

    const info = await resolveRepositoryInfo(repoRoot);
    expect(info?.root_path).toBe(repoRoot);
    expect(info?.folder_name).toBe('broken-repo');
  });
});
