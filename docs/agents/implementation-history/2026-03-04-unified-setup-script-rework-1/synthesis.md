# Synthesis — Unified Setup Script Rework-1

**Sprint:** `2026-03-04-unified-setup-script-rework-1`
**Completed:** 2026-03-04
**Result:** ✅ All objectives achieved — zero code changes required

---

## Executive Summary

This sprint performed a formal audit of all `child_process` invocations across the 10 `scripts/*.js` files, verified defensive hardening of `findPython()` in `cli.js`, and confirmed the banner semver-extraction regex against the current `changelog.md` format. **All acceptance criteria were already satisfied** by the previous sprint's hardening work. No source code modifications were required.

---

## Audit Findings: `child_process` Call Classification

All 12 call sites across 7 scripts were classified. **0 at-risk sites found.**

| Script | API | Executable | Classification |
|--------|-----|-----------|----------------|
| `cli.js` | `spawnSync` | `'node'` in `runScript()` | ✅ SAFE — `.exe`, no shell needed |
| `cli.js` | `spawn` | `'node'` in `runLongScript()` | ✅ SAFE — `.exe`, no shell needed |
| `cli.js` | `spawnSync` | `sh()` — any cmd, `shell: IS_WIN` | ✅ SAFE — explicit shell guard |
| `cli.js` | `spawnSync` | `.exe` candidates in `findPython()`, `shell: false` | ✅ SAFE — `.exe`, explicit `shell: false` + comment |
| `cli.js` | `spawnSync` | `'node'` in personas `run()` | ✅ SAFE — `.exe`, no shell needed |
| `run-orchestrator.js` | `spawnSync` | `npmCmd` (`npm.cmd` / `npm`), `shell: isWindows` | ✅ SAFE — explicit shell guard |
| `run-gui.js` | `spawn` | `'cmd'` in `openBrowser()`, `shell: false` | ✅ SAFE — `cmd` is `.exe` |
| `run-gui.js` | `spawn` | `'npx'`, `shell: isWindows` | ✅ SAFE — explicit shell guard |
| `check-known-roles.js` | `execSync` | `'npm run build'` | ✅ SAFE — `execSync` uses shell |
| `package-personas.js` | `execSync` | `'node scripts/...'` | ✅ SAFE — `execSync` uses shell |
| `install-hooks.js` | `execSync` | `'git config ...'` | ✅ SAFE — `execSync` uses shell |
| `sync-personas.js` | `execFileSync` | `process.execPath` (node.exe) | ✅ SAFE — `process.execPath` is `.exe` |

Scripts without any `child_process` usage: `build-personas.js`, `bundle-docs.js`, `extract-changelog-entry.js`.

### Key Observations

- **`NPM` constant pattern:** `cli.js` sets `NPM = IS_WIN ? 'npm.cmd' : 'npm'`. This constant is only used inside `sh()`, which applies `shell: IS_WIN`. So on Windows `npm.cmd` is called with `shell: true` — safe. This is a valid alternative to the bare-`npm` + `shell: IS_WIN` pattern; both work correctly.
- **`execFileSync` vs `execSync`:** `sync-personas.js` uses `execFileSync(process.execPath, [...])`. Since `process.execPath` returns the absolute path to the `node` binary (a `.exe` on Windows), this bypasses the `.cmd` EINVAL issue entirely — no shell flag needed.
- **`findPython()` hardening:** Already confirmed at [scripts/cli.js lines 140–151](../../../../../scripts/cli.js): `shell: false` is explicit and the comment `// python, python3, py are .exe on Windows — no shell wrapper needed` is present verbatim.

---

## Banner Regex Review

**`changelog.md` format** (lines 1–3):
```
# AI Insights Changelog

## v1.6.1 - Ledger Personas Improvements
```

**Pattern:** `## v{semver} - {title}`

**Regex in `cli.js` `readVersion()`** ([scripts/cli.js line ~83](../../../../../scripts/cli.js)):
```javascript
// Matches `## v1.2.3` and `## [1.2.3]` style headings.
// Verified against changelog.md format `## v{semver} - {title}` — 2026-03-04.
const m = fs.readFileSync(CHANGELOG_FILE, 'utf8').match(/^##\s+(?:\[|v)?(\d+\.\d+\.\d+)/m);
return m ? `v${m[1]}` : 'unknown';
```

**Verdict:** ✅ Correct and verified.
- `^##\s+` anchors to a changelog heading.
- `(?:\[|v)?` handles both `## v1.2.3` and `## [1.2.3]` formats.
- `(\d+\.\d+\.\d+)` captures the semver cleanly.
- The `m` (multiline) flag ensures `^` matches at each line start.
- The verification comment was already in place from the previous sprint.

**Smoke test output:**
```
AI Insights CLI — v1.6.1
```
Version matches `## v1.6.1 - Ledger Personas Improvements` in `changelog.md`. ✅

---

## Smoke Test Results

All tests run on **Windows / Node.js 22.14.0**.

| Command | Exit Code | Key Output | Result |
|---------|-----------|-----------|--------|
| `node scripts/cli.js help` | 0 | `AI Insights CLI — v1.6.1` | ✅ PASS |
| `node scripts/cli.js check-roles` | 0 | `[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync.` | ✅ PASS |
| `node scripts/cli.js build-personas` | 0 | `Built 14 persona(s) across 1 suite(s) × 2 target(s).` | ✅ PASS |

No EINVAL errors observed. No regressions introduced.

---

## Work Package Summary

| WP | Scope | Result | Code Changes |
|----|-------|--------|-------------|
| WP-001 | Comprehensive `child_process` audit (10 scripts) | ✅ PASS — 0 at-risk sites | None |
| WP-002 | Banner semver regex review | ✅ PASS — regex correct, comment present | None |
| WP-003 | Fix pass + `findPython()` hardening | ✅ PASS — all AC already met | None |
| WP-004 | QA smoke tests (Windows/Node 22) | ✅ PASS — all 3 commands clean | None |

---

## Conclusions

1. **The previous sprint's hardening was complete and correct.** All `spawnSync`/`spawn` call sites that use npm/npx already have `shell: IS_WIN` or `shell: isWindows` guards. No further remediation is needed.

2. **`findPython()` was already hardened.** The explicit `shell: false` and the clarifying comment are both present in the source code, exactly as specified by the plan.

3. **The banner regex is verified clean.** The regex correctly handles the current `## v{semver} - {title}` format, and output of `v1.6.1` was confirmed live against a running Node 22 process.

4. **`scripts/` is fully EINVAL-safe on Node.js 22+.** No further work is needed for this sprint's objectives.

---

## Next Steps / Recommendations

1. **No immediate action required.** The `scripts/` directory is in a fully hardened state against the Node 22+ `.cmd` EINVAL regression.
2. **Future maintenance note:** If a new script is added to `scripts/` that uses `spawnSync`/`spawn` with npm or similar package-manager wrappers, follow the established `shell: IS_WIN` pattern from `sh()` in `cli.js`. The `sh()` utility is the canonical delegate for such calls.
3. **`NPM` constant simplification (optional, out of scope):** The `NPM = IS_WIN ? 'npm.cmd' : 'npm'` constant in `cli.js` could be simplified to just `'npm'` since it is only used inside `sh()` which already applies `shell: IS_WIN`. This is cosmetic and presents no correctness risk either way.
