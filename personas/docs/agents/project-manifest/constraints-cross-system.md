# Constraints — Cross-System Dependencies

> **Scope:** Synchronization contracts between the personas build system and the MCP server, Agent Registry, and workflow manifest. Consult this document when working on integration points between sub-projects.
>
> See also: [Core Constraints](constraints.md) · [Build System Constraints](constraints-build-system.md)

---

## Runtime Synchronization

<a name="c36"></a>
<a name="x1"></a>
1. **`KNOWN_ROLES` and `AGENT_ROLES` are both manifest-derived.** Both `scripts/sync-personas.js` → `KNOWN_ROLES` and `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` now derive their values at runtime from `shared/workflow-manifest.json`. There is no longer a manual sync contract between these two — they always agree by construction. Adding or renaming a role in the manifest propagates automatically. Persona YAML `role` fields still need to match manifest role names; `scripts/build-personas.js` validates this and emits advisory warnings on mismatch.

<a name="c37"></a>
<a name="x2"></a>
2. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

<a name="c38"></a>
<a name="x3"></a>
3. **`name-mapping.json` is generated from persona YAML metadata.** `scripts/build-personas.js` reads all 9 ledger persona YAML files in `personas/ledger/src/meta/` (plus `_shared.yaml` for `default_version`) and writes `personas/name-mapping.json` after every real build (skipped in `--check`/`--dry-run` mode). The file contains per-persona identity (`role`, `number`, `id`, `version`) and per-target agent name data (`vscode`, `claude_code`, `deep_agents` — each with `file_name` and `agent_name`). It must be regenerated whenever persona YAML naming fields change (`role`, `number`, `id`, `version`, `cc_file_name`, `vs_file_name`, `da_file_name`, or `default_version` in `_shared.yaml`). The file is checked into Git — stale state is visible in Git diffs. Run `node scripts/build-personas.js` (without `--check`) to regenerate.

<a name="c39"></a>
<a name="x4"></a>
4. **`subagents` field in ledger persona YAML is consumed by the orchestrator's `load_subagents()`.** The optional `subagents` field (type: `string[]`, flat dash-prefixed block list) in a ledger persona YAML (`personas/ledger/src/meta/N-name.yaml`) declares the kebab-case slugs of standalone personas this stage may delegate sub-tasks to. For each slug, `load_subagents()` in `orchestrator/src/utils/subagents.py` resolves:
   - **`description`** — from `personas/standalone/src/meta/{slug}.yaml`
   - **`system_prompt`** — from `personas/standalone/deep-agents/{slug}.md`
   - **`name`** — the kebab-case slug itself

   The template engine silently ignores unknown YAML keys, so the `subagents` field has no effect on persona build output. It is not used by `scripts/build-personas.js` for rendering — only for the `{{agent_slug_*}}` cross-reference validation (see [Build System Constraint 9](constraints-build-system.md#b9)).

   **Sync contract:** Every slug declared in the `subagents` field must have a corresponding `personas/standalone/src/meta/{slug}.yaml` (with a `description` field) and a `personas/standalone/deep-agents/{slug}.md` that are valid at orchestrator startup. Missing files raise `FileNotFoundError`; a missing `description` raises `ValueError`. Currently only Agent 2 (Project Manager) carries this field, listing four PM planning sub-agents.

---

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

<a name="c41"></a>
<a name="x3"></a>
3. **AUTO-GENERATED header** added to every generated file.

<a name="c42"></a>
<a name="x4"></a>
4. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

<a name="c43"></a>
<a name="x5"></a>
5. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–9.

<a name="c44"></a>
<a name="x6"></a>
6. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.
