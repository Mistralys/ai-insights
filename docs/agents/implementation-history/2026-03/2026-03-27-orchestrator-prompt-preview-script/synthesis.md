# Synthesis Report — Orchestrator Prompt Preview Script

**Plan:** `2026-03-27-orchestrator-prompt-preview-script`
**Date:** 2026-03-27
**Status:** COMPLETE

---

## Executive Summary

This session delivered a standalone developer utility — `scripts/preview-prompts.py` — that renders all orchestrator stage prompt templates with representative sample values and writes fully-resolved Markdown files to `orchestrator/dist/stage-prompts/`. The goal: let engineers inspect and review production-accurate prompt output without running the full LLM pipeline or needing any credentials.

Three files were created or modified:

| File | Change |
|---|---|
| `scripts/preview-prompts.py` | **New** — the preview script (Python 3.11+, stdlib only) |
| `scripts/cli.js` | **Modified** — `cmdPreviewPrompts` handler + COMMANDS registry entry |
| `orchestrator/.gitignore` | **Modified** — `dist/` appended as a distinct line entry |

The script is fully integrated into the unified workspace CLI (`node scripts/cli.js preview-prompts`) and produces exactly 14 output files by default: `pm.md`, `synthesis.md`, and `{stage}-with-wp.md` / `{stage}-without-wp.md` for the 6 WP-scoped stages.

---

## Work Package Summary

| WP | Title | Status | Pipelines |
|---|---|---|---|
| WP-001 | Orchestrator Prompt Preview Script | ✅ COMPLETE | implementation ✅ → qa ✅ → code-review ✅ → documentation ✅ |

All 11 acceptance criteria met. No rework cycles required.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages | 1 / 1 complete |
| Acceptance criteria met | 11 / 11 |
| Rework cycles | 0 |
| Pipeline stages passed | 4 / 4 |
| QA tests passed | 11 |
| QA tests failed | 0 |
| Total pipeline duration | ~9 min 2 sec |
| Files written by default run | 14 |
| Files modified | 3 |

---

## Acceptance Criteria Verification

All 11 criteria were independently verified by both the Developer (live execution during implementation) and the QA agent (independent re-execution):

1. ✅ Default run writes exactly 14 files to `orchestrator/dist/stage-prompts/` and exits 0
2. ✅ `--list` prints exactly 8 stage names, exits 0, creates zero output files
3. ✅ `--stage developer` writes exactly 2 files and exits 0
4. ✅ `--stage pm` writes exactly 1 file and exits 0
5. ✅ `--stage bogus` exits non-zero (code 2) with error referencing the invalid stage name
6. ✅ All output files are valid non-empty Markdown; no `{project_path}` / `{wp_id}` tokens remain; no `{{#if}}` / `{{/if}}` markers present
7. ✅ `-with-wp` and `-without-wp` variants differ (e.g., `developer-with-wp.md` 560 bytes vs `developer-without-wp.md` 99 bytes; 4 occurrences of `WP-001` vs 0)
8. ✅ `node scripts/cli.js preview-prompts` dispatches correctly; `help` output lists `preview-prompts` with `--stage` and `--list` variants
9. ✅ `orchestrator/.gitignore` contains `dist/` as a distinct line entry
10. ✅ No imports of `config`, `graph`, `mcp_client`, or any module requiring `.env` or LLM credentials
11. ✅ `pathlib.Path` used for all path construction; no hardcoded path separators

---

## Pipeline Highlights

### Implementation
- Clean STAGES registry (list-of-dicts) with `name`, `wp_scoped`, `extra_vars` fields — simple, readable, extensible
- `render_and_write` helper cleanly separates rendering from I/O
- Standard `sys.path` bootstrap for importing `prompt_renderer` without package installation
- `argparse` CLI is idiomatic; `--list` produces zero file side-effects (confirmed by QA)
- Duration: ~3 min 2 sec

### QA
- All 11 ACs verified by live execution and static analysis
- `--list` side-effect test: `dist/` directory absent after `--list` run (directory not created at all)
- `--stage bogus` exits with code 2 (argparse error), correctly satisfying "non-zero" requirement
- Duration: ~2 min 43 sec

### Code Review
- One Fix-Forward applied: trailing double-space on `synthesis` row in STAGES registry corrected (non-behavioral whitespace change)
- Without-wp sparse output (99 bytes) confirmed intentional — template `{{#if wp_id}}` gating is by design
- Two documentation-forward items raised and passed to the Documentation agent
- Duration: ~2 min 14 sec

### Documentation
- Module docstring expanded: added CLI usage section, output layout section, and STAGES registry format reference
- `orchestrator/README.md` updated with `### Developer utilities / #### Previewing stage prompts` subsection, full CLI examples, credential-free callout, and `dist/stage-prompts/` entry in the Folder Overview table
- Duration: ~1 min 23 sec

---

## Strategic Recommendations

### 1. Pre-existing Pydantic V1 / Python 3.14 Warning (Technical Debt)
**Priority: Medium** — The `langchain_core` dependency emits a `UserWarning` about Pydantic V1 incompatibility on every Python invocation (including `--list`). This is pre-existing debt unrelated to this WP but now more visible because `preview-prompts.py` is a frequently-used developer tool. The correct fix is upgrading `langchain_core` to a Pydantic V2-compatible version. A short-term mitigation (adding `warnings.filterwarnings('ignore')` to `preview-prompts.py`) would suppress output noise but masks legitimate warnings — prefer the upstream fix.

### 2. STAGES Registry Typing (Minor Code Quality)
**Priority: Low** — `STAGES` is annotated as `list[dict]` and `_BASE_VARS` is a bare mutable dict. Both are safe (neither is mutated at runtime), but making the contract explicit via a `TypedDict` for stage entries and a `MappingProxyType` for `_BASE_VARS` would improve IDE support and make future extension safer.

### 3. Summary Line in `--stage` Mode (Minor DX)
**Priority: Low** — When running `--stage <name>`, the script outputs only `✓` lines without a trailing count line. Adding `"N file(s) written to orchestrator/dist/stage-prompts/"` to single-stage mode would align the UX with the default-run experience.

### 4. Without-WP Template Completeness (Confirm Intent)
**Priority: Low** — The without-wp variants are intentionally sparse (99 bytes: project_path header + one boilerplate line). This is correct per the `{{#if wp_id}}` template design. Future template authors should be aware that adding stage-level content outside WP-conditional blocks is required for it to appear in without-wp renders.

---

## Next Steps

1. **Upgrade `langchain_core`** to resolve the Pydantic V1 / Python 3.14 `UserWarning` that pollutes `stderr` on every orchestrator Python invocation.
2. **Use `preview-prompts`** as a routine prompt-review tool before agent workflow changes — it provides zero-friction, credential-free inspection of all 8 stage prompts across both conditional variants.
3. **Extend the STAGES registry** if new stage templates are added to the orchestrator — the registry is the single place to add metadata for new stages; the rendering loop requires no changes.
4. **Consider `TypedDict`** for STAGES entries when the registry grows or if typing coverage is added to the orchestrator codebase.
