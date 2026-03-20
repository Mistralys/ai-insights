# Plan

## Summary

Act on the open items from the `2026-03-18-shared-role-manifest-rework-3` synthesis and the newly surfaced items from the `2026-03-18-shared-role-manifest-rework-4` synthesis. The three code-change items from rework-3 (PASS-branch routing, CI cache path, `FAIL_ROUTING_AGENT_MAP` tests) are already implemented; the only open rework-3 item is **end-to-end CI validation on a PR**. The rework-4 synthesis surfaced three new implementation items: (1) add isolated FAIL-branch test classes for the untested pipeline stages in `test_supervisor.py`, (2) add `PIPELINE_AGENT_MAP` structural snapshot assertions to `test_config.py`, and (3) create a Dependabot configuration to keep SHA-pinned GitHub Actions refs current.

## Architectural Context

### Orchestrator test suite — `test_supervisor.py`

- **File:** `orchestrator/tests/test_supervisor.py`
- 257 tests across ~1,090 lines. All routing is exercised through `_derive_next_action` (which is now fully manifest-derived for both PASS and FAIL branches) and the `make_mcp_tools_with_actions` / `TestDirectActionRouting` path.
- **Gap:** No isolated `TestRouteToSecurityAuditor`, `TestRouteToReleaseEngineer`, or `TestRouteToDocumentation` classes exist. The security-audit, release-engineering, and documentation happy-path and FAIL-rework routes are only implicitly covered as intermediate steps in multi-pipeline integration tests.
- Existing model classes for reference: `TestRouteToDeveloper` (lines 250–317), `TestRouteToQA` (lines 324–339), `TestRouteToReviewer` (lines 346–365), `TestRouteToDocs` (lines 372–393).

### Orchestrator test suite — `test_config.py`

- **File:** `orchestrator/tests/test_config.py`
- Contains structural snapshot classes for `WP_TERMINAL_STATUSES`, `VALID_STAGES`, `PIPELINE_TYPES`, `ROLE_IDS`, `PIPELINE_ROLE_NAMES`, and `FAIL_ROUTING_AGENT_MAP`.
- **Gap:** `PIPELINE_AGENT_MAP` (exported from `orchestrator/src/config.py`) has no parallel snapshot test class. It is critical to the `_derive_next_action` routing helper but its derivation correctness is only tested transitively.
- `PIPELINE_AGENT_MAP` maps pipeline type → owning agent role name and is derived from the manifest `roles[].pipeline` field.

### CI configuration — `.github/workflows/ci.yml`

- **File:** `.github/workflows/ci.yml`
- Five jobs: `mcp-server-tests`, `orchestrator-tests`, `ruff`, `manifest-validation`, `persona-build-check`.
- All 10 action refs are SHA-pinned (WP-003 from rework-4 completed this).
- **Gap:** No `.github/dependabot.yml` exists. Pinned SHAs require manual updates when GitHub releases patches for `actions/checkout`, `actions/setup-node`, and `actions/setup-python`. Dependabot can automate this.

### CI validation status

- The `feature-extended-workflow` branch has never been pushed to trigger the CI workflow against `main`. The five CI jobs (MCP server tests, orchestrator tests, ruff, manifest validation, persona build check) have not been verified green end-to-end in a real GitHub Actions run.

## Approach / Architecture

### 1. Add FAIL-branch unit test classes for untested pipeline stages

Add three new test classes to `orchestrator/tests/test_supervisor.py` following the exact pattern of existing routing test classes:

- `TestRouteToSecurityAuditor` — tests that a PASS qa + no security-audit pipeline routes to `security_auditor`, and that a FAIL security-audit pipeline reroutes to `developer` (FAIL → Developer per `FAIL_ROUTING_AGENT_MAP`).
- `TestRouteToReleaseEngineer` — tests that a PASS code-review + no release-engineering pipeline routes to `release_engineer`, and that a FAIL release-engineering pipeline reroutes to `release_engineer` (FAIL → Release Engineer per `FAIL_ROUTING_AGENT_MAP`).
- `TestRouteToDocumentation` — tests that a PASS release-engineering + no documentation pipeline routes to `docs`, and that a FAIL documentation pipeline reroutes to `docs` (FAIL → Documentation per `FAIL_ROUTING_AGENT_MAP`).

These tests use the existing `make_mcp_tools`, `wp_summary`, `wp_with_pipelines`, and `pipeline` helpers — no new infrastructure needed.

### 2. Add `PIPELINE_AGENT_MAP` snapshot tests

Add a new `TestPipelineAgentMap` class to `orchestrator/tests/test_config.py` modelled after the existing `TestFailRoutingAgentMap` class. Assertions:

- `test_is_dict` — type check
- `test_non_empty` — length > 0
- `test_all_pipeline_types_are_keys` — every type in `PIPELINE_TYPES` is a key
- `test_all_values_are_valid_role_names` — all values are in `PIPELINE_ROLE_NAMES`
- `test_implementation_maps_to_developer` — explicit spot-check
- `test_release_engineering_maps_to_release_engineer` — spot-check the non-obvious mapping

Add `PIPELINE_AGENT_MAP` to the existing `from src.config import ...` block at the top of the file.

### 3. Create `.github/dependabot.yml`

Create a minimal Dependabot config file at the workspace root that enables automated pull requests for the `github-actions` ecosystem. Target `main` branch with a monthly schedule to keep SHA-pinned action refs current without generating excessive noise.

### 4. CI end-to-end validation (verification step)

Push the `feature-extended-workflow` branch and open a pull request against `main`. Confirm all five CI jobs pass green. This is an operational step, not a code change.

## Rationale

- **FAIL-branch test coverage (item 1):** The manifest-derived refactor in rework-4 completed the structural drift-proofing, but leaving the security-audit, release-engineering, and documentation routes untested at the unit level is a silent regression risk. Adding isolated test classes is low effort and follows the established pattern exactly.
- **`PIPELINE_AGENT_MAP` snapshot tests (item 2):** `PIPELINE_AGENT_MAP` is the critical constant powering all PASS-branch routing in `_derive_next_action`. Without a snapshot test, a manifest-derivation regression (e.g., missing `pipeline` field on a role) would only be caught by integration-level routing tests, not at the constant level where it's easiest to diagnose.
- **Dependabot (item 3):** SHA pinning without automated maintenance trades one risk (mutable tags) for another (forever-stale SHAs). Dependabot closes this gap with minimal configuration.
- **CI validation (item 4):** All CI jobs are configured and theoretically correct but have never run against the main branch in GitHub Actions. Running them on a PR is the only way to confirm there are no environment-level issues (e.g., missing Node.js version, pip installation edge cases).

## Detailed Steps

### Step 1 — Add routing test classes to `test_supervisor.py`

**File:** `orchestrator/tests/test_supervisor.py`

1. After the existing `TestRouteToDocs` class (approximately line 393), add `TestRouteToSecurityAuditor`:
   - `test_pass_qa_no_security_audit_routes_to_security_auditor`: pipelines = [impl PASS, qa PASS], no security-audit → expect `cmd.goto == "security_auditor"`.
   - `test_security_audit_fail_routes_to_developer`: pipelines = [impl PASS, qa PASS, security-audit FAIL] → expect `cmd.goto == "developer"` (FAIL_ROUTING_AGENT_MAP routes security-audit FAIL to Developer).

2. After `TestRouteToSecurityAuditor`, add `TestRouteToReleaseEngineer`:
   - `test_pass_code_review_no_release_engineering_routes_to_release_engineer`: pipelines = [impl PASS, qa PASS, sa PASS, cr PASS], no release-engineering → expect `cmd.goto == "release_engineer"`.
   - `test_release_engineering_fail_routes_to_release_engineer`: pipelines = [..., release-engineering FAIL] → expect `cmd.goto == "release_engineer"` (FAIL_ROUTING_AGENT_MAP routes release-engineering FAIL to Release Engineer).

3. After `TestRouteToReleaseEngineer`, add `TestRouteToDocumentation` (note: `TestRouteToDocs` already exists and tests the happy-path; this new class adds FAIL coverage):
   - `test_documentation_fail_routes_to_docs`: pipelines = [impl PASS, qa PASS, sa PASS, cr PASS, re PASS, documentation FAIL] → expect `cmd.goto == "docs"` (FAIL_ROUTING_AGENT_MAP routes documentation FAIL to Documentation).

   Note: Rename the addition class clearly to avoid collision with the existing `TestRouteToDocs`. Use `TestDocumentationFail` or a similar name that does not shadow the existing class.

### Step 2 — Add `PIPELINE_AGENT_MAP` snapshot tests to `test_config.py`

**File:** `orchestrator/tests/test_config.py`

1. Add `PIPELINE_AGENT_MAP` to the import block (line 13 area):
   ```python
   from src.config import (
       FAIL_ROUTING_AGENT_MAP,
       PIPELINE_AGENT_MAP,
       ...
   )
   ```
2. Add a new `TestPipelineAgentMap` class after `TestPipelineRoleNames`:
   - `test_is_dict`
   - `test_non_empty`
   - `test_all_pipeline_types_are_keys` — loops over `PIPELINE_TYPES`
   - `test_all_values_are_valid_role_names` — checks membership in `PIPELINE_ROLE_NAMES`
   - `test_implementation_maps_to_developer`
   - `test_release_engineering_maps_to_release_engineer`

### Step 3 — Create `.github/dependabot.yml`

**File:** `.github/dependabot.yml` (new file)

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
```

### Step 4 — Run the orchestrator test suite locally

```bash
cd orchestrator && pytest
```

Verify all tests pass (expected: 257+ passing, 0 failing).

### Step 5 — CI end-to-end validation

1. Push the `feature-extended-workflow` branch to the remote.
2. Open a pull request against `main`.
3. Monitor the GitHub Actions run; confirm all five jobs complete with green status:
   - `MCP Server Tests`
   - `Orchestrator Tests`
   - `Ruff Linting`
   - `Manifest Validation`
   - `Persona Build Check`

## Dependencies

- Step 2 (snapshot tests) can be implemented independently of Step 1.
- Step 3 (Dependabot) is fully independent.
- Step 4 (local test run) validates Step 1 and Step 2 before Step 5.
- Step 5 (CI PR) depends on Steps 1–4 being complete and the branch pushed.

## Required Components

- `orchestrator/tests/test_supervisor.py` — add 3–4 new test methods in new test classes
- `orchestrator/tests/test_config.py` — add `TestPipelineAgentMap` class and import
- `.github/dependabot.yml` — new file (workspace root)

## Assumptions

- `FAIL_ROUTING_AGENT_MAP["security-audit"]` resolves to `"Developer"` (verified by existing `TestFailRoutingAgentMap.test_all_values_are_valid_role_names`).
- `FAIL_ROUTING_AGENT_MAP["release-engineering"]` resolves to `"Release Engineer"` (asserted by `TestFailRoutingAgentMap.test_release_engineering_routes_to_release_engineer`).
- `FAIL_ROUTING_AGENT_MAP["documentation"]` resolves to `"Documentation"` (asserted by `TestFailRoutingAgentMap.test_documentation_routes_to_documentation`).
- The GitHub-hosted `ubuntu-latest` runner satisfies all dependencies (Node.js 20, Python 3.11) — this is standard and well-established.
- The CI workflow file is syntactically valid (no change needed; only adding Dependabot).

## Constraints

- No changes to production source files are required — all work is in tests and CI configuration.
- New test classes must follow the exact structural pattern of existing routing test classes (`TestRouteToDeveloper`, `TestRouteToQA`, etc.) for stylistic consistency.
- Dependabot config must not set an overly aggressive schedule (daily/weekly) that would create noise — monthly is appropriate for Actions SHA maintenance.

## Out of Scope

- Promoting action vocabulary strings (`IMPLEMENT`, `RUN_QA`, etc.) to `shared/workflow-manifest.json` — deferred per rework-4 synthesis item #4 (informational).
- Modifying production supervisor or config code — no production changes are needed.
- Adding Dependabot for `npm` or `pip` ecosystems — the request is specifically for GitHub Actions SHA maintenance.

## Acceptance Criteria

- `orchestrator/tests/test_supervisor.py` contains isolated test coverage for the security-audit PASS route (`→ security_auditor`), release-engineering PASS route (`→ release_engineer`), release-engineering FAIL route (`→ release_engineer`), and documentation FAIL route (`→ docs`).
- `orchestrator/tests/test_config.py` contains a `TestPipelineAgentMap` class with structural assertions covering type, completeness, value validity, and two explicit spot-checks.
- `.github/dependabot.yml` exists at the workspace root with a `github-actions` ecosystem entry targeting `main` on a monthly schedule.
- All orchestrator tests pass locally (`pytest` exits 0).
- A PR against `main` triggers all five CI jobs and all five reach green status.

## Testing Strategy

The testing additions are the deliverable here; the `pytest` run confirms no regressions. The CI PR is the final end-to-end verification gate. No new test frameworks or helpers are required — all new tests use the existing `make_mcp_tools`, `wp_summary`, `wp_with_pipelines`, and `pipeline` helpers from `test_supervisor.py`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CI fails on first PR run** due to a runner environment issue (e.g., Node.js version mismatch, pip cache miss) | Run tests locally first (Step 4). If CI fails, diagnose against the job log; the fix is likely a minor workflow tweak, not a code change. |
| **New routing tests reveal a real routing bug** in `_derive_next_action` for the newly covered branches | This is a feature, not a risk — if the helper has a bug in the untested branches, the tests will catch it and the bug can be fixed before merge. |
| **Dependabot opens noisy PRs** from SHA updates | Monthly schedule minimises frequency. PRs are auto-generated and can be squash-merged in seconds; the overhead is acceptable. |
| **`TestPipelineAgentMap` assertions are overly strict** and fail when new roles are added to the manifest | Tests are written as structural assertions (key completeness relative to `PIPELINE_TYPES`, value membership in `PIPELINE_ROLE_NAMES`) not exhaustive hardcoded dictionaries, so they remain valid when the manifest grows. |
