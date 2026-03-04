# Plan: LangGraph + Deep Agents Orchestrator for Ledger-Based Agent Workflow

## Summary

Build a **Python-based orchestrator** in a new `orchestrator/` sub-project that uses **LangGraph** for deterministic graph-based routing and **Deep Agents** (`deepagents`) for coding-agent execution within each pipeline stage. The orchestrator replaces the current non-deterministic, prompt-based auto-handoff mechanism with code-controlled state transitions while preserving the existing MCP server as the ledger/decision backend via `langchain-mcp-adapters`. The system runs headlessly from a CLI, accepting a plan document as input and driving the full PM → Developer → QA → Reviewer → Documentation → Synthesis pipeline without human intervention (with optional interrupt checkpoints).

## Architectural Context

### Existing System (Preserved As-Is)

| Component | Path | Role |
|-----------|------|------|
| **MCP Server** | `mcp-server/` | TypeScript STDIO-based server exposing 19 ledger tools (project lifecycle, WP CRUD, pipeline management, workflow coordination, observations). Enforces business rules: status transitions, pipeline prerequisites, acceptance criteria, atomic writes, file locking. |
| **Persona Prompts** | `personas/ledger/vs-code/*.md` | 7 Markdown files (1-planner through 7-synthesis) containing system prompts for each agent role. Used as-is — persona rewrites for Deep Agent tool-name compatibility are out of scope. |
| **Ledger Storage** | `mcp-server/storage/ledger/{slug}/` | Per-project JSON files: `project-ledger.json` (root index), `WP-###.json` (work package details), `.meta.json` (project metadata). |
| **Pipeline Routing Maps** | `mcp-server/src/utils/pipeline-maps.ts` | Canonical routing constants: `PIPELINE_PREREQUISITES`, `PIPELINE_AGENT_MAP`, `NEXT_AGENT_MAP`, `AGENT_PIPELINE_MAP`. |
| **Agent Roles** | `mcp-server/src/utils/constants.ts` | `AGENT_ROLES`: `['Planner', 'Project Manager', 'Developer', 'QA', 'Reviewer', 'Documentation', 'Synthesis']`. |

### Key Integration Points

| Entity | Source of Truth | Consumed By Orchestrator |
|--------|----------------|--------------------------|
| Ledger state (WP statuses, pipelines) | MCP server via STDIO | Via `langchain-mcp-adapters` MCP client |
| Pipeline prerequisites | `PIPELINE_PREREQUISITES` in `pipeline-maps.ts` | Mirrored as Python constants in orchestrator config |
| Agent-to-pipeline mapping | `PIPELINE_AGENT_MAP` / `NEXT_AGENT_MAP` | Mirrored as Python constants in orchestrator config |
| Persona system prompts | `personas/ledger/vs-code/*.md` | Read from disk at node invocation time |
| Project path | Plan document location | Passed as CLI argument; threaded through graph state |

### Current Handoff Problem

The existing auto-handoff mechanism (`ledger_get_handoff_status` → `auto_handoff` payload → IDE agent calls `runSubagent`) is fundamentally non-deterministic: the LLM decides whether to honour the handoff instruction, and frequently does not. The orchestrator eliminates this by making all routing decisions in Python code via LangGraph conditional edges — the LLM inside each Deep Agent node does its work but never decides which stage runs next.

## Approach / Architecture

### High-Level Design: Hub-and-Spoke Supervisor Graph

```
                    ┌──────────────┐
                    │    START     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
              ┌─────│  supervisor  │◄────────────────────────────┐
              │     └──────┬───────┘                             │
              │            │ (reads ledger, determines           │
              │            │  next stage + WP)                   │
              │            │                                     │
         ┌────▼───┐  ┌────▼────┐  ┌───▼──┐  ┌────▼─────┐  ┌───▼──┐  ┌─────▼─────┐
         │   pm   │  │developer│  │  qa  │  │ reviewer │  │ docs │  │ synthesis │
         └────┬───┘  └────┬────┘  └───┬──┘  └────┬─────┘  └───┬──┘  └─────┬─────┘
              │           │           │           │            │            │
              └───────────┴───────────┴───────────┴────────────┘            │
                          │ (all return to supervisor)                      │
                          └────────────────────────────────────────────────►│
                                                                      ┌────▼───┐
                                                                      │  END   │
                                                                      └────────┘
```

**Supervisor node** (pure Python, no LLM): reads ledger state via MCP tools, inspects WP statuses and pipeline states, and returns a deterministic routing decision (`Command(goto="developer")` or `Command(goto="synthesis")` etc.). This mirrors the logic in `workflow-handoff.ts` and `workflow-next-action.ts` but in code, not prompts.

**Stage nodes** (LLM-powered via Deep Agents): each creates a `deepagents` agent with `LocalShellBackend` for filesystem/shell access, the stage-specific persona prompt, and MCP tools for ledger operations. The agent performs its work (implements code, runs tests, writes docs, etc.) and returns.

### Graph State Schema

```python
class WorkflowState(TypedDict):
    # Immutable across the run
    project_path: str          # Absolute path to the plan folder
    plan_file: str             # Path to the plan .md document
    target_project_path: str   # Absolute path to the target project root

    # Mutable — updated by supervisor after each stage
    current_stage: str         # "pm" | "developer" | "qa" | "reviewer" | "docs" | "synthesis"
    current_wp_id: str         # Active WP being processed (e.g., "WP-001"), empty if PM stage
    iteration: int             # Global loop counter (safety limit)
    max_iterations: int        # Configurable ceiling (default: 100)

    # Stage output
    stage_result: str          # Summary text from the last Deep Agent invocation
    stage_success: bool        # Whether the stage completed without error

    # Ledger snapshot (populated by supervisor after reading MCP state)
    project_status: str        # "READY" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED"
    wp_summaries: list         # Serialized WP summary array from root index
    pending_wp_count: int      # Number of WPs not yet COMPLETE

    # Observability
    run_log: list              # Append-only log of (timestamp, stage, wp_id, action, result)
    errors: list               # Append-only error log
```

### Routing Logic (Supervisor)

The supervisor implements the same decision tree as the existing MCP workflow tools, but in deterministic Python:

1. **Read ledger state** via `ledger_get_project_status` and `ledger_list_work_packages`.
2. **If project is COMPLETE** → route to `synthesis` (if not yet run) or `END`.
3. **If no WPs exist** → route to `pm` (PM creates work packages from the plan).
4. **For each WP, evaluate pipeline state:**
   - Needs implementation (no PASS implementation pipeline) → route to `developer` with that WP.
   - Has PASS implementation, needs QA → route to `qa`.
   - Has PASS QA, needs code-review → route to `reviewer`.
   - Has PASS code-review, needs documentation → route to `docs`.
   - Has PASS documentation → mark WP COMPLETE, continue.
5. **FAIL pipelines** → rework: route back to the owning stage (e.g., QA FAIL → `developer`).
6. **BLOCKED WPs** → skip, process unblocked WPs first.
7. **All WPs COMPLETE** → route to `synthesis`.
8. **Safety: iteration >= max_iterations** → route to `END` with error.

### MCP Integration via langchain-mcp-adapters

```python
from langchain_mcp_adapters import MCPToolkit

# Start the MCP server as a subprocess via STDIO
mcp_toolkit = MCPToolkit(
    transport="stdio",
    command="node",
    args=["mcp-server/dist/index.js"],
)
mcp_tools = mcp_toolkit.get_tools()  # Returns LangChain Tool objects for all 19 MCP tools
```

Each Deep Agent node receives the MCP tools alongside its built-in filesystem tools. The MCP server enforces all business rules — the orchestrator delegates rule enforcement entirely to the MCP server.

### Deep Agent Node Pattern

```python
from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend

def developer_node(state: WorkflowState) -> dict:
    persona_prompt = Path("personas/ledger/vs-code/3-developer.md").read_text()
    agent = create_deep_agent(
        model=config.model_name,  # e.g. "claude-sonnet-4-6-20250929" or "gemini-2.5-pro"
        backend=LocalShellBackend(root_dir=state["target_project_path"]),
        system_prompt=persona_prompt,
        tools=mcp_tools,  # MCP ledger tools injected
    )
    wp_id = state["current_wp_id"]
    result = agent.invoke({
        "messages": [{"role": "user", "content": (
            f"You are working on project at: {state['project_path']}\n"
            f"Implement work package {wp_id}. "
            f"Use the ledger MCP tools to claim the WP, start the implementation pipeline, "
            f"do the implementation work, and complete the pipeline.\n"
            f"When done, call ledger_complete_pipeline with your results."
        )}]
    })
    return {
        "stage_result": result["messages"][-1].content,
        "stage_success": True,
    }
```

## Rationale

### Why LangGraph + Deep Agents (over alternatives)

| Factor | Decision Rationale |
|--------|--------------------|
| **Deterministic routing** | LangGraph conditional edges are pure functions — no LLM decides handoffs. This directly solves the core auto-handoff reliability problem. |
| **Coding agent capability** | Deep Agents provides `read_file`, `write_file`, `edit_file`, `execute`, `grep`, `glob` — functionally equivalent to IDE agent tools. Eliminates the need for a fragile IDE bridge. |
| **MCP tool reuse** | `langchain-mcp-adapters` connects Deep Agents to the existing MCP server. No MCP server code changes required. All 19 ledger tools are available. |
| **Self-contained system** | Everything runs in one LangGraph process. No WebSocket coordination, no subprocess management of IDE agents, no CLI headless mode dependency. |
| **Built-in durability** | LangGraph checkpointer (SQLite) provides persistence, replay, and time-travel for free. If the process crashes, it can resume from the last checkpoint. |
| **Context management** | Deep Agents auto-summarizes long conversations and offloads large outputs — replacing IDE context management. |
| **Python ecosystem maturity** | Deep Agents and LangGraph are Python-first. The Python SDKs are more mature, better documented, and have stronger community support than their JS equivalents. |

### What's Lost (Accepted Trade-offs)

- **No inline IDE diffs** — changes happen on disk, reviewable via `git diff` after the run.
- **No semantic/symbol-level code search** — `grep`/`glob` only (still very capable for this use case).
- **No interactive user chat** — headless execution; the ledger and synthesis report provide visibility.
- **Direct API costs** — tokens go to the Anthropic API directly, not through IDE model routing.
- **Persona prompt mismatch** — existing personas reference IDE-specific tools (`run_in_terminal`, `read_file`). Deep Agents has equivalent tools with slightly different names. LLMs handle this gracefully (they ignore unavailable tools), but a future persona rewrite project would clean this up.

## Detailed Steps

### Phase 1: Project Scaffolding (Steps 1–4)

**1. Create `orchestrator/` sub-project directory structure**
```
orchestrator/
├── pyproject.toml           # Python project metadata, dependencies
├── requirements.txt         # Pinned dependency versions (generated from pyproject.toml)
├── README.md                # Setup guide, prerequisites, usage
├── .env.example             # Template for environment variables
├── .gitignore               # Python-specific ignores (__pycache__, .venv, etc.)
│
├── src/
│   ├── __init__.py
│   ├── cli.py               # CLI entry point: parse args, load config, launch graph
│   ├── config.py            # Configuration: env vars, model settings, paths, constants
│   ├── state.py             # WorkflowState TypedDict definition
│   ├── graph.py             # LangGraph StateGraph construction and compilation
│   ├── supervisor.py        # Supervisor node: reads ledger, returns routing decision
│   ├── mcp_client.py        # MCP toolkit setup (langchain-mcp-adapters STDIO connection)
│   │
│   ├── nodes/               # One module per pipeline stage
│   │   ├── __init__.py
│   │   ├── pm.py            # Project Manager node
│   │   ├── developer.py     # Developer node
│   │   ├── qa.py            # QA node
│   │   ├── reviewer.py      # Reviewer node
│   │   ├── docs.py          # Documentation node
│   │   └── synthesis.py     # Synthesis node
│   │
│   └── utils/
│       ├── __init__.py
│       ├── logging.py       # Structured logging setup (file + stderr)
│       ├── persona.py       # Persona prompt loader (reads .md files from personas/)
│       └── plan_parser.py   # Plan document parser (extracts metadata for PM stage)
│
├── tests/
│   ├── __init__.py
│   ├── test_supervisor.py   # Unit tests for routing logic
│   ├── test_state.py        # State schema validation tests
│   ├── test_graph.py        # Graph construction / edge tests
│   └── test_plan_parser.py  # Plan parsing tests
│
└── checkpoints/             # SQLite checkpoint files (gitignored)
```

**2. Define `pyproject.toml` with dependencies**

```toml
[project]
name = "ai-insights-orchestrator"
version = "0.1.0"
description = "LangGraph + Deep Agents orchestrator for ledger-based agent workflow"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.4",
    "deepagents>=0.3",
    "langchain-mcp-adapters>=0.2",
    "langchain-core>=0.3",
    "python-dotenv>=1.0",
]

[project.optional-dependencies.anthropic]
langchain-anthropic = ">=0.3"

[project.optional-dependencies.google]
langchain-google-genai = ">=2.0"

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "ruff>=0.8",
]

[project.scripts]
orchestrate = "src.cli:main"
```

**3. Create `.env.example` with required environment variables**

```env
# === LLM Provider (choose ONE) ===
# Option A: Anthropic (pip install -e ".[anthropic]")
ANTHROPIC_API_KEY=sk-ant-...
MODEL_NAME=claude-sonnet-4-6-20250929

# Option B: Google AI Studio (pip install -e ".[google]")
# GOOGLE_API_KEY=AIza...
# MODEL_NAME=gemini-2.5-pro

# === General settings ===
MAX_ITERATIONS=100
CHECKPOINT_DIR=./checkpoints
LOG_LEVEL=INFO
```

**4. Create `.gitignore` for Python artifacts**

```
__pycache__/
*.pyc
.venv/
.env
checkpoints/
*.sqlite
```

### Phase 2: Core Infrastructure (Steps 5–9)

**5. Implement `src/config.py` — Configuration module**

- Load environment variables via `python-dotenv`.
- Define constants mirroring the MCP server's routing maps:
  ```python
  PIPELINE_PREREQUISITES = {
      "implementation": None,
      "qa": "implementation",
      "code-review": "qa",
      "documentation": "code-review",
  }
  PIPELINE_AGENT_MAP = {
      "implementation": "Developer",
      "qa": "QA",
      "code-review": "Reviewer",
      "documentation": "Documentation",
  }
  NEXT_STAGE_MAP = {
      "pm": "developer",
      "developer": "qa",
      "qa": "reviewer",
      "reviewer": "docs",
      "docs": "synthesis",
  }
  STAGE_TO_PIPELINE = {
      "developer": "implementation",
      "qa": "qa",
      "reviewer": "code-review",
      "docs": "documentation",
  }
  PERSONA_FILES = {
      "pm": "personas/ledger/vs-code/2-project-manager.md",
      "developer": "personas/ledger/vs-code/3-developer.md",
      "qa": "personas/ledger/vs-code/4-qa.md",
      "reviewer": "personas/ledger/vs-code/5-reviewer.md",
      "docs": "personas/ledger/vs-code/6-documentation.md",
      "synthesis": "personas/ledger/vs-code/7-synthesis.md",
  }
  ```
- Define a `Config` dataclass with validated fields: `model_name`, `max_iterations`, `checkpoint_dir`, `mcp_server_cmd`, `workspace_root`, `log_level`.
- Auto-detect the LLM provider from the configured `MODEL_NAME` and available API key environment variables:
  - `ANTHROPIC_API_KEY` set → use `langchain-anthropic` (`ChatAnthropic`).
  - `GOOGLE_API_KEY` set → use `langchain-google-genai` (`ChatGoogleGenerativeAI`).
  - Both set → use whichever matches the `MODEL_NAME` prefix (`claude-*` → Anthropic, `gemini-*` → Google).
  - Neither set → raise a clear error at startup.
- Use LangChain's `init_chat_model(model_name)` for provider-agnostic model initialization when possible.

**6. Implement `src/state.py` — Graph state definition**

- Define `WorkflowState` as a `TypedDict` with all fields from the Architecture section.
- Define Annotated reducers for append-only fields (`run_log`, `errors`) using LangGraph's `add` reducer.

**7. Implement `src/mcp_client.py` — MCP toolkit setup**

- Initialize `MCPToolkit` with STDIO transport pointing to the built MCP server (`node mcp-server/dist/index.js`).
- Expose `get_mcp_tools()` function that returns the LangChain `Tool` objects.
- Handle MCP server startup/shutdown lifecycle (start on graph entry, stop on graph completion).
- Add health check: invoke `ledger_help` tool to verify connectivity.

**8. Implement `src/utils/persona.py` — Persona prompt loader**

- `load_persona(stage: str) -> str`: reads the persona Markdown file for a given stage.
- Resolves paths relative to the workspace root (configured in `Config`).
- Caches loaded prompts in memory (they don't change during a run).

**9. Implement `src/utils/plan_parser.py` — Plan document parser**

- `parse_plan(plan_file: str) -> PlanMetadata`: extracts the plan document's title, summary, and any structured metadata.
- The PM agent receives the plan content as part of its prompt — this parser provides structured metadata for the graph state, not for the LLM.

### Phase 3: Supervisor & Routing Logic (Steps 10–12)

**10. Implement `src/supervisor.py` — The routing brain**

This is the most critical module. It replaces the prompt-based handoff with deterministic code:

```python
def supervisor_node(state: WorkflowState) -> Command:
    """
    Pure-function routing node. No LLM calls.
    Reads ledger state via MCP tools, inspects WP statuses and pipelines,
    returns a Command(goto=<next_node>, update=<state_delta>).
    """
```

**Routing algorithm:**
1. Call `ledger_get_project_status(project_path)` via MCP toolkit.
2. Call `ledger_list_work_packages(project_path)` to get all WP summaries.
3. **If no WPs exist** → `Command(goto="pm")`.
4. **If project status is COMPLETE** → `Command(goto="synthesis")` if synthesis not yet run, else `Command(goto=END)`.
5. **For each WP (priority: IN_PROGRESS first, then READY, skip BLOCKED/COMPLETE):**
   a. Call `ledger_get_work_package(project_path, wp_id)` to get pipeline details.
   b. **Determine the WP's current pipeline state:**
      - No pipelines → needs `implementation` → route to `developer`.
      - Latest implementation pipeline is FAIL → rework → route to `developer`.
      - Latest implementation pipeline is PASS, no QA → route to `qa`.
      - Latest QA pipeline is FAIL → route to `developer` (rework).
      - Latest QA pipeline is PASS, no code-review → route to `reviewer`.
      - Latest code-review pipeline is FAIL → route to `developer` (rework).
      - Latest code-review pipeline is PASS, no documentation → route to `docs`.
      - Latest documentation pipeline is FAIL → route to relevant stage.
      - Latest documentation pipeline is PASS → mark WP COMPLETE.
   c. **Return** `Command(goto=<stage>, update={"current_wp_id": wp_id, "current_stage": stage})`.
6. **All non-blocked WPs are COMPLETE** → `Command(goto="synthesis")`.
7. **All WPs are BLOCKED** → `Command(goto=END, update={"errors": ["All WPs blocked"]})`.
8. **Safety valve**: if `state["iteration"] >= state["max_iterations"]` → `Command(goto=END)`.

**Key design choice:** The supervisor calls MCP tools directly (via the shared `MCPToolkit` instance) rather than relying on the graph state's cached snapshot. This ensures routing decisions are always based on the latest ledger state, even if a previous stage's Deep Agent made ledger changes that aren't reflected in the graph state.

**11. Define conditional edges for rework loops**

The supervisor's `Command(goto=...)` return value handles all routing, including rework. No separate conditional edge functions are needed — the supervisor IS the router. This simplifies the graph to a simple hub-and-spoke topology.

**12. Add iteration counter and safety limits**

- Supervisor increments `state["iteration"]` on each invocation.
- If `iteration >= max_iterations`, supervisor routes to END and logs a safety-limit error.
- Default `max_iterations = 100` (configurable via env var).

### Phase 4: Stage Nodes (Steps 13–18)

Each stage node follows the same pattern:

1. Load persona prompt.
2. Create Deep Agent with `LocalShellBackend(root_dir=target_project_path)` + MCP tools.
3. Construct a stage-specific user prompt that includes: project path, WP ID, and explicit instructions to use MCP tools for ledger operations.
4. Invoke the agent.
5. Return `stage_result` and `stage_success` in the state update.
6. Error handling: catch exceptions, set `stage_success = False`, append to `errors`.

**13. Implement `src/nodes/pm.py` — Project Manager node**

- Receives the plan document content as input.
- Instructs the PM agent to: read the plan, create work packages via `ledger_create_work_package`, set up dependencies.
- Expected outcome: WPs exist in the ledger after this node completes.

**14. Implement `src/nodes/developer.py` — Developer node**

- Receives `current_wp_id` from state.
- Instructs the developer agent to: claim the WP (`ledger_claim_work_package`), start implementation pipeline (`ledger_start_pipeline`), implement the code changes, complete the pipeline (`ledger_complete_pipeline`).
- `LocalShellBackend` gives full filesystem + shell access for code editing, test running, etc.

**15. Implement `src/nodes/qa.py` — QA node**

- Instructs the QA agent to: start QA pipeline, run tests, validate acceptance criteria, complete the pipeline with PASS/FAIL.
- On FAIL, the supervisor will route back to developer for rework.

**16. Implement `src/nodes/reviewer.py` — Reviewer node**

- Instructs the reviewer agent to: start code-review pipeline, review code quality and architecture, complete the pipeline.
- On FAIL, supervisor routes back to developer.

**17. Implement `src/nodes/docs.py` — Documentation node**

- Instructs the documentation agent to: start documentation pipeline, update project docs, README, API docs, complete the pipeline.
- Also responsible for marking the WP as COMPLETE via `ledger_update_work_package_status` when the documentation pipeline passes.

**18. Implement `src/nodes/synthesis.py` — Synthesis node**

- Runs once after all WPs are COMPLETE.
- Instructs the synthesis agent to: compile a project report from all WP data, summarize outcomes, produce the final synthesis document.
- This is the terminal stage — after synthesis, the graph ends.

### Phase 5: Graph Assembly & CLI (Steps 19–22)

**19. Implement `src/graph.py` — Graph construction**

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver

def build_graph(config: Config, mcp_tools: list) -> CompiledGraph:
    graph = StateGraph(WorkflowState)

    # Add nodes
    graph.add_node("supervisor", supervisor_node)
    graph.add_node("pm", pm_node)
    graph.add_node("developer", developer_node)
    graph.add_node("qa", qa_node)
    graph.add_node("reviewer", reviewer_node)
    graph.add_node("docs", docs_node)
    graph.add_node("synthesis", synthesis_node)

    # Entry: always start at supervisor
    graph.add_edge(START, "supervisor")

    # All stage nodes return to supervisor after completion
    graph.add_edge("pm", "supervisor")
    graph.add_edge("developer", "supervisor")
    graph.add_edge("qa", "supervisor")
    graph.add_edge("reviewer", "supervisor")
    graph.add_edge("docs", "supervisor")

    # Synthesis is the terminal node
    graph.add_edge("synthesis", END)

    # Supervisor uses Command(goto=...) for routing — no conditional edges needed

    # Compile with checkpointer
    checkpointer = SqliteSaver.from_conn_string(f"sqlite:///{config.checkpoint_dir}/workflow.sqlite")
    return graph.compile(checkpointer=checkpointer)
```

**20. Implement `src/cli.py` — CLI entry point**

```
Usage: python -m src.cli <plan-document-path> [options]

Arguments:
  plan-document-path    Path to the plan .md file (e.g., docs/agents/plans/2026-02-24-feature/plan.md)

Options:
  --project-path PATH   Override the target project path (default: inferred from plan path)
  --max-iterations N    Maximum supervisor iterations (default: 100)
  --model MODEL         Model identifier (default: from .env; e.g. claude-sonnet-4-6-20250929 or gemini-2.5-pro)
  --resume THREAD_ID    Resume a previously checkpointed run
  --dry-run             Print the routing plan without executing agents
  --log-level LEVEL     Logging verbosity (default: INFO)
```

The CLI:
1. Parses arguments.
2. Loads `.env` configuration.
3. Validates the plan document exists.
4. Starts the MCP server subprocess.
5. Initializes the graph with checkpointer.
6. Invokes the graph with initial state.
7. Prints a summary of the run (stages executed, WPs completed, errors).
8. Shuts down the MCP server subprocess.

**21. Implement `src/utils/logging.py` — Structured logging**

- File-based log: writes to `orchestrator/logs/{timestamp}-{slug}.jsonl` in structured JSON format.
- Console log: writes human-readable progress to stderr.
- Each log entry: `{timestamp, stage, wp_id, action, result, tokens_used}`.

**22. Add human-in-the-loop interrupt support (optional)**

- LangGraph's `interrupt()` mechanism allows pausing the graph at specific checkpoints.
- Add optional interrupt points:
  - After PM creates work packages (review WPs before implementation starts).
  - After each pipeline FAIL (review the failure before rework).
  - Before synthesis (review all completed WPs before final report).
- Controlled via CLI flag: `--interrupt-on pm,fail,synthesis` (comma-separated).
- Resume via `--resume <thread_id>` with the same graph.

### Phase 6: Testing & Validation (Steps 23–26)

**23. Write unit tests for supervisor routing logic**

- Test all routing paths: no WPs → PM, WP needs implementation → developer, QA FAIL → developer, all complete → synthesis, iteration limit → END.
- Mock MCP tool responses to isolate routing logic from the ledger backend.

**24. Write integration test with a minimal plan**

- Create a test plan with 1 WP.
- Run the full graph end-to-end against the real MCP server (using a temp ledger directory).
- Verify: PM creates WP → developer implements → QA validates → reviewer reviews → docs writes → synthesis reports → END.

**25. Write integration test for rework loops**

- Simulate a QA FAIL scenario.
- Verify: developer → QA (FAIL) → developer (rework) → QA (PASS) → reviewer → ... → END.
- Ensure iteration counter increments correctly and doesn't hit the safety limit.

**26. Write integration test for multi-WP dependency handling**

- Create a plan with 3 WPs where WP-002 depends on WP-001.
- Verify: WP-001 is processed first, WP-003 (independent) can be processed in parallel or after, WP-002 starts only after WP-001 is COMPLETE.

### Phase 7: Documentation & Integration (Steps 27–29)

**27. Write `orchestrator/README.md`**

- Prerequisites: Python 3.11+, Node.js (for MCP server), LLM API key (Anthropic or Google AI Studio).
- Installation: `pip install -e .` or `pip install -r requirements.txt`.
- Usage examples with the CLI.
- Architecture overview with the hub-and-spoke diagram.
- Troubleshooting: common issues (MCP server not built, API key missing, checkpoint corruption).

**28. Update root `AGENTS.md` with orchestrator sub-project**

- Add orchestrator to the workspace architecture table.
- Add orchestrator manifest references (once manifests are created).
- Add cross-project dependency entries for the orchestrator → MCP server and orchestrator → personas relationships.

**29. Update root `README.md` with orchestrator section**

- Brief description of the orchestrator and how it relates to the existing IDE-based workflow.
- Both workflows remain functional — the orchestrator is an alternative execution mode.

## Dependencies

- **Python 3.11+** — required for `TypedDict` with `Annotated` reducers and modern type hints.
- **`langgraph` (>=0.4)** — StateGraph, Command, checkpointing, SQLite saver.
- **`deepagents` (>=0.3)** — `create_deep_agent`, `LocalShellBackend`, built-in filesystem/shell tools.
- **`langchain-anthropic` (>=0.3)** — Anthropic model wrapper for LangChain. *Optional dependency, installed via `pip install -e ".[anthropic]"`.*
- **`langchain-google-genai` (>=2.0)** — Google AI Studio (Gemini) model wrapper for LangChain. *Optional dependency, installed via `pip install -e ".[google]"`.*
- **`langchain-mcp-adapters` (>=0.2)** — STDIO-based MCP client that exposes MCP tools as LangChain tools.
- **`langchain-core` (>=0.3)** — Base abstractions (Tool, messages, etc.).
- **`python-dotenv` (>=1.0)** — Environment variable loading.
- **Existing MCP server** (must be built: `cd mcp-server && npm install && npm run build`).
- **Existing persona files** (read from `personas/ledger/vs-code/`).
- **LLM API key** — either `ANTHROPIC_API_KEY` (for Claude models) or `GOOGLE_API_KEY` (for Gemini models) set as an environment variable. At least one is required.

## Required Components

### New Files (to create)

| File | Purpose |
|------|---------|
| `orchestrator/pyproject.toml` | Python project configuration and dependencies |
| `orchestrator/requirements.txt` | Pinned dependency versions |
| `orchestrator/README.md` | Setup and usage documentation |
| `orchestrator/.env.example` | Environment variable template |
| `orchestrator/.gitignore` | Python-specific gitignore |
| `orchestrator/src/__init__.py` | Package init |
| `orchestrator/src/cli.py` | CLI entry point |
| `orchestrator/src/config.py` | Configuration module |
| `orchestrator/src/state.py` | Graph state definition |
| `orchestrator/src/graph.py` | Graph construction and compilation |
| `orchestrator/src/supervisor.py` | Supervisor routing node |
| `orchestrator/src/mcp_client.py` | MCP toolkit setup |
| `orchestrator/src/nodes/__init__.py` | Nodes package init |
| `orchestrator/src/nodes/pm.py` | Project Manager Deep Agent node |
| `orchestrator/src/nodes/developer.py` | Developer Deep Agent node |
| `orchestrator/src/nodes/qa.py` | QA Deep Agent node |
| `orchestrator/src/nodes/reviewer.py` | Reviewer Deep Agent node |
| `orchestrator/src/nodes/docs.py` | Documentation Deep Agent node |
| `orchestrator/src/nodes/synthesis.py` | Synthesis Deep Agent node |
| `orchestrator/src/utils/__init__.py` | Utils package init |
| `orchestrator/src/utils/logging.py` | Structured logging |
| `orchestrator/src/utils/persona.py` | Persona prompt loader |
| `orchestrator/src/utils/plan_parser.py` | Plan document parser |
| `orchestrator/tests/__init__.py` | Tests package init |
| `orchestrator/tests/test_supervisor.py` | Supervisor routing tests |
| `orchestrator/tests/test_state.py` | State schema tests |
| `orchestrator/tests/test_graph.py` | Graph construction tests |
| `orchestrator/tests/test_plan_parser.py` | Plan parser tests |

### Existing Files (to modify)

| File | Change |
|------|--------|
| `AGENTS.md` | Add orchestrator sub-project to workspace architecture table |
| `README.md` | Add orchestrator section describing the alternative execution mode |

### Existing Files (read-only, consumed by orchestrator)

| File | Used For |
|------|----------|
| `mcp-server/dist/index.js` | MCP server binary (started as subprocess) |
| `personas/ledger/vs-code/2-project-manager.md` | PM persona prompt |
| `personas/ledger/vs-code/3-developer.md` | Developer persona prompt |
| `personas/ledger/vs-code/4-qa.md` | QA persona prompt |
| `personas/ledger/vs-code/5-reviewer.md` | Reviewer persona prompt |
| `personas/ledger/vs-code/6-documentation.md` | Documentation persona prompt |
| `personas/ledger/vs-code/7-synthesis.md` | Synthesis persona prompt |

## Assumptions

1. **Deep Agents Python SDK is stable** — the `create_deep_agent()` API with `LocalShellBackend` and custom tools works as documented. The framework has 9.6k GitHub stars and is actively maintained by LangChain.
2. **`langchain-mcp-adapters` supports STDIO transport** — the adapter can spawn and communicate with the MCP server over STDIO. If STDIO is problematic, a fallback is HTTP transport via the existing GUI server.
3. **Persona prompts work with Deep Agents** — existing persona prompts reference IDE-specific tool names. The LLM will adapt to the available tools (Deep Agents' `edit_file`, `execute`, etc.) and ignore unavailable ones. This is an accepted trade-off.
4. **LLM API key is available** — the user has a valid Anthropic (`ANTHROPIC_API_KEY`) or Google AI Studio (`GOOGLE_API_KEY`) API key with sufficient quota for multi-stage pipeline runs (estimated 50k–200k tokens per full pipeline run).
5. **MCP server is built** — the user runs `cd mcp-server && npm install && npm run build` before using the orchestrator. The orchestrator does not build the MCP server.
6. **Single-threaded WP processing** — MVP processes one WP at a time. Parallel WP processing is a future enhancement.
7. **Windows compatibility** — the orchestrator runs on Windows. `LocalShellBackend` uses `subprocess` which works cross-platform. Path handling uses `pathlib.Path` for platform-agnostic paths.

## Constraints

1. **No MCP server modifications** — the orchestrator is a pure consumer of the existing MCP API. Zero changes to `mcp-server/`.
2. **No persona file modifications** — persona rewrites to adapt tool names are a separate future project.
3. **Python project only** — the orchestrator is a standalone Python project. No TypeScript dependencies in the orchestrator.
4. **Headless execution** — no GUI, no IDE integration. Results are visible via the ledger (JSON files), structured logs, and the synthesis report.
5. **CLI-first** — the entry point is a CLI command. GUI integration is a future enhancement.
6. **Planner stage excluded** — users create plans manually. The orchestrator starts at the PM stage.
7. **No git operations** — the orchestrator does not commit, branch, or push. The user manages git.
8. **Sequential WP processing (MVP)** — WPs are processed one at a time. LangGraph's `Send` API for parallel node execution is a future enhancement.

## Out of Scope

- **Persona rewrites** for Deep Agent tool-name compatibility (future project).
- **GUI dashboard** for monitoring orchestrator runs (future enhancement — could extend existing GUI).
- **Parallel WP processing** using LangGraph's `Send` primitive (future enhancement after MVP validation).
- **Additional LLM providers** — MVP supports Anthropic Claude and Google Gemini. OpenAI/Ollama support is straightforward via LangChain's model abstraction but not included in the initial scope.
- **Sandbox backends** (Modal, Daytona, etc.) — MVP uses `LocalShellBackend` for direct filesystem access. Sandboxing is a production hardening concern.
- **VS Code extension** for orchestrator control — the existing IDE-based workflow remains the interactive option.
- **CI/CD integration** — running the orchestrator in GitHub Actions or similar.
- **Cost estimation/budgeting** — token usage logging is included, but budget limits are not enforced.

## Acceptance Criteria

1. **`python -m src.cli <plan.md>` successfully completes a full pipeline** (PM → Developer → QA → Reviewer → Documentation → Synthesis) on a simple 1-WP plan, producing:
   - Work packages in the ledger.
   - Code changes in the target project.
   - Completed pipelines (implementation, qa, code-review, documentation) with PASS status.
   - A synthesis report.
2. **Rework loops function correctly**: when QA returns FAIL, the supervisor routes back to developer, and the pipeline restarts without manual intervention.
3. **Multi-WP dependency handling**: WPs with unmet dependencies are skipped; WPs with met dependencies are processed; the supervisor correctly sequences work.
4. **Safety limit works**: if the iteration counter exceeds `max_iterations`, the graph terminates cleanly with a descriptive error.
5. **Checkpoint/resume works**: a crashed run can be resumed from the last checkpoint using `--resume <thread_id>`.
6. **MCP server starts and stops cleanly**: the orchestrator manages the MCP server subprocess lifecycle (start on entry, stop on exit/crash).
7. **Structured logs are produced**: each stage invocation is logged with timestamp, stage, WP ID, action, and result in a JSONL file.
8. **Supervisor routing tests pass**: all routing paths are covered by unit tests with mocked MCP responses.
9. **No MCP server code changes**: the orchestrator works with the existing MCP server without modifications.

## Testing Strategy

### Unit Tests (pytest)

| Test File | Scope |
|-----------|-------|
| `test_supervisor.py` | All routing paths: empty project → PM, WP needs implementation → developer, QA FAIL → developer, all complete → synthesis, safety limit → END, blocked WPs → skip. Mock MCP tool responses. |
| `test_state.py` | State schema validation, reducer behavior for append-only fields. |
| `test_graph.py` | Graph construction (correct nodes, edges, START/END connectivity). No LLM calls. |
| `test_plan_parser.py` | Plan document parsing for various formats. |

### Integration Tests (pytest + real MCP server)

| Test | Scope |
|------|-------|
| Happy path (1 WP) | Full pipeline: PM → Developer → QA → Reviewer → Docs → Synthesis. Uses a temp ledger directory. Validates all ledger state transitions. |
| Rework loop | Developer → QA (FAIL) → Developer (rework) → QA (PASS) → continuation. Validates iteration count and rework_count. |
| Multi-WP dependencies | 3 WPs with WP-002 depending on WP-001. Validates processing order and dependency gating. |
| Safety limit | Set `max_iterations=3`, run a plan that would require more. Verify clean termination. |
| Resume from checkpoint | Start a run, kill it mid-pipeline, resume with `--resume`. Verify it continues from the interrupted stage. |

### Testing Approach

- Unit tests mock the MCP toolkit and Deep Agent invocations to test routing logic in isolation.
- Integration tests use a real MCP server with a temp ledger directory (similar to the existing `createTempStore()` pattern in `mcp-server/tests/helpers/`).
- Deep Agent behavior is tested indirectly via integration tests — the focus is on orchestrator routing, not LLM output quality.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`langchain-mcp-adapters` STDIO reliability** — the adapter may have issues with the custom MCP server's STDIO protocol, especially around multi-message exchanges or large responses. | Fallback: wrap the MCP server's HTTP GUI API as a custom LangChain tool instead. The GUI already exposes project and WP endpoints. Could also use SSE transport. Start with STDIO; switch if issues arise. |
| **Deep Agents `LocalShellBackend` on Windows** — shell execution on Windows may have path or encoding issues that don't appear on Linux/macOS. | Test early on Windows. Use `pathlib.Path` throughout. Set `shell=True` in subprocess calls if needed. Deep Agents is cross-platform but Windows is less tested. |
| **Token cost explosion** — each Deep Agent invocation creates a fresh LLM context with the full persona prompt + MCP tool schemas. A 7-WP pipeline could consume 500k+ tokens. | Use Deep Agents' auto-summarization for long conversations. Set model context window limits. Log token usage per stage. Consider using a cheaper model for simple stages (QA, docs). Add a `--token-budget` flag in a future iteration. |
| **Persona prompt mismatch** — existing personas reference `run_in_terminal`, `read_file`, `replace_string_in_file`, etc. Deep Agents has `execute`, `read_file` (same name!), `edit_file`. The LLM may be confused by instructions for tools that don't exist. | LLMs gracefully handle tool name mismatches — they use available tools. Monitor for repeated failed tool calls in logs. A future persona rewrite project will clean this up. |
| **Graph state vs. ledger state divergence** — the graph state caches a snapshot of ledger state, but Deep Agents modify the ledger directly via MCP tools. If the supervisor uses stale state, routing could be wrong. | Supervisor always reads fresh ledger state from MCP (not from graph state cache). Graph state cache is for observability only. |
| **MCP server subprocess lifecycle** — if the orchestrator crashes, the MCP server subprocess may be orphaned. | Use `atexit` handler and signal handlers (SIGINT, SIGTERM) to ensure subprocess cleanup. Wrap in a context manager. |
| **Deep Agents framework stability** — the framework is relatively new (first stable release ~2025). API may change. | Pin dependency versions in `requirements.txt`. The core concept (LangGraph node spawning a coding agent) is framework-agnostic — the pattern could be reimplemented with raw LangChain tools if Deep Agents breaks. |
| **Checkpoint corruption** — SQLite checkpoint file could become corrupted on Windows if the process is killed during a write. | Use WAL mode for SQLite. Add a `--reset` flag to delete checkpoints and start fresh. Checkpoints are a convenience, not a hard requirement. |
