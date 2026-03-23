# Plan: Dialogue Capture — Post-Delivery Hardening

## Summary

Address the technical debt items and follow-up recommendations identified in the [synthesis report](../2026-03-20-dialogue-capture/synthesis.md) for the Agent Dialogue Capture feature. This is a hardening sprint covering slug derivation robustness, accessibility, input validation, security headers, test coverage gaps, and server-side logging for rejected requests.

## Architectural Context

The Dialogue Capture feature was delivered across two sub-projects:

- **Orchestrator** (`orchestrator/`): Python — `Config.capture_dialogues` flag, `dialogue_writer.py` utility, stage node integration in `nodes/__init__.py`.
- **MCP Server** (`mcp-server/`): TypeScript — `DIALOGUES_DIR` constant, `GuiConfigSchema` extension, dialogue API endpoints in `gui/api.ts`, route registration in `gui/server.ts`, frontend dialogue card in `gui/public/views/work-package.js`.

Key files affected by this plan:

- [orchestrator/src/nodes/__init__.py](orchestrator/src/nodes/__init__.py) — slug derivation (line 122)
- [orchestrator/src/utils/dialogue_writer.py](orchestrator/src/utils/dialogue_writer.py) — `write_dialogue()` utility
- [orchestrator/tests/test_dialogue_writer.py](orchestrator/tests/test_dialogue_writer.py) — test suite
- [mcp-server/gui/api.ts](mcp-server/gui/api.ts) — `handleListDialogues()` + `handleGetDialogueFile()`
- [mcp-server/gui/server.ts](mcp-server/gui/server.ts) — HTTP response headers
- [mcp-server/gui/public/views/work-package.js](mcp-server/gui/public/views/work-package.js) — dialogue toggle buttons

## Approach / Architecture

This is a hardening pass — no new features, no architectural changes. Each step is a small, self-contained fix that can be independently verified. The plan is grouped by sub-project to minimize context-switching.

## Rationale

All items come directly from the synthesis report's "Outstanding Technical Debt" and "Next Steps" sections. They were flagged by QA, Security Audit, and Code Review pipelines during the original delivery. Addressing them now prevents accumulation and keeps the codebase clean while the feature context is fresh.

## Detailed Steps

### Orchestrator (Python)

1. **Harden slug derivation to use `Path.name`**
   In `orchestrator/src/nodes/__init__.py` (line 122), replace:
   ```python
   slug = str(project_path_obj).rstrip("/").split("/")[-1]
   ```
   with:
   ```python
   slug = Path(project_path_obj).name
   ```
   This is idiomatic, handles trailing slashes, and works correctly if `project_path_obj` is already a `Path` object. Ensure `Path` is imported from `pathlib` (it already is in this file). Update or add a unit test in `orchestrator/tests/test_nodes.py` that verifies slug extraction with trailing-slash and `Path`-typed inputs.

2. **Add `SystemMessage` test coverage for `_msg_role()`**
   In `orchestrator/tests/test_dialogue_writer.py`, add a test class (e.g., `TestMsgRoleSystem`) that imports `SystemMessage` from `langchain_core.messages` and verifies `_msg_role(SystemMessage(content="..."))` returns `"System"`. This closes the coverage gap flagged in the synthesis.

### MCP Server — API Hardening (TypeScript)

3. **Validate `?wp=` query parameter in `handleListDialogues()`**
   In `mcp-server/gui/api.ts`, inside `handleListDialogues()`, add a validation check for the `wpId` parameter after extraction from the query string. If provided, it must match the pattern `/^WP-\d+$/`. If it doesn't match, return an empty array (no error — consistent with "not found" semantics). Add a corresponding test in `mcp-server/tests/gui/api.test.ts`.

4. **Log rejected path-traversal attempts in `handleGetDialogueFile()`**
   In `mcp-server/gui/api.ts`, inside `handleGetDialogueFile()`, add a `console.error()` (or `console.warn()`) log line before the `notFound()` call on both rejection paths (regex check failure and prefix check failure). The log should include the requested filename (already validated as safe to log since it failed the allowlist). Do **not** include the requesting IP or any PII — just the rejected filename and which check caught it. Add a test verifying the log output in `mcp-server/tests/gui/api.test.ts`.

5. **Add baseline security HTTP headers to all responses**
   In `mcp-server/gui/server.ts`, add the following headers to the response helper (or the common header construction):
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`

   These are appropriate for a localhost developer tool and follow OWASP recommendations. The `'unsafe-inline'` allowances for script and style are necessary because the GUI uses inline styles and possibly inline event handlers. Verify that the GUI still functions correctly after adding these headers. Add a test verifying the headers are present on responses.

### MCP Server — Frontend Accessibility (JavaScript)

6. **Add `aria-expanded` to dialogue toggle buttons**
   In `mcp-server/gui/public/views/work-package.js`, update the dialogue button rendering to include `aria-expanded="false"` by default. In the click handler that expands/collapses the dialogue content, toggle the attribute between `"true"` and `"false"`. This addresses the accessibility gap flagged by the Reviewer. Add a corresponding test in `mcp-server/tests/gui/dialogue-qa.test.ts` (or extend the existing test file).

## Dependencies

- Step 2 depends on step 1 being merged first (both touch orchestrator tests, potential merge conflicts).
- Steps 3–6 are independent of each other and of steps 1–2.
- Step 5 (security headers) should be verified against step 6 (frontend changes) to ensure CSP does not block inline scripts used by the dialogue card.

## Required Components

### Modified files
- `orchestrator/src/nodes/__init__.py` — slug derivation fix
- `orchestrator/tests/test_nodes.py` — new slug derivation test
- `orchestrator/tests/test_dialogue_writer.py` — new `SystemMessage` test
- `mcp-server/gui/api.ts` — `wpId` validation + traversal logging
- `mcp-server/gui/server.ts` — security headers
- `mcp-server/gui/public/views/work-package.js` — `aria-expanded` attribute
- `mcp-server/tests/gui/api.test.ts` — validation + logging tests
- `mcp-server/tests/gui/dialogue-qa.test.ts` — accessibility test

### No new files required

## Assumptions

- The existing `Path` import in `nodes/__init__.py` is from `pathlib`.
- `SystemMessage` is available from `langchain_core.messages` (same import source as `HumanMessage`, `AIMessage`, `ToolMessage`).
- The GUI does not rely on being embedded in an iframe (making `X-Frame-Options: DENY` safe).
- No inline `<script>` tags exist in the GUI HTML — only inline event handlers and styles (covered by `'unsafe-inline'` in the CSP).

## Constraints

- No new dependencies may be added (all changes use stdlib / existing imports).
- All existing tests must continue to pass.
- The GUI must remain fully functional after security header changes.
- Cross-platform compatibility must be maintained (the `Path.name` fix actually improves Windows compatibility since it handles both `/` and `\` separators).

## Out of Scope

- **Concurrency-safe revision detection** (synthesis tech debt item #2): Only relevant if the orchestrator moves to concurrent stage execution. Not applicable to the current sequential design.
- **`marked.parse()` + `innerHTML` sanitisation** (synthesis tech debt item #8): Documented as intentional for a local-network tool. No change unless the tool is exposed externally.
- **Top-level "Dialogue Browser" view** (synthesis recommendation #6): Deferred until operator usage data confirms the need.
- **Enabling the feature in staging** (synthesis recommendation #1): Operational task, not a code change.

## Acceptance Criteria

### Step 1 — Slug derivation
- AC1: `nodes/__init__.py` uses `Path(...).name` instead of the string-split approach.
- AC2: A test in `test_nodes.py` verifies slug extraction with a trailing-slash path.
- AC3: A test in `test_nodes.py` verifies slug extraction with a `pathlib.Path`-typed input.
- AC4: All existing `test_nodes.py` tests continue to pass.

### Step 2 — SystemMessage test
- AC5: A test in `test_dialogue_writer.py` verifies that `_msg_role(SystemMessage(...))` returns `"System"`.

### Step 3 — wpId validation
- AC6: `handleListDialogues()` returns an empty `dialogues: []` array when `?wp=` is provided with a value not matching `/^WP-\d+$/`.
- AC7: Valid `?wp=WP-001` values continue to work as before.
- AC8: A test in `api.test.ts` covers the invalid `?wp=` case.

### Step 4 — Traversal logging
- AC9: A `console.warn()` or `console.error()` call is emitted when the regex check rejects a filename.
- AC10: A `console.warn()` or `console.error()` call is emitted when the prefix check rejects a filename.
- AC11: The logged message includes the rejected filename string.
- AC12: Tests verify the log output using `console` spy/mock.

### Step 5 — Security headers
- AC13: All HTTP responses include `X-Content-Type-Options: nosniff`.
- AC14: All HTTP responses include `X-Frame-Options: DENY`.
- AC15: All HTTP responses include a `Content-Security-Policy` header.
- AC16: All HTTP responses include `Referrer-Policy: strict-origin-when-cross-origin`.
- AC17: The GUI renders and functions correctly with the new headers.
- AC18: A test verifies at least one response includes the expected security headers.

### Step 6 — aria-expanded
- AC19: Dialogue buttons render with `aria-expanded="false"` by default.
- AC20: Clicking a dialogue button toggles `aria-expanded` to `"true"`.
- AC21: Clicking the button again (or clicking another button) resets `aria-expanded` to `"false"`.
- AC22: A test in `dialogue-qa.test.ts` verifies the `aria-expanded` attribute behaviour.

## Testing Strategy

- **Orchestrator changes (steps 1–2):** Run `pytest orchestrator/tests/test_nodes.py orchestrator/tests/test_dialogue_writer.py` to verify new and existing tests.
- **MCP server changes (steps 3–6):** Run `npx vitest run tests/gui/api.test.ts tests/gui/dialogue-qa.test.ts` from the `mcp-server/` directory. Additionally run the full MCP server test suite (`npx vitest run`) to catch regressions from security header changes.
- **Manual verification:** After step 5, open the GUI in a browser and verify that all pages (project list, WP detail, settings, dialogue rendering) load correctly with no CSP violations in the browser console.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CSP headers break existing GUI functionality** | The CSP allows `'unsafe-inline'` for scripts and styles, and `'self'` for all resource types. Test in browser after implementation. If breakage occurs, loosen specific CSP directives rather than removing the header entirely. |
| **`Path.name` behaves differently on Windows for edge cases** | `pathlib.Path.name` is cross-platform by design and handles both `/` and `\`. The existing string-split approach only handles `/`, so this is strictly an improvement. |
| **`wpId` validation regex is too strict** | The pattern `/^WP-\d+$/` matches the established convention used throughout the codebase. If a new WP naming scheme is introduced in the future, the regex can be updated. |
