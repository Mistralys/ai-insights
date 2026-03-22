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

---

## Intentional Differences from Pre-Build Era

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
