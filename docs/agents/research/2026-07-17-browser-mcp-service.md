# Research Report: Standalone Browser MCP Service for Agent Workflows

## Problem Statement

Can a standalone, locally-installed browser service provide browser automation capabilities to orchestrator agents — without building browser integration into the ai-insights project itself? Does such a service already exist?

## Problem Decomposition

1. Do ready-made browser MCP servers exist that can be installed locally?
2. What tools do they expose, and how mature are they?
3. How would a standalone browser MCP server integrate with the orchestrator's existing MCP architecture?
4. Are there cloud-hosted alternatives worth noting?

## Context & Constraints

- The orchestrator already connects to the ledger MCP server via `langchain-mcp-adapters` (`MultiServerMCPClient` with STDIO transport)
- `MultiServerMCPClient` natively supports multiple MCP servers — the current single-server usage is a design choice, not a library limitation
- The orchestrator runs headlessly — browser sessions would need headless Chromium
- Maintenance scope should stay narrow: prefer an external, well-maintained dependency over in-house browser code

## Prior Art & Known Patterns

### Pattern 1: `@playwright/mcp` (Microsoft)

- **Package:** [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp)
- **Repository:** [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) (35.2k stars, 68 contributors)
- **Weekly Downloads:** 6.3M
- **Version:** 0.0.78 (68 releases, actively maintained — last release 1 week ago)
- **License:** Apache-2.0
- **Requirements:** Node.js 18+

**Description:** A full-featured MCP server that provides browser automation capabilities using Playwright. Designed explicitly for LLM interaction — operates on structured accessibility snapshots rather than screenshots, avoiding the need for vision models.

**Installation:** Zero-install via npx, or Docker:
```bash
# Standalone HTTP mode (for programmatic clients like the orchestrator):
npx @playwright/mcp@latest --headless --port 8931

# Docker (headless Chromium):
docker run -d -i --rm --init --pull=always \
  -p 8931:8931 \
  mcr.microsoft.com/playwright/mcp \
  /app/cli.js --headless --browser chromium --no-sandbox --port 8931 --host 0.0.0.0
```

**MCP Client Configuration:**
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
```

Or in standalone HTTP mode:
```json
{
  "mcpServers": {
    "playwright": {
      "url": "http://localhost:8931/mcp"
    }
  }
}
```

**Core Tools (always available — 25 tools):**

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_navigate_back` | Go back in history |
| `browser_click` | Click an element |
| `browser_hover` | Hover over an element |
| `browser_type` | Type text into an element |
| `browser_press_key` | Press a keyboard key |
| `browser_fill_form` | Fill multiple form fields |
| `browser_select_option` | Select dropdown option |
| `browser_file_upload` | Upload files |
| `browser_drag` | Drag and drop between elements |
| `browser_drop` | Drop files/data onto an element |
| `browser_snapshot` | Capture accessibility snapshot (structured, LLM-friendly) |
| `browser_take_screenshot` | Take a visual screenshot |
| `browser_find` | Search the accessibility snapshot for text/regex |
| `browser_evaluate` | Evaluate JavaScript on the page |
| `browser_run_code_unsafe` | Run arbitrary Playwright code |
| `browser_console_messages` | Get console messages |
| `browser_handle_dialog` | Handle alert/confirm/prompt dialogs |
| `browser_close` | Close the page |
| `browser_resize` | Resize the viewport |
| `browser_tabs` | Tab management (new, close, select) |
| `browser_wait_for` | Wait for a condition |
| `browser_network_requests` | List network requests |
| `browser_network_request` | Show request details |

**Optional Capability Groups (opt-in via `--caps`):**

| Capability | Tools Added | Flag |
|------------|-------------|------|
| **Vision** | `browser_mouse_click_xy`, `browser_mouse_move_xy`, `browser_mouse_drag_xy`, `browser_mouse_down`, `browser_mouse_up`, `browser_mouse_wheel` | `--caps=vision` |
| **PDF** | `browser_pdf_save` | `--caps=pdf` |
| **DevTools** | `browser_annotate`, `browser_highlight`, `browser_hide_highlight`, `browser_resume`, `browser_start_tracing`, `browser_stop_tracing`, `browser_start_video`, `browser_stop_video`, `browser_video_show_actions` | `--caps=devtools` |
| **Network** | `browser_network_state_set`, `browser_route`, `browser_route_list`, `browser_unroute` | `--caps=network` |
| **Storage** | `browser_cookie_*`, `browser_localstorage_*`, `browser_sessionstorage_*`, `browser_storage_state`, `browser_set_storage_state` | `--caps=storage` |
| **Testing** | `browser_generate_locator`, `browser_verify_element_visible`, `browser_verify_text_visible`, `browser_verify_value`, `browser_verify_list_visible` | `--caps=testing` |
| **Config** | `browser_get_config` | `--caps=config` |

**Key Architecture Features:**
- **Accessibility-first:** Uses Playwright's accessibility tree, not pixel-based input. Each element gets a `ref` identifier that tools use for deterministic interaction — no vision model needed.
- **Headless mode:** `--headless` flag for server/CI environments. Full Chromium, Firefox, WebKit support.
- **Isolated sessions:** `--isolated` flag keeps browser state in memory — clean slate per session.
- **HTTP transport:** `--port` flag enables standalone HTTP mode, decoupling the server from any specific client's process lifecycle.
- **Docker support:** Official `mcr.microsoft.com/playwright/mcp` image available.
- **Programmatic API:** Can be imported as a library:
  ```js
  import { createConnection } from '@playwright/mcp';
  const connection = await createConnection({
    browser: { launchOptions: { headless: true } }
  });
  ```

**Strengths:**
- Backed by Microsoft, same team as Playwright itself
- Massive adoption (6.3M weekly downloads)
- Extremely active development (68 releases in ~12 months)
- Rich tool surface with modular capabilities
- Explicitly designed for LLM/agent consumption
- Cross-platform (Windows, macOS, Linux)
- Docker image available for containerized deployments

**Weaknesses:**
- Rapid release cadence (0.0.x) suggests API surface may still shift
- Accessibility snapshot approach trades visual fidelity for token efficiency — some CSS-only visual bugs would be invisible to the accessibility tree
- Browser process lifecycle management adds operational complexity

**Fit:** **Excellent.** This is precisely the "locally-installed browser service" pattern. It runs as a standalone MCP server, communicates over standard MCP protocol, and requires zero in-house browser code.

### Pattern 2: Browserbase (Cloud)

- **Website:** [browserbase.com](https://browserbase.com)
- **Model:** Cloud-hosted browser-as-a-service with MCP endpoint
- **Scale:** 100k+ developers, 800k weekly SDK downloads

**Description:** Cloud-hosted browser infrastructure. Provides managed browser sessions, handles auth/CAPTCHA/proxies, and exposes an MCP interface. Used by Microsoft, Clay, Amplitude, and others.

**Strengths:**
- No local browser binary management
- Handles CAPTCHAs, auth flows, anti-bot measures
- Scales to thousands of concurrent sessions
- Managed infrastructure

**Weaknesses:**
- Cloud dependency — requires internet access and API key
- Cost per session (paid service)
- Data leaves the local machine
- Overkill for development/testing workflows

**Fit:** **Low for this use case.** The orchestrator runs locally against local codebases. A cloud browser service adds latency, cost, and external dependency for scenarios that don't need it. Could be relevant for future web scraping or research agent capabilities.

### Pattern 3: Playwright CLI + SKILLS (Microsoft)

- **Repository:** [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)
- **Model:** CLI commands invoked as shell tools, exposed as agent "skills"

**Description:** The Playwright team's alternative to the MCP server approach. Instead of a persistent MCP server with structured tool schemas, agents invoke CLI commands directly. Playwright's own README notes this is "more token-efficient" because it avoids loading large tool schemas and accessibility trees into context.

**Strengths:**
- Lower token cost per interaction
- No persistent server process
- Better for coding agents that already have shell access

**Weaknesses:**
- No persistent browser state between calls (each CLI invocation is independent)
- Requires shell execution capability (the orchestrator's `deepagents` SDK has an `execute` tool, but only for sandbox backends)
- Less structured interaction — agents must construct CLI commands

**Fit:** **Poor for the orchestrator.** The orchestrator uses MCP tools, not shell commands. The lack of persistent browser state makes multi-step verification workflows impractical.

## Comparative Evaluation

| Criterion | `@playwright/mcp` | Browserbase (Cloud) | Playwright CLI |
|-----------|-------------------|---------------------|----------------|
| **Local install** | Yes (npx / Docker) | No (cloud) | Yes (npm) |
| **MCP protocol** | Yes (native) | Yes (MCP endpoint) | No (CLI) |
| **Persistent state** | Yes (session-based) | Yes (session-based) | No |
| **Headless support** | Yes | N/A (cloud) | Yes |
| **Token efficiency** | Medium (accessibility trees) | Medium | High (CLI) |
| **Maintenance burden** | Zero (external) | Zero (managed) | Low |
| **Orchestrator fit** | Excellent | Poor | Poor |
| **Maturity** | High (35k stars, 6.3M/wk) | High (commercial) | Early |
| **Cost** | Free | Paid | Free |
| **Offline capable** | Yes | No | Yes |

## Recommendation

**`@playwright/mcp` is exactly the standalone browser service the orchestrator needs.** It already exists, is production-grade, and fits the existing architecture with minimal integration work.

### Integration Path

The orchestrator's `MCPToolkit` (in `orchestrator/src/mcp_client.py`) uses `MultiServerMCPClient` from `langchain-mcp-adapters`, which already supports multiple MCP servers in a single dict. The integration would require:

1. **Config addition:** Add a `BROWSER_MCP_CMD` env var (or structured config) to `orchestrator/src/config.py` alongside the existing `mcp_server_cmd`. Default: `["npx", "@playwright/mcp@latest", "--headless"]`.

2. **MCPToolkit multi-server support:** Extend `mcp_client.py` to open sessions for both the `"ledger"` and `"browser"` servers, load tools from both, and merge them into a single tool list. The `MultiServerMCPClient` already accepts:
   ```python
   {
       "ledger": {"command": "node", "args": [...], "transport": "stdio"},
       "browser": {"command": "npx", "args": ["@playwright/mcp@latest", "--headless"], "transport": "stdio"}
   }
   ```

3. **Per-stage tool filtering:** Currently all stages receive the same `mcp_tools` list. Browser tools should likely only be available to the Developer and QA stages. The existing tool-wrapper layer (`inject_project_path`, `restrict_to_wp`) already skips tools that don't have matching parameters, so browser tools would pass through safely — but explicit stage filtering would be cleaner.

4. **Optional enablement:** Make browser MCP a feature flag (env var or config) so the orchestrator doesn't require Node.js + Playwright browsers to be installed for users who don't need browser verification. The preflight check could validate browser availability when the flag is enabled.

### What Would NOT Change

- No new Python dependencies in the orchestrator
- No browser code in the ai-insights project
- No changes to the ledger MCP server
- No changes to persona templates (beyond optionally documenting browser tool availability)
- The browser service is an external process managed by `langchain-mcp-adapters`

### Proof-of-Concept Outline

1. Install Playwright browsers: `npx playwright install chromium`
2. Verify standalone server works: `npx @playwright/mcp@latest --headless --port 8931`
3. Add `"browser"` key to `MCPToolkit._client` dict in `mcp_client.py`
4. Open and merge tools from both sessions
5. Run a QA stage with a task like "navigate to localhost:3000 and verify the dashboard renders"

## Open Questions

- **Which stages need browser tools?** Developer (for verifying local dev servers), QA (for visual verification), or all stages?
- **Headless-only or headed option?** On macOS with a display, headed mode could be useful for debugging orchestrator runs. The `--headless` flag could be configurable.
- **Feature flag design:** Should browser MCP be a boolean toggle (`ENABLE_BROWSER_MCP=true`), or a full command override (`BROWSER_MCP_CMD=...`)?
- **Token impact:** Accessibility snapshots can be large for complex pages. Should the orchestrator configure `--snapshot-mode=none` and rely on screenshots instead, or vice versa?
- **Browser lifecycle:** Should the browser MCP server be started once per orchestrator run (shared across all stages), or per-stage? The `--isolated` flag could reset state between stages.

## References

- `@playwright/mcp` npm: https://www.npmjs.com/package/@playwright/mcp (v0.0.78, 6.3M weekly downloads)
- `@playwright/mcp` GitHub: https://github.com/microsoft/playwright-mcp (35.2k stars, Apache-2.0)
- Playwright CLI (alternative): https://github.com/microsoft/playwright-cli
- Browserbase (cloud alternative): https://browserbase.com
- `langchain-mcp-adapters` (orchestrator MCP client): https://github.com/langchain-ai/langchain-mcp-adapters
- Orchestrator MCP client: `orchestrator/src/mcp_client.py` — uses `MultiServerMCPClient` with STDIO transport
- Orchestrator config: `orchestrator/src/config.py` — `mcp_server_cmd` hardcoded to ledger server
- Previous research: `docs/agents/research/2026-07-15-deepagents-browser-tool.md` — confirmed DeepAgents SDK has no browser tool
