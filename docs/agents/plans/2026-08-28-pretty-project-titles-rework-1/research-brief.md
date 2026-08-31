# Research Brief

## Scope Sketch

- **Root Index schema** — `mcp-server/src/schema/root-index.ts` — modification (add `title` field)
- **Project Meta schema** — `mcp-server/src/schema/project-meta.ts` — modification (add `.trim()` to `title` and `project_summary`)
- **Tool schemas** — `mcp-server/src/tools/project-lifecycle.ts`, `mcp-server/src/tools/standalone-import.ts` — modification (add `.trim()` to `title` and `project_summary`)
- **Storage layer** — `mcp-server/src/storage/ledger-store.ts` — modification (thread `title` through `writeRootIndex` auto-sync)
- **Test suites** — `mcp-server/tests/tools/standalone-import.test.ts`, `mcp-server/tests/tools/project-lifecycle.test.ts`, `mcp-server/tests/gui/api.test.ts` — modification (fix inline schema mirrors, add resilience tests, add round-trip GUI test)
- **GUI handlers** — `mcp-server/gui/api.ts` — no code change needed (already reads `meta.title`)

## Area: Root Index Schema

### Verified References
- `mcp-server/src/schema/root-index.ts` (L1–L62): `RootIndexSchema` defines the `.ledger/project-ledger.json` shape. Has `project_summary: z.string().nullable().optional()` but NO `title` field. `project_summary` is stored at this level; `title` is not — creating an asymmetry where `title` is only persisted in `.meta.json` via the enrichment cache.

### Established Patterns
- `project_summary` is stored in BOTH the root index AND `.meta.json` — established by the original `project_summary` implementation. The root index write is the primary storage; `.meta.json` is auto-synced from it via `writeRootIndex()`.
- `outcome_summary` follows the same dual-path pattern: present in `RootIndexSchema` (L52) and auto-synced to `.meta.json` via `writeRootIndex()` (L307).

### Structural Observations
- `title` is only stored in `.meta.json` (via `writeProjectMeta()` cacheUpdates or `updateTitle()`), NOT in the root index. This means if the non-fatal enrichment try/catch in `initializeProject()` fails, the title is silently discarded. `project_summary` survives this scenario because it is spread into the root index object BEFORE the enrichment block.
- In `importStandaloneProject()`, the root index is written first, then `updateTitle()` is called separately. If `updateTitle()` fails, the import still succeeds but the title is lost. Adding `title` to the root index and auto-syncing it would provide resilience.

## Area: Schema Validation (`.trim().min(1)`)

### Verified References
- `mcp-server/src/tools/project-lifecycle.ts` (L547–L553): `InitializeProjectSchema` — `project_summary: z.string().min(1).optional()`, `title: z.string().min(1).max(200).optional()`. Neither has `.trim()`.
- `mcp-server/src/tools/standalone-import.ts` (L46–L67): `ImportStandaloneSchema` — same shapes: `project_summary: z.string().min(1).optional()`, `title: z.string().min(1).max(200).optional()`. Neither has `.trim()`.
- `mcp-server/src/schema/project-meta.ts` (L15): `title: z.string().optional()` — storage schema, no `.min(1)` (correct for backward compat).

### Established Patterns
- Input schemas use `.min(1)` to reject empty strings; storage schemas omit it for backward compatibility with existing data — established by `project_summary`.
- The `z.string().trim()` transform is NOT currently used anywhere in the codebase. Using it on input schemas would prevent whitespace-only strings from passing validation.

### Constraints
- `.trim()` in Zod is a transform, not a check — it modifies the value before downstream validators run. So `z.string().trim().min(1)` would first trim the string, then reject it if the result is empty. This is the correct behavior for preventing whitespace-only strings.
- Adding `.trim()` to storage schemas (`ProjectMetaSchema`, `RootIndexSchema`) would strip whitespace from existing stored data on parse, which is harmless for these fields.

## Area: Schema Boundary Tests

### Verified References
- `mcp-server/tests/tools/standalone-import.test.ts` (L424–L437): Two tests (`rejects an empty string for title`, `rejects a title exceeding 200 characters`) create inline `z.object({ title: z.string().min(1).max(200).optional() })` instead of importing `ImportStandaloneSchema`. If the real schema's constraints change (e.g., `.max(200)` → `.max(100)` or adding `.trim()`), these tests would still pass against the old inline mirror.
- `mcp-server/tests/tools/project-lifecycle.test.ts` (L2098–L2121): The `project_summary` schema tests DO import the real `InitializeProjectSchema` and validate against it — this is the correct pattern. No `title`-specific tests exist in this file at all.

### Established Patterns
- `project-lifecycle.test.ts` imports `InitializeProjectSchema` directly for `project_summary` schema boundary tests — the correct pattern.
- `standalone-import.test.ts` uses inline schema mirrors for `title` tests — the anti-pattern flagged by the synthesis.

### Structural Observations
- `project-lifecycle.test.ts` has no `title` tests at all (only `project_summary` tests at L2078–L2174). Given that `initializeProject()` accepts `title` and stores it in `.meta.json`, integration tests parallel to the existing `project_summary` tests are missing.

## Area: GUI Integration (Title Round-Trip)

### Verified References
- `mcp-server/gui/api.ts` (L429–L430): `handleListProjects` — if `meta.title` is set and non-empty, it overrides the slug-derived `project_name`.
- `mcp-server/gui/api.ts` (L639–L640): `handleGetProject` — same title-priority logic.
- `mcp-server/tests/gui/api.test.ts` (L878–L897): Two existing tests verify title priority in `handleListProjects`: (1) persisted title overrides slug-derived name, (2) falls back to slug-derived name when no title is set. Both use `store.updateTitle()` to set the title, NOT via the tool schemas.
- `mcp-server/gui/public/views/project-detail.js` (L677): Frontend uses `meta.title` as a display title fallback.

### Established Patterns
- The GUI test suite (`api.test.ts`) uses `createProject()` helper + `store.updateTitle()` to test title behavior — tests the GUI layer in isolation from the tool layer.
- End-to-end round-trip testing (tool call → GUI read) is not a current pattern in the test suite — tools and GUI are tested at their respective layers.

### Constraints
- The existing GUI title tests already cover the priority logic comprehensively. A full end-to-end round-trip test (call `importStandalone` with `title` → call `handleListProjects` → verify `project_name`) would be valuable but crosses layer boundaries that the test suite currently keeps separate.

## Strategic Context

The repository's strategic vision emphasizes making the project easy to set up and use, with minimal friction. Prior insights confirm that the `project_summary` field pattern is the canonical template for agent-curated metadata fields — any new field should mirror it at every layer. The `title` field implementation already follows this pattern at the tool and storage layers, but diverges at the root index layer (omission) and input validation layer (no `.trim()`), creating subtle inconsistencies that this rework addresses.
