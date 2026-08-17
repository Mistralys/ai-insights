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
            ├── api-chunk-text.test.ts
            ├── api-client.test.ts
            ├── api-dialogue-parse.test.ts
            ├── api-knowledge.test.ts
            ├── api-models.test.ts
            ├── api-orchestrator.test.ts
            ├── api-repos-store.test.ts
            ├── api-repos.test.ts
            ├── api-reset.test.ts
            ├── api-run-metadata.test.ts
            ├── api-store-conflicts.test.ts
            ├── api-stores.test.ts
            ├── api-wp-overview.test.ts
            ├── api.test.ts
            ├── auto-archive-multi-store.test.ts
            ├── auto-archive.test.ts
            ├── chunk-renderer-text.test.ts
            ├── chunk-renderer.test.ts
            ├── client-rendering.test.ts
            ├── config-helpers.test.ts
            ├── config.test.ts
            ├── dialogue-qa.test.ts
            ├── dispatch-route.test.ts
            ├── handoff-config-integration.test.ts
            ├── helpers/
            │   ├── api-stubs.ts
            │   ├── create-namespaced-project.test.ts
            │   ├── create-namespaced-project.ts
            │   ├── make-project.ts
            ├── insights-knowledge-links.test.ts
            ├── knowledge-api-multi-store.test.ts
            ├── knowledge-repository-scope.test.ts
            ├── log-resolver.test.ts
            ├── model-registry.test.ts
            ├── multi-store-api.test.ts
            ├── orchestrator-manager.test.ts
            ├── orchestrator-view.test.ts
            ├── orchestrator-widgets.test.ts
            ├── project-detail-auto-update.test.ts
            ├── project-detail-dialogues.test.ts
            ├── project-detail-diff.test.ts
            ├── project-detail-helpers.test.ts
            ├── project-detail-poll-modes.test.ts
            ├── project-detail-poll.test.ts
            ├── project-detail-resume.test.ts
            ├── project-detail-runs.test.ts
            ├── project-detail-scroll.test.ts
            ├── project-detail-snapshot.test.ts
            ├── project-detail-wp-title.test.ts
            ├── project-list.test.ts
            ├── queue-ledger-status.test.ts
            ├── queue-multi-store.test.ts
            ├── queue/
            │   ├── compute-effective-status.test.ts
            │   ├── format-progress-entry.test.ts
            │   ├── get-queue.test.ts
            │   ├── resolve-progress.test.ts
            │   ├── validate-entry.test.ts
            ├── route-structured-format.test.ts
            ├── route-table.test.ts
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
            ├── work-package-detail.test.ts
        └── helpers/
            ├── create-temp-store.ts
            ├── fixtures.ts
            ├── test-utils.ts
        └── integration/
            ├── auto-handoff.test.ts
            ├── full-workflow.test.ts
        └── schema/
            ├── common.test.ts
            ├── knowledge.test.ts
            ├── project-archiving-schema.test.ts
            ├── project-meta-runner.test.ts
            ├── project-meta.test.ts
            ├── repository-registry.test.ts
            ├── root-index.test.ts
            ├── store-config.test.ts
            ├── validators.test.ts
            ├── work-package-schema.test.ts
        └── startup/
            ├── tool-log-sync.test.ts
        └── storage/
            ├── cross-device-portability.test.ts
            ├── knowledge-store-exclusion.test.ts
            ├── knowledge-store.test.ts
            ├── ledger-store.test.ts
            ├── list-all-projects.test.ts
            ├── migrate-namespaced.test.ts
            ├── multi-store-conflicts.test.ts
            ├── multi-store-manager.test.ts
            ├── project-meta.test.ts
            ├── repository-registry.test.ts
            ├── slug-resolution.test.ts
            ├── store-context-reload.test.ts
            ├── store-context.test.ts
            ├── store-registry.test.ts
            ├── store-router.test.ts
        └── tools/
            ├── begin-work.test.ts
            ├── cancelled-status.test.ts
            ├── cascade-reblock.test.ts
            ├── claim-guard.test.ts
            ├── complete-pipeline-guards.test.ts
            ├── enrichment-resilience.test.ts
            ├── knowledge-help.test.ts
            ├── knowledge-multi-store.test.ts
            ├── knowledge.test.ts
            ├── list-projects.test.ts
            ├── meta-enrichment.test.ts
            ├── multi-store-tool-resolution.test.ts
            ├── observations.test.ts
            ├── ping.test.ts
            ├── pipeline-duration.test.ts
            ├── pipeline.test.ts
            ├── project-lifecycle-multi-store.test.ts
            ├── project-lifecycle.test.ts
            ├── reopen-cancelled-wp.test.ts
            ├── repository-context-multi-store.test.ts
            ├── repository-context.test.ts
            ├── rework-circuit-breaker.test.ts
            ├── runner-integration.test.ts
            ├── schema-integrity.test.ts
            ├── standalone-import-multi-store.test.ts
            ├── standalone-import.test.ts
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
            └── store-resolution.test.ts
            └── synthesis-parser.test.ts
            └── timestamp.test.ts
            └── workflow-helpers.test.ts
            └── workflow-manifest.test.ts
            └── wp-id.test.ts

```