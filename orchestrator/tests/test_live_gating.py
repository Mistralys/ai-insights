"""
test_live_gating.py — Unit tests for tests/helpers/live_gating.py.

Exercises live_selected() and probe_credentials() directly, with an injected
HTTP opener for the latter — no real network I/O anywhere in this suite.
"""

from __future__ import annotations

import urllib.error

import pytest

from tests.helpers.live_gating import live_selected, probe_credentials


class TestLiveSelected:
    @pytest.mark.parametrize(
        "markexpr",
        ["live", "integration or deepagent or live", "(live)"],
    )
    def test_true_cases(self, markexpr: str) -> None:
        assert live_selected(markexpr) is True

    @pytest.mark.parametrize(
        "markexpr",
        ["", "not live", "integration", "deepagent and not live"],
    )
    def test_false_cases(self, markexpr: str) -> None:
        assert live_selected(markexpr) is False

    def test_case_insensitive_identifier_and_keywords(self) -> None:
        assert live_selected("LIVE") is True
        assert live_selected("NOT live") is False

    def test_nested_parentheses(self) -> None:
        assert live_selected("(integration or (deepagent or live))") is True
        assert live_selected("(integration and (deepagent or not live))") is False

    def test_whitespace_only_is_false(self) -> None:
        assert live_selected("   ") is False


class TestProbeCredentials:
    def test_no_key_returns_no_key_without_calling_opener(self) -> None:
        def opener(*_args, **_kwargs):
            raise AssertionError("opener must not be called when no key is set")

        ok, reason = probe_credentials({}, opener=opener)
        assert (ok, reason) == (False, "no key")

    def test_anthropic_200_returns_ok(self) -> None:
        def opener(request, timeout=None):
            assert request.full_url == "https://api.anthropic.com/v1/models"
            return object()

        ok, reason = probe_credentials({"ANTHROPIC_API_KEY": "sk-real"}, opener=opener)
        assert (ok, reason) == (True, "anthropic")

    def test_anthropic_request_carries_required_headers(self) -> None:
        captured = {}

        def opener(request, timeout=None):
            captured["headers"] = dict(request.header_items())
            return object()

        probe_credentials({"ANTHROPIC_API_KEY": "sk-real"}, opener=opener)

        headers = {k.lower(): v for k, v in captured["headers"].items()}
        assert headers.get("x-api-key") == "sk-real"
        assert headers.get("anthropic-version") == "2023-06-01"

    @pytest.mark.parametrize("status_code", [401, 403])
    def test_anthropic_401_403_returns_invalid_key(self, status_code: int) -> None:
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(request.full_url, status_code, "err", {}, None)

        ok, reason = probe_credentials({"ANTHROPIC_API_KEY": "sk-bad"}, opener=opener)
        assert (ok, reason) == (False, "invalid key")

    def test_url_error_returns_unreachable(self) -> None:
        def opener(request, timeout=None):
            raise urllib.error.URLError("name resolution failed")

        ok, reason = probe_credentials({"ANTHROPIC_API_KEY": "sk-real"}, opener=opener)
        assert (ok, reason) == (False, "unreachable")

    def test_other_http_error_includes_status_in_reason(self) -> None:
        def opener(request, timeout=None):
            raise urllib.error.HTTPError(request.full_url, 500, "err", {}, None)

        ok, reason = probe_credentials({"ANTHROPIC_API_KEY": "sk-real"}, opener=opener)
        assert ok is False
        assert reason == "HTTP 500"

    def test_google_endpoint_used_when_only_google_key_set(self) -> None:
        captured = {}

        def opener(request, timeout=None):
            captured["url"] = request.full_url
            return object()

        ok, reason = probe_credentials({"GOOGLE_API_KEY": "g-real"}, opener=opener)

        assert (ok, reason) == (True, "google")
        assert captured["url"].startswith(
            "https://generativelanguage.googleapis.com/v1beta/models?key="
        )
        assert "g-real" in captured["url"]

    def test_anthropic_key_preferred_when_both_present(self) -> None:
        captured = {}

        def opener(request, timeout=None):
            captured["url"] = request.full_url
            return object()

        ok, reason = probe_credentials(
            {"ANTHROPIC_API_KEY": "sk-real", "GOOGLE_API_KEY": "g-real"}, opener=opener
        )

        assert (ok, reason) == (True, "anthropic")
        assert captured["url"] == "https://api.anthropic.com/v1/models"

    def test_default_timeout_is_forwarded(self) -> None:
        captured = {}

        def opener(request, timeout=None):
            captured["timeout"] = timeout
            return object()

        probe_credentials({"ANTHROPIC_API_KEY": "sk-real"}, opener=opener, timeout=2.5)
        assert captured["timeout"] == 2.5

    def test_empty_string_keys_treated_as_unset(self) -> None:
        def opener(*_args, **_kwargs):
            raise AssertionError("opener must not be called")

        ok, reason = probe_credentials(
            {"ANTHROPIC_API_KEY": "  ", "GOOGLE_API_KEY": ""}, opener=opener
        )
        assert (ok, reason) == (False, "no key")
