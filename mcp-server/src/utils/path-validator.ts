/**
 * Pure path-segment validation utilities (no I/O, no storage dependencies).
 *
 * - `assertSafeSegment()` — boolean predicate; validates a single path segment
 *   against `SAFE_SLUG_REGEX` (`/^[a-z0-9][a-z0-9-]*$/`). Used as the canonical
 *   slug-validation delegate by all `assertSafeSlug()` wrappers in the codebase
 *   (storage layer, GUI handlers) and directly by any site that needs to produce
 *   a layer-specific error on rejection.
 * - `planFolderBasename()` — validates the `{YYYY-MM-DD}-{name}` plan-folder
 *   naming convention and returns the folder basename; throws on mismatch.
 * - `validatePlanPath()` — non-throwing wrapper around `planFolderBasename()`.
 * - `validateSlugSafety()` — non-throwing check that a plan-folder basename also
 *   satisfies `SAFE_SLUG_REGEX` (all-lowercase). Call at project **creation/import**
 *   boundaries only (`ledger_initialize_project`, `ledger_import_standalone`) —
 *   never at read/update call sites, since existing on-disk projects created
 *   before this check existed may not satisfy it and must remain readable.
 *
 * Project-path resolution (`resolveProjectPath`, `formatCandidateList`) lives in
 * `project-resolver.ts`, which owns the `LedgerStore` dependency.
 */

import { basename } from 'path';
import { SAFE_SLUG_REGEX } from './constants.js';

// Pattern: YYYY-MM-DD followed by a hyphen and at least one character
// Example: 2026-02-16-technical-debt-cleanup
const planFolderPattern = /^\d{4}-\d{2}-\d{2}-.+$/;

/**
 * Maximum allowed length (in characters) for a single path segment validated by
 * {@link assertSafeSegment}. Segments exceeding this limit are rejected even when
 * they otherwise satisfy {@link SAFE_SLUG_REGEX}.
 */
export const MAX_SEGMENT_LENGTH = 128;

/**
 * Returns `true` when `segment` is a valid slug segment (lowercase alphanumeric
 * with hyphens, must start with an alphanumeric character, and at most
 * {@link MAX_SEGMENT_LENGTH} characters long), `false` otherwise.
 *
 * Uses {@link SAFE_SLUG_REGEX} from `constants.ts` — callers are responsible for
 * constructing their own layer-specific errors when this returns `false`.
 *
 * The `Boolean(segment)` guard is intentional defense-in-depth: {@link SAFE_SLUG_REGEX}
 * (`/^[a-z0-9][a-z0-9-]*$/`) already rejects empty strings via its `^[a-z0-9]` anchor,
 * so the guard does not change observable behavior. It is retained to make the
 * empty-string rejection explicit and prevent it from being removed as apparent dead code.
 *
 * @param segment - The string to validate.
 */
export function assertSafeSegment(segment: string): boolean {
  return Boolean(segment) && segment.length <= MAX_SEGMENT_LENGTH && SAFE_SLUG_REGEX.test(segment);
}

/**
 * Extracts the plan folder basename from the given project path and validates
 * that it matches the {YYYY-MM-DD}-{project-name} naming convention.
 *
 * @param projectPath - The absolute path to the plan folder
 * @returns The basename of the folder
 * @throws {Error} if the basename does not match the expected pattern
 */
export function planFolderBasename(projectPath: string): string {
  const normalised = projectPath.replace(/\\/g, '/');
  const folderName = basename(normalised);
  if (!planFolderPattern.test(folderName)) {
    throw new Error(
      `Invalid project path format. The path should end with a plan folder in the format "{YYYY-MM-DD}-{project-name}".\n\n` +
      `Current folder: "${folderName}"\n` +
      `Expected pattern: YYYY-MM-DD-{project-name}\n` +
      `Example: "2026-02-16-technical-debt-cleanup"\n\n` +
      `It looks like you may have provided the project root path instead of the plan-specific path.\n` +
      `The correct path should be something like:\n` +
      `{project-root}/docs/agents/plans/{YYYY-MM-DD}-{project-name}`
    );
  }
  return folderName;
}

/**
 * Validates that a project path ends with a valid plan folder pattern: {YYYY-MM-DD}-{project-name}
 * 
 * @param projectPath - The absolute path to validate
 * @returns An object with `isValid` boolean and optional `error` message
 */
export function validatePlanPath(projectPath: string): { isValid: boolean; error?: string } {
  try {
    planFolderBasename(projectPath);
    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validates that a plan-folder basename satisfies {@link SAFE_SLUG_REGEX} — the
 * same all-lowercase, alphanumeric-and-hyphens rule the GUI enforces on every
 * `/api/projects/:repo/:slug` route via `assertSafeSlug()`.
 *
 * `planFolderBasename()` / `validatePlanPath()` only check the `{YYYY-MM-DD}-`
 * date prefix — a folder like `2026-09-22-MS01-my-feature` passes that check
 * and gets written into the ledger, then fails every GUI detail-page load with
 * "Invalid repo or slug parameter." (`assertSafeSlug()` rejects the uppercase
 * segment). This check closes that gap at the door, before the mismatched slug
 * is ever persisted.
 *
 * Call this **only** at project creation/import boundaries (`ledger_initialize_project`,
 * `ledger_import_standalone`) — see the module-level note on `validateSlugSafety`
 * for why read/update call sites must not adopt it.
 *
 * @param folderName - The plan-folder basename (typically the return value of
 *   {@link planFolderBasename}).
 */
export function validateSlugSafety(folderName: string): { isValid: boolean; error?: string } {
  if (assertSafeSegment(folderName)) {
    return { isValid: true };
  }
  return {
    isValid: false,
    error:
      `Invalid plan folder name: "${folderName}".\n\n` +
      `Ledger storage requires an all-lowercase slug — letters, digits, and hyphens only, ` +
      `starting with a letter or digit (at most ${MAX_SEGMENT_LENGTH} characters). This is the ` +
      `same rule the GUI enforces on every project URL; a slug that fails it loads fine in the ` +
      `project list but fails with "Invalid repo or slug parameter." the moment it's opened.\n\n` +
      `Rename the plan folder to an all-lowercase equivalent, e.g.:\n` +
      `  "${folderName}" -> "${folderName.toLowerCase()}"\n\n` +
      `Then retry with the corrected path.`,
  };
}

