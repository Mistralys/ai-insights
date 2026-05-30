# Synthesis: Synthesis Knowledge Archiving

**Plan:** 2026-05-30-synthesis-knowledge-archiving  
**Completed:** 2026-05-30  
**Implemented by:** Persona Curator (manual, non-ledger run)

---

## Executive Summary

This plan addressed a structural duplication in the agentic workflow: the Synthesis
agent embedded a full knowledge-extraction protocol (`synthesis-knowledge-collection.md`)
that was a lengthier, weaker copy of the same protocol already owned by the Knowledge
Archiver persona. The solution was to delete the duplicate and delegate knowledge
collection from Synthesis to the Knowledge Archiver as a subagent call.

A secondary improvement was also delivered: the Knowledge Archiver's review step was
strengthened with an explicit cold second-pass filter — three mandatory tests for global
candidates and two for project-scoped candidates — with a hard rule against rewording
weak candidates to rescue them.

---

## Changes Delivered

| File | Change |
|------|--------|
| `personas/standalone/src/content/knowledge-archiver.md` | Two-mode redesign: Operating Modes (Live/Archive), mode-aware Inputs, Tool Integration, Source Reading Strategy, Constraints, and Workflow. Added §3 "Review Each Candidate" with cold second-pass filter. |
| `personas/standalone/src/meta/knowledge-archiver.yaml` | Updated `description`; added live read tools (`ledger_get_project_status`, `ledger_list_work_packages`, `ledger_get_work_package`); version bump `1.3.1` → `1.4.0` |
| `personas/ledger/src/content/9-synthesis.md` | Replaced `{{> synthesis-knowledge-collection}}` partial with a delegation section that invokes the Knowledge Archiver subagent |
| `personas/ledger/src/meta/9-synthesis.yaml` | Removed `ledger_search_insights` and `ledger_add_insight` from `mcp_tools`; added `subagents: [standalone-knowledge-archiver]`; version bump `3.5.3` → `3.6.0` |
| `personas/shared/partials/synthesis-knowledge-collection.md` | Deleted (orphaned after delegation) |
| `AGENTS.md` | Updated "Knowledge Collection" row in Cross-System Dependencies table |
| `personas/changelog.md` | Two entries: Synthesis v3.6.0 and Knowledge Archiver v1.4.0 |

---

## Key Insight: The Review Step

The primary structural improvement beyond delegation was the addition of an explicit
**cold second-pass review** to the Knowledge Archiver's extraction workflow:

**Root cause of the problem:** Candidate identification and commitment were a single
forward pass. Once an agent wrote up a candidate insight, it was already committed to it
— the act of articulating it created an anchoring bias toward keeping it.

**The fix:** Insert a deliberate change of perspective between drafting and scoring. The
new §3 "Review Each Candidate" forces the agent to evaluate each candidate *from outside*
the project context before any MCP calls are made:

- **Global candidates:** Three tests must all pass — (1) stands alone without
  project-specific identifiers; (2) immediately actionable on a different type of project;
  (3) goes beyond what a competent developer would already know.
- **Project candidates:** Two tests must both pass — (1) specific enough to be useful to
  a future agent on this exact codebase, not discoverable in five minutes of reading;
  (2) traces to a concrete mistake, rework, or decision whose rationale is not self-evident.
- **Universal filters (both scopes):** The Surprise Test (would an experienced developer
  say "I hadn't thought of that"?) and the Origin Test (does this trace to a specific
  incident in the project?).
- **Hard rule:** Do not reword to rescue — if the insight does not survive honest review,
  discard it. This is the key guard against low-value candidates being inflated by
  creative rephrasing.

MCP tools (`ledger_search_insights`, `ledger_add_insight`) are only reached after the
full review pass has already culled the candidate list.

---

## Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 5 of 5 |
| Files changed | 7 |
| Files deleted | 1 |
| Personas updated | 2 (Synthesis v3.6.0, Knowledge Archiver v1.4.0) |
| Open questions resolved | 2 of 2 (Q1: what to pass; Q2: orchestrator subagent scope) |

---

## Strategic Recommendations

1. **The delegation pattern works.** Synthesis → Knowledge Archiver is a clean separation
   of responsibilities. The Synthesis agent is now a report writer; the Knowledge Archiver
   is the extraction specialist. This pattern should be applied to any future case where a
   ledger agent embeds a protocol already owned by a standalone specialist.

2. **The review-step design is broadly applicable.** The three-question global filter and
   two-question project filter are not persona-specific. Consider applying the same
   cold-pass review structure to any agentic workflow that produces a list of candidates
   under potential anchoring bias (security findings, refactoring suggestions, etc.).

3. **Orchestrator behavioral verification is deferred.** Adding `subagents:
   [standalone-knowledge-archiver]` to `9-synthesis.yaml` is harmless and wires the
   Knowledge Archiver into the Synthesis stage for IDE persona tool tables. Whether the
   orchestrator correctly handles the mid-workflow delegation pattern (as opposed to a
   pipeline-stage delegation) remains unverified. Track as a follow-up before orchestrator
   runs use this persona version.

4. **Mode B (Archive/Retrospective) is transitional.** Once historical projects have been
   reprocessed, Mode B can be deprecated. The plan deliberately left this as a future
   cleanup rather than over-engineering the persona now.

---

## Next Steps

- Run `node scripts/cli.js ctx-generate` to regenerate `.context/` docs
  (`.context/agents.md`, `.context/personas/shared-partials.md`, and
  `.context/personas/file-structure.md` are stale until regenerated).
- Run `node scripts/build-personas.js` to rebuild generated persona output and verify
  the template variables (`{{agent_standalone_knowledge_archiver}}`,
  `{{agent_slug_standalone_knowledge_archiver}}`) resolve correctly.
- Track orchestrator subagent dispatch verification as a follow-up work item.
- Reprocess any historical archived projects using the Knowledge Archiver in Mode B
  before deprecating that mode.
