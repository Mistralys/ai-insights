# Loading MCP Tools

## Question

Can you explain what it means that they are deferred tools? I thought that all tools are always available. What does loading them entail exactly?

## Answer 

Great question! Let me clarify this architecture:

**Regular vs Deferred Tools**

Regular tools are always loaded and visible to me from the start of every conversation. These include core tools like read_file, replace_string_in_file, grep_search, semantic_search, etc.

Deferred tools are kept in a registry but not loaded into my active tool list until I explicitly search for them using `tool_search_tool_regex`. This includes:

- MCP (Model Context Protocol) server tools
- Other specialized tools that might not be needed in every conversation

**Why Defer Tools?**

Token efficiency: If every MCP server tool was loaded upfront, my context would balloon significantly. Projects might have dozens or even hundreds of MCP tools available. By deferring them, only the tools I actually need get loaded.

**What "Loading" Actually Means**

When I call `tool_search_tool_regex`:

1. I provide a regex pattern (e.g., ledger_ or github_)
2. The system searches the deferred tool registry
3. Matching tools are returned in the search results with their full schemas
4. Those tools are now available to me for direct invocation
5. I don't need to search for them again in that conversation

So "loading" doesn't mean installing or activating something external—it means **expanding deferred tools from the registry into my active tool list**.

**The Agent's Mistake**

When your Developer agent says "The ledger MCP tools are not available" before even searching, it's making an assumption. The correct flow should be:

Silently search for ledger_ tools
If found → use them
If not found → then report they're unavailable
The updated pre-flight check now explains that searching is step 1, so the agent should just do it without commentary.