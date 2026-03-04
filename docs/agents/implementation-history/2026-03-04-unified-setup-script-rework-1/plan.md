# Plan

## Summary

This rework sprint addresses the two next-step recommendations from the `2026-03-04-unified-setup-script` synthesis. The primary objective is to formally audit every `child_process` invocation across `scripts/*.js` for Node.js 22+ `spawnSync` + `.cmd` EINVAL exposure, resolve any remaining unsafe call sites, and add defensive hardening where needed. A secondary objective is to review the `cli.js` banner version-extraction regex against the current `changelog.md` format to confirm it remains correct (or fix it if it has drifted).

---

## Architectural Context

The synthesis sprint fixed two confirmed Blocker instances of the Node.js 22 regression (B-001 in `cli.js`, B-003 in `run-orchestrator.js`). The root cause is that Node.js 22+ refuses to execute `.cmd` files via `spawnSync`/`spawn` without `shell: true`, throwing `EINVAL`. `execSync` is immune because it already routes through the system shell by default.

At time of writing, the `scripts/` directory contains 10 scripts:

| Script | `child_process` API used |
|--------|--------------------------|
| `cli.js` | `spawnSync`, `spawn` |
| `run-orchestrator.js` | `spawnSync` |
| `run-gui.js` | `spawn` |
| `check-known-roles.js` | `execSync` |
| `package-personas.js` | `execSync` |
| `install-hooks.js` | `execSync` |
| `sync-personas.js` | `execFileSync` |
| `build-personas.js` | none |
| `bundle-docs.js` | none |
| `extract-changelog-entry.js` | none |

The safe fix pattern established by the previous sprint:

```javascript
const IS_WIN = process.platform === 'win32';
spawnSync('npm', ['install'], { cwd, stdio: 'inherit', shell: IS_WIN });
```

The banner version-extraction code lives in `scripts/cli.js` (around line 60–80). It reads the workspace `changelog.md` and applies a semver regex to extract the current version for the ASCII art banner.

---

## Approach / Architecture

**Step 1 — Systematic audit.** Enumerate every `child_process` call across all 10 scripts, classify each as safe or at-risk using the decision table below, and produce a concise findings document.

**Safe classification criteria:**
- Uses `execSync` or `execFileSync` → inherently shell-routed on Windows; not affected by the `.cmd` EINVAL regression.
- Uses `spawnSync`/`spawn` with `shell: IS_WIN` (or equivalent) already in place.
- Uses `spawnSync`/`spawn` with a plain executable name (e.g., `node`, `git`, `python`, `.exe` file) that does not require the shell wrapper.

**At-risk classification criteria:**
- Uses `spawnSync`/`spawn` with a `.cmd`-suffixed binary name and `shell` is absent or `false`.
- Uses `spawnSync`/`spawn` with `npm`, `pip`, `npx`, or other package-manager wrappers and `shell` is absent or `false` on a Windows codepath.

**Step 2 — Fix at-risk call sites.** For each at-risk site, apply the established fix pattern.

**Step 3 — Defensive hardening of `findPython()`.** The `findPython()` helper in `cli.js` (line ~140) calls `spawnSync(cand, a, { encoding: 'utf8' })` where `cand` ∈ `['python', 'python3', 'py']`. These are `.exe` files on Windows, not `.cmd`, so they do not trigger the EINVAL bug. However, the call has no `shell` option at all, inconsistent with the rest of `cli.js`'s defensive posture. Add `shell: false` explicitly (the intent) and a comment explaining why no shell is needed for `.exe` candidates, for future-proofing and code-clarity.

**Step 4 — Banner semver regex review.** Read the current `changelog.md` header format and verify that the regex in `cli.js` correctly extracts the version. If the regex is brittle or drift has occurred, update it to a more robust pattern (e.g., anchored match on the first `## [x.y.z]` heading).

---

## Rationale

- The audit is scoped to `scripts/*.js` only (the synthesis recommendation). No other directories (`mcp-server/`, `orchestrator/`) are in scope.
- `execSync`/`execFileSync` calls do not need remediation — they route through the shell by default. Including them in findings as "confirmed safe" ensures the audit is formally complete.
- The `findPython()` hardening is defensive rather than corrective — the current code works correctly. The change adds an explicit `shell: false` with a clarifying comment so future developers understand the deliberate choice.
- The banner regex review is low-risk and low-effort but converts a "worth noting" risk into a verified-clean status or a concrete fix.

---

## Detailed Steps

1. **Audit `scripts/*.js`** — Read each of the 10 scripts and enumerate every `child_process` call site. Record the API, the executable string, whether `shell` is set, and the safe/at-risk classification.
2. **Fix any at-risk `spawnSync`/`spawn` call sites** — Apply `shell: IS_WIN` (or `shell: isWindows` for scripts that use that variable) and remove `.cmd` suffixes in favor of the bare executable name where applicable.
3. **Harden `findPython()` in `cli.js`** — Add explicit `shell: false` to the `spawnSync` call and a one-line comment: `// python, python3, py are .exe on Windows — no shell wrapper needed`.
4. **Review the `changelog.md` format** — Read lines 1–10 of `changelog.md` to confirm the header format.
5. **Review the semver extraction code in `cli.js`** — Locate the changelog read + regex logic. Test the regex against the current changelog format. If it correctly extracts the version, add a comment confirming verified compatibility. If it fails or is brittle, update the regex to an anchored `## [x.y.z]` pattern.
6. **QA smoke test** — Run `node scripts/cli.js help` and `node scripts/cli.js check-roles` on Windows/Node 22 to confirm no new regressions. Verify the banner displays the correct version.

---

## Dependencies

- `scripts/cli.js` — primary file modified (findPython hardening + banner regex)
- `scripts/run-orchestrator.js` — read for audit confirmation
- `scripts/run-gui.js` — read for audit confirmation
- `scripts/check-known-roles.js` — read for audit confirmation
- `scripts/package-personas.js` — read for audit confirmation
- `scripts/install-hooks.js` — read for audit confirmation
- `scripts/sync-personas.js` — read for audit confirmation
- `changelog.md` — read for banner regex validation

---

## Required Components

- `scripts/cli.js` — modified (defensive `findPython` hardening; banner regex update if needed)
- Optionally: any other script where an at-risk call site is confirmed (expected: none based on preliminary research)

---

## Assumptions

- Node.js 22.14.0 is the target runtime (same as the QA environment in the previous sprint).
- Only files under `scripts/*.js` are in scope. `mcp-server/` scripts and the `orchestrator/` Python layer are out of scope.
- The `execSync`/`execFileSync` APIs are classified as safe without further remediation; they may appear in findings as "confirmed safe" for documentation completeness.
- The banner semver regex currently works (it was executing correctly during the previous sprint's smoke tests); the review step is a verification pass, not a known fix.

---

## Constraints

- Zero new external dependencies.
- No changes to script public interfaces (argument handling, exit codes, output format).
- The `findPython()` hardening must not change observable behaviour — the fix is additive (explicit `shell: false` is the current implicit default when `shell` is omitted from `spawnSync`).

---

## Out of Scope

- `mcp-server/` TypeScript source — separate release cycle.
- `orchestrator/` Python code — different runtime, entirely different spawn model.
- Adding `extract-changelog-entry.js` to the interactive CLI menu (synthesis note 3; explicitly deferred).
- The two-level CLI menu refactor for future growth (synthesis note 2; no action needed now).
- Any changes to `package.json`, `tsconfig.json`, or test files.

---

## Acceptance Criteria

- All 10 scripts in `scripts/` have been read and classified.
- No unguarded `spawnSync`/`spawn` calls using `.cmd` suffixes or npm/pip/npx wrappers without `shell: IS_WIN` remain after the fix pass.
- `findPython()` in `cli.js` has an explicit `shell: false` and a clarifying comment.
- The `cli.js` banner semver extraction regex is verified against the current `changelog.md` format; either confirmed correct (comment added) or updated to a robust pattern.
- `node scripts/cli.js help` runs without error, displaying the correct version in the banner.
- `node scripts/cli.js check-roles` runs without error on Windows/Node 22.

---

## Testing Strategy

**Manual smoke tests (Windows / Node.js 22.14.0):**
1. `node scripts/cli.js help` — verify banner version matches current `changelog.md` entry.
2. `node scripts/cli.js check-roles` — verify the roles parity check runs cleanly.
3. `node scripts/cli.js build-personas` — verify persona build delegates correctly.
4. Inspect each modified call site through code review to confirm the fix pattern is correctly applied.

No new automated tests are required for this housekeeping sprint. The existing Vitest suite for `mcp-server/` is unaffected.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Audit confirms additional at-risk call sites** | Apply the established fix pattern immediately; add to the findings document. Scope is small (10 files total). |
| **`findPython()` `shell: false` change causes unexpected Python discovery failure** | `shell: false` is identical to the current implicit default when `shell` is omitted; behaviour is unchanged. Verify with a `node -e "require('./scripts/cli.js')"` smoke call if in doubt. |
| **Changelog format has drifted; banner regex fails** | Read the changelog header during Step 4 before editing. If the format has changed, update the regex to match the `## [x.y.z]` — entry format used throughout the project's changelogs. |
| **Node.js version upgrade beyond 22 introduces further regressions** | Out of scope for this sprint. The `shell: IS_WIN` pattern is durable across Node.js versions. |
