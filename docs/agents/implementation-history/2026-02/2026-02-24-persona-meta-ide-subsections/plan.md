# Plan

## Summary

Restructure all IDE-specific properties in all 15 per-persona YAML source files (7 ledger + 8 standalone) by grouping them under two nested sub-sections: `vs_code` and `claude_code`. This covers four flat top-level keys: `vs_file_name` → `vs_code.file_name`, `cc_file_name` → `claude_code.file_name`, `tools` → `vs_code.tools`, and `cc_tools` → `claude_code.tools`. The build script (`scripts/build-personas.js`) must be updated to read all four properties from the new nested paths and explicitly re-map `vs_file_name` into the render context. The fallback from `cc_tools` to `sharedMeta.default_cc_tools` is preserved by reading from `persona.claude_code?.tools`. The sync script (`scripts/sync-personas.js`) is **unaffected** because it reads `vs_file_name` from the *generated output frontmatter*, not from the YAML source files. Manifest documentation is updated to reflect the new schema.

---

## Architectural Context

### Key actors

| File / Module | Role |
|---|---|
| `personas/ledger/src/meta/N-name.yaml` (7 files) | Source YAML — ledger persona metadata |
| `personas/standalone/src/meta/<slug>.yaml` (8 files) | Source YAML — standalone persona metadata |
| `scripts/build-personas.js` | Reads source YAMLs, derives computed variables, renders frontmatter templates |
| `scripts/sync-personas.js` | Reads **generated output** YAML frontmatter; **does not read source YAMLs** |
| `personas/docs/agents/project-manifest/api-surface.md` | Canonical documentation of the metadata schema |
| `personas/docs/agents/project-manifest/constraints.md` | Naming conventions (constraints 13, 14) |

### How IDE-specific properties are used today

1. **`build-personas.js`** spreads the raw `persona` object into the render `context`. Because `vs_file_name` is a flat top-level key, the spread makes `context.vs_file_name` available and the `{{vs_file_name}}` template marker resolves in `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE`.
2. **`build-personas.js`** reads `persona.cc_file_name` directly to compute `cc_name` (`persona.cc_file_name.replace(/\.md$/, '')`).
3. **`validateCcFileName(persona, suite)`** checks `if (!persona.cc_file_name)`.
4. **`build-personas.js`** reads `persona.tools` to compute `tools_json` (ledger) and `tools_list` (both modes) via `serializeTools` / `serializeToolsList` (lines 511, 530).
5. **`build-personas.js`** reads `persona.cc_tools || sharedMeta.default_cc_tools || []` to compute `cc_tools_json` (ledger) and `cc_tools_list` (both modes) (lines 513, 532). The `sharedMeta.default_cc_tools` fallback is critical — personas without a `cc_tools` key inherit the shared default.
6. **`sync-personas.js`** reads `vs_file_name` from the **rendered YAML frontmatter** of generated output files — it never reads source YAML files, so the source restructure is invisible to it.

---

## Approach / Architecture

### New YAML structure (both suites)

```yaml
# Before
vs_file_name: 4-qa.agent.md
cc_file_name: 4-qa.md
tools:
  - vscode
  - execute
  - read
cc_tools:               # present only on some personas
  - Bash
  - Read
  - Edit

# After
vs_code:
  file_name: 4-qa.agent.md
  tools:
    - vscode
    - execute
    - read
claude_code:
  file_name: 4-qa.md
  tools:                # omit to inherit default_cc_tools from _shared.yaml
    - Bash
    - Read
    - Edit
```

Personas that currently omit `cc_tools` (inheriting `default_cc_tools` from `_shared.yaml`) will simply omit `claude_code.tools` — the fallback behaviour is preserved in the build script.

### Build script adaptation

Because the four flat keys no longer exist on `persona` after the restructure, the build script must:

1. **Explicitly map `vs_file_name` into the context** so that `{{vs_file_name}}` continues to resolve in frontmatter templates:
   ```js
   vs_file_name: persona.vs_code?.file_name,
   ```
   This explicit entry must appear **after** `...persona` in the context object to ensure it is set even though the spread no longer contributes a `vs_file_name` key.

2. **Update `validateCcFileName`** to read from the new path:
   ```js
   if (!persona.claude_code?.file_name) { ... }
   ```
   Update the JSDoc `@param` annotation to reflect the new shape as well.

3. **Update both `cc_name` derivations** (numbered mode for ledger; standalone mode) to read:
   ```js
   cc_name = persona.claude_code.file_name.replace(/\.md$/, '');
   ```

4. **Update `tools_json` derivation** (ledger numbered mode, line 511):
   ```js
   tools_json = serializeTools(persona.vs_code?.tools || []);
   ```

5. **Update `cc_tools_json` derivation** (ledger numbered mode, lines 513–514):
   ```js
   const ccTools = persona.claude_code?.tools || sharedMeta.default_cc_tools || [];
   cc_tools_json = serializeTools(ccTools);
   ```

6. **Update `tools_list` derivation** (both modes, line 530):
   ```js
   const tools_list = serializeToolsList(persona.vs_code?.tools || []);
   ```

7. **Update `cc_tools_list` derivation** (both modes, lines 531–532):
   ```js
   const cc_tools_list = serializeToolsList(
     persona.claude_code?.tools || sharedMeta.default_cc_tools || []
   );
   ```

### No changes to `sync-personas.js`

Confirmed: `sync-personas.js` reads `vs_file_name` only from the YAML frontmatter of *generated* output files (via `extractVSFileName` / `parseFrontmatter`). The frontmatter templates (`FRONTMATTER_LEDGER_VSCODE`, `FRONTMATTER_STANDALONE_VSCODE`) still render `vs_file_name: {{vs_file_name}}`, so the generated output is identical. No changes required.

### No changes to frontmatter templates

The four frontmatter template strings inside `build-personas.js` (`FRONTMATTER_LEDGER_VSCODE`, `FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_VSCODE`, `FRONTMATTER_STANDALONE_CC`) remain unchanged. Only the read path into `persona` changes.

---

## Rationale

- **Grouping related properties** reduces cognitive load when authoring or reviewing a persona YAML — all VS Code settings are in one block, all Claude Code settings in another.
- **Using nested maps** (not lists) is the idiomatic YAML approach for a named sub-object; it avoids array indexing (`persona.vs_code[0].file_name`) and maps cleanly to `persona.vs_code.file_name` in JavaScript.
- **Consistent inner key name (`file_name`)** for both subsections avoids asymmetry and makes future extensions (e.g., `vs_code.description`, `claude_code.model`) predictably placed.
- **Minimum blast radius**: the change is confined to source YAML files and the single build script. Generated output, frontmatter templates, and the sync script are all unaffected.
- **`cc_tools` fallback preserved**: reading `persona.claude_code?.tools` with optional chaining ensures that personas omitting the key still fall through to `sharedMeta.default_cc_tools`, maintaining identical generated output for the majority of personas.

---

## Detailed Steps

1. **Update all 7 ledger persona YAML files** (`personas/ledger/src/meta/1-planner.yaml` … `7-synthesis.yaml`):
   - Remove `vs_file_name`, `cc_file_name`, `tools`, and `cc_tools` (if present) flat top-level keys.
   - Add `vs_code:` block containing `file_name` and `tools` sub-keys.
   - Add `claude_code:` block containing `file_name` and, only when the persona previously had `cc_tools`, a `tools` sub-key (personas without `cc_tools` omit `claude_code.tools` to preserve `default_cc_tools` fallback).

2. **Update all 8 standalone persona YAML files** (`personas/standalone/src/meta/<slug>.yaml`, all except `_shared.yaml`):
   - Apply the same key replacement as in step 1.

3. **Update `scripts/build-personas.js` — `validateCcFileName`**:
   - Change `if (!persona.cc_file_name)` → `if (!persona.claude_code?.file_name)`.
   - Update the `[ERROR]` message to reference `claude_code.file_name` for clarity.
   - Update the JSDoc `@param` to reflect the new shape.

4. **Update `scripts/build-personas.js` — numbered-mode `cc_name` derivation** (ledger suite):
   - Change `cc_name = persona.cc_file_name.replace(/\.md$/, '')` → `cc_name = persona.claude_code.file_name.replace(/\.md$/, '')`.

5. **Update `scripts/build-personas.js` — standalone-mode `cc_name` derivation**:
   - Change `cc_name = persona.cc_file_name.replace(/\.md$/, '')` → `cc_name = persona.claude_code.file_name.replace(/\.md$/, '')`.

6. **Update `scripts/build-personas.js` — `tools_json` and `cc_tools_json`** (numbered mode, lines 511–514):
   - `tools_json = serializeTools(persona.vs_code?.tools || [])`
   - `const ccTools = persona.claude_code?.tools || sharedMeta.default_cc_tools || [];`

7. **Update `scripts/build-personas.js` — `tools_list` and `cc_tools_list`** (both modes, lines 530–532):
   - `const tools_list = serializeToolsList(persona.vs_code?.tools || []);`
   - `const cc_tools_list = serializeToolsList(persona.claude_code?.tools || sharedMeta.default_cc_tools || []);`

8. **Update `scripts/build-personas.js` — build context object**:
   - After the `...persona` spread, add an explicit `vs_file_name: persona.vs_code?.file_name` entry so `{{vs_file_name}}` continues to resolve in frontmatter templates.

9. **Verify the build**:
   - Run `node scripts/build-personas.js --suite all --strict` and confirm zero `[WARN]`, zero `[STRICT]`, exit 0.
   - Run `node scripts/build-personas.js --suite all --check` to confirm output is up-to-date.

10. **Update `personas/docs/agents/project-manifest/api-surface.md`**:
    - In the **Per-Persona YAML — Ledger Suite** schema table: replace the `vs_file_name`, `cc_file_name`, `tools`, and `cc_tools` rows with `vs_code` object rows (`file_name`, `tools`) and `claude_code` object rows (`file_name`, `tools`).
    - In the **Standalone Per-Persona YAML (`<slug>.yaml`)** schema table: apply the same replacement.

11. **Update `personas/docs/agents/project-manifest/constraints.md`**:
    - Constraint 13: replace `vs_file_name` / `cc_file_name` references with `vs_code.file_name` / `claude_code.file_name`.
    - Constraint 14: update `cc_file_name` → `claude_code.file_name` and the derivation description.
    - Constraint 15: update `cc_tools` → `claude_code.tools` throughout.

---

## Dependencies

- All steps are sequential; steps 1–8 must complete before step 9 (ensure build passes before updating docs).
- Steps 1 and 2 are independent of each other (ledger vs standalone YAMLs) and can be done in parallel.
- Steps 3–8 are all within `build-personas.js` and should be applied together in one pass.
- Steps 10 and 11 are independent of each other and can be done in parallel.

---

## Required Components

### Modified files

| File | Type of change |
|---|---|
| `personas/ledger/src/meta/1-planner.yaml` | YAML key restructure |
| `personas/ledger/src/meta/2-project-manager.yaml` | YAML key restructure |
| `personas/ledger/src/meta/3-developer.yaml` | YAML key restructure |
| `personas/ledger/src/meta/4-qa.yaml` | YAML key restructure |
| `personas/ledger/src/meta/5-reviewer.yaml` | YAML key restructure |
| `personas/ledger/src/meta/6-documentation.yaml` | YAML key restructure |
| `personas/ledger/src/meta/7-synthesis.yaml` | YAML key restructure |
| `personas/standalone/src/meta/agents-md-curator.yaml` | YAML key restructure |
| `personas/standalone/src/meta/changelog-curator.yaml` | YAML key restructure |
| `personas/standalone/src/meta/composer-curator.yaml` | YAML key restructure |
| `personas/standalone/src/meta/manifest-curator.yaml` | YAML key restructure |
| `personas/standalone/src/meta/module-intent-architect.yaml` | YAML key restructure |
| `personas/standalone/src/meta/readme-curator.yaml` | YAML key restructure |
| `personas/standalone/src/meta/researcher.yaml` | YAML key restructure |
| `personas/standalone/src/meta/unit-test-auditor.yaml` | YAML key restructure |
| `scripts/build-personas.js` | Read path changes for `cc_file_name`, `vs_file_name`, `tools`, and `cc_tools`; context object update |
| `personas/docs/agents/project-manifest/api-surface.md` | Schema table updates |
| `personas/docs/agents/project-manifest/constraints.md` | Constraint 13 and 14 updates |

### No changes required

| File | Reason |
|---|---|
| `scripts/sync-personas.js` | Reads generated output frontmatter only — unaffected |
| `scripts/build-personas.js` frontmatter template strings | `{{vs_file_name}}` still resolved from context; template strings unchanged |
| All files in `personas/ledger/vs-code/` | Generated — will be regenerated by step 7 |
| All files in `personas/ledger/claude-code/` | Generated — will be regenerated by step 7 |
| All files in `personas/standalone/vs-code/` | Generated — will be regenerated by step 7 |
| All files in `personas/standalone/claude-code/` | Generated — will be regenerated by step 7 |
| `personas/ledger/src/meta/_shared.yaml` | No IDE file name keys |
| `personas/standalone/src/meta/_shared.yaml` | No IDE file name keys |

---

## Assumptions

- All 8 standalone YAML files have both `vs_file_name` and `cc_file_name` as flat top-level keys (verified: confirmed in research).
- The inner key name is `file_name` for both `vs_code` and `claude_code` subsections (confirmed by user).
- The subsections use nested map syntax (no `-`), not list syntax (confirmed by user).
- `_shared.yaml` files in both suites do not contain `vs_file_name`, `cc_file_name`, `tools`, or `cc_tools` at the top level and are untouched.
- No content template (`.md` files in `src/content/`) or partial uses `{{vs_file_name}}`, `{{cc_file_name}}`, `{{tools_json}}`, or `{{cc_tools_json}}` directly — only frontmatter templates do (verified via code review; these are computed variables, not raw YAML keys).
- Only `module-intent-architect.yaml` currently has a `cc_tools` override (verified in research); all other personas inherit `default_cc_tools`. After restructure, only that persona will have `claude_code.tools` set.

---

## Constraints

- The generated output frontmatter (`vs_file_name:` in VS Code outputs, `tools:` in all outputs) must remain byte-for-byte identical after this change so `sync-personas.js` continues to work without modification.
- The `cc_name` computed variable must still equal `claude_code.file_name` with `.md` stripped — this constraint is unchanged.
- The `cc_tools` → `default_cc_tools` fallback must survive: personas omitting `claude_code.tools` must still produce correct tool lists in generated output.
- Build must pass `--strict --suite all` with no unresolved markers and zero warnings (beyond any pre-existing ones) before documentation is updated.

---

## Out of Scope

- Adding additional properties to the `vs_code` or `claude_code` subsections (e.g., icon, description per IDE). This plan only addresses migrating the four existing flat keys.
- Changing the `_shared.yaml` schema (including `default_cc_tools`).
- Modifying frontmatter template strings.
- Any changes to `sync-personas.js`.
- Changing the generated output format (generated files remain identical post-rebuild).

---

## Acceptance Criteria

- All 15 per-persona YAML source files use `vs_code.file_name`, `vs_code.tools`, `claude_code.file_name` nested maps; no `vs_file_name`, `cc_file_name`, `tools`, or `cc_tools` flat keys remain at the top level of any source YAML.
- Only `module-intent-architect.yaml` (standalone) carries `claude_code.tools`; all other personas omit it (fallback to `default_cc_tools`).
- `node scripts/build-personas.js --suite all --strict` exits 0 with no `[ERROR]` or `[STRICT]` lines.
- `node scripts/build-personas.js --suite all --check` exits 0 (output is up-to-date after rebuild).
- `node scripts/sync-personas.js --dry-run` runs without errors or unexpected warnings.
- `git diff personas/ledger/vs-code/ personas/ledger/claude-code/ personas/standalone/vs-code/ personas/standalone/claude-code/` shows no changes after rebuild (generated output is identical).
- `api-surface.md` schema tables no longer reference flat `vs_file_name`, `cc_file_name`, `tools`, `cc_tools` keys; they document the new nested structure.
- `constraints.md` constraints 13, 14, and 15 are updated to use the new key paths.

---

## Testing Strategy

- **Build verification (--strict):** `node scripts/build-personas.js --suite all --strict` — confirms zero unresolved markers and exit 0.
- **Staleness check:** `node scripts/build-personas.js --suite all --check` — confirms all generated output matches the rebuilt source.
- **Sync dry-run:** `node scripts/sync-personas.js --dry-run` — confirms the sync script parses generated frontmatter correctly without deploying files.
- **Diff check on generated output:** Run `git diff personas/ledger/vs-code/ personas/standalone/vs-code/` after the rebuild. The diff should be empty (generated output is semantically unchanged).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`{{vs_file_name}}` marker left unresolved** in frontmatter if the context override is forgotten or placed before the `...persona` spread instead of after it | Place the explicit `vs_file_name: persona.vs_code?.file_name` entry after `...persona` in the context object; verify with `--strict` before completing the task |
| **One of the 15 YAML files missed** in the restructure, causing a build error or stale-check failure | After all YAML edits, run `grep -r "^vs_file_name\|^cc_file_name\|^tools:\|^cc_tools:" personas/ledger/src/meta personas/standalone/src/meta` to confirm no flat keys remain |
| **`cc_tools` fallback broken** — if `persona.claude_code?.tools` is not used with optional chaining, personas without `claude_code.tools` will get an empty tool list instead of the `default_cc_tools` fallback | Use optional chaining (`?.tools`) in all four derivation sites; verify with `--strict` which would catch an empty `tools:` in generated output as a silent wrong value — complement with a git diff check |
| **`validateCcFileName` not updated**, causing spurious `[ERROR]` exits on every build | Update steps 3 and 4/5 atomically — test immediately after changing the build script |
| **Manifest docs out of sync** if the build-script changes are applied but documentation is skipped | Include manifest updates (steps 10–11) as a required part of the work package, not optional follow-up |
