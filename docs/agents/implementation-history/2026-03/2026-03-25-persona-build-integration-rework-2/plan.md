# Plan

## Summary

Address six actionable items surfaced by the `2026-03-25-persona-build-integration-rework-1` synthesis. Three are documentation additions in the `ai-persona-builder-STABLE` library (composite cache key fallback convention, named re-export convention, utility module structure convention). Three are improvements in `ai-insights-dev` (inline `--dry-run` alias comment, and artifact declaration instructions added to the Reviewer and Documentation persona partials to close the recurring traceability gap).

## Architectural Context

**Library (`ai-persona-builder-STABLE`):**
- `docs/plugins.md` — user-facing plugin authoring guide. Contains the `PersonaBuildPlugin` interface, hook documentation, the ledger plugin reference, and the Validator Severity Escalation Pattern section. Currently missing guidance on the composite cache key `?? 'unknown'` fallback convention used in `onValidate`.
- `docs/agents/project-manifest/constraints.md` — architectural invariants, naming rules, and conventions. The "Module Structure" section (lines 55–63) documents barrel re-export patterns but does not yet document the named-export-over-glob convention established in `src/utils/index.ts`, nor the utility module structure pattern.

**Consumer (`ai-insights-dev`):**
- `scripts/build-personas.js` — thin wrapper (53 lines) that delegates to the library CLI. Line 18 silently treats `--dry-run` as an alias for `--check` with no explanatory comment.
- `personas/shared/partials/reviewer-operational-protocol.md` — Reviewer agent instructions. Currently has no "Declare All Artifacts" constraint. The Developer partial (`developer-strict-constraints.md`) has this instruction, but the Reviewer and Documentation partials do not — causing recurring `artifacts.files_modified` warnings on code-review and documentation pipelines (6 instances in the last cycle alone, also reported in 3 prior synthesis documents).
- `personas/shared/partials/docs-operational-protocol.md` — Documentation agent instructions. Same gap as the Reviewer partial.

## Approach / Architecture

All changes are documentation-only additions. No runtime code changes. No API surface changes. No dependency additions.

1. **Library docs:** Add a targeted "Cache Key Conventions" subsection to the ledger plugin section of `docs/plugins.md`, documenting the composite key pattern and `?? 'unknown'` fallback. Add two new convention entries to `constraints.md` covering named re-exports and utility module structure.
2. **Consumer script:** Add a single-line comment to `scripts/build-personas.js` explaining the `--dry-run` alias.
3. **Persona partials:** Add a "Declare All Artifacts" bullet to the Reviewer and Documentation operational protocol partials, following the same phrasing established in `developer-strict-constraints.md`. Then rebuild generated persona output with `node scripts/build-personas.js`.

## Rationale

- The `?? 'unknown'` fallback is a non-obvious correctness pattern that future plugin authors could easily get wrong by using `||` or omitting the fallback entirely. Documenting it prevents silent cache key collisions.
- The named re-export and utility module conventions were established in the previous cycle (WP-003) but never codified. Without documentation, future contributors may introduce `export *` barrels in `src/utils/` or create utility files outside the established structure.
- The `--dry-run` alias is invisible to readers of the script. A one-line comment eliminates confusion.
- The artifact declaration gap is a systemic issue reported in 4 consecutive synthesis documents. Adding the instruction to the two affected persona partials is the most direct fix — it mirrors the existing Developer constraint and leverages the existing soft-warning infrastructure in the MCP server.

## Detailed Steps

### Step 1 — Add composite cache key fallback documentation (`ai-persona-builder-STABLE`)

In `docs/plugins.md`, after the Validator Severity Escalation Pattern section (after the second code block example ending around line 267), add a new subsection:

```markdown
### Cache Key Conventions for Multi-Target Builds

When a plugin caches per-persona state (e.g. rendered output) for use across
hooks, the cache key **must** include the build target to prevent collisions
in multi-target builds. Use the composite key pattern:

```ts
const cacheKey = `${persona.name}:${target}`;
```

In `onValidate`, the `target` parameter is optional (`target?: TargetType`).
When absent (e.g. in unit-test contexts where `onValidate` may be called
directly), fall back to a sentinel value using nullish coalescing:

```ts
const cacheKey = `${persona.name}:${target ?? 'unknown'}`;
const cached = renderedOutputCache.get(cacheKey) ?? '';
```

**Why `??` and not `||`?** Nullish coalescing (`??`) only triggers on
`null`/`undefined`, preserving any falsy-but-valid value. While `TargetType`
is currently always a non-empty string, the `??` pattern is semantically
correct and defensive against future type changes.
```

### Step 2 — Add named re-export and utility module conventions (`ai-persona-builder-STABLE`)

In `docs/agents/project-manifest/constraints.md`, expand the "Module Structure" section (currently 3 bullets ending at line ~63) by appending two new convention bullets:

- **Named re-export for utility barrels:** `src/utils/index.ts` uses explicit named re-exports (`export { escapeRegExp } from './regex.js'`) rather than `export *`. This prevents accidental public-surface leakage if internal helpers are later added to utility files. All future utility barrels must follow this pattern.
- **Utility module structure:** The `src/utils/` directory follows a one-file-per-domain pattern (e.g. `regex.ts` for regex utilities). Each file contains focused, pure functions. New utilities should create a new domain file rather than appending to an existing one, and the barrel (`index.ts`) must be updated with an explicit named re-export.

### Step 3 — Add `--dry-run` alias comment (`ai-insights-dev`)

In `scripts/build-personas.js`, add a comment above line 18 explaining the alias:

```js
// --dry-run is accepted as a convenience alias for --check (same behaviour)
const CHECK  = process.argv.includes('--check') || process.argv.includes('--dry-run');
```

### Step 4 — Add artifact declaration to Reviewer partial (`ai-insights-dev`)

In `personas/shared/partials/reviewer-operational-protocol.md`, add a bullet at the end of the "Tier 2 — Fix-Forward Rules" section (after the "Hard boundary" paragraph, before the "After applying each fix" paragraph):

```markdown
**Declare All Artifacts:** When calling `ledger_complete_pipeline`, declare ALL files you modified (including Fix-Forward edits) in `artifacts.files_modified`. Even if you made no changes, declare the files you actively reviewed. This maintains a complete audit trail.
```

### Step 5 — Add artifact declaration to Documentation partial (`ai-insights-dev`)

In `personas/shared/partials/docs-operational-protocol.md`, add a new numbered item (item 5) at the end:

```markdown
5. **Declare All Artifacts:** When calling `ledger_complete_pipeline`, declare ALL files you modified in `artifacts.files_modified` — include documentation files, READMEs, and any other files touched during this pipeline, even ancillary changes.
```

### Step 6 — Rebuild generated personas (`ai-insights-dev`)

Run `node scripts/build-personas.js` from the workspace root to regenerate all persona output files from the updated partials. Verify no unexpected changes with `node scripts/build-personas.js --check`.

---

## Implementation Summary

**Status:** Completed — 2026-03-26

All six steps were implemented as documentation-only changes with no runtime code modifications.

### Changes Made

**`ai-persona-builder-STABLE`:**
- `docs/plugins.md` — Added "Cache Key Conventions for Multi-Target Builds" subsection after the Validator Severity Escalation Pattern section. Documents the composite `${persona.name}:${target}` key pattern, the `?? 'unknown'` fallback for the optional `target` parameter in `onValidate`, and the rationale for `??` over `||`.
- `docs/agents/project-manifest/constraints.md` — Added two bullets to the "Module Structure" section: the named re-export convention for `src/utils/index.ts` (explicit `export { … }` instead of `export *`), and the one-file-per-domain utility module structure convention.

**`ai-insights-dev`:**
- `scripts/build-personas.js` — Added a one-line comment above the `CHECK` constant explaining that `--dry-run` is a convenience alias for `--check`.
- `personas/shared/partials/reviewer-operational-protocol.md` — Added **Declare All Artifacts** constraint to the Tier 2 Fix-Forward Rules section, mirroring the phrasing from `developer-strict-constraints.md`.
- `personas/shared/partials/docs-operational-protocol.md` — Added item 5 (**Declare All Artifacts**) to the Operational Protocol numbered list.
- Generated persona output rebuilt: `node scripts/build-personas.js` — 50 personas written. Stale check (`--check`) passed with exit 0.

### Notes

- The pre-existing `[WARN] Unresolved variable` messages during the build (`{{total}}`, `{{model}}`, `{{cc_name}}`, etc.) are unrelated to this work; they existed before these changes and do not affect correctness.
- No API surface changes, no dependency additions, no test changes required — all changes are strictly additive documentation.

### Step 7 — Update manifest documents

- Update `ai-persona-builder-STABLE/docs/agents/project-manifest/api-surface.md` if the new `docs/plugins.md` section introduces any new conceptual entries (likely not needed — this is advisory documentation, not API).
- Update `ai-insights-dev/personas/docs/agents/project-manifest/constraints.md` or `data-flows.md` if the persona partial changes affect documented conventions (likely minimal — the artifact declaration instruction is a process rule, not a build pipeline change).

## Dependencies

- Steps 1–2 are independent (library-only).
- Steps 3–5 are independent (consumer-only).
- Step 6 depends on steps 4–5 (persona rebuild after partial changes).
- Step 7 depends on all prior steps.

## Required Components

### Files modified — `ai-persona-builder-STABLE`
- `docs/plugins.md` — new "Cache Key Conventions" subsection
- `docs/agents/project-manifest/constraints.md` — two new bullets in "Module Structure"

### Files modified — `ai-insights-dev`
- `scripts/build-personas.js` — one comment line added
- `personas/shared/partials/reviewer-operational-protocol.md` — artifact declaration bullet
- `personas/shared/partials/docs-operational-protocol.md` — artifact declaration bullet
- `personas/ledger/vs-code/*.agent.md` — regenerated (via build script)
- `personas/ledger/claude-code/*.md` — regenerated (via build script)
- `personas/standalone/vs-code/*.agent.md` — regenerated (if partials are shared)
- `personas/standalone/claude-code/*.md` — regenerated (if partials are shared)

## Assumptions

- The Reviewer and Documentation persona content templates include their respective operational protocol partials (`{{> reviewer-operational-protocol}}` and `{{> docs-operational-protocol}}`), so changes to the partials will propagate to all generated output.
- The existing "Declare All Artifacts" phrasing in `developer-strict-constraints.md` is the established convention to follow.
- No version bump is needed for either project — these are documentation-only changes that don't affect runtime behavior.

## Constraints

- Never edit generated persona files directly (`personas/ledger/vs-code/`, `personas/ledger/claude-code/`, etc.) — always change source templates and rebuild.
- Library documentation must maintain the zero-dependency engine invariant awareness — the cache key convention section must not suggest patterns that violate engine purity.
- The `--dry-run` comment must be factual — `--dry-run` and `--check` produce identical behavior in this wrapper script.

## Out of Scope

- **`npm publish v1.0.1`** — manual operational step performed by the maintainer, not a code change.
- **Documentation freshness check pipeline** — process design that requires architectural discussion about adding a new pipeline stage or post-merge verification step. Deferred to a dedicated planning session.
- **`??` vs `||` pattern documentation beyond the inline comment** — the synthesis suggested documenting this as a general pattern for wrapper scripts, but there is no central "wrapper script conventions" document to house it. The inline usage in `scripts/build-personas.js` (already using `??`) and the `docs/plugins.md` note (Step 1) together provide sufficient coverage.

## Acceptance Criteria

- [ ] `docs/plugins.md` contains a "Cache Key Conventions for Multi-Target Builds" subsection with the composite key pattern and `?? 'unknown'` fallback guidance.
- [ ] `constraints.md` contains the named re-export convention bullet and utility module structure bullet in the "Module Structure" section.
- [ ] `scripts/build-personas.js` has a comment on or above line 18 explaining the `--dry-run` alias.
- [ ] `reviewer-operational-protocol.md` contains an artifact declaration instruction.
- [ ] `docs-operational-protocol.md` contains an artifact declaration instruction.
- [ ] `node scripts/build-personas.js --check` passes with no stale output detected.
- [ ] All 278 library tests pass (`npm test` in `ai-persona-builder-STABLE/`).

## Testing Strategy

- **Library tests:** Run `npm test` in `ai-persona-builder-STABLE/` — expect 278/278 pass. No new tests needed (documentation-only changes).
- **Persona build check:** Run `node scripts/build-personas.js --check` from `ai-insights-dev/` root — verifies generated output matches source templates after partial changes.
- **Manual review:** Inspect the regenerated Reviewer and Documentation persona files to confirm the artifact declaration instruction appears in the expected location.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Partial changes don't propagate to all personas** | Verify with `--check` flag after build. Inspect at least one generated Reviewer and one Documentation persona file. |
| **Cache key documentation is misread as mandatory for all plugins** | Frame the section clearly as applicable to "plugins that cache per-persona state across hooks" — not all plugins. |
| **Artifact declaration instruction is too aggressive for no-op pipelines** | Use the phrasing "even ancillary changes" rather than mandating declaration for zero-change pipelines. The MCP server's soft warning already handles the enforcement gracefully. |
