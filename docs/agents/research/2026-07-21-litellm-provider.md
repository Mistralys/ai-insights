# Research Report

## Problem Statement

Evaluate the feasibility of using [LiteLLM](https://www.litellm.ai/) as the LLM provider layer for the orchestrator agents, instead of (or in addition to) the current direct Anthropic SDK integration.

## Problem Decomposition

1. **Integration point identification** — Where in the orchestrator stack would LiteLLM be introduced?
2. **LangChain compatibility** — Does LiteLLM provide a LangChain `BaseChatModel` that is compatible with the Deep Agents framework?
3. **Feature parity** — Does `ChatLiteLLM` support tool calling, streaming, async, and prompt caching — the features the orchestrator relies on?
4. **Configuration impact** — What changes would be needed to model slug configuration, API key management, and dependencies?
5. **Value proposition** — What does LiteLLM add beyond the existing multi-provider architecture?

## Context & Constraints

### Current Architecture (4 abstraction layers)

```
┌─────────────────────────────────────────────┐
│  Orchestrator (src/nodes/__init__.py)       │
│  → passes model slug string to Deep Agents  │
├─────────────────────────────────────────────┤
│  Deep Agents (deepagents/_models.py)        │
│  → resolve_model() calls init_chat_model()  │
│  → applies ProviderProfile registrations    │
├─────────────────────────────────────────────┤
│  LangChain (langchain.chat_models)          │
│  → init_chat_model() maps slug → SDK class  │
│  → ChatAnthropic / ChatGoogleGenerativeAI   │
├─────────────────────────────────────────────┤
│  Provider SDKs (anthropic / google-genai)   │
│  → actual HTTP calls to provider APIs       │
└─────────────────────────────────────────────┘
```

- The orchestrator **never directly creates LLM clients**. It passes model slug strings (e.g. `"claude-sonnet-4-6"`) to `create_deep_agent(model=...)`.
- Deep Agents' `resolve_model()` accepts `str | BaseChatModel` — it can receive either a slug string (resolved via `init_chat_model`) or a **pre-instantiated** `BaseChatModel` instance (passed through unchanged).
- Model slugs are configured in persona YAML metadata (`_shared.yaml` default + per-persona overrides).
- Multi-provider support already exists structurally: API key validation checks `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY` based on slug prefix. Only Anthropic is actively used.
- Current dependencies: `langchain-anthropic>=0.3.10` (active), `langchain-google-genai>=2.0` (defined but commented out).

### Hard Constraints

- Must produce a `BaseChatModel` instance that Deep Agents can consume.
- Must support **tool calling** (MCP tools are bound to agents via `tools=wrapped_tools`).
- Must support **async streaming** (the orchestrator uses `agent.astream()` with event accumulation).
- Must not require changes to the Deep Agents package itself.

## Prior Art & Known Patterns

### Pattern 1: Direct Provider SDKs via LangChain (Current Approach)

- **Description:** Each provider has a dedicated LangChain package (`langchain-anthropic`, `langchain-google-genai`) that wraps the provider's native SDK. `init_chat_model()` maps model slugs to the correct package.
- **Where used:** Current orchestrator architecture; the standard LangChain approach.
- **Strengths:** Minimal abstraction overhead; direct access to provider-specific features (prompt caching, extended thinking); each package is maintained by or in close collaboration with the provider; `init_chat_model()` provides a unified factory.
- **Weaknesses:** Adding a new provider requires adding its LangChain package as a dependency and potentially updating API key validation logic; no built-in fallback/retry across providers; no unified cost tracking.
- **Fit:** Already in production. Works well for the current Anthropic-only deployment.

### Pattern 2: LiteLLM via `langchain-litellm` Package

- **Description:** The [`langchain-litellm`](https://pypi.org/project/langchain-litellm/) package provides `ChatLiteLLM` and `ChatLiteLLMRouter` — LangChain `BaseChatModel` implementations that route all calls through LiteLLM's unified API layer. LiteLLM translates between the OpenAI-compatible format and 100+ provider-specific APIs.
- **Where used:** Listed as an official LangChain integration. Used by companies like Netflix for multi-provider LLM access.
- **Strengths:**
  - ✅ Extends `BaseChatModel` — directly compatible with Deep Agents' `resolve_model()` accepting pre-built model instances.
  - ✅ Supports tool calling, structured output, streaming, async, image input, token usage tracking.
  - ✅ Unified model naming across providers (`anthropic/claude-sonnet-4-6`, `openai/gpt-5`, `vertex_ai/gemini-2.5-flash`).
  - ✅ Built-in retry/fallback logic via `ChatLiteLLMRouter` (define multiple deployments for the same logical model).
  - ✅ Cost tracking, rate limiting, observability callbacks (Langfuse, MLflow, etc.).
  - ✅ Single dependency replaces per-provider packages.
  - ✅ Provider API keys are read from standard environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) — no key management changes needed.
- **Weaknesses:**
  - ⚠️ Additional abstraction layer — LiteLLM sits between LangChain and the provider SDK, adding latency (negligible for network-bound LLM calls, but present).
  - ⚠️ Provider-specific features may lag or be unavailable (e.g., Anthropic's prompt caching, extended thinking) — LiteLLM must explicitly support each feature.
  - ⚠️ Debugging becomes harder: errors pass through LiteLLM's translation layer before reaching the orchestrator.
  - ⚠️ `litellm` is a large transitive dependency (~50+ MB installed) that bundles support for all providers.
  - ⚠️ Not usable via `init_chat_model()` string resolution — requires pre-instantiating `ChatLiteLLM` and passing the object to Deep Agents.
- **Fit:** High compatibility. The `BaseChatModel` contract is satisfied. All required features (tool calling, async streaming) are supported.

### Pattern 3: LiteLLM Proxy Server (Gateway Mode)

- **Description:** LiteLLM can run as a standalone proxy server that exposes an OpenAI-compatible API endpoint. Clients connect to the proxy, which routes to the configured backend providers.
- **Where used:** Enterprise deployments where a centralized LLM gateway is needed for auth, rate limiting, and cost attribution across teams.
- **Strengths:** Centralised configuration; virtual keys; spend tracking per project; model aliasing; load balancing.
- **Weaknesses:** Requires running and maintaining an additional service; adds network hop latency; overkill for a single-developer tool; the orchestrator would need to use an OpenAI-compatible client pointing at localhost.
- **Fit:** Low for the orchestrator's use case (single-user developer tool). Better suited for team/enterprise deployments.

## Alternative & Creative Approaches

### Hybrid: LiteLLM for Non-Primary Providers Only

- **Approach:** Keep `langchain-anthropic` for Claude models (primary provider) and use `ChatLiteLLM` only when the model slug resolves to a non-Anthropic provider. This preserves direct SDK access for the primary path while enabling easy provider switching for experimentation.
- **Rationale:** Avoids adding abstraction overhead to the hot path (95%+ of calls go to Anthropic). LiteLLM's value — unified multi-provider access — is only needed when actually switching providers.
- **Risk:** Two code paths for model resolution increases complexity. Must ensure consistent behaviour (tool calling, streaming) across both paths.

### Deep Agents ProviderProfile Registration

- **Approach:** Register a custom `ProviderProfile` in Deep Agents for LiteLLM-prefixed model strings (e.g. `"litellm:openai/gpt-5"`), so the existing string-based resolution flow works without pre-instantiating models.
- **Rationale:** Keeps the orchestrator's model resolution uniform (all string-based, no special-casing).
- **Risk:** Requires understanding Deep Agents' `ProviderProfile` internals. The profile would need to instantiate `ChatLiteLLM` in its `init_kwargs_factory`. Untested integration path.

## Comparative Evaluation

| Criterion | Direct SDKs (Current) | ChatLiteLLM (SDK) | LiteLLM Proxy | Hybrid |
|---|---|---|---|---|
| **Implementation effort** | 0 (status quo) | Low (1–2 files) | Medium (new service) | Medium (conditional logic) |
| **Provider breadth** | 2 (Anthropic + Google) | 100+ | 100+ | 100+ for non-primary |
| **Feature parity** | Full (direct SDK) | High (may lag on niche features) | High | Full for primary, high for others |
| **Debugging clarity** | Best | Good (extra layer) | Harder (network + proxy) | Mixed |
| **Dependency footprint** | 1 package per provider | 1 package (`langchain-litellm` + `litellm`) | External service | 1 per-provider + litellm |
| **Prompt caching support** | Native | Supported via LiteLLM (verified) | Supported | Native for Anthropic |
| **Fallback/retry** | None built-in | `ChatLiteLLMRouter` | Built-in | Partial |
| **Cost tracking** | Manual | Built-in callbacks | Full dashboard | Partial |
| **Risk** | Low | Low–Medium | Medium | Medium |

## Recommendation

**LiteLLM integration is highly feasible and low-risk.** The architecture is already set up for it.

### Recommended Approach: `ChatLiteLLM` as an Optional Provider

1. **Add `langchain-litellm` as an optional dependency** in `pyproject.toml` (similar to the existing `google` extra):
   ```toml
   [project.optional-dependencies]
   litellm = ["langchain-litellm>=0.2"]
   ```

2. **Pre-instantiate `ChatLiteLLM` in the orchestrator's model resolution** when the model slug uses a LiteLLM prefix (e.g., `"litellm/openai/gpt-5"` or a configuration flag). Since `create_deep_agent()` accepts `BaseChatModel` directly, pass the `ChatLiteLLM` instance instead of a string:
   ```python
   # Pseudocode — not production-ready
   if use_litellm:
       from langchain_litellm import ChatLiteLLM
       model = ChatLiteLLM(model=resolved_model_slug)
   else:
       model = resolved_model_slug  # string, resolved by Deep Agents
   ```

3. **No Deep Agents changes required.** The `resolve_model(model: str | BaseChatModel)` function passes `BaseChatModel` instances through unchanged.

4. **No persona YAML changes required** for the basic case — model slugs like `"claude-sonnet-4-6"` work with LiteLLM as-is (LiteLLM maps them to `anthropic/claude-sonnet-4-6` automatically). For explicit provider routing, use LiteLLM's `provider/model` format.

5. **API key management unchanged** — LiteLLM reads from the same standard environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`).

### Why Not Replace the Current Setup Entirely?

- The current direct-SDK approach works well for Anthropic-only usage.
- LiteLLM adds a transitive dependency layer that is unnecessary if you only use one provider.
- Provider-specific features (Anthropic prompt caching) are better supported via the direct SDK.

### When LiteLLM Becomes Compelling

- You want to **experiment with non-Anthropic models** (OpenAI, Gemini, open-source via OpenRouter/Together) without adding per-provider LangChain packages.
- You want **fallback routing** (e.g., try Claude first, fall back to GPT on rate limit).
- You want **unified cost tracking** across providers.
- You want to use **local models** (Ollama, vLLM) for development/testing without paying API costs.

### Proof-of-Concept Outline

1. Install: `pip install langchain-litellm`
2. In `orchestrator/src/nodes/__init__.py`, before the `create_deep_agent()` call, conditionally wrap the model slug in a `ChatLiteLLM` instance (gated by an env var like `USE_LITELLM=1`).
3. Run a single pipeline stage (e.g., Planner) against a plan document.
4. Verify: tool calls work, streaming works, output is identical to direct-SDK path.
5. Measure: compare latency and token usage reporting between both paths.

## Open Questions

- **Prompt caching:** LiteLLM documents support for Anthropic prompt caching, but does the `langchain-litellm` LangChain wrapper preserve the cache-control headers that Deep Agents' prompt-caching middleware injects? This needs empirical verification.
- **Extended thinking:** If/when the orchestrator uses Anthropic's extended thinking feature, does LiteLLM pass through the `thinking` parameter correctly?
- **Deep Agents middleware compatibility:** Deep Agents applies middleware (prompt caching, path normalization) that may inject provider-specific message structures. These must pass through LiteLLM's translation layer without corruption.
- **`init_chat_model` registration:** LangChain's `init_chat_model` may gain native LiteLLM support in the future (via the `langchain-litellm` package registering itself). This would allow string-based resolution without pre-instantiation, simplifying the integration further.

## References

- [LiteLLM Documentation](https://docs.litellm.ai/)
- [LiteLLM GitHub](https://github.com/BerriAI/litellm) — 52K+ stars
- [langchain-litellm package](https://pypi.org/project/langchain-litellm/) — official LangChain integration
- [LangChain ChatLiteLLM docs](https://docs.langchain.com/oss/python/integrations/chat/litellm) — integration reference with feature matrix
- [LiteLLM supported providers](https://docs.litellm.ai/docs/providers) — 100+ providers listed
- Deep Agents `resolve_model()` — accepts `str | BaseChatModel`, enabling pre-instantiated model injection
- Orchestrator `create_deep_agent()` call — `orchestrator/src/nodes/__init__.py` L910
