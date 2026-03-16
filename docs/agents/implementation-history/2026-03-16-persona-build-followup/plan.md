# Plan

## Summary

Follow-up plan for the three actionable items identified in the `2026-03-15-persona-build-pipeline-fixes` synthesis "Next Steps" section. The primary deliverable is an automated test suite for the pure helper functions in `scripts/build-personas.js` — the highest-value deferred debt item flagged by three independent agents. A second work package consolidates five low-priority housekeeping items (DRY filename validators, `Set`-based deduplication, STRICT fenced-block handling, unit-test-auditor description, constraint anchors) into one sweep.

## Architectural Context

### Build Script (`scripts/build-personas.js`)

- **Runtime:** Node.js, CommonJS (`'use strict'`; `require()`).
- **No exports:** The script is CLI-only. All 19 functions are file-scoped — none are exported via `module.exports`. This means testing requires either (a) extracting helpers into a separate module, or (b) duplicating function signatures in test fixtures.
- **Pure helpers** (no I/O, no `process.exit`): `serializeTools()`, `serializeToolsList()`, `extractMcpServers()`, `resolvePartials()`, `resolveConditionals()`, `resolveVariables()`, `collapseBlankLines()`, `ensureBlankLineBeforeHeadings()`, `normalizeNewlines()`, `renderRoster()`, `renderMcpToolsTable()`.
- **Side-effectful helpers** (call `process.exit`): `validateCcFileName()`, `validateVsFileName()`.
- **I/O-dependent functions** (read/write filesystem): `syncPersonasVersion()`, `loadPartials()`, `discoverPersonaYamls()`, `buildForTarget()`, `expandSuites()`.

### Test Infrastructure

- **mcp-server** uses vitest (`mcp-server/vitest.config.ts`) — well-established, 1,281 tests.
- **personas** has no test runner, no `devDependencies`, no test config. The only validation is `--check --strict` mode (freshness + marker scan).

### Constraints File (`personas/docs/agents/project-manifest/constraints.md`)

47 constraints numbered 1–47 with bare numbers (e.g. `1. **Never edit generated files directly.**`). External cross-references cite these by number (e.g. "constraint 19", "constraint 10 GN-4"). No anchors exist — renumbering breaks all citations.

### Unit-Test-Auditor Persona

Current description: `"Audit specific codebase parts."` — sparse compared to other standalone personas which use verb-forward, purpose-specific summaries (e.g. `"Produce clean, scannable changelogs from Git history or rewrite verbose agent-generated entries into a concise house style."`).

## Approach / Architecture

**Two work packages:**

1. **WP-001 — Automated Tests for `build-personas.js`:** Extract pure helpers into `scripts/lib/persona-helpers.js` so they can be imported by both the build script and a vitest test file. Create `scripts/tests/persona-helpers.test.js` with vitest, reusing the existing mcp-server vitest setup or a root-level config. Cover edge cases for `extractMcpServers()`, `validateVsFileName()`, `validateCcFileName()`, `serializeTools()`, `serializeToolsList()`, and the STRICT regex.

2. **WP-002 — Minor Housekeeping Sweep:** Five low-effort items combined into one WP: unify validators, `Set`-based dedup in `extractMcpServers()`, strip fenced code blocks before STRICT scan, improve unit-test-auditor description, add named anchors to `constraints.md`.

## Rationale

- **Extract-to-module** is preferred over test-time hacks (re-evaluating the script, mocking `process.argv`) because it cleanly separates pure logic from CLI orchestration, follows standard CJS patterns, and enables future reuse by other scripts.
- **Vitest** is chosen over Jest or Node's built-in test runner for consistency with the existing mcp-server test suite. A root-level `vitest.config.ts` avoids polluting the personas project with test dependencies it otherwise wouldn't need.
- **Single housekeeping WP** avoids the overhead of five separate work packages for individually trivial items. All five are independent code changes with no cross-dependency.

## Detailed Steps

### WP-001 — Automated Tests for `build-personas.js` Helpers

1. **Create `scripts/lib/persona-helpers.js`** — Extract these pure functions from `scripts/build-personas.js`:
   - `serializeTools(tools)` → returns `"['a', 'b']"`
   - `serializeToolsList(tools)` → returns `"'a', 'b'"`
   - `extractMcpServers(tools)` → returns `string[]` of MCP server names
   - `validateCcFileName(persona, suite)` → exits on missing field
   - `validateVsFileName(persona, suite)` → exits on missing field
   - `resolveConditionals(text, context)` → template conditional engine
   - `resolveVariables(text, context, filename)` → variable substitution
   - `resolvePartials(text, partialsMap, depth)` → partial inclusion
   - `collapseBlankLines(text)` → normalize whitespace
   - `ensureBlankLineBeforeHeadings(text)` → Markdown formatting
   - `normalizeNewlines(text)` → CRLF → LF normalization
   - `renderRoster(roster, activeNumber)` → roster Markdown rendering
   - `renderMcpToolsTable(tools)` → MCP tools table rendering
   Export all via `module.exports`.

2. **Update `scripts/build-personas.js`** — Replace inline function definitions with `require('./lib/persona-helpers')`. Verify all 19 internal call sites are updated. The script's CLI entry-point behavior must remain identical.

3. **Create a root-level vitest config** — Add `vitest.config.ts` at workspace root (or a `scripts/vitest.config.ts`) to run script-level tests. Add `vitest` as a root-level dev dependency (or leverage the existing `mcp-server` vitest installation with a workspace reference).

4. **Create `scripts/tests/persona-helpers.test.js`** — Test cases organized by function:

   **`extractMcpServers()`:**
   - Empty array → `[]`
   - Array with no `/` entries → `[]`
   - `['central_pm/tool1', 'central_pm/tool2']` → `['central_pm']` (dedup)
   - `['central_pm/tool1', 'other_server/tool2']` → `['central_pm', 'other_server']`
   - `null` / `undefined` input → `[]` (defensive guard)
   - Non-string entries → skipped

   **`serializeTools()` / `serializeToolsList()`:**
   - Single tool → `"['vscode']"` / `"'vscode'"`
   - Multiple tools → `"['vscode', 'execute']"` / `"'vscode', 'execute'"`
   - Empty array → `"[]"` / `""`

   **`validateVsFileName()` / `validateCcFileName()`:**
   - Persona with field set → no error (does not exit)
   - Persona with missing field → calls `process.exit(1)` (mock or spy on `process.exit`)
   - Verify error message includes persona identifier (role, slug, or number)

   **`resolveConditionals()`:**
   - Truthy flag → keeps `{{#if}}` content, removes `{{else}}` content
   - Falsy flag → keeps `{{else}}` content, removes `{{#if}}` content
   - No `{{else}}` branch → keeps content when truthy, removes block when falsy
   - Unknown flag → treated as falsy

   **`resolvePartials()`:**
   - Single partial → resolved
   - Nested partial (depth 1) → resolved
   - Depth > 2 → marker preserved (constraint 8)

   **`normalizeNewlines()`:**
   - Mixed CRLF/LF → all LF
   - Trailing whitespace handling

   **STRICT regex pattern** (tested as a standalone regex, not the full CLI):
   - `{{variable}}` → matches
   - `{{> partial}}` → matches
   - `{{#if flag}}` → does NOT match (conditional syntax, not unresolved)
   - `{{/if}}` → does NOT match

5. **Validate** — Run `npx vitest run scripts/tests/` and confirm all tests pass. Run `node scripts/build-personas.js --suite all --check --strict` and confirm persona build is unaffected.

6. **Add npm script** — Add a `"test"` script to personas `package.json` or a root-level script for `scripts/` tests.

### WP-002 — Minor Housekeeping Sweep

7. **Unify `validateCcFileName` + `validateVsFileName`** into a single `validateFileName(persona, fieldName, suite)` function. The two functions are identical except for the field name (`cc_file_name` vs `vs_file_name`) and error message prefix. Update both call sites in `buildForTarget()`.

8. **Replace `Array.includes()` with `Set`** in `extractMcpServers()`:
   ```js
   const seen = new Set();
   // ...
   if (!seen.has(serverName)) { seen.add(serverName); servers.push(serverName); }
   ```

9. **Strip fenced code blocks before STRICT scan** — Add a pre-processing step before the unresolved-marker regex that removes content between triple-backtick fences:
   ```js
   const strippedForScan = output.replace(/```[\s\S]*?```/g, '');
   const unresolved = strippedForScan.match(/\{\{>?\s*[\w-]+\}\}/g);
   ```
   This prevents false positives if a persona template ever includes literal `{{…}}` in a code example.

10. **Improve unit-test-auditor description** — Update `personas/standalone/src/meta/unit-test-auditor.yaml` `description` from `"Audit specific codebase parts."` to a verb-forward, purpose-specific summary aligned with other standalone personas (e.g. `"Audit unit test coverage of specific codebase modules — identify untested paths, weak assertions, and missing edge cases."`).

11. **Add named anchors to constraint headings** in `personas/docs/agents/project-manifest/constraints.md` — Add `<a name="cN"></a>` anchors before each numbered constraint. Update the four known external cross-references (`personas/changelog.md`, `api-surface.md`, `standalone/README.md`, self-reference in `constraints.md`) to use anchor links instead of bare numbers.

12. **Rebuild personas** — Run `node scripts/build-personas.js --suite all --strict` to regenerate output with the updated unit-test-auditor description.

13. **Update manifests** — Update `personas/docs/agents/project-manifest/api-surface.md` to reflect the unified `validateFileName()` signature and `extractMcpServers()` implementation change. Update `file-tree.md` for the new `scripts/lib/` directory and `scripts/tests/` directory.

## Dependencies

- WP-001 must complete before WP-002 step 7 (validator unification), since WP-001 extracts the functions and WP-002 refactors them.
- WP-002 step 12 (rebuild) must follow steps 10 and 11 (content changes).
- Vitest must be available for test execution (either install as root dev dependency or configure workspace reference to `mcp-server/node_modules/vitest`).

## Required Components

### New Files
- `scripts/lib/persona-helpers.js` — Extracted pure helper module
- `scripts/tests/persona-helpers.test.js` — Vitest test file
- Root or scripts-level `vitest.config.ts` — Test runner config (if not reusing mcp-server's)

### Modified Files
- `scripts/build-personas.js` — Import helpers from `./lib/persona-helpers`; validator unification; Set-based dedup; STRICT fenced-block stripping
- `personas/standalone/src/meta/unit-test-auditor.yaml` — Improved `description`
- `personas/docs/agents/project-manifest/constraints.md` — Named anchors
- `personas/docs/agents/project-manifest/api-surface.md` — Updated function signatures
- `personas/docs/agents/project-manifest/file-tree.md` — New directories
- `personas/changelog.md` — Cross-reference updates to anchor links
- `personas/standalone/README.md` — Cross-reference updates to anchor links
- Root `package.json` (if adding vitest as root dev dependency)
- All 48 generated persona files (rebuilt, only unit-test-auditor content changes)

## Assumptions

- Vitest can run CommonJS test files (`.test.js`) or the test file can use ESM and import CJS via `createRequire`. Vitest supports both.
- The `scripts/lib/` directory is a new path that doesn't conflict with anything existing.
- Named anchors in Markdown headings are broadly supported in GitHub-flavored Markdown and VS Code preview.

## Constraints

- The extracted module must use CommonJS (`module.exports`) to match the existing `scripts/build-personas.js` runtime pattern.
- The build script's CLI behavior and output must remain byte-identical after the extraction refactor — no functional changes in WP-001.
- Persona output must pass `--check --strict` after all changes.

## Out of Scope

- Full integration tests for the build pipeline (filesystem I/O, CLI flag parsing, `buildForTarget()`). Only pure helper functions are tested.
- Migrating `scripts/build-personas.js` from CJS to ESM.
- Adding CI automation for the new tests (this can be a future step).
- Changes to ledger personas or mcp-server code.

## Acceptance Criteria

### WP-001
- `scripts/lib/persona-helpers.js` exports all listed pure functions.
- `scripts/build-personas.js` requires helpers from `./lib/persona-helpers` and has no duplicated function bodies.
- `node scripts/build-personas.js --suite all --check --strict` passes (zero stale, zero unresolved).
- `npx vitest run scripts/tests/` passes with all test cases green.
- At least 25 test cases covering the 6 primary helper groups.

### WP-002
- `validateCcFileName` and `validateVsFileName` replaced by a single `validateFileName(persona, fieldName, suite)`.
- `extractMcpServers()` uses `Set` for deduplication.
- STRICT scan strips fenced code blocks before regex matching.
- `unit-test-auditor.yaml` `description` is verb-forward and purpose-specific.
- `constraints.md` has `<a name="cN"></a>` anchors on all 47 constraints.
- All external cross-references updated to use anchor links.
- `--suite all --check --strict` passes after all changes.
- All existing WP-001 tests still pass after WP-002 refactors.

## Testing Strategy

- **Unit tests (new):** Vitest test file covering all extracted pure helpers with edge-case coverage. Tests run in isolation without filesystem I/O.
- **Integration validation (existing):** `node scripts/build-personas.js --suite all --check --strict` confirms persona output is consistent and marker-free.
- **Role sync (existing):** `node scripts/check-known-roles.js` confirms no role drift.
- **Regression check:** After WP-002 refactors, re-run WP-001 test suite to confirm no breakage.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Extracting functions introduces import bugs** | Run `--check --strict` immediately after extraction. Byte-identical output is the acceptance gate. |
| **Vitest config conflicts with mcp-server config** | Use a separate `scripts/vitest.config.ts` with its own `include` pattern, or a root config with workspace-aware includes. |
| **Named anchors break existing Markdown rendering** | HTML `<a name>` anchors are universally supported in GFM. Test in VS Code preview before committing. |
| **`validateFileName` unification misses an edge case** | The two validators are currently byte-identical except for field name. Diff them before unifying. WP-001 tests cover both paths beforehand. |
| **Fenced-block stripping regex too greedy** | Use non-greedy `[\s\S]*?` between backtick fences. Add a test case with mixed fenced/unfenced content. |
