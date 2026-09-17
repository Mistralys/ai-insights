#!/usr/bin/env node

/**
 * scripts/ledger-project.js
 *
 * `init` and `edit` shells for the `ai-insights ledger` command group
 * (WP-012). Both verbs are thin wrappers over the pure decision core in
 * `scripts/lib/ledger-project-core.js`: every classification, defaulting,
 * and refusal decision is made there; this file owns every side effect —
 * prompting on stdin, writing files, and calling into the compiled
 * `mcp-server/dist/` modules (registry lookups, the declaration loader, and
 * the sync choke-point) through `scripts/lib/ledger-bridge.js`.
 *
 * Each verb has two shells sharing the same core calls:
 *   - **Non-interactive** (any flag supplied, or stdin is not a TTY): reads
 *     everything from `argv`, never prompts, and exits non-zero naming a
 *     missing required input rather than hanging on a read.
 *   - **Wizard** (TTY, no flags supplied): prompts interactively via
 *     `askCleanInput()`'s pattern (`scripts/cli.js` L452-L457, reimplemented
 *     here as `createReadAnswer()` — no new dependency), prefilling `edit`'s
 *     prompts with the declaration's current values.
 *
 * `sync` (this file's third verb, WP-013) is the always-non-interactive
 * regeneration command shared by the CLI, the pre-commit hook (WP-015), and
 * potentially CI. It resolves the project root the same way `edit` does
 * (`findProjectRoot()`'s `.ledger/`-only ancestor walk from the invoking
 * directory) and calls the same `syncProjectOutputs()` choke-point the
 * wizard's "run sync now" offer and `edit`'s disabled-output cleanup already
 * use — `sync` never prompts, in any mode, so it is safe to invoke from a
 * git hook without risk of hanging on a read. CLI/menu registration
 * (WP-014) remains out of scope here.
 *
 * Usage:
 *   node scripts/ledger-project.js init [--repository-id <id>] [--enable <output-id>]... [--force] [--dry-run]
 *   node scripts/ledger-project.js edit [--enable <output-id>]... [--disable <output-id>]...
 *   node scripts/ledger-project.js sync [--check]
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pathToFileURL } from 'url';

import { loadDistModule } from './lib/ledger-bridge.js';
import { getOriginalCwd } from './lib/original-cwd.js';
import {
  resolveInitTarget,
  buildInitialSettings,
  planInitWrites,
  collectAdvisories,
  GITIGNORE_LINE,
} from './lib/ledger-project-core.js';

/** Human-readable labels for known output ids, falling back to the raw id. */
const OUTPUT_LABELS = {
  'strategic-vision': 'Strategic Vision mirror',
};

// ─── I/O primitives (overridable by callers, in particular tests) ──────────

function defaultLog(line) {
  console.log(line);
}

function defaultErrorLog(line) {
  console.error(line);
}

/**
 * Returns a prompt function with the exact shape and behavior of
 * `scripts/cli.js`'s `askCleanInput()` (L452-L457) — a single
 * `readline.Interface` created and closed per question. Reimplemented
 * locally rather than imported, since `scripts/cli.js` does not export it
 * and importing the whole CLI module here would be a heavier and more
 * circular dependency than duplicating five lines.
 */
function createReadAnswer() {
  return function askCleanInput(question) {
    return new Promise((resolveAnswer) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolveAnswer(answer);
      });
    });
  };
}

/** Prompts `question`, defaulting to `defaultValue` on an empty answer. */
async function confirmYesNo(answer, question, defaultValue) {
  const raw = (await answer(question)).trim().toLowerCase();
  if (raw === '') return defaultValue;
  return raw === 'y' || raw === 'yes';
}

// ─── Bridge accessors ────────────────────────────────────────────────────────

/**
 * Bootstraps the multi-store context exactly once per process, mirroring
 * the sequence `src/index.ts` and `gui/server.ts` run at startup. Every
 * `ledger` verb calls this before any registry lookup — without it,
 * `findEntryInStores()`/`listEntriesInStores()` silently fall back to
 * single-store mode and would misreport a repository registered in a
 * non-default store as unregistered (plan step 2c).
 */
async function bootstrapStoreContext() {
  const { initStoreContext } = await loadDistModule('storage/store-context.js');
  await initStoreContext();
}

async function getLedgerRoot() {
  const { resolveLedgerRoot } = await loadDistModule('utils/ledger-root.js');
  return resolveLedgerRoot();
}

async function getOutputSchema() {
  const { OUTPUT_IDS, DEFAULT_OUTPUT_PATHS } = await loadDistModule('schema/project-declaration.js');
  return { outputIds: OUTPUT_IDS, defaultPaths: DEFAULT_OUTPUT_PATHS };
}

async function lookupEntryById(repositoryId, ledgerRootOverride) {
  const { findEntryInStores } = await loadDistModule('storage/repository-lookup.js');
  const ledgerRoot = ledgerRootOverride ?? (await getLedgerRoot());
  const found = await findEntryInStores(ledgerRoot, repositoryId);
  return found ? found.entry : null;
}

/**
 * Runs `syncProjectOutputs()` in `write` mode and prints one status line per
 * output. Shared by `init`'s "run sync now?" wizard offer and every `edit`
 * write, since disabling an output through `edit` must remove a
 * marker-carrying mirror through the exact same path a hand-edited
 * `enabled: false` would take (plan step 10c / AC-31).
 *
 * @returns {Promise<number>} Exit code: 1 when any output reports `blocked`,
 *   0 otherwise.
 */
async function performSync({ projectRoot, settings, entry, log }) {
  const { syncProjectOutputs } = await loadDistModule('outputs/sync.js');
  const records = await syncProjectOutputs({ projectRoot, settings, entry, mode: 'write' });
  let hadBlocked = false;
  for (const record of records) {
    if (record.kind === 'blocked') hadBlocked = true;
    log(formatSyncRecord(record));
  }
  return hadBlocked ? 1 : 0;
}

function formatSyncRecord(record) {
  const label = OUTPUT_LABELS[record.outputId] ?? record.outputId;
  switch (record.kind) {
    case 'written':
      return `  ${label}: written -> ${record.path}`;
    case 'unchanged':
      return `  ${label}: unchanged`;
    case 'removed':
      return `  ${label}: removed -> ${record.path}`;
    case 'skipped':
      return `  ${label}: disabled, nothing to do`;
    case 'blocked':
      return `  ${label}: BLOCKED — ${record.reason}`;
    default:
      return `  ${label}: ${record.kind}`;
  }
}

/**
 * Runs `syncProjectOutputs()` in `check` mode (no I/O) and prints one status
 * line per output, phrased as a classification of the current on-disk state
 * rather than as a completed action — unlike {@link formatSyncRecord}, whose
 * past-tense wording ("written", "removed") only makes sense once that
 * write/removal actually happened. Used exclusively by `sync --check`
 * (AC-12).
 *
 * @returns {Promise<number>} Exit code: 1 when any record is `stale`
 *   (`SyncOutputRecord.stale` already encodes exactly the AC-12
 *   "stale or missing" condition), 0 otherwise.
 */
async function performSyncCheck({ projectRoot, settings, entry, log }) {
  const { syncProjectOutputs } = await loadDistModule('outputs/sync.js');
  const records = await syncProjectOutputs({ projectRoot, settings, entry, mode: 'check' });
  let anyStale = false;
  for (const record of records) {
    if (record.stale) anyStale = true;
    log(formatCheckRecord(record));
  }
  return anyStale ? 1 : 0;
}

function formatCheckRecord(record) {
  const label = OUTPUT_LABELS[record.outputId] ?? record.outputId;
  switch (record.kind) {
    case 'written':
      return `  ${label}: stale (would write) -> ${record.path}`;
    case 'unchanged':
      return `  ${label}: current`;
    case 'removed':
      return `  ${label}: disabled (would remove) -> ${record.path}`;
    case 'skipped':
      return `  ${label}: disabled, nothing to do`;
    case 'blocked':
      return `  ${label}: BLOCKED — ${record.reason}`;
    default:
      return `  ${label}: ${record.kind}`;
  }
}

// ─── Shared file-writing helpers ─────────────────────────────────────────────

function writePlannedFiles(files) {
  for (const file of files) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.contents);
  }
}

function writeSettingsOnly(projectRoot, settings) {
  const settingsPath = path.join(projectRoot, '.ledger', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function printAdvisories(advisories, log, { skipIds = [] } = {}) {
  log('Advisories (printed only — none applied automatically, except the .gitignore offer below):');
  for (const advisory of advisories) {
    if (!advisory.applicable) continue;
    if (skipIds.includes(advisory.id)) continue;
    log(`  - ${advisory.text}`);
  }
}

/**
 * Offers to append the `.gitignore` line, per the plan's single carve-out
 * from "the ledger never writes outside `.ledger/`": idempotent (a no-op
 * when the line is already present) and skipped entirely when there is no
 * `.gitignore` to append to (AC-32). Both of those conditions collapse to
 * `collectAdvisories()`'s `applicable: false` for the `gitignore` id, so the
 * prompt itself is skipped in both cases rather than asked and then
 * discovered to be a no-op.
 */
async function offerGitignoreAppend({ projectRoot, advisories, answer, log }) {
  const gitignore = advisories.find((advisory) => advisory.id === 'gitignore');
  if (!gitignore || !gitignore.applicable) return;

  const shouldAppend = await confirmYesNo(
    answer,
    `Append '${GITIGNORE_LINE}' to .gitignore so the machine-local override is never committed? (y/N) `,
    false
  );
  if (!shouldAppend) return;

  fs.appendFileSync(path.join(projectRoot, '.gitignore'), `${GITIGNORE_LINE}\n`);
  log('Updated .gitignore.');
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function unregisteredMessage(target, repositoryId) {
  if (repositoryId) {
    return (
      `No repository registered with id '${repositoryId}' was found in any configured store. ` +
      `Register it first from the dashboard Strategy page, then re-run ` +
      `\`ledger init --repository-id ${repositoryId}\`.`
    );
  }
  return (
    `No repository registered under the folder name '${target.derivedName}' was found. ` +
    `Register this repository first from the dashboard Strategy page, then re-run ` +
    `\`ledger init\` (or pass --repository-id explicitly).`
  );
}

function ambiguousMessage(target) {
  const ids = target.candidates
    .filter((candidate) => candidate.isDerivedMatch)
    .map((candidate) => candidate.entry.id)
    .join(', ');
  return (
    `Multiple registered repositories share the folder name '${target.derivedName}' (${ids}) — ` +
    `pass --repository-id explicitly to disambiguate.`
  );
}

// ─── Flag parsing ────────────────────────────────────────────────────────────

function parseInitArgs(args) {
  const result = { repositoryId: null, enable: [], force: false, dryRun: false, unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repository-id') {
      result.repositoryId = args[++i] ?? null;
    } else if (arg === '--enable') {
      const value = args[++i];
      if (value) result.enable.push(value);
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      result.unknown.push(arg);
    }
  }
  return result;
}

function parseEditArgs(args) {
  const result = { enable: [], disable: [], force: false, unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--enable') {
      const value = args[++i];
      if (value) result.enable.push(value);
    } else if (arg === '--disable') {
      const value = args[++i];
      if (value) result.disable.push(value);
    } else if (arg === '--force') {
      result.force = true;
    } else {
      result.unknown.push(arg);
    }
  }
  return result;
}

// ─── init ────────────────────────────────────────────────────────────────────

/**
 * Runs `ledger init`.
 *
 * @param {object} params
 * @param {string} params.cwd - Project root, verbatim (no ancestor walk —
 *   `init` is the command that creates the marker the walk would look for).
 * @param {string[]} [params.args] - Flags after `init`.
 * @param {boolean} [params.isTTY] - Whether stdin is a TTY (overridable for tests).
 * @param {(question: string) => Promise<string>} [params.readAnswer] - Prompt function (overridable for tests).
 * @param {string} [params.ledgerRoot] - Test hook: when supplied, skips
 *   `bootstrapStoreContext()` and the real `resolveLedgerRoot()` and uses
 *   this path directly in legacy single-store mode instead — the same
 *   injection point `scripts/tests/ledger-project-core.test.js` already
 *   relies on for `resolveInitTarget()`/`listEntriesInStores()`. Omitted in
 *   production use, where the real multi-store context is always bootstrapped.
 * @param {(line: string) => void} [params.log]
 * @param {(line: string) => void} [params.errorLog]
 * @returns {Promise<number>} Process exit code.
 */
export async function runInit({
  cwd,
  args = [],
  isTTY = process.stdin.isTTY === true,
  readAnswer,
  ledgerRoot: ledgerRootOverride,
  log = defaultLog,
  errorLog = defaultErrorLog,
} = {}) {
  const answer = readAnswer ?? createReadAnswer();
  const nonInteractive = args.length > 0 || !isTTY;

  let ledgerRoot = ledgerRootOverride;
  if (ledgerRoot === undefined) {
    await bootstrapStoreContext();
    ledgerRoot = await getLedgerRoot();
  }

  if (nonInteractive) {
    return runInitNonInteractive({ cwd, args, ledgerRoot, log, errorLog });
  }
  return runInitWizard({ cwd, ledgerRoot, answer, log, errorLog });
}

async function runInitNonInteractive({ cwd, args, ledgerRoot, log, errorLog }) {
  const flags = parseInitArgs(args);
  if (flags.unknown.length > 0) {
    errorLog(`Unknown flag(s): ${flags.unknown.join(', ')}`);
    return 1;
  }

  const target = await resolveInitTarget({ cwd, repositoryId: flags.repositoryId, ledgerRoot });

  if (target.classification === 'unregistered') {
    errorLog(unregisteredMessage(target, flags.repositoryId));
    return 1;
  }
  if (target.classification === 'ambiguous') {
    // No TTY (or non-interactive by flag) and the tool cannot guess which
    // of several same-named registry entries is intended — AC-28's "missing
    // required input" case for init.
    errorLog(ambiguousMessage(target));
    return 1;
  }

  const { outputIds } = await getOutputSchema();
  const outputsOverride = {};
  for (const outputId of flags.enable) {
    if (!outputIds.includes(outputId)) {
      errorLog(`Unknown output id '${outputId}' passed to --enable. Known ids: ${outputIds.join(', ')}.`);
      return 1;
    }
    outputsOverride[outputId] = { enabled: true };
  }

  const settings = await buildInitialSettings({ repositoryId: target.matched.entry.id, outputs: outputsOverride });
  const plan = planInitWrites({ projectRoot: cwd, settings, force: flags.force, dryRun: flags.dryRun });

  if (!plan.ok) {
    errorLog(refusalMessage(cwd));
    return 1;
  }

  if (flags.dryRun) {
    log('Dry run — no files written. Would create:');
    for (const plannedPath of plan.plannedPaths) log(`  ${plannedPath}`);
    return 0;
  }

  writePlannedFiles(plan.files);
  log(`Declared this project as '${target.matched.entry.id}'. Wrote:`);
  for (const plannedPath of plan.plannedPaths) log(`  ${plannedPath}`);
  printAdvisories(collectAdvisories({ projectRoot: cwd }), log);
  return 0;
}

function refusalMessage(cwd) {
  const settingsPath = path.join(cwd, '.ledger', 'settings.json');
  return `${settingsPath} already exists — pass --force to overwrite, or run \`ledger edit\` to change it.`;
}

async function runInitWizard({ cwd, ledgerRoot, answer, log, errorLog }) {
  log(`Project root: ${cwd}`);
  const confirmedRoot = await confirmYesNo(answer, `Declare this project at ${cwd}? (Y/n) `, true);
  if (!confirmedRoot) {
    log('Aborted — no files written.');
    return 1;
  }

  // Check for an existing declaration up front, before spending any prompts
  // on repository selection or output choices (the wizard carries no
  // --force flag — an already-declared project must go through `ledger
  // edit`, or `ledger init --force` non-interactively).
  const earlyPlan = planInitWrites({ projectRoot: cwd, settings: {}, force: false, dryRun: true });
  if (!earlyPlan.ok) {
    errorLog(refusalMessage(cwd));
    return 1;
  }

  const target = await resolveInitTarget({ cwd, repositoryId: null, ledgerRoot });

  let matchedEntry;
  if (target.classification === 'matched') {
    matchedEntry = target.matched.entry;
    log(`Matched registry entry: ${matchedEntry.id} (${matchedEntry.label})`);
  } else if (target.candidates.length === 0) {
    errorLog(unregisteredMessage(target, null));
    return 1;
  } else {
    log('Select the repository this project belongs to:');
    target.candidates.forEach((candidate, index) => {
      const marker = candidate.isDerivedMatch ? '  (derived-name match)' : '';
      log(`  ${index + 1}. ${candidate.entry.id} — ${candidate.entry.label}${marker}`);
    });
    const preselectedIndex = target.candidates.findIndex((candidate) => candidate.isDerivedMatch);
    const defaultChoice = preselectedIndex >= 0 ? String(preselectedIndex + 1) : '';
    const raw = await answer(`  Selection${defaultChoice ? ` [${defaultChoice}]` : ''}: `);
    const chosen = raw.trim() || defaultChoice;
    const chosenIndex = parseInt(chosen, 10) - 1;
    if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= target.candidates.length) {
      errorLog('No valid selection made.');
      return 1;
    }
    matchedEntry = target.candidates[chosenIndex].entry;
  }

  const { outputIds, defaultPaths } = await getOutputSchema();
  const advisories = collectAdvisories({ projectRoot: cwd });
  const warning = advisories.find((advisory) => advisory.id === 'public-repository-warning');

  const outputsOverride = {};
  for (const outputId of outputIds) {
    log(warning.text);
    const enable = await confirmYesNo(answer, `  Enable ${OUTPUT_LABELS[outputId] ?? outputId}? (y/N) `, false);
    const override = { enabled: enable };
    if (enable) {
      const defaultPath = defaultPaths[outputId];
      const pathAnswer = await answer(`  Output path [${defaultPath}]: `);
      const trimmed = pathAnswer.trim();
      if (trimmed && trimmed !== defaultPath) override.path = trimmed;
    }
    outputsOverride[outputId] = override;
  }

  const settings = await buildInitialSettings({ repositoryId: matchedEntry.id, outputs: outputsOverride });
  const plan = planInitWrites({ projectRoot: cwd, settings, force: false, dryRun: false });
  if (!plan.ok) {
    // Reachable only if settings.json appeared between the early check and
    // here (a concurrent writer) — refuse rather than clobber it.
    errorLog(refusalMessage(cwd));
    return 1;
  }

  log('The following files will be written:');
  for (const plannedPath of plan.plannedPaths) log(`  ${plannedPath}`);
  const confirmedWrite = await confirmYesNo(answer, 'Write these files? (Y/n) ', true);
  if (!confirmedWrite) {
    log('Aborted — no files written.');
    return 1;
  }

  writePlannedFiles(plan.files);
  log(`Declared this project as '${matchedEntry.id}'. Wrote:`);
  for (const plannedPath of plan.plannedPaths) log(`  ${plannedPath}`);

  printAdvisories(advisories, log, { skipIds: ['gitignore'] });
  await offerGitignoreAppend({ projectRoot: cwd, advisories, answer, log });

  const anyEnabled = Object.values(outputsOverride).some((override) => override.enabled);
  if (anyEnabled) {
    const runSyncNow = await confirmYesNo(answer, 'Run `ledger sync` now? (y/N) ', false);
    if (runSyncNow) {
      const syncExitCode = await performSync({ projectRoot: cwd, settings, entry: matchedEntry, log });
      if (syncExitCode !== 0) return syncExitCode;
    }
  }

  return 0;
}

// ─── edit ────────────────────────────────────────────────────────────────────

/**
 * Runs `ledger edit`.
 *
 * @param {object} params
 * @param {string} params.cwd - Invocation directory; the actual project
 *   root is resolved from here via `findProjectRoot()`.
 * @param {string[]} [params.args] - Flags after `edit`.
 * @param {boolean} [params.isTTY]
 * @param {(question: string) => Promise<string>} [params.readAnswer]
 * @param {string} [params.ledgerRoot] - Test hook, same contract as `runInit()`'s.
 * @param {(line: string) => void} [params.log]
 * @param {(line: string) => void} [params.errorLog]
 * @returns {Promise<number>} Process exit code.
 */
export async function runEdit({
  cwd,
  args = [],
  isTTY = process.stdin.isTTY === true,
  readAnswer,
  ledgerRoot: ledgerRootOverride,
  log = defaultLog,
  errorLog = defaultErrorLog,
} = {}) {
  const answer = readAnswer ?? createReadAnswer();
  const nonInteractive = args.length > 0 || !isTTY;

  const flags = parseEditArgs(args);
  if (flags.force) {
    errorLog('`ledger edit` does not accept --force — --force only applies to `ledger init`.');
    return 1;
  }
  if (flags.unknown.length > 0) {
    errorLog(`Unknown flag(s): ${flags.unknown.join(', ')}`);
    return 1;
  }

  if (ledgerRootOverride === undefined) {
    await bootstrapStoreContext();
  }

  const { findProjectRoot, loadProjectDeclaration } = await loadDistModule('storage/project-declaration.js');
  const projectRoot = await findProjectRoot(cwd);
  const notDeclaredMessage = `No .ledger/settings.json found at or above ${cwd} — run \`ledger init\` first.`;

  if (!projectRoot) {
    errorLog(notDeclaredMessage);
    return 1;
  }

  const declarationState = await loadProjectDeclaration(projectRoot);
  if (declarationState.kind === 'not_declared') {
    errorLog(notDeclaredMessage);
    return 1;
  }
  if (declarationState.kind === 'invalid') {
    errorLog(
      `${path.join(projectRoot, '.ledger', 'settings.json')} is invalid — run \`ledger init --force\` to re-create it:\n` +
        declarationState.errors.map((error) => `  ${error}`).join('\n')
    );
    return 1;
  }

  const { settings } = declarationState;
  const entry = await lookupEntryById(settings.repository_id, ledgerRootOverride);
  if (!entry) {
    errorLog(
      `Declared repository_id '${settings.repository_id}' was not found in any configured store. ` +
        `Run \`ledger init --force\` to redeclare it.`
    );
    return 1;
  }

  const { outputIds } = await getOutputSchema();

  if (nonInteractive) {
    return runEditNonInteractive({ projectRoot, settings, entry, flags, outputIds, isTTY, log, errorLog });
  }
  return runEditWizard({ projectRoot, settings, entry, answer, outputIds, log });
}

function currentOutputConfig(settings, outputId) {
  return settings.outputs?.[outputId] ?? { enabled: false };
}

async function runEditNonInteractive({ projectRoot, settings, entry, flags, outputIds, isTTY, log, errorLog }) {
  if (flags.enable.length === 0 && flags.disable.length === 0 && !isTTY) {
    errorLog(
      'No changes specified and stdin is not a TTY — pass --enable <output-id> and/or ' +
        '--disable <output-id> to specify what to change.'
    );
    return 1;
  }

  for (const outputId of [...flags.enable, ...flags.disable]) {
    if (!outputIds.includes(outputId)) {
      errorLog(`Unknown output id '${outputId}'. Known ids: ${outputIds.join(', ')}.`);
      return 1;
    }
  }

  const outputsOverride = {};
  for (const outputId of outputIds) {
    outputsOverride[outputId] = { ...currentOutputConfig(settings, outputId) };
  }
  for (const outputId of flags.enable) outputsOverride[outputId] = { ...outputsOverride[outputId], enabled: true };
  for (const outputId of flags.disable) outputsOverride[outputId] = { ...outputsOverride[outputId], enabled: false };

  return finalizeEdit({ projectRoot, entry, outputsOverride, log });
}

async function runEditWizard({ projectRoot, settings, entry, answer, outputIds, log }) {
  log(`Editing declaration at ${projectRoot} (repository: ${entry.id}).`);
  const { defaultPaths } = await getOutputSchema();
  const advisories = collectAdvisories({ projectRoot });
  const warning = advisories.find((advisory) => advisory.id === 'public-repository-warning');

  const outputsOverride = {};
  for (const outputId of outputIds) {
    const current = currentOutputConfig(settings, outputId);
    log(warning.text);
    const promptSuffix = current.enabled ? 'Y/n' : 'y/N';
    const enable = await confirmYesNo(
      answer,
      `  Enable ${OUTPUT_LABELS[outputId] ?? outputId}? (${promptSuffix}) `,
      current.enabled
    );
    const override = { enabled: enable };
    if (enable) {
      const defaultPath = current.path ?? defaultPaths[outputId];
      const pathAnswer = await answer(`  Output path [${defaultPath}]: `);
      const trimmed = pathAnswer.trim();
      if (trimmed) override.path = trimmed;
      else if (current.path) override.path = current.path;
    }
    outputsOverride[outputId] = override;
  }

  return finalizeEdit({ projectRoot, entry, outputsOverride, log });
}

/**
 * Writes the edited `settings.json` (never `settings.local.json`) and runs
 * `syncProjectOutputs()` so a disabled output's marker-carrying mirror is
 * removed through the same path a hand-edited `enabled: false` takes
 * (AC-31).
 */
async function finalizeEdit({ projectRoot, entry, outputsOverride, log }) {
  const settings = await buildInitialSettings({ repositoryId: entry.id, outputs: outputsOverride });
  writeSettingsOnly(projectRoot, settings);
  log(`Updated ${path.join(projectRoot, '.ledger', 'settings.json')}.`);
  return performSync({ projectRoot, settings, entry, log });
}

// ─── sync ────────────────────────────────────────────────────────────────────

function parseSyncArgs(args) {
  const result = { check: false, unknown: [] };
  for (const arg of args) {
    if (arg === '--check') {
      result.check = true;
    } else {
      result.unknown.push(arg);
    }
  }
  return result;
}

/**
 * Runs `ledger sync` — the always-non-interactive regeneration verb shared
 * by the CLI, the pre-commit hook, and potentially CI. Resolves the project
 * root exactly as `runEdit()` does (`findProjectRoot()`'s ancestor walk from
 * `cwd`), errors on `not_declared`/`invalid` with the same message shape
 * `runEdit()` uses (naming the walked directory, pointing at `ledger init`),
 * then either reports what a write would do (`--check`, no I/O) or performs
 * the write (default).
 *
 * Never prompts, in either mode — there is no `readAnswer` parameter and no
 * TTY branch, unlike `runInit()`/`runEdit()`. This is the property WP-015's
 * pre-commit hook and the wizard's "run sync now?" offer (WP-008, already
 * wired via `performSync()`) both rely on.
 *
 * @param {object} params
 * @param {string} params.cwd - Invocation directory; the actual project
 *   root is resolved from here via `findProjectRoot()`.
 * @param {string[]} [params.args] - Flags after `sync` (only `--check`).
 * @param {string} [params.ledgerRoot] - Test hook, same contract as
 *   `runInit()`'s / `runEdit()`'s.
 * @param {(line: string) => void} [params.log]
 * @param {(line: string) => void} [params.errorLog]
 * @returns {Promise<number>} Process exit code.
 */
export async function runSync({
  cwd,
  args = [],
  ledgerRoot: ledgerRootOverride,
  log = defaultLog,
  errorLog = defaultErrorLog,
} = {}) {
  const flags = parseSyncArgs(args);
  if (flags.unknown.length > 0) {
    errorLog(`Unknown flag(s): ${flags.unknown.join(', ')}`);
    return 1;
  }

  if (ledgerRootOverride === undefined) {
    await bootstrapStoreContext();
  }

  const { findProjectRoot, loadProjectDeclaration } = await loadDistModule('storage/project-declaration.js');
  const projectRoot = await findProjectRoot(cwd);
  const notDeclaredMessage = `No .ledger/settings.json found at or above ${cwd} — run \`ledger init\` first.`;

  if (!projectRoot) {
    errorLog(notDeclaredMessage);
    return 1;
  }

  const declarationState = await loadProjectDeclaration(projectRoot);
  if (declarationState.kind === 'not_declared') {
    errorLog(notDeclaredMessage);
    return 1;
  }
  if (declarationState.kind === 'invalid') {
    errorLog(
      `${path.join(projectRoot, '.ledger', 'settings.json')} is invalid — run \`ledger init --force\` to re-create it:\n` +
        declarationState.errors.map((error) => `  ${error}`).join('\n')
    );
    return 1;
  }

  const { settings } = declarationState;
  const entry = await lookupEntryById(settings.repository_id, ledgerRootOverride);
  if (!entry) {
    errorLog(
      `Declared repository_id '${settings.repository_id}' was not found in any configured store. ` +
        `Run \`ledger init --force\` to redeclare it.`
    );
    return 1;
  }

  if (flags.check) {
    return performSyncCheck({ projectRoot, settings, entry, log });
  }
  return performSync({ projectRoot, settings, entry, log });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2)) {
  const [verb, ...rest] = argv;
  const cwd = getOriginalCwd();
  const isTTY = process.stdin.isTTY === true;

  if (verb === 'init') {
    return runInit({ cwd, args: rest, isTTY });
  }
  if (verb === 'edit') {
    return runEdit({ cwd, args: rest, isTTY });
  }
  if (verb === 'sync') {
    return runSync({ cwd, args: rest });
  }

  console.error('Usage: node scripts/ledger-project.js <init|edit|sync> [flags]');
  return 1;
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
