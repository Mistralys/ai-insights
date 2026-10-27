---
agent: Changelog Curator v1.5.0
description: Archive older releases from the workspace changelogs into docs/changelog-history/.
---

Run the Changelog Curator in **Archive** mode on the changelog(s) named in the request — by default all four: `changelog.md` (root), `mcp-server/changelog.md`, `orchestrator/changelog.md` and `personas/changelog.md`. Handle one changelog at a time, root first, and present each cut plan for approval before writing anything.

## Archive Location

Archives live in a central folder, one sub-folder per changelog (see *Archive Locations* in AGENTS.md → Changelog Convention):

| Changelog | Archive folder | Footer link base |
|---|---|---|
| `changelog.md` | `docs/changelog-history/root/` | `docs/changelog-history/root` |
| `mcp-server/changelog.md` | `docs/changelog-history/mcp-server/` | `../docs/changelog-history/mcp-server` |
| `orchestrator/changelog.md` | `docs/changelog-history/orchestrator/` | `../docs/changelog-history/orchestrator` |
| `personas/changelog.md` | `docs/changelog-history/personas/` | `../docs/changelog-history/personas` |

Layout inside each folder: `v{MAJOR}/v{MAJOR}.{MINOR}.md`, releases newest first. Footer links are relative to the changelog file.

## Workspace Rules

- **Older majors leave first.** For the orchestrator, `v0.x` counts as an older major than `v1.x`.
- **Align the cut across changelogs.** Settle the root cut first, then use the module versions in the root entries' blockquote lines (`> mcp v… · personas v…`) to land each module cut near the same point in time. Fewer or more than ten releases may stay when the alignment or a continuous story calls for it.
- **Verbatim only.** Do not rewrite wording during archiving; report house-style issues as candidates for a Rewrite session.
- **Topmost root entry stays untouched.** `scripts/extract-changelog-entry.js` parses it for releases, and the archive footer stays the last block of the file.
- **No companion release notes.** This workspace has no `WHATSNEW.xml`; report that and skip the companion check.
- **Verify afterwards.** Run `node scripts/check-version-sync.js` and confirm the extraction script still returns the topmost root entry.
