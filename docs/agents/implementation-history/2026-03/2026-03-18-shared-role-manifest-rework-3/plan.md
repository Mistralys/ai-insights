# Plan

## Summary

Address all three actionable strategic recommendations from the `2026-03-18-shared-role-manifest-rework-2` synthesis: (1) derive the `_derive_next_action` test helper's FAIL-routing table from `shared/workflow-manifest.json` at test time to eliminate drift risk, (2) clarify the `_DISPATCH_ACTIONS` comment in the orchestrator's `supervisor.py` to reflect that `REWORK` dispatches to more than just Developer, and (3) establish a CI workflow that gates on the MCP server test suite, orchestrator test suite, and ruff zero-warning baseline.

## Architectural Context

### Orchestrator test helper — `_derive_next_action`

- **File:** [orchestrator/tests/test_supervisor.py](orchestrator/tests/test_supervisor.py) (lines 35–143)
- The helper simulates `ledger_get_next_action` routing for test mocks. It contains 6 hard-coded `elif <pipeline> == "FAIL"` branches that map pipeline types → agent role names (e.g., `impl == "FAIL" → Developer`, `re == "FAIL" → Release Engineer`).
- The docstring warns about drift risk against `shared/workflow-manifest.json → pipelines.fail_routing`, but the mapping is still manual.

### Manifest fail_routing

- **File:** [shared/workflow-manifest.json](shared/workflow-manifest.json) — contains `fail_routing` mapping pipeline type → role ID:
  ```json
  {
    "implementation": "developer",
    "qa": "developer",
    "security-audit": "developer",
    "code-review": "developer",
    "release-engineering": "release_engineer",
    "documentation": "docs"
  }
  ```

### Orchestrator config constants

- **File:** [orchestrator/src/config.py](orchestrator/src/config.py)
- Already loads the manifest and derives: `ROLE_IDS` (role name → role ID), `PIPELINE_AGENT_MAP` (pipeline type → role name), `PIPELINE_TO_STAGE`, `STAGE_TO_PIPELINE`, etc.
- Does **not** currently expose `fail_routing` as a derived constant.

### `_DISPATCH_ACTIONS` frozenset

- **File:** [orchestrator/src/supervisor.py](orchestrator/src/supervisor.py) (lines 59–74)
- Groups actions by owning agent role in comments. `REWORK` is listed under the `# Developer` comment block even though it also dispatches to Release Engineer (for `release-engineering` FAIL) and Documentation (for `documentation` FAIL).

### CI infrastructure

- **File:** [.github/workflows/release-personas.yml](.github/workflows/release-personas.yml) — only existing GitHub Actions workflow, handles persona release packaging.
- No CI gate workflow for tests or linting exists yet.

## Approach / Architecture

### 1. Derive FAIL routing from the manifest in tests

Add a new constant `FAIL_ROUTING_AGENT_MAP` in `orchestrator/src/config.py` that maps each pipeline type to the **agent role name** (not role ID) responsible for FAIL rework. This inverts the manifest's `fail_routing` mapping through the existing role data:

```python
# Pipeline type → agent name responsible for FAIL rework.
FAIL_ROUTING_AGENT_MAP: dict[str, str] = {
    ptype: next(r["name"] for r in _roles if r["id"] == role_id)
    for ptype, role_id in _pipelines["fail_routing"].items()
}
```

Then refactor `_derive_next_action` in `test_supervisor.py` to look up the FAIL-routing target from this constant instead of hard-coding agent names in each branch. The `elif <pipeline> == "FAIL"` branches become a single pattern using `FAIL_ROUTING_AGENT_MAP[pipeline_type]`.

### 2. Clarify `_DISPATCH_ACTIONS` comment

Move `REWORK` out of the `# Developer` group into its own group with a clarifying comment (e.g., `# Multi-role actions (see fail_routing in workflow manifest)`).

### 3. CI workflow for tests and linting

Create `.github/workflows/ci.yml` with a matrix job that:
- Runs MCP server tests (`cd mcp-server && npm ci && npm test`)
- Runs orchestrator tests (`cd orchestrator && pip install -e '.[dev]' && pytest`)
- Runs ruff linting (`cd orchestrator && ruff check src/`)
- Runs the workflow manifest validator (`node scripts/validate-workflow-manifest.js`)

Triggered on `push` and `pull_request` against the main branch.

## Rationale

- **Manifest derivation (item 1):** The docstring-as-sync-guard strategy works but is fundamentally fragile — a human must remember to cross-reference on every manifest change. Programmatic derivation from the manifest makes the test self-correcting, consistent with the existing pattern in `config.py` where all other routing constants are already manifest-derived.
- **Comment fix (item 2):** Cosmetic but prevents a future developer from wrongly assuming `REWORK` is Developer-only, which could lead to incorrect routing assumptions in new code.
- **CI (item 3):** The zero-warning ruff baseline and 1,700+ tests are meaningless as gates unless enforced in CI. The existing `release-personas.yml` proves the GitHub Actions infrastructure is already available.

## Detailed Steps

### Step 1 — Add `FAIL_ROUTING_AGENT_MAP` to `orchestrator/src/config.py`

1. After the existing `PIPELINE_AGENT_MAP` derivation block (~line 78), add a new constant `FAIL_ROUTING_AGENT_MAP` that maps each pipeline type to the agent role name responsible for FAIL rework, derived from `_pipelines["fail_routing"]` and the `_roles` list.
2. Add a brief docstring explaining the constant's purpose.

### Step 2 — Add test coverage for `FAIL_ROUTING_AGENT_MAP` in `orchestrator/tests/test_config.py`

1. Add a new test class (e.g., `TestFailRoutingAgentMap`) in the existing test file.
2. Assert all pipeline types in `PIPELINE_TYPES` are present as keys.
3. Assert all values are non-orchestrating role names (present in `PIPELINE_ROLE_NAMES`).
4. Optionally spot-check the `release-engineering → Release Engineer` mapping specifically, as this was the original bug surface area.

### Step 3 — Refactor `_derive_next_action` to use manifest-derived routing

1. Import `FAIL_ROUTING_AGENT_MAP` from `orchestrator.src.config`.
2. Replace the 6 hard-coded `elif <pipeline> == "FAIL"` agent-name assignments with a lookup: when a pipeline's latest status is `"FAIL"`, set `next_role = FAIL_ROUTING_AGENT_MAP[pipeline_type]` and `action = "REWORK"`.
3. Simplify the helper's docstring: remove the "drift risk" warning about FAIL-routing targets since it's now programmatic. Keep the warning about action vocabulary drift.
4. Ensure all existing tests in `test_supervisor.py` continue to pass unchanged.

### Step 4 — Clarify `_DISPATCH_ACTIONS` comment in `supervisor.py`

1. Move `"REWORK"` from the `# Developer` group to a dedicated comment group.
2. Add a comment such as `# Multi-role (routed by fail_routing in workflow manifest)`.

### Step 5 — Create CI workflow `.github/workflows/ci.yml`

1. Create a new GitHub Actions workflow triggered on `push` and `pull_request`.
2. Define a job matrix with the following checks:
   - **MCP Server tests:** Node.js 20, `npm ci && npm test` in `mcp-server/`
   - **Orchestrator tests:** Python 3.11+, `pip install -e '.[dev]' && pytest` in `orchestrator/`
   - **Ruff check:** `ruff check src/` in `orchestrator/`
   - **Manifest validation:** `node scripts/validate-workflow-manifest.js` at workspace root
   - **Persona build check:** `node scripts/build-personas.js --check` at workspace root (requires `cd personas && npm ci` first)
3. Keep the workflow minimal — no deployment, no artifact publishing (that's the existing release workflow's job).

### Step 6 — Update documentation

1. Add a "CI" or "Continuous Integration" section to the root `README.md` explaining the gates.
2. Update `orchestrator/README.md` testing section to note CI enforcement.
3. Update `mcp-server/docs/agents/project-manifest/constraints.md` if relevant (CI gate is a new constraint).

## Dependencies

- Step 2 depends on Step 1 (needs the new constant).
- Step 3 depends on Step 1 (imports the constant).
- Steps 4 and 5 are independent of all other steps.
- Step 6 depends on Step 5 (documents the CI workflow).

## Required Components

- `orchestrator/src/config.py` — add `FAIL_ROUTING_AGENT_MAP` constant
- `orchestrator/tests/test_config.py` — add test class for new constant
- `orchestrator/tests/test_supervisor.py` — refactor `_derive_next_action` helper
- `orchestrator/src/supervisor.py` — update `_DISPATCH_ACTIONS` comment
- `.github/workflows/ci.yml` — new CI workflow file
- `README.md` — add CI section
- `orchestrator/README.md` — update testing section

## Assumptions

- The `fail_routing` key in `shared/workflow-manifest.json` always contains all 6 pipeline types as keys with valid role IDs as values. This is guaranteed by the existing JSON Schema and validation script.
- The CI runner has access to both Node.js 20 and Python 3.11+ (standard GitHub-hosted runners provide this).
- The MCP server tests do not require a running server or external services (they use Vitest with mocked I/O).

## Constraints

- Do not change any test behavior — all existing tests must continue to pass with identical semantics.
- The refactored `_derive_next_action` must produce identical output for all inputs; this is a structural refactor, not a behavioral change.
- CI workflow must not publish artifacts, push code, or create releases (only gate).

## Out of Scope

- Migrating the orchestrator's production `supervisor.py` to use `FAIL_ROUTING_AGENT_MAP` for its own routing — the production code uses the MCP server's `ledger_get_next_action` tool, which already handles FAIL routing correctly server-side.
- Adding `pre-commit` hooks for ruff (the orchestrator README already documents manual usage).
- Refactoring `_derive_next_action` beyond FAIL routing (the `IMPLEMENT`/`RUN_QA`/etc. happy-path branches are already structurally clear).

## Acceptance Criteria

- `FAIL_ROUTING_AGENT_MAP` exists in `config.py` and is fully manifest-derived.
- `test_config.py` has structural tests for the new constant.
- `_derive_next_action` no longer hard-codes any agent names in FAIL branches; all FAIL routing comes from `FAIL_ROUTING_AGENT_MAP`.
- All 251+ orchestrator tests pass.
- All 1,472+ MCP server tests pass.
- `_DISPATCH_ACTIONS` comment correctly reflects that `REWORK` is multi-role.
- `.github/workflows/ci.yml` exists and defines gates for MCP server tests, orchestrator tests, ruff, manifest validation, and persona build check.
- `ruff check orchestrator/src/` exits 0.

## Testing Strategy

- **Unit tests for `FAIL_ROUTING_AGENT_MAP`:** Structural assertions in `test_config.py` — key completeness, value validity, spot-check for known mapping.
- **Regression for `_derive_next_action`:** Run the full `test_supervisor.py` suite; the refactor must be behavior-preserving since the manifest values match the previously hard-coded values exactly.
- **CI workflow:** Validate by triggering it on a branch push and confirming all jobs pass.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`FAIL_ROUTING_AGENT_MAP` lookup fails at import** if manifest structure changes | The constant derivation uses the same `_pipelines` and `_roles` already validated by manifest loading. Add a `StopIteration` guard with a descriptive error. |
| **CI workflow flakes** on first run due to dependency caching | Use `actions/cache` for `node_modules` and pip cache to stabilize cold starts. |
| **Refactored `_derive_next_action` changes behavior** | The refactor is purely structural — same inputs → same outputs. The existing 21 `TestDirectActionRouting` parametrized cases serve as a regression net. |
