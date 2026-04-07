# LangGraph Deep Agents: Persona & Subagent Setup Handbook

> A concise reference for developer agents building persona-driven workflows with subagent delegation.

---

## 1. Prerequisites

```bash
# Install the deepagents package
pip install deepagents

# Or with uv
uv add deepagents
```

Required environment variables (set whichever providers you use):

```bash
ANTHROPIC_API_KEY=...    # Default model is Claude Sonnet 4
OPENAI_API_KEY=...       # If using OpenAI models
TAVILY_API_KEY=...       # If using Tavily for web search
```

---

## 2. Core Concepts

**Deep Agents** are an opinionated agent harness built on LangGraph. They differ from basic ReAct agents by shipping four built-in capabilities out of the box:

| Capability | Built-in Tool | Purpose |
|---|---|---|
| Planning | `write_todos` / `read_todos` | Task decomposition and progress tracking |
| Filesystem | `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep` | Context offloading and persistent scratch space |
| Subagents | `task` (internally calls `call_subagent`) | Context-isolated delegation to specialist agents |
| Context management | Auto-summarization | Prevents context window overflow |

The `create_deep_agent` factory returns a compiled **LangGraph graph**, so all LangGraph features (streaming, checkpointers, Studio, human-in-the-loop) work natively.

---

## 3. Defining a Persona with a System Prompt

The system prompt is where you establish your agent's persona. Deep Agents automatically append internal instructions for todo, filesystem, and subagent usage, so your prompt should focus on **domain behavior, delegation strategy, and quality standards**.

```python
PM_SYSTEM_PROMPT = """
You are a senior Project Manager agent. Your responsibilities:

PLANNING: Break every incoming request into discrete, trackable tasks
using the write_todos tool before taking action.

DELEGATION: Assign specialized work to the appropriate subagent using
the task tool. Never do research or analysis yourself — delegate it.

SYNTHESIS: After subagents return results, synthesize findings into a
clear, actionable summary. Save deliverables to files.

RULES:
- Always create a plan first.
- Use subagents for any task that requires domain expertise.
- Keep your own context clean — let subagents handle the details.
- Write final reports to /final_report.md.
"""
```

---

## 4. Configuring Subagents

### 4a. Dictionary-Based Subagents (Simple)

The quickest approach — pass a list of dicts to the `subagents` parameter:

```python
from deepagents import create_deep_agent

research_subagent = {
    "name": "research-agent",
    "description": "Conducts deep research on specific topics",
    "system_prompt": "You are a research specialist. Search thoroughly, "
                     "cross-reference sources, and return a concise summary.",
    "tools": [internet_search],
    "model": "anthropic:claude-sonnet-4-6",  # Optional per-subagent model
}

analysis_subagent = {
    "name": "analysis-agent",
    "description": "Analyzes data and draws structured insights",
    "system_prompt": "You are a data analyst. Examine the provided information, "
                     "identify patterns, and return key findings as bullet points.",
    "tools": [],  # Inherits parent tools if empty
}

task_executor_subagent = {
    "name": "task-executor",
    "description": "Executes discrete implementation tasks",
    "system_prompt": "You are a task executor. Complete the assigned task "
                     "precisely and report the outcome.",
    "tools": [internet_search],
}
```

### 4b. CompiledSubAgent (Advanced)

For complex subagents, wrap a full LangGraph graph:

```python
from deepagents import create_deep_agent, CompiledSubAgent
from langchain.agents import create_agent

custom_graph = create_agent(
    model=your_model,
    tools=specialized_tools,
    prompt="You are a specialized agent for data analysis..."
)

custom_subagent = CompiledSubAgent(
    name="data-analyzer",
    description="Specialized agent for complex data analysis tasks",
    runnable=custom_graph,
)
```

**Requirement:** Custom LangGraph graphs must have a state key called `"messages"`.

### 4c. File-Based Subagents (CLI)

For CLI users, define subagents as `AGENTS.md` files on disk. The YAML frontmatter maps to `name`, `description`, and `model`; the markdown body becomes `system_prompt`:

```markdown
---
name: research-agent
description: Conducts deep research on specific topics
model: anthropic:claude-sonnet-4-6
---

# Research Agent

You are a research specialist. Search thoroughly and return concise summaries.
```

---

## 5. Assembling the Deep Agent

```python
from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model

agent = create_deep_agent(
    model=init_chat_model("anthropic:claude-sonnet-4-6"),
    tools=[internet_search],                     # Shared tools
    system_prompt=PM_SYSTEM_PROMPT,              # Persona prompt
    subagents=[                                  # Specialist subagents
        research_subagent,
        analysis_subagent,
        task_executor_subagent,
    ],
)
```

### Key Parameters at a Glance

| Parameter | Type | Purpose |
|---|---|---|
| `model` | `str` or `LanguageModelLike` | LLM for the main agent (default: Claude Sonnet 4) |
| `tools` | `list[Callable]` | Tools available to main agent and subagents |
| `system_prompt` | `str` | Your persona instructions |
| `subagents` | `list[dict \| CompiledSubAgent]` | Custom specialist subagents |
| `middleware` | `list[AgentMiddleware]` | Additional middleware (appended after defaults) |
| `checkpointer` | LangGraph checkpointer | Enables state persistence across invocations |
| `interrupt_on` | `dict` | Human-in-the-loop approval for specific tools |

---

## 6. Running the Agent

```python
result = agent.invoke({
    "messages": [
        {
            "role": "user",
            "content": "Research the top 3 project management tools and "
                       "write a comparison report."
        }
    ],
    # Optional: pass files in
    # "files": {"context.md": "Background info..."}
})

# Access the final response
print(result["messages"][-1].content)

# Access any files the agent created
for filename, content in result["files"].items():
    print(f"  {filename}: {len(content)} chars")
```

### Streaming

```python
for event in agent.stream({
    "messages": [{"role": "user", "content": "..."}]
}):
    # Process streaming events
    print(event)
```

---

## 7. How Subagent Delegation Works at Runtime

When the main agent calls the built-in `task` tool:

```
User Input
  → PM Agent plans with write_todos
  → PM Agent calls task(subagent="research-agent", task="...")
      → research-agent runs in isolated context
      → research-agent returns only the final result
  → PM Agent calls task(subagent="analysis-agent", task="...")
      → analysis-agent runs in isolated context
      → analysis-agent returns only the final result
  → PM Agent synthesizes results → writes final report
```

**Context quarantine** is the key benefit: each subagent's intermediate tool calls, search results, and reasoning stay in its own context. The parent agent only receives the final output, keeping its context window clean.

---

## 8. The General-Purpose Subagent

Every deep agent has access to a built-in **general-purpose subagent** with the same instructions and tools as the parent. This is useful for ad-hoc delegation when no specialist subagent fits:

```python
# The agent can do this at runtime automatically:
# task(subagent="general-purpose", task="Quick side investigation on X")
```

To override it, include a subagent with `name="general-purpose"` in your subagents list.

---

## 9. Structured Output from Subagents

Validate subagent responses with a schema via `response_format`:

```python
from langchain.agents import create_agent

validated_subagent = create_agent(
    model=your_model,
    tools=specialized_tools,
    prompt="Return your analysis as structured data.",
    response_format=AnalysisSchema,  # Pydantic model or dict schema
)
```

The structured object is captured and validated but is **not** automatically returned to the parent — include the relevant data in the `ToolMessage` yourself.

---

## 10. Async Subagents

For long-running tasks, parallel workstreams, or mid-flight steering, use **async subagents** instead of the default synchronous ones (where the supervisor blocks until the subagent finishes). See the official docs on Async Subagents for configuration.

For async agent creation:

```python
from deepagents import async_create_deep_agent

agent = await async_create_deep_agent(
    tools=[internet_search],
    system_prompt=PM_SYSTEM_PROMPT,
    subagents=[research_subagent],
)
```

---

## 11. Best Practices

1. **Write specific system prompts.** Generic prompts like "You are a helpful assistant" produce poor results. Define the persona's role, delegation strategy, output format, and quality criteria.

2. **Write good tool docstrings.** The LLM reads function docstrings and parameter descriptions to decide when and how to use tools. Clear docstrings lead to better tool selection.

3. **Use subagents for context isolation.** If a subtask involves web search, database queries, or any operation that produces large intermediate output, delegate it to a subagent.

4. **Keep subagent prompts focused.** Each subagent should have a narrow, well-defined role. Broad subagent prompts recreate the context bloat problem you're trying to solve.

5. **Use the filesystem for large outputs.** Have agents write intermediate results to files rather than keeping everything in the message history.

6. **Choose the right model per agent.** Use more capable models (Claude Sonnet/Opus, GPT-4o/5) for the orchestrator and planning-heavy subagents. Faster, cheaper models can work for simpler execution subagents.

7. **Add human-in-the-loop for sensitive operations.** Use the `interrupt_on` parameter to require approval before specific tools execute.

---

## 12. Quick Reference: Project Manager Example

```python
import os
from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model
from tavily import TavilyClient

# --- Tools ---
tavily = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

def internet_search(query: str, max_results: int = 5) -> str:
    """Run a web search to find current information."""
    return tavily.search(query, max_results=max_results)

# --- Subagents ---
subagents = [
    {
        "name": "research-agent",
        "description": "Researches topics in depth and returns summaries",
        "system_prompt": (
            "You are a research specialist. Use internet_search to gather "
            "information, cross-reference multiple sources, and return a "
            "concise, well-sourced summary. Save detailed notes to files."
        ),
        "tools": [internet_search],
    },
    {
        "name": "analysis-agent",
        "description": "Analyzes data and produces structured insights",
        "system_prompt": (
            "You are an analyst. Read files provided to you, identify key "
            "patterns and risks, and return structured findings."
        ),
    },
    {
        "name": "writer-agent",
        "description": "Writes polished reports and documents",
        "system_prompt": (
            "You are a technical writer. Read research files and analysis, "
            "then produce a clear, well-structured final report in markdown."
        ),
    },
]

# --- Main Agent ---
pm_agent = create_deep_agent(
    model=init_chat_model("anthropic:claude-sonnet-4-6"),
    tools=[internet_search],
    system_prompt="""
You are a Project Manager agent. For every request:
1. Plan: Break the work into tasks with write_todos.
2. Delegate: Assign research to research-agent, analysis to
   analysis-agent, and writing to writer-agent.
3. Synthesize: Review subagent outputs and compile the final deliverable.
4. Deliver: Save the final output to /deliverable.md.

Never do research or analysis yourself. Always delegate.
""",
    subagents=subagents,
)

# --- Run ---
result = pm_agent.invoke({
    "messages": [{
        "role": "user",
        "content": "Evaluate three CI/CD platforms for our team and recommend one."
    }]
})

print(result["messages"][-1].content)
```

---

## Further Reading

- **Official Docs:** [docs.langchain.com/oss/python/deepagents](https://docs.langchain.com/oss/python/deepagents/overview)
- **Subagents Reference:** [docs.langchain.com/oss/python/deepagents/subagents](https://docs.langchain.com/oss/python/deepagents/subagents)
- **API Reference:** [reference.langchain.com/python/deepagents](https://reference.langchain.com/python/deepagents)
- **GitHub:** [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
- **PyPI:** [pypi.org/project/deepagents](https://pypi.org/project/deepagents/)
