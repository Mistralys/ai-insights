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
        │   └── project-manifest/
        │       ├── README.md
        │       ├── api-surface.md
        │       ├── constraints.md
        │       ├── data-flows.md
        │       ├── file-tree.md
        │       ├── tech-stack.md
        │   └── research/
        │       └── 2026-02-22-skill-extraction-mcp-docs.md
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
    └── node_modules/
        ├── argparse/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── argparse.js
        │   ├── lib/
        │   │   ├── sub.js
        │   │   ├── textwrap.js
        │   ├── package.json
        ├── js-yaml/
        │   └── LICENSE/
        │   └── README.md
        │   └── bin/
        │       ├── js-yaml.js
        │   └── dist/
        │       ├── js-yaml.js
        │       ├── js-yaml.min.js
        │       ├── js-yaml.mjs
        │   └── index.js
        │   └── lib/
        │       ├── common.js
        │       ├── dumper.js
        │       ├── exception.js
        │       ├── loader.js
        │       ├── schema.js
        │       ├── schema/
        │       │   ├── core.js
        │       │   ├── default.js
        │       │   ├── failsafe.js
        │       │   ├── json.js
        │       ├── snippet.js
        │       ├── type.js
        │       ├── type/
        │       │   └── binary.js
        │       │   └── bool.js
        │       │   └── float.js
        │       │   └── int.js
        │       │   └── map.js
        │       │   └── merge.js
        │       │   └── null.js
        │       │   └── omap.js
        │       │   └── pairs.js
        │       │   └── seq.js
        │       │   └── set.js
        │       │   └── str.js
        │       │   └── timestamp.js
        │   └── package.json
    └── package-lock.json
    └── package.json
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
            ├── dependency-sequencer.md
            ├── ledger-bootstrapper.md
            ├── manifest-curator.md
            ├── module-intent-architect.md
            ├── orchestrator-runner.md
            ├── pipeline-configurator.md
            ├── readme-curator.md
            ├── researcher.md
            ├── unit-test-auditor.md
            ├── whatsnew-curator.md
            ├── workflow-orchestrator.md
            ├── wp-decomposer.md
        └── src/
            ├── content/
            │   ├── agents-md-curator.md
            │   ├── changelog-curator.md
            │   ├── composer-curator.md
            │   ├── ctx-architect.md
            │   ├── dependency-sequencer.md
            │   ├── ledger-bootstrapper.md
            │   ├── manifest-curator.md
            │   ├── module-intent-architect.md
            │   ├── orchestrator-runner.md
            │   ├── pipeline-configurator.md
            │   ├── readme-curator.md
            │   ├── researcher.md
            │   ├── unit-test-auditor.md
            │   ├── whatsnew-curator.md
            │   ├── workflow-orchestrator.md
            │   ├── wp-decomposer.md
            ├── meta/
            │   └── _shared.yaml
            │   └── agents-md-curator.yaml
            │   └── changelog-curator.yaml
            │   └── composer-curator.yaml
            │   └── ctx-architect.yaml
            │   └── dependency-sequencer.yaml
            │   └── ledger-bootstrapper.yaml
            │   └── manifest-curator.yaml
            │   └── module-intent-architect.yaml
            │   └── orchestrator-runner.yaml
            │   └── pipeline-configurator.yaml
            │   └── readme-curator.yaml
            │   └── researcher.yaml
            │   └── unit-test-auditor.yaml
            │   └── whatsnew-curator.yaml
            │   └── workflow-orchestrator.yaml
            │   └── wp-decomposer.yaml
        └── vs-code/
            └── agents-md-curator.agent.md
            └── changelog-curator.agent.md
            └── composer-curator.agent.md
            └── ctx-architect.agent.md
            └── dependency-sequencer.agent.md
            └── ledger-bootstrapper.agent.md
            └── manifest-curator.agent.md
            └── module-intent-architect.agent.md
            └── orchestrator-runner.agent.md
            └── pipeline-configurator.agent.md
            └── readme-curator.agent.md
            └── researcher.agent.md
            └── unit-test-auditor.agent.md
            └── whatsnew-curator.agent.md
            └── workflow-orchestrator.agent.md
            └── wp-decomposer.agent.md

```