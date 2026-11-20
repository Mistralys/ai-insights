import { z } from 'zod';
import { SUPPORTED_PROVIDER_API_VERSIONS, type ErrorCodeProvider } from './provider-api.js';

/**
 * Runtime validation for an {@link ErrorCodeProvider} object, applied
 * uniformly to built-in and plugin-loaded providers alike.
 *
 * Checked, via the Zod schema below:
 * - `apiVersion` is one of {@link SUPPORTED_PROVIDER_API_VERSIONS};
 * - `id` matches `/^[a-z][a-z0-9-]{1,47}$/`;
 * - `label` is a non-empty string;
 * - `allocate` is a function;
 * - `settings` is an array of well-formed descriptors: a known `type`,
 *   `options` present (non-empty) for `type: 'select'`, and no duplicate
 *   `key` across the array (checked via `.superRefine`, since uniqueness
 *   is a cross-element rule a per-element schema cannot express);
 * - `peek` and `test`, when present, are functions — a present-but-wrong-type
 *   value (e.g. `peek: true`) is a readable error, never a silent
 *   "capability present".
 *
 * `validateProvider` returns either the validated provider (typed as
 * `ErrorCodeProvider`) or a list of readable error strings — it never
 * throws, so callers (the plugin loader, the built-in registry) can treat
 * every failure the same way: a load error recorded against that provider,
 * never a process crash.
 */

/** Pattern a provider `id` must match. Keep in sync with the JSDoc on `ErrorCodeProvider.id`. */
const PROVIDER_ID_REGEX = /^[a-z][a-z0-9-]{1,47}$/;

/** A function value, validated by `typeof`, since Zod has no native function type with useful error messages for this use. */
const FunctionSchema = z.custom<(...args: unknown[]) => unknown>(
  (val) => typeof val === 'function',
  { message: 'must be a function' }
);

/** Optional-hook schema: when the key is present and not `undefined`, it must be a function. Absent/`undefined` is valid (the hook is simply not offered). */
const OptionalHookSchema = FunctionSchema.optional();

const SelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

const BaseSettingFieldSchema = z.object({
  key: z.string().min(1, 'key must be a non-empty string'),
  label: z.string().min(1, 'label must be a non-empty string'),
  description: z.string().optional(),
});

const SettingFieldSchema = z
  .discriminatedUnion('type', [
    BaseSettingFieldSchema.extend({
      type: z.enum(['string', 'url', 'path']),
      required: z.boolean().optional(),
      default: z.string().optional(),
      placeholder: z.string().optional(),
    }),
    BaseSettingFieldSchema.extend({
      type: z.literal('secret'),
      required: z.boolean().optional(),
    }),
    BaseSettingFieldSchema.extend({
      type: z.literal('integer'),
      required: z.boolean().optional(),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    }),
    BaseSettingFieldSchema.extend({
      type: z.literal('boolean'),
      default: z.boolean().optional(),
    }),
    BaseSettingFieldSchema.extend({
      type: z.literal('select'),
      options: z.array(SelectOptionSchema).min(1, "'select' settings must declare a non-empty options array"),
      default: z.string().optional(),
    }),
  ])
  // `min <= max` is a cross-field rule within the 'integer' variant. It
  // cannot live inside that variant's own schema: a per-branch `.refine()`
  // turns the branch into a `ZodEffects`, which `z.discriminatedUnion`
  // rejects (every member must stay a plain `ZodObject`). Checking it here,
  // after the union, keeps every branch a plain object.
  .superRefine((field, ctx) => {
    if (field.type === 'integer' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'min must not be greater than max',
        path: ['min'],
      });
    }
  });

const SettingsArraySchema = z
  .array(SettingFieldSchema)
  .superRefine((fields, ctx) => {
    const seen = new Map<string, number>();
    fields.forEach((field, index) => {
      const firstIndex = seen.get(field.key);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate settings key '${field.key}' (also at index ${firstIndex})`,
          path: [index, 'key'],
        });
      } else {
        seen.set(field.key, index);
      }
    });
  });

/**
 * The full provider schema. `apiVersion` and `id` use `.refine()` rather
 * than `z.literal`/`z.enum`, because the set of supported versions and the
 * id pattern are named constants shared with the rest of the module (and,
 * for the id pattern, with `ErrorCodeProvider`'s own JSDoc) — duplicating
 * them as literal Zod unions would let the two drift.
 */
const ErrorCodeProviderSchema = z.object({
  apiVersion: z
    .number()
    .refine((v) => (SUPPORTED_PROVIDER_API_VERSIONS as readonly number[]).includes(v), {
      message: `apiVersion must be one of ${SUPPORTED_PROVIDER_API_VERSIONS.join(', ')}`,
    }),
  id: z.string().regex(PROVIDER_ID_REGEX, `id must match ${PROVIDER_ID_REGEX}`),
  label: z.string().min(1, 'label must be a non-empty string'),
  description: z.string().optional(),
  settings: SettingsArraySchema,
  allocate: FunctionSchema,
  peek: OptionalHookSchema,
  test: OptionalHookSchema,
});

export interface ProviderValidationSuccess {
  ok: true;
  provider: ErrorCodeProvider;
}

export interface ProviderValidationFailure {
  ok: false;
  errors: string[];
}

export type ProviderValidationResult = ProviderValidationSuccess | ProviderValidationFailure;

/** Renders a single Zod issue as one readable line, prefixing the dotted field path when present. */
function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Validates a candidate provider object (built-in or plugin-loaded).
 *
 * @param candidate - The object to validate, typically a plugin's default export or a built-in provider literal.
 */
export function validateProvider(candidate: unknown): ProviderValidationResult {
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: ['provider must be an object'] };
  }

  const result = ErrorCodeProviderSchema.safeParse(candidate);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map(formatIssue) };
  }

  // The Zod schema is intentionally a structural subset of ErrorCodeProvider
  // (it does not re-type the discriminated SettingField union's exact
  // shape back into the provider-api.ts types). Re-attach the original
  // candidate so callers get back exactly the object they passed in,
  // typed as ErrorCodeProvider.
  return { ok: true, provider: candidate as ErrorCodeProvider };
}
