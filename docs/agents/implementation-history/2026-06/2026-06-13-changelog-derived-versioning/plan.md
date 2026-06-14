# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary

Implement auto-derived `version` and `last_updated` fields from per-persona YAML `changelog` block scalars, eliminating the manual `version` and `last_updated` YAML fields across all 37 personas. The change spans two repositories: the `@mistralys/persona-builder` library (engine-level derivation) and the `ai-insights` consumer project (YAML cleanup + build script adaptation). All 37 persona YAMLs already contain `changelog: |` fields — this plan closes the loop by making the engine derive version/date from them and removing the now-redundant explicit fields.

## Architectural Context

### `@mistralys/persona-builder` (library)

- **Layered architecture:** `engine/` (zero-dep pure functions) → `loaders/` (file I/O) → `builders/` (orchestration) → `plugins/` (hooks).
- **`buildAgentNameMap()`** ([persona-builder.ts](../../../../../../ai-persona-builder/src/builders/persona-builder.ts)) pre-scans all suites *before* any plugin hooks fire, resolving version via `personaMeta['version'] → defaultVersion → '0.0.0'`.
- **`buildContext()`** ([persona-builder.ts](../../../../../../ai-persona-builder/src/builders/persona-builder.ts)) merges the 7-layer context, resolving version via `personaMeta['version'] → sharedMeta['default_version'] → '0.0.0'`.
- **`src/utils/`** contains one file (`regex.ts`) with a named barrel re-export in `index.ts`. New utility files follow this same pattern.
- **Zero-dependency engine invariant** ([constraints.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/constraints.md)): `src/engine/` files must have zero imports. The new utility goes in `src/utils/` which is *not* subject to this constraint.

### `ai-insights` (consumer)

- **`scripts/build-personas.js`** reads `version` via a simple `parseYamlScalars()` regex that extracts top-level `key: value` lines. It generates `personas/name-mapping.json`.
- **All 37 persona YAMLs** already have `changelog: |` block scalars with the `VERSION (DATE): Description` format.
- **All 37 persona YAMLs** still carry explicit `version:` and `last_updated:` fields that duplicate what the changelog already encodes.
- **`_shared.yaml`** provides `default_version` as a fallback (retained).

## Approach / Architecture

Add a `resolveChangelogMeta()` utility function to `@mistralys/persona-builder` in `src/utils/changelog.ts`. This function extracts version and date from the first entry of a changelog block scalar. Modify `buildAgentNameMap()` and `buildContext()` to call it as the *first* step in the version resolution chain, replacing the explicit `version` field lookup entirely.

**New version resolution chain:**
```
changelog field (extract highest version) → default_version → '0.0.0'
```

The explicit `version` and `last_updated` YAML fields are removed from all 37 persona YAMLs in `ai-insights`. The central `personas/changelog.md` evolves into a curated release summary (infrastructure/build changes only).

## Rationale

1. **Eliminates version drift.** Today, `version`, `last_updated`, and the changelog's first entry can all diverge. Derivation makes drift impossible.
2. **Reduces YAML maintenance.** Two fewer fields to update on every persona version bump.
3. **The data already exists.** All 37 YAMLs already have `changelog: |` fields with dates — this plan just makes the engine use them.
4. **Engine-level is architecturally correct.** `buildAgentNameMap()` runs before plugins, so a plugin cannot solve this. The utility function in `src/utils/` is the right layer.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Where to place derivation logic | Engine-level utility in `src/utils/changelog.ts`, called from `buildContext()` and `buildAgentNameMap()` | Plugin-only (`onBuildContext` hook) | Plugin cannot work because `buildAgentNameMap()` runs before any plugin hooks, so agent name variables would use stale/missing versions. Engine-level is the only correct location. |
| Handling `last_updated` | Derive from changelog date alongside version | Keep `last_updated` as a separate manual field | Derivation eliminates one more source of drift at zero additional cost — the date is already in the changelog format. |
| Backward compatibility for `version` field | Remove outright — no deprecation shim | Deprecate with fallback chain `changelog → version → default_version` | `ai-insights` is the sole consumer. A deprecation shim adds complexity with no benefit since both repos are updated atomically. |
| Sibling `.changes.md` files | YAML inline block scalar (already adopted) | Per-persona Markdown changelog files alongside YAMLs | Inline approach was already chosen and deployed across all 37 YAMLs. Sibling files would double the file count for no additional benefit at current scale. |

## Pattern Alignment

- **`src/utils/` one-file-per-domain pattern** ([constraints.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/constraints.md)): The new `changelog.ts` follows the existing convention of one focused utility file per domain (alongside `regex.ts`), with an explicit named re-export in the barrel.
- **Version resolution chain** ([data-flows.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/data-flows.md) §Derived Context Fields): Currently `version → default_version → '0.0.0'`. Plan changes this to `changelog → default_version → '0.0.0'`, same shape, different source.
- **Zero-dependency engine invariant**: The new utility uses no imports (pure regex + string parsing). It lives in `src/utils/` which permits imports, but the function itself is engine-safe.
- **Named barrel re-export** ([constraints.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/constraints.md)): `src/utils/index.ts` uses explicit named re-exports. The new export follows this pattern.
- **YAML metadata convention** ([constraints.md](../../../../../../ai-persona-builder/docs/agents/project-manifest/constraints.md)): Per-persona YAML files are the metadata source of truth; the plan adds a derived-from relationship for existing fields.

## Detailed Steps
### Phase 0 — Local symlink setup (both repos)

0. **Link `@mistralys/persona-builder` locally** to enable cross-repo testing without publishing:
   - In `ai-persona-builder/`, run `npm link` to register the package globally as a symlink.
   - In `ai-insights/`, run `npm link @mistraljs/persona-builder` to replace the installed dependency with a symlink to the local source.
   - Run `npm run build` in `ai-persona-builder/` to ensure `dist/` is up to date.
   - Verify the link works: `node -e "require.resolve('@mistraljs/persona-builder')"` from `ai-insights/` should resolve to the local `ai-persona-builder/dist/` path.
   - **Teardown (after all phases complete):** Run `npm unlink @mistraljs/persona-builder` in `ai-insights/` and `npm install` to restore the registry version. The symlink is temporary — the final dependency update happens when the new persona-builder version is published.
### Phase 1 — Engine change (`@mistralys/persona-builder`)

1. **Create `src/utils/changelog.ts`** with the `resolveChangelogMeta()` function and the `ChangelogMeta` interface. The function takes an `unknown` input (the raw YAML field value), returns `{ version: string; date: string } | undefined`. It uses two regex patterns:
   - Primary: `^(\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*:/m` — extracts version + date.
   - Fallback: `^(\d+\.\d+\.\d+)\s*:/m` — extracts version only (date defaults to `''`).

2. **Update `src/utils/index.ts`** to add the named re-export: `export { resolveChangelogMeta } from './changelog.js';` and `export type { ChangelogMeta } from './changelog.js';`.

3. **Update `buildAgentNameMap()`** in `src/builders/persona-builder.ts` to replace the version resolution:
   - **Before:** `typeof persona['version'] === 'string' ? persona['version'] : defaultVersion`
   - **After:** `resolveChangelogMeta(persona['changelog'])?.version ?? defaultVersion`
   - Import `resolveChangelogMeta` from `../utils/changelog.js`.

4. **Update `buildContext()`** in `src/builders/persona-builder.ts` to replace the version resolution:
   - Extract `ChangelogMeta` from `personaMeta['changelog']`.
   - Derive `version` from `clMeta?.version ?? sharedMeta['default_version'] ?? '0.0.0'`.
   - Derive `last_updated` from `clMeta?.date ?? ''`.
   - Inject both `version` and `last_updated` into the merged context.
   - **Add `{{#if last_updated}}` guards** to the VS Code and Claude Code frontmatter templates in `ai-insights/personas/persona-build.config.js` so that an empty `last_updated` value omits the line entirely rather than rendering `last_updated: ` (blank YAML value).

5. **Write unit tests for `resolveChangelogMeta()`** in `tests/utils/changelog.test.ts`:
   - Returns version + date from a well-formed entry.
   - Returns version with empty date when no date is present.
   - Returns `undefined` for empty string, non-string, and unparseable content.
   - Extracts from multi-line changelog (first entry wins).
   - Handles entries without a date prefix on subsequent same-version lines.

6. **Write integration tests for changelog-derived version** in `tests/builders/changelog-version.test.ts`:
   - `buildContext()` derives `version` from `changelog` field when `version` is absent.
   - `buildContext()` derives `last_updated` from `changelog` field when `last_updated` is absent.
   - `buildAgentNameMap()` uses changelog-derived version in `agent_*` display strings.
   - Fallback to `default_version` when `changelog` is absent or unparseable.
   - Fallback to `'0.0.0'` when both `changelog` and `default_version` are absent.

7. **Update existing tests** that set explicit `version` fields — ensure they still pass. The `version` YAML field is no longer consulted by the engine, but existing tests that set it alongside `changelog` should be updated to remove `version` and use `changelog` instead (or confirm fallback to `default_version`).

8. **Bump persona-builder version** — minor version bump in `package.json` (behavioral change to version resolution — the explicit `version` YAML field is no longer consulted; version is now derived from `changelog` only; see Considered Alternatives for rationale).

### Phase 2 — Consumer adoption (`ai-insights`)

9. **Update `scripts/build-personas.js`** name-mapping generator:
   - Add a `resolveVersionFromChangelog(text)` function (JS equivalent of the regex) that extracts the version from a `changelog: |` block scalar in raw YAML text.
   - Modify the version resolution to: `resolveVersionFromChangelog(raw) || data.version || DEFAULT_VERSION`.
   - This is a ~10-line change.

10. **Remove `version:` lines from all 37 persona YAML files** (9 ledger + 28 standalone). The `changelog` field now provides the version.

11. **Remove `last_updated:` lines from all 37 persona YAML files** (9 ledger + 28 standalone). The `changelog` field now provides the date. Also remove `last_updated:` from the two `_shared.yaml` files (ledger + standalone) if they are no longer needed as fallbacks.

12. **Run a full persona build** (`node scripts/build-personas.js`) and verify that:
    - All generated output files are identical to the current output (the version strings in rendered content should not change).
    - `personas/name-mapping.json` is regenerated with the same version values.

13. **Add changelog validation** to the existing ledger plugin's `onValidate` hook (or as a new validation step in `scripts/build-personas.js`):
    - Warn when `changelog` is present but contains no parseable version.
    - Warn when the first line of a version group has no date.
    - Info when explicit `version` or `last_updated` fields are present alongside `changelog` (suggesting removal).

### Phase 3 — Documentation & convention updates

14. **Update `personas/docs/agents/project-manifest/constraints.md`** to document the `changelog` field convention:
    - Entry format: `VERSION (DATE): Description`.
    - Date required on first line per version, optional on subsequent same-version lines.
    - `version` and `last_updated` are derived from the changelog — do not add them manually.

15. **Update the Persona Curator persona source** (`personas/standalone/src/meta/persona-curator.yaml` and its content template) to include the `changelog: |` field in the "add a new persona" template and instruct agents not to add explicit `version` or `last_updated` fields.

16. **Update `@mistralys/persona-builder` manifest documents:**
    - `api-surface.md` — Update the "Derived Context Fields" table: `version` now derives from `changelog → default_version → '0.0.0'`; add `last_updated` as a new derived field from `changelog → ''`.
    - `data-flows.md` — Update the version resolution chain in the `buildAgentNameMap()` and `buildContext()` flow descriptions.
    - `file-tree.md` — Add `src/utils/changelog.ts` and `tests/utils/changelog.test.ts`.
    - `constraints.md` — Add the `changelog` field convention under a new "Changelog-Derived Versioning" section.

17. **Update `ai-insights` AGENTS.md cross-system dependencies table** — The "Agent name mapping" row should reflect that version is now derived from `changelog` field, not `version` field.

## Dependencies

- Phase 0 (local symlink) must complete before Phase 1, so that Phase 1 engine changes are immediately testable from the `ai-insights` consumer.
- Phase 1 (persona-builder engine changes) must complete before Phase 2 (ai-insights consumer adoption).
- Phase 2 step 12 (full build verification) gates Phase 3 (documentation updates).
- Phase 0 teardown (unlink + `npm install`) should happen after Phase 2 verification passes, once the new persona-builder version is published to npm.

## Required Components

### New files
- `ai-persona-builder/src/utils/changelog.ts` — `resolveChangelogMeta()` utility + `ChangelogMeta` type
- `ai-persona-builder/tests/utils/changelog.test.ts` — Unit tests for the utility
- `ai-persona-builder/tests/builders/changelog-version.test.ts` — Integration tests for derived versioning

### Modified files
- `ai-persona-builder/src/utils/index.ts` — Add named re-export
- `ai-persona-builder/src/builders/persona-builder.ts` — Update `buildAgentNameMap()` and `buildContext()`
- `ai-persona-builder/package.json` — Version bump
- `ai-persona-builder/CHANGELOG.md` — New entry
- `ai-persona-builder/docs/agents/project-manifest/api-surface.md` — Update derived fields table
- `ai-persona-builder/docs/agents/project-manifest/data-flows.md` — Update version resolution flow
- `ai-persona-builder/docs/agents/project-manifest/file-tree.md` — Add new files
- `ai-persona-builder/docs/agents/project-manifest/constraints.md` — Add changelog convention
- `ai-insights/scripts/build-personas.js` — Add changelog version extraction
- `ai-insights/personas/persona-build.config.js` — Add `{{#if last_updated}}` guards to VS Code and Claude Code frontmatter templates
- `ai-insights/personas/ledger/src/meta/*.yaml` (9 files) — Remove `version` + `last_updated`
- `ai-insights/personas/standalone/src/meta/*.yaml` (28 files) — Remove `version` + `last_updated`
- `ai-insights/personas/ledger/src/meta/_shared.yaml` — Remove `last_updated` if unused
- `ai-insights/personas/standalone/src/meta/_shared.yaml` — Remove `last_updated` if unused
- `ai-insights/personas/docs/agents/project-manifest/constraints.md` — Document changelog convention
- `ai-insights/AGENTS.md` — Update cross-system dependencies

## Assumptions

- `ai-insights` is the sole consumer of `@mistralys/persona-builder`. No backward compatibility shim is needed for the `version` field removal from the resolution chain.
- All 37 persona YAML `changelog` fields use the `VERSION (DATE): Description` format consistently (verified by grep — all already follow this format).
- The `version` values currently in the explicit `version:` fields match the first version in their respective `changelog: |` blocks (the full build verification in step 12 will confirm this).
- Pre-release version suffixes (e.g. `1.5.0-beta.1`) are not used — all versions are clean semver triples. The regex does not need to handle pre-release tags.

## Constraints

- The `resolveChangelogMeta()` function must be a pure function with zero imports, suitable for potential future use in `src/engine/` if needed.
- The function must handle `unknown` input gracefully (non-string, empty string, malformed content all return `undefined`).
- The `_shared.yaml` `default_version` field must remain as a fallback — it serves personas that might not yet have a `changelog` field (e.g. during incremental adoption by third-party consumers).
- Both Phase 1 and Phase 2 changes should be committed and released before updating documentation (Phase 3), so docs reflect the actual shipped behavior.

## Out of Scope

- **Changelog ordering validation:** Whether versions appear in descending order is a consumer convention, not an engine invariant.
- **Changelog retention policy:** Whether to trim old entries is deferred until it becomes a problem (currently ~5-10 lines per persona).
- **Central `personas/changelog.md` restructuring:** The research paper recommends evolving it into an infrastructure-only release summary, but that editorial change is a separate task.
- **Pre-release version support:** The regex matches strict `X.Y.Z` triples only. Pre-release suffixes are not used and not planned.
- **Changelog rendering in output:** The `changelog` field is not rendered into persona output files — it remains metadata-only.
- **Plugin-based changelog validation in persona-builder:** Validation logic belongs in the `ai-insights` consumer project, not the library engine.

## Acceptance Criteria

1. `resolveChangelogMeta()` correctly extracts version and date from a well-formed `VERSION (DATE): Description` changelog string.
2. `resolveChangelogMeta()` returns `undefined` for empty, non-string, or unparseable input.
3. `buildAgentNameMap()` uses changelog-derived version for `agent_*` display strings.
4. `buildContext()` injects both `version` and `last_updated` derived from the `changelog` field.
5. When no `changelog` field is present, version falls back to `default_version` → `'0.0.0'`.
6. When no `changelog` field is present, `last_updated` falls back to `''`.
7. All 37 persona YAMLs in `ai-insights` have their `version:` and `last_updated:` lines removed.
8. A full persona build (`node scripts/build-personas.js`) produces output identical to the pre-change output (same version strings in rendered files).
9. `personas/name-mapping.json` regenerates with the same version values as before.
10. All existing persona-builder tests pass.
11. All new unit and integration tests pass.
12. Persona-builder manifest documents are updated to reflect the new derivation chain.

## Testing Strategy

Testing is split between the two repositories:

- **`@mistralys/persona-builder`**: Unit tests for the utility function (input parsing, edge cases) and integration tests for the derivation chain (build context, agent name map, fallback behavior). Tests use the existing Vitest infrastructure with temp directories and inline YAML fixtures.
- **`ai-insights`**: Manual verification via a full persona build (`node scripts/build-personas.js`). The build script's `--check` flag and the `name-mapping.json` diff serve as regression gates.

## Test Plan

- `tests/utils/changelog.test.ts` — `resolveChangelogMeta()` extracts version + date from `"1.5.0 (2026-06-13): Added feature"` — AC 1
- `tests/utils/changelog.test.ts` — `resolveChangelogMeta()` extracts version-only from `"1.5.0: Added feature"` (date = `''`) — AC 1
- `tests/utils/changelog.test.ts` — `resolveChangelogMeta()` returns `undefined` for `undefined`, `''`, `42`, `'no version here'` — AC 2
- `tests/utils/changelog.test.ts` — Multi-line changelog: first entry wins — AC 1
- `tests/utils/changelog.test.ts` — Changelog with trailing whitespace / CRLF line endings — AC 1
- `tests/builders/changelog-version.test.ts` — `buildContext()` derives version from changelog when no explicit `version` field — AC 4
- `tests/builders/changelog-version.test.ts` — `buildContext()` derives `last_updated` from changelog date — AC 4
- `tests/builders/changelog-version.test.ts` — `buildContext()` falls back to `default_version` when no changelog — AC 5
- `tests/builders/changelog-version.test.ts` — `buildContext()` falls back to `'0.0.0'` when no changelog and no `default_version` — AC 5
- `tests/builders/changelog-version.test.ts` — `buildContext()` sets `last_updated` to `''` when no changelog — AC 6
- `tests/builders/changelog-version.test.ts` — `buildAgentNameMap()` uses changelog-derived version in agent display name — AC 3
- `tests/builders/changelog-version.test.ts` — `buildAgentNameMap()` falls back to `default_version` when changelog absent — AC 5
- Full persona build verification (manual, `ai-insights`) — `node scripts/build-personas.js` output matches pre-change — AC 8, 9
- Existing test suite (`npm test` in `ai-persona-builder`) — all 236+ tests pass — AC 10

## Documentation Updates

- `ai-persona-builder/docs/agents/project-manifest/api-surface.md` — Update "Derived Context Fields" table: `version` derivation chain changes to `changelog → default_version → '0.0.0'`; add `last_updated` row with `changelog date → ''`
- `ai-persona-builder/docs/agents/project-manifest/data-flows.md` — Update `buildAgentNameMap()` and `buildContext()` flow descriptions to show new changelog resolution
- `ai-persona-builder/docs/agents/project-manifest/file-tree.md` — Add `src/utils/changelog.ts`, `tests/utils/changelog.test.ts`, `tests/builders/changelog-version.test.ts`
- `ai-persona-builder/docs/agents/project-manifest/constraints.md` — Add "Changelog-Derived Versioning" section documenting the convention
- `ai-persona-builder/CHANGELOG.md` — New entry for the minor version bump
- `ai-insights/personas/docs/agents/project-manifest/constraints.md` — Document the `changelog` field format convention and the removal of explicit `version`/`last_updated`
- `ai-insights/AGENTS.md` — Update the "Agent name mapping" row in the cross-system dependencies table

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Version mismatch between explicit `version:` field and changelog's first entry** | Step 12 performs a full build comparison. Any mismatch will be caught as a diff in rendered output or `name-mapping.json`. Fix discrepancies before merging. |
| **Regex fails on edge-case changelog format** | The regex is simple and well-tested. The `VERSION (DATE): Description` format is already standardized across all 37 YAMLs. Unit tests cover edge cases. Fallback to `default_version` ensures a graceful degradation path. |
| **YAML block scalar indentation issues** | Block scalars are already in use across all 37 personas with no reported issues. The `js-yaml` parser handles them correctly. |
| **Third-party consumers relying on explicit `version` field** | `ai-insights` is the sole consumer. The `version` field in `PersonaMetadata` remains optional — third-party consumers who still set it will find it in their merged context via the YAML spread, but it will be overridden by the changelog-derived value if both are present. The fallback chain `changelog → default_version → '0.0.0'` is strictly more capable. |
| **`last_updated` used in templates but derived value is empty** | Only occurs when `changelog` is absent or has no date. The `default_version` fallback doesn't provide a date, so `last_updated` falls back to `''`. The consumer's frontmatter templates in `persona-build.config.js` currently use `last_updated: {{last_updated}}` unconditionally (no `{{#if}}` guards). Step 4 adds `{{#if last_updated}}` guards to the VS Code and Claude Code frontmatter templates in `persona-build.config.js` so that an empty value produces no `last_updated:` line rather than a blank YAML value. Risk is further mitigated by the fact that all 37 current personas have dated changelogs, and step 13 validation will catch future gaps. |
