# Research Report

## Problem Statement

The current ledger-enabled multi-agent workflow (7 agents: Planner → Project Manager → Developer → QA → Reviewer → Documentation → Synthesis) suffers from **non-deterministic handoffs**. Even when the MCP server emits an `auto_handoff` instruction containing the next agent name and a prompt, the IDE-hosted agents regularly ignore the handoff and fall back to manual intervention. When questioned, agents hallucinate — claiming they saw the auto-handoff but did not act on it.

The core question: **Can LangGraph replace or augment the current MCP-server-based workflow to make agent transitions deterministic and code-controlled rather than prompt-reliant?**

## Problem Decomposition

1. **Why do handoffs fail today?** — The current system relies on the LLM *choosing* to honour the `auto_handoff` payload. This is fundamentally probabilistic, not deterministic.
2. **What does "deterministic orchestration" require?** — Transitions must be driven by code, not prompts. The orchestrator decides which agent runs next based on workflow state.
3. **How does LangGraph model multi-agent graphs?** — StateGraph, nodes, edges, conditional routing, `Command`, subgraphs.
4. **How would the 7-stage pipeline map to a LangGraph graph?** — Node-per-stage, shared state mirroring the ledger, conditional edges for rework/block flows.
5. **What happens to the existing MCP server and ledger?** — Co-existence options: LangGraph wrapping existing tools, or gradually replacing the ledger with LangGraph state.
6. **What are the practical constraints of running LangGraph locally?** — Python runtime, LLM API keys, local checkpointing, IDE integration loss.

## Context & Constraints

- **Current stack**: TypeScript MCP server over STDIO, VS Code / Claude Code IDEs, persona prompt files, JSON ledger files on disk.
- **Current handoff mechanism**: `ledger_get_handoff_status` returns an `auto_handoff` object (agent filename + prompt). The IDE agent is *asked* to invoke `runSubagent` with that payload. This is prompt-level, not code-level.
- **Hard constraint**: Must run **locally** on the developer machine — no cloud-hosted LangGraph Platform / Agent Server.
- **Hard constraint**: Must support the existing 7-stage pipeline with its dependency model (WP dependencies, pipeline prerequisites: implementation → QA → code-review → documentation).
- **Soft preference**: TypeScript/JavaScript preferred (the workspace is TS); Python acceptable if justified.
- **Soft preference**: Preserve existing ledger data model and MCP tools if possible (incremental migration > full rewrite).
- **Soft preference**: Human-in-the-loop should remain possible (e.g., reviewing plans before execution).

## Prior Art & Known Patterns

### Pattern 1: Current MCP Auto-Handoff (Status Quo)

- **Description:** The MCP server's `buildHandoffResponse()` function computes the next agent based on pipeline state. It emits an `auto_handoff` object with `agent_name` and `prompt`. The active IDE agent is expected to call `runSubagent()` with this payload.
- **Where used:** This workspace — `mcp-server/src/tools/workflow-handoff.ts`.
- **Strengths:**
  - Zero additional infrastructure — runs inside the existing MCP server.
  - Depth counter (`auto_handoff_depth`, max 10) prevents runaway loops.
  - Human-in-the-loop is trivially enabled by disabling `auto_handoff_enabled` in config.
- **Weaknesses:**
  - **Fundamentally non-deterministic.** The LLM decides whether to honour `auto_handoff`. It frequently does not.
  - Agents hallucinate about having received the handoff instruction.
  - No retry mechanism — a missed handoff requires manual user intervention.
  - The orchestration logic is split: business rules in the MCP server, execution in the IDE prompt layer.
- **Fit:** Insufficient for the stated goal of deterministic orchestration. This is the pattern being replaced.

### Pattern 2: LangGraph StateGraph (Graph API)

- **Description:** LangGraph models workflows as directed graphs with typed state. Each node is a function that receives the current state and returns a state update. Edges (static or conditional) determine which node executes next. The orchestrator (LangGraph runtime) makes all routing decisions in code — the LLM inside a node does its work, but *never* decides which node runs next.
- **Where used:** LangChain ecosystem. Production use at Klarna, Replit, Elastic per LangChain marketing. Available as both Python (`langgraph`) and JavaScript/TypeScript (`@langchain/langgraph`) packages.
- **Strengths:**
  - **Deterministic routing.** Conditional edges are pure functions inspecting state — not LLM output.
  - Rich state management with typed schemas (Zod in JS, TypedDict/Pydantic in Python), reducers, and message handling.
  - Built-in persistence via checkpointers (in-memory, SQLite, Postgres). Supports durable execution, time-travel, and replay.
  - Human-in-the-loop via `interrupt()` — pauses the graph and waits for `Command(resume=...)`.
  - Subgraph support — each agent stage can be its own sub-graph with independent state.
  - Recursion limit and depth tracking built-in (similar to current `auto_handoff_depth`).
  - `Command` primitive allows nodes to *both* update state and route — ideal for handoffs.
  - Visualization built-in (Mermaid diagram export).
- **Weaknesses:**
  - **Python-first ecosystem.** The JS/TS SDK exists (`@langchain/langgraph`) and supports the same Graph API, but documentation, examples, and community focus are skewed toward Python.
  - Requires LLM API keys (Anthropic, OpenAI, etc.) configured directly — cannot reuse the existing MCP server's STDIO channel to VS Code Copilot.
  - **Replaces the IDE agent experience.** With LangGraph, agents are LLM calls inside nodes — you lose the IDE's native chat interface, inline file editing, and tool-calling experience that VS Code Copilot / Claude Code provide.
  - Additional dependency footprint: `@langchain/langgraph`, `@langchain/core`, plus model provider SDKs.
  - Learning curve for the LangGraph programming model (supersteps, reducers, channels).
- **Fit:** Strong fit for deterministic orchestration. Primary concern is the loss of IDE-native agent capabilities.

### Pattern 3: CrewAI Sequential/Hierarchical Workflows

- **Description:** CrewAI provides a higher-level abstraction for multi-agent workflows. Agents are defined with roles, goals, and tools. Tasks are assigned to agents and executed in sequence or via a hierarchical manager.
- **Where used:** CrewAI framework, many YouTube tutorials and blog posts.
- **Strengths:**
  - Very quick to set up for sequential multi-agent pipelines.
  - Built-in role/goal/backstory model maps naturally to the 7 personas.
  - Supports tool integration (could wrap existing MCP tools).
- **Weaknesses:**
  - **Python-only** — no TypeScript support.
  - Less control over routing logic than LangGraph (more opinionated, less flexible).
  - Smaller ecosystem and less battle-tested in production.
  - Same "loss of IDE experience" problem as LangGraph.
  - Less granular state management — no equivalent of LangGraph's typed schemas with reducers.
- **Fit:** Adequate for simple sequential flows but lacks the conditional routing, rework loops, and dependency tracking the ledger workflow requires.

### Pattern 4: Custom Orchestrator Script (subprocess-based)

- **Description:** Write a Node.js/TypeScript script that orchestrates the workflow by spawning IDE agent sessions (e.g., via Claude Code CLI `claude --agent-file ...`) in sequence. The script reads ledger state via the MCP tools, decides the next agent, and launches it.
- **Where used:** Ad-hoc internal tooling, some GitHub Actions-based CI/CD agent pipelines.
- **Strengths:**
  - **Stays in the TypeScript ecosystem** — no Python dependency.
  - **Preserves the existing MCP server and ledger** — the orchestrator consumes MCP tools.
  - Can leverage IDE-native agent capabilities (each agent runs in its full IDE context).
  - Full control over routing logic — deterministic by construction.
  - Minimal new dependencies.
- **Weaknesses:**
  - Must implement persistence, checkpointing, and error recovery from scratch.
  - No built-in graph visualization, time-travel, or replay.
  - Fragile subprocess management — agent crashes, timeouts, and output parsing must all be handled manually.
  - Claude Code CLI support for headless agent execution is experimental and may change.
  - VS Code has no equivalent headless CLI for programmatic agent invocation.
- **Fit:** High control, low infrastructure, but significant engineering effort for reliability.

## Alternative & Creative Approaches

### Approach A: LangGraph as Outer Orchestrator, Existing MCP Tools as Inner Tools

- **Description:** Build a LangGraph StateGraph where each node represents one pipeline stage. Inside each node, use the LangChain `tool()` abstraction to call the **existing MCP server tools** (via a thin adapter that sends STDIO messages to the running MCP server). The LLM inside each node gets the same persona prompt and the same MCP tools it currently has, but routing between nodes is deterministic.
- **Rationale:** This preserves the existing ledger, MCP server, and tool implementations. LangGraph adds only the orchestration layer. The MCP server continues to enforce business rules (status transitions, pipeline prerequisites, acceptance criteria).
- **Risk:** Complex adapter layer between LangGraph and the STDIO MCP protocol. Token costs double (LLM calls from LangGraph + LLM calls that were previously in the IDE). IDE integration (inline code editing) is lost.

### Approach B: LangGraph with Direct File/Tool Access (Bypass MCP)

- **Description:** Instead of calling MCP tools through the server, have LangGraph nodes directly import and call the LedgerStore TypeScript class and tool logic from `mcp-server/src/`. Each node performs its pipeline stage work using local LLM API calls, reads/writes ledger state directly, and returns the updated state.
- **Rationale:** Eliminates the STDIO adapter complexity. The LangGraph graph *becomes* the ledger orchestrator, with LedgerStore as the persistence backend.
- **Risk:** Requires the LangGraph implementation to be in TypeScript (using `@langchain/langgraph`). The JS SDK is less mature than the Python one. Also, the LLM nodes cannot perform IDE-level operations (creating files, running tests, editing code in-place) without additional tooling.

### Approach C: Hybrid — LangGraph for Orchestration + IDE Agents for Execution

- **Description:** Use LangGraph (Python or JS) purely as a **state machine / orchestrator** that decides *which* agent runs next and *what* it should do. But the actual execution happens by programmatically launching IDE agents (e.g., via VS Code's `runSubagent` API, Claude Code CLI, or a custom VS Code extension that listens for commands). LangGraph manages the graph state and transitions, while the IDE agents handle file editing, test running, and code generation.
- **Rationale:** Best of both worlds — deterministic routing from LangGraph, full IDE capabilities from the native agent runtime. The existing MCP server and ledger remain the state backend. LangGraph checkpointing provides durability.
- **Risk:** Complex integration surface. Requires a bridge between LangGraph and the IDE's agent invocation API. WebSocket or HTTP server to coordinate. Latency between LangGraph decisions and IDE agent execution. The "bridge" is the most non-trivial (and fragile) component.

### Approach D: Enhanced MCP Server (No LangGraph)

- **Description:** Instead of introducing LangGraph, enhance the existing MCP server to expose a **workflow runner** endpoint (via the existing GUI HTTP server or a new one). This runner reads ledger state, determines the next agent, and directly invokes it via VS Code's extension API or a WebSocket to a VS Code extension. The orchestration logic stays in TypeScript, in the MCP server, but the execution trigger is *code-driven* rather than prompt-driven.
- **Rationale:** Smallest possible change surface. The handoff logic already exists (`buildHandoffResponse`); the missing piece is a code-level execution trigger instead of relying on the LLM.
- **Risk:** Requires building a VS Code extension (or leveraging an existing one) to programmatically start agent sessions. This is the piece that currently doesn't exist and may not be possible without VS Code API access to Copilot's internal agent system.

## Comparative Evaluation

| Criterion | LangGraph (Pattern 2) | CrewAI (Pattern 3) | Custom Script (Pattern 4) | Hybrid LangGraph+IDE (Approach C) | Enhanced MCP (Approach D) |
|---|---|---|---|---|---|
| **Deterministic routing** | ✅ Excellent — code-controlled edges | ✅ Good — sequential/hierarchical | ✅ Excellent — fully custom | ✅ Excellent — LangGraph routes | ✅ Good — code-controlled |
| **IDE integration** | ❌ Lost — LLM calls are API-based | ❌ Lost | ⚠️ Partial — depends on CLI | ✅ Preserved — IDE agents execute | ✅ Preserved — if bridge works |
| **Existing ledger reuse** | ⚠️ Requires adapter or rewrite | ❌ Own state model | ✅ Full reuse | ✅ Full reuse | ✅ Full reuse |
| **State persistence** | ✅ Built-in checkpointer | ⚠️ Limited | ❌ Must build | ✅ LangGraph + ledger | ✅ Existing ledger |
| **Language match** | ⚠️ Python preferred; JS exists | ❌ Python only | ✅ TypeScript | ⚠️ LangGraph part may be Python | ✅ TypeScript |
| **Complexity** | Medium | Low–Medium | High | High | Medium |
| **Maturity** | High (Python), Medium (JS) | Medium | N/A (custom) | Low (novel integration) | Medium (extension required) |
| **Human-in-the-loop** | ✅ `interrupt()` built-in | ⚠️ Limited | ⚠️ Must build | ✅ Both LangGraph + IDE | ✅ Existing mechanism |
| **Rework/dependency loops** | ✅ Conditional edges handle naturally | ⚠️ Harder to model | ✅ Custom logic | ✅ Full support | ✅ Existing logic |
| **Time to implement** | 2–4 weeks | 1–2 weeks | 3–5 weeks | 4–6 weeks | 2–3 weeks |
| **Token cost** | Higher (direct API calls) | Higher | Same as current | Same as current | Same as current |

## Recommendation

### Primary Recommendation: Approach C — Hybrid LangGraph + IDE Agents

**Rationale:** This approach delivers deterministic orchestration (the core problem) while preserving the IDE-native agent experience that makes the current workflow powerful. It also preserves the entire existing MCP server and ledger investment.

The key insight is: **LangGraph is excellent at graph-based state management and routing, but the actual "agent work" (editing files, running tests, writing code) is best done by IDE-native agents that have access to the workspace.**

**Implementation strategy:**

1. **LangGraph (Python or JS) acts as the supervisor graph.** Each node corresponds to a workflow stage (Planner, PM, Developer, QA, Reviewer, Documentation, Synthesis). Conditional edges inspect ledger state to determine transitions (including rework loops and dependency handling).

2. **Each node does NOT do the LLM work itself.** Instead, it dispatches a message to the IDE to invoke the appropriate agent, waits for completion, then reads back the ledger state to determine the next transition.

3. **Communication bridge:** A small HTTP/WebSocket server that:
   - Receives "invoke agent X with prompt Y" commands from LangGraph
   - Triggers agent invocation in the IDE (e.g., via VS Code extension API or Claude Code CLI)
   - Reports completion back to LangGraph when the agent finishes

4. **LangGraph state mirrors ledger state** — on each node entry, the graph reads the current ledger state via MCP tools (or directly from LedgerStore). On each conditional edge, the routing function checks pipeline status, WP status, and dependencies.

5. **Human-in-the-loop** via LangGraph `interrupt()` at key checkpoints (after planning, before starting implementation, etc.).

### Fallback Recommendation: Approach D — Enhanced MCP Server

If the LangGraph + IDE bridge proves too complex to build, the simpler path is to enhance the existing MCP server's GUI HTTP server with a `/api/workflow/run` endpoint that:
1. Reads the current ledger state
2. Determines the next agent (using existing `buildHandoffResponse` logic)
3. Sends a command to a lightweight VS Code extension that programmatically invokes the agent
4. Polls for completion and loops

This requires building the VS Code extension bridge but avoids the LangGraph dependency entirely.

### Why NOT pure LangGraph (Pattern 2)?

Pure LangGraph would work beautifully for deterministic orchestration, but it sacrifices the IDE agent experience. The agents would become API-call-based LLM invocations that cannot:
- Edit files in the workspace natively
- Run terminal commands
- Use VS Code's Copilot tools (search, semantic analysis)
- Interact with the user in the chat window

These capabilities are fundamental to why the current workflow is productive. Trading them for deterministic routing is a net loss unless the IDE integration bridge is built.

### Proof-of-Concept Outline

1. **Build a minimal LangGraph StateGraph** (Python or JS) with 3 nodes: `developer_node`, `qa_node`, `router_node`. State includes `current_stage`, `wp_status`, `pipeline_status`.
2. **Implement a simple FastAPI/Express bridge server** that accepts `POST /invoke-agent` with `{ agent_file, prompt }` and triggers a Claude Code CLI call (`claude --agent-file <path> --prompt <text>` or equivalent).
3. **Wire the developer_node** to call the bridge, wait for completion, read ledger state, return updated graph state.
4. **Add a conditional edge** from `developer_node` → `qa_node` (when implementation pipeline is PASS) or back to `developer_node` (when FAIL/rework).
5. **Run the PoC** on a single work package to verify deterministic transition: Developer completes → graph automatically invokes QA → QA completes → graph invokes next stage.
6. **Validate** that the LLM agents never need to decide on handoffs — the graph does it.

### LangGraph State Design (Sketch)

```typescript
// Using @langchain/langgraph (JS/TS)
import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod/v4";

const WorkflowState = new StateSchema({
  projectPath: z.string(),
  currentStage: z.enum(["planner", "pm", "developer", "qa", "reviewer", "documentation", "synthesis"]),
  activeWorkPackageId: z.string().optional(),
  pipelineStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "PASS", "FAIL"]).default("NOT_STARTED"),
  wpStatus: z.enum(["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED"]).default("READY"),
  handoffDepth: z.number().default(0),
  lastAgentOutput: z.string().optional(),
  error: z.string().optional(),
});

const graph = new StateGraph(WorkflowState)
  .addNode("developer", developerNode)     // Invokes IDE agent via bridge
  .addNode("qa", qaNode)                    // Invokes IDE agent via bridge
  .addNode("reviewer", reviewerNode)        // Invokes IDE agent via bridge
  .addNode("documentation", documentationNode)
  .addNode("synthesis", synthesisNode)
  .addNode("readLedger", readLedgerNode)    // Reads current state from MCP
  .addEdge(START, "readLedger")
  .addConditionalEdges("readLedger", routeToNextStage)  // Deterministic!
  .addEdge("developer", "readLedger")       // After each stage, re-read ledger
  .addEdge("qa", "readLedger")
  .addEdge("reviewer", "readLedger")
  .addEdge("documentation", "readLedger")
  .addEdge("synthesis", END)
  .compile();
```

The `routeToNextStage` function is a **pure function** (no LLM) that inspects the ledger state and returns the name of the next node. This is the crucial difference — handoffs become deterministic JavaScript/Python code, not LLM decisions.

## Open Questions

1. **VS Code Extension API for programmatic agent invocation**: Does VS Code expose an API to programmatically start a Copilot agent session with a specific agent file and prompt? If not, the bridge for Approach C/D requires a workaround (e.g., simulated keyboard input, or limiting to Claude Code CLI).

2. **Claude Code CLI headless mode reliability**: Can `claude --agent-file <path>` run reliably in headless/non-interactive mode, returning structured output on completion? This is critical for the bridge.

3. **Token cost impact**: Each agent invocation via LangGraph requires a fresh LLM context. The current IDE-native approach benefits from the IDE's context management. LangGraph-orchestrated calls may consume more tokens per stage.

4. **Parallel work package processing**: The current workflow supports parallel WP processing (multiple agents on independent WPs). LangGraph supports parallel node execution (`Send`), but the bridge would need to handle concurrent IDE agent sessions.

5. **LangGraph JS/TS SDK maturity**: The `@langchain/langgraph` package with the new `StateSchema` API appears recent. Is it production-ready for the patterns described here, or should Python be preferred for the PoC?

6. **Migration path**: How to incrementally migrate from the current pure-MCP workflow to a LangGraph-orchestrated one without breaking existing flows during the transition?

## References

- LangGraph Overview (Python): https://docs.langchain.com/oss/python/langgraph/overview
- LangGraph Overview (JS/TS): https://docs.langchain.com/oss/javascript/langgraph/overview
- LangGraph Graph API (JS/TS): https://docs.langchain.com/oss/javascript/langgraph/graph-api
- LangGraph Quickstart (JS/TS): https://docs.langchain.com/oss/javascript/langgraph/quickstart
- LangGraph Persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph Durable Execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- LangGraph Subgraphs: https://docs.langchain.com/oss/python/langgraph/use-subgraphs
- LangChain Multi-Agent Handoffs (JS): https://docs.langchain.com/oss/javascript/langchain/multi-agent/handoffs
- LangChain Multi-Agent Handoffs (Python): https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs
- `@langchain/langgraph` npm package: https://www.npmjs.com/package/@langchain/langgraph
- Current MCP server workflow implementation: `mcp-server/src/tools/workflow-handoff.ts`
- Current auto-handoff data flow: `mcp-server/docs/agents/project-manifest/data-flows.md` (Flow 13)
- CrewAI: https://www.crewai.com/ (Python-only, not recommended for this use case)
