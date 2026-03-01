# Constraints & Conventions

## Source Editing Rules

1. **Never edit generated files directly.** All persona files in the following directories are auto-generated and must not be hand-edited:
   - `personas/ledger/vs-code/` and `personas/ledger/claude-code/`
   - `personas/standalone/vs-code/` and `personas/standalone/claude-code/`

   All changes must be made in the corresponding `src/` directory and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` header as a guard.

2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

3. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or add `--suite` to target a specific suite and `--target vscode` / `--target claude-code` for a single IDE target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--suite all` to rebuild both suites in one pass.

---

## Template Engine Limitations

4. **`{{else}}` blocks are supported.** Conditionals may include an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. When the flag is truthy, the content before `{{else}}` is kept; when falsy, the content after `{{else}}` is kept. Prefer `{{else}}` over computed inverse booleans.

5. **Nested `{{#if}}` blocks are not supported.** The template engine uses a single-pass regex that stops at the first `{{/if}}` encountered. Nesting `{{#if}}` inside another `{{#if}}` will silently produce incorrect output. Flatten nested conditions to separate top-level `{{#if}}` blocks or extract to partials.

6. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

7. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

8. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is and a `[WARN]` is emitted. This makes typos visible without causing a hard build failure.

9. **`--strict` mode converts unresolved markers into a hard failure.** When `--strict` is passed, a post-build scan runs on every generated file using the regex `/\{\{>?\s*[\w-]+\}\}/g`. If any markers remain, the script emits `[STRICT] Unresolved marker(s) in <suite>/<target>/<file>: <markers>` to stderr, increments a `strictFailures` counter, and exits with code 1 after the full build completes. The base build output (written files) is unaffected; `--strict` only controls the exit code. Use `node scripts/build-personas.js --strict --suite all` in CI pipelines or pre-commit hooks to gate on zero unresolved markers.

   > **GN-4 — Code-fence false-positive risk:** The `--strict` regex scans the full assembled text and would produce false positives if a template body contained literal `{{…}}` inside a Markdown fenced-code block. No current persona triggers this. Mitigation (if needed): strip fenced blocks before scanning.

   > **GN-5 — `--check` + `--strict` exit ordering:** When `--check` detects stale output files, `process.exit(1)` fires before `[STRICT]` scan output is emitted. The exit code remains 1 (correct). This is intentional. In CI, run `--check` as a separate pre-build step if `[STRICT]` failure details are needed.

---

## Naming & File Conventions

10. **Persona files follow the `N-name.md` pattern** (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–7) and determines pipeline ordering. This pattern applies to both output directories (`ledger/vs-code/`, `ledger/claude-code/`).

12. **Standalone YAML files are slug-based, not number-prefixed.** Standalone persona filenames match their `slug` field (e.g. `researcher.yaml`, `manifest-curator.yaml`). The `slug` must be a valid kebab-case identifier with no numeric prefix.

13. **Standalone `vs_file_name` uses the `.agent.md` extension** (e.g. `researcher.agent.md`). This convention was established in WP-004 and is now the authoritative standard for all standalone VS Code personas. The output file on disk is named by the `vs_file_name` value (e.g. `researcher.agent.md`), not by the slug. Standalone Claude Code output uses plain `.md` (e.g. `researcher.md`), derived from `cc_file_name`.

14. **`cc_name` is derived from `cc_file_name`.** The computed `cc_name` variable is `persona.cc_file_name.replace(/\.md$/, '')`, producing identifiers like `3-developer` or `2-project-manager`. This naming is required for Claude Code slash commands, which do not allow spaces. The `cc_file_name` YAML field (e.g., `2-project-manager.md`) is the authoritative source — `cc_name` always equals that filename without the `.md` extension.

15. **`cc_tools` in a per-persona YAML overrides `default_cc_tools` from `_shared.yaml`.** By default, all personas use the `default_cc_tools` array defined in `_shared.yaml`. To customise the tool list for a specific persona, add a `cc_tools` key to its YAML file — this takes precedence over the shared default. Personas omitting `cc_tools` automatically inherit `default_cc_tools`.

16. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

17. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

18. **Shared vs. suite-local partials.** The build system loads partials in two layers:
  - **Base layer** (`personas/shared/partials/`): suite-agnostic fragments reusable by all suites (ledger, standalone). Never include MCP-specific content here.
  - **Override layer** (`personas/<suite>/src/partials/`): suite-specific fragments. Same-named entries silently shadow their shared counterpart. All MCP-workflow partials (`mcp-*`, `role-boundaries`, `handoff-block-*`, `incident-logging`) live here.
  
  When building the standalone suite, a partial referenced by a shared partial but only defined in the ledger override layer (e.g., `{{> incident-logging}}`) will produce a `[WARN]` and be left as-is unless a stub is added to `shared/partials/`.

21. **Standalone `_shared.yaml` must not contain `mcp_server_name` or `roster`.** Standalone personas are independent tools — they have no workflow roster and no MCP server dependency. Do not add these fields when extending the standalone suite.

22. **Platform-specific partials use a `-vscode` / `-claude-code` suffix** (e.g., `handoff-block-vscode.md`, `handoff-block-claude-code.md`, `mcp-preflight-header-vscode.md`, `mcp-preflight-header-claude-code.md`). Content templates include them via a top-level `{{#if target_vscode}}…{{else}}…{{/if}}` conditional block — never inline platform-specific content directly in a content template.

23. **`7-synthesis.md` omits the handoff-block partial by design.** The Synthesis agent always prints its handoff block verbatim (never auto-handoffs), so its content template does not include `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`. This is intentional — do not add the partial to this template.

24. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

25. **`role` values must match `AGENT_ROLES`** in `mcp-server/src/utils/constants.ts`. The sync script's `KNOWN_ROLES` array mirrors this and must be kept in manual sync. Mismatched roles produce advisory warnings.

26. **`default_version` in `_shared.yaml` applies to all personas** unless overridden per-persona. Currently only Agent 1 (Planner) overrides the version (uses `1.3.0` while others use `3.4.0`).

27. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — `buildForTarget()` emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

28. **`mcp_server_name` in `_shared.yaml`** controls the MCP server reference everywhere in generated output. If the `.mcp.json` key changes, update this single field and rebuild.

---

## Sync Script Conventions

29. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

30. **Sync reads from explicit source directories.** `syncVSCode()` reads from `ledger/vs-code/`; `syncStandaloneVSCode()` reads from `standalone/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`. All four copy to their respective target directories without recursively walking the whole `personas/` tree. When `--target vscode` (or `--target all`) is used, both `syncVSCode()` and `syncStandaloneVSCode()` are called. When `--target claude-code` (or `--target all`) is used, both `syncClaudeCode()` and `syncStandaloneClaudeCode()` are called.

31. **Frontmatter validation is advisory.** checks `role`, `name`, and `vs_file_name` in ledger VS Code personas. `validateStandaloneVSCodeFrontmatter()` checks `name` and `vs_file_name` in standalone VS Code personas (no `role` required). `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateStandaloneCCFrontmatter()` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone Claude Code personas. None of these functions block the sync — warnings are printed to console.

32. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files, and forwards the `--target` flag so the build step generates only the required output. There is no need to run build separately when syncing.

---

## Cross-System Dependencies

32b. **`note_only: true` on `mcp_tools` entries excludes them from the rendered tools table.** When an `mcp_tools` entry in a per-persona YAML file has `note_only: true`, the `renderMcpToolsTable()` function filters it out (using `.filter(t => !t.note_only)`) before building the Markdown table. The entry is still present in the YAML source and the tool remains functionally accessible to the agent, but it is not listed as a table row in generated output. Use this flag for tools that agents should be aware of via prose content (e.g., in a `mcp-tools-note.md` partial) but that are not primary workflow tools for that role. Entries without `note_only` are unaffected — `undefined` is falsy and passes the filter without change.

32c. **`--check` mode asserts that `note_only: true` tools are absent from generated output.** Running `node scripts/build-personas.js --check` performs two validations per file: (1) the generated content matches the file on disk (staleness check), and (2) no tool entry marked `note_only: true` in the persona's `mcp_tools` YAML appears as a rendered table row (`| \`toolName\` |`) in the generated output. Violations increment `staleCount` and are printed to stderr with prefix `[note_only-violation]`. If any violation is found the process exits with code 1. This guard prevents a regression where the `.filter(t => !t.note_only)` line in `renderMcpToolsTable()` is accidentally removed — which would silently surface internal-only tooling in published persona documents.

33. **`KNOWN_ROLES` ↔ `AGENT_ROLES`**: The sync script's `KNOWN_ROLES` constant must match `mcp-server/src/utils/constants.ts` → `AGENT_ROLES`. There is no automated validation between these two — it's a manual sync contract.

34. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

35. **`mcp_server_name` ↔ `.mcp.json`**: The `mcp_server_name` value in `_shared.yaml` must match the server key in the target project's `.mcp.json` file. Default is `central_pm`.

---

## Intentional Differences from Pre-Build Era

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

36. **AUTO-GENERATED header** added to every generated file.

37. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

39. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–7.

40. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.
