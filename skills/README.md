# Skills Source Directory

This directory contains the source files for workspace skills — reusable AI agent workflows
that can be invoked from within VS Code (via Copilot) or Claude Code.

Skills are built using the `@mistralys/persona-builder` infrastructure with a custom
`TargetRegistry`. The build step (WP-002) produces output in `dist/vscode-skills/` and
`dist/claude-skills/`, which the publish step (WP-003) deploys to `.github/skills/` and
`.claude/skills/`.

---

## Directory Layout

```
skills/
├── meta/
│   ├── _shared.yaml          # Shared defaults (default_version)
│   └── {slug}.yaml           # Per-skill metadata (name, description, agent, context, …)
└── src/
    └── {slug}.md             # Skill content — instructions passed to the target agent
```

Each skill is defined by a YAML metadata file in `meta/` paired with a Markdown content
file in `src/` that share the same slug (stem).

---

## Building Skills

Skills are compiled with `scripts/build-skills.js`. The script reads source files from
`skills/meta/` and `skills/src/` and writes compiled output to `dist/vscode-skills/` and
`dist/claude-skills/`.

```
dist/
├── vscode-skills/
│   └── {slug}.md     # VS Code skill — name + description frontmatter only
└── claude-skills/
    └── {slug}.md     # Claude Code skill — name + description + context + agent frontmatter
```

Both output directories are gitignored. Run the build any time you add or modify a skill.

### Command Reference

| Command | Effect |
|---------|--------|
| `node scripts/build-skills.js` | Full build — writes output to `dist/vscode-skills/` and `dist/claude-skills/`. Clears stale `.md` files from those directories first. |
| `node scripts/build-skills.js --check` | Read-only verification — builds in memory and reports the count but writes nothing. Exits 0 if all skills compile without errors. |
| `node scripts/build-skills.js --dry-run` | Alias for `--check` — identical behaviour. |
| `node scripts/build-skills.js --strict` | Treats build warnings as errors — exits 1 on the first warning. |

### Publishing Skills

Built skill files in `dist/` are deployed to IDE-specific locations with `scripts/publish-skills.js`.

| Command | Effect |
|---------|--------|
| `node scripts/publish-skills.js` | Deploy compiled skills to `.github/skills/` (VS Code) and `~/.claude/skills/` (Claude Code). |
| `node scripts/publish-skills.js --dry-run` | Preview what would be deployed without writing any files. Exits 0. |
| `node scripts/cli.js publish-skills` | Full pipeline: build then publish. |
| `node scripts/cli.js publish-skills -- --dry-run` | Full pipeline in dry-run mode: build (check only) then preview deployment. |

---

## Adding a New Skill

1. Create `meta/{slug}.yaml` with the required fields (see [Metadata Fields](#metadata-fields) below).
2. Create `src/{slug}.md` with the skill instructions.
3. Run `node scripts/build-skills.js` to verify the build.
4. Run `node scripts/publish-skills.js` (or `node scripts/cli.js publish-skills`) to deploy.

---

## Metadata Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier. |
| `description` | Yes | When-to-use description shown in IDE skill pickers. |
| `context` | No | Execution context. Use `fork` to run in an isolated subagent session. |
| `agent` | No | Slug of the agent persona to invoke. **See runtime dependency note below.** |
| `changelog` | No | Version history (block scalar). Version and last-updated are derived from the first entry. |

### ⚠️ Runtime Dependency: the `agent` field

When a skill YAML file includes an `agent` field, the skill delegates to that named persona
at runtime. **The persona must be deployed to the IDE before the skill can execute.**

For example, `insights-audit-persona.yaml` specifies `agent: persona-curator`. This means
the Persona Curator persona must be present as a deployed agent file:

- **VS Code:** `persona-curator.agent.md` must exist in the VS Code prompts directory.
- **Claude Code:** `persona-curator.md` must exist in `~/.claude/agents/`.

To deploy personas, run:

```bash
node scripts/cli.js sync-personas
```

or equivalently:

```bash
node scripts/sync-personas.js
```

If the named persona is not deployed, the skill will fail silently (the IDE will not find
the agent to delegate to). Always deploy personas before testing agent-delegating skills.

---

## Available Skills

| Skill | File | Description |
|-------|------|-------------|
| `insights-audit-persona` | `src/insights-audit-persona.md` | Launches the Persona Curator in Audit mode to evaluate a persona against the Persona Design Guide. Requires `persona-curator` to be deployed. |
