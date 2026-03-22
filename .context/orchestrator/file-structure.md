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
    └── docs/
        ├── agents/
        │   ├── project-manifest/
        │   │   └── README.md
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
        │   ├── qa.py
        │   ├── release_engineer.py
        │   ├── reviewer.py
        │   ├── security_auditor.py
        │   ├── synthesis.py
        ├── state.py
        ├── supervisor.py
        ├── utils/
        │   └── __init__.py
        │   └── filelock.py
        │   └── logging.py
        │   └── persona.py
        │   └── plan_parser.py
        │   └── tool_wrappers.py
    └── tests/
        └── __init__.py
        └── test_cli.py
        └── test_config.py
        └── test_filelock.py
        └── test_graph.py
        └── test_integration.py
        └── test_nodes.py
        └── test_plan_parser.py
        └── test_state.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```