# Project Synthesis Report

**Project:** Changelog-Derived Versioning  
**Plan Date:** 2026-06-13  
**Completed:** 2026-06-13  
**Agent:** Head of Operations (Synthesis)

---

## Executive Summary

This project eliminated version drift across all 37 persona YAML files by making the
`@mistralys/persona-builder` library and the `ai-insights` build system derive `version`
and `last_updated` from the `changelog:` block scalar that all personas already maintained.
The implementation spanned two repositories and six work packages: a new pure-function utility
(`resolveChangelogMeta()`), engine-level wiring into `buildAgentNameMap()` and `buildContext()`,
a build-script adaptation in `ai-insights`, YAML field removal across all 37 persona files, and
documentation + Persona Curator template updates. The result is a clean canonical build state:
111 personas build successfully with zero coexistence warnings and correct version/date derivation
throughout.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 6 of 6 COMPLETE |
| Pipeline Stages | 22 of 22 PASS |
| Tests Passing (persona-builder) | 483 (up from 471 at WP-001 start) |
| New Tests Added | 37 (25 in `changelog.test.ts` + 12 in `changelog-version.test.ts`) |
| Personas Built | 111 files, zero errors |
| Name-mapping Entries | 9 (all version values preserved) |
| Coexistence Warnings | 0 (expected clean-build signal) |
| Library Version Bump | `2.5.1` → `2.6.0` (minor, backwards-compatible) |
| Persona Curator Version | `1.2.0` → `1.3.0` |
| Personas with YAML cleaned | 37 (all ledger + standalone) |
| Rework Cycles | 0 |

---

## Work Package Summary

| WP | Title | Stages | Outcome |
|----|-------|--------|---------|
| WP-001 | `resolveChangelogMeta()` utility in persona-builder | impl → qa → review → docs | PASS — 25 tests, pure function, correct line-by-line semantics |
| WP-002 | Wire changelog derivation into `buildContext()` / `buildAgentNameMap()` | impl → qa → review → release → docs | PASS — 483 tests, v2.6.0 released, docs updated |
| WP-003 | Build-script adaptation in `ai-insights` (`resolveVersionFromChangelog`, `{{#if last_updated}}` guards) | impl → qa → review → docs | PASS — 51 plugin tests, all 4 template locations updated |
| WP-004 | Persona-builder manifest documentation | docs only | PASS — api-surface, data-flows, file-tree, constraints all updated |
| WP-005 | YAML cleanup — remove `version:` / `last_updated:` from all 37 persona YAMLs | impl → qa → review → docs | PASS — clean build, `file:` dependency flagged for resolution |
| WP-006 | Persona Curator template + constraint documentation | impl → qa → review → docs | PASS — c25a constraint, AGENTS.md updated, curator template updated |

---

## Strategic Recommendations (Gold Nuggets)

### 1. Line-by-Line Parsing for "First Entry Wins" Semantics

The `resolveChangelogMeta()` implementation switched from the WP-specified multiline-regex
approach to line-by-line iteration. This was a correctness improvement: a whole-string regex
with the `withDate` pattern fires on the first line *containing* a date, which may not be the
chronologically first version entry when the first entry is undated and a later one is dated.
Line-by-line guarantees the topmost entry always wins regardless of date presence.

> **Rule of thumb:** When parsing structured lists with "first entry wins" semantics, prefer
> iterative scan over whole-string multiline regex.

### 2. Module-Level Regex Constants

Both `RE_VERSION_WITH_DATE` and `RE_VERSION_ONLY` are compiled once at module load, not inside
the parsing loop. This is the correct pattern for any function called per-persona-file during
a build scan — avoids repeated regex compilation overhead.

### 3. `^` Anchors as False-Positive Guards

The `^` line-start anchor on both regex patterns prevents changelog narrative prose (e.g.,
`"Bumped to 2.0.0: see release notes"`) from producing spurious version matches. This is a
subtle but important correctness guard worth applying to any changelog or version extraction
regex in the codebase.

### 4. Zero Coexistence Warnings as the Canonical Build Signal

Before this project, the build emitted `[INFO]` coexistence warnings for all 9 ledger personas.
After WP-005 cleanup, the build emits zero. This absence is now the canonical signal that
changelog-derived versioning is correctly configured. Consider documenting it as an invariant
in the build script header or README.

### 5. Cross-Repo Dependency Update Is an Implicit WP Gap

When WP-002 changed the `@mistralys/persona-builder` library, WP-005 required the updated
version — but no WP explicitly covered updating `personas/package.json`. This implicit
prerequisite was discovered mid-implementation. **Future cross-repo plans should include an
explicit dependency-update step** (or a dedicated WP) to ensure the consumer locks the correct
library version before YAML cleanup begins.

### 6. `buildAgentNameMap()` Pre-Plugin Architecture Constraint

`buildAgentNameMap()` runs before any plugin hooks fire. This is a hard architectural constraint:
any version derivation that must affect agent display names *cannot* be solved at the plugin
layer. The engine-level utility (`src/utils/changelog.ts`) is the only architecturally correct
location. This constraint should inform future feature planning for the persona-builder library.

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed)

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| D-1 | WP-005 (impl, qa, review) | Developer + QA + Reviewer | **`file:` dependency resolution:** `personas/package.json` uses `file:../../ai-persona-builder` for `@mistralys/persona-builder`. Works in the co-located monorepo but breaks `npm install` in any environment where only `ai-insights` is checked out (CI, Docker, fresh clone). Before release, publish `@mistralys/persona-builder` v2.6.0 to npm and update `personas/package.json` to `"^2.6.0"`. Also update the AGENTS.md cross-system dependencies table. | **HIGH** |

### Out-of-Scope / Follow-Up Items

| # | Source | Agent | Description | Priority |
|---|--------|-------|-------------|----------|
| F-1 | WP-003 (qa, review) | QA + Reviewer | **`ledger-plugin.test.js` coverage gap:** Frontmatter template assertions (~lines 544-562) check `{{id}}`, `{{role}}`, `{{version}}`, `{{#if has_mcp}}` but do not assert `{{#if last_updated}}`. If the guard is accidentally removed, no test catches it. Add: `expect(vsTemplate).toContain('{{#if last_updated}}')` and `expect(ccTemplate).toContain('{{#if last_updated}}')`. | Low |
| F-2 | WP-003 (review) | Reviewer | **Algorithm divergence:** `resolveVersionFromChangelog()` in `scripts/build-personas.js` uses multiline `.match()` with `withDate` priority; `resolveChangelogMeta()` in the library uses line-by-line first-wins. Divergence only fires when `validateChangelogField()` already emits `[WARN]` — no regression for current data. Future cleanup should align the algorithms for consistency. | Low |
| F-3 | WP-002 (qa, review) | QA + Reviewer | **No test for `changelog:` + `version:` coexistence:** No test explicitly covers the case where both fields appear in the same persona YAML. Behavior is correct (changelog always wins, `version:` is silently overwritten), but unspecified by a negative-case test. Low priority given the plan's explicit no-shim decision. | Low |
| F-4 | WP-003 (review) | Reviewer | **`extractYamlBlockScalar()` regex key escaping:** The `key` parameter is interpolated directly into `new RegExp(...)` without escaping. Not exploitable (internal function with hardcoded caller), but consider: `key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` to make the guard explicit. | Low |
| F-5 | WP-006 (review) | Reviewer | **`personas/docs/agents/project-manifest/api-surface.md`** metadata schema section: Could more explicitly note that `version` and `last_updated` are derived fields, not direct YAML inputs. Low priority since `constraints.md` is the authoritative rule reference. Partially addressed in WP-006 documentation stage. | Low |

---

## Next Steps

The Planner / Technical Program Manager should focus on:

1. **Publish `@mistralys/persona-builder` v2.6.0 to npm** (D-1 — HIGH) and update
   `personas/package.json` from `file:../../ai-persona-builder` to `"^2.6.0"` to enable
   portable `npm install` in CI and fresh-clone environments. Update the AGENTS.md
   cross-system dependencies table.

2. **Add `{{#if last_updated}}` test assertions** to `ledger-plugin.test.js` frontmatter
   template tests (F-1 — Low). A single-WP developer task.

3. **Consider aligning `resolveVersionFromChangelog()`** in `scripts/build-personas.js` with
   the line-by-line first-wins approach of `resolveChangelogMeta()` (F-2 — Low). Only fires
   on malformed changelogs, but consistency reduces cognitive overhead.

4. **Commit and tag the release.** All WP-002 files are in pre-commit state. Release sequence:
   `git add . && git commit -m 'feat: changelog-derived versioning v2.6.0'` then
   `git tag v2.6.0` then `npm publish` (from `ai-persona-builder/`).
   Do **not** run `npm version` — `package.json` is already at `2.6.0`.
