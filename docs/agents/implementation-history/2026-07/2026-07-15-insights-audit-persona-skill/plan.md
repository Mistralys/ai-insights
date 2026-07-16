
# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context
The workspace's strategic vision emphasizes "Personas first" and minimizing friction. The Persona Curator is a mature standalone persona (v1.3.0) with a well-defined Audit mode. The nexus-personas project at `/Users/smordziol/Webserver/Workspaces/nexus-personas/DEV/nexus-personas` provides a proven reference implementation for building skills via `@mistralys/persona-builder`'s `TargetRegistry` API.

## Summary
Add an `insights-audit-persona` skill that launches the Persona Curator agent in Audit mode via `context: fork`. The skill is built using the `@mistralys/persona-builder` infrastructure (custom `TargetRegistry` with `vscode-skill` and `claude-skill` targets), following the established pattern from the nexus-personas project. The plan introduces the full skills build pipeline for ai-insights: source directory, build script, publish script, and CLI integration — so that future skills can be added by simply creating a YAML + Markdown pair.

## Architectural Context
- **Persona Builder** (`personas/node_modules/@mistralys/persona-builder`) provides `build()` and `TargetRegistry` APIs that support custom targets with custom frontmatter templates.
- **Existing persona build** uses `scripts/build-personas.js` which delegates to the persona-builder CLI. Skills cannot use the CLI because they need a custom `TargetRegistry`, so the build script will call the `build()` API directly (matching the nexus-personas pattern).
- **Existing skill** — `.github/skills/release-check/` is hand-written and will coexist with built skills.
- **Persona Curator** is a standalone persona at `personas/standalone/src/` with slug `persona-curator`, `vs_file_name: persona-curator.agent.md`, `cc_file_name: persona-curator.md`.

## Approach / Architecture

1. Create a `skills/` directory at workspace root with the standard persona-builder suite layout (`src/` for content, `meta/` for YAML metadata).
2. Create `scripts/build-skills.js` — an ESM script that calls the persona-builder `build()` API with a custom `TargetRegistry` containing two skill targets (`vscode-skill`, `claude-skill`). Outputs to `dist/vscode-skills/` and `dist/claude-skills/`.
3. Create `scripts/publish-skills.js` — copies built skill files from `dist/` into `.github/skills/{stem}/SKILL.md` and `.claude/skills/{stem}/SKILL.md`.
4. Add CLI commands (`build-skills`, `publish-skills`) to `scripts/cli.js`.
5. Write the `insights-audit-persona` skill content and metadata.

## Rationale
- **Reusing persona-builder infrastructure** avoids duplicating template rendering, conditional logic, and validation. It also means skill content benefits from partials, variables, and the same build/check/strict pipeline.
- **Separate build script** (not merged into `build-personas.js`) because skills use a different `TargetRegistry`, different frontmatter, and serve a different purpose. Clean separation avoids polluting the persona build config.
- **API call instead of CLI** because the persona-builder CLI doesn't support custom `TargetRegistry` injection — only config-file loading (which uses the `defaultRegistry`).
- **ESM format** for build-skills.js to match the workspace root's `"type": "module"` convention and the existing `build-personas.js` which also uses ESM imports.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Build system | persona-builder `build()` API with custom TargetRegistry | Hand-written template rendering; persona-builder CLI with config hack | API call is the proven nexus pattern; CLI doesn't support custom registries; hand-writing duplicates logic. |
| Source location | `skills/` at workspace root | Under `personas/skills/` | Root-level mirrors the nexus convention and keeps skills independent of the persona suite hierarchy. |
| Script separation | Separate `build-skills.js` + `publish-skills.js` | Combined into `build-personas.js` | Clean separation — different registry, different frontmatter, different output. The persona build is already complex. |
| Module format | ESM (`import`) with `createRequire` for persona-builder import | CJS `require()` | Workspace root is `"type": "module"`; ESM is the convention. `createRequire` needed because persona-builder is installed in `personas/node_modules/`, not the root. |

## Pattern Alignment
- **Custom TargetRegistry pattern** — follows the API call pattern of `nexus-personas/scripts/build-skills.js`.
- **Build + publish separation** — follows `nexus-personas` pattern and mirrors `build-personas.js` + `sync-personas.js` separation.
- **Suite directory layout** (`src/` + `meta/`) — standard persona-builder convention per `ai-persona-builder/docs/agents/project-manifest/data-flows.md`.
- **CLI integration** — follows existing `build-personas` and `sync-personas` command patterns in `scripts/cli.js`.
- **Skill frontmatter** — follows the agentskills.io standard documented in `ai-persona-builder/docs/target-differences.md`.

## Detailed Steps

### 1. Create skills source directory structure

Create the following structure at the workspace root:

```
skills/
├── meta/
│   ├── _shared.yaml
│   └── insights-audit-persona.yaml
└── src/
    └── insights-audit-persona.md
```

### 2. Create `skills/meta/_shared.yaml`

Shared metadata defaults for all skills:

```yaml
default_version: '1.0.0'
```

### 3. Create `skills/meta/insights-audit-persona.yaml`

Skill metadata:

```yaml
name: insights-audit-persona
description: "Audit an existing AI agent persona against the Persona Design Guide. Use when: checking persona compliance, reviewing persona structure, validating persona quality, auditing persona against design guide."
context: fork
agent: persona-curator
changelog: |
  1.0.0 (2026-07-15): Initial release — launcher skill for Persona Curator Audit mode.
```

Key fields:
- `context: fork` — runs the skill in an isolated subagent.
- `agent: persona-curator` — delegates to the Persona Curator agent (matches the deployed agent filename stem in both VS Code and Claude Code).

### 4. Create `skills/src/insights-audit-persona.md`

Skill content — instructs the Persona Curator to enter Audit mode:

```markdown
# Audit Persona Against Design Guide

Audit the specified persona(s) against the Persona Design Guide.

## Instructions

Enter **Audit mode** and execute the full audit workflow:

1. Read the Persona Design Guide at `personas/docs/persona-design-guide.md`.
2. Identify the target persona(s) — ask the user if not specified.
3. Evaluate each persona against the Quality Checklist.
4. Produce the Audit Report using the standard template.
```

### 5. Create `scripts/build-skills.js`

ESM script that:

1. Clears `dist/vscode-skills/` and `dist/claude-skills/` output directories.
2. Creates a custom `TargetRegistry` with two targets:
   - `vscode-skill` — frontmatter: `name`, `description`, conditional `argument-hint`.
   - `claude-skill` — frontmatter: `name`, `description`, conditional `context`, conditional `agent`.
3. Configures a single `skills` suite pointing at `skills/` source directory.
4. Calls `build()` with the custom registry and explicit target list.
5. Reports results and exits with appropriate code.

Uses `createRequire` to import `@mistralys/persona-builder` from `personas/node_modules/`.

Supports `--check` and `--strict` flags (same as `build-personas.js`).

### 6. Create `scripts/publish-skills.js`

ESM script that:

1. Reads built `.md` files from `dist/vscode-skills/` and `dist/claude-skills/`.
2. For each file, creates `{stem}/SKILL.md` directory structure.
3. Copies to `.github/skills/` (VS Code) and `.claude/skills/` (Claude Code).
4. Clears target skill directories before publishing (full clear, same as nexus pattern).
5. Reports results.

### 7. Add CLI commands to `scripts/cli.js`

Add two new commands:
- `build-skills` — invokes `scripts/build-skills.js` with forwarded flags.
- `publish-skills` — invokes `scripts/build-skills.js` first, then `scripts/publish-skills.js`.

Follow the existing pattern used by `build-maintain` (which internally invokes `build-personas.js`) and `sync-personas` commands.

### 8. Add `dist/vscode-skills/` and `dist/claude-skills/` to `.gitignore`

Ensure build output directories are not tracked in Git.

### 9. Run build and publish

Execute `node scripts/build-skills.js` to verify the build produces correct output, then `node scripts/publish-skills.js` to deploy to `.github/skills/` and `.claude/skills/`.

## Dependencies
- `@mistralys/persona-builder` (already installed in `personas/node_modules/`)
- No new dependencies required

## Required Components
- `skills/meta/_shared.yaml` (new)
- `skills/meta/insights-audit-persona.yaml` (new)
- `skills/src/insights-audit-persona.md` (new)
- `scripts/build-skills.js` (new)
- `scripts/publish-skills.js` (new)
- `scripts/cli.js` (modification — add `build-skills` and `publish-skills` commands)
- `.github/skills/insights-audit-persona/SKILL.md` (new — generated output)
- `.claude/skills/insights-audit-persona/SKILL.md` (new — generated output)
- `.gitignore` (modification — add dist skill dirs)

## Assumptions
- The `@mistralys/persona-builder` package installed in `personas/node_modules/` exports `build` and `TargetRegistry` and is accessible via `createRequire`.
- The Persona Curator agent is already deployed to both `.github/agents/` (VS Code) and `.claude/agents/` (Claude Code) with filename stems `persona-curator.agent` and `persona-curator` respectively.
- The `agent` field in skill frontmatter correctly references agents by their filename stem (without extension).

## Constraints
- VS Code's `context: fork` for skills is experimental and may require an opt-in setting.
- The `agent` field for VS Code skills is currently agent-agnostic when using fork — VS Code ignores it and spins up a generic subagent. Claude Code fully supports agent targeting.
- Skills are NOT personas — they use a separate frontmatter schema (agentskills.io standard) and deploy to `skills/` directories, not `agents/`.

## Out of Scope
- Migrating the existing hand-written `release-check` skill to the built system.
- Adding skills to the pre-commit hook or CI pipeline.
- Adding skills to the persona `--check` freshness validation.
- Deep Agents target for skills (not applicable — skills are IDE-specific).

## Acceptance Criteria

- AC-01: `skills/meta/insights-audit-persona.yaml` exists with `name`, `description`, `context: fork`, `agent: persona-curator`, and a `changelog` entry.
- AC-02: `skills/src/insights-audit-persona.md` exists with skill content that instructs the Persona Curator to enter Audit mode.
- AC-03: `scripts/build-skills.js` exists and can be run with `node scripts/build-skills.js` to produce files in `dist/vscode-skills/` and `dist/claude-skills/`.
- AC-04: Built VS Code skill output includes frontmatter with `name` and `description` fields but NOT `context`, `agent`, or `argument-hint` (since this skill has none).
- AC-05: Built Claude Code skill output includes frontmatter with `name`, `description`, `context: fork`, and `agent` fields.
- AC-06: `scripts/publish-skills.js` exists and deploys skills to `.github/skills/{stem}/SKILL.md` and `.claude/skills/{stem}/SKILL.md`.
- AC-07: `scripts/cli.js` has `build-skills` and `publish-skills` commands.
- AC-08: `dist/vscode-skills/` and `dist/claude-skills/` are in `.gitignore`.
- AC-09: The full pipeline (`build-skills` → `publish-skills`) produces `.github/skills/insights-audit-persona/SKILL.md` and `.claude/skills/insights-audit-persona/SKILL.md` with correct frontmatter and content.

## Testing Strategy
Manual verification: run the build and publish pipeline end-to-end and inspect the output files for correct frontmatter, content rendering, and directory structure. The persona-builder's own test suite covers template rendering, conditional resolution, and validation — the skill build leverages those guarantees.

## Test Plan
- Manual: run `node scripts/build-skills.js` — verify exit 0, files created in `dist/vscode-skills/` and `dist/claude-skills/` — covers AC-03
- Manual: inspect `dist/vscode-skills/insights-audit-persona.md` frontmatter — verify `name`, `description`, `agent` present, `context` absent — covers AC-04
- Manual: inspect `dist/claude-skills/insights-audit-persona.md` frontmatter — verify `name`, `description`, `context: fork`, `agent` present — covers AC-05
- Manual: run `node scripts/publish-skills.js` — verify `.github/skills/insights-audit-persona/SKILL.md` and `.claude/skills/insights-audit-persona/SKILL.md` created — covers AC-06, AC-09
- Manual: run `node scripts/build-skills.js --check` — verify exits 0 with `totalBuilt > 0` and `totalWritten: 0` (no files written in check mode) — covers AC-03

## Documentation Updates
- `AGENTS.md` — add `scripts/build-skills.js` and `scripts/publish-skills.js` to Root-Level Tooling table; add skills directory to workspace structure.
- Root `README.md` — add skills section if CLI commands are documented there.
- `docs/references/menu-guide.md` — add `build-skills` and `publish-skills` rows to the Personas table in the Menu Items section; add example invocations to the Direct Commands block.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **`createRequire` path to persona-builder breaks if `personas/node_modules` structure changes** | Use `import.meta.resolve` or path-based resolution that mirrors `build-personas.js` pattern. |
| **VS Code ignores `agent` field on skill fork** | Documented in Constraints. The skill still works — VS Code forks a generic subagent and loads the skill content. Claude Code fully supports agent targeting. |
| **Publish script destroys hand-written `release-check` skill** | Accepted risk per user confirmation. If needed later, publish can be made incremental (only overwrite built skill directories). |
