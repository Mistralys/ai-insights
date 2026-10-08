#!/usr/bin/env node

/**
 * build-personas.js — thin wrapper around @mistralys/persona-builder.
 * All build logic is delegated to the library via the CLI binary.
 * Usage: node scripts/build-personas.js [--check] [--strict] [--dry-run]
 *
 * Every wrapper-side check (agent-slug cross-references, insight_agent
 * pairing, rendered sub-agent references, philosophy tone, changelog entry
 * size) runs unconditionally, through the single `runBuildChecks()`
 * descriptor list in `lib/build-checks.js` — a failing or crashing check
 * never hides a later one or the post-build steps. The process exit call
 * happens exactly once, at the end of the script, via `resolveExitCode()`,
 * which combines the library CLI's own exit status with the aggregated
 * check results.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { generateNameMapping, writeNameMapping } from './lib/name-mapping.js';
import { validateInsightFieldsInDirs } from './lib/insight-validation.js';
import { validateSubagentReferences } from './lib/subagent-reference-validation.js';
import { checkPhilosophyToneInDirs } from './lib/philosophy-tone.js';
import { checkChangelogEntrySize } from './lib/changelog-size-check.js';
import { validateAgentSlugReferences } from './lib/agent-slug-validation.js';
import { runBuildChecks, resolveExitCode } from './lib/build-checks.js';

const _require = createRequire(import.meta.url);

const ROOT     = path.join(import.meta.dirname, '..');
const PERSONAS = path.join(ROOT, 'personas');
const CONFIG   = path.join(PERSONAS, 'persona-build.config.js');
const CLI      = path.join(PERSONAS, 'node_modules', '@mistralys', 'persona-builder', 'dist', 'cli.js');

// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

// Pre-build: clean output directories so stale/renamed files don't linger.
// Skipped in --check / --dry-run mode (read-only).
if (!CHECK) {
  const config = _require(CONFIG);
  const outputDirs = [];
  for (const suite of Object.values(config.suites)) {
    if (suite.outVscode)     outputDirs.push(suite.outVscode);
    if (suite.outClaudeCode) outputDirs.push(suite.outClaudeCode);
    if (suite.outputDirs) {
      for (const dir of Object.values(suite.outputDirs)) {
        outputDirs.push(dir);
      }
    }
  }
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

// Delegate build to the library CLI. The exit status is captured rather than
// used to exit immediately — a failing library CLI no longer hides the
// post-build steps or the checks below; the process exit call happens
// exactly once, at the very end of this script, after resolveExitCode()
// combines this status with every check's result.
const cliArgs = ['--config', CONFIG];
if (CHECK)  cliArgs.push('--check');
if (STRICT) cliArgs.push('--strict');

let libraryStatus = 0;
try {
  execFileSync(process.execPath, [CLI, ...cliArgs], { stdio: 'inherit' });
} catch (err) {
  libraryStatus = err.status ?? 1;
}

// Post-build: sync personas/package.json version from changelog (real builds only)
if (!CHECK) {
  const changelogPath = path.join(ROOT, 'personas', 'changelog.md');
  const pkgPath       = path.join(ROOT, 'personas', 'package.json');
  const changelog     = fs.readFileSync(changelogPath, 'utf8');
  const match         = changelog.match(/^## v(\d+\.\d+\.\d+)/m);

  if (!match) {
    console.warn('[WARN] Could not extract version from personas/changelog.md — skipping package.json update.');
  } else {
    const newVersion = match[1];
    const pkg        = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version !== newVersion) {
      const oldVersion = pkg.version;
      pkg.version = newVersion;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`Updated personas/package.json: ${oldVersion} → ${newVersion}`);
    } else {
      console.log(`personas/package.json already at v${newVersion} — no update needed.`);
    }
  }
}

// Post-build: generate personas/name-mapping.json (real builds only)
if (!CHECK) {
  const outPath = path.join(ROOT, 'personas', 'name-mapping.json');

  const { entries, ledgerCount, nonLedgerCount } = generateNameMapping({
    personasDir: path.join(ROOT, 'personas'),
  });
  writeNameMapping(outPath, entries);
  console.log(`Generated personas/name-mapping.json with ${entries.length} entries (${ledgerCount} ledger, ${nonLedgerCount} non-ledger).`);
}

// Hoist the library load above the descriptor list so both the agent-slug
// check (comment-aware stripComments) and the sub-agent-reference check
// (build()) share the one loaded module, instead of requiring it a second
// time deep inside a later block. Wrapped in try/catch: a stale dist/ build
// predating the stripComments export, or one that fails to load entirely,
// must not prevent the slug check from running — it just runs without
// comment awareness in that case, and the sub-agent-reference check's own
// run() will surface the missing `build` function as an error result
// through the runner's try/catch instead.
let libraryModule;
try {
  libraryModule = _require(path.join(PERSONAS, 'node_modules', '@mistralys', 'persona-builder', 'dist', 'index.cjs'));
} catch {
  libraryModule = null;
}
const stripCommentsFn = (libraryModule && typeof libraryModule.stripComments === 'function')
  ? libraryModule.stripComments
  : (text) => text;

// Every check below runs on every invocation (real build AND --check),
// through the single runBuildChecks() descriptor list — no check's failure
// (or crash) hides a later one, and the two hard-fail checks (formerly five
// individual exit calls, now none here) are decided once, at the end, by
// resolveExitCode().
const checks = [
  {
    id: 'agent-slug-refs',
    label: 'agent_slug cross-reference check',
    severity: 'error',
    // Ensures every {{agent_slug_X_Y}} reference in a persona content file
    // has a matching slug "x-y" declared in that persona's `subagents` list
    // in the YAML. A reference written inside a template comment is inert
    // (stripCommentsFn removes it before the scan), matching the library's
    // own comment-inertness contract.
    run: () => validateAgentSlugReferences(
      path.join(ROOT, 'personas', 'ledger', 'src', 'meta'),
      path.join(ROOT, 'personas', 'ledger', 'src', 'content'),
      { stripComments: stripCommentsFn },
    ),
  },
  {
    id: 'insight-fields',
    label: 'insight_agent validation',
    severity: 'error',
    run: () => validateInsightFieldsInDirs([
      path.join(ROOT, 'personas', 'ledger', 'src', 'meta'),
      path.join(ROOT, 'personas', 'standalone', 'src', 'meta'),
      path.join(ROOT, 'personas', 'ledger-support', 'src', 'meta'),
    ]),
  },
  {
    id: 'subagent-refs',
    label: 'rendered sub-agent reference validation',
    severity: 'error',
    // Renders every persona in memory through the library's own build()
    // (check mode, no writes) — the only reliable view of the output:
    // generated files are gitignored and the CLI's --check does not compare
    // against disk. Per-persona `targets` filtering, the cross-target
    // dispatch-grant check, and the "sub-agent not built for this target"
    // error are all owned by the library now — it already skips rendering
    // (and therefore never writes) an excluded persona × target
    // combination, so there is nothing left here to prune from disk. This
    // check still validates that each rendered dispatch names every
    // declared sub-agent by the identifier its target platform matches, and
    // selects no undeclared agent. A missing `build` (library failed to
    // load above) or a rejected build() call (e.g. a broken persona)
    // surfaces here as an error result via the runner's try/catch, rather
    // than crashing the whole script.
    run: async () => {
      const config  = _require(CONFIG);
      const summary = await libraryModule.build({ ...config, check: true });
      return validateSubagentReferences(summary.results);
    },
  },
  {
    id: 'philosophy-tone',
    label: 'imperative phrasing in Operating Philosophy sections',
    severity: 'warn',
    // Heuristic (guide v3.0 mood rule) — warns rather than fails, since a
    // legitimate declarative can open with a verb the detector does not
    // know. Shared partials are included: a philosophy section extracted
    // into a partial must not fall out of tone coverage. Imperative prose
    // written inside a template comment is inert here too, via the same
    // stripCommentsFn seam the agent-slug check above uses.
    run: () => checkPhilosophyToneInDirs([
      path.join(ROOT, 'personas', 'ledger', 'src', 'content'),
      path.join(ROOT, 'personas', 'standalone', 'src', 'content'),
      path.join(ROOT, 'personas', 'ledger-support', 'src', 'content'),
      path.join(ROOT, 'personas', 'shared', 'partials'),
    ], { stripComments: stripCommentsFn }),
  },
  {
    id: 'changelog-size',
    label: 'oversized personas/changelog.md entry',
    severity: 'warn',
    // Heuristic (line/bullet/sentence thresholds) — warns rather than
    // fails, since a legitimately large multi-persona release can still be
    // well-summarized.
    run: () => {
      const changelogPath = path.join(ROOT, 'personas', 'changelog.md');
      if (!fs.existsSync(changelogPath)) return [];
      const text = fs.readFileSync(changelogPath, 'utf8');
      return checkChangelogEntrySize(text, 'personas/changelog.md');
    },
  },
];

const { errorCount } = await runBuildChecks(checks);

process.exit(resolveExitCode(libraryStatus, { errorCount }));