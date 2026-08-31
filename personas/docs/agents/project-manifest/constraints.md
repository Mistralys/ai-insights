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

<a name="c4b"></a>
5b. **Reference documents stay separate from persona content — never embed.** When a persona always loads an external reference document (e.g., the Persona Curator loads `personas/docs/persona-design-guide.md`), keep the document as a separate file read via tool call at session start. Do not embed reference material into the persona content, even though the effective per-session token cost is the same. Rationale:

   - **Single source of truth.** Reference documents evolve independently. Embedding creates a second copy that can drift from the canonical file without automated detection.
   - **Multiple consumers.** Reference documents serve other agents, human authors, and audit workflows. Embedding does not eliminate the standalone file — it only duplicates it.
   - **Separation of concerns.** Persona content defines identity, methodology, and decision-making framework. Reference documents are consulted knowledge — analogous to config loaded at runtime, not hardcoded into source.
   - **Context efficiency.** A tool-call load enters the conversation at a specific point. Embedded system-prompt content competes for model attention on every turn, including simple follow-ups that do not need the reference.

<a name="c4c"></a>
5c. **Recurring Operating Philosophy principles use their canonical name from the registry below.** The [Persona Design Guide](../../persona-design-guide.md) § "Recurring Principles Across a Persona Suite" defines the naming rules; this registry is the project-local vocabulary those rules operate on. The guide is a distributed document used to curate persona suites in unrelated projects and domains, so the inventory of *this* project's principles belongs here rather than in the guide.

   **Canonical names:**

   | Canonical Name | Meaning | Carried By |
   |---|---|---|
   | **Durable Over Precise** | A statement that stays true across commits beats a precise one that goes stale. Counts, tallies, and inventories are the standard illustration. | AGENTS.md Curator, Manifest Curator, Module Intent Architect, Documentation Curator, README Curator, Unit Test Auditor, CTX Architect |
   | **Every Artefact Earns Its Place** | An artefact justifies the cost it imposes or it does not belong; exhaustiveness is not a virtue. The cost differs by domain — ongoing maintenance for the Workspace Architect, diluted signal for the CTX Architect — but the test is the same. Distinct from the Dependency Curator's **The Smallest Sufficient Move Carries the Least Risk**, which weighs upgrade distance rather than whether a thing earns its keep. | CTX Architect, Workspace Architect |
   | **Stratified Authority** | Command voice earns its weight from scarcity; a document written entirely in directives flattens into noise. | AGENTS.md Curator, Manifest Curator, Persona Curator |
   | **A Few Right Files Beat Many** | Targeted reading of the files where a question actually turns beats a wide sweep of the repository. The Sequencer applies it to candidate dependency pairs, the WP Decomposer to uncertain WP boundaries, the Pipeline Configurator to the symbols a narrowed stage chain depends on — same claim, different unit of uncertainty. | Ledger Dependency Sequencer, Ledger WP Decomposer, Ledger Pipeline Configurator |
   | **The Upstream Stage Already Looked** | Codebase facts recorded by an earlier pipeline stage are findings, not guesses, and re-deriving them spends the session twice. Deliberately named for the *relationship* rather than the specific predecessor: the Sequencer inherits the WP Decomposer's Code Observations, the WP Decomposer inherits the Planner's research brief, the Pipeline Configurator inherits both. A per-predecessor name ("The Decomposer Already Looked") forks on every new consumer. | Ledger Dependency Sequencer, Ledger WP Decomposer, Ledger Pipeline Configurator |
   | **A Missing Stage Costs More Than an Extra One** | Where two error directions have unequal cost, the cheap error is the correct default under uncertainty. Stated for pipeline stages: a redundant stage costs one run, a missing one ships a defect nothing downstream catches. Related to the Sequencer's **A Wrong Edge Costs More Than a Missing One**, which is the same asymmetry argument in the opposite direction for its own domain — both stay split, since unifying them would assert that the cheap error is the same error in both. | Ledger Pipeline Configurator |
   | **The Acceptance Criteria Decide, Not the Title** | A work item's declared label is not evidence of what it does; its deliverables and acceptance criteria are. | Ledger Pipeline Configurator |
   | **Context Completes the Insight** | A knowledge entry that cannot be acted on without its originating project has not carried its context. The Archiver applies it when deciding what narrative to commit; the Curator applies it when deciding whether a surviving entry still carries enough — same claim, opposite ends of an entry's life. The *type* of context differs by scope in both: class-of-problem framing for `global`, concrete identifiers for `repository`. | Ledger Knowledge Archiver, Ledger Knowledge Curator |
   | **The 30-Second Rule** | A reader reaches orientation within half a minute; anything slower belongs in a deeper document. | AGENTS.md Curator, Module Intent Architect |
   | **Long-Term Stability Over Expediency**, **Growth Is the Default**, **Completeness Over Deferral**, **The Practitioner's Eye** | The shared Developer philosophy. | `personas/shared/partials/developer-philosophy.md` — rendered by both the ledger and standalone Developer personas; never duplicated inline |
   | **Growth Is the Default**, **Completeness Over Deferral**, **Long-Term Stability Over Expediency** | The shared Planner philosophy. Same three canonical names as the Developer philosophy above, stated for the planning domain (a plan step rather than a class) — the two partials carry different bodies under the same names, which is the guide's "bodies are authored, not copied" rule applied across suites. | `personas/shared/partials/planner-philosophy.md` — rendered by both the ledger and standalone Planner personas; never duplicated inline |
   | **Refactoring Is Always on the Table**, **Adjacent Improvement Is the Only Improvement** | Planner-only by design. Reshaping scope and adjacent improvements are decided *in the plan*, never during implementation — the Developer's scope table deliberately excludes refactoring campaigns and routes anything it notices into observations, which feed a rework plan. Adding either principle to a Developer persona would break that division of labour. | `personas/shared/partials/planner-philosophy.md` — must **not** be extended to the Developer personas |

   **Known collisions — deliberately not unified:**

   | Name | Why it stays split |
   |---|---|
   | **Quality Over Quantity** | The two knowledge personas (Archiver, Curator) mean a sparse knowledge base outperforms a dense one — one meaning, shared, and canonical between them. The Recipe Curator means fewer, better ingredients. That second meaning is coincidence, not a shared principle — unifying it with the knowledge sense would assert a relationship that does not exist. The Recipe Curator may not reference the knowledge meaning, nor the knowledge personas the ingredient one. |

   A principle appearing in a second persona is added to this registry at that point, which is what keeps its name from forking. Renaming a registered principle requires updating every persona listed against it in the same change.

<a name="c4d"></a>
5d. **Published artifacts carry no project-specific content.** Some files in this repository are consumed by unrelated downstream projects, which fetch them over HTTPS and overwrite their local copy on every sync. AI-Insights-specific content added to one of them ships to every consumer, and they cannot remove it — the next sync restores it.

   **Published artifacts:**

   | Artifact | How to recognise it | Downstream consumption |
   |---|---|---|
   | `personas/docs/persona-design-guide.md` | `**License:**` / `**Author:**` / `**Source:**` header block | Fetched by `nexus-personas` (`scripts/sync-persona-design-guide.js`, plus a scheduled Gitea Actions workflow); local copies also exist in `hcp-editor` and `nexus-plugins` |
   | `personas/standalone/src/content/persona-curator.md` | Consumed as source by downstream builds | Fetched by the same sync script; downstream treats its local copy as read-only under a MUST-level constraint |

   **Rules:**

   - **The guide is domain-neutral.** Downstream suites cover non-coding domains — recipes, content curation, research. A rule stated in the guide holds for any persona suite; an inventory, a file path under `personas/ledger/`, or a reference to this workspace's tooling does not belong there. Project-specific vocabulary and conventions go into this constraints document instead, as C5c does.
   - **The Persona Curator degrades gracefully.** Instructions in the Curator reference project infrastructure conditionally ("where the project maintains a registry…"), never unconditionally. A step that assumes this workspace's layout is a step that misfires in every downstream project.
   - **One section heading is a hard downstream contract; the rest are unverified.** `nexus-personas` injects a partial into `persona-curator.md` by anchoring on the literal string `\n\n## Operating Philosophy\n`, and its sync throws a hard error when the anchor is missing. That heading is load-bearing and must not be renamed or removed. Other top-level headings in either file have no *known* consumer, but downstream projects are not fully surveyed — so flag a proposed rename for the user and let them confirm, rather than either applying it silently or refusing it outright. Adding a heading and reordering existing ones are both safe. (`## Strict Constraints` → `## Core Rules` was renamed in the Curator on 2026-08-26 after the user confirmed no consumer.)
   - **Version and changelog are the sync signal.** Both files carry a version and changelog block that downstream consumers read to detect drift. Content changes bump the guide's version in the same change.

   > **Why this needs stating:** these files look exactly like ordinary project documentation from inside the workspace — same directory, same Markdown, same Git history. The only in-file signal is the header block, which is easy to read past. When in doubt, check whether the file appears in the table above.

<a name="c4e"></a>
5e. **This project's persona layout is not the layout the Persona Curator can assume.** Because `persona-curator.md` is published (C5d), it describes persona work in role terms — "the project's copy of the guide", "the persona's metadata file", "per-target output directories" — rather than naming paths. Downstream consumers use a flat `personas/src/` + `personas/meta/` layout with no suite subdivision and different target directories, so a hardcoded path in that file is wrong everywhere except here.

   The concrete values for **this** workspace:

   | Concept (as the Curator names it) | This project's path |
   |---|---|
   | The project's copy of the Design Guide | `personas/docs/persona-design-guide.md` — the first entry in the Curator's lookup order, so no search is needed here. The filename is invariant across projects; only the directory varies (downstream consumers use `docs/persona-design-guide.md`). Moving this file requires updating that lookup order, since it would otherwise fall through to the search fallback. |
   | Persona source content files | `personas/ledger/src/content/`, `personas/standalone/src/content/`, `personas/ledger-support/src/content/` |
   | Persona metadata files | `personas/{suite}/src/meta/` (see [C2a](#c2a) for the full directory table) |
   | Per-target generated output | `personas/{suite}/vs-code/`, `personas/{suite}/claude-code/`, `personas/{suite}/deep-agents/` — never edited ([C1](#c1)) |
   | Metadata fields for a new persona | `slug`, `name`, `description`, `id`, `vs_file_name`, `cc_file_name`, `tools`, `changelog` (see [C11](#c11)–[C15](#c15) for naming rules) |
   | The project's persona changelog | `personas/changelog.md` |
   | The persona build command | `node scripts/build-personas.js` ([C3](#c3) covers the full edit → build → sync workflow) |

   An agent operating the Curator inside this workspace resolves the role terms against this table. An agent editing the Curator keeps the role terms in place — adding a path back into that file re-breaks every downstream consumer.

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

   > ⚠️ **`standalone-*` namespace is CLOSED to new personas.** The `standalone-*` id prefix is **permanently reserved** for those 9 historically migrated personas only. **Never assign a `standalone-{slug}` id to any new ledger-support persona** — even when the slug itself begins with "standalone-". All new ledger-support personas must use the `ledger-support-{slug}` prefix without exception.

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

<a name="c26b"></a>
21b. **Model registry assignments take precedence over YAML model fields.** The GUI-managed model registry (`personas/model-registry/`) adds a higher-priority layer above the YAML-based model fields. The full model resolution priority chain for the effective model slug consumed at runtime is:

   1. **Per-persona GUI assignment** — `assignments.json` → `persona_models[persona.id]`, resolved to a slug via `getResolvedAssignments()` in `mcp-server/src/gui/model-registry.ts`.
   2. **Workspace-default GUI assignment** — `assignments.json` → `default_model_uuid`, resolved to a slug.
   3. **Per-persona YAML override** — `model_slug` field in the persona's `N-*.yaml` file.
   4. **Suite default** — `_shared.yaml` → `default_model_slug`.

   The persona `id` field is the stable key used in `assignments.json`. Assignments survive persona renames and slug changes because they are keyed by UUID, not by slug. The build system and orchestrator resolve this chain locally at startup; the GUI surfaces resolved slugs via `GET /api/personas`. Do not read YAML model fields to determine the effective model when GUI assignments may be active.

<a name="c27"></a>
22. **`cc_model` resolution chain:** The Claude Code `model` frontmatter value is resolved in Layer 3 as: `persona.cc_model → persona.model → _shared.default_model → _shared.cc_model`. This means a per-persona `cc_model` takes highest priority, followed by the persona's VS Code `model` override, then the shared default model, and finally the shared `cc_model` value (typically `"inherit"`).

<a name="c28"></a>
23. **`default_version` is required in all `_shared.yaml` files.** Its absence is a **fatal build error** — the library emits `[ERROR] Missing 'default_version' in <suite>/_shared.yaml` and exits with code 1. Without this field, the generated output would contain the string `"undefined"` as the version, a silent corruption that is hard to detect post-build. This check applies to both suites (ledger, standalone).

<a name="c29"></a>
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

## Audit Tracking

<a name="c50a"></a>
25a. **`audit_guide_version` and `audit_date` track design guide compliance.** Two optional YAML metadata fields record whether a persona has been audited against the Persona Design Guide:

   ```yaml
   audit_guide_version: "2.8"
   audit_date: "2026-08-25"
   ```

   - **`audit_guide_version`** — the version of the Persona Design Guide the persona was last audited against. Set by the Persona Curator on a PASS verdict.
   - **`audit_date`** — the date the audit was performed. Set alongside `audit_guide_version`.
   - **Not set on NEEDS WORK** — personas that fail audit retain their previous values (or none) until fixes are applied and the persona is re-audited.
   - **Consumed by `scripts/generate-persona-audit.js`** — the audit tracking script reads these fields to auto-derive status: current (matches the latest guide version), stale (audited against an older version), or unaudited (fields absent).
   - **Not consumed by the build system** — these fields are silently ignored by the template engine and have no effect on generated output.
   - **Process state does not belong here.** These two fields are facts about the persona. Facts about the *audit process* — "paired audit with twin", "tone fix only" — go in `personas/docs/audits/annotations.json` instead, keyed by suite and persona YAML stem. The two have different lifecycles, and mixing them puts editorial commentary into build-input metadata.
   - **The audit record lives in `personas/docs/audits/`**, split three ways: `status.md` (fully generated — never hand-edit), `notes.md` (hand-written narrative, cumulative), and `annotations.json` (Notes-column text). See that folder's `README.md`.

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

---

## Overview Metadata Requirements

<a name="c54"></a>
32. **`identity` is required in every persona YAML.** All personas across all three suites (ledger, standalone, ledger-support) must have a top-level `identity:` field whose value matches the role title in the `**Identity: {{identity}}.**` mission header. This field is the single source of truth for the persona's role label and is used by `scripts/generate-agents-overview.js`.

<a name="c55"></a>
33. **Overview metadata fields must be kept current.** When a persona's purpose, behavior, or operating modes change, update the corresponding YAML fields: `use_when` (standalone/support), `key_behavior` (all suites), `modes` (personas with distinct modes), `inputs`/`outputs` (ledger personas), `notes` (optional freeform). After modifying any overview field, run `node scripts/generate-agents-overview.js` (or `node scripts/cli.js build-maintain`) to regenerate `docs/agents-overview.md`.

<a name="c56"></a>
34. **Do not edit `docs/agents-overview.md` manually.** The file is generated by `scripts/generate-agents-overview.js` from persona YAML metadata. Manual edits will be overwritten on the next generation run. The generated-by comment at the top of the file marks it as auto-generated. To change overview content, update the persona YAML fields or the header template at `scripts/templates/agents-overview-header.md`.

---

## Insight Capture Constraints

<a name="c57"></a>
35. **`insight-capture.md`, `insight-compilation.md`, and `mcp-insight-capture.md` are parameterised shared partials.** They live in `personas/shared/partials/` and follow the same structural precedent as `ax-feedback.md`: short, suite-agnostic behavioural fragments. Ledger personas (agents 3–6, 8) use `mcp-insight-capture.md` (parameterised by `{{insight_pipeline_type}}`), which routes observations through `ledger_add_observation`. Standalone personas use `insight-capture.md` and `insight-compilation.md` (parameterised by `{{insight_agent}}` and `{{insight_report_target}}`), which route through the `insights.jsonl` sidecar.

<a name="c58"></a>
36. **Metadata pairing rules.** For standalone personas: `insight_agent` and `insight_report_target` must be declared as a pair; standalone personas (no `role`) are exempt from the identity check. For ledger personas: `insight_pipeline_type` must match the persona's pipeline type from `PIPELINE_AGENT_MAP`.

<a name="c59"></a>
37. **Verdict-affecting findings must never be routed through observation channels.** Findings that determine a PASS/FAIL verdict (e.g., the Security Auditor's `vulnerability` and `risk` types, the Reviewer's blocking findings) must go through their normal findings channel only. Observation channels (MCP or sidecar) carry only non-blocking observations.

<a name="c60"></a>
38. **A capture partial must always be accompanied by an action gate.** Placing `{{> insight-capture}}` or `{{> mcp-insight-capture}}` in the observation section alone makes the capture described but never triggered. Each consuming persona must also bind an explicit capture instruction to a concrete step of its Operational Protocol — without this, the partial delivers end-of-session reconstruction, not incremental capture.
