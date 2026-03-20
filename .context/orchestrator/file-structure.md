# Orchestrator - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── orchestrator/
    └── README.md
    └── changelog.md
    └── docs/
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
        ├── __pycache__/
        │   ├── __init__.cpython-313.pyc
        │   ├── cli.cpython-313.pyc
        │   ├── config.cpython-313.pyc
        │   ├── graph.cpython-313.pyc
        │   ├── mcp_client.cpython-313.pyc
        │   ├── state.cpython-313.pyc
        │   ├── supervisor.cpython-313.pyc
        ├── cli.py
        ├── config.py
        ├── graph.py
        ├── mcp_client.py
        ├── nodes/
        │   ├── __init__.py
        │   ├── __pycache__/
        │   │   ├── __init__.cpython-313.pyc
        │   │   ├── developer.cpython-313.pyc
        │   │   ├── docs.cpython-313.pyc
        │   │   ├── pm.cpython-313.pyc
        │   │   ├── qa.cpython-313.pyc
        │   │   ├── release_engineer.cpython-313.pyc
        │   │   ├── reviewer.cpython-313.pyc
        │   │   ├── security_auditor.cpython-313.pyc
        │   │   ├── synthesis.cpython-313.pyc
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
        │   └── __pycache__/
        │       ├── __init__.cpython-313.pyc
        │       ├── plan_parser.cpython-313.pyc
        │       ├── tool_wrappers.cpython-313.pyc
        │   └── logging.py
        │   └── persona.py
        │   └── plan_parser.py
        │   └── tool_wrappers.py
    └── tests/
        └── __init__.py
        └── __pycache__/
            ├── __init__.cpython-313.pyc
            ├── test_cli.cpython-313-pytest-9.0.2.pyc
            ├── test_graph.cpython-313-pytest-9.0.2.pyc
            ├── test_integration.cpython-313-pytest-9.0.2.pyc
            ├── test_nodes.cpython-313-pytest-9.0.2.pyc
            ├── test_plan_parser.cpython-313-pytest-9.0.2.pyc
            ├── test_state.cpython-313-pytest-9.0.2.pyc
            ├── test_supervisor.cpython-313-pytest-9.0.2.pyc
            ├── test_tool_wrappers.cpython-313-pytest-9.0.2.pyc
        └── test_cli.py
        └── test_config.py
        └── test_graph.py
        └── test_integration.py
        └── test_nodes.py
        └── test_plan_parser.py
        └── test_state.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```
---
**File Statistics**
- **Size**: 3.4 KB
- **Lines**: 92
File: `orchestrator/file-structure.md`
