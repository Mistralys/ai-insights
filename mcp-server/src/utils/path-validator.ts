import { basename } from 'path';

// Pattern: YYYY-MM-DD followed by a hyphen and at least one character
// Example: 2026-02-16-technical-debt-cleanup
const planFolderPattern = /^\d{4}-\d{2}-\d{2}-.+$/;

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
 * Validates the project path and returns a formatted error response if invalid.
 * Returns null if the path is valid.
 * 
 * @param projectPath - The absolute path to validate
 * @returns Error response object or null if valid
 */
export function validatePlanPathOrError(projectPath: string) {
  const validation = validatePlanPath(projectPath);
  if (!validation.isValid) {
    return {
      content: [
        {
          type: 'text' as const,
          text: validation.error,
        },
      ],
      isError: true,
    };
  }
  return null;
}
