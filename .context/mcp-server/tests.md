# MCP Server - Tests
<INSTRUCTION>
# MCP Server - Tests
Directory tree of the Vitest test suite. Use to locate test files before running or editing them.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Test suite directory structure_
# Test suite directory structure
###  
```
└── mcp-server/
    └── tests/
        └── gui-server.test.ts
        └── gui/
            ├── README.md
            ├── api-client.test.ts
            ├── api-knowledge.test.ts
            ├── api-orchestrator.test.ts
            ├── api-repos.test.ts
            ├── api-reset.test.ts
            ├── api-run-metadata.test.ts
            ├── api-wp-overview.test.ts
            ├── api.test.ts
            ├── auto-archive.test.ts
            ├── chunk-renderer.test.ts
            ├── client-rendering.test.ts
            ├── config.test.ts
            ├── dialogue-qa.test.ts
            ├── handoff-config-integration.test.ts
            ├── helpers/
            │   ├── create-namespaced-project.test.ts
            │   ├── create-namespaced-project.ts
            ├── insights-knowledge-links.test.ts
            ├── knowledge-api.test.ts
            ├── knowledge-repository-scope.test.ts
            ├── log-resolver.test.ts
            ├── orchestrator-manager.test.ts
            ├── orchestrator-view.test.ts
            ├── orchestrator-widgets.test.ts
            ├── project-detail-runs.test.ts
            ├── project-list.test.ts
            ├── queue-ledger-status.test.ts
            ├── queue/
            │   ├── compute-effective-status.test.ts
            │   ├── format-progress-entry.test.ts
            │   ├── get-queue.test.ts
            │   ├── resolve-progress.test.ts
            │   ├── validate-entry.test.ts
            ├── router-utils.test.ts
            ├── run-log-handlers.test.ts
            ├── run-log-server.test.ts
            ├── run-log.test.ts
            ├── security-headers.test.ts
            ├── server-body-limit.test.ts
            ├── server-error-mapping.test.ts
            ├── server-info.test.ts
            ├── server-knowledge-routes.test.ts
            ├── server-queue.test.ts
            ├── setup-gui-globals.ts
            ├── stale-check.test.ts
        └── helpers/
            ├── create-temp-store.ts
            ├── fixtures.ts
            ├── test-utils.ts
        └── integration/
            ├── auto-handoff.test.ts
            ├── full-workflow.test.ts
        └── schema/
            ├── knowledge.test.ts
            ├── project-archiving-schema.test.ts
            ├── project-meta-runner.test.ts
            ├── project-meta.test.ts
            ├── repository-registry.test.ts
            ├── root-index.test.ts
            ├── validators.test.ts
            ├── work-package-schema.test.ts
        └── storage/
            ├── knowledge-store-exclusion.test.ts
            ├── knowledge-store.test.ts
            ├── ledger-store.test.ts
            ├── list-all-projects.test.ts
            ├── migrate-namespaced.test.ts
            ├── project-meta.test.ts
            ├── repository-registry.test.ts
            ├── slug-resolution.test.ts
        └── tools/
            ├── begin-work.test.ts
            ├── cancelled-status.test.ts
            ├── cascade-reblock.test.ts
            ├── claim-guard.test.ts
            ├── complete-pipeline-guards.test.ts
            ├── enrichment-resilience.test.ts
            ├── knowledge-help.test.ts
            ├── knowledge.test.ts
            ├── list-projects.test.ts
            ├── meta-enrichment.test.ts
            ├── observations.test.ts
            ├── pipeline-duration.test.ts
            ├── pipeline.test.ts
            ├── project-lifecycle.test.ts
            ├── reopen-cancelled-wp.test.ts
            ├── repository-context.test.ts
            ├── rework-circuit-breaker.test.ts
            ├── runner-integration.test.ts
            ├── schema-integrity.test.ts
            ├── start-pipeline-guards.test.ts
            ├── synthesis-terminal.test.ts
            ├── version-freshness.test.ts
            ├── work-package.test.ts
            ├── workflow-batch-actions.test.ts
            ├── workflow-handoff.test.ts
            ├── workflow-next-action.test.ts
            ├── workflow-rework-loop.test.ts
        └── utils/
            └── agent-registry.test.ts
            └── derive-repo-name.test.ts
            └── if-defined.test.ts
            └── ledger-root.test.ts
            └── path-validator.test.ts
            └── pipeline-maps.test.ts
            └── progress.test.ts
            └── project-reset.test.ts
            └── project-resolver.test.ts
            └── runner.test.ts
            └── timestamp.test.ts
            └── workflow-helpers.test.ts
            └── workflow-manifest.test.ts
            └── wp-id.test.ts

```