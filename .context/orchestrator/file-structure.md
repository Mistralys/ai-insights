# Orchestrator - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── orchestrator/
    └── README.md
    └── _test_config.py
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
        ├── 20260320T135939-2026-03-20-naming-convention-sweep.jsonl
        ├── 20260323T091956-2026-03-23-progress-reporting-followup.jsonl
        ├── 20260323T104010-2026-03-23-orchestrator-run-log-viewer.jsonl
        ├── 20260323T143701-2026-03-20-dialogue-capture.jsonl
        ├── 20260323T143922-2026-03-20-dialogue-capture.jsonl
        ├── 20260323T160604-2026-03-20-dialogue-capture.jsonl
        ├── 20260323T173850-2026-03-20-dialogue-capture-rework-1.jsonl
        ├── 20260323T174105-2026-03-20-dialogue-capture-rework-1.jsonl
        ├── 20260323T180014-2026-03-20-dialogue-capture-rework-1.jsonl
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
        │   └── dialogue_writer.py
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
        └── test_dialogue_writer.py
        └── test_filelock.py
        └── test_graph.py
        └── test_integration.py
        └── test_logging.py
        └── test_mcp_parse.py
        └── test_nodes.py
        └── test_plan_parser.py
        └── test_state.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```