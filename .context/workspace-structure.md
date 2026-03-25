# AI Insights - Workspace Structure
_SOURCE: Top-level directory tree_
# Top-level directory tree
###  
```
└── AGENTS.md
└── CLAUDE.md
└── README.md
└── changelog.md
└── context.yaml
└── discussions/
    ├── 2026-02-26-ui-agentic-techniques.md
    ├── 2026-03-01-future-without-libraries.md
    ├── documentation-audit.md
    ├── loading-mcp-tools-explained.md
    ├── prompt-clarity.md
└── docs/
    ├── agents/
    │   └── bug-reports/
    │       ├── chat.json
    │   └── implementation-history/
    │       ├── README.md
    │   └── project-manifest/
    │       └── README.md
└── history/
    ├── error-ledger.md
    ├── key-learnings.md
    ├── screenshots/
    │   └── 2026-02-17-qa-ledger-handoff.png
└── mcp-server/
    ├── AGENTS.md
    ├── README.md
    ├── changelog.md
    ├── gui/
    │   ├── api.ts
    │   ├── public/
    │   │   ├── api-client.js
    │   │   ├── app.js
    │   │   ├── index.html
    │   │   ├── router.js
    │   │   ├── styles.css
    │   │   ├── theme.js
    │   │   ├── utils.js
    │   ├── server.ts
    ├── module-context.yaml
    ├── package-lock.json
    ├── package.json
    ├── scripts/
    │   ├── sync-version.js
    ├── src/
    │   ├── gui/
    │   │   ├── auto-archive.ts
    │   │   ├── config.ts
    │   │   ├── errors.ts
    │   │   ├── log-resolver.ts
    │   ├── index.ts
    │   ├── schema/
    │   │   ├── enums.ts
    │   │   ├── project-meta.ts
    │   │   ├── root-index.ts
    │   │   ├── validators.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-manifest-schema.ts
    │   ├── storage/
    │   │   ├── atomic-writer.ts
    │   │   ├── file-lock.ts
    │   │   ├── ledger-store-copy.txt
    │   │   ├── ledger-store.ts
    │   ├── tools/
    │   │   ├── begin-work.ts
    │   │   ├── help-content.ts
    │   │   ├── help.ts
    │   │   ├── observations.ts
    │   │   ├── pipeline.ts
    │   │   ├── project-lifecycle.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-handoff.ts
    │   │   ├── workflow-next-action-batch.ts
    │   │   ├── workflow-next-action.ts
    │   │   ├── workflow.ts
    │   ├── utils/
    │   │   └── agent-registry.ts
    │   │   └── client-info.ts
    │   │   └── constants.ts
    │   │   └── if-defined.ts
    │   │   └── ledger-root.ts
    │   │   └── path-validator.ts
    │   │   └── pipeline-maps.ts
    │   │   └── project-reset.ts
    │   │   └── read-project-name.ts
    │   │   └── runner.ts
    │   │   └── server-version.ts
    │   │   └── timestamp.ts
    │   │   └── workflow-helpers.ts
    │   │   └── wp-id.ts
    ├── storage/
    │   ├── ledger/
    │   │   └── gui-config.json
    ├── tests/
    │   ├── gui/
    │   │   ├── api-client.test.ts
    │   │   ├── api-reset.test.ts
    │   │   ├── api-wp-overview.test.ts
    │   │   ├── api.test.ts
    │   │   ├── auto-archive.test.ts
    │   │   ├── client-rendering.test.ts
    │   │   ├── config.test.ts
    │   │   ├── dialogue-qa.test.ts
    │   │   ├── handoff-config-integration.test.ts
    │   │   ├── log-resolver.test.ts
    │   │   ├── project-detail-runs.test.ts
    │   │   ├── run-log-handlers.test.ts
    │   │   ├── run-log-server.test.ts
    │   │   ├── run-log.test.ts
    │   │   ├── security-headers.test.ts
    │   ├── helpers/
    │   │   ├── create-temp-store.ts
    │   │   ├── fixtures.ts
    │   │   ├── test-utils.ts
    │   ├── integration/
    │   │   ├── auto-handoff.test.ts
    │   │   ├── full-workflow.test.ts
    │   ├── schema/
    │   │   ├── project-archiving-schema.test.ts
    │   │   ├── project-meta-runner.test.ts
    │   │   ├── root-index.test.ts
    │   │   ├── validators.test.ts
    │   │   ├── work-package-schema.test.ts
    │   ├── storage/
    │   │   ├── ledger-store.test.ts
    │   │   ├── project-meta.test.ts
    │   ├── tools/
    │   │   ├── begin-work.test.ts
    │   │   ├── cancelled-status.test.ts
    │   │   ├── cascade-reblock.test.ts
    │   │   ├── claim-guard.test.ts
    │   │   ├── complete-pipeline-guards.test.ts
    │   │   ├── enrichment-resilience.test.ts
    │   │   ├── list-projects.test.ts
    │   │   ├── meta-enrichment.test.ts
    │   │   ├── observations.test.ts
    │   │   ├── pipeline-duration.test.ts
    │   │   ├── pipeline.test.ts
    │   │   ├── project-lifecycle.test.ts
    │   │   ├── rework-circuit-breaker.test.ts
    │   │   ├── runner-integration.test.ts
    │   │   ├── schema-integrity.test.ts
    │   │   ├── start-pipeline-guards.test.ts
    │   │   ├── synthesis-terminal.test.ts
    │   │   ├── version-freshness.test.ts
    │   │   ├── work-package.test.ts
    │   │   ├── workflow-batch-actions.test.ts
    │   │   ├── workflow-handoff.test.ts
    │   │   ├── workflow-next-action.test.ts
    │   │   ├── workflow-rework-loop.test.ts
    │   ├── utils/
    │   │   └── agent-registry.test.ts
    │   │   └── if-defined.test.ts
    │   │   └── ledger-root.test.ts
    │   │   └── path-validator.test.ts
    │   │   └── pipeline-maps.test.ts
    │   │   └── project-reset.test.ts
    │   │   └── runner.test.ts
    │   │   └── timestamp.test.ts
    │   │   └── workflow-helpers.test.ts
    │   │   └── workflow-manifest.test.ts
    │   │   └── wp-id.test.ts
    ├── tsconfig.json
    ├── vitest.config.ts
└── orchestrator/
    ├── README.md
    ├── _test_config.py
    ├── ai_insights_orchestrator.egg-info/
    │   ├── PKG-INFO/
    │   ├── SOURCES.txt
    │   ├── dependency_links.txt
    │   ├── entry_points.txt
    │   ├── requires.txt
    │   ├── top_level.txt
    ├── changelog.md
    ├── checkpoints/
    │   ├── test/
    │   │   ├── workflow.sqlite
    │   ├── workflow.sqlite
    │   ├── workflow.sqlite-shm
    │   ├── workflow.sqlite-wal
    ├── docs/
    │   ├── architecture.md
    │   ├── jsonl-log-schema.md
    │   ├── public-api.md
    │   ├── smoke-testing.md
    │   ├── supervisor-routing.md
    ├── module-context.yaml
    ├── pyproject.toml
    ├── requirements.txt
    ├── src/
    │   ├── __init__.py
    │   ├── cli.py
    │   ├── config.py
    │   ├── graph.py
    │   ├── mcp_client.py
    │   ├── nodes/
    │   │   ├── __init__.py
    │   │   ├── developer.py
    │   │   ├── docs.py
    │   │   ├── pm.py
    │   │   ├── qa.py
    │   │   ├── release_engineer.py
    │   │   ├── reviewer.py
    │   │   ├── security_auditor.py
    │   │   ├── synthesis.py
    │   ├── state.py
    │   ├── supervisor.py
    │   ├── utils/
    │   │   └── __init__.py
    │   │   └── dialogue_writer.py
    │   │   └── filelock.py
    │   │   └── logging.py
    │   │   └── mcp_parse.py
    │   │   └── persona.py
    │   │   └── plan_parser.py
    │   │   └── tool_wrappers.py
    ├── tests/
    │   └── __init__.py
    │   └── test_cli.py
    │   └── test_config.py
    │   └── test_dialogue_writer.py
    │   └── test_filelock.py
    │   └── test_graph.py
    │   └── test_integration.py
    │   └── test_logging.py
    │   └── test_mcp_parse.py
    │   └── test_nodes.py
    │   └── test_plan_parser.py
    │   └── test_state.py
    │   └── test_supervisor.py
    │   └── test_tool_wrappers.py
└── package-lock.json
└── package.json
└── personas/
    ├── README.md
    ├── changelog.md
    ├── ledger/
    │   ├── README.md
    │   ├── claude-code/
    │   │   ├── 1-planner.md
    │   │   ├── 2-project-manager.md
    │   │   ├── 3-developer.md
    │   │   ├── 4-qa.md
    │   │   ├── 5-security-auditor.md
    │   │   ├── 6-reviewer.md
    │   │   ├── 7-release-engineer.md
    │   │   ├── 8-documentation.md
    │   │   ├── 9-synthesis.md
    │   ├── vs-code/
    │   │   └── 1-planner.agent.md
    │   │   └── 2-pm.agent.md
    │   │   └── 3-dev.agent.md
    │   │   └── 4-qa.agent.md
    │   │   └── 5-security-auditor.agent.md
    │   │   └── 6-reviewer.agent.md
    │   │   └── 7-release-engineer.agent.md
    │   │   └── 8-docs.agent.md
    │   │   └── 9-synthesis.agent.md
    ├── module-context.yaml
    ├── package-lock.json
    ├── package.json
    ├── shared/
    │   ├── partials/
    │   │   └── agent-roster.md
    │   │   └── developer-operational-protocol.md
    │   │   └── developer-output-format.md
    │   │   └── developer-strict-constraints.md
    │   │   └── docs-operational-protocol.md
    │   │   └── docs-output-format.md
    │   │   └── incident-logging.md
    │   │   └── planner-core-rules.md
    │   │   └── planner-output-template.md
    │   │   └── pm-output-format.md
    │   │   └── qa-operational-protocol.md
    │   │   └── qa-output-format.md
    │   │   └── release-engineer-operational-protocol.md
    │   │   └── release-engineer-output-format.md
    │   │   └── reviewer-operational-protocol.md
    │   │   └── reviewer-output-format.md
    │   │   └── security-auditor-operational-protocol.md
    │   │   └── security-auditor-output-format.md
    │   │   └── synthesis-operational-protocol.md
    │   │   └── synthesis-output-format.md
    ├── standalone/
    │   └── README.md
    │   └── claude-code/
    │       ├── agents-md-curator.md
    │       ├── changelog-curator.md
    │       ├── composer-curator.md
    │       ├── ctx-architect.md
    │       ├── dependency-sequencer.md
    │       ├── ledger-bootstrapper.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── orchestrator-runner.md
    │       ├── pipeline-configurator.md
    │       ├── readme-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── whatsnew-curator.md
    │       ├── workflow-orchestrator.md
    │       ├── wp-decomposer.md
    │   └── vs-code/
    │       └── agents-md-curator.agent.md
    │       └── changelog-curator.agent.md
    │       └── composer-curator.agent.md
    │       └── ctx-architect.agent.md
    │       └── dependency-sequencer.agent.md
    │       └── ledger-bootstrapper.agent.md
    │       └── manifest-curator.agent.md
    │       └── module-intent-architect.agent.md
    │       └── orchestrator-runner.agent.md
    │       └── pipeline-configurator.agent.md
    │       └── readme-curator.agent.md
    │       └── researcher.agent.md
    │       └── unit-test-auditor.agent.md
    │       └── whatsnew-curator.agent.md
    │       └── workflow-orchestrator.agent.md
    │       └── wp-decomposer.agent.md
└── scripts/
    ├── build-personas.js
    ├── bundle-docs.js
    ├── check-known-roles.js
    ├── cli.js
    ├── extract-changelog-entry.js
    ├── install-hooks.js
    ├── lib/
    │   ├── persona-helpers.js
    ├── normalize-ctx-paths.js
    ├── package-personas.js
    ├── preflight-orchestrator.js
    ├── run-gui.js
    ├── run-orchestrator.js
    ├── sync-personas.js
    ├── tests/
    │   ├── persona-helpers.test.js
    ├── validate-workflow-manifest.js
└── shared/
    ├── workflow-manifest.json
    ├── workflow-manifest.schema.json
└── vitest.config.ts

```