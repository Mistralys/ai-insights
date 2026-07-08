"""
conftest.py — Shared pytest fixtures and config stubs for the orchestrator test suite.

Config stubs
------------
Five config stub classes are available to all test modules without import:

_StreamCaptureConfig(workspace_root)
    ``capture_dialogues=True``; ``workspace_root`` supplied at construction time
    (typically via the ``tmp_path`` fixture).  Used in streaming and chunk-write
    tests that need a real temp directory for JSONL output.

_CaptureConfig
    ``capture_dialogues=True``; ``workspace_root`` is the actual workspace root
    (resolved from ``__file__``).  Used in tests that need to load real persona
    files from the workspace.

_NoCaptureConfig
    ``capture_dialogues=False``; ``workspace_root`` is a non-existent temp path.
    Used where capture is deliberately disabled.

_FakeConfig
    ``capture_dialogues=False``; ``workspace_root`` resolves to the real workspace
    root.  Shared stub used by ``test_nodes.py`` (via import) and other tests that
    need a minimal config without JSONL file I/O.

_DeepAgentFakeConfig(model)
    Subclass of ``_FakeConfig`` that accepts a ``BaseChatModel`` instance and
    returns it from ``resolve_model_for_stage()``.  Required for Deep Agent
    integration tests where ``create_stage_node`` must receive a real model object
    rather than a string, to avoid triggering real LLM provider resolution.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any


class _StreamCaptureConfig:
    """Config stub with ``capture_dialogues=True`` and a caller-supplied workspace root."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root
        self.capture_dialogues = True
        self.stream_max_retries = 0
        self.stream_retry_base_delay_s = 10.0
        self.stage_models = {
            "developer": "claude-test",
            "pm": "claude-test",
            "qa": "claude-test",
            "reviewer": "claude-test",
            "security_auditor": "claude-test",
            "docs": "claude-test",
            "release_engineer": "claude-test",
            "synthesis": "claude-test",
            "planner": "claude-test",
        }

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _CaptureConfig:
    """Config stub with ``capture_dialogues=True`` and the real workspace root."""

    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = True
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _NoCaptureConfig:
    """Config stub with ``capture_dialogues=False``."""

    workspace_root = Path(tempfile.gettempdir()) / "no-capture-ws"
    capture_dialogues = False
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0
    stage_models = {k: "claude-test" for k in [
        "developer", "pm", "qa", "reviewer", "security_auditor",
        "docs", "release_engineer", "synthesis", "planner",
    ]}

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _FakeConfig:
    """Minimal Config-like stub with ``capture_dialogues=False`` and the real workspace root.

    Promoted from ``test_nodes.py`` so it is available to all test modules.
    Preferred over ``_CaptureConfig`` when JSONL file I/O should be avoided.
    """

    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent  # ai-insights root
    capture_dialogues = False
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _DeepAgentFakeConfig(_FakeConfig):
    """Config stub for Deep Agent integration tests.

    Accepts a ``BaseChatModel`` instance and returns it from
    ``resolve_model_for_stage()``.  This is necessary because
    ``create_stage_node`` calls ``resolve_model_for_stage(stage)`` and passes the
    result to ``create_deep_agent(model=…)``.  The base ``_FakeConfig`` returns
    the string ``"claude-test"``, which triggers real LLM provider resolution and
    fails without an API key.

    Usage::

        from tests.helpers.fake_chat_model import ToolCallableFakeChatModel

        fake_model = ToolCallableFakeChatModel(messages=iter([...]))
        config = _DeepAgentFakeConfig(model=fake_model)
        node_fn = make_developer_node(config, tools)
    """

    def __init__(self, model: Any) -> None:
        self._model = model

    def resolve_model_for_stage(self, stage: str) -> Any:  # type: ignore[override]
        """Return the injected model instance for any stage."""
        return self._model
