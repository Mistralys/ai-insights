# Public API Surface

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

When a write is triggered, the write callback also resets `synthesis_generated = false` if `corruptionDetected` is true (i.e. synthesis was flagged prematurely while pending WPs still exist). After the write, `validatePipelineOrdering` runs and emits any out-of-order pipeline timestamps as `project_comments` with `type: 'warning'`, `priority: 'low'`, `agent: 'system'`.

The response JSON also includes a `pipeline_health` sub-object computed by reading all WP detail files:

```typescript
pipeline_health: {
  wps_with_all_stages_pass: number;  // non-CANCELLED WPs with all 4 stages passing
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
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  agent_role: string;
  synthesis_file?: string;  // default: 'synthesis.md'
}) => Promise<MCPResult>
```

Marks synthesis as generated on the root index. Sets `synthesis_generated = true`, resets `auto_handoff_depth` to `0` (per §18.4), and transitions the project to `COMPLETE`. All writes are performed atomically within a single `withLock` callback. Called by the Synthesis agent (or Project Manager) after generating the final report. Copies `synthesis_file` into the centralized storage directory inside the lock scope (best-effort). Response payload includes `archived_documents: string[]` and, conditionally, `archive_skipped: string[]` (omitted when empty).

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

> **WP-005 note:** As of WP-005, all tools (except `ledger_initialize_project`) now accept `cwd_path` directly — passing `cwd_path` to any tool triggers automatic project detection without needing a separate `ledger_detect_project` call. This tool remains available for standalone project detection when needed.

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
}) => Promise<MCPResult>
```

Creates a new work package with auto-generated WP ID. Creates both detail file and root index summary atomically.

- `assigned_to` in the input is **accepted but ignored** — the WP and root index summary always start with `assigned_to: null` (soft-deprecation §9b.1).
- **Initial status** is `READY` if all dependencies are terminal (`COMPLETE` or `CANCELLED`), or `BLOCKED` otherwise.
- **`blocked_by` auto-assignment:** When initial status is `BLOCKED`, `blocked_by` is automatically populated with `{ type: 'dependency', description: '...', blocking_work_package: '<first unmet dep>' }`.
- **Cycle detection:** `hasCycle()` (BFS) is called before creation. If the new WP's dependency chain would form a cycle, the call is rejected with `'Dependency cycle detected: WP X would create a circular dependency.'`
- **Acceptance criteria validation:** Each criterion string is validated — empty strings and whitespace-only strings are rejected.

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
  pipeline_type: 'implementation' | 'qa' | 'code-review' | 'documentation';
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
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
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
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  agent_role: string; // required — see mapping below
}) => Promise<MCPResult>
```

Starts a new pipeline for a work package. The `type` field is validated by a Zod enum — invalid values are rejected at the MCP layer. Validates WP is `IN_PROGRESS` and no duplicate in-progress pipeline exists.

**`agent_role` is required (§52).** Must match the pipeline type’s owner role per `PIPELINE_AGENT_MAP`: `"Developer"` for `implementation`, `"QA"` for `qa`, `"Reviewer"` for `code-review`, `"Documentation"` for `documentation`. **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type and adds a `[PM Override]` marker to the pipeline summary.

**Pipeline ordering (§8.2):** Enforces `implementation` → `qa` → `code-review` → `documentation` order. Checks the **most recent** prerequisite pipeline entry via `.at(-1)` — a historical PASS followed by a subsequent FAIL is treated as unmet. Returns a descriptive error if the prerequisite is absent or not PASS.

**Rework detection:** A rework is detected when either (a) the most recent same-type completed pipeline has `FAIL` status (**direct rework**) or (b) a prerequisite pipeline type was reworked after the last PASS of the current type (**downstream rework**). Auto-cancelled pipelines (`.auto_cancelled === true`) are excluded from rework detection in both cases. When rework is detected, `rework_counts[type]` is incremented.

**Rework circuit breaker:** The effective count is `rework_counts?.[type] ?? 0`. If this value reaches `MAX_REWORK_COUNT` (default: 5, from `workflow-helpers.ts`), the call is rejected with an error guiding the caller to cancel or restructure the WP.

**Revalidation guard:** After rework detection, `checkRevalidationGuard()` is called. If a prior PASS of the prerequisite pipeline has become stale relative to upstream rework, the guard fires and rejects the start with a descriptive explanation.

#### `ledger_complete_pipeline`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
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

Completes the most recent `IN_PROGRESS` pipeline of the specified type. If `handoff_notes` is provided, a structured `HandoffNote` entry is appended to the work package. On PASS, the recipient is determined by `NEXT_AGENT_MAP` (next agent in chain). On FAIL, the recipient is determined by `FAIL_ROUTING_MAP` (routes QA/code-review/implementation failures to Developer; documentation failures to Documentation for self-rework). Sets status, completion timestamp, summary, and optional fields.

**`agent_role` is required (§52).** Must match the pipeline type’s owner role per `PIPELINE_AGENT_MAP`: `"Developer"` for `implementation`, `"QA"` for `qa`, `"Reviewer"` for `code-review`, `"Documentation"` for `documentation`. **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type (PM Override). This field must be explicit because it drives auto-finalize (§WP-006) and PM Override handoff-note identity.

**Lenient input handling (agent-friendly):**
- **`summary`**: Accepts a single string or an array of strings. A bare string is automatically wrapped in a single-element array.
- **`comments[].timestamp`**: Optional. When omitted, the server auto-fills with the current ISO 8601 timestamp.

**Guards (applied in order):**
1. **WP status guard:** Rejects if the work package is not `IN_PROGRESS` (defense-in-depth, checked before role or pipeline lookup).
2. **Agent role guard:** `agent_role` must match the `PIPELINE_AGENT_MAP` owner for the given pipeline `type`. 
   **Exception:** `agent_role: 'Project Manager'` bypasses the role check for any pipeline type. When PM override is active, the handoff note's `from_agent` is set to `'Project Manager (PM Override)'` instead of the standard map value.

**`acceptance_criteria_updates` merge semantics:** Each item is matched by exact `criterion` string. If found, its `met` flag is updated. If **not found** (unknown criterion text), a new `AcceptanceCriterion` entry `{ criterion, met }` is **appended** to the WP's `acceptance_criteria` array.

**Auto-finalize (§WP-006):** When `type: 'documentation'`, `status: 'PASS'`, and `agent_role: 'Documentation'`, the server evaluates all acceptance criteria **after** applying `acceptance_criteria_updates`:
- **All criteria met** — WP is automatically transitioned to `COMPLETE` within the same lock scope. Response payload includes `auto_finalized: true`. `pending_work_packages` is decremented and the root summary is updated. After the lock is released, `propagateDependencyUnblock` is called to transition eligible BLOCKED dependents to READY (§6.3 compliance — see Gotcha 8 in constraints.md for lock-ordering details).
- **Any criterion unmet** — WP remains `IN_PROGRESS`. Response payload includes `auto_finalize_blocked: true` and `unmet_criteria: string[]` listing the unmet criterion texts.
- **FAIL result or non-Documentation `agent_role`** — auto-finalize does not fire; WP status is unchanged.

`ledger_update_work_package_status` remains registered for PM and edge-case use, but the Documentation agent no longer needs to call it after a successful pipeline PASS.

#### `ledger_cancel_pipeline`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  reason: string;
}) => Promise<MCPResult>
```

Cancels the most recent `IN_PROGRESS` pipeline of the specified type by setting its status to `FAIL` and recording the reason as the summary. Throws an error if no `IN_PROGRESS` pipeline of the given type exists. Use this to cancel pipelines that have become stale (detected via `ledger_get_next_action` returning `RESUME_OR_CANCEL`).

#### `ledger_update_pipeline_progress`

```typescript
(args: { 
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
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
  project_path?: string; // fallback — use only if already known from a previous tool response
  cwd_path?: string; // preferred — auto-detects project
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
  agent_role: 'Planner' | 'Project Manager' | 'Developer' | 'QA' | 'Reviewer' | 'Documentation' | 'Synthesis';
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
    agent_name: string;      // The agent display name (e.g. "6 - Documentation v3.5.2")
    agent_id?: string;       // VS Code routing id (e.g. "ledger-6-docs") — omitted when absent from registry
    prompt: string;          // Prompt to pass to the next agent; prefixed with "@{agent_id}\n" when agent_id is present
  };
}
```

**Auto-handoff eligibility** — `auto_handoff` is included only when **all** of the following are true:
1. `auto_handoff_enabled` is `true` in the GUI config (`getConfig().auto_handoff_enabled`)
2. The agent registry is loaded (`isRegistryLoaded()` returns `true`)
3. The next agent has a known handle in the registry
4. Project status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
5. `auto_handoff_depth` in the root index is `< effectiveMaxDepth(root.total_work_packages ?? 0)` — the dynamic ceiling scales with project size per §18.2.1: `max(configMax=50, totalWorkPackages × 20)`, where `configMax` comes from `getMaxHandoffDepth()` (default 50, runtime-configurable via `gui-config.json`)

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
interface ReworkCounts {
  implementation?: number; // Non-negative integer; absent until first rework of that type
  qa?: number;
  'code-review'?: number;
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
  auto_handoff_depth?: number; // Server-managed loop-guard counter; absent/undefined treated as 0
  synthesis_generated?: boolean; // Set to true by ledger_complete_synthesis; absent/false means synthesis not yet done
}

interface WorkPackageSummary {
  work_package_id: string; // WP-### format
  status: WorkPackageStatus;
  assigned_to: string | null; // null when the WP has not yet been assigned to an agent
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
  assigned_to: string | null; // null when the WP has not yet been assigned to an agent
  dependencies: string[];
  blocked_by?: Blocker;
  acceptance_criteria: AcceptanceCriterion[];
  revision: number; // 0-based; new WPs start at 0 (previously started at 1)
  rework_count?: number;  // Legacy scalar — read-only; used only by in-memory migration in readWorkPackage() for documents that pre-date rework_counts. No longer written by production code.
  rework_counts?: ReworkCounts;  // Per-pipeline-type rework map; lazily created on first rework (§16.2)
  status_changed_at?: string;  // ISO 8601 timestamp of the last status transition (§10b.1)
  reset_at?: string;  // ISO 8601 timestamp set by applyProjectReset() on 'reset' actions only. Not set for 'cancel' or 'skip'. Distinguishes reset-recovery events from other status transitions.
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

// Roles that orchestrate the workflow but do not directly execute implementation work.
// Used to derive CLAIMABLE_ROLES in work-package.ts (excludes these roles from the claimable set).
const ORCHESTRATING_ROLES: readonly ['Planner', 'Synthesis'];

// String-literal union type derived from ORCHESTRATING_ROLES.
type OrchestratingRole = typeof ORCHESTRATING_ROLES[number];

// Pattern for valid ledger slugs: must start with a lowercase alphanumeric character,
// followed by zero or more lowercase alphanumeric characters or hyphens. Max length 200.
// Used by LedgerStore.renameSlug() (storage layer) and gui/api.ts (API layer).
const SAFE_SLUG_REGEX: RegExp; // /^[a-z0-9][a-z0-9-]*$/
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
// fresh.synthesis_generated = false inside the write callback, eliminating
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

// Returns all pipeline types that come AFTER the given type in canonical PIPELINE_TYPES order.
// Returns [] for 'documentation' (nothing follows it). Returns [] for unknown types.
// Exported from src/utils/pipeline-maps.ts. Returns a fresh array — safe to mutate.
// Examples: getDownstreamTypes('implementation') → ['qa','code-review','documentation']
//           getDownstreamTypes('code-review')    → ['documentation']
//           getDownstreamTypes('documentation')  → []
function getDownstreamTypes(type: PipelineType): PipelineType[];

// Returns all pipeline types that come BEFORE the given type in canonical PIPELINE_TYPES order.
// Returns [] for 'implementation' (nothing precedes it).
// Exported from src/utils/pipeline-maps.ts. Returns a fresh array — safe to mutate.
// Examples: getUpstreamTypes('documentation') → ['implementation','qa','code-review']
//           getUpstreamTypes('qa')             → ['implementation']
//           getUpstreamTypes('implementation') → []
function getUpstreamTypes(type: PipelineType): PipelineType[];
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
  next_required_stage: string | null;      // first missing stage, or null if all pass
  target_assigned_to: string | null;       // agent for next_required_stage via PIPELINE_AGENT_MAP
  needs_reset: boolean;                    // false for CANCELLED, healthy, BLOCKED, READY WPs
  reason: string;                          // human-readable diagnosis note
  suggested_action: 'reset' | 'skip';
  suggested_reset_criteria: boolean;       // whether to clear AC met-flags on reset
}

export interface ProjectResetDiagnosis {
  project_slug: string;
  current_project_status: string;
  work_packages: WpResetDiagnosis[];
  work_packages_needing_reset: number;
  work_packages_healthy: number;           // healthy + skipped-statuses (BLOCKED, READY, CANCELLED)
  work_packages_skipped: number;           // CANCELLED WPs
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
// the getProjectStatus() tool (WP-003) to compute aggregate pipeline health.
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
// Does NOT read from disk — caller must supply the pre-loaded rootIndex and workPackages.
export function analyzeProjectForReset(
  slug: string,
  rootIndex: RootIndex,
  workPackages: WorkPackageDetail[]
): ProjectResetDiagnosis;

// ── Mutation (async — writes under lock) ────────────────────────────────────

// Applies user-confirmed per-WP decisions atomically inside a single withLock() scope.
// For each WP:
//   'reset'  → wp.status = 'IN_PROGRESS', wp.assigned_to = target_assigned_to,
//              wp.status_changed_at updated, wp.reset_at set to the mutation timestamp;
//              if reset_criteria !== false, all acceptance_criteria[].met = false;
//              blocked_by removed.
//   'cancel' → wp.status = 'CANCELLED', wp.status_changed_at updated. reset_at NOT set.
//   'skip'   → WP file not written.
// Missing entries in `decisions` default to 'skip'.
// Stale-state guard: if wp.status changed since diagnosis was produced, the WP is
// silently skipped (writes to stderr) to prevent clobbering concurrent changes.
// Root index updates (all inside lock): pending_work_packages recomputed,
// status → 'IN_PROGRESS', synthesis_generated → false, auto_handoff_depth → 0,
// project_comment appended with ISO timestamp.
export async function applyProjectReset(
  store: LedgerStore,
  diagnosis: ProjectResetDiagnosis,
  decisions: Record<string, WpDecision>
): Promise<ProjectResetResult>;
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
export function propagateDependencyUnblock(
  projectPath: string,
  completedWpId: string,
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
  // Named export promoted in WP-001; _internal reference kept for test imports.
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
};

export const DEFAULT_CONFIG: GuiConfig;  // { auto_handoff_enabled: true, max_handoff_depth: 50, ledger_root: '' }

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

- `assertSafeSlug(slug: string): void` — applied as the **first statement** in all slug-bearing handlers (`handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument`, `handleGetSynthesisDocument`, `handleResetProject`, `handleGetProjectHealth`, `handleRenameProject`).
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

// Enriched project summary — extends ProjectMeta with WP counters, resolved project name, and repository name.
// Returned by GET /api/projects. Fields default to 0 / null on per-project read failure so one
// bad project never breaks the full response.
export interface ProjectSummary extends ProjectMeta {
  total_work_packages: number;   // from root index; defaults to 0 on read failure
  pending_work_packages: number; // from root index; defaults to 0 on read failure
  project_name: string | null;   // from package.json → composer.json → pyproject.toml; null on failure
  repository_name: string | null; // last path segment of inferProjectRootFromPlanPath(meta.plan_path); null if not detectable
}

// GET /api/projects — returns enriched project summaries from the centralized ledger.
// Each entry extends ProjectMeta with WP counters, a resolved project name, and repository_name.
// Per-project enrichment is concurrent (Promise.all); failures per project are isolated.
// project_name resolution order: manifest file → slug date-strip fallback → meta.title (wins if set).
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
| PATCH | `/api/projects/:slug` | `handleRenameProject` (body parsed inline; placed before POST reset handler) |
| GET | `/api/projects/:slug/work-packages` | `handleListWorkPackages` |
| GET | `/api/projects/:slug/work-packages/:wpId` | `handleGetWorkPackage` |
| GET | `/api/projects/:slug/plan` | `handleGetPlanDocument` |
| GET | `/api/projects/:slug/synthesis` | `handleGetSynthesisDocument` |
| GET | `/api/projects/:slug/health` | `handleGetProjectHealth` |
| DELETE | `/api/projects/:slug` | `handleDeleteProject` |
| GET | `/api/config` | `handleGetConfig` |
| PUT | `/api/config` | `handleUpdateConfig` (body parsed inline) |
| GET | `/api/insights` | `handleGetInsights` |
| POST | `/api/projects/:slug/reset` | `handleResetProject` (body parsed via `readBody()`) |

**Static file serving:** requests not starting with `/api/` are served from `gui/public/` (ESM path via `import.meta.url`). `/` → `index.html`. Unknown paths → 404.

**CORS:** all responses include `Access-Control-Allow-Origin: http://localhost:{port}`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`. OPTIONS preflight → 200 OK.

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
| `styles.css` | CSS custom properties, status badges, tables, cards, forms, loading spinner, error/success banners, comment cards, reset modal |
| `app.js` | Vanilla JS SPA: `API` client, `Router` (hash-based), utilities + 4 view render functions + reset modal (`showResetModal`) |

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

**`styles.css` — Project reset modal classes** (added for WP-004):

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

> **Resolved (WP-003):** `.priority-high/medium/low` hardcoded hex values have been promoted to `:root` CSS custom properties (`--color-priority-high: #e74c3c`, `--color-priority-medium: #f39c12`, `--color-priority-low: #95a5a6`). The `.comment-type` background was updated from `#e2e8f0` to `var(--color-border)`.

> **Resolved (WP-005):** `.comment-type` hardcoded `color: #475569` replaced with `var(--color-text-muted)`, keeping the full colour palette centralized in `:root`.

> **Known debt (low):** `.insights-filters` duplicates `.filter-bar` layout properties. The Reviewer approved retaining `.insights-filters` as a semantic distinction for now. A future cleanup WP should consolidate them into a single utility class.

**`styles.css` — Inline title edit + Repository column classes** (added for WP-003):

| Class | Role |
|-------|------|
| `.page-heading-wrapper` | `inline-flex` container wrapping the project detail `<h1>` and edit button; avoids taking the full row width |
| `.edit-title-btn` | Small pencil (✎) button adjacent to the heading; hidden during edit mode |
| `.title-edit-input` | Inline text input that replaces `<h1>` in edit mode; `font-size:1.5rem` + `font-weight:700` matches the `<h1>` exactly (zero layout shift); `max-width:600px` + `width:40ch` constrains overflow |
| `.title-edit-error` | Inline error message div displayed below the input on API failure; cleared by `exitEdit()` when the user leaves edit mode |
| `.repo-col` | Table data cell for the Repository column in the project list table |

**`app.js` structure:**
- **`API`** — async fetch wrappers for all 13 REST endpoints (throws `{ code, message }` on non-2xx); includes `getPlanDocument(slug)` → `GET /api/projects/:slug/plan`; `getSynthesisDocument(slug)` → `GET /api/projects/:slug/synthesis`; `analyzeProjectReset(slug)` → `POST /api/projects/:slug/reset` with `{ dry_run: true }`; `applyProjectReset(slug, decisions)` → `POST /api/projects/:slug/reset` with `{ dry_run: false, decisions }`; `getProjectHealth(slug)` → `GET /api/projects/:slug/health`; `renameProject(slug, title)` → `PATCH /api/projects/:slug` with `{ title }`
- **`Router`** — hash-based dispatch (`#/`, `#/projects/:slug`, `#/projects/:slug/plan`, `#/projects/:slug/synthesis`, `#/projects/:slug/wp/:wpId`, `#/config`, `#/insights`); the `/plan` and `/synthesis` matches are registered before the generic `/:slug` match to prevent prefix collision; manages `setInterval` polling lifecycle; calls `updateNavActive(path)` on every dispatch
- **Utilities**: `escapeHtml()`, `formatDate()`, `statusBadge()`, `showLoading()`, `showError()`, `updateNavActive(path)`, `extractSynopsis(markdown)`
- **`extractSynopsis(markdown)`** — regex-extracts the content of a `## Summary` section from a Markdown string; returns the trimmed text or `null` if the section is absent or empty
- **`renderProjectList(app)`** — project list table with status filter dropdown + fulltext search input (client-side, combined `statusMatch && textMatch`); columns: **Slug** (date prefix stripped; full slug in `title` attribute tooltip), **Project** (`project_name` or `—`), **Repository** (`repository_name` or `—`; rendered via `<td class="repo-col">`), **% Done** (inline `.progress-bar-track` / `.progress-bar-fill` + percentage, or `—` for 0 WPs), **Status**, **Created**, **Updated**, **Actions**; `searchValue` and `filterValue` are closure-scope state that survive the 10-second poll-triggered re-render cycle; `applyFilter()` reads `data-slug`, `data-name`, and `data-repo` attributes off `<tr>` elements (full slug + raw project name + repository name, all lowercased for case-insensitive match); `data-repo` is set to `escapeHtml(p.repository_name || '')` on the `<tr>` element; em-dash fallback uses `\u2014` Unicode escape; delete button (COMPLETE only, `confirm()` dialog)
- **`renderProjectDetail(app, slug)`** — fetches project and plan document concurrently via `Promise.all`; `getPlanDocument` failure is absorbed (`.catch(() => null)`) so the detail page always renders; if the plan has a `## Summary` section, injects a `.plan-synopsis` card with a **View full plan →** link above the Work Packages table; if `project.synthesis_generated === true`, renders a `.synthesis-link-row` with a **View synthesis →** link (driven by the flag alone — no extra HTTP call); **title display:** `displayTitle = (meta.title && meta.title.trim()) ? meta.title : slug` — used for both the `<h1>` heading and breadcrumb; **inline title edit:** heading is wrapped in `.page-heading-wrapper` (inline-flex) with an adjacent `.edit-title-btn` pencil button (✎); click pencil → replaces `<h1>` with `<input class="title-edit-input">` pre-filled with current title, auto-focused; Enter or blur triggers `doSave()` which calls `API.renameProject(slug, newTitle)` and updates the heading and breadcrumb on success; Escape triggers `exitEdit()` without touching the API; errors displayed in a `.title-edit-error` div (created once via `getElementById` + `createElement` to prevent duplicates on rapid retries); `inputDone` flag prevents blur+Enter double-save race; error path resets `inputDone = false` to permit retry; `currentTitle` is kept in sync with the last saved value so re-entering edit mode shows the latest title; project header (includes **Reset Project** button) + WP summary table (clickable rows) + Project Comments section (sorted newest-first; each card shows agent, `.comment-type` badge, priority left-border accent, timestamp, and note; incident entries render `context` key/value pairs in a `.comment-context` sub-section; renders 'No comments yet.' when `project_comments` is empty)
- **`showResetModal(slug, diagnosis)`** — builds and renders the reset confirmation modal from a `ProjectResetDiagnosis` object; features: per-WP diagnosis rows (collapsed by default, expand/collapse toggle), pipeline stage badges (`.reset-stage-present`/`.reset-stage-missing`), action radio buttons pre-selected per `suggested_action`, reset-criteria checkbox (visible only when Reset is selected, pre-checked from `suggested_reset_criteria`), bulk controls (Reset All Broken / Skip All via `refreshRadios()`), live summary footer updated on every change (`updateSummary()` → `buildSummary()`), Apply Reset button disabled when 0 WPs have an action; CANCELLED WPs rendered non-interactive with `.reset-wp-cancelled`; apply success path: closes modal via `closeModal()`, shows success toast, calls `renderProjectDetail()` to refresh data; close paths: × button, Cancel button, backdrop click (`e.target === overlay` guard)
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
// Falls back to 50 if the config module has not yet been initialized.
export function getMaxHandoffDepth(): number;

// Returns the effective maximum auto-handoff depth, scaled by project size per §18.2.1.
// effectiveMax = max(configMax, totalWorkPackages × 20), where configMax defaults to getMaxHandoffDepth() (50).
// This ensures larger projects don't hit the ceiling prematurely:
//   effectiveMaxDepth(0)  → 50   (0 × 20 = 0 < 50, floor applies)
//   effectiveMaxDepth(1)  → 50   (1 × 20 = 20 < 50, floor applies)
//   effectiveMaxDepth(5)  → 100  (5 × 20 = 100 > 50)
// The optional configMax parameter allows test code to inject a fixed value without
// mocking the config singleton.
export function effectiveMaxDepth(totalWorkPackages: number, configMax?: number): number;

// Returns true ONLY if the most recent non-auto-cancelled pipeline of pipelineType has FAIL status.
// Auto-cancelled pipelines (auto_cancelled: true) are filtered out before selecting the most recent entry.
export function isMostRecentPipelineFail(pipelines: Pipeline[], pipelineType: string): boolean;

// Returns true if a pipeline is IN_PROGRESS and was started more than 24 hours ago.
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
// Functionally identical to hasDependencyBlocked; kept as a separate export for call-site clarity.
export function isBlockedByDependencies(wp: WorkPackageDetail): boolean;

// Returns true when the WP is classified as blocked by dependencies using the canonical §21.54
// metadata-based check: wpDetail.status === 'BLOCKED' && (blocked_by == null || blocked_by.type === 'dependency').
// Functionally identical to isBlockedByDependencies; kept as a separate export for call-site clarity.
export function hasDependencyBlocked(wpDetail: WorkPackageDetail): boolean;

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
// Exported from src/utils/workflow-helpers.ts.
export function checkRevalidationGuard(
  pipelines: Pipeline[],
  pipelineType: PipelineType,
  prerequisite: PipelineType,
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
// Project Manager next-action computation. Implements the 5-priority algorithm from §14.1.2.
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
//   P4 WAIT              — no actionable items found.
// Note: dependency-blocked WPs (blocked_by.type === 'dependency' or absent blocked_by) are
// explicitly excluded from UNBLOCK_WP and fall through to REPAIR_ORPHAN_BLOCKED.
export function getProjectManagerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Synthesis-specific action for when project is still in progress (not all WPs complete).
// Returns a static WAIT response. Extracted from the switch case inline literal for
// consistency with all other role action helpers.
function getSynthesisAction(): ActionResult;

// Developer-specific next-action computation. Implements the 7-priority per-WP algorithm from §14.2.
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
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts.qa ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — rework_counts.implementation ≥ MAX_REWORK_COUNT.
//   P2 RESUME_OR_CANCEL                 — stale QA pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale QA pipeline (isActivePipeline = true).
//   P4 RUN_QA (re-engagement)           — at least one prior QA pipeline (excl. auto-cancelled)
//                                         AND hasNewUpstreamPassSince('implementation','qa')=true.
//   P5 WAIT_FOR_REWORK                  — most recent QA pipeline is FAIL and P4 guard is false.
//   P6 RUN_QA (first-run)               — most recent implementation is PASS, no QA pipeline.
//   P7 CLAIM_WP                         — READY WP assigned to QA with dependencies satisfied.
//   Fallback WAIT.
export function getQaAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Reviewer-specific next-action computation. Mirror of QA for §14.4 (code-review pipeline).
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts['code-review'] ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — rework_counts.implementation OR rework_counts.qa
//                                         ≥ MAX_REWORK_COUNT (checks BOTH upstream types).
//   P2 RESUME_OR_CANCEL                 — stale code-review pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale code-review pipeline.
//   P4 RUN_REVIEW (re-engagement)       — at least one prior code-review pipeline (excl. auto-cancelled)
//                                         AND hasNewUpstreamPassSince('qa','code-review')=true.
//   P5 WAIT_FOR_REWORK                  — most recent code-review pipeline is FAIL and P4 guard is false.
//   P6 RUN_REVIEW (first-run)           — most recent QA is PASS, no code-review pipeline.
//   P7 CLAIM_WP                         — READY WP assigned to Reviewer with dependencies satisfied.
//   Fallback WAIT.
export function getReviewerAction(rootIndex: RootIndex, store: LedgerStore, preloadedWpDetails?: WorkPackageDetail[]): Promise<ActionResult>;

// Documentation-specific next-action computation. Implements the 7+1b per-WP algorithm from §14.5.
// Evaluates each eligible IN_PROGRESS or READY WP (skipping BLOCKED and dependency-blocked WPs):
//   P1 BLOCK_FOR_REWORK_LIMIT           — rework_counts.documentation ≥ MAX_REWORK_COUNT.
//   P1b WAIT_FOR_UPSTREAM_REWORK_LIMIT  — any of rework_counts.implementation|qa|'code-review'
//                                         ≥ MAX_REWORK_COUNT (checks all three upstream types).
//   P2 RESUME_OR_CANCEL                 — stale documentation pipeline.
//   P3 CONTINUE_PIPELINE                — active non-stale documentation pipeline.
//   P4 REWORK (self)                    — most recent documentation is FAIL AND
//                                         !hasNewUpstreamPassSince('code-review','documentation')
//                                         (guard prevents REWORK from shadowing a fresh WRITE_DOCS cycle).
//   P5 FINALIZE_WP                      — documentation PASS, all acceptance_criteria.met===true,
//                                         AND freshness: doc completed_at ≥ latest impl started_at.
//                                         Replaces the former non-spec MARK_COMPLETE action.
//   P5b UPDATE_CRITERIA                 — documentation PASS, freshness passes, but at least one
//                                         criterion has met!==true. Prompt agent to update criteria.
//   P6 WRITE_DOCS                       — most recent code-review is PASS and no documentation
//                                         pipeline exists OR hasNewUpstreamPassSince('code-review','documentation')=true.
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
// Handoff computation functions (one per agent role).
// All functions receive the full WP list plus optional projectPath and store for dep-blocked routing.
// Each function is async and returns a Promise<HandoffResult>.

// getPlannerHandoff: returns READY_FOR_PM when no WPs exist (signals PM to begin task decomposition).
export async function getPlannerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getDeveloperHandoff (§5.1): short-circuit priority order:
//   1. Temporal guard — for each non-terminal non-dep-blocked WP: if the most recent downstream
//      pipeline (qa or code-review) is FAIL AND hasDownstreamReengagedSince('implementation') = true
//      → IN_PROGRESS (Developer must rework; downstream has re-engaged since last impl PASS).
//   2. Needs QA — for each non-dep-blocked WP: PASS impl exists AND
//      hasNewUpstreamPassSince('implementation','qa') = true → READY_FOR_QA.
//   3. All terminal — all WPs COMPLETE or CANCELLED → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the temporal guard in source order; safe because activeWps
//      is empty when all WPs are terminal, which would cause the guard to return READY_FOR_QA
//      incorrectly. The guard must run on non-empty activeWps only.
//   4. Active work — any WP is IN_PROGRESS with assigned_to === 'Developer' → IN_PROGRESS.
//   → WAIT
export async function getDeveloperHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getQaHandoff (§5.2): short-circuit priority order:
//   1. Re-engagement (BEFORE FAIL) — most recent QA is FAIL AND
//      hasNewUpstreamPassSince('implementation','qa') = true → IN_PROGRESS (re-engage QA).
//   2. FAIL short-circuit — most recent QA is FAIL (step 1 guard false) → READY_FOR_DEVELOPER.
//   3. READY_FOR_REVIEW — non-terminal WPs where PASS QA exists AND
//      hasNewUpstreamPassSince('qa','code-review') = true; dep-blocked routing applies.
//   4. All terminal → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the re-engagement and FAIL short-circuit checks in source
//      order (lines 484-487 of workflow-handoff.ts). Added (WP-005) to match the same guard
//      in getDeveloperHandoff. wpDetails.length > 0 precondition prevents Array.every()
//      vacuous truth on an empty array.
//   5. IN_PROGRESS assigned to QA → IN_PROGRESS.
//   → WAIT
export async function getQaHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getReviewerHandoff (§5.3): mirror of getQaHandoff for code-review pipelines:
//   1. Re-engagement (BEFORE FAIL) — most recent code-review is FAIL AND
//      hasNewUpstreamPassSince('qa','code-review') = true → IN_PROGRESS.
//   2. FAIL short-circuit — most recent code-review is FAIL (step 1 guard false) → READY_FOR_QA.
//   3. READY_FOR_DOCUMENTATION — non-terminal WPs where PASS code-review exists AND
//      hasNewUpstreamPassSince('code-review','documentation') = true; dep-blocked routing applies.
//   4. All terminal → READY_FOR_SYNTHESIS.
//      NOTE: this check precedes the re-engagement and FAIL short-circuit checks in source
//      order (lines 671-674 of workflow-handoff.ts). Added (WP-005) to match the same guard
//      in getDeveloperHandoff. wpDetails.length > 0 precondition prevents Array.every()
//      vacuous truth on an empty array.
//   5. IN_PROGRESS assigned to Reviewer → IN_PROGRESS.
//   → WAIT
export async function getReviewerHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getDocumentationHandoff (§5.4): §14.5 priority — ready-for-docs BEFORE self-rework:
//   1. Ready-for-docs — non-terminal WPs where PASS code-review exists AND
//      (no documentation pipeline yet OR hasNewUpstreamPassSince('code-review','documentation') = true)
//      → IN_PROGRESS (new docs or re-engagement; this step precedes FAIL to avoid FAIL shadowing).
//   2. FAIL self-rework — most recent documentation is FAIL (step 1 guard false)
//      → IN_PROGRESS (Documentation self-reworks; never forwarded to Developer).
//   3. allDocsPassed — all non-dep-blocked WPs have PASS documentation:
//        non-empty unblocked → READY_FOR_SYNTHESIS; all dep-blocked → WAIT.
//   4. wpsNotYetReviewed remain — dep-blocked routing:
//        not all dep-blocked → READY_FOR_REVIEW; all dep-blocked → READY_FOR_SYNTHESIS.
//   → WAIT
export async function getDocumentationHandoff(wpDetails: WorkPackageDetail[], projectPath?: string, store?: LedgerStore): Promise<HandoffResult>;

// getProjectManagerHandoff (§5.5): steps applied to full WP list:
//   1. Non-dependency blockers — any WP is BLOCKED with technical/external/decision blocker
//      → IN_PROGRESS (PM must intervene; dependency-blocked WPs fall through).
//   2. READY WPs — readyStatusForAgent(wp.assigned_to) routes to READY_FOR_QA,
//      READY_FOR_DEVELOPER, or READY_FOR_SYNTHESIS (private helper, not exported).
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
//     prompt: string,               // Project path prompt, prefixed with "@{agent_id}\n" when agent_id is present
//   }
//
// agent_id is resolved via getAgentId(nextAgent) and omitted (not set to null) when the
// registry has no id for the next agent, ensuring clean JSON serialization.
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
