# Plan: Persona Build — Ledger Plugin & ai-insights Migration

> **Prerequisite:** `2026-03-25-persona-build-core-library/plan.md` (Plan 1) must be completed and committed first.
> **Sequence:** Plan 2 of 2

## Summary

Build the ledger-specific plugin for `@mistralys/persona-builder`, migrate ai-insights' persona build system to use the library, verify byte-identical output across all 48 persona files, update project manifests and documentation, and prepare for npm publishing.

## Architectural Context

### Prerequisites from Plan 1

At the start of this plan, the following must be true:

- `ai-persona-builder-STABLE` contains a working library with: template engine, loaders, builder core, plugin architecture, CLI, and tests.
- The library is symlinked into `ai-insights-dev` via `npm link` (or `"link:../ai-persona-builder-STABLE"` in `package.json`).
- The library builds and tests pass independently.

### Current ai-insights Build System (To Be Replaced)

| Component | File | What Happens to It |
|-----------|------|--------------------|
| Build script | `scripts/build-personas.js` (~560 lines) | Rewritten to thin wrapper calling library API |
| Helpers | `scripts/lib/persona-helpers.js` (~350 lines) | Deprecated — all generic functions moved to library |
| Helper tests | `scripts/tests/persona-helpers.test.js` (~160 lines) | Deprecated — tests moved to library |
| Sync script | `scripts/sync-personas.js` (~504 lines) | **Unchanged** — no coupling to helpers, calls build script as subprocess |

### Ledger-Specific Code to Extract into Plugin

| Function / Logic | Current Location | Plugin Hook |
|------------------|------------------|-------------|
| `renderRoster()` | `persona-helpers.js` lines ~240–280 | `onBuildContext` — adds `roster_rendered` to context |
| `renderMcpToolsTable()` | `persona-helpers.js` lines ~290–340 | `onBuildContext` — adds `mcp_tools_table` to context |
| Role validation against `_MANIFEST_ROLE_NAMES` | `build-personas.js` lines ~350–360 | `onValidate` — checks persona `role` against manifest |
| `ccFrontmatterFields()` | `build-personas.js` lines ~50–55 | Absorbed into ledger frontmatter templates |
| `FRONTMATTER_LEDGER_VSCODE` template | `build-personas.js` lines ~60–80 | `frontmatterTemplates.vscode` |
| `FRONTMATTER_LEDGER_CC` template | `build-personas.js` lines ~85–110 | `frontmatterTemplates['claude-code']` |
| `note_only` guard (check mode) | `build-personas.js` lines ~480–510 | `onValidate` — verify `note_only` fields aren't exposed |

### Config File to Create

```javascript
// personas/persona-build.config.js
const { ledgerPlugin } = require('@mistralys/persona-builder/plugins/ledger');
const manifest = require('../shared/workflow-manifest.json');

module.exports = {
  rootDir: __dirname,
  sharedPartialsDir: './shared/partials',
  suites: {
    ledger: {
      srcDir: './ledger/src',
      outVscode: './ledger/vs-code',
      outClaudeCode: './ledger/claude-code',
      personaMode: 'numbered',
    },
    standalone: {
      srcDir: './standalone/src',
      outVscode: './standalone/vs-code',
      outClaudeCode: './standalone/claude-code',
      personaMode: 'standalone',
    },
  },
  plugins: [
    ledgerPlugin({
      manifestRoles: manifest.roles.map(r => r.name),
      warnOnUnknownRole: true,
    }),
  ],
};
```

### Files That Must Stay in ai-insights

| Function | Why | Location |
|----------|-----|----------|
| `syncPersonasVersion()` | Reads `personas/changelog.md`, writes `personas/package.json` — project-specific CI glue | `scripts/build-personas.js` (retained) |
| Role derivation + frontmatter validation | `sync-personas.js` has its own independent parsing — no coupling to helpers | `scripts/sync-personas.js` (unchanged) |
| `_MANIFEST_ROLE_NAMES` | Used by ledger plugin, but sourced from `shared/workflow-manifest.json` — project config, not library code | Passed to plugin via config |

---

## Approach / Architecture

### Ledger Plugin Structure

The ledger plugin ships as a sub-path export from `@mistralys/persona-builder`:

```
ai-persona-builder-STABLE/
├── src/
│   └── plugins/
│       └── ledger/
│           ├── index.ts              # Plugin factory: ledgerPlugin(options)
│           ├── roster-renderer.ts    # renderRoster() — ported from persona-helpers.js
│           ├── mcp-tools-renderer.ts # renderMcpToolsTable() — ported from persona-helpers.js
│           └── role-validator.ts     # Role validation + note_only guard
```

Exported as `@mistralys/persona-builder/plugins/ledger` via `package.json` `"exports"` field.

### Migration Strategy

The migration follows a **shadow-run approach**:

1. Create `personas/persona-build.config.js` pointing at the library.
2. Run the library build against the real persona sources.
3. Diff library output against current generated files (must be empty diff).
4. Only after byte-identical verification: replace `scripts/build-personas.js` with a thin wrapper.
5. Remove deprecated `scripts/lib/persona-helpers.js` and its tests.

### Thin Wrapper for `scripts/build-personas.js`

After migration, the build script becomes a ~40-line wrapper:

```javascript
const { build } = require('@mistralys/persona-builder');
const config = require('../personas/persona-build.config.js');

// Project-specific: sync version from changelog
syncPersonasVersion();

// Delegate to library
const args = parseCliArgs(process.argv.slice(2));
build({ ...config, ...args });
```

This preserves the existing CLI interface (`node scripts/build-personas.js --suite ledger --check`) for `sync-personas.js` subprocess calls and developer habits.

---

## Rationale

| Decision | Why |
|----------|-----|
| **Ledger plugin in same package** | One npm install gives you the plugin. Can be split later if external demand arises. |
| **Shadow-run before replacing** | Zero-risk migration. Byte-identical verification is the gate. |
| **Thin wrapper, not full replacement** | `sync-personas.js` calls `build-personas.js` as a subprocess. Preserving the entry point avoids touching the sync script. |
| **Plugin config receives manifest roles** | Library has no knowledge of `workflow-manifest.json`. The consuming project passes role names via plugin config. |

---

## Detailed Steps

### Phase 1: Ledger Plugin (in `ai-persona-builder-STABLE`)

1. **Port `renderRoster()`** to `src/plugins/ledger/roster-renderer.ts` — convert to TypeScript. Input: roster array + active persona number. Output: rendered Markdown string.
2. **Port `renderMcpToolsTable()`** to `src/plugins/ledger/mcp-tools-renderer.ts` — convert to TypeScript. Input: tools array. Output: Markdown table rows (filters `note_only: true` entries).
3. **Implement role validator** in `src/plugins/ledger/role-validator.ts` — check each persona's `role` field against the provided `manifestRoles` array.
4. **Implement `note_only` guard** in same validator — check that `note_only` MCP tools are not present in generated output (currently a `--check` mode feature).
5. **Define ledger frontmatter templates** — `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_LEDGER_CC`, ported from `build-personas.js` with `ccFrontmatterFields()` inlined.
6. **Create ledger plugin factory** in `src/plugins/ledger/index.ts` — `ledgerPlugin(options)` returns a `PersonaBuildPlugin` that wires up all hooks:
   - `onSuiteInit`: no-op (or log)
   - `onBuildContext`: call `renderRoster()`, `renderMcpToolsTable()`, add results to context
   - `onValidate`: call role validator + note_only guard
   - `frontmatterTemplates`: register ledger templates for `personaMode: 'numbered'`
7. **Add sub-path export** — update library `package.json` `"exports"` to include `"./plugins/ledger"`.
8. **Write ledger plugin tests** — test roster rendering, MCP tools table, role validation (valid + invalid), note_only guard, plugin hook composition.

### Phase 2: Config & Shadow Run (in `ai-insights-dev`)

9. **Create `personas/persona-build.config.js`** — config file as shown in Architectural Context above.
10. **Shadow-run: build with library** — execute `persona-build --config personas/persona-build.config.js` and capture output to a temp directory.
11. **Diff verification** — compare library output against current generated files in `personas/ledger/vs-code/`, `personas/ledger/claude-code/`, `personas/standalone/vs-code/`, `personas/standalone/claude-code/`. Must produce an empty diff for all 48 files.
12. **Debug any differences** — if diffs exist, trace to root cause (template engine behavior, frontmatter rendering, post-processor ordering) and fix in the library or plugin.

### Phase 3: Migration (in `ai-insights-dev`)

13. **Rewrite `scripts/build-personas.js`** — replace the bulk of the file with a thin wrapper that:
    - Calls `syncPersonasVersion()` (retained project-specific logic)
    - Parses CLI args and forwards to the library's `build()` function
    - Preserves exit codes for `--check` and `--strict` modes
14. **Remove `scripts/lib/persona-helpers.js`** — all functions now live in the library.
15. **Remove `scripts/tests/persona-helpers.test.js`** — tests are in the library repo.
16. **Update root `package.json`** — add `@mistralys/persona-builder` as a dependency (using `link:` protocol during development, npm version after publish).
17. **Run `scripts/sync-personas.js`** — verify sync still works (it calls build-personas.js as subprocess, so the thin wrapper must preserve the CLI contract).
18. **Run full build: `node scripts/build-personas.js`** — verify all 48 files build correctly.
19. **Run check mode: `node scripts/build-personas.js --check`** — verify detection of stale output still works.
20. **Run strict mode: `node scripts/build-personas.js --strict`** — verify unresolved marker detection still works.

### Phase 4: Manifest & Documentation Updates (in `ai-insights-dev`)

21. **Update `personas/docs/agents/project-manifest/tech-stack.md`** — document new dependency: `@mistralys/persona-builder`.
22. **Update `personas/docs/agents/project-manifest/api-surface.md`** — update build script function reference (thin wrapper instead of monolithic script).
23. **Update `personas/docs/agents/project-manifest/data-flows.md`** — update build pipeline documentation to reference library.
24. **Update `personas/docs/agents/project-manifest/constraints.md`** — add library dependency constraint, config file convention.
25. **Update `personas/docs/agents/project-manifest/file-tree.md`** — reflect removed files (`persona-helpers.js`) and new files (`persona-build.config.js`).
26. **Update root `AGENTS.md`** — update Root-Level Tooling table (build-personas.js description changes), add library cross-dependency.
27. **Update root `README.md`** — mention library extraction if applicable.

### Phase 5: Library Documentation & Publish Prep (in `ai-persona-builder-STABLE`)

28. **Finalize README** — add ledger plugin documentation section, configuration reference, plugin authoring guide.
29. **Add AGENTS.md** — create agent operating instructions for the library repo.
30. **Verify `npm pack`** — ensure package tarball contains the right files (dist/, no src/ or tests/).
31. **Tag version** — `v1.0.0` release.

---

## Dependencies

- **Plan 1 completed** — library exists and builds.
- **`npm link` active** — ai-insights-dev can import from the library during development.
- **Existing generated persona files** — regression baseline for byte-identical comparison.

---

## Required Components

### New Files (in `ai-persona-builder-STABLE`)

- `src/plugins/ledger/index.ts`
- `src/plugins/ledger/roster-renderer.ts`
- `src/plugins/ledger/mcp-tools-renderer.ts`
- `src/plugins/ledger/role-validator.ts`
- `tests/plugins/ledger/*.test.ts`

### New Files (in `ai-insights-dev`)

- `personas/persona-build.config.js`

### Modified Files (in `ai-insights-dev`)

- `scripts/build-personas.js` — rewritten to thin wrapper
- `package.json` — add library dependency
- `personas/docs/agents/project-manifest/tech-stack.md`
- `personas/docs/agents/project-manifest/api-surface.md`
- `personas/docs/agents/project-manifest/data-flows.md`
- `personas/docs/agents/project-manifest/constraints.md`
- `personas/docs/agents/project-manifest/file-tree.md`
- `AGENTS.md`

### Removed Files (in `ai-insights-dev`)

- `scripts/lib/persona-helpers.js`
- `scripts/tests/persona-helpers.test.js`

---

## Assumptions

- Plan 1 has been executed, committed, and the library is accessible via `npm link`.
- The 48 currently generated persona files serve as the regression baseline.
- `sync-personas.js` will continue to call `build-personas.js` as a subprocess — the thin wrapper preserves this contract.
- The `@mistralys/persona-builder` package scope is available on npm (or a different scope will be chosen before publish).

---

## Constraints

- **Byte-identical output** — the migrated system must produce the exact same output files as the current implementation for all 48 personas. This is the gate for Phase 3.
- **CLI contract preserved** — `node scripts/build-personas.js --suite ledger --check` and all other existing flag combinations must continue to work.
- **No changes to persona source files** — `meta/`, `content/`, `partials/` files remain untouched.
- **`sync-personas.js` unchanged** — no modifications to the sync script.

---

## Out of Scope

- **npm publish** — prepare for it, but actual publish is a separate step the user controls.
- **Other project onboarding** — getting a second project to consume the library is post-v1.0.
- **Watch mode or advanced CLI features** — future enhancement.
- **Changelog entries** — the Changelog Curator handles this separately.

---

## Acceptance Criteria

1. Ledger plugin reproduces all numbered-mode features: roster rendering, MCP tools table, role validation.
2. `persona-build --config personas/persona-build.config.js` builds all 48 personas.
3. Empty diff between library output and current generated files (all 48 files).
4. `node scripts/build-personas.js --check` exits 0 (no stale files detected).
5. `node scripts/build-personas.js --strict` exits 0 (no unresolved markers).
6. `node scripts/sync-personas.js --dry-run` completes without errors.
7. `scripts/lib/persona-helpers.js` and its tests are removed.
8. All relevant project manifests are updated.
9. Library README documents config schema, plugin API, and ledger plugin usage.

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| **Unit (ledger plugin)** | Test roster rendering, MCP tools table, role validation in isolation. |
| **Integration (shadow run)** | Build full persona suite via library, diff against current output. |
| **Regression** | Run `--check` mode after migration — must detect no staleness. |
| **Subprocess contract** | Verify `sync-personas.js` can invoke the rewritten `build-personas.js` successfully. |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Byte differences in output** | Shadow-run catches these before any code is replaced. Root causes are typically whitespace or newline handling — test post-processors thoroughly. |
| **Plugin hook ordering affects output** | Document and test hook execution order. Ledger plugin is the reference implementation. |
| **CLI contract breaks `sync-personas.js`** | Test subprocess invocation explicitly. Thin wrapper preserves all existing flags. |
| **Manifest updates missed** | Checklist in Detailed Steps covers all 6 manifest files. Review before marking complete. |
| **`npm link` path issues on Windows** | Use `link:` protocol in `package.json` which is more reliable cross-platform than `npm link` global symlink. |
