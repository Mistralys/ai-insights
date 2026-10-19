# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-10-19 · Update · Curator v1.6.2

**Scope:** Partial upgrade, addition only: created this `curation-log.md` and linked it from the `README.md` index. No manifest document was reconciled, and no document was verified as accurate. The staleness spot-check below was a sampling, not a verification pass.
**Commit:** 1ced4e17
**Changes:** Created `curation-log.md` (first entry for this manifest) and added a row for it to the `README.md` Manifest Index. No Version, Last Updated, or changelog fields were found in the manifest documents.
**Notes:** The reverted-decision search, changed-code intersection, and adjacent-document check were not run (partial pass by instruction). The manifest directory is not under a commit of its own in this log's history, so the floor for the next pass is the commit above. The working tree held uncommitted changes elsewhere in the repository (other manifests) but none under `mcp-server/gui/` at scan time.

Observed but untouched drift, found by a spot-check of the manifest against the code. A later full refresh should address it:
- `file-tree.md` lists `public/views/insights.js`, which does not exist on disk.
- `file-tree.md` omits files that exist: `api-repos.ts` (documented in `constraints.md` but absent from the tree), `public/modal.js`, `public/views/strategy.js`, and `public/views/project-detail-dialogues.js`. The last is mentioned in `constraints.md` and `ui-components.md` only.
- `strategy.js` appears in no manifest document, so the Strategy view is undocumented.
- `file-tree.md` carries line counts and an approximate file-size table (for example for `server.ts`, `styles.css`), which go stale on every commit and which the current curation rules exclude. It also has a run-together line in the `public/` tree where `components.js` and `theme.js` entries are merged onto the `utils.js` line.
- The manifest has seen many commits to `server.ts`, `api.ts`, `project-detail.js`, `styles.css`, and `api-client.js` since 2026-06-08, none of whose diffs were read, so `api-surface.md`, `data-flows.md`, and `ui-components.md` should be treated as unverified.
- Stated facts that did check out: the default port 3420 in `README.md` and the existence of `buildRoutes` in `server.ts`.

Generated artefacts: no tracked generated output found under `mcp-server/gui/`, so no `generated-artefacts.md` is warranted for this manifest. Repo-wide generated files are covered by the hub and `mcp-server` documents.
