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
└── docs/
    ├── _config.yml
    ├── _layouts/
    │   ├── default.html
    ├── agents/
    │   ├── deferred-topics.md
    │   ├── implementation-history/
    │   │   ├── README.md
    │   ├── project-manifest/
    │   │   ├── README.md
    │   ├── references/
    │   │   ├── README.md
    │   │   ├── ctx-generator-guide.md
    │   │   ├── langgraph-deep-agents-subagent-handbook.md
    │   │   ├── ledger-workflow-visual-guide.md
    │   ├── research/
    │   │   └── 2026-05-28-ce-framework-audit.md
    │   │   └── 2026-05-29-developer-experience.md
    │   │   └── 2026-05-29-ledger-gui-quality-improvements.md
    │   │   └── 2026-07-15-deepagents-browser-tool.md
    │   │   └── 2026-07-17-browser-mcp-service.md
    │   │   └── 2026-07-17-multi-root-orchestrator.md
    │   │   └── 2026-07-21-litellm-provider.md
    ├── discussions/
    │   ├── 2026-02-26-ui-agentic-techniques.md
    │   ├── 2026-03-01-future-without-libraries.md
    │   ├── 2026-06-30-token-cost-fallacies.md
    │   ├── 2026-07-15-planning-research-split.md
    │   ├── documentation-audit.md
    │   ├── loading-mcp-tools-explained.md
    │   ├── prompt-clarity.md
    │   ├── task-separation.md
    ├── history/
    │   ├── 2026-03-25-implementation-comparison.html
    │   ├── error-ledger.md
    │   ├── key-learnings.md
    │   ├── screenshots/
    │   │   └── 2026-02-17-qa-ledger-handoff.png
    ├── index.md
    ├── presentation/
    │   ├── build.cmd
    │   ├── build.sh
    │   ├── changelog.md
    │   ├── img/
    │   │   ├── ledger-gui.png
    │   │   ├── work-package-stages.png
    │   ├── partials/
    │   │   ├── recipe-results-persona.md
    │   │   ├── recipe-results-vanilla.md
    │   ├── slides.json
    │   ├── slides/
    │   │   ├── agenda.html
    │   │   ├── agentic-workflow.html
    │   │   ├── battle-tested.html
    │   │   ├── build-pipeline.html
    │   │   ├── build-your-personas.html
    │   │   ├── coordination-problem.html
    │   │   ├── demo-divider.html
    │   │   ├── domain-knowledge.html
    │   │   ├── dynamic-pipelines.html
    │   │   ├── english-best.html
    │   │   ├── identity-anchor.html
    │   │   ├── intro.html
    │   │   ├── key-takeaways.html
    │   │   ├── knowledge-persists.html
    │   │   ├── markdown-format.html
    │   │   ├── meet-the-team.html
    │   │   ├── nlp.html
    │   │   ├── orchestrator.html
    │   │   ├── part1-divider.html
    │   │   ├── part2-divider.html
    │   │   ├── part3-divider.html
    │   │   ├── persona-difference.html
    │   │   ├── persona-structure.html
    │   │   ├── persona-what.html
    │   │   ├── platforms.html
    │   │   ├── project-ledger.html
    │   │   ├── recipe-curator.html
    │   │   ├── scaling-problem.html
    │   │   ├── template-syntax.html
    │   │   ├── thank-you.html
    │   │   ├── title.html
    │   │   ├── values-standards.html
    │   ├── template.html
    │   ├── tools/
    │   │   └── build.js
    ├── references/
    │   └── agents-overview.md
    │   └── development.md
    │   └── menu-guide.md
    │   └── multi-store-guide.md
    │   └── orchestrator-user-guide.md
    │   └── persona-quickstart-ide.md
    │   └── persona-quickstart-web.md
    │   └── persona-quickstart.md
    │   └── project-overview.md
    │   └── workflow-and-ledger.md
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
    │   ├── api-models.ts
    │   ├── api-repos.ts
    │   ├── api-stores.ts
    │   ├── api.ts
    │   ├── chunk-accumulator.ts
    │   ├── chunk-renderer.ts
    │   ├── orchestrator-manager.ts
    │   ├── public/
    │   │   ├── api-client.js
    │   │   ├── app.js
    │   │   ├── components.js
    │   │   ├── index.html
    │   │   ├── modal.js
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
    │   │   ├── model-registry.ts
    │   ├── index.ts
    │   ├── schema/
    │   │   ├── common.ts
    │   │   ├── enums.ts
    │   │   ├── knowledge.ts
    │   │   ├── project-meta.ts
    │   │   ├── repository-registry.ts
    │   │   ├── root-index.ts
    │   │   ├── store-config.ts
    │   │   ├── validators.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-manifest-schema.ts
    │   ├── storage/
    │   │   ├── atomic-writer.ts
    │   │   ├── file-lock.ts
    │   │   ├── knowledge-store.ts
    │   │   ├── ledger-store.ts
    │   │   ├── migrate-namespaced.ts
    │   │   ├── multi-store-manager.ts
    │   │   ├── repository-registry.ts
    │   │   ├── store-context.ts
    │   │   ├── store-registry.ts
    │   │   ├── store-router.ts
    │   ├── tools/
    │   │   ├── begin-work.ts
    │   │   ├── help-content.ts
    │   │   ├── help.ts
    │   │   ├── knowledge.ts
    │   │   ├── observations.ts
    │   │   ├── ping.ts
    │   │   ├── pipeline.ts
    │   │   ├── project-lifecycle.ts
    │   │   ├── repository-context.ts
    │   │   ├── standalone-import.ts
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
    │   │   └── project-resolver.ts
    │   │   └── read-project-name.ts
    │   │   └── runner.ts
    │   │   └── server-version.ts
    │   │   └── store-resolution.ts
    │   │   └── synthesis-parser.ts
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
    │   │   ├── README.md
    │   │   ├── api-chunk-text.test.ts
    │   │   ├── api-client.test.ts
    │   │   ├── api-dialogue-parse.test.ts
    │   │   ├── api-knowledge.test.ts
    │   │   ├── api-models.test.ts
    │   │   ├── api-orchestrator.test.ts
    │   │   ├── api-repos-store.test.ts
    │   │   ├── api-repos.test.ts
    │   │   ├── api-reset.test.ts
    │   │   ├── api-run-metadata.test.ts
    │   │   ├── api-store-conflicts.test.ts
    │   │   ├── api-stores.test.ts
    │   │   ├── api-wp-overview.test.ts
    │   │   ├── api.test.ts
    │   │   ├── auto-archive-multi-store.test.ts
    │   │   ├── auto-archive.test.ts
    │   │   ├── chunk-renderer-text.test.ts
    │   │   ├── chunk-renderer.test.ts
    │   │   ├── client-rendering.test.ts
    │   │   ├── config-helpers.test.ts
    │   │   ├── config.test.ts
    │   │   ├── dialogue-qa.test.ts
    │   │   ├── dispatch-route.test.ts
    │   │   ├── handoff-config-integration.test.ts
    │   │   ├── insights-knowledge-links.test.ts
    │   │   ├── knowledge-api-multi-store.test.ts
    │   │   ├── knowledge-repository-scope.test.ts
    │   │   ├── log-resolver.test.ts
    │   │   ├── model-registry.test.ts
    │   │   ├── multi-store-api.test.ts
    │   │   ├── orchestrator-manager.test.ts
    │   │   ├── orchestrator-view.test.ts
    │   │   ├── orchestrator-widgets.test.ts
    │   │   ├── project-detail-auto-update.test.ts
    │   │   ├── project-detail-dialogues.test.ts
    │   │   ├── project-detail-diff.test.ts
    │   │   ├── project-detail-helpers.test.ts
    │   │   ├── project-detail-poll-modes.test.ts
    │   │   ├── project-detail-poll.test.ts
    │   │   ├── project-detail-resume.test.ts
    │   │   ├── project-detail-runs.test.ts
    │   │   ├── project-detail-scroll.test.ts
    │   │   ├── project-detail-snapshot.test.ts
    │   │   ├── project-detail-wp-title.test.ts
    │   │   ├── project-list.test.ts
    │   │   ├── queue-ledger-status.test.ts
    │   │   ├── queue-multi-store.test.ts
    │   │   ├── route-structured-format.test.ts
    │   │   ├── route-table.test.ts
    │   │   ├── router-utils.test.ts
    │   │   ├── run-log-handlers.test.ts
    │   │   ├── run-log-server.test.ts
    │   │   ├── run-log.test.ts
    │   │   ├── security-headers.test.ts
    │   │   ├── server-body-limit.test.ts
    │   │   ├── server-error-mapping.test.ts
    │   │   ├── server-info.test.ts
    │   │   ├── server-knowledge-routes.test.ts
    │   │   ├── server-queue.test.ts
    │   │   ├── setup-gui-globals.ts
    │   │   ├── stale-check.test.ts
    │   │   ├── work-package-detail.test.ts
    │   ├── helpers/
    │   │   ├── create-temp-store.ts
    │   │   ├── fixtures.ts
    │   │   ├── test-utils.ts
    │   ├── integration/
    │   │   ├── auto-handoff.test.ts
    │   │   ├── full-workflow.test.ts
    │   ├── schema/
    │   │   ├── common.test.ts
    │   │   ├── knowledge.test.ts
    │   │   ├── project-archiving-schema.test.ts
    │   │   ├── project-meta-runner.test.ts
    │   │   ├── project-meta.test.ts
    │   │   ├── repository-registry.test.ts
    │   │   ├── root-index.test.ts
    │   │   ├── store-config.test.ts
    │   │   ├── validators.test.ts
    │   │   ├── work-package-schema.test.ts
    │   ├── startup/
    │   │   ├── tool-log-sync.test.ts
    │   ├── storage/
    │   │   ├── cross-device-portability.test.ts
    │   │   ├── knowledge-store-exclusion.test.ts
    │   │   ├── knowledge-store.test.ts
    │   │   ├── ledger-store.test.ts
    │   │   ├── list-all-projects.test.ts
    │   │   ├── migrate-namespaced.test.ts
    │   │   ├── multi-store-conflicts.test.ts
    │   │   ├── multi-store-manager.test.ts
    │   │   ├── project-meta.test.ts
    │   │   ├── repository-registry.test.ts
    │   │   ├── slug-resolution.test.ts
    │   │   ├── store-context-reload.test.ts
    │   │   ├── store-context.test.ts
    │   │   ├── store-registry.test.ts
    │   │   ├── store-router.test.ts
    │   ├── tools/
    │   │   ├── begin-work.test.ts
    │   │   ├── cancelled-status.test.ts
    │   │   ├── cascade-reblock.test.ts
    │   │   ├── claim-guard.test.ts
    │   │   ├── complete-pipeline-guards.test.ts
    │   │   ├── enrichment-resilience.test.ts
    │   │   ├── knowledge-help.test.ts
    │   │   ├── knowledge-multi-store.test.ts
    │   │   ├── knowledge.test.ts
    │   │   ├── list-projects.test.ts
    │   │   ├── meta-enrichment.test.ts
    │   │   ├── multi-store-tool-resolution.test.ts
    │   │   ├── observations.test.ts
    │   │   ├── ping.test.ts
    │   │   ├── pipeline-duration.test.ts
    │   │   ├── pipeline.test.ts
    │   │   ├── project-lifecycle-multi-store.test.ts
    │   │   ├── project-lifecycle.test.ts
    │   │   ├── reopen-cancelled-wp.test.ts
    │   │   ├── repository-context-multi-store.test.ts
    │   │   ├── repository-context.test.ts
    │   │   ├── rework-circuit-breaker.test.ts
    │   │   ├── runner-integration.test.ts
    │   │   ├── schema-integrity.test.ts
    │   │   ├── standalone-import-multi-store.test.ts
    │   │   ├── standalone-import.test.ts
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
    │   │   └── project-resolver.test.ts
    │   │   └── runner.test.ts
    │   │   └── store-resolution.test.ts
    │   │   └── synthesis-parser.test.ts
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
    │   │   └── path_middleware.py
    │   │   └── persona.py
    │   │   └── persona_models.py
    │   │   └── plan_parser.py
    │   │   └── run_queue.py
    │   │   └── store_resolution.py
    │   │   └── subagents.py
    │   │   └── subprocess_encoding.py
    │   │   └── tool_wrappers.py
    ├── tests/
    │   └── README.md
    │   └── __init__.py
    │   └── conftest.py
    │   └── helpers/
    │       ├── __init__.py
    │       ├── fake_chat_model.py
    │       ├── mock_tools.py
    │   └── test_chunk_writer.py
    │   └── test_cli.py
    │   └── test_config.py
    │   └── test_deep_agent_integration.py
    │   └── test_dialogue_writer.py
    │   └── test_error_helpers.py
    │   └── test_filelock.py
    │   └── test_graph.py
    │   └── test_integration.py
    │   └── test_logging.py
    │   └── test_mcp_parse.py
    │   └── test_nodes.py
    │   └── test_path_middleware.py
    │   └── test_persona_models.py
    │   └── test_persona_models_assignments.py
    │   └── test_plan_parser.py
    │   └── test_post_completion_guard.py
    │   └── test_prompt_renderer.py
    │   └── test_revision.py
    │   └── test_run_metadata.py
    │   └── test_run_queue.py
    │   └── test_slug_dir.py
    │   └── test_state.py
    │   └── test_store_resolution.py
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
    │   ├── persona-anchoring.md
    │   ├── persona-build-system.md
    │   ├── persona-design-guide.md
    ├── ledger-support/
    │   ├── README.md
    │   ├── claude-code/
    │   │   ├── ledger-bootstrapper.md
    │   │   ├── ledger-claude-coordinator.md
    │   │   ├── ledger-dependency-sequencer.md
    │   │   ├── ledger-doctor.md
    │   │   ├── ledger-knowledge-archiver.md
    │   │   ├── ledger-knowledge-curator.md
    │   │   ├── ledger-orchestrator-archaeologist.md
    │   │   ├── ledger-orchestrator-runner.md
    │   │   ├── ledger-pipeline-configurator.md
    │   │   ├── ledger-wp-decomposer.md
    │   │   ├── standalone-archiver.md
    │   ├── deep-agents/
    │   │   ├── ledger-bootstrapper.md
    │   │   ├── ledger-claude-coordinator.md
    │   │   ├── ledger-dependency-sequencer.md
    │   │   ├── ledger-doctor.md
    │   │   ├── ledger-knowledge-archiver.md
    │   │   ├── ledger-knowledge-curator.md
    │   │   ├── ledger-orchestrator-archaeologist.md
    │   │   ├── ledger-orchestrator-runner.md
    │   │   ├── ledger-pipeline-configurator.md
    │   │   ├── ledger-wp-decomposer.md
    │   │   ├── standalone-archiver.md
    │   ├── vs-code/
    │   │   └── ledger-bootstrapper.agent.md
    │   │   └── ledger-claude-coordinator.agent.md
    │   │   └── ledger-dependency-sequencer.agent.md
    │   │   └── ledger-doctor.agent.md
    │   │   └── ledger-knowledge-archiver.agent.md
    │   │   └── ledger-knowledge-curator.agent.md
    │   │   └── ledger-orchestrator-archaeologist.agent.md
    │   │   └── ledger-orchestrator-runner.agent.md
    │   │   └── ledger-pipeline-configurator.agent.md
    │   │   └── ledger-wp-decomposer.agent.md
    │   │   └── standalone-archiver.agent.md
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
    ├── model-registry/
    │   ├── README.md
    │   ├── assignments.json
    │   ├── default.json
    │   ├── local.json
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
    │   │   └── ax-feedback.md
    │   │   └── developer-operational-protocol.md
    │   │   └── developer-output-format.md
    │   │   └── developer-strict-constraints.md
    │   │   └── docs-operational-protocol.md
    │   │   └── docs-output-format.md
    │   │   └── incident-logging.md
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
    │   │   └── summary-crafting-guide.md
    │   │   └── synthesis-knowledge-collection.md
    │   │   └── synthesis-operational-protocol.md
    │   │   └── synthesis-output-format.md
    ├── standalone/
    │   └── README.md
    │   └── claude-code/
    │       ├── agents-md-curator.md
    │       ├── changelog-curator.md
    │       ├── comms-curator.md
    │       ├── composer-curator.md
    │       ├── ctx-architect.md
    │       ├── developer-standalone.md
    │       ├── documentation-curator.md
    │       ├── git-committer.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── persona-curator.md
    │       ├── plan-architect-reviewer.md
    │       ├── plan-auditor.md
    │       ├── plan-refiner.md
    │       ├── planner.md
    │       ├── readme-curator.md
    │       ├── recipe-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── web-gui-specialist.md
    │       ├── whatsnew-curator.md
    │       ├── workspace-architect.md
    │   └── deep-agents/
    │       ├── agents-md-curator.md
    │       ├── changelog-curator.md
    │       ├── comms-curator.md
    │       ├── composer-curator.md
    │       ├── ctx-architect.md
    │       ├── developer.md
    │       ├── documentation-curator.md
    │       ├── git-committer.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── persona-curator.md
    │       ├── plan-architect-reviewer.md
    │       ├── plan-auditor.md
    │       ├── plan-refiner.md
    │       ├── planner.md
    │       ├── readme-curator.md
    │       ├── recipe-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── web-gui-specialist.md
    │       ├── whatsnew-curator.md
    │       ├── workspace-architect.md
    │   └── vs-code/
    │       └── agents-md-curator.agent.md
    │       └── changelog-curator.agent.md
    │       └── comms-curator.agent.md
    │       └── composer-curator.agent.md
    │       └── ctx-architect.agent.md
    │       └── developer-standalone.agent.md
    │       └── documentation-curator.agent.md
    │       └── git-committer.agent.md
    │       └── manifest-curator.agent.md
    │       └── module-intent-architect.agent.md
    │       └── persona-curator.agent.md
    │       └── plan-architect-reviewer.agent.md
    │       └── plan-auditor.agent.md
    │       └── plan-refiner.agent.md
    │       └── planner.agent.md
    │       └── readme-curator.agent.md
    │       └── recipe-curator.agent.md
    │       └── researcher.agent.md
    │       └── unit-test-auditor.agent.md
    │       └── web-gui-specialist.agent.md
    │       └── whatsnew-curator.agent.md
    │       └── workspace-architect.agent.md
└── scripts/
    ├── build-personas.js
    ├── build-skills.js
    ├── bundle-docs.js
    ├── check-known-roles.js
    ├── check-version-sync.js
    ├── cli.js
    ├── extract-changelog-entry.js
    ├── extract-dialogue.js
    ├── generate-agents-overview.js
    ├── import-standalone.js
    ├── install-hooks.js
    ├── install-mcp-global.js
    ├── kill-orchestrator.js
    ├── lib/
    │   ├── health-checks.js
    │   ├── persona-model-resolution.js
    │   ├── store-commands.js
    │   ├── yaml-utils.js
    ├── migrate-knowledge-uuids.js
    ├── normalize-ctx-paths.js
    ├── package-personas.js
    ├── preflight-bootstrap.js
    ├── preflight-orchestrator.js
    ├── preview-prompts.py
    ├── publish-locations.js
    ├── publish-skills.js
    ├── read-log.js
    ├── run-gui.js
    ├── run-orchestrator.js
    ├── sync-personas.js
    ├── templates/
    │   ├── agents-overview-header.md
    │   ├── notebooklm-bundle-header.md
    ├── tests/
    │   ├── README.md
    │   ├── build-personas-model-resolution.test.js
    │   ├── generate-agents-overview.test.js
    │   ├── health-checks.test.js
    │   ├── install-mcp.test.js
    │   ├── ledger-plugin.test.js
    │   ├── publish-skills.test.js
    │   ├── store-commands.test.js
    ├── validate-workflow-manifest.js
└── shared/
    ├── workflow-manifest.json
    ├── workflow-manifest.schema.json
└── skills/
    ├── README.md
    ├── meta/
    │   ├── _shared.yaml
    │   ├── insights-audit-persona.yaml
    ├── src/
    │   └── insights-audit-persona.md
└── vitest.config.ts

```