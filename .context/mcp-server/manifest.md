# MCP Server - Manifest
_SOURCE: Public Interfaces and APIs_
# Public Interfaces and APIs
```
// Structure of documents
└── mcp-server/
    └── docs/
        └── agents/
            └── project-manifest/
                └── README.md
                └── api-surface.md
                └── constraints.md
                └── data-flows.md
                └── file-tree.md
                └── tech-stack.md

```
###  Path: `/mcp-server/docs/agents/project-manifest/README.md`

```md
# Project Manifest: Project Ledger MCP Server

**Version:** 1.0.0  
**Last Updated:** 2026-02-16  
**Purpose:** MCP server for Project Ledger workflow coordination

---

## Overview

The **Project Ledger MCP Server** is a TypeScript-based Model Context Protocol (MCP) server that provides typed tools for managing project ledgers in AI agent workflows. It eliminates dual-file desync bugs by wrapping ledger operations with validation, atomicity, and consistency guarantees.

The server manages two types of JSON files:
- **Root Index** (`.ledger/project-ledger.json`): Project-level metadata and work package summaries
- **Work Package Details** (`.ledger/WP-###.json`): Per-work-package implementation details, pipelines, and acceptance criteria

---

## Manifest Sections

| Section | Description |
|---------|-------------|
| [Tech Stack & Patterns](tech-stack.md) | Runtime, frameworks, libraries, and architectural patterns |
| [File Tree](file-tree.md) | Visual directory structure with annotations |
| [Public API Surface](api-surface.md) | MCP tools, classes, types, and public methods |
| [Key Data Flows](data-flows.md) | Main interaction paths through the system |
| [Constraints & Conventions](constraints.md) | Established rules, conventions, and gotchas |

---

## Usage Context

This server is designed to be invoked via the MCP protocol over STDIO transport. It is used by AI agents following a 9-stage workflow (Planner, Project Manager, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis) to maintain consistency across multi-agent sessions.

---

## Development Commands

**Version Management:**
```bash
npm run sync-version   # Sync version from changelog.md to package.json
```

**Development:**
```bash
npm run dev           # Run server (auto-syncs version via predev hook)
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
```

**Important:** The version in `changelog.md` is the **source of truth**. When releasing a new version:
1. Update `changelog.md` first (add new version header at top)
2. Run `npm run sync-version` to update `package.json`
3. The MCP server displays its version at startup: `[project-ledger-mcp] Server v1.21.1 started successfully`

See [constraints.md](constraints.md#development--build-constraints) for more details.

---

## Related Documentation

- **Ledger Schema:** `/personas/ledger/project-ledger-schema.md`
- **Workflow Plans:** `/docs/agents/plans/`
- **Agent Personas:** `/personas/ledger/`

```
###  Path: `/mcp-server/docs/agents/project-manifest/api-surface.md`

```md
﻿# Public API Surface

This document lists **public constructors, properties, and method signatures** for all exported classes, functions, and types. Implementation details are omitted.

---

## MCP Tools (22 Total)

The primary public API is the set of **MCP tools** registered by the server. Agents invoke these tools via the MCP protocol.

### Project Lifecycle Tools

#### `ledger_get_project_status`

```typescript
(args: { project_path?: string; cwd_path?: string }) => Promise<MCPResult>
// Note: provide cwd_path (workspace root, preferred — auto-detects project) or project_path (fallback — use only if already known).
```

Reads the root index and returns project overview. Includes self-healing logic (`computeHealedStatus`) that recomputes counters and status from actual work package data. Self-healing separates computation (pure function) from persistence (conditional write under lock). No disk write occurs if counters and status are already correct.

When a write is triggered, the write callback calls `clearSynthesisState(fresh)` if `corruptionDetected` is true (i.e. synthesis was flagged prematurely while pending WPs still exist). `validatePipelineOrdering` runs outside the lock (it only reads WP detail files) and its warnings are applied inside the consolidated lock scope along with all other repairs.

**Legacy field repair (self-healing on read):** In addition to status and counter healing, `getProjectStatus` performs two legacy-field repair passes on every call:

1. **`synthesis_generated_at` backfill:** If `synthesis_generated === true` and `synthesis_generated_at` is absent or `null` and `corruptionDetected` is `false`, the field is backfilled to `root.last_updated` (best-approximation for pre-WP-005 ledgers). A single soft warning project comment (`type: 'warning'`, `priority: 'low'`, `agent: 'system'`) is emitted. Deduplication: the comment is only written if no identical note already exists (idempotent on repeated reads).

2. **`ledger_version` backfill:** If `ledger_version` is absent, it is silently set to `SPEC_VERSION`. No comment is emitted — absence implies the ledger pre-dates versioning.

3. **Forward-compatibility warning:** If `ledger_version` is present and its numeric major/minor/patch is strictly greater than `SPEC_VERSION`, a warning project comment is emitted — the server software may be older than the ledger it is reading. Deduplicated by note text.

All repairs, the forward-compat check, pipeline ordering warnings, and the synthesis timestamp repair comment are consolidated into a single `withLock` scope. The pre-lock computation identifies which repairs are needed; inside the lock, each condition is re-checked against a fresh re-read (TOCTOU symmetry) and only applied if still true. This reduces lock acquisitions from 3 to 1 when multiple repairs fire simultaneously.

The response JSON also includes a `pipeline_health` sub-object computed by reading all WP detail files:

```typescript
pipeline_health: {
  wps_with_all_stages_pass: number;  // non-CANCELLED WPs with all active stages passing (uses wp.active_pipeline_stages.length ?? DEFAULT_PIPELINE_STAGES.length)
  wps_missing_stages: number;        // non-CANCELLED WPs with at least one stage missing
  total_stages_missing: number;      // sum of missing stage counts across all wps_missing_stages WPs
}
```

`CANCELLED` WPs are excluded from both `wps_with_all_stages_pass` and `wps_missing_stages`. Unreadable WP detail files are silently skipped — they contribute nothing to any count. This is a non-breaking additive field; consumers that do not expect it can ignore it.

#### `ledger_initialize_project`

```typescript
(args: { 
  project_path: string; 
  plan_file: string  // must equal 'plan.md' — enforced by Zod .refine()
}) => Promise<MCPResult>
```

Creates a new project ledger with root index and centralized storage directory. Sets `ledger_version: SPEC_VERSION` on the root index at construction time. Rejects if ledger already exists. After writing the root index and project meta, copies `plan_file` into the centralized storage directory (best-effort). Response payload includes `archived_documents: string[]`, conditionally `archive_skipped: string[]` (omitted when empty), and `enrichment_cached: boolean` — `true` when step 5 meta enrichment (resolving project_name / repository_name) succeeded, `false` when it failed non-fatally. Enrichment failure is logged to stderr; the project is still created successfully.

**`plan_file` constraint:** the `plan_file` argument is validated at parse time by a Zod `.refine()` check (`v === PLAN_ARCHIVE_FILENAME`). Any value other than `'plan.md'` is rejected with a validation error before handler logic runs. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on a fixed archive filename.

#### `ledger_list_projects`

```typescript
(args: {
  status?: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'ARCHIVED';
  include_archived?: boolean;  // default: false
}) => Promise<MCPResult>
```

Scans the central ledger root directory and returns metadata for all projects. Optionally filters by status. Projects with missing or invalid `.meta.json` are silently skipped.

**ARCHIVED exclusion (default behavior):** When `include_archived` is `false` (the default), ARCHIVED projects are excluded from results unless an explicit `status: 'ARCHIVED'` filter is set. An explicit `status` filter always takes precedence — so `{ status: 'ARCHIVED' }` returns only archived projects regardless of `include_archived`. Pass `include_archived: true` to include archived projects alongside non-archived ones in an unfiltered listing.

#### `ledger_complete_synthesis`

```typescript
(args: {
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  agent_role: string;
  synthesis_file?: string;  // default: 'synthesis.md'
}) => Promise<MCPResult>
```

Marks synthesis as generated on the root index. Sets `synthesis_generated = true` and `synthesis_generated_at = now()` (using the same timestamp for both the root index write and the response JSON), resets `auto_handoff_depth` to `0` (per §18.4), and transitions the project to `COMPLETE`. All writes are performed atomically within a single `withLock` callback. Called by the Synthesis agent (or Project Manager) after generating the final report. Copies `synthesis_file` into the centralized storage directory inside the lock scope (best-effort). Response payload includes `archived_documents: string[]` and, conditionally, `archive_skipped: string[]` (omitted when empty).

**Required:** `agent_role` must be `"Synthesis"` or `"Project Manager"` — other roles receive an error.

**§19.1 guards** (evaluated in order inside the lock):
1. **Agent role guard** — rejects callers that are not `"Synthesis"` or `"Project Manager"`.
2. **Fresh counter computation** — recomputes `totalWps` and `pendingWps` from the actual `work_packages` array (ignores stale `pending_work_packages` counter).
3. **At-least-one-WP guard** — rejects calls on projects with no work packages.
4. **Pending-WP guard** — rejects calls when `pendingWps > 0` (uses freshly computed value).

All guards must pass before `synthesis_generated` is set. Not idempotent with respect to guard failures — a call with a pending WP or wrong role will return an error.

#### `ledger_detect_project`

```typescript
(args: { cwd_path: string }) => Promise<MCPResult>
```

Identifies the active project by cross-referencing the supplied working-directory path against all project roots stored in the centralized ledger. Returns `{ plan_path, slug, title?, status }` for the unique matching project.

**Error cases:**
- **`NOT_FOUND`** — no known project root is an ancestor of `cwd_path`. Returned when `cwd_path` is not inside any initialized project's codebase.
- **`AMBIGUOUS`** — more than one project root is an ancestor of `cwd_path`. The error message lists all matching `plan_path` values. Pass an explicit `project_path` to the tool requiring it to disambiguate.

Note: `cwd_path` must be a directory path, not a file path. The tool does NOT require `project_path` as a parameter — that is the primary purpose of this tool.

All tools (except `ledger_initialize_project`) now accept `cwd_path` directly — passing `cwd_path` to any tool triggers automatic project detection without needing a separate `ledger_detect_project` call. This tool remains available for standalone project detection when needed.

---

### Work Package Tools

#### `ledger_get_work_package`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string // WP-### format
}) => Promise<MCPResult>
```

Reads and returns the full work package detail.

#### `ledger_list_work_packages`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  status?: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  assigned_to?: string;
}) => Promise<MCPResult>
```

Lists work package summaries from the root index with optional filters.

#### `ledger_create_work_package`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  assigned_to: string;      // Accepted silently but IGNORED — WP always starts with assigned_to: null
  dependencies: string[]; // Array of WP IDs
  acceptance_criteria: string[]; // min(1) — at least one criterion required; empty strings and whitespace-only strings rejected
  work_package_file: string;
  active_pipeline_stages?: PipelineType[]; // optional — defaults to DEFAULT_PIPELINE_STAGES when omitted
}) => Promise<MCPResult>
```

Creates a new work package with auto-generated WP ID. Creates both detail file and root index summary atomically.

- `assigned_to` in the input is **accepted but ignored** — the WP and root index summary always start with `assigned_to: null` (soft-deprecation §9b.1).
- **Initial status** is `READY` if all dependencies are terminal (`COMPLETE` or `CANCELLED`), or `BLOCKED` otherwise.
- **`blocked_by` auto-assignment:** When initial status is `BLOCKED`, `blocked_by` is automatically populated with `{ type: 'dependency', description: '...', blocking_work_package: '<first unmet dep>' }`.
- **Cycle detection:** `hasCycle()` (BFS) is called before creation. If the new WP's dependency chain would form a cycle, the call is rejected with `'Dependency cycle detected: WP X would create a circular dependency.'`
- **Acceptance criteria validation:** Each criterion string is validated — empty strings and whitespace-only strings are rejected.
- **`active_pipeline_stages`:** Optional array of pipeline types that defines which stages this WP will execute. When omitted, defaults to `DEFAULT_PIPELINE_STAGES` (`['implementation', 'qa', 'code-review', 'documentation']`) for backward compatibility. Stored on both the WP detail file and the root index summary entry (`WorkPackageSummary.active_pipeline_stages`) as `PipelineType[]`. Summary and detail are guaranteed in sync at creation time by construction (same `resolvedActiveStages` value is written to both).
  - **Hard guardrails (reject with error):** empty array; entries that are not valid `PIPELINE_TYPES`; duplicate entries; entries that are not a subsequence of `CANONICAL_PIPELINE_ORDERING`.
  - **Soft guardrails (warning appended to success message):** `implementation` present without `qa`; single-stage chain.
  - Example: `active_pipeline_stages: ['implementation', 'qa', 'code-review']` — skips the documentation stage.

#### `ledger_claim_work_package`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  agent: string;
  override?: boolean;
}) => Promise<MCPResult>
```

Claims a `READY` work package by transitioning to `IN_PROGRESS`. Validates dependencies are met. **Rejects claims when the WP is assigned to a different agent** unless `override: true` is passed. `override: true` is itself restricted to the `"Project Manager"` or the current `wp.assigned_to` — any other caller using it receives a hard rejection (see constraint 14).

**Role guard (CLAIMABLE_ROLES):** The `agent` field must map to a claimable role. Non-claimable roles — specifically `Planner` and `Synthesis` (and their Agent aliases) — are rejected with an actionable error listing the valid roles. This guard fires at step 1b, **before** the assignment check and override-auth guard, so a non-claimable role always receives the role error regardless of the WP's `assigned_to` field or whether `override: true` is passed.

**`status_changed_at`** is set on the WP on successful claim.

#### `ledger_update_work_package_status`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
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
- `READY → IN_PROGRESS`: **redirected** — use `ledger_claim_work_package` instead. This transition is rejected with an actionable error pointing to the correct tool.
- `BLOCKED → BLOCKED`: **replaces the blocker.** Only the `"Project Manager"` or the current `assigned_to` agent may replace a blocker. Changing a `'dependency'`-type blocker to a non-dependency type (or vice versa) is rejected. `status_changed_at` is updated and root `last_updated` is set; the WP status remains `BLOCKED`.
- `IN_PROGRESS → COMPLETE`: requires all acceptance criteria met; only `"Documentation"` (or `"Documentation Agent"`). **Freshness check:** rejects if the most recent non-auto-cancelled `documentation` pipeline PASS pre-dates the most recent `implementation` pipeline start (stale doc PASS).
- `IN_PROGRESS → READY`: clears `assigned_to` in both WP detail and root index summary; **rejects if any pipeline is currently `IN_PROGRESS`** (all active pipelines must be completed or cancelled first). (Unclaim path, spec §21.13)
- `IN_PROGRESS → BLOCKED`: **auto-cancels all currently `IN_PROGRESS` pipelines** (sets `auto_cancelled: true` on each).
- `IN_PROGRESS → CANCELLED`: **auto-cancels all currently `IN_PROGRESS` pipelines.**
- `COMPLETE → IN_PROGRESS`: only `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`) — triggers `revision` increment, `pending_work_packages` increment, cascade-reblock of non-COMPLETE, non-BLOCKED dependents, and **resets `rework_counts` to `{}` and clears `root.synthesis_generated`** (see `propagateDependencyReblock`).
- `→ CANCELLED`: only `"Project Manager"` (or `"Project Manager Agent"`). CANCELLED is terminal — no outward transitions. Valid from READY, IN_PROGRESS, BLOCKED, or COMPLETE. Decrements `pending_work_packages` and triggers `propagateDependencyUnblock` (CANCELLED satisfies dependencies like COMPLETE).
- `BLOCKED → IN_PROGRESS` / `BLOCKED → READY`: both automatically clear the `blocked_by` field.
- **`status_changed_at`** is set on every successful transition, including `BLOCKED → BLOCKED` blocker replacements.

The `agent` field is required because the server checks which persona is attempting the transition.

#### `ledger_reset_rework_count`

```typescript
(args: {
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string; // WP-### format
  pipeline_type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  agent_role: string;  // Must be "Project Manager"
  reason: string;      // Non-empty, non-whitespace; stored in audit trail
}) => Promise<MCPResult>
```

**PM-only tool (§16.3b).** Resets the `rework_counts[pipeline_type]` counter on the specified work package to `0`. Records an audit project comment with `type: 'rework_reset'` and `priority: 'high'` on the root index.

- **No-op guard:** If the counter is already `0` or absent, the tool returns a no-op message — no file is written.
- **Reason required:** `reason` must be a non-empty, non-whitespace string; enforced entirely by the Zod schema (`.trim().min(1)`) — whitespace-only strings are trimmed then rejected before reaching the handler.
- **Audit trail:** On reset, appends `{ type: 'rework_reset', priority: 'high', agent: 'Project Manager', note: 'Reset rework count for <type> on <WP-###> from <N> to 0. Reason: <reason>' }` to `root.project_comments`.
- **Use case:** Allows the PM to unblock a WP that has hit the rework circuit breaker (`rework_counts[type] >= MAX_REWORK_COUNT`).

#### `ledger_update_acceptance_criteria`

```typescript
(args: {
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string; // WP-### format
  agent_role: string;      // Must be "Project Manager"
  operations: Array<
    | { action: 'remove';      criterion: string }                          // exact text match
    | { action: 'modify_text'; old_criterion: string; new_criterion: string } // exact old text; new must be non-empty
  >;  // min 1 operation
}) => Promise<MCPResult>
```

**PM-only tool (§12.3b).** Applies a sequence of acceptance criteria mutations to the specified work package. Operations are applied sequentially on a cloned array; the cloned array is committed atomically on success.

- **Supported operations:**
  - `remove` — removes the first criterion whose `criterion` field exactly matches `criterion`. Throws if not found.
  - `modify_text` — replaces the `criterion` text of the first match for `old_criterion` with `new_criterion`. Preserves the existing `met` value (only the text changes, not the evaluation state). Throws if not found or if `new_criterion` is empty/whitespace.
- **Guards:**
  - Rejects `CANCELLED` work packages.
  - Rejects any operation batch that would leave zero criteria after all operations are applied.
  - Rejects non-PM callers (guard fires before acquiring the file lock).
  - Each `new_criterion` string must be non-empty and non-whitespace.

---

### Pipeline Tools

#### `ledger_begin_work`

```typescript
(args: {
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Security Auditor' | 'Reviewer' | 'Release Engineer' | 'Documentation' | 'Synthesis';
}) => Promise<MCPResult & { claimed: boolean }>
```

**Convenience wrapper that replaces the `ledger_claim_work_package` + `ledger_start_pipeline` two-step sequence.** Operates entirely within a single `withLock` scope.

**Claim phase (WP is `READY`):** Applies the same CLAIMABLE_ROLES guard, assignment guard, dependency completeness check, and `READY → IN_PROGRESS` status transition as `ledger_claim_work_package`. On success, `claimed: true` is returned.

**Cross-agent handoff (WP is already `IN_PROGRESS`):** Skips the claim phase and proceeds directly to the pipeline start phase when either (a) `assigned_to` matches `agent_role` (idempotent re-entry) OR (b) `agent_role` is the legitimate pipeline-type owner per `PIPELINE_AGENT_MAP` (e.g., Documentation agent starting a `documentation` pipeline on a Reviewer-assigned WP). `claimed: false` is returned in both cases. This mirrors the spec (§9.1, §16.5), which designates `assigned_to` as a trailing bookkeeping field updated by the pipeline-start phase — not a security gate.

**Other statuses (`COMPLETE`, `BLOCKED`, etc.):** Rejected with a descriptive error.

**Pipeline start phase:** Applies the same pipeline ordering, duplicate IN_PROGRESS rejection, rework detection, circuit breaker, revalidation guard, and `agent_role` ownership validation as `ledger_start_pipeline`. A `[PM Override]` marker is added when `agent_role: 'Project Manager'`.

**Response:** Same shape as `ledger_start_pipeline` (updated WP detail + pipelines) with an additional `claimed: boolean` field.

#### `ledger_start_pipeline`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  agent_role: string; // required — see mapping below
}) => Promise<MCPResult>
```

Starts a new pipeline for a work package. The `type` field is validated by `PipelineTypeEnum` (a Zod enum derived from `PIPELINE_TYPES`) — invalid values are rejected at the MCP layer. Validates WP is `IN_PROGRESS` and no duplicate in-progress pipeline exists.

**`agent_role` is required (§52).** Must match the pipeline type’s owner role per `PIPELINE_AGENT_MAP`: `"Developer"` for `implementation`, `"QA"` for `qa`, `"Reviewer"` for `code-review`, `"Documentation"` for `documentation`. **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type and adds a `[PM Override]` marker to the pipeline summary.

**Pipeline ordering (§8.2):** Enforces `implementation` → `qa` → `code-review` → `documentation` order (legacy 4-stage default). Dynamic ordering via per-WP `active_pipeline_stages` is supported. Checks the **most recent** prerequisite pipeline entry via `.at(-1)` — a historical PASS followed by a subsequent FAIL is treated as unmet. Returns a descriptive error if the prerequisite is absent or not PASS.

**Rework detection:** A rework is detected when either (a) the most recent same-type completed pipeline has `FAIL` status (**direct rework**) or (b) a prerequisite pipeline type was reworked after the last PASS of the current type (**downstream rework**). Auto-cancelled pipelines (`.auto_cancelled === true`) are excluded from rework detection in both cases. When rework is detected, `rework_counts[type]` is incremented.

**Rework circuit breaker:** The effective count is `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), the call is rejected with an error guiding the caller to cancel or restructure the WP.

**Revalidation guard:** After rework detection, `checkRevalidationGuard()` is called. If a prior PASS of the prerequisite pipeline has become stale relative to upstream rework, the guard fires and rejects the start with a descriptive explanation.

#### `ledger_complete_pipeline`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  agent_role: string; // required — see mapping below
  status: 'PASS' | 'FAIL';
  summary: string | string[]; // single string or array — coerced to array server-side
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
    timestamp?: string; // optional — auto-filled with server time if omitted
    note: string;
  }>;
  acceptance_criteria_updates?: Array<{
    criterion: string;
    met: boolean;
  }>;
  handoff_notes?: string[]; // Notes for the next agent in the pipeline chain
}) => Promise<MCPResult>
```

Completes the most recent `IN_PROGRESS` pipeline of the specified type. If `handoff_notes` is provided, a structured `HandoffNote` entry is appended to the work package. On PASS, the recipient is determined by `NEXT_AGENT_MAP` (legacy 4-stage) or `resolveNextAgent()`. On FAIL, the recipient is determined by `FAIL_ROUTING_MAP` (legacy 4-stage) or `resolveFailAgent()` — routes QA/code-review/implementation/security-audit failures to Developer; documentation failures to Documentation for self-rework; release-engineering failures to Release Engineer for self-rework; fall-back: when the standard fail-target’s stage is absent from the WP’s activeStages, routes to the first active stage’s agent. Sets status, completion timestamp, summary, optional fields, and automatically computes `duration_ms` from `started_at` to `completed_at` when `started_at` is present and the result is non-negative.

**`agent_role` is required (§52).** Must match the pipeline type’s owner role per `PIPELINE_AGENT_MAP`: `"Developer"` for `implementation`, `"QA"` for `qa`, `"Reviewer"` for `code-review`, `"Documentation"` for `documentation`. **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type (PM Override). This field must be explicit because it drives auto-finalize and PM Override handoff-note identity.

**Lenient input handling (agent-friendly):**
- **`summary`**: Accepts a single string or an array of strings. A bare string is automatically wrapped in a single-element array.
- **`comments[].timestamp`**: Optional. When omitted, the server auto-fills with the current ISO 8601 timestamp.

**Guards (applied in order):**
1. **WP status guard:** Rejects if the work package is not `IN_PROGRESS` (defense-in-depth, checked before role or pipeline lookup).
2. **Agent role guard:** `agent_role` must match the `PIPELINE_AGENT_MAP` owner for the given pipeline `type`. 
   **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type. When PM override is active, the handoff note's `from_agent` is set to `'Project Manager (PM Override)'` instead of the standard map value.

**`acceptance_criteria_updates` merge semantics:** Each item is matched by exact `criterion` string. If found, its `met` flag is updated. If **not found** (unknown criterion text), a new `AcceptanceCriterion` entry `{ criterion, met }` is **appended** to the WP's `acceptance_criteria` array.

**Auto-finalize:** When `status: 'PASS'` and the calling agent owns the WP's **last active stage** (terminal stage), the server evaluates all acceptance criteria **after** applying `acceptance_criteria_updates`. The terminal stage is computed dynamically: `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t)).at(-1)`. For default WPs this is `documentation` (Documentation agent); for custom-stage WPs it may be any stage.
- **All criteria met** — WP is automatically transitioned to `COMPLETE` within the same lock scope. Response payload includes `auto_finalized: true`. `pending_work_packages` is decremented and the root summary is updated. After the lock is released, `propagateDependencyUnblock` is called to transition eligible BLOCKED dependents to READY (§6.3 compliance — see Gotcha 8 in constraints.md for lock-ordering details).
- **Any criterion unmet** — WP remains `IN_PROGRESS`. Response payload includes `auto_finalize_blocked: true` and `unmet_criteria: string[]` listing the unmet criterion texts.
- **FAIL result, PM override, or non-terminal-stage agent** — auto-finalize does not fire; WP status is unchanged.

`ledger_update_work_package_status` remains registered for PM and edge-case use, but the terminal-stage agent no longer needs to call it after a successful pipeline PASS.

**Advisory dependency freshness check (§21.59):** When `status: 'PASS'` and the WP has `dependencies`, the server runs a non-blocking staleness check. Pre-reads each dependency's WP detail file before acquiring the write lock, using `dep.last_updated` directly (instead of the previous composite proxy `max(dep.status_changed_at, dep.latest_pipeline.completed_at)`). Inside the lock, emits a project comment (`type: 'warning'`, `priority: 'low'`, `agent: 'system'`) for each dep whose `last_updated` is later than the pipeline's `started_at`, using Date-based comparison (`new Date().getTime()`) instead of lexicographic string comparison. **PASS is never blocked** — warnings are purely advisory. The check is skipped when `started_at` is absent or when the WP has no dependencies.

#### `ledger_cancel_pipeline`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  reason: string;
  auto_cancelled?: boolean; // default: false. Set to true for infrastructure-driven cancellations (crash recovery, GUI reset) to exclude the pipeline from rework budget tracking (§12.5.2, §21.27)
}) => Promise<MCPResult>
```

Cancels the most recent `IN_PROGRESS` pipeline of the specified type by setting its status to `FAIL` and recording the reason as the summary. Throws an error if no `IN_PROGRESS` pipeline of the given type exists. Use this to cancel pipelines that have become stale (detected via `ledger_get_next_action` returning `RESUME_OR_CANCEL`). When `auto_cancelled = true`, the pipeline is excluded from rework detection and circuit-breaker calculations — use this for crash-recovery or system-driven cancellations (§12.5.2).

#### `ledger_update_pipeline_progress`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  summary: string[];
}) => Promise<MCPResult>
```

Appends to the summary array of the most recent `IN_PROGRESS` pipeline without completing it. Useful for recording incremental progress checkpoints during long-running pipelines.

---

### Observation Tools

#### `ledger_add_observation`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  pipeline_type: 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation';
  type: string; // e.g., "code-smell", "refactor", "debt"
  priority: 'low' | 'medium' | 'high';
  note: string;
}) => Promise<MCPResult>
```

Adds a comment to the most recent pipeline of the specified type. The `pipeline_type` field is validated by a Zod enum. Comments do not include an agent field (agent is inferred from pipeline type).

#### `ledger_add_project_comment`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
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
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Security Auditor' | 'Reviewer' | 'Release Engineer' | 'Documentation' | 'Synthesis';
  max_results?: number; // default: 1 (single-action mode)
}) => Promise<MCPResult>
```

Reads root index and work package details to recommend the next action(s) for an agent.

- **Default (`max_results` omitted or `1`)**: Returns a single action object (early-return mode, backward-compatible).
- **`max_results > 1`**: Switches to batch collector mode, returning up to `max_results` actions as an array under the `"actions"` key (`{ actions: [...], total: N }`). Useful for projects with many independent WPs that can be processed in parallel.
- **`action: WAIT` responses**: Automatically include a top-level `handoff_status` key with the same payload as `ledger_get_handoff_status`. Use it directly — no separate call needed. If handoff computation fails, `handoff_status_error` is present instead, signalling a fallback to `ledger_get_handoff_status`.

> `ledger_get_next_actions` (plural) has been removed — use `max_results` on this tool instead.

#### `ledger_get_handoff_status`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  current_agent: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Security Auditor' | 'Reviewer' | 'Release Engineer' | 'Documentation' | 'Synthesis';
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
    agent_name: string;      // The agent display name (e.g. "6 - Documentation v3.5.2")
    agent_id?: string;       // VS Code routing id (e.g. "ledger-6-docs") — omitted when absent from registry
    cc_agent_name: string;   // Claude Code agent name slug (e.g. "6-documentation") from AGENT_NAMES
    vs_agent_name: string;   // VS Code agent display name (e.g. "6 - Documentation v3.6.1") from AGENT_NAMES
    da_agent_name: string;   // Deep Agents agent name slug (e.g. "6-documentation") from AGENT_NAMES
    prompt: string;          // Prompt to pass to the next agent; prefixed with "@{agent_id}\n" when agent_id is present
  };
}
```

**Auto-handoff eligibility** — `auto_handoff` is included only when **all** of the following are true:
1. `auto_handoff_enabled` is `true` in the GUI config (`getConfig().auto_handoff_enabled`)
2. The agent registry is loaded (`isRegistryLoaded()` returns `true`)
3. The next agent has a known handle in the registry
4. Project status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` in the root index is `< effectiveMaxDepth(root.total_work_packages ?? 0)` — the dynamic ceiling scales with project size per §18.2.1: `max(configMax=50, totalWorkPackages × 30)`, where `configMax` comes from `getMaxHandoffDepth()` (default 50, runtime-configurable via `gui-config.json`) and the multiplier 30 comes from `handoff_depth_multiplier` in the shared workflow manifest

Each successful emission increments `auto_handoff_depth` in the root index. The counter is reset to `0` by `ledger_complete_synthesis` per §18.4, atomically with the `synthesis_generated: true` write.

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

### `SlugConflictError`

Named export from `src/storage/ledger-store.ts`. Thrown by `LedgerStore.renameSlug()` when the target slug directory already exists on disk.

```typescript
export class SlugConflictError extends Error {
  constructor(slug: string);
  // this.name === 'SlugConflictError' — ensures reliable instanceof checks across transpilation boundaries.
}
```

Used by `gui/api.ts` `handleRenameProject` catch block (`err instanceof SlugConflictError`) to produce a typed `CONFLICT` API error. Co-located in `ledger-store.ts` (single thrower, single consumer) — no separate `errors.ts` file.

---

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
  readWorkPackage(wpId: string): Promise<WorkPackageDetail>; // Applies in-memory backward-compat migration: if the file contains legacy rework_count (scalar) but no rework_counts, synthesises rework_counts from it and removes rework_count. Migration is in-memory only — no write triggered.
  readProjectMeta(): Promise<ProjectMeta>;

  // Write operations (validated before writing)
  // @internal — both methods below must only be called from within LedgerStore sync methods
  // (updateWorkPackageWithSync, createWorkPackageWithSync, batchUpdateWorkPackagesWithSync).
  // Tool functions and helpers must NOT call these directly; use a sync method instead to
  // guarantee atomic WP+root writes, schema validation, last_updated auto-stamping, and
  // .meta.json sync.
  //
  // writeRootIndex — legitimate direct callers (non-tool code under explicit withLock scope):
  //   - project-lifecycle.ts — getProjectStatus() self-healing (repairs stale counters under
  //     explicit withLock); initializeProject() and completeSynthesis() for root-index-only
  //     transitions that don't involve any WP file write.
  //   - auto-archive.ts    — sets status: 'ARCHIVED' with preserveLastUpdated: true
  //   - observations.ts    — appends a project-level comment (root-index write only)
  //   - workflow-handoff.ts — buildHandoffResponse(): increments or caps the auto_handoff_depth counter; root-index-only write with no WP file involvement
  //
  // writeWorkPackage — NO legitimate external callers as of WP-002 migration
  // (consolidate-wp-writes). Every previously-direct caller (e.g. project-reset.ts) has been
  // migrated to use a sync method. Use updateWorkPackageWithSync, createWorkPackageWithSync,
  // or batchUpdateWorkPackagesWithSync instead.
  writeRootIndex(data: RootIndex, options?: { preserveLastUpdated?: boolean }): Promise<void>; // @internal — auto-syncs .meta.json
  writeWorkPackage(wpId: string, data: WorkPackageDetail): Promise<void>;                      // @internal — zero external callers post-WP-002

  // Dual-file atomic creation (auto-syncs .meta.json inside lock).
  // Used when the WP file does not yet exist. The creator callback receives the current root
  // index and must return the new WP detail, its ID, and the updated root index.
  // Auto-stamps wp.last_updated = now() on every call (overwriting any caller-set value).
  // Validates both objects via Zod before any write; rolls back on callback error.
  // Returns the wpId string for caller convenience.
  createWorkPackageWithSync(
    creator: (
      root: RootIndex
    ) => { wpId: string; wp: WorkPackageDetail; root: RootIndex } |
         Promise<{ wpId: string; wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<string>;

  // Dual-file atomic update (auto-syncs .meta.json inside lock).
  // Auto-stamps wp.last_updated = now() on every call — this is the primary choke point
  // for the last_updated field. All callers that need to create or update a WP+root pair
  // must use createWorkPackageWithSync (creation) or updateWorkPackageWithSync (update).
  updateWorkPackageWithSync(
    wpId: string,
    updater: (wp: WorkPackageDetail, root: RootIndex) =>
      { wp: WorkPackageDetail; root: RootIndex } |
      Promise<{ wp: WorkPackageDetail; root: RootIndex }>
  ): Promise<void>;

  // Multi-WP atomic batch update (auto-syncs .meta.json inside lock).
  // Batch-write sibling of updateWorkPackageWithSync. Acquires a single lock for the
  // entire operation — all WPs and the root index are written within one lock scope.
  //
  // The callback receives:
  //   - root — the current root index (read inside the lock)
  //   - readWp — a helper to read any WP detail file (also inside the lock)
  // The callback must return:
  //   - updatedWps — a Map<wpId, WorkPackageDetail> of every WP to be written
  //   - root — the updated root index
  //
  // Two-pass validate-then-write atomicity guarantee:
  //   Pass 1 — auto-stamps last_updated (shared timestamp for all WPs in the batch)
  //            and validates every WP via WorkPackageDetailSchema + the root index
  //            via RootIndexSchema. If any validation fails, no files are written.
  //   Pass 2 — writes all validated WP files atomically, then writes the root index,
  //            then syncs .meta.json exactly once.
  //
  // Note: atomicity is lock-scoped, not rollback-scoped. If a WP file write succeeds
  // but a later write fails (e.g. I/O error after validation), earlier writes are not
  // rolled back. Validation failures in Pass 1 always prevent any writes.
  //
  // Used by propagateDependencyUnblock and propagateDependencyReblock (src/tools/work-package.ts)
  // and by applyProjectReset and markProjectComplete (src/utils/project-reset.ts) to consolidate
  // all per-WP writes into a single lock scope.
  batchUpdateWorkPackagesWithSync(
    callback: (
      root: RootIndex,
      readWp: (id: string) => Promise<WorkPackageDetail>
    ) => Promise<{ updatedWps: Map<string, WorkPackageDetail>; root: RootIndex }>
  ): Promise<void>;

  // Document archiving
  archiveDocuments(filenames: string[]): Promise<{ archived: string[]; skipped: string[] }>;
  // Copies each filename from planPath to storageDir. Missing sources (ENOENT) are silently
  // skipped (warning written to stderr). Returns lists of archived and skipped filenames.
  // Non-ENOENT errors (e.g. EACCES, ENOSPC, EISDIR) are re-thrown to the caller.

  // Meta methods
  // Reads current meta, merges status + optional cacheUpdates (field-preservation: existing cache
  // fields are preserved unless overridden), validates with ProjectMetaSchema, writes atomically.
  // cacheUpdates fields use `undefined` as a skip sentinel, `null` as an explicit written value for
  // nullable string fields (project_name, repository_name).
  writeProjectMeta(
    planFile: string,
    status?: string,
    cacheUpdates?: {
      total_work_packages?: number;
      pending_work_packages?: number;
      project_name?: string | null;
      repository_name?: string | null;
    }
  ): Promise<void>;
  // Sets the user-visible display title. Reads current meta, updates `title`
  // while preserving `last_updated` unchanged, validates with ProjectMetaSchema,
  // writes atomically.
  updateTitle(title: string): Promise<ProjectMeta>;
  // Renames the ledger storage directory on disk and patches `slug` in .meta.json.
  // Does NOT touch `last_updated`. Must NOT be called inside withLock.
  // Throws on: invalid slug (fails SAFE_SLUG_REGEX or length > 200), or target
  // directory already exists (throws SlugConflictError). Contains a defensive
  // same-slug guard (throws plain Error) that is unreachable from handleRenameProject
  // — the API handler pre-checks newSlug === slug and short-circuits before this
  // method is called. Returns updated ProjectMeta.
  renameSlug(newSlug: string): Promise<ProjectMeta>;

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

// Note: detectProjectByCwd silently skips ARCHIVED projects during the candidate scan.
// An archived project whose codebase path matches cwd_path will never be returned as FOUND.
// Explicit project_path access (e.g. via ledger_get_project_status) is unaffected and still works
// on archived projects — only auto-detection via cwd is suppressed.
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
  status: ProjectStatus;  // Zod-validated via the shared ProjectStatus enum from src/schema/enums.ts — not an inline z.enum(). Values: 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'ARCHIVED'
  date_created: string;  // ISO timestamp
  last_updated: string;  // ISO timestamp
  title?: string;        // Optional, derived from plan_file content
  // Enrichment cache fields (all optional — absent in legacy .meta.json files)
  total_work_packages?: number;   // Synced by writeRootIndex, createWorkPackageWithSync, and updateWorkPackageWithSync on every root index write
  pending_work_packages?: number; // Synced on same writes; decremented when WP transitions to COMPLETE/CANCELLED
  project_name?: string | null;   // Resolved at init from package.json/composer.json/pyproject.toml; null on failure
  repository_name?: string | null; // Derived from inferProjectRootFromPlanPath(plan_path); null if not detectable
}
```

Schema: `ProjectMetaSchema` (Zod).

### Core Types

```typescript
type ProjectStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'ARCHIVED';
type WorkPackageStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
type PipelineStatus = 'IN_PROGRESS' | 'PASS' | 'FAIL'; // Note: 'READY' was removed — pipelines are always created as IN_PROGRESS
type AgentRole = 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Security Auditor' | 'Reviewer' | 'Release Engineer' | 'Documentation' | 'Synthesis'; // Inferred from AgentRoleEnum (z.infer<typeof AgentRoleEnum>) in src/schema/workflow-manifest-schema.ts; re-exported by src/utils/constants.ts. Canonical type for all valid agent role names.
type PipelineType = 'implementation' | 'qa' | 'security-audit' | 'code-review' | 'release-engineering' | 'documentation'; // Exported from src/utils/pipeline-maps.ts; provides compile-time exhaustiveness checking for pipeline key access across all routing maps. Also available as PipelineTypeEnum (Zod schema) for use in tool input validation.
type PostImplPipelineType = 'qa' | 'code-review' | 'documentation'; // Explicitly pinned to the 3 legacy post-impl stages — NOT derived via Exclude<PipelineType, 'implementation'> so that adding new PipelineType values does not cascade into legacy 4-stage display maps (agentNameMap, actionNameMap, reworkActionMap) that remain 3-entry records.
type BlockerType = 'dependency' | 'decision' | 'external' | 'technical';
type CommentPriority = 'low' | 'medium' | 'high';
interface ReworkCounts {
  implementation?: number; // Non-negative integer; absent until first rework of that type
  qa?: number;
  'security-audit'?: number;
  'code-review'?: number;
  'release-engineering'?: number;
  documentation?: number;
}
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
  auto_handoff_depth?: number;        // Server-managed loop-guard counter; absent/undefined treated as 0
  synthesis_generated?: boolean;      // Set to true by ledger_complete_synthesis; absent/false means synthesis not yet done
  synthesis_generated_at?: string | null; // ISO 8601 timestamp set when synthesis_generated is marked true; null means explicitly invalidated; absent means not yet set
  ledger_version?: string;            // Semantic version string of the MCP server that last wrote this ledger; absent on legacy ledgers
}

interface WorkPackageSummary {
  work_package_id: string; // WP-### format
  status: WorkPackageStatus;
  assigned_to: string | null; // null when the WP has not yet been assigned to an agent
  dependencies: string[];
  file: string; // Path to detail file
  active_pipeline_stages?: string[] | null; // Cached subset from WP detail; null or absent means use DEFAULT_PIPELINE_STAGES
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
  assigned_to: string | null; // null when the WP has not yet been assigned to an agent
  dependencies: string[];
  blocked_by?: Blocker;
  acceptance_criteria: AcceptanceCriterion[];
  revision: number; // 0-based; new WPs start at 0 (previously started at 1)
  active_pipeline_stages?: string[];  // Optional. The active pipeline stages for this WP. When absent or empty, defaults to DEFAULT_PIPELINE_STAGES. Must be a subsequence of CANONICAL_PIPELINE_ORDERING. Hard validation enforced by ledger_create_work_package.
  rework_count?: number;  // Legacy scalar — read-only; used only by in-memory migration in readWorkPackage() for documents that pre-date rework_counts. No longer written by production code.
  rework_counts?: ReworkCounts;  // Per-pipeline-type rework map; lazily created on first rework (§16.2)
  status_changed_at?: string;  // ISO 8601 timestamp of the last status transition (§10b.1)
  last_updated?: string;  // ISO 8601 timestamp auto-stamped on every WP detail write (status transitions, claim, pipeline start/complete/cancel, creation, cascade reblock/unblock). Used by the advisory staleness check in completePipeline instead of the previous composite proxy.
  reset_at?: string;  // ISO 8601 timestamp set by applyProjectReset() on 'reset' actions only. Not set for 'cancel' or 'skip'. Distinguishes reset-recovery events from other status transitions.
  handoff_notes?: HandoffNote[];  // Notes appended via completePipeline's handoff_notes param
  pipelines: Pipeline[];
}

interface Pipeline {
  type: string;
  status: PipelineStatus;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number; // wall-clock duration in milliseconds; computed by ledger_complete_pipeline when started_at is present and non-negative (absent for in-progress, cancelled, or legacy pipelines)
  summary: string[];
  artifacts?: Artifacts;
  metrics?: Metrics;
  comments?: PipelineComment[];
  auto_cancelled?: boolean; // true only when set by system automation (§3.4); absent/false for normal pipelines
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

## Workflow Manifest Schema

### `src/schema/workflow-manifest-schema.ts` — Zod schema and parsed singleton

Centralizes manifest parsing and TypeScript type derivation. Loaded once at module startup; parse failure surfaces a clear `ZodError` immediately (fail-fast behavior).

```typescript
// Zod enum containing all 9 agent role name literals.
// NOTE: The literal values must be manually kept in sync with shared/workflow-manifest.json
// roles[].name — this is the one construct NOT auto-derived from manifest data.
// ManifestSchema.roles.nonempty() + RoleSchema.name: AgentRoleEnum provides a two-layer
// consistency guard: any divergence between AgentRoleEnum and the manifest causes a startup-
// time ZodError. Also validated by tests/utils/workflow-manifest.test.ts.
const AgentRoleEnum: z.ZodEnum<['Planner', 'Project Manager', 'Developer', 'QA',
  'Security Auditor', 'Reviewer', 'Release Engineer', 'Documentation', 'Synthesis']>;

// TypeScript type inferred from AgentRoleEnum — not a manually-maintained union.
type AgentRole = z.infer<typeof AgentRoleEnum>;
// = 'Planner' | 'Project Manager' | 'Developer' | 'QA'
// | 'Security Auditor' | 'Reviewer' | 'Release Engineer'
// | 'Documentation' | 'Synthesis'

// Full Zod schema for shared/workflow-manifest.json.
// Validates structural integrity at startup. Parsed singleton available as workflowManifest.
const ManifestSchema: z.ZodObject<...>;

// TypeScript type inferred from ManifestSchema.
type Manifest = z.infer<typeof ManifestSchema>;

// Parsed and Zod-validated manifest singleton. Loaded once at module-load time.
// All consumers (constants.ts, enums.ts, pipeline-maps.ts, workflow-helpers.ts) import from here instead
// of using createRequire + raw cast — ensuring manifest access is always type-safe.
const workflowManifest: Manifest;
```

**Consumers:**
- `src/utils/constants.ts` — re-exports `AgentRole` and `AgentRoleEnum`; derives `AGENT_ROLES`, `ORCHESTRATING_ROLES`, `ROLE_IDS`, `SPEC_VERSION` from `workflowManifest`
- `src/schema/enums.ts` — derives status enums from `workflowManifest`
- `src/utils/pipeline-maps.ts` — derives pipeline routing maps from `workflowManifest`
- `src/utils/workflow-helpers.ts` — derives `STALE_PIPELINE_HOURS`, `MAX_REWORK_COUNT`, `_DEFAULT_MAX_HANDOFF_DEPTH`, `_HANDOFF_DEPTH_MULTIPLIER` from `workflowManifest.constants.*`

---

## Constants

Exported from `src/utils/constants.ts`. Single source of truth for shared string constants and derived types used across the codebase. Role and status constants are **derived at module-load time from `shared/workflow-manifest.json`** via the Zod-validated `workflowManifest` singleton in `src/schema/workflow-manifest-schema.ts` — no inline literal arrays remain for spec-defined constructs.

```typescript
// Filename used when reading the archived plan document from centralized storage.
// Used by gui/api.ts (handleGetPlanDocument) as the read target; also referenced in help-content.ts.
const PLAN_ARCHIVE_FILENAME = 'plan.md' as const;

// Default filename used by ledger_complete_synthesis when archiving the synthesis document.
// Used as the Zod .default() value in project-lifecycle.ts; also referenced in help-content.ts.
const SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md' as const;

// Canonical array of valid agent role names.
// Derived at module-load time from workflowManifest.roles[].name via the Zod singleton.
// Consumers should import from here rather than defining local copies to avoid silent drift.
const AGENT_ROLES: AgentRole[];  // runtime values come from the manifest

// Re-exported from src/schema/workflow-manifest-schema.ts (see below).
// AgentRole is z.infer<typeof AgentRoleEnum> — not a manually-maintained union.
// Consumers that import agent types from utils/constants continue to work unchanged.
export type { AgentRole } from '../schema/workflow-manifest-schema.js';
export { AgentRoleEnum } from '../schema/workflow-manifest-schema.js';

// Roles that orchestrate the workflow but do not directly execute implementation work.
// Derived at module-load time from workflowManifest.roles[].orchestrating === true.
// Used to derive CLAIMABLE_ROLES in work-package.ts (excludes these roles from the claimable set).
const ORCHESTRATING_ROLES: OrchestratingRole[];  // runtime values come from the manifest

// Explicit string-literal union type — OrchestratingRole is not Zod-inferred because
// orchestrating roles have no separate enum in the manifest schema.
type OrchestratingRole = 'Planner' | 'Synthesis';

// Map of agent role name → role ID (e.g. 'Project Manager' → 'pm').
// Derived at module-load time from shared/workflow-manifest.json roles[].id.
// Useful for graph stage names, config keys, and programmatic lookups.
// Note: has no TypeScript consumers in the mcp-server codebase as of v1.12.0;
// the orchestrator maintains a parallel derivation in orchestrator/src/config.py.
const ROLE_IDS: Record<AgentRole, string>;

// Pattern for valid ledger slugs: must start with a lowercase alphanumeric character,
// followed by zero or more lowercase alphanumeric characters or hyphens. Max length 200.
// Used by LedgerStore.renameSlug() (storage layer) and gui/api.ts (API layer).
const SAFE_SLUG_REGEX: RegExp; // /^[a-z0-9][a-z0-9-]*$/

// Workflow specification version this MCP server implements.
// Derived at module-load time from shared/workflow-manifest.json spec_version field.
// Written into every new ledger as ledger_version on initializeProject().
// Current value: '2.4.1'
const SPEC_VERSION: string;  // e.g. '2.4.1'

// Target-specific file name and agent name for a single IDE/platform.
// Used as a nested value inside NameMappingEntry.
interface TargetNames {
  file_name: string;   // Output filename for this target (e.g. "3-developer.md")
  agent_name: string;  // Canonical agent name used to invoke/route to this agent on that platform
}

// Full name-mapping entry for one agent role.
// Shape of each element in personas/name-mapping.json (generated by scripts/build-personas.js).
interface NameMappingEntry {
  number: number;             // Display order and numeric prefix (1–9)
  id: string;                 // Machine-friendly unique identifier (e.g. "ledger-3-dev")
  role: AgentRole;            // Canonical role name matching the workflow manifest
  version: string;            // Persona version string (e.g. "3.6.1")
  vscode: TargetNames;        // Names for the VS Code target
  claude_code: TargetNames;   // Names for the Claude Code target
  deep_agents: TargetNames;   // Names for the Deep Agents target
}

// Per-role agent name mapping loaded from personas/name-mapping.json at module-load time.
// Provides canonical, target-specific agent names for each role (VS Code, Claude Code,
// Deep Agents) without requiring runtime string manipulation.
// Keyed by role name (e.g. 'Developer') — keys match AGENT_ROLES values exactly.
// Loaded via createRequire('../../../personas/name-mapping.json') from dist/utils/constants.js.
const AGENT_NAMES: Record<AgentRole, NameMappingEntry>;
```

**Importers of `AGENT_ROLES`:**
- `src/tools/workflow-next-action.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/tools/workflow-handoff.ts` — imports `AGENT_ROLES` from `'../utils/constants.js'`
- `src/utils/agent-registry.ts` — imports `AGENT_ROLES` from `'./constants.js'`
- `src/tools/work-package.ts` — imports `AGENT_ROLES`, `ORCHESTRATING_ROLES` from `'../utils/constants.js'`

**Importers of `SAFE_SLUG_REGEX`:**
- `src/storage/ledger-store.ts` — imports `SAFE_SLUG_REGEX` from `'../utils/constants.js'`; used in `renameSlug()` validation
- `gui/api.ts` — imports `SAFE_SLUG_REGEX` from `'../src/utils/constants.js'`; used in `handleRenameProject` as a defence-in-depth early-reject guard before the slug reaches the storage layer

**Importers of `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME`:**
- `gui/api.ts` — imports both; `PLAN_ARCHIVE_FILENAME` used in `handleGetPlanDocument` join() call, `SYNTHESIS_ARCHIVE_FILENAME` used in `handleGetSynthesisDocument` join() call
- `src/tools/project-lifecycle.ts` — imports `SYNTHESIS_ARCHIVE_FILENAME`; used as Zod `.default()` value
- `src/tools/help-content.ts` — imports both; used in tool help text template expressions

**Importers of `SPEC_VERSION`:**
- `src/tools/project-lifecycle.ts` — sets `ledger_version: SPEC_VERSION` on the root index object inside `initializeProject()`; also used in forward-compatibility warning comparisons in `getProjectStatus()`

**Importers of `AGENT_NAMES`:**
- `src/tools/workflow-handoff.ts` — reads `AGENT_NAMES[role]` to populate `cc_agent_name`, `vs_agent_name`, and `da_agent_name` fields in the `auto_handoff` response payload (added in WP-005)

**Manifest invariant test:** `tests/utils/workflow-manifest.test.ts` validates the structural invariants of `shared/workflow-manifest.json` at test time and asserts derived-constant parity — confirming that `AGENT_ROLES`, `ORCHESTRATING_ROLES`, `PIPELINE_TYPES`, `DEFAULT_PIPELINE_STAGES`, `PIPELINE_AGENT_MAP`, `MAX_REWORK_COUNT`, `STALE_PIPELINE_HOURS`, and `SPEC_VERSION` all match the manifest values exactly. Also includes a `resolveFailAgent() parity — manifest fail_routing` describe block that verifies `resolveFailAgent()` output for all 6 pipeline types matches the manifest's `fail_routing` → role name resolution — guarding against drift if manifest routing values change without updating the implementation. Any future manifest edit that causes a constant or routing resolution to diverge will fail the test suite (39 tests).

---

## Pipeline-Maps Constants

Exported from `src/utils/pipeline-maps.ts`. Single source of truth for pipeline type definitions, routing maps, and dynamic resolve functions. All primary maps and arrays are **derived at module-load time from `shared/workflow-manifest.json`** via the Zod-validated `workflowManifest` singleton in `src/schema/workflow-manifest-schema.ts` — no inline literal arrays remain for spec-defined constructs.

```typescript
// The six valid pipeline type values as a const tuple, in canonical execution order.
// Derived from pipelines.canonical_order in the shared workflow manifest.
const PIPELINE_TYPES: readonly [
  'implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation'
];

// Alias of PIPELINE_TYPES. The canonical execution order for all six pipeline stages.
// Dynamic resolve functions filter this ordering by a WP's active_pipeline_stages.
const CANONICAL_PIPELINE_ORDERING: typeof PIPELINE_TYPES;

// Backward-compatible default stage set (4-stage legacy workflow).
// Used as the default activeStages when a WP has no active_pipeline_stages field.
// Derived from pipelines.default_stages in the shared workflow manifest.
const DEFAULT_PIPELINE_STAGES: readonly ['implementation', 'qa', 'code-review', 'documentation'];

// Zod enum schema for pipeline types — use in tool input validation.
const PipelineTypeEnum: z.ZodEnum<[typeof PIPELINE_TYPES[number], ...]>;

// Maps pipeline type → owning agent role (all 6 types, including Security Auditor and Release Engineer).
// Derived from roles[].pipeline (non-null) → roles[].name in the shared workflow manifest.
const PIPELINE_AGENT_MAP: Record<PipelineType, string>;

// Inverse of PIPELINE_AGENT_MAP (derived at runtime from PIPELINE_AGENT_MAP — no divergence possible).
const AGENT_PIPELINE_MAP: Record<string, PipelineType>;

// Legacy static maps — Partial<Record<PipelineType, ...>> (default-stage workflow only).
// @deprecated For new WPs, use the dynamic resolve functions below instead.
//
// PIPELINE_PREREQUISITES: derived from the default_stages predecessor chain — each stage's prerequisite
// is its immediately preceding stage in the default order, or null for the first stage.
// NOTE: this intentionally diverges from the full 6-stage pipelines.prerequisites map in the manifest
// (which reflects the complete canonical chain including optional stages). Using the full prerequisites
// map would produce wrong values for the legacy 4-stage workflow (e.g. code-review would require
// security-audit). Future maintainers should NOT change this to use the full manifest prerequisites.
//
// NEXT_AGENT_MAP: computed from PIPELINE_TYPES and PIPELINE_AGENT_MAP using the default stage set.
// The last default stage always maps to 'Synthesis' (sentinel hardcoded in derivation loop — acceptable
// because NEXT_AGENT_MAP is explicitly marked legacy; resolveNextAgent() is the go-to for new code).
//
// FAIL_ROUTING_MAP: derived from pipelines.fail_routing in the manifest; role IDs translated to
// role names via the roles array lookup. Only covers the default stages.
const PIPELINE_PREREQUISITES: Partial<Record<PipelineType, PipelineType | null>>;  // null = no prerequisite
const NEXT_AGENT_MAP: Partial<Record<PipelineType, string>>;
const FAIL_ROUTING_MAP: Partial<Record<PipelineType, string>>;
```

---

## Agent Registry

Exported from `src/utils/agent-registry.ts`. Discovers VS Code agent handles by scanning `*.agent.md` files in a configurable directory.

### `discoverAgents()`

```typescript
async function discoverAgents(agentsDir: string, strict?: boolean): Promise<Record<string, string>>;
```

Scans `agentsDir` for `*.agent.md` files, parses YAML frontmatter in each, and builds two in-memory maps: a `role → name` map (e.g. `{ "Developer": "3 - Developer v3.1.2" }`) and a `role → id` map (e.g. `{ "Developer": "ledger-3-dev" }`). Overwrites both module-level caches on each call and returns a shallow copy of the `role → name` map. Entries without an `id:` field are recorded in `agentHandleMap` only — absent `id:` is not an error.

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

Looks up a role in the cached `agentHandleMap`. Returns the agent handle string (e.g. `"3 - Developer v3.1.2"`) or `null` if the role is not found. Does not trigger discovery.

### `getAgentId()`

```typescript
function getAgentId(role: string): string | null;
```

Looks up a role in the cached `agentIdMap`. Returns the agent `id` string (e.g. `"ledger-3-dev"`) or `null` if the role is not found or if the matching `.agent.md` file has no `id:` frontmatter field. Does not trigger discovery. Used by `buildHandoffResponse()` to attach `@id` routing prefixes to auto-handoff prompts.

### `isRegistryLoaded()`

```typescript
function isRegistryLoaded(): boolean;
```

Returns `true` if the registry has been populated by a successful `discoverAgents()` call that resolved at least one agent file with a valid `role:` field. Returns `false` before discovery or after a failed/empty discovery.

### `resetRegistry()`

```typescript
function resetRegistry(): void;
```

Clears both cached maps (`agentHandleMap` and `agentIdMap`) and resets the loaded flag. **Intended for use in unit tests only.**

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
// Corruption mitigation (§17.2 known-gap): if synthesis_generated === true AND
// pendingWps > 0, the flag is treated as false for all rule evaluation and
// corruptionDetected is set to true. The caller (getProjectStatus) then resets
// fresh.synthesis_generated = false and fresh.synthesis_generated_at = null inside the write callback, eliminating
// a repeated-write loop on subsequent calls.
//
// Healing rules (first-match-wins order):
//  1.    (IN_PROGRESS|READY) + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
//  1b.   READY  + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
//  1c.   IN_PROGRESS + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS (preserve)
//  2.    COMPLETE + pendingWps>0 → IN_PROGRESS
//  2b.   COMPLETE + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
//  3.    READY + hasInProgressWp → IN_PROGRESS
//  3b.   READY + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
//  3c.   IN_PROGRESS + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
//  4.    BLOCKED + hasInProgressWp → IN_PROGRESS
//  4b.   BLOCKED + hasReadyWp + !hasInProgressWp → READY
//  5a.   BLOCKED + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
//  5b.   BLOCKED + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
//  6b.   (IN_PROGRESS|BLOCKED) + totalWps==0 → READY
//  6c.   COMPLETE + totalWps==0 → READY
function computeHealedStatus(rootIndex: RootIndex): {
  totalWps: number;
  pendingWps: number;
  healedStatus: ProjectStatus;
  needsWrite: boolean;
  corruptionDetected: boolean;
  legacySynthesisTimestampRepair: boolean; // true when synthesis_generated===true, corruptionDetected===false, and synthesis_generated_at is absent/null → signals getProjectStatus to backfill synthesis_generated_at = last_updated
};

// Absolute path to the workspace root directory (ai-insights/).
// Derived once at module-load time: join(__dirname, '..', '..', '..') from src/utils/.
// Resolves correctly from both dev (tsx runs .ts from src/utils/) and production (dist/utils/).
// Exported from src/utils/ledger-root.ts. Used by gui/server.ts to pass workspaceRoot to
// handleOrchestratorStart (added by WP-008).
const WORKSPACE_ROOT: string;

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

// Resolves the project path from either an explicit project_path or a cwd_path.
// Resolution order:
//   0. If BOTH project_path and cwd_path are provided: throws Error(MUTUAL_EXCLUSIVITY_PATH_MSG).
//      (Primary runtime guard — tool schemas are plain ZodObject; see constraint §57.)
//   1. If project_path is provided: validates format via planFolderBasename(), returns it.
//   2. If cwd_path is provided: calls LedgerStore.detectProjectByCwd(), returns plan_path on FOUND.
//      Throws with a candidate list on AMBIGUOUS; throws on NOT_FOUND.
//   3. If neither is provided: throws 'Either project_path or cwd_path is required.'
// Exported from src/utils/path-validator.ts. Used by all tool handlers (except initializeProject).
async function resolveProjectPath(args: {
  project_path?: string;
  cwd_path?: string;
  [key: string]: unknown;
}): Promise<string>;

// Zod refinement predicate: returns false if BOTH project_path and cwd_path are present.
// ⚠️ No longer used by any production tool file. Mutual exclusivity is now enforced at runtime
// by resolveProjectPath() — see constraint §57. Retained for backward compatibility and test
// coverage only. Do NOT use with .refine() on an outer z.object() schema — doing so converts
// ZodObject → ZodEffects, causing the MCP SDK to emit empty JSON Schema for the tool.
// Exported from src/utils/path-validator.ts.
const mutuallyExclusivePaths: (args: { project_path?: string | null; cwd_path?: string | null }) => boolean;

// Error message paired with mutuallyExclusivePaths.
// Value: "Provide either 'project_path' or 'cwd_path', not both."
// Exported from src/utils/path-validator.ts.
const MUTUAL_EXCLUSIVITY_PATH_MSG: string;

// Returns all pipeline types that come AFTER the given type in the active stage ordering.
// When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
// Returns [] when type is the last active stage or not in the active set.
// Exported from src/utils/pipeline-maps.ts. Returns a fresh array — safe to mutate.
// Examples (legacy default):
//   getDownstreamTypes('implementation') → ['qa','code-review','documentation']
//   getDownstreamTypes('code-review')    → ['documentation']
//   getDownstreamTypes('documentation')  → []
// Examples (6-stage active set):
//   getDownstreamTypes('qa', PIPELINE_TYPES) → ['security-audit','code-review','release-engineering','documentation']
function getDownstreamTypes(
  type: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): PipelineType[];

// Returns all pipeline types that come BEFORE the given type in the active stage ordering.
// When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (4-stage legacy behaviour).
// Returns [] when type is the first active stage or not in the active set.
// Exported from src/utils/pipeline-maps.ts. Returns a fresh array — safe to mutate.
// Examples (legacy default):
//   getUpstreamTypes('documentation') → ['implementation','qa','code-review']
//   getUpstreamTypes('qa')             → ['implementation']
//   getUpstreamTypes('implementation') → []
function getUpstreamTypes(
  type: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): PipelineType[];

// Computes the prerequisite pipeline type for pipelineType given activeStages.
// Filters CANONICAL_PIPELINE_ORDERING by activeStages; the immediately preceding active stage
// is the prerequisite. Returns null when pipelineType is the first active stage or not active.
// When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
// Exported from src/utils/pipeline-maps.ts. Replaces the legacy static PIPELINE_PREREQUISITES map
// for new-stage WPs — callers should prefer this function over the static map.
// Examples:
//   resolvePrerequisite('qa')            → 'implementation' (both active)
//   resolvePrerequisite('implementation') → null            (first stage)
//   resolvePrerequisite('documentation', ['documentation']) → null  (only active stage)
function resolvePrerequisite(
  pipelineType: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): PipelineType | null;

// Returns the agent that should receive the WP after pipelineType completes with PASS,
// given activeStages. Finds the next active stage in CANONICAL_PIPELINE_ORDERING and returns
// its owning agent via PIPELINE_AGENT_MAP. Returns 'Synthesis' when pipelineType is the last
// active stage or when pipelineType is not in the active set (index === -1).
// When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
// Exported from src/utils/pipeline-maps.ts. Replaces the legacy static NEXT_AGENT_MAP for WPs
// that use non-default pipeline compositions.
// Precondition: callers must not invoke with a stage outside the WP's activeStages
// (index-not-found path returns 'Synthesis' as a safe fallback).
// Examples:
//   resolveNextAgent('implementation')  → 'QA'        (legacy 4-stage default)
//   resolveNextAgent('documentation')   → 'Synthesis'  (last stage)
//   resolveNextAgent('documentation', ['documentation']) → 'Synthesis' (only stage)
function resolveNextAgent(
  pipelineType: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): string;

// Returns the agent that should receive the WP after pipelineType completes with FAIL,
// given activeStages (rework routing). Base routing is fully manifest-derived: each
// pipeline type maps to the role resolved from `pipelines.fail_routing` in the shared
// workflow manifest via _roleById lookup — zero hardcoded role strings. Current manifest
// routing values:
//   implementation, qa, security-audit, code-review → Developer
//   release-engineering → Release Engineer (self-rework)
//   documentation → Documentation (self-rework)
// Fallback: when the standard fail-target agent's stage is not present in activeStages,
// routes to the agent that owns the first active stage.
// When activeStages is omitted, defaults to DEFAULT_PIPELINE_STAGES (legacy 4-stage).
// Exported from src/utils/pipeline-maps.ts. Replaces the legacy static FAIL_ROUTING_MAP for
// new-stage WPs.
// FAIL_AGENT_MAP is the module-level backing constant (see below) — callers that only need
// the base manifest fail-routing without the active-stage fallback can use it directly.
// Examples:
//   resolveFailAgent('qa')                      → 'Developer'      (Developer's stage is active)
//   resolveFailAgent('qa', ['documentation'])   → 'Documentation'  (Developer's impl stage absent — fallback)
//   resolveFailAgent('documentation')           → 'Documentation'  (self-rework)
function resolveFailAgent(
  pipelineType: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): string;

// Module-level backing constant for resolveFailAgent(). Maps every PipelineType to the
// agent role name that owns failed pipelines of that type, derived once at module load
// from workflowManifest.pipelines[*].fail_routing via the _roleById lookup. Computed
// once and never reconstructed.
// Use FAIL_AGENT_MAP directly when you need the base manifest routing without the
// active-stage fallback logic that resolveFailAgent() adds.
// Exported from src/utils/pipeline-maps.ts.
const FAIL_AGENT_MAP: Record<PipelineType, string>;

// Returns the given activeStages filtered and sorted by CANONICAL_PIPELINE_ORDERING.
// Replaces the repeated `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t))` pattern
// that appeared at 5 call sites in pipeline.ts and workflow-next-action.ts.
// Unlike getDownstreamTypes / getUpstreamTypes, this function does NOT take a pipelineType anchor —
// it simply returns the full ordered subset. Internal pipeline-maps.ts functions still use the
// raw filter directly (replacing them would be self-referential).
// Exported from src/utils/pipeline-maps.ts.
// Examples:
//   getOrderedActiveStages(['documentation','implementation']) → ['implementation','documentation']
//   getOrderedActiveStages(['qa','security-audit','code-review']) → ['qa','security-audit','code-review']
function getOrderedActiveStages(
  activeStages: readonly PipelineType[],
): PipelineType[];

// Returns a `.describe()` annotation string for a Zod pipeline type field,
// listing all PIPELINE_TYPES in canonical order with the given prefix.
// Eliminates hardcoded pipeline type lists in Zod .describe() strings — all 6
// tool schema call sites (observations.ts ×1, begin-work.ts ×1, pipeline.ts ×4)
// delegates to this function instead of maintaining their own prose copy.
// Exported from src/utils/pipeline-maps.ts (placed after getOrderedActiveStages).
// Example:
//   describePipelineTypes('Pipeline type:') →
//     'Pipeline type: "implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation"'
function describePipelineTypes(prefix: string): string;

// Returns the first pipeline stage in canonical order from the given active stages.
// Falls back to DEFAULT_PIPELINE_STAGES when stages is absent or null.
// Secondary fallback: returns DEFAULT_PIPELINE_STAGES[0] when orderedActive is empty.
// Exported from src/utils/pipeline-maps.ts.
// Examples:
//   firstActiveStage(['qa','documentation']) → 'qa'
//   firstActiveStage(null)                   → 'implementation'  (DEFAULT_PIPELINE_STAGES fallback)
//   firstActiveStage(undefined)              → 'implementation'
function firstActiveStage(stages?: readonly PipelineType[] | null): PipelineType;

// Returns the last pipeline stage in canonical order from the given active stages.
// Falls back to DEFAULT_PIPELINE_STAGES when stages is absent or null.
// Secondary fallback: returns DEFAULT_PIPELINE_STAGES[last] when orderedActive is empty.
// Exported from src/utils/pipeline-maps.ts.
// Examples:
//   lastActiveStage(['implementation','qa']) → 'qa'
//   lastActiveStage(null)                    → 'documentation'  (DEFAULT_PIPELINE_STAGES fallback)
//   lastActiveStage(undefined)               → 'documentation'
function lastActiveStage(stages?: readonly PipelineType[] | null): PipelineType;

// Validates a proposed active_pipeline_stages array against all hard and soft rules.
// Returns { errors, warnings } — caller is responsible for acting on errors (typically throws errors[0]).
// Hard errors: empty array, unknown stage names, duplicates, out-of-canonical-order.
// Soft warnings: implementation without qa, single-stage chain.
// Exported from src/utils/pipeline-maps.ts. Used by createWorkPackage() to replace
// the previous ~60-line inline validation block.
// Note: accepts string[] rather than PipelineType[] — validated internally.
function validateActiveStages(stages: string[]): { errors: string[]; warnings: string[] };

// Filters an array of WorkPackageDetail to those whose active_pipeline_stages includes
// the given stage. Falls back to DEFAULT_PIPELINE_STAGES when a WP has no explicit stages.
// Used by all 6 per-role handoff handlers in workflow-handoff.ts to scope pipeline-specific
// checks to WPs that participate in that stage.
// Exported from src/utils/pipeline-maps.ts.
// Examples:
//   scopeToStage(wpDetails, 'qa')             → WPs with 'qa' in active stages
//   scopeToStage(wpDetails, 'documentation')  → WPs with 'documentation' in active stages
function scopeToStage(
  wpDetails: readonly WorkPackageDetail[],
  stage: PipelineType,
): WorkPackageDetail[];
```

### Project Name Resolution — `src/utils/read-project-name.ts`

Shared utility extracted to eliminate the ~55-line duplicate in `gui/api.ts`.

```typescript
// Probes the managed workspace for a human-readable project name.
// Resolution order: package.json → name, composer.json → name, pyproject.toml → [tool.poetry].name
// Returns null if none of the manifest files exist or contain a usable name.
// projectRoot: absolute path to the managed project root (derived from inferProjectRootFromPlanPath()).
// Exported from src/utils/read-project-name.ts. Used by gui/api.ts (handleListProjects, handleGetProject)
// and src/tools/project-lifecycle.ts (initializeProject enrichment write).
function readProjectName(projectRoot: string): Promise<string | null>;
```

### Project Reset — `src/utils/project-reset.ts`

Provides the semi-intelligent project reset feature: a **pure analysis function** and an **async mutation function**.

```typescript
// ── Diagnosis types (exported) ──────────────────────────────────────────────

export interface WpResetDiagnosis {
  work_package_id: string;
  current_status: string;
  current_assigned_to: string | null;
  pipeline_stages_present: string[];       // stages with a PASS pipeline
  pipeline_stages_missing: string[];       // canonical stages lacking a PASS
  active_pipeline_stages: string[];        // resolved stage set for this WP (wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES)
  next_required_stage: string | null;      // first missing stage, or null if all pass
  target_assigned_to: string | null;       // agent for next_required_stage via PIPELINE_AGENT_MAP
  needs_reset: boolean;                    // false for CANCELLED, healthy, BLOCKED, READY WPs
  reason: string;                          // human-readable diagnosis note
  suggested_action: 'reset' | 'skip';
  suggested_reset_criteria: boolean;       // whether to clear AC met-flags on reset
  orphaned_pipeline_count: number;         // IN_PROGRESS pipelines on this WP that will be auto-cancelled by reset
}

export interface ProjectResetDiagnosis {
  project_slug: string;
  current_project_status: string;
  work_packages: WpResetDiagnosis[];
  work_packages_needing_reset: number;
  work_packages_healthy: number;           // healthy + skipped-statuses (BLOCKED, READY, CANCELLED)
  work_packages_skipped: number;           // CANCELLED WPs
  total_orphaned_pipelines: number;        // sum of orphaned_pipeline_count across all WPs
}

// ── Decision types (exported) ───────────────────────────────────────────────

export interface WpDecision {
  action: 'reset' | 'skip' | 'cancel';
  reset_criteria?: boolean;   // default: true — resets all acceptance_criteria.met flags
}

export interface ProjectResetResult {
  diagnosis: ProjectResetDiagnosis;
  applied: true;
  work_packages_reset: string[];
  work_packages_cancelled: string[];
  work_packages_skipped: string[];
  project_comment_added: string;           // ISO timestamp of the appended audit comment
}

// ── Helper utilities (exported) ─────────────────────────────────────────────

// Returns the set of pipeline types that have at least one PASS pipeline on a WP.
// Pure function — no I/O. Used internally by analyzeProjectForReset() and by
// the getProjectStatus() tool to compute aggregate pipeline health.
// Exported from src/utils/project-reset.ts so callers outside project-reset.ts
// (e.g. project-lifecycle.ts) can reuse it without duplicating stage-scan logic.
export function getPassedStages(wp: WorkPackageDetail): Set<string>;

// ── Analysis (pure function — no I/O) ───────────────────────────────────────

// Walks all work packages and returns a per-WP diagnosis.
// Rules (in order):
//   CANCELLED  → needs_reset:false, suggested_action:'skip'
//   All 4 stages PASS + COMPLETE  → healthy
//   IN_PROGRESS + assigned to correct agent  → healthy (skip)
//   IN_PROGRESS + assigned to wrong agent   → needs_reset:true
//   Any other status or incomplete stages   → needs_reset:true, next_required_stage = first missing
//   BLOCKED / READY  → needs_reset:false, suggested_action:'skip'
// Also counts IN_PROGRESS pipelines per WP (orphaned_pipeline_count) and accumulates the
// project total (total_orphaned_pipelines) — used by the GUI to warn before reset.
// Does NOT read from disk — caller must supply the pre-loaded rootIndex and workPackages.
export function analyzeProjectForReset(
  slug: string,
  rootIndex: RootIndex,
  workPackages: WorkPackageDetail[]
): ProjectResetDiagnosis;

// ── Mutation (async — writes via batchUpdateWorkPackagesWithSync) ────────────

// Applies user-confirmed per-WP decisions atomically via a single
// store.batchUpdateWorkPackagesWithSync() call (single lock acquisition).
// For each WP:
//   'reset'  → IN_PROGRESS pipelines on the WP are auto-cancelled first:
//                  {status: FAIL, auto_cancelled: true, completed_at, summary: ['Auto-cancelled by project reset']}
//              then: wp.status = 'IN_PROGRESS', wp.assigned_to = target_assigned_to,
//              wp.status_changed_at updated, wp.reset_at set to the mutation timestamp;
//              if reset_criteria !== false, all acceptance_criteria[].met = false;
//              blocked_by removed.
//   'cancel' → wp.status = 'CANCELLED', wp.status_changed_at updated. reset_at NOT set.
//   'skip'   → WP file not written (readWp is not called for skip-action WPs).
// Missing entries in `decisions` default to 'skip'.
// Stale-state guard: if wp.status changed since diagnosis was produced, the WP is
// silently skipped (writes to stderr) to prevent clobbering concurrent changes.
// Root index updates (all inside batch callback): pending_work_packages recomputed,
// status → 'IN_PROGRESS', synthesis_generated → false, auto_handoff_depth → 0,
// project_comment appended with ISO timestamp.
// wp.last_updated is auto-stamped by batchUpdateWorkPackagesWithSync (may differ slightly
// from wp.status_changed_at / wp.reset_at, which are set inside the callback — cosmetic only).
export async function applyProjectReset(
  store: LedgerStore,
  diagnosis: ProjectResetDiagnosis,
  decisions: Record<string, WpDecision>
): Promise<ProjectResetResult>;

// ── Mark as complete (mutation function — performs I/O via batchUpdateWorkPackagesWithSync) ──

// Forces every non-CANCELLED work package and the project itself to COMPLETE
// status via a single store.batchUpdateWorkPackagesWithSync() call (single lock
// acquisition). CANCELLED WPs are skipped entirely (readWp is not called for them).
// Root index mutations (all inside batch callback): status = COMPLETE,
// pending_work_packages = 0, last_updated, admin_action project comment appended.
// wp.last_updated is auto-stamped by batchUpdateWorkPackagesWithSync.
//
// The `slug` parameter is accepted for call-site clarity but is already bound
// on the LedgerStore (`void slug;` inside the function body).
//
// STDIO discipline: never writes to process.stdout.
// Exported from src/utils/project-reset.ts. Used by gui/api.ts (handleMarkProjectComplete).
export interface MarkProjectCompleteResult {
  marked_complete: true;
  work_packages_completed: string[];   // IDs of WPs set to COMPLETE (CANCELLED excluded)
  project_comment_added: string;       // note string appended as project_comments entry
}
export async function markProjectComplete(
  store: LedgerStore,
  slug: string
): Promise<MarkProjectCompleteResult>;
```

### Workspace Versions — `src/utils/workspace-versions.ts`

Reads the current on-disk version strings for all three workspace components in a single call. Used by the GUI server and any other consumer that needs to display or expose version information without importing from individual `package.json` files.

```typescript
/** Version strings for all three workspace components. */
type WorkspaceVersions = {
  mcpServer: string;    // from mcp-server/package.json → .version
  personas: string;     // from personas/package.json → .version
  orchestrator: string; // from orchestrator/pyproject.toml → version = "..."
};

// Reads the current on-disk version strings for the MCP server, personas build
// system, and orchestrator.
//
// All reads are synchronous (readFileSync). Throws on any of the following:
//   - ENOENT: any version file is missing or unreadable
//   - malformed TOML: /^version\s*=\s*"([^"]+)"/m regex yields no match on pyproject.toml
//
// The function reads from disk on every call — there is no caching.
// No external dependencies; uses only Node.js built-ins (fs, url, path).
//
// Path resolution: serverDir = join(__dirname, '..', '..'), workspaceRoot = join(serverDir, '..')
// These offsets are identical from both src/utils/ (dev via tsx) and dist/utils/ (compiled).
//
// Exported from src/utils/workspace-versions.ts.
function captureWorkspaceVersions(): WorkspaceVersions;
```

---

## Internal Testing Utilities

Tool modules expose internal helpers and constants to unit tests via one of three patterns:

- **`pipeline.ts`**, **`work-package.ts`**, **`project-lifecycle.ts`**, and **`observations.ts`**: use a manual `export const _internal = { ... }` object. Tests import with `import { _internal } from <module>.js`. In `pipeline.ts` and `observations.ts` the Zod schemas are included in `_internal` (alongside routing constants and helpers) — there is no separate `_schemas` export. See §53 in `constraints.md`.
- **Workflow sub-modules**: helpers and constants are exported directly as named exports. Tests use direct named imports from the defining module (e.g. `import { getDeveloperAction } from workflow-next-action.js`). `workflow.ts` re-exports all symbols for backward compatibility, but tests should prefer importing from the defining module.

**These internal exports are not part of the public API — do not call them from production code.**

### `src/tools/project-lifecycle.ts` — lifecycle helpers

```typescript
export const _internal: {
  // Core implementation of ledger_complete_synthesis. Accepts an optional
  // _ledgerRoot test-hook for test isolation (mirrors the pattern in work-package.ts).
  // Enforces §19.1 guards: agent role, fresh counter computation, at-least-one-WP,
  // and pending-WP check. All guards run inside the write lock.
  // ⚠️ _ledgerRoot is guarded: `typeof _ledgerRoot === 'string'` — safe when the
  // MCP SDK injects a RequestHandlerExtra object (see §58 in constraints.md).
  completeSynthesis: (
    args: { project_path: string; agent_role: string },
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
};
```

### `src/tools/work-package.ts` — work package helpers

```typescript
// Named export — called by pipeline.ts (completePipeline) and updateWorkPackageStatus.
// Propagates COMPLETE/CANCELLED to eligible BLOCKED dependents (→ READY).
// When ledgerRootOrOpts is a { store } object, uses the provided LedgerStore directly
// (avoids redundant construction). Otherwise constructs its own store and acquires
// its own lock. String form preserved for backward compatibility.
//
// Early-return guard: reads the root index once before acquiring the batch lock.
// If no BLOCKED WP has completedWpId in its dependencies list, the function returns
// immediately — skipping lock acquisition, the in-batch root index read, all WP
// detail reads, and the .meta.json sync write. The batch callback re-reads the root
// inside the lock on the non-early-return path, making this optimization safe under
// concurrent writes (worst-case race: a WP becomes BLOCKED after the pre-check and
// is missed on this call; it will be caught on the next dependency completion).
export function propagateDependencyUnblock(
  projectPath: string,
  completedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void>;
```

```typescript
// When ledgerRootOrOpts is a { store } object, uses the provided LedgerStore directly
// (avoids redundant construction). Otherwise constructs its own store and acquires
// its own lock. String form preserved for backward compatibility.
//
// Early-return guard: reads the root index once before acquiring the batch lock.
// If no WP with status READY, IN_PROGRESS, or COMPLETE has reopenedWpId in its
// dependencies list, the function returns immediately — skipping lock acquisition,
// the in-batch root index read, all WP detail reads, and the .meta.json sync write.
// BLOCKED and CANCELLED dependents are untouched by both processing loops so they
// do not qualify. The batch callback re-reads the root inside the lock on the
// non-early-return path, making this optimization safe under concurrent writes
// (worst-case race: a WP becomes READY/IN_PROGRESS after the pre-check and is missed
// on this call; it will be caught on the next status transition).
async function propagateDependencyReblock(
  projectPath: string,
  reopenedWpId: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void>;
```

```typescript
// Module-private helper — normalizes the raw _ledgerRoot parameter injected by the
// MCP SDK (which may be a RequestHandlerExtra object rather than a string, per
// constraint 58). Returns the string unmodified, or undefined for any non-string value.
function extractLedgerRoot(val: unknown): string | undefined;
```

```typescript
// Module-private helper — resolves a LedgerStore from the overloaded
// ledgerRootOrOpts parameter shared by propagateDependencyUnblock and
// propagateDependencyReblock. Returns the pre-constructed store when passed a
// { store } object; otherwise constructs a new LedgerStore from projectPath
// (and optionally the string ledger root). Eliminates the duplicated inline
// ternary that previously appeared in both propagate functions.
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore;
```

```typescript
export const _internal: {
  // Generates the human-readable status transition error guidance string.
  buildStatusTransitionGuidance: (from: WorkPackageStatus, to: WorkPackageStatus) => string;
  // Named export promoted as public API; _internal reference kept for test imports.
  propagateDependencyUnblock: (
    projectPath: string,
    completedWpId: string,
    ledgerRootOrOpts?: string | { store: LedgerStore }
  ) => Promise<void>;
  // Re-blocks non-COMPLETE, non-CANCELLED, non-BLOCKED dependents of a reopened WP.
  // Auto-cancels IN_PROGRESS pipelines on re-blocked WPs (auto_cancelled:true).
  // Appends a warning comment to the last pipeline of any COMPLETE dependents.
  // Sets status_changed_at = now() on each cascade-blocked WP before writing.
  // Resets root.synthesis_generated to false if any WPs were re-blocked.
  // Early-return guard: skips lock and all WP reads when no READY, IN_PROGRESS,
  // or COMPLETE WP has reopenedWpId in its dependencies.
  propagateDependencyReblock: (
    projectPath: string,
    reopenedWpId: string,
    ledgerRootOrOpts?: string | { store: LedgerStore }
  ) => Promise<void>;
  // Cycle detection used by createWorkPackage. BFS over the dependency graph
  // starting from the candidate new WP. Returns true if adding the WP with the
  // given dependencies would form a cycle; false otherwise. Private — not an
  // exported MCP tool.
  hasCycle: (
    newWpId: string,
    dependencies: string[],
    existingWps: WorkPackageSummary[]
  ) => boolean;
  // Core implementation of ledger_create_work_package. _ledgerRoot is a test-hook
  // normalized via extractLedgerRoot() (see §58 in constraints.md).
  createWorkPackage: (
    args: CreateWorkPackageArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_claim_work_package. Same _ledgerRoot guard as
  // createWorkPackage (§58).
  claimWorkPackage: (
    args: ClaimWorkPackageArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_update_work_package_status. Same _ledgerRoot
  // guard as createWorkPackage (§58).
  updateWorkPackageStatus: (
    args: UpdateWorkPackageStatusArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_reset_rework_count (PM-only). Same _ledgerRoot
  // guard as createWorkPackage (§58).
  resetReworkCount: (
    args: ResetReworkCountArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_update_acceptance_criteria (PM-only). Same
  // _ledgerRoot guard as createWorkPackage (§58).
  updateAcceptanceCriteria: (
    args: UpdateAcceptanceCriteriaArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
};
```

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
  // Core implementation of ledger_start_pipeline. Accepts an optional
  // _ledgerRoot test-hook for test isolation.
  startPipeline: (
    args: StartPipelineArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_complete_pipeline. Accepts an optional
  // _ledgerRoot test-hook for test isolation.
  completePipeline: (
    args: CompletePipelineArgs,
    _ledgerRoot?: string
  ) => Promise<MCPResult>;
  // Core implementation of ledger_cancel_pipeline. Exported to enable
  // unit tests that call the real function path via _internal.cancelPipeline
  // rather than simulating the underlying store mutation directly.
  cancelPipeline: (
    args: z.infer<typeof CancelPipelineSchema>
  ) => Promise<MCPResult>;
};
```

### `src/tools/pipeline.ts` — schema properties (in `_internal`)

The four pipeline Zod schemas are merged into the `_internal` export (see routing constants section above). Tests access them as `_internal.StartPipelineSchema`, `_internal.CompletePipelineSchema`, etc.

```typescript
// All of the following are properties of export const _internal:
_internal.StartPipelineSchema: ZodObject<...>;
_internal.CompletePipelineSchema: ZodObject<...>;
_internal.CancelPipelineSchema: ZodObject<...>;
_internal.UpdatePipelineProgressSchema: ZodObject<...>;
```

This enables unit-test validation of individual fields (e.g. the `work_package_id` regex `/^WP-\d{3,}$/`) in isolation, without a separate `_schemas` export (renamed per §53 in `constraints.md`).

### `src/tools/observations.ts` — schema access

```typescript
export const _internal: {
  AddObservationSchema: ZodObject<...>;
  AddProjectCommentSchema: ZodObject<...>;
};
```

Exposes the two observation Zod schemas for unit-test validation of individual fields (e.g. the `work_package_id` regex `/^WP-\d{3,}$/`) in isolation. Formerly `_schemas` — renamed to `_internal` per §53 in `constraints.md`.

---

## GUI Config Module

### `src/gui/config.ts` — runtime configuration

Manages runtime settings for the MCP server and GUI dashboard. Uses a **module-level singleton cache** populated at startup and kept fresh via `fs.watch()`.

```typescript
// Zod schema and inferred type
export const GuiConfigSchema: ZodObject<...>;
export type GuiConfig = {
  auto_handoff_enabled: boolean;  // When false, buildHandoffResponse() skips auto-handoff
  max_handoff_depth: number;      // Maximum auto-handoff chain depth (default 50)
  ledger_root: string;            // Resolved ledger root path (display-only in GUI)
  auto_archive_days: number;      // Days after COMPLETE before auto-archiving (0 = disabled; default 6)
};

export const DEFAULT_CONFIG: GuiConfig;  // { auto_handoff_enabled: true, max_handoff_depth: 50, ledger_root: '', auto_archive_days: 6 }

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

// Derived partial schema for GUI config PUT requests (gui/api.ts → handleUpdateConfig).
// Defined as GuiConfigSchema.omit({ ledger_root: true }).partial() — guarantees it automatically
// tracks GuiConfigSchema when new fields are added; ledger_root is excluded (read-only in GUI).
export const GuiConfigPartialSchema: ZodObject<...>;
export type GuiConfigPartial = Partial<Omit<GuiConfig, 'ledger_root'>>;
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

## Auto-Archive Module

### `src/gui/auto-archive.ts` — background archival service

Scans for stale COMPLETE projects and transitions them to ARCHIVED status automatically.
Called once on GUI server startup and then on a repeating interval.

**STDIO discipline:** all output uses `process.stderr.write` — safe for MCP server contexts where stdout is the protocol channel.

```typescript
/**
 * Scans all projects and archives eligible COMPLETE ones.
 *
 * Eligibility: status === 'COMPLETE' AND last_updated older than maxAgeDays days.
 * maxAgeDays === 0 → immediate no-op, returns [].
 * Per-project failures are caught and logged; the scan always continues.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param maxAgeDays  Age threshold in days. 0 disables archiving.
 * @returns           Slugs archived in this run.
 */
export async function runAutoArchive(
  ledgerRoot: string,
  maxAgeDays: number
): Promise<string[]>;

/**
 * Starts the background auto-archive timer.
 *
 * Reads auto_archive_days from getConfig() on each tick (runtime config changes
 * are respected without restarting the server). Runs tick() immediately on
 * startup, then every intervalMs milliseconds (default: 600 000 — 10 min).
 *
 * Idempotent: calling while a timer is already running is a no-op.
 * Call stopAutoArchiveTimer() first to restart with new settings.
 *
 * @param ledgerRoot  Absolute path to the ledger root directory.
 * @param intervalMs  Polling interval in milliseconds. Default: 600 000 (10 min).
 */
export function startAutoArchiveTimer(ledgerRoot: string, intervalMs?: number): void;

/**
 * Stops the auto-archive interval timer. Safe to call multiple times (no-op if not running).
 */
export function stopAutoArchiveTimer(): void;

/**
 * For testing only: resets the internal timer handle to null without clearing a
 * running interval. Always call stopAutoArchiveTimer() before _resetTimerForTesting()
 * in test teardown.
 * @internal
 */
export function _resetTimerForTesting(): void;
```

**Eligibility check (inside `runAutoArchive`):**
1. `status !== 'COMPLETE'` → skip.
2. `last_updated` unparseable → skip with stderr warning.
3. `Date.now() - lastUpdatedMs < maxAgeDays * 24 * 60 * 60 * 1000` → skip (not old enough).
4. Otherwise: acquire `withLock(store.storageDir)`, write `ARCHIVED` status to both root index and `.meta.json`, add slug to result array.

**Live-config tick pattern:** the tick closure calls `getConfig().auto_archive_days` on every execution, so a GUI-side change to `auto_archive_days` takes effect on the next interval without a server restart.

---

## GUI Run Log Module

### `src/gui/log-resolver.ts` — orchestrator run log locator and reader

Locates and reads orchestrator JSONL run log files on behalf of the run log API endpoints. Enforces path-traversal security for both directory listing and individual file reads.

```typescript
// Returned by findRunLogs() — one entry per matching log file.
export interface RunLogEntry {
  filename: string;   // Bare filename (no directory component), e.g. "20260323T143701-my-project.jsonl"
  is_active: boolean; // true when file does not end with a terminal action (run_end / run_error)
  is_dry_run: boolean; // true when the first JSONL line is a run_start event with dry_run: true; defaults to false on any read/parse error
}
```

> **Naming note:** `is_dry_run` is a computed summary property resolved once at list time. It is distinct from `dry_run`, the raw boolean property on the `run_start` event in the JSONL file.

```typescript
// Returns the configured logs directory, falling back to ~/.ai-insights/orchestrator-logs.
export function resolveOrchestratorLogsDir(configured: string | undefined): string;

// Lists .jsonl files whose names end with -{slug}.jsonl.
// Results are sorted newest-first by filename prefix. Self-heals stale runs (see below).
export async function findRunLogs(logsDir: string, slug: string): Promise<RunLogEntry[]>;

// Reads and parses a single JSONL log file with incremental-read support.
// Security: filename allowlist + resolved-path escape check. Throws ApiError FORBIDDEN / NOT_FOUND.
export async function readLogEntries(
  logsDir: string,
  filename: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }>;

// Moves orphaned JSONL log files from srcDir into destDir for the given slug.
// No-op if destDir already contains logs for the slug, or srcDir has none.
// Best-effort: individual rename failures are swallowed. Returns migrated count.
export async function migrateOrphanedLogs(
  destDir: string,
  srcDir: string,
  slug: string,
): Promise<number>;
```

**Self-healing stale runs (`findRunLogs`):**

An orchestrator run is considered *active* when its last non-empty JSONL line does not have `action: "run_end"` or `action: "run_error"`. Runs that are killed or crash without writing a terminal entry remain active on disk indefinitely.

On every call to `findRunLogs`, the function sorts results newest-first and then heals any run at index 1+ (i.e. not the newest) that still appears active. Healing appends a synthetic `run_error` entry:

```json
{"action": "run_error", "error": "Run terminated without completing (healed by GUI on next page load)", "ts": "<ISO timestamp>"}
```

The file is updated on disk so subsequent calls skip the heal entirely. Healing failures are swallowed — best-effort only, never surfaced to callers. The newest run is never healed regardless of its active state.

**Empty-file rule:** a file with zero non-empty lines is treated as active (the orchestrator has just created it and not yet written any events).

**Security guards (`readLogEntries`):**
- `filename` must match `/^[A-Za-z0-9._-]+$/` (allowlist)
- `filename` must not contain `..` or `/`
- `resolve(logsDir + filename)` must start with `resolve(logsDir) + '/'`

### `src/gui/handlers/run-log-handlers.ts` — run log API handlers

Thin wrappers that add slug validation before delegating to `log-resolver.ts`.

```typescript
// GET /api/projects/:slug/runs → sorted RunLogEntry[] (heals stale runs as a side-effect)
// legacyLogsDir: if supplied and logsDir has no logs for slug, orphaned files are moved in before listing.
export async function handleListRunLogs(slug: string, logsDir: string, legacyLogsDir?: string): Promise<RunLogEntry[]>;

// GET /api/projects/:slug/runs/:filename → { entries, totalLines }
export async function handleGetRunLog(
  slug: string,
  filename: string,
  logsDir: string,
  afterLine?: number
): Promise<{ entries: unknown[]; totalLines: number }>;
```

Slug validation: throws `ApiError NOT_FOUND` for slugs that are empty, contain `/`, or contain `..`.

---

## GUI Queue Helpers

### `src/gui/queue/types.ts` — shared queue type definitions and constants (WP-A)

Leaf module. Imports only from `compute-effective-status.ts`. No I/O.

```typescript
/** Filename of the shared run queue within the orchestrator logs directory. */
export const QUEUE_FILENAME = '.run-queue.json';

export interface RawQueueEntry {
  id: string; pid: number; planPath: string; expectedSlug: string;
  startedAt: string; status: 'pending';
}

export interface QueueEntry extends RawQueueEntry {
  effectiveStatus: EffectiveStatus; // from compute-effective-status.ts
  progress: string | null;
  lastAction: string | null;
  logFilename: string | null;
}

export interface KillResult { killed: boolean; }

export interface PreflightResult {
  name: string; pass: boolean; detail: string; fix?: string;
}

export interface StartResult {
  checks: PreflightResult[]; started: boolean; pid?: number;
  runStatusFilename?: string;
}

export interface RunStatus {
  slug: string; result: 'SUCCESS' | 'ERROR'; error: string | null;
  logFilename: string; durationS: number | null;
}
```

---

### `src/gui/queue/validate-entry.ts` — pure `RawQueueEntry` type-guard (WP-001 rework, WP-003)

Pure module. No I/O, no side effects. Imports only `RawQueueEntry` from `./types.js`. Extracted from `get-queue.ts` so that `isRawQueueEntry()` can be unit-tested directly without filesystem setup.

```typescript
/**
 * Type-guard that validates a raw JSON value as a `RawQueueEntry`.
 *
 * Returns `true` only when **all five** of the following rules pass:
 *
 * 1. **Type check** — `entry` is a non-null object.
 * 2. **String fields** — `id`, `planPath`, and `startedAt` are strings; `id` must be
 *    non-empty and non-whitespace-only (guard: `id.trim().length > 0`).
 * 3. **PID integer** — `pid` is a finite integer (rejects floats).
 * 4. **PID positive** — `pid` is greater than zero (rejects zero and negatives).
 * 5. **Non-empty slug** — `expectedSlug` is a non-empty, non-whitespace-only string
 *    (rejects missing, empty-string, and whitespace-only slugs).
 *    Guard: `expectedSlug.trim().length > 0` (whitespace-only slugs are rejected).
 *
 * Used by `readQueueFile` in `get-queue.ts` to filter the parsed JSON array
 * before it is returned as `RawQueueEntry[]`.
 *
 * @returns `true` when every rule passes; `false` otherwise.
 */
export function isRawQueueEntry(entry: unknown): entry is RawQueueEntry;
```

---

### `src/gui/queue/get-queue.ts` — queue reading internals and public `getQueue()` (WP-B)

Async, I/O (reads queue file and project ledger files). Imports from `./types.js`, `./validate-entry.js`, `./resolve-progress.js`, and `./compute-effective-status.js`. The `isRawQueueEntry` validator was extracted to `validate-entry.ts` (WP-003) — `get-queue.ts` imports and delegates to it; the filter call site is unchanged.

```typescript
/**
 * Returns true if the process with `pid` exists on this machine.
 * Exported for use by queue-mutation functions in orchestrator-manager.ts.
 */
export function isProcessAlive(pid: number): boolean;

/**
 * Reads and parses <logsDir>/.run-queue.json.
 * Returns [] on any I/O or parse error. Never writes.
 * Exported for use by checkNoConflict in orchestrator-manager.ts.
 */
export async function readQueueFile(logsDir: string): Promise<RawQueueEntry[]>;

/**
 * Returns whether the project identified by `slug` has a ledger entry
 * and whether synthesis has been generated for it. Fail-safe.
 * Exported for use by killQueueEntry/dismissQueueEntry in orchestrator-manager.ts.
 */
export async function getProjectLedgerStatus(
  ledgerRoot: string,
  slug: string,
): Promise<{ exists: boolean; synthesisGenerated: boolean }>;

/**
 * Reads the shared orchestrator run queue and returns all active entries
 * enriched with computed lifecycle state and JSONL progress summaries.
 * Entries for completed projects (synthesis_generated === true) are excluded.
 * Fail-safe: never throws.
 */
export async function getQueue(params: {
  logsDir: string;
  ledgerRoot: string;
}): Promise<QueueEntry[]>;
```

---

### `src/gui/queue/format-progress-entry.ts` — pure JSONL entry → progress string mapper (WP-001, WP-D)

Stateless, no I/O. Maps a single JSONL log entry to a human-readable string.

```typescript
/**
 * Maps a single JSONL log entry to a human-readable progress string.
 *
 * Returns null for event types that do not produce a useful summary
 * (heartbeat, unrecognised action). Exported for unit testing.
 *
 * Handled event types: run_start, stage_start, stage_complete,
 * progress_snapshot, tool_call, wp_complete, wp_status_change, run_end,
 * run_error, signal_shutdown, heartbeat (→ null), unknown (→ null).
 *
 * Note: tool_call with tool_name === '' is treated the same as absent
 * (returns 'Tool call' without a name suffix). (WP-D)
 */
export function formatProgressEntry(entry: Record<string, unknown>): string | null;
```

### `src/gui/queue/resolve-progress.ts` — async progress resolver (WP-001)

Reads the most recent JSONL log file for a slug and returns a structured `ProgressResolution`. Also re-exports `formatProgressEntry` as a convenience barrel.

**Re-export note:** This module intentionally acts as a barrel for both `resolveProgress` and `formatProgressEntry`. `orchestrator-manager.ts` further re-exports both for backward compat (see the two-level chain description above).

```typescript
/**
 * Structured result returned by resolveProgress().
 */
export interface ProgressResolution {
  /** Human-readable summary of the last meaningful JSONL log event, or null. */
  summary: string | null;
  /** The `action` field of the JSONL entry that produced `summary`, or null. */
  lastAction: string | null;
  /** Basename of the JSONL log file read, or null when no matching file found. */
  logFilename: string | null;
  /**
   * true when lastAction is non-null and not 'run_start', indicating that
   * at least one meaningful pipeline stage has been entered.
   */
  hasStageActivity: boolean;
}

// Re-exported from format-progress-entry.ts for caller convenience:
export { formatProgressEntry } from './format-progress-entry.js';

/**
 * Finds the most recent JSONL log file for `slug` in `logsDir` and returns
 * a ProgressResolution describing the last meaningful event.
 *
 * Returns a resolution with all null/false fields when:
 *   - No matching log file exists.
 *   - The file is unreadable or empty.
 *   - All entries are non-summarisable (e.g. only heartbeats).
 *
 * logFilename is populated even when the file is readable but contains
 * only non-summarisable events (non-null while summary is null).
 *
 * Fail-safe: never throws — all I/O errors return safe defaults.
 */
export async function resolveProgress(
  logsDir: string,
  slug:    string,
): Promise<ProgressResolution>;
```

---

## GUI Orchestrator Manager

### `gui/orchestrator-manager.ts` — queue mutator, orchestrator launcher, backward-compat re-export hub (WP-005, WP-006, WP-007, WP-A, WP-B)

Provides two areas of functionality (queue reading delegated to `src/gui/queue/get-queue.ts`):

1. **Queue mutation** — `killQueueEntry()` terminates a pending orchestrator process (SIGTERM → wait → SIGKILL) and removes its entry from the queue file; `dismissQueueEntry()` removes a dead entry from the queue file without signalling. Both operations use atomic tmp-then-rename writes.
2. **Preflight and launch** — validates workspace readiness via 7 preflight checks and optionally spawns a detached orchestrator process (`startOrchestrator`).

**Re-export hub:** all types, `QUEUE_FILENAME`, `getQueue`, `formatProgressEntry`, `ProgressResolution`, `EffectiveStatus` are re-exported from their respective `src/gui/queue/` sub-modules. Callers importing from `gui/orchestrator-manager.ts` continue to work unchanged.

**Re-export chain (WP-001, WP-A, WP-B):** `formatProgressEntry` lives in `src/gui/queue/format-progress-entry.ts`. `src/gui/queue/resolve-progress.ts` imports and re-exports it as a convenience barrel alongside `ProgressResolution` and `resolveProgress`. `src/gui/queue/types.ts` holds all 6 shared type definitions (WP-A). `src/gui/queue/get-queue.ts` holds `getQueue()` and all queue-reading internals (WP-B). `orchestrator-manager.ts` re-exports everything from the queue sub-modules for backward compatibility with callers that import from this module. New code should import directly from the relevant `src/gui/queue/` sub-module.

**Lifecycle state transitions (computed in-memory, never persisted):**

| Process alive | Project exists in ledger | Effective status |
|---|---|---|
| yes | no | `pending` |
| yes | yes | `started` |
| no | no | `dead` |
| no | yes | `started` |
| — | synthesis_generated = true | excluded from result |

**Types** — all defined in `src/gui/queue/types.ts` and re-exported here for backward compat. See the `types.ts` section above for full signatures: `QUEUE_FILENAME`, `RawQueueEntry`, `QueueEntry`, `KillResult`, `PreflightResult`, `StartResult`, `RunStatus`.

```typescript
/**
 * Runs 6 preflight checks and optionally spawns a detached orchestrator process.
 *
 * All checks (plan-basename, plan-file, no-conflict, venv, env, mcp-dist)
 * run in parallel. Environment checks (venv, env, mcp-dist)
 * always run. All applicable checks execute in parallel via Promise.all.
 *
 * - dryRun: true  → returns check results without spawning.
 * - Any check fails → returns results with started: false.
 * - All pass + not dry-run → spawns detached process, returns started: true + pid.
 *
 * Binary resolution: orchestrator/.venv/Scripts/orchestrate.exe (Windows),
 * orchestrator/.venv/bin/orchestrate (Unix).
 * Spawn options: detached: true, stdio: 'ignore', env includes PYTHONUTF8='1';
 * child.unref() called immediately (survives GUI server exit).
 *
 * @param planPath       Absolute path to the plan .md file.
 * @param workspaceRoot  Absolute path to the workspace root directory.
 * @param dryRun         When true, skip spawning even if all checks pass. Default: false.
 */
export async function startOrchestrator(
  planPath:      string,
  workspaceRoot: string,
  dryRun?:       boolean,
): Promise<StartResult>;

/**
 * Terminates the orchestrator process for a pending queue entry and removes
 * the entry from the queue file.
 *
 * Only operates on effectively-pending entries (alive && no project in ledger).
 * Returns { killed: false } without throwing when:
 *   - The entry is not found.
 *   - The entry's effective status is `started` or `dead`.
 *
 * When killed === true, the procedure is:
 *   1. SIGTERM sent to the process.
 *   2. Wait up to SIGTERM_WAIT_MS ms.
 *   3. SIGKILL sent if the process is still alive after the wait.
 *   4. Entry removed from the queue file atomically (tmp-then-rename).
 *   5. `.orchestrator.lock` removed from the plan directory.
 *
 * TOCTOU safety: ESRCH on SIGTERM delivery is swallowed — process already gone.
 * PID validation: isRawQueueEntry() rejects zero, negative, and float PIDs.
 * Slug validation: also rejects entries with an empty-string expectedSlug.
 */
export async function killQueueEntry(params: {
  id: string;          // Queue entry ID to kill.
  logsDir: string;     // Absolute path to the orchestrator logs directory.
  ledgerRoot: string;  // Absolute path to the central ledger root.
}): Promise<KillResult>;

/**
 * Removes a dead queue entry from the queue file on disk.
 *
 * Only operates on effectively-dead entries (!alive && no project in ledger).
 * Returns (void) without throwing when entry is not found or not dead.
 * Queue file write is atomic (tmp-then-rename).
 */
export async function dismissQueueEntry(params: {
  id: string;          // Queue entry ID to dismiss.
  logsDir: string;     // Absolute path to the orchestrator logs directory.
  ledgerRoot: string;  // Absolute path to the central ledger root.
}): Promise<void>;
```

**Preflight checks (6 total):**

| Name | Description |
|---|---|
| `plan-basename` | Validates plan folder matches `YYYY-MM-DD-{project-name}` via `planFolderBasename()` |
| `plan-file` | Verifies the plan `.md` file exists on disk |
| `no-conflict` | Checks the plan is not already registered in the run queue |
| `venv` | Verifies `.venv` directory and `orchestrate` binary exist |
| `env` | Verifies `orchestrator/.env` contains `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` |
| `mcp-dist` | Verifies `mcp-server/dist/index.js` exists and is newer than all `mcp-server/src/` files |


**Fail-safe pattern:** `readQueueFile`, `getProjectLedgerStatus`, and `resolveProgress` all
return safe defaults on any I/O or JSON parse error — I/O failures never propagate to callers.
`isProcessAlive(pid)` uses `process.kill(pid, 0)` (zero-signal check); EPERM is caught and
treated as dead (cross-process owned PID — known limitation, acceptable for non-critical GUI
monitoring).

**Progress resolution:** `resolveProgress` finds the most recent JSONL log file for a slug
(newest-first via lexicographic sort on ISO-prefixed filenames) and walks backwards to the last
summarisable event.

---

## GUI API Module

### `gui/api.ts` — REST API route handlers

Pure async handler functions called by the HTTP server (`gui/server.ts`). All handlers accept parsed parameters and return typed result objects, or throw `ApiError`.

**Path-traversal guards:** three module-private guard functions in `gui/api.ts` protect against path-traversal attacks:

- `assertSafeSlug(slug: string): void` — applied as the **first statement** in all slug-bearing handlers (`handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleGetWorkPackageOverview`, `handleDeleteProject`, `handleArchiveProject`, `handleUnarchiveProject`, `handleMarkProjectComplete`, `handleGetPlanDocument`, `handleGetSynthesisDocument`, `handleResetProject`, `handleGetProjectHealth`, `handleRenameProject`, `handleListChunks`, `handleGetChunkFile`).
- `assertSafeWpId(wpId: string): void` — applied as the **second statement** in `handleGetWorkPackage`, immediately after `assertSafeSlug`.
- `assertSafeQueueId(id: string): void` — applied as the **first statement** in `handleOrchestratorKill` and `handleOrchestratorDismiss`; `id` is extracted from the URL path via `decodeURIComponent()` in `server.ts` **before** the guard is called, so percent-encoded slashes (`%2F`) are decoded first and then caught.

All three guards apply identical rejection criteria: throw `ApiError` with code `NOT_FOUND` (HTTP 404) if the value is empty, contains `'/'`, or contains `'..'`. Returning `NOT_FOUND` rather than `FORBIDDEN` is intentional — avoids leaking file-system structural information to potential attackers.

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

// Enriched project summary — extends ProjectMeta with WP counters, resolved project name, and repository name.
// Returned inside ProjectListEnvelope.projects. Fields default to 0 / null on per-project read failure so one
// bad project never breaks the full response.
export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;   // from root index; defaults to 0 on read failure
  pending_work_packages: number; // from root index; defaults to 0 on read failure
  project_name: string | null;   // from package.json → composer.json → pyproject.toml; null on failure
  repository_name: string | null; // last path segment of inferProjectRootFromPlanPath(meta.plan_path); null if not detectable
}

// Validated query parameters for GET /api/projects.
// All fields are optional — unrecognised or missing values fall back to listed defaults.
export type ProjectSortField = 'last_updated' | 'date_created' | 'title' | 'slug' | 'status' | 'done';
export interface ProjectListParams {
  page?: number | string;          // default 1; clamped >=1
  limit?: number | string;         // default 50; clamped [1,200]; 0 treated as 1
  status?: string;                  // 'ACTIVE' (default) | 'ALL' | any ProjectStatus value
  search?: string;                  // case-insensitive substring match on slug, project_name, repository_name
  sort?: ProjectSortField;          // default 'last_updated'
  dir?: 'asc' | 'desc';            // default 'desc'
}

// Paginated response envelope for GET /api/projects.
export interface ProjectListEnvelope {
  projects: ProjectSummary[];       // current page slice
  total: number;                    // total matching projects after search + status filters
  page: number;                     // current page number (1-based)
  limit: number;                    // effective page size
  total_pages: number;              // Math.max(1, Math.ceil(total/limit))
  status_counts: Record<string, number>; // per-status counts computed from search-filtered set BEFORE status filter
}

// GET /api/projects — returns a paginated envelope of enriched project summaries.
// Processing pipeline (in order):
//   1. Enrich all projects (WP counters, project_name, repository_name)
//   2. Apply search filter (case-insensitive substring on slug, project_name, repository_name)
//   3. Compute status_counts from search-filtered set (BEFORE status filter — supports badge counts)
//   4. Apply status filter (ACTIVE excludes only ARCHIVED; ALL includes everything; specific status = exact match)
//   5. Sort by sort+dir
//   6. Paginate: page/limit → return projects slice + envelope metadata
// Cache fast-path: if meta.total_work_packages !== undefined && meta.project_name !== undefined,
// the handler skips per-project root index + manifest file reads. Falls back to I/O for legacy .meta.json.
export async function handleListProjects(
  ledgerRoot: string,
  rawParams?: ProjectListParams
): Promise<ProjectListEnvelope>;

// GET /api/projects/:slug — returns combined root index + meta + optional timing aggregate
// ProjectDetail = RootIndex & { meta: ProjectMeta; project_name: string | null;
//   timing?: { project_elapsed_ms: number | null; total_active_ms: number; pipeline_runs: number }; }
// timing is computed server-side: project_elapsed_ms = last_updated - date_created (ms);
// total_active_ms = sum of duration_ms across all WP pipelines; pipeline_runs = count of pipelines with duration_ms set.
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

// Enriched per-stage status object within a WpOverviewEntry.
// Values for status: 'pending' (not yet started), 'in-progress', 'pass', 'fail'.
export interface WpPipelineStage {
  type: string;         // e.g. 'implementation'
  agent: string;        // e.g. 'Developer' — resolved from PIPELINE_AGENT_MAP
  status: 'pending' | 'in-progress' | 'pass' | 'fail';  // latest pipeline entry for this stage; 'pending' when absent
  rework_count: number; // rework_counts[type] ?? 0
}

// Enriched work-package summary returned by handleGetWorkPackageOverview.
export interface WpOverviewEntry {
  work_package_id: string;
  status: string;                // WP-level status
  assigned_to: string | null;    // current agent
  dependencies: string[];
  pipeline_stages: WpPipelineStage[];  // ordered per CANONICAL_PIPELINE_ORDERING
  acceptance_criteria: { met: number; total: number };
  blocked_by?: { type: string; description: string };
}

// GET /api/projects/:slug/work-packages/overview — enriched WP summary array
// Reads all WP detail files, resolves active_pipeline_stages (falling back to DEFAULT_PIPELINE_STAGES),
// orders stages per CANONICAL_PIPELINE_ORDERING, resolves per-stage status (latest entry wins),
// computes AC progress, propagates blocked_by, and propagates rework_counts.
// Corrupt or missing WP detail files are skipped (same pattern as handleGetProjectHealth).
// Route registered BEFORE the /:wpId catch-all in server.ts to avoid ambiguous matching.
export async function handleGetWorkPackageOverview(
  ledgerRoot: string,
  slug: string
): Promise<WpOverviewEntry[]>;

// PATCH /api/projects/:slug — renames a project's title, slug, or both.
//
// Module-level schema (exported for tests):
//   export const RenameBodySchema = z.object({
//     title: z.string().min(1).max(200).optional(),
//     slug:  z.string().min(1).max(200).optional(),
//   }).refine(d => d.title !== undefined || d.slug !== undefined, {
//     message: 'At least one of title or slug must be provided.',
//   });
//
// Body: { title? }, { slug? }, or { title, slug } — at least one required.
// Returns the updated ProjectMeta on success (200).
//   – When slug is changed, ProjectMeta.slug carries the new value; the
//     frontend uses this to navigate to #/projects/{newSlug}.
// Throws VALIDATION_ERROR when body is empty, fields fail constraints, or slug
//   does not match SAFE_SLUG_REGEX (^[a-z0-9][a-z0-9-]*$).
// Throws NOT_FOUND when the project slug does not exist.
// Throws CONFLICT when the target slug directory already exists on disk
//   (catch block uses instanceof SlugConflictError — no string-prefix matching).
// Operations: title first (LedgerStore.updateTitle()), then slug
//   (LedgerStore.renameSlug()). Neither operation modifies last_updated.
// Do not reuse the LedgerStore instance after renameSlug() — storageDir is stale.
//
// Same-slug no-op: sending { slug: currentSlug } returns HTTP 200 with unchanged
//   metadata. The handler pre-checks newSlug === slug and materialises latestMeta
//   via store.readProjectMeta() without calling renameSlug().
export async function handleRenameProject(
  ledgerRoot: string,
  slug: string,
  body: unknown
): Promise<ProjectMeta>;

// DELETE /api/projects/:slug — permanently removes a COMPLETE or ARCHIVED project; throws FORBIDDEN for any other status
export async function handleDeleteProject(
  ledgerRoot: string,
  slug: string
): Promise<{ deleted: true; slug: string }>;

// POST /api/projects/:slug/archive — transitions a COMPLETE project to ARCHIVED status.
// Both .meta.json and project-ledger.json are updated atomically within a single withLock scope.
// Throws NOT_FOUND if the project does not exist.
// Throws VALIDATION_ERROR (400) if the project's current status is not COMPLETE.
export type ArchiveProjectResult = { archived: true; slug: string };
export async function handleArchiveProject(ledgerRoot: string, slug: string): Promise<ArchiveProjectResult>;

// POST /api/projects/:slug/unarchive — transitions an ARCHIVED project back to COMPLETE status.
// Both .meta.json and project-ledger.json are updated atomically within a single withLock scope.
// Throws NOT_FOUND if the project does not exist.
// Throws VALIDATION_ERROR (400) if the project's current status is not ARCHIVED.
export type UnarchiveProjectResult = { unarchived: true; slug: string };
export async function handleUnarchiveProject(ledgerRoot: string, slug: string): Promise<UnarchiveProjectResult>;

// POST /api/projects/:slug/complete — forces all non-CANCELLED WPs and the project itself to COMPLETE status.
// All WP detail files and the root index are updated atomically within a single withLock scope.
// Appends an admin_action project comment (agent: 'GUI') recording the action.
// Throws NOT_FOUND if the project does not exist.
// Throws FORBIDDEN (403) if the project is currently ARCHIVED (unarchive first).
export interface MarkProjectCompleteResult {
  marked_complete: true;
  work_packages_completed: string[];   // IDs of WPs set to COMPLETE (CANCELLED WPs excluded)
  project_comment_added: string;       // note string appended as project_comments entry
}
export async function handleMarkProjectComplete(ledgerRoot: string, slug: string): Promise<MarkProjectCompleteResult>;

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

// GET /api/server-info — stale-instance detection (no auth required)
// Handled via a **special-case block** in server.ts before matchRoute() — needs the
// bootVersions closure captured once by main() at startup.
//
// Response shape:
//   { stale: boolean, bootVersions: WorkspaceVersions, diskVersions: WorkspaceVersions }
//
// `stale` is true when any of `mcpServer`, `personas`, or `orchestrator` version strings
// differ between the boot-time snapshot and the current on-disk values read at request time.
//
// bootVersions=null fallback: when handleRequest() is called without a bootVersions argument
// (non-production callers), captureWorkspaceVersions() is used for both boot and disk,
// so stale is always false in that code path.
//
// WorkspaceVersions: { mcpServer: string; personas: string; orchestrator: string }
//   — mcpServer sourced from mcp-server/package.json
//   — personas  sourced from personas/package.json
//   — orchestrator sourced from orchestrator/pyproject.toml
//
// All three reads are synchronous (readFileSync) on each request.
// CORS and security headers are applied via sendJson().

// GET /api/config — returns in-memory config (no disk read)
export async function handleGetConfig(configPath: string): Promise<GuiConfig>;

// PUT /api/config — validates body (strips ledger_root), writes atomically, returns updated config
export async function handleUpdateConfig(configPath: string, body: unknown): Promise<GuiConfig>;

// POST /api/projects/:slug/reset — semi-intelligent project reset
// Body (validated by ResetRequestSchema / Zod):
//   { dry_run: boolean; decisions?: Record<string, { action: 'reset'|'skip'|'cancel'; reset_criteria?: boolean }> }
// dry_run = true  → returns ProjectResetDiagnosis (no writes)
// dry_run = false → decisions required (missing or empty → 400); returns ProjectResetResult
// Slug validation: assertSafeSlug + ledgerDirExists; missing/invalid slug → 404
// Handled via a **dedicated POST block** in server.ts (ahead of matchRoute()) because the
// endpoint requires async body parsing via readBody().
export async function handleResetProject(
  ledgerRoot: string,
  slug: string,
  body: unknown
): Promise<ProjectResetDiagnosis | ProjectResetResult>;

// GET /api/projects/:slug/health — lightweight read-only pipeline health summary
// Delegates to analyzeProjectForReset() — same logic as the reset modal dry-run path, zero duplication.
// Returns a summary object; never writes any files.
// Slug validation: assertSafeSlug + ledgerDirExists; missing/invalid slug → 404
export interface ProjectHealthSummary {
  work_packages_needing_reset: number;  // WPs that need reset (IN_PROGRESS/COMPLETE with missing stages)
  work_packages_healthy: number;        // WPs with all stages passing or skipped (CANCELLED/BLOCKED/READY)
  work_packages_skipped: number;        // CANCELLED WPs excluded from analysis
  total_work_packages: number;          // raw count from root index
}
export async function handleGetProjectHealth(
  ledgerRoot: string,
  slug: string
): Promise<ProjectHealthSummary>;

// GET /api/projects/:slug/dialogues[?wp=WP-001]
// Returns an array of dialogue filenames from the project's orchestrator/dialogues/ directory.
// slug is validated via assertSafeSlug(). Returns [] when the directory is absent (no error thrown).
// Optional ?wp= query parameter: when provided, only filenames starting with '{wpId}-' are returned.
// All returned filenames are sorted alphabetically.
export async function handleListDialogues(
  ledgerRoot: string,
  slug: string,
  wpId?: string
): Promise<string[]>;

// GET /api/projects/:slug/dialogues/:filename
// Returns the raw Markdown content of a single dialogue file.
// Security (two-layer path-traversal defence):
//   1. Primary allowlist: DIALOGUE_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/ — rejects any filename
//      containing '.', '/', or other special characters (including percent-decoded traversals).
//   2. Defence-in-depth: path.resolve() prefix check ensures the resolved file path stays inside
//      the project's orchestrator/dialogues/ directory.
// Both layers throw ApiError NOT_FOUND on violation. slug validated via assertSafeSlug().
export async function handleGetDialogueFile(
  ledgerRoot: string,
  slug: string,
  filename: string
): Promise<string>;

// ---------------------------------------------------------------------------
// Chunk endpoints — JSONL streaming capture (gui/api.ts)
// ---------------------------------------------------------------------------

// CHUNKS_DIR constant (src/utils/constants.ts)
// Relative path from the per-project ledger storage root to the chunk files directory.
// Usage: path.join(ledgerRoot, slug, CHUNKS_DIR)
//   → {ledgerRoot}/{slug}/orchestrator/chunks/
// The orchestrator's ChunkWriter writes JSONL files to this path; this constant keeps
// the path in sync between the MCP server and the orchestrator.
export const CHUNKS_DIR: 'orchestrator/chunks';

// Structured representation of a single chunk file, parsed from the filename convention
// {WP_ID}-{stage}-r{N}.jsonl.  wp_id and stage are empty strings for non-conforming names.
export interface ChunkEntry {
  filename: string;
  wp_id: string;   // e.g. 'WP-001'
  stage: string;   // e.g. 'developer'
}

// GET /api/projects/:slug/chunks[?wp=WP-001]
// Returns an array of structured ChunkEntry objects from the project's
// orchestrator/chunks/ directory.  Each entry includes the filename plus the
// wp_id and stage parsed from the {WP_ID}-{stage}-r{N}.jsonl convention.
// slug is validated via assertSafeSlug().  Returns [] when the directory is absent (no error thrown).
// Optional ?wp= query parameter: when provided, only filenames starting with '{wpId}-' are returned
// (wpId validated against WP_ID_RE — invalid values return []).
// All returned entries are sorted alphabetically by filename.
export async function handleListChunks(
  ledgerRoot: string,
  slug: string,
  wpId?: string
): Promise<ChunkEntry[]>;

// GET /api/projects/:slug/chunks/:filename
// Returns the raw JSONL content of a single chunk file as a UTF-8 string.
// Security (two-layer path-traversal defence, identical to handleGetDialogueFile):
//   1. Primary allowlist: CHUNK_FILENAME_RE = /^[A-Za-z0-9_-]+\.jsonl$/ — rejects any filename
//      containing '.', '/', or other special characters.
//   2. Defence-in-depth: path.resolve() prefix check ensures the resolved file path stays inside
//      the project's orchestrator/chunks/ directory.
// Both layers throw ApiError NOT_FOUND on violation. slug validated via assertSafeSlug().
export async function handleGetChunkFile(
  ledgerRoot: string,
  slug: string,
  filename: string
): Promise<{ content: string }>;

// GET /api/projects/:slug/chunks/:filename/rendered
// Convenience route: calls handleGetChunkFile then pipes content through
// renderChunksToMarkdown() (gui/chunk-renderer.ts).
// Returns { content: string } where content is the rendered Markdown.
// Security and error handling are inherited from handleGetChunkFile.
// Route is dispatched from gui/server.ts before the raw-file route (different segment count:
// rest.length === 5 vs. rest.length === 4 — no ordering dependency).

// ---------------------------------------------------------------------------
// Orchestrator lifecycle handlers (WP-008)
// ---------------------------------------------------------------------------

// POST /api/orchestrator/start
// Validates body.planPath (required, string) and optional dryRun (boolean, default false),
// then runs 7 preflight checks via startOrchestrator().
// When dryRun=false and all checks pass, spawns a detached orchestrator process.
// Throws VALIDATION_ERROR when body.planPath is absent or not a string.
// Also throws VALIDATION_ERROR when body is not a JSON object (non-object, null).
// Note: an array body passes the non-null object check and falls through to the planPath
// check, producing a 'body.planPath is required' error rather than 'body must be an object'
// — non-blocking because array bodies cannot occur in practice for this endpoint.
export async function handleOrchestratorStart(
  workspaceRoot: string,
  body: unknown,
): Promise<StartResult>;

// GET /api/orchestrator/queue
// Returns all active orchestrator queue entries enriched with computed
// lifecycle state and JSONL progress summaries. Delegates entirely to
// getQueue() from gui/orchestrator-manager.ts.
// Returns [] when the queue file or its parent directory does not exist.
// Fail-safe: all internal I/O errors return safe defaults — never throws.
export async function handleGetOrchestratorQueue(
  logsDir: string,
  ledgerRoot: string,
): Promise<QueueEntry[]>;

// POST /api/orchestrator/kill/:id
// Terminates the orchestrator process for an effectively-pending queue entry
// and removes it from the queue file. Delegates to killQueueEntry().
// Returns { killed: false } without throwing when the entry is not found or
// its effective status is not 'pending'.
// assertSafeQueueId() applied first; id passed in by server.ts after decodeURIComponent().
export async function handleOrchestratorKill(
  id: string,
  logsDir: string,
  ledgerRoot: string,
): Promise<KillResult>;
// where KillResult = { killed: boolean } (from gui/orchestrator-manager.ts)

// POST /api/orchestrator/dismiss/:id
// Removes a dead queue entry from the queue file on disk. Delegates to dismissQueueEntry().
// Resolves without throwing when the entry is not found or its effective status is not 'dead'.
// server.ts sends HTTP 204 No Content on success (void return).
// assertSafeQueueId() applied first; id passed in by server.ts after decodeURIComponent().
export async function handleOrchestratorDismiss(
  id: string,
  logsDir: string,
  ledgerRoot: string,
): Promise<void>;
```

**HTTP status code mapping** (implemented in `gui/server.ts`):
| `ApiError.code` | HTTP Status |
|-----------------|-------------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| (unhandled) | 500 |

---

## GUI HTTP Server

### `gui/server.ts` — standalone HTTP server process

A minimal Node.js HTTP server using `node:http` (no external HTTP frameworks). Runs as a **separate process** from the MCP server — has no STDIO restrictions and writes startup/info messages to `stdout`.

**Start:** `npm run gui` (runs `tsx gui/server.ts`)

**CLI arguments:**
- `--port <n>` — listen port (default: `3420`)
- `--ledger-dir <path>` — ledger root path; delegates to `resolveLedgerRoot()` which reads from `process.argv`

**Startup sequence:** parse CLI args → `resolveLedgerRoot()` → `readConfigFromDisk(configPath)` → `startConfigWatcher()` → `startAutoArchiveTimer(ledgerRoot)` → `createServer()` → `listen(port)`

**API route table:**

| Method | Pattern | Handler |
|--------|---------|--------|
| GET | `/api/projects` | `handleListProjects` |
| GET | `/api/projects/:slug` | `handleGetProject` |
| PATCH | `/api/projects/:slug` | `handleRenameProject` (body parsed inline; placed before POST reset handler) |
| GET | `/api/projects/:slug/work-packages` | `handleListWorkPackages` |
| GET | `/api/projects/:slug/work-packages/overview` | `handleGetWorkPackageOverview` |
| GET | `/api/projects/:slug/work-packages/:wpId` | `handleGetWorkPackage` |
| GET | `/api/projects/:slug/runs` | `handleListRunLogs` — sorted `RunLogEntry[]`; heals stale runs as side-effect |
| GET | `/api/projects/:slug/runs/:filename` | `handleGetRunLog` — `{ entries, totalLines }`; optional `?after=N` for incremental polling |
| GET | `/api/projects/:slug/dialogues` | `handleListDialogues` (optional `?wp=WP-001` filter) |
| GET | `/api/projects/:slug/dialogues/:filename` | `handleGetDialogueFile` (filename allowlist + resolve() prefix guard) |
| GET | `/api/projects/:slug/chunks` | `handleListChunks` (optional `?wp=WP-001` filter) |
| GET | `/api/projects/:slug/chunks/:filename` | `handleGetChunkFile` (filename allowlist + resolve() prefix guard; returns raw JSONL) |
| GET | `/api/projects/:slug/chunks/:filename/rendered` | `handleGetChunkFile` + `renderChunksToMarkdown` (returns rendered Markdown) |
| GET | `/api/projects/:slug/plan` | `handleGetPlanDocument` |
| GET | `/api/projects/:slug/synthesis` | `handleGetSynthesisDocument` |
| GET | `/api/projects/:slug/health` | `handleGetProjectHealth` |
| DELETE | `/api/projects/:slug` | `handleDeleteProject` |
| POST | `/api/projects/:slug/archive` | `handleArchiveProject` |
| POST | `/api/projects/:slug/unarchive` | `handleUnarchiveProject` |
| POST | `/api/projects/:slug/complete` | `handleMarkProjectComplete` |
| GET | `/api/config` | `handleGetConfig` |
| PUT | `/api/config` | `handleUpdateConfig` (body parsed inline) |
| GET | `/api/insights` | `handleGetInsights` |
| GET | `/api/server-info` | special-case block in `server.ts` before `matchRoute()` — returns `{ stale, bootVersions, diskVersions }` (stale-instance detection) |
| POST | `/api/projects/:slug/reset` | `handleResetProject` (body parsed via `readBody()`) |
| GET | `/api/orchestrator/queue` | `handleGetOrchestratorQueue` — via `matchRoute()`; returns enriched `QueueEntry[]` |
| POST | `/api/orchestrator/start` | `handleOrchestratorStart` — special-case block before `matchRoute()`; body parsed via `readBody()`; dispatches `WORKSPACE_ROOT` as `workspaceRoot` |
| POST | `/api/orchestrator/kill/:id` | `handleOrchestratorKill` — special-case block; `id` extracted via `decodeURIComponent(path.slice('/api/orchestrator/kill/'.length))` before `assertSafeQueueId` |
| POST | `/api/orchestrator/dismiss/:id` | `handleOrchestratorDismiss` — special-case block; same `decodeURIComponent` extraction; responds HTTP 204 No Content |

**Static file serving:** requests not starting with `/api/` are served from `gui/public/` (ESM path via `import.meta.url`). `/` → `index.html`. Unknown paths → 404.

**CORS:** all responses include `Access-Control-Allow-Origin: http://localhost:{port}`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`. OPTIONS preflight → 200 OK.

**Error handling:**
- `ApiError` codes map to HTTP status: `NOT_FOUND`→404, `FORBIDDEN`→403, `VALIDATION_ERROR`→400, other→500
- Error response body: `{ "error": { "code": "...", "message": "..." } }`
- `EADDRINUSE` → logs to stderr + `process.exit(1)`

#### `apiErrorToStatus(code: string): number`

Maps an `ApiError` error code to its HTTP status code. Exported for unit testing.

| Error Code | HTTP Status |
|------------|-------------|
| `NOT_FOUND` | 404 |
| `FORBIDDEN` | 403 |
| `VALIDATION_ERROR` | 400 |
| `CONFLICT` | 409 |
| *(default)* | 500 |

---

## GUI Frontend

### `gui/public/` — static single-page application

Served as static assets by `gui/server.ts`. No ES modules, no framework, no build step.

| File | Purpose |
|------|---------|
| `index.html` | HTML shell — nav (`#/` Projects, `#/insights` Insights, `#/config` Config), `<div id="app">` mount point |
| `styles.css` | CSS custom properties, status badges, tables, cards, forms, loading spinner, error/success/stale banners, comment cards, reset modal, action menu dropdown |
| `api-client.js` | `API` object — async fetch wrappers for REST endpoints (throws `{ code, message }` on non-2xx) |
| `theme.js` | `Theme` object — dark/light toggle; reads/writes `localStorage`; applies `data-theme` on `<html>`; `init()` wires the toggle button |
| `router.js` | `Router` object — hash-based dispatch; manages `setInterval` polling lifecycle; calls `updateNavActive(path)` on every dispatch |
| `utils.js` | Shared utilities: `escapeHtml()`, `formatDate()`, `statusBadge()`, `showLoading()`, `showError()` |
| `app.js` | Bootstrap entry point — calls `Theme.init()` then `Router.init()` |
| `views/project-list.js` | `renderProjectList(app)` — project list table with filter, search, pagination, and action menu |
| `views/project-detail.js` | `renderProjectDetail(app, slug)`, `extractSynopsis(markdown)`, `renderPlan(app, slug)`, `renderSynthesis(app, slug)`, `showResetModal(slug, diagnosis)` |
| `views/work-package.js` | `renderWorkPackageDetail(app, slug, wpId)`, `buildWpDetailBar(wp)` |
| `views/config.js` | `renderConfig(app)` — config settings form |
| `views/insights.js` | `renderInsights(app)` — insights page with dynamic filter selects and comment cards |
| `js/orchestrator-widgets.js` | `OrchestratorWidgets` ES5 IIFE — shared orchestrator UI components: `renderStatusCard`, `renderKillButton`, `renderDismissButton`, `formatLogAction`, `renderLogPreview`, `renderProgressBadge`, `renderCliReference` (WP-010, WP-002) |

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

**`styles.css` — Pipeline stage badge track classes** (shared by the project detail WP table and the WP detail pipeline progression bar):

| Class | Role |
|-------|------|
| `.pipeline-track` | Flex row container for a sequence of `.stage-badge` elements; `gap: 3px`, `flex-wrap: nowrap` |
| `.stage-badge` | Individual stage pill (32×22 px); `position: relative` (anchors `.rework-indicator`); abbreviated agent-name label uppercased; `title` tooltip carries full stage + agent name |
| `.stage-pending` | Grey variant (light: `#f1f5f9` bg / `#94a3b8` text; dark: `#1e293b` bg / `#475569` text) — stage not yet started |
| `.stage-in-progress` | Amber variant (light: `#fef3c7` bg / `var(--color-in-progress)` text; dark: `#451a03` bg / `#fbbf24` text) — pipeline currently IN_PROGRESS |
| `.stage-pass` | Green variant (light: `#dcfce7` bg / `var(--color-complete)` text; dark: `#14532d` bg / `#86efac` text) — latest pipeline PASS |
| `.stage-fail` | Red variant (light: `#fee2e2` bg / `var(--color-blocked)` text; dark: `#450a0a` bg / `#fca5a5` text) — latest pipeline FAIL |
| `.rework-indicator` | Small circular overlay badge (14×14 px, absolute top-right of `.stage-badge`); red background, white text; rendered only when `rework_count > 0`; displays the count |
| `.pipeline-track-legend` | Optional small legend line below a `.pipeline-track`; `font-size: 11px`, muted colour |

Dark theme overrides for `.stage-pending`, `.stage-in-progress`, `.stage-pass`, `.stage-fail` are provided in a `[data-theme="dark"]` block immediately following the light-mode rules.

**`styles.css` — Project reset modal classes:**

| Class | Role |
|-------|------|
| `.reset-modal-overlay` | Full-viewport semi-transparent backdrop; blocks interaction with the page behind the modal |
| `.reset-modal` | Modal container; max-width 760 px, max-height 80 vh, scrollable; rendered in the document flow above the overlay |
| `.reset-modal-header` | Modal title + close (×) button row |
| `.reset-modal-banner` | Summary banner below the header; amber background (matching `.badge-in_progress` pattern) showing WP counts |
| `.reset-bulk-controls` | Flex row for bulk-action buttons (Reset All Broken / Skip All) |
| `.reset-wp-row` | Per-WP row with expand/collapse toggle, pipeline stage badges, action radios, and criteria checkbox |
| `.reset-wp-cancelled` | Modifier applied to cancelled WPs; reduces opacity to 0.55 and disables pointer events |
| `.reset-stage-badge` | Pill badge for a single pipeline stage name; combined with `.reset-stage-present` or `.reset-stage-missing` |
| `.reset-stage-present` | Green variant — stage has a PASS pipeline |
| `.reset-stage-missing` | Red variant — stage is absent or has no PASS |
| `.reset-modal-footer` | Sticky footer with live summary text and Apply Reset / Cancel buttons |

`.priority-high/medium/low` values use `:root` CSS custom properties (`--color-priority-high: #e74c3c`, `--color-priority-medium: #f39c12`, `--color-priority-low: #95a5a6`). The `.comment-type` background uses `var(--color-border)`.

> `.comment-type` uses `var(--color-text-muted)` for its text colour, keeping the full colour palette centralized in `:root`.

> **Known debt (low):** `.insights-filters` duplicates `.filter-bar` layout properties. The Reviewer approved retaining `.insights-filters` as a semantic distinction for now. A future cleanup WP should consolidate them into a single utility class.

**`styles.css` — Inline title edit + Repository column classes:**

| Class | Role |
|-------|------|
| `.page-heading-wrapper` | `inline-flex` container wrapping the project detail `<h1>` and edit button; avoids taking the full row width |
| `.edit-title-btn` | Small pencil (✎) button adjacent to the heading; hidden during edit mode |
| `.title-edit-input` | Inline text input that replaces `<h1>` in edit mode; `font-size:1.5rem` + `font-weight:700` matches the `<h1>` exactly (zero layout shift); `max-width:600px` + `width:40ch` constrains overflow |
| `.title-edit-error` | Inline error message div displayed below the input on API failure; cleared by `exitEdit()` when the user leaves edit mode |
| `.repo-col` | Table data cell for the Repository column in the project list table |

**`styles.css` — Project action menu classes:**

| Class | Role |
|-------|------|
| `.action-menu-wrapper` | `position:relative` container wrapping the ⋮ trigger and the floating menu; receives `.is-open` modifier while the menu is open |
| `.action-menu-btn` | ⋮ kebab trigger button; small, minimal styling; receives `aria-haspopup=menu` and `aria-expanded` from JS |
| `.action-menu` | Absolutely-positioned dropdown list; hidden by default (`display:none`); uses `var(--color-bg-card)` surface, `var(--color-border)` border, `var(--radius)` rounding, and a drop shadow |
| `.action-menu-wrapper.is-open .action-menu` | Overrides `display:none` → `block` when the wrapper has the `.is-open` modifier |
| `.action-menu-item` | Individual row inside `.action-menu`; `display:block`, full width, left-aligned; hover uses `var(--color-bg)` background; anchors and buttons share identical visual treatment |
| `.action-menu-item.danger` | Modifier for destructive actions (Delete); foreground set to `var(--color-btn-danger-bg)` |

**`styles.css` — Dialogue component classes** (added for the Dialogues card in the WP detail view):

| Class | Role |
|-------|------|
| `.dialogue-stage` | Grouping container for one pipeline stage's revision buttons and expanded content; `margin-bottom: 10px` |
| `.dialogue-stage-label` | Uppercase muted label (12 px, 600 weight) preceding the revision buttons; inline-block, vertically aligned |
| `.dialogue-btn` | Pill-shaped revision button (`border-radius: var(--radius-pill)`); default state: surface background, border `var(--color-border)` |
| `.dialogue-btn:hover` | Border and text change to `var(--color-ready)` on hover |
| `.dialogue-btn-latest` | Applied to the last revision button in a stage; bold weight, `var(--color-ready)` border + text — marks it as the most recent dialogue |
| `.dialogue-btn-active` | Applied to the currently expanded button; filled background (`var(--color-btn-bg)`), white text |
| `.dialogue-content` | Scrollable container for rendered Markdown (`max-height: 480px`, `overflow-y: auto`); hidden by default (`display:none`); shown/hidden by the click handler |
| `.dialogue-markdown` | Wrapper `<div>` inside `.dialogue-content`; applies typography rules for rendered Markdown (`h1–h3` margins, `pre` / `code` block styling) |
| `.text-danger` | Utility class for inline error messages (red text via `var(--color-blocked)`); used both for `getDialogueContent` fetch errors and `getDialogues` list errors |

Dark mode overrides for `.dialogue-btn`, `.dialogue-btn-latest`, and `.dialogue-btn-active` are provided in a `[data-theme="dark"]` block.

> **Accessibility note (future work):** `.dialogue-btn` toggle buttons do not currently set `aria-expanded` — screen readers cannot infer the expanded/collapsed state from the DOM. A future accessibility pass should add `aria-expanded="false"` initially and toggle it alongside `.dialogue-btn-active` on click.

**`styles.css` — Stale instance banner class:**

| Class | Role |
|-------|------|
| `.stale-banner` | Full-width sticky banner for stale-instance warnings; `position:sticky; top:0; z-index:200`; amber palette: `#fef3c7` bg / `#78350f` text / `#f59e0b` bottom border (2 px); no `border-radius` (edge-to-edge); `box-sizing:border-box` |

Dark mode override (`[data-theme="dark"] .stale-banner`): `#451a03` bg / `#fbbf24` text / `#92400e` border. WCAG contrast ratios: light mode **8.15:1**, dark mode **8.97:1** — both exceed WCAG AA (4.5:1).

> **DOM placement:** the banner element must be inserted **before `<header>`** in the DOM. Both the banner and the header use `position:sticky; top:0`; the banner wins the top slot because `z-index:200 > z-index:100`. This ensures the banner remains visible while the header scrolls underneath it.

> **Missing flex properties (intentional):** `display:flex`, `align-items`, and `padding` are not present in this CSS-only WP. They will be added in the HTML integration WP when the banner markup and its inner layout are implemented.

**`api-client.js`:**
- **`API`** — async fetch wrappers for all 30 REST endpoints (throws `{ code, message }` on non-2xx); includes `getProjects(params)` → `GET /api/projects`; `getProject(slug)` → `GET /api/projects/:slug`; `getWorkPackages(slug)` → `GET /api/projects/:slug/work-packages`; `getWorkPackage(slug, wpId)` → `GET /api/projects/:slug/work-packages/:wpId`; `getWorkPackageOverview(slug)` → `GET /api/projects/:slug/work-packages/overview`; `deleteProject(slug)` → `DELETE /api/projects/:slug`; `archiveProject(slug)` → `POST /api/projects/:slug/archive`; `unarchiveProject(slug)` → `POST /api/projects/:slug/unarchive`; `getConfig()` → `GET /api/config`; `updateConfig(data)` → `PUT /api/config`; `getInsights()` → `GET /api/insights`; `getServerInfo()` → `GET /api/server-info`; `getPlanDocument(slug)` → `GET /api/projects/:slug/plan`; `getSynthesisDocument(slug)` → `GET /api/projects/:slug/synthesis`; `analyzeProjectReset(slug)` → `POST /api/projects/:slug/reset` with `{ dry_run: true }`; `applyProjectReset(slug, decisions)` → `POST /api/projects/:slug/reset` with `{ dry_run: false, decisions }`; `getProjectHealth(slug)` → `GET /api/projects/:slug/health`; `renameProject(slug, title)` → `PATCH /api/projects/:slug` with `{ title }`; `renameSlug(slug, newSlug)` → `PATCH /api/projects/:slug` with `{ slug: newSlug }`; `markProjectComplete(slug)` → `POST /api/projects/:slug/complete`; `getRunLogs(slug)` → `GET /api/projects/:slug/runs`; `getRunLogEntries(slug, filename, afterLine?)` → `GET /api/projects/:slug/runs/:filename?after=N` (hand-rolled query string; consistent with `getDialogues`); `getDialogues(slug, wpId)` → `GET /api/projects/:slug/dialogues?wp={wpId}` (hand-rolled query string; returns parsed JSON `{ filename, stage, wp_id }[]`); `getDialogueContent(slug, filename)` → `GET /api/projects/:slug/dialogues/:filename` (returns raw Markdown text via `res.text()` — uses direct `fetch()` rather than the private `request()` helper, which calls `res.json()`); `getChunks(slug, wpId)` → `GET /api/projects/:slug/chunks?wp={wpId}` (returns parsed JSON `ChunkEntry[]`); `getChunkRendered(slug, filename)` → `GET /api/projects/:slug/chunks/{filename}/rendered` (returns `{ content: string }` — rendered Markdown via `renderChunksToMarkdown`); `orchestratorStart(planPath, dryRun)` → `POST /api/orchestrator/start` with body `{ planPath, dryRun }` (launches an orchestrator run; server-side handler pending); `orchestratorGetQueue()` → `GET /api/orchestrator/queue` (returns current run-queue entries; server-side handler pending); `orchestratorKill(id)` → `POST /api/orchestrator/kill/{encodeURIComponent(id)}` (sends SIGTERM to the process; server-side handler pending); `orchestratorDismiss(id)` → `DELETE /api/orchestrator/queue/{encodeURIComponent(id)}` (removes a completed or stale entry from the queue without killing the process; server-side handler pending)

**`theme.js`:**
- **`Theme`** — dark/light theme toggle; reads/writes `localStorage`; applies `data-theme` attribute on `<html>`; `init()` wires the toggle button; `toggle()` switches between `'dark'` and `'light'` and persists the choice

**`router.js`:**
- **`Router`** — hash-based dispatch (`#/`, `#/projects/:slug`, `#/projects/:slug/plan`, `#/projects/:slug/synthesis`, `#/projects/:slug/wp/:wpId`, `#/config`, `#/insights`); the `/plan` and `/synthesis` matches are registered before the generic `/:slug` match to prevent prefix collision; manages `setInterval` polling lifecycle; calls `updateNavActive(path)` on every dispatch

**`utils.js`:**
- **Utilities**: `escapeHtml()`, `formatDate()`, `formatDuration(ms)`, `statusBadge()`, `showLoading()`, `showError()`. `formatDuration(ms)` renders a millisecond count as a human-readable string (e.g. `"3m 24s"`, `"1h 12m"`, `"45s"`, `"< 1s"`); returns `'—'` for `null` / negative values.

**`app.js`:**
- Bootstrap entry point — calls `Theme.init()` then `Router.init()`

**`js/orchestrator-widgets.js`:**
- **`OrchestratorWidgets`** — ES5-compatible IIFE; exposes 6 functions on a single global object (does not pollute the global namespace beyond this one name):
  - `renderStatusCard(entry)` → `string` — HTML card with status badge (`.badge-pending` / `.badge-started` / `.badge-dead`), PID, elapsed running time, and progress summary; all user-controlled values are XSS-escaped via `escapeHtml()`
  - `renderKillButton(entryId, onDone)` → `HTMLButtonElement` — requires `window.confirm` before calling `API.orchestratorKill(entryId)`; invokes `onDone` on success
  - `renderDismissButton(entryId, onDone)` → `HTMLButtonElement` — calls `API.orchestratorDismiss(entryId)`; invokes `onDone` on success
  - `formatLogAction(entry)` → `string` — maps a raw JSONL log entry object to a human-friendly display string for the log preview widget; covers all 13 action types (`run_start`, `stage_start`, `stage_complete`, `progress_snapshot`, `tool_call`, `wp_complete`, `wp_status_change`, `run_end`, `run_error`, `signal_shutdown`, `heartbeat`, `mcp_error`, `route`); dynamic cases interpolate `entry.stage`, `entry.tool_name`, `entry.wp_id`, `entry.new_status` with empty-string fallbacks; unknown non-empty actions are title-cased (underscores → spaces); null/undefined entry or missing/falsy `action` field falls through to `JSON.stringify(entry)`; intentionally scoped to the log preview only — does **not** affect `renderProgressBadge`
  - `renderLogPreview(container, slug, filename)` → `() => void` — auto-polls `API.getRunLogEntries()` at a 2-second interval; appends new events as `<div class="log-preview-entry">` elements via `textContent` (no `innerHTML`); display text is produced by `formatLogAction(entry)`; returns a cleanup function; stopped-flag guard prevents stale `.then()` callbacks from appending after cleanup
  - `renderProgressBadge(lastAction)` → `string` — maps `lastAction` strings to badge classes: `run_start/stage_start/progress_snapshot` → `badge-info`; `stage_complete/wp_complete` → `badge-success`; `run_end/heartbeat` → `badge-neutral`; `run_error/stage_error` → `badge-error`; `signal_shutdown` → `badge-warning`; unknown/null → `badge-neutral` with idle label
  - `renderCliReference()` → `string` — static HTML with `orchestrate`, `--resume`, `--dry-run`, and `kill-orchestrator.js` command references; keep in sync with `orchestrator/src/cli.py` (CLI flags), `scripts/kill-orchestrator.js`, and `scripts/preflight-orchestrator.js`

**`views/project-list.js`:**
- **`renderProjectList(app)`** — project list table with status filter dropdown + fulltext search input (client-side, combined `statusMatch && textMatch`); columns: **Slug** (date prefix stripped; full slug in `title` attribute tooltip), **Project** (`project_name` or `—`), **Repository** (`repository_name` or `—`; rendered via `<td class="repo-col">`), **% Done** (inline `.progress-bar-track` / `.progress-bar-fill` + percentage, or `—` for 0 WPs), **Status**, **Created**, **Updated**, **Actions**; `searchValue` and `filterValue` are closure-scope state that survive the 10-second poll-triggered re-render cycle; `applyFilter()` reads `data-slug`, `data-name`, and `data-repo` attributes off `<tr>` elements (full slug + raw project name + repository name, all lowercased for case-insensitive match); `data-repo` is set to `escapeHtml(p.repository_name || '')` on the `<tr>` element; em-dash fallback uses `\u2014` Unicode escape; **Actions** column uses a single ⋮ kebab button per row (`.action-menu-wrapper` / `.action-menu-btn` / `.action-menu`) rather than per-row inline buttons; dropdown items: **View** (`<a role=menuitem>`), conditional **Archive** / **Unarchive** (`<button role=menuitem data-action=archive|unarchive>`), **Delete** (`<button class=danger role=menuitem data-action=delete>` — always rendered regardless of status; backend still enforces COMPLETE/ARCHIVED guard); open/close state tracked via `openMenuWrapper` + `closeOpenMenu()` closure-scope variables; a document `mousedown` sentinel (installed once per `renderProjectList` call via `docHandlerInstalled` flag) and a `scroll` listener on `.table-wrapper` close any open menu on outside interaction; opening a second menu closes the first; `aria-haspopup='menu'` and `aria-expanded` wired to trigger button

**`views/project-detail.js`:**
- **`extractSynopsis(markdown)`** — regex-extracts the content of a `## Summary` section from a Markdown string; returns the trimmed text or `null` if the section is absent or empty
- **`renderProjectDetail(app, slug)`** — fetches project, plan document, and WP overview concurrently via `Promise.all` (three parallel calls: `getProject`, `getPlanDocument`, `getWorkPackageOverview`); `getPlanDocument` and `getWorkPackageOverview` failures are each absorbed (`.catch(() => null)`) so the detail page always renders; if the plan has a `## Summary` section, injects a `.plan-synopsis` card with a **View full plan →** link above the Work Packages table; if `project.synthesis_generated === true`, renders a `.synthesis-link-row` with a **View synthesis →** link (driven by the flag alone — no extra HTTP call); **WP table:** when the overview fetch succeeds, the "Title" column (which previously showed the WP ID verbatim) is replaced by a "Pipeline Stages" column rendering a `.pipeline-track` badge row per WP via `buildPipelineTrack(overviewEntry)`; when the overview fetch fails, the column header falls back to "WP ID" and cells show the plain WP ID; **title display:** `displayTitle = (meta.title && meta.title.trim()) ? meta.title : slug` — used for both the `<h1>` heading and breadcrumb; **inline title edit:** heading is wrapped in `.page-heading-wrapper` (inline-flex) with an adjacent `.edit-title-btn` pencil button (✎); click pencil → replaces `<h1>` with `<input class="title-edit-input">` pre-filled with current title, auto-focused; Enter or blur triggers `doSave()` which calls `API.renameProject(slug, newTitle)` and updates the heading and breadcrumb on success; Escape triggers `exitEdit()` without touching the API; errors displayed in a `.title-edit-error` div (created once via `getElementById` + `createElement` to prevent duplicates on rapid retries); `inputDone` flag prevents blur+Enter double-save race; error path resets `inputDone = false` to permit retry; `currentTitle` is kept in sync with the last saved value so re-entering edit mode shows the latest title; **project timing:** when `project.timing` is present (returned by `GET /api/projects/:slug`), renders **Duration** (`formatDuration(project.timing.project_elapsed_ms)`) and, when `pipeline_runs > 0`, **Active** (`formatDuration(project.timing.total_active_ms)` + ` across N pipeline runs`) inline in the project header; omitted when `project.timing` is absent; project header (includes **Reset Project** button) + WP summary table (clickable rows) + Project Comments section (sorted newest-first; each card shows agent, `.comment-type` badge, priority left-border accent, timestamp, and note; incident entries render `context` key/value pairs in a `.comment-context` sub-section; renders 'No comments yet.' when `project_comments` is empty)
- **`showResetModal(slug, diagnosis)`** — builds and renders the reset confirmation modal from a `ProjectResetDiagnosis` object; features: per-WP diagnosis rows (collapsed by default, expand/collapse toggle), pipeline stage badges (`.reset-stage-present`/`.reset-stage-missing`), action radio buttons pre-selected per `suggested_action`, reset-criteria checkbox (visible only when Reset is selected, pre-checked from `suggested_reset_criteria`), bulk controls (Reset All Broken / Skip All via `refreshRadios()`), live summary footer updated on every change (`updateSummary()` → `buildSummary()`), Apply Reset button disabled when 0 WPs have an action; CANCELLED WPs rendered non-interactive with `.reset-wp-cancelled`; apply success path: closes modal via `closeModal()`, shows success toast, calls `renderProjectDetail()` to refresh data; close paths: × button, Cancel button, backdrop click (`e.target === overlay` guard); **mark-complete mode:** a **Mark All as Complete** button (`btn-warning`, `id=reset-mark-complete-btn`) in the bulk-controls bar toggles a closure-scoped `markCompleteMode` boolean; when active, the button relabels itself to **Cancel Override** (gains `.active` class), the apply button label changes to **Mark as Complete**, and `buildSummary()` returns a ⚠ warning text describing the forced-COMPLETE operation; confirm path invokes `API.markProjectComplete(slug)` → `closeModal()` + success toast + `renderProjectDetail()` re-render; error path shows an error toast; clicking Cancel Override reverts `markCompleteMode` to `false` and restores all prior labels; normal Apply Reset flow is unaffected when `markCompleteMode` is `false`; apply button is disabled at the start of both confirm branches to prevent double-submit
- **`renderPlan(app, slug)`** — renders the archived plan as formatted HTML using `marked.parse()`; breadcrumb links to `#/projects` and `#/projects/:slug`; shows 'Plan document not available for this project.' when the API returns NOT_FOUND; generic error banner for other failures
- **`renderSynthesis(app, slug)`** — renders the archived synthesis document as formatted HTML using `marked.parse()`; breadcrumb links to `#/projects` and `#/projects/:slug`; shows 'Synthesis document not available for this project.' when the API returns NOT_FOUND; generic error banner for other failures

**`views/work-package.js`:**
- **`renderWorkPackageDetail(app, slug, wpId)`** — renders a **Pipeline Progression** card (via `buildWpDetailBar(wp)`) above the existing Pipelines section; the card shows the WP's active stages as a `.pipeline-track` badge row using the same `.stage-badge` / `.stage-pending` / `.stage-in-progress` / `.stage-pass` / `.stage-fail` / `.rework-indicator` CSS as `buildPipelineTrack`; derives all data from the already-fetched WP detail (no extra API call); `WP_DEFAULT_STAGES = ['implementation','qa','code-review','documentation']` used as fallback when `active_pipeline_stages` is absent; `wp.pipelines` is never mutated — a `.slice().reverse()` copy is used for newest-first rendering so the bar's chronological pass still sees the original order; **timing summary:** renders a `<div class="wp-timing">` block above the pipeline list showing **Active time** (sum of all pipeline `duration_ms` values via `formatDuration`) and, when both the first `started_at` and last `completed_at` are available, **Wall-clock** (elapsed from first pipeline start to last completion); also shows a `badge-neutral` duration badge next to each pipeline's status badge and an inline `Duration:` label next to the `Completed:` timestamp (both via `formatDuration(p.duration_ms)`; omitted when `duration_ms` is absent); also renders AC list (met/unmet), pipeline history, handoff notes; **Dialogues card:** rendered asynchronously after Handoff Notes via a `<div id="wp-dialogues-section">` placeholder injected synchronously into the DOM (race-condition-free); calls `API.getChunks(slug, wpId)` and `API.getDialogues(slug, wpId)` in parallel — **chunk files take priority over Markdown dialogue files** when both are present (`useChunks = chunks.length > 0`); if neither source returns entries the placeholder is filled with a "No dialogues available" message; entries are grouped by stage name (insertion order preserved) and each stage row shows pill buttons for every revision (`stage-r0`, `stage-r1`, …) with the latest revision visually highlighted (`.dialogue-btn-latest`); clicking a button fetches content via `API.getChunkRendered()` (chunks) or `API.getDialogueContent()` (dialogues) and renders it with `marked.parse()` inside a `.dialogue-content` container (trusted HTML — no sanitization, consistent with the rest of the SPA); clicking a second button collapses the previously expanded one via an `activeBtn` closure variable; clicking the same button again is a toggle-off; a fetch error shows an inline `.text-danger` message without crashing the WP view; a list-fetch failure shows a `.text-danger` error inside the Dialogues card; the card is always **below the Pipelines card** in DOM order — the placeholder is appended after `handoffHtml` in `app.innerHTML`

**`views/config.js`:**
- **`renderConfig(app)`** — form pre-populated from `GET /api/config`; save sends only `auto_handoff_enabled` + `max_handoff_depth` (ledger_root is readonly)

**`views/insights.js`:**
- **`renderInsights(app)`** — Insights page; calls `GET /api/insights`, builds dynamic type/priority/project filter selects, renders one `.comment-card` per entry with `.priority-{level}` accent, incident context in `.comment-context`, 'No insights found.' empty state, in-memory re-filtering on select change, auto-refresh every 15 s

**XSS protection:** `escapeHtml()` wraps every piece of user-supplied data interpolated into HTML strings (20+ call sites).

---

### `src/utils/workflow-helpers.ts` — shared constants and pure helpers

Exported from `src/utils/workflow-helpers.ts`. Consumed by all three workflow tool sub-modules and re-exported via `workflow.ts`.

```typescript
// Clears synthesis-related fields on a root index: sets synthesis_generated = false
// and synthesis_generated_at = null. Centralises the two-line pattern that was
// previously duplicated at 5 inline call sites (project-lifecycle.ts, work-package.ts x3, project-reset.ts).
export function clearSynthesisState(rootIndex: RootIndex): void;

// Number of hours after which an IN_PROGRESS pipeline is considered stale.
// Derived from constants.stale_pipeline_hours in the shared workflow manifest (default: 24).
export const STALE_PIPELINE_HOURS: number;

// Maximum number of rework cycles allowed before a work package is circuit-broken.
// Derived from constants.max_rework_count in the shared workflow manifest (default: 5).
export const MAX_REWORK_COUNT: number;

// Returns the current max auto-handoff chain depth from the in-memory GUI config cache.
// Falls back to the manifest default (constants.max_handoff_depth = 50) if the config
// module has not yet been initialized.
export function getMaxHandoffDepth(): number;

// Returns the effective maximum auto-handoff depth, scaled by project size per §18.2.1.
// effectiveMax = max(configMax, totalWorkPackages × 30), where configMax defaults to getMaxHandoffDepth() (50)
// and the multiplier 30 comes from constants.handoff_depth_multiplier in the shared workflow manifest.
// This ensures larger projects don't hit the ceiling prematurely:
//   effectiveMaxDepth(0)  → 50   (0 × 30 = 0 < 50, floor applies)
//   effectiveMaxDepth(1)  → 50   (1 × 30 = 30 < 50, floor applies)
//   effectiveMaxDepth(5)  → 150  (5 × 30 = 150 > 50)
// The optional configMax parameter allows test code to inject a fixed value without
// mocking the config singleton.
export function effectiveMaxDepth(totalWorkPackages: number, configMax?: number): number;

// Returns the most recent non-auto-cancelled pipeline matching the given type, or null if none
// exists. Equivalent to: pipelines.filter(p => p.type === type && !p.auto_cancelled).at(-1) ?? null
// Auto-cancelled pipelines are excluded per §14.7 / §21.27. Treat absent/falsy `auto_cancelled`
// as false (backward-compatible). Used internally by isMostRecentPipelineFail and by PM dispatch
// functions (workflow-handoff.ts, workflow-next-action.ts) to avoid duplicated filter+at(-1) patterns.
export function latestNonCancelledPipeline(pipelines: Pipeline[], type: string): Pipeline | null;

// Returns true ONLY if the most recent non-auto-cancelled pipeline of pipelineType has FAIL status.
// Delegates to latestNonCancelledPipeline(). Auto-cancelled pipelines are excluded per §14.7 / §21.27.
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean;

// Returns true if a pipeline is IN_PROGRESS and was started more than STALE_PIPELINE_HOURS ago.
export function isStalePipeline(pipeline: Pipeline): boolean;

// Returns the most recent non-auto-cancelled pipeline for the given work package,
// or null if no such pipeline exists.
export function mostRecentEffectivePipeline(wp: WorkPackageDetail): Pipeline | null;

// Returns true when the WP has an active (IN_PROGRESS and non-stale) pipeline of the
// specified type. Used to emit CONTINUE_PIPELINE (§21.33) before routing to rework or
// new-work recommendations.
export function isActivePipeline(wp: WorkPackageDetail, pipelineType: PipelineType): boolean;

// Returns true when the WP is classified as blocked by dependencies using the canonical §21.54
// metadata-based check: wp.status === 'BLOCKED' && (blocked_by == null || blocked_by.type === 'dependency').
// Canonical implementation — prefer this over hasDependencyBlocked at new call sites.
export function isBlockedByDependencies(wp: WorkPackageDetail): boolean;

// @deprecated Use isBlockedByDependencies(). Const alias retained for backward compatibility
// with existing call sites. Delegates directly to isBlockedByDependencies — no duplicate logic.
export const hasDependencyBlocked: typeof isBlockedByDependencies;

// Returns true if any downstream pipeline type (relative to pipelineType) has its most recent
// non-auto-cancelled pipeline with FAIL status. Delegates to getDownstreamTypes() so it
// automatically covers multi-hop FAILs (e.g., code-review FAIL detected from implementation).
// Returns false for empty pipelines or when pipelineType has no downstream stages (e.g., 'documentation').
// Exported from src/utils/workflow-helpers.ts.
export function hasDownstreamFail(pipelines: Pipeline[], pipelineType: PipelineType): boolean;

// Returns true if the Developer should re-engage because a downstream rework pipeline
// (qa or code-review — the types routing back to Developer per FAIL_ROUTING_MAP) has
// started at or after the most recent upstream PASS for pipelineType. Implements §14.13 table.
// Auto-cancelled pipelines are excluded from both the upstream PASS lookup and
// the downstream started_at lookup. Returns false when no upstream PASS exists.
// NOTE: the developer rework types ['qa', 'code-review'] are derived from FAIL_ROUTING_MAP;
// if routing changes, this function must be updated in sync.
// Exported from src/utils/workflow-helpers.ts.
export function hasDownstreamReengagedSince(pipelines: Pipeline[], pipelineType: PipelineType): boolean;

// Returns true if the most recent upstream PASS pipeline completed_at is AT OR AFTER the most recent
// non-auto-cancelled downstream pipeline's started_at. Handles first-run (no downstream → true), up-to-date
// (downstream started after upstream → false), and rework re-engagement (upstream PASS
// post-dates downstream start → true). Uses >= so coincident/same-second timestamps → true.
// Auto-cancelled downstream pipelines are excluded from the downstream lookup.
export function hasNewUpstreamPassSince(
  pipelines: Pipeline[],
  upstreamType: PipelineType,
  downstreamType: PipelineType
): boolean;

export function extractStalePipelineAction(wps: WorkPackageDetail[]): ActionResult | null;
export function extractReworkAction(wps: WorkPackageDetail[]): ActionResult | null;

// Re-validation guard (§11.1): determines whether a downstream pipeline stage should be
// blocked because it would skip re-validation of upstream stages after a rework cycle.
// Returns null (permitted) when: first run, self-rework retry, missing timestamps (conservative allow),
// no upstream types (implementation), or upstream has a fresh PASS post-dating any prior run.
// Returns a descriptive error string when a stage-skip is detected (upstream rework occurred but the
// immediate prerequisite has not yet re-PASSED since then).
// Accepts Pipeline[] (matching the convention of sibling helpers such as isMostRecentPipelineFail,
// hasDownstreamFail, etc.). Call sites pass wpDetail.pipelines.
// Auto-cancelled pipelines are excluded from the temporal baseline.
// activeStages controls which upstream types are considered; defaults to DEFAULT_PIPELINE_STAGES
// when omitted (backward-compatible 4-stage behaviour). Pass the WP's active_pipeline_stages
// to correctly evaluate custom-stage WPs (e.g. those including security-audit or release-engineering).
// Exported from src/utils/workflow-helpers.ts.
export function checkRevalidationGuard(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  prerequisite: PipelineType,
  activeStages?: readonly PipelineType[],  // default: DEFAULT_PIPELINE_STAGES
): string | null;

// Returns the handoff notes in the WP addressed to agentName, or undefined if none.
export function getHandoffNotesForAgent(wpDetail: WorkPackageDetail, agentName: string): string[] | undefined;

// Returns the prompt string passed to the next agent during auto-handoff.
// When agentId is provided, prepends "@{agentId}\n" to the prompt so VS Code routes
// the subagent call to the persona with the matching id: frontmatter field.
// The @id prefix MUST appear at position 0 for VS Code to honour the routing directive.
// When agentId is omitted or undefined, returns "Project path: {projectPath}" unchanged
// (backward compatibility with persona files that do not carry an id: field).
export function buildHandoffPrompt(projectPath: string, agentId?: string): string;

// Display name maps used by workflow tool responses.
export const agentNameMap: Record<string, string>;
export const actionNameMap: Record<string, string>;
export const reworkActionMap: Record<string, string>;
export const pipelineAgentRoleMap: Record<string, string>;
```

### `src/tools/workflow-next-action.ts` — ledger_get_next_action internals

```typescript
// Project Manager next-action computation. Implements the 6-priority algorithm from §14.1.2.
// When preloadedWpDetails is provided (by the parent getNextAction call), skips the internal
// Promise.all disk fetch and uses the pre-loaded data instead (matching the pattern of all
// other role action functions). Evaluates priorities in strict top-down order:
//   P1 UNBLOCK_WP        — BLOCKED WP with decision/external/technical blocker.
//   P2 REVIEW_REWORK_LIMIT — IN_PROGRESS WP where any rework_counts entry >= MAX_REWORK_COUNT.
//   P3 REVIEW_STALE      — IN_PROGRESS WP with a stale active pipeline (via extractStalePipelineAction).
//   P3b REVIEW_ABANDONED — IN_PROGRESS WP with no active pipelines and last activity > STALE_PIPELINE_HOURS ago;
//                          grace period: skips WPs where status_changed_at is within the threshold.
//   P3c REPAIR_ORPHAN_BLOCKED — BLOCKED WP with dependency/absent blocker where
//                               canStartWorkPackage(wp, rootIndex) returns allowed:true.
//   P3d ROUTE_PIPELINE_AGENT — non-terminal, non-dependency-blocked IN_PROGRESS WP where the
//                              next active pipeline stage needs work. Applies the same guards as
//                              §13.1 step 2b: FAIL stages are skipped (downstream FAIL routing),
//                              IN_PROGRESS stages are skipped (stage already being worked on),
//                              upstream IN_PROGRESS stages are skipped (premature routing prevention).
//                              Returns action ROUTE_PIPELINE_AGENT with next_agent and pipeline_type.
//                              Covers stage-transition routing and freshly-claimed WPs (zero pipelines).
//   P4 WAIT              — no actionable items found.
// Note: dependency-blocked WPs (blocked_by.type === 'dependency' or absent blocked_by) are
// explicitly excluded from UNBLOCK_WP and fall through to REPAIR_ORPHAN_BLOCKED.
export function getProjectManagerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Synthesis-specific action for when project is still in progress (not all WPs complete).
// Returns a static WAIT response. Extracted from the switch case inline literal for
// consistency with all other role action helpers.
function getSynthesisAction(): ActionResult;

// Developer-specific next-action computation. Implements the 7-priority per-WP algorithm from §14.2.
// Skips WPs where 'implementation' is not in wp.active_pipeline_stages.
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT    — rework_counts.implementation ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL          — stale implementation pipeline (via extractStalePipelineAction).
//   P3 CONTINUE_PIPELINE         — active non-stale implementation pipeline (isActivePipeline = true).
//   P4 REWORK (direct)           — most recent implementation pipeline is FAIL.
//   P5 REWORK (downstream)       — hasDownstreamFail AND hasDownstreamReengagedSince = true.
//   P5b WAIT_FOR_DOWNSTREAM      — hasDownstreamFail AND hasDownstreamReengagedSince = false
//                                  (developer already re-passed; awaiting downstream re-engagement).
//   P6 IMPLEMENT                 — IN_PROGRESS WP with no implementation pipeline.
//   P7 CLAIM_WP                  — READY WP assigned to Developer with dependencies satisfied.
//   Fallback WAIT.
// Legacy rework_count scalar fallback removed; uses rework_counts.implementation only.
export function getDeveloperAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// QA-specific next-action computation. Implements the 7+1b per-WP algorithm from §14.3.
// Skips WPs where 'qa' is not in wp.active_pipeline_stages.
// Prerequisite is computed dynamically via resolvePrerequisite('qa', activeStages).
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts.qa ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — rework_counts[qaPrerequisite] ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale QA pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale QA pipeline (isActivePipeline = true).
//   P4 RUN_QA (re-engagement)           — at least one prior QA pipeline (excl. auto-cancelled)
//                                         AND hasNewUpstreamPassSince(qaPrerequisite,'qa')=true.
//   P5 WAIT_FOR_REWORK                  — most recent QA pipeline is FAIL and P4 guard is false.
//   P6 RUN_QA (first-run)               — most recent qaPrerequisite pipeline is PASS, no QA pipeline.
//   P7 CLAIM_WP                         — READY WP assigned to QA with dependencies satisfied.
//   Fallback WAIT.
export function getQaAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Reviewer-specific next-action computation. Mirror of QA for §14.4 (code-review pipeline).
// Skips WPs where 'code-review' is not in wp.active_pipeline_stages.
// Prerequisite is computed dynamically via resolvePrerequisite('code-review', activeStages).
// P1b checks all active upstream stages for rework limit breaches.
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts['code-review'] ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — any active upstream stage rework_counts ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale code-review pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale code-review pipeline.
//   P4 RUN_REVIEW (re-engagement)       — at least one prior code-review pipeline (excl. auto-cancelled)
//                                         AND hasNewUpstreamPassSince(reviewPrerequisite,'code-review')=true.
//   P5 WAIT_FOR_REWORK                  — most recent code-review pipeline is FAIL and P4 guard is false.
//   P6 RUN_REVIEW (first-run)           — most recent reviewPrerequisite pipeline is PASS, no code-review pipeline.
//   P7 CLAIM_WP                         — READY WP assigned to Reviewer with dependencies satisfied.
//   Fallback WAIT.
export function getReviewerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Security Auditor-specific next-action computation. Mirrors getQaAction for §14.3a (security-audit pipeline).
// Skips WPs where 'security-audit' is not in wp.active_pipeline_stages.
// Prerequisite is computed dynamically via resolvePrerequisite('security-audit', activeStages).
// NO self-rework on FAIL — Developer must address Security Auditor findings before retry.
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts['security-audit'] ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — rework_counts[secPrerequisite] ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale security-audit pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale security-audit pipeline.
//   P4 RUN_SECURITY_AUDIT (re-engagement) — hasNewUpstreamPassSince(secPrerequisite,'security-audit')=true.
//   P5 WAIT_FOR_REWORK                  — most recent security-audit pipeline is FAIL and P4 guard is false.
//   P6 RUN_SECURITY_AUDIT (first-run)   — most recent secPrerequisite is PASS, no security-audit pipeline.
//   P7 CLAIM_WP                         — READY WP assigned to Security Auditor.
//   Fallback WAIT.
export function getSecurityAuditorAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Release Engineer-specific next-action computation. Mirrors getDocumentationAction for §14.4a (release-engineering pipeline).
// Skips WPs where 'release-engineering' is not in wp.active_pipeline_stages.
// Prerequisite is computed dynamically via resolvePrerequisite('release-engineering', activeStages).
// SELF-REWORK on FAIL (mirrors Documentation, not QA).
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts['release-engineering'] ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — any active upstream stage rework_counts ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale release-engineering pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale release-engineering pipeline.
//   P4 REWORK (self)                    — most recent release-engineering is FAIL AND
//                                         !hasNewUpstreamPassSince(relPrerequisite,'release-engineering').
//   P5 RUN_RELEASE_ENGINEERING          — most recent relPrerequisite is PASS, no release-engineering pipeline
//                                         OR hasNewUpstreamPassSince(relPrerequisite,'release-engineering')=true.
//   P7 CLAIM_WP                         — READY WP assigned to Release Engineer.
//   Fallback WAIT.
export function getReleaseEngineerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Documentation-specific next-action computation. Implements the 7+1b per-WP algorithm from §14.5.
// Skips WPs where 'documentation' is not in wp.active_pipeline_stages.
// Prerequisite is computed dynamically via resolvePrerequisite('documentation', activeStages).
// P1b checks all active upstream stages (not just impl|qa|code-review) for rework limit breaches.
// P5/P6 freshness check uses firstActiveStage instead of hardcoded 'implementation',
// so documentation-only WPs (firstActiveStage='documentation') correctly produce a freshness=true.
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts.documentation ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — any active upstream stage rework_counts ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale documentation pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale documentation pipeline.
//   P4 REWORK (self)                    — most recent documentation is FAIL AND
//                                         !hasNewUpstreamPassSince(docPrerequisite,'documentation')
//                                         (guard prevents REWORK from shadowing a fresh WRITE_DOCS cycle).
//   P5 FINALIZE_WP                      — documentation PASS, all acceptance_criteria.met===true,
//                                         AND freshness: doc completed_at ≥ latest firstActiveStage started_at.
//                                         Replaces the former non-spec MARK_COMPLETE action.
//   P5b UPDATE_CRITERIA                 — documentation PASS, freshness passes, but at least one
//                                         criterion has met!==true. Prompt agent to update criteria.
//   P6 WRITE_DOCS                       — most recent docPrerequisite is PASS and no documentation
//                                         pipeline exists OR hasNewUpstreamPassSince(docPrerequisite,'documentation')=true.
//   P7 CLAIM_WP                         — READY WP assigned to Documentation with dependencies satisfied.
//   Fallback WAIT.
export function getDocumentationAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Post-processes a single-action MCP result: embeds handoff_status in payload.action === 'WAIT'
// responses. Defined in workflow-next-action-batch.ts; imported and re-exported via _internal.
// @internal — re-exported via _internal for unit tests

// _internal — exported for unit tests only.
// buildBatchNextSteps and getNextActionsCollector now live in workflow-next-action-batch.ts;
// they are imported back here and re-exported through _internal for test backward compatibility.
export const _internal: {
  getNextAction: Function;
  buildBatchNextSteps: (action: string, wpId: string, pipelineType: string, wpStatus?: string, failedPipelineType?: string) => string[];
  getNextActionsCollector: (rootIndex: RootIndex, store: LedgerStore, agentRole: AgentRole, limit: number) => Promise<MCPResult>;
  embedHandoffStatusInWait: (mcpResult: { content: Array<{ type: string; text: string }> }, projectPath: string, agentRole: string, opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] }) => Promise<{ content: Array<{ type: string; text: string }> }>;
};
```

### `src/tools/workflow-next-action-batch.ts` — batch/collector sub-module

```typescript
// Extracted from workflow-next-action.ts to reduce file size and isolate batch concerns.
// This module owns embedHandoffStatusInWait, buildBatchNextSteps, and getNextActionsCollector.
// Imported by workflow-next-action.ts; all three are re-exported via _internal for test access.

// Embeds handoff_status into WAIT responses. Calls computeHandoffStatus(projectPath, agentRole, opts?).
// Non-WAIT responses and empty projectPath are returned unchanged.
// On failure, embeds handoff_status_error instead.
// opts.store/rootIndex/wpDetails are forwarded to computeHandoffStatus to enable the
// bypass path — when all three are present, no new LedgerStore is created.
export async function embedHandoffStatusInWait(
  mcpResult: { content: Array<{ type: string; text: string }> },
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<{ content: Array<{ type: string; text: string }> }>;

// Generates the next_steps guidance array for batch action entries.
// Resolves agent role from pipelineType via pipelineAgentRoleMap; builds role-appropriate
// step lists for: IMPLEMENT, REWORK, WRITE_DOCS, RUN_QA, RUN_REVIEW, CLAIM_WP, WAIT, etc.
// CLAIM_WP uses agentRole (not pipelineType) for the agent field.
export function buildBatchNextSteps(
  action: string,
  wpId: string,
  pipelineType: string,
  wpStatus?: string,
  failedPipelineType?: string,
): string[];

// Collects up to `limit` actionable items for an agent role.
// Takes (rootIndex, store, agentRole, limit) — rootIndex already loaded, no disk read.
// Returns { actions: [...], total: N } in the same format as max_results batch mode.
// Planner / Synthesis / Project Manager roles return actions: [] (batch not meaningful).
// WPs are fetched sequentially with early exit: stops reading after `limit` actions are
// collected, avoiding unnecessary readWorkPackage calls for the remaining WPs.
export async function getNextActionsCollector(
  rootIndex: RootIndex,
  store: LedgerStore,
  agentRole: AgentRole,
  limit: number,
): Promise<{ content: [{ type: 'text'; text: string }] }>;
```

### `src/tools/workflow-handoff.ts` — ledger_get_handoff_status internals

```typescript
// Shared cross-WP dispatch helper used by the five non-PM handoff functions.
// Called as the penultimate step in each affected function, just before the final WAIT return.
//
// Algorithm (returns first matching branch):
//   Step 1 — Route to the agent owning the first active pipeline stage of the first READY,
//             non-dependency-blocked WP. "First" follows wpDetails array order, consistent
//             with PM Step 2. Self-routing (targetRole === currentRole) is intentional — never filtered.
//   Step 2 — All WPs terminal (wpDetails.length > 0 && wpDetails.every(isTerminalStatus))
//             → returns READY_FOR_SYNTHESIS. Serves as a safety net for handoff functions that
//             position cross-WP dispatch before their own all-terminal check.
//   null  — No deterministic dispatch available; caller falls through to WAIT.
//
// Dependencies: isTerminalStatus, isBlockedByDependencies, firstActiveStage, PIPELINE_AGENT_MAP,
//               READY_STATUS_FOR_ROLE (all pre-existing helpers/constants).
function findNextReadyDispatch(
  wpDetails: WorkPackageDetail[],
  currentRole: string,
): { status: string; reason: string } | null;

// Handoff computation functions (one per agent role).
// All functions receive the full WP list plus optional projectPath and store for dep-blocked routing.
// Each function is async and returns a Promise<HandoffResult>.

// getPlannerHandoff: returns READY_FOR_PM when no WPs exist (signals PM to begin task decomposition).
export async function getPlannerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getDeveloperHandoff (§5.1): short-circuit priority order:
//   Scope filter: pipeline-specific checks (steps 1, 2, 4) operate on implWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'implementation'. The all-terminal
//   check (step 3) and WAIT fallback remain unscoped (applied to full wpDetails list).
//   1. Temporal guard — for each non-terminal non-dep-blocked WP in implWps: if the most recent
//      downstream pipeline (qa or code-review) is FAIL AND hasDownstreamReengagedSince('implementation')
//      = true → IN_PROGRESS (Developer must rework; downstream has re-engaged since last impl PASS).
//   2. Needs QA — for each non-dep-blocked WP in implWps: PASS impl exists AND
//      hasNewUpstreamPassSince('implementation','qa') = true → READY_FOR_QA.
//   3. All terminal — all WPs COMPLETE or CANCELLED → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the temporal guard in source order; safe because activeWps
//      is empty when all WPs are terminal, which would cause the guard to return READY_FOR_QA
//      incorrectly. The guard must run on non-empty activeWps only.
//   4. Active work — any WP in implWps is IN_PROGRESS with assigned_to === 'Developer' → IN_PROGRESS.
//   → WAIT
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getQaHandoff (§5.2): short-circuit priority order:
//   Scope filter: pipeline-specific checks (steps 1, 2, 3, 5) operate on qaWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'qa'. The all-terminal check
//   (step 4) and WAIT fallback remain unscoped.
//   1. Re-engagement (BEFORE FAIL) — most recent QA is FAIL AND
//      hasNewUpstreamPassSince('implementation','qa') = true → IN_PROGRESS (re-engage QA).
//   2. FAIL short-circuit — most recent QA is FAIL (step 1 guard false) → READY_FOR_DEVELOPER.
//   3. READY_FOR_REVIEW — non-terminal WPs in qaWps where PASS QA exists AND
//      hasNewUpstreamPassSince('qa','code-review') = true; dep-blocked routing applies.
//   4. All terminal → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the re-engagement and FAIL short-circuit checks in source
//      order (lines 484-487 of workflow-handoff.ts). Added to match the same guard
//      in getDeveloperHandoff. wpDetails.length > 0 precondition prevents Array.every()
//      vacuous truth on an empty array.
//   5. IN_PROGRESS assigned to QA (from qaWps) → IN_PROGRESS.
//   6. Cross-WP dispatch — findNextReadyDispatch(wpDetails, 'QA'): if a READY,
//      non-dependency-blocked WP exists, routes to the agent owning its first active stage.
//      If all WPs are terminal, returns READY_FOR_SYNTHESIS. (See Constraint 55.)
//   → WAIT
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getReviewerHandoff (§5.3): mirror of getQaHandoff for code-review pipelines:
//   Scope filter: pipeline-specific checks (steps 1, 2, 3, 5) operate on reviewWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'code-review'. The all-terminal
//   check (step 4) and WAIT fallback remain unscoped.
//   1. Re-engagement (BEFORE FAIL) — most recent code-review is FAIL AND
//      hasNewUpstreamPassSince('qa','code-review') = true → IN_PROGRESS.
//   2. FAIL short-circuit — most recent code-review is FAIL (step 1 guard false) → READY_FOR_QA.
//   3. READY_FOR_DOCUMENTATION — non-terminal WPs in reviewWps where PASS code-review exists AND
//      hasNewUpstreamPassSince('code-review','documentation') = true; dep-blocked routing applies.
//   4. All terminal → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the re-engagement and FAIL short-circuit checks in source
//      order (lines 671-674 of workflow-handoff.ts). Added to match the same guard
//      in getDeveloperHandoff. wpDetails.length > 0 precondition prevents Array.every()
//      vacuous truth on an empty array.
//   5. IN_PROGRESS assigned to Reviewer (from reviewWps) → IN_PROGRESS.
//   6. Cross-WP dispatch — findNextReadyDispatch(wpDetails, 'Reviewer'): if a READY,
//      non-dependency-blocked WP exists, routes to the agent owning its first active stage.
//      If all WPs are terminal, returns READY_FOR_SYNTHESIS. (See Constraint 55.)
//   → WAIT
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getSecurityAuditorHandoff: short-circuit priority order:
//   Scope filter: pipeline-specific checks operate on securityWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'security-audit'.
//   1. FAIL short-circuit — most recent security-audit is FAIL → READY_FOR_DEVELOPER.
//   2. READY_FOR_REVIEW — non-terminal WPs in securityWps where PASS security-audit exists AND
//      hasNewUpstreamPassSince('security-audit','code-review') = true; dep-blocked routing applies.
//   3. All terminal → READY_FOR_SYNTHESIS.
//   4. IN_PROGRESS assigned to Security Auditor (from securityWps) → IN_PROGRESS.
//   5. Cross-WP dispatch — findNextReadyDispatch(wpDetails, 'Security Auditor'): if a READY,
//      non-dependency-blocked WP exists, routes to the agent owning its first active stage.
//      If all WPs are terminal, returns READY_FOR_SYNTHESIS. (See Constraint 55.)
//   → WAIT
export async function getSecurityAuditorHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getReleaseEngineerHandoff: short-circuit priority order:
//   1. All terminal — all WPs COMPLETE or CANCELLED → READY_FOR_SYNTHESIS.
//      Uses wpDetails.every(isTerminal) with .length > 0 guard, matching all other
//      non-PM handoff functions (harmonized from the previous releaseWps.every scope).
//   Scope filter: pipeline-specific checks (steps 2, 3) operate on releaseWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'release-engineering'.
//   2. Ready for release — PASS code-review, no release-engineering pipeline yet or new upstream pass
//      → IN_PROGRESS.
//   3. FAIL self-rework — most recent release-engineering is FAIL → IN_PROGRESS (self-rework).
//   4. Cross-WP dispatch — findNextReadyDispatch(wpDetails, 'Release Engineer'): if a READY,
//      non-dependency-blocked WP exists, routes to the agent owning its first active stage.
//      If all WPs are terminal, returns READY_FOR_SYNTHESIS. (See Constraint 55.)
//   → WAIT
export async function getReleaseEngineerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getDocumentationHandoff (§5.4): §14.5 priority — ready-for-docs BEFORE self-rework:
//   0. All-terminal early exit — wpDetails.length > 0 && wpDetails.every(isTerminal) →
//      READY_FOR_SYNTHESIS. Applies to all WPs regardless of active stages. The .length > 0
//      guard prevents Array.every() vacuous truth on an empty array.
//   Scope filter: pipeline-specific checks (steps 1, 2) operate on docWps — WPs whose
//   (active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES) includes 'documentation'. Steps 3 and 4
//   (allDocsPassed / wpsNotYetReviewed) also derive from docWps. The WAIT fallback is unscoped.
//   1. Ready-for-docs — non-terminal WPs in docWps where PASS code-review exists AND
//      (no documentation pipeline yet OR hasNewUpstreamPassSince('code-review','documentation') = true)
//      → IN_PROGRESS (new docs or re-engagement; this step precedes FAIL to avoid FAIL shadowing).
//   2. FAIL self-rework — most recent documentation is FAIL (step 1 guard false)
//      → IN_PROGRESS (Documentation self-reworks; never forwarded to Developer).
//   3. allDocsPassed — all non-dep-blocked WPs in docWps have PASS documentation:
//        non-empty unblocked → READY_FOR_SYNTHESIS; all dep-blocked → WAIT.
//   4. wpsNotYetReviewed remain — dep-blocked routing:
//        not all dep-blocked → READY_FOR_REVIEW; all dep-blocked → READY_FOR_SYNTHESIS.
//   5. Cross-WP dispatch — findNextReadyDispatch(wpDetails, 'Documentation'): if a READY,
//      non-dependency-blocked WP exists, routes to the agent owning its first active stage.
//      If all WPs are terminal, returns READY_FOR_SYNTHESIS. (See Constraint 55.)
//   → WAIT
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getProjectManagerHandoff (§13.1): steps applied to full WP list:
//   1. Non-dependency blockers — any WP is BLOCKED with technical/external/decision blocker
//      → IN_PROGRESS (PM must intervene; dependency-blocked WPs fall through).
//   2. READY WPs — routed to the first-stage owner:
//        assigned WPs: readyStatusForAgent(wp.assigned_to) → READY_FOR_QA, READY_FOR_DEVELOPER, etc.
//        unassigned WPs: PIPELINE_AGENT_MAP[firstActiveStage(active_pipeline_stages ?? null)]
//          resolves the agent who owns the WP's first active stage (e.g. doc-only WP →
//          firstActiveStage='documentation' → READY_FOR_DOCUMENTATION). Legacy WPs without
//          active_pipeline_stages fall back to DEFAULT_PIPELINE_STAGES[0]='implementation'
//          → READY_FOR_DEVELOPER (backward compatible).
//   2b. IN_PROGRESS WPs needing next pipeline stage (fires only when step 2 finds no READY WPs):
//        For each non-terminal, non-dependency-blocked IN_PROGRESS WP, scans
//        getOrderedActiveStages(wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES):
//          - stage PASS (most recent non-auto-cancelled) → continue to next stage
//          - stage FAIL → break (FAIL routing is handled by the downstream agent's own handoff)
//          - stage IN_PROGRESS → break (stage already being worked on)
//          - upstream (resolvePrerequisite) IN_PROGRESS → break (premature routing prevention)
//          - otherwise → route to PIPELINE_AGENT_MAP[stage] via readyStatusForAgent()
//        Covers two scenarios: (a) stage-transition routing (e.g. impl PASS → READY_FOR_QA),
//        and (b) freshly-claimed WPs with zero pipelines (routes to first active stage's agent).
//   3. All terminal → READY_FOR_SYNTHESIS.
//   → WAIT
export async function getProjectManagerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// Maps a workflow status string and currentAgent to the next agent role name.
// Returns null for any terminal status (COMPLETE or CANCELLED) via isTerminalStatus(),
// returns currentAgent for IN_PROGRESS, and looks up the next agent role for all other statuses.
// Known READY_FOR_* mappings include: READY_FOR_PM → 'Project Manager', READY_FOR_DEVELOPER,
// READY_FOR_QA, READY_FOR_REVIEW (→ 'Reviewer'), READY_FOR_SYNTHESIS (→ 'Synthesis').
export function nextAgentFromStatus(status: string, currentAgent: string): string | null;

// Shared utility: compute handoff status payload without MCP response wrapper.
// Called by workflow-next-action.ts to embed handoff_status in WAIT responses,
// eliminating the need for a separate ledger_get_handoff_status call for all agent roles
// (Project Manager, Developer, QA, Reviewer, Documentation, Synthesis).
// Throws on path validation failure or project-not-found errors.
//
// opts (all optional): when store, rootIndex, and wpDetails are ALL provided, the function
// bypasses getHandoffStatus() entirely — dispatching directly to the per-role handoff function
// with the pre-loaded data. This avoids redundant LedgerStore construction and disk reads on
// every WAIT response in the next-action flow. When any field is absent, falls back to the
// original getHandoffStatus() path (compatible with the standalone tool call path).
export async function computeHandoffStatus(
  projectPath: string,
  agentRole: string,
  opts?: { store?: LedgerStore; rootIndex?: RootIndex; wpDetails?: WorkPackageDetail[] },
): Promise<Record<string, unknown>>;

// Builds the standard handoff response payload (current_agent, next_agent, status).
// When projectPath and store are provided and auto-handoff depth allows, appends an
// auto_handoff object to the payload. The auto_handoff shape is:
//
//   auto_handoff: {
//     agent_name: string,           // VS Code agent name (e.g. "3 - Developer v3.5.2")
//     agent_id?: string,            // VS Code agent id (e.g. "ledger-3-dev") — omitted when absent
//     cc_agent_name: string,        // Claude Code agent slug from AGENT_NAMES (e.g. "3-developer")
//     vs_agent_name: string,        // VS Code agent display name from AGENT_NAMES (e.g. "3 - Developer v3.6.1")
//     da_agent_name: string,        // Deep Agents agent slug from AGENT_NAMES (e.g. "3-developer")
//     prompt: string,               // Project path prompt, prefixed with "@{agent_id}\n" when agent_id is present
//   }
//
// agent_id is resolved via getAgentId(nextAgent) and omitted (not set to null) when the
// registry has no id for the next agent, ensuring clean JSON serialization.
// cc_agent_name / vs_agent_name / da_agent_name are resolved via AGENT_NAMES[nextAgent] and
// omitted as a group (via a guarded spread) when the role has no entry in the name mapping.
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
| `[FAIL (auto-cancelled)]` | `false` (auto-cancelled entries filtered out) |
| `[FAIL (auto-cancelled), PASS]` | `false` (effective most-recent is PASS) |
| Wrong type (no match) | `false` |

---

## MCP Server Registration

Each tool module exports:

```typescript
function register(server: McpServer): void;
```

These are called in `src/index.ts` to register all tools on the server instance.

```
###  Path: `/mcp-server/docs/agents/project-manifest/constraints.md`

```md
# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas.

### Constraint Entry Format

New constraint entries should follow this structure (modelled on Constraint 2):

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Workflow Specification Governance

### 0. The Workflow Specification Is the Source of Truth for All Workflow Logic

**Rule:** The [Workflow Specification](../workflow-specification/README.md) is the authoritative definition of all workflow logic — state machines, pipeline routing, status transitions, handoff behavior, recommendation engine behavior, edge cases, and constants. Implementation code must conform to the specification. When code contradicts the specification, the code is wrong.

**Spec-first development:** Changes to workflow logic MUST be made in the specification first, then implemented in code, then validated by tests, then documented in the project manifest — in that order.

**Test traceability:** Test descriptions SHOULD reference the workflow specification section they validate (e.g., `// §14.13 row 1: returns true when QA FAIL started after impl PASS completed`). This convention is already practiced in several test files and should be followed consistently.

**Rationale:** The specification was designed to be a language-agnostic, formally reviewed reference. Treating code as the source of truth defeats this purpose and leads to silent behavioral drift between the TypeScript (MCP server) and Python (orchestrator) implementations.

**Scope:** This constraint applies to workflow logic only — file I/O, schema validation, concurrency primitives, and other infrastructure concerns are governed by their respective constraints below and the project manifest.

---

## File System Constraints

### 1. All File I/O Must Be Atomic

**Rule:** Never write directly to target files. Always use the `atomicWriteJson()` function.

**Rationale:** Ensures readers never see partial writes or corrupt JSON.

**Implementation:** Write to `{file}.tmp.{pid}`, then atomically rename to target.

**Anti-pattern:**
```typescript
// ❌ WRONG — direct write; a crash mid-write leaves the target file truncated or corrupt
await fs.writeFile(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
```

**Correct pattern:**
```typescript
// ✅ CORRECT — write to .tmp.{pid}, then rename; readers never see a partial file
await atomicWriteJson(targetPath, data);
```

---

### 2. Dual-File Updates Require Locking

**Rule:** When writing both `storage/ledger/{slug}/project-ledger.json` and `storage/ledger/{slug}/WP-###.json`, always use the appropriate high-level method: `LedgerStore.createWorkPackageWithSync()` for creating a new WP, `LedgerStore.updateWorkPackageWithSync()` for updating a single existing WP, or `LedgerStore.batchUpdateWorkPackagesWithSync()` for updating multiple WPs in one operation (see Constraint 2b). Only fall back to a manual `withLock(store.storageDir, ...)` scope when none of these methods covers the use case. **`store.storageDir` is the only acceptable first argument to `withLock` — never pass `projectPath`, `ledgerRoot`, or `ledgerRoot ?? projectPath`.** Once a `LedgerStore` is constructed, use its `.storageDir` property to obtain the canonical lock directory.

**Extension — Single-File Read-Modify-Write:** Even when updating only the root index, any read-modify-write sequence must also be wrapped in `withLock(store.storageDir, ...)` to prevent TOCTOU races. Example: `completeSynthesis` reads the root index, mutates `synthesis_generated` and project status, then writes it back — this entire sequence must occur inside a single lock scope.

**Rationale:** Prevents race conditions and dual-file desync when multiple agents run concurrently.

**Anti-pattern:**
```typescript
// ❌ WRONG — race condition risk
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:**
```typescript
// ✅ CORRECT — atomic dual-file creation (new WP)
await store.createWorkPackageWithSync(async (root) => {
  // ... build new WP detail and updated root ...
  return { wpId, wp: newWpDetail, root: updatedRoot };
});

// ✅ CORRECT — atomic dual-file update (existing WP)
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... update both wp and root ...
  return { wp: updatedWp, root: updatedRoot };
});
```

---

### 2b. Batch Multi-WP Writes Must Use `batchUpdateWorkPackagesWithSync`

**Rule:** When updating multiple work packages and the root index in a single operation, always use `LedgerStore.batchUpdateWorkPackagesWithSync()`. Never loop over `updateWorkPackageWithSync()` calls or acquire multiple separate `withLock` scopes to write a batch of WPs — this produces one lock acquisition per WP instead of one per operation.

**Rationale:** A loop of per-WP lock acquisitions is not atomic at the operation level: a crash or concurrent write between iterations can leave some WPs updated while others are not, desynchronizing WP state and the root index. `batchUpdateWorkPackagesWithSync` consolidates all reads, validation, writes, and the root index sync into a single lock scope.

**Atomicity invariant (two-pass validate-then-write):** The method validates all WPs via Zod **before** writing any of them. A validation failure on any WP in the batch aborts the entire operation with no disk writes. This is stronger than the per-WP atomicity provided by `updateWorkPackageWithSync`, which validates and writes one WP at a time.

**Note on lock-scope vs. rollback-scope atomicity:** If a file write succeeds for WP-A but a subsequent I/O error prevents writing WP-B, WP-A's write is not rolled back. This characteristic is shared with `updateWorkPackageWithSync`. Validation failures are fully atomic (no writes); I/O failures after the write phase begin are not.

**Anti-pattern:**
```typescript
// ❌ WRONG — multiple lock acquisitions; not atomic across the batch
for (const wpId of candidateIds) {
  await store.updateWorkPackageWithSync(wpId, (wp, root) => {
    // ...
    return { wp: updatedWp, root: updatedRoot };
  });
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — single lock; all WPs validated before any write
await store.batchUpdateWorkPackagesWithSync(async (root, readWp) => {
  const updatedWps = new Map<string, WorkPackageDetail>();
  for (const wpId of candidateIds) {
    const wp = await readWp(wpId);
    // ... mutate wp ...
    updatedWps.set(wpId, wp);
  }
  // ... mutate root ...
  return { updatedWps, root: updatedRoot };
});
```

**Known callers:** `propagateDependencyUnblock` and `propagateDependencyReblock` in `src/tools/work-package.ts`; `applyProjectReset` and `markProjectComplete` in `src/utils/project-reset.ts`.

---

### 2c. `writeWorkPackage` and `writeRootIndex` Are `@internal` — Tool Code Must Not Call Them Directly

**Rule:** `LedgerStore.writeWorkPackage()` and `LedgerStore.writeRootIndex()` are marked `@internal` in source. Tool functions (`src/tools/`) and shared helpers (`src/utils/`) must never call these methods directly. All WP+root writes must go through one of the three sync methods (Constraints 2 and 2b).

**Rationale:** Bypassing the sync methods skips `last_updated` auto-stamping, Zod validation, `.meta.json` sync, and the single-lock atomicity guarantee. The `@internal` tag is documentation-only (TypeScript does not enforce it) — this constraint encodes the boundary as a project rule.

**Legitimate direct callers of `writeRootIndex` (non-tool code):**
- `src/tools/project-lifecycle.ts` — `getProjectStatus()` self-healing: repairs stale counter fields under an explicit `withLock` scope; `initializeProject()` and `completeSynthesis()` for root-index-only transitions that don't involve any WP file write
- `auto-archive.ts` — sets `status: 'ARCHIVED'` with `preserveLastUpdated: true` (root-index write only; sync methods do not apply)
- `observations.ts` — appends a project-level comment (root-index write only; no WP file involved)
- `workflow-handoff.ts` — `buildHandoffResponse()`: increments or caps the `auto_handoff_depth` counter on every handoff-status response; root-index-only write with no WP file involvement

**`writeWorkPackage` — zero external callers (post-WP-002):** As of the WP-002 migration (consolidate-wp-writes), `writeWorkPackage` has no legitimate external callers. Every previously-direct caller (e.g., `project-reset.ts`) has been migrated to a sync method. The `@internal` boundary for `writeWorkPackage` is now absolute.

**Anti-pattern:**
```typescript
// ❌ WRONG — bypasses auto-stamping, validation, and .meta.json sync
await store.writeWorkPackage(wpId, updatedWp);
await store.writeRootIndex(updatedRoot);
```

**Correct pattern:** Use `updateWorkPackageWithSync`, `createWorkPackageWithSync`, or `batchUpdateWorkPackagesWithSync` as shown in Constraints 2 and 2b.

---

### 3. Paths Must Be Absolute

**Rule:** All MCP tool inputs require absolute paths for `project_path`.

**Rationale:** The server has no concept of "current working directory" — it must be told explicitly where files live.

---

### 4. Plan Folders Must Remain Human-Readable Markdown Only

**Rule:** No machine-generated files (JSON, lock files, etc.) may be written inside plan folders.

**Rationale:** Plan folders are the authoritative human source-of-truth. Machine output lives in the centralized ledger at `{mcp-server}/storage/ledger/{slug}/`.

**Archiving clarification:** `archiveDocuments()` copies files **from** the plan folder **into** the centralized storage directory (`storage/ledger/{slug}/`). The direction is one-way: plan folder → ledger. The archived copy is read-only from the agent's perspective — it exists for retrieval by the GUI and tooling, not for editing. The original file in the plan folder remains the authoritative source and is never modified by the server. This is fully consistent with Constraint 4: no writes ever occur inside the plan folder.

**`plan_file` validation:** the `plan_file` argument accepted by `ledger_initialize_project` is enforced at parse time by a Zod `.refine()` check: `v === PLAN_ARCHIVE_FILENAME`. Calls with any value other than `'plan.md'` are rejected with a Zod validation error before reaching handler logic. This ensures the GUI's `/api/projects/:slug/plan` endpoint can always rely on the archived plan document having the fixed filename `plan.md`.

**Archive error contract:** `archiveDocuments()` uses a discriminated error strategy:
- Missing source file (`ENOENT`) — the filename is silently added to `skipped[]` and a warning is written to `stderr`. The operation continues with remaining files.
- All other I/O errors (e.g., `EACCES`, `ENOSPC`, `EISDIR`) — the error is **re-thrown** to the caller. Callers must not assume all errors from `archiveDocuments()` are benign; they must be prepared to handle re-thrown non-ENOENT errors.

---

### 5. `.meta.json` Must Be Written Under the Project Lock

**Rule:** `writeProjectMeta()` must always be called inside the same `withLock()` scope as the root index write it synchronizes. Never call it outside a lock context except for the standalone `writeRootIndex()` (which manages its own internal sync). Note: `writeRootIndex` is `@internal` — see Constraint 2c for the list of legitimate direct callers.

**Rationale:** Prevents `.meta.json` from lagging behind the root index in a concurrent environment.

---

### 6. Central Ledger Root Is Resolved Once at Startup

**Rule:** `resolveLedgerRoot()` is called once at server startup. The `--ledger-dir <path>` CLI argument overrides the default `{mcp-server}/storage/ledger/` location. The resolved path is logged to stderr.

**Usage:**
```bash
# Override ledger root:
node dist/index.js --ledger-dir /custom/path/to/ledger
```

**Default:** `{mcp-server}/storage/ledger/` (relative to the server package root).

---

### 7. STDIO Logging Discipline

**Rule:** Never log to `stdout`. All logs must go to `stderr`.

**Rationale:** `stdout` is reserved for the MCP protocol. Logging to `stdout` breaks protocol communication.

**Implementation:**
```typescript
// ✅ CORRECT
console.error('[project-ledger-mcp] Server started');

// ❌ WRONG — breaks MCP protocol
console.log('[project-ledger-mcp] Server started');
```

---

## Schema Constraints

### 8. Work Package IDs Must Follow WP-### Format

**Rule:** All work package IDs must match the regex `/^WP-\d{3,}$/` (e.g., `WP-001`, `WP-042`, `WP-999`, `WP-1000`). The minimum is three digits; there is no upper bound to future-proof projects beyond WP-999.

**Enforcement:** Validated by Zod schemas in `GetWorkPackageSchema`, `CreateWorkPackageSchema` (dependencies array), `ClaimWorkPackageSchema`, `StartPipelineSchema`, `CompletePipelineSchema`, `CancelPipelineSchema`, `UpdatePipelineProgressSchema`, and `AddObservationSchema`, as well as utility functions (`formatWpId()`, `parseWpId()`).

---

### 9. Timestamps Must Use UTC ISO 8601 Format (YYYY-MM-DDTHH:MM:SSZ)

**Rule:** All timestamp fields use UTC ISO 8601 format with a trailing `Z`. Always use the `now()` utility function.

**Anti-pattern:**
```typescript
// ❌ WRONG — local time, inconsistent format
const timestamp = new Date().toLocaleString();
```

**Correct pattern:**
```typescript
// ✅ CORRECT — UTC with trailing Z
const timestamp = now(); // "2026-02-16T18:00:00Z"
```

**Backward compatibility:** `parseTimestamp()` accepts legacy formats (`YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` without Z) for ledger files written by earlier versions.

---

### 10. JSON Must Be Pretty-Printed

**Rule:** All JSON files written by the server must use 2-space indentation and include a trailing newline.

**Rationale:** Human readability and clean git diffs.

**Enforcement:** `atomicWriteJson()` automatically formats as `JSON.stringify(data, null, 2) + '\n'`.

---

## Business Rule Constraints

### 11. Status Transitions Are Enforced

**Rule:** Work package status transitions must follow the legal transition table:

| From | To | Special Conditions |
|------|----|--------------------|
| `READY` | `IN_PROGRESS` | Dependencies must be `COMPLETE` or `CANCELLED` |
| `READY` | `BLOCKED` | None |
| `READY` | `CANCELLED` | PM-only agent guard |
| `IN_PROGRESS` | `COMPLETE` | All acceptance criteria must be met; Documentation agent only |
| `IN_PROGRESS` | `BLOCKED` | None |
| `IN_PROGRESS` | `READY` | None (unclaim path, spec §21.13) |
| `IN_PROGRESS` | `CANCELLED` | PM-only agent guard |
| `BLOCKED` | `IN_PROGRESS` | None (implicitly means blocker resolved); clears `blocked_by` |
| `BLOCKED` | `READY` | All dependencies COMPLETE (auto-unblock); clears `blocked_by` |
| `BLOCKED` | `CANCELLED` | PM-only agent guard |
| `COMPLETE` | `IN_PROGRESS` | Triggers revision increment; Project Manager or Documentation agent only |
| `COMPLETE` | `CANCELLED` | PM-only agent guard |

`CANCELLED` is the only fully **terminal status** — it has no outward transitions. This includes `CANCELLED → CANCELLED` self-transitions — re-cancelling an already-cancelled WP is rejected. `COMPLETE` allows one outward transition (to `CANCELLED`, PM-only).
**Rule:** A work package cannot be marked `COMPLETE` unless all acceptance criteria have `met: true`.

**Enforcement:** `canCompleteWorkPackage()` validator in `ledger_update_work_package_status` tool.

**Error message format:**
```
Cannot mark work package as COMPLETE: the following acceptance criteria are not met:
  - Criterion 1
  - Criterion 2
```

> Full specification: [Workflow Specification §6.2](../workflow-specification/state-machines.md#62-transition-table).

---

### 13. Only Documentation Agent Can Set COMPLETE

**Rule:** The `ledger_update_work_package_status` tool rejects transitions to `COMPLETE` from any agent other than `"Documentation"` or `"Documentation Agent"`.

**Enforcement:** Hard guard in `updateWorkPackageStatus()`. The error message includes the full workflow reminder (Developer → QA → Reviewer → Documentation → COMPLETE).

**Rationale:** Enforces the multi-stage workflow at the MCP server level. Previously this was a persona-level convention only; the guard was added after the 2026-02-22 workflow failure where a Developer agent set COMPLETE directly. As of WP-005, auto-finalize on terminal-stage PASS (see Constraint 13b) is the preferred COMPLETE path — `ledger_update_work_package_status` remains registered for PM and edge-case use only.

> Full specification: [Workflow Specification §6.5, §21.10](../workflow-specification/state-machines.md#65-agent-guards).

---

### 13b. Auto-Finalize on Terminal-Stage Pipeline PASS (WP-005)

**Rule:** When `ledger_complete_pipeline` is called with `status: "PASS"` and the calling agent owns the WP's **last active stage** (terminal stage), the server automatically evaluates whether all acceptance criteria are met **after** applying `acceptance_criteria_updates`. If all criteria are met, the WP is transitioned to `COMPLETE` **within the same lock scope** as the pipeline completion — no separate `ledger_update_work_package_status` call is required.

The terminal stage is determined dynamically: `CANONICAL_PIPELINE_ORDERING.filter(t => activeStages.includes(t)).at(-1)`. For default WPs (`DEFAULT_PIPELINE_STAGES`), this is `documentation` (Documentation agent). For custom-stage WPs it may be any stage.

**Conditions (all must apply):**
- `type === lastActiveStage` (the last entry in the WP's ordered active stages)
- `status === 'PASS'`
- `agent_role === PIPELINE_AGENT_MAP[lastActiveStage]` (PM overrides bypass auto-finalize)
- All `wp.acceptance_criteria[*].met === true` after applying `acceptance_criteria_updates`

**Response signals:**
- `auto_finalized: true` — WP transitioned to COMPLETE; `pending_work_packages` decremented.
- `auto_finalize_blocked: true` + `unmet_criteria: string[]` — criteria check failed; WP stays IN_PROGRESS.

**Enforcement:** Logic in `completePipeline()` in `src/tools/pipeline.ts` (added in WP-006).

**Dependency unblocking side-effect (§6.3):** When auto-finalize transitions the WP to `COMPLETE`, `propagateDependencyUnblock` is called **after** the main lock is released (consistent with §12.2, Gotcha 8). This transitions eligible BLOCKED dependents to `READY`. Only dependents whose `blocked_by.type` is `'dependency'` (or absent) are eligible — WPs blocked by `'external'`, `'decision'`, or `'technical'` reasons remain BLOCKED.

**Rationale:** The Documentation agent always called `ledger_update_work_package_status` immediately after a PASS pipeline — the transition was unconditional and never conditional. Automating it server-side removes a mandatory extra tool call from every Documentation pipeline, shortening the agent loop by one step.

**`ledger_update_work_package_status` remains registered** for PM and edge-case use (e.g., re-opening a WP, manually completing a WP with prior pipeline history).

---

### 14. Claiming a WP Assigned to Another Agent Requires Override

**Rule:** `ledger_claim_work_package` rejects the claim when the work package's `assigned_to` field differs from the calling `agent` parameter, unless `override: true` is explicitly passed.

**Authorization:** Only the **Project Manager** (`"Project Manager"`) and the **current assignee** (`wp.assigned_to`) are permitted to use `override: true`. Any other agent passing `override: true` will receive a hard rejection error. The guard is conditional on `wp.assigned_to` being set — unassigned WPs bypass the identity check.

**Error message (unauthorized override):**
```
override is restricted to "Project Manager" or the current assignee ("Developer"). You are "Reviewer".
```

**Enforcement:** Hard guard in `claimWorkPackage()` before dependency and status-transition checks.

**Error message format:**
```
Cannot claim work package WP-002: it is assigned to "Documentation" but you are "Developer".

If you need to re-assign this WP, pass override: true.
Otherwise, only claim work packages assigned to your role.
```

**Rationale:** Prevents agents from silently re-assigning WPs outside their remit — the root cause of the 2026-02-22 workflow failure where the Developer agent claimed and completed a Documentation WP.

---

### 15. Dependencies Must Exist Before Creation

**Rule:** When creating a work package, all dependency IDs must already exist in the root index.

**Enforcement:** `ledger_create_work_package` validates dependencies before creating the work package.

**Rationale:** Prevents dangling references.

---

### 16. BLOCKED Status Requires Blocker Object

**Rule:** When transitioning a work package to `BLOCKED`, the `blocked_by` field must be provided.

**Enforcement:** `ledger_update_work_package_status` throws an error if `status: 'BLOCKED'` is passed without `blocked_by`.

---

### 17. Pipelines Require IN_PROGRESS Work Package

**Rule:** A pipeline can only be started on a work package with status `IN_PROGRESS`.

**Enforcement:** `ledger_start_pipeline` validates WP status before creating pipeline.

**Rationale:** Prevents starting work before a work package is claimed.

---

### 18. No Duplicate IN_PROGRESS Pipelines

**Rule:** Only one pipeline of a given type can be `IN_PROGRESS` at a time for a work package.

**Enforcement:** `ledger_start_pipeline` checks for existing `IN_PROGRESS` pipeline of the same type before creating a new one.

**Rationale:** Forces agents to complete or fail a pipeline before retrying.

---

### 19. Pipelines Must Follow the Required Ordering

**Rule:** Pipelines must be started in the order defined by the work package's `active_pipeline_stages` (defaults to `DEFAULT_PIPELINE_STAGES` — `['implementation', 'qa', 'code-review', 'documentation']` — when omitted). Each stage requires a PASS on its immediately preceding active stage. Attempting to start a pipeline without the **most recent** prerequisite pipeline having a `PASS` status throws a descriptive error. A historical PASS followed by a FAIL is not sufficient — the most recent entry is the only one that counts (per §8.2 most-recent-wins semantics).

**Enforcement:** `ledger_start_pipeline` calls `resolvePrerequisite(type, activeStages)` — which filters `CANONICAL_PIPELINE_ORDERING` by the WP's `active_pipeline_stages` and returns the immediately preceding active stage — then finds the most recent pipeline of that prerequisite type via `.at(-1)`, and rejects if it is absent or its status is not `PASS`.

**Error message format:**
```
Cannot start 'qa' pipeline: requires a PASS 'implementation' pipeline first.
Active pipeline order: implementation → qa → code-review → documentation.
```

**Exception:** The first active stage in the WP's ordering has no prerequisite and can always be started (subject to other constraints). For `DEFAULT_PIPELINE_STAGES`, this is `implementation`.

> Full specification: [Workflow Specification §8](../workflow-specification/pipeline-routing.md).

---

### 20. Pipeline Start Auto-Updates `assigned_to`

**Rule:** When a pipeline starts, the work package's `assigned_to` field is automatically updated to the responsible agent according to the `PIPELINE_AGENT_MAP`:

| Pipeline type | Assigned agent |
|---|---|
| `implementation` | `Developer` |
| `qa` | `QA` |
| `security-audit` | `Security Auditor` |
| `code-review` | `Reviewer` |
| `release-engineering` | `Release Engineer` |
| `documentation` | `Documentation` |

**Enforcement:** `ledger_start_pipeline` applies the map atomically alongside the pipeline creation. Both WP detail and root index summary are updated.

---

### 21. Rework Count Increments on Pipeline Retry

**Rule:** When `ledger_start_pipeline` detects a rework, the work package's rework counters are automatically incremented. Rework is detected when either:
- **Direct rework:** The most recent completed pipeline of the same type has `FAIL` status.
- **Downstream rework:** A prerequisite pipeline type was reworked (re-failed) after the last PASS of the current pipeline type.

Auto-cancelled pipelines (`.auto_cancelled === true`) are excluded from both rework-detection checks. This exclusion also applies to **temporal comparison functions** such as `checkRevalidationGuard` — a pipeline with `auto_cancelled: true` is invisible to all time-based guard logic. Auto-cancelled pipelines must never be counted by rework detection, circuit breakers, or any temporal comparison function.

**Primary field:** `rework_counts` — a per-pipeline-type map (`{ implementation?, qa?, code-review?, documentation? }`). This is the authoritative counter going forward.

**Legacy field:** `rework_count` — a scalar counter that was maintained during a prior transition period. **Fully retired as of 2026-02-28.** No production code path writes this field anymore. The in-memory migration in `LedgerStore.readWorkPackage()` (see below) handles any on-disk files that still contain it, but no new writes are emitted.

**Backward-compat migration:** `LedgerStore.readWorkPackage()` performs a lazy in-memory migration: if a file contains `rework_count` but no `rework_counts`, it synthesises `rework_counts: { implementation: rework_count, qa: 0, 'code-review': 0, documentation: 0 }` and removes `rework_count`. This migration is **in-memory only** — no write is triggered; the on-disk file is updated lazily on the next `updateWorkPackageWithSync()` call.

**Enforcement:** `ledger_start_pipeline` applies both rework-detection checks and excludes auto-cancelled pipelines. A history of `[FAIL, PASS]` does **not** trigger an increment because the most recent is `PASS`.

**Initial value:** Both fields are absent (`undefined`) until the first rework; neither is ever initialised to `0` on creation.

| Rework condition | rework_counts change |
|---|---|
| None (no prior failure, no downstream rework) | No increment |
| Direct rework (last same-type FAIL) | rework_counts[type] +1 |
| Downstream rework (prerequisite reworked after last PASS) | rework_counts[type] +1 |

**Circuit breaker:** After incrementing, the effective count is computed as `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), `ledger_start_pipeline` rejects with an error guiding the caller to cancel or restructure. The `getDeveloperAction` function also surfaces `BLOCK_FOR_REWORK_LIMIT` as the highest-priority action for affected WPs.

---

### 22. Handoff Notes Are Routed via resolveNextAgent / resolveFailAgent

**Rule:** When `ledger_complete_pipeline` is called with a `handoff_notes` array, a structured `HandoffNote` entry is appended to the work package. The `to_agent` is determined dynamically based on pipeline status and the WP's `active_pipeline_stages`:

- **On PASS:** `resolveNextAgent(type, activeStages)` returns the owner of the next active stage in canonical order, or `'Synthesis'` when the type is the last active stage.
- **On FAIL:** `resolveFailAgent(type, activeStages)` uses a base routing map extended to all 6 stages. If the base fail-target's stage is absent from `activeStages`, the fallback is the agent that owns the first active stage.

**Routing for the default 4-stage pipeline (`DEFAULT_PIPELINE_STAGES`):**

| Pipeline type | PASS → to_agent | FAIL → to_agent |
|---|---|---|
| `implementation` | `QA` | `Developer` |
| `qa` | `Reviewer` | `Developer` |
| `code-review` | `Documentation` | `Developer` |
| `documentation` | `Synthesis` | `Documentation` |

**Additional types (dynamic, per-WP routing):**

| Pipeline type | PASS → to_agent (next active stage) | FAIL → to_agent (base routing) |
|---|---|---|
| `security-audit` | `Reviewer` (if `code-review` is next active) or subsequent active stage | `Developer` |
| `release-engineering` | `Documentation` (if `documentation` is next active) or subsequent active stage | `Release Engineer` (self-rework) |

> `documentation` and `release-engineering` self-rework on FAIL. All other FAIL paths route to the Developer (base routing). When the base fail-target's stage is absent from the WP's `active_pipeline_stages`, routing falls back to the first active stage's agent.

**Schema:**
```typescript
interface HandoffNote {
  from_agent: string; // PIPELINE_AGENT_MAP[type], or 'Project Manager (PM Override)' when PM override is active
  to_agent: string;   // resolveNextAgent(type, activeStages) on PASS; resolveFailAgent(type, activeStages) on FAIL
  timestamp: string;
  notes: string[];    // The strings passed in handoff_notes
}
```

**`ledger_complete_pipeline` guards (applied before pipeline lookup):**
1. **WP status guard:** Rejects if `wp.status !== 'IN_PROGRESS'` (defense-in-depth).
2. **Agent role guard:** `agent_role` must match `PIPELINE_AGENT_MAP[type]`. Exception: `agent_role === 'Project Manager'` bypasses this check (PM Override). When PM override is active, `from_agent` is set to `'Project Manager (PM Override)'`.

**Consumption:** `ledger_get_next_action` and `ledger_get_next_actions` include any handoff notes addressed to the requesting agent in their response, so the next agent sees the notes immediately when they ask for their next action.

> Full specification: [Workflow Specification §9, §12](../workflow-specification/pipeline-routing.md).

---

### 22b. PM Handoff Detects Pending Pipeline Stages on IN_PROGRESS WPs (Step 2b Invariant)

**Rule:** Both `getProjectManagerHandoff()` (§13.1, `workflow-handoff.ts`) and `getProjectManagerAction()` (§14.1.2, `workflow-next-action.ts`) MUST scan non-terminal, non-dependency-blocked `IN_PROGRESS` work packages for pending pipeline stages when no `READY` WPs exist. This scan — called **step 2b** in the handoff function and **Priority 3d** in the recommendation engine — is the only mechanism that advances a WP between pipeline stages after a stage PASS, and that bootstraps freshly-claimed WPs with zero pipelines to their first active stage.

**Invariant:** An IN_PROGRESS WP that has a PASS on stage N and no pipeline started for stage N+1 MUST surface as actionable by the PM (either via `ROUTE_PIPELINE_AGENT` action or the equivalent `READY_FOR_<AGENT>` handoff status) before the affected agent can be dispatched. Failure to implement step 2b would leave such WPs silently stuck — the PM would return `WAIT` instead of routing the next agent.

**Guards (all must be applied):**
1. **FAIL guard** — If the most recent non-auto-cancelled pipeline for the current stage is FAIL, break the stage scan for this WP. The stage's own agent handles rework; the PM does not route.
2. **IN_PROGRESS guard** — If the most recent non-auto-cancelled pipeline for the current stage is IN_PROGRESS, break. The stage is already being worked on.
3. **Upstream IN_PROGRESS guard** — If the preceding stage's most recent non-auto-cancelled pipeline is IN_PROGRESS, break. Routing the next stage now would be premature.
4. **Dependency-blocked exclusion** — WPs where `wp.status === 'BLOCKED'` and `blocked_by.type === 'dependency'` (or `blocked_by` is absent) are excluded from step 2b entirely.

**Coverage scenarios:**
- **Stage-transition routing:** WP has implementation PASS and no QA pipeline → PM routes to QA.
- **Zero-pipeline bootstrap:** Freshly-claimed IN_PROGRESS WP with no pipelines → PM routes to first active stage's agent (e.g., Developer for default stages).

**Rationale:** The PM is the only agent whose action/handoff functions have visibility into all WPs simultaneously. Without step 2b, a WP that just received a pipeline PASS would not advance until something else triggered a re-scan. This invariant was added in v2.4.3 (WP-002/WP-003) to eliminate the gap where stage transitions required manual PM intervention.

> Implementation: `workflow-handoff.ts` `getProjectManagerHandoff()` §13.1 step 2b; `workflow-next-action.ts` `getProjectManagerAction()` §14.1.2 Priority 3d.

---

### 23. Pipeline Comments Have No Agent Field

**Rule:** Pipeline-level comments do not include an `agent` field. The agent is inferred from the pipeline type.

**Convention:**
- `implementation` pipeline → Developer
- `qa` pipeline → QA
- `code-review` pipeline → Reviewer
- `documentation` pipeline → Documentation

**Contrast:** Project-level comments include an explicit `agent` field because they are not tied to a specific pipeline.

---

### 24. Incident Comments Require Context

**Rule:** When adding a project comment with `type: 'incident'`, the `context` field is required.

**Enforcement:** `ledger_add_project_comment` throws an error if `type === 'incident'` and `context` is missing.

**Required context fields:**
- `os` — Operating system where incident occurred
- `tool` — Tool or command that caused the incident
- `work_package` (optional) — Associated work package
- `resolved` — Whether the incident is resolved
- `workaround` (optional) — Workaround description

---

## Concurrency Constraints

### 25. Lock Timeout Is 10 Seconds

**Rule:** File locks have a stale timeout of 10 seconds. Locks older than this are considered abandoned and can be forcibly acquired.

**Implication:** If a process crashes while holding a lock, other processes will wait up to 10 seconds before retrying.

---

### 26. Lock Retry Count Is 50

**Rule:** Lock acquisition is retried up to 50 times with 200ms–1000ms exponential backoff before failing.

**Total retry window:** ~10–50 seconds, ensuring coverage of the 10s stale timeout.

---

## Testing Constraints

> **CI gate:** The MCP server Vitest test suite (`npm test` in `mcp-server/`) is enforced on every push and pull request to `main` via `.github/workflows/ci.yml` (`mcp-server-tests` job, Node.js 20). All tests must pass before a PR can be merged.

### 27. Test Timeout Is 10 Seconds

**Rule:** All Vitest tests have a default timeout of 10 seconds.

**Configuration:** Set in `vitest.config.ts`.

**Rationale:** Integration tests may involve multiple file I/O operations and lock acquisitions.

---

### 28. Prefer Real Implementations Over `vi.mock` for Agent Registry and Ledger Tests

**Rule:** When writing tests that involve the agent registry (`discoverAgents`, `isRegistryLoaded`, `getAgentHandle`, `getAgentId`) or `LedgerStore`, use the real implementations backed by a temporary directory rather than `vi.mock`.

**Pattern:**
```typescript
import { discoverAgents, resetRegistry } from '../../src/utils/agent-registry.js';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'test-'));
  agentDir = join(tempDir, 'agents');
  await mkdir(agentDir);
  store = new LedgerStore(tempDir);
});

afterEach(async () => {
  resetRegistry();
  await rm(tempDir, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
});
```

**Rationale:** `vi.mock` creates module-level side-effects that can leak across test files, especially with ES module hoisting. Using real implementations with `resetRegistry()` cleanup eliminates mock side-effects, provides genuine end-to-end coverage, and is consistent with the approach in `tests/utils/agent-registry.test.ts`.

**Reserve `vi.mock` for:** Code paths that touch the network, spawn child processes, or produce uncontrollable side-effects that cannot be isolated with a temp directory.

---

### 29. Always Supply an Isolated Ledger Root When Constructing `LedgerStore` in Tests

**Rule:** Every test file that constructs a `LedgerStore` **must** pass a `mkdtemp`-based temporary directory as the second `ledgerRoot` argument. Omitting the argument (or passing the real `storage/ledger/` path) causes the store to write to production storage, accumulating stale artifact directories across CI and local runs.

**Preferred pattern — use the shared helper:**
```typescript
import { createTempStore, cleanupTempStore } from '../helpers/create-temp-store.js';

let handle: Awaited<ReturnType<typeof createTempStore>>;

beforeEach(async () => {
  handle = await createTempStore(join(tmpdir(), '2026-01-01-test-project'));
});

afterEach(async () => {
  await cleanupTempStore(handle);
});
```

**Why a helper?** `createTempStore(planPath)` in `tests/helpers/create-temp-store.ts` always injects a fresh `mkdtemp` root, making correct isolation the path of least resistance. Never construct `new LedgerStore(path)` with a single argument inside any test.

**Anti-pattern (forbidden):**
```typescript
// ❌ WRONG — writes to production storage/ledger/
const store = new LedgerStore('/absolute/path/to/my-plan');
```

---

### 30. `afterEach` Teardown Variables Must Be Declared in the Same `describe` Scope

**Rule:** Variables cleaned up in an `afterEach` block (e.g. a temp directory path) must be declared in the same `describe` block's scope, not in an outer scope. Referencing a variable from an outer scope is a silent bug — the inner `afterEach` compiles and runs but cleans up the *outer* variable, leaving the inner temp directory on disk.

**Pattern:**
```typescript
describe('my feature', () => {
  let tempDir: string;          // ← declared here
  let store: LedgerStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'my-feature-'));
    store = new LedgerStore(MY_PLAN_PATH, tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }); // ← same scope ✅
  });
});
```

**Anti-pattern:**
```typescript
let tempLedgerRoot: string; // ← outer scope

describe('nested', () => {
  let tempDir: string;      // ← different name / inner scope

  beforeEach(async () => { tempDir = await mkdtemp(…); });

  afterEach(async () => {
    await rm(tempLedgerRoot, { recursive: true, force: true }); // ❌ wrong variable
  });
});
```

---

## Module System Constraints

### 31. All Imports Must Use .js Extensions

**Rule:** Even when importing TypeScript files, use `.js` extensions.

**Example:**
```typescript
// ✅ CORRECT
import { LedgerStore } from '../storage/ledger-store.js';

// ❌ WRONG
import { LedgerStore } from '../storage/ledger-store';
```

**Rationale:** Node16 module resolution requires explicit file extensions for ESM.

---

### 32. No Default Exports

**Convention:** All exports are named exports. No default exports are used.

**Rationale:** Improves refactoring and tooling support.

---

## Validation Constraints

### 33. All Reads Are Validated

**Rule:** Every file read operation validates the JSON against a Zod schema before returning data.

**Enforcement:** `LedgerStore.readRootIndex()` and `LedgerStore.readWorkPackage()` both parse and validate.

**Failure modes:**
- File not found → `ENOENT` error
- Malformed JSON → `SyntaxError`
- Schema mismatch → Zod validation error

---

### 34. All Writes Are Validated

**Rule:** Every file write operation validates data against a Zod schema before writing.

**Enforcement:** `LedgerStore.writeRootIndex()` and `LedgerStore.writeWorkPackage()` call `Schema.parse()` before writing.

**Rationale:** Prevents writing invalid data to disk.

---

## Counter Self-Healing

### 35. Project Status Tool Auto-Corrects Counters and Project Status

**Rule:** `ledger_get_project_status` recomputes `total_work_packages`, `pending_work_packages`, and the project `status` from the `work_packages` array on every invocation.

**Behavior:**
- If counters are incorrect, they are silently corrected.
- If `status === 'READY'` and any WP is `IN_PROGRESS`, status is healed to `IN_PROGRESS`.
- If `status === 'BLOCKED'` and no WP is actually `BLOCKED`, status is healed to `IN_PROGRESS` (pending WPs exist) or `READY` (no pending WPs).
- If `status === 'IN_PROGRESS'` and all WPs are complete (pending = 0, WPs exist), status is healed to `COMPLETE`.
- If `status === 'COMPLETE'` and pending WPs exist, status is healed back to `IN_PROGRESS`.
- An empty project (no WPs) is never auto-healed to `COMPLETE`.
- Healing rules are mutually exclusive and applied in order; only the first matching rule fires.
- The root index is rewritten only when a correction is made.

**Rationale:** Provides fault tolerance against bugs that might cause counter or status drift.

---

## Development & Build Constraints

### 36. Changelog Is the Source of Truth for Versioning

**Rule:** All version changes must be made in `changelog.md` first, then synced to `package.json`.

**Rationale:** Maintains a single source of truth and ensures version history is documented.

**Process:**
1. Update `changelog.md` with new version header:
   ```markdown
   ## v1.0.2 - 2026-02-20
   
   ### Added
   - New feature...
   ```
2. Run `npm run sync-version` to extract version and update `package.json`
3. The MCP server will display the version at startup in STDERR

**Anti-pattern:**
```bash
# ❌ WRONG — manually editing package.json version
vim package.json  # Don't do this!
```

**Correct pattern:**
```bash
# ✅ CORRECT — update changelog first, then sync
vim changelog.md  # Add new version
npm run sync-version
```

---

### 37. Version Sync Runs Automatically Before Dev

**Rule:** The `predev` hook ensures version is synced before running the development server.

**Implication:** You can skip manual `npm run sync-version` if running `npm run dev` — it happens automatically.

**Manual sync needed when:**
- Building for distribution
- Running in production
- CI/CD pipelines
- Testing version display without starting server

---

### 38. Server Version Displays at Startup

**Rule:** The MCP server logs its version to STDERR on startup.

**Example output:**
```
[project-ledger-mcp] Server v1.0.1 started successfully
[project-ledger-mcp] Transport: STDIO
[project-ledger-mcp] Registered tools: ledger_get_project_status, ...
```

**Purpose:** Allows users and CI systems to verify which version is running in their project.

---

### 39. Reopening a COMPLETE Work Package Requires Project Manager or Documentation Agent

**Rule:** When transitioning a work package from `COMPLETE` back to `IN_PROGRESS`, the calling `agent` MUST be `"Project Manager"` (or `"Project Manager Agent"`) or `"Documentation"` (or `"Documentation Agent"`). All other agents are rejected.

**Enforcement:** Hard guard in `updateWorkPackageStatus()` in `src/tools/work-package.ts`, applied before the status mutation.

**Error message format:**
```
Cannot reopen work package WP-XXX: only the Project Manager or Documentation agent may transition COMPLETE → IN_PROGRESS.
Hand off to the Project Manager or Documentation agent to formally reopen this work package.
```

**Rationale:** Prevents developer or QA agents from silently reopening completed work, bypassing the formal re-planning and documentation steps.

**Additional effect:** On `COMPLETE → IN_PROGRESS`, rework state is fully reset: `rework_counts` is set to `{}`, `rework_count` is set to `0`, `root.synthesis_generated` is cleared, and `root.synthesis_generated_at` is set to `null`. This ensures that a reopened WP starts with a clean rework slate and prevents the Synthesis agent from being gated by stale synthesis state.

---

### 40. `READY → IN_PROGRESS` Must Use `ledger_claim_work_package`

**Rule:** `ledger_update_work_package_status` rejects `status: 'IN_PROGRESS'` when the WP is currently `READY`. The caller must use `ledger_claim_work_package` instead.

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` that throws an actionable error naming `ledger_claim_work_package` as the correct tool.

**Rationale:** `ledger_claim_work_package` enforces dependency checks and agent identity checks that `ledger_update_work_package_status` does not replicate.

---

### 41. `IN_PROGRESS → READY` (Unclaim) Requires No Active Pipelines

**Rule:** When transitioning a WP from `IN_PROGRESS` back to `READY`, all pipelines must be in a terminal state (non-`IN_PROGRESS`). If any pipeline is currently `IN_PROGRESS`, the transition is rejected with an actionable error.

**Side effect:** On success, `assigned_to` is cleared in both the WP detail file and the root index summary.

**Enforcement:** Guard in `updateWorkPackageStatus()` step 4 in `src/tools/work-package.ts`.

---

### 42. `BLOCKED → BLOCKED` Replaces the Blocker with Guards

**Rule:** A `BLOCKED` work package can be re-blocked with a different `blocked_by` object. This early-return path:
1. **Agent guard:** Only the `"Project Manager"` (or `"Project Manager Agent"`) or the current `wp.assigned_to` may replace a blocker.
2. **Type guard:** Changing a `'dependency'`-type blocker to a non-dependency type (or vice versa) is rejected. Dependency blockers are managed automatically by the system; manual replacement of dependency blockers is disallowed.
3. **Side effect:** `status_changed_at` and `root.last_updated` are set; `pending_work_packages` is unchanged (status remains `BLOCKED`).

**Enforcement:** Early-return guard in `updateWorkPackageStatus()` step 1a.

---

### 43. `IN_PROGRESS → BLOCKED` and `IN_PROGRESS → CANCELLED` Auto-Cancel Active Pipelines

**Rule:** When a WP transitions from `IN_PROGRESS` to `BLOCKED` or `CANCELLED`, all currently `IN_PROGRESS` pipelines are automatically cancelled. Each cancelled pipeline receives `auto_cancelled: true` to distinguish it from deliberate FAIL pipelines.

**Effect on rework detection:** Auto-cancelled pipelines are excluded from both direct and downstream rework detection in `ledger_start_pipeline` (see constraint 21).

**Enforcement:** Pipeline auto-cancellation via `autoCancelActivePipelines(wp, reason)` helper called at steps 8a/8b in `updateWorkPackageStatus()` in `src/tools/work-package.ts`.

---

### 44. `→ COMPLETE` Freshness Check

**Rule:** When transitioning a WP to `COMPLETE`, a freshness check is applied: the most recent non-auto-cancelled `documentation` pipeline PASS must have been recorded **after** the most recent `implementation` pipeline start. If the doc PASS predates the impl start (stale doc), the transition is rejected.

**Exception:** If no `implementation` pipeline exists, or if no `documentation` pipeline has a PASS, the check is skipped (absent timestamps are accepted).

**Absent timestamp permissive default:** If the most recent `documentation` pipeline lacks a `completed_at` timestamp, or if the most recent `implementation` pipeline lacks a `started_at` timestamp, the freshness check is skipped and the `→ COMPLETE` transition is allowed.

**Enforcement:** Freshness check in `canCompleteWorkPackage()` or in `updateWorkPackageStatus()` step 2b.

**Rationale:** Prevents a WP from being completed with documentation that was written before the current implementation cycle, ensuring the docs always reflect the current implementation.

---

### 45. `status_changed_at` Is Set on Every Status Transition

**Rule:** The `status_changed_at` field on a work package is updated on every successful status transition, including `BLOCKED → BLOCKED` blocker replacements (even though the status value itself doesn't change).

**Field type:** UTC ISO 8601 timestamp string (same format as `now()`).

**Enforcement:** Set in `updateWorkPackageStatus()` after every mutation path (early-return paths and main path).

---

### 46. Work Package `assigned_to` Always Starts as `null`

**Rule:** When creating a work package via `ledger_create_work_package`, the `assigned_to` input field is accepted silently but **ignored**. Both the WP detail file and the root index summary are written with `assigned_to: null`.

**Rationale (§9b.1):** Assignment is managed by `ledger_claim_work_package` (transitions to `IN_PROGRESS`) and cleared by `IN_PROGRESS → READY` (unclaim). Pre-populating at creation time bypasses these guards.

**Enforcement:** `createWorkPackage()` in `src/tools/work-package.ts` overwrites the input value.

---

### 47. New BLOCKED Work Packages Receive An Auto-Assigned `blocked_by`

**Rule:** When a work package's initial status is `BLOCKED` (because at least one dependency is not terminal), `blocked_by` is automatically populated:
```typescript
{ type: 'dependency', description: 'Dependency WP-XXX is not complete', blocking_work_package: 'WP-XXX' }
```
where `WP-XXX` is the first unmet dependency.

**Enforcement:** Inside `createWorkPackage()` initial status determination.

---

### 48. Creating a Work Package Must Not Introduce a Dependency Cycle

**Rule:** Before persisting, `createWorkPackage` calls `hasCycle(newWpId, deps, allExistingWps)` (BFS) to verify the new dependency edges don't form a circular dependency. If a cycle is detected, the creation is rejected.

**Error message format:**
```
Dependency cycle detected: WP X would create a circular dependency.
```

**Scope:** `hasCycle` checks forward-reference cycles among existing WPs. Simultaneous batch creation bypasses cycle detection — WPs should be created sequentially.

**Enforcement:** `hasCycle()` pure function at module scope in `src/tools/work-package.ts`, called in `createWorkPackage` step 3b.

---

### 49. Acceptance Criteria Cannot Be Empty or Whitespace-Only

**Rule:** Each string in the `acceptance_criteria` array must be non-empty and non-whitespace after trimming. An empty string or a string containing only spaces/tabs/newlines is rejected.

**Error message format:**
```
Acceptance criteria cannot be empty or whitespace-only.
```

**Enforcement:** Validation loop in `createWorkPackage()` before WP creation, supplementing the Zod-level `.min(1)` array constraint.

---

### 50. Only CLAIMABLE_ROLES Can Claim Work Packages

**Rule:** The `agent` field passed to `ledger_claim_work_package` must be a claimable role. 

**Non-claimable roles:** `Planner`, `Planner Agent`, `Synthesis`, `Synthesis Agent` — these orchestrating roles are excluded from claiming WPs.

**Claimable roles:** `Developer`, `Developer Agent`, `QA`, `QA Agent`, `Reviewer`, `Reviewer Agent`, `Documentation`, `Documentation Agent`, `Project Manager`, `Project Manager Agent`.

**Guard ordering:** The CLAIMABLE_ROLES guard fires at step 1b — unconditionally, immediately after the `READY` status guard and **before** the assignment guard (step 2) and override-auth guard (step 2b). Consequence: a non-claimable role always receives the role error regardless of the WP's `assigned_to` field or whether `override: true` is passed.

**Enforcement:** `CLAIMABLE_ROLES` is a named export at module scope in `src/tools/work-package.ts`, checked in `claimWorkPackage` step 1b. It is derived programmatically from `AGENT_ROLES` by filtering out `ORCHESTRATING_ROLES` (defined in `src/utils/constants.ts`), so adding a new orchestrating role automatically removes it from the claimable set without requiring manual updates.

---

### 52. `agent_role` Is Required for `ledger_start_pipeline` and `ledger_complete_pipeline`

**Rule:** Both `ledger_start_pipeline` and `ledger_complete_pipeline` require an `agent_role` parameter. The value must match the pipeline type's owner role (per `PIPELINE_AGENT_MAP`). Calls that omit `agent_role` or provide a mismatched role are rejected with a descriptive error.

**Exception:** `agent_role: 'Project Manager'` (or `'Project Manager Agent'`) bypasses the type-to-agent match check for any pipeline type (PM Override). When PM override is active, `startPipeline` adds a `[PM Override]` marker to the pipeline summary and `completePipeline` sets the handoff note's `from_agent` to `'Project Manager (PM Override)'`.

**Enforcement:** Agent role guard in `startPipeline()` and `completePipeline()` in `src/tools/pipeline.ts` (steps 1b and 2b respectively), applied after the WP status guard.

**Rationale:** Prevents agents from starting or completing pipelines outside their designated stage, ensuring the pipeline type-to-agent assignment invariant is upheld at runtime.

---

### 51. `propagateDependencyReblock` Auto-Cancels IN_PROGRESS Pipelines

**Rule:** When `propagateDependencyReblock` transitions a non-COMPLETE, non-CANCELLED, non-BLOCKED dependent WP back to `BLOCKED`, all currently `IN_PROGRESS` pipelines on that WP are automatically cancelled with `auto_cancelled: true` (consistent with the `IN_PROGRESS → BLOCKED` behavior enforced by `updateWorkPackageStatus`).

**Additional behaviors:**
- **COMPLETE dependents:** For each `COMPLETE` WP that lists the reopened WP as a dependency, a warning comment is appended to its last pipeline (type: `"warning"`, priority: `"high"`).
- **`synthesis_generated` reset:** If any WP was re-blocked (i.e., `candidates.length > 0`), `root.synthesis_generated` is reset to `false` and `root.synthesis_generated_at` is set to `null` to ensure the Synthesis agent must re-run.
- If no candidates were re-blocked, `synthesis_generated` and `synthesis_generated_at` are **not** changed.

**Enforcement:** `propagateDependencyReblock()` in `src/tools/work-package.ts`.

---

## Manifest Documentation Constraints

### 53. No Implementation Provenance in Manifest Documents

**Rule:** Project manifest documents (`api-surface.md`, `constraints.md`, `data-flows.md`, etc.) describe the **current state** of the codebase. They must not contain work package IDs, plan references, or other implementation-history markers (e.g., `WP-003`, `added in WP-005`, `wired in WP-004`).

**Where provenance belongs:** Plan documents, synthesis reports, and changelog entries — not the manifest.

**Rationale:** WP IDs are scoped to individual plans. A reader who has not ingested the plan history cannot resolve `WP-006` to a meaningful context. Provenance markers also accumulate over time and add noise without aiding comprehension of current behavior.

**What is allowed:** References to `WP-###` as a *data format specifier* (e.g., `work_package_id: string // WP-### format`) are fine — these describe the runtime data model, not implementation history.

---

## GUI API Constraints

### 40. All Slug- and WpId-Accepting GUI Handlers Must Call Their Path-Traversal Guard First

**Rule:** Every GUI API handler in `gui/api.ts` that accepts a path segment parameter must call its corresponding guard as the **first** (slug) or **second** (wpId) statement, before any other processing.

**Guards:**

| Guard | Parameter | Placement | Affected handlers |
|-------|-----------|-----------|-------------------|
| `assertSafeSlug(slug)` | project slug | 1st statement | `handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument` |
| `assertSafeWpId(wpId)` | work-package ID | 2nd statement (after `assertSafeSlug`) | `handleGetWorkPackage` |

**Rejection criteria (both guards):** throws `ApiError` with code `NOT_FOUND` (HTTP 404) if the value:
- is empty (`''`)
- contains a forward slash (`/`)
- contains a double dot (`..`)

**Rationale:** Returning `NOT_FOUND` (rather than `FORBIDDEN`) on traversal attempts is intentional — it avoids leaking structural information about the server's file system to potential attackers. Using HTTP 404 is consistent with the standard "project not found" response.

**Implementation:** Both guards are module-private to `gui/api.ts` (not exported). They must not be bypassed or called after other parameter-dependent operations.

**Acceptance criteria wording:** When writing AC for test cases that exercise `assertSafeSlug` rejection, use:
> *"Invalid slug (e.g. path-traversal attempt) returns 404 NOT_FOUND."*

Do **not** write `"400 VALIDATION_ERROR"` — the guard deliberately returns `NOT_FOUND` (not `VALIDATION_ERROR`) to mask traversal detection. (See [error-ledger.md](../../../../../history/error-ledger.md) — deviation recorded in 2026-03-04-project-reset-rework-1 synthesis.)

---

### 55. Non-PM Handoff Functions Must Dispatch to the Next READY Work Package Before Returning WAIT

**Rule:** Each of the five non-PM handoff functions — `getQaHandoff`, `getSecurityAuditorHandoff`, `getReviewerHandoff`, `getReleaseEngineerHandoff`, and `getDocumentationHandoff` — MUST call `findNextReadyDispatch(wpDetails, '<RoleName>')` as the penultimate step, immediately before the final `return WAIT` fallthrough. If `findNextReadyDispatch` returns a non-null result, the function MUST return that dispatch rather than falling through to WAIT.

**Rationale:** Without this step, completing the last pipeline stage on WP-N leaves the IDE in a stalled state when WP-N+1 is READY but has no pipelines yet. The five affected functions previously returned a bare `WAIT` in this scenario, requiring manual PM intervention to unblock the IDE workflow. The PM handoff already implements this cross-WP dispatch pattern (§13.1 Step 2); this rule extends the same behaviour to all non-PM handoff functions.

**`findNextReadyDispatch` algorithm:**
1. Finds the first READY work package whose dependencies are satisfied (using `isBlockedByDependencies`).
2. Routes to the agent owning its first active pipeline stage (`PIPELINE_AGENT_MAP[firstActiveStage(wp.active_pipeline_stages ?? null)]`).
3. If all WPs are terminal, returns `READY_FOR_SYNTHESIS` (safety-net branch for handoff functions that position cross-WP dispatch before their own all-terminal check).
4. Returns `null` when no deterministic dispatch is possible — the caller falls through to WAIT.

**Self-routing is intentional:** `findNextReadyDispatch` does NOT filter out cases where the target role equals the calling role (`targetRole === currentRole`). Self-routing causes the IDE to visibly declare a new handoff step for the new work package, improving auditability and keeping orchestrator and IDE behaviors aligned.

**Scope:** This is a best-effort optimization for IDE runners. The orchestrator does not depend on it — its supervisor polling loop re-dispatches independently.

**Correct pattern:**
```typescript
// ✅ CORRECT — penultimate step, just before final WAIT return
const dispatch = findNextReadyDispatch(wpDetails, 'Documentation');
if (dispatch) {
  return buildHandoffResponse(
    'Documentation', dispatch.status, dispatch.reason,
    undefined, projectPath, store
  );
}
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

**Anti-pattern:**
```typescript
// ❌ WRONG — returns WAIT without checking for READY WPs
return buildHandoffResponse('Documentation', 'WAIT', 'No actionable documentation work.');
```

---

## Cross-Platform Constraints

### 54. All Code Must Run on Windows, macOS, and Linux

**Rule:** The MCP server must work on all three supported platforms (Windows, macOS, Linux). Do not introduce OS-specific APIs without a cross-platform fallback. Use `path.join()` / `path.resolve()` for all file paths — never hardcode `/` or `\` separators.

**File locking:** Uses `proper-lockfile` (cross-platform npm package). Do not replace with a platform-specific alternative.

**Rationale:** The workspace-wide cross-platform policy (see root `AGENTS.md` → Cross-Platform Policy) applies to all sub-projects. The MCP server runs alongside the user's IDE on their desktop OS.

---

## Gotchas

### ⚠️ Gotcha 1: Revision Only Increments on COMPLETE → IN_PROGRESS

The `revision` field only increments when a work package transitions from `COMPLETE` back to `IN_PROGRESS`. It does not increment on other status changes.

---

### ⚠️ Gotcha 2: Lock File Persists After Server Exit

The `.lock` file inside `storage/ledger/{slug}/` is not automatically deleted when the server exits. It will be left on disk and overwritten on the next lock acquisition.

**Implication:** Safe to ignore — the lock system handles stale locks automatically.

---

### ⚠️ Gotcha 3: Metrics Object Is Extensible

The `metrics` object in pipelines uses `.passthrough()` in Zod, meaning it accepts additional fields beyond the predefined ones (`test_coverage`, `tests_passed`, etc.).

**Use case:** Custom metrics for different pipeline types (e.g., `build_time`, `bundle_size`).

---

### ⚠️ Gotcha 4: Work Package Summaries Are Duplicates

Work package summaries in the root index duplicate a subset of data from the work package detail files.

**Reason:** Performance — agents can list work packages without loading all detail files.

**Invariant:** Summaries must always match the corresponding detail files. This is enforced by `createWorkPackageWithSync()` (creation) and `updateWorkPackageWithSync()` (updates).

---

### ⚠️ Gotcha 6: REWORK Is Triggered Only by the Most Recent FAIL

The REWORK recommendation in `ledger_get_next_action` is based **only on the most recent pipeline** of a given type, not any historical FAIL. A work package with pipeline history `[FAIL, PASS]` does NOT receive a REWORK recommendation — the PASS pipeline means the issue was resolved.

**Why it matters:** Before this was corrected, a WP that failed and then passed (e.g., tests failed, bugs were fixed, tests re-run and passed) would permanently trigger a REWORK recommendation, even though the work was complete. Now only a WP whose most recent pipeline is still `FAIL` will trigger REWORK.

**Implementation:** `isMostRecentPipelineFail(pipelines, pipelineType)` — see [Internal Testing Utilities](api-surface.md#internal-testing-utilities).

---

### ⚠️ Gotcha 7: Documentation Handoff Skips Dependency-Blocked WPs

`getDocumentationHandoff` (and `getQaHandoff`, `getReviewerHandoff`) treat WPs blocked by incomplete dependencies as ineligible for their stage. If all unreviewed/undocumented WPs are dependency-blocked, the handoff returns `READY_FOR_SYNTHESIS` rather than routing the agent back to the Developer.

**Why it matters:** Without this check, a project where the only remaining WPs are blocked by incomplete dependencies would incorrectly route the Documentation Agent back to the Developer stage, stalling the workflow.

---

### ⚠️ Gotcha 8: Dependency Auto-Unblocking Uses a Separate Lock

When a work package transitions to `COMPLETE`, `propagateDependencyUnblock` automatically transitions eligible downstream dependents from `BLOCKED` to `READY`. This runs **after** the main lock in `updateWorkPackageStatus` is released — it acquires its own lock.

**Eligibility rule:** A BLOCKED WP is auto-unblocked only when **all its dependencies are terminal (COMPLETE or CANCELLED) AND its `blocked_by.type` is `"dependency"` or absent**. WPs blocked by `"external"`, `"decision"`, or `"technical"` reasons are intentionally skipped — their blockers must be resolved manually, even if all WP dependencies complete.

**Implication:** There is a brief window between the COMPLETE write and the unblocking write during which the root index shows the WP as COMPLETE but dependents are still BLOCKED. This is safe for single-user workflows, but would be a race condition risk in a concurrent multi-agent environment.

---

### ⚠️ Gotcha 9: WP ID Generation Is Max-Based, Not Length-Based

Work package IDs are generated by scanning the highest existing numeric suffix and adding 1. This means:
- Deleting a WP does not cause ID collisions (unlike a length+1 approach)
- IDs are monotonically increasing but may have gaps (e.g., WP-001, WP-003 if WP-002 was removed)
- IDs can be 3+ digits: the schema regex `/^WP-\d{3,}$/` supports WP-001 through WP-9999+

---

### ⚠️ Gotcha 5: READY Status After Creation Depends on Dependencies

When creating a work package:
- If dependencies are empty or all `COMPLETE` → Initial status is `READY`
- If any dependency is not `COMPLETE` → Initial status is `BLOCKED`

This logic is automatic and transparent to the caller.

---

### ⚠️ Gotcha 10: `acceptance_criteria` Must Have At Least One Entry

The `ledger_create_work_package` tool rejects requests with an empty `acceptance_criteria` array. Zod validation enforces `.min(1)` — at least one criterion string is required. This prevents the degenerate case of a WP that auto-passes all criterion checks.

---

### ⚠️ Gotcha 11: Unknown Criteria Text in `acceptance_criteria_updates` Is Appended

When `ledger_complete_pipeline` is called with `acceptance_criteria_updates`, each update item is matched by exact criterion text:
- **Matched:** updates the `met` flag on the existing entry.
- **Not matched (unknown text):** appends a new `AcceptanceCriterion` entry `{ criterion, met }` to the WP's `acceptance_criteria` array.

---

### ⚠️ Gotcha 12: Pre-mutation State Capture in `updateWorkPackageWithSync` Callbacks

**Rule:** Any variable holding pre-mutation WP or root-index state that is needed **after** the `updateWorkPackageWithSync` callback must be declared with `let` in the **outer scope** and assigned inside the callback. Variables declared with `const` inside the callback are lexically scoped to that callback and are invisible at the call site.

**Anti-pattern:**
```typescript
// ❌ WRONG — const inside callback is NOT visible at the call site
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  const previousStatus = wp.status; // const → invisible outside callback
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
// TS2304: Cannot find name 'previousStatus'  ← compile error
console.log(previousStatus); // ReferenceError at runtime if somehow not caught by TS
```

**Correct pattern:**
```typescript
// ✅ CORRECT — let declared in outer scope, assigned inside callback
let previousStatus = '';
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  previousStatus = wp.status; // assigns to outer-scope let
  wp.status = 'IN_PROGRESS';
  return { wp, root };
});
console.log(previousStatus); // ✅ 'READY' — visible after lock completes
```

**Rationale:** `updateWorkPackageWithSync` (and `withLock`) discard the callback's return value for the state-capture use case. Any data produced inside the callback that is needed after it completes must be captured via closure by assigning to an outer-scope `let` variable before the callback runs. This pattern appears throughout `work-package.ts` (e.g., `let createdWpId = ''` in `createWorkPackage`). Failure to follow it produces a TS2304 compile error or, if TypeScript somehow does not catch it, a `ReferenceError` at the call site.

**Alternative correct pattern (`| undefined` union):** When the captured value has no meaningful zero value, use `| undefined` union rather than a non-null assertion (`!`):

```typescript
// ✅ ALSO CORRECT — | undefined union (used in project-lifecycle.ts completeSynthesis)
let result: { status: string } | undefined;
await withLock(store.storageDir, async () => {
  // ... read-modify-write ...
  result = { status: 'COMPLETE' };
});
if (!result) throw new Error('Expected result to be set inside lock');
// result is narrowed to { status: string } here
```

Prefer `| undefined` over non-null assertion (`!`) when the accumulator cannot have a meaningful zero state.

---

## Code Style Conventions

### 53. Test-Only Exports Must Use the `_internal` Naming Convention

**Rule:** Any module that exposes private symbols for unit testing must export them under a single named export called `_internal`. Do **not** introduce alternative names such as `_schemas`, `_test`, or `_utils`.

**Pattern:**
```typescript
/**
 * @internal — exported for unit testing only.
 */
export const _internal = {
  MyPrivateClass,
  MyInternalSchema,
  myHelperFunction,
};
```

**Rationale:** Consistency and grep-ability. A single naming convention makes it trivial to audit test-only surface (`grep -r '_internal'`) and eliminates `_schemas` / `_test` divergence. The convention was introduced in `work-package.ts` and standardised across all modules in 2026-02-28 (WP-009).

**Enforcement:** `_schemas` exports were renamed to `_internal` in `pipeline.ts` and `observations.ts`. Do not re-introduce `_schemas` or any alternate name.

---

### 54. Prefer `for-of` Loops Over Indexed `for` Loops

**Rule:** Use `for-of` loops for array iteration. Avoid `for (let i = 0; i < arr.length; i++)` indexed loops unless the index itself is required for logic, or a performance constraint is documented.

**When an indexed loop is unavoidable** (e.g. pairwise comparison where both `i-1` and `i` are needed), use non-null-asserted access (`arr[i]!`) with an inline comment explaining the in-bounds guarantee:

```typescript
// TypeScript is compiled with noUncheckedIndexedAccess so array[i] returns T | undefined.
// The loop invariant (i < arr.length) guarantees arr[i] is defined — safe to assert.
for (let i = 1; i < pipelines.length; i++) {
  const prev = pipelines[i - 1]!; // in-bounds: i >= 1
  const curr = pipelines[i]!;     // in-bounds: i < pipelines.length
}
```

**Context:** The project enables `noUncheckedIndexedAccess` in `tsconfig.json`. This means array element access returns `T | undefined`, which requires either a null-check or a `!` assertion. The `for-of` pattern avoids indexed access entirely and is therefore preferred.

---

### 55. Test Helper Infrastructure Mandate

**Rule:** All new test files **must** import shared fixture factories and test utilities from `tests/helpers/fixtures.ts` and `tests/helpers/test-utils.ts`.

**(a)** Any new test file that needs a project root index, WP detail object, or ledger directory must use the canonical factories from `tests/helpers/fixtures.ts` (e.g. `makeProject`, `makeWpDetail`, `injectLedgerDir`, `nowFloor`).

**(b)** Defining a local test-scope fixture factory function is **prohibited** when a canonical equivalent already exists in `tests/helpers/fixtures.ts`. If the helper does not yet exist and is needed by multiple tests, add it to `tests/helpers/` first rather than duplicating it inline.

**(c)** **Rationale:** Prevents per-file fixture divergence, eliminates test-replica maintenance burden, and ensures fixture behaviour (field defaults, schema shape, timestamps) stays consistent across the entire test suite.

**Anti-pattern:**
```typescript
// ❌ WRONG — local factory duplicates the canonical makeWpDetail from tests/helpers/fixtures.ts
function makeTestWp(overrides: Partial<WorkPackageDetail> = {}): WorkPackageDetail {
  return {
    work_package_id: 'WP-001',
    status: 'READY',
    revision: 0,
    pipelines: [],
    assigned_to: null,
    dependencies: [],
    acceptance_criteria: [],
    ...overrides,
  };
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT — import the canonical factory; field defaults and schema shape are guaranteed
import { makeWpDetail } from '../helpers/fixtures.js';

const wp = makeWpDetail({ work_package_id: 'WP-001', status: 'READY' });
```

---

### 56. JSDoc Convention for Captured-Closure Variables

**Rule:** When using the captured-closure pattern (an outer-scope `let` written inside a `withLock` / `updateWorkPackageWithSync` callback and read after the call returns), add a brief `// captured via closure in lock callback` inline comment on the `let` declaration.

**Example:**
```typescript
let autoFinalizeResult: 'finalized' | 'blocked' | null = null; // captured via closure in lock callback
await store.updateWorkPackageWithSync(wpId, (wp, root) => {
  // ... logic that may set autoFinalizeResult ...
  autoFinalizeResult = 'finalized';
  return { wp, root };
});
if (autoFinalizeResult === 'finalized') { /* ... */ }
```

**Rationale:** The pattern is non-obvious to contributors unfamiliar with the lock-callback design. Without the comment, reviewers may assume the variable is always `null` after the call (it isn't — the callback executed synchronously within the lock and the `let` is live). See Gotcha 12 for a full explanation of the captured-closure mechanics.

---

### 57. `project_path` Takes Precedence Over `cwd_path` When Both Are Provided

**Rule:** When a caller supplies both `project_path` and `cwd_path`, `resolveProjectPath()` uses `project_path` and silently ignores `cwd_path`. Supplying both parameters is **not** an error. Do **not** add `.refine()`, `.transform()`, or `.superRefine()` to the outer `z.object()` of any tool schema to enforce exclusivity.

**Precedence rule (in `resolveProjectPath()`, `src/utils/path-validator.ts`):**
1. If `project_path` is provided (truthy) → use it directly; `cwd_path` is ignored.
2. If only `cwd_path` is provided → auto-detect the active project from the workspace root.
3. If neither is provided → throw a missing-path error.

**Guidance for callers:**
- If you already have `project_path` (the plan folder path from a prior tool response), pass it — it is the fastest path with no auto-detection overhead.
- If you only know your workspace root, pass `cwd_path` and let the server detect the project.
- If you pass both, `project_path` wins; `cwd_path` is a no-op in that call.

**Enforcement:**
- `resolveProjectPath()` (`src/utils/path-validator.ts`) applies the precedence rule at the top of its body. Every tool handler that accepts both optional path fields calls `resolveProjectPath()`.
- The predicate `mutuallyExclusivePaths` and the constant `MUTUAL_EXCLUSIVITY_PATH_MSG` remain exported from `src/utils/path-validator.ts` for backward compatibility and test coverage. They are **not used in production tool files**.
- Schemas that only contain `project_path` (mandatory) or only `cwd_path` — but not both as optional fields — are exempt from this consideration. `DetectProjectSchema`, `InitializeProjectSchema`, and `ListProjectsSchema` fall into this category.

**Anti-pattern:**
```typescript
// ❌ WRONG — .refine() converts ZodObject → ZodEffects. The MCP SDK cannot extract properties
// from ZodEffects, resulting in empty { properties: {}, required: [] } in tools/list responses.
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('…'),
  cwd_path:     z.string().optional().describe('…'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
})
  .refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });
```

**Correct pattern:**
```typescript
// ✅ CORRECT — plain ZodObject; project_path-wins precedence is enforced inside resolveProjectPath()
const GetWorkPackageSchema = z.object({
  project_path: z.string().optional().describe('…'),
  cwd_path:     z.string().optional().describe('…'),
  work_package_id: z.string().regex(/^WP-\d{3,}$/),
});
```

**Rationale:** `.refine()` (and `.transform()`, `.superRefine()`) on the outer `z.object()` converts it from `ZodObject` to `ZodEffects`. The MCP SDK's `zodToJsonSchema` cannot extract properties from `ZodEffects` — every affected tool emits empty `{ properties: {}, required: [] }` in the `tools/list` response, preventing AI agents from passing arguments. Centralising the precedence logic in `resolveProjectPath()` keeps all tool schemas as plain `ZodObject` instances and eliminates spurious errors when callers pass both parameters. (Background: 2026-03-05 Zod `.refine()` empty schema fix — 18 of 22 tools were affected.)

**See also:** §63 for the general rule covering all outer-schema uses of `.refine()`, `.transform()`, and `.superRefine()`.

---

### 58. MCP SDK Injects `RequestHandlerExtra` — Handler Registration Must Use Wrapper Functions

**Rule:** Every internal tool handler that has a second positional parameter (`_ledgerRoot?: string`) **must** be registered via an arrow-function wrapper, **not** passed directly as the handler. Additionally, each such handler **must** apply a defensive type guard before using `_ledgerRoot`.

**Root cause:** The MCP SDK (v1.0.4+) calls every registered tool handler as:
```typescript
typedHandler(args, extra)   // extra is RequestHandlerExtra
```
If the handler has a second positional parameter (`_ledgerRoot?: string`), the `extra` object is captured by it. Because `extra` is truthy, `_ledgerRoot ?? projectPath` resolves to the `extra` object, causing downstream `path.join()` calls to throw:
```
TypeError: The "path" argument must be of type string. Received an instance of Object
```

**Two-layer defence (belt-and-suspenders):**

*Layer 1 — Registration wrapper (primary):*
```typescript
// ✅ CORRECT — extra never reaches the internal handler
server.registerTool('ledger_create_work_package', { ... }, (args) => createWorkPackage(args));

// ❌ WRONG — extra leaks into _ledgerRoot
server.registerTool('ledger_create_work_package', { ... }, createWorkPackage as any);
```

*Layer 2 — Defensive type guard inside the handler (secondary):*
```typescript
async function createWorkPackage(args: ..., _ledgerRoot?: string) {
  // ✅ Guard against the MCP SDK injecting a RequestHandlerExtra object
  const ledgerRoot = typeof _ledgerRoot === 'string' ? _ledgerRoot : undefined;
  // Use ledgerRoot throughout — never use _ledgerRoot directly after this line
}
```

**Affected handlers (both layers applied as of 2026-03-01):**
- `createWorkPackage` — `src/tools/work-package.ts`
- `claimWorkPackage` — `src/tools/work-package.ts`
- `updateWorkPackageStatus` — `src/tools/work-package.ts`
- `resetReworkCount` — `src/tools/work-package.ts`
- `updateAcceptanceCriteria` — `src/tools/work-package.ts`
- `completeSynthesis` — `src/tools/project-lifecycle.ts`

**Why single-argument handlers are unaffected:** Handlers with only one parameter (`initializeProject`, `getProjectStatus`, etc.) silently ignore any surplus arguments passed by the SDK — `extra` is discarded before it can cause harm.

**Rationale:** A bug introduced when the SDK began passing `extra` went undetected because all unit tests call internal functions directly with an explicit string `_ledgerRoot`. The registration layer, where the SDK's extra injection occurs, had no test coverage. The two-layer defence ensures correctness both at the registration boundary and inside the function itself.

---

### 59. Acceptance Criteria Field-Name Verification

**Rule:** Acceptance criteria text that references specific JSON field names, TypeScript parameter names, or object property names (e.g., `store`, `rootIndex`, `wpDetails`, `storageDir`) **must** be verified against the actual implementation source before the AC is committed to a work package. If the implementation uses a different name than what the AC states, the AC text must be updated to match.

**Rationale:** Stale field-name references in ACs cause false-negative review outcomes. When a reviewer checks `wpDetails` against acceptance criteria but the implementation uses `allWpDetails`, the criterion is technically not met — yet neither the agent nor the QA reviewer notices. This constraint formalises the verification step that was retroactively identified in synthesis #4 of the Ledger Tool Simplification rework-1 cycle.

**Anti-pattern:**
```
// AC text: "getNextActionsCollector receives `wpDetails` as a pre-loaded array"
// Implementation: loads wp details internally, no wpDetails parameter
// → AC text silently passes review because no one checks the parameter name
```

**Correct pattern:**
```
// AC text uses the exact parameter/field name from the source:
// "getNextActionsCollector receives `rootIndex: RootIndex` and `store: LedgerStore`"
// Verified against src/tools/workflow-next-action.ts before committing
```

---

### 60. No Unused Locals (`noUnusedLocals`)

**Rule:** `tsconfig.json` enables `"noUnusedLocals": true`. Every import, variable, parameter, and type alias that is declared must be consumed within its file. Dead imports and unused variables are compile errors — fix, never suppress.

**Rationale:** Unused imports are structural noise left behind by refactors (e.g., when symbols move to a new module). They mislead agents and developers into thinking a dependency exists when it does not, and they obscure intent. The `noUnusedLocals` flag makes these errors hard build failures so they cannot accumulate silently.

**Anti-pattern:**
```typescript
// ❌ WRONG — AGENT_PIPELINE_MAP moved to workflow-next-action-batch.ts but was
// left in the import list of workflow-next-action.ts after a file-split refactor.
import {
  PIPELINE_TYPES,
  AGENT_PIPELINE_MAP,   // ← never referenced in this file
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Correct pattern:**
```typescript
// ✅ CORRECT — only symbols actually used in this file are imported.
import {
  PIPELINE_TYPES,
  type PipelineType,
} from '../utils/pipeline-maps.js';
```

**Forbidden patterns:**
- Adding `// @ts-ignore` or `// eslint-disable` to suppress unused-local errors.
- Importing a symbol "for re-export" without an explicit re-export statement.
- Leaving a symbol in an import group after moving its last consumer to another file.

---

### 61. `assigned_to` Requires a Canonical AgentRole; `project_comments.agent` Does Not

**Rule:** The `assigned_to` field on a work package (`WorkPackageSchema.assigned_to`) must be a value from the `AGENT_ROLES` constant (a validated `AgentRole` union). The `agent` field on a project-level comment (`ProjectCommentSchema.agent`) is typed as `z.string()` and is intentionally **not** constrained to `AGENT_ROLES`.

**Rationale:** `assigned_to` drives workflow routing, gate checks, and pipeline agent-map lookups — it must be a machine-readable canonical role value. `project_comments.agent` is a human-readable audit identifier; it records who wrote the comment as a narrative label, not as a workflow actor, so free-form strings are appropriate.

**Anti-pattern:**
```typescript
// ❌ WRONG — using a non-canonical value in the role-validated field
await claimWorkPackage({ ..., agent: "Developer Agent" });
// Zod rejects "Developer Agent" — not a member of AGENT_ROLES
```

**Correct pattern:**
```typescript
// ✅ CORRECT — canonical AgentRole value required for assigned_to/agent in claim
await claimWorkPackage({ ..., agent: "Developer" });

// ✅ ALSO CORRECT — free-text is acceptable in project_comments.agent
await addProjectComment({ ..., agent: "Developer Agent" });
// z.string() accepts arbitrary strings here; this is intentional
```

**Forbidden patterns:**
- Using `"Developer Agent"` (or any multi-word variant) as the `agent` argument to `ledger_claim_work_package` or `ledger_start_pipeline`.
- Assuming `project_comments.agent` and `assigned_to` share the same validation rules — they do not.
- Hardcoding role strings anywhere other than constants. Use `AGENT_ROLES` entries or the `AgentRole` type for `assigned_to`-typed fields.

**Reference:** `AGENT_ROLES` is derived from `shared/workflow-manifest.json` (`roles[].name`) and re-exported from `src/utils/constants.ts`. `ProjectCommentSchema` is in `src/schema/validators.ts`. See [tech-stack.md — Architectural Pattern 10](tech-stack.md#10-manifest-derived-constants) for the full list of manifest-derived constants.

---

### 62. `ledger_begin_work` IN_PROGRESS Guard Accepts Pipeline-Type Owners

**Rule:** When `ledger_begin_work` is called on a work package that is already `IN_PROGRESS`, the call is allowed if **either** condition holds:

1. **Idempotent re-entry:** `wp.assigned_to === args.agent_role` (the same agent is continuing their own work).
2. **Cross-agent handoff:** `PIPELINE_AGENT_MAP[args.type] === args.agent_role` (the caller is the legitimate pipeline-type owner per the workflow spec).

If neither condition holds, the call is rejected.

**Rationale (§9.1, §16.5):** The `assigned_to` field is a trailing bookkeeping field — a side-effect updated by the pipeline-start phase, not a security gate. Pipeline authorisation is defined by `PIPELINE_AGENT_MAP`. Using `assigned_to` as a hard gate would block every cross-agent handoff where `ledger_begin_work` is used instead of the two-step `ledger_claim_work_package + ledger_start_pipeline` sequence. This constraint restores consistency with `ledger_start_pipeline`, which enforces `PIPELINE_AGENT_MAP` only.

**Contrast with `ledger_claim_work_package`:** Constraint 14 governs `ledger_claim_work_package`, which operates on `READY` WPs and does require an explicit `override: true` for cross-agent claims. The `READY → IN_PROGRESS` transition is a deliberate re-assignment; `ledger_begin_work` on an `IN_PROGRESS` WP is a pipeline-start handoff, not a RE-assignment.

**Enforcement:** `isPipelineOwner` compound check in `beginWork()` in `src/tools/begin-work.ts`.

**Error message (guard fires):**
```
Cannot begin work on WP-002: it is IN_PROGRESS and assigned to "Reviewer" but you are "Developer".
Only the assigned agent or the legitimate pipeline-type owner may start a pipeline on an IN_PROGRESS work package.
```

---

### 63. Do Not Use `.refine()`, `.transform()`, or `.superRefine()` on Outer Tool Schemas

**Rule:** Never chain `.refine()`, `.transform()`, or `.superRefine()` on the outer `z.object({...})` schema passed as `inputSchema` to `server.registerTool()`. These methods convert a `ZodObject` into a `ZodEffects` wrapper, which the MCP SDK's JSON Schema converter cannot introspect — it emits `{ properties: {}, required: [] }` instead of the actual field list.

**Reason:** The MCP `tools/list` response uses the JSON Schema to populate the tool definition shown to AI clients. An empty `properties` object means the client cannot see any parameters, so agents cannot pass arguments to the tool. This bug silently affects all callers, including VS Code Copilot agent mode.

**Correct pattern:** Move cross-field validation inside the handler function (or a helper it calls, such as `resolveProjectPath()`):

```typescript
// ✅ CORRECT — plain ZodObject; SDK emits correct properties
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
});

async function myToolHandler(args: z.infer<typeof MyToolSchema>) {
  // Mutual exclusivity enforced at runtime by resolveProjectPath()
  const projectPath = await resolveProjectPath(args);
  // ...
}
```

**Anti-pattern:**

```typescript
// ❌ WRONG — .refine() converts ZodObject → ZodEffects
// SDK emits { properties: {}, required: [] } — agent cannot pass arguments
const MyToolSchema = z.object({
  project_path: z.string().optional(),
  cwd_path: z.string().optional(),
}).refine(mutuallyExclusivePaths, { message: MUTUAL_EXCLUSIVITY_PATH_MSG });
```

**Exception:** Field-level `.refine()` applied to an individual field definition (e.g., `z.string().refine(...)`, `plan_file: z.string().refine(v => v === 'plan.md', ...)`) is safe — the outer `z.object()` remains a `ZodObject`.

**Regression guard:** `tests/tools/schema-integrity.test.ts` converts all 22 registered tool schemas to JSON Schema and asserts non-empty `properties`. This test fails if a `.refine()` / `.transform()` / `.superRefine()` is re-added to any outer schema.

**Background:** Fixed in plan `2026-03-05-zod-refine-empty-schema`. All 18 affected tools previously emitted empty JSON Schemas due to this pattern.

---

### 64. Mock `McpServer` Intercept Pattern for Tool Metadata Tests

**Rule:** When writing tests that need to inspect tool metadata (input schema shape, parameter constraints, tool descriptions) without spinning up a real MCP server, use the mock `McpServer` intercept pattern: create a plain object with a `registerTool` method that captures schemas into a `Map`, cast it `as unknown as McpServer`, and call each tool module's `register()` function with it in `beforeAll`.

**Rationale:** This pattern exercises the exact production registration path — same `register()` call, same `inputSchema` reference — without a network socket or real server lifecycle. It is safe with `beforeAll` because `register()` calls are synchronous.

**Correct pattern:**

```typescript
import { beforeAll, describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerPipeline } from '../../src/tools/pipeline.js';

const capturedSchemas = new Map<string, z.ZodTypeAny>();

const mockServer = {
  registerTool: (
    name: string,
    config: { description: string; inputSchema: z.ZodTypeAny },
    _handler: unknown
  ) => {
    capturedSchemas.set(name, config.inputSchema);
  },
} as unknown as McpServer;

beforeAll(() => {
  registerPipeline(mockServer);
});

describe('pipeline schemas', () => {
  it('ledger_start_pipeline has non-empty properties', () => {
    const schema = capturedSchemas.get('ledger_start_pipeline')!;
    const json = zodToJsonSchema(schema) as { properties?: object };
    expect(Object.keys(json.properties ?? {})).not.toHaveLength(0);
  });
});
```

**When to use:** Any test that needs to verify tool schema shape, description content, or parameter constraints without full server lifecycle overhead. See `tests/tools/schema-integrity.test.ts` for the canonical usage.

**Note on `zod-to-json-schema`:** This package is currently a transitive dependency (via `@modelcontextprotocol/sdk`) and is not declared as an explicit `devDependency` in `mcp-server/package.json`. Tests relying on it work today, but if the SDK drops the transitive dep in a future update, imports will fail without a clear error. Prefer adding it explicitly when introducing new test files that import it directly.

---

### 65. All Six Pipeline Stages Are PM-Composable — No Mandatory/Optional Distinction

**Rule:** All six pipeline stages (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) are equally composable by the Project Manager. There is no inherent "mandatory" or "optional" designation for any stage. The PM selects any valid subsequence of `CANONICAL_PIPELINE_ORDERING` per work package via the `active_pipeline_stages` field.

**Default:** When `active_pipeline_stages` is omitted, `DEFAULT_PIPELINE_STAGES` (`['implementation', 'qa', 'code-review', 'documentation']`) is used for backward compatibility.

**Rationale:** The former `MANDATORY_PIPELINE_TYPES` and `OPTIONAL_PIPELINE_TYPES` constants are retired. The PM-composable model enables custom workflows (e.g., skipping QA for documentation-only WPs, adding a security audit before code review) without encoding assumptions into the server.

**Extension:** The `CANONICAL_PIPELINE_ORDERING` constant (`['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation']`) defines the only valid execution order — stages may be omitted but not reordered. `resolvePrerequisite`, `resolveNextAgent`, and `resolveFailAgent` derive routing dynamically from the per-WP `active_pipeline_stages` array.

**Enforcement:** `ledger_create_work_package` validates the `active_pipeline_stages` input (see Constraint 66). Pipeline start and completion routing use the dynamic resolve functions, not static maps.

> Full specification: [Workflow Specification §4.2, §9b](../workflow-specification/data-model.md#42-pipeline-stage-constants).

---

### 66. `active_pipeline_stages` Validation: Hard Guardrails (Reject) and Soft Guardrails (Warn)

**Rule:** When `ledger_create_work_package` receives an `active_pipeline_stages` value, it validates the array before persisting the work package.

**Hard guardrails (reject with error — creation is aborted):**
- Empty array (`[]`)
- Entries that are not valid `PIPELINE_TYPES` values
- Duplicate entries
- Entries that are not a subsequence of `CANONICAL_PIPELINE_ORDERING` (relative ordering must be preserved; gaps are allowed)

**Soft guardrails (warning appended to the success response message — creation is NOT aborted):**
- `implementation` present without `qa` (unusual composition)
- Single-stage chain (degenerate case)

**Omitted field:** When `active_pipeline_stages` is omitted (the common case for standard 4-stage workflows), validation is bypassed entirely. The field is absent on the WP detail and dynamic resolve functions substitute `DEFAULT_PIPELINE_STAGES` at runtime.

**Enforcement:** `validateActiveStages()` helper called inside `createWorkPackage()` in `src/tools/work-package.ts`. Hard rejection throws before the WP is written; soft warning is appended to the response string after the WP is written.

> Full specification: [Workflow Specification §9b.2](../workflow-specification/operations.md#9b2-active-pipeline-stages-validation).

---

### 67. Artifact Declaration Expectation — Soft Warning on Empty `files_modified`

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` and the `artifacts.files_modified` array is either absent or empty, the server appends a soft-warning note **only if the pipeline type is in `ARTIFACT_EXPECTED_PIPELINE_TYPES`** (`implementation`, `code-review`, `release-engineering`, `documentation`). Verification-only pipeline types (`qa`, `security-audit`) are exempt because those agents verify but do not modify files. `code-review` is included because the Reviewer may apply Fix-Forward edits. This is a non-blocking warning — the pipeline completion is still accepted.

**Rationale:** Agents often forget to populate `files_modified`, reducing the value of the pipeline record for auditing and documentation. The soft warning creates a visible signal in the response without blocking legitimate zero-file-change completions. Verification-only agents are exempt to avoid noisy false-positive warnings.

**Exception:** The warning is only emitted on `PASS` completions — `FAIL` pipelines are not expected to declare modified files.

**Enforcement:** Soft check in `completePipeline()` in `src/tools/pipeline.ts` (step 3b), gated by `ARTIFACT_EXPECTED_PIPELINE_TYPES` from `src/utils/pipeline-maps.ts`. Does not reject the call; appended as a text note in the response body only.

---

### 68. Zod `.describe()` Annotations for Pipeline Type Must Use `describePipelineTypes()`

**Rule:** All Zod `.describe()` strings that enumerate pipeline type values MUST be generated by calling `describePipelineTypes(prefix)` from `src/utils/pipeline-maps.ts`. Hardcoding a pipeline type list inline in a `.describe()` string is forbidden.

**Rationale:** `PIPELINE_TYPES` is the single source of truth for the canonical pipeline type list. Hardcoded `.describe()` strings drift silently when a new pipeline type is added — as demonstrated when `observations.ts` still listed only 4 types after `security-audit` and `release-engineering` were introduced. `describePipelineTypes()` derives the annotation from `PIPELINE_TYPES` at schema definition time, so any future addition to `PIPELINE_TYPES` propagates automatically to all MCP JSON Schema annotations.

❌ **Anti-pattern:**
```typescript
PipelineTypeEnum.describe('Pipeline type: "implementation", "qa", "code-review", "documentation"')
```

✅ **Correct pattern:**
```typescript
import { describePipelineTypes } from '../utils/pipeline-maps.js';
// ...
PipelineTypeEnum.describe(describePipelineTypes('Pipeline type:'))
```

**Enforcement:** A drift-detection test in `tests/utils/pipeline-maps.test.ts` asserts that the output of `describePipelineTypes()` contains every entry in `PIPELINE_TYPES` — future additions to `PIPELINE_TYPES` that are not reflected in the helper will be caught automatically.

---

### 69. CSS Class Derivation from API Values Is Only Safe for Zod-Enum-Validated Fields

**Rule:** CSS class derivation from raw API values is only safe when the field is a Zod-enum-validated type. For non-enum fields, apply `escapeHtml()` or a whitelist map.

**Rationale:** The pattern `(field).toLowerCase().replace(/ /g, '_')` generates a CSS class string from a server-supplied value. If the field is a closed Zod enum, the server guarantees the value is one of a finite safe set — class injection is not possible. If the field is a free-form string (`z.string()`), a tampered ledger JSON (or a future schema relaxation) could insert arbitrary characters into a `class=""` attribute, enabling CSS injection or layout-breaking attacks.

**Anti-pattern:**
```javascript
// ❌ WRONG — open string field; output is injected into class="" without escaping
var cls = (someOpenStringField || '').toLowerCase().replace(/ /g, '_');
el.innerHTML = `<span class="badge ${cls}">…</span>`;
```

**Correct patterns:**
```javascript
// ✅ OPTION A — field is a closed Zod enum (safe by schema contract)
// p.status is WorkPackageStatus — a Zod enum with a fixed value set
var cls = (p.status || '').toLowerCase().replace(/ /g, '_');

// ✅ OPTION B — whitelist map (safe for any field type)
var STATUS_CLASS = { READY: 'ready', IN_PROGRESS: 'in_progress', COMPLETE: 'complete', BLOCKED: 'blocked', CANCELLED: 'cancelled' };
var cls = STATUS_CLASS[p.status] ?? 'unknown';

// ✅ OPTION C — escapeHtml() before insertion (safe for any field type)
var cls = escapeHtml((someField || '').toLowerCase().replace(/ /g, '_'));
```

**Scope:** This convention applies to all client-side JavaScript in `mcp-server/gui/public/` (currently `views/work-package.js`, `utils.js`). When adding new attribute values derived from API data, determine whether the field is enum-backed before using the raw-derivation pattern.

---

## Runtime Config Monitoring

- `gui-config.json` is the single source of truth for runtime-adjustable settings (`auto_handoff_enabled`, `max_handoff_depth`).
- The MCP server (`index.ts`) and GUI server (`gui/server.ts`) **both** must call `readConfigFromDisk()` at startup and `startConfigWatcher()` to begin monitoring.
- `getConfig()` **MUST NOT** read from disk — it returns from the in-memory singleton cache only.
- The `FSWatcher` must be closed via `stopConfigWatcher()` during graceful shutdown and in test teardown.
- The 250ms debounce is mandatory — do not reduce it. Windows `fs.watch()` commonly emits duplicate events within <100ms of a file write.
- On watcher error or file parse failure, the cache retains its last known good values. The server continues operating with stale config rather than crashing.
- `ledger_root` in `gui-config.json` is **read-only** from the GUI perspective. `writeConfig()` strips it from incoming data. API handlers **MUST NOT** allow callers to overwrite it via `PUT /api/config`.

---

### 70. Advisory Dependency Freshness Check on PASS Completion (§21.59)

**Rule:** When `ledger_complete_pipeline` is called with `status: 'PASS'` on a WP that has `dependencies`, the server performs an advisory staleness check. For each dependency, the server reads the full WP detail (pre-lock, before lock acquisition) and uses `dep.last_updated` directly. Inside the lock callback, if `dep.last_updated` is later than `pipeline.started_at` (using Date-based comparison via `new Date().getTime()` instead of lexicographic string comparison), a project comment is appended:

```typescript
{ type: 'warning', priority: 'low', agent: 'system', note: '<dep WP-XXX was modified after this pipeline started>' }
```

**PASS is never blocked.** This check is purely advisory — no pipeline status is changed, no error is thrown.

**Skip conditions:** The check is entirely skipped when:
- `pipeline.started_at` is absent (unstarted or legacy pipeline record), OR
- the WP's `dependencies` array is empty.

**`last_updated` field:** `WorkPackageDetail` now includes a dedicated `last_updated: z.string().optional()` field that is auto-stamped with `now()` on every WP detail write path (status transitions, claim, pipeline start/complete/cancel, creation, cascade reblock/unblock). The previous composite proxy (`max(status_changed_at, latest_pipeline.completed_at)`) is no longer used. The `last_updated` field is auto-stamped via `updateWorkPackageWithSync` (the primary choke point), plus explicit setting in `createWorkPackage`, `propagateDependencyUnblock`, and `propagateDependencyReblock` (which bypass the choke point). Existing WP detail files without the field parse without error (the field is optional).

**Race window (acceptable):** Dependency WP files are read before lock acquisition. A dependency could theoretically be modified between the pre-read and the lock. For an advisory-only check this race window is acceptable — false negatives do not affect correctness.

---

### 71. `gui/server.ts` Two-Tier Routing Convention — Preserve the Route-Map Comment Block

**Rule:** `gui/server.ts` uses a deliberate two-tier routing architecture. When adding a new route, use the correct tier and keep the route-map comment block at the bottom of `matchRoute()` up-to-date.

**Tier 1 — `matchRoute()`:** Handles segment-count-based dispatch. Receives pre-parsed path segments (`rest`), the request method, `ledgerRoot`, and `orchestratorLogsDir`. Suitable for routes that need only path-derived parameters (no body, no dynamic path-tail extraction). Returns a `() => Promise<unknown>` thunk, or `null` if no route matches. The function contains a **route-map comment block** before its final `return null` that lists every route handled outside `matchRoute()` (i.e., in `handleRequest()` special-case blocks). **This comment block must be kept current.** When a new route is handled in `handleRequest()` rather than `matchRoute()`, add a line to that block.

**Tier 2 — `handleRequest()` special-case blocks:** Handles routes that require body parsing (via `readBody()`) or path-tail extraction (via `path.slice()` + `decodeURIComponent()`). Each block is a guarded early-return placed before the `matchRoute()` fallback call.

**Current split (as of WP-009):**

| Tier | Routes |
|------|--------|
| `matchRoute()` | All GET routes; DELETE, POST, PATCH routes with only path-derived params |
| `handleRequest()` special-case | `PUT /api/config`, `POST /api/projects/:slug/reset`, `PATCH /api/projects/:slug`, `POST /api/orchestrator/start`, `POST /api/orchestrator/kill/:id`, `POST /api/orchestrator/dismiss/:id`, `GET /api/server-info` (configPath dependency) |

**Why it matters:** The comment block is the only place that enumerates routes handled outside `matchRoute()`. Without it, future contributors adding a new `matchRoute()` branch for an already-handled path could create silent shadowing bugs.

**Test coverage note:** As of WP-009, orchestrator routes have strong handler-level test coverage in `tests/gui/api-orchestrator.test.ts` but no `handleRequest()`-level integration test (unlike `tests/gui/api.test.ts` which exercises `handleRequest()` directly). A future `handleRequest()` integration test for orchestrator routes would provide defence-in-depth.

---

### 72. JSDoc Closure-Dependency Documentation for GUI Helpers

**Rule:** Every closure-scoped helper function in `gui/public/views/*.js` that reads or mutates variables from its enclosing scope MUST include a `Closure dependencies (from <parent>() scope):` JSDoc block listing each closed-over variable with a one-line description of whether it is read-only or mutated by this helper.

**Example:**
```javascript
/** Injects action buttons into the rendered table.
 *
 *  Closure dependencies (from renderOrchestrator() scope):
 *    `expandedIds`   — mutated; toggle clicks update row expansion state.
 *    `refreshQueue`  — read-only; called after Kill/Dismiss actions. */
function _bindQueueActions(container, entries) { /* ... */ }
```

**Rationale:** Vanilla JS files lack module-level imports that make dependencies visible. Without explicit documentation, future contributors cannot determine which outer-scope variables a helper depends on without reading the entire enclosing function. This convention was established during the `2026-05-20-orchestrator-gui-polish-rework` sprint and should be applied to all new closure-scoped helpers going forward.

**Scope:** Applies only to `gui/public/views/*.js` files (vanilla JS, no module system). TypeScript modules in `src/` use explicit imports and do not need this pattern.

```
###  Path: `/mcp-server/docs/agents/project-manifest/data-flows.md`

```md
# Key Data Flows

This document describes the main interaction paths through the system.

---

## Flow 1: Project Initialization

**Entry Point:** Agent invokes `ledger_initialize_project` tool

```
Agent → ledger_initialize_project(project_path, plan_file)
  ↓
LedgerStore.writeRootIndex()
  ↓
atomicWriteJson(storage/ledger/{slug}/project-ledger.json)
  ↓
  1. Create parent directories (mkdir -p)
  2. Write to {file}.tmp.{pid}
  3. Atomically rename to storage/ledger/{slug}/project-ledger.json
  ↓
store.writeProjectMeta() — auto-synced after root index write
  ↓
atomicWriteJson(storage/ledger/{slug}/.meta.json)
  ↓
store.archiveDocuments([plan_file])  — best-effort; outside lock scope
  ↓
  copyFile(join(planPath, plan_file), join(storageDir, plan_file))
  ENOENT and all other copy errors → file appended to skipped[], warning → stderr
  Success → file appended to archived[]
  ↓
Return RootIndex + { archived_documents, archive_skipped? } to agent
```

**Result:** New project ledger created with empty work packages array and a `.meta.json` file in the centralized storage directory. A copy of `plan_file` is stored in `storage/ledger/{slug}/` as archived reference (best-effort; missing source is silently skipped).

---

## Flow 1b: List All Projects

**Entry Point:** Agent invokes `ledger_list_projects` tool

```
Agent → ledger_list_projects(status?)
  ↓
LedgerStore.listAllProjects(ledgerRoot)
  ↓
readdir(storage/ledger/)
  ↓
For each entry (excluding .archive/):
  readFile(storage/ledger/{slug}/.meta.json)
  ProjectMetaSchema.parse(data)   ← invalid entries skipped, logged to stderr
  ↓
Optional filter by status
  ↓
Return ProjectMeta[] to agent
```

**Result:** Array of project metadata for all valid projects in the central ledger, optionally filtered by status. Read-only — no lock acquired.

---

## Flow 1c: Detect Project by Working Directory

**Entry Point:** Agent invokes `ledger_detect_project` tool (typically during pre-flight when `project_path` is not explicitly known)

```
Agent → ledger_detect_project(cwd_path)
  ↓
LedgerStore.detectProjectByCwd(cwd_path)
  ↓
LedgerStore.listAllProjects(ledgerRoot)  ← same scan as Flow 1b
  ↓
For each ProjectMeta:
  inferProjectRootFromPlanPath(meta.plan_path)
    → Replace \ with /
    → posix.dirname() × 4  (walks up docs/agents/plans/{slug})
    → returns normalized project root string
  ↓
  Normalize cwd_path (\ → /, lowercase on Windows)
  Normalize project root (\ → /, lowercase on Windows)
  ↓
  Match if:
    normalizedCwd === normalizedRoot           (exact project-root match)
    OR normalizedCwd.startsWith(root + '/')   (cwd is inside project root)
  ↓
Collect all matching projects
  ↓
  matches.length === 1 → status: FOUND  (return meta)
  matches.length  >  1 → status: AMBIGUOUS  (return all candidates)
  matches.length === 0 → status: NOT_FOUND
  ↓
On FOUND:   Return { plan_path, slug, title?, status } to agent
On AMBIGUOUS: Return error listing all candidate plan_path values
On NOT_FOUND: Return error with guidance to initialize the project
```

**Result:** Pure path-string comparison — no lock, no writes, no state mutation. The derived project root is computed from each project's `plan_path` using the established `{root}/docs/agents/plans/{slug}` convention (4-level depth). A parent of the project root does NOT match (matching is downward-only).

---

## Flow 2: Work Package Creation

**Entry Point:** Agent invokes `ledger_create_work_package` tool

```
Agent → ledger_create_work_package(project_path, assigned_to, dependencies, ...)
  ↓
Pre-lock validation (outside lock scope):
  - Validate dependencies exist
  - Validate active_pipeline_stages if provided:
      validateActiveStages(args.active_pipeline_stages, CANONICAL_PIPELINE_ORDERING)
        Hard guardrails (reject with error — creation aborted):
          - empty array
          - entries not in PIPELINE_TYPES
          - duplicate entries
          - entries not a subsequence of CANONICAL_PIPELINE_ORDERING
        Soft guardrails (warning appended to success response — creation NOT aborted):
          - 'implementation' present without 'qa'
          - single-stage chain
      Default when omitted: DEFAULT_PIPELINE_STAGES (['implementation', 'qa', 'code-review', 'documentation'])
  ↓
LedgerStore.createWorkPackageWithSync(creator)  ← primary choke point for WP creation
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
LedgerStore.readRootIndex()
  ↓
creator callback:
  Generate next WP ID (max-based):
    - Scan existing work_packages for highest numeric suffix
    - Next ID = max + 1 (e.g., if highest is WP-003, next is WP-004)
    - Empty project → WP-001
  ↓
  Cycle detection: hasCycle(newWpId, deps, allExistingWps) [BFS]
    If cycle detected → throw error (no write occurs)
  ↓
  Determine initial status (READY or BLOCKED based on dependencies)
  ↓
  Create WorkPackageDetail object
  Create WorkPackageSummary object
  ↓
  Update root index:
    - Append summary to work_packages array
    - Increment total_work_packages
    - Increment pending_work_packages
    - Set status to IN_PROGRESS (if was READY)
  ↓
  Return { wpId, wp: detail, root: updatedRoot }
  ↓
Auto-stamp wp.last_updated = now()  ← overrides any caller-set value
Zod validation: WorkPackageDetailSchema.parse(wp)
Zod validation: RootIndexSchema.parse(root)
  If either fails → throw error (no write occurs)
  ↓
LedgerStore.writeWorkPackage(WP-###, detail)    ← atomicWriteJson  [@internal — called by createWorkPackageWithSync only]
LedgerStore.writeRootIndex(root)                 ← atomicWriteJson, auto-syncs .meta.json  [@internal — called by createWorkPackageWithSync only]
  ↓
Release lock
  ↓
Return created WorkPackageDetail to agent
```

**Result:** Both `storage/ledger/{slug}/WP-###.json` and `storage/ledger/{slug}/project-ledger.json` are created/updated atomically within a single lock scope inside `createWorkPackageWithSync`. `.meta.json` is automatically synced. The `last_updated` field on the new WP is always set by the method, not by the caller. Tool code never calls `writeWorkPackage` or `writeRootIndex` directly — see Constraint 2c.

---

## Flow 3: Claiming a Work Package

**Entry Point:** Agent invokes `ledger_claim_work_package` tool

```
Agent → ledger_claim_work_package(project_path, work_package_id, agent)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
Read WorkPackageDetail (storage/ledger/{slug}/WP-###.json) — validated with Zod
Read RootIndex (storage/ledger/{slug}/project-ledger.json) — validated with Zod
  ↓
updater function:
  1. Validate current status is READY
  1b. CLAIMABLE_ROLES guard: verify agent maps to a claimable role (Planner and Synthesis excluded) — fires unconditionally before assignment/override checks
  2. Assignment guard: reject cross-agent claims unless override is set
  2b. Override auth guard: if override:true, verify caller is PM or current assigned_to
  3. Check dependencies via canStartWorkPackage()
  4. Validate status transition READY → IN_PROGRESS
  5. Update WP status, assigned_to, and status_changed_at
  6. Update root index summary status and assigned_to
  ↓
Validate updated WP and root with Zod
  ↓
atomicWriteJson(storage/ledger/{slug}/WP-###.json, updatedWP)
atomicWriteJson(storage/ledger/{slug}/project-ledger.json, updatedRoot)
store.writeProjectMeta() — auto-synced inside same lock
  ↓
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package transitioned from `READY` to `IN_PROGRESS` with both files updated atomically.

---

## Flow 4: Starting a Pipeline

**Entry Point:** Agent invokes `ledger_start_pipeline` tool

```
Agent → ledger_start_pipeline(project_path, work_package_id, type, agent_role)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir) — acquire storage/ledger/{slug}/.lock
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate WP status is IN_PROGRESS
  2. Check for duplicate in-progress pipeline of same type
  3. Enforce pipeline ordering via resolvePrerequisite(type, activeStages):
       activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
       Filters CANONICAL_PIPELINE_ORDERING by activeStages; returns the
       immediately preceding active stage as the prerequisite (null if first stage)
     If prerequisite not null and most recent prerequisite pipeline is not PASS
       → throw descriptive error:
         "Cannot start '<type>' pipeline: requires a PASS '<prereq>' pipeline first.
          Active pipeline order: <activeStages joined with →>."
  4. Role check: agent_role must match PIPELINE_AGENT_MAP owner for the type.
       Exception: agent_role === 'Project Manager' bypasses check (PM Override).
       If mismatch → throw descriptive error.
  4b. checkRevalidationGuard(): if a prior PASS of the prerequisite type is stale
       relative to upstream rework → reject with descriptive explanation.
  5. Rework detection (auto-cancelled pipelines excluded from all checks):
       Direct rework: last same-type completed pipeline has FAIL status → increment rework_counts[type]
       Downstream rework: prerequisite pipeline type reworked after last PASS → increment rework_counts[type]
       Effective count for circuit breaker: rework_counts?.[type] ?? 0
       If effective count ≥ MAX_REWORK_COUNT (5) → reject with error
  6. Create new Pipeline object (status: IN_PROGRESS, started_at: now())
  7. Append to WP.pipelines array
  8. Update WP.assigned_to via PIPELINE_AGENT_MAP:
       implementation      → 'Developer'
       qa                  → 'QA'
       security-audit      → 'Security Auditor'
       code-review         → 'Reviewer'
       release-engineering → 'Release Engineer'
       documentation       → 'Documentation'
  9. Update root index summary assigned_to to match
  10. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** New pipeline added to work package with `IN_PROGRESS` status.

---

## Flow 5: Completing a Pipeline

**Entry Point:** Agent invokes `ledger_complete_pipeline` tool

```
Agent → ledger_complete_pipeline(project_path, work_package_id, type, agent_role, status, summary, ...)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  0. WP status guard: verify WP.status === 'IN_PROGRESS' → throw if not (defense-in-depth)
  0b. Agent role guard: verify agent_role matches PIPELINE_AGENT_MAP[type]
       Exception: agent_role === 'Project Manager' → bypass (PM Override)
       isPmOverride = (agent_role === 'Project Manager')
  1. Find most recent IN_PROGRESS pipeline of given type
  2. Update pipeline status (PASS or FAIL)
  3. Set completed_at timestamp
  4. Set summary, artifacts, metrics, comments
  5. Update acceptance_criteria if provided (merge by exact criterion text: known → update met; unknown → append new entry)
  6. If handoff_notes provided:
       fromAgent = isPmOverride ? 'Project Manager (PM Override)' : PIPELINE_AGENT_MAP[type]
       toAgent   = (status === FAIL)
                     ? resolveFailAgent(type, activeStages)
                     : resolveNextAgent(type, activeStages)
       Append HandoffNote { from_agent, to_agent, timestamp, notes } to WP.handoff_notes
       NOTE: On FAIL, implementation/qa/security-audit/code-review route to Developer;
             release-engineering routes to Release Engineer (self-rework);
             documentation routes to Documentation (self-rework).
             Fallback: if the base fail-target's stage is absent from activeStages,
             routes to the first active stage's agent.
  7. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
If auto-finalize fired (autoFinalizeResult === 'finalized'):
  propagateDependencyUnblock(projectPath, work_package_id)
  [uses batchUpdateWorkPackagesWithSync — acquires its own separate lock — §12.2, Gotcha 8]
    Pre-check (outside lock): readRootIndex() — if no BLOCKED WP has this WP in its dependencies, return immediately (skip lock, skip all WP reads)
    If candidates exist: acquire lock via batchUpdateWorkPackagesWithSync
    For each BLOCKED WP whose dependencies include this WP:
      If all dependencies are now COMPLETE and blocked_by.type === 'dependency' (or absent):
        Transition BLOCKED → READY, clear blocked_by
    All eligible WPs updated atomically in a single lock scope
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Pipeline marked as complete with all metadata captured. When auto-finalize fires, eligible BLOCKED dependents are also transitioned to READY.

---

## Flow 6: Updating Work Package Status

**Entry Point:** Agent invokes `ledger_update_work_package_status` tool

```
Agent → ledger_update_work_package_status(project_path, work_package_id, status, agent, blocked_by?)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Validate status transition with isValidStatusTransition()
  1a. BLOCKED → BLOCKED early path: replace blocker (PM/assignee guard; dependency-type guard)
        → set status_changed_at, update root.last_updated, return early
  1b. READY → IN_PROGRESS redirect: reject with 'use ledger_claim_work_package' error
  2. Special validation for COMPLETE:
       a. Check all acceptance criteria are met (canCompleteWorkPackage)
       b. Freshness check: most recent non-auto-cancelled doc PASS must post-date most recent impl start
       c. Only 'Documentation' (or 'Documentation Agent') allowed
  3. Special validation for BLOCKED: require blocked_by object
  4. IN_PROGRESS → READY guard: reject if any pipeline is currently IN_PROGRESS;
       clear assigned_to in WP detail and root index summary
  5. Pipeline auto-cancellation:
       IN_PROGRESS → BLOCKED: cancel all IN_PROGRESS pipelines (auto_cancelled: true)
       IN_PROGRESS → CANCELLED: cancel all IN_PROGRESS pipelines
  6. Update WP status
  7. Set status_changed_at = now()
  8. Handle special transitions:
       BLOCKED → IN_PROGRESS: clear blocker
       BLOCKED → READY: clear blocker
       Any → BLOCKED: set blocker
       COMPLETE → IN_PROGRESS: increment revision; reset rework_counts to {};
                                 clearSynthesisState(root) — clears synthesis_generated and synthesis_generated_at (Project Manager or Documentation agent only)
  9. Update root index summary status
  10. Update pending_work_packages counter if transitioning to/from a terminal status (COMPLETE or CANCELLED)
  11. Update root.last_updated timestamp
  ↓
Write both files atomically
Release lock
  ↓
If new status is COMPLETE or CANCELLED:
  propagateDependencyUnblock(projectPath, completedWpId)
  ↓
  Pre-check (outside lock): readRootIndex() — if no BLOCKED WP has completedWpId in its dependencies, return immediately (skip lock, skip all WP reads)
  If candidates exist:
  LedgerStore.batchUpdateWorkPackagesWithSync(callback)  ← single lock acquisition
    Acquire lock (separate lock acquisition — §12.2, Gotcha 8)
    Read root index (inside lock)
    callback:
      For each BLOCKED WP that lists completedWpId as a dependency:
        readWp(wpId) — read WP detail inside the lock
        Run canStartWorkPackage() — checks ALL dependencies are COMPLETE or CANCELLED
        If not eligible: skip
        If blocked_by.type is external, decision, or technical: skip (non-dependency blocker; not cleared automatically)
        Transition BLOCKED → READY and clear blocked_by field
        Update root index summary status
        Add to updatedWps Map
      Return { updatedWps, root: updatedRoot }
    Auto-stamp last_updated on each WP; Zod-validate all WPs + root (two-pass validate-then-write)
    Write all updated WP files atomically; write root index; sync .meta.json once
    Release lock
  ↓
If old status was COMPLETE and new status is IN_PROGRESS (reopen):
  propagateDependencyReblock(projectPath, reopenedWpId)
  ↓
  Pre-check (outside lock): readRootIndex() — if no WP with status READY, IN_PROGRESS, or COMPLETE has reopenedWpId in its dependencies, return immediately (skip lock, skip all WP reads)
  If candidates exist:
  LedgerStore.batchUpdateWorkPackagesWithSync(callback)  ← single lock acquisition
    Acquire lock (separate lock acquisition)
    Read root index (inside lock)
    callback:
      Phase 1 — Re-block non-COMPLETE/non-CANCELLED/non-BLOCKED dependents:
        For each such WP that lists reopenedWpId as a dependency:
          readWp(wpId) — read WP detail inside the lock
          Auto-cancel any IN_PROGRESS pipelines (status=FAIL, auto_cancelled=true, completed_at=now())
          Transition WP to BLOCKED with blocked_by: {type: "dependency", blocking_work_package: reopenedWpId}
          Update root index summary status
          Add to updatedWps Map
      Phase 2 — Warn COMPLETE dependents:
        For each COMPLETE WP that lists reopenedWpId as a dependency:
          readWp(wpId) — read WP detail inside the lock
          Append warning comment to last pipeline (if any): {type:"warning",priority:"high",note:"..."}
          Add to updatedWps Map
      Phase 3 — Update root index:
        If any WPs were re-blocked (candidates.length > 0): clearSynthesisState(root) — sets synthesis_generated = false and synthesis_generated_at = null
        Recompute pending_work_packages
      Return { updatedWps, root: updatedRoot }
    Auto-stamp last_updated on each WP; Zod-validate all WPs + root (two-pass validate-then-write)
    Write all updated WP files atomically; write root index; sync .meta.json once
    Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Work package status updated with all business rules enforced. If transitioned to COMPLETE or CANCELLED, all eligible downstream dependents are automatically unblocked (both terminal statuses satisfy dependency requirements).

---

## Flow 7: Workflow Coordination (Get Next Action)

**Entry Point:** Agent invokes `ledger_get_next_action` tool

```
Agent → ledger_get_next_action(project_path, agent_role)
  ↓
LedgerStore.readRootIndex()
  ↓
Check project state:
  - No work packages? → Recommend CREATE_WORK_PACKAGES (for PM) or WAIT
  - All terminal (COMPLETE or CANCELLED)? → Recommend GENERATE_SYNTHESIS (for Synthesis, if `synthesis_generated` is absent/false) or WAIT
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic:
  - Project Manager: 6-priority algorithm (§14.1.2):
                     P1 UNBLOCK_WP — BLOCKED WPs with decision/external/technical blocker.
                     P2 REVIEW_REWORK_LIMIT — IN_PROGRESS WPs with rework_counts entry >= MAX_REWORK_COUNT.
                     P3 REVIEW_STALE — IN_PROGRESS WPs with a stale active pipeline.
                     P3b REVIEW_ABANDONED — IN_PROGRESS WPs with no active pipelines and no
                          recent activity (grace period: status_changed_at within STALE_PIPELINE_HOURS).
                     P3c REPAIR_ORPHAN_BLOCKED — BLOCKED WPs whose dependency block is stale
                          (canStartWorkPackage returns allowed:true).
                     P3d ROUTE_PIPELINE_AGENT — non-terminal, non-dependency-blocked IN_PROGRESS WPs
                          where the next active pipeline stage needs work. Applies the same guards as
                          §13.1 step 2b: FAIL stages are skipped (downstream FAIL routing), IN_PROGRESS
                          stages are skipped (stage already in flight), upstream IN_PROGRESS stages are
                          skipped (premature routing prevention). Returns ROUTE_PIPELINE_AGENT with
                          next_agent and pipeline_type. Covers stage-transition routing (e.g. impl PASS
                          → next stage) and freshly-claimed WPs with zero pipelines.
                     Final Fallback WAIT — no actionable items.
  - Developer: 7-priority per-WP algorithm (§14.2, evaluated for each IN_PROGRESS/READY WP):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.implementation >= MAX_REWORK_COUNT.
                     P2 RESUME_OR_CANCEL — stale implementation pipeline (>STALE_PIPELINE_HOURS).
                     P3 CONTINUE_PIPELINE — active non-stale implementation pipeline in progress.
                     P4 REWORK (direct) — most recent implementation pipeline is FAIL (precedes IMPLEMENT).
                     P5 REWORK (downstream) — downstream FAIL + hasDownstreamReengagedSince=true.
                     P5b WAIT_FOR_DOWNSTREAM — downstream FAIL + hasDownstreamReengagedSince=false.
                     P6 IMPLEMENT — IN_PROGRESS WP with no implementation pipeline.
                     P7 CLAIM_WP — READY WP with dependencies satisfied.
                     Fallback WAIT.
  - QA: 7+1b per-WP algorithm (§14.3):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.qa >= MAX_REWORK_COUNT.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — rework_counts.implementation >= MAX_REWORK_COUNT.
                     P2 RESUME_OR_CANCEL — stale qa pipeline.
                     P3 CONTINUE_PIPELINE — active non-stale qa pipeline.
                     P4 RUN_QA (re-engagement) — prior qa pipeline exists + hasNewUpstreamPassSince.
                     P5 WAIT_FOR_REWORK — most recent qa pipeline is FAIL and P4 guard is false.
                     P6 RUN_QA (first-run) — implementation PASS, no qa pipeline.
                     P7 CLAIM_WP — READY WP assigned to QA with dependencies satisfied.
  - Reviewer: 7+1b per-WP algorithm (§14.4, mirrors QA for code-review pipeline):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts['code-review'] >= MAX_REWORK_COUNT.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — rework_counts.implementation OR .qa >= MAX.
                     P2–P3 same stale/active pattern for code-review pipeline.
                     P4 RUN_REVIEW (re-engagement) — prior code-review + hasNewUpstreamPassSince('qa').
                     P5 WAIT_FOR_REWORK, P6 RUN_REVIEW (first-run), P7 CLAIM_WP.
  - Documentation: 7+1b per-WP algorithm (§14.5):
                     P1 BLOCK_FOR_REWORK_LIMIT — rework_counts.documentation >= MAX.
                     P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT — any of impl|qa|code-review >= MAX.
                     P2 RESUME_OR_CANCEL, P3 CONTINUE_PIPELINE (same stale/active pattern).
                     P4 REWORK (self) — documentation FAIL + !hasNewUpstreamPassSince guard.
                     P5 FINALIZE_WP — doc PASS + all criteria met + freshness check
                          (doc completed_at >= latest impl started_at). Replaces MARK_COMPLETE.
                     P5b UPDATE_CRITERIA — doc PASS + freshness + at least one criterion not met.
                     P6 WRITE_DOCS — code-review PASS + fresh or first documentation run.
                     P7 CLAIM_WP — READY WP assigned to Documentation.
  - Synthesis: Wait until all work packages are terminal (COMPLETE or CANCELLED)
  ↓
Return recommendation:
  {
    action: "IMPLEMENT" | "CLAIM_WP" | "CONTINUE_PIPELINE" | "REWORK" |
            "WAIT_FOR_DOWNSTREAM" | "BLOCK_FOR_REWORK_LIMIT" | "WAIT_FOR_REWORK" |
            "WAIT_FOR_UPSTREAM_REWORK_LIMIT" |
            "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | "REWORK_DOCS" |
            "FINALIZE_WP" | "UPDATE_CRITERIA" |
            "RESUME_OR_CANCEL" | "REVIEW_STALE" | "REVIEW_ABANDONED" | "REVIEW_REWORK_LIMIT" |
            "UNBLOCK_WP" | "REPAIR_ORPHAN_BLOCKED" | "ROUTE_PIPELINE_AGENT" |
            "GENERATE_SYNTHESIS" | "WAIT" | ...,
    work_package_id?: "WP-###",
    reason: "...",
    // RESUME_OR_CANCEL includes: pipeline_type, started_at, age_hours
    // ROUTE_PIPELINE_AGENT includes: next_agent, pipeline_type
  }
```

**Result:** Agent receives actionable recommendation based on project state and their role.

---

## Flow 8: Workflow Coordination (Get Handoff Status)

**Entry Point:** Agent invokes `ledger_get_handoff_status` tool

```
Agent → ledger_get_handoff_status(project_path, current_agent)
  ↓
LedgerStore.readRootIndex()
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific handoff logic:
  - Planner: If no WPs have been created → READY_FOR_PM (signal PM to begin task decomposition)
             Otherwise → READY_FOR_PM or WAIT based on overall completion state

  - Developer (§5.1): Operates on non-terminal, non-dependency-blocked WPs ("activeWps")
      1. Temporal guard — for each activeWP: if the most recent downstream pipeline (qa or
         code-review) is FAIL AND hasDownstreamReengagedSince(implementation) = true
         → IN_PROGRESS  (Developer must rework; downstream has already re-engaged)
      2. Needs QA — for each non-dependency-blocked WP: PASS implementation exists AND
         hasNewUpstreamPassSince("implementation", "qa") = true
         → READY_FOR_QA  (covers first-run and post-rework re-delivery)
      3. All terminal — all WPs are COMPLETE or CANCELLED → READY_FOR_SYNTHESIS
      4. Active work — any WP is IN_PROGRESS with assigned_to === "Developer" → IN_PROGRESS
      → WAIT

  - QA (§5.2): Operates on non-terminal, non-dependency-blocked WPs
      1. Re-engagement (BEFORE FAIL short-circuit) — most recent QA pipeline is FAIL AND
         hasNewUpstreamPassSince("implementation", "qa") = true
         → IN_PROGRESS  (QA should re-engage; Developer has since re-delivered)
      2. FAIL short-circuit — most recent QA pipeline is FAIL (step 1 guard was false)
         → READY_FOR_DEVELOPER
      3. READY_FOR_REVIEW — non-terminal WPs where PASS QA exists AND
         hasNewUpstreamPassSince("qa", "code-review") = true; check if all such are
         dependency-blocked → if non-empty unblocked subset → READY_FOR_REVIEW
      4. All terminal → READY_FOR_SYNTHESIS
      5. IN_PROGRESS assigned to QA → IN_PROGRESS
      → WAIT

  - Reviewer (§5.3): Mirror of QA applied to the code-review pipeline stage
      1. Re-engagement (BEFORE FAIL short-circuit) — most recent code-review pipeline is FAIL
         AND hasNewUpstreamPassSince("qa", "code-review") = true → IN_PROGRESS
      2. FAIL short-circuit — most recent code-review is FAIL (step 1 guard was false)
         → READY_FOR_QA
      3. READY_FOR_DOCUMENTATION — non-terminal WPs where PASS code-review exists AND
         hasNewUpstreamPassSince("code-review", "documentation") = true; dependency-block
         routing applies → READY_FOR_DOCUMENTATION or READY_FOR_SYNTHESIS
      4. All terminal → READY_FOR_SYNTHESIS
      5. IN_PROGRESS assigned to Reviewer → IN_PROGRESS
      → WAIT

  - Documentation (§5.4, §14.5 priority — ready-for-docs BEFORE self-rework FAIL):
      1. Ready-for-docs — non-terminal WPs where PASS code-review exists AND
         (no documentation pipeline yet OR hasNewUpstreamPassSince("code-review", "documentation")
         = true) → IN_PROGRESS  (new docs or re-engagement after upstream rework)
      2. FAIL self-rework — most recent documentation pipeline is FAIL (step 1 guard was false)
         → IN_PROGRESS  (handled internally; never forwarded to Developer)
      3. allDocsPassed — all non-dependency-blocked unreviewed WPs have PASS documentation →
           non-empty unblocked subset → READY_FOR_SYNTHESIS; all dep-blocked → WAIT
      4. wpsNotYetReviewed remain — dependency-block routing:
           not all dep-blocked → READY_FOR_REVIEW; all dep-blocked → READY_FOR_SYNTHESIS
      → WAIT

  - Project Manager (§13.1): Operates on full WP list
      1. Non-dependency blockers — BLOCKED WP with technical/external/decision blocker
         → IN_PROGRESS  (PM must intervene; dependency-blocked WPs are skipped here)
      2. READY WPs — readyStatusForAgent(wp.assigned_to) routes to READY_FOR_QA,
         READY_FOR_DEVELOPER, etc. based on assigned agent; unassigned WPs route via
         PIPELINE_AGENT_MAP[firstActiveStage(wp)] to the first-stage owner
      2b. IN_PROGRESS WPs needing next pipeline stage (fires only when no READY WPs in step 2):
          For each non-terminal, non-dependency-blocked IN_PROGRESS WP, scans ordered active stages:
            - PASS stage → continue to next; FAIL stage → break (downstream handles it)
            - IN_PROGRESS stage → break (already in flight); upstream IN_PROGRESS → break
            - otherwise → readyStatusForAgent(PIPELINE_AGENT_MAP[stage])
          Covers stage-transition routing (e.g. impl PASS → READY_FOR_QA) and freshly-claimed
          WPs with zero pipelines (routes to first active stage's agent).
      3. All terminal → READY_FOR_SYNTHESIS
      → WAIT
  ↓
Return handoff block:
  {
    agent: "QA" | "Reviewer" | "Documentation" | "Synthesis" | "Developer" | ...,
    status: "READY_FOR_QA" | "READY_FOR_REVIEWER" | "READY_FOR_SYNTHESIS" | ...
  }
```

**Key invariant:** The dependency-blocked check is applied symmetrically across all handoff functions. A work package is considered dependency-blocked when `wp.status === 'BLOCKED'` and `blocked_by` is absent or `blocked_by.type === 'dependency'` (single-parameter `isBlockedByDependencies(wp)`). WPs blocked by incomplete dependencies are excluded from "work remaining" counts — they do not prevent progression to the next stage.

**Temporal guard invariant:** Re-engagement detection (`hasDownstreamReengagedSince`, `hasNewUpstreamPassSince`) is applied before FAIL short-circuits in all handoff functions. Auto-cancelled pipelines are excluded from both the upstream PASS lookup and downstream timestamp comparisons during these checks.

**Result:** Agent receives the `AGENT: <next> / STATUS: <status>` handoff block.

---

## Flow 9: Self-Healing Counter and Status Correction

**Entry Point:** Agent invokes `ledger_get_project_status` tool

```
Agent → ledger_get_project_status(project_path)
  ↓
LedgerStore.readRootIndex()
  ↓
computeHealedStatus(rootIndex)  [pure function — no I/O]
  ↓
  Recompute counters from work_packages array:
    - totalWps = work_packages.length
    - pendingWps = count where status is not terminal (not COMPLETE and not CANCELLED)
  ↓
  Corruption mitigation (§17.2 known-gap):
    If synthesis_generated === true AND pendingWps > 0:
      → treat synthesisGenerated as false for all rule evaluation
      → set corruptionDetected = true
      → (write callback will call clearSynthesisState(fresh) to prevent a repeated-write loop)
  ↓
  Auto-heal project status (first-match-wins; 16 rules from §17.2):
    1.    (IN_PROGRESS|READY) + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
    1b.   READY  + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    1c.   IN_PROGRESS + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS (preserve)
    2.    COMPLETE + pendingWps>0 → IN_PROGRESS  (reopen / drift repair)
    2b.   COMPLETE + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    3.    READY + hasInProgressWp → IN_PROGRESS
    3b.   READY + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
    3c.   IN_PROGRESS + pendingWps>0 + !hasReadyWp + !hasInProgressWp → BLOCKED
    4.    BLOCKED + hasInProgressWp → IN_PROGRESS
    4b.   BLOCKED + hasReadyWp + !hasInProgressWp → READY
    5a.   BLOCKED + pendingWps==0 + totalWps>0 + synthesisGenerated → COMPLETE
    5b.   BLOCKED + pendingWps==0 + totalWps>0 + !synthesisGenerated → IN_PROGRESS
    6b.   (IN_PROGRESS|BLOCKED) + totalWps==0 → READY
    6c.   COMPLETE + totalWps==0 → READY
    (CANCELLED projects fall through all rules unchanged)
  ↓
  needsWrite = true when any counter differs, status changed, or corruptionDetected
  ↓
  Return { totalWps, pendingWps, healedStatus, needsWrite, corruptionDetected }
  ↓
If needsWrite is false:
  computePipelineHealth(rootIndex, store)  [outside lock — read-only, no write path]
    Iterate rootIndex.work_packages; skip any with status === 'CANCELLED'
    For each non-CANCELLED WP: store.readWorkPackage(wpId)
      If readable: getPassedStages(wpDetail) → passed Set<string>
        activeCount = wp.active_pipeline_stages.length (if field is set and non-empty)
                   OR DEFAULT_PIPELINE_STAGES.length (4 — legacy default when field is absent)
        missing = activeCount − passed.size
        If missing === 0: increment wps_with_all_stages_pass
        Else: increment wps_missing_stages; add missing to total_stages_missing
      If unreadable: silently skip (catch{}, contributes nothing)
    → { wps_with_all_stages_pass, wps_missing_stages, total_stages_missing }
  Return { ...rootIndex, pipeline_health } to agent

  (No legacy repairs run on this path — repairs are triggered only when needsWrite,
   needsLegacyVersionBackfill, or needsForwardCompatWarning is true.)
  ↓
Pre-lock computation (outside lock — safe because these only read, not write):
  validatePipelineOrdering(rootIndex, store) — reads WP detail files only
    For each WP: read detail, check that pipeline started_at timestamps are monotonically
    non-decreasing. Any violation captured as a warning string. Read failures silently skipped.
  Pre-compute synthesis repair comment dedup check (note text match against project_comments)
  Pre-compute forward-compat warning dedup check (note text match against project_comments)
  ↓
If needsWrite OR needsLegacyVersionBackfill OR needsForwardCompatWarning
   OR orderingWarnings.length > 0 OR needsSynthesisRepairComment is true:
  withLock(store.storageDir)  ← SINGLE lock scope for ALL repairs (consolidated from 3)
    ↓
    Re-read rootIndex under lock (fresh copy) — TOCTOU symmetry
    computeHealedStatus(fresh) again
    Re-check all dedup conditions against fresh copy
    ↓
    needsAnyWrite = freshHealed.needsWrite || freshNeedsVersionBackfill ||
                    freshNeedsForwardCompatWarning || orderingWarnings.length > 0 ||
                    freshNeedsSynthesisRepairComment
    ↓
    If needsAnyWrite:
      Status/counter corrections (if freshHealed.needsWrite):
        fresh.total_work_packages = totalWps
        fresh.pending_work_packages = pendingWps
        fresh.status = healedStatus
        if corruptionDetected: clearSynthesisState(fresh)  ← prevents repeated-write loop
      Legacy synthesis_generated_at repair (if legacySynthesisTimestampRepair):
        fresh.synthesis_generated_at = fresh.last_updated
      Legacy ledger_version backfill (if absent):
        fresh.ledger_version = SPEC_VERSION (silent — no comment)
      Forward-compat warning (if ledger_version > SPEC_VERSION, deduplicated):
        Emit warning project_comment
        (semver comparison uses isFinite() guard — pre-release segments like '2.5.0-beta' that
         produce NaN are skipped gracefully, preventing false forward-compat warnings)
      Pipeline ordering warnings:
        Append each captured warning as project_comment { type:'warning', priority:'low', agent:'system' }
      Synthesis timestamp repair comment (deduplicated — pre-lock + in-lock pattern):
        Append soft warning project_comment if not already present
      fresh.last_updated = now()
      LedgerStore.writeRootIndex(fresh)
    Release lock
  ↓
  computePipelineHealth(corrected, store)  [same as no-write path; uses corrected root index]
    → { wps_with_all_stages_pass, wps_missing_stages, total_stages_missing }
  Return { ...corrected, pipeline_health } to agent
```

**Result:** Root index counters, project status, and legacy fields are automatically corrected if they drift out of sync. The corruption mitigation prevents a premature `synthesis_generated` flag from causing a repeated-write loop on every `getProjectStatus` call. Pipeline ordering warnings are appended as system comments whenever healing was triggered. Disk writes only occur when corrections are needed and are always performed under lock with a fresh re-read to avoid race conditions. In all response paths, the response includes a `pipeline_health` sub-object reporting aggregate stage completeness across all non-CANCELLED WPs (see `ledger_get_project_status` in `api-surface.md` for the full schema).

---

## Flow 10: Pipeline Cancellation

**Entry Point:** Agent invokes `ledger_cancel_pipeline` tool

```
Agent → ledger_cancel_pipeline(project_path, work_package_id, type, reason)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Find most recent IN_PROGRESS pipeline of given type
  2. If not found → throw error
  3. Set pipeline status to FAIL
  4. Set completed_at to now()
  5. Set summary to [reason]
  6. Update root.last_updated
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Stale or abandoned pipeline is closed as FAIL, allowing a fresh pipeline to be started.

---

## Flow 11: Pipeline Progress Update

**Entry Point:** Agent invokes `ledger_update_pipeline_progress` tool

```
Agent → ledger_update_pipeline_progress(project_path, work_package_id, type, summary)
  ↓
LedgerStore.updateWorkPackageWithSync(wpId, updater)
  ↓
withLock(store.storageDir)
  ↓
Read WorkPackageDetail and RootIndex
  ↓
updater function:
  1. Find most recent IN_PROGRESS pipeline of given type
  2. If not found → throw error
  3. Append new summary strings to pipeline.summary array
  4. Update root.last_updated
  ↓
Write both files atomically
Release lock
  ↓
Return updated WorkPackageDetail to agent
```

**Result:** Pipeline summary updated with incremental progress notes without closing the pipeline.

---

## Flow 12: Workflow Coordination (Get Next Actions — Batch)

**Entry Point:** Agent invokes `ledger_get_next_actions` tool

```
Agent → ledger_get_next_actions(project_path, agent_role, max_results?)
  ↓
LedgerStore.readRootIndex()
  ↓
Check project state:
  - No work packages? → Return empty array or single CREATE_WORK_PACKAGES recommendation
  - All terminal (COMPLETE or CANCELLED)? → Return single GENERATE_SYNTHESIS (for Synthesis) or empty array
  ↓
Load all WorkPackageDetail files (Promise.all)
  ↓
Agent-specific logic (same as Flow 7, but collects ALL matches):
  - Project Manager: Find all actionable WPs across P1–P3c (UNBLOCK_WP, REVIEW_REWORK_LIMIT,
                     REVIEW_STALE, REVIEW_ABANDONED, REPAIR_ORPHAN_BLOCKED)
  - Developer: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, RESUME_OR_CANCEL,
                     CONTINUE_PIPELINE, REWORK, WAIT_FOR_DOWNSTREAM, IMPLEMENT, CLAIM_WP)
  - QA: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, WAIT_FOR_UPSTREAM_REWORK_LIMIT,
                     RESUME_OR_CANCEL, CONTINUE_PIPELINE, RUN_QA, WAIT_FOR_REWORK, CLAIM_WP)
  - Reviewer: Find all WPs across P1–P7 (same pattern for code-review pipeline)
  - Documentation: Find all WPs across P1–P7 (BLOCK_FOR_REWORK_LIMIT, WAIT_FOR_UPSTREAM_REWORK_LIMIT,
                     RESUME_OR_CANCEL, CONTINUE_PIPELINE, REWORK, FINALIZE_WP, UPDATE_CRITERIA,
                     WRITE_DOCS, REWORK_DOCS, CLAIM_WP)
  - Synthesis: Wait until all work packages are terminal (COMPLETE or CANCELLED)
  ↓
Collect actions up to max_results limit (default: 5)
  ↓
Return array of recommendations:
  [
    {
      action: "IMPLEMENT" | "RUN_QA" | "RUN_REVIEW" | "WRITE_DOCS" | ...,
      work_package_id: "WP-###",
      reason: "...",
      handoff_notes?: string[]  // If addressed to this agent
    },
    ...
  ]
```

**Result:** Agent receives multiple actionable recommendations, enabling parallel work on independent work packages.

---

## Flow 13: Auto-Handoff Depth Counter Lifecycle

**Context:** `auto_handoff_depth` is a safeguard against infinite agent-chain loops. `buildHandoffResponse` in `src/tools/workflow-handoff.ts` manages the increment on every handoff-status response. The reset to `0` is performed by `completeSynthesis` in `src/tools/project-lifecycle.ts` per §18.4.

**Ceiling:** `effectiveMaxDepth(root.total_work_packages ?? 0)` — dynamic per §18.2.1: `max(configMax, totalWorkPackages × 30)`, where `configMax = getMaxHandoffDepth()` (default 50, runtime-configurable via `gui-config.json`). The floor ensures small projects still get a meaningful ceiling (50+ handoffs); larger projects scale proportionally.

### 13a: Storage Location

```
root index (storage/ledger/{slug}/project-ledger.json)
  └── auto_handoff_depth: number   ← current chain depth (0 when absent)
```

The field is optional on the root index schema; a missing value is treated as `0` everywhere.

### 13b: Increment Path (normal handoff)

```
Agent invokes ledger_get_handoff_status (or ledger_get_next_action)
  ↓
buildHandoffResponse() — src/tools/workflow.ts
  ↓
Registry check: isRegistryLoaded() === true
  ↓
Eligibility check:
  - status not in { COMPLETE, BLOCKED, IN_PROGRESS }
  - nextAgent resolves to a known VS Code agent handle
  ↓
store.readRootIndex()
  ↓
currentDepth = root.auto_handoff_depth ?? 0
  ↓
  [currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)?]
    YES → store.writeRootIndex({ ...root, auto_handoff_depth: currentDepth + 1 })
          agentId = getAgentId(nextAgent)          // null when persona has no id: frontmatter field
          agentNames = AGENT_NAMES[nextAgent]       // loaded from personas/name-mapping.json at startup
          auto_handoff object is included in the response payload:
            {
              agent_name:    agentHandle,                        // VS Code display name from Agent Registry
              agent_id:      agentId ?? (omitted),               // omitted when null — not serialized
              cc_agent_name: agentNames.claude_code.agent_name,  // e.g. "3-developer"
              vs_agent_name: agentNames.vscode.agent_name,       // e.g. "3 - Developer v3.6.1"
              da_agent_name: agentNames.deep_agents.agent_name,  // e.g. "3-developer"
              prompt:        buildHandoffPrompt(projectPath, agentId)
            }
    NO  → auto_handoff is omitted from the response (depth exceeded — see 13d)
```

### 13c: Reset Path (synthesis complete)

```
Agent invokes ledger_complete_synthesis
  ↓
completeSynthesis() — src/tools/project-lifecycle.ts
  ↓
withLock() callback
  ↓
store.readRootIndex()
  ↓
rootIndex.synthesis_generated = true
rootIndex.auto_handoff_depth = 0
rootIndex.status = 'COMPLETE'  (if all WPs are done)
  ↓
store.writeRootIndex(rootIndex)  ← single atomic write
```

The reset is performed atomically alongside `synthesis_generated: true` in the same `writeRootIndex` call, inside the `withLock` callback. `buildHandoffResponse` no longer performs the reset.

### 13d: Depth-Exceeded Path (chain terminated)

```
currentDepth >= effectiveMaxDepth(root.total_work_packages ?? 0)
  ↓
auto_handoff key is NOT included in the response payload
  ↓
No error thrown — no warning emitted
  ↓
Agent chain terminates; manual routing by the user is required
```

**Result:** The automatic handoff chain allows up to `effectiveMaxDepth(totalWorkPackages)` consecutive agent invocations (floor 50, scales to `totalWPs × 20` for larger projects per §18.2.1) before requiring human intervention, preventing runaway loops while preserving normal multi-agent workflows.

---

## Data Flow Patterns

### Pattern 1: Read-Validate-Process-Return

All read operations follow this pattern:
1. Read JSON file
2. Parse JSON
3. Validate with Zod schema
4. Return typed object (or throw error)

### Pattern 2: Validate-Write-Atomically

All write operations follow this pattern:
1. Validate data with Zod schema
2. Serialize to pretty JSON (2-space indent, trailing newline)
3. Write to temp file
4. Atomically rename to target file

### Pattern 3: Lock-Read-Update-Write-Release

All dual-file updates follow this pattern:
1. Acquire file lock
2. Read both files (validated)
3. Apply update logic
4. Validate updated data
5. Write both files atomically
6. Release lock in `finally` block

### Pattern 4: Status Transition State Machine

Work package status transitions are enforced via state machine:
```
READY ──────────────────────────────────────────────────► CANCELLED (PM-only, terminal)
  │  ↑                                                         ▲
  │  │ (unclaim, §21.13)                                       │
  ▼  │                                                         │ (PM-only)
IN_PROGRESS ──────────────────────────────────────────────────┤
  │  ▲                                                         │
  │  │                                                         │
  ▼  │                                                         │
BLOCKED                                                        │
  │                                                            │
  ▼                                                            │
IN_PROGRESS → COMPLETE ──────────────────────────────────────┘
                   │
                   ▼
             IN_PROGRESS (revision++)
```

Simplified table view:

| From        | To            |
|-------------|---------------|
| READY       | IN_PROGRESS   |
| READY       | BLOCKED       |
| READY       | CANCELLED     |
| IN_PROGRESS | COMPLETE      |
| IN_PROGRESS | BLOCKED       |
| IN_PROGRESS | READY         |
| IN_PROGRESS | CANCELLED     |
| BLOCKED     | IN_PROGRESS   |
| BLOCKED     | READY         |
| BLOCKED     | CANCELLED     |
| COMPLETE    | IN_PROGRESS   |
| COMPLETE    | CANCELLED     |

`CANCELLED` is the only fully terminal status — no outward transitions. Every transition is validated before being applied.

---

## Flow 14: Synthesis Completion

**Entry Point:** Synthesis agent (or Project Manager) invokes `ledger_complete_synthesis` tool

```
Agent → ledger_complete_synthesis(project_path, agent_role, synthesis_file?)
  ↓
withLock(store.storageDir, async () => {
  Guard 1 (§19.1): agent_role must be "Synthesis" or "Project Manager"
    → Error if not
    ↓
  LedgerStore.readRootIndex()
    ↓
  Guard 2 (§19.1): compute fresh totalWps and pendingWps from work_packages array
    (ignores stale pending_work_packages counter)
    ↓
  Guard 3 (§19.1): totalWps must be > 0
    → Error "Cannot complete synthesis: no work packages exist"
    ↓
  Guard 4 (§19.1): pendingWps must be 0
    → Error if any WPs remain non-terminal (uses freshly computed count)
    ↓
  Set synthesis_generated = true
  Reset auto_handoff_depth = 0  (§18.4)
  Set last_updated = now()
    ↓
  Set project status to COMPLETE (all guards passed)
    ↓
  LedgerStore.writeRootIndex(updatedRoot)
    ↓
  store.archiveDocuments([synthesis_file])  — best-effort; inside lock scope
    ↓
    copyFile(join(planPath, synthesis_file), join(storageDir, synthesis_file))
    Error → appended to skipped[], warning → stderr
    Success → appended to archived[]
    ↓
  Assign result content block to outer-scope 'let result!'
})
  ↓
Return result + { archived_documents, archive_skipped? }
```

**Result:** All four §19.1 guards must pass before `synthesis_generated` is set. The `synthesis_generated` flag prevents re-triggering `GENERATE_SYNTHESIS`. The `auto_handoff_depth` reset (§18.4) prevents stale depth counts on future projects. Not idempotent with respect to guard failures — a call with a pending WP or wrong role returns an error. The full read-modify-write cycle is protected by `withLock` to prevent TOCTOU races when multiple agents run concurrently. A copy of `synthesis_file` (default `synthesis.md`) is stored inside the lock scope in `storage/ledger/{slug}/` as an archived reference (best-effort; missing source is silently skipped).

---

## Flow 15: Acceptance Criteria Management

**Entry Point:** Project Manager invokes `ledger_update_acceptance_criteria` tool

```
PM → ledger_update_acceptance_criteria(project_path, work_package_id, agent_role, operations)
  ↓
Guard: agent_role must be "Project Manager"
  → Error if not (checked before file lock is acquired)
  ↓
withLock(store.storageDir, async () => {
  LedgerStore.readRootIndex() + LedgerStore.readWorkPackage()
    ↓
  Guard: WP must not be CANCELLED
    → Error if CANCELLED
    ↓
  Clone acceptance_criteria array
    ↓
  Apply operations sequentially on clone:
    remove:       find exact criterion text match → remove entry
                  → Error if no match found
    modify_text:  find exact old_criterion match → replace criterion text
                  new_criterion must be non-empty/non-whitespace
                  met flag is preserved (text change only)
                  → Error if old_criterion not found or new_criterion blank
    ↓
  Guard: post-mutation clone must have ≥ 1 criterion remaining
    → Error if all criteria were removed
    ↓
  Commit cloned array atomically to WP detail + root index
})
  ↓
Return success message listing applied operations
```

**Result:** The PM can remove stale or incorrect criteria and fix criterion text without altering evaluation state (`met` flags). The zero-criteria guard ensures every WP always has at least one testable acceptance criterion. All mutations are atomic — a partial batch never leaves the WP in an intermediate state.

---

## Flow 16: Synthesis Document View (GUI)

**Entry Point:** User navigates to `#/projects/:slug/synthesis` in the dashboard

```
Browser hash → #/projects/:slug/synthesis
  ↓
Router.dispatch()
  ↓
synthesisMatch = path.match(/^\/projects\/([^/]+)\/synthesis$/)
  ↓
renderSynthesis(app, slug)
  ↓
  app.innerHTML = '<p class="loading">Loading synthesis…</p>'   ← immediate feedback
  ↓
  API.getSynthesisDocument(slug)
  → fetch('GET', '/api/projects/:slug/synthesis')
  ↓
  server.ts routes to handleGetSynthesisDocument(ledgerRoot, slug)
    ↓
    assertSafeSlug(slug)
    LedgerStore.ledgerDirExists()   ← NOT_FOUND if project absent
    readFile(storage/ledger/{slug}/synthesis.md, 'utf-8')
    → Return { content: "<markdown>" }
    ← 404 NOT_FOUND if synthesis.md absent or project absent
  ↓
  marked.parse(result.content)   ← client-side Markdown → HTML
  ↓
  app.innerHTML =
    <breadcrumb: Projects / {slug} / Synthesis> +
    <div class="synthesis-content">{html}</div>

On NOT_FOUND:
  app.innerHTML =
    <breadcrumb: Projects / {slug} / Synthesis> +
    <p class="empty-state">Synthesis document not available for this project.</p>

On other errors:
  app.innerHTML = '<p class="error-banner">Failed to load synthesis document.</p>'
```

**Synthesis link on Project Detail page:**

```
User navigates to #/projects/:slug
  ↓
renderProjectDetail(app, slug) calls Promise.all([API.getProject(slug), API.getPlanDocument(slug)])
  ↓
project.synthesis_generated === true?
  YES → inject <div class="synthesis-link-row"><a href="#/projects/:slug/synthesis">View synthesis →</a></div>
  NO  → nothing rendered (no HTTP call)
```

**Key design:**
- The synthesis link is driven by `project.synthesis_generated` (already in the `GET /api/projects/:slug` response — no extra HTTP call).
- The "not available" empty state handles projects where `synthesis_generated` is `true` but `synthesis.md` was not archived (e.g. race or skipped archival).
- `.synthesis-content` shares all typography CSS rules with `.plan-content` via multi-selector (DRY — no duplicated rules).

---

## Flow 12: Auto-Archive Background Service

**Entry Point:** `gui/server.ts` startup (and every 10 minutes thereafter)

### Flow 12a: Timer initialization (server startup)

```
gui/server.ts main()
  ↓
readConfigFromDisk(configPath)    ← populates in-memory config cache
startConfigWatcher(configPath)    ← watches for GUI-driven config changes
  ↓
startAutoArchiveTimer(ledgerRoot)
  ↓
  _intervalHandle !== null?
    YES → no-op (idempotency guard)
    NO  →
      tick()              ← runs immediately on startup
      setInterval(tick, 600_000)   ← then every 10 minutes
```

### Flow 12b: Single archive scan tick

```
tick()
  ↓
getConfig().auto_archive_days   ← reads live in-memory config (no disk I/O)
  ↓
auto_archive_days === 0?
  YES → return (archiving disabled)
  NO  →
    runAutoArchive(ledgerRoot, maxAgeDays)
      ↓
      LedgerStore.listAllProjects(ledgerRoot)
        → readdir(storage/ledger/)
        → parse each .meta.json
      ↓
      For each ProjectMeta:
        status !== 'COMPLETE'? → skip
        last_updated unparseable? → skip + stderr warning
        ageMs < thresholdMs? → skip (not stale enough)
        ↓ (eligible)
        withLock(store.storageDir, async () => {
          store.readRootIndex()
          store.writeRootIndex({ ...rootIndex, status: 'ARCHIVED' })
            → atomicWriteJson(project-ledger.json)
            → store.writeProjectMeta()   ← synced automatically
              → atomicWriteJson(.meta.json)
        })
        ↓
        archived.push(meta.slug)
        process.stderr.write('[auto-archive] Archived ...')

      Any per-project error → caught, logged to stderr, scan continues
      ↓
      Return archived[]
```

**Key properties:**
- `maxAgeDays === 0` short-circuits before any disk I/O (no `listAllProjects` call).
- Per-project errors are isolated — one corrupted project never aborts the full scan.
- Both `.meta.json` and `project-ledger.json` are updated atomically inside a single `withLock` scope.
- Timer reads `getConfig()` on every tick; changing `auto_archive_days` in the GUI takes effect on the next interval without restarting the server.
- Only `COMPLETE` projects are eligible — `IN_PROGRESS`, `READY`, `BLOCKED`, and already-`ARCHIVED` projects are never touched.
- All output (archived confirmations, skips, errors) goes to `stderr` only.

---

## Flow 14: GUI — Orchestrator Run Log Listing (with Self-Healing)

**Entry Point:** Browser sends `GET /api/projects/:slug/runs` when the project detail page loads.

```
GET /api/projects/:slug/runs
  ↓
gui/server.ts → assertSafeSlug(slug) → handleListRunLogs(slug, logsDir, legacyLogsDir?)
  ↓
src/gui/handlers/run-log-handlers.ts — handleListRunLogs
  assertSafeSlug(slug)   ← throws ApiError NOT_FOUND for empty / '/' / '..'
  migrateOrphanedLogs(logsDir, legacyLogsDir, slug)  ← if legacyLogsDir supplied;
                                                         moves *-{slug}.jsonl files from legacy dir
                                                         into logsDir when logsDir has none; no-op otherwise
  findRunLogs(logsDir, slug)
  ↓
src/gui/log-resolver.ts — findRunLogs
  readdir(logsDir)       ← returns [] if directory absent/unreadable
  filter by suffix "-{slug}.jsonl" (prefix required — exact suffix rejected)
  for each matching filename:
    isRunActive(filePath) ← reads last non-empty JSONL line;
                            active = no terminal action (run_end / run_error);
                            empty file = active; parse error = inactive
  sort descending by filename (lexicographic; timestamp prefix makes this chronological)
  ↓
Self-healing pass (entries at index 1+):
  for each non-newest entry where is_active === true:
    appendFile(filePath, '\n' + JSON.stringify({ action: 'run_error', error: '...healed...', ts: '...' }) + '\n')
    entry.is_active = false
  (failures swallowed — best-effort only; newest run at index 0 is never touched)
  ↓
Return RunLogEntry[]
  [{ filename: '20260325T090000-slug.jsonl', is_active: true  },   ← newest, potentially running
   { filename: '20260324T120000-slug.jsonl', is_active: false },   ← healed if was stale
   { filename: '20260323T100000-slug.jsonl', is_active: false }]   ← completed or healed
```

**Frontend rendering (`views/project-detail.js`):**
- Array is already sorted newest-first by the server
- Assigns chronological run numbers: oldest = #1, newest = #N (index 0 = #N)
- Only index 0 can show a "Running" badge (`is_active` on older entries is ignored client-side as a second defence)
- Timestamp parsed from filename prefix (YYYYMMDDTHHmmss) and formatted via `formatDate()`

**Key properties:**
- Self-healing is idempotent: once a stale file gains a `run_error` closing entry, it will never be re-healed
- Healing runs as a side-effect of the GET — no dedicated endpoint or background job needed
- `logsDir` is the project's ledger storage directory (`{ledger_root}/{slug}/`); logs written there by the orchestrator post-run
- `legacyLogsDir` (optional) is the old flat `orchestrator/logs/` directory — passed by `server.ts` to enable lazy migration of pre-archival runs
- Security: slug validated in both `server.ts` dispatch and handler; filename validated in `readLogEntries` (allowlist + path escape check)

---

## Flow 13: GUI — Paginated Project Listing

**Entry Point:** Browser or client sends `GET /api/projects` (with optional query params)

```
GET /api/projects?page=1&limit=50&status=ACTIVE&search=&sort=last_updated&dir=desc
  ↓
gui/server.ts
  → URLSearchParams.parse(request.url query string)
  → handleListProjects(ledgerRoot, rawParams)
  ↓
gui/api.ts — handleListProjects processing pipeline:

  Step 1: Enrich all projects
    LedgerStore.listAllProjects(ledgerRoot)   ← readdir + .meta.json parse
    For each ProjectMeta (concurrent Promise.all):
      Cache fast-path (WP-006):
        meta.total_work_packages defined AND meta.project_name defined?
          YES → use cached values directly (no disk I/O)
          NO  → readRootIndex() + readManifestFile() → enrich + write cache to .meta.json
    → ProjectSummary[]
  ↓
  Step 2: Search filter (if search param present)
    case-insensitive string.includes() on slug, project_name, repository_name
    → filtered ProjectSummary[]
  ↓
  Step 3: Compute status_counts
    Reduce filtered set (BEFORE status filter) into Record<status, count>
    → e.g. { COMPLETE: 12, IN_PROGRESS: 3, ARCHIVED: 5 }
  ↓
  Step 4: Status filter
    ACTIVE  → exclude only status === 'ARCHIVED'
    ALL     → include everything
    specific value → include only exact status match
  ↓
  Step 5: Sort (by sort+dir params)
    'last_updated' | 'date_created' | 'title' | 'slug' | 'status' | 'done'
    string fields use localeCompare; desc default
  ↓
  Step 6: Paginate
    start = (page - 1) * limit
    projects = sorted.slice(start, start + limit)
    total_pages = Math.max(1, Math.ceil(total / limit))
  ↓
  Return ProjectListEnvelope {
    projects: ProjectSummary[];  // page slice only
    total: number;               // post-filter count
    page: number;
    limit: number;
    total_pages: number;
    status_counts: Record<string, number>;
  }
```

**Param validation (before pipeline runs):**
- `page`: parseInt; NaN or <1 → clamped to 1
- `limit`: parseInt; NaN → 50; 0 → 1; >200 → 200
- `status`: must be in `VALID_STATUS_FILTERS` Set; unknown → 'ACTIVE'
- `sort`: must be in `SORT_FIELDS` Set; unknown → 'last_updated'
- `dir`: must be 'asc' or 'desc'; otherwise → 'desc'
- `search`: trimmed; empty → no filter applied

**Key properties:**
- `status_counts` reflects the search-filtered universe (not the status-filtered page). Supports UI badge counts that show totals per status regardless of active filter.
- Per-project enrichment failures are isolated; one unreadable project never breaks the full response.
- Out-of-range page returns empty `projects[]` with `total` and `total_pages` still correctly set.
- The entire enrichment step runs in memory; pagination is applied last (no streaming).

```
###  Path: `/mcp-server/docs/agents/project-manifest/file-tree.md`

```md
# File Tree

```
mcp-server/
├── .gitignore                   # Gitignore (excludes storage/ledger/ runtime data)
├── .npmrc                       # npm configuration
├── package.json                 # Project metadata and dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── vitest.config.ts             # Vitest test framework configuration
│
├── storage/                     # Runtime-generated data (gitignored except .gitkeep)
│   └── ledger/
│       ├── .gitkeep             # Ensures directory is tracked in version control
│       ├── gui-config.json      # Runtime-generated GUI config (auto_handoff_enabled, max_handoff_depth, ledger_root) — created on first GUI or MCP server start
│       └── {slug}/              # Per-project subfolder — runtime-generated
│           ├── .meta.json       # Project metadata (slug, status, timestamps)
│           ├── .lock            # Lock file for concurrent-write protection
│           ├── project-ledger.json  # Root index
│           ├── WP-001.json      # Work package detail files
│           ├── plan.md          # Archived copy of the project plan (created by ledger_initialize_project; read by GET /api/projects/:slug/plan) — optional; absent when source was missing at init time
│           └── synthesis.md     # Archived copy of the synthesis report (created by ledger_complete_synthesis; optional, absent until synthesis runs and synthesis.md exists in the plan folder)
│
├── gui/                         # GUI server process code
│   ├── api.ts               # REST API route handlers; runner_counts: Record-string-number; handleListProjects normalizes runner to unknown, supports sorting by runner; includes handleListChunks, handleGetChunkFile (chunk endpoints); includes orchestrator lifecycle handlers (WP-008): handleOrchestratorStart, handleGetOrchestratorQueue, handleOrchestratorKill, handleOrchestratorDismiss
│   ├── chunk-renderer.ts    # renderChunksToMarkdown(jsonlContent) — pure JSONL→Markdown renderer; merges AIMessageChunk token fragments by id; groups by namespace; mirrors serialize_messages_to_markdown() output format
│   ├── server.ts            # Standalone Node.js HTTP server (node:http); two-tier routing: matchRoute() handles segment-count-based dispatch (parameter-free routes and GET routes needing signature args), special-case blocks in handleRequest() handle routes needing body parsing (POST /api/config, POST /api/projects/:slug/reset, POST /api/orchestrator/start) or path-parameter extraction (PATCH /api/projects/:slug, POST /api/orchestrator/kill/:id, POST /api/orchestrator/dismiss/:id); serves static files from gui/public/
│   └── public/              # Static assets served by gui/server.ts
│       ├── index.html       # Dashboard SPA shell; nav links: Projects (#/), Insights (#/insights), Orchestrator (#/orchestrator), Configuration (#/config); scripts load in dependency order: api-client → theme → router → utils → views → orchestrator-widgets → orchestrator.js → stale-check → app
│       ├── styles.css       # Full CSS; runner badge block: .badge-runner base class, .badge-runner-orchestrator, .badge-runner-vscode, .badge-runner-claude-code, .badge-runner-unknown with dark-mode overrides; orchestrator widget block: .orchestrator-status-card/header/body/elapsed/pid/progress-summary (OrchestratorWidgets.renderStatusCard), .orchestrator-kill-btn/.orchestrator-dismiss-btn (OrchestratorWidgets.renderKillButton/renderDismissButton — visual delegated to .btn.btn-danger/.btn.btn-secondary), .log-preview-entry (OrchestratorWidgets.renderLogPreview), .orchestrator-cli-reference h4/pre (OrchestratorWidgets.renderCliReference), .orch-status-cell (orchestrator.js queue table), .orch-active-run-section/.orch-cli-kill-hint (views/project-detail.js orchestrator section), .section-title/.btn-icon (general utilities used by orchestrator views); dark-mode overrides for .orchestrator-status-card, .orchestrator-cli-reference, .log-preview-entry
│       ├── api-client.js    # API IIFE; buildQueryString(params) helper used by getProjects
│       ├── theme.js         # Theme IIFE; localStorage key mcp-theme; init() applies saved theme
│       ├── router.js        # Router IIFE; hash-based routing; dispatches '/' → renderProjectList, '/projects/*' → detail/plan/synthesis/WP/run-log views, '/config' → renderConfig, '/insights' → renderInsights, '/orchestrator' → renderOrchestrator; setPolling/clearPolling manage per-view auto-refresh; updateNavActive toggles active class on the matching nav link on each hash change
│       ├── utils.js         # Shared helpers: escapeHtml, formatDate, statusBadge, showLoading, showError
│       ├── app.js           # Bootstrap entry point: Theme.init(); Router.init(); StaleCheck.init()
│       ├── stale-check.js   # StaleCheck IIFE; init() polls API.getServerInfo() immediately then every 30 s; injects .stale-banner into document.body before <header> on stale:true; stops polling after banner; silently continues on network errors
│       ├── views/
│   │   ├── project-list.js    # renderProjectList — status filter, search, sortable columns, archive/unarchive/delete row buttons, pagination, 10s polling; runner filter dropdown (RUNNER_STORAGE key mcp-runner-filter, buildRunnerOptions() dynamically filters runner_counts to count only — fixed: previously hardcoded all 4 types; preserves stale localStorage selections as zero-count entry); runnerBadge() renders .badge.badge-runner.badge-runner-{type} — fixed: previously emitted badge-unknown instead of badge-runner-unknown; runnerLabel() unused — cleanup candidate; sortable Runner column
│   │   ├── project-detail.js  # extractSynopsis, renderPlan, renderSynthesis, renderProjectDetail; STAGE_ABBREV, buildPipelineTrack; showResetModal; archive banner
│   │   ├── work-package.js    # WP_DEFAULT_STAGES, buildWpDetailBar, renderWorkPackageDetail
│   │   ├── config.js          # renderConfig — auto_handoff_enabled, max_handoff_depth, auto_archive_days
│   │   ├── insights.js        # renderInsights — project health stats; 15 s polling
│   │   └── orchestrator.js    # renderOrchestrator — plan path input, preflight checklist (Section A), Start Run button gated on allChecksPassed (Section B), live queue table with 5 s polling via Router._setPolling, per-row expand/collapse inline log preview; cleanup managed via _orchLogPreviewCleanups array; CLI reference card footer (WP-011); renderQueueTable delegates to four closure-scoped helpers: _clearSuccessBanner (removes success banner when queue is non-empty; leaves error banners intact), _buildQueueHtml (builds table HTML string), _bindQueueActions (injects Kill/Dismiss/View-Project buttons and toggle listeners), _mountLogPreviews (starts live log-preview widgets for expanded rows) (WP-006)
│       ├── js/
│   │   └── orchestrator-widgets.js  # OrchestratorWidgets IIFE — shared orchestrator UI components: kill/dismiss row buttons, formatLogAction (maps JSONL entry → human-friendly label; null/undefined-safe; WP-002), renderLogPreview (returns cleanup fn), renderCliReference; depends on API (api-client.js) and escapeHtml (utils.js) (WP-011)
│       └── libs/
│           └── marked.min.js  # Vendored Markdown parser (marked v15.0.12, ~40 KB)
│
├── src/                         # Source code
│   ├── index.ts                 # MCP server entry point and tool registration
│   │
│   ├── gui/                     # Shared GUI/config module
│   │   ├── auto-archive.ts      # Auto-archive service
│   │   ├── config.ts            # Runtime config: GuiConfigSchema, getConfig(), readConfigFromDisk(), writeConfig()
│   │   ├── errors.ts            # Shared ApiError class (avoids circular dep between log-resolver ↔ gui/api.ts)
│   │   ├── log-resolver.ts      # RunLogEntry type; findRunLogs (sorted + self-healing stale runs); readLogEntries; resolveOrchestratorLogsDir; migrateOrphanedLogs
│   │   ├── orchestrator-manager.ts  # Queue mutation (killQueueEntry, dismissQueueEntry), preflight checks, startOrchestrator, getRunStatus, runStatusFilename; re-exports getQueue, all types, QUEUE_FILENAME from queue/ sub-modules for backward compat (WP-005, WP-006, WP-007, WP-A, WP-B)
│   │   ├── queue/               # Run-queue helpers: types, reading, validation, progress resolution, status computation (WP-001, WP-003, WP-004, WP-A, WP-B)
│   │   │   ├── types.ts             # Shared type definitions and QUEUE_FILENAME constant: RawQueueEntry, QueueEntry, KillResult, PreflightResult, StartResult, RunStatus — leaf module, no intra-queue deps beyond compute-effective-status.ts (WP-A)
│   │   │   ├── validate-entry.ts    # Pure isRawQueueEntry() type-guard — extracted from get-queue.ts for direct unit testability; validates all 5 RawQueueEntry rules including whitespace-only slug rejection (.trim().length > 0); no I/O (WP-001 rework, WP-003)
│   │   │   ├── get-queue.ts         # Queue reading: imports isRawQueueEntry from validate-entry.ts; readQueueFile, getProjectLedgerStatus (private); isProcessAlive, readQueueFile, getProjectLedgerStatus (exported for orchestrator-manager.ts); getQueue (public API) (WP-B)
│   │   │   ├── compute-effective-status.ts  # Pure status computation; computeEffectiveStatus(alive, projectExists, hasLogActivity?): EffectiveStatus — 4 priority-ordered transition rules; zero I/O (WP-004)
│   │   │   ├── format-progress-entry.ts  # Pure JSONL-entry → string mapper; no I/O; formatProgressEntry(); empty-string tool_name treated as absent (WP-D)
│   │   │   └── resolve-progress.ts  # ProgressResolution interface + resolveProgress() async resolver; EMPTY_RESOLUTION frozen sentinel; re-exports formatProgressEntry as a convenience barrel (two-level re-export chain: format-progress-entry → resolve-progress → orchestrator-manager) (WP-D)
│   │   └── handlers/
│   │       └── run-log-handlers.ts  # handleListRunLogs (optional legacyLogsDir migration), handleGetRunLog — thin wrappers adding slug validation over log-resolver.ts
│   │
│   ├── schema/                  # Zod schemas and type definitions
│   │   ├── enums.ts             # Status enums derived from shared/workflow-manifest.json
│   │   ├── project-meta.ts      # ProjectMetaSchema / ProjectMeta — per-project .meta.json
│   │   ├── root-index.ts        # RootIndex schema
│   │   ├── validators.ts        # Business rule validators
│   │   ├── workflow-manifest-schema.ts  # Zod schema for shared/workflow-manifest.json
│   │   └── work-package.ts      # WorkPackageDetail schema
│   │
│   ├── storage/                 # File I/O abstractions
│   │   ├── atomic-writer.ts     # Atomic write-to-temp-then-rename
│   │   ├── file-lock.ts         # File locking with proper-lockfile
│   │   └── ledger-store.ts      # Central storage abstraction
│   │
│   ├── tools/                   # MCP tool implementations
│   │   ├── help.ts              # ledger_help
│   │   ├── help-content.ts      # TOOL_HELP: static documentation strings for all 20 MCP tools
│   │   ├── observations.ts      # ledger_add_observation, ledger_add_project_comment
│   │   ├── pipeline.ts          # ledger_start_pipeline, ledger_complete_pipeline, ledger_cancel_pipeline, ledger_update_pipeline_progress
│   │   ├── project-lifecycle.ts # ledger_detect_project, ledger_get_project_status, ledger_initialize_project, ledger_list_projects, ledger_complete_synthesis
│   │   ├── work-package.ts      # WP CRUD tools
│   │   ├── workflow.ts          # Thin aggregator
│   │   ├── workflow-handoff.ts              # ledger_get_handoff_status
│   │   ├── workflow-next-action.ts          # ledger_get_next_action
│   │   └── workflow-next-action-batch.ts    # Batch/collector sub-module
│   │
│   └── utils/                   # Utility functions
│       ├── workflow-helpers.ts  # Shared constants and stateless helpers
│       ├── agent-registry.ts    # Discovers VS Code agent handles and IDs
│       ├── client-info.ts       # Module-level MCP server reference for extracting client info
│       ├── constants.ts         # Shared constants and interfaces; derives role/pipeline constants from shared/workflow-manifest.json; loads AGENT_NAMES (TargetNames, NameMappingEntry) from personas/name-mapping.json
│       ├── if-defined.ts        # ifDefined() type guard helper
│       ├── ledger-root.ts       # resolveLedgerRoot(), projectSlugFromPath(), inferProjectRootFromPlanPath()
│       ├── path-validator.ts    # Project path validation
│       ├── pipeline-maps.ts     # Shared routing constants and utility functions
│       ├── project-reset.ts     # Semi-intelligent project reset
│       ├── read-project-name.ts # Resolves project name from package.json / composer.json / pyproject.toml
│       ├── runner.ts            # classifyRunner(clientInfo) — normalises raw MCP clientInfo.name into a stable RunnerType enum; exports RunnerType, RunnerInfo, ClientInfo types; used by initializeProject to stamp runner metadata on new projects
│       ├── server-version.ts      # Reads MCP server version from package.json
│       ├── timestamp.ts           # Timestamp formatting
│       ├── workspace-versions.ts  # captureWorkspaceVersions() — reads mcpServer, personas, orchestrator versions from disk
│       └── wp-id.ts             # Work package ID formatting (WP-###)
│
└── tests/                       # Test suites
    ├── helpers/                 # Shared test utilities (NEVER write to production storage)
    │   ├── create-temp-store.ts # createTempStore() / cleanupTempStore() helpers
    │   ├── fixtures.ts          # makeWorkPackageDetail(), makePipeline(), makeWorkPackageSummary()
    │   └── test-utils.ts        # injectLedgerDir(), nowFloor()
    │
    ├── gui/                     # GUI and config module tests
    │   ├── api-client.test.ts
    │   ├── stale-check.test.ts  # 10 unit tests for StaleCheck IIFE (jsdom + vm.runInThisContext + fake timers): immediate poll, 30 s interval, banner insertion before <header>, changed-component listing, polling stop after banner, silent error handling
    │   ├── api-reset.test.ts    # Integration tests for handleResetProject (13 tests)
    │   ├── api-wp-overview.test.ts  # Unit tests for handleGetWorkPackageOverview (21 tests)
    │   ├── api.test.ts          # Unit tests for gui/api.ts; includes 6 handleListProjects runner filter tests (WP-005 verification of WP-003 ACs): runner field present and 'unknown' default for projects without stored runner (AC1), runner_counts object shape and values (AC1), runner=orchestrator filter returns only matching projects (AC2), runner_counts unaffected by active runner filter (AC3), runner:'unknown' filter returns projects with no stored runner field (AC4), unrecognized runner query returns empty set without 500 error (AC5), and combined status+runner filter
    │   ├── auto-archive.test.ts # Unit tests for src/gui/auto-archive.ts (14 tests)
    │   ├── client-rendering.test.ts
    │   ├── config.test.ts       # Unit tests for src/gui/config.ts
    │   ├── dialogue-qa.test.ts
    │   ├── handoff-config-integration.test.ts  # Integration: runtime config changes affect buildHandoffResponse
    │   ├── log-resolver.test.ts
    │   ├── api-orchestrator.test.ts  # 23 unit tests for the 4 orchestrator API handlers (WP-008): planPath validation (missing, number, null, non-object body), dryRun forwarding (true/false/default), queue enrichment shape, kill result { killed: boolean }, dismiss void resolution, assertSafeQueueId guard (empty/slash/double-dot rejection)
    │   ├── orchestrator-manager.test.ts  # 77 tests: getQueue() lifecycle transitions (AC-1 through AC-6), formatProgressEntry() (11 event types), progress resolution (WP-005); killQueueEntry()/dismissQueueEntry() lifecycle gates, SIGTERM→SIGKILL flow, TOCTOU ESRCH handling, queue-file removal, lock-file cleanup; PID validation (negative/zero/float rejection) (WP-006); 7 lastAction/logFilename population cases (WP-003 AC-6)
    │   ├── orchestrator-widgets.test.ts  # 41 tests: OrchestratorWidgets functions, all 7 ACs + 7 refined variants; vm.runInThisContext + jsdom, fake timers for renderLogPreview (WP-010)
    │   ├── project-detail-runs.test.ts
    │   ├── queue/               # Unit tests for src/gui/queue/ modules (WP-001, WP-003, WP-004, WP-A, WP-B, WP-C, WP-D)
    │   │   ├── compute-effective-status.test.ts  # 6 pure unit tests: AC-1/2/3 transitions, default hasLogActivity=false, projectExists-always-wins across all 4 alive/hasLogActivity combinations (WP-004)
    │   │   ├── format-progress-entry.test.ts  # Unit tests for formatProgressEntry() (11 event types + empty tool_name WP-D)
    │   │   ├── resolve-progress.test.ts  # 29 unit tests covering all 5 acceptance criteria + 3 edge-case tests (malformed JSONL, all-malformed, 0-byte log) (WP-001, WP-C)
    │   │   └── validate-entry.test.ts  # 17 pure-function unit tests for isRawQueueEntry() across all 5 validation rules: valid entry, null/primitive/object rejection, non-string id/planPath, zero/negative/float pid, empty/whitespace-only/missing expectedSlug, missing/non-string startedAt; no I/O setup (WP-003)
    │   ├── run-log-handlers.test.ts
    │   ├── run-log-server.test.ts
    │   ├── run-log.test.ts
    │   └── security-headers.test.ts
    │
    ├── integration/             # End-to-end workflow tests
    │   ├── auto-handoff.test.ts
    │   └── full-workflow.test.ts
    │
    ├── schema/                  # Schema validation tests
    │   ├── project-archiving-schema.test.ts
    │   ├── project-meta-runner.test.ts  # 10 backward-compatibility tests (WP-005 verification of WP-001 AC5): ProjectMetaSchema and RootIndexSchema accept runner fields when present (orchestrator, vscode, claude-code), accept empty strings for runner_client/runner_version, reject invalid enum values, and parse cleanly without runner fields (legacy fixture and full real-world legacy project-ledger.json simulation)
    │   ├── root-index.test.ts   # RootIndexSchema and WorkPackageSummarySchema tests (20 tests)
    │   ├── validators.test.ts
    │   └── work-package-schema.test.ts  # Zod parse-level tests (24 tests)
    │
    ├── storage/                 # Storage layer tests
    │   ├── ledger-store.test.ts # LedgerStore unit tests
    │   └── project-meta.test.ts
    │
    ├── tools/                   # Tool-level tests
    │   ├── begin-work.test.ts
    │   ├── cancelled-status.test.ts
    │   ├── cascade-reblock.test.ts
    │   ├── claim-guard.test.ts
    │   ├── complete-pipeline-guards.test.ts
    │   ├── enrichment-resilience.test.ts
    │   ├── list-projects.test.ts
    │   ├── meta-enrichment.test.ts
    │   ├── observations.test.ts
    │   ├── pipeline-duration.test.ts
    │   ├── pipeline.test.ts
    │   ├── project-lifecycle.test.ts
    │   ├── rework-circuit-breaker.test.ts
    │   ├── runner-integration.test.ts  # 9 integration tests (WP-005 verification of WP-002 ACs): runner fields in root index response and on disk (AC1), runner fields in .meta.json (AC2), graceful 'unknown' default when getClientInfo() returns undefined (AC3), no runner info written to stdout (AC5); uses vi.mock hoisting to control getClientInfo() return value per test group; covers all four runner types (orchestrator, vscode, claude-code, unknown)
    │   ├── schema-integrity.test.ts
    │   ├── start-pipeline-guards.test.ts
    │   ├── synthesis-terminal.test.ts
    │   ├── version-freshness.test.ts
    │   ├── work-package.test.ts
    │   ├── workflow-batch-actions.test.ts
    │   ├── workflow-handoff.test.ts
    │   ├── workflow-next-action.test.ts
    │   └── workflow-rework-loop.test.ts
    │
    └── utils/                   # Utility function tests
        ├── agent-registry.test.ts
        ├── if-defined.test.ts
        ├── ledger-root.test.ts
        ├── path-validator.test.ts
        ├── pipeline-maps.test.ts
        ├── project-reset.test.ts
        ├── runner.test.ts       # 10 unit tests for classifyRunner() (WP-005 verification of WP-001 ACs): all four output variants (vscode, claude-code, orchestrator, unknown), undefined input without throw, empty-string name, unrecognized client name, case-insensitive substring matching (vscode keyword, Claude uppercase, langchain variants), and raw runner_client/runner_version value preservation
        ├── timestamp.test.ts
        ├── workflow-helpers.test.ts
        ├── workflow-manifest.test.ts  # Structural invariants (34 tests)
        └── wp-id.test.ts
```

---

## Directory Annotations

### `src/schema/`

Centralized data structure definitions using Zod. All schemas are validated at runtime on reads and writes. TypeScript types are inferred from schemas, ensuring type/schema consistency.

### `src/storage/`

File I/O layer with atomicity and locking guarantees. `LedgerStore` is the primary abstraction — all tools should use it rather than reading/writing files directly.

### `src/tools/`

Each file exports a `register(server: McpServer)` function that registers one or more MCP tools. Tools are grouped by functional category (lifecycle, work packages, pipelines, observations, workflow).

The workflow tools are split across four files: `workflow.ts` (thin aggregator), `workflow-next-action.ts` (per-role single-action logic for `ledger_get_next_action`), `workflow-next-action-batch.ts` (batch/collector sub-module), and `workflow-handoff.ts` (`ledger_get_handoff_status`). Shared constants and pure helpers live in `src/utils/workflow-helpers.ts`.

## Generated/Ignored Directories

The following directories are not version-controlled:
- node_modules/ — npm dependencies
- dist/ — TypeScript compilation output
- storage/ledger/{slug}/ — per-project ledger runtime data


```
###  Path: `/mcp-server/docs/agents/project-manifest/tech-stack.md`

```md
# Tech Stack & Patterns

## Runtime & Language

| Component | Version | Notes |
|-----------|---------|-------|
| **Runtime** | Node.js | ESM module system |
| **Language** | TypeScript 5.7.2 | Strict mode enabled |
| **Target** | ES2022 | Node16 module resolution |
| **Package Manager** | npm | Standard Node.js tooling |

---

## Core Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.4 | MCP server implementation and STDIO transport |
| `zod` | ^3.24.1 | Runtime schema validation and type inference |
| `proper-lockfile` | ^4.1.2 | Cross-platform file locking with retry logic |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/node` | ^22.10.5 | Node.js type definitions |
| `@types/proper-lockfile` | ^4.1.4 | Type definitions for proper-lockfile |
| `@vitest/coverage-v8` | ^4.0.18 | V8-based code coverage reporter for vitest |
| `jsdom` | ^29.0.0 | DOM implementation for GUI tests |
| `tsx` | ^4.19.2 | TypeScript execution for development |
| `typescript` | ^5.7.2 | TypeScript compiler |
| `vitest` | ^4.0.18 | Unit and integration testing framework |

---

## Architectural Patterns

### 1. **MCP Server Architecture**

The application is structured as an **MCP (Model Context Protocol) server** that:
- Runs as a standalone process communicating via STDIO
- Registers multiple tools (22 total) that agents can invoke
- Returns structured JSON responses conforming to MCP specification
- Logs diagnostics to `stderr` (never `stdout`, which is reserved for protocol)

**Key Files:**
- `src/index.ts` — Server initialization and tool registration

---

### 2. **Repository Pattern**

`LedgerStore` class provides a **central storage abstraction** with:
- Validated reads (all JSON is parsed and validated with Zod)
- Atomic writes (write-to-temp-then-rename pattern)
- Path management (encapsulates all file path logic)
- Dual-file synchronization (updates both root index and work package atomically)

**Key Files:**
- `src/storage/ledger-store.ts`

---

### 3. **Atomic Write Pattern**

All file writes use the **write-to-temp-then-rename pattern**:
1. Write JSON to `{filePath}.tmp.{pid}`
2. Use `fs.rename()` to atomically replace target file (POSIX semantics)
3. Clean up temp file on error

This ensures readers never see partial writes.

**Key Files:**
- `src/storage/atomic-writer.ts`

---

### 4. **File Locking for Concurrency**

`withLock()` utility provides **distributed file locking**:
- Creates `.ledger.lock` in the storage directory (`store.storageDir`) — never in the plan directory
- Retries lock acquisition (5 retries, 200ms intervals)
- Stale lock detection (10 second timeout)
- Always releases lock in `finally` block

**Key Files:**
- `src/storage/file-lock.ts`

---

### 5. **Schema-First Design**

All data structures are defined as **Zod schemas first**:
- TypeScript types are inferred from schemas (`z.infer<typeof Schema>`)
- Runtime validation on all reads and writes
- Centralized schema definitions in `src/schema/`

**Key Files:**
- `src/schema/work-package.ts`
- `src/schema/root-index.ts`
- `src/schema/enums.ts`
- `src/schema/validators.ts`

---

### 6. **Tool Registration Pattern**

Each tool category has its own module with:
- Zod input schemas for tool parameters
- Async handler functions
- A `register(server: McpServer)` export that registers all tools

**Tool Modules:**
- `project-lifecycle.ts` — Project initialization and status
- `work-package.ts` — Work package CRUD operations
- `pipeline.ts` — Pipeline start/complete operations
- `observations.ts` — Comment and observation tracking
- `workflow.ts` — Thin aggregator; delegates to the three sub-modules below
- `workflow-next-action.ts` — ledger_get_next_action and ledger_get_next_actions (batch) logic
- `workflow-handoff.ts` — ledger_get_handoff_status logic
- `help-content.ts` — Static TOOL_HELP documentation strings (extracted from help.ts)

---

### 7. **GUI Dashboard Server**

The GUI is implemented as a **separate HTTP server process** from the MCP server:
- **Entry point:** `gui/server.ts`, started via `npm run gui`
- **Port:** 3420 (default), configurable via `--port <n>`
- **Transport:** Plain `node:http` — no Express or other HTTP framework dependency
- **Static serving:** Files from `gui/public/` — vanilla HTML/CSS/JS, no build step required
- **Process isolation:** The GUI server and the MCP server (STDIO) run as independent processes. Both share the same ledger root directory.
- The GUI server resolves the ledger root the same way as the MCP server (`resolveLedgerRoot()` / `--ledger-dir`).

**Key Files:**
- `gui/server.ts` — HTTP server, route dispatch, static file serving
- `gui/api.ts` — Pure async handler functions (one per REST endpoint)
- `gui/public/` — Static dashboard assets (no build step)

**Theme / Dark Mode:**
- `styles.css` exposes a `[data-theme="dark"]` attribute block immediately after `:root`, overriding all 8 CSS custom properties. A separate hardcoded-hex overrides section covers badge variants, table hover, banners, health badges, and filter form controls.
- `index.html` contains a synchronous FOUC-prevention `<script>` in `<head>` that applies the saved theme before first paint (defaults to dark; light only if `localStorage` key `mcp-theme` is explicitly `'light'`).
- `app.js` `Theme` IIFE (section 2) manages `localStorage` persistence and wires the `#theme-toggle` button. `Theme.init()` is called before `Router.init()` in the bootstrap sequence.

---

### 8. **Runtime Config Monitoring**

Runtime-adjustable settings are managed via a **module-level singleton cache** backed by `fs.watch()`:
- **Config file:** `{ledgerRoot}/gui-config.json`
- **Schema:** `GuiConfigSchema` in `src/gui/config.ts` (`auto_handoff_enabled`, `max_handoff_depth`, `ledger_root`)
- **Cache:** Module-level `_cache` populated at startup by `readConfigFromDisk()` and kept live by `startConfigWatcher()`
- **`getConfig()`** is always synchronous — reads from memory only, never disk
- **Debounce:** 250ms on the `fs.watch()` callback to suppress Windows duplicate-event noise
- **Fallback:** On watcher error or file parse failure, the cache retains its last known good values — the server continues operating rather than crashing
- **`ledger_root` is read-only:** `writeConfig()` strips `ledger_root` from incoming data; only startup sets it

**Key Files:**
- `src/gui/config.ts` — `GuiConfigSchema`, `getConfig()`, `readConfigFromDisk()`, `writeConfig()`, `startConfigWatcher()`, `stopConfigWatcher()`

---

### 9. **Dual-Caller Store Overload Pattern**

Some internal functions in `src/tools/work-package.ts` must be callable by two different callers:
1. **Top-level MCP tool handlers** — which have a `projectPath: string` but no open store.
2. **Internal callers** — which already hold a `LedgerStore` and must not construct another one (to avoid redundant I/O and potential double-locking).

The pattern uses a **discriminated union** as the last parameter:

```typescript
// Shared signature used by propagateDependencyUnblock and propagateDependencyReblock
function example(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): Promise<void>;
```

A private module helper `resolveStore()` (not exported) encapsulates the disambiguation:

```typescript
function resolveStore(
  projectPath: string,
  ledgerRootOrOpts?: string | { store: LedgerStore }
): LedgerStore {
  if (typeof ledgerRootOrOpts === 'object' && ledgerRootOrOpts !== null) {
    return ledgerRootOrOpts.store;   // ← pre-built store from internal caller
  }
  return new LedgerStore(projectPath, ledgerRootOrOpts);  // ← construct from path
}
```

**When to apply this pattern:** Any function that (a) owns a lock-protected workflow and (b) is called both by top-level tools and by other internal functions that already hold a store. Do not inline the ternary — extract it into a private `resolveXxx()` helper following this convention.

**Key File:** `src/tools/work-package.ts` — `resolveStore()`

---

## Build & Test

| Script | Command | Purpose |
|--------|---------|----------|
| **sync-version** | `npm run sync-version` | Sync version from changelog.md to package.json |
| **predev** | *(auto)* | Runs sync-version before dev |
| **build** | `npm run build` | Compile TypeScript to `dist/` for production use |
| **dev** | `npm run dev` | Run server in development mode with tsx |
| **pretest** | *(auto)* | Runs `node ../scripts/build-personas.js --check` before every test run — exits 1 if any generated persona file is stale, blocking the test run. This is **one of two** enforcement layers: (1) `pretest` fires when running `npm test` from `mcp-server/`; (2) the `.githooks/pre-commit` hook fires on every commit regardless of which sub-project was touched. Run `node scripts/install-hooks.js` once after cloning to activate the hook. |
| **test** | `npm test` | Run all tests once (pretest fires first) |
| **test:watch** | `npm run test:watch` | Run tests in watch mode |
| **check:roles** | `npm run check:roles` | Validate workflow manifest roles via `scripts/check-known-roles.js` |
| **gui** | `npm run gui` | Start the GUI dashboard server (`tsx gui/server.ts`) |

No explicit build step is required for development (tsx handles TypeScript on-the-fly).
For production or CI, run `npm run build` — compilation fails immediately on any type error (`noEmitOnError: true`) and no output is written to `dist/`.

---

## Static Services

The server has **no stateful services**. All state is persisted to JSON files on disk. The server is stateless between tool invocations.

---

### 10. **Manifest-Derived Constants**

Specification-derived constants are loaded from `shared/workflow-manifest.json` at module-load time — no inline literal arrays remain in source:

| Constant | Source field | File |
|----------|-------------|------|
| `AGENT_ROLES` | `roles[].name` | `src/utils/constants.ts` |
| `ORCHESTRATING_ROLES` | `roles[].name` where `orchestrating: true` | `src/utils/constants.ts` |
| `ROLE_IDS` | `roles[].id` | `src/utils/constants.ts` |
| `SPEC_VERSION` | `spec_version` | `src/utils/constants.ts` |
| `PIPELINE_TYPES` | `pipelines.canonical_order` | `src/utils/pipeline-maps.ts` |
| `DEFAULT_PIPELINE_STAGES` | `pipelines.default_stages` | `src/utils/pipeline-maps.ts` |
| `PIPELINE_AGENT_MAP` | `pipelines.agent_map[].pipeline → role` | `src/utils/pipeline-maps.ts` |

Adding or renaming a role, pipeline type, or status value in the manifest propagates automatically to all constants — no parallel edits to source files are required.

**Key Files:**
- `shared/workflow-manifest.json` — single source of truth
- `src/utils/constants.ts` — agent-role and spec-version constants
- `src/utils/pipeline-maps.ts` — pipeline-type and routing constants

---

## Key Conventions

- **ESM-only:** All imports use `.js` extensions (required for Node16 module resolution)
- **Strict TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `noEmitOnError: true`, and `noUnusedLocals: true` in `tsconfig.json` — `noUncheckedIndexedAccess` widens all string-indexed record lookups to `T | undefined`, eliminating a class of silent runtime errors; `noEmitOnError` prevents any JS from being emitted to `dist/` when type errors are present, ensuring the build fails fast rather than producing a partially compiled output; `noUnusedLocals` makes dead imports and unused variables hard compile errors, preventing structural noise from accumulating silently after refactors
- **Pretty JSON:** All JSON files written with 2-space indentation and trailing newline
- **File Naming:** Work package IDs follow the pattern `WP-###` (minimum 3 digits; no upper bound — supports `WP-001` through `WP-9999+`)

```