# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-10-06 · Update · Curator v1.6.2

**Scope:** `../../supervisor-routing.md` (Special Exits note, Circuit-Breaker section), `../../../README.md` (Exit codes), `decisions.md` (new entry), and the `README.md` index. Driven by integrating the durable findings of the retired plan `2026-10-01-verifier-only-rework-routing` — not a whole-manifest pass; every other document was left unverified.
**Commit:** c8523c00
**Changes:**
- `supervisor-routing.md` — documented the all-terminal synthesis predicate as the supervisor's own copy of the ledger's synthesis guard (a `BLOCKED` WP never satisfies it), what counts as a failure for the circuit breaker (`stage_success` is `False` on any stage exception, including one after a `ledger_complete_pipeline` write), and the halted-WP cancellation sweep on the all-roles-WAIT fall-through.
- `README.md` (orchestrator root) — added a note under Exit codes: the code derives from the error count and iteration limit only, not from WP outcomes.
- `decisions.md` — added "Not Adopted: Settled-but-Not-Terminal WPs at Synthesis", recording the orchestrator half of the rejected out-of-chain rework design.
- `README.md` (manifest index) — added rows for `decisions.md`, which was unlinked, and for this log.

**Notes:** This manifest had no curation log; the file was created by this pass, so the trail says nothing about earlier maintenance. The working tree held uncommitted changes when scanned — the commit above is the last one. The reverted-decision search and changed-code intersection were not run (scoped pass, no floor commit); a full pass should run both. `.context/orchestrator/` is generated from these files and needs `node scripts/cli.js ctx-generate`.
