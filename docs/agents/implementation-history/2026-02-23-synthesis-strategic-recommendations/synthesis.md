# Synthesis Report — Synthesis Strategic Recommendations Cleanup

**Plan:** `2026-02-23-synthesis-strategic-recommendations`
**Date:** 2026-02-23
**Status:** COMPLETE

---

## Executive Summary

This project implemented five of the six open strategic recommendations ("Gold Nuggets") identified in the prior Multi-IDE Persona Support project synthesis. All three work packages completed the full implementation → QA → code review → documentation pipeline without any failures or blockers.

The deliverables fall into three categories:

1. **YAML deduplication (WP-001):** Centralized the shared `cc_tools` list from seven per-persona YAML files into a single `default_cc_tools` array in `_shared.yaml`, and replaced a computed `cc_name` derivation with a direct `.replace()` from `cc_file_name`. Approximately 90 lines of duplicate YAML removed.

2. **Sync script DRY refactor (WP-002):** Collapsed two ~25-line frontmatter extraction functions (`extractVSFileName`, `extractCCFileName`) into 3-line wrappers delegating to `parseFrontmatter()`. Removed the dead `findMarkdownFiles()` function entirely. Net reduction of ~55 lines and one dead-code path.

3. **Constraints renumbering (WP-003):** Converted the hybrid constraint numbering scheme in `personas/docs/agents/project-manifest/constraints.md` (which included `9a`, `9b`, `11a`, `11b`) to a clean sequential integer scheme: 30 constraints numbered 1–30.

---

## Metrics

| WP | Tests Passed | Tests Failed | Files Modified |
|----|-------------|--------------|----------------|
| WP-001 | 22 | 0 | 11 |
| WP-002 | 11 | 0 | 2 |
| WP-003 | 15 | 0 | 1 |
| **Total** | **48** | **0** | **14** |

All 14 acceptance criteria across all 3 work packages were met.

`node scripts/build-personas.js --check` passed after every work package — no regressions to the 14 generated persona output files.

---

## Acceptance Criteria Coverage

### WP-001 — Consolidate `cc_tools` and derive `cc_name`

| AC | Result |
|----|--------|
| `_shared.yaml` contains `default_cc_tools` (exactly 9 tools) | ✅ PASS |
| None of the 7 per-persona YAMLs contain a `cc_tools` key | ✅ PASS |
| `build-personas.js` uses `persona.cc_tools \|\| sharedMeta.default_cc_tools` fallback | ✅ PASS |
| `cc_name` derived as `persona.cc_file_name.replace(/\.md$/, '')` | ✅ PASS |
| `node scripts/build-personas.js --check` passes | ✅ PASS |
| `api-surface.md` documents `default_cc_tools` and `cc_name` derivation | ✅ PASS |

### WP-002 — Sync script cleanup

| AC | Result |
|----|--------|
| `extractVSFileName()` delegates to `parseFrontmatter()` and is ≤5 lines | ✅ PASS |
| `extractCCFileName()` delegates to `parseFrontmatter()` and is ≤5 lines | ✅ PASS |
| `findMarkdownFiles()` removed from `sync-personas.js` | ✅ PASS |
| `findMarkdownFiles` entry removed from `api-surface.md` | ✅ PASS |
| `--dry-run` forwarding comment present in `main()` | ✅ PASS |
| `node scripts/sync-personas.js --dry-run` output identical to baseline | ✅ PASS |

### WP-003 — Constraints renumbering

| AC | Result |
|----|--------|
| `constraints.md` uses only sequential integers (no hybrid identifiers) | ✅ PASS |
| No unresolved references to old hybrid numbers in workspace | ✅ PASS |
| `node scripts/build-personas.js --check` passes after renumbering | ✅ PASS |

---

## Strategic Recommendations

### 1. Add null guard for `cc_file_name` in `build-personas.js` *(Low Priority)*

**Source:** WP-001 code review

`scripts/build-personas.js` at the `cc_name` derivation line executes `persona.cc_file_name.replace(/\.md$/, '')` with no null guard. If a future persona YAML is added without the required `cc_file_name` key, the build will throw a generic `TypeError`. The fix is a single early-validation guard matching the style already used elsewhere in the build script:

```js
if (!persona.cc_file_name) {
  throw new Error(`Persona "${persona.role}" is missing required field: cc_file_name`);
}
```

This is the only open technical observation from all three code reviews.

### 2. Consider replacing the hand-rolled YAML parser in `parseFrontmatter()` *(Low Priority, Constrained)*

**Source:** WP-002 code review

`scripts/sync-personas.js` uses a hand-rolled line-regex parser for frontmatter rather than `js-yaml`. This is **intentionally constrained**: `js-yaml` lives in `personas/node_modules/` and is not accessible from `scripts/`. The current parser handles flat key-value frontmatter correctly for all current personas.

If the persona frontmatter ever grows to use nested YAML (arrays, objects), the parser will silently misbehave. A longer-term option is to move `scripts/sync-personas.js` into the `personas/` package context where `js-yaml` is available, or add `js-yaml` to a root-level `package.json`.

### 3. Document the `mcp-server` constraint number independence *(Low Priority)*

**Source:** WP-003 implementation + code review

`mcp-server/docs/agents/project-manifest/constraints.md` uses its **own independent numbering** that also includes a `9a`/`9b`-style scheme. This was correctly left untouched in WP-003, but the independence is currently implicit. Consider adding a brief note at the top of each constraints file clarifying that constraint numbers are local to their sub-project and must not be cross-referenced.

---

## Artifacts

### Files Modified

**WP-001 (11 files):**
- `personas/ledger/src/meta/_shared.yaml` — added `default_cc_tools`
- `personas/ledger/src/meta/1-planner.yaml` through `7-synthesis.yaml` (7 files) — removed `cc_tools` key
- `scripts/build-personas.js` — updated `cc_name` derivation and `cc_tools_json` fallback
- `personas/docs/agents/project-manifest/api-surface.md` — schema and computed variable docs
- `personas/docs/agents/project-manifest/constraints.md` — cc_name/cc_tools override pattern docs
- `personas/docs/agents/project-manifest/data-flows.md` — stale inline comments fixed (Documentation)

**WP-002 (2 files):**
- `scripts/sync-personas.js` — refactored extract functions, removed dead code
- `personas/docs/agents/project-manifest/api-surface.md` — removed `findMarkdownFiles` row

**WP-003 (1 file):**
- `personas/docs/agents/project-manifest/constraints.md` — renumbered 1–30

---

## Gold Nuggets Addressed

| Gold Nugget | WP | Status |
|-------------|-----|--------|
| #1: Centralize `cc_tools` into `_shared.yaml` | WP-001 | ✅ Done |
| #2: Collapse `extractVSFileName()` / `extractCCFileName()` | WP-002 | ✅ Done |
| #3: Delete dead `findMarkdownFiles()` | WP-002 | ✅ Done |
| #4: Document nested `{{#if}}` limitation | — | ✅ Done (prior project) |
| #5: Derive `cc_name` from `cc_file_name` | WP-001 | ✅ Done |
| #6: Renumber constraints sequentially | WP-003 | ✅ Done |
| #7: Add `--dry-run` forwarding comment | WP-002 | ✅ Done |

All 6 open Gold Nuggets (excluding #4, already resolved) are now complete.

---

## Next Steps

1. **Add `cc_file_name` null guard** in `scripts/build-personas.js` (Recommendation #1 above). This is a one-line defensive fix suitable for the next maintenance window.

2. **No further work from this plan.** All 3 WPs are COMPLETE with 0 failures.

3. **Future watch item:** If persona frontmatter grows beyond flat key-value pairs, revisit the `parseFrontmatter()` hand-rolled parser (Recommendation #2).
