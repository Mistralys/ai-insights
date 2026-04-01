## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `buildAgentNameMap()` function to `src/builders/persona-builder.ts` that pre-scans all suites, loads each persona's slug/name/version, and assembles a `Record<string, string>` map of `agent_*` context variables.
- Threaded the `agentMap` through `build()` → `buildSuite()` → `buildPersona()` → `buildContext()` as an optional parameter with `{}` default for backwards compatibility.
- In `buildContext()`, agent map entries are injected into the merged context only when a key is not already present — explicit YAML fields always win.
- The six previously unresolved variables now resolve correctly in the ai-insights persona build:
  - `{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.0"`
  - `{{agent_dependency_sequencer}}` → `"Dependency Sequencer v1.0.0"`
  - `{{agent_pipeline_configurator}}` → `"Pipeline Configurator v1.0.0"`
  - `{{agent_ledger_bootstrapper}}` → `"Ledger Bootstrapper v1.0.0"`
  - `{{agent_changelog_curator}}` → `"Changelog Curator v1.1.1"`
  - `{{agent_ctx_architect}}` → `"CTX Architect v1.1.0"`

### Documentation Updates
- `ai-persona-builder-STABLE/docs/agents/project-manifest/data-flows.md` — Added the pre-scan phase to the build pipeline diagram, added `agent_<slug>` to the derived fields table, updated context merge order to include cross-suite agent name map as step 4, updated function signatures in the diagram.
- `ai-persona-builder-STABLE/docs/agents/project-manifest/api-surface.md` — Updated `buildSuite()` and `buildPersona()` signatures to show the new optional `agentMap` parameter, updated `build()` description to mention the pre-scan phase.
- `ai-insights-dev/personas/docs/agents/project-manifest/api-surface.md` — Updated `{{agent_<slug>}}` computed variable row to reflect that this is now a library-level feature (not plugin-computed), available in all suites (not just ledger), and removed the reference to `getStandaloneAgentNames()`.

### Verification Summary
- Tests run: Full Vitest suite — 236 tests across 15 test files (including 7 new agent-name-map tests + 1 new integration test)
- Static analysis run: `tsc --noEmit` — zero type errors
- Consumer verification: `npx persona-build --config personas/persona-build.config.js --check --strict` — 54 personas processed, zero warnings, zero errors
- Result: All pass

### Code Insights
- [low] (improvement) `tests/builders/agent-name-map.test.ts`: The test fixtures intentionally omit `description` fields, causing `[WARN] Unresolved variable: {{description}}` on stderr. This is harmless but could be suppressed by adding a `description` field to the test YAML or by adding a description placeholder to the content templates. Not worth fixing — keeping test fixtures minimal is preferred. **DONE**.
- [low] (debt) `src/builders/persona-builder.ts`: The pre-scan reads persona YAML files once during `buildAgentNameMap()`, and `buildPersona()` reads each file again. For projects with <50 personas, overhead is negligible. A caching layer could avoid the double reads but would add complexity without measurable benefit at current scale. **ACKNOWLEDGED**.
- [low] (convention) `ai-insights-dev/personas/plugins/ledger/index.js`: The ledger plugin's `onBuildContext` hook computes several derived fields (roster_rendered, cc_description, model fallbacks). With agent_* variables now handled at the library level, the remaining plugin concern is purely ledger-specific (roster, MCP tools). The code is clean and well-separated — no action needed. **ACKNOWLEDGED**.

### Additional Comments
- The `buildSuite()` and `buildPersona()` public API signatures gained a new optional parameter. This is backwards-compatible — existing callers that don't pass `agentMap` get the `{}` default.
- The library was rebuilt (`npm run build`) to produce updated `dist/` output, which the symlinked ai-insights-dev workspace picks up automatically.
