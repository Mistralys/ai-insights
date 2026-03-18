/**
 * Canonical agent role definitions shared across the system.
 *
 * This is the single source of truth for the nine-agent workflow roles.
 * All other files that reference agent roles should import from here rather
 * than defining local constants.
 */
export const AGENT_ROLES = [
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Security Auditor',
  'Reviewer',
  'Release Engineer',
  'Documentation',
  'Synthesis',
] as const;

export type AgentRole = typeof AGENT_ROLES[number];

// Roles that orchestrate the workflow but do not directly execute implementation work.
// Used to derive CLAIMABLE_ROLES in work-package.ts.
/**
 * Safe slug pattern: lowercase alphanumeric with hyphens, must start with alnum.
 * Max length enforced separately (200 chars).
 */
export const SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export const ORCHESTRATING_ROLES = ['Planner', 'Synthesis'] as const;
export type OrchestratingRole = typeof ORCHESTRATING_ROLES[number];

/**
 * Canonical filenames for the two documents archived into ledger storage.
 *
 * Use these constants wherever the filename is referenced as a literal —
 * in Zod defaults, API handlers, and help-content examples — so that a
 * single-point change keeps every reference in sync.
 */
export const PLAN_ARCHIVE_FILENAME      = 'plan.md'       as const;
export const SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md'  as const;

/**
 * Workflow specification version this MCP server implements.
 * Update this whenever the workflow specification version advances.
 */
export const SPEC_VERSION = '2.4.0' as const;
