# Plan

## Summary

The orchestrator was built and tested entirely against mocked MCP and LLM dependencies. Before continuing feature development, this plan validates that the orchestrator works correctly end-to-end against a real MCP server and real LLM provider. It also patches the one known technical debt item that can cause a runtime failure on Python 3.13 (`asyncio.get_event_loop()` deprecation in `_sync_cleanup`), and folds in a small set of low-cost hardening tasks that are safest to complete while the environment is freshly set up.

---

## Architectural Context

The orchestrator lives in `orchestrator/` and consists of:

| Key Component | File | Relevance |
|---------------|------|-----------|
| MCP connectivity | `orchestrator/src/mcp_client.py` | Starts MCP subprocess over STDIO; runs `ledger_help` health check on startup |
| Configuration / env | `orchestrator/src/config.py` | `MCP_SERVER_CMD` auto-computed from `WORKSPACE_ROOT`; LLM provider auto-detected |
| CLI entry point | `orchestrator/src/cli.py` | `orchestrate <plan_path>` command |
| Known technical debt | `orchestrator/src/mcp_client.py#_sync_cleanup` | `asyncio.get_event_loop()` deprecated in Python 3.12+; raises `DeprecationWarning` or fails on 3.13 |
| Dependencies | `orchestrator/pyproject.toml`, `orchestrator/requirements.txt` | `langgraph-checkpoint-sqlite` absent; `anthropic` or `google` extra required |
| Persona files | `personas/ledger/vs-code/*.md` | Loaded by `load_persona()` at node execution time; compatibility with Deep Agents' tool-call format unverified |
| MCP server build | `mcp-server/dist/index.js` | Already built — `npm run build` is not required |
| Environment file | `orchestrator/.env` | Does not exist yet; must be created from `.env.example` |
| Virtual environment | `orchestrator/.venv` | Does not exist yet; must be created |

Known pre-conditions:
- `mcp-server/dist/index.js` **exists** — MCP server does not need to be rebuilt.
- `orchestrator/.env` **does not exist** — must be created before the first run.
- `orchestrator/.venv` **does not exist** — Python environment must be bootstrapped.
- The system is running **Python 3.13** (confirmed in `README.md`), making the `asyncio.get_event_loop()` deprecation an actual risk.

---

## Approach / Architecture

The plan is structured into three phases:

**Phase 1 — Pre-flight (environment + patch)**
Establish the Python virtual environment, install dependencies, create `.env`, and patch the `_sync_cleanup` deprecation. This is the minimum needed before any live execution.

**Phase 2 — Smoke test**
Execute `orchestrate <plan_path>` against a real ledger project with the MCP server running. Start with `--dry-run` to validate graph assembly and persona loading, then a full live run on a real (small) plan. Capture the JSONL log and evaluate routing, tool calls, and output quality.

**Phase 3 — Hardening & housekeeping**
Address any issues found in the smoke test. Add `langgraph-checkpoint-sqlite` to `requirements.txt`. Evaluate persona prompts for Deep Agents compatibility and adjust if needed. Update manifests.

---

## Rationale

- Patching `_sync_cleanup` **before** the smoke test prevents misleading errors on process exit obscuring genuine connectivity failures.
- `--dry-run` first provides a safe preliminary check of graph topology, persona file resolution, and MCP server startup **without** consuming LLM tokens.
- Persona evaluation is deferred to Phase 3 because the smoke test output will make the diagnosis concrete (rather than speculative).
- `langgraph-checkpoint-sqlite` is added as part of hardening, not as a blocker, since the basic smoke test does not require `--resume`.

---

## Detailed Steps

### Phase 1 — Pre-flight

1. **Patch `_sync_cleanup`** in `orchestrator/src/mcp_client.py`:
   - Replace the `asyncio.get_event_loop()` call with:
     ```python
     try:
         loop = asyncio.get_running_loop()
     except RuntimeError:
         loop = asyncio.new_event_loop()
     ```
   - This removes the `DeprecationWarning` on Python 3.12+ and avoids a hard failure on 3.13 when no event loop is running at `atexit` time.

2. **Create virtual environment** in `orchestrator/`:
   ```bash
   cd orchestrator
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[anthropic]"
   ```
   (Use `.[google]` if the user's API key is for Google AI Studio.)

3. **Create `.env`** from `.env.example`:
   ```bash
   cp .env.example .env
   # Set ANTHROPIC_API_KEY (or GOOGLE_API_KEY) and MODEL_NAME
   ```

4. **Verify installation** — confirm the CLI entry point resolves:
   ```bash
   orchestrate --help
   # OR
   python -m src.cli --help
   ```

### Phase 2 — Smoke Test

5. **Dry run**: validate graph topology and persona loading without LLM calls:
   ```bash
   orchestrate <plan_path> --dry-run
   ```
   Expected: exits `0`, logs `"Dry run complete"`, no errors.

6. **Live run** against a real plan:
   - Use the agreed test project (see **Agreed Test Project** section above). The PM will have already initialised its ledger and created at least one `READY` work package before this step.
   - Run with a conservative iteration cap:
     ```bash
     orchestrate docs/agents/plans/2026-02-25-orchestrator-smoke-test/plan.md --max-iterations 10
     ```
   - Observe: MCP server startup (`ledger_help` health check), supervisor routing decisions, agent node execution, ledger state updates.

7. **Evaluate output**:
   - Check the JSONL log (`orchestrator/logs/<run_id>.jsonl`) for routing correctness.
   - Verify the ledger reflects the stage transitions (via `ledger_get_handoff_status` or MCP GUI).
   - Note any tool-call format errors, persona prompt issues, or unexpected routing decisions.

### Phase 3 — Hardening & Housekeeping

8. **Fix any issues** surfaced by the smoke test (connectivity errors, schema mismatches, routing bugs, persona prompt failures).

9. **Persona prompt review**: If the smoke test reveals that Deep Agents is not correctly following persona instructions (e.g., not calling MCP tools, hallucinating tool names), adjust the persona prompts' tool-calling guidance section. The persona source files are in `personas/ledger/src/`; regenerate with `node scripts/build-personas.js`.

10. **Add `langgraph-checkpoint-sqlite`** to `orchestrator/requirements.txt` and `pyproject.toml` optional deps so `--resume` is supported without manual install:
    ```toml
    # pyproject.toml, [project.optional-dependencies]
    checkpoint = ["langgraph-checkpoint-sqlite"]
    ```

11. **Update `orchestrator/README.md`** to document `--resume` prerequisites (the optional `checkpoint` extra).

12. **Update manifests**:
    - `orchestrator/README.md` — if any configuration or usage details changed.
    - Root `AGENTS.md` → Orchestrator section — if any cross-project dependencies changed.
    - If `pyproject.toml` gained a new optional dep group, note it in the project statistics section.

---

## Dependencies

- `orchestrator/.venv` created and `pip install -e ".[anthropic]"` (or `google`) completed — required before any smoke test step.
- `mcp-server/dist/index.js` already exists — no MCP rebuild needed.
- The agreed test ledger project (`2026-02-25-orchestrator-smoke-test`) initialised by the PM before the Developer runs step 6 — see **Agreed Test Project** section.
- `personas/ledger/vs-code/*.md` generated files — already present (built by the personas sub-project).

---

## Required Components

### Modified Files
- `orchestrator/src/mcp_client.py` — patch `_sync_cleanup` (step 1)
- `orchestrator/pyproject.toml` — add `checkpoint` optional dep group (step 10)
- `orchestrator/requirements.txt` — add `langgraph-checkpoint-sqlite` (step 10)
- `orchestrator/README.md` — document `--resume` prerequisites (step 11)

### New Files
- `orchestrator/.env` — created from `.env.example` (step 3)
- `orchestrator/.venv/` — Python virtual environment (step 2)

### Conditionally Modified (if smoke test reveals issues)
- `personas/ledger/src/` — persona template source files (step 9)
- `personas/ledger/vs-code/` — regenerated output (step 9, via build script)

---

## Agreed Test Project

All agents in this workflow use the following project as the smoke test target:

| Property | Value |
|----------|-------|
| **Project name** | `2026-02-25-orchestrator-smoke-test` |
| **Plan file** | `docs/agents/plans/2026-02-25-orchestrator-smoke-test/plan.md` |
| **Ledger path (project_path)** | `docs/agents/plans/2026-02-25-orchestrator-smoke-test` |
| **Ledger storage** | `mcp-server/storage/ledger/2026-02-25-orchestrator-smoke-test/` |

This plan file IS the smoke test target — the PM agent must initialise a ledger for it (via `ledger_initialize_project`) and create at least one work package before the Developer runs the orchestrator against it. The ledger must be in a state where the supervisor has actionable work (i.e., at least one WP in `READY` status).

---

## Assumptions

- The user has a valid Anthropic or Google AI Studio API key available for the `.env` configuration.
- The PM initialises the ledger for `2026-02-25-orchestrator-smoke-test` (this plan) as part of WP-002, creating at least one `READY` work package so the supervisor has actionable work on first run.
- The persona Markdown files in `personas/ledger/vs-code/` are current (not stale) — verifiable with `node scripts/build-personas.js --check`.
- Python 3.11+ is the active interpreter when creating the virtual environment.

---

## Constraints

- Do **not** commit API keys to the repository.
- Persona source edits (step 9) must be made in `personas/ledger/src/`, never in the generated `vs-code/` or `claude-code/` output directories.
- The `_sync_cleanup` patch must keep the `except Exception: pass` outer guard — this is an `atexit` handler and must never raise.

---

## Out of Scope

- Adding a formal CI pipeline (`pytest` integration with GitHub Actions / CI provider) — tracked as a separate item.
- Formal coverage reporting with `pytest-cov` — low-effort but not a blocker; deferred.
- Migrating away from `MemorySaver` to SQLite checkpoints as the default — the `checkpoint` optional dep solves the opt-in case.
- Any new orchestrator features.

---

## Acceptance Criteria

- [ ] `_sync_cleanup` no longer triggers `DeprecationWarning` on Python 3.12+.
- [ ] `orchestrate --help` exits `0` from inside the activated venv.
- [ ] `orchestrate <plan_path> --dry-run` exits `0` with no errors.
- [ ] A live run completes at least one full supervisor → agent node → MCP update → supervisor cycle without errors.
- [ ] The JSONL log confirms the supervisor read live MCP ledger state and routed correctly.
- [ ] `langgraph-checkpoint-sqlite` is listed in `requirements.txt` and as an optional dep in `pyproject.toml`.
- [ ] `orchestrator/README.md` documents the `--resume` prerequisite.
- [ ] All 154 existing tests continue to pass after the `_sync_cleanup` patch.

---

## Testing Strategy

- **Regression**: run `pytest tests/ -m "not live"` after the `_sync_cleanup` patch (step 1) to confirm no regressions before touching the live environment.
- **Dry-run validation**: step 5 is the first live check — it exercises MCP server startup and persona loading without LLM calls.
- **Live smoke test**: step 6 is the primary integration validation. No automated assertions; Engineer evaluates the JSONL log and ledger state manually.
- **Post-fix regression**: if any Phase 3 changes are made to source files, re-run `pytest tests/ -m "not live"` to confirm 154/154 pass.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`langchain-mcp-adapters` version incompatible with installed `langgraph`** | Pin versions in `.env.example`; check `pip install` output for conflicts; refer to `pyproject.toml` extras for compatible version ranges |
| **MCP server STDIO transport fails** (Node.js path / permission issue) | Verify `WORKSPACE_ROOT` in `.env`; confirm `node` is on `$PATH`; test `node dist/index.js` manually first |
| **Persona prompts cause Deep Agents to ignore MCP tools** | Note the observed failure mode in Phase 3 diagnosis; adjust the tool-invocation guidance section of the failing persona only |
| **No live ledger project available for smoke test** | PM initialises the ledger for `2026-02-25-orchestrator-smoke-test` using `ledger_initialize_project` with `plan_file: "plan.md"` and creates one READY work package before Developer runs step 6 |
| **Live run stalls at the PM stage** (no `current_wp_id`) | `pm.py` node does not require `current_wp_id`; if it stalls, check if the plan file path is correct and the MCP server has a matching project |
| **`asyncio.get_event_loop()` patch breaks existing cleanup tests** | The `_sync_cleanup` has no dedicated unit tests (atexit path); mock-based tests are unaffected; validate with the regression run |
