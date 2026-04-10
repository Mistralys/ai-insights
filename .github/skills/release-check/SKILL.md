---
name: release-check
description: 'Pre-release readiness check for the ai-insights workspace. Run all checks before tagging a release: version sync, workflow manifest, persona lock file, persona build freshness, MCP server tests, orchestrator tests, ruff linting, and Git state. Use when: preparing a release, verifying release readiness, checking if the project is ready to tag.'
---

# Release Check

Validates that the workspace is ready to tag and publish a new release. Mirrors every check the CI pipeline performs, plus Git state verification.

## Procedure

Run all steps in order. Report the result of each check before continuing to the next.

### 1. Version sync

```bash
node scripts/check-version-sync.js
```

Confirms each module's changelog version matches its `package.json`. Must exit 0.

---

### 2. Workflow manifest validation

```bash
node scripts/validate-workflow-manifest.js
```

Validates `shared/workflow-manifest.json` structure and cross-references (roles, pipelines, status enums). Must exit 0.

---

### 3. Personas lock file sync

```bash
cd personas && npm ci
```

`npm ci` fails if `package-lock.json` is out of sync with `package.json`.  
**Common failure:** upgrading `@mistralys/persona-builder` in `package.json` without re-running `npm install` to regenerate the lock file.

**Fix if it fails:**
```bash
cd personas && npm install
```
Then confirm `npm ci` passes again. The updated `personas/package-lock.json` must be committed before tagging.

---

### 4. Persona build freshness

```bash
cd personas && npm ci   # already done in step 3
cd .. && node scripts/build-personas.js --check
```

Detects stale generated output. If `--check` fails, run a real build first:
```bash
node scripts/build-personas.js
```
Then re-run `--check`. Any newly written files must be committed before tagging.

---

### 5. MCP server tests

```bash
cd mcp-server && npm ci && npm test
```

All 58 test files and 1743 tests must pass. The `pretest` hook (`npm ci` for personas) is already satisfied by step 3. Investigate any regressions before proceeding.

---

### 6. Orchestrator tests

```bash
cd orchestrator && pytest
```

All tests (777 at last count, 7 skipped) must pass. Skipped tests are acceptable; failures are not.

---

### 7. Ruff linting

```bash
cd orchestrator && ruff check src/
```

Must report `All checks passed!`. Fix any violations introduced by recent changes before tagging.

---

### 8. Git working tree

```bash
git status --short
git diff --name-only
```

The working tree must be **clean** before tagging. If there are uncommitted files (e.g., a regenerated lock file or persona output from steps 3–4), commit them first.

---

### 9. Release tag gap check

```bash
git tag --sort=-v:refname | head -3
```

Compare the latest tag against the root `changelog.md` top entry. The changelog version must be **ahead** of the latest tag (i.e., not yet tagged). If they match, there is nothing new to release.

---

## Pass Criteria

| Check | Expected result |
|-------|-----------------|
| Version sync | Exit 0, "All module versions are in sync" |
| Manifest validation | Exit 0, roles and pipelines count reported |
| Personas `npm ci` | Exit 0, no lock file mismatch error |
| Persona build `--check` | Exit 0, no stale files detected |
| MCP server tests | All test files and tests pass |
| Orchestrator tests | All tests pass (skips allowed) |
| Ruff | "All checks passed!" |
| Git working tree | No uncommitted changes |
| Tag gap | Changelog version > latest Git tag |

All 9 checks must pass before tagging the release.

---

## Tagging

Once all checks pass:

```bash
git tag v<version>
git push origin v<version>
```

Where `<version>` is the version from the top entry of `changelog.md` (e.g., `v1.15.0`).
