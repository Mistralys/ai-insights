# Personas Changelog

## v3.9.1 - Housekeeping: Helper Unification & Strict-Mode Robustness

### Script Refactors
- **`validateFileName(persona, fieldName, suite)`**: Unified `validateCcFileName` and `validateVsFileName` into a single function in `scripts/lib/persona-helpers.js`. Three call sites in `build-personas.js` updated. The `fieldName` parameter makes the validated field explicit and is included in error messages.
- **`extractMcpServers()` deduplication**: Replaced `Array.includes()` with `Set`-based deduplication. Preserves insertion order (ES2015+) for stable YAML output across repeated builds.
- **Fenced-block stripping in `--strict` scan**: `build-personas.js` now strips fenced code blocks (`/\`\`\`[\s\S]*?\`\`\`/g`) from a scan copy of the output before the unresolved-marker regex runs. Eliminates the GN-4 false-positive risk documented in [constraint 10](docs/agents/project-manifest/constraints.md#c10).

### Persona Updates
- **Unit Test Auditor v1.0.3**: Description field updated to verb-forward, purpose-specific text (`Audit unit test coverage...`).

### Documentation Updates
- **`personas/docs/agents/project-manifest/constraints.md`**: Added `<a name="cN"></a>` named anchors to all 47 constraints (c1–c47). Updated GN-4 note to reflect active mitigation status (WP-002).
- **`personas/docs/agents/project-manifest/api-surface.md`**: Replaced `validateCcFileName`/`validateVsFileName` rows with unified `validateFileName` row; updated module count from 13 to 12; updated `--strict` GN-4 limitation note to reflect active fenced-block stripping.
- **`personas/docs/agents/project-manifest/file-tree.md`**: Added `scripts/lib/` and `scripts/tests/` directory entries with descriptions.
- **Cross-references updated to anchor links**: `api-surface.md` (constraints.md#c10), `standalone/README.md` (constraints.md#c19), `changelog.md` (constraints.md#c13), `constraints.md` self-reference (#c34).

### Test Suite
- **`scripts/tests/persona-helpers.test.js`**: Updated for unified `validateFileName`. Added 7th test case: `includes the fieldName in the error message`.

---

## v3.9.0 - Build Pipeline Fixes & `mcpServers` Auto-Injection

### Build Script Fixes
- **VS Code output filename fix**: `buildForTarget()` in `scripts/build-personas.js` now derives the output filename from the YAML-declared `vs_file_name` (VS Code) or `cc_file_name` (Claude Code) fields instead of using the content template basename. All 24 VS Code output files now correctly use the `.agent.md` extension (e.g. `researcher.agent.md`, `3-dev.agent.md`), aligning the build output with [constraint 13](docs/agents/project-manifest/constraints.md#c13). Generated output files in `personas/ledger/vs-code/` and `personas/standalone/vs-code/` were regenerated with the correct naming.

### New Feature: `mcpServers` Auto-Injection for Standalone Claude Code Personas
- **`extractMcpServers(tools)` helper**: Added to `scripts/build-personas.js`. Filters tool entries containing `/`, extracts unique server name prefixes (e.g. `central_pm/*` → `central_pm`), and builds the YAML block string for frontmatter injection.
- **`FRONTMATTER_STANDALONE_CC` template updated**: Conditionally injects a `mcpServers` block via `{{mcp_servers_yaml}}` variable. Personas with MCP tool entries in `tools` (format `server/*`) receive the block; personas with no such entries produce no block. Fully constraint-21 compliant: server names are derived from per-persona `tools` entries, not from `_shared.yaml`.
- **`ledger-bootstrapper.md`** (standalone Claude Code) now includes `mcpServers:\n  - central_pm` in frontmatter, making the persona functional in Claude Code.

### Documentation Updates
- **`personas/standalone/README.md`**: Updated "Claude Code — MCP Server Auto-Injection" section to reflect the implemented fix. Documents `extractMcpServers()` mechanism, `tools` vs `cc_tools` design decision, and constraint-21 compliance. Removed previous workaround references.
- **`personas/docs/agents/project-manifest/constraints.md`**: Renumbered all constraints into a clean monotonic 1–47 top-to-bottom sequence with no gaps. The missing constraint 38 gap is filled (`mcp_server_name` ↔ `.mcp.json`). Former constraints 44–45 (canonical pipeline ordering, WP-ID auto-generation) are repositioned as 39–40. All cross-references updated (constraint 19 in standalone README, constraint 39–40 in changelog, constraint 10 and 34 in api-surface.md).

---

## v3.8.1 - 9-Agent Personas Rework (Post-Synthesis Polish)

### Documentation
- **`personas/standalone/README.md`** (new): User-facing guide for all 15 standalone personas. Covers the PM sub-agent cluster (WP Decomposer → Dependency Sequencer → Pipeline Configurator → Ledger Bootstrapper) with ASCII flow diagram, full persona catalog table sourced from YAML, Claude Code limitations (`mcpServers` gap for `ledger-bootstrapper`), and build/sync cross-references.
- **`personas/docs/agents/project-manifest/constraints.md`**: Added two new constraints in the Cross-System Dependencies section:
  - **Constraint 39**: Canonical Pipeline Stage Ordering Is a Hard Runtime Constraint — `active_pipeline_stages` must be a strict subsequence of `CANONICAL_PIPELINE_ORDERING`; stages may be omitted but never reordered; `ledger_create_work_package` enforces this at runtime.
  - **Constraint 40**: Work Package IDs Are Auto-Generated — agents must not pass `work_package_id`, must capture the returned ID from the tool response, and must use the captured ID in `dependencies` arrays.
- **`personas/docs/agents/project-manifest/file-tree.md`**: Added `standalone/README.md` annotation (hand-authored, user-facing guide).
- **`personas/ledger/README.md`**: Updated workflow overview to reflect 9-agent layout with optional Security Audit (stage 5) and Release Engineering (stage 7) stages; replaced stale 4-stage fixed-loop reference.

### Ledger Persona Updates
- **Reviewer (6)**: Mission statement polish — "secure" → "well-architected" to align with the Security Auditor's dedicated security ownership. Generated `6-reviewer` output in both VS Code and Claude Code targets reflects the update.

### Shared Partial Updates
- **`release-engineer-output-format.md`**: Added explicit comment `type` documentation, mirroring `security-auditor-output-format.md`. Types: `"release-note"` (user-facing changelog entries), `"breaking-change"` (migration-required), `"version-decision"` (semver rationale), `"improvement"` (non-blocking observations).

### Script Fixes
- **`scripts/check-known-roles.js`**: Success message now includes role count in output: `[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync (9 roles).`

---

## v3.8.0 - 9-Agent Personas & PM Sub-Agents

### New Ledger Personas
- Security Auditor v3.6.1: New agent at pipeline position 5. Full structured review with OWASP Top 10 coverage (A01–A10), severity classification (Critical/High/Medium/Low/Info), and evidence requirements. FAIL routes back to Developer for remediation.
- Release Engineer v3.6.1: New agent at pipeline position 7. Covers semver decision tree, changelog curation, migration guides, and deployment readiness. FAIL = self-rework (mirrors Documentation pattern).

### Renumbered Ledger Personas
- Reviewer (5→6): Renumbered to accommodate Security Auditor. `id` field stable: `ledger-5-reviewer`.
- Documentation (6→8): Renumbered to accommodate Release Engineer. `id` field stable: `ledger-6-docs`.
- Synthesis (7→9): Renumbered. `id` field stable: `ledger-7-synthesis`.

### Updated Ledger Personas
- Project Manager v3.6.0: Replaced monolithic WP creation workflow with 4-sub-agent orchestration (WP Decomposer → Dependency Sequencer → Pipeline Configurator → Ledger Bootstrapper). PM now delegates WP decomposition and ledger setup to focused sub-agents.
- Developer v3.6.1: Added "Declare All Artifacts" strict constraint — instructs Developer to list ALL modified files in `artifacts.files_modified` when completing a pipeline, including ancillary or out-of-scope files.
- Reviewer v3.6.0: Security review responsibility moved to Security Auditor. Security & Performance review dimension replaced with Performance-only. Added explicit delegation callout: "Security concerns are handled by the Security Auditor in a dedicated pipeline stage." FAIL criteria no longer includes security vulnerabilities — now scoped to bugs and maintainability concerns only.

### New Standalone PM Sub-Agents
- WP Decomposer v1.0.0: Analyzes plan document and decomposes it into atomic work package definitions (`work-packages-draft.md`).
- Dependency Sequencer v1.0.0: Maps WP dependencies and produces ordered `dependency-analysis.md`.
- Pipeline Configurator v1.0.0: Selects pipeline stage composition for each WP and produces `pipeline-configuration.md`. Includes explicit decision criteria for 5 composition scenarios.
- Ledger Bootstrapper v1.0.0: Calls `ledger_initialize_project` and `ledger_create_work_package` for all WPs. Auto-captures returned WP IDs for dependency arrays. Note: Claude Code builds lack MCP access (standalone CC frontmatter template has no `mcpServers` support).

### New Shared Partials
- `security-auditor-operational-protocol.md`: OWASP A01–A10 review methodology with severity classification and evidence requirements.
- `security-auditor-output-format.md`: Findings format and `security_issues` metric guidance (Critical+High only).
- `release-engineer-operational-protocol.md`: Semver decision tree, changelog curation, migration guide, deployment readiness check, and self-rework guidance.
- `release-engineer-output-format.md`: Summary, artifacts, and comments format for release engineering pipeline.

## v3.7.3 - Per-Persona Model Field
- Ledger: Added `default_model: "Claude Sonnet 4.6"` to `_shared.yaml` as suite-wide model default.
- Ledger: Planner (1) and Project Manager (2) now specify `model: "Claude Opus 4.6"` in per-persona YAML; Agents 3–7 inherit `default_model`.
- Build: Added `model: '{{model}}'` to `FRONTMATTER_LEDGER_VSCODE` template.
- Build: Added model resolution chain in `buildForTarget()`: per-persona `model` → `default_model` → `cc_model` → `'inherit'`.
- Build: Unified `cc_model` derivation — now resolved from the computed `model` value rather than passing through `_shared.cc_model` directly.
- Docs: Documented `default_model`, `model`, and `cc_model` resolution chain across manifest API surface, constraints, and data-flows.

## v3.7.2 - CTX Architect Persona
- CTX Architect v1.0.0: New standalone persona for CTX Generator documentation workflows.
- Build: Extracted shared Claude Code frontmatter fields into a helper to eliminate duplication.
- Docs: Added Log-Prefix Convention section documenting severity prefixes.
- Docs: Updated frontmatter templates to reflect helper extraction.

## v3.7.1 - Developer
- Developer v3.6.1: Compressed overly verbose operational protocol.

## v3.7.0 - ID Update
- VS Code: Using IDs for agent handoffs in `runSubagent` tool.
- Planner v1.3.2: Added ID.
- Project Manager v3.6.0: Added ID + handoff fix.
- Developer v3.6.0: Added ID + handoff fix.
- QA v3.6.0: Added ID + handoff fix.
- Reviewer v3.6.0: Added ID + handoff fix.
- Documentation v3.6.0: Added ID + handoff fix.
- Synthesis v3.5.3: Added ID.
- AgentsMD Curator v1.0.1: Added ID.
- Changelog Curator v1.1.1: Added ID.
- Composer Curator v1.0.1: Added ID.
- Manifest Curator v1.0.4: Added ID.
- Module Intent Archictect v1.0.3: Added ID.
- Orchestator Runner v1.0.2: Added ID.
- Readme Curator v1.2.2: Added ID.
- Researcher v1.0.2: Added ID.
- Unit Test Auditor v1.0.2: Added ID.
- Whatsnew Curator v1.0.1: Added ID.

## v3.6.3 - Strict Mode Limitations (2026-02-23)
- Docs: Documented strict-mode code-fence false-positive risk.
- Docs: Documented `--check` + `--strict` exit ordering behavior.
- Docs: Added `--strict` to quick-commands sections in suite READMEs.
- Build: Added inline comment documenting code-fence false-positive.

## v3.6.2 - cc_file_name Validation Guard (2026-02-23)
- Build: Added fail-fast guard when `cc_file_name` is missing from persona YAML.
- Build: Removed silent empty-string fallback for missing `cc_file_name`.
- Docs: Updated `cc_file_name` schema rows to document required-field behavior.

## v3.6.1 - Remove Vanilla Flat Files (2026-02-23)
- Vanilla: Deleted seven legacy flat persona files predating the template system.
- Docs: Updated vanilla README with canonical output directory redirect.

## v3.6.0 - Multi-IDE Persona Support (2026-02-23)
- Build: Added dual output directories for VS Code and Claude Code frontmatter.
- Build: Added `--target` CLI flag (`vscode`, `claude-code`, `all`).
- Template: Added `{{else}}` branch support to conditionals.
- Partials: Split handoff and preflight partials into platform-specific variants.
- Build: Added Claude Code frontmatter template with all required CC fields.
- Metadata: Added `cc_file_name`, `cc_tools` to persona YAML; CC settings to shared.
- Build: Added `cc_name`, `cc_description`, `cc_tools_json` computed variables.
- Standalone: Added Claude Code variants of all 6 standalone personas.
- Sync: Added Claude Code sync, validation, and directory-resolution functions.

## v3.5.4 - Preflight Simplification (2026-02-22)
- Project Manager v3.5.1: Simplified preflight and verbose sections.
- Developer v3.5.2: Simplified preflight and verbose sections.
- QA v3.5.3: Simplified preflight and verbose sections.
- Reviewer v3.5.4: Simplified preflight and verbose sections.
- Documentation v3.5.3: Simplified preflight and verbose sections.
- Synthesis v3.5.2: Simplified preflight and verbose sections.

## v3.5.3 - Reviewer Workflow Fix (2026-02-22)
- Reviewer v3.5.3: Removed phantom REWORK_REVIEW action; added acceptance criteria field.

## v3.5.2 - Incident Logging & Rework Handling (2026-02-22)
- QA v3.5.2: Added incident logging block and REWORK_QA handling.
- Reviewer v3.5.2: Added incident logging block.
- Documentation v3.5.2: Fixed REWORK action name; added rework handling and status tool.

## v3.5.1 - Persona Capabilities & Logging (2026-02-22)
- Developer v3.5.1: Added capabilities and rework sections; added observation tool.
- QA v3.5.1: Enabled incident logging.
- Reviewer v3.5.1: Enabled incident logging.
- Documentation v3.5.1: Removed unneeded handoff status tool.
- Synthesis v3.5.1: Demoted ledger help tool to note-only.
- Planner v1.3.1: Added clause for naming synthesis rework plans.

## v3.5.0 - Role Boundaries & Mandatory Handoffs (2026-02-22)
- Partials: Added `role-boundaries` fragment restricting tool use and WP scope.
- Partials: Changed handoff heading to "Handoff (mandatory)".
- Developer v3.5.0: Added repeat-loop workflow step and role scope constraints.
- All Ledger Personas v3.5.0, Planner v1.3.0: Initial changelogged versions.

## v3.4.1 - Standalone Persona Updates
- README Curator v1.2.1: Added helper section for rewriting entire READMEs.
- README Curator v1.2.0: Rewritten to produce better human-oriented output.
- Module Intent Architect v1.0.2: Improved documentation generation guidance.
- Changelog Curator v1.1.0: Refined entry verbosity rationales.
- Orchestrator Runner v1.0.1: Minor updates and fixes.

## v3.4.0 - Standalone Personas
- Changelog Curator v1.0.0: Initial release.
- Module Intent Architect v1.0.1: Initial pre-changelog version.
- Orchestrator Runner v1.0.0: Initial release.
- README Curator v1.1.0: Initial pre-changelog version.
- WHATSNEW Curator v1.0.0: Initial release.

## v3.3.0 - Two-Phase Pre-flight with Auto-Detect (2026-02-21)
- Ledger Personas 3–7: Replaced single-step pre-flight with detect + verify.
- Ledger Personas 3–7: Added `ledger_detect_project` to tools tables.

## v3.1.2 - Role Value Cross-Validation (2026-02-20)
- Sync: Added `KNOWN_ROLES` cross-validation for role frontmatter values.

## v3.1.1 - Automatic Handoffs
- Ledger Personas 2–7: Added automatic handoff via `ledger_get_handoff_status`.
- Sync: Added `validateLedgerFrontmatter()` for role/name field validation.

## v3.1.0 - Role Field in Persona Frontmatter
- Ledger Personas 1–7: Added `role:` field mapping to `AGENT_ROLES` constants.

## v3.0.2 - Pre-Flight Optimization
- Ledger Personas: Improved pre-flight tool discovery instructions.

## v3.0.1 - Pre-Flight Wording
- Ledger Personas: Tweaked pre-flight to avoid "Tools not found" messages.

## v3.0.0 - MCP Ledger
- Ledger Personas: Migrated ledger to dedicated MCP server.
- Ledger Personas: Refined pre-flight check sequence.

## v2.1.1 - Developer Fixes
- Developer: Small fixes.
- Developer, QA, Documentation: Added error logging.

## v2.1.0 - Split Work Packages
- Workflow: Introduced split-file architecture with per-WP specification files.
- Project Manager: Creates per-WP files in `work/` subfolder.
- Consumer Personas: Updated to reference individual WP files.

## v2.0.0 - Ledger Architecture (Breaking-S)
- Ledger: Switched to split-file architecture with per-WP detail files.
- Ledger: Renamed root index to `project-ledger.json`.

### Breaking Changes

The ledger switched from a single JSON file to a split-file architecture. The root
`project-ledger.json` is now a lightweight index; full WP data lives in `.ledger/WP-###.json`.

## v1.0.8 - Code Improvement Tracking
- Developer: Made commenting code a foundational role.

## v1.0.7 - Testing and Analysis
- Developer: Added testing and analysis capabilities.

## v1.0.6 - Autoloader Update Step
- Developer: Added step to regenerate autoloaders after adding new classes.

## v1.0.5 - Plan Folders
- Workflow: Per-project folders with simplified file names.
- Ledger: Moved to ledger personas folder; fixed paths.

## v1.0.4 - Agent Identification
- All Personas: Added `AGENT: Name` to ending status messages.

## v1.0.3 - Git Command Fix
- Planner, Developer: Added constraint against Git write commands.

## v1.0.2 - QA Handoff Fix
- QA: Clarified handoff for open WPs not assigned to Developer.

## v1.0.1 - VS Code Frontmatter Fix
- All Personas: Removed unsupported YAML properties; moved metadata to HTML comment.
- All Personas: Added version string to YAML `name`.

## v1.0.0 - Initial Release
- All Personas: Finalized workflow prompts with YAML frontmatter.
