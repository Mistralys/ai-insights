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
        │   │   └── api-surface.md
        ├── architecture.md
        ├── jsonl-log-schema.md
        ├── public-api.md
        ├── smoke-testing.md
        ├── supervisor-routing.md
    └── logs/
        ├── 20260302T154735-2026-03-02-perceval-category-graceful-fa.jsonl
        ├── 20260302T181937-2026-03-02-orchestrator-project-path-fix.jsonl
        ├── 20260302T182103-2026-03-02-orchestrator-project-path-fix.jsonl
        ├── 20260320T102813-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T115836-2026-03-20-synthesis-followups.jsonl
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
        │   └── mcp_parse.py
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
        └── test_logging.py
        └── test_nodes.py
        └── test_plan_parser.py
        └── test_state.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```