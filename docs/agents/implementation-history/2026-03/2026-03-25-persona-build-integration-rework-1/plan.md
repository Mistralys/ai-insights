# Plan — Persona Build Integration Post-Rework

## Summary

Address all strategic recommendations and remaining next steps from the
2026-03-25-persona-build-integration synthesis. The scope spans both the
**@mistralys/persona-builder** library (`ai-persona-builder-STABLE`) and
the **ai-insights** consumer workspace. Work covers seven areas: fixing
stale documentation, resolving the `TargetType` dual-export tech debt,
extracting a shared utility, fixing two bugs in the thin wrapper, cleaning
up empty directories, improving the `renderedOutputCache` keying, and
documenting the validator escalation pattern for future plugin authors.

## Architectural Context

Two repositories are in play:

- **`ai-persona-builder-STABLE/`** — the reusable library (v1.0.0, tagged
  `ae93c2b`). Layered architecture: `builders → plugins → engine / loaders /
  validators`. Published from `dist/` via `tsup` (dual CJS + ESM). The ledger
  plugin lives at `src/plugins/ledger/` with 4 modules + factory. Test suite:
  275 tests, 98.67% statement coverage.
- **`ai-insights-dev/`** — consumer workspace. `scripts/build-personas.js` is
  a 52-line thin wrapper that delegates to the library CLI.
  `personas/persona-build.config.js` wires the ledger plugin. Post-build
  step syncs `personas/package.json` version from `personas/changelog.md`.

Key files referenced throughout this plan:

| File | Workspace | Role |
|------|-----------|------|
| `src/plugins/ledger/index.ts` | library | Ledger plugin factory |
| `src/plugins/ledger/role-validator.ts` | library | `escapeRegExp`, `validateRole`, `validateNoteOnlyGuard` |
| `src/plugins/index.ts` | library | Barrel re-export (includes `TargetType`) |
| `src/builders/index.ts` | library | Barrel re-export (duplicate `TargetType`) |
| `src/builders/types.ts` | library | Re-export of `TargetType` from plugins |
| `src/plugins/types.ts` | library | Canonical `TargetType` definition |
| `docs/plugins.md` | library | Plugin documentation |
| `docs/agents/project-manifest/constraints.md` | library | Known limitations |
| `docs/agents/project-manifest/api-surface.md` | library | Public API reference |
| `scripts/build-personas.js` | ai-insights | Thin wrapper |
| `scripts/lib/` | ai-insights | Empty dir (to delete) |
| `scripts/tests/` | ai-insights | Empty dir (to delete) |

## Approach / Architecture

All changes are small, isolated fixes and documentation updates. No new
architecture or patterns. Work is organized into 8 steps, most of which
are independent.

Changes to the library will require a patch version bump (1.0.0 → 1.0.1)
with a changelog entry, since code changes are involved (the `TargetType`
re-export removal, the `escapeRegExp` extraction, and the cache keying
improvement). Documentation-only items do not need a version bump but are
included in the same release for convenience.

## Rationale

These are the synthesis-identified improvements that were deferred during
the main integration work. Addressing them now — before the library is
published to npm — avoids shipping known bugs and stale docs. The
`TargetType` dual re-export is explicitly flagged in `constraints.md` as
"resolve before 1.0", and the `warnOnUnknownRole` documentation is
actively misleading (it says "not yet wired" when the feature is working).

## Detailed Steps

### Step 1 — Fix `warnOnUnknownRole` documentation (library)

**Gold nugget 3 (synthesis) + next step #3.**

The `docs/plugins.md` file in the library contains a blockquote that reads:

> **Known limitation — `warnOnUnknownRole` is not yet wired.**

This is **no longer true** — the feature was implemented in WP-003 of the
integration plan. The escalation logic lives in
`src/plugins/ledger/index.ts` at the `onValidate` hook.

Actions:
- Remove the stale "Known limitation" blockquote from `docs/plugins.md`
  (around line 210).
- Replace the `warnOnUnknownRole` JSDoc description in the code block
  above it to accurately describe the escalation contract:
  - `true` (default): unknown role → `warning` severity.
  - `false`: unknown role → `error` severity (hard failure).
- Also update the JSDoc in `src/plugins/ledger/index.ts` for the
  `warnOnUnknownRole` field on the `LedgerPluginOptions` interface
  (~line 67) to match. Current JSDoc says "emits a warning-level
  `ValidationResult` instead of being silently skipped" — this doesn't
  explain the `false` → `error` escalation.
- Add a new subsection to `docs/plugins.md` titled
  **"Validator Severity Escalation Pattern"** (or equivalent) that
  documents the reusable pattern for future plugin authors: validators
  always return `warning`; the factory escalates to `error` based on
  options. This is the gold nugget #3 the user wants documented.

Files to edit:
- `docs/plugins.md` (library)
- `src/plugins/ledger/index.ts` (library — JSDoc only)

Manifest updates:
- `docs/agents/project-manifest/api-surface.md` — update the
  `LedgerPluginOptions.warnOnUnknownRole` description.

### Step 2 — Resolve `TargetType` dual re-export path (library)

**Next step #2 (before npm publish).**

`TargetType` is currently re-exported from two barrel files:
- `src/plugins/index.ts` (canonical path — keep)
- `src/builders/index.ts` via `src/builders/types.ts` (duplicate — remove)

Today this is harmless because `TargetType` is type-only, but a future
value export would cause a TypeScript error. The constraints manifest
(`constraints.md`) explicitly calls this out as tech debt.

Actions:
- Remove the `export type { TargetType } from '../plugins/types.js';`
  line from `src/builders/types.ts`.
- Remove the `export type { TargetType } from './types.js';` line from
  `src/builders/index.ts`.
- Verify the build compiles and all 275 tests pass.
- Remove the "TargetType Duplicate Re-Export Path" entry from
  `docs/agents/project-manifest/constraints.md` (Known Limitations §3).
- Note: consumers importing `TargetType` from the library's main entry
  point will still get it via `src/plugins/index.ts` → `src/index.ts`.
  Verify this path works.

Files to edit:
- `src/builders/types.ts` (library)
- `src/builders/index.ts` (library)
- `docs/agents/project-manifest/constraints.md` (library)

### Step 3 — Extract `escapeRegExp` to shared utility (library)

**Gold nugget 4 (synthesis) + next step #7.**

`escapeRegExp()` is a general-purpose function currently scoped as a
private function inside `src/plugins/ledger/role-validator.ts`. If future
validators or plugins need regex escaping, they'll duplicate it.

Actions:
- Create `src/utils/regex.ts` with the exported `escapeRegExp` function.
- Update `src/plugins/ledger/role-validator.ts` to import from
  `../../utils/regex.js`.
- Create `src/utils/index.ts` as a barrel file.
- Export `escapeRegExp` from the library's main `src/index.ts` barrel.
- Add `escapeRegExp` to `docs/agents/project-manifest/api-surface.md`.
- Add the `src/utils/` directory to
  `docs/agents/project-manifest/file-tree.md`.

Files to create:
- `src/utils/regex.ts` (library — new)
- `src/utils/index.ts` (library — new)

Files to edit:
- `src/plugins/ledger/role-validator.ts` (library)
- `src/index.ts` (library)
- `docs/agents/project-manifest/api-surface.md` (library)
- `docs/agents/project-manifest/file-tree.md` (library)

### Step 4 — Improve `renderedOutputCache` keying (library)

**Gold nugget 5 (synthesis) + next step #11 (future).**

The `renderedOutputCache` in the ledger plugin factory is keyed by
`persona.name` only. When both targets (`vscode`, `claude-code`) are
built for the same persona, the second `onPostRender` call overwrites
the first entry. The `note_only` guard in `onValidate` therefore always
runs against the last-rendered target.

**Investigation findings — hook signature mismatch:**

The `PersonaBuildPlugin` interface defines two different signatures:

- `onPostRender(output, persona, target)` — **receives `target`**
  (3rd parameter, type `TargetType`).
- `onValidate(persona, suite)` — **does NOT receive `target`**.

The runner functions mirror this: `runPostRender()` passes `target`
through from the builder; `runValidate()` does not accept or forward it.

In `buildPersona()` (`src/builders/persona-builder.ts`), `target` is in
scope at both call sites (lines ~290 and ~293), but only `runPostRender`
receives it. The build loop processes one target at a time: for each
persona, it runs the full pipeline
(`onBuildContext → render → onPostRender → onValidate → write`) before
moving to the next persona within the same target, then loops to the
next target. This means `onValidate` runs immediately after
`onPostRender` for the **same target**, so the `persona.name`-only
cache key is functionally correct today.

Additionally, the ledger plugin's `onPostRender` implementation omits
the `target` parameter entirely (only declares `output` and `persona`),
even though the interface provides it. This is valid TypeScript (unused
trailing parameters can be omitted) but means the plugin cannot use
`target` without updating its signature.

**Approach:** Two changes are needed:

1. **Add optional `target` parameter to `onValidate` hook** — extend
   the interface signature to
   `onValidate?(persona, suite, target?)`. This is non-breaking:
   existing plugins that don't declare the parameter are unaffected.
   Update `runValidate()` to accept and forward `target`. Update
   `buildPersona()` to pass `target` to `runValidate()`.

2. **Update the ledger plugin** — add `target` to both `onPostRender`
   and `onValidate` parameter lists. Change cache key to
   `${persona.name}:${target}` in `onPostRender`, and use the same
   composite key in `onValidate`'s cache lookup.

Actions:
- In `src/plugins/types.ts`: add optional `target?: TargetType`
  parameter to the `onValidate` hook signature.
- In `src/plugins/runner.ts`: update `runValidate()` to accept and
  forward `target` as an optional parameter.
- In `src/builders/persona-builder.ts`: pass `target` to the
  `runValidate()` call (~line 293).
- In `src/plugins/ledger/index.ts`:
  - Add `target: TargetType` to the `onPostRender` parameter list.
  - Change cache key from `persona.name` to
    `${persona.name}:${target}` in `onPostRender`.
  - Add `target?: TargetType` to the `onValidate` parameter list.
  - Update the cache lookup in `onValidate` to use
    `${persona.name}:${target ?? 'unknown'}` (fallback ensures
    backward compatibility if called without target).
- Update the comment block above `renderedOutputCache` to reflect the
  new composite keying strategy.

Files to edit:
- `src/plugins/types.ts` (library — interface extension)
- `src/plugins/runner.ts` (library — forward `target`)
- `src/builders/persona-builder.ts` (library — pass `target`)
- `src/plugins/ledger/index.ts` (library — cache keying + signatures)

### Step 5 — Fix `pkg.version` mutation-before-log bug (ai-insights)

**Gold nugget 6 (synthesis) + next step #5.**

In `scripts/build-personas.js` (line ~46), the code mutates `pkg.version`
before the `console.log` that should show "old → new":

```js
pkg.version = newVersion;
// ...
console.log(`Updated personas/package.json: ${pkg.version} → ${newVersion}`);
```

Both `${pkg.version}` and `${newVersion}` resolve to the same value.

Actions:
- Capture `const oldVersion = pkg.version;` before the mutation.
- Change the log to:
  `console.log(\`Updated personas/package.json: ${oldVersion} → ${newVersion}\`);`

Files to edit:
- `scripts/build-personas.js` (ai-insights)

### Step 6 — Fix `catch` block exit code propagation (ai-insights)

**Gold nugget 7 (synthesis) + next step #6.**

The `catch` block in `scripts/build-personas.js` ignores the library's
exit code and always exits with `1`:

```js
} catch {
  process.exit(1);
}
```

Actions:
- Update the catch to propagate the library's exit code:
  `} catch (err) { process.exit(err.status ?? 1); }`

Files to edit:
- `scripts/build-personas.js` (ai-insights)

### Step 7 — Remove empty directories (ai-insights)

**Next step #4 (low priority).**

`scripts/lib/` and `scripts/tests/` are empty directories left behind
after the migration deleted their contents.

Actions:
- Delete `scripts/lib/` directory.
- Delete `scripts/tests/` directory.

### Step 8 — Run `npm pack --dry-run` and verify tarball (library)

**Next step #1 (before npm publish).**

This was flagged because Node was unavailable in the sandbox during
WP-007.

Actions:
- Run `npm pack --dry-run` from the library root.
- Verify only `dist/` contents are included (no `src/`, `tests/`,
  `fixtures/`).
- Verify the three entry points resolve correctly.

## Dependencies

- Steps 1–4 are independent and can be parallelized across work packages.
- Steps 5–6 are independent and can be parallelized.
- Step 7 is independent.
- Step 8 should run **after** steps 2 and 3 (which change the library
  build output), to verify the final tarball.

Sequencing:
```
Steps 1, 2, 3, 4, 5+6, 7  (all in parallel where pipelines allow)
         ↓
       Step 8 (after 2 + 3 complete)
```

## Required Components

### Library (`ai-persona-builder-STABLE`)
- `src/plugins/ledger/index.ts` — edit (JSDoc, cache keying, hook signatures)
- `src/plugins/ledger/role-validator.ts` — edit (extract `escapeRegExp`)
- `src/plugins/types.ts` — edit (add optional `target` to `onValidate`)
- `src/plugins/runner.ts` — edit (forward `target` in `runValidate`)
- `src/builders/persona-builder.ts` — edit (pass `target` to `runValidate`)
- `src/builders/types.ts` — edit (remove `TargetType` re-export)
- `src/builders/index.ts` — edit (remove `TargetType` re-export)
- `src/utils/regex.ts` — **new** (shared `escapeRegExp`)
- `src/utils/index.ts` — **new** (barrel)
- `src/index.ts` — edit (add `utils` barrel export)
- `docs/plugins.md` — edit (fix stale docs, add escalation pattern)
- `docs/agents/project-manifest/constraints.md` — edit (remove TargetType limitation)
- `docs/agents/project-manifest/api-surface.md` — edit (add `escapeRegExp`, update `warnOnUnknownRole`, update `onValidate` signature)
- `docs/agents/project-manifest/file-tree.md` — edit (add `src/utils/`)
- `CHANGELOG.md` — edit (1.0.1 entry)
- `package.json` — edit (bump to 1.0.1)

### Consumer (`ai-insights-dev`)
- `scripts/build-personas.js` — edit (two bug fixes)
- `scripts/lib/` — delete (empty dir)
- `scripts/tests/` — delete (empty dir)

## Assumptions

- The library is **not yet published to npm** — all changes can be made
  before the initial publish.
- The library version will bump to 1.0.1 (patch) since all code changes
  are internal refactors and bug fixes with no public API breakage.
- **Confirmed:** `onValidate(persona, suite)` does NOT receive `target`.
  `onPostRender(output, persona, target)` DOES receive it. Adding an
  optional `target?` to `onValidate` is a non-breaking interface change.

## Constraints

- The library's zero-dependency engine invariant must be preserved:
  `src/utils/regex.ts` must import nothing outside the engine layer.
- The `escapeRegExp` extraction must not change runtime behavior — the
  function is purely mechanical.
- `TargetType` must remain importable from the library's main entry point
  (`@mistralys/persona-builder`) after removing the builders re-export.
- Steps 5 and 6 must not change the `build-personas.js` wrapper beyond
  the 60-line constraint established by the previous plan.

## Out of Scope

- Publishing to npm (separate manual step after this work).
- Adding `persona-build --check` to CI (low priority, no plan coverage).
- Updating `personas/package.json` scripts to expose `build:lib`
  invocation (low priority).
- Regenerating `.context/` files (can be done via
  `node scripts/cli.js ctx-generate` after all edits are complete).
- The `tsup` duplicate `//# sourceMappingURL=` comment (gold nugget 8 —
  external tooling issue, tracked for a future tsup upgrade).
- The persona file count discrepancy (50 vs 48) — this is a
  documentation-only issue in the previous plan documents and does not
  warrant a code change.

## Acceptance Criteria

- `warnOnUnknownRole` documentation in `docs/plugins.md` accurately
  describes the `true` → warning / `false` → error escalation contract.
- The "not yet wired" blockquote is removed.
- A "Validator Severity Escalation Pattern" section exists in
  `docs/plugins.md` for future plugin authors.
- `TargetType` is only exported from `src/plugins/types.ts` →
  `src/plugins/index.ts` → `src/index.ts`. No re-export from
  `src/builders/`.
- `escapeRegExp` is a named export from `@mistralys/persona-builder`
  via `src/utils/regex.ts`.
- `renderedOutputCache` uses composite key `${name}:${target}` and
  `onValidate` receives the optional `target` parameter to look up
  the correct cache entry.
- `scripts/build-personas.js` log shows the correct old → new version.
- `scripts/build-personas.js` catch block propagates the library's
  exit code.
- `scripts/lib/` and `scripts/tests/` do not exist.
- `npm pack --dry-run` shows only `dist/` contents.
- All 275+ tests pass in the library.
- Library changelog and version bumped to 1.0.1.
- All affected project manifest documents are updated.

## Testing Strategy

- **Library tests:** Run `npm test` after each step that changes library
  source. All 275 tests must pass. Coverage thresholds (80% statements,
  80% branches, 80% functions) must be met.
- **Build verification:** Run `npm run build` after steps 2 and 3 to
  verify TypeScript compilation succeeds with the changed exports.
- **Tarball verification:** `npm pack --dry-run` in step 8 validates the
  distribution contents.
- **Persona rebuild:** Run `node scripts/build-personas.js` in ai-insights
  after steps 5 and 6 to verify the wrapper still produces byte-identical
  output.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Removing `TargetType` from builders breaks downstream consumers** | `TargetType` remains available via main entry (`src/index.ts` → `src/plugins/index.ts`). Run `npm run typecheck` to verify. |
| **Adding `target?` to `onValidate` is a signature change** | The parameter is optional — existing plugins that omit it are unaffected. TypeScript allows omitting trailing optional parameters. Run full test suite to verify. |
| **`escapeRegExp` extraction changes module resolution** | Pure re-export — same function, different import path. Internal consumers update import; external API gains a new export (additive, non-breaking). |
| **Patch version 1.0.1 confuses users who haven't published 1.0.0 yet** | Library is not yet on npm; version history is local only. Tag 1.0.1 on the new commit. |
