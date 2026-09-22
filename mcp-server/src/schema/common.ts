import { z } from 'zod';

/**
 * Shared schema constants used across multiple schema modules.
 *
 * This module is the single source of truth for cross-domain constants that
 * would otherwise couple unrelated schema files together. Import from here
 * rather than from a domain-specific schema (e.g. knowledge.ts) to avoid
 * introducing unwanted cross-domain dependencies.
 */

/**
 * Regex pattern for valid slugs (store IDs, repository names, plan slugs, etc.).
 *
 * Accepts slugs that start with an alphanumeric character and contain only
 * letters, digits, underscores, and hyphens. Rejects anything with `/`, `\`,
 * `.`, spaces, or other characters that could escape storage directories.
 *
 * This pattern is the single source of truth — used by all Zod schemas that
 * validate slug-shaped identifiers and by storage-layer path guards.
 * Update this constant to change the slug policy across all consumers at once.
 */
export const SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

// ─── Numeric Tool-Input Helpers ────────────────────────────────────────────
//
// Some MCP clients serialise fractional or numeric tool arguments as strings
// (e.g. `"0.9"` instead of `0.9`). A bare `z.number()` rejects that input
// outright with `Expected number, received string` — an unrecoverable
// failure in the headless orchestrator path, where nothing retries the call
// with an unquoted value.
//
// These helpers exist to fix that *without* reaching for `z.coerce.number()`.
// `z.coerce.number()` converts `null`, `true`/`false`, and `""` into a number
// too (`Number(null) === 0`), which is unsafe wherever `0` carries meaning —
// `confidence: 0` is the Knowledge Curator's insight-retirement marker, so a
// malformed `null` argument silently coercing to `0` would retire an insight
// by accident. `numericInput()` instead wraps the inner schema in a
// `z.preprocess` that converts *only* non-empty strings via `Number(...)`;
// every other input (numbers, `null`, booleans, objects, `""`) falls through
// to the inner schema unchanged, so `null`/`true`/`""` keep failing loudly.
//
// These helpers are for **tool and HTTP inputs only** — arguments supplied
// by an external caller. Never apply them to a storage schema (e.g.
// `InsightSchema` in `schema/knowledge.ts`): a `"0.9"` string in a stored
// record is data corruption and must keep failing strictly on read, not
// self-heal.
//
// The wrapper is field-level only. Per `constraints-code-style.md` §
// *Do Not Use `.refine()`, `.transform()`, `.superRefine()`, or
// `.preprocess()` on Outer Tool Schemas*, applying any effect to the outer
// `z.object()` of a tool's `inputSchema` converts it from a `ZodObject` to a
// `ZodEffects`, which the MCP SDK serialises as an empty `properties: {}` —
// blanking the advertised tool signature. Only ever wrap an individual
// field's schema, never the object itself.
//
// One further surface worth knowing about: the conversion accepts any
// string `Number()` can parse, not just plain decimal literals — hex
// (`"0x5"` → `5`), exponential notation (`"1e2"` → `100`), and a leading
// `"+5"` all convert silently. That is `Number()`'s native behaviour, not
// something these helpers add; it's called out here so a future reader
// isn't surprised by it.

/**
 * Wraps a numeric Zod schema so that non-empty string input is converted to
 * a number before validation, while every other input type (including
 * `null`, booleans, and `""`) falls through to the inner schema unchanged.
 *
 * Field-level only — see the module docblock above for why this must never
 * wrap an outer tool `z.object()`.
 */
export function numericInput<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      return Number(value);
    }
    return value;
  }, inner);
}

/** A plain number field that tolerates a string-encoded value. */
export function numberInput() {
  return numericInput(z.number());
}

/** A positive-integer field (`> 0`) that tolerates a string-encoded value. */
export function positiveIntInput() {
  return numericInput(z.number().int().positive());
}

/** A non-negative-integer field (`>= 0`) that tolerates a string-encoded value. */
export function nonNegativeIntInput() {
  return numericInput(z.number().int().nonnegative());
}

/**
 * A `confidence`-shaped field: a decimal fraction in `[0, 1]` that tolerates
 * a string-encoded value.
 */
export function confidenceInput() {
  return numericInput(z.number().min(0).max(1));
}
