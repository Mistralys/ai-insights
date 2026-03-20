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
    └── checkpoints/
        ├── test/
        │   ├── workflow.sqlite
        ├── workflow.sqlite
    └── docs/
        ├── architecture.md
        ├── jsonl-log-schema.md
        ├── public-api.md
        ├── smoke-testing.md
        ├── supervisor-routing.md
    └── logs/
        ├── 20260225T113355-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T113428-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T113453-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T113615-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T113646-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T113659-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T114154-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T114221-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T123200-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260225T124109-2026-02-25-orchestrator-smoke-test.jsonl
        ├── 20260320T120730-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T120840-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T121750-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T121830-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T121831-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T122350-2026-03-20-synthesis-followups.jsonl
        ├── 20260320T133046-2026-03-20-naming-convention-sweep.jsonl
    └── module-context.yaml
    └── pyproject.toml
    └── requirements.txt
    └── src/
        ├── __init__.py
        ├── __pycache__/
        │   ├── __init__.cpython-314.pyc
        │   ├── cli.cpython-314.pyc
        │   ├── config.cpython-314.pyc
        │   ├── graph.cpython-314.pyc
        │   ├── mcp_client.cpython-314.pyc
        │   ├── state.cpython-314.pyc
        │   ├── supervisor.cpython-314.pyc
        ├── cli.py
        ├── config.py
        ├── graph.py
        ├── mcp_client.py
        ├── nodes/
        │   ├── __init__.py
        │   ├── __pycache__/
        │   │   ├── __init__.cpython-314.pyc
        │   │   ├── developer.cpython-314.pyc
        │   │   ├── docs.cpython-314.pyc
        │   │   ├── pm.cpython-314.pyc
        │   │   ├── qa.cpython-314.pyc
        │   │   ├── release_engineer.cpython-314.pyc
        │   │   ├── reviewer.cpython-314.pyc
        │   │   ├── security_auditor.cpython-314.pyc
        │   │   ├── synthesis.cpython-314.pyc
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
        │       ├── __init__.cpython-314.pyc
        │       ├── logging.cpython-314.pyc
        │       ├── persona.cpython-314.pyc
        │       ├── plan_parser.cpython-314.pyc
        │       ├── tool_wrappers.cpython-314.pyc
        │   └── logging.py
        │   └── persona.py
        │   └── plan_parser.py
        │   └── tool_wrappers.py
    └── tests/
        └── __init__.py
        └── __pycache__/
            ├── __init__.cpython-314.pyc
            ├── test_cli.cpython-314-pytest-9.0.2.pyc
            ├── test_config.cpython-314-pytest-9.0.2.pyc
            ├── test_graph.cpython-314-pytest-9.0.2.pyc
            ├── test_integration.cpython-314-pytest-9.0.2.pyc
            ├── test_nodes.cpython-314-pytest-9.0.2.pyc
            ├── test_plan_parser.cpython-314-pytest-9.0.2.pyc
            ├── test_state.cpython-314-pytest-9.0.2.pyc
            ├── test_supervisor.cpython-314-pytest-9.0.2.pyc
            ├── test_tool_wrappers.cpython-314-pytest-9.0.2.pyc
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