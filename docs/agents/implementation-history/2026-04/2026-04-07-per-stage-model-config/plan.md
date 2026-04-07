# Plan

## Summary

Replace the orchestrator's `MODEL_NAME` environment variable and `--model` CLI flag with persona-metadata-driven model selection. A new `model_slug` key in each persona's YAML source carries the API-compatible model identifier (e.g. "claude-opus-4-6") alongside the existing human-readable `model` (e.g. "Claude Opus 4.6"). A `default_model_slug` in `_shared.yaml` provides the default for all agents. The orchestrator reads these values directly at startup — no env var, no CLI flag, no mapping layer. Model selection is defined once in persona metadata and consumed everywhere. Additionally, log the resolved model in every `stage_start` and `stage_complete` JSONL event for post-run observability.

## Architectural Context

### Persona metadata — the existing per-agent model source

The persona build system already defines which LLM model each agent should use:

- **`personas/ledger/src/meta/_shared.yaml`** — `default_model: "Claude Sonnet 4.6"` (default for all agents), `cc_model: "inherit"` (defers to user in Claude Code).
- **Per-persona YAML** (e.g. `personas/ledger/src/meta/1-planner.yaml`) — optional `model:` override (e.g. `model: "Claude Opus 4.6"` for Planner and PM).
- **Generated VS Code output** (e.g. `personas/ledger/vs-code/3-dev.agent.md`) — frontmatter includes the resolved model: `model: 'Claude Sonnet 4.6'`.
- **Generated Claude Code output** (e.g. `personas/ledger/claude-code/3-developer.md`) — frontmatter has `model: 'inherit'` (intentionally, since Claude Code manages model selection differently).
- **Ledger plugin** (`personas/plugins/ledger/index.js`) — in `onBuildContext()`, falls back from per-persona `model` to `default_model` from `_shared.yaml`.

The current model assignments are:

| Stage | Persona | `model` (human-readable) | `model_slug` (new) |
|-------|---------|--------------------------|---------------------|
| planner | 1-planner | Claude Opus 4.6 | `claude-opus-4-6` |
| pm | 2-project-manager | Claude Opus 4.6 | _(inherits default)_ |
| developer | 3-developer | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| qa | 4-qa | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| security_auditor | 5-security-auditor | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| reviewer | 6-reviewer | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| release_engineer | 7-release-engineer | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| docs | 8-documentation | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |
| synthesis | 9-synthesis | _(default)_ Claude Sonnet 4.6 | _(inherits default)_ |

### Orchestrator — current model handling

- **`orchestrator/src/config.py`** — `load_config()` reads a single global `MODEL_NAME` from the environment (currently **required**), auto-detects the provider via `_resolve_provider()`, and stores both in the `Config` dataclass. `Config.get_chat_model()` returns a LangChain chat model instance but is **never called** from the codebase — `create_deep_agent(model=...)` handles model instantiation internally.
- **`orchestrator/src/cli.py`** — exposes a `--model` CLI flag that overrides `MODEL_NAME` by writing to `os.environ` before `load_config()` runs.
- **`orchestrator/src/nodes/__init__.py`** — `create_stage_node()` is the generic node factory. It captures `Config` in a closure (`_app_config`) and passes `_app_config.model_name` to `create_deep_agent(model=...)`. All 8 stage nodes delegate to this factory.
- **`orchestrator/src/utils/persona.py`** — `load_persona()` reads the *Claude Code* persona file as a raw Markdown string (system prompt) and caches it. It returns the full text, with no metadata extraction.
- **`orchestrator/src/config.py`** — `PERSONA_FILES: dict[str, str]` maps stage names to persona file paths (derived from `shared/workflow-manifest.json`). Paths point to `personas/ledger/claude-code/`.
- **JSONL log events** — `stage_start` and `stage_complete` do not include a `model` field. `run_start` does not record the model either.
- **Tests** — multiple test files reference `model_name` on `Config` objects and set `MODEL_NAME` in monkeypatched environments.

### The gap

The persona metadata YAML files contain per-agent model specifications, but:
1. The orchestrator only reads the Claude Code `.md` output (which has `model: 'inherit'`).
2. The persona YAML metadata is not read by the orchestrator at all.
3. Even if it were, the `model` field contains human-readable names ("Claude Sonnet 4.6") not API identifiers ("claude-sonnet-4-6").
4. There is no field that carries the API-compatible model identifier.
5. The `MODEL_NAME` env var and `--model` CLI flag create a parallel configuration channel that duplicates (and can contradict) the model intent already expressed in persona metadata.

### Key constraints

- **Constraint 7 (Stage Node Isolation)**: Each stage creates its own Deep Agent — per-stage models are inherently compatible.
- **Constraint 5 (Manifest-Derived Constants)**: Stage names and persona file paths are manifest-derived.
- **Cross-project dependency**: Persona metadata is a cross-project concern — changes touch both the personas sub-project and the orchestrator.

## Approach / Architecture

### 1. Add `model_slug` / `default_model_slug` to persona metadata

Add a new `model_slug` key to persona YAML metadata, carrying the API-compatible model identifier. This parallels the existing `model` / `default_model` pattern:

- **`_shared.yaml`**: Add `default_model_slug: "claude-sonnet-4-6"` alongside existing `default_model: "Claude Sonnet 4.6"`.
- **Per-persona YAML** (only where `model` is overridden): Add `model_slug` alongside `model`. E.g. in `1-planner.yaml`: `model_slug: "claude-opus-4-6"` next to `model: "Claude Opus 4.6"`.

The `model_slug` follows the same inheritance pattern as `model`: per-persona `model_slug` overrides `default_model_slug`, just as per-persona `model` overrides `default_model`. The ledger plugin's `onBuildContext()` already implements this fallback pattern for `model` → `default_model` and will be extended to do the same for `model_slug` → `default_model_slug`.

### 2. Remove `MODEL_NAME` env var and `--model` CLI flag

Since `default_model_slug` provides the base model and per-persona `model_slug` provides overrides, there is no need for a parallel env-var-based model configuration. Remove:
- The `MODEL_NAME` env var requirement from `load_config()`.
- The `--model` CLI flag from `cli.py`.
- The `Config.model_name` and `Config.provider` fields.
- The `Config.get_chat_model()` method (never called from the codebase).
- The `_resolve_provider()` function (provider detection is handled internally by `create_deep_agent`).

### 3. Orchestrator reads `model_slug` from persona metadata at config time

A new utility `extract_persona_model_slugs()` reads the persona YAML metadata files and returns `{stage: model_slug}` for each stage. The orchestrator uses these API identifiers directly — no mapping layer, no env var fallback needed.

### 4. Resolution chain

For each stage:
1. Read `model_slug` from persona metadata (per-persona YAML → `default_model_slug` fallback)
2. Use it as the API model identifier for `create_deep_agent(model=...)`
3. If persona metadata is entirely unreadable (files missing), raise a clear error at startup — persona metadata files are committed and mandatory

### 5. JSONL logging

Include the resolved model identifier in `stage_start`, `stage_complete`, and `stage_error` log entries. Include the per-stage model map in `run_start`.

## Rationale

- **No mapping layer** — `model_slug` is the API identifier, declared at the source. No `DEFAULT_MODEL_MAP` to maintain or sync.
- **No parallel configuration** — removing `MODEL_NAME` and `--model` eliminates the possibility of env-var config contradicting persona metadata. One source, no ambiguity.
- **Parallel to existing pattern** — `model` / `default_model` is already established; `model_slug` / `default_model_slug` is the same pattern for a different consumer (the orchestrator vs. VS Code frontmatter).
- **Single source of truth** — both the human-readable name and API identifier live in the same persona YAML file, co-located and versioned together.
- **Future-proof** — when adding a new model (e.g. Gemini), the persona author adds both `model: "Gemini 2.5 Pro"` and `model_slug: "gemini-2.5-pro"` in one place.
- **Simpler Config** — `Config` dataclass shrinks: no `model_name`, no `provider`, no `get_chat_model()`. Model selection is purely per-stage via `stage_models`.

## Detailed Steps

### Phase A: Persona metadata changes (personas sub-project)

#### A1. Add `default_model_slug` to `_shared.yaml`

In `personas/ledger/src/meta/_shared.yaml`:
- Add `default_model_slug: "claude-sonnet-4-6"` below the existing `default_model` line.

#### A2. Add `model_slug` to personas with `model` overrides

In each per-persona YAML that already has a `model:` override, add a corresponding `model_slug:` line:
- `personas/ledger/src/meta/1-planner.yaml`: Add `model_slug: "claude-opus-4-6"` below `model: "Claude Opus 4.6"`.
- `personas/ledger/src/meta/2-project-manager.yaml`: Add `model_slug: "claude-opus-4-6"` below `model: "Claude Opus 4.6"`.

Personas that inherit `default_model` (3 through 9) do not need a `model_slug` — they inherit `default_model_slug` via the same fallback.

#### A3. Extend ledger plugin `onBuildContext()` to resolve `model_slug`

In `personas/plugins/ledger/index.js`, add a `model_slug` → `default_model_slug` fallback block paralleling the existing `model` → `default_model` block:
```js
// --- model_slug (orchestrator API identifier) — fallback to default_model_slug
if (!updated['model_slug'] && updated['default_model_slug']) {
  updated['model_slug'] = updated['default_model_slug'];
}
```

This makes `model_slug` available as a template variable if needed in future (e.g. in generated output), though the orchestrator reads the YAML source directly.

#### A4. Rebuild personas

Run `node scripts/build-personas.js` to regenerate output files. The `model_slug` value does not appear in any current frontmatter template, so the generated VS Code and Claude Code output files should be unchanged (bitwise identical). The `--check` flag should confirm no diff.

### Phase B: Orchestrator changes

#### B1. Add persona model extraction utility

Create `orchestrator/src/utils/persona_models.py`:
- Function `extract_persona_model_slugs(workspace_root: Path) -> dict[str, str]`:
  - Scans `personas/ledger/src/meta/` for YAML files matching per-persona patterns (numbered `N-*.yaml`, excluding `_shared.yaml`).
  - Reads `_shared.yaml` for `default_model_slug`.
  - For each persona YAML, reads the `model_slug` key; falls back to `default_model_slug` when absent.
  - Maps persona file names to orchestrator stage names using the workflow manifest's role data (the `id` field in `shared/workflow-manifest.json` roles).
  - Returns `{stage_name: model_slug}` (e.g. `{"pm": "claude-opus-4-6", "developer": "claude-sonnet-4-6"}`).
- Uses stdlib-only YAML parsing (simple key-value extraction via string splitting/regex) since the metadata files are flat, predictable, and generated by a controlled process. No PyYAML dependency needed.

#### B2. Remove `MODEL_NAME` env var, `--model` CLI flag, and related code

In `orchestrator/src/config.py`:
- Remove the `model_name` field from `Config`.
- Remove the `provider` field from `Config`.
- Remove the `get_chat_model()` method from `Config` (never called externally).
- Remove `_resolve_provider()`, `_model_is_anthropic()`, `_model_is_google()` functions.
- Remove the `MODEL_NAME` validation block from `load_config()`.
- Remove `_ANTHROPIC_PREFIXES` and `_GOOGLE_PREFIXES` constants.

In `orchestrator/src/cli.py`:
- Remove the `--model` CLI argument definition.
- Remove the `if args.model: os.environ["MODEL_NAME"] = args.model` block.

In `orchestrator/.env.example`:
- Remove the `MODEL_NAME` lines.
- Remove the provider-selection comments.

#### B3. Add `stage_models` field and resolver to `Config`

In `orchestrator/src/config.py`:
- Add `stage_models: dict[str, str]` field to `Config` dataclass. Values are API model identifiers keyed by stage name.
- Add `resolve_model_for_stage(self, stage: str) -> str` method that returns `self.stage_models[stage]`. Raises `KeyError` for unknown stages (programming error — all valid stages must be populated).

#### B4. Update `load_config()` to populate `stage_models`

In `orchestrator/src/config.py`:
- Call `extract_persona_model_slugs(workspace_root)` to get `{stage: model_slug}` for all stages.
- Validate that required API keys are present for each unique model slug. Use a simplified check: slugs starting with `claude` need `ANTHROPIC_API_KEY`; slugs starting with `gemini` or `models/gemini` need `GOOGLE_API_KEY`. Fail-fast with a clear error listing which stage/model needs which key.
- Store the result in `stage_models`.
- If `extract_persona_model_slugs()` raises (metadata files missing), raise an `OSError` with a clear message — persona metadata is mandatory, not optional.

#### B5. Update `create_stage_node()` to use per-stage model

In `orchestrator/src/nodes/__init__.py`:
- Inside `node_fn()`, resolve the model via `_app_config.resolve_model_for_stage(stage)` instead of `_app_config.model_name`.
- Pass the resolved model to `create_deep_agent(model=resolved_model, ...)`.

#### B6. Add `model` field to JSONL `stage_start`, `stage_complete`, and `stage_error` events

In `orchestrator/src/nodes/__init__.py`:
- Add `"model": resolved_model` to the `start_entry`, success `log_entry`, and error `log_entry` dicts.

#### B7. Add `stage_models` to the `run_start` JSONL event

In `orchestrator/src/cli.py`:
- After loading config, include `stage_models=config.stage_models` in the `run_start` log entry.

#### B8. Update console output for `stage_start`

In `orchestrator/src/utils/logging.py`:
- In `_build_stream_console_line()`, when a `stage_start` entry contains a `model` field, append the model identifier to the console line.

#### B9. Update `.env.example`

In `orchestrator/.env.example`:
- Remove `MODEL_NAME` and provider-selection comments.
- Add a comment explaining that model selection is driven by persona metadata `model_slug` / `default_model_slug` values in `personas/ledger/src/meta/`.
- Keep API key entries (still required for provider authentication).

### Phase C: Documentation and log reader updates

#### C1. Update `scripts/read-log.js` log reader

In `scripts/read-log.js`:
- Update the `stage_start` rendering to show the model when present.
- Optionally add a per-stage model breakdown to the run summary.

#### C2. Update JSONL log schema documentation

In `orchestrator/docs/jsonl-log-schema.md`:
- Add `model` field to the Full Field Reference table.
- Update `stage_start`, `stage_complete`, `stage_error` action rows to list `model`.
- Update `run_start` to document `stage_models` (replaces per-stage info previously implicit from global `MODEL_NAME`).

#### C3. Update orchestrator API surface manifest

In `orchestrator/docs/agents/project-manifest/api-surface.md`:
- Add `model` to event key fields.
- Document `Config.resolve_model_for_stage()` and `extract_persona_model_slugs()`.

#### C4. Update orchestrator constraints manifest

In `orchestrator/docs/agents/project-manifest/constraints.md`:
- Add a constraint documenting that per-stage model identifiers are sourced exclusively from persona YAML metadata `model_slug` / `default_model_slug` keys. No env-var or CLI-flag model selection exists.
- Update constraint 4 (No LLM Calls in the Supervisor) rationale if it references `MODEL_NAME` or provider config.

#### C5. Update personas manifest (metadata schema documentation)

In `personas/docs/agents/project-manifest/`:
- Document the new `model_slug` / `default_model_slug` metadata keys in the constraints or API surface doc.

#### C6. Update cross-system dependencies in root AGENTS.md

In root `AGENTS.md` → Cross-System Dependencies table:
- Add entry: persona `model_slug` / `default_model_slug` metadata → orchestrator `Config.stage_models`.

#### C7. Update orchestrator README

In `orchestrator/README.md`:
- Remove `MODEL_NAME` from the environment variables table and `.env` examples.
- Remove `--model` from the CLI options documentation.
- Add a section explaining that model selection is driven by persona metadata.
- Update the quick-start / configuration sections accordingly.

### Phase D: Tests

#### D1. Persona model extraction tests

Create `orchestrator/tests/test_persona_models.py`:
- Test `extract_persona_model_slugs()` with fixture YAML files.
- Test `default_model_slug` fallback when `model_slug` is absent.
- Test graceful handling when metadata directory is missing.

#### D2. Config resolver tests

In `orchestrator/tests/test_config.py`:
- Test `resolve_model_for_stage()` returns the stage-specific model slug.
- Test `resolve_model_for_stage()` raises `KeyError` for unknown stage names.
- Test provider validation for per-stage model slugs (API key presence checks).
- Update existing tests that set `MODEL_NAME` in env or construct `Config` with `model_name` — these must be migrated to use `stage_models`.

#### D3. Node factory tests

In `orchestrator/tests/test_nodes.py`:
- Test that `create_stage_node()` passes the stage-resolved model to `create_deep_agent()`.
- Verify `stage_start` and `stage_complete` log entries contain the `model` field.

#### D4. Persona build check

Verify `node scripts/build-personas.js --check` passes after adding `model_slug` / `default_model_slug` — output files should be unchanged since no frontmatter template references `model_slug`.

#### D5. Update existing tests

Multiple existing test files construct `Config` objects with `model_name=` and set `MODEL_NAME` in monkeypatched environments. These must all be updated:
- `orchestrator/tests/test_nodes.py` — `model_name="claude-test"` in Config construction.
- `orchestrator/tests/test_config.py` — `MODEL_NAME` env var and `load_config()` assertions.
- `orchestrator/tests/test_cli.py` — `--model` flag parsing test (`args.model == "claude-opus-4"`).
- `orchestrator/tests/test_graph.py` — `model_name="claude-test"` in Config construction.
- `orchestrator/tests/test_tool_wrappers.py` — `model_name="claude-test"` in Config construction.

## Dependencies

- No new runtime dependencies in either sub-project.
- The persona YAML metadata files in `personas/ledger/src/meta/` must be present at orchestrator startup (committed to the repo). This is now a hard requirement, not a soft fallback.
- If per-stage model slugs reference different providers, both API keys must be set.
- Removing `MODEL_NAME` is a **breaking change** for existing `.env` files — documented in migration notes.

## Required Components

### Modified files

- `personas/ledger/src/meta/_shared.yaml` — add `default_model_slug`
- `personas/ledger/src/meta/1-planner.yaml` — add `model_slug`
- `personas/ledger/src/meta/2-project-manager.yaml` — add `model_slug`
- `personas/plugins/ledger/index.js` — add `model_slug` → `default_model_slug` fallback
- `orchestrator/src/config.py` — remove `model_name`, `provider`, `get_chat_model()`, `_resolve_provider()`; add `stage_models`, `resolve_model_for_stage()`
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` uses `resolve_model_for_stage()`
- `orchestrator/src/cli.py` — remove `--model` flag; update `run_start` event
- `orchestrator/src/utils/logging.py` — `_build_stream_console_line()` shows model
- `orchestrator/.env.example` — remove `MODEL_NAME`; add model metadata docs
- `orchestrator/README.md` — remove `MODEL_NAME` and `--model` references; add persona-driven model docs
- `orchestrator/docs/jsonl-log-schema.md` — schema docs
- `orchestrator/docs/agents/project-manifest/api-surface.md` — manifest
- `orchestrator/docs/agents/project-manifest/constraints.md` — new constraint
- `scripts/read-log.js` — log reader
- `orchestrator/tests/test_nodes.py` — migrate Config construction
- `orchestrator/tests/test_config.py` — migrate MODEL_NAME usage
- `orchestrator/tests/test_cli.py` — remove `--model` test
- `orchestrator/tests/test_graph.py` — migrate Config construction
- `orchestrator/tests/test_tool_wrappers.py` — migrate Config construction

### New files

- `orchestrator/src/utils/persona_models.py` — persona model extraction utility
- `orchestrator/tests/test_persona_models.py` — extraction tests

### Files read (not modified)

- `personas/ledger/src/meta/3-developer.yaml` through `9-synthesis.yaml` — inherit default, no `model_slug` needed
- `shared/workflow-manifest.json` — stage-to-persona mapping

## Assumptions

- `deepagents.create_deep_agent(model=...)` accepts any valid LangChain model identifier string (e.g. "claude-sonnet-4-6", "claude-opus-4-6") and handles provider detection and model instantiation internally.
- The persona YAML metadata files are committed and present in the workspace at orchestrator startup.
- The `model_slug` naming convention uses the short-form model identifier without date suffixes (e.g. "claude-sonnet-4-6" not "claude-sonnet-4-6-20250929"). LangChain resolves these to the latest version automatically.
- The workflow manifest's `roles[]` entries provide sufficient information to map persona filenames to stage names.
- `Config.get_chat_model()` is dead code — confirmed by grep: no call sites outside its own definition.

## Constraints

- **Breaking change**: Removing `MODEL_NAME` is a breaking change for existing `.env` files. Users must remove the `MODEL_NAME` line (or it becomes ignored). The `--model` CLI flag is also removed.
- **Mandatory metadata**: `default_model_slug` in `_shared.yaml` is required. Without it, `load_config()` raises an error.
- **Constraint 5 (Manifest-Derived Constants)**: Stage names and persona paths are manifest-derived, not hardcoded.
- **Constraint 7 (Stage Node Isolation)**: Each stage creates its own agent — per-stage models are inherently compatible.
- **Cross-project dependency**: Adding `model_slug` to persona metadata is a cross-project change (personas + orchestrator). Both must be updated together — persona metadata first, then orchestrator.
- **Persona build compatibility**: Adding `model_slug` to YAML metadata does not affect generated output unless a frontmatter template references it. Current templates do not.

## Out of Scope

- **Per-work-package model configuration**: This is per-stage, not per-WP.
- **Runtime model switching**: The model is resolved at config load time.
- **Model-specific parameter tuning** (temperature, max tokens): Separate feature.
- **Surfacing `model_slug` in generated persona frontmatter**: Not needed currently. The field exists in YAML source for orchestrator consumption. It can be added to frontmatter templates later if needed.
- **Standalone persona suite**: Only ledger personas are relevant to the orchestrator. Standalone personas may adopt `model_slug` independently.

## Acceptance Criteria

- `_shared.yaml` has `default_model_slug: "claude-sonnet-4-6"`.
- `1-planner.yaml` and `2-project-manager.yaml` have `model_slug: "claude-opus-4-6"`.
- Personas 3–9 inherit `default_model_slug` without needing a per-persona `model_slug`.
- `node scripts/build-personas.js --check` passes (no output diff).
- `MODEL_NAME` is no longer read from `.env` or the environment. Existing `.env` files with `MODEL_NAME` do not cause errors (the variable is simply ignored).
- The `--model` CLI flag is removed; passing it produces a parser error.
- Each stage uses the model identifier from its resolved `model_slug`.
- Every `stage_start` JSONL entry contains a `model` field with the resolved model identifier.
- Every `stage_complete` and `stage_error` JSONL entry contains the `model` field.
- The `run_start` JSONL entry contains `stage_models` (the full per-stage model map).
- Console output for `stage_start` shows the model identifier.
- When persona metadata files are missing, `load_config()` raises a clear `OSError` (not a silent fallback).
- All existing tests are updated and pass. All new code has test coverage.

## Testing Strategy

- **Unit tests for `extract_persona_model_slugs()`**: Parse fixture YAML files; verify `model_slug` extraction; verify `default_model_slug` fallback; verify `OSError` when metadata directory is missing.
- **Unit tests for `Config.resolve_model_for_stage()`**: Returns stage model; raises `KeyError` for unknown stage.
- **Unit tests for `load_config()` model slug integration**: Verify `stage_models` is populated from persona metadata; verify API key validation per model slug.
- **Unit tests for `create_stage_node()`**: Mock `create_deep_agent` and verify the `model` kwarg; verify JSONL entries contain `model`.
- **Persona build check**: `--check` confirms no output diff after metadata changes.
- **Test migration**: All existing tests that reference `model_name`, `MODEL_NAME`, or `--model` are updated to use `stage_models` instead.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking change for existing `.env` files** | `MODEL_NAME` is simply ignored if still present — no crash. Document the removal in the changelog. The `--model` removal will produce a clear argparse error. |
| **Persona metadata files not present** | `load_config()` raises a clear `OSError`. Files are committed to the repo — this should only happen in broken checkouts. |
| **`model_slug` / `model` drift** — slug doesn't match the human-readable name | Both fields are co-located in the same YAML file and updated together. Document the convention in persona constraints. |
| **Mixed-provider runs require both API keys** | Fail-fast validation at `load_config()` time with a clear error message. |
| **JSONL schema consumers may not expect `model` field** | Additive field — existing consumers ignore unknown keys. |
| **Future model families need new slugs** | Persona author adds `model_slug` when they add `model` — the two are always paired. No external mapping table to maintain. |
| **Existing tests break** | Test migration is scoped and mechanical: replace `model_name=` with `stage_models=` in Config construction; remove `MODEL_NAME` from env patches. Covered in Phase D. |
