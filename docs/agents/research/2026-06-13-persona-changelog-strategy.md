# Research Report: Per-Persona Change Tracking Strategy

## Problem Statement

The personas sub-project tracks changes in a single `personas/changelog.md` file (322 lines, ~37 personas). Version numbers live in per-persona YAML files (`version: "1.2.0"`) but the corresponding change descriptions are disconnected in the central changelog. As the persona count grows (9 ledger + 28 standalone = 37 personas), this central file becomes increasingly clumsy to navigate, and there is no way to see what changed in a specific persona without scanning through version-grouped entries that mix changes across many personas.

## Problem Decomposition

1. **Co-location gap:** The `version` field in YAML and the change description in `changelog.md` are in different files — a version bump without a changelog entry (or vice versa) is easy to miss.
2. **Navigation friction:** Finding all changes for a specific persona requires scanning the entire changelog and filtering mentally by `Standalone: <Name>:` or `Ledger: <Name>` prefixes.
3. **Scale problem:** Each new persona adds another stream of entries to the same file. At 37 personas and growing, the flat structure doesn't scale.
4. **Build-system compatibility:** Any solution must work with `@mistralys/persona-builder`, which passes through all unknown YAML fields and has a plugin API.
5. **Aggregate view:** A way to see "what changed in this release across all personas" is still valuable — the central changelog serves this purpose today.

## Context & Constraints

- The `@mistralys/persona-builder` library passes through **all** unknown YAML fields via an index signature (`[key: string]: unknown`). Custom fields are accessible as template variables but can simply remain unused.
- The library's plugin API (`onBuildContext`, `onValidate`) can process custom YAML fields.
- The `version` and `last_updated` fields already exist in every persona YAML.
- The central `personas/changelog.md` also tracks build-system and infrastructure changes (e.g. "Build: Upgraded Persona Builder to v2.5.1") that don't belong to any single persona.
- The Changelog Curator persona and the changelog convention (flat bullet list, category prefixes, ≤ 100-char lines) are existing workflow patterns.
- Per-persona files use either `N-name.yaml` (ledger) or `slug.yaml` (standalone) naming.

## Prior Art & Known Patterns

### Pattern 1: Monolithic Changelog (Current)

- **Description:** Single `changelog.md` grouped by release version, with `Ledger:` / `Standalone:` / `Build:` category prefixes per entry.
- **Where used:** Current system; common in small projects with few components.
- **Strengths:** Single file to read for a release overview; simple to maintain when persona count is low; familiar flat format.
- **Weaknesses:** Doesn't scale with persona count; finding one persona's history requires full-file scanning; version bumps and change descriptions are physically disconnected; encourages lazy "batch" changelog entries that blur individual persona evolution.
- **Fit:** Adequate for the first ~15 personas; deteriorating past that threshold.

### Pattern 2: Per-Component Changelog Files (Sibling Markdown)

- **Description:** Each persona gets a dedicated changelog file alongside its YAML/content, e.g. `src/changelog/researcher.md` or `src/meta/researcher.changelog.md`. Each file uses standard changelog format with `## vX.Y.Z` headings.
- **Where used:** Monorepo package changelogs (Lerna, Nx, Turborepo each generate per-package `CHANGELOG.md`); Terraform provider changelogs; VS Code extension changelogs per extension.
- **Strengths:** Full co-location — the changelog lives next to the persona source. Markdown is the natural format for changelogs. Each file stays small. Easy to review in PRs ("what changed in this persona?"). Git blame works per-persona.
- **Weaknesses:** Doubles the file count in `src/meta/` (or requires a new `src/changelog/` directory). New personas require creating a changelog file. Aggregate "release view" requires a build step or manual aggregation. Risk of orphaned changelog files when personas are deleted.
- **Fit:** Strong. Well-proven pattern at monorepo scale.

### Pattern 3: YAML Inline Changelog (Block Scalar)

- **Description:** Add a `changelog` field to each persona YAML using a YAML block scalar (`|`) containing dated entries:
  ```yaml
  changelog: |
    1.5.0 (2026-06-13): Added browser tool for interactive verification
    1.5.0: Improved review philosophy
    1.4.0 (2026-05-29): Gained implementer-friction filter
    1.3.0 (2026-05-01): Initial release
  ```
  Date is required on the first line of each version, optional on subsequent same-version lines. Both `version` and `last_updated` are derived from the first entry at build time.
- **Where used:** Some Helm charts embed `artifacthub.io/changes` annotations in YAML; Kubernetes CRDs sometimes carry inline descriptions. Not a widespread pattern for rich changelogs.
- **Strengths:** Maximum co-location — version and changes in the same file, same edit operation. Zero additional files. The `@mistralys/persona-builder` already handles this (the field is passed through but never rendered). Extremely low ceremony for the "bump version + add a line" workflow.
- **Weaknesses:** YAML block scalars are somewhat fragile (indentation-sensitive). No rich Markdown formatting (headings, links). The YAML file grows over time — though typically only by 1–3 lines per version bump. Harder to parse programmatically than structured YAML arrays.
- **Fit:** Good for small, concise entries. The question is whether the overhead is genuinely excessive.

### Pattern 4: YAML Structured Changelog (Array of Objects)

- **Description:** Add a structured `changelog` array to each persona YAML:
  ```yaml
  version: "1.5.0"
  changelog:
    - version: "1.5.0"
      changes:
        - "Added browser tool for interactive verification"
        - "Improved review philosophy"
    - version: "1.4.0"
      changes:
        - "Gained implementer-friction filter"
  ```
- **Where used:** Ansible Galaxy metadata (`changelogs/changelog.yaml`); some GitHub Actions `action.yml` files.
- **Strengths:** Machine-parseable. Can validate version matches. Easy to aggregate via build scripts.
- **Weaknesses:** Verbose — 4 lines of YAML boilerplate per version entry. Feels bureaucratic for 1–2 line changes. Duplicates the version string. YAML arrays of strings are visually noisy.
- **Fit:** Overly structured for this use case. This is the approach that was previously (correctly) rejected as too much overhead.

### Pattern 5: Hybrid — Per-Persona Source + Auto-Generated Aggregate

- **Description:** Per-persona changelogs (via Pattern 2 or 3) become the source of truth. A build-time aggregation step generates the central `personas/changelog.md` automatically from per-persona files, interleaving entries by version/date and adding `Build:` entries from a separate source.
- **Where used:** `changesets` (used by Pnpm, Astro, SvelteKit) — per-change files that aggregate into a package changelog at release time. Conventional Commits + `standard-version` / `release-please` aggregate per-package.
- **Strengths:** Best of both worlds — co-located source of truth + unified release view. Eliminates manual aggregation errors. The aggregate file becomes a read-only artifact.
- **Weaknesses:** Requires build-script investment. The aggregation logic must handle infrastructure entries (Build:, Engine:) that don't belong to any persona. Adds a step to the release workflow.
- **Fit:** Strong, but possibly over-engineered for the current scale.

## Alternative & Creative Approaches

### Approach A: YAML Block Scalar + Build-Time Validation

Combine Pattern 3 (inline block scalar) with a build-time validation step:

```yaml
changelog: |
  1.5.0 (2026-06-13): Added browser tool for interactive verification
  1.5.0: Improved review philosophy
  1.4.0 (2026-05-29): Gained implementer-friction filter
```

Entry format: `VERSION (DATE): Description`. The date is required on the **first** line of each version, optional on subsequent same-version lines. Both `version` and `last_updated` are derived from the first entry at build time.

A build plugin (or `--check` addition) validates that:
- The `changelog` field is non-empty and contains at least one parseable version
- The first line of each version group includes a date
- When multiple dates appear for the same version, they match (warn if not; use first)

The central `personas/changelog.md` becomes a curated release-level summary (infrastructure changes + highlights), no longer tracking every per-persona change. Per-persona history lives in the YAML.

- **Rationale:** Minimal friction — one field added to existing YAML, same file as the version bump. The build system already handles unknown fields. Validation prevents version/changelog drift.
- **Risk:** Block scalars with many entries (20+ lines) may make YAMLs feel bloated. Mitigated by keeping only the last N versions (e.g. 5) and archiving older history.

### Approach B: Sibling `.changes.md` Files + Aggregation Script

One Markdown file per persona in a parallel directory:

```
personas/ledger/src/changelog/3-developer.md
personas/standalone/src/changelog/researcher.md
```

Content:
```markdown
## v1.2.0
- Added browser tool for interactive verification

## v1.1.0
- Initial release
```

A post-build script aggregates all per-persona changelogs into the central `personas/changelog.md`, grouping by version and prefixing with `Ledger:` / `Standalone:`.

- **Rationale:** Clean separation of concerns. Markdown format is rich and familiar. Git history per file shows a clean persona-level timeline.
- **Risk:** More files to maintain. Must handle infrastructure entries separately.

### Approach C: Changeset-Style Fragments

Inspired by the `changesets` tool: when making a persona change, create a small Markdown fragment in `personas/.changes/`:

```markdown
---
persona: researcher
type: minor
---
Added browser tool for interactive verification
```

At release time, a script consumes all fragments, bumps versions, and appends to per-persona changelogs or the central changelog.

- **Rationale:** Zero-friction at change time (just create a tiny file). Version management is automated. Works well with PRs (each PR adds its own changeset file).
- **Risk:** Significant tooling investment. Over-engineered for a single-developer project. The fragment-to-version pipeline requires careful design.

## Comparative Evaluation

| Criterion | Pattern 1 (Current) | Pattern 2 (Sibling MD) | Pattern 3 (YAML Scalar) | Approach A (YAML + Validation) | Approach B (Sibling + Aggregation) | Approach C (Changesets) |
|---|---|---|---|---|---|---|
| **Co-location** | Poor | Good | Excellent | Excellent | Good | Fair |
| **Scalability** | Poor | Excellent | Good | Good | Excellent | Excellent |
| **Ceremony per change** | Medium (edit remote file) | Medium (edit sibling file) | Low (add a line) | Low (add a line) | Medium (edit sibling file) | Low (create fragment) |
| **Aggregate view** | Native | Requires tooling | Requires tooling | Manual curation | Auto-generated | Auto-generated |
| **Build complexity** | None | None (optional aggregation) | None | Plugin (~30 lines) | Script (~50 lines) | Script (~100 lines) |
| **Format richness** | Full Markdown | Full Markdown | Plain text lines | Plain text lines | Full Markdown | Markdown fragments |
| **Tooling investment** | None | Low | None | Low | Medium | High |
| **Risk of drift** | High (disconnected) | Medium (separate file) | Low (same file) | Very low (validated) | Low (automated) | Very low (automated) |

## Recommendation

**Primary: Approach A — YAML Block Scalar with Build-Time Validation.**

Rationale:

1. **Maximum co-location, minimum friction.** Adding a `changelog` field to each YAML means version bumps and change descriptions happen in the same file, same edit. This directly addresses the core complaint.

2. **Zero new files.** No sibling changelogs, no new directories, no fragment files. The persona count stays at 37 files, not 74.

3. **The library already supports it.** The `@mistralys/persona-builder` passes through unknown fields. A validation plugin is ~30 lines.

4. **Graceful entry format.** The block scalar format is concise:
   ```yaml
   changelog: |
     1.5.0 (2026-06-13): Added browser tool for interactive verification
     1.5.0: Improved review philosophy
     1.4.0 (2026-05-29): Gained implementer-friction filter
     1.3.0 (2026-05-01): Initial release
   ```
   Each change is one line. Date is required only on the first line of each version — subsequent same-version lines omit it. Both `version` and `last_updated` are derived automatically. A typical persona accumulates 1–3 lines per version. After 10 versions, that's 10–30 lines — manageable.

5. **Central changelog evolves, not dies.** `personas/changelog.md` becomes a curated **release summary** — infrastructure changes, cross-cutting themes, and highlights. It no longer needs to enumerate every per-persona change. This mirrors the existing hub-and-spoke model used at the workspace level.

6. **Build-time validation catches drift.** A plugin hook checks that the `changelog` field's first version matches the `version` field. This is strictly better than the current system where nothing validates the correspondence.

### Handling the transition

- **Existing changelog:** Keep `personas/changelog.md` as a historical archive + ongoing release-summary document (infrastructure changes, build changes, cross-persona themes). Stop adding per-persona detail to it.
- **Migration:** Add `changelog` fields to all 37 YAML files. For historical personas, start with just the current version's changes. No need to backfill.
- **Convention:** Each line follows `VERSION (DATE): Description` format (date required on first line per version, optional on subsequent same-version lines). Multiple changes per version get multiple lines with the same version prefix. Keep entries ≤ 100 chars to match house style.
- **Retention:** Keep all entries indefinitely (they're short). If a YAML grows unwieldy (unlikely), consider a `changelog_archive` field or simply truncate old entries — the central changelog has the historical record.

### Proof-of-Concept Outline

1. Add `changelog: |` field to 2–3 personas (e.g. `researcher.yaml`, `3-developer.yaml`, `plan-auditor.yaml`) with their recent change history.
2. Add a validation check in `scripts/build-personas.js` (post-build or in the plugin's `onValidate` hook) that verifies the `changelog` field's first version matches the `version` field.
3. Update the Persona Curator persona to include the `changelog` field in its "add a new persona" template.
4. Update `personas/docs/agents/project-manifest/constraints.md` with the new convention.
5. Run a full build (`node scripts/build-personas.js`) to confirm the field is passed through without issues.

### Why not sibling Markdown files?

Pattern 2 / Approach B is a solid second choice. It wins on format richness and scales slightly better for very long histories. But it doubles the file count, adds directory management overhead, and the aggregation script is more complex than a validation plugin. If the YAML block scalar approach proves insufficient (e.g. personas accumulate 50+ changelog lines), migrating to sibling files later is straightforward — the entries are already per-persona.

## Open Questions

- **Retention policy:** Should YAML changelogs keep all versions or trim to the last N? At ~2 lines per version, even 20 versions is only 40 lines — likely not a problem. Defer until it becomes one.
- **Build-system entries:** Infrastructure changes (e.g. "Build: Upgraded Persona Builder") don't belong to any persona. These should continue to live in the central `personas/changelog.md` under a `Build` category. The Persona Curator and Changelog Curator personas should be updated to reflect this split.
- **Backfill depth:** How far back to populate existing personas' `changelog` fields? Recommendation: current version only. The central changelog retains the full history.
- **Entry format:** The `VERSION (DATE): Description` format is simple but doesn't support sub-bullets or rich Markdown. Is this sufficient? Based on the existing changelog entries (almost all are single-line), yes.

---

## Addendum: Auto-Derived Version from Changelog (2026-06-13)

### Amendment

After accepting Approach A (YAML block scalar changelog), two additional requirements were identified:

1. **The `version` field should be automatically derived from the highest version in the changelog**, eliminating the `version` YAML field entirely.
2. **The `last_updated` field should be automatically derived from the date in the first changelog entry**, eliminating the `last_updated` YAML field entirely.

This makes both `version` and `last_updated` purely computed/virtual fields — they can never drift from the changelog because they *are* the changelog. The entry format is `VERSION (DATE): Description`, with the date required on the first line of each version and optional on subsequent same-version lines.

### Problem Analysis

The `version` field is currently consumed in four places inside `@mistralys/persona-builder`:

| Location | Function | How it reads `version` |
|----------|----------|----------------------|
| `buildContext()` (L282–296) | Builds the merged template context | `personaMeta['version']` → `sharedMeta['default_version']` → `'0.0.0'` |
| `buildAgentNameMap()` (L222–225) | Pre-scans all suites to build `agent_<slug>` variables | Same fallback chain |
| Frontmatter templates | Rendered as `{{version}}` | Reads from merged context |
| `PersonaMetadata.version` | Type declaration | `version?: string` |

And one place in the consuming project (`ai-insights`):

| Location | Function | How it reads `version` |
|----------|----------|----------------------|
| `scripts/build-personas.js` (L149) | Generates `personas/name-mapping.json` | Parses YAML scalar fields directly |

### Critical Architectural Constraint

`buildAgentNameMap()` runs **before** any plugin hooks. It pre-scans all suites to inject `agent_<slug>` = `"<name> v<version>"` into every persona's rendering context. This means changelog-to-version derivation **cannot be done in a plugin alone** — it must happen at the engine level, inside the builder itself.

### Recommended Implementation

#### Option A: Engine-Level Derivation (Recommended)

Add a `resolveVersionFromChangelog()` utility function to the persona-builder engine. Call it in both `buildContext()` and `buildAgentNameMap()` as a new step in the version resolution chain:

**Current chain:**
```
personaMeta['version'] → sharedMeta['default_version'] → '0.0.0'
```

**New chain:**
```
personaMeta['changelog'] (extract highest version) → sharedMeta['default_version'] → '0.0.0'
```

The `version` YAML field is removed from the chain entirely. If a persona has a `changelog` field, the version is derived from it. If not, the existing `default_version` fallback applies. The explicit `version` field stops being consulted.

**Implementation sketch:**

```typescript
// src/utils/changelog.ts (new file, zero dependencies — engine-safe)

export interface ChangelogMeta {
  version: string;
  date: string;      // ISO date string (YYYY-MM-DD)
}

/**
 * Extract version and date from the first entry of a changelog
 * block scalar.
 *
 * Expected format — one entry per line:
 *   VERSION (DATE): Description text
 *   VERSION: Description text          (date optional on subsequent same-version lines)
 *
 * Returns the version and date from the first parseable entry.
 * Returns undefined when the input is empty, not a string, or
 * contains no parseable entries.
 */
export function resolveChangelogMeta(
  changelog: unknown
): ChangelogMeta | undefined {
  if (typeof changelog !== 'string' || changelog.trim() === '') {
    return undefined;
  }

  // Match: VERSION (DATE): ...
  const withDate = changelog.match(
    /^(\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*:/m
  );
  if (withDate) {
    return { version: withDate[1], date: withDate[2] };
  }

  // Fallback: VERSION: ... (no date)
  const versionOnly = changelog.match(/^(\d+\.\d+\.\d+)\s*:/m);
  if (versionOnly) {
    return { version: versionOnly[1], date: '' };
  }

  return undefined;
}
```

**Integration points in `persona-builder.ts`:**

1. In `buildContext()`:
   ```typescript
   const clMeta = resolveChangelogMeta(personaMeta['changelog']);
   const version = clMeta?.version
     ?? (typeof sharedMeta['default_version'] === 'string'
       ? sharedMeta['default_version']
       : '0.0.0');
   const last_updated = clMeta?.date ?? '';
   // Inject both into merged context
   merged['version'] = version;
   merged['last_updated'] = last_updated;
   ```

2. In `buildAgentNameMap()`:
   ```typescript
   const clMeta = resolveChangelogMeta(persona['changelog']);
   const version = clMeta?.version ?? defaultVersion;
   ```

3. No backward-compatibility shim needed — ai-insights is the sole consumer. The `version` YAML field is removed outright, not deprecated:
   - When `changelog` is present → version is derived from it
   - When `changelog` is absent → fall back to `default_version` → `'0.0.0'`
   - The `version` key in YAML is deleted from all personas and no longer consulted by the engine

#### Option B: Plugin-Only (Not Recommended)

A plugin could parse the changelog in `onBuildContext` and inject a derived `version`. However:
- `buildAgentNameMap()` runs before plugins → agent name variables would still use the old (missing) version
- The plugin would have to be registered by every consumer project
- Version derivation is a core concern, not a project-specific customization

This option is architecturally unsound and rejected.

### Impact on Consumers

#### `ai-insights` — `scripts/build-personas.js`

The `name-mapping.json` generator currently reads `version` as a YAML scalar field. It must be updated to:
1. Read the `changelog` field from YAML
2. Apply `resolveVersionFromChangelog()` (or an equivalent JS regex)
3. Fall back to `default_version` from `_shared.yaml`

This is a ~5-line change in the existing `parseYamlScalars` flow.

#### `ai-insights` — Persona YAML files

All 37 persona YAML files:
- **Remove** the `version: "X.Y.Z"` line
- **Remove** the `last_updated: "YYYY-MM-DD"` line
- **Add** a `changelog: |` block scalar with at least the current version's entry (including date)

#### `ai-insights` — `_shared.yaml`

The `default_version` field is retained as the fallback for personas that haven't adopted the changelog field yet (graceful migration).

### Validation

The existing `onValidate` plugin hook is the right place for changelog format validation:
- Warn when `changelog` is present but contains no parseable version
- Warn when the first line of a version group has no date
- Warn when multiple dates appear for the same version and they don't match (use first)
- Warn when a persona has neither `changelog` nor inherits `default_version`
- Info when `version` or `last_updated` fields are present alongside `changelog` (suggesting removal)

This validation belongs in the consumer's plugin (the ledger plugin in ai-insights), not in the persona-builder engine, since the changelog field is a convention, not a hard requirement.

### Migration Plan

1. **Phase 1 — Engine change (persona-builder):**
   - Add `resolveChangelogMeta()` utility (returns `{ version, date }`)
   - Update `buildContext()` to derive both `version` and `last_updated` from changelog
   - Update `buildAgentNameMap()` to derive version from changelog
   - Add unit tests for the utility and integration tests for the chain
   - Bump persona-builder minor version

2. **Phase 2 — Consumer adoption (ai-insights):**
   - Update `scripts/build-personas.js` name-mapping generator
   - Add `changelog: |` field to all 37 persona YAMLs (with dates)
   - Remove `version:` and `last_updated:` lines from all 37 persona YAMLs
   - Add changelog validation to the ledger plugin's `onValidate` hook
   - Update persona manifest constraints documentation

3. **Phase 3 — Convention enforcement:**
   - Update Persona Curator to include `changelog` in new-persona templates
   - Update `--check` / `--strict` to flag personas without changelogs (optional)

### Open Questions (Addendum)

- **Backward compatibility:** Not a concern — ai-insights is the sole consumer. The `version` field is removed outright, not deprecated. Resolution chain: `changelog` → `default_version` → `'0.0.0'`.
- **Version format:** The regex `^(\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*:` matches strict semver + ISO date. Pre-release suffixes (e.g. `1.5.0-beta.1`) are not supported. Based on current usage, all versions are clean semver triples — no change needed.
- **Ordering validation:** Should the engine validate that changelog versions are in descending order? Recommendation: no — that's a consumer-level convention, not an engine invariant. The engine just extracts the first version found.
- **Date on subsequent lines:** When multiple entries share a version, only the first needs a date. If subsequent lines include a date and it differs, the consumer plugin warns and the first date wins.

## References

- `@mistralys/persona-builder` — [GitHub](https://github.com/Mistralys/ai-persona-builder), specifically the `PersonaMetadata` index signature and plugin API.
- YAML block scalar specification — [yaml.org/spec/1.2](https://yaml.org/spec/1.2-old/spec.html#id2795688)
- `changesets` tool — [github.com/changesets/changesets](https://github.com/changesets/changesets) (inspiration for Approach C)
- Existing personas changelog — `personas/changelog.md` (322 lines, 37 personas)
- Persona builder plugin hooks — `onBuildContext`, `onValidate` (6 available hooks)
- `buildAgentNameMap()` — `persona-builder.ts` L188–233 (pre-plugin version resolution)
- `buildContext()` — `persona-builder.ts` L282–296 (context version resolution)
- `scripts/build-personas.js` — `ai-insights` L101–149 (name-mapping version extraction)
