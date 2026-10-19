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

**Scope:** Partial upgrade, addition only: new `generated-artefacts.md`, its row in the `README.md` Manifest Sections table, and a matching Generated Artefacts section appended to `constraints.md`. No other document or section was reconciled or verified.
**Commit:** 1ced4e17
**Changes:**
- Created `generated-artefacts.md` for this module, cross-linking the hub's document instead of repeating repo-wide rows. Rows checked against `mcp-server/package.json` scripts, `scripts/sync-version.js`, `vitest.config.ts`, `tsconfig.json`, the root `.gitignore`, and `git ls-files`.
- Settled the hub's open question: `npm run test:coverage` does write `mcp-server/coverage/`. `vitest.config.ts` has no `coverage` block, so Vitest's default reporters and directory apply, which match the tracked files. The tracked copy was last committed 2026-04-11 while `src/` has changed since, so it is a stale one-off snapshot; nothing references it. Whether it should stay tracked is unasked, so the row says ask the user before wholesale deletion or commit.
- `constraints.md` gained a Generated Artefacts section; `README.md` gained an index row.

**Notes:** The reverted-decision search and changed-code intersection were not run (partial pass by instruction). Observed but untouched: `README.md` Development Commands omits `test:coverage`, `build`, `gui` and the `check:roles` script; the `README.md` still contains the section list without the `constraints-*` files in its main table (as logged earlier). The working tree state was not inspected beyond the paths above. `.context/mcp-server/manifest-readme.md`, `manifest-constraints.md` need `node scripts/cli.js ctx-generate`. The adjacent-document check was out of scope for this dispatch.

### 2026-10-06 · Update · Curator v1.6.2

**Scope:** `constraints-workflow.md` (Pipelines section; the FAIL bullet of "Handoff Notes Are Routed via `resolveNextAgent` / `resolveFailAgent`") and `data-flows.md` (Flows 4 and 5). Driven by integrating the durable findings of the retired plan `2026-10-01-verifier-only-rework-routing` — not a whole-manifest pass; every other document and section was left unverified.
**Commit:** c8523c00
**Changes:**
- `constraints-workflow.md` — added "Pipelines Can Only Be Started for an Active Stage" (the step-2b / Guard-2b check in `startPipeline` and `beginWork`, plus the existing `auto_cancelled` divergence between the two copies of the start-guard chain); added "A Chain With a Verifier Stage Must Include `implementation`", carrying the decision record (verifier-only chains are a decomposition defect, origin incident, rejected out-of-chain rework design); added the missing custom-composition soft warning to the `active_pipeline_stages` validation entry; cross-linked the `resolveFailAgent` fallback to the new entry.
- `data-flows.md` — Flow 4 gained the active-stage guard (step 1b); Flow 5's FAIL fallback note now states that the fallback can route to the failing verifier.

**Notes:** The working tree held uncommitted changes when scanned — the commit above is the last one. The reverted-decision search and changed-code intersection were not run (scoped pass). The workflow specification was deliberately not edited: a pending ledger plan owns the spec changes, including the planned creation-time rejection of verifier-only chains (plan `2026-10-06-p02-unfixable-verifier-chain-validation`), which the new constraint describes as not yet implemented and which must be updated when it lands. Planning-persona changes for the same decision are also pending (plan `2026-10-06-p01-verifier-chain-prevention-personas`). `.context/mcp-server/manifest-constraints.md` and `manifest-data-flows.md` need `node scripts/cli.js ctx-generate`.

### 2026-09-23 · Update · Curator v1.4.1

**Scope:** `api-surface.md` (the `ledger_update_synthesis` entry only), `data-flows.md` (Flow 17), and `README.md` (header fields). Driven by the relaxed runner guard on `ledger_update_synthesis` — not a whole-manifest pass; every other document and every other section of the two touched documents was left unverified.
**Commit:** d5a1062a
**Changes:**
- `api-surface.md` — reworked the hand-edited `ledger_update_synthesis` lead paragraph to the house shape (purpose only, mechanics in the labelled blocks beneath), dropped the runner enumeration in favour of "regardless of its `runner`", moved the never-writes-`runner` fact into **Storage writes:**, and removed "standalone" from the two argument comments.
- `data-flows.md` — retitled Flow 17 to cover both tools and Flow 17b to a tracked project rather than a standalone one; rewrote 17b's guard block against the handler (`ledgerDirExists`, `COMPLETE`, staleness, `synthesis.md` presence — the documented `synthesis_generated !== true` guard and the `synthesis_generated: true` write never existed there) and added a Key Property contrasting the two handlers' runner behaviour.
- `README.md` — removed the `**Version:**` and `**Last Updated:**` header fields (both long stale; the body already cites a much later server version) and added the Curation Log row to Manifest Sections.

**Notes:** This manifest had no curation log; the file was created by this pass, so the trail starts here and says nothing about how the documents were maintained before today. The working tree held uncommitted changes when scanned — the commit above is the last one, and the change under documentation was among the uncommitted work. The reverted-decision search and changed-code intersection were not run: the pass was scoped to one behaviour change by the requesting agent, and with no previous entry there is no floor commit to open a range from. A full pass should run both. `README.md`'s Manifest Sections table does not list the `constraints-*` documents in its main table (they have their own section below it) — left as found.
