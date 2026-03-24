"""
config.py — Configuration module for the AI Insights Orchestrator.

Loads environment variables, derives pipeline routing constants from
``shared/workflow-manifest.json`` (the single source of truth for all
role and pipeline definitions across the workspace), and exposes a
validated ``Config`` dataclass with auto-detected LLM provider."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment loading
# ---------------------------------------------------------------------------

# Load .env from the orchestrator directory (the directory this file lives in)
# and fall back to the workspace root if not found.
_HERE = Path(__file__).resolve().parent
_ORCHESTRATOR_ROOT = _HERE.parent
load_dotenv(_ORCHESTRATOR_ROOT / ".env", override=False)


# ---------------------------------------------------------------------------
# Manifest loading
# ---------------------------------------------------------------------------

def _load_workflow_manifest() -> dict:
    """
    Load ``shared/workflow-manifest.json`` from the workspace root.

    Raises
    ------
    ImportError
        If the manifest file is missing or not valid JSON.
    """
    manifest_path = _ORCHESTRATOR_ROOT.parent / "shared" / "workflow-manifest.json"
    if not manifest_path.exists():
        raise ImportError(
            f"Shared workflow manifest not found: {manifest_path}\n"
            "The file 'shared/workflow-manifest.json' is required at the workspace "
            "root. Ensure the repository is fully checked out."
        )
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ImportError(
            f"Failed to parse workflow manifest at {manifest_path}: {exc}"
        ) from exc


_MANIFEST: dict = _load_workflow_manifest()
_roles: list = _MANIFEST["roles"]
_pipelines: dict = _MANIFEST["pipelines"]


# ---------------------------------------------------------------------------
# Pipeline routing constants (derived from manifest)
# ---------------------------------------------------------------------------

#: Enforced pipeline execution order.
#: A pipeline type may only start when its prerequisite has a PASS pipeline.
#: ``None`` means no prerequisite (can always start).
PIPELINE_PREREQUISITES: dict[str, str | None] = dict(_pipelines["prerequisites"])

#: Map of pipeline type → owning agent role name.
PIPELINE_AGENT_MAP: dict[str, str] = {
    r["pipeline"]: r["name"]
    for r in _roles
    if r.get("pipeline")
}


def _resolve_fail_routing_role(role_id: str) -> str:
    """Return the role name for a role ID found in ``fail_routing``."""
    try:
        return next(r["name"] for r in _roles if r["id"] == role_id)
    except StopIteration:
        raise ImportError(
            f"Workflow manifest integrity error: fail_routing references unknown "
            f"role ID {role_id!r}. Check shared/workflow-manifest.json."
        ) from None


#: Pipeline type → agent name responsible for FAIL rework.
#: Derived from ``pipelines.fail_routing`` in ``shared/workflow-manifest.json``.
FAIL_ROUTING_AGENT_MAP: dict[str, str] = {
    ptype: _resolve_fail_routing_role(role_id)
    for ptype, role_id in _pipelines["fail_routing"].items()
}

# Roles in manifest order excluding the planner (first, orchestrating).
# IMPORTANT: Synthesis is intentionally kept despite being orchestrating,
# because NEXT_STAGE_MAP needs the terminal "docs → synthesis" link.
# Filtering by `r.get("orchestrating")` would drop Synthesis and break
# the handoff chain — do NOT "fix" this to use the orchestrating flag.
_chain_roles: list = [r for r in _roles if r["id"] != "planner"]

#: Map of graph stage name → next stage name.
#: Provides sequential stage ordering for the supervisor routing logic.
NEXT_STAGE_MAP: dict[str, str] = {
    _chain_roles[i]["id"]: _chain_roles[i + 1]["id"]
    for i in range(len(_chain_roles) - 1)
}

#: Map of graph stage name → pipeline type it owns.
STAGE_TO_PIPELINE: dict[str, str] = {
    r["id"]: r["pipeline"]
    for r in _roles
    if r.get("pipeline")
}

#: Inverse of STAGE_TO_PIPELINE: pipeline type → graph stage name.
PIPELINE_TO_STAGE: dict[str, str] = {v: k for k, v in STAGE_TO_PIPELINE.items()}

#: Map of graph stage name → relative path to persona Markdown file.
#: Paths are relative to the workspace root (two levels above orchestrator/).
PERSONA_FILES: dict[str, str] = {r["id"]: r["persona_file"] for r in _roles}

#: All valid graph stage names — the set of all non-orchestrating role IDs.
VALID_STAGES: frozenset[str] = frozenset(
    r["id"] for r in _roles if not r.get("orchestrating")
)

#: Valid pipeline type names in canonical execution order.
PIPELINE_TYPES: tuple[str, ...] = tuple(_pipelines["canonical_order"])

#: Map of role name → role ID for every role in the manifest.
#: Used by supervisor.py to derive stage destinations without hardcoding strings.
ROLE_IDS: dict[str, str] = {r["name"]: r["id"] for r in _roles}

#: Non-orchestrating role names in manifest order.
#: The supervisor iterates this list to find the first role with actionable work.
PIPELINE_ROLE_NAMES: list[str] = [
    r["name"] for r in _roles if not r.get("orchestrating")
]

#: Terminal work-package statuses — no further agent action is required.
#: Derived from the manifest's terminal_work_package status vocabulary.
WP_TERMINAL_STATUSES: frozenset[str] = frozenset(
    _MANIFEST["statuses"]["terminal_work_package"]
)


# ---------------------------------------------------------------------------
# LLM provider detection helpers
# ---------------------------------------------------------------------------

_ANTHROPIC_PREFIXES = ("claude",)
_GOOGLE_PREFIXES = ("gemini", "models/gemini")

#: Environment variable values that disable ``capture_dialogues`` (matched after
#: ``.strip().lower()``). Kept as a module-level constant so it is visible
#: alongside the other private config constants and easy to extend.
_CAPTURE_DIALOGUES_FALSY: frozenset[str] = frozenset({"false", "0", "no"})


def _model_is_anthropic(model_name: str) -> bool:
    """Return True if *model_name* looks like an Anthropic model."""
    lower = model_name.lower()
    return any(lower.startswith(p) for p in _ANTHROPIC_PREFIXES)


def _model_is_google(model_name: str) -> bool:
    """Return True if *model_name* looks like a Google model."""
    lower = model_name.lower()
    return any(lower.startswith(p) for p in _GOOGLE_PREFIXES)


def _resolve_provider(model_name: str) -> str:
    """
    Determine the LLM provider from *model_name* and available API keys.

    Resolution rules (in priority order):
    1. If only one API key is set, use its provider (regardless of model name).
    2. If both keys are set, use the provider that matches the model name prefix:
       - ``claude-*`` → ``anthropic``
       - ``gemini-*`` → ``google``
    3. If both keys are set and the model name is ambiguous, raise ``ValueError``.
    4. If no keys are set, raise ``EnvironmentError``.

    Returns
    -------
    str
        One of ``"anthropic"`` or ``"google"``.
    """
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_google = bool(os.environ.get("GOOGLE_API_KEY"))

    if not has_anthropic and not has_google:
        raise OSError(
            "No LLM provider API key found. "
            "Set ANTHROPIC_API_KEY (Anthropic) or GOOGLE_API_KEY (Google AI Studio) "
            "in your .env file or environment. "
            "Install the matching provider extra: pip install -e '.[anthropic]' or "
            "pip install -e '.[google]'."
        )

    if has_anthropic and not has_google:
        return "anthropic"

    if has_google and not has_anthropic:
        return "google"

    # Both keys present — use model name prefix as the tiebreaker.
    if _model_is_anthropic(model_name):
        return "anthropic"
    if _model_is_google(model_name):
        return "google"

    raise ValueError(
        f"Both ANTHROPIC_API_KEY and GOOGLE_API_KEY are set, but MODEL_NAME "
        f"'{model_name}' does not start with a recognised prefix "
        f"({', '.join(_ANTHROPIC_PREFIXES + _GOOGLE_PREFIXES)}). "
        "Set MODEL_NAME to a model from one provider (e.g. 'claude-sonnet-4-6-20250929' "
        "or 'gemini-2.5-pro') to select the provider unambiguously."
    )


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------

@dataclass
class Config:
    """
    Validated runtime configuration for the orchestrator.

    Instantiate via :func:`load_config` (the public factory) rather than
    calling the constructor directly — ``load_config`` reads environment
    variables and applies all validation rules.

    Attributes
    ----------
    model_name:
        LLM model identifier (e.g. ``"claude-sonnet-4-6-20250929"``).
    provider:
        Auto-detected LLM provider: ``"anthropic"`` or ``"google"``.
    max_iterations:
        Safety ceiling on the total number of supervisor iterations.
    checkpoint_dir:
        Directory for LangGraph SQLite checkpoint files.
    mcp_server_cmd:
        Shell command list to launch the MCP server subprocess.
    workspace_root:
        Absolute path to the ai-insights workspace root (parent of
        ``orchestrator/``).
    log_level:
        Python logging level string (``"DEBUG"``, ``"INFO"``, etc.).
    heartbeat_interval_s:
        Seconds of console silence before emitting a heartbeat. ``0`` disables.
    capture_dialogues:
        When ``True``, the orchestrator writes agent dialogue artefacts to disk.
        Controlled by the ``CAPTURE_DIALOGUES`` environment variable (falsy
        values: ``"false"``, ``"0"``, ``"no"``; case-insensitive). Defaults to
        ``True``.
    """

    model_name: str
    provider: str
    max_iterations: int
    checkpoint_dir: Path
    mcp_server_cmd: list[str]
    workspace_root: Path
    log_level: str
    heartbeat_interval_s: int = 120
    capture_dialogues: bool = True

    def get_chat_model(self):
        """
        Return a provider-agnostic LangChain chat model instance.

        Uses ``langchain.chat_models.init_chat_model`` when available
        (LangChain >= 0.2), falling back to direct provider imports.

        Raises
        ------
        ImportError
            If the required provider package is not installed.
        """
        try:
            from langchain.chat_models import init_chat_model  # type: ignore[import]
            return init_chat_model(self.model_name)
        except ImportError:
            pass

        if self.provider == "anthropic":
            try:
                from langchain_anthropic import ChatAnthropic  # type: ignore[import]
                return ChatAnthropic(model=self.model_name)  # type: ignore[call-arg]
            except ImportError as exc:
                raise ImportError(
                    "langchain-anthropic is not installed. "
                    "Run: pip install -e '.[anthropic]'"
                ) from exc

        if self.provider == "google":
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore[import]
                return ChatGoogleGenerativeAI(model=self.model_name)  # type: ignore[call-arg]
            except ImportError as exc:
                raise ImportError(
                    "langchain-google-genai is not installed. "
                    "Run: pip install -e '.[google]'"
                ) from exc

        raise ValueError(f"Unknown provider: {self.provider!r}")  # pragma: no cover


def load_config(
    *,
    workspace_root: Path | None = None,
) -> Config:
    """
    Read environment variables and construct a validated :class:`Config`.

    Parameters
    ----------
    workspace_root:
        Override the auto-detected workspace root. Useful in tests.

    Raises
    ------
    EnvironmentError
        If required environment variables are missing or invalid.
    ValueError
        If configuration values are logically inconsistent.
    """
    # Determine the workspace root: two levels above this file
    # (orchestrator/src/config.py → orchestrator/ → workspace root).
    if workspace_root is None:
        workspace_root = _ORCHESTRATOR_ROOT.parent

    # --- model_name ---
    model_name = os.environ.get("MODEL_NAME", "").strip()
    if not model_name:
        raise OSError(
            "MODEL_NAME is not set. "
            "Add MODEL_NAME=<model-id> to your .env file. "
            "Examples: claude-sonnet-4-6-20250929, gemini-2.5-pro."
        )

    # --- provider (auto-detected) ---
    provider = _resolve_provider(model_name)

    # --- max_iterations ---
    raw_max_iter = os.environ.get("MAX_ITERATIONS", "100").strip()
    try:
        max_iterations = int(raw_max_iter)
        if max_iterations < 1:
            raise ValueError("must be a positive integer")
    except ValueError as exc:
        raise OSError(
            f"MAX_ITERATIONS must be a positive integer; got {raw_max_iter!r}."
        ) from exc

    # --- checkpoint_dir ---
    raw_checkpoint_dir = os.environ.get("CHECKPOINT_DIR", "./checkpoints").strip()
    checkpoint_dir = Path(raw_checkpoint_dir)
    if not checkpoint_dir.is_absolute():
        # Relative paths are resolved from the orchestrator root (where .env lives).
        checkpoint_dir = (_ORCHESTRATOR_ROOT / checkpoint_dir).resolve()

    # --- mcp_server_cmd ---
    # Default: launch the compiled MCP server from the workspace root.
    mcp_server_script = workspace_root / "mcp-server" / "dist" / "index.js"
    mcp_server_cmd: list[str] = ["node", str(mcp_server_script)]

    # --- log_level ---
    log_level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if log_level not in valid_levels:
        raise OSError(
            f"LOG_LEVEL must be one of {sorted(valid_levels)}; got {log_level!r}."
        )

    # --- capture_dialogues ---
    raw_capture = os.environ.get("CAPTURE_DIALOGUES", "").strip().lower()
    capture_dialogues = raw_capture not in _CAPTURE_DIALOGUES_FALSY if raw_capture else True

    # --- heartbeat_interval_s ---
    raw_heartbeat = os.environ.get("HEARTBEAT_INTERVAL_S", "120").strip()
    try:
        heartbeat_interval_s = int(raw_heartbeat)
        if heartbeat_interval_s < 0:
            raise ValueError("must be a non-negative integer")
    except ValueError as exc:
        raise OSError(
            f"HEARTBEAT_INTERVAL_S must be a non-negative integer; got {raw_heartbeat!r}."
        ) from exc

    return Config(
        model_name=model_name,
        provider=provider,
        max_iterations=max_iterations,
        checkpoint_dir=checkpoint_dir,
        mcp_server_cmd=mcp_server_cmd,
        workspace_root=workspace_root,
        log_level=log_level,
        capture_dialogues=capture_dialogues,
        heartbeat_interval_s=heartbeat_interval_s,
    )


# ---------------------------------------------------------------------------
# Module-level default config instance (only constructed when accessed).
# Call load_config() explicitly in application code.
# ---------------------------------------------------------------------------

def get_default_config() -> Config:
    """
    Return (and lazily initialise) the module-level default :class:`Config`.

    This is provided as a convenience for modules that need a single shared
    config instance without threading it explicitly. Prefer passing a
    ``Config`` object explicitly in testable code.
    """
    global _default_config  # noqa: PLW0603
    if _default_config is None:
        _default_config = load_config()
    return _default_config


_default_config: Config | None = None
