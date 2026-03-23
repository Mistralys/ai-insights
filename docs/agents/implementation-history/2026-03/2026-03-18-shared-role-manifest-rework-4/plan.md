# Plan

## Summary

Close out all remaining actionable items from the [rework-3 synthesis](../2026-03-18-shared-role-manifest-rework-3/synthesis.md). Three items require code changes: (1) replace hard-coded PASS-branch role name strings in `_derive_next_action` with manifest-derived `PIPELINE_AGENT_MAP` lookups, completing the drift-proofing work started in rework-3; (2) fix the CI `mcp-server-tests` cache to include `personas/package-lock.json`; (3) pin GitHub Actions to SHA digests for supply-chain hardening. Synthesis recommendation #4 (`FAIL_ROUTING_AGENT_MAP` snapshot tests) is already implemented — no work needed.

## Architectural Context

### Manifest-derived constants in `orchestrator/src/config.py`

All pipeline routing constants are derived from `shared/workflow-manifest.json`:

- `PIPELINE_AGENT_MAP` — maps pipeline type → owning agent role name (e.g., `"qa"` → `"QA"`, `"security-audit"` → `"Security Auditor"`)
- `FAIL_ROUTING_AGENT_MAP` — maps pipeline type → FAIL-rework agent role name
- `PIPELINE_TYPES` — canonical pipeline order tuple
- `ROLE_IDS`, `PIPELINE_ROLE_NAMES`, etc.

### `_derive_next_action` test helper in `test_supervisor.py`

This helper simulates MCP server routing logic for test mocks. FAIL-branch routing was converted to use `FAIL_ROUTING_AGENT_MAP` in rework-3, but 12 PASS-branch and IN_PROGRESS-branch role name strings remain hard-coded:

| Hard-coded string | Pipeline type | Occurrences (line references) |
|---|---|---|
| `"Developer"` | `implementation` | 2 (None + IN_PROGRESS) |
| `"QA"` | `qa` | 2 (PASS + IN_PROGRESS) |
| `"Security Auditor"` | `security-audit` | 2 (PASS + IN_PROGRESS) |
| `"Reviewer"` | `code-review` | 2 (PASS + IN_PROGRESS) |
| `"Release Engineer"` | `release-engineering` | 2 (PASS + IN_PROGRESS) |
| `"Documentation"` | `documentation` | 2 (PASS + IN_PROGRESS) |

All 12 are directly derivable from `PIPELINE_AGENT_MAP[pipeline_type]`.

### CI cache configuration in `.github/workflows/ci.yml`

The `mcp-server-tests` job installs persona dependencies (`cd personas && npm ci`) because the MCP server's `pretest` hook depends on them. However, its `cache-dependency-path` only watches `mcp-server/package-lock.json`. A change to `personas/package-lock.json` alone would not bust the cache, potentially causing stale `node_modules` in CI.

## Approach / Architecture

1. **PASS-branch drift-proofing** — Import `PIPELINE_AGENT_MAP` into `test_supervisor.py` and replace all 12 hard-coded role strings with `PIPELINE_AGENT_MAP[<pipeline-type>]` lookups. Update the docstring to reflect that both PASS and FAIL routing are now manifest-derived.

2. **CI cache fix** — Convert the `cache-dependency-path` scalar to a multi-line value that includes both `mcp-server/package-lock.json` and `personas/package-lock.json`.

3. **SHA pinning** — Replace `@v4`/`@v5` action version tags with full SHA digests for `actions/checkout`, `actions/setup-node`, and `actions/setup-python`. Add inline comments with the human-readable version tag for maintainability.

## Rationale

- **PASS-branch fix:** Eliminates the last set of hard-coded role names in the orchestrator test suite. When a role is renamed in the manifest, the test helper will automatically reflect the change. This was the #1 strategic recommendation from the rework-3 synthesis.
- **CI cache fix:** Prevents a subtle stale-cache failure mode where personas dependencies silently drift in CI. Single-line change with zero risk.
- **SHA pinning:** Mitigates GitHub Actions supply-chain risk (tag hijacking). Low priority but straightforward now that the CI file exists.

## Detailed Steps

### Step 1: Replace PASS-branch hard-coded role names

**File:** `orchestrator/tests/test_supervisor.py`

1. Add `PIPELINE_AGENT_MAP` to the existing `from src.config import` statement (line 17).
2. Replace all 12 hard-coded role name strings in `_derive_next_action` with `PIPELINE_AGENT_MAP` lookups:
   - `"Developer"` → `PIPELINE_AGENT_MAP["implementation"]`
   - `"QA"` → `PIPELINE_AGENT_MAP["qa"]`
   - `"Security Auditor"` → `PIPELINE_AGENT_MAP["security-audit"]`
   - `"Reviewer"` → `PIPELINE_AGENT_MAP["code-review"]`
   - `"Release Engineer"` → `PIPELINE_AGENT_MAP["release-engineering"]`
   - `"Documentation"` → `PIPELINE_AGENT_MAP["documentation"]`
3. Update the docstring to state that both PASS-branch and FAIL-branch routing are now manifest-derived, leaving only action vocabulary as a manual sync point.

### Step 2: Fix CI personas cache path

**File:** `.github/workflows/ci.yml`

1. In the `mcp-server-tests` job, change `cache-dependency-path` from a single value to a multi-line value:
   ```yaml
   cache-dependency-path: |
     mcp-server/package-lock.json
     personas/package-lock.json
   ```

### Step 3: Pin GitHub Actions to SHA digests

**File:** `.github/workflows/ci.yml`

1. Look up the current SHA digests for `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/setup-python@v5`.
2. Replace all `@v4`/`@v5` refs with `@<sha>` and add an inline `# v4` or `# v5` comment.

### Step 4: Run orchestrator tests

Verify all 258 tests still pass after the `_derive_next_action` refactor:
```bash
cd orchestrator && pytest
```

### Step 5: Validate CI YAML syntax

Confirm the `.github/workflows/ci.yml` file is valid YAML after the SHA + cache changes.

## Dependencies

- `shared/workflow-manifest.json` — must contain `pipelines.canonical_order` and role entries with `pipeline` and `name` fields (already present)
- `orchestrator/src/config.py` — must export `PIPELINE_AGENT_MAP` (already exported)

## Required Components

- `orchestrator/tests/test_supervisor.py` — modify import + `_derive_next_action` body + docstring
- `.github/workflows/ci.yml` — modify cache path + action version refs

## Assumptions

- `PIPELINE_AGENT_MAP` correctly maps all 6 pipeline types to their owning role names (verified by existing `TestPipelineTypes` and `TestRoleIDs` snapshot tests)
- The 258 existing orchestrator tests provide sufficient coverage to catch any regression from the `_derive_next_action` refactor
- Synthesis recommendation #4 (`FAIL_ROUTING_AGENT_MAP` snapshot tests) is already addressed — `TestFailRoutingAgentMap` in `test_config.py` provides `test_is_dict`, `test_all_pipeline_types_are_keys`, `test_all_values_are_valid_role_names`, and two specific mapping assertions

## Constraints

- Action vocabulary strings (`"IMPLEMENT"`, `"RUN_QA"`, `"REWORK"`, etc.) remain hard-coded — these are not part of the manifest and derive from MCP server constants. This is an accepted sync point.
- The `"Project Manager"` role name in the `REPAIR_ORPHAN_BLOCKED` branch is not pipeline-owned and cannot be derived from `PIPELINE_AGENT_MAP`. It remains hard-coded.

## Out of Scope

- Deriving action vocabulary from the manifest (would require adding actions to `workflow-manifest.json`)
- Adding `PIPELINE_AGENT_MAP` snapshot tests to `test_config.py` (already covered transitively via `TestPipelineTypes` + `TestRoleIDs`)
- First PR run of CI — manual verification step after merge

## Acceptance Criteria

- All 12 hard-coded PASS/IN_PROGRESS role name strings in `_derive_next_action` are replaced with `PIPELINE_AGENT_MAP` lookups
- The `_derive_next_action` docstring reflects that only action vocabulary remains as a manual sync point
- The `mcp-server-tests` CI job caches against both `mcp-server/package-lock.json` and `personas/package-lock.json`
- All GitHub Actions refs use SHA digests with human-readable version comments
- All 258 orchestrator tests pass
- `.github/workflows/ci.yml` is valid YAML

## Testing Strategy

Run the full orchestrator test suite (`pytest`) to verify the `_derive_next_action` refactor. The existing 258 tests exercise all routing branches in the helper, providing comprehensive regression coverage. No new tests are needed — this is a pure refactor of existing test infrastructure.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`PIPELINE_AGENT_MAP` key mismatch** — a pipeline type in the routing chain doesn't have a matching key in the map | The map is derived from the same manifest that defines `canonical_order`; mismatch is structurally impossible. Covered by `TestPipelineTypes` snapshot tests. |
| **SHA digests become stale** — pinned commits may miss security patches in Actions | Each pin includes a `# v4`/`# v5` comment for easy lookup. Dependabot or manual review can update SHAs periodically. |
| **CI YAML syntax error** — multi-line value or SHA format breaks the workflow | Validate YAML syntax before merge; the `persona-build-check` and `manifest-validation` jobs will exercise the workflow on the first PR. |
