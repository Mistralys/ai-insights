# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Summary

Eliminate the `work/WP-###.md` spec files and `work.md` summary index from the ledger workflow. All WP information agents need is already available via `ledger_get_work_package` (which returns the full `description` field containing the spec body). The dual-read pattern (file + tool call) wastes tokens and creates a synchronization burden (AC fidelity checks, PM spec-file verification protocol). This plan removes the spec file creation from the Bootstrapper, removes file references from all agent personas (3–9) and the PM, removes the AC fidelity verification logic, removes the `work_package_file` field from all schemas and tool interfaces, makes `description` required in `ledger_create_work_package`, and ensures all agent personas that call WP tools are updated to reflect the new interface.

## Architectural Context

The current workflow produces two representations of every WP's specification:

1. **Ledger JSON** (`.ledger/WP-###.json`): Contains `title`, `description` (full spec body as a Markdown-formatted string), `acceptance_criteria`, `dependencies`, `active_pipeline_stages`, plus operational state (status, pipelines, artifacts, metrics, comments, handoff notes). Managed exclusively via MCP tools.

2. **Spec Markdown** (`work/WP-###.md`): Contains the same content as the ledger's `description` field, formatted with Markdown section headings (Plan Context, Description, Scope, Deliverables, AC, Pipeline Stages, Complexity, Rationale, Rejected Approaches, Notes). Created by the Ledger Bootstrapper, read by agents 3–9.

Additionally, `work.md` is a summary index table that duplicates `ledger_list_work_packages` output.

The Bootstrapper already passes the full spec body as `description` to `ledger_create_work_package`. All agents already call `ledger_get_work_package`. The spec file read is redundant.

## Approach / Architecture

**Single source of truth:** The ledger becomes the sole repository for WP specification content. Agents retrieve WP details via `ledger_get_work_package`, which returns the `description` field containing the full structured Markdown spec body. No files are written to or read from the `work/` directory.

**What changes:**
- Bootstrapper persona: Remove Steps 4 (create spec files), 5 (add status column to `work.md`), and the file-related parts of Step 6 (cross-check files vs. ledger, AC content verification). The Bootstrapper only calls `ledger_create_work_package` with the full `description` body (which it already does).
- Agent personas (3–9): Replace spec file references with `ledger_get_work_package` as the sole input. The `description` field contains the same structured Markdown — agents parse it identically to how they'd read the file.
- PM persona: Remove the "Spec File Verification" operational protocol. Remove `work/WP-###.md` and `work.md` from the file layout diagram.
- PM shared partial: Remove AC fidelity cross-check logic.
- MCP schema and tools: Remove `work_package_file` from `WorkPackageDetailSchema`, `CreateWorkPackageSchema`, `WorkPackageSummarySchema`, help content, and tool descriptions. Make `description` required in `CreateWorkPackageSchema`. Update all test fixtures.

**What stays the same:**
- The WP Decomposer — it produces `work-packages-draft.md` (the draft), which is input to the Bootstrapper. This file is unrelated to the spec files and remains.
- The Dependency Sequencer and Pipeline Configurator — their outputs (`dependency-analysis.md`, `pipeline-configuration.md`) remain.
- `plan.md` — remains as the project plan document.
- `ledger_get_work_package` — returns the full WP detail (now without `work_package_file`, with `description` always present for new WPs).

## Rationale

1. **Token reduction:** Currently every agent reads the spec file (~500–2000 tokens) AND calls `ledger_get_work_package` (~300–1500 tokens for the JSON response). The content overlaps heavily (title, AC, dependencies, description). Eliminating the file read saves ~500–2000 tokens per WP per agent invocation. Over a 5-WP project with 7 agents, this is ~17,500–70,000 tokens saved.

2. **Eliminated synchronization burden:** The AC fidelity check (Bootstrapper Step 6.4, PM Spec File Verification protocol) exists solely because two sources can drift. With one source, this check and its token cost disappear.

3. **Fewer Bootstrapper tool calls:** Eliminating spec file creation removes ~N+1 file-write tool calls per project (one per WP + `work.md`). Each tool call costs tokens for the request and response.

4. **Reduced failure surface:** Spec file creation can fail (filesystem errors), requiring error tracking and reporting logic. The ledger write is already atomic and validated.

5. **The `description` field preserves structure:** The Bootstrapper passes the spec body with Markdown headings intact. An agent reading `description` from `ledger_get_work_package` sees the same structured Markdown (with `## Scope`, `## Deliverables`, etc.) that it would see in the file. No information is lost.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Eliminate spec files entirely | Remove all spec file creation and reading | Keep spec files as optional human-readable artifacts | Spec files duplicate ledger content and create sync burden. The `description` field preserves the same Markdown structure. Human readability is served by the GUI or `ledger_get_work_package` output. |
| Remove `work_package_file` entirely | Delete from all schemas, tools, and tests | Make it optional (backward-compatible) | No backward compatibility is needed — this is the new way forward. Removing entirely is cleaner than leaving a vestigial optional field. |
| Keep `work.md` as a standalone artifact | N/A — eliminate it | Keep `work.md` even without spec files | `work.md` duplicates `ledger_list_work_packages` and `ledger_get_project_status`. Agents don't reference it; only the PM uses it for layout verification. |
| Structured fields vs. description blob | Keep the existing `description` text blob | Add individual fields to the schema (scope, deliverables, rationale, etc.) | Adding 8+ optional string fields to the WP schema would increase schema complexity, storage size, and migration burden for marginal benefit — agents can parse Markdown headings from the blob, and the sections vary by WP. The blob is simpler and more flexible. |

## Pattern Alignment

- **Ledger-as-source-of-truth:** The codebase already declares the ledger authoritative over spec files for AC content (`personas/shared/partials/pm-output-format.md` L15). This plan extends that principle to all WP content.
- **MCP tool-first access:** All agents already use MCP tools as their primary interaction pattern. The spec file read is the only filesystem-based input for WP content — removing it aligns with the tool-first pattern.
- **Clean field removal:** Removing `work_package_file` entirely (rather than making it optional) follows the principle of not leaving vestigial fields in schemas. No backward compatibility is required.

## Detailed Steps

### Step 1 — Remove `work_package_file` from `WorkPackageDetailSchema`

In `mcp-server/src/schema/work-package.ts`, delete the `work_package_file: z.string()` line from `WorkPackageDetailSchema`. This removes the field from all stored WP data.

### Step 2 — Remove `work_package_file` from `CreateWorkPackageSchema` and make `description` required

In `mcp-server/src/tools/work-package.ts`:
- Delete the `work_package_file` field from `CreateWorkPackageSchema`.
- Change `description` from `.optional()` to required. Since spec files are gone, the `description` field is the sole carrier of the WP specification body. Update the description text to reflect this: "Full specification body for this work package (plan context, scope, deliverables, rationale, etc.). This is the primary source of WP requirements for all agents."
- In the `createWorkPackage` function, remove the line that spreads `work_package_file: args.work_package_file` into the WP detail object.
- Update the tool's top-level `description` string to remove `work_package_file` from the REQUIRED params list and add `description`.

### Step 3 — Verify `WorkPackageSummarySchema.file` is unaffected

In `mcp-server/src/schema/root-index.ts`, the `WorkPackageSummarySchema` has a `file` field that points to `ledger/WP-###.json`. This is the ledger storage path — **not** the spec file path. Confirm this field references the `.ledger/` JSON (not the spec file) and leave it untouched.

### Step 4 — Update standalone import

In `mcp-server/src/storage/ledger-store.ts`, the `importStandaloneProject()` method hardcodes `work_package_file: 'work/WP-001.md'` in the WP detail. Remove this line entirely.

### Step 5 — Update help content

In `mcp-server/src/tools/help-content.ts`:
- Remove `work_package_file` from the `ledger_create_work_package` parameter table and examples.
- Add `description` to the REQUIRED params list.
- Update the example JSON to show `description` instead of `work_package_file`.

### Step 6 — Update MCP server tests

Remove all `work_package_file` references from test fixtures and helpers across the `mcp-server/tests/` directory. This affects ~26 test files and the shared `tests/helpers/fixtures.ts` helper. For each:
- Remove `work_package_file` property from WP detail objects and `makeWorkPackageDetail` calls.
- Where tests create WPs via the tool, remove the `work_package_file` argument and add `description` if not already present.
- Update any assertions that check for `work_package_file` in responses.

### Step 7 — Update Bootstrapper persona

In `personas/ledger-support/src/content/ledger-bootstrapper.md`:
- Remove Step 4 (Create WP Spec Files) entirely.
- Remove Step 5 (Add Status Column to Work Summary Index) entirely.
- In Step 3, remove the `work_package_file` parameter from the `ledger_create_work_package` call instructions. Keep the `description` parameter (already present — ensure it's marked as required).
- In Step 6 (Verify), remove the file cross-check items (items 3 and 4: "Confirm a matching `work/{WP_ID}.md` exists", "Confirm `work.md` exists", and "AC content verification").
- Update the Step 7 report template to remove the "Spec File" and "AC Check" columns.
- Remove all references to `work/WP-{NUMBER}.md` and `work.md` from the persona content, including the Capabilities section (filesystem access for spec files).
- Renumber steps after removals.

### Step 8 — Update PM persona

In `personas/ledger/src/content/2-project-manager.md`:
- Remove the entire "Spec File Verification" operational protocol section.
- Remove all references to `work/<WP-ID>.md` and `work.md`.
- Remove the note about `work_package_file` in the `ledger_create_work_package` call guidance.

### Step 9 — Update PM shared partial

In `personas/shared/partials/pm-output-format.md`:
- Remove the AC content fidelity check (the sub-bullet about comparing `acceptance_criteria` against `## Acceptance Criteria` section of spec file).
- Remove `work.md` and `work/WP-###.md` from the file layout diagram.
- Simplify the verification section to only check ledger state via tools.

### Step 10 — Update Developer persona (Agent 3)

In `personas/ledger/src/content/3-developer.md`:
- Replace the spec file input reference: change "The Work Package: The individual work package specification file (`work/WP-###.md`) containing requirements, technical constraints, and acceptance criteria." to: "The Work Package: Retrieved via `ledger_get_work_package` — the `description` field contains the full specification (plan context, scope, deliverables, rationale, constraints, notes)."
- In the workflow step, replace "read WP detail (via `ledger_get_work_package` and the `work/WP-###.md` specification file)" with "read WP detail (via `ledger_get_work_package`)".

### Step 11 — Update QA persona (Agent 4)

In `personas/ledger/src/content/4-qa.md`:
- Replace "Original Work Package: The individual work package specification file (`work/WP-###.md`) — the source of truth for requirements and AC." with: "Original Work Package: Retrieved via `ledger_get_work_package` — the `description` field contains the full specification, and the `acceptance_criteria` array is the source of truth for AC."

### Step 12 — Update Security Auditor persona (Agent 5)

In `personas/ledger/src/content/5-security-auditor.md`:
- Replace "Work Package Details: The individual work package specification file (`work/WP-###.md`)." with: "Work Package Details: Retrieved via `ledger_get_work_package` — the `description` field contains the full specification."

### Step 13 — Update Reviewer persona (Agent 6)

In `personas/ledger/src/content/6-reviewer.md`:
- Replace "Work Package Details: The individual work package specification file (`work/WP-###.md`)." with: "Work Package Details: Retrieved via `ledger_get_work_package` — the `description` field contains the full specification."

### Step 14 — Update Release Engineer persona (Agent 7)

In `personas/ledger/src/content/7-release-engineer.md`:
- Replace "Work Package Details: The individual work package specification file (`work/WP-###.md`)." with: "Work Package Details: Retrieved via `ledger_get_work_package` — the `description` field contains the full specification."

### Step 15 — Update Documentation persona (Agent 8)

In `personas/ledger/src/content/8-documentation.md`:
- Replace "load their specs (`work/WP-###.md`) and detail files (via `ledger_get_work_package`)" with: "load their detail (via `ledger_get_work_package`) for specification content and artifact information".

### Step 16 — Update Synthesis persona (Agent 9)

In `personas/ledger/src/content/9-synthesis.md`:
- Replace "Individual work package specification files (`work/WP-###.md`) for referencing original requirements." with: "Work package details via `ledger_get_work_package` — the `description` field contains the original requirements and specification."

### Step 17 — Update Ledger Doctor persona

In `personas/ledger-support/src/content/ledger-doctor.md`:
- Review for any references to `work_package_file` or spec files and remove them.

### Step 18 — Update Ledger Knowledge Archiver persona

In `personas/ledger-support/src/content/ledger-knowledge-archiver.md`:
- Review for any references to spec files and remove them.

### Step 19 — Build and validate

- Run `npm run build` in `mcp-server/` to verify TypeScript compilation.
- Run `npm test` in `mcp-server/` to verify all tests pass.
- Run `node scripts/build-personas.js` to rebuild all persona outputs.
- Run `node scripts/build-personas.js --check` to verify no staleness.

## Dependencies
- Steps 1–2 (schema + tool changes) must precede Step 6 (test updates).
- Step 4 (standalone import) depends on Step 1 (schema change).
- Step 5 (help content) depends on Step 2 (tool parameter changes).
- Steps 7–18 (persona updates) are independent of each other and can be done in parallel.
- Steps 7–18 depend on Steps 1–5 being completed (to understand the new tool interface).
- Step 19 depends on all prior steps.

## Required Components
- `mcp-server/src/schema/work-package.ts` — remove `work_package_file` field
- `mcp-server/src/tools/work-package.ts` — remove `work_package_file` param, make `description` required
- `mcp-server/src/tools/help-content.ts` — help text update
- `mcp-server/src/storage/ledger-store.ts` — standalone import update
- `mcp-server/tests/helpers/fixtures.ts` — remove `work_package_file` from shared fixtures
- `mcp-server/tests/` — ~26 test files referencing `work_package_file`
- `orchestrator/tests/test_deep_agent_integration.py` — update prompt string that instructs the LLM to call `ledger_create_work_package` with `work_package_file`
- `personas/ledger-support/src/content/ledger-bootstrapper.md` — major revision
- `personas/ledger/src/content/2-project-manager.md` — protocol removal
- `personas/shared/partials/pm-output-format.md` — layout/verification update
- `personas/ledger/src/content/3-developer.md` — input reference update
- `personas/ledger/src/content/4-qa.md` — input reference update
- `personas/ledger/src/content/5-security-auditor.md` — input reference update
- `personas/ledger/src/content/6-reviewer.md` — input reference update
- `personas/ledger/src/content/7-release-engineer.md` — input reference update
- `personas/ledger/src/content/8-documentation.md` — input reference update
- `personas/ledger/src/content/9-synthesis.md` — input reference update
- `personas/ledger-support/src/content/ledger-doctor.md` — review for spec file refs
- `personas/ledger-support/src/content/ledger-knowledge-archiver.md` — review for spec file refs
- `orchestrator/tests/test_deep_agent_integration.py` — update prompt string that passes `work_package_file` to `ledger_create_work_package` (lines 1107–1112); remove `work_package_file='work/WP-001.md'` and add a `description` value since `description` becomes required

## Assumptions
- The `description` field already contains the full structured Markdown spec body (verified — the Bootstrapper already passes this).
- Agents can parse Markdown headings from the `description` blob just as effectively as from a file (same format, different delivery mechanism).
- No external tooling outside this workspace depends on the `work/WP-###.md` files.
- The GUI does not render or link to `work/WP-###.md` files (verified — the GUI reads from ledger JSON, not plan folder files).
- No backward compatibility is needed — existing stored ledger data with `work_package_file` will simply have that field ignored by the new Zod schema (Zod's default behavior strips unknown keys during `.parse()`).

## Constraints
- The `file` field in `WorkPackageSummarySchema` references the ledger JSON path (`ledger/WP-###.json`), not the spec file. It must be preserved.

## Out of Scope
- Splitting the `description` blob into individual typed fields (scope, deliverables, rationale, etc.). This would add schema complexity for marginal benefit — agents parse Markdown headings from the blob effectively.
- Deleting existing `work/` directories from past projects on disk. This is a cleanup task, not a functional change.
- Changes to the WP Decomposer output format (`work-packages-draft.md`). This intermediate artifact is consumed by the Bootstrapper and is unrelated to spec files.
- Changes to `dependency-analysis.md` or `pipeline-configuration.md` — these are intermediate artifacts produced by other sub-agents.

## Acceptance Criteria

- AC-01: `work_package_file` is completely removed from `WorkPackageDetailSchema` — the field does not exist in the schema.
- AC-02: `work_package_file` is completely removed from `CreateWorkPackageSchema` — the parameter is not accepted by the tool.
- AC-03: `description` is required in `CreateWorkPackageSchema` — calls without it are rejected.
- AC-04: The Bootstrapper persona no longer instructs agents to create `work/WP-###.md` files or `work.md`, and no longer passes `work_package_file` to `ledger_create_work_package`.
- AC-05: All agent personas (3–9) reference `ledger_get_work_package` as the sole source of WP specification content — no references to `work/WP-###.md` remain in any persona source.
- AC-06: The PM persona no longer has a "Spec File Verification" protocol or any references to spec files.
- AC-07: The PM shared partial no longer includes AC fidelity cross-checks against spec files.
- AC-08: All MCP server tests pass after schema changes — no test references `work_package_file`.
- AC-09: All persona outputs build successfully (`node scripts/build-personas.js`).
- AC-10: Help content and tool descriptions reflect the new interface (no `work_package_file`, `description` required).

## Testing Strategy

The changes are split between MCP server (TypeScript tests) and persona content (build validation).

**MCP server tests:** Remove `work_package_file` from all test fixtures (~21 test files + shared fixture helper). Verify schema changes compile and all existing tests pass with `work_package_file` removed and `description` required. Add test for `createWorkPackage` without `description` failing validation.

**Persona build validation:** Run `node scripts/build-personas.js --check` to verify no staleness after content changes.

## Test Plan

- `mcp-server/tests/helpers/fixtures.ts` — remove `work_package_file` from `makeWorkPackageDetail` default. Covers AC-01, AC-08.
- `mcp-server/tests/` — ~26 test files: remove all `work_package_file` property references from WP detail objects and tool call arguments. Covers AC-02, AC-08.
- `orchestrator/tests/test_deep_agent_integration.py` — update the PM live-test prompt at lines 1107–1112: remove `work_package_file='work/WP-001.md'` from the `ledger_create_work_package` call instruction and add `description='...'`. Covers AC-02, AC-08.
- `mcp-server/tests/tools/work-package.test.ts` — add test case: `createWorkPackage` without `description` → expect Zod validation error. Covers AC-03.
- `mcp-server/tests/integration/full-workflow.test.ts` — verify full workflow still passes without `work_package_file` and with `description` required. Covers AC-08.
- `node scripts/build-personas.js --check` — verify all persona outputs are fresh after content changes. Covers AC-09.
- `grep -r "work_package_file" personas/` — verify no spec file references remain in persona sources. Covers AC-04, AC-05, AC-06, AC-07.
- `grep -r "work_package_file" mcp-server/src/` — verify no references remain in MCP server source. Covers AC-01, AC-02, AC-10.

## Documentation Updates

- `personas/ledger/README.md` — remove `work.md` and `work/WP-###.md` from the file layout code block (line 581), the Stage 2 output list (lines 197–198), and the Stage 3 and Stage 4 instructions that direct users to "Open the work package specification (`work/WP-###.md`)" (lines 224, 245). Replace with guidance to retrieve WP details via `ledger_get_work_package`.
- `personas/docs/agents/project-manifest/constraints.md` — review for any references to WP spec files in directory layout or workflow constraints (none found at time of writing; verify after implementation).
- `personas/docs/agents/project-manifest/data-flows.md` — review the bootstrapping data flow for spec file creation steps (none found at time of writing; verify after implementation).
- Root `AGENTS.md` — no update needed (does not reference WP spec files directly).
- `mcp-server/docs/agents/project-manifest/api-surface.md` — update `ledger_create_work_package` parameter documentation (remove `work_package_file`, mark `description` required). Both `WorkPackageDetail` interface entries require the same update.
- `mcp-server/changelog.md` — add entry for schema changes and tool parameter updates.
- `personas/changelog.md` — add entry for spec file elimination.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Agents parsing `description` blob less effectively than structured file** | The blob contains the same Markdown with the same section headings. Agents already parse Markdown from tool responses. No behavioral change expected. |
| **Existing stored data has `work_package_file`** | Zod `.parse()` strips unknown keys by default. Existing `.ledger/WP-###.json` files with `work_package_file` will simply have the field silently dropped on read. No migration needed. |
| **Human readability loss** | The GUI project detail page and `ledger_get_work_package` CLI output provide human-readable WP details. The `description` field renders as readable Markdown. |
| **In-flight projects expecting spec files** | Projects already bootstrapped will have spec files on disk. Agents will simply stop reading them. The files can be left in place with no harm. |
| **Wide test surface (~21 files)** | The change is mechanical (remove a property from fixture objects). Use search-and-replace across the test directory. |
| **No tool to update `description` after WP creation** | There is currently no `ledger_update_work_package` tool that can modify `description` or `title` post-creation. In practice this is not a problem — the current spec files were also write-once artifacts (no agent modifies them after bootstrapping). The `work-packages-draft.md` intermediate file remains available for reference. If a future need arises to modify WP descriptions post-creation, a dedicated update tool can be added at that time. |

## Recommended Workflow
- **Workflow:** ledger
- **Rationale:** Cross-module changes spanning MCP server schema, tool code, and 10+ persona source files across two sub-projects benefit from formal QA and review stages.
