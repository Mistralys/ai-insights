# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Summary

This rework plan addresses all actionable items from the `2026-08-04-eliminate-wp-spec-files` synthesis report. It adds missing documentation (inline comments explaining the schema input/storage asymmetry and the schema-replica test pattern's fragility), a regression test asserting the removed `work_package_file` field stays absent, fixes the `help-content.ts` misclassification of `title` as optional, and standardizes phrasing across four persona Inputs sections. These are low-effort, high-confidence changes that close known documentation gaps and prevent silent drift.

## Architectural Context

The `eliminate-wp-spec-files` project removed the `work_package_file` field from all MCP server schemas and promoted `description` to required in `CreateWorkPackageSchema`. The storage schema (`WorkPackageDetailSchema`) intentionally keeps `description` as optional for backward compatibility. Help content in `help-content.ts` provides tool documentation to agents but was not fully updated: `title` remains listed as optional despite being required. Three schema-replica tests in `work-package.test.ts` use local Zod definitions to test input validation that normally fires at the MCP SDK layer — this pattern is fragile but necessary, and currently undocumented.

## Approach / Architecture

All changes are localized, non-breaking additions: inline comments, one test addition, one help-text line move, and four single-word edits in persona source files. No new abstractions, no schema changes, no behavioral changes.

## Rationale

These items were deferred during the original project as low-priority maintenance. Addressing them now prevents: (a) future developers misdiagnosing the input/storage asymmetry as a bug, (b) silent regression if `work_package_file` is accidentally reintroduced, (c) agent confusion from incorrect help output, and (d) inconsistent agent behavior from divergent persona instructions.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Schema-replica fragility: comment vs. shared schema | Inline comment warning | Extract a shared `TestCreateSchema` constant used by both tests and production | The shared constant would couple test files to production module internals; the replica pattern is intentional isolation — a comment is sufficient |
| `title` fix: move line vs. change schema | Move `title` from Optional to Required in help text | Add `.optional()` to `title` in `CreateWorkPackageSchema` | `title` is intentionally required since the title-description project; the help text is wrong, not the schema |
| QA persona phrasing: use field name vs. plain English | Standardize to plain English ("acceptance criteria") | Standardize to code field name (`acceptance_criteria`) | The Inputs section is prose, not an API reference; the majority convention (3/4 personas) already uses plain English |

## Pattern Alignment

- Inline JSDoc comments above schema definitions — follows existing pattern in `mcp-server/src/schema/work-package.ts`
- Schema tests using `safeParse()` and `.shape` property access — follows existing pattern in `mcp-server/tests/schema/work-package-schema.test.ts`
- Help content `## Required Parameters` / `## Optional Parameters` sectioning — follows existing pattern in `mcp-server/src/tools/help-content.ts`
- Persona Inputs section prose style — follows majority convention across `personas/ledger/src/content/`

## Detailed Steps

### Step 1: Document the schema input/storage asymmetry

Add an inline comment above the `description` field in `WorkPackageDetailSchema` (`mcp-server/src/schema/work-package.ts` L119) explaining that `description` is intentionally optional in storage (for backward compatibility with pre-existing JSON) while being required in `CreateWorkPackageSchema` (input).

**File:** `mcp-server/src/schema/work-package.ts`  
**Change:** Add a comment above the `description: z.string().optional()` line within `WorkPackageDetailSchema`.

### Step 2: Add regression test for `work_package_file` absence

Add a test to `mcp-server/tests/schema/work-package-schema.test.ts` asserting that `WorkPackageDetailSchema.shape` does not contain a `work_package_file` key. This prevents silent reintroduction of the removed field.

**File:** `mcp-server/tests/schema/work-package-schema.test.ts`  
**Change:** Add a new `it()` block in the `WorkPackageDetailSchema` describe section.

### Step 3: Add fragility note to schema-replica tests

Add a comment to the schema-replica test `describe` block in `mcp-server/tests/tools/work-package.test.ts` explaining: (a) why replicas are used (Zod validation fires at the MCP SDK layer, not inside the tool function), and (b) the trade-off (replicas won't auto-fail if production schema constraints change — keep them in sync manually).

**File:** `mcp-server/tests/tools/work-package.test.ts`  
**Change:** Add a comment block before or at the first schema-replica test (around L3400).

### Step 4: Fix `title` parameter classification in help content

Move the `title` line from the `## Optional Parameters` section to the `## Required Parameters` section in the `ledger_create_work_package` help text.

**File:** `mcp-server/src/tools/help-content.ts`  
**Change:** Remove the `- **title** (string): Human-readable title for the work package` line from Optional Parameters and add it to Required Parameters.

### Step 5: Standardize persona Inputs phrasing

Change `acceptance_criteria` (code-style field name) to `acceptance criteria` (plain English) in the QA persona's Inputs section to match the convention used by the other three personas.

**File:** `personas/ledger/src/content/4-qa.md`  
**Change:** Line 17 — replace `acceptance_criteria` with `acceptance criteria`.

### Step 6: Rebuild personas

Run the persona build to regenerate output files reflecting the QA persona change.

**Command:** `node scripts/build-personas.js` from workspace root.

### Step 7: Run MCP server tests

Run the full MCP server test suite to verify the new regression test passes and no existing tests break.

**Command:** `cd mcp-server && npm test`

## Dependencies

- Steps 1–5 are independent and can be executed in any order.
- Step 6 depends on Step 5 (persona source change).
- Step 7 depends on Steps 1–4 (MCP server changes).

## Required Components

- `mcp-server/src/schema/work-package.ts` — inline comment addition
- `mcp-server/tests/schema/work-package-schema.test.ts` — new regression test
- `mcp-server/tests/tools/work-package.test.ts` — inline comment addition
- `mcp-server/src/tools/help-content.ts` — line move (Optional → Required)
- `personas/ledger/src/content/4-qa.md` — single-word edit

## Assumptions

- The `title` field in `CreateWorkPackageSchema` is intentionally required (confirmed by `z.string().min(1)` without `.optional()`).
- The `description` field in `WorkPackageDetailSchema` must remain optional for backward compatibility (confirmed by synthesis recommendation #1).
- Plain English is the preferred phrasing convention for persona Inputs sections (confirmed by 3/4 majority).

## Constraints

- No schema changes — this plan adds only documentation, tests, and help-text corrections.
- Persona source files must not be confused with generated output files — only edit files under `personas/ledger/src/content/`.

## Out of Scope

- Adding a word limit or brevity guide to the Bootstrapper's `description` field (excluded per user instruction — no limit by design).
- Any behavioral or schema changes to the MCP server.
- Regenerating CTX docs (can be done separately if needed).

## Acceptance Criteria

- AC-01: `WorkPackageDetailSchema` in `mcp-server/src/schema/work-package.ts` has an inline comment explaining the intentional input/storage asymmetry for the `description` field.
- AC-02: `mcp-server/tests/schema/work-package-schema.test.ts` contains a test asserting `work_package_file` is not a key in `WorkPackageDetailSchema.shape`.
- AC-03: The schema-replica tests in `mcp-server/tests/tools/work-package.test.ts` have a comment explaining the pattern's fragility and the need to keep replicas in sync with production schemas.
- AC-04: `help-content.ts` lists `title` under Required Parameters (not Optional) for `ledger_create_work_package`.
- AC-05: All four persona Inputs sections (QA, Security Auditor, Reviewer, Release Engineer) use consistent plain-English phrasing "acceptance criteria" (not `acceptance_criteria`).
- AC-06: Persona build completes with no staleness after the QA persona edit.
- AC-07: MCP server test suite passes with the new regression test.

## Testing Strategy

The regression test (Step 2) directly asserts the absence of the removed field in the schema shape. The existing test suite validates that no other schema behavior was affected. The persona build's `--check` mode validates output freshness.

## Test Plan

- `mcp-server/tests/schema/work-package-schema.test.ts` — New test: "does not contain work_package_file" — asserts `'work_package_file' in WorkPackageDetailSchema.shape` is `false` — covers AC-02
- Full test suite run (`npm test` in `mcp-server/`) — validates AC-07 and confirms no regressions from help-text and comment changes

## Documentation Updates

- `mcp-server/src/tools/help-content.ts` — move `title` from Optional to Required parameters (AC-04). Per AGENTS.md manifest maintenance rules, this is a help-text correction that does not require manifest updates (no API surface change — the schema was already correct).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Schema-replica test drift in future** | The added comment (Step 3) explicitly warns maintainers to keep replicas in sync — the drift risk is documented, not eliminated |
| **Persona build failure after edit** | The change is a single-word edit in prose, not template syntax — build failure is extremely unlikely |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are small, localized, non-breaking edits within well-understood patterns — a single developer session with self-review is adequate.
