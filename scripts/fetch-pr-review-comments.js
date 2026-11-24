#!/usr/bin/env node

/**
 * scripts/fetch-pr-review-comments.js
 *
 * Fetches the review comments of a GitHub pull request (by default only the
 * unresolved, non-outdated Copilot threads) and prints them as JSON, so a PR
 * review skill can read them and fix the issues locally.
 *
 * Usage:
 *   node scripts/fetch-pr-review-comments.js                      PR of the current branch
 *   node scripts/fetch-pr-review-comments.js --pr 123             Explicit PR
 *   node scripts/fetch-pr-review-comments.js --repo ORG/REPO      Explicit repository
 *   node scripts/fetch-pr-review-comments.js --author ".*"        All reviewers
 *   node scripts/fetch-pr-review-comments.js --include-resolved --include-outdated
 *   node scripts/fetch-pr-review-comments.js --help
 *
 * Run it from inside the repository under review; `gh` resolves the repo and
 * PR from the current directory. Not registered in the CLI menu on purpose.
 *
 * Exit codes: 0 success (an empty array means nothing to fix), 1 failure.
 * Requires the GitHub CLI (`gh`), authenticated. Logic lives in
 * scripts/lib/pr-review-comments.js.
 */

import {
  HELP,
  parseArgs,
  resolveTarget,
  fetchReviewThreads,
  selectThreads,
} from './lib/pr-review-comments.js';

try {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const target = resolveTarget(opts);
  const threads = fetchReviewThreads(target);
  const selected = selectThreads(threads, opts);

  process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
} catch (err) {
  process.stderr.write(`fetch-pr-review-comments: ${err.message}\n`);
  process.exit(1);
}
