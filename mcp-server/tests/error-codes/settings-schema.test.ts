import { describe, it, expect } from 'vitest';
import {
  buildSettingsSchema,
  toPublicSettings,
  mergeSettingsUpdate,
  mergeSettingsForTest,
  collectSecrets,
} from '../../src/error-codes/settings-schema.js';
import type { SettingField } from '../../src/error-codes/provider-api.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const FILE_PROVIDER_FIELDS: SettingField[] = [
  { key: 'scope', label: 'Scope', type: 'select', options: [{ value: 'global', label: 'Global' }, { value: 'repository', label: 'Repository' }], default: 'global' },
  { key: 'counter_file', label: 'Counter file', type: 'path', default: '' },
  { key: 'counter_name', label: 'Counter name', type: 'string', default: 'default' },
  { key: 'start_value', label: 'Start value', type: 'integer', min: 1, default: 1 },
];

const HTTP_PROVIDER_FIELDS: SettingField[] = [
  { key: 'base_url', label: 'Base URL', type: 'url', required: true },
  { key: 'password', label: 'Password', type: 'secret', required: true },
  { key: 'counter', label: 'Counter', type: 'string', required: true },
  { key: 'throttle_delay_ms', label: 'Throttle delay', type: 'integer', default: 10000 },
];

describe('settings-schema', () => {
  describe('buildSettingsSchema', () => {
    it('applies descriptor defaults when the field is absent', () => {
      const schema = buildSettingsSchema(FILE_PROVIDER_FIELDS);
      const result = schema.parse({});
      expect(result).toEqual({
        scope: 'global',
        counter_file: '',
        counter_name: 'default',
        start_value: 1,
      });
    });

    it('enforces integer min', () => {
      const schema = buildSettingsSchema(FILE_PROVIDER_FIELDS);
      expect(() => schema.parse({ start_value: 0 })).toThrow();
      expect(schema.parse({ start_value: 5 }).start_value).toBe(5);
    });

    it('enforces integer max', () => {
      const fields: SettingField[] = [{ key: 'n', label: 'N', type: 'integer', min: 1, max: 10 }];
      const schema = buildSettingsSchema(fields);
      expect(() => schema.parse({ n: 11 })).toThrow();
      expect(schema.parse({ n: 10 }).n).toBe(10);
    });

    it('enforces select options-membership', () => {
      const schema = buildSettingsSchema(FILE_PROVIDER_FIELDS);
      expect(() => schema.parse({ scope: 'not-a-real-scope' })).toThrow();
      expect(schema.parse({ scope: 'repository' }).scope).toBe('repository');
    });

    it('requires a required field with no default', () => {
      const schema = buildSettingsSchema(HTTP_PROVIDER_FIELDS);
      expect(() => schema.parse({ password: 'x', counter: 'y' })).toThrow();
    });

    it('accepts a well-formed full settings object', () => {
      const schema = buildSettingsSchema(HTTP_PROVIDER_FIELDS);
      const result = schema.parse({
        base_url: 'https://example.com/counter',
        password: 'secret',
        counter: 'main',
      });
      expect(result.throttle_delay_ms).toBe(10000);
    });

    describe('url field scheme rule', () => {
      const schema = buildSettingsSchema([{ key: 'u', label: 'U', type: 'url' }]);

      it('accepts https://', () => {
        expect(() => schema.parse({ u: 'https://example.com' })).not.toThrow();
      });

      it('accepts http:// for localhost', () => {
        expect(() => schema.parse({ u: 'http://localhost:8080' })).not.toThrow();
      });

      it('accepts http:// for 127.0.0.1', () => {
        expect(() => schema.parse({ u: 'http://127.0.0.1:8080' })).not.toThrow();
      });

      it('accepts http:// for [::1]', () => {
        expect(() => schema.parse({ u: 'http://[::1]:8080' })).not.toThrow();
      });

      it('rejects http:// for a non-loopback host', () => {
        expect(() => schema.parse({ u: 'http://example.com' })).toThrow();
      });

      it('rejects a non-http(s) scheme', () => {
        expect(() => schema.parse({ u: 'ftp://example.com' })).toThrow();
      });

      it('rejects a malformed URL string', () => {
        expect(() => schema.parse({ u: 'not a url' })).toThrow();
      });
    });
  });

  describe('toPublicSettings', () => {
    it('renders a set secret as { set: true }', () => {
      const result = toPublicSettings(HTTP_PROVIDER_FIELDS, { password: 'hunter2', base_url: 'https://x', counter: 'c' });
      expect(result.password).toEqual({ set: true });
    });

    it('renders an unset secret as { set: false }', () => {
      const result = toPublicSettings(HTTP_PROVIDER_FIELDS, { password: '', base_url: 'https://x', counter: 'c' });
      expect(result.password).toEqual({ set: false });
    });

    it('renders a missing secret as { set: false }', () => {
      const result = toPublicSettings(HTTP_PROVIDER_FIELDS, { base_url: 'https://x', counter: 'c' });
      expect(result.password).toEqual({ set: false });
    });

    it('passes non-secret fields through unchanged', () => {
      const result = toPublicSettings(HTTP_PROVIDER_FIELDS, { base_url: 'https://x', counter: 'c', password: 'p' });
      expect(result.base_url).toBe('https://x');
      expect(result.counter).toBe('c');
    });

    it('never leaks the raw secret value anywhere in the output', () => {
      const result = toPublicSettings(HTTP_PROVIDER_FIELDS, { password: 'super-secret-value', base_url: 'https://x', counter: 'c' });
      expect(JSON.stringify(result)).not.toContain('super-secret-value');
    });
  });

  describe('mergeSettingsUpdate', () => {
    it('keeps the stored secret when incoming is absent', () => {
      const stored = { password: 'old-secret', base_url: 'https://x', counter: 'c' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { base_url: 'https://y' });
      expect(result.password).toBe('old-secret');
      expect(result.base_url).toBe('https://y');
    });

    it('keeps the stored secret when incoming is an empty string', () => {
      const stored = { password: 'old-secret', base_url: 'https://x', counter: 'c' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { password: '' });
      expect(result.password).toBe('old-secret');
    });

    it('applies an incoming non-empty secret', () => {
      const stored = { password: 'old-secret', base_url: 'https://x', counter: 'c' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { password: 'new-secret' });
      expect(result.password).toBe('new-secret');
    });

    it('clears a secret key listed in clearKeys, even if incoming carries a value for it', () => {
      const stored = { password: 'old-secret', base_url: 'https://x', counter: 'c' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { password: 'ignored' }, ['password']);
      expect(result.password).toBe('');
    });

    it('applies incoming non-secret field updates', () => {
      const stored = { base_url: 'https://old', password: 'p', counter: 'c' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { base_url: 'https://new' });
      expect(result.base_url).toBe('https://new');
    });

    it('keeps stored non-secret fields not present in incoming', () => {
      const stored = { base_url: 'https://old', password: 'p', counter: 'original-counter' };
      const result = mergeSettingsUpdate(HTTP_PROVIDER_FIELDS, stored, { base_url: 'https://new' });
      expect(result.counter).toBe('original-counter');
    });
  });

  describe('mergeSettingsForTest', () => {
    it('merges the stored secret when every non-secret field is unchanged', () => {
      const stored = { base_url: 'https://x', counter: 'c', password: 'stored-secret' };
      const incoming = { base_url: 'https://x', counter: 'c', password: '' };
      const result = mergeSettingsForTest(HTTP_PROVIDER_FIELDS, stored, incoming);
      expect(result.secrets_merged).toBe(true);
      expect(result.settings.password).toBe('stored-secret');
    });

    it('does not merge the stored secret when a non-secret field changed', () => {
      const stored = { base_url: 'https://x', counter: 'c', password: 'stored-secret' };
      const incoming = { base_url: 'https://y', counter: 'c', password: '' };
      const result = mergeSettingsForTest(HTTP_PROVIDER_FIELDS, stored, incoming);
      expect(result.secrets_merged).toBe(false);
      expect(result.settings.password).toBe('');
    });

    it('does not merge when a non-url, non-secret string field changed (type-agnostic rule)', () => {
      const stored = { base_url: 'https://x', counter: 'c', password: 'stored-secret' };
      const incoming = { base_url: 'https://x', counter: 'different-counter', password: '' };
      const result = mergeSettingsForTest(HTTP_PROVIDER_FIELDS, stored, incoming);
      expect(result.secrets_merged).toBe(false);
    });

    it('does not merge when an integer field changed after defaults are applied', () => {
      const fields: SettingField[] = [
        { key: 'host', label: 'Host', type: 'string', required: true },
        { key: 'password', label: 'Password', type: 'secret', required: true },
        { key: 'delay', label: 'Delay', type: 'integer', default: 1000 },
      ];
      const stored = { host: 'a', password: 'stored', delay: 1000 };
      const incoming = { host: 'a', password: '', delay: 2000 };
      const result = mergeSettingsForTest(fields, stored, incoming);
      expect(result.secrets_merged).toBe(false);
    });

    it('treats a default-filled stored value as equal to an explicit matching incoming value', () => {
      const fields: SettingField[] = [
        { key: 'host', label: 'Host', type: 'string', required: true },
        { key: 'password', label: 'Password', type: 'secret', required: true },
        { key: 'delay', label: 'Delay', type: 'integer', default: 1000 },
      ];
      // stored omits `delay` (relies on the default); incoming states it explicitly.
      const stored = { host: 'a', password: 'stored-secret' };
      const incoming = { host: 'a', password: '', delay: 1000 };
      const result = mergeSettingsForTest(fields, stored, incoming);
      expect(result.secrets_merged).toBe(true);
      expect(result.settings.password).toBe('stored-secret');
    });

    it('keeps the incoming secret value when settings changed', () => {
      const stored = { base_url: 'https://x', counter: 'c', password: 'stored-secret' };
      const incoming = { base_url: 'https://y', counter: 'c', password: 'freshly-typed' };
      const result = mergeSettingsForTest(HTTP_PROVIDER_FIELDS, stored, incoming);
      expect(result.settings.password).toBe('freshly-typed');
    });

    it('keeps a freshly-typed, non-empty incoming secret even when every non-secret field is unchanged', () => {
      const stored = { base_url: 'https://x', counter: 'c', password: 'stored-secret' };
      const incoming = { base_url: 'https://x', counter: 'c', password: 'freshly-typed-new-password' };
      const result = mergeSettingsForTest(HTTP_PROVIDER_FIELDS, stored, incoming);
      expect(result.settings.password).toBe('freshly-typed-new-password');
      expect(result.secrets_merged).toBe(false);
    });
  });

  describe('collectSecrets', () => {
    it('collects every non-empty secret value', () => {
      const secrets = collectSecrets(HTTP_PROVIDER_FIELDS, { password: 'hunter2', base_url: 'https://x', counter: 'c' });
      expect(secrets).toEqual(['hunter2']);
    });

    it('ignores an empty secret value', () => {
      const secrets = collectSecrets(HTTP_PROVIDER_FIELDS, { password: '', base_url: 'https://x', counter: 'c' });
      expect(secrets).toEqual([]);
    });

    it('ignores a missing secret key', () => {
      const secrets = collectSecrets(HTTP_PROVIDER_FIELDS, { base_url: 'https://x', counter: 'c' });
      expect(secrets).toEqual([]);
    });

    it('never includes a non-secret field value', () => {
      const secrets = collectSecrets(HTTP_PROVIDER_FIELDS, { password: 'hunter2', base_url: 'https://x', counter: 'c' });
      expect(secrets).not.toContain('https://x');
      expect(secrets).not.toContain('c');
    });
  });
});
