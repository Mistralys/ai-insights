"""
live_gating.py — Pure, stdlib-only helpers for gating ``@pytest.mark.live`` tests.

Two independent, composable primitives:

``live_selected(markexpr)``
    Decides whether a pytest ``-m`` marker expression would ever select an
    item marked only ``live``. Used by ``conftest.py``'s
    ``pytest_collection_modifyitems`` hook to add a synthetic skip marker to
    every ``live``-marked item when the current run did not explicitly ask
    for ``live`` tests — making the documented "skipped by default" behavior
    real instead of aspirational. Implemented as a small hand-rolled
    boolean-expression evaluator (``and``/``or``/``not``/parentheses over
    bare identifiers) rather than importing pytest's own (private,
    ``_pytest``-prefixed) expression engine, so this module has zero
    dependency on pytest internals — identical in spirit to the way
    ``scripts/lib/mcp-dist-freshness.js`` avoids depending on internals of
    the tools it wraps.

``probe_credentials(env, opener, timeout)``
    Live-validates whichever LLM API key is present (Anthropic preferred,
    Google as fallback) via a single no-token GET request, mirroring the
    exact endpoints and status-code interpretation
    ``scripts/preflight-orchestrator.js``'s ``checkAnthropicKey`` /
    ``checkGoogleKey`` already trust. Returns ``(ok, reason)`` rather than
    raising, so callers can turn a "no key" or "invalid key" result into a
    clear ``pytest.skip()`` instead of letting a real HTTP 401 surface deep
    inside a test's own assertions.

Both functions take their inputs as plain parameters (a marker-expression
string; an environment mapping and an injectable HTTP opener) rather than
reaching into ``os.environ`` or performing real network I/O directly, so
``tests/test_live_gating.py`` can exercise every branch without spawning a
subprocess or touching the network.
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

_ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
_ANTHROPIC_VERSION = "2023-06-01"
_GOOGLE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Status codes either provider uses to mean "the key itself is rejected",
# per scripts/preflight-orchestrator.js's checkAnthropicKey (401) and
# checkGoogleKey (400 or 403).
_INVALID_KEY_STATUS_CODES = frozenset({400, 401, 403})

Opener = Callable[..., object]


# ---------------------------------------------------------------------------
# live_selected — marker-expression evaluation (no pytest internals)
# ---------------------------------------------------------------------------

def _tokenize(markexpr: str) -> list[str]:
    tokens: list[str] = []
    i = 0
    n = len(markexpr)
    while i < n:
        ch = markexpr[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "()":
            tokens.append(ch)
            i += 1
            continue
        if ch.isalnum() or ch == "_":
            start = i
            while i < n and (markexpr[i].isalnum() or markexpr[i] == "_"):
                i += 1
            tokens.append(markexpr[start:i])
            continue
        # Any other character (e.g. stray punctuation) is ignored — this is
        # a best-effort evaluator for the simple expressions pytest's -m
        # accepts in this codebase, not a full re-implementation of
        # pytest's keyword-expression grammar.
        i += 1
    return tokens


class _Parser:
    """Recursive-descent parser/evaluator for a tiny and/or/not/() grammar.

    Every bare identifier evaluates to ``True`` iff it equals ``"live"``
    (case-insensitive) — the only marker this module needs to reason about.
    """

    def __init__(self, tokens: list[str]) -> None:
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> str | None:
        return self._tokens[self._pos] if self._pos < len(self._tokens) else None

    def _advance(self) -> str | None:
        tok = self._peek()
        self._pos += 1
        return tok

    def parse(self) -> bool:
        if not self._tokens:
            return False
        result = self._or_expr()
        return result

    def _or_expr(self) -> bool:
        result = self._and_expr()
        while (self._peek() or "").lower() == "or":
            self._advance()
            rhs = self._and_expr()
            result = result or rhs
        return result

    def _and_expr(self) -> bool:
        result = self._not_expr()
        while (self._peek() or "").lower() == "and":
            self._advance()
            rhs = self._not_expr()
            result = result and rhs
        return result

    def _not_expr(self) -> bool:
        if (self._peek() or "").lower() == "not":
            self._advance()
            return not self._not_expr()
        return self._atom()

    def _atom(self) -> bool:
        tok = self._advance()
        if tok == "(":
            result = self._or_expr()
            if self._peek() == ")":
                self._advance()
            return result
        if tok is None:
            return False
        return tok.lower() == "live"


def live_selected(markexpr: str) -> bool:
    """
    True iff the pytest ``-m`` expression *markexpr* would select an item
    marked only ``live`` — i.e. whether live tests were explicitly asked for.

    An empty expression (no ``-m`` given at all) always returns ``False``,
    matching pytest's own default of "no marker filtering" meaning
    "everything would run" for an unfiltered collection, but here meaning
    "live was not explicitly requested" for gating purposes.
    """
    if not markexpr.strip():
        return False
    return _Parser(_tokenize(markexpr)).parse()


# ---------------------------------------------------------------------------
# probe_credentials — lazy, no-token credential validation
# ---------------------------------------------------------------------------

def probe_credentials(
    env: dict[str, str],
    opener: Opener = urllib.request.urlopen,
    timeout: float = 5.0,
) -> tuple[bool, str]:
    """
    Live-validates whichever LLM API key is present in *env*.

    Checks ``ANTHROPIC_API_KEY`` first (preferred), then ``GOOGLE_API_KEY``.
    Makes a single no-token GET request to the matching provider's models
    endpoint via *opener* (injectable in place of ``urllib.request.urlopen``
    for testing — never spawns real network I/O when a fake opener is
    supplied).

    Returns
    -------
    (ok, reason) : tuple[bool, str]
        ``(False, "no key")``      — neither key is set.
        ``(True, "anthropic")``    — the Anthropic key was accepted.
        ``(True, "google")``       — the Google key was accepted.
        ``(False, "invalid key")`` — the provider rejected the key (401/403
                                      for Anthropic, 400/403 for Google).
        ``(False, "unreachable")`` — the request could not reach the
                                      provider at all (``URLError``, e.g. DNS
                                      failure or connection refused).
        ``(False, "HTTP <code>")`` — any other non-2xx status.
    """
    anthropic_key = (env.get("ANTHROPIC_API_KEY") or "").strip()
    google_key = (env.get("GOOGLE_API_KEY") or "").strip()

    if not anthropic_key and not google_key:
        return False, "no key"

    if anthropic_key:
        request = urllib.request.Request(
            _ANTHROPIC_MODELS_URL,
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": _ANTHROPIC_VERSION,
            },
        )
        return _probe(request, opener, timeout, ok_reason="anthropic")

    url = f"{_GOOGLE_MODELS_URL}?key={urllib.parse.quote(google_key)}"
    request = urllib.request.Request(url)
    return _probe(request, opener, timeout, ok_reason="google")


def _probe(
    request: urllib.request.Request,
    opener: Opener,
    timeout: float,
    *,
    ok_reason: str,
) -> tuple[bool, str]:
    try:
        opener(request, timeout=timeout)
        return True, ok_reason
    except urllib.error.HTTPError as exc:
        if exc.code in _INVALID_KEY_STATUS_CODES:
            return False, "invalid key"
        return False, f"HTTP {exc.code}"
    except urllib.error.URLError:
        return False, "unreachable"
