# Research Report

## Problem Statement

The Project Manager (PM) stage in orchestrator runs does not reliably invoke its four sub-agents (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper). Evidence from multiple runs shows that `work-packages-draft.md` appears but `dependency-analysis.md` and `pipeline-configuration.md` are never created, resulting in poorly scoped work packages with missing dependency and pipeline stage analysis.

## Problem Decomposition

1. **Missing sub-agent registrations:** Are all four PM sub-agents registered in `STAGE_SUBAGENT_FILES`?
2. **Name mismatch:** Do the sub-agent names in the PM persona match the names in the orchestrator config?
3. **Tool availability:** Does the PM agent see and use the `task` tool at all?
4. **Behavioral bypass:** Is the PM doing the work inline instead of delegating?

## Context & Constraints

- The PM persona (`personas/ledger/deep-agents/2-project-manager.md`) instructs the agent to invoke four sub-agents sequentially via the `task` tool: WP Decomposer → Dependency Sequencer → Pipeline Configurator → Ledger Bootstrapper.
- Sub-agents are registered in `orchestrator/src/config.py` → `STAGE_SUBAGENT_FILES` and loaded by `orchestrator/src/utils/subagents.py`.
- Deep Agents' `SubAgentMiddleware` creates a `task` tool that resolves sub-agents by exact `name` match against the configured `subagent_graphs` dict.
- The `task` tool is only injected when `create_deep_agent()` receives a non-None `subagents` parameter.
- The `task` tool expects a `subagent_type` parameter whose value must exactly match a registered sub-agent `name`.

## Prior Art & Known Patterns

### Pattern 1: STAGE_SUBAGENT_FILES — Only 1 of 4 Sub-agents Registered

- **Description:** `STAGE_SUBAGENT_FILES` in `orchestrator/src/config.py` (lines 148–160) registers only the WP Decomposer for the `"pm"` stage:
  ```python
  STAGE_SUBAGENT_FILES: dict[str, list[dict[str, str]]] = {
      "pm": [
          {
              "persona_file": "personas/standalone/deep-agents/ledger-wp-decomposer.md",
              "name": "Ledger WP Decomposer",
              "description": "Analyze a plan document and decompose it into atomic, actionable Work Package definitions.",
          },
      ],
  }
  ```
- **Missing entries:** Dependency Sequencer, Pipeline Configurator, and Ledger Bootstrapper are completely absent from the config. The `load_subagents("pm", ...)` function returns only one sub-agent spec. Therefore, even if the PM tried to invoke them via `task`, they would fail with `"does not exist, the only allowed types are Ledger WP Decomposer"`.
- **Fit:** This is a **root cause** — the orchestrator never makes these sub-agents available to the PM.

### Pattern 2: Sub-agent Name Mismatch (Persona vs. Config)

- **Description:** The PM persona uses kebab-case identifiers for sub-agent dispatch, while the config uses display names:

  | PM persona instruction | Config `name` field | Match? |
  |---|---|---|
  | `subagent: "ledger-wp-decomposer"` | `"Ledger WP Decomposer"` | **No** |
  | `subagent: "ledger-dependency-sequencer"` | *(not registered)* | N/A |
  | `subagent: "ledger-pipeline-configurator"` | *(not registered)* | N/A |
  | `subagent: "ledger-bootstrapper"` | *(not registered)* | N/A |

- **Deep Agents resolution:** The `task` tool does an exact dict key lookup: `subagent_graphs[subagent_type]`. There is no fuzzy matching, normalization, or case-insensitive fallback. If the PM called `task(subagent_type="ledger-wp-decomposer")`, it would fail because the registered name is `"Ledger WP Decomposer"`.
- **Fit:** This is a **secondary root cause** — even the one registered sub-agent cannot be invoked by the name the persona specifies.

### Pattern 3: PM Bypasses Task Tool Entirely

- **Description:** Log analysis of four recent orchestrator runs confirms the PM never calls the `task` tool at all. It performs WP decomposition, dependency analysis, and ledger initialization inline:

  | Run | PM tool calls (task) | PM tool calls (ledger) |
  |-----|---------------------|----------------------|
  | `2026-04-13-tool-name-variables` | 0 | 22 (detect, init, create×9, status, get×9, handoff) |
  | `2026-04-14-freeform-tenant-properties` | 0 | 13 (status, init, create×11, error) |
  | `2026-04-13-dynamic-partials` | 0 | 22 (detect, init, create×10, status×3, get×2, list, next) |
  | `2026-04-10-backend-specific-date-formats` | 0 | 9 (status, init, create×4, status×2, next) |

- **Why the bypass:** Because only 1 sub-agent is registered and its name doesn't match, the `task` tool — if it even appears in the tool list — is effectively useless. The LLM likely recognizes it cannot delegate and falls back to doing the work itself. This means it skips the structured 4-stage pipeline entirely: no WP Decomposer output file, no `dependency-analysis.md`, no `pipeline-configuration.md`.
- **Fit:** This is the **observed symptom** — a direct consequence of Patterns 1 and 2.

### Pattern 4: Downstream File Artifacts Never Created

- **Description:** Each sub-agent persona specifies an output file:

  | Sub-agent | Output file | Actually created? |
  |-----------|------------|-------------------|
  | WP Decomposer | `work-packages-draft.md` | Yes (PM creates it inline) |
  | Dependency Sequencer | `dependency-analysis.md` | **Never** |
  | Pipeline Configurator | `pipeline-configuration.md` | **Never** |
  | Ledger Bootstrapper | `work.md` + `work/WP-*.md` | Sometimes (PM creates inline) |

- **Consequence:** Without `dependency-analysis.md`, the PM sets WP dependencies based on its own ad-hoc analysis rather than the structured protocol. Without `pipeline-configuration.md`, pipeline stages default to the 4-stage standard chain for every WP — security-sensitive and release-artifact WPs get incorrect stage configurations.
- **Fit:** This confirms the user's observation and explains why WP scoping is unreliable.

## Alternative & Creative Approaches

### Approach A: Register all 4 sub-agents with correct names

- **Description:** Add the missing 3 sub-agent entries to `STAGE_SUBAGENT_FILES` and align all `name` fields to match the persona's `subagent` values (or vice versa).
- **Rationale:** Directly fixes both root causes with minimal code change.
- **Risk:** Low. The sub-agent personas already exist and are well-specified.

### Approach B: Align persona sub-agent names to match Deep Agents convention

- **Description:** Instead of using kebab-case IDs in the persona, update the PM persona to use the display names that are registered in `STAGE_SUBAGENT_FILES` (e.g., `task(subagent_type="Ledger WP Decomposer")`).
- **Rationale:** Avoids changing the config naming convention.
- **Risk:** Low, but requires a persona rebuild. The persona uses the `task` tool with the `subagent` parameter name, while Deep Agents expects `subagent_type` — this is an additional mismatch to resolve (though LLMs may adapt).

### Approach C: Collapse sub-agents back into the PM

- **Description:** Remove the sub-agent delegation model and have the PM produce all artifacts itself, but explicitly instruct it to create `dependency-analysis.md` and `pipeline-configuration.md` as intermediate files.
- **Rationale:** Eliminates the sub-agent dispatch complexity. The PM is already doing this work inline.
- **Risk:** Higher — loses the benefits of isolated context windows and focused sub-agent personas. The PM would need to handle decomposition, sequencing, pipeline config, and bootstrapping in a single context, increasing the chance of quality degradation on complex plans.

## Comparative Evaluation

| Criterion | A: Register all 4 | B: Align persona names | C: Collapse to PM |
|---|---|---|---|
| **Complexity** | Low (add 3 config entries) | Low (update persona + rebuild) | Medium (rewrite PM persona) |
| **Fixes root cause** | Yes (both) | Partially (only name mismatch) | Yes (eliminates dispatch) |
| **Preserves architecture** | Yes | Yes | No |
| **Risk** | Low | Low | Medium |
| **Time to implement** | Low | Low | Medium |

## Recommendation

**Implement Approach A + B combined:**

1. **Add the 3 missing sub-agent entries to `STAGE_SUBAGENT_FILES`** in `orchestrator/src/config.py`:
   - `ledger-dependency-sequencer` → `personas/standalone/deep-agents/ledger-dependency-sequencer.md`
   - `ledger-pipeline-configurator` → `personas/standalone/deep-agents/ledger-pipeline-configurator.md`
   - `ledger-bootstrapper` → `personas/standalone/deep-agents/ledger-bootstrapper.md`

2. **Align names** — choose ONE naming convention and apply it consistently. Two options:
   - **Option 1 (recommended):** Use kebab-case IDs in `STAGE_SUBAGENT_FILES` to match the persona (`"ledger-wp-decomposer"`, etc.). This is simpler because it matches the `name` field in the standalone persona YAML frontmatter.
   - **Option 2:** Update the PM persona to use display names (`"Ledger WP Decomposer"`, etc.) to match the current config style. Requires a persona rebuild.

3. **Verify the `task` tool parameter name:** The PM persona says `subagent: "..."` but Deep Agents expects `subagent_type: "..."`. The LLM may adapt, but aligning the persona's instruction to say `subagent_type` would eliminate ambiguity.

### Proof-of-Concept Outline

1. Add 3 entries to `STAGE_SUBAGENT_FILES["pm"]` in `orchestrator/src/config.py`.
2. Rename all 4 `name` fields to kebab-case (matching persona YAML `name` field).
3. Update the PM persona workflow steps to use `subagent_type` instead of `subagent`.
4. Rebuild personas (`node scripts/build-personas.js`).
5. Run an orchestrator test with a simple plan and verify:
   - `work-packages-draft.md` is created by the WP Decomposer sub-agent (not inline)
   - `dependency-analysis.md` is created by the Dependency Sequencer sub-agent
   - `pipeline-configuration.md` is created by the Pipeline Configurator sub-agent
   - `work.md` + `work/WP-*.md` are created by the Bootstrapper sub-agent

## Open Questions

- **Sub-agent tool access:** The Bootstrapper sub-agent needs MCP tools (`ledger_initialize_project`, `ledger_create_work_package`, etc.). In the current `create_deep_agent` call, sub-agents inherit from the `SubAgent` spec — do they receive the MCP tools from the parent agent? If not, the Bootstrapper cannot function as a sub-agent and would need its own tool injection.
- **Sub-agent sequencing:** The PM persona instructs sequential dispatch (each sub-agent depends on the previous one's output file). Deep Agents' `task` tool supports parallel dispatch. The PM persona must continue to call them sequentially, not in parallel, because outputs chain. This is correctly specified in the persona but worth verifying the LLM follows it.
- **`work-packages-draft.md` already created inline:** In some runs the PM creates this file itself (before any sub-agent). If the WP Decomposer sub-agent now creates it, will there be a conflict? The PM persona should be updated to not create this file itself when delegating.

## References

- `orchestrator/src/config.py` lines 148–160 — `STAGE_SUBAGENT_FILES` definition
- `orchestrator/src/utils/subagents.py` — Sub-agent loader
- `personas/ledger/deep-agents/2-project-manager.md` lines 105–145 — PM workflow with sub-agent dispatch
- `personas/standalone/deep-agents/ledger-wp-decomposer.md` — WP Decomposer persona (output: `work-packages-draft.md`)
- `personas/standalone/deep-agents/ledger-dependency-sequencer.md` — Dependency Sequencer persona (output: `dependency-analysis.md`)
- `personas/standalone/deep-agents/ledger-pipeline-configurator.md` — Pipeline Configurator persona (output: `pipeline-configuration.md`)
- `personas/standalone/deep-agents/ledger-bootstrapper.md` — Bootstrapper persona (output: `work.md` + `work/WP-*.md`)
- Deep Agents `SubAgentMiddleware` — `deepagents.middleware.subagents` module (exact name match on `subagent_graphs[subagent_type]`)
