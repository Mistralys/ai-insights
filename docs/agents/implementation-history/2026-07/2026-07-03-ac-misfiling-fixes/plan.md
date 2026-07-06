# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The repository's strategic vision emphasizes "Personas first" — all integrated tools
exist only to support the personas, and LLM-independent by design. This plan is fully
aligned: all five fixes are persona-source changes that improve agent instruction
quality. No MCP server code changes are proposed. The ledger workflow has matured over
103 tracked projects; this hardening pass addresses a systemic issue (acceptance criteria
misfiling) surfaced across multiple project executions and diagnosed in two independent
research reports.

## Summary
Fix the acceptance-criteria (AC) misfiling problem diagnosed in the
[synthesis report](../../research/2026-07-03-ac-misfiling-synthesis.md). Two independent
investigations identified five distinct issues causing AC to end up attached to the wrong
work package or to create phantom duplicate criteria. This plan addresses all five issues
(I1–I5) as persona-source changes — no MCP server code modifications required. The fixes
span three layers: materialization (Bootstrapper reorder + single-source transcription),
verification (content-level AC gate in the Bootstrapper and PM), and planning
(numbered plan AC with decomposer coverage table, plus verbatim-copy guidance for
Developer/QA agents).

## Architectural Context
The AC lifecycle flows through five persona sources and one MCP tool:

1. **Planner** (`personas/ledger/src/content/1-planner.md`) — authors plan-level AC as
   unstructured bullet list (`- {Criterion}`) in the plan template.
2. **WP Decomposer** (`personas/ledger-support/src/content/ledger-wp-decomposer.md`) —
   maps plan AC to per-WP numbered AC (`1. {Criterion}`) in
   `work-packages-draft.md`.
3. **Bootstrapper** (`personas/ledger-support/src/content/ledger-bootstrapper.md`) —
   creates `work/WP-{NUMBER}.md` spec files on disk, then registers WPs via
   `ledger_create_work_package` (passing both an `acceptance_criteria` array and a
   `work_package_file` path).
4. **PM** (`personas/ledger/src/content/2-project-manager.md`) — verifies ledger state
   and file existence in Steps 8–9, but currently performs no AC content verification.
5. **Developer/QA** — mark AC as met via `acceptance_criteria_updates` in
   `ledger_complete_pipeline`; the tool uses exact `===` matching
   (`mcp-server/src/tools/pipeline.ts` line 531) and silently appends unmatched criteria
   as new entries.

Key shared partials touched:
- `personas/shared/partials/developer-strict-constraints.md`
- `personas/shared/partials/qa-operational-protocol.md`
- `personas/shared/partials/pm-output-format.md`

## Approach / Architecture
All five fixes are persona-source-only changes following the Edit → Build → Sync
workflow defined in the personas manifest (`constraints.md` §C4). No MCP server code is
modified — the exact-match `===` behavior in `pipeline.ts` is intentional per
`edge-cases.md` §21.3 and is addressed through agent guidance rather than server-side
normalization.

The fixes are organized into three layers:

**Layer 1 — Materialization (Bootstrapper)**
- **I1:** Reorder the Bootstrapper protocol so WP spec files are created *after* ledger
  registration, named with the ledger-returned ID. This eliminates the rename step and
  the three-way numbering juggle (decomposer order → dependency order → auto-ID).
- **I3:** Instruct the Bootstrapper to derive the `acceptance_criteria` array by reading
  it back from the spec file it just wrote, rather than re-transcribing from the draft.

**Layer 2 — Verification (Bootstrapper + PM)**
- **I2:** Add a content-level AC verification gate in the Bootstrapper's Step 6 and the
  PM's Step 9. For each WP, call `ledger_get_work_package` and assert set-equality
  between the returned `acceptance_criteria` and the `## Acceptance Criteria` section
  of `work/{WP-ID}.md`. Use normalized comparison (trim + case-fold).

**Layer 3 — Planning + Runtime guidance**
- **I4:** Planner emits numbered AC (`- AC-{NN}: {Criterion}`). WP Decomposer gains a
  coverage table mapping each plan AC to its covering WP(s), plus a quality-checklist
  item ensuring every plan AC appears in the table.
- **I5:** Developer and QA personas gain explicit verbatim-copy guidance: copy criterion
  text from `ledger_get_work_package` output when populating
  `acceptance_criteria_updates`.

## Rationale
This approach was chosen because: (1) the synthesis report confirms all five issues are
persona-instruction gaps, not MCP server bugs — the exact-match `===` behavior is
intentional; (2) persona-only changes are the lowest-risk category in this workspace
(no runtime code, no schema changes, no migration); (3) shipping I2 alongside I1 provides
an immediate safety net — if the reorder doesn't fully eliminate cross-wiring, the
verification gate catches it; (4) all five fixes fit comfortably in a single session
because the total scope is approximately 7 file edits to Markdown templates with no
cascading code changes.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| AC matching strategy | Keep exact `===` + add verbatim-copy persona guidance (I5) | Normalize server-side (`trim` + case-fold the `===` match in `pipeline.ts`) | Server-side normalization changes intentional behavior per `edge-cases.md` §21.3; guidance achieves the same outcome without runtime risk. Server-side fix can follow as a separate decision if phantom criteria persist after I5. |
| I2 gate severity | Warning (not hard failure) | Hard failure (abort bootstrapping if AC mismatch) | Start with warning to measure false-positive rate; promote to hard failure once confidence is high. Avoids blocking the entire workflow on a detection heuristic that hasn't been field-tested. |
| I1 implementation | Reorder Steps 3↔4 (register first, create files second) | Keep current order + improve rename handling | Reordering eliminates the rename step entirely — simpler, fewer failure modes. The rename approach only reduces the symptom; the reorder removes the cause. |
| I4 AC numbering | `AC-{NN}:` prefix in plan template | Free-form (current) | Numbered AC provides a stable handle for cross-referencing in the coverage table and in decomposer output; free-form AC offers no anchoring for traceability. |

## Pattern Alignment
- **Edit → Build → Sync workflow** (`personas/docs/agents/project-manifest/constraints.md` §C4): All changes follow the prescribed source-edit path; no generated files are touched directly.
- **Persona content adds value tools cannot** (§C5): The verbatim-copy guidance (I5) and the AC verification gate (I2) address behavioral gaps that self-documenting tool descriptions do not cover.
- **Numbered workflow steps are immutable contracts** (§C5a): The Bootstrapper step reorder (I1) renumbers existing steps but preserves the total count and adds no new steps without corresponding protocol changes.
- **Cross-system dependency: persona YAML ↔ MCP tools** (`AGENTS.md` cross-system deps table): No new MCP tools or parameters are introduced — existing tool calls are resequenced and their outputs are used for verification.

## Detailed Steps

### Step 1 — Reorder Bootstrapper protocol (I1)

Modify `personas/ledger-support/src/content/ledger-bootstrapper.md`:

1. **Swap Steps 3 and 4.** The new order is:
   - **Step 3 — Register Work Packages in Ledger** (currently Step 4): Register each WP
     via `ledger_create_work_package` in dependency order. Capture the returned WP ID.
     The `acceptance_criteria` array is sourced from the WP draft definitions. The
     `work_package_file` is set to the *anticipated* path (`work/{RETURNED_ID}.md`) —
     the file does not exist yet at call time, but this is acceptable because the ledger
     stores the path as metadata, not as a file-existence assertion.
   - **Step 4 — Create WP Spec Files** (currently Step 3): For each registered WP, use
     the ledger-returned ID to name the file (`work/{WP-ID}.md`). This eliminates the
     rename step entirely — the file is created with the correct name from the start.

2. **Remove the "ID mismatch handling" block** from the old Step 4 (now Step 3). The
   reorder makes it obsolete — there is no filename to mismatch against because the file
   hasn't been created yet.

3. **Update the `work.md` creation** to occur in the new Step 4 (alongside spec files)
   rather than in the old Step 3, since WP IDs are now known.

### Step 2 — Single-source AC transcription (I3)

In the same file (`ledger-bootstrapper.md`), update the new Step 3 (Register WPs):

1. After registration, when creating the spec file in Step 4, instruct the Bootstrapper
   to write the `## Acceptance Criteria` section using the **same array it passed to
   `ledger_create_work_package`** — not by re-reading from the draft. This ensures the
   spec file and ledger entry contain identical text by construction.

2. Add a note: "The `acceptance_criteria` array passed to `ledger_create_work_package`
   and the `## Acceptance Criteria` section written to the spec file must be sourced from
   the same data — do not re-transcribe from the WP draft a second time."

### Step 3 — Add content-level AC verification gate (I2)

#### 3a — Bootstrapper verification (Step 6)

In `personas/ledger-support/src/content/ledger-bootstrapper.md`, enhance Step 6
(Verify the Ledger and Files):

1. Add a sub-step after the existing cross-check: "For each WP, call
   `ledger_get_work_package` and compare the returned `acceptance_criteria` array against
   the `## Acceptance Criteria` section of `work/{WP-ID}.md`. Use normalized comparison
   (trim whitespace, case-fold). If any criterion is present in one source but not the
   other, emit a **warning** in the initialization report (do not abort)."

2. Update the Step 7 report template to include an AC verification column or note.

#### 3b — PM verification (Step 9)

In `personas/ledger/src/content/2-project-manager.md`, enhance Step 9:

1. After the existing file-existence checks, add: "For each WP, call
   `ledger_get_work_package` and compare the returned `acceptance_criteria` array against
   the `## Acceptance Criteria` section of the matching `work/{WP-ID}.md` spec file. Use
   normalized comparison (trim whitespace, case-fold). If any mismatch is found, **fix it
   yourself** — update the spec file to match the ledger (the ledger is authoritative) —
   before handing off."

2. Add `ledger_get_work_package` to the PM's MCP tools table if not already present.

#### 3c — PM output format partial

In `personas/shared/partials/pm-output-format.md`, add to the "Verification" section:

1. Add: "Verify AC content fidelity: for each WP, confirm the `acceptance_criteria`
   returned by `ledger_get_work_package` matches the `## Acceptance Criteria` section
   of `work/{WP-ID}.md` (normalized comparison: trim + case-fold)."

### Step 4 — Numbered plan AC + decomposer coverage table (I4)

#### 4a — Planner template

In `personas/ledger/src/content/1-planner.md`, update the plan output template's
`## Acceptance Criteria` section:

1. Change the template from:
   ```
   ## Acceptance Criteria
   - {Criterion}
   ```
   to:
   ```
   ## Acceptance Criteria
   - AC-01: {Criterion}
   - AC-02: {Criterion}
   ```

2. Add a brief instruction above or below the template: "Number each acceptance criterion
   with an `AC-{NN}:` prefix (zero-padded, sequential). These IDs are stable handles used
   by the WP Decomposer to map plan-level criteria to work packages."

#### 4b — WP Decomposer coverage table

In `personas/ledger-support/src/content/ledger-wp-decomposer.md`:

1. Renumber the Decomposition Protocol steps: the current Step 2 (Identify WP
   Candidates) stays as Step 2. Insert a new **Step 3 — Map Plan AC to WPs** with the
   following content:

   "For each `AC-{NN}` in the plan's Acceptance Criteria section, identify which WP(s)
   will satisfy it. A plan AC may map to one or more WPs. Every plan AC must be covered
   by at least one WP."

   Renumber the current Step 3 (Write WP Definitions) to **Step 4**. Update all
   internal references (Quality Checklist, Workflow section) to use the new step
   numbers. Do not use fractional step numbers (e.g., "Step 2.5") — per §C5a, numbered
   workflow steps are immutable contracts and must use sequential integers.

2. Add a coverage table to the output template (appended after the WP definitions):

   ```markdown
   ## Plan AC Coverage

   | Plan AC | Covering WP(s) | WP AC Reference |
   |---------|----------------|-----------------|
   | AC-01   | WP-001         | AC 1            |
   | AC-02   | WP-002, WP-003 | AC 2, AC 1      |
   ```

3. Add a quality-checklist item after the existing "WP numbering is sequential and
   gap-free" item: "Every plan `AC-{NN}` appears in the Plan AC Coverage table with
   at least one covering WP."

### Step 5 — Verbatim-copy guidance for Developer/QA (I5)

#### 5a — Developer strict constraints

In `personas/shared/partials/developer-strict-constraints.md`, add a new bullet:

"**Verbatim AC Text:** When populating `acceptance_criteria_updates` in
`ledger_complete_pipeline`, copy each criterion string **verbatim** from the
`acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase,
abbreviate, or reformat — the ledger uses exact-match comparison, and paraphrased text
silently creates a duplicate criterion instead of updating the original."

#### 5b — QA operational protocol

In `personas/shared/partials/qa-operational-protocol.md`, add a new bullet after the
existing Verification Stack steps:

"**Verbatim AC Text:** When populating `acceptance_criteria_updates`, copy each criterion
string **verbatim** from the `acceptance_criteria` array returned by
`ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison,
and paraphrased text silently creates a duplicate criterion instead of updating the
original."

> **Rationale:** The verbatim-copy instruction is a behavioral constraint ("do not
> rephrase"), not output formatting guidance. Placing it in the Operational Protocol
> partial (alongside other execution-time behavioral rules) maintains structural parity
> with the Developer's constraint in `developer-strict-constraints.md`. The
> `qa-output-format.md` partial defines *what* the agent produces; constraints on *how*
> it populates tool parameters belong in the protocol.

### Step 6 — Build and verify persona output

1. Run `node scripts/build-personas.js` to regenerate all persona output.
2. Run `node scripts/build-personas.js --check` to confirm output is not stale.
3. Diff the generated output to verify only the intended changes are present.

## Dependencies
- No external dependencies. All changes are to persona source files within the workspace.
- Steps 1–2 modify the same file (`ledger-bootstrapper.md`) and should be implemented
  together.
- Step 3 depends on Step 1 (the verification gate references the reordered protocol).
- Steps 4 and 5 are independent of Steps 1–3 and of each other.

## Required Components
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — Steps 1, 2, 3a
- `personas/ledger-support/src/content/ledger-wp-decomposer.md` — Step 4b
- `personas/ledger/src/content/1-planner.md` — Step 4a
- `personas/ledger/src/content/2-project-manager.md` — Step 3b
- `personas/shared/partials/pm-output-format.md` — Step 3c
- `personas/shared/partials/developer-strict-constraints.md` — Step 5a
- `personas/shared/partials/qa-operational-protocol.md` — Step 5b
- `scripts/build-personas.js` — Step 6 (invoked, not modified)

## Assumptions
- The exact-match `===` behavior in `mcp-server/src/tools/pipeline.ts` is intentional
  per `edge-cases.md` §21.3 and will not be modified in this plan.
- The `work_package_file` parameter in `ledger_create_work_package` is stored as metadata
  and does not require the file to exist at call time.
- The Bootstrapper's Step 6 verification calls `ledger_get_work_package` per WP, which
  is already listed in its MCP tools table.
- The PM persona already has access to `ledger_get_work_package` via its MCP tools.

## Constraints
- All edits must be to source files under `personas/*/src/` or `personas/shared/partials/`
  — never to generated output directories.
- All persona content changes must follow the
  [Persona Design Guide](../../../../../../personas/docs/persona-design-guide.md)
  (`personas/docs/persona-design-guide.md`) — the authoritative reference for structure,
  tone, and conventions in persona authoring.
- Persona content must follow the "adds value tools cannot provide" principle (§C5) —
  the verbatim-copy and verification instructions address behavioral gaps, not tool
  parameter documentation.
- Bootstrapper step reorder must not change the total step count or leave any step
  without corresponding protocol content (§C5a).

## Out of Scope
- Server-side AC matching normalization (`pipeline.ts` `===` → normalized comparison).
  This is flagged as a separate design decision per the synthesis report's open questions.
- Hard-failure mode for the I2 verification gate. Start with warnings; promote to hard
  failure after field-testing.
- Changes to the MCP server's `ledger_create_work_package` tool (e.g., adding server-side
  reconciliation between the `acceptance_criteria` array and the spec file AC section).
- Orchestrator-specific changes — the synthesis confirms both IDE and orchestrator paths
  share the same persona sources, so persona-only fixes apply to both.

## Acceptance Criteria
- AC-01: The Bootstrapper protocol registers WPs in the ledger *before* creating spec
  files on disk, and spec files are named using the ledger-returned WP ID (no rename
  step exists).
- AC-02: The Bootstrapper's verification step (Step 6) compares ledger AC against spec
  file AC using normalized text comparison and emits warnings on mismatch.
- AC-03: The PM's verification step (Step 9) compares ledger AC against spec file AC and
  fixes mismatches before handoff.
- AC-04: The Planner's plan template uses numbered AC format (`AC-{NN}: {Criterion}`).
- AC-05: The WP Decomposer outputs a `## Plan AC Coverage` table mapping each plan AC
  to covering WP(s), with a quality-checklist item enforcing full coverage.
- AC-06: The Developer strict-constraints partial includes verbatim-copy guidance for
  `acceptance_criteria_updates`.
- AC-07: The QA output-format partial includes verbatim-copy guidance for
  `acceptance_criteria_updates`.
- AC-08: `node scripts/build-personas.js --check` passes after all edits (generated
  output is fresh).

## Testing Strategy
This plan modifies persona template content (Markdown), not executable code. Testing is
verification-based: confirm the generated persona output contains the intended
instructions by running the build system and inspecting the output diffs. No unit tests
are added or modified because there is no runtime code change.

## Test Plan
- Build verification — run `node scripts/build-personas.js` and confirm clean build
  with no errors — covers AC-08.
- Freshness check — run `node scripts/build-personas.js --check` and confirm exit
  code 0 — covers AC-08.
- Manual diff review of generated output for each modified persona to confirm the
  intended instructions are present and correctly rendered — covers AC-01 through AC-07.

## Documentation Updates
- `personas/docs/agents/project-manifest/constraints.md` — no changes needed (no new
  constraints introduced; existing Edit → Build → Sync workflow is followed).
- `personas/docs/agents/project-manifest/api-surface.md` — no changes needed (no new
  metadata fields, feature flags, or template variables introduced).
- `personas/docs/agents/project-manifest/data-flows.md` — no changes needed (the
  Bootstrapper's protocol order is internal to the persona content, not a build-system
  data flow).
- No changelog entry is produced by this plan — changelogs are written by the
  Documentation pipeline stage of the owning WP per the workspace convention.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Bootstrapper reorder breaks `work_package_file` validation** — the ledger might reject a `work_package_file` path pointing to a file that doesn't exist yet. | The `ledger_create_work_package` tool stores the path as metadata; it does not perform file-existence validation. Verify this assumption in Step 1 implementation. |
| **I2 verification gate produces false positives** — normalized comparison (trim + case-fold) may not handle all formatting variants (e.g., Markdown list markers, leading numbers). | Start with warning severity, not hard failure. The PM step fixes mismatches rather than aborting, providing a self-healing fallback. |
| **I4 numbered AC format (`AC-{NN}:`) is ignored by Planner agents** — if the LLM doesn't follow the template, the coverage table has nothing to anchor to. | The numbered format is a clear, unambiguous template pattern; LLM compliance with numbered templates is high. The coverage table's quality-checklist item provides a second enforcement point. |
| **Step reorder invalidates existing Bootstrapper session context for in-flight projects** | This plan only changes the persona source — existing in-flight sessions use the persona text loaded at session start and are unaffected. New sessions pick up the updated protocol. |
