# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Prior Project Context
The strategic vision's short-term goal emphasizes low-friction onboarding and daily developer usage. This plan directly serves that goal by replacing an undocumented, ad-hoc `npm link` workflow with a scripted, guarded, and documented procedure. No prior project has addressed local sibling-repo linking.

## Summary
Give `ai-insights` a one-command way to switch between DEV mode (local symlinks to sibling `ai-persona-builder` and `cli-menu` repos) and PROD mode (npm-registry-resolved dependencies), with a clear mode indicator visible in the CLI status line and a pre-commit guard that blocks any commit carrying `file:` paths or a DEV-mode marker in tracked package files.

## Architectural Context

Two external npm packages are consumed by ai-insights:

| Package | Consumed In | Current Version Spec |
|---------|------------|---------------------|
| `@mistralys/persona-builder` | `personas/package.json` | `^2.6.0` |
| `@mistralys/cli-menu` | root `package.json` | `^1.1.0` |

The workspace CLI (`scripts/cli.js`) is the user-facing command center — it uses `@mistraljs/cli-menu`'s `createMenu()` and registers all commands in the `COMMANDS` array. Health checks in `scripts/lib/health-checks.js` feed the CLI status line. The `.githooks/pre-commit` hook runs blocking guards before every commit.

The `release-check` skill (`.github/skills/release-check/SKILL.md`, step 3a) correctly rejects `file:` resolved paths in `personas/package-lock.json` — this guard must be preserved. `npm link` is the safe alternative because it only touches the gitignored `node_modules/` tree, never `package.json` or `package-lock.json`.

The existing `docs/references/development.md` **incorrectly advises** switching to a `file:` path for cli-menu local dev — this must be corrected.

## Approach / Architecture

### Two-Mode Model

The workspace operates in one of two dependency modes:

- **PROD** (default): Dependencies resolved from the npm registry via `package-lock.json`. This is the normal state and the only state valid for commits, CI, and releases.
- **DEV**: One or both sibling packages are symlinked into `node_modules/` via `npm link`. Safe — `package.json` and `package-lock.json` remain untouched. Fully reversible via `npm install`.

### Mode Marker

A `.dev-links.json` marker file in the workspace root tracks which packages are currently linked. This file is **gitignored** and serves as the source of truth for the health check status line, the pre-commit guard, and the unlink command.

```json
{
  "linked": {
    "@mistralys/persona-builder": "../ai-persona-builder",
    "@mistraljs/cli-menu": "../cli-menu"
  },
  "linked_at": "2026-08-25T14:30:00Z"
}
```

### Components

1. **`scripts/dev-link.js`** — Link/unlink logic. Two modes: `link` (build sibling, `npm link` from sibling, `npm link <pkg>` into consumer, write marker) and `unlink` (`npm install` in consumer dirs, remove marker).
2. **CLI command** — `dev-link` / `dev-unlink` entries in `COMMANDS` array in `scripts/cli.js`.
3. **Health check** — Instant-tier check in `health-checks.js` that reads `.dev-links.json` and reports DEV mode in the status line.
4. **Pre-commit guard** — New check in `.githooks/pre-commit` that rejects commits when `.dev-links.json` exists or when staged `package-lock.json` files contain `file:` resolved paths.
5. **Documentation** — Corrected `development.md`, new section in personas `tech-stack.md`.

## Rationale

- **`npm link` over `file:` paths**: `npm link` only touches `node_modules/` (gitignored), leaving `package.json` and `package-lock.json` untouched. `file:` paths pollute tracked files and break CI on any machine without the sibling repo at the exact relative path. The `release-check` skill already enforces this — the plan aligns with it.
- **Marker file over symlink detection**: Checking whether `node_modules/@mistraljs/…` is a symlink requires `fs.lstatSync()` and is fragile (npm can create symlinks for hoisted packages too). A dedicated marker file is explicit, fast to read, and carries metadata (which packages, when linked).
- **Single script for both packages**: Both `persona-builder` and `cli-menu` follow the identical pattern (sibling repo, tsup build, `npm link`). A single parameterized script avoids duplication.
- **Blocking pre-commit over advisory**: A `file:` path in a committed lock file silently breaks CI. This is a hard failure mode, not a quality preference — blocking is appropriate.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Link mechanism | `npm link` (symlink in `node_modules/`) | `file:` protocol in `package.json`; npm workspaces; pnpm link | `npm link` is the only option that leaves tracked files untouched — `file:` pollutes `package-lock.json`, npm workspaces require restructuring into a monorepo, pnpm would change the package manager |
| Mode detection | `.dev-links.json` marker file (gitignored) | `fs.lstatSync()` symlink detection on `node_modules/` dirs; environment variable | Marker file is explicit, carries metadata, works even when `node_modules/` is absent (freshly cloned), and doesn't require walking `node_modules/` |
| Pre-commit guard scope | Check both marker file AND staged lock files for `file:` paths | Marker-only check; lock-file-only check | Belt-and-suspenders: the marker catches the intentional DEV state, the lock-file grep catches accidental `file:` contamination from any source (not just our linking workflow) |
| Script location | `scripts/dev-link.js` as standalone script | Logic inline in `scripts/cli.js`; logic in `scripts/lib/` | Standalone script keeps the CLI entry point lean; `lib/` is for importable helpers, not runnable commands with side effects |

## Pattern Alignment

- **CLI command pattern** — follows the existing `COMMANDS` array structure with `{ id, key, label, category, description, run }` — `scripts/cli.js` L846+
- **Health check pattern** — follows the existing `HEALTH_CHECKS` instant-tier pattern with `{ id, label, cost, detect(), fix }` — `scripts/lib/health-checks.js` L138+
- **Pre-commit guard pattern** — follows the existing blocking-check pattern (`command || exit 1`) — `.githooks/pre-commit` L14–L17
- **Script delegation pattern** — CLI command delegates to a standalone script, matching `cmdImportStandalone` → `scripts/import-standalone.js` — `scripts/cli.js`
- **Gitignore pattern** — marker file gitignored, matching `.env`, `node_modules/`, `dist/` — `.gitignore`

## Detailed Steps

### Step 1: Create `scripts/dev-link.js`

Create a new script that handles both linking and unlinking of sibling packages.

**Link mode** (`node scripts/dev-link.js link [--package <name>]`):
1. Resolve sibling directories relative to `WORKSPACE_ROOT/..` (parent of ai-insights):
   - `@mistraljs/persona-builder` → `../ai-persona-builder`
   - `@mistraljs/cli-menu` → `../cli-menu`
2. For each package (or the specified `--package`):
   a. Verify the sibling directory exists. If not, skip with a warning.
   b. Run `npm run build` in the sibling directory (one-shot build for initial link).
   c. Run `npm link` in the sibling directory (registers it in the global npm link store).
   d. Run `npm link <package-name>` in the consumer directory (`personas/` for persona-builder, workspace root for cli-menu).
   e. Verify the symlink was created: `fs.lstatSync(node_modules/<pkg>).isSymbolicLink()`.
3. Write `.dev-links.json` marker file to workspace root with the linked packages and timestamp.
4. Print a summary showing which packages were linked and a reminder about `npm run dev` (tsup watch) in the sibling repo for live rebuilds.

**Unlink mode** (`node scripts/dev-link.js unlink`):
1. Run `npm install` in `personas/` (restores registry-resolved `@mistraljs/persona-builder`).
2. Run `npm install` at workspace root (restores registry-resolved `@mistraljs/cli-menu`).
3. Delete `.dev-links.json`.
4. Print confirmation.

**Status mode** (`node scripts/dev-link.js status`):
1. If `.dev-links.json` exists, read it and print which packages are linked and when.
2. If not, print "PROD mode — all dependencies from npm registry."

**Flags:**
- `--package <name>` — link/unlink only the specified package (e.g., `--package persona-builder` or `--package cli-menu`)
- `--skip-build` — skip the `npm run build` step in the sibling repo (useful when the sibling already has a fresh `dist/`)

### Step 2: Register CLI commands in `scripts/cli.js`

Add three entries to the `COMMANDS` array:

```js
{
  id:           'dev-link',
  key:          'l',
  label:        'Link sibling packages (DEV mode)',
  category:     'Setup & Configuration',
  description:  'Symlink sibling repos for local development',
  helpVariants: [
    ['dev-link',                           'Link all available sibling packages'],
    ['dev-link --package persona-builder', 'Link persona-builder only'],
    ['dev-link --package cli-menu',        'Link cli-menu only'],
    ['dev-link --skip-build',              'Skip npm run build in sibling repos'],
  ],
  run: cmdDevLink,
},
{
  id:          'dev-unlink',
  key:         'u',
  label:       'Unlink sibling packages (PROD mode)',
  category:    'Setup & Configuration',
  description: 'Restore npm-registry dependencies',
  run:         cmdDevUnlink,
},
```

The `dev-status` command is removed as a standalone menu entry — the health check status line (Step 3) already surfaces the current mode on every menu render, making a separate status command redundant. The `status` subcommand remains available via `node scripts/dev-link.js status` for scripted use.

Add the corresponding `cmdDevLink` and `cmdDevUnlink` functions that delegate to `scripts/dev-link.js` via `spawnSync('node', [path.join(SCRIPTS_DIR, 'dev-link.js'), ...args])`.

### Step 3: Add health check in `scripts/lib/health-checks.js`

Add a new instant-tier health check that detects when `.dev-links.json` exists:

```js
{
  id: 'dev-links-active',
  label: 'DEV mode — sibling packages linked',
  cost: 'instant',
  detect() {
    return !fs.existsSync(path.join(WORKSPACE_ROOT, '.dev-links.json'));
  },
  fix: 'node scripts/cli.js dev-unlink',
},
```

Note: `detect()` returns `false` when the marker exists — this makes DEV mode show as a "failing" health check in the status line, drawing attention to it. The `fix` points to `dev-unlink`.

### Step 4: Add pre-commit guard in `.githooks/pre-commit`

Add two new blocking checks after the existing version-sync check:

**4a. DEV-mode marker check:**
```sh
# Block commits while DEV-linked sibling packages are active
if [ -f ".dev-links.json" ]; then
  echo "ERROR: DEV mode is active (.dev-links.json exists)."
  echo "  Run 'node scripts/cli.js dev-unlink' before committing."
  exit 1
fi
```

**4b. Lock file `file:` path check (belt-and-suspenders):**
```sh
# Block commits with file: resolved paths in staged lock files
STAGED_LOCKS=$(git diff --cached --name-only | grep 'package-lock\.json$')
if [ -n "$STAGED_LOCKS" ]; then
  for lockfile in $STAGED_LOCKS; do
    if git diff --cached -- "$lockfile" | grep -q '"file:'; then
      echo "ERROR: Staged $lockfile contains a 'file:' resolved path."
      echo "  This breaks CI. Run 'npm install' in the affected directory to"
      echo "  restore registry-resolved dependencies, then re-stage."
      exit 1
    fi
  done
fi
```

### Step 5: Add `.dev-links.json` to `.gitignore`

Add the marker file to the workspace `.gitignore`.

### Step 6: Correct `docs/references/development.md`

Replace the incorrect `file:` path advice with the correct `npm link` workflow:

- Remove the sentence suggesting switching to a `file:` path.
- Replace with a reference to the `dev-link` CLI command.
- Add a subsection documenting the DEV/PROD mode concept, the available commands, and the `npm run dev` (tsup watch) pairing.
- Document the pre-commit guard and its relationship to the `release-check` skill's step 3a.
- Add an **"Agent Workflow"** subsection with the following agent-facing rule:

  > **When an agent receives a request that requires changes to `ai-persona-builder` or `cli-menu` source code**, the agent must:
  > 1. Check whether DEV mode is already active (`node scripts/cli.js dev-status` or check for `.dev-links.json`).
  > 2. If not active, run `node scripts/cli.js dev-link --package <name>` to symlink the affected sibling package before making any changes.
  > 3. After making changes in the sibling repo, rebuild it (`npm run build` in the sibling directory) and verify the changes propagate to ai-insights (e.g., `node scripts/build-personas.js --check` for persona-builder changes).
  > 4. Do **not** unlink automatically — leave the workspace in DEV mode for the user to verify and unlink when satisfied.
  > 5. Remind the user that DEV mode is active and that `node scripts/cli.js dev-unlink` must be run before committing.

### Step 7: Update `AGENTS.md` Cross-System Dependencies table

Add a new row to the Cross-System Dependencies table:

| Dependency | Source of Truth | Must Stay In Sync With |
|---|---|---|
| Sibling package linking | `.dev-links.json` (workspace root, gitignored) | `scripts/dev-link.js` → link/unlink logic; `scripts/lib/health-checks.js` → `dev-links-active` check; `.githooks/pre-commit` → DEV-mode and `file:` path guards; `docs/references/development.md` → documented procedure |

### Step 8: Update `AGENTS.md` Root-Level Tooling table

Add `scripts/dev-link.js` to the Root-Level Tooling table:

```
| `scripts/dev-link.js` | Link/unlink sibling repos (`ai-persona-builder`, `cli-menu`) for local development. Creates `.dev-links.json` marker. Supports `link [--package <name>] [--skip-build]`, `unlink`, and `status` subcommands. Invokable via `node scripts/cli.js dev-link`. |
```

### Step 9: Add agent workflow rules to `AGENTS.md`

Add a new section **"Sibling Package Development"** under the Cross-Platform Policy section (or as a peer section). This section provides the authoritative agent-facing rule for autonomous DEV mode activation:

```markdown
## Sibling Package Development

`ai-insights` depends on two sibling packages that live in adjacent repositories in this workspace:

| Package | Sibling Repo Directory | Consumer |
|---------|----------------------|----------|
| `@mistralys/persona-builder` | `../ai-persona-builder` | `personas/package.json` |
| `@mistralys/cli-menu` | `../cli-menu` | root `package.json` |

### Agent Rule: Autonomous DEV Mode Activation

When an agent receives a task that requires modifying source code in `ai-persona-builder` or `cli-menu`, the agent **must** activate DEV mode before making changes:

1. **Check current mode:** Read `.dev-links.json` in the workspace root, or run `node scripts/cli.js dev-status`.
2. **Activate if needed:** Run `node scripts/cli.js dev-link --package <name>` to symlink the affected package.
3. **After changes:** Rebuild the sibling (`npm run build` in the sibling directory) and verify propagation.
4. **Do not auto-unlink.** Leave DEV mode active for user verification. Remind the user that `dev-unlink` is required before committing.
5. **Never modify `package.json` or `package-lock.json`** to point to local paths — `npm link` is the only sanctioned mechanism.

The pre-commit hook blocks commits while `.dev-links.json` exists, so forgetting to unlink is a safe failure.

See `docs/references/development.md` for the full workflow reference.
```

## Dependencies
- Node.js ≥ 18 (already a workspace requirement)
- `npm link` (built-in npm command)
- Sibling repos must be cloned as siblings under the same parent directory

## Required Components
- `scripts/dev-link.js` — **new** — link/unlink/status logic
- `scripts/cli.js` — **modify** — add `dev-link`, `dev-unlink`, `dev-status` commands
- `scripts/lib/health-checks.js` — **modify** — add `dev-links-active` instant check
- `.githooks/pre-commit` — **modify** — add DEV-mode and `file:` path guards
- `.gitignore` — **modify** — add `.dev-links.json`
- `docs/references/development.md` — **modify** — replace `file:` advice, document linking workflow
- `AGENTS.md` — **modify** — add cross-system dependency + root-level tooling entries + agent workflow rules for autonomous DEV mode activation

## Assumptions
- Sibling repos (`ai-persona-builder`, `cli-menu`) are cloned as direct siblings of the `ai-insights` directory (i.e., under the same parent folder), following the existing VS Code multi-root workspace layout.
- `npm link` is available and functional in the user's Node.js installation (standard behavior since npm v2).
- The `.dev-links.json` marker file is sufficient as the mode indicator — no environment variable or persistent configuration is needed.

## Constraints
- `package.json` and `package-lock.json` must never be modified by the linking process. Only `node_modules/` (gitignored) is affected.
- The pre-commit guard must be POSIX shell (`#!/bin/sh`) for cross-platform compatibility (macOS + Linux).
- The `release-check` skill's `file:` path rejection (step 3a) is correct and must not be weakened.
- Cross-platform: `scripts/dev-link.js` must use `path.join()`/`path.resolve()`, never hardcoded separators.

## Out of Scope
- Fixing the `ai-persona-builder` version drift (package.json 2.5.1 vs changelog v2.6.1). This is noted in the spec as a separate cleanup — it does not block the linking workflow and should be addressed independently in that repo.
- Changes to the `release-check` skill's `file:` path rejection rule — that guard remains correct and necessary.
- Publishing new versions of either sibling package.
- Windows support for the pre-commit hook shell script (`.githooks/pre-commit` is already POSIX-only; Windows users use Git Bash or WSL).
- Automated watch-mode startup from the link command (the script will print a reminder, but starting `npm run dev` in the sibling is a manual step — it requires a separate terminal).

## Acceptance Criteria

- AC-01: Running `node scripts/cli.js dev-link` with both sibling repos present creates symlinks in `node_modules/` for both packages and writes `.dev-links.json` marker to workspace root.
- AC-02: Running `node scripts/cli.js dev-unlink` restores registry-resolved dependencies in both `personas/` and root, and deletes `.dev-links.json`.
- AC-03: `dev-link` (`l`) and `dev-unlink` (`u`) appear in the interactive CLI menu under "Setup & Configuration" and are usable via keyboard shortcut.
- AC-04: The CLI status line shows a warning when `.dev-links.json` exists (DEV mode active).
- AC-05: `git commit` is blocked when `.dev-links.json` exists, with a clear error message pointing to `dev-unlink`.
- AC-06: `git commit` is blocked when any staged `package-lock.json` contains a `file:` resolved path, with a clear error message.
- AC-07: `docs/references/development.md` no longer advises `file:` paths for local dev and instead documents the `dev-link` workflow.
- AC-08: `AGENTS.md` documents `.dev-links.json` in Cross-System Dependencies and `scripts/dev-link.js` in Root-Level Tooling.
- AC-09: `.dev-links.json` is listed in `.gitignore`.
- AC-10: The link command skips packages whose sibling directory is not present, with a warning (not an error).
- AC-11: The `--package` flag allows linking/unlinking a single package without affecting the other.
- AC-12: The `--skip-build` flag skips the `npm run build` step for cases where the sibling repo already has a fresh `dist/`.
- AC-13: `AGENTS.md` contains agent-facing rules instructing agents to autonomously activate DEV mode when a task requires changes to `ai-persona-builder` or `cli-menu` source code.
- AC-14: `docs/references/development.md` contains an Agent Workflow subsection with the same autonomous activation rule.

## Testing Strategy

This plan primarily produces a CLI script and shell hook — both are best validated through integration testing (running the commands end-to-end) rather than unit tests. The health check addition can be validated by the existing health-check test patterns.

## Test Plan

- `scripts/tests/dev-link.test.js` — New test file:
  - Test that `link` subcommand writes `.dev-links.json` with correct structure — covers AC-01
  - Test that `unlink` subcommand removes `.dev-links.json` — covers AC-02
  - Test that `status` subcommand reads marker and reports correctly — covers AC-03
  - Test that `--package` flag filters to the specified package — covers AC-11
  - Test that missing sibling directory produces a warning, not an error — covers AC-10
- Manual validation: run `node scripts/cli.js dev-link`, verify symlinks exist, run `node scripts/build-personas.js --check`, then `node scripts/cli.js dev-unlink` and verify registry deps restored — covers AC-01, AC-02
- Manual validation: attempt `git commit` with `.dev-links.json` present, verify blocked — covers AC-05
- Manual validation: verify CLI status line shows DEV mode warning — covers AC-04

## Documentation Updates

- `docs/references/development.md` — Replace `file:` path advice with `dev-link` workflow; add DEV/PROD mode section; add Agent Workflow subsection with autonomous DEV mode activation rule — AC-07, AC-14
- `AGENTS.md` — Add Cross-System Dependencies row for `.dev-links.json`; add Root-Level Tooling row for `scripts/dev-link.js`; add Sibling Package Development section with agent-facing autonomous activation rules — AC-08, AC-13
- `CLAUDE.md` — Will be auto-regenerated from `AGENTS.md` via `node scripts/cli.js ctx-generate` (not a manual update)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`npm link` behavior varies across npm versions** | The script verifies the symlink was created after linking (step 1.2e) and reports an actionable error if it wasn't. The documented minimum Node.js version (18) ships with npm 9+, which has stable `npm link` behavior. |
| **User forgets to unlink before committing** | The pre-commit guard blocks the commit with a clear message. This is a hard stop, not a warning. |
| **Sibling repo not at expected relative path** | The script checks for directory existence before attempting to link and skips with a warning (AC-10). |
| **`npm install` during unlink pulls a different version** | `npm install` respects `package-lock.json` — it restores the exact version previously locked. The lock file was never modified by the link process. |
| **Pre-commit `file:` check produces false positive on diff content** | The grep runs on the staged diff (`git diff --cached`), not on the full file. A `file:` string appearing only in removed lines (red) would not match a bare `'"file:'` pattern in added content. However, to be safe, restrict the grep to added lines with `grep '^\+'` before checking for `'"file:'`. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change within the well-understood `scripts/` and `.githooks/` patterns, no cross-project architectural impact, self-review is adequate.
