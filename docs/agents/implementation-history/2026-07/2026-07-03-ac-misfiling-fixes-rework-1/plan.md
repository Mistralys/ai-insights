# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The immediately preceding project `2026-07-03-ac-misfiling-fixes` resolved five root-cause acceptance-criteria misfiling issues (I1–I5) across three lifecycle layers — materialization, verification, and planning. Its synthesis identified six follow-up items, two of which are actionable in this rework cycle. The strategic vision emphasizes "Personas first" — all tooling exists to support the personas — which validates the persona-source-only scope of this rework.

## Summary
This rework plan addresses four actionable items from the `2026-07-03-ac-misfiling-fixes` synthesis:

1. **Extend Verbatim AC Text guidance to all remaining pipeline-completing personas.** The original fix (WP-002) added verbatim-copy guidance to Developer and QA personas only, but four additional personas — Documentation, Reviewer, Security Auditor, and Release Engineer — also call `ledger_complete_pipeline` with `acceptance_criteria_updates` and lack this guidance.

2. **Fix the stale persona count in `personas/README.md`.** The README references "48 AI agent persona files" and describes only two suites with outdated counts. The actual build output is 40 personas across 3 suites × 3 targets = 120 generated files.

3. **Derive `PERSONA_FILES` from the filesystem instead of a hardcoded list.** The `scripts/build-personas.js` name-mapping block uses a hardcoded 9-element array that must stay manually in sync with `shared/workflow-manifest.json`. Replacing it with a directory scan of `personas/ledger/src/meta/` eliminates this coupling entirely.

A fifth synthesis item — template annotation style in `1-planner.md` — was investigated and found to be a non-issue: the AC-{NN} instruction is inside the fenced code block, but so are all other template annotations (`{Optional — omit…}` at L82, L150). There is no inconsistency to fix.

## Architectural Context
The verbatim AC guidance lives in shared partials at `personas/shared/partials/`, which are included by persona templates via the `{{> partial-name}}` syntax. Each agent role that calls `ledger_complete_pipeline` has its own operational protocol partial:

| Agent | Operational Protocol Partial | Has Guidance? |
|-------|------------------------------|---------------|
| Developer | `developer-strict-constraints.md` (L12) | ✅ Yes |
| QA | `qa-operational-protocol.md` (L9, item #5) | ✅ Yes |
| Security Auditor | `security-auditor-operational-protocol.md` | ❌ No |
| Reviewer | `reviewer-operational-protocol.md` | ❌ No |
| Release Engineer | `release-engineer-operational-protocol.md` | ❌ No |
| Documentation | `docs-operational-protocol.md` | ❌ No |

The `personas/README.md` file is a standalone user-facing document describing the personas build system. It has not been updated since the ledger-support suite and deep-agents target were added.

The name-mapping generation block in `scripts/build-personas.js` (L88–100) uses a hardcoded `PERSONA_FILES` array of 9 YAML filenames. This list must stay manually synchronized with the roles in `shared/workflow-manifest.json`. A comment documents the coupling, but there is no programmatic enforcement. Simple derivation from the manifest is impractical because the `id` field doesn't always match the filename (e.g., manifest `id: "pm"` → file `2-project-manager.yaml`). However, scanning the `personas/ledger/src/meta/` directory for files matching `/^\d+-.*\.yaml$/` (excluding `_shared.yaml`) achieves the same result without any coupling.

Per constraint 13 in the personas manifest, shared partials at `personas/shared/partials/` are suite-agnostic fragments reusable by all suites. The Verbatim AC Text guidance is correctly placed here since it applies to all suites that use the ledger workflow.

Per constraint 25, changes to shared partials that affect multiple personas require updating each affected persona's `changelog:` field and documenting all changes in one `personas/changelog.md` entry.

## Approach / Architecture
**WP-001 (Verbatim AC guidance):** Add a single bullet point to each of the four operational protocol partials, following the exact pattern established in `developer-strict-constraints.md` and `qa-operational-protocol.md`. The guidance text is identical across all agents — only the formatting adapts to each file's existing structure (numbered list items in some, bullet points in others). Bump versions for all four affected personas and add a `personas/changelog.md` entry.

**WP-002 (README update):** Rewrite the stale counts and suite descriptions in `personas/README.md` to reflect the actual build output: 3 suites (ledger 9, standalone 21, ledger-support 10), 3 targets (vs-code, claude-code, deep-agents), 40 personas × 3 = 120 generated files. Follow the "No Stale Counts" constraint — describe the counts in a way that is less likely to go stale (e.g., reference the build script's output rather than hardcoding exact numbers, or use "40 personas across 3 suites" with per-suite counts in the bullet list).

**WP-003 (PERSONA_FILES derivation):** Replace the hardcoded `PERSONA_FILES` array in `scripts/build-personas.js` with a directory scan of `personas/ledger/src/meta/` that reads all files matching `/^\d+-.*\.yaml$/` (excluding `_shared.yaml`), sorted numerically by leading digit. This eliminates the manual synchronization requirement with `shared/workflow-manifest.json` and removes a coupling that will break silently when a ledger role is added.

**WP-004 (Integration build & diff):** Final clean build pass to confirm all changes are correct and complete.

## Rationale
- The synthesis flagged the missing verbatim AC guidance as HIGH priority because Documentation and Reviewer agents actively call `ledger_complete_pipeline` with `acceptance_criteria_updates` — without the guidance, they are equally susceptible to the exact-match misfiling bug that the original project fixed for Developer and QA.
- Extending to Security Auditor and Release Engineer (not explicitly called out in the synthesis) is included because they also have `ledger_complete_pipeline` in their `mcp_tools` arrays and the marginal cost is near-zero (one line per file).
- The `PERSONA_FILES` derivation eliminates a manual coupling that will break silently when a new ledger role is added. The fix is a small self-contained change to `scripts/build-personas.js` with permanent risk reduction.
- The README fix is LOW priority in the synthesis but is included here because it is a 5-minute change with high visibility — the README is the first file developers read when entering the `personas/` directory.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Add guidance to all 4 remaining operational protocols | Per-protocol bullet/item | Extract to a single shared partial included by all 6 protocols | The guidance is one sentence — extracting to a partial would add indirection for no DRY benefit; the text is short enough that duplication is acceptable and easier to audit |
| Include Security Auditor and Release Engineer | Yes — add to all 4 | Limit to Documentation and Reviewer only (per synthesis text) | Marginal cost is near-zero; these agents do call `ledger_complete_pipeline` and the guidance prevents the exact same bug class |
| README count update strategy | Use exact current counts | Use dynamic phrases like "see build output" | The README is a static file; exact counts are more useful to readers, with a note in the line to update when adding personas |
| PERSONA_FILES derivation strategy | Directory scan of `personas/ledger/src/meta/` | Derive from `shared/workflow-manifest.json` `roles[]` | Manifest `id` doesn't always match filename (e.g., `pm` → `project-manager`); directory scan is simpler and requires no manifest schema changes |

## Pattern Alignment
- **Shared partials for cross-persona guidance** (`personas/shared/partials/`): Follows the existing pattern established by the original WP-002 fix that added guidance to `developer-strict-constraints.md` and `qa-operational-protocol.md`.
- **Persona version bumping on shared partial changes** (`personas/docs/agents/project-manifest/constraints.md` §25): Each affected persona's YAML `changelog:` field will be updated. Since this change affects all 4 remaining pipeline-completing personas and the shared partial is the source of truth, each persona gets its own version bump.
- **No Stale Counts constraint** (`developer-strict-constraints.md`, `docs-operational-protocol.md`): The README fix follows this constraint by updating the counts to current values.
- **Derive-from-source over hardcoded lists** (`shared/workflow-manifest.json` single-source-of-truth pattern): The PERSONA_FILES change follows the workspace's established pattern of deriving constants from authoritative sources rather than maintaining manual copies. In this case the authoritative source is the filesystem (the actual YAML files that exist) rather than a config file.

## Detailed Steps

### Step 1 — Add Verbatim AC Text to Documentation Operational Protocol
Add a new numbered item to `personas/shared/partials/docs-operational-protocol.md` after the existing item #5 ("Declare All Artifacts"):

```
6. **Verbatim AC Text:** When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.
```

### Step 2 — Add Verbatim AC Text to Reviewer Operational Protocol
Add a new section at the end of `personas/shared/partials/reviewer-operational-protocol.md`, after the documentation-forward section:

```
##### Verbatim AC Text

When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase, abbreviate, or reformat — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.
```

### Step 3 — Add Verbatim AC Text to Security Auditor Operational Protocol
Add a new numbered item at the end of `personas/shared/partials/security-auditor-operational-protocol.md`:

```
6. **Verbatim AC Text:** When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.
```

### Step 4 — Add Verbatim AC Text to Release Engineer Operational Protocol
Add a new numbered item at the end of `personas/shared/partials/release-engineer-operational-protocol.md`, after item #8 ("Self-Rework"):

```
9. **Verbatim AC Text:** When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.
```

### Step 5 — Bump affected persona versions
Update the `changelog:` field in each affected persona's YAML metadata to record the new version:

- `personas/ledger/src/meta/5-security-auditor.yaml` — bump version (add changelog entry for verbatim AC guidance)
- `personas/ledger/src/meta/6-reviewer.yaml` — bump version (add changelog entry for verbatim AC guidance)
- `personas/ledger/src/meta/7-release-engineer.yaml` — bump version (add changelog entry for verbatim AC guidance)
- `personas/ledger/src/meta/8-documentation.yaml` — bump version (add changelog entry for verbatim AC guidance)

### Step 6 — Update personas/changelog.md
Add a single `v3.27.0` entry (or next minor version after `v3.26.0`) to `personas/changelog.md` covering:
- Verbatim AC Text guidance extended to Documentation, Reviewer, Security Auditor, and Release Engineer operational protocols
- `personas/README.md` updated with correct suite/persona/target counts
- `scripts/build-personas.js` — `PERSONA_FILES` hardcoded list replaced with dynamic directory scan

### Step 7 — Update personas/README.md
Rewrite the stale counts and suite descriptions:
- Line 3: Change "48 AI agent persona files" to the correct count (40 personas across 3 suites, 120 generated files across 3 targets)
- Add the ledger-support suite to the suite listing
- Update standalone count from 16 to 21
- Add deep-agents as a third output target
- Update the directory structure section to include `ledger-support/`

### Step 8 — Replace hardcoded PERSONA_FILES with directory scan
In `scripts/build-personas.js`, replace the hardcoded `PERSONA_FILES` array (L88–100) and its sync comment with a directory scan:

1. Read `personas/ledger/src/meta/` using `fs.readdirSync()`.
2. Filter to files matching `/^\d+-.*\.yaml$/` (excludes `_shared.yaml` and any non-persona files).
3. Sort numerically by leading digit(s) to preserve the `1-planner`, `2-project-manager`, …, `9-synthesis` order.
4. Remove the `// This list must stay in sync with…` comment since the coupling no longer exists.

The resulting array is functionally identical to the current hardcoded list but will automatically pick up new persona YAML files when they are added.

### Step 9 — Build and verify
Run `node scripts/build-personas.js` to regenerate all persona output files. Verify:
- Build exits 0 with correct persona count
- `node scripts/build-personas.js --check` exits 0 (fresh output)
- `git diff --name-only` shows only the expected source files
- `personas/name-mapping.json` is identical before and after the PERSONA_FILES refactor (the directory scan produces the same list)

## Dependencies
- Steps 1–4 are independent of each other (can be done in any order)
- Step 5 depends on Steps 1–4 (must know which files changed)
- Step 6 depends on Steps 1–5, 7, and 8
- Step 7 is independent of Steps 1–6
- Step 8 is independent of Steps 1–7
- Step 9 depends on all preceding steps

## Required Components
- `personas/shared/partials/docs-operational-protocol.md` — existing file, add content
- `personas/shared/partials/reviewer-operational-protocol.md` — existing file, add content
- `personas/shared/partials/security-auditor-operational-protocol.md` — existing file, add content
- `personas/shared/partials/release-engineer-operational-protocol.md` — existing file, add content
- `personas/ledger/src/meta/5-security-auditor.yaml` — existing file, bump version
- `personas/ledger/src/meta/6-reviewer.yaml` — existing file, bump version
- `personas/ledger/src/meta/7-release-engineer.yaml` — existing file, bump version
- `personas/ledger/src/meta/8-documentation.yaml` — existing file, bump version
- `personas/changelog.md` — existing file, add entry
- `personas/README.md` — existing file, rewrite counts
- `scripts/build-personas.js` — existing file, replace hardcoded PERSONA_FILES with directory scan

## Assumptions
- The verbatim AC guidance text is functionally identical across all personas — only formatting adapts to each file's structure (numbered list vs. heading/paragraph).
- The current persona count (40 across 3 suites) and target count (3) are correct as of this plan's date.
- The `default_version` in `_shared.yaml` does not need to be bumped because only 4 of 9 ledger personas are affected (per constraint 25, `default_version` is for suite-wide changes).

## Constraints
- Never edit generated persona output files (constraint in AGENTS.md) — all changes go to source files under `personas/shared/partials/` and `personas/ledger/src/meta/`.
- Shared partials must remain suite-agnostic (constraint 13) — the Verbatim AC Text guidance applies to all suites using ledger tools, which is correct.
- Version bumps must follow the persona changelog convention (constraint 25).

## Out of Scope
- **Persona content-linting in the build script** — The synthesis flagged this as out-of-scope/medium priority. It requires a structural linting pass in `build-personas.js` that is a separate feature, not a rework item.
- **Promoting Bootstrapper AC mismatch warning to hard failure** — The synthesis recommends field-testing the current warn-only approach first. No field data is available yet.
- **Template annotation style in `1-planner.md`** — Investigated and found to be a non-issue. The AC-{NN} instruction is inside the fenced code block, but so are all other template annotations (`{Optional — omit…}` at L82, L150). The entire plan template (L72–L157) is a single fenced Markdown block with all instructions consistently embedded inside it.

## Acceptance Criteria
- AC-01: All six personas that call `ledger_complete_pipeline` (Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation) have Verbatim AC Text guidance in their respective operational protocol partials.
- AC-02: `personas/README.md` accurately reflects the current suite count (3), persona count per suite (ledger 9, standalone 21, ledger-support 10), target count (3: vs-code, claude-code, deep-agents), and total generated file count (120).
- AC-03: `node scripts/build-personas.js` exits 0 with the correct persona count after all changes.
- AC-04: `node scripts/build-personas.js --check` exits 0 (no stale output).
- AC-05: Each affected persona YAML has an updated `changelog:` entry and `personas/changelog.md` has a new version entry covering all changes.
- AC-06: The `PERSONA_FILES` array in `scripts/build-personas.js` is replaced by a directory scan that dynamically reads persona YAML files from `personas/ledger/src/meta/`, and `personas/name-mapping.json` is identical before and after the change.

## Testing Strategy
This is a persona-source-only change with no MCP server code modifications. Testing consists of:
1. Build verification — the persona build script validates file counts and output targets.
2. Diff scoping — `git diff --name-only` confirms only the expected source files were modified.
3. Content verification — manual inspection that the verbatim AC guidance text is present and correctly formatted in each operational protocol partial.

## Test Plan
- Build pass (`node scripts/build-personas.js`) — Asserts all persona files build without errors — AC-03
- Freshness check (`node scripts/build-personas.js --check`) — Asserts generated output matches source — AC-04
- Diff scoping (`git diff --name-only`) — Asserts only expected files are modified — AC-01, AC-02, AC-06
- Content grep for "Verbatim AC Text" across all 6 operational protocol partials — Asserts guidance is present in all 6 files — AC-01
- Manual review of `personas/README.md` counts against build output — Asserts counts are accurate — AC-02
- Changelog entry review — Asserts version bump and changelog entry exist — AC-05
- `personas/name-mapping.json` before/after comparison — Asserts the directory scan produces the same mapping as the hardcoded list — AC-06

## Documentation Updates
- `personas/changelog.md` — Add new version entry (Step 6)
- `personas/README.md` — Rewrite stale counts and add ledger-support suite (Step 7)
- Root `AGENTS.md` — Update the `scripts/build-personas.js` description in the Root-Level Tooling table if the PERSONA_FILES coupling comment is referenced there (verify before editing)

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Persona content-linting in build script | Synthesis §Next Steps #2, QA agents WP-001/WP-005 | Requires a new feature in `build-personas.js` — separate enhancement, not a rework fix | Flagged independently by multiple QA agents; high value for regression protection |
| 2 | Promote Bootstrapper AC mismatch warn→fail | Synthesis §Next Steps #3 | Needs field-testing data from the warn-only approach deployed in the original plan | Revisit after 3–5 orchestrator runs with the new pipeline |
| 3 | Template annotation style in `1-planner.md` | Synthesis §Deferred, WP-001 Developer | Investigated: not an issue — all template annotations are consistently inside the fenced code block (L82, L128, L150) | Synthesis premise was incorrect; no fix needed |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Verbatim guidance text slightly inconsistent across files** | Use the exact QA protocol wording as the canonical text; adapt only formatting (numbered item vs. heading) to match each file's structure |
| **Persona version bump misses an affected persona** | The plan explicitly lists all 4 YAML files; the diff scope check in Step 9 will catch any omission |
| **README counts go stale again in future** | Follow the "No Stale Counts" constraint — but for a README, exact counts are more useful to readers than vague phrasing; accept this as a known maintenance obligation |
| **Directory scan picks up unexpected files** | The regex `/^\d+-.*\.yaml$/` is specific (digit prefix + `.yaml` suffix); `_shared.yaml` is explicitly excluded; non-persona files in the directory would need to match this pattern to be picked up |
| **Directory scan changes sort order** | Sort numerically by leading digit(s) to match current hardcoded order; verify via `name-mapping.json` before/after comparison |
