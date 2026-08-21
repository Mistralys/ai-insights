# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context

Global insight `4fe113e4-2eb5-4748-9133-557939143d92` (from `2026-08-18-usage-scenarios-curator`) is
directly load-bearing here: when a workflow produces both authored source documents and derived
evidence, the classification must be applied **explicitly at every handoff and storage boundary in
the same change**. That plan required rework precisely because a companion file's classification was
applied inconsistently across archival paths. `insights.jsonl` is derived evidence entering the same
plan-folder namespace as `plan.md` and `synthesis.md`, so this plan classifies it at all four
boundaries (Git Committer, Standalone Archiver, ledger `archiveDocuments` allowlist, Knowledge
Archiver source list) rather than deferring any of them.

Repository insight `53454e24-4329-4946-ab9f-3b94cd682f17` requires regenerating `.context/` after any
`docs/agents/project-manifest/` edit — reflected in the Documentation Updates section.

Repository insight `f389f9ce-86cc-4b4e-ac83-eb131fbdc29d` (prefer the existing structural shape over a
new one) informs the choice to deliver the capture instructions as shared partials following the
`ax-feedback.md` precedent rather than inventing a new mechanism, and to bind the append duty to the
existing Operational Protocol steps rather than introducing a new capture phase.

The [Persona Design Guide](personas/docs/persona-design-guide.md) v2.5 is normative for every persona
change in this plan. Pattern 6 (The Observation Side-Channel) requires *both* a forcing function and
an incremental capture sink; Pattern 15 (Trigger Anchoring) classifies instruction durability by
trigger structure and caps each persona at one continuous side-channel. Both were published the same
day as this plan and postdate
[docs/references/insights-sidecar-reference.md](docs/references/insights-sidecar-reference.md) v1.1 —
where the reference's integration steps fall short of the guide (partial placement, action gating,
rework continuation), this plan follows the guide and amends the reference to match in step 1.

---

## Summary

Integrate the `insights.jsonl` sidecar specified in
[docs/references/insights-sidecar-reference.md](docs/references/insights-sidecar-reference.md) into
every persona that gathers insights, and make the two synthesis-writing personas compile their
insight sections from the sink instead of from recall. The work has four parts: (1) two new shared
persona partials — one carrying the append-time capture rules, one the report-time compilation rules
— parameterised per persona via new YAML metadata fields, each placed at the point in the persona
where its rules actually fire, and both resolving the sink through a two-rung location ladder that
replaces the reference's undefined non-plan fallback with `docs/agents/insights/`; (2) per-persona integration across the ledger and standalone suites,
including action-gated append instructions in each persona's Operational Protocol, scope boundary
tables and observation vocabularies for the four personas that currently lack them, and Rework
Handling continuation rules; (3) an MCP server change that surfaces the resolved plan-folder path in
every `ledger_get_next_action` response, because no ledger persona can currently learn where to write
the sink file; (4) a build-time validation rule preventing the new `insight_agent` field from
drifting from the manifest-derived `role` it duplicates. Derived-evidence classification for the new
file is applied at every archival boundary in the same change.

The design is governed by Pattern 15 (Trigger Anchoring) of the
[Persona Design Guide](personas/docs/persona-design-guide.md) v2.5: the sidecar exists to convert a
continuous triggerless duty into an anchored one, so every instruction it introduces is itself placed
at a concrete trigger — an action gate in the protocol, or a generation-time slot beside the output
template. Instructions merely *stated* in a knowledge section would reproduce the failure mode the
sidecar is meant to fix.

---

## Architectural Context

**Persona build system.** Persona files are assembled by `@mistralys/persona-builder` from three
source layers, driven by [personas/persona-build.config.js](personas/persona-build.config.js):

- `personas/shared/partials/` — suite-agnostic Markdown fragments (base layer). MCP-specific content
  is forbidden here per [constraints.md](personas/docs/agents/project-manifest/constraints.md) C18.
- `personas/<suite>/src/partials/` — suite-local fragments that shadow same-named shared entries. All
  `mcp-*`, `role-boundaries`, `handoff-block-*`, and `incident-logging` partials live in the ledger
  override layer.
- `personas/<suite>/src/content/<name>.md` + `personas/<suite>/src/meta/<name>.yaml` — per-persona
  body template and metadata. YAML fields become template context variables.

Three suites build to three targets each (`vs-code`, `claude-code`, `deep-agents`). Generated output
must never be hand-edited (C1); the workflow is edit `src/` → `node scripts/build-personas.js` →
`node scripts/sync-personas.js` (C3).

**Existing insight channels.** Two shapes exist today:

| Shape | Personas | Destination |
|---|---|---|
| Ledger pipeline comments | ledger Developer, Security Auditor, Reviewer (and QA / Documentation implicitly) | `comments[]` on `ledger_complete_pipeline`; `ledger_add_observation` post-hoc |
| Synthesis document section | standalone Developer (`### Code Insights`), Web GUI Specialist (`### Interface Insights`) | `synthesis.md` in the plan folder |

Only three personas have a named observer section:
[3-developer.md](personas/ledger/src/content/3-developer.md) L71–L124,
[developer.md](personas/standalone/src/content/developer.md) L65–L112, and
[web-gui-specialist.md](personas/standalone/src/content/web-gui-specialist.md) L75–L110. The
Security Auditor's channel is its severity `Info` tier plus the `improvement` comment type
([security-auditor-output-format.md](personas/shared/partials/security-auditor-output-format.md)
L6–L15); the Reviewer's is step 3 "Capture Insights"
([reviewer-operational-protocol.md](personas/shared/partials/reviewer-operational-protocol.md) L5).
QA and Documentation have no named channel and no type vocabulary of their own — QA's types exist
only in the `ledger_complete_pipeline` parameter description
([pipeline.ts](mcp-server/src/tools/pipeline.ts) L336).

**Plan-folder path availability.** This is the blocking gap for the ledger suite. The documented
pre-flight for ledger agents 3–9 is
[mcp-preflight-detect.md](personas/ledger/src/partials/mcp-preflight-detect.md) — a single
`ledger_get_next_action` call with `cwd_path`. That tool resolves the plan folder internally via
`resolveProjectPath()` ([project-resolver.ts](mcp-server/src/utils/project-resolver.ts) L25–L105) but
**never returns it**: every response payload in
[workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts) contains only `action`,
`reason`, `work_package_id`, `next_steps`, and optional handoff keys. The only tool that surfaces a
plan path is `ledger_detect_project`
([project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) L48–L61), and no workflow persona
declares it — `role-boundaries.md` forbids calling undeclared tools. The Synthesis persona already
depends on a value it cannot obtain: [9-synthesis.md](personas/ledger/src/content/9-synthesis.md)
L50–L55 instructs it to derive `project_storage_path` from "the pre-flight `plan_path` value", which
that pre-flight does not produce.

In orchestrator runs the problem does not arise — `inject_project_path()`
([tool_wrappers.py](orchestrator/src/utils/tool_wrappers.py) L190–L272) injects `project_path` into
every call and the stage prompt states it explicitly
([project-path-reminder.md](orchestrator/src/nodes/templates/partials/project-path-reminder.md)).
The gap is IDE-only, which is why it has gone unnoticed.

**Archival boundaries.** Four places classify plan-folder files:

- [git-committer.md](personas/standalone/src/content/git-committer.md) L31, L47, L106, L110, L162 —
  relocates named files to `docs/agents/implementation-history/`; explicitly never moves
  `scenario-coverage.md`.
- [standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md) L54, L82,
  L119 — reports only actually-archived files; never lists generated evidence as source.
- `LedgerStore.importStandaloneProject()`
  ([ledger-store.ts](mcp-server/src/storage/ledger-store.ts) L828–L838) — explicit archive allowlist:
  `planFile`, `synthesisFile`, optional `usageScenariosFile`.
- `completeSynthesis()` ([project-lifecycle.ts](mcp-server/src/tools/project-lifecycle.ts) L882–L884)
  — archives `synthesis.md` only.

---

## Approach / Architecture

### 1. Two shared partials, split by firing time, parameterised by YAML

The reference's Step 1 template bundles seven rules that fire at two different moments in a session.
Delivering them as one block forces at least half of them to be stated far from where they apply —
which Pattern 15's *"restate generation-time constraints at the point where they fire"* rule
forbids. The rules are therefore split across two partials, both following the structural precedent
of [ax-feedback.md](personas/shared/partials/ax-feedback.md): short, suite-agnostic behavioural
fragments included by both ledger and standalone content templates.

| Partial | Fires at | Rules it carries | Placement in the persona |
|---|---|---|---|
| `personas/shared/partials/insight-capture.md` | **Append time** — during the work | Sink path and filename; the flat string-only JSONL schema with a concrete example line; append-only, one line per observation; never re-read/edit/reorganise mid-session; duplicates across agents are welcome; non-blocking fallback; generated-evidence retention note | Inside the observation section, after the type and priority definitions — **and** referenced from the action gate in the persona's Operational Protocol (see § 2) |
| `personas/shared/partials/insight-compilation.md` | **Report time** — while writing the report | Compile from the sink, filtered to own `agent` value; curate own entries only; other agents' entries are read-only context; note cross-agent corroboration; consume leniently (salvage unparseable lines); the forcing function (nothing-found entry) | Immediately before or beside the persona's output-format / report-template section, which is what the agent is reading at generation time |

#### Sink location resolution

The reference's Location row reads *"The plan folder (beside `plan.md`). In work-package contexts,
the WP's working folder equivalent."* The second sentence names a location that does not exist —
there is no WP working folder in either the ledger store or the plan folder. The term is undefined,
so `insight-capture.md` would be shipping an unresolvable instruction to seven personas.

Both partials therefore resolve the sink through a **two-rung ladder**, evaluated once at session
start and then fixed for the session:

| Rung | Condition | Sink path |
|---|---|---|
| 1 | The session is plan-driven — `plan.md` is present in the working folder, or `plan_path` was returned by the pre-flight | `{plan folder}/insights.jsonl` |
| 2 | Otherwise | `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl`, relative to the repository root; created if absent |

Rung 1 is the path every persona in this plan takes: all seven producing personas are plan-driven,
and the ledger suite obtains its plan folder from the `plan_path` key added in § 4. Rung 2 exists to
give the undefined term a defined value, and is reached in exactly two situations: a session that
has no plan document at all, and the reference's non-blocking fallback when the plan folder cannot
be written.

Rung 2's properties differ from rung 1's in ways the partial must state:

- **Per session, not per plan.** Outside a plan there is no shared unit of work, so the file is
  scoped by date and slug rather than by folder. Cross-agent corroboration does not apply.
- **`{slug}` is derived, never invented** — kebab-cased from the same source the persona already uses
  to title its report. Two agents in one session must resolve to the same filename.
- **Gitignored, not archived.** `docs/agents/insights/` is added to this workspace's `.gitignore`,
  and the reference states the folder is intended to be gitignored in consuming repositories. Rung 2
  files sit entirely outside the derived-evidence classification work of § 5 — no Git Committer
  relocation rule, no archival boundary, no `implementation-history/` handling. Retention is
  "kept until the user prunes"; no persona reads a rung 2 file from a later session.

`docs/agents/insights/` was chosen over `~/.ai-insights/insights/` (invisible and unreviewable, and
needs a repo-name derivation no persona performs today), over the ledger store (standalone personas
declare no ledger tools, and this is the non-ledger case by definition), and over a new repo-root
directory (`docs/agents/` is already the namespace this ecosystem installs into arbitrary
repositories — the Planner writes `plans/`, the Researcher writes `research/`).

Both partials are parameterised by two new per-persona YAML fields:

| Field | Purpose | Example |
|---|---|---|
| `insight_agent` | Value written to the JSONL `agent` key | `Developer`, `Security Auditor` |
| `insight_report_target` | Human phrase naming where the curated section lands | `` your `ledger_complete_pipeline` comments `` / `` the **Code Insights** section of `synthesis.md` `` |

The nothing-found type (`improvement`) is hardcoded in `insight-compilation.md` rather than
parameterised — every persona in the vocabulary table uses the same value, and no near-term variation
is expected.

The JSONL schema is rendered as a **fully concrete example line**, not as a half-substituted
template. The reference's schema line mixes JSON braces with `{PLACEHOLDER}` braces
(`{"agent": "{AGENT}", "priority": "{PRIORITY}", …}`); rendered for a persona this becomes
half-literal, half-template in a format where braces are syntactically load-bearing, inviting the
agent to emit `{PRIORITY}` verbatim. The partial instead shows one complete, valid line using the
persona's own `insight_agent` value, followed by a field table describing the allowed values — the
shape the reference already uses for its "Example file state" block.

Neither partial may contain MCP tool names (C18) — the only workflow-specific text is supplied
through `insight_report_target`, whose value lives in the persona YAML, not in the shared layer.

`insight_agent` is a dedicated field rather than a reuse of `{{role}}` because standalone personas
carry no `role` field ([constraints.md](personas/docs/agents/project-manifest/constraints.md) C12,
C19) and the build derives a role name only for `name-mapping.json`
([build-personas.js](scripts/build-personas.js) L267–L272), never for the template context. For
ledger personas, which *do* have a `role`, the two values must not drift — see § 6.

**Naming.** `insight-capture.md` / `insight-compilation.md` match the cross-cutting shared-partial
convention already in use (`ax-feedback.md`, `incident-logging.md`, `summary-crafting-guide.md`):
short, behaviour-named, no suite or mechanism prefix.

**Changelog propagation.** Editing a shared partial changes the rendered output of every persona
that includes it. Every consuming persona's YAML therefore needs a `changelog:` entry in the same
change — not only the personas whose own content templates were edited. This applies to the seven
producing personas plus ledger Synthesis.

### 2. Per-persona integration

Each participating persona receives five things, not three. The two additions over the reference's
own integration steps are the **action gate** and the **rework continuation** — both required by
Pattern 15, and both absent from the reference:

| # | Element | Placement | Salience class it creates |
|---|---|---|---|
| 1 | `{{> insight-capture}}` | Inside the observation section, after the type and priority definitions | Knowledge — reference material only |
| 2 | **Action gate** — an explicit append instruction bound to a concrete step of the persona's own Operational Protocol | The numbered protocol step where the observing actually happens | **Action-gated** — fires at the work itself |
| 3 | `{{> insight-compilation}}` with the rekeyed forcing function | Beside the output-format / report-template section | **Generation-time** — read while writing the report |
| 4 | **Amended report step** — the numbered workflow step that produces the report states the insight section is compiled from the agent's own `insights.jsonl` entries, noting cross-agent corroboration | The persona's numbered Workflow | **Checkpoint** — C4a parity, mandatory output slot |
| 5 | **Rework continuation** — a line in the persona's Rework Handling section stating that capture continues during rework | `## Rework Handling` | **Checkpoint** — closes the rework escape hatch |

**Why element 2 is load-bearing.** Placing the capture partial only in the observation section makes
the sink *described* but never *triggered*: the observation section is a knowledge slot the agent
reads once at session start, which is precisely the salience class Pattern 15 rates lowest. Without
a per-persona action gate the change delivers end-of-session reconstruction plus an extra file. The
gate must name a real step of that persona's protocol, so the instruction is re-read every time the
agent moves through the step:

| Persona | Action gate location | Gate wording (substance) |
|---|---|---|
| ledger Developer | [developer-operational-protocol.md](personas/shared/partials/developer-operational-protocol.md) step 3 (Incremental Implementation) | After each implementation chunk, before starting the next, append any observation from that chunk to `insights.jsonl`. |
| standalone Developer | [developer.md](personas/standalone/src/content/developer.md) step 3 (Incremental Implementation) of the inline `## Operational Protocol` | Same wording — the standalone Developer has its own inline protocol, not the shared partial. |
| ledger QA | [qa-operational-protocol.md](personas/shared/partials/qa-operational-protocol.md) — new Verification Stack step after step 4 (Edge-Case Stress Test) | After each Verification Stack layer, append any observation that layer surfaced. |
| ledger Security Auditor | [security-auditor-operational-protocol.md](personas/shared/partials/security-auditor-operational-protocol.md) — the audit pass step | After each audit area, append any non-blocking observation before moving to the next area. |
| ledger Reviewer | [reviewer-operational-protocol.md](personas/shared/partials/reviewer-operational-protocol.md) step 2 (The "Deep Dive") | While reviewing, append each Gold Nugget or out-of-scope pattern as it is noticed, not at the end of the dive. |
| ledger Documentation | [docs-operational-protocol.md](personas/shared/partials/docs-operational-protocol.md) — the documentation pass step | After each document updated, append any gap or staleness noticed in adjacent documentation. |
| Web GUI Specialist | Its Operational Protocol implementation step | After each component or view is implemented and visually verified, append observations from that surface. |

**Rework continuation (element 5).** Rework is where a side-channel is most likely to be dropped —
the agent is deliberately narrowed to the flagged issues, and the Rework Handling section explicitly
tells it *not* to re-run the full Operational Protocol, which is where the action gate lives. The
ledger Developer already has this line ([3-developer.md](personas/ledger/src/content/3-developer.md)
L131, "Observations still apply"); it needs the sink reference added, and the equivalent line must be
created in the personas that lack it:

| Persona | Rework section | Change |
|---|---|---|
| ledger Developer | [3-developer.md](personas/ledger/src/content/3-developer.md) L122–L132 | Amend existing step 6 to reference continued sink appends |
| ledger QA | [4-qa.md](personas/ledger/src/content/4-qa.md) L59 (`## Rework Handling (REWORK_QA)`) | Add a continuation step |
| ledger Documentation | [8-documentation.md](personas/ledger/src/content/8-documentation.md) L55 | Add a continuation step |
| ledger Security Auditor | **Exempt** — no rework path exists. The `security-audit` branch never emits a `REWORK` action; the persona's `## Workflow` step 6 is its only re-entry point, and it re-runs the full protocol (including the action gate). | N/A |
| ledger Reviewer | **Exempt** — no rework path exists. The Reviewer's self-rework fallback emits `RUN_REVIEW`, which re-runs the full protocol (including the action gate). The changelog records `REWORK_REVIEW` as a removed phantom action. | N/A |

Four personas need a named observation section created before the partials have a home:

| Persona | Current state | Section to add |
|---|---|---|
| ledger QA | Types exist only in the tool parameter description | `## Test Insight Observer` in `qa-operational-protocol.md` |
| ledger Documentation | No vocabulary at all | `## Documentation Insight Observer` in `docs-operational-protocol.md` |
| ledger Security Auditor | Vocabulary exists in the output-format partial | Promote to a named `## Security Insight Observer` block in `security-auditor-operational-protocol.md` |
| ledger Reviewer | "Capture Insights" step, no vocabulary | `## Review Insight Observer` in `reviewer-operational-protocol.md` |

Placing these in the **shared** operational-protocol partials keeps a single definition per role and
matches where the Developer's equivalent guidance already lives
([developer-operational-protocol.md](personas/shared/partials/developer-operational-protocol.md) L9).

**Each new observer section gets a Scope & Boundaries table.** The Developer's observer opens with a
two-column In Scope / Out of Scope table
([3-developer.md](personas/ledger/src/content/3-developer.md) L77–L90) precisely because an observer
duty with no stated edge drifts into the neighbouring persona's territory. The Design Guide requires
this whenever a persona's territory borders another's. Four new observers without a boundary table
would produce architectural commentary from QA and code-quality opinions from Documentation. Keep
each table to three or four rows — the guide's 60-second rule and Pattern 15's "more prose without
more triggers is net-negative" both apply:

| Persona | In Scope (three or four rows) | Out of Scope |
|---|---|---|
| ledger QA | Test-coverage gaps in the areas verified; flaky or order-dependent tests encountered; missing edge-case fixtures; test-harness friction | Production code architecture; refactoring proposals; documentation quality; release readiness |
| ledger Security Auditor | Non-blocking hardening opportunities in audited files; defence-in-depth suggestions; security-relevant conventions | Confirmed vulnerabilities and risks (formal findings — see below); architectural security strategy; compliance certification |
| ledger Reviewer | Gold Nuggets — valuable patterns worth reusing; out-of-scope improvements noticed during the dive; cross-cutting maintainability themes | Blocking findings; Fix-Forward records; `documentation-forward` items (all pipeline comments — see below); implementation decisions inside the WP scope |
| ledger Documentation | Documentation gaps and staleness in adjacent docs; inconsistent terminology; missing cross-references | Code quality; test coverage; architectural decisions; release notes content |
| Web GUI Specialist | (Existing table at [web-gui-specialist.md](personas/standalone/src/content/web-gui-specialist.md) L81–L87 — unchanged) | — |

**Foreground/side-channel collision — Reviewer and Security Auditor.** For the Developer, QA, and
Documentation, observing is genuinely a *side*-channel: the foreground task is implementing, testing,
or writing docs. For the Reviewer and Security Auditor, producing findings **is** the foreground
task. Adding an observation side-channel on top of a findings-production task invites the same
finding being written to both the sink and the pipeline comments, and — worse for the Security
Auditor — a verdict-affecting finding landing *only* in the sink. Each therefore states the split
positively, not merely as an exclusion:

- **Reviewer.** Gold Nuggets and out-of-scope patterns go to the sink. Blocking findings,
  `reviewer-applied-fix` records, and `documentation-forward` items go to pipeline comments only and
  are never routed through the sink. The Documentation agent reads `documentation-forward` from
  code-review pipeline comments
  ([reviewer-operational-protocol.md](personas/shared/partials/reviewer-operational-protocol.md)
  L55); routing them through derived evidence would break that contract.
- **Security Auditor.** See the vocabulary note below.

**One side-channel per persona.** The Design Guide caps each persona at one continuous side-channel.
Verify during implementation that no persona ends up with two: `{{> ax-feedback}}` is
checkpoint-slotted (emitted at a fixed workflow step) and therefore does not count, but the check
must be performed explicitly rather than assumed.

The observation vocabularies are fixed by this plan so they are not invented during implementation:

| Persona | `insight_agent` | `insight_report_target` | Sidecar `type` values | Nothing-found type |
|---|---|---|---|---|
| ledger Developer | `Developer` | `` your `ledger_complete_pipeline` comments `` | `code-smell`, `refactor`, `improvement`, `debt`, `convention` | `improvement` |
| ledger QA | `QA` | `` your `ledger_complete_pipeline` comments `` | `bug`, `regression`, `edge-case`, `coverage-gap`, `improvement` | `improvement` |
| ledger Security Auditor | `Security Auditor` | `` your `ledger_complete_pipeline` comments `` | `hardening`, `info`, `improvement` — **non-blocking observations only** | `improvement` |
| ledger Reviewer | `Reviewer` | `` your `ledger_complete_pipeline` comments `` | `gold-nugget`, `architecture`, `maintainability`, `performance`, `convention`, `improvement` | `improvement` |
| ledger Documentation | `Documentation` | `` your `ledger_complete_pipeline` comments `` | `doc-gap`, `doc-stale`, `doc-inconsistency`, `improvement` | `improvement` |
| standalone Developer | `Developer` | `` the **Code Insights** section of `synthesis.md` `` | same as ledger Developer | `improvement` |
| Web GUI Specialist | `Web GUI Specialist` | `` the **Interface Insights** section of `synthesis.md` `` | `visual-bug`, `ux-friction`, `accessibility-gap`, `performance-risk`, `consistency`, `refactor`, `improvement` | `improvement` |

QA's four types are taken verbatim from the `ledger_complete_pipeline` parameter description
([pipeline.ts](mcp-server/src/tools/pipeline.ts) L336) so the sidecar and the ledger comment channel
share one vocabulary. `improvement` is added to the QA, Reviewer, and Documentation lists solely to
give each a benign nothing-found type; no other type is shared across personas, satisfying the
reference's Step 4 (keep vocabularies persona-specific).

**The Security Auditor's sink vocabulary excludes `vulnerability` and `risk`.** Those two types name
findings that determine the auditor's PASS/FAIL verdict. `insights.jsonl` is derived working
evidence that no downstream agent reads mid-session and that is explicitly excluded from every
archival source list by § 5 of this plan — so a confirmed vulnerability recorded only in the sink
would never reach the pipeline verdict, the Reviewer, or the synthesis. Offering `vulnerability` as
a sink type creates a plausible-looking path for a real security finding to be silently dropped.
The sink therefore carries only the auditor's non-blocking `Info`-tier material (`hardening`, `info`,
`improvement`), and the Security Insight Observer section states the boundary as a hard rule:

> Confirmed vulnerabilities and risks are formal findings. Record them through your normal findings
> channel and reflect them in your verdict. Never route a finding that affects your PASS/FAIL
> decision through `insights.jsonl` — the sink is read only at report-compilation time and by no
> downstream agent.

The Reviewer's `documentation-forward` and `reviewer-applied-fix` comment types stay **out** of the
sidecar vocabulary for the same class of reason. They are workflow handoff signals consumed by the
Documentation agent and the audit trail, not observations — routing them through a derived-evidence
file would break the Documentation agent's contract with the code-review pipeline comments.

### 3. Compilation at synthesis time

Two personas write a synthesis document and must compile from the sink:

- **ledger Synthesis** — gains a `### Code Insights` section in
  [synthesis-output-format.md](personas/shared/partials/synthesis-output-format.md) and a new
  Operational Protocol step in
  [synthesis-operational-protocol.md](personas/shared/partials/synthesis-operational-protocol.md)
  that reads `insights.jsonl` from the plan folder and folds **all agents'** entries into that
  section, grouped by agent and ordered by priority. Synthesis is the one consumer permitted to read
  across agent values — the reference's "curate only your own entries" rule governs the *producing*
  personas, and Synthesis produces none. Cross-agent duplicates are surfaced as corroboration rather
  than deduplicated away, per reference rule 2.
- **standalone Developer** and **Web GUI Specialist** — their existing `### Code Insights` /
  `### Interface Insights` synthesis blocks are already the report destination; only the compilation
  source changes from recall to the sink.

The Web GUI Specialist additionally gains a "How to Record Observations" subsection with the forcing
function — it currently has neither, unlike the standalone Developer
([web-gui-specialist.md](personas/standalone/src/content/web-gui-specialist.md) L75–L110), so the
reference's Step 2 has nothing to rekey.

### 4. Plan-folder path in `ledger_get_next_action`

Add a `plan_path` key to every JSON payload returned by `getNextAction()`. Implementation: extract the
current body of `getNextAction()` into an inner function and have the exported handler post-process
the result, parsing the payload, injecting `plan_path`, and re-serialising — exactly the shape
`embedHandoffStatusInWait()` already uses
([workflow-next-action-batch.ts](mcp-server/src/tools/workflow-next-action-batch.ts) L48–L82). A
single wrapper covers all 30+ return sites; error responses (plain text, `isError: true`) pass through
untouched.

This also repairs the Synthesis persona's pre-existing broken reference to "the pre-flight `plan_path`
value" (see Architectural Context) — that instruction becomes true rather than aspirational. Step 9
corrects the derivation: `project_storage_path` **equals** the `plan_path` returned by
`ledger_get_next_action` (no `dirname()`), because `resolveProjectPath()` returns the plan folder
itself, not a parent of it.

### 5. Derived-evidence classification

`insights.jsonl` is classified as generated working evidence at all four boundaries:

| Boundary | Treatment |
|---|---|
| Git Committer | Relocated **with** the plan folder to `implementation-history/`, but never grouped as a source document and never used to infer requester intent. Differs from `scenario-coverage.md`, which is never moved, because the reference mandates "Archived with the folder. Never deleted by any persona." |
| Standalone Archiver | Never supplied as an import source; never reported as an archived authored file. |
| `importStandaloneProject()` allowlist | Unchanged — remains excluded. Documented as an explicit exclusion in the method's JSDoc rather than left implicit. |
| Knowledge Archiver | Added to the Mode B expected-archive table as optional, and to both Mode A and Mode B source-reading orders as a low-priority supplementary source consulted only when `synthesis.md` coverage is thin. |

No persona creates, rotates, or deletes the file (reference Step 5) — the first append creates it.

All four boundaries concern **rung 1** files only. Rung 2 files
(`docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl`) are gitignored, live outside any plan folder, and
are therefore invisible to every boundary above — no classification rule is needed for them. This is
the principal reason rung 2 was placed in a gitignored directory rather than beside the session's
output artefact.

### 6. Build-time validation of `insight_agent`

For the five ledger personas, `insight_agent` is a verbatim copy of the persona's `role` — which is
itself validated against `shared/workflow-manifest.json`, the workspace's single source of truth for
agent role names. Introducing an unvalidated second copy of a manifest-derived value is exactly the
drift class the root `AGENTS.md` Cross-System Dependencies table exists to prevent, and the failure
is silent: a stale `insight_agent` produces sink entries whose `agent` value no persona filters on,
so the producing agent's own compilation step finds nothing and the forcing function fires with a
false "clean" entry.

Add a validation rule to [scripts/build-personas.js](scripts/build-personas.js), alongside the
existing `{{agent_slug_*}}` cross-reference block (L367–L454) — the only validator in the workspace
persona build that unconditionally fails the build via `process.exit(1)` in both real and `--check`
runs:

- If a persona's YAML defines both `role` and `insight_agent`, the two must be identical. Mismatch
  is a build error.
- If a persona defines `insight_report_target` it must also define `insight_agent`, and vice versa —
  the two partials require both.
- Standalone personas (no `role`) are exempt from the first rule; their `insight_agent` values are
  covered by the reference document's agent-name list and AC-11.

Add a corresponding row to the root [AGENTS.md](AGENTS.md) Cross-System Dependencies table so the
coupling is discoverable from the workspace entry point, not only from
`personas/docs/agents/project-manifest/constraints.md`.

---

## Rationale

**Why shared partials rather than seven inline blocks.** The reference's Step 1 template is identical
across personas except for three substitutions. Seven copies would drift; the `ax-feedback.md`
precedent shows a shared behavioural partial works cleanly across both suites.

**Why two partials rather than one.** The seven rules in the reference's template fire at two
different times — four while working, three while writing the report. A single block forces the
report-time rules to be stated in the observation section, dozens of tool calls before they apply.
Pattern 15 rates that placement as the weakest salience class and prescribes the fix directly:
restate a generation-time instruction at the point where it fires. Splitting costs one extra file and
buys the compilation rules a generation-time trigger.

**Why the action gate is not optional.** This plan's own justification is that a triggerless duty
degrades silently. A capture instruction placed only in a knowledge section is itself a triggerless
duty — the agent must spontaneously recall it while absorbed in implementation, which is the failure
being fixed. Binding the append to a named Operational Protocol step converts it to an action-gated
duty, the second-most durable salience class. Without it the plan produces a documented sink that
stays empty, and the forcing function then fires a false "clean" entry at report time, which is worse
than no sink at all: it manufactures positive evidence that observation happened.

**Why Rework Handling needs its own line.** Rework sections explicitly instruct the agent *not* to
re-run the full Operational Protocol — which is precisely where the action gate lives. Rework
therefore silently removes the trigger unless the continuation is stated in the rework section
itself. The ledger Developer already recognises this ("Observations still apply"); the pattern is
generalised to every persona with a rework path.

**Why the Security Auditor's sink excludes `vulnerability` and `risk`.** The sink is derived evidence
that no downstream agent reads and that § 5 deliberately excludes from every archival source list.
A finding that determines a PASS/FAIL verdict must not have a plausible-looking route into a
write-only channel. Restricting the vocabulary to `Info`-tier material makes the safe path the only
path, rather than relying on the agent to remember which of its findings are verdict-affecting.

**Why the new observers need boundary tables.** The Developer's observer has one because an
observation duty with no stated edge expands into the neighbouring persona's territory — a specialist
persona that starts commenting outside its lens violates the guide's Specialists Over Generalists
principle. Four new observers introduced without boundaries would predictably produce architectural
commentary from QA and code-quality opinions from Documentation, which the Reviewer then has to
discount.

**Why new YAML fields rather than `{{role}}`.** Standalone personas have no `role` field by design
(C19). Introducing one would break the slug-based standalone convention (C12) and pollute
`name-mapping.json` role derivation. Two narrowly-scoped fields with concrete consumers cost less
than bending the suite model. A third field (`insight_nothing_found_type`) was considered but dropped
because the value is `improvement` for every persona and no near-term variation is expected —
hardcoding it in the partial is more proportionate.

**Why the sink location is a two-rung ladder rather than a single path.** The reference's fallback
location — "the WP's working folder equivalent" — names nothing that exists; no such folder is created
by the ledger store or by any persona. Shipping that phrase into a shared partial would hand seven
personas an unresolvable instruction at exactly the moment the primary path failed. A ladder with a
second rung that is fully derivable from the repository root removes the ambiguity without adding a
branch the agent has to reason about: it evaluates the condition once and the path is fixed for the
session.

**Why rung 2 lives in `docs/agents/insights/`.** Three properties matter. It is already the namespace
this persona ecosystem installs into arbitrary repositories, so it adds no new top-level directory.
It is gitignored, which keeps rung 2 files entirely outside the derived-evidence classification work
of § 5 — no relocation rule, no archival boundary, no source-document question. And it is derivable
from the workspace root alone, with no MCP call, no store resolution, and no question to the user —
which matters because rung 2 is reached precisely when the plan-driven machinery is absent or has
already failed.

**Why rung 2 is a dated file rather than a folder.** Outside a plan there is no shared unit of work
for multiple agents to converge on, so the shared-file rationale (cross-agent corroboration) has
nothing to operate on. A session-scoped filename is the honest shape, and it avoids creating an
unbounded folder whose contents no persona ever reads back.

**Why the type vocabularies are fixed in this plan.** Four personas have no vocabulary today. Leaving
their definition to implementation would produce ad-hoc types that diverge from the
`ledger_complete_pipeline` parameter description, creating two competing vocabularies for the same
observations.

**Why the observer sections live in shared operational-protocol partials.** Those partials are already
where per-role methodology lives, and each is consumed by exactly one persona — so "shared" here means
"suite-agnostic layer", not "reused across personas". This keeps the content templates thin and
consistent with the Developer's existing arrangement.

**Why `plan_path` goes on `ledger_get_next_action` rather than a persona tool-list change.** Every
ledger persona 3–9 already calls this tool as its first action and already declares it. Adding
`ledger_detect_project` to six personas' `mcp_tools` arrays would widen six tool surfaces and add a
round-trip to every session for a value the server already computed. The wrapper approach also fixes
the Synthesis persona's existing dangling reference at no extra cost.

**Why Synthesis reads all agents' entries.** The reference's own-entries-only rule exists to stop
producing agents from re-reporting each other's findings as their own. Synthesis is a pure consumer
that attributes every line to its originating agent, so the rule's rationale does not apply.

**Why the Persona Curator review is executed during implementation rather than recorded as a
synthesis follow-up.** A follow-up item written into `synthesis.md` after the work is complete has no
trigger — nothing in any subsequent session forces anyone to act on it. That is the same triggerless
duty this plan exists to eliminate, so deferring the review that way would contradict the plan's own
governing principle. Delegating the persona edits to the Persona Curator sub-agent during the
implementation step makes the design review part of the work rather than a promise about it, and the
Curator Verification Checklist then becomes a QA gate on delivered content instead of an aspiration.
The synthesis note is retained as a record, but it documents a review that has already happened.

**Why `insight_agent` is validated at build time.** The ledger values duplicate manifest-derived
`role` names. Silent drift produces sink entries no persona filters on, so the compilation step finds
nothing and the forcing function writes a false "clean" observation — a failure that looks like
success in the report. A build-time equality check costs one comparison and removes the failure mode
entirely.

**Why the JSONL schema is shown as a concrete line.** The reference's schema template interleaves
JSON braces with `{PLACEHOLDER}` braces. After substitution the agent sees a line that is half real
data and half template markers, in a format where braces are syntactically significant — the most
likely reading is that `{PRIORITY}` should be emitted literally. A complete valid example plus a
field table removes the ambiguity without adding length.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|---|---|---|---|
| Capture-instruction delivery | Two shared partials split by firing time + two YAML fields (nothing-found type hardcoded) | (a) Inline the block in each content template; (b) one partial per persona; (c) a single partial with per-persona `{{#if}}` branches; (d) three YAML fields including `insight_nothing_found_type`; (e) one combined partial as the reference specifies | (a) guarantees drift across seven copies; (b) multiplies files without removing duplication; (c) puts persona-specific text in the shared layer, which C18 forbids for MCP content and which makes the partial unreadable; (d) adds a per-persona field whose value is `improvement` everywhere — hardcoding it in the partial is more proportionate; (e) states the report-time rules in a knowledge section far from where they fire, which Pattern 15 identifies as the weakest placement. Two partials plus two fields keeps one definition per rule and puts each rule at its trigger. |
| Capture duty trigger | Action gate bound to a named Operational Protocol step, in addition to the observation-section partial | (a) Observation-section placement only (the reference's own integration steps); (b) a single mid-workflow "capture checkpoint" step; (c) rely on the report-time forcing function alone | (a) leaves the duty triggerless — the exact failure the sidecar exists to fix; (b) one checkpoint per session collapses back to batch capture and loses the in-the-moment observations the sink is for; (c) produces end-of-session reconstruction plus a false "clean" entry when the sink is empty. Binding the append to a step the agent traverses repeatedly is the only option that makes capture concurrent with the work. |
| Sink location outside a plan folder | Two-rung ladder; rung 2 = `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl`, gitignored | (a) Ship the reference's "WP's working folder equivalent" verbatim; (b) `~/.ai-insights/insights/{repo}/…`; (c) the ledger store under `{storeRoot}/{repoName}/`; (d) beside the session's primary artefact (`docs/agents/research/`, `bug-reports/`, …); (e) a new repo-root `.agent-work/` | (a) names a folder that does not exist — an unresolvable instruction delivered at the moment the primary path failed; (b) is invisible to the user and unreviewable, and needs a repo-name derivation no persona performs; (c) is a capability mismatch — standalone personas declare no ledger tools, and this is the non-ledger case by definition; (d) scatters `.jsonl` files through curated output directories and collapses when the session produces no artefact; (e) adds a top-level directory for a concern `docs/agents/` already owns. Rung 2 is derivable from the repo root alone, already gitignored, and sits outside every archival boundary. |
| Rung 2 granularity | One dated file per session | A `docs/agents/insights/` folder mirroring the plan-folder shape | Outside a plan there is no shared unit of work, so cross-agent corroboration has nothing to operate on, and a folder accumulates files no persona ever reads back. |
| Security Auditor sink vocabulary | `hardening`, `info`, `improvement` — non-blocking only | (a) `vulnerability`, `risk`, `improvement` as originally scoped; (b) full vocabulary plus a written rule that verdict-affecting findings also go to pipeline comments | (a) and (b) both leave a route by which a confirmed vulnerability lands only in a write-only derived-evidence file that no downstream agent reads and no archival path retains as source. (b) relies on the agent remembering a dual-write rule under exactly the conditions where instruction salience is weakest. Removing the types removes the failure mode. |
| Scope boundaries for new observers | Three-to-four-row In Scope / Out of Scope table per observer | (a) Omit — rely on the persona's existing scope constraints; (b) reuse the Developer's full table | (a) predictably produces cross-territory commentary, which the Reviewer then discounts; (b) imports Developer-specific rows that do not apply to QA or Documentation and pushes each persona past the 60-second rule. Short bespoke tables give the boundary without the bulk. |
| Persona-design conformance review | Persona Curator sub-agent executes the persona edits during implementation; checklist becomes a QA gate | (a) Developer agent implements, Curator reviews afterwards via a synthesis follow-up note; (b) no review | (a) creates a triggerless duty in a plan whose entire purpose is eliminating triggerless duties, and the review would be performed after the work is marked complete; (b) puts seventeen persona files through an agent with no persona-design expertise. Delegation makes the review part of the work. |
| Agent-name source | New `insight_agent` YAML field, build-validated against `role` where present | Reuse `{{role}}`; derive from `slug`; hardcode per template; add the field with no validation | `{{role}}` does not exist in the standalone suite; `slug` values (`developer-standalone`, `web-gui-specialist`) are not the reference's agent names; hardcoding defeats the shared partial. Adding the field unvalidated creates a second unguarded copy of a manifest-derived value whose drift fails silently. An explicit field plus a build-time equality check works in both suites and cannot drift on the ledger side. |
| JSONL schema presentation | One fully concrete example line + a field table | Render the reference's mixed JSON/`{PLACEHOLDER}` template verbatim | After substitution the template is half-literal and half-placeholder in a brace-significant format, inviting the agent to emit `{PRIORITY}` literally. A concrete line plus a table is unambiguous at the same length. |
| Plan-folder path delivery | `plan_path` key on all `ledger_get_next_action` payloads | (a) Add `ledger_detect_project` to six personas; (b) instruct agents to infer the folder from the workspace; (c) add `plan_path` only to the `GENERATE_SYNTHESIS` payload; (d) skip the sidecar for ledger personas | (a) widens six tool surfaces and adds a round-trip; (b) is unreliable and violates strict grounding; (c) leaves agents 3–8 without a path, which is where capture actually happens; (d) abandons the primary use case. A single server-side wrapper serves every persona and every action. |
| Where the observer sections live | Shared operational-protocol partials | Per-persona content templates; a new shared `*-insight-observer.md` per role | Content templates would place methodology outside the partial layer that already owns it; a second partial per role doubles the file count for text that has exactly one consumer each. |
| Git Committer treatment of the sink | Relocate with the plan folder; never treat as source | Mirror `scenario-coverage.md` exactly (never move) | Never moving it would strand the file in the emptied plan folder, contradicting the reference's "Archived with the folder. Never deleted by any persona." Relocating without source status satisfies both retention and classification. |
| Synthesis read scope | All agents' entries | Own-entries-only (uniform rule) | Synthesis authors no entries, so an own-entries filter would make its section permanently empty. Attribution is preserved by rendering the `agent` field. |
| Reviewer handoff comment types | Excluded from the sidecar vocabulary | Include `documentation-forward` / `reviewer-applied-fix` as sidecar types | The Documentation agent reads `documentation-forward` from code-review pipeline comments ([reviewer-operational-protocol.md](personas/shared/partials/reviewer-operational-protocol.md) L55); routing them through derived evidence would break that contract. |

---

## Pattern Alignment

- **Follows** the shared-behavioural-partial pattern established by
  [ax-feedback.md](personas/shared/partials/ax-feedback.md) — a short cross-suite fragment included by
  both ledger and standalone content templates.
- **Follows** the per-role methodology placement of
  [developer-operational-protocol.md](personas/shared/partials/developer-operational-protocol.md) by
  putting the four new observer sections in the corresponding `*-operational-protocol.md` partials.
- **Follows** the payload-enrichment pattern of `embedHandoffStatusInWait()`
  ([workflow-next-action-batch.ts](mcp-server/src/tools/workflow-next-action-batch.ts) L48–L82) —
  parse, add a key, re-serialise — for the `plan_path` injection.
- **Follows** the explicit derived-vs-authored classification pattern of
  [git-committer.md](personas/standalone/src/content/git-committer.md) and
  [standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md).
- **Follows** the numbered-workflow-step parity contract
  ([constraints.md](personas/docs/agents/project-manifest/constraints.md) C4a) — every persona that
  gains the capture partial also gains or amends a numbered workflow step in the same change.
- **Follows** Pattern 15 (Trigger Anchoring) of the
  [Persona Design Guide](personas/docs/persona-design-guide.md) v2.5 — every instruction introduced
  by this plan is placed at a concrete trigger: append rules at an action gate in the Operational
  Protocol, compilation rules at the generation-time output template, the forcing function at a
  mandatory output slot, and the rework continuation at the rework checkpoint.
- **Follows** Pattern 6's two required mitigations in full — forcing function *and* incremental
  capture sink — with the sink instrumented at its trigger rather than merely described.
- **Follows** the guide's "at most one continuous side-channel per persona" rule; the implementation
  verifies no persona ends up with two, and treats `ax-feedback` as checkpoint-slotted rather than
  continuous.
- **Follows** the scope-boundary-table pattern of the Developer's Code Insight Observer
  ([3-developer.md](personas/ledger/src/content/3-developer.md) L77–L90) for each of the four new
  observer sections.
- **Follows** the hard-fail build-validation pattern of the `{{agent_slug_*}}` cross-reference block
  in [build-personas.js](scripts/build-personas.js) (L367–L454) — collect errors, `console.error`,
  `process.exit(1)`, runs unconditionally in both real and `--check` modes — by adding the same
  class of build-time check for `insight_agent`. Does **not** follow the plugin’s
  `validateRole` pattern, which returns `severity: 'warning'` and does not fail the build under
  the current config.
- **Follows** the `docs/agents/` namespace convention this persona ecosystem already installs into
  arbitrary repositories (`plans/` from the Planner, `research/` from the
  [Researcher](personas/standalone/src/content/researcher.md) L51,
  `implementation-history/` from the Git Committer) for the rung 2 sink directory, rather than
  introducing a new top-level location.
- **Follows** the gitignored-agent-artefact convention of the existing "Ledger temporary plan
  artefacts" block in [.gitignore](.gitignore) for the rung 2 directory.
- **Departs** from the reference's Location value, which names a "WP's working folder equivalent"
  that does not exist. Replaced with a defined two-rung ladder; the reference is amended in step 1 so
  the two documents agree. Justified in Rationale.
- **Departs** from `scenario-coverage.md`'s "never relocate" handling for the Git Committer, because
  the reference mandates retention alongside the plan folder. Justified in Considered Alternatives.
- **Departs** from the reference's uniform "curate only your own entries" rule for the Synthesis
  persona, which is a pure consumer. Justified in Rationale.
- **Departs** from the reference's single-block integration template, splitting it across two
  partials so each rule sits at its firing point. The reference is amended in step 1 so the two
  documents agree. Justified in Rationale.
- **Departs** from the reference's uniform vocabulary guidance for the Security Auditor, excluding
  verdict-affecting types from the sink. Justified in Approach § 2 and Rationale.
- **Follows** the established parameterised-shared-partial pattern — `developer-strict-constraints.md`
  uses `{{role}}`, `pm-subagent-roster.md` uses `{{agent_*}}`. This plan adds `insight_agent` and
  `insight_report_target` as YAML-driven substitutions in the new `insight-capture.md` and
  `insight-compilation.md` partials. Justified by the standalone suite's lack of a `role` field;
  documented in [api-surface.md](personas/docs/agents/project-manifest/api-surface.md) metadata
  schema.

---

## Detailed Steps

> **Execution note — who performs steps 4 through 14.** These steps modify seventeen persona source
> files. The implementing agent must delegate them to the **Persona Curator** sub-agent in *Maintain*
> mode rather than editing the persona sources directly, passing this plan's Approach § 2 tables
> (action gates, scope boundaries, vocabularies, rework continuations) as the change specification
> and [docs/references/insights-sidecar-reference.md](docs/references/insights-sidecar-reference.md)
> as the reference. The Curator owns conformance to
> [personas/docs/persona-design-guide.md](personas/docs/persona-design-guide.md); a developer agent
> does not. Validate the returned work against the Curator Verification Checklist (step 15) before
> proceeding to the rebuild. Steps 1–3 and 15–18 are performed by the implementing agent directly.

1. **Update the reference document.** In
   [docs/references/insights-sidecar-reference.md](docs/references/insights-sidecar-reference.md):
   replace the four `{Its observation/findings side-channel section}` placeholders in the Integration
   Instructions table with the section names fixed by this plan; add rows for the Web GUI Specialist
   and the two synthesis-compiling consumers (ledger Synthesis, standalone Developer); split the
   Step 1 integration template into an append-time block and a report-time block matching the two
   partials in Approach § 1; replace the mixed JSON/placeholder schema line with a concrete example
   line plus a field table; add a **Step 1b — Add an action gate** instruction requiring the append
   duty to be bound to a named step of the persona's Operational Protocol; add a **Step 6 — Extend
   Rework Handling** instruction; add a **Consumption** subsection stating that Synthesis reads all
   agents' entries while producing personas filter to their own; add a **Verdict-affecting findings**
   rule stating that no finding which determines a PASS/FAIL decision may be routed through the sink;
   replace the Location row's undefined "WP's working folder equivalent" with the two-rung ladder from
   Approach § 1, and add a **Location** subsection stating rung 2's path shape, its per-session (not
   per-plan) scope, the derived-slug rule, and that `docs/agents/insights/` is intended to be
   gitignored in consuming repositories and is therefore outside every archival boundary;
   extend the Curator Verification Checklist with items for the action gate, the scope boundary
   table, the rework continuation, the one-side-channel cap, and the resolved sink location. Bump to
   v1.2 with a changelog line.

2. **Add the two shared partials.** Create
   `personas/shared/partials/insight-capture.md` (append-time) and
   `personas/shared/partials/insight-compilation.md` (report-time), both substituting
   `{{insight_agent}}` and `{{insight_report_target}}`; the nothing-found type `improvement` is
   hardcoded in `insight-compilation.md`. Split the rules per the table in Approach § 1. Render the
   JSONL schema as one complete, valid example line using the persona's own `insight_agent` value,
   followed by a field table — never a half-substituted template. State the two-rung sink location
   ladder in `insight-capture.md` as a resolve-once instruction, and restate the resolved path (not
   the ladder) in `insight-compilation.md` so the compilation step reads from the same file it was
   written to. Neither partial may contain MCP tool names (C18) — rung 1's condition is phrased as
   "`plan.md` is present, or a plan folder path was supplied by your pre-flight", never as a tool
   name. Keep each partial under roughly 20 lines; these are behavioural fragments, not
   documentation.

2b. **Add the rung 2 gitignore entry.** Append `/docs/agents/insights/` to the workspace
   [.gitignore](.gitignore) under the existing "Ledger temporary plan artefacts" block. Rung 1 files
   remain tracked — they live inside plan folders and are covered by § 5's classification rules.

3. **Add the MCP `plan_path` wrapper.** In
   [mcp-server/src/tools/workflow-next-action.ts](mcp-server/src/tools/workflow-next-action.ts),
   rename the existing `getNextAction` body to an internal function and add an exported
   `getNextAction` that awaits it, then injects `plan_path` into the parsed payload before
   re-serialising. Skip injection when the result is an error response or when the payload is not
   valid JSON. Resolve the path with the same `resolveProjectPath(args)` call already present at
   L87. Keep `_internal.getNextAction` pointing at the exported wrapper so existing tests exercise
   the full path.

4. **Ledger Developer.** In
   [3-developer.md](personas/ledger/src/content/3-developer.md): insert `{{> insight-capture}}`
   after the Priority Guidelines block (L110); insert `{{> insight-compilation}}` beside the
   output-format section so the compilation rules and forcing function are read at generation time;
   rekey rule 1 of "How to Record Observations" (L119) to the sink; amend Rework Handling step 6
   (L131) to reference continued sink appends during rework. In
   [developer-operational-protocol.md](personas/shared/partials/developer-operational-protocol.md):
   add the action gate to step 3 (Incremental Implementation) — append observations from each chunk
   before starting the next. In
   [3-developer.yaml](personas/ledger/src/meta/3-developer.yaml): add the `insight_agent` and
   `insight_report_target` fields, update `outputs` overview metadata, add a changelog entry.

   > Note: `developer-operational-protocol.md` is consumed only by the ledger Developer. The
   > standalone Developer has its own inline `## Operational Protocol` — its action gate is added
   > separately in step 10.

5. **Ledger QA.** Add a `## Test Insight Observer` section to
   [qa-operational-protocol.md](personas/shared/partials/qa-operational-protocol.md) containing, in
   order: a three-or-four-row Scope & Boundaries table per Approach § 2, the five types, priority
   guidelines, and `{{> insight-capture}}`. Add a Verification Stack step (after step 4, Edge-Case
   Stress Test) that acts as the action gate — after each verification layer, append the observations
   that layer surfaced. Place `{{> insight-compilation}}` with the sink-keyed forcing function beside
   [qa-output-format.md](personas/shared/partials/qa-output-format.md). Add a continuation step to
   `## Rework Handling (REWORK_QA)` in [4-qa.md](personas/ledger/src/content/4-qa.md) stating that
   capture continues during rework. Add the `insight_agent` and `insight_report_target` fields and a
   changelog entry to [4-qa.yaml](personas/ledger/src/meta/4-qa.yaml). Add a numbered workflow step
   to [4-qa.md](personas/ledger/src/content/4-qa.md) covering the capture phase (C4a parity).

6. **Ledger Security Auditor.** Promote the existing comment vocabulary into a named
   `## Security Insight Observer` section in
   [security-auditor-operational-protocol.md](personas/shared/partials/security-auditor-operational-protocol.md),
   with a Scope & Boundaries table, the **non-blocking-only** vocabulary (`hardening`, `info`,
   `improvement`), and `{{> insight-capture}}`. State the verdict-affecting-findings rule verbatim
   from Approach § 2: confirmed vulnerabilities and risks go through the formal findings channel and
   are never routed through the sink. Add the action gate to the audit-pass step — append non-blocking
   observations after each audit area. Place `{{> insight-compilation}}` beside
   [security-auditor-output-format.md](personas/shared/partials/security-auditor-output-format.md)
   and rekey the nothing-found rule at L15 to the sink. The Security Auditor is **exempt** from the
   rework-continuation requirement: the `security-audit` branch never emits a `REWORK` action, and
   the persona's `## Workflow` step 6 re-runs the full protocol including the action gate. Add
   the `insight_*` fields and a changelog entry to
   [5-security-auditor.yaml](personas/ledger/src/meta/5-security-auditor.yaml); add the workflow step
   to [5-security-auditor.md](personas/ledger/src/content/5-security-auditor.md).

7. **Ledger Reviewer.** Add a `## Review Insight Observer` section to
   [reviewer-operational-protocol.md](personas/shared/partials/reviewer-operational-protocol.md)
   with a Scope & Boundaries table, the six types, and `{{> insight-capture}}`. State the split
   positively: Gold Nuggets and out-of-scope patterns go to the sink; blocking findings,
   `reviewer-applied-fix` records, and `documentation-forward` items are pipeline comments only and
   are never routed through the sink. Add the action gate to step 2 ("The Deep Dive") — append each
   Gold Nugget as it is noticed, not at the end of the dive — and amend step 3 "Capture Insights"
   (L5) accordingly. Place `{{> insight-compilation}}` beside
   [reviewer-output-format.md](personas/shared/partials/reviewer-output-format.md). The Reviewer is
   **exempt** from the rework-continuation requirement: the Reviewer's self-rework fallback emits
   `RUN_REVIEW` (not `REWORK`), which re-runs the full protocol including the action gate; the
   changelog records `REWORK_REVIEW` as a removed phantom action. Add the `insight_*` fields and a
   changelog entry to
   [6-reviewer.yaml](personas/ledger/src/meta/6-reviewer.yaml); amend workflow step 6 in
   [6-reviewer.md](personas/ledger/src/content/6-reviewer.md).

8. **Ledger Documentation.** Add a `## Documentation Insight Observer` section to
   [docs-operational-protocol.md](personas/shared/partials/docs-operational-protocol.md) with a
   Scope & Boundaries table, the four types, and `{{> insight-capture}}`. Add the action gate to the
   documentation-pass step — after each document updated, append any gap or staleness noticed in
   adjacent documentation. Place `{{> insight-compilation}}` beside
   [docs-output-format.md](personas/shared/partials/docs-output-format.md). Add a continuation step
   to `## Rework Handling` in [8-documentation.md](personas/ledger/src/content/8-documentation.md).
   Add the `insight_*` fields and a changelog entry to
   [8-documentation.yaml](personas/ledger/src/meta/8-documentation.yaml); add the workflow step to
   [8-documentation.md](personas/ledger/src/content/8-documentation.md).

9. **Ledger Synthesis — compilation.** Add a step to
   [synthesis-operational-protocol.md](personas/shared/partials/synthesis-operational-protocol.md)
   that reads `insights.jsonl` from the plan folder, salvages unparseable lines as free text, groups
   entries by `agent`, orders by priority, and notes cross-agent corroboration; state that an absent
   file is normal and non-blocking. Add a `### Code Insights` bullet to the report section list in
   [synthesis-output-format.md](personas/shared/partials/synthesis-output-format.md). In
   [9-synthesis.md](personas/ledger/src/content/9-synthesis.md), correct the Knowledge Collection
   paragraph (L50–L55) to state that `project_storage_path` **equals** the `plan_path` returned by
   `ledger_get_next_action` — no `dirname()` — because `resolveProjectPath()` returns the plan
   folder itself, not a child of it. Update the four other `project_storage_path` references in
   `9-synthesis.md` (L77, L83, L88, L94) and the two in
   [ledger-knowledge-archiver.md](personas/ledger-support/src/content/ledger-knowledge-archiver.md)
   (L32, L47) in the same change so the derivation is consistent everywhere. Note that at the
   Knowledge Archiver’s invocation time (Workflow step 8), `synthesis.md` exists only in the plan
   folder — `completeSynthesis()` copies it into the ledger store at step 9, after the Archiver has
   already run. Amend workflow step 6 to state that the report's Code Insights section is compiled
   from the sink. Add a changelog entry and update `inputs`/`outputs` overview metadata in
   [9-synthesis.yaml](personas/ledger/src/meta/9-synthesis.yaml).

   > Synthesis includes **neither** shared partial. It is a pure consumer: it produces no entries, so
   > `insight-capture` does not apply, and `insight-compilation`'s own-agent filter is the opposite
   > of what Synthesis needs. Its read-all-agents instruction is written directly into
   > `synthesis-operational-protocol.md`. It still needs a changelog entry because
   > `synthesis-output-format.md` changes.

10. **Standalone Developer.** In
    [developer.md](personas/standalone/src/content/developer.md): insert `{{> insight-capture}}`
    after Priority Guidelines (L100); insert `{{> insight-compilation}}` immediately before the
    Synthesis Section Template (L115) so the compilation rules sit at the generation-time slot;
    rekey rule 1 (L108) to the sink; amend Workflow step 6 (writes `synthesis.md`) to compile
    `### Code Insights` from the sink; add `insights.jsonl` to the Inputs section's
    generated-evidence note (L22) and to the handoff-retention paragraph (L48). Add the action gate
    **directly** to step 3 ("Incremental Implementation") of the inline `## Operational Protocol`
    in `developer.md` (L52–L63) — the standalone Developer does not include
    `developer-operational-protocol.md` (its only partial include is `{{> ax-feedback}}`), so the
    gate must be placed in its own content template. Add the `insight_agent` and
    `insight_report_target` fields and a changelog entry to
    [developer.yaml](personas/standalone/src/meta/developer.yaml).

11. **Web GUI Specialist.** In
    [web-gui-specialist.md](personas/standalone/src/content/web-gui-specialist.md): add a "How to
    Record Observations" subsection after Priority Guidelines (L110) and insert
    `{{> insight-capture}}`; add `improvement` to the type table; insert
    `{{> insight-compilation}}` with the sink-keyed forcing function immediately before the Synthesis
    Section Template (L114); add the action gate to its Operational Protocol implementation step —
    after each component or view is implemented and visually verified, append that surface's
    observations; amend Operational Protocol step 6 (L59) and the synthesis-writing workflow step to
    compile `### Interface Insights` from the sink; extend the generated-evidence notes (L23, L48).
    Its Scope and Boundaries table (L81–L87) already exists and needs no change. Add the
    `insight_*` fields and a changelog entry to
    [web-gui-specialist.yaml](personas/standalone/src/meta/web-gui-specialist.yaml).

12. **Git Committer classification.** In
    [git-committer.md](personas/standalone/src/content/git-committer.md), add `insights.jsonl` to the
    plan-folder convention paragraph (L106) as generated evidence that is relocated with the plan but
    never grouped as source or used to infer intent; add it to the relocation lists at L110 and L162
    while excluding it from thematic grouping (L31) and from the archival source list (L47). Add a
    changelog entry to [git-committer.yaml](personas/standalone/src/meta/git-committer.yaml).

13. **Standalone Archiver classification.** In
    [standalone-archiver.md](personas/ledger-support/src/content/standalone-archiver.md), extend the
    generated-evidence rule (L54) and the archived-file reporting rules (L82, L119) to name
    `insights.jsonl` alongside `scenario-coverage.md`. Add a changelog entry to
    [standalone-archiver.yaml](personas/ledger-support/src/meta/standalone-archiver.yaml).

14. **Knowledge Archiver source list.** In
    [ledger-knowledge-archiver.md](personas/ledger-support/src/content/ledger-knowledge-archiver.md),
    add `insights.jsonl` as an optional row in the Mode B expected-archive table (L58–L65) and as a
    low-priority supplementary source in both reading orders (L110–L117, L119–L126), consulted only
    when `synthesis.md` coverage is thin. Add a changelog entry to
    [ledger-knowledge-archiver.yaml](personas/ledger-support/src/meta/ledger-knowledge-archiver.yaml).

15. **Run the Curator Verification Checklist.** Before rebuilding, verify every persona modified in
    steps 4–11 against the extended Curator Verification Checklist in
    [docs/references/insights-sidecar-reference.md](docs/references/insights-sidecar-reference.md),
    plus the following items specific to this plan:

    - The action gate names a real, numbered step of that persona's own Operational Protocol.
    - The capture partial is in the observation section **and** the compilation partial is beside the
      output-format section — not both in one place.
    - The Scope & Boundaries table is present and is three or four rows, not a clone of the
      Developer's.
    - The Rework Handling section states that capture continues during rework, **or** the persona is
      named as exempt (Security Auditor and Reviewer — no `REWORK` action exists for either).
    - The Security Auditor's sink vocabulary contains no verdict-affecting type, and the
      verdict-affecting-findings rule is present verbatim.
    - The Reviewer states the positive split (Gold Nuggets → sink; blocking, `reviewer-applied-fix`,
      `documentation-forward` → pipeline comments only).
    - The persona has at most one continuous side-channel; `ax-feedback` is checkpoint-slotted and
      does not count.
    - The rendered JSONL example is a complete valid line with no `{PLACEHOLDER}` markers remaining.
    - The sink location is stated as the two-rung ladder in the capture partial and as the resolved
      path in the compilation partial — no persona contains the phrase "WP's working folder".
    - The persona still reads top-to-bottom in about 60 seconds; nothing was duplicated from
      elsewhere in the persona.

    Any failure returns to the Persona Curator for correction before proceeding. This checklist is a
    blocking gate, not a report.

16. **Add the build-time `insight_agent` validation.** In
    [scripts/build-personas.js](scripts/build-personas.js), alongside the existing `{{agent_slug_*}}`
    cross-reference block (L367–L454) — the only validator that unconditionally fails the build via
    `process.exit(1)` in both real and `--check` runs: collect errors when a persona YAML defines
    both `role` and `insight_agent` with differing values, or defines exactly one of
    `insight_agent` / `insight_report_target`, then call `process.exit(1)` if any errors were found.
    Do **not** implement this as a plugin validator — the plugin’s `validateRole` returns
    `severity: 'warning'`, which escalates to `'error'` only under `warnOnUnknownRole: false` (the
    config sets `true`), and even at `'error'` only fails under `strict: true` (the pre-commit hook
    runs `--check` with no `--strict`). Following that precedent would produce an advisory warning,
    not the build failure AC-19 requires. Standalone personas (no `role`) are exempt from the first
    rule only. Add a fixture-level test in `scripts/tests/` covering both failure cases and the
    standalone exemption.

17. **Document the storage exclusion.** In
    [ledger-store.ts](mcp-server/src/storage/ledger-store.ts), extend the
    `importStandaloneProject()` JSDoc allowlist note (L836–L837) to name `insights.jsonl` as an
    explicitly excluded derived artefact. No behavioural change.

18. **Rebuild and sync.** Run `node scripts/build-personas.js --suite all`, then
    `node scripts/generate-agents-overview.js`, then `node scripts/sync-personas.js`. Verify
    `personas/name-mapping.json` and `docs/agents-overview.md` are regenerated and that
    `node scripts/build-personas.js --check` reports no staleness.

19. **Record the completed Curator review in the synthesis.** Record in the project's `synthesis.md`
    that the persona changes were authored by the **Persona Curator** sub-agent (per the execution
    note above) and verified against the Curator Verification Checklist in step 15, listing the
    seventeen modified persona sources, the two new shared partials, and the two `insight_*` YAML
    fields. This is a record of work performed, not a follow-up request.

    If — and only if — the Curator delegation could not be performed and the persona edits were
    authored directly, the entry instead becomes a **follow-up** item under the synthesis document's
    **Deferred & Follow-Up Items** section (ledger workflow) or **Additional Comments** section
    (standalone workflow), marked as *follow-up*, not *deferred*, and the work is not considered
    closed until the review has run.

    > **Rationale:** A follow-up note in a completed synthesis has no trigger — nothing in any later
    > session forces anyone to act on it. Deferring the design review that way would create exactly
    > the triggerless duty this plan exists to eliminate, and would do so for the review *of that
    > work*. Delegating during implementation (step 15's gate) makes the review part of the work.
    > The synthesis entry documents a review that already happened.

---

## Dependencies

- Step 1 (reference update) blocks steps 4–11 — the Persona Curator delegation passes the reference
  as its specification, so it must contain no placeholders and must already carry the split-template,
  action-gate, rework, and verdict-affecting-findings rules.
- Step 2 (the two shared partials) blocks steps 4–11 — every persona integration includes them.
- Step 2b (gitignore entry) is independent of every other step and may land at any point before
  step 18; it has no code or persona dependency.
- Step 3 (`plan_path`) blocks step 9's correction of the Synthesis `project_storage_path` derivation,
  and is a runtime prerequisite for steps 4–8 to be executable at all in IDE runs.
- Step 4 edits `developer-operational-protocol.md` (ledger Developer only); step 10 independently
  edits the standalone Developer's inline `## Operational Protocol` in `developer.md`. The two steps
  touch different files and do not conflict.
- Step 15 (Curator Verification Checklist) blocks step 18 — it is a gate, not a report. Failures
  return to steps 4–11.
- Step 16 (`insight_agent` validation) must land before step 18, so the rebuild exercises the new
  check against the real YAML.
- Step 18 (rebuild) depends on every preceding persona-source step.
- Step 19 (synthesis record) is written when the synthesis document is produced, after all
  implementation steps are complete.
- Documentation Updates depend on steps 2, 3, 16, and 18.

---

## Required Components

**New files:**
- `personas/shared/partials/insight-capture.md` (new — append-time rules)
- `personas/shared/partials/insight-compilation.md` (new — report-time rules + forcing function)

**Modified — persona sources:**
- `personas/ledger/src/content/`: `3-developer.md`, `4-qa.md`, `5-security-auditor.md`,
  `6-reviewer.md`, `8-documentation.md`, `9-synthesis.md`
- `personas/ledger/src/meta/`: `3-developer.yaml`, `4-qa.yaml`, `5-security-auditor.yaml`,
  `6-reviewer.yaml`, `8-documentation.yaml`, `9-synthesis.yaml`
- `personas/shared/partials/`: `developer-operational-protocol.md` (action gate),
  `developer-output-format.md`, `qa-operational-protocol.md`, `qa-output-format.md`,
  `security-auditor-operational-protocol.md`, `security-auditor-output-format.md`,
  `reviewer-operational-protocol.md`, `reviewer-output-format.md`,
  `docs-operational-protocol.md`, `docs-output-format.md`,
  `synthesis-operational-protocol.md`, `synthesis-output-format.md`
- `personas/standalone/src/content/`: `developer.md`, `web-gui-specialist.md`, `git-committer.md`
- `personas/standalone/src/meta/`: `developer.yaml`, `web-gui-specialist.yaml`, `git-committer.yaml`
- `personas/ledger-support/src/content/`: `standalone-archiver.md`, `ledger-knowledge-archiver.md`
  (also: `project_storage_path` derivation fix — L32, L47)
- `personas/ledger-support/src/meta/`: `standalone-archiver.yaml`, `ledger-knowledge-archiver.yaml`

> Every persona YAML consuming a modified shared partial needs a `changelog:` entry, including
> personas whose own content template was not touched.
> `9-synthesis.md` also receives `project_storage_path` derivation fixes at L77, L83, L88, L94
> (in addition to the Knowledge Collection correction at L50–L55).

**Modified — build system:**
- `scripts/build-personas.js` (`insight_agent` / `insight_report_target` validation)
- `scripts/tests/` (new validation test)

**Modified — workspace configuration:**
- `.gitignore` (rung 2 sink directory `/docs/agents/insights/`)

**Modified — MCP server:**
- `mcp-server/src/tools/workflow-next-action.ts`
- `mcp-server/src/storage/ledger-store.ts` (JSDoc only)
- `mcp-server/tests/tools/workflow-next-action.test.ts`

**Modified — documentation:**
- `docs/references/insights-sidecar-reference.md`
- `personas/docs/agents/project-manifest/api-surface.md`
- `personas/docs/agents/project-manifest/file-tree.md`
- `personas/docs/agents/project-manifest/constraints.md`
- `AGENTS.md` (root — Cross-System Dependencies row)
- `mcp-server/docs/agents/workflow-specification/operations.md`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `personas/changelog.md`, `mcp-server/changelog.md`, root `changelog.md`

**Regenerated artefacts:**
- `personas/{ledger,standalone,ledger-support}/{vs-code,claude-code,deep-agents}/`
- `personas/name-mapping.json`, `docs/agents-overview.md`, `.context/`

---

## Assumptions

- Every affected persona already declares filesystem write access, so no `tools` array changes are
  needed. (Verified for ledger agents 3–9 and both standalone personas — all list `edit`.)
- The pipeline's stage ordering guarantees sequential access to the sink; no locking is required
  (reference rule 8).
- Ledger plan folders are writable from the agent's execution context in both IDE and orchestrator
  runs — the same folder already receives `synthesis.md`.
- Adding a key to `ledger_get_next_action` payloads is backward-compatible: the orchestrator's
  `inject_project_path` wrapper does not inspect response payloads, and personas read named keys
  rather than validating payload shape.

---

## Constraints

- Generated persona output must never be hand-edited
  ([constraints.md](personas/docs/agents/project-manifest/constraints.md) C1).
- `personas/shared/partials/` must contain no MCP-specific content (C18).
- Numbered workflow steps must stay in parity with the phase partials a template includes (C4a).
- Persona content must not duplicate tool self-documentation (C4).
- Version bumps come from each persona's `changelog:` block; never add standalone `version:` or
  `last_updated:` fields (root `AGENTS.md` → Cross-System Dependencies).
- Workflow-logic changes update
  [mcp-server/docs/agents/workflow-specification/](mcp-server/docs/agents/workflow-specification/)
  **before** the implementation (root `AGENTS.md` → Manifest Maintenance Rules).
- All new code and scripts must be cross-platform (root `AGENTS.md` → Cross-Platform Policy). The
  persona instructions must not prescribe a shell-specific append command.
- Every persona modification must conform to
  [personas/docs/persona-design-guide.md](personas/docs/persona-design-guide.md) v2.5 — in particular
  Pattern 6 (both mitigations required), Pattern 15 (every duty trigger-anchored; at most one
  continuous side-channel per persona), the scope-boundary rule, and the 60-second readability rule.
- No finding that determines a persona's PASS/FAIL verdict may be routed through `insights.jsonl`.
  The sink is write-only during work and is read by no downstream agent.
- The sink location must be resolvable without an MCP call, a store lookup, or a question to the
  user. Rung 2 is derived from the repository root alone — it is reached precisely when the
  plan-driven machinery is absent or has failed.
- Persona edits are authored by the Persona Curator, not by the implementing developer agent (see
  the execution note in Detailed Steps).

---

## Out of Scope

- **Release Engineer sidecar integration.** Its `improvement` comment type covers "non-blocking
  observations" ([release-engineer-output-format.md](personas/shared/partials/release-engineer-output-format.md)
  L8), but its output is release decisions rather than code observations, and the reference does not
  list it. Recorded in Deferred Items.
- **Machine consumption of `insights.jsonl`.** No GUI view, MCP tool, or script parses the file. The
  reference anticipates future tooling; this plan delivers the capture and human-readable compilation
  only.
- **A dedicated MCP tool for appending insights.** The reference deliberately specifies filesystem
  append so the mechanism works identically in IDE and orchestrator contexts.
- **Migrating existing pipeline comments** into the sidecar format, or backfilling the file for
  completed plans.
- **Per-agent sink files** (`insights-{agent}.jsonl`). Reference rule 8 designates this a curator
  decision triggered only by stage parallelisation, which does not exist today.
- **Standalone Planner, Plan Auditor, Plan Architect Reviewer, and other analysis-only personas.**
  They produce findings documents rather than incidental observations.

---

## Acceptance Criteria

- AC-01: `personas/shared/partials/insight-capture.md` and
  `personas/shared/partials/insight-compilation.md` exist, split the reference's rules by firing time
  per Approach § 1, substitute `{{insight_agent}}` and `{{insight_report_target}}`, hardcode
  `improvement` as the nothing-found type in the compilation partial, render the JSONL schema as a
  complete valid example line with no residual `{PLACEHOLDER}` markers, and contain no MCP tool
  names.
- AC-02: Ledger personas 3, 4, 5, 6, and 8 each include the capture partial inside a named observation
  section, define a type vocabulary matching the table in Approach § 2, and have a forcing function
  keyed off the presence of their own entries in `insights.jsonl`.
- AC-03: Standalone Developer and Web GUI Specialist each include the capture partial, have a
  sink-keyed forcing function, and compile their synthesis insight section from the sink.
- AC-04: Ledger Synthesis reads `insights.jsonl`, renders a `### Code Insights` section grouped by
  agent in `synthesis.md`, notes cross-agent corroboration, and treats an absent file as normal.
- AC-05: Every JSON payload returned by `ledger_get_next_action` includes a `plan_path` key equal to
  the resolved plan-folder path; error responses are unchanged.
- AC-06: The Synthesis persona's Knowledge Collection instructions derive `project_storage_path` as
  equal to the `plan_path` returned by `ledger_get_next_action` (no `dirname()`), and the resolved
  path is the directory that actually contains `synthesis.md` at the Knowledge Archiver's invocation
  time. All six `project_storage_path` references across `9-synthesis.md` and
  `ledger-knowledge-archiver.md` use the corrected derivation.
- AC-07: `insights.jsonl` is explicitly classified as generated evidence in the Git Committer,
  Standalone Archiver, Knowledge Archiver, and the `importStandaloneProject()` JSDoc, and is never
  reported as an archived source document.
- AC-08: Every persona that gained the capture partial also gained or amended a numbered workflow step
  referencing it (C4a parity).
- AC-09: `node scripts/build-personas.js --check` reports no stale output, and
  `node scripts/generate-agents-overview.js --check` reports no staleness, after the rebuild.
- AC-10: `personas/name-mapping.json` reflects the new persona versions from the updated `changelog:`
  blocks.
- AC-11: `docs/references/insights-sidecar-reference.md` contains no unresolved
  `{Its …}` placeholders, documents the Synthesis consumption exception, carries the split
  append-time/report-time template, and includes the action-gate, rework-continuation, and
  verdict-affecting-findings rules plus the extended Curator Verification Checklist.
- AC-12: The full MCP server test suite passes, and no persona YAML introduces a standalone `version:`
  or `last_updated:` field.
- AC-13: Every persona modified in steps 4–11 has a `## Rework Handling` (or equivalent re-entry)
  section that states capture continues during rework. The Security Auditor and Reviewer are exempt:
  neither persona is reachable by a `REWORK` action — the `security-audit` branch returns only
  `RUN_SECURITY_AUDIT` / `WAIT` / `CONTINUE_PIPELINE` etc., and the Reviewer’s self-rework fallback
  returns `RUN_REVIEW`, which re-runs the full protocol including the action gate.
- AC-14: The Security Auditor's sink vocabulary contains no verdict-affecting type
  (`vulnerability` / `risk` absent), and the rendered persona states that findings affecting the
  PASS/FAIL decision are never routed through `insights.jsonl`.
- AC-15: The Reviewer's rendered persona states the positive split — Gold Nuggets and out-of-scope
  patterns to the sink; blocking findings, `reviewer-applied-fix`, and `documentation-forward` to
  pipeline comments only.
- AC-16: Each of the four new observer sections (QA, Security Auditor, Reviewer, Documentation) has
  an In Scope / Out of Scope table of three or four rows.
- AC-17: Every persona that gained the capture partial has an action gate naming a real, numbered
  step of its own Operational Protocol, and the capture and compilation partials are placed at
  different points in the persona (observation section vs. output-format section) rather than
  adjacent.
- AC-18: No modified persona has more than one continuous side-channel duty; `ax-feedback` is
  checkpoint-slotted and is not counted. Verified explicitly, not assumed.
- AC-19: `scripts/build-personas.js` fails the build when a persona defines both `role` and
  `insight_agent` with differing values, or defines exactly one of `insight_agent` /
  `insight_report_target`. Standalone personas without a `role` build successfully.
- AC-20: The root `AGENTS.md` Cross-System Dependencies table contains a row for the `insight_agent`
  / `role` coupling and the two new shared partials.
- AC-21: The persona changes were authored by the Persona Curator sub-agent and passed the step 15
  Curator Verification Checklist before the rebuild. The project's `synthesis.md` records the
  completed review, listing the modified persona sources, the two new shared partials, and the two
  `insight_*` YAML fields. If the delegation could not be performed, the entry is instead a
  **follow-up** item (not deferred) and the work is not closed.
- AC-22: Both shared partials resolve the sink through the two-rung ladder: rung 1 is the plan folder,
  rung 2 is `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl` relative to the repository root. No
  rendered persona contains the phrase "WP's working folder" or any other undefined location.
  `/docs/agents/insights/` is present in the workspace `.gitignore`, and the reference document states
  the rung 2 path, its per-session scope, its derived-slug rule, and its gitignored status.

## Testing Strategy

Three verification surfaces. The MCP server change is behavioural and covered by Vitest against the
existing `workflow-next-action` suite, which already builds temp ledger stores with known plan paths
and can assert the new key across representative action branches. The build-system validation is
behavioural and covered by fixture tests in `scripts/tests/`. The persona changes are declarative
Markdown and YAML with no runtime; they are verified by the build system's `--check` staleness gates,
by a structural review that each acceptance criterion's text is present in the generated output for
all three targets, and by confirming the numbered-step/partial parity contract.

The persona-design criteria (AC-13 through AC-18) are **design-conformance** checks, not text-presence
checks. Grepping for a partial reference proves the partial rendered; it does not prove the action
gate names a real protocol step, that the two partials sit at different points in the persona, or
that a boundary table is scoped rather than copied. These are verified by the Persona Curator against
the step 15 checklist, and QA re-verifies the checklist outcome rather than re-deriving it. Treat a
missing or unverifiable checklist result as a QA failure, not as a documentation gap.

## Test Plan

- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: `plan_path` equals the resolved
  plan folder when `project_path` is supplied — AC-05.
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: `plan_path` equals the resolved
  plan folder when only `cwd_path` is supplied (extends the existing cwd auto-detection block at
  L1658) — AC-05.
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: `plan_path` is present on a
  `WAIT` payload that also carries `handoff_status`, confirming the wrapper composes with
  `embedHandoffStatusInWait` — AC-05.
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: `plan_path` is present on the
  `GENERATE_SYNTHESIS` payload — AC-05, AC-06.
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: an error response (unresolvable
  `cwd_path`) is returned unchanged with `isError: true` and no `plan_path` — AC-05.
- `mcp-server/tests/tools/workflow-next-action.test.ts` — new test: `plan_path` is present on a
  batch-mode (`max_results: 2`) response alongside the `actions` array — AC-05.
- Existing `mcp-server/tests/` suite — regression: all currently passing assertions on
  `ledger_get_next_action` payload contents still pass with the added key — AC-12.
- `scripts/tests/` — new test: a fixture persona with `role: Developer` and
  `insight_agent: Develper` fails the build — AC-19.
- `scripts/tests/` — new test: a fixture persona defining `insight_agent` without
  `insight_report_target` (and the reverse) fails the build — AC-19.
- `scripts/tests/` — new test: a standalone fixture persona with `insight_agent` and no `role` builds
  successfully — AC-19.
- `node scripts/build-personas.js --check` — no stale generated persona output — AC-09.
- `node scripts/generate-agents-overview.js --check` — no stale overview document — AC-09.
- Persona Curator verification against the extended Curator Verification Checklist
  (`docs/references/insights-sidecar-reference.md`) plus the step 15 additions, for each of the seven
  producing personas. This is a blocking gate before rebuild — AC-02, AC-03, AC-08, AC-13 … AC-18.
- Manual grep of generated output across all three targets for `insights.jsonl` — confirms both
  partials rendered in every expected persona and in no unexpected one — AC-01, AC-02, AC-03.
- Manual grep of generated output for `{PRIORITY}`, `{TYPE}`, `{AGENT}`, `{FILE_OR_MODULE}` inside
  the rendered JSONL example — must return no matches; residual placeholders indicate the schema was
  rendered as a template rather than a concrete line — AC-01.
- Manual grep of generated output across all three targets for `WP's working folder` — must return no
  matches — AC-22.
- Manual grep of generated output across all three targets for `docs/agents/insights/` — must appear
  in every persona that renders `insight-capture.md` — AC-22.
- Manual inspection of the workspace `.gitignore` for `/docs/agents/insights/` — AC-22.
- Manual grep of the Security Auditor's generated output for `vulnerability` and `risk` within the
  sink vocabulary block — must return no matches — AC-14.
- Manual verification, per modified persona, that the action gate cites a step number that exists in
  that persona's rendered Operational Protocol — AC-17.
- Manual verification, per modified persona, that the capture and compilation partials render at
  different points in the document (observation section vs. output-format section) — AC-17.
- Manual verification, per modified persona, that every rework/re-entry section names continued
  capture, or that the persona is named as exempt (Security Auditor and Reviewer) — AC-13.
- Manual count of continuous side-channel duties per modified persona — must be at most one,
  excluding checkpoint-slotted `ax-feedback` — AC-18.
- Manual inspection of the root `AGENTS.md` Cross-System Dependencies table — AC-20.
- Manual inspection of the produced `synthesis.md` — confirms the completed Curator review is
  recorded with the required scope, or (fallback path only) that a correctly-marked follow-up item is
  present — AC-21.

## Documentation Updates

- `docs/references/insights-sidecar-reference.md` — resolve the four placeholder rows, add the Web GUI
  Specialist and consumer rows, split the integration template by firing time, add the action-gate
  (Step 1b) and rework-continuation (Step 6) instructions, add the verdict-affecting-findings rule,
  add the Synthesis consumption exception, replace the mixed schema line with a concrete example,
  replace the undefined "WP's working folder equivalent" Location value with the two-rung ladder and
  add a Location subsection covering rung 2's path shape, per-session scope, derived-slug rule, and
  gitignored status, extend the Curator Verification Checklist. Bump to v1.2 with a changelog line.
- `personas/docs/agents/project-manifest/api-surface.md` — add `insight-capture.md` and
  `insight-compilation.md` to the Shared Partials inventory table (L547–L570) with their consumers,
  embedded variables, and required placement; add `insight_agent` and `insight_report_target` to the
  persona metadata schema, noting the build-time validation rule.
- `personas/docs/agents/project-manifest/file-tree.md` — add `insight-capture.md` and
  `insight-compilation.md` to the `shared/partials/` listing, alphabetically.
- `personas/docs/agents/project-manifest/constraints.md` — add constraints covering: the new
  parameterised-shared-partial pattern; the requirement that `insight_*` fields stay in sync with the
  reference document's agent names and with `role` where present; the rule that no verdict-affecting
  finding may be routed through `insights.jsonl`; and the requirement that a capture partial is
  always accompanied by an action gate in the consuming persona's Operational Protocol.
- Root `AGENTS.md` — add a Cross-System Dependencies row: `insight_agent` (source of truth: persona
  YAML, validated against `role` → `shared/workflow-manifest.json`) must stay in sync with the
  `agent` values in `docs/references/insights-sidecar-reference.md` and with the two shared partials'
  substitution points; validated by `scripts/build-personas.js`.
- `mcp-server/docs/agents/workflow-specification/operations.md` — document the `plan_path` key in the
  `ledger_get_next_action` response contract. **Update this before the implementation step**, per the
  root `AGENTS.md` maintenance rule.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — update the `ledger_get_next_action`
  response description.
- `personas/changelog.md` — summary entry covering the sidecar integration across the three suites.
- `mcp-server/changelog.md` — entry for the `plan_path` response key.
- Root `changelog.md` — single summarising entry with a `> mcp vX · personas vY` blockquote.
- `docs/agents-overview.md` — regenerate via `node scripts/generate-agents-overview.js` after the
  overview-metadata edits.
- `.context/` — regenerate via `node scripts/cli.js ctx-generate` after the project-manifest edits
  (repository insight `53454e24-4329-4946-ab9f-3b94cd682f17`).

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---|---|---|---|
| 1 | Release Engineer sidecar integration | This plan's scope analysis | Not named in the reference; its observations are release decisions rather than code observations | Reconsider if release-stage observations start appearing in synthesis Gold Nuggets |
| 2 | Machine consumption of `insights.jsonl` (GUI view, MCP query tool, or aggregation script) | Reference § Purpose — "machine-consumable by future tooling" | No consumer exists yet; building one before the sink has data would be speculative | Reconsider once several plans have accumulated sink files |
| 3 | Per-agent sink files (`insights-{agent}.jsonl`) | Reference rule 8 | Sequential stage access makes concurrency impossible today | Required only if the orchestrator ever parallelises stages |
| 4 | Backfilling `insights.jsonl` for completed plan folders | This plan's scope analysis | Historical observations already live in ledger comments and synthesis documents | Low value; the ledger remains the historical record |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Adding `plan_path` to every next-action payload breaks an existing assertion or downstream parser.** | The wrapper only adds a key; no existing key changes. Run the full MCP server suite as a regression gate (AC-12) and check the orchestrator's `tool_wrappers.py`, which does not inspect response payloads. |
| **The shared partials leak MCP-specific wording into the standalone suite.** | All workflow-specific phrasing is confined to `insight_report_target`, whose value lives in each persona's YAML. Reviewed against C18 during code review; a build `[WARN]` would surface an unresolved ledger-only partial reference. |
| **The capture partial is added but never triggered, so the sink stays empty and the forcing function then writes a false "clean" observation — manufacturing evidence that observation happened.** | This is the plan's primary failure mode, and the reason element 2 (action gate) exists. AC-17 requires every persona to bind the append to a named, existing step of its own Operational Protocol, verified per-persona in the Test Plan rather than by grep. |
| **Rework sections instruct the agent not to re-run the Operational Protocol, silently removing the action gate during rework.** | AC-13 requires every rework/re-entry section to state that capture continues. The ledger Developer's existing "Observations still apply" line is generalised to QA and Documentation. The Security Auditor and Reviewer are exempt: neither has a `REWORK` action — their re-entry points (`RUN_SECURITY_AUDIT`, `RUN_REVIEW`) re-run the full protocol including the action gate. |
| **A confirmed vulnerability is recorded only in `insights.jsonl`, never reaching the verdict, the Reviewer, or the synthesis.** | The Security Auditor's sink vocabulary excludes `vulnerability` and `risk` entirely (AC-14), so no plausible route exists. The persona additionally states the rule explicitly rather than relying on the agent to classify its own findings correctly under load. |
| **New observers without scope boundaries produce cross-territory commentary — architecture opinions from QA, code-quality opinions from Documentation — that the Reviewer must discount.** | AC-16 requires a three-or-four-row In Scope / Out of Scope table per new observer, following the Developer's existing precedent. |
| **A persona ends up with two continuous side-channel duties, so most observation collapses into end-of-session reconstruction.** | AC-18 makes the one-side-channel cap an explicit, individually verified criterion; `ax-feedback` is classified as checkpoint-slotted and excluded from the count. |
| **An agent outside a plan-driven session cannot resolve the sink path, so capture silently does not happen.** | The reference's "WP's working folder equivalent" is replaced with a rung 2 path derivable from the repository root alone — no MCP call, no store resolution, no user question. AC-22 verifies no rendered persona retains the undefined phrase. |
| **Rung 2 files accumulate as untracked noise, or get committed by mistake.** | `/docs/agents/insights/` is gitignored (step 2b), so rung 2 files are invisible to the Git Committer and to every archival boundary in § 5. AC-22 verifies the entry is present. |
| **Two agents in one non-plan session derive different `{slug}` values and write to separate files, so neither sees the other's entries.** | The partial requires the slug to be derived from the source the persona already uses to title its report, never invented. The impact is bounded: rung 2 is per-session and single-agent in practice, and cross-agent corroboration is explicitly out of scope for it. |
| **The rendered JSONL example retains `{PLACEHOLDER}` markers, and agents emit them literally into the sink.** | The partials render a complete, valid example line rather than a substitution template (AC-01), and the Test Plan greps all three targets for residual markers. |
| **Adding the observer sections pushes personas past the 60-second readability rule, degrading every instruction in them.** | Boundary tables are capped at three or four rows, the partials at roughly 20 lines, and step 15's checklist includes an explicit readability item. Pattern 15's "more prose without more triggers is net-negative" is the governing rule. |
| **Seven personas gain a capture partial but a workflow step is missed, so agents silently skip the phase.** | AC-08 makes step/partial parity an explicit acceptance criterion; C4a assigns the count cross-check to the Documentation pipeline. |
| **Agents write malformed JSON lines because of shell-quoting errors on append.** | The reference's flat, string-only schema exists to minimise escaping surface. The partial instructs agents to write via file tools rather than a shell heredoc, and the lenient-consumption rule guarantees a malformed line is salvaged rather than lost. |
| **The forcing function is rekeyed to the sink, but a sink write failure silently removes the forcing function entirely.** | The non-blocking fallback rule requires the agent to capture observations directly in its report when the sink is unavailable — the report-level obligation survives sink failure. Stated explicitly in the partial. |
| **Sink files accumulate in plan folders and are committed as noise.** | Step 12 classifies the file for the Git Committer: relocated with the plan folder, never grouped as source. Retention is intentional per the reference. |
| **`insight_agent` drifts from the persona's manifest-derived `role`, so sink entries carry an `agent` value no persona filters on — the compilation step finds nothing and the forcing function writes a false "clean" entry.** | Step 16 adds a build-time equality check (AC-19): mismatch fails the build. AC-20 records the coupling in the root `AGENTS.md` Cross-System Dependencies table so it is discoverable from the workspace entry point. |
| **`insight_*` YAML field values drift from the agent names in the reference document.** | AC-11 plus the new constraint entries tie the two together; on the ledger side the build check makes drift impossible, and on the standalone side a mismatch produces wrong `agent` values that Synthesis's grouped output makes immediately visible. |
| **Four personas gain vocabularies that diverge from the `ledger_complete_pipeline` parameter description.** | QA's types are copied verbatim from that description; the plan fixes all vocabularies in advance so none are invented at implementation time. |
| **The Synthesis persona reads all agents' entries, contradicting the reference's own-entries rule.** | Step 1 adds an explicit consumption exception to the reference so the two documents agree rather than conflict. |
| **A developer agent implements seventeen persona files without persona-design expertise, producing content that diverges from the Persona Design Guide.** | The execution note in Detailed Steps requires steps 4–11 to be delegated to the Persona Curator sub-agent in Maintain mode, and step 15 makes the Curator Verification Checklist a blocking gate before the rebuild (AC-21). The review happens during the work rather than being promised after it. |
| **A shared-partial edit changes a persona's rendered output but that persona's `changelog:` block is not bumped, so `name-mapping.json` reports a stale version.** | The Required Components note states the rule explicitly; AC-10 verifies `name-mapping.json` reflects the new versions, and the pre-commit persona-freshness hook surfaces unbuilt output. |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The change spans four modules (persona sources, the persona build system, the MCP
  server, and cross-cutting documentation), introduces a new parameterised-partial pattern plus a
  tool response-shape change, and touches seventeen persona source files whose step/partial parity,
  trigger anchoring, and derived-evidence classification benefit from formal QA, review, and
  documentation stages.
- **Sub-agent delegation:** Work packages covering steps 4–11 must delegate the persona edits to the
  Persona Curator (see the execution note in Detailed Steps). The QA stage verifies the step 15
  checklist outcome; the Reviewer verifies the design-conformance criteria AC-13 through AC-18 rather
  than treating them as documentation items.
