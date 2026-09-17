# Synthesis Report — Ledger Project Declaration

**Plan:** `2026-09-16-ledger-project-declaration`
**Status:** COMPLETE (16/16 work packages, 0 pending)
**Runner:** claude-code v2.1.273 · server v2.9.0 · ledger v2.4.1

## Executive Summary

This plan gives non-ledger agents and developers direct access to a repository's strategic vision
— previously readable only through the MCP tool `ledger_get_repository_context` — by introducing
an opt-in, project-side `.ledger/` declaration folder and a generated, read-only Markdown mirror,
all managed through a new `ai-insights ledger` CLI command group (`init` / `edit` / `sync`).

The build proceeded in four layers: (1) schema and storage primitives for the declaration file and
a generic atomic-text-write helper; (2) a deterministic strategic-vision renderer and a single
sync choke-point (`syncProjectOutputs()`) that owns every write into a consumer project's working
tree; (3) a three-tier identity resolver (explicit → declared → derived) wiring the declaration
into `ledger_get_repository_context`'s response via a new `mirror` field; and (4) the CLI itself —
a pure decision core (`ledger-project-core.js`), thin `init`/`edit`/`sync` shells, and menu
registration in `scripts/cli.js`. Both Planner personas, the Manifest Curator, and the AGENTS.md
Curator were updated to read from and respect the new mirror as a second, non-authoritative source
of strategic context. The workspace then dogfooded the feature against itself (WP-015), and
WP-016 closed out manifests, changelogs, and version bumps (mcp-server 2.10.0, personas 3.34.0,
root 2.12.0).

All 16 work packages reached COMPLETE with every pipeline stage passing. Three work packages
required rework cycles before passing (WP-006, WP-009, WP-015), each catching a real defect before
merge — none shipped with open blocking issues.

## Metrics

- **Work packages:** 16/16 COMPLETE, 0 pending, 0 blocked.
- **Pipeline health:** 16/16 WPs with all stages passing; 0 stages missing.
- **Rework cycles:** WP-006 (implementation ×2, qa ×2, code-review ×1, security-audit ×1),
  WP-009 (implementation ×1, qa ×1), WP-015 (implementation ×1).
- **Test suite growth:** mcp-server Vitest suite grew from ~4125 to 4217 tests across the feature
  build; `scripts/tests/` grew to 311+ tests. Final regression runs across WP-012–WP-016 all report
  0 failures.
- **Security audits:** 4 WPs carried a `security-audit` stage (WP-006, WP-009, WP-010, WP-015) —
  all passed, with two audits catching and driving fixes for real vulnerabilities during the build
  (see below).
- **Release versions:** mcp-server 2.9.0→2.10.0, personas 3.33.0→3.34.0, root 2.11.0→2.12.0 (all
  minor/additive bumps — no breaking changes).

### Rework Findings Worth Noting (caught before merge)

- **WP-006 (case-insensitive filename bypass):** `resolveOutputPath()`'s reserved-`.ledger/`-filename
  guard used case-sensitive string comparison, which is bypassable on default-configuration macOS
  (APFS) and Windows (NTFS), both case-insensitive filesystems — fixed to compare case-insensitively.
- **WP-006 (silent `enabled` clobbering):** `loadProjectDeclaration()`'s per-output deep merge let
  Zod's `.default(false)` fabricate an `enabled` value during local-override parsing, silently
  disabling an output whenever a local override touched it without repeating `enabled`. Fixed via a
  dedicated `*Local` schema variant with no `.default()`, applying the default only post-merge — a
  pattern flagged by the Reviewer as reusable for any future "declared vs. omitted" partial-config
  merge.
- **WP-009 (symlink path-traversal, HIGH):** `syncProjectOutputs()` — the plan's designated D1
  consent-enforcement choke-point — validated output paths lexically only (`path.resolve`/`path.relative`),
  so a symlink planted under an allowlisted output path could redirect a write entirely outside the
  project root. Fixed with `assertRealPathWithinRoot()` (an `fs.realpath`-based walk to the deepest
  existing ancestor, rejecting on real-path escape) running ahead of every read/write/unlink.
- **WP-009 (EISDIR crash, MEDIUM):** a directory-shaped declared output path (e.g. `.`) crashed the
  sync function instead of returning a graceful `blocked` record — fixed with an up-front `fs.stat()`
  guard (`directoryBlockReason()`).

## Blockers / Deferred Items Requiring Attention

- **WP-015 — `.claude/settings.json` PreToolUse deny-hook (DEFERRED, human action required).**
  AC-25 originally required a `PreToolUse` hook denying `Write`/`Edit` under `.ledger/**`. No agent
  in this harness can create `.claude/settings.json` directly: the harness's own self-modification
  guardrail blocks Write/Edit calls targeting that path (it configures the session's own
  permission/hook system). The Developer confirmed a Bash-heredoc workaround technically succeeds
  but deliberately reverted it rather than bypass the denial. The Project Manager, with the human
  project owner's explicit sign-off, reworded AC-25 to drop this clause from pipeline scope. The
  exact hook content needed is preserved in WP-015's pipeline history:
  ```json
  {
    "hooks": {
      "PreToolUse": [{
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "condition": "file_path matches /(^|[\\/\\\\])\\.ledger[\\/\\\\]/",
          "action": { "permissionDecision": "deny" }
        }]
      }]
    }
  }
  ```
  **Action needed:** the human should add `.claude/settings.json` with this hook outside the agent
  pipeline.
- **WP-015 — uncommitted dogfooding artifacts.** Five files
  (`.ledger/settings.json`, `.ledger/README.md`, `.ledger/strategic-vision.md`, `.gitignore`,
  `.githooks/pre-commit`) plus two documentation edits (`AGENTS.md`, `CLAUDE.md`) were git-add-staged
  but never committed, per the Git Safety Protocol (no agent commits without explicit request). QA,
  Security Auditor, Reviewer, and Documentation all carried forward the same standing note: commit
  these together (ideally alongside `.claude/settings.json` once the human adds it) as one coherent
  "this workspace is declared" commit.

## Strategic Recommendations (Gold Nuggets)

- **Schema-level "declared vs. omitted" pattern (WP-006):** when merging a partial local-override
  config over a full base config with Zod, give the local-file schema variant no `.default()` on
  optional fields (so "omitted" parses to `undefined`, not a fabricated default), and apply the
  default only once, after the merge. Reusable anywhere a similar local/base merge is needed.
- **Defense-in-depth for filesystem write choke-points (WP-009):** a single sync function combining
  a lexical allowlist check, a real-path (symlink-aware) re-validation, and a directory-shape guard
  — all ahead of any I/O — was called out by both the Security Auditor and Reviewer as an exemplary
  pattern for any future "designated consent enforcement point" in this codebase.
- **Core/shell split for interactive CLIs (WP-011/WP-012):** the pure decision core
  (`ledger-project-core.js`) with zero prompting, no filesystem writes, and no `process.exit`,
  wrapped by thin `init`/`edit`/`sync` shells, directly followed the `launch-agent-core.js`
  precedent and made the wizard/flag-equivalence acceptance criterion (AC-27) straightforward to
  test. Recommended as the default shape for future interactive CLI verbs in this workspace.
- **Bridge generalization (WP-002):** `scripts/lib/ledger-bridge.js`'s `loadDistModule()` — a single
  generalized, cached, freshness-checked dist-loader — replaced what would have been a third or
  fourth near-identical loader file. Worth keeping as the canonical route for any future root-level
  script that needs to reach compiled `mcp-server/dist/` logic.
- **Write-consent design principle reaffirmed:** the plan's "consent lives in the thing being
  written into" rationale (a declaration file rather than a registry-side path field) held up
  through implementation and both security audits — no findings challenged the underlying model.

## Code Insights (grouped by agent)

### Developer
- The `*Local` schema-variant technique (WP-006) for correctly merging declared-vs-omitted partial
  config is a clean, reusable pattern for any future Zod schema pair with the same merge shape.
- `assertRealPathWithinRoot()`'s "walk up to the deepest existing ancestor" strategy (WP-009) is
  the correct approach when validating a path that may not exist yet (the common case for an
  about-to-be-created output file).
- `storeRepoMove()`'s target-before-source mutation ordering (WP-007) is a good reusable pattern for
  non-transactional multi-file moves.
- `performSync()`/`performSyncCheck()` (WP-013) share one data-producing `syncProjectOutputs()` call
  with two small presentational formatters (past-tense vs. present-tense) rather than branching
  tense logic inside one formatter — a reusable shape for future write/check-mode CLI pairs.

### QA
- Flagged (WP-005) that plan AC-24's literal "run in Audit mode" wording does not apply to the
  AGENTS.md Curator, which removed Audit mode in its own v2.0.0 changelog in favor of Update mode's
  diff/reconcile/report cycle — a pre-existing plan-drafting inconsistency, not an implementation
  defect. Functional intent (report the gap, never write inside `.ledger/`) was independently
  confirmed met via Update mode.
- WP-013's QA session had no Bash/shell tool available and relied on static code review — flagged
  as a medium-priority follow-up; code-review in the same WP independently re-ran the full test
  suite and closed the gap.

### Security Auditor
- WP-006: flagged (non-blocking, carried forward) that `resolveOutputPath()`'s traversal guard was
  lexical-only with no symlink/realpath re-validation — correctly anticipated this would become
  exploitable once WP-009 gave the function a real write-path caller, which is exactly what
  happened and was then fixed in WP-009's rework cycle.
- WP-009: after the symlink-escape fix, recorded four Low/Info hardening observations for future
  awareness: a residual TOCTOU race between the realpath check and the actual I/O call; the
  pre-existing predictable temp-filename pattern in `atomicWriteText()` (unmodified by this
  feature); unescaped Markdown interpolation of vision content (only a risk if a future consumer
  renders it as HTML); and a suggestion to document a warning against declaring output paths at
  security-sensitive locations like `.git/hooks`.

### Reviewer
- WP-007: flagged a stale doc/code naming mismatch in `store-commands.js`'s module doc comment
  (`_configPath` vs. actual `configPath`) — fixed in the following documentation pass.
- WP-012: applied a direct Fix-Forward — `printAdvisories()` only filtered by `skipIds`, never by
  each advisory's own `applicable` flag, so the non-interactive `init` path could print an
  inapplicable gitignore advisory. Fixed in-place (non-behavioral, console text only).
- WP-013: noted `runSync()` intentionally duplicates ~15 lines of `runEdit()`'s project-root
  resolution and error messaging, documented in the module as a deliberate scope boundary between
  `sync`'s zero-prompt contract and `edit`'s interactive one — flagged as a future extraction
  candidate only if a third verb needs the same resolution step.

### Documentation
- Consistently caught stale manifest content trailing behind implementation across nearly every WP
  (e.g., WP-002's `api-surface.md` still describing `findEntryInStores()` as GUI-private after its
  relocation; WP-008's manifest still describing the old fully-gated `## Strategic Context` shape;
  WP-016 finding `data-flows.md` had zero content on the entire declaration/identity/sync feature
  despite `api-surface.md`/`file-tree.md` already being complete). This confirms the plan's own
  per-WP documentation-pass discipline is pulling real weight — each of these gaps was closed the
  same pipeline cycle it was introduced in, not deferred to WP-016 wholesale.

## Deferred & Follow-Up Items

- **[DEFERRED — human action] `.claude/settings.json` PreToolUse deny-hook.**
  Source: WP-015. Originating agent: Project Manager (decision), Developer (blocker report).
  Description: a `PreToolUse` hook denying `Write`/`Edit` under `.ledger/**` could not be created by
  any agent in this harness due to a self-modification guardrail. Priority: medium — data-integrity
  nicety for the generated mirror, not an attacker-exploitable control per the Security Auditor.
  Exact hook content is preserved above and in WP-015's pipeline comments.
- **[DEFERRED — human action] Commit WP-015's dogfooding artifacts.**
  Source: WP-015 (carried through QA, Security Audit, Code Review, Documentation). Description:
  five files plus two documentation edits remain staged-but-uncommitted per the Git Safety
  Protocol. Priority: medium — recommend committing once `.claude/settings.json` is added, as one
  coherent commit.
- **[OUT-OF-SCOPE, explicitly noted] `.githooks/pre-commit` refactor into a testable guard registry.**
  Source: WP-015 plan notes. Description: the plan explicitly bounded WP-015's pre-commit change to
  a single advisory block in the existing style; refactoring the hook script into a
  cross-platform, testable guard registry was called out as a deferred item for a future plan.
- **[OUT-OF-SCOPE, low priority] Symlink-at-leaf regression test.**
  Source: WP-009 QA. Description: QA manually verified (but did not add an automated test for) a
  symlink placed at the leaf output file itself, as opposed to an intermediate directory —
  confirmed to be blocked correctly by the same guard, but no permanent regression test exists for
  this specific variant.
- **[OUT-OF-SCOPE, low priority] EISDIR-adjacent `.`/`.ledger/` directory-shaped path edge case.**
  Source: WP-006 QA (originally), resolved defensively in WP-009. Fully closed by WP-009's
  `directoryBlockReason()` guard — no further action needed, listed here only for traceability
  since it was carried across two WPs before being closed.
- **[OUT-OF-SCOPE, low priority] TOCTOU race in `assertRealPathWithinRoot()`.**
  Source: WP-009 security audit. Description: a residual time-of-check-to-time-of-use race exists
  between the realpath validation and the actual filesystem write. Recorded as Low/Info, not
  blocking, no action taken in this plan.
- **[COVERAGE GAP, low priority] `cmdLedger`/`runLedgerInference` glue code in `scripts/cli.js`.**
  Source: WP-014 Developer and QA. Description: no automated tests cover the CLI dispatch glue
  itself (only the underlying `chooseDefaultVerb()` core is unit-tested); verified manually via a
  real pty session across all four inference branches. Deferred as acceptable given the thin-wrapper
  nature of the code.

## Next Steps

1. **Human follow-up (highest priority):** add `.claude/settings.json` with the documented
   PreToolUse hook, then commit the five staged WP-015 files (plus the hook file) as one coherent
   "workspace declares itself" commit.
2. **Consider a small follow-up plan** for the `.githooks/pre-commit` guard-registry refactor if
   more advisory/blocking checks are anticipated — the current file-based pattern is explicitly
   flagged as not scaling indefinitely.
3. **Optional hardening pass:** add the two low-priority regression tests noted above (leaf-symlink
   case in `sync.test.ts`; `cmdLedger` inference-branch coverage in `scripts/cli.js`) if this CLI
   surface sees active follow-on development.
4. **Feature is otherwise release-ready:** all manifests, changelogs, and version bumps are in
   place (mcp-server 2.10.0, personas 3.34.0, root 2.12.0); the workspace itself is dogfooding the
   feature via its own `.ledger/` declaration.
