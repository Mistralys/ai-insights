# Plan

## Summary

Post-synthesis rework plan for the 9-Agent Personas Expansion project. This plan addresses all actionable items surfaced in the [synthesis report](../2026-03-14-9-agent-personas/synthesis.md): 5 strategic recommendations (Gold Nuggets), 8 technical debt entries, and 6 explicit next steps — deduplicated into 8 concrete work items spanning micro-fixes, documentation polish, template infrastructure investigation, and new documentation authoring.

## Architectural Context

The workspace is a monorepo with two sub-projects:

- **MCP Server** (`mcp-server/`) — TypeScript MCP server with pipeline routing, canonical ordering enforcement (`CANONICAL_PIPELINE_ORDERING` in `mcp-server/src/utils/constants.ts`), and work-package lifecycle management.
- **Personas** (`personas/`) — Template engine that assembles 48 persona files (9 ledger + 15 standalone × 2 IDE targets) from YAML metadata + Markdown content + shared partials.

Key files involved in this rework:

| File | Relevance |
|------|-----------|
| `scripts/check-known-roles.js` | Success message lacks role count (Gold Nugget #5) |
| `personas/docs/agents/project-manifest/constraints.md` | Needs canonical pipeline ordering callout (GN #3) and WP-ID auto-generation guidance (GN #4) |
| `personas/ledger/src/content/6-reviewer.md` | Mission statement retains "secure" (debt item) |
| `personas/shared/partials/release-engineer-output-format.md` | Lacks explicit comment type documentation (debt item) |
| `personas/ledger/README.md` | Workflow diagram shows old 4-stage fixed loop (debt item) |
| `scripts/build-personas.js` | `FRONTMATTER_STANDALONE_CC` lacks `mcpServers` support (debt item / investigation) |
| `personas/standalone/src/meta/_shared.yaml` | No `mcpServers` field — standalone CC template gap |
| `personas/standalone/` | No `README.md` exists for 15 standalone personas (debt item) |
| `personas/ledger/src/meta/8-documentation.yaml` | `vs_file_name: 8-docs.agent.md` vs `cc_file_name: 8-documentation.md` naming divergence (debt item) |

## Approach / Architecture

Group the actionable items into 8 steps by priority and logical coupling:

1. **Micro-fix: `check-known-roles.js`** — One-line change to include role count in success message. Highest signal-to-effort ratio.
2. **Personas `constraints.md`: canonical pipeline ordering callout** — Add a new top-level constraint documenting the `CANONICAL_PIPELINE_ORDERING` as a **hard runtime constraint** and cross-reference `mcp-server/docs/agents/project-manifest/constraints.md` (Constraints 19, 65, 66).
3. **Personas `constraints.md`: WP-ID auto-generation guidance** — Add a constraint documenting the WP-ID auto-generation behavior: agents must not pass `work_package_id`, must capture returned IDs, must use captured IDs in dependency arrays.
4. **Polish `6-reviewer.md` mission statement** — Replace "secure" with "well-architected" in the Reviewer persona content template to align with the offloaded security responsibilities (WP-005).
5. **Align `release-engineer-output-format.md` with `security-auditor-output-format.md`** — Add explicit comment `type` documentation to the Release Engineer output format partial, mirroring the Security Auditor's approach.
6. **Update `personas/ledger/README.md` workflow diagram** — Replace or extend the workflow overview section to reflect the 9-agent layout with dynamic optional stages (Security Audit + Release Engineering).
7. **Investigate standalone CC `mcpServers` gap** — Assess whether `FRONTMATTER_STANDALONE_CC` in `build-personas.js` can be conditionally extended with `mcpServers` for personas that declare MCP tool dependencies (specifically `ledger-bootstrapper`). Produce a recommendation, not necessarily a full implementation, since it's a template infrastructure change.
8. **Create `personas/standalone/README.md`** — Document all 15 standalone personas, grouping the 4 PM sub-agents as an orchestration cluster. Reference Claude Code `mcpServers` limitation.

The `vs_file_name`/`cc_file_name` naming divergence on the documentation persona (`8-docs.agent.md` vs `8-documentation.md`) is explicitly **not addressed** in this plan — it is an intentional ID-stability artifact (see personas constraints.md §25b) and the synthesis itself notes it as "worth aligning in a future housekeeping pass." Attempting to align it now would break existing users' `@id` routing.

Similarly, the "persona renames used file delete+create instead of `git mv`" debt item is historical and cannot be retroactively fixed — it is noted for future practice only.

## Rationale

- **Priority ordering** mirrors the synthesis "Next Steps" section, which already ranks by signal-to-effort ratio.
- The `constraints.md` updates (steps 2–3) are grouped together since they both modify the same file.
- The CC `mcpServers` gap (step 7) is scoped as an investigation rather than implementation because it requires a design decision on whether the standalone CC template should conditionally include `mcpServers` (breaking the current "no mcpServers for standalone" convention in constraint 21) or whether a new template variant is needed.
- Steps 1–6 are pure execution with no design ambiguity. Steps 7–8 have a dependency: the README (step 8) should reference the CC limitation, so step 7's findings inform step 8's content.

## Detailed Steps

### Step 1: Fix `check-known-roles.js` success message

In [scripts/check-known-roles.js](../../../scripts/check-known-roles.js) (line 113), change:

```js
console.log('[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync.');
```

to include the role count:

```js
console.log(`[check-known-roles] OK: KNOWN_ROLES and AGENT_ROLES are in sync (${agentRoles.length} roles).`);
```

This is a single-line change. Verify by running `node scripts/check-known-roles.js` and confirming the output reads `(9 roles)`.

### Step 2: Add canonical pipeline ordering callout to personas `constraints.md`

In [personas/docs/agents/project-manifest/constraints.md](../../../personas/docs/agents/project-manifest/constraints.md), add a new constraint in the **Cross-System Dependencies** section (after constraint 35):

**New constraint 36: Canonical Pipeline Stage Ordering Is a Hard Runtime Constraint**

Content must state:
- `active_pipeline_stages` must be a **strict subsequence** of `CANONICAL_PIPELINE_ORDERING`: `['implementation', 'qa', 'security-audit', 'code-review', 'release-engineering', 'documentation']`.
- Stages may be omitted but **never reordered**.
- `ledger_create_work_package` rejects arrays that violate this ordering (see MCP server constraint 66).
- The Pipeline Configurator sub-agent and any agent documentation that teaches pipeline composition must present this as a hard constraint, not a suggestion.
- Cross-reference: `mcp-server/docs/agents/project-manifest/constraints.md` → Constraints 19, 65, 66.

### Step 3: Add WP-ID auto-generation guidance to personas `constraints.md`

In the same file, add a new constraint:

**New constraint 37: Work Package IDs Are Auto-Generated**

Content must state:
- `ledger_create_work_package` **does not accept** a `work_package_id` parameter. IDs are auto-generated and returned in the tool response.
- On non-fresh ledgers (e.g., after clearing a previous project), IDs will not start at WP-001.
- Agents and sub-agent personas that create WPs must: (1) not pass `work_package_id`, (2) capture the returned ID from the tool response, (3) use the captured ID in `dependencies` arrays for subsequent WP creation calls.
- This constraint applies to: the PM persona, the `ledger-bootstrapper` standalone sub-agent, and any documentation that teaches WP creation.

### Step 4: Polish `6-reviewer.md` mission statement

In [personas/ledger/src/content/6-reviewer.md](../../../personas/ledger/src/content/6-reviewer.md), locate the Mission section (currently reads "Look beyond just 'does it work?' to ensure the code is maintainable, secure, and follows architectural best practices.") and replace `secure` with `well-architected`:

```markdown
Look beyond just "does it work?" to ensure the code is maintainable, well-architected, and follows architectural best practices.
```

After editing, rebuild personas (`node scripts/build-personas.js --suite ledger`) and verify the generated `6-reviewer` output files in both `vs-code/` and `claude-code/` reflect the updated wording.

### Step 5: Add explicit comment types to `release-engineer-output-format.md`

In [personas/shared/partials/release-engineer-output-format.md](../../../personas/shared/partials/release-engineer-output-format.md), expand the `comments` bullet to explicitly document the expected comment types, mirroring the approach in [personas/shared/partials/security-auditor-output-format.md](../../../personas/shared/partials/security-auditor-output-format.md). Add type documentation such as:

- `type`: `"release-note"` for user-facing changelog entries; `"breaking-change"` for migration-required changes; `"version-decision"` for semver rationale; `"improvement"` for non-blocking observations.

Rebuild and verify.

### Step 6: Update `personas/ledger/README.md` workflow diagram

The [personas/ledger/README.md](../../../personas/ledger/README.md) currently describes the 9-agent workflow accurately in prose and in the Dynamic Pipeline Configuration table, but the "Agents in the Workflow" section and Quick Reference section are text-based, not a visual diagram. The synthesis flags a "README workflow diagram (ASCII art) shows old 4-stage fixed loop" — locate any ASCII art that shows the old 4-stage loop and update it to reflect the 9-agent layout with dynamic optional stages.

Specifically:
- Ensure any visual workflow representation shows all 9 agents in order.
- Show Security Audit (stage 5) and Release Engineering (stage 7) as optional/conditional stages (dashed lines or bracketed notation).
- Confirm the Dynamic Pipeline Configuration table (already updated in WP-008) is accurate and complete.

### Step 7: Investigate standalone CC `mcpServers` gap

**Investigation scope** — do not implement; produce a recommendation.

The `FRONTMATTER_STANDALONE_CC` template in [scripts/build-personas.js](../../../scripts/build-personas.js) (line 474) does not include `mcpServers`. This means `ledger-bootstrapper.md` (Claude Code standalone) cannot access MCP tools.

Assess these options:
1. **Conditional `mcpServers` in `FRONTMATTER_STANDALONE_CC`** — If a standalone persona's YAML includes a `tools` entry matching `*/` (e.g., `central_pm/*`), inject `mcpServers` into the CC frontmatter. Requires build-script logic to detect MCP-dependent standalone personas.
2. **New template variant** — A third standalone CC template (`FRONTMATTER_STANDALONE_CC_MCP`) used when `has_mcp: true` is set in standalone YAML.
3. **Accept the limitation** — Document it clearly in `standalone/README.md` and leave the workaround (use full PM persona for CC ledger bootstrapping) as the official guidance.

Evaluate each option against constraint 21 ("Standalone `_shared.yaml` must not contain `mcp_server_name` or `roster`") and the current build-script architecture.

Record the recommendation in the plan directory work notes so the PM can scope a future WP if implementation is warranted.

### Step 8: Create `personas/standalone/README.md`

Create a new [personas/standalone/README.md](../../../personas/standalone/README.md) documenting all 15 standalone personas:

Structure:
- **Overview**: Standalone personas are single-purpose tools that do not participate in the ledger pipeline workflow. They have no `role` field, no roster, and no agent-to-agent handoff.
- **PM Sub-Agent Cluster**: Group the 4 PM sub-agents (`wp-decomposer`, `dependency-sequencer`, `pipeline-configurator`, `ledger-bootstrapper`) as an orchestration cluster, explaining the chain: each agent's output is the next agent's input.
- **Persona Catalog**: Table listing all 15 personas with slug, name, description, and VS Code / Claude Code filenames.
- **Claude Code Limitations**: Note the `mcpServers` gap for `ledger-bootstrapper` and the official workaround.
- **Build & Sync**: Cross-reference `personas/docs/agents/project-manifest/` for build/sync instructions.

Source the persona catalog data from the YAML files in `personas/standalone/src/meta/`.

## Dependencies

- Steps 2 and 3 both modify `personas/docs/agents/project-manifest/constraints.md` — they must be sequenced (not parallel).
- Step 7 (investigation) should complete before step 8 (README creation) so the CC limitation section can reference the recommendation.
- Step 4 requires a persona rebuild; step 5 requires a persona rebuild. These can be combined into a single build pass.
- All other steps are independent.

## Required Components

| Component | Type | Action |
|-----------|------|--------|
| `scripts/check-known-roles.js` | Existing script | Edit (1 line) |
| `personas/docs/agents/project-manifest/constraints.md` | Existing manifest doc | Edit (add 2 constraints) |
| `personas/ledger/src/content/6-reviewer.md` | Existing persona content | Edit (1 word) |
| `personas/shared/partials/release-engineer-output-format.md` | Existing shared partial | Edit (expand comment types) |
| `personas/ledger/README.md` | Existing documentation | Edit (update diagram) |
| `scripts/build-personas.js` | Existing build script | Read-only (investigation in step 7) |
| `personas/standalone/README.md` | **New file** | Create |
| Plan directory work notes (step 7 output) | **New file** | Create |
| `personas/docs/agents/project-manifest/file-tree.md` | Existing manifest doc | Edit (add `standalone/README.md` entry) |

## Assumptions

- The "old 4-stage ASCII art diagram" referenced by the synthesis is located in `personas/ledger/README.md`. If it has already been removed and only text/table-based workflow descriptions remain, step 6 scope shrinks to a verification pass.
- The 15 standalone personas are the final set for v3.8.0 — no new standalone personas are expected before this rework completes.
- Constraint numbering in `personas/docs/agents/project-manifest/constraints.md` is sequential and currently ends around 35; new constraints will use 36 and 37.

## Constraints

- **Never edit generated persona files** — only edit sources in `personas/*/src/` and shared partials in `personas/shared/partials/`. Rebuild to propagate.
- **Constraint numbering must be sequential** in `personas/docs/agents/project-manifest/constraints.md`.
- **ID stability** — do not modify any `id` fields in persona YAML (per constraint 25b).
- **Standalone convention** — constraint 21 prohibits `mcp_server_name` in standalone `_shared.yaml`. Step 7's investigation must respect this.

## Out of Scope

- **`vs_file_name`/`cc_file_name` documentation persona naming divergence** — intentional ID-stability artifact; alignment deferred to future housekeeping.
- **`git mv` for historical persona renames** — cannot be retroactively fixed; noted for future practice.
- **Implementing the CC `mcpServers` gap fix** — step 7 is investigation only; implementation (if warranted) will be a separate plan.
- **Persona version bump** — these are polish/documentation changes, not feature additions. No version bump required.
- **MCP server code changes** — this plan is confined to the personas sub-project and root-level scripts.

## Acceptance Criteria

1. `node scripts/check-known-roles.js` outputs `(9 roles)` in its success message.
2. `personas/docs/agents/project-manifest/constraints.md` contains a constraint documenting canonical pipeline stage ordering as a hard runtime constraint, cross-referencing MCP server constraints 19, 65, 66.
3. `personas/docs/agents/project-manifest/constraints.md` contains a constraint documenting WP-ID auto-generation behavior with the 3-point guidance (don't pass ID, capture returned ID, use captured ID in dependencies).
4. Generated `6-reviewer` persona output (both VS Code and Claude Code) contains "well-architected" instead of "secure" in the mission statement.
5. `release-engineer-output-format.md` explicitly documents comment types (`release-note`, `breaking-change`, `version-decision`, `improvement`).
6. `personas/ledger/README.md` workflow visualization accurately reflects the 9-agent layout with dynamic optional stages — no stale 4-stage-only references remain.
7. A recommendation for the standalone CC `mcpServers` gap is documented.
8. `personas/standalone/README.md` exists and catalogs all 15 standalone personas with the PM sub-agent cluster and CC limitation documented.
9. `personas/docs/agents/project-manifest/file-tree.md` references the new `standalone/README.md`.
10. All persona files build cleanly after changes (`node scripts/build-personas.js --suite all --strict` exits 0).

## Testing Strategy

- **Step 1**: Run `node scripts/check-known-roles.js` and verify output contains `(9 roles)`.
- **Steps 2–3**: Review `constraints.md` manually; verify cross-references to MCP server constraints are accurate by spot-checking the referenced constraint numbers.
- **Steps 4–5**: Run `node scripts/build-personas.js --suite all --strict` and confirm exit code 0. Spot-check generated `6-reviewer` output for "well-architected" and generated Release Engineer output for comment type documentation.
- **Step 6**: Visual inspection of README; `grep` for "4-stage" or other stale references.
- **Step 7**: Review recommendation document for completeness and constraint compliance.
- **Step 8**: Review `standalone/README.md` for completeness; verify persona catalog matches YAML sources.
- **Final**: Run `node scripts/build-personas.js --check --suite all --strict` to confirm no stale output.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Constraint numbering collision** — another change may have added constraints since synthesis | Verify current max constraint number before editing; use next sequential numbers |
| **"Old 4-stage ASCII art" may not exist** — synthesis may be referring to a section already updated | Grep `personas/ledger/README.md` for 4-stage/ASCII art patterns first; adjust step 6 scope if already resolved |
| **Standalone CC `mcpServers` investigation may surface broader design implications** | Scope step 7 strictly as investigation; defer implementation to a separate plan regardless of findings |
| **Build script changes upstream** — if `build-personas.js` is modified concurrently, step 7 findings may become stale | Pin investigation to current build-script version; note any assumptions |
| **Partial rebuild race** — editing multiple persona sources then building may expose ordering issues | Always rebuild with `--suite all` to ensure full consistency |
