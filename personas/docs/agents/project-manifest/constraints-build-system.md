# Constraints — Build System & Sync

> **Scope:** Template engine behavior, build script flags, log conventions, and sync script rules. Consult this document when modifying `scripts/build-personas.js`, `personas/persona-build.config.js`, or `scripts/sync-personas.js`.
>
> See also: [Core Constraints](constraints.md) · [Cross-System Constraints](constraints-cross-system.md)

---

## Template Engine Limitations

<a name="c5"></a>
<a name="b1"></a>
1. **`{{else}}` blocks are supported.** Conditionals may include an optional `{{else}}` branch: `{{#if flag}}…{{else}}…{{/if}}`. When the flag is truthy, the content before `{{else}}` is kept; when falsy, the content after `{{else}}` is kept. Prefer `{{else}}` over computed inverse booleans.

<a name="c6"></a>
<a name="b2"></a>
2. **Nested `{{#if}}` blocks are supported, but only inside an `{{else}}` branch.** The engine resolves conditionals innermost-first, so a `{{#if}}` may nest inside the `{{else}}` branch of an outer `{{#if}}` — this is the required pattern for three-way, per-target content (see `constraints.md` §C20 and the live example in `personas/ledger/src/content/2-project-manager.md`):

   ```
   {{#if target_vscode}}
   … VS Code–specific content …
   {{else}}
   {{#if target_deep_agents}}
   … Deep Agents–specific content …
   {{else}}
   … Claude Code–specific content …
   {{/if}}
   {{/if}}
   ```

   `{{else if flag}}` chains are also supported and are normalised internally into the nested form above before resolution. What is **not** supported is nesting a second `{{#if}}` directly inside the truthy branch of an outer `{{#if}}` (i.e. before any `{{else}}`) — the engine's innermost-first resolution has no way to disambiguate which `{{/if}}` closes which opener in that position. Flatten that case to a single compound boolean instead:

   **Unsupported (nested inside the truthy branch, no `{{else}}`):**
   ```
   {{#if platform_vscode}}
     {{#if feature_enabled}}
       Content for VS Code only when feature is on
     {{/if}}
   {{/if}}
   ```

   **Correct pattern:**
   ```
   {{#if platform_vscode_and_feature}}
     Content for VS Code only when feature is on
   {{/if}}
   ```
   Pre-compute the compound boolean as a variable in the build script (or add it to `_shared.yaml`), then use a single top-level `{{#if}}` block.

<a name="c7"></a>
<a name="b3"></a>
3. **No `{{#each}}` loops.** Iteration must be handled by computed variables. The build script pre-renders `roster_rendered` and `mcp_tools_table` as fully-formed Markdown strings.

<a name="c8"></a>
<a name="b4"></a>
4. **Max partial depth: 2.** Partials can embed other partials, but only to depth 2. Deeper nesting is silently ignored (markers left in output).

<a name="c9"></a>
<a name="b5"></a>
5. **Unresolved markers are preserved.** Unknown `{{variable}}` or `{{> partial}}` markers are left in the output as-is, and the library prints a `[WARN] Unresolved variable` or `[WARN] Partial not found` line via `console.warn`. These lines are not validation results, so they never fail the build, with or without `--strict`. This makes typos visible without causing a hard build failure.

<a name="c10"></a>
<a name="b6"></a>
6. **`--strict` fails the build on warning-severity validation results, not on unresolved markers.** `scripts/build-personas.js` forwards `--strict` to the library CLI and runs no scan of its own. The library then exits 1 when any validation result has severity `warning`; error-severity results fail the build with or without the flag. Warnings come from the library's built-in validators (for example a tool written in another target's notation, or an unmapped `tool_parity_exceptions` entry) and from plugins (for example the ledger plugin's unknown-role check). An unresolved `{{variable}}` marker only prints a console `[WARN] Unresolved variable` line. That line is not a validation result, so `--strict` does not gate on it. The same holds for an unresolved `{{> partial}}` and its `[WARN] Partial not found` line. The wrapper's own warn-severity checks (philosophy tone, changelog entry size) never fail the build either, `--strict` included, since `resolveExitCode()` in `scripts/lib/build-checks.js` considers only the library exit status and the error count. Use `node scripts/build-personas.js --strict` in CI to gate on zero library warnings, and add `--check` to keep the run free of writes.

---

## Log-Prefix Convention

The build script (`scripts/build-personas.js`) uses bracket-prefixed severity levels for all console output. Use these prefixes consistently for any `console.log` / `console.error` calls added to the build script in the future.

| Prefix | Meaning | Example usage |
|--------|---------|---------------|
| `[info]` | Informational — runtime context, no action needed | Suite default announcement at startup |
| `[WARN]` | Warning — recoverable issue, output may still be valid | Unresolved template markers (`[WARN] Unresolved variable`, `[WARN] Partial not found`, printed by the library); never fatal, even under `--strict` |
| `[ERROR]` | Fatal — build cannot continue | Missing content file, invalid YAML |

---

## Build Validation Constraints

<a name="c34"></a>
<a name="b7"></a>
7. **`note_only: true` on `mcp_tools` entries excludes them from the rendered tools table.** When an `mcp_tools` entry in a per-persona YAML file has `note_only: true`, the `renderMcpToolsTable()` function filters it out (using `.filter(t => !t.note_only)`) before building the Markdown table. The entry is still present in the YAML source and the tool remains functionally accessible to the agent, but it is not listed as a table row in generated output. Use this flag for tools that agents should be aware of via prose content (e.g., in a `mcp-tools-note.md` partial) but that are not primary workflow tools for that role. Entries without `note_only` are unaffected — `undefined` is falsy and passes the filter without change.

<a name="c35"></a>
<a name="b8"></a>
8. **The `note_only` guard is a ledger-plugin validator, run on every build.** `validateNoteOnlyGuard()` in `personas/plugins/ledger/role-validator.js` asserts that no tool entry marked `note_only: true` in the persona's `mcp_tools` YAML appears as a rendered table row. The ledger plugin (`personas/plugins/ledger/index.js`) caches each persona's rendered output per target in its `onPostRender` hook and runs the guard from its `onValidate` hook, so it applies to real builds and `--check` alike. Each leaking tool is reported as an error-severity validation result, which fails the build. `build-personas.js` holds no guard, counter, or log prefix of its own for this check. `--check` itself renders in memory and writes nothing; it never compares rendered output with the files on disk, so it does not detect stale output. The guard matches with a **regex** (`\|\s*\`toolName\`\s*\|`) rather than `string.includes()` — this tolerates Markdown table column-spacing variations (e.g., `|  \`toolName\`  |`).

   > **Why regex over string.includes:** `string.includes('| \`toolName\` |')` is tightly coupled to exact column spacing. A Markdown table reformatter or editor that normalises padding (e.g., `|  \`toolName\`  |`) would silently bypass the check. The regex `\|\s*\`…\`\s*\|` matches any amount of whitespace on either side of the backtick-quoted name, making the guard robust to formatting drift.

<a name="c36"></a>
<a name="b9"></a>
9. **`{{agent_slug_*}}` references in ledger persona content must match the persona's declared `subagents` list.** Every `{{agent_slug_X_Y}}` reference in `personas/ledger/src/content/*.md` is cross-checked against that persona's `subagents` field in its YAML (`personas/ledger/src/meta/*.yaml`). The suffix `X_Y` is converted to kebab-case (`X-Y`) and must appear as an entry in the `subagents` list. The check runs **unconditionally** — on both real builds and `--check` runs — via `scripts/lib/agent-slug-validation.js`'s `validateAgentSlugReferences()`, one of the descriptors `scripts/build-personas.js` passes through its `runBuildChecks()` check runner (`scripts/lib/build-checks.js`). A reference written inside a template comment (`{{!-- … --}}` / `{{! … }}`) is ignored — the wrapper passes the library's `stripComments()` (falling back to the identity function for a stale `dist/` predating that export). If any reference has no matching `subagents` entry, a `[ERROR]` block is emitted identifying the persona, the template variable, and the expected slug; the runner records this as an error-severity result and `scripts/build-personas.js` exits non-zero once every check (and the library CLI) has run — not immediately, as the check used to do when it was inline.

   **Error message format:**
   ```
   [ERROR] agent_slug cross-reference check failed:

     Persona "2-project-manager": {{agent_slug_foo_bar}} references slug "foo-bar"
     which is not declared in the subagents list.
     Add "foo-bar" to the subagents field in 2-project-manager.yaml.
   ```

   **To resolve:** Add the slug to the `subagents` field in the relevant `personas/ledger/src/meta/N-name.yaml` file and rebuild standalone personas (`node scripts/build-personas.js`) so the matching `personas/standalone/src/meta/{slug}.yaml` and `personas/standalone/deep-agents/{slug}.md` files exist.

   **Regex scope:** The pattern `/\{\{agent_slug_([a-z0-9_]+)\}\}/g` only matches all-lowercase suffixes. Mixed-case or hyphenated `{{agent_slug_*}}` references are not detected — this is intentional and enforces the lowercase-only convention.

   **Shared-partial note:** The scan covers only `personas/ledger/src/content/*.md`. References in `personas/ledger/src/partials/` or `personas/shared/partials/` are not validated by this check.

<a name="c37"></a>
<a name="b10"></a>
10. **Version in name-mapping is derived from the `changelog` block scalar.** `scripts/build-personas.js` delegates the post-build name-mapping step to `scripts/lib/name-mapping.js`, whose exported `resolveVersionFromChangelog(rawYamlText)` helper extracts version from each persona's `changelog:` YAML field before falling back to the explicit `version:` field and then to `DEFAULT_VERSION`. This mirrors the derivation logic in the persona-builder library's `resolveChangelogMeta()`. Supported formats:
    - `X.Y.Z (YYYY-MM-DD): description` — version + date extracted
    - `X.Y.Z: description` — version extracted, no date

    The build delegates diagnostics to the same module's exported `validateChangelogField()` helper:
    - `[WARN]` when `changelog` is present but contains no parseable version line
    - `[WARN]` when the first parseable version entry has no date component
    - `[WARN]` when the same version number appears more than once with different dates (data-entry mistake that would cause `last_updated` to be ambiguous)
    - `[INFO]` when explicit `version:` or `last_updated:` fields coexist with `changelog` (indicating stale redundant fields that should be removed)

    The explicit `version:` field in per-persona YAML is **inert once a `changelog` field is present** — do not add or update `version:` manually.

    > **Resolved — generated frontmatter `version:` vs. `name-mapping.json` version.** Earlier releases of `@mistralys/persona-builder` (< v2.5.0) fell back to `default_version` from `_shared.yaml` for the frontmatter `version:` field regardless of a persona's `changelog:` content, causing `name-mapping.json` to show a newer version than generated frontmatter. `personas/package.json` now pins `^2.6.0`, which uses the shared `resolveChangelogMeta()` logic in both places — this discrepancy no longer applies. Do not add an explicit `version:` field to persona YAML; it remains inert regardless of installed library version.

<a name="c38"></a>
<a name="b11"></a>
11. **Frontmatter templates must guard `last_updated:` with `{{#if last_updated}}`.** When `buildContext()` derives `last_updated` from a changelog entry with no date component, it resolves to `''` (empty string). An unguarded `last_updated: {{last_updated}}` line in a frontmatter template produces `last_updated: ` — a blank YAML value that may cause downstream parsing issues or confuse consumers.

    All four frontmatter template locations use a conditional guard:
    ```
    {{#if last_updated}}
    last_updated: {{last_updated}}
    {{/if}}
    ```
    This applies to: VS Code and Claude Code templates in both `personas/persona-build.config.js` (standalone suite) and `personas/plugins/ledger/frontmatter-templates.js` (ledger suite). Any new frontmatter template that references `last_updated` **must** include this guard.

---

## Sync Script Conventions

<a name="c30"></a>
<a name="b12"></a>
12. **`vs_file_name` is required for VS Code sync; `name` is required for Claude Code sync.** During VS Code sync, files without a `vs_file_name` field in frontmatter are silently skipped. During Claude Code sync, files without a `name` field are skipped. This excludes `README.md` and any non-persona files.

<a name="c31"></a>
<a name="b13"></a>
13. **Sync reads from explicit source directories.** `syncVSCode()` reads from `ledger/vs-code/`; `syncStandaloneVSCode()` reads from `standalone/vs-code/`; `syncLedgerSupportVSCode()` reads from `ledger-support/vs-code/`; `syncClaudeCode()` reads from `ledger/claude-code/`; `syncStandaloneClaudeCode()` reads from `standalone/claude-code/`; `syncLedgerSupportClaudeCode()` reads from `ledger-support/claude-code/`. Each copies to its target directory without recursively walking the whole `personas/` tree. When `--target vscode` (or `--target all`) is used, the three VS Code functions are called, copying to the VS Code prompts folder (`--custom-path` overrides it). When `--target claude-code` (or `--target all`) is used, the three Claude Code functions are called, copying to `~/.claude/agents/`, followed by `syncSkills()`, which copies `.claude/skills/` to `~/.claude/skills/`.

<a name="c32"></a>
<a name="b14"></a>
14. **Frontmatter validation is advisory.** `validateVSCodeFrontmatter()` checks `role`, `name`, `vs_file_name`, `id`, and `model` in ledger VS Code personas. `validateSlugModeVSCodeFrontmatter(dir, suiteLabel)` checks `name`, `vs_file_name`, and `id` in standalone and ledger-support VS Code personas (no `role` required). `validateCCFrontmatter()` checks `name` (must match `\d-kebab-case` pattern with numeric prefix), `role`, `permissionMode`, `model`, and `memory` in ledger Claude Code personas. `validateSlugModeCCFrontmatter(dir, suiteLabel)` checks `name` (plain kebab-case — **no** numeric prefix, e.g. `agents-md-curator`), `permissionMode`, `model`, and `memory` in standalone and ledger-support Claude Code personas. None of these functions block the sync — warnings are printed to console.

<a name="c33"></a>
<a name="b15"></a>
15. **Build is automatic during sync.** `scripts/sync-personas.js` spawns `node scripts/build-personas.js` as a child process before copying files, with no extra arguments, or with `--dry-run` when the sync itself gets `--dry-run`. The build always covers every suite and target in `personas/persona-build.config.js`; the sync's `--target` selects only which deploy steps run. There is no need to run build separately when syncing. Under `--dry-run` nothing is regenerated and nothing is copied: the sync only previews ("Would copy") from the existing output, so on a checkout without built output the preview is empty or stale.
