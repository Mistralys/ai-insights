"""
test_error_helpers.py — Unit tests for the error-classifier helper functions
in ``src/nodes/__init__.py``.

Covers :func:`_is_retryable_api_error` in isolation, separated from the
stage-node tests in ``test_nodes.py`` to improve discoverability.
"""

from __future__ import annotations

from src.nodes import _is_retryable_api_error

# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def _exc_with_status(status: int) -> Exception:
    """Return a plain Exception with a ``status_code`` attribute."""
    exc = Exception(f"HTTP {status}")
    exc.status_code = status  # type: ignore[attr-defined]
    return exc


def _httpx_transport_error() -> Exception:
    """Return an exception that looks like an httpx transport error.

    We fake the ``__module__`` attribute so we don't need to import httpx.
    The exception carries no ``status_code``, matching the real httpx
    ``TransportError`` / ``ConnectError`` hierarchy.
    """

    class _FakeHttpxConnectError(Exception):
        pass

    _FakeHttpxConnectError.__module__ = "httpx"
    return _FakeHttpxConnectError("Connection refused")


def _httpx_status_error(status: int) -> Exception:
    """Return an exception that looks like an httpx.HTTPStatusError.

    Fakes the ``httpx`` module and carries a ``status_code`` attribute,
    matching the real ``httpx.HTTPStatusError`` which is raised for HTTP
    responses with error status codes.  The presence of ``status_code``
    means this is routed through the status-code branch, not the
    transport-error branch.
    """

    class _FakeHttpxStatusError(Exception):
        pass

    _FakeHttpxStatusError.__module__ = "httpx"
    exc = _FakeHttpxStatusError(f"HTTP {status}")
    exc.status_code = status  # type: ignore[attr-defined]
    return exc


# ---------------------------------------------------------------------------
# Tests: _is_retryable_api_error
# ---------------------------------------------------------------------------


class TestIsRetryableApiError:
    """Tests for _is_retryable_api_error()."""

    # ------------------------------------------------------------------
    # AC-1: Retryable HTTP status codes and httpx transport errors
    # ------------------------------------------------------------------

    def test_status_529_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(529)) is True

    def test_status_429_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(429)) is True

    def test_status_500_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(500)) is True

    def test_status_503_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(503)) is True

    def test_httpx_transport_error_is_retryable(self):
        assert _is_retryable_api_error(_httpx_transport_error()) is True

    # ------------------------------------------------------------------
    # AC-2: Fatal HTTP status codes are never retryable
    # ------------------------------------------------------------------

    def test_status_401_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(401)) is False

    def test_status_403_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(403)) is False

    # ------------------------------------------------------------------
    # AC-3: Non-API errors are not retryable
    # ------------------------------------------------------------------

    def test_plain_value_error_is_not_retryable(self):
        assert _is_retryable_api_error(ValueError("something went wrong")) is False

    def test_plain_runtime_error_is_not_retryable(self):
        assert _is_retryable_api_error(RuntimeError("unexpected")) is False

    def test_status_400_client_error_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(400)) is False

    def test_status_404_client_error_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(404)) is False

    def test_httpx_status_error_400_is_not_retryable(self):
        """httpx.HTTPStatusError with a 4xx status_code must NOT be retried.

        This locks the disambiguation invariant: httpx errors that carry a
        ``status_code`` attribute are routed through the status-code branch,
        NOT the transport-error branch.  A 400 response from httpx is a client
        error and must be treated as non-retryable.
        """
        assert _is_retryable_api_error(_httpx_status_error(400)) is False

    # ------------------------------------------------------------------
    # AC-4: Exception chain walking
    # ------------------------------------------------------------------

    def test_wrapped_529_via_cause_is_retryable(self):
        inner = _exc_with_status(529)
        outer = RuntimeError("wrapper")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_429_via_context_is_retryable(self):
        inner = _exc_with_status(429)
        outer = RuntimeError("wrapper")
        outer.__context__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_500_via_cause_is_retryable(self):
        inner = _exc_with_status(500)
        outer = ValueError("wrapped")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_401_via_cause_is_not_retryable(self):
        """A fatal error wrapped in RuntimeError must still be non-retryable."""
        inner = _exc_with_status(401)
        outer = RuntimeError("wrapper")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is False

    def test_deeply_wrapped_httpx_error_is_retryable(self):
        httpx_err = _httpx_transport_error()
        mid = RuntimeError("middle")
        mid.__cause__ = httpx_err
        outer = Exception("outer")
        outer.__cause__ = mid
        assert _is_retryable_api_error(outer) is True
