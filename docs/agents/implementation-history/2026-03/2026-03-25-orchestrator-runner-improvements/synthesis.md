# Project Status Report — Orchestrator Runner Improvements

**Date:** 2026-03-25  
**Plan:** `2026-03-25-orchestrator-runner-improvements`  
**Status:** COMPLETE  
**Pipeline Health:** 6/6 WPs PASS — 0 failures, 0 missing stages  
**Ledger Version:** 2.4.1 · Server Version: 1.18.6

---

## Executive Summary

This session hardened the `orchestrator-runner` standalone persona with five targeted improvements
derived from real-world operational feedback. The changes address the three main failure modes
observed in practice: agents polling the terminal in a tight loop, misreading the JSONL log schema,
and making incorrect go/no-go decisions after a dry run.

A sixth work package served as an integration build-verification gate — confirming all new
subsections are correctly placed, accurately generated, and free of Markdown formatting artifacts
across both IDE targets (VS Code and Claude Code).

One cross-cutting improvement was also made to the MCP server: the `ledger_detect_project` tool
description was updated to surface its required parameter prominently, addressing a known agent
confusion point.

**Files changed:**  
- `personas/standalone/src/content/orchestrator-runner.md` — source of truth (all WP-001–004 content)  
- `personas/standalone/vs-code/orchestrator-runner.agent.md` — generated VS Code target  
- `personas/standalone/claude-code/orchestrator-runner.md` — generated Claude Code target  
- `mcp-server/src/tools/project-lifecycle.ts` — `ledger_detect_project` description (WP-005)  
- `mcp-server/dist/index.js` — compiled output

---

## Work Package Outcomes

| WP | Title | Status | Key Outcome |
|----|-------|--------|-------------|
| WP-001 | Polling discipline | COMPLETE | 4 rules: 30s interval, 3-empty terminal limit, 60s JSONL backoff, 10-iteration cap with user notification |
| WP-002 | JSONL parsing commands + field reference | COMPLETE | 2 `jq` commands, `action` (not `event`) critical note, 8-row field reference table |
| WP-003 | Terminal session hygiene | COMPLETE | 3 rules: background launch, no session mixing, cwd reset after build |
| WP-004 | Dry-run timing + exit code guidance | COMPLETE | 30-90s timing, 120s timeout, exit codes 0/1/130, exit-130 edge case documented |
| WP-005 | `ledger_detect_project` description | COMPLETE | Leads with "REQUIRED param: cwd_path (absolute directory path)." |
| WP-006 | Integration build verification gate | COMPLETE | All 5 ACs met; both builds and all 18 persona files confirmed clean |

---

## Metrics

| Metric | Value |
|--------|-------|
| WPs completed | 6 / 6 |
| Pipeline stages PASS | 11 / 11 |
| Pipeline stages FAIL | 0 |
| QA acceptance criteria passed (WP-006) | 5 / 5 |
| Reviewer Fix-Forwards applied | 1 |
| Blocking issues | 0 |

**Reviewer Fix-Forward (WP-001):** The intro sentence of the Polling discipline subsection was
internally inconsistent — "Terminal output from `get_terminal_output` is free to read" clashed with
the immediate warning about token waste. Revised to "Calling `get_terminal_output` to check progress
is convenient" — removes the contradiction without changing any rule.

---

## Strategic Recommendations

### Gold Nuggets

1. **Exit code 130 is safe when output is complete.** The SIGINT exit code (130) from
   `run-orchestrator.js` after dry-run completion was documented as explicitly safe to proceed from.
   This edge case is subtle — the read-only nature of dry runs makes it genuinely safe, but agents
   unfamiliar with the launch mechanism would reasonably treat it as a failure. The explicit
   documentation removes this ambiguity.

2. **`jq` is preferable to Python heredocs for JSONL parsing in persona content.** The QA note
   flagged that `jq` (implemented during WP-002) is more concise than the `python3` approach
   originally suggested in the plan. This is a valuable style precedent for future persona content
   that requires log-parsing examples.

3. **The `action` vs `event` JSONL field confusion is a real failure mode.** The prominent critical
   note added in WP-002 was validated as necessary — the schema uses `action` as the event-type
   field, a subtle departure from the naming convention most agents assume. Errors silently produce
   empty filter results. A well-placed blockquote warning is the right prevention mechanism.

4. **Tool descriptions that lead with "REQUIRED param:" reduce misuse.** WP-005 established that
   surfacing the required parameter at the start of the description (vs. buried in the body)
   meaningfully reduces the chance an agent calls the tool without the necessary argument. This
   pattern should be applied retroactively to other tools where the required param is not prominent.

### Process Observation

All 6 code-review pipeline completions received low-priority Reviewer warnings for missing
`artifacts.files_modified` declarations. This is a traceability gap only (no functional impact), but
it recurs consistently. Consider adding a reminder to the Reviewer persona: if the implementation
pipeline declared modified files, carry them forward in the code-review artifacts block.

---

## Next Steps

1. **Validate in practice** — Run the orchestrator with the updated Orchestrator Runner persona
   to confirm the polling discipline rules reduce unnecessary `get_terminal_output` calls in a
   real agent session.

2. **Propagate "REQUIRED param:" pattern** — Audit remaining MCP tool descriptions in
   `mcp-server/src/tools/` for tools where the required parameter is not surfaced at the top of
   the description. Apply the same fix-forward pattern as WP-005 in a follow-up work package.

3. **Code-review artifact traceability** — Consider a small Reviewer persona update reminding the
   agent to declare `artifacts.files_modified` when the implementation pipeline already tracked
   which files changed. Low priority, but would clean up the recurring project-level warnings.

4. **Re-run preflight** — The orchestrator's `preflight-orchestrator.js` should be run to confirm
   the rebuilt `mcp-server/dist/index.js` is correctly discovered and the updated
   `ledger_detect_project` description is live.
