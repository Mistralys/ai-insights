# Orchestrator Changelog

## v1.4.0 - Multi-Store Resolution

- Utils: Added store resolution utility for multi-store ledger root lookup.
- Tests: Added multi-store resolution test coverage.
- Tests: Prevented test files from persisting in live storage directories.

## v1.3.2 - Extended Persona YAML Glob

- Utils: Extended persona YAML glob to support role numbers with two or more digits.
- Tests: Added coverage for the extended glob pattern.

## v1.3.1 - MCP Tool Path Rewriting Exemption
- Nodes: PathNormalizationMiddleware now skips MCP tools that require absolute host paths.
- Nodes: Skip set derived dynamically from `mcp_tools` list in `create_stage_node()`.
- Tests: Added coverage for MCP tool exemption behavior in the path middleware.
- Docs: Updated constraints to document the required MCP tool skip pattern.

## v1.3.0 - Cross-Platform Path Middleware, Plan Rename, and Retry Fix
- Nodes: Added cross-platform PathNormalizationMiddleware; rewrites absolute host paths to
  virtual equivalents before Deep Agents validation on Windows, macOS, and Linux.
- Nodes: PathNormalizationMiddleware injected into every subagent spec returned by
  load_subagents(), ensuring subagent file operations are path-normalised on all platforms.
- Templates: Added project-path-reminder.md partial for path context in stage prompts.
- Nodes: Reclassified HTTP 401 as retryable; 403 is now the sole fatal authentication code.
- CLI: Added pre-run plan folder date-rename; preserves GUI run-status polling compatibility.
- Tests: Added Deep Agent integration test tier with fake LLM driver and mock tools.
- Tests: Added coverage for path middleware, plan rename, and stream retry behaviors.
- Docs: Updated constraints, api-surface, and data-flows for all new behaviors.

## v1.2.0 - PM Dialogue Capture and Windows Fixes
- Nodes: PM and Synthesis stages now capture dialogue even when not assigned to a work package.
- Nodes: Fixed Windows path resolution when running with virtual_mode=True.
- CLI: Project root is now inferred from the plan file path, removing the need for manual config.
- Tests: Extended streaming capture and slug-dir path construction test coverage.

## v1.1.0 - Ledger-Support Suite Resolution
- Utils: Subagent loading now resolves description and system prompt from `ledger-support` suite
  first, falling back to `standalone` for legacy slugs.
- Tests: Added ledger-support resolution tests covering suite priority and fallback order.
- Docs: Updated architecture guide and public API for the new resolution order.

## v1.0.0 - Run Metadata
- CLI: Added `.orchestrator-run.json` sidecar with atomic writes; result field updated at run end.
- Tests: Added run metadata tests covering initial write, atomic cleanup, result update, and schema.
- Nodes: Slug directory now uses namespaced `{ledgerRoot}/{repo_name}/{slug}` paths.
- CLI: Updated ledger log copy path to match namespaced slug directory layout.
- Tests: Added 9 unit tests for namespaced path construction.

---

Older versions are archived in [../docs/changelog-history/orchestrator](../docs/changelog-history/orchestrator).
Most recent archive: [v0.20](../docs/changelog-history/orchestrator/v0/v0.20.md).
