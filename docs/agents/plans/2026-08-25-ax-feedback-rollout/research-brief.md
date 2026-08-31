# Research Brief

## Scope Sketch

- **AX Feedback partial** — `personas/shared/partials/ax-feedback.md` — modification (D1 heading level, D2 fenced-block mangling, sub-agent propagation rule)
- **Persona metadata (3 suites)** — `personas/{ledger,standalone,ledger-support}/src/meta/` — modification (new `ax_feedback` / `ax_feedback_target` fields, changelog + version bumps)
- **Persona content templates (3 suites)** — `personas/{ledger,standalone,ledger-support}/src/content/` — modification (`{{> ax-feedback}}` insertion sites, numbered-step insertion)
- **Shared partials — insight sink** — `personas/shared/partials/insight-{capture,compilation}.md` — conditional modification (only if Option A chosen)
- **Dead shared stub** — `personas/shared/partials/incident-logging.md` — deletion
- **Build system (post-processor)** — `ai-persona-builder` repo, `src/engine/postProcessor.ts` — investigation only; D2 root cause identified but fix is preferably partial-side
- **MCP surface — project comments** — `mcp-server/src/tools/observations.ts`, `mcp-server/src/schema/root-index.ts` — read-only verification (no schema change needed)
- **GUI consumers of project comments** — `mcp-server/gui/public/views/project-detail.js`, `gui/public/api-client.js` — read-only verification
- **Docs** — `personas/docs/persona-design-guide.md`, `personas/docs/agents/project-manifest/{api-surface,variables,constraints,data-flows}.md`, `docs/references/insights-sidecar-reference.md`, `.gitignore`, `personas/changelog.md`, `docs/agents-overview.md`, `.context/` — modification

---

## Area: AX Feedback Partial

### Verified References

- `personas/shared/partials/ax-feedback.md` (L1–13): full current content. Opens with `## AX Feedback` (H2, **D1 confirmed**). Contains a fenced code block whose body includes a literal `---` separator followed by `## AX Feedback`. Contains **no** append-during-work / sink instruction — it is currently a pure checkpoint duty. Total 13 lines.
- Generated output verified in `personas/standalone/vs-code/readme-curator.agent.md` (inspected via terminal, lines ~163–190):
  - **D1 confirmed:** the rendered `## AX Feedback` H2 sits between workflow step 9 and step 10, terminating the `## Workflow` section and orphaning the handoff step.
  - **D2 confirmed:** inside the fenced block, the source `---\n## AX Feedback` renders as `\n---\n\n## AX Feedback` — a blank line was injected before and after the `---`, so the template shown to the agent is not byte-identical to the partial source.

### Current consumers (5 personas, 6 insertion sites)

| File | Line(s) |
|---|---|
| `personas/ledger/src/content/3-developer.md` | 179 |
| `personas/ledger/src/content/9-synthesis.md` | 122 |
| `personas/standalone/src/content/developer.md` | 206 |
| `personas/standalone/src/content/readme-curator.md` | 147 |
| `personas/standalone/src/content/changelog-curator.md` | 129, 160 (two modes → two insertions) |

### Patterns & Conventions

- Insertion pattern (verified at `personas/ledger/src/content/3-developer.md` L177–186): a numbered workflow step of the form `N. **AX Feedback:** Before handing off, reflect on your session experience.`, then a blank line, then `{{> ax-feedback}}`, then the handoff step at `N+1`. The handoff itself is a target-conditional block (`{{#if target_vscode}} … {{> handoff-block-vscode}}`).
- Short suite-agnostic behavioural fragments live in `personas/shared/partials/` — precedent explicitly cited for `insight-capture.md` / `mcp-insight-capture.md` in `personas/docs/agents/project-manifest/constraints.md` L247.

### Constraints

- The H2 **inside** the fenced template block is the literal output format the agent must emit — it must stay an H2. Only the partial's own opening heading needs fixing.

---

## Area: Build System — D2 Root Cause

### Verified References

- `ai-persona-builder`: `src/engine/postProcessor.ts` L36–39 — `ensureBlankLineBeforeHeadings()` performs two unconditional regex passes:
  - L37: `result.replace(/([^\n])\n(---)\n/g, '$1\n\n$2\n')` — blank line **before** `---`
  - L39: `result.replace(/\n(---)\n([^\n])/g, '\n$1\n\n$2')` — blank line **after** `---`
  Neither pass is fenced-code-block aware. This is the definitive D2 root cause.
- L34 in the same function (`/([^\n])\n(#{1,6} )/g`) is the heading rule; it does not fire here because the `---` rule already inserted the blank line.

### Constraints

- `ai-persona-builder` is a **separate workspace folder / separate npm package** (`@mistralys/persona-builder`), consumed by `ai-insights` via `personas/node_modules/`. A library fix requires a package release + version bump in the consuming project. A partial-side workaround (avoiding a bare `---` line inside the fenced block) is strictly cheaper and stays inside the `ai-insights` repo. This confirms the spec's "prefer a partial-side fix" instruction.

---

## Area: `incident-logging` — Two Files (F1 / F2 verified)

### Verified References

- `personas/shared/partials/incident-logging.md` (L1, single line): prose only — "note it clearly in your response and describe any workaround you found."
- `personas/ledger/src/partials/incident-logging.md` (L1, single line): calls `ledger_add_project_comment` with `type: "incident"` and a `context` object (`os`, `tool`, `work_package`, `resolved`, optional `workaround`).
- Consumers of `{{> incident-logging}}` — exactly 6, all in the ledger suite:

| File | Line | Guarded by `{{#if has_incident_logging}}`? |
|---|---|---|
| `personas/ledger/src/content/3-developer.md` | 158 | **No — unconditional** |
| `personas/ledger/src/content/4-qa.md` | 100 | Yes (L99) |
| `personas/ledger/src/content/5-security-auditor.md` | 120 | Yes (L119) |
| `personas/ledger/src/content/6-reviewer.md` | 176 | Yes (L175) |
| `personas/ledger/src/content/7-release-engineer.md` | 82 | Yes (L81) |
| `personas/ledger/src/content/8-documentation.md` | 96 | Yes (L95) |

- **Zero** references from `personas/standalone/src/` or `personas/ledger-support/src/` — confirms F2 (the shared file is orphaned).
- Generated output confirms the MCP version is what ships: e.g. `personas/ledger/vs-code/3-dev.agent.md` L218 contains the `ledger_add_project_comment` text, not the prose text.

### Patterns & Conventions

- **Suite-local partials shadow shared ones by filename stem.** Verified in the library: `ai-persona-builder/src/loaders/partials-loader.ts` L8–10 documents the two-layer shared → suite-local merge, keyed by filename stem, with the suite-local result spreading last. `personas/persona-build.config.js` L79 sets `sharedPartialsDir: personas/shared/partials`; each suite's `srcDir` supplies its own `partials/`.

### Constraints

- A bare grep for `incident-logging` will **always** match the live ledger override and its 6 consumers. Any acceptance criterion must distinguish the two files by full path. (Confirms the spec's rejection of the superseded plan's AC-15.)

---

## Area: `has_incident_logging` Flag (F3 verified)

### Verified References

- Present in **all 9** ledger metadata files: `true` on `3-developer.yaml` L40, `4-qa.yaml` L36, `5-security-auditor.yaml` L34, `6-reviewer.yaml` L38, `7-release-engineer.yaml` L28, `8-documentation.yaml` L39; `false` on `1-planner.yaml` L37, `2-project-manager.yaml` L40, `9-synthesis.yaml` L38.
- Documented as **required** (`yes`): `personas/docs/agents/project-manifest/api-surface.md` L218; also `variables.md` L51 and L200; `personas/docs/persona-build-system.md` L328, L357, L418.

### Constraints

- No change required. Recorded so the plan does not inherit the superseded plan's removal step.

---

## Area: MCP Project-Comment Channel (F4 verified)

### Verified References

- `mcp-server/src/tools/observations.ts` L18–34 — `AddObservationSchema`: `work_package_id` (required, `^WP-\d{3,}$`), `pipeline_type` (required, `PipelineTypeEnum`), `type`, `priority`, `note`, optional `loc`. Writes a comment onto `wp.pipelines[…].comments` (L50–79) — i.e. a **pipeline comment on a work package**. Confirms F4: wrong channel for AX friction.
- `mcp-server/src/tools/observations.ts` L112–133 — `AddProjectCommentSchema`: `type: z.string()` (free-form, **no enum** → `"ax"` needs no schema change), `priority: z.enum(['low','medium','high'])`, `agent: z.string()` (**required**, gives attribution for free), `note`, optional `context` object (`.passthrough()`).
- `mcp-server/src/tools/observations.ts` L135–199 — `addProjectComment()`: validates that `context` is present **only** when `type === 'incident'` (L148–152). An `"ax"`-typed comment therefore needs no `context`. Appends to `root.project_comments` (L172).
- `mcp-server/src/schema/root-index.ts` L23–30 — `ProjectCommentSchema` = `{ type: string, priority, timestamp, agent: string, note, context?: IncidentContextSchema }`. L44 — `RootIndexSchema.project_comments: z.array(ProjectCommentSchema)`.

### Consumers of `project_comments` (audit for the "unknown type" risk)

| Consumer | Location | Behaviour with an unknown `type` |
|---|---|---|
| GUI Project Comments card | `mcp-server/gui/public/views/project-detail.js` L648–674 | Sorts by timestamp desc, renders `type` as a free-text badge (`escapeHtml(c.type \|\| '')`), styles only by `priority`, renders `context` only when present. **Type-agnostic — handles `"ax"` with no change.** |
| GUI insights aggregation (`getInsights`) | `mcp-server/gui/public/api-client.js` L211–221 (client), JSDoc L69–90 | Documents flattening `project_comments` across all projects. **`GET /api/insights` route was removed** — `mcp-server/tests/gui/server-knowledge-routes.test.ts` L493–494 asserts it returns 404. The client method is dead code; no live consumer to pollute. |
| Synthesis persona | `personas/ledger/src/content/9-synthesis.md` L46 | Reads `project_comments` narratively ("Review the ledger's `pipelines`, `metrics`, and `project_comments`"). No type filter — an `"ax"` entry would be visible to Synthesis. |
| Ledger Doctor persona | `personas/ledger-support/src/content/ledger-doctor.md` L275 | Reads `project_comments` to understand why a WP was cancelled. Type-agnostic narrative read. |
| Server-side writers | `pipeline.ts` L499, `work-package.ts` L1254, `workflow-handoff.ts` L243, `project-reset.ts` L484, `project-lifecycle.ts` L396 | Write-only paths (`rework_reset`, `reopen_cancelled`, forward-compat warning, etc.). No read-side type switch. |

### Constraints — tool grants

- `ledger_add_project_comment` is granted to ledger agents **3–9 only**. Verified in `personas/docs/agents/project-manifest/api-surface.md` L487 allocation table and in the YAML `mcp_tools` arrays (`3-developer.yaml` L53, `4-qa.yaml` L53, `5-security-auditor.yaml` L51, `6-reviewer.yaml` L55, `7-release-engineer.yaml` L41, `8-documentation.yaml` L60, `9-synthesis.yaml` L49).
- **Agents 1 (Planner) and 2 (Project Manager) do NOT have it.** `1-planner.yaml` L40–45 lists only `ledger_get_repository_context` + `ledger_search_insights`; `2-project-manager.yaml` L45–57 lists `ledger_ping`, `ledger_initialize_project`, `ledger_create_work_package`, `ledger_get_project_status`, `ledger_get_work_package`, `ledger_get_handoff_status`.
- **This is a gap the spec does not address.** The spec assigns "Group B — ledger suite, agents 1–9" to `ledger_add_project_comment` persistence, but 1 and 2 cannot call it. Additionally, at Planner time no ledger exists yet (the PM creates it via `ledger_initialize_project`), so the Planner has no project to comment on even if granted the tool. The plan must resolve this — either grant the tool to agent 2 and treat agent 1 as inline-only, or treat both 1 and 2 as inline-only.

---

## Area: Insight Sink Personas (Option A / B decision)

### Verified References — full audit of all 43 personas

Terminal audit of `tools:` blocks and insight fields across `ledger/src/meta/`, `standalone/src/meta/`, `ledger-support/src/meta/`:

- **`insight_agent` (JSONL sink) — exactly 2 personas:** `standalone/src/meta/developer.yaml`, `standalone/src/meta/web-gui-specialist.yaml`. Confirms the spec.
- **`insight_pipeline_type` (MCP observations) — exactly 5 personas:** ledger `3-developer`, `4-qa`, `5-security-auditor`, `6-reviewer`, `8-documentation`. Confirms the spec.
- **Personas lacking `edit` — exactly 4:** `standalone/src/meta/git-committer.yaml`, `standalone/src/meta/recipe-curator.yaml`, `ledger-support/src/meta/ledger-knowledge-curator.yaml`, `ledger-support/src/meta/ledger-orchestrator-archaeologist.yaml`. Exactly matches the spec's Group D list.
- **Total personas:** 9 ledger + 23 standalone + 11 ledger-support = **43**. Current AX consumers = 5 → **38 personas without it**, matching the spec.

### Sink partials — the 3 mandatory Option A edits

- `personas/shared/partials/insight-capture.md` (L1–41): opens the sink at session start with a `session-start` marker (L11–14), appends at every gate (L16–29), constraints (L31–41). Field table L23–29 lists `agent` / `priority` / `type` / `loc` / `text`. `type` is drawn from "your observation type vocabulary".
- `personas/shared/partials/insight-compilation.md` (L1–36):
  - L3: "read every entry in `insights.jsonl` … compile `{{insight_report_target}}` from these entries" — **no type filter**. Confirms Option A edit #1 is mandatory.
  - L24–28: sink-state forcing table. Row 1 = "A `{{insight_agent}}` marker, plus entries from **any** agent" → "Capture ran and produced material". An AX-only sink would falsely satisfy this. Confirms Option A edit #2 is mandatory.
- Scope & Boundaries table precedent confirmed at `personas/ledger/src/content/3-developer.md` (Scope Guardrails at L150, Code Insight territory). Confirms Option A edit #3.

### Constraints

- `docs/references/insights-sidecar-reference.md` L336–337: Curator Verification Checklist asserts "The persona has at most one continuous side-channel; **checkpoint-slotted partials (e.g., `ax-feedback`) do not count**." This is a documented invariant that the superseded plan's D3 would have invalidated. Keeping AX checkpoint-slotted keeps it true.
- `personas/docs/persona-design-guide.md` L522–546 (Pattern 6): "**Limit: one side-channel per persona.**" (L546) plus the two-required-mitigations rule (L533–537: forcing function + incremental capture sink). Option A widens an *existing* sink's type vocabulary rather than opening a second sink — consistent with the cap.

---

## Area: Insertion Sites — Structural Survey

### Verified References — per-persona structural shape (terminal survey)

| Shape | Personas | Insertion mechanics |
|---|---|---|
| Single `## Workflow`, target-conditional `handoff-block` partial | ledger 2–8 (7 personas; 1 and 9 differ) | Numbered step + `{{> ax-feedback}}` before the `{{#if target_vscode}}` handoff block |
| Single `## Workflow`, no `## Handoff` H2, inline handoff | ledger 1, 9; standalone `comms-curator`, `composer-curator`, `developer`, `git-committer`, `module-intent-architect`, `plan-architect-reviewer`, `plan-auditor`, `plan-refiner`, `planner`, `readme-curator`, `researcher`, `unit-test-auditor`, `web-gui-specialist`; ledger-support `ledger-bootstrapper`, `ledger-claude-coordinator`, `ledger-dependency-sequencer`, `ledger-knowledge-archiver`, `ledger-knowledge-curator`, `ledger-orchestrator-archaeologist`, `ledger-orchestrator-runner`, `ledger-pipeline-configurator`, `ledger-wp-decomposer` | Single numbered-step insertion |
| Separate `## Handoff` H2 | standalone `agents-md-curator` (L323), `ctx-architect` (L397), `usage-scenarios-curator` (L352) | Unnumbered block before the `## Handoff` H2 — exactly the 3 personas the spec calls out |
| No `## Workflow` H2 at all | standalone `changelog-curator`, `documentation-curator`, `manifest-curator`, `persona-curator`, `whatsnew-curator` | Mode-scoped `### Workflow` subsections — per-mode insertion. `changelog-curator` already has 2 (L129, L160), confirming the pattern works |
| Multiple `## Workflow` H2s (mode-split) | standalone `recipe-curator` (2), `workspace-architect` (2: Onboard L125 / Upgrade L189); ledger-support `ledger-doctor` (3), `standalone-archiver` (2: Import L60 / Update L129) | Per-mode insertion (or flag-off for `recipe-curator`) |

### Sub-agent dispatchers (propagation rule needed)

Verified `runSubagent` / `Task` references in content templates: ledger `2-project-manager` (8), `7-release-engineer` (4), `8-documentation` (2), `9-synthesis` (2); standalone `developer` (2), `documentation-curator` (4), `manifest-curator` (4), `plan-refiner` (12), `web-gui-specialist` (2), `workspace-architect` (14). **10 personas** — matches the spec's count exactly.

---

## Area: Docs, Design Guide, Gitignore

### Verified References

- `personas/docs/persona-design-guide.md`:
  - L51–74 "Recommended Section Order" table has a `Required?` column (Yes/No) with 14 rows (Mission … Handoff).
  - L74–86 "Required Sections" table (6 rows).
  - L87–110 "Optional Sections" table with "When to Include" + "Example Personas" columns.
  - L522–546 Pattern 6 (Observation Side-Channel), L546 the one-per-persona cap.
  - L764 (Pattern 15): "Every duty must be foreground, action-gated, or checkpoint-slotted."
  - L15–22 version history block (current v2.6, 2026-08-24).
  - **Finding:** the guide has no "Recommended" tier between Required and Optional. The spec asks to register AX Feedback as **Recommended**. The natural fit is the **Optional Sections** table (which already carries a "When to Include" column and is described as "Add these when the persona's role demands them"), plus a Pattern 6 worked example. The plan should state this mapping explicitly rather than inventing a third table.
- `personas/standalone/src/content/persona-curator.md` L178–207: Quality Checklist — flat `- [ ]` list, 26 items. New AX item slots in here.
- `.gitignore` (workspace root, verified in full):
  - Existing ledger-artefact block uses `/docs/agents/**/{name}` patterns: `work.md`, `work/`, `dependency-analysis.md`, `pipeline-configuration.md`, `work-packages-draft.md`, `audit.md`, `design-review.md`, `research-brief.md`.
  - `/docs/agents/insights/` is ignored (rung-2 precedent for the insight sink).
  - **`insights.jsonl` is NOT ignored** — it is a tracked plan-folder artefact. Confirms the spec's rung-1 risk: a broad wildcard would hide it. The safe rung-1 pattern is `/docs/agents/**/ax-feedback.md` (filename-specific, exactly mirroring the existing `audit.md` / `research-brief.md` entries). Rung 2 is `/docs/agents/ax/`.
- `default_cc_tools` documentation bug — **confirmed**:
  - Docs claiming a `cc_tools → default_cc_tools → tools` chain: `personas/docs/agents/project-manifest/api-surface.md` L151, L152, L197, L213, L406, L433; `variables.md` L85, L86, L93; `constraints.md` L84; `data-flows.md` L148.
  - Actual library behaviour: `ai-persona-builder/src/builders/persona-builder.ts` L311–327 — `const ccTools = Array.isArray(merged['cc_tools']) ? merged['cc_tools'] : tools;`. The fallback is **`cc_tools` → `tools`**. No `default_cc_tools` lookup exists anywhere in `ai-persona-builder/src/`.
  - `default_cc_tools:` keys still exist in all three `_shared.yaml` files (`ledger` L9, `standalone` L6, `ledger-support` L7) — dead configuration.
- `docs/agents-overview.md` is generated by `scripts/generate-agents-overview.js` (`--check` for staleness); `.context/` regenerated via `node scripts/cli.js ctx-generate`. Both listed in the root `AGENTS.md` Cross-System Dependencies table.
- Build-time validation precedent: `scripts/build-personas.js` L15 imports `validateInsightFieldsInDirs` from `./lib/insight-validation.js`; L456–470 runs it unconditionally in both real and `--check` modes and exits non-zero on failure. This is the established pattern for a new `ax_feedback` field validation.

### Constraints

- `personas/docs/agents/project-manifest/constraints.md` L247 records the shared-partial precedent for parameterised behavioural fragments — the `ax_feedback*` fields must be documented in `api-surface.md` + `variables.md` per the root `AGENTS.md` Manifest Maintenance Rules ("Add/remove feature flag → `api-surface.md` (metadata schema + feature flag table)").
- `CLAUDE.md` is auto-generated from `AGENTS.md` — never hand-edited.
- Version bookkeeping convention (`persona-curator.md` Strict Constraints): every persona content/metadata change requires (1) a new entry prepended to that persona's `changelog:` block scalar, and (2) an entry in `personas/changelog.md`. `version` / `last_updated` are auto-derived from the first changelog entry — never add standalone fields.

---

## Strategic Context

### Repository strategic vision (via `ledger_get_repository_context`)

- **Short-term:** minimise setup and daily-usage friction for developers.
- **Mid-term:** improve end-user documentation; raise awareness that persona design is critical to reliable agentic work.
- **Long-term (primary):** iterative persona improvement under a "Personas First" philosophy — LLM-independence by design, tools exist only to support the personas; steady improvement driven by working experience and continuous creative research.

**Alignment:** the AX Feedback rollout is a direct instrument of the long-term primary goal — it creates the feedback loop that "experience working with the project" depends on. The mid-term documentation goal is served by the Design Guide + manifest updates. No conflict with the short-term friction goal, provided the mechanism stays checkpoint-slotted (a continuous sink on 38 personas would add per-session cost).

### Relevant prior projects

- `2026-08-24-insight-channel-consolidation` (COMPLETE, 14 WPs, 0 rework): consolidated the dual-channel observation system — ledger agents now use MCP tools exclusively (added `loc`), standalone agents keep the JSONL sidecar; created the parameterised `mcp-insight-capture.md` shared partial. **This is the immediate architectural precedent for the spec's per-suite channel split** (ledger → MCP, standalone → sidecar).
- `2026-08-21-insights-sidecar-integration` (COMPLETE, 14 WPs, 0 rework): integrated `insights.jsonl` into 8 personas with per-role observer sections, action gates, scope boundaries, type vocabularies; introduced build-time `insight_agent` validation. **Direct precedent for both the staged multi-persona rollout shape and the build-time field-validation approach.**

### Relevant insights (via `ledger_search_insights`)

- *"Extract build-time validations into `scripts/lib/` for fixture-based testability"* (repository, `2026-08-21-insights-sidecar-integration`): a new build-time validation must go in a standalone `scripts/lib/` module with fixture tests in `scripts/tests/` — never inlined in `build-personas.js`, and never via the plugin `validateRole` pattern (warnings only, cannot fail the build). **Directly governs how `ax_feedback` validation is implemented.**
- *"Fix agent behavior with verbatim-copy guidance rather than relaxing intentional tool strictness"* (global): when tool behaviour is correct by design and the problem is agent usage, change the persona guidance — lower risk than changing the tool. **Supports leaving `ProjectCommentSchema.type` as free-form `z.string()` and adding an `"ax"` convention in the partial instead of adding an enum.**

---

## Area: Cross-Repo Coupling for the D2 Library Fix

### Verified References

- `ai-persona-builder/package.json` → `name: @mistralys/persona-builder`, `version: 2.5.1` (local working copy).
- `ai-insights/personas/package.json` L12 → `"@mistralys/persona-builder": "^2.6.0"`.
- Installed copy: `ai-insights/personas/node_modules/@mistralys/persona-builder/package.json` → `2.6.0`.
- `ai-persona-builder/CHANGELOG.md` topmost entries: `v2.6.1 - Bundle Documentation`, `v2.6.0 - Changelog-Derived Versioning`, `v2.5.1 - Variable Escaping`.
- `ai-persona-builder` git: HEAD `be00286` on `main`, clean tree, in sync with `origin/main`.

**Version-state finding:** `package.json` (2.5.1) lags `CHANGELOG.md` (2.6.1) in the local repo, and `ai-insights` has 2.6.0 installed from npm. The library's own `release-check` skill enforces version sync (`ai-persona-builder/.github/skills/release-check/SKILL.md`), so the version bump must run through that skill rather than a hand edit. The plan must sequence: library fix → changelog entry → `npm version` per release-check → publish → bump the `^` range in `personas/package.json` → reinstall → rebuild personas.

- The installed 2.6.0 bundle contains the identical unguarded regexes: `personas/node_modules/@mistralys/persona-builder/dist/index.js` L86–87 match `postProcessor.ts` L37/L39 exactly. The bug is live in the version `ai-insights` actually runs.
- `ai-persona-builder/tests/engine/postProcessor.test.ts` L86–95: only two horizontal-rule tests exist (`'text\n---\nnext'` → blank line before / after). **No fenced-code-block test exists** — the regression guard for the fix is a genuinely new test case.

### Constraints

- The fix must preserve the existing L86–95 behaviour (blank lines around `---` **outside** fences) while skipping content **inside** ``` fences. A fence-aware split (segment the text on fence delimiters, apply the rules only to non-fence segments) is the minimal shape; the postProcessor layer is `src/engine/`, which `ai-persona-builder/AGENTS.md` marks as **zero-dependency and pure** — the fix must not import anything.

---

## Confirmed Decisions (user, 2026-08-25)

| Question | Decision |
|---|---|
| Ledger agents 1 & 2 | **Grant `ledger_add_project_comment` to agent 2 (PM) only.** Agent 1 (Planner) is inline-only — no ledger exists at Planner handoff time. |
| Standalone sink widening | **Option A** — add an `ax` type to the existing `insights.jsonl` sink for `developer` and `web-gui-specialist`, plus the 3 mandatory follow-through edits. |
| D2 fix location | **Both** — fix `postProcessor.ts` in `ai-persona-builder` (root cause, with a new fenced-block regression test) **and** apply the partial-side restructure. Cross-repo release sequencing required. |
| `default_cc_tools` | **Fix the 4 docs AND remove the dead `default_cc_tools` keys** from all three `_shared.yaml` files, verifying generated output is unchanged. |
