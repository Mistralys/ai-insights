# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.9.1
- Architectural Reviews: 1 — Plan Architect Reviewer v2.3.1

## Prior Project Context

The repository's **long-term primary goal** is iterative persona improvement under a "Personas First" philosophy, driven by "experience working with the project and continuous creative research". AX Feedback is the instrument that turns that experience into recorded signal, so this rollout is a direct expression of the declared strategy rather than an incidental feature. The **mid-term goal** (raising awareness that persona design is critical to reliable agentic work) is served by the Design Guide and manifest updates in Stage 5. The **short-term goal** (minimal daily-usage friction) is the reason this plan keeps AX Feedback checkpoint-slotted: adding a continuous capture sink to 38 personas would impose a per-session cost on every invocation.

Two immediately prior projects set the architectural precedent:

- **`2026-08-24-insight-channel-consolidation`** (COMPLETE, 14 WPs, 0 rework) established the per-suite channel split this plan follows: ledger agents persist through MCP tools, standalone agents through the JSONL sidecar. It also created `mcp-insight-capture.md` as a parameterised shared partial — the shape the `ax-feedback` partial should mirror.
- **`2026-08-21-insights-sidecar-integration`** (COMPLETE, 14 WPs, 0 rework) is the precedent for both a staged multi-persona rollout and build-time metadata validation.

One insight directly governs implementation: *"Extract build-time validations into `scripts/lib/` for fixture-based testability"* — the `ax_feedback` field validation must be a standalone `scripts/lib/` module with fixture tests in `scripts/tests/`, never inlined in `build-personas.js` and never via the plugin `validateRole` pattern (which only warns and cannot fail a build). A second insight — *"Fix agent behavior with verbatim-copy guidance rather than relaxing intentional tool strictness"* — supports leaving `ProjectCommentSchema.type` as free-form `z.string()` and introducing `"ax"` as a persona-side convention rather than adding a schema enum.

## Summary

Roll out the AX (Agent Experience) Feedback mechanism from its 9 pre-existing AX personas (5 proof-of-concept + 4 audit-inserted) to all eligible personas across the three suites, with a persistence channel selected per group, while keeping AX Feedback a **pure checkpoint duty** on every persona. The rollout is gated behind two new metadata fields (`ax_feedback`, `ax_feedback_target`) so group membership is declared in YAML rather than inferred inside the partial, and so the whole change is reversible at the metadata layer.

Three defects in the existing partial are fixed first and blocking: the `## AX Feedback` H2 that terminates the enclosing `## Workflow` section (D1), the build-system post-processor mangling the fenced template block (D2 — fixed at the root cause in `@mistralys/persona-builder` **and** worked around partial-side), and the absence of a sub-agent propagation rule. The plan also deletes the orphaned `personas/shared/partials/incident-logging.md` stub while explicitly preserving the live ledger override, and corrects a pre-existing `default_cc_tools` documentation bug plus its dead YAML keys.

This plan implements `docs/agents/projects/2026-08-25-ax-feedback-rollout-spec.md`. It resolves one gap the spec did not cover: `ledger_add_project_comment` is granted to ledger agents 3–9 only, so Group B cannot include agents 1 and 2 as written.

### Post-Research Amendments (2026-08-26)

Persona audits for Design Guide v2.8 (commits `b1ea33ef`, `9886f61a`, `8b356d07`) merged into this branch after the plan was written. Three impacts:

1. **`comms-curator` reclassified from D-off to C.** The audit inserted an AX block and confirmed it has `edit`. User decision: keep the block — the persona genuinely benefits from AX feedback. Group D-off is now `recipe-curator` only (count 1). Group C rises from 27 to 28.
2. **Four fewer content insertions needed.** `web-gui-specialist`, `comms-curator`, `documentation-curator`, and `unit-test-auditor` already carry AX blocks from the audits. They join the "flag-only" set alongside the proof-of-concept personas.
3. **Stale line-number references corrected.** The audits restructured many content templates. All line references in steps and Required Components have been updated to match the post-audit state.

## Architectural Context

**Persona build system.** Three suites (`personas/ledger/`, `personas/standalone/`, `personas/ledger-support/`) each build to three targets (`vs-code`, `claude-code`, `deep-agents`) — 43 personas × 3 = 129 generated files. Sources are YAML metadata in `{suite}/src/meta/` plus Markdown content in `{suite}/src/content/`. `scripts/build-personas.js` is a thin wrapper delegating to the `@mistralys/persona-builder` CLI via `personas/persona-build.config.js`. Generated output is gitignored (`.gitignore`: `/personas/*/{vs-code,claude-code,deep-agents}/*.md`) and must never be hand-edited.

**Partial resolution is two-layer.** `personas/persona-build.config.js` L79 sets `sharedPartialsDir: personas/shared/partials`; each suite additionally supplies `{suite}/src/partials/`. `ai-persona-builder/src/loaders/partials-loader.ts` L8–10 documents the merge: keyed by filename stem, suite-local spreading last. A same-named suite partial therefore **silently shadows** its shared counterpart — the mechanism behind finding F1.

**Post-processing is fence-unaware.** `ai-persona-builder/src/engine/postProcessor.ts` L36–39 unconditionally injects blank lines before and after every `---` line. `ai-persona-builder/AGENTS.md` marks `src/engine/` as zero-dependency and pure, so any fix must use no imports.

**Observation channels (post-consolidation).** Ledger agents 3–6 and 8 record code observations via `ledger_add_observation` (pipeline comments on a work package, driven by `insight_pipeline_type` + `mcp-insight-capture.md`). Standalone `developer` and `web-gui-specialist` use the JSONL sidecar (`insight_agent` + `insight-capture.md` / `insight-compilation.md`). No other persona runs a continuous sink.

**MCP project-comment channel.** `mcp-server/src/tools/observations.ts` L112–199 implements `ledger_add_project_comment`: project-scoped, `type` is free-form `z.string()`, `agent` is required, `context` is validated as required only when `type === 'incident'`. It writes to `root.project_comments` (`mcp-server/src/schema/root-index.ts` L23–30, L44). The single live reader is the GUI Project Comments card (`mcp-server/gui/public/views/project-detail.js` L648–674), which renders `type` as a free-text badge and styles only by `priority` — fully type-agnostic.

**Design authority.** `personas/docs/persona-design-guide.md` Pattern 6 (L522–546) caps side-channels at one per persona; Pattern 15 (L764) requires every duty to be foreground, action-gated, or checkpoint-slotted. `docs/references/insights-sidecar-reference.md` L336–337 records the invariant that checkpoint-slotted partials such as `ax-feedback` do not count toward the cap.

## Approach / Architecture

**Four groups, four persistence channels, one capture mode.** Every persona receives the same checkpoint-slotted AX Feedback block. What differs is only *where the friction is persisted*, selected by the `ax_feedback_target` metadata field:

| Group | Personas | Count | `ax_feedback_target` | Persistence |
|---|---|---|---|---|
| **A** | standalone `developer`, `web-gui-specialist` | 2 | `synthesis` | AX Feedback section in `synthesis.md`, compiled from the existing JSONL sink (widened with an `ax` type) |
| **B** | ledger agents 2–9 | 8 | `ledger` | `ledger_add_project_comment`, `type: "ax"` |
| **C** | remaining flag-enabled personas with `edit` | 28 | `sidecar` | AX sidecar file, friction-only, two-rung ladder |
| **D-inline** | ledger agent 1; the 3 standalone/support personas lacking `edit` (excl. `recipe-curator`) | 4 | `inline` | Inline in the response only |
| **D-off** | `recipe-curator` | 1 | `ax_feedback: false` | No AX block emitted |

Group membership lives entirely in YAML. The partial reads `ax_feedback_target` and emits the matching persistence instruction; it never infers group from role, suite, or tool list.

**Why the partial stays checkpoint-only.** The superseded plan's D3 added an incremental capture sink, which would have given 7 personas a second continuous observation duty in breach of Pattern 6's cap and invalidated the documented invariant at `docs/references/insights-sidecar-reference.md` L337. This plan keeps the partial free of any append-during-work instruction. Group A's `ax` sink entries are not a second sink — they widen the type vocabulary of a sink the persona already opens, marks, and appends to at every gate.

**Staged rollout, gate per stage.** Five stages (below). The insertion edit is mechanical and identical; the persistence wiring is not, and differs per group. Staging isolates each channel's verification.

## Rationale

**A metadata flag rather than partial-side inference.** The spec's three consumers are real and verifiable: Group D exclusion (5 personas that must not write a file or must emit nothing), channel selection (4 distinct persistence targets), and rollback (without the flag, reversing the rollout means re-editing ~48 insertion sites). This is not a speculative configuration knob — every value is consumed on day one.

**`ledger_add_project_comment` over `ledger_add_observation`.** `AddObservationSchema` (`mcp-server/src/tools/observations.ts` L18–34) requires `work_package_id` and `pipeline_type` and writes a pipeline comment onto a work package. AX friction ("the handoff data was ambiguous") is not a property of that WP's code, and filing it there routes it into Synthesis's Code Insights section, which `personas/ledger/src/content/9-synthesis.md` L71 defines as exactly "observations recorded via `ledger_add_observation`". `AddProjectCommentSchema` is project-scoped with a required `agent` field and free-form `type` — a precise fit needing zero schema change.

**Agent 2 only, not agents 1–9.** The spec assigns Group B to "agents 1–9", but the tool allocation table (`personas/docs/agents/project-manifest/api-surface.md` L487) and the YAML `mcp_tools` arrays confirm the grant reaches agents 3–9 only. Granting it to agent 2 (PM) is coherent: the PM *creates* the ledger via `ledger_initialize_project`, so by handoff time a ledger exists to write to. Agent 1 (Planner) hands off **before** the ledger exists, so it has no project to comment on regardless of grants — inline-only is the only correct target for it.

**Fixing D2 at the root cause as well as partial-side.** The partial-side workaround alone leaves an unguarded landmine: `postProcessor.ts` L36–39 will mangle any future partial containing a `---` inside a fence, and `ai-persona-builder/tests/engine/postProcessor.test.ts` has no fenced-block case to catch it. Fixing the library retires the class of bug; the partial-side restructure additionally means the correct output does not *depend* on shipping and installing a new library version before Stage 2 can proceed.

**Removing the dead `default_cc_tools` keys alongside the doc fix.** `ai-persona-builder/src/builders/persona-builder.ts` L311 implements `cc_tools` → `tools`; no `default_cc_tools` lookup exists anywhere in the library source. Leaving the keys in the three `_shared.yaml` files while correcting the docs would produce documentation that contradicts visible configuration — the more confusing end state. Removing them is safe precisely because nothing reads them, and the persona `--check` diff proves it.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| AX capture mode | Checkpoint slot only, on every persona | Incremental capture sink (superseded plan's D3); hybrid (sink for long-session personas only) | The sink breaches Pattern 6's one-side-channel cap on the 7 personas that already run one, and threatens to thin the code-observation sinks that have an actual downstream consumer. The checkpoint slot costs nothing mid-session and is the forcing function that makes a skipped duty visible. |
| Ledger persistence channel | `ledger_add_project_comment`, `type: "ax"` | `ledger_add_observation`; a new dedicated MCP tool; a sidecar file for ledger personas too | The project-comment channel already exists, is already granted to agents 3–9, already carries a required `agent` field for attribution, and already renders in the GUI. A new tool would add MCP surface for zero capability gain; a sidecar would duplicate a store the ledger personas already have. |
| Ledger agents 1 & 2 | Grant the tool to agent 2; agent 1 inline-only | Both inline-only; grant to both | Agent 2 owns the ledger's creation, so persistence is available and its friction (plan ambiguity, decomposition gaps) is high-value. Agent 1 hands off before any ledger exists — granting it the tool would produce a guaranteed-failing call. |
| Group A sink handling | Option A — widen the existing sink with an `ax` type | Option B — checkpoint-only, like all other non-ledger personas | These are the two longest-session personas in the standalone suite, where handoff-time recall is weakest. Widening an already-open sink's type vocabulary adds no new continuous duty. Cost is 3 bounded follow-through edits, all identified. |
| Group C persistence format | Human-readable prose, gitignored | JSONL / machine-readable schema; centralized AX store | The consumer is the user, reading the file in or shortly after the session that produced it. Designing a parser format for an aggregator that does not exist is speculative; if centralization is ever built it can define its own format. |
| Group D exclusion mechanism | `ax_feedback: false` in YAML | Omit the `{{> ax-feedback}}` insertion from those content templates | The flag keeps a single uniform insertion pattern across all content templates and makes exclusion auditable in one place (metadata) rather than by the absence of a line in a content file. |
| D2 fix location | Library fix **and** partial-side restructure | Partial-side only; library only | Partial-side only leaves the bug latent for every future partial. Library-only makes Stage 1's correctness depend on a cross-repo publish + install landing first. Doing both retires the bug class and decouples the stages. |
| `default_cc_tools` | Fix the 4 docs and delete the dead keys | Fix docs only; split into a separate plan; delete keys only | Docs and configuration must agree. The research is already done and the change is provably inert (nothing in the library reads the key), so deferring it a third time costs more than including it. |
| AX section tier in the Design Guide | **Recommended** — registered in the Optional Sections table with a "when to include" rule | **Required** section (superseded plan's Step 6a) | Marking it Required permanently binds every future persona to a mechanism with no measured benefit yet. The guide has no third tier, so the Optional table (which already carries a "When to Include" column) is the correct home. |

## Pattern Alignment

- **Follows** the shared-partial precedent for short, suite-agnostic behavioural fragments — `personas/shared/partials/` per `personas/docs/agents/project-manifest/constraints.md` L247, as established by `insight-capture.md` and `mcp-insight-capture.md`.
- **Follows** the parameterised-partial pattern from `2026-08-24-insight-channel-consolidation`: the partial branches on a metadata field (`ax_feedback_target`) rather than duplicating per-suite variants.
- **Follows** the numbered-step insertion pattern established by the 9 pre-existing AX personas — verified at `personas/ledger/src/content/3-developer.md` L177–179 (numbered step, blank line, `{{> ax-feedback}}`, then the target-conditional handoff at `N+1`).
- **Follows** the feature-flag metadata precedent set by `has_incident_logging` (`personas/ledger/src/meta/*.yaml`, documented in `personas/docs/agents/project-manifest/api-surface.md` L218 and `variables.md` L51) for flag shape and documentation placement.
- **Follows** the build-time validation pattern from `scripts/lib/insight-validation.js`, invoked unconditionally by `scripts/build-personas.js` L456–470 in both real and `--check` modes.
- **Follows** the two-rung sink-path ladder from `personas/shared/partials/insight-capture.md` L7–8 (plan folder first, then a repo-relative dated directory).
- **Follows** the existing `.gitignore` convention for plan-folder artefacts — filename-specific `/docs/agents/**/{name}` entries (`audit.md`, `design-review.md`, `research-brief.md`), never a wildcard.
- **Follows** the persona version-bookkeeping convention (`personas/standalone/src/content/persona-curator.md` Strict Constraints): per-persona `changelog:` block scalar entry plus a `personas/changelog.md` entry; `version` and `last_updated` remain auto-derived.
- **Follows** `ai-persona-builder`'s zero-dependency engine invariant (`ai-persona-builder/AGENTS.md`, `docs/agents/project-manifest/constraints.md` §1) — the `postProcessor.ts` fix adds no imports.
- **Departs** from the existing `ProjectComment.type` usage convention by introducing a fourth value (`"ax"`) alongside `incident` / `note` / `decision`. Justified: `AddProjectCommentSchema.type` is deliberately `z.string()` (not an enum), the single live reader is type-agnostic, and adding an enum to constrain it would be the larger departure.
- **Departs** from the Design Guide's two-tier Required/Optional section taxonomy by describing AX Feedback as "Recommended" within the Optional table rather than adding a third tier. Justified: a third tier would be a structural change to the guide for one entry; the Optional table's "When to Include" column already expresses conditional recommendation.

## Detailed Steps

### Stage 1 — Partial fix, flag plumbing, library fix (blocking)

Nothing in Stages 2–5 may begin until Stage 1's gate passes. Every unfixed defect is multiplied by the insertion count.

1. **Fix D1 — heading level.** In `personas/shared/partials/ax-feedback.md`, replace the opening `## AX Feedback` H2 with a bolded label (matching the `**Format**` convention already in the file at L5). The H2 **inside** the fenced template block is the literal output format and must remain an H2 unchanged.

2. **Fix D2 (library) — fence-aware post-processing.** In `ai-persona-builder/src/engine/postProcessor.ts`, make `ensureBlankLineBeforeHeadings()` fence-aware: split the input on fenced-code-block delimiters and apply the existing heading and horizontal-rule regexes (L34, L37, L39) only to non-fence segments. Add no imports — `src/engine/` is a zero-dependency layer. Add regression tests to `ai-persona-builder/tests/engine/postProcessor.test.ts` asserting that a `---` and a `##` heading inside a ``` fence are left byte-identical, while preserving the existing L86–95 outside-fence assertions.

3. **Release the library fix.** Add a `CHANGELOG.md` entry in `ai-persona-builder`, then run the repo's `release-check` skill (`ai-persona-builder/.github/skills/release-check/SKILL.md`) and publish. Note the pre-existing version-state discrepancy: `package.json` is at 2.5.1 while `CHANGELOG.md` is at 2.6.1 — resolve it through `release-check` rather than a hand edit.

4. **Adopt the new library version in `ai-insights`.** Bump the `@mistralys/persona-builder` range in `personas/package.json` (currently `^2.6.0` at L12), reinstall, and confirm `personas/node_modules/@mistralys/persona-builder/dist/index.js` no longer contains the unguarded rule regexes at L86–87.

5. **Fix D2 (partial-side) — defensive restructure.** Independently of the library fix, restructure the fenced template block in `ax-feedback.md` so it does not rely on fence-aware post-processing (e.g. avoid a bare `---` line inside the fence, or place it so no injection is possible). This keeps Stage 1's gate satisfiable without waiting on the publish-and-install round trip, and keeps generated output correct for anyone on an older library version.

6. **Add the sub-agent propagation rule** to `ax-feedback.md`: a parent persona does not re-emit a sub-agent's AX block verbatim; it may merge a genuinely distinct item, attributed to the sub-agent, counting against the 3-bullet cap. Applies to the 10 sub-agent dispatchers (ledger `2-project-manager`, `7-release-engineer`, `8-documentation`, `9-synthesis`; standalone `developer`, `documentation-curator`, `manifest-curator`, `plan-refiner`, `web-gui-specialist`, `workspace-architect`).

7. **Add the persistence branch** to `ax-feedback.md`, keyed on `ax_feedback_target` with four arms — `ledger` (call `ledger_add_project_comment` with `type: "ax"`, `agent: {{role}}`, no `context` required), `synthesis` (record an `ax`-typed entry in the existing sink; compile into an AX Feedback section of `synthesis.md`), `sidecar` (two-rung ladder, friction-only, append-only, non-blocking), `inline` (report in the response only, no file write). State explicitly that AX Feedback fires at the handoff checkpoint and covers design friction, while `incident-logging` fires on a system malfunction — the two duties do not overlap and both are kept. Update `AddProjectCommentSchema.type`'s Zod `.describe()` string in `mcp-server/src/tools/observations.ts` (currently `'Comment type: "incident", "note", or "decision"'`) to `'Comment type: "incident", "note", "decision", or "ax"'`, so the tool contract the calling agent reads matches the new persona-side convention — a one-line description-text change, not a schema change. Add a `mcp-server/changelog.md` entry for it per the workspace's changelog convention.

8. **Verify the partial carries no capture sink.** Confirm `ax-feedback.md` contains no instruction to append during work — this is the invariant the whole plan exists to preserve.

9. **Add the `ax_feedback` and `ax_feedback_target` metadata fields.** Declare them explicitly on every persona across all three suites (no implicit defaults — group membership must be visible in each YAML file).

10. **Add build-time validation** as a new standalone module `scripts/lib/ax-validation.js` (mirroring `scripts/lib/insight-validation.js`), invoked unconditionally from `scripts/build-personas.js` in both real and `--check` modes alongside the existing `validateInsightFieldsInDirs` call at L456–470. It must fail the build when: `ax_feedback` is absent from any persona; `ax_feedback: true` without a valid `ax_feedback_target`; `ax_feedback_target` set while `ax_feedback: false`; `ax_feedback_target: sidecar` on a persona whose `tools:` block lacks `edit`; or `ax_feedback_target: ledger` on a persona whose `mcp_tools` lacks `ledger_add_project_comment`. Add fixture tests in `scripts/tests/`.

11. **Re-verify the 9 pre-existing AX personas.** Rebuild and confirm the D1/D2 fixes produce correct output for the 5 proof-of-concept personas (ledger `3-developer`, ledger `9-synthesis`, standalone `developer`, `readme-curator`, `changelog-curator`) and the 4 audit-inserted personas (`web-gui-specialist`, `comms-curator`, `documentation-curator`, `unit-test-auditor`), with no regression in their existing behaviour.

### Stage 2 — Group B: ledger suite (8 personas)

12. **Grant `ledger_add_project_comment` to agent 2.** Add it to the `mcp_tools` array in `personas/ledger/src/meta/2-project-manager.yaml` (currently 6 tools at L45–57) with a purpose line covering both project-level notes and AX feedback. Update the allocation table at `personas/docs/agents/project-manifest/api-surface.md` L487 and the agent-2 rationale paragraph.

13. **Set the flags for ledger personas.** `ax_feedback: true` + `ax_feedback_target: ledger` on agents 2–9. `ax_feedback: true` + `ax_feedback_target: inline` on agent 1 (Planner) — no ledger exists at its handoff.

14. **Insert the AX step into ledger content templates.** Agents 2, 4, 5, 6, 7, 8 need a new insertion (3 and 9 already have one and only need the flag). Follow the verified pattern: numbered step `N. **AX Feedback:** Before handing off, reflect on your session experience.`, blank line, `{{> ax-feedback}}`, then the existing target-conditional handoff block renumbered to `N+1`. Agent 1 has an inline handoff — insert before the inline handoff step. Agent 9 already has one at L120 and needs only the flag.

15. **Audit `project_comments` readers for the new type.** Confirm each either handles or ignores `type: "ax"`: the GUI Project Comments card (`mcp-server/gui/public/views/project-detail.js` L648–674 — type-agnostic, verified), the Synthesis persona's narrative read (`personas/ledger/src/content/9-synthesis.md` L46), and Ledger Doctor's audit-trail read (`personas/ledger-support/src/content/ledger-doctor.md` L275). Note that `GET /api/insights` is already removed (404, asserted at `mcp-server/tests/gui/server-knowledge-routes.test.ts` L493–494), so `getInsights` in `mcp-server/gui/public/api-client.js` L211–221 is dead code with no live consumer to pollute.

### Stage 3 — Group A: standalone insight personas (2 personas)

16. **Set the flags** on `personas/standalone/src/meta/developer.yaml` and `web-gui-specialist.yaml`: `ax_feedback: true`, `ax_feedback_target: synthesis`.

17. **Add the `ax` type filter to compilation.** `personas/shared/partials/insight-compilation.md` L3 currently compiles *every* sink entry into `{{insight_report_target}}` (the Code Insights section of `synthesis.md`). Add a type filter so `ax`-typed entries route to an AX Feedback section instead, leaving Code Insights unpolluted.

18. **Fix the sink-state forcing table.** The same partial's table at L24–28 treats "marker present + entries from any agent" as "capture ran and produced material". An AX-only sink would falsely read as a clean code result. The table must count **non-`ax`** entries when classifying sink state. Add a static test (extending `scripts/tests/ax-partial-invariants.test.js`, or a new `scripts/tests/insight-compilation-invariants.test.js`) asserting `insight-compilation.md` contains type-filtering language for `ax` and that the sink-state table's forcing-function row is keyed on non-`ax` entries — mirroring the existing static-assertion pattern for `ax-feedback.md`'s invariants rather than relying solely on the Stage 3 manual gate.

19. **Add an `ax` row to each persona's Scope & Boundaries table.** Both personas declare a code-only observation territory (the pattern at `personas/ledger/src/content/3-developer.md` L84); an `ax` type contradicts it unless the table is extended.

20. **Verify the pre-existing AX blocks** in standalone `developer.md` (L228) and `web-gui-specialist.md` (L247) — both already have insertions and need only the metadata flags.

### Stage 4 — Group C: sidecar personas (28 personas)

21. **Set the flags** — `ax_feedback: true`, `ax_feedback_target: sidecar` — on the remaining standalone and ledger-support personas that hold `edit`.

22. **Insert the AX step** into each Group C content template that does not already have one, matching the persona's structural shape (see Required Components for the per-shape mapping): single-workflow personas take one insertion; the 3 personas with a separate `## Handoff` H2 (`agents-md-curator` L285, `ctx-architect` L452, `usage-scenarios-curator` L352) take an unnumbered block before that heading; the 6 personas with mode-scoped `### Workflow` and the 3 with multiple `## Workflow` H2s (excl. flag-off `recipe-curator`) take one insertion per mode. Five Group C personas already have AX blocks from the proof-of-concept or persona audits (`changelog-curator`, `readme-curator`, `comms-curator`, `documentation-curator`, `unit-test-auditor`) and need only the metadata flags.

23. **Add both `.gitignore` patterns.** Rung 1: `/docs/agents/**/ax-feedback.md` — filename-specific, mirroring the existing `audit.md` / `research-brief.md` entries. Rung 2: `/docs/agents/ax/` — mirroring the existing `/docs/agents/insights/` entry. Add a comment stating the sidecar is a working note for the user, not a repository artefact. **Verify the rung-1 pattern does not hide `insights.jsonl`**, which is a tracked plan-folder artefact.

### Stage 5 — Group D, documentation, regeneration

24. **Set Group D flags.** `ax_feedback: true` + `ax_feedback_target: inline` on the 3 personas lacking `edit` (`standalone/git-committer`, `ledger-support/ledger-knowledge-curator`, `ledger-support/ledger-orchestrator-archaeologist`). `ax_feedback: false` on `recipe-curator` (user-facing output persona with no codebase interaction).

25. **Update the Design Guide.** In `personas/docs/persona-design-guide.md`: register AX Feedback in the **Optional Sections** table (L87–110) with a "when to include" rule describing it as recommended for any persona that performs work on a codebase; extend Pattern 6 (L522–546) with AX Feedback as a worked example of a duty deliberately kept checkpoint-slotted *instead of* being given a sink; bump the version and prepend a history entry to the block at L15–22.

26. **Add the Persona Curator checklist item.** Append a matching `- [ ]` item to the Quality Checklist in `personas/standalone/src/content/persona-curator.md` (L184–210).

27. **Re-affirm the sidecar-reference invariant.** `docs/references/insights-sidecar-reference.md` L336–337 already asserts that checkpoint-slotted partials such as `ax-feedback` do not count toward the one-side-channel cap. Make the re-affirmation explicit rather than incidental, now that `ax-feedback` is on 42 personas (43 minus 1 D-off).

28. **Document the new metadata fields** in `personas/docs/agents/project-manifest/api-surface.md` (metadata schema table + feature-flag table) and `variables.md`, per the root `AGENTS.md` Manifest Maintenance Rule for feature flags. Update the shared-partial inventory for the deleted `incident-logging.md` stub — narrowly: correct only the `incident-logging.md` reference in the two affected rows (`developer-strict-constraints.md`, `docs-operational-protocol.md`). The same table's roughly 18 other rows referencing shared partials that no longer exist (including those two rows' own filenames) are a separate, pre-existing staleness issue predating this plan and are out of scope here.

29. **Delete the orphaned shared stub.** Remove `personas/shared/partials/incident-logging.md`. **Keep `personas/ledger/src/partials/incident-logging.md`** and all 6 of its consumers unchanged. Confirm the standalone and ledger-support builds emit no `[WARN]` for a missing partial (the stub's original purpose no longer applies — no non-ledger persona references it).

30. **Fix the `default_cc_tools` documentation bug.** Correct `personas/docs/agents/project-manifest/api-surface.md` (L151, L152, L197, L213, L406, L433), `variables.md` (L85, L86, L93), `constraints.md` (L84), and `data-flows.md` (L148) to describe the real chain `cc_tools:` → `tools:` as implemented at `ai-persona-builder/src/builders/persona-builder.ts` L311. Also correct `personas/docs/persona-build-system.md` (L269, L284, L323, L418), which carries the same error.

31. **Remove the dead `default_cc_tools` keys** from `personas/ledger/src/meta/_shared.yaml` (L9), `personas/standalone/src/meta/_shared.yaml` (L6), and `personas/ledger-support/src/meta/_shared.yaml` (L7). Verify via `node scripts/build-personas.js --check` that generated output is byte-identical — nothing in the library reads the key.

32. **Version bookkeeping.** Prepend a `changelog:` entry to every modified persona's YAML block scalar and add a summary entry to `personas/changelog.md`. Re-derive the bump level per persona after group assignment: content-structure additions are minor; flag-only additions are patch. Never add standalone `version:` or `last_updated:` fields — both are auto-derived.

33. **Regenerate derived artefacts.** Run `node scripts/build-personas.js`, then `node scripts/generate-agents-overview.js` (regenerating `docs/agents-overview.md`), then `node scripts/cli.js ctx-generate` to refresh `.context/` and `CLAUDE.md`. Never hand-edit `CLAUDE.md`.

### Mechanical verification (all stages)

34. **Per-file count audit.** For every generated file, assert that the number of AX inclusions equals the number of AX workflow steps equals the number of handoff blocks. 129 generated files cannot be spot-checked.

35. **Ordinal continuity scan.** Assert every numbered workflow list runs 1..N with no gaps or repeats after renumbering.

36. **Structural regression scan.** Assert no `##`-level heading appears between a `## Workflow` heading and its handoff step in any generated file — the direct D1 regression guard.

37. **Fenced-block fidelity check.** Assert the rendered fenced template block in every generated file is byte-identical to the `ax-feedback.md` source — the direct D2 regression guard.

## Dependencies

- Stage 1 blocks Stages 2–5 entirely.
- Step 3 (library publish) blocks step 4 (adopt new version). Step 5 (partial-side fix) is deliberately independent of both so Stage 1's gate does not wait on the publish round trip.
- Step 10 (`ax-validation.js`) depends on step 9 (fields exist) but must land before Stages 2–4 so every flag edit is validated as it is made.
- Step 12 (grant the tool to agent 2) blocks step 13's `ax_feedback_target: ledger` on agent 2 — the validator in step 10 will reject the flag otherwise.
- Steps 17 and 18 (compilation partial edits) must land in the same change as step 16 (Group A flags), or Group A's `ax` entries leak into Code Insights.
- Step 23 (`.gitignore`) must land before or with step 22, or the first friction session on a Group C persona leaves an untracked file visible in `git status`.
- Step 29 (delete the shared stub) depends on nothing but must be verified by a build that emits no missing-partial warning.
- Step 31 depends on step 30 (docs corrected first, so the deletion does not momentarily contradict the docs).
- Steps 32–33 depend on all source edits being complete.
- Steps 34–37 run as the gate for each stage, not only at the end.

## Required Components

### Modified — `ai-persona-builder` repository

| File | Change |
|---|---|
| `src/engine/postProcessor.ts` | Fence-aware `ensureBlankLineBeforeHeadings()`; no new imports |
| `tests/engine/postProcessor.test.ts` | New fenced-block regression cases; preserve L86–95 |
| `CHANGELOG.md` | New entry |
| `package.json` | Version bump via `release-check` |
| `docs/agents/project-manifest/api-surface.md` (or `data-flows.md`) | Update if the post-processor's documented behaviour changes |

### Modified — persona partials

| File | Change |
|---|---|
| `personas/shared/partials/ax-feedback.md` | D1 heading fix; D2 fenced-block restructure; sub-agent propagation rule; four-arm persistence branch on `ax_feedback_target` |
| `personas/shared/partials/insight-compilation.md` | `ax` type filter (L3); non-`ax` counting in the sink-state table (L24–28) |

### Deleted

| File | Reason |
|---|---|
| `personas/shared/partials/incident-logging.md` | Orphaned dead stub — zero references from any suite |

### Modified — mcp-server tool schema description

| File | Change |
|---|---|
| `mcp-server/src/tools/observations.ts` | `AddProjectCommentSchema.type`'s Zod `.describe()` string updated to enumerate `"ax"` alongside `"incident"`, `"note"`, `"decision"` — text only, no schema/type change |
| `mcp-server/changelog.md` | New entry for the description-text update |

### Preserved unchanged (explicit non-targets)

| File | Reason |
|---|---|
| `personas/ledger/src/partials/incident-logging.md` | Live MCP channel for all 6 ledger consumers |
| `personas/ledger/src/content/{3,4,5,6,7,8}-*.md` — the `{{> incident-logging}}` lines | The duty is kept; AX extends the channel rather than replacing it |
| `has_incident_logging` in all 9 ledger YAML files and its 4 documentation sites | The partial it guards stays |
| `mcp-server/src/schema/root-index.ts` | `type` is already free-form `z.string()`; no schema change needed |

### Modified — persona metadata (all 43 files)

| Scope | Files | Change |
|---|---|---|
| Ledger | `personas/ledger/src/meta/{1..9}-*.yaml` | `ax_feedback`, `ax_feedback_target`, `changelog` entry; agent 2 additionally gains `ledger_add_project_comment` in `mcp_tools` |
| Standalone | `personas/standalone/src/meta/*.yaml` (23) | Same two fields + `changelog` entry |
| Ledger-support | `personas/ledger-support/src/meta/*.yaml` (11) | Same two fields + `changelog` entry |
| Shared | `personas/{ledger,standalone,ledger-support}/src/meta/_shared.yaml` | Remove the dead `default_cc_tools` key |

### Modified — persona content templates, by structural shape

| Shape | Personas | Insertion |
|---|---|---|
| Target-conditional `handoff-block` partial | ledger 2, 4, 5, 6, 7, 8 | Numbered step + `{{> ax-feedback}}` before `{{#if target_vscode}}` |
| Single `## Workflow`, inline handoff | ledger 1, 9; standalone `composer-curator`, `developer`†, `git-committer`, `module-intent-architect`, `plan-architect-reviewer`, `plan-auditor`, `plan-refiner`, `planner`, `readme-curator`†, `researcher`, `unit-test-auditor`†, `web-gui-specialist`†; ledger-support `ledger-bootstrapper`, `ledger-claude-coordinator`, `ledger-dependency-sequencer`, `ledger-doctor`, `ledger-knowledge-archiver`, `ledger-knowledge-curator`, `ledger-orchestrator-archaeologist`, `ledger-orchestrator-runner`, `ledger-pipeline-configurator`, `ledger-wp-decomposer` | Single numbered-step insertion |
| Separate `## Handoff` H2 | standalone `agents-md-curator` (L285), `ctx-architect` (L452), `usage-scenarios-curator` (L352) | Unnumbered block before the `## Handoff` heading |
| No `## Workflow` H2 (mode-scoped `### Workflow`) | standalone `changelog-curator`† (L215, L235), `comms-curator`†, `documentation-curator`†, `manifest-curator`, `persona-curator`, `whatsnew-curator` | One insertion per mode |
| Multiple `## Workflow` H2s | standalone `recipe-curator`*, `workspace-architect` (Onboard L172 / Upgrade L190); ledger-support `standalone-archiver` (Import L60 / Update L129) | One insertion per mode |

\* Flag-off — no insertion. † Already has an insertion; flag only.

### Modified — scripts

| File | Change |
|---|---|
| `scripts/lib/ax-validation.js` | **New** — `ax_feedback` / `ax_feedback_target` validation |
| `scripts/build-personas.js` | Invoke the new validator unconditionally, alongside L456–470 |
| `scripts/tests/` | **New** fixture tests for the validator |

### Modified — documentation

`personas/docs/persona-design-guide.md`; `personas/standalone/src/content/persona-curator.md`; `personas/docs/agents/project-manifest/{api-surface,variables,constraints,data-flows}.md`; `personas/docs/persona-build-system.md`; `docs/references/insights-sidecar-reference.md`; `.gitignore`; `personas/changelog.md`; `docs/agents-overview.md` (generated); `.context/` + `CLAUDE.md` (generated).

## Assumptions

- `ProjectCommentSchema.type` remaining `z.string()` is deliberate, not an oversight — supported by the `addProjectComment()` implementation, which only special-cases `'incident'` for the `context` requirement.
- The GUI Project Comments card is the only live UI surface for `project_comments`; `GET /api/insights` is confirmed removed (404) and `getInsights` is dead client code.
- Group C personas are predominantly invoked manually, so a human reads the sidecar in or shortly after the producing session. No programmatic aggregation is required for the mechanism to pay off.
- A fence-aware split in `postProcessor.ts` can be expressed without imports, satisfying the zero-dependency engine invariant.
- The `ai-persona-builder` local version-state discrepancy (`package.json` 2.5.1 vs `CHANGELOG.md` 2.6.1) is a bookkeeping lag that `release-check` will surface and resolve; it is not evidence of divergent source.
- Persona `--check` output being byte-identical after removing `default_cc_tools` is sufficient proof the key is unread.

## Constraints

- **No persona may carry more than one continuous observation duty** (Pattern 6, `personas/docs/persona-design-guide.md` L546). AX Feedback stays checkpoint-slotted; the partial must contain no append-during-work instruction.
- **Generated persona output is never hand-edited.** All changes go through `{suite}/src/`. Output lives in gitignored directories.
- **`CLAUDE.md` is generated** from `AGENTS.md` via `ctx-generate` — never hand-edited.
- **`src/engine/` in `ai-persona-builder` is zero-dependency and pure.** No imports may be added.
- **Version bookkeeping is mandatory** on every persona change: per-persona `changelog:` entry plus a `personas/changelog.md` entry. Never add standalone `version:` / `last_updated:` fields.
- **Cross-platform** (Windows, macOS, Linux): sidecar path construction must use framework path utilities; no hardcoded separators; `.gitignore` patterns must be separator-agnostic.
- **A bare grep for `incident-logging` is not a valid acceptance check** — it will always match the live ledger override and its 6 consumers. Criteria must reference both full paths.
- **Sidecar writes are non-blocking.** A failed write must never gate the primary task; the inline block still stands.
- **The sidecar is written only when there is friction.** Zero-friction sessions leave no artifact. The inline block, however, is always emitted.

## Out of Scope

- **Centralized AX storage or aggregation for Group C.** If manual consumption proves insufficient, collection and aggregation is a separate project with its own format decisions. Groups A and B already land in stores with existing readers.
- **Partial content redesign.** The category taxonomy, the 3-bullet cap, and the severity scheme stay as shipped by the proof-of-concept.
- **Tiering by persona complexity.** One tier, as validated by the proof-of-concept.
- **Granting `edit` to any persona.** All four omissions are deliberate and documented.
- **Orchestrator changes.** `stage_result` passes the final message through verbatim (`orchestrator/src/nodes/__init__.py` L1005); no parsing of the AX block is added.
- **Adding an enum to `ProjectCommentSchema.type`.** The free-form string is deliberate.
- **Removing `has_incident_logging`** or altering the `incident-logging` duty on any ledger persona.
- **Granting `ledger_add_project_comment` to ledger agent 1.** No ledger exists at Planner handoff time.
- **`ledger-claude-coordinator`'s possible `todo` grant.** Merited on its own dispatch-loop grounds; a separate, optional change.
- **Correcting the shared-partial inventory table's roughly 18 other stale rows** in `api-surface.md` beyond the `incident-logging.md` reference. Pre-existing staleness predating this plan; a separate cleanup.

## Acceptance Criteria

- AC-01: No persona carries more than one continuous observation duty. `personas/shared/partials/ax-feedback.md` contains no instruction to append, record, or write during work.
- AC-02: `personas/ledger/src/partials/incident-logging.md` still exists and is still referenced by all 6 consumers (`3-developer.md` L158 unconditional; `4-qa.md`, `5-security-auditor.md`, `6-reviewer.md`, `7-release-engineer.md`, `8-documentation.md` guarded by `has_incident_logging`).
- AC-03: `personas/shared/partials/incident-logging.md` no longer exists, and the standalone and ledger-support builds emit no missing-partial warning.
- AC-04: `has_incident_logging` is unchanged in all 9 ledger metadata files and in `api-surface.md` L218, `variables.md` L51/L200, and `persona-build-system.md` L328/L357/L418.
- AC-05: No persona records AX friction via `ledger_add_observation`. No AX instruction anywhere references that tool.
- AC-06: Ledger AX feedback appears in `root.project_comments` as entries with `type: "ax"` and a populated `agent` field, and renders correctly in the GUI Project Comments card.
- AC-07: `personas/ledger/src/meta/2-project-manager.yaml` lists `ledger_add_project_comment` in `mcp_tools`, and the allocation table at `api-surface.md` L487 reflects it.
- AC-08: Ledger agent 1 has `ax_feedback_target: inline` and is not granted `ledger_add_project_comment`.
- AC-09: Every one of the 43 personas declares `ax_feedback` explicitly. No group membership is inferred inside the partial.
- AC-10: `node scripts/build-personas.js` fails when `ax_feedback` is missing, when `ax_feedback_target` is invalid or absent while `ax_feedback: true`, when `ax_feedback_target` is set while `ax_feedback: false`, when `sidecar` is set on a persona lacking `edit`, or when `ledger` is set on a persona lacking `ledger_add_project_comment` — in both real and `--check` modes.
- AC-11: `recipe-curator` emits no AX block in any generated target.
- AC-12: The 3 D-inline personas lacking `edit` (`git-committer`, `ledger-knowledge-curator`, `ledger-orchestrator-archaeologist`) emit an AX block with an inline-only instruction and no file-write instruction.
- AC-13: No sidecar file exists after a zero-friction session on a Group C persona.
- AC-14: After a friction session on rung 1 and on rung 2, `git status` is clean. The rung-1 pattern does not hide `insights.jsonl` or any other tracked plan-folder artefact.
- AC-15: In all 129 generated files, `## Workflow` runs unbroken from its heading to the handoff step — no `##`-level heading intervenes.
- AC-16: In all 129 generated files, the rendered fenced template block is byte-identical to the `ax-feedback.md` source.
- AC-17: Per generated file, AX inclusions == AX workflow steps == handoff blocks. Every numbered workflow list runs 1..N with no gaps or repeats.
- AC-18: The 9 personas with pre-existing AX blocks (5 proof-of-concept + 4 audit-inserted: `web-gui-specialist`, `comms-curator`, `documentation-curator`, `unit-test-auditor`) show no behavioural regression, and `changelog-curator` retains AX blocks in both of its modes.
- AC-19: Group A's `synthesis.md` Code Insights section contains no `ax`-typed entries, and its content is not thinned relative to a pre-change baseline.
- AC-20: `insight-compilation.md`'s sink-state table classifies state by **non-`ax`** entry count, so an AX-only sink is not reported as a clean code result.
- AC-21: `ai-persona-builder` tests assert that `---` and `##` inside a ``` fence are preserved byte-identically, while the pre-existing outside-fence assertions still pass.
- AC-22: `personas/docs/persona-design-guide.md` registers AX Feedback in the Optional Sections table and extends Pattern 6 with it as a checkpoint-slotted worked example; the version and history block are updated.
- AC-23: `personas/standalone/src/content/persona-curator.md`'s Quality Checklist contains a matching AX Feedback item.
- AC-24: `docs/references/insights-sidecar-reference.md` explicitly re-affirms that checkpoint-slotted partials do not count toward the one-side-channel cap.
- AC-25: `api-surface.md` and `variables.md` document `ax_feedback` and `ax_feedback_target`, and the shared-partial inventory no longer lists `incident-logging.md`.
- AC-26: No documentation describes a `default_cc_tools` fallback chain. All five affected documents describe `cc_tools:` → `tools:`.
- AC-27: `default_cc_tools` is absent from all three `_shared.yaml` files, and `node scripts/build-personas.js --check` reports generated output byte-identical to before its removal.
- AC-28: `node scripts/build-personas.js` completes clean and `node scripts/generate-agents-overview.js --check` reports no staleness.
- AC-29: `mcp-server/src/tools/observations.ts`'s `AddProjectCommentSchema.type` `.describe()` string enumerates `"ax"` alongside `"incident"`, `"note"`, and `"decision"`.

## Testing Strategy

Verification is structural and mechanical, because 129 generated files cannot be spot-checked. Four layers:

1. **Unit tests** for the new build-time validator (fixture-based, following the `insight-validation.js` precedent) and for the fence-aware post-processor in `ai-persona-builder`.
2. **Build-level assertions** — `build-personas.js` must fail on every invalid flag combination in both real and `--check` modes; `generate-agents-overview.js --check` must report clean.
3. **Generated-output scans** across all 129 files — heading-structure regression, fenced-block fidelity, per-file count parity, ordinal continuity.
4. **Behavioural gates, one per stage** — a live friction and a live zero-friction session per group, verifying the correct channel fired and (for Group C) that `git status` stays clean on both rungs.

Stage 3 additionally requires a **baseline comparison**: capture Code Insights output from a Group A persona before the change and confirm it is not thinned afterwards. This is the only quality-regression detector in the plan; all other checks are structural.

## Test Plan

- `scripts/tests/ax-validation.test.js` — missing `ax_feedback` fails the build — AC-10
- `scripts/tests/ax-validation.test.js` — `ax_feedback: true` with absent or unrecognized `ax_feedback_target` fails — AC-10
- `scripts/tests/ax-validation.test.js` — `ax_feedback: false` with `ax_feedback_target` set fails — AC-10
- `scripts/tests/ax-validation.test.js` — `ax_feedback_target: sidecar` on a persona whose `tools:` lacks `edit` fails — AC-10, AC-12
- `scripts/tests/ax-validation.test.js` — `ax_feedback_target: ledger` on a persona whose `mcp_tools` lacks `ledger_add_project_comment` fails — AC-08, AC-10
- `scripts/tests/ax-validation.test.js` — all 43 real persona metadata files pass validation — AC-09
- `ai-persona-builder/tests/engine/postProcessor.test.ts` — `---` inside a ``` fence is unmodified — AC-16, AC-21
- `ai-persona-builder/tests/engine/postProcessor.test.ts` — `##` heading inside a ``` fence is unmodified — AC-16, AC-21
- `ai-persona-builder/tests/engine/postProcessor.test.ts` — existing outside-fence rule and heading assertions still pass — AC-21
- `ai-persona-builder/tests/engine/postProcessor.test.ts` — multiple fences in one document, with rules applied between them — AC-21
- `scripts/tests/ax-generated-structure.test.js` — no `##` heading between `## Workflow` and the handoff step in any generated file — AC-15
- `scripts/tests/ax-generated-structure.test.js` — rendered fenced AX template byte-identical to partial source in every generated file — AC-16
- `scripts/tests/ax-generated-structure.test.js` — per generated file, AX inclusions == AX steps == handoff blocks — AC-17
- `scripts/tests/ax-generated-structure.test.js` — every numbered workflow list runs 1..N with no gaps or repeats — AC-17
- `scripts/tests/ax-generated-structure.test.js` — `recipe-curator` output contains no AX block — AC-11
- `scripts/tests/ax-generated-structure.test.js` — the 3 D-inline `edit`-less personas emit an inline-only AX instruction with no file-write text — AC-12
- `scripts/tests/ax-generated-structure.test.js` — all 9 pre-existing AX personas retain their blocks (including `changelog-curator` in both modes) — AC-18
- `scripts/tests/ax-partial-invariants.test.js` — `ax-feedback.md` contains no append-during-work instruction — AC-01
- `scripts/tests/ax-partial-invariants.test.js` — `ax-feedback.md` contains no reference to `ledger_add_observation` — AC-05
- `scripts/tests/incident-logging-paths.test.js` — `personas/ledger/src/partials/incident-logging.md` exists with 6 consumers; `personas/shared/partials/incident-logging.md` does not exist — AC-02, AC-03
- `scripts/tests/shared-yaml.test.js` — `default_cc_tools` absent from all three `_shared.yaml` files — AC-27
- `mcp-server/tests/tools/observations.test.ts` — `AddProjectCommentSchema.type`'s `.describe()` string enumerates `"ax"` — AC-29
- `scripts/tests/ax-partial-invariants.test.js` (or a new `scripts/tests/insight-compilation-invariants.test.js`) — `insight-compilation.md` contains `ax` type-filtering language and the sink-state table's forcing-function row is keyed on non-`ax` entries — AC-19, AC-20
- Manual gate, Stage 2 — friction session on a ledger persona produces a `type: "ax"` project comment with a populated `agent`, rendered in the GUI card — AC-06
- Manual gate, Stage 3 — friction session on a Group A persona routes `ax` entries to the AX section, leaving Code Insights unpolluted and un-thinned versus baseline — AC-19, AC-20
- Manual gate, Stage 4 — zero-friction session on a Group C persona produces no sidecar file — AC-13
- Manual gate, Stage 4 — friction session on rung 1 and rung 2 leaves `git status` clean, with `insights.jsonl` still tracked — AC-14
- Build gate, Stage 5 — `node scripts/build-personas.js` clean; `node scripts/generate-agents-overview.js --check` clean — AC-28

## Documentation Updates

- `personas/docs/persona-design-guide.md` — register AX Feedback in the Optional Sections table with a "when to include" rule; extend Pattern 6 with it as a worked example of a duty kept checkpoint-slotted instead of given a sink; bump version, prepend history entry.
- `personas/standalone/src/content/persona-curator.md` — add the matching Quality Checklist item.
- `personas/docs/agents/project-manifest/api-surface.md` — document `ax_feedback` and `ax_feedback_target` in the metadata schema and feature-flag tables; add `ledger_add_project_comment` to agent 2 in the allocation table (L487) and its rationale paragraph; update the shared-partial inventory for the deleted stub (narrowly — only the `incident-logging.md` reference; the table's broader pre-existing staleness is out of scope); correct the `default_cc_tools` claims at L151, L152, L197, L213, L406, L433.
- `personas/docs/agents/project-manifest/variables.md` — document the new fields; correct `default_cc_tools` at L85, L86, L93.
- `personas/docs/agents/project-manifest/constraints.md` — correct constraint 10 (L84) to describe `cc_tools:` → `tools:`.
- `personas/docs/agents/project-manifest/data-flows.md` — correct the `cc_tools_json` derivation comment (L148).
- `personas/docs/persona-build-system.md` — correct `default_cc_tools` at L269, L284, L323, L418.
- `docs/references/insights-sidecar-reference.md` — explicitly re-affirm the checkpoint-slotted exemption at L336–337.
- `.gitignore` — add `/docs/agents/**/ax-feedback.md` and `/docs/agents/ax/`, with a comment stating the sidecar is a user working note, not a repository artefact.
- `personas/changelog.md` — suite entry summarizing the rollout (summary-only per the workspace changelog convention).
- `docs/agents-overview.md` — regenerate via `node scripts/generate-agents-overview.js` after version bumps.
- `.context/` and `CLAUDE.md` — regenerate via `node scripts/cli.js ctx-generate`.
- `ai-persona-builder/CHANGELOG.md` — entry for the fence-aware post-processor fix.
- `ai-persona-builder/docs/agents/project-manifest/` — update `api-surface.md` and/or `data-flows.md` if the post-processor's documented behaviour changes.
- `mcp-server/changelog.md` — entry for the `AddProjectCommentSchema.type` `.describe()` text update (adds `"ax"` to the enumerated values agents read).
- Root `changelog.md` — release entry referencing module versions (`> mcp vX · personas vY`), written after the module changelogs per the two-step workflow.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Centralized AX storage and aggregation for Group C sidecar files | Spec — Out of Scope | Consumption is human-in-the-loop by design; no evidence yet that manual reading is insufficient | Revisit if users report that friction recorded in sidecars is never acted on. Would define its own machine-readable format. |
| 2 | Grant `todo` to `ledger-claude-coordinator` | Spec — Explicitly Changed table | The grant existed only to serve the dropped todo-list sink; any remaining merit is on its own dispatch-loop grounds | A separate, optional change with an independent rationale. |
| 3 | Promote AX Feedback from Recommended to Required in the Design Guide | Spec — Explicitly Changed table | Marking it Required binds every future persona to a mechanism with no measured benefit yet | Reconsider once AX feedback has demonstrably driven persona improvements. |
| 4 | Extend AX Feedback to ledger agent 1 (Planner) with a persistence channel | This plan — new finding | No ledger exists at Planner handoff time; nothing to write to | Would require a pre-ledger store, which is a separate architectural question. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **AX Feedback re-acquires a capture sink during implementation**, restoring the Pattern 6 breach this plan exists to remove | AC-01 asserts the partial contains no append-during-work instruction, enforced by an automated test (`ax-partial-invariants.test.js`), not a review pass. The plan states explicitly that AX is checkpoint-slotted by design. |
| **Deleting the wrong `incident-logging.md`**, breaking the live ledger MCP channel for 6 personas | AC-02 and AC-03 reference both full paths separately and assert the consumer count. A bare grep is explicitly declared invalid as a check. |
| **The `ax` project-comment type pollutes an existing consumer** | Step 15 audits all readers. Research confirms the only live reader (GUI card) is type-agnostic, and `GET /api/insights` is already removed (404), so the aggregation path is dead code. |
| **Group A's `ax` entries leak into the Code Insights section** | Steps 17–18 are mandatory and must land with step 16. AC-19 and AC-20 verify both the filter and the corrected sink-state classification. |
| **Group A's Code Insights output is silently thinned** by the added type | Stage 3's gate captures a pre-change baseline and compares. This is the plan's only non-structural quality detector — it must not be skipped. |
| **Cross-repo release sequencing stalls Stage 1** if the library publish is blocked | The partial-side fix (step 5) is deliberately independent of the library fix, so Stage 1's gate is satisfiable without waiting on publish-and-install. |
| **The `ai-persona-builder` version discrepancy** (`package.json` 2.5.1 vs `CHANGELOG.md` 2.6.1) produces a mis-versioned publish | Route the bump through the repo's `release-check` skill, which enforces version sync, rather than editing `package.json` by hand. |
| **The fence-aware post-processor fix breaks existing output** for the other 128 generated files | Existing tests at L86–95 are preserved (AC-21); AC-27's byte-identical `--check` comparison covers unrelated regressions across the whole build. |
| **Sidecar files committed or shipped** by `git-committer` / ledger `7-release-engineer` | Both patterns gitignored (step 23); an untracked file cannot be swept into a commit or release artefact. Both personas are additionally inline or ledger-targeted, never sidecar. |
| **A rung-1 ignore pattern that is too broad** also hides tracked plan-folder artefacts such as `insights.jsonl` | Filename-specific pattern only, mirroring the existing `audit.md` / `research-brief.md` entries. AC-14 verifies `insights.jsonl` remains tracked. |
| **Sidecar directories created inside third-party repositories** by curator personas pointed at external codebases | Two-rung ladder, plan folder first — the established pattern from `insight-capture.md` L7–8. |
| **The sidecar format gets over-engineered** for an aggregator that may never exist | The partial mandates prose for a human reader; any machine-readable format is deferred (Deferred Item 1). |
| **Step-numbering errors across ~48 insertion sites** | AC-17's automated ordinal-continuity and count-parity scans across all 129 generated files. No spot-checking. |
| **Design Guide update deferred and forgotten**, leaving new personas non-compliant | Stage 5 is part of this plan with its own acceptance criteria (AC-22, AC-23), not a follow-up. |
| **Removing `default_cc_tools` changes generated output** through an undiscovered read path | AC-27 requires a byte-identical `--check` diff. If the diff is non-empty, the read path exists and the removal is reverted while the docs fix stands. |
| **43 metadata files × 2 new fields invites copy-paste drift** | The build-time validator (step 10) lands before any bulk flag edit and rejects every invalid combination, so drift fails the build rather than shipping. |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The work spans two repositories and four persistence channels, adds metadata schema fields with a new build-time validator, touches the MCP project-comment surface and its consumers, and requires a staged rollout with an independent verification gate per stage — all of which benefit from formal QA, security, and review stages plus per-stage work-package tracking.
