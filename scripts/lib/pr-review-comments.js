/**
 * scripts/lib/pr-review-comments.js
 *
 * Pure logic for scripts/fetch-pr-review-comments.js: argument parsing, the
 * GitHub GraphQL query, paginated thread fetching, and thread filtering.
 *
 * The `gh` invocation is injected (`runGh`) so everything here is testable
 * without network access or a GitHub CLI install.
 */

import { spawnSync } from 'child_process';

/** Default reviewer filter: any author login containing "copilot" (case-insensitive). */
export const DEFAULT_AUTHOR_PATTERN = 'copilot';

/** GraphQL page size for review threads (GitHub maximum). */
const THREAD_PAGE_SIZE = 100;

/** Hard stop for pagination, guarding against a cursor that never ends. */
const MAX_PAGES = 50;

export const REVIEW_THREADS_QUERY = `
query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:${THREAD_PAGE_SIZE},after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{
          id isResolved isOutdated path line startLine
          comments(first:50){
            totalCount
            nodes{ author{login} body url }
          }
        }
      }
    }
  }
}`;

export const HELP = `
Usage: node scripts/fetch-pr-review-comments.js [options]

Fetch review comments of a pull request as a JSON array on stdout.
By default only unresolved, non-outdated threads whose first comment was
written by Copilot are returned. Run it from inside the repository to review.

Options:
  --pr <number>        Pull request number (default: PR of the current branch)
  --repo <owner/name>  Repository (default: repository of the current directory)
  --author <regex>     Case-insensitive pattern matched against the login of the
                       thread's first comment (default: "${DEFAULT_AUTHOR_PATTERN}").
                       Use ".*" to include every reviewer.
  --include-resolved   Also return resolved threads
  --include-outdated   Also return outdated threads
  --help               Show this help

Output (one object per thread):
  { id, path, line, startLine, isResolved, isOutdated, author, body, url,
    commentCount }
  "body"/"author"/"url" belong to the thread's first comment.

Requires the GitHub CLI (gh), authenticated. Exit code 1 on any failure.
`;

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{ help: boolean, pr: number|null, repo: string|null, author: string,
 *             includeResolved: boolean, includeOutdated: boolean }}
 * @throws {Error} On unknown flags, missing values, or malformed values.
 */
export function parseArgs(argv) {
  const opts = {
    help: false,
    pr: null,
    repo: null,
    author: DEFAULT_AUTHOR_PATTERN,
    includeResolved: false,
    includeOutdated: false,
  };

  const takeValue = (flag, i) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--include-resolved':
        opts.includeResolved = true;
        break;
      case '--include-outdated':
        opts.includeOutdated = true;
        break;
      case '--pr': {
        const raw = takeValue(arg, i++);
        if (!/^[1-9]\d*$/.test(raw)) {
          throw new Error(`--pr must be a positive integer, got "${raw}"`);
        }
        opts.pr = Number(raw);
        break;
      }
      case '--repo': {
        const raw = takeValue(arg, i++);
        if (!/^[\w.-]+\/[\w.-]+$/.test(raw)) {
          throw new Error(`--repo must look like owner/name, got "${raw}"`);
        }
        opts.repo = raw;
        break;
      }
      case '--author':
        opts.author = takeValue(arg, i++);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

/**
 * Compile the author pattern, turning a bad regex into a readable error.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function compileAuthorPattern(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    throw new Error(`--author is not a valid regular expression: ${err.message}`);
  }
}

/**
 * Real `gh` runner. Returns stdout; throws an Error carrying gh's stderr on failure.
 *
 * @param {string[]} args
 * @returns {string}
 */
export function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', shell: false });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('The GitHub CLI (gh) was not found on PATH. Install it from https://cli.github.com/ and run `gh auth login`.');
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (exit ${result.status}): ${detail}`);
  }
  return result.stdout;
}

/**
 * Resolve owner/name and PR number, asking `gh` for whatever was not given.
 *
 * @param {{ repo: string|null, pr: number|null }} opts
 * @param {(args: string[]) => string} gh
 * @returns {{ owner: string, repo: string, pr: number }}
 */
export function resolveTarget(opts, gh = runGh) {
  const nameWithOwner = opts.repo
    ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  const [owner, repo] = nameWithOwner.split('/');
  if (!owner || !repo) {
    throw new Error(`Could not determine the repository (got "${nameWithOwner}"). Pass --repo owner/name.`);
  }

  let pr = opts.pr;
  if (pr === null) {
    const raw = gh(['pr', 'view', '--json', 'number', '--jq', '.number']).trim();
    pr = Number(raw);
    if (!Number.isInteger(pr) || pr < 1) {
      throw new Error('Could not determine the PR of the current branch. Pass --pr <number>.');
    }
  }

  return { owner, repo, pr };
}

/**
 * Fetch every review thread of a PR, following pagination.
 *
 * Strings go through `-f` (raw) rather than `-F` so a repo or cursor that
 * looks numeric is never coerced; only the PR number uses `-F`.
 *
 * @param {{ owner: string, repo: string, pr: number }} target
 * @param {(args: string[]) => string} gh
 * @returns {object[]} Raw GraphQL thread nodes.
 */
export function fetchReviewThreads({ owner, repo, pr }, gh = runGh) {
  const threads = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const args = [
      'api', 'graphql',
      '-f', `query=${REVIEW_THREADS_QUERY}`,
      '-f', `owner=${owner}`,
      '-f', `repo=${repo}`,
      '-F', `pr=${pr}`,
    ];
    if (cursor) args.push('-f', `cursor=${cursor}`);

    let payload;
    try {
      payload = JSON.parse(gh(args));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`gh returned malformed JSON: ${err.message}`);
      }
      throw err;
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(`GitHub GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
    }

    const pullRequest = payload?.data?.repository?.pullRequest;
    if (!pullRequest) {
      throw new Error(`Pull request #${pr} not found in ${owner}/${repo}.`);
    }

    const { nodes, pageInfo } = pullRequest.reviewThreads;
    threads.push(...nodes);

    if (!pageInfo.hasNextPage) return threads;
    cursor = pageInfo.endCursor;
  }

  throw new Error(`Stopped after ${MAX_PAGES} pages of review threads; refusing to paginate further.`);
}

/**
 * Filter raw threads and flatten them into the output records.
 *
 * @param {object[]} threads Raw GraphQL thread nodes.
 * @param {{ author: string, includeResolved: boolean, includeOutdated: boolean }} opts
 * @returns {object[]}
 */
export function selectThreads(threads, opts) {
  const authorRe = compileAuthorPattern(opts.author);

  return threads
    .filter((t) => opts.includeResolved || !t.isResolved)
    .filter((t) => opts.includeOutdated || !t.isOutdated)
    .map((t) => ({ thread: t, first: t.comments?.nodes?.[0] ?? null }))
    // A thread without comments cannot be attributed, so it never matches.
    .filter(({ first }) => first !== null && authorRe.test(first.author?.login ?? ''))
    .map(({ thread, first }) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      startLine: thread.startLine,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      author: first.author?.login ?? null,
      body: first.body,
      url: first.url,
      commentCount: thread.comments.totalCount,
    }));
}
