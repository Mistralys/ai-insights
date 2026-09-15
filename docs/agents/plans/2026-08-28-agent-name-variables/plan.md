# Plan

## Summary

The `@mistralys/persona-builder` library builds a cross-suite agent map whose display value is
hardcoded as `` `${name} v${version}` ``. The `ai-insights` ledger personas carry no `name:` field,
so `{{agent_1_planner}}` renders `1-planner v2.4.0` while the persona's real dispatchable VS Code
name is `1 - Planner v2.4.0` — produced by an entirely separate expression in the consumer's
ledger frontmatter template. The result is 57 unresolvable agent references across 6 generated
files (**Problem A**, a live dispatch bug). The same single variable is also the only one available
for prose, so authors needing a bare role name have hardcoded literals instead (**Problem B**).

Research established a third fact that reframes both: the three build targets use three genuinely
different dispatch identifiers (`1 - Planner v2.4.0` / `1-planner` / slug-based registration), so a
single target-independent variable cannot be correct for more than one target at a time.

This plan replaces the library's hardcoded naming policy with a **configurable template chain**
resolved per target, adds a companion `agent_label_<slug>` variable for prose, and adds a build-time
guard in the consumer that fails when a rendered agent reference names no real agent. Problem A is
separable and lands first via a consumer-only hotfix that needs no library release.

---

## Architectural Context

### Library — `@mistralys/persona-builder` v2.5.1/2.6.x

Layered: `builders/` → `plugins/` → `engine/` / `loaders/` / `validators/` / `targets/`.

- `src/builders/persona-builder.ts` L194–232 — `buildAgentNameMap(config)` performs the cross-suite
  pre-scan and emits two keys per persona: `agent_<underscored_slug>` = `` `${name} v${version}` ``
  and `agent_slug_<underscored_slug>` = the raw slug.
- `src/builders/persona-builder.ts` L710 — `build()` calls it **once, before** the
  `for (const target of targets)` loop at L713. The map is target-independent by construction.
- `src/builders/persona-builder.ts` L359–363 — agent-map entries are injected **non-overridingly**
  (`if (!(key in merged))`), so a persona's own YAML field of the same name wins. This is a tested
  contract (`tests/builders/agent-name-map.test.ts` L376–421).
- `src/targets/types.ts` L18–66 — `TargetDefinition` (`name`, `outputDirKey`, `filenameContextKey`,
  `defaultFrontmatter`, `contextFlags`, `defaultEnabled`) is the established per-target extension
  seam; `src/targets/built-in.ts` L38–66 registers the three built-in targets.
- `src/engine/variables.ts` L28–43 — `resolveVariables()` matches `\{\{(\w+)\}\}` and emits
  `[WARN] Unresolved variable` to stderr for misses. Engine layer is zero-dependency by contract.

### Consumer — `ai-insights` persona suite

- `personas/persona-build.config.js` L80 builds all three targets; L88–113 defines three suites —
  `ledger` (`personaMode: 'numbered'`), `standalone` and `ledger-support` (`'standalone'`).
- Two independent naming rules exist for the same concept:
  `personas/plugins/ledger/frontmatter-templates.js` L48 → `name: '{{number}} - {{role}} v{{version}}'`
  and `personas/persona-build.config.js` L38 → `name: '{{name}} v{{version}}'`.
- Two more re-derivations live in `scripts/build-personas.js`: L249
  (`` `${number} - ${data.role} v${version}` ``) and L315 (`deriveRole(personaName)`), both inside
  the `if (!CHECK)` name-mapping block opened at L87.
- `scripts/build-personas.js` L370–456 validates `{{agent_slug_*}}` against each persona's
  `subagents` list, in both real and `--check` builds, but is scoped to the ledger suite only
  (L423). It validates references against a *declaration list*, never against generated output.
- `scripts/lib/insight-validation.js`, `philosophy-tone.js`, `changelog-size-check.js` establish the
  extracted-validator pattern: a single-item function plus a batch `*InDirs` function, invoked from
  a labelled block in `build-personas.js`.

---

## Approach / Architecture

### 1. Split the pre-scan into descriptor collection and per-target rendering

`buildAgentNameMap()` is restructured into two phases inside `src/builders/persona-builder.ts`:

- **Phase 1 — `collectAgentDescriptors(config)`** (new, runs once): walks all suites, loads each
  persona YAML, and returns `AgentDescriptor[]` where each descriptor carries the resolved `slug`,
  the resolved `version`, the owning suite name, and the raw metadata record. This is the file-I/O
  half and its cost is unchanged.
- **Phase 2 — `renderAgentMap(descriptors, target, agentNames)`** (new, runs per target): pure
  string rendering over the descriptors, producing the `Record<string, string>` map. No I/O.

`build()` calls phase 1 once before the target loop (replacing the current L710 call) and phase 2
inside the loop. Target-awareness therefore costs three cheap string passes, not three filesystem
pre-scans.

### 2. Replace the hardcoded value format with a template chain

A new `AgentNameConfig` on `BuildConfig` (and overridable per `SuiteConfig`):

```ts
interface AgentNameConfig {
  /** Templates for `agent_<slug>` — a single chain, or a per-target map of chains. */
  name?: string[] | Record<string, string[]>;
  /** Templates for `agent_label_<slug>`. */
  label?: string[];
}
```

Each entry is a template string resolved against the descriptor's metadata plus the computed `slug`
and `version`. **The first template whose variables all resolve wins** — mirroring the precedence
chain the library already uses for frontmatter templates
(`docs/agents/project-manifest/constraints.md` § Known Limitations 5).

Defaults preserve current behaviour exactly: `name: ['{{name}} v{{version}}']`,
`label: ['{{name}}']`. Existing consumers see no change.

Chain resolution uses a new `resolveFirstTemplate()` helper in `src/builders/` — **not**
`resolveVariables()`, because a non-matching chain entry is an expected outcome and must not emit
`[WARN] Unresolved variable` to stderr.

### 3. Add `agent_label_<slug>` as a third map key

Emitted alongside the existing two, from the `label` chain. Version-free by construction, intended
for prose. Naming rationale in Considered Alternatives.

### 4. Consumer config expresses both naming rules declaratively

`personas/persona-build.config.js` gains one block that replaces four scattered derivations:

```js
agentNames: {
  name: {
    vscode:        ['{{number}} - {{role}} v{{version}}', '{{name}} v{{version}}'],
    'claude-code': ['{{slug}}'],
    'deep-agents': ['{{slug}}'],
  },
  label: ['{{label}}', '{{role}}', '{{name}}'],
},
```

The chain resolves the ledger/non-ledger asymmetry without any suite-specific configuration: ledger
personas have `number` + `role` and match the first `vscode` entry; non-ledger personas lack
`number` and fall through to the second. For labels, ledger matches `{{role}}` and non-ledger
matches `{{name}}`, with `{{label}}` reserved as a per-persona override.

### 5. Retire `deriveRole()` in favour of an explicit `label:` field

`deriveRole()` (`scripts/build-personas.js` L275–280) strips `(Standalone)` and `(Ledger Support)`.
Only three personas carry such a suffix (`Developer (Standalone)`, `Documentation (Standalone)`,
`Planner (Standalone)`), and the `(Ledger Support)` branch matches nothing at all. Three explicit
`label:` fields replace a regex that silently applies to all 36 non-ledger personas.

### 6. Build-time guard against name/frontmatter divergence

The per-target identity computation in `scripts/build-personas.js` L241–260 / L315–350 is hoisted
out of the `if (!CHECK)` block into a new `scripts/lib/agent-identity.js`, giving one canonical
per-target identity table available in **both** build modes. Two consumers use it:

- `name-mapping.json` generation (real builds) — unchanged output, one fewer derivation.
- A new `scripts/lib/agent-name-check.js` (both modes) — reads generated output, asserts each
  file's frontmatter `name` equals the computed identity for that persona/target, then scans
  dispatch call sites and fails on any agent reference that matches no identity in the table.

The second assertion is the one that would have caught Problem A: `1-planner v2.4.0` is a
well-formed reference to a resolvable slug that names no agent.

---

## Rationale

**Why a template chain rather than a callback.** A `(persona, target) => string` function on
`BuildConfig` would be more expressive and shorter to implement. It was rejected because it makes
the naming policy opaque to every tool other than the build itself — the same failure mode that
caused Problem A, where the rule lived in a frontmatter blob nothing else could read. Template
strings are inspectable data: the guard in step 6, a future linter, and a human reading the config
can all see the rule.

**Why target-aware.** Research established the three targets use three different identifiers
(`1 - Planner v2.4.0` / `1-planner` / slug registration). This is not a preference — a single
target-independent value is provably wrong for at least two of the three targets. Making the map
target-aware also lets authors write one variable at a dispatch site instead of splitting on
`{{#if target_vscode}}` purely to pick a name spelling.

**Why additive rather than a fix-in-place rename.** Preserving `['{{name}} v{{version}}']` as the
default means the library change is non-breaking for its other consumers, and ai-insights fixes its
own bug through configuration. No deprecation cycle is needed because the variable keeps both its
name and its meaning; only its *derivation* becomes configurable.

**Why hoist the identity computation.** It is already the fourth derivation of persona identity in
the consumer. Leaving it inside `if (!CHECK)` would mean the new guard either runs only in real
builds (useless for pre-commit and CI) or re-implements the derivation a fifth time.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| How the library learns the naming rule | Template-string chain in `BuildConfig.agentNames` | (a) `nameFormat: (persona, target) => string` callback; (b) single template string per suite, no chain; (c) library reads the target's `defaultFrontmatter` and extracts its `name:` line | The callback is more expressive but opaque to tooling — the exact property whose absence caused Problem A. A single non-chained template forces per-suite config blocks and cannot express the ledger/non-ledger fallback in one place. Extracting from frontmatter is clever but couples the map to frontmatter template syntax and breaks the moment a consumer's `name:` line is conditional. |
| Target-awareness of `agent_<slug>` | Per-target chain map; map rendered inside the target loop | (a) Keep target-independent and use `{{agent_slug_*}}` in non-vscode branches; (b) emit target-qualified keys `agent_vscode_<slug>`; (c) build the whole map three times | (a) is genuinely correct today — `slug` equals the claude-code stem for all 45 personas and equals the deep-agents subagent registration name — and needs no library change, but it leaves authors choosing between two variables by target and re-breaks if a slug ever diverges from a cc stem. (b) triples template verbosity at every call site. (c) triples pre-scan I/O; the descriptor split gets the same result for three string passes. |
| Name for the display variable | `agent_label_<slug>` | (a) `agent_role_<slug>`; (b) `agent_name_<slug>`; (c) `agent_display_<slug>`; (d) reuse `agent_<slug>` and move the version into a separate `agent_version_<slug>` | `agent_role_` reads well for ledger but is actively wrong for standalone personas, whose value derives from `name` and which carry no `role` field at all. `agent_name_` invites confusion with `agent_` itself. `agent_display_` is accurate but longer with no gain. (d) is the cleanest conceptual split but is a breaking change to a variable used 56 times in this consumer and unknown times elsewhere. `agent_label_` is parallel to the existing `agent_slug_` prefix and signals "for display, not dispatch". |
| Resolving the ledger/non-ledger label asymmetry | Chain `['{{label}}', '{{role}}', '{{name}}']` + explicit `label:` on 3 personas | (a) Move `deriveRole()`'s suffix-stripping regex into the library; (b) per-suite `label` template; (c) add `label:` to all 36 non-ledger personas; (d) add `role:` to all non-ledger personas | (a) hardcodes an ai-insights convention into a library used by unrelated projects — explicitly forbidden. (b) works but needs three config blocks and still cannot handle the three suffixed standalone personas. (c) is 36 files of churn to express what a 3-entry chain expresses once. (d) collides conceptually with the ledger plugin's manifest-validated `role` field. |
| Breaking vs. additive library change | Additive; defaults unchanged | Rename `agent_<slug>` → `agent_dispatch_<slug>` with a deprecation window | A rename would make the dispatch/display distinction explicit in both names, but breaks every existing consumer's templates for a clarity gain that documentation delivers for free. The variable's *meaning* is not changing — only its derivation becomes configurable. |
| Guard against Problem A's defect class | Compare generated frontmatter + dispatch references against a computed identity table | (a) No guard, rely on the fixed derivation; (b) extend the existing `{{agent_slug_*}}` ↔ `subagents` check; (c) library-side `onValidate` plugin | (a) leaves the defect class open — the bug was invisible in source and survived every existing check. (b) validates against a *declaration list*, which would have accepted `1-planner v2.4.0` as valid. (c) is the right long-term home but depends on the unimplemented `onPreRender` hook (`constraints.md` § Sub-Agent Validation Constraints 5); the workspace script remains the pragmatic home, exactly as that document states. |
| Where the hoisted identity table lives | New `scripts/lib/agent-identity.js` | Inline export from `build-personas.js`; extend `scripts/lib/yaml-utils.js` | `build-personas.js` is a top-to-bottom script with side effects at import time, so it cannot be imported by a validator. `yaml-utils.js` is a parsing-primitives module; identity derivation is domain logic. A new one-domain-per-file module matches the established `scripts/lib/` pattern. |

---

## Pattern Alignment

**Followed:**

- **Precedence-chain resolution** — `resolveFrontmatterTemplate()` already resolves the frontmatter
  template through an ordered fallback chain (`constraints.md` § Known Limitations 5). The agent
  name chain is the same idea applied to a different artefact.
- **Per-target declarative configuration** — `src/targets/types.ts` L83–120 expresses per-target
  output shape as template strings. `agentNames.name` keyed by target name follows that convention.
- **Non-overriding agent-map injection** — `src/builders/persona-builder.ts` L359–363. The new
  `agent_label_*` keys are injected through the same loop and inherit the same escape hatch.
- **`scripts/lib/` extracted validators** — `insight-validation.js`, `philosophy-tone.js`,
  `changelog-size-check.js`. Both new consumer modules follow the single-item + batch export shape
  and are invoked from a labelled block in `build-personas.js`.
- **Error checks exit 1, heuristic checks warn** — the frontmatter-divergence assertion is
  deterministic and therefore an error; see Constraints for the one heuristic sub-check.
- **Zero-dependency engine** — `resolveFirstTemplate()` needs no I/O and could live in `src/engine/`,
  but it is placed in `src/builders/` alongside the only code that calls it, matching how
  `resolveFrontmatterTemplate()` is sited in `src/builders/frontmatter.ts`.

**Deliberate departures:**

- **A second variable-substitution path outside `resolveVariables()`.** The library has exactly one
  substitution function today. `resolveFirstTemplate()` adds a second, because chain resolution
  requires distinguishing "unresolved" from "warn about unresolved" — `resolveVariables()` L40
  unconditionally logs. Justified: the alternative is a silent-mode flag on `resolveVariables()`,
  which would widen an engine-layer signature used on every render for the benefit of one caller.
  `resolveFirstTemplate()` must reuse the identical `\{\{(\w+)\}\}` pattern; step 3 records this as
  a documented invariant with a paired test.

---

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `ai-persona-builder/src/builders/persona-builder.ts` L194–232 `buildAgentNameMap()` | Hardcodes the value format `` `${name} v${version}` `` with no configuration seam — the direct cause of Problem A | Promoted to step 2 | This is the defect; a fix that leaves the policy hardcoded fixes nothing. |
| `ai-persona-builder/src/builders/persona-builder.ts` L710 | Single pre-loop call makes target-awareness structurally impossible | Promoted to step 1 | Splitting into descriptor collection + per-target rendering is prerequisite to the target-aware design and reduces the marginal cost of a third target to a string pass. |
| `ai-persona-builder/src/builders/persona-builder.ts` L215 | Dead `name` fallback: `loadPersonaYaml()` L131 already defaults `name` to the filename stem, so `?? slug` at L215 is unreachable, and the two fallbacks disagree (stem vs. slug) | Promoted to step 3 | The descriptor refactor rewrites this exact expression. Leaving two disagreeing fallbacks in code being rewritten preserves a latent bug for free. |
| `ai-insights/personas/plugins/ledger/frontmatter-templates.js` L48 + `personas/persona-build.config.js` L38 | Two independent encodings of "what is this persona called", in two files, with no shared source | Rejected | Unifying the frontmatter templates themselves means restructuring the ledger plugin's `onSuiteInit` template injection, which is outside this plan's blast radius. Step 4 removes the *third and fourth* derivations and makes the config block the readable source of truth; collapsing the remaining two frontmatter templates is a follow-up. Recorded in Deferred Items. |
| `ai-insights/scripts/build-personas.js` L241–260, L315–350 | Third and fourth re-derivations of persona identity, both trapped inside `if (!CHECK)` so they cannot serve a check-mode validator | Promoted to step 8 | The new guard needs this table in both modes. Hoisting removes two derivations rather than adding a fifth. |
| `ai-insights/scripts/build-personas.js` L275–280 `deriveRole()` | Applies suffix-stripping to all 36 non-ledger personas to serve 3; the `(Ledger Support)` branch matches nothing | Promoted to step 7 | Three explicit `label:` fields are cheaper to reason about than an implicit regex, and the chain design needs the field anyway. |
| `ai-insights/scripts/build-personas.js` L423–425 | The `{{agent_slug_*}}` cross-reference check is scoped to the ledger suite; 8 non-ledger references in 3 files go unvalidated | Promoted to step 10 | The check is already generic apart from two directory constants, the plan is editing this exact block, and the gap is a silent one. |
| `ai-insights/personas/standalone/src/content/plan-refiner.md`, `personas/ledger-support/src/content/ledger-claude-coordinator.md` | Carry all 57 malformed renderings | Promoted to steps 5 and 12 | These are Problem A's only two sources. |
| `ai-insights/personas/ledger-support/src/content/ledger-wp-decomposer.md` and 8 further content files | ~49 candidate hardcoded role literals in prose | Promoted to step 13 | Problem B's motivating case; the shared-partial instances in particular cannot be left hardcoded. |
| `ai-persona-builder/docs/metadata-reference.md` L190–199 | Auto-derived context table documents `{{agent_<slug>}}` but omits `{{agent_slug_<slug>}}` | Promoted to step 14 | Adding a third variable to a table already missing the second compounds the gap in a document this plan must edit regardless. |
| `ai-insights/personas/docs/agents/project-manifest/variables.md` L144 | Instructs authors to use `{{agent_<slug>}}` "in prose" — the guidance that produced the Problem B workaround | Promoted to step 15 | Fixing the variables while leaving the doc recommending the wrong one guarantees recurrence. |
| `ai-persona-builder` `package.json` 2.5.1 vs `CHANGELOG.md` 2.6.1 vs published 2.6.0 | Version drift across three sources of truth | Promoted to step 0 | Publishing on top of this drift risks shipping a wrong version number; the consumer's `^2.6.0` range makes the mismatch consequential. |
| `ai-insights/personas/*/claude-code/*.md` dispatch sites | Render `` Task tool with `description: "<name>"` `` — the agent identifier lands in `description`, and no `subagent_type` appears anywhere in the suite | Rejected | Verified as fact but not as a defect: confirming that Claude Code selects subagents via `subagent_type` requires knowledge outside this codebase, and the correction would rewrite every claude-code dispatch branch — well beyond this plan's blast radius. Recorded in Deferred Items and flagged in the handoff. |

---

## Detailed Steps

### Phase 0 — Prerequisites

1. **Resolve the library version drift.** In `ai-persona-builder`, reconcile `package.json`
   (`2.5.1`), `CHANGELOG.md` (`## v2.6.1`), and the published registry version (`2.6.0`); run the
   repo's `release-check` skill. Commit the three already-modified docs files
   (`docs/agents/project-manifest/README.md`, `docs/agents/project-manifest/constraints.md`,
   `docs/metadata-reference.md`) separately **before** starting step 1, so the plan's docs edits
   land on a clean base. Do not begin library code changes until both are done.

### Phase A — Problem A hotfix (consumer only, no library release)

2. **Land the immediate dispatch fix.** In `personas/standalone/src/meta/plan-refiner.yaml` and
   `personas/ledger-support/src/meta/ledger-claude-coordinator.yaml`, add explicit
   `agent_<underscored_slug>` YAML fields for each referenced ledger persona, exploiting the tested
   non-overriding injection at `src/builders/persona-builder.ts` L359–363 (e.g.
   `agent_1_planner: "1 - Planner v2.4.0"`). Rebuild and confirm all 57 malformed renderings are
   gone. Mark each field with a comment naming this plan folder as the removal trigger — these are
   version-bearing literals that will go stale and **must** be deleted in step 12.

### Phase B — Library change

3. **Introduce the descriptor phase.** In `src/builders/persona-builder.ts`, add an exported-internal
   `AgentDescriptor` type (`slug`, `version`, `suiteName`, `meta: Record<string, unknown>`) and
   `collectAgentDescriptors(config): Promise<AgentDescriptor[]>`, lifting the suite walk and
   `_shared.yaml` / `default_version` resolution from the current L194–232 body. Resolve `slug` from
   `persona['slug']` falling back to the filename stem, and drop the unreachable `?? slug` name
   fallback at L215, letting `loadPersonaYaml()`'s L131 stem default stand as the single rule.
4. **Add chain resolution.** Add `resolveFirstTemplate(templates: string[], context): string | undefined`
   to `src/builders/` — returns the first template whose every `{{var}}` resolves against the
   context, or `undefined` when none does. It must use the identical `\{\{(\w+)\}\}` pattern as
   `src/engine/variables.ts` L33 and must not log. Add a source comment stating the pattern-parity
   requirement, paired with the test in the Test Plan.
5. **Add `AgentNameConfig` and render the map per target.** Add the `AgentNameConfig` interface, an
   optional `agentNames` field on both `BuildConfig` and `SuiteConfig` (suite overrides config), and
   `renderAgentMap(descriptors, target, agentNames)` producing `agent_<slug>`,
   `agent_slug_<slug>`, and `agent_label_<slug>`. Resolve each descriptor's chain against
   `{ ...descriptor.meta, slug, version }`. Select the `name` chain by target when `name` is a
   per-target map, falling back to any `default` key then to the built-in default. Defaults:
   `name: ['{{name}} v{{version}}']`, `label: ['{{name}}']`. When a chain resolves to `undefined`,
   fall back to the default chain, then to the slug; never emit a key containing a literal `{{`.
6. **Wire it into `build()`.** Replace the L710 `buildAgentNameMap(config)` call with a
   `collectAgentDescriptors(config)` call, and call `renderAgentMap()` inside the
   `for (const target of targets)` loop at L713 before `buildSuite()`. Keep `buildAgentNameMap()` as
   a thin wrapper over both phases if any test or export references it; otherwise remove it.
7. **Confirm subagent validation still resolves.** `validateSubagentRefs()`
   (`src/builders/persona-builder.ts` L398–401) reads `agent_slug_*` keys from the map it is passed.
   Verify it now receives the per-target map and that `agent_slug_*` values are target-invariant.

### Phase C — Consumer adoption

8. **Add the `label:` field and retire `deriveRole()`.** Add `label:` to the three suffixed
   standalone personas — `personas/standalone/src/meta/developer.yaml` (`label: Developer`),
   `documentation-curator.yaml` (`label: Documentation`), `planner.yaml` (`label: Planner`). Delete
   `deriveRole()` from `scripts/build-personas.js` L275–280 and its call at L315.
9. **Hoist the identity table.** Create `scripts/lib/agent-identity.js` exporting
   `buildAgentIdentityTable(root)` → per-persona records of `{ slug, id, suite, role, label, version,
   vscode, claude_code, deep_agents }` where each target block carries `{ file_name, agent_name }`.
   Move the ledger derivation from `scripts/build-personas.js` L241–260 and the non-ledger
   derivation from L315–350 into it verbatim except for the `deriveRole()` removal, and consume
   `label:` where present. Rewrite the `name-mapping.json` block (L87–368) to consume this table so
   its output is byte-identical.
10. **Configure the naming chains.** Add the `agentNames` block from Approach §4 to
    `personas/persona-build.config.js`.
11. **Add the divergence guard.** Create `scripts/lib/agent-name-check.js` exporting
    `checkAgentNames(root, identityTable)`. It (a) reads each generated file's frontmatter `name` and
    asserts equality with the computed identity for that persona/target, and (b) scans generated
    files for agent references at dispatch call sites and fails on any that matches no identity in
    the table. Invoke it from a labelled `[ERROR]`/`process.exit(1)` block in
    `scripts/build-personas.js` that runs in **both** real and `--check` modes, following the shape
    of the existing block at L451–456. Node built-ins only — no Unix shell dependencies
    (`AGENTS.md` § Cross-Platform Policy rule 3).
12. **Broaden the `{{agent_slug_*}}` cross-reference check.** In `scripts/build-personas.js`
    L423–425, extend the check's directory constants from the ledger suite alone to all three suite
    `meta`/`content` pairs, and relax the `/^\d+-/` filename filter. Add `subagents` declarations to
    any non-ledger persona whose newly-validated references now fail.

### Phase D — Content migration

13. **Remove the Phase A hotfix and fix the sources properly.** Delete the temporary
    `agent_<slug>` YAML overrides added in step 2. Confirm
    `personas/standalone/src/content/plan-refiner.md` (17 `{{agent_1_planner}}` references) and
    `personas/ledger-support/src/content/ledger-claude-coordinator.md` (11 references across 8
    ledger personas, including the Agent Dispatch Map table at L70–83) now render correct per-target
    dispatch names with no source edits. Where the `{{#if target_vscode}}` / `{{else}}` split at a
    dispatch site now exists *only* to vary the agent name spelling, collapse it to a single branch.
14. **Replace hardcoded role literals with `{{agent_label_*}}`.** Work through the 49 candidate
    matches across the 9 files identified in the research brief, starting with
    `personas/ledger-support/src/content/ledger-wp-decomposer.md` (~12 instances at L7, L19, L23,
    L31, L33, L85, L101, L132, L215). Each match requires individual judgement — some are generic
    English ("the developer") rather than persona references. Prioritise
    `personas/shared/partials/` instances, which are cross-suite by definition and cannot correctly
    carry a literal. Add each newly-referenced slug to the persona's `subagents` list where step 12's
    broadened check now requires it.

### Phase E — Release

15. **Library docs.** Per the Documentation Updates section.
16. **Library changelog + publish.** Add a minor-version entry to `ai-persona-builder/CHANGELOG.md`,
    sync `package.json`, run `npm test` and `npm run typecheck`, publish.
17. **Consumer dependency bump.** Raise `@mistralys/persona-builder` in
    `personas/package.json` to the new minor, reinstall, and run a full
    `node scripts/build-personas.js` followed by `--check` to confirm a clean, idempotent build.
18. **Consumer docs + changelogs.** Per the Documentation Updates section. Add a summary-only entry
    to `personas/changelog.md` (`AGENTS.md` § Changelog Convention rule 8 — one bullet per theme),
    then a root `ai-insights/changelog.md` entry referencing module versions. Regenerate `.context/`
    via `node scripts/cli.js ctx-generate`.

---

## Dependencies

- Steps 3–7 must complete before step 10; the consumer cannot configure an option the library does
  not expose.
- Step 16 (publish) must complete before step 17 (bump) — the consumer resolves the library from the
  npm registry, not a workspace link. `npm link` is available for local verification of steps 10–14
  before publish.
- Step 9 must precede step 11; the guard consumes the hoisted identity table.
- Step 13 must follow step 17; the hotfix overrides mask the real fix until the new library is in
  place.
- Step 0 must precede all others in the library repo.
- Step 2 is independent of every other step and may land immediately.

---

## Required Components

**New — library (`ai-persona-builder`):**
- `AgentDescriptor` type and `collectAgentDescriptors()` — in `src/builders/persona-builder.ts`
- `renderAgentMap()` — in `src/builders/persona-builder.ts`
- `resolveFirstTemplate()` — in `src/builders/` (new file or alongside the above)
- `AgentNameConfig` interface — in `src/builders/types.ts` or `src/plugins/types.ts` alongside
  `BuildConfig` / `SuiteConfig`
- `tests/builders/agent-label-map.test.ts`
- `tests/builders/agent-name-templates.test.ts`

**New — consumer (`ai-insights`):**
- `scripts/lib/agent-identity.js`
- `scripts/lib/agent-name-check.js`
- `scripts/tests/agent-identity.test.js` and `scripts/tests/agent-name-check.test.js`

**Modified — library:**
- `src/builders/persona-builder.ts` (L194–232, L359–363, L710–717)
- `src/builders/types.ts` / `src/plugins/types.ts` (`BuildConfig`, `SuiteConfig`)
- `src/index.ts` (barrel, if new types are public)
- `tests/builders/agent-name-map.test.ts`, `tests/integration/build.test.ts`
- `CHANGELOG.md`, `package.json`

**Modified — consumer:**
- `personas/persona-build.config.js`
- `scripts/build-personas.js` (L87–368, L275–280, L315, L423–425, plus a new validation block)
- `personas/standalone/src/meta/developer.yaml`, `documentation-curator.yaml`, `planner.yaml`
- `personas/standalone/src/content/plan-refiner.md`
- `personas/ledger-support/src/content/ledger-claude-coordinator.md`
- The 9 content files carrying hardcoded role literals, plus `personas/shared/partials/`
- `personas/package.json`

---

## Assumptions

- The library's other consumers rely on the current `` `${name} v${version}` `` default; preserving
  it as the default chain is therefore sufficient to keep the change non-breaking.
- `slug` continuing to equal the `cc_file_name` stem is a convention, not an invariant the library
  enforces. The per-target `claude-code` chain `['{{slug}}']` encodes today's reality; if a slug ever
  diverges from a cc stem, the step 11 guard fails the build rather than shipping a broken name.
- The three suffixed standalone personas are the complete set needing an explicit `label:`; the
  `(Ledger Support)` suffix matches no current persona.
- `personas/name-mapping.json` output must remain byte-identical after step 9, since
  `mcp-server/src/utils/constants.ts` L204–208 consumes it at startup.

---

## Constraints

- **Zero-dependency engine** (`ai-persona-builder/docs/agents/project-manifest/constraints.md`
  § Architectural Invariants 1) — no new `src/engine/` code may import anything.
- **Synchronous plugin runner** (same doc, invariant 2) — all new code paths stay synchronous.
- **Strict + check** (same doc, invariant 3) — validation-mode builds must combine both flags.
- **No ai-insights conventions in library code** — the `{number} - {role}` rule and the
  `(Standalone)` suffix rule must be expressible only through configuration and metadata.
- **Cross-platform** (`ai-insights/AGENTS.md` § Cross-Platform Policy rules 2–3, 5) — Node built-ins
  and `path.join`/`path.resolve` only in `scripts/`; no Unix shell utilities; no hardcoded separators.
- **Never edit generated persona output** (`ai-insights/AGENTS.md` Failure Protocol) — all content
  changes go through `src/content/` or `shared/partials/`.
- **Both working trees are dirty** — the library carries three modified docs files and the consumer
  ~20 modified `.context/` files. Step 0 clears the library's; the consumer's `.context/` churn is
  regenerated in step 18 regardless.
- **`personas/changelog.md` is summary-only** (`ai-insights/AGENTS.md` § Changelog Convention rule 8)
  with a mechanical size warning via `scripts/lib/changelog-size-check.js`.

---

## Out of Scope

- Unifying the two remaining frontmatter templates
  (`personas/plugins/ledger/frontmatter-templates.js` L48 and `personas/persona-build.config.js` L38)
  into one source. See Deferred Items.
- Whether Claude Code dispatch should use `subagent_type` rather than the `Task` tool's
  `description` field. See Deferred Items.
- Implementing the library's planned `onPreRender` hook (`constraints.md` § Sub-Agent Validation
  Constraints 5) and migrating the cross-reference checks into a library plugin.
- Any change to `mcp-server/`, `orchestrator/`, or `shared/workflow-manifest.json` — research
  confirmed `name-mapping.json` is correct and `AGENT_NAMES` is unaffected.
- Key-collision hardening between `agent_slug_<x>` / `agent_label_<x>` and a persona whose slug
  literally begins `slug-` or `label-`. Pre-existing, no current instance; documented only.

---

## Acceptance Criteria

- AC-01: `buildAgentNameMap`'s file-scanning work runs exactly once per `build()` call, regardless
  of target count.
- AC-02: With no `agentNames` configuration, `agent_<slug>` and `agent_slug_<slug>` produce values
  byte-identical to v2.6.x for every persona and every target.
- AC-03: A configured `agentNames.name` chain resolves to its first entry whose variables all
  resolve against the persona's metadata; later entries are used only on a miss.
- AC-04: When `agentNames.name` is a per-target map, `agent_<slug>` renders the chain for the target
  currently being built.
- AC-05: A `SuiteConfig.agentNames` value overrides `BuildConfig.agentNames` for that suite.
- AC-06: `agent_label_<slug>` is emitted for every persona across all suites and contains no version
  substring under the default or the ai-insights chain.
- AC-07: When no chain entry resolves, the emitted value falls back to the default chain and then the
  slug; no emitted map value ever contains a literal `{{`.
- AC-08: Chain resolution emits no `[WARN] Unresolved variable` output for non-matching entries.
- AC-09: `resolveFirstTemplate()` recognises exactly the variable pattern `resolveVariables()`
  recognises.
- AC-10: A persona's own YAML field still overrides any `agent_*`, `agent_slug_*`, or
  `agent_label_*` map entry.
- AC-11: `validateSubagentRefs()` continues to resolve `agent_slug_*` keys, and `agent_slug_*` values
  are identical across all three targets.
- AC-12: In the ai-insights build, `{{agent_1_planner}}` renders `1 - Planner v2.4.0` for `vscode`
  and `1-planner` for `claude-code` and `deep-agents`; the same holds for all nine ledger personas.
- AC-13: Zero occurrences of the malformed pattern `<digit>-<kebab> v<semver>` remain in any
  generated persona file across all three suites and all three targets.
- AC-14: `{{agent_label_1_planner}}` renders `Planner`; `{{agent_label_plan_auditor}}` renders
  `Plan Auditor`; `{{agent_label_developer_standalone}}` renders `Developer`.
- AC-15: `personas/name-mapping.json` is byte-identical before and after the `deriveRole()` removal
  and the identity-table hoist.
- AC-16: `buildAgentIdentityTable()` returns the same per-target `agent_name` values in `--check`
  mode as in a real build.
- AC-17: The divergence guard fails the build when a generated file's frontmatter `name` differs
  from the computed identity for that persona and target.
- AC-18: The divergence guard fails the build when a generated file contains an agent reference at a
  dispatch call site matching no identity in the table — reproducing Problem A as a build failure.
- AC-19: The divergence guard runs and can fail in both real and `--check` modes.
- AC-20: The broadened `{{agent_slug_*}}` cross-reference check validates references in all three
  suites, not the ledger suite alone.
- AC-21: No hardcoded ledger role literal remains in `personas/shared/partials/`.
- AC-22: Every temporary `agent_<slug>` YAML override added in step 2 is removed by step 13.
- AC-23: A clean `node scripts/build-personas.js` followed by `node scripts/build-personas.js --check`
  exits 0 with no diff.

---

## Testing Strategy

Three layers. **Library unit tests** (Vitest) cover chain resolution, per-target rendering, defaults,
and precedence in isolation, following the existing fixture-suite-on-a-temp-directory pattern in
`tests/builders/agent-name-map.test.ts`. **Consumer script tests** (Vitest, `scripts/tests/`) cover
the identity table and the divergence guard, including a negative fixture that reproduces Problem A
and asserts the guard rejects it. **End-to-end verification** runs the real ai-insights build and
asserts on generated output — the layer that would have caught the original bug, and the only one
that proves the three-target claim against real personas.

The negative test for AC-18 is the load-bearing one: it encodes the defect class, not just the
defect.

---

## Test Plan

| Test file or name | Asserts | Covers |
|---|---|---|
| `tests/builders/agent-name-templates.test.ts` — "descriptor collection runs once across targets" | Instruments YAML reads and asserts the count is independent of target count | AC-01 |
| `tests/builders/agent-name-map.test.ts` — all 10 existing tests | Unchanged default output for both existing keys | AC-02 |
| `tests/integration/build.test.ts` | Existing `agent_` assertions unchanged | AC-02 |
| `tests/builders/agent-name-templates.test.ts` — "first fully-resolvable chain entry wins" | Two-entry chain; persona matching only the second gets the second | AC-03 |
| `tests/builders/agent-name-templates.test.ts` — "per-target chain map selects by target" | Fixture built for two targets renders two different `agent_<slug>` values | AC-04 |
| `tests/builders/agent-name-templates.test.ts` — "suite agentNames overrides config agentNames" | Two suites, one overriding; each renders its own chain | AC-05 |
| `tests/builders/agent-label-map.test.ts` — "emits agent_label_<slug> for every persona" | Key present cross-suite; value carries no `v<semver>` | AC-06 |
| `tests/builders/agent-name-templates.test.ts` — "falls back when no chain entry resolves" | Chain referencing only absent variables falls to default, then slug; output has no `{{` | AC-07 |
| `tests/builders/agent-name-templates.test.ts` — "chain misses emit no warnings" | Spies `console.warn`; asserts no `Unresolved variable` during chain resolution | AC-08 |
| `tests/builders/agent-name-templates.test.ts` — "resolveFirstTemplate matches resolveVariables pattern" | Both accept `{{a_b1}}` and both reject `{{a-b}}` / `{{a.b}}` | AC-09 |
| `tests/builders/agent-label-map.test.ts` — "explicit YAML field overrides agent_label entry" | Mirrors existing L376–421 test for the new key | AC-10 |
| `tests/builders/subagent-validation.test.ts` — extended | Validation passes with the per-target map; `agent_slug_*` identical across targets | AC-11 |
| `scripts/tests/agent-identity.test.js` — "ledger identity uses number-role-version for vscode" | `1 - Planner v2.4.0` / `1-planner` / `1-planner` per target | AC-12, AC-16 |
| `scripts/tests/agent-identity.test.js` — "label prefers explicit label, then role, then name" | Three fixtures covering all three chain positions | AC-14 |
| `scripts/tests/agent-identity.test.js` — "table is identical in check and real mode" | Same input, both modes, deep-equal | AC-16 |
| `scripts/tests/agent-identity.test.js` — "name-mapping output unchanged" | Golden-file compare against the committed `personas/name-mapping.json` | AC-15 |
| `scripts/tests/agent-name-check.test.js` — "fails on frontmatter/identity divergence" | Fixture with a mismatched frontmatter `name` produces an error | AC-17 |
| `scripts/tests/agent-name-check.test.js` — "fails on unknown dispatch reference (Problem A)" | Fixture containing `` `"1-planner v2.4.0"` `` at a dispatch site is rejected | AC-18 |
| `scripts/tests/agent-name-check.test.js` — "passes on a correct fixture" | No false positive on well-formed output | AC-17, AC-18 |
| `scripts/tests/agent-name-check.test.js` — "runs in check mode" | Guard invoked and failing with `--check` semantics | AC-19 |
| `scripts/tests/build-personas-crossref.test.js` — "validates all three suites" | A bad non-ledger `{{agent_slug_*}}` reference now fails | AC-20 |
| End-to-end (step 17, recorded in the plan folder) — malformed-pattern sweep | Grep `[0-9]-[a-z-]+ v[0-9]+\.[0-9]+\.[0-9]+` across all generated output returns 0 | AC-13 |
| End-to-end (step 17) — hardcoded-literal sweep | No ledger role literal remains in `personas/shared/partials/` | AC-21 |
| End-to-end (step 13) — override removal sweep | No `agent_<slug>:` key remains in any persona YAML | AC-22 |
| End-to-end (step 17) — idempotent build | Real build then `--check` both exit 0 with no diff | AC-23 |

---

## Documentation Updates

**Library — `ai-persona-builder`** (per its `AGENTS.md` Manifest Maintenance Rules: "Add/modify
builder function" → `api-surface.md` + `data-flows.md`; "Change architectural pattern" →
`tech-stack.md` + `constraints.md`):

- `docs/metadata-reference.md` L190–199 — add `{{agent_label_<slug>}}` **and** the missing
  `{{agent_slug_<slug>}}` row to the auto-derived context table; update the `{{agent_<slug>}}` row to
  state that its value is configurable and target-aware. Update L18 (`slug` row) and L111.
- `docs/template-syntax.md` L18 — update merge-order item 6 to name all three key families.
- `docs/configuration.md` — document `AgentNameConfig`, the chain semantics, the per-target map form,
  the `BuildConfig`/`SuiteConfig` precedence, and the defaults.
- `docs/agents/project-manifest/api-surface.md` L72–83 — replace the two-row table with three rows;
  document `collectAgentDescriptors()`, `renderAgentMap()`, `resolveFirstTemplate()`, and the
  `AgentDescriptor` / `AgentNameConfig` types. Update L341–343 for `validateSubagentRefs()`'s
  per-target map input.
- `docs/agents/project-manifest/data-flows.md` L18–20 — redraw the pre-scan as two phases and show
  phase 2 inside the target loop. Update L82 (merge layer 4) and L105–106 (context variable table).
- `docs/agents/project-manifest/constraints.md` — record the naming-policy-is-configuration
  invariant and the `resolveFirstTemplate()` / `resolveVariables()` pattern-parity requirement.
- `docs/agents/project-manifest/tech-stack.md` — note the two-phase pre-scan if the layer
  description changes.
- `docs/agents/project-manifest/file-tree.md` — add any new source and test files.
- `README.md` — mention `agent_label_*` if agent variables are described there.
- `CHANGELOG.md` — minor-version entry; sync `package.json`.

**Consumer — `ai-insights`** (per `AGENTS.md` Manifest Maintenance Rules and Changelog Convention):

- `personas/docs/agents/project-manifest/variables.md` — L16 (merge-order row), L138–139 (add the
  `agent_label_*` row and per-target semantics), L141 (key derivation), **L144–145 (rewrite the prose
  guidance that currently recommends `{{agent_<slug>}}` for prose — the source of Problem B)**,
  L149, L161 (worked example), L224–225 (quick reference).
- `personas/docs/agents/project-manifest/api-surface.md` — L25 (name-mapping generation now consumes
  `scripts/lib/agent-identity.js`), L29 (broadened cross-reference check), L158 (split the
  dispatch/display roles that this row currently conflates), L448 (`subagents` row), L584
  (`planner-output-template.md` partial), L702–704 (`name-mapping.json` shape). Add rows for
  `scripts/lib/agent-identity.js` and `scripts/lib/agent-name-check.js`.
- `personas/docs/agents/project-manifest/constraints-build-system.md` L86 — update constraint 9 for
  the three-suite scope; add a constraint for the divergence guard.
- `personas/docs/agents/project-manifest/data-flows.md` — the new validation block and the identity
  hoist.
- `personas/docs/agents/project-manifest/file-tree.md` — the two new `scripts/lib/` modules.
- `personas/docs/agents/project-manifest/constraints.md` — the `label:` metadata field as an
  ai-insights convention; the `deriveRole()` removal.
- `AGENTS.md` § Root-Level Tooling — add `scripts/lib/agent-identity.js` and
  `scripts/lib/agent-name-check.js` rows in the established format.
- `AGENTS.md` § Cross-System Dependencies — extend the "Agent name mapping" row (L257) to record
  `scripts/lib/agent-identity.js` as the canonical derivation and the `agentNames` config block as
  the source of truth for rendered agent references.
- `README.md` — if it lists root-level scripts.
- `personas/changelog.md` — summary-only entry (rule 8, one bullet per theme).
- `ai-insights/changelog.md` — root entry with `> personas vX` module reference.
- `.context/` — regenerate via `node scripts/cli.js ctx-generate`.

---

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Unify `personas/plugins/ledger/frontmatter-templates.js` L48 and `personas/persona-build.config.js` L38 into a single naming source shared with the `agentNames` config | Structural Improvements | Requires restructuring the ledger plugin's `onSuiteInit` template injection — outside this plan's blast radius | After this plan, the config's `agentNames.name.vscode` chain and the two frontmatter templates encode the same rule in two places. The step 11 guard detects divergence, so the duplication is now caught rather than silent. Revisit if the guard ever fires for this reason. |
| 2 | Determine whether Claude Code dispatch should use the `Task` tool's `subagent_type` parameter rather than `description` | Research finding, Area: Target-Awareness | Verifying Claude Code's dispatch contract requires knowledge outside this codebase; the fix would rewrite every claude-code dispatch branch in the suite | Verified fact: all claude-code output places the agent name in `description:`, and `subagent_type` appears nowhere in `personas/shared/partials/`. If confirmed as a defect this is a second live dispatch bug, independent of Problem A. |
| 3 | Migrate the cross-reference and divergence checks into a library plugin once `onPreRender` ships | Library `constraints.md` § Sub-Agent Validation Constraints 5 | The hook does not exist; that document already names the workspace script as the correct interim home | Both new `scripts/lib/` modules are structured as pure functions to ease the eventual move. |
| 4 | Harden against key collisions between `agent_slug_<x>` / `agent_label_<x>` and personas whose slug begins `slug-` or `label-` | Out of Scope | Pre-existing for `agent_slug_`; no current instance in any suite | Document the reserved prefixes in `docs/metadata-reference.md` as part of step 15. |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Silent behaviour change for the library's other consumers** | Defaults reproduce the current format exactly; AC-02 is asserted by the ten existing tests in `tests/builders/agent-name-map.test.ts`, left unmodified so any drift fails loudly. |
| **Publish-then-adopt latency blocks the live bug fix** | Phase A (step 2) fixes all 57 malformed renderings using only the tested YAML-override mechanism, in the consumer repo, with no library release. AC-22 and step 13 guarantee the stopgap is removed. |
| **Step 2's version-bearing literals go stale before step 13** | Each override carries a comment naming this plan folder as its removal trigger; AC-22 asserts a clean sweep; step 13 is a hard dependency of Phase D. |
| **`name-mapping.json` changes shape and breaks `AGENT_NAMES`** | AC-15 is a golden-file byte-comparison against the committed file, run as a script test rather than by inspection. `mcp-server/src/utils/constants.ts` L204–208 is read-only in this plan. |
| **`resolveFirstTemplate()` drifts from `resolveVariables()`'s pattern** | AC-09 tests both functions against the same accept/reject cases; a source comment states the parity requirement at the definition site. |
| **Chain resolution silently produces an empty or malformed value** | AC-07 forbids any emitted value containing a literal `{{` and mandates the default-then-slug fallback; the step 11 guard catches anything that slips through into output. |
| **Per-target map rendering regresses `agent_slug_*` stability** | AC-11 asserts `agent_slug_*` values are identical across all three targets, protecting `validateSubagentRefs()` and the deep-agents subagent registration path. |
| **Step 14's 49 candidate matches include false positives** | Each match requires individual judgement; the step explicitly states this and prioritises `shared/partials/`, where a literal is unambiguously wrong. AC-21 is scoped to partials only, not to a match count. |
| **Broadening the cross-reference check (step 12) breaks the build on pre-existing non-ledger references** | Step 12 includes adding `subagents` declarations for the 8 currently-unvalidated non-ledger references; run the broadened check before landing to enumerate them. |
| **Library version drift causes a mis-numbered publish** | Step 0 blocks all other library work until `package.json`, `CHANGELOG.md`, and the registry version reconcile, using the repo's own `release-check` skill. |
| **Uncommitted docs edits in both repos entangle with this plan's edits** | Step 0 commits the library's three modified docs files first. The consumer's `.context/` churn is regenerated wholesale in step 18. |
| **The guard produces false positives on legitimate prose** | Assertion (a) is an exact frontmatter comparison with no heuristic. Assertion (b) is scoped to dispatch call sites (`agentName:` / `Task` description patterns), not free prose; if it proves noisy, demote (b) to a warning and keep (a) as the error — (a) alone still catches divergence, though not Problem A itself. |
