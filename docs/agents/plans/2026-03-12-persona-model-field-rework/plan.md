# Plan: Re-Add Target Model Field to Ledger Personas (Rework)

## Summary

Re-introduce the per-persona `model` field to the ledger persona build system. The original implementation (2026-03-10) was lost in subsequent changes. This rework plan targets the current codebase state, which has **zero** model-related infrastructure: no `default_model` in `_shared.yaml`, no `model` field in any per-persona YAML, no `{{model}}` in the VS Code frontmatter template, and no model resolution logic in `buildForTarget()`. The Claude Code template already has `model: '{{cc_model}}'` via `ccFrontmatterFields()`, currently resolving to `"inherit"`.

**Model assignment:** Agents 1 (Planner) and 2 (Project Manager) → `Claude Opus 4.6`; Agents 3–7 → `Claude Sonnet 4.6`.

## Architectural Context

The persona build system assembles generated persona files from YAML metadata + Markdown content templates using [scripts/build-personas.js](../../../../scripts/build-personas.js). Relevant architecture:

- **Shared metadata**: [personas/ledger/src/meta/_shared.yaml](../../../../personas/ledger/src/meta/_shared.yaml) — contains suite-wide defaults (`author`, `last_updated`, `default_version`, `cc_model`, etc.)
- **Per-persona YAML**: [personas/ledger/src/meta/1-planner.yaml](../../../../personas/ledger/src/meta/1-planner.yaml) through `7-synthesis.yaml` — per-agent fields that override shared defaults via spread
- **Frontmatter templates** (constants in build script):
  - `FRONTMATTER_LEDGER_VSCODE` — currently has **no** `model` field ([line 436](../../../../scripts/build-personas.js#L436))
  - `FRONTMATTER_LEDGER_CC` — uses `ccFrontmatterFields()` which emits `model: '{{cc_model}}'` ([line 431](../../../../scripts/build-personas.js#L431))
- **Context assembly** in `buildForTarget()` ([line 498](../../../../scripts/build-personas.js#L498)): shared fields load first, then per-persona fields spread on top (`...persona`), then computed values are appended. The `cc_model` value currently passes through directly from `sharedMeta.cc_model` (= `"inherit"`).
- **Existing override pattern**: `version` already uses `persona.version ?? sharedMeta.default_version` — this is the established pattern to follow.

### Current state (confirmed by codebase inspection):

| Artifact | Model-related content |
|----------|-----------------------|
| `_shared.yaml` | `cc_model: "inherit"` — no `default_model` |
| Per-persona YAMLs (1–7) | No `model` field on any persona |
| `FRONTMATTER_LEDGER_VSCODE` | No `model` line |
| `FRONTMATTER_LEDGER_CC` | `model: '{{cc_model}}'` via `ccFrontmatterFields()` (resolves to `'inherit'`) |
| `buildForTarget()` context | `cc_model: sharedMeta.cc_model` — no resolution logic |
| Generated VS Code output | No `model:` in frontmatter |
| Generated Claude Code output | `model: 'inherit'` |
| Manifest docs | `cc_model` documented; no `default_model` or `model` |

## Approach / Architecture

### Design: Per-persona `model` field with `default_model` shared fallback

Mirror the established `version` / `default_version` override pattern:

1. **`default_model`** in `_shared.yaml` → `"Claude Sonnet 4.6"` (majority case for 5 of 7 agents).
2. **Per-persona `model`** on Agents 1 & 2 → `"Claude Opus 4.6"`. Agents 3–7 omit the field and inherit `default_model`.
3. **Resolution logic** in `buildForTarget()`:
   ```js
   const model = persona.model !== undefined
     ? persona.model
     : sharedMeta.default_model;
   ```
4. **Unified `cc_model` derivation**: Instead of the static `sharedMeta.cc_model` passthrough, derive `cc_model` from the resolved `model` value with a fallback chain:
   ```
   persona.cc_model → resolved model → sharedMeta.cc_model (legacy fallback)
   ```
5. **VS Code frontmatter**: Add `model: '{{model}}'` to `FRONTMATTER_LEDGER_VSCODE`.
6. **Claude Code frontmatter**: No template change needed — `ccFrontmatterFields()` already emits `model: '{{cc_model}}'`, which will now resolve to the actual model name instead of `"inherit"`.

### Why `default_model` instead of per-persona everywhere

Five of seven agents share the same model. A shared default avoids duplication and simplifies future model upgrades. This is consistent with the `default_version` and `default_cc_tools` patterns.

### Why unify `model` and `cc_model`

The user wants the same model for both IDE targets. Keeping two independent fields creates confusion. The computed `cc_model` context variable will be derived from the resolved `model` value, with an escape hatch: if a per-persona `cc_model` is explicitly set, it takes priority (for future divergence needs).

### Fallback chain for `cc_model`

```
persona.cc_model → persona.model → sharedMeta.default_model → sharedMeta.cc_model
```

This preserves backward compatibility: the standalone suite has no `default_model`, so its existing `cc_model: "inherit"` path still works untouched.

## Rationale

- **Opus for reasoning-heavy roles**: The Planner and PM produce architectural plans and decompose work — tasks that benefit from deeper reasoning capabilities.
- **Sonnet for execution roles**: Agents 3–7 handle implementation, testing, review, docs, and synthesis — excellent Sonnet territory at lower cost/latency.
- **Pattern compliance**: Uses the established `default_X` + per-persona override pattern — no new architectural concepts introduced.

## Detailed Steps

### 1. Add `default_model` to ledger `_shared.yaml`

**File:** [personas/ledger/src/meta/_shared.yaml](../../../../personas/ledger/src/meta/_shared.yaml)

Add `default_model: 'Claude Sonnet 4.6'` after the existing `default_version` field. Add a brief inline comment explaining the override pattern (matching the style of existing comments in the file).

**Before:**
```yaml
default_version: "3.5.0"
mcp_server_name: "central_pm"
```

**After:**
```yaml
default_version: "3.5.0"
default_model: "Claude Sonnet 4.6"    # Override per-persona via `model:` field
mcp_server_name: "central_pm"
```

### 2. Add `model` field to Agents 1 and 2 YAML

**Files:**
- [personas/ledger/src/meta/1-planner.yaml](../../../../personas/ledger/src/meta/1-planner.yaml)
- [personas/ledger/src/meta/2-project-manager.yaml](../../../../personas/ledger/src/meta/2-project-manager.yaml)

Add `model: "Claude Opus 4.6"` to each file. Place it after the `role` field to group identity-related fields together.

Agents 3–7 intentionally omit the field and inherit `default_model`.

### 3. Update `buildForTarget()` in build script

**File:** [scripts/build-personas.js](../../../../scripts/build-personas.js)

In the context-building section of `buildForTarget()` (around [line 575](../../../../scripts/build-personas.js#L575), near the existing `version` resolution):

**a. Add model resolution** (immediately after the `version` resolution block):
```js
const model = persona.model !== undefined
  ? persona.model
  : (sharedMeta.default_model || sharedMeta.cc_model || 'inherit');
```

**b. Compute unified `cc_model`** (immediately after):
```js
const ccModel = persona.cc_model !== undefined
  ? persona.cc_model
  : model;
```

**c. Update the context object** — add `model` and override `cc_model`:

In the context object (around [line 622](../../../../scripts/build-personas.js#L622)):
- Replace the existing line `cc_model: sharedMeta.cc_model,` with `cc_model: ccModel,`
- Add `model,` to the computed values section (after `version,`)

This ensures:
- The `...persona` spread cannot clobber the computed `cc_model` because the explicit `cc_model: ccModel` is placed in the computed section which comes **after** the spread.
- Both `{{model}}` and `{{cc_model}}` resolve correctly in templates.

### 4. Add `model` to `FRONTMATTER_LEDGER_VSCODE`

**File:** [scripts/build-personas.js](../../../../scripts/build-personas.js)

Update the `FRONTMATTER_LEDGER_VSCODE` constant (at [line 436](../../../../scripts/build-personas.js#L436)) to include a `model` field. Place it after `description` to group identity fields. Use single quotes for YAML safety (defensive against future model names with special characters):

**Before:**
```yaml
---
id: {{id}}
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
role: {{role}}
...
```

**After:**
```yaml
---
id: {{id}}
name: '{{number}} - {{role}} v{{version}}'
description: 'Step {{number}}/{{total}} in the agent workflow.'
model: '{{model}}'
role: {{role}}
...
```

No change needed to `FRONTMATTER_LEDGER_CC` or `ccFrontmatterFields()` — they already emit `model: '{{cc_model}}'`.

### 5. Update manifest documentation

**a. [personas/docs/agents/project-manifest/api-surface.md](../../../../personas/docs/agents/project-manifest/api-surface.md)**:

- Add `default_model` to the `_shared.yaml` schema table:
  ```
  | `default_model` | `string` | Default AI model for generated frontmatter (e.g. `"Claude Sonnet 4.6"`). Per-persona `model` overrides this. |
  ```
- Add `model` to the per-persona YAML schema table (optional field):
  ```
  | `model` | `string` | no | AI model override — replaces `default_model` for this persona (e.g. `"Claude Opus 4.6"`) |
  ```
- Update the `FRONTMATTER_LEDGER_VSCODE` template listing to include `model: '{{model}}'` after `description`
- Add `model` to the computed variables section (if one exists) or note its resolution chain

**b. [personas/docs/agents/project-manifest/data-flows.md](../../../../personas/docs/agents/project-manifest/data-flows.md)**:

- Add `default_model` to the Layer 1 shared metadata comment in the context merge details
- Add `model` to the Layer 3 computed values with resolution chain comment:
  ```js
  model,               // persona.model ?? _shared.default_model ?? _shared.cc_model
  ```
- Update `cc_model` in Layer 1 comment to note it is now overridden in Layer 3:
  ```js
  cc_model:            ccModel,  // persona.cc_model ?? resolved model
  ```

**c. [personas/docs/agents/project-manifest/constraints.md](../../../../personas/docs/agents/project-manifest/constraints.md)**:

- Add a constraint (after existing constraint 28) documenting the `default_model` + per-persona `model` override pattern, mirroring the style of constraint 26 (`default_version`).
- Add a constraint documenting the `cc_model` resolution chain: `persona.cc_model → persona.model → sharedMeta.default_model → sharedMeta.cc_model`.

### 6. Rebuild and verify

```bash
node scripts/build-personas.js --suite ledger --strict
```

Verify that:
- Agents 1 and 2 have `model: 'Claude Opus 4.6'` in VS Code output and `model: 'Claude Opus 4.6'` in Claude Code output
- Agents 3–7 have `model: 'Claude Sonnet 4.6'` in both outputs
- `--strict` passes (no unresolved `{{…}}` markers)

### 7. Standalone regression check

```bash
node scripts/build-personas.js --suite standalone --check
```

Confirm no side effects on standalone suite. The standalone suite has no `default_model`, so the fallback chain should resolve to `sharedMeta.cc_model` (= `"inherit"`), preserving existing behavior.

### 8. Sync to IDEs

```bash
node scripts/sync-personas.js
```

## Dependencies

- No external dependencies. All changes are within the personas build system.
- Steps 1–4 must complete before Step 6 (build/verify).
- Step 5 (docs) can be done in parallel with Steps 1–4.
- Step 7 is independent of Step 5.
- Step 8 depends on Step 6 passing.

## Required Components

| Component | Status | Path |
|-----------|--------|------|
| Ledger shared YAML | **existing — modify** | `personas/ledger/src/meta/_shared.yaml` |
| Planner YAML | **existing — modify** | `personas/ledger/src/meta/1-planner.yaml` |
| Project Manager YAML | **existing — modify** | `personas/ledger/src/meta/2-project-manager.yaml` |
| Build script | **existing — modify** | `scripts/build-personas.js` |
| API surface doc | **existing — modify** | `personas/docs/agents/project-manifest/api-surface.md` |
| Data flows doc | **existing — modify** | `personas/docs/agents/project-manifest/data-flows.md` |
| Constraints doc | **existing — modify** | `personas/docs/agents/project-manifest/constraints.md` |

No new files are created (aside from this plan).

## Assumptions

- `"Claude Opus 4.6"` and `"Claude Sonnet 4.6"` are the correct model identifier strings for VS Code's `model` frontmatter field. If VS Code uses different identifiers (e.g., `claude-opus-4-6`), the YAML values will need adjustment.
- The standalone suite does not need model pinning at this time (remains `cc_model: "inherit"`).
- The `model` field in VS Code agent frontmatter is a supported field.

## Constraints

- **No changes to standalone suite** — this plan only touches the ledger suite.
- **No changes to `FRONTMATTER_LEDGER_CC` template or `ccFrontmatterFields()`** — the CC template already has `model: '{{cc_model}}'` which will now resolve to the computed model value.
- **Backward compatibility**: if `default_model` is absent from `_shared.yaml` (e.g., standalone suite), the fallback chain gracefully degrades to `cc_model` → `"inherit"`.
- Follow the Edit → Build → Sync workflow (constraint 3 in [constraints.md](../../../../personas/docs/agents/project-manifest/constraints.md)).
- Note the synthesis recommendation from the original execution: use single-quoted `'{{model}}'` in the VS Code template for YAML safety. This plan incorporates that recommendation.

## Out of Scope

- Standalone persona model assignment
- Model-specific behavioral tuning in persona content templates
- Automated model version detection or validation
- Changes to the MCP server or orchestrator
- Removal of the legacy `cc_model` field from `_shared.yaml` (documented as dead config, but kept for standalone suite backward compatibility)

## Acceptance Criteria

- [ ] `_shared.yaml` has `default_model: "Claude Sonnet 4.6"`
- [ ] `1-planner.yaml` and `2-project-manager.yaml` have `model: "Claude Opus 4.6"`
- [ ] Agents 3–7 YAML files do NOT have a `model` field (inherit default)
- [ ] `FRONTMATTER_LEDGER_VSCODE` template includes `model: '{{model}}'`
- [ ] `buildForTarget()` resolves `model` with per-persona → default → fallback chain
- [ ] `buildForTarget()` derives `cc_model` from resolved `model` (not passthrough from shared)
- [ ] Generated VS Code output for Agents 1–2 contains `model: 'Claude Opus 4.6'`
- [ ] Generated VS Code output for Agents 3–7 contains `model: 'Claude Sonnet 4.6'`
- [ ] Generated Claude Code output for Agents 1–2 contains `model: 'Claude Opus 4.6'`
- [ ] Generated Claude Code output for Agents 3–7 contains `model: 'Claude Sonnet 4.6'`
- [ ] `node scripts/build-personas.js --suite ledger --strict` passes (exit 0)
- [ ] `node scripts/build-personas.js --suite standalone --check` passes (no regression)
- [ ] Manifest documents (`api-surface.md`, `data-flows.md`, `constraints.md`) updated

## Testing Strategy

1. **Build verification**: `node scripts/build-personas.js --suite ledger --strict` — confirms no unresolved markers.
2. **Output inspection**: Spot-check generated files in `personas/ledger/vs-code/` and `personas/ledger/claude-code/` for correct `model` values per agent.
3. **Standalone regression**: `node scripts/build-personas.js --suite standalone --check` — confirms no side effects.
4. **Sync dry-run**: `node scripts/sync-personas.js --dry-run` to verify sync detects the updated files.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **VS Code doesn't recognize `model` field** | Field is silently ignored if unsupported — no breakage. Can be verified by invoking an agent after sync. |
| **Model name string mismatch** | Verify the exact model identifier string after implementation by checking VS Code's model picker. Value can be trivially updated in YAML. |
| **`cc_model` resolution change breaks standalone** | Fallback chain degrades gracefully: standalone has no `default_model`, so `sharedMeta.cc_model` (= `"inherit"`) is used. Verified by the standalone `--check` test. |
| **Context spread order clobbers computed `cc_model`** | The `cc_model: ccModel` assignment is placed in the computed section AFTER the `...persona` spread, ensuring the computed value wins. |
| **Changes lost again in future refactors** | The manifest documentation (api-surface, data-flows, constraints) serves as the source of truth — future agents will see the model field as an established pattern. |

## Differences from Original Plan (2026-03-10)

| Aspect | Original | This Rework |
|--------|----------|-------------|
| Starting state | Pre-model-field, `cc_model: "inherit"` in CC template via inline string | Pre-model-field, `cc_model` now emitted via `ccFrontmatterFields()` helper |
| VS Code template quoting | Unquoted `model: {{model}}` | Quoted `model: '{{model}}'` (incorporates synthesis recommendation #2) |
| Docs scope | `api-surface.md` + `constraints.md` | `api-surface.md` + `data-flows.md` + `constraints.md` (incorporates synthesis finding that data-flows also needed updating) |
| Dead assignment cleanup | Not addressed | Not in scope (low-priority cleanup, handled separately if desired) |
| Legacy `cc_model` removal | Not addressed | Not in scope (kept for standalone backward compatibility) |
