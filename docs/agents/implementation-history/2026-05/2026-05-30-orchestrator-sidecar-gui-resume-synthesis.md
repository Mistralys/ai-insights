# Synthesis Report — Orchestrator Sidecar & GUI Resume

**Plan:** 2026-05-30-orchestrator-sidecar-gui-resume
**Synthesised:** 2026-05-31
**Status:** ALL WORK PACKAGES COMPLETE (5/5)
**Pipeline health:** 23 stages run, 23 PASS, 0 FAIL

---

## Executive Summary

This session delivered end-to-end "Resume Run" capability for the MCP GUI: a user can now
resume an interrupted or failed orchestrator run directly from the project detail page, without
manually invoking the CLI. The implementation touches three layers:

1. **Python orchestrator** — a new `_write_run_metadata()` helper atomically writes
   `{plan_dir}/.orchestrator-run.json` immediately after lock acquisition and thread-ID
   resolution. The file captures all fields needed by consumers (thread_id, result, dry_run,
   pid, duration_s, …) and is updated at run end with the final result
   (SUCCESS / INTERRUPTED / ERROR).

2. **MCP server GUI backend** — a new `GET /api/projects/:slug/run-metadata` endpoint
   (`handleGetRunMetadata()`) reads the sidecar file for any known project. Path-traversal is
   blocked by the existing `assertSafeSlug()` guard. The `handleOrchestratorStart()` handler
   and `startOrchestrator()` function were extended to accept an optional `resumeThreadId`
   (UUID v4, validated at the API boundary) and spawn the orchestrator with `--resume
   <thread_id>` when it is present.

3. **GUI frontend** — a "Resume Run" button appears in the project detail Orchestrator Runs
   section when exactly the right conditions are met: no active run, project not COMPLETE /
   ARCHIVED, sidecar present with a valid thread_id, not a dry run, and last result not
   SUCCESS. Clicking disables the button, calls `orchestratorStart(planPath, false, threadId)`,
   and re-renders the view once the new queue entry appears.

All 13 acceptance criteria across WP-001 to WP-004 were met. WP-005 completed cross-project
documentation, manifest updates, and both module changelogs (MCP server v1.32.0, orchestrator
v0.22.0).

---

## Metrics

| Work Package | Stages | New Tests | Total Suite | PASS |
|---|---|---|---|---|
| WP-001 Sidecar write (orchestrator) | impl · qa · code-review · docs | 25 | 1,029 | ✓ |
| WP-002 API endpoint (MCP server) | impl · qa · security · code-review · docs | 10 | 2,764 | ✓ |
| WP-003 Resume spawn (MCP server) | impl · qa · security · code-review · docs | 15 | 2,764 | ✓ |
| WP-004 Resume button (GUI frontend) | impl · qa · code-review · docs | 0 (SPA) | 2,764 | ✓ |
| WP-005 Documentation sweep | docs | — | — | ✓ |

**Total new tests:** 50 (25 Python + 25 TypeScript)
**Regressions:** 0 across all runs
**Security issues (Critical/High/Medium/Low):** 0 — two Info observations only

### Security Audit Summary (WP-002 + WP-003)

| OWASP Category | Finding | Severity |
|---|---|---|
| A03 Injection | UUID v4 regex fully anchored; spawn uses array args — no shell injection possible | Info / Clean |
| A04 Insecure Design | No Zod schema validation on returned sidecar JSON (machine-written, local-only) | Info |
| A04 Insecure Design | UUID_V4 regex is an inline local const — potential duplication if reused | Info |
| All others | No issues identified | — |

---

## Files Modified

### Python orchestrator
- `orchestrator/src/cli.py` — `_write_run_metadata()`, run-start and run-end writes
- `orchestrator/tests/test_run_metadata.py` — 25 tests
- `.gitignore` — `.orchestrator-run.json` exclusion
- `orchestrator/README.md` — sidecar schema and lifecycle documentation

### MCP server — backend
- `mcp-server/gui/api.ts` — `handleGetRunMetadata()`, `handleOrchestratorStart()` extension
- `mcp-server/gui/server.ts` — route registration + catch-all exclusion guard
- `mcp-server/gui/orchestrator-manager.ts` — `startOrchestrator()` resumeThreadId param
- `mcp-server/tests/gui/api-run-metadata.test.ts` — 10 tests
- `mcp-server/tests/gui/orchestrator-manager.test.ts` — 7 new tests
- `mcp-server/tests/gui/api-orchestrator.test.ts` — 8 new + 3 updated tests

### MCP server — frontend
- `mcp-server/gui/public/api-client.js` — `getRunMetadata()`, extended `orchestratorStart()`
- `mcp-server/gui/public/views/project-detail.js` — Resume Run button, `pollResume` closure
- `mcp-server/gui/public/styles.css` — `.btn-resume`, `#orch-resume-cell` rules

### Documentation & manifests
- `mcp-server/docs/agents/project-manifest/api-surface.md` — handleGetRunMetadata, updated
  startOrchestrator + handleOrchestratorStart signatures, getRunMetadata client method,
  orchestratorStart 3-arg form, styles.css CSS classes
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Flow O.6 (GUI Resume Run)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — updated annotations for new files
- `orchestrator/docs/agents/project-manifest/data-flows.md` — Flow 5: sidecar write lifecycle
- `orchestrator/docs/agents/project-manifest/constraints.md` — constraint 24: atomic-write
  protocol and persistence contract
- `orchestrator/docs/agents/project-manifest/file-tree.md` — `_write_run_metadata`,
  `test_run_metadata.py`, runtime plan-directory artefacts section
- `AGENTS.md` — `.orchestrator-run.json` cross-system dependency row
- `mcp-server/changelog.md` — v1.32.0
- `orchestrator/changelog.md` — v0.22.0

---

## Reviewer-Applied Fixes

Two targeted fixes were applied during code review (non-behavioral, no test changes needed):

1. **WP-001 (cli.py `_write_run_metadata`)** — Added
   `finally: tmp_path.unlink(missing_ok=True)` inside a nested `try/except OSError` after
   `os.replace()`. Cleans up an orphaned `.tmp` file in the (rare) case that `write_text()`
   succeeds but `os.replace()` fails. Preserves the "never raises" contract.

2. **WP-002 (server.ts catch-all)** — Added `rest[2] !== 'run-metadata'` to the keyword
   exclusion guard before the `/:repo/:slug` catch-all route. Defensive consistency fix:
   prevents silent catch-all interception if the route order is ever changed in future.

---

## Strategic Recommendations

### Gold Nuggets

1. **Tombstone deprecation is now actionable.** The new `.orchestrator-run.json` sidecar
   carries the same terminal-state data (`result`, `error`, `duration_s`) as the existing
   hash-based tombstone (`{hash}-run-status.json`). Now that the sidecar is deployed and
   documented, a follow-up plan can remove the tombstone writes and the tombstone-reading logic
   in `server.ts` / `api.ts`, reducing dual-write complexity.

2. **API surface gap: namespaced resume-metadata route.** The new endpoint is
   `GET /api/projects/:slug/run-metadata` (single-segment). All other data routes (plan,
   synthesis, health, work-packages, dialogues, chunks) have a corresponding
   `GET /api/projects/:repo/:slug/…` namespaced variant for multi-root workspaces. A follow-up
   should add `GET /api/projects/:repo/:slug/run-metadata` to close this parity gap.

3. **`getRunMetadata()` and 3-arg `orchestratorStart()` lack unit tests.** `api-client.test.ts`
   does not yet cover the new `API.getRunMetadata(slug)` method or the
   `orchestratorStart(planPath, dryRun, resumeThreadId)` three-argument form. Other client
   methods in that file are tested. A small test addition would close this regression gap.

4. **`renderProjectDetail` resume-button logic is untested.** The WP explicitly accepted manual
   testing for the vanilla-JS SPA. A jsdom-based test following the existing pattern in
   `project-detail-runs.test.ts` (stub `API.getRunMetadata`, assert `#orch-resume-btn` appears
   or is hidden) would give regression protection for all 7 visibility conditions.

5. **`startOrchestrator()` is approaching options-object threshold.** The function now has 4
   positional parameters (`planPath`, `workspaceRoot`, `dryRun`, `resumeThreadId`). If a 5th
   parameter is ever needed, refactor to a named-params object
   `{ planPath, workspaceRoot, dryRun, resumeThreadId }` for long-term ergonomics.

6. **CTX context snapshot is stale.** `orchestrator/README.md` was updated in WP-001.
   Run `node scripts/cli.js ctx-generate` to regenerate `.context/orchestrator/overview.md`
   before the next CTX-dependent workflow (NotebookLM, external LLM ingestion, etc.).

7. **INTERRUPTED detection is fragile.** `cli.py` detects INTERRUPTED via
   `any('Interrupted' in e for e in outside_errors)`. If new interrupt sources are added, this
   string-contains check may miss them. A dedicated flag or enum would be more robust.

8. **Error banner duplication in `project-detail.js`.** The error-banner creation block is
   duplicated verbatim in both the `else` branch (`result.started` falsy) and the `.catch`
   handler of the resume click handler. Extracting a local `showResumeError(msg)` helper
   would be a one-touch cleanup.

---

## Next Steps

| Priority | Action |
|---|---|
| High | Add `GET /api/projects/:repo/:slug/run-metadata` namespaced route (parity gap) |
| Medium | Add `api-client.test.ts` tests for `getRunMetadata()` and 3-arg `orchestratorStart()` |
| Medium | Add jsdom-based resume button visibility tests to `project-detail-runs.test.ts` |
| Medium | Run `node scripts/cli.js ctx-generate` to refresh stale `.context/orchestrator/` |
| Low | Tombstone deprecation plan — remove `{hash}-run-status.json` dual-write |
| Low | Refactor `startOrchestrator()` to named-params object if 5th param is ever needed |
| Low | Extract UUID_V4 regex to module-level constant when a second use site appears |
| Low | Improve INTERRUPTED detection with a dedicated flag/enum in `cli.py` |

---

*Generated by Synthesis Agent v3.6.0 on 2026-05-31*
