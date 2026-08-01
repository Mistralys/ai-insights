import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  resolveStoresConfigPath,
  loadStoresConfig,
  saveStoresConfig,
  expandStorePath,
  resolveGuiConfigPath,
} from '../../src/storage/store-registry.js';
import type { StoresConfig } from '../../src/schema/store-config.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeStoresConfig(overrides: Partial<StoresConfig> = {}): StoresConfig {
  return {
    stores: [{ id: 'primary', path: '/ledger/primary', label: 'Primary' }],
    default_store: 'primary',
    ...overrides,
  };
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

describe('store-registry storage module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'store-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── resolveStoresConfigPath ──────────────────────────────────────────

  describe('resolveStoresConfigPath', () => {
    it('returns a path ending in .ai-insights/stores.json', () => {
      const result = resolveStoresConfigPath();
      expect(result.endsWith(join('.ai-insights', 'stores.json'))).toBe(true);
    });

    it('starts with the user home directory', () => {
      const result = resolveStoresConfigPath();
      expect(result.startsWith(homedir())).toBe(true);
    });
  });

  // ─── expandStorePath ─────────────────────────────────────────────────

  describe('expandStorePath', () => {
    it('expands ~/foo to join(homedir(), foo)', () => {
      const result = expandStorePath('~/foo');
      expect(result).toBe(join(homedir(), 'foo'));
    });

    it('expands ~/nested/path correctly', () => {
      const result = expandStorePath('~/projects/ledger');
      expect(result).toBe(join(homedir(), 'projects', 'ledger'));
    });

    it('leaves absolute paths unchanged (normalized)', () => {
      const abs = join(tmpdir(), 'absolute-store');
      const result = expandStorePath(abs);
      expect(result).toBe(abs);
    });

    it('normalizes redundant separators in absolute paths', () => {
      const result = expandStorePath('/some//path/../other');
      // path.resolve normalizes these
      expect(result).not.toContain('//');
      expect(result).not.toContain('..');
    });

    it('throws for ~username syntax (unsupported)', () => {
      expect(() => expandStorePath('~bob')).toThrow('~username syntax which is not supported');
    });

    it('throws for ~username/path syntax', () => {
      expect(() => expandStorePath('~bob/data')).toThrow('~username syntax which is not supported');
    });
  });

  // ─── resolveGuiConfigPath ────────────────────────────────────────────

  describe('resolveGuiConfigPath', () => {
    const ledgerRoot = '/some/ledger/root';

    it('returns ~/.ai-insights/gui-config.json when storeConfig is provided', () => {
      const config = makeStoresConfig();
      const result = resolveGuiConfigPath(config, ledgerRoot);
      expect(result).toBe(join(homedir(), '.ai-insights', 'gui-config.json'));
    });

    it('returns join(ledgerRoot, gui-config.json) when storeConfig is null', () => {
      const result = resolveGuiConfigPath(null, ledgerRoot);
      expect(result).toBe(join(ledgerRoot, 'gui-config.json'));
    });

    it('uses the provided ledgerRoot unchanged when storeConfig is null', () => {
      const customRoot = '/custom/ledger/root';
      const result = resolveGuiConfigPath(null, customRoot);
      expect(result).toBe(join(customRoot, 'gui-config.json'));
    });
  });

  // ─── loadStoresConfig ────────────────────────────────────────────────

  describe('loadStoresConfig', () => {
    it('returns null when stores.json does not exist', async () => {
      const path = join(tempDir, 'nonexistent-stores.json');
      const result = await loadStoresConfig(path);
      expect(result).toBeNull();
    });

    it('does not throw when the file does not exist', async () => {
      const path = join(tempDir, 'nonexistent-stores.json');
      await expect(loadStoresConfig(path)).resolves.not.toThrow();
    });

    it('parses a valid stores.json and returns typed StoresConfig', async () => {
      const config = makeStoresConfig({
        stores: [
          { id: 'home', path: '~/ledger', label: 'Home' },
          { id: 'work', path: '/work/ledger', label: 'Work' },
        ],
        default_store: 'home',
      });
      const path = join(tempDir, 'stores.json');
      await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');

      const result = await loadStoresConfig(path);
      expect(result).not.toBeNull();
      expect(result!.stores).toHaveLength(2);
      expect(result!.default_store).toBe('home');
    });

    it('returns null (with stderr warning) when the file contains malformed JSON', async () => {
      const path = join(tempDir, 'stores.json');
      await writeFile(path, '{ this is not valid json !!!', 'utf-8');

      const stderrLines: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
        stderrLines.push(String(chunk));
        return originalWrite(chunk, ...(args as Parameters<typeof originalWrite>).slice(1));
      };

      const result = await loadStoresConfig(path);

      process.stderr.write = originalWrite;

      expect(result).toBeNull();
      expect(stderrLines.some((l) => l.includes('malformed JSON'))).toBe(true);
    });

    it('returns null (with stderr warning) when the file fails schema validation', async () => {
      const path = join(tempDir, 'stores.json');
      // default_store references a non-existent store id → schema validation fails
      await writeFile(
        path,
        JSON.stringify({
          stores: [{ id: 'primary', path: '/ledger' }],
          default_store: 'does-not-exist',
        }),
        'utf-8'
      );

      const stderrLines: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
        stderrLines.push(String(chunk));
        return originalWrite(chunk, ...(args as Parameters<typeof originalWrite>).slice(1));
      };

      const result = await loadStoresConfig(path);

      process.stderr.write = originalWrite;

      expect(result).toBeNull();
      expect(stderrLines.some((l) => l.includes('schema validation'))).toBe(true);
    });

    it('returns null when the file has invalid store entries (duplicate ids)', async () => {
      const path = join(tempDir, 'stores.json');
      await writeFile(
        path,
        JSON.stringify({
          stores: [
            { id: 'dup', path: '/ledger/a' },
            { id: 'dup', path: '/ledger/b' },
          ],
          default_store: 'dup',
        }),
        'utf-8'
      );

      const result = await loadStoresConfig(path);
      expect(result).toBeNull();
    });
  });

  // ─── saveStoresConfig ────────────────────────────────────────────────

  describe('saveStoresConfig', () => {
    it('writes the config atomically — file is present after save', async () => {
      const config = makeStoresConfig();
      const path = join(tempDir, 'stores.json');

      await saveStoresConfig(config, path);

      const content = await readFile(path, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.stores).toHaveLength(1);
      expect(parsed.stores[0].id).toBe('primary');
    });

    it('round-trips through loadStoresConfig after saveStoresConfig', async () => {
      const config = makeStoresConfig({
        stores: [
          { id: 'home', path: '~/ledger', label: 'Home MacBook' },
          { id: 'work', path: '/work/ledger', label: 'Work Machine' },
        ],
        default_store: 'home',
      });
      const path = join(tempDir, 'stores.json');

      await saveStoresConfig(config, path);
      const loaded = await loadStoresConfig(path);

      expect(loaded).not.toBeNull();
      expect(loaded!.stores).toHaveLength(2);
      expect(loaded!.stores[0].id).toBe('home');
      expect(loaded!.stores[0].label).toBe('Home MacBook');
      expect(loaded!.stores[1].id).toBe('work');
      expect(loaded!.default_store).toBe('home');
    });

    it('preserves optional sync metadata through round-trip', async () => {
      const config: StoresConfig = {
        stores: [
          {
            id: 'primary',
            path: '~/ledger',
            label: 'Primary',
            sync: {
              provider: 'iCloud Drive',
              remote_path: '~/Library/ledger',
              notes: 'Auto-synced',
            },
          },
        ],
        default_store: 'primary',
      };
      const path = join(tempDir, 'stores.json');

      await saveStoresConfig(config, path);
      const loaded = await loadStoresConfig(path);

      expect(loaded!.stores[0].sync?.provider).toBe('iCloud Drive');
      expect(loaded!.stores[0].sync?.notes).toBe('Auto-synced');
    });

    it('overwrites an existing file on subsequent saves', async () => {
      const path = join(tempDir, 'stores.json');

      // First save
      await saveStoresConfig(makeStoresConfig(), path);

      // Second save with different data
      const updated = makeStoresConfig({
        stores: [
          { id: 'home', path: '~/ledger', label: 'Updated' },
        ],
        default_store: 'home',
      });
      await saveStoresConfig(updated, path);

      const loaded = await loadStoresConfig(path);
      expect(loaded!.stores[0].id).toBe('home');
      expect(loaded!.stores[0].label).toBe('Updated');
    });
  });
});
