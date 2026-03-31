# Plan — Orchestrator Prompt Preview Script

## Summary

Create a Python script that renders all orchestrator stage prompt templates with sample variable values and writes the fully-resolved Markdown files to `orchestrator/dist/stage-prompts/` for review. This enables inspecting the final form of each stage's user-turn prompt without running the full orchestrator pipeline, making it easy to review prompts for optimization opportunities.

## Architectural Context

The orchestrator uses a custom lightweight template renderer (`orchestrator/src/nodes/prompt_renderer.py`) with three public functions:
- `load_template(stage)` — loads `.md` templates from `orchestrator/src/nodes/templates/`
- `load_partial(name)` — loads `.md` partials from `orchestrator/src/nodes/templates/partials/`
- `render_prompt(template, variables)` — 4-step pipeline: include resolution → conditional evaluation → variable substitution → blank-line collapse

**8 stage templates:** `pm`, `developer`, `qa`, `reviewer`, `docs`, `security_auditor`, `release_engineer`, `synthesis`

**5 partials:** `project-path-reminder`, `wp-scope-reminder`, `scope-restriction`, `begin-work-developer`, `pm-preamble`

**Template variables** (from `VARIABLES.md`):
- `project_path` (required, all templates) — absolute path to plan directory
- `wp_id` (optional, WP-scoped templates) — active work package ID
- `plan_file` (PM only) — relative path to plan document
- `extra` (PM only) — plan document content block

**Conditional branches:** Templates that use `{{#if wp_id}}` produce different output depending on whether a work package is active. The preview script should render both variants for these templates.

**Existing script patterns:** Root-level `scripts/cli.js` (Node.js CJS) is the workspace command center. It delegates to `scripts/*.js` files and orchestrator Python scripts via `child_process`. Orchestrator-specific Python scripts don't yet have a dedicated directory — the orchestrator's CLI entry point is `src/cli.py`.

## Approach / Architecture

Create a standalone Python script at `scripts/preview-prompts.py` that:

1. Imports `load_template` and `render_prompt` from `orchestrator/src/nodes/prompt_renderer`
2. Iterates over all 8 stage templates
3. For each template, renders with representative sample values
4. For WP-scoped templates (developer, qa, reviewer, docs, security_auditor, release_engineer), renders **two variants**: with `wp_id` and without
5. Writes all rendered prompts as individual `.md` files to `orchestrator/dist/stage-prompts/`
6. Also prints a summary to stdout listing which files were written
7. Supports optional `--stage <name>` filter to preview a single stage

The script is placed in root `scripts/` (consistent with other cross-project scripts) and uses `sys.path` manipulation to import the orchestrator module, matching how the orchestrator is invoked from the workspace root.

Register a new `preview-prompts` command in `scripts/cli.js` under the "Orchestrator" category so it's discoverable via the unified CLI.

The `orchestrator/dist/` directory is gitignored (new entry) — preview output is ephemeral build output, not committed.

## Rationale

- **Python, not Node.js** — the rendering engine is Python; re-implementing it in JS would create drift risk and violate DRY. Importing the actual renderer ensures preview output matches production output exactly.
- **Root `scripts/` placement** — consistent with other orchestrator-adjacent scripts (`preflight-orchestrator.js`, `run-orchestrator.js`, `kill-orchestrator.js`) that delegate to Python. The script itself is Python because it needs direct access to `prompt_renderer.py`.
- **Two variants for conditional templates** — WP-scoped templates behave differently with/without `wp_id`. Showing both variants gives reviewers complete visibility into all code paths.
- **Sample values over real data** — using clearly labeled placeholder values (e.g., `/path/to/your/project`, `WP-001`) makes the output self-documenting and avoids coupling to any real project state.
- **Fixed output directory (`orchestrator/dist/stage-prompts/`)** — always writes files rather than using stdout, since the purpose is side-by-side review of multiple prompts. The `dist/` directory follows the convention of build output (gitignored, ephemeral).

## Detailed Steps

1. **Create `scripts/preview-prompts.py`**
   - Add `sys.path` setup to import from `orchestrator/src/`
   - Import `load_template`, `render_prompt` from `src.nodes.prompt_renderer`
   - Define sample variable values per stage (constant dicts)
   - Define stage list with metadata: name, whether WP-scoped, stage-specific variables
   - Implement rendering loop: for each stage, render template(s) and write to `orchestrator/dist/stage-prompts/`
   - File naming: `{stage}.md` for non-conditional templates; `{stage}-with-wp.md` / `{stage}-without-wp.md` for WP-scoped templates
   - Add `--stage <name>` argument to filter to a single stage
   - Add `--list` flag to list available stage names and exit
   - Use `argparse` for CLI argument handling
   - Print summary to stdout listing files written

2. **Register in `scripts/cli.js`**
   - Add a `cmdPreviewPrompts` function that spawns the Python script using the orchestrator venv's Python interpreter (same pattern as `cmdPreflight`)
   - Add a COMMANDS entry: id `preview-prompts`, category "Orchestrator", with `helpVariants` for `--stage` flag
   - Pass through CLI args to the Python script

3. **Add `dist/` to `orchestrator/.gitignore`**
   - Append `dist/` to the existing `.gitignore` so preview output is not committed

## Dependencies

- `orchestrator/src/nodes/prompt_renderer.py` (imported directly)
- `orchestrator/src/nodes/templates/*.md` (read by prompt_renderer)
- `orchestrator/src/nodes/templates/partials/*.md` (read by prompt_renderer)
- Python 3.11+ (orchestrator's runtime requirement; no additional packages needed — prompt_renderer uses only stdlib)

## Required Components

- **New:** `scripts/preview-prompts.py` — the preview script
- **Modified:** `scripts/cli.js` — add command registration + handler function
- **Modified:** `orchestrator/.gitignore` — add `dist/` entry

## Assumptions

- The orchestrator venv is available (same assumption as `preflight` and `run-orchestrator` commands)
- The prompt_renderer module can be imported via `sys.path` manipulation pointing to the orchestrator directory
- Sample variable values are sufficient for review — no need to connect to real project state or MCP tools

## Constraints

- **No external dependencies** — the script must use only Python stdlib + the existing `prompt_renderer` module
- **Cross-platform** — must work on Windows, macOS, and Linux (use `pathlib`, avoid shell-specific constructs)
- **Output directory** — the script writes preview files only to `orchestrator/dist/stage-prompts/` (gitignored build output); it never modifies templates, partials, or any source files
- **No orchestrator runtime dependency** — must not import `config.py`, `graph.py`, or any module that requires `.env`, LLM providers, or MCP connections

## Out of Scope

- Modifying the template renderer itself
- Previewing persona (system prompt) content — only user-turn prompts are rendered
- Automated regression testing of prompt output (could be a future addition)
- Integration with the orchestrator's test suite

## Acceptance Criteria

- Running `python scripts/preview-prompts.py` from the workspace root renders all 8 stage templates and writes `.md` files to `orchestrator/dist/stage-prompts/`
- WP-scoped stages produce two files each: `{stage}-with-wp.md` and `{stage}-without-wp.md`
- PM stage file shows the plan content placeholder
- `--stage developer` renders only the developer template (both variants)
- `--list` prints available stage names
- `node scripts/cli.js preview-prompts` delegates to the Python script correctly
- `orchestrator/dist/` is gitignored
- Script runs without errors on macOS (primary dev platform); no Windows/Linux-breaking constructs used

## Testing Strategy

Manual verification:
1. Run `python scripts/preview-prompts.py` and verify files are written to `orchestrator/dist/stage-prompts/`
2. Open generated `.md` files and visually inspect rendered output
3. Run with `--stage pm` and `--stage developer` to verify filtering
4. Run via `node scripts/cli.js preview-prompts` to verify CLI integration
5. Diff the rendered output against manually expanded templates to confirm correctness
6. Verify `orchestrator/dist/` is gitignored (`git status` shows no untracked files)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Import path fragility** — `sys.path` manipulation could break if directory structure changes | Use `pathlib` relative to script location; same pattern used by orchestrator's own module resolution |
| **Template changes not reflected** — cached templates could show stale output | `prompt_renderer.clear_template_cache()` is available but unnecessary here since the script is a fresh process each time |
| **PM `extra` content is synthetic** — real plan content won't match preview | Use a clearly-labeled `[Sample plan content for preview]` placeholder; the preview's purpose is structural review, not content review |
| **Missing venv** — Python script fails if orchestrator venv isn't set up | The cli.js handler checks for venv existence (same as `preflight`); script itself provides a clear error message via ImportError |
