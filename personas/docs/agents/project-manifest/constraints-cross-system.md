# Constraints — Cross-System Dependencies

> **Scope:** Synchronization contracts between the personas build system and the MCP server, Agent Registry, and workflow manifest. Consult this document when working on integration points between sub-projects.
>
> See also: [Core Constraints](constraints.md) · [Build System Constraints](constraints-build-system.md)

---

## Runtime Synchronization

<a name="x1"></a>
1. **`KNOWN_ROLES` and `AGENT_ROLES` are both manifest-derived.** Both `scripts/sync-personas.js` → `KNOWN_ROLES` and `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` now derive their values at runtime from `shared/workflow-manifest.json`. There is no longer a manual sync contract between these two — they always agree by construction. Adding or renaming a role in the manifest propagates automatically. Persona YAML `role` fields still need to match manifest role names; `scripts/build-personas.js` validates this and emits advisory warnings on mismatch.

<a name="x2"></a>
2. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

<a name="x3"></a>
3. **`name-mapping.json` is generated from persona YAML metadata.** `scripts/build-personas.js` calls `generateNameMapping()` and `writeNameMapping()` from `scripts/lib/name-mapping.js` and writes `personas/name-mapping.json` after every real build (skipped in `--check`/`--dry-run` mode). The generator reads all three suites: the numbered ledger persona YAML files (`/^\d+-.*\.yaml$/`) in `personas/ledger/src/meta/` plus that directory's `_shared.yaml` (`default_version`, `default_model`, `default_model_slug`); every non-underscore YAML file in `personas/standalone/src/meta/` and `personas/ledger-support/src/meta/`, plus each suite's optional `_shared.yaml` for `default_model_slug`; and the model registry in `personas/model-registry/`. The file contains per-persona identity (`role`, `number`, `id`, `version`, `suite`), model data (`model`, `model_slug`, `cc_model`) and per-target agent name data (`vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`). It must be regenerated whenever persona YAML naming fields change (`role`, `number`, `id`, `name`, `version`, `changelog`, `cc_file_name`, `vs_file_name`, `da_file_name`, `model_slug`, or `default_version` / `default_model_slug` in a `_shared.yaml`), or when a persona is added, renamed or removed in any suite. The file is checked into Git — stale state is visible in Git diffs. Run `node scripts/build-personas.js` (without `--check`) to regenerate.

<a name="x4"></a>
4. **`subagents` field in ledger persona YAML is consumed by the orchestrator's `load_subagents()`.** The optional `subagents` field (type: `string[]`, flat dash-prefixed block list) in a ledger persona YAML (`personas/ledger/src/meta/N-name.yaml`) declares the kebab-case slugs of ledger-support (or standalone, for legacy slugs) personas this stage may delegate sub-tasks to. For each slug, `load_subagents()` in `orchestrator/src/utils/subagents.py` resolves:
   - **`description`** — from `personas/ledger-support/src/meta/{slug}.yaml` (falls back to `personas/standalone/src/meta/{slug}.yaml`)
   - **`system_prompt`** — from `personas/ledger-support/deep-agents/{slug}.md` (falls back to `personas/standalone/deep-agents/{slug}.md`)
   - **`name`** — the kebab-case slug itself

   The template engine silently ignores unknown YAML keys, so the `subagents` field has no effect on persona build output. It is not used by `scripts/build-personas.js` for rendering — only for the `{{agent_slug_*}}` cross-reference validation (see [Build System Constraint 9](constraints-build-system.md#b9)).

   **Sync contract:** Every slug declared in the `subagents` field must have a corresponding YAML file (with a `description` field) and a deep-agents file in either `personas/ledger-support/` or `personas/standalone/`. The resolver searches `ledger-support` first, then falls back to `standalone`. Missing files (in both suites) raise `FileNotFoundError`; a missing `description` raises `ValueError`. Currently only the Project Manager carries this field, listing its PM planning sub-agents (all in `ledger-support/`).
