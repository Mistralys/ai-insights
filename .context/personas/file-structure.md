# Personas - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── personas/
    └── README.md
    └── changelog.md
    └── docs/
        ├── agents/
        │   ├── project-manifest/
        │   │   ├── README.md
        │   │   ├── api-surface.md
        │   │   ├── constraints-build-system.md
        │   │   ├── constraints-cross-system.md
        │   │   ├── constraints.md
        │   │   ├── data-flows.md
        │   │   ├── file-tree.md
        │   │   ├── tech-stack.md
        │   ├── research/
        │   │   └── 2026-02-22-skill-extraction-mcp-docs.md
        ├── persona-build-system.md
        ├── persona-design-guide.md
    └── ledger/
        ├── README.md
        ├── claude-code/
        │   ├── 1-planner.md
        │   ├── 2-project-manager.md
        │   ├── 3-developer.md
        │   ├── 4-qa.md
        │   ├── 5-security-auditor.md
        │   ├── 6-reviewer.md
        │   ├── 7-release-engineer.md
        │   ├── 8-documentation.md
        │   ├── 9-synthesis.md
        ├── deep-agents/
        │   ├── 1-planner.md
        │   ├── 2-project-manager.md
        │   ├── 3-developer.md
        │   ├── 4-qa.md
        │   ├── 5-security-auditor.md
        │   ├── 6-reviewer.md
        │   ├── 7-release-engineer.md
        │   ├── 8-documentation.md
        │   ├── 9-synthesis.md
        ├── src/
        │   ├── content/
        │   │   ├── 1-planner.md
        │   │   ├── 2-project-manager.md
        │   │   ├── 3-developer.md
        │   │   ├── 4-qa.md
        │   │   ├── 5-security-auditor.md
        │   │   ├── 6-reviewer.md
        │   │   ├── 7-release-engineer.md
        │   │   ├── 8-documentation.md
        │   │   ├── 9-synthesis.md
        │   ├── meta/
        │   │   ├── 1-planner.yaml
        │   │   ├── 2-project-manager.yaml
        │   │   ├── 3-developer.yaml
        │   │   ├── 4-qa.yaml
        │   │   ├── 5-security-auditor.yaml
        │   │   ├── 6-reviewer.yaml
        │   │   ├── 7-release-engineer.yaml
        │   │   ├── 8-documentation.yaml
        │   │   ├── 9-synthesis.yaml
        │   │   ├── _shared.yaml
        │   ├── partials/
        │   │   └── handoff-block-claude-code.md
        │   │   └── handoff-block-manual.md
        │   │   └── handoff-block-vscode.md
        │   │   └── incident-logging.md
        │   │   └── mcp-intro.md
        │   │   └── mcp-preflight-detect.md
        │   │   └── mcp-preflight-header-claude-code.md
        │   │   └── mcp-preflight-header-vscode.md
        │   │   └── mcp-preflight-verify-no-detect.md
        │   │   └── mcp-tools-note.md
        │   │   └── mcp-unavailable.md
        │   │   └── role-boundaries.md
        ├── vs-code/
        │   └── 1-planner.agent.md
        │   └── 2-pm.agent.md
        │   └── 3-dev.agent.md
        │   └── 4-qa.agent.md
        │   └── 5-security-auditor.agent.md
        │   └── 6-reviewer.agent.md
        │   └── 7-release-engineer.agent.md
        │   └── 8-docs.agent.md
        │   └── 9-synthesis.agent.md
    └── module-context.yaml
    └── name-mapping.json
    └── package-lock.json
    └── package.json
    └── persona-build.config.js
    └── plugins/
        ├── ledger/
        │   └── frontmatter-templates.js
        │   └── index.js
        │   └── mcp-tools-renderer.js
        │   └── role-validator.js
        │   └── roster-renderer.js
    └── shared/
        ├── partials/
        │   └── agent-roster.md
        │   └── developer-operational-protocol.md
        │   └── developer-output-format.md
        │   └── developer-strict-constraints.md
        │   └── docs-operational-protocol.md
        │   └── docs-output-format.md
        │   └── incident-logging.md
        │   └── planner-core-rules.md
        │   └── planner-output-template.md
        │   └── pm-output-format.md
        │   └── pm-subagent-roster.md
        │   └── qa-operational-protocol.md
        │   └── qa-output-format.md
        │   └── release-engineer-operational-protocol.md
        │   └── release-engineer-output-format.md
        │   └── reviewer-operational-protocol.md
        │   └── reviewer-output-format.md
        │   └── security-auditor-operational-protocol.md
        │   └── security-auditor-output-format.md
        │   └── synthesis-operational-protocol.md
        │   └── synthesis-output-format.md
    └── standalone/
        └── README.md
        └── claude-code/
            ├── agents-md-curator.md
            ├── changelog-curator.md
            ├── composer-curator.md
            ├── ctx-architect.md
            ├── developer-standalone.md
            ├── documentation-curator.md
            ├── git-committer.md
            ├── ledger-bootstrapper.md
            ├── ledger-claude-coordinator.md
            ├── ledger-dependency-sequencer.md
            ├── ledger-doctor.md
            ├── ledger-orchestrator-runner.md
            ├── ledger-pipeline-configurator.md
            ├── ledger-wp-decomposer.md
            ├── manifest-curator.md
            ├── module-intent-architect.md
            ├── persona-curator.md
            ├── plan-architect-reviewer.md
            ├── plan-auditor.md
            ├── readme-curator.md
            ├── researcher.md
            ├── unit-test-auditor.md
            ├── whatsnew-curator.md
        └── deep-agents/
            ├── agents-md-curator.md
            ├── changelog-curator.md
            ├── composer-curator.md
            ├── ctx-architect.md
            ├── developer.md
            ├── documentation-curator.md
            ├── git-committer.md
            ├── ledger-bootstrapper.md
            ├── ledger-claude-coordinator.md
            ├── ledger-dependency-sequencer.md
            ├── ledger-doctor.md
            ├── ledger-orchestrator-runner.md
            ├── ledger-pipeline-configurator.md
            ├── ledger-wp-decomposer.md
            ├── manifest-curator.md
            ├── module-intent-architect.md
            ├── persona-curator.md
            ├── plan-architect-reviewer.md
            ├── plan-auditor.md
            ├── readme-curator.md
            ├── researcher.md
            ├── unit-test-auditor.md
            ├── whatsnew-curator.md
        └── src/
            ├── content/
            │   ├── agents-md-curator.md
            │   ├── changelog-curator.md
            │   ├── composer-curator.md
            │   ├── ctx-architect.md
            │   ├── developer.md
            │   ├── documentation-curator.md
            │   ├── git-committer.md
            │   ├── ledger-bootstrapper.md
            │   ├── ledger-claude-coordinator.md
            │   ├── ledger-dependency-sequencer.md
            │   ├── ledger-doctor.md
            │   ├── ledger-orchestrator-runner.md
            │   ├── ledger-pipeline-configurator.md
            │   ├── ledger-wp-decomposer.md
            │   ├── manifest-curator.md
            │   ├── module-intent-architect.md
            │   ├── persona-curator.md
            │   ├── plan-architect-reviewer.md
            │   ├── plan-auditor.md
            │   ├── readme-curator.md
            │   ├── researcher.md
            │   ├── unit-test-auditor.md
            │   ├── whatsnew-curator.md
            ├── meta/
            │   └── _shared.yaml
            │   └── agents-md-curator.yaml
            │   └── changelog-curator.yaml
            │   └── composer-curator.yaml
            │   └── ctx-architect.yaml
            │   └── developer.yaml
            │   └── documentation-curator.yaml
            │   └── git-committer.yaml
            │   └── ledger-bootstrapper.yaml
            │   └── ledger-claude-coordinator.yaml
            │   └── ledger-dependency-sequencer.yaml
            │   └── ledger-doctor.yaml
            │   └── ledger-orchestrator-runner.yaml
            │   └── ledger-pipeline-configurator.yaml
            │   └── ledger-wp-decomposer.yaml
            │   └── manifest-curator.yaml
            │   └── module-intent-architect.yaml
            │   └── persona-curator.yaml
            │   └── plan-architect-reviewer.yaml
            │   └── plan-auditor.yaml
            │   └── readme-curator.yaml
            │   └── researcher.yaml
            │   └── unit-test-auditor.yaml
            │   └── whatsnew-curator.yaml
        └── vs-code/
            └── agents-md-curator.agent.md
            └── changelog-curator.agent.md
            └── composer-curator.agent.md
            └── ctx-architect.agent.md
            └── developer-standalone.agent.md
            └── documentation-curator.agent.md
            └── git-committer.agent.md
            └── ledger-bootstrapper.agent.md
            └── ledger-claude-coordinator.agent.md
            └── ledger-dependency-sequencer.agent.md
            └── ledger-doctor.agent.md
            └── ledger-orchestrator-runner.agent.md
            └── ledger-pipeline-configurator.agent.md
            └── ledger-wp-decomposer.agent.md
            └── manifest-curator.agent.md
            └── module-intent-architect.agent.md
            └── persona-curator.agent.md
            └── plan-architect-reviewer.agent.md
            └── plan-auditor.agent.md
            └── readme-curator.agent.md
            └── researcher.agent.md
            └── unit-test-auditor.agent.md
            └── whatsnew-curator.agent.md

```