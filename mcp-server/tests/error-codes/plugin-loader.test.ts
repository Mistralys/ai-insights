import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { fileURLToPath } from 'url';
import { loadPluginProviders, PLUGIN_IMPORT_TIMEOUT_MS } from '../../src/error-codes/plugin-loader.js';
import type { AllocationOutcome, ProviderContext } from '../../src/error-codes/provider-api.js';

/** Absolute path to `docs/examples/`, the parent of the shipped example plugin folder. */
const EXAMPLES_DIR = fileURLToPath(new URL('../../docs/examples/', import.meta.url));

/** A minimal, valid default-exported ErrorCodeProvider as ESM source text. */
function validProviderSource(id: string): string {
  return `export default {
  apiVersion: 1,
  id: '${id}',
  label: 'Plugin ${id}',
  settings: [],
  async allocate() {
    return { ok: true, value: 1 };
  },
};
`;
}

describe('plugin-loader', () => {
  let pluginDir: string;

  beforeEach(async () => {
    pluginDir = await mkdtemp(join(tmpdir(), 'plugin-loader-test-'));
  });

  afterEach(async () => {
    await rm(pluginDir, { recursive: true, force: true });
  });

  it('returns no providers and no errors for a missing plugin directory', async () => {
    const missing = join(pluginDir, 'does-not-exist');
    const result = await loadPluginProviders(missing);
    expect(result).toEqual({ providers: [], errors: [] });
  });

  it('loads a single-file .mjs plugin', async () => {
    await writeFile(join(pluginDir, 'single.mjs'), validProviderSource('single-file'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.errors).toEqual([]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider.id).toBe('single-file');
    expect(result.providers[0]?.path).toBe(join(pluginDir, 'single.mjs'));
  });

  it('loads a single-file .js plugin', async () => {
    await writeFile(join(pluginDir, 'single.js'), validProviderSource('single-js'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.errors).toEqual([]);
    expect(result.providers[0]?.provider.id).toBe('single-js');
  });

  it('loads a folder plugin whose package.json main names the entry', async () => {
    const folder = join(pluginDir, 'folder-with-main');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ main: 'entry.mjs' }), 'utf-8');
    await writeFile(join(folder, 'entry.mjs'), validProviderSource('folder-main'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.errors).toEqual([]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider.id).toBe('folder-main');
    expect(result.providers[0]?.path).toBe(folder);
  });

  it('loads a folder plugin with only an index.mjs', async () => {
    const folder = join(pluginDir, 'folder-with-index');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'index.mjs'), validProviderSource('folder-index'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.errors).toEqual([]);
    expect(result.providers[0]?.provider.id).toBe('folder-index');
  });

  it('reports a folder with neither main nor index.mjs as a load error', async () => {
    const folder = join(pluginDir, 'folder-empty');
    await mkdir(folder, { recursive: true });

    const result = await loadPluginProviders(pluginDir);
    expect(result.providers).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toBe(folder);
    expect(result.errors[0]?.message).toMatch(/main|index\.mjs/);
  });

  it('does not resolve a package.json exports map (treated as neither main nor index.mjs)', async () => {
    const folder = join(pluginDir, 'folder-exports-only');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'package.json'),
      JSON.stringify({ exports: { '.': './entry.mjs' } }),
      'utf-8'
    );
    await writeFile(join(folder, 'entry.mjs'), validProviderSource('folder-exports'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.providers).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toBe(folder);
  });

  it('reports a syntax-error plugin as a load error without halting the scan', async () => {
    await writeFile(join(pluginDir, 'broken.mjs'), 'export default { this is not valid js {{{', 'utf-8');
    await writeFile(join(pluginDir, 'ok.mjs'), validProviderSource('ok-after-broken'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider.id).toBe('ok-after-broken');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toBe(join(pluginDir, 'broken.mjs'));
    expect(result.errors[0]?.message).not.toMatch(/at .*\.mjs:\d+:\d+/); // no stack frame text
  });

  it('reports an invalid-shape plugin as a load error', async () => {
    await writeFile(
      join(pluginDir, 'invalid-shape.mjs'),
      `export default { id: 'x', label: 'No allocate' };\n`,
      'utf-8'
    );

    const result = await loadPluginProviders(pluginDir);
    expect(result.providers).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/invalid provider/);
  });

  it('reports the second of two plugins declaring the same id as a load error, keeping the first', async () => {
    await writeFile(join(pluginDir, 'first.mjs'), validProviderSource('dup-id'), 'utf-8');
    await writeFile(join(pluginDir, 'second.mjs'), validProviderSource('dup-id'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.path).toBe(join(pluginDir, 'first.mjs'));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toBe(join(pluginDir, 'second.mjs'));
    expect(result.errors[0]?.message).toMatch(/dup-id/);
  });

  it('loads a plugin whose path contains spaces (pathToFileURL correctness)', async () => {
    const folder = join(pluginDir, 'folder with spaces');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'index.mjs'), validProviderSource('spacey'), 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result.errors).toEqual([]);
    expect(result.providers[0]?.provider.id).toBe('spacey');
  });

  it('ignores non-plugin files at the top level', async () => {
    await writeFile(join(pluginDir, 'README.md'), '# not a plugin', 'utf-8');
    await writeFile(join(pluginDir, 'notes.txt'), 'not a plugin either', 'utf-8');

    const result = await loadPluginProviders(pluginDir);
    expect(result).toEqual({ providers: [], errors: [] });
  });

  // -------------------------------------------------------------------------
  // WP-012: the real example plugin shipped in docs/examples/
  // -------------------------------------------------------------------------

  it('loads the real example plugin shipped in docs/examples/error-code-provider-example, and it allocates successfully', async () => {
    const result = await loadPluginProviders(EXAMPLES_DIR);
    expect(result.errors).toEqual([]);

    const loaded = result.providers.find((p) => p.provider.id === 'example-json-counter');
    expect(loaded).toBeDefined();
    expect(loaded?.path).toBe(join(EXAMPLES_DIR, 'error-code-provider-example'));

    const dataDir = await mkdtemp(join(tmpdir(), 'example-plugin-data-'));
    try {
      const ctx: ProviderContext = {
        settings: { counter_file: '', start_value: 1 },
        signal: AbortSignal.timeout(5000),
        data_dir: dataDir,
        log: { info: () => undefined, warn: () => undefined },
      };
      const request = { request_id: 'test-request-1', cwd_path: null, repository: null, context: null };

      const first: AllocationOutcome = await loaded!.provider.allocate(request, ctx);
      expect(first).toEqual({ ok: true, value: 1 });

      const second: AllocationOutcome = await loaded!.provider.allocate(request, ctx);
      expect(second).toEqual({ ok: true, value: 2 });

      // peek() reports the next value without consuming it.
      const peeked: AllocationOutcome = await loaded!.provider.peek!(request, ctx);
      expect(peeked).toEqual({ ok: true, value: 3 });
      const third: AllocationOutcome = await loaded!.provider.allocate(request, ctx);
      expect(third).toEqual({ ok: true, value: 3 });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  describe('symbolic links', () => {
    let outsideDir: string;

    beforeEach(async () => {
      outsideDir = await mkdtemp(join(tmpdir(), 'plugin-loader-target-'));
    });

    afterEach(async () => {
      await rm(outsideDir, { recursive: true, force: true });
    });

    it.skipIf(platform() === 'win32')('loads a plugin through a file symlink, reporting the link path', async () => {
      const target = join(outsideDir, 'real.mjs');
      await writeFile(target, validProviderSource('linked-file'), 'utf-8');
      const link = join(pluginDir, 'linked.mjs');
      await symlink(target, link);

      const result = await loadPluginProviders(pluginDir);
      expect(result.errors).toEqual([]);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]?.provider.id).toBe('linked-file');
      expect(result.providers[0]?.path).toBe(link);
    });

    it('loads a folder plugin through a directory link', async () => {
      const target = join(outsideDir, 'folder-plugin');
      await mkdir(target);
      await writeFile(join(target, 'index.mjs'), validProviderSource('linked-folder'), 'utf-8');
      const link = join(pluginDir, 'folder-link');
      await symlink(target, link, 'junction');

      const result = await loadPluginProviders(pluginDir);
      expect(result.errors).toEqual([]);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]?.provider.id).toBe('linked-folder');
      expect(result.providers[0]?.path).toBe(link);
    });

    it.skipIf(platform() === 'win32')('reports a dangling symlink as a load error and keeps loading the rest', async () => {
      const link = join(pluginDir, 'dangling.mjs');
      await symlink(join(outsideDir, 'missing.mjs'), link);
      await writeFile(join(pluginDir, 'good.mjs'), validProviderSource('still-loads'), 'utf-8');

      const result = await loadPluginProviders(pluginDir);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.source).toBe(link);
      expect(result.errors[0]?.message).toContain('symbolic link target is missing or unreadable');
      expect(result.providers.map((p) => p.provider.id)).toEqual(['still-loads']);
    });
  });

  describe('import timeout', () => {
    it('exports PLUGIN_IMPORT_TIMEOUT_MS as the default timeout', () => {
      expect(PLUGIN_IMPORT_TIMEOUT_MS).toBe(10_000);
    });

    it('times out a plugin whose top-level await never settles, and still loads the others', async () => {
      const hanging = join(pluginDir, 'a-hanging.mjs');
      await writeFile(hanging, 'await new Promise(() => {});\nexport default {};\n', 'utf-8');
      await writeFile(join(pluginDir, 'b-good.mjs'), validProviderSource('after-hang'), 'utf-8');

      const result = await loadPluginProviders(pluginDir, { importTimeoutMs: 200 });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.source).toBe(hanging);
      expect(result.errors[0]?.message).toBe('import timed out after 200 ms');
      expect(result.providers.map((p) => p.provider.id)).toEqual(['after-hang']);
    });

    it('a fast plugin import clears its timeout timer', async () => {
      await writeFile(join(pluginDir, 'fast.mjs'), validProviderSource('fast'), 'utf-8');
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      try {
        const result = await loadPluginProviders(pluginDir);
        expect(result.providers).toHaveLength(1);
        expect(clearSpy.mock.calls.some(([timer]) => typeof timer === 'object' && timer !== null)).toBe(true);
      } finally {
        clearSpy.mockRestore();
      }
    });
  });
});
