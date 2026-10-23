# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-10-23 · Update · Curator v1.8.0

**Scope:** Narrow, by instruction: the module's generated-artefacts document and the links to it. Not a full reconcile.
**Commit:** 2d4220a3 (working tree held uncommitted changes)
**Changes:** Deleted this manifest's `generated-artefacts.md`; its rows (including all run-state rows and the `requirements.txt` neighbour) were merged into the hub's `docs/agents/project-manifest/generated-artefacts.md` (Source `Orchestrator`). Repointed the `README.md` index row and the `constraints.md` → Generated Artefacts preamble and first bullet to the hub file.
**Notes:** Two `TODO: verify` markers carried over to the hub row for `orchestrator/requirements.txt` and the `pytest` command row. The reverted-decision search, changed-code intersection and adjacent-document check were not run, by the brief's scope. History entries below name `generated-artefacts.md` as a document of this directory as it stood when written; it now lives in the hub.

### 2026-10-19 · Update · Curator v1.8.0

**Scope:** One link in `constraints.md` (storage layout section). Not a full reconcile.
**Commit:** 1ced4e17
**Changes:** The pointer to the root `AGENTS.md` "Storage layout version" row now targets the hub's `cross-system-dependencies.md`, where that row moved. The target file and anchor exist on disk.

### 2026-10-19 · Update · Curator v1.6.2

**Scope:** Partial upgrade, addition only: new `generated-artefacts.md`, its row in the `README.md` Manifest Sections table, a Generated Artefacts section appended to `constraints.md` (plus its Contents link). No other document or section was reconciled or verified.
**Commit:** 1ced4e17
**Changes:**
- Created `generated-artefacts.md`, cross-linking the hub document instead of repeating repo-wide rows. Rows checked against `src/cli.py`, `src/graph.py`, `src/config.py`, `src/utils/{logging,run_queue,chunk_writer,dialogue_writer}.py`, `scripts/cli.js` (version sync into `pyproject.toml`), `module-context.yaml`, the root and module `.gitignore` files, and `git ls-files`. Tracked generated files are `.context/orchestrator/**` and the `pyproject.toml` version field; run state (checkpoints, logs, queue, `.orchestrator-run.json`, ledger-storage chunks and dialogues) is ignored.
- `constraints.md` gained a Generated Artefacts section; `README.md` gained an index row.

**Notes:** The reverted-decision search and changed-code intersection were not run (partial pass by instruction). The working tree held uncommitted changes elsewhere in the repository; the commit above is the last one. Two rows carry `TODO: verify` comments: the origin of `requirements.txt` (no writing script found) and whether tests isolate themselves from the real `logs/` and `checkpoints/`. Observed but untouched: `README.md` index still states a test count and constraint count (stale-prone) and its inline file tree omits `decisions.md`, `curation-log.md` and newer `src/utils/` modules; `constraints.md` lines near 454 still cite root `AGENTS.md` -> Cross-System Dependencies "Storage layout version" row, which exists in the root `AGENTS.md` today (open Amend-plan item, left as is). `.context/orchestrator/manifest.md` needs `node scripts/cli.js ctx-generate`. The adjacent-document check was out of scope for this dispatch.

### 2026-10-06 · Update · Curator v1.6.2

**Scope:** `../../supervisor-routing.md` (Special Exits note, Circuit-Breaker section), `../../../README.md` (Exit codes), `decisions.md` (new entry), and the `README.md` index. Driven by integrating the durable findings of the retired plan `2026-10-01-verifier-only-rework-routing` — not a whole-manifest pass; every other document was left unverified.
**Commit:** c8523c00
**Changes:**
- `supervisor-routing.md` — documented the all-terminal synthesis predicate as the supervisor's own copy of the ledger's synthesis guard (a `BLOCKED` WP never satisfies it), what counts as a failure for the circuit breaker (`stage_success` is `False` on any stage exception, including one after a `ledger_complete_pipeline` write), and the halted-WP cancellation sweep on the all-roles-WAIT fall-through.
- `README.md` (orchestrator root) — added a note under Exit codes: the code derives from the error count and iteration limit only, not from WP outcomes.
- `decisions.md` — added "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis", recording the orchestrator half of the rejected out-of-chain rework design.
- `README.md` (manifest index) — added rows for `decisions.md`, which was unlinked, and for this log.

**Notes:** This manifest had no curation log; the file was created by this pass, so the trail says nothing about earlier maintenance. The working tree held uncommitted changes when scanned — the commit above is the last one. The reverted-decision search and changed-code intersection were not run (scoped pass, no floor commit); a full pass should run both. `.context/orchestrator/` is generated from these files and needs `node scripts/cli.js ctx-generate`.
