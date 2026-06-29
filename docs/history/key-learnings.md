# Key Learnings

- Have relevant documents open to make it easier for the agent to see them
- Create a project manifest describing the whole project, from the tech stack to the available functionality
- Create a technical guidelines document detailing preferred coding methods
- Create a document with resuable prompts for repeatable tasks
- Create high-level feature descriptions, and use AI to synthesize implementation guides out of them
- Ask the agent to review the implementation plan (see question below)
- Claude has proven reliable for implementing larger concepts in one go
- Use one chat per feature implementation to keep the context and be able to use shorter prompts
- I can start with high-level application or feature descriptions.
- Writing agent-friendly concepts is a real skill.
- I can ask my agent to review the implementation plan to find logic fallacies and things that may be missing.
- These detailed implementation plans are immensely valuable even for me to detect possible issues early.
- Keep the implentation plans in an archive for documentation purposes.
- Create usage scenarios early on that can be used as basis for tests.
- Documentation and context are key (as in critically vital).
- Given some high-level descriptions of systems, agents can create documentation by analyzing the code.
- Maintain application manifests. Keep them updated with each added feature.
- Testability is as vital as documentation.
- Agents are excellent at creating tests, provided the documentation exists.
- Don't do too much at once. Implement bigger features in smaller logical steps, showing the agent the entire roadmap for context.
- Dont't write implementation prompts - create plans even for small features.
- Keep AI-maintained documentation files small, AI tends to delete blocks in large files and get lost.
- Develop in small chunks to make reviewing easier.
- Web-based LLMs do not use the same data. Same architecture, different knowledge.
- Combine web-based LLMs with agent coding LLMs for best effect.
- Web-based LLMs can create detailed implementation plans from a high-level description, filling in concrete details from massive online knowledge.
- Combine with GIT or other versioning for DIFF and rollback.
- Use agents to upgrade your code between versions, but do it incrementally - not from PHP5 to PHP8 right away, for example.
- Agents have a limited context storage. When reaching approx. 80%, they start to compact the context, losing precision.
- Use plan mode when planning. If the concept is detailed enough, no need to use a big model for the implementation.
- Use AGENTS.md to link all resources and describe core concepts.
- Use CTX generator to compile context files.
- Set up a context MCP server to simplify access to the project context.
- Can go back in a conversation to fix what you wrote when the results are not good.
- Split documents into smaller chunks.
- Give web LLMs a combined project manifest to discuss app details
- Rename files to support agents naturally expecting specific names (e.g. `project-ledger.json`).
- Robust code requires oversight.
- PHP agents expect Composer commands for `test` (PHPUnit) and `analyze` (PHPStan).
- MCP server tools are handled via "Deferred loading": The agent has to actively search for them to see them (reason: token efficiency). 
- Include detailed explanations in tool error responses to explain why it went wrong and what should be done instead as auto-documenting tools.
- MCP Server tool names are prefixed internally by the name of the server, typically as defined in the MCP server config. E.g. `server_name` = `mcp_server_name_tool_name`.
- Avoid repeating tool prefix in server names, e.g. `project-ledger` server name = `mcp_project-ledge_ledger_add_observation` full tool name for `ledger_add_observation`.
- To trigger personas, use `**Identity: Senior Software Architect.**`. The `Identity:` syntax acts as a permanent attribute, rather than a conversational instruction ("You are xxx").
- LLM API Keys: Use during development, then rotate when done.
- Reviewing application logic: Let an agent create a full, language-agnostic specification, then review this by multiple agents and web LLMs. Ask your agent to synthesize the findings, then create a plan to fix the issues. Repeat this process with a new specification when done, until the logic is solid.
- VS Code running an MCP is window-specific.

## My AI Journey Milestones

### December 2025-January 2026

- Vibe-coded the Starfield Load Order Keeper with WPF C# 
- Created a GitHub actions workflow to automate release with Windows binaries
- Agentic coding with Copilot, Claude and Roo Code.
- IDEs: PHPStorm, Visual Studio, Visual Studio Code, Cursor
- Vibe-coded the cross-platform X4 Savegame Launcher with Rust (Tauri) and React (Typescript + Vite)
- Bridged the PHP / Tauri worlds for X4 Savegame Launcher: NDJSON layer specification by Copilot, Implementation in Rust by Gemini, spec refined by manual Copilot<>Gemini exchange
- Multi-project agentic coding with VS Code and Copilot 
- Upgraded the app framework for agentic coding
- Upgraded a 10-year old PHP app for agentic coding
- Upgraded multiple open source projects for agentic coding

### February 2026

- AGENTS.md generation and maintenance.
- Now using a custom system prompt for plan mode.
- Switched to VS Code Copilot for agentic coding, PHPStorm is too buggy.
- X4 library ecology upgrade.
- X4 physics calculations, created and reviewed by three LLMs (gemini-web, copilot-web, claude-local).
- Creating custom prompts for personas.
- Using a JSON ledger to keep track of multi-agent processes.
- Roo Code and Copilot custom modes for seamless handoffs.
- Adding metadata to agent prompts.
- Project Manifest + AGENTS.md now proven and well oiled.
- Using agents to create a refactoring guide (framework v7 update).
- Creating a custom project ledger MCP server.
- Optimizing MCP tool descriptions and adding a `help` tool to guide weaker models.
- Using auto-handoffs in VS Code through the MCP ledger.
- Refining agents into specialized roles, adding more personas.
- Documenting large codebases through module-centric context files, by documenting dependencies and documentation sources, generating module overviews in a build process and using CTX to compile it all.
- Module Intent Architect (MIA) > Module Context Architect (MCA) combo.
- MIA capable of documenting module including submodules. 
- Implementing the development workflow in LangGraph @Python.
- Solidifying the ledger workflow with cyclic specification & audit cycles.
- Large multi-phase projects with a plan per phase and each phase using the previous phase's synthesis.
- Create parallel local project copies with branches to work with workflows in parallel.

### March 2026

- Verifying ledger logic against the specification through unit tests first.
- Periodic audits after multiple iterations: Can something be simplified.
- Adding a glossary of opaque terms connected to the modules they are used in.

### May 2026

- Always audit a newly created plan, no plan is perfect from the start.
- After auditing a plan, check it for simplification opportunities.
- Give agents a simple way to refresh CTX generated files.
- Use a mini-audit workflow to automate plan reviews.

### June 2026

- Extracting bits of knowledge from a Synthesis.
- Using a dedicated agent to curate knowledge.
- Adding project-specific stategy and vision to the planner agent.
- Not mixing topics in an LLM discussion is even more critical than I thought.
