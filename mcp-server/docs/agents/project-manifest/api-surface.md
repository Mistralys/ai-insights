# Public API Surface

This document lists **public constructors, properties, and method signatures** for all exported classes, functions, and types. Implementation details are omitted.

---

## MCP Tools (17 Total)

The primary public API is the set of **MCP tools** registered by the server. Agents invoke these tools via the MCP protocol.

### Project Lifecycle Tools

#### `ledger_get_project_status`

```typescript
(args: { project_path: string }) => Promise<MCPResult>
```

Reads the root index and returns project overview. Includes self-healing logic that recomputes counters from actual work package data.

#### `ledger_initialize_project`

```typescript
(args: { 
  project_path: string; 
  plan_file: string 
}) => Promise<MCPResult>
```

Creates a new project ledger with root index and `ledger/` subdirectory. Rejects if ledger already exists.

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
  acceptance_criteria: string[];
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
}) => Promise<MCPResult>
```

Claims a `READY` work package by transitioning to `IN_PROGRESS`. Validates dependencies are met.

#### `ledger_update_work_package_status`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  agent: string;
  blocked_by?: {
    type: 'dependency' | 'decision' | 'external' | 'technical';
    description: string;
    blocking_work_package?: string;
  };
}) => Promise<MCPResult>
```

Updates work package status with validation. Enforces legal status transitions and special rules (e.g., `COMPLETE` requires all acceptance criteria met). The `agent` field is required because the server checks which persona is attempting the transition (e.g., only the Documentation Agent can mark a work package `COMPLETE`).

---

### Pipeline Tools

#### `ledger_start_pipeline`

```typescript
(args: { 
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
}) => Promise<MCPResult>
```

Starts a new pipeline for a work package. The `type` field is validated by a Zod enum — invalid values are rejected at the MCP layer. Validates WP is `IN_PROGRESS` and no duplicate in-progress pipeline exists.

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

Completes the most recent `IN_PROGRESS` pipeline of the specified type. If `handoff_notes` is provided, a structured `HandoffNote` entry is appended to the work package, addressed to the next agent in the pipeline chain (determined by `NEXT_AGENT_MAP`). Sets status, completion timestamp, summary, and optional fields.

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
1. The agent registry is loaded (`isRegistryLoaded()` returns `true`)
2. The next agent has a known handle in the registry
3. Project status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
4. `auto_handoff_depth` in the root index is `< MAX_HANDOFF_DEPTH` (10)

Each successful emission increments `auto_handoff_depth` in the root index. Reaching `COMPLETE` status resets the counter to `0`.

---

## Storage API

### `LedgerStore`

Central storage abstraction for ledger file I/O.

```typescript
class LedgerStore {
  constructor(projectPath: string);

  // Existence checks
  rootIndexExists(): Promise<boolean>;
  wpDetailExists(wpId: string): Promise<boolean>;
  ledgerDirExists(): Promise<boolean>;

  // Read operations (validated with Zod)
  readRootIndex(): Promise<RootIndex>;
  readWorkPackage(wpId: string): Promise<WorkPackageDetail>;

  // Write operations (validated before writing)
  writeRootIndex(data: RootIndex): Promise<void>;
  writeWorkPackage(wpId: string, data: WorkPackageDetail): Promise<void>;

  // Dual-file atomic update
  updateWorkPackageWithSync(
    wpId: string,
    updater: (wp: WorkPackageDetail, root: RootIndex) => 
      { wp: WorkPackageDetail; root: RootIndex } | 
      Promise<{ wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<void>;
}
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
function withLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T>;
```

Acquires a file lock on the project's ledger directory, executes the callback, and releases the lock in a `finally` block. Lock file created at `{projectPath}/.ledger.lock`.

---

## Schema Types

All types are inferred from Zod schemas using `z.infer<typeof Schema>`.

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
// Canonical array of valid agent role names. Consumers should import from here
// rather than defining local copies to avoid silent drift.
const AGENT_ROLES: readonly [
  'Planner', 'Project Manager', 'Developer',
  'QA', 'Reviewer', 'Documentation', 'Synthesis'
];

// String-literal union type derived from AGENT_ROLES.
type AgentRole = typeof AGENT_ROLES[number];
```

**Importers:**
- `src/tools/workflow.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/utils/agent-registry.ts` — imports `AGENT_ROLES` from `'./constants.js'`

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
// Returns "YYYY-MM-DDTHH:MM:SS" using local time.
// NOTE: toISOString() is intentionally NOT used — it converts to UTC, which would
// corrupt timestamps for users in non-UTC timezones. This manual construction is
// deliberate. Do not replace with toISOString().
function now(): string;

function formatWpId(n: number): string;  // Returns "WP-###"
function parseWpId(id: string): number;  // Extracts numeric part
```

---

## Internal Testing Utilities

Two tool modules export a `_internal` object to give unit tests white-box access to constants and pure helper functions. **These are not part of the public API — do not call them from production code.** The underscore prefix is a deliberate signal of this convention.

### `src/tools/pipeline.ts` — routing constants

```typescript
export const _internal: {
  // Live references to routing maps from pipeline-maps.ts.
  // Tests import these to avoid maintaining local copies that could drift.
  PIPELINE_PREREQUISITES: Record<PipelineType, PipelineType | null>;
  PIPELINE_AGENT_MAP: Record<PipelineType, string>;
  NEXT_AGENT_MAP: Record<PipelineType, string>;
};
```

### `src/tools/workflow.ts` — helper functions and routing constants

```typescript
export const _internal: {
  // Returns true ONLY if the most recent pipeline of pipelineType has FAIL status.
  // A [FAIL, PASS] sequence correctly returns false — only an unrecovered FAIL
  // (i.e., the most recent pipeline for that type is still FAIL) triggers REWORK.
  isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean;

  // Returns true if a pipeline is IN_PROGRESS and was started more than 24 hours ago.
  isStalePipeline(pipeline: Pipeline): boolean;

  // Handoff computation functions (one per agent role)
  getDeveloperHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
  getQaHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
  getReviewerHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
  getDocumentationHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;
  getProjectManagerHandoff(wps: WorkPackageDetail[], root: RootIndex): HandoffResult;

  // Developer-specific next-action computation (used inside ledger_get_next_action).
  getDeveloperAction(rootIndex: RootIndex, store: LedgerStore): Promise<ActionResult>;

  STALE_PIPELINE_HOURS: number; // default 24

  // Returns the handoff notes in the WP addressed to agentName, or undefined if none.
  getHandoffNotesForAgent(wpDetail: WorkPackageDetail, agentName: string): string[] | undefined;

  extractStalePipelineAction(wps: WorkPackageDetail[]): ActionResult | null;
  extractReworkAction(wps: WorkPackageDetail[]): ActionResult | null;

  // Routing constants re-exported from pipeline-maps.ts for workflow-handoff tests.
  PIPELINE_AGENT_MAP: Record<PipelineType, string>;
  NEXT_AGENT_MAP: Record<PipelineType, string>;

  // Maps a workflow status string and currentAgent to the next agent role name.
  // Returns currentAgent for IN_PROGRESS, null for COMPLETE, and the target
  // role for all READY_FOR_* and BLOCKED statuses.
  nextAgentFromStatus(status: string, currentAgent: string): string | null;

  // Builds the standard handoff response payload (current_agent, next_agent, status).
  // When projectPath and store are provided, also appends auto_handoff when
  // all eligibility conditions are met (see ledger_get_handoff_status).
  buildHandoffResponse(
    currentAgent: string,
    status: string,
    details: string,
    nextAction?: string,
    projectPath?: string,
    store?: LedgerStore
  ): Promise<Record<string, unknown>>;

  // Returns the prompt string passed to the next agent during auto-handoff.
  // Output format: "Project path: <projectPath>"
  // Intentionally minimal — the receiving agent's persona file contains full workflow instructions.
  buildHandoffPrompt(projectPath: string): string;

  // Maximum number of consecutive automatic handoffs before falling back to manual routing.
  // Value: 10. Stored as auto_handoff_depth in the root index.
  MAX_HANDOFF_DEPTH: number;
};
```

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
