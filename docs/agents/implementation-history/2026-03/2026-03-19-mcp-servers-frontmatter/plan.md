# Plan

## Summary

Add the `mcpServers` frontmatter field to Claude Code agent persona files so that agents get the `central_pm` MCP server pre-authorized without per-tool prompts. Research reveals that the **ledger suite is already fully implemented**: all 9 files in `personas/ledger/claude-code/` already carry `mcpServers:\n  - central_pm`, generated from the `FRONTMATTER_LEDGER_CC` template in `scripts/build-personas.js`. The outstanding work is scoped to the **standalone suite**: `ledger-bootstrapper.md` is documented in `personas/docs/agents/project-manifest/file-tree.md` as having `mcpServers: central_pm` auto-injected via its `central_pm/*` tool entry, but the current build does not produce this output because `ledger-bootstrapper.yaml` has no `mcp_server_name` field. Resolving this gap requires adding `mcp_server_name: central_pm` to `personas/standalone/src/meta/ledger-bootstrapper.yaml`, rebuilding, and correcting the stale comment in `scripts/build-personas.js` and the discrepancy in `api-surface.md`.

---

## Architectural Context

### Persona build system overview

The persona build system lives in two directories:

| Suite | Source templates | CC output |
|-------|-----------------|-----------|
| Ledger | `personas/ledger/src/` | `personas/ledger/claude-code/` |
| Standalone | `personas/standalone/src/` | `personas/standalone/claude-code/` |

Both suites are built by `scripts/build-personas.js`. The shared helper library is `scripts/lib/persona-helpers.js`.

### How `mcpServers` reaches the Claude Code frontmatter

**Ledger suite.** The constant `FRONTMATTER_LEDGER_CC` (defined at line 276 of `scripts/build-personas.js`) unconditionally includes:

```
mcpServers:
  - {{mcp_server_name}}
```

`mcp_server_name` is sourced from `personas/ledger/src/meta/_shared.yaml` (currently `"central_pm"`) and injected into the build context at line 493. All 9 ledger CC files therefore always carry this field — no per-persona YAML change is needed.

**Standalone suite.** The constant `FRONTMATTER_STANDALONE_CC` (line 303) uses an `{{#if mcp_server_name}}` conditional block:

```
{{#if mcp_server_name}}
mcpServers:
  - {{mcp_server_name}}
{{/if}}
```

The build context supplies `mcp_server_name` only when the per-persona YAML sets that field. The standalone `_shared.yaml` intentionally omits it, so only personas that explicitly declare `mcp_server_name:` in their YAML will emit the `mcpServers` block. Currently only `workflow-orchestrator.yaml` does so.

### Identified gap: `ledger-bootstrapper`

`personas/docs/agents/project-manifest/file-tree.md` (line 121) documents:

> `ledger-bootstrapper.md` — NOTE: mcpServers: central_pm auto-injected (central_pm/* declared in tools list)

This note refers to a design where `extractMcpServers(persona.tools)` derives server names from `/`-pattern tool entries. The function exists in `scripts/lib/persona-helpers.js` and the computed variable `mcp_servers_yaml` is built in the loop (lines 480–487 of `build-personas.js`). However, `FRONTMATTER_STANDALONE_CC` does **not** reference `{{mcp_servers_yaml}}` — it uses `{{#if mcp_server_name}}`. The `mcp_servers_yaml` variable is currently unused. The file-tree documentation therefore describes behavior that was planned or was at one point implemented differently, but is not what the build currently produces.

The correct resolution is to add `mcp_server_name: central_pm` to `personas/standalone/src/meta/ledger-bootstrapper.yaml`, which is the same pattern used by `workflow-orchestrator.yaml` and is how the `{{#if mcp_server_name}}` conditional is intended to be triggered.

### Current build state

Running `node scripts/build-personas.js --suite all --check --strict` passes cleanly across all 50 persona files. The build is not broken; the `ledger-bootstrapper.md` gap is silent — no `mcpServers` block is emitted, but the build neither warns nor fails because `mcp_server_name` is simply absent from the context.

---

## Approach / Architecture

The implementation has two layers:

**Layer 1 — Source change (required).** Add `mcp_server_name: central_pm` to `personas/standalone/src/meta/ledger-bootstrapper.yaml`. The existing `{{#if mcp_server_name}}` conditional in `FRONTMATTER_STANDALONE_CC` will then emit the `mcpServers` block for this persona automatically. No changes to `scripts/build-personas.js`, `scripts/lib/persona-helpers.js`, or any frontmatter template constant are required.

**Layer 2 — Documentation corrections (required).** Two documents contain misleading statements about the `mcp_servers_yaml` mechanism that must be corrected:

1. The comment on line 301 of `scripts/build-personas.js` says `"mcpServers is conditionally injected via {{mcp_servers_yaml}}"` — this is inaccurate; it is injected via `{{#if mcp_server_name}}`.
2. `personas/docs/agents/project-manifest/api-surface.md` (line 132) documents `{{mcp_servers_yaml}}` as `"YAML block string injected before the closing ---"` and describes it as used by `FRONTMATTER_STANDALONE_CC`. This was an intended design that was replaced by the `{{#if mcp_server_name}}` conditional. The row should be corrected or removed.

---

## Rationale

- The `{{#if mcp_server_name}}` pattern is already established and validated by `workflow-orchestrator.yaml`. Mirroring it in `ledger-bootstrapper.yaml` is consistent with the existing architecture.
- Adding `mcp_server_name` to the per-persona YAML (rather than changing the template to also check `mcp_servers_yaml`) keeps the rule explicit and readable: the YAML file is the single place where a standalone persona declares its MCP dependency.
- The unused `mcp_servers_yaml` computed variable could be removed from the build loop, but this is optional cleanup. It does not cause incorrect output and its removal would require a test update. Leaving it in place with a corrected comment is lower risk.
- No changes are needed to the ledger suite — it is already correct.

---

## Detailed Steps

1. **Verify current build baseline.** Run `node scripts/build-personas.js --suite all --check --strict` from the workspace root. Confirm it exits 0 with "all up-to-date" and no warnings. This establishes the pre-change baseline.

2. **Add `mcp_server_name` to `ledger-bootstrapper.yaml`.** Open `personas/standalone/src/meta/ledger-bootstrapper.yaml` and add the field `mcp_server_name: central_pm` after the `last_updated` field. No other fields in this file require changes.

3. **Rebuild the standalone CC target.** Run `node scripts/build-personas.js --suite standalone --target claude-code`. Confirm `personas/standalone/claude-code/ledger-bootstrapper.md` now contains:
   ```yaml
   mcpServers:
     - central_pm
   ```

4. **Verify the full build.** Run `node scripts/build-personas.js --suite all --check --strict`. Confirm all 50 files pass and no warnings are emitted.

5. **Correct the stale comment in `scripts/build-personas.js`.** Update the comment at line 301 from:
   ```
   // mcpServers is conditionally injected via {{mcp_servers_yaml}} when the
   // persona's tools list contains entries with '/' (MCP tool format).
   ```
   to:
   ```
   // mcpServers is conditionally injected via {{#if mcp_server_name}} — set
   // mcp_server_name in the per-persona YAML to enable this block.
   ```

6. **Correct `api-surface.md`.** In `personas/docs/agents/project-manifest/api-surface.md`, update the `{{mcp_servers_yaml}}` row in the Computed Variables table (currently line 132) to accurately reflect that this variable is computed but no longer used by the frontmatter template. Replace the row description to note its unused status, or remove the row entirely and note that `mcp_server_name` (set per-persona) triggers the `mcpServers` block via `{{#if mcp_server_name}}` in `FRONTMATTER_STANDALONE_CC`.

7. **Update `file-tree.md` note for `ledger-bootstrapper.md`.** The note at line 121 of `personas/docs/agents/project-manifest/file-tree.md` currently reads:
   ```
   ├── ledger-bootstrapper.md   # NOTE: mcpServers: central_pm auto-injected (central_pm/* declared in tools list)
   ```
   Update it to accurately reflect that the `mcpServers` block is injected because `mcp_server_name: central_pm` is set in `ledger-bootstrapper.yaml` (same mechanism as `workflow-orchestrator`), not from the `central_pm/*` tools pattern.

---

## Dependencies

- `personas/standalone/src/meta/ledger-bootstrapper.yaml` — the only source file that changes
- `scripts/build-personas.js` — comment correction only, no logic change
- `personas/docs/agents/project-manifest/api-surface.md` — documentation correction
- `personas/docs/agents/project-manifest/file-tree.md` — documentation correction

---

## Required Components

- **Modified:** `personas/standalone/src/meta/ledger-bootstrapper.yaml` — add `mcp_server_name: central_pm`
- **Modified (comment):** `scripts/build-personas.js` — correct stale comment at line 301
- **Modified (docs):** `personas/docs/agents/project-manifest/api-surface.md` — correct `{{mcp_servers_yaml}}` table row
- **Modified (docs):** `personas/docs/agents/project-manifest/file-tree.md` — correct `ledger-bootstrapper.md` annotation
- **Regenerated (output):** `personas/standalone/claude-code/ledger-bootstrapper.md` — rebuild adds `mcpServers` block

No new files. No changes to `scripts/lib/persona-helpers.js`, `scripts/sync-personas.js`, or any other template constant.

---

## Assumptions

- The `mcp_server_name` value in `personas/ledger/src/meta/_shared.yaml` will remain `"central_pm"` for the foreseeable future. If it changes, the `{{mcp_server_name}}` variable resolution in both suites will automatically propagate the new name — but any per-persona YAML that hardcodes `mcp_server_name: central_pm` (like `workflow-orchestrator.yaml` and the new `ledger-bootstrapper.yaml` entry) would need to be updated manually.
- The `mcp_servers_yaml` computed variable in `scripts/build-personas.js` is intentionally left in place (no removal) to reduce diff size and avoid rippling test changes. Its presence is harmless.
- No other standalone personas besides `ledger-bootstrapper` and `workflow-orchestrator` require `mcpServers`. All other personas in `personas/standalone/src/meta/` do not interact with the `central_pm` MCP server.

---

## Constraints

- Generated output files (`personas/ledger/claude-code/`, `personas/standalone/claude-code/`) must **never be edited directly** — changes must flow through the template sources and build.
- The build must pass `--check --strict` before and after the change with exit code 0 and no `[WARN]` lines.
- No frontmatter template constants (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`, `FRONTMATTER_LEDGER_VSCODE`, `FRONTMATTER_STANDALONE_VSCODE`) require modification.

---

## Out of Scope

- Adding `mcpServers` to VS Code agent files (`.agent.md`). VS Code uses a different frontmatter schema (`tools`, `vs_file_name`, `role`) and the MCP server authorization mechanism differs from Claude Code. No change is needed or appropriate.
- Removing the unused `mcp_servers_yaml` computed variable and updating its test coverage. This is deferred cleanup.
- Changes to any ledger suite files — they are already correct.
- Updating `personas/standalone/src/meta/_shared.yaml` to add a shared `mcp_server_name` — standalone personas intentionally set this per-persona to opt in selectively.

---

## Acceptance Criteria

- `personas/standalone/claude-code/ledger-bootstrapper.md` contains `mcpServers:\n  - central_pm` in its YAML frontmatter after rebuild.
- All other standalone CC files remain unchanged (no new `mcpServers` blocks added).
- All 9 ledger CC files retain their existing `mcpServers:\n  - central_pm` blocks unchanged.
- `node scripts/build-personas.js --suite all --check --strict` exits 0 with "all up-to-date" and zero `[WARN]` or `[STRICT]` lines.
- The comment at line 301 of `scripts/build-personas.js` no longer references `{{mcp_servers_yaml}}`.
- `personas/docs/agents/project-manifest/api-surface.md` no longer describes `{{mcp_servers_yaml}}` as the active mechanism for standalone CC `mcpServers` injection.
- `personas/docs/agents/project-manifest/file-tree.md` annotation for `ledger-bootstrapper.md` accurately describes the `mcp_server_name` YAML field as the trigger.

---

## Testing Strategy

1. **Pre-change baseline:** Run `node scripts/build-personas.js --suite all --check --strict` and confirm clean exit.
2. **Post-change verification:** Rebuild with `node scripts/build-personas.js --suite standalone --target claude-code`, then run `--suite all --check --strict` again.
3. **Output inspection:** Confirm `ledger-bootstrapper.md` frontmatter contains the expected `mcpServers` block and no other standalone file changed unexpectedly.
4. **Regression check:** Run the existing Vitest suite (`npx vitest run scripts/tests/` from workspace root) to confirm no helper function behavior changed.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`mcp_server_name` hardcoded per-persona drifts from `_shared.yaml`** | The build uses `{{mcp_server_name}}` variable resolution — both `workflow-orchestrator.yaml` and `ledger-bootstrapper.yaml` will use whatever value is in `_shared.yaml` at build time, because the value is resolved from the context which injects `sharedMeta.mcp_server_name` first (then overridden by `...persona` spread). Wait — actually the per-persona `mcp_server_name` field set in the YAML _would_ shadow the shared one via the spread. Both YAMLs set `mcp_server_name: central_pm` explicitly, matching the shared value. If `_shared.yaml` changes, these per-persona overrides would need manual updates. Mitigation: document this in the `constraints.md` as a maintenance note. |
| **Context layer ordering allows persona YAML to override `mcp_server_name`** | This is by design for standalone. For ledger, `mcp_server_name` comes from `_shared.yaml` only (no per-persona override). The risk is accepted. |
| **Stale `mcp_servers_yaml` variable triggers future confusion** | The comment correction in step 5 makes the variable's unused status clear. If a future developer needs the auto-derivation path, the variable and `extractMcpServers()` remain available. |
