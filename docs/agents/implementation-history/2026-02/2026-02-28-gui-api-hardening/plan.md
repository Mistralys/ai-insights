# Plan

## Summary

Three targeted follow-on items surfaced in the `2026-02-28-ledger-document-archiving-rework-1` synthesis report. This plan addresses all three: closing the `wpId` path-traversal gap in the GUI API, resolving the implicit coupling between `archiveDocuments()` and the GUI plan-read path, and replacing hardcoded archive filename strings in test files with the existing constants.

Work is entirely confined to `mcp-server/`. No MCP tool API contracts change. No breaking changes to the ledger schema.

---

## Architectural Context

### GUI API — `gui/api.ts`

The `assertSafeSlug()` helper (introduced in WP-003 of the prior plan) validates the `slug` parameter in all five slug-bearing handlers. It rejects empty slugs, slugs containing `/`, and slugs containing `..`, returning HTTP 404. The same pattern does **not** yet exist for the `wpId` parameter accepted by `handleGetWorkPackage()`.

`handleGetWorkPackage()` forwards `wpId` unvalidated to `store.wpDetailExists(wpId)` and `store.readWorkPackage(wpId)`, both of which call `wpDetailPath(wpId)` → `join(this.storageDir, \`${wpId}.json\`)`. A traversal `wpId` (e.g., `../../etc/passwd`) can escape `storageDir`. The Zod schema parse of the read result provides a secondary barrier, but the file access itself is not guarded.

### Archive / GUI Read-Path Coupling — `ledger-store.ts` + `project-lifecycle.ts` + `gui/api.ts`

`archiveDocuments(filenames)` preserves original filenames at the destination (`dest = join(this.storageDir, filename)`). `ledger_initialize_project` passes `args.plan_file` to `archiveDocuments()`. `handleGetPlanDocument()` reads back `join(ledgerRoot, slug, PLAN_ARCHIVE_FILENAME)` — always `plan.md`. The two sides stay consistent only when `plan_file === 'plan.md'`. There is currently no enforcement of this invariant: a project initialized with `plan_file: 'design.md'` would silently produce a 404 on the GUI plan endpoint.

The `plan_file` Zod parameter in `project-lifecycle.ts` has a `.describe()` string but no `.refine()` constraint.

### Test Files — `tests/gui/api.test.ts`, `tests/storage/ledger-store.test.ts`

Both test files contain hardcoded `'plan.md'` and `'synthesis.md'` string literals. If the constant values in `constants.ts` ever change, tests would need manual updates. The constants `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` are already exported and available.

---

## Approach / Architecture

Three isolated work packages, each independently deployable:

- **WP-001 — `assertSafeWpId()` guard:** Mirror the `assertSafeSlug()` pattern. Add a non-exported `assertSafeWpId(wpId: string): void` to `gui/api.ts` with identical rejection criteria (empty, contains `/`, contains `..`). Deploy as the second statement in `handleGetWorkPackage()` (after `assertSafeSlug(slug)`). Add a traversal test block to `api.test.ts`.

- **WP-002 — `plan_file` coupling enforcement:** Add a Zod `.refine()` to the `plan_file` parameter in `project-lifecycle.ts` that enforces `plan_file === PLAN_ARCHIVE_FILENAME`. This converts the implicit coupling into an explicit, user-visible validation error at the point of project initialization — rather than a silent 404 later. Update the `.describe()` string to explain why. Update `help-content.ts` if needed.

- **WP-003 — Test constant imports:** In `tests/gui/api.test.ts` and `tests/storage/ledger-store.test.ts`, import `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` from `constants.ts` and replace the 20+ hardcoded occurrences. Exception: literal string values in `writeProjectMeta('plan.md', ...)` calls where `plan.md` is the `planFile` argument to the meta writer (not an archive path) should be assessed individually — replace only those that represent archive filenames, not ones that are genuinely testing the meta writer's acceptance of arbitrary strings.

- **WP-004 — Manifest updates:** Update `api-surface.md` and `constraints.md` to reflect the new `assertSafeWpId()` function and the enforced `plan_file` constraint.

---

## Rationale

- **WP-001:** The `wpId` gap is a genuine traversal surface — the route `GET /api/projects/:slug/work-packages/:wpId` is externally accessible. `assertSafeWpId` is a 3-line addition that closes it completely.
- **WP-002:** Failing fast at initialization (Zod `.refine()`) is preferable to a silent 404 at a GUI endpoint invoked much later. The cost is a `refine()` that will never fire for any well-formed project (everyone passes `plan.md`), but it surfaces immediately if someone attempts a non-standard `plan_file`.
- **WP-003:** Low-risk refactor that decouples tests from the literal string values. Each test should describe intent, not hard-code magic strings.
- **WP-004:** Manifest completeness — all code changes must be documented.

---

## Detailed Steps

1. **WP-001:**
   - Add `assertSafeWpId(wpId: string): void` to `gui/api.ts`, immediately after `assertSafeSlug`.
   - Add `assertSafeWpId(wpId)` as the second statement in `handleGetWorkPackage()` (after `assertSafeSlug(slug)`).
   - Add a `'rejects path-traversal wpIds with NOT_FOUND'` test block to `tests/gui/api.test.ts` covering `'../escape'`, `'a/b'`, and `''`.
   - Run `npm test` — confirm 0 failures and at least +3 new test cases.

2. **WP-002:**
   - Import `PLAN_ARCHIVE_FILENAME` at the top of `project-lifecycle.ts` (it may need adding if only `SYNTHESIS_ARCHIVE_FILENAME` was imported previously).
   - Add `.refine(v => v === PLAN_ARCHIVE_FILENAME, { message: \`plan_file must be '${PLAN_ARCHIVE_FILENAME}' to match the GUI plan document read path\` })` to the `plan_file` Zod field.
   - Update `.describe()` to note the constraint.
   - Update `help-content.ts` if the help text references `plan_file` examples.
   - Add or update a test in `tests/tools/project-lifecycle.test.ts` verifying that a non-`'plan.md'` `plan_file` value is rejected with a Zod validation error.
   - Run `npm test` — confirm no regressions.

3. **WP-003:**
   - In `tests/storage/ledger-store.test.ts`, add import of `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` from `'../../src/utils/constants.js'`.
   - Replace all archive-path occurrences of `'plan.md'` with `PLAN_ARCHIVE_FILENAME` and `'synthesis.md'` with `SYNTHESIS_ARCHIVE_FILENAME`.
   - In `tests/gui/api.test.ts`, add import and replace `plan_file: 'plan.md'` and `'plan.md'` archive path references with the constant. The `'plan.md'` occurrence in `writeFile(join(..., 'plan.md'), ...)` that creates the archived file fixture should also use the constant.
   - Run `npm test` — confirm no regressions.

4. **WP-004:**
   - `api-surface.md`: Document `assertSafeWpId()` in the GUI API Module section, adjacent to `assertSafeSlug()`. Update constraint 40 to note both guards.
   - `constraints.md`: Update constraint 40 to include `handleGetWorkPackage` `wpId` hardening. Add a note to constraint 4's archive clarification about the `plan_file === PLAN_ARCHIVE_FILENAME` enforcement.

---

## Dependencies

| WP | Depends On |
|----|------------|
| WP-001 | None |
| WP-002 | None |
| WP-003 | None |
| WP-004 | WP-001, WP-002, WP-003 (documents the final state) |

All of WP-001, WP-002, and WP-003 are fully independent and can be executed in any order.

---

## Required Components

### Modified Files

| File | WP |
|------|----|
| `mcp-server/gui/api.ts` | WP-001 |
| `mcp-server/src/tools/project-lifecycle.ts` | WP-002 |
| `mcp-server/src/tools/help-content.ts` | WP-002 (if plan_file help text needs update) |
| `mcp-server/tests/gui/api.test.ts` | WP-001, WP-003 |
| `mcp-server/tests/storage/ledger-store.test.ts` | WP-003 |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | WP-002 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-004 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-004 |

---

## Assumptions

- `PLAN_ARCHIVE_FILENAME = 'plan.md'` — no one in this codebase currently initializes a project with a non-standard `plan_file`. The `.refine()` enforces the invariant going forward without breaking any existing usage.
- `assertSafeWpId` uses the same rejection criteria as `assertSafeSlug` (empty, `/`, `..`). WP IDs follow the `WP-###` pattern, which naturally passes all three checks.
- WP-003 replaces only archive filename literals. Occurrences of `'plan.md'` as a `planFile` argument to `writeProjectMeta()` that are used to test arbitrary input acceptance should be evaluated case-by-case.

---

## Constraints

- No changes to the MCP tool schemas beyond the `plan_file` `.refine()` and updated `.describe()`.
- No changes to `ledger-store.ts` — the `archiveDocuments()` internals remain generic.
- All 535 existing tests must continue to pass after each WP.
- Follow all existing conventions: `.js` import extensions, no default exports, `as const` for constants.

---

## Out of Scope

- Route table refactoring (`server.ts` if-else dispatcher) — rated low priority; deferred until route count warrants it.
- Canonicalizing the `archiveDocuments()` destination to `PLAN_ARCHIVE_FILENAME` inside `LedgerStore` — the Zod `.refine()` approach enforces the invariant at the call site without touching the generic storage layer.
- `synthesis_file` coupling (the `synthesis.md` path) — `ledger_complete_synthesis` defaults `synthesis_file` to `SYNTHESIS_ARCHIVE_FILENAME` and the GUI does not currently expose a synthesis-read endpoint, so there is no analogous coupling risk.

---

## Acceptance Criteria

- [ ] `assertSafeWpId(wpId)` exists in `gui/api.ts` (non-exported) and is called as the second statement in `handleGetWorkPackage()`.
- [ ] Path-traversal wpId test block exists in `api.test.ts` covering `'../escape'`, `'a/b'`, and `''`.
- [ ] `plan_file` Zod field in `project-lifecycle.ts` has a `.refine()` enforcing `v === PLAN_ARCHIVE_FILENAME`.
- [ ] `tests/storage/ledger-store.test.ts` imports and uses `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME` for all archive-path occurrences.
- [ ] `tests/gui/api.test.ts` imports and uses `PLAN_ARCHIVE_FILENAME` for archive-path occurrences.
- [ ] All existing tests pass (`npm test`) with test count ≥ 535.
- [ ] `api-surface.md` documents `assertSafeWpId()`.
- [ ] `constraints.md` reflects the `plan_file` enforcement and updated slug/WP ID guard list.

---

## Testing Strategy

Each WP includes its own test coverage:
- **WP-001:** Three new traversal test cases in `api.test.ts`.
- **WP-002:** One new negative test in `project-lifecycle.test.ts` verifying that `plan_file: 'design.md'` is rejected.
- **WP-003:** Pure refactor — no new tests; existing suite confirms correctness.
- **WP-004:** Documentation only; confirmed correct by QA reading the manifest against the code.

Full `npm test` run after each WP.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP-002 `.refine()` breaks an existing test that passes a non-standard `plan_file`** | Grep `tests/` for `plan_file:` occurrences before writing; update any offending test fixtures to use `PLAN_ARCHIVE_FILENAME`. |
| **WP-003 replacement touches non-archive uses of `'plan.md'`** | Review each replacement individually. Any occurrence that is a `plan_file` parameter value used to test arbitrary string acceptance should be left as a literal. |
| **`assertSafeWpId` over-blocks valid WP IDs** | `WP-001`, `WP-002`, etc. contain no `/` or `..` and are non-empty — all pass safely. |
