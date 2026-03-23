# Plan

## Summary

Add a GitHub Actions release workflow that, when a `v*` tag is pushed, builds the standalone personas for both IDEs using the existing `build-personas.js` pipeline, packages each IDE set into a ZIP archive, extracts release notes from the topmost entry in the root `changelog.md`, and publishes a GitHub Release with both archives attached as downloadable assets.

---

## Architectural Context

**Personas build system** (`personas/`, `scripts/build-personas.js`):
- Source templates live in `personas/standalone/src/` (content + YAML metadata).
- `scripts/build-personas.js --suite standalone --target all` writes generated Markdown files to two directories:
  - `personas/standalone/vs-code/` — VS Code persona files
  - `personas/standalone/claude-code/` — Claude Code persona files
- Both output directories are excluded from version control via `.gitignore` (entries `/personas/standalone/vs-code/*.md` and `/personas/standalone/claude-code/*.md`). Only `.gitkeep` is tracked, so generated files are always ephemeral.
- The build requires `js-yaml`, declared in `personas/package.json` and installed via `npm ci` from the `personas/` directory. The `yaml` module is required via an absolute path in `build-personas.js`:
  ```js
  require(path.join(__dirname, '..', 'personas', 'node_modules', 'js-yaml'))
  ```
  This means `npm ci` must be run from `personas/` before the build script is invoked.

**Root changelog** (`changelog.md`):
- Format: `## v{version} - {title}` (occasionally `—` instead of `-`)
- Body: free-form bullet lines until the next `## ` heading
- Topmost entry represents the current release.

**No `.github/` directory** currently exists at the workspace root.

**Ledger personas are out of scope** — they depend on the locally running MCP server and its configuration, making them inappropriate for self-contained end-user download.

---

## Approach / Architecture

### Two new files

1. **`scripts/extract-changelog-entry.js`** — A standalone Node.js (CJS) script that parses `changelog.md`, extracts the topmost entry, and outputs structured data. It will set [GitHub Actions step outputs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/passing-information-between-jobs) (`version`, `title`, `body`) so the workflow can reference them cleanly in subsequent steps. The script is also independently executable for local testing.

2. **`.github/workflows/release-personas.yml`** — A GitHub Actions workflow that orchestrates the full release pipeline:
   - Triggered on `push` of a tag matching `v*`
   - Checks out the repository
   - Sets up Node.js 20
   - Installs dependencies (`cd personas && npm ci`)
   - Builds standalone personas for all targets (`node scripts/build-personas.js --suite standalone --target all --strict`)
   - Creates two ZIP archives using the `zip` CLI tool (available by default on `ubuntu-latest`)
   - Runs the changelog extractor and captures outputs
   - Creates the GitHub Release via `softprops/action-gh-release@v2`

### ZIP archive layout

| Archive name | Contents |
|---|---|
| `ai-insights-personas-vscode-{version}.zip` | All `*.md` files from `personas/standalone/vs-code/` (flat structure — no parent directory prefix) |
| `ai-insights-personas-claudecode-{version}.zip` | All `*.md` files from `personas/standalone/claude-code/` (flat structure) |

Flat layout is preferred so end users can unzip directly into their IDE's prompts/agents directory without navigating a subdirectory.

### Changelog parsing logic (`extract-changelog-entry.js`)

1. Read `changelog.md` relative to the workspace root.
2. Find the first line matching `/^## /` (the topmost entry header).
3. Parse the header with regex `/^## (v[\d.]+(?:-\w+)?)\s+[-—]\s+(.+?)(?:\s*\(\d{4}-\d{2}-\d{2}\))?$/` to extract `version` and `title`.
4. Collect all subsequent non-empty lines until the next `## ` heading as the `body`.
5. When invoked in a GitHub Actions environment (`GITHUB_OUTPUT` env var is set), emit `version`, `title`, and `body` to the output file in the multiline format. When invoked locally, print a JSON summary to stdout for inspection.

---

## Rationale

- **Standalone only:** Ledger personas require a configured MCP server and cannot be dropped in by an end user — distributing them in a release would lead to confusion.
- **`softprops/action-gh-release@v2`:** The canonical community action for creating GitHub releases with assets; well-maintained and requires no custom API scripting.
- **Separate extraction script vs. inline shell:** Extracting changelog data in a file-backed Node.js script rather than inline bash `awk`/`sed` keeps the YAML readable, is independently testable, and aligns with the existing Node.js-first scripting convention of this project (`scripts/*.js`).
- **Flat ZIP layout:** End users install personas by dropping files into a directory. A flat layout removes friction.
- **`--strict` flag on build:** Forces the workflow to exit 1 if any template markers remain unresolved, catching template regressions before they ship to end users.
- **`v*` tag trigger:** Matches the existing root changelog versioning scheme (e.g., `v1.3.0`) without requiring a separate tag namespace for personas vs. MCP server releases, consistent with the user's stated approach.

---

## Detailed Steps

1. Create `scripts/extract-changelog-entry.js`:
   - Reads `changelog.md` from the workspace root.
   - Parses the topmost `## ` entry for `version`, `title`, and `body`.
   - Handles both `-` and `—` as separators in the header.
   - Strips optional date suffix `(YYYY-MM-DD)` from title if present.
   - When `GITHUB_OUTPUT` is set, writes multiline outputs using the heredoc delimiter syntax required by GitHub Actions.
   - When run locally (`node scripts/extract-changelog-entry.js`), prints JSON to stdout.

2. Create `.github/workflows/release-personas.yml`:
   - Trigger: `on: push: tags: ['v*']`
   - Permissions: `contents: write` (required to create a release)
   - Steps:
     1. `actions/checkout@v4`
     2. `actions/setup-node@v4` with `node-version: '20'`
     3. `npm ci` in `personas/` directory
     4. Run `node scripts/build-personas.js --suite standalone --target all --strict`
     5. Create VS Code ZIP: `cd personas/standalone/vs-code && zip -j ../../../ai-insights-personas-vscode-${{ steps.changelog.outputs.version }}.zip *.md`
     6. Create Claude Code ZIP: `cd personas/standalone/claude-code && zip -j ../../../ai-insights-personas-claudecode-${{ steps.changelog.outputs.version }}.zip *.md`
     7. Run `node scripts/extract-changelog-entry.js` (as step `changelog`) — must run **before** ZIP naming in step 5 & 6, so re-order: run changelog extractor right after checkout, before the build steps.
     8. Create release via `softprops/action-gh-release@v2` with `files` pointing to the two ZIPs, `name` set to `${{ steps.changelog.outputs.title }}`, `tag_name` from `${{ github.ref_name }}`, and `body` from the extracted changelog body.

   Final step ordering after re-sequencing:
   1. Checkout
   2. Setup Node.js
   3. Extract changelog entry (step id: `changelog`)
   4. Install dependencies
   5. Build standalone personas (`--strict`)
   6. Create VS Code ZIP
   7. Create Claude Code ZIP
   8. Create GitHub Release

---

## Dependencies

- `softprops/action-gh-release@v2` (GitHub Actions marketplace — no local install needed)
- `actions/checkout@v4` (standard)
- `actions/setup-node@v4` (standard)
- `zip` CLI — pre-installed on `ubuntu-latest` GitHub-hosted runner
- Existing `scripts/build-personas.js` and `personas/package.json`
- Root `changelog.md` (must be present and follow the existing format)

---

## Required Components

- **New:** `scripts/extract-changelog-entry.js`
- **New:** `.github/workflows/release-personas.yml`
- **New:** `.github/` directory (does not currently exist)
- **Existing (unmodified):** `scripts/build-personas.js`
- **Existing (unmodified):** `personas/package.json`
- **Existing (unmodified):** `changelog.md`

---

## Assumptions

- The repository is hosted on GitHub and has Actions enabled.
- `github.ref_name` on a tag push resolves to the tag name (e.g., `v1.3.0`), which is standard GitHub Actions behavior.
- The operator creating a release will push a tag whose name matches the topmost `changelog.md` entry (e.g., pushing `v1.3.0` when `## v1.3.0 - ...` is the first entry). No automated validation of version-tag alignment is included (YAGNI).
- The `ubuntu-latest` runner has `zip` pre-installed (it does as of Feb 2026).
- `GITHUB_TOKEN` is available as the implicit token; no additional secrets are needed since the release is created in the same repository.

---

## Constraints

- Only standalone personas are included in the release archives. Ledger personas are explicitly excluded.
- The workflow must not commit generated files back to the repository.
- The build must pass `--strict` — no unresolved template markers may ship in release archives.
- The `extract-changelog-entry.js` script follows the CJS (`'use strict'`) style of all other files in `scripts/`.
- No modifications to existing scripts (`build-personas.js`, `sync-personas.js`).

---

## Out of Scope

- MCP server releases / packaging (separate concern, different trigger strategy).
- Ledger persona distribution.
- Changelog format validation or linting.
- Automated tag creation (operator pushes the tag manually).
- Version alignment validation (ensuring the pushed tag matches the changelog version).

---

## Acceptance Criteria

- Pushing a `v*` tag triggers the workflow on GitHub Actions.
- The workflow completes successfully, building all standalone personas without strict-mode errors.
- A GitHub Release is created with:
  - Tag name matching the pushed tag (e.g., `v1.3.0`)
  - Release title matching the changelog entry title (e.g., `Multi-IDE Persona Builds`)
  - Release body containing the bullet-point list from the changelog entry
  - Two ZIP file assets attached: `ai-insights-personas-vscode-v1.3.0.zip` and `ai-insights-personas-claudecode-v1.3.0.zip`
- Each ZIP contains only the `*.md` persona files (flat, no subdirectory nesting).
- Running `node scripts/extract-changelog-entry.js` locally prints a JSON object with `version`, `title`, and `body` fields correctly parsed from the topmost changelog entry.

---

## Testing Strategy

- **Local extraction test:** Run `node scripts/extract-changelog-entry.js` from the workspace root and verify the JSON output matches the topmost `changelog.md` entry manually.
- **Local build test:** Run `node scripts/build-personas.js --suite standalone --target all --strict` locally to confirm the build completes cleanly and both output directories are populated.
- **Dry-run ZIP test:** Manually run the `zip` commands locally (after a local build) to inspect archive contents with `unzip -l`.
- **Workflow integration test:** Push a test tag (e.g., `v1.3.0-rc1`) to a fork or the main repo, observe the Actions run, and verify the release is created with correct metadata and attachments. Delete the test tag and release after verification.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`zip` not available on runner** | `ubuntu-latest` consistently includes `zip`; if needed, add `sudo apt-get install -y zip` as a fallback step before the ZIP steps. |
| **Tag pushed before changelog is updated** | Document in release process: update `changelog.md` first, then push tag. No workflow-level guard needed (avoids over-engineering). |
| **Multiline `body` output truncated by GitHub Actions GITHUB_OUTPUT** | Use the heredoc delimiter syntax (`body<<EOF … EOF`) which handles newlines correctly and is the official GitHub recommendation for multiline outputs. |
| **`--strict` fails due to a template regression** | The build step exits 1 and the workflow fails before creating the release, preventing broken personas from shipping. This is the intended behavior. |
| **Release accidentally created with wrong tag** | Tags and releases can be deleted from GitHub UI; this is low-risk since the operator controls when to push a tag. |
