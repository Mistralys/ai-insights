# Research Report

## Problem Statement

The ledger-enabled personas currently embed ~60 lines of MCP server boilerplate (tools table header, self-documenting-tools advisory, preflight check procedure, unavailable message, handoff protocol, incident logging) into every persona via the template partial system. This content is largely identical across Agents 2–7, differing only in the per-agent tools table and the detect-vs-no-detect preflight variant.

Could this MCP documentation be extracted into an **Agent Skill** (the open standard at [agentskills.io](https://agentskills.io/)), reducing duplication in the personas while keeping the operational instructions accessible to every ledger-enabled agent?

## Problem Decomposition

1. **What MCP content exists in the personas today, and which parts are generic vs. role-specific?**
2. **What are Agent Skills, how are they loaded, and what are their constraints?**
3. **Can critical operational instructions (preflight, handoff) be trusted to on-demand skill loading?**
4. **What would remain in the personas after extraction?**
5. **How would the per-agent tool table (role-specific) be handled?**

## Context & Constraints

- **Build system:** Personas are assembled from YAML metadata + Markdown partials by `build-personas.js`. 7 MCP-specific partials exist; they use `{{mcp_server_name}}`, `{{mcp_tools_table}}`, and `{{role}}` template variables.
- **Agent 1 (Planner):** No MCP content at all — unaffected.
- **Agent 2 (PM):** Uses `mcp-preflight-verify-no-detect` (derives `project_path` from the open plan document). Has 4 MCP tools.
- **Agents 3–7:** Use `mcp-preflight-detect` + `mcp-preflight-verify-with-detect`. Each has 6–10 MCP tools.
- **Frontmatter dependency:** Persona frontmatter includes `tools: ['central_pm/*']` which grants VS Code permission to expose MCP tools to that agent. This is a non-negotiable part of the persona definition.
- **Deferred tools:** The MCP tools are deferred — the pre-flight instructions for `tool_search_tool_regex` with pattern `ledger_` are essential before any MCP call.
- **Portability goal:** Skills follow an open standard supported by VS Code, Claude Code, Copilot CLI, Copilot coding agent, and others.
- **Workspace scope:** The skill would live in the user's workspace (e.g., `.github/skills/project-ledger/`) or in the personal skills directory (`~/.copilot/skills/`). It can alternatively be pointed to via `chat.agentSkillsLocations` setting.

## Prior Art & Known Patterns

### Pattern 1: Embedded Instructions (Current Approach)

- **Description:** All MCP documentation is baked into the persona via template partials. The build system assembles 7 partials (`mcp-intro`, `mcp-tools-note`, `mcp-preflight-header`, `mcp-preflight-detect`, `mcp-preflight-verify-*`, `mcp-unavailable`) plus 2 workflow partials (`handoff-block`, `incident-logging`) into each persona's body.
- **Where used:** Current persona build pipeline.
- **Strengths:**
  - Guaranteed to be in context — the agent always has the MCP instructions from the first token.
  - Template variables enable per-agent customization (different tool tables, role names).
  - No runtime dependency on skill discovery/loading mechanics.
- **Weaknesses:**
  - ~60 lines of near-identical content duplicated across 6 personas (Agents 2–7).
  - Changes require editing partials + rebuilding all personas.
  - Consumes ~500–700 tokens per persona of "infrastructure" content that doesn't vary between roles.
- **Fit:** Works today but is maintenance-heavy and token-inefficient.

### Pattern 2: Agent Skill with Background Auto-Loading

- **Description:** Extract the generic MCP procedures into a `.github/skills/project-ledger/SKILL.md` file. Set `user-invokable: false` (hidden from `/` menu) to make it background knowledge that the model loads automatically when it detects a ledger-related task. The personas retain only role-specific content (tool table, workflow steps) plus a brief reference.
- **Where used:** Agent Skills standard (agentskills.io); VS Code, Claude Code, Copilot CLI, Copilot coding agent.
- **Strengths:**
  - Single source of truth for MCP procedures — edit once, applies everywhere.
  - Progressive disclosure: only ~100 tokens at startup (name + description), full body (~400 tokens) only when activated.
  - Portable across VS Code, Copilot CLI, and Copilot coding agent.
  - Personas become significantly lighter (~20–25% shorter), focusing purely on role identity and role-specific workflows.
  - Skill can include reference files (e.g., tool-by-tool documentation) that load only when needed.
- **Weaknesses:**
  - **Activation is probabilistic, not deterministic.** The model decides whether to load the skill based on description matching. If the persona mentions "MCP tools" and "ledger," the match should be strong — but it's not guaranteed.
  - **No template variables.** Skills are static Markdown. The `{{mcp_server_name}}` and `{{role}}` placeholders cannot be resolved dynamically. The skill must either hardcode `central_pm` (fragile if server name changes) or use generic language.
  - **No per-agent conditional logic.** Skills don't support `{{#if has_detect_project}}`. Both preflight variants (detect / no-detect) must coexist in the skill body, with the agent picking the right one based on its persona instructions.
  - **The per-agent tool table cannot move to the skill.** Each agent has a different set of MCP tools. The skill would either need to list all 19 tools (wasteful) or the persona must retain its own table.
- **Fit:** Strong for generic procedures; unsuitable for role-specific content. Requires the persona to retain a brief MCP section.

### Pattern 3: File-Based Custom Instruction (`.instructions.md`)

- **Description:** Create a `ledger-mcp.instructions.md` with `applyTo: description` and a description like "Apply when working with project ledger MCP tools." VS Code loads it when the description matches the task.
- **Where used:** VS Code custom instructions system.
- **Strengths:**
  - Simpler format than skills (just a Markdown file with frontmatter).
  - Can be "always-on" or description-triggered.
- **Weaknesses:**
  - VS Code-specific — not portable to Copilot CLI or coding agent.
  - Always-on instructions apply to ALL chat sessions, including non-ledger agents — wasteful and confusing.
  - Description-triggered instructions have the same probabilistic activation issue as skills but with less community adoption and tooling.
  - Cannot include scripts or reference resources.
- **Fit:** Inferior to skills on portability and capability. Not recommended.

## Alternative & Creative Approaches

### Hybrid: Skill + Slim Persona Bridge

- **Approach:** Extract generic MCP infrastructure into a skill. In each persona, retain:
  1. The `tools: ['central_pm/*']` frontmatter (mandatory).
  2. A slim "MCP Tools" section (~15 lines) containing only the per-agent tool table.
  3. A single bridging sentence: *"For preflight checks, handoff protocol, and incident logging procedures, the `project-ledger` skill contains the complete operational guide."*
  4. The handoff block stays inline (it uses `{{role}}` and is deeply integrated into the workflow).
- **Rationale:** This extracts the ~40 lines of generic content (preflight header, detect, verify, unavailable, tools-note) while keeping the ~20 lines of per-agent content. The bridge sentence tells the model to load the skill, reinforcing the automatic description match.
- **Risk:** If the model doesn't load the skill, the agent still has its tool table and workflow steps but would lack the preflight procedure and unavailable message. This is mitigated by three factors: (1) a **defensive invariant** in the persona provides a minimal fallback preflight sequence (~2–3 lines), (2) the MCP tools themselves return `--- NEXT STEP ---` guidance making a missed preflight recoverable, and (3) VS Code's `reminderInstructions` already tell agents about deferred tool loading. See **Activation Reliability Analysis** below for the full risk assessment.

### Hybrid: Build-Time Skill Generation

- **Approach:** Extend `build-personas.js` to also generate a `SKILL.md` file from the same partials, resolving `{{mcp_server_name}}` at build time. The skill would be a static snapshot with `central_pm` hardcoded.
- **Rationale:** Reuses the existing template system to produce a skill artifact. The skill gets rebuilt whenever personas are rebuilt, keeping it in sync.
- **Risk:** Adds build complexity. The skill would be a generated artifact (like the persona output files), requiring the same "don't edit generated files" discipline.

## Activation Reliability Analysis

The central concern with skill extraction is whether the skill will be **reliably loaded before the agent needs it**. This section breaks down what can be guaranteed, what cannot, and how to design the system so the workflow is safe regardless.

### What Can Be Guaranteed: Three Activation Levers

Skills activate based on pattern-matching between the skill's `description` and the conversation context. This gives three reliable levers:

1. **Role-based activation.** Each persona has a clear role name (Developer, QA, Reviewer, etc.) and explicitly mentions MCP tools and `central_pm`. Since the persona itself is always in context, the skill description will match against it. This is the strongest guarantee because the persona is the trigger.

2. **Task-based activation.** Every ledger workflow session contains high-signal terms: "work package", "WP-###", "ledger", "implement", "review", "handoff", "pipeline", "project status". These appear in user prompts and agent reasoning, providing a second reliable trigger surface.

3. **Environment-based activation.** The agent encounters project paths, ledger slugs, work package IDs, and pipeline types through MCP tool calls and file content. These provide yet another layer of matching opportunity.

With all three levers present in every real ledger workflow, skill activation has **redundant triggers** across persona identity, user intent, and workflow state.

### What Cannot Be Guaranteed

1. **IDE skill loading order.** You cannot force the IDE to load a skill *before* the persona begins reasoning. You can only define triggers that make it extremely likely.

2. **Skill availability in non-ledger conversations.** If the user starts a conversation with something unrelated ("Write a poem"), the skill will not load. This is correct and expected behavior.

### The Key Insight: Timing Is Favorable

The skill does not need to load *before* the persona starts reasoning. It only needs to load **before the persona begins interacting with the ledger**. And because ledger interactions always involve work package IDs, project paths, pipelines, tool calls, and role names — all of which are high-signal keywords — the skill will activate before the first MCP tool call, which is exactly when it's needed.

This means the timing concern is largely moot: the agent reads its persona (role-specific, no preflight details), reasons about the task (triggers skill loading), and then has the full MCP operational guide available when it starts the preflight sequence.

### Defensive Design: The Persona Invariant

Even with redundant triggers, the system should be safe if the skill fails to load. The solution is a **defensive invariant** in each persona:

> *"If the `project-ledger` skill is active, follow its rules for preflight, handoff, and incident logging. If not, perform the minimal safe pre-flight sequence: load deferred tools via `tool_search_tool_regex` with pattern `ledger_`, call `ledger_detect_project` (or derive `project_path` from context), then call `ledger_get_project_status` to verify reachability."*

This invariant is ~2–3 lines in the persona and provides:

- **Safety even if the skill fails to load** — the agent falls back to a minimal but functional preflight.
- **Consistency when the skill loads** — the skill provides the richer, more detailed version of the same procedures.
- **No duplicated boilerplate** — the fallback is a compact sequence, not the full 60-line infrastructure block.
- **No dependency on skill load order** — the invariant works regardless of when (or whether) the skill activates.

This fallback is already a subset of what the personas do today. The skill simply *overrides* it with a more consistent and comprehensive version.

### Activation Strategy Summary

The skill will load when **any** of the following are present in context:

| Trigger Layer | Signals | Reliability |
|---|---|---|
| Persona identity | Role name, `central_pm/*` in tools, "MCP" mentions | **High** — always present |
| User intent | "work package", "WP-###", "ledger", "implement", "review" | **High** — present in every ledger session |
| Workflow state | Project path, pipeline type, ledger tool calls | **Medium-High** — present once work begins |
| Defensive fallback | Persona invariant triggers minimal preflight | **Guaranteed** — built into persona |

With four overlapping layers, the risk of a completely missed activation is negligible in any real ledger workflow.

## Comparative Evaluation

| Criterion | Pattern 1: Embedded (current) | Pattern 2: Pure Skill | Hybrid: Skill + Slim Bridge | Hybrid: Build-Time Skill |
|---|---|---|---|---|
| **Single source of truth** | Partial (partials are shared, but assembled per-agent) | Yes (skill body) | Yes (skill for generic, partials for role-specific) | Yes (partials → skill) |
| **Guaranteed context** | Yes — always present | No — probabilistic | Mostly — bridge sentence + tool table always present | Mostly — same as Hybrid |
| **Per-agent customization** | Full (template variables) | None (static Markdown) | Preserved for tool table + handoff | Partial (server name resolved, but no per-agent branches) |
| **Token efficiency** | Low (duplicated ~60 lines × 6 agents) | High (loaded once on demand) | Good (personas ~20% shorter, skill loaded once) | Good (same as Hybrid) |
| **Portability** | None (VS Code persona system only) | Full (open standard) | Full (skill is standard) | Full (skill is standard) |
| **Maintenance** | Medium (edit partial → rebuild all) | Low (edit one SKILL.md) | Low-Medium (skill + slim persona section) | Medium (edit partial → rebuild skill + personas) |
| **Risk of missing instructions** | None | Moderate (model might not load) | Very Low (defensive invariant + redundant triggers + self-documenting tools) | Very Low (same as Hybrid) |
| **Build system impact** | None (current) | None (skill is hand-authored) | None (skill is hand-authored) | Moderate (new build target) |
| **Time to implement** | N/A | Low (1–2 hours) | Low-Medium (2–3 hours) | Medium (4–6 hours, build changes + testing) |

## Recommendation

**Adopt the Hybrid: Skill + Slim Persona Bridge approach.**

This provides the best balance of token efficiency, maintainability, and reliability:

1. **Create a `project-ledger` skill** in `.github/skills/project-ledger/SKILL.md` containing:
   - Preflight check procedure (both detect and no-detect variants, clearly labeled)
   - Self-documenting tools advisory
   - MCP server unavailable message and failure protocol
   - Handoff protocol (generic, using `current_agent: "<your-role>"` placeholder language)
   - Incident logging procedure
   - A `references/` directory with tool-by-tool documentation (extracted from `ledger_help`)

2. **Slim down each persona** to retain only:
   - Frontmatter `tools: ['central_pm/*']` (mandatory for VS Code tool access)
   - Per-agent tool table (the `| MCP Tool | Purpose |` section, ~5–12 rows)
   - A bridge sentence pointing to the skill
   - Role-specific workflow steps that reference MCP tools by name

3. **Add a defensive invariant** to each persona (~2–3 lines):
   > *"If the `project-ledger` skill is active, follow its rules for preflight, handoff, and incident logging. If not, perform the minimal safe pre-flight sequence: load deferred tools via `tool_search_tool_regex` with pattern `ledger_`, call `ledger_detect_project` (or derive `project_path` from context), then call `ledger_get_project_status` to verify reachability."*
   
   This ensures the workflow never breaks, even if the skill fails to load.

4. **Set skill frontmatter:**
   ```yaml
   ---
   name: project-ledger
   description: >-
     Operational guide for the Project Ledger MCP server (central_pm).
     Contains preflight checks, deferred tool loading, handoff protocol,
     incident logging, and self-documenting tool guidance. Use when
     working with ledger_ MCP tools in the agentic workflow.
   user-invokable: false
   ---
   ```
   Setting `user-invokable: false` makes this background knowledge — it won't clutter the `/` menu but will be auto-loaded when the model detects a ledger task.

### Clean Separation Principle

The extraction creates a clear boundary between **workflow infrastructure** and **role identity**:

| Belongs in the Skill | Belongs in the Persona |
|---|---|
| Full MCP workflow rules | Role identity and mission |
| Pre-flight sequence (both variants) | Domain expertise (coding, QA, review, docs) |
| Pipeline rules | Tone and output format |
| Handoff protocol | Per-agent tool table |
| Error-handling and unavailable rules | How to perform the *actual work* |
| Incident logging procedure | Persona-specific workflow steps |
| Self-documenting tools advisory | Defensive invariant (fallback) |

### Proof-of-Concept Outline

1. **Create** `.github/skills/project-ledger/SKILL.md` with the generic MCP content extracted from the current partials. Replace `{{mcp_server_name}}` with `central_pm` (acceptable because the skill lives in this workspace and is tied to this server).
2. **Create** `.github/skills/project-ledger/references/tool-reference.md` with condensed tool-by-tool documentation.
3. **Modify** one persona content template (e.g., `personas/ledger/src/content/3-developer.md`) to remove the generic MCP partials and add the bridge sentence. Keep `{{> mcp-intro}}` (tool table) and `{{> handoff-block}}`.
4. **Rebuild** the persona (`node scripts/build-personas.js`) and compare token count before/after.
5. **Test** in VS Code: activate the Developer persona, start a ledger task, and verify the skill is auto-loaded (check via Chat Debug View → Diagnostics).
6. If successful, roll out to all 6 ledger-enabled persona templates.

### What Content Moves Where

| Content | Currently | After Extraction |
|---|---|---|
| `mcp-intro.md` (intro paragraph about atomic writes) | Persona partial | **Skill** (intro section) |
| `mcp-intro.md` (per-agent tool table) | Persona partial | **Stays in persona** (role-specific) |
| `mcp-tools-note.md` (self-documenting advisory) | Persona partial | **Skill** |
| `mcp-preflight-header.md` (deferred tools loading) | Persona partial | **Skill** |
| `mcp-preflight-detect.md` (detect project step) | Persona partial | **Skill** (labeled "For agents with detect_project") |
| `mcp-preflight-verify-with-detect.md` | Persona partial | **Skill** (labeled "Step after detect") |
| `mcp-preflight-verify-no-detect.md` | Persona partial | **Skill** (labeled "For agents without detect_project") |
| `mcp-unavailable.md` (failure message) | Persona partial | **Skill** |
| `handoff-block.md` (handoff protocol) | Persona partial | **Skill** (genericized) |
| `incident-logging.md` (incident recording) | Persona partial | **Skill** |
| Per-agent `mcp_tools[]` table | Persona YAML + partial | **Stays in persona** |
| `tools: ['central_pm/*']` in frontmatter | Persona YAML | **Stays in persona** (mandatory) |

### Expected Token Savings Per Persona

| Section | Before (tokens) | After (tokens) | Delta |
|---|---|---|---|
| MCP intro paragraph | ~80 | ~20 (bridge sentence) | -60 |
| Self-documenting advisory | ~60 | 0 | -60 |
| Preflight check (header + steps + unavailable) | ~200 | 0 | -200 |
| Handoff block | ~120 | ~20 (slim reference) | -100 |
| Incident logging | ~60 | 0 | -60 |
| **Total per persona** | **~520** | **~40** | **~-480** |
| **Total across 6 personas** | **~3120** | **~240 + ~500 (skill)** | **~-2380** |

Net token savings: ~2,380 tokens across the system, with all content accessible on demand.

## Open Questions

1. **Activation reliability (largely mitigated):** The redundant activation triggers (role-based, task-based, environment-based) combined with the defensive persona invariant mean this is no longer a blocking risk. However, empirical validation is still recommended: activate the Developer persona, start a ledger task, and verify skill loading via Chat Debug View → Diagnostics. The invariant ensures the workflow is safe even if the skill doesn't load.

2. **Handoff block and `{{role}}`:** The current handoff block uses `{{role}}` (e.g., `"Developer"`) in the `ledger_get_handoff_status` call. In the skill, this must be genericized to `"<your-role>"` phrasing. The persona already defines the agent's role identity, so the model should infer the correct value — but this needs testing.

3. **Server name coupling:** The skill will hardcode `central_pm` instead of using `{{mcp_server_name}}`. If the server name changes in `_shared.yaml`, the skill must be updated manually. Consider adding a check to `build-personas.js --check` that validates the skill's server name matches `_shared.yaml`.

4. **Build-time generation (future):** Should the skill eventually be generated by the build system (Hybrid: Build-Time approach)? This would solve the server name coupling and keep the skill in sync automatically. However, it adds build complexity and should be deferred until the manual approach proves its value.

5. **Skill location:** Should this live in `.github/skills/` (workspace-level, versioned with the repo) or in `~/.copilot/skills/` (personal, across workspaces)? Given that the skill is tied to this specific MCP server and workflow, **workspace-level** (`.github/skills/`) is recommended.

6. **Impact on vanilla personas:** Vanilla personas have no MCP content, so they are unaffected. However, if vanilla personas are ever upgraded to ledger-enabled, the skill would be available without touching the persona templates. This is a minor benefit.

## Revised Assessment: Skill Extraction Is Not Worth It

After completing the research and evaluating the activation reliability mitigations, the conclusion is that **the added complexity of skill extraction is not justified at this scale**. The current partial-based system is already well-architected for this use case.

### The Defensive Invariant Contradiction

The key safety mechanism proposed — the persona invariant — is itself a compressed version of the preflight procedure. So rather than eliminating MCP knowledge from the persona, the approach splits it into a detailed version (skill) and a compact version (invariant). That's two places to maintain, not one. The invariant must stay in sync with the skill, introducing a new cross-artifact dependency that didn't exist before.

### The Partials Already Solve Single-Source-of-Truth

The perceived duplication is only in the *generated output*, not the source. Today, editing `mcp-preflight-header.md` once and rebuilding updates all 6 personas. That is exactly what "single source of truth" means. The skill doesn't improve on this — it merely moves the truth to a different location while losing template variable support.

### Token Savings Are Marginal Per Session

The ~480 tokens saved per persona sounds meaningful across the system (~2,380 total), but in practice:

- **Only one persona is active per conversation** — the real saving is ~480 tokens per session, not ~2,380.
- **The skill's body (~500 tokens) still loads when activated** — so net per-session savings are near zero.
- **In a 128K+ context window, 480 tokens is a rounding error** — well under 0.4% of available context.

### Template Variables Stop Working

The current system elegantly resolves `{{mcp_server_name}}`, `{{role}}`, `{{mcp_tools_table}}`, and `{{#if has_detect_project}}` per agent. A skill is static Markdown — all of that is lost, requiring:

- Hardcoded server name (`central_pm`) instead of `{{mcp_server_name}}`
- Both preflight variants in one document with "pick the right one" instructions instead of clean conditional inclusion
- Generic `"<your-role>"` phrasing instead of the agent's actual role name
- No per-agent tool table — it must stay in the persona regardless

This is a meaningful regression in the elegance and precision of the generated output.

### When a Skill WOULD Make Sense

The skill approach would become worthwhile if:

- **The MCP server were used across multiple workspaces** — portability across repos would justify the overhead.
- **The procedure documentation grew substantially larger** — progressive disclosure of `references/` becomes valuable when the content exceeds ~1,000 tokens.
- **Many more agents beyond 7** consumed the same procedures — at scale, the duplication cost grows while the skill's one-time loading cost stays constant.
- **The agent ecosystem matured** to provide deterministic skill activation guarantees rather than probabilistic matching.

### Final Verdict

**Keep the partials.** The current system trades a proven, deterministic, template-aware architecture for a probabilistic, static one — gaining portability that isn't currently needed at the cost of complexity that would be immediately felt. The partial-based build system is the right abstraction for this problem at this scale.

This research remains valuable as a reference if the conditions above change (especially multi-workspace portability or significant growth in agent count).

## References

- [VS Code Agent Skills documentation](https://code.visualstudio.com/docs/copilot/customization/agent-skills) — detailed VS Code integration, frontmatter properties, progressive disclosure model
- [Agent Skills specification](https://agentskills.io/specification) — open standard format: directory structure, SKILL.md format, validation
- [Agent Skills overview](https://agentskills.io/) — cross-agent portability (VS Code, Claude Code, Copilot CLI, etc.)
- [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) — alternative approach (rejected, less portable)
- [VS Code AI customization overview](https://code.visualstudio.com/docs/copilot/customization/overview) — quick reference table for skills vs instructions vs agents
- `personas/docs/agents/project-manifest/api-surface.md` — template engine syntax and build pipeline
- `personas/ledger/src/partials/` — 10 template partials (7 MCP-specific)
- `personas/ledger/src/meta/_shared.yaml` — shared metadata including `mcp_server_name: "central_pm"`
