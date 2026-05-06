# Orchestrator — File Tree

> **Parent:** [project-manifest/README.md](README.md)

Annotated listing of all source files in the orchestrator package.

```
orchestrator/
├── pyproject.toml              # Package metadata, extras, scripts; langgraph>=1.1,<2.0 pin
├── README.md                   # Full user-facing documentation
├── requirements.txt            # Pinned dependencies
├── changelog.md                # Version history
├── module-context.yaml         # CTX Generator config
│
├── docs/
│   ├── agents/
│   │   └── project-manifest/
│   │       ├── README.md           # Manifest hub
│   │       ├── api-surface.md      # JSONL event types, enriched fields, ChunkWriter, utility refs
│   │       ├── constraints.md      # Numbered constraint catalogue
│   │       ├── data-flows.md       # Dialogue capture and chunk writing data flows
│   │       ├── file-tree.md        # ← You are here
│   │       └── tech-stack.md       # Runtime, dependencies, architectural patterns
│   ├── architecture.md             # Stage nodes, state management, log types
│   ├── supervisor-routing.md       # Routing algorithm, exits, circuit-breaker
│   ├── public-api.md               # Public functions and entry points
│   ├── jsonl-log-schema.md         # Run log field reference
│   └── smoke-testing.md            # Dispatch loop verification
│
├── src/
│   ├── __init__.py
│   ├── cli.py                  # CLI entry point (orchestrate command)
│   ├── config.py               # .env loading, provider detection, constants
│   ├── graph.py                # StateGraph assembly and compilation
│   ├── state.py                # WorkflowState TypedDict with reducers
│   ├── supervisor.py           # Deterministic router (no LLM)
│   ├── mcp_client.py           # MCP server subprocess lifecycle
│   │
│   ├── nodes/                  # Stage node factories (8 stages)
│   │   ├── __init__.py         # Node factory — stage_start / stage_complete / stage_error / pipeline_result events
│   │   ├── pm.py               # Project Manager stage node
│   │   ├── developer.py        # Developer stage node
│   │   ├── qa.py               # QA stage node
│   │   ├── security_auditor.py # Security Auditor stage node
│   │   ├── reviewer.py         # Reviewer stage node
│   │   ├── release_engineer.py # Release Engineer stage node
│   │   ├── docs.py             # Documentation stage node
│   │   ├── synthesis.py        # Synthesis stage node
│   │   ├── prompt_renderer.py  # load_template / render_prompt / load_partial / clear_template_cache
│   │   └── templates/          # Per-stage Markdown prompt templates + partials/
│   │
│   └── utils/                  # Shared utilities
│       ├── __init__.py
│       ├── _revision.py        # next_revision() — shared revision-numbering helper for chunk and dialogue files
│       ├── chunk_writer.py     # ChunkWriter — writes LangGraph stream chunks to JSONL files (orchestrator/chunks/)
│       ├── dialogue_writer.py  # write_dialogue / serialize_messages_to_markdown
│       ├── filelock.py         # Cross-platform file locking (msvcrt / fcntl)
│       ├── logging.py          # WorkflowLogger — JSONL + console logger with heartbeat
│       ├── mcp_parse.py        # parse_tool_response helper
│       ├── persona.py          # load_persona — reads persona Markdown files
│       ├── persona_models.py   # Persona model configuration types
│       ├── plan_parser.py      # Plan document parser
│       ├── run_queue.py        # register() / unregister() — CLI self-registration in .run-queue.json
│       ├── subagents.py        # Deep Agent / subagent creation helpers
│       ├── subprocess_encoding.py  # Cross-platform subprocess encoding fix
│       └── tool_wrappers.py    # log_tool_calls() — tool_call JSONL event wrapper
│
└── tests/                      # pytest test suite (988 collected)
    ├── conftest.py                  # Shared config stubs: _StreamCaptureConfig, _CaptureConfig, _NoCaptureConfig
    ├── test_chunk_writer.py         # ChunkWriter JSONL write contract
    ├── test_cli.py                  # Argument parsing, interrupt mapping, exit codes, TestRunQueueIntegration (run-queue CLI integration)
    ├── test_config.py               # Manifest-derived config constants
    ├── test_dialogue_writer.py      # write_dialogue / serialize_messages_to_markdown
    ├── test_error_helpers.py        # Error helper utilities
    ├── test_filelock.py             # Cross-platform file locking (acquire, contention, double-unlock)
    ├── test_graph.py                # Graph topology, edges, compilation
    ├── test_integration.py          # End-to-end graph execution (ScriptedLedger)
    ├── test_logging.py              # WorkflowLogger: format helpers, all 8 event-type console format patterns
    ├── test_mcp_parse.py            # parse_tool_response helper
    ├── test_nodes.py                # Stage-node factories, tool wrapping, duration_s, pipeline_result
    ├── test_persona_models.py       # Persona model configuration types
    ├── test_plan_parser.py          # Plan document parsing
    ├── test_post_completion_guard.py # Post-completion guard logic
    ├── test_prompt_renderer.py      # load_template / render_prompt / load_partial
    ├── test_revision.py             # next_revision() revision-numbering helper
    ├── test_run_queue.py            # run_queue register/unregister, QUEUE_FILE, file-lock, atomic write
    ├── test_state.py                # WorkflowState schema and reducer semantics
    ├── test_stream_retry.py         # Stream retry / exponential backoff
    ├── test_streaming_capture.py    # Streaming dialogue capture
    ├── test_subagents.py            # load_subagents / clear_cache
    ├── test_subprocess_encoding.py  # Cross-platform subprocess encoding fix
    ├── test_supervisor.py           # Supervisor routing paths, circuit-breaker, enriched events
    ├── test_tool_wrappers.py        # inject_project_path, restrict_to_wp, log_tool_calls
    └── checkpoints/                 # SQLite checkpoint storage (runtime-generated)
```
