# Plan: Dynamic Ledger Workflow (`workflows/ledger-run`)

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.9.2
- Architectural Reviews: 2 — Plan Architect Reviewer v2.3.2
- Planner review passes: 2 (initial authoring by Claude Code; verification review 2026-09-11)

## Supersession Notice

**This plan is authoritative over the draft specification wherever the two disagree.**

> **Spec location (corrected).** Earlier revisions of this plan cited the spec as
> `docs/agents/projects/dynamic-ledger-workflow-spec.md`. **That file does not exist, and neither
> does that directory.** The draft specification is
> `docs/agents/plans/2026-09-11-claude-dynamic-workflow/request.md` — the `request.md` sitting
> beside this plan. All `spec §N` / `Appendix A` / `Appendix B` references throughout this document
> resolve against that file. Work packages citing a spec section must use this path.

The spec was a draft for Planner review; this document is the result
of that review plus four coordinator decisions and a resolved runtime-verification pass. Work
packages are decomposed from this plan, not from the spec directly. The spec remains useful as
background context (architecture diagram, algorithm shape, Appendix A/B schemas) but the following
are deliberate, recorded deviations from it:

1. **Poll strategy (F1/F6).** Every `POLL_ROLES` entry is polled with `max_results: 1`, always — no
   batch escalation tier. This is stricter than the spec's `POLL_MAX_RESULTS = 3` batch call and is
   required, not optional (F6: batch mode is structurally incapable of returning `PM_ACTIONS` for
   Project Manager and is a no-op for Synthesis/Planner).
2. **Action vocabulary (F2).** `NON_DISPATCHABLE`/`PM_ACTIONS`/`TERMINAL_ACTIONS` are seeded with
   four actions the spec's Appendix B cross-reference omitted: `ROUTE_PIPELINE_AGENT`,
   `SIGNAL_SYNTHESIS`, `CREATE_WORK_PACKAGES` handling, `WAIT_FOR_UPSTREAM_REWORK_LIMIT`.
3. **`auto_handoff` shape (F3).** Role resolution reads `handoff_status.next_agent`, never
   `auto_handoff.agent`/`agent_name`.
4. **Dispatch/PM-surrogate prompts drop the spec's Appendix B trailing-JSON instruction (F7).**
   With `schema:` passed to `agent()`, the runtime forces a StructuredOutput tool call; asking the
   persona to *also* end its response with a JSON object is redundant and risks the persona emitting
   both. This plan's prompts keep the behavioural instructions (confirm-before-work, `SKIPPED`
   semantics, one-action scope, no Git writes) and drop the JSON-formatting instruction entirely.
5. **`concurrency` is fixed at `1` for v1 (D-B)**, not an args-table field clamped to `[1, 4]` as
   the spec proposes. Multi-WP concurrency is a fast-follow (see Out of Scope).
6. **Poll-phase model lever is `effort: 'low'`, not `model: 'haiku'` (F8).** The reference
   documentation recommends reserving explicit `model` overrides for high-confidence cases and
   otherwise inheriting the session model; `effort` is the better-fit lever for cheap poll calls.
7. **The §6.2 bidirectional `phase()`/`meta.phases` cross-check is a house lint, not an enforced
   runtime constraint (F8)** — kept, but described honestly as such rather than as a build-blocking
   runtime guarantee.
8. **The V1–V8 runtime-verification spike is its own work package (WP-001, documentation-only)**
   that every other work package depends on, rather than an informal "recommended gate" — and its
   scope is V3/V4/V7/V8 (V1, V2, V5, V6 resolved — see "Verified Runtime Behaviour" below) **plus
   the new V9** added by F11 below.
9. **Polling is not a free read (F10).** The spec models polls as side-effect-free queries. They
   are not: an eligible poll increments a persistent `auto_handoff_depth` counter and rewrites the
   root index. `guards.js` therefore gains a depth-aware guard and a `HANDOFF_DEPTH` termination
   status that the spec has no equivalent for.
10. **`INVOKE_AGENT` has two further gates beyond `max_results` (F11).** The spec (and this plan's
    previous revision) treated single-result polling as sufficient for auto-handoff reachability.
    It is necessary but not sufficient — `auto_handoff_enabled` config and a **loaded agent
    registry** also gate it, and the registry defaults to the **VS Code prompts directory**. This
    adds an operational prerequisite and a new verification item (V9).
11. **Appendix A's `ACTIONS_SCHEMA` is wrong and must not be copied verbatim (F12).** Its
    `auto_handoff` sub-schema encodes `{ agent, prompt }` with `additionalProperties: false`, which
    contradicts the verified payload shape (F3) and would reject the real response.

## Summary

This plan implements `ledger-run`, a Claude Code Dynamic Workflow that drives an existing Project
Ledger project to synthesis by repeatedly polling `central_pm`'s `ledger_get_next_action` and
dispatching the ledger persona the tool recommends — keeping all routing authority in the MCP
server. It is based on `docs/agents/projects/dynamic-ledger-workflow-spec.md` v0.1.0, a draft that
research against the live codebase (this plan's first pass) plus a resolved runtime-verification
pass (this revision) shows is directionally sound but has real gaps, now corrected per the
Supersession Notice above. The two most severe corrections are both about reachability, not
cosmetics: the spec's central `INVOKE_AGENT`/`auto_handoff` mechanism is unreachable under batch
polling (F1), and — more severely — its entire **PM-surrogate escalation path is dead code**
under the spec's own polling strategy, because `ledger_get_next_action`'s batch mode
(`max_results > 1`) short-circuits to a collector that returns an empty-actions no-op for any role
without a pipeline mapping — Project Manager, Synthesis, and Planner (F6). Both are fixed by the
same change: poll every role, always, with `max_results: 1`. Four coordinator decisions are now
settled and recorded as such throughout this document (D-A: `workflows/` stays a separate
sub-project; D-B: `concurrency` fixed at `1` for v1; D-C: the runtime-verification spike is its own
gating work package; D-D: the Git-write-denial hook is print-instructions-only for v1). Four of the
spec's eight unverified runtime claims (V1, V2, V5, V6) are now resolved from the
`workflow-authoring` reference and folded into the design; the remaining four (V3, V4, V7, V8),
plus the new V9 from F11, are WP-001's scope.

**This revision (2026-09-11 Planner verification pass) adds three findings that a source-level
trace of the MCP server surfaced and that no prior pass had checked (F10\u2013F12).** Two are
design-blocking, and both invalidate an assumption the poll loop rests on. **F10: polling mutates
ledger state.** `embedHandoffStatusInWait()` \u2192 `computeHandoffStatus()` \u2192 `buildHandoffResponse()`
increments a persistent `auto_handoff_depth` counter and rewrites the root index on every eligible
poll \u2014 so D1's \"poll all 8 roles every iteration\" consumes a finite, non-resetting budget, and\nexhausting it silently degrades into a stall the loop misattributes. **F11: the F1 fix is necessary\nbut not sufficient.** `auto_handoff` is additionally gated on `auto_handoff_enabled` and\n`isRegistryLoaded()`, and the registry is populated from the **VS Code prompts directory** by\ndefault \u2014 meaning in a headless `claude -p` run on a machine without VS Code personas synced,\n`INVOKE_AGENT` never fires no matter what `max_results` is. The previous revision's AC-06\n(\"verified in a fake-runtime scenario test\") cannot detect this, because a fixture asserting the\ndesired payload proves nothing about the gate that produces it. **F12** is smaller but would have\nbaked F3's bug into code: Appendix A's `ACTIONS_SCHEMA` hardcodes the wrong `auto_handoff` shape\nunder `additionalProperties: false`.

## Prior Project Context

`ledger_get_repository_context` returned strategic vision and 193 prior projects for this
repository. The short-term strategic goal — "make the whole project as easy as possible to set up
and use" — and the mid/long-term goals around persona reliability and cross-platform robustness are
directly relevant: `ledger-run` is a new *consumer* of the personas and the MCP server, not a
change to either, so it must not weaken the "personas first" principle or introduce a fourth
routing engine. No directly reusable insight surfaced for Dynamic Workflows specifically (the
feature has no prior project history in this repository); the closest related insight
(`ea8cb364-186f-43e9-a007-33d5f009ff63`, "Orchestrator routing loop recovery") documents a real
routing pathology (repeated implementation→QA cycling after a code-review FAIL rework, until a PM
override reopens the WP) that `ledger-run`'s PM-surrogate escalation path must be able to reach —
this is folded into Phase 3 below.

## Architectural Context

The workspace is a four-language monorepo (`mcp-server/` TypeScript, `personas/` JavaScript/CJS,
`orchestrator/` Python, and now `workflows/`). Two existing build pipelines are relevant precedents:

- **Persona build** (`scripts/build-personas.js`): a thin wrapper around
  `@mistralys/persona-builder`, driven by `personas/persona-build.config.js`, producing three
  output targets (`vs-code`, `claude-code`, `deep-agents`) from YAML/Markdown sources. Supports
  `--check` (validate without writing) and `--strict` (fail on unresolved `{{…}}` markers).
  `--dry-run` is accepted as an alias for `--check`.
- **Persona sync** (`scripts/sync-personas.js`): builds via `build-personas.js` then copies output
  to IDE-specific directories via `--target {vscode|claude-code|all}`, resolved through
  `scripts/publish-locations.js` (`getVSCodePromptsDir()`, `getClaudeCodeAgentsDir()`,
  `getClaudeCodeSkillsDir()`). **Verified: there is no `workflow` target today** — `VALID_TARGETS`
  is a hardcoded three-element array and `publish-locations.js` exposes no workflows directory
  helper. Extending this file is new work, not a small addition to an existing enum.
- **Routing authority**: `mcp-server/src/tools/workflow-next-action.ts` (single-result mode) and
  `workflow-next-action-batch.ts` (`getNextActionsCollector`, batch mode) implement the full
  recommendation engine described in `mcp-server/docs/agents/workflow-specification/`
  (`recommendations.md` §14, `walkthrough.md` Appendix B). `shared/workflow-manifest.json` is the
  single source of truth for role names, pipeline order, and constants (`max_rework_count: 5`,
  `stale_pipeline_hours: 24`, `handoff_depth_multiplier: 30`) — the spec's
  `effectiveMaxIterations` formula already matches this manifest's multiplier.
- **Role slugs**: `personas/name-mapping.json` is generated by `build-personas.js` from
  `personas/ledger/src/meta/*.yaml`; each entry's `claude_code.agent_name` (e.g. `"3-developer"`)
  is exactly the Claude Code subagent name the spec's `ROLE_AGENT` map needs. Verified correct.
- **Pre-commit enforcement**: `.githooks/pre-commit` currently runs `build-personas.js --check` and
  `check-version-sync.js`, plus several advisory (non-blocking) warnings for stale `.context/` and
  changelog drift. There is no equivalent for a `workflows/` build yet.
- **Menu**: `menu.sh`/`menu.cmd` exist and are thin wrappers that call
  `scripts/preflight-bootstrap.js` then delegate to `scripts/cli.js` — the spec's claim that these
  files "gain a new entry" is accurate in spirit; the actual work lands in `scripts/cli.js`'s menu
  table, not in the shell/batch wrapper files themselves.

## Verified Runtime Behaviour (Resolved V1, V2, V5, V6 + F8 Confirmations)

Resolved from the `workflow-authoring` reference (this plan's first pass could not load it; the
coordinator has since resolved four of the eight items). These are no longer part of WP-001's
scope — see the Supersession Notice and Phase 0 below.

- **V1 CONFIRMED.** `agent()` accepts `opts.agentType`, resolved from the same registry as the
  Agent tool (i.e. `~/.claude/agents/`). It composes with `opts.schema`: the custom agent's system
  prompt gets a StructuredOutput instruction appended by the runtime.
- **V2 CONFIRMED, with a mechanism correction.** Workflow subagents reach session-connected MCP
  tools via **ToolSearch**, with schemas loaded on demand per agent — not a blanket inheritance.
  The documented caveat about interactively-authenticated servers (e.g. `claude.ai`) being absent in
  headless/cron runs does **not** apply to `central_pm`, which is a local stdio server. **Design
  implication, binding on all prompt authoring in this plan:** prompts must name the MCP tool
  explicitly (e.g. "call `ledger_get_next_action`") so the agent's ToolSearch finds it — this plan's
  prompt templates already do this; it is now a documented constraint rather than an accident of
  phrasing (see Phase 1 step 9).
- **V5 RESOLVED — the spec had it backwards.** The `budget` object always exists. `budget.total` is
  `null` when no token target is set, and `budget.remaining()` then returns `Infinity`. Therefore
  `budget.remaining() > MIN_BUDGET_TOKENS` is safe **unguarded** — this plan drops the spec's
  defensive `budget?.remaining?.() ?? Infinity` form entirely (§7.4's guard clause simplifies to a
  direct comparison). Two consequences, both documented in `workflows/README.md` (Phase 6):
  (1) the `BUDGET` termination status is effectively dead unless the operator sets an explicit
  token-target directive — keep the status, but say so; (2) the budget is a **hard ceiling** —
  `agent()` *throws* once spend reaches `total` — so the pre-call guard is mandatory operational
  behaviour, not defensive-programming advice.
- **V6 CONFIRMED.** With `schema:` set, the subagent is forced to call a StructuredOutput tool and
  `agent()` returns the already-validated object — no text parsing. `polls.flatMap()` over objects
  works as originally assumed.
- **F8 confirmations (stated as verified, not assumed):** the 1,000-agent lifetime cap;
  `min(16, CPUs - 2)` as the runtime's own internal execution-concurrency cap (distinct from
  `ledger-run`'s `concurrency` arg, which this plan fixes at `1` — see D-B; naming collision noted
  to avoid confusion between the two concepts); 4,096 items per `parallel()`/`pipeline()`;
  `Date.now()`/`Math.random()`/argless `new Date()` throwing in the orchestrator scope; workflow
  scripts are plain JS, not TypeScript; `agent()` returns `null` on user-skip or a terminal API
  error after retries (matches the spec's R4); a `parallel()` thunk that throws resolves to `null`
  for that slot rather than rejecting the whole call.
- **F8 corrections to the algorithm/build design:**
  - `agent()` also accepts `opts.effort` (`'low'|'medium'|'high'|'xhigh'|'max'`), unmentioned in the
    spec. The reference recommends omitting `model` by default (agents inherit the session model)
    and reserving overrides for high-confidence cases. **This plan uses `effort: 'low'` on Poll-phase
    `agent()` calls instead of the spec's `model: 'haiku'` override** — see Phase 3 and the restated
    AC-05 below.
  - The runtime does **not** error when a `phase()` call has no matching `meta.phases` entry — it
    silently gets its own progress group. The spec's §6.2 bidirectional phase cross-check is
    therefore a **house lint** (useful for catching typos, not a runtime-enforced constraint) — this
    plan's build-validation step (Phase 2, step 12) keeps the check but documents it honestly as
    non-blocking-at-runtime, informational-at-build-time.
  - `workflow()` nesting is **one level only** — a nested call throws. `ledger-run` must therefore
    never call `workflow()` itself; this is a hard forward-compatibility constraint on the v2
    `/ledger-step` companion command (which calls `workflow('ledger-run', ...)` from *outside*
    `ledger-run` — fine — but rules out any future design where `ledger-run` recursively invokes
    itself or another named workflow).
  - `journal.jsonl` in the run's transcript directory records each agent's actual return value —
    resume debugging is better than the spec's §9.3 discussion assumes. Name this file in
    `workflows/README.md` alongside the "start a fresh run after editing the script" operational
    rule (Phase 6).

**CLAUDE.md injection cost — measured and accepted, no mitigation work package (F9).** Workflow
subagents receive the same CLAUDE.md files the main session would. The root `CLAUDE.md` in this
workspace is ~54 KB (~14k tokens); injected per agent per iteration, with 8 poll roles that is
~110k tokens of preamble per iteration before any dispatch call. The coordinator has explicitly
accepted this cost: the Orchestrator already pays an equivalent cost today (its agents run in total
isolation and each independently reads `AGENTS.md`/`CLAUDE.md`), so this is precedented, not novel,
operating overhead for this workspace's headless execution modes. No mitigation (collapsing the
poll fan-out, using CLAUDE.md-exempt built-in agent types) is in scope for this plan. The figure is
recorded here for token budgeting and folded into the Phase 4 smoke-run expectations (step 25) —
operators sizing a `ledger-run` session should budget for this preamble cost on every iteration, not
just the first.

## Critical Findings — Where the Spec Conflicts With the Codebase

These are corrections, not stylistic notes. Per this workflow's authority model, the codebase wins;
the spec's affected sections are cited so the eventual work packages can quote them directly.

### F1 — `ledger_get_next_action` batch mode never emits `INVOKE_AGENT` (blocks §7.3/§7.4 as written)

Verified in `mcp-server/src/tools/workflow-next-action-batch.ts`: the `WAIT` → `INVOKE_AGENT`
promotion happens exclusively inside `embedHandoffStatusInWait()`, which is called from
`getNextActionCore()` for the **single-result** path (`max_results` absent or `1`). The **batch**
path (`max_results > 1`, which is what the spec's `pollPrompt()` always requests via
`POLL_MAX_RESULTS = 3`) is served by `getNextActionsCollector()`, which returns `{ actions, total }`
directly and never calls `embedHandoffStatusInWait()`. Consequently, under the spec's algorithm as
written, `INVOKE_AGENT` can **never appear** in a poll result, and the auto-handoff detection the
spec's §7.3/§7.5 depend on is dead code. **F6 below documents a second, more severe instance of the
same root cause** — the fix for both is the same change to the poll design (Decision D1).

### F2 — Action vocabulary gaps in §7.3

Cross-referencing `getProjectManagerAction()` (Priority 3d) and `getQaAction()`/`getReviewerAction()`
(`WAIT_FOR_UPSTREAM_REWORK_LIMIT`) against the spec's `NON_DISPATCHABLE`/`PM_ACTIONS`/
`TERMINAL_ACTIONS` constants surfaces four real actions the spec's classification never mentions:

| Action | Emitted by | Correct classification | Why the spec's list is wrong |
|--------|-----------|------------------------|-------------------------------|
| `ROUTE_PIPELINE_AGENT` | PM (Priority 3d, `getProjectManagerAction`) | Dispatchable — but to `action.next_agent`, not to PM | Common in normal operation (fires whenever a stage PASSes and no READY WP exists to nudge the next agent). Missing from `PM_ACTIONS` means `filterDispatchable` treats it as generic work and tries to dispatch it to the PM persona, who cannot act on someone else's pipeline stage. |
| `CREATE_WORK_PACKAGES` | PM (§14.1 common pre-check) | PM_ACTION, always `halt: true` | `ledger-run`'s precondition is "PM has already registered work packages" (§3, out-of-scope: Planner stage). If this action still appears mid-run it means the ledger has zero WPs — the script must halt and hand back to a human, not dispatch a PM surrogate to write a plan-derived WP breakdown. |
| `SIGNAL_SYNTHESIS` | PM (`getNextActionCore`, all-WPs-terminal branch) | NON_DISPATCHABLE | Purely informational for the PM; the Synthesis role independently receives `GENERATE_SYNTHESIS` on its own next poll. Dispatching a PM persona for this wastes a turn. |
| `WAIT_FOR_UPSTREAM_REWORK_LIMIT` | QA / Reviewer / Security Auditor / Release Engineer | NON_DISPATCHABLE | Same shape as `WAIT_FOR_REWORK` (nothing this role can do) but the spec's list only names `WAIT_FOR_REWORK`. |

The spec's own §12.1 test obligation ("every action in Appendix B is classified exactly once...
the test fails if Appendix B gains an action the constants don't know") is the right mechanism to
catch this class of drift — it simply was never run against the real Appendix B before the spec was
drafted. Phase 1 seeds the constants correctly from the start so that test passes on day one instead
of failing and triggering an avoidable rework cycle.

### F3 — `auto_handoff` shape mismatch in Appendix B / §7.3

The spec assumes `{ action: 'INVOKE_AGENT', role: R, auto_handoff: { agent: T, prompt } }` as a
flat, top-level shape. The verified real shape (once F1 is fixed so it can appear at all) is:

```json
{
  "action": "INVOKE_AGENT",
  "reason": "...",
  "plan_path": "...",
  "handoff_status": {
    "current_agent": "Developer",
    "next_agent": "QA",
    "status": "READY_FOR_QA",
    "details": "...",
    "auto_handoff": {
      "agent_name": "4 - QA v3.9.1",
      "agent_id": "...",
      "cc_agent_name": "4-qa",
      "vs_agent_name": "...",
      "da_agent_name": "...",
      "prompt": "..."
    }
  }
}
```

Two concrete errors follow from using the spec's assumed shape as written: (a) the target role is
nested under `handoff_status.next_agent`, not `auto_handoff.agent`; (b) `auto_handoff.agent_name` is
a **decorated persona display string** ("4 - QA v3.9.1"), not a bare role name — using it directly
as a `ROLE_AGENT` lookup key would fail. `select.js`'s `INVOKE_AGENT` normalisation must read
`handoff_status.next_agent` for role resolution and `handoff_status.auto_handoff.prompt` for the
appended prompt text.

**Correction to this finding (2026-09-11 verification pass).** The payload above is the verified
shape from `workflow-handoff.ts:228-238`, and it is richer than the previous revision recorded: it
also carries **`cc_agent_name`** — the bare Claude Code slug (`"4-qa"`), which is *exactly* the
`ROLE_AGENT` lookup key, supplied directly by the server. Two consequences:

- The `Considered Alternatives` row for this decision was argued against a straw man (parsing the
  decorated `agent_name` string). The genuine alternative was always "use the purpose-built
  `cc_agent_name` field." The chosen design — resolve via `handoff_status.next_agent` against a
  build-time `ROLE_AGENT` map — **still stands**, because it keeps `personas/name-mapping.json` as
  the single source of truth and avoids coupling dispatch to a runtime field whose population
  depends on `AGENT_NAMES` being loaded. But the row is corrected below to weigh the real option.
- `cc_agent_name` is a free **runtime drift check**: where it is present and disagrees with
  `ROLE_AGENT[next_agent]`, the build-time map is stale relative to the running server. Phase 1
  step 7 logs this mismatch rather than discarding the field.

### F4 — `sync-personas.js --target workflow` and `personas/name-mapping.json` role-slug lookup are correct in principle, absent in practice

`ROLE_AGENT` construction from `name-mapping.json`'s `claude_code.agent_name` field (§5, §6.1) is
verified correct. The `--target workflow` extension to `sync-personas.js` (§11) is architecturally
sound (same `syncFromDir`-style pattern already used for VS Code/Claude Code) but requires a new
`getClaudeCodeWorkflowsDir()` helper in `publish-locations.js` and a fourth `VALID_TARGETS` entry —
today's file supports only `vscode`/`claude-code`/`all`. This is new code, not a small patch.

### F5 — `mcp-server` `pretest` is the wrong enforcement point for `build-workflows.js --check`

Spec §6.3 suggests both `.githooks/pre-commit` and `mcp-server`'s `pretest` run
`build-workflows.js --check`. `mcp-server/package.json`'s `pretest` currently runs
`build-personas.js` because `AGENT_ROLES`/role-name tests in `mcp-server/tests/` depend on
persona-derived role data staying in sync. `workflows/ledger-run.js` has no such dependency —
nothing in `mcp-server/tests/` reads `dist/claude-workflows/`. Coupling `mcp-server`'s test
pipeline to a sibling sub-project's build artifact for no functional reason is exactly the kind of
cross-project coupling the workspace's manifest-driven architecture exists to avoid. **Recommendation:**
enforce staleness only in `.githooks/pre-commit`, mirroring how the presentation/`​.context/`
staleness checks are pre-commit-only advisories, not `pretest` dependencies.

### F6 — The PM surrogate can never fire as specified (a second, more severe instance of F1)

Verified at `mcp-server/src/tools/workflow-next-action.ts:280-282`: when `max_results > 1`, the
handler short-circuits to `getNextActionsCollector()` **before** the per-role dispatch map runs at
all. `getNextActionsCollector()` (`workflow-next-action-batch.ts:221-238`) returns
`{ actions: [], reason: 'Batch actions not applicable for role: ...' }` for any role absent from
`AGENT_PIPELINE_MAP` — which is exactly **Project Manager, Synthesis, and Planner**. Since the
spec's poll algorithm polls every role, including Project Manager, at `max_results: POLL_MAX_RESULTS
= 3`, **all seven `PM_ACTIONS`** (`REVIEW_REWORK_LIMIT`, `REVIEW_STALE`, `REVIEW_ABANDONED`,
`UNBLOCK_WP`, `REPAIR_TIMESTAMPS`, `REPAIR_ORPHAN_BLOCKED`, `RESUME_OR_CANCEL`) are unreachable, and
the entire PM-surrogate escalation path (§7.4's "Escalate" phase) is dead code as specified.

**Mitigating detail, verified:** the terminal paths in `getNextActionCore()` return *before* the
`max_results` branch is even reached — the zero-WP case (`CREATE_WORK_PACKAGES` for PM) and the
all-complete case (`GENERATE_SYNTHESIS` for Synthesis, `SIGNAL_SYNTHESIS` for PM) are both
evaluated earlier in the function and short-circuit before batch mode applies. So bootstrap and
termination detection **do survive** a batch poll of PM/Synthesis; only mid-run PM escalation is
broken.

**Fix, folded into Decision D1:** the Project Manager (and, for consistency and future-proofing,
Synthesis and Planner) must always be polled at `max_results: 1`. Combined with F1's fix, this
collapses the poll design to a single rule with no exceptions: **every role, every iteration,
`max_results: 1`** — which is also what D-B's fixed `concurrency: 1` decision independently implies
(there is no scenario in v1 where a batch call would even be useful). The per-role `max_results`
value is made an explicit, tested part of the design (a trivial "all roles → 1" table, kept as a
named object rather than an implicit constant so a future concurrency fast-follow has one place to
change) — see Phase 1 step 5 and the new lib-level test in Phase 4 asserting PM/Synthesis/Planner
are never polled with `max_results > 1`.

### F7 — Spec Appendix B's trailing-JSON instruction is redundant and likely harmful under `schema:`

Per the resolved V6 above, passing `schema:` to `agent()` forces the subagent to call a
StructuredOutput tool; the runtime — not text parsing — produces the validated return value. Spec
Appendix B's Dispatch and PM-surrogate prompt templates additionally instruct the persona to
"Finish your response with one JSON object matching this schema," which asks the persona to *also*
produce a second, textual JSON block. This invites the persona to emit both a StructuredOutput tool
call and a trailing JSON blob — at best wasted tokens, at worst a persona that satisfies the
text instruction instead of the tool call and produces an unvalidated response. Spec §7.7's
reliability claim ("the runtime's schema retry makes this reliable... the instruction lives in the
dispatch prompt") is directionally right but names the wrong mechanism. **Per explicit user
guidance, this plan deviates from the spec rather than following it to the letter** (see
Supersession Notice item 4): the Dispatch and PM-surrogate prompts keep every *behavioural*
instruction (confirm the action is still recommended before starting expensive work; return
`SKIPPED` if not; scope to exactly one action; no Git writes) and drop the JSON-formatting
instruction entirely, relying on `schema:` alone. The fake-runtime test harness (Phase 4, step 22)
is corrected to match: it must model the StructuredOutput return path, not text-extracted JSON.

### F8 — Smaller runtime corrections (full detail in "Verified Runtime Behaviour" above)

Summarised here for completeness of the Critical Findings list; see the dedicated section above for
the reasoning behind each: (1) `effort: 'low'` replaces `model: 'haiku'` as the Poll-phase lever;
(2) the §6.2 `phase()`/`meta.phases` bidirectional check is a house lint, not an enforced runtime
constraint — reclassified, not removed; (3) `workflow()` nesting is one level only, constraining the
v2 `/ledger-step` design; (4) `journal.jsonl` materially improves on the spec's §9.3 resume-debugging
story and should be documented; (5) the 1,000-agent cap, the runtime's own `min(16, CPUs-2)`
execution-concurrency cap, the 4,096-item `parallel()` cap, and R4's `null`-on-skip/error behaviour
are all confirmed as specified, not merely assumed.

### F9 — CLAUDE.md injection cost is a known, accepted operating cost (no action required)

See "Verified Runtime Behaviour" above for the full figure and the Orchestrator precedent. Recorded
here only to close the loop: this was raised as a candidate finding during this revision and
explicitly resolved by the coordinator as accepted, not mitigated. No work package addresses it.
(Figure re-verified this pass: `CLAUDE.md` is 54,414 bytes.)

### F10 — Polling is a **write** operation against a finite, non-resetting budget (design-blocking)

Verified at `mcp-server/src/tools/workflow-handoff.ts:219-226`. The plan's entire poll design
assumes `ledger_get_next_action` is a side-effect-free read. It is not. The call chain
`embedHandoffStatusInWait()` → `computeHandoffStatus()` → `buildHandoffResponse()` executes:

```ts
const currentDepth = root.auto_handoff_depth ?? 0;
if (currentDepth < effectiveMaxDepth(root.total_work_packages ?? 0)) {
  await store.writeRootIndex({ ...root, auto_handoff_depth: currentDepth + 1, last_updated: now() });
  // ... payload.auto_handoff = { ... }
}
```

Every poll that yields an eligible handoff **increments a persistent counter and rewrites the root
index**. Per `project-lifecycle.ts:887` and §18.4, `auto_handoff_depth` resets **only** on synthesis
completion — never per-iteration, never per-WP. Three consequences, none of which the previous
revision considers:

1. **Silent misattributed termination.** Once `currentDepth >= effectiveMaxDepth(total_work_packages)`,
   the `auto_handoff` key is omitted — so `embedHandoffStatusInWait()`'s `WAIT → INVOKE_AGENT`
   promotion stops firing (it is conditioned on `hs?.['auto_handoff'] !== undefined`). The loop then
   observes only non-dispatchable actions and trips its **stall** detector. The run reports "stalled"
   when the true cause is "handoff depth exhausted" — a diagnosis the operator cannot reach from the
   loop's own output.
2. **High-priority comment spam.** Each suppressed poll appends a `priority: 'high'` project comment
   (`:241-253`) and writes the root index again. With D1's 8 polls/iteration, a loop running past the
   ceiling writes up to 8 high-priority comments per iteration into the user's ledger.
3. **Shared budget with interactive use.** The counter is ledger state, not run state. A `ledger-run`
   session consumes depth that a subsequent human-driven VS Code session on the same project then
   does not have.

`effectiveMaxDepth` (`utils/workflow-helpers.ts:71`) is
`max(config max_handoff_depth, total_work_packages × 30)`. **Note the drift here:** the helper's own
docstring (`:66-69`) still says the floor is `50`, and `auxiliary-systems.md` §18.2 repeats that
number, but the actual runtime default is `100` — both `mcp-server/src/gui/config.ts:46`
(`DEFAULT_CONFIG.max_handoff_depth`) and `shared/workflow-manifest.json:133`
(`constants.max_handoff_depth`) say `100`. The stale docstring and spec prose are a pre-existing
`mcp-server`/spec drift that this plan does **not** fix (out of scope) but must not perpetuate:
every number this plan derives comes from the manifest, never from the docstring or spec prose. So
for this plan's own 7-WP shape the ceiling is 210 — reachable within ~26 iterations at 8 polls each,
well inside the iteration cap `guards.js` computes. **This is not a theoretical edge case; it is the
expected path for any non-trivial run.**

**Fix (Phase 1, `guards.js`):** read `auto_handoff_depth` / `total_work_packages` from the poll
response's ledger state and add a depth-aware guard with its own `HANDOFF_DEPTH` termination status,
distinct from `STALLED`. Also treat `handoff_suppressed_reason: 'depth_limit_reached'` — a real
field, verified at `:241` and asserted in `mcp-server/tests/integration/auto-handoff.test.ts:353` —
as a first-class termination signal rather than an unrecognised key.

### F11 — `INVOKE_AGENT` has two gates beyond `max_results`; the F1 fix alone does not make it reachable (design-blocking)

Verified at `workflow-handoff.ts:206-219`. Fixing F1 (single-result polling) is **necessary but not
sufficient**. `auto_handoff` is emitted only when *all* of these additionally hold:

```ts
getConfig().auto_handoff_enabled &&   // GUI config, default true
isRegistryLoaded()                    // agent registry must be populated
...
const agentName = nextAgent ? getAgentHandle(nextAgent) : null;
if (agentName !== null) { /* only here is auto_handoff set */ }
```

`isRegistryLoaded()` returns true only if `discoverAgents()` found `*.agent.md` files at startup
(`utils/agent-registry.ts:109-127`), and `resolveAgentsDir()` (`src/index.ts:37-61`) defaults to the
**VS Code User prompts folder** — on macOS, `~/Library/Application Support/Code/User/prompts`. It is
overridable only via the `--agents-dir` CLI argument.

**Consequence:** in a headless `claude -p` run on a machine where VS Code personas have not been
synced (or in CI, or in a container), the registry is empty, `getAgentHandle()` returns `null`, and
**`INVOKE_AGENT` never fires regardless of `max_results`** — the server falls through to plain
`WAIT`. The loop then never sees an auto-handoff, and F1's entire fix delivers nothing at runtime.
This is a silent, environment-dependent failure whose symptom (everything stalls) is identical to
F10's.

**Why the previous revision's AC-06 cannot catch this:** a fake-runtime scenario test supplies a
fixture that *already contains* `handoff_status.auto_handoff` and asserts the loop routes it
correctly. That validates the loop's consumption of the payload, which is worth testing — but it
says nothing about whether the server ever produces the payload in the target environment. The gate
is upstream of everything the harness models.

**Fix (two parts):**
1. **Operational prerequisite**, documented in `workflows/README.md` and enforced by the smoke test:
   either sync VS Code personas (`node scripts/sync-personas.js --target vscode`) or register the
   MCP server with `--agents-dir` pointing at `~/.claude/agents/` (which `sync-personas.js
   --target claude-code` populates). **Note the file-extension mismatch** —
   `discoverAgents()` filters on `*.agent.md` (`:123`) while the Claude Code target emits `*.md`, so
   pointing `--agents-dir` at `~/.claude/agents/` may yield an empty registry. WP-001 must determine
   which of the two routes actually works rather than assuming either does.
2. **New verification item V9** in WP-001 (see Phase 0): confirm `auto_handoff` is actually emitted
   in the target headless environment, evidenced by a real captured payload — not a fixture.

### F12 — Appendix A's `ACTIONS_SCHEMA` encodes the F3 bug and would reject the real payload

Spec Appendix A defines:

```js
auto_handoff: {
  type: 'object', required: ['agent', 'prompt'],
  properties: { agent: { type: 'string' }, prompt: { type: 'string' } },
},
```

under a top-level `additionalProperties: false`. Two defects: (a) `required: ['agent']` names a field
the server never emits (F3 — the real keys are `agent_name`, `agent_id`, `cc_agent_name`,
`vs_agent_name`, `da_agent_name`, `prompt`), so a faithful poll response **fails schema validation**;
(b) the schema places `auto_handoff` on the action object, whereas it is nested under
`handoff_status`. Phase 1 step 6's instruction to write `schemas.js` "per Appendix A" would therefore
bake F3's bug into the one place that makes it a hard runtime failure rather than a routing bug.
The schema must mirror the verified shape and tolerate the extra keys.

## Approach / Architecture

`workflows/` becomes a fourth sub-project (module 4, settled per coordinator decision D-A — no
longer an open question; the "separate vs. folded into `personas/`" trade-off is resolved and the
fourth-manifest cost is accepted, not tracked as a risk), following the shape the spec proposes in
§5, with the vocabulary and polling-strategy corrections from F1–F9 folded directly into the pure
library modules so no corrective rework cycle is needed. The build pipeline is a new,
purpose-built Node.js script (`scripts/build-workflows.js`) rather than an extension of
`@mistralys/persona-builder` — the workflow script is JS-with-purity-constraints, not a
Markdown/YAML persona template, so reusing the persona builder's templating engine would be a
worse fit than a small dedicated concatenation-and-validation script (verified:
`personas/persona-build.config.js` has no notion of a non-Markdown output format).

Distribution follows the existing `sync-personas.js` pattern exactly: `--target workflow` copies
`dist/claude-workflows/*.js` to `~/.claude/workflows/`, using a new `getClaudeCodeWorkflowsDir()`
helper alongside the existing `getVSCodePromptsDir()`/`getClaudeCodeAgentsDir()` in
`publish-locations.js`.

## Rationale

- **Corrected vocabulary first, not as rework.** Seeding `constants.js` with the four missing
  actions (F2) before any dispatch logic is written avoids a guaranteed first-pass QA failure
  (spec's own §12.1 table-driven test would fail against the real Appendix B) and the resulting
  rework cycle. Cheaper to fix in the plan than in code review.
- **Poll-mode fix (F1 + F6) resolved via unconditional single-result polling, not a batch-mode
  server change.** Changing `getNextActionsCollector()` to also compute
  `handoff_status`/`auto_handoff`, or to route Project Manager through the per-role dispatch map,
  would touch `central_pm` routing logic, which is explicitly out of scope (spec §3, "Any change to
  `central_pm` routing logic ... file a ledger change request; do not work around it in the
  script"). The correct fix lives entirely in the workflow script: poll **every** role, **every**
  iteration, with `max_results: 1` — no batch escalation tier. This single rule fixes both F1
  (`INVOKE_AGENT` reachability) and F6 (PM-surrogate reachability) at once, and it is also what
  coordinator decision D-B (concurrency fixed at `1` for v1) independently implies: a batch call
  would only ever be useful to support `concurrency > 1`, which v1 does not have. See Phase 1,
  Decision D1.
- **New build script over persona-builder reuse.** The persona builder's whole design center is
  Markdown+YAML→Markdown template assembly with frontmatter; `ledger-run.js`'s build (concatenate
  JS files, strip `export`, statically forbid `import`/`Date.now()`/etc.) shares no primitives with
  that pipeline. Forcing it through `@mistralys/persona-builder` would be the smaller amount of new
  code today and the wrong shape for the next unrelated JS build this workspace needs.
- **`concurrency` fixed at `1` for v1 (settled, D-B).** The Orchestrator (`orchestrator/src/`) is
  this workspace's other headless pipeline executor and ships strictly serial WP execution — it is
  the known-reliable precedent. Per the coordinator's explicit rationale, `ledger-run` v1 stays on
  the same proven ground rather than introducing concurrent dispatch as a first-version feature.
  This also happens to be the cheapest fix available for F1/F6 (see above) — a rare case where the
  reliability-first choice and the correctness-first choice are the same choice.
- **`deny-git-writes.json` is print-instructions-only for v1 (settled, D-D).** No script in this
  workspace auto-modifies a user's global Claude Code settings file today (`sync-personas.js` only
  ever writes to IDE-owned agent/prompt directories) — extending that precedent to silently merge
  hook configuration would be a new category of side effect. Per the coordinator's explicit
  guidance, automating the merge is an accepted fast-follow if the manual step proves to be
  friction in practice, not a v1 requirement.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|--------------------------|---------------------|
| Poll strategy for `INVOKE_AGENT`/PM-surrogate detection (F1 + F6) | Every role, every iteration, `max_results: 1` — no batch tier | (a) Always poll batch and accept `INVOKE_AGENT`/`PM_ACTIONS` are unreachable, relying purely on `NON_DISPATCHABLE`/idle-stall detection; (b) request a `central_pm` change to compute `handoff_status` in batch mode and route PM through the per-role dispatch map; (c) a two-tier poll (single-result first, batch escalation for `concurrency > 1`) — this plan's own first-pass proposal | (a) silently drops two documented mechanisms (auto-handoff *and* the entire PM-surrogate escalation path) and risks the loop never noticing "all done" or "PM must intervene" until a stall/rework-limit timeout; (b) is explicitly out of scope per spec §3; (c) was this plan's original proposal but is now moot — it existed solely to preserve multi-WP parallelism, which coordinator decision D-B removes from v1 entirely. The chosen shape is strictly simpler than (c) and was the direction D-B pushed toward independently. |
| `workflows/` as new sub-project vs. folded into `personas/`+`scripts/` | **Settled (D-A):** new top-level `workflows/` sub-project, as spec proposes | Fold `workflows/src/` into `personas/ledger/` and add `build-workflows` as a mode of `build-personas.js` | Folding would avoid a fourth top-level directory and a fourth manifest to maintain, but conflates two build systems with materially different constraints (Markdown template assembly vs. JS-purity-enforcing concatenation) under one config surface, and would force every `personas/` contributor to understand Dynamic Workflow purity rules. The coordinator has accepted the separate-sub-project shape and its fourth-manifest cost; this row is no longer an open question. |
| Build tooling | New dedicated `scripts/build-workflows.js` | Extend `@mistralys/persona-builder` with a new output format | Persona-builder's templating model (YAML front-matter + Handlebars-style partials) has no notion of "concatenate raw JS, strip exports, statically forbid identifiers" — forcing this in would require new library-level primitives for a single, atypical consumer. A ~150-line dedicated script is simpler and does not risk destabilising the shared library used by three other suites. |
| `INVOKE_AGENT`/`ROUTE_PIPELINE_AGENT` role resolution | Read `handoff_status.next_agent` / `action.next_agent` (bare role names), resolved against the build-time `ROLE_AGENT` map | (a) Use the server-supplied **`cc_agent_name`** slug directly (the real alternative — see F3's correction; it is already the exact Claude Code slug); (b) parse the role out of `auto_handoff.agent_name`'s decorated string (`"4 - QA v3.9.1"` → `"QA"`) | (b) is fragile — a display-format change silently breaks routing — and was the only alternative the previous revision considered, which made this row a straw man. (a) is genuinely viable and simpler, but makes dispatch depend on a runtime field whose presence requires `AGENT_NAMES` to be loaded server-side, and bypasses `personas/name-mapping.json` as the single source of truth for role slugs (a workspace-wide pattern). Chosen shape keeps the manifest authoritative; `cc_agent_name` is retained as a **drift check** rather than as the lookup key, capturing (a)'s value without its coupling. |
| Poll-phase model lever | `effort: 'low'` (settled, F8) | `model: 'haiku'` explicit override (spec's original proposal) | The reference documentation advises reserving `model` overrides for high-confidence cases and otherwise inheriting the session model; `effort` is the purpose-built lever for "make this call cheap" without hardcoding a specific model identifier that may become stale as model offerings change. |
| Dispatch/PM-surrogate prompt JSON instruction | Drop the trailing-JSON instruction; rely on `schema:` alone (F7, explicit deviation from spec Appendix B) | Keep the spec's "finish with one JSON object" instruction as a redundant belt-and-suspenders measure | Redundant instructions under a forced StructuredOutput tool call risk the persona satisfying the text instruction instead of (or in addition to) the tool call, at best wasting tokens and at worst producing an unvalidated trailing blob the runtime ignores. The coordinator explicitly directed deviating from the spec here since this is greenfield work with no existing callers to preserve compatibility with. |
| Handling the finite `auto_handoff_depth` budget consumed by polling (F10) | Depth-aware guard in `guards.js` with a distinct `HANDOFF_DEPTH` termination status; treat `handoff_suppressed_reason` as a first-class signal | (a) Ignore it — accept that depth exhaustion presents as a stall; (b) request a `central_pm` change so polls do not increment depth (e.g. a read-only `peek` parameter); (c) have the loop reset the counter itself | (a) is what the previous revision did implicitly, and it produces a misdiagnosed termination the operator cannot debug from the loop's output — the failure mode this whole plan exists to avoid. (b) is the *architecturally* correct fix (polling genuinely should not mutate state) but is out of scope per spec §3 and would block v1 on a server change. (c) is unacceptable: the counter is a safety guard against runaway handoff chains, and a client resetting another component's circuit breaker defeats its purpose. The chosen shape makes the ceiling **visible and correctly attributed** without touching server semantics, and leaves (b) available as a follow-up. |
| Making `INVOKE_AGENT` actually reachable in headless runs (F11) | Documented operational prerequisite (synced agent registry) + live-payload verification in WP-001 (V9) | (a) Rely on the fake-runtime scenario test alone, as the previous revision's AC-06 did; (b) design the loop to not depend on `INVOKE_AGENT` at all, treating auto-handoff as a pure optimisation | (a) cannot detect the gate — it asserts against a fixture that presupposes the payload the gate may never produce. (b) is worth noting as a genuine robustness property and is **partially adopted**: the loop already dispatches on each role's own next-action recommendation, so a missing `INVOKE_AGENT` costs iterations rather than correctness. But relying on that silently wastes ~8 polls per handoff and forfeits the auto-handoff mechanism the ledger provides, so the prerequisite is documented and verified rather than quietly tolerated. |

## Pattern Alignment

- **Follows** the `sync-personas.js` copy pattern (`syncFromDir`-style source→target copy with a
  filename-extraction function) for `--target workflow` deployment — no new sync mechanism invented.
- **Follows** the `build-personas.js` CLI convention (`--check`, `--strict`, `--dry-run` as a
  `--check` alias) for `build-workflows.js`, so operators reach for the same flags on both.
- **Follows** the workspace's manifest-first rule: `ROLE_AGENT` is generated at build time from
  `personas/name-mapping.json`, never hand-maintained — no parallel role list is introduced.
- **Departs** from the persona build system's templating engine (justified above under Rationale
  and Considered Alternatives — different problem shape, not a stylistic choice).
- **Departs** from putting the staleness check in `mcp-server`'s `pretest` (F5) — placed only in
  `.githooks/pre-commit`, matching the precedent set by the `.context/`-staleness and
  presentation-`dist/`-staleness advisories, which are pre-commit-only and do not gate `npm test`
  in an unrelated module.
- **Departs** from spec Appendix B's prompt-formatting instructions (F7) — this is a deliberate,
  coordinator-directed deviation from the spec text itself (not from any existing codebase pattern),
  justified because this is greenfield work with no prior callers whose prompt contract must be
  preserved.

## Structural Improvements

New code only — no existing structures in scope. `workflows/` is a new sub-project; the only
existing files touched are `scripts/sync-personas.js` (new `--target workflow` branch, additive)
and `scripts/publish-locations.js` (new exported helper function, additive). Neither touched file
has an existing structure that "no longer fits" as a result of this work — both are extended along
an already-established seam (`getPublishLocations()`/`VALID_TARGETS`).

## Detailed Steps

### Phase 0 — Runtime Verification Spike (WP-001, documentation-only, gates every other work package — settled, D-C)

WP-001 is a standalone work package with a **documentation-only pipeline** (no implementation/QA/
code-review stages — its deliverable is a findings document, not code). Every other work package in
this plan depends on WP-001. This is a hard gate, not a "recommended" one: a V-item failure must
surface as a clean "plan needs rework" signal before any implementation investment, not as a
discovery inside a half-complete implementation work package.

Four of the original eight items are already resolved (V1, V2, V5, V6 — see "Verified Runtime
Behaviour" above) and are **out of WP-001's scope**; their conclusions are already folded into this
plan's design. WP-001's scope is the four remaining spec items **plus V9, added by F11**:

1. Attempt to load the Claude Code `/workflow-authoring` reference (or equivalent bundled
   documentation) in a live Claude Code session with Dynamic Workflows enabled, and/or run the
   targeted live smoke tests below. This plan's authoring pass could not invoke that reference
   directly (it is a Claude Code CLI-bundled resource, not a repository file reachable by
   filesystem tools) — WP-001 is the first opportunity to close this gap with a live session.
2. Produce a pass/fail verdict with a one-line evidence note for each remaining item:
   - **V3** `mcpServers` frontmatter honoured for `.claude/agents/` files (affects nothing in this
     plan directly, but resolves a footnote in the ledger-bootstrapper persona — informational only)
   - **V4** `Run /ledger-run with args {...}` works under `claude -p` with `Workflow(ledger-run)` allowed
   - **V7** `PreToolUse` hooks fire for workflow subagents (`agent_id` present) — **highest-stakes
     item remaining.** The entire "no Git writes by agents" guarantee in spec §10 (D-D: print-only
     `deny-git-writes.json`) rests on this. **Branch condition:** if V7 fails, D-D's
     print-instructions approach has nothing to print — a `PreToolUse` hook that never fires cannot
     enforce anything — and the Git-write constraint needs a materially different enforcement
     mechanism (candidates to evaluate if this branch is taken: a wrapper script around `claude -p`
     invocations that inspects tool-call logs post-hoc, or accepting the constraint as
     unenforceable for `ledger-run` specifically and documenting that gap prominently). Do not
     proceed to Phase 5 until this branch is resolved one way or the other.
   - **V8** Company/Teams admin has not disabled workflows in this environment
   - **V9 (new, from F11) — `auto_handoff` is actually emitted in the target environment.**
     Second-highest-stakes item after V7, because F1's fix delivers nothing if this fails. Steps:
     (a) confirm how the `central_pm` server is registered in the target environment and what
     `--agents-dir` resolves to (default: the VS Code User prompts folder — on macOS
     `~/Library/Application Support/Code/User/prompts`); (b) confirm the server logs
     `Agent registry: N agents discovered` rather than `agents_dir not found` at startup
     (`src/index.ts:176-184` — this line is the single cheapest diagnostic for the whole finding);
     (c) capture a **real** `ledger_get_next_action` response at `max_results: 1` for a role with a
     pending handoff and confirm `handoff_status.auto_handoff` is present, recording the verbatim
     payload in the findings document so Phase 1's `schemas.js` (F12) is written against observed
     fact rather than against Appendix A. **Branch condition:** if the registry cannot be populated
     in the target headless environment, record whether `--agents-dir ~/.claude/agents/` works
     despite the `*.agent.md` vs `*.md` extension mismatch noted in F11; if neither route works,
     `INVOKE_AGENT` is unreachable in headless mode and the loop must be documented as relying
     solely on per-role next-action polling (a correctness-preserving but less efficient mode — see
     the F11 row in Considered Alternatives). Do not begin Phase 1 until this is resolved either way.
3. Produce a findings document that **replaces** spec §14's table (the four now-resolved items, the
   four freshly-verified ones, and V9 — so the document is self-contained and the spec's §14 is
   fully superseded). This is WP-001's sole deliverable, feeding directly into `workflows/README.md`'s
   "Verified Runtime Behaviour" section (Phase 6, step 28) — Phase 3 (loop implementation) may not
   begin until this document exists and both V7's and V9's branch conditions are resolved.

### Phase 1 — `workflows/` Scaffolding and Pure Library Modules

4. Create the `workflows/` sub-project skeleton: `workflows/README.md` (stub, filled in Phase 6),
   `workflows/package.json` (test runner only — Vitest, matching `mcp-server`'s existing choice
   over `node:test` for consistency across the monorepo), `workflows/src/`, `workflows/templates/`,
   `workflows/test/`.
5. Write `workflows/src/lib/constants.js` with the **corrected** vocabulary from F2 and the
   **corrected, unconditional single-result poll strategy** from F1/F6/D-B:
   ```
   NON_DISPATCHABLE = ['WAIT', 'WAIT_FOR_REWORK', 'WAIT_FOR_DOWNSTREAM',
                       'WAIT_FOR_UPSTREAM_REWORK_LIMIT', 'CONTINUE_PIPELINE',
                       'BLOCK_FOR_REWORK_LIMIT', 'SIGNAL_SYNTHESIS'];
   PM_ACTIONS       = ['REVIEW_REWORK_LIMIT', 'REVIEW_STALE', 'REVIEW_ABANDONED', 'UNBLOCK_WP',
                       'REPAIR_TIMESTAMPS', 'REPAIR_ORPHAN_BLOCKED', 'RESUME_OR_CANCEL',
                       'CREATE_WORK_PACKAGES'];
   TERMINAL_ACTIONS = ['GENERATE_SYNTHESIS'];
   ROUTABLE_PM_ACTIONS = ['ROUTE_PIPELINE_AGENT']; // dispatch to action.next_agent, not to PM
   // 8 of the 9 manifest roles. Planner is deliberately excluded: it runs before the ledger
   // exists (spec §3 out-of-scope) and has no next-action recommendation to serve mid-run. This
   // omission is intentional, not an oversight — the build-validation rule in step 12 encodes the
   // same exception ("every manifest role except Planner"), and a lib-level test asserts the
   // set equals the manifest roles minus Planner so a future manifest role addition fails loudly
   // rather than being silently unpolled.
   POLL_ROLES       = ['Project Manager', 'Developer', 'QA', 'Security Auditor', 'Reviewer',
                       'Release Engineer', 'Documentation', 'Synthesis'];
   // Per-role max_results, explicit and tested rather than an implicit constant (F6): every role
   // is 1 in v1 because (a) batch mode cannot return PM_ACTIONS or handoff_status at all (F1/F6),
   // and (b) concurrency is fixed at 1 (D-B), so a batch call would have no consumer even where
   // the tool supports it. A future concurrency fast-follow changes only this table.
   POLL_MAX_RESULTS = Object.fromEntries(POLL_ROLES.map(role => [role, 1]));
   CONCURRENCY       = 1;  // fixed for v1 (D-B) — not an args-table field, not clamped
   MIN_BUDGET_TOKENS = 40_000;
   ```
6. Write `workflows/src/lib/schemas.js` (`ACTIONS_SCHEMA`, `STAGE_RESULT_SCHEMA`,
   `PM_RESULT_SCHEMA`) — based on Appendix A but **with its `auto_handoff` sub-schema replaced, not
   copied (F12)**. Appendix A's `auto_handoff: { required: ['agent', 'prompt'] }` under a top-level
   `additionalProperties: false` would reject the real payload outright. Corrections:
   - Move `auto_handoff` to where the server actually puts it: nested inside a `handoff_status`
     object on the action, not flat on the action (F3).
   - Require only `prompt`; permit `agent_name`, `agent_id`, `cc_agent_name`, `vs_agent_name`,
     `da_agent_name` as optional string properties, and **do not set `additionalProperties: false`
     on this sub-object** — the server may add handle fields for future targets, and a poll schema
     that rejects an unknown-but-harmless key converts a server enhancement into a workflow outage.
   - Add optional `handoff_suppressed_reason` (string) alongside `auto_handoff` on the
     `handoff_status` object — a real field (`workflow-handoff.ts:241`) that `guards.js` consumes
     per F10; if the schema omits it, the depth-exhaustion signal is stripped before the loop sees it.
   - Write the final shape against WP-001 V9's **captured verbatim payload**, not against this
     description, and treat any divergence as a finding rather than adjusting the server.
   `PM_RESULT_SCHEMA.resolution` enum is extended to include `'HALTED'` (for `CREATE_WORK_PACKAGES`
   — the surrogate cannot self-resolve this, only report and halt) alongside the existing
   `CANCELLED_WP`/`CANCELLED_PIPELINE`/`UNBLOCKED`/`REPAIRED`/`RESET_REWORK`/`NO_ACTION`.
7. Write `workflows/src/lib/select.js` implementing `filterDispatchable()`, `dedupeByWp()`, and a
   new `normaliseRoutableActions()` step that runs **before** `filterDispatchable()`:
   - `INVOKE_AGENT` → `{ action: 'INVOKE_AGENT', role: handoff_status.next_agent, work_package_id,
     prompt: handoff_status.auto_handoff.prompt }` (per F3 — reads `next_agent`, never
     `auto_handoff.agent_name`). Additionally, where `handoff_status.auto_handoff.cc_agent_name` is
     present and does not equal `ROLE_AGENT[handoff_status.next_agent]`, emit a `log()` drift warning
     and continue using the `ROLE_AGENT` value (per F3's correction — the build-time map stays
     authoritative; the server-supplied slug is a staleness detector, not a fallback, so a stale
     build is reported rather than silently worked around).
   - `ROUTE_PIPELINE_AGENT` → `{ action: 'ROUTE_PIPELINE_AGENT', role: action.next_agent,
     work_package_id, pipeline_type: action.pipeline_type }` (per F2)
   `dedupeByWp()`'s priority order gains `ROUTE_PIPELINE_AGENT` at the same tier as
   `(IMPLEMENT, RUN_QA, RUN_SECURITY_AUDIT, RUN_REVIEW, RUN_RELEASE_ENGINEERING, WRITE_DOCS)` —
   it is functionally "start this WP's next stage," the same shape as those six actions.
8. Write `workflows/src/lib/guards.js`: `effectiveMaxIterations()` per §7.6/§9.6 (unchanged from
   spec — already verified consistent with `shared/workflow-manifest.json`'s
   `handoff_depth_multiplier: 30`), plus `shouldStop()`, **plus a new depth-aware guard required by
   F10**:
   - Add `HANDOFF_DEPTH` to the termination-status set, distinct from `STALLED`. Without this, depth
     exhaustion is misreported as a stall and the operator has no path to the real cause.
   - `shouldStop()` returns `HANDOFF_DEPTH` when any poll response carries
     `handoff_status.handoff_suppressed_reason === 'depth_limit_reached'` — the server's own explicit
     signal, preferred over any client-side arithmetic.
   - Add `effectiveMaxDepth(totalWorkPackages)` mirroring
     `mcp-server/src/utils/workflow-helpers.ts:71` (`max(floor, total × multiplier)`) purely so the
     loop can **warn** as it approaches the ceiling. This is a deliberate, documented exception to
     the "no routing knowledge in the script" rule: it duplicates a server constant for diagnostics
     only and never gates a routing decision — note it in `workflows/README.md` and in the manifest
     constraints so it is not later mistaken for creeping routing logic. **Source both numbers from
     `shared/workflow-manifest.json` at build time** (same mechanism as `ROLE_AGENT`) rather than
     hardcoding either: the multiplier from `constants.handoff_depth_multiplier` (`30`) and the
     floor from `constants.max_handoff_depth` (`100`, matching `DEFAULT_CONFIG.max_handoff_depth` in
     `mcp-server/src/gui/config.ts:46`), so the duplication cannot silently drift. Do **not** take
     the floor from the helper's docstring (`:66-69`) or from `auxiliary-systems.md` §18.2 — both
     still say `50` and are stale relative to the running default (see F10). **Why the duplication is worth
     carrying (per the Plan Architect Reviewer's Decision 5 finding):** the hard `HANDOFF_DEPTH`
     gate is reactive by construction — it only fires on the poll where the server has already
     suppressed `auto_handoff`, i.e. after the ceiling is hit — so without this proactive warning
     the operator's first signal of an approaching budget exhaustion is the termination itself,
     with no lead time to intervene (e.g. via `ledger_complete_synthesis` or PM escalation) before
     the run stops. The build-time-sourced duplicate buys that lead time at the cost of a second
     source of truth for a server-owned constant; because both the floor and the multiplier are
     derived from the manifest rather than hardcoded, and because the warning never influences `shouldStop()`'s
     actual decision, the risk is confined to a stale *warning threshold*, never a stale
     *termination*. The smoke run (Phase 4, step 25) is flagged to confirm this lead time is
     meaningful in practice.
   - **Do not reset `auto_handoff_depth` from the workflow.** It is a server-side safety guard
     against runaway handoff chains; a client clearing it defeats the mechanism. Where a run
     legitimately needs more depth, `ledger_complete_synthesis` (the documented reset point, §18.4)
     or human PM intervention is the correct route.
9. Write `workflows/src/lib/prompts.js`: `pollPrompt()`, `dispatchPrompt()`, `pmPrompt()`. The poll
   prompt template is revised from Appendix B to reflect **Decision D1** (below): it instructs the
   polling agent to call `ledger_get_next_action` with `max_results: 1` (always — no per-role
   variance in v1), and to report `handoff_status` verbatim if present (needed for `INVOKE_AGENT`
   detection). There is no `batchPollPrompt()` variant in v1 — the two-tier poll from this plan's
   first pass is removed entirely now that `concurrency` is fixed at `1` (D-B; see Considered
   Alternatives). Per the resolved **V2** finding, every prompt in this module must name the MCP
   tool it needs explicitly (e.g. "call `ledger_get_next_action`", "call `ledger_complete_pipeline`")
   so the subagent's ToolSearch can find it — this is now a documented constraint on every prompt
   string this module produces, not an incidental phrasing choice. Per **F7**, the Dispatch and
   PM-surrogate prompts drop the spec Appendix B "finish with one JSON object" instruction entirely
   — `schema:` alone drives the StructuredOutput return. Per **F9**, prompts must not re-state
   workspace-wide rules already delivered via CLAUDE.md injection (e.g. do not tell a persona to
   "re-read CLAUDE.md" or restate its general operating philosophy) — name only the one rule the
   stage specifically needs (e.g. "do not commit, push, or create branches"), exactly as the spec's
   own Appendix B dispatch template already does; this module must not regress that discipline as
   it grows.
10. **Decision D1 (poll strategy, corrected and simplified — settled):** poll every `POLL_ROLES`
    entry, every iteration, with `max_results: 1`. No batch tier, no escalation condition. This one
    rule fixes F1 (`INVOKE_AGENT` reachability, previously blocked by batch mode's bypass of
    `embedHandoffStatusInWait()`) and F6 (PM-surrogate reachability, previously blocked by batch
    mode's short-circuit past the per-role dispatch map for Project Manager/Synthesis/Planner)
    simultaneously, and needs no per-iteration branching logic to decide when to escalate. The
    `POLL_MAX_RESULTS` table from step 5 exists specifically so this invariant is explicit and
    testable (Phase 4: a lib-level test asserts every entry is `1`), not just an emergent property
    of the algorithm.

### Phase 2 — Build Target and Distribution

11. Create `scripts/build-workflows.js` following `build-personas.js`'s CLI conventions
    (`--check`, `--strict`, `--dry-run` as a `--check` alias). Assembly order per spec §6.1:
    AUTO-GENERATED header → `ledger-run.meta.js` → rendered `ROLE_AGENT` (from
    `templates/role-agent.hbs` + `personas/name-mapping.json`) → `src/lib/*.js` in dependency order
    (constants → schemas → select → guards → prompts), `export` keywords stripped → `ledger-run.body.js`.
12. Implement the §6.2 validation rules exactly as specified (parse `meta` as a literal; reject
    `import`/`require(`/`process.`/`fs.`/`Date.now(`/`Math.random(`/argless `new Date()`; reject
    unresolved `{{…}}` markers under `--strict`; require `ROLE_AGENT` to cover every manifest role
    except `Planner`), **with one reclassification per F8**: the `meta.phases[].title` ↔ `phase()`
    call/`phase:` option cross-check is kept but documented in this build script's own help text and
    in `workflows/README.md` as a **house lint** (catches typos and drift between the declared phase
    list and actual usage) rather than as an enforced runtime constraint — the runtime itself does
    not error on an unmatched `phase()` call; it silently creates its own progress group. This
    distinction matters operationally: a `--check` failure here is a documentation/consistency bug
    in the workflow script, not evidence the script would fail at runtime.
    Add one more `--check` rule not in the original spec: reject any of the four corrected-vocabulary
    action strings (`ROUTE_PIPELINE_AGENT`, `SIGNAL_SYNTHESIS`, `CREATE_WORK_PACKAGES`,
    `WAIT_FOR_UPSTREAM_REWORK_LIMIT`) appearing *nowhere* in `constants.js` — a regression guard
    for F2 recurring. Add a second new rule: reject any `POLL_MAX_RESULTS` table entry (step 5)
    whose value is not exactly `1` — a regression guard for F6 recurring ahead of the concurrency
    fast-follow, which must change this deliberately rather than by accident. Add a third new rule
    — a **module assembly-order lint** (per the Plan Architect Reviewer's Decision 3 finding): the
    five `src/lib/*.js` modules are concatenated in a fixed, hand-maintained order
    (`constants → schemas → select → guards → prompts`, step 11) with no build-time check that a
    later module doesn't reference something an earlier module hasn't defined; because top-level
    `const` declarations don't hoist the way function declarations do, a future module inserted in
    the wrong position could fail with an opaque `ReferenceError`, or — worse — succeed silently if
    the bad reference sits inside a function body not called until later, deferring the failure to
    a live run. Close this the same way the F2/F6 guards above do — with a `--check` rule, not a new
    dependency: for each module in the fixed assembly order, statically collect the top-level
    identifiers it references (via a lightweight tokenizer — no new npm dependency) and reject the build if any
    referenced identifier is not defined by that module itself or by a module earlier in the
    assembly order. This is a regression guard for the assembly-order risk the review identified,
    exactly like the F2/F6 rules it sits beside.
13. Add `getClaudeCodeWorkflowsDir()` to `scripts/publish-locations.js` (returns
    `path.join(os.homedir(), '.claude', 'workflows')`, mirroring `getClaudeCodeAgentsDir()`), and
    export it from `getPublishLocations()`'s array so it is automatically covered by any consumer
    that iterates that array (e.g. future `cli.js clean-agents`-style cleanup tooling).
14. Extend `scripts/sync-personas.js`: add `'workflow'` to `VALID_TARGETS`; add a `syncWorkflows()`
    function following the existing `syncFromDir()` helper, copying `dist/claude-workflows/*.js` →
    `getClaudeCodeWorkflowsDir()`; wire `--target workflow` to call `build-workflows.js` (not
    `build-personas.js`) then `syncWorkflows()`. Support an optional `--project <path>` flag (per
    spec §11) to sync into `<repo>/.claude/workflows/` instead of the global directory.
15. Add `node scripts/build-workflows.js --check` to `.githooks/pre-commit` (not to `mcp-server`'s
    `pretest` — see F5) as a new blocking check, positioned alongside the existing
    `build-personas.js --check` call.
16. Add a "Build & sync workflows" entry to `scripts/cli.js`'s interactive menu, delegating to
    `sync-personas.js --target workflow`.

### Phase 3 — `ledger-run` Loop Implementation

17. Write `workflows/src/ledger-run.meta.js` per spec §7.1, with two corrections: (a) `phases[]`
    entries carry a `model`/`effort` field only where that phase actually overrides the session
    default — the spec's literal omitted this on the Poll phase; (b) the Poll phase's override is
    `effort: 'low'`, not `model: 'haiku'` (F8) — this is the literal's source of truth for the
    grep-level AC-05 check (restated below).
18. Write `workflows/src/ledger-run.body.js` implementing the corrected algorithm (spec §7.4 with
    Decision D1's unconditional single-result poll substituted for the spec's flat
    `parallel(POLL_ROLES.map(role => agent(..., { schema: ACTIONS_SCHEMA, model: 'haiku', ... })))`
    call — every poll `agent()` call in this module passes `max_results: 1` per the `POLL_MAX_RESULTS`
    table and `effort: 'low'` instead of a `model` override — and the F2 vocabulary corrections
    applied to classification). Preserve all five embedded rules (R1–R5) from the spec, with R2
    restated per F8: "Personas MUST NOT be given a `model` override in `agent()`; only Poll-phase
    calls may set `effort`. Dispatch and PM-surrogate agents inherit the session model with no
    override of either kind." They were otherwise verified consistent with the workflow
    specification's rework/cancellation semantics (§9.3, §12.5, §16.3c) during this research pass.
    **Per F10, the loop must also:** (a) evaluate the `HANDOFF_DEPTH` guard immediately after the
    poll phase and before classification, terminating with that status rather than falling through
    to stall detection; (b) `log()` the approaching-ceiling warning once per run rather than once
    per iteration, so the operator gets the signal without flooding the transcript; (c) never treat
    an absent `auto_handoff` as evidence that work is finished — per F10 and F11 it may equally mean
    the depth ceiling was reached or the agent registry is unpopulated, both diagnosable conditions
    that must be reported with their actual cause rather than as a generic stall.
19. Implement the PM-surrogate dispatch prompt (Appendix B, minus the trailing-JSON instruction per
    F7) with two additions: explicit handling for `CREATE_WORK_PACKAGES` (`halt: true`, reason: "no
    work packages exist; a human or the Planner/PM must decompose the plan — ledger-run does not
    create work packages") and for `ROUTE_PIPELINE_AGENT` reaching the PM surrogate erroneously
    (should never happen after F2's reclassification — treat as `NO_ACTION` with a diagnostic note
    if it does, rather than crashing).
20. Wire the orchestrator-routing-loop recovery insight
    (`ea8cb364-186f-43e9-a007-33d5f009ff63`) into the PM-surrogate prompt: when
    `REVIEW_REWORK_LIMIT` fires after a code-review FAIL/rework cycle, the surrogate's default
    action (cancel the WP) is usually correct, but the prompt should mention
    `ledger_reopen_cancelled_wp` as the recovery tool of last resort if a human later determines the
    cancellation was a routing artifact rather than a genuine implementation failure — this keeps
    the documented recovery path discoverable from inside the automated loop's own audit trail.

### Phase 4 — Testing

21. Implement `workflows/test/lib/*.test.js` per spec §12.1, with the table-driven
    `filterDispatchable` test seeded from the **corrected** Appendix B cross-reference (F2) so it
    passes immediately and continues to catch future drift. Add a new lib-level test (per F6)
    asserting every entry in `POLL_MAX_RESULTS` equals `1` — the explicit regression guard for the
    poll-strategy fix, independent of any scenario-level behaviour test.
22. Implement `workflows/test/harness/fake-runtime.js` per spec §12.2, with one correction per
    **F7**: the harness must model the StructuredOutput return path (`agent()` returns an
    already-validated object whenever `opts.schema` is set — matching resolved **V6**), not
    text-extracted JSON. It must **not** validate or expect a trailing JSON blob in the agent's
    prose output — the corrected Dispatch/PM-surrogate prompts (step 9) no longer ask for one, and a
    harness that still validated one would silently re-introduce the redundant instruction the
    prompts were just corrected to remove.
23. Implement `workflows/test/ledger-run.test.js` per spec §12.3's scenario table, plus four new
    scenarios covering the corrections in this plan:
    - `ROUTE_PIPELINE_AGENT` from PM dispatches directly to the named `next_agent`, not to PM
    - `CREATE_WORK_PACKAGES` mid-run halts with a clear reason, dispatches nothing
    - **PM-surrogate reachability (F6):** a `REVIEW_REWORK_LIMIT` fixture polled at `max_results: 1`
      for Project Manager is correctly classified as a `PM_ACTIONS` entry and dispatched to the PM
      surrogate — replacing the removed two-tier-poll scenarios from this plan's first pass, which
      no longer apply now that concurrency is fixed at `1` (D-B) and the batch-escalation tier has
      been removed entirely
    - `auto_handoff.agent_name` (decorated string) is never used for role lookup; `next_agent` is
24. Implement build tests per spec §12.4, plus the two F2/F6 regression guards from step 12
    (unclassified-action rejection; non-`1` `POLL_MAX_RESULTS` entry rejection).
25. Document the manual smoke test (spec §12.5) in `workflows/README.md`, explicitly gated on
    WP-001's findings document and V7's branch condition. Budget the smoke run using the **F9**
    CLAUDE.md injection figure (~110k tokens of preamble per iteration across the 8 poll roles,
    before any dispatch call) so the smoke run's expected token consumption is understood going in,
    not discovered as a surprise.

### Phase 5 — Permissions & Safety

This phase is contingent on WP-001's V7 branch condition being resolved as "hooks fire" — see
Phase 0. If V7 fails, this phase's step 26 is replaced by whatever alternative enforcement
mechanism WP-001's findings document identifies; that replacement is scoped when WP-001 completes,
not pre-designed here.

26. Ship `workflows/hooks/deny-git-writes.json` (spec §10) with install instructions in
    `workflows/README.md`. Per **coordinator decision D-D (settled):** this is
    print-instructions-only for v1 — `sync-personas.js --target workflow`'s output prints the hook
    file's location and a one-line merge instruction; it does **not** auto-modify
    `~/.claude/settings.json`. This is consistent with every other sync script in this workspace,
    none of which mutate a user's global settings file. Automating the merge is an explicit,
    accepted fast-follow if the manual step proves to be operator friction in practice (see Out of
    Scope) — it is not deferred-by-omission, it is a deliberate v1 scope line.
27. Document the minimal permission allowlist (`Workflow(ledger-run)`, `mcp__central_pm__*`, the
    persona tool set from `default_cc_tools`) and the managed-settings prerequisite check
    (`/config` → Dynamic workflows) in `workflows/README.md`.

### Phase 6 — Documentation

28. Write `workflows/README.md`: install, run, args (noting `concurrency` is fixed at `1` in v1, not
    a caller-supplied field — see D-B), statuses (including the effectively-dead `BUDGET` status per
    resolved V5, documented as such rather than silently omitted), the resume rule (§9.3) alongside
    the `journal.jsonl` resume-debugging pointer (F8), the Git hook (print-instructions-only per
    D-D), the corrected action-vocabulary table (F2), the CLAUDE.md injection cost figure (F9, for
    token budgeting), and WP-001's findings document verbatim in a "Verified Runtime Behaviour"
    section — this document fully replaces spec §14's table; the spec itself is not the reference
    for verification status once WP-001 completes.
29. Add a "Dynamic Ledger Workflow" entry to the root `README.md`'s "What's Inside" section,
    alongside "The Orchestrator" entry, cross-referencing `workflows/README.md`.
30. Add a `workflows/` row to the root `AGENTS.md`'s sub-project table, the Quick Start Workflow
    step list, and the Manifest Maintenance Rules table (a "Root-Level / Cross-Project" row for
    "Add/modify the workflow action vocabulary" pointing at both this plan's F2 table and
    `mcp-server/docs/agents/workflow-specification/walkthrough.md` Appendix B, so future action
    additions update both sides deliberately).
31. Add a `workflows/docs/agents/project-manifest/` (README, tech-stack, constraints, file-tree,
    api-surface) following the same four/five-document shape as `personas/` and `orchestrator/`,
    per this workspace's own manifest-first convention — a fourth sub-project without a manifest
    would itself violate the workspace's dominant architectural pattern.
32. Regenerate `.context/` (`node scripts/cli.js ctx-generate`) to pick up the new `workflows/`
    sub-project, per the root `AGENTS.md`'s "Restructure workspace" maintenance rule.

## Dependencies

- **Phase 0 = WP-001, and WP-001 gates every other work package in this plan (settled, D-C).** This
  is stricter than "Phase 0 blocks Phase 3" — WP-001's findings document is a precondition for
  Phases 1–6, not just Phase 3, since the resolved/unresolved verification status affects the
  library design (Phase 1), the build validation rules (Phase 2), and the documentation content
  (Phase 6), not only the loop implementation.
- Phase 1 (library modules) blocks Phase 2 (build target needs the modules to concatenate) and
  Phase 3 (loop body imports the library's behaviour, even though the build strips real imports).
- Phase 2 blocks Phase 4 (build tests need `build-workflows.js` to exist; scenario tests execute
  the *built* output per spec §12.2).
- **Phase 5 is additionally contingent on WP-001's V7 branch condition** (see Phase 0) — it cannot
  proceed on the assumption that `PreToolUse` hooks fire until that is confirmed.
- **Phase 1's `schemas.js` (step 6) is contingent on WP-001's V9 captured payload** — writing it
  against spec Appendix A instead would reproduce F12's defect. Where V9's capture is unavailable,
  F3's verified shape is the fallback source of truth, never Appendix A.
- Phase 6 can proceed in parallel with late Phase 4 once Phase 3 is stable.

## Required Components

- **New:** `workflows/` (entire sub-project — README, package.json, src/, templates/, test/, hooks/)
- **New:** `scripts/build-workflows.js`
- **Modified:** `scripts/sync-personas.js` (new `--target workflow` branch, `syncWorkflows()`)
- **Modified:** `scripts/publish-locations.js` (new `getClaudeCodeWorkflowsDir()` export)
- **Modified:** `.githooks/pre-commit` (new blocking `build-workflows.js --check` call)
- **Modified:** `scripts/cli.js` (new menu entry)
- **Modified:** root `README.md`, root `AGENTS.md`
- **New:** `workflows/docs/agents/project-manifest/` (README, tech-stack, constraints, file-tree, api-surface)
- **Not modified:** `mcp-server/src/` — no routing-logic changes, per spec §3 out-of-scope and this
  plan's Rationale (D1 fix stays entirely in the workflow script)
- **Not modified:** any ledger persona source file (`personas/ledger/src/content/*.md`) — spec §7.7
  confirms persona files are not touched for v1; verified no conflicting requirement surfaced during
  research

## Assumptions

- Claude Code Dynamic Workflows (research preview, ≥ v2.1.248) are available in the target
  environment; WP-001 either confirms this or the plan's Phase 3+ work is deferred.
- Four of the eight V1–V8 runtime claims (V1, V2, V5, V6) are now **resolved** from the
  `workflow-authoring` reference (see "Verified Runtime Behaviour") and folded directly into this
  plan's design. The remaining four (V3, V4, V7, V8) are WP-001's scope and must be resolved by a
  human operator or a future agent with an active Dynamic Workflows session before Phase 1 begins
  (D-C: WP-001 gates everything, not just Phase 3).
- `personas/name-mapping.json` continues to be regenerated by `build-personas.js` on every real
  build (verified current behavior) — `build-workflows.js` reads it as a build-time input, never
  duplicates or hand-maintains role slugs.
- **The target environment's `central_pm` registration exposes a populated agent registry** — i.e.
  `--agents-dir` resolves to a directory containing `*.agent.md` files. This is an *assumption*, not
  a verified fact, and is exactly what WP-001 V9 exists to settle (F11). Where it does not hold,
  `INVOKE_AGENT` is unreachable and the loop operates in the documented degraded mode.
- **`auto_handoff_depth` is not near its ceiling when a run starts.** A project that has already
  consumed most of its depth through prior interactive sessions gives `ledger-run` correspondingly
  fewer auto-handoffs, since the counter resets only on synthesis completion (F10). Operators
  resuming a long-lived project should expect this; documented in `workflows/README.md`.
- The `min(16, CPUs - 2)` runtime execution-concurrency cap (F8, confirmed) is a ceiling on how many
  `agent()` calls the runtime can run in parallel at all; it is unrelated to and does not need to be
  reconciled with `ledger-run`'s own fixed `concurrency: 1` dispatch limit (D-B) — the two are
  independent concepts that happen to share a name-adjacent vocabulary ("concurrency"). This plan's
  documentation (Phase 6) must keep the two clearly distinguished to avoid operator confusion.

## Constraints

- No changes to `central_pm` MCP tool routing logic (spec §3, reaffirmed by this plan's Rationale).
- No parallel WP execution with `isolation: 'worktree'` in v1 (spec §9.5) — consistent with the
  workspace-wide "no Git writes by agents" constraint enforced elsewhere via `deny-git-writes.json`.
- **`concurrency` is fixed at `1` for v1 (settled, D-B)** — not a caller-supplied args-table field,
  not clamped to a range. Only one dispatchable action is executed per iteration, chosen by
  `dedupeByWp()`'s priority order across all roles' single-result polls. The
  one-dispatch-per-WP-per-iteration invariant is retained regardless — it remains the mechanism that
  keeps a future concurrency fast-follow safe, even though with `concurrency: 1` only one WP can
  ever receive a dispatch in a given iteration in practice.
- `POLL_ROLES.length` (8) poll calls plus exactly one dispatch call per iteration must stay within
  the 1,000-agent/run and 4,096-item/`parallel()` runtime caps (spec §9.6, confirmed per F8). The
  guard formula in `guards.js` **simplifies** from the spec's
  `min(effectiveMaxIterations, floor(900 / (POLL_ROLES.length + concurrency)))` to
  `min(effectiveMaxIterations, floor(900 / (POLL_ROLES.length + 1)))` — the `+ 1` is the single
  fixed dispatch call per iteration now that `concurrency` is not a variable (D-B's knock-on
  simplification to §9.6).
- Persona source files (`personas/ledger/src/content/*.md`) are not modified for v1 (spec §7.7).
- Poll-phase `agent()` calls set `effort: 'low'`; no call in this module sets `model` (F8) —
  restated from spec §7.4 R2, corrected for the resolved lever choice.
- `workflow()` nesting is one level only (F8, confirmed) — `ledger-run.body.js` must never call
  `workflow()` itself; this constrains the v2 `/ledger-step` design (see Out of Scope) but has no
  effect on v1's implementation since v1 has no companion commands yet.

## Out of Scope

- `/ledger-plan`, `/ledger-pm`, `/ledger-step` companion commands (spec §8, explicitly v2). Note
  the F8 forward-compatibility constraint for whenever this is picked up: `workflow()` nesting is
  one level only, so `/ledger-step` may call `workflow('ledger-run', ...)` from outside, but
  `ledger-run` itself can never call `workflow()` — any v2 design that has `ledger-run` recursively
  invoking a named workflow is a non-starter under the current runtime.
- Plugin packaging of workflows (spec §5, §11).
- Any `central_pm` MCP server routing-logic change, including a hypothetical batch-mode
  `handoff_status` computation that would have been an alternative fix for F1/F6 (see Considered
  Alternatives — explicitly rejected as out of scope, not merely deferred).
- The Planner stage (spec §3) — `ledger-run` assumes work packages already exist.
- Live execution of WP-001's spike itself is a prerequisite investigation performed as part of
  WP-001, not a downstream implementation deliverable of the phases that follow it.
- **Multi-WP concurrency (`concurrency > 1`) — fast-follow, not v1 (settled, D-B).** Deferred, not
  rejected: the two-tier poll design that would have supported it was removed from this plan
  entirely rather than left half-built, so re-introducing concurrency later is a scoped addition to
  `constants.js`'s `POLL_MAX_RESULTS` table and `guards.js`'s cap formula, not a redesign.
- **Automated `deny-git-writes.json` merge into `~/.claude/settings.json` — fast-follow, not v1
  (settled, D-D).** Explicitly accepted as a future addition if the print-instructions approach
  proves to be operator friction in practice.
- **A read-only poll mode in `central_pm` (the architecturally correct fix for F10) — follow-up
  change request, not v1.** Polling should not mutate `auto_handoff_depth`; a `peek`-style parameter
  that returns `handoff_status` without incrementing the counter would remove the depth-consumption
  problem at its root. Out of scope here per spec §3 (no `central_pm` routing changes), and v1
  handles the symptom via the `HANDOFF_DEPTH` guard instead. Recorded as a deliberate follow-up so
  the guard is not mistaken for the permanent solution.
- **Staged-blob-aware `dist/` staleness detection in the pre-commit hook** (see AC-08's revised
  wording) — would require `git show :<path>` comparisons; the working-tree `--check` is sufficient
  for v1 and matches how every other staleness check in this hook already behaves.

## Acceptance Criteria

- AC-01: `node scripts/build-workflows.js --strict` produces `dist/claude-workflows/ledger-run.js`
  passing every §6.2 validation rule plus the F2 regression guard (step 12), using slugs read from
  `personas/name-mapping.json`.
- AC-02: `node scripts/sync-personas.js --target workflow` installs the built file to
  `~/.claude/workflows/` (or `<repo>/.claude/workflows/` with `--project`) and prints the resolved
  path.
- AC-03: All tests under `workflows/test/` pass in CI without network access, including the four
  new correction-scenario tests from Phase 4 step 23.
- AC-04: `filterDispatchable`'s table-driven test (Phase 4 step 21) passes against the **real**
  Appendix B action list as of this plan's writing — including `ROUTE_PIPELINE_AGENT`,
  `CREATE_WORK_PACKAGES`, `SIGNAL_SYNTHESIS`, and `WAIT_FOR_UPSTREAM_REWORK_LIMIT`.
- AC-05: The script never calls `agent()` with a `model` option, and only Poll-phase calls set
  `effort` (restated per F8's lever correction — was a `model`-only grep test in the spec); the
  workflow script contains no hardcoded stage names, pipeline orderings, or fail-routing tables
  outside prompt text and schemas (grep-level test, spec AC5, unchanged).
- AC-06: `INVOKE_AGENT` **handling** is verified in a fake-runtime scenario test (closing F1) — a
  scenario where the single-result poll returns `handoff_status.auto_handoff` must result in a
  dispatch to `handoff_status.next_agent`. **Scope correction (F11):** this criterion validates only
  that the loop consumes the payload correctly. It does **not** establish that the server emits the
  payload in the target environment — a fixture-based test cannot, since the fixture presupposes
  the output of the very gate in question. End-to-end reachability is AC-13's obligation, and the
  two must not be conflated when signing off this criterion.
- AC-06b: PM-surrogate reachability is verified reachable in a fake-runtime scenario test (closing
  F6) — a `PM_ACTIONS` fixture polled for Project Manager at `max_results: 1` must be classified
  and dispatched to the PM surrogate; every entry in `POLL_MAX_RESULTS` is asserted equal to `1` by
  a dedicated lib-level test.
- AC-07: WP-001's five remaining verification items (V3, V4, V7, V8, **V9**) each have a recorded
  pass/fail verdict with supporting evidence in a findings document that fully replaces spec §14's
  table, folded into `workflows/README.md`'s "Verified Runtime Behaviour" section, before any
  implementation work package (Phase 1 onward) is claimed. V7's outcome additionally determines
  whether Phase 5 proceeds as designed or is rescoped, and V9's determines whether the loop can rely
  on auto-handoff at all (see Phase 0's branch conditions).
- AC-08: `.githooks/pre-commit` runs `node scripts/build-workflows.js --check` as a **blocking**
  check, and the commit fails when the built output in `dist/claude-workflows/` does not match the
  current `workflows/src/` sources; `mcp-server`'s `pretest` is unmodified (F5).
  **Revised wording:** the previous phrasing ("blocks a commit that stages `workflows/src/` changes
  without a matching rebuild") described something `--check` cannot implement. `--check` compares
  *working-tree sources* against *built output*; it has no visibility into what is staged, so it
  cannot distinguish "staged source without staged rebuild" from "unstaged local edit." The
  criterion is therefore stated in terms of what the check actually verifies. Staged-vs-built
  divergence detection, if genuinely wanted, requires reading staged blobs via `git show :<path>`
  — explicitly out of scope, and noted here so it is not silently dropped.
- AC-09: Root `README.md` "What's Inside" and root `AGENTS.md` both document `workflows/` per
  Phase 6.
- AC-10: `workflows/docs/agents/project-manifest/` exists with the same document set (README,
  tech-stack, constraints, file-tree, api-surface) as `personas/` and `orchestrator/`.
- AC-11: Neither the Dispatch nor the PM-surrogate prompt templates contain a trailing-JSON
  formatting instruction (closing F7) — a grep-level test over `prompts.js`'s output strings.
- AC-12: `workflows/README.md` documents `concurrency` as fixed at `1` for v1 (not a caller-supplied
  field), the CLAUDE.md injection cost figure (F9), and the `journal.jsonl` resume-debugging pointer
  (F8) — a documentation-completeness check against the file's own headings.
- AC-13: **Auto-handoff is verified reachable end-to-end (closing F11).** WP-001's findings document
  contains a verbatim `ledger_get_next_action` response captured from the target environment in
  which `handoff_status.auto_handoff` is present, together with the resolved `--agents-dir` path and
  the server's startup `Agent registry: N agents discovered` line as corroborating evidence. Where
  V9's branch condition resolves negatively, this criterion is instead satisfied by a documented
  statement in `workflows/README.md` that `INVOKE_AGENT` is unreachable in headless mode and that
  the loop relies solely on per-role next-action polling. Either outcome is acceptable; an
  unexamined assumption is not.
- AC-14: **Depth exhaustion terminates with its own status, not as a stall (closing F10).** A
  fake-runtime scenario in which a poll returns
  `handoff_status.handoff_suppressed_reason: 'depth_limit_reached'` terminates the run with
  `HANDOFF_DEPTH`, never `STALLED`; `guards.js` never writes or resets `auto_handoff_depth`;
  `workflows/README.md` documents the status and its cause. A grep-level check asserts the workflow
  script contains no write to `auto_handoff_depth`.
- AC-15: **`ACTIONS_SCHEMA` accepts the real payload (closing F12).** A schema-validation unit test
  feeds the verbatim WP-001 V9 payload (or, until V9 lands, the shape recorded in F3) through
  `ACTIONS_SCHEMA` and passes; a second case confirms an `auto_handoff` object carrying an unknown
  extra handle field (e.g. a hypothetical future `xx_agent_name`) is still accepted, guarding
  against the `additionalProperties: false` regression F12 identifies.
- AC-16: **Module assembly order is enforced at build time, not only asserted in prose (Design
  Review Decision 3).** `build-workflows.js --check` rejects a fixture module inserted out of order
  (i.e. one that references a top-level identifier defined only by a module later in the
  `constants → schemas → select → guards → prompts` sequence) with a clear diagnostic naming the
  offending identifier and module, and passes on the real, correctly-ordered `src/lib/*.js` set.

## Testing Strategy

Entirely spec-derived, offline, no live model calls in CI (spec §12) — this remains appropriate:
Dynamic Workflows purity rules mean the script's logic is pure functions over JSON in and JSON out,
which is exactly what a fake-runtime harness with scripted transcript fixtures can validate
deterministically. Two corrections from this revision:

1. **Poll simplification (F1/F6/D-B) simplifies the harness, not complicates it.** This plan's
   first pass anticipated a two-tier poll requiring the harness to disambiguate calls on
   `opts.max_results` in addition to `(label, agentType, phase)`. That requirement is now removed —
   every poll call in v1 uses `max_results: 1` unconditionally, so the original three-key call
   matching from spec §12.2 is sufficient again.
2. **StructuredOutput correction (F7).** The harness must model `agent()` returning an
   already-validated object whenever `opts.schema` is set (per resolved V6) and must not validate
   or expect a trailing JSON blob in agent prose output, since the corrected prompts (Phase 1 step
   9) no longer request one.
3. **Known limit of the harness, stated explicitly (F11).** Because the harness supplies poll
   responses as fixtures, it can only ever validate how the loop *consumes* a payload — never
   whether the live server *produces* it. Both `auto_handoff` reachability (F11/V9) and the
   depth-budget behaviour that governs it (F10) are therefore outside what any offline test can
   establish, and are assigned to WP-001's live verification and the smoke run instead. The test
   suite must not be read as evidence for either. This limitation is the reason AC-06 was narrowed
   and AC-13 added in this revision.

## Test Plan

- `workflows/test/lib/select.test.js` — `INVOKE_AGENT` normalisation reads `handoff_status.next_agent`
  and `handoff_status.auto_handoff.prompt`, never `auto_handoff.agent`/`agent_name` — AC-06
- `workflows/test/lib/select.test.js` — `ROUTE_PIPELINE_AGENT` normalises to a dispatch targeting
  `action.next_agent`, distinct from the PM role that emitted it — AC-04
- `workflows/test/lib/constants.test.js` — table-driven cross-reference against the real Appendix B
  action list (hardcoded fixture mirroring `walkthrough.md`), fails if any action is unclassified
  or double-classified — AC-04
- `workflows/test/lib/constants.test.js` — every `POLL_MAX_RESULTS` entry equals `1` — AC-06b
- `workflows/test/lib/constants.test.js` — `POLL_ROLES` equals the manifest role set minus
  `Planner`, so a new manifest role fails loudly instead of going silently unpolled — AC-04
- `workflows/test/lib/schemas.test.js` — `ACTIONS_SCHEMA` accepts the verified `auto_handoff` shape
  nested under `handoff_status` (`agent_name`/`agent_id`/`cc_agent_name`/`vs_agent_name`/
  `da_agent_name`/`prompt`), and still accepts an unknown extra handle field — AC-15
- `workflows/test/lib/schemas.test.js` — `ACTIONS_SCHEMA` preserves `handoff_suppressed_reason`
  rather than stripping it, so the F10 depth signal survives validation — AC-14
- `workflows/test/lib/guards.test.js` — `handoff_suppressed_reason: 'depth_limit_reached'` yields
  `HANDOFF_DEPTH`, never `STALLED` — AC-14
- `workflows/test/lib/select.test.js` — a `cc_agent_name` disagreeing with `ROLE_AGENT[next_agent]`
  emits a drift warning and still dispatches using the `ROLE_AGENT` value — AC-06
- `workflows/test/lib/guards.test.js` — `effectiveMaxIterations` §18.2.1 table plus the simplified
  `min(effectiveMaxIterations, floor(900 / (POLL_ROLES.length + 1)))` cap formula — AC-05 (caps),
  spec §9.6
- `workflows/test/lib/prompts.test.js` — Dispatch and PM-surrogate prompt strings contain no
  trailing-JSON formatting instruction — AC-11
- `workflows/test/harness/fake-runtime.js` — models StructuredOutput return values for
  schema-bearing calls; asserts no text-JSON extraction path exists — AC-06, AC-03
- `workflows/test/ledger-run.test.js` — "PM surrogate reachable: REVIEW_REWORK_LIMIT polled for
  Project Manager at max_results:1 dispatches to the PM surrogate" — AC-06b
- `workflows/test/ledger-run.test.js` — "CREATE_WORK_PACKAGES mid-run halts with clear reason" — AC-04
- `workflows/test/ledger-run.test.js` — "ROUTE_PIPELINE_AGENT dispatches to next_agent, not PM" — AC-04
- `workflows/test/ledger-run.test.js` — "depth-limit poll terminates the run as HANDOFF_DEPTH and
  dispatches nothing further" — AC-14
- `workflows/test/ledger-run.test.js` — "a run whose polls never carry `auto_handoff` still makes
  progress via per-role next-action recommendations" (the F11 degraded mode — proves missing
  auto-handoff costs efficiency, not correctness) — AC-13
- Grep-level check over the built script — no write to `auto_handoff_depth` anywhere — AC-14
- **Manual, not automated:** WP-001 V9's captured live payload — AC-13 (recorded as evidence in the
  findings document; there is deliberately no CI test for this, since it requires a live server and
  a populated agent registry)
- `workflows/test/build/build-workflows.test.js` — one fixture per §6.2 rule plus the F2 and F6
  regression guards (step 12) — AC-01
- `workflows/test/build/build-workflows.test.js` — a fixture module set with one module inserted
  out of dependency order (referencing an identifier only a later module defines) is rejected by
  the assembly-order lint (step 12); the real `src/lib/*.js` order passes — AC-16
- All eleven scenarios from spec §12.3 (unchanged, still required) — AC-03

## Documentation Updates

- `workflows/README.md` — new (Phase 6, step 28); includes WP-001's findings document (replacing
  spec §14), the fixed-`concurrency: 1` note, the CLAUDE.md injection cost figure (F9), and the
  `journal.jsonl` resume-debugging pointer (F8). **Per F10/F11 this file must also document:** the
  `HANDOFF_DEPTH` termination status and its cause; that polling consumes a ledger-persisted
  handoff budget which resets only at synthesis; the agent-registry prerequisite for auto-handoff
  (including the resolved `--agents-dir` path and the startup log line that confirms it); and the
  degraded per-role-polling mode that applies where auto-handoff is unavailable
- `docs/agents/plans/2026-09-11-claude-dynamic-workflow/request.md` — the draft spec; **Appendix A's
  `ACTIONS_SCHEMA` and §14's verification table are both superseded** (F12, AC-07). Rather than edit
  the received draft, add a short note at its head pointing at this plan as authoritative, so a
  future reader of the spec alone cannot implement F12's defective schema
- Root `README.md` — "What's Inside" section gains a "Dynamic Ledger Workflow" entry (step 29)
- Root `AGENTS.md` — sub-project table, Quick Start Workflow step list, Manifest Maintenance Rules
  table (new "Root-Level / Cross-Project" row), Cross-System Dependencies (new row documenting the
  Appendix B ↔ `constants.js` vocabulary coupling from F2) (step 30)
- `workflows/docs/agents/project-manifest/` — new five-document manifest (step 31)
- `.context/` — regenerated (step 32); add `.context/workflows/` entries to the root `AGENTS.md`'s
  Generated Context Docs table (mirroring the `.context/orchestrator/` and `.context/personas/`
  entries already documented there)
- `mcp-server/docs/agents/workflow-specification/README.md` — add `workflows/` as a fourth
  consumer alongside "Implementation" and "Orchestrator" in the Compliance Model's Authority
  Hierarchy table, since `ledger-run.js` must also conform to the specification (it is a third
  implementation of the *client* side of the protocol, not of the routing logic itself, but the
  distinction is worth stating explicitly given how easy F1-style drift is to reintroduce)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **V3/V4/V7/V8 may resolve unfavourably** (V7 is highest-stakes: if `PreToolUse` hooks don't fire for workflow subagents, the entire "no Git writes by agents" guarantee needs a different mechanism) | WP-001 gates every other work package (D-C), not just Phase 3. V7's branch condition is called out explicitly in Phase 0/Phase 5 so a failure produces a scoped redesign of Phase 5 alone, not a rediscovery mid-implementation. |
| **The corrected action vocabulary (F2) drifts again as the Agent Workflow Specification evolves** | AC-04's table-driven test is designed to fail loudly on drift, and the new Cross-System Dependencies row (Documentation Updates) makes the coupling explicit for future spec editors. |
| **The PM-surrogate reachability fix (F6) regresses if a future contributor "optimises" the poll back toward batch calls for token savings** | AC-06b's dedicated lib-level test (`POLL_MAX_RESULTS` entries all equal `1`) and the matching `--check` build rule (Phase 2 step 12) both fail loudly on this specific regression, independent of the scenario-level tests. |
| **`deny-git-writes.json` hook installation could be silently skipped by an operator, defeating the "no Git writes by agents" constraint for this runtime** | Phase 5 makes the hook a printed instruction with explicit manual confirmation, not a silent no-op; document it as a hard prerequisite (not optional) in `workflows/README.md`'s permissions section, consistent with spec §10 and settled decision D-D. If WP-001 finds V7 fails, this mitigation itself is void and Phase 5 is rescoped per its branch condition. |
| **CLAUDE.md injection cost (F9) makes iterations expensive at scale** | Explicitly accepted, not mitigated, per coordinator instruction — precedented by the Orchestrator's equivalent cost. Documented in `workflows/README.md` for token budgeting (AC-12) rather than engineered around. |
| **Poll-driven `auto_handoff_depth` consumption (F10) exhausts the ledger's handoff budget mid-run, presenting as a false stall** | `HANDOFF_DEPTH` guard + `handoff_suppressed_reason` handling (Phase 1 step 8) make the cause explicit; AC-14 tests it. Residual risk accepted for v1: the loop still *consumes* depth faster than an interactive session would, and the counter resets only at synthesis. A server-side read-only poll parameter is the real fix and is recorded in Out of Scope as the follow-up. |
| **`auto_handoff` never fires in the target headless environment (F11), silently reducing the loop to per-role polling** | WP-001 V9 verifies this against a live server before implementation; AC-13 requires either captured evidence or a documented statement that the degraded mode is in effect. The degraded mode is itself tested (Test Plan) so it is a known, exercised path rather than an untested fallback. |
| **Ledger comment spam from repeated depth-suppressed polls (F10)** | Terminating on the first `depth_limit_reached` signal (AC-14) bounds this to roughly one iteration's worth of comments instead of unbounded accumulation. Flagged for the smoke run to confirm empirically. |

Settled by the coordinator and therefore **not** carried forward as risks in this revision: the
fourth-sub-project onboarding cost (D-A — accepted, not tracked); concurrency-related token/design
risk (D-B — resolved by removing the mechanism that carried the risk, not by mitigating it); the
Git-hook auto-merge invasiveness question (D-D — resolved by not auto-merging).

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** Seven work packages with materially distinct concerns (WP-001's gating
  verification spike; pure library code; build tooling; loop implementation; testing; permissions;
  docs), a new sub-project with its own manifest, and 30+ detailed steps warrant the full ledger
  workflow with QA and code-review stages — a single standalone developer session could not safely
  absorb both the vocabulary corrections from live codebase research and the loop implementation
  without a formal review gate in between, and WP-001's documentation-only pipeline in particular
  needs a clean go/no-go signal before any other work package is claimed.

## Settled Decisions & Remaining Open Items

This plan's first pass carried four open questions to the coordinator; all four are now settled and
are recorded here (and inline throughout the document above) rather than left as open questions:

| # | Question | Settled As |
|---|----------|-----------|
| D-A | Should `workflows/` be a separate sub-project or folded into `personas/`+`scripts/`? | **Separate top-level sub-project**, peer to the Orchestrator. Fourth-manifest cost accepted, not tracked as an ongoing risk. |
| D-B | Should v1 support `concurrency > 1`? | **No — fixed at `1`.** Matches the Orchestrator's proven serial-execution precedent; also the cheapest fix for F1/F6. |
| D-C | Should the V1–V8 verification spike be its own gating work package? | **Yes — WP-001**, documentation-only pipeline, blocks every other work package. |
| D-D | Should the Git-write-denial hook auto-merge into `~/.claude/settings.json`? | **No — print-instructions-only for v1.** Auto-merge is an accepted fast-follow if manual proves to be friction. |

No open questions remain from this plan's research and design work. **Two** genuinely open
conditions remain, and neither is a question for the coordinator — both are branch points WP-001
itself resolves, with all outcomes already scoped:

1. **V7 — do `PreToolUse` hooks fire for workflow subagents?** Outcomes: Phase 5 as designed, or a
   rescoped alternative enforcement mechanism determined by WP-001's findings.
2. **V9 (new, from F11) — is `auto_handoff` actually emitted in the target environment?** Outcomes:
   the loop uses auto-handoff as designed, or it runs in the documented degraded mode (per-role
   next-action polling only), which is itself specified and tested rather than left as an untested
   fallback.

No further coordinator input is needed to proceed past WP-001 on either branch.

### Revision Note — 2026-09-11 Planner Verification Pass

This revision was produced by reviewing the plan against the MCP server source rather than for
internal consistency. Of the plan's original findings, **F1, F2, F4, F5, F6, F9 and the manifest
constants were verified exactly correct, including line numbers** — an unusually high rate, and the
reason this pass added findings rather than rewriting the plan. Changes made:

| Change | Nature |
|--------|--------|
| **F10** added — polling mutates `auto_handoff_depth` | Design-blocking; new guard, status, and ACs |
| **F11** added — `auto_handoff` has two gates beyond `max_results` | Design-blocking; new V9, prerequisite, and AC-13 |
| **F12** added — Appendix A's `ACTIONS_SCHEMA` rejects the real payload | Would have become a runtime failure in Phase 1 |
| **F3** corrected — payload also carries `cc_agent_name` | Its `Considered Alternatives` row argued against a straw man; row rewritten, decision unchanged |
| **Spec path** corrected — the cited file never existed | All `§`/Appendix references now resolve |
| **AC-06** narrowed; **AC-08** rewritten; **AC-13/14/15** added | AC-06 claimed more than a fixture test can show; AC-08 described something `--check` cannot do |
| **`POLL_ROLES`** Planner exclusion made explicit + tested | Was correct but undocumented, reading as an omission |
