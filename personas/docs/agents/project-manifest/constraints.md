# Constraints & Conventions

> **Scope:** Core rules for editing persona source files, naming conventions, versioning, and safety guards. This is the primary constraints document — consult it before making any persona changes.
>
> See also: [Build System Constraints](constraints-build-system.md) · [Cross-System Constraints](constraints-cross-system.md)

---

## Source Editing Rules

<a name="c1"></a>
<a name="c45"></a>
1. **Never edit generated files directly.** All persona files in the following directories are auto-generated and must not be hand-edited:
   - `personas/ledger/vs-code/`, `personas/ledger/claude-code/`, and `personas/ledger/deep-agents/`
   - `personas/standalone/vs-code/`, `personas/standalone/claude-code/`, and `personas/standalone/deep-agents/`
   - `personas/ledger-support/vs-code/`, `personas/ledger-support/claude-code/`, and `personas/ledger-support/deep-agents/`

   All changes must be made in the corresponding `src/` directory and rebuilt. Generated files carry an `<!-- AUTO-GENERATED — do not edit. Source: personas/<suite>/src/ -->` header as a guard. The generated output directories are fully overwritten on every build.

<a name="c2"></a>
2. **`README.md` is not generated.** The `personas/ledger/README.md` is hand-authored and serves as the user-facing workflow guide. It is excluded from the build process.

<a name="c2a"></a>
3. **Directory layout — generated vs. source.** Use the auto-generated tree in `.context/personas/file-structure.md` for structural navigation. The table below clarifies which directories are generated output vs. hand-authored source:

   | Directory | Generated? | Purpose |
   |-----------|-----------|----------|
   | `personas/ledger/vs-code/` | Yes | VS Code target output |
   | `personas/ledger/claude-code/` | Yes | Claude Code target output |
   | `personas/ledger/deep-agents/` | Yes | Deep-agents target output |
   | `personas/standalone/vs-code/` | Yes | VS Code target output (standalone) |
   | `personas/standalone/claude-code/` | Yes | Claude Code target output (standalone) |
   | `personas/standalone/deep-agents/` | Yes | Deep-agents target output (standalone) |
   | `personas/ledger-support/vs-code/` | Yes | VS Code target output (ledger-support) |
   | `personas/ledger-support/claude-code/` | Yes | Claude Code target output (ledger-support) |
   | `personas/ledger-support/deep-agents/` | Yes | Deep-agents target output (ledger-support) |
   | `personas/ledger/src/meta/` | No | YAML metadata: identity, feature flags, tool lists |
   | `personas/ledger/src/content/` | No | Per-persona body templates |
   | `personas/ledger/src/partials/` | No | Ledger-suite Markdown fragments (override layer; MCP-specific partials live here) |
   | `personas/standalone/src/meta/` | No | YAML metadata for standalone personas (slug-based, no `role`) |
   | `personas/standalone/src/content/` | No | Per-slug body templates |
   | `personas/ledger-support/src/meta/` | No | YAML metadata for ledger-support personas (slug-based, MCP-dependent) |
   | `personas/ledger-support/src/content/` | No | Per-slug body templates (ledger-support) |
   | `personas/shared/partials/` | No | Suite-agnostic shared Markdown fragments (base layer; no MCP content) |

<a name="c3"></a>
4. **Edit → Build → Sync workflow.** After modifying any source file in `src/`, run `node scripts/build-personas.js` (or add `--suite` to target a specific suite and `--target vscode` / `--target claude-code` / `--target deep-agents` for a single target) to regenerate output, then `node scripts/sync-personas.js` to deploy to both VS Code and Claude Code. Use `--suite all` to rebuild all three suites (ledger, standalone, ledger-support) in one pass.

---

## Persona Content Philosophy

<a name="c4"></a>
5. **Persona content must add value the self-documenting tools cannot provide.** The ledger's `next_steps` arrays, `--- NEXT STEP ---` guidance blocks, and Zod parameter descriptions are the runtime source of truth. A persona's job is to provide **identity, methodology, and decision-making framework** — not to duplicate tool documentation. When tool self-documentation already covers a behavior (e.g., wait-action reasons, required parameters), do not restate it in persona content. When persona content enumerates tool parameters or action names, it must match the implementation exactly or defer to the tool descriptions entirely.

<a name="c4a"></a>
5a. **Numbered workflow steps in persona content templates are immutable structural contracts.** When a new phase partial is added to a persona's content template, a corresponding numbered-step entry must be added in the same implementation change — never deferred to a follow-up. An agent following only the numbered steps will silently skip any phase that exists as a partial but has no matching step entry. Before closing a persona-modification PR, cross-check the count of numbered workflow steps against the count of phase partials included in that template to confirm parity. The Documentation pipeline is responsible for catching step/partial count mismatches during its review pass.

---

## Naming & File Conventions

<a name="c11"></a>
6. **Ledger persona output filenames differ by target.** VS Code target files use `N-name.agent.md` (e.g., `3-dev.agent.md`); Claude Code and deep-agents target files both use `N-name.md` (e.g., `3-developer.md`). The number prefix matches the agent's `number` field (1–9). The VS Code filename is declared in the YAML `vs_file_name` field; the Claude Code filename in `cc_file_name`; the deep-agents filename in `da_file_name`. The `da_file_name` field follows the same `N-<role-slug>.md` pattern as `cc_file_name` and is intentionally absent from standalone YAMLs — the deep-agents target falls back to the content file basename (e.g. `researcher.md`) for standalone personas.

<a name="c12"></a>
7. **Standalone YAML files are slug-based, not number-prefixed.** Standalone persona filenames match their `slug` field (e.g. `researcher.yaml`, `manifest-curator.yaml`). The `slug` must be a valid kebab-case identifier with no numeric prefix.

<a name="c13"></a>
8. **All VS Code output files use the `.agent.md` extension.** This applies to both ledger (e.g. `3-dev.agent.md`) and standalone (e.g. `researcher.agent.md`) suites. The output filename is YAML-declared via `vs_file_name` and written by the library — it is not derived from the content template basename. Claude Code output uses plain `.md` (e.g. `researcher.md`), declared via `cc_file_name`.

<a name="c14"></a>
9. **`cc_name` is derived from `cc_file_name`.** The computed `cc_name` variable is `persona.cc_file_name.replace(/\.md$/, '')`, producing identifiers like `3-developer` or `2-project-manager`. This naming is required for Claude Code slash commands, which do not allow spaces. The `cc_file_name` YAML field (e.g., `2-project-manager.md`) is the authoritative source — `cc_name` always equals that filename without the `.md` extension.

<a name="c15"></a>
10. **`cc_tools` in a per-persona YAML overrides `default_cc_tools` from `_shared.yaml`.** By default, all personas use the `default_cc_tools` array defined in `_shared.yaml`. To customise the tool list for a specific persona, add a `cc_tools` key to its YAML file — this takes precedence over the shared default. Personas omitting `cc_tools` automatically inherit `default_cc_tools`.

<a name="c16"></a>
11. **Content, meta, and partial files share the same basename.** For each persona: `src/meta/N-name.yaml`, `src/content/N-name.md`. If a content file is missing for a YAML file, the build exits with `[ERROR]`.

<a name="c17"></a>
12. **Partials use kebab-case filenames** without number prefixes (e.g., `mcp-preflight-detect.md`). The partial name in templates matches the filename without the `.md` extension.

<a name="c18"></a>
13. **Shared vs. suite-local partials.** The build system loads partials in two layers:
  - **Base layer** (`personas/shared/partials/`): suite-agnostic fragments reusable by all suites (ledger, standalone). Never include MCP-specific content here.
  - **Override layer** (`personas/<suite>/src/partials/`): suite-specific fragments. Same-named entries silently shadow their shared counterpart. All MCP-workflow partials (`mcp-*`, `role-boundaries`, `handoff-block-*`, `incident-logging`) live here.
  
  When building the standalone suite, a partial referenced by a shared partial but only defined in the ledger override layer (e.g., `{{> incident-logging}}`) will produce a `[WARN]` and be left as-is unless a stub is added to `shared/partials/`.

<a name="c19"></a>
14. **The `standalone` suite's `_shared.yaml` must not contain `mcp_server_name` or `roster`.** Standalone personas are fully independent tools — they have no workflow roster and no MCP server dependency. Do not add these fields to `personas/standalone/src/meta/_shared.yaml`.

   The `ledger-support` suite's `_shared.yaml` **does** contain `mcp_server_name: central_pm` by design — all ledger-support personas depend on the `central_pm` MCP server. This is intentional and correct for that suite.

<a name="c20"></a>
15. **Platform-specific partials use a `-vscode` / `-claude-code` suffix** (e.g., `handoff-block-vscode.md`, `handoff-block-claude-code.md`, `mcp-preflight-header-vscode.md`, `mcp-preflight-header-claude-code.md`). Content templates include them via a top-level `{{#if target_vscode}}…{{else}}…{{/if}}` conditional block — never inline platform-specific content directly in a content template.

   When a content section must produce **different inline text for all three targets**, use nested conditionals instead of named partials:
   ```
   {{#if target_vscode}}
   … VS Code–specific inline content …
   {{else}}
   {{#if target_deep_agents}}
   … Deep Agents–specific inline content …
   {{else}}
   … Claude Code–specific inline content …
   {{/if}}
   {{/if}}
   ```
   This pattern is used in `personas/ledger/src/content/2-project-manager.md` for sub-agent invocation steps 3–6.

<a name="c21"></a>
16. **`9-synthesis.md` omits the handoff-block partial by design.** The Synthesis agent always prints its handoff block verbatim (never auto-handoffs), so its content template does not include `{{> handoff-block-vscode}}` or `{{> handoff-block-claude-code}}`. This is intentional — do not add the partial to this template.

<a name="c22"></a>
17. **`.gitkeep` files exist in all source directories** to preserve empty directory structure in version control.

---

## Role & Version Conventions

<a name="c23"></a>
18. **`role` values must match manifest role names** in `shared/workflow-manifest.json`. The sync script's `KNOWN_ROLES` and the MCP server's `AGENT_ROLES` both derive from the manifest at runtime, so adding or renaming a role in the manifest automatically propagates to both consumers. `scripts/build-personas.js` cross-checks each ledger persona's `role` field against manifest role names and emits advisory warnings for mismatches.

<a name="c24"></a>
19. **`id` naming convention and stability rules:**
   - **Ledger personas**: `id` must follow `ledger-{vs_file_name stem}` — e.g. `vs_file_name: 3-dev.agent.md` → `id: ledger-3-dev`.
   - **Standalone personas**: `id` must follow `standalone-{vs_file_name stem}` — e.g. `vs_file_name: researcher.agent.md` → `id: standalone-researcher`.
   - **New ledger-support personas**: `id` must follow `ledger-support-{slug}` — e.g. `slug: my-new-tool` → `id: ledger-support-my-new-tool`.
   - **Migrated ledger-support personas**: The 9 personas moved from `standalone/` to `ledger-support/` retain their `standalone-*` id prefix permanently (e.g., `id: standalone-ledger-bootstrapper`). This is a historical artifact — changing these ids would break VS Code `@id` routing for all users who have these agents installed.
   - **Format constraints**: lowercase only, no spaces, no special characters except hyphens.
   - **Stability**: `id` values must never change once published — they are the routing key used by VS Code `@id` subagent routing. Version bumps, renames, or persona reordering must not alter the `id`.
   - **Uniqueness**: `id` values must be globally unique across all custom agents in the user's VS Code instance. The `ledger-`, `standalone-`, and `ledger-support-` namespace prefixes isolate these personas from each other and from any third-party agents the user may have installed.
   - **Claude Code output is unaffected**: `id:` is only added to `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE`. The Claude Code frontmatter templates (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`) do not include `id:` — Claude Code uses name-derivation routing, not `@id` routing.

<a name="c25"></a>
20. **`default_version` in `_shared.yaml` is the suite-wide version fallback.** It applies to all personas that have no `changelog:` block scalar in their per-persona YAML. When a persona's `changelog:` field contains a parseable semver entry, the build system derives `version` from that entry and `default_version` is not used for that persona. This follows the standard `default_X` + per-persona override pattern used throughout the build system.

<a name="c25a"></a>
20a. **`changelog:` is the sole version source for per-persona metadata — never add standalone `version:` or `last_updated:` fields.** Each per-persona YAML uses a `changelog:` block scalar as its authoritative version record. The required format is one entry per line, most recent first, in `X.Y.Z (YYYY-MM-DD): description` form:

   ```yaml
   changelog: |
     1.0.0 (2026-06-13): Initial release
   ```

   The build system automatically derives the `version` context variable from the first version token and `last_updated` from the first date token. **Never add standalone `version:` or `last_updated:` YAML fields to any persona** — they are not read by the build system and create misleading redundancy. Use `default_version` in `_shared.yaml` only as a fallback for personas that have no `changelog:` entry yet.

<a name="c26"></a>
21. **`default_model` in `_shared.yaml` applies to all personas** unless overridden per-persona via the `model` field. This follows the same `default_X` + per-persona override pattern as `default_version` / `version`.

<a name="c26a"></a>
21a. **`default_model_slug` in `_shared.yaml` applies to all ledger personas** unless overridden per-persona via the `model_slug` field. This follows the identical `default_X` + per-persona override pattern as `default_model` / `model`. The slug is an API-compatible identifier used by the orchestrator to route calls to the correct model endpoint (e.g. `"claude-sonnet-4-6"`). It is **not** rendered into generated frontmatter templates — it is consumed directly from YAML source by the orchestrator.

<a name="c27"></a>
22. **`cc_model` resolution chain:** The Claude Code `model` frontmatter value is resolved in Layer 3 as: `persona.cc_model → persona.model → _shared.default_model → _shared.cc_model`. This means a per-persona `cc_model` takes highest priority, followed by the persona's VS Code `model` override, then the shared default model, and finally the shared `cc_model` value (typically `"inherit"`).

<a name="c28"></a>
23. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — the library emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

<a name="c29"></a>
<a name="c38"></a>
<a name="c48"></a>
24. **`mcp_server_name` in `_shared.yaml` controls the MCP server reference** everywhere in generated output and must match the server key used by `scripts/install-mcp-global.js` (default: `central_pm`). If the server name changes, update this field, rebuild personas, and update `install-mcp-global.js` — see the Cross-System Dependencies table in `AGENTS.md`.

   > **Shadowing risk:** Per-persona YAML fields shadow shared YAML values via the object spread in the build context. If `mcp_server_name` changes globally, update **both** `personas/ledger/src/meta/_shared.yaml` and `personas/ledger-support/src/meta/_shared.yaml`. The `standalone` suite has no `mcp_server_name` in its `_shared.yaml` (see [constraint 14](#c19)) and none of its personas should hardcode it.

<a name="c49"></a>
25. **Every persona change requires a version bump, date update, and changelog entry.** When any persona source file is modified (YAML metadata in `src/meta/`, content template in `src/content/`, or a partial in `src/partials/` that affects generated output), the agent performing the change **must** complete all three steps before finishing:
   1. **Update the `changelog:` block scalar** in the persona's YAML metadata file. Prepend a new entry in `X.Y.Z (YYYY-MM-DD): description` format. The build system derives both `version` and `last_updated` from this field automatically — do **not** add or update standalone `version:` or `last_updated:` fields. Follow SemVer: patch for wording/formatting fixes, minor for behavioral or structural changes, major for breaking changes.
   2. **Add an entry to `personas/changelog.md`** under a new or existing version heading, following the established house style (flat bullet list with category prefix, ≤ 100-char lines).

   > **Suite-wide changes:** If a single change affects multiple personas (e.g., editing a shared partial), update each affected persona's `changelog:` field individually and document all of them in one `personas/changelog.md` entry. For changes affecting every persona in a suite, prefer bumping `default_version` in `_shared.yaml` with a dated entry rather than updating every YAML file individually.

   Omitting any of these steps is a defect — downstream agents and the pre-commit freshness guard depend on accurate version metadata in the `changelog:` field.

---

## Pre-Commit Guard

<a name="c46"></a>
26. **Run `node scripts/install-hooks.js` after cloning.** This sets `git config core.hooksPath .githooks` for the repo, activating the `.githooks/pre-commit` hook. The hook runs `node scripts/build-personas.js --check` before every commit. Without this step, stale generated output can be committed silently.

<a name="c47"></a>
27. **`.githooks/pre-commit` enforces persona freshness at commit time.** The hook exits non-zero if any generated persona file is stale, blocking the commit. This closes the gap where a developer editing only `personas/src/` would never trigger the freshness check via `mcp-server/` tests.

---

## Cross-Platform Constraints

<a name="c50"></a>
28. **Build scripts must run on Windows, macOS, and Linux.** The personas build system runs on Node.js (inherently cross-platform), but scripts must not assume Unix-only utilities or path separators. Use `path.join()` / `path.resolve()` — never hardcode `/` or `\`. See root `AGENTS.md` → Cross-Platform Policy for the full workspace-wide policy.

---

## Plugin Module Convention

<a name="c51"></a>
29. **`personas/plugins/` uses CommonJS.** All modules under `personas/plugins/` use `module.exports` / `require()` syntax. This is required because the build config loader (`personas/persona-build.config.js`) is itself CommonJS and loads plugins via `require()`. Do not convert these modules to ESM.

<a name="c52"></a>
30. **Test files use the `createRequire` bridge for CJS imports.** Test suites in `scripts/tests/` run under Vitest (ESM). To import CJS plugins, they use `createRequire(import.meta.url)` to create a Node.js `require()` function scoped to the test file's directory. See `scripts/tests/README.md` for the full pattern and rationale.

<a name="c53"></a>
31. **New plugins must follow the CJS convention.** Any future plugin added to `personas/plugins/` should use CommonJS (`module.exports`) and be imported via `require()` in the build config. Corresponding tests should use the `createRequire` bridge pattern.
