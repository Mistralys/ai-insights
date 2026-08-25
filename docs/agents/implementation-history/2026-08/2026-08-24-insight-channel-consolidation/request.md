# Project Brief: Insight Channel Consolidation

## Summary

Eliminate the `insights.jsonl` sidecar from the ledger workflow and route all
code-level observations through the existing MCP observation tools
(`ledger_add_observation`, `ledger_complete_pipeline` comments). The sidecar
remains the sole capture mechanism for standalone agents, who have no ledger.

## Motivation

Ledger agents currently write observations to two parallel channels:

1. **MCP tools** — `ledger_complete_pipeline` comments and `ledger_add_observation`
   post-hoc additions. Stored in the ledger data model per WP per pipeline.
2. **`insights.jsonl` sidecar** — filesystem append to a flat JSONL file in the plan
   folder. Compiled by Synthesis in a separate step.

This creates redundancy and confusion:

- Agents receive conflicting guidance about which channel carries which observation
  type. The boundary is unclear and unenforced.
- Synthesis mines both channels in separate protocol steps (step 2: Ledger Insight
  Mining; step 5: Code Insights Compilation), producing partially overlapping output.
- The sidecar's structured fields (`type`, `priority`, `loc`, `text`) are more
  expressive than the current `ledger_add_observation` schema, which lacks a `loc`
  field. This inverts the expected quality hierarchy — the lighter-weight channel
  has the richer schema.

## Design Direction

### 1. Upgrade `ledger_add_observation` with a `loc` field

Add an optional `loc` (string) parameter to `ledger_add_observation` to match the
sidecar's structured format. This anchors observations to specific file paths or
modules — the sidecar's strongest differentiator.

Consider whether the same field should be added to `ledger_complete_pipeline`
comment entries for parity.

### 2. Remove sidecar usage from all ledger personas

Strip the `insights.jsonl` capture protocol from ledger persona content and metadata
for agents 3 (Developer), 4 (QA), 5 (Security Auditor), 6 (Reviewer), and
8 (Documentation). These agents should use `ledger_add_observation` incrementally
(gated on actions, same discipline as the current sidecar protocol) and
`ledger_complete_pipeline` comments at pipeline completion.

Preserve the Developer's "Code Insight Observer" section — its observation
categories, type vocabulary, and priority guidelines remain valuable. Retarget them
from the sidecar to the MCP observation tool.

### 3. Remove sidecar compilation from Synthesis (ledger variant)

Eliminate step 5 ("Code Insights Compilation") from
`synthesis-operational-protocol.md`. Ledger Insight Mining (step 2) now covers all
agent observations since they live in the ledger. Synthesis no longer reads
`insights.jsonl`.

Update the Synthesis persona's `insight_consumer_only` flag and the
`insight-compilation` partial inclusion accordingly.

### 4. Preserve the sidecar for standalone agents

Standalone personas (Developer, Web GUI Specialist, and any future additions) have
no ledger and no MCP observation tools. The `insights.jsonl` sidecar remains their
sole capture mechanism. The shared partials (`insight-capture.md`,
`insight-compilation.md`) continue to serve these agents unchanged.

### 5. Clean separation in shared partials

After the change, the two systems have zero overlap:

| Channel | Used By | Capture Mechanism | Compiled By |
|---------|---------|-------------------|-------------|
| Ledger observations | Ledger agents (3, 4, 5, 6, 8) | `ledger_add_observation` (incremental) + `ledger_complete_pipeline` comments | Synthesis step 2 (Ledger Insight Mining) |
| `insights.jsonl` sidecar | Standalone agents | Filesystem JSONL append | Standalone Developer/report compilation |

### 6. Update the reference specification

`docs/references/insights-sidecar-reference.md` should be updated to reflect that
the sidecar is standalone-only. Remove ledger persona entries from its integration
table.

## Scope Sketch

### MCP Server (`mcp-server/`)

- `src/tools/observation.ts` (or equivalent) — add optional `loc: string` parameter
  to `ledger_add_observation` schema
- Evaluate adding `loc` to `ledger_complete_pipeline` comment entries
- `docs/agents/project-manifest/api-surface.md` — update tool signatures
- `tests/` — add/update tests for the new field

### Personas — Ledger (`personas/ledger/`)

- `src/content/3-developer.md` — retarget Code Insight Observer from sidecar to
  `ledger_add_observation`; keep observation categories and type vocabulary
- `src/content/4-qa.md` — remove sidecar references; ensure observation workflow
  uses MCP tools
- `src/content/5-security-auditor.md` — same
- `src/content/6-reviewer.md` — same
- `src/content/8-documentation.md` — same
- `src/content/9-synthesis.md` — remove sidecar compilation step; consolidate into
  Ledger Insight Mining
- `src/meta/3-developer.yaml` through `src/meta/9-synthesis.yaml` — evaluate
  whether `insight_agent` / `insight_report_target` metadata fields should be
  removed or repurposed for ledger personas

### Personas — Shared Partials (`personas/shared/partials/`)

- `synthesis-operational-protocol.md` — remove step 5; update step numbering
- `insight-capture.md` — no change (standalone-only going forward)
- `insight-compilation.md` — no change (standalone-only going forward)
- Evaluate whether any new ledger-specific observation partial is needed, or
  whether retargeting the existing per-persona sections suffices

### Personas — Standalone (`personas/standalone/`)

- No changes expected — sidecar protocol remains intact

### Reference Documentation

- `docs/references/insights-sidecar-reference.md` — scope to standalone agents only

### Cross-System Dependencies

- `personas/ledger/src/meta/_shared.yaml` or per-persona YAML — `insight_agent` /
  `insight_report_target` fields currently drive template variable substitution in
  the shared partials. Ledger personas may need these removed if they no longer
  include the sidecar partials.
- Knowledge Archiver sub-agent — currently reads `synthesis.md` which includes the
  compiled Code Insights section. After the change, insights are part of the ledger
  data Synthesis already mines. Verify the Knowledge Archiver still has access to
  the same material.

## Design Constraints

- **Incremental capture parity is a deliverable, not a mitigation.** The sidecar's
  "gate on actions" protocol — append at every observable action, never batch — is
  what makes its observations valuable. The retargeted ledger personas must carry
  the same discipline: call `ledger_add_observation` incrementally after each
  action, not batch observations into `ledger_complete_pipeline` comments at the
  end. The observation handling in the ledger workflow must be as rigorous as the
  sidecar protocol it replaces.

## Risks

- **Cross-agent corroboration loss.** The sidecar compiles all agents' observations
  into one file, making corroboration visible. With observations distributed across
  per-WP pipelines, Synthesis must correlate across WPs to detect the same pattern.
  Mitigation: Synthesis already mines all pipelines in step 2 — ensure its curation
  rules include cross-pipeline deduplication with priority elevation.

## Out of Scope

- Changes to the knowledge store (`ledger_add_insight` / `ledger_search_insights`).
- Changes to standalone persona behavior.
- Changes to the `insights.jsonl` entry format or shared partial internals (these
  remain stable for standalone use).
