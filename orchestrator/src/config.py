"""
config.py — Configuration module for the AI Insights Orchestrator.

Loads environment variables, defines pipeline routing constants (mirroring
the TypeScript source-of-truth in ``mcp-server/src/utils/pipeline-maps.ts``),
and exposes a validated ``Config`` dataclass with auto-detected LLM provider.

Canonical TypeScript source: mcp-server/src/utils/pipeline-maps.ts
These constants are NOT auto-synced — update both files when changing routing maps.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

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
# Pipeline routing constants
# Mirrors: mcp-server/src/utils/pipeline-maps.ts
# ---------------------------------------------------------------------------

#: Enforced pipeline execution order.
#: A pipeline type may only start when its prerequisite has a PASS pipeline.
#: ``None`` means no prerequisite (can always start).
PIPELINE_PREREQUISITES: dict[str, Optional[str]] = {
    "implementation": None,
    "qa": "implementation",
    "security-audit": "qa",
    "code-review": "security-audit",
    "release-engineering": "code-review",
    "documentation": "release-engineering",
}

#: Map of pipeline type → owning agent role.
#: Mirrors ``PIPELINE_AGENT_MAP`` in pipeline-maps.ts.
PIPELINE_AGENT_MAP: dict[str, str] = {
    "implementation": "Developer",
    "qa": "QA",
    "security-audit": "Security Auditor",
    "code-review": "Reviewer",
    "release-engineering": "Release Engineer",
    "documentation": "Documentation",
}

#: Map of graph stage name → next stage name.
#: Provides sequential stage ordering for the supervisor routing logic.
#: Mirrors ``NEXT_AGENT_MAP`` semantics from pipeline-maps.ts, adapted for
#: the Python graph node names (lowercase, ``docs`` instead of ``Documentation``).
NEXT_STAGE_MAP: dict[str, str] = {
    "pm": "developer",
    "developer": "qa",
    "qa": "security_auditor",
    "security_auditor": "reviewer",
    "reviewer": "release_engineer",
    "release_engineer": "docs",
    "docs": "synthesis",
}

#: Map of graph stage name → pipeline type it owns.
#: Inverse of the stage portion of PIPELINE_AGENT_MAP.
#: Mirrors ``AGENT_PIPELINE_MAP`` from pipeline-maps.ts for the Python graph.
STAGE_TO_PIPELINE: dict[str, str] = {
    "developer": "implementation",
    "qa": "qa",
    "security_auditor": "security-audit",
    "reviewer": "code-review",
    "release_engineer": "release-engineering",
    "docs": "documentation",
}

#: Inverse of STAGE_TO_PIPELINE: pipeline type → graph stage name.
PIPELINE_TO_STAGE: dict[str, str] = {v: k for k, v in STAGE_TO_PIPELINE.items()}

#: Map of graph stage name → relative path to persona Markdown file.
#: Paths are relative to the workspace root (two levels above orchestrator/).
PERSONA_FILES: dict[str, str] = {
    "pm": "personas/ledger/vs-code/2-project-manager.md",
    "developer": "personas/ledger/vs-code/3-developer.md",
    "qa": "personas/ledger/vs-code/4-qa.md",
    "security_auditor": "personas/ledger/vs-code/5-security-auditor.md",
    "reviewer": "personas/ledger/vs-code/6-reviewer.md",
    "release_engineer": "personas/ledger/vs-code/7-release-engineer.md",
    "docs": "personas/ledger/vs-code/8-documentation.md",
    "synthesis": "personas/ledger/vs-code/9-synthesis.md",
}

#: All valid graph stage names (excludes START/END pseudo-nodes).
VALID_STAGES: frozenset[str] = frozenset(PERSONA_FILES)

#: Valid pipeline type names (matches TypeScript ``PIPELINE_TYPES`` tuple).
PIPELINE_TYPES: tuple[str, ...] = ("implementation", "qa", "security-audit", "code-review", "release-engineering", "documentation")


# ---------------------------------------------------------------------------
# LLM provider detection helpers
# ---------------------------------------------------------------------------

_ANTHROPIC_PREFIXES = ("claude",)
_GOOGLE_PREFIXES = ("gemini", "models/gemini")


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
        raise EnvironmentError(
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
    """

    model_name: str
    provider: str
    max_iterations: int
    checkpoint_dir: Path
    mcp_server_cmd: list[str]
    workspace_root: Path
    log_level: str

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
    workspace_root: Optional[Path] = None,
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
        raise EnvironmentError(
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
        raise EnvironmentError(
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
        raise EnvironmentError(
            f"LOG_LEVEL must be one of {sorted(valid_levels)}; got {log_level!r}."
        )

    return Config(
        model_name=model_name,
        provider=provider,
        max_iterations=max_iterations,
        checkpoint_dir=checkpoint_dir,
        mcp_server_cmd=mcp_server_cmd,
        workspace_root=workspace_root,
        log_level=log_level,
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


_default_config: Optional[Config] = None
