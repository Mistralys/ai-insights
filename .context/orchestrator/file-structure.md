# Orchestrator - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── orchestrator/
    └── README.md
    └── ai_insights_orchestrator.egg-info/
        ├── PKG-INFO/
        ├── SOURCES.txt
        ├── dependency_links.txt
        ├── entry_points.txt
        ├── requires.txt
        ├── top_level.txt
    └── changelog.md
    └── dist/
        ├── stage-prompts/
        │   └── developer.md
        │   └── docs.md
        │   └── pm.md
        │   └── qa.md
        │   └── release_engineer.md
        │   └── reviewer.md
        │   └── security_auditor.md
        │   └── synthesis.md
    └── docs/
        ├── agents/
        │   ├── project-manifest/
        │   │   └── README.md
        │   │   └── api-surface.md
        │   │   └── constraints.md
        ├── architecture.md
        ├── jsonl-log-schema.md
        ├── public-api.md
        ├── smoke-testing.md
        ├── supervisor-routing.md
    └── module-context.yaml
    └── pyproject.toml
    └── requirements.txt
    └── src/
        ├── __init__.py
        ├── cli.py
        ├── config.py
        ├── graph.py
        ├── mcp_client.py
        ├── nodes/
        │   ├── __init__.py
        │   ├── developer.py
        │   ├── docs.py
        │   ├── pm.py
        │   ├── prompt_renderer.py
        │   ├── qa.py
        │   ├── release_engineer.py
        │   ├── reviewer.py
        │   ├── security_auditor.py
        │   ├── synthesis.py
        │   ├── templates/
        │   │   └── VARIABLES.md
        │   │   └── developer.md
        │   │   └── docs.md
        │   │   └── partials/
        │   │       ├── project-path-reminder.md
        │   │   └── pm.md
        │   │   └── qa.md
        │   │   └── release_engineer.md
        │   │   └── reviewer.md
        │   │   └── security_auditor.md
        │   │   └── synthesis.md
        ├── state.py
        ├── supervisor.py
        ├── utils/
        │   └── __init__.py
        │   └── dialogue_writer.py
        │   └── filelock.py
        │   └── logging.py
        │   └── mcp_parse.py
        │   └── persona.py
        │   └── persona_models.py
        │   └── plan_parser.py
        │   └── subprocess_encoding.py
        │   └── tool_wrappers.py
    └── tests/
        └── __init__.py
        └── test_cli.py
        └── test_config.py
        └── test_dialogue_writer.py
        └── test_filelock.py
        └── test_graph.py
        └── test_integration.py
        └── test_logging.py
        └── test_mcp_parse.py
        └── test_nodes.py
        └── test_persona_models.py
        └── test_plan_parser.py
        └── test_post_completion_guard.py
        └── test_prompt_renderer.py
        └── test_state.py
        └── test_subprocess_encoding.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```
---
**File Statistics**
- **Size**: 3.39 KB
- **Lines**: 102
File: `orchestrator/file-structure.md`
