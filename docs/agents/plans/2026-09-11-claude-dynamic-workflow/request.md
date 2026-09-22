# Dynamic Ledger Workflow Specification

> ## ⚠️ SUPERSEDED IN PART — read `plan.md` first
>
> This draft was reviewed against the live codebase. **`plan.md` in this same folder is
> authoritative wherever the two disagree.** Do not implement from this document alone; several of
> its mechanisms are unreachable as written and one of its schemas rejects the real server payload.
>
> Known defects, each analysed in `plan.md`'s Critical Findings:
>
> | Section | Defect | See |
> |---------|--------|-----|
> | §7.3/§7.4 poll strategy | `POLL_MAX_RESULTS = 3` makes `INVOKE_AGENT` unreachable — batch mode bypasses the `WAIT → INVOKE_AGENT` promotion | F1 |
> | §7.4 "Escalate" phase | The **entire PM-surrogate path is dead code** — batch mode returns an empty no-op for Project Manager, Synthesis, and Planner | F6 |
> | §7.3 constants | Four real actions unclassified (`ROUTE_PIPELINE_AGENT`, `SIGNAL_SYNTHESIS`, `CREATE_WORK_PACKAGES`, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`) | F2 |
> | Appendix A `ACTIONS_SCHEMA` | `auto_handoff: { required: ['agent'] }` under `additionalProperties: false` — **rejects the real payload**; the field is also nested under `handoff_status`, not on the action | F3, F12 |
> | Appendix B prompts | Trailing-JSON instruction is redundant and harmful under `schema:` | F7 |
> | §7.4 budget guard | `budget.remaining()` reasoning is inverted; no defensive guard needed | V5 |
> | §14 verification table | Fully superseded — four items resolved, one added (V9) | AC-07 |
> | *(not in this spec)* | Polling **writes** to the ledger, consuming a finite `auto_handoff_depth` budget | F10 |
> | *(not in this spec)* | `auto_handoff` is additionally gated on a loaded agent registry, which defaults to the **VS Code prompts directory** | F11 |
>
> Retained as useful background: the architecture diagram (§4), the responsibility table (§4), the
> file layout (§5), and the overall algorithm shape (§7.4).

**Source:** Created by Claude Fable Web
**Component:** `workflows/` (new AI Insights sub-project)
**Status:** DRAFT v0.1.0 — for Planner review before PM decomposition
**Depends on:** Agent Workflow Specification v2.5.1, Project Ledger MCP Server, Ledger Personas Build System
**Target runtime:** Claude Code Dynamic Workflows (research preview, v2.1.248+)

---

## Changelog

### v0.1.0 — Initial Draft
- Defines the `ledger-run` workflow, the `workflow` build target, the fake-runtime test harness, and acceptance criteria.

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Vocabulary & Glossary](#2-vocabulary--glossary)
3. [Scope & Non-Goals](#3-scope--non-goals)
4. [Architecture](#4-architecture)
5. [Deliverables & File Layout](#5-deliverables--file-layout)
6. [Build Target: `workflow`](#6-build-target-workflow)
7. [Workflow Script: `ledger-run`](#7-workflow-script-ledger-run)
8. [Companion Commands](#8-companion-commands)
9. [Runtime Constraints & Invariants](#9-runtime-constraints--invariants)
10. [Permissions & Safety](#10-permissions--safety)
11. [Sync & Deployment](#11-sync--deployment)
12. [Testing Strategy](#12-testing-strategy)
13. [Acceptance Criteria](#13-acceptance-criteria)
14. [Items to Verify Before Implementation](#14-items-to-verify-before-implementation)
15. [Cross-Reference Map](#15-cross-reference-map)
- [Appendix A: JSON Schemas](#appendix-a-json-schemas)
- [Appendix B: Dispatch Prompt Templates](#appendix-b-dispatch-prompt-templates)

---

## 1. Purpose

Claude Code cannot reliably drive the ledger pipeline when a persona (e.g. the retired Ledger Claude Coordinator) is the orchestrator: turn-by-turn model decisions skip stages, advance WPs out of turn, and lose track under long runs.

Claude Code Dynamic Workflows move orchestration into a JavaScript script executed by a deterministic runtime. The script owns loops and branching; each `agent()` call runs one subagent with a fresh context. This specification defines a **single, project-independent workflow script** that drives any ledger project to synthesis by repeatedly asking `central_pm` what should happen next and dispatching the persona the ledger names.

Design thesis, restated from the Agent Workflow Specification: **routing authority stays in the ledger server**. The workflow is a deterministic clock, not a second routing engine. It MUST NOT encode work-package shape, stage order, or fail routing.

---

## 2. Vocabulary & Glossary

| Term | Meaning |
|------|---------|
| MUST / SHOULD / MAY | RFC 2119 semantics |
| **Runtime** | Claude Code's workflow executor: injects `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`; journals `agent()` results; enforces caps |
| **Workflow script** | A single `.js` file with an `export const meta` literal followed by top-level-`await` body |
| **Poll** | One `agent()` call that queries `ledger_get_next_action` for a role and returns the result as validated JSON without acting |
| **Dispatch** | One `agent()` call that runs a ledger persona (via `agentType`) to execute exactly one recommended action on one WP |
| **PM surrogate** | A dispatch of the Project Manager persona to resolve PM-only recommendations (`REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REPAIR_*`) per Agent Workflow Spec §16.3c |
| **Iteration** | One poll → filter → dispatch cycle |
| **Stall** | Consecutive iterations in which no dispatchable action exists and no synthesis is ready |
| **Role slug** | Claude Code subagent name for a role, from `personas/name-mapping.json` (`claude_code` target), e.g. `3-developer` |

---

## 3. Scope & Non-Goals

### In scope (v1)
- `ledger-run`: the autonomous loop workflow (§7).
- `workflow` build target in the persona build system, producing `dist/claude-workflows/*.js` (§6).
- Sync of built workflows to `~/.claude/workflows/` (§11).
- Fake-runtime test harness and spec-derived tests (§12).
- Documentation: `workflows/README.md`, entry in the root README "What's Inside", and a Project Manifest section.

### Out of scope (v1)
- Per-stage interactive commands (`/ledger-plan`, `/ledger-pm`) — specified in §8 as v2.
- Plugin packaging of workflows.
- Any change to `central_pm` routing logic. If the workflow needs data the tools do not expose, file a ledger change request; do not work around it in the script.
- Parallel WP execution with `isolation: 'worktree'`. Forbidden in v1 (§9.5).
- Planner stage. The Planner runs before the ledger exists and remains a manual or `/ledger-plan` step.

---

## 4. Architecture

```
┌──────────────────────┐   poll (schema JSON)    ┌────────────────────────┐
│  ledger-run.js       │ ──────────────────────▶ │ poll agent (haiku)     │──┐
│  deterministic loop  │ ◀────────────────────── │ ledger_get_next_action │  │ MCP
│  (runtime executes)  │                         └────────────────────────┘  ▼
│                      │   dispatch (agentType)  ┌────────────────────────┐ ┌─────────────┐
│  no fs / no MCP /    │ ──────────────────────▶ │ persona subagent       │ │ central_pm  │
│  no imports          │ ◀────────────────────── │ e.g. 3-developer       │ │ MCP server  │
└──────────────────────┘   STAGE_RESULT JSON     └────────────────────────┘ └─────────────┘
```

Responsibilities:

| Layer | Owns | Must not |
|-------|------|----------|
| `central_pm` | All routing (`resolveNextAgent`, `resolveFailAgent`), guards, circuit breaker, cancellation semantics, dependency propagation | — |
| Workflow script | Iteration cadence, which role to dispatch for which recommendation, termination guards, budget guards, PM-surrogate trigger | Decide stage order, infer WP shape, retry a stage on its own judgment, write anything |
| Personas | Doing the work of one action; all ledger writes (`begin_work`, `complete_pipeline`, status updates) | Chain into the next agent (`INVOKE_AGENT` is handled by the loop, not by the persona) |
| Runtime | Concurrency cap, journaling/resume, schema validation + retry, `/workflows` UI | — |

The four-target symmetry principle holds: VS Code Chat (manual), LangGraph/Deep Agents orchestrator (headless Python), and now `ledger-run` (headless or interactive Claude Code) are three consumers of one enforcement layer.

---

## 5. Deliverables & File Layout

```
ai-insights/
├── workflows/                              # NEW sub-project
│   ├── README.md                           # user docs: install, run, args, monitoring
│   ├── package.json                        # test runner only (vitest or node:test)
│   ├── src/
│   │   ├── lib/                            # pure, import-free JS — unit tested directly
│   │   │   ├── constants.js                # non-dispatchable actions, PM actions, phase names
│   │   │   ├── schemas.js                  # ACTIONS_SCHEMA, STAGE_RESULT_SCHEMA, PM_RESULT_SCHEMA
│   │   │   ├── select.js                   # filterDispatchable(), dedupeByWp(), partitionPm()
│   │   │   ├── guards.js                   # effectiveMaxIterations(), shouldStop()
│   │   │   └── prompts.js                  # pollPrompt(), dispatchPrompt(), pmPrompt()
│   │   ├── ledger-run.meta.js              # `export const meta = {...}` — pure literal
│   │   └── ledger-run.body.js              # loop body using injected globals
│   ├── templates/
│   │   └── role-agent.hbs                  # renders ROLE_AGENT from name-mapping.json
│   └── test/
│       ├── harness/fake-runtime.js         # §12.2
│       ├── fixtures/transcripts/*.json     # scripted ledger responses
│       ├── lib/*.test.js
│       └── ledger-run.test.js
├── dist/
│   └── claude-workflows/
│       └── ledger-run.js                   # [generated] single-file, AUTO-GENERATED header
└── scripts/
    ├── build-workflows.js                  # NEW — assemble + validate
    └── sync-personas.js                    # EXTENDED — `--target workflow` copies dist/claude-workflows/
```

`personas/name-mapping.json` is the **only** source for role slugs. The script MUST NOT hardcode slugs.

---

## 6. Build Target: `workflow`

### 6.1 Assembly

The runtime rejects scripts containing `import()` and offers no module loading. Therefore the build MUST concatenate, in order:

1. `<!-- AUTO-GENERATED -->`-equivalent JS header comment (`// AUTO-GENERATED by scripts/build-workflows.js — edit workflows/src/ instead`)
2. `ledger-run.meta.js` — MUST remain the first statement after comments
3. Rendered `ROLE_AGENT` constant (from `templates/role-agent.hbs` + `name-mapping.json`)
4. `src/lib/*.js` in dependency order (constants → schemas → select → guards → prompts), with `export` keywords stripped
5. `ledger-run.body.js`

### 6.2 Validation (`--check` / `--strict`)

The build MUST fail (exit 1) if any of the following holds:

- `meta` is not the first statement, or is not a pure literal (parse with a JS parser; reject Identifier, CallExpression, SpreadElement, TemplateLiteral nodes inside it).
- The output contains `import`, `require(`, `process.`, `fs.`, `Date.now(`, `Math.random(`, or `new Date()` with zero arguments.
- Any `{{…}}` marker remains unresolved (`--strict`, mirroring `build-personas.js`).
- `ROLE_AGENT` lacks a key for any role in `shared/workflow-manifest.json` except `Planner`.
- Every `meta.phases[].title` is not referenced by at least one `phase()` call or `phase:` option, and vice versa.

### 6.3 Integration

- `scripts/build-workflows.js` follows the CLI conventions of `build-personas.js` (`--check`, `--strict`).
- `mcp-server` `pretest` and `.githooks/pre-commit` SHOULD additionally run `node scripts/build-workflows.js --check` so a stale `dist/claude-workflows/` blocks commits, consistent with persona staleness enforcement.
- `menu.sh` / `menu.cmd` gain a "Build & sync workflows" entry.

---

## 7. Workflow Script: `ledger-run`

### 7.1 `meta`

```js
export const meta = {
  name: 'ledger-run',
  description: 'Drive a Project Ledger project to synthesis by polling central_pm and dispatching ledger personas',
  whenToUse: 'Run after the PM has registered work packages. Pass args {projectPath|cwdPath, totalWps, concurrency, mode}.',
  phases: [
    { title: 'Poll', detail: 'query ledger_get_next_action per role' },
    { title: 'Escalate', detail: 'PM-surrogate handling of REVIEW_* / REPAIR_*' },
    { title: 'Dispatch', detail: 'one persona per recommended action' },
    { title: 'Synthesis', detail: 'final report' },
  ],
};
```

### 7.2 `args`

| Key | Type | Required | Default | Notes |
|-----|------|----------|---------|-------|
| `cwdPath` | string | one of `cwdPath` / `projectPath` | — | Passed through to `ledger_get_next_action` (preferred, auto-detects project) |
| `projectPath` | string | | — | Fallback per tool contract |
| `totalWps` | integer | no | `1` | Used for `effectiveMaxIterations` (§7.6). Caller SHOULD pass the real count |
| `concurrency` | integer | no | `1` | Max dispatches per iteration. MUST be clamped to `[1, 4]` in v1 |
| `mode` | `'autonomous'` \| `'single-iteration'` | no | `'autonomous'` | `single-iteration` runs exactly one poll→dispatch cycle and returns; used for interactive stepping and for tests |
| `stallLimit` | integer | no | `2` | Consecutive idle iterations before stopping |
| `runStartedAt` | ISO string | no | `null` | Runtime forbids `Date.now()`; callers MAY pass a timestamp for logging only |

Missing required args MUST cause the script to `return { error: 'MISSING_ARGS', detail }` before any `agent()` call.

### 7.3 Constants (`src/lib/constants.js`)

```js
NON_DISPATCHABLE = ['WAIT', 'WAIT_FOR_REWORK', 'WAIT_FOR_DOWNSTREAM', 'CONTINUE_PIPELINE', 'BLOCK_FOR_REWORK_LIMIT'];
PM_ACTIONS       = ['REVIEW_REWORK_LIMIT', 'REVIEW_STALE', 'REVIEW_ABANDONED', 'UNBLOCK_WP',
                    'REPAIR_TIMESTAMPS', 'REPAIR_ORPHAN_BLOCKED', 'RESUME_OR_CANCEL'];
TERMINAL_ACTIONS = ['GENERATE_SYNTHESIS'];
POLL_ROLES       = ['Project Manager', 'Developer', 'QA', 'Security Auditor', 'Reviewer',
                    'Release Engineer', 'Documentation', 'Synthesis'];   // Planner excluded (§14.1.1: always WAIT)
POLL_MAX_RESULTS = 3;
MIN_BUDGET_TOKENS = 40_000;
```

`CONTINUE_PIPELINE` is non-dispatchable because an active pipeline belongs to an agent that is either running in this very iteration or was orphaned; orphan recovery is the PM's job via `REVIEW_STALE`/`RESUME_OR_CANCEL` (Agent Workflow Spec §21.68).

`INVOKE_AGENT` is treated as dispatchable for the **target** role named in `auto_handoff`, not for the polled role. `select.js` MUST normalise it: `{ action: INVOKE_AGENT, role: R, auto_handoff: { agent: T, prompt } }` → dispatch to `T` with the ledger-provided prompt appended.

### 7.4 Algorithm

```
function ledgerRun(args, rt):                       // rt = injected runtime globals
  validate args; clamp concurrency
  maxIter  = effectiveMaxIterations(args.totalWps)  // §7.6
  idle = 0; iteration = 0; dispatched = []

  while iteration < maxIter AND idle < args.stallLimit AND budget.remaining() > MIN_BUDGET_TOKENS:
    iteration += 1

    // ---- Poll -------------------------------------------------------------
    polls = parallel(POLL_ROLES.map(role => () =>
              agent(pollPrompt(role, args), { schema: ACTIONS_SCHEMA, model: 'haiku',
                                              phase: 'Poll', label: role })))
    actions = polls.filter(Boolean).flatMap(p => p.actions.map(a => ({ ...a, role: p.role })))

    // ---- Classify -----------------------------------------------------------
    if actions.some(a => a.action in TERMINAL_ACTIONS):
        phase('Synthesis')
        report = agent(dispatchPrompt({ action: 'GENERATE_SYNTHESIS', role: 'Synthesis' }, args),
                       { agentType: ROLE_AGENT['Synthesis'], schema: STAGE_RESULT_SCHEMA })
        return { status: 'COMPLETE', iterations: iteration, dispatched, report }

    pmActions   = actions.filter(a => a.action in PM_ACTIONS)
    workActions = dedupeByWp(filterDispatchable(actions))   // §7.5

    if pmActions.length == 0 AND workActions.length == 0:
        idle += 1; log(`iteration ${iteration}: idle (${idle}/${args.stallLimit})`); continue
    idle = 0

    // ---- Escalate (PM surrogate) --------------------------------------------
    if pmActions.length > 0:
        pmResult = agent(pmPrompt(pmActions, args),
                         { agentType: ROLE_AGENT['Project Manager'], phase: 'Escalate',
                           schema: PM_RESULT_SCHEMA, label: pmActions.map(a=>a.action).join(',') })
        dispatched.push({ iteration, kind: 'pm', actions: pmActions, result: pmResult })
        if pmResult?.halt: return { status: 'HALTED_BY_PM', iterations: iteration, dispatched, reason: pmResult.reason }
        continue                                             // re-poll: PM changes routing

    // ---- Dispatch -----------------------------------------------------------
    batch = workActions.slice(0, args.concurrency)
    results = parallel(batch.map(a => () =>
                agent(dispatchPrompt(a, args),
                      { agentType: ROLE_AGENT[a.role], phase: 'Dispatch',
                        schema: STAGE_RESULT_SCHEMA, label: `${a.work_package_id}/${a.action}` })))
    dispatched.push(...batch.map((a, i) => ({ iteration, kind: 'work', action: a, result: results[i] })))

    if args.mode == 'single-iteration': return { status: 'STEPPED', iterations: 1, dispatched }

  return { status: idle >= args.stallLimit ? 'STALLED' : (budget.remaining() <= MIN_BUDGET_TOKENS ? 'BUDGET' : 'ITERATION_LIMIT'),
           iterations: iteration, dispatched }
```

Rules embedded in the algorithm:

- **R1** A PM-surrogate iteration MUST NOT also dispatch work. PM actions change routing state; the loop re-polls first.
- **R2** Personas MUST NOT be given a `model` override in `agent()`. Model selection comes from the persona's Claude Code frontmatter (`cc_model`, model registry). Only poll agents set `model`.
- **R3** The script MUST NOT retry a dispatch whose `STAGE_RESULT.outcome` is `FAIL`. Failure routing is the ledger's job; the next poll returns `REWORK` for the right agent.
- **R4** The script MUST treat `null` (stopped / API error) dispatch results as "unknown" — log and re-poll. It MUST NOT mark anything.
- **R5** Every `agent()` in a `parallel()` MUST pass `phase:` as an option, not rely on global `phase()` (race).

### 7.5 Selection (`src/lib/select.js`)

```
filterDispatchable(actions):
  keep a where a.action ∉ NON_DISPATCHABLE ∪ PM_ACTIONS ∪ TERMINAL_ACTIONS
  normalise INVOKE_AGENT → { action: 'INVOKE_AGENT', role: a.auto_handoff.agent, work_package_id, prompt: a.auto_handoff.prompt }

dedupeByWp(actions):
  group by work_package_id (actions without a WP id, e.g. CREATE_WORK_PACKAGES, keep as-is)
  within a group keep exactly one, by priority:
      REWORK > INVOKE_AGENT > CLAIM_WP > (IMPLEMENT, RUN_QA, RUN_SECURITY_AUDIT, RUN_REVIEW,
      RUN_RELEASE_ENGINEERING, WRITE_DOCS) > UPDATE_CRITERIA > FINALIZE_WP
  order groups by (is REWORK first, then WP id ascending)        // stable → deterministic
```

One WP MUST receive at most one dispatch per iteration. This is the script's single scheduling decision and the reason concurrency across WPs is safe without worktrees when WPs touch disjoint files — a property the PM's `wp-decomposer` already targets.

### 7.6 Guards (`src/lib/guards.js`)

```
effectiveMaxIterations(totalWps) = max(50, totalWps × 30)      // mirrors Agent Workflow Spec §18.2.1
```

Termination statuses: `COMPLETE`, `HALTED_BY_PM`, `STALLED`, `BUDGET`, `ITERATION_LIMIT`, `STEPPED`, plus `error` returns. The script MUST always `return` an object; it MUST NOT throw on expected conditions.

### 7.7 Dispatch result contract

Every persona invoked with `agentType` receives an instruction (Appendix B) to end its response with a JSON object matching `STAGE_RESULT_SCHEMA`:

```
{ outcome: 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED' | 'ERROR',
  work_package_id, action, pipeline_type?, summary: string(≤ 400), ledger_writes: string[] }
```

`SKIPPED` means the persona re-read the ledger and found the action no longer recommended for its role (§9.4). The runtime's schema retry makes this reliable without changing persona content: the instruction lives in the dispatch prompt, not in the persona file. Persona source files MUST NOT be modified for v1.

---

## 8. Companion Commands

Version 2. Listed so the v1 design does not preclude them.

| Command | Body | Purpose |
|---------|------|---------|
| `/ledger-plan` | one `agent()` on `1-planner` | Planner in a fresh context; human reviews plan document |
| `/ledger-pm` | one `agent()` on `2-pm` | PM decomposition + ledger init; human reviews WPs |
| `/ledger-step` | `workflow('ledger-run', { ...args, mode: 'single-iteration' })` | Interactive stepping |

Human sign-off between stages happens at command boundaries, since the runtime forbids mid-run user input.

---

## 9. Runtime Constraints & Invariants

### 9.1 Purity
The orchestrator scope has no filesystem, shell, network, or MCP access and cannot load modules. `Date.now()`, `Math.random()`, and argless `new Date()` throw. The build enforces this statically (§6.2). Consequence: **every ledger read is an `agent()` call**; budget for `POLL_ROLES.length` cheap agents per iteration.

### 9.2 Determinism
Given identical `args` and identical `agent()` results, the script MUST make identical `agent()` calls in identical order. `dedupeByWp` ordering and `Object.keys` iteration order are therefore part of the contract; use explicit sort keys.

### 9.3 Resume semantics
On relaunch the runtime replays cached results; the first agent whose prompt differs (or that failed) reruns together with everything after it. Because dispatch prompts embed poll results, a replayed branch is internally consistent, and the first live persona re-reads the ledger. Operational rule (document in README): **after editing the script, start a fresh run; do not resume a half-finished project**, or every persona re-executes and no-ops at token cost.

### 9.4 Mid-flight cancellation
The ledger may invalidate running work (cascade reblock §15.5, PM `cancelPipeline` §12.5, `IN_PROGRESS → BLOCKED`). The script cannot stop a running `agent()`. Policy:
- The unit of dispatch is one action on one WP — never "finish this WP". Waste is bounded to one stage.
- Dispatch prompts instruct the persona to confirm via `ledger_get_next_action` that its action is still recommended before doing expensive work, and to return `SKIPPED` otherwise.
- Server guards reject late `ledger_complete_pipeline` calls; the script relies on this and never compensates.

### 9.5 Concurrency
`concurrency` default 1; hard clamp 4 in v1. `isolation: 'worktree'` is FORBIDDEN in v1: it introduces agent-side Git activity, conflicting with the "no Git writes by agents" constraint. Raising concurrency is safe only across WPs the ledger already reports as dependency-independent (batch poll with `max_results > 1` surfaces these).

### 9.6 Caps
1,000 agents per run; 16 concurrent (fewer in CPU-limited containers); 4,096 items per `parallel()`. With 8 poll roles plus ≤4 dispatches per iteration, `effectiveMaxIterations` for a 5-WP project (150) could exceed the 1,000-agent cap. The guard MUST therefore also compute `maxIter = min(effectiveMaxIterations, floor(900 / (POLL_ROLES.length + concurrency)))` and log which bound applied.

---

## 10. Permissions & Safety

- Workflow subagents run in `acceptEdits` and inherit the session allowlist regardless of the session's mode. File edits are auto-approved.
- The **"no Git writes by agents"** constraint MUST be enforced by a `PreToolUse` hook on `Bash` that denies `git commit|push|merge|rebase|checkout -b|worktree` for calls carrying an `agent_id`. Ship it as `workflows/hooks/deny-git-writes.json` with install instructions; `sync-personas.js --target workflow` SHOULD offer to merge it into `~/.claude/settings.json`.
- Headless launch (`claude -p`) never shows the approval prompt; a permission rule `Workflow(ledger-run)` approves this workflow by name. The README MUST document the minimal allowlist: `Workflow(ledger-run)`, `mcp__central_pm__*`, plus the persona tool set from `default_cc_tools`.
- Org admins can disable workflows via managed settings. The README MUST list this as a prerequisite check (`/config` → Dynamic workflows).

---

## 11. Sync & Deployment

| Location | When | Mechanism |
|----------|------|-----------|
| `~/.claude/workflows/ledger-run.js` | Default (v1) | `sync-personas.js --target workflow` — same pattern as `~/.claude/agents/` |
| `<repo>/.claude/workflows/ledger-run.js` | Team adoption in HCP repos | `sync-personas.js --target workflow --project <path>`; the closest `.claude/workflows/` up the tree wins at runtime |
| Plugin `workflows/` | Later | Out of scope; note that plugin subagents ignore `hooks`, `mcpServers`, `permissionMode` frontmatter |

After a sync into a live session, `/reload-skills` re-reads workflow directories.

Invocation examples for the README:

```
Run /ledger-run with args {"cwdPath": "/work/hcp-pigeon", "totalWps": 6, "concurrency": 2}
claude -p 'Run /ledger-run with args {"cwdPath":"/work/hcp-pigeon","totalWps":6}' --allowedTools 'Workflow(ledger-run)' ...
```

---

## 12. Testing Strategy

Spec-derived, no live model calls in CI.

### 12.1 Pure library tests (`test/lib/*.test.js`)
- `filterDispatchable`: every action in Agent Workflow Spec Appendix B is classified exactly once as dispatchable, PM, terminal, or non-dispatchable (table-driven; the test fails if Appendix B gains an action the constants don't know).
- `dedupeByWp`: priority order, stability, actions without WP id pass through.
- `effectiveMaxIterations`: the §18.2.1 table (0/1/3/5/8 WPs → 50/50/90/150/240) and the 1,000-agent cap interaction (§9.6).
- `prompts`: contain the ledger tool names, the role, the WP id, and the STAGE_RESULT instruction; contain no `Date`/`random` output.

### 12.2 Fake runtime harness (`test/harness/fake-runtime.js`)
Provides `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow` with these behaviours:
- `agent(prompt, opts)` matches `(opts.label, opts.agentType, opts.phase)` against a **transcript fixture** and returns the scripted JSON; unmatched calls fail the test with the prompt printed.
- Records the ordered call log `[{ label, agentType, phase, schema?: name }]`.
- `budget.remaining()` decrements by a configurable per-call cost.
- Validates every returned object against `opts.schema` with a JSON Schema validator (Ajv) so fixtures stay honest.
- Executes the **built** `dist/claude-workflows/ledger-run.js` (not the sources) via `new AsyncFunction(...globals, body)`, after stripping the `export const meta` statement and asserting it parsed as a literal.

### 12.3 Scenario tests (`test/ledger-run.test.js`)
Each fixture is a sequence of poll results per iteration plus dispatch results:

| Scenario | Asserts |
|----------|---------|
| Default 4-stage WP, happy path | Dispatch order Developer → QA → Reviewer → Documentation → FINALIZE → Synthesis; `status: COMPLETE` |
| QA FAIL then rework | No script-side retry (R3); next iteration dispatches `REWORK` to Developer only |
| `REVIEW_REWORK_LIMIT` | PM surrogate dispatched alone (R1); re-poll follows; no work dispatch in that iteration |
| Cascade reblock mid-run | Dispatch returns `SKIPPED`; script neither retries nor marks; next poll drives on |
| Two independent WPs, `concurrency: 2` | Both dispatched in one `parallel()`; one WP never receives two dispatches per iteration |
| `INVOKE_AGENT` promotion | Dispatched to `auto_handoff.agent`, not the polled role; prompt contains the handoff prompt |
| All roles WAIT for `stallLimit` iterations | `status: STALLED`, no dispatch |
| Budget exhaustion | `status: BUDGET` before the next poll |
| `null` dispatch result | Logged, re-polled, not recorded as a write (R4) |
| Determinism | Same fixture run twice → byte-identical call log |
| Replay | Harness serves cached results for the first *k* calls; call log prefix identical; call *k+1* onward is "live" |
| `single-iteration` | Exactly one poll batch and one dispatch batch; `status: STEPPED` |

### 12.4 Build tests
- `build-workflows.js --check` exits 1 on each §6.2 violation (one fixture per rule).
- Output has no `export` except `meta`; `meta` is the first statement.

### 12.5 Manual smoke (documented, not CI)
One real run on a sandbox ledger project with a single doc-only WP, `concurrency: 1`, interactive session, `/workflows` open. Record token totals in `docs/history/key-learnings.md`.

---

## 13. Acceptance Criteria

1. `node scripts/build-workflows.js --strict` produces `dist/claude-workflows/ledger-run.js` that passes all §6.2 checks and contains slugs read from `name-mapping.json`.
2. `node scripts/sync-personas.js --target workflow` installs the file to `~/.claude/workflows/` and prints the resolved path.
3. All §12 tests pass in CI without network access.
4. The script never calls `agent()` with a `model` option except in the Poll phase (grep-level test).
5. The script contains no stage names, pipeline orderings, or fail-routing tables (grep for `implementation`, `code-review`, `security-audit` outside prompt text and schemas fails the build).
6. Smoke run (§12.5) reaches `COMPLETE` on a doc-only WP; `/workflows` shows the four phases.
7. README documents prerequisites (Claude Code ≥ 2.1.248, workflows enabled, allowlist), args, statuses, the resume rule (§9.3), and the Git hook (§10).
8. Root README "What's Inside" gains a "Dynamic Ledger Workflow" entry alongside The Orchestrator.

---

## 14. Items to Verify Before Implementation

The PM SHOULD create a spike WP for these before decomposing the rest. Each is a runtime fact this spec depends on but that was confirmed only from secondary sources or may drift during the research preview.

| # | Claim | How to verify |
|---|-------|---------------|
| V1 | `agent()` accepts `agentType` and resolves names from `~/.claude/agents/` | Run `/workflow-authoring`; grep the loaded reference for `agentType` |
| V2 | A subagent launched via `agentType` inherits the session's MCP servers (`central_pm`) | Smoke: poll agent calls `ledger_ping` |
| V3 | `mcpServers` frontmatter is honoured for `.claude/agents/` files (bundle notes say unsupported — may be stale) | Check current sub-agents docs; if supported, revisit the `ledger-bootstrapper` restriction separately |
| V4 | `Run /ledger-run with args {...}` works under `claude -p` with a `Workflow(ledger-run)` allow rule | Headless smoke |
| V5 | `budget` is non-null in a saved-command run (community note: `null` when no target set) | Guard with `budget?.remaining?.() ?? Infinity` until confirmed |
| V6 | Schema-validated `agent()` returns a parsed object, not a string | Harness assumption; confirm and adjust `polls.flatMap` |
| V7 | `PreToolUse` hooks fire for workflow subagents (`agent_id` present) | Hook smoke with a logging hook |
| V8 | Company Teams admin has not disabled workflows | `/config` |

---

## 15. Cross-Reference Map

| This spec | Agent Workflow Specification v2.5.1 |
|-----------|-------------------------------------|
| §7.3 `POLL_ROLES` excludes Planner | §14.1.1 |
| §7.3 `NON_DISPATCHABLE`, `PM_ACTIONS` | Appendix B |
| §7.3 `INVOKE_AGENT` normalisation | MCP `ledger_get_next_action` contract (bundle §Workflow Coordination Tools) |
| §7.4 PM surrogate | §16.3c, §21.68, §12.5.2 (`auto_cancelled`) |
| §7.4 R3 no script-side retry | §9.3, §9.3.1, §16 |
| §7.5 one dispatch per WP | §14.9, §21.46 |
| §7.6 iteration bound | §18.2.1 |
| §9.4 cancellation policy | §7.3, §12.5, §15.5, §21.14b, §21.27 |
| §9.5 concurrency | §22 "Parallel Work Packages" |

---

## Appendix A: JSON Schemas

```js
export const ACTIONS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['role', 'actions'],
  properties: {
    role: { type: 'string' },
    plan_path: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string' },
          work_package_id: { type: 'string' },
          pipeline_type: { type: 'string' },
          reason: { type: 'string' },
          handoff_notes: { type: 'array', items: { type: 'string' } },
          auto_handoff: {
            type: 'object', required: ['agent', 'prompt'],
            properties: { agent: { type: 'string' }, prompt: { type: 'string' } },
          },
        },
      },
    },
  },
};

export const STAGE_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outcome', 'work_package_id', 'action', 'summary', 'ledger_writes'],
  properties: {
    outcome: { type: 'string', enum: ['PASS', 'FAIL', 'SKIPPED', 'BLOCKED', 'ERROR'] },
    work_package_id: { type: 'string' },
    action: { type: 'string' },
    pipeline_type: { type: 'string' },
    summary: { type: 'string', maxLength: 400 },
    ledger_writes: { type: 'array', items: { type: 'string' } },
  },
};

export const PM_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['handled', 'halt'],
  properties: {
    handled: {
      type: 'array',
      items: {
        type: 'object', required: ['action', 'work_package_id', 'resolution'],
        properties: {
          action: { type: 'string' },
          work_package_id: { type: 'string' },
          resolution: { type: 'string', enum: ['CANCELLED_WP', 'CANCELLED_PIPELINE', 'UNBLOCKED', 'REPAIRED', 'RESET_REWORK', 'NO_ACTION'] },
          note: { type: 'string' },
        },
      },
    },
    halt: { type: 'boolean' },
    reason: { type: 'string' },
  },
};
```

`work_package_id` format per Agent Workflow Spec §3.6; the build MAY tighten with a `pattern` once confirmed.

---

## Appendix B: Dispatch Prompt Templates

Prompts are functions of `(action, args)` only. No timestamps, no counters, no run ids.

**Poll**
```
You are the {role}. Call ledger_get_next_action with agent_role="{role}", max_results={POLL_MAX_RESULTS}
and {cwdPath|projectPath}. Do NOT perform any action and do NOT write to the ledger.
Return only JSON: { "role": "{role}", "plan_path": ..., "actions": [ ...normalised list... ] }.
If the tool returns a single action object, wrap it in "actions".
```

**Dispatch**
```
Ledger project at {cwdPath|projectPath}. Recommended action: {action} for work package {work_package_id}
(pipeline: {pipeline_type}). {handoff_notes as bullet list, if any} {auto_handoff.prompt, if INVOKE_AGENT}
Before any substantial work, call ledger_get_next_action for your role. If this action is no longer
recommended for {work_package_id}, stop and report outcome "SKIPPED". Perform exactly this one action
following your persona; do not proceed to other work packages or stages. Do not commit, push, or create
branches. Finish your response with one JSON object matching this schema: {STAGE_RESULT_SCHEMA}.
```

**PM surrogate**
```
Ledger project at {cwdPath|projectPath}. You are acting as the headless Project Manager surrogate
defined in Agent Workflow Specification §16.3c. Pending PM recommendations: {pmActions as JSON}.
For REVIEW_REWORK_LIMIT: add a project comment recording WP id, pipeline type and rework count, then
set the WP to CANCELLED. For REVIEW_STALE / RESUME_OR_CANCEL / REVIEW_ABANDONED: cancel the orphaned
pipeline with auto_cancelled=true (§21.68) unless ledger evidence shows it is genuinely active. For
REPAIR_*: apply the repair described in the recommendation. For UNBLOCK_WP: do not unblock; set
halt=true with the blocker reason. Do not create or edit code. Finish with one JSON object matching:
{PM_RESULT_SCHEMA}.
```
