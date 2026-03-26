# Plan

## Summary

Move the ledger plugin from `@mistralys/persona-builder` (public library) to the `ai-insights-dev` workspace (private project). The ledger plugin is tightly coupled to ai-insights concepts (workflow manifest roles, MCP tools, agent roster) and cannot be used by any other consumer of the persona-builder library since ai-insights is private. After migration, the persona-builder library ships as a generic, plugin-capable build engine without any ai-insights-specific code, and ai-insights owns the ledger plugin locally.

## Architectural Context

### Current State — persona-builder-STABLE

The ledger plugin lives at `src/plugins/ledger/` in the persona-builder library and consists of 5 source files:

- `src/plugins/ledger/index.ts` — Plugin factory (`ledgerPlugin()`) with 4 hooks + frontmatter templates
- `src/plugins/ledger/frontmatter-templates.ts` — Two YAML frontmatter template constants (VS Code + Claude Code)
- `src/plugins/ledger/roster-renderer.ts` — Pure function `renderRoster()` + `RosterEntry` type
- `src/plugins/ledger/mcp-tools-renderer.ts` — Pure function `renderMcpToolsTable()` + `McpToolEntry` type; filters `note_only` tools
- `src/plugins/ledger/role-validator.ts` — Two pure validators: `validateRole()` + `validateNoteOnlyGuard()`

It has a dedicated test file (`tests/plugins/ledger.test.ts`) with ~70 tests, and is exposed via a sub-path export (`@mistralys/persona-builder/plugins/ledger`) with a dedicated tsup entry point.

The plugin relies only on the plugin type system (`PersonaBuildPlugin`, `ValidationResult`, `TargetType`) exported by the persona-builder core — no other external dependencies.

### Current State — ai-insights-dev

The ai-insights project consumes the ledger plugin in exactly one place:

- `personas/persona-build.config.js` — imports `ledgerPlugin` from `@mistralys/persona-builder/plugins/ledger`, passing `manifestRoles` from `shared/workflow-manifest.json`

The build is invoked via `scripts/build-personas.js`, which delegates to the persona-builder CLI (`dist/cli.js`) with the config file.

The root `package.json` lists `@mistralys/persona-builder` as a dev dependency (`^0.2.0`).

### Plugin Type Dependencies

The ledger plugin imports these types from the persona-builder core:

- `PersonaBuildPlugin` (interface)
- `PersonaMetadata` (interface)
- `SuiteConfig` (interface)
- `ValidationResult` (interface)
- `TargetType` (type alias: `'vscode' | 'claude-code'`)

These are all exported from `@mistralys/persona-builder` main entry point, so a local plugin can import them from the installed package.

## Approach / Architecture

**Move the ledger plugin source into the ai-insights workspace** as a local module under `personas/plugins/ledger/`, then update the build config to import it directly. Remove the plugin from the persona-builder library. The persona-builder remains a generic build tool; ai-insights owns its domain-specific plugin locally.

### Target Directory Layout

```
personas/plugins/
  ledger/
    index.js                      ← Plugin factory (CJS, matching ai-insights persona ecosystem)
    frontmatter-templates.js      ← Frontmatter template constants
    roster-renderer.js            ← renderRoster() pure function
    mcp-tools-renderer.js         ← renderMcpToolsTable() pure function
    role-validator.js             ← validateRole() + validateNoteOnlyGuard()
```

### Language Choice: JavaScript (CJS)

The ai-insights persona ecosystem is JavaScript CommonJS:
- `personas/persona-build.config.js` — CJS
- `scripts/build-personas.js` — CJS
- `scripts/sync-personas.js` — CJS

To maintain consistency and avoid adding a TypeScript build step for the persona subsystem, the ledger plugin should be ported to plain JavaScript (CJS). The TypeScript types themselves are not needed at runtime since the persona-builder library already validates plugin shapes.

**Alternative considered:** Keep as TypeScript and compile. Rejected because the persona subsystem has zero TypeScript infrastructure — adding `tsc` compilation for one plugin is disproportionate overhead.

## Rationale

1. **Encapsulation:** The ledger plugin references ai-insights-specific concepts (workflow manifest roles, numbered agent roster, MCP tool tables with `note_only` security filtering). No external consumer of persona-builder can use it.
2. **Dependency direction:** A public library should not contain private-project-specific code. The plugin should live where its domain concepts live.
3. **Simplification of persona-builder:** Removing the ledger plugin reduces the library's surface area. Its sub-path export, dedicated tsup entry point, and plugin-specific test suite can all be removed.
4. **No functional change:** The move is purely organizational. The plugin's behavior, API, and test coverage are preserved.

## Detailed Steps

### Phase 1: Create the local plugin in ai-insights

1. **Create `personas/plugins/ledger/` directory** in ai-insights-dev.

2. **Port `roster-renderer.js`** — Convert `src/plugins/ledger/roster-renderer.ts` to CJS JavaScript. Export `renderRoster()` and the `RosterEntry` JSDoc type.

3. **Port `mcp-tools-renderer.js`** — Convert `src/plugins/ledger/mcp-tools-renderer.ts` to CJS JavaScript. Export `renderMcpToolsTable()` and the `McpToolEntry` JSDoc type.

4. **Port `role-validator.js`** — Convert `src/plugins/ledger/role-validator.ts` to CJS JavaScript. Export `validateRole()` and `validateNoteOnlyGuard()`. The `escapeRegExp` utility used in this file should be inlined (it's a one-liner).

5. **Port `frontmatter-templates.js`** — Convert `src/plugins/ledger/frontmatter-templates.ts` to CJS JavaScript. Export the two template string constants `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_LEDGER_CC`.

6. **Port `index.js`** — Convert `src/plugins/ledger/index.ts` to CJS JavaScript. Import the local modules. Remove TypeScript type imports (the plugin shape is enforced by the persona-builder runner at call-time). Export `ledgerPlugin()` and the type re-exports for JSDoc consumers.

### Phase 2: Update ai-insights build configuration

7. **Update `personas/persona-build.config.js`** — Change the import from:
   ```js
   const { ledgerPlugin } = require('@mistralys/persona-builder/plugins/ledger');
   ```
   to:
   ```js
   const { ledgerPlugin } = require('./plugins/ledger');
   ```
   No other changes needed — the `manifestRoles` option stays the same.

### Phase 3: Port the test suite to ai-insights

8. **Create `scripts/tests/ledger-plugin.test.js`** (or `.test.ts` if the scripts test infrastructure uses Vitest with TypeScript) — Port the tests from `tests/plugins/ledger.test.ts` in persona-builder. The root `vitest.config.ts` in ai-insights already runs `vitest run scripts/tests/`, so the tests will be picked up automatically.

   Note: Check the existing test infrastructure in `scripts/tests/` to determine language and patterns. If the existing tests are `.test.js`, use JS. If `.test.ts`, use TS.

### Phase 4: Remove the ledger plugin from persona-builder

9. **Delete `src/plugins/ledger/` directory** — Remove all 5 source files.

10. **Delete `tests/plugins/ledger.test.ts`** — Remove the test file.

11. **Remove the sub-path export from `package.json`** — Delete the `"./plugins/ledger"` entry from the `exports` map.

12. **Remove the entry point from `tsup.config.ts`** — Delete `'src/plugins/ledger/index.ts'` from the `entry` array.

13. **Update `docs/plugins.md`** — Remove or replace the ledger plugin section. Add a note that the ledger plugin has been moved to ai-insights, and that `docs/plugins.md` now documents only the plugin interface and how to build a custom plugin.

14. **Update `docs/agents/project-manifest/api-surface.md`** — Remove ledger plugin exports from the API surface.

15. **Update `docs/agents/project-manifest/file-tree.md`** — Remove the `src/plugins/ledger/` entries.

16. **Update `docs/agents/project-manifest/data-flows.md`** — Remove ledger-specific references if any.

17. **Update `CHANGELOG.md`** — Add an entry documenting the removal.

18. **Bump major version in `package.json`** — The removal of the `./plugins/ledger` sub-path export is a breaking change. Bump `version` to `2.0.0`. The library has no external consumers yet, so this is safe.

### Phase 5: Update ai-insights documentation

19. **Update `personas/docs/agents/project-manifest/` manifest** — Add the new `personas/plugins/ledger/` directory to the file tree and document the local plugin.

20. **Update root `AGENTS.md`** — If there are any references to the ledger plugin import path, update them.

21. **Update `personas/changelog.md`** — Document the migration.

### Phase 6: Verification

22. **Run ai-insights persona build** — Execute `node scripts/build-personas.js` to verify the local plugin works correctly. Then run `node scripts/build-personas.js --check` to verify check mode.

23. **Run ai-insights tests** — Execute `npx vitest run` at the workspace root to run the ported ledger plugin tests.

24. **Run persona-builder tests** — Execute `npm test` in persona-builder to verify the removal didn't break anything.

25. **Run persona-builder build** — Execute `npm run build` in persona-builder to verify the build succeeds without the ledger entry point.

## Dependencies

- The persona-builder library's core plugin types (`PersonaBuildPlugin`, `ValidationResult`, etc.) must remain exported — the local ai-insights plugin needs to conform to the same interface shape.
- The `escapeRegExp` utility in `role-validator.ts` is imported from `../../utils/regex.js` in persona-builder. It must be inlined in the local CJS version (it's a single regex-escape function).

## Required Components

### New files (ai-insights-dev)
- `personas/plugins/ledger/index.js`
- `personas/plugins/ledger/frontmatter-templates.js`
- `personas/plugins/ledger/roster-renderer.js`
- `personas/plugins/ledger/mcp-tools-renderer.js`
- `personas/plugins/ledger/role-validator.js`
- `scripts/tests/ledger-plugin.test.js` (or `.test.ts`)

### Modified files (ai-insights-dev)
- `personas/persona-build.config.js` (import path change)
- `personas/docs/agents/project-manifest/` (manifest updates)
- `personas/changelog.md`

### Deleted files (persona-builder-STABLE)
- `src/plugins/ledger/index.ts`
- `src/plugins/ledger/frontmatter-templates.ts`
- `src/plugins/ledger/roster-renderer.ts`
- `src/plugins/ledger/mcp-tools-renderer.ts`
- `src/plugins/ledger/role-validator.ts`
- `tests/plugins/ledger.test.ts`

### Modified files (persona-builder-STABLE)
- `package.json` (remove sub-path export)
- `tsup.config.ts` (remove entry point)
- `docs/plugins.md` (remove ledger section, keep plugin interface docs)
- `docs/agents/project-manifest/api-surface.md`
- `docs/agents/project-manifest/file-tree.md`
- `docs/agents/project-manifest/data-flows.md`
- `CHANGELOG.md`

## Assumptions

- The ai-insights persona subsystem will remain JavaScript CJS for the foreseeable future.
- The persona-builder's plugin type system (`PersonaBuildPlugin` interface) is stable and the local CJS plugin can conform to it without TypeScript enforcement.
- The `escapeRegExp` utility is a trivial one-liner that can be safely inlined rather than shared.
- No other project or consumer imports from `@mistralys/persona-builder/plugins/ledger` (the library has no external consumers yet).

## Constraints

- The local plugin must produce byte-identical output to the current library plugin — this is a pure refactor with no behavioral changes.
- Cross-platform compatibility must be maintained (no OS-specific path handling).
- The persona-builder library must continue to build and pass all remaining tests after the ledger plugin is removed.

## Out of Scope

- Adding TypeScript compilation infrastructure to the ai-insights persona subsystem.
- Changing the ledger plugin's behavior, API, or validation logic.
- Refactoring the persona-builder plugin system itself.

## Acceptance Criteria

- `node scripts/build-personas.js` succeeds in ai-insights with the local plugin.
- `node scripts/build-personas.js --check` reports no drift (generated files unchanged).
- All ported ledger plugin tests pass in ai-insights (`npx vitest run`).
- `npm test` passes in persona-builder with the ledger plugin removed.
- `npm run build` succeeds in persona-builder without the ledger entry point.
- The `@mistralys/persona-builder/plugins/ledger` sub-path export no longer exists.
- The ai-insights `persona-build.config.js` imports from the local path `./plugins/ledger`.

## Testing Strategy

1. **Unit tests (ported):** The existing ~70 ledger plugin tests are ported to ai-insights. They verify:
   - Roster rendering (active highlighting, edge cases)
   - MCP tools table rendering (`note_only` filtering)
   - Role validation (known/unknown roles, severity levels)
   - `note_only` guard (second-line defense against tool leakage)
   - Plugin composition (hook integration, cache isolation, frontmatter templates)

2. **Integration test:** Run `node scripts/build-personas.js --check` to verify the generated persona files are byte-identical before and after the move.

3. **Regression test:** Run `npm test` in persona-builder to verify no remaining tests break after removal.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CJS port introduces subtle bugs** | Port tests alongside source; run `--check` mode to verify output identity. |
| **`escapeRegExp` inlining misses edge case** | The function is a well-known one-liner (`str.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`); copy verbatim. |
| **Persona-builder consumers break** | The library has no external consumers. ai-insights is the sole user, and migration is atomic (both repos change together). Major version bump (`2.0.0`) signals the breaking change cleanly. |
| **Test infrastructure mismatch** | Check existing `scripts/tests/` convention before writing tests. Adapt to whatever test runner/language is already in use. |
| **Import resolution differences (CJS vs ESM)** | The persona-builder CLI loads plugins via the config file, which is CJS `require()`. Local relative `require('./plugins/ledger')` follows the same resolution rules. |
