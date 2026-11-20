# Address PR Review Comments

Fetch the open Copilot review comments of a pull request and fix the valid ones in the
local checkout.

## Input

A PR URL (`https://github.com/ORG/REPO/pull/123`) or a PR number. Ask the user if neither
was given. From a URL, take `ORG/REPO` and the number. From a bare number, the repository
is the one in the current directory.

## Instructions

1. **Check the checkout.** The current directory must be a local clone of the PR's
   repository, on the PR's branch. Verify with `git remote -v` and `git branch --show-current`.
   When it is the wrong repository, stop and tell the user. When the branch differs from
   the PR's head branch, say so and ask before continuing, since the comments refer to the
   PR's code.

2. **Locate the fetch script.** It is `scripts/fetch-pr-review-comments.js` in the
   AI Insights repository, which is not necessarily the repository under review. Find it in
   this order:
   - the current directory, when it is the AI Insights repository;
   - the directory of the `ai-insights` command: resolve the symlink of `which ai-insights`
     (`where ai-insights` on Windows) and use `scripts/` next to its target `cli.js`;
   - otherwise ask the user for the path.

3. **Fetch the threads.** Run the script from the repository under review, with the script's
   absolute path:

   ```
   node <path>/scripts/fetch-pr-review-comments.js --repo ORG/REPO --pr 123
   ```

   Omit `--repo` and `--pr` to use the current directory's repository and branch PR.
   The output is a JSON array of unresolved, non-outdated Copilot threads, each with `id`,
   `path`, `line`, `startLine`, `body`, `url` and `commentCount`. Add `--include-resolved`,
   `--include-outdated` or `--author <regex>` only when the user asks for them.
   An empty array means there is nothing to fix: report that and stop. On a non-zero exit,
   show the error message (usually `gh` missing or not logged in) and stop.

4. **Assess each thread.** Read the code at `path` around `startLine`–`line` and judge the
   comment on its merits. Copilot is sometimes wrong, so never apply a suggestion blindly.
   Classify each thread as:
   - **Fix** — the comment is correct and actionable.
   - **Dispute** — the comment is wrong, already handled, or contradicts a project rule.
     State the evidence.
   - **Ask** — fixing it involves a design choice the user should make.

5. **Fix.** Apply the minimal change for each *Fix* thread, following the repository's
   conventions and instruction files. Add or adjust tests where the comment concerns
   behaviour. Then run the repository's tests and static analysis for the touched code.

6. **Report.** Give one table row per thread: `path:line`, a one-line summary of the
   comment, the classification, and what was done or why it was disputed. Link each row
   to the thread `url`. End with the test results and the list of *Ask* items.

## Constraints

- Make no git write operations: no staging, commits, pushes or branch changes. Leave the
  changes in the working tree for the user.
- Do not reply to or resolve review threads on GitHub. Reporting is local only.
- Touch only what the comments concern. Mention unrelated problems you notice in the
  report instead of fixing them.
