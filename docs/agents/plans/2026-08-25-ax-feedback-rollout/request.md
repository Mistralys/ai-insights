# Spec — AX Feedback Rollout (Revised)

**Date:** 2026-08-25
**Status:** Spec — ready for planning
**Audience:** Planner, then Persona Curator

---

## Purpose

Roll out the AX (Agent Experience) Feedback mechanism to all eligible personas across the three
suites, with per-group persistence, without creating a second continuous observation duty on any
persona.

This spec exists because the superseded plan drifted: it began as a pure end-of-task reporting step
and grew an incremental capture sink (its defect "D3"), which silently converted AX Feedback from a
checkpoint duty into a continuous side-channel. That conversion violated Persona Design Guide
Pattern 6's one-side-channel-per-persona cap on the 7 personas that already run an insight sink, and
invalidated a documented invariant in the insights-sidecar subsystem. This spec resolves the conflict
by giving AX Feedback a persistence channel per group instead of a capture sink.

---

## Background

The proof-of-concept (2026-07-23, `2026-07-23-agent-experience-feedback`) shipped
`personas/shared/partials/ax-feedback.md` and wired it into 5 personas: ledger Developer and
Synthesis; standalone Developer, README Curator, and Changelog Curator. It works, and it is a pure
checkpoint duty: one output slot, fires once at handoff, zero mid-session footprint.

38 personas do not yet include it.

---

## Corrected Findings — Read Before Planning

The superseded plan contains four factual errors. Each was verified against the codebase on
2026-08-25.

### F1 — There are two `incident-logging.md` files, and the live one is the MCP version

| File | Content | Status |
|---|---|---|
| `personas/shared/partials/incident-logging.md` | Prose only: "note it clearly in your response and describe any workaround" | **Dead** — see F2 |
| `personas/ledger/src/partials/incident-logging.md` | Calls `ledger_add_project_comment` with `type: "incident"` and a `context` object (`os`, `tool`, `work_package`, `resolved`, `workaround`) | **Live** for all 6 ledger consumers |

Same-named entries in `personas/<suite>/src/partials/` silently shadow their `shared/` counterpart
(personas manifest, `constraints.md` §"Override layer"). All 6 ledger consumers of
`{{> incident-logging}}` therefore resolve to the MCP version.

**Consequence:** ledger incidents already persist to project comments with a structured context
object. The superseded plan's Step 5 ("fold non-blocking reporting into AX Feedback, route blocking
residue to the handoff") would have replaced a working structured MCP channel with prose. Do not do
this. Instead, AX Feedback for ledger personas **extends the same channel** — see Group B below.

### F2 — The shared `incident-logging.md` is orphaned dead code

The only shared partials that referenced `{{> incident-logging}}` were
`developer-strict-constraints.md` and `docs-operational-protocol.md`, both deleted in August 2025
when their content was inlined into ledger content templates. No standalone or ledger-support persona
references the partial. The shared file's sole purpose was to stop the standalone build emitting a
`[WARN]` for a partial that only existed in the ledger override layer — a purpose that no longer
applies.

**Action:** delete `personas/shared/partials/incident-logging.md`. **Keep**
`personas/ledger/src/partials/incident-logging.md`.

The superseded plan's AC-15 ("grep `personas/` for `incident-logging` — zero matches") is therefore
wrong and would fail. Any acceptance criterion must distinguish the two files by path.

### F3 — The `has_incident_logging` flag has wider surface than the plan states

| Location | State |
|---|---|
| `personas/ledger/src/meta/*.yaml` | Present in **all 9** ledger personas — `true` on 3–8, `false` on 1, 2, 9 |
| `personas/ledger/src/content/*.md` | `{{#if has_incident_logging}}` guard on 4-qa, 5-security-auditor, 6-reviewer, 7-release-engineer, 8-documentation. `3-developer.md` L158 is **unconditional** (correctly noted by the old plan) |
| `personas/docs/agents/project-manifest/api-surface.md` L218, `variables.md` L51 | Documented as **required** (`yes`) |
| `personas/docs/persona-build-system.md` L328, L357 | Documented with example |

This spec does **not** remove the flag — the partial it guards stays. No change needed here. Recorded
so the planner does not inherit the old plan's removal step.

### F4 — `ledger_add_observation` is the wrong channel for AX friction

`AddObservationSchema` (`mcp-server/src/tools/observations.ts` L18–34) requires `work_package_id` and
`pipeline_type`, and writes a **pipeline comment on a work package**. AX friction ("the handoff data
was ambiguous", "the terminal tool dropped output") is not a property of that WP's code. Filing it
there also routes it into Synthesis's Code Insights section, which
`personas/ledger/src/content/9-synthesis.md` L71 defines as exactly "observations recorded via
`ledger_add_observation`".

`ledger_add_project_comment` is the correct channel: project-scoped, carries an explicit `agent`
field, free-form `type`, optional structured `context`
(`ProjectCommentSchema`, `mcp-server/src/schema/root-index.ts` L23–31). It is already granted to
ledger agents 3–9 and already surfaced in the GUI's "Project Comments" card
(`mcp-server/gui/public/views/project-detail.js` L777).

---

## Confirmed Design Decisions

1. **Ledger personas persist AX Feedback via `ledger_add_project_comment`**, not
   `ledger_add_observation`.
2. **AX Feedback remains a pure checkpoint duty** on every persona except where an insight sink
   already exists and is widened (see the Open Decision).
3. **The AX sidecar file is written only when there is friction.** Zero-friction sessions leave no
   artifact.
4. **The sidecar path uses a two-rung ladder**, modeled on `insight-capture.md`.
5. **An `ax_feedback` YAML flag gates inclusion**, so personas that must not emit the block can be
   excluded and the rollout is reversible at the metadata layer.
6. **The sidecar's consumer is the user, and the files are gitignored by default.** Group C personas
   are predominantly invoked manually, so the human in the loop reads the file in the session that
   produced it. No programmatic aggregation is built, and none is needed for the mechanism to pay
   off. Centralizing AX storage for these personas is a separate project, to be planned only if
   manual consumption proves insufficient.

---

## Open Decision — Sink widening for the 2 standalone insight personas

Only two personas run the JSONL insight sink: standalone `developer` and `web-gui-specialist` (via
`{{> insight-capture}}` + `{{> insight-compilation}}`). The 5 ledger insight personas use MCP
observations and are handled by Group B, so no sink widening applies to them.

| Option | Shape | Cost |
|---|---|---|
| **A (recommended)** | Add an `ax` type to these two personas' existing `insights.jsonl` sink, **in addition to** the checkpoint slot | 3 follow-through edits (below) |
| **B** | Leave both checkpoint-only, like every other non-ledger persona | Zero extra edits; handoff-time recall only |

Option A does not create a second side-channel — it widens the type vocabulary of a sink the persona
already opens, marks, and appends to at every gate. These are also the longest-session personas in
the standalone suite, where recall is weakest.

Keep the checkpoint slot in **either** case: the sink gate is "after each file edit / test run", but
much AX friction (ambiguous handoff data, missing context, a confusing instruction) is not tied to any
file edit and would never fire a gate.

**If Option A is chosen, these three edits are mandatory or the change leaks:**

1. `personas/shared/partials/insight-compilation.md` compiles *every* sink entry into
   `{{insight_report_target}}` (= "the **Code Insights** section of `synthesis.md`"). Add a type
   filter so `ax` entries route to an AX Feedback section instead.
2. The same partial's sink-state forcing table treats "marker present + any entries" as "capture ran
   and produced material". An AX-only sink would falsely read as a clean code result. The table must
   count **non-`ax`** entries.
3. Each persona's Scope & Boundaries table (the `3-developer.md` L85 pattern) declares a code-only
   territory. An `ax` type contradicts it unless a row is added.

**If Option B is chosen,** none of the above applies and no existing sink is touched at all.

---

## Architecture — Four Groups

| Group | Personas | Capture | Persistence |
|---|---|---|---|
| **A** — standalone insight personas | `developer`, `web-gui-specialist` | Checkpoint slot (+ `ax` sink type if Option A) | AX Feedback section in `synthesis.md` |
| **B** — ledger suite | agents 1–9 | Checkpoint slot only | `ledger_add_project_comment`, `type: "ax"` |
| **C** — flag-enabled personas with `edit` | remaining standalone + ledger-support | Checkpoint slot only | AX sidecar file, friction-only, two-rung ladder |
| **D** — no `edit`, or user-facing | see below | Checkpoint slot only, or flag off | Inline in response only |

Every group carries **at most one** continuous observation duty. Pattern 6's cap holds throughout.

### Group B — ledger detail

AX Feedback reuses the channel `incident-logging` already uses, with a distinct `type`:

| Reporting need | Channel | `type` |
|---|---|---|
| System-level incident (existing behavior, unchanged) | `ledger_add_project_comment` | `incident` |
| Session friction — instructions, context, handoff data, tooling ergonomics | `ledger_add_project_comment` | `ax` |
| Code observations (existing behavior, unchanged) | `ledger_add_observation` | code types |

`ProjectCommentSchema.type` is `z.string()`, so `"ax"` needs no schema change. `agent` is already
required, which gives per-agent attribution for free.

The two duties do not overlap: `incident-logging` fires on a **system malfunction**, AX Feedback fires
at the **handoff checkpoint** and covers design friction. Keep both. State the boundary explicitly in
the AX partial so the agent does not arbitrate.

Ledger personas therefore need **no** sidecar file — the ledger is their store. This also keeps AX
Feedback out of the orchestrator's `stage_result` plumbing, which does not parse it
(`orchestrator/src/nodes/__init__.py` L1005 passes the final message through verbatim).

### Group D — exclusions

**Lack `edit` deliberately — sidecar write is impossible, keep inline-only:**

| Persona | Reason the omission is deliberate |
|---|---|
| `ledger-knowledge-curator` | Constraint: "never modify, create, or delete project files" |
| `ledger-orchestrator-archaeologist` | Forensic analysis, not remediation |
| `recipe-curator` | Chat output only |
| `git-committer` | Stages and commits rather than authors |

**Git hygiene — resolved by gitignoring the sidecar:**

AX sidecar files are gitignored by default, which removes the exposure for `git-committer` and ledger
`7-release-engineer` — both act on the working tree, and an untracked file cannot be swept into a
commit or a release artifact. Neither persona needs a suppression flag on this account.

Two ignore patterns are needed, one per rung: `docs/agents/ax/` for rung 2, and the sidecar filename
for rung 1 (which lands inside a plan folder that *is* normally tracked). Confirm the rung-1 pattern
does not also hide `insights.jsonl` or other plan-folder artefacts that are meant to be committed.

**User-facing output personas — flag off entirely:**

An "AX Feedback" block appended to a recipe or a stakeholder brief is wrong output.

| Persona | Reason |
|---|---|
| `recipe-curator` | Output is a recipe for a human reader |
| `comms-curator` | Output is audience-facing prose |

Any further exclusion requires a rationale **in the persona's content** that covers AX Feedback
specifically. A YAML comment restating a diff, or a constraint scoped to a different tool namespace,
does not qualify — both traps were found in the superseded plan's research (see its Step 0a notes on
`module-intent-architect` and `ledger-claude-coordinator`).

---

## The `ax_feedback` Flag

The superseded plan rejected this flag as "complexity without a current consumer". It has three
consumers:

1. Excluding Group D personas.
2. Selecting the persistence channel per group.
3. Rollback. Without it, reversing the rollout means re-editing ~48 insertion sites in content
   templates.

**Proposed metadata:**

| Field | Type | Default | Purpose |
|---|---|---|---|
| `ax_feedback` | `bool` | — (explicit per persona) | Include the AX Feedback checkpoint step |
| `ax_feedback_target` | `enum` | — | `ledger` \| `synthesis` \| `sidecar` \| `inline` — selects the persistence channel |

A third `ax_feedback_sidecar` boolean was considered for suppressing the file write on git-sensitive
personas. It is **not needed**: gitignoring the sidecar removes the exposure it was meant to guard,
and `inline` already covers the personas that cannot write files at all. Two fields, not three.

Exact field set is a planning decision; the requirement is that group membership is declared in
metadata, not inferred inside the partial. Follow the `has_incident_logging` precedent for flag shape
and document the new fields in `api-surface.md` and `variables.md`.

---

## AX Sidecar File Spec (Group C)

**Two-rung ladder**, mirroring `personas/shared/partials/insight-capture.md`:

1. Plan folder present (`plan.md` in the working folder, or a plan folder path supplied):
   `{plan folder}/ax-feedback.md`
2. Otherwise: `docs/agents/ax/{YYYY-MM-DD-HHmm}-{slug}.md` relative to the repository root; create the
   directory if absent.

Rung 1 matters more than it looks: a flat repo-relative path would make README Curator, AGENTS.md
Curator, and CTX Architect create AI-Insights bookkeeping directories inside whatever third-party
repository they are pointed at.

**Consumption model — human in the loop.** The reader is the user, in or shortly after the session
that produced the file. Group C personas are predominantly invoked manually, so the feedback reaches
a human without any collection machinery. Two consequences for authoring:

- **The files are gitignored** (see Group D → Git hygiene). They are working notes for the user, not
  repository artefacts.
- **Write for a human reader, not a parser.** No machine-readable schema, no stable field ordering, no
  JSONL. Prose with the agent name, version, and timestamp is sufficient. Do not design the format
  around a hypothetical future aggregator — if centralized AX storage is ever built, it is a separate
  project and can define its own format then.

**Rules:**

- **Write only when there is friction.** No file on a zero-friction session.
- **The inline block is always emitted**, friction or not. It is the forcing function — it is what
  makes a skipped duty visible. The file is persistence, not the report.
- **Append, never overwrite.** Sub-agent chains mean several agents can share one session.
- **Record the agent name and version** in each entry — attribution is the whole point for persona
  refinement.
- **Failure is non-blocking.** If the write fails, the inline block still stands. The sidecar must
  never gate the primary task.

---

## Carry Forward Unchanged From the Superseded Plan

These items were correct and carry no side-channel risk. Reuse the old plan's analysis directly.

- **D1 — heading level.** `ax-feedback.md` opens with an `## AX Feedback` H2 that, rendered inside
  `## Workflow`, terminates the Workflow section and orphans the handoff step. Multi-mode personas
  render several identical H2s. Fix to a bolded label or `###`. The H2 *inside the fenced template
  block* is the literal output format and stays.
- **D2 — fenced-block mangling.** The build system's separator handling injects blank lines around the
  `---` inside the fenced template, so the agent is shown a template that does not match source.
  Prefer a partial-side fix; absorb a build-system fix into the same step if unavoidable.
- **Sub-agent propagation rule.** Ten personas dispatch via `runSubagent` / `Task`. Without a rule,
  sub-agent AX blocks nest and duplicate as they bubble up. The parent does not re-emit a sub-agent's
  block verbatim; it may merge a genuinely distinct item, attributed, counting against the 3-bullet
  cap.
- **"Most sessions are expected to have zero friction."** Retain verbatim — anti-confabulation guard.
- **Insertion mechanics.** The numbered-step pattern, the per-mode insertion for the 7 multi-mode
  personas, the single insertion for the two-STATUS-variant personas (`plan-refiner`, `ledger-doctor`),
  and the unnumbered block for the 3 shared-`## Handoff` personas. The old plan's per-file tables of
  handoff line numbers and step ordinals are usable as-is, minus the Group D exclusions.
- **Mechanical verification.** Per-file count audit (inclusions vs. steps vs. handoffs), ordinal
  continuity scan, structural regression scan for `##` between `## Workflow` and the handoff. 114
  generated files cannot be spot-checked.
- **Step 0 is blocking.** Fix and verify the partial against the 5 proof-of-concept personas before
  any rollout edit. Every unfixed defect is multiplied by the insertion count.

---

## Explicitly Changed vs. the Superseded Plan

| Old plan | This spec | Why |
|---|---|---|
| D3: add an incremental capture sink to the partial | **Dropped.** AX Feedback stays a checkpoint duty | The sink converted AX into a continuous side-channel, breaching Pattern 6's one-per-persona cap on 7 personas and threatening to thin the code-observation sinks that already have a consumer |
| Sink medium = the agent's todo list | **Dropped** with D3 | The todo list is a user-facing planning surface, replaced wholesale on every write. Friction notes become pseudo-tasks and can be silently dropped |
| Step 0a: grant `todo` to 11 personas, `TodoRead`/`TodoWrite` to 4 | **Dropped** — no longer needed | The grants existed solely to enable the todo sink. `ledger-claude-coordinator` may still merit `todo` on its own dispatch-loop merits — a separate, optional change |
| Step 5: fold `incident-logging` into AX Feedback, delete the partial | **Dropped.** Keep the ledger override; delete only the orphaned shared stub | F1/F2 — the live partial is a structured MCP channel, not prose. AX extends it rather than replacing it |
| Remove the `has_incident_logging` flag | **Dropped** | F3 — the partial it guards stays |
| Step 6a: register AX Feedback as a **Required** section in the Design Guide | **Recommended**, not Required, until a consumer exists | Marking it Required permanently binds every future persona to a mechanism with no measured benefit. Downgrade avoids the lock-in while still making the element discoverable |
| No `ax_feedback` opt-out flag | Flag is **required** | It is the group selector, the Group D exclusion mechanism, and the rollback |
| All 38 personas in one sweep | **Stage it** — see Rollout Staging | The insertion is mechanical, but the interaction with existing insight sinks and the ledger channel is not |
| Patch bumps for 33, minor for 5 | Re-derive after group assignment | Group membership and flag additions change which personas take which bump |

---

## Rollout Staging

The superseded plan rejected batching because the change is "mechanical and identical for each
persona". True for the insertion; false for the persistence wiring, which differs per group.

| Stage | Scope | Gate before proceeding |
|---|---|---|
| 1 | Partial fix (D1, D2, propagation rule) + flag plumbing; re-verify the 5 proof-of-concept personas | Generated output correct; no regression in the 5 |
| 2 | Group B (ledger, 9 personas) — project-comment persistence | `type: "ax"` comments appear in the ledger and render in the GUI Project Comments card |
| 3 | Group A (2 personas) — synthesis section, plus the 3 sink edits if Option A | Code Insights section still populated correctly and not polluted by `ax` entries |
| 4 | Group C (remaining flag-enabled personas) — sidecar | Sidecar written only on friction, correct rung chosen, both ignore patterns effective (`git status` clean after a friction session on each rung) |
| 5 | Group D flag-off, Design Guide + Persona Curator registration, overview regeneration, suite changelog | Build clean, `generate-agents-overview.js --check` clean |

---

## Out of Scope

- **Centralized AX storage and aggregation for Group C.** The sidecar's consumer is the user, reading
  the file in the session that produced it. If manual consumption proves insufficient, collecting and
  aggregating those files is a separate project with its own format decisions. Do not pre-build for
  it. Groups A and B already land in stores with existing readers (`synthesis.md`, the ledger GUI's
  Project Comments card), so no aggregation work is needed there either.
- **Partial content redesign.** Category taxonomy, the 3-bullet cap, and the severity scheme stay as
  shipped.
- **Tiering by persona complexity.** One tier, as validated by the proof-of-concept.
- **Granting `edit` to any persona.** All four omissions are deliberate.
- **Orchestrator changes.** `stage_result` passes the final message through verbatim; no parsing of
  the AX block is added.

---

## Risks

| Risk | Mitigation |
|---|---|
| **AX Feedback re-acquires a capture sink during implementation**, restoring the Pattern 6 breach this spec exists to remove | State in the plan that AX Feedback is checkpoint-slotted by design. Add an acceptance criterion asserting no persona carries two continuous observation duties, and that the `ax-feedback` partial contains no append-during-work instruction |
| **The `ax` project-comment type pollutes an existing consumer** | Audit readers of `project_comments` before wiring: the GUI Project Comments card, Synthesis's aggregation, `ledger-doctor`'s audit trail. Confirm each either handles or ignores an unknown type |
| **Deleting the wrong `incident-logging.md`** and breaking the live ledger MCP channel | Acceptance criteria must reference both paths explicitly. A bare grep for `incident-logging` is not a valid check (F2) |
| **Sidecar files committed or shipped** by `git-committer` / `7-release-engineer` | Gitignored by default — an untracked file cannot be swept into a commit or a release artefact. Verify both ignore patterns (rung 1 and rung 2) during Stage 4 |
| **A rung-1 ignore pattern that is too broad** also hides tracked plan-folder artefacts such as `insights.jsonl` | Match the sidecar filename specifically, not a wildcard. Stage 4's gate checks `git status` after a friction session on each rung |
| **Sidecar directories created inside third-party repositories** by curator personas pointed at external codebases | Two-rung ladder, plan folder first |
| **The sidecar format gets over-engineered** for an aggregator that may never exist | Consumption is human-in-the-loop by design. The spec mandates prose for a human reader and defers any machine-readable format to the separate centralization project |
| **No baseline to detect quality regression.** All verification is structural — counts, ordinals, greps. Nothing measures whether primary-task quality or the existing insight sinks degrade | Staged rollout with a gate per stage. Stage 3's gate specifically checks that Code Insights output did not thin |
| **Step numbering errors across the insertions** | Mechanical count audit and ordinal continuity scan, not spot-checks |
| **Design Guide update deferred and forgotten**, leaving new personas non-compliant | Stage 5 is part of the plan, not a follow-up |

---

## Acceptance Criteria — Sketch

The planner should expand these; they are the ones that specifically guard this spec's corrections.

- No persona carries more than one continuous observation duty. The `ax-feedback` partial contains no
  instruction to append during work.
- `personas/ledger/src/partials/incident-logging.md` still exists and is still referenced by its 6
  consumers. `personas/shared/partials/incident-logging.md` is deleted.
- `has_incident_logging` is unchanged in all 9 ledger metadata files and in the manifest docs.
- No persona records AX friction via `ledger_add_observation`.
- Ledger AX feedback appears as `project_comments` entries with `type: "ax"` and a populated `agent`
  field.
- Every persona's group membership is declared in metadata; no group inference inside the partial.
- Group D personas emit no AX block, or emit it inline with no file write.
- No sidecar file exists after a zero-friction session.
- After a friction session on either rung, `git status` is clean — both ignore patterns are effective,
  and neither hides a tracked plan-folder artefact such as `insights.jsonl`.
- In every generated file, `## Workflow` runs unbroken from its heading to the handoff step.
- The rendered fenced template block is byte-identical to the partial source.
- `node scripts/build-personas.js` clean; `node scripts/generate-agents-overview.js --check` clean.

---

## Documentation Updates

- `personas/docs/persona-design-guide.md` — register AX Feedback as a **Recommended** section; extend
  Pattern 6 with AX Feedback as a worked example of a duty deliberately kept checkpoint-slotted
  *instead of* being given a sink. Bump version and add a changelog line.
- `personas/standalone/src/content/persona-curator.md` — matching Quality Checklist item.
- `personas/docs/agents/project-manifest/api-surface.md`, `variables.md` — document the new
  `ax_feedback*` fields; update the shared-partial inventory for the deleted shared stub.
- `docs/references/insights-sidecar-reference.md` L337 — its Curator Verification Checklist asserts
  "checkpoint-slotted partials (e.g., `ax-feedback`) do not count" toward the one-side-channel cap.
  This spec keeps that true. Re-affirm it explicitly rather than leaving it incidental.
- **Pre-existing documentation bug, inherited from the superseded plan's research:**
  `api-surface.md`, `data-flows.md`, `constraints.md`, and `variables.md` describe
  `default_cc_tools` as a live fallback in a `cc_tools → default_cc_tools → tools` chain. No such
  mechanism exists in `@mistralys/persona-builder` — the real chain is `cc_tools:` → `tools:`
  directly. It was real until the 2026-03-26 migration (commit `65b78cb5`) dropped it without the
  replacement library implementing an equivalent. Fix all four documents. This is independent of the
  AX rollout but the research is already done, so it should not be deferred again.
- `.gitignore` — add both AX sidecar patterns (rung 1 filename, rung 2 directory). Note in the file
  why they are ignored: the sidecar is a working note for the user, not a repository artefact.
- `personas/changelog.md` — suite entry.
- `docs/agents-overview.md` — regenerate after version bumps.
- `.context/` — regenerate via `node scripts/cli.js ctx-generate`.

---

## Recommended Workflow

**Ledger workflow.** The superseded plan chose standalone on the grounds that it was a single-concern,
source-only change. That no longer holds: this spec spans four persistence channels, adds metadata
schema fields, touches the MCP project-comment surface and its consumers, and requires a staged
rollout with a gate per stage. The per-group work is separable and benefits from independent
verification.
