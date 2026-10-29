# Constraints & Conventions — Workspace Level

The workspace-wide rules that are not owned by a single sub-project. Each module's own rules live in its `constraints*.md`, linked from the [hub index](README.md). Generated-file handling is bound by the module `constraints.md` → Generated Artefacts sections, described in [generated-artefacts.md](generated-artefacts.md); sync points are tabulated in [cross-system-dependencies.md](cross-system-dependencies.md).

This document opens with a digest of the highest-impact rules, then holds the workspace-wide rules that no module owns: git operations, the live workspace, platform support for all code, and the changelog convention. The platform and changelog sections are only needed when touching platform-specific code or editing changelogs.

---

## Critical Rules

The rules whose violation does the most damage across the workspace. Each line states the rule and links to the document that owns it; the owning document carries the detail and the exceptions.

- Treat the manifests as authoritative: when code contradicts a manifest, flag the code and do not rewrite the manifest to fit it. Missing manifest facts are flagged, never invented. See the root `AGENTS.md`, *Failure Protocol & Decision Matrix*.
- Never edit generated output. Change its source and regenerate. See [generated-artefacts.md](generated-artefacts.md#tracked-generated-artefacts) and, for persona output, the personas [Source Editing Rules](../../../personas/docs/agents/project-manifest/constraints.md#source-editing-rules).
- Classify a modified tracked file against [generated-artefacts.md](generated-artefacts.md) before discarding it, and never revert a hand-maintained neighbour as build noise. See [Hand-maintained Neighbours](generated-artefacts.md#hand-maintained-neighbours).
- Update every counterpart of a cross-system sync point in the same change, and run the checks that go with it. This covers agent role names and `personas/name-mapping.json` as well. See the [Dependency Table](cross-system-dependencies.md#dependency-table) and [Validation Scripts](cross-system-dependencies.md#validation-scripts).
- Change workflow logic in the workflow specification first, then in code, then in tests, then in the manifest. See [The Workflow Specification Is the Source of Truth](../../../mcp-server/docs/agents/project-manifest/constraints.md#the-workflow-specification-is-the-source-of-truth-for-all-workflow-logic).
- Never write to `stdout` from the MCP server; logs go to `stderr`. See [STDIO Logging Discipline](../../../mcp-server/docs/agents/project-manifest/constraints.md#stdio-logging-discipline).
- Never open a second work-in-progress changelog entry, and never archive one. See [Changelog Rules](#changelog-rules), rule 9, and [Changelog Convention](#changelog-convention) before editing, releasing or archiving any changelog.
- Treat the published artifacts as downstream-consumed: keep project-specific content out of them, and flag a heading rename to the user instead of applying it. See [Published artifacts carry no project-specific content](../../../personas/docs/agents/project-manifest/constraints.md#c5d).
- Keep every script and test working on Windows, macOS and Linux. See [Cross-Platform Policy](#cross-platform-policy).
- Leave every git write operation to the Git Committer. See [Git Operations](#git-operations).
- Keep risky changes out of the live workspace. See [Live Workspace](#live-workspace).
- Verify a change with the checks that belong to its type. See [Verification by Change Type](development-commands.md#verification-by-change-type).

---

## Git Operations

Only the [Git Committer](../../../personas/standalone/src/content/git-committer.md) agent makes commits in this workspace. This is the owner's stated policy. The Git Committer persona is the authority for how it groups, messages and executes them, and for how generated artefacts are treated on a branch.

- Never perform a git write operation from any agent other than the Git Committer. That covers staging, committing, reverting, resetting, checking out a path, stashing and pushing.
- Never run `git add`, `git commit`, `git restore`, `git checkout -- <path>`, `git reset`, `git revert`, `git stash` or `git push` to tidy up after your own work, however small the change.
- Use read-only git commands (`status`, `diff`, `log`, `show`, `blame`, `ls-files`, `check-ignore`) to inspect state.
- Report the files you created or changed instead, so the user can hand them to the Git Committer.
- When the work needs a discard, such as generator drift, name the file and its verdict from [generated-artefacts.md](generated-artefacts.md) and leave the revert to the Git Committer.

---

## Live Workspace

The workspace that hosts the installed Ledger MCP server also hosts the agentic workflow that depends on it. [live-workspace.md](live-workspace.md) lists what feeds the running server and what can break it; the owner uses a dedicated DEV workspace for bigger projects.

- Defer a large or risky change to a dedicated DEV workspace and tell the user, instead of making it in the workspace that hosts the running server.
- Run a GUI on a development checkout with `--port 3460`, never on 3420.
- Construct test stores on a temporary directory, never on `mcp-server/storage/ledger/`. See [constraints-testing.md](../../../mcp-server/docs/agents/project-manifest/constraints-testing.md).

---

## Cross-Platform Policy

**Supported platforms:** Windows, macOS, and Linux. All sub-projects (MCP server, orchestrator, personas build system, root-level scripts) must work correctly on all three.

### Platform Rules

1. **No OS-specific APIs without a cross-platform fallback.** When platform-specific code is unavoidable (e.g., file locking), provide per-platform implementations gated by runtime detection (`process.platform` / `sys.platform`) and document the invariants for each OS. Prefer stdlib-only solutions over third-party wrappers when the stdlib covers all three targets.
2. **Use framework path utilities — never hardcode separators.** Use `path.join()` / `path.resolve()` (Node.js) and `pathlib.Path` / `os.path.join()` (Python). Never assume `/` or `\` as a path separator in string literals.
3. **Shell commands must be cross-platform.** Root-level `scripts/` run on Node.js and must not rely on Unix-only utilities (e.g., `grep`, `sed`). Use Node.js built-in APIs or npm packages instead. When a script delegates to a shell, document any OS-specific invocation difference (e.g., venv activation).
4. **File locking must work on all platforms.** The MCP server uses `proper-lockfile` (cross-platform). The orchestrator uses `src/utils/filelock.py` (`msvcrt` on Windows, `fcntl` on Unix). Any new locking mechanism must support all three OSs.
5. **Tests must be platform-agnostic.** Avoid hardcoded Unix paths (`/tmp/…`) in test fixtures. Use the language's temp-directory API (`os.tmpdir()` / `tempfile.mkdtemp()`). Do not assert path separators — compare via `path.resolve()` or `pathlib` equivalents.
6. **Line endings:** Rely on Git's `core.autocrlf` / `.gitattributes` for normalization. Never assume `\n` when reading user-edited files; use language-level line-splitting APIs.

### Existing Cross-Platform Implementations

| Component | Mechanism | Reference |
|-----------|-----------|----------|
| MCP server file locking | `proper-lockfile` (npm) | `mcp-server/src/storage/file-lock.ts` |
| Orchestrator file locking | `msvcrt` (Win) / `fcntl` (Unix) | `orchestrator/src/utils/filelock.py` |
| Root scripts | Node.js `fs`, `path`, `child_process` — no Unix shell deps | `scripts/` |
| Personas build | Node.js CJS — inherently cross-platform | `scripts/build-personas.js` |

> **Rationale:** The MCP server runs alongside the user's IDE on their desktop OS. The orchestrator is a developer tool that must work on contributor machines across all major platforms. Failing on any OS is a shipping bug.

---

## Changelog Convention

This workspace uses a **hub-and-spoke changelog model**: each sub-project maintains its own detailed changelog, and the root changelog aggregates the highlights into versioned releases.

### File Locations

| File | Scope | Versioning |
|------|-------|------------|
| `changelog.md` (root) | Workspace-wide release summary | SemVer, tagged in Git (`v1.9.0`, …) |
| `mcp-server/changelog.md` | MCP server changes only | Own SemVer (`v1.14.0`, …), **not** Git-tagged |
| `orchestrator/changelog.md` | Orchestrator changes only | Own SemVer (`v0.5.0`, …), **not** Git-tagged |
| `personas/changelog.md` | Summary of the most relevant persona and build-system changes; individual persona changes are tracked in each persona's integrated changelog | Own SemVer (`v3.9.1`, …), **not** Git-tagged |

### Changelog Rules

1. **Only the root changelog triggers Git tags/releases.** Module changelogs track internal history but have no corresponding Git tags.
2. **Module changelogs come first.** When preparing a release, update each affected module changelog before writing the root entry.
3. **Root entries reference module versions.** Use the blockquote line format to link back: `> mcp v1.14.0 · personas v3.9.1 · orchestrator v0.4.0`. Omit modules that had no changes.
4. **Root entries summarize, not duplicate.** Each root bullet condenses multiple module-level bullets into one outcome-oriented line. Implementation detail stays in the module changelog.
5. **House style applies everywhere.** All changelogs follow the Changelog Curator's house style: flat bullet list with category prefixes, no `### Added/Changed/Fixed` sub-headers, ≤ 100-char lines.
6. **Version bumps:** Root version follows SemVer based on the most significant change across all modules. Module versions are incremented independently.
7. **`scripts/extract-changelog-entry.js`** parses the topmost root changelog entry for CI/GitHub Actions release automation.
8. **Personas changelog is summary-only:** Since each persona has an integrated changelog, `personas/changelog.md` entries summarize outcomes only — rationale, implementation mechanism, and file-level detail belong exclusively in that persona's own YAML `changelog` field, never here.
   - **Guardrail:** cap each release entry at roughly one bullet per affected persona or per cross-cutting theme (shared partials, build tooling, docs). Needing 5+ individual per-persona bullets under one theme is a sign to group them into a single thematic bullet instead.
   - **Anti-pattern** (rationale-laden, restates mechanism — do not write this): *"Standalone: Redesigned the Persona Curator to fix a tone violation in its Core Philosophy section, converting three imperative-mood principles to indicative mood and adding a Philosophy Tone Pass step to its own validation workflow so it can catch the same issue in personas it audits going forward."*
   - **Good pattern** (outcome-only, one line — write this instead): *"Standalone: Persona Curator gained a Philosophy Tone Pass and accepted-deviation reporting."*
   - This duplication risk is specific to `personas/changelog.md`, since personas carry their own integrated changelogs to defer detail to. `mcp-server/changelog.md` and `orchestrator/changelog.md` have no equivalent per-item changelog — rule 5's single-line house style is the existing safeguard there.
   - `scripts/build-personas.js` now warns (never fails) when the newest entry exceeds mechanical line/bullet/sentence-per-bullet/line-length thresholds, via `scripts/lib/changelog-size-check.js`.

9. **One work-in-progress entry, never archived.** A changelog's topmost version heading reads `## v{VERSION} - **WIP; UNRELEASED**` while the version is unreleased. New changes go into that entry; never open a second one. Where the topmost entry is not marked, the next version is the last released version plus the bump the change needs, found from the last release tag (`git describe --tags --abbrev=0`) and the changelog as it stood there. Keep package version fields at the WIP version and never lower it. The marker comes off only when the Changelog Curator finalizes the entry for release, and archiving never moves a WIP entry. The authority is the [WIP Changelog Version](../../../personas/shared/partials/wip-changelog-version.md) partial, which the Changelog Curator persona includes.

### Archive Locations

Older releases are moved out of each changelog by the Changelog Curator's **Archive** mode. All four changelogs share one central archive folder, with a sub-folder per changelog and the standard layout `v{MAJOR}/v{MAJOR}.{MINOR}.md` inside it.

| Changelog | Archive folder | Footer link base (relative to the changelog) |
|-----------|----------------|----------------------------------------------|
| `changelog.md` (root) | `docs/changelog-history/root/` | `docs/changelog-history/root` |
| `mcp-server/changelog.md` | `docs/changelog-history/mcp-server/` | `../docs/changelog-history/mcp-server` |
| `orchestrator/changelog.md` | `docs/changelog-history/orchestrator/` | `../docs/changelog-history/orchestrator` |
| `personas/changelog.md` | `docs/changelog-history/personas/` | `../docs/changelog-history/personas` |

- **Separate sessions.** Archiving never happens during release preparation; run the [archive prompt](../../../.github/prompts/changelog-archive.prompt.md) as its own session, one changelog at a time.
- **Verbatim moves.** Archived releases are copied unchanged; wording problems are handled in a separate Rewrite session.
- **Align the cut.** Module cuts should land near the root cut, using the module versions in the root entries' blockquote lines as the guide, so the live files tell the same period.
- **Footer stays last.** The archive footer is the last block of each changelog. `scripts/extract-changelog-entry.js` and the personas build only read the topmost entry, so the footer does not affect them.

### Two-Step Workflow

```
Step 1 — Module changelogs
    For each module with changes since the last Git tag:
      → Run git log / diff for that module's directory
      → Add a new entry to {module}/changelog.md

Step 2 — Root changelog
    → Read the new module entries
    → Write a single new root entry summarizing the highlights
    → Assign the next SemVer version
```

### Prompt Template

See the [Changelog Workflow](../../references/development.md#changelog-workflow) section of the Developer Guide for the copy-paste prompt template.
