# Research Report: DeepAgents Browser Tool Support

## Problem Statement

Does the `deepagents` Python SDK — used by the orchestrator to run headless agent workflows — provide a browser tool (Playwright or equivalent) that agents can use to verify visuals during execution? VS Code chat provides Playwright-powered browser tools (`open_browser_page`, `click_element`, `read_page`, `screenshot_page`, `run_playwright_code`) — this research determines whether similar capabilities exist for orchestrator-driven runs.

## Problem Decomposition

1. What browser-related tools does the `deepagents` SDK ship with?
2. Do any recent or upcoming releases (0.6.x, 0.7.0 alphas) add browser support?
3. What workarounds exist to add browser capabilities to orchestrator runs?

## Context & Constraints

- Orchestrator uses `deepagents>=0.6,<1` (installed: `0.5.2`, latest stable: `0.6.12`, latest pre-release: `0.7.0a7`)
- VS Code chat browser tools are provided by the Copilot extension infrastructure, not by any Python library
- The orchestrator runs headlessly — no IDE UI or VS Code extension host available

## Prior Art & Known Patterns

### Built-in Harness Tools (stable, all versions)

The `deepagents` SDK ships these built-in tools:

| Tool          | Description                                               |
|---------------|-----------------------------------------------------------|
| `ls`          | List files in a directory                                 |
| `read_file`   | Read file contents (pagination + multimodal)              |
| `write_file`  | Create or overwrite a file                                |
| `edit_file`   | Exact string replacements in files                        |
| `delete`      | Delete a file or directory (≥0.7.0a1)                     |
| `glob`        | Find files matching patterns                              |
| `grep`        | Search file contents                                      |
| `execute`     | Run shell commands (sandbox backends only)                |
| `task`        | Spawn a subagent                                          |
| `write_todos` | Structured todo list                                      |

**No browser tool of any kind.**

### Talon Runtime Web Tools

The `libs/talon/` runtime (used by `deepagents-code`, the terminal-based coding agent) adds:

| Tool         | Description                              |
|-------------|------------------------------------------|
| `fetch_url`  | HTTP fetch of a URL's content            |
| `web_search` | Web search query                         |

These are HTTP-level operations — they fetch text/HTML content from URLs. They do **not** provide an interactive browser session, DOM rendering, Playwright control, screenshot capability, or visual verification.

### `run_browser_login` (deepagents-code only)

The `deepagents_code` package has a `run_browser_login` function, but this is exclusively for OAuth/PKCE authentication flows (opening a browser to authorize API keys). It has no relation to agent-controlled browser interaction.

### GitHub Repository Search

A text search for `browser` and `playwright` across the entire `langchain-ai/deepagents` repository (4,700+ commits, 151 contributors) returned **zero results** for Playwright and only auth-related hits for "browser." There is no browser middleware, no browser tool, and no browser backend in any branch or release.

### PyPI Release History

| Version Range | Browser Support |
|---------------|-----------------|
| 0.1.x – 0.5.x | None            |
| 0.6.0 – 0.6.12 (latest stable) | None |
| 0.7.0a1 – 0.7.0a7 (latest pre-release) | None |

No release notes, changelogs, or package metadata mention browser tools.

## Alternative & Creative Approaches

### Approach A: Playwright MCP Server

- **Description:** Connect a Playwright-based MCP server to the orchestrator via `langchain-mcp-adapters`. Several community MCP servers exist (e.g., `@anthropic/mcp-server-playwright`, `@nicholasanthony/browser-mcp`).
- **Rationale:** DeepAgents fully supports MCP tool loading. Any MCP server's tools can be passed to `create_deep_agent(tools=[...])`. A Playwright MCP server would expose tools like `navigate`, `screenshot`, `click`, `type` that agents could call.
- **Risk:** Requires a running MCP server process alongside the orchestrator. Browser sessions need a display (X11/Wayland on Linux, or headless Chromium). The orchestrator's node infrastructure and persona system would need to pass MCP tools through to agents. Performance impact of screenshot-heavy workflows.

### Approach B: Custom Playwright Tool

- **Description:** Write a custom LangChain `@tool` function that wraps Playwright operations (navigate, screenshot, read DOM). Pass it to `create_deep_agent(tools=[my_browser_tool])`.
- **Rationale:** DeepAgents accepts any callable as a tool. A custom tool could launch a headless Chromium instance, take screenshots, and return them as multimodal content blocks (DeepAgents supports image content blocks in tool returns).
- **Risk:** Requires managing browser lifecycle (launch, cleanup, timeouts). Screenshot data increases token usage significantly. Needs `playwright` pip dependency added to the orchestrator.

### Approach C: Shell-Based Browser via `execute` Tool

- **Description:** Use a sandbox backend's `execute` tool to run CLI browser automation commands (e.g., `playwright screenshot`, `curl`, `puppeteer` scripts).
- **Rationale:** If the orchestrator runs with a sandbox backend, agents can already execute shell commands. A pre-installed Playwright CLI could be invoked directly.
- **Risk:** Fragile — agents must construct correct CLI invocations. No structured return values. Screenshot data must be read back via `read_file`. Requires a sandbox backend (the orchestrator currently uses `LocalShellBackend`).

## Comparative Evaluation

| Criterion           | MCP Server (A)   | Custom Tool (B)  | Shell Execute (C) |
|---------------------|-------------------|------------------|--------------------|
| **Complexity**      | Medium            | Medium           | High (fragile)     |
| **Structured API**  | Yes (MCP schema)  | Yes (tool schema)| No (raw shell)     |
| **Multimodal**      | Depends on server | Yes (content blocks) | No (file-based) |
| **Maintenance**     | External dependency | In-house        | Minimal code       |
| **Orchestrator fit**| Good (MCP already used) | Good         | Poor               |
| **Risk**            | Low–Medium        | Low–Medium       | High               |
| **Time to implement** | Days            | Days             | Hours (but fragile)|

## Recommendation

**DeepAgents does not ship a browser tool, and none is planned in current releases through 0.7.0a7.** Your observation is correct: browser-enabled agent workflows currently require VS Code's Copilot extension infrastructure, which provides Playwright-powered tools via the extension host.

For the orchestrator, the most viable path to browser support would be **Approach A (Playwright MCP Server)** or **Approach B (Custom Playwright Tool)**:

- **MCP Server** is the cleaner integration path since the orchestrator already uses MCP for the ledger server. Adding a second MCP server for browser operations fits the existing architecture.
- **Custom Tool** gives tighter control and avoids an external server process, but requires more in-house code.

Neither approach is trivial — both require:
1. Headless Chromium availability in the orchestrator's environment
2. Persona system changes to expose browser tools to relevant pipeline stages
3. Token budget considerations (screenshots are large)
4. A decision about which pipeline stages need browser access (likely QA and possibly Developer)

### Proof-of-Concept Outline

1. Install `playwright` and browser binaries in the orchestrator venv
2. Write a `browser_screenshot(url: str) -> list[ContentBlock]` custom tool
3. Pass it to `create_deep_agent(tools=[browser_screenshot, ...])` in the QA stage node
4. Test with a simple "verify this page renders correctly" task

## Open Questions

- Should browser tools be available to all pipeline stages or only QA?
- What token budget impact would screenshot-heavy workflows have on orchestrator costs?
- Should the orchestrator support Playwright MCP server as a configurable option (like the ledger MCP server), or should browser tools be baked in as custom tools?
- Is headless Chromium acceptable, or do some visual verification scenarios need a visible browser?
- Would `fetch_url` (available in the Talon runtime but not in the base SDK used by the orchestrator) be a lighter-weight alternative for non-visual page content verification?

## References

- DeepAgents PyPI: https://pypi.org/project/deepagents/ (latest stable: 0.6.12, latest pre-release: 0.7.0a7)
- DeepAgents GitHub: https://github.com/langchain-ai/deepagents
- DeepAgents Tools docs: https://docs.langchain.com/oss/python/deepagents/tools
- DeepAgents Overview: https://docs.langchain.com/oss/python/deepagents/overview
- Built-in harness tools: `ls`, `read_file`, `write_file`, `edit_file`, `delete`, `glob`, `grep`, `execute`, `task`, `write_todos` — no browser tool
- Talon runtime web tools: `fetch_url`, `web_search` — HTTP-level only, not browser automation
- VS Code Copilot browser tools: Playwright-powered, provided by the extension host (not available outside VS Code)
