# MCP Server - File Structure
<INSTRUCTION>
# MCP Server - File Structure
Full directory tree of the MCP server module. Use to locate source files before reading them.
</INSTRUCTION>
------------------------------------------------------------
_SOURCE: MCP server source directory tree_
# MCP server source directory tree
###  
```
└── mcp-server/
    └── AGENTS.md
    └── README.md
    └── changelog.md
    └── docs/
        ├── agents/
        │   └── plans/
        │       ├── 2026-06-26-kill-button-silent-failure/
        │       │   └── synthesis.md
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
        ├── api-knowledge.ts
        ├── api-repos.ts
        ├── api.ts
        ├── chunk-renderer.ts
        ├── docs/
        │   ├── agents/
        │   │   └── project-manifest/
        │   │       └── README.md
        │   │       └── api-surface.md
        │   │       └── constraints.md
        │   │       └── data-flows.md
        │   │       └── file-tree.md
        │   │       └── tech-stack.md
        │   │       └── ui-components.md
        ├── orchestrator-manager.ts
        ├── public/
        │   ├── api-client.js
        │   ├── app.js
        │   ├── components.js
        │   ├── index.html
        │   ├── js/
        │   │   ├── orchestrator-widgets.js
        │   ├── libs/
        │   │   ├── marked.min.js
        │   ├── router.js
        │   ├── stale-check.js
        │   ├── styles.css
        │   ├── theme-init.js
        │   ├── theme.js
        │   ├── utils.js
        │   ├── views/
        │   │   └── config.js
        │   │   └── insights.js
        │   │   └── knowledge.js
        │   │   └── orchestrator.js
        │   │   └── project-detail-helpers.js
        │   │   └── project-detail-modal.js
        │   │   └── project-detail-orch.js
        │   │   └── project-detail.js
        │   │   └── project-list.js
        │   │   └── run-log.js
        │   │   └── strategy.js
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
        │   ├── knowledge.ts
        │   ├── project-meta.ts
        │   ├── repository-registry.ts
        │   ├── root-index.ts
        │   ├── validators.ts
        │   ├── work-package.ts
        │   ├── workflow-manifest-schema.ts
        ├── tools/
        │   ├── begin-work.ts
        │   ├── help-content.ts
        │   ├── help.ts
        │   ├── knowledge.ts
        │   ├── observations.ts
        │   ├── pipeline.ts
        │   ├── project-lifecycle.ts
        │   ├── repository-context.ts
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
        │   └── project-resolver.ts
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
        │   ├── README.md
        │   ├── api-client.test.ts
        │   ├── api-knowledge.test.ts
        │   ├── api-orchestrator.test.ts
        │   ├── api-repos.test.ts
        │   ├── api-reset.test.ts
        │   ├── api-run-metadata.test.ts
        │   ├── api-wp-overview.test.ts
        │   ├── api.test.ts
        │   ├── auto-archive.test.ts
        │   ├── chunk-renderer.test.ts
        │   ├── client-rendering.test.ts
        │   ├── config.test.ts
        │   ├── dialogue-qa.test.ts
        │   ├── handoff-config-integration.test.ts
        │   ├── helpers/
        │   │   ├── api-stubs.ts
        │   │   ├── create-namespaced-project.test.ts
        │   │   ├── create-namespaced-project.ts
        │   │   ├── make-project.ts
        │   ├── insights-knowledge-links.test.ts
        │   ├── knowledge-api.test.ts
        │   ├── knowledge-repository-scope.test.ts
        │   ├── log-resolver.test.ts
        │   ├── orchestrator-manager.test.ts
        │   ├── orchestrator-view.test.ts
        │   ├── orchestrator-widgets.test.ts
        │   ├── project-detail-auto-update.test.ts
        │   ├── project-detail-diff.test.ts
        │   ├── project-detail-helpers.test.ts
        │   ├── project-detail-poll-modes.test.ts
        │   ├── project-detail-poll.test.ts
        │   ├── project-detail-resume.test.ts
        │   ├── project-detail-runs.test.ts
        │   ├── project-detail-scroll.test.ts
        │   ├── project-detail-snapshot.test.ts
        │   ├── project-list.test.ts
        │   ├── queue-ledger-status.test.ts
        │   ├── queue/
        │   │   ├── compute-effective-status.test.ts
        │   │   ├── format-progress-entry.test.ts
        │   │   ├── get-queue.test.ts
        │   │   ├── resolve-progress.test.ts
        │   │   ├── validate-entry.test.ts
        │   ├── router-utils.test.ts
        │   ├── run-log-handlers.test.ts
        │   ├── run-log-server.test.ts
        │   ├── run-log.test.ts
        │   ├── security-headers.test.ts
        │   ├── server-body-limit.test.ts
        │   ├── server-error-mapping.test.ts
        │   ├── server-info.test.ts
        │   ├── server-knowledge-routes.test.ts
        │   ├── server-queue.test.ts
        │   ├── setup-gui-globals.ts
        │   ├── stale-check.test.ts
        ├── helpers/
        │   ├── create-temp-store.ts
        │   ├── fixtures.ts
        │   ├── test-utils.ts
        ├── integration/
        │   ├── auto-handoff.test.ts
        │   ├── full-workflow.test.ts
        ├── schema/
        │   ├── knowledge.test.ts
        │   ├── project-archiving-schema.test.ts
        │   ├── project-meta-runner.test.ts
        │   ├── project-meta.test.ts
        │   ├── repository-registry.test.ts
        │   ├── root-index.test.ts
        │   ├── validators.test.ts
        │   ├── work-package-schema.test.ts
        ├── tools/
        │   ├── begin-work.test.ts
        │   ├── cancelled-status.test.ts
        │   ├── cascade-reblock.test.ts
        │   ├── claim-guard.test.ts
        │   ├── complete-pipeline-guards.test.ts
        │   ├── enrichment-resilience.test.ts
        │   ├── knowledge-help.test.ts
        │   ├── knowledge.test.ts
        │   ├── list-projects.test.ts
        │   ├── meta-enrichment.test.ts
        │   ├── observations.test.ts
        │   ├── pipeline-duration.test.ts
        │   ├── pipeline.test.ts
        │   ├── project-lifecycle.test.ts
        │   ├── reopen-cancelled-wp.test.ts
        │   ├── repository-context.test.ts
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
        │   └── project-resolver.test.ts
        │   └── runner.test.ts
        │   └── timestamp.test.ts
        │   └── workflow-helpers.test.ts
        │   └── workflow-manifest.test.ts
        │   └── wp-id.test.ts
    └── tsconfig.json
    └── vitest.config.ts

```