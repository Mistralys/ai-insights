# Personas - Model Registry
<INSTRUCTION>
# Personas - Model Registry
File-based model registry: entry schema (id/name/slug/cc_model), seed/working-copy lifecycle (default.json → local.json), deterministic zero-namespace UUIDs, the "Inherit / Auto" sentinel, and the shipped default model catalog.

</INSTRUCTION>
------------------------------------------------------------
_SOURCE: Model registry README (schema, lifecycle, UUID convention, sentinel, how-to)_
# Model registry README (schema, lifecycle, UUID convention, sentinel, how-to)
```
// Structure of documents
└── personas/
    └── model-registry/
        └── README.md

```
###  Path: `/personas/model-registry/README.md`

```md
# Model Registry

The `model-registry/` directory holds the file-based model configuration for the persona system. It contains three files with distinct lifecycles:

| File | Tracked in Git | Purpose |
|---|---|---|
| `default.json` | ✅ Yes | Shipped seed models. Copied into `local.json` on first access. |
| `local.json` | ❌ No (gitignored) | Working copy of the model list. Single source of truth at runtime. |
| `assignments.json` | ❌ No (gitignored) | Per-persona model assignments and the global default model selection. |

## How `default.json` and `local.json` Relate

`default.json` is a **seed file**, not a runtime layer. It exists solely so new installations start with a sensible set of models. At runtime:

1. On first access, `local.json` is auto-initialized by copying all entries from `default.json`.
2. The GUI's **Load Defaults** button re-runs this merge on demand — new default entries (identified by `id`) are added to `local.json`; entries that already exist are left unchanged.
3. Once copied into `local.json`, entries are fully editable and deletable like any user-registered model.

There is no concept of "built-in" vs. "custom" at runtime — `local.json` is the single source of truth for the model list. `default.json` is never read during normal operation.

## Entry Schema

Each entry in `default.json` (and `local.json`) is a JSON object with exactly four fields:

| Field | Type | Description |
|---|---|---|
| `id` | UUID string | Stable primary key. Never changes after creation — even if `name` or `slug` is edited. |
| `name` | string | Human-readable display name (shown in the GUI). |
| `slug` | string | URL-safe identifier used internally for model resolution. |
| `cc_model` | string | Claude Code model value. See [cc_model values](#cc_model-values) below. |

### `cc_model` Values

- **`"inherit"`** — Claude Code defers to the user's configured model. Use this for Anthropic models, where Claude Code's built-in `inherit` behaviour is appropriate.
- **Explicit model name** (e.g., `"gemini-3-5-flash"`) — Use this for non-Anthropic models that Claude Code cannot resolve via `inherit`.

## Formatting Convention

Entries in `default.json` use **single-line inline JSON**, one object per line, with fields in the order `id`, `name`, `slug`, `cc_model`. This keeps diffs minimal (one line changed per entry) and makes the file easy to scan:

```json
[
  { "id": "00000000-0000-0000-0000-000000000000", "name": "Inherit / Auto", "slug": "inherit", "cc_model": "inherit" },
  { "id": "00000000-0000-0000-0000-000000000001", "name": "Claude Opus 4.6", "slug": "claude-opus-4-6", "cc_model": "inherit" },
  { "id": "00000000-0000-0000-0000-000000000002", "name": "Claude Sonnet 4.6", "slug": "claude-sonnet-4-6", "cc_model": "inherit" },
  { "id": "00000000-0000-0000-0000-000000000003", "name": "Gemini 3.5 Flash", "slug": "gemini-3-5-flash", "cc_model": "gemini-3-5-flash" }
]
```

Maintain this convention when adding new default entries so that `git diff` output remains readable.

## Deterministic Zero-Namespace UUIDs

Default entries use **deterministic zero-namespace UUIDs** — sequential values starting at `00000000-0000-0000-0000-000000000000`. This is intentional:

- **Stable across installations** — the same UUID always refers to the same default model, regardless of when or where the workspace was cloned.
- **Safe merge-by-ID in `loadDefaults()`** — when loading defaults into `local.json`, the merge logic matches entries by `id`. Deterministic UUIDs guarantee that the "Inherit / Auto" entry (id `000...000`) or "Claude Sonnet 4.6" (id `000...002`) can never accidentally collide with a user-generated entry (which uses randomly-generated UUIDs).

When adding a new default model to `default.json`, assign the next sequential zero-namespace UUID (e.g., `00000000-0000-0000-0000-000000000004`).

## The "Inherit / Auto" Sentinel

The first entry — slug `inherit`, id `00000000-0000-0000-0000-000000000000` — is a **sentinel value**. When a persona is assigned this model:

- **VS Code output:** The `model` frontmatter field is omitted entirely (the user's model picker selection takes effect).
- **Claude Code output:** `model: 'inherit'` is set in frontmatter (Claude Code defers to the user's configured model).
- **Orchestrator:** Skips the per-persona assignment and falls back through the full 5-step priority chain before finally applying the inherit sentinel:
  1. `assignments.json` → `persona_models[persona_id]` UUID → slug (skipped if slug is `inherit` or unknown)
  2. Per-persona YAML `model_slug` (or `model`)
  3. `assignments.json` → `default_model_uuid` UUID → slug (skipped if slug is `inherit` or unknown)
  4. `_shared.yaml` `default_model_slug` (or `default_model`)
  5. **Inherit sentinel** — `model: ''` (falsy, omitted from VS Code frontmatter via `{{#if model}}`), `cc_model: 'inherit'`

  In practice, assigning a persona the `inherit` slug causes the chain to skip steps 1 and 3 (the assignment steps), but steps 2–4 still apply. Only when no model is configured at any YAML level does the system reach step 5 and apply the inherit sentinel unconditionally.

Consumers identify the sentinel by checking `slug === 'inherit'` on the resolved slug — no special-case structure is needed in assignment storage.

## Adding a New Default Model

1. Open `default.json`.
2. Append a new entry at the end of the array using the next sequential zero-namespace UUID.
3. Set `cc_model` to `"inherit"` for Anthropic models, or to the explicit model name for non-Anthropic models.
4. Follow the single-line inline JSON formatting convention.
5. The new entry will be merged into existing `local.json` files the next time **Load Defaults** is triggered from the GUI.

## Further Reading

- [Personas Build System](../README.md) — Overview of the template engine and suite structure
- [Plan: Model Settings](../../docs/agents/plans/2026-07-21-model-settings/plan.md) — Architecture decisions and rationale for the model registry design

```
_SOURCE: Shipped seed model catalog (default.json)_
# Shipped seed model catalog (default.json)
```
// Structure of documents
└── personas/
    └── model-registry/
        └── default.json

```
###  Path: `/personas/model-registry/default.json`

```json
[
  {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "Inherit / Auto",
    "slug": "inherit",
    "cc_model": "inherit"
  },
  {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Claude Opus 4.6 (Anthropic)",
    "slug": "Claude Opus 4.6 (anthropic)",
    "cc_model": "claude-opus-4-6"
  },
  {
    "id": "00000000-0000-0000-0000-000000000002",
    "name": "Claude Sonnet 4.6 (Copilot)",
    "slug": "Claude Sonnet 4.6 (copilot)",
    "cc_model": "claude-sonnet-4-6"
  },
  {
    "id": "00000000-0000-0000-0000-000000000003",
    "name": "Gemini 3.6 Flash",
    "slug": "Gemini 3.6 Flash (Preview) (copilot)",
    "cc_model": "inherit"
  },
  {
    "id": "389cf92e-7bed-4bb2-b6f4-f10bc888c856",
    "name": "GPT-5.6 Luna",
    "slug": "GPT-5.6 Luna (copilot)",
    "cc_model": "inherit"
  },
  {
    "id": "420f0a4f-88a4-463f-8d0a-e34a55787d75",
    "name": "GPT-5.6 Terra",
    "slug": "GPT-5.6 Terra (copilot)",
    "cc_model": "inherit"
  },
  {
    "id": "76a07931-7017-4824-a399-01bf48d81670",
    "name": "MAI-Code-1-Flash",
    "slug": "MAI-Code-1-Flash (copilot)",
    "cc_model": "inherit"
  },
  {
    "id": "80ca3c6c-616a-4359-b51b-e108d65cc90e",
    "name": "Claude Sonnet 4.6 (Anthropic)",
    "slug": "Claude Sonnet 4.6 (anthropic)",
    "cc_model": "claude-sonnet-4-6"
  }
]

```