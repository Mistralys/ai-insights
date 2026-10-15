# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.12.0
- Architectural Reviews: none — Plan Architect Reviewer v2.3.4

## Prior Project Context

- **Strategic alignment:** The repository's long-term secondary goal is reliability "operationally for the orchestrator headless workflow". This plan moves a PM-stage safeguard out of persona wording and into the server, so a headless run cannot reach execution with a damaged ledger.
- **P02 (`2026-10-08-p02-unfixable-verifier-chain-validation`)** set the precedent this plan follows: a mechanical, manifest-derived backstop in the ledger server, with spec-first sequencing and no re-validation of pre-existing data.
- **P03 (`2026-10-09-p03-rework-limit-headless-completion`, DEV workspace)** showed that a server-side refusal needs its orchestrator consumer shipped in the same release (insight `5e041ed3-319a-40db-8a06-d92ebd2ade1e`). This plan ships the setup gate together with its supervisor branch. P03 also shows that DEV is ahead of STABLE (it reports spec v2.8.0 against STABLE's 2.6.0), so every version number in this plan is resolved from the changelog head at implementation time.
- **Insight `f32724d7-679f-4f77-9168-f24ab6e48b44`** (one bounded remediation pass, then terminate) shapes both the PM's "reset and re-register once" rule and the orchestrator's single PM re-entry.
- **Insight `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d`** (plain-function modules for stateless helpers) shapes `src/utils/setup-phase.ts` and `src/utils/dependency-graph.ts`.
- **Insight `ab304b5b-a928-447e-a5e3-ba496adadfba`**: new test fixtures must use `YYYY-MM-DD-name` plan-path basenames.
- **Insight `53454e24-4329-4946-ab9f-3b94cd682f17`**: regenerate `.context/` after manifest edits.
- **Incident (2026-10-08, `composer-local-switcher/2026-10-08-switch-output-and-version-guard`):** two concurrent Bootstrappers registered WP-009 and WP-011 as exact-title duplicates of WP-008 and WP-010. The duplicates were then cancelled, so the project started execution with two CANCELLED WPs. An exact (normalized) title comparison detects both duplicates.

## Knowledge Base Reconciliation

| Insight ID | Title | What the plan overtakes | Executed by |
|------------|-------|-------------------------|-------------|
| cdaf1471-5d14-4890-91d2-243a4a2c4896 | Verify pipeline stage configuration immediately after WP creation — no tool exists to patch it later | Its recovery advice, "if caught before any stage has started, cancel and recreate the WP under a new ID", no longer holds for ledger projects. Before commit, the server rejects cancellation, and the correction is `ledger_reset_setup` followed by re-registration from WP-001. After commit, cancel-and-recreate remains the rule. The insight's "no tool exists to patch it later" framing should be scoped to the execution phase. | Ledger Knowledge Curator v1.4.2 (Targeted Reconciliation) |

## Summary

This plan adds an explicit **SETUP** phase to every newly initialized ledger project and ends it with a server-enforced commit gate. The project leaves the PM stage as a clean, consistent ledger with no CANCELLED work packages. From `ledger_initialize_project` until the Project Manager calls the new `ledger_commit_setup`, the project status is `SETUP`. In that state nobody can claim a WP, start a pipeline or change a WP's status, `ledger_get_next_action` hands work only to the PM, and the only correction is the new PM-only `ledger_reset_setup`. It discards the whole draft WP set, so re-registration starts again at WP-001 with gapless IDs. The commit validates the WP set and fails with every violation listed: no CANCELLED WP, no duplicate titles, every dependency resolves, the graph is acyclic, every stage list is valid, every WP is in its initial state, and the WP count optionally matches a count the PM passes in. Only a passing commit moves the project to `READY` and starts the workflow. Projects created before this change are treated as already committed. The workflow specification is updated first, then the shared manifest, the MCP server, the GUI and the orchestrator. The PM, Bootstrapper, Claude Coordinator and Ledger Doctor personas follow.

## Architectural Context

- **Workflow specification** (`mcp-server/docs/agents/workflow-specification/`) is authoritative. §5 (`state-machines.md`) defines the project lifecycle: init → `READY`, then implicit transitions. §17.2 (`auxiliary-systems.md`) defines self-healing rules keyed on the four project statuses. It requires any status-model extension to add matching healing rules. §15.2 (`dependencies-and-rework.md`) offers "cancel WP-005 and recreate it" as a phase-agnostic workaround. Root `AGENTS.md` mandates the order spec → implementation → tests → `constraints-workflow.md`.
- **Shared manifest** (`shared/workflow-manifest.json`) is the single source of truth for status vocabularies. `statuses.project` feeds `ProjectStatus` in `mcp-server/src/schema/enums.ts`. The `terminal_work_package` subset key is consumed by TS and by `orchestrator/src/config.py` (`WP_TERMINAL_STATUSES`). Structure is enforced by `shared/workflow-manifest.schema.json`, `mcp-server/src/schema/workflow-manifest-schema.ts` and `scripts/validate-workflow-manifest.js`.
- **MCP server storage** (`mcp-server/src/storage/ledger-store.ts`): all WP + root writes go through `updateWorkPackageWithSync`, `createWorkPackageWithSync` and `batchUpdateWorkPackagesWithSync` under a per-project lock (21 tool-side call sites of the two update methods). No WP-file deletion method exists.
- **MCP server tools**: `src/tools/project-lifecycle.ts` holds `initializeProject` (writes `status: 'READY'`), the pure `computeHealedStatus`, `getProjectStatus`, `listProjects` and `completeSynthesis`. `src/tools/work-package.ts` holds `createWorkPackage`, which uses max-based ID generation and a private `hasCycle`, and flips the project `READY → IN_PROGRESS` on first creation, which contradicts spec §5.3. It also holds the claim and status tools. `src/tools/begin-work.ts` and `src/tools/pipeline.ts` hold the pipeline tools. `src/tools/workflow-next-action.ts` (`getNextActionCore`) and `src/tools/workflow-handoff.ts` (`getHandoffStatus`, `computeHandoffStatus`, which duplicate an "all BLOCKED" short-circuit) do the routing. `src/tools/help-content.ts` (`TOOL_HELP`) is the agent-facing tool documentation.
- **Startup** (`mcp-server/src/index.ts`) registers each tool module and logs a hand-maintained list of tool names.
- **GUI** (`mcp-server/gui/`): `api.ts` keeps a hand-maintained `VALID_STATUS_FILTERS` set. `public/views/project-list.js` builds its status options by hand. Status badges come from CSS classes `badge-{status}` (`public/components.js`, `public/styles.css`). `project-detail.js` hosts the status badge and the "Reset Project" action (`handleResetProject` → `src/utils/project-reset.ts`).
- **Orchestrator** (`orchestrator/src/supervisor.py`): pure-Python routing. It reads project status and WP list, routes to PM when there are no WPs and to synthesis when every WP is terminal, otherwise to the first role with a dispatchable `ledger_get_next_action`. If every role returns WAIT, it falls through to synthesis. Every stage receives every MCP tool (`orchestrator/src/nodes/__init__.py`), so new server tools reach the Deep Agents PM without wiring.
- **Personas**: the PM (`personas/ledger/src/content/2-project-manager.md`, v3.12.1 in the working tree) runs four sub-agents and ends with verification and handoff. Its Strict Constraints forbid a second Bootstrapper, resuming a partial bootstrap and recreating a registered WP. The Bootstrapper (`personas/ledger-support/src/content/ledger-bootstrapper.md`, v1.5.0) initializes the ledger and registers WPs, and stops on an occupied ledger.

## Approach / Architecture

### 1. The setup phase as a project status

- `shared/workflow-manifest.json` gains `SETUP` as the first entry of `statuses.project`, plus a new key `statuses.setup_project: "SETUP"` (validated to be a member of `statuses.project`). TS and Python derive their setup constant from this key, the same way both derive terminal statuses from `terminal_work_package`.
- `initializeProject` writes `status: SETUP`.
- **SETUP is sticky.** It is left only through `ledger_commit_setup`. No healing rule matches it: §17.2 gains an explicit Rule 0, "SETUP → preserved", and `computeHealedStatus` short-circuits on it. `createWorkPackage` never changes it, because its flip is conditional on `READY`. `completeSynthesis` rejects it.
- **Phase predicate.** "In setup" means `status === SETUP`. Every other status — including every pre-existing project — is the execution phase. That rule *is* the backward-compatibility rule; no migration runs.

### 2. Default-deny guard at the storage choke point

- New module `mcp-server/src/utils/setup-phase.ts` (plain functions) exports:
  - `SETUP_PROJECT_STATUS`, derived from the manifest.
  - `isSetupPhase(root)`.
  - `class SetupPhaseError extends Error`, which carries a uniform agent-facing message naming `ledger_commit_setup` and `ledger_reset_setup`.
  - `validateSetupCommit(root, details, expectedCount?) → SetupCommitViolation[]`, a pure function (see §4).
- `LedgerStore.updateWorkPackageWithSync` and `batchUpdateWorkPackagesWithSync` gain an optional trailing `options?: { allowInSetup?: boolean }`. Inside the lock, after reading the root, they throw `SetupPhaseError` when `isSetupPhase(root) && !options?.allowInSetup`.
  - Every one of the 21 existing WP-mutating call sites is gated without editing it: claim, begin-work, start/complete/cancel/progress pipeline, observations, status transitions (including → CANCELLED), dependency propagation, rework reset, cancelled-WP reopen, and the GUI project reset.
  - Any future WP-mutating tool is gated by default.
  - The single explicit opt-in is `updateAcceptanceCriteria`, a PM-only correction that is legitimate during setup.
  - `createWorkPackageWithSync` is unaffected: creation is the purpose of setup.
- Tool-level error mapping: every tool's existing `catch` already returns `isError` with the message. The message itself carries the next step. The GUI maps `SetupPhaseError` to an HTTP 409 `ApiError`.

### 3. `ledger_reset_setup` — whole-set reset, PM only, SETUP only

- New tool in new module `mcp-server/src/tools/setup-phase.ts`.
- Parameters: `project_path`/`cwd_path`, `agent_role` (must be `"Project Manager"`) and `reason` (required, `trim().min(1)`).
- New `LedgerStore.discardAllWorkPackagesInSetup()` runs under the project lock:
  1. Re-reads the root and re-asserts SETUP. A project already committed is rejected.
  2. Captures the discarded WP IDs and titles.
  3. Writes the root with `work_packages: []` and counters at 0, then appends a `decision` project comment from the Project Manager with the reason and the discarded IDs/titles.
  4. Only then unlinks each `{wpId}.json`, tolerating `ENOENT`.
- Writing the root first is crash-safe. An orphan WP file left by a crash is invisible, because listings come from the root index, and the next registration overwrites it, because `createWorkPackage`'s max-based ID generator restarts at WP-001 on an empty set. This yields gapless IDs with no renumbering.
- With zero WPs the call is a no-op that still succeeds and still records the comment.
- The response's `--- NEXT STEP ---` block tells the PM to dispatch the Ledger Bootstrapper once more. The Bootstrapper finds the initialized SETUP ledger empty and registers from WP-001, so draft numbers equal ledger IDs.

### 4. `ledger_commit_setup` — the PM's final step

- Parameters: `project_path`/`cwd_path`, `agent_role` (must be `"Project Manager"`) and `expected_work_package_count` (optional, `positiveIntInput()`).
- Under the project lock it re-reads the root and every WP detail, rejects a project that is not in SETUP, and runs `validateSetupCommit`. That function collects **all** violations, each `{ code, work_package_ids, message }` (code is a string-literal union). The checks are:
  - `EMPTY_SET` — no WPs.
  - `CANCELLED_WP` — defense in depth; the store guard already makes this unreachable through the tools.
  - `NOT_INITIAL_STATUS` — any WP other than READY/BLOCKED, or any WP carrying pipelines.
  - `INITIAL_STATUS_MISMATCH` — status disagrees with §15.1. A WP is READY iff it has no dependencies, since in setup no dependency is terminal.
  - `DUPLICATE_TITLE` — normalized title comparison.
  - `UNRESOLVED_DEPENDENCY` — an unknown ID or a self-reference.
  - `DEPENDENCY_CYCLE` — a whole-graph check through the extracted `dependency-graph.ts`.
  - `INVALID_STAGES` — `validateActiveStages(stages).errors` non-empty.
  - `SUMMARY_DETAIL_MISMATCH` — §21.9: status, dependencies or `active_pipeline_stages` differ between summary and detail.
  - `COUNT_MISMATCH` — only when `expected_work_package_count` was given.
- **On violations:** `isError` lists every violation, and the NEXT STEP tells the PM to call `ledger_reset_setup` and re-register once, and to escalate if a second commit fails. Nothing is written.
- **On success:**
  - Status becomes `READY`. Defensively, it becomes `BLOCKED` if no WP is READY, which is unreachable by construction because the first-registered WP has no dependencies.
  - New optional root field `setup_committed_at` is set to `now()`.
  - A `decision` project comment records the committed count.
  - The response NEXT STEP points to `ledger_get_handoff_status`.
- Commit is not idempotent by design. A second call on a committed project is rejected with "not in SETUP", which is safe and explicit.

### 5. Routing in setup

- **`getNextActionCore`:** right after reading the root, before the zero-WP branch and before the batch branch, if `isSetupPhase(root)`:
  - PM gets `CREATE_WORK_PACKAGES` (zero WPs) or the new `COMMIT_SETUP` action (WPs present; reason carries the WP count and the commit/reset instructions).
  - Every other role gets `WAIT` with reason "Project is in SETUP — the Project Manager has not committed the work-package set", via `embedHandoffStatusInWait`.
  - The batch path is covered because the gate precedes it.
- **Handoff:** new helper `resolveProjectLevelHandoff(rootIndex, agentRole)` in `workflow-handoff.ts` holds the setup short-circuit and the existing "all BLOCKED" short-circuit. Both `getHandoffStatus` and the `computeHandoffStatus` fast path call it instead of their duplicated inline copies. In SETUP:
  - Planner gets `READY_FOR_PM`.
  - PM gets `IN_PROGRESS` ("commit setup with `ledger_commit_setup` before handing off").
  - Every other role gets `WAIT`.

### 6. Tool registration log becomes self-maintaining

- New `mcp-server/src/utils/tool-registry-log.ts` exports `recordToolRegistrations(server)`. It wraps `server.registerTool` once, before the `register(server)` calls, and records every name. `index.ts` logs the recorded list instead of the hand-maintained string. Adding `ledger_commit_setup` and `ledger_reset_setup` needs no log edit, and neither will any later tool.

### 7. GUI

- **Server:** `VALID_STATUS_FILTERS` in `gui/api.ts` is derived from `ProjectStatus.options` plus `ACTIVE`/`ALL`. This adds `SETUP` and drops the invalid `CANCELLED`. `ACTIVE` already includes every non-ARCHIVED status, so SETUP projects are listed by default. `handleResetProject` maps `SetupPhaseError` to 409 `CONFLICT`.
- **Client:**
  - `.badge-setup` gets its own colour token pair, light and dark, in `styles.css`.
  - A `Setup` option is added to `buildStatusOptions`.
  - `project-detail.js` shows an info banner on SETUP projects ("Setup in progress — the work packages below are a draft until the Project Manager commits them; they can still be discarded and re-registered") and disables the "Reset Project" button with an explanatory `title`.
  - On committed projects that carry `setup_committed_at`, the project meta line shows "Setup committed {date}".

### 8. Orchestrator

- `config.py` gains `PROJECT_SETUP_STATUS = _MANIFEST["statuses"]["setup_project"]`.
- `WorkflowState` gains `setup_pm_passes: int`. It is read with `.get(…, 0)` everywhere, so checkpoints from older runs resume cleanly.
- The supervisor gains a **setup branch**, evaluated after the ledger reads and before the "no WPs" and "all terminal" exits. The rule: while the project is in SETUP, or no ledger exists yet on iteration 1, every PM route increments `setup_pm_passes`.
  - On the third would-be PM pass — the initial pass plus one re-entry — the supervisor ends the run, as it does for `fatal_error`. It logs action `setup_uncommitted` at ERROR level and appends an error naming the project, its WP count and the instruction to inspect the ledger and plan folder. No user action is awaited mid-run.
  - A re-entry routes to PM with log action `setup_reentry`.
- The existing unbounded "no WPs → PM" loop becomes bounded by the same counter.
- `COMMIT_SETUP` is added to `_DISPATCH_ACTIONS` (PM) for forward-compatible parsing.
- `nodes/pm.py` renders a re-entry note into the prompt when `setup_pm_passes >= 1`: "The ledger is in SETUP with {n} work packages. Resume at verification and commit; do not decompose again."

### 9. Personas

- **PM (3.13.0)**:
  - `mcp_tools` gains `ledger_commit_setup`, `ledger_reset_setup` and `ledger_add_project_comment`; the stale `ledger_get_work_package` purpose is fixed.
  - The "Important notes" now say the project starts in SETUP and stays there until commit.
  - Strict Constraints:
    - "Never resume or repair a partial bootstrap" becomes "Repair a failed bootstrap only by reset: call `ledger_reset_setup` and dispatch the Bootstrapper once more. Never more than once per run; a second failure is escalated."
    - "Never recreate a registered WP — you have no tool to cancel one" becomes "Never cancel or recreate a WP during setup; the server rejects cancellation, and the reset is the only correction."
  - Steps 9 and 10 keep their pre-Bootstrapper placement. Their rationale now reads "correcting after registration costs a full reset and re-registration".
  - Step 12 (verify) compares the ledger against the draft. On a mismatch or failure report it resets and re-registers once.
  - New step 13 commits with `expected_work_package_count` set to the draft's WP count. On a commit failure it resets and re-registers once. A second failure is escalated.
  - Handoff becomes step 14.
  - **Escalation is target-aware.** IDE targets report to the user and stop. `target_deep_agents` records a `ledger_add_project_comment` of type `incident` (with `context` os/tool/resolved:false) and ends the turn without committing. The orchestrator's setup branch then terminates the run, so nothing waits on a person.
  - A new **Re-entry** rule: when `ledger_get_project_status` shows SETUP with WPs and all three draft files exist, the PM skips to step 12.
- **Bootstrapper (1.6.0)** stays create-only. Step 2 now covers the "ledger already exists" case: where `ledger_get_project_status` reports SETUP with zero WPs (a PM reset), it skips initialization and proceeds to Step 3. Any other existing ledger is reported and stops the run, as before. Constraints name the reset and the commit as the PM's tools, never the Bootstrapper's.
- **Claude Coordinator:** the PM dispatch-map row adds "or project in SETUP (commit pending)".
- **Ledger Doctor:** new symptom "Project stuck in SETUP" (route to PM; never commit or reset on the PM's behalf without the user). The state reference gains the SETUP project status.

## Rationale

- **Status, not a separate flag.** The user's decision frames setup as a project-level state. A status is visible everywhere a project is listed — the GUI, `ledger_list_projects`, the orchestrator's `project_status` — with no new plumbing, and it fits the manifest's status vocabularies. Self-healing already preserves any status no rule matches, so SETUP is sticky by construction. Rule 0 makes that explicit, as §17.2's completeness note requires.
- **Default-deny at the storage choke point.** A per-tool guard list would be a hand-maintained list of 15+ tools that every new tool must remember. The two update sync methods are already the only legal path for WP mutation (enforced by the `writeWorkPackage` JSDoc contract). Gating them inside the lock is race-free against a concurrent commit and covers future tools automatically. The single opt-in is visible at its call site.
- **Whole-set reset only.** This resolves the open question: per-WP delete, whole-set reset, or both.
  - A per-WP delete leaves ID gaps, or forces renumbering. Renumbering breaks the free-text WP cross-references inside descriptions ("after WP-008 lands").
  - Re-registering a subset needs the Bootstrapper to register into an occupied ledger with translated dependency numbers. That is exactly the resume behaviour that produced the incident's wrong dependencies, and PM 3.12 / Bootstrapper 1.5.0 now forbid it.
  - A whole-set reset keeps IDs gapless with no renumbering, keeps draft numbers equal to ledger IDs, and leaves the Bootstrapper's "empty ledger" precondition intact. It costs one re-registration (10–30 s per WP), which is acceptable for a once-per-run correction.
- **Commit reports all violations at once.** The PM's only remedy is a full reset, so one complete report is enough to decide on it. Fail-fast would hide the rest.
- **`expected_work_package_count` is optional.** The persona always passes it, and it is what catches a racing extra registration. Keeping it optional preserves non-persona callers (tests, the Doctor).
- **Bounded orchestrator re-entry.** One re-entry recovers a PM that ended without committing, for example an old persona or a dropped final call. A second miss is a real defect; terminating keeps the run from burning `max_iterations`, and matches insight `f32724d7`.
- **Backward compatibility by predicate.** Any status other than SETUP is execution, so existing projects — including mid-flight ones and ones already holding CANCELLED WPs — keep working unchanged. No data migration, no new failure mode on read.
- **Speculative structure check.** Every new structure has a named consumer or trajectory:
  - `setup_committed_at` → GUI meta line, plus setup-duration analysis next to `duration_ms`.
  - `statuses.setup_project` → TS and Python constants.
  - `SetupCommitViolation.code` → test assertions and the persona's report.
  - `allowInSetup` → `updateAcceptanceCriteria`.
  - `resolveProjectLevelHandoff` → two existing call sites.
  - `dependency-graph.ts` → creation and commit.
  - `tool-registry-log.ts` → startup log.
  - Nothing is marked speculative.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Representing setup | `SETUP` project status, sticky, from manifest | Orthogonal `phase`/`setup_committed` root field; opt-in flag on `ledger_initialize_project` | A status shows up in every existing listing and filter for free. A separate field needs parallel plumbing and can disagree with status. An opt-in flag would make the guarantee optional, against the user's "enforced by the server" requirement. |
| Where the guard lives | Default-deny in `updateWorkPackageWithSync` / `batchUpdateWorkPackagesWithSync` with an `allowInSetup` opt-in | Explicit `assertExecutionPhase()` call in each tool | Per-tool calls are a hand-maintained list that a future tool can forget. The store is the one path every WP mutation already takes, under the lock. |
| Correction operation | Whole-set `ledger_reset_setup` | Per-WP delete; suffix truncation ("discard from WP-N"); both | Delete leaves gaps or forces renumbering against free-text references. Truncation needs a partial re-registration into an occupied ledger, the incident's failure mode. Reset alone is gapless and keeps the Bootstrapper's empty-ledger rule. |
| Commit failure reporting | Collect every violation | Fail on first violation | The remedy is always a full reset, so the full list costs nothing extra and prevents a second failed commit for a different reason. |
| Legacy projects | Treated as committed (status ≠ SETUP) | Migrate READY+0-WP projects to SETUP; re-validate legacy WP sets | Neither can tell an old draft from a deliberate state. Migration would strand mid-flight projects with CANCELLED WPs behind a commit they cannot pass. |
| Orchestrator handling | Explicit supervisor setup branch with one bounded PM re-entry | Rely on `COMMIT_SETUP` as a normal dispatch action; terminate immediately | Normal dispatch can loop until `max_iterations`. Immediate termination discards a cheaply recoverable miss. |
| Headless escalation | Incident project comment + uncommitted end of turn; supervisor terminates | PM waits for user input | A headless run has no user; waiting stalls the run. |
| Duplicate-title helper | Shared normalizer reused by the commit check and the in-flight create-time rejection | Separate commit-only comparison | Two normalizers would let create and commit disagree on what a duplicate is. |
| Startup tool log | Record names at `registerTool` time | Keep the hand-maintained string and add two names | The string is a list someone must remember on every tool change. Recording at registration removes that obligation. |

## Pattern Alignment

- **Follows** spec-first sequencing for workflow logic — root `AGENTS.md` "Change workflow logic" row.
- **Follows** manifest-derived subset keys — `statuses.terminal_work_package` in `shared/workflow-manifest.json` and `orchestrator/src/config.py` (`WP_TERMINAL_STATUSES`). `setup_project` mirrors it as a single string, because exactly one status is the setup status.
- **Follows** one tool module per concern with `register(server)` and `_internal` exports — `mcp-server/src/tools/standalone-import.ts`.
- **Follows** PM-only administrative tools with mandatory `reason` and an audit project comment — `ledger_reopen_cancelled_wp` in `mcp-server/src/tools/work-package.ts`.
- **Follows** tool-level `withLock` + re-read + validate + write — `completeSynthesis` in `mcp-server/src/tools/project-lifecycle.ts`.
- **Follows** `--- NEXT STEP ---` guidance in tool responses — `buildStatusTransitionGuidance` in `work-package.ts`.
- **Follows** plain-function modules for stateless helpers — `mcp-server/src/storage/repository-registry.ts` (insight `f389f9ce`).
- **Follows** supervisor special exits logged via `_log_entry` and documented in `orchestrator/docs/supervisor-routing.md`.
- **Follows** per-target persona conditionals (`target_deep_agents`) — `personas/ledger/src/content/2-project-manager.md` step 5.
- **Departs from** the §6.2 invariant that a CANCELLED-reachable WP state machine applies uniformly. During SETUP, all WP transitions are rejected and WPs can be *deleted*. Justification: the user decided that the traceability rule (cancel-not-delete) applies only once the workflow starts, and the planning trail already lives in the plan-folder files.
- **Departs from** the "no WP deletion" storage convention (`LedgerStore` has no delete). Justification: the deletion is confined to one SETUP-only, lock-scoped, root-first method.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/tools/work-package.ts` → private `hasCycle` | Commit needs a whole-graph cycle check; a second copy would drift | Promoted to step 6 | Extract to `src/utils/dependency-graph.ts` (`hasCycle`, `findCycle`) used by creation and commit |
| `mcp-server/src/tools/workflow-handoff.ts` → duplicated "all BLOCKED" short-circuit in `getHandoffStatus` and `computeHandoffStatus` | The setup short-circuit would make a third copy | Promoted to step 10 | One `resolveProjectLevelHandoff` helper serves both paths |
| `mcp-server/src/index.ts` → hand-maintained registered-tools log string | Every new tool must remember to edit it; this plan adds two | Promoted to step 9 | Recording at `registerTool` time removes the manual list permanently |
| `mcp-server/src/tools/project-lifecycle.ts` → `ListProjectsSchema.status` uses `WorkPackageStatus` | Wrong enum: allows `CANCELLED`, rejects `ARCHIVED` and would reject `SETUP` | Promoted to step 8 | Switch to `ProjectStatus`; required anyway for filtering SETUP projects |
| `mcp-server/gui/api.ts` → hand-maintained `VALID_STATUS_FILTERS` (contains non-project `CANCELLED`) | Duplicates the manifest vocabulary by hand | Promoted to step 12 | Derive from `ProjectStatus.options` + `ACTIVE`/`ALL` |
| `mcp-server/gui/public/views/project-list.js` → hand-maintained `buildStatusOptions` | Client-side duplicate of the vocabulary | Rejected | Browser JS cannot import the manifest, and deriving options from `status_counts` would hide zero-count statuses; adding one option is cheaper than a new API field |
| `mcp-server/src/tools/work-package.ts` → `READY → IN_PROGRESS` flip on WP creation contradicts spec §5.3 | Pre-existing spec/code drift in the code this plan touches | Rejected | Under SETUP the flip never fires for new projects (status is SETUP, not READY). For post-commit creation the flip is long-standing behaviour other tests rely on; changing it is a separate behavioural change. Step 2 documents the actual behaviour in §5.3 instead of leaving the contradiction. |
| `mcp-server/src/storage/ledger-store.ts` → update sync methods as the sole WP-mutation choke point | Ideal seam for the phase guard | Promoted to step 5 | Default-deny guard with explicit opt-in |
| `mcp-server/docs/agents/workflow-specification/dependencies-and-rework.md` §15.2 cancel-and-recreate workaround | Phase-agnostic wording is wrong before commit | Promoted to step 2 | Scope it to the execution phase and point setup corrections at the reset |
| `personas/ledger/src/meta/2-project-manager.yaml` → stale `ledger_get_work_package` purpose | Refers to a spec-file AC comparison removed in 3.8.0 | Promoted to step 16 | Same file is already being edited for the new tools |
| `personas/ledger/src/content/2-project-manager.md` → "no tool to cancel one" rationale in Strict Constraints, steps 9 and 10 | Becomes false with a reset tool | Promoted to step 16 | Rewritten together with the constraint changes |
| `personas/ledger-support/src/content/ledger-bootstrapper.md` → "ledger already exists → ask the user" | Would block re-registration after a reset | Promoted to step 17 | Narrow exception for an empty SETUP ledger |
| `orchestrator/src/supervisor.py` → unbounded "no WPs → PM" route | Loops until `max_iterations` if the PM never registers | Promoted to step 14 | Bounded by the same `setup_pm_passes` counter |

## Detailed Steps

1. **Baseline test run (no dependencies, before any change).**
   - Run `npm test` in `mcp-server/`, `pytest` in `orchestrator/` and `node scripts/build-personas.js --check` at the root.
   - Record pass/fail counts and the names of failing tests in the implementation pipeline summary, so pre-existing failures (e.g. live-LLM orchestrator tests that need an API key) are not attributed to this change.
   - Check whether the in-flight duplicate-title change has landed a title normalizer in `mcp-server/src/` and record the answer for step 6.

2. **Workflow specification first** (`mcp-server/docs/agents/workflow-specification/`):
   - `state-machines.md` §5.1: initial `status = SETUP`.
   - §5.2: add a `SETUP` row — "Draft ledger; WPs may be created and discarded; no WP state changes; left only by commit".
   - §5.3: add "SETUP → READY only via `commitSetup`", state that no implicit transition enters or leaves SETUP, and correct the claim/creation sentence to the actual behaviour: creation on a `READY` project flips it to IN_PROGRESS; claim flips READY → IN_PROGRESS.
   - New §5.4 "Setup Phase": predicate, sticky rule, gated operations (all WP mutations except AC edits), legacy rule (status ≠ SETUP ⇒ execution).
   - `auxiliary-systems.md` §17.2: Rule 0 "SETUP → preserved (no other rule evaluated)". Update the completeness note.
   - `operations.md`:
     - New §9c "Committing Setup": algorithm, the ten violation codes, success writes.
     - New §9d "Resetting Setup": algorithm, root-first write order, gapless-ID argument.
     - §9b.1 note: creation is allowed in SETUP and does not change project status.
     - Notes in §10, §10b, §11, §12 that each rejects in SETUP.
   - `handoff.md`: new §13.0 "Project-level short-circuits (setup, all-BLOCKED)" with SETUP outcomes per role. Update Planner and PM pseudocode references.
   - Document the `COMMIT_SETUP` action next to `CREATE_WORK_PACKAGES` in the next-action section. Verify which file holds it during implementation: `operations.md`, or `pipeline-routing.md`/`handoff.md` per the README Quick Section Reference.
   - `dependencies-and-rework.md` §15.2: scope workaround (a) to the execution phase; add "during SETUP, correct via §9d reset and re-registration".
   - `data-model.md` §3.1: `SETUP` status, `setup_committed_at` field.
   - `edge-cases.md`:
     - New §21.73 "Setup Phase Invariants": no CANCELLED WP can exist at commit; deletion only in SETUP; SETUP never self-heals.
     - New §21.74 "Legacy Projects Are Committed by Definition".
     - New §21.75 "Concurrent Registration During Setup": duplicate titles plus count mismatch caught at commit.
   - `walkthrough.md`: insert the commit step.
   - `README.md`: bump **Version** to the next minor above the current value and add a changelog entry listing every section touched. Add `statuses.setup_project` to the Machine-Readable Vocabulary table.

3. **Shared manifest**:
   - `shared/workflow-manifest.json`: `statuses.project = ["SETUP","READY","IN_PROGRESS","COMPLETE","BLOCKED"]`, new `"setup_project": "SETUP"`, and `spec_version` set to the step-2 spec version.
   - `shared/workflow-manifest.schema.json`: add `setup_project` (string, minLength 1) to `statuses.properties` and `required`.
   - `mcp-server/src/schema/workflow-manifest-schema.ts`: mirror it in `StatusesSchema`.
   - `scripts/validate-workflow-manifest.js`: validate that `setup_project` is a string and a member of `statuses.project`.

4. **MCP server schema**:
   - `mcp-server/src/schema/enums.ts`: extend the `ProjectStatus` tuple cast with `'SETUP'`.
   - `mcp-server/src/schema/root-index.ts`: add `setup_committed_at: z.string().nullable().optional()`.

5. **Setup-phase utility + storage guard**:
   - Create **new** `mcp-server/src/utils/setup-phase.ts` with `SETUP_PROJECT_STATUS` (manifest-derived via `workflowManifest.statuses.setup_project`), `isSetupPhase`, `SetupPhaseError` and the `SetupCommitViolation` type with its `code` union.
   - `validateSetupCommit` lands in step 6 once its dependencies exist.
   - `mcp-server/src/storage/ledger-store.ts`:
     - Add `options?: { allowInSetup?: boolean }` to `updateWorkPackageWithSync` and `batchUpdateWorkPackagesWithSync`, throwing `SetupPhaseError` inside the lock after reading the root.
     - Add `discardAllWorkPackagesInSetup(reason, agent)`, which returns the discarded `{work_package_id,title}[]`. Root first, then the comment, then the `unlink` loop tolerating `ENOENT` (`fs/promises.unlink`; cross-platform).
   - Update both JSDoc blocks.
   - `mcp-server/src/tools/work-package.ts` → `updateAcceptanceCriteria`: pass `{ allowInSetup: true }`.

6. **Shared validation helpers**:
   - Create **new** `mcp-server/src/utils/dependency-graph.ts` exporting `hasCycle(newId, deps, summaries)` (moved verbatim from `work-package.ts`) and `findCycle(summaries): string[] | null` (whole-graph DFS). `createWorkPackage` imports `hasCycle` from it.
   - Duplicate-title normalizer: if the in-flight duplicate-title change has already landed an exported normalizer, import it. Otherwise create **new** `mcp-server/src/utils/wp-titles.ts` exporting `normalizeWpTitle(title)` (trim, collapse internal whitespace, case-fold) and `findDuplicateTitles(summaries): string[][]`. Leave a JSDoc note that `ledger_create_work_package`'s duplicate rejection must use the same normalizer.
   - Implement `validateSetupCommit(root, details, expectedCount?)` in `setup-phase.ts` using `findCycle`, `findDuplicateTitles` and `validateActiveStages` (`mcp-server/src/utils/pipeline-maps.ts`).

7. **Setup tools** — create **new** `mcp-server/src/tools/setup-phase.ts`:
   - `ledger_commit_setup` and `ledger_reset_setup` as specified in Approach §3–§4: Zod schemas with `.describe()` texts, PM role guard against `AGENT_ROLES`, `resolveProjectPath` + `resolveMultiStoreLedgerRoot`, NEXT STEP blocks.
   - `register(server)` and `_internal`.
   - Commit uses `withLock(store.storageDir, …)` like `completeSynthesis`. It writes via `store.writeRootIndex`, which syncs `.meta.json` status.

8. **Lifecycle tool changes** — `mcp-server/src/tools/project-lifecycle.ts`:
   - `initializeProject`: status and meta status come from `SETUP_PROJECT_STATUS`. The response gains a `next_steps` line naming the commit.
   - `computeHealedStatus`: Rule 0 short-circuit for SETUP; counters are still healed. Update the "all 16 healing rules" JSDoc count.
   - `completeSynthesis`: explicit SETUP rejection before the counters.
   - `getProjectStatus`: when in SETUP, add a `setup` object to the response (`{ in_setup: true, next_step: … }`).
   - `ListProjectsSchema.status` switches to `ProjectStatus`; update the tool description's enum text.

9. **Registration**:
   - Create **new** `mcp-server/src/utils/tool-registry-log.ts` (`recordToolRegistrations(server): () => string[]`).
   - `mcp-server/src/index.ts`: call it before the `register` calls, register `setupPhaseTools`, and replace the hard-coded log string and both "keep in sync manually" comments with the recorded list.

10. **Routing**:
    - `mcp-server/src/tools/workflow-next-action.ts` → `getNextActionCore`: setup gate as in Approach §5, placed before the zero-WP branch and the batch branch.
    - `mcp-server/src/tools/workflow-handoff.ts`: extract `resolveProjectLevelHandoff(rootIndex, agentRole, projectPath, store)` containing the SETUP and all-BLOCKED short-circuits. `getHandoffStatus` and `computeHandoffStatus` both call it.

11. **Help & tool descriptions** — `mcp-server/src/tools/help-content.ts`:
    - Add both tools to the overview table.
    - Add a `TOOL_HELP` entry for each.
    - Add a "Setup phase" paragraph to Workflow Order: PM creates WPs → `ledger_commit_setup` → Developer claims.
    - Add Common Mistakes: "Cancelling a WP during setup — use `ledger_reset_setup`", and "Claiming before commit".
    - In the `registerTool` descriptions of `ledger_claim_work_package`, `ledger_begin_work`, `ledger_update_work_package_status` and `ledger_start_pipeline`, append "Rejected while the project is in SETUP."

12. **GUI server** — `mcp-server/gui/api.ts`:
    - `VALID_STATUS_FILTERS` derived from `ProjectStatus.options` plus `ACTIVE`/`ALL`.
    - `handleResetProject` catches `SetupPhaseError` and raises a 409 `ApiError` (`mcp-server/src/gui/errors.ts`).
    - Make sure the project-detail payload exposes `setup_committed_at`: add it where `handleGetProject` assembles root-index fields, if not already passed through.

13. **GUI client**:
    - `mcp-server/gui/public/styles.css`: `.badge-setup` plus light and dark colour tokens beside the existing badge tokens.
    - `public/views/project-list.js` → `buildStatusOptions`: add `{ value: 'SETUP', label: 'Setup' }` after `ACTIVE`/`ALL`.
    - `public/views/project-detail.js`: SETUP info banner (via the existing `UI` alert helper in `components.js`), disabled "Reset Project" button with `title`, and a "Setup committed {formatDate}" meta line when `setup_committed_at` is present. All text goes through `escapeHtml`.

14. **Orchestrator**:
    - `orchestrator/src/config.py`: `PROJECT_SETUP_STATUS`.
    - `orchestrator/src/state.py`: `setup_pm_passes: int` with docstring.
    - `orchestrator/src/cli.py`: initial state `setup_pm_passes: 0`.
    - `orchestrator/src/supervisor.py`:
      - Add `COMMIT_SETUP` to `_DISPATCH_ACTIONS`.
      - Parse the project status from `status_data`.
      - Implement the setup branch (Approach §8). It applies to both the "no ledger on iteration 1" route and the "no WPs" route, and to the SETUP-with-WPs case. Constant `_MAX_SETUP_PM_PASSES = 2`. Exhaustion is a terminal ERROR exit with action `setup_uncommitted`.
    - `orchestrator/src/nodes/pm.py` + `templates/pm.md`: render the re-entry note when `setup_pm_passes >= 1`. The prompt includes the WP count from `state["wp_summaries"]`.

15. **MCP server + orchestrator tests** — write every test listed in the Test Plan; fix existing tests that call `initializeProject` and then exercise execution tools.

16. **PM persona** (`personas/ledger/src/content/2-project-manager.md`, `personas/ledger/src/meta/2-project-manager.yaml`): apply Approach §9 PM changes, then:
    - Add a 3.13.0 changelog entry.
    - Add the three `mcp_tools` rows and fix the `ledger_get_work_package` purpose.
    - Update `key_behavior` to mention the commit gate.
    - Keep the per-target conditionals: VS Code, Claude Code and manual escalate to the user; `target_deep_agents` records an incident comment.

17. **Bootstrapper persona** (`personas/ledger-support/src/content/ledger-bootstrapper.md`, `personas/ledger-support/src/meta/ledger-bootstrapper.yaml`):
    - Step 2's empty-SETUP-ledger exception.
    - The Constraints line "Never reinitialize or delete an existing ledger" now names the reset and commit as PM-only tools the Bootstrapper never calls.
    - The `## MCP Tools` table is unchanged (create-only).
    - Add a 1.6.0 changelog entry.

18. **Support personas**:
    - `personas/ledger-support/src/content/ledger-claude-coordinator.md`: PM dispatch-map row.
    - `personas/ledger-support/src/content/ledger-doctor.md`: "Project stuck in SETUP" symptom with diagnosis — WP count, draft files, last project comments. Repair: dispatch the PM; the Doctor never commits or resets without the user. Add SETUP to the state reference.
    - Changelog entries in each persona's YAML.
    - `personas/changelog.md`: one thematic bullet under the open WIP v3.39.0 entry.
    - Run `node scripts/build-personas.js`, then `node scripts/generate-agents-overview.js` (overview fields changed).

19. **Documentation & manifests** — see Documentation Updates. Ends with `node scripts/cli.js ctx-generate`.

20. **Release preparation (no release)**:
    - `mcp-server/changelog.md`: new entry at the next minor above its head, then `npm run sync-version` in `mcp-server/`.
    - `orchestrator/changelog.md`: new entry at the next minor above its head, and the matching `version` in `orchestrator/pyproject.toml`, which `scripts/check-version-sync.js` compares against the changelog.
    - Run `node scripts/check-version-sync.js`.

21. **Full verification**:
    - `mcp-server`: `npm run build` and `npm test`.
    - Root: `npm test` (scripts tests).
    - `orchestrator`: `pytest` and `ruff check`.
    - `node scripts/validate-workflow-manifest.js`, `node scripts/build-personas.js --check`, `node scripts/generate-agents-overview.js --check`.
    - Record results in the final pipeline summary.

## Dependencies

- Step 1 has no dependencies and runs before any other step.
- Step 2 precedes all implementation steps (spec-first rule).
- Step 3 precedes steps 4, 5 and 14: the manifest key feeds the TS and Python constants.
- Step 4 precedes step 5. Step 5 precedes steps 6, 7, 8 and 12 (`SetupPhaseError`, store methods). Step 6 precedes step 7.
- Steps 7 and 8 precede step 9 (registration). Step 10 depends on step 5 (`isSetupPhase`).
- Step 11 depends on step 7 (tool names and parameters).
- Steps 12–13 depend on steps 4–5. Step 14 depends on step 3 and on the `COMMIT_SETUP` action from step 10.
- Step 15 depends on steps 5–14.
- Steps 16–18 depend on the final tool contracts (steps 7, 10). Step 18's build depends on 16–17.
- Step 19 depends on steps 2–18. Step 20 depends on step 19. Step 21 is last.
- External: the in-flight duplicate-title rejection (user) — step 6 reuses its normalizer if it has landed.

## Required Components

- **New:** `mcp-server/src/utils/setup-phase.ts`, `mcp-server/src/utils/dependency-graph.ts`, `mcp-server/src/utils/tool-registry-log.ts`, `mcp-server/src/tools/setup-phase.ts`, `mcp-server/src/utils/wp-titles.ts` (only if the in-flight change has not landed an equivalent).
- **New tests:** `mcp-server/tests/utils/setup-phase.test.ts`, `mcp-server/tests/utils/dependency-graph.test.ts`, `mcp-server/tests/utils/wp-titles.test.ts` (with `wp-titles.ts`), `mcp-server/tests/utils/tool-registry-log.test.ts`, `mcp-server/tests/tools/setup-phase.test.ts`, `mcp-server/tests/tools/setup-phase-gate.test.ts`, `mcp-server/tests/integration/setup-phase-workflow.test.ts`.
- **Modified (spec/manifest):**
  - `mcp-server/docs/agents/workflow-specification/{README,state-machines,auxiliary-systems,operations,handoff,dependencies-and-rework,data-model,edge-cases,walkthrough}.md`
  - `shared/workflow-manifest.json`, `shared/workflow-manifest.schema.json`, `scripts/validate-workflow-manifest.js`
- **Modified (MCP server):**
  - `mcp-server/src/schema/{enums,root-index,workflow-manifest-schema}.ts`
  - `mcp-server/src/storage/ledger-store.ts`
  - `mcp-server/src/tools/{project-lifecycle,work-package,workflow-next-action,workflow-handoff,help-content}.ts`
  - `mcp-server/src/index.ts`
- **Modified (GUI):** `mcp-server/gui/api.ts`, `mcp-server/gui/public/{styles.css,views/project-list.js,views/project-detail.js}`
- **Modified (orchestrator):** `orchestrator/src/{config,state,cli,supervisor}.py`, `orchestrator/src/nodes/pm.py`, `orchestrator/src/nodes/templates/pm.md`
- **Modified (personas):**
  - `personas/ledger/src/content/2-project-manager.md`, `personas/ledger/src/meta/2-project-manager.yaml`
  - `personas/ledger-support/src/content/{ledger-bootstrapper,ledger-claude-coordinator,ledger-doctor}.md` and their `src/meta/*.yaml`
  - `personas/changelog.md`, `personas/name-mapping.json` (regenerated), `docs/agents-overview.md` (regenerated)

## Assumptions

- The PM 3.12.1 and Bootstrapper 1.5.0 changes in the STABLE working tree are the baseline; this plan edits on top of them.
- The in-flight duplicate-title rejection either lands before step 6 (its normalizer is reused) or after (it adopts `wp-titles.ts`). Both orders converge on one normalizer.
- Only one repository (`ai-insights`) changes. No sibling-repository symlink switch is required.
- The MCP SDK `McpServer.registerTool` can be wrapped on the instance before tool registration. If the SDK's typing forbids reassignment, `recordToolRegistrations` uses a typed proxy around `server` passed to each `register()` instead. The outcome is the same.
- The orchestrator's `pm.md` template renderer supports `{{#if …}}` blocks — verified in `orchestrator/src/nodes/templates/pm.md`.

## Constraints

- Workflow logic order: spec → implementation → tests → `constraints-workflow.md` (root `AGENTS.md`).
- Status vocabulary comes only from `shared/workflow-manifest.json`.
- Persona edits only in `personas/*/src/`; generated output is rebuilt, never edited.
- Cross-platform: file deletion via `fs/promises.unlink` with `ENOENT` tolerance; tests use `os.tmpdir()`-based temp stores (`mcp-server/tests/helpers/create-temp-store.ts`) and `YYYY-MM-DD-name` plan paths.
- STDIO discipline: no `process.stdout` writes in new server modules; logging via `console.error` / `process.stderr`.
- No Git write operations; no release, tag or publish.

## Out of Scope

- Implementing the duplicate-title rejection in `ledger_create_work_package` (in flight, owned by the user).
- Changing post-commit behaviour: cancel-not-delete, `ledger_reopen_cancelled_wp` and mid-execution WP creation stay as they are.
- Repairing historical projects that already contain CANCELLED WPs from setup (e.g. the composer-local-switcher incident project).
- Removing `createWorkPackage`'s create-time `READY → IN_PROGRESS` flip for post-commit creation (documented instead; see Structural Improvements).
- Post-creation dependency mutation (`updateDependencies`); §15.2's limitation remains for the execution phase.

## Human Actions

| # | Action | When | Why an agent cannot do it |
|---|--------|------|---------------------------|
| 1 | Restart every running `central_pm` MCP server instance (STABLE, DEV, IDE-launched) once the new build is in place. `ledger_initialize_project` rejects calls while the running version differs from `package.json`, and an older instance reading a `SETUP` project fails schema validation | After the run | The servers are the user's long-running processes, outside the run's control |
| 2 | Deploy rebuilt personas (`node scripts/sync-personas.js`) to `~/.claude/agents/` and the VS Code prompts directory | After the run | Writes to user-level directories outside the repository |
| 3 | Release: root changelog entry, tag and publish | After the run | Releases are owned by the user |
| 4 | Confirm the in-flight duplicate-title change reuses the shared normalizer when it is merged (whichever lands second) | After the run | That change is in the user's hands, outside this plan |

## Acceptance Criteria

- AC-01: The workflow specification documents the SETUP status, its sticky rule, self-healing Rule 0, the commit and reset operations, the setup routing short-circuits, the legacy rule and the scoped §15.2 workaround, with a version bump and changelog entry.
- AC-02: `shared/workflow-manifest.json` lists `SETUP` in `statuses.project` and declares `statuses.setup_project: "SETUP"`; `node scripts/validate-workflow-manifest.js` passes and rejects a `setup_project` value absent from `statuses.project`.
- AC-03: `ledger_initialize_project` creates projects with status `SETUP` (root index and `.meta.json`).
- AC-04: While a project is in SETUP, `ledger_claim_work_package`, `ledger_begin_work`, `ledger_start_pipeline`, `ledger_complete_pipeline`, `ledger_cancel_pipeline`, `ledger_update_pipeline_progress`, `ledger_add_observation`, `ledger_update_work_package_status` (every target status, including CANCELLED), `ledger_reset_rework_count`, `ledger_reopen_cancelled_wp` and `ledger_complete_synthesis` are rejected with a message naming `ledger_commit_setup` and `ledger_reset_setup`. No ledger file changes.
- AC-05: While in SETUP, `ledger_create_work_package` and `ledger_update_acceptance_criteria` still succeed, and creation does not change the project status.
- AC-06: Self-healing never moves a project out of SETUP; counters are still healed.
- AC-07: `ledger_reset_setup` (PM only, SETUP only, `reason` required) removes every WP from the root index and deletes their detail files, records a project comment naming the discarded IDs, and the next `ledger_create_work_package` returns `WP-001`.
- AC-08: `ledger_reset_setup` and `ledger_commit_setup` reject non-PM roles and reject projects not in SETUP, including legacy projects.
- AC-09: `ledger_commit_setup` rejects, without writing, a WP set containing any of: zero WPs, a CANCELLED WP, a non-initial WP status or pipelines, a status inconsistent with §15.1, duplicate normalized titles, an unresolved or self dependency, a dependency cycle, an invalid stage list, a summary/detail mismatch, or a count differing from `expected_work_package_count`. It lists every violation in one response.
- AC-10: A passing `ledger_commit_setup` sets the project to `READY`, stamps `setup_committed_at`, records a project comment, and afterwards a Developer can claim WP-001.
- AC-11: In SETUP, `ledger_get_next_action` returns `CREATE_WORK_PACKAGES` (no WPs) or `COMMIT_SETUP` (WPs present) for the PM, and `WAIT` for every other role, including batch mode. `ledger_get_handoff_status` returns `READY_FOR_PM` for the Planner, `IN_PROGRESS` for the PM and `WAIT` for every other role.
- AC-12: Projects whose status is not SETUP (all pre-existing projects, including ones holding CANCELLED WPs and ones mid-flight) behave exactly as before this change.
- AC-13: Replaying the incident sequence passes end to end: duplicate registrations → commit fails listing `DUPLICATE_TITLE` and `COUNT_MISMATCH` → reset → clean re-registration → commit passes. The committed project holds no CANCELLED WP and gapless IDs.
- AC-14: The GUI lists SETUP projects under Active and under a "Setup" filter with a distinct badge. The project detail page shows the setup banner and disables Reset Project. `POST` reset on a SETUP project returns 409, and the status filter no longer accepts `CANCELLED`.
- AC-15: The orchestrator supervisor re-enters the PM once when a PM stage ends with the project still in SETUP. It ends the run with an ERROR `setup_uncommitted` log entry on the next miss and never routes a SETUP project to synthesis or a pipeline role.
- AC-16: The startup log lists every registered tool, including `ledger_commit_setup` and `ledger_reset_setup`, without a hand-maintained list.
- AC-17: The PM persona commits as its final ledger step, uses reset-and-re-register at most once before escalating, and escalates headlessly (incident comment, no user wait) in the deep-agents target. The Bootstrapper stays create-only and proceeds on an empty SETUP ledger. `node scripts/build-personas.js --check` passes.
- AC-18: Manifests, `constraints-workflow.md`, GUI and orchestrator docs, root `AGENTS.md`, `help-content.ts`, module changelogs and `.context/` reflect the change. `node scripts/check-version-sync.js` passes.
- AC-19: `ledger_list_projects` accepts every project status (including `SETUP` and `ARCHIVED`) as its filter and rejects `CANCELLED`.

## Testing Strategy

- **Pure-function tests** for `validateSetupCommit`, `findCycle`/`hasCycle`, the title normalizer and `computeHealedStatus` Rule 0. Each violation code gets its own minimal fixture.
- **Store-level tests** for the default-deny guard and `discardAllWorkPackagesInSetup` (root-first ordering, ENOENT tolerance), on temp stores.
- **Tool-level tests** through `_internal` exports, using temp stores created by `initializeProject` so the real SETUP path is exercised. A parameterised gate suite runs every execution-phase tool against a SETUP project and asserts rejection plus unchanged files.
- **Legacy tests** write a root index with status `READY` and no `setup_committed_at`, the way existing tests already do, and assert unchanged behaviour. The existing suite running green is the broader legacy regression.
- **Integration tests** cover the incident replay and the happy path through to the first claim.
- **Orchestrator tests** use the existing mock-tool helpers (`orchestrator/tests/helpers/mock_tools.py`) to script ledger responses for the supervisor branch.
- **GUI tests** cover the server filter and the 409 (`mcp-server/tests/gui/api.test.ts`, `api-reset.test.ts`), and client rendering via the jsdom suites (`client-rendering.test.ts`).

## Test Plan

- `mcp-server/tests/utils/workflow-manifest.test.ts` ("statuses" describe) — `setup_project` exists and is a member of `statuses.project` — AC-02
- `scripts/validate-workflow-manifest.js` exercised by a new case in `mcp-server/tests/utils/workflow-manifest.test.ts`, or a sibling root `scripts/tests/validate-workflow-manifest.test.js` if the script is not importable from the server suite — a fixture with `setup_project: "DRAFT"` fails validation — AC-02
- `mcp-server/tests/tools/project-lifecycle.test.ts` — `initializeProject` writes `SETUP` to root and `.meta.json`; response names the commit step — AC-03
- `mcp-server/tests/tools/project-lifecycle.test.ts` — `computeHealedStatus` preserves SETUP for 0, READY-only, BLOCKED-only and mixed WP sets while correcting counters — AC-06
- `mcp-server/tests/tools/project-lifecycle.test.ts` — `completeSynthesis` rejects a SETUP project with the setup message — AC-04
- `mcp-server/tests/tools/list-projects.test.ts` — status filter accepts `SETUP`, `ARCHIVED`, rejects `CANCELLED` — AC-19
- `mcp-server/tests/tools/setup-phase-gate.test.ts` — parameterised over every tool named in AC-04: rejection, message contains both tool names, root and WP files byte-identical before/after — AC-04
- `mcp-server/tests/tools/setup-phase-gate.test.ts` — create and AC update succeed in SETUP; project status stays SETUP after creation — AC-05
- `mcp-server/tests/storage/ledger-store.test.ts` — `updateWorkPackageWithSync`/`batchUpdateWorkPackagesWithSync` throw `SetupPhaseError` in SETUP, succeed with `allowInSetup`, and are unaffected on READY projects — AC-04, AC-05, AC-12
- `mcp-server/tests/storage/ledger-store.test.ts` — `discardAllWorkPackagesInSetup` writes the root before unlinking, tolerates a pre-deleted WP file, rejects a non-SETUP project — AC-07
- `mcp-server/tests/tools/setup-phase.test.ts` — reset: PM-only, SETUP-only, `reason` required, files deleted, comment recorded, next create returns `WP-001`, zero-WP reset succeeds — AC-07, AC-08
- `mcp-server/tests/tools/setup-phase.test.ts` — commit: role guard, non-SETUP rejection (fresh-committed and legacy READY project), success sets READY + `setup_committed_at` + comment, second commit rejected — AC-08, AC-10
- `mcp-server/tests/utils/setup-phase.test.ts` — `validateSetupCommit` one test per violation code (`EMPTY_SET`, `CANCELLED_WP`, `NOT_INITIAL_STATUS`, `INITIAL_STATUS_MISMATCH`, `DUPLICATE_TITLE`, `UNRESOLVED_DEPENDENCY`, `DEPENDENCY_CYCLE`, `INVALID_STAGES`, `SUMMARY_DETAIL_MISMATCH`, `COUNT_MISMATCH`), a multi-violation fixture returning all codes, and a clean fixture returning `[]`; `isSetupPhase` truth table — AC-09
- `mcp-server/tests/tools/setup-phase.test.ts` — a failing commit leaves root and WP files unchanged — AC-09
- `mcp-server/tests/utils/dependency-graph.test.ts` — `hasCycle` parity with former behaviour (moved cases), `findCycle` detects a hand-corrupted cycle and returns `null` on a DAG — AC-09
- `mcp-server/tests/tools/work-package.test.ts` — existing cycle-detection cases still pass through the extracted helper — AC-12
- `mcp-server/tests/utils/wp-titles.test.ts` (only with new `wp-titles.ts`) — trim, whitespace collapse, case-folding; duplicate groups — AC-09
- `mcp-server/tests/tools/workflow-next-action.test.ts` — SETUP: PM gets `CREATE_WORK_PACKAGES` / `COMMIT_SETUP`; Developer, QA, Reviewer and Documentation get `WAIT`; committed project unchanged — AC-11
- `mcp-server/tests/tools/workflow-batch-actions.test.ts` — `max_results > 1` in SETUP returns WAIT for a pipeline role — AC-11
- `mcp-server/tests/tools/workflow-handoff.test.ts` — SETUP outcomes for Planner, PM and Developer via both `getHandoffStatus` and the `computeHandoffStatus` fast path; all-BLOCKED short-circuit unchanged on both paths — AC-11, AC-12
- `mcp-server/tests/gui/api-reset.test.ts` — reset on a SETUP project returns 409 — AC-14
- `mcp-server/tests/gui/api.test.ts` — `status=SETUP` filters; `ACTIVE` includes SETUP; `status=CANCELLED` falls back to ACTIVE — AC-14
- `mcp-server/tests/gui/client-rendering.test.ts` — `statusBadge('SETUP')` renders `badge-setup`; project detail renders the banner and a disabled Reset button for SETUP and neither for READY — AC-14
- `mcp-server/tests/utils/tool-registry-log.test.ts` — recorder captures names registered through a stub server in order — AC-16
- `mcp-server/tests/integration/setup-phase-workflow.test.ts` — happy path: initialize → create 3 WPs → commit (with expected count) → Developer `ledger_begin_work` on WP-001 succeeds — AC-10
- `mcp-server/tests/integration/setup-phase-workflow.test.ts` — incident replay: create 4 WPs with two exact-title duplicates → commit fails with `DUPLICATE_TITLE` + `COUNT_MISMATCH` (expected 2) → cancel attempt rejected → reset → create 2 → commit passes; no CANCELLED WP; IDs `WP-001`, `WP-002` — AC-13
- `mcp-server/tests/integration/full-workflow.test.ts` — still green; any project created via `initializeProject` is committed before claiming — AC-12
- `orchestrator/tests/test_supervisor.py` — SETUP with WPs after PM pass → routes PM once (`setup_reentry`, counter 1→2); next SETUP observation → END with `setup_uncommitted` ERROR entry and an `errors` item; SETUP never routes to synthesis or a pipeline role; no-ledger first iteration counts as a PM pass; committed project routes normally; `COMMIT_SETUP` treated as dispatchable — AC-15
- `orchestrator/tests/test_state.py` / `test_config.py` — `setup_pm_passes` field present; `PROJECT_SETUP_STATUS == "SETUP"` derived from the manifest — AC-15
- `orchestrator/tests/test_nodes.py` — PM prompt contains the re-entry note only when `setup_pm_passes >= 1` — AC-15
- `node scripts/build-personas.js --check` and `node scripts/generate-agents-overview.js --check` — persona sources build cleanly and generated output is current — AC-17
- Manual review checklist in the documentation pipeline: each file listed in Documentation Updates contains the change — AC-01, AC-18
- `node scripts/check-version-sync.js` — module versions match changelogs — AC-18

## Documentation Updates

- `mcp-server/docs/agents/workflow-specification/*` — step 2 (spec-first).
- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - `ledger_commit_setup` and `ledger_reset_setup` signatures.
  - New utils `setup-phase.ts`, `dependency-graph.ts`, `tool-registry-log.ts` (and `wp-titles.ts` if created).
  - `LedgerStore` `options.allowInSetup` and `discardAllWorkPackagesInSetup`.
  - `RootIndexSchema.setup_committed_at`.
  - `COMMIT_SETUP` action.
  - `ledger_list_projects` filter enum.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — the new source and test files.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — setup flow: initialize → create… → [reset → create…] → commit → claim.
- `mcp-server/docs/agents/project-manifest/constraints-workflow.md`:
  - New "Setup Phase" section: SETUP is sticky; WP mutations are rejected in SETUP (default-deny at the store); deletion only via reset; commit validation list; legacy rule.
  - Amend "Work Package Creation" (allowed in SETUP).
  - Amend "Claiming & Assignment" (rejected in SETUP).
- `mcp-server/docs/agents/project-manifest/constraints-storage.md` — WP detail files may be deleted only by `discardAllWorkPackagesInSetup`, root-first.
- `mcp-server/gui/docs/agents/project-manifest/` (`api-surface.md`, `ui-components.md`, `data-flows.md` as applicable) — SETUP badge/filter/banner, Reset disabled, 409 on reset, derived status filters.
- `orchestrator/docs/supervisor-routing.md` — Special Exits tree gains the setup branch, the `setup_pm_passes` bound and the `setup_uncommitted` exit.
- `orchestrator/docs/jsonl-log-schema.md` — new `setup_reentry` / `setup_uncommitted` actions.
- `orchestrator/docs/agents/project-manifest/` (`api-surface.md`, `data-flows.md`, `decisions.md`) — `PROJECT_SETUP_STATUS`, `setup_pm_passes`, and the decision record for bounded re-entry.
- `mcp-server/src/tools/help-content.ts` — step 11 (agent-facing docs).
- `personas/ledger/README.md` — the PM description (L24, L554) mentions the commit gate; the troubleshooting text near L448 mentions reset-and-re-register during setup.
- Root `AGENTS.md` → Cross-System Dependencies: new row "Setup project status" (source `shared/workflow-manifest.json` → `statuses.setup_project`; consumers `mcp-server/src/utils/setup-phase.ts`, `mcp-server/src/schema/enums.ts`, `orchestrator/src/config.py` → `PROJECT_SETUP_STATUS`, GUI badge/filter, PM and Bootstrapper persona steps).
- `mcp-server/changelog.md`, `orchestrator/changelog.md`, `personas/changelog.md` — step 20 / step 18.
- `docs/agents-overview.md`, `personas/name-mapping.json` — regenerated in step 18.
- `.context/` — `node scripts/cli.js ctx-generate` after all manifest edits (insight `53454e24`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **An older server instance reads a `SETUP` project and fails `RootIndexSchema` validation** | Human Action 1 (restart all instances). The stale-server guard in `initializeProject` already rejects creation from a mismatched instance. Note the requirement in the MCP changelog entry. |
| **A PM persona not yet redeployed never commits, leaving IDE projects in SETUP** | `ledger_get_next_action` and `ledger_get_handoff_status` tell the PM to commit, and `ledger_get_project_status` carries a `setup.next_step`, so the tool responses guide even an old persona. The Claude Coordinator routes a SETUP project to the PM. The orchestrator re-enters once. |
| **Default-deny blocks a legitimate setup-time operation not foreseen here** | The opt-in is one named option. The gate test suite enumerates every gated tool, so an unintended block shows up as a test change rather than silently. |
| **A Bootstrapper still running while the PM resets** | PM constraints keep one Bootstrapper at a time and reset only after its report arrives. Any late registration lands in the fresh set and is caught at commit by `DUPLICATE_TITLE` / `COUNT_MISMATCH` (§21.75). |
| **Crash between root write and file deletion during reset** | Root-first ordering makes orphan files invisible and overwritten by the next registration (§9d); covered by the ENOENT/ordering store test. |
| **Existing tests that call `initializeProject` and then claim break** | Step 15 adds a commit to those tests. Most tests write root indexes directly with READY/IN_PROGRESS and remain valid as legacy projects. |
| **DEV workspace (ahead of STABLE: P03 spec v2.8.0) conflicts with these version bumps and spec sections** | All versions are taken from file heads at implementation time. New spec sections are appended (§5.4, §9c/§9d, §13.0, §21.73–75) rather than renumbering existing ones, and the user reconciles branches. |
| **The two title normalizers diverge (in-flight change vs. commit)** | Step 6 reuses whichever normalizer lands first. Human Action 4 confirms convergence. The `wp-titles.ts` JSDoc names the shared contract. |
| **Wrapping `server.registerTool` conflicts with SDK typings** | Fall back to a typed proxy passed to each `register()` (Assumptions); the recorder test pins the behaviour. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** The change cuts across the workflow spec, the shared manifest, the MCP server's storage, tools and routing, the GUI, the Python orchestrator and four personas, and departs from an established state-machine invariant, so it benefits from distinct work packages with formal QA and code-review stages.
