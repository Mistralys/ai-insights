# Multi-Store Ledger Guide

AI Insights supports multiple independent ledger root directories — called **stores** — in a single MCP server instance. Each store has its own project ledger and repository registry, so you can separate data by machine, team, or concern without coupling the server to any specific sync mechanism.

> **Default behaviour:** With no `stores.json` present, the server runs in single-store / legacy mode using the default ledger root. No action is required for existing setups.

---

## What Is a Store?

A store is a directory that holds:

- A project ledger (`{repo}/{slug}/project-ledger.json`)
- A repository registry (`.repositories.json`)
- A knowledge store (`.knowledge/`)

You register stores in `~/.ai-insights/stores.json`. The MCP server loads this file at startup and routes all operations to the correct store automatically.

---

## Setup Walkthrough

### 1. Initialize stores.json

Run `store init` once from the workspace root. It creates `~/.ai-insights/stores.json` with a single default store pointing at the current ledger root:

```bash
node scripts/cli.js store init
# or, pointing at a custom ledger root:
node scripts/cli.js store init /path/to/my-ledger
```

This also creates `~/.ai-insights/stores/` as the recommended directory for additional store roots.

### 2. Add a second store

```bash
node scripts/cli.js store add work ~/ai-insights/stores/work
```

- `work` — the store ID (a slug: lowercase letters, digits, and hyphens)
- `~/ai-insights/stores/work` — path to the store root; created if it does not exist

You can add as many stores as needed. Store-array order in `stores.json` determines priority: when the same repository appears in multiple stores, the **first matching store wins**.

### 3. Verify

```bash
node scripts/cli.js store list
```

Output shows each store's ID, label, path, repo count, and project count, with the default store marked.

---

## Repository Registration

Each project's `ledger_detect_project` call resolves a repository by matching the workspace folder name against the `folder_names` array in `.repositories.json`. Register a repository in the store where its projects should live:

```bash
# Register a repository in the 'work' store
node scripts/cli.js store repo add my-project work

# List all repositories across all stores
node scripts/cli.js store repo list

# Move a repository from one store to another
node scripts/cli.js store repo move my-project personal
```

> `store repo add` creates a minimal registry entry (UUID, empty vision fields) compatible with the GUI's Strategy page. You can enrich the entry via the GUI after registration.

---

## CLI Reference

All `store` commands are available via:

```bash
node scripts/cli.js store <subcommand> [args]
```

| Subcommand | Args | Description |
|---|---|---|
| `init [ledger-root]` | Optional path | Create `~/.ai-insights/stores.json` with the current (or specified) ledger root as the default store |
| `add <id> <path>` | Store ID + path | Register a new store directory; creates the directory and an empty `.repositories.json` |
| `remove <id>` | Store ID | Remove a store from `stores.json`; the directory itself is **not** deleted |
| `list` | — | Show all stores with repo and project counts |
| `default <id>` | Store ID | Set the `default_store` field in `stores.json` |
| `conflicts` | — | Show repositories registered in more than one store; indicates winner and shadowed entries |
| `status` | — | Show Git ahead/behind counts for each store (only applicable when the store directory is a Git repo) |
| `repo add <repo-name> <store-id>` | Repo name + store ID | Add a repository entry to the specified store's `.repositories.json` |
| `repo move <repo-name> <target-store-id>` | Repo name + store ID | Move a repository entry from its current store to another (validate-before-mutate: no partial writes on conflict) |
| `repo list` | — | List all repositories across all stores; shadowed entries are marked |

---

## Migration Walkthrough: Single-Store → Multi-Store

If you have been running AI Insights in single-store mode, your existing data is already in the default ledger root. The migration to multi-store is additive — no data is moved.

**Step 1 — Run `store init`**

```bash
node scripts/cli.js store init
```

This creates `stores.json` with one store pointing at your existing ledger root. The existing ledger data stays in place.

**Step 2 — Add additional stores (optional)**

```bash
node scripts/cli.js store add personal ~/ai-insights/stores/personal
```

**Step 3 — Register existing repositories**

If you used the GUI to register repositories in the single-store setup, they are already in the default store's `.repositories.json` and will appear normally. If you want to move a repository to a different store:

```bash
node scripts/cli.js store repo move my-repo personal
```

**Step 4 — Restart the MCP server**

The MCP server and GUI server both read `stores.json` at startup. Restart them to pick up the new configuration.

> **Data safety:** `store init` returns an error if `stores.json` already exists. `store remove` does not delete the store directory. `store repo move` uses validate-before-mutate semantics — if a conflict is detected in the target store, the source registry is not modified.

---

## stores.json Format

`~/.ai-insights/stores.json` is a plain JSON file validated against `StoresConfigSchema`:

```json
{
  "stores": [
    {
      "id": "default",
      "label": "Default",
      "path": "/Users/you/ledger"
    },
    {
      "id": "work",
      "label": "Work Projects",
      "path": "/Users/you/ai-insights/stores/work"
    }
  ],
  "default_store": "default"
}
```

- `id` — unique slug (lowercase letters, digits, hyphens; must start with a letter or digit)
- `path` — absolute path or `~/`-prefixed path (expanded at runtime)
- `label` — optional display name; defaults to `id`
- `default_store` — must match an existing store `id`; the first store in the array wins when routing

---

## FAQ

**Can I use `~` in store paths?**  
Yes. `~/my-store` and `~` are expanded to `os.homedir()` at runtime. Relative paths are resolved against `process.cwd()`.

**What happens if a repository is in two stores?**  
The MCP server follows store-array order from `stores.json`. The first store whose `.repositories.json` claims a `folder_name` wins. Shadowed entries are surfaced by `store conflicts` and `store repo list`.

**Does removing a store delete my data?**  
No. `store remove` only removes the entry from `stores.json`. The directory and all project files remain on disk.

**Can I rename a store ID?**  
Not directly — remove the old entry and add a new one, then update `default_store` if needed. The store directory itself is unchanged.

**Do I need to restart the server after changing stores.json?**  
Yes. Both the MCP server (`src/index.ts`) and GUI server (`gui/server.ts`) read `stores.json` once at startup.

**What is `store status` for?**  
It shows Git ahead/behind counts for stores that are Git repositories — useful when a store root is a synced Git repo (e.g. on a network drive or dotfiles repo). Stores that are not Git repos are listed as "not a git repo".
