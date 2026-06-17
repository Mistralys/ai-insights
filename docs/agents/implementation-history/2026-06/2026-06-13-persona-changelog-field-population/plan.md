# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary

Add a `changelog:` block-scalar field to all 37 persona YAML files (9 ledger + 28 standalone) in `ai-insights`. This is a purely data-population task: the build system already passes through unknown YAML fields, so no build tooling changes are required. Change descriptions are derived on a best-effort basis from `personas/changelog.md` and the Git log. The `version:` field is **retained unchanged** because the persona-builder engine update (Phase 1 of the research paper's migration plan) has not yet been implemented; removing `version:` is deferred to a follow-on plan.

## Architectural Context

The relevant files and patterns:

- **`personas/ledger/src/meta/N-name.yaml`** — 9 ledger persona YAML files. Each has `version: "X.Y.Z"` and `last_updated: "YYYY-MM-DD"` near the top, followed by tool lists, MCP tool tables, and feature flags.
- **`personas/standalone/src/meta/slug.yaml`** — 28 standalone persona YAML files. Same structural convention.
- **`personas/changelog.md`** — Central changelog (322 lines). Entries are grouped by central-release version (`## v3.N.N`) and use `Ledger:`, `Standalone:`, `Build:` prefixes. Many entries include explicit per-persona version numbers in parentheses (e.g. `Developer v3.6.1:`).
- **`@mistralys/persona-builder`** — The build library passes through all unknown YAML fields via an index signature (`[key: string]: unknown`). A `changelog:` field added to any YAML is silently forwarded in the build context but never rendered unless a template consumes it. No library changes required for this plan.
- **`scripts/build-personas.js`** — Calls the library; reads YAML scalar fields for `name-mapping.json` generation. Does not iterate over unknown fields. Unaffected by this change.

## Approach / Architecture

Insert a `changelog: |` YAML block scalar immediately after the `last_updated:` field in each persona YAML. Each line of the block scalar follows the convention:

```
VERSION (DATE): Change description (≤ 100 chars)
```

Lines are ordered **newest version first** (descending). The date is **required on the first line of each version group** and optional on additional lines for the same version. Multiple changes for the same version each get their own line with the same version prefix; only the first carries the date. The topmost entry's version **must match** the persona's current `version:` field, and its date must match `last_updated:`.

Source of truth for entries:
1. **Primary:** `personas/changelog.md` — scan for lines that mention the persona by name or role, and use the explicit per-persona version numbers when present.
2. **Supplement:** `git log --follow -- personas/ledger/src/meta/N-name.yaml` (or the standalone equivalent) to identify changes not captured in the central changelog.
3. **Best-effort only:** Entries for older versions (pre-v3.5.0 for ledger personas; pre-initial release for standalone) are omitted or approximated. The central changelog retains the authoritative historical record.

## Rationale

Adding the `changelog:` field now — before the persona-builder engine update — is low-risk and high-value: it populates the data that Phase 1 will consume, and gives the team a chance to review the entries before any version-derivation logic is live. The block scalar is already handled gracefully by the build system (passed through, not rendered).

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Retain `version:` field | Keep existing `version:` alongside new `changelog:` | Remove `version:` immediately | Removing `version:` now would break the existing build and `name-mapping.json` generation; deferral keeps this plan non-breaking. |
| Field placement | After `last_updated:` | After `version:`, at end of file | Placing it adjacent to `version:` and `last_updated:` groups all version metadata together; end-of-file would bury it after tool lists. |
| Entry format | `VERSION (DATE): Description` (date required on first line per version group) | Structured YAML array `{version, changes[]}` | Flat strings with an inline date co-locate timing with the change, eliminating the need for a separate `last_updated:` field long-term; the structured form is verbose and was explicitly rejected in the research paper. |

## Pattern Alignment

- Follows the `VERSION (DATE): Description` flat-entry convention described in the research paper (§ Approach A, updated format with required date on first version line).
- Follows the existing house style for changelog entries: flat bullet lines, ≤ 100-char lines, category prefixes optional within the per-persona field.
- The `changelog:` placement (after `last_updated:`) mirrors how `version:` and `last_updated:` are already co-located as a "version metadata block" at the top of each YAML.
- No departure from existing build conventions — the build system's unknown-field passthrough is the intentional design.

## Detailed Steps

### 1. Prepare the extraction reference

Before editing any files, create a working reference by scanning `personas/changelog.md` for all persona-specific entries. For each persona, collect lines that match the persona's name or role. Pay attention to explicit version numbers in the form `PersonaName vX.Y.Z:` — these map directly to the `changelog:` entry version.

The central changelog's `## vN.N.N` section heading **does not** correspond to the persona's own version. Use the per-persona version numbers when given; otherwise infer from version-bump context.

### 2. Populate ledger persona YAML files

Edit each of the 9 ledger YAML files to insert `changelog: |` after `last_updated:`. Use the version history table below as the primary reference; supplement with `git log` for any gaps.

**File: `personas/ledger/src/meta/1-planner.yaml`** (current v1.6.3)

Key changelog entries to include (newest first):
```yaml
changelog: |
  1.6.3 (2026-06-08): Content restructured; shared partials inlined; repository history access added
  1.6.0 (2026-05-19): Added standalone Planner variant (ledger version refactored accordingly)
  1.5.0 (2026-04-30): Gained Synthesis rework mode
  1.4.2 (2026-04-08): Initializes Plan Audit Cycles; updates counters during rework
  1.4.1 (2026-04-08): Gained Considered Alternatives, Pattern Alignment, Test Plan sections
  1.3.1 (2026-02-22): Added clause for naming synthesis rework plans
  1.3.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
```

**File: `personas/ledger/src/meta/2-project-manager.yaml`** (current v3.7.3)

Key changelog entries:
```yaml
changelog: |
  3.7.3 (2026-05-19): Verification gate enumerates all WP fields, catching stripped spec files
  3.7.2 (2026-04-08): Improved subagent invocations; deep-agents handoffs declare all targets
  3.5.1 (2026-02-22): Simplified preflight and verbose sections
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
```

**File: `personas/ledger/src/meta/3-developer.yaml`** (current v3.6.3)

Key changelog entries:
```yaml
changelog: |
  3.6.3 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.6.1 (2026-02-23): Compressed overly verbose operational protocol
  3.5.2 (2026-02-22): Simplified preflight and verbose sections
  3.5.1 (2026-02-22): Added capabilities and rework sections; added observation tool
  3.5.0 (2026-02-22): Initial changelogged version — repeat-loop workflow; role scope constraints
```

**File: `personas/ledger/src/meta/4-qa.yaml`** (current v3.6.2)

Key changelog entries:
```yaml
changelog: |
  3.6.2 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.5.3 (2026-02-22): Simplified preflight and verbose sections
  3.5.2 (2026-02-22): Added incident logging block and REWORK_QA handling
  3.5.1 (2026-02-22): Enabled incident logging
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
```

**File: `personas/ledger/src/meta/5-security-auditor.yaml`** (current v3.6.3)

Key changelog entries:
```yaml
changelog: |
  3.6.3 (2026-05-29): Gained ledger_search_insights for in-context lookups; gained browser tool
  3.6.1 (2026-02-23): Initial release — OWASP A01–A10 coverage at pipeline position 5
```

**File: `personas/ledger/src/meta/6-reviewer.yaml`** (current v3.6.1)

Key changelog entries:
```yaml
changelog: |
  3.6.1 (2026-04-08): Gained ledger_search_insights for in-context lookups
  3.5.5 (2026-04-08): Three-tier feedback (Blocking, Fix-Forward, Documentation-Forward)
  3.5.4 (2026-04-08): Documentation-forward convention with named spec and priority field
  3.5.3 (2026-02-22): Removed phantom REWORK_REVIEW action; added acceptance criteria field
  3.5.2 (2026-02-22): Added incident logging block
  3.5.1 (2026-02-22): Enabled incident logging
  3.5.0 (2026-02-22): Initial changelogged version; security review delegated to Security Auditor
```

**File: `personas/ledger/src/meta/7-release-engineer.yaml`** (current v3.7.2)

Key changelog entries:
```yaml
changelog: |
  3.7.2 (2026-04-08): Updated release protocol and output format documentation
  3.7.0 (2026-04-08): Delegates changelog curation to Changelog Curator; delegates CTX updates
  3.6.1 (2026-02-23): Initial release — release curation at pipeline position 7
```

**File: `personas/ledger/src/meta/8-documentation.yaml`** (current v3.7.0)

Key changelog entries:
```yaml
changelog: |
  3.7.0 (2026-04-30): Delegates to CTX Architect sub-agent
  3.5.4 (2026-02-22): Simplified preflight and verbose sections
  3.5.3 (2026-02-22): Fixed REWORK action name; added rework handling and status tool
  3.5.2 (2026-02-22): Removed unneeded handoff status tool
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
```

**File: `personas/ledger/src/meta/9-synthesis.yaml`** (current v3.7.0)

Key changelog entries:
```yaml
changelog: |
  3.7.0 (2026-06-05): Deferred items collection added to operational protocol
  3.6.0 (2026-05-29): Knowledge extraction delegated to Knowledge Archiver sub-agent
  3.5.4 (2026-02-22): Simplified preflight and verbose sections
  3.5.1 (2026-02-22): Demoted ledger help tool to note-only
  3.5.0 (2026-02-22): Initial changelogged version — role boundaries and mandatory handoffs
```

### 3. Populate standalone persona YAML files

Edit each of the 28 standalone YAML files. The central changelog is the primary source. Many standalone personas were added in a single release and have had 1–6 version bumps since. Use the table in the Required Components section as a version reference; extract description text from `personas/changelog.md` for each version.

The following personas have well-documented histories in the central changelog and should be populated first as a verification sample:

- **`researcher.yaml`** (v1.2.0): Gained `browser` tool in v3.22.0
- **`plan-auditor.yaml`** (v1.5.0): Multiple explicit version entries (v1.2.0→v1.5.0) visible in changelog
- **`plan-architect-reviewer.yaml`** (v1.6.0): Multiple explicit version entries visible
- **`git-committer.yaml`** (v1.0.5): Several incremental fixes documented
- **`ledger-orchestrator-runner.yaml`** (v1.5.1): Rich history in changelog

For each remaining standalone persona, use the pattern:
1. Search `personas/changelog.md` for `Standalone: <PersonaName>:` lines
2. Use the explicit `v<VERSION>` marker when present; otherwise assign the initial release version
3. Initial release entry includes the date from the persona's introduction in the central changelog: `X.0.0 (YYYY-MM-DD): Initial release`

### 4. Verify the build

After editing all 37 files, run the build check to confirm no regressions:

```
node scripts/build-personas.js --check
```

Expected: all files pass, no new errors or warnings. The `changelog:` field is passed through silently by the library.

Also run a full build to confirm rendered output is unchanged:

```
node scripts/build-personas.js
```

Verify via `git diff personas/ledger/vs-code/` and `personas/standalone/vs-code/` that no rendered persona files changed (since the `changelog:` field is not referenced in any template).

## Dependencies

- `personas/changelog.md` — source of changelog entries
- Git history for `personas/ledger/src/meta/` and `personas/standalone/src/meta/` — supplement for undocumented version bumps
- `@mistralys/persona-builder` — no changes required; unknown fields are passed through

## Required Components

All files to modify (no new files):

**Ledger (9 files):**
- `personas/ledger/src/meta/1-planner.yaml` — v1.6.3
- `personas/ledger/src/meta/2-project-manager.yaml` — v3.7.3
- `personas/ledger/src/meta/3-developer.yaml` — v3.6.3
- `personas/ledger/src/meta/4-qa.yaml` — v3.6.2
- `personas/ledger/src/meta/5-security-auditor.yaml` — v3.6.3
- `personas/ledger/src/meta/6-reviewer.yaml` — v3.6.1
- `personas/ledger/src/meta/7-release-engineer.yaml` — v3.7.2
- `personas/ledger/src/meta/8-documentation.yaml` — v3.7.0
- `personas/ledger/src/meta/9-synthesis.yaml` — v3.7.0

**Standalone (28 files):**
- `personas/standalone/src/meta/agents-md-curator.yaml` — v1.2.0
- `personas/standalone/src/meta/changelog-curator.yaml` — v1.1.1
- `personas/standalone/src/meta/composer-curator.yaml` — v1.0.1
- `personas/standalone/src/meta/ctx-architect.yaml` — v1.2.0
- `personas/standalone/src/meta/developer.yaml` — v1.1.0
- `personas/standalone/src/meta/documentation-curator.yaml` — v1.0.0
- `personas/standalone/src/meta/git-committer.yaml` — v1.0.5
- `personas/standalone/src/meta/ledger-bootstrapper.yaml` — v1.1.0
- `personas/standalone/src/meta/ledger-claude-coordinator.yaml` — v1.0.0
- `personas/standalone/src/meta/ledger-dependency-sequencer.yaml` — v1.0.4
- `personas/standalone/src/meta/ledger-doctor.yaml` — v1.3.0
- `personas/standalone/src/meta/ledger-knowledge-archiver.yaml` — v1.6.0
- `personas/standalone/src/meta/ledger-knowledge-curator.yaml` — v1.2.0
- `personas/standalone/src/meta/ledger-orchestrator-runner.yaml` — v1.5.1
- `personas/standalone/src/meta/ledger-pipeline-configurator.yaml` — v1.0.2
- `personas/standalone/src/meta/ledger-wp-decomposer.yaml` — v1.0.7
- `personas/standalone/src/meta/manifest-curator.yaml` — v1.0.6
- `personas/standalone/src/meta/module-intent-architect.yaml` — v1.0.3
- `personas/standalone/src/meta/persona-curator.yaml` — v1.1.0
- `personas/standalone/src/meta/plan-architect-reviewer.yaml` — v1.6.0
- `personas/standalone/src/meta/plan-auditor.yaml` — v1.5.0
- `personas/standalone/src/meta/plan-refiner.yaml` — v1.0.4
- `personas/standalone/src/meta/planner.yaml` — v1.0.0
- `personas/standalone/src/meta/readme-curator.yaml` — v1.3.0
- `personas/standalone/src/meta/recipe-curator.yaml` — v1.0.5
- `personas/standalone/src/meta/researcher.yaml` — v1.2.0
- `personas/standalone/src/meta/unit-test-auditor.yaml` — v1.1.0
- `personas/standalone/src/meta/whatsnew-curator.yaml` — v1.0.1

## Assumptions

- The `@mistralys/persona-builder` library's unknown-field passthrough behaviour is stable and will not change before this plan is merged.
- The `version:` field remains the authoritative version source until the persona-builder Phase 1 engine change is implemented.
- Best-effort changelog reconstruction is acceptable; minor inaccuracies in historical entries will be corrected in future version bumps.
- The `changelog:` field is **not** referenced in any existing Markdown template (confirmed: no `{{changelog}}` token exists in any content or partial file).

## Constraints

- Do not remove the `version:` field from any YAML — this is explicitly deferred.
- The topmost line of each `changelog:` block must start with the persona's current `version:` value followed by a date in parentheses (e.g. if `version: "1.5.0"` then the first line must be `1.5.0 (YYYY-MM-DD): ...`). The date on the topmost line must match the persona's `last_updated:` field value.
- Entries must be ≤ 100 characters per line (house style).
- The block scalar must use the literal style (`|`), not the folded style (`>`).
- Do not add a `changelog:` field to `_shared.yaml` — it is a configuration file, not a persona definition.
- Do not edit any generated output file under `personas/ledger/vs-code/`, `personas/ledger/claude-code/`, `personas/standalone/vs-code/`, or `personas/standalone/claude-code/`.

## Out of Scope

- Phase 1 (persona-builder engine change): `resolveVersionFromChangelog()` utility, `buildContext()` and `buildAgentNameMap()` updates — deferred to the ai-persona-builder project.
- Removing the `version:` field from YAML files — deferred until Phase 1 is complete.
- Updating `scripts/build-personas.js` `name-mapping.json` generator — deferred until Phase 1.
- Adding a build-time validation plugin that checks `changelog` vs `version` consistency — deferred until Phase 1.
- Updating the Persona Curator to include `changelog:` in new-persona templates — separate, small follow-on task.
- Updating `personas/docs/agents/project-manifest/constraints.md` with the new convention — deferred; no constraint is active until Phase 1 validation is live.

## Acceptance Criteria

- All 37 persona YAML files (9 ledger + 28 standalone, excluding `_shared.yaml`) contain a `changelog: |` block scalar field.
- The topmost entry in every `changelog:` block has a version that exactly matches the YAML's current `version:` field.
- Every `changelog:` block contains at least one entry.
- All entries follow the `VERSION (DATE): Description` format (date required on the first line of each version group, optional on same-version continuation lines) and are ≤ 100 characters.
- `node scripts/build-personas.js --check` exits 0 with no new errors or warnings.
- Full build (`node scripts/build-personas.js`) produces no changes to any rendered output file (diff is clean for all output directories).

## Testing Strategy

The primary verification is a build check: since the library passes through unknown fields and no template consumes `changelog:`, a clean `--check` and clean rendered-output diff proves the field was added without side effects.

Secondary: spot-check 3–4 YAML files manually to confirm YAML syntax is valid (no indentation errors in the block scalar), the version matches, and entries are readable.

## Test Plan

- **Build check:** `node scripts/build-personas.js --check` — asserts zero errors/warnings after all 37 files are edited — covers all acceptance criteria.
- **Rendered output diff:** `git diff personas/ledger/vs-code/ personas/standalone/vs-code/ personas/ledger/claude-code/ personas/standalone/claude-code/ personas/ledger/deep-agents/ personas/standalone/deep-agents/` — asserts empty diff (no rendered content changed) — covers the "no side effects" criterion.
- **Version consistency spot-check:** For `1-planner.yaml`, `3-developer.yaml`, `researcher.yaml`, and `plan-auditor.yaml` — manually confirm `version:` value equals the first version prefix in `changelog:`, a date is present in parentheses on that first line, and the date matches `last_updated:` — covers the topmost-entry constraint.
- **YAML syntax check:** Load a sample file with `js-yaml` (or `node -e "require('js-yaml').load(require('fs').readFileSync('path'))"`) to confirm no parse errors from the block scalar — covers the YAML validity constraint.

## Documentation Updates

- No documentation changes are required for this plan. The `constraints.md` and Persona Curator updates are deferred to the Phase 1 follow-on.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **YAML block scalar indentation error** silently corrupts a field | Run `node scripts/build-personas.js --check` after every ~5 files; fix parse errors immediately before proceeding. |
| **Version mismatch** between `version:` field and topmost `changelog:` entry | The acceptance criteria explicitly requires them to match; reviewer spot-checks three files. |
| **Inaccurate historical entries** (best-effort reconstruction) | Entries are advisory metadata, not functional code. Inaccuracies have zero runtime impact and will be corrected over time as new versions are added. |
| **Changelog field grows large** for personas with many versions | At ~1–3 lines per version, even 20 versions is ~40 lines — well within YAML readability thresholds. No truncation policy needed at current scale. |
