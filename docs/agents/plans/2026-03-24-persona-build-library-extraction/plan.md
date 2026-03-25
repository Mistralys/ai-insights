# Plan: Extract Persona Build System into Standalone Library

## Summary

Extract the persona build system (`scripts/build-personas.js`, `scripts/lib/persona-helpers.js`) into a standalone, reusable npm library that external projects can use to build AI agent persona files. The library will expose a plugin/decorator architecture to support project-specific extensions (such as the ledger workflow's roster, MCP tools tables, and role validation) without coupling the core engine to any single use case.

## Architectural Context

### Current System Structure

| Component | Location | Lines | Responsibility |
|-----------|----------|-------|----------------|
| Build CLI | `scripts/build-personas.js` | ~650 | CLI parsing, suite orchestration, file I/O, frontmatter templates |
| Helpers Module | `scripts/lib/persona-helpers.js` | ~230 | Pure template functions (partials, conditionals, variables), serializers, validators |
| Tests | `scripts/tests/persona-helpers.test.js` | ~150 | Vitest suite for helper functions |

### Current Suite Configuration Model

```javascript
const SUITE_CONFIGS = {
  ledger: {
    srcDir:      './personas/ledger/src',
    outVscode:   './personas/ledger/vs-code',
    outCC:       './personas/ledger/claude-code',
    personaMode: 'numbered',   // triggers roster, MCP tools, role validation
  },
  standalone: {
    srcDir:      './personas/standalone/src',
    outVscode:   './personas/standalone/vs-code',
    outCC:       './personas/standalone/claude-code',
    personaMode: 'standalone', // simpler schema
  },
};
```

### Key Observations for Extraction

1. **Pure helpers are already isolated.** The 12 functions in `persona-helpers.js` have no filesystem I/O and are fully testable in isolation.

2. **Frontmatter templates are constants.** Four template strings define VS Code and Claude Code frontmatter per persona mode. These can be overridden via config.

3. **Ledger-specific logic is localized.** Only ~60 lines in `buildForTarget()` handle numbered mode (roster rendering, MCP tools table, role validation against manifest).

4. **Shared partials use two-layer loading.** Base layer (`personas/shared/partials/`) + override layer (`<suite>/src/partials/`). This pattern is generic.

5. **Project-specific coupling points:**
   - Role validation reads `shared/workflow-manifest.json`
   - Version sync writes to `personas/package.json`
   - CLI flags assume workspace-relative paths

---

## Approach / Architecture

### Proposed Library Structure

```
@smor/persona-build/
├── src/
│   ├── index.ts                  # Public API exports
│   ├── cli.ts                    # Optional CLI binary
│   ├── engine/
│   │   ├── template-engine.ts    # resolvePartials, resolveConditionals, resolveVariables
│   │   ├── post-processors.ts    # collapseBlankLines, ensureBlankLineBeforeHeadings
│   │   └── serializers.ts        # serializeTools, serializeToolsList
│   ├── builders/
│   │   ├── persona-builder.ts    # Core build orchestration (suite × target loop)
│   │   └── frontmatter.ts        # Frontmatter template registry & rendering
│   ├── loaders/
│   │   ├── partials-loader.ts    # Two-layer partials loading
│   │   ├── metadata-loader.ts    # _shared.yaml + per-persona YAML
│   │   └── content-loader.ts     # Content template (.md) discovery
│   ├── plugins/                  # Plugin architecture
│   │   ├── types.ts              # Plugin interface definitions
│   │   └── hooks.ts              # Hook points (context-build, post-render, validate)
│   └── validators/
│       └── filename-validator.ts # vs_file_name / cc_file_name checks
├── plugins/                      # Reference plugins (optional peer deps)
│   └── ledger/
│       ├── index.ts              # Ledger plugin barrel export
│       ├── roster-renderer.ts    # renderRoster()
│       ├── mcp-tools-renderer.ts # renderMcpToolsTable()
│       └── role-validator.ts     # Cross-check roles against manifest
├── tests/
├── package.json
└── README.md
```

### Plugin Interface (Decorator Pattern)

```typescript
interface PersonaBuildPlugin {
  name: string;

  /** Called once per suite before any persona is built */
  onSuiteInit?(suite: SuiteConfig, sharedMeta: SharedMetadata): void;

  /** Called for each persona — mutate context before template rendering */
  onBuildContext?(
    context: PersonaContext,
    persona: PersonaMetadata,
    suite: SuiteConfig
  ): PersonaContext;

  /** Called after body rendering — can mutate output string */
  onPostRender?(output: string, persona: PersonaMetadata): string;

  /** Called during validation phase — return errors/warnings */
  onValidate?(persona: PersonaMetadata, suite: SuiteConfig): ValidationResult[];

  /** Register custom frontmatter templates */
  frontmatterTemplates?: {
    vscode?: string;
    claudeCode?: string;
  };
}
```

### Configuration Schema

```typescript
interface PersonaBuildConfig {
  /** Root directory for resolving suite paths (defaults to cwd) */
  rootDir?: string;

  /** Suite definitions — key = suite name */
  suites: Record<string, SuiteConfig>;

  /** Path to shared partials directory (optional) */
  sharedPartialsDir?: string;

  /** Plugins to apply (in order) */
  plugins?: PersonaBuildPlugin[];

  /** Default frontmatter templates (if no plugin overrides) */
  frontmatter?: {
    vscode?: string;
    claudeCode?: string;
  };

  /** Output targets to generate */
  targets?: ('vscode' | 'claude-code')[];

  /** Strict mode — fail on unresolved markers */
  strict?: boolean;
}

interface SuiteConfig {
  srcDir: string;         // e.g., './personas/ledger/src'
  outVscode: string;      // e.g., './personas/ledger/vs-code'
  outClaudeCode: string;  // e.g., './personas/ledger/claude-code'
  personaMode?: string;   // Arbitrary string — plugins can interpret this
  /** Suite-local partials subdirectory (default: 'partials') */
  partialsSubdir?: string;
  /** Suite-local metadata subdirectory (default: 'meta') */
  metaSubdir?: string;
  /** Suite-local content subdirectory (default: 'content') */
  contentSubdir?: string;
}
```

### Usage in ai-insights (After Extraction)

```javascript
// personas/build.config.js
const { ledgerPlugin } = require('@smor/persona-build/plugins/ledger');
const manifest = require('../shared/workflow-manifest.json');

module.exports = {
  rootDir: __dirname,
  sharedPartialsDir: './shared/partials',
  suites: {
    ledger: {
      srcDir: './ledger/src',
      outVscode: './ledger/vs-code',
      outClaudeCode: './ledger/claude-code',
      personaMode: 'numbered',
    },
    standalone: {
      srcDir: './standalone/src',
      outVscode: './standalone/vs-code',
      outClaudeCode: './standalone/claude-code',
      personaMode: 'standalone',
    },
  },
  plugins: [
    ledgerPlugin({
      manifestRoles: manifest.roles.map(r => r.name),
      warnOnUnknownRole: true,
    }),
  ],
};
```

### Usage in a New Project

```javascript
// my-project/persona-build.config.js
module.exports = {
  suites: {
    main: {
      srcDir: './agents/src',
      outVscode: './agents/vs-code',
      outClaudeCode: './agents/claude-code',
    },
  },
  // No plugins — use vanilla frontmatter
};
```

---

## Rationale

| Decision | Why |
|----------|-----|
| **Plugin architecture over subclassing** | Composition scales better. Users can stack multiple plugins. Easier to test each hook independently. |
| **Frontmatter as templates, not code** | Keeps the core engine unopinionated. Ledger's complex frontmatter (numbered mode, MCP servers block) is just another template string injected via plugin. |
| **Separate `ledger` plugin package** | Decouples workflow-specific logic. The library core has zero knowledge of "roster" or "MCP tools". |
| **Config-driven suite definitions** | The current `SUITE_CONFIGS` hardcoding is the main barrier to reuse. Moving to config unlocks external projects. |
| **TypeScript** | Type safety for plugin interfaces prevents integration errors. Core can compile to CJS + ESM dual targets. |
| **Keep CLI optional** | Programmatic API first. CLI wraps API. External projects may prefer their own CLI or task runner integration. |

---

## Detailed Steps

### Phase 1: Core Library Scaffolding

1. **Create new package** at `packages/persona-build/` (or a separate repo).
2. **Set up TypeScript** with ESM + CJS dual output, strict mode enabled.
3. **Define plugin interfaces** (`PersonaBuildPlugin`, `SuiteConfig`, `PersonaBuildConfig`).
4. **Port pure helpers** from `scripts/lib/persona-helpers.js` to TypeScript.
5. **Port template engine** — `resolvePartials`, `resolveConditionals`, `resolveVariables`.
6. **Port post-processors** — `collapseBlankLines`, `ensureBlankLineBeforeHeadings`, `normalizeNewlines`.
7. **Port serializers** — `serializeTools`, `serializeToolsList`.

### Phase 2: Builder Core

8. **Implement `loadPartials()`** with two-layer loading (shared → suite-local).
9. **Implement `discoverPersonaYamls()`** for metadata file discovery.
10. **Implement `loadMetadata()`** to merge `_shared.yaml` + per-persona YAML.
11. **Implement `loadContent()`** to read `.md` content templates.
12. **Implement default frontmatter templates** for VS Code and Claude Code (standalone mode only).
13. **Implement `buildPersona()`** — single persona rendering pipeline.
14. **Implement `buildSuite()`** — suite × target iteration with plugin hooks.
15. **Implement `build(config)`** — top-level API entry point.

### Phase 3: Plugin Architecture

16. **Define hook execution order** — `onSuiteInit` → (`onBuildContext` → render → `onPostRender`) × personas → `onValidate`.
17. **Implement plugin runner** — iterates plugins and calls hooks.
18. **Implement frontmatter template registry** — plugins can register custom templates per `personaMode`.
19. **Add Zod schema validation** for config files (optional but recommended).

### Phase 4: Ledger Plugin

20. **Create `@smor/persona-build-ledger` plugin** (can be bundled or separate package).
21. **Port `renderRoster()`** to plugin's `onBuildContext` hook.
22. **Port `renderMcpToolsTable()`** to plugin's `onBuildContext` hook.
23. **Port role validation** to plugin's `onValidate` hook.
24. **Inject ledger frontmatter templates** via plugin's `frontmatterTemplates`.
25. **Document ledger plugin configuration** (manifest roles, warn mode).

### Phase 5: CLI

26. **Implement CLI binary** (`persona-build`) with flags: `--config`, `--suite`, `--target`, `--check`, `--dry-run`, `--strict`.
27. **Default config file discovery** — `persona-build.config.js`, `persona-build.config.json`, or `package.json#personaBuild`.

### Phase 6: Migration

28. **Create `personas/build.config.js`** in ai-insights using the new library.
29. **Update `scripts/build-personas.js`** to delegate to the library (or replace entirely).
30. **Update `scripts/sync-personas.js`** to import from the library if it uses any helper functions.
31. **Verify all 48 persona files build identically** (diff check).
32. **Remove extracted code** from `scripts/` that is now in the library.

### Phase 7: Publish & Docs

33. **Write README** with quick start, config reference, plugin authoring guide.
34. **Publish to npm** as `@smor/persona-build` (or chosen scope).
35. **Tag release** and update root changelog.

---

## Dependencies

- **js-yaml** — YAML parsing (already in use)
- **zod** (optional) — config validation
- **esbuild** or **tsup** — TypeScript bundling for dual CJS/ESM output
- **vitest** — testing (consistency with mcp-server)

---

## Required Components

### New Files (Library Package)

- `packages/persona-build/package.json`
- `packages/persona-build/tsconfig.json`
- `packages/persona-build/src/index.ts`
- `packages/persona-build/src/engine/*.ts`
- `packages/persona-build/src/builders/*.ts`
- `packages/persona-build/src/loaders/*.ts`
- `packages/persona-build/src/plugins/*.ts`
- `packages/persona-build/src/validators/*.ts`
- `packages/persona-build/src/cli.ts`
- `packages/persona-build/plugins/ledger/index.ts`
- `packages/persona-build/tests/*.test.ts`

### Modified Files (ai-insights)

- `personas/build.config.js` (new)
- `scripts/build-personas.js` (rewritten to use library, or deprecated)
- `scripts/sync-personas.js` (minor import changes, if any)
- `package.json` (add workspace or dependency reference)

---

## Assumptions

- The library will initially be stored in the same repository under `packages/` (monorepo pattern) before considering extraction to a separate repo.
- External projects will install via npm; no symlink or local path assumptions.
- The ledger plugin ships as part of the library package initially; it can be split later if needed.
- Claude Code and VS Code will remain the two supported IDE targets for the foreseeable future.

---

## Constraints

- **Backward compatibility** — existing `scripts/build-personas.js` CLI flags MUST continue to work (or be wrapped) during transition.
- **Byte-identical output** — the extracted library must produce the exact same output files as the current implementation for all 48 personas.
- **Cross-platform** — Windows, macOS, Linux support (already achieved; must not regress).
- **Zero breaking change to persona source files** — template syntax (`{{variable}}`, `{{> partial}}`, `{{#if flag}}`) remains unchanged.

---

## Out of Scope

- **IDE deployment (sync-personas.js)** — the sync script remains project-specific; it uses OS paths to IDE directories. Future: may extract platform-detection helpers, but not the full sync logic.
- **Version sync** — the `syncPersonasVersion()` function that writes to `personas/package.json` is project-specific and will remain in ai-insights.
- **Workflow manifest validation** — role validation depends on the ledger workflow's manifest; this is plugin territory, not core.
- **GUI or interactive mode** — the library is headless; no interactive prompts.

---

## Acceptance Criteria

1. ✅ Library exports a `build(config)` function that handles all suite/target combinations.
2. ✅ `PersonaBuildPlugin` interface allows custom context mutation, post-processing, and validation.
3. ✅ Default frontmatter templates work for simple standalone personas without plugins.
4. ✅ Ledger plugin reproduces all current numbered-mode features: roster, MCP tools table, role validation.
5. ✅ CLI binary supports `--suite`, `--target`, `--check`, `--dry-run`, `--strict` flags.
6. ✅ All 48 current personas build with identical output (verified via diff).
7. ✅ A new external project can consume the library with a minimal config file.
8. ✅ Test coverage ≥ 80% for core engine and plugin hooks.

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| **Unit (engine)** | Port existing `persona-helpers.test.js` tests to TypeScript + add cases for new functions. |
| **Unit (plugins)** | Test each hook in isolation with mock context objects. |
| **Integration** | Build a sample suite from fixtures and assert output matches snapshots. |
| **Regression** | Run library build on ai-insights `personas/` and diff against current generated output (must be empty diff). |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Scope creep** from supporting too many extensibility patterns | Start with the three hooks (`onBuildContext`, `onPostRender`, `onValidate`) that cover known use cases. Add more hooks only when concrete demand arises. |
| **Subtle output differences** break existing CI checks | Byte-for-byte regression test against current output. Run `--check` mode before and after migration. |
| **Plugin API churn** before 1.0 stabilizes | Mark plugin interface as experimental (`@alpha`) until one external project successfully integrates. |
| **Dual CJS/ESM packaging issues** | Use tsup or similar bundler with tested dual-output config. Test importing from both module systems. |
| **Ledger plugin grows too complex** | Keep ledger-specific logic thin — it should only populate context variables and inject templates, not reimplement rendering. |

---

## Feasibility Assessment

| Criterion | Rating | Notes |
|-----------|--------|-------|
| **Code separation** | 🟢 High | Pure helpers already isolated; frontmatter is data. |
| **Test coverage** | 🟢 High | Existing `persona-helpers.test.js` covers core logic. |
| **Breaking change risk** | 🟡 Medium | Template syntax is stable, but CLI flag semantics need careful wrapping. |
| **Effort estimate** | 🟢 Medium | ~3-5 days for core library + ledger plugin; ~1 day for migration. |
| **External reuse value** | 🟢 High | Any project using VS Code + Claude Code agent personas would benefit. |

---

## Additional Consideration: Missing from Initial Requirements

1. **Config file auto-discovery** — support `persona-build.config.js` in project root (similar to eslint, prettier).
2. **Watch mode** — optional `--watch` flag for rebuild on source file changes (nice-to-have, not MVP).
3. **Programmatic API for metadata access** — allow external tools to query persona metadata without building (e.g., for linting or IDE integrations).
4. **Schema export for YAML metadata** — publish JSON Schema for `_shared.yaml` and per-persona YAML to enable editor auto-complete.
