# Plan

## Summary

This follow-up plan addresses the 10 non-blocking items identified in the synthesis document for the "Orchestrator Progress Reporting & Duration Tracking" project (completed 2026-03-23), plus a persona build system bug discovered during plan creation. The items span five categories: a build system bug that grants all ledger personas MCP server access regardless of their `has_mcp` flag, a missing dev dependency declaration that blocks new developers from running the full test suite, medium-priority test coverage gaps in the orchestrator, low-priority code clean-up in the orchestrator and GUI, and two pre-existing schema/documentation precision issues. The work is well-defined, scoped tightly, and requires no architectural changes.

## Architectural Context

**Orchestrator** (`orchestrator/`) — Python 3.11+, LangGraph + Deep Agents, pytest + pytest-asyncio. Key files:
- `orchestrator/pyproject.toml` — project metadata and dependency declarations; the `[dev]` extras group currently declares `pytest>=8.0`, `pytest-asyncio>=0.24`, and `ruff>=0.8` but omits `aiosqlite` and `langgraph-checkpoint-sqlite`
- `orchestrator/src/cli.py` — CLI entry point; `_make_dryrun_node()` contains a redundant local `from datetime import datetime` at line 200 (the module-level import at line 36 already imports it)
- `orchestrator/src/nodes/__init__.py` — `create_stage_node` factory; `state.get('current_wp_id', '')` is called 5 times inside `node_fn`: in `start_entry`, the `stage_complete` log entry, the standalone `wp_id` assignment for pipeline read-back, the `stage_error` log entry, and the `errors` list (both in the `except` block)
- `orchestrator/src/utils/mcp_parse.py` — `parse_tool_response()` helper; currently covered only via integration tests, not by dedicated unit tests
- `orchestrator/src/supervisor.py` — supervisor routing logic; elapsed-time computation wraps `datetime.fromisoformat(run_start_ts)` in `try/except (ValueError, TypeError)`
- `orchestrator/tests/test_supervisor.py` — `TestEnrichedRouteEvents` covers only the `prev_result='PASS'` path through the `route` event logic; the FAIL branch is not tested
- `orchestrator/tests/test_nodes.py` — `pipeline_result` read-back tests exist but the `if pipelines:` guard (empty-list path) is not covered

**MCP Server** (`mcp-server/`) — TypeScript 5.7.2 (ESM), Node.js, Vitest. Key files:
- `mcp-server/src/schema/work-package.ts` — `PipelineSchema` has `duration_ms: z.number().optional()` at line 81; `ReworkCountsSchema` (lines 104–109) uses `z.number().int().nonnegative()` as the established precision pattern
- `mcp-server/gui/public/styles.css` — CSS stylesheet for the GUI; no `.wp-timing` or equivalent rule exists yet
- `mcp-server/gui/public/views/work-package.js` — renders the `wp-timing` div; currently unstyled inline

**Personas build system** (`personas/`, `scripts/`) — JavaScript (CJS), Node.js. Key files:
- `scripts/build-personas.js` — template engine; `FRONTMATTER_LEDGER_CC` (lines 275-286) unconditionally injects `mcpServers: - {{mcp_server_name}}` into all ledger Claude Code persona output
- `scripts/lib/persona-helpers.js` — `resolveConditionals()` (line 102) provides `{{#if flag}}…{{/if}}` conditional blocks, already used in `FRONTMATTER_STANDALONE_CC` for the same `mcpServers` pattern
- `personas/ledger/src/meta/_shared.yaml` — shared metadata including `mcp_server_name: central_pm`
- `personas/ledger/src/meta/1-planner.yaml` — declares `has_mcp: false` (line 19), but this flag is never read by the build script
- Every ledger persona YAML declares `has_mcp: true|false`, but the build system ignores the flag entirely; the `has_mcp` value is already available in the template context via the `...persona` spread in `buildPersona()` (line ~490)

## Approach / Architecture

The 10 items plus the build system bug are grouped into 5 work packages prioritized by developer impact:

**WP-001 — Dev dependency declaration** (highest priority): Adds `aiosqlite` to the `pyproject.toml` `[dev]` extras group. `langgraph-checkpoint-sqlite` is already listed as a runtime dependency (line 8) and `pytest-asyncio` is already in dev extras (line 24). The README note at line 363 documents the workaround and should be cleaned up once the fix is in place.

**WP-002 — Test coverage gaps** (medium priority): Adds targeted tests for 4 uncovered paths:
1. `parse_tool_response` — parametrized unit tests for all 4 branches in `orchestrator/tests/test_mcp_parse.py` (new file)
2. Route event FAIL branch — additional test in `TestEnrichedRouteEvents` in `test_supervisor.py`
3. Malformed `run_start_ts` — test for the `try/except` guard in `supervisor.py`'s elapsed-time computation
4. Empty `pipelines` list in `pipeline_result` read-back — test in `test_nodes.py`

**WP-003 — Orchestrator code clean-up** (low priority): Two small refactors in orchestrator Python source:
1. Remove the redundant `from datetime import datetime` local import in `cli.py`'s `_make_dryrun_node()`
2. Capture `state.get('current_wp_id', '')` once as `_wp_id` at the top of `node_fn` in `nodes/__init__.py` and replace the 4 call sites, eliminating the associated `# type: ignore` comments

**WP-004 — GUI styling and schema precision** (low priority): Two small fixes:
1. Add a `.wp-timing` CSS rule to `mcp-server/gui/public/styles.css` matching the card-block aesthetic (margin, font-size, color token — consistent with existing `.badge-neutral` style)
2. Tighten `duration_ms` schema from `z.number().optional()` to `z.number().int().nonnegative().optional()` in `mcp-server/src/schema/work-package.ts`, matching the `ReworkCountsSchema` pattern

**WP-005 — Persona build: respect `has_mcp` flag** (high priority): The `FRONTMATTER_LEDGER_CC` template in `scripts/build-personas.js` unconditionally injects `mcpServers: - {{mcp_server_name}}` into every ledger Claude Code persona. The per-persona YAML metadata declares `has_mcp: true|false` but the build script never reads this flag. This means all 9 ledger personas receive MCP server access regardless of intent — violating the principle of least privilege for roles like the Planner that should not have ledger write access. The fix:
1. Make the `mcpServers` block in `FRONTMATTER_LEDGER_CC` conditional on the persona's `has_mcp` flag
2. Rebuild all personas and verify the planner (and any other `has_mcp: false` personas) no longer include `mcpServers` in their generated output
3. Verify `has_mcp: true` personas still include the block

WP-005 is independent of all other WPs. WP-003 and WP-004 are independent and can be worked in parallel. WP-002 depends on no other WP. WP-001 must complete first, as the test suite cannot run reliably without the dependency fix.

## Rationale

- Dev dependency is the top priority because it directly prevents new developers from running the test suite and produces confusing silent failures.
- Coverage gaps are medium priority because the code is correct but unprotected — regressions in `parse_tool_response` or the FAIL routing branch would be invisible until caught by a live run.
- Code clean-up and GUI/schema polish are low priority: they improve maintainability and precision but carry no functional risk.
- Grouping the 4 coverage tests into one WP keeps the test work cohesive. Splitting them would create 4 trivially small packages.
- Separating orchestrator clean-up (WP-003) from GUI/schema work (WP-004) respects the sub-project boundary — different tech stacks, different test commands.

## Detailed Steps

1. **WP-001 — Dev dependency declaration**
   - Open `orchestrator/pyproject.toml`
   - Add `aiosqlite>=2.0` to the `[dev]` extras group (after `pytest-asyncio`)
   - Verify `langgraph-checkpoint-sqlite` is already present in runtime deps (confirmed at line 8)
   - Remove the `requirements-dev.txt` workaround note from `orchestrator/README.md` (lines 363-365) and replace with the standard install instruction referencing the `[dev]` extras group

2. **WP-002 — Test coverage gaps**
   - Create `orchestrator/tests/test_mcp_parse.py` with `@pytest.mark.parametrize` covering:
     - `list` input with a `{"type": "text", "text": "<json>"}` block → parsed dict
     - `list` input with no parseable text block → raw list returned
     - JSON string input → parsed dict
     - Non-JSON string input → raw string returned
     - `ToolMessage`-like object (with `.content`) → unwrapped and parsed
     - `None` input → `None` returned
     - Direct dict input → dict returned as-is
   - In `test_supervisor.py`, add `test_route_prev_result_fail_when_stage_failed` to `TestEnrichedRouteEvents` — set `stage_success=False` with a non-empty `prev_wp_id` and assert `prev_result == 'FAIL'`
   - In `test_supervisor.py`, add a test for malformed `run_start_ts` — inject `run_start_ts='not-a-date'` into the state and assert the resulting `progress_snapshot` entry has `elapsed_s` equal to `None`
   - In `test_nodes.py`, add a test that stubs `ledger_get_work_package` to return an empty `pipelines` list and asserts no `pipeline_result` entry appears in `run_log`

3. **WP-003 — Orchestrator code clean-up**
   - In `orchestrator/src/cli.py`, remove the local `from datetime import datetime` inside `_make_dryrun_node()` (line 200) — the module-level import at line 36 already provides it
   - In `orchestrator/src/nodes/__init__.py`, inside `node_fn` in `create_stage_node`, add `_wp_id: str = state.get('current_wp_id', '')  # type: ignore[call-overload]` at the top of the function body (before the `try` block); replace all 5 existing `state.get('current_wp_id', '')` call sites (including the one in the `errors` list in the `except` block) with `_wp_id`

4. **WP-004 — GUI styling and schema precision**
   - In `mcp-server/gui/public/styles.css`, add a `.wp-timing` block after the `.badge` section — use `margin-top`, `font-size`, and a `color` token (e.g. `var(--color-text-muted)`) consistent with existing card metadata blocks
   - In `mcp-server/src/schema/work-package.ts`, change `duration_ms: z.number().optional()` to `z.number().int().nonnegative().optional()` on line 81
   - Run `npm test` in `mcp-server/` to confirm no regressions

5. **WP-005 — Persona build: respect `has_mcp` flag**
   - In `scripts/build-personas.js`, modify `FRONTMATTER_LEDGER_CC` (lines 275-286) to wrap the `mcpServers` block in `{{#if has_mcp}}…{{/if}}`, matching the existing pattern in `FRONTMATTER_STANDALONE_CC`. The `resolveConditionals()` engine in `scripts/lib/persona-helpers.js` already handles this syntax, and the `has_mcp` flag is already available in the template context via the `...persona` spread — no additional plumbing required
   - Run `node scripts/build-personas.js` and verify:
     - `personas/ledger/claude-code/1-planner.md` does NOT contain `mcpServers`
     - `personas/ledger/claude-code/2-project-manager.md` (and other `has_mcp: true` personas) still contains `mcpServers: - central_pm`
   - Run `node scripts/build-personas.js --check` to confirm no stale output

## Dependencies

- WP-001 has no dependencies
- WP-002 has no dependencies (but practically, running the new tests requires WP-001 to already be applied in the dev environment)
- WP-003 has no dependencies
- WP-004 has no dependencies; WP-003 and WP-004 can proceed in parallel
- WP-005 has no dependencies; can proceed in parallel with any other WP

## Required Components

**WP-001**
- `orchestrator/pyproject.toml` (modify)
- `orchestrator/README.md` (modify)

**WP-002**
- `orchestrator/tests/test_mcp_parse.py` (new file)
- `orchestrator/tests/test_supervisor.py` (modify — add tests to `TestEnrichedRouteEvents` and a new class for `run_start_ts` guard)
- `orchestrator/tests/test_nodes.py` (modify — add empty-pipelines test)

**WP-003**
- `orchestrator/src/cli.py` (modify)
- `orchestrator/src/nodes/__init__.py` (modify)

**WP-004**
- `mcp-server/gui/public/styles.css` (modify)
- `mcp-server/src/schema/work-package.ts` (modify)

**WP-005**
- `scripts/build-personas.js` (modify)
- `personas/ledger/claude-code/1-planner.md` (regenerated — no manual edit)
- All other `personas/ledger/claude-code/*.md` files (regenerated)

## Assumptions

- `langgraph-checkpoint-sqlite` remains in runtime deps and does not need to be duplicated in dev extras
- `pytest-asyncio` is already in `[dev]` extras — only `aiosqlite` needs to be added
- The GUI stylesheet (`styles.css`) is the correct location for the `.wp-timing` rule; there are no component-scoped CSS files in this project
- `z.number().int().nonnegative()` tightening on `duration_ms` is backward compatible because all stored values are already non-negative integers; the schema change only rejects values that would be incorrect anyway
- The `has_mcp` flag is already present and correctly set in all 9 ledger persona YAML files — no metadata changes needed, only the template needs updating
- Only the planner currently has `has_mcp: false`; all other 8 personas have `has_mcp: true` (verified against codebase)
- The `has_mcp` value is already available in the template rendering context via the `...persona` spread — no need to explicitly pass it

## Constraints

- No new dependencies beyond `aiosqlite` in dev extras
- All orchestrator test changes must keep the full pytest suite green (374+ tests passing)
- All MCP server changes must keep the full Vitest suite green (1481+ tests passing)
- No changes to existing event shapes or API contracts
- GUI changes must not break backward compatibility (duration display is already guarded by `if (p.duration_ms != null)`)

## Out of Scope

- `pipeline_result.duration_s` being `null` until a live end-to-end run — this is a runtime observation noted in the synthesis, not something addressable with a code change
- Any new features or event types beyond those already shipped in the prior project
- Orchestrator manifest updates (the api-surface.md added in WP-010 of the prior project is complete and accurate)

## Acceptance Criteria

**WP-001**
- `orchestrator/pyproject.toml` `[dev]` extras include `aiosqlite`
- `pip install -e ".[dev]"` is sufficient to run the full async test suite without manual extras
- `orchestrator/README.md` workaround note updated to reference `pip install -e ".[dev]"`

**WP-002**
- `orchestrator/tests/test_mcp_parse.py` exists with at least 7 parametrized test cases covering all 4 parsing branches plus `None`, direct dict, and `ToolMessage`
- `test_supervisor.py` includes a test for `prev_result='FAIL'` in `TestEnrichedRouteEvents`
- `test_supervisor.py` includes a test asserting `elapsed_s=None` when `run_start_ts` is malformed
- `test_nodes.py` includes a test asserting no `pipeline_result` entry when `pipelines` list is empty
- All 374+ existing orchestrator tests still pass alongside the new ones

**WP-003**
- The local `from datetime import datetime` import inside `_make_dryrun_node()` is removed from `cli.py`
- `state.get('current_wp_id', '')` appears exactly once in `node_fn` (as `_wp_id` assignment); all 5 former call sites use `_wp_id` instead
- The 4 `# type: ignore[call-overload]` comments on the replaced `state.get` calls are removed (the new `_wp_id` assignment retains its own `# type: ignore`)
- All orchestrator tests still pass

**WP-004**
- A `.wp-timing` CSS rule exists in `styles.css` and visually matches the card aesthetics (not rendered inline)
- `PipelineSchema.duration_ms` uses `z.number().int().nonnegative().optional()`
- All 1481+ MCP server Vitest tests still pass

**WP-005**
- `scripts/build-personas.js` reads the `has_mcp` flag from the template context (already available via `...persona` spread)
- `FRONTMATTER_LEDGER_CC` wraps `mcpServers` in `{{#if has_mcp}}…{{/if}}`
- Generated output for `has_mcp: false` personas (e.g. `1-planner.md`) does NOT contain `mcpServers` in frontmatter
- Generated output for `has_mcp: true` personas still contains `mcpServers: - central_pm`
- `node scripts/build-personas.js --check` reports no stale output after rebuild

## Testing Strategy

All changes are tested by the existing test suites with targeted additions:

- **WP-001:** Manual verification — `pip install -e ".[dev]"` into a clean venv, then `pytest` runs green
- **WP-002:** `pytest orchestrator/tests/` — new tests and existing suite must all pass
- **WP-003:** `pytest orchestrator/tests/` — regression check only (no new tests, clean-up is non-behavioral)
- **WP-004:** `npm test` in `mcp-server/` — the schema tightening test coverage is already provided by the existing `work-package-schema.test.ts` tests plus the new `z.number().int().nonnegative()` constraint which will reject previously-invalid inputs; GUI styling is verified visually
- **WP-005:** `node scripts/build-personas.js --check` after rebuild — verify generated output matches expectations; manually inspect `1-planner.md` frontmatter to confirm `mcpServers` is absent

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`z.number().int().nonnegative()` rejects existing stored data** | All stored `duration_ms` values are computed from `Date.now()` arithmetic — they are always non-negative integers. The tightening only prevents invalid inputs; no migration is needed. |
| **`aiosqlite` version pin causes resolution conflicts** | Specify `aiosqlite>=2.0` (the same loose bound style used for other deps) and rely on pip's resolver. If conflict arises, the exact version in use can be pinned. |
| **CSS `.wp-timing` rule conflicts with existing layout** | The rule should use `display: block` + `margin-top` only, following the pattern of other metadata blocks. The change is additive and scoped to a new class name. |
| **Removing the `# type: ignore` comments triggers type errors** | Review the actual mypy/pyright errors before removing; if the ignore is still needed for a different reason, update the comment to be more specific rather than removing it. |
| **`has_mcp` conditional breaks frontmatter YAML syntax** | The `{{#if has_mcp}}…{{/if}}` pattern is already proven in `FRONTMATTER_STANDALONE_CC` for the same `mcpServers` block. Verify by running `build-personas.js` and parsing the output frontmatter. |
