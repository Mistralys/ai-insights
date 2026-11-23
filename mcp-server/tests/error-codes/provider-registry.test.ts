import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  BUILTIN_PROVIDERS,
  initProviderRegistry,
  getProvider,
  listProviders,
  listProviderLoadErrors,
} from '../../src/error-codes/provider-registry.js';
import type { ErrorCodeProvider } from '../../src/error-codes/provider-api.js';

function makeBuiltin(id: string): ErrorCodeProvider {
  return {
    apiVersion: 1,
    id,
    label: `Builtin ${id}`,
    settings: [],
    async allocate() {
      return { ok: true, value: 1 };
    },
  };
}

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

describe('provider-registry', () => {
  let pluginDir: string;

  beforeEach(async () => {
    pluginDir = await mkdtemp(join(tmpdir(), 'provider-registry-test-'));
    // BUILTIN_PROVIDERS is module-level mutable state shared across tests in
    // this file (and, in principle, the whole process) — reset it so each
    // test starts from a clean slate regardless of what a previous test
    // pushed into it.
    BUILTIN_PROVIDERS.length = 0;
  });

  afterEach(async () => {
    await rm(pluginDir, { recursive: true, force: true });
    BUILTIN_PROVIDERS.length = 0;
  });

  it('registers built-ins with source "builtin" and no path', async () => {
    BUILTIN_PROVIDERS.push(makeBuiltin('file'));

    await initProviderRegistry({ pluginDir });

    expect(getProvider('file')?.id).toBe('file');
    const entry = listProviders().find((e) => e.provider.id === 'file');
    expect(entry?.source).toBe('builtin');
    expect(entry?.path).toBeUndefined();
  });

  it('merges a valid plugin in with source "plugin" and its file path', async () => {
    await writeFile(join(pluginDir, 'plugin.mjs'), validProviderSource('http-counter'), 'utf-8');

    await initProviderRegistry({ pluginDir });

    const entry = listProviders().find((e) => e.provider.id === 'http-counter');
    expect(entry?.source).toBe('plugin');
    expect(entry?.path).toBe(join(pluginDir, 'plugin.mjs'));
  });

  it('rejects a plugin id clashing with a built-in, keeping the built-in working', async () => {
    BUILTIN_PROVIDERS.push(makeBuiltin('file'));
    await writeFile(join(pluginDir, 'clash.mjs'), validProviderSource('file'), 'utf-8');

    await initProviderRegistry({ pluginDir });

    const entry = listProviders().find((e) => e.provider.id === 'file');
    expect(entry?.source).toBe('builtin');
    expect(listProviderLoadErrors()).toHaveLength(1);
    expect(listProviderLoadErrors()[0]?.message).toMatch(/clashes with a built-in/);
  });

  it('getProvider returns undefined for an unknown id', async () => {
    await initProviderRegistry({ pluginDir });
    expect(getProvider('does-not-exist')).toBeUndefined();
  });

  it('surfaces plugin-loader errors unchanged through listProviderLoadErrors', async () => {
    await writeFile(join(pluginDir, 'broken.mjs'), 'export default { not valid {{{', 'utf-8');

    await initProviderRegistry({ pluginDir });

    expect(listProviderLoadErrors()).toHaveLength(1);
    expect(listProviderLoadErrors()[0]?.source).toBe(join(pluginDir, 'broken.mjs'));
  });

  it('leaves one consistent provider set (no duplicates) after calling initProviderRegistry twice', async () => {
    BUILTIN_PROVIDERS.push(makeBuiltin('file'));
    await writeFile(join(pluginDir, 'plugin.mjs'), validProviderSource('http-counter'), 'utf-8');

    await initProviderRegistry({ pluginDir });
    await initProviderRegistry({ pluginDir });

    const ids = listProviders().map((e) => e.provider.id);
    expect(ids.sort()).toEqual(['file', 'http-counter']);
  });

  it('a second init with an empty plugin directory drops providers from a previous plugin scan', async () => {
    await writeFile(join(pluginDir, 'plugin.mjs'), validProviderSource('http-counter'), 'utf-8');
    await initProviderRegistry({ pluginDir });
    expect(getProvider('http-counter')).toBeDefined();

    const emptyDir = await mkdtemp(join(tmpdir(), 'provider-registry-empty-'));
    try {
      await initProviderRegistry({ pluginDir: emptyDir });
      expect(getProvider('http-counter')).toBeUndefined();
      expect(listProviders()).toEqual([]);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
