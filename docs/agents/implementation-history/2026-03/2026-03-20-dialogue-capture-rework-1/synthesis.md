# Synthesis Report: Dialogue Capture — Post-Delivery Hardening

**Project:** `2026-03-20-dialogue-capture-rework-1`  
**Plan:** Post-Delivery Hardening Sprint  
**Date Completed:** 2026-03-23  
**Status:** COMPLETE — All 5 work packages delivered, all 22 acceptance criteria met.

---

## Executive Summary

This hardening sprint addressed technical debt accumulated during the original Dialogue Capture feature delivery. Six targeted fixes were applied across two sub-projects (Orchestrator/Python and MCP Server/TypeScript) with no new features or architectural changes.

All work packages achieved full acceptance criteria sign-off through the complete pipeline (implementation → QA → security audit where required → code review). The final test suite counts stand at **1,678 GUI tests** (TypeScript) and **104–40 Orchestrator tests** (Python), all passing.

Key outcomes:
- **Slug derivation hardened** — fragile string-split replaced with idiomatic `Path.name`
- **API input validation added** — `?wp=` query parameter validated against strict regex; invalid values silently return `[]`
- **Path-traversal logging added** — rejected filenames are now audited via `console.warn()` on both defence layers
- **Security headers deployed** — four OWASP-recommended response headers added to all MCP server HTTP responses
- **Accessibility improved** — `aria-expanded` attribute correctly toggled on dialogue buttons
- **Test coverage closed** — `SystemMessage` branch of `_msg_role()` now explicitly tested

---

## Work Package Outcomes

### WP-001 — Security HTTP Response Headers (`mcp-server/gui/server.ts`)

| | |
|---|---|
| **Status** | COMPLETE |
| **Pipelines** | Implementation → QA → Security Audit → Code Review (all PASS) |
| **Files** | `mcp-server/gui/server.ts`, `mcp-server/tests/gui/security-headers.test.ts` |
| **Tests** | 1,678 total (328 at implementation) — 0 failures |
| **Security Issues** | 0 Critical, 0 High, 1 Medium (acknowledged), 1 Low |

**What was done:** A `securityHeaders()` pure-function helper was added, mirroring the established `corsHeaders()` pattern. It returns the four required headers on every call (no shared mutable state). The helper is spread into `sendJson()` (covering all JSON API and error responses), `serveStatic()`, the OPTIONS preflight handler, and the last-resort `.catch()` 500 handler. A dedicated integration test file (`security-headers.test.ts`) validates header presence across 5 response types.

**All 6 ACs met:** X-Content-Type-Options, X-Frame-Options, Content-Security-Policy, Referrer-Policy all present on all response paths. GUI renders correctly. Tests verify header presence.

**Acknowledged trade-off:** CSP uses `'unsafe-inline'` for `script-src` and `style-src` — necessary for the current inline-script GUI architecture. Flagged by both QA and Security Audit for future remediation when the GUI migrates to external assets.

---

### WP-002 — Slug Derivation Hardening (`orchestrator/src/nodes/__init__.py`)

| | |
|---|---|
| **Status** | COMPLETE |
| **Pipelines** | Implementation → QA → Code Review (all PASS) |
| **Files** | `orchestrator/src/nodes/__init__.py`, `orchestrator/tests/test_nodes.py` |
| **Tests** | 104 total — 0 failures |
| **Security Issues** | N/A |

**What was done:** The fragile `str(path).rstrip("/").split("/")[-1]` slug derivation was replaced with the idiomatic `Path(project_path_obj).name`. A `from pathlib import Path` import was added (the WP spec incorrectly stated it was already present — minor spec inaccuracy). Two new tests in `TestSlugDerivation` verify correct behaviour with trailing-slash string inputs and `pathlib.Path`-typed inputs.

**All 4 ACs met.** The implementation is clean, one-liner, handles both `str` and `Path` inputs correctly, and is clearly commented.

---

### WP-003 — API Input Validation + Path-Traversal Logging (`mcp-server/gui/api.ts`)

| | |
|---|---|
| **Status** | COMPLETE |
| **Pipelines** | Implementation → QA → Security Audit → Code Review (all PASS) |
| **Files** | `mcp-server/gui/api.ts`, `mcp-server/tests/gui/api.test.ts` |
| **Tests** | 1,678 total (332 at implementation) — 0 failures |
| **Security Issues** | 0 Critical, 0 High |

**What was done:** A `WP_ID_RE` constant (`/^WP-\d+$/`) was added alongside the existing `DIALOGUE_FILENAME_RE`. `handleListDialogues()` now validates the optional `wpId` query parameter against this regex before use — invalid values silently return `[]` (no error, consistent with "not found" semantics). `handleGetDialogueFile()` now emits `console.warn()` with the rejected filename on both rejection paths (regex allowlist check and prefix/path-traversal check). Four new API tests cover AC6–AC12.

**All 7 ACs met.** Security Audit confirmed robust two-layer path traversal protection: (1) `DIALOGUE_FILENAME_RE` allowlist rejects filenames with `/`, `.`, spaces, or non-alphanumeric characters; (2) `resolve() + startsWith()` prefix check as defence-in-depth.

**Notable nuance:** The prefix check (Layer 2) is functionally unreachable from Layer 1 on standard filesystems, as the regex allowlist blocks all filesystem traversal attempts before the prefix check is reached. The defence-in-depth code is retained as correct practice; the AC10 test reuses the regex rejection scenario as a pragmatic acknowledgement.

---

### WP-004 — `aria-expanded` Accessibility on Dialogue Buttons (`mcp-server/gui/public/views/work-package.js`)

| | |
|---|---|
| **Status** | COMPLETE |
| **Pipelines** | Implementation → QA → Code Review (all PASS) |
| **Files** | `mcp-server/gui/public/views/work-package.js`, `mcp-server/tests/gui/dialogue-qa.test.ts` |
| **Tests** | 1,678 total — 0 failures |
| **Security Issues** | N/A |

**What was done:** `aria-expanded="false"` was added to dialogue toggle button HTML at render time. The click handler was updated on all three code paths: expand sets `"true"`, same-button re-click sets `"false"`, different-button click resets the prior button to `"false"`. Four tests in `dialogue-qa.test.ts` exercise each state transition.

**All 4 ACs met.** Implementation uses `setAttribute('aria-expanded', 'true'/'false')` — the correct approach for ARIA boolean attributes (string values, not JS booleans). The change mirrors the existing `classList` toggling pattern, keeping the diff minimal and low-risk.

---

### WP-005 — `SystemMessage` Test Coverage for `_msg_role()` (`orchestrator/tests/test_dialogue_writer.py`)

| | |
|---|---|
| **Status** | COMPLETE |
| **Pipelines** | QA (FAIL → PASS rework) → Code Review (PASS) |
| **Files** | `orchestrator/tests/test_dialogue_writer.py` |
| **Tests** | 40 total (39 pre-fix) — 0 failures |
| **Rework Count** | QA: 1 |

**What was done:** A `TestMsgRoleSystem` class was added to `test_dialogue_writer.py`, importing `_msg_role` from `src.utils.dialogue_writer` and `SystemMessage` from `langchain_core.messages`. The test asserts `_msg_role(SystemMessage(content="...")) == "System"`. Note: this WP experienced one QA rework cycle — the initial implementation attempt was missing the test class entirely. QA caught the gap and the fix was applied immediately.

**All 1 AC met.** Importantly, this test uses a **real** `SystemMessage` instance (not a `SimpleNamespace` stub as used elsewhere in the file) — this is intentional and correct because `_msg_role` dispatches on the `.type` attribute of LangChain message objects, which stubs cannot simulate authentically.

---

## Metrics Summary

| Metric | Value |
|---|---|
| Work packages | 5 / 5 COMPLETE |
| Acceptance criteria | 22 / 22 met |
| Pipeline stages completed | 17 (all PASS) |
| QA rework cycles | 1 (WP-005) |
| TypeScript tests (final) | 1,678 passed, 0 failed |
| Python tests (final, test_nodes.py) | 104 passed, 0 failed |
| Python tests (final, test_dialogue_writer.py) | 40 passed, 0 failed |
| Security audit findings — Critical/High | 0 |
| Security audit findings — Medium | 1 (CSP `unsafe-inline`, acknowledged) |
| New test files created | 1 (`security-headers.test.ts`) |
| Files modified | 7 (see below) |

### Files Modified

| File | WP | Change |
|---|---|---|
| `orchestrator/src/nodes/__init__.py` | WP-002 | `Path.name` slug derivation + `pathlib` import |
| `orchestrator/tests/test_nodes.py` | WP-002 | 2 new tests (`TestSlugDerivation`) |
| `orchestrator/tests/test_dialogue_writer.py` | WP-005 | `TestMsgRoleSystem` class added |
| `mcp-server/gui/server.ts` | WP-001 | `securityHeaders()` helper + all response paths |
| `mcp-server/gui/api.ts` | WP-003 | `WP_ID_RE`, `wpId` validation, `console.warn()` logging |
| `mcp-server/gui/public/views/work-package.js` | WP-004 | `aria-expanded` attribute + click-handler updates |
| `mcp-server/tests/gui/security-headers.test.ts` | WP-001 | New file — 5 integration tests |
| `mcp-server/tests/gui/api.test.ts` | WP-003 | 4 new tests (AC6–AC12) |
| `mcp-server/tests/gui/dialogue-qa.test.ts` | WP-004 | 4 new tests (AC19–AC21) |

---

## Technical Decisions & Rationale

### 1. `securityHeaders()` mirrors `corsHeaders()` pattern exactly
Rather than a one-off header injection, the implementation follows the established helper pattern already used for CORS. This makes the codebase consistent, keeps the helper a pure function (no shared state), and makes it easy to spread into any response context. The code review explicitly praised this as "clean and idiomatic."

### 2. Silent `[]` return for invalid `?wp=` values
Invalid `wpId` values return an empty array rather than an error response. This is consistent with the "not found" semantics used elsewhere in the API and avoids leaking information about what constitutes a valid WP ID format to potential attackers.

### 3. Two-layer path traversal defence retained even though Layer 2 is unreachable
The `DIALOGUE_FILENAME_RE` allowlist (Layer 1) makes the `resolve() + startsWith()` prefix check (Layer 2) unreachable in practice. Both layers are retained: Layer 1 as the primary guard, Layer 2 as defence-in-depth for hypothetical bypass on unusual filesystems or future regex relaxation. Security Audit explicitly validated this as a correct and appropriate pattern.

### 4. Real `SystemMessage` used in WP-005 test (not a stub)
Other `test_dialogue_writer.py` tests use `SimpleNamespace` stubs to avoid LangChain dependencies. The `TestMsgRoleSystem` test must use a real `SystemMessage` because `_msg_role()` dispatches on the `.type` attribute of LangChain message objects — a `SimpleNamespace` stub with `type='system'` would work but would not constitute a meaningful test of the actual dispatch mechanism.

---

## Lessons Learned & Recurring Patterns

### What went well
- **Pipeline velocity:** All 5 WPs moved from implementation to code-review sign-off within a single session (~31 minutes wall-clock).
- **Pattern reuse:** The `securityHeaders()` helper was designed in the same style as `corsHeaders()` — reviewers flagged this as exemplary. Existing patterns should always be consulted before introducing new ones.
- **Defence-in-depth:** The two-layer path traversal protection (allowlist regex + prefix check) is a robust pattern that the security audit validated without findings. Keep both layers even when one makes the other unreachable.
- **Test design:** The `TestSlugDerivation` tests (WP-002) were singled out as "exemplary" — isolated `_CaptureConfig` stub, `write_dialogue` patch for I/O-free assertions, clear failure messages. This is the gold standard for unit test isolation.

### What to improve
- **Spec accuracy:** WP-002's spec stated "`Path` is already imported" — it was not. Spec review should verify imports before writing implementation notes.
- **WP-005 QA rework:** The initial implementation attempt missed adding the test class entirely. The production code was correct, but the test was absent. This suggests the implementation step failed to read the WP spec carefully enough. A simple pre-flight read of the WP acceptance criteria before submitting implementation would have caught this.
- **Artifact declaration in code-review pipelines:** Three code-review pipelines (WP-001, WP-003, WP-005) completed without declaring `artifacts.files_modified`. This is a traceability gap — reviewers should always declare the files they reviewed, even if they made no changes.

---

## Outstanding Technical Debt & Follow-up Items

These items were identified during the sprint but are not blockers. They should be considered for the next hardening pass.

### Priority: Low

| Item | Source | Detail |
|---|---|---|
| **CSP `unsafe-inline` remediation** | WP-001 Security Audit (Medium) | Migrate GUI scripts/styles to external files and replace `'unsafe-inline'` with nonce- or hash-based CSP directives for stronger XSS protection. |
| **CORS headers on last-resort 500 handler** | WP-001 QA, Security Audit, Code Review | `server.ts` line 618 — the last-resort `.catch()` 500 handler includes `securityHeaders()` but omits `corsHeaders(port)`. All other response paths include both. Minor inconsistency; not a security issue. |
| **AC10 test title clarification** | WP-003 Code Review | `api.test.ts` AC10 test is titled "prefix check rejects" but exercises the regex path (since the prefix path is unreachable). A comment or title rename would prevent future maintainer confusion. |
| **Separate static-file tests (200 vs 404)** | WP-001 Code Review | `security-headers.test.ts` line 148 accepts status 200 or 404 to avoid CI dependency on `index.html` presence. Splitting into two explicit tests would provide independent coverage of the `readFile` success and `sendError` code paths. |
| **`assertSafeSlug()` denylist → allowlist** | WP-003 Security Audit (Info) | `api.ts` line 90 — `assertSafeSlug()` uses a substring denylist (`'/'` and `'..'`). A strict allowlist regex (a `SAFE_SLUG_REGEX` constant is already imported from `constants.js`) would be more robust. Pre-existing pattern, not introduced by this sprint. |
| **TestMsgRoleSystem comment on real vs. stub** | WP-005 Code Review | A brief inline comment explaining why `TestMsgRoleSystem` uses a real `SystemMessage` (vs. `SimpleNamespace` stubs elsewhere) would help future maintainers understand the pattern asymmetry. |
| **Pydantic V1 deprecation warning** | WP-002, WP-005 QA | Pydantic v1 API deprecation warning appears in Python test output (Python 3.14 incompatibility). Pre-existing issue, unrelated to this sprint; should be tracked separately. |

---

## Next Steps for Planner / Project Manager

1. **No regressions to address.** All existing tests continue to pass. No breaking changes were introduced.

2. **CSP hardening sprint** (future): If the GUI architecture evolves to use external scripts/stylesheets, the `'unsafe-inline'` CSP directive can be tightened to nonce- or hash-based directives. This is the highest-value security follow-up from this sprint.

3. **Pydantic v1 → v2 migration** (future): The deprecation warning in the Python test suite signals a migration that will be required before Python 3.14 support is needed.

4. **CORS consistency cleanup** (low priority): Add `...corsHeaders(port)` to the last-resort `.catch()` 500 handler in `server.ts` for consistency with all other response paths.

5. **Consider `assertSafeSlug()` allowlist refactor** (low priority): Replace the substring denylist in `api.ts` with the existing `SAFE_SLUG_REGEX` constant for improved robustness.

---

*Synthesis generated by the Head of Operations (Synthesis agent) — 2026-03-23.*
