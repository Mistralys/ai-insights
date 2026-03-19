# Constraints & Conventions

## Source Editing Rules

<a name="c1"></a>
1. **Never edit generated files directly.** All persona files in the following directories are auto-generated and must not be hand-edited:
   - `personas/ledger/vs-code/` and `personas/ledger/claude-code/`
   - `personas/standalone/vs-code/` and `personas/standalone/claude-code/`

   All changes must be made in the corresponding `src/` directory and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` header as a guard.

<a name="c2"></a>
2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

<a name="c3"></a>
3. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or add `--suite` to target a specific suite and `--target vscode` / `--target claude-code` for a single IDE target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--suite all` to rebuild both suites in one pass.

---

## Persona Content Philosophy

<a name="c4"></a>
4. **Persona content must add value the self-documenting tools cannot provide.** The ledger's `next_steps` arrays, `--- NEXT STEP ---` guidance blocks, and Zod parameter descriptions are the runtime source of truth. A persona's job is to provide **identity, methodology, and decision-making framework** — not to duplicate tool documentation. When tool self-documentation already covers a behavior (e.g., wait-action reasons, required parameters), do not restate it in persona content. When persona content enumerates tool parameters or action names, it must match the implementation exactly or defer to the tool descriptions entirely.

---

## Template Engine Limitations

<a name="c5"></a>
5. **`{{else}}` blocks are supported.** Conditionals may include an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. When the flag is truthy, the content before `{{else}}` is kept; when falsy, the content after `{{else}}` is kept. Prefer `{{else}}` over computed inverse booleans.

<a name="c6"></a>
6. **Nested `{{#if}}` blocks are not supported.** The template engine uses a single-pass regex that stops at the first `{{/if}}` encountered. Nesting `{{#if}}` inside another `{{#if}}` will silently produce incorrect output. Flatten nested conditions to separate top-level `{{#if}}` blocks or extract to partials.

   **Anti-pattern:**
   ```
   {{#if platform_vscode}}
     {{#if feature_enabled}}
       Content for VS Code only when feature is on
     {{/if}}
   {{/if}}
   ```
   The inner `{{/if}}` terminates the outer block prematurely, leaving stray `{{/if}}` and `{{#if feature_enabled}}` markers in the output.

   **Correct pattern:**
   ```
   {{#if platform_vscode_and_feature}}
     Content for VS Code only when feature is on
   {{/if}}
   ```
   Pre-compute the compound boolean as a variable in the build script (or add it to `_shared.yaml`), then use a single top-level `{{#if}}` block.

<a name="c7"></a>
7. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

<a name="c8"></a>
8. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

<a name="c9"></a>
9. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is and a `[WARN]` is emitted. This makes typos visible without causing a hard build failure.

<a name="c10"></a>
10. **`--strict` mode converts unresolved markers into a hard failure.** When `--strict` is passed, a post-build scan runs on every generated file using the regex `/\{\{>?\s*[\w-]+\}\}/g`. If any markers remain, the script emits `[STRICT] Unresolved marker(s) in <suite>/<target>/<file>: <markers>` to stderr, increments a `strictFailures` counter, and exits with code 1 after the full build completes. The base build output (written files) is unaffected; `--strict` only controls the exit code. Use `node scripts/build-personas.js --strict --suite all` in CI pipelines or pre-commit hooks to gate on zero unresolved markers.

   > **GN-4 — Code-fence false-positive risk:** The `--strict` regex scans the full assembled text and would produce false positives if a template body contained literal `{{…}}` inside a Markdown fenced-code block. **Mitigation active (WP-002):** The build script strips fenced blocks (`/```[\s\S]*?```/g`) from a copy of the output before scanning, eliminating this false-positive risk.

   > **GN-5 — `--check` + `--strict` exit ordering:** When `--check` detects stale output files, `process.exit(1)` fires before `[STRICT]` scan output is emitted. The exit code remains 1 (correct). This is intentional. In CI, run `--check` as a separate pre-build step if `[STRICT]` failure details are needed.

---

## Log-Prefix Convention

The build script (`scripts/build-personas.js`) uses four bracket-prefixed severity levels for all console output. Use these prefixes consistently for any `console.log` / `console.error` calls added to the build script in the future.

| Prefix | Meaning | Example usage |
|--------|---------|---------------|
| `[info]` | Informational — runtime context, no action needed | Suite default announcement at startup |
| `[WARN]` | Warning — recoverable issue, output may still be valid | Unresolved template markers (non-strict mode) |
| `[STRICT]` | Strict-mode failure — gates CI exit code | Unresolved markers when `--strict` is active |
| `[ERROR]` | Fatal — build cannot continue | Missing content file, invalid YAML |

---

## Naming & File Conventions

<a name="c11"></a>
11. **Ledger persona output filenames differ by IDE target.** VS Code target files use `N-name.agent.md` (e.g., `3-dev.agent.md`); Claude Code target files use `N-name.md` (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–9). The VS Code filename is declared in the YAML `vs_file_name` field; the Claude Code filename is declared in `cc_file_name`.

<a name="c12"></a>
12. **Standalone YAML files are slug-based, not number-prefixed.** Standalone persona filenames match their `slug` field (e.g. `researcher.yaml`, `manifest-curator.yaml`). The `slug` must be a valid kebab-case identifier with no numeric prefix.

<a name="c13"></a>
13. **All VS Code output files use the `.agent.md` extension.** This applies to both ledger (e.g. `3-dev.agent.md`) and standalone (e.g. `researcher.agent.md`) suites. The output filename is YAML-declared via `vs_file_name` and written directly by `buildForTarget()` — it is not derived from the content template basename. Claude Code output uses plain `.md` (e.g. `researcher.md`), declared via `cc_file_name`.

<a name="c14"></a>
14. **`cc_name` is derived from `cc_file_name`.** The computed `cc_name` variable is `persona.cc_file_name.replace(/\.md$/, '')`, producing identifiers like `3-developer` or `2-project-manager`. This naming is required for Claude Code slash commands, which do not allow spaces. The `cc_file_name` YAML field (e.g., `2-project-manager.md`) is the authoritative source — `cc_name` always equals that filename without the `.md` extension.

<a name="c15"></a>
15. **`cc_tools` in a per-persona YAML overrides `default_cc_tools` from `_shared.yaml`.** By default, all personas use the `default_cc_tools` array defined in `_shared.yaml`. To customise the tool list for a specific persona, add a `cc_tools` key to its YAML file — this takes precedence over the shared default. Personas omitting `cc_tools` automatically inherit `default_cc_tools`.

<a name="c16"></a>
16. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

<a name="c17"></a>
17. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

<a name="c18"></a>
18. **Shared vs. suite-local partials.** The build system loads partials in two layers:
  - **Base layer** (`personas/shared/partials/`): suite-agnostic fragments reusable by all suites (ledger, standalone). Never include MCP-specific content here.
  - **Override layer** (`personas/<suite>/src/partials/`): suite-specific fragments. Same-named entries silently shadow their shared counterpart. All MCP-workflow partials (`mcp-*`, `role-boundaries`, `handoff-block-*`, `incident-logging`) live here.
  
  When building the standalone suite, a partial referenced by a shared partial but only defined in the ledger override layer (e.g., `{{> incident-logging}}`) will produce a `[WARN]` and be left as-is unless a stub is added to `shared/partials/`.

<a name="c19"></a>
19. **Standalone `_shared.yaml` must not contain `mcp_server_name` or `roster`.** Standalone personas are independent tools — they have no workflow roster and no MCP server dependency. Do not add these fields when extending the standalone suite.

<a name="c20"></a>
20. **Platform-specific partials use a `-vscode` / `-claude-code` suffix** (e.g., `handoff-block-vscode.md`, `handoff-block-claude-code.md`, `mcp-preflight-header-vscode.md`, `mcp-preflight-header-claude-code.md`). Content templates include them via a top-level `{{#if target_vscode}}…{{else}}…{{/if}}` conditional block — never inline platform-specific content directly in a content template.

<a name="c21"></a>
21. **`9-synthesis.md` omits the handoff-block partial by design.** The Synthesis agent always prints its handoff block verbatim (never auto-handoffs), so its content template does not include `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`. This is intentional — do not add the partial to this template.

<a name="c22"></a>
22. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

<a name="c23"></a>
23. **`role` values must match manifest role names** in `shared/workflow-manifest.json`. The sync script's `KNOWN_ROLES` and the MCP server's `AGENT_ROLES` both derive from the manifest at runtime, so adding or renaming a role in the manifest automatically propagates to both consumers. `scripts/build-personas.js` cross-checks each ledger persona's `role` field against manifest role names and emits advisory warnings for mismatches.

<a name="c24"></a>
24. **`id` naming convention and stability rules:**
   - **Ledger personas**: `id` must follow `ledger-{vs_file_name stem}` — e.g. `vs_file_name: 3-dev.agent.md` → `id: ledger-3-dev`.
   - **Standalone personas**: `id` must follow `standalone-{vs_file_name stem}` — e.g. `vs_file_name: researcher.agent.md` → `id: standalone-researcher`.
   - **Format constraints**: lowercase only, no spaces, no special characters except hyphens.
   - **Stability**: `id` values must never change once published — they are the routing key used by VS Code `@id` subagent routing. Version bumps, renames, or persona reordering must not alter the `id`.
   - **Uniqueness**: `id` values must be globally unique across all custom agents in the user's VS Code instance. The `ledger-` and `standalone-` namespace prefixes isolate these personas from each other and from any third-party agents the user may have installed.
   - **Claude Code output is unaffected**: `id:` is only added to `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE`. The Claude Code frontmatter templates (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`) do not include `id:` — Claude Code uses name-derivation routing, not `@id` routing.

<a name="c25"></a>
25. **`default_version` in `_shared.yaml` applies to all personas** unless overridden per-persona. Currently only Agent 1 (Planner) overrides the version (uses `1.3.0` while others use `3.4.0`).

<a name="c26"></a>
26. **`default_model` in `_shared.yaml` applies to all personas** unless overridden per-persona via the `model` field. This follows the same `default_X` + per-persona override pattern as `default_version` / `version`. Currently Agents 1 (Planner) and 2 (Project Manager) override the model (use `"Claude Opus 4.6"` while others inherit `"Claude Sonnet 4.6"`).

<a name="c27"></a>
27. **`cc_model` resolution chain:** The Claude Code `model` frontmatter value is resolved in Layer 3 as: `persona.cc_model → persona.model → _shared.default_model → _shared.cc_model`. This means a per-persona `cc_model` takes highest priority, followed by the persona's VS Code `model` override, then the shared default model, and finally the shared `cc_model` value (typically `"inherit"`).

<a name="c28"></a>
28. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — `buildForTarget()` emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

<a name="c29"></a>
29. **`mcp_server_name` in `_shared.yaml`** controls the MCP server reference everywhere in generated output. If the `.mcp.json` key changes, update this single field and rebuild.

---

## Sync Script Conventions

<a name="c30"></a>
30. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

<a name="c31"></a>
31. **Sync reads from explicit source directories.** `syncVSCode()` reads from `ledger/vs-code/`; `syncStandaloneVSCode()` reads from `standalone/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`. All four copy to their respective target directories without recursively walking the whole `personas/` tree. When `--target vscode` (or `--target all`) is used, both `syncVSCode()` and `syncStandaloneVSCode()` are called. When `--target claude-code` (or `--target all`) is used, both `syncClaudeCode()` and `syncStandaloneClaudeCode()` are called.

<a name="c32"></a>
32. **Frontmatter validation is advisory.** `validateVSCodeFrontmatter()` checks `role`, `name`, `vs_file_name`, `id`, and `model` in ledger VS Code personas. `validateStandaloneVSCodeFrontmatter()` checks `name` and `vs_file_name` in standalone VS Code personas (no `role` required). `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateStandaloneCCFrontmatter()` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone Claude Code personas. None of these functions block the sync — warnings are printed to console.

<a name="c33"></a>
33. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `scripts/build-personas.js` as a child process before copying files, and forwards the `--target` flag so the build step generates only the required output. There is no need to run build separately when syncing.

---

## Cross-System Dependencies

<a name="c34"></a>
34. **`note_only: true` on `mcp_tools` entries excludes them from the rendered tools table.** When an `mcp_tools` entry in a per-persona YAML file has `note_only: true`, the `renderMcpToolsTable()` function filters it out (using `.filter(t => !t.note_only)`) before building the Markdown table. The entry is still present in the YAML source and the tool remains functionally accessible to the agent, but it is not listed as a table row in generated output. Use this flag for tools that agents should be aware of via prose content (e.g., in a `mcp-tools-note.md` partial) but that are not primary workflow tools for that role. Entries without `note_only` are unaffected — `undefined` is falsy and passes the filter without change.

<a name="c35"></a>
35. **`--check` mode asserts that `note_only: true` tools are absent from generated output.** Running `node scripts/build-personas.js --check` performs two validations per file: (1) the generated content matches the file on disk (staleness check), and (2) no tool entry marked `note_only: true` in the persona's `mcp_tools` YAML appears as a rendered table row in the generated output. The guard in `build-personas.js` uses a **regex** (`/\|\s*\`toolName\`\s*\|/`) rather than `string.includes()` — this tolerates Markdown table column-spacing variations (e.g., `|  \`toolName\`  |`). Violations increment `staleCount` and are printed to stderr with prefix `[note_only-violation]`. If any violation is found the process exits with code 1.

   > **Why regex over string.includes:** `string.includes('| \`toolName\` |')` is tightly coupled to exact column spacing. A Markdown table reformatter or editor that normalises padding (e.g., `|  \`toolName\`  |`) would silently bypass the check. The regex `\|\s*\`…\`\s*\|` matches any amount of whitespace on either side of the backtick-quoted name, making the guard robust to formatting drift.

   > **AC field-name verification:** When acceptance criteria text references specific field names, TypeScript parameter names, or object property names (e.g., `store`, `rootIndex`, `wpDetails`, `storageDir`), verify these against the actual implementation source before committing the AC to a work package. If implementation uses a different name than what the AC states, update the AC text to match. Stale field-name references in ACs cause false-negative review outcomes.

<a name="c36"></a>
36. **`KNOWN_ROLES` and `AGENT_ROLES` are both manifest-derived.** Both `scripts/sync-personas.js` → `KNOWN_ROLES` and `mcp-server/src/utils/constants.ts` → `AGENT_ROLES` now derive their values at runtime from `shared/workflow-manifest.json`. There is no longer a manual sync contract between these two — they always agree by construction. Adding or renaming a role in the manifest propagates automatically. Persona YAML `role` fields still need to match manifest role names; `scripts/build-personas.js` validates this and emits advisory warnings on mismatch.

<a name="c37"></a>
37. **`role` field ↔ Agent Registry**: The `role` value in persona frontmatter is used by the MCP server's Agent Registry (`mcp-server/src/utils/agent-registry.ts`) to discover agent handles for automatic handoffs. The registry scans `*.agent.md` files in the VS Code prompts directory and matches the `role` field.

<a name="c38"></a>
38. **`mcp_server_name` ↔ `.mcp.json`**: The `mcp_server_name` value in `_shared.yaml` must match the server key in the target project's `.mcp.json` file. Default is `central_pm`.

<a name="c39"></a>
39. **Canonical Pipeline Stage Ordering Is a Hard Runtime Constraint.** `active_pipeline_stages` must be a **strict subsequence** of `CANONICAL_PIPELINE_ORDERING`: `['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation']`. Stages may be omitted but **never reordered**. `ledger_create_work_package` rejects arrays that violate this ordering (see MCP server constraint 66). The Pipeline Configurator sub-agent and any agent documentation that teaches pipeline composition must present this as a hard constraint, not a suggestion. Cross-reference: `mcp-server/docs/agents/project-manifest/constraints.md` → Constraints 19, 65, 66.

<a name="c40"></a>
40. **Work Package IDs Are Auto-Generated — never pass `work_package_id`.** `ledger_create_work_package` does not accept a `work_package_id` parameter. IDs are assigned by the server and returned in the tool response. On non-fresh ledgers (e.g., after clearing a previous project), IDs will not start at `WP-001`. Agents and sub-agent personas that create work packages must follow this three-point protocol: (1) **do not pass** `work_package_id` in the call, (2) **capture the returned ID** from the tool response, (3) **use the captured ID** in `dependencies` arrays for subsequent WP creation calls. This constraint applies to: the PM persona, the `ledger-bootstrapper` standalone sub-agent, and any documentation that teaches WP creation. Cross-reference: `mcp-server/docs/agents/project-manifest/api-surface.md` → `ledger_create_work_package` input signature.

---

## MCP Tool Allocation Matrix

This table is the **normative reference** for which MCP tools belong in each persona's `mcp_tools` YAML. When editing persona YAML files, consult this matrix to verify that tool additions or removals are intentional. The `note_only` column indicates tools present in the YAML but excluded from the rendered table (see [constraint 34](#c34)).

### Legend

| Symbol | Meaning |
|--------|---------|
| **✓** | Tool is listed in the persona's `mcp_tools` table |
| *(note)* | Tool is in YAML with `note_only: true` — available but not rendered in the table |
| — | Tool is not assigned to this persona |

### Allocation Table

| MCP Tool | 1-Plan | 2-PM | 3-Dev | 4-QA | 5-SecAudit | 6-Rev | 7-RelEng | 8-Doc | 9-Syn |
|---|---|---|---|---|---|---|---|---|---|
| `ledger_initialize_project` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_create_work_package` | — | **✓** | — | — | — | — | — | — | — |
| `ledger_get_next_action` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_begin_work` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_get_work_package` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_complete_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_cancel_pipeline` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | — |
| `ledger_add_project_comment` | — | — | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| `ledger_add_observation` | — | — | **✓** | — | — | — | — | — | — |
| `ledger_get_project_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_list_work_packages` | — | — | — | — | — | — | — | **✓** | **✓** |
| `ledger_update_work_package_status` | — | — | — | — | — | — | — | **✓** | — |
| `ledger_get_handoff_status` | — | **✓** | — | — | — | — | — | — | **✓** |
| `ledger_complete_synthesis` | — | — | — | — | — | — | — | — | **✓** |
| `ledger_help` | — | — | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* | *(note)* |

### Rationale

**1 — Planner:** Has no MCP tools. The Planner produces a plan document before any ledger exists. It operates entirely on the filesystem and has no ledger to interact with.

**2 — Project Manager:** Initializes the ledger (`ledger_initialize_project`) and creates all work packages (`ledger_create_work_package`). Uses `ledger_get_project_status` to verify the ledger after creation. Uses `ledger_get_handoff_status` to compute the handoff block — required because PM does not use `ledger_get_next_action` (it has no pipeline loop) and therefore cannot rely on the embedded `handoff_status` in WAIT responses.

**3 — Developer:** Full pipeline agent. Uses `ledger_get_next_action` → `ledger_begin_work` → `ledger_complete_pipeline` as the core loop. Has `ledger_add_observation` (unique to Developer) for the Code Insight Observer role — recording observations after a pipeline is already completed. Has `ledger_cancel_pipeline` for stale pipeline recovery.

**4 — QA:** Pipeline agent with the same core loop as Developer (get next action → begin work → complete pipeline). Does not need `ledger_add_observation` because QA records all findings as pipeline comments in `ledger_complete_pipeline`. Does not need `ledger_get_project_status` — reachability is confirmed by the `ledger_get_next_action` call in the preflight detect step.

**5 — Security Auditor:** Same tool set as QA and for the same reasons. The Security Auditor's distinct behavior (OWASP-based vulnerability analysis, severity classification, findings recorded via `ledger_add_project_comment` and `ledger_complete_pipeline`) is expressed through how the tools are used, not which tools are available.

**6 — Reviewer:** Same tool set as Security Auditor. The Reviewer's distinct behavior (review dimensions, PASS/FAIL logic, cross-cutting architectural insights via `ledger_add_project_comment`) is expressed through how the tools are used, not which tools are available.

**7 — Release Engineer:** Same tool set as Security Auditor and Reviewer. Manages changelog entries, version bumps, and deployment readiness checks. Results recorded via `ledger_complete_pipeline`.

**8 — Documentation:** Pipeline agent with `ledger_list_work_packages` (unique among pipeline agents) to scan across WPs for documentation gaps, and `ledger_update_work_package_status` to finalize WPs when auto-finalize did not fire during `ledger_complete_pipeline`. Does not have `ledger_get_handoff_status` — the handoff status is embedded in the WAIT response from `ledger_get_next_action` (the handoff partial provides a fallback path if absent).

**9 — Synthesis:** Read-heavy agent. Uses `ledger_get_project_status` and `ledger_list_work_packages` to iterate all WPs, `ledger_get_work_package` for deep reads, and `ledger_complete_synthesis` (unique to Synthesis) to archive the report and transition the project to COMPLETE. Uses `ledger_get_handoff_status` explicitly because its handoff step is a custom block that directly calls this tool rather than relying on the WAIT-embedded status. Does not have `ledger_begin_work` or `ledger_complete_pipeline` — Synthesis does not run standard pipelines.

### Feature Flag Reference

These per-persona YAML flags control which partials and content sections are included:

| Flag | Effect | Personas with `true` |
|---|---|---|
| `has_mcp` | Includes MCP intro, role boundaries, tool table, preflight sections | 2-PM, 3-Dev, 4-QA, 5-SecAudit, 6-Rev, 7-RelEng, 8-Doc, 9-Syn |
| `has_detect_project` | Includes the `cwd_path` auto-detect preflight step | 3-Dev, 4-QA, 5-SecAudit, 6-Rev, 7-RelEng, 8-Doc, 9-Syn |
| `self_documenting_note` | Includes the `mcp-tools-note` partial (explains `ledger_help` availability) | 3-Dev, 4-QA, 5-SecAudit, 6-Rev, 7-RelEng, 8-Doc, 9-Syn |
| `has_incident_logging` | Includes the `incident-logging` partial (instructs agent to log system-level incidents) | 3-Dev, 4-QA, 5-SecAudit, 6-Rev, 7-RelEng, 8-Doc |

---

## Intentional Differences from Pre-Build Era

When the build system was introduced, the generated output differs from the original hand-authored files in these **intentional** ways:

<a name="c41"></a>
41. **AUTO-GENERATED header** added to every generated file.

<a name="c42"></a>
42. **Code fence indentation normalized.** Handoff block code fences are at column 0; originals had 3–4 space indent (numbered list continuation style).

<a name="c43"></a>
43. **`mcp-tools-note` placement unified.** For Agent 3 (Developer), the self-documenting note was moved from the Workflow section to the MCP Tools section for consistency with agents 4–9.

<a name="c44"></a>
44. **Detect-step wording standardized.** Slight rewording of the detect-project pre-flight step to be uniform across all agents that use it.

---

## Pre-Commit Guard

<a name="c45"></a>
45. **Never edit generated persona files directly.** Always update the template sources in `personas/ledger/src/` or `personas/standalone/src/` and rebuild. The generated output directories (`personas/ledger/vs-code/`, `personas/ledger/claude-code/`, `personas/standalone/vs-code/`, `personas/standalone/claude-code/`) are fully overwritten on every build.

<a name="c46"></a>
46. **Run `node scripts/install-hooks.js` after cloning.** This sets `git config core.hooksPath .githooks` for the repo, activating the `.githooks/pre-commit` hook. The hook runs `node scripts/build-personas.js --check` before every commit. Without this step, stale generated output can be committed silently.

<a name="c47"></a>
47. **`.githooks/pre-commit` enforces persona freshness at commit time.** The hook exits non-zero if any generated persona file is stale, blocking the commit. This closes the gap where a developer editing only `personas/src/` would never trigger the freshness check via `mcp-server/` tests.
