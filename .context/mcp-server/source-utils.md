# MCP Server - Source (Utils)
_SOURCE: Utility modules: constants, agent registry, pipeline maps, formatters_
# Utility modules: constants, agent registry, pipeline maps, formatters
```
// Structure of documents
└── mcp-server/
    └── src/
        └── utils/
            └── agent-registry.ts
            └── client-info.ts
            └── constants.ts
            └── if-defined.ts
            └── ledger-root.ts
            └── path-validator.ts
            └── pipeline-maps.ts
            └── project-reset.ts
            └── read-project-name.ts
            └── runner.ts
            └── server-version.ts
            └── timestamp.ts
            └── workflow-helpers.ts
            └── wp-id.ts

```
###  Path: `/mcp-server/src/utils/agent-registry.ts`

```ts
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { AGENT_ROLES } from './constants.js';
import { ifDefined } from './if-defined.js';

/** Module-level cache: role → VS Code agent name */
let agentHandleMap: Record<string, string> = {};
/** Module-level cache: role → VS Code agent id */
let agentIdMap: Record<string, string> = {};
let registryLoaded = false;

/**
 * Parses a simple YAML frontmatter block (the text between the first pair
 * of `---` delimiters at the top of a file) and extracts `name:` and `role:`.
 *
 * Handles both quoted strings (`name: '3 - Developer v3.1.2'`) and bare
 * strings (`role: Developer`).
 *
 * @returns An object with the parsed `name`, `role`, and `id` string values, or
 *   `undefined` for each field if not found.
 */
function parseFrontmatter(content: string): { name?: string; role?: string; id?: string } {
  // Frontmatter block must start at the very beginning of the file
  if (!content.startsWith('---')) {
    return {};
  }

  const afterFirst = content.slice(3);
  const closingIdx = afterFirst.indexOf('\n---');
  if (closingIdx === -1) {
    return {};
  }

  const frontmatter = afterFirst.slice(0, closingIdx);

  let name: string | undefined;
  let role: string | undefined;
  let id: string | undefined;

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();

    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      // Unreachable: regex (.+) always captures when match succeeds; satisfies noUncheckedIndexedAccess
      ifDefined(nameMatch[1], (v) => { name = stripYamlQuotes(v.trim()); });
      continue;
    }

    const roleMatch = line.match(/^role:\s*(.+)$/);
    if (roleMatch) {
      // Unreachable: regex (.+) always captures when match succeeds; satisfies noUncheckedIndexedAccess
      ifDefined(roleMatch[1], (v) => { role = stripYamlQuotes(v.trim()); });
      continue;
    }

    const idMatch = line.match(/^id:\s*(.+)$/);
    if (idMatch) {
      // Unreachable: regex (.+) always captures when match succeeds; satisfies noUncheckedIndexedAccess
      ifDefined(idMatch[1], (v) => { id = stripYamlQuotes(v.trim()); });
      continue;
    }
  }

  return { name, role, id };
}

/**
 * Strips leading/trailing single or double quotes from a YAML scalar value.
 * e.g. `'3 - Developer v3.1.2'` → `3 - Developer v3.1.2`
 */
function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Scans `agentsDir` for `*.agent.md` files, parses YAML frontmatter in each,
 * and builds an in-memory map from workflow `role` names to VS Code agent
 * `name` handles.
 *
 * Behaviour:
 * - Files without a `role:` field are silently skipped.
 * - Files with `role:` but without `name:` produce a `stderr` warning and are
 *   skipped.
 * - `role:` values that do not match a known agent role produce a `stderr`
 *   warning but are still added to the map (forward-compatible).
 * - If `agentsDir` does not exist or is unreadable, a warning is written to
 *   `stderr` and an empty map is returned.
 * - If no `*.agent.md` files are found, an empty map is returned silently.
 * - When two files share the same `role:` value, the **last** one wins.
 *
 * The result is stored in the module-level cache and returned.
 *
 * @param agentsDir - Absolute path to the directory containing `*.agent.md`
 *   files (e.g. the VS Code User prompts folder).
 * @param strict - When `true`, throws a `RangeError` for any `role:` value
 *   that is not present in `AGENT_ROLES`. Intended for CI/validation tooling
 *   and test harnesses that must assert exhaustive role coverage. Defaults to
 *   `false`, in which case unknown roles emit a `stderr` warning but are still
 *   added to the map.
 * @returns A `Record<role, agentName>` mapping.
 */
export async function discoverAgents(agentsDir: string, strict = false): Promise<Record<string, string>> {
  let entries: string[];

  try {
    entries = await readdir(agentsDir);
  } catch {
    process.stderr.write(
      `[agent-registry] Warning: could not read agents directory "${agentsDir}" — auto-handoff disabled.\n`,
    );
    agentHandleMap = {};
    registryLoaded = false;
    return {};
  }

  const agentFiles = entries.filter((e) => e.endsWith('.agent.md'));
  const newMap: Record<string, string> = {};
  const newIdMap: Record<string, string> = {};

  for (const filename of agentFiles) {
    const filePath = join(agentsDir, filename);

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      process.stderr.write(
        `[agent-registry] Warning: could not read file "${filePath}" — skipping.\n`,
      );
      continue;
    }

    const { name, role, id } = parseFrontmatter(content);

    if (!role) {
      // No role: field — silently skip (e.g. standalone agents like Researcher)
      continue;
    }

    if (!name) {
      process.stderr.write(
        `[agent-registry] Warning: "${filename}" has role: "${role}" but no name: field — skipping.\n`,
      );
      continue;
    }

    if (!(AGENT_ROLES as readonly string[]).includes(role)) {
      if (strict) {
        throw new RangeError(`[agent-registry] Unknown role "${role}" in ${filePath}`);
      }
      process.stderr.write(
        `[agent-registry] Warning: "${filename}" has unknown role: "${role}" — adding anyway.\n`,
      );
    }

    if (newMap[role] !== undefined) {
      process.stderr.write(
        `[agent-registry] Role collision: "${role}" defined in both "${newMap[role]}" and "${name}". Last-wins.\n`,
      );
    }
    newMap[role] = name;
    if (id) {
      newIdMap[role] = id;
    }
  }

  agentHandleMap = newMap;
  agentIdMap = newIdMap;
  registryLoaded = Object.keys(newMap).length > 0;
  return { ...newMap };
}

/**
 * Looks up the VS Code agent handle for a given workflow role.
 *
 * @param role - The workflow role name (e.g. `"Developer"`, `"QA"`).
 * @returns The agent's `name` string (e.g. `"3 - Developer v3.1.2"`) or
 *   `null` if the role is not in the registry.
 */
export function getAgentHandle(role: string): string | null {
  return agentHandleMap[role] ?? null;
}

/**
 * Looks up the VS Code agent `id` for a given workflow role.
 *
 * @param role - The workflow role name (e.g. `"Developer"`, `"QA"`).
 * @returns The agent's `id` string (e.g. `"ledger-3-dev"`) or
 *   `null` if the role is not in the registry or has no `id:` field.
 */
export function getAgentId(role: string): string | null {
  return agentIdMap[role] ?? null;
}

/**
 * Returns `true` if the registry has been populated by a successful
 * `discoverAgents()` call that found at least one agent file with a valid
 * `role:` field.
 */
export function isRegistryLoaded(): boolean {
  return registryLoaded;
}

/**
 * Clears the cached agent handle map and resets the loaded flag.
 * Intended for use in unit tests only.
 */
export function resetRegistry(): void {
  agentHandleMap = {};
  agentIdMap = {};
  registryLoaded = false;
}

```
###  Path: `/mcp-server/src/utils/client-info.ts`

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';

/**
 * Module-level MCP server reference.
 * Set once via setMcpServer() after the McpServer is created in index.ts.
 */
let _mcpServer: McpServer | undefined;

/**
 * Stores the MCP server instance so getClientInfo() can access client identity.
 * Must be called once during server startup.
 */
export function setMcpServer(server: McpServer): void {
  _mcpServer = server;
}

/**
 * Returns the MCP client identity reported during the initialization handshake.
 *
 * Since the server uses STDIO transport (single client per process), the returned
 * value is stable for the entire session. Returns undefined before the transport
 * connects or if the client did not identify itself.
 *
 * @returns The client's { name, version } implementation object, or undefined.
 */
export function getClientInfo(): Implementation | undefined {
  return _mcpServer?.server.getClientVersion();
}

```
###  Path: `/mcp-server/src/utils/constants.ts`

```ts
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
 * Workflow specification version this MCP server implements.
 * Derived from the shared workflow manifest's `spec_version` field.
 */
export const SPEC_VERSION = workflowManifest.spec_version;

```
###  Path: `/mcp-server/src/utils/if-defined.ts`

```ts
/**
 * Calls `fn` with `value` only when `value` is not `undefined`.
 *
 * Centralises the `if (x !== undefined) { fn(x); }` guard that arises when
 * `noUncheckedIndexedAccess` is enabled and the caller needs to assign into
 * an outer mutable variable (where a type assertion would suppress the
 * compiler warning without enforcing correctness).
 *
 * @param value - The potentially-undefined value to narrow.
 * @param fn    - Called with the narrowed (non-undefined) value.
 *
 * @example
 * const match = line.match(/^name:\s*(.+)$/);
 * if (match) {
 *   ifDefined(match[1], (v) => { name = stripYamlQuotes(v.trim()); });
 * }
 */
export function ifDefined<T>(value: T | undefined, fn: (v: T) => void): void {
  if (value !== undefined) {
    fn(value);
  }
}

```
###  Path: `/mcp-server/src/utils/ledger-root.ts`

```ts
import { join, dirname, posix } from 'path';
import { fileURLToPath } from 'url';
import { planFolderBasename } from './path-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root: from src/utils/ up two levels → mcp-server/
const serverDir = join(__dirname, '..', '..');

// Workspace root: from mcp-server/ up one level → ai-insights/
const workspaceRoot = join(serverDir, '..');

/** Absolute path to the orchestrator's live logs directory. */
export const ORCHESTRATOR_LOGS_DIR = join(workspaceRoot, 'orchestrator', 'logs');

/**
 * Returns the absolute path to the central ledger root directory.
 *
 * Resolution order:
 * 1. `--ledger-dir <path>` CLI argument — must be followed by an explicit path
 *    value. Providing the flag with no subsequent argument is a configuration
 *    error and will throw rather than silently falling back to the default.
 * 2. Default: `{serverDir}/storage/ledger/`
 *
 * @throws {Error} When `--ledger-dir` is present but not followed by a path.
 */
export function resolveLedgerRoot(): string {
  const args = process.argv;
  const flagIndex = args.indexOf('--ledger-dir');
  if (flagIndex !== -1) {
    // Next token must exist and must not itself be a flag
    if (flagIndex + 1 >= args.length || args[flagIndex + 1]!.startsWith('--')) {
      throw new Error(
        '--ledger-dir flag requires a path argument (e.g. --ledger-dir /data/ledger)'
      );
    }
    return args[flagIndex + 1] as string;
  }
  return join(serverDir, 'storage', 'ledger');
}

/**
 * Extracts the project slug (plan folder basename) from an absolute project path.
 * Delegates to planFolderBasename() from path-validator.
 */
export function projectSlugFromPath(projectPath: string): string {
  return planFolderBasename(projectPath);
}

/**
 * Derives the project root from an absolute plan folder path by walking up
 * exactly four directory levels.
 *
 * The established convention is:
 *   {project-root}/docs/agents/plans/{slug}
 *
 * So calling dirname() four times on a normalized plan path returns the project root.
 *
 * This function is pure — it performs no filesystem access.
 *
 * @param planPath - Absolute path to the plan folder (e.g. "/home/user/project/docs/agents/plans/2026-02-01-feat")
 * @returns The project root path (e.g. "/home/user/project")
 */
export function inferProjectRootFromPlanPath(planPath: string): string {
  // Normalize backslashes to forward slashes for cross-platform correctness
  const normalized = planPath.replace(/\\/g, '/');
  // Walk up 4 levels: slug → plans → agents → docs → project-root
  let current = normalized;
  for (let i = 0; i < 4; i++) {
    current = posix.dirname(current);
  }
  return current;
}

```
###  Path: `/mcp-server/src/utils/path-validator.ts`

```ts
import { basename } from 'path';
import { LedgerStore } from '../storage/ledger-store.js';
import type { ProjectMeta } from '../schema/project-meta.js';
import { formatRelativeTime } from './timestamp.js';

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
 * Resolves the project path from tool arguments that accept either
 * `project_path` (explicit) or `cwd_path` (auto-detect via ledger lookup).
 *
 * Resolution rules:
 * - `project_path` provided → validate format, return it (original behavior).
 * - Only `cwd_path` provided → call `LedgerStore.detectProjectByCwd`, return `meta.plan_path`.
 * - Both provided → `project_path` wins; `cwd_path` is ignored.
 * - Neither provided → throw with a clear error.
 *
 * @throws {Error} on validation failure, AMBIGUOUS match, or NOT_FOUND.
 * Callers should wrap in try/catch and return the error as an MCP error response.
 */
export async function resolveProjectPath(args: {
  project_path?: string;
  cwd_path?: string;
  [key: string]: unknown;
}): Promise<string> {
  // Precedence rule: project_path wins over cwd_path when both are supplied.
  if (args.project_path) {
    // Validate format. planFolderBasename throws on invalid pattern.
    planFolderBasename(args.project_path);
    return args.project_path;
  }

  if (args.cwd_path) {
    const result = await LedgerStore.detectProjectByCwd(args.cwd_path);

    if (result.status === 'FOUND') {
      return result.meta.plan_path;
    }

    if (result.status === 'AMBIGUOUS') {
      const candidates = formatCandidateList(result.best, result.unlikely);
      throw new Error(
        `Multiple projects match the provided cwd_path. Pass explicit project_path to disambiguate.\n\nCandidates:\n${candidates}`
      );
    }

    // NOT_FOUND
    throw new Error(
      `No project found for cwd_path "${args.cwd_path}". ` +
      `Ensure the project has been initialized with ledger_initialize_project ` +
      `and that the provided path is inside the project root.`
    );
  }

  throw new Error('Either project_path or cwd_path is required.');
}

/**
 * Formats an AMBIGUOUS candidate list into a human-readable string with
 * "Best matches" and (optionally) "Unlikely" sections.
 *
 * @param best     - Candidates within the recent activity window
 * @param unlikely - Candidates that were inactive for too long to be relevant
 * @param now      - Reference point for relative time labels; defaults to current wall clock
 */
export function formatCandidateList(
  best: ProjectMeta[],
  unlikely: ProjectMeta[],
  now: Date = new Date()
): string {
  const lines: string[] = [];
  lines.push('Best matches:');
  for (const c of best) {
    const rel = formatRelativeTime(c.last_updated, now);
    lines.push(`  - ${c.plan_path} (${c.slug}) — last active ${rel}`);
  }
  if (unlikely.length > 0) {
    lines.push('');
    lines.push('Unlikely (last active more than 6 hours before the best match):');
    for (const c of unlikely) {
      lines.push(`  - ${c.plan_path} (${c.slug})`);
    }
  }
  return lines.join('\n');
}

```
###  Path: `/mcp-server/src/utils/pipeline-maps.ts`

```ts
/**
 * Shared pipeline routing constants used by pipeline.ts and workflow.ts.
 *
 * Centralising these here eliminates the risk of divergence between the two
 * modules, which is the highest-priority technical debt identified in the
 * Workflow Hardening synthesis report.
 *
 * All primary maps and arrays are derived from the shared workflow manifest so
 * that a change in the manifest propagates automatically — no parallel edits
 * to this file are required.
 */

import { z } from 'zod';
import { workflowManifest } from '../schema/workflow-manifest-schema.js';

// ---------------------------------------------------------------------------
// Role ID → role name lookup (used to resolve fail_routing IDs to names)
// ---------------------------------------------------------------------------
const _roleById: Record<string, string> = Object.fromEntries(
  workflowManifest.roles.map(r => [r.id, r.name])
);

/**
 * Manifest-derived role name for the terminal orchestrating role (Synthesis).
 * Used as the handoff target when the last pipeline stage completes.
 */
const _SYNTHESIS_ROLE = workflowManifest.roles.find(r => r.id === 'synthesis')!.name;

/**
 * Manifest-derived role name for the implementation owner (Developer).
 * Used as the ultimate safety fallback when fail-routing cannot resolve.
 */
const _DEVELOPER_ROLE = workflowManifest.roles.find(r => r.id === 'developer')!.name;

/**
 * The six valid pipeline type values as a const tuple, in canonical execution order.
 * Used as the source of truth for the PipelineType union, the Zod enum, and
 * all Record keys that depend on exhaustiveness checking.
 *
 * Derived from `pipelines.canonical_order` in the shared workflow manifest.
 */
export const PIPELINE_TYPES = workflowManifest.pipelines.canonical_order as
  ['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'];

/**
 * Zod enum schema for pipeline types. Using this in tool schemas (instead of
 * z.string()) means invalid type values are rejected at the MCP validation
 * layer with a clear error, and `args.type` is automatically narrowed to
 * PipelineType — eliminating the need for `as PipelineType` casts.
 */
export const PipelineTypeEnum = z.enum(PIPELINE_TYPES);

/**
 * Union of all valid pipeline type keys (6 stages).
 */
export type PipelineType = z.infer<typeof PipelineTypeEnum>;

/**
 * The canonical execution order for all six pipeline stages.
 * Dynamic resolve functions filter this ordering by a WP's active_pipeline_stages
 * to compute per-WP routing.
 */
export const CANONICAL_PIPELINE_ORDERING = PIPELINE_TYPES;

/**
 * Backward-compatible default stage set (4-stage legacy workflow).
 * Used as the default activeStages when no per-WP override is specified.
 *
 * Derived from `pipelines.default_stages` in the shared workflow manifest.
 */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineType[] =
  workflowManifest.pipelines.default_stages as readonly PipelineType[];

/**
 * Post-implementation stages in the 4-stage legacy workflow.
 * Pinned explicitly so that adding optional stages to PIPELINE_TYPES does NOT
 * cascade into legacy display maps (agentNameMap, actionNameMap, reworkActionMap)
 * that remain 3-entry records.
 */
export type PostImplPipelineType = 'qa' | 'code-review' | 'documentation';

/**
 * Legacy static prerequisite map for the default-stage workflow.
 * Only includes entries for the default stages — new-style WPs should use
 * resolvePrerequisite(). null means no prerequisite (can always start).
 *
 * Derived from `pipelines.default_stages` in the shared workflow manifest:
 * each stage's prerequisite is its immediately preceding stage in the default
 * order (or null for the first stage). This intentionally diverges from the
 * full 6-stage `pipelines.prerequisites` map, which reflects the complete
 * canonical chain including optional stages.
 */
export const PIPELINE_PREREQUISITES: Partial<Record<PipelineType, PipelineType | null>> =
  Object.fromEntries(
    (workflowManifest.pipelines.default_stages as readonly PipelineType[]).map((stage, i, arr) => [
      stage,
      i === 0 ? null : (arr[i - 1] ?? null),
    ])
  );

/**
 * Map of pipeline type to the agent role that owns it.
 * Used to automatically update assigned_to when a pipeline starts.
 *
 * Derived from `roles[].pipeline` (non-null) → `roles[].name` in the shared
 * workflow manifest.
 */
export const PIPELINE_AGENT_MAP: Record<PipelineType, string> = Object.fromEntries(
  workflowManifest.roles
    .filter(r => r.pipeline !== null)
    .map(r => [r.pipeline, r.name])
) as Record<PipelineType, string>;

/**
 * Legacy static next-agent map for the 4-stage default workflow.
 * Partial so that new PipelineType values do not require entries here.
 * New-style WPs should use resolveNextAgent().
 *
 * Derived at runtime from PIPELINE_TYPES and PIPELINE_AGENT_MAP, using the
 * default stage set. Entries not in the default stages are excluded.
 */
export const NEXT_AGENT_MAP: Partial<Record<PipelineType, string>> = (() => {
  const defaultStages = workflowManifest.pipelines.default_stages as readonly PipelineType[];
  const result: Partial<Record<PipelineType, string>> = {};
  for (let i = 0; i < defaultStages.length - 1; i++) {
    const current = defaultStages[i]!;
    const next = defaultStages[i + 1]!;
    result[current] = PIPELINE_AGENT_MAP[next];
  }
  // Last stage in default order always hands off to Synthesis
  const lastStage = defaultStages[defaultStages.length - 1];
  if (lastStage) result[lastStage] = _SYNTHESIS_ROLE;
  return result;
})();

/**
 * Legacy static fail-routing map for the default-stage workflow.
 * Partial so that new PipelineType values do not require entries here.
 * New-style WPs should use resolveFailAgent().
 *
 * Derived from `pipelines.fail_routing` in the shared workflow manifest.
 * The manifest stores role IDs; they are translated to role names via the
 * roles array lookup built at module load time.
 *
 * Cross-ref: `developerReworkTypes` in workflow-helpers.ts is derived from
 * this map at runtime so the two cannot silently diverge.
 */
export const FAIL_ROUTING_MAP: Partial<Record<PipelineType, string>> = Object.fromEntries(
  (workflowManifest.pipelines.default_stages as readonly string[]).map(stage => [
    stage,
    _roleById[(workflowManifest.pipelines.fail_routing as Record<string, string>)[stage] ?? ''] ?? _DEVELOPER_ROLE,
  ])
);

/**
 * Inverse of PIPELINE_AGENT_MAP: maps an agent role to the pipeline type it owns.
 * Derived at runtime from PIPELINE_AGENT_MAP so the two can never silently diverge.
 * Constructed via PIPELINE_TYPES iteration with an explicit tuple return type so
 * TypeScript infers PipelineType as the value type without needing downstream casts.
 */
export const AGENT_PIPELINE_MAP: Record<string, PipelineType> = Object.fromEntries(
  PIPELINE_TYPES.map((type): [string, PipelineType] => [PIPELINE_AGENT_MAP[type], type])
);

/**
 * Full fail-routing map covering all 6 pipeline types.
 * Derived from `pipelines.fail_routing` in the shared workflow manifest.
 * Hoisted to module-level to avoid per-call reconstruction in resolveFailAgent().
 */
export const FAIL_AGENT_MAP: Record<PipelineType, string> = Object.fromEntries(
  Object.entries(workflowManifest.pipelines.fail_routing).map(
    ([pipeline, roleId]) => [pipeline, _roleById[roleId as string] ?? _DEVELOPER_ROLE]
  )
) as Record<PipelineType, string>;

/**
 * Returns all pipeline types that follow the given type in the active stage ordering.
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
 * Per §8.4 (updated): getDownstreamTypes("implementation") → ["qa", "code-review", "documentation"]
 */
export function getDownstreamTypes(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType[] {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === active.length - 1) return [];
  return [...active.slice(index + 1)];
}

/**
 * Returns all pipeline types that precede the given type in the active stage ordering.
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
 * Per §8.5 (updated): getUpstreamTypes("documentation") → ["implementation", "qa", "code-review"]
 */
export function getUpstreamTypes(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType[] {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === 0) return [];
  return [...active.slice(0, index)];
}

// ---------------------------------------------------------------------------
// Dynamic resolve functions (6-stage aware)
// ---------------------------------------------------------------------------

/**
 * Computes the prerequisite pipeline type for `pipelineType` given the WP's
 * active_pipeline_stages. The canonical ordering filters the active set, and the
 * immediately preceding active stage is the prerequisite.
 * Returns null when `pipelineType` is the first active stage or is not active.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolvePrerequisite(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): PipelineType | null {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index <= 0) return null; // first stage or not in active set
  return active[index - 1] ?? null;
}

/**
 * Returns the agent that should receive the WP after `pipelineType` completes
 * with PASS, given the WP's active_pipeline_stages.
 * Finds the next active stage in canonical order and returns its owning agent.
 * Returns 'Synthesis' when `pipelineType` is the last active stage.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolveNextAgent(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): string {
  const active = CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
  const index = active.indexOf(pipelineType);
  if (index === -1 || index === active.length - 1) return _SYNTHESIS_ROLE;
  const nextType = active[index + 1];
  if (!nextType) return _SYNTHESIS_ROLE; // guard against unexpected undefined
  return PIPELINE_AGENT_MAP[nextType];
}

/**
 * Returns the agent that should receive the WP after `pipelineType` completes
 * with FAIL (rework routing), given the WP's active_pipeline_stages.
 *
 * Base routing is fully manifest-derived: each pipeline type maps to the role
 * name resolved from `pipelines.fail_routing` in the shared workflow manifest.
 *
 * Fallback: when the standard fail-target agent's stage is not present in
 * activeStages, routes to the agent that owns the first active stage.
 *
 * When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
 */
export function resolveFailAgent(
  pipelineType: PipelineType,
  activeStages: readonly PipelineType[] = DEFAULT_PIPELINE_STAGES,
): string {
  const baseAgent = FAIL_AGENT_MAP[pipelineType];

  // Determine the stage the base agent owns (via reverse lookup).
  const baseStage = AGENT_PIPELINE_MAP[baseAgent] as PipelineType | undefined;

  // If the base agent's own stage is active (or there is no stage to check), use base routing.
  if (!baseStage || activeStages.includes(baseStage)) {
    return baseAgent;
  }

  // Fallback: route to the owner of the first active stage.
  const firstActive = CANONICAL_PIPELINE_ORDERING.find((t) => activeStages.includes(t));
  if (!firstActive) return _DEVELOPER_ROLE; // ultimate safety fallback
  return PIPELINE_AGENT_MAP[firstActive];
}

/**
 * Returns the active stages filtered and sorted by the canonical pipeline ordering.
 * Replaces the repeated `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t))` pattern.
 */
export function getOrderedActiveStages(
  activeStages: readonly PipelineType[]
): PipelineType[] {
  return CANONICAL_PIPELINE_ORDERING.filter((t) => activeStages.includes(t));
}

/**
 * Returns a `.describe()` annotation string for a Zod pipeline type enum,
 * listing all PIPELINE_TYPES in canonical order with the given prefix.
 *
 * Example: describePipelineTypes('Pipeline type:') →
 *   'Pipeline type: "implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"'
 */
export function describePipelineTypes(prefix: string): string {
  return `${prefix} ${PIPELINE_TYPES.map((t) => `"${t}"`).join(', ')}`;
}

/**
 * Returns a `.describe()` annotation string for a Zod agent_role field,
 * listing every pipeline type owner derived from PIPELINE_AGENT_MAP in
 * canonical PIPELINE_TYPES order, plus the PM override note.
 *
 * Example: describePipelineAgents('Your agent role. Must match the pipeline type owner:') →
 *   'Your agent role. Must match the pipeline type owner: "Developer" for implementation, ...
 *    "Documentation" for documentation. "Project Manager" is always allowed (PM Override).'
 */
export function describePipelineAgents(prefix: string): string {
  const mappings = PIPELINE_TYPES.map((t) => `"${PIPELINE_AGENT_MAP[t]}" for ${t}`).join(', ');
  return `${prefix} ${mappings}. "Project Manager" is always allowed (PM Override).`;
}

/**
 * Pipeline types where agents are expected to declare `artifacts.files_modified`.
 * Verification-only stages (`qa`, `security-audit`) are excluded because those
 * agents verify but do not modify files. `code-review` is included because the
 * Reviewer may apply Fix-Forward edits (Tier 2 feedback).
 * Used by `completePipeline` to scope the §12.1 soft warning.
 */
export const ARTIFACT_EXPECTED_PIPELINE_TYPES: ReadonlySet<PipelineType> = new Set<PipelineType>([
  'implementation',
  'code-review',
  'release-engineering',
  'documentation',
]);

/**
 * Returns the first active pipeline stage in canonical order.
 * Falls back to DEFAULT_PIPELINE_STAGES when stages is absent or null.
 * Per §6.2.1: named helper to eliminate inline orderedActive[0] patterns.
 */
export function firstActiveStage(stages?: readonly PipelineType[] | null): PipelineType {
  const resolved = stages ?? DEFAULT_PIPELINE_STAGES;
  const orderedActive = getOrderedActiveStages(resolved);
  return orderedActive[0] ?? DEFAULT_PIPELINE_STAGES[0]!;
}

/**
 * Returns the last active pipeline stage in canonical order.
 * Falls back to DEFAULT_PIPELINE_STAGES when stages is absent or null.
 * Per §6.2.1: named helper to eliminate inline orderedActive[length-1] patterns.
 */
export function lastActiveStage(stages?: readonly PipelineType[] | null): PipelineType {
  const resolved = stages ?? DEFAULT_PIPELINE_STAGES;
  const orderedActive = getOrderedActiveStages(resolved);
  return orderedActive[orderedActive.length - 1] ?? DEFAULT_PIPELINE_STAGES[DEFAULT_PIPELINE_STAGES.length - 1]!;
}

/**
 * Validates a proposed active_pipeline_stages array against all hard and soft rules.
 * Returns { errors, warnings } instead of throwing — the caller is responsible
 * for acting on errors (typically by throwing errors[0]).
 *
 * Hard errors: empty array, unknown stage names, duplicates, out-of-canonical-order.
 * Soft warnings: implementation without qa, single-stage chain.
 */
export function validateActiveStages(stages: string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (stages.length === 0) {
    errors.push(
      `active_pipeline_stages cannot be empty. At least one stage is required. ` +
      `Omit the parameter to use the default stages: ${DEFAULT_PIPELINE_STAGES.join(' \u2192 ')}.`
    );
    return { errors, warnings };
  }

  const validTypes = new Set<string>(PIPELINE_TYPES);
  const invalidTypes = stages.filter((s) => !validTypes.has(s));
  if (invalidTypes.length > 0) {
    errors.push(
      `Invalid pipeline stage(s): ${invalidTypes.join(', ')}. ` +
      `Valid types are: ${PIPELINE_TYPES.join(', ')}.`
    );
    return { errors, warnings };
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const s of stages) {
    if (seen.has(s)) duplicates.push(s);
    else seen.add(s);
  }
  if (duplicates.length > 0) {
    errors.push(`Duplicate pipeline stage(s): ${duplicates.join(', ')}. Each stage may appear at most once.`);
    return { errors, warnings };
  }

  const asTyped = stages as PipelineType[];
  let canonicalIdx = 0;
  for (const stage of asTyped) {
    while (
      canonicalIdx < CANONICAL_PIPELINE_ORDERING.length &&
      CANONICAL_PIPELINE_ORDERING[canonicalIdx] !== stage
    ) {
      canonicalIdx++;
    }
    if (canonicalIdx >= CANONICAL_PIPELINE_ORDERING.length) {
      errors.push(
        `Pipeline stages are out of canonical order. Stages must be a subsequence of: ` +
        `${CANONICAL_PIPELINE_ORDERING.join(' \u2192 ')}. Provided: ${asTyped.join(' \u2192 ')}.`
      );
      return { errors, warnings };
    }
    canonicalIdx++;
  }

  if (asTyped.includes('implementation') && !asTyped.includes('qa')) {
    warnings.push('Warning: pipeline contains implementation without qa. Shipping code without QA is risky but permitted.');
  }
  if (asTyped.length === 1) {
    warnings.push(`Warning: single-stage pipeline chain (${asTyped[0]}). This is usually intentional but worth confirming.`);
  }

  // Soft guardrail 7 (§9b.2): non-default, non-full custom composition
  const isDefault = asTyped.length === DEFAULT_PIPELINE_STAGES.length &&
    asTyped.every((s, i) => s === DEFAULT_PIPELINE_STAGES[i]);
  const isFull = asTyped.length === CANONICAL_PIPELINE_ORDERING.length &&
    asTyped.every((s, i) => s === CANONICAL_PIPELINE_ORDERING[i]);
  if (!isDefault && !isFull) {
    warnings.push(`Warning: WP uses a custom pipeline composition: [${asTyped.join(', ')}] — ensure this matches the work package's intent.`);
  }

  return { errors, warnings };
}

```
###  Path: `/mcp-server/src/utils/project-reset.ts`

```ts
/**
 * Project Reset — Analysis & Mutation Logic
 *
 * Provides a semi-intelligent project reset feature that:
 * 1. Analyzes each work package to detect missing pipeline stages
 * 2. Produces a diagnosis with suggested per-WP actions
 * 3. Applies user-confirmed reset decisions atomically
 *
 * The analysis function is pure (no I/O) for easy testing.
 * The apply function routes all WP writes through batchUpdateWorkPackagesWithSync.
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import type { RootIndex } from '../schema/root-index.js';
import { clearSynthesisState } from './workflow-helpers.js';
import type { WorkPackageDetail } from '../schema/work-package.js';
import { PIPELINE_AGENT_MAP, DEFAULT_PIPELINE_STAGES } from './pipeline-maps.js';
import type { PipelineType } from './pipeline-maps.js';
import { now } from './timestamp.js';
import { isTerminalStatus } from '../schema/validators.js';
import { LedgerStore } from '../storage/ledger-store.js';

// ---------------------------------------------------------------------------
// Diagnosis types
// ---------------------------------------------------------------------------

export interface WpResetDiagnosis {
  work_package_id: string;
  current_status: string;
  current_assigned_to: string | null;
  pipeline_stages_present: string[];
  pipeline_stages_missing: string[];
  active_pipeline_stages: string[];
  next_required_stage: string | null;
  target_assigned_to: string | null;
  needs_reset: boolean;
  reason: string;
  suggested_action: 'reset' | 'skip';
  suggested_reset_criteria: boolean;
  /** Number of IN_PROGRESS pipelines on this WP that will be auto-cancelled by reset. */
  orphaned_pipeline_count: number;
}

export interface ProjectResetDiagnosis {
  project_slug: string;
  current_project_status: string;
  work_packages: WpResetDiagnosis[];
  work_packages_needing_reset: number;
  work_packages_healthy: number;
  work_packages_skipped: number;
  /** Total IN_PROGRESS pipelines across all WPs that will be auto-cancelled by reset. */
  total_orphaned_pipelines: number;
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

export interface WpDecision {
  action: 'reset' | 'skip' | 'cancel';
  reset_criteria?: boolean;
}

export interface ProjectResetResult {
  diagnosis: ProjectResetDiagnosis;
  applied: true;
  work_packages_reset: string[];
  work_packages_cancelled: string[];
  work_packages_skipped: string[];
  project_comment_added: string;
}

// ---------------------------------------------------------------------------
// Analysis (pure function — no I/O)
// ---------------------------------------------------------------------------

/**
 * Determines which pipeline stages have a PASS for a given work package.
 * Only considers the most recent non-auto-cancelled pipeline of each type.
 */
export function getPassedStages(wp: WorkPackageDetail): Set<string> {
  const passed = new Set<string>();

  // Walk pipelines in reverse to find the most recent of each type
  const seen = new Set<string>();
  for (let i = wp.pipelines.length - 1; i >= 0; i--) {
    const p = wp.pipelines[i]!;
    if (seen.has(p.type)) continue;
    if (p.auto_cancelled) continue;
    seen.add(p.type);
    if (p.status === 'PASS') {
      passed.add(p.type);
    }
  }

  return passed;
}

/**
 * Analyzes a project for reset, producing a per-WP diagnosis.
 *
 * This is a **pure function** — it takes data in and returns a diagnosis
 * without performing any I/O or side effects.
 */
export function analyzeProjectForReset(
  slug: string,
  rootIndex: RootIndex,
  workPackages: WorkPackageDetail[]
): ProjectResetDiagnosis {
  const diagnoses: WpResetDiagnosis[] = [];
  let needingReset = 0;
  let healthy = 0;
  let skippedCancelled = 0;

  let totalOrphanedPipelines = 0;

  for (const wp of workPackages) {
    // Count IN_PROGRESS (orphaned) pipelines on this WP
    const orphanedPipelineCount = wp.pipelines.filter((p) => p.status === 'IN_PROGRESS').length;
    totalOrphanedPipelines += orphanedPipelineCount;

    // 1. CANCELLED WPs — skip entirely
    if (wp.status === 'CANCELLED') {
      skippedCancelled++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: [],
        pipeline_stages_missing: [],
        active_pipeline_stages: [],
        next_required_stage: null,
        target_assigned_to: null,
        needs_reset: false,
        reason: 'CANCELLED — skipped',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
        orphaned_pipeline_count: orphanedPipelineCount,
      });
      continue;
    }

    // 2. Identify passed stages
    const passedStages = getPassedStages(wp);
    const stagesPresent: string[] = [];
    const stagesMissing: string[] = [];

    // Resolve the active stage set for this WP.
    // WPs without active_pipeline_stages default to DEFAULT_PIPELINE_STAGES (4-stage legacy).
    const activeStages: readonly PipelineType[] =
      Array.isArray(wp.active_pipeline_stages) && wp.active_pipeline_stages.length > 0
        ? (wp.active_pipeline_stages as PipelineType[])
        : DEFAULT_PIPELINE_STAGES;

    for (const stage of activeStages) {
      if (passedStages.has(stage)) {
        stagesPresent.push(stage);
      } else {
        stagesMissing.push(stage);
      }
    }

    // 3. Determine the next required stage
    let nextRequiredStage: PipelineType | null = null;
    for (const stage of activeStages) {
      if (!passedStages.has(stage)) {
        nextRequiredStage = stage;
        break;
      }
    }

    const targetAssignedTo = nextRequiredStage
      ? PIPELINE_AGENT_MAP[nextRequiredStage]
      : null;

    // 4. Determine if WP needs reset
    const allStagesPass = stagesMissing.length === 0;

    if (allStagesPass && wp.status === 'COMPLETE') {
      // 5. Healthy — all 4 stages PASS and COMPLETE
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: null,
        target_assigned_to: null,
        needs_reset: false,
        reason: `All ${activeStages.length} pipeline stages passed — healthy`,
        suggested_action: 'skip',
        suggested_reset_criteria: false,
        orphaned_pipeline_count: orphanedPipelineCount,
      });
      continue;
    }

    // Determine if this WP needs a reset based on its condition
    if (wp.status === 'COMPLETE' && !allStagesPass) {
      // Prematurely completed — missing pipeline stages
      needingReset++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: true,
        reason: `COMPLETE but missing pipeline stages: ${stagesMissing.join(', ')}`,
        suggested_action: 'reset',
        suggested_reset_criteria: true,
        orphaned_pipeline_count: orphanedPipelineCount,
      });
      continue;
    }

    if (wp.status === 'IN_PROGRESS') {
      // Check if assigned_to is correct for the next required stage
      const correctAssignment = targetAssignedTo === wp.assigned_to;
      if (correctAssignment && !allStagesPass) {
        // Already in the right state
        healthy++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: nextRequiredStage,
          target_assigned_to: targetAssignedTo,
          needs_reset: false,
          reason: 'IN_PROGRESS with correct assignment — healthy',
          suggested_action: 'skip',
          suggested_reset_criteria: false,
          orphaned_pipeline_count: orphanedPipelineCount,
        });
      } else if (!correctAssignment) {
        // Wrong assignment or missing stages
        needingReset++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: nextRequiredStage,
          target_assigned_to: targetAssignedTo,
          needs_reset: true,
          reason: `IN_PROGRESS but assigned to ${wp.assigned_to ?? 'null'} instead of ${targetAssignedTo}`,
          suggested_action: 'reset',
          suggested_reset_criteria: true,
          orphaned_pipeline_count: orphanedPipelineCount,
        });
      } else {
        // All stages pass but status is IN_PROGRESS — unusual but healthy
        healthy++;
        diagnoses.push({
          work_package_id: wp.work_package_id,
          current_status: wp.status,
          current_assigned_to: wp.assigned_to,
          pipeline_stages_present: stagesPresent,
          pipeline_stages_missing: stagesMissing,
          active_pipeline_stages: [...activeStages],
          next_required_stage: null,
          target_assigned_to: null,
          needs_reset: false,
          reason: 'All stages passed, IN_PROGRESS — may need manual completion',
          suggested_action: 'skip',
          suggested_reset_criteria: false,
          orphaned_pipeline_count: orphanedPipelineCount,
        });
      }
      continue;
    }

    if (wp.status === 'BLOCKED') {
      // BLOCKED WPs — suggest skip, user can override
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: false,
        reason: 'BLOCKED — user should evaluate manually',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
        orphaned_pipeline_count: orphanedPipelineCount,
      });
      continue;
    }

    if (wp.status === 'READY') {
      // READY WPs — haven't started, nothing to fix
      healthy++;
      diagnoses.push({
        work_package_id: wp.work_package_id,
        current_status: wp.status,
        current_assigned_to: wp.assigned_to,
        pipeline_stages_present: stagesPresent,
        pipeline_stages_missing: stagesMissing,
        active_pipeline_stages: [...activeStages],
        next_required_stage: nextRequiredStage,
        target_assigned_to: targetAssignedTo,
        needs_reset: false,
        reason: 'READY — not started yet',
        suggested_action: 'skip',
        suggested_reset_criteria: false,
        orphaned_pipeline_count: orphanedPipelineCount,
      });
      continue;
    }

    // Fallback: unknown status — suggest skip
    healthy++;
    diagnoses.push({
      work_package_id: wp.work_package_id,
      current_status: wp.status,
      current_assigned_to: wp.assigned_to,
      pipeline_stages_present: stagesPresent,
      pipeline_stages_missing: stagesMissing,
      active_pipeline_stages: [...activeStages],
      next_required_stage: nextRequiredStage,
      target_assigned_to: targetAssignedTo,
      needs_reset: false,
      reason: `Unknown status '${wp.status}' — skipping`,
      suggested_action: 'skip',
      suggested_reset_criteria: false,
      orphaned_pipeline_count: orphanedPipelineCount,
    });
  }

  return {
    project_slug: slug,
    current_project_status: rootIndex.status,
    work_packages: diagnoses,
    work_packages_needing_reset: needingReset,
    work_packages_healthy: healthy,
    work_packages_skipped: skippedCancelled,
    total_orphaned_pipelines: totalOrphanedPipelines,
  };
}

// ---------------------------------------------------------------------------
// Apply (mutation function — performs I/O under lock)
// ---------------------------------------------------------------------------

/**
 * Applies user-confirmed reset decisions to a project.
 *
 * All writes are routed through `batchUpdateWorkPackagesWithSync`, which
 * acquires a single lock, auto-stamps `last_updated`, and validates every
 * WP via Zod before writing. WPs are re-read inside the lock to guard
 * against stale diagnoses.
 */
export async function applyProjectReset(
  store: LedgerStore,
  diagnosis: ProjectResetDiagnosis,
  decisions: Record<string, WpDecision>
): Promise<ProjectResetResult> {
  const resetIds: string[] = [];
  const cancelledIds: string[] = [];
  const skippedIds: string[] = [];

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const timestamp = now();
    const updatedWps = new Map<string, WorkPackageDetail>();

    for (const wpDiag of diagnosis.work_packages) {
      const wpId = wpDiag.work_package_id;
      const decision = decisions[wpId] ?? { action: 'skip' };

      if (decision.action === 'skip') {
        skippedIds.push(wpId);
        continue;
      }

      // Re-read WP under lock to ensure freshness
      const wp = await readWp(wpId);

      // Guard: if WP status changed since diagnosis, skip with warning
      if (wp.status !== wpDiag.current_status) {
        process.stderr.write(
          `[project-reset] WP ${wpId} status changed from '${wpDiag.current_status}' to '${wp.status}' since diagnosis — skipping.\n`
        );
        skippedIds.push(wpId);
        continue;
      }

      if (decision.action === 'reset') {
        // Auto-cancel any orphaned IN_PROGRESS pipelines (§12.5, §21.68)
        for (const pipeline of wp.pipelines) {
          if (pipeline.status === 'IN_PROGRESS') {
            pipeline.status = 'FAIL';
            pipeline.auto_cancelled = true;
            pipeline.completed_at = timestamp;
            pipeline.summary = ['Auto-cancelled by project reset'];
          }
        }

        wp.status = 'IN_PROGRESS';
        wp.assigned_to = wpDiag.target_assigned_to ?? wp.assigned_to;
        wp.status_changed_at = timestamp;
        wp.reset_at = timestamp;

        // Optionally reset acceptance criteria
        const resetCriteria = decision.reset_criteria !== false; // default true
        if (resetCriteria && wp.acceptance_criteria) {
          for (const criterion of wp.acceptance_criteria) {
            criterion.met = false;
          }
        }

        // Clear any blocker
        if (wp.blocked_by) {
          delete (wp as Record<string, unknown>).blocked_by;
        }

        updatedWps.set(wpId, wp);
        resetIds.push(wpId);

        // Update WP summary in root index
        const wpSummary = rootIndex.work_packages.find(
          (s) => s.work_package_id === wpId
        );
        if (wpSummary) {
          wpSummary.status = 'IN_PROGRESS';
          wpSummary.assigned_to = wp.assigned_to;
        }
      } else if (decision.action === 'cancel') {
        wp.status = 'CANCELLED';
        wp.status_changed_at = timestamp;

        updatedWps.set(wpId, wp);
        cancelledIds.push(wpId);

        // Update WP summary in root index
        const wpSummary = rootIndex.work_packages.find(
          (s) => s.work_package_id === wpId
        );
        if (wpSummary) {
          wpSummary.status = 'CANCELLED';
          wpSummary.assigned_to = null;
        }
      }
    }

    // Recompute project-level fields
    rootIndex.pending_work_packages = rootIndex.work_packages.filter(
      (wp) => !isTerminalStatus(wp.status)
    ).length;

    rootIndex.status = 'IN_PROGRESS';
    clearSynthesisState(rootIndex);
    rootIndex.auto_handoff_depth = 0;
    rootIndex.last_updated = timestamp;

    // Append audit comment
    const commentParts: string[] = [];
    if (resetIds.length > 0) {
      commentParts.push(`Reset: ${resetIds.join(', ')}`);
    }
    if (cancelledIds.length > 0) {
      commentParts.push(`Cancelled: ${cancelledIds.join(', ')}`);
    }
    if (skippedIds.length > 0) {
      commentParts.push(`Skipped: ${skippedIds.join(', ')}`);
    }

    const commentNote = `Project reset applied. ${commentParts.join('. ')}.`;

    rootIndex.project_comments.push({
      type: 'admin_action',
      priority: 'high',
      timestamp,
      agent: 'GUI',
      note: commentNote,
    });

    return { updatedWps, root: rootIndex };
  });

  return {
    diagnosis,
    applied: true,
    work_packages_reset: resetIds,
    work_packages_cancelled: cancelledIds,
    work_packages_skipped: skippedIds,
    project_comment_added: `Project reset applied. ${resetIds.length} reset, ${cancelledIds.length} cancelled, ${skippedIds.length} skipped.`,
  };
}

// ---------------------------------------------------------------------------
// Mark as Complete (mutation function — performs I/O under lock)
// ---------------------------------------------------------------------------

export interface MarkProjectCompleteResult {
  marked_complete: true;
  work_packages_completed: string[];
  project_comment_added: string;
}

/**
 * Forces every non-CANCELLED work package and the project itself to COMPLETE
 * status in a single lock scope.
 *
 * Use this as a bulk "finish" action when a project is done but its WP
 * pipeline state is inconsistent or incomplete.
 *
 * STDIO discipline: this function never writes to process.stdout.
 */
export async function markProjectComplete(
  store: LedgerStore,
  slug: string
): Promise<MarkProjectCompleteResult> {
  void slug; // slug is held on the store; kept for call-site clarity
  const completedIds: string[] = [];

  await store.batchUpdateWorkPackagesWithSync(async (rootIndex, readWp) => {
    const timestamp = now();
    const updatedWps = new Map<string, WorkPackageDetail>();

    for (const wpSummary of rootIndex.work_packages) {
      if (wpSummary.status === 'CANCELLED') continue;

      const wp = await readWp(wpSummary.work_package_id);
      wp.status = 'COMPLETE';
      wp.status_changed_at = timestamp;

      updatedWps.set(wpSummary.work_package_id, wp);
      completedIds.push(wpSummary.work_package_id);

      wpSummary.status = 'COMPLETE';
    }

    rootIndex.status = 'COMPLETE';
    rootIndex.pending_work_packages = 0;
    rootIndex.last_updated = timestamp;

    const note = `Marked project as complete via GUI. ${completedIds.length} work package(s) set to COMPLETE: ${completedIds.join(', ')}.`;

    rootIndex.project_comments.push({
      type: 'admin_action',
      priority: 'low',
      timestamp,
      agent: 'GUI',
      note,
    });

    return { updatedWps, root: rootIndex };
  });

  const note = `Marked project as complete via GUI. ${completedIds.length} work package(s) set to COMPLETE: ${completedIds.join(', ')}.`;

  return {
    marked_complete: true,
    work_packages_completed: completedIds,
    project_comment_added: note,
  };
}

```
###  Path: `/mcp-server/src/utils/read-project-name.ts`

```ts
/**
 * Resolves the human-readable project name from the managed workspace's
 * manifest file. Tries package.json → composer.json → pyproject.toml in
 * order. Returns null if no file is found or any parse/read fails.
 *
 * @param projectRoot - Absolute path to the project root directory
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readProjectName(projectRoot: string): Promise<string | null> {
  // 1. Try package.json
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const nameVal = (parsed as Record<string, unknown>).name;
      if (typeof nameVal === 'string' && nameVal.trim() !== '') {
        return nameVal;
      }
    }
  } catch {
    // fall through
  }

  // 2. Try composer.json
  try {
    const raw = await readFile(join(projectRoot, 'composer.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const nameVal = (parsed as Record<string, unknown>).name;
      if (typeof nameVal === 'string' && nameVal.trim() !== '') {
        return nameVal;
      }
    }
  } catch {
    // fall through
  }

  // 3. Try pyproject.toml (best-effort regex)
  try {
    const raw = await readFile(join(projectRoot, 'pyproject.toml'), 'utf-8');
    const match = raw.match(/name\s*=\s*"([^"]+)"/);
    if (match) {
      const captured = match[1];
      if (captured !== undefined && captured.trim() !== '') {
        return captured;
      }
    }
  } catch {
    // fall through
  }

  return null;
}

```
###  Path: `/mcp-server/src/utils/runner.ts`

```ts
/**
 * Runner classification utility.
 *
 * Normalises the raw MCP `clientInfo.name` string supplied during the
 * initialization handshake into a stable {@link RunnerType} enum value so
 * that the rest of the server can filter and display projects by runner
 * without depending on the exact client-reported string (which varies across
 * versions and platforms).
 *
 * @module runner
 */

export type RunnerType = 'vscode' | 'claude-code' | 'orchestrator' | 'unknown';

export interface RunnerInfo {
  runner: RunnerType;
  runner_client: string;
  runner_version: string;
}

export interface ClientInfo {
  name: string;
  version: string;
}

/**
 * Classify an MCP client into a stable {@link RunnerType} enum value.
 *
 * Matching is **case-insensitive substring-based** and uses a fixed priority
 * order to handle ambiguous names:
 *
 * 1. **`vscode`** — name contains `"visual studio code"` or `"vscode"`
 * 2. **`claude-code`** — name contains `"claude"`
 * 3. **`orchestrator`** — name contains `"langchain"` or `"mcp-adapters"`, or is exactly `"mcp"`
 * 4. **`unknown`** — anything else, or when `clientInfo` is `undefined`
 *
 * The first matching rule wins. Raw `name` and `version` strings are preserved
 * in the returned object for diagnostics (e.g. "which exact VS Code build?").
 *
 * @param clientInfo - The `{ name, version }` object from the MCP
 *   `initialize` handshake, or `undefined` if the client did not identify
 *   itself.
 * @returns A {@link RunnerInfo} object with a normalised `runner` enum value
 *   plus the original `runner_client` and `runner_version` strings. When
 *   `clientInfo` is `undefined`, both string fields are empty (`""`).
 *
 * @example
 * classifyRunner({ name: 'Visual Studio Code', version: '1.99' })
 * // → { runner: 'vscode', runner_client: 'Visual Studio Code', runner_version: '1.99' }
 *
 * @example
 * classifyRunner({ name: 'langchain-mcp-adapters', version: '1.0' })
 * // → { runner: 'orchestrator', runner_client: 'langchain-mcp-adapters', runner_version: '1.0' }
 *
 * @example
 * classifyRunner(undefined)
 * // → { runner: 'unknown', runner_client: '', runner_version: '' }
 */
export function classifyRunner(clientInfo: ClientInfo | undefined): RunnerInfo {
  if (clientInfo === undefined) {
    return { runner: 'unknown', runner_client: '', runner_version: '' };
  }

  const name = clientInfo.name;
  const lower = name.toLowerCase();

  let runner: RunnerType;

  if (lower.includes('visual studio code') || lower.includes('vscode')) {
    runner = 'vscode';
  } else if (lower.includes('claude')) {
    runner = 'claude-code';
  } else if (lower.includes('langchain') || lower.includes('mcp-adapters') || lower === 'mcp') {
    runner = 'orchestrator';
  } else {
    runner = 'unknown';
  }

  return {
    runner,
    runner_client: name,
    runner_version: clientInfo.version,
  };
}

```
###  Path: `/mcp-server/src/utils/server-version.ts`

```ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In src/utils/ → package.json is two levels up (../../package.json)
// In dist/utils/ → package.json is also two levels up (../../package.json)
const PACKAGE_JSON_PATH = join(__dirname, '..', '..', 'package.json');

/**
 * MCP server version captured at process startup (module-load time).
 * This is the "running" version — the code that is actually executing.
 */
export const SERVER_VERSION: string = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf-8')
).version;

/**
 * Re-reads the MCP server version from package.json on disk.
 * Use this to detect whether the running process is stale: if
 * `readPackageVersion() !== SERVER_VERSION`, the source has been
 * updated since this process started and a rebuild/restart is needed.
 */
export function readPackageVersion(): string {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')).version;
}

```
###  Path: `/mcp-server/src/utils/timestamp.ts`

```ts
/**
 * Returns the current timestamp in ISO 8601 UTC format: "YYYY-MM-DDTHH:MM:SSZ"
 */
export function now(): string {
  const date = new Date();

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}

/**
 * Parses a ledger timestamp string into a Date object.
 * Handles both the legacy space-separated format ("YYYY-MM-DD HH:MM:SS")
 * and the current ISO 8601 format ("YYYY-MM-DDTHH:MM:SS") for backward
 * compatibility with ledger files written by earlier versions.
 */
export function parseTimestamp(ts: string): Date {
  // Normalize the legacy space separator to 'T' so both formats parse correctly
  // in all JS environments (V8 handles both natively, but this is spec-safe).
  return new Date(ts.replace(' ', 'T'));
}

/**
 * Returns a short human-readable relative time string, e.g. "21mn ago",
 * "2h ago", "3d ago".  Used in AMBIGUOUS candidate listings.
 *
 * @param ts  - ISO timestamp string (as stored in project meta)
 * @param ref - Reference point for "now"; defaults to the current wall clock
 */
export function formatRelativeTime(ts: string, ref: Date = new Date()): string {
  const diffMs = ref.getTime() - parseTimestamp(ts).getTime();
  // Clamp negative diffs (clock skew / future timestamps) to 0.
  const ms = Math.max(0, diffMs);

  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours   = Math.floor(totalMinutes / 60);
  const totalDays    = Math.floor(totalHours   / 24);

  if (totalMinutes < 1)  return 'just now';
  if (totalHours   < 1)  return `${totalMinutes}mn ago`;
  if (totalDays    < 1) {
    const remMin = totalMinutes % 60;
    return remMin > 0 ? `${totalHours}h ${remMin}mn ago` : `${totalHours}h ago`;
  }
  const remHours = totalHours % 24;
  return remHours > 0 ? `${totalDays}d ${remHours}h ago` : `${totalDays}d ago`;
}

```
###  Path: `/mcp-server/src/utils/workflow-helpers.ts`

```ts
/**
 * Shared workflow helpers — stateless utility functions and constants used by
 * all three workflow tool modules (workflow-next-action, workflow-handoff,
 * workflow-batch-actions).
 *
 * Nothing in this file registers MCP tools or imports tool modules. It imports
 * from `schema/`, `storage/`, sibling `utils/` modules, and `gui/config.ts`
 * for runtime configuration access.
 */

import type { WorkPackageDetail, Pipeline } from '../schema/work-package.js';
import type { RootIndex } from '../schema/root-index.js';
import { parseTimestamp } from './timestamp.js';
import type { PipelineType, PostImplPipelineType } from './pipeline-maps.js';
import { getDownstreamTypes, getUpstreamTypes, resolveFailAgent, DEFAULT_PIPELINE_STAGES } from './pipeline-maps.js';
import { getConfig } from '../gui/config.js';
import { workflowManifest } from '../schema/workflow-manifest-schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of hours after which an IN_PROGRESS pipeline is considered stale.
 * Derived from `constants.stale_pipeline_hours` in the shared workflow manifest.
 */
export const STALE_PIPELINE_HOURS: number = workflowManifest.constants.stale_pipeline_hours;

/**
 * Maximum number of rework cycles allowed before a work package is circuit-broken.
 * When rework_count reaches this value, start_pipeline rejects with guidance to
 * cancel or restructure, and get_next_action surfaces BLOCK_FOR_REWORK_LIMIT.
 *
 * Derived from `constants.max_rework_count` in the shared workflow manifest.
 */
export const MAX_REWORK_COUNT: number = workflowManifest.constants.max_rework_count;

/** Handoff depth fallback when config is unavailable. Derived from manifest. */
const _DEFAULT_MAX_HANDOFF_DEPTH: number = workflowManifest.constants.max_handoff_depth;

/** Multiplier for scaling max handoff depth by project size. Derived from manifest. */
const _HANDOFF_DEPTH_MULTIPLIER: number = workflowManifest.constants.handoff_depth_multiplier;

/**
 * Returns the maximum auto-handoff chain depth from the in-memory config cache.
 * Falls back to the manifest default if the config module has not yet been
 * initialized (e.g. during early startup or in test environments that don't
 * call readConfigFromDisk()).
 */
export function getMaxHandoffDepth(): number {
  try {
    return getConfig().max_handoff_depth;
  } catch {
    return _DEFAULT_MAX_HANDOFF_DEPTH;
  }
}

/**
 * Returns the effective maximum auto-handoff depth, scaled by project size per §18.2.1.
 *
 * The floor is the config default. For larger projects the ceiling
 * grows to avoid terminating the chain prematurely:
 *   effectiveMax = max(configMax, totalWorkPackages × multiplier)
 *
 * Examples (with defaults max=50, multiplier=30):
 *   effectiveMaxDepth(0)  → 50   (0 × 30 = 0 < 50, floor applies)
 *   effectiveMaxDepth(1)  → 50   (1 × 30 = 30 < 50, floor applies)
 *   effectiveMaxDepth(5)  → 150  (5 × 30 = 150 > 50)
 */
export function effectiveMaxDepth(
  totalWorkPackages: number,
  configMax: number = getMaxHandoffDepth(),
): number {
  return Math.max(configMax, totalWorkPackages * _HANDOFF_DEPTH_MULTIPLIER);
}

// ---------------------------------------------------------------------------
// Synthesis state helper
// ---------------------------------------------------------------------------

/**
 * Clears synthesis-related fields on the root index. Centralises the two-line
 * pattern `synthesis_generated = false; synthesis_generated_at = null;` that
 * was previously duplicated at 5 call sites.
 */
export function clearSynthesisState(rootIndex: RootIndex): void {
  rootIndex.synthesis_generated = false;
  rootIndex.synthesis_generated_at = null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the prompt string passed to the next agent during auto-handoff.
 * Intentionally minimal — the receiving agent's persona contains full workflow instructions.
 *
 * When `agentId` is provided, the returned string is prefixed with `@{agentId}\n` so that
 * VS Code recognises it as a routing directive and loads the correct persona before the
 * subagent runs.  The prefix **must** appear at position 0 for VS Code to honour it.
 *
 * When `agentId` is omitted (or `undefined`) the original format is returned unchanged,
 * preserving backward compatibility with persona files that do not carry an `id:` field.
 */
export function buildHandoffPrompt(projectPath: string, agentId?: string): string {
  const body = `Project path: ${projectPath}`;
  return agentId ? `@${agentId}\n${body}` : body;
}

// ---------------------------------------------------------------------------
// Display maps (used by batch-actions and next-action tools)
// ---------------------------------------------------------------------------

/** Display-name maps used by getNextActions for human-readable output.
 * These deliberately exclude 'implementation' — only post-impl stages appear
 * in batch action output. PostImplPipelineType enforces this at compile time. */
export const agentNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};
export const actionNameMap: Record<PostImplPipelineType, string> = {
  'qa': 'RUN_QA',
  'code-review': 'RUN_REVIEW',
  'documentation': 'WRITE_DOCS',
};
export const reworkActionMap: Record<PostImplPipelineType, string> = {
  'qa': 'WAIT',
  'code-review': 'WAIT',
  'documentation': 'REWORK',
};

/** @deprecated Use PIPELINE_AGENT_MAP from pipeline-maps.ts instead (manifest-derived, covers all 6 stages). */
export const pipelineAgentRoleMap: Record<string, string> = {
  'implementation': 'Developer',
  'qa': 'QA',
  'code-review': 'Reviewer',
  'documentation': 'Documentation',
};

// ---------------------------------------------------------------------------
// Pipeline-state guards
// ---------------------------------------------------------------------------

/**
 * Helper: Returns true if the pipeline is IN_PROGRESS and was started more than
 * STALE_PIPELINE_HOURS hours ago.
 */
export function isStalePipeline(pipeline: Pipeline): boolean {
  if (pipeline.status !== 'IN_PROGRESS' || !pipeline.started_at) return false;
  const startedAt = parseTimestamp(pipeline.started_at).getTime();
  const ageHours = (Date.now() - startedAt) / (1000 * 60 * 60);
  return ageHours > STALE_PIPELINE_HOURS;
}

/**
 * Helper: Returns true only if the most recent non-auto-cancelled pipeline of the
 * given type has FAIL status. Auto-cancelled pipelines are excluded per §14.7 / §21.27.
 * A [FAIL, PASS] sequence correctly returns false — only historical FAILs preceding
 * a PASS are ignored. Treat absent/falsy `auto_cancelled` as false (backward-compatible).
 */
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean {
  const matching = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (matching.length === 0) return false;
  return matching.at(-1)!.status === 'FAIL';
}

/**
 * Returns true if any pipeline type downstream of the given type has a most-recent
 * FAIL status (excluding auto-cancelled pipelines per §21.27).
 * Per §11.3. Delegates to isMostRecentPipelineFail() to avoid duplicating filter logic.
 *
 * When activeStages is provided, only stages present in the WP's active set are
 * considered downstream, preventing false-positive rework triggers for inactive stages.
 */
export function hasDownstreamFail(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  activeStages?: readonly PipelineType[],
): boolean {
  const downstreamTypes = getDownstreamTypes(pipelineType, activeStages);
  return downstreamTypes.some((dsType) => isMostRecentPipelineFail(pipelines, dsType));
}

/**
 * Returns an error message if the re-validation guard fires (prerequisite PASS
 * is stale relative to the current pipeline type's most recent run and upstream
 * rework has occurred), or null if the pipeline may proceed.
 *
 * Guard algorithm (§11.1, two-layer check):
 *
 * Layer 1 — Upstream rework check (unconditional, catches first-run stage-skipping):
 *   If any upstream pipeline started after the prerequisite PASSed → BLOCK.
 *
 * Layer 2 — Temporal consistency check (same-type re-runs only):
 *   If the prerequisite PASS predates the last effective run of pipelineType,
 *   but no upstream rework occurred → ALLOW (self-rework scenario).
 */
export function checkRevalidationGuard(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  prerequisite: PipelineType,
  activeStages?: readonly PipelineType[],
): string | null {

  // Find most recent prerequisite PASS (already confirmed PASS by caller)
  const prereqPasses = pipelines.filter(
    (p) => p.type === prerequisite && p.status === 'PASS' && !p.auto_cancelled
  );
  if (prereqPasses.length === 0) return null; // No prereq pass — conservative

  const prereqPass = prereqPasses.at(-1)!;
  if (!prereqPass.completed_at) return null; // Missing timestamp — conservative pass

  const prereqCompletedAt = parseTimestamp(prereqPass.completed_at).getTime();

  // --- Layer 1: Upstream rework check (unconditional — applies regardless of prior runs) ---
  // Detects if any pipeline upstream of the current type was started AFTER the
  // prerequisite PASSed — indicating stale prerequisite. This is decoupled from
  // effectiveSamePipelines so it also catches first-run stage-skipping (e.g.,
  // code-review starting for the first time while a new implementation is in progress).
  const upstreamTypes = getUpstreamTypes(pipelineType, activeStages ?? DEFAULT_PIPELINE_STAGES);
  const hasUpstreamRework = pipelines.some(
    (p) =>
      upstreamTypes.includes(p.type as PipelineType) &&
      !p.auto_cancelled &&
      p.started_at != null &&
      parseTimestamp(p.started_at).getTime() > prereqCompletedAt
  );

  if (hasUpstreamRework) {
    return (
      `Cannot start ${pipelineType}: the prerequisite ${prerequisite} PASS is stale. ` +
      `Upstream rework has occurred since the last ${prerequisite} PASS. ` +
      `Re-run ${prerequisite} to establish a fresh pass before proceeding.`
    );
  }

  // --- Layer 2: Temporal consistency check (same-type re-runs only) ---
  // When the current pipeline type has been run before, verify the prerequisite
  // PASSed AFTER the most recent effective run. If the prerequisite is temporally
  // stale but no upstream rework occurred (layer 1 passed), this is a self-rework
  // scenario (e.g., documentation retrying after its own FAIL) — allow.
  const priorRuns = pipelines.filter(
    (p) => p.type === pipelineType && !p.auto_cancelled
  );
  if (priorRuns.length === 0) return null; // First run — layer 1 already checked upstream

  const baselineRun = priorRuns.at(-1)!;
  if (!baselineRun.started_at) return null; // Missing timestamp — conservative pass

  // If prereq PASS is fresh relative to the baseline run → pass
  // (prereq PASSed after or at the same time the last run started)
  // Since layer 1 already confirmed no upstream rework, any temporal staleness
  // here is a self-rework scenario — allow the pipeline to start.

  return null;
}

/**
 * Returns true when a downstream agent (whose FAIL routes to Developer) has
 * started a pipeline since the most recent upstream PASS. Excludes auto-cancelled
 * pipelines from both upstream and downstream lookups (§21.27).
 *
 * Used by Developer recommendation engine (§14.2 priority 5) to prevent
 * redundant rework cycles (§21.52).
 *
 * When activeStages is provided, only considers downstream types within the WP's
 * active stage set, preventing false-positive triggers for inactive stages.
 */
export function hasDownstreamReengagedSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  activeStages?: readonly PipelineType[],
): boolean {
  // Find most recent upstream PASS (excluding auto-cancelled)
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS' && !p.auto_cancelled)
    .at(-1);

  if (!upstreamPass?.completed_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();

  // Determine which downstream types route FAIL back to Developer.
  // When activeStages is provided, restrict to active downstream types to avoid
  // triggering on stages that are not in this WP's pipeline composition.
  const resolvedActiveStages = activeStages ?? DEFAULT_PIPELINE_STAGES;
  const downstreamTypes = getDownstreamTypes(upstreamType, resolvedActiveStages);
  const developerReworkTypes = downstreamTypes.filter(
    (t) => resolveFailAgent(t, resolvedActiveStages) === 'Developer'
  );
  for (const dsType of developerReworkTypes) {
    const dsPipelines = pipelines.filter(
      (p) => p.type === dsType && !p.auto_cancelled
    );
    if (dsPipelines.length > 0) {
      const mostRecent = dsPipelines.at(-1)!;
      if (mostRecent.started_at) {
        const dsStartedAt = parseTimestamp(mostRecent.started_at).getTime();
        if (dsStartedAt >= upstreamCompletedAt) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Helper function: Check if a WP is blocked by incomplete dependencies.
 *
 * Uses the canonical metadata-based check per §21.54: a WP is classified as
 * "blocked by dependencies" when its status is BLOCKED and either blocked_by
 * is absent (null/undefined) or blocked_by.type === 'dependency'.
 */
export function isBlockedByDependencies(
  wp: WorkPackageDetail,
): boolean {
  if (wp.status !== 'BLOCKED') return false;
  return wp.blocked_by == null || wp.blocked_by.type === 'dependency';
}

/**
 * @deprecated Use isBlockedByDependencies(). Alias retained for backward
 * compatibility with existing call sites.
 */
export const hasDependencyBlocked = isBlockedByDependencies;

/**
 * Helper: Returns true if the downstream pipeline agent should (re-)engage.
 *
 * Handles both first-run and rework cycles via timestamp comparison:
 * - First run: no downstream pipeline exists → always returns true (if upstream PASS exists).
 * - Rework cycle: a new upstream PASS was recorded after the most recent downstream
 *   pipeline started → the downstream agent must re-run.
 * - Already up-to-date: upstream PASS completed before downstream started → returns false.
 * - No upstream PASS: prerequisite not yet met → returns false.
 *
 * Timestamps: compares upstream `completed_at` vs downstream `started_at`. If either
 * timestamp field is absent, falls back to false (conservative: don't trigger spuriously).
 */
export function hasNewUpstreamPassSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  downstreamType: PipelineType
): boolean {
  // No upstream PASS → downstream cannot start yet
  const upstreamPass = pipelines
    .filter((p) => p.type === upstreamType && p.status === 'PASS')
    .at(-1);
  if (!upstreamPass) return false;

  // No downstream pipeline (or only auto-cancelled) → first run, always trigger
  // Auto-cancelled pipelines are excluded from the downstream lookup per §14.6 / §21.27
  const downstreamLatest = pipelines
    .filter((p) => p.type === downstreamType && !p.auto_cancelled)
    .at(-1);
  if (!downstreamLatest) return true;

  // Both timestamps must be present for temporal comparison
  if (!upstreamPass.completed_at || !downstreamLatest.started_at) return false;

  const upstreamCompletedAt = parseTimestamp(upstreamPass.completed_at).getTime();
  const downstreamStartedAt = parseTimestamp(downstreamLatest.started_at).getTime();

  // Upstream completed at or after downstream started → rework triggered a new cycle
  // Uses >= per §14.6: coincident timestamps (same clock tick) should return true
  return upstreamCompletedAt >= downstreamStartedAt;
}

/**
 * Re-engagement check for P4/P5 priority blocks (§21.66).
 *
 * Collapses the null-prerequisite ternary that would otherwise return `true` and
 * trigger an infinite re-engagement loop when a WP's first active stage is the
 * current agent's stage (i.e. `resolvePrerequisite` returns `null`).
 *
 * Rule: null prerequisite → false (no upstream to re-engage from).
 * Non-null prerequisite → delegate to `hasNewUpstreamPassSince`.
 */
export function makeReEngagementCheck(
  pipelines: Pipeline[],
  prerequisite: PipelineType | null,
  type: PipelineType,
): boolean {
  return prerequisite === null ? false : hasNewUpstreamPassSince(pipelines, prerequisite, type);
}

/**
 * Returns the most recent non-auto-cancelled pipeline for the given work package,
 * or null if no such pipeline exists.
 */
export function mostRecentEffectivePipeline(wp: WorkPackageDetail): Pipeline | null {
  return wp.pipelines.filter((p) => !p.auto_cancelled).at(-1) ?? null;
}

/**
 * Returns true when the WP has an active (IN_PROGRESS and non-stale) pipeline
 * of the specified type. Used to emit CONTINUE_PIPELINE (§21.33) before
 * routing to rework or new-work recommendations.
 */
export function isActivePipeline(
  wp: WorkPackageDetail,
  pipelineType: PipelineType,
): boolean {
  const matching = wp.pipelines.filter(
    (p) => p.type === pipelineType && p.status === 'IN_PROGRESS',
  );
  if (matching.length === 0) return false;
  // Return true if ANY matching IN_PROGRESS pipeline is NOT stale
  return matching.some((p) => !isStalePipeline(p));
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/** Shared response shape returned by action helpers and tool handlers. */
type ToolActionResponse = { content: [{ type: 'text'; text: string }] };

/**
 * Returns a RESUME_OR_CANCEL action response when the work package has a stale
 * IN_PROGRESS pipeline of the specified type, or null if none is found.
 */
export function extractStalePipelineAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
): ToolActionResponse | null {
  const stalePipeline = wpDetail.pipelines.find(
    (p) => p.type === pipelineType && isStalePipeline(p)
  );
  if (!stalePipeline) return null;
  const startedAt = stalePipeline.started_at ?? 'unknown';
  const ageHours = stalePipeline.started_at
    ? Math.floor((Date.now() - parseTimestamp(stalePipeline.started_at).getTime()) / (1000 * 60 * 60))
    : -1;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: 'RESUME_OR_CANCEL',
            work_package_id: wpDetail.work_package_id,
            pipeline_type: pipelineType,
            started_at: startedAt,
            age_hours: ageHours,
            reason: `Work package ${wpDetail.work_package_id} has a stale '${pipelineType}' pipeline that has been IN_PROGRESS for ~${ageHours} hours. Resume or cancel it using ledger_cancel_pipeline.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Returns a rework action response when the most recent pipeline of the specified
 * type for the work package has FAIL status, or null if no rework is needed.
 */
export function extractReworkAction(
  wpDetail: WorkPackageDetail,
  pipelineType: string,
  reworkActionName: string,
  reworkReason: string,
): ToolActionResponse | null {
  // BLOCKED WPs need upstream agent intervention (e.g. Developer rework)
  // before the current pipeline agent can retry — skip rework suggestion.
  if (wpDetail.status === 'BLOCKED') return null;
  if (!isMostRecentPipelineFail(wpDetail.pipelines, pipelineType)) return null;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            action: reworkActionName,
            work_package_id: wpDetail.work_package_id,
            reason: reworkReason,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// WP detail helpers
// ---------------------------------------------------------------------------

/**
 * Helper: Returns handoff notes on the given WP addressed to agentName, or undefined.
 */
export function getHandoffNotesForAgent(
  wpDetail: WorkPackageDetail,
  agentName: string
): string[] | undefined {
  if (!wpDetail.handoff_notes || wpDetail.handoff_notes.length === 0) {
    return undefined;
  }
  const relevant = wpDetail.handoff_notes.filter((n) => n.to_agent === agentName);
  if (relevant.length === 0) return undefined;
  // Flatten all notes from matching entries into a single array
  return relevant.flatMap((n) => n.notes);
}

```
###  Path: `/mcp-server/src/utils/wp-id.ts`

```ts
/**
 * Formats a work package number as "WP-###" with zero-padding to 3 digits.
 * @param n - The work package number (e.g., 1, 42, 123)
 * @returns Formatted work package ID (e.g., "WP-001", "WP-042", "WP-123")
 */
export function formatWpId(n: number): string {
  return `WP-${String(n).padStart(3, '0')}`;
}

/**
 * Parses a work package ID and extracts the numeric part.
 * @param id - The work package ID (e.g., "WP-001", "WP-042")
 * @returns The numeric work package number
 * @throws Error if the ID format is invalid
 */
export function parseWpId(id: string): number {
  const match = id.match(/^WP-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid work package ID format: "${id}". Expected format: WP-###`);
  }
  // Unreachable: regex (\d+) always captures when match succeeds; satisfies noUncheckedIndexedAccess
  const wpNum = match[1];
  if (wpNum === undefined) {
    throw new Error(`Invalid work package ID format: "${id}". Expected format: WP-###`);
  }
  return parseInt(wpNum, 10);
}

```
---
**File Statistics**
- **Size**: 88.59 KB
- **Lines**: 2439
File: `mcp-server/source-utils.md`
