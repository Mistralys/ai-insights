"""
conftest.py — Shared pytest fixtures and config stubs for the orchestrator test suite.

Config stubs
------------
Three config stub classes are available to all test modules without import:

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
"""

from __future__ import annotations

from pathlib import Path


class _StreamCaptureConfig:
    """Config stub with ``capture_dialogues=True`` and a caller-supplied workspace root."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root
        self.capture_dialogues = True
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

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _NoCaptureConfig:
    """Config stub with ``capture_dialogues=False``."""

    workspace_root = Path("/tmp/no-capture-ws")
    capture_dialogues = False
    stage_models = {k: "claude-test" for k in [
        "developer", "pm", "qa", "reviewer", "security_auditor",
        "docs", "release_engineer", "synthesis", "planner",
    ]}

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")
