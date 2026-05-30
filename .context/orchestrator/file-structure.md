# Orchestrator - File Structure
<INSTRUCTION>
# Orchestrator - File Structure
Directory tree of the orchestrator module. Runtime artifacts (pycache, venv, logs, checkpoints) are excluded.

</INSTRUCTION>
------------------------------------------------------------
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
        │   │   └── constraints.md
        │   │   └── data-flows.md
        │   │   └── file-tree.md
        │   │   └── tech-stack.md
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
        │   └── _revision.py
        │   └── chunk_writer.py
        │   └── dialogue_writer.py
        │   └── filelock.py
        │   └── logging.py
        │   └── mcp_parse.py
        │   └── persona.py
        │   └── persona_models.py
        │   └── plan_parser.py
        │   └── run_queue.py
        │   └── subagents.py
        │   └── subprocess_encoding.py
        │   └── tool_wrappers.py
    └── tests/
        └── __init__.py
        └── conftest.py
        └── test_chunk_writer.py
        └── test_cli.py
        └── test_config.py
        └── test_dialogue_writer.py
        └── test_error_helpers.py
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
        └── test_revision.py
        └── test_run_queue.py
        └── test_slug_dir.py
        └── test_state.py
        └── test_stream_retry.py
        └── test_streaming_capture.py
        └── test_subagents.py
        └── test_subprocess_encoding.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```