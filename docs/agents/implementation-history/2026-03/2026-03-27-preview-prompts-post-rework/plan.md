# Plan — Prompt Preview Script Post-Rework

## Summary

Address all four strategic recommendations from the
`2026-03-27-orchestrator-prompt-preview-script` synthesis. Two items are
code changes (upgrade `langchain-core`, add summary count line); one is a
code-quality hardening (typed STAGES registry); one is a documentation
clarification (without-WP template guidance).

## Architectural Context

The changes touch two areas:

1. **Orchestrator Python environment** (`orchestrator/pyproject.toml`,
   `orchestrator/requirements.txt`) — dependency pins for `langchain-core`
   and its transitive Pydantic behaviour.
2. **`scripts/preview-prompts.py`** — standalone developer CLI script that
   renders stage prompt templates to `orchestrator/dist/stage-prompts/`.
   Uses a `STAGES` list-of-dicts registry and a `_BASE_VARS` dict. Imports
   only `prompt_renderer` (stdlib-only) plus the Python standard library.
3. **Stage templates** (`orchestrator/src/nodes/templates/*.md`) — six
   WP-scoped templates where almost all content is gated behind
   `{{#if wp_id}}` blocks.

## Approach / Architecture

Four independent work items, each small enough for a single WP:

| # | Recommendation | Approach |
|---|----------------|----------|
| 1 | Pydantic V1 / Python 3.14 warning | Upgrade `langchain-core` from `>=0.3.45` to `>=1.2.22` (latest) in `pyproject.toml` + `requirements.txt`; bump dependent packages (`langgraph`, `langchain-mcp-adapters`, `langchain-anthropic`) to compatible versions; run full test suite; verify warning is gone |
| 2 | STAGES registry typing | Replace `list[dict]` with a `TypedDict` (`StageEntry`) and wrap `_BASE_VARS` in `types.MappingProxyType` |
| 3 | Summary count line | Add a trailing `f"{len(all_written)} file(s) written to orchestrator/dist/stage-prompts/"` print after the `✓` lines in both default and `--stage` modes |
| 4 | Without-WP template guidance | Add a brief developer note to the `VARIABLES.md` template reference explaining that content outside `{{#if wp_id}}` blocks is the only content visible in without-WP renders |

## Rationale

- **Item 1** is the highest-priority item. The warning fires on **every**
  Python invocation in the orchestrator virtualenv, polluting `stderr` for
  `preview-prompts`, `orchestrate`, and pytest runs alike. The current pin
  (`>=0.3.45`) is from the 0.x series; the installed version is `1.2.20`
  while `1.2.22` is available. The fix is an upstream upgrade, not a local
  workaround.
- **Item 2** costs almost nothing in code but improves IDE autocompletion
  and catches future typos (e.g., `"wp_scopd": True`).
- **Item 3** is a one-line UX improvement that makes CLI output consistent
  and scannable, especially in `--stage` mode where only 1–2 `✓` lines are
  printed.
- **Item 4** is pure documentation — the existing templates are
  intentionally designed this way (confirmed: all 6 without-WP renders
  produce identical 99-byte output), but no guidance exists for future
  template authors.

## Detailed Steps

### WP-1: Upgrade `langchain-core` to resolve Pydantic V1 warning

**Current state (confirmed):**
- Python: `3.14.3`
- `langchain-core`: `1.2.20` installed, pin is `>=0.3.45`
- `pydantic`: `2.12.5` (V2 is installed; the warning comes from
  `langchain_core` internally importing `pydantic.v1`)
- Warning text:
  `UserWarning: Core Pydantic V1 functionality isn't compatible with Python 3.14 or greater.`
- Latest `langchain-core`: `1.2.22`

**Steps:**

1. Update `orchestrator/pyproject.toml`:
   - Change `langchain-core>=0.3.45` → `langchain-core>=1.2.22`
   - Verify / bump floor versions for `langgraph`, `langchain-mcp-adapters`,
     and `langchain-anthropic` to versions that are compatible with
     `langchain-core>=1.2.22` (check pip resolution)
2. Update `orchestrator/requirements.txt` to mirror the new pins.
3. Run `pip install -e '.[anthropic,dev]'` inside the orchestrator venv.
4. Verify the warning is gone:
   `python3 scripts/preview-prompts.py --list 2>&1 | grep -c UserWarning`
   → should output `0`.
5. Run the full pytest suite:
   `python3 -m pytest tests/ -v --tb=short`
6. Run a live smoke test if possible:
   `python3 scripts/preview-prompts.py` — all 14 files render cleanly.
7. Update `orchestrator/docs/agents/project-manifest/constraints.md` if any
   new version-floor constraints need documenting.

**Risk:** Breaking change in `langchain-core` 1.x vs 0.3.x — mitigated by
the fact that `1.2.20` is already installed and working; the floor-pin
change merely formalizes that reality and bumps to the latest patch.

### WP-2: Add `TypedDict` for STAGES registry + freeze `_BASE_VARS`

**File:** `scripts/preview-prompts.py`

1. Add imports:
   ```python
   from types import MappingProxyType
   from typing import TypedDict
   ```
2. Define `StageEntry`:
   ```python
   class StageEntry(TypedDict):
       name: str
       wp_scoped: bool
       extra_vars: dict[str, str]
   ```
3. Change `STAGES: list[dict]` → `STAGES: list[StageEntry]`.
4. Change `_BASE_VARS: dict[str, str] = {…}` →
   `_BASE_VARS: MappingProxyType[str, str] = MappingProxyType({…})`.
5. Update type hints on `_render_stage` and `render_and_write` to accept
   `StageEntry` instead of `dict`.
6. Verify: `python3 scripts/preview-prompts.py` still produces 14 files;
   `python3 scripts/preview-prompts.py --list` still prints 8 names.

### WP-3: Add summary count line to CLI output

**File:** `scripts/preview-prompts.py`

**Current behaviour (confirmed):** Both default and `--stage` modes print
only `✓` lines — no trailing summary.

1. After the `for dest in all_written:` print loop, add:
   ```python
   print(f"\n{len(all_written)} file(s) written to orchestrator/dist/stage-prompts/")
   ```
2. Verify default run ends with `14 file(s) written to …`.
3. Verify `--stage developer` ends with `2 file(s) written to …`.
4. Verify `--stage pm` ends with `1 file(s) written to …`.
5. Verify `--list` output is unchanged (no summary line).

### WP-4: Document without-WP template design intent

**File:** `orchestrator/src/nodes/templates/VARIABLES.md`

**Current state (confirmed):** All 6 WP-scoped templates gate their
substantive content inside `{{#if wp_id}}` blocks. The without-WP render
for all 6 is identical: 99 bytes containing only the project-path header
and the `project-path-reminder` partial. This is intentional — the
without-WP prompt is used when the supervisor routes a stage *before* a
specific WP is assigned.

1. Read `VARIABLES.md` to understand its current content.
2. Append a section titled **"Without-WP Renders"** explaining:
   - Only content *outside* `{{#if wp_id}}` blocks appears in without-WP
     renders.
   - Currently all 6 WP-scoped templates produce minimal output (project
     path + reminder) — this is by design.
   - Future template authors should place stage-level (non-WP-specific)
     instructions outside the `{{#if wp_id}}` block if they should appear
     in the without-WP variant.
3. Verify the documentation reads correctly and doesn't duplicate existing
   content.

## Dependencies

- WP-1 through WP-4 are fully independent and can be executed in parallel.
- WP-1 (dependency upgrade) should be done first if sequential, as it
  affects the test environment for all other WPs.

## Required Components

| Component | Type | Path |
|-----------|------|------|
| pyproject.toml | **Existing** | `orchestrator/pyproject.toml` |
| requirements.txt | **Existing** | `orchestrator/requirements.txt` |
| preview-prompts.py | **Existing** | `scripts/preview-prompts.py` |
| VARIABLES.md | **Existing** | `orchestrator/src/nodes/templates/VARIABLES.md` |
| constraints.md | **Existing** (conditional) | `orchestrator/docs/agents/project-manifest/constraints.md` |

## Assumptions

- The Pydantic V1 warning originates from `langchain_core` importing
  `pydantic.v1.fields`, and upgrading to `1.2.22` is expected to resolve or
  suppress it. If the warning persists at `1.2.22`, the upstream issue
  tracker should be consulted before applying a local `warnings.filterwarnings`
  workaround.
- `StageEntry` as a `TypedDict` does not require runtime validation — it
  is a static typing aid only.
- The summary count line format matches the conventions used by other
  workspace CLI scripts (e.g., `build-personas.js` prints file counts).

## Constraints

- `preview-prompts.py` must remain stdlib-only (no third-party imports
  beyond `prompt_renderer`). The `TypedDict` and `MappingProxyType` are
  both stdlib.
- Dependency floor bumps must not break the orchestrator's existing test
  suite or live-run behaviour.
- Cross-platform: all path construction must continue using `pathlib.Path`.

## Out of Scope

- Adding new stages to the STAGES registry.
- Refactoring the `prompt_renderer` module itself.
- Adding automated tests for `preview-prompts.py` (a separate effort).
- Resolving the Pydantic V1 warning via a `warnings.filterwarnings`
  workaround — the plan explicitly prefers the upstream fix.

## Acceptance Criteria

1. `python3 scripts/preview-prompts.py --list 2>&1` produces no
   `UserWarning` output on stderr.
2. `python3 -m pytest tests/ -v` passes with no regressions.
3. `STAGES` is typed as `list[StageEntry]` where `StageEntry` is a
   `TypedDict`.
4. `_BASE_VARS` is wrapped in `MappingProxyType`.
5. Default run (`python3 scripts/preview-prompts.py`) ends with
   `14 file(s) written to orchestrator/dist/stage-prompts/`.
6. `--stage developer` ends with `2 file(s) written to …`.
7. `--list` output is unchanged (8 stage names, no summary).
8. `VARIABLES.md` contains a "Without-WP Renders" section explaining
   the template design intent.
9. `orchestrator/pyproject.toml` and `orchestrator/requirements.txt`
   pin `langchain-core>=1.2.22`.

## Testing Strategy

- **WP-1:** Full pytest suite + manual verification that the
  `UserWarning` is absent from stderr.
- **WP-2:** Run `preview-prompts.py` default + `--list` + `--stage`
  modes. Optionally run `mypy` or `pyright` to confirm `StageEntry`
  type checking works.
- **WP-3:** Run all three CLI modes and verify output includes the
  summary count line (or doesn't, for `--list`).
- **WP-4:** Manual review of `VARIABLES.md` content.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`langchain-core` 1.2.22 still emits the Pydantic V1 warning** | Check the upstream changelog / issue tracker; if unresolved, document the finding and defer to the next release. Do not apply a blanket `warnings.filterwarnings('ignore')`. |
| **Dependency upgrade causes pip resolution conflicts** | Pin exact compatible versions discovered during resolution; document floor versions. |
| **`MappingProxyType` breaks downstream code that spreads `_BASE_VARS`** | `MappingProxyType` supports `{**_BASE_VARS, …}` unpacking (dict protocol); no breakage expected. |

---

## Implementation Summary

**Status: COMPLETED — 2026-03-27**

All four work items were implemented and verified.

### WP-1 — langchain-core floor pin upgraded

- `orchestrator/pyproject.toml`: `langchain-core>=0.3.45` → `langchain-core>=1.2.22`
- `orchestrator/requirements.txt`: same change, mirrored
- `pip install -e '.[anthropic,dev]'` ran cleanly; `langchain-core 1.2.22` is now
  the installed version.
- **Known limitation (risk scenario, per plan):** The Pydantic V1 `UserWarning`
  (`Core Pydantic V1 functionality isn't compatible with Python 3.14 or greater`)
  persists even at `1.2.22`. This is an upstream issue in `langchain-core` — the
  library still imports `pydantic.v1.fields` internally regardless of version. Per
  the plan's mitigation, no local `warnings.filterwarnings` workaround was applied.
  The floor pin has been formalised at `1.2.22` (the current latest); resolution
  should be re-checked when the next `langchain-core` release is available.
- Full test suite: **646 passed, 1 skipped**, no regressions.

### WP-2 — TypedDict + MappingProxyType

- Added `from types import MappingProxyType` and `from typing import TypedDict`
  to `scripts/preview-prompts.py`.
- Defined `StageEntry(TypedDict)` with fields `name: str`, `wp_scoped: bool`,
  `extra_vars: dict[str, str]`.
- Retyped `STAGES: list[StageEntry]`, `_BASE_VARS: MappingProxyType[str, str]`.
- Updated signatures of `_render_stage(stage: StageEntry, …)` and
  `render_and_write(stage: StageEntry, …)`.

### WP-3 — Summary count line

- Added `print(f"\n{len(all_written)} file(s) written to orchestrator/dist/stage-prompts/")`
  after the `✓`-line loop in `main()`.
- Verified output:
  - Default run → `14 file(s) written to orchestrator/dist/stage-prompts/`
  - `--stage developer` → `2 file(s) written to orchestrator/dist/stage-prompts/`
  - `--stage pm` → `1 file(s) written to orchestrator/dist/stage-prompts/`
  - `--list` → unchanged (8 stage names, no summary line)

### WP-4 — Without-WP Renders section in VARIABLES.md

- Appended a new **"Without-WP Renders"** section at the end of
  `orchestrator/src/nodes/templates/VARIABLES.md` explaining:
  - Only content outside `{{#if wp_id}}` blocks appears in without-WP renders.
  - Current behaviour: all 6 WP-scoped templates produce minimal output (project
    path + reminder) — confirmed intentional.
  - Guidance for future template authors on where to place stage-level vs. WP-
    specific content.
