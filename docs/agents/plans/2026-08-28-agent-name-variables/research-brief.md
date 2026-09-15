# Research Brief

> **Subject:** Redesign of the cross-suite agent-name template variables in
> `@mistralys/persona-builder` and its consumer, the `ai-insights` persona suite.
> **Date:** 2026-08-28

## Scope Sketch

- **Library agent map construction** — `ai-persona-builder/src/builders/persona-builder.ts` — modification
- **Library target registry** — `ai-persona-builder/src/targets/` — modification (possible new field)
- **Library tests** — `ai-persona-builder/tests/builders/` — new + modified tests
- **Library docs** — `ai-persona-builder/docs/`, `ai-persona-builder/docs/agents/project-manifest/` — modification
- **Consumer build wrapper** — `ai-insights/scripts/build-personas.js` — modification (new validation)
- **Consumer ledger plugin** — `ai-insights/personas/plugins/ledger/` — modification
- **Consumer persona content** — `ai-insights/personas/*/src/content/`, `ai-insights/personas/shared/partials/` — modification
- **Consumer docs** — `ai-insights/personas/docs/agents/project-manifest/`, `ai-insights/AGENTS.md` — modification
- **Blast-radius check (read-only)** — `ai-insights/personas/name-mapping.json`, `ai-insights/mcp-server/src/utils/constants.ts`, `ai-insights/orchestrator/src/utils/subagents.py` — no change expected

---

## Area: Library — Agent Map Construction

### Verified References

- `ai-persona-builder/src/builders/persona-builder.ts` (L194–232): `buildAgentNameMap(config)`.
  Iterates `config.suites`, loads `_shared.yaml` for `default_version`, discovers persona YAMLs,
  and for each persona emits exactly two keys:
  ```ts
  const slug = typeof persona['slug'] === 'string' ? persona['slug'] : path.basename(yamlPath, '.yaml');
  const name = typeof persona['name'] === 'string' ? persona['name'] : slug;
  const clMeta = resolveChangelogMeta(persona['changelog']);
  const version = clMeta?.version ?? defaultVersion;
  const underscoredSlug = slug.replace(/-/g, '_');
  agentMap[`agent_${underscoredSlug}`] = `${name} v${version}`;
  agentMap[`agent_slug_${underscoredSlug}`] = slug;
  ```
- `ai-persona-builder/src/builders/persona-builder.ts` (L29): doc comment describes layer 6 of the
  merge order as "Cross-suite agent map — `agent_<slug>` / `agent_slug_<slug>` entries".
- `ai-persona-builder/src/builders/persona-builder.ts` (L698–717): `build()` calls
  `buildAgentNameMap(config)` **once at L710, before** the `for (const target of targets)` loop at
  L713. The map is therefore target-independent by construction today.
- `ai-persona-builder/src/builders/persona-builder.ts` (L359–363): agent map injection into the
  context is **non-overriding** — `if (!(key in merged)) merged[key] = value;`. A persona YAML
  field of the same name wins.
- `ai-persona-builder/src/builders/persona-builder.ts` (L120–133): `loadPersonaYaml()` sets
  `record['name'] = path.basename(yamlPath, '.yaml')` when `name` is absent. Note this fallback is
  applied inside `loadPersonaYaml`, which `buildAgentNameMap` also calls — so the `name` fallback at
  L215 is effectively redundant, but the value it produces is the **filename stem**, not the slug.
- `ai-persona-builder/src/builders/persona-builder.ts` (L398–401): `validateSubagentRefs(persona, agentMap)`
  looks up `agent_slug_${slug.replace(/-/g,'_')}`; unknown slugs produce `error`-severity results.

### Established Patterns

- **Per-target declarative templates** — `ai-persona-builder/src/targets/types.ts` (L83–120) defines
  `DEFAULT_FRONTMATTER_VSCODE`, `DEFAULT_FRONTMATTER_CLAUDE_CODE`, `DEFAULT_FRONTMATTER_DEEP_AGENTS`
  as template strings. Per-target string templates resolved through the same engine are the
  library's established way to express target-specific output shape.
- **Target definition as the extension seam** — `ai-persona-builder/src/targets/types.ts` (L18–66)
  `TargetDefinition` carries `name`, `outputDirKey`, `filenameContextKey`, `defaultFrontmatter`,
  `contextFlags`, `defaultEnabled`. `ai-persona-builder/src/targets/built-in.ts` (L38–66) registers
  the three built-in targets. Adding a per-target behaviour knob has an existing home here.
- **Frontmatter template precedence chain** — plugin `frontmatterTemplates` → `BuildConfig.frontmatter`
  → `registry.get(target).defaultFrontmatter` → library default. Documented at
  `ai-persona-builder/docs/agents/project-manifest/constraints.md` § Known Limitations 5.
- **Plugin `onBuildContext` hook** — `ai-persona-builder/src/plugins/types.ts` (L233–238):
  `onBuildContext(context, persona, suite, target?): Record<string, unknown>`. Receives `target`, so
  a consumer-side plugin can already inject target-aware per-persona variables — but only for the
  persona **being built**, not for the cross-suite map of *other* personas.

### Structural Observations

- `ai-persona-builder/src/builders/persona-builder.ts` (L194–232): `buildAgentNameMap()` hardcodes
  the value format `` `${name} v${version}` ``. This is a naming *policy* baked into a library
  function, with no configuration seam. It is the direct cause of Problem A: a consumer whose
  frontmatter `name` field is composed differently has no way to make the map agree.
- `ai-persona-builder/src/builders/persona-builder.ts` (L215): the `name` fallback chain
  (`persona['name']` → `slug`) is dead-ish code — `loadPersonaYaml()` at L131 already guarantees
  `name` is set to the filename stem. The two fallbacks disagree (stem vs. slug) and the L131 one
  always wins. Harmless today because stem == slug for every ai-insights persona, but it is a
  latent inconsistency.
- `ai-persona-builder/src/builders/persona-builder.ts` (L710): the single pre-loop call means any
  target-aware map requires either restructuring to build per-target maps, or emitting
  target-qualified keys from one pass.
- `ai-persona-builder/src/builders/persona-builder.ts` (L359–363): the non-overriding injection is a
  useful escape hatch — a persona can override any `agent_*` key from its own YAML. Verified by
  test `explicit YAML field takes precedence over computed agent map entry`
  (`tests/builders/agent-name-map.test.ts` L376–421).

### Constraints

- **Zero-dependency engine layer** — `ai-persona-builder/docs/agents/project-manifest/constraints.md`
  § Architectural Invariants 1. All five `src/engine/` modules have zero imports. Any new naming
  logic requiring `node:path` or `js-yaml` must live in `src/builders/` or `src/loaders/`.
- **Synchronous plugin runner** — same document, invariant 2. All six hook runners are synchronous.
- **Strict + check interaction** — same document, invariant 3. `strict: true` without `check: true`
  writes files before evaluating failures.
- **Library is consumed by projects other than ai-insights** — no ai-insights naming convention
  (`{number} - {role}`) may be hardcoded into library code.
- **Uncommitted working tree** — `git status --short` in `ai-persona-builder` reports three modified
  files: `docs/agents/project-manifest/README.md`, `docs/agents/project-manifest/constraints.md`,
  `docs/metadata-reference.md` (36 insertions, 9 deletions total). The `docs/metadata-reference.md`
  diff adds three ai-insights-convention metadata rows (`design_notes`, `audit_guide_version`,
  `audit_date`). These are docs-only and touch the same files this plan must edit.
- **Version drift in the library** — `CHANGELOG.md` head is `## v2.6.1 - Bundle Documentation`,
  but `package.json` reports `2.5.1`. The consumer has `2.6.0` installed
  (`personas/node_modules/@mistralys/persona-builder/package.json`) and declares `^2.6.0`.

---

## Area: Library — Tests

### Verified References

- `ai-persona-builder/tests/builders/agent-name-map.test.ts` — two describe blocks:
  - `cross-suite agent name map` (L94): 7 tests — cross-suite resolution (L95), hyphen→underscore
    key derivation (L147), filename-stem fallback (L192), `default_version` fallback (L238),
    `0.0.0` fallback (L285), self-suite resolution (L333), explicit YAML override (L376).
  - `agent_slug_* keys` (L429): 3 tests — coexistence (L430), hyphen preservation (L480),
    both keys for the same persona (L528).
- `ai-persona-builder/tests/builders/` contains 12 test files, including
  `subagent-validation.test.ts`, `target-variable-injection.test.ts`, `da-computed-fields.test.ts`.
- `ai-persona-builder/tests/integration/build.test.ts` also references `agent_`.

### Established Patterns

- Tests build real fixture suites on a temp directory and assert on `BuildResult.content`
  substrings — e.g. `expect(consumerResult!.content).toContain('Invoke Helper v2.0.0 for help.')`
  (`tests/builders/agent-name-map.test.ts` L143).
- Negative assertions confirm substitution occurred: `.not.toContain('{{agent_helper}}')` (L144).

### Structural Observations

- `ai-persona-builder/tests/builders/agent-name-map.test.ts`: every existing test asserts the
  `"<name> v<version>"` format. Any change to the default format breaks all ten. This is the
  correct signal — the tests encode the current contract — but it means format changes are visibly
  breaking rather than silent.

### Constraints

- Test framework is Vitest; `npm test` runs all tests once.

---

## Area: Library — Documentation

### Verified References

- `ai-persona-builder/docs/metadata-reference.md` (L18): `slug` row — "used for `agent_*` map keys
  and output path fallback".
- `ai-persona-builder/docs/metadata-reference.md` (L100): subagent validator looks up
  `agent_slug_{slug}`.
- `ai-persona-builder/docs/metadata-reference.md` (L111): mentions `{{agent_<slug>}}` and
  `{{agent_slug_<slug>}}`.
- `ai-persona-builder/docs/metadata-reference.md` (L199): auto-derived context table row —
  `` | `{{agent_<slug>}}` | All personas across all suites | Cross-suite reference: `"<name> v<version>"`. Key uses slug with hyphens replaced by underscores. | ``
  Note: the table has **no `{{agent_slug_<slug>}}` row** — that key is documented only in prose.
- `ai-persona-builder/docs/template-syntax.md` (L18): merge-order list item 6 —
  "Cross-suite agent map (`agent_<slug>` variables)".
- `ai-persona-builder/docs/agents/project-manifest/api-surface.md` (L72–83): agent map section with
  a two-row table and worked examples (`agent_my_great_agent` → `"My Great Agent v1.2.0"`).
- `ai-persona-builder/docs/agents/project-manifest/api-surface.md` (L341–343): `validateSubagentRefs()`
  documentation and key-derivation rule.
- `ai-persona-builder/docs/agents/project-manifest/data-flows.md` (L18–20): pre-scan flow diagram
  showing both key formats; (L82) merge-order layer 4 note "non-overriding"; (L105–106) context
  variable table rows for both keys.
- `ai-persona-builder/docs/agents/project-manifest/constraints.md` § Sub-Agent Validation
  Constraints 4: `subagents` slugs must resolve to `agent_slug_*` keys.

### Structural Observations

- The `{{agent_slug_<slug>}}` variable is missing from the auto-derived context table in
  `docs/metadata-reference.md` (L190–199) while `{{agent_<slug>}}` is present. Adding a third
  variable to a table that is already incomplete would compound the gap.

### Constraints

- `AGENTS.md` (ai-persona-builder) Manifest Maintenance Rules require: "Add/modify builder function"
  → `api-surface.md`, `data-flows.md` (if pipeline changes); "Change frontmatter defaults" →
  `api-surface.md`, `data-flows.md`; "Change architectural pattern" → `tech-stack.md`,
  `constraints.md`.

---

## Area: Consumer — Ledger Persona Metadata and Frontmatter

### Verified References

- `ai-insights/personas/ledger/src/meta/[0-9]*.yaml` — all nine files. Verified fields per file:
  `1-planner.yaml`: `number: 1`, `role: Planner`, `vs_file_name: 1-planner.agent.md`,
  `id: ledger-1-planner`, `cc_file_name: 1-planner.md`, `da_file_name: 1-planner.md`.
  Same shape for `2-project-manager` (`Project Manager`, `vs_file_name: 2-pm.agent.md`,
  `id: ledger-2-pm`), `3-developer` (`Developer`, `3-dev.agent.md`, `ledger-3-dev`),
  `4-qa` (`QA`), `5-security-auditor` (`Security Auditor`), `6-reviewer` (`Reviewer`),
  `7-release-engineer` (`Release Engineer`), `8-documentation` (`Documentation`,
  `8-docs.agent.md`, `ledger-8-docs`), `9-synthesis` (`Synthesis`).
  **No `name:` field and no `slug:` field in any of the nine.**
- `ai-insights/personas/plugins/ledger/frontmatter-templates.js` (L46–60): `FRONTMATTER_LEDGER_VSCODE`
  contains `name: '{{number}} - {{role}} v{{version}}'`. This is the sole producer of the
  dispatchable VS Code agent name for ledger personas.
- `ai-insights/personas/plugins/ledger/frontmatter-templates.js` (L70): ledger CC template uses
  `name: {{cc_name}}`.
- `ai-insights/personas/plugins/ledger/index.js` (L303–306): `cc_name` is an alias for
  `cc_file_name_stem`.
- `ai-insights/personas/plugins/ledger/index.js` (L171–178): `onSuiteInit` applies the ledger
  frontmatter templates only when `suite.personaMode === 'numbered'`.
- `ai-insights/personas/persona-build.config.js` (L36–46): `FRONTMATTER_STANDALONE_VSCODE` contains
  `name: '{{name}} v{{version}}'` — this matches the library's agent-map format, which is why
  non-ledger personas render correctly.
- `ai-insights/personas/persona-build.config.js` (L72–76): `FRONTMATTER_DA` is
  `name: {{id}}` / `description: '{{cc_description}}'`.
- `ai-insights/personas/persona-build.config.js` (L80): `targets: ['vscode', 'claude-code', 'deep-agents']`.
- `ai-insights/personas/persona-build.config.js` (L88–113): three suites — `ledger`
  (`personaMode: 'numbered'`), `standalone` and `ledger-support` (both `personaMode: 'standalone'`).

### Established Patterns

- **Ledger identity is `{number} + {role}`; non-ledger identity is `{name}`** — verified across all
  three `src/meta/` directories. `ledger-support/src/meta/ledger-wp-decomposer.yaml` has
  `slug: ledger-wp-decomposer`, `name: "Ledger WP Decomposer"`, `id: standalone-ledger-wp-decomposer`.
  `standalone/src/meta/plan-auditor.yaml` has `slug: plan-auditor`, `name: "Plan Auditor"`,
  `id: standalone-plan-auditor`. Neither carries `role` or `number`.
- **`slug` equals `cc_file_name` stem for every persona in all three suites** — verified
  exhaustively across all 45 personas. For ledger personas `slug` is absent, so it resolves to the
  YAML filename stem, which also equals the `cc_file_name` stem. One near-miss: standalone
  `developer.yaml` has explicit `slug: developer-standalone` and `cc_file_name: developer-standalone.md`
  — the YAML filename stem (`developer`) differs from both, but the explicit `slug` keeps them aligned.
- **`da_file_name` defaults to `cc_file_name`** — `scripts/build-personas.js` L224 and L308
  (`const daFileName = data.da_file_name || ccFileName;`).

### Structural Observations

- `ai-insights/personas/plugins/ledger/frontmatter-templates.js` (L48): the string
  `'{{number}} - {{role}} v{{version}}'` is the *only* definition of the ledger VS Code agent name,
  and it is a template embedded in a frontmatter blob. Nothing else in the system can read it. Any
  consumer of "what is this agent called" must re-derive the same expression by hand — which
  `scripts/build-personas.js` L249 does, and which the library cannot do at all.
- `ai-insights/personas/persona-build.config.js` (L38) and
  `ai-insights/personas/plugins/ledger/frontmatter-templates.js` (L48) encode two different naming
  rules for the same concept, in two files, with no shared source. This duplication is the
  structural root of Problem A.

### Constraints

- Generated persona output must never be edited directly (`ai-insights/AGENTS.md` Failure Protocol,
  "Generated file needs change" → MUST trace back to suite source).
- `ai-insights/personas/package.json` declares `"@mistralys/persona-builder": "^2.6.0"` and the
  library is installed from the npm registry into `personas/node_modules/` — **not** a workspace
  link. A library change requires a published release before the consumer can adopt it.

---

## Area: Consumer — Problem A, The Dispatch Bug

### Verified References

- **Generated VS Code frontmatter names (the real dispatch identifiers), all nine ledger personas:**
  `1 - Planner v2.4.0`, `2 - Project Manager v3.8.0`, `3 - Developer v3.16.0`, `4 - QA v3.9.1`,
  `5 - Security Auditor v3.9.1`, `6 - Reviewer v3.10.2`, `7 - Release Engineer v3.7.4`,
  `8 - Documentation v3.10.1`, `9 - Synthesis v3.11.0`.
- **What `{{agent_<slug>}}` renders for the same personas:** `1-planner v2.4.0`,
  `2-project-manager v3.8.0`, `3-developer v3.16.0`, `4-qa v3.9.1`, `5-security-auditor v3.9.1`,
  `6-reviewer v3.10.2`, `7-release-engineer v3.7.4`, `8-documentation v3.10.1`,
  `9-synthesis v3.11.0`. **None matches a real agent name.**
- **Exhaustive count of malformed renderings in generated output** (regex
  `[0-9]-[a-z-]+ v[0-9]+\.[0-9]+\.[0-9]+` across all three suites × three targets) — **57 occurrences
  in 6 files**:

  | File | Occurrences |
  |------|-------------|
  | `personas/standalone/vs-code/plan-refiner.agent.md` | 13 (all `1-planner v2.4.0`) |
  | `personas/standalone/claude-code/plan-refiner.md` | 13 (all `1-planner v2.4.0`) |
  | `personas/standalone/deep-agents/plan-refiner.md` | 13 (all `1-planner v2.4.0`) |
  | `personas/ledger-support/vs-code/ledger-claude-coordinator.agent.md` | 10 (8 distinct roles) |
  | `personas/ledger-support/claude-code/ledger-claude-coordinator.md` | 10 |
  | `personas/ledger-support/deep-agents/ledger-claude-coordinator.md` | 10 |

  The coordinator's 10 per file break down as: `2-project-manager` ×3, `3-developer` ×2, and
  `4-qa`, `5-security-auditor`, `6-reviewer`, `7-release-engineer`, `8-documentation`,
  `9-synthesis` ×1 each. The user's report of "lines 81–85+" is confirmed and the full extent is
  the 8-row Agent Dispatch Map table plus 2 additional references.
- **Source-side origin** — only **two source files** produce all 57:
  - `ai-insights/personas/standalone/src/content/plan-refiner.md` — 17 × `{{agent_1_planner}}`
    (13 survive conditionals into each target's output).
  - `ai-insights/personas/ledger-support/src/content/ledger-claude-coordinator.md` —
    4 × `{{agent_2_project_manager}}`, 3 × `{{agent_3_developer}}`, and 1 each of
    `{{agent_4_qa}}`, `{{agent_5_security_auditor}}`, `{{agent_6_reviewer}}`,
    `{{agent_7_release_engineer}}`, `{{agent_8_documentation}}`, `{{agent_9_synthesis}}`.
- `ai-insights/personas/standalone/vs-code/plan-refiner.agent.md` (L43, L234, L239, L251) —
  L43 is a prose summary; L234/L239/L251 are the three broken
  `` Invoke `runSubagent` with `agentName`: `"1-planner v2.4.0"` `` calls the user reported.
- `ai-insights/personas/ledger-support/src/content/ledger-claude-coordinator.md` (L70–83): the
  Agent Dispatch Map table, `| Ledger Role | Agent Name | When |`, with one
  `{{agent_N_role}}` per row.
- **Non-ledger references are correct** — e.g. `personas/standalone/vs-code/plan-refiner.agent.md`
  L232 renders `"Plan Architect Reviewer v2.3.1"`, L238 renders `"Plan Auditor v1.9.1"`, both
  matching real frontmatter names.

### Structural Observations

- The two affected source files are the only ones that reference **ledger** personas via
  `{{agent_*}}`. Complete inventory of `{{agent_*}}` usage (excluding `{{agent_slug_*}}`) across all
  sources is 56 references in 13 files; of those, only the 2 files above target ledger personas.
  The blast radius of Problem A is therefore small and precisely bounded.
- `ai-insights/personas/name-mapping.json` is **not** affected. Verified: the `1-planner` entry
  carries `vscode.agent_name: "1 - Planner v2.4.0"`, `claude_code.agent_name: "1-planner"`,
  `deep_agents.agent_name: "1-planner"`. It is generated by `scripts/build-personas.js` (L249)
  independently of the library's agent map, using the correct `` `${number} - ${data.role} v${version}` ``
  expression. **The MCP server is out of the blast radius.**
- `ai-insights/mcp-server/src/utils/constants.ts` (L204–208): `AGENT_NAMES` is built from
  `personas/name-mapping.json`, filtered to `suite === 'ledger'`, keyed by `entry.role`. Since
  `name-mapping.json` is correct, `AGENT_NAMES` is correct.

### Constraints

- The bug is invisible in source: `{{agent_1_planner}}` reads as correct at the point of use.
  Any fix that does not add a mechanical guard leaves the same defect class open.

---

## Area: Consumer — Problem B, The Display Label

### Verified References

- `ai-insights/personas/ledger-support/src/content/ledger-wp-decomposer.md` — hardcoded ledger role
  names in prose at L7 (`the Project Manager`), L19 (`the Planner`), L23 (`The **Project Manager**`),
  L31 (`The Planner`, `the Plan Refiner's review cycles`), L33 (`the Planner`, `the Project Manager`),
  L85 (`owned by QA`), L101 (`The Planner`, `the Plan Refiner's cycles`), L132 (`The Planner`),
  L215 (`the Project Manager`). Confirms the user's account of the workaround and shows it is used
  ~12 times in this one file, not once.
- **Workspace-wide count of the same workaround** — regex `\b(the|The) (Planner|Project Manager|
  Developer|Reviewer|Release Engineer|Synthesis|Security Auditor)\b` across
  `standalone/src/content`, `ledger-support/src/content`, `shared/partials`: **49 matches across
  9 files**:
  `standalone/src/content/web-gui-specialist.md`, `standalone/src/content/plan-refiner.md`,
  `standalone/src/content/developer.md`, `standalone/src/content/plan-auditor.md`,
  `standalone/src/content/dependency-curator.md`, `standalone/src/content/plan-architect-reviewer.md`,
  `ledger-support/src/content/ledger-wp-decomposer.md`,
  `ledger-support/src/content/ledger-knowledge-archiver.md`,
  `ledger-support/src/content/ledger-doctor.md`.
  This count is an upper bound — some matches are generic English ("the Developer" meaning a human)
  rather than persona references, so each requires individual judgement.
- **Complete `{{agent_*}}` reference inventory** (56 references, 13 files) — the largest consumers
  are `standalone/src/content/plan-refiner.md` (17 + 7 + 7 + 6 = 37 across four agents),
  `ledger-support/src/content/ledger-dependency-sequencer.md` (7 + 1),
  `standalone/src/content/workspace-architect.md` (6 agents × 3), and
  `ledger/src/content/2-project-manager.md` (4 agents × 3).
- **`{{agent_slug_*}}` reference inventory** — 14 references across 5 files:
  `standalone/src/content/workspace-architect.md` (6), `ledger/src/content/2-project-manager.md` (4),
  `ledger/src/content/9-synthesis.md` (1), `standalone/src/content/web-gui-specialist.md` (1),
  `standalone/src/content/developer.md` (1), plus one in `shared/partials/`.
- **Shared partials already use `{{agent_*}}`** — `personas/shared/partials/pm-subagent-roster.md`
  (4 references) and `personas/shared/partials/planner-output-template.md` (2 references:
  `{{agent_plan_auditor}}`, `{{agent_plan_architect_reviewer}}`). Confirms the user's principle that
  a shared partial cannot hardcode a role name.
- `ai-insights/scripts/build-personas.js` (L275–280): `deriveRole(name)` —
  ```js
  function deriveRole(name) {
    return name
      .replace(/\s+\(Standalone\)$/i, '')
      .replace(/\s+\(Ledger Support\)$/i, '')
      .trim();
  }
  ```
  Applied at L315 to non-ledger personas only. Ledger entries use `data.role` directly (L241).
- **`deriveRole()` output is materialised** in `personas/name-mapping.json` as the `role` field —
  verified: `"role": "Ledger Bootstrapper"` for `standalone-ledger-bootstrapper`,
  `"role": "Planner"` for `ledger-1-planner`. A correct display label already exists in the build
  system; it is simply not exposed to templates.

### Established Patterns

- **`role` is the unifying concept** — `name-mapping.json` normalises both metadata shapes to a
  single `role` field: ledger via `data.role`, non-ledger via `deriveRole(name)`. This is the
  existing, working answer to the ledger/non-ledger asymmetry.
- **Suffix stripping is an ai-insights convention** — `(Standalone)` and `(Ledger Support)` are
  ai-insights-specific disambiguators, not a general persona-builder concept.

### Structural Observations

- `ai-insights/scripts/build-personas.js` (L275–280): `deriveRole()` sits inside the
  `if (!CHECK)` name-mapping block (opened at L87), so it does not run in `--check` mode at all.
  Any label logic reusing it must be hoisted out of that block or the check build will diverge from
  the real build.
- `ai-insights/scripts/build-personas.js` L241 (ledger `role: data.role`) and L315
  (non-ledger `role: deriveRole(personaName)`) are the third and fourth places that re-derive
  persona identity, after the two frontmatter templates. Four independent derivations of
  "what is this persona called" now exist in the consumer.

### Constraints

- The `(Standalone)` / `(Ledger Support)` suffix rule cannot move into library code as a hardcoded
  regex — it is an ai-insights convention.

---

## Area: Consumer — Target-Awareness of the Dispatch Name

### Verified References

- **The three targets use three genuinely different dispatch identifiers.** Verified against
  generated frontmatter across all 45 personas × 3 targets:

  | Target | Frontmatter `name` source | Ledger example | Non-ledger example |
  |--------|---------------------------|----------------|--------------------|
  | `vscode` | `'{{number}} - {{role}} v{{version}}'` (ledger plugin) / `'{{name}} v{{version}}'` (config) | `1 - Planner v2.4.0` | `Plan Auditor v1.9.1` |
  | `claude-code` | `{{cc_name}}` → `cc_file_name_stem` (ledger) / `{{cc_name}}` (config) | `1-planner` | `plan-auditor` |
  | `deep-agents` | `{{id}}` (config `FRONTMATTER_DA`) | `ledger-1-planner` | `standalone-plan-auditor` |

  Full verified list of claude-code names: `1-planner`, `2-project-manager`, `3-developer`, `4-qa`,
  `5-security-auditor`, `6-reviewer`, `7-release-engineer`, `8-documentation`, `9-synthesis`,
  `ledger-bootstrapper`, `ledger-claude-coordinator`, `ledger-dependency-sequencer`, `ledger-doctor`,
  `ledger-knowledge-archiver`, `ledger-knowledge-curator`, `ledger-orchestrator-archaeologist`,
  `ledger-orchestrator-runner`, `ledger-pipeline-configurator`, `ledger-wp-decomposer`,
  `standalone-archiver`.
  Full verified list of deep-agents ledger names: `ledger-1-planner`, `ledger-2-pm`, `ledger-3-dev`,
  `ledger-4-qa`, `ledger-5-security-auditor`, `ledger-6-reviewer`, `ledger-7-release-engineer`,
  `ledger-8-docs`, `ledger-9-synthesis`; plus `standalone-plan-auditor`,
  `standalone-ledger-wp-decomposer`.

  **The user's reading was correct: Claude Code frontmatter names are bare stems.** The single
  `{{agent_<slug>}}` variable therefore cannot be right for more than one target at a time.

- **`slug` == `cc_file_name` stem for all 45 personas** (exhaustively verified). Therefore the
  existing `{{agent_slug_<slug>}}` variable *already* renders the correct Claude Code dispatch name
  for every persona in this workspace. No new variable is required for the `claude-code` target —
  though the equality is a coincidence of convention, not a guarantee the library enforces.

- **Deep Agents does not dispatch by frontmatter name at all.**
  `ai-insights/orchestrator/src/utils/subagents.py` (L189–193):
  ```python
  subagents.append({
      "name": slug,
      "description": description,
      "system_prompt": system_prompt,
  })
  ```
  The subagent registration `name` is the **kebab-case slug** read from the dispatching persona's
  YAML `subagents` list (L126, `_extract_yaml_list(ledger_yaml_text, "subagents")`), documented at
  L13 ("**name** — the kebab-case slug itself"). The `{{id}}`-derived frontmatter `name` in
  `personas/*/deep-agents/*.md` is **never read** by the orchestrator's subagent loader — the file
  is consumed for its body as `system_prompt` (L173) and its `description` comes from the YAML
  (L155), not the frontmatter. So for deep-agents the correct dispatch token is the slug, and
  `{{agent_slug_*}}` is already right.

- **Claude Code dispatch in generated output names no agent identifier at all.**
  `personas/standalone/claude-code/plan-refiner.md` L233, L235, L239, L240, L248, L252 all read
  `` Use the `Task` tool with `description: "<name>"` `` — the persona is placed in the `Task`
  tool's **`description`** field, not a `subagent_type` field. Grep for `subagent_type` across
  `personas/shared/partials/` returns zero matches. So the current claude-code output does not
  perform a resolvable dispatch regardless of which name string is substituted.

- **Source-side conditional structure** — `personas/standalone/src/content/plan-refiner.md`
  (L226–247) shows the established pattern:
  ```
  {{#if target_vscode}}
     Invoke `runSubagent` with `agentName`: `"{{agent_plan_architect_reviewer}}"`, …
  {{else}}
     Use the `Task` tool with `description: "{{agent_plan_architect_reviewer}}"`. …
  {{/if}}
  ```
  A single variable is used in **both** branches. The `{{#if target_vscode}}` / `{{else}}` split
  already exists at every dispatch site, so a target-aware variable and a target-conditional
  variable choice are both expressible with no new template machinery.

### Established Patterns

- **`contextFlags` per target** — `src/targets/built-in.ts` injects `target_vscode`,
  `target_claude_code`, `target_deep_agents` booleans. Verified in use throughout the consumer's
  content sources.
- **Target-conditional dispatch blocks** are already the norm in consumer content.

### Structural Observations

- Because the dispatch branch is already target-conditional in the source, the *simplest* correct
  design does not require a target-aware map at all: use `{{agent_<slug>}}` in the vscode branch and
  `{{agent_slug_<slug>}}` in the other branches. That works today for claude-code and deep-agents
  and would work for vscode once Problem A is fixed. A target-aware `agent_*` value is an
  ergonomic improvement, not a correctness requirement.
- `ai-persona-builder/src/builders/persona-builder.ts` (L710) builds the map once, outside the
  target loop. Making the map target-aware requires moving the call inside the loop (three suites ×
  three targets = the pre-scan runs 3× more often) or emitting target-qualified keys in one pass.

### Constraints

- `ai-insights/personas/persona-build.config.js` (L80) builds all three targets on every run, so any
  per-target pre-scan cost is multiplied by three.

---

## Area: Consumer — Build-Time Validation

### Verified References

- `ai-insights/scripts/build-personas.js` (L370–453): the `{{agent_slug_*}}` cross-reference check.
  Runs in **both** real and `--check` builds (comment at L370: "Always"). Scans only
  `personas/ledger/src/content/*.md` for files matching ledger meta `/^\d+-/` (L423–425), extracts
  the persona's `subagents` list via the local `extractSubagentsList()` helper (L378–414), and for
  every `{{agent_slug_([a-z0-9_]+)}}` match (L434) verifies the underscored suffix converted back to
  kebab appears in that list. Errors accumulate, print as a block, and `process.exit(1)` (L451–456).
- **The existing check is scoped to the ledger suite only** (L423: `metaDir` is
  `personas/ledger/src/meta`). Non-ledger `{{agent_slug_*}}` references —
  `standalone/src/content/workspace-architect.md` (6), `standalone/src/content/web-gui-specialist.md` (1),
  `standalone/src/content/developer.md` (1) — are **not** validated by it.
- `ai-insights/scripts/build-personas.js` (L458–476): `validateInsightFieldsInDirs` — an
  error-severity check over all three suite meta dirs, delegating to `scripts/lib/insight-validation.js`.
- `ai-insights/scripts/build-personas.js` (L478–510): `checkPhilosophyToneInDirs` — a
  warn-only check over all three content dirs plus `shared/partials`.
- `ai-insights/scripts/build-personas.js` (L512+): `checkChangelogEntrySize` — warn-only.
- `ai-insights/scripts/build-personas.js` (L31–51): pre-build cleanup deletes `*.md` from all
  configured output dirs, skipped in `--check` mode.
- `ai-insights/scripts/build-personas.js` (L56–62): delegates the build to the library CLI via
  `execFileSync`.
- `ai-insights/scripts/build-personas.js` (L64–85): post-build version sync, real builds only.
- `ai-insights/scripts/build-personas.js` (L87–368): `name-mapping.json` generation, real builds only.

### Established Patterns

- **`scripts/lib/*.js` extracted-validator pattern** — `insight-validation.js`, `philosophy-tone.js`,
  `changelog-size-check.js` each export a single-item function and a batch `*InDirs` function, and
  are called from a labelled block in `build-personas.js`. This is the established home for a new
  check.
- **Error checks exit 1; heuristic checks warn** — documented in `ai-insights/AGENTS.md` Root-Level
  Tooling table for each `scripts/lib/` entry.
- **The `[ERROR] … \n process.exit(1)` block shape** is consistent across all three error checks.

### Structural Observations

- `ai-insights/scripts/build-personas.js` (L423–425): the ledger-only scoping of the
  `{{agent_slug_*}}` check is an unexplained narrowing — 8 non-ledger references go unvalidated. The
  check is already written generically apart from the directory constants.
- `ai-insights/scripts/build-personas.js` (L370–456): the check validates references against a
  *declaration list* (`subagents` in YAML), never against *generated output*. No existing check
  compares any rendered string to the actual frontmatter of the persona it names. This is precisely
  the gap that let Problem A ship — the reference `{{agent_1_planner}}` is well-formed, the slug
  resolves, the `subagents` list would accept it; nothing in the pipeline asks whether the produced
  string names a real agent.
- `ai-insights/scripts/build-personas.js` (L87): the `if (!CHECK)` guard wrapping name-mapping
  generation means the correct per-target agent names are computed **only in real builds**. A new
  frontmatter-divergence guard that wants to reuse that computation must either run only in real
  builds (weaker) or hoist the computation.

### Constraints

- The check must run in `--check` mode to be useful in CI and the pre-commit hook.
  `ai-insights/AGENTS.md` records the pre-commit hook as covering "persona freshness, version sync,
  ruff lint, CTX staleness warning, changelog drift warning" via `scripts/install-hooks.js`.
- Cross-platform policy (`ai-insights/AGENTS.md` § Cross-Platform Policy rule 3): root-level scripts
  must not rely on Unix-only utilities; Node built-ins only.

---

## Area: Consumer — Documentation Surfaces

### Verified References

- `ai-insights/personas/docs/agents/project-manifest/` contains 9 documents: `README.md`,
  `api-surface.md`, `constraints.md`, `constraints-build-system.md`, `constraints-cross-system.md`,
  `data-flows.md`, `file-tree.md`, `tech-stack.md`, `variables.md`.
- `ai-insights/personas/docs/agents/project-manifest/variables.md` (L16): merge-order row 4 —
  "Cross-suite agent map | `agent_<slug>` and `agent_slug_<slug>` keys for all personas".
- `variables.md` (L138–139): the two-row variable table with worked examples
  (`{{agent_wp_decomposer}}` → `"WP Decomposer v1.0.7"`).
- `variables.md` (L141): key-derivation rule. (L144–145): usage guidance —
  "Reference another persona by display name in prose: `Delegate to {{agent_wp_decomposer}}`" and
  "Invoke a sub-agent in Deep Agents target: `task(subagent={{agent_slug_wp_decomposer}})`".
- `variables.md` (L149): documents the blocking `subagents` validation.
- `variables.md` (L161): worked example for `ledger-knowledge-archiver`.
- `variables.md` (L224–225): quick-reference rows for both variables.
- `ai-insights/personas/docs/agents/project-manifest/api-surface.md` (L25): describes the
  `name-mapping.json` post-build step and its per-target `agent_name` fields.
- `api-surface.md` (L29): describes the `{{agent_slug_*}}` cross-reference validation.
- `api-surface.md` (L158): the `{{agent_<slug>}}` context-variable row, describing it as
  "Display name for any agent across all configured suites … Used in templates that invoke
  sub-agents via `runSubagent`."
- `api-surface.md` (L448): the `subagents` metadata field row.
- `api-surface.md` (L584): `planner-output-template.md` partial row, noting its embedded
  `{{agent_plan_auditor}}` / `{{agent_plan_architect_reviewer}}`.
- `api-surface.md` (L702–704): `name-mapping.json` per-target block shape.
- `ai-insights/personas/docs/agents/project-manifest/constraints-build-system.md` (L86):
  constraint 9 — the `{{agent_slug_*}}` ↔ `subagents` rule.
- `ai-insights/AGENTS.md` (L257): the "Agent name mapping" cross-system dependency row, naming
  `personas/name-mapping.json` as regenerated by `build-personas.js` and consumed by
  `mcp-server/src/utils/constants.ts` → `AGENT_NAMES`.

### Structural Observations

- `variables.md` (L144) currently instructs authors to use `{{agent_<slug>}}` "in prose" — this is
  the documented guidance that produced the Problem B workaround, since the variable carries a
  version suffix unsuitable for prose. The document actively recommends the wrong thing.
- `api-surface.md` (L158) describes `{{agent_<slug>}}` as serving both prose display *and*
  `runSubagent` invocation. Conflating the two roles in the documentation mirrors the conflation in
  the implementation.

### Constraints

- `ai-insights/AGENTS.md` Manifest Maintenance Rules (Personas table): "Add/remove template partial"
  → `api-surface.md`; "Add/remove feature flag" → `api-surface.md`; "Change template syntax" →
  `api-surface.md`; "Modify sync script behavior" → `constraints.md`, `data-flows.md`.
- `ai-insights/AGENTS.md` Root-Level/Cross-Project rules: "Add root-level script" → root `README.md`;
  "Restructure workspace" → regenerate `.context/`.
- The `.context/` directory is regenerated via `node scripts/cli.js ctx-generate` and is tracked in
  Git. `git status` currently shows ~20 modified `.context/` files, so the consumer working tree is
  also not clean.

---

## Area: Versioning and Release Sequencing

### Verified References

- `ai-persona-builder/CHANGELOG.md` head: `## v2.6.1 - Bundle Documentation`.
- `ai-persona-builder/package.json` → `version: 2.5.1`.
- `ai-insights/personas/package.json` → `"@mistralys/persona-builder": "^2.6.0"`, own version `3.32.0`.
- `ai-insights/personas/node_modules/@mistralys/persona-builder/package.json` → `2.6.0` (installed
  from registry; `personas/node_modules/@mistralys/` contains only `persona-builder`, no symlink).
- `ai-insights/personas/changelog.md` head: `## v3.32.0 - **WIP UNRELEASED**`.
- `ai-insights/AGENTS.md` § Changelog Convention: hub-and-spoke model; only the root
  `ai-insights/changelog.md` is Git-tagged; module changelogs come first; personas changelog is
  summary-only (rule 8) with a one-bullet-per-theme guardrail.
- `ai-insights/AGENTS.md` Cross-System Dependencies: "Version (Personas)" — source of truth is
  `personas/changelog.md`, must stay in sync with `personas/ledger/src/meta/_shared.yaml` →
  `default_version`.

### Structural Observations

- The library's `package.json` version (2.5.1) lags its `CHANGELOG.md` (2.6.1) by two releases while
  the published registry artefact is 2.6.0. The repo's own `release-check` skill exists to catch
  exactly this. Landing a new library version on top of this drift risks publishing a wrong version
  number.

### Constraints

- The consumer resolves the library from the npm registry, so **every library change requires a
  publish before the consumer can consume it**. There is no file: or workspace link to shortcut
  this during development, though `npm link` is available as a local verification path.
- Both working trees carry uncommitted changes (library: 3 docs files; consumer: ~20 `.context/`
  files plus others), so work must be sequenced to avoid entangling unrelated edits.
