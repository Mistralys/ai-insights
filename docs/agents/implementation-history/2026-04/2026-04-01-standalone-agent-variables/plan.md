# Plan

## Summary

Add cross-suite agent name variables (`{{agent_<slug>}}`) as a built-in feature of the `@mistralys/persona-builder` library. This allows any persona in any suite to reference the display name of any other persona across all configured suites (e.g. `{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.0"`). Currently six such variables are unresolved during the ai-insights persona build, producing warnings and leaving raw `{{…}}` tokens in generated output.

The feature is implemented as a **library-level pre-scan** in the `build()` pipeline, not as a plugin concern — because cross-suite agent references are a general capability that any multi-suite configuration benefits from.

**Scope:** Changes span both workspaces:
- `ai-persona-builder-STABLE` — library implementation + tests
- `ai-insights-dev` — consumer-side documentation update (personas manifest)

## Architectural Context

### How variable resolution works

The `@mistralys/persona-builder` library renders persona templates through a pipeline defined in `src/builders/persona-builder.ts`:

1. Load persona YAML metadata via `loadPersonaYaml()`
2. Build merged context via `buildContext()` (`_shared.yaml` + per-persona YAML + derived fields like `tools_json`, `cc_file_name_stem`)
3. **Run plugin `onBuildContext` hooks** — plugins can inject additional key/value pairs
4. Render frontmatter via `renderFrontmatter()`
5. Load content template
6. Render body: `resolvePartials()` → `resolveConditionals()` → `resolveVariables()` → post-process
7. Assemble output (frontmatter + body)

At step 6, the engine's `resolveVariables()` in `src/engine/variables.ts` looks up each `{{variable}}` token in the context object. If a key is missing, it emits a `[WARN] Unresolved variable` and leaves the token as-is. The variable regex `/\{\{(\w+)\}\}/g` matches `agent_<slug>` keys (underscores are `\w`).

### Current build flow (`build()`)

```
build(config)
  for each [suiteName, suiteConfig] in config.suites:
    for each target in config.targets:
      buildSuite(suiteName, suiteConfig, config, plugins, target)
        1. Load _shared.yaml for this suite
        2. Load partials (shared base → suite-local override)
        3. Run onSuiteInit on all plugins
        4. Discover all persona YAML files
        5. For each persona YAML:
             buildPersona(...)
               → loadPersonaYaml()
               → buildContext(personaMeta, sharedMeta)     ← INJECTION POINT
               → runBuildContext(plugins, context, ...)
               → renderFrontmatter()
               → resolvePartials → resolveConditionals → resolveVariables
               → runPostRender → runValidate → write
```

**Key observation:** There is no pre-scan phase before the iteration. Each suite is built independently with no awareness of other suites' personas. The `buildContext()` function computes derived fields (`tools_json`, `cc_tools_list`, `cc_file_name_stem`, etc.) but has no cross-suite data.

### Where the unresolved variables are consumed

Two ledger persona content templates in the ai-insights workspace reference standalone agent names:

- `personas/ledger/src/content/2-project-manager.md` — `{{agent_wp_decomposer}}`, `{{agent_dependency_sequencer}}`, `{{agent_pipeline_configurator}}`, `{{agent_ledger_bootstrapper}}`
- `personas/ledger/src/content/7-release-engineer.md` — `{{agent_changelog_curator}}`, `{{agent_ctx_architect}}`

These are used in `runSubagent` / `Task` invocation instructions to provide the correct agent display name with version.

### Data source for agent names

Each persona YAML file can contain:
- `slug` (e.g. `"wp-decomposer"`) — or falls back to filename stem
- `name` (e.g. `"WP Decomposer"`) — or falls back to filename stem (already implemented by `loadPersonaYaml()`)
- `version` (e.g. `"1.0.0"`) — or falls back to suite's `default_version` from `_shared.yaml`

The variable key convention: `agent_` + slug with hyphens (`-`) replaced by underscores (`_`).
The variable value: `"<name> v<version>"` (e.g. `"WP Decomposer v1.0.0"`).

### Public API surface affected

- `build()` — internal change (pre-scan before suite iteration)
- `buildSuite()` — new parameter to receive the agent map
- `buildPersona()` — new parameter to receive the agent map
- `buildContext()` — new parameter to inject the map into merged context
- No new public types required (the map is `Record<string, string>`, internal)

## Approach / Architecture

**Add a pre-scan phase to `build()`** that discovers all personas across all configured suites, loads their `slug`/`name`/`version`, and assembles a `Record<string, string>` map of `agent_*` keys to display values. This map is then threaded through `buildSuite()` → `buildPersona()` → `buildContext()` where it's merged into the rendering context.

```
build(config)
  NEW: agentMap = buildAgentNameMap(config)    ← pre-scan all suites
  for each [suiteName, suiteConfig] in config.suites:
    for each target in config.targets:
      buildSuite(..., agentMap)                ← pass through
        for each persona:
          buildPersona(..., agentMap)           ← pass through
            buildContext(personaMeta, sharedMeta, agentMap)  ← inject
```

### Key design decisions

1. **Library-level, not plugin-level:** Cross-suite agent references are a general concept — not specific to the ledger workflow. Any multi-suite config benefits. Standalone agents can reference each other as sub-agents.
2. **Pre-scan at `build()` time:** The map is computed once before any suite is built — no redundant filesystem reads per persona or per target.
3. **All suites contribute, all suites consume:** Every persona from every suite gets an `agent_*` entry, and the full map is available in every persona's context. A persona's own entry is included (no self-exclusion needed).
4. **Slug derivation:** Uses the `slug` field from YAML when present; falls back to the filename stem (e.g. `wp-decomposer.yaml` → `wp-decomposer`). This keeps compatibility with personas that don't declare an explicit `slug`.
5. **Version derivation:** Uses the persona's `version` field; falls back to the suite's `default_version` from `_shared.yaml`; falls back to `0.0.0`.
6. **No-conflict guard:** Agent map keys are injected only when not already present in the merged context (`if (!(key in merged))`), so explicit YAML fields always win.
7. **Opt-in is not needed:** This is automatic for all multi-suite configurations. Single-suite configs get a map too (self-referencing), which is harmless.

## Rationale

- **Library-level over plugin-level:** The previous plan proposed adding this in the ledger plugin, but that couples a general capability to a specific consumer's plugin. By building it into the library, any persona project with multiple suites gets cross-referencing for free — including standalone-to-standalone references.
- **Pre-scan pattern matches existing architecture:** `buildContext()` already computes derived fields like `tools_json` and `cc_file_name_stem`. Cross-suite agent names are another derived field — they're deterministic, computed from static YAML data.
- **Synchronous scan:** The pre-scan uses the same `loadPersonaYaml()` (async) and `loadRawYaml()` (async) functions already in the builder. No sync filesystem calls needed — the `build()` function is already async.
- **Minimal API change:** The internal function signatures gain an optional parameter. The public `build()` and `buildSuite()` signatures don't change. `buildPersona()` gains an optional `agentMap` parameter with a `{}` default, so existing callers are unaffected.

## Detailed Steps

All file paths below are relative to the `ai-persona-builder-STABLE` workspace root unless otherwise noted.

### Step 1: Add `buildAgentNameMap()` function to `src/builders/persona-builder.ts`

Add a new internal async function that pre-scans all suites and builds the agent name map:

```ts
/**
 * Pre-scan all suites and build a cross-suite agent name map.
 *
 * For each persona across all configured suites, creates a context variable:
 *   key:   `agent_` + slug (hyphens → underscores)
 *   value: `"<name> v<version>"`
 *
 * Slug is taken from the persona YAML's `slug` field, falling back to the
 * filename stem. Version falls back to the suite's `default_version`, then
 * to `'0.0.0'`.
 *
 * @param config  Top-level BuildConfig with all suite definitions
 * @returns       Map of agent variable keys to display strings
 */
async function buildAgentNameMap(
  config: BuildConfig,
): Promise<Record<string, string>> {
  const agentMap: Record<string, string> = {};

  for (const [, suiteConfig] of Object.entries(config.suites)) {
    // Load _shared.yaml for default_version fallback
    const metaSubdir = suiteConfig.metaSubdir ?? 'meta';
    const sharedYamlPath = path.join(suiteConfig.srcDir, metaSubdir, '_shared.yaml');
    const sharedMeta = await loadRawYaml(sharedYamlPath);
    const defaultVersion =
      typeof sharedMeta['default_version'] === 'string'
        ? sharedMeta['default_version']
        : '0.0.0';

    // Discover all persona YAMLs in this suite
    const personaYamls = await discoverSuitePersonaYamls(suiteConfig);

    for (const yamlPath of personaYamls) {
      const persona = await loadPersonaYaml(yamlPath);

      const slug =
        typeof persona['slug'] === 'string'
          ? persona['slug']
          : path.basename(yamlPath, '.yaml');

      const name =
        typeof persona['name'] === 'string'
          ? persona['name']
          : slug;

      const version =
        typeof persona['version'] === 'string'
          ? persona['version']
          : defaultVersion;

      const key = `agent_${slug.replace(/-/g, '_')}`;
      agentMap[key] = `${name} v${version}`;
    }
  }

  return agentMap;
}
```

### Step 2: Thread `agentMap` through `build()` → `buildSuite()` → `buildPersona()`

**2a.** In `build()`, call `buildAgentNameMap()` before the suite iteration loop, and pass it to `buildSuite()`:

```ts
export async function build(config: BuildConfig): Promise<BuildSummary> {
  const plugins = config.plugins ?? [];
  const targets = config.targets ?? ['vscode', 'claude-code'];
  const allResults: BuildResult[] = [];

  // Pre-scan: build cross-suite agent name map
  const agentMap = await buildAgentNameMap(config);

  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    for (const target of targets) {
      const suiteResults = await buildSuite(
        suiteName, suiteConfig, config, plugins, target, agentMap,
      );
      allResults.push(...suiteResults);
    }
  }
  // … rest unchanged …
}
```

**2b.** In `buildSuite()`, add an `agentMap` parameter (default `{}`) and pass it to `buildPersona()`:

```ts
export async function buildSuite(
  suiteName: string,
  suiteConfig: SuiteConfig,
  config: BuildConfig,
  plugins: PersonaBuildPlugin[],
  target: 'vscode' | 'claude-code',
  agentMap: Record<string, string> = {},
): Promise<BuildResult[]> {
  // … existing steps 1–4 unchanged …

  // Step 5: Build each persona — pass agentMap
  const results: BuildResult[] = [];
  for (const yamlPath of personaYamlPaths) {
    const result = await buildPersona(
      yamlPath, suiteName, suiteConfig, sharedMeta, partialsMap,
      config, plugins, target, agentMap,
    );
    results.push(result);
  }
  return results;
}
```

**2c.** In `buildPersona()`, add an `agentMap` parameter (default `{}`) and pass it to `buildContext()`:

```ts
export async function buildPersona(
  personaYamlPath: string,
  suiteName: string,
  suiteConfig: SuiteConfig,
  sharedMeta: Record<string, unknown>,
  partialsMap: Record<string, string>,
  config: BuildConfig,
  plugins: PersonaBuildPlugin[],
  target: 'vscode' | 'claude-code',
  agentMap: Record<string, string> = {},
): Promise<BuildResult> {
  // Step 1: Load persona metadata
  const personaMeta = await loadPersonaYaml(personaYamlPath);

  // Step 2: Build merged context — pass agentMap
  let context = buildContext(personaMeta, sharedMeta, agentMap);

  // … rest unchanged …
}
```

### Step 3: Inject agent map in `buildContext()`

Add an optional `agentMap` parameter and merge its entries into the context (only for keys not already present):

```ts
function buildContext(
  personaMeta: Record<string, unknown>,
  sharedMeta: Record<string, unknown>,
  agentMap: Record<string, string> = {},
): Record<string, unknown> {
  // … existing merge logic (version, spread, tools_json, etc.) …

  // ── Cross-suite agent name variables ──────────────────────────────────────
  for (const [key, value] of Object.entries(agentMap)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}
```

### Step 4: Add tests

**4a.** Create a new test file `tests/builders/agent-name-map.test.ts` with unit tests for:

- `buildAgentNameMap()` — verify it scans all suites and builds correct keys/values
- Slug fallback to filename stem when `slug` field is absent
- Version fallback to `default_version` when `version` field is absent
- Hyphens in slug correctly replaced by underscores in key

**4b.** Add integration test in `tests/integration/build.test.ts`:

- Set up a two-suite config fixture where suite A's content template references `{{agent_<slug>}}` from suite B
- Verify the variable resolves correctly in the generated output
- Verify no `[WARN] Unresolved variable` warnings

**Test fixture structure** (create in a temp directory per test):

```
suite-a/
  meta/_shared.yaml       (default_version: "1.0.0")
  meta/consumer.yaml      (slug: consumer, name: Consumer)
  content/consumer.md     (contains: "Invoke {{agent_helper}}")
suite-b/
  meta/_shared.yaml       (default_version: "2.0.0")
  meta/helper.yaml        (slug: helper, name: Helper, version: "2.0.0")
  content/helper.md       (body text)
```

Expected: `consumer.md` output → `"Invoke Helper v2.0.0"`.

### Step 5: Update manifest documentation

**5a.** In `ai-persona-builder-STABLE`, update `docs/agents/project-manifest/api-surface.md`:

- Add `{{agent_<slug>}}` to the Computed Variables table
- Document the key derivation convention and version fallback chain

**5b.** In `ai-persona-builder-STABLE`, update `docs/agents/project-manifest/data-flows.md`:

- Document the pre-scan phase in the build pipeline diagram

**5c.** In `ai-insights-dev`, update `personas/docs/agents/project-manifest/api-surface.md`:

- Update the `{{agent_<slug>}}` row to note this is now a library feature (not plugin-computed)
- Remove the reference to `getStandaloneAgentNames()` (no longer needed)

### Step 6: Verify the ai-insights persona build

```bash
cd /path/to/ai-insights-dev
npx persona-build --config personas/persona-build.config.js
```

Confirm zero `[WARN] Unresolved variable: {{agent_*}}` warnings.

## Dependencies

- No new dependencies in either workspace.
- The library continues to use only `js-yaml` (already a production dependency).

## Required Components

### ai-persona-builder-STABLE (library)

- `src/builders/persona-builder.ts` ← modified (new `buildAgentNameMap()` function; updated signatures for `build()`, `buildSuite()`, `buildPersona()`, `buildContext()`)
- `tests/builders/agent-name-map.test.ts` ← **NEW** test file
- `tests/integration/build.test.ts` ← modified (new cross-suite variable test)
- `docs/agents/project-manifest/api-surface.md` ← modified (document feature)
- `docs/agents/project-manifest/data-flows.md` ← modified (document pre-scan phase)

### ai-insights-dev (consumer)

- `personas/docs/agents/project-manifest/api-surface.md` ← modified (update computed variable docs)

## Assumptions

- Every persona YAML either has a `slug` field or derives a usable slug from its filename stem.
- The variable naming convention (`agent_` + slug with `-` → `_`) remains stable.
- The `name` field in persona YAMLs represents the human-readable display name.
- No persona YAML file will have a YAML field whose key starts with `agent_` — if it does, it takes precedence over the computed value (by design).

## Constraints

- The engine layer (`src/engine/`) must not be modified — it remains zero-dependency (per library constraint #1).
- The new `buildAgentNameMap()` function belongs in `src/builders/` since it performs filesystem I/O.
- The `buildSuite()` and `buildPersona()` public signatures change (new optional parameter). This is backwards-compatible — omitting the parameter defaults to `{}`.
- Plugin hooks remain synchronous (per library constraint #2); the pre-scan happens in the async `build()` function before plugins are invoked.

## Out of Scope

- Opt-out mechanism (skip agent map computation). Not needed — the feature is zero-config and harmless.
- Filtering which suites contribute to or consume the agent map. All suites participate symmetrically.
- Cross-referencing by fields other than slug (e.g. by `role` or `id`). The `slug`-based convention is sufficient.
- Changes to the ledger plugin — the plugin no longer needs to handle this concern.

## Acceptance Criteria

- The library's `build()` function, when given a multi-suite config, automatically makes `{{agent_<slug>}}` variables available in all persona contexts.
- Existing single-suite configurations continue to work without any changes (the map is populated but may not be referenced).
- The ai-insights persona build produces **zero** `Unresolved variable: {{agent_*}}` warnings.
- The six affected variables resolve correctly:
  - `{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.0"`
  - `{{agent_dependency_sequencer}}` → `"Dependency Sequencer v1.0.0"`
  - `{{agent_pipeline_configurator}}` → `"Pipeline Configurator v1.0.0"`
  - `{{agent_ledger_bootstrapper}}` → `"Ledger Bootstrapper v1.0.0"`
  - `{{agent_changelog_curator}}` → `"Changelog Curator v1.1.1"`
  - `{{agent_ctx_architect}}` → `"CTX Architect v1.1.0"`
- All existing library tests pass unchanged.
- New tests cover: agent map construction, slug fallback, version fallback, cross-suite variable resolution in rendered output.
- `buildPersona()` and `buildSuite()` remain callable without the new parameter (default `{}`).

## Testing Strategy

### Unit tests (`tests/builders/agent-name-map.test.ts`)

- **Happy path:** Two-suite config → verify all `agent_*` keys and values in the returned map.
- **Slug fallback:** Persona YAML without `slug` field → key derived from filename stem.
- **Version fallback:** Persona YAML without `version` → falls back to `default_version` from `_shared.yaml`.
- **Double fallback:** Neither persona `version` nor `default_version` → falls back to `'0.0.0'`.
- **Hyphen replacement:** Slug `"my-great-agent"` → key `agent_my_great_agent`.
- **Skip incomplete:** Persona YAML with no `name` and no filename-derivable name → entry still created using filename stem.

### Integration tests (`tests/integration/build.test.ts`)

- **Cross-suite resolution:** Suite A template contains `{{agent_helper}}`; suite B defines a persona with slug `helper`. Verify rendered output contains the resolved name.
- **Self-suite resolution:** A persona in suite A references another persona in the same suite A via `{{agent_*}}`. Verify it resolves.
- **No-conflict:** Persona YAML explicitly defines a key `agent_helper` → the explicit value wins over the computed map.

### Consumer verification (ai-insights-dev)

- Run `npx persona-build --config personas/persona-build.config.js` and confirm zero agent variable warnings.
- Spot-check generated `personas/ledger/vs-code/2-pm.agent.md` and `personas/ledger/vs-code/7-release-engineer.agent.md`.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking change to `buildPersona()` / `buildSuite()` signatures** | New parameter has a default value (`{}`), making the change backwards-compatible. Existing callers are unaffected. |
| **Performance: double YAML reads (pre-scan + build)** | Acceptable — persona YAML files are small (< 1KB). The pre-scan reads each file once, and `buildPersona()` reads it again during the build. For typical projects (< 50 personas), overhead is negligible. |
| **Slug collision across suites** | Last suite wins (iteration order = `Object.entries` insertion order). Documented behavior. In practice, collisions are unlikely — suites tend to have distinct persona slugs. |
| **Persona YAML missing both `slug` and `name`** | Falls back to filename stem for both, which always exists. The entry is still created. |
| **Variable name collision with YAML metadata** | The `if (!(key in merged))` guard ensures explicit YAML fields always take precedence. |
| **New personas added later** | Automatically picked up — the pre-scan discovers all `*.yaml` files (excluding `_shared.yaml`) in each suite. |
