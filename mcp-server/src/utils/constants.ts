/**
 * Canonical agent role definitions shared across the system.
 *
 * This is the single source of truth for the seven-stage workflow agent roles.
 * All other files that reference agent roles should import from here rather
 * than defining local constants.
 */
export const AGENT_ROLES = [
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Reviewer',
  'Documentation',
  'Synthesis',
] as const;

export type AgentRole = typeof AGENT_ROLES[number];

// Roles that orchestrate the workflow but do not directly execute implementation work.
// Used to derive CLAIMABLE_ROLES in work-package.ts.
export const ORCHESTRATING_ROLES = ['Planner', 'Synthesis'] as const;
export type OrchestratingRole = typeof ORCHESTRATING_ROLES[number];
