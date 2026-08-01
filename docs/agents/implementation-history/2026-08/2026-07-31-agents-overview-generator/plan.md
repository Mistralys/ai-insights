
# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 2 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The ai-insights repository's short-term strategic goal is reducing onboarding friction. Auto-generating `agents-overview.md` from persona source YAML eliminates a 535-line manually maintained document, ensuring the overview stays accurate as personas evolve. This aligns with the "Personas first" long-term philosophy: persona metadata becomes the single source of truth, and documentation artifacts derive from it rather than the reverse.

## Summary
Auto-generate `docs/agents-overview.md` from persona YAML metadata and content source files. Add new optional YAML fields (`identity`, `use_when`, `key_behavior`, `inputs`, `outputs`, `modes`, `notes`) to each persona's metadata so that the overview document can be fully rendered from structured data. Replace the hardcoded `**Identity: X.**` line in all 42 content files with a `{{identity}}` template variable. Build a generation script (`scripts/generate-agents-overview.js`) that reads all three suite directories, extracts metadata, and renders the overview Markdown. Wire it into the CLI and the pre-commit staleness check.

## Architectural Context
The persona build system (`@mistralys/persona-builder`) uses a layered context model: `_shared.yaml` → per-persona YAML → derived fields → cross-suite agent map. Any field in per-persona YAML is automatically available as a `{{fieldName}}` template variable in the content `.md` file — no engine changes needed. The existing `build-personas.js` post-build phase already demonstrates lightweight YAML parsing (`parseYamlScalars()`, `extractYamlBlockScalar()`) and JSON artifact generation (`name-mapping.json`). The generation script follows the same pattern.

## Approach / Architecture
1. **Enrich persona YAML** with optional overview-oriented metadata fields (`identity`, `use_when`, etc.)
2. **Replace identity in content** with `{{identity}}` template variable across all 42 content files
3. **Build a standalone generation script** (`scripts/generate-agents-overview.js`) that reads YAML metadata from all three suites and renders the complete overview document
4. **Wire into CLI** as `generate-overview` and integrate into the `build-maintain` command (`cmdBuildMaintain`)
5. **Add staleness detection** via `--check` flag

The script is intentionally **separate from `build-personas.js`** — it reads the same YAML source files but serves a different purpose (documentation generation vs. persona output file generation). This avoids coupling the overview to the persona build pipeline.

## Rationale
- **Single source of truth:** Each persona's catalogue-level description (identity, use-when, modes, key behavior) lives alongside its other metadata in one YAML file, eliminating dual maintenance
- **Automatic accuracy:** Adding a new persona or changing a version automatically reflects in the overview on next generation
- **No persona builder changes:** YAML Tier 5 (optional/convention) fields pass through to the template context automatically, so `{{identity}}` works out of the box
- **Lightweight parsing:** The generation script uses the same `parseYamlScalars()` pattern as `build-personas.js`, avoiding a runtime dependency on `js-yaml`

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where to put overview fields | Per-persona YAML (Tier 5 optional fields) | (a) Parse from content `.md` via regex; (b) Separate `overview.yaml` per persona | YAML fields are self-contained and machine-readable; parsing from content is fragile (irregular patterns, sentence continuations); a separate file adds file proliferation without benefit |
| Identity variable vs. parsing | Add `identity` to YAML, use `{{identity}}` in content | Parse `**Identity: X.**` from content file at generation time | The `{{identity}}` approach gives the content author control over placement while keeping the value centralized; parsing works today but is fragile against future content format changes |
| Standalone script vs. persona builder plugin | Standalone script in `scripts/` | Persona builder plugin that emits the overview as a build artifact | The overview is a project-level documentation artifact, not a persona output file; coupling it to the build pipeline would require the persona builder to understand project-level concerns (static intro text, suite grouping, companion doc links) |
| YAML parsing approach | Reuse lightweight `parseYamlScalars()` + `extractYamlBlockScalar()` | Import `js-yaml` | Keeps the script zero-dependency like all other root scripts; flat top-level fields are handled by the existing parsers with zero new code |
| Overview field namespace | Flat top-level YAML fields | (a) Nested `overview:` object; (b) Flat fields with `ov_` prefix | Flat fields avoid building a nested YAML parser that doesn't exist in the workspace; field names (`use_when`, `key_behavior`, etc.) don't collide with existing fields, making a prefix unnecessary |
| Static intro text location | Separate template file (`scripts/templates/agents-overview-header.md`) | Embed as template string constant in the script | 65 lines of Markdown prose (including Mermaid triple-backtick blocks) are awkward to maintain inside a JavaScript template literal; a separate `.md` file keeps prose and logic in their natural file types |

## Pattern Alignment
- Follows the `build-personas.js` pattern of post-build JSON generation from YAML scanning — `scripts/build-personas.js` (L83–L433)
- Follows the `--check` / `--dry-run` flag pattern for read-only staleness detection — `scripts/build-personas.js` (L22–L23)
- Follows the CLI command registration pattern — `scripts/cli.js` (L809–L814)
- Follows the cross-platform scripting policy (Node.js `fs`/`path`, no Unix-only utilities) — `AGENTS.md` Cross-Platform Policy
- Departs from `name-mapping.json` in that it renders Markdown rather than JSON — justified because the output is a human-readable document, not a machine-consumed data file

## Detailed Steps

### Step 1: Add `identity` field to all 42 persona YAMLs

Add an `identity` field to each persona YAML file. The value is the text currently hardcoded in the content file's `**Identity: X.**` line.

**Ledger personas** (`personas/ledger/src/meta/N-*.yaml`) — 9 files:

| File | `identity` value |
|------|------------------|
| `1-planner.yaml` | `Chief Product Officer (CPO)` |
| `2-project-manager.yaml` | `Technical Program Manager (TPM)` |
| `3-developer.yaml` | `Staff Software Engineer` |
| `4-qa.yaml` | `SDET (Software Engineer in Test)` |
| `5-security-auditor.yaml` | `Security Auditor` |
| `6-reviewer.yaml` | `Principal Systems Architect` |
| `7-release-engineer.yaml` | `Release Engineer` |
| `8-documentation.yaml` | `Technical Writing Manager` |
| `9-synthesis.yaml` | `Head of Operations (OPS)` |

**Standalone personas** (`personas/standalone/src/meta/*.yaml`) — 22 files:
Each receives the `identity` value matching its current `**Identity:**` line (e.g., `agents-md-curator.yaml` → `Agent Operations (AgentOps) Architect`).

**Ledger-support personas** (`personas/ledger-support/src/meta/*.yaml`) — 11 files:
Same approach (e.g., `ledger-bootstrapper.yaml` → `Technical Program Manager — Ledger Initialization Operator`).

### Step 2: Add overview metadata fields to all persona YAMLs

Add the following optional flat top-level fields to each persona YAML:

```yaml
use_when: "Short description of when to invoke this persona"
key_behavior: |
  Notable behavior point 1
  Notable behavior point 2
modes: |
  Mode 1
  Mode 2
inputs: "What this persona receives (ledger personas only)"
outputs: "What this persona produces (ledger personas only)"
notes: "Optional freeform note (e.g., relationship to other personas)"
```

**Field definitions:**

| Field | Type | Required | Used By |
|-------|------|----------|---------|
| `use_when` | `string` | All standalone + support personas | Overview "Use When" line |
| `key_behavior` | block scalar (newline-delimited list) | All personas where notable behavior is documented | Overview "Key Behavior" bullets |
| `modes` | block scalar (newline-delimited list) | Personas with operating modes | Overview "Modes" line |
| `inputs` | `string` | Ledger personas only | Overview "Inputs" line |
| `outputs` | `string` | Ledger personas only | Overview "Outputs" line |
| `notes` | `string` | Optional for any persona | Overview freeform note (e.g., "Runs in parallel with Plan Auditor") |

All fields are flat top-level YAML scalars or block scalars, consistent with the existing persona YAML convention. The field names (`use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) do not collide with any existing YAML field names, so no prefix is needed. List-valued fields (`key_behavior`, `modes`) use YAML block scalar format (`|`) with one item per line, parsed by the same `extractYamlBlockScalar()` implementation copied into the generation script — no new parsing approach required.

**Data source:** The values for all fields are transcribed from the existing `docs/agents-overview.md` document. Every persona entry in that document contains the text that maps to these fields. This is a one-time migration of prose into structured YAML.

### Step 3: Replace `**Identity:**` line in all 42 content files

In each content `.md` file, replace the hardcoded identity line with the `{{identity}}` template variable:

**Before:**
```markdown
**Identity: Chief Product Officer (CPO).**
```

**After:**
```markdown
**Identity: {{identity}}.**
```

**Special case — `3-developer.md`:** The current line is:
```markdown
**Identity: Staff Software Engineer**. Your role identifier for all MCP tool calls is `{{role}}`.
```
Replace only the identity text:
```markdown
**Identity: {{identity}}**. Your role identifier for all MCP tool calls is `{{role}}`.
```

### Step 4: Create the generation script

Create `scripts/generate-agents-overview.js` — a Node.js ESM script that:

1. **Scans** all three suite `meta/` directories for persona YAML files (same discovery pattern as `build-personas.js`)
2. **Parses** each YAML file using the same `parseYamlScalars()` and `extractYamlBlockScalar()` implementations as `build-personas.js` (copy both functions verbatim from `scripts/build-personas.js` L124–L195 into the new script — they are not exported and cannot be imported; no new parsing approach is needed)
3. **Extracts** the `identity`, `use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`, `name`, `description`, `changelog` (for version), `subagents`, `number`, `role` fields
4. **Reads** the static intro header from `scripts/templates/agents-overview-header.md`
5. **Renders** the Markdown document with:
   - Static intro sections (from the template file)
   - Per-persona entries rendered from the extracted metadata
   - Summary table with suite counts
   - Generation timestamp and total count in the header
6. **Writes** to `docs/agents-overview.md` (or validates with `--check`)

**Flags:**
- `--check` / `--dry-run`: Compare generated output against the existing file; exit 0 if identical, exit 1 with a diff summary if stale
- No flags: Generate and write the file

**Static intro text handling:** The ~65 lines of static intro text (Architecture Overview, pipeline diagram, Mermaid-style flow, suite description table) live in a separate Markdown template file at `scripts/templates/agents-overview-header.md`. The generation script reads this file at runtime and prepends it to the generated persona catalogue. Keeping the prose in a `.md` file avoids the maintenance burden of editing 65 lines of Markdown — including Mermaid triple-backtick blocks — inside a JavaScript template literal.

**Rendering template per persona type:**

Ledger personas:
```markdown
### Stage {number} — {name} (v{version})

**Identity:** {identity}

{description}

- **Inputs:** {inputs}
- **Outputs:** {outputs}
- **Key Behavior:** {key_behavior[0]}
{optional: - **Sub-agents:** {subagents joined}}
```

Standalone/Support personas:
```markdown
### {name} (v{version})

**Identity:** {identity}

{description}

{optional: - **Modes:** {modes joined}}
{optional: - **Use When:** {use_when}}
{optional: - **Key Behavior:** {key_behavior[0]}}
{optional: - **Sub-agents:** {subagents joined}}
{optional: - **Key Difference from Ledger Developer:** {notes}}
```

### Step 5: Wire into CLI

Register the new command in `scripts/cli.js`:

```javascript
{
  id:          'generate-overview',
  label:       'Generate agents overview',
  description: 'Generate docs/agents-overview.md from persona YAML metadata',
  run:         cmdGenerateOverview,
}
```

Add the `cmdGenerateOverview` function that delegates to the script.

Include the overview generation in the existing `build-maintain` command (`cmdBuildMaintain`) at `scripts/cli.js` L428 — insert the `generate-agents-overview.js` call after the `build-personas.js` step and before the `check-known-roles.js` step, since the overview reads persona YAML and should run after the build to catch any YAML validation issues first.

### Step 6: Add staleness check to health checks

Add a **fast-tier** health check to `scripts/lib/health-checks.js` (following the `mcp-dist-fresh` pattern at L175–L185: use `latestMtime()` on a directory and compare against a sentinel file mtime) that compares the mtime of `docs/agents-overview.md` against the newest mtime across all three suite `meta/` directories. If any YAML is newer than the overview, the check reports stale. Use `cost: 'fast'` — scanning 42 YAML files across three directories is a fast-tier operation, not instant (per tier definitions: instant = file-existence/process.versions < 5 ms; fast = mtime comparisons < 50 ms).

### Step 7: Update persona-builder metadata reference

Add the `identity` field and the overview metadata fields (`use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) to the persona builder's metadata reference documentation at `docs/metadata-reference.md` in the ai-persona-builder project. Since these are Tier 5 optional fields consumed by a downstream project's generation script, a brief mention in the "Tier 5 — Optional / Convention Fields" section suffices.

### Step 8: Run the generator and verify output

Execute `node scripts/generate-agents-overview.js` and diff the output against the current manually-authored `docs/agents-overview.md`. Verify:
- All 42 personas are present
- Versions match
- Identity values match
- Suite grouping is correct
- Companion link from `workflow-and-ledger.md` still works

## Dependencies
- Step 3 depends on Step 1 (identity field must exist in YAML before content files can reference it)
- Step 4 depends on Steps 1–2 (script reads the new YAML fields)
- Step 5 depends on Step 4 (CLI registers the script)
- Step 6 depends on Step 4 (health check references the script's output path)
- Step 8 depends on Steps 1–5

## Required Components
- `personas/ledger/src/meta/N-*.yaml` — 9 files modified (add `identity`, `use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`)
- `personas/standalone/src/meta/*.yaml` — 22 files modified (add `identity`, `use_when`, `key_behavior`, `modes`, `notes`; exclude `_shared.yaml`)
- `personas/ledger-support/src/meta/*.yaml` — 11 files modified (add `identity`, `use_when`, `key_behavior`, `modes`, `notes`; exclude `_shared.yaml`)
- `personas/ledger/src/content/*.md` — 9 files modified (replace identity line with `{{identity}}`)
- `personas/standalone/src/content/*.md` — 22 files modified (same)
- `personas/ledger-support/src/content/*.md` — 11 files modified (same)
- `scripts/generate-agents-overview.js` — new file
- `scripts/templates/agents-overview-header.md` — new file (static intro text template)
- `scripts/cli.js` — modified (register command, add to `cmdBuildMaintain`)
- `scripts/lib/health-checks.js` — modified (add staleness check)
- `docs/agents-overview.md` — becomes generated output (no longer manually edited)

## Assumptions
- All 42 persona YAML files follow the existing naming conventions and are discoverable via the same filesystem scan pattern used by `build-personas.js`
- The new flat YAML field names (`use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) do not collide with any existing or planned persona builder fields (they are Tier 5 convention fields, invisible to the engine)

## Constraints
- The output filename must remain `docs/agents-overview.md` — `docs/workflow-and-ledger.md` links to it by name
- The generation script must be cross-platform (Node.js only, no Unix utilities) per the Cross-Platform Policy in `AGENTS.md`
- YAML parsing must remain lightweight (no `js-yaml` dependency) to match the pattern of other root scripts
- All overview metadata fields are flat top-level YAML fields — consistent with every other persona YAML field in the workspace — parsed by the existing `parseYamlScalars()` and `extractYamlBlockScalar()` utilities

## Out of Scope
- Modifying the persona builder engine or its build pipeline — all new fields are Tier 5 convention fields that pass through automatically
- Auto-generating `docs/workflow-and-ledger.md` — that document has a different structure and less repetitive content
- Adding a pre-commit hook for overview staleness — the health check in `health-checks.js` provides sufficient visibility; the pre-commit hook runs the persona freshness check which already covers YAML changes

## Acceptance Criteria

- AC-01: Every persona YAML across all three suites contains an `identity` field matching its current `**Identity:**` content
- AC-02: Every persona YAML across all three suites contains overview metadata fields — at least `use_when` (standalone/support) or `inputs`+`outputs` (ledger) — as flat top-level YAML fields
- AC-03: All 42 content `.md` files use `{{identity}}` instead of hardcoded identity text
- AC-04: Running `node scripts/build-personas.js` succeeds and rendered persona output files contain the correct identity text (verifying `{{identity}}` variable substitution works)
- AC-05: `scripts/generate-agents-overview.js` exists and generates `docs/agents-overview.md` with all 42 personas, correct versions, correct suite grouping, and a generation timestamp
- AC-06: `node scripts/generate-agents-overview.js --check` exits 0 when the file is current and exits 1 when stale
- AC-07: The `generate-overview` command is registered in `scripts/cli.js` and `cmdBuildMaintain` calls `generate-agents-overview.js` after the `build-personas.js` step
- AC-08: The health check in `scripts/lib/health-checks.js` detects when persona YAML files are newer than the overview document
- AC-09: The generated overview document preserves the companion link from `docs/workflow-and-ledger.md` (filename unchanged)
- AC-10: All seven new YAML fields (`identity`, `use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) are documented in `ai-persona-builder/docs/metadata-reference.md` under Tier 5
- AC-11: `personas/docs/agents/project-manifest/constraints.md` contains a maintenance rule requiring overview metadata fields to be kept current when persona content changes, and requiring `identity` to be present in every persona YAML
- AC-12: `AGENTS.md` Cross-System Dependencies table includes an entry for the persona YAML → `docs/agents-overview.md` sync point, listing the overview metadata fields and the generation script

## Testing Strategy
This is primarily a documentation generation feature. Testing focuses on:
1. **Build verification:** Confirm `build-personas.js` still passes after YAML and content changes (existing test surface covers persona build)
2. **Generation correctness:** Run the generator and diff against the expected output
3. **Staleness detection:** Verify `--check` flag behavior by touching a YAML file and re-running
4. **Cross-platform path handling:** The script uses `path.join()`/`path.resolve()` throughout

## Test Plan
- `scripts/tests/generate-agents-overview.test.js` — Tests the generation script's core functions (YAML parsing, Markdown rendering per persona type, suite grouping, total count, `--check` exit code). Covers AC-05, AC-06.
- Update `scripts/tests/health-checks.test.js`: (a) increment the `toHaveLength` assertion from 10 to 11; (b) add the new check's ID (e.g. `'overview-fresh'`) to the expected-IDs array; (c) add a fixture-based test verifying that `detect()` returns `false` when the overview mtime predates a YAML file mtime. Covers AC-08.
- Manual: Run `node scripts/build-personas.js` after Steps 1–3 and verify clean build — covers AC-04
- Manual: Run `node scripts/generate-agents-overview.js` and diff output against current `docs/agents-overview.md` — covers AC-05, AC-09
- Manual: Touch a YAML file, run `--check`, verify exit code 1 — covers AC-06
- Manual: Run `node scripts/cli.js generate-overview` — covers AC-07

## Documentation Updates
- `docs/agents-overview.md` — Becomes generated output; add a `<!-- Generated by scripts/generate-agents-overview.js — do not edit manually -->` header comment
- `ai-persona-builder/docs/metadata-reference.md` — Add all seven overview fields (`identity`, `use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) to the Tier 5 Optional/Convention Fields table with descriptions and which suites use each
- `AGENTS.md` — (a) Add `scripts/generate-agents-overview.js` to the Root-Level Tooling table; (b) Add an entry to the Cross-System Dependencies table documenting the sync point: source of truth is persona YAML overview fields, must stay in sync with `docs/agents-overview.md` (generated by `scripts/generate-agents-overview.js`)
- `personas/docs/agents/project-manifest/constraints.md` — Add a maintenance rule: (a) `identity` field is required in every persona YAML; (b) overview metadata fields (`use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) must be kept current when persona purpose, behavior, or modes change; (c) after modifying any overview field, run `node scripts/generate-agents-overview.js` (or the `build-maintain` command) to regenerate the overview
- `personas/docs/agents/project-manifest/api-surface.md` — Add `identity` and overview metadata fields (`use_when`, `key_behavior`, `modes`, `inputs`, `outputs`, `notes`) to the metadata field reference if one exists

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **YAML block scalar edge cases** — `key_behavior` and `modes` use block scalar format parsed by `extractYamlBlockScalar()` | The existing `extractYamlBlockScalar()` utility is well-tested in `build-personas.js`; the new fields follow the same format as existing block scalar fields like `changelog` |
| **Content file identity line variations** — some files may deviate from the expected pattern | The audit found only one variation (developer's sentence continuation); handle it as a documented special case |
| **Static intro text drift** — the template file `scripts/templates/agents-overview-header.md` may go stale relative to project changes | The intro text describes architectural concepts that change infrequently; the staleness check compares against YAML mtimes (not template changes); editing the template is a natural Markdown editing experience with no JavaScript escaping concerns |
| **Large changeset** — 42 YAML files + 42 content files + 1 new script + 2 modified scripts = ~87 files | Group into logical commits: (1) YAML metadata additions, (2) content file `{{identity}}` migration, (3) generation script + CLI, (4) health check + docs |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change within well-understood patterns (YAML metadata + script generation); all changes are in the personas and scripts directories; no architectural departures or cross-module concerns requiring formal QA/security review.
