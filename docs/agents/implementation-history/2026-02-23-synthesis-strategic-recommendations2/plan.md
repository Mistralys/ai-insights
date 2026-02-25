# Plan

## Summary

Implement the six strategic recommendations surfaced in the [synthesis report](../2026-02-23-extend-build-system-vanilla-standalone/synthesis.md) from the "Extend Build System — Vanilla & Standalone" project. The recommendations range from low-effort copy edits to a new build-script feature (`--strict`), a schema validation rule, constraint numbering cleanup, and a vanilla deployment decision. Item 4 (AGENTS.md navigation rows) was already resolved during WP-006 and requires no further action.

## Architectural Context

### Build system (`scripts/build-personas.js` — 660 lines)

The script processes three suites (`ledger`, `vanilla`, `standalone`) via a three-phase template engine:

1. **Partial resolution** — `resolvePartials()` replaces `{{> name}}` markers from a merged partials map (shared base + suite-specific override). Unresolved partials emit `[WARN]` and are left as-is (line 199).
2. **Conditional resolution** — `resolveConditionals()` processes `{{#if flag}}…{{else}}…{{/if}}`.
3. **Variable interpolation** — `resolveVariables()` replaces `{{var}}` markers. Unresolved variables emit `[WARN]` and are left as-is (line 254).

The module-level `warnings` counter tracks all `[WARN]` emissions. The script already supports `--check` (exit 1 if output stale) and `--dry-run` (preview without writes) flags but has **no `--strict` flag** that would fail on unresolved markers.

### `SHARED_PARTIALS_DIR` loading (lines 96–100)

The `loadPartials()` function loads from `personas/shared/partials/` if the directory exists, but silently skips it with no warning if the path doesn't exist — identified as medium-severity tech debt.

### Sync pipeline (`scripts/sync-personas.js`)

At line 488, `buildArgs` is hardcoded to `['--suite', 'ledger,standalone']`, explicitly excluding vanilla. Constraint 31 documents this as intentional. No vanilla sync functions exist.

### Vanilla H1/handoff divergence

| File | H1 Title | Mission Identity | Handoff Label |
|------|----------|-----------------|---------------|
| `vanilla/src/content/3-developer.md` | "Lead Implementation Engineer Agent" | "Staff Software Engineer" | "Lead Implementation Engineer" |
| `vanilla/src/content/4-qa.md` | "Lead QA & Validation Agent" | "SDET" | "QA & Validation" |
| `ledger/src/content/3-developer.md` | "Lead Implementation Engineer Agent" | "Staff Software Engineer" | (uses handoff-block partial) |
| `ledger/src/content/4-qa.md` | "SDET" | "SDET" | (uses handoff-block partial) |

Vanilla agent 3 has a 3-way identity split (H1 ≠ Mission ≠ Handoff); agent 4 has a 2-way split (H1 ≠ Mission/Handoff).

### Constraint numbering (`personas/docs/agents/project-manifest/constraints.md` — 115 lines)

Current numbering: 1–8, 9, 9a, 9b, 9c, 10–16, 17–19, 20–22, 21a, 23–26, 27–30. Three ad-hoc alphabetic suffix clusters introduced across WPs to avoid renumbering during active development.

### `_shared.yaml` `default_version` field

- `ledger/_shared.yaml`: has `default_version: "3.5.0"` ✓
- `vanilla/_shared.yaml`: has `default_version: "1.0.0"` ✓
- `standalone/_shared.yaml`: has `default_version: "1.0.0"` ✓ (added during WP-004)

No build-time validation ensures this field is present.

---

## Approach / Architecture

The six recommendations are grouped into five actionable work packages (item 4 is already done):

| WP | Recommendation | Type | Effort |
|----|---------------|------|--------|
| WP-001 | Align vanilla H1 titles and handoff labels (rec #2) | Content edit | Low |
| WP-002 | Add `--strict` flag to `build-personas.js` (rec #1) | Feature | Medium |
| WP-003 | Validate `default_version` in `_shared.yaml` (rec #6) | Feature | Low |
| WP-004 | Consolidate `constraints.md` numbering (rec #5) | Documentation | Low |
| WP-005 | Document vanilla deployment decision in `constraints.md` (rec #3) | Documentation | Low |

Item 4 (AGENTS.md) is already resolved and requires no work package — noted below in Out of Scope.

---

## Rationale

- **WP-001 first:** The vanilla title fix is low-risk, zero-dependency, and immediately improves persona coherence. It unblocks any future vanilla deployment work with a clean state.
- **WP-002 (--strict):** This is the highest value recommendation — it converts a class of silent build errors into hard failures. Placed second because the fix in WP-001 may introduce transient warnings during development.
- **WP-003 (default_version validation):** Naturally pairs with WP-002 as both add build-time validation. Could be implemented in the same session.
- **WP-004 and WP-005 (documentation):** Pure documentation changes that can be done independently. Placed last because they have no code dependencies and no risk of regressions.

---

## Detailed Steps

### WP-001 — Align vanilla persona H1 titles and handoff labels

**Goal:** Eliminate the identity split in vanilla agents 3 and 4.

1. Edit `personas/vanilla/src/content/3-developer.md`:
   - Change H1 from `# Lead Implementation Engineer Agent ({{role}})` to `# Staff Software Engineer ({{role}})`.
   - Change handoff label from `AGENT: Lead Implementation Engineer` to `AGENT: Staff Software Engineer`.

2. Edit `personas/vanilla/src/content/4-qa.md`:
   - Change H1 from `# Lead QA & Validation Agent ({{role}})` to `# SDET ({{role}})`.
   - Change handoff label from `AGENT: QA & Validation` to `AGENT: SDET`.

3. Run `node scripts/build-personas.js --suite vanilla` and verify generated output reflects the changes.

4. Run `node scripts/build-personas.js --suite vanilla --check` to confirm no stale files.

### WP-002 — Add `--strict` flag to `build-personas.js`

**Goal:** Provide a CI-grade build mode that exits non-zero if any unresolved `{{variable}}` or `{{> partial}}` markers remain in generated output.

1. Add `--strict` to the CLI flags section (after `--check` / `--dry-run`):
   ```
   const STRICT = process.argv.includes('--strict');
   ```

2. After the output assembly step (after `collapseBlankLines`), add a post-build marker scan when `STRICT` is enabled:
   - Search the assembled `output` string for the regex `/\{\{>?\s*[\w-]+\}\}/g`.
   - If any matches are found, emit `[STRICT] Unresolved marker(s) in <suite>/<target>/<filename>: <markers>` to stderr and increment a new `strictFailures` counter.

3. In the summary section at the end of the script, when `STRICT` is true and `strictFailures > 0`, exit with code 1.

4. Add `console.warn` in the `loadPartials()` function's else branch (when `SHARED_PARTIALS_DIR` does not exist) — resolving the medium-severity tech debt:
   ```javascript
   } else {
     console.warn(`[WARN] Shared partials directory not found: ${SHARED_PARTIALS_DIR}`);
     warnings++;
   }
   ```

5. Update the script's JSDoc header to document the new flag.

6. Update `personas/docs/agents/project-manifest/api-surface.md` to document the `--strict` flag.

7. Update `personas/docs/agents/project-manifest/constraints.md` to add a note about `--strict` mode behaviour (unresolved markers cause exit 1).

### WP-003 — Validate `default_version` in `_shared.yaml` at build time

**Goal:** Ensure every suite's `_shared.yaml` contains `default_version`, preventing `undefined` from reaching generated output.

1. In `buildForTarget()` (after loading `sharedMeta`), add a validation check:
   ```javascript
   if (!sharedMeta.default_version) {
     console.error(`[ERROR] Missing 'default_version' in ${suite}/_shared.yaml`);
     process.exit(1);
   }
   ```

2. Update `personas/docs/agents/project-manifest/api-surface.md` to document this validation rule under the metadata schema section.

3. Update `personas/docs/agents/project-manifest/constraints.md` to add a constraint that `default_version` is required in all `_shared.yaml` files.

### WP-004 — Consolidate `constraints.md` numbering

**Goal:** Renumber all constraints sequentially, eliminating ad-hoc alphabetic suffixes (9a/9b/9c, 13a–13d, 21a).

1. Read the full current `constraints.md` and map out all constraint numbers.

2. Renumber all constraints to a clean sequential list (1, 2, 3, … N), preserving existing section groupings and content.

3. Grep the entire workspace for constraint number references (e.g., `constraint 9a`, `rule 13d`, etc.) in:
   - Other manifest documents (`api-surface.md`, `data-flows.md`, `README.md`)
   - Root `AGENTS.md`
   - `scripts/build-personas.js` (code comments)
   - Any plan documents that might cross-reference constraint numbers

4. Update all cross-references to use the new sequential numbers.

5. Verify no broken references remain via a final workspace-wide grep.

### WP-005 — Document vanilla deployment decision

**Goal:** Formalise the vanilla deployment strategy as a permanent constraint.

1. Add a new constraint to `constraints.md` (at the end of the Sync Script Conventions section) documenting the explicit product decision:
   - Vanilla suite output is intentionally excluded from automated sync.
   - Deployment of vanilla personas to an IDE is a manual copy-paste operation.
   - If automated vanilla sync is ever desired, it must be implemented as an explicit opt-in `--target` value in `sync-personas.js` (e.g., `--target vanilla-vscode`, `--target vanilla-claude`) — never silently included in the default `--suite` list.

2. This formalises the existing constraint 31 (formerly 21a) into a more comprehensive decision record.

---

## Dependencies

- WP-001 has no dependencies — can start immediately.
- WP-002 depends on WP-001 being complete (to avoid false positives from vanilla title changes during development).
- WP-003 has no dependency on WP-001 or WP-002, but is best sequenced after WP-002 since both modify `buildForTarget()`.
- WP-004 has no code dependencies — pure documentation. Should run after WP-002 and WP-003 so any new constraints they add are included in the renumbering.
- WP-005 has no code dependencies but should run alongside or after WP-004 so the new constraint gets a sequential number.

**Recommended execution order:** WP-001 → WP-002 → WP-003 → WP-004 → WP-005

---

## Required Components

### Existing files to modify
- `personas/vanilla/src/content/3-developer.md` (WP-001)
- `personas/vanilla/src/content/4-qa.md` (WP-001)
- `scripts/build-personas.js` (WP-002, WP-003)
- `personas/docs/agents/project-manifest/api-surface.md` (WP-002, WP-003)
- `personas/docs/agents/project-manifest/constraints.md` (WP-002, WP-003, WP-004, WP-005)

### No new files or services required

All changes are modifications to existing files. No new dependencies, no new directories, no infrastructure changes.

---

## Assumptions

- The `warnings` counter is already the correct mechanism for tracking non-fatal issues; `--strict` elevates unresolved markers from warnings to errors.
- The `collapseBlankLines` output is the final stage where markers can be detected — no further transformation occurs after it.
- Constraint cross-references exist primarily in manifest documents and plan files; code comments rarely cite constraint numbers by their numeric ID.
- The vanilla deployment decision ("manual only") reflects the current product intent and does not need user confirmation to document.

---

## Constraints

- **Backward compatibility:** `node scripts/build-personas.js` (no args) must continue to produce byte-identical ledger output. The `--strict` flag must be opt-in only.
- **No scope creep:** The `serializeTools()` / `serializeToolsList()` consolidation (listed as low-severity tech debt) is explicitly left out of this plan — it changes the function signature surface and has no user-facing benefit.
- **No generated file edits:** All changes flow through `src/` templates. Generated output is rebuilt, never hand-edited.
- **Constraint renumbering must be atomic:** WP-004 updates all references in a single pass to avoid a state where some documents reference old numbers and others reference new ones.

---

## Out of Scope

- **Recommendation #4 (AGENTS.md navigation rows):** Already resolved during WP-006 of the prior project. Confirmed: `AGENTS.md` contains rows for `vanilla/src/` and `standalone/src/`.
- **`serializeTools()` / `serializeToolsList()` unification:** Low-priority tech debt that adds negligible value.
- **Module-level mutable state refactor:** The `warnings` / `staleCount` / `builtCount` pattern is acceptable for a synchronous single-pass script.
- **`cc_name` computation consolidation:** Minor readability debt only.
- **Unit-test-auditor thin description:** Listed as low-severity tech debt but is a content/product decision, not a structural fix. Left for a future content review.
- **Vanilla sync implementation:** This plan documents the decision to keep vanilla manual-only; it does **not** implement any sync functions for vanilla.

---

## Acceptance Criteria

### WP-001
- AC1: `personas/vanilla/src/content/3-developer.md` H1 reads "Staff Software Engineer" (not "Lead Implementation Engineer Agent").
- AC2: `personas/vanilla/src/content/3-developer.md` handoff label reads `AGENT: Staff Software Engineer`.
- AC3: `personas/vanilla/src/content/4-qa.md` H1 reads "SDET" (not "Lead QA & Validation Agent").
- AC4: `personas/vanilla/src/content/4-qa.md` handoff label reads `AGENT: SDET`.
- AC5: `node scripts/build-personas.js --suite vanilla --check` exits 0.
- AC6: Generated vanilla output for agents 3 and 4 contains the updated titles.

### WP-002
- AC1: `node scripts/build-personas.js --strict --suite all` exits 0 when all markers are resolved.
- AC2: When a template contains an unresolvable `{{> missing-partial}}`, `--strict` causes exit 1 with a descriptive error message.
- AC3: When a template contains an unresolvable `{{undefined_var}}`, `--strict` causes exit 1.
- AC4: `--strict` without `--suite` defaults to ledger (preserving backward compatibility).
- AC5: The `SHARED_PARTIALS_DIR` missing-directory path now emits a `[WARN]`.
- AC6: `api-surface.md` documents the `--strict` flag.
- AC7: `constraints.md` documents `--strict` mode behaviour.
- AC8: The JSDoc header at the top of `build-personas.js` includes `--strict` in the usage examples.

### WP-003
- AC1: If `default_version` is removed from any `_shared.yaml`, the build script exits with `[ERROR]` and exit code 1.
- AC2: Normal build with all three suites (`--suite all`) still exits 0 (since all `_shared.yaml` files currently have the field).
- AC3: `api-surface.md` documents the validation.
- AC4: `constraints.md` includes a constraint about `default_version` being required.

### WP-004
- AC1: All constraints in `constraints.md` use sequential numbering (no alphabetic suffixes).
- AC2: No broken constraint references exist in the workspace (verified via grep).
- AC3: Content of each constraint is preserved verbatim (only the number prefix changes).

### WP-005
- AC1: `constraints.md` contains an explicit constraint documenting the vanilla manual-only deployment decision.
- AC2: The constraint specifies the opt-in `--target` pattern required for any future vanilla sync implementation.
- AC3: Existing constraint 31 content is incorporated into the new constraint (not duplicated).

---

## Testing Strategy

- **WP-001:** Build check (`--suite vanilla --check` exit 0) + grep generated output for updated titles.
- **WP-002:** Create a temporary test template with an unresolvable marker, run with `--strict`, verify exit 1. Run `--strict --suite all` on clean codebase, verify exit 0. Verify `[WARN]` on missing shared partials dir (rename dir temporarily).
- **WP-003:** Temporarily remove `default_version` from one `_shared.yaml`, run build, verify `[ERROR]` + exit 1. Restore and verify normal build passes.
- **WP-004:** Workspace-wide grep for old constraint numbers after renumbering — zero matches expected.
- **WP-005:** Read-verification of the new constraint text; `--check` confirms no build staleness.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **WP-002: `--strict` regex matches legitimate content** (e.g., a persona teaching users about template syntax with literal `{{example}}`). | The regex specifically matches `{{> partial}}` and `{{variable}}` patterns. Document that explanatory content using these patterns should use backtick code fences, which the regex won't match inside rendered Markdown since the scan runs on the raw assembled string. If edge cases arise, add an `<!-- strict-ignore -->` escape mechanism. |
| **WP-004: Constraint renumbering breaks external references** (e.g., references in `history/key-learnings.md` or plan documents). | Comprehensive workspace grep before and after renumbering. Plan documents are historical records — update in-place if references exist, or leave as-is if they refer to the constraint by description rather than number. |
| **WP-004: Future merge conflicts** if another branch references old constraint numbers. | This risk is acceptable because the workspace is single-developer. Renumbering should be done when no other documentation work is in flight. |
| **WP-002: `--strict` introduces false failures for known optional markers** (e.g., `incident-logging` stub pattern). | The `incident-logging` stub in `shared/partials/` already resolves this specific case. If new optional partials are introduced, they must have stubs in the shared layer — this is already documented in constraint 18. |
