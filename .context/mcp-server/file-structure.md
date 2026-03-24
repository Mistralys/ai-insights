# MCP Server - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── mcp-server/
    └── AGENTS.md
    └── README.md
    └── changelog.md
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
        ├── public/
        │   ├── api-client.js
        │   ├── app.js
        │   ├── index.html
        │   ├── libs/
        │   │   ├── marked.min.js
        │   ├── router.js
        │   ├── styles.css
        │   ├── theme.js
        │   ├── utils.js
        │   ├── views/
        │   │   └── config.js
        │   │   └── insights.js
        │   │   └── project-detail.js
        │   │   └── project-list.js
        │   │   └── run-log.js
        │   │   └── work-package.js
        ├── server.ts
    └── module-context.yaml
    └── package-lock.json
    └── package.json
    └── scripts/
        ├── sync-version.js
    └── src/
        ├── gui/
        │   ├── auto-archive.ts
        │   ├── config.ts
        │   ├── errors.ts
        │   ├── handlers/
        │   │   ├── run-log-handlers.ts
        │   ├── log-resolver.ts
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
        │   ├── ledger-store-copy.txt
        │   ├── ledger-store.ts
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
        │   └── wp-id.ts
    └── tests/
        ├── gui/
        │   ├── api-client.test.ts
        │   ├── api-reset.test.ts
        │   ├── api-wp-overview.test.ts
        │   ├── api.test.ts
        │   ├── auto-archive.test.ts
        │   ├── client-rendering.test.ts
        │   ├── config.test.ts
        │   ├── dialogue-qa.test.ts
        │   ├── handoff-config-integration.test.ts
        │   ├── log-resolver.test.ts
        │   ├── project-detail-runs.test.ts
        │   ├── run-log-handlers.test.ts
        │   ├── run-log-server.test.ts
        │   ├── run-log.test.ts
        │   ├── security-headers.test.ts
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
        │   ├── project-meta.test.ts
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
        │   └── if-defined.test.ts
        │   └── ledger-root.test.ts
        │   └── path-validator.test.ts
        │   └── pipeline-maps.test.ts
        │   └── project-reset.test.ts
        │   └── runner.test.ts
        │   └── timestamp.test.ts
        │   └── workflow-helpers.test.ts
        │   └── workflow-manifest.test.ts
        │   └── wp-id.test.ts
    └── tsconfig.json
    └── vitest.config.ts

```