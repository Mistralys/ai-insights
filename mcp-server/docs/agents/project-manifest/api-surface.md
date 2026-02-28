# Public API Surface

This document lists **public constructors, properties, and method signatures** for all exported classes, functions, and types. Implementation details are omitted.

---

## MCP Tools (20 Total)

The primary public API is the set of **MCP tools** registered by the server. Agents invoke these tools via the MCP protocol.

### Project Lifecycle Tools

#### `ledger_get_project_status`

```typescript
(args: { project_path: string }) => Promise<MCPResult>
```

Reads the root index and returns project overview. Includes self-healing logic that recomputes counters from actual work package data. Self-healing separates computation (`computeHealedStatus` — pure function) from persistence (conditional write under lock). No disk write occurs if counters and status are already correct.

#### `ledger_initialize_project`

```typescript
(args: { 
  project_path: string; 
  plan_file: string  // must equal 'plan.md' — enforced by Zod .refine()
}) => Promise<MCPResult>
```

Creates a new project ledger with root index and centralized storage directory. Rejects if ledger already exists. After writing the root index and project meta, copies `plan_file` into the centralized storage directory (best-effort). Response payload includes `archived_documents: string[]` and, conditionally, `archive_skipped: string[]` (omitted when empty).

**`plan_file` constraint:** the `plan_file` argument is validated at parse time by a Zod `.refine()` check (`v === PLAN_ARCHIVE_FILENAME`). Any value other than `'plan.md'` is rejected with a validation error before handler logic runs. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on a fixed archive filename.

#### `ledger_list_projects`

```typescript
(args: {
  status?: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
}) => Promise<MCPResult>
```

Scans the central ledger root directory and returns metadata for all projects. Optionally filters by status. Projects with missing or invalid `.meta.json` are silently skipped.

#### `ledger_complete_synthesis`

```typescript
(args: { 
  project_path: string;
  synthesis_file?: string;  // default: 'synthesis.md'
}) => Promise<MCPResult>
```

Marks synthesis as generated on the root index. Sets `synthesis_generated = true` and transitions the project to `COMPLETE` if all WPs are done. Idempotent — calling multiple times is safe. Called by the Synthesis agent after generating the final report. Copies `synthesis_file` into the centralized storage directory inside the lock scope (best-effort). Response payload includes `archived_documents: string[]` and, conditionally, `archive_skipped: string[]` (omitted when empty).

#### `ledger_detect_project`

```typescript
(args: { cwd_path: string }) => Promise<MCPResult>
```

Identifies the active project by cross-referencing the supplied working-directory path against all project roots stored in the centralized ledger. Returns `{ plan_path, slug, title?, status }` for the unique matching project.

**Error cases:**
- **`NOT_FOUND`** — no known project root is an ancestor of `cwd_path`. Returned when `cwd_path` is not inside any initialized project's codebase.
- **`AMBIGUOUS`** — more than one project root is an ancestor of `cwd_path`. The error message lists all matching `plan_path` values. Pass an explicit `project_path` to the tool requiring it to disambiguate.

Note: `cwd_path` must be a directory path, not a file path. The tool does NOT require `project_path` as a parameter — that is the primary purpose of this tool.

---

### Work Package Tools

#### `ledger_get_work_package`

```typescript
(args: { 
  project_path: string; 
  work_package_id: string // WP-### format
}) => Promise<MCPResult>
```

Reads and returns the full work package detail.

#### `ledger_list_work_packages`

```typescript
(args: { 
  project_path: string;
  status?: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  assigned_to?: string;
}) => Promise<MCPResult>
```

Lists work package summaries from the root index with optional filters.

#### `ledger_create_work_package`

```typescript
(args: { 
  project_path: string;
  assigned_to: string;
  dependencies: string[]; // Array of WP IDs
  acceptance_criteria: string[]; // min(1) — at least one criterion required; empty array is rejected
  work_package_file: string;
}) => Promise<MCPResult>
```

Creates a new work package with auto-generated WP ID. Creates both detail file and root index summary atomically.

#### `ledger_claim_work_package`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  agent: string;
  override?: boolean;
}) => Promise<MCPResult>
```

Claims a `READY` work package by transitioning to `IN_PROGRESS`. Validates dependencies are met. **Rejects claims when the WP is assigned to a different agent** unless `override: true` is passed. `override: true` is itself restricted to the `"Project Manager"` or the current `wp.assigned_to` — any other caller using it receives a hard rejection (see constraint 14).

#### `ledger_update_work_package_status`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'CANCELLED';
  agent: string;
  blocked_by?: {
    type: 'dependency' | 'decision' | 'external' | 'technical';
    description: string;
    blocking_work_package?: string;
  };
}) => Promise<MCPResult>
```

Updates work package status with validation. Enforces legal status transitions and special rules:
- `IN_PROGRESS → COMPLETE`: requires all acceptance criteria met; only `"Documentation"` (or `"Documentation Agent"`)
- `COMPLETE → IN_PROGRESS`: only `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`) — triggers `revision` increment, `pending_work_packages` increment, and cascade-reblock of non-COMPLETE, non-BLOCKED dependents (see `propagateDependencyReblock`)
- `→ CANCELLED`: only `"Project Manager"` (or `"Project Manager Agent"`). CANCELLED is terminal — no outward transitions. Valid from READY, IN_PROGRESS, or BLOCKED. Decrements `pending_work_packages` and triggers `propagateDependencyUnblock` (CANCELLED satisfies dependencies like COMPLETE).
- `BLOCKED → IN_PROGRESS` / `BLOCKED → READY`: both automatically clear the `blocked_by` field

The `agent` field is required because the server checks which persona is attempting the transition.

---

### Pipeline Tools

#### `ledger_start_pipeline`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  agent_role?: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
}) => Promise<MCPResult>
```

Starts a new pipeline for a work package. The `type` field is validated by a Zod enum — invalid values are rejected at the MCP layer. Validates WP is `IN_PROGRESS` and no duplicate in-progress pipeline exists.

**Rework circuit breaker:** After incrementing `rework_count` (when the most recent same-type pipeline is FAIL), if `rework_count >= MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), the call is rejected with an error guiding the caller to cancel or restructure the WP.

If `agent_role` is provided, it must match the pipeline type's owner role (per the `PIPELINE_AGENT_MAP`). For example, passing `agent_role: 'QA'` when starting an `implementation` pipeline is rejected with a descriptive error. If `agent_role` is omitted, no role check is performed (backward compatible).

#### `ledger_complete_pipeline`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  status: 'PASS' | 'FAIL';
  summary: string[];
  artifacts?: {
    files_modified?: string[];
    commit_hash?: string;
    pull_request?: string;
  };
  metrics?: {
    test_coverage?: string;
    tests_passed?: number;
    tests_failed?: number;
    security_issues?: number;
    [key: string]: any;
  };
  comments?: Array<{
    type: string;
    priority: 'low' | 'medium' | 'high';
    timestamp: string;
    note: string;
  }>;
  acceptance_criteria_updates?: Array<{
    criterion: string;
    met: boolean;
  }>;
  handoff_notes?: string[]; // Notes for the next agent in the pipeline chain
}) => Promise<MCPResult>
```

Completes the most recent `IN_PROGRESS` pipeline of the specified type. If `handoff_notes` is provided, a structured `HandoffNote` entry is appended to the work package. On PASS, the recipient is determined by `NEXT_AGENT_MAP` (next agent in chain). On FAIL, the recipient is determined by `FAIL_ROUTING_MAP` (routes QA/code-review/implementation failures to Developer; documentation failures to Documentation for self-rework). Sets status, completion timestamp, summary, and optional fields.

**`acceptance_criteria_updates` merge semantics:** Each item is matched by exact `criterion` string. If found, its `met` flag is updated. If **not found** (unknown criterion text), a new `AcceptanceCriterion` entry `{ criterion, met }` is **appended** to the WP's `acceptance_criteria` array.

#### `ledger_cancel_pipeline`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  reason: string;
}) => Promise<MCPResult>
```

Cancels the most recent `IN_PROGRESS` pipeline of the specified type by setting its status to `FAIL` and recording the reason as the summary. Throws an error if no `IN_PROGRESS` pipeline of the given type exists. Use this to cancel pipelines that have become stale (detected via `ledger_get_next_action` returning `RESUME_OR_CANCEL`).

#### `ledger_update_pipeline_progress`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  summary: string[];
}) => Promise<MCPResult>
```

Appends to the summary array of the most recent `IN_PROGRESS` pipeline without completing it. Useful for recording incremental progress checkpoints during long-running pipelines.

---

### Observation Tools

#### `ledger_add_observation`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  pipeline_type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  type: string; // e.g., "code-smell", "refactor", "debt"
  priority: 'low' | 'medium' | 'high';
  note: string;
}) => Promise<MCPResult>
```

Adds a comment to the most recent pipeline of the specified type. The `pipeline_type` field is validated by a Zod enum. Comments do not include an agent field (agent is inferred from pipeline type).

#### `ledger_add_project_comment`

```typescript
(args: { 
  project_path: string;
  type: string; // e.g., "incident", "note", "decision"
  priority: 'low' | 'medium' | 'high';
  agent: string;
  note: string;
  context?: {
    os: string;
    tool: string;
    work_package?: string;
    resolved: boolean;
    workaround?: string;
  };
}) => Promise<MCPResult>
```

Adds a comment to the project-level comments array in the root index. For `incident` type comments, `context` is required.

---

### Workflow Coordination Tools

#### `ledger_get_next_action`

```typescript
(args: { 
  project_path: string;
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
}) => Promise<MCPResult>
```

Reads root index and work package details to recommend the next action for an agent. Returns a single actionable recommendation. For projects with many independent WPs, prefer `ledger_get_next_actions`.

#### `ledger_get_next_actions`

```typescript
(args: { 
  project_path: string;
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
  max_results?: number; // default: 5
}) => Promise<MCPResult>
```

Batch version of `ledger_get_next_action`. Returns all currently actionable work packages for the given agent role, up to `max_results`. Useful in projects with many independent WPs that can be processed in parallel.

#### `ledger_get_handoff_status`

```typescript
(args: { 
  project_path: string;
  current_agent: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
}) => Promise<MCPResult>
```

Computes the correct `AGENT` and `STATUS` handoff block for the current agent. Examines all work package statuses and pipelines to determine project state.

When the agent registry is loaded and all eligibility conditions are met, the response payload includes an optional `auto_handoff` object that the receiving IDE can use to automatically invoke the next agent without human intervention:

```typescript
interface HandoffStatusPayload {
  // Always present
  current_agent: string;
  next_agent: string;
  status: string;            // e.g. 'WAIT', 'COMPLETE', 'HANDOFF'
  reason: string;

  // Present only when automatic handoff is eligible
  auto_handoff?: {
    agent_name: string;      // The agent file name (e.g. "6-documentation.agent.md")
    prompt: string;          // Prompt to pass to the next agent (contains project_path)
  };
}
```

**Auto-handoff eligibility** — `auto_handoff` is included only when **all** of the following are true:
1. `auto_handoff_enabled` is `true` in the GUI config (`getConfig().auto_handoff_enabled`)
2. The agent registry is loaded (`isRegistryLoaded()` returns `true`)
3. The next agent has a known handle in the registry
4. Project status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` in the root index is `< getMaxHandoffDepth()` (default 10, runtime-configurable via `gui-config.json`)

Each successful emission increments `auto_handoff_depth` in the root index. Reaching `COMPLETE` status resets the counter to `0`.

---

### Help & Documentation Tools

#### `ledger_help`

```typescript
(args: { tool_name?: string }) => Promise<MCPResult>
```

Returns usage documentation, examples, and required parameters for all ledger tools. Designed to help agents — especially weaker models — understand correct tool invocation.

- **No arguments** — returns a full overview with all tools listed, workflow guidance, and quick-start instructions.
- **`tool_name` provided** — returns detailed documentation for that specific tool (e.g., `"ledger_update_work_package_status"`), including required parameters, examples, and common pitfalls.
- **Unknown `tool_name`** — returns a list of all available tool names.

Help content is sourced from `src/tools/help-content.ts` (`TOOL_HELP` map). The tool is stateless and has no side effects.

---

## Storage API

### `LedgerStore`

Central storage abstraction for ledger file I/O. Files are stored in the centralized ledger root at `{ledgerRoot}/{slug}/` — never inside plan folders.

```typescript
class LedgerStore {
  readonly planPath: string;
  readonly slug: string;
  readonly ledgerRoot: string;
  readonly storageDir: string;   // {ledgerRoot}/{slug}/

  // Optional ledgerRoot enables test isolation (pass a temp directory)
  constructor(projectPath: string, ledgerRoot?: string);

  // Path helpers
  metaPath(): string;  // {storageDir}/.meta.json

  // Existence checks
  rootIndexExists(): Promise<boolean>;
  wpDetailExists(wpId: string): Promise<boolean>;
  ledgerDirExists(): Promise<boolean>;

  // Read operations (validated with Zod)
  readRootIndex(): Promise<RootIndex>;
  readWorkPackage(wpId: string): Promise<WorkPackageDetail>;
  readProjectMeta(): Promise<ProjectMeta>;

  // Write operations (validated before writing)
  writeRootIndex(data: RootIndex): Promise<void>;          // auto-syncs .meta.json
  writeWorkPackage(wpId: string, data: WorkPackageDetail): Promise<void>;

  // Dual-file atomic update (auto-syncs .meta.json inside lock)
  updateWorkPackageWithSync(
    wpId: string,
    updater: (wp: WorkPackageDetail, root: RootIndex) => 
      { wp: WorkPackageDetail; root: RootIndex } | 
      Promise<{ wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<void>;

  // Document archiving
  archiveDocuments(filenames: string[]): Promise<{ archived: string[]; skipped: string[] }>;
  // Copies each filename from planPath to storageDir. Missing sources (ENOENT) are silently
  // skipped (warning written to stderr). Returns lists of archived and skipped filenames.
  // Non-ENOENT errors (e.g. EACCES, ENOSPC, EISDIR) are re-thrown to the caller.

  // Meta methods
  writeProjectMeta(planFile: string, status?: string): Promise<void>;

  // Static
  static listAllProjects(ledgerRoot?: string): Promise<ProjectMeta[]>;
  static detectProjectByCwd(
    cwdPath: string,
    ledgerRoot?: string
  ): Promise<DetectProjectResult>;
}

// Discriminated union returned by LedgerStore.detectProjectByCwd()
type DetectProjectResult =
  | { status: 'FOUND'; meta: ProjectMeta }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS'; candidates: ProjectMeta[] };
```

---

### `atomicWriteJson()`

```typescript
function atomicWriteJson(filePath: string, data: unknown): Promise<void>;
```

Writes JSON data to a file atomically using the write-to-temp-then-rename pattern. Ensures directory exists, pretty-prints JSON with 2-space indentation and trailing newline.

---

### `withLock()`

```typescript
function withLock<T>(storageDir: string, fn: () => Promise<T>): Promise<T>;
```

Acquires a file lock on the project's centralized storage directory, executes the callback, and releases the lock in a `finally` block. Lock file created at `{storageDir}/.lock`.

---

## Schema Types

All types are inferred from Zod schemas using `z.infer<typeof Schema>`.

### `ProjectMeta`

Exported from `src/schema/project-meta.ts`. Represents the per-project `.meta.json` file stored in the centralized ledger root.

```typescript
interface ProjectMeta {
  slug: string;          // Plan folder basename, e.g. "2026-02-16-feature"
  plan_path: string;     // Original absolute project_path
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  date_created: string;  // ISO timestamp
  last_updated: string;  // ISO timestamp
  title?: string;        // Optional, derived from plan_file content
}
```

Schema: `ProjectMetaSchema` (Zod).

### Core Types

```typescript
type ProjectStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type WorkPackageStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type PipelineStatus = 'IN_PROGRESS' | 'PASS' | 'FAIL'; // Note: 'READY' was removed — pipelines are always created as IN_PROGRESS
type AgentRole = 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis'; // Exported from src/utils/constants.ts; canonical string-literal union for all valid agent role names.
type PipelineType = 'implementation' | 'qa' | 'code-review' | 'documentation'; // Exported from src/utils/pipeline-maps.ts; provides compile-time exhaustiveness checking for pipeline key access across all routing maps. Also available as PipelineTypeEnum (Zod schema) for use in tool input validation.
type PostImplPipelineType = Exclude<PipelineType, 'implementation'>; // Subset type for maps that only apply to post-implementation stages (QA, code-review, documentation)
type BlockerType = 'dependency' | 'decision' | 'external' | 'technical';
type CommentPriority = 'low' | 'medium' | 'high';
```

### Data Structures

```typescript
interface RootIndex {
  plan_file: string;
  date_created: string;
  last_updated: string;
  status: ProjectStatus;
  total_work_packages: number;
  pending_work_packages: number;
  work_packages: WorkPackageSummary[];
  project_comments: ProjectComment[];
  auto_handoff_depth?: number; // Server-managed loop-guard counter; absent/undefined treated as 0
  synthesis_generated?: boolean; // Set to true by ledger_complete_synthesis; absent/false means synthesis not yet done
}

interface WorkPackageSummary {
  work_package_id: string; // WP-### format
  status: WorkPackageStatus;
  assigned_to: string;
  dependencies: string[];
  file: string; // Path to detail file
}

interface HandoffNote {
  from_agent: string;
  to_agent: string;
  timestamp: string;
  notes: string[];
}

interface WorkPackageDetail {
  work_package_id: string;
  work_package_file: string;
  status: WorkPackageStatus;
  assigned_to: string;
  dependencies: string[];
  blocked_by?: Blocker;
  acceptance_criteria: AcceptanceCriterion[];
  revision: number;
  rework_count?: number;  // Incremented each time a pipeline is restarted after a FAIL
  handoff_notes?: HandoffNote[];  // Notes appended via completePipeline's handoff_notes param
  pipelines: Pipeline[];
}

interface Pipeline {
  type: string;
  status: PipelineStatus;
  started_at?: string;
  completed_at?: string;
  summary: string[];
  artifacts?: Artifacts;
  metrics?: Metrics;
  comments?: PipelineComment[];
}

interface AcceptanceCriterion {
  criterion: string;
  met: boolean;
}

interface Blocker {
  type: BlockerType;
  description: string;
  blocking_work_package?: string;
}

interface PipelineComment {
  type: string;
  priority: CommentPriority;
  timestamp: string;
  note: string;
  context?: IncidentContext;
}

interface ProjectComment {
  type: string;
  priority: CommentPriority;
  timestamp: string;
  agent: string;
  note: string;
  context?: IncidentContext;
}

interface IncidentContext {
  os: string;
  tool: string;
  work_package?: string;
  resolved: boolean;
  workaround?: string;
}

interface Artifacts {
  files_modified?: string[];
  commit_hash?: string;
  pull_request?: string;
}

interface Metrics {
  test_coverage?: string;
  tests_passed?: number;
  tests_failed?: number;
  security_issues?: number;
  [key: string]: any; // Extensible for custom metrics
}
```

---

## Validation Functions

```typescript
function isTerminalStatus(status: string): boolean;
// Returns true for COMPLETE and CANCELLED.
// Use this everywhere instead of inline status checks.

function isValidStatusTransition(
  from: WorkPackageStatus, 
  to: WorkPackageStatus
): boolean;

function canStartWorkPackage(
  wp: WorkPackageDetail | WorkPackageSummary,
  allWpSummaries: WorkPackageSummary[]
): { allowed: boolean; reason?: string };

function canCompleteWorkPackage(
  wp: WorkPackageDetail
): { allowed: boolean; unmet?: string[] };
```

---

## Constants

Exported from `src/utils/constants.ts`. Single source of truth for shared string constants and derived types used across the codebase.

```typescript
// Filename used when reading the archived plan document from centralized storage.
// Used by gui/api.ts (handleGetPlanDocument) as the read target; also referenced in help-content.ts.
const PLAN_ARCHIVE_FILENAME = 'plan.md' as const;

// Default filename used by ledger_complete_synthesis when archiving the synthesis document.
// Used as the Zod .default() value in project-lifecycle.ts; also referenced in help-content.ts.
const SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md' as const;

// Canonical array of valid agent role names. Consumers should import from here
// rather than defining local copies to avoid silent drift.
const AGENT_ROLES: readonly [
  'Planner', 'Project Manager', 'Developer',
  'QA', 'Reviewer', 'Documentation', 'Synthesis'
];

// String-literal union type derived from AGENT_ROLES.
type AgentRole = typeof AGENT_ROLES[number];
```

**Importers of `AGENT_ROLES`:**
- `src/tools/workflow-next-action.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/tools/workflow-handoff.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/tools/workflow-batch-actions.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/utils/agent-registry.ts` — imports `AGENT_ROLES` from `'./constants.js'`

**Importers of `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME`:**
- `gui/api.ts` — imports both; `PLAN_ARCHIVE_FILENAME` used in `handleGetPlanDocument` join() call, `SYNTHESIS_ARCHIVE_FILENAME` used in `handleGetSynthesisDocument` join() call
- `src/tools/project-lifecycle.ts` — imports `SYNTHESIS_ARCHIVE_FILENAME`; used as Zod `.default()` value
- `src/tools/help-content.ts` — imports both; used in tool help text template expressions

---

## Agent Registry

Exported from `src/utils/agent-registry.ts`. Discovers VS Code agent handles by scanning `*.agent.md` files in a configurable directory.

### `discoverAgents()`

```typescript
async function discoverAgents(agentsDir: string, strict?: boolean): Promise<Record<string, string>>;
```

Scans `agentsDir` for `*.agent.md` files, parses YAML frontmatter in each, and builds an in-memory map from workflow `role` names to VS Code agent `name` handles (e.g. `{ "Developer": "3 - Developer v3.1.2" }`). Overwrites the module-level cache on each call and returns a shallow copy.

**Parameters:**
- `agentsDir` — path to the directory containing `*.agent.md` files.
- `strict` *(optional, default `false`)* — when `true`, throws a `RangeError` if any file contains a `role:` value not present in `AGENT_ROLES`. When `false` (default), unknown roles emit a `stderr` warning but are still added to the map (forward-compatible).

**Behaviour:**
- Files without a `role:` field are silently skipped.
- Files with `role:` but without `name:` write a warning to `stderr` and are skipped.
- `role:` values that do not match a known agent role: in non-strict mode, write a warning to `stderr` and add the entry; in strict mode, throw `RangeError: [discoverAgents] Unknown role "<role>" in <filePath>`.
- If `agentsDir` does not exist or is unreadable, a warning is written to `stderr` and an empty map is returned.
- If two files share the same `role:` value, a warning is written to `stderr` naming both files, and the last one wins (last-wins behaviour preserved).

**Known limitation:** The internal YAML parser (`stripYamlQuotes`) only strips matching outer quote pairs. Escaped inner quotes (e.g. `name: 'It\'s a name'`) are not handled.

### `getAgentHandle()`

```typescript
function getAgentHandle(role: string): string | null;
```

Looks up a role in the cached map. Returns the agent handle string (e.g. `"3 - Developer v3.1.2"`) or `null` if the role is not found. Does not trigger discovery.

### `isRegistryLoaded()`

```typescript
function isRegistryLoaded(): boolean;
```

Returns `true` if the registry has been populated by a successful `discoverAgents()` call that resolved at least one agent file with a valid `role:` field. Returns `false` before discovery or after a failed/empty discovery.

### `resetRegistry()`

```typescript
function resetRegistry(): void;
```

Clears the cached agent handle map and resets the loaded flag. **Intended for use in unit tests only.**

---

## Utility Functions

```typescript
// Returns "YYYY-MM-DDTHH:MM:SSZ" using UTC time.
function now(): string;

// Parses legacy and current timestamp formats into Date objects.
// Handles: "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DDTHH:MM:SS", "YYYY-MM-DDTHH:MM:SSZ"
function parseTimestamp(ts: string): Date;

function formatWpId(n: number): string;  // Returns "WP-###" (3+ digits)
function parseWpId(id: string): number;  // Extracts numeric part

// Pure function: computes healed counters and status without I/O.
// Exported from src/tools/project-lifecycle.ts
//
// Healing rules (applied in order):
//  1. IN_PROGRESS or READY + pendingWps === 0 + totalWps > 0:
//       → synthesis_generated ? COMPLETE : (preserve original status)
//  2. COMPLETE + pendingWps > 0:
//       → IN_PROGRESS  (reopen)
//  3. READY + any WP is IN_PROGRESS:
//       → IN_PROGRESS
//  4. BLOCKED + no WP is BLOCKED:
//       a. pendingWps === 0 && totalWps > 0 && synthesis_generated → COMPLETE
//       b. otherwise → IN_PROGRESS (if any WP is IN_PROGRESS), else READY (if any READY)
function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: ProjectStatus;
  needsWrite: boolean;
};

// Returns the absolute path to the central ledger root directory.
// Resolution: 1) --ledger-dir CLI arg, 2) {serverDir}/storage/ledger/
// Exported from src/utils/ledger-root.ts
function resolveLedgerRoot(): string;

// Extracts the project slug (plan folder basename) from an absolute project path.
// Delegates to planFolderBasename(). Exported from src/utils/ledger-root.ts
function projectSlugFromPath(projectPath: string): string;

// Derives the project root from an absolute plan folder path by walking up 4 levels.
// Normalizes backslashes to forward slashes. Pure — no filesystem access.
// Convention: {project-root}/docs/agents/plans/{slug}
// Exported from src/utils/ledger-root.ts
function inferProjectRootFromPlanPath(planPath: string): string;

// Extracts the plan folder basename and validates the YYYY-MM-DD naming convention.
// Throws if the basename does not match. Exported from src/utils/path-validator.ts
function planFolderBasename(projectPath: string): string;
```

---

## Internal Testing Utilities

Tool modules expose internal helpers and constants to unit tests via one of two patterns:

- **`pipeline.ts`**: uses a manual `export const _internal = { ... }` object. Tests import with `import { _internal } from pipeline.js`.
- **Workflow sub-modules**: helpers and constants are exported directly as named exports. Tests use direct named imports from the defining module (e.g. `import { getDeveloperAction } from workflow-next-action.js`). `workflow.ts` re-exports all symbols for backward compatibility, but tests should prefer importing from the defining module.

**These internal exports are not part of the public API — do not call them from production code.**

### `src/tools/pipeline.ts` — routing constants

```typescript
export const _internal: {
  // Live references to routing maps from pipeline-maps.ts.
  // Tests import these to avoid maintaining local copies that could drift.
  PIPELINE_PREREQUISITES: Record<PipelineType, PipelineType | null>;
  PIPELINE_AGENT_MAP: Record<PipelineType, string>;
  NEXT_AGENT_MAP: Record<PipelineType, string>;
  FAIL_ROUTING_MAP: Record<PipelineType, string>;
  // Inverse of PIPELINE_AGENT_MAP. Derived automatically via
  // Object.fromEntries(PIPELINE_TYPES.map((type): [string, PipelineType] => ...))
  // so new pipeline types propagate without manual updates.
  AGENT_PIPELINE_MAP: Record<string, PipelineType>;
};
```

---

## GUI Config Module

### `src/gui/config.ts` — runtime configuration

Manages runtime settings for the MCP server and GUI dashboard. Uses a **module-level singleton cache** populated at startup and kept fresh via `fs.watch()`.

```typescript
// Zod schema and inferred type
export const GuiConfigSchema: ZodObject<...>;
export type GuiConfig = {
  auto_handoff_enabled: boolean;  // When false, buildHandoffResponse() skips auto-handoff
  max_handoff_depth: number;      // Maximum auto-handoff chain depth (default 10)
  ledger_root: string;            // Resolved ledger root path (display-only in GUI)
};

export const DEFAULT_CONFIG: GuiConfig;  // { auto_handoff_enabled: true, max_handoff_depth: 10, ledger_root: '' }

// Returns the current in-memory config. Never reads disk. Synchronous.
export function getConfig(): GuiConfig;

// Reads gui-config.json from disk; self-heals (writes defaults) if missing.
// Updates the in-memory cache. Call once at MCP server startup.
export async function readConfigFromDisk(configPath: string): Promise<GuiConfig>;

// Merges data with current cache, validates, writes atomically, updates cache.
// Throws ZodError on invalid input.
export async function writeConfig(configPath: string, data: Partial<GuiConfig>): Promise<GuiConfig>;

// Starts fs.watch() on configPath with 250ms debounce. On change: re-reads, re-validates, updates cache.
// On error or ENOENT: logs to stderr, retains last known good cache.
export function startConfigWatcher(configPath: string): void;

// Closes the active FSWatcher. Safe to call multiple times (no-op if not watching).
export function stopConfigWatcher(): void;
```

**Config file location:** `{ledgerRoot}/gui-config.json`

**MCP server startup sequence:**
```typescript
// In src/index.ts:
const configPath = path.join(ledgerRoot, 'gui-config.json');
await readConfigFromDisk(configPath);   // populate cache
startConfigWatcher(configPath);          // watch for GUI-driven changes
```

---

## GUI API Module

### `gui/api.ts` — REST API route handlers

Pure async handler functions called by the HTTP server (`gui/server.ts`). All handlers accept parsed parameters and return typed result objects, or throw `ApiError`.

**Path-traversal guards:** two module-private guard functions in `gui/api.ts` protect against path-traversal attacks:

- `assertSafeSlug(slug: string): void` — applied as the **first statement** in all six slug-bearing handlers (`handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument`, `handleGetSynthesisDocument`).
- `assertSafeWpId(wpId: string): void` — applied as the **second statement** in `handleGetWorkPackage`, immediately after `assertSafeSlug`.

Both guards apply identical rejection criteria: throw `ApiError` with code `NOT_FOUND` (HTTP 404) if the value is empty, contains `'/'`, or contains `'..'`. Returning `NOT_FOUND` rather than `FORBIDDEN` is intentional — avoids leaking file-system structural information to potential attackers.

```typescript
// Error type used by all handlers
export class ApiError extends Error {
  code: string;       // 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_ERROR'
  message: string;
  details?: unknown;
}

// Shape returned by GET /api/insights — one entry per project_comment
export interface InsightEntry {
  project_slug: string;          // slug of the source project
  project_status: ProjectStatus; // current status of the source project
  type: string;                  // e.g. 'note' | 'decision' | 'incident'
  priority: 'low' | 'medium' | 'high';
  timestamp: string;             // ISO 8601
  agent: string;                 // agent who added the comment
  note: string;
  context?: IncidentContext;     // present on 'incident' type comments only
}

// GET /api/insights — aggregates all project_comments across every project, sorted by timestamp descending
// Per-project read failures are logged to stderr and skipped gracefully; returns [] when no comments exist.
export async function handleGetInsights(ledgerRoot: string): Promise<InsightEntry[]>;

// Enriched project summary — extends ProjectMeta with WP counters and resolved project name.
// Returned by GET /api/projects. Fields default to 0 / null on per-project read failure so one
// bad project never breaks the full response.
export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;   // from root index; defaults to 0 on read failure
  pending_work_packages: number; // from root index; defaults to 0 on read failure
  project_name: string | null;   // from package.json → composer.json → pyproject.toml; null on failure
}

// GET /api/projects — returns enriched project summaries from the centralized ledger.
// Each entry extends ProjectMeta with WP counters and a resolved project name.
// Per-project enrichment is concurrent (Promise.all); failures per project are isolated.
export async function handleListProjects(ledgerRoot: string): Promise<ProjectSummary[]>;

// GET /api/projects/:slug — returns combined root index + meta
export async function handleGetProject(ledgerRoot: string, slug: string): Promise<ProjectDetail>;

// GET /api/projects/:slug/work-packages — returns WP summary array
export async function handleListWorkPackages(
  ledgerRoot: string,
  slug: string
): Promise<RootIndex['work_packages']>;

// GET /api/projects/:slug/work-packages/:wpId — returns full WP detail
export async function handleGetWorkPackage(
  ledgerRoot: string,
  slug: string,
  wpId: string
): Promise<WorkPackageDetail>;

// DELETE /api/projects/:slug — permanently removes a COMPLETE project; throws FORBIDDEN otherwise
export async function handleDeleteProject(
  ledgerRoot: string,
  slug: string
): Promise<{ deleted: true; slug: string }>;

// GET /api/projects/:slug/plan — returns the archived plan.md content for the project
// Reads from the centralized storage directory (archived copy, not the original planPath).
// Throws NOT_FOUND when the project slug does not exist or when no plan.md has been archived yet.
export async function handleGetPlanDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }>;

// GET /api/projects/:slug/synthesis — returns the archived synthesis.md content for the project
// Reads from the centralized storage directory (archived copy written by ledger_complete_synthesis).
// Throws NOT_FOUND when the project slug does not exist or when no synthesis.md has been archived yet.
export async function handleGetSynthesisDocument(
  ledgerRoot: string,
  slug: string
): Promise<{ content: string }>;

// GET /api/config — returns in-memory config (no disk read)
export async function handleGetConfig(configPath: string): Promise<GuiConfig>;

// PUT /api/config — validates body (strips ledger_root), writes atomically, returns updated config
export async function handleUpdateConfig(configPath: string, body: unknown): Promise<GuiConfig>;
```

**HTTP status code mapping** (implemented in `gui/server.ts`):
| `ApiError.code` | HTTP Status |
|-----------------|-------------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| (unhandled) | 500 |

---

## GUI HTTP Server

### `gui/server.ts` — standalone HTTP server process

A minimal Node.js HTTP server using `node:http` (no external HTTP frameworks). Runs as a **separate process** from the MCP server — has no STDIO restrictions and writes startup/info messages to `stdout`.

**Start:** `npm run gui` (runs `tsx gui/server.ts`)

**CLI arguments:**
- `--port <n>` — listen port (default: `3420`)
- `--ledger-dir <path>` — ledger root path; delegates to `resolveLedgerRoot()` which reads from `process.argv`

**Startup sequence:** parse CLI args → `resolveLedgerRoot()` → `readConfigFromDisk(configPath)` → `startConfigWatcher()` → `createServer()` → `listen(port)`

**API route table:**

| Method | Pattern | Handler |
|--------|---------|--------|
| GET | `/api/projects` | `handleListProjects` |
| GET | `/api/projects/:slug` | `handleGetProject` |
| GET | `/api/projects/:slug/work-packages` | `handleListWorkPackages` |
| GET | `/api/projects/:slug/work-packages/:wpId` | `handleGetWorkPackage` |
| GET | `/api/projects/:slug/plan` | `handleGetPlanDocument` |
| GET | `/api/projects/:slug/synthesis` | `handleGetSynthesisDocument` |
| DELETE | `/api/projects/:slug` | `handleDeleteProject` |
| GET | `/api/config` | `handleGetConfig` |
| PUT | `/api/config` | `handleUpdateConfig` (body parsed inline) |
| GET | `/api/insights` | `handleGetInsights` |

**Static file serving:** requests not starting with `/api/` are served from `gui/public/` (ESM path via `import.meta.url`). `/` → `index.html`. Unknown paths → 404.

**CORS:** all responses include `Access-Control-Allow-Origin: http://localhost:{port}`, `Access-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS`. OPTIONS preflight → 200 OK.

**Error handling:**
- `ApiError` codes map to HTTP status: `NOT_FOUND`→404, `FORBIDDEN`→403, `VALIDATION_ERROR`→400, other→500
- Error response body: `{ "error": { "code": "...", "message": "..." } }`
- `EADDRINUSE` → logs to stderr + `process.exit(1)`

---

## GUI Frontend

### `gui/public/` — static single-page application

Served as static assets by `gui/server.ts`. No ES modules, no framework, no build step.

| File | Purpose |
|------|---------|
| `index.html` | HTML shell — nav (`#/` Projects, `#/insights` Insights, `#/config` Config), `<div id="app">` mount point |
| `styles.css` | CSS custom properties, status badges, tables, cards, forms, loading spinner, error/success banners, comment cards |
| `app.js` | Vanilla JS SPA: `API` client, `Router` (hash-based), utilities + 4 view render functions |

**`styles.css` — Insights comment card classes** (added for the Insights page):

| Class | Role |
|-------|------|
| `.comment-card` | Comment card with 4 px solid left-border accent; combine with a `.priority-*` modifier |
| `.priority-high` | Red left-border accent (`var(--color-priority-high)`) |
| `.priority-medium` | Amber left-border accent (`var(--color-priority-medium)`) |
| `.priority-low` | Grey left-border accent (`var(--color-priority-low)`) |
| `.comment-meta` | Secondary line (agent / type / timestamp) inside a `.comment-card` |
| `.comment-type` | Pill badge — blue-grey background (`var(--color-border)`); used for the comment `type` label |
| `.insights-filters` | Flex filter bar for the Insights page (semantically distinct counterpart to `.filter-bar`) |
| `.comment-body` | Block container for the comment note text inside `.comment-card` (replaces former inline `style="margin-top:6px"`) |
| `.comment-context` | Block container for incident context key/value pairs inside `.comment-card` (replaces former inline style block) |
| `header nav a.active` | Highlights the nav link matching the current hash route (added for Insights nav state) |
| `.progress-bar-track` | Compact horizontal progress track (60×8 px, `overflow:hidden`, `background:var(--color-border)`); used in the project list `% Done` column |
| `.progress-bar-fill` | Fill layer inside `.progress-bar-track`; `height:100%`, `background:var(--color-ready)`, `transition:width 0.2s ease`; width is set inline by `buildTable()` |
| `.filter-bar input[type='text']` | Search input in the project list filter bar; matches `.filter-bar select` visually (same padding, border, border-radius, font-size, background); focus ring mirrors `.form-control:focus` |
| `.plan-content` | Prose container for rendered Markdown in the Plan viewer (`#/projects/:slug/plan`); max-width 800 px; typography for `h1–h4`, `p`, `ul`/`ol`/`li`, `table`/`th`/`td`, `code`, `pre`, `hr`; uses `var(--color-border)` for borders/rules and `var(--radius)` for code/pre |
| `.plan-synopsis` | Synopsis card injected on the Project Detail page when the archived plan has a `## Summary` section; left-border accent using `var(--color-ready)`; max-height 12 rem with `overflow:hidden` (hard cut-off); surface background |
| `.plan-synopsis__content` | Inner content block inside `.plan-synopsis` for the summary text |
| `.plan-synopsis__link` | **View full plan →** link element inside `.plan-synopsis` |
| `.synthesis-content` | Prose container for rendered Markdown in the Synthesis viewer (`#/projects/:slug/synthesis`); shares all typography rules with `.plan-content` via multi-selector CSS (DRY — no duplicated rules) |
| `.synthesis-link-row` | Row wrapper for the **View synthesis →** link on the Project Detail page; `margin-bottom: 16px`; only rendered when `project.synthesis_generated === true` |
| `.synthesis-link` | Pill-style inline link inside `.synthesis-link-row`; styled with `var(--color-primary)` foreground, `var(--color-border)` border, `var(--color-bg-card)` background; hover lightens to `var(--color-bg)` |

> **Resolved (WP-003):** `.priority-high/medium/low` hardcoded hex values have been promoted to `:root` CSS custom properties (`--color-priority-high: #e74c3c`, `--color-priority-medium: #f39c12`, `--color-priority-low: #95a5a6`). The `.comment-type` background was updated from `#e2e8f0` to `var(--color-border)`.

> **Resolved (WP-005):** `.comment-type` hardcoded `color: #475569` replaced with `var(--color-text-muted)`, keeping the full colour palette centralized in `:root`.

> **Known debt (low):** `.insights-filters` duplicates `.filter-bar` layout properties. The Reviewer approved retaining `.insights-filters` as a semantic distinction for now. A future cleanup WP should consolidate them into a single utility class.

**`app.js` structure:**
- **`API`** — async fetch wrappers for all 10 REST endpoints (throws `{ code, message }` on non-2xx); includes `getPlanDocument(slug)` → `GET /api/projects/:slug/plan`; `getSynthesisDocument(slug)` → `GET /api/projects/:slug/synthesis`
- **`Router`** — hash-based dispatch (`#/`, `#/projects/:slug`, `#/projects/:slug/plan`, `#/projects/:slug/synthesis`, `#/projects/:slug/wp/:wpId`, `#/config`, `#/insights`); the `/plan` and `/synthesis` matches are registered before the generic `/:slug` match to prevent prefix collision; manages `setInterval` polling lifecycle; calls `updateNavActive(path)` on every dispatch
- **Utilities**: `escapeHtml()`, `formatDate()`, `statusBadge()`, `showLoading()`, `showError()`, `updateNavActive(path)`, `extractSynopsis(markdown)`
- **`extractSynopsis(markdown)`** — regex-extracts the content of a `## Summary` section from a Markdown string; returns the trimmed text or `null` if the section is absent or empty
- **`renderProjectList(app)`** — project list table with status filter dropdown + fulltext search input (client-side, combined `statusMatch && textMatch`); columns: **Slug** (date prefix stripped; full slug in `title` attribute tooltip), **Project** (`project_name` or `—`), **% Done** (inline `.progress-bar-track` / `.progress-bar-fill` + percentage, or `—` for 0 WPs), **Status**, **Created**, **Updated**, **Actions**; `searchValue` and `filterValue` are closure-scope state that survive the 10-second poll-triggered re-render cycle; `applyFilter()` reads `data-slug` and `data-name` attributes off `<tr>` elements (full slug + raw project name, both lowercased for case-insensitive match); delete button (COMPLETE only, `confirm()` dialog)
- **`renderProjectDetail(app, slug)`** — fetches project and plan document concurrently via `Promise.all`; `getPlanDocument` failure is absorbed (`.catch(() => null)`) so the detail page always renders; if the plan has a `## Summary` section, injects a `.plan-synopsis` card with a **View full plan →** link above the Work Packages table; if `project.synthesis_generated === true`, renders a `.synthesis-link-row` with a **View synthesis →** link (driven by the flag alone — no extra HTTP call); project header + WP summary table (clickable rows) + Project Comments section (sorted newest-first; each card shows agent, `.comment-type` badge, priority left-border accent, timestamp, and note; incident entries render `context` key/value pairs in a `.comment-context` sub-section; renders 'No comments yet.' when `project_comments` is empty)
- **`renderPlan(app, slug)`** — renders the archived plan as formatted HTML using `marked.parse()`; breadcrumb links to `#/projects` and `#/projects/:slug`; shows 'Plan document not available for this project.' when the API returns NOT_FOUND; generic error banner for other failures
- **`renderSynthesis(app, slug)`** — renders the archived synthesis document as formatted HTML using `marked.parse()`; breadcrumb links to `#/projects` and `#/projects/:slug`; shows 'Synthesis document not available for this project.' when the API returns NOT_FOUND; generic error banner for other failures
- **`renderWorkPackageDetail(app, slug, wpId)`** — AC list (met/unmet), pipeline history, handoff notes
- **`renderConfig(app)`** — form pre-populated from `GET /api/config`; save sends only `auto_handoff_enabled` + `max_handoff_depth` (ledger_root is readonly)
- **`renderInsights(app)`** — Insights page; calls `GET /api/insights`, builds dynamic type/priority/project filter selects, renders one `.comment-card` per entry with `.priority-{level}` accent, incident context in `.comment-context`, 'No insights found.' empty state, in-memory re-filtering on select change, auto-refresh every 15 s

**XSS protection:** `escapeHtml()` wraps every piece of user-supplied data interpolated into HTML strings (20+ call sites).

---

### `src/utils/workflow-helpers.ts` — shared constants and pure helpers

Exported from `src/utils/workflow-helpers.ts`. Consumed by all three workflow tool sub-modules and re-exported via `workflow.ts`.

```typescript
export const STALE_PIPELINE_HOURS: number; // default 24

// Returns the current max auto-handoff chain depth from the in-memory GUI config cache.
// Falls back to 10 if the config module has not yet been initialized.
export function getMaxHandoffDepth(): number;

// Returns true ONLY if the most recent pipeline of pipelineType has FAIL status.
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean;

// Returns true if a pipeline is IN_PROGRESS and was started more than 24 hours ago.
export function isStalePipeline(pipeline: Pipeline): boolean;

// Returns true if any dependency WP is not COMPLETE.
export function isBlockedByDependencies(wp: WorkPackageDetail, allWps: WorkPackageDetail[]): boolean;

// Returns true if the WP has a dependency blocker recorded.
export function hasDependencyBlocked(wp: WorkPackageDetail): boolean;

// Returns true if the most recent upstream PASS pipeline completed_at is AFTER the most recent
// downstream pipeline's started_at. Handles first-run (no downstream → true), up-to-date
// (downstream started after upstream → false), and rework re-engagement (upstream PASS
// post-dates downstream start → true). Uses strict > so same-second timestamps → false.
export function hasNewUpstreamPassSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  downstreamType: PipelineType
): boolean;

export function extractStalePipelineAction(wps: WorkPackageDetail[]): ActionResult | null;
export function extractReworkAction(wps: WorkPackageDetail[]): ActionResult | null;

// Returns the handoff notes in the WP addressed to agentName, or undefined if none.
export function getHandoffNotesForAgent(wpDetail: WorkPackageDetail, agentName: string): string[] | undefined;

// Returns the prompt string passed to the next agent during auto-handoff.
export function buildHandoffPrompt(projectPath: string): string;

// Display name maps used by workflow tool responses.
export const agentNameMap: Record<string, string>;
export const actionNameMap: Record<string, string>;
export const reworkActionMap: Record<string, string>;
export const pipelineAgentRoleMap: Record<string, string>;
```

### `src/tools/workflow-next-action.ts` — ledger_get_next_action internals

```typescript
// Developer-specific next-action computation (used inside ledger_get_next_action).
export function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore): Promise<ActionResult>;

// QA-specific next-action computation. Uses hasNewUpstreamPassSince() to detect
// rework re-engagement after a Developer rework cycle. BLOCKED WPs are excluded.
export function getQaAction(rootIndex: RootIndex, store: LedgerStore): Promise<ActionResult>;

// Reviewer-specific next-action computation. Uses hasNewUpstreamPassSince() to detect
// rework re-engagement after QA re-passes. BLOCKED WPs are excluded.
export function getReviewerAction(rootIndex: RootIndex, store: LedgerStore): Promise<ActionResult>;

// Documentation-specific next-action computation. Uses hasNewUpstreamPassSince() to detect
// rework re-engagement after Reviewer re-passes. BLOCKED WPs are excluded.
export function getDocumentationAction(rootIndex: RootIndex, store: LedgerStore): Promise<ActionResult>;
```

### `src/tools/workflow-handoff.ts` — ledger_get_handoff_status internals

```typescript
// Handoff computation functions (one per agent role)
// getPlannerHandoff: returns READY_FOR_PM when no WPs exist (signals PM to begin task decomposition).
export function getPlannerHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
export function getDeveloperHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
export function getQaHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
export function getReviewerHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
export function getDocumentationHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
export function getProjectManagerHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;

// Maps a workflow status string and currentAgent to the next agent role name.
// Returns null for any terminal status (COMPLETE or CANCELLED) via isTerminalStatus(),
// returns currentAgent for IN_PROGRESS, and looks up the next agent role for all other statuses.
// Known READY_FOR_* mappings include: READY_FOR_PM → 'Project Manager', READY_FOR_DEVELOPER,
// READY_FOR_QA, READY_FOR_REVIEW (→ 'Reviewer'), READY_FOR_SYNTHESIS (→ 'Synthesis').
export function nextAgentFromStatus(status: string, currentAgent: string): string | null;

// Builds the standard handoff response payload (current_agent, next_agent, status).
export function buildHandoffResponse(
  currentAgent: string,
  status: string,
  details: string,
  nextAction?: string,
  projectPath?: string,
  store?: LedgerStore
): Promise<Record<string, unknown>>;
```

### `src/tools/workflow.ts` — backward-compat aggregator

Re-exports all public symbols from the three sub-modules and from `workflow-helpers.ts` so that any code (or old imports) targeting `workflow.js` continues to compile. Also re-exports `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`, and `FAIL_ROUTING_MAP` from `pipeline-maps.ts`.

**`isMostRecentPipelineFail` semantics:**

| Pipeline history | Returns |
|---|---|
| `[]` (empty) | `false` |
| `[FAIL]` | `true` |
| `[PASS]` | `false` |
| `[FAIL, PASS]` | `false` (most recent is PASS — no REWORK) |
| `[PASS, FAIL]` | `true` (most recent is FAIL — REWORK needed) |
| Wrong type (no match) | `false` |

---

## MCP Server Registration

Each tool module exports:

```typescript
function register(server: McpServer): void;
```

These are called in `src/index.ts` to register all tools on the server instance.
