# Constraints & Conventions

## Source Editing Rules

1. **Never edit generated files directly.** All persona files under `personas/ledger/vs-code/` and `personas/ledger/claude-code/` are auto-generated. All changes must be made in `personas/ledger/src/` and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/ledger/src/ -->` header as a guard.

2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

3. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or `--target vscode` / `--target claude-code` for a single target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--target vscode` or `--target claude-code` to deploy to a single IDE.

---

## Template Engine Limitations

4. **`{{else}}` blocks are supported.** Conditionals may include an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. When the flag is truthy, the content before `{{else}}` is kept; when falsy, the content after `{{else}}` is kept. Prefer `{{else}}` over computed inverse booleans.

5. **Nested `{{#if}}` blocks are not supported.** The template engine uses a single-pass regex that stops at the first `{{/if}}` encountered. Nesting `{{#if}}` inside another `{{#if}}` will silently produce incorrect output. Flatten nested conditions to separate top-level `{{#if}}` blocks or extract to partials.

6. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

7. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

8. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is and a `[WARN]` is emitted. This makes typos visible without causing a hard build failure.

---

## Naming & File Conventions

9. **Persona files follow the `N-name.md` pattern** (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–7) and determines pipeline ordering. This pattern applies to both output directories (`ledger/vs-code/`, `ledger/claude-code/`).

10. **`cc_name` is derived from `cc_file_name`.** The computed `cc_name` variable is `persona.cc_file_name.replace(/\.md$/, '')`, producing identifiers like `3-developer` or `2-project-manager`. This naming is required for Claude Code slash commands, which do not allow spaces. The `cc_file_name` YAML field (e.g., `2-project-manager.md`) is the authoritative source — `cc_name` always equals that filename without the `.md` extension.

11. **`cc_tools` in a per-persona YAML overrides `default_cc_tools` from `_shared.yaml`.** By default, all personas use the `default_cc_tools` array defined in `_shared.yaml`. To customise the tool list for a specific persona, add a `cc_tools` key to its YAML file — this takes precedence over the shared default. Personas omitting `cc_tools` automatically inherit `default_cc_tools`.

12. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

13. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

14. **Platform-specific partials use a `-vscode` / `-claude-code` suffix** (e.g., `handoff-block-vscode.md`, `handoff-block-claude-code.md`, `mcp-preflight-header-vscode.md`, `mcp-preflight-header-claude-code.md`). Content templates include them via a top-level `{{#if target_vscode}}…{{else}}…{{/if}}` conditional block — never inline platform-specific content directly in a content template.

15. **`7-synthesis.md` omits the handoff-block partial by design.** The Synthesis agent always prints its handoff block verbatim (never auto-handoffs), so its content template does not include `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`. This is intentional — do not add the partial to this template.

16. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

17. **`role` values must match `AGENT_ROLES`** in `mcp-server/src/utils/constants.ts`. The sync script's `KNOWN_ROLES` array mirrors this and must be kept in manual sync. Mismatched roles produce advisory warnings.

18. **`default_version` in `_shared.yaml` applies to all personas** unless overridden per-persona. Currently only Agent 1 (Planner) overrides the version (uses `1.3.0` while others use `3.4.0`).

19. **`mcp_server_name` in `_shared.yaml`** controls the MCP server reference everywhere in generated output. If the `.mcp.json` key changes, update this single field and rebuild.

---

## Sync Script Conventions

20. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

21. **Sync reads from explicit source directories.** `syncVSCode()` reads explicitly from `ledger/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`. All three copy to their respective target directories without recursively walking the whole `personas/` tree. When `--target claude-code` (or `--target all`) is used, both `syncClaudeCode()` and `syncStandaloneClaudeCode()` are called.

22. **Frontmatter validation is advisory.** `validateVSCodeFrontmatter()` checks `role`, `name`, and `vs_file_name` in VS Code personas. `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateStandaloneCCFrontmatter()` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone Claude Code personas. None of these functions block the sync — warnings are printed to console.

23. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files, and forwards the `--target` flag so the build step generates only the required output. There is no need to run build separately when syncing.

---

## Cross-System Dependencies

24. **`KNOWN_ROLES` ↔ `AGENT_ROLES`**: The sync script's `KNOWN_ROLES` constant must match `mcp-server/src/utils/constants.ts` → `AGENT_ROLES`. There is no automated validation between these two — it's a manual sync contract.

25. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

26. **`mcp_server_name` ↔ `.mcp.json`**: The `mcp_server_name` value in `_shared.yaml` must match the server key in the target project's `.mcp.json` file. Default is `central_pm`.

---

## Intentional Differences from Pre-Build Era

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

27. **AUTO-GENERATED header** added to every generated file.

28. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

29. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–7.

30. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.
