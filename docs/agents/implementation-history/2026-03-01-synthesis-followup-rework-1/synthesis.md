# Project Synthesis Report

**Plan:** 2026-03-01-synthesis-followup-rework-1  
**Date:** 2026-03-01  
**Status:** COMPLETE  
**Prepared by:** Head of Operations (Synthesis Agent)

---

## Executive Summary

This session addressed four follow-up work packages identified from prior synthesis recommendations. All four packages were assigned to the Documentation agent and closed successfully through the full pipeline (implementation → QA → code-review → documentation). The session delivered:

1. **Schema compliance hardening** — 35 invalid `assigned_to: 'Developer Agent'` values in test files were normalized to the canonical `'Developer'` role, making the test suite fully compliant with the `AGENT_ROLES` schema.
2. **Refactor: `resolveStore()` helper** — a duplicated 5-line store-resolution ternary in `work-package.ts` was extracted into a private, non-exported helper, reducing repetition and formalizing the dual-caller overload pattern.
3. **Documentation ordering fix** — Constraint #60 was moved from an out-of-sequence position (between #32 and #33) to its correct location after #59 in `constraints.md`.
4. **Git pre-commit hook** — A POSIX sh pre-commit hook (`build-personas.js --check`) and a one-time setup script (`install-hooks.js`) were created, with documentation spread across `README.md`, `personas/constraints.md`, `mcp-server/tech-stack.md`, and `AGENTS.md`.

The test suite remained green throughout: **982 tests across 33 files, 0 failures**, verified at each WP.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 4 / 4 COMPLETE |
| Pipeline passes | 16 / 16 PASS (4 × implementation, QA, code-review, documentation) |
| Tests passed | 982 |
| Tests failed | 0 |
| TypeScript compile errors | 0 |
| Files modified (code) | `mcp-server/src/tools/work-package.ts` |
| Files modified (tests) | 6 test files |
| Files modified (docs/config) | `constraints.md` (×2), `api-surface.md`, `tech-stack.md` (×2), `README.md`, `AGENTS.md`, `personas/constraints.md` |
| New files created | `.githooks/pre-commit`, `scripts/install-hooks.js` |

---

## Work Package Outcomes

### WP-001 — Test Schema Compliance

**Goal:** Remove all invalid `assigned_to: 'Developer Agent'` values from test files.

**Outcome:** 35 occurrences replaced with `'Developer'` across 6 test files using a targeted sed pass. 1 intentional exemption preserved: `project_comments.agent` at `full-workflow.test.ts:717` (typed as `z.string()`, not schema-validated). Constraint 61 added to `mcp-server/constraints.md` formally documenting this distinction.

**Note:** The AC stated "4 out-of-scope strings remain" — QA and code review both flagged this as imprecise. Three of those strings use lowercase `'agent'` and are invisible to a case-sensitive grep; only 1 true exemption exists. Functionally correct, but future WP authors should avoid enumerating out-of-scope items with different casing than the verification command.

---

### WP-002 — `resolveStore()` Refactor

**Goal:** Extract the duplicated store-resolution ternary in `work-package.ts` into a private helper.

**Outcome:** `resolveStore()` added at line 918 of `work-package.ts`, called by `propagateDependencyUnblock` and `propagateDependencyReblock`. Not exported. Documented in `api-surface.md` (Internal Utilities section). Reviewer identified a Gold Nugget (see Strategic Recommendations) which was acted upon: Architectural Pattern 9 added to `tech-stack.md` documenting the dual-caller overload pattern.

---

### WP-003 — Constraint Ordering Fix

**Goal:** Move misplaced Constraint #60 (`noUnusedLocals`) from between #32 and #33 to after #59.

**Outcome:** Pure document reordering, no content changes. Final ordering: `#59 → line 1195`, `#60 → line 1217`, `#61 (new, from WP-001) → line 1250`. Verified by QA and Reviewer.

---

### WP-004 — Git Pre-Commit Hook

**Goal:** Create a pre-commit hook that runs `build-personas.js --check` to guard against stale persona output, plus a one-time setup script.

**Outcome:** `.githooks/pre-commit` (POSIX sh, chmod +x) and `scripts/install-hooks.js` (CJS) created. All 5 acceptance criteria met. Documentation agent caught a gap: `AGENTS.md` Root-Level Tooling table was missing the `install-hooks.js` entry — added.

**Notable deviation:** The WP specified ESM `import` syntax for `install-hooks.js`. All 7 existing scripts in `scripts/` use CJS `require()`. Developer correctly used CJS and flagged the WP specification as factually wrong. Reviewer confirmed the CJS decision.

---

## Strategic Recommendations

### 1. Dual-Caller Store Overload Pattern (ACTIONED — WP-002)

The `string | { store: LedgerStore }` overload pattern used in `propagateDependencyUnblock`/`propagateDependencyReblock` is now documented as **Architectural Pattern 9** in `mcp-server/docs/agents/project-manifest/tech-stack.md`. Future tool authors who write functions with dual-caller requirements (top-level vs internal) should follow this pattern to avoid redundant `LedgerStore` construction and potential double-locking.

### 2. `project_comments.agent` Is Free-Text, Not Role-Validated (ACTIONED — WP-001)

**Constraint 61** has been added to `mcp-server/docs/agents/project-manifest/constraints.md` documenting this distinction. `assigned_to` requires a canonical `AgentRole` from `AGENT_ROLES`; `project_comments.agent` is `z.string()` and accepts any string. Future WP authors and test writers must not confuse these two fields.

### 3. PM WPs Should Verify Module Format in `scripts/` Before Specifying It

The WP-004 specification incorrectly required ESM syntax for `install-hooks.js`. All 7 scripts in `scripts/` use CJS. This is the second time a WP has had a factually incorrect technical constraint (similar to past AC wording issues).

**Recommendation:** Before a WP specifies a module format, the PM agent should check the target directory's existing files. A simple grep for `^import ` vs `^const .* = require(` in `scripts/*.js` would prevent this class of error.

### 4. AC Wording: Don't Enumerate Out-of-Scope Items by Casing Variant

WP-001's AC1 said "returns only the 4 out-of-scope strings." Three of those used a lowercase variant invisible to the verification command. Both Developer and QA independently flagged this ambiguity.

**Recommendation:** When writing ACs, only enumerate out-of-scope items that would produce false positives in the stated verification command. Strings that are inherently safe (different casing, different field) should be described as a category rather than enumerated.

---

## Next Steps

1. **No rework items.** All 4 WPs closed cleanly on first attempt (revision: 0 on all).
2. **Monitor `scripts/` module format discipline.** The PM agent should add a check for CJS vs ESM in `scripts/` to prevent future WP specification errors.
3. **Dual-caller pattern adoption.** Architectural Pattern 9 in `tech-stack.md` is now available — future code review passes on tool functions should verify new dual-caller functions adopt it.
4. **Pre-commit hook activation.** Developers new to the workspace must run `node scripts/install-hooks.js` after cloning. Consider adding this to CI onboarding documentation if CI is ever introduced.
5. **Constraint doc health.** Three constraints were added in this session (61 + personas #42, #43). The `constraints.md` files should be reviewed holistically at the next maintenance window to ensure numbering remains sequential and sections stay coherent.
