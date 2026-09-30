# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-09-23 · Update · Curator v1.4.1

**Scope:** `api-surface.md` (the `ledger_update_synthesis` entry only), `data-flows.md` (Flow 17), and `README.md` (header fields). Driven by the relaxed runner guard on `ledger_update_synthesis` — not a whole-manifest pass; every other document and every other section of the two touched documents was left unverified.
**Commit:** d5a1062a
**Changes:**
- `api-surface.md` — reworked the hand-edited `ledger_update_synthesis` lead paragraph to the house shape (purpose only, mechanics in the labelled blocks beneath), dropped the runner enumeration in favour of "regardless of its `runner`", moved the never-writes-`runner` fact into **Storage writes:**, and removed "standalone" from the two argument comments.
- `data-flows.md` — retitled Flow 17 to cover both tools and Flow 17b to a tracked project rather than a standalone one; rewrote 17b's guard block against the handler (`ledgerDirExists`, `COMPLETE`, staleness, `synthesis.md` presence — the documented `synthesis_generated !== true` guard and the `synthesis_generated: true` write never existed there) and added a Key Property contrasting the two handlers' runner behaviour.
- `README.md` — removed the `**Version:**` and `**Last Updated:**` header fields (both long stale; the body already cites a much later server version) and added the Curation Log row to Manifest Sections.

**Notes:** This manifest had no curation log; the file was created by this pass, so the trail starts here and says nothing about how the documents were maintained before today. The working tree held uncommitted changes when scanned — the commit above is the last one, and the change under documentation was among the uncommitted work. The reverted-decision search and changed-code intersection were not run: the pass was scoped to one behaviour change by the requesting agent, and with no previous entry there is no floor commit to open a range from. A full pass should run both. `README.md`'s Manifest Sections table does not list the `constraints-*` documents in its main table (they have their own section below it) — left as found.
