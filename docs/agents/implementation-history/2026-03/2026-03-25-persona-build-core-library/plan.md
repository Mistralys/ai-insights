# Plan: Persona Build — Core Library & Plugin Architecture

> **Supersedes:** `2026-03-24-persona-build-library-extraction/plan.md` (split into two sequential plans)
> **Sequence:** Plan 1 of 2 — followed by `2026-03-25-persona-build-integration/plan.md`

## Summary

Scaffold a standalone TypeScript npm library (`ai-persona-builder-STABLE`) that extracts the generic persona build engine from ai-insights' `scripts/build-personas.js` and `scripts/lib/persona-helpers.js`. The library will expose a plugin/decorator architecture, a programmatic API, and an optional CLI. This plan covers the library itself — it does **not** touch ai-insights or build the ledger-specific plugin. Those are Plan 2.

## Architectural Context

### Source Code Being Extracted

| Component | File | Lines | Key Functions |
|-----------|------|-------|---------------|
| Build CLI | `scripts/build-personas.js` | ~560 | `loadPartials()`, `discoverPersonaYamls()`, `buildForTarget()`, CLI parsing, frontmatter templates, `syncPersonasVersion()` |
| Helpers Module | `scripts/lib/persona-helpers.js` | ~350 | `resolvePartials()`, `resolveConditionals()`, `resolveVariables()`, `collapseBlankLines()`, `ensureBlankLineBeforeHeadings()`, `normalizeNewlines()`, `serializeTools()`, `serializeToolsList()`, `validateFileName()`, `renderRoster()`, `renderMcpToolsTable()` |
| Tests | `scripts/tests/persona-helpers.test.js` | ~160 | Vitest suite — serializers, validators, conditionals, partials, normalizers, strict regex |

### What Goes Into the Library (This Plan)

| Current Function | Library Module | Notes |
|------------------|----------------|-------|
| `resolvePartials()` | `src/engine/template-engine.ts` | Generic — no changes needed |
| `resolveConditionals()` | `src/engine/template-engine.ts` | Generic — no changes needed |
| `resolveVariables()` | `src/engine/template-engine.ts` | Generic — no changes needed |
| `collapseBlankLines()` | `src/engine/post-processors.ts` | Generic — no changes needed |
| `ensureBlankLineBeforeHeadings()` | `src/engine/post-processors.ts` | Generic — no changes needed |
| `normalizeNewlines()` | `src/engine/post-processors.ts` | Generic — no changes needed |
| `serializeTools()` | `src/engine/serializers.ts` | Generic — no changes needed |
| `serializeToolsList()` | `src/engine/serializers.ts` | Generic — no changes needed |
| `validateFileName()` | `src/validators/filename-validator.ts` | Generic — no changes needed |
| `loadPartials()` | `src/loaders/partials-loader.ts` | Two-layer (shared → suite-local) |
| `discoverPersonaYamls()` | `src/loaders/metadata-loader.ts` | File discovery pattern |
| Metadata merging logic | `src/loaders/metadata-loader.ts` | `_shared.yaml` + per-persona merge |
| Content template loading | `src/loaders/content-loader.ts` | `.md` file discovery |
| Suite × target build loop | `src/builders/persona-builder.ts` | Core orchestration |
| Frontmatter templates | `src/builders/frontmatter.ts` | Template registry |
| CLI parsing | `src/cli.ts` | Flags: `--config`, `--suite`, `--target`, `--check`, `--dry-run`, `--strict` |

### What Stays Behind (Plan 2)

| Function | Why |
|----------|-----|
| `renderRoster()` | Ledger-workflow-specific — becomes a ledger plugin hook |
| `renderMcpToolsTable()` | Ledger-workflow-specific — becomes a ledger plugin hook |
| Role validation against `workflow-manifest.json` | Project-specific — becomes a ledger plugin validator |
| `syncPersonasVersion()` | Project-specific — stays in ai-insights scripts |
| `FRONTMATTER_LEDGER_VSCODE/CC` templates | Ledger-specific — injected via plugin |
| `ccFrontmatterFields()` | Shared helper but tightly coupled to frontmatter templates |

### Target Repository

`ai-persona-builder-STABLE` — currently contains only `README.md` and `LICENSE`. Full scaffolding required.

---

## Approach / Architecture

### Library Package Structure

```
ai-persona-builder-STABLE/
├── src/
│   ├── index.ts                  # Public API barrel export
│   ├── cli.ts                    # Optional CLI binary (persona-build)
│   ├── engine/
│   │   ├── template-engine.ts    # resolvePartials, resolveConditionals, resolveVariables
│   │   ├── post-processors.ts    # collapseBlankLines, ensureBlankLineBeforeHeadings, normalizeNewlines
│   │   └── serializers.ts        # serializeTools, serializeToolsList
│   ├── builders/
│   │   ├── persona-builder.ts    # Core build orchestration (suite × target loop)
│   │   └── frontmatter.ts        # Frontmatter template registry & rendering
│   ├── loaders/
│   │   ├── partials-loader.ts    # Two-layer partials loading (shared → suite-local)
│   │   ├── metadata-loader.ts    # _shared.yaml + per-persona YAML merge
│   │   └── content-loader.ts     # Content template (.md) discovery
│   ├── plugins/
│   │   ├── types.ts              # PersonaBuildPlugin interface + hook types
│   │   └── plugin-runner.ts      # Hook execution engine
│   └── validators/
│       ├── filename-validator.ts  # vs_file_name / cc_file_name checks
│       └── strict-validator.ts    # Unresolved marker detection ({{…}} outside code fences)
├── tests/
│   ├── engine/
│   │   ├── template-engine.test.ts
│   │   ├── post-processors.test.ts
│   │   └── serializers.test.ts
│   ├── builders/
│   │   └── persona-builder.test.ts
│   ├── loaders/
│   │   └── partials-loader.test.ts
│   ├── plugins/
│   │   └── plugin-runner.test.ts
│   └── validators/
│       └── filename-validator.test.ts
├── fixtures/                     # Minimal persona suite for integration testing
│   ├── shared/
│   │   └── partials/
│   │       └── greeting.md
│   └── sample-suite/
│       ├── meta/
│       │   ├── _shared.yaml
│       │   └── example-persona.yaml
│       ├── content/
│       │   └── example-persona.md
│       └── partials/
│           └── suite-specific.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── LICENSE                       # Already exists
```

### Plugin Interface

```typescript
interface PersonaBuildPlugin {
  name: string;

  /** Called once per suite before any persona is built */
  onSuiteInit?(suite: SuiteConfig, sharedMeta: Record<string, unknown>): void;

  /** Called for each persona — mutate and return context before template rendering */
  onBuildContext?(
    context: Record<string, unknown>,
    persona: PersonaMetadata,
    suite: SuiteConfig
  ): Record<string, unknown>;

  /** Called after body rendering — can mutate and return output string */
  onPostRender?(output: string, persona: PersonaMetadata, target: TargetType): string;

  /** Called during validation phase — return errors/warnings array */
  onValidate?(persona: PersonaMetadata, suite: SuiteConfig): ValidationResult[];

  /** Register custom frontmatter templates keyed by personaMode */
  frontmatterTemplates?: Partial<Record<TargetType, string>>;
}
```

### Configuration Schema

```typescript
interface PersonaBuildConfig {
  rootDir?: string;
  suites: Record<string, SuiteConfig>;
  sharedPartialsDir?: string;
  plugins?: PersonaBuildPlugin[];
  frontmatter?: Partial<Record<TargetType, string>>;
  targets?: TargetType[];
  strict?: boolean;
}

interface SuiteConfig {
  srcDir: string;
  outVscode: string;
  outClaudeCode: string;
  personaMode?: string;
  partialsSubdir?: string;  // default: 'partials'
  metaSubdir?: string;      // default: 'meta'
  contentSubdir?: string;   // default: 'content'
}

type TargetType = 'vscode' | 'claude-code';
```

### Default Frontmatter Templates

The library ships with minimal default frontmatter for both targets. These work for the "standalone" persona mode — simple personas without numbered workflows or MCP server blocks.

**VS Code default:**
```
---
name: '{{name}} v{{version}}'
description: '{{description}}'
tools: [{{tools_serialized}}]
---
```

**Claude Code default:**
```
---
name: {{cc_file_name_stem}}
permissionMode: {{cc_permission_mode}}
model: {{cc_model}}
memory: {{cc_memory}}
allowedTools: [{{cc_tools_serialized}}]
---
```

Projects needing richer frontmatter (e.g., ledger workflow with `id`, `author`, `model`, MCP server blocks) register custom templates via plugins.

---

## Rationale

| Decision | Why |
|----------|-----|
| **Separate repo (not monorepo `packages/`)** | User has already set up `ai-persona-builder-STABLE` as the target. True standalone lib from day one — cleaner npm publishing, independent versioning, no workspace coupling. |
| **TypeScript with CJS + ESM dual output** | Type safety for plugin interfaces; supports both `require()` and `import` consumers. |
| **Plugin composition over inheritance** | Users stack multiple plugins. Each hook is independently testable. Scales to use cases the core doesn't anticipate. |
| **Frontmatter as injectable templates** | Keeps core unopinionated. Complex frontmatter (numbered mode, MCP server blocks) is just a template string injected via plugin, not hardcoded in the engine. |
| **Config-driven suites** | The current `SUITE_CONFIGS` hardcoding is the primary barrier to reuse. Config unlocks external projects. |
| **CLI wraps programmatic API** | API-first design. External projects can use programmatic API in their own build scripts, or use the CLI directly. |
| **Vitest for testing** | Consistent with mcp-server sub-project and root workspace. |

---

## Detailed Steps

### Phase 1: Project Scaffolding (in `ai-persona-builder-STABLE`)

1. **Initialize npm package** — `package.json` with name `@mistralys/persona-builder` (or chosen scope), `"type": "module"`, `"exports"` field for dual CJS/ESM, `"bin"` for CLI.
2. **Set up TypeScript** — `tsconfig.json` with ESM target, strict mode, `outDir: dist`, `rootDir: src`.
3. **Set up build tooling** — Install `tsup` for dual CJS/ESM bundling. Add `build`, `dev`, `test` scripts.
4. **Set up Vitest** — `vitest.config.ts` mirroring ai-insights conventions.
5. **Set up linting** — `.gitignore` (dist/, node_modules/), EditorConfig or equivalent.
6. **Create directory structure** — `src/`, `tests/`, `fixtures/` directories per the architecture above.

### Phase 2: Template Engine (Pure Functions)

7. **Port `resolvePartials()`** to `src/engine/template-engine.ts` — convert to TypeScript, add type annotations. Logic is identical: `{{> name}}` replacement with depth limit of 2.
8. **Port `resolveConditionals()`** to same file — `{{#if flag}}…{{else}}…{{/if}}` processing.
9. **Port `resolveVariables()`** to same file — `{{varName}}` substitution with missing-variable warnings.
10. **Port post-processors** to `src/engine/post-processors.ts` — `collapseBlankLines()`, `ensureBlankLineBeforeHeadings()`, `normalizeNewlines()`.
11. **Port serializers** to `src/engine/serializers.ts` — `serializeTools()`, `serializeToolsList()`.
12. **Port and expand tests** — Convert existing `persona-helpers.test.js` tests to TypeScript in `tests/engine/`. Add edge cases for each function.

### Phase 3: Loaders (File I/O)

13. **Implement `loadPartials()`** in `src/loaders/partials-loader.ts` — two-layer loading: read `sharedPartialsDir`, then overlay `<suite>/src/<partialsSubdir>/`. Return `Record<string, string>` map.
14. **Implement `discoverPersonaYamls()`** in `src/loaders/metadata-loader.ts` — scan `<suite>/<metaSubdir>/` for `*.yaml` files, exclude `_`-prefixed files, sort naturally.
15. **Implement `loadMetadata()`** in same file — parse `_shared.yaml`, parse per-persona YAML, merge (persona fields override shared defaults). Depends on `js-yaml`.
16. **Implement `loadContent()`** in `src/loaders/content-loader.ts` — given a persona identifier, read the matching `.md` file from `<suite>/<contentSubdir>/`.
17. **Write loader tests** — test partials overlay (shared vs. suite-local), metadata merge semantics, missing file handling.

### Phase 4: Plugin Architecture

18. **Define plugin types** in `src/plugins/types.ts` — `PersonaBuildPlugin`, `ValidationResult`, `HookContext` interfaces as specified in the architecture section.
19. **Implement plugin runner** in `src/plugins/plugin-runner.ts` — iterates registered plugins, calls hooks in order. Handles: `onSuiteInit`, `onBuildContext`, `onPostRender`, `onValidate`.
20. **Write plugin runner tests** — test hook execution order, multiple plugins composing, plugin returning modified context, validation aggregation.

### Phase 5: Builder Core

21. **Implement frontmatter registry** in `src/builders/frontmatter.ts` — stores default templates per target. Allows plugin overrides keyed by `personaMode`. Renders frontmatter through the template engine (conditionals → variables).
22. **Implement `buildPersona()`** in `src/builders/persona-builder.ts` — single persona pipeline: load metadata → load content → plugin `onBuildContext` → render frontmatter → render body (partials → conditionals → variables) → post-process → plugin `onPostRender` → return result.
23. **Implement `buildSuite()`** in same file — iterate all personas in a suite for a given target. Calls plugin `onSuiteInit`, then `buildPersona()` per persona, then plugin `onValidate`.
24. **Implement `build(config)`** — top-level entry point: iterate `config.suites × config.targets`, call `buildSuite()` for each combination. Return build results (file paths + content, or write to disk depending on mode).
25. **Implement `--check` mode** — compare generated output against existing files on disk. Return stale file list. Exit 1 if any.
26. **Implement `--strict` mode** — scan generated output for unresolved `{{…}}` markers (excluding code fences). Logic ported from current `build-personas.js`.

### Phase 6: Validators

27. **Port `validateFileName()`** to `src/validators/filename-validator.ts` — check that `vs_file_name` and `cc_file_name` fields exist and are non-empty for each persona.
28. **Implement strict marker validator** in `src/validators/strict-validator.ts` — scan output for unresolved `{{…}}` markers outside code fences. Return list of violations.

### Phase 7: CLI

29. **Implement CLI** in `src/cli.ts` — parse flags: `--config <path>`, `--suite <name>`, `--target <vscode|claude-code|all>`, `--check`, `--dry-run`, `--strict`. Default config discovery: `persona-build.config.js` or `persona-build.config.cjs` in cwd.
30. **Add `bin` entry** to `package.json` — `"persona-build": "./dist/cli.js"`.

### Phase 8: Public API & Documentation

31. **Create barrel export** in `src/index.ts` — export `build()`, `buildSuite()`, `buildPersona()`, plugin types, config types, engine functions (for advanced consumers).
32. **Create test fixtures** — minimal `fixtures/` directory with a sample suite (shared partials, one persona YAML + content template) that exercises the full pipeline.
33. **Write integration test** — build the fixture suite programmatically, assert output matches expected snapshot.
34. **Write README** — quick start, config reference, plugin authoring guide, CLI reference.

---

## Dependencies

| Package | Purpose | Type |
|---------|---------|------|
| `js-yaml` | YAML parsing for persona metadata | production |
| `tsup` | TypeScript → CJS + ESM dual bundling | dev |
| `typescript` | TypeScript compiler | dev |
| `vitest` | Testing framework | dev |

No other dependencies. The library has exactly **1 production dependency**.

---

## Required Components

### New Files (in `ai-persona-builder-STABLE`)

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- `src/index.ts`
- `src/cli.ts`
- `src/engine/template-engine.ts`
- `src/engine/post-processors.ts`
- `src/engine/serializers.ts`
- `src/builders/persona-builder.ts`
- `src/builders/frontmatter.ts`
- `src/loaders/partials-loader.ts`
- `src/loaders/metadata-loader.ts`
- `src/loaders/content-loader.ts`
- `src/plugins/types.ts`
- `src/plugins/plugin-runner.ts`
- `src/validators/filename-validator.ts`
- `src/validators/strict-validator.ts`
- `tests/engine/*.test.ts`
- `tests/builders/*.test.ts`
- `tests/loaders/*.test.ts`
- `tests/plugins/*.test.ts`
- `tests/validators/*.test.ts`
- `fixtures/` (test data)

### Modified Files

- `ai-persona-builder-STABLE/README.md` — rewrite with library documentation

---

## Assumptions

- The library package name will be `@mistralys/persona-builder` (adjustable before publish).
- The library targets Node.js ≥ 18 (ESM support, `fs/promises`, `path`).
- YAML metadata schema conventions (underscore-prefixed files = shared, content filenames match meta filenames) are stable and will be documented as the library's opinionated convention.
- The `ccFrontmatterFields()` helper will be absorbed into the default Claude Code frontmatter template rather than being a separate function.

---

## Constraints

- **No ai-insights coupling** — the library must not import from or reference `ai-insights-dev` code, paths, or config.
- **Cross-platform** — Windows, macOS, Linux support. Use `path.join()` everywhere, never hardcode separators.
- **Single production dependency** — only `js-yaml`. No framework or CLI framework deps.
- **Template syntax unchanged** — `{{variable}}`, `{{> partial}}`, `{{#if flag}}…{{/if}}` remain identical to current implementation.

---

## Out of Scope

- **Ledger plugin** — the roster renderer, MCP tools table, and role validation are Plan 2.
- **ai-insights migration** — rewriting `build-personas.js` to use the library is Plan 2.
- **npm publishing** — the library must build and test locally. Actual npm publish happens after Plan 2 validation.
- **Watch mode** — `--watch` flag is a future enhancement, not MVP.
- **Programmatic metadata query API** — future enhancement.
- **IDE deployment logic** (`sync-personas.js`) — project-specific, stays in ai-insights.

---

## Acceptance Criteria

1. `npm run build` produces dual CJS + ESM output in `dist/`.
2. `npm test` passes with ≥ 80% coverage on engine, loaders, builders, plugin runner.
3. `build(config)` builds a fixture suite and produces expected output (snapshot test).
4. Plugin hooks fire in documented order: `onSuiteInit` → `onBuildContext` → render → `onPostRender` → `onValidate`.
5. CLI `persona-build --config fixtures/test.config.js` builds the fixture suite successfully.
6. `--check` mode detects stale output (modified fixture → exit 1).
7. `--strict` mode detects unresolved `{{…}}` markers outside code fences.
8. Library can be consumed via `npm link` from another project.

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| **Unit (engine)** | Port existing tests + add edge cases. Test each function in isolation. |
| **Unit (loaders)** | Test partials overlay, metadata merge, content discovery against fixtures. |
| **Unit (plugin runner)** | Test hook ordering, multi-plugin composition, context mutation. |
| **Integration** | Build fixture suite end-to-end. Assert output matches snapshot. |
| **CLI** | Invoke CLI binary against fixtures. Assert exit codes and output files. |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Template engine behavior diverges from original** | Port tests first, then port code. Run both test suites to verify parity. |
| **Plugin interface is too restrictive for Plan 2** | Designed with known ledger use cases in mind. Three hooks (`onBuildContext`, `onPostRender`, `onValidate`) cover all current extension points. |
| **Dual CJS/ESM packaging issues** | Use `tsup` which handles this reliably. Test importing from both module systems. |
| **Fixture data doesn't cover all edge cases** | Fixtures cover the generic pipeline. Byte-identical regression against real data happens in Plan 2. |

---

## Post-Plan 1 Handoff Guide

Between Plan 1 and Plan 2, the user performs these manual steps to link the two repositories for local development.

### Step 1: Verify the Library Build

```bash
cd ai-persona-builder-STABLE
npm run build          # Compile TypeScript → dist/
npm test               # All tests green
ls dist/index.js       # Confirm output exists
```

### Step 2: Commit & Push the Library

```bash
git add -A
git commit -m "feat: initial library — engine, loaders, builders, plugin architecture, CLI"
git push
```

### Step 3: Link the Library into ai-insights-dev

Add the library as a local dependency using the `link:` protocol. This creates a symlink in `node_modules/` that points directly at the library repo on disk.

```bash
cd ai-insights-dev
```

Edit `package.json` — add to `dependencies` (or `devDependencies`):

```json
{
  "devDependencies": {
    "@mistralys/persona-builder": "link:../ai-persona-builder-STABLE"
  }
}
```

Then install to create the symlink:

```bash
npm install
```

Verify the link is live:

```bash
ls -la node_modules/@mistralys/persona-builder
# Should show: → ../../ai-persona-builder-STABLE
```

### Step 4: Understand the Development Loop

With `link:` active, the workflow during Plan 2 is:

```
Edit library source (ai-persona-builder-STABLE/src/)
        ↓
Run library build:  cd ai-persona-builder-STABLE && npm run build
        ↓
Changes are immediately visible in ai-insights-dev
(node_modules/@mistralys/persona-builder/dist/ points to the built output)
        ↓
Test from ai-insights-dev:  node scripts/build-personas.js
```

**Key point:** `link:` creates a real filesystem symlink, so `ai-insights-dev` always reads the library's actual `dist/` directory — no re-linking needed after changes. You only need to re-run `npm run build` in the library repo when you change library source files.

### Step 5: Proceed to Plan 2

Once the link is verified, Plan 2 (`2026-03-25-persona-build-integration/plan.md`) can be executed. It will build the ledger plugin in the library, then migrate ai-insights to use it.

### Cleanup (After npm Publish)

Once `@mistralys/persona-builder` is published to npm, replace the `link:` reference with the real version:

```json
{
  "devDependencies": {
    "@mistralys/persona-builder": "^1.0.0"
  }
}
```

Then `npm install` to switch from symlink to the published package.
