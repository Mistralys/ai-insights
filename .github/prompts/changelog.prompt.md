---
agent: Changelog Curator v1.1.1
description: Generate changelog entries for all changes since the last Git tag.
---

Generate changelog entries for all changes since the last git tag. Update each module changelog (`mcp-server/changelog.md`, `orchestrator/changelog.md`, `personas/changelog.md`) first, then add a new version entry in the root `changelog.md` summarizing the module changes. Follow the house style and the changelog convention documented in AGENTS.md.

## Version Tag Baseline

The project uses **unscoped version tags** (e.g. `1.13.0`) for its releases. Determine the last tagged version by running `git tag --sort=-v:refname | head -1`, then review the commit history from that tag to HEAD (`git log <tag>..HEAD --oneline`) to collect all changes. Focus on user- and developer-visible changes; omit CI-only, formatting-only, or trivial commits.

## Consolidate Interim Versions

Agents working on the codebase often append new version headings to module changelogs as they make changes. When generating a release changelog, **consolidate all interim version entries** added after the last Git tag into a single new version that represents the next logical SemVer bump. Do not preserve the intermediate version numbers — merge their bullets into one cohesive entry per module.

## Submodule Version Baseline

Each root changelog entry lists the submodule versions released alongside it (e.g. `> mcp v2.0.0 · orchestrator v1.0.0 · personas v3.22.0`). A submodule that is not listed had no changes in that release. Use the submodule versions from the **last tagged root release** as the baseline for each module — any version headings added to a module changelog after its baseline version are interim entries that must be consolidated into the next logical SemVer bump for that module. If a module has zero commits since its baseline, skip its changelog update and omit it from the root blockquote.

## SemVer Bump Rules

- **Patch:** Bug fixes, doc improvements, test additions only.
- **Minor:** New features, new tools, new CLI commands, behavioral changes.
- **Major:** Breaking changes to public API, data format, or tool signatures.

The root version bump is determined by the most significant change across all modules.

## House Style Reminders

- **Heading format:** `## vX.Y.Z - Short Descriptive Title` (derive a concise title from the dominant theme).
- **Bullet format:** Flat list with category prefixes (e.g. `MCP:`, `Orchestrator:`, `GUI:`, `Scripts:`, `Personas:`). No `### Added/Changed/Fixed` sub-headers.
- **Line length:** ≤ 100 characters per line.
- **Root bullets summarize** — one outcome-oriented line per module-level group. Implementation detail stays in the module changelog.
- **Personas changelog is summary-only** — each persona has an integrated changelog, so `personas/changelog.md` should contain only the most relevant highlights per release, not a per-persona itemization.
- The topmost root entry is machine-parsed by `scripts/extract-changelog-entry.js` for CI/GitHub releases — keep the heading format exact.
