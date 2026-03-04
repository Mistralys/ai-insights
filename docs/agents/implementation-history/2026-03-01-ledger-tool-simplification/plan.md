# Ledger Tool Simplification

## Summary

Reduce the number of MCP tools that "do work" agent personas (Developer, QA, Reviewer, Documentation) must invoke from 11–13 down to 4–5, achieving a **3-tool core loop** (ask → start → finish). The aim is to minimise off-script behaviour by making the correct workflow the easiest workflow.

## High-Level Approach

The server's `get_next_action` responses already tell agents exactly what to call. The simplification strategy is to collapse multi-step boilerplate sequences into single tool calls, embed mandatory information directly in responses that already exist, and trim persona tool tables to only the tools agents actually need.

Each recommendation is a self-contained work package. They can be implemented independently, though some have natural synergies (noted below).

## Rationale

Agents go off-script when they have too many tools and too many required sequences. The current ledger imposes 5–6 mandatory steps per work-package cycle:
1. Detect project
2. Get next action
3. Claim WP
4. Start pipeline
5. Complete pipeline
6. Get handoff status

Steps 1, 3–4, and 6 are pure boilerplate that the server can handle implicitly. Collapsing them removes decision points where agents make mistakes.

## Detailed Steps

### WP-1: Merge `get_next_action` / `get_next_actions` (Rec #4)

**Assigned to:** Developer

**Description:** Consolidate `ledger_get_next_action` and `ledger_get_next_actions` into a single tool with an optional `max_results` parameter (default `1`).

**Implementation:**
- In `workflow-batch-actions.ts`, remove the separate `ledger_get_next_actions` registration.
- In `workflow-next-action.ts`, add an optional `max_results` parameter to `GetNextActionSchema`.
- When `max_results > 1`, collect up to N results from the per-role action functions (requires refactoring the early-return pattern into a collector pattern).
- When `max_results` is `1` (default), preserve the current early-return behaviour exactly.
- Update `help-content.ts` to reflect the merged tool.
- Register only `ledger_get_next_action`.

**Dependencies:** None

**Acceptance Criteria:**
- `ledger_get_next_action` with no `max_results` returns a single action (backward-compatible).
- `ledger_get_next_action` with `max_results: 3` returns up to 3 actions.
- `ledger_get_next_actions` is no longer registered on the MCP server.
- All existing `workflow-next-action` and `workflow-batch-actions` tests pass (adapted as needed).
- `help-content.ts` updated; `api-surface.md` updated.

---

### WP-2: Trim persona tool tables (Rec #6)

**Assigned to:** Developer

**Description:** Remove low-frequency tools from persona YAML `mcp_tools` arrays. No server code changes.

**Tools to remove per persona:**

| Tool | Remove From |
|------|------------|
| `ledger_update_pipeline_progress` | Developer |
| `ledger_add_observation` | Developer |
| `ledger_get_project_status` | Developer, QA, Reviewer, Documentation (keep for PM and Synthesis) |

**Additional change:** Move `ledger_help` from a table row to a note/paragraph in the `mcp-tools-note.md` partial (keep in YAML so the tool is still discoverable, but de-emphasise it).

**Dependencies:** None

**Acceptance Criteria:**
- Persona YAML files updated; `node scripts/build-personas.js` succeeds.
- Generated persona files no longer list the removed tools in their tool tables.
- `ledger_help` remains available but is mentioned in prose rather than the table.

---

### WP-3: Implement `ledger_begin_work` (Rec #1)

**Assigned to:** Developer

**Description:** Create a new `ledger_begin_work` tool that combines claim + start pipeline in one atomic operation.

**Schema:**
```typescript
{
  project_path: string;
  work_package_id: string;
  type: 'implementation' | 'qa' | 'code-review' | 'documentation';
  agent_role: AgentRole;
}
```

**Implementation:**
- New file `src/tools/begin-work.ts` (or add to `work-package.ts`).
- Inside a single `withLock` scope:
  1. If WP is READY: run claim logic (CLAIMABLE_ROLES guard, dependency check, status transition, assignment).
  2. If WP is already IN_PROGRESS and `assigned_to` matches caller (or is PM override): skip claim.
  3. Run start-pipeline logic (ordering, rework detection, circuit breaker, agent_role guard).
- Return the same payload as `ledger_start_pipeline` (pipeline detail + WP summary).
- Keep `ledger_claim_work_package` and `ledger_start_pipeline` registered for PM use.

**Persona updates (after implementation):**
- Replace `ledger_claim_work_package` + `ledger_start_pipeline` with `ledger_begin_work` in Dev, QA, Reviewer, Docs YAML files.
- Update `next_steps` strings in `workflow-next-action.ts` to reference `ledger_begin_work` instead of the two-step sequence.

**Dependencies:** None (but natural synergy with WP-2)

**Acceptance Criteria:**
- `ledger_begin_work` on a READY WP claims it and starts the pipeline in one call.
- `ledger_begin_work` on an IN_PROGRESS WP (assigned to caller) starts the pipeline without re-claiming.
- All existing guards (CLAIMABLE_ROLES, dependency check, pipeline ordering, rework circuit breaker, agent_role validation) are preserved.
- New tests in `tests/tools/begin-work.test.ts`.
- Persona YAML files updated; `node scripts/build-personas.js` succeeds.
- `api-surface.md` and `help-content.ts` updated.

---

### WP-4: Embed handoff in `WAIT` responses (Rec #2)

**Assigned to:** Developer

**Description:** When `ledger_get_next_action` returns `action: WAIT`, compute and embed the `handoff_status` payload (including `auto_handoff` when eligible) directly in the response JSON.

**Implementation:**
- In each `getXxxAction()` function in `workflow-next-action.ts`, at the final `WAIT` return, call the same logic as `getHandoffStatus()` (from `workflow-handoff.ts`). Extract the handoff computation into a shared utility.
- Include `handoff_status` as a top-level key in the WAIT response:
  ```json
  {
    "action": "WAIT",
    "reason": "...",
    "handoff_status": { "current_agent": "...", "next_agent": "...", "status": "...", "auto_handoff": { ... } }
  }
  ```
- Keep `ledger_get_handoff_status` registered (PM and Synthesis use it explicitly; it's also a fallback).

**Persona updates:**
- In the handoff partial (`handoff-block-vscode.md`, `handoff-block-claude-code.md`), add: "If the `WAIT` response already includes `handoff_status`, use it directly instead of calling `ledger_get_handoff_status`."
- Remove `ledger_get_handoff_status` from Dev, QA, Reviewer persona YAML `mcp_tools` (keep for PM, Docs, Synthesis).

**Dependencies:** None

**Acceptance Criteria:**
- `ledger_get_next_action` WAIT responses include `handoff_status`.
- `handoff_status` includes `auto_handoff` when eligibility conditions are met.
- `ledger_get_handoff_status` still works independently.
- Persona handoff partials and YAML updated.
- Tests cover the embedded handoff data in WAIT responses.

---

### WP-5: Accept `cwd_path` fallback for `project_path` (Rec #3)

**Assigned to:** Developer

**Description:** On all tools that require `project_path`, add an optional `cwd_path` parameter. If `project_path` is omitted, auto-detect using the same logic as `ledger_detect_project`.

**Implementation:**
- Create a shared utility function (e.g., `resolveProjectPath(args)`) in `src/utils/path-validator.ts`:
  ```typescript
  async function resolveProjectPath(args: { project_path?: string; cwd_path?: string }): Promise<string> {
    if (args.project_path) return args.project_path;
    if (args.cwd_path) {
      const result = await LedgerStore.detectProjectByCwd(args.cwd_path);
      if (result.status === 'FOUND') return result.meta.plan_path;
      if (result.status === 'AMBIGUOUS') throw new Error('Multiple projects match cwd_path. Pass explicit project_path.');
      throw new Error('No project found for cwd_path. Initialize the project first.');
    }
    throw new Error('Either project_path or cwd_path is required.');
  }
  ```
- Update all tool schemas to make `project_path` optional and add `cwd_path` as optional.
- Add a Zod `.refine()` ensuring at least one is provided.
- At the top of each handler, call `resolveProjectPath(args)`.

**Persona updates:**
- Remove `ledger_detect_project` from all persona YAML `mcp_tools`.
- Remove the `mcp-preflight-detect.md` partial inclusion from content files.
- Simplify the pre-flight instructions to just "call `ledger_get_next_action` with `cwd_path`".

**Dependencies:** None

**Acceptance Criteria:**
- All tools accept `cwd_path` as a fallback for `project_path`.
- Passing both `project_path` and `cwd_path` uses `project_path`.
- Passing neither raises a clear validation error.
- `ledger_detect_project` remains registered but is no longer in persona tool tables.
- Persona partials and YAML updated; `node scripts/build-personas.js` succeeds.
- End-to-end test: agent calls `ledger_get_next_action(cwd_path: "/path/to/project")` and gets a valid action.

---

### WP-6: Auto-finalize WP on documentation PASS (Rec #5)

**Assigned to:** Developer

**Description:** When `ledger_complete_pipeline(type=documentation, status=PASS)` succeeds and all acceptance criteria are met, automatically transition the WP to COMPLETE within the same lock scope.

**Implementation:**
- In `pipeline.ts`, inside the `completePipeline` handler, after recording the PASS:
  1. Check if `type === 'documentation'` and `status === 'PASS'`.
  2. Check if all acceptance criteria are `met: true` (after applying any `acceptance_criteria_updates` from the current call).
  3. If yes: transition `wp.status` to `COMPLETE`, update root summary, set `status_changed_at`. Include `auto_finalized: true` in the response.
  4. If no: include `auto_finalize_blocked: true` and list the unmet criteria, so the agent knows to handle them.
- Preserve the existing Documentation-agent-only guard (this auto-finalize should only trigger when `agent_role` is `Documentation`).

**Persona updates:**
- Remove `ledger_update_work_package_status` from Documentation persona YAML `mcp_tools`.
- Update documentation persona content to explain that WP completion is automatic on pipeline PASS.

**Dependencies:** None (but WP-3 should be implemented first to avoid persona churn)

**Acceptance Criteria:**
- Doc pipeline PASS with all criteria met auto-transitions WP to COMPLETE.
- Doc pipeline PASS with unmet criteria does NOT auto-transition; response includes unmet criteria list.
- Doc pipeline FAIL does not trigger auto-finalize.
- Non-documentation pipeline PASS does not trigger auto-finalize.
- `ledger_update_work_package_status` still works independently for PM/edge-case use.
- Tests cover all four cases above.
- `api-surface.md`, `help-content.ts`, `constraints.md` updated.

---

## Dependencies and Sequencing

```
WP-1 (merge get_next_action/actions)  ──┐
WP-2 (trim persona tool tables)       ──┤── All independent; can be parallelised
WP-3 (ledger_begin_work)              ──┤
WP-4 (embed handoff in WAIT)          ──┘
                                         │
WP-5 (cwd_path fallback)              ──── Independent but best after WP-1..4 are stable
                                         │
WP-6 (auto-finalize on doc PASS)      ──── Independent but best last (business rule change)
```

All WPs are independent and can be parallelised. However, the recommended implementation order is WP-1 → WP-2 → WP-3 → WP-4 → WP-5 → WP-6 to minimise persona file churn (each later WP builds on the simplified state from earlier ones).

## Expected Outcome

After all six WPs, the typical "do work" agent loop shrinks from 6 tool calls to 3:

| Step | Before | After |
|------|--------|-------|
| 1 | `ledger_detect_project` | *(implicit via `cwd_path`)* |
| 2 | `ledger_get_next_action` | `ledger_get_next_action` |
| 3 | `ledger_claim_work_package` | *(implicit via `begin_work`)* |
| 4 | `ledger_start_pipeline` | `ledger_begin_work` |
| 5 | `ledger_complete_pipeline` | `ledger_complete_pipeline` |
| 6 | `ledger_get_handoff_status` | *(implicit via WAIT response)* |

Per-persona tool counts:

| Persona | Before | After |
|---------|:------:|:-----:|
| Planner | 0 | 0 |
| Project Manager | 4 | 4 |
| Developer | 13 | 5 |
| QA | 11 | 4 |
| Reviewer | 11 | 4 |
| Documentation | 13 | 4 |
| Synthesis | 9 | 6 |

## Assumptions and Constraints

- MCP protocol remains stateless — no session-scoped state.
- `ledger_claim_work_package`, `ledger_start_pipeline`, `ledger_update_work_package_status`, and `ledger_detect_project` all remain registered on the server for backward compatibility and PM/edge-case use — they are just removed from persona tool tables.
- `agent_role` remains a required parameter on all tools as a safety guard.
- The `ledger_begin_work` tool must preserve ALL existing guards — this is a convenience wrapper, not a relaxation of rules.

## Out of Scope

- Session-scoped `project_path` memory (MCP is stateless).
- Continuation-token / `ledger_do` API (too large an architectural change for now).
- Removing `agent_role` parameter (needed as a safety guard).
- Changes to the Planner or Project Manager workflows.

## Testing Strategy

- Each WP requires unit tests for the new/modified tool logic.
- Integration test: full workflow cycle (PM creates WP → Dev claims+implements → QA → Reviewer → Docs → Synthesis) using only the simplified tool set.
- Regression: all existing tests must pass (modified as needed for renamed/merged tools).

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `ledger_begin_work` hides claim failure reasons from agents | Return the same detailed error messages as `ledger_claim_work_package`. |
| Embedded handoff in WAIT adds latency to every `get_next_action` call | Handoff computation is lightweight (reads root index already loaded); measure before optimising. |
| `cwd_path` auto-detection hits AMBIGUOUS in multi-project workspaces | Return a clear error with the candidate list, telling the agent to pass explicit `project_path`. |
| Auto-finalize changes a business rule agents may rely on | Only triggers for `documentation` + `PASS` + all criteria met — a case where manual finalize never fails today. |
