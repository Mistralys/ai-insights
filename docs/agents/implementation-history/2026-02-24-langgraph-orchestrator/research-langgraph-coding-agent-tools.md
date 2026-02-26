# Research Report

## Problem Statement

The [prior research report](2026-02-24-langgraph-workflow-orchestration.md) identified that LangGraph agents running inside graph nodes lose access to IDE-native tools (file editing, terminal commands, semantic search, etc.). This raised the question: **How do LangGraph-based coding agents actually interact with and modify codebases?** Surely LangGraph must have equivalent capabilities — what are they, how mature are they, and how do they compare to what IDE-native agents provide?

## Problem Decomposition

1. **What tool primitives does LangGraph provide for coding agents?** — File read/write/edit, shell execution, grep, glob, etc.
2. **What is the "Deep Agents" framework?** — LangChain's batteries-included agent harness built on LangGraph.
3. **What backend options exist for filesystem access?** — Local disk, sandboxed, in-state, composite routing.
4. **How does shell/command execution work?** — Sandboxes vs. local shell access.
5. **How does this compare to IDE-native agent capabilities?** — What's gained, what's lost.
6. **What does this mean for the hybrid approach recommended in the prior report?**

## Context & Constraints

- The prior research recommended **Approach C (Hybrid LangGraph + IDE Agents)** as the primary approach, with LangGraph handling orchestration and IDE agents handling execution.
- The key concern was: "LangGraph agents cannot edit files, run terminal commands, or use VS Code Copilot tools."
- This follow-up investigates whether that concern was overstated — LangGraph *does* have coding agent capabilities.

## Prior Art & Known Patterns

### Pattern 1: LangChain Custom `@tool` Functions

- **Description:** LangGraph/LangChain allows any Python (or JS) function to be registered as a tool via the `@tool` decorator. The LLM decides when to invoke tools, and a `ToolNode` in the graph executes them. This means *any* operation — including `os.path`, `subprocess`, file I/O — can be wrapped as a tool.
- **Where used:** Every LangGraph agent. This is the foundational mechanism.
- **Strengths:** Unlimited flexibility. You can write a tool that does literally anything the host language can do.
- **Weaknesses:** You must build each tool yourself (read, write, edit, grep, run shell, etc.). No IDE-level intelligence (syntax-aware editing, language server integration, semantic search).
- **Fit:** Building block, not a solution by itself.

### Pattern 2: Deep Agents — LangChain's Batteries-Included Agent Harness

- **Description:** LangChain's **Deep Agents** framework (`deepagents` package, ~9.6k GitHub stars) is a production-ready agent harness built on LangGraph. It ships with a comprehensive set of built-in capabilities specifically designed for coding agents. It was explicitly inspired by Claude Code and aims to be its open-source, provider-agnostic equivalent.
- **Where used:** LangChain ecosystem. Available as `pip install deepagents` (Python SDK) and `deepagents-cli` (interactive terminal agent). A JS/TS version exists at `deepagents.js`.
- **Built-in tools:**

  | Tool | Description |
  |------|-------------|
  | `ls` | List files in a directory with metadata (size, modified time) |
  | `read_file` | Read file contents with line numbers, offset/limit for large files, native image support |
  | `write_file` | Create new files (create-only semantics by default) |
  | `edit_file` | Exact string replacements in existing files (with global replace mode) |
  | `glob` | Find files matching patterns (e.g., `**/*.py`) |
  | `grep` | Search file contents with multiple output modes (files only, content with context, counts) |
  | `execute` | Run shell commands (sandbox or local shell backends) |
  | `write_todos` | Planning/task tracking tool |
  | `task` | Spawn subagents for delegated work with isolated context |

- **Strengths:**
  - Mirrors the exact tool surface that IDE agents like Claude Code and VS Code Copilot provide.
  - Context management: auto-summarization when conversations grow long, large output offloading to files.
  - Subagent delegation with isolated context windows.
  - Built on LangGraph — gets persistence, streaming, checkpointing, and deployment capabilities for free.
  - Provider-agnostic: works with Anthropic, OpenAI, Google, Ollama, or any LangChain-compatible model.
  - CLI mode (`deepagents-cli`) provides an interactive terminal experience similar to Claude Code.
  - Supports AGENTS.md memory files and Skills (progressive tool disclosure).
  - 100% open source (MIT).
- **Weaknesses:**
  - Python-first. The JS/TS version (`deepagents.js`) exists but is newer.
  - No IDE integration (syntax highlighting, inline diffs, language server, semantic search over symbols).
  - File editing is string-based (`old_string` → `new_string`), not AST-aware.
  - No native git integration beyond what shell commands provide.
- **Fit:** **Extremely relevant.** This is LangGraph's answer to "how do coding agents modify codebases."

### Pattern 3: Backend System — Pluggable Filesystem Access

- **Description:** Deep Agents uses a pluggable **backend** architecture that determines *where* and *how* filesystem operations execute. All filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) operate through the configured backend.
- **Available backends:**

  | Backend | Description | Shell Access | Isolation |
  |---------|-------------|-------------|-----------|
  | **StateBackend** (default) | Ephemeral in-memory filesystem stored in LangGraph state. Files persist within a thread via checkpoints. | ❌ | Full |
  | **FilesystemBackend** | Direct read/write to local disk under a configurable `root_dir`. Supports `virtual_mode=True` for path sandboxing. | ❌ | None (host filesystem) |
  | **LocalShellBackend** | Extends FilesystemBackend with the `execute` tool for running arbitrary shell commands on the host. | ✅ (unrestricted) | None (host system) |
  | **StoreBackend** | Files in a LangGraph BaseStore (Redis, Postgres, etc.) for cross-thread durable storage. | ❌ | Full |
  | **CompositeBackend** | Routes file paths to different backends by prefix. E.g., `/memories/` → StoreBackend, everything else → StateBackend. | Depends on route | Mixed |
  | **Sandbox backends** (Modal, Daytona, Runloop, Deno) | Isolated container/VM environments with full filesystem + `execute` tool. | ✅ (sandboxed) | Full |
  | **Custom backends** | Implement `BackendProtocol` to project any storage (S3, Postgres, etc.) into the tools namespace. | Optional | Custom |

- **Strengths:** The backend system cleanly separates "what the agent can do" from "where it happens." For local development, `LocalShellBackend` gives the agent full access to the codebase and terminal — exactly what an IDE agent has.
- **Weaknesses:** `LocalShellBackend` runs with full host permissions and no safety net. File access through `virtual_mode` can be bypassed via shell commands. Security is a real concern.
- **Fit:** The `FilesystemBackend` + `LocalShellBackend` combination provides equivalent capabilities to IDE agents for local codebase modification.

### Pattern 4: Sandbox Backends — Isolated Code Execution

- **Description:** For production and safety-critical scenarios, Deep Agents supports sandbox backends from multiple providers (Modal, Daytona, Runloop, Deno). These create isolated container/VM environments where the agent can execute code without risking the host system.
- **Two integration patterns:**
  1. **Sandbox as tool** (recommended): Agent runs on your machine; sandbox handles code execution remotely.
  2. **Agent in sandbox**: The entire agent runs inside the sandbox.
- **File transfer:** Sandboxes support `upload_files()` and `download_files()` APIs for moving files between host and sandbox.
- **Strengths:** Security isolation, reproducible environments, pay-per-use, clean separation of agent state and execution.
- **Weaknesses:** Network latency on each operation, provider costs, added complexity.
- **Fit:** Relevant for production deployment but not necessary for local development workflows like the ai-insights use case.

## Alternative & Creative Approaches

### Approach A: Deep Agents with LocalShellBackend as Drop-In Replacement for IDE Agents

- **Description:** Instead of the Hybrid approach (LangGraph orchestrator + IDE agent execution), use Deep Agents' `LocalShellBackend` as the execution environment for each graph node. Each node in the LangGraph StateGraph creates a deep agent with `LocalShellBackend(root_dir="/path/to/project")` and the relevant persona's system prompt. The agent gets full filesystem access + shell execution — functionally equivalent to what the IDE agent had.
- **Rationale:** Eliminates the need for the fragile LangGraph ↔ IDE bridge described in the prior report's Approach C. The entire workflow runs within a single LangGraph graph — no subprocess management, no WebSocket coordination, no CLI headless mode dependency.
- **Risk:** Loses IDE-specific capabilities (inline diffs, language server, semantic search over symbols, user chat interface). Token costs go to direct API calls rather than through the IDE's model routing.

### Approach B: Deep Agents + MCP Adapter for Existing MCP Tools

- **Description:** Deep Agents supports MCP tool integration via `langchain-mcp-adapters`. This means a LangGraph agent can connect to the existing ai-insights MCP server as a tool provider, getting access to all 19 ledger tools alongside the built-in filesystem tools.
- **Rationale:** The existing MCP server becomes a tool *within* the LangGraph agent, rather than the orchestration layer. The MCP server handles ledger state management, the Deep Agent handles file editing and terminal commands, and LangGraph handles deterministic routing.
- **Risk:** Two layers of tool indirection. Potential for confusion between Deep Agent filesystem tools and any file operations the MCP tools might do.

### Approach C: LangGraph Orchestrator + Deep Agent Subagents (not IDE Agents)

- **Description:** Revise the prior report's Approach C: instead of dispatching to IDE agents via a bridge, dispatch to Deep Agent instances. Each pipeline stage node in the LangGraph graph spawns a `create_deep_agent()` with `LocalShellBackend`, the stage-specific persona prompt, and the MCP tools (via `langchain-mcp-adapters`). The subagent does its work (edits files, runs tests, writes documentation), completes, and returns its result to the graph state.
- **Rationale:** This is a self-contained, pure-Python/LangGraph solution. No IDE bridge needed. The `task` tool in Deep Agents already supports exactly this subagent delegation pattern with isolated context windows.
- **Risk:** No user-facing IDE experience during execution. The workflow runs headlessly. Results can be reviewed after completion, but there's no interactive chat during each stage.

## Comparative Evaluation

| Criterion | IDE-Native Agents (Status Quo) | Deep Agents LocalShell (Approach A) | Hybrid LangGraph+IDE (Prior Report C) | LangGraph + Deep Agent Subagents (Approach C) |
|---|---|---|---|---|
| **Deterministic routing** | ❌ Prompt-based | ✅ LangGraph graph | ✅ LangGraph graph | ✅ LangGraph graph |
| **File read/write/edit** | ✅ IDE-native | ✅ `write_file`/`edit_file` | ✅ IDE-native | ✅ `write_file`/`edit_file` |
| **Shell/terminal access** | ✅ IDE terminal | ✅ `execute` tool | ✅ IDE terminal | ✅ `execute` tool |
| **Search (grep/glob)** | ✅ IDE + semantic | ✅ `grep`/`glob` (text-only) | ✅ IDE + semantic | ✅ `grep`/`glob` (text-only) |
| **Semantic code search** | ✅ Language server | ❌ Not available | ✅ Language server | ❌ Not available |
| **Inline diffs / syntax** | ✅ IDE-native | ❌ Not available | ✅ IDE-native | ❌ Not available |
| **User chat interface** | ✅ IDE chat | ❌ Headless (or CLI) | ✅ IDE chat | ❌ Headless (or CLI) |
| **Context management** | ✅ IDE-managed | ✅ Auto-summarization + offloading | ✅ IDE-managed | ✅ Auto-summarization + offloading |
| **Subagent delegation** | ✅ `runSubagent` | ✅ `task` tool | ✅ IDE `runSubagent` | ✅ `task` tool |
| **Persistence/checkpointing** | ❌ None | ✅ LangGraph checkpointer | ✅ LangGraph checkpointer | ✅ LangGraph checkpointer |
| **MCP tool integration** | ✅ Native | ✅ via `langchain-mcp-adapters` | ✅ Native | ✅ via `langchain-mcp-adapters` |
| **Existing ledger reuse** | ✅ Current system | ✅ via MCP adapter | ✅ Full reuse | ✅ via MCP adapter |
| **Bridge complexity** | N/A | None | ⚠️ High (WebSocket/CLI) | None |
| **Time to implement** | N/A (current) | 2–3 weeks | 4–6 weeks | 2–4 weeks |
| **Token cost model** | IDE-routed | Direct API calls | IDE-routed | Direct API calls |

## Recommendation

### Revised Primary Recommendation: Approach C — LangGraph Orchestrator + Deep Agent Subagents

The discovery of the Deep Agents framework significantly changes the trade-off analysis from the prior report. The prior report's primary concern was: *"How do LangGraph nodes edit files and run commands without IDE tools?"* The answer is: **Deep Agents provides a complete coding agent toolkit (`read_file`, `write_file`, `edit_file`, `execute`, `grep`, `glob`, `task`) that closely mirrors what IDE agents offer.**

This means the **Hybrid LangGraph + IDE bridge** (prior Approach C) is no longer the recommended path. The bridge was a workaround for a problem that Deep Agents solves natively. The revised recommendation:

1. **LangGraph StateGraph** handles deterministic orchestration (same as prior report).
2. **Each graph node spawns a Deep Agent** (via `create_deep_agent()`) with:
   - `LocalShellBackend(root_dir="/path/to/project")` for filesystem + shell access
   - The stage-specific persona system prompt
   - MCP tools via `langchain-mcp-adapters` for ledger operations
3. **The existing MCP server stays intact** as a tool provider, not an orchestrator.
4. **Human-in-the-loop** via LangGraph's `interrupt()` at key graph nodes.

**What you gain over the prior Hybrid approach:**
- No fragile IDE ↔ LangGraph bridge to build and maintain
- Self-contained system: everything runs in one LangGraph process
- Built-in context management (summarization, offloading) replaces IDE context management
- Subagent isolation comes free via Deep Agents' `task` tool
- Checkpointing, replay, and time-travel built into LangGraph

**What you lose vs. IDE-native agents:**
- No inline diffs in the editor (changes happen on disk, reviewable via git)
- No semantic/symbol-level code search (grep/glob only — still very capable)
- No interactive user chat during execution (headless, results reviewed after)
- Direct API costs instead of IDE-routed model access

### Fallback Recommendation: Enhanced MCP Server (Prior Approach D)

If the project doesn't want to adopt the LangGraph + Deep Agents stack (Python dependency, learning curve, API key costs), the Enhanced MCP Server approach from the prior report remains valid. The key missing piece — programmatic agent invocation from code — is the same regardless.

### Proof-of-Concept Outline

1. **Install Deep Agents:** `pip install deepagents langchain-anthropic langchain-mcp-adapters`
2. **Create a minimal LangGraph graph** with 3 nodes: `developer_stage`, `qa_stage`, `router`.
3. **In `developer_stage`:** Create a deep agent with `LocalShellBackend`, the Developer persona prompt, and MCP tools connected to the existing MCP server. Invoke it with the work package prompt.
4. **In `router`:** Read ledger state (via MCP tool call) and return deterministic routing to the next stage.
5. **In `qa_stage`:** Create a deep agent with the QA persona prompt and MCP tools.
6. **Add conditional edges:** `developer_stage` → `router` → `qa_stage` (if pipeline PASS) or back to `developer_stage` (if FAIL).
7. **Run the graph** on a single work package. Verify: Developer agent edits files, QA agent runs tests, transitions happen automatically.

```python
from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

class WorkflowState(TypedDict):
    project_path: str
    current_stage: str
    wp_id: str
    pipeline_status: str
    stage_result: str

def developer_node(state: WorkflowState):
    """Developer stage — edits code, implements features."""
    agent = create_deep_agent(
        backend=LocalShellBackend(root_dir=state["project_path"]),
        system_prompt=open("personas/ledger/vs-code/3-developer.agent.md").read(),
        tools=[...],  # MCP tools via langchain-mcp-adapters
    )
    result = agent.invoke({
        "messages": [{"role": "user", "content": f"Implement WP {state['wp_id']}"}]
    })
    return {"stage_result": result["messages"][-1].content, "current_stage": "qa"}

def qa_node(state: WorkflowState):
    """QA stage — runs tests, validates implementation."""
    agent = create_deep_agent(
        backend=LocalShellBackend(root_dir=state["project_path"]),
        system_prompt=open("personas/ledger/vs-code/4-qa.agent.md").read(),
        tools=[...],
    )
    result = agent.invoke({
        "messages": [{"role": "user", "content": f"Test WP {state['wp_id']}"}]
    })
    return {"stage_result": result["messages"][-1].content}

def route_after_qa(state: WorkflowState):
    # Read ledger state and determine next step — PURE FUNCTION, no LLM
    if "PASS" in state["stage_result"]:
        return "end"
    return "developer"  # Rework

graph = StateGraph(WorkflowState)
graph.add_node("developer", developer_node)
graph.add_node("qa", qa_node)
graph.add_edge(START, "developer")
graph.add_edge("developer", "qa")
graph.add_conditional_edges("qa", route_after_qa, {"developer": "developer", "end": END})
workflow = graph.compile()
```

## Project Decisions

The following decisions were made by the project owner to resolve open questions and scope the implementation.

| # | Decision Area | Resolution |
|---|---------------|------------|
| 1 | **Language** | **Python.** No requirement to stay in TypeScript. Use the mature Python Deep Agents SDK and LangGraph Python package. |
| 2 | **Code location** | **New `orchestrator/` subfolder** at the workspace root, alongside `mcp-server/` and `personas/`. Independent Python project with its own `pyproject.toml` / `requirements.txt`. |
| 3 | **MCP server fate** | **Keep as-is.** The MCP server remains the ledger/decision backend. Both the existing IDE-based workflow and the new LangGraph orchestrator will be functional — the orchestrator consumes MCP tools via `langchain-mcp-adapters`. No MCP server code changes required. |
| 4 | **Persona prompts** | **Out of scope.** Persona rewrites to adapt tool names (e.g., `run_in_terminal` → `execute`) are a subsequent project. For now, the orchestrator will use the existing persona files as system prompts, accepting that some IDE-specific instructions will be irrelevant to the Deep Agent runtime. |
| 5 | **Entry point** | **CLI command.** A simple `python orchestrator/run.py <plan-document>` (or equivalent) to launch a pipeline run. No GUI integration needed in MVP. |
| 6 | **Pipeline scope** | **Full chain: PM → Developer → QA → Reviewer → Documentation → Synthesis** (6 stages). The Planner stage is excluded — the user creates the plan manually and passes the plan document as input to the CLI. The PM stage is the first automated stage. |
| 7 | **Model & API key** | **Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6-20250929` or equivalent model string). User has an Anthropic API key. Set via `ANTHROPIC_API_KEY` environment variable. |
| 8 | **Python environment** | **User-managed.** The user will ensure Python, pip/uv, and any required tooling are available on the Windows development machine. The project should document prerequisites but not automate Python installation. |

### Implications for Implementation

- **No IDE bridge needed.** The headless Deep Agents approach (Approach C from this report) is confirmed as the path forward. The user explicitly accepted losing the interactive chat experience.
- **Ledger provides visibility.** The user confirmed that the ledger's state tracking and the Synthesis agent's event compilation provide sufficient insight into what happens during automated execution.
- **Existing personas used as-is.** Deep Agent nodes will load persona `.agent.md` files directly as `system_prompt`. Some IDE-specific tool references in the prompts will be ignored by the LLM (it won't have those tools available), which is an acceptable trade-off until persona rewrites happen.
- **Plan document as input.** The orchestrator reads a plan document (Markdown) containing work packages. This replaces the Planner agent's role — the graph starts at PM, which ingests the plan and begins orchestrating work packages through the pipeline.

## Open Questions (Remaining)

1. **MCP adapter reliability:** The `langchain-mcp-adapters` package connects LangGraph agents to MCP servers. How reliable is it for the STDIO-based MCP protocol? Has it been tested with custom MCP servers (not just reference implementations)?

2. **Concurrent stage execution:** Deep Agents supports subagent delegation. Can multiple deep agent subagents operate on independent work packages concurrently within a single LangGraph graph?

3. **Edit quality without IDE intelligence:** IDE agents benefit from language servers, type checkers, and semantic understanding. Deep Agents' `edit_file` is pure string replacement. In practice, how does edit quality compare for complex refactoring tasks?

4. **Plan document format:** What structure should the plan document follow? The current Planner agent produces a specific format with work packages, dependencies, and acceptance criteria. The orchestrator needs to parse this reliably.

## References

- Deep Agents GitHub repository: https://github.com/langchain-ai/deepagents (9.6k stars, MIT license)
- Deep Agents JS/TS version: https://github.com/langchain-ai/deepagentsjs
- Deep Agents documentation: https://docs.langchain.com/oss/python/deepagents/overview
- Deep Agents backends: https://docs.langchain.com/oss/python/deepagents/backends
- Deep Agents harness capabilities: https://docs.langchain.com/oss/python/deepagents/harness
- Deep Agents sandboxes: https://docs.langchain.com/oss/python/deepagents/sandboxes
- LangChain `@tool` decorator: https://docs.langchain.com/oss/python/langchain/tools
- LangChain tool integrations: https://docs.langchain.com/oss/python/integrations/tools
- LangChain MCP Adapters: https://github.com/langchain-ai/langchain-mcp-adapters
- LangGraph workflows and agents: https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Prior research: [LangGraph Workflow Orchestration](2026-02-24-langgraph-workflow-orchestration.md)
