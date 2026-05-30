# AI Insights - Workspace Structure
<INSTRUCTION>
# AI Insights - Workspace Structure
Top-level directory tree of the ai-insights monorepo (depth 3). Use for initial orientation before navigating into specific modules.

</INSTRUCTION>
------------------------------------------------------------
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
    ├── 2026-04-08-subagents-manifest-key-design.md
    ├── documentation-audit.md
    ├── loading-mcp-tools-explained.md
    ├── prompt-clarity.md
└── docs/
    ├── agents/
    │   └── deferred-topics.md
    │   └── implementation-history/
    │       ├── README.md
    │   └── project-manifest/
    │       ├── README.md
    │   └── projects/
    │       ├── agent-name-map.md
    │       ├── parallelization.md
    │   └── references/
    │       ├── ctx-generator-guide.md
    │       ├── langgraph-deep-agents-subagent-handbook.md
    │   └── research/
    │       └── chat.json
    │       └── handoff-diagram.svg
└── history/
    ├── 2026-03-25-implementation-comparison.html
    ├── error-ledger.md
    ├── key-learnings.md
    ├── screenshots/
    │   └── 2026-02-17-qa-ledger-handoff.png
└── mcp-server/
    ├── AGENTS.md
    ├── README.md
    ├── changelog.md
    ├── coverage/
    │   ├── base.css
    │   ├── block-navigation.js
    │   ├── clover.xml
    │   ├── coverage-final.json
    │   ├── favicon.png
    │   ├── gui/
    │   │   ├── api.ts.html
    │   │   ├── chunk-renderer.ts.html
    │   │   ├── index.html
    │   │   ├── server.ts.html
    │   ├── index.html
    │   ├── prettify.css
    │   ├── prettify.js
    │   ├── sort-arrow-sprite.png
    │   ├── sorter.js
    ├── gui/
    │   ├── api-knowledge.ts
    │   ├── api.ts
    │   ├── chunk-renderer.ts
    │   ├── orchestrator-manager.ts
    │   ├── public/
    │   │   ├── api-client.js
    │   │   ├── app.js
    │   │   ├── index.html
    │   │   ├── router.js
    │   │   ├── stale-check.js
    │   │   ├── styles.css
    │   │   ├── theme-init.js
    │   │   ├── theme.js
    │   │   ├── utils.js
    │   ├── server.ts
    ├── module-context.yaml
    ├── package-lock.json
    ├── package.json
    ├── scripts/
    │   ├── move-unknown-project.js
    │   ├── rename-repository.js
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
    │   │   ├── knowledge.ts
    │   │   ├── project-meta.ts
    │   │   ├── root-index.ts
    │   │   ├── validators.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-manifest-schema.ts
    │   ├── storage/
    │   │   ├── atomic-writer.ts
    │   │   ├── file-lock.ts
    │   │   ├── knowledge-store.ts
    │   │   ├── ledger-store.ts
    │   │   ├── migrate-namespaced.ts
    │   ├── tools/
    │   │   ├── begin-work.ts
    │   │   ├── help-content.ts
    │   │   ├── help.ts
    │   │   ├── knowledge.ts
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
    │   │   └── workspace-versions.ts
    │   │   └── wp-id.ts
    ├── storage/
    │   ├── ledger/
    │   │   └── gui-config.json
    ├── tests/
    │   ├── gui-server.test.ts
    │   ├── gui/
    │   │   ├── api-client.test.ts
    │   │   ├── api-knowledge.test.ts
    │   │   ├── api-orchestrator.test.ts
    │   │   ├── api-reset.test.ts
    │   │   ├── api-wp-overview.test.ts
    │   │   ├── api.test.ts
    │   │   ├── auto-archive.test.ts
    │   │   ├── chunk-renderer.test.ts
    │   │   ├── client-rendering.test.ts
    │   │   ├── config.test.ts
    │   │   ├── dialogue-qa.test.ts
    │   │   ├── handoff-config-integration.test.ts
    │   │   ├── knowledge-api.test.ts
    │   │   ├── log-resolver.test.ts
    │   │   ├── orchestrator-manager.test.ts
    │   │   ├── orchestrator-view.test.ts
    │   │   ├── orchestrator-widgets.test.ts
    │   │   ├── project-detail-runs.test.ts
    │   │   ├── run-log-handlers.test.ts
    │   │   ├── run-log-server.test.ts
    │   │   ├── run-log.test.ts
    │   │   ├── security-headers.test.ts
    │   │   ├── server-body-limit.test.ts
    │   │   ├── server-error-mapping.test.ts
    │   │   ├── server-info.test.ts
    │   │   ├── server-knowledge-routes.test.ts
    │   │   ├── server-queue.test.ts
    │   │   ├── stale-check.test.ts
    │   ├── helpers/
    │   │   ├── create-temp-store.ts
    │   │   ├── fixtures.ts
    │   │   ├── test-utils.ts
    │   ├── integration/
    │   │   ├── auto-handoff.test.ts
    │   │   ├── full-workflow.test.ts
    │   ├── schema/
    │   │   ├── knowledge.test.ts
    │   │   ├── project-archiving-schema.test.ts
    │   │   ├── project-meta-runner.test.ts
    │   │   ├── root-index.test.ts
    │   │   ├── validators.test.ts
    │   │   ├── work-package-schema.test.ts
    │   ├── storage/
    │   │   ├── knowledge-store-exclusion.test.ts
    │   │   ├── knowledge-store.test.ts
    │   │   ├── ledger-store.test.ts
    │   │   ├── list-all-projects.test.ts
    │   │   ├── migrate-namespaced.test.ts
    │   │   ├── project-meta.test.ts
    │   │   ├── slug-resolution.test.ts
    │   ├── tools/
    │   │   ├── begin-work.test.ts
    │   │   ├── cancelled-status.test.ts
    │   │   ├── cascade-reblock.test.ts
    │   │   ├── claim-guard.test.ts
    │   │   ├── complete-pipeline-guards.test.ts
    │   │   ├── enrichment-resilience.test.ts
    │   │   ├── knowledge-help.test.ts
    │   │   ├── knowledge.test.ts
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
    │   │   └── derive-repo-name.test.ts
    │   │   └── if-defined.test.ts
    │   │   └── ledger-root.test.ts
    │   │   └── path-validator.test.ts
    │   │   └── pipeline-maps.test.ts
    │   │   └── progress.test.ts
    │   │   └── project-reset.test.ts
    │   │   └── runner.test.ts
    │   │   └── timestamp.test.ts
    │   │   └── workflow-helpers.test.ts
    │   │   └── workflow-manifest.test.ts
    │   │   └── wp-id.test.ts
    ├── tsconfig.json
    ├── vitest.config.ts
└── menu.cmd
└── menu.sh
└── orchestrator/
    ├── README.md
    ├── ai_insights_orchestrator.egg-info/
    │   ├── PKG-INFO/
    │   ├── SOURCES.txt
    │   ├── dependency_links.txt
    │   ├── entry_points.txt
    │   ├── requires.txt
    │   ├── top_level.txt
    ├── changelog.md
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
    │   │   ├── prompt_renderer.py
    │   │   ├── qa.py
    │   │   ├── release_engineer.py
    │   │   ├── reviewer.py
    │   │   ├── security_auditor.py
    │   │   ├── synthesis.py
    │   ├── state.py
    │   ├── supervisor.py
    │   ├── utils/
    │   │   └── __init__.py
    │   │   └── _revision.py
    │   │   └── chunk_writer.py
    │   │   └── dialogue_writer.py
    │   │   └── filelock.py
    │   │   └── logging.py
    │   │   └── mcp_parse.py
    │   │   └── persona.py
    │   │   └── persona_models.py
    │   │   └── plan_parser.py
    │   │   └── run_queue.py
    │   │   └── subagents.py
    │   │   └── subprocess_encoding.py
    │   │   └── tool_wrappers.py
    ├── tests/
    │   └── __init__.py
    │   └── conftest.py
    │   └── test_chunk_writer.py
    │   └── test_cli.py
    │   └── test_config.py
    │   └── test_dialogue_writer.py
    │   └── test_error_helpers.py
    │   └── test_filelock.py
    │   └── test_graph.py
    │   └── test_integration.py
    │   └── test_logging.py
    │   └── test_mcp_parse.py
    │   └── test_nodes.py
    │   └── test_persona_models.py
    │   └── test_plan_parser.py
    │   └── test_post_completion_guard.py
    │   └── test_prompt_renderer.py
    │   └── test_revision.py
    │   └── test_run_queue.py
    │   └── test_slug_dir.py
    │   └── test_state.py
    │   └── test_stream_retry.py
    │   └── test_streaming_capture.py
    │   └── test_subagents.py
    │   └── test_subprocess_encoding.py
    │   └── test_supervisor.py
    │   └── test_tool_wrappers.py
└── package-lock.json
└── package.json
└── personas/
    ├── README.md
    ├── changelog.md
    ├── docs/
    │   ├── persona-build-system.md
    │   ├── persona-design-guide.md
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
    │   ├── deep-agents/
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
    ├── name-mapping.json
    ├── package-lock.json
    ├── package.json
    ├── persona-build.config.js
    ├── plugins/
    │   ├── ledger/
    │   │   └── frontmatter-templates.js
    │   │   └── index.js
    │   │   └── mcp-tools-renderer.js
    │   │   └── role-validator.js
    │   │   └── roster-renderer.js
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
    │   │   └── pm-subagent-roster.md
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
    │       ├── developer-standalone.md
    │       ├── documentation-curator.md
    │       ├── git-committer.md
    │       ├── knowledge-archiver.md
    │       ├── ledger-bootstrapper.md
    │       ├── ledger-claude-coordinator.md
    │       ├── ledger-dependency-sequencer.md
    │       ├── ledger-doctor.md
    │       ├── ledger-orchestrator-runner.md
    │       ├── ledger-pipeline-configurator.md
    │       ├── ledger-wp-decomposer.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── persona-curator.md
    │       ├── plan-architect-reviewer.md
    │       ├── plan-auditor.md
    │       ├── plan-refiner.md
    │       ├── readme-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── whatsnew-curator.md
    │   └── deep-agents/
    │       ├── agents-md-curator.md
    │       ├── changelog-curator.md
    │       ├── composer-curator.md
    │       ├── ctx-architect.md
    │       ├── developer.md
    │       ├── documentation-curator.md
    │       ├── git-committer.md
    │       ├── knowledge-archiver.md
    │       ├── ledger-bootstrapper.md
    │       ├── ledger-claude-coordinator.md
    │       ├── ledger-dependency-sequencer.md
    │       ├── ledger-doctor.md
    │       ├── ledger-orchestrator-runner.md
    │       ├── ledger-pipeline-configurator.md
    │       ├── ledger-wp-decomposer.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── persona-curator.md
    │       ├── plan-architect-reviewer.md
    │       ├── plan-auditor.md
    │       ├── plan-refiner.md
    │       ├── readme-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── whatsnew-curator.md
    │   └── vs-code/
    │       └── agents-md-curator.agent.md
    │       └── changelog-curator.agent.md
    │       └── composer-curator.agent.md
    │       └── ctx-architect.agent.md
    │       └── developer-standalone.agent.md
    │       └── documentation-curator.agent.md
    │       └── git-committer.agent.md
    │       └── knowledge-archiver.agent.md
    │       └── ledger-bootstrapper.agent.md
    │       └── ledger-claude-coordinator.agent.md
    │       └── ledger-dependency-sequencer.agent.md
    │       └── ledger-doctor.agent.md
    │       └── ledger-orchestrator-runner.agent.md
    │       └── ledger-pipeline-configurator.agent.md
    │       └── ledger-wp-decomposer.agent.md
    │       └── manifest-curator.agent.md
    │       └── module-intent-architect.agent.md
    │       └── persona-curator.agent.md
    │       └── plan-architect-reviewer.agent.md
    │       └── plan-auditor.agent.md
    │       └── plan-refiner.agent.md
    │       └── readme-curator.agent.md
    │       └── researcher.agent.md
    │       └── unit-test-auditor.agent.md
    │       └── whatsnew-curator.agent.md
└── scripts/
    ├── build-personas.js
    ├── bundle-docs.js
    ├── check-known-roles.js
    ├── check-version-sync.js
    ├── cli.js
    ├── extract-changelog-entry.js
    ├── install-hooks.js
    ├── kill-orchestrator.js
    ├── migrate-synthesis-insights.js
    ├── normalize-ctx-paths.js
    ├── package-personas.js
    ├── preflight-bootstrap.js
    ├── preflight-orchestrator.js
    ├── preview-prompts.py
    ├── publish-locations.js
    ├── read-log.js
    ├── run-gui.js
    ├── run-orchestrator.js
    ├── sync-personas.js
    ├── tests/
    │   ├── README.md
    │   ├── ledger-plugin.test.js
    ├── validate-workflow-manifest.js
└── shared/
    ├── workflow-manifest.json
    ├── workflow-manifest.schema.json
└── vitest.config.ts

```