# Plan

## Summary

Introduce a template-based build system for the 7 ledger persona files (`personas/ledger/1-planner.md` … `7-synthesis.md`). The source of truth moves from hand-edited Markdown files to a combination of **YAML sidecar metadata** (frontmatter data, MCP tool declarations, feature flags) and **Markdown content templates** that reference **shared partials** for boilerplate blocks. A zero-external-dependency-beyond-js-yaml build script assembles the final persona `.md` files, keeping the existing `sync-personas.js` workflow untouched.

## Architectural Context

### Current state

| Asset | Purpose |
|---|---|
| `personas/ledger/1-planner.md` … `7-synthesis.md` | Hand-authored persona files — contain YAML frontmatter + Markdown body. Copied to VS Code by `sync-personas.js`. |
| `personas/ledger/README.md` | Usage guide for the ledger workflow (not a persona — excluded from build). |
| `sync-personas.js` (project root) | Reads `vs_file_name` from frontmatter, copies persona `.md` files to VS Code's `User/prompts` folder. |
| `scripts/check-known-roles.js` | Validates that `role:` values in frontmatter match `AGENT_ROLES` in the MCP server. |

### Shared boilerplate identified across the 7 personas

| Block | Agents | Notes |
|---|---|---|
| **YAML frontmatter** | 1–7 | Entirely derivable from metadata (name, version, role, tools, etc.) |
| **Agent roster** (the numbered list with "(YOU)" marker) | 1–7 | Identical structure; only the "(YOU)" position varies |
| **MCP intro paragraph** | 2–7 | Identical |
| **MCP tool table** | 2–7 | Same table structure; rows differ per agent |
| **Self-documenting tools note** | 3–7 | Identical paragraph (absent from agent 2) |
| **Pre-flight: deferred-tools loading paragraph** | 2–7 | Identical |
| **Pre-flight: detect project step** | 3–7 | Identical (absent from agent 2) |
| **Pre-flight: verify reachability step** | 2–7 | Two wording variants — with/without preceding detect step |
| **MCP unavailable error block** | 2–7 | Identical |
| **Automatic handoff block** | 2–7 | Identical |
| **Environment incident logging** | 3, 4, 6 | Identical text; placement varies (bullet in agent 3, subsection in 4 & 6) |

### Unique per agent

Each persona has its own Mission statement, Inputs section, Operational Protocol, Output Format, Workflow steps, and agent-specific sections (e.g., Developer → Code Insight Observer, Reviewer → Review Dimensions, QA → Decision Logic, Planner → Plan Output Template & Core Rules).

## Approach / Architecture

### Design Principles

1. **Content files remain readable Markdown.** A developer editing a persona body should see clean prose with minimal template markers — not a jungle of logic.
2. **Metadata is data, not prose.** Frontmatter fields, MCP tool lists, and boolean feature flags live in YAML sidecar files — separate from the prose body.
3. **Partials are small and composable.** Instead of one giant "MCP section" partial with deep conditionals, use several small partials (`mcp-intro`, `mcp-preflight-detect`, `handoff-block`, etc.) that the content template includes explicitly. This keeps each content template a clear, scannable manifest of its structure.
4. **Minimal custom template engine.** Support only four constructs — variable interpolation `{{var}}`, partial inclusion `{{> name}}`, conditional blocks `{{#if flag}}…{{/if}}`, and nothing else. No `{{else}}`, no `{{#each}}`, no expressions. Arrays (roster, MCP tool table) are pre-rendered by the build script into Markdown strings and injected as regular variables.
5. **Single new dependency**: `js-yaml` for YAML parsing of sidecar files.

### Directory layout (new files marked ★)

```
personas/
├── ledger/
│   ├── src/                              ★ Source directory
│   │   ├── meta/                         ★ Sidecar metadata
│   │   │   ├── _shared.yaml              ★ Shared metadata (author, roster, default version)
│   │   │   ├── 1-planner.yaml            ★
│   │   │   ├── 2-project-manager.yaml    ★
│   │   │   ├── 3-developer.yaml          ★
│   │   │   ├── 4-qa.yaml                 ★
│   │   │   ├── 5-reviewer.yaml           ★
│   │   │   ├── 6-documentation.yaml      ★
│   │   │   └── 7-synthesis.yaml          ★
│   │   ├── partials/                     ★ Shared text fragments
│   │   │   ├── agent-roster.md           ★
│   │   │   ├── mcp-intro.md              ★
│   │   │   ├── mcp-tools-note.md         ★
│   │   │   ├── mcp-preflight-header.md   ★
│   │   │   ├── mcp-preflight-detect.md   ★
│   │   │   ├── mcp-preflight-verify-with-detect.md   ★
│   │   │   ├── mcp-preflight-verify-no-detect.md     ★
│   │   │   ├── mcp-unavailable.md        ★
│   │   │   ├── handoff-block.md          ★
│   │   │   └── incident-logging.md       ★
│   │   └── content/                      ★ Per-persona body templates
│   │       ├── 1-planner.md              ★
│   │       ├── 2-project-manager.md      ★
│   │       ├── 3-developer.md            ★
│   │       ├── 4-qa.md                   ★
│   │       ├── 5-reviewer.md             ★
│   │       ├── 6-documentation.md        ★
│   │       └── 7-synthesis.md            ★
│   │
│   ├── 1-planner.md                      ← Built output (generated, git-tracked)
│   ├── 2-project-manager.md              ← Built output
│   ├── …
│   ├── 7-synthesis.md                    ← Built output
│   └── README.md                         ← Not generated — hand-maintained
│
├── build-personas.js                 ★ Build script (new, alongside sync-personas.js)
└── …
```

> **Note:** I considered placing `build-personas.js` at the project root alongside `sync-personas.js`, but since the build script is purely about the ledger persona assembly, it belongs inside `personas/` to keep the root clean. The sync script remains at the root since it operates across all persona subdirectories. Alternatively, if you prefer the build script at the root, that's a trivial move.

### Sidecar metadata schema

#### `_shared.yaml`

```yaml
author: Sebastian Mordziol
last_updated: "2026-02-21 18:30"
default_version: "3.4.0"

roster:
  - number: 1
    title: Chief Product Officer
    short: Planning & Strategy
  - number: 2
    title: Technical Program Manager
    short: Task Decomposition & Project Management
  - number: 3
    title: Staff Software Engineer
    short: Implementation & Verification
  - number: 4
    title: SDET
    short: QA & Validation
  - number: 5
    title: Principal Systems Architect
    short: Code Review & Quality Check
  - number: 6
    title: Technical Writing Manager
    short: Documentation & README Curation
  - number: 7
    title: Head of Operations
    short: Synthesis & Project Reporting
```

#### Per-persona YAML (e.g., `3-developer.yaml`)

```yaml
number: 3
role: Developer
vs_file_name: 3-dev.agent.md

# Optional version override (omit to use shared.default_version)
# version: "3.4.0"

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo
  - central_pm/*

# Feature flags for conditional blocks in partials
has_mcp: true
has_detect_project: true
self_documenting_note: true
has_incident_logging: true

mcp_tools:
  - tool: ledger_detect_project
    purpose: Resolve the active project from the current workspace path.
  - tool: ledger_get_next_action
    purpose: "Get the recommended action for your role (which WP to implement, or WAIT)."
  - tool: ledger_claim_work_package
    purpose: "Transition a READY WP to IN_PROGRESS (validates dependency completion)."
  - tool: ledger_start_pipeline
    purpose: "Begin the `implementation` pipeline for a WP."
  - tool: ledger_complete_pipeline
    purpose: "Finalize the pipeline with status, summary, artifacts, acceptance criteria updates, and Code Insight Observer comments. This is the **primary tool for updating acceptance criteria**."
  - tool: ledger_add_observation
    purpose: Add an observation to an existing pipeline after completion.
  - tool: ledger_add_project_comment
    purpose: "Add a project-level comment (e.g., incident reports)."
  - tool: ledger_get_work_package
    purpose: "Read full WP detail (status, pipelines, acceptance criteria)."
  - tool: ledger_get_handoff_status
    purpose: Compute the AGENT/STATUS handoff block at the end of your turn.
```

#### Agent 1 (planner-specific, no MCP)

```yaml
number: 1
role: Planner
vs_file_name: 1-planner.agent.md
version: "1.3.0"   # Override — Planner has independent versioning

tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo

has_mcp: false
has_detect_project: false
self_documenting_note: false
has_incident_logging: false
```

### Frontmatter generation

The build script auto-generates frontmatter from metadata. Template (internal to build script):

```yaml
---
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
role: {{role}}
author: {{author}}
version: {{version}}
last_updated: {{last_updated}}
vs_file_name: {{vs_file_name}}
tools: {{tools_json}}
---
```

### Partials

Each partial is a plain Markdown file that may contain `{{variable}}` references resolved against the merged metadata context.

| Partial file | Content |
|---|---|
| `agent-roster.md` | "You operate within a larger agentic workflow:\n\n{{roster_rendered}}" |
| `mcp-intro.md` | The MCP intro heading + paragraph + "### Tools you will use:" + table header + `{{mcp_tools_table}}` |
| `mcp-tools-note.md` | "The ledger tools are self-documenting…" paragraph |
| `mcp-preflight-header.md` | "### Pre-flight check" + deferred-tools loading paragraph |
| `mcp-preflight-detect.md` | "**Step 1 — Detect the active project**…" text |
| `mcp-preflight-verify-with-detect.md` | "**Step 2 — Verify MCP server reachability**" (variant that says "with the resolved `project_path`") |
| `mcp-preflight-verify-no-detect.md` | "**Step 1 — Verify MCP server reachability**" (variant that says "with the target `project_path`") |
| `mcp-unavailable.md` | The blockquote error message |
| `handoff-block.md` | The "Automatic Handoff" paragraph + code block |
| `incident-logging.md` | The incident logging paragraph text (without heading — the content template adds its own heading or bullet context) |

### Content templates

Each content template is a full Markdown body (everything after the frontmatter) that includes `{{> partial}}` references and `{{variable}}` interpolation. The content template is the **structural manifest** for that persona — you can scan it and see exactly which sections appear and in what order.

Example excerpt from `content/3-developer.md`:

```markdown
# Lead Implementation Engineer Agent

## Mission

**Identity: Staff Software Engineer**. 

Fill these two foundational responsibilities:

1. **Implementation:** Take a structured Work Package (generated by the Project Manager Agent) and transform it into high-quality, production-ready code.

2. **Code Insight Observer:** While working hands-on in the codebase, actively watch for code smells, localised improvements, and minor technical debt in the code you read and write. This is not an architectural review—it is the practitioner's perspective of a senior developer who notices things while doing the work.

Both roles run in parallel: implement *and* observe continuously throughout every work package.

{{> agent-roster}}

---

## Inputs

You will be provided with:

* **The Work Package:** The individual work package specification file …
… (unique content continues) …

---

{{> mcp-intro}}

{{#if self_documenting_note}}
{{> mcp-tools-note}}
{{/if}}

{{> mcp-preflight-header}}

{{#if has_detect_project}}
{{> mcp-preflight-detect}}

{{> mcp-preflight-verify-with-detect}}
{{/if}}

{{#if no_detect_project}}
{{> mcp-preflight-verify-no-detect}}
{{/if}}

{{> mcp-unavailable}}

---

## Operational Protocol

… (unique content — operational steps, code insight observer, etc.) …

* **Environment Incident Logging:** {{> incident-logging}}

---

## Workflow

… (unique workflow steps) …

   {{> handoff-block}}
```

The complete unique prose stays right in the content file. Only the shared blocks are pulled from partials. This keeps the content file readable and makes it the single place to edit persona-specific text.

### Build script logic

```
build-personas.js
├── Loads js-yaml
├── Reads _shared.yaml → sharedMeta
├── Discovers all personas: reads personas/ledger/src/meta/*.yaml (excluding _shared.yaml)
├── For each persona meta file:
│   ├── Merge: persona meta + shared defaults (persona overrides win)
│   ├── Pre-render computed variables:
│   │   ├── version → persona.version || shared.default_version
│   │   ├── total → shared.roster.length
│   │   ├── tools_json → JSON.stringify(persona.tools)
│   │   ├── roster_rendered → render roster lines with "(YOU)" at persona.number
│   │   ├── mcp_tools_table → render MCP tool Markdown table rows from persona.mcp_tools
│   │   └── no_detect_project → !persona.has_detect_project (complementary flag)
│   ├── Generate YAML frontmatter string from metadata
│   ├── Load content template: src/content/{filename}.md
│   ├── Resolve {{> partial}} inclusions (load from src/partials/, support 1 level of nesting)
│   ├── Resolve {{#if flag}}…{{/if}} conditional blocks
│   ├── Resolve {{variable}} interpolation
│   ├── Clean up: collapse 3+ consecutive blank lines to 2
│   ├── Concatenate: frontmatter + "\n" + rendered body
│   └── Write to personas/ledger/{filename}.md
└── Print summary (built N personas, any warnings)
```

**CLI interface:**
- `node personas/build-personas.js` — build all personas
- `node personas/build-personas.js --check` — verify built files are up-to-date (exit 1 if stale)
- `node personas/build-personas.js --dry-run` — preview what would be generated without writing

### Template engine rules

The custom engine is intentionally minimal (~80–100 lines):

1. **Partial inclusion** `{{> name}}`: Replaced with the contents of `src/partials/{name}.md`. One level of nesting supported (a partial may reference another partial). Infinite recursion guarded by depth limit.
2. **Conditional** `{{#if flag}}…{{/if}}`: If `flag` is truthy in the context, include the enclosed text; otherwise remove it (including surrounding blank lines). No `{{else}}`. Use complementary boolean flags for alternates (e.g., `has_detect_project` / `no_detect_project`).
3. **Variable interpolation** `{{var}}`: Replaced with string value from context. Unresolved variables emit a build warning and are left as-is (easy to spot).
4. **Processing order**: partials → conditionals → variables (so partials can contain conditionals and variables).

### Integration with existing tooling

- **`sync-personas.js`** remains unchanged. It reads the built `.md` files from `personas/ledger/` just as before.
- **`scripts/check-known-roles.js`** remains unchanged. It validates frontmatter `role:` values in the built files.
- **Recommended workflow**: `node personas/build-personas.js && node sync-personas.js`
- **Optional**: Add a combined convenience script or npm script if desired.

## Rationale

| Decision | Why |
|---|---|
| **YAML sidecar over embedded metadata** | Separates data from prose. Frontmatter is fully generated — no risk of typos in version strings, tool arrays, or role names. |
| **Small composable partials over one big "MCP section" partial** | Avoids deep conditional nesting inside partials. Each content template explicitly lists which partials it includes, making the structure scannable. |
| **Custom template engine over Handlebars/EJS** | The project's scripting layer (sync, build) is dependency-minimal plain JS. The template needs are simple enough (4 constructs) that a custom ~100-line engine is sufficient. Adding Handlebars would pull in a significant dependency for minimal benefit. |
| **`js-yaml` as sole new dependency** | YAML is already the project's metadata idiom (`context.yaml`, frontmatter). JSON would work but is less pleasant to edit. `js-yaml` is lightweight (100 KB, zero transitive deps). |
| **Built outputs git-tracked** | The sync script, README links, and `check-known-roles.js` all read the built `.md` files. Keeping them in git means the repo works without a build step. The `--check` flag enables CI/pre-commit verification that builds are fresh. |
| **No `{{else}}` or `{{#each}}`** | Complementary flags (`has_detect_project` / `no_detect_project`) replace `{{else}}`. Arrays are pre-rendered to Markdown strings in JS before template resolution. This keeps the engine trivial and the templates readable. |

## Detailed Steps

1. **Create root `package.json`** at `personas/package.json` with `js-yaml` as a dependency (or add it to an existing workspace-level `package.json` — currently none exists at the root).
2. **Create directory structure**: `personas/ledger/src/meta/`, `personas/ledger/src/partials/`, `personas/ledger/src/content/`.
3. **Author `_shared.yaml`** with the author, default version, last_updated, and the roster array.
4. **Author per-persona `.yaml` files** (7 files) extracting metadata from the current `.md` files: number, role, vs_file_name, version override, tools array, feature flags, and mcp_tools array.
5. **Author partial `.md` files** (10 files) extracting the shared text blocks from the current persona files.
6. **Author content template `.md` files** (7 files) — take each current persona `.md`, remove the frontmatter, and replace shared blocks with `{{> partial}}` references and `{{variable}}` markers.
7. **Implement `build-personas.js`**:
   - YAML loading via `js-yaml`
   - Metadata merging (persona + shared defaults)
   - Computed variable pre-rendering (roster, MCP table, complementary flags)
   - Frontmatter generation
   - Template engine (partials → conditionals → variables)
   - File writing with summary output
   - `--check` and `--dry-run` CLI flags
8. **Verify round-trip fidelity**: Run the build and diff the output against the current hand-authored personas. The content should be byte-identical (modulo intentional whitespace normalization).
9. **Update `sync-personas.js`** (optional): Add a pre-sync build step or a reminder message. Not strictly required since the workflow is `build → sync`.
10. **Update `personas/ledger/README.md`**: Add a "Building Personas" section explaining the source → build → sync workflow.

## Dependencies

- `js-yaml` (npm) — YAML parser for sidecar metadata files
- Node.js ≥ 18 (already required by the existing scripts)

## Required Components

### New files

| File | Purpose |
|---|---|
| `personas/package.json` | ★ Declares `js-yaml` dependency |
| `personas/build-personas.js` | ★ Build script |
| `personas/ledger/src/meta/_shared.yaml` | ★ Shared metadata |
| `personas/ledger/src/meta/1-planner.yaml` … `7-synthesis.yaml` | ★ Per-persona metadata (7 files) |
| `personas/ledger/src/partials/*.md` | ★ Shared text partials (10 files) |
| `personas/ledger/src/content/1-planner.md` … `7-synthesis.md` | ★ Content templates (7 files) |

### Modified files

| File | Change |
|---|---|
| `personas/ledger/README.md` | Add "Building Personas" section |
| `personas/ledger/1-planner.md` … `7-synthesis.md` | Now generated — add `<!-- AUTO-GENERATED — do not edit. Source: src/ -->` header comment |

### Unchanged files

| File | Why unchanged |
|---|---|
| `sync-personas.js` | Reads built `.md` files as before |
| `scripts/check-known-roles.js` | Reads built `.md` frontmatter as before |

## Assumptions

- The 7 ledger persona files are the only build targets. `personas/ledger/README.md` is not generated.
- `personas/vanilla/` and `personas/standalone/` are out of scope. Their templating can follow the same pattern later if desired.
- The built `.md` files remain git-tracked so the repo works without a build step.
- `js-yaml` is acceptable as the sole new runtime dependency for the build script.

## Constraints

- The build script must be plain JS (no TypeScript compilation step) to match the existing scripting convention (`sync-personas.js`, `check-known-roles.js`).
- The template syntax must be simple enough that content templates remain readable as Markdown in any editor (no complex logic in templates).
- Round-trip fidelity: the first build must produce output identical to the current hand-authored files.

## Out of Scope

- **Vanilla personas** (`personas/vanilla/`): Can be templated later using the same infrastructure.
- **Standalone personas** (`personas/standalone/`): Ditto.
- **README generation**: `personas/ledger/README.md` stays hand-maintained.
- **Automated build-then-sync chaining**: The two scripts remain independently invocable. A combined convenience wrapper is optional.
- **Hot-reloading / watch mode**: Not needed for occasional persona edits.
- **Git pre-commit hooks**: The `--check` flag enables this but hook installation is out of scope.

## Acceptance Criteria

- Running `node personas/build-personas.js` produces all 7 persona `.md` files in `personas/ledger/`.
- The generated output is byte-identical to the current hand-authored persona files (verified by diff).
- Running `node personas/build-personas.js --check` exits 0 when builds are fresh, exits 1 when stale.
- Running `node personas/build-personas.js --dry-run` produces no file writes.
- Each generated file starts with `<!-- AUTO-GENERATED — do not edit. Source: src/ -->` followed by the YAML frontmatter.
- `sync-personas.js` continues to work identically after the migration.
- `scripts/check-known-roles.js` continues to work identically after the migration.
- Editing a shared partial and rebuilding updates all affected personas.
- Editing a sidecar metadata field (e.g., bumping `default_version`) and rebuilding updates all affected frontmatter.

## Testing Strategy

1. **Round-trip diff test** (manual, one-time): After initial implementation, diff each built file against the current hand-authored original. Must be identical.
2. **`--check` mode**: Verifiable in CI or pre-commit. Run `node personas/build-personas.js --check` and assert exit code 0.
3. **Partial isolation**: Edit one partial, rebuild, verify only the expected personas changed.
4. **Metadata override**: Set a per-persona version override, rebuild, verify only that persona's frontmatter version changed.
5. **Missing variable warning**: Introduce a typo in a template `{{misspelled}}`, rebuild, verify the build emits a warning and the marker is left in the output for easy detection.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Whitespace drift** — template engine introduces extra blank lines or removes significant whitespace | Round-trip diff test as acceptance criterion; blank-line normalization step (collapse 3+ → 2) |
| **Partial nesting complexity** — deeply nested partials become hard to trace | Enforce 1-level nesting limit in the engine; keep partials small and flat |
| **Stale builds** — developer edits source but forgets to rebuild | `--check` flag for CI/pre-commit; `<!-- AUTO-GENERATED -->` comment as visual reminder |
| **`js-yaml` breaking change** — future major release changes API | Pin to `^4.x` (current stable); the build script uses only `yaml.load()` — stable surface |
| **Content template readability** — too many `{{> partial}}` markers hurt scanability | Design partials to represent cohesive blocks (not individual sentences); limit to ~3–5 partial refs per content template |
