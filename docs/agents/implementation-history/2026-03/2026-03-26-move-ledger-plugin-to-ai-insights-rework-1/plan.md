# Plan

## Summary

Address all actionable items identified in the synthesis of the "Move Ledger Plugin to AI Insights" plan. This covers five deliverables across both workspaces: documenting the CJS/ESM bridge pattern in a new `scripts/tests/README.md`, cleaning up the stale empty `dist/plugins/ledger/` directory in persona-builder, auditing and resolving pre-existing unresolved template variable warnings in persona build output, codifying the CJS plugin convention in the personas manifest, and publishing persona-builder v2.0.0 to npm.

## Architectural Context

The migration (plan `2026-03-26-move-ledger-plugin-to-ai-insights`) moved the ledger plugin from `ai-persona-builder-STABLE/src/plugins/ledger/` into a local CommonJS module at `ai-insights-dev/personas/plugins/ledger/`. The persona build config (`personas/persona-build.config.js`) loads it via `require('./plugins/ledger')`. Tests live at `scripts/tests/ledger-plugin.test.js` and use a `createRequire(import.meta.url)` bridge to import CJS modules from the ESM Vitest runner. `ai-persona-builder-STABLE` was bumped to v2.0.0 with the `./plugins/ledger` sub-path export removed, but has not yet been published.

Key files:
- `ai-insights-dev/personas/plugins/ledger/` — ported CJS plugin (5 files)
- `ai-insights-dev/scripts/tests/ledger-plugin.test.js` — 50-test suite using `createRequire` bridge
- `ai-insights-dev/personas/persona-build.config.js` — build config requiring local plugin
- `ai-insights-dev/personas/docs/agents/project-manifest/constraints.md` — personas constraints manifest
- `ai-persona-builder-STABLE/package.json` — v2.0.0, no `prebuild` script
- `ai-persona-builder-STABLE/tsup.config.ts` — two entry points (index, cli)
- `ai-persona-builder-STABLE/dist/plugins/ledger/` — empty stale directory

## Approach / Architecture

Five independent deliverables, no sequencing dependencies between them:

1. **`scripts/tests/README.md`** — New documentation file explaining the test directory conventions (CJS/ESM bridge via `createRequire`, file naming, running tests).
2. **`prebuild` npm script** — Add `"prebuild": "rm -rf dist"` to persona-builder's `package.json` scripts. This runs automatically before each `tsup` build, removing the entire `dist/` tree (including stale empty directories like `dist/plugins/ledger/`). Cross-platform note: this requires adding `rimraf` as a dev dependency, or a Node.js inline script, since `rm -rf` is Unix-only — per the ai-insights cross-platform policy, the solution must work on Windows, macOS, and Linux.
3. **Unresolved variable audit** — Trace the six flagged variables (`{{total}}`, `{{model}}`, `{{cc_name}}`, `{{cc_description}}`, `{{role}}`, `{{number}}`) from generated output back to their YAML/Markdown sources and either supply values through the ledger plugin's `onBuildContext` hook or remove unreachable variable references.
4. **CJS plugin convention** — Add a section to `personas/docs/agents/project-manifest/constraints.md` documenting that `personas/plugins/` uses CommonJS and test files use the `createRequire` bridge.
5. **Publish v2.0.0** — Run `npm publish` for `@mistralys/persona-builder` after verifying build + test health.

## Rationale

- These are all cleanup / documentation items flagged by the synthesis. None are architectural changes.
- The `prebuild` script is preferred over manual cleanup because it is automated and prevents stale artifact accumulation after future entry point changes.
- The cross-platform concern for `rm -rf dist` is addressed per the workspace cross-platform policy: Node.js `fs.rmSync` with `{ recursive: true, force: true }` is portable across all three OSes without adding a dependency.
- The unresolved variable audit is traced to source rather than patching generated output, per the personas constraint that generated files must never be edited directly.

## Detailed Steps

### Step 1: Create `scripts/tests/README.md` (ai-insights-dev)

Create `scripts/tests/README.md` covering:
- Purpose of the directory (integration/ported test suites for workspace scripts and plugins)
- The `createRequire(import.meta.url)` bridge pattern: why it's needed (CJS modules in ESM Vitest), how it works, example snippet
- File naming: `.test.js` extension (ESM syntax, processed by Vitest)
- How to run: `npx vitest run scripts/tests/` or via root `vitest.config.ts`
- Note that `personas/plugins/` modules are CommonJS and must be imported via `createRequire`

### Step 2: Add cross-platform `prebuild` script (ai-persona-builder-STABLE)

In `package.json`, add a `prebuild` script that removes `dist/` before each build:
```json
"prebuild": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""
```
This uses Node.js built-in `fs.rmSync` — no new dependency needed. The `force: true` option prevents errors when `dist/` doesn't exist. Runs automatically before `npm run build` due to npm's `pre` lifecycle hook.

After adding, verify: `npm run build` succeeds and `dist/plugins/ledger/` no longer appears.

### Step 3: Audit and resolve unresolved template variables (ai-insights-dev)

3a. Run `node scripts/build-personas.js 2>&1 | grep WARN` to capture the current warnings.

3b. Trace each variable to its source:

| Variable | Expected Source | Investigation Path |
|----------|----------------|--------------------|
| `{{total}}` | Persona count in VS Code frontmatter | Check if `onBuildContext` in `personas/plugins/ledger/index.js` injects `total`. If not, add it (count of personas in the suite). Also check `personas/ledger/src/meta/_shared.yaml` for a `total` field. |
| `{{model}}` | AI model name | Check persona YAML metadata and shared YAML for `model` field. |
| `{{cc_name}}` | Claude Code persona display name | Check if the persona-builder library's base context includes `cc_name`. If it's a frontmatter field from metadata YAML, verify per-persona metadata supplies it. |
| `{{cc_description}}` | Claude Code description | Same investigation as `cc_name`. |
| `{{role}}` | Agent role name | Check if `onBuildContext` injects `role` from persona metadata. The field exists in per-persona YAML (`role: "Security Auditor"` etc.) but may not be threaded into the template context. |
| `{{number}}` | Persona sequence number | Check per-persona YAML for `number` or `order` field. |

3c. For each variable, either:
- **Supply the value** by adding it to the ledger plugin's `onBuildContext` hook (if it's role/suite-specific data), OR
- **Supply the value** in per-persona YAML metadata (if it's per-persona data that the library's base context already maps), OR
- **Remove the reference** from the template source if the variable is no longer relevant.

3d. Re-run `node scripts/build-personas.js` and confirm zero WARN output.

### Step 4: Document CJS plugin convention (ai-insights-dev)

Add a new section to `personas/docs/agents/project-manifest/constraints.md` titled "Plugin Module Convention" covering:
- `personas/plugins/` uses CommonJS (`module.exports` / `require`)
- Rationale: ported from TypeScript library; CJS is compatible with the CJS `persona-build.config.js` loader
- Test files in `scripts/tests/` use ESM syntax with `createRequire(import.meta.url)` bridge for importing CJS plugins
- Any future plugins added to `personas/plugins/` should follow the same CJS convention

### Step 5: Publish persona-builder v2.0.0 (ai-persona-builder-STABLE)

5a. Verify build: `npm run build` → clean exit, `dist/` contains only `index.*` and `cli.*` files (no ledger artifacts).
5b. Verify tests: `npm test` → 228 tests pass.
5c. Verify `package.json` version is `2.0.0`.
5d. Verify `CHANGELOG.md` has the `[2.0.0]` entry.
5e. Publish: `npm publish` (user action — requires npm auth).

## Dependencies

- None between steps — all five are independent and can be parallelized across work packages.
- Step 5 (publish) requires npm authentication and registry access (user action).

## Required Components

### New files
- `ai-insights-dev/scripts/tests/README.md` — test directory documentation (Step 1)

### Modified files
- `ai-persona-builder-STABLE/package.json` — add `prebuild` script (Step 2)
- `ai-insights-dev/personas/plugins/ledger/index.js` — potentially add variables to `onBuildContext` (Step 3)
- `ai-insights-dev/personas/ledger/src/meta/*.yaml` — potentially supply missing metadata fields (Step 3)
- `ai-insights-dev/personas/ledger/src/content/*.md` or `personas/standalone/src/content/*.md` — potentially remove dead variable references (Step 3)
- `ai-insights-dev/personas/docs/agents/project-manifest/constraints.md` — add plugin convention section (Step 4)

## Assumptions

- The six flagged unresolved variables are all pre-existing issues (not regressions from the migration), as confirmed by the synthesis.
- `npm run build` in persona-builder correctly respects the `prebuild` lifecycle hook.
- The `{{total}}`, `{{model}}`, `{{cc_name}}`, `{{cc_description}}`, `{{role}}`, `{{number}}` variables are either missing from the build context or missing from YAML metadata — the audit in Step 3 will determine which.
- The user has npm publish access for `@mistralys/persona-builder`.

## Constraints

- Cross-platform policy: the `prebuild` script must work on Windows, macOS, and Linux (hence `node -e` with `fs.rmSync` rather than `rm -rf`).
- Generated persona output files must never be edited directly — all variable fixes must go through source templates or plugin context.
- `personas/plugins/` must remain CommonJS to stay compatible with the CJS `persona-build.config.js` loader chain.

## Out of Scope

- Refactoring `personas/plugins/ledger/` from CJS to ESM (not requested; CJS is the documented convention).
- Any functional changes to the ledger plugin beyond supplying missing context variables.
- Changes to the persona-builder library beyond the `prebuild` script and npm publish.
- Git operations (commits, tags, branches).

## Acceptance Criteria

- `scripts/tests/README.md` exists and documents the `createRequire` bridge pattern, file naming, and run commands.
- `npm run build` in persona-builder produces a `dist/` directory with no empty stale subdirectories (`dist/plugins/` must not exist).
- `node scripts/build-personas.js` in ai-insights produces zero `WARN` lines for unresolved variables.
- `personas/docs/agents/project-manifest/constraints.md` includes a "Plugin Module Convention" section.
- `@mistralys/persona-builder@2.0.0` is published to npm (user-verified).

## Testing Strategy

- **Step 1:** Manual review of README content for accuracy and completeness.
- **Step 2:** Run `npm run build` in persona-builder, then verify `find dist -type d -empty` returns no results. Run `npm test` to confirm no regressions (228 tests pass).
- **Step 3:** Run `node scripts/build-personas.js 2>&1 | grep -i warn` before and after fixes. Before: six variable warnings. After: zero warnings. Run the full ledger plugin test suite (`npx vitest run scripts/tests/ledger-plugin.test.js`) to confirm no regressions (50 tests pass).
- **Step 4:** Manual review of constraints.md update for accuracy.
- **Step 5:** `npm publish --dry-run` to verify package contents, then actual publish.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Unresolved variables are intentional** (used in downstream processing, not persona-builder rendering) | Step 3 investigation traces each variable to its source before modifying anything. If a variable is intentionally deferred, document it rather than removing it. |
| **`prebuild` hook not triggered by `tsup --watch`** | The `prebuild` hook only fires on `npm run build`, not on `npm run dev` (watch mode). This is acceptable — stale directories only matter in production builds. Document this in a code comment if needed. |
| **npm publish of v2.0.0 breaks downstream consumers** | The CHANGELOG already documents the breaking change. The only known consumer (ai-insights-dev) has already migrated to the local plugin. Publish with `npm publish` (not `--tag next`). |
| **Some WARNs may not be fixable in the ledger plugin** | Variables like `{{model}}` may originate from the persona-builder library's base context rather than the ledger plugin. If so, the fix belongs in per-persona YAML metadata rather than the plugin. The audit step accounts for both paths. |

---

## Implementation Summary

Implemented 2026-03-26. All five deliverables complete.

### Step 1: `scripts/tests/README.md` — Done

Created `scripts/tests/README.md` documenting the `createRequire` bridge pattern, `.test.js` file naming convention, run commands, and the CJS plugin import requirement.

### Step 2: `prebuild` npm script — Done

Added `"prebuild": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""` to `ai-persona-builder-STABLE/package.json`. Verified: `npm run build` succeeds, `dist/` contains no empty stale subdirectories, 228 tests pass.

### Step 3: Unresolved template variables — Done (scope was larger than anticipated)

The plan identified six variable names. The actual audit revealed **130+ warnings** across both suites (ledger and standalone), caused by two distinct root causes:

**Root cause 1 — Standalone suite received ledger frontmatter templates.**
The ledger plugin's `frontmatterTemplates` property was static and applied globally to all suites. Since both suites share the same plugin array, standalone personas were rendered with the ledger CC frontmatter template (which references `{{cc_name}}`, `{{cc_description}}`, `{{role}}`, `{{number}}`, `{{total}}`). Standalone personas have no `role` or `number` fields, so these all became unresolved.

**Fix:** Added an `onSuiteInit` hook to the ledger plugin that dynamically sets or removes `frontmatterTemplates` based on `suite.personaMode`. For `numbered` (ledger) suites, ledger templates are applied. For all other suites, the property is deleted so config-level or library defaults take effect. Added standalone frontmatter templates to `persona-build.config.js` as `frontmatter` config-level defaults.

**Root cause 2 — Missing computed context variables.**
The library computes only six derived fields (`version`, `tools_list`, `tools_json`, `cc_tools_list`, `cc_tools_json`, `cc_file_name_stem`). The old `build-personas.js` script computed additional variables that the library + plugin combination did not replicate.

**Fix:** Extended the ledger plugin's `onBuildContext` hook to inject:
- `total` — `roster.length` (persona count in the suite)
- `model` — falls back to `default_model` from shared YAML when per-persona `model` is absent
- `cc_name` — alias for the library's `cc_file_name_stem` (same value, different key name)
- `cc_description` — derived from roster entry (`title — short`) for ledger, falls back to `description` for standalone

**Additional fix:** Changed `persona['roster']` → `updated['roster']` in the plugin. The roster array comes from `_shared.yaml` and is merged into the context by the library before `onBuildContext` runs — it is not a per-persona YAML field. The old code passed `persona` (raw per-persona metadata) which never contains `roster`.

**Test updates:** Updated 8 existing tests to reflect the behavioral changes (roster/number in context not persona, frontmatter set via `onSuiteInit`). Added 1 new test for `onSuiteInit` suite-scoping behavior. Final: 51 tests pass.

**Result:** Zero `[WARN]` lines from `node scripts/build-personas.js`. 50 files generated successfully.

### Step 4: CJS plugin convention — Done

Added constraints 29–31 under a new "Plugin Module Convention" section in `personas/docs/agents/project-manifest/constraints.md`.

### Step 5: Publish v2.0.0 — Already done

User confirmed `@mistralys/persona-builder` was published as v2.0.1 prior to implementation.

### Implementation Comments

1. **Step 3 was significantly underscoped.** The plan assumed six isolated variable warnings. The actual problem was architectural: the plugin's frontmatter templates applied globally across suites. This required introducing a new lifecycle hook (`onSuiteInit`), standalone frontmatter templates in the build config, and a roster source bug fix. The plan's investigation table correctly identified the variables but not the cross-suite template leakage root cause.

2. **The `onSuiteInit` approach is clean but fragile.** It relies on mutating the plugin object's `frontmatterTemplates` property between suite builds. If the library ever clones the plugin object between suites, this will break. A more robust approach would be per-suite plugin arrays in the build config, but that would require duplicating validation logic. The current approach is acceptable given the library's documented plugin contract.

3. **No YAML metadata changes were needed.** All fixes were in the plugin and build config. The plan anticipated possible YAML edits — none were required because the missing variables were all computable from existing context data.
