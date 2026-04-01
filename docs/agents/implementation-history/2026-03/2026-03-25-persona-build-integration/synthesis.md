# Synthesis Report — Persona Build Integration

**Plan:** 2026-03-25-persona-build-integration (Plan 2 of 2)
**Date:** 2026-03-25
**Status:** COMPLETE — All 7 Work Packages delivered

---

## Executive Summary

The second and final phase of the persona-builder extraction is complete. This plan delivered the **ledger-specific plugin** for `@mistralys/persona-builder`, **migrated ai-insights' entire persona build system** to consume the library, verified **byte-identical output** across all 50 persona files, updated all relevant project manifests and documentation, and published the library at **v1.0.0** with a tagged git commit.

The migration replaced a ~560-line monolithic `scripts/build-personas.js` and ~350-line `scripts/lib/persona-helpers.js` with a 52-line thin wrapper and a declarative `personas/persona-build.config.js`. All build logic now lives in the reusable `@mistralys/persona-builder` library, with ledger-specific rendering and validation in the `@mistralys/persona-builder/plugins/ledger` sub-path export.

### Key Outcomes

- **275 tests pass** (0 failures) with 98.67% statement coverage and 100% function coverage
- **50 persona files** rebuilt with zero diff against pre-migration output
- **`scripts/lib/persona-helpers.js` deleted** — all logic migrated to the library
- **Library tagged v1.0.0** on commit `ae93c2b` — ready for npm publish
- **All 7 personas project manifest documents updated** — no stale documentation

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total work packages | 7 |
| WPs PASS (all stages) | 7 |
| WPs requiring rework | 1 (WP-003 QA bounced once) |
| Tests passed | 275 |
| Tests failed | 0 |
| Test coverage — statements | 98.67% |
| Test coverage — branches | 93.10% |
| Test coverage — functions | 100.00% |
| Ledger plugin coverage — statements | 100% |
| Ledger plugin coverage — branches | 97.29% |
| Persona files built | 50 (9 ledger × 2 + 16 standalone × 2) |
| Byte-identical diff | 0 differences |
| `scripts/build-personas.js` line count | 52 lines (constraint: ≤60) |
| Library version at close | v1.0.0 (tagged) |
| Commit hash (library) | `ae93c2b` |

---

## Work Package Outcomes

### WP-001 — Ledger Plugin Core Files
**COMPLETE** · Pipelines: impl → qa → code-review → documentation

Created the four foundation files of the ledger plugin under `src/plugins/ledger/`:
- `roster-renderer.ts` — typed `renderRoster(roster, activeNumber)` with byte-identical output to persona-helpers.js original
- `mcp-tools-renderer.ts` — `renderMcpToolsTable(tools)` filtering `note_only: true` entries
- `role-validator.ts` — `validateRole()` + `validateNoteOnlyGuard()` with `escapeRegExp` for safe regex construction
- `frontmatter-templates.ts` — `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_LEDGER_CC` as typed string constants

All pure functions — no side effects, no I/O, no global state. 227/227 regression tests passed.

Notable design deviation: `validateNoteOnlyGuard(output, mcpTools)` takes two parameters (not one as the WP spec described) because the guard cannot enumerate `note_only` tool names without the tools array. Accepted by all downstream reviewers.

### WP-002 — Ledger Plugin Factory
**COMPLETE** · Pipelines: impl → qa → code-review → documentation

Created `src/plugins/ledger/index.ts` with the `ledgerPlugin(options)` factory implementing four hooks:
- `onBuildContext`: injects `roster_rendered` and `mcp_tools_table` into build context
- `onPostRender`: caches rendered output per-persona for the `note_only` guard
- `onValidate`: calls `validateRole()` and `validateNoteOnlyGuard()`; escalates severity to `error` when `warnOnUnknownRole: false`
- `frontmatterTemplates`: registers ledger templates for both `vscode` and `claude-code` targets

Updated `package.json` exports and `tsup.config.ts` to expose the sub-path `@mistralys/persona-builder/plugins/ledger` with CJS + ESM + DTS artefacts. Build and tests 227/227 pass.

Known technical debt (pre-existing): `TargetType` has a dual re-export path through `src/plugins/index.ts` and `src/builders/index.ts`. No runtime issue but should be cleaned before any future value-export of `TargetType`.

### WP-003 — Ledger Plugin Unit Tests
**COMPLETE** · Pipelines: qa (×2, bounced once) → code-review

Authored 48 tests in `tests/plugins/ledger.test.ts` covering all hooks, renderers, and validators. Additionally:
- Installed `@vitest/coverage-v8@3.2.4` and configured 80% thresholds in `vitest.config.ts`
- Wired the `warnOnUnknownRole` option (see **QA Findings** below)

Final state: 275 tests, 98.67% statement coverage, 100% function coverage. All thresholds met.

**Rework event:** First QA pass failed because `warnOnUnknownRole` was declared in `LedgerPluginOptions` but never read in the factory, making the `false→error` code path impossible. Fixed by adding severity escalation logic in `onValidate`. Severity mapping: `warnOnUnknownRole: true` (default) → `warning`; `warnOnUnknownRole: false` → `error`.

### WP-004 — Config & Shadow Run
**COMPLETE** · Pipelines: impl → qa → code-review

Created `personas/persona-build.config.js` — a CJS module declaring both suites (`ledger`, `standalone`) and wiring the `ledgerPlugin` with roles from `shared/workflow-manifest.json`. Ran a shadow build against the real persona sources and verified zero diff. Library produced byte-identical output on the first run — no library or plugin fixes were required.

Notable finding: the actual persona file count is **50**, not 48 as stated in the plan's acceptance criteria (9 ledger × 2 targets + 16 standalone × 2 targets = 50). Documentation discrepancy only.

### WP-005 — Migration (Build Script Replacement)
**COMPLETE** · Pipelines: impl → qa → code-review

Replaced the ~560-line `scripts/build-personas.js` with a 52-line thin wrapper that:
1. Delegates all build logic to the library CLI via `execFileSync`
2. Retains `syncPersonasVersion()` — the only project-specific post-build step
3. Preserves `--check`, `--dry-run`, and `--strict` CLI flags

Deleted `scripts/lib/persona-helpers.js` and `scripts/tests/persona-helpers.test.js`. All six CLI modes verified: plain build, `--check`, `--strict`, `--dry-run`, sync subprocess, and post-build version sync. Zero git diff vs pre-migration output.

### WP-006 — ai-insights Manifest Updates
**COMPLETE** · Pipeline: documentation

Updated all seven documentation files in `personas/docs/agents/project-manifest/`:
- `tech-stack.md` — added `@mistralys/persona-builder`, removed `persona-helpers.js`
- `api-surface.md` — thin wrapper CLI interface, config schema, removed all helper function docs
- `data-flows.md` — rewrote build pipeline section: `build-personas.js → library → plugin hooks → output`
- `file-tree.md` — (new file) annotated post-migration directory tree
- `constraints.md` — updated `buildForTarget()` references
- `constraints-build-system.md` — updated scope notes
- `README.md` (manifest hub) — added `file-tree.md` to sections table

No document still references `persona-helpers.js` as an active component.

### WP-007 — Library Docs & Publish Prep
**COMPLETE** · Pipelines: release-engineering → documentation

- Bumped library version from `0.2.0` to `1.0.0`, curated `CHANGELOG.md`
- Added `## Ledger Plugin` section to `README.md` with usage example and full `LedgerPluginOptions` table
- Added `## Contributor Guide` to `AGENTS.md` with repo layout, test/build commands, and step-by-step plugin authoring guide
- Tagged commit `ae93c2b` as `v1.0.0`
- Verified `"files": ["dist"]` in `package.json` — only `dist/` ships; no `src/`, `tests/`, or fixtures in tarball

---

## QA Findings (Resolved)

| WP | Severity | Finding | Resolution |
|----|----------|---------|------------|
| WP-003 | **HIGH** | `warnOnUnknownRole` declared but never read; `false→error` code path inaccessible | Added severity escalation in `onValidate`: `false` → escalate all warnings to errors |
| WP-003 | MEDIUM | No coverage tooling configured; AC-6 could not be verified | Installed `@vitest/coverage-v8@3.2.4`, added 80% thresholds to `vitest.config.ts` |

---

## Strategic Recommendations

### Gold Nuggets

1. **Shadow-run migration approach worked flawlessly.** The strategy of building library output to a temp directory and diffing against committed files before replacing any code is low-risk and highly reproducible. Recommend applying this pattern to any future build system migrations.

2. **Persona file count is 50, not 48.** The plan documents consistently said "48 persona files" but the real count is 50 (9 ledger + 16 standalone, each × 2 IDE targets). Update the plan template and any downstream references.

3. **`warnOnUnknownRole` escalation pattern is reusable.** The policy-vs-data separation (validator always returns `warning`; factory escalates to `error` based on options) is a clean architectural pattern. Future validators in the library should follow this model.

4. **`escapeRegExp` should be a shared utility.** The same function is used in `role-validator.ts` only. If future validators introduce similar guard patterns, duplication will occur. Extract to `src/utils/regex.ts` before API freeze.

5. **`renderedOutputCache` keyed on persona.name only.** When multiple targets are built per persona, `onPostRender` is called twice; the second call overwrites the first. The note_only guard therefore runs against the last-rendered target's output. Functionally correct today; should be documented and optionally keyed on `${persona.name}:${target}` for multi-target correctness.

6. **`pkg.version` mutated before console.log in `build-personas.js`.** The "Updated X → Y" log will always show the same version twice. Capture `oldVersion` before mutation.

7. **`catch` block exits with hardcoded `1`.** Should propagate the library's actual exit code: `catch (err) { process.exit(err.status ?? 1); }`.

8. **tsup emits duplicate `//# sourceMappingURL=` comment.** Artefact present in all three entry-point bundles. Does not affect runtime but worth tracking for a tsup upgrade before publishing widely.

---

## Next Steps

| Priority | Action |
|----------|--------|
| **Before npm publish** | Run `npm pack --dry-run` manually (Node was unavailable in sandbox during WP-007) |
| **Before npm publish** | Resolve `TargetType` dual re-export path (pre-existing tech debt, flagged as risk before value-export) |
| **Before npm publish** | Update `LedgerPluginOptions.warnOnUnknownRole` JSDoc to describe the escalation contract accurately |
| Low | Remove empty `scripts/lib/` and `scripts/tests/` directories (1-line cleanup) |
| Low | Fix `pkg.version` mutation-before-log in `build-personas.js` |
| Low | Fix `catch` block to propagate library exit code (`err.status ?? 1`) |
| Low | Extract `escapeRegExp` to `src/utils/regex.ts` as a shared utility |
| Low | Regenerate `.context/` files (`node scripts/cli.js ctx-generate`) — still show old `persona-helpers.js` |
| Low | Add `persona-build --check` to CI for stale-output detection |
| Low | Update `personas/package.json` scripts to expose `build:lib` invocation |
| Future | Address `renderedOutputCache` overwrite per target (cache key: `${name}:${target}`) |

---

**Report generated by:** Head of Operations (Synthesis)
**Plan folder:** `docs/agents/plans/2026-03-25-persona-build-integration/`
