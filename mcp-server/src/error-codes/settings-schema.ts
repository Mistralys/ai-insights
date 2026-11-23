import { z } from 'zod';
import type { SettingField } from './provider-api.js';

/**
 * Runtime validation and secret-handling logic driven by a provider's
 * declarative `settings: SettingField[]` descriptors.
 *
 * One descriptor array feeds all of: the Zod schema that validates stored
 * and incoming settings ({@link buildSettingsSchema}), the public shape
 * returned to the GUI with secrets masked ({@link toPublicSettings}), the
 * save-time merge that preserves unset secrets ({@link mergeSettingsUpdate}),
 * the fail-closed merge used by the GUI's connection test
 * ({@link mergeSettingsForTest}), and the list of live secret values fed to
 * {@link redact} ({@link collectSecrets}, from `./redact.js`).
 */

/**
 * Hostnames treated as loopback for the `url` field's http(s) scheme rule.
 * `URL#hostname` keeps the brackets for an IPv6 literal (`new
 * URL('http://[::1]').hostname === '[::1]'`), so both forms are listed
 * defensively even though only the bracketed form is ever observed today.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validates a `url`-typed setting value: `https://` is always accepted;
 * `http://` is accepted only when the host is a loopback address
 * (`localhost`, `127.0.0.1`, `[::1]`). Every other scheme, and every other
 * `http://` host, is rejected.
 *
 * This rule lives here — in the core — rather than behind a per-descriptor
 * flag, so a plugin author cannot weaken it: a password configured on a
 * `url` field never travels over plain HTTP across a network.
 */
function urlFieldSchema(): z.ZodType<string> {
  return z.string().superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid URL' });
      return;
    }

    if (parsed.protocol === 'https:') {
      return;
    }
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must use https://, or http:// only for localhost, 127.0.0.1 or [::1]',
    });
  });
}

/** `true` when `field` declares `required: true`. Descriptor variants that carry no `required` member (boolean, select) are never required at the schema level — they always resolve through their own default or stay optional. */
function isRequired(field: SettingField): boolean {
  return 'required' in field && field.required === true;
}

/** Builds the Zod schema for a single setting field, applying its own type rules, its `default` (when declared), and its `required` flag. */
function fieldSchema(field: SettingField): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field.type) {
    case 'string':
    case 'path':
      schema = z.string();
      break;
    case 'url':
      schema = urlFieldSchema();
      break;
    case 'secret':
      schema = z.string();
      break;
    case 'integer': {
      let intSchema = z.number().int();
      if (field.min !== undefined) {
        intSchema = intSchema.min(field.min);
      }
      if (field.max !== undefined) {
        intSchema = intSchema.max(field.max);
      }
      schema = intSchema;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'select': {
      const values = field.options.map((o) => o.value);
      // z.enum requires a statically non-empty tuple type; providers are
      // validated (provider-validation.ts) to declare at least one option,
      // so this cast reflects a precondition already enforced upstream.
      schema = z.enum(values as [string, ...string[]]);
      break;
    }
    default: {
      // Unknown types are rejected by provider-validation.ts before a
      // provider is ever registered, so this branch is unreachable for a
      // validated provider. Fail loudly rather than silently accepting
      // anything, in case that invariant is ever violated.
      const exhaustive: never = field;
      throw new Error(`settings-schema: unknown setting field type: ${JSON.stringify(exhaustive)}`);
    }
  }

  if ('default' in field && field.default !== undefined) {
    return schema.default(field.default as never);
  }

  return isRequired(field) ? schema : schema.optional();
}

/**
 * Builds a Zod object schema from a provider's `settings` descriptors.
 *
 * - `integer` fields respect their declared `min`/`max`.
 * - `select` fields must be one of their declared `options` values.
 * - A field's `default` is applied by Zod when the value is absent.
 * - `url` fields enforce the loopback-only `http://` exception described above.
 */
export function buildSettingsSchema(fields: readonly SettingField[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = fieldSchema(field);
  }
  return z.object(shape);
}

/**
 * Fills in each field's declared `default` for any key that is absent or
 * `undefined` in `values`. Deliberately lenient (never throws, never
 * enforces `required`): used internally for pure, side-effect-free
 * comparisons ({@link mergeSettingsForTest}) where a partially-filled
 * incoming or stored object must never be rejected outright.
 */
function applyDefaults(
  fields: readonly SettingField[],
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...values };
  for (const field of fields) {
    if (result[field.key] === undefined && 'default' in field && field.default !== undefined) {
      result[field.key] = field.default;
    }
  }
  return result;
}

/**
 * Renders a settings object for GUI consumption: every `secret` field
 * becomes `{ set: boolean }` (`true` when a non-empty value is stored),
 * never the raw value. Every other field is passed through unchanged.
 */
export function toPublicSettings(
  fields: readonly SettingField[],
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === 'secret') {
      const value = values[field.key];
      result[field.key] = { set: typeof value === 'string' && value.trim().length > 0 };
    } else {
      result[field.key] = values[field.key];
    }
  }
  return result;
}

/**
 * Merges a settings update (e.g. the GUI's `PUT /api/error-codes/config`
 * body) into a provider's stored settings.
 *
 * - Non-secret fields: an incoming value (including an explicit `undefined`
 *   key omission) is applied when the key is present in `incoming`;
 *   otherwise the stored value is kept.
 * - Secret fields: an absent or empty-string incoming value keeps the
 *   stored secret (so the GUI never has to resend a password just to save
 *   an unrelated field). A key listed in `clearKeys` is cleared to `''`
 *   regardless of what `incoming` carries for it — this is the only way to
 *   remove a stored secret.
 *
 * @param clearKeys - Secret keys to explicitly clear, e.g. the GUI's "Clear stored value" checkbox.
 */
export function mergeSettingsUpdate(
  fields: readonly SettingField[],
  stored: Readonly<Record<string, unknown>>,
  incoming: Readonly<Record<string, unknown>>,
  clearKeys: readonly string[] = []
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...stored };
  const clearSet = new Set(clearKeys);

  for (const field of fields) {
    const key = field.key;

    if (field.type === 'secret') {
      if (clearSet.has(key)) {
        result[key] = '';
        continue;
      }
      const incomingValue = incoming[key];
      const isAbsentOrEmpty =
        incomingValue === undefined ||
        (typeof incomingValue === 'string' && incomingValue.trim().length === 0);
      if (isAbsentOrEmpty) {
        continue; // keep the stored value already copied into `result`
      }
      result[key] = incomingValue;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      result[key] = incoming[key];
    }
  }

  return result;
}

/** Result of {@link mergeSettingsForTest}. */
export interface MergeSettingsForTestResult {
  settings: Record<string, unknown>;
  /** `true` when stored secrets were merged into `settings`; `false` when `settings` reflects the incoming values only (including any incoming secrets). */
  secrets_merged: boolean;
}

/**
 * The fail-closed merge used by the GUI's "Test connection" flow (see plan
 * Approach §2 / §6, "GUI security rules").
 *
 * Stored secrets are merged into the incoming settings **only when every
 * non-secret field in `incoming` equals its stored value**, after each
 * field's descriptor default has been applied to both sides. Any other
 * difference — in a field of any type, not only `url` — means the result
 * carries the incoming secrets only, so a changed destination is never
 * tested with a password that was meant for a different one.
 *
 * Even when the non-secret fields are unchanged, a given secret field is
 * only filled in from the stored value when its own incoming value is
 * absent or empty — mirroring {@link mergeSettingsUpdate}'s per-field
 * `isAbsentOrEmpty` check. A freshly-typed, non-empty secret is never
 * overwritten by the stale stored one, so testing a just-edited password
 * never silently falls back to the old value.
 *
 * Pure and synchronous on purpose: the rule is tested without ever making
 * an HTTP call.
 */
export function mergeSettingsForTest(
  fields: readonly SettingField[],
  stored: Readonly<Record<string, unknown>>,
  incoming: Readonly<Record<string, unknown>>
): MergeSettingsForTestResult {
  const storedDefaulted = applyDefaults(fields, stored);
  const incomingDefaulted = applyDefaults(fields, incoming);

  const nonSecretFields = fields.filter((f) => f.type !== 'secret');
  const unchanged = nonSecretFields.every(
    (f) => storedDefaulted[f.key] === incomingDefaulted[f.key]
  );

  if (!unchanged) {
    return { settings: incomingDefaulted, secrets_merged: false };
  }

  const merged: Record<string, unknown> = { ...incomingDefaulted };
  let mergedAny = false;
  for (const field of fields) {
    if (field.type !== 'secret') {
      continue;
    }
    const incomingValue = incomingDefaulted[field.key];
    const isAbsentOrEmpty =
      incomingValue === undefined ||
      (typeof incomingValue === 'string' && incomingValue.trim().length === 0);
    if (isAbsentOrEmpty && storedDefaulted[field.key] !== undefined) {
      merged[field.key] = storedDefaulted[field.key];
      mergedAny = true;
    }
  }

  return { settings: merged, secrets_merged: mergedAny };
}

/**
 * Collects every non-empty secret value present in `values`, for feeding
 * into {@link redact}/`createRedactingLogger` (`./redact.js`). Kept here,
 * alongside the descriptors it reads, rather than in `redact.ts` — see that
 * module's docblock for why redaction itself lives separately.
 */
export function collectSecrets(
  fields: readonly SettingField[],
  values: Readonly<Record<string, unknown>>
): string[] {
  const secrets: string[] = [];
  for (const field of fields) {
    if (field.type === 'secret') {
      const value = values[field.key];
      if (typeof value === 'string' && value.length > 0) {
        secrets.push(value);
      }
    }
  }
  return secrets;
}
