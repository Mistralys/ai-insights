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
