// ─── Agent roles and related constants derived from the shared manifest ────
//
// The manifest's `roles` array is the single source of truth.  Constants are
// derived here at module-load time; no inline literal arrays remain.
//
// The manifest is parsed via ManifestSchema (Zod) at startup so that:
//   1. Malformed manifests surface a clear error immediately.
//   2. AgentRole is inferred from the Zod enum, not manually maintained.
// ─────────────────────────────────────────────────────────────────────────────
import { workflowManifest, type AgentRole } from '../schema/workflow-manifest-schema.js';

/**
 * Canonical agent role definitions shared across the system.
 *
 * AgentRole is inferred from AgentRoleEnum in workflow-manifest-schema.ts —
 * no manual union type declaration here.  Re-exported for consumers that
 * import agent types from utils/constants rather than the schema module.
 */
export type { AgentRole } from '../schema/workflow-manifest-schema.js';
export { AgentRoleEnum } from '../schema/workflow-manifest-schema.js';

export const AGENT_ROLES = workflowManifest.roles.map(r => r.name) as AgentRole[];

/**
 * Safe slug pattern: lowercase alphanumeric with hyphens, must start with alnum.
 * Max length enforced separately (200 chars).
 */
export const SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

// Roles that orchestrate the workflow but do not directly execute implementation work.
// Used to derive CLAIMABLE_ROLES in work-package.ts.
export type OrchestratingRole = 'Planner' | 'Synthesis';
export const ORCHESTRATING_ROLES = workflowManifest.roles
  .filter(r => r.orchestrating)
  .map(r => r.name) as OrchestratingRole[];

/**
 * Map of agent role name → role ID (e.g. 'Project Manager' → 'pm').
 * Useful for graph stage names, config keys, and programmatic lookups.
 */
export const ROLE_IDS: Record<AgentRole, string> = Object.fromEntries(
  workflowManifest.roles.map(r => [r.name, r.id])
) as Record<AgentRole, string>;

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
 * Derived from the shared workflow manifest's `spec_version` field.
 */
export const SPEC_VERSION = workflowManifest.spec_version;
