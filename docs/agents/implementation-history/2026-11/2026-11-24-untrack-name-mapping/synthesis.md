# Synthesis: Untrack Persona Name Mapping

### Outcome Summary

This project stopped tracking `personas/name-mapping.json` in Git, since it is a generated build artefact whose model fields come from each user's local, gitignored registry files and would otherwise be dirty on every machine after a rebuild. All four work packages completed successfully: a new tolerant, mtime-reloading loader (`name-mapping.ts`) replaced the module-load `require` in the MCP server and GUI server so both survive the file's absence; a `GET /api/setup-notices` backend endpoint and a global GUI banner give users a one-click "Build personas" repair action; and the CLI's `doctor`/`setup` commands gained an instant-tier health check with a one-command fix. The file was added to `.gitignore`, the combined root and mcp-server changelog entries were written and version-synced, and all GUI manifest, hub, and personas documentation (plus the workspace `.context/` aggregation) were updated to describe the new tolerant/lazy behaviour instead of the old tracked-file assumption. No blocking issues were found at any review or QA stage across the full cycle.

### Metrics

- **WP-001 (Loader + MCP integration):** Implementation PASS (4,668 tests), QA PASS (4,668 tests, manual `dist/index.js` start-up with file removed), code-review PASS (63 tests re-run, 0 blocking), documentation PASS (10 docs + `.context/` regenerated).
- **WP-002 (GUI setup-notices backend):** Implementation PASS, QA PASS (4,673 tests), code-review PASS (0 blocking), documentation PASS (no further gaps found).
- **WP-003 (CLI repair + Git untracking):** Implementation PASS (5,131 tests), QA PASS (5,131 tests, manual CLI `doctor` simulation), code-review PASS (39 tests re-run, 1 documentation-forward), release-engineering PASS (version bumps root v2.16.0 / mcp-server v2.13.0, `check-version-sync.js` clean), documentation PASS (4 docs updated).
- **WP-004 (GUI frontend banner + exit gate):** Implementation PASS (mcp-server 173 files/4,696 tests, root 30 files/463 tests), QA PASS (5,159 tests, live end-to-end smoke test with real GUI server), code-review PASS (0 blocking), release-engineering PASS (changelog bullet added for CLI repair, version confirmed), documentation PASS (1 additional doc gap closed: `api-surface.md` missing `getSetupNotices()` entry).
- **Final combined state:** All 4 WPs COMPLETE, all pipeline stages PASS, 0 blocking issues across the entire project. `node scripts/check-version-sync.js` passes; root changelog at v2.16.0, mcp-server changelog at v2.13.0.

### Strategic Recommendations

- **Single-source path derivation pattern worked well.** Consolidating `personas/name-mapping.json` path resolution onto one function per package (`resolveNameMappingPath()` in mcp-server, `nameMappingPath()` in scripts) rather than letting each consumer derive it independently prevented drift and should be the default pattern for any other generated-artefact path used by multiple consumers.
- **Mtime-based reload over cache-once or read-every-call.** The loader's choice to check `mtimeMs` and only re-parse on change avoided both the "stale after rebuild" bug class and needless re-parsing — a reusable pattern for other lazily-loaded generated JSON consumed across a long-running server process.
- **Array-shaped `/api/setup-notices` endpoint future-proofs the contract.** Even though only one notice exists today, returning `{ notices: [...] }` instead of a single-object shape means a second setup notice can be added later with no client-side contract change — worth replicating for any other "setup state" surface.
- **Changelog WIP-entry discipline across dependent WPs.** The "one WIP entry, never a second" convention required careful handoff coordination (WP-001 deferred the entry, WP-003 opened it, WP-004 added the final bullet) — this worked but is fragile; a future plan with similar changelog-spanning WPs should make the owning WP and bullet-addition responsibility explicit in each WP's Notes section up front (as this plan did), since it avoided duplicate WIP entries.
- **Ledger WP-numbering mismatch handled transparently.** WP-004's description explicitly documented a Bootstrapper registration-order error (ledger WP-003 holding the draft's WP-004 content and vice versa) and cross-referenced the correct mapping inline — this transparency let downstream agents follow dependencies correctly without ledger corruption. Future bootstrapping should double check WP ordering against the draft before registration to avoid needing this kind of remediation note.

### Code Insights

**Developer:**
- `name-mapping.ts` cache is keyed by `mtimeMs` with 3-kind failure dedup (missing/malformed/non-array), reset on success; `getAgentNames()` never throws; `isNameMappingPresent()` is an independent `statSync` existence check (WP-001).
- `constants.ts` is now fully free of file I/O (createRequire/_require and the module-load `AGENT_NAMES` block deleted) (WP-001).
- `setup-notices.ts`'s `SetupNotice.action` was kept as a single optional object rather than a discriminated union, mirroring the WP's own deferral of a provider registry until a second consumer exists (WP-002).
- `.gitignore` entry grouped with existing `/personas/model-registry/*.json` lines with an explanatory comment, rather than placed elsewhere (WP-003).
- Both root and mcp-server changelog top entries exactly matched the last release tag, so new WIP entries were opened rather than extending stale "already released" ones (WP-003).
- `setup-notices.js`'s per-notice build state (building/error/conflict) is tracked in a module-level map pruned on every `refresh()`, so a failed build's error persists across polling ticks until the gap actually closes (WP-004).
- `--color-banner-stale-fg` (not `-border`) was used for the `:focus-visible` outline after hand-computing WCAG contrast in both themes — `-border` only cleared ~2:1 in the light theme (WP-004).

**QA:**
- Manually verified `node mcp-server/dist/index.js` starts with the mapping file physically removed (WP-001); exercised two extra edge cases not in the shipped suite — empty JSON array treated as valid with zero warnings, and entries with empty nested target-name objects not throwing (WP-001).
- Simulated the missing-mapping state end-to-end via `node scripts/cli.js doctor`, confirmed the check flips red, ran the documented fix, confirmed it flips back to green with a byte-identical regenerated file (WP-003).
- No browser-automation tool was available in the QA environment to literally render the banner at 360px/768px/200% zoom; verified equivalent properties by code inspection plus a live DOM smoke test against the running server — recommends a human/browser-tooling pass before release if strict WCAG sign-off is required (WP-004).

**Reviewer:**
- Confirmed `constants.ts`'s no-I/O guarantee and clean boundary isolation keeping the GUI server from depending on a generated artefact (WP-001).
- Confirmed `api-models.ts`'s `nameMappingPath()` fully delegates to `resolveNameMappingPath()` with no remaining independent derivation (WP-002).
- Flagged (documentation-forward) that `generated-artefacts.md` needed its "Known Contradictions" entry updated to point at the current plan folder rather than a superseded one (WP-003) — resolved in that WP's documentation stage.

**Documentation:**
- The most significant correction in WP-001 was `live-workspace.md`, which had claimed the file is read "at server start" — the new loader means a running server now picks up a persona rebuild on its next handoff call without a restart.
- WP-002 found one out-of-scope staleness (root `generated-artefacts.md` citing an old plan-date path) and correctly deferred it to WP-003 rather than fixing it out of scope.
- WP-004 found and fixed one real gap outside its explicitly declared doc list: the GUI `api-surface.md` method table had no entry for the new `getSetupNotices()` wrapper, unlike every sibling module — added the missing row and section.

### Deferred & Follow-Up Items

- **Out-of-scope / deferred:** Root changelog archive pass. Source: WP-003, Release Engineer. Description: the root `changelog.md` now has 13 release headings, past the archive-suggestion threshold of >10 with no older major version present. Priority: low/informational — flagged for the user to schedule separately, not a blocker to this plan.
- **Out-of-scope:** Inconsistent hand-maintained GUI-frontend-module list in `mcp-server/docs/agents/project-manifest/api-surface.md` (the secondary, non-GUI-specific list already omits `stale-check.js` pre-dating this plan). Source: WP-004, Documentation. Description: identified but deliberately left alone rather than papering over one entry in an already-inconsistent list; recorded for a future manifest-curation pass.
- **Out-of-scope (convention note for future work):** Any future GUI client module with a `document`/`window`-level event listener tested via `vm.runInThisContext` needs the same spied-`addEventListener` teardown that `setup-notices-client.test.ts` introduced, since `document` persists per test file and a leaked listener can cross-contaminate tests. Source: WP-004, Developer.
- **Project-level note (no action needed):** QA's own manual `node scripts/build-personas.js` invocation (run during WP-001 and WP-003 verification) regenerated the tracked, date-stamped `docs/references/agents-overview.md` with only a date-line diff — a harmless generated-artefact side effect of the test, not a code change. Flagged per the Generated Artefacts protocol for the Git Committer/user's awareness before the next commit, not reverted by QA since git write operations are reserved for the Git Committer or user.

### Next Steps

- No functional follow-up work remains in scope for this plan — all acceptance criteria across all 4 WPs were met and the exit gate (WP-004 AC 7, covering all three dependency WPs) passed, including the manual degraded-mode smoke test and version-sync check.
- The user still needs to perform the one Git write operation this plan intentionally left to them: `git rm --cached personas/name-mapping.json` to remove the file from the index now that `.gitignore` covers it (per WP-003's Notes, this is Human Action #1 and out of agent scope).
- Consider scheduling a changelog archive pass for the root `changelog.md` (13 release headings, past the >10 threshold) as a separate, unrelated housekeeping task.
- Consider a future manifest-curation pass to reconcile the inconsistent hand-maintained GUI-frontend-module list noted in WP-004's documentation stage.
- A browser-based accessibility audit (360px/768px/200% zoom, screen-reader, contrast) of the new setup-notices banner is recommended before release if strict WCAG sign-off is required, since QA substituted code inspection and a jsdom-driven smoke test for literal browser rendering.
