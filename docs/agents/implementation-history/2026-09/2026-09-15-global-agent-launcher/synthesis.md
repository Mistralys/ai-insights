
## Synthesis

### Completion Status
- Date: 2026-09-15
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-09-15
- Rework: 2026-09-15 — resolved the recorded follow-up item in `scripts/install-mcp-global.js:uninstall()` (see Follow-Up Items below, now marked resolved)
- Rework: 2026-09-15 — gave every standalone/ledger-support persona a pretty picker label (see Outcome Summary and Follow-Up Items below)

### Outcome Summary

Added a new `agent` subcommand to the existing global `ai-insights` CLI that scans `~/.claude/agents/`, presents every deployed persona in a type-to-filter picker (raw-mode interactive, with a numbered `readline` fallback for non-TTY environments), and launches `claude --agent <id>` with the selection. Two small shared helpers (`parseFrontmatter()`, `isClaudeCliAvailable()`) were extracted verbatim from `sync-personas.js` and `install-mcp-global.js` respectively so the new launcher reuses already-verified logic instead of duplicating it, following the plan's Approach exactly.

A follow-up rework traced a user report that most picker labels were unhelpfully falling back to raw filename slugs. The root cause was in the persona build system, not the launcher: every standalone/ledger-support persona's source YAML already carried a pretty `name:` field, and it was already emitted into the VS Code frontmatter, but the Claude Code frontmatter template never emitted it at all. Adding a `role: {{name}}` line to `FRONTMATTER_STANDALONE_CC` in `personas/persona-build.config.js` closed that gap — the launcher's `discoverAgents()` role-then-basename fallback needed no code change, since it already preferred `role:` over the basename.

### Implementation Summary
- New `scripts/lib/frontmatter.js` and `scripts/lib/claude-cli.js` extractions, consumed by both their original call sites and the new launcher, with no behavior change to the originals.
- New `scripts/lib/launch-agent-core.js` housing all pure discovery/filtering/reducer logic plus both picker I/O shells (`runInteractivePicker`, `runNonInteractivePicker`) — no `main()`/CLI-invocation logic, matching the workspace's established `scripts/lib/*.js` shape.
- New `scripts/launch-agent.js`, a thin CLI entry point wiring the above into `--filter`/passthrough-arg parsing, preflight checks (empty agents directory, missing `claude` CLI), picker dispatch, and exit-code-forwarding `spawn`.
- `scripts/cli.js` gained a registered `agent` command (category `Personas`, key `a`), following the existing `cmdX` + `runScript` delegation pattern used by every other subcommand.
- Display label rule: an agent's `role:` frontmatter field when present, otherwise its filename without the `.md` extension. Following the rework below, every persona built by this workspace's own pipeline (ledger, standalone, and ledger-support suites) now carries a pretty `role:` line — the basename fallback now applies only to agents deployed to `~/.claude/agents/` from outside this pipeline.
- `personas/persona-build.config.js` → `FRONTMATTER_STANDALONE_CC` now emits `role: {{name}}`, reusing each standalone/ledger-support persona's existing pretty `name:` YAML field (e.g. `"Developer (Standalone)"`, `"Persona Curator"`) as its Claude Code frontmatter `role:` line, mirroring the ledger suite's own `role:` field. Rebuilt and redeployed all personas (`node scripts/build-personas.js` + `node scripts/sync-personas.js --target claude-code`) so `~/.claude/agents/` reflects the change.

### Documentation Updates
- `AGENTS.md` → "Root-Level Tooling" table: added rows for the four new files.
- `docs/references/menu-guide.md` → added an `agent` row to the "Personas" table and `./menu.sh agent` / `./menu.sh agent --filter <term>` examples.
- `docs/references/development.md` → added `ai-insights agent` to the `npm link` example list.
- `README.md` → added a Quick Start callout for `ai-insights agent`.
- Ran `node scripts/cli.js ctx-generate` to propagate the `AGENTS.md` edit into `CLAUDE.md` and the `.context/` snapshots (never hand-edited `CLAUDE.md`); this also refreshed `docs/references/agents-overview.md`'s generation timestamp as an expected side effect of the same tooling run.
- Rework: `personas/docs/agents/project-manifest/api-surface.md` → `### Standalone — Claude Code (FRONTMATTER_STANDALONE_CC)` section rewritten from "No `role`" to document the new `role: {{name}}` line and why it exists (per the Personas manifest's own maintenance rule that a frontmatter-template change must update `api-surface.md`). `scripts/lib/launch-agent-core.js`'s `discoverAgents()` docstring updated to stop describing the fallback as an inherent property of the 34 standalone/ledger-support personas — it now correctly scopes the basename fallback to agents deployed from outside this workspace's own build pipeline. `mcp-server/docs/agents/project-manifest/api-surface.md`, `personas/docs/agents/project-manifest/data-flows.md`, and the VS Code frontmatter section of the personas `api-surface.md` were checked but left unchanged — their "no role" statements describe the persona source YAML field and `sync-personas.js` validation rules respectively, both of which are still accurate and unaffected by this fix.

### Verification Summary
- Tests run: `npm run test:scripts` (full `scripts/tests/` Vitest suite, including the pre-existing `install-mcp.test.js` suite and the persona frontmatter-validation path exercised by `sync-personas.js --dry-run`) — all passing, both before and after the extractions (AC-07). Re-run clean after the rework's frontmatter-template change.
- Static analysis run: no workspace-level linter is configured for root `scripts/` files (confirmed — no ESLint config present); ran `node --check` over every new/modified file as a syntax gate instead.
- Rework verification: `node scripts/build-personas.js` (full rebuild, all 132 output files regenerated cleanly) and `node scripts/build-personas.js --check` (confirms no drift after rebuild); `node scripts/sync-personas.js --target claude-code` (redeployed to `~/.claude/agents/`, both the standalone and ledger-support Claude Code frontmatter validation passes reported zero warnings); `node scripts/validate-workflow-manifest.js` and `node scripts/check-known-roles.js` (unaffected, both still OK); manual `discoverAgents()` invocation against the live `~/.claude/agents/` directory confirmed every workspace-built persona now resolves a pretty `label` instead of its basename.
- Result: PASS — full Vitest suite green, all new acceptance tests exercising AC-01 through AC-06 pass, `sync-personas.js --dry-run` frontmatter validation reports all personas passing post-extraction; rework verification confirms the pretty-label fix with no regressions.

### Code Insights

#### Implementation Decisions
- [low] (decision) `scripts/lib/frontmatter.js`: Extracted `parseFrontmatter()` verbatim from `scripts/sync-personas.js` per the plan's Step 1 — same regex, quote-stripping, and leading-HTML-comment handling, no behavior change.
- [low] (decision) `scripts/lib/launch-agent-core.js`: `reducePickerInput()` returns a single merged object (`{...state, action}`) rather than a `{state, action}` wrapper, so callers can read the next `query`/`cursor` and the transient `action` off one object — matches the plan's described shape without introducing an envelope the plan didn't specify.
- [low] (decision) `scripts/tests/launch-agent.test.js`: Initial `filterAgents()` test fixtures had overlapping description text (both containing "plan"), producing a false failure; rewrote the fixtures with genuinely disjoint description text so the case-insensitive substring assertions are unambiguous.
- [low] (decision) `personas/persona-build.config.js`: Reused the existing `role:` frontmatter field name for the standalone/ledger-support pretty-label fix (rather than inventing a new field like `pretty_name`), mirroring the ledger suite's own `role:` line. This kept the fix entirely inside frontmatter emission — `discoverAgents()`'s existing role-then-basename fallback and `sync-personas.js`'s slug-mode validation (which does not require or constrain `role`) both needed no changes.

#### Follow-Up Items
- **[RESOLVED 2026-09-15]** [low] (debt) `scripts/install-mcp-global.js:uninstall()`: A second, unrelated inline `where`/`which` claude-CLI-availability check (~L326) duplicated the same logic now centralized in `scripts/lib/claude-cli.js`'s `isClaudeCliAvailable()`. Swapped this call site to use the shared helper; the now-dead `IS_WIN` constant (its only other consumer having already been removed in the original pass) was removed too. Full `scripts/tests/` suite re-run clean (242/242) after the change.
- [low] (convention) `scripts/cli.js`: Registered the `agent` command using the exact `{id, key, label, category, description, helpVariants, run}` + `cmdX`/`runScript` shape already used by every other command — confirmed no departure from the established pattern while implementing.
- **[RESOLVED 2026-09-15]** [high] (code-smell) `personas/persona-build.config.js`: Root cause of the missing pretty names was in the persona build system, not the launcher — every standalone/ledger-support persona YAML already carried a pretty `name:` field, already emitted into the VS Code frontmatter, but the Claude Code frontmatter template (`FRONTMATTER_STANDALONE_CC`) never emitted it at all, only the machine slug via `cc_name`. Fixed by adding `role: {{name}}` to the template; rebuilt and redeployed all personas.
- [low] (improvement) `~/.claude/agents/manifest-reviewer.md`: This one deployed agent still falls back to its basename label — it has no corresponding source file anywhere under `personas/*/src` in this workspace (only a reference to it in `personas/docs/agents/project-manifest/constraints.md`'s principle table), so it appears to be deployed from outside this workspace's build pipeline. Out of scope here; flagging for whoever owns that agent's source to add a `role:`/pretty-name field.

### Additional Comments
- The interactive raw-mode picker (`runInteractivePicker`) is intentionally left untested per the plan's Testing Strategy, consistent with the codebase's existing precedent of not unit-testing `@mistralys/cli-menu`'s own keypress loops — its only decision logic lives in the already-tested `reducePickerInput()` reducer.
- `AC-08` (`./menu.sh agent` working identically to `ai-insights agent`) is satisfied by construction: both paths resolve to the same `scripts/cli.js` dispatch, and no OS-specific code was introduced.
- After the pretty-label rework, only one deployed agent (`manifest-reviewer`) still shows a basename label, and it originates outside this workspace's persona build pipeline — see the corresponding Follow-Up Item.
