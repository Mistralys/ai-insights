# Project Synthesis Report

**Project:** `2026-03-16-wp-agent-assignments-gui-rework-1`
**Date:** 2026-03-16
**Status:** ALL 6 WORK PACKAGES COMPLETE

---

## Executive Summary

This session delivered a targeted security hardening and code quality pass across the MCP server's GUI layer (`mcp-server/gui/`) and its test infrastructure. The work comprised three security fixes, one TypeScript type improvement, one API enhancement to expose server-side pipeline stage configuration to the client, a documentation correction in `api-surface.md`, and a new jsdom-based test suite that closes a long-standing client-side rendering coverage gap.

Two production bugs were also identified and fixed during the session — one in the GUI (XSS in a tooltip attribute) and one in the MCP server core (`begin-work.ts` Guard 3 ignoring `active_pipeline_stages`). Both are resolved and compiled.

---

## Work Package Results

| WP | Title | Pipelines | Result |
|----|-------|-----------|--------|
| WP-001 | XSS Fix — `buildWpDetailBar` tooltip | impl → qa → security-audit → code-review | PASS |
| WP-002 | TypeScript type narrowing in `gui/api.ts` | impl → code-review | PASS |
| WP-003 | Path traversal hardening in `serveStatic()` | impl → qa → security-audit → code-review | PASS |
| WP-004 | `api-surface.md` GUI frontend section correction | code-review → documentation | PASS |
| WP-005 | Expose `default_pipeline_stages` in WP detail API | impl → qa → security-audit → code-review | PASS |
| WP-006 | jsdom test suite for client-side rendering | impl → qa → code-review | PASS |

---

## Metrics

### Test Suite Health

| Metric | Value |
|--------|-------|
| Starting test count | 1,302 |
| Net tests added | +19 (3 from WP-005 API test, 16 from WP-006 client-rendering) |
| Final test count | 1,321 |
| Test files | 43 |
| Regressions | **0** |
| TypeScript errors (`tsc --noEmit`) | **0** |

### Security Findings (across all audited WPs)

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | Open (advisory — future WP) |
| Low | 3 | Open (advisories — future WP) |
| Info | 2 | Noted |

---

## Bugs Fixed

### 1. XSS in `buildWpDetailBar` tooltip (OWASP A03 — Injection)

- **File:** `mcp-server/gui/public/views/work-package.js` line 43
- **Fix:** Wrapped `rawSt` with `escapeHtml()` before inserting into `title` attribute.
- **Verification:** Full security audit + QA pass. Both targeted attack vectors (malicious `active_pipeline_stages`, malicious pipeline status) confirmed neutralised.

### 2. `begin-work.ts` Guard 3 — wrong pipeline prerequisites map (HIGH)

- **File:** `mcp-server/src/tools/begin-work.ts`
- **Root cause:** Guard 3 used the legacy static `PIPELINE_PREREQUISITES` map instead of `resolvePrerequisite()`, causing `ledger_begin_work` to incorrectly require QA even when it was excluded from `active_pipeline_stages`.
- **Fix:** Replaced `PIPELINE_PREREQUISITES` lookup with `resolvePrerequisite(type, activeStages)` and passed `activeStages` to `checkRevalidationGuard`.
- **Two regression tests added** to `tests/tools/begin-work.test.ts`.
- **Status:** Fixed, compiled to `dist/`. **Requires MCP server restart (VS Code reload) to activate.**

---

## Deliverables

| File | Change |
|------|--------|
| `mcp-server/gui/public/views/work-package.js` | `escapeHtml(rawSt)` in tooltip (WP-001) |
| `mcp-server/gui/api.ts` | Type narrowing: `PipelineType`, `WorkPackageStatus` (WP-002); `WorkPackageDetailResponse` type + `default_pipeline_stages` in response (WP-005) |
| `mcp-server/gui/server.ts` | `resolve(filePath)` canonicalization in `serveStatic()` (WP-003) |
| `mcp-server/src/tools/begin-work.ts` | Guard 3 `resolvePrerequisite()` fix (project comment) |
| `mcp-server/tests/tools/begin-work.test.ts` | 2 regression tests for WP-specific pipeline prerequisite logic |
| `mcp-server/tests/gui/api.test.ts` | New test: `default_pipeline_stages` present and array (WP-005) |
| `mcp-server/tests/gui/client-rendering.test.ts` | New file: 16 jsdom tests for `buildWpDetailBar` and `buildPipelineTrack` (WP-006) |
| `mcp-server/package.json` | `jsdom` added as devDependency (WP-006) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | GUI frontend file table (3 → 12 entries), per-module headings replace catch-all `app.js structure:` section (WP-004) |

---

## Open Advisories — Future Hardening WP

The following items were flagged by the Security Auditor and Reviewer pipelines. None block the current release. They are candidates for a dedicated hardening work package.

### Medium Priority

1. **Unescaped `cls` in `renderWorkPackageDetail`** (`views/work-package.js` ~line 68)
   - `var cls = (p.status || '').toLowerCase().replace(/ /g, '_')` is injected into a class attribute without escaping.
   - Currently safe because `p.status` is Zod-enum-validated server-side, but a tampered ledger JSON would bypass this.
   - Recommendation: replace with a whitelist mapping (matching the pattern already used in `statusBadge()`), or apply `escapeHtml(cls)` before insertion.

2. **Missing `serveStatic` path traversal test** (flagged by 3 agents across 3 WPs)
   - No automated test verifies that `../../` URL segments are rejected with 404.
   - Recommendation: add a `serveStatic` integration test in `tests/gui/`.

### Low Priority

3. **`escapeHtml()` does not encode single quotes** (`utils.js`)
   - Current attributes are all double-quoted, so no active exploit path.
   - Recommendation: add `.replace(/'/g, '&#39;')` to the chain as defence-in-depth.

4. **`readFile(filePath)` after guard passes uses un-normalized path** (`server.ts`)
   - After `resolve(filePath)` guard prove the path safe, `readFile(filePath)` reads the original. Functionally equivalent but inconsistent.
   - Recommendation: use `readFile(resolved)` throughout for self-documenting clarity.

5. **`startsWith(PUBLIC_DIR)` lacks trailing path separator** (`server.ts`)
   - Hypothetical sibling directory (`/public-extra`) would pass the guard incorrectly.
   - In practice unreachable via `join(PUBLIC_DIR, …)`, but the pattern is fragile.
   - Recommendation: append `path.sep` to `PUBLIC_DIR` in the `startsWith` call, or use a dedicated `containsPath()` helper.

---

## Documentation Debt

- ~~**`api-surface.md` REST endpoint count**: Still reads "14 REST endpoints". The actual `api-client.js` exposes 19 methods, including `renameSlug` and `getWorkPackageOverview` not mentioned in the old description. Recommend a follow-up doc-debt WP.~~ **RESOLVED 2026-03-16** — Updated count to 19 and added all 19 method signatures (`renameSlug`, `getWorkPackageOverview`, and 10 others that were missing) to `api-surface.md`.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Formalise the "CSS class from Zod enum" coding convention

The pattern `(field).toLowerCase().replace(/ /g, '_')` used as a CSS class is safe *only* when the field is a closed Zod enum. This rule is currently tacit. Add a one-line comment at each usage site (`utils.js statusBadge`, `renderWorkPackageDetail`), or add an entry to `mcp-server/docs/agents/project-manifest/constraints.md`:

> *CSS class derivation from raw API values is only safe when the field is a Zod-enum-validated type. For non-enum fields, apply `escapeHtml()` or a whitelist map.*

### 2. Strengthen the `WorkPackageDetailResponse` type pattern

The type intersection approach (`WorkPackageDetail & { default_pipeline_stages: string[] }`) is correct and minimal. The existing API test validates presence and non-empty array shape; a future improvement should assert deep equality against `DEFAULT_PIPELINE_STAGES` to guard against accidental constant drift.

### 3. `vm.runInThisContext()` as the correct jsdom test loading idiom

For all future client-side JavaScript tests under Vitest's ESM module scope, use `vm.runInThisContext(readFileSync(..., 'utf8'))` — not `eval()`. `eval()` does not register `var`-declared globals onto `globalThis` in Vitest's module scope. This pattern is now established in `tests/gui/client-rendering.test.ts` and should be the template for any future client-side view tests.

### 4. Resolve the `path.resolve()` vs `fs.realpathSync()` symlink gap

`path.resolve()` normalises `..` segments but does **not** follow symlinks. The `serveStatic()` guard is therefore insufficient against symlink-based traversal (Low risk — requires local write access to `PUBLIC_DIR`). If the threat model ever expands beyond localhost, replace `resolve(filePath)` with a `try/catch` around `fs.realpathSync(filePath)` as a complete guard.

---

## Ledger / Orchestration Incidents (For Infrastructure Team)

The following routing issues were observed during this session. They do not affect code correctness but should be addressed in the ledger system.

| # | Severity | Tool | Symptom | Workaround |
|---|----------|------|---------|------------|
| 1 | **HIGH** (fixed) | `ledger_begin_work` | Guard 3 used legacy `PIPELINE_PREREQUISITES` map, ignoring `active_pipeline_stages`. QA required even when excluded. | Fixed in `begin-work.ts` — restart MCP server. |
| 2 | Medium | `ledger_get_next_action` | Routing loop for WPs with `[code-review, documentation]` stages — `RUN_REVIEW` triggers itself indefinitely after code-review PASS. Root cause: router counts own PASS as new upstream trigger (self-referential `hasNewUpstreamPassSince`). | Call `ledger_get_handoff_status` directly when loop detected. |
| 3 | Low | `ledger_get_handoff_status` | Returns "N work packages still need QA" for WPs whose QA pipeline is PASS but WP is still `IN_PROGRESS` (waiting for code-review). Assignment-based check gives false-positive. | Use `ledger_get_next_action` as the authoritative signal. `WAIT` = done. |

---

## Next Steps for Planner / Manager

1. **Restart MCP server** — the `begin-work.ts` Guard 3 fix is compiled but requires a VS Code reload to activate in the live process.
2. **Create a hardening WP** targeting: unescaped `cls` in `renderWorkPackageDetail` (Medium), missing traversal test (Medium), `escapeHtml()` single-quote gap (Low).
3. **Fix the `ledger_get_next_action` routing loop** for `[code-review, documentation]` stage configurations — self-referential upstream trigger logic.
4. **Update `api-surface.md` REST endpoint count** from 14 to 19 and add `renameSlug` / `getWorkPackageOverview` to the API listing.
5. **Add a `containsPath()` helper** or amend `startsWith(PUBLIC_DIR)` to include `path.sep` in `server.ts`.
