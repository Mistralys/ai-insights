# Research Report

## Problem Statement

The `personas/standalone/` suite currently contains **28 personas** with mixed purposes: some are **ledger-workflow utilities** (e.g. Ledger Bootstrapper, Ledger Doctor, Ledger WP Decomposer) that depend on the `central_pm` MCP server and are invoked as subagents by the ledger pipeline, while others are **general-purpose standalone agents** (e.g. Researcher, Planner, README Curator) with no ledger dependency. The question is whether to separate ledger-related standalone personas into a dedicated folder, and whether the persona builder library (`@mistralys/persona-builder`) needs changes to support this.

## Problem Decomposition

1. **Identification:** Which standalone personas are "ledger-related" and should move?
2. **Persona builder capability:** Can the builder already handle a third suite, or does it need changes?
3. **Consumer impact:** What downstream scripts and systems hardcode the `standalone/` path and would need updating?
4. **Naming and identity:** How should the new suite be named, and what happens to persona slugs, IDs, and filenames?
5. **Cross-suite references:** How do subagent references (`subagents:` field) and the orchestrator resolve across suites?

## Context & Constraints

- The persona builder library supports an arbitrary number of suites via the `suites` map in `BuildConfig`. Adding a third suite is a **config-level change** — no library code needs modification.
- Cross-suite agent name map (`agent_*` / `agent_slug_*` template variables) is built from **all** configured suites in the pre-scan phase, so moving personas between suites does not break cross-references.
- The orchestrator's `subagents.py` hardcodes `personas/standalone/src/meta/` and `personas/standalone/deep-agents/` as the lookup paths for subagent metadata and system prompts.
- `scripts/sync-personas.js` hardcodes `personas/standalone/vs-code/` and `personas/standalone/claude-code/` as source directories for deployment.
- `scripts/build-personas.js` iterates suite output dirs from the config for pre-build cleanup, so it is already config-driven.
- `personas/name-mapping.json` is regenerated from the build config and only contains ledger suite data (numbered personas), not standalone.
- Several manifest/documentation files reference the `standalone/` directory layout.

## Prior Art & Known Patterns

### Pattern 1: Third Suite in Build Config (Config-Only Change)

- **Description:** Add a third suite entry (e.g. `ledger-standalone` or `ledger-tools`) to `persona-build.config.js`. The new suite gets its own `srcDir` (`personas/ledger-tools/src/`), output directories (`personas/ledger-tools/vs-code/`, etc.), and `personaMode: 'standalone'`. Move the ~9 ledger-related YAML/content files from `standalone/src/` to the new suite's `src/`.
- **Where used:** The persona builder already supports this — the `suites` map accepts any number of entries. The existing `ledger` + `standalone` split is purely a config choice.
- **Strengths:** Clean separation. No library changes. Each suite has its own `_shared.yaml` so ledger-tools can carry `mcp_server_name: central_pm` as a shared default instead of per-persona. Build/check commands work immediately.
- **Weaknesses:** Every downstream consumer that hardcodes `standalone/` paths must be updated. The orchestrator subagent loader must know to look in the new suite's directory. Sync scripts need a third sync function or generalization. Documentation updates are significant.
- **Fit:** Excellent — this is the natural, fully supported approach.

### Pattern 2: Subdirectories Within the Existing Suite

- **Description:** Keep a single `standalone` suite but organize source files into subdirectories like `standalone/src/meta/ledger/` and `standalone/src/content/ledger/`. This would require the persona builder to scan subdirectories recursively.
- **Where used:** Not currently supported. The `discoverSuitePersonaYamls()` function reads only the top-level `meta/` directory with `readdir()` (no recursion).
- **Strengths:** Minimal downstream impact — all paths remain `standalone/`. Visual organization in the source tree.
- **Weaknesses:** Requires a persona builder change to support recursive YAML discovery. Output directories would still be flat (all standalone output mixed together). Doesn't address the real concern — the output is still a single flat set of files. The content/meta basename-matching constraint (C16) becomes harder to enforce across subdirs.
- **Fit:** Poor — adds complexity to the library for marginal benefit.

### Pattern 3: Naming Convention Only (No Structural Change)

- **Description:** Keep everything in `standalone/` but rely on the existing `ledger-` prefix convention to distinguish ledger-related personas. Add metadata (e.g. a `category: ledger` field) for programmatic filtering.
- **Where used:** The current state already uses this prefix convention informally.
- **Strengths:** Zero changes needed anywhere. Already works today.
- **Weaknesses:** Doesn't solve the organizational concern that motivated the question. The `standalone/` suite grows unbounded. No structural boundary prevents non-ledger personas from accidentally depending on MCP tools.
- **Fit:** Acceptable as status quo, but doesn't address the underlying goal.

## Alternative & Creative Approaches

### Hybrid: Third Suite + Generalized Sync Script

Combine Pattern 1 with a refactoring of `sync-personas.js` to iterate suite output directories from the build config rather than hardcoding paths per suite. This makes the sync script future-proof — adding a fourth suite later would require zero sync script changes.

- **Rationale:** The sync script currently has dedicated functions per suite (`syncStandaloneVSCode`, `syncStandaloneClaudeCode`). A config-driven approach would iterate `Object.entries(config.suites)` and sync each suite's output dirs automatically.
- **Risk:** The sync script's validation logic differs between ledger and standalone suites (role field requirements). A generalized approach must preserve per-suite validation rules, probably via `personaMode` branching.

### Hybrid: Third Suite + Orchestrator Path Resolution from Manifest

Instead of hardcoding paths in the orchestrator's `subagents.py`, derive the subagent source paths from the workflow manifest or a dedicated mapping file. The manifest already carries `persona_file_deep_agents` per role — a similar field for standalone subagents could eliminate hardcoded paths entirely.

- **Rationale:** Currently the orchestrator assumes all subagents live in `standalone/`. If subagents can live in multiple suites, the path resolution needs to become data-driven.
- **Risk:** Adds a new cross-system dependency. Over-engineering for the current scale (~4 subagent declarations across 3 ledger personas).

## Comparative Evaluation

| Criterion | Pattern 1: Third Suite | Pattern 2: Subdirs | Pattern 3: Convention | Hybrid (Suite + Gen. Sync) |
|---|---|---|---|---|
| **Complexity** | Low (config change) | Medium (library change) | None | Medium (sync refactor) |
| **Library changes needed** | None | Yes — recursive discovery | None | None |
| **Downstream consumer updates** | 4–5 files | 1–2 files | None | 3–4 files (fewer if sync generalized) |
| **Separation quality** | Full — distinct source + output | Partial — source only | None | Full |
| **Future-proofing** | Good | Moderate | Poor | Excellent |
| **Risk** | Low | Medium | None | Low–Medium |
| **Time to implement** | Small | Medium | None | Medium |

## Recommendation

**Pattern 1 (Third Suite) is the clear winner.** It requires **no changes to the persona builder library** — the multi-suite architecture already supports it fully. The work is entirely on the ai-insights side:

### What Needs to Change

1. **`personas/persona-build.config.js`** — Add a third suite entry (e.g. `'ledger-tools'`):
   ```js
   'ledger-tools': {
     srcDir:        path.join(ROOT, 'personas', 'ledger-tools', 'src'),
     outVscode:     path.join(ROOT, 'personas', 'ledger-tools', 'vs-code'),
     outClaudeCode: path.join(ROOT, 'personas', 'ledger-tools', 'claude-code'),
     outputDirs: {
       'deep-agents': path.join(ROOT, 'personas', 'ledger-tools', 'deep-agents'),
     },
     personaMode: 'standalone',  // same mode — slug-based, no role field
   },
   ```

2. **Move source files** — Move the ~9 ledger-related YAML + content files from `standalone/src/` to `ledger-tools/src/`. Create a `_shared.yaml` for the new suite with `mcp_server_name: central_pm` as a shared default.

3. **`scripts/sync-personas.js`** — Add sync + validation functions for the new suite, or (better) generalize the sync logic to iterate suites from the config.

4. **`orchestrator/src/utils/subagents.py`** — Update `_STANDALONE_META_RELATIVE` and `_STANDALONE_DEEP_AGENTS_RELATIVE` to also search `personas/ledger-tools/` (or make the path resolution data-driven based on which suite a slug belongs to).

5. **Documentation** — Update `AGENTS.md` (cross-system dependencies, directory layout), personas manifest `constraints.md` (directory layout table), `.context/` docs.

### What Does NOT Need to Change

- **`@mistralys/persona-builder` library** — No changes. The `suites` map, `buildSuite()`, `buildAgentNameMap()`, and all rendering logic already handle N suites.
- **`scripts/build-personas.js`** — Already config-driven (iterates `config.suites` for cleanup).
- **`personas/name-mapping.json`** — Only contains ledger (numbered) suite data.
- **Cross-suite `agent_*` template variables** — Automatically include all suites.
- **Subagent slug validation** — `validateSubagentRefs()` validates against the full cross-suite agent map.
- **Frontmatter templates** — Config-level defaults apply to all non-ledger suites.

### Ledger-Related Standalone Personas to Move

| Persona | Has `mcp_server_name` | Used as subagent |
|---------|----------------------|-----------------|
| `ledger-bootstrapper` | Yes | Yes (PM) |
| `ledger-claude-coordinator` | Yes | No |
| `ledger-dependency-sequencer` | No | Yes (PM) |
| `ledger-doctor` | Yes | No |
| `ledger-knowledge-archiver` | Yes | No |
| `ledger-knowledge-curator` | Yes | No |
| `ledger-orchestrator-runner` | No | No |
| `ledger-pipeline-configurator` | No | Yes (PM) |
| `ledger-wp-decomposer` | No | Yes (PM) |

All 9 share the `ledger-` prefix. The remaining 19 personas (Researcher, Planner, Manifest Curator, etc.) stay in `standalone/`.

### Naming Considerations

The new suite needs a name for:
- The config key (`suites['???']`)
- The directory (`personas/???/`)
- Log output and documentation

Options: `ledger-tools`, `ledger-standalone`, `ledger-utils`, `ledger-support`. **`ledger-tools`** is concise and clearly communicates "utility agents for the ledger workflow."

## Open Questions

- **Should `recipe-curator` move too?** It doesn't have the `ledger-` prefix but may have ledger affinity — needs content review.
- **Should the sync script be generalized now or later?** Pattern 1 works with a simple copy-paste of the sync functions; generalization is a nice-to-have that could be deferred.
- **Orchestrator path resolution strategy:** Should the orchestrator scan multiple suite directories by convention, or should a mapping file explicitly declare where each subagent slug lives? The simpler approach (scan a list of known directories) is sufficient at current scale.

## References

- `@mistralys/persona-builder` `BuildConfig.suites` type: [types.ts](../../ai-persona-builder/src/builders/types.ts)
- `SuiteConfig` interface: [types.ts](../../ai-persona-builder/src/plugins/types.ts)
- Current build config: [persona-build.config.js](../../personas/persona-build.config.js)
- `discoverSuitePersonaYamls()`: [persona-builder.ts](../../ai-persona-builder/src/builders/persona-builder.ts#L83)
- `buildAgentNameMap()` pre-scan: [persona-builder.ts](../../ai-persona-builder/src/builders/persona-builder.ts#L194)
- Orchestrator subagent loader: [subagents.py](../../orchestrator/src/utils/subagents.py)
- Sync script: [sync-personas.js](../../scripts/sync-personas.js)
