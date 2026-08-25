# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context

The most recent completed project (`2026-08-21-insights-sidecar-integration`) added the `insights.jsonl` sidecar integration to all insight-gathering personas across ledger and standalone suites. This plan partially reverses that integration for ledger personas, consolidating all ledger observations into the existing MCP observation tools, while preserving the sidecar for standalone agents who have no ledger.

Repository insight `e832d2f4` ("Extract build-time validations into `scripts/lib/`") confirms the existing `insight-validation.js` pattern is the correct structure for build-time checks — and conveniently, it requires no changes for this plan.

## Summary

Eliminate the `insights.jsonl` sidecar from the ledger workflow and route all code-level observations through the existing MCP observation tools (`ledger_add_observation` and `ledger_complete_pipeline` comments). The sidecar's `loc` field — its strongest differentiator — is added to the MCP schema so ledger observations gain location anchoring. The sidecar remains the sole capture mechanism for standalone agents who have no ledger. After this change, the two observation systems have zero overlap: ledger agents use MCP tools exclusively, standalone agents use the JSONL sidecar exclusively.

## Architectural Context

The observation system currently has two parallel channels:

1. **MCP tools** — `ledger_complete_pipeline` comments and `ledger_add_observation` post-hoc additions, stored per-WP per-pipeline in the ledger data model
2. **`insights.jsonl` sidecar** — filesystem JSONL append to a flat file in the plan folder, compiled at report time

The sidecar was added to all insight-gathering personas in `2026-08-21-insights-sidecar-integration`. The sidecar's structured fields (`type`, `priority`, `loc`, `text`) are more expressive than the MCP schema — specifically, the `loc` field for anchoring observations to file paths is absent from `PipelineCommentSchema`. The shared partials `insight-capture.md` and `insight-compilation.md` drive the sidecar protocol, parameterized by per-persona YAML metadata fields (`insight_agent`, `insight_report_target`, `insight_consumer_only`).

Key files:
- Schema: `mcp-server/src/schema/work-package.ts` — `PipelineCommentSchema`
- Observation tool: `mcp-server/src/tools/observations.ts` — `AddObservationSchema`
- Pipeline completion: `mcp-server/src/tools/pipeline.ts` — `CompletePipelineSchema` comments
- Shared partials: `personas/shared/partials/insight-capture.md`, `insight-compilation.md`, `synthesis-operational-protocol.md`
- New shared partial: `personas/shared/partials/mcp-insight-capture.md` — replaces per-persona duplication of the `ledger_add_observation` capture discipline (added per Architectural Review)
- Developer content: `personas/ledger/src/content/3-developer.md` — "Code Insight Observer" section
- Developer protocol: `personas/shared/partials/developer-operational-protocol.md`
- QA protocol: `personas/shared/partials/qa-operational-protocol.md` — "Test Insight Observer" section
- Security Auditor protocol: `personas/shared/partials/security-auditor-operational-protocol.md` — "Security Insight Observer" section
- Reviewer protocol: `personas/shared/partials/reviewer-operational-protocol.md` — "Review Insight Observer" section
- Documentation protocol: `personas/shared/partials/docs-operational-protocol.md` — "Documentation Insight Observer" section

All five operational protocol partials include `{{> insight-capture}}` and contain sidecar-gated steps. All four non-Developer partials already have dedicated observer sections with Scope & Boundaries tables, Observation Categories, and Priority Guidelines — these are valuable content that must be preserved and retargeted.

## Approach / Architecture

1. **Upgrade the MCP observation schema** by adding an optional `loc` field to `PipelineCommentSchema`, `AddObservationSchema`, and the `CompletePipelineSchema` inline comments — closing the expressiveness gap.
2. **Create a shared `mcp-insight-capture.md` partial** (parameterized by a new `insight_pipeline_type` YAML field) that expresses the `ledger_add_observation` call shape, the action-gate rule, and a concrete retry-then-track fallback exactly once — following the same parameterized-partial pattern `insight-capture.md` already establishes for the sidecar, rather than duplicating the block across five partials.
3. **Retarget all five operational protocol partials** from the sidecar to `ledger_add_observation`: replace sink-open steps, retarget capture-gated steps, and replace `{{> insight-capture}}` inclusions with `{{> mcp-insight-capture}}`. Each partial already has a dedicated observer section (Code Insight Observer, Test Insight Observer, Security Insight Observer, Review Insight Observer, Documentation Insight Observer) — preserve and retarget these, upgrading their action anchoring from sidecar appends to incremental `ledger_add_observation` calls with `loc`.
4. **Remove sidecar references from persona content files** (3, 4, 5, 6, 8, 9): strip `{{> insight-compilation}}` inclusions, retarget workflow steps, update Rework Handling sections, remove or replace YAML metadata fields.
5. **Remove sidecar compilation from Synthesis** by eliminating step 5 from `synthesis-operational-protocol.md` and updating the Synthesis workflow steps.
6. **Preserve standalone sidecar** completely — no changes to standalone personas or shared partials.
7. **Update documentation** — reference doc, `AGENTS.md` cross-system dependencies.

## Rationale

- The two-channel system creates redundancy and conflicting guidance for agents. Each observation must be routed to one channel, but the boundary is unclear and unenforced.
- Synthesis mines both channels in separate steps, producing partially overlapping output.
- The sidecar's `loc` field is its only structural advantage over MCP comments. Adding `loc` to the MCP schema eliminates this gap.
- Standalone agents genuinely need the sidecar — they have no MCP tools. Ledger agents do not — they already have `ledger_add_observation` and `ledger_complete_pipeline` comments.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Add `loc` to MCP schema | Optional `loc: z.string().optional()` on `PipelineCommentSchema` | (a) Freeform: encode location in the `note` field text; (b) Structured: add `loc` as an object with `file`, `line`, `function` fields | (a) loses machine-parsability and discoverability; (b) over-engineers — the sidecar's string `loc` has proven sufficient and agents already produce location strings naturally. The flat string matches the existing sidecar schema exactly. |
| Remove sidecar from ledger personas | Strip all sidecar references | (a) Keep both channels; (b) Make sidecar primary, remove MCP tools | (a) perpetuates the redundancy and confusion that motivated this plan; (b) the MCP tools are structurally superior for ledger work (typed, per-WP, queryable by Synthesis) — making the filesystem channel primary would be a regression. |
| Incremental `ledger_add_observation` vs batch `ledger_complete_pipeline` | Incremental `ledger_add_observation` as primary, with batch at completion as secondary | Use only `ledger_complete_pipeline` comments at the end | The project brief's design constraint is explicit: incremental capture parity is a deliverable. Batching observations into `ledger_complete_pipeline` at the end reverts to the end-of-session reconstruction failure mode the sidecar was designed to fix. |
| Capture-discipline text: shared partial vs. duplicated inline blocks | New shared partial `mcp-insight-capture.md`, parameterized by a per-persona `insight_pipeline_type` field, included via `{{> mcp-insight-capture}}` | (a) Hand-write the same ~15-line call-shape/gate/fallback block five times, once per operational protocol partial; (b) Fold the MCP call shape into `insight-capture.md` itself via a conditional branch | (a) is a maintenance liability — any future wording change (e.g. a required field, a stricter fallback rule) needs five synchronized edits with drift risk; (b) couples a standalone-only partial to ledger-specific MCP syntax, violating the plan's own "no changes to shared partial internals" constraint. The shared-partial approach reuses the exact mechanism `insight_agent` substitution already proves works — added per Architectural Review. |

## Pattern Alignment

- Optional schema field addition follows the existing `context` field pattern on `PipelineCommentSchema` — `mcp-server/src/schema/work-package.ts` (L69)
- Persona YAML metadata field removal follows the pattern where fields are optional and validated only when present — `scripts/lib/insight-validation.js`
- Retaining the Code Insight Observer section content while changing the capture mechanism follows the separation between observation *discipline* (what to notice) and observation *channel* (where to record it)
- The shared partials (`insight-capture.md`, `insight-compilation.md`) remain unchanged — they serve standalone personas only, following the clean separation principle from the project brief
- The new `personas/shared/partials/mcp-insight-capture.md` follows the same parameterized-partial pattern `insight-capture.md` already establishes — one partial, a small per-persona variable (`insight_pipeline_type`), included via `{{> mcp-insight-capture}}` — rather than duplicating the capture-discipline text five times (added per Architectural Review)

## Detailed Steps

### Step 1: Add `loc` field to MCP observation schema

1a. Add `loc: z.string().optional()` to `PipelineCommentSchema` in `mcp-server/src/schema/work-package.ts`, as a peer of the existing `context` field.

1b. Add `loc: z.string().optional()` to `AddObservationSchema` in `mcp-server/src/tools/observations.ts`, with description `'File path, module, or component the observation concerns'`.

1c. In `addObservation()` (same file), pass `args.loc` through to the `PipelineComment` object when present: add `...(args.loc ? { loc: args.loc } : {})` to the comment construction.

1d. Add `loc: z.string().optional()` to the inline comment object in `CompletePipelineSchema` in `mcp-server/src/tools/pipeline.ts`, with `.describe()` text mentioning file path or module reference.

1e. Update help content in `mcp-server/src/tools/help-content.ts` — add `loc` to the `ledger_add_observation` parameter list and example JSON.

### Step 2: Add tests for the `loc` field

2a. `mcp-server/tests/tools/observations.test.ts` currently contains only `AddObservationSchema.parse()` schema-validation unit tests — no store or fixture setup exists yet. Add the store-backed test scaffolding needed to exercise `addObservation()` against a real project, mirroring the pattern already established in `mcp-server/tests/tools/multi-store-tool-resolution.test.ts` (`describe('addObservation — resolves to non-default store')`, L461–494): set up a project with a work package, move it to `IN_PROGRESS`, add and start an implementation pipeline, then call `addObservation` with a `loc` field and verify it is persisted to the pipeline comment.

2b. Using the same store-backed setup added in 2a, add a test that calls `addObservation` without `loc` and verifies the comment is persisted without the field (backward compatibility).

2c. In `mcp-server/tests/tools/pipeline.test.ts` — which already has store-backed `completePipeline()` tests with `comments: [...]` arrays (e.g. L1743, L1815, L1918) — verify that `completePipeline` with comments containing `loc` fields persists them correctly.

### Step 3: Create the shared `mcp-insight-capture` partial

3a. Create `personas/shared/partials/mcp-insight-capture.md`, parameterized by a new `insight_pipeline_type` variable, containing exactly once:
- The `ledger_add_observation` tool call shape: `work_package_id`, `pipeline_type: "{{insight_pipeline_type}}"`, `type`, `priority`, `note`, `loc`.
- The action-gate rule, stated generically: call after each observable action defined by your operational protocol's capture step — do not batch observations from multiple actions into a single call.
- A concrete non-blocking fallback: if the call fails, retry once; if it still fails, note the pending observation (type, priority, one-line description) in a short per-session scratch list and ensure every pending item is folded into your `ledger_complete_pipeline` comments at pipeline completion. Do not rely on unaided end-of-session recall for failed calls.

3b. Add `insight_pipeline_type: implementation` to `personas/ledger/src/meta/3-developer.yaml`, replacing the existing `insight_agent` and `insight_report_target` fields (L40–41).

3c. Add `insight_pipeline_type: qa` to `personas/ledger/src/meta/4-qa.yaml`, replacing `insight_agent` and `insight_report_target` (L36–37).

3d. Add `insight_pipeline_type: security-audit` to `personas/ledger/src/meta/5-security-auditor.yaml`, replacing `insight_agent` and `insight_report_target` (L34–35).

3e. Add `insight_pipeline_type: code-review` to `personas/ledger/src/meta/6-reviewer.yaml`, replacing `insight_agent` and `insight_report_target` (L38–39).

3f. Add `insight_pipeline_type: documentation` to `personas/ledger/src/meta/8-documentation.yaml`, replacing `insight_agent` and `insight_report_target` (L39–40).

### Step 4: Retarget the Developer's operational protocol

4a. In `personas/shared/partials/developer-operational-protocol.md`:
- **Step 1**: Remove "Open the Insight Sink" step entirely. Fold its purpose ("before doing anything else") into step 2 (Contextual Analysis) since the sink setup is no longer needed. Renumber remaining steps.
- **In-sentence cross-references**: elsewhere in the partial the phrase "Immediately after each step-4 edit" becomes "step-3 edit" post-renumber — update it alongside the step renumbering above so no stale step number remains.
- **Step 5** (now step 4 after renumber): Replace "append any observations that edit surfaced to `insights.jsonl`" with "Call `ledger_add_observation` for each observation, using `loc` for the file path, `type` and `priority` per the Code Insight Observer categories." Preserve the repeat-loop structure ("Repeat steps 3–4 until the implementation is complete") and the trigger discipline ("The completed edit is your trigger").
- **Step 7** (now step 6): Replace "Compile the observations you gathered while working" sidecar reference with a reference to the Code Insight Observer section's reporting rules — observations are already in the ledger via incremental `ledger_add_observation` calls.
- **Remove** `{{> insight-capture}}` — not present in this partial (it's in the content file), but verify no sidecar references remain.

### Step 5: Retarget the Developer's Code Insight Observer section

5a. In `personas/ledger/src/content/3-developer.md`:
- **Remove** `{{> insight-capture}}` (L108) and **replace it with `{{> mcp-insight-capture}}`** — the incremental capture discipline (call shape, action-gate rule, fallback) now lives once in the shared partial (Step 3) instead of being written inline per persona.
- **Update "Observation Reporting Rules"** (L110–120): Replace rule 1 ("Compile your `ledger_complete_pipeline` comments from `insights.jsonl`") with: "Observations recorded via `ledger_add_observation` during implementation are already in the ledger. Your `ledger_complete_pipeline` comments should include any final-pass observations and the confirmation entry if nothing was found."
- **Remove** `{{> insight-compilation}}` (L143).
- **Rework Handling** (step 6): Remove "Open the sink with a fresh `session-start` marker line at the top of the rework session, then append after each file you edit." Replace with: "Continue calling `ledger_add_observation` incrementally after each file you edit during rework."

5b. **Workflow step 4**: Replace "Append observations to `insights.jsonl` incrementally during step 3 (Incremental Implementation)" with "Call `ledger_add_observation` incrementally during implementation (see Operational Protocol steps 3–4)."

### Step 6: Retarget QA operational protocol and content

6a. In `personas/shared/partials/qa-operational-protocol.md`:
- **Step 1**: Remove "Open the Insight Sink" step entirely. Renumber remaining steps.
- **In-sentence cross-references**: elsewhere in the partial the phrase "Immediately after each of steps 2–5 completes" becomes "steps 1–4" post-renumber — update it alongside the step renumbering above so no stale step numbers remain.
- **Step 6** (now step 5 after renumber): Replace "append the observations that layer surfaced to `insights.jsonl`" with "Call `ledger_add_observation` for each observation, using `loc` for the file path, `type` and `priority` per the Test Insight Observer categories." Preserve the trigger discipline ("The finished test run is your trigger; do not batch all four layers into one pass at the end").
- **Test Insight Observer section**: Remove `{{> insight-capture}}` and replace it with `{{> mcp-insight-capture}}` (call shape, action-gate rule, and fallback now live once in the shared partial from Step 3).

6b. In `personas/ledger/src/content/4-qa.md`:
- **Remove** `{{> insight-compilation}}` (L80).
- **Workflow step 4**: Replace "Append observations to `insights.jsonl` incrementally after each verification layer" with "Call `ledger_add_observation` incrementally after each verification layer (see Operational Protocol step 5)."
- **Rework Handling** (step 5): Remove "Open the sink with a fresh `session-start` marker line at the top of the rework session, then append after each re-verification you run." Replace with: "Continue calling `ledger_add_observation` incrementally after each re-verification during rework."

### Step 7: Retarget Security Auditor operational protocol and content

7a. In `personas/shared/partials/security-auditor-operational-protocol.md`:
- **Step 1**: Remove "Open the Insight Sink" step entirely. Renumber remaining steps.
- **In-sentence cross-references**: elsewhere in the partial the phrase "Immediately after each completed audit area from steps 3 and 4" becomes "steps 2 and 3" post-renumber — update it alongside the step renumbering above so no stale step numbers remain.
- **Step 3** (now step 2 after renumber): Remove the inline reference "append any non-blocking observations it surfaced to `insights.jsonl` (step 5)" — replace with "call `ledger_add_observation` for non-blocking observations after each completed category."
- **Step 5** (now step 4 after renumber): Replace "append any non-blocking observations ... to `insights.jsonl`" with "Call `ledger_add_observation` for each non-blocking observation, using `loc` for the file path, `type` and `priority` per the Security Insight Observer categories." Preserve the trigger discipline.
- **Security Insight Observer section**: Update the preamble to reference `ledger_add_observation` instead of `insights.jsonl` for routing non-blocking observations. Remove `{{> insight-capture}}` and replace it with `{{> mcp-insight-capture}}` (call shape, action-gate rule, and fallback now live once in the shared partial from Step 3).
  - Preserve the existing verdict-affecting findings rule: findings that affect PASS/FAIL go exclusively through `ledger_complete_pipeline` comments, never through `ledger_add_observation`.

7b. In `personas/ledger/src/content/5-security-auditor.md`:
- **Remove** `{{> insight-compilation}}` (L67).
- **Workflow step 4**: Replace "Append non-blocking observations to `insights.jsonl` after each completed audit area" with "Call `ledger_add_observation` for non-blocking observations after each completed audit area (see Operational Protocol step 4)."

### Step 8: Retarget Reviewer operational protocol and content

8a. In `personas/shared/partials/reviewer-operational-protocol.md`:
- **Step 1**: Remove "Open the Insight Sink" step entirely. Renumber remaining steps.
- **Step 3** (now step 2 after renumber, "The Deep Dive"): Replace "append every Gold Nugget and out-of-scope pattern that file surfaced to `insights.jsonl`" with "call `ledger_add_observation` for each Gold Nugget and out-of-scope pattern, using `loc` for the file path." Preserve the trigger discipline ("The finished file is your trigger").
- **Step 4** (now step 3 after renumber): Replace "Compile Gold Nuggets and out-of-scope patterns from `insights.jsonl`" with "Review the Gold Nuggets and out-of-scope patterns recorded via `ledger_add_observation`." Preserve the `ledger_add_project_comment` instruction. Remove the sentence about blocking findings and `reviewer-applied-fix` not being routed through the sink (no longer applicable).
- **Review Insight Observer section**: Update the preamble to reference `ledger_add_observation` instead of `insights.jsonl`. Remove `{{> insight-capture}}` and replace it with `{{> mcp-insight-capture}}` (call shape, action-gate rule, and fallback now live once in the shared partial from Step 3).
  - Preserve the existing verdict-affecting findings rule: blocking findings, `reviewer-applied-fix` records, and `documentation-forward` items go exclusively through `ledger_complete_pipeline` comments.

8b. In `personas/ledger/src/content/6-reviewer.md`:
- **Remove** `{{> insight-compilation}}` (L85).
- **Workflow step 6**: Replace "Compile Gold Nuggets and out-of-scope observations from `insights.jsonl` into your pipeline comments" with "Include Gold Nuggets and out-of-scope observations in your `ledger_complete_pipeline` comments. If you identified architectural patterns spanning multiple WPs, call `ledger_add_project_comment` to record them at the project level." (The `ledger_add_project_comment` instruction is already in the second sentence — consolidate.)

### Step 9: Retarget Documentation operational protocol and content

9a. In `personas/shared/partials/docs-operational-protocol.md`:
- **Step 1**: Remove "Open the Insight Sink" step entirely. Renumber remaining steps.
- **In-sentence cross-references**: elsewhere in the partial the phrase "Immediately after each step-5 document is saved" becomes "step-4" post-renumber — update it alongside the step renumbering above so no stale step number remains.
- **Step 6** (now step 5 after renumber): Replace "append any gap or staleness you noticed in adjacent documentation to `insights.jsonl`" with "Call `ledger_add_observation` for each gap or staleness, using `loc` for the doc file path, `type` and `priority` per the Documentation Insight Observer categories." Preserve the repeat-loop structure ("Repeat steps 4–5 until the documentation pass is complete") and the trigger discipline ("The saved document is your trigger").
- **Documentation Insight Observer section**: Remove `{{> insight-capture}}` and replace it with `{{> mcp-insight-capture}}` (call shape, action-gate rule, and fallback now live once in the shared partial from Step 3).

9b. In `personas/ledger/src/content/8-documentation.md`:
- **Remove** `{{> insight-compilation}}` (L76).
- **Workflow step 4**: Replace "Append documentation observations to `insights.jsonl` after each document updated" with "Call `ledger_add_observation` for documentation observations after each document updated (see Operational Protocol step 5)."
- **Rework Handling** (step 5): Remove "Open the sink with a fresh `session-start` marker line at the top of the rework session, then append after each document you update." Replace with: "Continue calling `ledger_add_observation` incrementally after each document you update during rework."

### Step 10: Remove sidecar compilation from Synthesis (9)

10a. In `personas/shared/partials/synthesis-operational-protocol.md`:
- **Remove step 5** ("Code Insights Compilation: Read `insights.jsonl` from the plan folder...") entirely.
- **Update step 2** note: remove "Note: This is distinct from the `insights.jsonl` sidecar compiled in step 5." — no longer applicable.
- Renumber remaining steps if needed (step 4 "Plan Status" becomes the final step since step 5 is removed).

10b. In `personas/ledger/src/content/9-synthesis.md`:
- **Remove** `{{> insight-compilation}}` (L46).
- **Workflow step 6**: Remove "Compile the Code Insights section from `insights.jsonl` (see Operational Protocol step 5)." Replace with "Generate the report from the ledger data gathered in steps 3–5."
- **Workflow step 5**: The "Aggregate metrics and insights" text is fine — it already refers to the ledger.

10c. In `personas/ledger/src/meta/9-synthesis.yaml`, remove `insight_agent`, `insight_report_target`, and `insight_consumer_only` (L7–9) entirely — Synthesis is a consumer only and has no equivalent `mcp-insight-capture` partial to retarget to.

### Step 11: Update `ledger_add_observation` tool description in YAML, extend it to QA/Security Auditor/Reviewer/Documentation, and update the Allocation Matrix

11a. In `personas/ledger/src/meta/3-developer.yaml`, update the `ledger_add_observation` MCP tool purpose to mention the `loc` field: `"Add a Code Insight observation to a pipeline (including the loc field for file paths). Use incrementally during work, not just after pipeline completion."`

11b. Add a `- tool: ledger_add_observation` entry to the `mcp_tools` list in `personas/ledger/src/meta/4-qa.yaml`, positioned immediately after the existing `ledger_add_project_comment` entry (mirroring the Developer's list ordering), with purpose: `"Add a Test Insight observation to a pipeline (including the loc field for file paths). Use incrementally after each verification layer, not just after pipeline completion."`

11c. Add the same entry to `personas/ledger/src/meta/5-security-auditor.yaml`, with purpose: `"Add a Security Insight observation to a pipeline (including the loc field for file paths). Use incrementally after each completed audit category, not just after pipeline completion. Non-blocking observations only — verdict-affecting findings go through ledger_complete_pipeline comments."`

11d. Add the same entry to `personas/ledger/src/meta/6-reviewer.yaml`, with purpose: `"Add a Review Insight observation (Gold Nugget or out-of-scope pattern) to a pipeline (including the loc field for file paths). Use incrementally as each file is reviewed, not just after pipeline completion. Non-blocking observations only — blocking findings go through ledger_complete_pipeline comments."`

11e. Add the same entry to `personas/ledger/src/meta/8-documentation.yaml`, with purpose: `"Add a Documentation Insight observation to a pipeline (including the loc field for the doc path). Use incrementally after each document updated, not just after pipeline completion."`

11f. In `personas/docs/agents/project-manifest/api-surface.md`, update the MCP Tool Allocation Matrix: change the four `—` cells in the `ledger_add_observation` row (4-QA, 5-SecAudit, 6-Rev, 8-Doc columns) to `**✓**`. Update the accompanying rationale prose so it stays consistent with the matrix: remove "(unique to Developer)" from persona 3's sentence, and replace persona 4's "Does not need `ledger_add_observation` because QA records all findings as pipeline comments in `ledger_complete_pipeline`." with a sentence stating QA now has the tool for the Test Insight Observer role, called incrementally after each verification layer, with final-pass findings still recorded in `ledger_complete_pipeline` comments. Persona 5's and 6's rationale ("Same tool set as QA" / "Same tool set as Security Auditor") needs no further edit since they reference the referenced persona's tool set by inheritance.

### Step 12: Update reference documentation

12a. In `docs/references/insights-sidecar-reference.md`:
- Update the header `Applies to:` line to list only standalone agents: "Developer (standalone), Web GUI Specialist (standalone) agents".
- Add a note at the top stating that the sidecar is standalone-only; ledger agents use `ledger_add_observation` and `ledger_complete_pipeline` comments.
- Update the integration table to remove ledger persona rows (Developer ledger, QA, Reviewer, Security Auditor, Documentation, Synthesis ledger).
- Update the Consumption section: remove "Synthesis consumers" from the consumer list; standalone agents compile their own entries.

12b. In `personas/docs/agents/project-manifest/api-surface.md`:
- Retarget the Partials Inventory "Used By" column for `insight-capture.md` and `insight-compilation.md` to standalone personas only (Developer, Web GUI Specialist).
- Add a new inventory row for `mcp-insight-capture.md`, listing its ledger consumers (personas 3, 4, 5, 6, 8) and its `insight_pipeline_type` parameter.
- Add an `insight_pipeline_type` entry to the metadata field table, noting it is mutually exclusive with `insight_agent`/`insight_report_target` by suite (ledger uses `insight_pipeline_type`; standalone continues to use `insight_agent`/`insight_report_target`).

12c. In `personas/docs/agents/project-manifest/constraints.md`, scope rules 35, 36, and 38 (the `insight_agent`/`insight_report_target` pairing rule and the capture-partial/action-gate requirement) to standalone personas only — note that ledger personas now use `insight_pipeline_type` and `mcp-insight-capture.md` instead.

### Step 13: Update `AGENTS.md` cross-system dependencies

13a. In root `AGENTS.md`, update the `insight_agent / role coupling` row:
- Narrow scope to standalone personas only: "Per-persona YAML `insight_agent` field (standalone: `personas/standalone/src/meta/*.yaml`)"
- Remove ledger persona references from the "Must Stay In Sync With" column.
- Note that ledger personas no longer have `insight_agent` fields (they use `ledger_add_observation` directly).

### Step 14: Rebuild personas and verify

14a. Run `node scripts/build-personas.js` to rebuild all persona output files.
14b. Run `node scripts/build-personas.js --check` to verify output matches.
14c. Run the MCP server test suite to verify schema and observation tool changes.

## Dependencies

- Steps 1–2 (MCP schema changes) must complete before step 3 and steps 4–10 (persona retargeting references the `loc` field).
- Step 3 (shared `mcp-insight-capture` partial + `insight_pipeline_type` YAML field) must complete before steps 5, 6, 7, 8, 9 (each includes the partial via `{{> mcp-insight-capture}}`) — the Developer's operational protocol (step 4) does not include the partial itself; its swap happens in the content-file step (step 5) instead.
- Steps 3–10 (persona content and metadata changes) and step 11 (tool description update) are otherwise independent of each other.
- Step 14 (rebuild and verify) depends on all prior steps.

## Required Components

- `mcp-server/src/schema/work-package.ts` — `PipelineCommentSchema` modification
- `mcp-server/src/tools/observations.ts` — `AddObservationSchema` and `addObservation()` modification
- `mcp-server/src/tools/pipeline.ts` — `CompletePipelineSchema` comments modification
- `mcp-server/src/tools/help-content.ts` — help text update
- `mcp-server/tests/tools/observations.test.ts` — new tests
- `personas/shared/partials/mcp-insight-capture.md` — **new** shared partial for the `ledger_add_observation` call shape, action-gate rule, and fallback (replaces per-persona duplication)
- `personas/shared/partials/developer-operational-protocol.md` — retarget from sidecar to MCP
- `personas/shared/partials/qa-operational-protocol.md` — retarget from sidecar to MCP
- `personas/shared/partials/security-auditor-operational-protocol.md` — retarget from sidecar to MCP
- `personas/shared/partials/reviewer-operational-protocol.md` — retarget from sidecar to MCP
- `personas/shared/partials/docs-operational-protocol.md` — retarget from sidecar to MCP
- `personas/ledger/src/content/3-developer.md` — retarget Code Insight Observer
- `personas/ledger/src/content/4-qa.md` — remove sidecar references, retarget workflow
- `personas/ledger/src/content/5-security-auditor.md` — remove sidecar references, retarget workflow
- `personas/ledger/src/content/6-reviewer.md` — remove sidecar references, retarget workflow
- `personas/ledger/src/content/8-documentation.md` — remove sidecar references, retarget workflow
- `personas/ledger/src/content/9-synthesis.md` — remove sidecar compilation
- `personas/shared/partials/synthesis-operational-protocol.md` — remove step 5
- `personas/ledger/src/meta/3-developer.yaml`, `4-qa.yaml`, `5-security-auditor.yaml`, `6-reviewer.yaml`, `8-documentation.yaml` — replace `insight_agent`/`insight_report_target` with `insight_pipeline_type`; add `ledger_add_observation` to the `mcp_tools` list for `4-qa.yaml`, `5-security-auditor.yaml`, `6-reviewer.yaml`, and `8-documentation.yaml` (steps 11b–11e)
- `personas/ledger/src/meta/9-synthesis.yaml` — remove `insight_agent`, `insight_report_target`, `insight_consumer_only` entirely
- `docs/references/insights-sidecar-reference.md` — scope to standalone
- `personas/docs/agents/project-manifest/api-surface.md` — retarget partials inventory and metadata field table; update the MCP Tool Allocation Matrix `ledger_add_observation` row and accompanying rationale prose (step 11f)
- `personas/docs/agents/project-manifest/constraints.md` — scope insight-related rules to standalone personas
- `AGENTS.md` — update cross-system dependency row

## Assumptions

- The `PipelineCommentSchema` `.passthrough()` behavior on the `CompletePipelineSchema` inline comments means existing callers passing `loc` fields will not break before the schema is updated — the field is silently accepted but not persisted to the typed object. After this plan, it will be typed and persisted.
- Standalone personas are not affected. The shared partials (`insight-capture.md`, `insight-compilation.md`) continue to serve standalone personas unchanged.
- The `developer-operational-protocol.md` shared partial is only consumed by the ledger Developer (3) — verified by grep. Modifying it does not affect standalone.
- The `qa-operational-protocol.md`, `security-auditor-operational-protocol.md`, `reviewer-operational-protocol.md`, and `docs-operational-protocol.md` partials are consumed only by the corresponding ledger personas — standalone personas have their own inline protocols. Modifying these partials does not affect standalone.
- The build system's per-persona custom-variable substitution mechanism (already used for `insight_agent` in `insight-capture.md`) supports the new `insight_pipeline_type` variable in `mcp-insight-capture.md` without any changes to `@mistralys/persona-builder` itself — confirmed by `metadata-reference.md` (Tier 5 — Optional / Convention Fields) (added per Architectural Review).

## Constraints

- **Incremental capture parity is a deliverable.** The retargeted ledger personas must call `ledger_add_observation` incrementally after each observable action, not batch observations into `ledger_complete_pipeline` comments at the end. The action-gate discipline from the sidecar protocol must carry over.
- **The non-blocking fallback must be concrete, not an implicit memory obligation.** A failed `ledger_add_observation` call is retried once; if it still fails, the observation is noted in a short per-session scratch list and folded into `ledger_complete_pipeline` comments at completion — this mechanic is written once in `mcp-insight-capture.md` (added per Architectural Review; see Decision 3 in `design-review.md`).
- **Capture-discipline text lives in one shared partial, not five duplicated blocks.** `mcp-insight-capture.md` is the single source for the `ledger_add_observation` call shape, action-gate rule, and fallback; the five retargeted operational protocol partials include it rather than repeating it (added per Architectural Review; see Decision 2 in `design-review.md`).
- **No changes to shared partial internals.** `insight-capture.md` and `insight-compilation.md` remain stable for standalone use.
- **No changes to standalone persona behavior.** The sidecar protocol in standalone Developer and Web GUI Specialist is untouched.
- **Build-time validation must continue passing.** Replacing `insight_agent`/`insight_report_target` with `insight_pipeline_type` on five ledger YAML files, and removing all three fields from Synthesis's YAML, is validated as safe — `insight-validation.js` only checks the `insight_agent`/`insight_report_target` pair and is not aware of `insight_pipeline_type`.

## Out of Scope

- Changes to the knowledge store (`ledger_add_insight` / `ledger_search_insights`).
- Changes to standalone persona behavior or shared partial internals.
- Changes to the `insights.jsonl` entry format.
- Adding a `loc` field to `ledger_add_project_comment` (project-level comments are not observation-scoped).
- GUI display of the `loc` field in pipeline comments (future enhancement).

## Acceptance Criteria

- AC-01: `PipelineCommentSchema` includes an optional `loc: string` field, persisted and round-tripped through `ledger_add_observation` and `ledger_complete_pipeline`.
- AC-02: `AddObservationSchema` accepts an optional `loc` parameter and passes it through to the stored comment.
- AC-03: `CompletePipelineSchema` inline comments accept an optional `loc` field.
- AC-04: All six ledger personas (3, 4, 5, 6, 8, 9) have zero references to `insights.jsonl`, `insight-capture`, or `insight-compilation` partials.
- AC-05: All five observer sections (Code Insight, Test Insight, Security Insight, Review Insight, Documentation Insight) are preserved with their observation categories, type vocabularies, scope boundaries, and priority guidelines — retargeted to `ledger_add_observation` with `loc`.
- AC-06: All five operational protocol partials gate `ledger_add_observation` calls on observable actions (file edit, verification layer, audit category, reviewed file, saved document) with explicit trigger discipline.
- AC-07: `synthesis-operational-protocol.md` has no step 5 (Code Insights Compilation) and step 2 has no sidecar distinction note.
- AC-08: All five operational protocol partials (`developer-`, `qa-`, `security-auditor-`, `reviewer-`, `docs-operational-protocol.md`) reference `ledger_add_observation` instead of `insights.jsonl` in their steps. Four of them (`qa-`, `security-auditor-`, `reviewer-`, `docs-operational-protocol.md`) include `{{> mcp-insight-capture}}` replacing `{{> insight-capture}}` in their observer sections; the Developer's swap occurs instead in its content file (`personas/ledger/src/content/3-developer.md`, step 5), since `developer-operational-protocol.md` never included `{{> insight-capture}}`.
- AC-09: All six ledger persona YAML metadata files have no `insight_agent`, `insight_report_target`, or `insight_consumer_only` fields; personas 3, 4, 5, 6, and 8 instead declare `insight_pipeline_type` matching their respective pipeline type.
- AC-10: `insights-sidecar-reference.md` scopes the sidecar to standalone agents only.
- AC-11: Root `AGENTS.md` cross-system dependency row for `insight_agent / role coupling` scopes to standalone personas only.
- AC-12: Standalone personas (Developer, Web GUI Specialist) retain all sidecar integration unchanged.
- AC-13: Persona build (`node scripts/build-personas.js`) completes without errors.
- AC-14: MCP server test suite passes with the new `loc` field.
- AC-15: `personas/shared/partials/mcp-insight-capture.md` exists as a single shared partial, parameterized by `insight_pipeline_type`, containing the `ledger_add_observation` call shape, the action-gate rule, and a concrete retry-then-track fallback exactly once; all five retargeted operational protocol partials include it via `{{> mcp-insight-capture}}`.
- AC-16: `personas/ledger/src/meta/4-qa.yaml`, `5-security-auditor.yaml`, `6-reviewer.yaml`, and `8-documentation.yaml` each declare a `ledger_add_observation` entry in `mcp_tools`, and the MCP Tool Allocation Matrix in `personas/docs/agents/project-manifest/api-surface.md` shows `**✓**` for `ledger_add_observation` on all four of those personas, with rationale prose consistent with the matrix.

## Testing Strategy

The MCP server changes (steps 1–2) require unit tests for the new `loc` field on both `ledger_add_observation` and `ledger_complete_pipeline`. The persona changes (steps 3–12) are verified by successful persona build (`--check` mode) and manual review of generated output. The overall integration is verified by running the full MCP server test suite.

## Test Plan

- `mcp-server/tests/tools/observations.test.ts` — add store-backed fixture setup (mirroring `multi-store-tool-resolution.test.ts`), then a new test: `addObservation` with `loc` field persists it to the pipeline comment — covers AC-01, AC-02
- `mcp-server/tests/tools/observations.test.ts` — new test: `addObservation` without `loc` field produces comment without `loc` (backward compat) — covers AC-02
- `mcp-server/tests/tools/pipeline.test.ts` — new test: `completePipeline` with comments containing `loc` field persists them — covers AC-01, AC-03
- `node scripts/build-personas.js --check` — verifies all persona output is consistent after metadata and content changes — covers AC-04, AC-09, AC-13, AC-15, AC-16
- Full MCP server test suite (`npm test` in `mcp-server/`) — regression pass — covers AC-14

## Documentation Updates

Per `AGENTS.md` manifest maintenance rules:

- `mcp-server/docs/agents/project-manifest/api-surface.md` — update `ledger_add_observation` tool signature to include `loc` parameter; update `PipelineCommentSchema` to include `loc` field; update `ledger_complete_pipeline` comments description to include `loc`
- `personas/docs/agents/project-manifest/api-surface.md` — retarget the Partials Inventory "Used By" column for `insight-capture.md`/`insight-compilation.md` to standalone-only, add a `mcp-insight-capture.md` inventory row, add `insight_pipeline_type` to the metadata field table (step 12b); update the MCP Tool Allocation Matrix `ledger_add_observation` row (4-QA, 5-SecAudit, 6-Rev, 8-Doc → `**✓**`) and accompanying rationale prose (step 11f)
- `personas/docs/agents/project-manifest/constraints.md` — scope rules 35, 36, and 38 (`insight_agent`/`insight_report_target` pairing and capture-partial/action-gate requirements) to standalone personas only (step 12c)
- `docs/references/insights-sidecar-reference.md` — scope to standalone agents (step 12)
- Root `AGENTS.md` — update `insight_agent / role coupling` cross-system dependency row (step 13)
- Persona changelogs — each modified persona YAML should get a changelog entry noting the removal of sidecar integration
- `.context/` — regenerate after all doc changes via `node scripts/cli.js ctx-generate`

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | GUI display of `loc` field in pipeline comments | Project brief design direction | Focused on data model and agent workflow; GUI rendering is a separate enhancement | Revisit when the GUI pipeline-comments view is next updated |
| 2 | Cross-pipeline deduplication in Synthesis step 2 | Project brief risks section | Synthesis already mines all pipelines; explicit deduplication rules can be added if corroboration gaps are observed in practice | Monitor synthesis output quality over the next few projects |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Cross-agent corroboration loss.** Observations distributed across per-WP pipelines are harder to correlate than a single JSONL file. | Synthesis step 2 (Ledger Insight Mining) already mines all pipelines across all WPs. The `loc` field enables pattern matching by file path. Monitor synthesis output quality after the change. |
| **Incremental capture regression.** Agents may batch observations into `ledger_complete_pipeline` instead of calling `ledger_add_observation` incrementally, or may lose track of a failed call across a long session. | All five operational protocol partials explicitly gate `ledger_add_observation` on observable actions, via the shared `mcp-insight-capture.md` partial. Each persona names its own trigger (completed file edit, finished verification layer, completed OWASP category, reviewed file, saved document) — the same discipline the sidecar protocol established. The fallback is concrete rather than an implicit memory obligation: retry once on failure, then track the pending observation in a short per-session scratch list and fold it into `ledger_complete_pipeline` comments at completion (added per Architectural Review — Decision 3). |
| **Schema backward compatibility.** Existing pipeline comments lack `loc`; adding the field to the schema could break reads. | The field is `.optional()` — existing comments without `loc` validate correctly. No migration needed. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Cross-module changes spanning MCP server (TypeScript) and personas (YAML/Markdown) across 15+ files, touching schema, tools, tests, persona content, metadata, shared partials, and documentation — benefits from formal QA and review stages.
