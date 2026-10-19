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

Live-test gating hooks
-----------------------
Two collection/setup hooks make the documented "``@pytest.mark.live`` tests
are skipped by default" behavior real, and turn a set-but-invalid API key
into a clear skip instead of a 401 failure deep inside a test. Both delegate
their actual logic to ``tests/helpers/live_gating.py`` (pure, stdlib-only,
independently unit-tested in ``tests/test_live_gating.py``) — this file only
wires pytest's hook protocol to that logic.

``pytest_collection_modifyitems(config, items)``
    Runs at collection time (so ``--collect-only`` never touches the
    network). When ``live_selected(config.option.markexpr)`` is ``False`` —
    i.e. the current ``-m`` expression (or its absence) would not select a
    ``live``-only-marked item — every collected item carrying the ``live``
    marker gets an additional ``pytest.mark.skip`` applied, with a reason
    naming the opt-in (``-m live``). An ``addopts = "-m 'not live'"`` default
    was rejected for this same purpose because a caller's own ``-m`` flag
    replaces ``addopts`` entirely rather than combining with it, which would
    silently stop gating ``live`` tests the moment someone ran e.g.
    ``-m integration`` — this hook gates the marker itself, independent of
    whatever expression actually selected the item.

``pytest_runtest_setup(item)``
    Runs once, lazily, at setup time for the *first* ``live``-marked item
    that was not skipped by the hook above (i.e. ``-m live`` was explicitly
    given) — cached for the rest of the session via a module-level flag, so
    the credential probe's single HTTP request happens at most once per run
    regardless of how many live tests execute. Calls
    ``probe_credentials(os.environ)``; on ``(False, reason)`` it calls
    ``pytest.skip(reason)`` for every subsequent live item too (the cached
    failure), so an invalid or missing key skips cleanly instead of letting
    the first live test's own HTTP call surface the 401.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

import pytest

from tests.helpers.live_gating import live_selected, probe_credentials


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


# ---------------------------------------------------------------------------
# Live-test gating hooks (see module docstring)
# ---------------------------------------------------------------------------

_LIVE_SKIP_REASON = "live tests are skipped by default; run with -m live"

# Cached across the session: (checked, ok, reason). `checked` starts False;
# the first live item that reaches pytest_runtest_setup runs the probe once
# and every subsequent live item reuses the cached result.
_live_credential_check: dict[str, Any] = {"checked": False, "ok": True, "reason": ""}


def pytest_collection_modifyitems(config: pytest.Config, items: list) -> None:
    """Skip every ``live``-marked item unless ``-m`` explicitly selects it."""
    if live_selected(config.option.markexpr or ""):
        return
    skip_live = pytest.mark.skip(reason=_LIVE_SKIP_REASON)
    for item in items:
        # Checks the item's actual markers (get_closest_marker), not
        # `item.keywords` — the latter also contains tokens derived from the
        # test's own name/parametrize ID (e.g. a test literally named or
        # parametrized with the string "live"), which would false-positive.
        if item.get_closest_marker("live") is not None:
            item.add_marker(skip_live)


def pytest_runtest_setup(item: pytest.Item) -> None:
    """Lazily probe LLM credentials once per session, before the first live test runs."""
    if item.get_closest_marker("live") is None:
        return
    if not _live_credential_check["checked"]:
        ok, reason = probe_credentials(dict(os.environ))
        _live_credential_check.update(checked=True, ok=ok, reason=reason)
    if not _live_credential_check["ok"]:
        pytest.skip(f"Live credential probe failed: {_live_credential_check['reason']}")
