import { describe, it, expect } from 'vitest';
import {
  StoreEntrySchema,
  StoresConfigSchema,
  type StoreEntry,
  type StoresConfig,
  type StoreListItem,
} from '../../src/schema/store-config.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeStoreEntry(overrides: Partial<StoreEntry> = {}): StoreEntry {
  return {
    id: 'primary',
    path: '/ledger/primary',
    ...overrides,
  };
}

function makeStoresConfig(overrides: Partial<StoresConfig> = {}): StoresConfig {
  return {
    stores: [makeStoreEntry()],
    default_store: 'primary',
    ...overrides,
  };
}

// ─── StoreEntrySchema ──────────────────────────────────────────────────────

describe('StoreEntrySchema', () => {
  it('accepts a minimal valid entry (id + path)', () => {
    const result = StoreEntrySchema.safeParse({ id: 'primary', path: '/ledger' });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated entry with label and sync metadata', () => {
    const result = StoreEntrySchema.safeParse({
      id: 'home-mac',
      path: '~/ledger',
      label: 'Home MacBook',
      sync: {
        provider: 'iCloud Drive',
        remote_path: '~/Library/Mobile Documents/ledger',
        notes: 'Synced automatically',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBe('Home MacBook');
      expect(result.data.sync?.provider).toBe('iCloud Drive');
    }
  });

  it('rejects an id that does not match SLUG_REGEX (starts with hyphen)', () => {
    const result = StoreEntrySchema.safeParse({ id: '-bad', path: '/ledger' });
    expect(result.success).toBe(false);
  });

  it('rejects an id containing spaces', () => {
    const result = StoreEntrySchema.safeParse({ id: 'my store', path: '/ledger' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty id', () => {
    const result = StoreEntrySchema.safeParse({ id: '', path: '/ledger' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty path', () => {
    const result = StoreEntrySchema.safeParse({ id: 'primary', path: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing path', () => {
    const result = StoreEntrySchema.safeParse({ id: 'primary' });
    expect(result.success).toBe(false);
  });

  it('accepts a tilde path (expansion happens at runtime)', () => {
    const result = StoreEntrySchema.safeParse({ id: 'home', path: '~/ledger' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe('~/ledger');
    }
  });

  it('allows label to be omitted', () => {
    const result = StoreEntrySchema.safeParse({ id: 'primary', path: '/ledger' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeUndefined();
    }
  });

  it('allows sync to be omitted', () => {
    const result = StoreEntrySchema.safeParse({ id: 'primary', path: '/ledger' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sync).toBeUndefined();
    }
  });

  it('accepts alphanumeric id', () => {
    const result = StoreEntrySchema.safeParse({ id: 'store123', path: '/ledger' });
    expect(result.success).toBe(true);
  });

  it('accepts id with hyphens and underscores', () => {
    const result = StoreEntrySchema.safeParse({ id: 'my-store_v2', path: '/ledger' });
    expect(result.success).toBe(true);
  });
});

// ─── StoresConfigSchema ────────────────────────────────────────────────────

describe('StoresConfigSchema', () => {
  it('accepts a valid config with one store', () => {
    const result = StoresConfigSchema.safeParse(makeStoresConfig());
    expect(result.success).toBe(true);
  });

  it('accepts a valid config with two stores', () => {
    const result = StoresConfigSchema.safeParse({
      stores: [
        makeStoreEntry({ id: 'home', path: '~/ledger' }),
        makeStoreEntry({ id: 'work', path: '/work/ledger' }),
      ],
      default_store: 'home',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stores).toHaveLength(2);
      expect(result.data.default_store).toBe('home');
    }
  });

  it('rejects a config with an empty stores array', () => {
    const result = StoresConfigSchema.safeParse({
      stores: [],
      default_store: 'primary',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing the stores field', () => {
    const result = StoresConfigSchema.safeParse({ default_store: 'primary' });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing the default_store field', () => {
    const result = StoresConfigSchema.safeParse({
      stores: [makeStoreEntry()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate store IDs', () => {
    const result = StoresConfigSchema.safeParse({
      stores: [
        makeStoreEntry({ id: 'dup' }),
        makeStoreEntry({ id: 'dup' }),
      ],
      default_store: 'dup',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('stores'))).toBe(true);
    }
  });

  it('rejects a default_store that does not match any store id', () => {
    const result = StoresConfigSchema.safeParse({
      stores: [makeStoreEntry({ id: 'primary' })],
      default_store: 'nonexistent',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('default_store'))).toBe(true);
    }
  });

  it('preserves all store fields through parse', () => {
    const config = {
      stores: [
        {
          id: 'primary',
          path: '/ledger',
          label: 'Primary',
          sync: { provider: 'Dropbox', remote_path: '/remote/ledger' },
        },
      ],
      default_store: 'primary',
    };
    const result = StoresConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stores[0].sync?.provider).toBe('Dropbox');
    }
  });
});

// ─── StoreListItem (WP-012: migrated from gui/api.ts) ─────────────────────

describe('StoreListItem', () => {
  // Scope: this test verifies only that StoreListItem is correctly exported from
  // src/schema/store-config.ts (the canonical definition site after WP-012).
  // The re-export from gui/api.ts (kept for backward compatibility) is intentionally
  // not covered here — it is a structural TypeScript re-export with no runtime
  // behaviour to validate.
  it('is importable from schema/store-config.ts and has the expected shape', () => {
    // Construct a value that satisfies the StoreListItem interface to confirm
    // the type is correctly exported from the schema module.
    const item: StoreListItem = {
      id: 'primary',
      label: 'Primary Store',
      path: '/ledger/primary',
      project_count: 3,
      repository_count: 2,
    };

    expect(item.id).toBe('primary');
    expect(item.label).toBe('Primary Store');
    expect(item.path).toBe('/ledger/primary');
    expect(item.project_count).toBe(3);
    expect(item.repository_count).toBe(2);
  });
});
