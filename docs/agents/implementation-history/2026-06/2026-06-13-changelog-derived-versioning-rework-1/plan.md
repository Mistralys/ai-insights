# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context

The preceding project (`2026-06-13-changelog-derived-versioning`) successfully implemented changelog-derived versioning across both the `@mistraljs/persona-builder` library (v2.6.0) and the `ai-insights` consumer. All 6 work packages completed with 483 passing tests, 111 personas building cleanly, and zero coexistence warnings. One HIGH-priority deferred item and several low-priority follow-up items remain, all documented in the project synthesis. This rework plan addresses those items.

## Summary

Address all actionable items from the `2026-06-13-changelog-derived-versioning` synthesis. The HIGH-priority item (D-1) publishes `@mistraljs/persona-builder` v2.6.0 to npm and replaces the fragile `file:` dependency with a proper semver range. The remaining items are low-priority hardening: adding missing test assertions for `{{#if last_updated}}` frontmatter guards, aligning the build-script's `resolveVersionFromChangelog()` with the library's line-by-line parsing, and adding regex key escaping to `extractYamlBlockScalar()`. Two synthesis items (F-3 and F-5) are excluded — see Out of Scope.

## Architectural Context

### `@mistraljs/persona-builder` (library — `ai-persona-builder/`)

- **Version:** 2.6.0 (post-changelog-derivation project).
- **`resolveChangelogMeta()`** in [src/utils/changelog.ts](../../../../../../ai-persona-builder/src/utils/changelog.ts) uses line-by-line iteration for correct first-entry-wins semantics.
- **Publishing:** Standard npm publish workflow — `npm run build` then `npm publish`.

### `ai-insights` (consumer)

- **`personas/package.json`** currently has `"@mistraljs/persona-builder": "file:../../ai-persona-builder"` — a local `file:` dependency that only works when both repos are co-located.
- **`scripts/build-personas.js`** has `resolveVersionFromChangelog()` ([line 172](../../../../../../scripts/build-personas.js#L172)) using whole-string multiline `.match()` with `withDate` priority — diverges from the library's line-by-line approach.
- **`extractYamlBlockScalar()`** ([line 137](../../../../../../scripts/build-personas.js#L137)) interpolates the `key` parameter directly into `new RegExp(...)` without escaping.
- **`personas/plugins/ledger/frontmatter-templates.js`** defines `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_LEDGER_CC` templates, both using `{{#if last_updated}}` guards.
- **`scripts/tests/ledger-plugin.test.js`** tests frontmatter template fields (lines 544–562) but does not assert the `{{#if last_updated}}` conditional presence.

## Approach / Architecture

This plan is a cleanup/hardening pass — no new architecture. Each item is a self-contained fix:

1. **D-1 (npm publish + dependency update):** Publish the library to npm, then update `personas/package.json` to use the published semver range. This is a configuration change, not a code change.
2. **F-1 (test gap):** Add two assertions to existing tests in `ledger-plugin.test.js`.
3. **F-2 (algorithm alignment):** Rewrite `resolveVersionFromChangelog()` to use line-by-line iteration matching the library's approach.
4. **F-4 (regex escaping):** Add `escapeRegExp()` to `extractYamlBlockScalar()`.

## Rationale

- **D-1 is HIGH priority** because the `file:` dependency makes `npm install` fail in any environment where only `ai-insights` is cloned (CI, Docker, fresh contributor clone).
- **F-1, F-2, F-4** are correctness/robustness improvements that prevent future regressions. They are low-effort, high-value hardening.
- **F-3 and F-5** are excluded because the synthesis itself notes they are low priority and already partially addressed — adding them would over-engineer the rework scope.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| F-2: How to align `resolveVersionFromChangelog()` | Rewrite to iterate lines, matching library logic | Import `resolveChangelogMeta` from the library directly | Direct import would add a runtime dependency on the library from the build script. The build script already has its own `extractYamlBlockScalar()` that pre-processes raw YAML text (not the parsed block scalar the library function expects). Keeping a local implementation aligned in algorithm is simpler and avoids coupling the build script's YAML text extraction to the library's API. |
| F-4: Escaping approach | Inline `key.replace(...)` one-liner | Import `escapeRegExp` from the library | The build script is plain CJS JavaScript. Importing from the ESM library would require dynamic `import()` or a CJS shim. A single inline replace call is simpler and dependency-free. |

## Pattern Alignment

- **Build script self-containment** ([scripts/build-personas.js](../../../../../../scripts/build-personas.js)): The build script intentionally duplicates small utility functions rather than importing from the library, since the script is CJS and the library is ESM. F-2 and F-4 follow this existing pattern.
- **Test assertion style** ([scripts/tests/ledger-plugin.test.js](../../../../../../scripts/tests/ledger-plugin.test.js)): Existing frontmatter tests use `expect(template).toContain('{{marker}}')` assertions. F-1 follows this pattern.

## Detailed Steps

### Step 1 — Add `{{#if last_updated}}` test assertions (F-1)

7. In `scripts/tests/ledger-plugin.test.js`, add `expect(vsTemplate).toContain('{{#if last_updated}}');` to the "vscode frontmatter template begins with --- and contains expected fields" test (after line 551).
8. In the same file, add `expect(ccTemplate).toContain('{{#if last_updated}}');` to the "claude-code frontmatter template begins with --- and contains expected fields" test (after line 562).

### Step 2 — Align `resolveVersionFromChangelog()` with line-by-line parsing (F-2)

9. In `scripts/build-personas.js`, rewrite `resolveVersionFromChangelog()` (line 172) to iterate lines of the extracted changelog content, trying the `withDate` pattern then the `withoutDate` pattern on each line, and returning on the first match. This mirrors the logic of `resolveChangelogMeta()` in the library.

   **Before (whole-string multiline match):**
   ```js
   const withDate = content.match(/^(\d+\.\d+\.\d+)\s*\(\d{4}-\d{2}-\d{2}\)\s*:/m);
   if (withDate) return withDate[1];
   const withoutDate = content.match(/^(\d+\.\d+\.\d+)\s*:/m);
   return withoutDate ? withoutDate[1] : undefined;
   ```

   **After (line-by-line first-wins):**
   ```js
   for (const line of content.split(/\r?\n/)) {
     const withDate = line.match(/^(\d+\.\d+\.\d+)\s*\(\d{4}-\d{2}-\d{2}\)\s*:/);
     if (withDate) return withDate[1];
     const withoutDate = line.match(/^(\d+\.\d+\.\d+)\s*:/);
     if (withoutDate) return withoutDate[1];
   }
   return undefined;
   ```

10. Apply the same line-by-line rewrite to `validateChangelogField()` (line 192) which uses identical regex patterns with the `/m` flag.

### Step 3 — Add regex key escaping to `extractYamlBlockScalar()` (F-4)

11. In `scripts/build-personas.js`, in `extractYamlBlockScalar()` (line 138), escape the `key` parameter before interpolating into the `RegExp`:

    **Before:**
    ```js
    const re = new RegExp(`^${key}\\s*:\\s*\\|[-+]?\\s*$`, 'm');
    ```

    **After:**
    ```js
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}\\s*:\\s*\\|[-+]?\\s*$`, 'm');
    ```

### Step 4 — Full verification

12. Run `npm test` from `ai-insights/` (root) to verify the ledger-plugin tests pass.
13. Run `node scripts/build-personas.js` from `ai-insights/` to verify all 111 personas build correctly.

### Step 5 — Publish `@mistraljs/persona-builder` v2.6.0 to npm (D-1)

14. **User action:** In `ai-persona-builder/`, run `npm run build` to generate a fresh `dist/`, then `npm publish` to publish v2.6.0 to the npm registry.
15. Verify the published package: `npm info @mistraljs/persona-builder version` should return `2.6.0`.

### Step 6 — Update `personas/package.json` dependency (D-1)

16. In `ai-insights/personas/package.json`, change the `@mistraljs/persona-builder` dependency from `"file:../../ai-persona-builder"` to `"^2.6.0"`.
17. Run `npm install` from `ai-insights/personas/` to resolve the dependency from npm.
18. Run `node scripts/build-personas.js` from `ai-insights/` to verify all 111 personas build correctly with the npm-sourced dependency.

## Dependencies

- Steps 1, 2, 3 are independent of each other.
- Step 4 (verification) runs after Steps 1–3.
- Step 5 (npm publish — user action) runs after Step 4 passes.
- Step 6 (dependency update) runs after Step 5.

## Required Components

### Modified files
- `ai-insights/personas/package.json` — Dependency version change
- `ai-insights/scripts/tests/ledger-plugin.test.js` — Two new assertions
- `ai-insights/scripts/build-personas.js` — Three function rewrites (`resolveVersionFromChangelog`, `validateChangelogField`, `extractYamlBlockScalar`)

### No new files

## Assumptions

- `@mistraljs/persona-builder` v2.6.0 has not yet been published to npm (the `file:` dependency is still in place).
- The user has npm publish credentials for the `@mistraljs` scope.
- All current persona builds are passing (confirmed by the synthesis: 111 files, zero errors).

## Constraints

- The build script (`scripts/build-personas.js`) is CommonJS JavaScript — it cannot directly import ESM exports from the library.
- The `npm publish` step is a destructive action (publishes to the public registry). The user will perform this step manually.

## Out of Scope

- **F-3 (Coexistence test for `changelog:` + `version:`):** The synthesis rates this low priority. The explicit `version:` field has been removed from all 37 persona YAMLs, so the coexistence case no longer occurs in production data. Adding a negative-case test for a permanently eliminated condition is not worth the complexity.
- **F-5 (api-surface.md metadata schema section):** The synthesis notes this was "partially addressed in WP-006 documentation stage." The Derived Context Fields table in [api-surface.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/api-surface.md#L88) already clearly documents that `version` derives from `changelog` and is unconditionally overwritten. No further documentation change needed.
- **Git tagging and release workflow** — handled by the user after the plan completes.

## Acceptance Criteria

1. `personas/package.json` references `@mistraljs/persona-builder` as `"^2.6.0"` (not `"file:..."`)
2. `npm install` in `personas/` resolves the dependency from npm without error
3. All 111 personas build successfully with the npm-sourced dependency
4. `ledger-plugin.test.js` asserts `{{#if last_updated}}` presence in both VS Code and Claude Code frontmatter templates
5. `resolveVersionFromChangelog()` uses line-by-line iteration (no `/m` multiline flag)
6. `validateChangelogField()` uses line-by-line iteration (no `/m` multiline flag)
7. `extractYamlBlockScalar()` escapes the `key` parameter before regex interpolation
8. All existing tests pass without modification

## Testing Strategy

This plan modifies test files (F-1) and modifies functions covered by existing tests (F-2, F-4). The primary verification is running the existing test suite and the full persona build.

## Test Plan

- `scripts/tests/ledger-plugin.test.js` (existing, modified) — Verify `{{#if last_updated}}` assertions pass for both VS Code and CC templates — covers AC #4
- `scripts/tests/ledger-plugin.test.js` (existing, unmodified) — Verify all existing frontmatter assertions still pass — covers AC #8
- Full persona build (`node scripts/build-personas.js`) — Verify 111 personas build with npm dependency — covers AC #3
- `npm install` from `personas/` — Verify clean install from registry — covers AC #2

## Documentation Updates

- No documentation updates required. The AGENTS.md cross-system dependencies table was already updated in the prior project. The `file:` dependency is a `package.json` configuration concern, not a documented convention.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **npm publish fails (auth, scope permissions)** | The user performs this step manually. If it fails, the plan pauses until resolved — no code changes depend on the publish succeeding first. Steps 3–5 can proceed independently. |
| **Published v2.6.0 has different behavior than local `file:` link** | The library was already built and tested locally. The published artifact is the `dist/` output of that same build. Step 6 verification catches any discrepancy. |
| **Line-by-line rewrite in F-2 changes `resolveVersionFromChangelog()` behavior for malformed changelogs** | The synthesis confirms divergence only fires when `validateChangelogField()` already emits `[WARN]`. All 37 current persona changelogs are well-formed (verified by the prior project's clean build). The rewrite makes the behavior *more correct* (first entry wins), not less. |
