# Project Synthesis Report

**Plan:** `2026-03-15-persona-build-pipeline-fixes`
**Date:** 2026-03-15
**Status:** COMPLETE
**Synthesized By:** Head of Operations (Synthesis)

---

## Executive Summary

This plan addressed four actionable follow-up items from the `2026-03-14-9-agent-personas-rework-1` synthesis. All five work packages completed successfully. The persona build pipeline (`scripts/build-personas.js`) now correctly generates VS Code output files with `.agent.md` extensions, standalone Claude Code personas with MCP tool declarations receive auto-injected `mcpServers` frontmatter, the standalone README is self-contained, and the personas manifest constraints document is renumbered to a clean monotonic 1–47 sequence.

**Files changed:** `scripts/build-personas.js`, `personas/ledger/vs-code/` (9 files), `personas/standalone/vs-code/` (15 files), `personas/standalone/claude-code/` (15 files), `personas/docs/agents/project-manifest/` (5 files), `personas/standalone/README.md`, `personas/ledger/README.md`, `personas/changelog.md`, `personas/package.json`, `AGENTS.md`.

**Personas version:** `3.8.1` → `3.9.0`

---

## Metrics

| WP | Title | ACs Met | Tests | Result |
|----|-------|---------|-------|--------|
| WP-001 | VS Code Output Filename Fix | 7/7 | 7/7 | PASS |
| WP-002 | Constraints.md Renumbering | 5/5 | 5/5 | PASS |
| WP-003 | mcpServers Auto-Injection | 5/5 | 6/6 | PASS |
| WP-004 | Inline WP-007 / README Cleanup | 4/4 | 4/4 | PASS |
| WP-005 | Final Validation Build | 7/7 | 7+1281 | PASS (2 reworks) |

**mcp-server test suite (WP-005):** 1,281 tests passed, 0 failed, 41 test files.
**Persona build:** 48/48 files generated across 2 suites × 2 targets; all 48 pass `--check --strict` freshness validation.
**Role sync:** 9/9 roles in sync (`KNOWN_ROLES` ↔ `AGENT_ROLES`).

---

## Work Package Details

### WP-001 — VS Code Output Filename Fix

**Root cause:** `buildForTarget()` used `contentBasename` (derived from the YAML filename, e.g. `1-planner.md`) for both the content template lookup *and* the output file write path. The `vs_file_name` YAML field declared `.agent.md` but was never used for the write path.

**Fix:** Separated `contentBasename` (input path) from `outputBasename` (output path). Added `validateVsFileName()` helper mirroring the existing `validateCcFileName()`. VS Code targets now write to `persona.vs_file_name`; Claude Code targets continue using `persona.cc_file_name`.

**Outcome:** 24 old `.md` files deleted; 48 personas rebuilt with correct `.agent.md` extensions on VS Code targets. `file-tree.md` manifest updated. Downstream: `AGENTS.md` and `personas/ledger/README.md` updated with new `.agent.md` file references.

---

### WP-002 — Constraints.md Renumbering

**Root cause:** `personas/docs/agents/project-manifest/constraints.md` had out-of-order numbering (1–35, then 44–45, then 36–43) with a gap at position 38.

**Fix:** Renumbered all 47 constraints into a clean monotonic 1–47 top-to-bottom sequence. Recovered constraints 39 and 40 (Canonical Pipeline Stage Ordering and Work Package IDs Auto-Generated) from changelog v3.8.1. Updated four external cross-references: `personas/changelog.md` (44/45 → 39/40), `api-surface.md` (constraint 9 → 10 GN-4/GN-5), `standalone/README.md` (constraint 21 → 19), `constraints.md` self-reference (32b → 34).

**WP-002 Documentation pass** additionally fixed the constraints file for the 9-agent system: expanded the MCP Tool Allocation Matrix from 7 to 9 columns, fixed the `9-synthesis.md` reference in constraint 21, updated the Feature Flag Reference table, and added the missing `ledger_update_work_package_status` row.

---

### WP-003 — mcpServers Auto-Injection for Standalone Claude Code

**Root cause:** `FRONTMATTER_STANDALONE_CC` had no `mcpServers` block, making MCP-dependent standalone personas (e.g. `ledger-bootstrapper`) non-functional in Claude Code.

**Fix:** Added `extractMcpServers(tools)` helper that filters tool entries containing `/` and extracts unique server name prefixes. Added `{{mcp_servers_yaml}}` computed variable to `FRONTMATTER_STANDALONE_CC`. The variable resolves to `\nmcpServers:\n  - server_name` when MCP tools are present, or `''` (no block) when absent.

**Outcome:** `ledger-bootstrapper.md` has `mcpServers: central_pm` in frontmatter. All 14 other standalone CC personas have no `mcpServers` block. `api-surface.md` updated with `extractMcpServers()` entry and `{{mcp_servers_yaml}}` computed variable. `standalone/README.md` replaced the "Claude Code Limitations" section with a "Claude Code — MCP Server Auto-Injection" section.

---

### WP-004 — Inline WP-007 Content / README Cleanup

**Root cause:** `personas/standalone/README.md` linked to a plan artifact (`WP-007-recommendation.md`) that would be archived.

**Verification:** All 4 ACs confirmed already satisfied by WP-003's documentation pass. No `WP-007-recommendation.md` links, no orphaned workaround content, `mcpServers` derivation mechanism fully explained, README is self-contained.

---

### WP-005 — Final Validation Build

**Summary:** End-to-end validation across all deliverables. All commands green on first try from the implementation side.

**Rework history (2 cycles):** Code review found two stale `no mcpServers` references in `persona/docs/agents/project-manifest/file-tree.md` that were missed during WP-003 documentation:
1. **Cycle 1 (FAIL):** Inline comment on `ledger-bootstrapper.md` entry still said "standalone CC template has no mcpServers support". Fixed via rework.
2. **Cycle 2 (FAIL):** Directory Purposes table row for `personas/standalone/claude-code/` still said "no `mcpServers`". Fixed via second rework. QA's stale-phrase scan had used exact old phrases and missed this shorter form.

After two reworks, all reference points in `file-tree.md` are accurate. Documentation pass also updated `data-flows.md` (stale `*.md` labels → `*.agent.md`, both suites shown) and bumped the manifest `README.md` to v1.2.0.

---

## Strategic Recommendations (Gold Nuggets)

### GN-1: Comment artifact outcome separately from template capability in manifests

Identified by: Reviewer (WP-005, cycle 3), rated high-value.

> "Comment on the *file* describes the output artifact; the table *cell* describes the directory-level capability."

In `file-tree.md`, individual file annotations should describe what the output file contains (`mcpServers block omitted — persona has zero MCP tool entries`), while directory table entries describe the *capability* of the template (`mcpServers conditionally injected for personas with MCP tool entries in tools`). This distinction prevents the two reference points from being conflated — exactly the error that caused two rework cycles in WP-005.

---

### GN-2: Document design asymmetries in README callout boxes

Identified by: Developer (WP-003), confirmed by QA, Reviewer, and Documentation across WP-003/WP-005.

The `Important` callout in `standalone/README.md` explicitly documents that `extractMcpServers()` reads `persona.tools` (not `persona.cc_tools`) to derive server names. This was praised by three independent agents as high-value defensive documentation that prevents a subtle authoring error that would be difficult to debug. Carry this pattern forward for any similar derived-field behaviors or field-source asymmetries in the codebase.

---

### GN-3: Include stale-text grep in final-validation acceptance criteria

Identified by: Reviewer (WP-005, cycle 2 post-mortem).

When a WP replaces a named concept (e.g. "no mcpServers support"), the final-validation ACs should include a broader grep pattern for all forms of the old text — not just the exact phrase. In this plan, QA searched for `'no mcpServers support'` but missed `'no \`mcpServers\`'`. Recommended pattern: `grep -in 'no.{0,10}mcpservers'` across all affected doc directories as a standard validation step in any "fix stale documentation" work package.

---

## Deferred Technical Debt

| Item | Source | Priority | Recommendation |
|------|--------|----------|----------------|
| No automated unit tests for `build-personas.js` helpers | Developer (WP-003), QA (WP-003), Reviewer (WP-003, WP-005) — 3-agent consensus | Medium | Create a lightweight vitest test file covering `extractMcpServers()`, `validateVsFileName()`, `validateCcFileName()`, and `serializeTools()`. These functions have deterministic behavior and clear edge cases. |
| `validateCcFileName()` + `validateVsFileName()` near-duplicate | Reviewer (WP-005, carryover) | Low | Unify as `validateFileName(persona, fieldName, suite)`. Identical logic, different field name and error message. |
| STRICT mode `{{…}}` regex scan does not strip fenced code blocks | Developer (WP-001), QA (WP-001), Reviewer (WP-001) — 3-agent consensus | Low | Strip Markdown fenced blocks before scanning for unresolved markers. No current persona triggers this, but it's an undocumented fragility. |
| Inline constraint number citations are fragile under renumbering | Reviewer (WP-004) | Low | Add named anchors (e.g. `<a name="c19"></a>`) to constraint headings in `constraints.md` so cross-document links target headings rather than bare numbers. |
| `extractMcpServers()` uses `Array.includes()` for deduplication (O(n²)) | Reviewer (WP-005) | Low | Replace with `Set`-based deduplication — idiomatic and more efficient at scale, even if not a current bottleneck. |
| `unit-test-auditor` persona catalog description is sparse | Reviewer (WP-004) | Low | Align description with the other 14 standalone personas — verb-forward, purpose-specific summary. |

---

## Next Steps for Planner / Manager

1. **Create a follow-up WP: Automated tests for `build-personas.js`** — Three independent agents flagged this across two WPs. This is the highest-value deferred debt item. A vitest test file with edge-case coverage of `extractMcpServers()` and the filename validators would prevent regressions without relying solely on `--check` freshness mode.
2. **Minor housekeeping sweep** — Combine the low-priority DRY / comment wording items (GN dedup, validateFileName unification, unit-test-auditor description, STRICT mode fenced-block handling) into a single small housekeeping WP.
3. **Consider named constraint anchors** — Low priority but would make the constraints file a more robust cross-reference target in multi-WP plans.
