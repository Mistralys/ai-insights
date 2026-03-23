# Synthesis Report — 2026-03-18-shared-role-manifest-rework-3

**Date:** 2026-03-19  
**Plan:** Shared Role Manifest Rework — Iteration 3  
**Status:** COMPLETE  
**Work Packages:** 6 / 6  
**Agent Pipeline Health:** 6 / 6 all stages PASS

---

## Executive Summary

This session delivered three actionable strategic recommendations from the previous synthesis cycle:

1. **`FAIL_ROUTING_AGENT_MAP` constant** — Added a manifest-derived constant to `orchestrator/src/config.py` that maps each pipeline type to the responsible fail-rework agent role. The `_derive_next_action` test helper in `test_supervisor.py` now looks up this map instead of maintaining six hard-coded strings, eliminating the primary drift risk identified in the previous session.

2. **`_DISPATCH_ACTIONS` comment clarification** — Moved `REWORK` from the `# Developer` comment block in `supervisor.py` to a new `# Multi-role (routed by fail_routing in workflow manifest)` group, accurately reflecting that REWORK dispatches to Release Engineer and Documentation in addition to Developer.

3. **CI workflow** — Created `.github/workflows/ci.yml` with five independent, merge-gating jobs: MCP server tests, orchestrator tests, ruff linting, manifest validation, and persona build check. Documentation was added across the root README, orchestrator README, and MCP server constraints to make CI expectations visible to agents and developers.

---

## Metrics

| Work Package | Scope | Tests Passed | Files Changed |
|---|---|---|---|
| WP-001 | `FAIL_ROUTING_AGENT_MAP` constant | 251 | 2 |
| WP-002 | `TestFailRoutingAgentMap` test class (6 methods) | 35 / 250 suite | 2 |
| WP-003 | Refactor `_derive_next_action` FAIL branches | 257 / 258 (1 pre-existing skip) | 1 |
| WP-004 | `REWORK` comment group fix in `supervisor.py` | 251 | 1 |
| WP-005 | Create `.github/workflows/ci.yml` (5 jobs) | — (YAML validation) | 2 |
| WP-006 | CI documentation cross-referencing | — (3 doc sections) | 2 |

**Final orchestrator suite:** 258 tests pass, 0 fail, 1 pre-existing skip  
**New test methods added:** 6 (`TestFailRoutingAgentMap` in `test_config.py`)  
**Files created:** 1 (`.github/workflows/ci.yml`)  
**Files modified:** 8 total across orchestrator, mcp-server, and root

---

## Strategic Recommendations

### Gold Nuggets

1. **PASS-branch routing still hard-codes role names.**  
   `_derive_next_action` in `test_supervisor.py` now derives FAIL-branch targets from the manifest, but the PASS-branch role name strings (`'QA'`, `'Security Auditor'`, `'Reviewer'`, etc.) are still hard-coded literals. A follow-up WP extending the derivation approach to PASS-branch targets would complete the manifest-driven test helper.

2. **CI cache gap: `mcp-server-tests` misses `personas/package-lock.json`.**  
   The `mcp-server-tests` CI job installs personas dependencies (required by the `pretest` hook) but its `cache-dependency-path` only watches `mcp-server/package-lock.json`. A personas lock file change without a corresponding MCP server lock change could cause a stale cache hit. Fix: add `personas/package-lock.json` as a second line in the `cache-dependency-path` multi-line value.

3. **GitHub Actions pinned to major version tags, not SHA digests.**  
   All five workflow jobs use `@v4` / `@v5` action refs. For an internal monorepo this is acceptable, but SHA pinning would eliminate supply-chain risk. Low priority.

4. **`FAIL_ROUTING_AGENT_MAP` is not yet snapshot-tested in `test_config.py`.**  
   The WP-002 reviewer noted that the existing `TestPipelineTypes`, `TestRoleIDs`, etc. classes all provide structural snapshot coverage for their respective constants. A follow-up addition (`test_is_dict`, `test_all_six_pipeline_types_present`, `test_values_are_role_names`) would give `FAIL_ROUTING_AGENT_MAP` the same regression harness.

---

## Next Steps

For the next planning cycle, consider these focus areas (in priority order):

1. **Close the PASS-branch hard-coding** in `_derive_next_action` — extends the manifest-derivation pattern to PASS routing, completing the drift-proofing work started in this session.

2. **Add `FAIL_ROUTING_AGENT_MAP` snapshot tests** — a small, self-contained addition to `test_config.py` that rounds out the existing snapshot test convention.

3. **Fix CI personas cache-dependency-path** — single-line change to `.github/workflows/ci.yml`, no test impact.

4. **Run the CI workflow once on a PR** to confirm all five jobs reach the green state end-to-end.

---

## Artifacts Produced

| File | Change |
|---|---|
| `orchestrator/src/config.py` | Added `FAIL_ROUTING_AGENT_MAP` constant with `_resolve_fail_routing_role` helper |
| `orchestrator/tests/test_config.py` | Added `TestFailRoutingAgentMap` (6 test methods) |
| `orchestrator/tests/test_supervisor.py` | Replaced 6 hard-coded FAIL-branch strings with `FAIL_ROUTING_AGENT_MAP` lookups |
| `orchestrator/src/supervisor.py` | Comment-only: `REWORK` moved to `# Multi-role` group in `_DISPATCH_ACTIONS` |
| `.github/workflows/ci.yml` | Created (5 jobs) |
| `orchestrator/README.md` | Test count updated to 258; CI callout added; `FAIL_ROUTING_AGENT_MAP` listed |
| `orchestrator/docs/public-api.md` | `FAIL_ROUTING_AGENT_MAP` entry added to constants table |
| `README.md` | CI — Automated Quality Gate section added |
| `mcp-server/docs/agents/project-manifest/constraints.md` | CI gate blockquote added to Testing Constraints |
