
## Synthesis

### Completion Status
- Date: 2026-11-20
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Research brief: used
- Archived in Ledger: 2026-11-20

### Outcome Summary

The error-code rework follow-ups are in place. The Error Codes tab's Save is guarded against re-entry, `temporary-codes.json` is written owner-only, the plugin loader follows symlinks and reports dangling links, and each plugin import has a timeout. The persona build now regenerates and checks `docs/references/agents-overview.md` itself, which closes the gap that let a stale overview ship.

### Implementation Summary
- GUI: `ecSaveInFlight` guards `ecHandleSave` the way `ecTestInFlight` guards Test; `index.html` loads `config-error-codes.js?v=2`.
- Storage: `issueTemporaryCode` writes with `TEMPORARY_CODES_FILE_MODE` (`0o600`); an existing wider file is tightened on the next issuance.
- Plugin loader: `classifyEntry()` looks through symlinks, dangling links become load errors, `PLUGIN_IMPORT_TIMEOUT_MS` bounds each import, and `loadPluginProviders` takes an optional `importTimeoutMs`.
- Build tooling: new `scripts/lib/agents-overview.js` (render, check, skip-unchanged write); `generate-agents-overview.js` is now a thin CLI; `build-personas.js` regenerates the overview as a real-build post-step and runs an `agents-overview` check on every invocation; `cmdBuildMaintain` no longer calls the generator separately.

### Documentation Updates
- Provider guide: symlinked entries, dangling-link errors, the per-plugin timeout and its worst-case startup delay.
- MCP server manifests (api-surface, data-flows, constraints) and GUI manifests (api-surface, file-tree).
- Root manifests (root-tooling, generated-artefacts, development-commands, cross-system-dependencies) and personas manifests (constraints rule 33, api-surface build-personas section).
- WIP changelog entries in `mcp-server/changelog.md` (v2.12.0) and `personas/changelog.md` (v3.39.0). No new versions opened; the root changelog and root README were left alone, as the plan states.

### Verification Summary
- Tests run: mcp-server `npm test` and `npm run build`; root `npm test`; `node scripts/build-personas.js` (twice) and `--check`; `node scripts/generate-agents-overview.js --check`.
- Static analysis run: `tsc` through the mcp-server build and the root test pretest build. No separate linter was run.
- Result: PASS. No new failures against the baselines. A second real build left the overview byte-identical.

### Code Insights

#### Implementation Decisions
- [LOW] (decision) mcp-server/src/error-codes/plugin-loader.ts: The timeout race is a private `withTimeout()` helper. The losing `import()` promise gets a no-op catch, so a late failure of a timed-out plugin is not an unhandled rejection. Timeout errors read `import timed out after N ms` without the `failed to import plugin:` prefix, as the plan specifies.
- [LOW] (decision) scripts/lib/agents-overview.js: `writeAgentsOverview` returns `{ written, personaCount }`, a superset of the plan's `{ written }`, so the CLI keeps its `Generated ... (N personas)` message.

#### Follow-Up Items
- [MEDIUM] (debt) scripts/tests/generate-agents-overview.test.js: The spawn-based test regenerates the real tracked overview in `beforeAll`, so every root `npm test` dirties the tree with a date-line diff (seen during the baseline run). Point it at a temp copy or back up and restore the file.
- [LOW] (debt) mcp-server/gui/public/views/config-error-codes.js: Save and Test still repeat their own disable/label/restore sequence. The plan rejected a shared helper for two call sites; revisit when a third button needs it.
- [LOW] (improvement) mcp-server/src/error-codes/plugin-loader.ts: `resolveFolderEntryPath` joins `package.json` `main` without checking it stays inside the plugin folder. Same trust level as the plugin, so harmless, but a guard or a docs note would be cheap.
- [LOW] (debt) mcp-server/tests/error-codes/temporary-codes.test.ts: The file takes about 17 s, probably from lock timing, and the new mode tests add to it.
- [LOW] (refactor) scripts/lib/agents-overview.js: A real build renders the overview twice (write, then check). Cheap today; combine or cache if the suites grow.
- [LOW] (debt) scripts/lib/agents-overview.js: The `9-Stage Workflow` heading and the summary-table descriptions are hard-coded in `generate()`.

### Additional Comments
- The plan folder was renamed from `2026-11-19-…` to `2026-11-20-…` per the workflow. `plan.md` held no self-references, so it was not edited.
- `docs/references/agents-overview.md` shows a date-only diff from the baseline `npm test` run, made before the skip-unchanged write existed. Per the generated-artefacts policy, keep it out of commits; reverting is a git write, so it is left to the user or Git Committer.
- Knowledge Base Reconciliation: insight 77cd0cdc still needs narrowing by the Ledger Knowledge Curator (plan table row). It was not done here.
- Human actions from the plan remain: restart the MCP and GUI servers after the branch reaches STABLE, and hard-reload the GUI.
