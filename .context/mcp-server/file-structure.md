# MCP Server - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── mcp-server/
    └── AGENTS.md
    └── README.md
    └── changelog.md
    └── coverage/
        ├── base.css
        ├── block-navigation.js
        ├── clover.xml
        ├── coverage-final.json
        ├── favicon.png
        ├── gui/
        │   ├── api.ts.html
        │   ├── chunk-renderer.ts.html
        │   ├── index.html
        │   ├── server.ts.html
        ├── index.html
        ├── prettify.css
        ├── prettify.js
        ├── sort-arrow-sprite.png
        ├── sorter.js
        ├── src/
        │   ├── gui/
        │   │   ├── auto-archive.ts.html
        │   │   ├── config.ts.html
        │   │   ├── errors.ts.html
        │   │   ├── handlers/
        │   │   │   ├── index.html
        │   │   │   ├── run-log-handlers.ts.html
        │   │   ├── index.html
        │   │   ├── log-resolver.ts.html
        │   ├── schema/
        │   │   ├── enums.ts.html
        │   │   ├── index.html
        │   │   ├── project-meta.ts.html
        │   │   ├── root-index.ts.html
        │   │   ├── validators.ts.html
        │   │   ├── work-package.ts.html
        │   │   ├── workflow-manifest-schema.ts.html
        │   ├── storage/
        │   │   ├── atomic-writer.ts.html
        │   │   ├── file-lock.ts.html
        │   │   ├── index.html
        │   │   ├── ledger-store.ts.html
        │   ├── tools/
        │   │   ├── begin-work.ts.html
        │   │   ├── help-content.ts.html
        │   │   ├── help.ts.html
        │   │   ├── index.html
        │   │   ├── observations.ts.html
        │   │   ├── pipeline.ts.html
        │   │   ├── project-lifecycle.ts.html
        │   │   ├── work-package.ts.html
        │   │   ├── workflow-handoff.ts.html
        │   │   ├── workflow-next-action-batch.ts.html
        │   │   ├── workflow-next-action.ts.html
        │   │   ├── workflow.ts.html
        │   ├── utils/
        │   │   └── agent-registry.ts.html
        │   │   └── client-info.ts.html
        │   │   └── constants.ts.html
        │   │   └── if-defined.ts.html
        │   │   └── index.html
        │   │   └── ledger-root.ts.html
        │   │   └── path-validator.ts.html
        │   │   └── pipeline-maps.ts.html
        │   │   └── project-reset.ts.html
        │   │   └── read-project-name.ts.html
        │   │   └── runner.ts.html
        │   │   └── server-version.ts.html
        │   │   └── timestamp.ts.html
        │   │   └── workflow-helpers.ts.html
        │   │   └── wp-id.ts.html
        ├── tests/
        │   └── helpers/
        │       └── create-temp-store.ts.html
        │       └── fixtures.ts.html
        │       └── index.html
    └── docs/
        ├── agents/
        │   └── project-manifest/
        │       ├── README.md
        │       ├── api-surface.md
        │       ├── constraints.md
        │       ├── data-flows.md
        │       ├── file-tree.md
        │       ├── tech-stack.md
        │   └── workflow-specification/
        │       └── README.md
        │       └── auxiliary-systems.md
        │       └── data-model.md
        │       └── dependencies-and-rework.md
        │       └── edge-cases.md
        │       └── handoff.md
        │       └── operations.md
        │       └── pipeline-routing.md
        │       └── recommendations.md
        │       └── state-machines.md
        │       └── walkthrough.md
    └── gui/
        ├── api.ts
        ├── chunk-renderer.ts
        ├── orchestrator-manager.ts
        ├── public/
        │   ├── api-client.js
        │   ├── app.js
        │   ├── index.html
        │   ├── js/
        │   │   ├── orchestrator-widgets.js
        │   ├── libs/
        │   │   ├── marked.min.js
        │   ├── router.js
        │   ├── stale-check.js
        │   ├── styles.css
        │   ├── theme.js
        │   ├── utils.js
        │   ├── views/
        │   │   └── config.js
        │   │   └── insights.js
        │   │   └── orchestrator.js
        │   │   └── project-detail.js
        │   │   └── project-list.js
        │   │   └── run-log.js
        │   │   └── work-package.js
        ├── server.ts
    └── module-context.yaml
    └── package-lock.json
    └── package.json
    └── scripts/
        ├── move-unknown-project.js
        ├── rename-repository.js
        ├── sync-version.js
    └── src/
        ├── gui/
        │   ├── auto-archive.ts
        │   ├── config.ts
        │   ├── errors.ts
        │   ├── handlers/
        │   │   ├── run-log-handlers.ts
        │   ├── log-resolver.ts
        │   ├── queue/
        │   │   └── compute-effective-status.ts
        │   │   └── format-progress-entry.ts
        │   │   └── get-queue.ts
        │   │   └── resolve-progress.ts
        │   │   └── types.ts
        │   │   └── validate-entry.ts
        ├── index.ts
        ├── schema/
        │   ├── enums.ts
        │   ├── project-meta.ts
        │   ├── root-index.ts
        │   ├── validators.ts
        │   ├── work-package.ts
        │   ├── workflow-manifest-schema.ts
        ├── storage/
        │   ├── atomic-writer.ts
        │   ├── file-lock.ts
        │   ├── ledger-store.ts
        │   ├── migrate-namespaced.ts
        ├── tools/
        │   ├── begin-work.ts
        │   ├── help-content.ts
        │   ├── help.ts
        │   ├── observations.ts
        │   ├── pipeline.ts
        │   ├── project-lifecycle.ts
        │   ├── work-package.ts
        │   ├── workflow-handoff.ts
        │   ├── workflow-next-action-batch.ts
        │   ├── workflow-next-action.ts
        │   ├── workflow.ts
        ├── utils/
        │   └── agent-registry.ts
        │   └── client-info.ts
        │   └── constants.ts
        │   └── if-defined.ts
        │   └── ledger-root.ts
        │   └── path-validator.ts
        │   └── pipeline-maps.ts
        │   └── project-reset.ts
        │   └── read-project-name.ts
        │   └── runner.ts
        │   └── server-version.ts
        │   └── timestamp.ts
        │   └── workflow-helpers.ts
        │   └── workspace-versions.ts
        │   └── wp-id.ts
    └── tests/
        ├── gui-server.test.ts
        ├── gui/
        │   ├── api-client.test.ts
        │   ├── api-orchestrator.test.ts
        │   ├── api-reset.test.ts
        │   ├── api-wp-overview.test.ts
        │   ├── api.test.ts
        │   ├── auto-archive.test.ts
        │   ├── chunk-renderer.test.ts
        │   ├── client-rendering.test.ts
        │   ├── config.test.ts
        │   ├── dialogue-qa.test.ts
        │   ├── handoff-config-integration.test.ts
        │   ├── log-resolver.test.ts
        │   ├── orchestrator-manager.test.ts
        │   ├── orchestrator-view.test.ts
        │   ├── orchestrator-widgets.test.ts
        │   ├── project-detail-runs.test.ts
        │   ├── queue/
        │   │   ├── compute-effective-status.test.ts
        │   │   ├── format-progress-entry.test.ts
        │   │   ├── get-queue.test.ts
        │   │   ├── resolve-progress.test.ts
        │   │   ├── validate-entry.test.ts
        │   ├── run-log-handlers.test.ts
        │   ├── run-log-server.test.ts
        │   ├── run-log.test.ts
        │   ├── security-headers.test.ts
        │   ├── server-body-limit.test.ts
        │   ├── server-error-mapping.test.ts
        │   ├── server-info.test.ts
        │   ├── server-queue.test.ts
        │   ├── stale-check.test.ts
        ├── helpers/
        │   ├── create-temp-store.ts
        │   ├── fixtures.ts
        │   ├── test-utils.ts
        ├── integration/
        │   ├── auto-handoff.test.ts
        │   ├── full-workflow.test.ts
        ├── schema/
        │   ├── project-archiving-schema.test.ts
        │   ├── project-meta-runner.test.ts
        │   ├── root-index.test.ts
        │   ├── validators.test.ts
        │   ├── work-package-schema.test.ts
        ├── storage/
        │   ├── ledger-store.test.ts
        │   ├── list-all-projects.test.ts
        │   ├── migrate-namespaced.test.ts
        │   ├── project-meta.test.ts
        │   ├── slug-resolution.test.ts
        ├── tools/
        │   ├── begin-work.test.ts
        │   ├── cancelled-status.test.ts
        │   ├── cascade-reblock.test.ts
        │   ├── claim-guard.test.ts
        │   ├── complete-pipeline-guards.test.ts
        │   ├── enrichment-resilience.test.ts
        │   ├── list-projects.test.ts
        │   ├── meta-enrichment.test.ts
        │   ├── observations.test.ts
        │   ├── pipeline-duration.test.ts
        │   ├── pipeline.test.ts
        │   ├── project-lifecycle.test.ts
        │   ├── rework-circuit-breaker.test.ts
        │   ├── runner-integration.test.ts
        │   ├── schema-integrity.test.ts
        │   ├── start-pipeline-guards.test.ts
        │   ├── synthesis-terminal.test.ts
        │   ├── version-freshness.test.ts
        │   ├── work-package.test.ts
        │   ├── workflow-batch-actions.test.ts
        │   ├── workflow-handoff.test.ts
        │   ├── workflow-next-action.test.ts
        │   ├── workflow-rework-loop.test.ts
        ├── utils/
        │   └── agent-registry.test.ts
        │   └── derive-repo-name.test.ts
        │   └── if-defined.test.ts
        │   └── ledger-root.test.ts
        │   └── path-validator.test.ts
        │   └── pipeline-maps.test.ts
        │   └── progress.test.ts
        │   └── project-reset.test.ts
        │   └── runner.test.ts
        │   └── timestamp.test.ts
        │   └── workflow-helpers.test.ts
        │   └── workflow-manifest.test.ts
        │   └── wp-id.test.ts
    └── tsconfig.json
    └── vitest.config.ts

```