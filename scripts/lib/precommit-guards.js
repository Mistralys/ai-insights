/**
 * scripts/lib/precommit-guards.js
 *
 * Declarative pre-commit guard registry for the ai-insights workspace.
 *
 * Ports the guards previously implemented as `grep` pipelines in
 * `.githooks/pre-commit` into pure-ish, cross-platform, unit-testable
 * functions. Every guard returns a structured `GuardResult` instead of
 * printing directly or calling `process.exit()`, so the runner
 * (`scripts/precommit-guards.js`) owns all output and exit-code decisions.
 *
 * Blocking guards: personaFreshness, versionSync, devModeInactive,
 * noFileProtocolInLocks, ruffLint (only once a `ruff` binary is resolved —
 * see ruffLint()'s own contract).
 * Advisory guards (never change the exit code): contextStaleness,
 * changelogDrift.
 *
 * Dependency direction: this file MUST NOT import from scripts/cli.js or any
 * other file in scripts/ outside of scripts/lib/ — same rule as
 * scripts/lib/health-checks.js.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { HEALTH_CHECKS } from './health-checks.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');

// ─── Type definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, blocking: boolean, passed: boolean, messages: string[] }} GuardResult
 * @typedef {{ id: string, run: (stagedFiles: string[]) => GuardResult }} GuardDescriptor
 */

// ─── Staged file discovery ────────────────────────────────────────────────────

/**
 * Returns the list of staged file paths (relative to `cwd`), normalised to
 * forward slashes as emitted by `git diff --cached --name-only`. Returns an
 * empty array when nothing is staged or the `git` invocation fails.
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function getStagedFiles(cwd = WORKSPACE_ROOT) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return [];
  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Spawns a workspace-relative Node script via the current `node` binary
 * (`process.execPath`), avoiding any dependency on `node` being resolvable
 * on the caller's PATH.
 * @param {string} relativeScriptPath
 * @param {string[]} args
 * @param {string} cwd
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function spawnNodeScript(relativeScriptPath, args, cwd) {
  return spawnSync(process.execPath, [path.join(cwd, relativeScriptPath), ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
}

/**
 * Flattens a spawnSync result's stdout/stderr into a trimmed, non-empty
 * line array for use as GuardResult messages.
 * @param {import('child_process').SpawnSyncReturns<string>} result
 * @returns {string[]}
 */
function subprocessOutputLines(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Pure predicate: does a unified diff text contain an added line (leading
 * `+`, excluding the `+++` new-file header) that includes a `"file:`
 * resolved path? Exported directly so the header-exclusion edge case can be
 * unit-tested without spawning `git`.
 * @param {string} diffText
 * @returns {boolean}
 */
export function diffAddsFileProtocol(diffText) {
  return diffText
    .split(/\r?\n/)
    .some((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes('"file:'));
}

/**
 * Resolves the `ruff` executable: venv (Unix/Windows layouts), `.exe`
 * variant, then PATH. Mirrors the four-path resolution previously hardcoded
 * in `.githooks/pre-commit`.
 * @param {string} cwd  Workspace root to resolve `orchestrator/.venv` from.
 * @returns {string | null}
 */
function resolveRuff(cwd) {
  const venvDir = path.join(cwd, 'orchestrator', '.venv');
  const candidates = [
    path.join(venvDir, 'bin', 'ruff'),
    path.join(venvDir, 'Scripts', 'ruff.exe'),
    path.join(venvDir, 'Scripts', 'ruff'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const probe = spawnSync('ruff', ['--version'], { encoding: 'utf8', shell: false });
  if (!probe.error && probe.status === 0) return 'ruff';
  return null;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Blocking. Delegates to `node scripts/build-personas.js --check`.
 * @param {{ cwd?: string }} [options]
 * @returns {GuardResult}
 */
export function personaFreshness(options = {}) {
  const cwd = options.cwd ?? WORKSPACE_ROOT;
  const result = spawnNodeScript('scripts/build-personas.js', ['--check'], cwd);
  const passed = result.status === 0;
  const output = subprocessOutputLines(result);
  return {
    id: 'persona-freshness',
    blocking: true,
    passed,
    messages: passed ? [] : (output.length > 0 ? output : ['Persona build output is stale. Run: node scripts/build-personas.js']),
  };
}

/**
 * Blocking. Delegates to `node scripts/check-version-sync.js`.
 * @param {{ cwd?: string }} [options]
 * @returns {GuardResult}
 */
export function versionSync(options = {}) {
  const cwd = options.cwd ?? WORKSPACE_ROOT;
  const result = spawnNodeScript('scripts/check-version-sync.js', [], cwd);
  const passed = result.status === 0;
  const output = subprocessOutputLines(result);
  return {
    id: 'version-sync',
    blocking: true,
    passed,
    messages: passed ? [] : (output.length > 0 ? output : ['Version sync check failed. Run: node scripts/check-version-sync.js']),
  };
}

/**
 * Blocking. Resolves the `dev-links-inactive` entry from the given registry
 * by id — mirroring the `HEALTH_CHECKS.find(...)` + hard-throw-on-missing
 * pattern in scripts/preflight-orchestrator.js — rather than re-deriving the
 * `.dev-links.json` marker path locally.
 * @param {import('./health-checks.js').HealthCheck[]} [healthChecks]
 * @returns {GuardResult}
 */
export function devModeInactive(healthChecks = HEALTH_CHECKS) {
  const check = healthChecks.find((c) => c.id === 'dev-links-inactive');
  if (!check) {
    throw new Error("Health check 'dev-links-inactive' not found in HEALTH_CHECKS — was its id renamed?");
  }
  const passed = Boolean(check.detect());
  return {
    id: 'dev-mode-inactive',
    blocking: true,
    passed,
    messages: passed ? [] : [
      'DEV mode is active (.dev-links.json exists).',
      "  Run 'node scripts/cli.js dev-unlink' before committing.",
    ],
  };
}

/**
 * Blocking. Fails when a staged `package-lock.json` diff *adds* a `"file:`
 * resolved path; passes when such a line is only removed.
 * @param {string[]} stagedFiles
 * @param {{ cwd?: string }} [options]
 * @returns {GuardResult}
 */
export function noFileProtocolInLocks(stagedFiles, options = {}) {
  const cwd = options.cwd ?? WORKSPACE_ROOT;
  const messages = [];
  const lockFiles = stagedFiles.filter((f) => f.endsWith('package-lock.json'));
  for (const lockFile of lockFiles) {
    const diff = spawnSync('git', ['diff', '--cached', '--', lockFile], { cwd, encoding: 'utf8', shell: false });
    if (diffAddsFileProtocol(diff.stdout || '')) {
      messages.push(`Staged ${lockFile} adds a "file:" resolved path.`);
      messages.push('  This breaks CI. Run npm install in the affected directory to restore registry-resolved dependencies, then re-stage.');
    }
  }
  return { id: 'no-file-protocol-in-locks', blocking: true, passed: messages.length === 0, messages };
}

/**
 * Blocking only once a `ruff` binary resolves; skipped (passed, no spawn)
 * when no `orchestrator/src/**.py` path is staged; advisory (non-blocking)
 * when staged but no `ruff` binary can be found.
 * @param {string[]} stagedFiles
 * @param {{ cwd?: string, resolveRuff?: () => (string | null) }} [options]
 * @returns {GuardResult}
 */
export function ruffLint(stagedFiles, options = {}) {
  const cwd = options.cwd ?? WORKSPACE_ROOT;
  const resolve = options.resolveRuff ?? (() => resolveRuff(cwd));
  const pyStaged = stagedFiles.some((f) => /^orchestrator\/src\/.*\.py$/.test(f));
  if (!pyStaged) {
    return { id: 'ruff-lint', blocking: true, passed: true, messages: [] };
  }

  const ruffPath = resolve();
  if (!ruffPath) {
    return {
      id: 'ruff-lint',
      blocking: false,
      passed: false,
      messages: [
        'ruff not found — skipping Python lint check.',
        '  Install it with: pip install ruff  (inside orchestrator/.venv)',
      ],
    };
  }

  const result = spawnSync(ruffPath, ['check', 'orchestrator/src/'], { cwd, encoding: 'utf8', shell: false });
  const passed = result.status === 0;
  return { id: 'ruff-lint', blocking: true, passed, messages: passed ? [] : subprocessOutputLines(result) };
}

/**
 * Advisory. Warns when source directories changed but `.context/` was not
 * updated alongside them. Never blocks.
 * @param {string[]} stagedFiles
 * @returns {GuardResult}
 */
export function contextStaleness(stagedFiles) {
  const srcChanged = stagedFiles.some((f) => /^(mcp-server\/src\/|orchestrator\/src\/|personas\/|scripts\/|shared\/)/.test(f));
  const ctxChanged = stagedFiles.some((f) => f.startsWith('.context/'));
  const passed = !(srcChanged && !ctxChanged);
  return {
    id: 'context-staleness',
    blocking: false,
    passed,
    messages: passed ? [] : [
      'Source files changed but .context/ was not updated.',
      '  Consider running: node scripts/cli.js build-maintain',
    ],
  };
}

/**
 * Advisory. Warns when a sub-project changelog changed without the root
 * changelog.md. Never blocks.
 * @param {string[]} stagedFiles
 * @returns {GuardResult}
 */
export function changelogDrift(stagedFiles) {
  const subChanged = stagedFiles.some((f) => /^(mcp-server|personas|orchestrator)\/changelog\.md$/.test(f));
  const rootChanged = stagedFiles.includes('changelog.md');
  const passed = !(subChanged && !rootChanged);
  return {
    id: 'changelog-drift',
    blocking: false,
    passed,
    messages: passed ? [] : [
      'A sub-project changelog was updated but the root changelog.md was not.',
      '  Consider summarizing the changes in changelog.md before committing.',
    ],
  };
}

// ─── Guard registry ───────────────────────────────────────────────────────────

/** @type {GuardDescriptor[]} */
export const GUARDS = [
  { id: 'persona-freshness', run: () => personaFreshness() },
  { id: 'version-sync', run: () => versionSync() },
  { id: 'dev-mode-inactive', run: () => devModeInactive() },
  { id: 'no-file-protocol-in-locks', run: (stagedFiles) => noFileProtocolInLocks(stagedFiles) },
  { id: 'ruff-lint', run: (stagedFiles) => ruffLint(stagedFiles) },
  { id: 'context-staleness', run: (stagedFiles) => contextStaleness(stagedFiles) },
  { id: 'changelog-drift', run: (stagedFiles) => changelogDrift(stagedFiles) },
];

// ─── Runner core ──────────────────────────────────────────────────────────────

/**
 * Iterates `guards` in order, printing each guard's messages via `print`,
 * and returns the process exit code: 1 on the first blocking failure
 * (short-circuiting further guards), 0 otherwise. Advisory failures print
 * but never stop iteration or change the exit code.
 * @param {GuardDescriptor[]} guards
 * @param {string[]} stagedFiles
 * @param {{ print?: (line: string) => void }} [options]
 * @returns {number}
 */
export function runGuards(guards, stagedFiles, options = {}) {
  const print = options.print ?? ((line) => console.log(line));
  for (const guard of guards) {
    const result = guard.run(stagedFiles);
    if (!result.passed && result.messages.length > 0) {
      const label = result.blocking ? 'ERROR' : 'WARNING';
      const [first, ...rest] = result.messages;
      print(`${label}: ${first}`);
      for (const line of rest) print(line);
    }
    if (!result.passed && result.blocking) {
      return 1;
    }
  }
  return 0;
}
