# Constraints & Conventions

## Source Editing Rules

1. **Never edit generated files directly.** The 7 persona files in `personas/ledger/` (e.g., `3-developer.md`) are auto-generated. All changes must be made in `personas/ledger/src/` and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/ledger/src/ -->` header as a guard.

2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

3. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` to regenerate output, then `node scripts/sync-personas.js` to deploy to VS Code.

---

## Template Engine Limitations

4. **No `{{else}}` blocks.** The conditional system only supports `{{#if flag}}…{{/if}}`. To handle the inverse case, use a separate `{{#if inverse_flag}}` block with a computed inverse boolean (e.g., `no_detect_project` = `!has_detect_project`).

5. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

6. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

7. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is and a `[WARN]` is emitted. This makes typos visible without causing a hard build failure.

---

## Naming & File Conventions

8. **Persona files follow the `N-name.md` pattern** (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–7) and determines pipeline ordering.

9. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

10. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

11. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

12. **`role` values must match `AGENT_ROLES`** in `mcp-server/src/utils/constants.ts`. The sync script's `KNOWN_ROLES` array mirrors this and must be kept in manual sync. Mismatched roles produce advisory warnings.

13. **`default_version` in `_shared.yaml` applies to all personas** unless overridden per-persona. Currently only Agent 1 (Planner) overrides the version (uses `1.3.0` while others use `3.4.0`).

14. **`mcp_server_name` in `_shared.yaml`** controls the MCP server reference everywhere in generated output. If the `.mcp.json` key changes, update this single field and rebuild.

---

## Sync Script Conventions

15. **`vs_file_name` is required for sync.** Files without a `vs_file_name` field in frontmatter are silently skipped during sync. This excludes `README.md` and any non-persona files.

16. **Sync processes ALL persona directories** — `ledger/`, `vanilla/`, and `standalone/` — not just ledger. The `src/` directory under `ledger/` is explicitly excluded from the file walk.

17. **Frontmatter validation is advisory.** The `validateLedgerFrontmatter()` step checks that ledger personas have valid `role` and `name` fields but never blocks the sync. Warnings are printed to console.

18. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files. There is no need to run build separately when syncing.

---

## Cross-System Dependencies

19. **`KNOWN_ROLES` ↔ `AGENT_ROLES`**: The sync script's `KNOWN_ROLES` constant must match `mcp-server/src/utils/constants.ts` → `AGENT_ROLES`. There is no automated validation between these two — it's a manual sync contract.

20. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

21. **`mcp_server_name` ↔ `.mcp.json`**: The `mcp_server_name` value in `_shared.yaml` must match the server key in the target project's `.mcp.json` file. Default is `central_pm`.

---

## Intentional Differences from Pre-Build Era

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

22. **AUTO-GENERATED header** added to every generated file.

23. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

24. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–7.

25. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.
