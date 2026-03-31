# Plan

## Summary

Enable agent shell subprocesses in the orchestrator to access host CLI tools (`python`, `php`, `npm`, `git`, etc.) by passing `inherit_env=True` to the `LocalShellBackend` constructor. The current default (`inherit_env=False`) starts agent shells with an empty environment, stripping `$PATH` and preventing agents from running any host commands. This is a single-line production change plus corresponding test updates.

## Architectural Context

The orchestrator's pipeline stages are implemented in `orchestrator/src/nodes/__init__.py`. The generic factory `create_stage_node()` creates a `LocalShellBackend` instance per invocation (Constraint 7 — Stage Node Isolation) and passes it to `create_deep_agent()`.

The relevant line is in `orchestrator/src/nodes/__init__.py` line 201:

```python
backend = LocalShellBackend(root_dir=target_path or None)
```

The `deepagents` library's `LocalShellBackend` (at `deepagents/backends/local_shell.py`) accepts:
- `inherit_env: bool = False` — when `True`, copies `os.environ` into the subprocess environment.
- `env: dict[str, str] | None = None` — explicit environment overrides, merged on top of inherited env when both are provided.

The constructor stores environment as `self._env` and passes it to `subprocess.run` calls in `execute()`.

Existing tests in `orchestrator/tests/test_nodes.py` patch `deepagents.backends.LocalShellBackend` with `MagicMock()`, so they do not currently assert constructor arguments.

The orchestrator's architecture docs (`orchestrator/docs/architecture.md`) describe step 5 as using `LocalShellBackend(root_dir=target_project_path)`.

## Approach / Architecture

Pass `inherit_env=True` as a keyword argument to the `LocalShellBackend` constructor. This is the minimal change that immediately restores full host CLI access. The research paper recommended Pattern 2 (curated env) as the ideal long-term approach, but the user has explicitly requested Pattern 1.

No new modules, classes, or configuration parameters are needed.

## Rationale

- **Problem root cause:** `LocalShellBackend` defaults to `inherit_env=False`, starting agent subprocesses with an empty environment. This means `$PATH`, `$HOME`, and all tool-chain variables are stripped, making `python`, `php`, `npm`, `git`, etc. unreachable.
- **Why Pattern 1:** It's a single-line change with zero risk of cascading tool failures (unlike Pattern 2's curated allowlist, which can miss tool-specific variables). Since agents run locally on developer machines — not shared production infrastructure — inheriting the full environment matches developer expectations.
- **Trade-off:** All host environment variables (including any secrets like `AWS_ACCESS_KEY_ID`) become visible to the agent subprocess. This is acceptable for local development but should be revisited if the orchestrator is deployed in CI or production environments.

## Detailed Steps

1. **Modify `LocalShellBackend` instantiation** in `orchestrator/src/nodes/__init__.py` (line 201):
   - Change `backend = LocalShellBackend(root_dir=target_path or None)` to `backend = LocalShellBackend(root_dir=target_path or None, inherit_env=True)`.

2. **Add a unit test** in `orchestrator/tests/test_nodes.py` that asserts `LocalShellBackend` is called with `inherit_env=True`:
   - In the existing `_patch_deep_agent` helper, the `LocalShellBackend` is patched as a `MagicMock()`. Tests should add an assertion verifying `LocalShellBackend` was called with `inherit_env=True` on the mock's call args.
   - Add a focused test (e.g., `test_stage_node_passes_inherit_env_true`) that invokes a stage node through the standard `create_stage_node` factory and asserts the constructor keyword argument.

3. **Update architecture documentation** in `orchestrator/docs/architecture.md`:
   - Change the step 5 description from `LocalShellBackend(root_dir=target_project_path)` to `LocalShellBackend(root_dir=target_project_path, inherit_env=True)`.

4. **Update the CTX-generated documentation** reference in `.context/orchestrator/documentation.md` (same wording change as step 3). This file is auto-generated, so the actual fix is regenerating `.context/` — but flagging it ensures the next CTX run picks up the new architecture doc text.

5. **Add an inline security-decision comment** at the `LocalShellBackend` call site in `orchestrator/src/nodes/__init__.py`:
   - Document *why* `inherit_env=True` was chosen (unblocks host CLI access), the known trade-off (all host env vars — including potential secrets — are exposed to agent subprocesses), and point to the deferred-topics document for the planned hardening.
   - Example:
     ```python
     # SECURITY DECISION (2026-03-30): inherit_env=True exposes all host
     # environment variables to agent subprocesses. Acceptable for local
     # development; curated-env hardening is tracked in
     # docs/agents/deferred-topics.md § Orchestrator.
     backend = LocalShellBackend(root_dir=target_path or None, inherit_env=True)
     ```

6. **Create `docs/agents/deferred-topics.md`** — a workspace-wide living document for implementation decisions that were deliberately deferred, organized by sub-project:
   - Structure the document with a top-level heading, a short intro explaining the document's purpose, and then H2 sections per sub-project (e.g., `## Orchestrator`, `## MCP Server`, `## Personas`).
   - Under the `## Orchestrator` section, add the first entry: *"Curated environment injection (Pattern 2)"* — switch from `inherit_env=True` to a curated allowlist of safe environment keys (`PATH`, `HOME`, `USER`, `LANG`, `VIRTUAL_ENV`, `NVM_DIR`, `PYENV_ROOT`) to prevent leaking host secrets to agent subprocesses. Reference the research paper at `docs/agents/research/2026-03-30-orchestrator-cli-access.md` and mark trigger condition as "before any CI / shared-infrastructure deployment".
   - Use a structured format per entry: **Topic**, **Current State**, **Target State**, **Trigger / Timeline**, **Reference**, so the document is scannable and actionable.
   - Leave `## MCP Server` and `## Personas` sections empty with a placeholder note ("No deferred topics.") so the structure is ready for future use.

7. **Run existing test suite** to confirm no regressions:
   - `cd orchestrator && python3 -m pytest tests/test_nodes.py -v`

## Dependencies

- `deepagents` library (already installed) — provides the `inherit_env` parameter on `LocalShellBackend.__init__`.
- No new dependencies required.

## Required Components

- `orchestrator/src/nodes/__init__.py` — production change (1 line) + inline security-decision comment
- `orchestrator/tests/test_nodes.py` — new test + optional assertions on existing tests
- `orchestrator/docs/architecture.md` — documentation update
- **NEW** `docs/agents/deferred-topics.md` — workspace-wide living document tracking deliberately deferred implementation decisions, organized by sub-project

## Assumptions

- The installed `deepagents` version supports the `inherit_env` parameter on `LocalShellBackend`. Confirmed: the vendored source at `orchestrator/.venv/lib/python3.14/site-packages/deepagents/backends/local_shell.py` line 112 shows `inherit_env: bool = False`.
- Agent subprocesses are expected to have full host CLI tool access (this is the user's stated intent).
- The orchestrator runs exclusively on local developer machines, not shared infrastructure where environment leakage would be a security concern.

## Constraints

- **Cross-platform:** The change uses `os.environ` which works identically on macOS, Linux, and Windows. No platform-specific code needed.
- **Constraint 7 (Stage Node Isolation):** Preserved — each `node_fn` invocation still creates its own `LocalShellBackend` instance. `inherit_env=True` copies `os.environ` at construction time, not sharing state between invocations.
- **No new dependencies:** Constraint from orchestrator `tech-stack.md` — no new packages added.

## Out of Scope

- Pattern 2 (curated environment allowlist) — may be revisited later as a security hardening measure.
- Pattern 3 (Docker containerization) — significant architectural redesign, not needed for local development.
- Configuration flag to toggle `inherit_env` on/off — unnecessary complexity for a local-only tool; can be added later if CI deployment is planned.
- Suppressing the `virtual_mode` deprecation warning from `deepagents` — separate concern.

## Acceptance Criteria

- Agent shell subprocesses can execute `python --version`, `node --version`, `git --version`, and other host CLI commands successfully.
- `LocalShellBackend` is instantiated with `inherit_env=True` in all pipeline stage nodes.
- An inline comment at the call site documents the security decision, trade-off, and pointer to the deferred-topics document.
- `docs/agents/deferred-topics.md` exists with per-sub-project sections and a structured entry under `## Orchestrator` for the curated-env hardening (Pattern 2).
- A unit test asserts the `inherit_env=True` keyword argument is passed.
- Architecture documentation reflects the new constructor call.
- All existing tests in `test_nodes.py` pass without modification (beyond the new test).

## Testing Strategy

- **Unit test:** Add a test in `test_nodes.py` that patches `LocalShellBackend` and asserts it was called with `inherit_env=True` after invoking a stage node via `create_stage_node`.
- **Regression:** Run the full `test_nodes.py` suite to ensure no existing tests break.
- **Manual verification:** Run an orchestrator pipeline on a real project and confirm agents can execute shell commands (e.g., `python --version`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Host secrets exposed to agent subprocesses** | Acceptable for local development. Documented via inline code comment + deferred-topics entry. Curated-env hardening (Pattern 2) is tracked for implementation before any CI or shared-infrastructure deployment. |
| **Existing tests fail due to changed constructor args** | Tests mock `LocalShellBackend` entirely — they don't validate constructor args, so the change is transparent to existing tests. |
| **`deepagents` library update removes `inherit_env`** | Parameter is part of the public `__init__` signature. Pin `deepagents` version in `requirements.txt` if stability is a concern. |
