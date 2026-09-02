# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the Manifest Curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| — | — | None settled with the user yet. |

## History

### 2026-09-02 · Update · Curator v1.4.1

**Scope:** All 14 discrepancies from the 2026-09-02 audit — `README.md`, `tech-stack.md`, `api-surface.md`, `file-tree.md`, `constraints-build-system.md`, `variables.md`. `data-flows.md`, `constraints.md`, and `constraints-cross-system.md` needed no changes (audit found none).
**Changes:**
- `README.md` — rewrote Overview and Quick Reference to describe all three suites (ledger, standalone, ledger-support) and all three targets (vscode, claude-code, deep-agents); removed the hand-maintained Version/Last Updated header; added a Curation Log row to the Manifest Sections table.
- `tech-stack.md` — moved `@mistralys/persona-builder` into the Production table (it is a `personas/package.json` dependency, not a workspace-root devDependency) and corrected its version to `^2.6.0`.
- `api-surface.md` — fixed the Planner's `has_mcp` flag (was `—`, is `✓`); corrected the `FRONTMATTER_STANDALONE_VSCODE` template (`name` now shows `v{{version}}` appended, `last_updated` now shows its `{{#if}}` guard) and the matching Metadata Field Map row; added a Key Derivation Rules bullet documenting the `name`/`version` composition.
- `file-tree.md` — full rewrite of the `personas/` tree: added the `ledger-support/` suite, `model-registry/`, `name-mapping.json`, all three suites' `deep-agents/` output dirs, `docs/audits/` and the other `docs/*.md` files, `variables.md` and `curation-log.md` in the manifest's own doc list, and `handoff-block-manual.md`; replaced the entirely-wrong `shared/partials/` listing with the real 22-file set; added a header note pointing to `.context/personas/file-structure.md` as the drift-proof source for pure structure.
- `constraints-build-system.md` — rewrote item 2: nested `{{#if}}` inside an `{{else}}` branch (and `{{else if}}` chains) are supported and required for three-target content; only nesting inside a truthy branch with no `{{else}}` is unsupported. Marked item 10's version-lag callout resolved now that `personas/package.json` pins `^2.6.0`.
- `variables.md` — corrected the `{{name}}` (standalone) example to the plain form, noting the template appends the version.

**Notes:** Per the prior audit's recommendation, `file-tree.md` and `README.md` were rewritten wholesale rather than patched piecemeal. `personas/README.md`'s stale `--suite` flag reference was left untouched — it is a sibling doc, not this manifest, and was routed to Documentation (Standalone) in the audit report rather than corrected here.

### 2026-09-02 · Audit · Curator v1.4.1

**Scope:** Whole manifest — `README.md`, `tech-stack.md`, `api-surface.md`, `data-flows.md`, `file-tree.md`, `constraints.md`, `constraints-build-system.md`, `constraints-cross-system.md`, `variables.md`.
**Changes:** None — audit only. This is the manifest's first recorded curation pass; no prior log existed.
**Findings:** 6 high, 6 medium, 2 low. See [audit-report-2026-09-02.md](audit-report-2026-09-02.md). Highlights: `README.md`/`file-tree.md` still describe a two-suite, two-target system (the codebase now has three of each); `constraints-build-system.md` item 2 claims nested `{{#if}}` is unsupported, contradicted by the live engine and by three other documents in this same manifest.
