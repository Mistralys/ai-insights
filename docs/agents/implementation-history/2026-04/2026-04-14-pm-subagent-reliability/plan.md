# Plan

## Summary

Fix the Project Manager (PM) stage in orchestrator runs so it reliably invokes all four sub-agents (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper) instead of bypassing them and doing work inline. Four root causes must be addressed: (1) only 1 of 4 sub-agents is registered in `STAGE_SUBAGENT_FILES`, (2) the registered name uses a display-name format that doesn't match the kebab-case slug the PM persona specifies, (3) the PM persona uses the parameter name `subagent` while Deep Agents expects `subagent_type`, and (4) `STAGE_SUBAGENT_FILES` is a static hardcoded dict rather than being derived from persona metadata.

This plan replaces the static `STAGE_SUBAGENT_FILES` with a metadata-driven approach: each ledger persona YAML declares its own `subagents` list, and the orchestrator derives the subagent specs at startup by reading that metadata. A post-build validation check in `scripts/build-personas.js` ensures that `agent_slug_*` template variables used in persona content match the declared `subagents` list.

## Architectural Context

The orchestrator pipeline executor uses Deep Agents' `create_deep_agent()` to run each stage. For stages with sub-agent delegation, the node factory calls `load_subagents(stage, workspace_root)` which reads persona files listed in `STAGE_SUBAGENT_FILES` (a static dict in `orchestrator/src/config.py`) and returns a list of SubAgent spec dicts (`name`, `description`, `system_prompt`). These specs are passed to `create_deep_agent(subagents=...)`, which in turn creates a `task` tool via `SubAgentMiddleware`. The `task` tool resolves sub-agents by exact `name` match against the `subagent_graphs` dict — no fuzzy matching or normalization.

**Current static approach (to be replaced):**

```
orchestrator/src/config.py
  STAGE_SUBAGENT_FILES = {
    "pm": [{"persona_file": "...", "name": "Ledger WP Decomposer", ...}]
  }
```

**New metadata-driven approach:**

```
personas/ledger/src/meta/2-project-manager.yaml
  subagents:
    - ledger-wp-decomposer         ← slug references standalone personas
    - ledger-dependency-sequencer
    - ledger-pipeline-configurator
    - ledger-bootstrapper

  ↓ (orchestrator reads at startup)

orchestrator/src/utils/subagents.py
  load_subagents("pm", workspace_root)
    1. Read manifest → pm stage → number 2 → personas/ledger/src/meta/2-project-manager.yaml
    2. Extract subagents: ["ledger-wp-decomposer", ...]
    3. For each slug:
       → Read personas/standalone/src/meta/{slug}.yaml → get description
       → Resolve deep-agents file: personas/standalone/deep-agents/{slug}.md
       → Build spec: {name: slug, description, system_prompt: file content}
    4. Return list of specs
```

Key files:
- `orchestrator/src/config.py` — `STAGE_SUBAGENT_FILES` definition (to be removed)
- `orchestrator/src/utils/subagents.py` — `load_subagents()` loader (to be rewritten)
- `orchestrator/src/utils/persona_models.py` — existing YAML parser and manifest-based stage lookup (to be extended)
- `orchestrator/src/nodes/__init__.py` — `create_deep_agent()` call site (lines 868–874, unchanged)
- `personas/ledger/src/meta/2-project-manager.yaml` — PM persona metadata (add `subagents` field)
- `personas/ledger/src/content/2-project-manager.md` — PM persona template (fix `subagent` → `subagent_type`)
- `personas/standalone/src/meta/ledger-*.yaml` — standalone persona metadata (slug, description — already populated)
- `personas/standalone/deep-agents/ledger-*.md` — standalone persona files (already exist)
- `scripts/build-personas.js` — post-build validation (add `agent_slug_*` ↔ `subagents` check)

Deep Agents tool inheritance: sub-agents inherit tools from the parent agent by default (confirmed in `deepagents/middleware/subagents.py` line 43: "If not specified, inherits tools from the main agent via `default_tools`"). The Bootstrapper sub-agent will therefore receive all MCP tools from the PM parent — no additional tool injection is needed.

## Approach / Architecture

Apply a combined fix across three components — persona metadata, orchestrator config/loader, and build validation:

1. **Declare subagents in persona YAML metadata** — add a `subagents` list of slugs to `2-project-manager.yaml`.
2. **Add YAML helpers and shared lookup** — add `_extract_yaml_list()` and extract `find_ledger_yaml_for_stage()` in `persona_models.py` to eliminate duplicated manifest lookup logic.
3. **Rewrite `load_subagents()`** to derive specs from persona YAML + standalone persona metadata at startup, instead of reading from a static dict.
4. **Remove the static `STAGE_SUBAGENT_FILES`** from `orchestrator/src/config.py`.
5. **Fix the `task` tool parameter name** in the PM persona template from `subagent` to `subagent_type`.
6. **Add core subagent slug validation to `@mistralys/persona-builder`** — validate that `subagents` entries reference existing personas across all suites. Add `subagents` as a typed optional field on `PersonaMetadata`. *(Must be completed and built before Steps 7–8 run.)*
7. **Add template cross-reference check** in `scripts/build-personas.js` — verify `agent_slug_*` template variables match declared `subagents`.
8. **Rebuild personas** — regenerate all target outputs and verify the `subagent_type` fix and new validations.
9. **Update orchestrator manifest docs, Constraint 18, and personas constraints doc** to reflect the new metadata-driven approach.

## Rationale

- **Metadata-driven over static config:** Subagent declarations belong in the persona metadata because the persona template is the one that references them via `{{agent_slug_*}}` variables. Co-locating the declaration with the usage makes both maintenance and validation straightforward.
- **Persona YAML as source of truth:** The orchestrator already reads persona YAML for model slugs (`persona_models.py`). Extending this pattern for subagent declarations is consistent and avoids introducing a new configuration surface.
- **Persona YAML over workflow manifest:** Constraint 18 in the orchestrator manifest previously recommended adding a `subagents` array to `shared/workflow-manifest.json` as the future improvement path. This plan intentionally diverges from that recommendation. The workflow manifest is ledger-specific and tracks specification-level constructs (roles, pipelines, statuses). The `subagents` field in persona YAML is a persona-level operational concern — any persona (ledger or standalone) can declare sub-agents, making the field reusable beyond the ledger workflow. The manifest can benefit from this approach in the future (e.g., validation cross-references), but the persona YAML is the correct granularity for declaring which sub-agents a persona delegates to. Constraint 18 will be updated to reflect this rationale.
- **Post-build validation:** Checking `agent_slug_*` references against `subagents` at build time catches drift automatically — no manual coordination needed.
- **Kebab-case slugs as `name`:** The PM persona template uses `{{agent_slug_*}}` variables which resolve to the raw hyphenated slug (e.g., `ledger-wp-decomposer`). Using the slug as the Deep Agents sub-agent `name` ensures exact match.
- **`subagent_type` alignment:** Deep Agents' `SubAgentMiddleware` injects a system prompt that says "you must specify a `subagent_type` parameter". Aligning the persona instruction eliminates ambiguity.
- **Persona-builder open metadata model:** The `PersonaMetadata` type in `@mistralys/persona-builder` uses an index signature (`[key: string]: unknown`), so custom YAML fields pass through into the template context. This plan adds `subagents` as an explicit optional typed field (`subagents?: string[]`) to make it discoverable via TypeScript, without breaking the open index signature. The builder's `buildPersona()` function validates declared subagent slugs per-persona against the cross-suite `agentMap` — producing `ValidationResult` entries that flow into the existing strict-mode machinery. This avoids a separate batch validation pass and eliminates duplicate YAML I/O, since the persona's metadata is already loaded at that point in the pipeline.

## Detailed Steps

### 1. Add `subagents` field to PM persona YAML

In `personas/ledger/src/meta/2-project-manager.yaml`, add a `subagents` list referencing the four standalone persona slugs:

```yaml
subagents:
  - ledger-wp-decomposer
  - ledger-dependency-sequencer
  - ledger-pipeline-configurator
  - ledger-bootstrapper
```

These slugs correspond to the `slug` field in each standalone persona's YAML metadata under `personas/standalone/src/meta/`.

### 2. Add YAML helpers and shared ledger-YAML lookup to the orchestrator

In `orchestrator/src/utils/persona_models.py`:

**a) Add a `_extract_yaml_list()` function** alongside the existing `_extract_yaml_scalar()`. This handles simple YAML lists (dash-prefixed items under a key), maintaining the stdlib-only approach:

```python
def _extract_yaml_list(text: str, key: str) -> list[str]:
    """Return the list of simple scalar items under *key* from YAML *text*.

    Handles the pattern:
        key:
          - item1
          - item2

    Returns an empty list if the key is absent or has no list items.
    Only top-level keys are considered. Items must be simple scalars (not
    nested structures).
    """
    lines = text.splitlines()
    prefix = f"{key}:"
    collecting = False
    result: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            if collecting:
                continue
            continue
        if stripped.startswith(prefix):
            remainder = stripped[len(prefix):].strip()
            if not remainder or remainder.startswith("#"):
                collecting = True
                continue
            # Inline value (not a list) — return empty
            return []
        if collecting:
            if stripped.startswith("- "):
                val = stripped[2:].strip()
                # Strip quotes
                if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                    val = val[1:-1]
                result.append(val)
            elif stripped.startswith("-"):
                # Handle "  -item" (no space after dash) — unlikely but safe
                val = stripped[1:].strip()
                if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                    val = val[1:-1]
                result.append(val)
            else:
                # Next top-level key encountered — stop collecting
                break

    return result
```

**b) Extract a shared `find_ledger_yaml_for_stage()` utility.** Both `extract_persona_model_slugs()` and the new `load_subagents()` need the same operation: given a stage ID, locate the matching ledger persona YAML file. Currently `extract_persona_model_slugs()` does this inline (glob `[1-9]-*.yaml`, read each, match by `number` field against the manifest). Extract this into a reusable function:

```python
def find_ledger_yaml_for_stage(
    stage_id: str,
    workspace_root: Path,
) -> tuple[Path, str] | None:
    """Locate the ledger persona YAML file for *stage_id*.

    Returns a ``(yaml_path, yaml_text)`` tuple, or ``None`` if no
    matching file is found.  Uses the workflow manifest to map
    ``stage_id → role number → persona YAML filename``.
    """
```

Refactor `extract_persona_model_slugs()` to use this shared utility instead of its inline lookup. Export both `_extract_yaml_list` and `find_ledger_yaml_for_stage` so `subagents.py` can import them.

**Dual-parser constraint:** The `subagents` YAML field is parsed by two independent systems — the orchestrator's stdlib-only Python line-scanner (`_extract_yaml_list()`) and the persona-builder's `js-yaml` in TypeScript. The field format must remain a flat list of simple scalar strings (no nested structures, no YAML anchors, no flow sequences) to stay compatible with both parsers. This constraint is inherent and unavoidable given the polyglot architecture.

### 3. Rewrite `load_subagents()` to derive specs from persona YAML

Rewrite `orchestrator/src/utils/subagents.py` to:

1. Accept a `stage` (e.g., `"pm"`) and `workspace_root`.
2. Use `find_ledger_yaml_for_stage()` from `persona_models.py` to locate the ledger persona YAML.
3. Read the ledger persona YAML and extract the `subagents` list using `_extract_yaml_list()`.
4. For each slug in the list:
   a. Read `personas/standalone/src/meta/{slug}.yaml` → extract `description` using `_extract_yaml_scalar()`.
   b. Read `personas/standalone/deep-agents/{slug}.md` → use as `system_prompt`.
   c. Build spec: `{"name": slug, "description": description, "system_prompt": content}`.
5. Cache results per `(stage, slug)` as before. Preserve the existing `clear_cache()` function interface — tests already depend on it.
6. Return the list of specs.

**Error handling — fail fast at startup with clear messages:**
- If a slug in the `subagents` list has no matching standalone YAML at `personas/standalone/src/meta/{slug}.yaml`, raise `FileNotFoundError` with the expected path and the persona YAML that declared it.
- If a standalone YAML exists but contains no `description` field, raise `ValueError` naming the file and the missing field.
- If the standalone deep-agents persona file (`personas/standalone/deep-agents/{slug}.md`) does not exist, raise `FileNotFoundError` with the expected path.
- All errors include the parent stage name and the declaring persona file for traceability.

The new constants for directory paths:

```python
_LEDGER_META_DIR = Path("personas") / "ledger" / "src" / "meta"
_STANDALONE_META_DIR = Path("personas") / "standalone" / "src" / "meta"
_STANDALONE_DA_DIR = Path("personas") / "standalone" / "deep-agents"
```

The manifest lookup now delegates to `find_ledger_yaml_for_stage()` instead of reimplementing the glob/number-match pattern.

### 4. Remove `STAGE_SUBAGENT_FILES` from `orchestrator/src/config.py`

Delete the entire `STAGE_SUBAGENT_FILES` constant and its docstring (lines ~143–160). The new `load_subagents()` no longer imports from config — it reads persona YAML directly.

### 5. Fix the `task` tool parameter name in the PM persona template

In `personas/ledger/src/content/2-project-manager.md`, change all four `target_deep_agents` conditional blocks to use `subagent_type` instead of `subagent`. There are 4 occurrences (lines 63, 82, 101, 120 approximately):

**Before (each occurrence):**
```markdown
   - `subagent`: `"{{agent_slug_ledger_wp_decomposer}}"`
```

**After:**
```markdown
   - `subagent_type`: `"{{agent_slug_ledger_wp_decomposer}}"`
```

Apply this change for all four sub-agent dispatch blocks (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper).

### 5a. Run orchestrator tests

Run `pytest` in the orchestrator directory to verify no regressions from the `extract_persona_model_slugs()` refactor (Step 2b) and the `load_subagents()` rewrite (Step 3). This gate must pass before proceeding to persona-builder changes.

### 6. Add `subagents` slug validation as a core feature of `@mistralys/persona-builder`

> **Sequencing note:** This step modifies the persona-builder library, which must be rebuilt (`npm run build` in the persona-builder workspace) before Steps 7–8 run. The ai-insights persona build depends on the updated library.

The persona-builder library is the right place for this validation. It already builds a cross-suite agent name map (`buildAgentNameMap()`) that indexes every persona slug. The `subagents` field is a list of slugs referencing other personas — validating that those slugs actually exist is a natural extension of the builder's cross-suite awareness, not a per-consumer concern.

**Implementation in `src/builders/persona-builder.ts`:**

Add a `validateSubagentRefs()` function that runs **per-persona inside `buildPersona()`**, at step 9 alongside the existing `runValidate()` plugin hooks. At that point in the pipeline, the persona's full metadata is already loaded and the `agentMap` is already passed in — no duplicate I/O or separate validation pass needed. The function produces `ValidationResult` entries that flow into the existing strict-mode machinery:

1. Check if the current persona has a `subagents` field (expected: `string[]`).
2. For each slug in the list, verify it exists as a known persona (i.e., `agent_slug_{underscored_slug}` must be a key in the `agentMap`).
3. If not, produce a `ValidationResult` with `severity: 'error'` and a message like: `"Persona '{name}' declares subagent '{slug}' but no persona with that slug exists in any configured suite."`
4. Return the validation results, which `buildPersona()` appends to the persona's `validationResults` array.

This integrates naturally with the existing pipeline: `buildPersona()` already collects `ValidationResult` entries from `runValidate()` and includes them in `BuildResult.validationResults`. The existing strict-mode check in `build()` — which fails on any error or warning severity result — automatically enforces subagent slug validity without additional handling.

**Why per-persona in `buildPersona()`, not a batch step in `build()`:**
- The persona's metadata is already loaded at that point — no duplicate YAML I/O.
- The `agentMap` is already passed in as a parameter.
- Validation results flow naturally into `BuildResult.validationResults`, which the strict-mode machinery already aggregates.
- Each validation error is attached to the specific persona that caused it, making diagnostics clearer.

**Why core, not a plugin:**
- The validation requires the `agentMap` (built by `build()`) — plugins don't have access to it.
- It's a cross-suite concern: a persona in suite A can declare a subagent from suite B. Only the top-level `build()` orchestrator has visibility across suites.
- Every persona-builder consumer that uses `subagents` benefits automatically — no plugin registration required.

**Type narrowing:** Add `subagents` as an optional typed field on `PersonaMetadata`:

```ts
export interface PersonaMetadata {
  // ... existing fields ...
  /** Optional list of persona slugs this persona delegates to as sub-agents */
  subagents?: string[];
  [key: string]: unknown;
}
```

This makes the field discoverable via TypeScript without breaking the open index signature.

**Tests:** Add test cases in the persona-builder's test suite:
- Persona with `subagents: ["existing-slug"]` → validation passes.
- Persona with `subagents: ["nonexistent-slug"]` → validation produces an error result.
- Persona without `subagents` field → no validation (passes silently).
- `strict` mode with an invalid subagent slug → build throws.

**Manifest updates:** Update the persona-builder's project manifest:
- `api-surface.md` — document `validateSubagentRefs()` and the new `subagents` field on `PersonaMetadata`.
- `data-flows.md` — add the validation step to the build pipeline (at step 9, alongside `runValidate()`).
- `constraints.md` — document that `subagents` slugs must reference existing personas and document the planned `onPreRender` hook as a future extension point (label clearly as *"planned — not yet implemented"*).

### 7. Add `agent_slug_*` ↔ `subagents` template cross-reference check in `scripts/build-personas.js`

The persona-builder's core validation (Step 6) checks that declared subagent slugs reference existing personas. This workspace-specific step adds a complementary check: that `{{agent_slug_*}}` template variables used in content actually have a corresponding entry in the persona's `subagents` list.

This catches the reverse drift scenario — a template references a subagent via `{{agent_slug_*}}` but the persona YAML doesn't declare it in `subagents`. This validation requires access to raw template source (pre-rendering), which the builder's core pipeline does not currently expose.

Algorithm:
```
for each ledger persona YAML:
  subagents = extract_yaml_list(yaml_text, "subagents")
  content = read corresponding content file (N-*.md)
  references = scan for /\{\{agent_slug_([a-z0-9_]+)\}\}/g
  for each match:
    slug = match[1].replace(/_/g, '-')
    if slug not in subagents:
      ERROR: "{persona} uses {{agent_slug_{match[1]}}} but does not
              declare '{slug}' in its subagents list"
```

This validation runs on every build (both real builds and `--check` runs) and exits non-zero on mismatch.

**Interim approach:** This workspace-specific check is necessary because the persona-builder's core pipeline does not currently expose raw template source to the validation phase. Step 14 describes the planned persona-builder enhancement (`onPreRender` hook) that would allow this check to move into the library as a plugin. Until that hook exists, the workspace-specific script is the pragmatic home.

### 8. Rebuild personas

Run the persona build to regenerate all target outputs:

```bash
node scripts/build-personas.js
```

Verify the generated `personas/ledger/deep-agents/2-project-manager.md` now contains `subagent_type` instead of `subagent` in all four dispatch instructions. This step runs *after* the persona-builder library update (Step 6) and the template cross-check addition (Step 7), so both the core subagent slug validation and the `agent_slug_*` ↔ `subagents` cross-check are active during this build.

### 9. Update orchestrator manifest documentation

Update the following documents to describe the metadata-driven approach:

- `orchestrator/docs/agents/project-manifest/api-surface.md` — replace `STAGE_SUBAGENT_FILES` entry with docs for the new `load_subagents()` behavior and the new `find_ledger_yaml_for_stage()` utility
- `orchestrator/docs/agents/project-manifest/constraints.md` — rewrite Constraint 18: change title from "Manually Maintained — Not Manifest-Derived" to "Metadata-Driven — Derived from Persona YAML". Update the rationale to explain why persona YAML was chosen over the workflow manifest (generic applicability beyond ledger workflows). Remove the "Future improvement path" paragraph that recommended the manifest approach. Update the code examples.
- `orchestrator/docs/architecture.md` — update the subagent loading description
- `orchestrator/docs/public-api.md` — replace `STAGE_SUBAGENT_FILES` constant docs with the new `load_subagents()` metadata-driven behavior

### 10. Run orchestrator tests (post-documentation)

Re-run `pytest` in the orchestrator directory to confirm that all existing tests still pass after the documentation and loader changes. This is the final regression gate before proceeding to cross-project doc updates.

### 11. Update personas constraints documentation

In `personas/docs/agents/project-manifest/constraints.md`, document `subagents` as a recognized optional field in ledger persona YAML metadata:

- Field name: `subagents`
- Type: list of kebab-case slug strings
- Semantics: declares which standalone personas this persona delegates to as sub-agents
- Each slug must correspond to a standalone persona YAML at `personas/standalone/src/meta/{slug}.yaml`
- Consumed by: orchestrator's `load_subagents()` at startup, build-time validation in `scripts/build-personas.js`
- The field is optional — personas without sub-agent delegation omit it

### 12. Update cross-system dependency docs

> **Note on `agentMap` ordering:** The `buildAgentNameMap()` function in persona-builder scans all suites upfront *before* any `buildPersona()` call, so the cross-suite `agentMap` is always complete when `validateSubagentRefs()` runs. This ordering guarantee should be documented in the persona-builder manifest update (Step 6).

In root `AGENTS.md` (and `CLAUDE.md`), update the Cross-System Dependencies table:
- The "Orchestrator subagent files" row currently says `STAGE_SUBAGENT_FILES` is statically configured. Update to reflect that subagent declarations now live in persona YAML `subagents` field and are derived at startup by `load_subagents()`.

### 13. Update changelogs

Add entries to:
- `orchestrator/changelog.md` — metadata-derived subagent loading, removal of `STAGE_SUBAGENT_FILES`, shared `find_ledger_yaml_for_stage()` utility
- `personas/changelog.md` — `subagents` field in PM YAML, `subagent_type` parameter fix, template cross-reference validation
- `@mistralys/persona-builder` `CHANGELOG.md` — `subagents` slug validation as core build feature, `subagents` typed field on `PersonaMetadata`

### 14. Plan `onPreRender` hook for `@mistralys/persona-builder` (future enhancement)

The template cross-reference check in Step 7 currently lives in the workspace-specific `scripts/build-personas.js` because the persona-builder's validation pipeline only sees the *rendered* output — not the raw template source with its `{{agent_slug_*}}` variables still intact. This is an architectural gap in the builder that limits what validators can inspect.

**Planned enhancement:** Add an `onPreRender` hook to the `PersonaBuildPlugin` interface in `@mistralys/persona-builder`:

```ts
export interface PersonaBuildPlugin {
  // ... existing hooks ...

  /**
   * Called after partials resolution but before conditionals and variable
   * substitution. Receives the raw template body with unresolved
   * `{{variable}}` references still intact.
   *
   * Use cases:
   *   - Validate that template variable references match metadata declarations
   *   - Scan for deprecated variable patterns
   *   - Collect template dependency metadata
   *
   * Return value is ignored — this is an inspection-only hook.
   */
  onPreRender?(
    rawTemplate: string,
    context: Record<string, unknown>,
    persona: PersonaMetadata,
    suite: SuiteConfig,
    target: TargetType,
  ): void;
}
```

**Integration point in `buildPersona()`:** The hook fires after `resolvePartials()` (step 7a in the current pipeline) but before `resolveConditionals()` (step 7b). At this point, partials have been inlined but `{{variable}}` references and `{{#if}}` blocks are still present in their raw form — making variable-reference scanning possible.

**Migration path for Step 7:** Once this hook ships, the `agent_slug_*` ↔ `subagents` cross-reference check from `scripts/build-personas.js` can be reimplemented as a persona-builder plugin. The plugin would:

1. In `onPreRender`, scan `rawTemplate` for `/\{\{agent_slug_([a-z0-9_]+)\}\}/g` matches.
2. In `onValidate`, compare the collected template references against `persona.subagents`.
3. Produce `ValidationResult` entries for any mismatches.

This makes the validation portable — any persona-builder consumer gets it for free via plugin registration, rather than each workspace reimplementing the raw-template scan.

**Scope:** This step is limited to filing the feature as a planned enhancement in the persona-builder's backlog. Implementation is deferred to a separate plan — it requires careful consideration of the hook's position in the rendering pipeline, interaction with `resolveConditionals()`, and whether the hook should be inspection-only or allow template mutation.

**Manifest updates for persona-builder:**
- `constraints.md` — document the `onPreRender` hook as a planned extension point with the rationale above. Label clearly as *"planned — not yet implemented"* to avoid confusion.
- `data-flows.md` — add a note at step 6 (render body) marking the planned hook insertion point. Label clearly as *"planned — not yet implemented"*.

## Dependencies

- The standalone sub-agent persona files already exist at `personas/standalone/deep-agents/ledger-*.md` and `personas/standalone/src/meta/ledger-*.yaml` — no new persona creation needed.
- The workflow manifest (`shared/workflow-manifest.json`) provides stage ID → number mapping — already loaded by the orchestrator.
- Deep Agents library (`deepagents` package) — already installed in the orchestrator venv.
- The `@mistralys/persona-builder` package — already configured via `persona-build.config.js`. The core subagent slug validation (Step 6) requires changes to this library *before* the ai-insights persona build runs — the library must be updated and rebuilt first.

## Required Components

**Persona metadata (source of truth):**
- `personas/ledger/src/meta/2-project-manager.yaml` — add `subagents` field

**Persona template (bug fix):**
- `personas/ledger/src/content/2-project-manager.md` — fix `subagent` → `subagent_type` (4 occurrences)
- `personas/ledger/deep-agents/2-project-manager.md` — regenerated output (via build)

**Orchestrator (new loader, remove static config):**
- `orchestrator/src/config.py` — remove `STAGE_SUBAGENT_FILES`
- `orchestrator/src/utils/subagents.py` — rewrite to read from persona YAML
- `orchestrator/src/utils/persona_models.py` — add `_extract_yaml_list()`, extract `find_ledger_yaml_for_stage()`, refactor `extract_persona_model_slugs()` to use it

**Persona-builder library (core validation):**
- `src/builders/persona-builder.ts` — add `validateSubagentRefs()`, call from `buildPersona()`
- `src/plugins/types.ts` — add `subagents?: string[]` to `PersonaMetadata`
- `tests/builders/` — add subagent validation test cases
- `docs/agents/project-manifest/api-surface.md` — document new validation and field
- `docs/agents/project-manifest/data-flows.md` — add validation to pipeline, note planned `onPreRender` hook insertion point
- `docs/agents/project-manifest/constraints.md` — document `subagents` field rules, document planned `onPreRender` hook as future extension point
- `CHANGELOG.md` — entry for subagent slug validation feature

**Build validation (workspace-specific, complementary):**
- `scripts/build-personas.js` — add `agent_slug_*` ↔ `subagents` template cross-check

**Tests (new/updated):**
- `orchestrator/tests/test_persona_models.py` — add `_extract_yaml_list()` and `find_ledger_yaml_for_stage()` unit tests

**Documentation (updates):**
- `orchestrator/docs/agents/project-manifest/api-surface.md`
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint 18 rewrite
- `orchestrator/docs/architecture.md`
- `orchestrator/docs/public-api.md`
- `personas/docs/agents/project-manifest/constraints.md` — new `subagents` field docs
- Root `AGENTS.md` and `CLAUDE.md` — Cross-System Dependencies table
- `orchestrator/changelog.md`
- `personas/changelog.md`

## Assumptions

- The Deep Agents `task` tool parameter is named `subagent_type` (confirmed by reading `deepagents/middleware/subagents.py` line 135: "you must specify a `subagent_type` parameter").
- Sub-agents inherit MCP tools from the parent agent by default (confirmed by Deep Agents docs: "If not specified, inherits tools from the main agent via `default_tools`").
- The `{{agent_slug_*}}` template variables resolve to the raw hyphenated slug from persona YAML `slug` fields (confirmed by `persona-builder` api-surface.md: "value preserves hyphens").
- The PM persona must continue to dispatch sub-agents sequentially (not in parallel), because each sub-agent's output feeds into the next.
- Standalone persona YAML metadata files are named `{slug}.yaml` under `personas/standalone/src/meta/` (confirmed for all four sub-agents).
- Standalone deep-agents persona files are named `{slug}.md` under `personas/standalone/deep-agents/` (confirmed: deep-agents output filename falls back to content basename when no `da_file_name` field is set in the YAML — and the four sub-agent standalone personas do not set `da_file_name`).
- The orchestrator's stdlib-only YAML parsing approach (no PyYAML dependency) is maintained. Simple YAML lists (`- item`) are parseable with the same line-scanning technique.
- The `@mistralys/persona-builder` `PersonaMetadata` type uses an index signature (`[key: string]: unknown`), so the `subagents` field passes through into the template context. This plan adds `subagents` as an explicit optional typed field on `PersonaMetadata` to make it discoverable, while preserving the open index signature for other custom fields.
- The `@mistralys/persona-builder` library is symlinked into the ai-insights workspace (`npm link`), so changes to the library can be tested on either side without publishing. After modifying the persona-builder source (Step 6), rebuild it (`npm run build` in the persona-builder workspace) and the updated code is immediately available to the ai-insights persona build.
- The `name-mapping.json` file (regenerated by `scripts/build-personas.js`) is unaffected by this change — it only maps naming fields (`role`, `number`, `id`, `version`, `cc_file_name`, `vs_file_name`, `da_file_name`), not operational fields like `subagents`.

## Constraints

- Generated persona files must never be edited directly — changes go through the template source in `personas/ledger/src/content/`.
- The persona rebuild must be run after template changes to regenerate all target outputs.
- The orchestrator must not add new Python dependencies — the YAML list parser uses stdlib string parsing only.
- The `subagents` field format must remain a flat list of simple scalar strings — no nested structures, YAML anchors, or flow sequences — because it is parsed by both the orchestrator's stdlib Python line-scanner and the persona-builder's `js-yaml`.
- The `subagents` field is optional in persona YAML — stages without sub-agents simply have no field (or an empty list), and `load_subagents()` returns `[]` for them.

## Out of Scope

- Adding sub-agents to stages other than `"pm"` (the architecture supports it; only the PM currently needs sub-agents).
- Changing Deep Agents' `task` tool behavior or parameter naming.
- Adding orchestrator integration tests for sub-agent dispatch (would require a live LLM call — manual verification is specified instead).
- Adding `subagents` to `shared/workflow-manifest.json` schema (the persona YAML is the right granularity — the manifest tracks roles and pipelines, not per-role operational details like sub-agent delegation).
- Extending `name-mapping.json` to include standalone personas (not needed — the orchestrator reads standalone metadata directly).

## Acceptance Criteria

- `personas/ledger/src/meta/2-project-manager.yaml` declares the four sub-agent slugs in a `subagents` list.
- `orchestrator/src/config.py` no longer contains `STAGE_SUBAGENT_FILES`.
- `load_subagents("pm", workspace_root)` returns 4 specs with kebab-case `name` fields, descriptions from standalone YAML, and system prompts from standalone deep-agents files.
- `load_subagents("developer", workspace_root)` returns `[]` (no subagents declared).
- `load_subagents()` raises `FileNotFoundError` with a clear message when a declared slug has no matching standalone YAML or deep-agents file, and `ValueError` when a standalone YAML lacks a `description` field.
- `find_ledger_yaml_for_stage()` is used by both `extract_persona_model_slugs()` and `load_subagents()` — no duplicated manifest lookup logic.
- The generated `personas/ledger/deep-agents/2-project-manager.md` uses `subagent_type` (not `subagent`) in all 4 dispatch blocks.
- `node scripts/build-personas.js --check` passes (generated output is fresh).
- The persona-builder's `buildPersona()` validates that every slug in `subagents` references an existing persona across all configured suites, producing `ValidationResult` entries that flow into the existing strict-mode machinery. In `strict` mode, an invalid slug causes the build to fail.
- `scripts/build-personas.js` template cross-check catches `agent_slug_*` template references that are not declared in the persona's `subagents` list.
- Persona-builder `PersonaMetadata` type includes `subagents?: string[]` as an explicit optional field.
- Persona-builder tests cover valid subagents, invalid subagents, absent field, and strict mode failure.
- Persona-builder manifest docs (`api-surface.md`, `data-flows.md`, `constraints.md`) document the new feature.
- Persona-builder manifest docs (`constraints.md`, `data-flows.md`) document the planned `onPreRender` hook as a future extension point.
- Orchestrator manifest docs accurately describe the metadata-driven approach.
- Constraint 18 is rewritten to describe the metadata-driven architecture and its rationale.
- `personas/docs/agents/project-manifest/constraints.md` documents `subagents` as a recognized optional YAML field.
- Existing orchestrator tests (`pytest`) continue to pass.
- New unit tests for `_extract_yaml_list()` and `find_ledger_yaml_for_stage()` pass.

## Testing Strategy

1. **Persona build check:** Run `node scripts/build-personas.js --check` to verify generated output matches template source.
2. **Persona-builder subagent validation:** The builder's `validateSubagentRefs()` runs per-persona inside `buildPersona()`, producing `ValidationResult` entries. Test via `npx persona-build --strict` — an invalid slug in `subagents` causes a build failure. The workspace-specific `scripts/build-personas.js` template cross-check adds a complementary layer: test by temporarily removing a slug from the `subagents` list and confirming the build fails on the `agent_slug_*` ↔ `subagents` mismatch.
3. **New unit tests (REQUIRED):** Add tests in `orchestrator/tests/test_persona_models.py` for:
   - `_extract_yaml_list()`: basic list, empty list, missing key, quoted values, inline comments after list items, key with inline value (not a list), items after a non-list field, empty string items. Follow the existing `_extract_yaml_scalar()` test pattern (6+ cases).
   - `find_ledger_yaml_for_stage()`: valid stage lookup, unknown stage returns `None`, missing meta directory raises `OSError`.
4. **Orchestrator regression tests:** Run `pytest` in the orchestrator directory to verify no regressions from the `extract_persona_model_slugs()` refactor and the loader rewrite.
5. **Manual verification:** Run an orchestrator pipeline with a simple plan and verify:
   - The PM calls the `task` tool (visible in JSONL log as `tool_call` entries with `tool_name: "task"`).
   - `work-packages-draft.md` is created by the WP Decomposer sub-agent.
   - `dependency-analysis.md` is created by the Dependency Sequencer sub-agent.
   - `pipeline-configuration.md` is created by the Pipeline Configurator sub-agent.
   - The Ledger Bootstrapper creates `work.md` + `work/WP-*.md` files.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **LLM ignores `task` tool and continues doing work inline** | The `SubAgentMiddleware` injects a system prompt instructing the agent to use the `task` tool. With all 4 sub-agents registered and correctly named, the LLM has no reason to bypass. If it still bypasses, strengthen the PM persona instructions to mandate delegation. |
| **Sub-agent sequencing violated (parallel dispatch)** | The PM persona explicitly instructs sequential dispatch. Deep Agents supports both modes. If the LLM parallelizes, add explicit "wait for output before proceeding" language to the persona. |
| **Bootstrapper sub-agent fails due to missing MCP tools** | Confirmed that Deep Agents sub-agents inherit parent tools by default. No action needed. If tool inheritance fails in practice, add explicit `tools` to the Bootstrapper sub-agent spec in a future enhancement. |
| **Persona build breaks due to template syntax** | The change is limited to renaming a hardcoded string (`subagent` → `subagent_type`). Run `--check` to verify. |
| **Standalone persona slug not found at startup** | `load_subagents()` raises `FileNotFoundError` with a clear message naming the missing file, the slug, and the declaring persona YAML. This fails fast during orchestrator startup, not mid-run. |
| **Standalone persona YAML missing `description`** | `load_subagents()` raises `ValueError` naming the file and the missing field. Fails fast at startup. |
| **YAML list parser edge case** | The `_extract_yaml_list()` function handles only simple scalar list items — the `subagents` field will always contain plain slug strings. No nested structures or anchors needed. Comprehensive unit tests cover edge cases. |
| **Other personas accidentally add `subagents` field** | The field is optional. If a persona declares subagents but its content doesn't use `agent_slug_*`, the sub-agents are loaded but never invoked — harmless. If a persona declares a non-existent slug, the persona-builder's core validation catches it at build time (fails in strict mode). The reverse (using `agent_slug_*` without declaring in `subagents`) is caught by the workspace-specific template cross-check. |
| **`extract_persona_model_slugs()` regression** | The refactor to use `find_ledger_yaml_for_stage()` must preserve identical output. Existing `test_persona_models.py` tests cover this. |
