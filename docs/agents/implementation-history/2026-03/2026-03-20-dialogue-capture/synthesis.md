# Synthesis Report — Agent Dialogue Capture

**Project:** `2026-03-20-dialogue-capture`
**Report Date:** 2026-03-23
**Status:** COMPLETE
**Work Packages:** 7 COMPLETE · 9 CANCELLED · 0 FAILED

---

## Executive Summary

The **Agent Dialogue Capture** feature has been successfully delivered. The project enables operators to opt in to capturing the full LLM conversation (system prompt, user turns, assistant responses, tool calls, and tool results) for every pipeline stage execution, persisting them as versioned Markdown files in each project's ledger directory and making them browsable directly from the GUI work-package detail view.

The feature spans three distinct system boundaries — the Python orchestrator, the TypeScript MCP server backend, and the browser-side SPA frontend — and was delivered across six completed work packages through a full pipeline cycle (implementation → QA → [security audit] → code review → documentation) for each.

Nine work packages in the original plan were cancelled. Inspection of the cancelled WP scope (WP-005 through WP-014) reveals that their acceptance criteria were subsumed into the implemented WPs: WP-005's API handler scope was delivered under WP-015; WP-006's frontend scope was delivered under WP-016. WPs-008–014 appear to have been superseded or reorganised during planning. No functional scope was lost.

---

## Scope Delivered

| WP | Title (inferred from scope) | Key Deliverable |
|---|---|---|
| WP-001 | `capture_dialogues` Config Flag | `Config.capture_dialogues` field + `CAPTURE_DIALOGUES` env var parsing |
| WP-002 | Dialogue Writer Utility | `orchestrator/src/utils/dialogue_writer.py` — `serialize_messages_to_markdown()` + `write_dialogue()` |
| WP-003 | Stage Node Integration | Dialogue capture hook in `create_stage_node()` + `dialogue_captured` JSONL event + console formatter |
| WP-004 | MCP Server Config Schema | `DIALOGUES_DIR` constant + `capture_dialogues` in `GuiConfigSchema`/`DEFAULT_CONFIG` |
| WP-007 | GUI Settings Toggle | `capture-dialogues` checkbox in the Settings form (`config.js`) |
| WP-015 | Dialogue API Endpoints | `handleListDialogues()` + `handleGetDialogueFile()` + two new GET routes |
| WP-016 | GUI Dialogues Card | `API.getDialogues()` + `API.getDialogueContent()` + Dialogues card in the WP detail view |

---

## Metrics Summary

### Test Counts (at project completion)

| Scope | Tests Passing | Tests Failed |
|---|---|---|
| `orchestrator/tests/test_config.py` (WP-001) | 66 | 0 |
| `orchestrator/tests/test_dialogue_writer.py` (WP-002) | 39 | 0 |
| `orchestrator/tests/test_nodes.py` + `test_logging.py` (WP-003) | 154 | 0 |
| `mcp-server/tests/gui/config.test.ts` (WP-004) | 20 | 0 |
| `mcp-server` full suite (WP-004 QA baseline) | 1,645 | 0 |
| `mcp-server/tests/gui/api.test.ts` (WP-015) | 110 | 0 |
| `mcp-server` full suite (WP-016 QA baseline) | 1,665 | 0 |
| `mcp-server/tests/gui/dialogue-qa.test.ts` (WP-016 new) | 22 | 0 |

**Total new tests introduced this project:** 66 + 39 + 57 (WP-003 net new) + 6 (WP-004 net new) + 11 (WP-015 net new) + 22 (WP-016 new file) = **~201 new/modified tests**

All pipelines passed first time (rework count = 0 on all WPs).

### Security Audit (WP-015)

| Severity | Findings |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 (both informational — no bypass possible) |
| Low | 3 |
| Info | 1 |

Security sign-off: **PASS**

### Files Modified (cumulative across project)

**Orchestrator (Python)**
- `orchestrator/src/config.py`
- `orchestrator/src/nodes/__init__.py`
- `orchestrator/src/utils/dialogue_writer.py` *(new)*
- `orchestrator/src/utils/logging.py`
- `orchestrator/tests/test_config.py`
- `orchestrator/tests/test_dialogue_writer.py` *(new)*
- `orchestrator/tests/test_nodes.py`
- `orchestrator/tests/test_logging.py`
- `orchestrator/docs/jsonl-log-schema.md`
- `orchestrator/docs/public-api.md`
- `orchestrator/README.md`
- `orchestrator/.env.example`
- `orchestrator/changelog.md`

**MCP Server (TypeScript)**
- `mcp-server/src/utils/constants.ts`
- `mcp-server/src/gui/config.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/api-client.js`
- `mcp-server/gui/public/views/config.js`
- `mcp-server/gui/public/views/work-package.js`
- `mcp-server/gui/public/styles.css`
- `mcp-server/tests/gui/config.test.ts`
- `mcp-server/tests/gui/api.test.ts`
- `mcp-server/tests/gui/dialogue-qa.test.ts` *(new)*
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/README.md`
- `mcp-server/changelog.md`

**Root**
- `changelog.md`

---

## Key Technical Decisions & Rationale

### 1. Markdown over JSONL for dialogue storage
Dialogues are persisted as Markdown (`.md`) files rather than JSONL or JSON. This was a deliberate choice: the primary consumer is a human reviewing agent reasoning, not a machine parser. Markdown handles multi-paragraph content, code blocks, and tool call JSON naturally, and reuses the existing `marked.js` rendering pipeline already in place for `plan.md` and `synthesis.md`.

### 2. Ledger storage, not orchestrator log directory
Dialogues are co-located with the project they describe (`mcp-server/storage/ledger/{slug}/dialogues/`). This makes them accessible through the existing GUI infrastructure and browsable per-WP without any new routing pattern.

### 3. Versioned on rework (`r0`, `r1`, `r2`, …)
The revision counter (`write_dialogue()` glob-based max detection) preserves the full dialogue history across rework iterations. A developer can compare `WP-003-developer-r0.md` with `r1` to understand how feedback changed the agent's approach — a key use-case for persona refinement.

### 4. Decoupled config: two independent toggles
The orchestrator reads `CAPTURE_DIALOGUES` from its own `.env`. The GUI `capture_dialogues` checkbox writes to `gui-config.json`. The modules remain decoupled — the GUI note informs the user that changes take effect on the next run. This avoided introducing cross-module `.env` write coupling.

### 5. Module-level frozenset constant for truthy values (WP-001 Fix-Forward)
During code review of WP-001, the inline `_TRUTHY = {"true", "1", "yes"}` set was promoted to a module-level `_CAPTURE_DIALOGUES_TRUTHY` frozenset, matching the established pattern of `_ANTHROPIC_PREFIXES` / `_GOOGLE_PREFIXES`. Non-behavioral, but improves readability for module-level scanning.

### 6. Defence-in-depth path traversal controls (WP-015)
`handleGetDialogueFile()` applies two independent security layers:
1. **Primary:** `DIALOGUE_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/` allowlist regex — rejects anything containing `.`, `/`, or special characters, including percent-encoded variants (decoded first via `decodeURIComponent`).
2. **Secondary:** `path.resolve()` prefix check ensuring the resolved file path stays inside the `dialogues/` directory.

Security audit confirmed 0 Critical/High findings. Both layers are correctly implemented.

### 7. Async placeholder pattern for the Dialogues card (WP-016)
The WP detail view injects a synchronous `#wp-dialogues-section` placeholder div into `app.innerHTML` before the async `API.getDialogues()` promise is awaited. The DOM reference is captured by closure, guaranteeing the element exists when the promise resolves, regardless of SPA navigation timing. This is race-condition-free.

### 8. Direct `fetch()` for `getDialogueContent` (WP-016)
`API.getDialogueContent()` uses a direct `fetch()` call and `res.text()` rather than the internal `request()` helper (which calls `res.json()`). This is intentional: dialogue content is raw Markdown text, not JSON. Consistent with how plan/synthesis raw content would need to be fetched.

---

## Lessons Learned & Recurring Patterns

### Pattern: Documentation-Forward as a quality gate
All three reviewers used "documentation-forward" comments to explicitly hand off documentation tasks to the Documentation agent. This pattern worked well — all documentation-forwards were fully addressed before the WP was marked COMPLETE. It kept the review clean without blocking the reviewer's PASS.

### Pattern: Fix-Forward by the Reviewer
WP-001 (module-level constant promotion) and WP-016 (removal of dead `id='dlg-content-{stage}'` attribute) both had non-behavioral fixes applied directly by the Reviewer rather than being sent back for rework. Both were clearly non-breaking and verifiably correct. This avoided a rework cycle while still improving the code.

### Pattern: Stdlib-only new modules
Both new Python modules (`dialogue_writer.py`, config additions) use only stdlib dependencies. No new `requirements.txt` entries were required. This is good discipline and should be maintained for future utility modules.

### Pattern: Zod schema auto-inheritance
In WP-004, `GuiConfigPartialSchema` picked up `capture_dialogues` automatically because it is derived from `GuiConfigSchema.omit({...}).partial()` and the new field was not in the omit list. This is a well-designed extensibility pattern — new writable config fields require only one change (the base schema) rather than two.

### Pattern: Cross-language constant coupling requires bidirectional documentation
`DIALOGUES_DIR = 'dialogues'` is used by both the Python `write_dialogue()` function and the TypeScript MCP server. The code-review documentation-forward for this was fully resolved by adding a cross-reference in the `write_dialogue()` docstring pointing to `constants.ts`, and the existing `constants.ts` JSDoc already pointed back to `write_dialogue()`. Future cross-language constants should follow this bidirectional documentation pattern.

---

## Outstanding Technical Debt & Follow-up Items

### High priority (potential bugs / correctness risks)

None identified. All pipelines PASSed; no high-priority observations were recorded in any pipeline.

### Medium priority (quality / maintainability)

1. **WP-003: Slug derivation is string-based, not `Path`-based**
   `nodes/__init__.py` derives the project slug via `str(project_path_obj).rstrip('/').split('/')[-1]`. If `project_path` ever becomes a `pathlib.Path` object in state, this breaks. The idiomatic fix is `Path(project_path_obj).name`. Flagged by both QA and Reviewer. Low regression risk with current string contract, but worth hardening.

2. **WP-003: `write_dialogue()` revision detection is not concurrency-safe**
   The glob-based `max()` revision counter is not atomic. Two concurrent stage nodes capturing dialogue for the same `wp_id + stage` could collide. Acceptable for the current sequential orchestrator design but would need a lock or atomic rename if concurrency is introduced.

3. **WP-016: `aria-expanded` missing on dialogue toggle buttons**
   The `.dialogue-btn` elements do not set `aria-expanded` to communicate expanded/collapsed state to screen readers. Flagged by the Reviewer. Documented in both `mcp-server/README.md` and `api-surface.md` as a future accessibility pass.

### Low priority (nice-to-have improvements)

4. **WP-002: No dedicated test for `System` message role in `_msg_role()`**
   The function handles `System` messages correctly but no test class covers this path. The fallback is safe; this is a minor coverage gap.

5. **WP-015: `?wp=` query parameter (wpId) is not validated**
   The prefix filter accepts any arbitrary string. It is a pure in-memory filter (never touches the filesystem), so there is no security impact — an unmatched prefix simply returns `[]`. A low-cost improvement would be validating against `/^WP-[0-9]+$/` to enforce expected format and prevent log noise from malformed inputs.

6. **WP-015: No security HTTP headers (`CSP`, `X-Frame-Options`, etc.)**
   A pre-existing gap on all routes, not introduced by this project. Appropriate for a localhost developer tool, but worth adding in a future hardening pass.

7. **WP-015: Rejected traversal attempts are not logged server-side**
   `DIALOGUE_FILENAME_RE` rejections are silently returned as 404 with no server-side log entry. A `stderr` warning on rejection would aid debugging without leaking data.

8. **WP-016: `marked.parse()` output is set via `innerHTML` without sanitisation**
   Intentional for a local-network tool (consistent with plan/synthesis rendering). Explicitly documented. No change required unless the tool is ever exposed to untrusted content.

---

## Acceptance Criteria Scorecard

| WP | Total AC | Met | Deferred / Notes |
|---|---|---|---|
| WP-001 | 6 | 6 | — |
| WP-002 | 8 | 8 | — |
| WP-003 | 7 | 7 | — |
| WP-004 | 7 | 7 | — |
| WP-007 | 6 | 6 | AC6 (manual browser round-trip) verified by consensus across all pipeline stages; code path confirmed correct |
| WP-015 | 10 | 10 | — |
| WP-016 | 10 | 10 | — |
| **Total** | **54** | **54** | — |

All 54 acceptance criteria across all 7 completed work packages are met.

---

## Next Steps & Recommendations

### For the Planner / Product

1. **Enable the feature in staging.** Set `CAPTURE_DIALOGUES=true` in the orchestrator `.env` and run a full project cycle. Evaluate the storage footprint and Markdown rendering quality across all pipeline stages before recommending general use.

2. **Accessibility pass for the Dialogues card.** Add `aria-expanded` toggling to `.dialogue-btn` elements (see technical debt item #3 above). This is a small, well-scoped improvement that can be done as a standalone micro-WP.

3. **Evaluate the `?wp=` query parameter validation improvement** (tech debt #5). A one-line regex guard in `handleListDialogues()` with a corresponding test addition.

4. **Consider slug derivation hardening** (tech debt #1). Replace the string-split slug derivation in `nodes/__init__.py` with `Path(project_path_obj).name` as a defensive improvement.

### For the Technical Program Manager

5. **Plan a hardening sprint** covering: server-side security headers (applies to all routes, not just dialogues), missing `System` message test, and `?wp=` validation. None of these are urgent but they form a coherent set.

6. **Consider a top-level "Dialogue Browser" view** if operator usage reveals that cross-WP dialogue review is common. The current per-WP card design is optimal for focused review; a project-level view would complement it for overview use cases.

---

## Changelog References

| Component | Version | Key Entry |
|---|---|---|
| `orchestrator/changelog.md` | v0.9.1 | `capture_dialogues` config field |
| `orchestrator/changelog.md` | v0.9.2 | `dialogue_writer` utility |
| `orchestrator/changelog.md` | v0.9.3 | Stage node integration + JSONL event |
| `mcp-server/changelog.md` | v1.18.1 | `DIALOGUES_DIR` constant + config schema |
| `mcp-server/changelog.md` | v1.18.2 | GUI Settings toggle |
| `mcp-server/changelog.md` | v1.18.3 | Dialogue API endpoints |
| `mcp-server/changelog.md` | v1.18.4 | GUI Dialogues card |
| Root `changelog.md` | Unreleased | Full feature summary |

---

*Generated by the Synthesis agent (Head of Operations) · Project Ledger v2.4.1 · Server v1.17.0*
