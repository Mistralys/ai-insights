# Research Brief

## Scope Sketch

- Orchestrator provider config — `orchestrator/src/config.py` — modification (extend `_validate_model_api_keys`, add a new provider-profile registration step).
- Orchestrator dependency manifest — `orchestrator/pyproject.toml`, `orchestrator/requirements.txt` — modification (new `openai` extra).
- Orchestrator docs — `orchestrator/README.md`, `orchestrator/.env.example`, `orchestrator/changelog.md`, `orchestrator/docs/agents/project-manifest/{README,tech-stack,constraints,decisions}.md` — modification.
- Orchestrator tests — `orchestrator/tests/test_config.py`, `orchestrator/tests/test_deep_agent_integration.py`, `orchestrator/tests/test_integration.py` — modification (new test classes / extended live-model helper).
- Root-level pre-flight tooling — `scripts/preflight-orchestrator.js`, new `scripts/lib/preflight-checks.js` — modification + extraction (adds `OPENAI_API_KEY`/`OPENAI_API_BASE` awareness to the existing Anthropic/Google checks).
- Root-level tests — new `scripts/tests/preflight-checks.test.js` — new file.
- Root workspace docs — no change needed (`AGENTS.md`/root `README.md` do not enumerate providers by name; confirmed via grep, see Constraints below).
- Persona/model-registry subsystem (`personas/model-registry/`) — **not touched**; see Out of Scope in the plan.

## Area: Orchestrator Provider Resolution (`orchestrator/src/config.py`, `orchestrator/src/nodes/__init__.py`)

### Verified References

- `orchestrator/src/config.py` (L204–L245): `_validate_model_api_keys(stage_models)` — computes `has_anthropic` / `has_google` from `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`, raises `OSError` when neither is set, then loops `stage_models.items()` matching `model_slug.lower().startswith("claude")` / `.startswith("gemini")` / `.startswith("models/gemini")` to build a `missing` list, raising a combined `OSError` if any stage is missing its provider's key.
- `orchestrator/src/config.py` (L349–L354): `load_config()` calls `_validate_model_api_keys(stage_models)` immediately after resolving `stage_models` via `extract_persona_model_slugs()` — this is the single call site where a new provider-profile-registration step must be added.
- `orchestrator/src/nodes/__init__.py` (L850–L928): `create_stage_node()`'s inner `node_fn` resolves `resolved_model = _app_config.resolve_model_for_stage(stage)` and passes it straight through as `create_deep_agent(model=resolved_model, ...)` — a bare string, never wrapped or inspected. **No change needed here**: this call site already forwards whatever string is configured, including a `provider:model` spec.
- `orchestrator/src/nodes/__init__.py` (L63–L68, L103–L106): `_is_fatal_error` / `_is_retryable_api_error` detect provider errors purely via `getattr(exc, "status_code", None)` duck-typing, and their docstrings already explicitly name "Anthropic, OpenAI, Google" as supported SDKs. **No change needed** — already provider-agnostic.
- `orchestrator/pyproject.toml` (L1–L26): `[project.optional-dependencies]` currently defines only `anthropic = ["langchain-anthropic>=0.3.10"]` and `google = ["langchain-google-genai>=2.0"]`; core `dependencies` already pins `deepagents>=0.6,<1` (a hard, non-optional dependency) and `langchain-core>=1.2.22`.
- `orchestrator/requirements.txt` (L1–L20): mirrors `pyproject.toml` extras with a comment-gated block per provider (`# Optional: Anthropic provider` / `# Optional: Google provider`); its header comment states "This file mirrors the version pins from pyproject.toml."
- Installed versions verified in the project's own `.venv` (Python 3.14, this workspace): `deepagents==0.6.12`, `langchain==1.3.13`, `langchain-core==1.6.2`. `langchain-anthropic==1.4.8`, `langchain-google-genai==4.2.7` are the currently installed provider packages.
- **[added by: Plan Auditor, unverified]** `orchestrator/src/config.py` (grep, cycle-2 audit): `_validate_model_api_keys` confirmed present at L202 (matches the plan's "rewrite" framing); `_register_provider_profiles` returns zero matches anywhere in the file (matches the plan's "newly added"/"define the new" framing — confirms this function does not yet exist). `orchestrator/pyproject.toml` L3 still pins `version = "1.4.0"` with only `anthropic`/`google` extras present; `orchestrator/docs/agents/project-manifest/constraints.md` L692 confirms `### 28.` is still the highest-numbered entry, supporting the plan's claim that new entries #29–#30 can append without renumbering.

### Established Patterns

- Lazy, function-local imports for optional/heavy packages — `orchestrator/src/config.py` L350 (`from src.utils.persona_models import extract_persona_model_slugs` inside `load_config()`) and `orchestrator/src/nodes/__init__.py` L833 (`from deepagents import create_deep_agent` inside `node_fn`). A new provider-profile-registration helper should follow the same local-import convention.
- Provider detection is entirely prefix-based on the model slug string (`"claude"`, `"gemini"`, `"models/gemini"`), never on an explicit `provider:` field — established in `_validate_model_api_keys` (`orchestrator/src/config.py` L204–L245).
- `Config` dataclass fields are populated exclusively inside `load_config()`; no provider-specific fields exist on `Config` today (`orchestrator/src/config.py` L268–L320).
- **[added by: Refiner] [arch]** `orchestrator/src/utils/path_middleware.py` (L53): `class PathNormalizationMiddleware(AgentMiddleware)` — confirmed the only existing "subclass a base class to plug into an extension point" precedent in the orchestrator codebase, and `AgentMiddleware` (from `langchain.agents.middleware.types`) is a third-party base class, not in-house. A workspace-wide grep of `orchestrator/src/**` for `abc.ABC|ABCMeta|abstractmethod` returned zero matches — confirms the plan's claim that `LLMProvider` would be the first in-house `abc.ABC` in the orchestrator codebase.
- **[added by: Refiner] [arch]** `@dataclass` usage confirmed at three sites: `orchestrator/src/config.py` (L253, plain `@dataclass` on `Config`), `orchestrator/src/utils/plan_parser.py` (L30, plain `@dataclass`), `orchestrator/src/utils/tool_wrappers.py` (L130, L139, L150 — `@dataclass(frozen=True, slots=True)` on three separate wrapper-context classes) — supports the plan's Pattern Alignment claim that the codebase already reaches for a class over a plain function/dict when a hidden dispatch-by-string would otherwise result.

### Structural Observations

- `_validate_model_api_keys` builds its `missing` list with one `elif` branch per provider prefix (L229–L239). A third prefix branch (`openai:`) fits this existing shape directly — no restructuring needed, this is pure extension.
- No existing mechanism registers or overrides `deepagents` `ProviderProfile`s anywhere in the orchestrator; this is genuinely new functionality, not a reshape of something existing.

### Constraints

- **Model spec convention (verified via live interpreter, not documentation alone):** `deepagents.create_deep_agent(model=str)` forwards the string unchanged to `deepagents._models.resolve_model()`, which calls `langchain.chat_models.init_chat_model(model, **apply_provider_profile(model))`. Verified live: `init_chat_model("openai:gpt-4o-mini")` under `OPENAI_API_KEY`/`OPENAI_API_BASE` env vars returns a `ChatOpenAI` instance with `openai_api_base` and `model_name` correctly resolved from those two env vars — no orchestrator code is required to construct the chat model manually; the model-slug convention for this provider is `openai:<model-name>` (langchain's native `provider:model` syntax), not a bespoke prefix.
- **`OPENAI_API_BASE` is the exact env var name, not `OPENAI_BASE_URL`** — verified by reading `langchain_openai.chat_models.base.validate_environment()` (installed version `langchain-openai==1.6.0`, the latest version pip resolves against this workspace's `langchain==1.3.13` / `langchain-core==1.6.2`): it calls `_resolve_gateway_config(base_url_env="OPENAI_API_BASE", api_key_env="OPENAI_API_KEY", ...)`. If a future `langchain-openai` release renames this env var, LiteLLM routing would silently stop working (see Risks in the plan).
- **Responses-API pitfall (critical, verified live):** `deepagents` ships a built-in `ProviderProfile` for the `"openai"` provider key (`deepagents/profiles/provider/_openai.py`, installed `deepagents==0.6.12`) that unconditionally sets `init_kwargs={"use_responses_api": True}` for every `openai:*` model spec — because native OpenAI defaults to the Responses API. LiteLLM proxies commonly implement only the Chat Completions API; sending Responses-API-shaped requests through such a proxy will fail. `deepagents` explicitly documents the escape hatch in its own docstring (`create_deep_agent`'s `model` parameter docs): call `register_provider_profile("openai", ProviderProfile(init_kwargs={"use_responses_api": False}))` to override. Verified this call merges additively (override wins per-key) on top of the built-in profile via `deepagents/profiles/provider/provider_profiles.py`'s `_merge_provider_profiles()`.
- `ProviderProfile` and `register_provider_profile` are both re-exported from the top-level `deepagents` package (`deepagents/__init__.py` `__all__` list) — importable as `from deepagents import ProviderProfile, register_provider_profile`.
- Missing `langchain-openai` produces a clear built-in `ImportError` from `init_chat_model` ("Initializing ChatOpenAI requires the langchain-openai package...") — verified live. This matches the existing pattern for Anthropic/Google, where `_validate_model_api_keys` checks only for the API key, not package installation; the plan follows the same minimal-validation philosophy rather than adding new install-detection code.
- `personas/model-registry/local.json` / `default.json` entries feed `stage_models` directly via their `slug` field (`orchestrator/src/utils/persona_models.py` L169: `e["id"]: e["slug"]`) — a model-registry entry with `slug: "openai:gpt-4.1"` would be usable by the orchestrator today with zero further code changes, but adding such an entry is a personas-subsystem concern (GUI, `cc_model` mapping for Claude Code) explicitly out of scope for this plan (see Out of Scope).

## Area: Orchestrator Documentation & Constraints (`orchestrator/docs/agents/project-manifest/`, `orchestrator/README.md`)

### Verified References

- `orchestrator/docs/agents/project-manifest/tech-stack.md` (L12, L27–L29): package-manager extras list (`dev`, `anthropic`) and the "Core Dependencies" table listing `langchain-anthropic` / `langchain-google-genai` as the only LLM provider packages.
- `orchestrator/docs/agents/project-manifest/README.md` (L22, L58): install command example (`pip install -e ".[dev,anthropic]"`) and an LLM-providers row in a components table.
- `orchestrator/docs/agents/project-manifest/constraints.md` (L1–L34, L325–L353, L692–L701): document header explains the numbered constraint-entry format; `## Contents` (L7–L18) lists section headers only (not individual numbered constraints), so a new section can be appended without renumbering; constraint **#19** ("Model Selection Is Persona-Driven — No MODEL_NAME", under "## Model Configuration Constraints") is the closest existing analogue; constraint **#28** is the highest-numbered entry currently in the file, confirming constraints are appended sequentially and never renumbered (a lesson independently recorded in this agent's own memory about a sibling manifest).
- `orchestrator/docs/agents/project-manifest/decisions.md` (L1–L60): documents two prior "Rejected"/"Not Adopted" architectural decisions in a `**Decision:**` / `**Why it was rejected:**` / code-example format; this is an "Adopted" (not rejected) decision, but the file's structure accommodates either polarity.
- `orchestrator/docs/agents/project-manifest/api-surface.md` (L234–L235) and `data-flows.md`: neither documents provider-specific behavior or enumerates individual providers — grepped for `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`provider`/`model_slug`/`create_deep_agent`, only two incidental `Config` dataclass field-list hits in `api-surface.md`, none in `data-flows.md`. **No changes needed in either file** — the `Config` dataclass gains no new field in this plan.
- `orchestrator/README.md` (L27–L150, L455–L458, L558–L566): Prerequisites table ("API key — Anthropic or Google AI Studio"), Installation section (`pip install -e ".[anthropic]"` / `".[google]"`), Configuration section + Environment Variable Reference table, Troubleshooting entry `### No LLM provider API key found`, and a `@pytest.mark.live` note describing `LIVE_TEST_MODEL` provider auto-detection.
- `orchestrator/changelog.md` (L1–L6): most recent entry is `## v1.4.0 - Multi-Store Resolution`; `orchestrator/pyproject.toml` L3 pins `version = "1.4.0"` — confirms changelog/package version are currently in sync (per the workspace's `check-version-sync.js` convention referenced in the root AGENTS.md).

### Established Patterns

- Constraints are appended as new, sequentially-numbered entries at the end of the file under a new or existing `##` section — never renumbered in place (matches the file's own "Contents" ToC design and this agent's prior memory note about renumbering risk on a sibling manifest).
- `decisions.md` entries pair a one-line **Decision** with a **Why** and a ❌/✅ code-comparison block.
- Changelog entries use flat, category-prefixed bullets (`Nodes:`, `Utils:`, `Tests:`, `Docs:`, etc.), no `### Added/Changed` sub-headers — confirmed by every existing `orchestrator/changelog.md` entry.

### Structural Observations

New code and doc content only — no existing structure in this area needs reshaping.

### Constraints

- Per the root `AGENTS.md` Manifest Maintenance Rules ("Add/remove dependency → `tech-stack.md`"), `tech-stack.md` must be updated for the new `langchain-openai` dependency.
- Per the workspace's Changelog Convention (root `AGENTS.md`), `orchestrator/changelog.md` is updated on its own SemVer track (not Git-tagged); the root `changelog.md` is only touched at release time, not part of this plan's scope.

## Area: Orchestrator Tests (`orchestrator/tests/`)

### Verified References

- `orchestrator/tests/test_config.py` (L1–L26): imports `load_config` and manifest constants from `src.config`; `_BASE_ENV = {"ANTHROPIC_API_KEY": "sk-test"}` and `_load(extra_env)` helper (L219–L230) patches `os.environ` with `clear=True` before calling `load_config()`.
- `orchestrator/tests/test_config.py` (L388–L410, class `TestApiKeyValidation`, L385–L451): existing tests patch `src.utils.persona_models.extract_persona_model_slugs` to inject a fake `stage_models` dict, then assert `load_config()` raises `OSError` with a specific `match=` substring (e.g., `test_missing_google_key_when_google_slug_used`). This is the exact pattern to mirror for new OpenAI-specific test cases.
- `orchestrator/tests/test_deep_agent_integration.py` (L908–L950): `_resolve_live_model()` — checks `ANTHROPIC_API_KEY` then `GOOGLE_API_KEY`, `pytest.skip()`s if neither is set, imports the matching LangChain provider package (skip if not installed), and returns a constructed chat-model instance using `os.environ.get("LIVE_TEST_MODEL", <provider-default>)`.
- `orchestrator/tests/test_integration.py` (L858–L869): `test_live_happy_path_with_real_mcp` is an intentionally-skeletal `@pytest.mark.live` test whose only real logic is the `pytest.skip()` guard checking `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`.
- `orchestrator/README.md` (L558–L566): documents the `LIVE_TEST_MODEL` behavior and its provider-matching constraint — must stay in sync with any change to `_resolve_live_model()`.

### Established Patterns

- Provider-specific test logic always follows the same three-provider-agnostic shape: check env var → skip if absent → import provider package (skip if missing) → construct model with `os.environ.get("LIVE_TEST_MODEL", <default-slug>)`.
- `TestApiKeyValidation` tests inject fully-fabricated `stage_models` dicts via `unittest.mock.patch` on `extract_persona_model_slugs`, never relying on real persona YAML content, to isolate the validation logic under test.

### Structural Observations

New code only in this area — the existing test helpers/classes are extended by adding new branches/cases, not reshaped.

### Constraints

- Per `orchestrator/README.md` (L562–L566), any new `LIVE_TEST_MODEL` fallback behavior must be documented alongside the existing Anthropic/Google description, including the same "value must match the active provider" warning.

## Area: Root-Level Pre-Flight Tooling (`scripts/preflight-orchestrator.js`, `scripts/cli.js`, `scripts/lib/`)

### Verified References

- `scripts/preflight-orchestrator.js` (L96–L110): `parseEnvVars()` — reads the module-level `ENV_FILE` constant directly (`orchestrator/.env`), parses `KEY=value` lines, returns a plain object. No parameter, no export.
- `scripts/preflight-orchestrator.js` (L138–L160): `checkEnv()` — reads `ENV_FILE` directly via `fs.existsSync`, calls `parseEnvVars()`, and raises a fail result when `!vars.ANTHROPIC_API_KEY && !vars.GOOGLE_API_KEY`. No parameter, no export.
- `scripts/preflight-orchestrator.js` (L228–L285): `checkAnthropicKey(apiKey)` (GET `https://api.anthropic.com/v1/models` with `x-api-key` header) and `checkGoogleKey(apiKey)` (GET `https://generativelanguage.googleapis.com/v1beta/models?key=...`) — both `async function`, neither exported.
- `scripts/preflight-orchestrator.js` (L291–L320, `main()`): builds `pending` array conditionally per-key (`if (vars.ANTHROPIC_API_KEY) pending.push(checkAnthropicKey(...))` / same for Google), then awaits `Promise.all(pending)`.
- `scripts/preflight-orchestrator.js` (L1–L46, L359–L361): ESM script (`import path from 'path'`, etc.), **no `export` statements anywhere in the file**, and `main().catch(...)` is invoked unconditionally at module scope (no `if (import.meta.url === ...)` guard) — importing this file for unit testing would immediately execute `main()` and call `process.exit()`.
- `scripts/cli.js` (L192–L260): the `orchestrator` setup component's `run(args)` reads `--provider` via `const prov = (pIdx !== -1 && args[pIdx + 1]) ? args[pIdx + 1] : 'anthropic'` and builds `const extras = [prov, 'dev', ...]` → `pip install -e ".[${extras.join(',')}]"`. **Confirmed fully generic** — no hardcoded provider list, no validation against a fixed set of allowed values. Grepped the whole file for `Anthropic|Google|provider`: only these three lines match, none is a provider allow-list.
- `scripts/lib/store-commands.js` (L47–L564): the established precedent for the "pure, testable lib module" pattern — every function is `export function ...`, no top-level side-effecting `main()`/CLI invocation in the file at all; `scripts/cli.js`'s `cmdStore()` imports and calls these functions. `scripts/tests/store-commands.test.js` exercises them directly via ESM `import`.
- `scripts/lib/health-checks.js`: already imported into `scripts/preflight-orchestrator.js` (`import { HEALTH_CHECKS } from './lib/health-checks.js'`) — confirms `scripts/lib/` is the established home for logic shared with or extracted for `scripts/preflight-orchestrator.js`.
- `scripts/tests/` directory listing: 11 existing `*.test.js` files, all covering `scripts/lib/*.js` modules (or CJS modules under `personas/plugins/` via the `createRequire` bridge) — **no test file exists for `scripts/preflight-orchestrator.js` today**, confirming zero pre-existing coverage for any of its check functions.
- `scripts/tests/README.md`: documents the CJS/ESM bridge pattern (only needed for `personas/plugins/` CJS modules) and confirms plain ESM `import` is used for everything else; tests run via `npx vitest run scripts/tests/`, included automatically by the root `vitest.config.ts` glob `scripts/tests/**/*.test.{js,ts}`.

### Established Patterns

- Pure, side-effect-free logic lives in `scripts/lib/*.js` as named ESM exports; thin CLI orchestration (argument parsing, `main()`, `process.exit()`) lives in the top-level `scripts/*.js` file, which imports from `scripts/lib/`. Established by `store-commands.js` (fully in `lib/`) + `cli.js` (`cmdStore()` calling into it), and by `preflight-orchestrator.js` already importing `HEALTH_CHECKS` from `scripts/lib/health-checks.js`.
- Root-level test files import lib modules directly with plain ESM `import`, no mocking framework beyond Vitest's `vi.fn()`/`vi.spyOn()` where needed (per `store-commands.test.js`, which pre-seeds temp-dir fixtures via explicit `configPath` parameters rather than mocking `fs`).

### Structural Observations

- `scripts/preflight-orchestrator.js`'s check functions (`parseEnvVars`, `checkEnv`, `checkAnthropicKey`, `checkGoogleKey`) are private, unexported, and depend on the module-level `ENV_FILE` constant rather than an explicit parameter — this is the same "not designed for import-based testing" gap already solved elsewhere in `scripts/` via the `scripts/lib/` extraction pattern (`store-commands.js`). Since this plan adds a fifth function (`checkOpenAIKey`) to this exact family and needs it unit-tested, the family is a natural, bounded extraction candidate — not a full-file rewrite (`checkVenv`, `checkMcpDist`, `checkNoConflict`, `checkPlanFile`, `parseArgs`, and `main()` are unaffected and stay in `scripts/preflight-orchestrator.js`).

### Constraints

- Any extracted function must accept its file path as an explicit parameter (no hidden module-level constant) to remain testable with temp-dir fixtures, mirroring `store-commands.js`'s `configPath` parameter convention.
- `scripts/cli.js` requires **no code change** — confirmed generic pass-through for `--provider openai` once the `openai` extra exists in `orchestrator/pyproject.toml`.

## Area: Persona Model Registry (`personas/model-registry/`) — Confirmed Out of Scope

### Verified References

- `personas/model-registry/README.md`: documents the `default.json`/`local.json`/`assignments.json` three-file system, the four-field entry schema (`id`, `name`, `slug`, `cc_model`), and the `inherit` sentinel. Entirely a personas-subsystem concern (GUI-driven, feeds VS Code/Claude Code frontmatter as well as the orchestrator).
- `orchestrator/src/utils/persona_models.py` (L149–L170, `_read_uuid_to_slug_map`): confirms the orchestrator reads `local.json`'s `slug` field directly and would already accept an `openai:<model>`-shaped `slug` value with zero further orchestrator code changes.

### Structural Observations

Not touched by this plan — no new model-registry entries are added. A user who wants to assign an OpenAI/LiteLLM model to a persona for orchestrator runs can already do so today via the persona YAML `model_slug:` field (layer 2 of the four-layer priority chain), independent of the GUI-facing model registry.

### Constraints

- Adding first-class GUI model-registry entries (new `default.json` rows, `cc_model` mapping for Claude Code) is a separate, personas-subsystem follow-on task — see Out of Scope in the plan.

## Strategic Context

`ledger_get_repository_context` (repository: `ai-insights`, 192 prior projects) returned a strategic vision directly relevant to this plan:

- **Short-term goal:** "make the whole project as easy as possible to set up and use by developers... as little friction as possible" — supports treating clear, fail-loud validation errors (missing `OPENAI_API_KEY`/`OPENAI_API_BASE`) as a first-class requirement, not an afterthought.
- **Long-term secondary goal:** "Make the project as reliable as possible on the target environments — both technically for the supported operating systems... and operationally for the orchestrator headless workflow." This directly supports the plan's emphasis on avoiding *silent* misrouting (the Responses-API pitfall and the missing-`OPENAI_API_BASE` footgun) over a minimal, silently-fragile integration.

`ledger_search_insights` (query: "orchestrator LLM provider model configuration langchain") returned no insight specific to LLM provider selection or orchestrator model configuration. Two loosely-related global insights were found but neither is invalidated by this plan (no Knowledge Base Reconciliation entry needed):
- *"Funnel all calls to a rate-limited third-party API through one execution choke-point"* — general connector-resilience advice; not contradicted, and out of scope (LiteLLM proxy rate-limiting is the proxy's concern, not the orchestrator's).
- *"Unvalidated mirrored configuration parameters produce silent data loss"* — generic architecture insight that reinforces (not conflicts with) this plan's decision to hard-fail on a missing `OPENAI_API_BASE` rather than silently defaulting.
