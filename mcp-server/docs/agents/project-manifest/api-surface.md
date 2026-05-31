# Public API Surface

This document lists **public constructors, properties, and method signatures** for all exported classes, functions, and types. Implementation details are omitted.

---

## MCP Tools (26 Total)

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
- **`action: INVOKE_AGENT` responses**: When the embedded `handoff_status` contains an `auto_handoff` entry, the action is **promoted from `WAIT` to `INVOKE_AGENT`**. This means the current agent's work is complete and it should immediately invoke the next agent using `auto_handoff.prompt`. Distinction: `WAIT` = genuinely blocked/waiting; `INVOKE_AGENT` = work complete, invoke next agent now. The promotion is performed by `embedHandoffStatusInWait()` in `src/tools/workflow-next-action-batch.ts`.

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

### Knowledge Tools

#### `ledger_add_insight`

```typescript
(args: {
  scope: 'global' | 'repository';  // "global" for cross-repository, "repository" for repository-scoped
  repository_name?: string;         // Required when scope is "repository". Alphanumeric, hyphens, underscores only. "global" is reserved.
  title: string;
  content: string;
  category: string;                 // e.g. "architecture", "testing", "workflow", "security"
  tags: string[];
  source?: string;                  // Defaults to '' if omitted
  confidence?: number;              // 0–1 float; defaults to 1 if omitted
}) => Promise<MCPResult>
```

Adds a new insight to the knowledge store. Delegates to `KnowledgeStoreManager.addInsight()`.

- **`scope: 'global'`** — stored in `global-insights.json` (cross-repository knowledge).
- **`scope: 'repository'`** — stored in `{repository_name}-insights.json`; `repository_name` is required. Returns `isError: true` if `repository_name` is absent. The name `"global"` is reserved and cannot be used as a `repository_name`.
- **Response:** Returns the full `Insight` object with an additional `formatted_id` field (e.g. `"KN-0001"`). The `formatted_id` and numeric `id` are **per-store only** — not globally unique across global and repository stores. If a global and a repository store both contain an insight with `id: 1`, their `formatted_id` values will be identical.

#### `ledger_search_insights`

```typescript
(args: {
  query: string;                       // Case-insensitive substring match against title, content, and tags
  scope?: 'global' | 'repository';     // Optional. Filter by scope.
  category?: string;                   // Optional. Filter by category.
  tags?: string[];                     // Optional. Filter to insights containing ALL specified tags (AND semantics).
  repository_name?: string;            // Optional. Restrict search to a specific repository store.
  limit?: number;                      // Optional. Maximum results to return.
}) => Promise<MCPResult>
```

Searches insights for the query string (case-insensitive substring match against `title`, `content`, and `tags`). Returns an array of matching `Insight` objects, each augmented with `formatted_id`. Returns an empty array when no matches are found. Store selection follows the `_loadInsights()` store-selection table in the `KnowledgeStoreManager` section.

**Tags filter (AND semantics):** When `tags` is provided, only insights containing all specified tags are returned.

#### `ledger_list_insights`

```typescript
(args: {
  scope?: 'global' | 'repository';     // Optional. Filter by scope.
  category?: string;                   // Optional. Filter by category.
  tags?: string[];                     // Optional. Filter to insights containing ALL specified tags (AND semantics).
  repository_name?: string;            // Optional. Restrict to a specific repository store.
  limit?: number;                      // Optional. Maximum results to return.
  offset?: number;                     // Optional. Skip this many results (pagination). Default: 0.
}) => Promise<MCPResult>
```

Lists insights with optional filters and pagination. Filter application order: store selection → category → tags → offset → limit. Returns each `Insight` augmented with a `formatted_id` field.

#### `ledger_update_insight`

```typescript
(args: {
  id: number;                         // Numeric ID as returned in the id field of a previous response
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];                    // Replaces the tags array
  source?: string;
  confidence?: number;                // 0–1 float
  superseded_by?: number;             // Numeric ID of the insight that supersedes this one
},
filter?: {             // Optional scope filter — restricts which store is searched
  scope?: 'global' | 'repository';
  repository_name?: string;
}) => Promise<MCPResult>
```

Updates an existing insight. Delegates to `KnowledgeStoreManager.updateInsight()`. Immutable fields: `id`, `scope`, `repository_name`, `created_at`. Sets `updated_at` on success.

- **Scope filter:** Pass `scope` and/or `repository_name` to restrict which store is searched. When `scope: 'global'` is set only `global-insights.json` is searched; when `scope: 'repository'` + `repository_name` are set only `{repository_name}-insights.json` is searched. Prevents accidental global-insight mutation when the same numeric `id` exists in multiple stores.
- **Without filter:** All stores are searched in alphabetical order (`_enumerateStorePaths()`). `global-insights.json` sorts before `{repository_name}-insights.json`, so a global insight is updated before any repository insight with the same `id`. Use the scope filter when disambiguation is needed.
- **`formatted_id` in response:** Store-scoped — not globally unique. See `ledger_add_insight` for details.
- **Error:** Returns `isError: true` if no insight with the given `id` exists in the filtered stores.

---

## GUI API — Knowledge Endpoints

These handler functions are exported from `gui/api-knowledge.ts` (extracted from `gui/api.ts` in WP-003) and called by the HTTP server in `gui/server.ts`. They sit between the HTTP request and the `KnowledgeStoreManager` storage layer.

> **Route wiring note:** All knowledge handlers (`handleListKnowledge`, `handleUpdateKnowledge`, `handleDeleteKnowledge`, `handlePromoteKnowledge`, `handleMoveKnowledge`) are implemented in `gui/api-knowledge.ts`, tested, and registered as HTTP routes in `server.ts`, which imports them from `./api-knowledge.js`.

> **`handlePromoteKnowledge` / `handleMoveKnowledge` wiring:** Both handlers delegate to the atomic `KnowledgeStoreManager.moveInsight()` method (introduced in WP-002). The old add→delete compose logic is fully removed. The returned insight has a **different numeric ID** (assigned by the target store's `next_id` counter) — the original ID is no longer valid after a promote or move. Frontend consumers that need to track a moved insight must capture the pre-operation ID before calling promote/move and match by that ID, not by the new ID returned in the response.

### HTTP Route Table

The five knowledge endpoints registered in `gui/server.ts`, grouped by dispatch tier:

**Tier 1 — body-free routes (dispatched via `matchRoute()`)**

| Method | Path | Query Parameters | Return Shape | Error Codes |
|--------|------|-----------------|--------------|-------------|
| `GET` | `/api/knowledge` | `scope`, `category`, `tags` (comma-separated), `repository_name`, `query`, `limit`, `offset` | HTTP 200 `{ data: Insight[] }` | 400 (invalid/unrecognised scope — throws VALIDATION_ERROR; omitting scope returns all insights) |
| `DELETE` | `/api/knowledge/:id` | `scope` (required), `repository_name` (required when `scope=repository`) | HTTP 204 No Content | 400 (non-integer/zero/float id; missing/invalid scope; missing repository_name), 404 (insight not found) |
| `POST` | `/api/knowledge/:id/promote` | `scope` (required, must be `"repository"`), `repository_name` (required when `scope=repository`) | HTTP 200 `{ data: Insight }` (new global insight — ⚠ new ID, see below) | 400 (non-integer/zero/float id; scope not `"repository"`; missing repository_name), 404 (insight not found) |

**Tier 2 — body-parsing routes (handled as special cases in `handleRequest()`)**

| Method | Path | Request Body | Return Shape | Error Codes |
|--------|------|-------------|--------------|-------------|
| `PATCH` | `/api/knowledge/:id` | `KnowledgeUpdateBodySchema` — `scope` (required), `repository_name`?, `title`?, `content`?, `category`?, `tags`?, `source`?, `confidence`?, `superseded_by`? | HTTP 200 `{ data: Insight }` (updated insight) | 400 (non-integer/zero/float id; unknown body fields; type mismatches; missing scope), 404 (insight not found), 413 (body > 1 MiB) |
| `POST` | `/api/knowledge/:id/move` | `KnowledgeMoveBodySchema` — `source_scope` (required), `source_repository_name`? (required when `source_scope=repository`), `repository_name` (required, destination) | HTTP 200 `{ data: Insight }` (new target insight — ⚠ new ID) | 400 (non-integer/zero/float id; invalid body; missing source_repository_name; source === destination), 404 (insight not found), 413 (body > 1 MiB) |

**Notes:**
- `:id` must be a positive integer. Float strings (`"1.5"`), zero (`"0"`), and non-numeric strings are rejected with HTTP 400.
- Body-parsing routes enforce a 1 MiB body size limit (`MAX_BODY_BYTES`). Exceeding it returns HTTP 413.
- All routes return `application/json`. Errors follow `{ error: { code: string, message: string } }` shape.
- CORS is locked to `http://localhost:{port}` (same port as the server).
- `GET /api/knowledge` validates `scope` via `InsightScope.safeParse()` — unrecognised or invalid values throw `VALIDATION_ERROR` (HTTP 400). Omitting `scope` (undefined) means "no filter" and returns all insights (always allowed).
- **Search with tag-filter and pagination:** When `query` is supplied, `tags`, `limit`, and `offset` are forwarded to `searchInsights()` — full-text search, tag filtering (AND semantics), and pagination can be combined in a single `GET /api/knowledge` call.
- **`repository_name` validation across all five knowledge handlers (RESOLVED):** All five knowledge handlers validate `repository_name` against `SLUG_REGEX` at the handler level, throwing `VALIDATION_ERROR` (HTTP 400) for any malformed slug value. `handleDeleteKnowledge`, `handlePromoteKnowledge`, and `handleMoveKnowledge` validate `repository_name` after the presence check (WP-004); `handleUpdateKnowledge` validates via `KnowledgeUpdateBodySchema` Zod parsing; `handleListKnowledge` validates the optional `repository_name` query parameter before forwarding to the storage layer. The previous HTTP 500 fallback through the storage-layer `_validateSlug()` guard no longer applies for any of these handlers.

### `KnowledgeUpdateBodySchema`

```typescript
// Exported Zod schema for PATCH /api/knowledge/:id request bodies.
// `.strict()` rejects unknown keys — prevents callers from setting immutable fields (id, created_at, …).
// `superseded_by` accepts null to support field-clearing semantics; the handler maps null → undefined
// before forwarding to KnowledgeStoreManager.updateInsight().
export const KnowledgeUpdateBodySchema: z.ZodObject<{
  scope: typeof InsightScope;                              // Required: 'global' | 'repository'
  repository_name?: z.ZodOptional<z.ZodString>;           // Required when scope === 'repository'
  title?: z.ZodOptional<z.ZodString>;
  content?: z.ZodOptional<z.ZodString>;
  category?: z.ZodOptional<z.ZodString>;
  tags?: z.ZodOptional<z.ZodArray<z.ZodString>>;
  source?: z.ZodOptional<z.ZodString>;
  confidence?: z.ZodOptional<z.ZodNumber>;                // 0–1 float
  superseded_by?: z.ZodOptional<z.ZodNullable<z.ZodNumber>>; // null clears the field; undefined omits it
}>;
```

### `handleListKnowledge()`

```typescript
// GET /api/knowledge
// Lists (or searches) knowledge insights.
//
// Both `scope` and `repository_name` are validated at the handler level:
//   - `scope` via InsightScope.safeParse() — unrecognised non-undefined values throw VALIDATION_ERROR
//   - `repository_name` against SLUG_REGEX — malformed values throw VALIDATION_ERROR (HTTP 400)
//
// See the comprehensive comment block in the full type-declaration section for routing logic,
// query-mode behaviour, and pagination details.
export async function handleListKnowledge(
  ledgerRoot: string,
  params?: KnowledgeListParams
): Promise<Insight[]>
```

### `handleUpdateKnowledge()`

```typescript
// PATCH /api/knowledge/:id
// Updates an existing insight identified by its numeric ID.
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings (e.g. "0", "1.5", "2.0" all rejected)
//   - body validated via KnowledgeUpdateBodySchema.safeParse() — throws VALIDATION_ERROR
//     for unknown fields or type mismatches (.strict() enforced)
//
// `superseded_by: null` in the body is mapped to `undefined` before the updateInsight() call,
// causing the storage layer to remove the field from the stored insight.
//
// Scope disambiguation: `scope` and `repository_name` from the body are passed as the filter
// parameter to KnowledgeStoreManager.updateInsight() — restricts the search to the correct
// store and prevents accidental cross-scope updates when the same numeric id exists in
// multiple stores.
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, unknown body fields, type mismatches
//   NOT_FOUND        — no insight with the given id in the specified scope
//
// @param ledgerRoot  Absolute path to the central ledger root.
// @param rawId       Raw id string from the URL parameter (e.g. "42").
// @param body        Parsed request body (any shape — validated here).
// @returns The updated Insight.
export async function handleUpdateKnowledge(
  ledgerRoot: string,
  rawId: string,
  body: unknown
): Promise<Insight>
```

### `handleDeleteKnowledge()`

```typescript
// DELETE /api/knowledge/:id
// Deletes an existing insight identified by its numeric ID.
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings. ID validation runs BEFORE scope validation;
//     when both are invalid the caller receives a VALIDATION_ERROR for the id.
//   - scope (query parameter) required; validated via InsightScope.safeParse() —
//     throws VALIDATION_ERROR when absent or not 'global' | 'repository'
//   - repository_name (query parameter) required when scope === 'repository';
//     throws VALIDATION_ERROR when absent
//   - repository_name validated against SLUG_REGEX after the presence check (WP-004);
//     throws VALIDATION_ERROR for malformed slugs (e.g. '../evil', 'has spaces')
//
// Scope disambiguation: `scope` and `repository_name` are passed as the filter to
// KnowledgeStoreManager.deleteInsight(), restricting deletion to the correct store.
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, missing/invalid scope, missing repository_name,
//                      malformed repository_name (fails SLUG_REGEX)
//   NOT_FOUND        — no insight with the given id in the specified scope
//
// @param ledgerRoot      Absolute path to the central ledger root.
// @param rawId           Raw id string from the URL parameter (e.g. "42").
// @param scope           Required scope query parameter ('global' or 'repository').
// @param repository_name Required when scope is 'repository'.
// @returns null — consistent with other DELETE handlers.
export async function handleDeleteKnowledge(
  ledgerRoot: string,
  rawId: string,
  scope: string | undefined,
  repository_name?: string
): Promise<null>
```

### `handlePromoteKnowledge()`

```typescript
// POST /api/knowledge/:id/promote
// Promotes a repository-scoped insight to global scope.
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings.
//   - scope (query parameter) required; must be "repository". Passing scope="global" throws
//     VALIDATION_ERROR ("Insight is already global and cannot be promoted.").
//   - repository_name (query parameter) required when scope is "repository"; throws VALIDATION_ERROR
//     when absent.
//   - repository_name validated against SLUG_REGEX after the presence check (WP-004);
//     throws VALIDATION_ERROR for malformed slugs (e.g. '../evil', 'has spaces').
//
// Delegates to KnowledgeStoreManager.moveInsight(id, { scope: 'repository', repository_name }, 'global')
// — atomic cross-store read-modify-write inside a single withLock(knowledgeDir()) span.
// The old add→delete two-step compose is fully removed.
//
// The returned insight is the newly created global copy — it has a different numeric ID
// (assigned by the global store's next_id counter).
//
// ⚠ ID-change semantics: the returned insight's `id` is NOT the same as the pre-promote
// repository-scoped insight's `id`. The global store assigns a new `next_id`-based ID.
// Frontend consumers that need to track which insight was promoted must capture the
// original ID before calling promote and match by pre-promote ID — not by the new ID
// returned in the response.
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, missing/invalid scope, scope is "global",
//                      missing repository_name, malformed repository_name (fails SLUG_REGEX)
//   NOT_FOUND        — no insight with the given id in the specified repository scope
export async function handlePromoteKnowledge(
  ledgerRoot: string,
  rawId: string,
  scope: string | undefined,
  repository_name?: string
): Promise<Insight>
```

### `KnowledgeMoveBodySchema`

```typescript
// Exported Zod schema for POST /api/knowledge/:id/move request bodies.
// `.strict()` rejects unknown keys.
//
// source_repository_name is .optional() at the Zod layer — the conditional-required
// constraint (required when source_scope is "repository") is enforced in handler logic,
// not in the schema. This matches the pattern used for repository_name in other handlers.
export const KnowledgeMoveBodySchema: z.ZodObject<{
  source_scope: typeof InsightScope;                   // Required: 'global' | 'repository'
  source_repository_name?: z.ZodOptional<z.ZodString>; // Optional in schema; required by handler when source_scope === 'repository'
  repository_name: z.ZodString;                        // Required: destination repository name
}>;
```

### `handleMoveKnowledge()`

```typescript
// POST /api/knowledge/:id/move
// Moves an insight from one scope/repository to a different repository.
//
// Supports two move variants:
//   - global → repository: moves a global insight into a named repository store
//   - repository → repository: moves a repository insight to a different repository
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings.
//   - body validated via KnowledgeMoveBodySchema.safeParse().
//   - source_repository_name is required when source_scope is "repository" (handler-enforced;
//     the field is optional in the Zod schema — see KnowledgeMoveBodySchema).
//   - Source and destination must differ: if source_scope is "repository" and
//     source_repository_name === repository_name, throws VALIDATION_ERROR.
//
// Delegates to KnowledgeStoreManager.moveInsight(id, { scope: source_scope, repository_name: source_repository_name }, 'repository', repository_name)
// — atomic cross-store read-modify-write inside a single withLock(knowledgeDir()) span.
// The old non-atomic add→delete two-step compose is fully removed; no intermediate state
// is observable.
//
// The returned insight is the newly created copy in the target repository — it has a different
// numeric ID (assigned by the target store's next_id counter).
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, invalid body, source_repository_name absent when required,
//                      source and destination identical
//   NOT_FOUND        — no insight with the given id in the specified source scope
export async function handleMoveKnowledge(
  ledgerRoot: string,
  rawId: string,
  body: unknown
): Promise<Insight>
```

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

Central storage abstraction for ledger file I/O. Files are stored in the centralized ledger root at `{ledgerRoot}/{repoName}/{slug}/` — never inside plan folders.

```typescript
class LedgerStore {
  readonly planPath: string;
  readonly slug: string;
  readonly ledgerRoot: string;
  readonly repoName: string;     // derived from the project-root dirname via deriveRepoName(); falls back to 'unknown'
  readonly storageDir: string;   // {ledgerRoot}/{repoName}/{slug}/

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
  //
  // listAllProjects() — canonical entry point for slug-to-path resolution.
  // Performs a two-level scan of the ledger root:
  //   Level 1 (flat layout, backward compat): {ledgerRoot}/{slug}/.meta.json
  //   Level 2 (namespaced layout, current):   {ledgerRoot}/{repoName}/{slug}/.meta.json
  // Dot-prefixed entries (e.g. .archive) are skipped at both levels.
  // Unreadable depth-2 .meta.json entries are logged to stderr and skipped;
  //   the scan continues — errors here are non-fatal.
  //
  // ARCHITECTURAL CONSTRAINT: Any code that receives only a slug (not a plan_path)
  // must call listAllProjects() to retrieve the ProjectMeta (which contains
  // plan_path and the resolved storageDir) before constructing a LedgerStore
  // instance. Constructing LedgerStore(slug, ledgerRoot) directly is incorrect
  // for namespaced projects: deriveRepoName(slug) returns 'unknown' for a bare
  // slug, causing storageDir to resolve to {ledgerRoot}/unknown/{slug}/ instead
  // of the actual namespace path — the directory will not exist and all ledger
  // operations on that store will fail with 'Project not found'.
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

### `KnowledgeStoreManager`

Manages the `.knowledge/` directory under `ledgerRoot`. Provides full CRUD for insights with atomic writes, file locking, and in-memory search/filter logic. Exported from `src/storage/knowledge-store.ts`.

**Storage layout** (relative to `ledgerRoot`):
```
.knowledge/
  .lock                              — lock file created by withLock
  global-insights.json               — insights with scope: 'global'
  {repository_name}-insights.json    — insights scoped to a specific repository
```

**Locking strategy:**
- All read-modify-write sequences (`addInsight`, `updateInsight`, `deleteInsight`, `moveInsight`) acquire a single lock on `knowledgeDir()` for the entire operation.
- All writes use `atomicWriteJson()` — write-to-temp-then-rename.
- Pure reads (`readGlobalStore`, `readRepositoryStore`, `searchInsights`, `listInsights`) do not acquire a lock, consistent with the `LedgerStore` pattern.
- `moveInsight` is a cross-store read-modify-write: it reads both the source and target stores, writes the target (with the new insight), then writes the source (with the original removed) — all within the same lock span. Do NOT call it from inside another `withLock(knowledgeDir, …)` callback.

```typescript
class KnowledgeStoreManager {
  readonly ledgerRoot: string;

  constructor(ledgerRoot: string);

  // ── Path Helpers ──────────────────────────────────────────────────────────

  // Returns {ledgerRoot}/.knowledge
  knowledgeDir(): string;

  // Returns {ledgerRoot}/.knowledge/global-insights.json
  globalStorePath(): string;

  // Returns {ledgerRoot}/.knowledge/{repository_name}-insights.json.
  // @throws Error if repository_name === 'global' (reserved name)
  // @throws Error if repository_name fails SLUG_REGEX (path traversal protection)
  repositoryStorePath(repoName: string): string;

  // ── Read Methods ──────────────────────────────────────────────────────────

  // Reads and validates the global insights store.
  // Returns a valid empty KnowledgeStore (version '1.0.0', next_id: 1, insights: [])
  // when the file does not yet exist — no error thrown.
  // @throws Error if the file exists but contains malformed JSON or fails schema validation
  readGlobalStore(): Promise<KnowledgeStore>;

  // Reads and validates a repository-scoped insights store.
  // Returns a valid empty KnowledgeStore when the file does not yet exist.
  // @throws Error if the file exists but contains malformed JSON or fails schema validation
  readRepositoryStore(repoName: string): Promise<KnowledgeStore>;

  // ── Write Methods (public, top-level only) ────────────────────────────────

  // Writes the global insights store atomically under a lock.
  // @warning Do NOT call from inside a withLock(knowledgeDir, ...) callback — will deadlock.
  //   CRUD methods (addInsight, updateInsight, deleteInsight) bypass this method intentionally
  //   and call atomicWriteJson directly to avoid nested lock acquisition.
  writeGlobalStore(data: KnowledgeStore): Promise<void>;

  // Writes a repository-scoped insights store atomically under a lock.
  // @warning Same nested-lock deadlock risk as writeGlobalStore.
  writeRepositoryStore(repoName: string, data: KnowledgeStore): Promise<void>;

  // ── ID Generation ─────────────────────────────────────────────────────────

  // Increments store.next_id in-place and returns the KN-NNNN formatted string
  // (e.g. "KN-0001" for next_id === 1). Mutates the store object — caller must
  // persist the updated store for the counter to survive process restarts.
  // Note: the KN-NNNN return value is used by MCP tool consumers for display;
  // the storage layer stores numeric ids (store.next_id before increment).
  nextId(store: KnowledgeStore): string;

  // ── CRUD Operations ───────────────────────────────────────────────────────

  // Adds a new insight to the appropriate store (global or repository-scoped).
  // Auto-assigns numeric id from store.next_id. The entire read-modify-write
  // sequence runs under a single lock on knowledgeDir().
  // @throws Error if scope === 'repository' and repository_name is absent
  addInsight(input: Omit<Insight, 'id'>): Promise<Insight>;

  // Searches insights for the query string (case-insensitive substring match
  // against title, content, and every entry in tags).
  // Store selection is governed by filters — see store-selection rules table below.
  // After text match, optionally narrows by tags (AND intersection), then applies
  // offset/limit pagination — in that order.
  searchInsights(
    query: string,
    filters?: {
      scope?: InsightScope;
      repository_name?: string;
      category?: string;
      tags?: string[];    // AND semantics — all listed tags must be present on the insight
      limit?: number;
      offset?: number;    // default: 0
    }
  ): Promise<Insight[]>;

  // Lists insights with optional filters and pagination.
  // Filter application order: store selection (scope/repository_name) → category →
  // tags → offset → limit.
  listInsights(filters: {
    scope?: InsightScope;
    category?: string;
    tags?: string[];           // every tag must be present (AND semantics)
    repository_name?: string;
    limit?: number;
    offset?: number;           // default: 0
  }): Promise<Insight[]>;

  // Updates an existing insight by numeric id. Searches ALL stores (global +
  // all repository stores) to locate the insight.
  // Immutable fields: id, scope, repository_name, created_at.
  // Sets updated_at to the current timestamp on success.
  // @param filter — Optional scope/repository_name filter. When provided, restricts the
  //   store search to matching stores only, preventing accidental global-insight mutation
  //   when the same numeric id exists in both global and repository stores.
  //   Without a filter, all stores are searched in alphabetical order (original behaviour).
  // @throws Error if no insight with the given id exists in the filtered stores
  updateInsight(
    id: number,
    updates: Partial<Pick<Insight,
      'title' | 'content' | 'category' | 'tags' | 'source' | 'confidence' | 'superseded_by'
    >>,
    filter?: { scope?: InsightScope; repository_name?: string }
  ): Promise<Insight>;

  // Moves an insight from one store to another in a single atomic lock span,
  // eliminating the TOCTOU window of the previous add→delete two-step pattern.
  //
  // Steps (all inside one withLock(knowledgeDir) span):
  //   1. Resolve source store path(s) from sourceFilter.
  //   2. Find insight by id in source store — throws if not found.
  //   3. Construct moved insight: new id (from target store's next_id), corrected
  //      scope/repository_name, and a fresh updated_at timestamp (captured once via now()).
  //   4. Validate with InsightSchema.parse(…).
  //   5. Write updated target store via atomicWriteJson.
  //   6. Splice source and write updated source store via atomicWriteJson.
  //
  // Returns the moved Insight with new id, corrected scope/repository_name, and updated_at.
  //
  // @throws Error if the insight is not found in the source store(s)
  // @throws Error if targetScope === 'repository' and targetRepositoryName is absent
  // @throws Error if moving to the same repository store (identity move guard)
  // @warning Do NOT call from inside a withLock(knowledgeDir, …) callback — will deadlock.
  moveInsight(
    id: number,
    sourceFilter: { scope: InsightScope; repository_name?: string },
    targetScope: InsightScope,
    targetRepositoryName?: string
  ): Promise<Insight>;

  // Deletes an insight by numeric id.
  // @param filter — Optional scope/repository_name filter (same semantics as updateInsight).
  //   Without a filter, all stores are searched.
  // @throws Error if no insight with the given id exists in the filtered stores
  deleteInsight(id: number, filter?: { scope?: InsightScope; repository_name?: string }): Promise<void>;
}
```

**`_loadInsights()` store-selection rules** (used internally by `searchInsights` and `listInsights`):

| `scope` | `repository_name` | Stores loaded |
|---------|-------------------|---------------|
| `'global'` | any | `global-insights.json` only |
| `'repository'` | provided | `{repository_name}-insights.json` only |
| `'repository'` | absent | all `{repository_name}-insights.json` files |
| absent | provided | `{repository_name}-insights.json` only |
| absent | absent | `global-insights.json` + all `{repository_name}-insights.json` files |

---

### `migrateToNamespacedLayout()`

```typescript
// Exported from src/storage/migrate-namespaced.ts

interface MigrationResult {
  skipped: boolean;                              // true if storage_version >= 2 on entry (no-op)
  moved: string[];                               // slugs successfully moved
  errors: Array<{ slug: string; error: string }>; // individual move failures
}

function migrateToNamespacedLayout(ledgerRoot: string): Promise<MigrationResult>;
```

One-shot startup migration: scans `ledgerRoot` for depth-1 directories that contain a `.meta.json` (flat-layout projects) and moves each to `{ledgerRoot}/{repoName}/{slug}/` using `repository_name` from `.meta.json` (falls back to `'unknown'` when absent, `null`, or empty).

**Idempotency:** Reads `{ledgerRoot}/.migration-state.json` at startup; returns `{ skipped: true }` immediately if `storage_version >= 2`. Safe to call on every server startup.

**Crash recovery:** Writes a `.migration-in-progress` sentinel file before any directory moves, removed on success. If the process crashes mid-migration, the sentinel is present on the next run and the migration loop re-runs (already-moved directories are skipped).

**EXDEV fallback:** If `fs.rename()` fails with `EXDEV` (cross-device rename), falls back to recursive copy-then-delete with top-level verification via `verifyDirCopied()`.

**Partial failure:** Individual move errors leave the source directory untouched; the error is recorded in `result.errors`. `{ledgerRoot}/.migration-state.json` is only written when `errors.length === 0`.

**Startup wiring:** Called from `src/index.ts` after `mkdirSync(ledgerRoot)` and before `readConfigFromDisk()`, wrapped in `try/catch` to prevent fatal startup failures.

**`withLock` constraint:** Never calls `withLock(ledgerRoot)`. Race safety relies on the sentinel file and startup sequencing (no tool-call handlers are reachable during migration).

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

## Knowledge Accumulation Schema

### `src/schema/knowledge.ts` — Insight and KnowledgeStore schemas

Zod schemas and inferred TypeScript types for the knowledge accumulation system. All types are inferred via `z.infer<>` — no handwritten duplicate interfaces.

```typescript
// Regex for valid slugs (repository names, plan slugs, etc.): must start with an alphanumeric
// character, followed by letters, digits, underscores, or hyphens only. Rejects '/', '\\', '.',
// spaces, and any character that could escape the .knowledge/ directory.
// Single source of truth — used by InsightSchema.repository_name, InsightSchema.origin_plan,
// and KnowledgeStoreManager._validateSlug(). Update this constant to change the slug policy
// in both places simultaneously.
export const SLUG_REGEX: RegExp; // /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

// Scope enum: 'global' (applies across all codebases/repositories) | 'repository' (scoped to
// a specific repository — codebase-level knowledge).
// Note: when scope === 'repository', repository_name should be present. This constraint is
// enforced by the storage layer (KnowledgeStoreManager), not by this schema, so the schema
// remains composable and usable without runtime context.
const InsightScope: z.ZodEnum<['global', 'repository']>;
type InsightScope = 'global' | 'repository';

// Single reusable knowledge record stored in the knowledge base.
// Optional fields:
//   repository_name — required by storage layer when scope === 'repository'; validates against SLUG_REGEX
//   origin_plan     — provenance metadata: plan slug where insight was first discovered; distinct from
//                     `source` (a URL/reference link); validates against SLUG_REGEX
//   updated_at      — set when an insight is amended after initial creation
//   superseded_by   — id of the insight that replaces this one; no referential integrity enforced at schema layer
// confidence: 0–1 float; range enforced as [0, 1] — values outside this range are rejected at parse time.
const InsightSchema: z.ZodObject<{
  id: z.ZodNumber;              // integer; storage layer should enforce id >= 1; per-store only — not globally unique across global and repository stores
  scope: typeof InsightScope;
  repository_name: z.ZodOptional<z.ZodString>; // required by storage layer when scope === 'repository'
  origin_plan: z.ZodOptional<z.ZodString>;     // provenance: plan slug that produced the insight
  title: z.ZodString;
  content: z.ZodString;
  category: z.ZodString;
  tags: z.ZodArray<z.ZodString>;
  source: z.ZodString;
  created_at: z.ZodString;      // ISO 8601 timestamp
  updated_at: z.ZodOptional<z.ZodString>;
  confidence: z.ZodNumber;      // 0–1 float; range [0, 1] enforced at schema layer
  superseded_by: z.ZodOptional<z.ZodNumber>; // integer id of superseding insight
}>;
type Insight = z.infer<typeof InsightSchema>;

// Top-level structure for .knowledge/store.json.
// - version: schema version string (e.g. "1.0.0") for forward-compatibility
// - last_updated: ISO 8601 timestamp of the most recent write
// - next_id: auto-increment counter; assigned to the next insight added
// - insights: flat array of all stored Insight records
const KnowledgeStoreSchema: z.ZodObject<{
  version: z.ZodString;
  last_updated: z.ZodString;
  next_id: z.ZodNumber;         // nonnegative integer
  insights: z.ZodArray<typeof InsightSchema>;
}>;
type KnowledgeStore = z.infer<typeof KnowledgeStoreSchema>;
```

**Design notes:**
- `scope === 'repository'` → `repository_name` required constraint is owned by the storage layer (`KnowledgeStoreManager`, WP-002+), not this schema. The schema accepts `repository_name` as optional to remain context-free and composable.
- `origin_plan` is semantically distinct from `source`: `source` is a reference link/URL, while `origin_plan` is the planning artefact slug (e.g. a plan folder name) where the insight was first discovered. Use `origin_plan` to record provenance; use `source` to record a citable reference.
- Storage layer should enforce `z.number().int().positive()` for `id` (schema accepts 0) and `z.number().finite()` for `confidence` (schema accepts `Infinity`) when persisting.
- Empty strings for `title`, `content`, `source`, `category` are accepted by the schema; storage layer should guard against them.

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

// Derives the repo name from an absolute plan folder path.
// Calls inferProjectRootFromPlanPath(), lowercases the project-root basename, and
// validates against assertSafeSegment() (alphanumeric + hyphens). Returns 'unknown' on
// any failure (path too shallow, name fails slug validation, empty input).
// Pure — no filesystem access. Exported from src/utils/ledger-root.ts
function deriveRepoName(projectPath: string): string;

// Resolves a project slug (or qualified {repo}/{slug} string) to an absolute storage path.
// Qualified input (contains '/'): validates repo and slug segments individually against
//   assertSafeSlug() (which delegates to assertSafeSegment()), then returns join(ledgerRoot, repo, slug) with no I/O.
// Bare-slug input: first validates the slug via assertSafeSlug, then scans all non-dot
//   subdirectories of ledgerRoot; returns join(ledgerRoot, repoName, slug) when exactly
//   one match is found. Throws on ambiguity or not-found:
//     'AMBIGUOUS: slug ... exists in N repo namespaces. Use a qualified ...'
//     'NOT_FOUND: project slug ... was not found in any repo namespace under {ledgerRoot}'.
// ⚠️ The NOT_FOUND message embeds the absolute ledgerRoot path — callers must sanitise
//   before surfacing to API consumers (see Gotcha 13 in constraints.md).
// Async (uses readdir for bare-slug scan). Exported from src/utils/ledger-root.ts
async function resolveProjectDir(
  slugOrQualified: string,  // bare slug ('my-plan') or qualified '{repo}/{slug}'
  ledgerRoot: string,
): Promise<string>;

// Returns true when segment is a valid slug segment (lowercase alphanumeric with hyphens,
// must start with an alphanumeric character); false otherwise.
// Pure boolean predicate — no side effects, no errors thrown. Callers are responsible for
// constructing their own layer-specific errors on false.
// Boolean(segment) is retained as defense-in-depth (SAFE_SLUG_REGEX already rejects empty
// strings via its ^[a-z0-9] anchor, but the guard makes the intent explicit).
//
// Canonical validation delegate: the single slug-segment validation function used by all
// assertSafeSlug() wrappers in the codebase. Each wrapper delegates here and throws a
// layer-appropriate error on false:
//   - assertSafeSlug() in src/utils/ledger-root.ts (storage layer) → throws plain Error
//   - assertSafeSlug() in src/gui/handlers/run-log-handlers.ts (GUI layer) → throws ApiError NOT_FOUND
//   - assertSafeSlug() in gui/api.ts (GUI layer) → throws ApiError NOT_FOUND
// Exported from src/utils/path-validator.ts.
function assertSafeSegment(segment: string): boolean;

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

Slug validation: a module-private `assertSafeSlug()` wrapper delegates to `assertSafeSegment()` from `path-validator.ts` and throws `ApiError NOT_FOUND` on false. Valid slugs must pass `assertSafeSegment()` (lowercase alphanumeric + hyphens, starting with alphanumeric).

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
 * @param resumeThreadId When provided, passes --resume <threadId> to the spawned process
 *                       so the orchestrator resumes an existing LangGraph thread.
 */
export async function startOrchestrator(
  planPath:        string,
  workspaceRoot:   string,
  dryRun           = false,
  resumeThreadId?: string,
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

- `assertSafeSlug(slug: string): void` — applied as the **first statement** in all slug-bearing handlers (`handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleGetWorkPackageOverview`, `handleDeleteProject`, `handleArchiveProject`, `handleUnarchiveProject`, `handleMarkProjectComplete`, `handleGetPlanDocument`, `handleGetSynthesisDocument`, `handleGetRunMetadata`, `handleResetProject`, `handleGetProjectHealth`, `handleRenameProject`, `handleListDialogues`, `handleGetDialogueFile`, `handleListChunks`, `handleGetChunkFile`).
- `assertSafeWpId(wpId: string): void` — applied as the **second statement** in `handleGetWorkPackage`, immediately after `assertSafeSlug`.
- `assertSafeQueueId(id: string): void` — applied as the **first statement** in `handleOrchestratorKill` and `handleOrchestratorDismiss`; `id` is extracted from the URL path via `decodeURIComponent()` in `server.ts` **before** the guard is called, so percent-encoded slashes (`%2F`) are decoded first and then caught.

All three guards apply identical rejection criteria: throw `ApiError` with code `NOT_FOUND` (HTTP 404) if the value is empty, contains `'/'`, or contains `'..'`. Returning `NOT_FOUND` rather than `FORBIDDEN` is intentional — avoids leaking file-system structural information to potential attackers.

**`assertSafeSegment()` vs `assertSafeSlug()` usage pattern:** The module-private `assertSafeSlug()` wrapper (which delegates to `assertSafeSegment()`) always throws `ApiError NOT_FOUND` — use it at handler entry points to reject invalid path slugs. When the calling site needs to produce a _different_ error type on an invalid value, call `assertSafeSegment()` directly and construct the error explicitly. Canonical example: `handleRenameProject` calls `assertSafeSegment(newSlug)` directly and then calls `validationError()` on `false`, because an invalid _proposed_ new slug is a validation error (`VALIDATION_ERROR`), not a not-found condition (`NOT_FOUND`).

**Store resolution helper:** `resolveProjectStore()` is a module-private async helper used by all 13 URL-parameter-driven handlers to obtain a `LedgerStore` for the namespaced project directory.

```typescript
// Resolves a LedgerStore for URL-parameter-driven handlers.
// Validates repoName (if provided) via assertSafeSlug, calls resolveProjectDir()
// to locate the namespaced storageDir, reads .meta.json for plan_path, then
// constructs LedgerStore(meta.plan_path, ledgerRoot).
//
// Security contract — AMBIGUOUS → NOT_FOUND downgrade:
//   When resolveProjectDir() throws AMBIGUOUS (slug exists in multiple repos),
//   this function downgrades it to NOT_FOUND. Callers must not learn that a slug
//   exists across namespaces (cross-namespace existence leak prevention).
//   Do not restore the original AMBIGUOUS error without a security review.
async function resolveProjectStore(
  ledgerRoot: string,
  slug: string,       // must already be validated via assertSafeSlug() by the caller
  repoName?: string   // optional; validated here via assertSafeSlug() before use
): Promise<LedgerStore>;
```

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

// GET /api/projects/:slug/run-metadata — returns the parsed .orchestrator-run.json sidecar for the project
// Reads {store.planPath}/.orchestrator-run.json (written atomically by the orchestrator CLI during a run).
// Returns HTTP 200 with the parsed JSON when the file exists.
// Throws NOT_FOUND when the project slug does not exist or when the sidecar file has not been created yet.
// repoName is optional; supplied when the call comes from a namespaced route context.
export async function handleGetRunMetadata(
  ledgerRoot: string,
  slug: string,
  repoName?: string
): Promise<unknown>;

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

// Structured representation of a single dialogue file, parsed from the filename convention
// {WP_ID}-{stage}-r{N}.md.  wp_id and stage are empty strings for non-conforming names.
export interface DialogueEntry {
  filename: string;
  wp_id: string;   // e.g. 'WP-001'
  stage: string;   // e.g. 'developer'
}

// GET /api/projects/:slug/dialogues[?wp=WP-001]
// Returns an array of structured DialogueEntry objects from the project's orchestrator/dialogues/ directory.
// Slug validation: assertSafeSlug() runs first; a missing or invalid project → NOT_FOUND.
// Returns [] when the project exists but the dialogues/ subdirectory is absent (no error thrown).
// Optional ?wp= query parameter: when provided, only filenames starting with '{wpId}-' are returned.
// All returned entries are sorted alphabetically by filename.
// Storage paths use store.storageDir from resolveProjectStore().
export async function handleListDialogues(
  ledgerRoot: string,
  slug: string,
  wpId?: string,
  repoName?: string
): Promise<DialogueEntry[]>;

// GET /api/projects/:slug/dialogues/:filename
// Returns the raw Markdown content of a single dialogue file.
// Security (two-layer path-traversal defence):
//   1. Primary allowlist: DIALOGUE_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/ — rejects any filename
//      containing '.', '/', or other special characters (including percent-decoded traversals).
//   2. Defence-in-depth: path.resolve() prefix check ensures the resolved file path stays inside
//      the project's orchestrator/dialogues/ directory.
// Both layers throw ApiError NOT_FOUND on violation. slug validated via assertSafeSlug().
// Storage paths use store.storageDir from resolveProjectStore().
export async function handleGetDialogueFile(
  ledgerRoot: string,
  slug: string,
  filename: string,
  repoName?: string
): Promise<string>;

// ---------------------------------------------------------------------------
// Chunk endpoints — JSONL streaming capture (gui/api.ts)
// ---------------------------------------------------------------------------

// CHUNKS_DIR constant (src/utils/constants.ts)
// Relative path from the per-project ledger storage root to the chunk files directory.
// Current usage in handleListChunks / handleGetChunkFile:
//   path.join(store.storageDir, CHUNKS_DIR)  → {ledgerRoot}/{repo}/{slug}/orchestrator/chunks/
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
// Slug validation: assertSafeSlug() runs first; a missing or invalid project → NOT_FOUND.
// Returns [] when the project exists but the chunks/ subdirectory is absent (no error thrown).
// Optional ?wp= query parameter: when provided, only filenames starting with '{wpId}-' are returned
// (wpId validated against WP_ID_RE — invalid values return []).
// All returned entries are sorted alphabetically by filename.
// Storage paths use store.storageDir from resolveProjectStore().
export async function handleListChunks(
  ledgerRoot: string,
  slug: string,
  wpId?: string,
  repoName?: string
): Promise<ChunkEntry[]>;

// GET /api/projects/:slug/chunks/:filename
// Returns the raw JSONL content of a single chunk file as a UTF-8 string.
// Security (two-layer path-traversal defence, identical to handleGetDialogueFile):
//   1. Primary allowlist: CHUNK_FILENAME_RE = /^[A-Za-z0-9_-]+\.jsonl$/ — rejects any filename
//      containing '.', '/', or other special characters.
//   2. Defence-in-depth: path.resolve() prefix check ensures the resolved file path stays inside
//      the project's orchestrator/chunks/ directory.
// Both layers throw ApiError NOT_FOUND on violation. slug validated via assertSafeSlug().
// Storage paths use store.storageDir from resolveProjectStore().
export async function handleGetChunkFile(
  ledgerRoot: string,
  slug: string,
  filename: string,
  repoName?: string
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
// Validates body.planPath (required, string), optional dryRun (boolean, default false),
// and optional resumeThreadId (string, must match UUID v4 pattern).
// When dryRun=false and all checks pass, spawns a detached orchestrator process.
// When resumeThreadId is provided, validates against UUID v4 regex and forwards to
// startOrchestrator() so the process is launched with --resume <resumeThreadId>.
// Throws VALIDATION_ERROR when body.planPath is absent or not a string.
// Throws VALIDATION_ERROR when body.resumeThreadId is present but not a valid UUID v4.
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

// ---------------------------------------------------------------------------
// Knowledge API — WP-001 foundations (CRUD + list/search); WP-005 added promote + move
// Route registration in server.ts is deferred to WP-002.
// ---------------------------------------------------------------------------

/**
 * Zod schema for the PATCH /api/knowledge/:id request body (exported module-level constant).
 *
 * `scope` is required; all other mutable Insight fields are optional.
 * `.strict()` rejects unknown keys, preventing callers from sending immutable
 * fields (id, created_at, …).
 *
 * Fields:
 *   scope:            'global' | 'repository'  — REQUIRED
 *   repository_name?: string matching SLUG_REGEX  — REQUIRED when scope is 'repository'
 *   title?:           string
 *   content?:         string
 *   category?:        string
 *   tags?:            string[]
 *   source?:          string
 *   confidence?:      number (0–1)
 *   superseded_by?:   number (integer)
 */
export const KnowledgeUpdateBodySchema: z.ZodObject<...>;

/** Raw query parameters accepted by GET /api/knowledge. */
export interface KnowledgeListParams {
  scope?: string;          // 'global' | 'repository'; unrecognised non-undefined values throw VALIDATION_ERROR; omitting means no filter
  category?: string;
  /** Comma-separated list of tags; split on ',' with whitespace trimming. */
  tags?: string;
  repository_name?: string;
  /** Full-text search query — when present, delegates to searchInsights instead of listInsights. */
  query?: string;
  limit?: number | string;   // coerced to positive integer; invalid/missing → undefined (no limit)
  offset?: number | string;  // coerced to non-negative integer; invalid/missing → 0
}

// GET /api/knowledge
// Lists or searches knowledge insights stored in the ledger's `.knowledge/` directory.
//
// Routing logic:
//   - When `query` is present and non-empty: delegates to KnowledgeStoreManager.searchInsights().
//   - Otherwise: delegates to KnowledgeStoreManager.listInsights() with scope/category/tags filters.
//
// Parameter handling:
//   - `scope` is validated via InsightScope.safeParse(); unrecognised non-undefined values throw
//     VALIDATION_ERROR (HTTP 400). Omitting `scope` (undefined) means "no scope filter" and is
//     always allowed. This brings handleListKnowledge into contract parity with the four mutating
//     handlers (WP-001 hardening).
//
//   - `repository_name` is validated against SLUG_REGEX when provided; malformed values
//     (e.g. '../evil', 'has spaces') throw VALIDATION_ERROR (HTTP 400) before reaching the storage
//     layer. All five knowledge handlers now validate repository_name consistently at the handler level.
//
//   - `tags` is a comma-separated string split before being forwarded (e.g. "node,backend" → ["node","backend"]).
//     Whitespace around commas is trimmed; empty segments are dropped.
//   - `limit` and `offset` are coerced to integers; invalid or missing values are silently ignored.
//
// Query-mode behaviour:
//   When `query` is present, `tags`, `limit`, and `offset` ARE forwarded to searchInsights().
//   Full-text search (substring match), tag filtering (AND semantics), and pagination can be
//   combined in a single call. Filter application order inside searchInsights():
//     1. Substring match against title, content, and tags
//     2. Tag intersection filter (if tags provided)
//     3. offset/limit pagination slice
//
// Returns: Insight[] (empty array when no insights exist or no matches are found)
export async function handleListKnowledge(
  ledgerRoot: string,
  params?: KnowledgeListParams
): Promise<Insight[]>;

// POST /api/knowledge/:id/promote
// Promotes a repository-scoped insight to global scope using the atomic moveInsight() method.
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings.
//   - scope (query parameter) required; must be "repository". Passing scope="global" throws
//     VALIDATION_ERROR ("Insight is already global and cannot be promoted.").
//   - repository_name (query parameter) required when scope is "repository"; throws VALIDATION_ERROR
//     when absent.
//   - repository_name validated against SLUG_REGEX after the presence check (WP-004);
//     throws VALIDATION_ERROR for malformed slugs (e.g. '../evil', 'has spaces').
//
// Delegates to KnowledgeStoreManager.moveInsight(id, { scope: 'repository', repository_name }, 'global')
// — atomic cross-store operation (single withLock(knowledgeDir()) span). The former non-atomic
// add-first-then-delete compose pattern (which left a TOCTOU window) is fully replaced (WP-002/WP-003).
//
// The returned insight is the newly created global copy — it has a different numeric ID
// (assigned by the global store's next_id counter). The original repository-scoped insight
// is atomically removed by the same moveInsight() call.
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, missing/invalid scope, scope is "global",
//                      missing repository_name, malformed repository_name (fails SLUG_REGEX)
//   NOT_FOUND        — no insight with the given id in the specified repository scope
//
// @param ledgerRoot      Absolute path to the central ledger root.
// @param rawId           Raw id string from the URL parameter (e.g. "42").
// @param scope           Source scope query parameter — must be "repository".
// @param repository_name Required when scope is "repository".
// @returns The newly created global Insight.
export async function handlePromoteKnowledge(
  ledgerRoot: string,
  rawId: string,
  scope: string | undefined,
  repository_name?: string
): Promise<Insight>;

/**
 * Zod schema for the POST /api/knowledge/:id/move request body.
 *
 * Fields validated by the Zod schema (format/type constraints):
 *   source_scope:            'global' | 'repository'  — REQUIRED
 *   source_repository_name?: string matching SLUG_REGEX  — OPTIONAL in schema;
 *                            the conditional-required rule (required when source_scope is "repository")
 *                            is enforced in handler logic, not here.
 *   repository_name:         string matching SLUG_REGEX  — REQUIRED (destination)
 *
 * Note: `source_repository_name` is `.optional()` at the Zod layer so the schema can parse a body
 * that omits it. The handler validates the scope+name combination and throws VALIDATION_ERROR if
 * the conditional constraint is violated. `.strict()` rejects unknown keys.
 */
export const KnowledgeMoveBodySchema: z.ZodObject<{
  source_scope: typeof InsightScope;
  source_repository_name: z.ZodOptional<z.ZodString>;  // optional in schema; conditional-required in handler
  repository_name: z.ZodString;
}>;

// POST /api/knowledge/:id/move
// Moves an insight from one scope/repository to a different repository using the atomic moveInsight() method.
//
// Supports two move variants:
//   - global → repository: moves a global insight into a named repository store
//   - repository → repository: moves a repository insight to a different repository
//
// Validation:
//   - rawId validated via parseKnowledgeId() — throws VALIDATION_ERROR for non-integer,
//     zero, or floating-point strings.
//   - body validated via KnowledgeMoveBodySchema.safeParse() — throws VALIDATION_ERROR for
//     unknown fields or type mismatches.
//   - source_repository_name is required when source_scope is "repository" (handler-enforced conditional
//     constraint; not enforced by the Zod schema itself where the field is optional).
//   - Source and destination must differ: if source_scope is "repository" and source_repository_name
//     equals repository_name, throws VALIDATION_ERROR ("Cannot move insight to the same repository store").
//
// Delegates to KnowledgeStoreManager.moveInsight(id, { scope: source_scope, repository_name: source_repository_name }, 'repository', repository_name)
// — atomic cross-store operation (single withLock(knowledgeDir()) span). The former non-atomic
// add-first-then-delete compose pattern (which left a TOCTOU window) is fully replaced (WP-002/WP-003).
//
// The returned insight is the newly created copy — it has a different numeric ID (assigned by the
// target store's next_id counter). The original source insight is atomically removed.
//
// Error codes:
//   VALIDATION_ERROR — non-integer id, invalid body, source_repository_name absent when required,
//                      source and destination identical
//   NOT_FOUND        — no insight with the given id in the specified source scope
//
// @param ledgerRoot  Absolute path to the central ledger root.
// @param rawId       Raw id string from the URL parameter (e.g. "42").
// @param body        Parsed request body (any shape — validated here via KnowledgeMoveBodySchema).
// @returns The newly created Insight in the target repository store.
export async function handleMoveKnowledge(
  ledgerRoot: string,
  rawId: string,
  body: unknown
): Promise<Insight>;

// ---------------------------------------------------------------------------
// Knowledge — exported helpers (gui/api-knowledge.ts)
// ---------------------------------------------------------------------------
//
// parseKnowledgeId(raw: string): number
//   Exported helper (WP-003). Parses a raw string as a positive integer insight ID.
//   Rejects: non-numeric strings (NaN), floating-point strings (any '.' in raw string checked
//   BEFORE numeric coercion — catches "2.0" which Number("2.0") === 2 would miss), zero, negatives.
//   Throws: ApiError VALIDATION_ERROR for any rejected value.
//   Note: The raw.includes('.') check runs before Number() coercion — this is intentional.
//   Number("2.0") === 2 (an integer), so Number.isInteger alone is insufficient for float-string
//   rejection.
//
// findInsightById — REMOVED (WP-003). This helper was a dead code artifact after promote and move
//   handlers were wired to moveInsight(). It has been deleted from the codebase.
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

#### `resolveRepoName(ledgerRoot, repoUrlParam, slugUrlParam): Promise<string>`

Reads `{ledgerRoot}/{repoUrlParam}/{slugUrlParam}/.meta.json` and returns the stored
`repository_name` value. Falls back to `repoUrlParam` when the field is absent/null or when
the file contains malformed JSON (writes a `process.stderr` warning in the latter case).

Validates both `repoUrlParam` and `slugUrlParam` via the file-local `assertSafeSlug()` guard
before any filesystem access. Throws `ApiError NOT_FOUND` for invalid segments and for missing
meta files. Using `NOT_FOUND` for both cases is intentional information-hiding: invalid input
and missing projects are indistinguishable from the client side.

Exported for direct unit testing (previously unexported/private). Used by all namespaced route
handlers in `server.ts`.

---

## GUI Frontend

### `gui/public/` — static single-page application

Served as static assets by `gui/server.ts`. No ES modules, no framework, no build step.

| File | Purpose |
|------|---------|
| `index.html` | HTML shell — nav (`#/` Projects, `#/insights` Insights, `#/knowledge` Knowledge, `#/orchestrator` Orchestrator, `#/config` Config), `<div id="app">` mount point |
| `styles.css` | CSS custom properties, status badges, tables, cards, forms, loading spinner, error/success/stale banners, comment cards, reset modal, action menu dropdown |
| `api-client.js` | `API` object — async fetch wrappers for REST endpoints (throws `{ code, message }` on non-2xx) |
| `theme.js` | `Theme` object — dark/light toggle; reads/writes `localStorage`; applies `data-theme` on `<html>`; `init()` wires the toggle button |
| `router.js` | `Router` object — hash-based dispatch; manages `setInterval` polling lifecycle; calls `updateNavActive(path)` on every dispatch; routes include `'/'`, `/projects/*` (pattern-matched), `/config`, `/insights`, `/knowledge`, `/orchestrator` |
| `utils.js` | Shared utilities: `escapeHtml()`, `formatDate()`, `statusBadge()`, `showLoading()`, `showError()` |
| `app.js` | Bootstrap entry point — calls `Theme.init()` then `Router.init()` |
| `views/project-list.js` | `renderProjectList(app)` — project list table with filter, search, pagination, and action menu |
| `views/project-detail.js` | `renderProjectDetail(app, slug)`, `extractSynopsis(markdown)`, `renderPlan(app, slug)`, `renderSynthesis(app, slug)`, `showResetModal(slug, diagnosis)` |
| `views/work-package.js` | `renderWorkPackageDetail(app, slug, wpId)`, `buildWpDetailBar(wp)` |
| `views/config.js` | `renderConfig(app)` — config settings form |
| `views/insights.js` | `renderInsights(app)` — insights page with dynamic filter selects and comment cards |
| `views/knowledge.js` | `renderKnowledge(app)` — Knowledge page; tab navigation between Global and Repository scopes; client-side filtering; card-level edit/delete/promote/move actions |
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

**`styles.css` — Resume Run button classes** (added in WP-004):

| Class / Selector | Role |
|------------------|------|
| `#orch-resume-cell` | Container `<div>` placeholder for the resume button; `padding-bottom: 8px`; inserted into the project-detail Orchestrator Runs section (no-active-run branch only) |
| `.btn-resume` | Outlined primary-color button style: `background: transparent; color: var(--color-btn-bg); border-color: var(--color-btn-bg)` — inherits `.btn` base class (`border: 1px solid transparent`); `.btn-resume` overrides `border-color` only to produce the outlined look; dark-theme compatible via CSS variable |
| `.btn-resume:hover` | Fill-on-hover: `background: var(--color-btn-bg); color: #fff; opacity: 1` — the explicit `opacity: 1` overrides the `.btn:hover { opacity: 0.85 }` fade via cascade order |
| `.btn-resume:disabled` | Disabled state: `opacity: 0.6; cursor: not-allowed` — applied immediately on click to prevent double-submit; re-enabled on error |

**`api-client.js`:**
- **`API`** — async fetch wrappers for all 31 REST endpoints (throws `{ code, message }` on non-2xx); includes `getProjects(params)` → `GET /api/projects`; `getProject(slug)` → `GET /api/projects/:slug`; `getWorkPackages(slug)` → `GET /api/projects/:slug/work-packages`; `getWorkPackage(slug, wpId)` → `GET /api/projects/:slug/work-packages/:wpId`; `getWorkPackageOverview(slug)` → `GET /api/projects/:slug/work-packages/overview`; `deleteProject(slug)` → `DELETE /api/projects/:slug`; `archiveProject(slug)` → `POST /api/projects/:slug/archive`; `unarchiveProject(slug)` → `POST /api/projects/:slug/unarchive`; `getConfig()` → `GET /api/config`; `updateConfig(data)` → `PUT /api/config`; `getInsights()` → `GET /api/insights`; `getServerInfo()` → `GET /api/server-info`; `getPlanDocument(slug)` → `GET /api/projects/:slug/plan`; `getSynthesisDocument(slug)` → `GET /api/projects/:slug/synthesis`; `analyzeProjectReset(slug)` → `POST /api/projects/:slug/reset` with `{ dry_run: true }`; `applyProjectReset(slug, decisions)` → `POST /api/projects/:slug/reset` with `{ dry_run: false, decisions }`; `getProjectHealth(slug)` → `GET /api/projects/:slug/health`; `renameProject(slug, title)` → `PATCH /api/projects/:slug` with `{ title }`; `renameSlug(slug, newSlug)` → `PATCH /api/projects/:slug` with `{ slug: newSlug }`; `markProjectComplete(slug)` → `POST /api/projects/:slug/complete`; `getRunLogs(slug)` → `GET /api/projects/:slug/runs`; `getRunLogEntries(slug, filename, afterLine?)` → `GET /api/projects/:slug/runs/:filename?after=N` (hand-rolled query string; consistent with `getDialogues`); `getRunMetadata(slug)` → `GET /api/projects/:slug/run-metadata` (returns the parsed `.orchestrator-run.json` sidecar; used by the resume button to read `thread_id`, `dry_run`, and `result`); `getDialogues(slug, wpId)` → `GET /api/projects/:slug/dialogues?wp={wpId}` (hand-rolled query string; returns parsed JSON `{ filename, stage, wp_id }[]`); `getDialogueContent(slug, filename)` → `GET /api/projects/:slug/dialogues/:filename` (returns raw Markdown text via `res.text()` — uses direct `fetch()` rather than the private `request()` helper, which calls `res.json()`); `getChunks(slug, wpId)` → `GET /api/projects/:slug/chunks?wp={wpId}` (returns parsed JSON `ChunkEntry[]`); `getChunkRendered(slug, filename)` → `GET /api/projects/:slug/chunks/{filename}/rendered` (returns `{ content: string }` — rendered Markdown via `renderChunksToMarkdown`); `orchestratorStart(planPath, dryRun, resumeThreadId?)` → `POST /api/orchestrator/start` with body `{ planPath, dryRun }` (when `resumeThreadId` is defined, adds it to the request body as `resumeThreadId`; backward-compatible with existing two-argument callers); `orchestratorGetQueue()` → `GET /api/orchestrator/queue` (returns current run-queue entries; server-side handler pending); `orchestratorKill(id)` → `POST /api/orchestrator/kill/{encodeURIComponent(id)}` (sends SIGTERM to the process; server-side handler pending); `orchestratorDismiss(id)` → `DELETE /api/orchestrator/queue/{encodeURIComponent(id)}` (removes a completed or stale entry from the queue without killing the process; server-side handler pending)

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

**`views/knowledge.js`:**
- **`renderKnowledge(app)`** — Knowledge page (`#/knowledge`); tab navigation between Global and Repository insight scopes; renders knowledge insight cards with scope badges, category pills, tag chips, confidence labels, and per-card action rows including a Move to Repository inline slug input. Uses the CSS classes documented below.

  **State variables** (closure-scoped, all reset on tab switch):

  | Variable | Type | Description |
  |----------|------|-------------|
  | `allInsights` | `Insight[]` | Full unfiltered dataset returned by `API.getKnowledge` |
  | `activeTab` | `'global' \| 'repository'` | Currently selected tab |
  | `filterCategory` | `string` | Active category filter value (empty = all) |
  | `filterRepository` | `string` | Active repository-name filter value (empty = all; Repository tab only) |
  | `filterQuery` | `string` | Active free-text search query (matches title, content, tags) |
  | `editingId` | `number \| null` | ID of the card currently showing the inline edit form |
  | `confirmDeleteId` | `number \| null` | ID of the card showing the delete-confirm step |
  | `movingId` | `number \| null` | ID of the card showing the Move to Repository inline slug input |

  > **Note:** `movingId` is not listed in the original WP-006 deliverables spec but is required by the Move to Repository feature. It is properly reset alongside the other state variables on tab switch.

  **`formatConfidence(value)`** — converts a raw `[0, 1]` confidence float to a human-readable string (e.g. `"80% (High)"`). Uses `Math.round(value * 100)` before comparing against bucket constants:

  | Constant | Value | Bucket |
  |----------|-------|--------|
  | `CONFIDENCE_HIGH_MIN` | `68` | 68–100 → **High** |
  | `CONFIDENCE_MEDIUM_MIN` | `34` | 34–67 → **Medium** |
  | *(implicit)* | | 0–33 → **Low** |

  > **Rounding boundary note:** Because `Math.round()` is applied before threshold comparison, values just below `0.68` (e.g. `0.6799`) round to `68%` and are labelled **High**. Similarly, `0.3349` rounds to `33%` (Low) while `0.3350` rounds to `34%` (Medium). This is intentional UX behaviour — the displayed percentage and bucket are always consistent — but maintainers adjusting thresholds should account for the `±0.005` float rounding window at each boundary.

  **Error-handling convention:** The view uses `showError(app, ...)` for all API failure paths **except** the inline edit form's save failure. The edit form catch block intentionally uses an inline `msgEl.innerHTML` error message instead:
  - **Why:** `showError(app, ...)` replaces the entire app container, which would discard the user's in-progress edit form and cause data loss on a transient save failure.
  - **Which paths use `showError`:** load, delete, promote, move — all destructive or navigating actions where losing form state is acceptable.
  - **Which path uses inline error:** edit form save only — the inline `.error-banner` is injected into `#kn-edit-msg-{id}` and the form remains visible so the user can retry or correct input.
  - This design is documented in-code with an explanatory comment in the `.catch()` block.

  **Client-side filtering** (`applyFilters()`) — runs entirely in-browser with no round-trip; filters by scope (tab), category, repository name (Repository tab only), and free-text query (case-insensitive match on title, content, and tags). Filtering is triggered on every tab switch, dropdown change, and search-input keystroke.

  > **UX note:** `renderList()` rebuilds the filter bar DOM on every keystroke (to keep dropdown selections in sync), which causes the search `<input>` to lose focus after each character. This is a known UX trade-off acknowledged during implementation and code review. A minimal fix (refocus the input after rebuild) is earmarked for a future follow-up pass.

  **No polling:** `renderKnowledge` does not call `Router._setPolling()`. Knowledge insights are human-curated and change infrequently; the page loads once and relies on user-initiated actions to refresh state.

**`styles.css` — Knowledge Page classes** (added in WP-002; all live in the `/* Knowledge Page */` section):

| Class | Role |
|-------|------|
| `.knowledge-tabs` | `display:flex` container with `border-bottom: 2px solid var(--color-border)` acting as the tab underline track; `margin-bottom: 20px` |
| `.knowledge-tab` | Tab button; resets `<button>` defaults; uses a transparent `border-bottom: 2px` that is promoted to `var(--color-ready)` on `:hover` / `.active`; `margin-bottom: -2px` overlaps the track so the active border sits on top of it |
| `.knowledge-tab.active` | Active tab state — `color: var(--color-ready)`, `border-bottom-color: var(--color-ready)`, `font-weight: 600` |
| `.badge-scope-global` | Blue-toned scope badge extending `.badge`; light: `#dbeafe` bg / `#1d4ed8` text |
| `.badge-scope-repository` | Green-toned scope badge extending `.badge`; light: `#dcfce7` bg / `#15803d` text |
| `.category-pill` | Small inline pill for category display; `border-radius: var(--radius-pill)`; uses `var(--color-bg)`, `var(--color-text-muted)`, `var(--color-border)` tokens |
| `.tag-chip` | Small inline chip for tag display; purple tones: `#f3e8ff` bg / `#7c3aed` text / `#e9d5ff` border; `border-radius: var(--radius-pill)` |
| `.confidence-label` | Muted italic label for confidence display; `font-size: 12px`, `color: var(--color-text-muted)`, `font-style: italic` |
| `.knowledge-actions` | `display:flex` row for per-card action buttons; `gap: 8px`, `flex-wrap: wrap`, `margin-top: 12px` |
| `.knowledge-move-input` | `display:inline-flex` container grouping a repository-name text input (expects a slug, e.g. `my-project`) and its confirm button; `gap: 6px`, `flex-wrap: nowrap` |

Dark mode overrides (grouped at the bottom of the `/* Knowledge Page */` section via `[data-theme="dark"]` selectors):

| Selector | Override |
|----------|----------|
| `[data-theme="dark"] .badge-scope-global` | `#1e3a5f` bg / `#93c5fd` text |
| `[data-theme="dark"] .badge-scope-repository` | `#14532d` bg / `#86efac` text |
| `[data-theme="dark"] .category-pill` | `var(--color-surface)` bg / `var(--color-text-muted)` text / `var(--color-border)` border |
| `[data-theme="dark"] .tag-chip` | `#3b0764` bg / `#d8b4fe` text / `#7e22ce` border |
| `[data-theme="dark"] .knowledge-move-input .form-control` | `var(--color-surface)` bg / `var(--color-text)` text / `var(--color-border)` border |

> **Dark-mode placement convention:** The Knowledge Page section places all `[data-theme="dark"]` overrides in a single block at the **bottom** of the section (after all light-mode rules), rather than co-locating each override with its light-mode counterpart. This is the preferred convention for new CSS sections. Earlier sections in `styles.css` use inline co-location — both patterns are valid, but the bottom-grouped approach is preferred going forward for readability.

> **Move input format:** The target repository input (`<input placeholder="target-repository-name">` inside `.knowledge-move-input`) expects a repository slug — a lowercase alphanumeric string with hyphens or underscores (matching `SLUG_REGEX` on the server, e.g. `my-project`, `ai-insights`). Entering a free-form display label will be rejected by the server with a `400 VALIDATION_ERROR`.

> **Fragility note:** `.knowledge-move-input .form-control` targets the child `.form-control` element for its dark override (consistent with the `.filter-bar` pattern). If the markup changes to no longer use `.form-control` as a direct child, the dark override will silently stop applying.

> Token-based classes (`.knowledge-tabs`, `.knowledge-tab`, `.confidence-label`, `.knowledge-actions`, `.knowledge-move-input`) adapt automatically via CSS custom properties — no explicit `[data-theme="dark"]` override is needed for them.

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
