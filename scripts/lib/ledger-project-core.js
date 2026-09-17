/**
 * scripts/lib/ledger-project-core.js
 *
 * Pure decision core behind the `ai-insights ledger` command group
 * (`init`, `edit`, and the verbless entry point). Every classification,
 * defaulting, and refusal decision the group makes lives here, with no
 * prompting and no `process.exit` — mirroring this workspace's established
 * core/shell split (see `scripts/lib/launch-agent-core.js`).
 *
 * Functions here MAY read the filesystem (e.g. checking whether
 * `.ledger/settings.json` already exists, or reading the registry through
 * `scripts/lib/ledger-bridge.js`) — that is what keeps them decidable
 * without a caller passing in every fact by hand. What they never do is
 * perform a filesystem *write*, prompt on stdin, or spawn a process: the
 * two shells in `scripts/ledger-project.js` (flag-driven and wizard) own
 * every side effect, calling into this module for the decision and then
 * acting on the result.
 *
 * `chooseDefaultVerb()` is the one exception worth calling out explicitly:
 * per the plan (step 10d), it performs *no* I/O of its own at all — its
 * inputs (`projectRoot`, `declarationState`) are the already-resolved
 * results of `findProjectRoot()` / `loadProjectDeclaration()`, which the
 * caller obtains through the bridge before calling in.
 */

import fs from 'fs';
import path from 'path';

import { loadDistModule } from './ledger-bridge.js';

/**
 * The exact `.gitignore` line the `init` wizard offers to append (never
 * applied automatically — see the plan's "Applying the printed advisories"
 * rationale). Exported so the wizard shell in `scripts/ledger-project.js`
 * can perform the actual append without hardcoding the string a second time.
 */
export const GITIGNORE_LINE = '/.ledger/settings.local.json';

/** Relative path (from a project root) to the declaration folder. */
const LEDGER_DIR = '.ledger';

/** Filenames inside `.ledger/` that `planInitWrites()` creates. */
const SETTINGS_FILENAME = 'settings.json';
const README_FILENAME = 'README.md';

// ─── Schema access (via the compiled bridge) ───────────────────────────────

/**
 * Cached fetch of `OUTPUT_IDS` from the compiled
 * `schema/project-declaration.js`, so `OUTPUT_IDS` has exactly one source
 * of truth (the Zod schema) rather than being re-declared here and risking
 * drift when a second output ships.
 *
 * @returns {Promise<readonly string[]>}
 */
let cachedOutputIds = null;
async function getOutputIds() {
  if (!cachedOutputIds) {
    const { OUTPUT_IDS } = await loadDistModule('schema/project-declaration.js');
    cachedOutputIds = OUTPUT_IDS;
  }
  return cachedOutputIds;
}

// ─── resolveInitTarget ──────────────────────────────────────────────────────

/**
 * Resolves which registry entry `ledger init` should link a project to.
 *
 * Reads the registry across every configured store through
 * `listEntriesInStores()` (`storage/repository-lookup.ts`, via the bridge)
 * and classifies the outcome:
 *
 * - `repositoryId` supplied and it matches an entry → `'matched'`.
 * - `repositoryId` supplied and it matches nothing → `'unregistered'`
 *   (no derived-name fallback — an explicit id is never silently
 *   substituted, matching the identity resolver's own no-fallback rule).
 * - `repositoryId` omitted and exactly one candidate's `folder_names`
 *   contains the cwd's basename → `'matched'`.
 * - `repositoryId` omitted and zero candidates match the derived name →
 *   `'unregistered'`.
 * - `repositoryId` omitted and more than one candidate matches the derived
 *   name (two registry entries sharing a folder-name alias) → `'ambiguous'`.
 *
 * Every candidate in the returned list carries `isDerivedMatch`, so the
 * wizard can preselect the derived match in its numbered picker (AC-29)
 * without a second registry read.
 *
 * @param {object} params
 * @param {string} params.cwd - Absolute path to the project directory
 *   (its basename is the derived-name candidate).
 * @param {string|null|undefined} params.repositoryId - An explicitly
 *   supplied `--repository-id`, or omitted/`null` to resolve by derivation.
 * @param {string} params.ledgerRoot - The ledger root used for single-store
 *   resolution (ignored in multi-store mode, per
 *   `listEntriesInStores()`'s own contract).
 * @returns {Promise<{
 *   classification: 'matched' | 'ambiguous' | 'unregistered',
 *   matched: { storePath: string, entry: object } | null,
 *   derivedName: string,
 *   candidates: Array<{ storePath: string, entry: object, isDerivedMatch: boolean }>,
 * }>}
 */
export async function resolveInitTarget({ cwd, repositoryId, ledgerRoot }) {
  const { listEntriesInStores } = await loadDistModule('storage/repository-lookup.js');
  const entries = await listEntriesInStores(ledgerRoot);

  const derivedName = path.basename(path.resolve(cwd));
  const derivedMatches = entries.filter((candidate) => candidate.entry.folder_names.includes(derivedName));
  const derivedMatchIds = new Set(derivedMatches.map((candidate) => candidate.entry.id));

  const candidates = entries.map((candidate) => ({
    ...candidate,
    isDerivedMatch: derivedMatchIds.has(candidate.entry.id),
  }));

  if (repositoryId) {
    const matched = candidates.find((candidate) => candidate.entry.id === repositoryId) ?? null;
    return {
      classification: matched ? 'matched' : 'unregistered',
      matched,
      derivedName,
      candidates,
    };
  }

  if (derivedMatches.length === 1) {
    const matched = candidates.find((candidate) => candidate.entry.id === derivedMatches[0].entry.id) ?? null;
    return { classification: 'matched', matched, derivedName, candidates };
  }

  if (derivedMatches.length > 1) {
    return { classification: 'ambiguous', matched: null, derivedName, candidates };
  }

  return { classification: 'unregistered', matched: null, derivedName, candidates };
}

// ─── buildInitialSettings ───────────────────────────────────────────────────

/**
 * Builds the `settings.json` object for a new declaration.
 *
 * Every known output id defaults to `{ enabled: false }` (AC-02's "all
 * outputs disabled" contract); `outputs` overrides selectively enable an
 * output and/or override its path, matching `OutputConfigSchema`'s shape.
 *
 * @param {object} params
 * @param {string} params.repositoryId - The linked registry entry's id.
 * @param {Record<string, { enabled?: boolean, path?: string }>} [params.outputs] -
 *   Per-output overrides, keyed by output id. Omitted or absent entries
 *   default to `{ enabled: false }`.
 * @returns {Promise<object>} The `settings.json` object (schema_version 1).
 */
export async function buildInitialSettings({ repositoryId, outputs = {} }) {
  const outputIds = await getOutputIds();

  const outputsMap = {};
  for (const outputId of outputIds) {
    const override = outputs[outputId] ?? {};
    const config = { enabled: override.enabled === true };
    if (typeof override.path === 'string' && override.path.length > 0) {
      config.path = override.path;
    }
    outputsMap[outputId] = config;
  }

  return {
    schema_version: 1,
    repository_id: repositoryId,
    outputs: outputsMap,
  };
}

// ─── planInitWrites ──────────────────────────────────────────────────────────

/** Renders the hand-authored `.ledger/README.md` companion file. */
function renderLedgerReadme() {
  return [
    '# .ledger/',
    '',
    'This folder declares this project to the AI Insights ledger and controls',
    'which generated mirrors of ledger data are written here.',
    '',
    '- `settings.json` — the base declaration. Hand-editable, but',
    "  `ai-insights ledger edit` regenerates it in the same shape and is the",
    '  recommended way to change it.',
    '- `settings.local.json` (optional, machine-local, gitignored) — per-machine',
    "  output overrides. It may not redirect `repository_id`.",
    '- Any other file in this folder (e.g. `strategic-vision.md`) is generated',
    '  by `ai-insights ledger sync` and must never be hand-edited — a generated',
    '  file carries a `generated-by` marker on its first line.',
    '',
    'Run `ai-insights ledger sync` to (re)generate every enabled output.',
    '',
  ].join('\n');
}

/**
 * Plans the files `ledger init` would write, or refuses when an existing
 * declaration would be overwritten without `--force`.
 *
 * Reads the filesystem only to check whether `.ledger/settings.json`
 * already exists — it performs no writes itself; the caller (the flag or
 * wizard shell) is responsible for actually writing `files`.
 *
 * @param {object} params
 * @param {string} params.projectRoot - Absolute path to the project root.
 * @param {object} params.settings - The `settings.json` object to write
 *   (typically the result of `buildInitialSettings()`).
 * @param {boolean} [params.force] - Overwrite an existing declaration.
 * @param {boolean} [params.dryRun] - Report what would be written without
 *   including it in the returned `files` set.
 * @returns {{
 *   ok: boolean,
 *   reason?: 'exists_without_force',
 *   files: Array<{ path: string, contents: string }>,
 *   plannedPaths: string[],
 * }}
 */
export function planInitWrites({ projectRoot, settings, force, dryRun }) {
  const ledgerDir = path.join(projectRoot, LEDGER_DIR);
  const settingsPath = path.join(ledgerDir, SETTINGS_FILENAME);
  const readmePath = path.join(ledgerDir, README_FILENAME);

  const settingsExists = fs.existsSync(settingsPath);

  if (settingsExists && !force) {
    return { ok: false, reason: 'exists_without_force', files: [], plannedPaths: [] };
  }

  const plannedFiles = [
    { path: settingsPath, contents: `${JSON.stringify(settings, null, 2)}\n` },
    { path: readmePath, contents: renderLedgerReadme() },
  ];
  const plannedPaths = plannedFiles.map((file) => file.path);

  if (dryRun) {
    return { ok: true, files: [], plannedPaths };
  }

  return { ok: true, files: plannedFiles, plannedPaths };
}

// ─── collectAdvisories ───────────────────────────────────────────────────────

/**
 * Collects the advisory records `init`/`edit` print, as structured
 * `{ id, text, applicable }` entries rather than pre-formatted output, so a
 * shell can render, filter, or (for exactly one of them — the gitignore
 * line) offer to apply them without re-deriving the applicability logic.
 *
 * Only the gitignore advisory is ever offered for automatic application
 * (the wizard shell, per the plan's "Applying the printed advisories"
 * rationale) — the routing lines and the public-repository warning stay
 * print-only in every mode.
 *
 * @param {object} params
 * @param {string} params.projectRoot - Absolute path to the project root.
 * @returns {Array<{ id: string, text: string, applicable: boolean }>}
 */
export function collectAdvisories({ projectRoot }) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const gitignoreExists = fs.existsSync(gitignorePath);

  let gitignoreAlreadyPresent = false;
  if (gitignoreExists) {
    const contents = fs.readFileSync(gitignorePath, 'utf-8');
    gitignoreAlreadyPresent = contents
      .split(/\r?\n/)
      .some((line) => line.trim() === GITIGNORE_LINE);
  }

  return [
    {
      id: 'gitignore',
      text: `Add '${GITIGNORE_LINE}' to .gitignore so the machine-local override is never committed.`,
      // Inapplicable both when there is no .gitignore to append to, and
      // when the line is already present (nothing left to do).
      applicable: gitignoreExists && !gitignoreAlreadyPresent,
    },
    {
      id: 'agents-md-routing',
      text: 'Add a routing line to AGENTS.md pointing at the generated mirror, so agents relying on ripgrep (which skips hidden directories by default) can find it.',
      applicable: true,
    },
    {
      id: 'manifest-routing',
      text: 'Add a routing line to the project manifest (e.g. docs/agents/project-manifest/README.md) pointing at the generated mirror.',
      applicable: true,
    },
    {
      id: 'public-repository-warning',
      text: 'Warning: enabled outputs mirror strategic vision content into this working tree. Do not enable an output in a public repository unless the vision is meant to be publicly visible.',
      applicable: true,
    },
  ];
}

// ─── chooseDefaultVerb ───────────────────────────────────────────────────────

/**
 * Infers which verb a verbless `ai-insights ledger` invocation should run,
 * from the already-resolved results of `findProjectRoot()` and
 * `loadProjectDeclaration()`. Performs no filesystem I/O of its own — the
 * caller resolves `projectRoot`/`declarationState` first (through the
 * bridge) and passes them in, which is what keeps this function directly
 * testable against fixture objects rather than a temp filesystem.
 *
 * @param {object} params
 * @param {string} params.cwd - The invocation directory
 *   (`getOriginalCwd()`).
 * @param {string|null} params.projectRoot - The result of
 *   `findProjectRoot(cwd)`: the nearest ancestor carrying
 *   `.ledger/settings.json`, or `null` when none does.
 * @param {object|null|undefined} params.declarationState - The result of
 *   `loadProjectDeclaration(projectRoot)` when `projectRoot` is non-null
 *   (a `ProjectDeclarationResult` discriminated union); ignored when
 *   `projectRoot` is `null`.
 * @returns {
 *   { verb: 'init', projectRoot: string } |
 *   { verb: 'edit', projectRoot: string, confirmRoot: boolean } |
 *   { error: 'invalid_declaration', projectRoot: string }
 * }
 */
export function chooseDefaultVerb({ cwd, projectRoot, declarationState }) {
  if (!projectRoot) {
    return { verb: 'init', projectRoot: cwd };
  }

  if (declarationState && declarationState.kind === 'invalid') {
    return { error: 'invalid_declaration', projectRoot };
  }

  if (declarationState && declarationState.kind === 'declared') {
    const confirmRoot = path.resolve(projectRoot) !== path.resolve(cwd);
    return { verb: 'edit', projectRoot, confirmRoot };
  }

  // A non-null projectRoot with a `not_declared` state should not occur —
  // findProjectRoot() only ever returns a directory that has
  // .ledger/settings.json — but if the file vanished between the walk and
  // the load (e.g. a concurrent `ledger init --force`), fall back to `init`
  // at the invocation directory rather than crashing on an unhandled state.
  return { verb: 'init', projectRoot: cwd };
}
