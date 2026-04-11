// ─── Agent roles and related constants derived from the shared manifest ────
//
// The manifest's `roles` array is the single source of truth.  Constants are
// derived here at module-load time; no inline literal arrays remain.
//
// The manifest is parsed via ManifestSchema (Zod) at startup so that:
//   1. Malformed manifests surface a clear error immediately.
//   2. AgentRole is inferred from the Zod enum, not manually maintained.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'module';
import { workflowManifest, type AgentRole } from '../schema/workflow-manifest-schema.js';

const _require = createRequire(import.meta.url);

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
 * Handoff-status string for each agent role.
 *
 * Given a target role, `READY_STATUS_FOR_ROLE[role]` returns the READY_FOR_*
 * handoff status that signals work is ready for that agent.  The map is typed
 * as `Record<AgentRole, string>` so TypeScript flags missing keys whenever a
 * role is added or removed in the manifest.
 *
 * NOTE: The suffix is NOT mechanically derivable from role IDs (e.g. "docs" →
 * "DOCUMENTATION", "security_auditor" → "SECURITY_AUDIT"), so the values are
 * explicit.  Orchestrating roles (Planner) map to READY_FOR_PM by convention.
 */
export const READY_STATUS_FOR_ROLE: Record<AgentRole, string> = {
  'Planner':          'READY_FOR_PM',
  'Project Manager':  'READY_FOR_PM',
  'Developer':        'READY_FOR_DEVELOPER',
  'QA':               'READY_FOR_QA',
  'Security Auditor': 'READY_FOR_SECURITY_AUDIT',
  'Reviewer':         'READY_FOR_REVIEW',
  'Release Engineer': 'READY_FOR_RELEASE_ENGINEERING',
  'Documentation':    'READY_FOR_DOCUMENTATION',
  'Synthesis':        'READY_FOR_SYNTHESIS',
};

/**
 * Inverse of READY_STATUS_FOR_ROLE: handoff-status → agent role name.
 * Also includes the special mapping BLOCKED → Project Manager.
 *
 * Derived at init time from READY_STATUS_FOR_ROLE so the two cannot diverge.
 */
export const HANDOFF_STATUS_ROLE: Record<string, AgentRole> = {
  ...Object.fromEntries(
    Object.entries(READY_STATUS_FOR_ROLE).map(([role, status]) => [status, role])
  ) as Record<string, AgentRole>,
  BLOCKED: 'Project Manager' as AgentRole,
};

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
 * Subdirectory path used to store agent dialogue capture files, relative to
 * the project's ledger storage root (`{ledgerRoot}/{slug}/`).
 *
 * The orchestrator's `write_dialogue()` utility writes Markdown files to
 * `orchestrator/dialogues/` inside the ledger folder.  This constant keeps
 * the path in sync between the MCP server and the orchestrator.
 *
 * Usage: `path.join(ledgerRoot, slug, DIALOGUES_DIR)`
 * → `{ledgerRoot}/{slug}/orchestrator/dialogues/`
 */
export const DIALOGUES_DIR = 'orchestrator/dialogues' as const;

/**
 * Subdirectory path used to store streaming chunk capture files, relative to
 * the project's ledger storage root (`{ledgerRoot}/{slug}/`).
 *
 * The orchestrator's `ChunkWriter` writes JSONL files to
 * `orchestrator/chunks/` inside the ledger folder.  This constant keeps
 * the path in sync between the MCP server and the orchestrator.
 *
 * Usage: `path.join(ledgerRoot, slug, CHUNKS_DIR)`
 * → `{ledgerRoot}/{slug}/orchestrator/chunks/`
 */
export const CHUNKS_DIR = 'orchestrator/chunks' as const;

/**
 * Workflow specification version this MCP server implements.
 * Derived from the shared workflow manifest's `spec_version` field.
 */
export const SPEC_VERSION = workflowManifest.spec_version;

// ─── Name Mapping — target-specific agent names ─────────────────────────────

/**
 * Target-specific file name and agent name for a single IDE/platform.
 */
export interface TargetNames {
  /** Output filename for this target (e.g. "3-developer.md"). */
  file_name: string;
  /** Canonical agent name used to invoke/route to this agent on that platform. */
  agent_name: string;
}

/**
 * Full name-mapping entry for one agent role.
 * Loaded from `personas/name-mapping.json` — generated by the persona build.
 */
export interface NameMappingEntry {
  /** Display order and numeric prefix (1–9). */
  number: number;
  /** Machine-friendly unique identifier (e.g. "ledger-3-dev"). */
  id: string;
  /** Canonical role name matching the workflow manifest. */
  role: AgentRole;
  /** Persona version string (e.g. "3.6.1"). */
  version: string;
  /** Names for the VS Code target. */
  vscode: TargetNames;
  /** Names for the Claude Code target. */
  claude_code: TargetNames;
  /** Names for the Deep Agents target. */
  deep_agents: TargetNames;
}

/**
 * Per-role agent name mapping loaded from `personas/name-mapping.json` at
 * module-load time.  Provides canonical, target-specific agent names for each
 * role (VS Code, Claude Code, Deep Agents) without requiring runtime string
 * manipulation.
 *
 * Keyed by role name (e.g. `"Developer"`) — matches the values in
 * `AGENT_ROLES` and the workflow manifest.
 */
export const AGENT_NAMES: Record<AgentRole, NameMappingEntry> = Object.fromEntries(
  (_require('../../../personas/name-mapping.json') as NameMappingEntry[])
    .map(entry => [entry.role, entry])
) as Record<AgentRole, NameMappingEntry>;
