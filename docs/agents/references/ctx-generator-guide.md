# CTX Generator — Agent Reference Guide

> **Audience:** AI agents (CTX Architect and others) responsible for designing, creating, and
> maintaining `context.yaml` files in this workspace.
>
> **Scope:** Document generation layer only. MCP server, HTTP server, Docker, and
> prompts/tools configuration are out of scope for this guide.
>
> **Official docs:** https://docs.ctxllm.com/
> **JSON Schema:** https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

---

## Table of Contents

1. [What is CTX?](#1-what-is-ctx)
2. [Running CTX](#2-running-ctx)
3. [Top-Level Structure](#3-top-level-structure-of-contextyaml)
4. [Documents](#4-documents)
5. [Source Types](#5-source-types)
   - 5.1 [`file`](#51-file-source)
   - 5.2 [`tree`](#52-tree-source)
   - 5.3 [`text`](#53-text-source)
   - 5.4 [`url`](#54-url-source)
   - 5.5 [`git_diff`](#55-git_diff-source)
   - 5.6 [`github`](#56-github-source)
   - 5.7 [Quick reference](#57-source-type-quick-reference)
6. [Modifiers](#6-modifiers)
   - 6.1 [`sanitizer`](#61-sanitizer-modifier)
   - 6.2 [PHP-specific modifiers](#62-php-specific-modifiers)
   - 6.3 [Modifier aliases](#63-modifier-aliases-reusable-named-modifiers)
   - 6.4 [Document-level modifiers](#64-document-level-modifiers)
7. [Variables](#7-variables)
8. [Configuration Imports](#8-configuration-imports)
9. [Best Practices](#9-best-practices)
10. [Decision Guide](#10-decision-guide)
11. [Worked Examples](#11-worked-examples)
12. [Quick Reference Tables](#12-quick-reference-tables)

---

## 1. What is CTX?

CTX is a context management tool that generates structured Markdown documents from a codebase
or other sources, making them easy to feed into an LLM. Instead of dumping an entire repo, you
declare exactly what to include in a `context.yaml` file. CTX collects, filters, transforms,
and writes the output.

The primary artifact you produce is a **`context.yaml`** (or `context.json`) file placed at the
project root.

### Pipeline

```
Declare (context.yaml)
  → Collect (sources pull content from files, URLs, git, etc.)
    → Filter & Transform (filePattern, path filters, modifiers)
      → Output (structured Markdown files for LLM consumption)
```

---

## 2. Running CTX

```bash
# Generate all context documents (default command)
ctx
ctx generate       # equivalent
ctx build          # equivalent
ctx compile        # equivalent

# Preview resolved configuration without generating files
ctx display

# Initialize a new context.yaml in the current directory
ctx init
ctx init --config-file=context.json   # JSON format

# Point to a specific config file or directory
ctx -c path/to/custom-config.yaml
ctx -c src/configs                    # uses default config file in that directory

# Load environment variables from a .env file
ctx --env                             # load default .env
ctx --env=.env.local                  # load specific file

# Verbosity flags
ctx -v      # info-level logs
ctx -vv     # debug-level logs
ctx -q      # errors only

# Show JSON Schema URL
ctx schema
ctx schema --download                 # download schema to current directory

# Update CTX to latest version
ctx self-update
ctx update         # equivalent

# Check current version
ctx version
ctx version --check-updates

# Pass configuration inline (no config file needed)
ctx -i '{"documents":[{"description":"Quick Context","outputPath":"output.md","sources":[{"type":"text","content":"Sample content"}]}]}'
```

---

## 3. Top-Level Structure of `context.yaml`

```yaml
$schema: https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

# Optional: reusable variables
variables:
  key: value

# Optional: reusable modifier aliases
settings:
  modifiers:
    alias-name:
      name: modifier-name
      options: {}

# Optional: import other config files
import:
  - path: other/context.yaml

# Required: the documents to generate
documents:
  - description: "..."
    outputPath: "..."
    sources:
      - type: ...
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string | Optional but recommended — enables IDE validation and autocompletion |
| `variables` | object | Custom reusable variables (see §7) |
| `settings.modifiers` | object | Named modifier aliases (see §6.3) |
| `import` | array | External config files to merge in (see §8) |
| `documents` | array | **Required.** List of documents to generate |

---

## 4. Documents

Each entry in `documents` defines one output file.

```yaml
documents:
  - description: "Human-readable name"
    outputPath: "docs/output.md"
    overwrite: true
    tags:
      - api
      - v1
    modifiers:         # Document-level modifiers (applied to all sources)
      - sanitizer
    sources:
      - ...
```

### Document properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `description` | string | required | Human-readable label for the document |
| `outputPath` | string | required | File path where the document is saved (directory created if missing) |
| `overwrite` | boolean | `true` | Set to `false` to skip generation if the file already exists |
| `tags` | array | `[]` | Categorization labels |
| `modifiers` | array | `[]` | Modifiers applied to **all** sources in this document |
| `sources` | array | required | Content providers (see §5) |

### `overwrite: false`

Useful for `github` or `url` sources where re-fetching is expensive. If the output file already
exists, generation is skipped entirely.

---

## 5. Source Types

A document contains one or more sources. Each source contributes content to the final output.
The `type` field selects the source. Sources are processed in declaration order and their content
is concatenated.

---

### 5.1 `file` Source

The most common source. Scans local paths and includes matching files.

```yaml
- type: file
  description: "Source files"
  sourcePaths:
    - src/Auth
    - src/Models
  filePattern: "*.ts"           # Glob. Default: "*.*"
  notPath:                      # Exclude paths containing these strings
    - tests
    - vendor
  path: Controller              # Only include files whose path contains this
  contains: "class Service"     # Only include files whose content contains this
  notContains: "@deprecated"    # Exclude files whose content contains this
  size: "< 100K"                # File size constraint
  date: "since 1 month ago"     # Date-modified constraint
  maxFiles: 20                  # Limit number of files (0 = unlimited)
  ignoreUnreadableDirs: true    # Skip unreadable directories
  treeView: true                # Show directory tree in output (boolean or object)
  modifiers:
    - sanitizer
  tags:
    - controllers
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sourcePaths` | string\|array | required | Directory/file paths to scan |
| `filePattern` | string\|array | `"*.*"` | Glob pattern(s) to match filenames |
| `notPath` (alias: `excludePatterns`) | array | `[]` | Exclude files whose path matches these strings |
| `path` | string\|array | `[]` | Only include files whose path contains these strings |
| `contains` | string\|array | `[]` | Only include files containing this content |
| `notContains` | string\|array | `[]` | Exclude files containing this content |
| `size` | string\|array | `[]` | Size filter, e.g. `"> 1K"`, `"< 50K"` |
| `date` | string\|array | `[]` | Date filter, e.g. `"since yesterday"`, `"> 2023-01-01"` |
| `maxFiles` | integer | `0` | Cap matched files (0 = no limit) |
| `ignoreUnreadableDirs` | boolean | `false` | Skip permission-blocked directories |
| `treeView` | boolean\|object | `true` | Tree view toggle or config object (see below) |
| `modifiers` | array | `[]` | Source-level content modifiers |
| `tags` | array | `[]` | Arbitrary labels |

> **Note:** `showTreeView` is a deprecated alias for `treeView`. Prefer `treeView`.

#### Filtering details

**Size operators:** `>`, `>=`, `<`, `<=` with `k`/`ki` (kilobytes), `m`/`mi` (megabytes),
`g`/`gi` (gigabytes) suffixes.

**Date operators:** `>` (after), `<` (before), `>=`, `<=`, `==`. Aliases: `since` → `>`,
`until` / `before` → `<`. Relative keywords: `yesterday`, `last week`, `2 days ago`.

**Array values use OR logic** — include if any match / exclude if any match.

#### `treeView` configuration

```yaml
treeView: false   # disable entirely

treeView:
  enabled: true
  showSize: true           # include file/directory sizes
  showLastModified: true   # include last modified dates
  showCharCount: true      # include character counts
  includeFiles: true       # false = directories only
  maxDepth: 3              # 0 = unlimited
  dirContext:
    "src/controllers": "HTTP request handlers"
    "src/models": "Domain entities"
```

---

### 5.2 `tree` Source

Generates a directory structure visualization without including file contents. Ideal for
architectural overviews.

```yaml
- type: tree
  description: "Project structure"
  sourcePaths:
    - src
  filePattern: "*"
  notPath:
    - node_modules
    - dist
  maxDepth: 3
  includeFiles: true
  showSize: true
  showLastModified: false
  showCharCount: false
  dirContext:
    src/utils: "Shared utility functions"
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sourcePaths` | string\|array | required | Root path(s) to generate the tree from |
| `filePattern` | string\|array | `"*"` | Glob pattern(s) to match |
| `notPath` | array | `[]` | Path patterns to exclude |
| `path` | string\|array | `[]` | Include only specific paths |
| `maxDepth` | integer | `0` | Max depth (0 = unlimited) |
| `includeFiles` | boolean | `true` | `false` = directories only |
| `showSize` | boolean | `false` | Include file/dir sizes in tree |
| `showLastModified` | boolean | `false` | Include last modified dates |
| `showCharCount` | boolean | `false` | Include character counts |
| `dirContext` | object | `{}` | Inline descriptions for specific directories |

---

### 5.3 `text` Source

Injects literal inline text into the document. Use for headers, instructions, section
separators, and notes.

```yaml
- type: text
  description: "Document header"
  content: |
    # Authentication System

    This document contains all code relevant to user authentication.
  tag: HEADER
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `content` | string | required | The text content to inject. Supports variables. |
| `tag` | string | `"INSTRUCTION"` | Wraps content in `<TAG>…</TAG>` XML-style delimiters in the output |

---

### 5.4 `url` Source

Fetches content from web pages. Supports CSS selector targeting, custom headers, and variable
interpolation in URLs.

```yaml
- type: url
  description: "External API reference"
  urls:
    - https://docs.example.com/api
    - https://api.${ENV_NAME}.example.com/schema
  selector: ".main-content"    # CSS selector (null = full page)
  headers:
    Authorization: "Bearer ${API_TOKEN}"
    Accept-Language: "en-US"
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | array | required | URLs to fetch |
| `selector` | string | `null` | CSS selector to extract specific content |
| `headers` | object | `{}` | HTTP headers (support variable interpolation) |

---

### 5.5 `git_diff` Source

Includes Git diffs to show recent code changes.

```yaml
- type: git_diff
  description: "Recent changes"
  repository: "."           # Default: current directory
  commit: last-week         # Preset or explicit range
  filePattern: "*.ts"
  notPath:
    - tests
    - dist
  render:
    strategy: llm           # "raw" (default) or "llm" (LLM-optimized format)
    showStats: true
    showLineNumbers: false
    contextLines: 3
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repository` | string | `"."` | Path to git repo |
| `commit` | string | `"staged"` | Commit range or preset (see below) |
| `filePattern` | string\|array | `"*.*"` | File filter |
| `notPath` | array | `[]` | Exclude paths |
| `path` | string\|array | `[]` | Only include paths |
| `contains` | string\|array | `[]` | Content filter |
| `notContains` | string\|array | `[]` | Content exclusion filter |
| `render` | object\|string | see below | Diff rendering configuration |

> **Note:** The top-level `showStats` parameter is deprecated. Use `render.showStats` instead.

#### `render` configuration

```yaml
render: llm          # simple form — just the strategy

render:              # full form
  strategy: llm      # "raw" (standard +/- diff) or "llm" (semantic tags, more readable)
  showStats: true    # show per-file stats header
  showLineNumbers: false
  contextLines: 3    # surrounding context lines
```

#### `commit` presets

| Preset | Description |
|--------|-------------|
| `"staged"` | Staged (index) changes (default) |
| `"unstaged"` | Unstaged working tree changes |
| `"last"` | Last commit (HEAD~1..HEAD) |
| `"last-2"` / `"last-3"` / `"last-5"` / `"last-10"` | Last N commits |
| `"today"` | Changes from today |
| `"last-24h"` | Changes in last 24 hours |
| `"yesterday"` | Yesterday's changes |
| `"last-week"` | Changes from last week |
| `"last-2weeks"` | Changes from last 2 weeks |
| `"last-month"` | Changes from last month |
| `"last-quarter"` | Changes from last 3 months |
| `"last-year"` | Changes from last year |
| `"wip"` | Work in progress (HEAD~1..HEAD) |
| `"main-diff"` | Changes since diverging from `main` |
| `"master-diff"` | Changes since diverging from `master` |
| `"develop-diff"` | Changes since diverging from `develop` |
| `"stash"` / `"stash-last"` | Latest stash |
| `"stash-1"` / `"stash-2"` / `"stash-3"` | Nth most recent stash |
| `"stash-all"` | All stashes |
| `"stash-latest-2"` / `"stash-latest-3"` / `"stash-latest-5"` | Latest N stashes |

Custom expressions:

```yaml
commit: "abc1234"           # specific commit hash
commit: "v1.0.0..v2.0.0"   # version-to-version comparison
commit: "since:2024-01-15"  # all changes since a date
commit: "date:2024-01-15"   # changes on a specific date
commit: "HEAD~5..HEAD"      # standard git range syntax
```

---

### 5.6 `github` Source

Fetches files directly from a GitHub repository via the API.

```yaml
- type: github
  description: "Auth library source"
  repository: "owner/repo"        # required: "owner/repo"
  sourcePaths:
    - src/Auth
  branch: main                    # Default: "main"
  filePattern: "*.ts"
  notPath:
    - tests
    - vendor
  path: Controller
  contains: "class Service"
  notContains: "@deprecated"
  showTreeView: true
  githubToken: ${GITHUB_TOKEN}    # Required for private repos
  modifiers:
    - sanitizer
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repository` | string | required | `"owner/repo"` format |
| `sourcePaths` | string\|array | required | Paths within the repo |
| `branch` | string | `"main"` | Branch or tag |
| `filePattern` | string\|array | `"*.*"` | Filename filter |
| `notPath` (alias: `excludePatterns`) | array | `[]` | Excluded paths |
| `path` | string\|array | `[]` | Path inclusion filter |
| `contains` | string\|array | `[]` | Content filter |
| `notContains` | string\|array | `[]` | Content exclusion |
| `showTreeView` | boolean | `true` | Show directory tree |
| `githubToken` | string | `null` | GitHub token (use env var for security) |

> **Tip:** Set `overwrite: false` on the document to avoid re-fetching remote files on every run.

---

### 5.7 Source type quick reference

| Type | Use when you need… |
|------|-------------------|
| `file` | Local codebase files (most common) |
| `tree` | Directory structure overview without file content |
| `text` | Static instructions, headers, or context notes |
| `url` | Web page or remote API documentation |
| `git_diff` | Recent changes / what was modified |
| `github` | Files from a remote GitHub repository |

> **Additional source types** (see docs for full reference): `gitlab` (GitLab repositories),
> `composer` (PHP Composer packages), `mcp` (MCP server resources), `docs` (documentation bundles).

---

## 6. Modifiers

Modifiers transform file content **before** it is written into the output document. They can
be applied at the **source level** or the **document level**.

```yaml
# Simple shorthand
modifiers:
  - sanitizer

# Full form with options
modifiers:
  - name: sanitizer
    options:
      rules:
        - type: keyword
          keywords: [password, secret]
          replacement: "[REDACTED]"
```

---

### 6.1 `sanitizer` Modifier

Removes or redacts sensitive information. Can be applied at source or document level.

#### Keyword removal rule

```yaml
- name: sanitizer
  options:
    rules:
      - type: keyword
        keywords:
          - password
          - secret
          - api_key
        replacement: "[REDACTED]"   # default: "[REMOVED]"
        caseSensitive: false        # default: false
        removeLines: true           # default: true — remove entire line
```

#### Regex replacement rule

```yaml
- name: sanitizer
  options:
    rules:
      - type: regex
        patterns:
          "/access_token\\s*=\\s*['\"]([^'\"]+)['\"]/": "access_token='[REDACTED]'"
        usePatterns:
          - email
          - api-key
          - jwt
          - database-conn
```

**Built-in `usePatterns` aliases:**

| Alias | Matches |
|-------|---------|
| `credit-card` | Credit card numbers |
| `email` | Email addresses |
| `api-key` | API keys and tokens |
| `ip-address` | IP addresses |
| `jwt` | JWT tokens |
| `phone-number` | Phone numbers |
| `password-field` | Password fields in code |
| `url` | URLs |
| `social-security` | Social security numbers |
| `aws-key` | AWS access keys |
| `private-key` | Private key headers |
| `database-conn` | Database connection strings |

#### Comment insertion rule

```yaml
- name: sanitizer
  options:
    rules:
      - type: comment
        fileHeaderComment: "This file has been sanitized."
```

---

### 6.2 PHP-Specific Modifiers

These modifiers transform PHP source files. They are **only relevant for PHP codebases**.
For TypeScript/JavaScript projects, use `sanitizer` or natural content filtering instead.

**`php-signature`** — Strips method bodies, leaving only class structure and method signatures.
Reduces context size by 70–90% while preserving API shape. Use for large PHP codebases.

**`php-content-filter`** — Selectively includes or excludes class members by visibility or other
criteria.

```yaml
modifiers:
  - name: php-content-filter
    options:
      keep_doc_comments: false
      keep_method_bodies: false
```

**`php-docs`** — Converts PHP classes into structured Markdown documentation using docblocks.

---

### 6.3 Modifier Aliases (Reusable Named Modifiers)

Define named modifier configurations once in `settings.modifiers`, then reference by alias.

```yaml
settings:
  modifiers:
    api-surface:
      name: php-content-filter
      options:
        keep_doc_comments: false
        keep_method_bodies: false
    strip-secrets:
      name: sanitizer
      options:
        rules:
          - type: keyword
            keywords: [password, secret, token]
            replacement: "[REDACTED]"

documents:
  - description: "Clean API"
    outputPath: docs/api.md
    sources:
      - type: file
        sourcePaths: [src/Api]
        modifiers:
          - api-surface
          - strip-secrets
```

---

### 6.4 Document-Level Modifiers

Modifiers declared on the `document` entry (not on a `source`) are applied to **all compatible
sources** within that document. This avoids repeating the same modifier on every source.

```yaml
documents:
  - description: "Sanitized Project Overview"
    outputPath: ".context/secure.md"
    modifiers:                     # ← document-level: applies to all sources
      - name: sanitizer
        options:
          rules:
            - type: usePatterns
              usePatterns: [api-key, jwt]
    sources:
      - type: file
        sourcePaths: [src]
        filePattern: "*.ts"
        modifiers:                 # ← source-level: applied first, then document modifiers
          - php-signature
      - type: file
        sourcePaths: [config]
        filePattern: "*.json"
```

**Processing order:** Source-level modifiers run first, then document-level modifiers.

---

## 7. Variables

Variables allow dynamic values across the config. Both syntax forms are equivalent and can
be mixed:

- `{{variable_name}}` — Mustache-style
- `${VARIABLE_NAME}` — Shell-style

### Defining custom variables

```yaml
variables:
  version: 2.1.0
  env: production
  src_dir: src/{{env}}
```

### Variable resolution order (highest → lowest)

1. **Custom variables** (defined in `variables:`)
2. **Environment variables** (from OS or `.env` file loaded via `--env`)
3. **Predefined system variables**

### Built-in predefined variables

**Date and time:**

| Variable | Example |
|----------|---------|
| `${DATETIME}` | `2024-03-22 14:33:00` |
| `${DATE}` | `2024-03-22` |
| `${TIME}` | `14:33:00` |
| `${TIMESTAMP}` | `1711115580` |

**System:**

| Variable | Example |
|----------|---------|
| `${USER}` | `john.doe` |
| `${HOME_DIR}` | `/home/john.doe` |
| `${TEMP_DIR}` | `/tmp` |
| `${OS}` | `Linux`, `Darwin`, `Windows` |
| `${HOSTNAME}` | `dev-machine.local` |
| `${PWD}` | `/home/user/project` |

**Project paths:**

| Variable | Example |
|----------|---------|
| `${ROOT_PATH}` | `/home/user/my-project` |
| `${CONFIG_PATH}` | `/home/user/my-project/context.yaml` |
| `${ENV_PATH}` | `/home/user/my-project/.env.local` |
| `${BINARY_PATH}` | `/usr/local/bin/ctx` |

### Using variables

Variables work in: `description`, `outputPath`, `content`, `sourcePaths`, `urls`, `headers`,
and `import` paths.

```yaml
variables:
  version: "2.1.0"
  src_dir: "src"

documents:
  - description: "Project v{{version}} — Generated on ${DATE}"
    outputPath: "docs/{{version}}/overview.md"
    sources:
      - type: file
        sourcePaths:
          - "{{src_dir}}/controllers"
          - "${ROOT_PATH}/{{src_dir}}/models"
        filePattern: "*.ts"

      - type: text
        content: |
          # Project v{{version}}
          Environment: {{env}}
          Generated by: ${USER} on ${DATETIME}
```

### Loading `.env` files

```bash
ctx --env             # load default .env
ctx --env=.env.local  # load specific env file
```

---

## 8. Configuration Imports

Split large configs across multiple files. Imports are resolved before the main config and
merged. Nested imports are supported; circular imports are detected and blocked.

```yaml
import:
  # Simple local import
  - path: services/api/context.yaml

  # With path prefix (prepended to all source paths in the imported file)
  - path: modules/auth/context.yaml
    pathPrefix: /auth

  # Wildcard: import all context.yaml files from service directories
  - path: "services/*/context.yaml"

  # Selective: only import specific documents
  - path: services/common/context.yaml
    docs:
      - "docs/shared/*.md"

  # Remote URL import
  - type: url
    url: https://example.com/shared-config.json
    ttl: 600          # cache TTL in seconds (default: 300)
    headers:
      Authorization: "Bearer {{TOKEN}}"
```

### Import formats

| Format | Example |
|--------|---------|
| String shorthand | `- "services/api/context.yaml"` |
| Object with path | `- path: services/api/context.yaml` |
| With path prefix | `- path: …; pathPrefix: /api` |
| Wildcard | `- path: "**/module-context.yaml"` |
| Selective docs | `- path: …; docs: ["api/*.md"]` |
| Remote URL | `- type: url; url: https://…` |

Wildcard patterns: `*` (no dir separator), `**` (any path), `?` (single char), `[abc]`,
`{a,b,c}`.

### Import resolution rules

1. All imports are processed **before** the main `documents` are processed.
2. Imports can be nested (imported files can import other files).
3. Path prefixes apply to document `outputPath` values and source `sourcePaths` values.
4. Absolute paths (starting with `/`) are not modified by `pathPrefix`.
5. Variables from the importing file are available in imported files.

---

## 9. Best Practices

- **Always add a `text` source first** to give the LLM context about what it's reading and why.
- **Use `notPath: [vendor, tests, node_modules, dist]`** on `file` sources to avoid noise.
- **One document, one purpose.** LLMs perform better with focused, targeted context.
- **Use `tree` + `file` together** — a `tree` source for structural orientation, followed by
  `file` sources for actual content.
- **Prefer `treeView` over `showTreeView`** — `showTreeView` is deprecated.
- **Set `overwrite: false`** when sourcing from `github` or `url` to avoid redundant network
  requests after the first generation.
- **Use `text` sources as document headers.** A `text` source at the top of each document's
  source list is the correct way to explain what follows to the LLM.
- **Disable `treeView`** (`treeView: false`) for sources where file content alone is sufficient.
  Tree views add useful context but also bulk.
- **Use `git_diff` with `render: llm`** for change-focused tasks like code review or PR summaries.
- **Add `$schema` to every config file** (including imported sub-configs) to get IDE
  autocompletion and validation.
- **Run `ctx display`** to preview the resolved configuration without generating any files.
- **Apply `sanitizer` at document level** for any source that might include config files, `.env`
  examples, or other potentially sensitive content.
- **Exclude noise aggressively** — always exclude `node_modules`, `dist`, `.git`, generated
  files, and test fixtures unless specifically required.
- **Use modifier aliases** in `settings.modifiers` to avoid repeating complex modifier configs.

---

## 10. Decision Guide

**"What do I want the LLM to understand?"**

| Goal | Approach |
|------|----------|
| Full file contents | `file` source, no modifiers |
| Just the API surface (PHP) | `file` + `php-signature` modifier |
| Directory structure only | `tree` source |
| What changed recently | `git_diff` source |
| External library or dependency | `github` source |
| Documentation from a website | `url` source |
| Custom instructions or framing | `text` source |

**"How do I reduce token usage?"**

- Use `php-signature` to strip PHP method bodies
- Use `treeView` instead of full file contents for orientation
- Combine `contains`, `notContains`, `path`, `size`, `date` filters aggressively
- Set `maxFiles` to cap large directories
- Use `maxDepth` in `tree` sources

**"How do I protect sensitive data?"**

- Apply `sanitizer` at the document level (covers all sources)
- Use `keyword` rules for known sensitive field names
- Use `usePatterns` for common secrets (`jwt`, `api-key`, `database-conn`, etc.)

**"How do I keep the config maintainable?"**

- Define reusable modifiers as aliases in `settings.modifiers`
- Use `variables` for paths, versions, and environments
- Split large configs using `import` with wildcard paths

---

## 11. Worked Examples

### Example A: Feature development context

```yaml
$schema: https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

documents:
  - description: "User Authentication System"
    outputPath: .context/auth.md
    sources:
      - type: text
        description: "Instructions for the LLM"
        content: |
          # Auth System Context
          The following files implement the authentication subsystem.
        tag: INSTRUCTIONS

      - type: tree
        description: "Auth directory structure"
        sourcePaths: [src/Auth]
        maxDepth: 3

      - type: file
        description: "Auth source files"
        sourcePaths:
          - src/Auth
          - src/Models
        filePattern: "*.ts"
        notPath: [tests, vendor]
        notContains: "@deprecated"
        treeView: false

      - type: git_diff
        description: "Recent auth changes"
        commit: last-week
        path: src/Auth
        render:
          strategy: llm
          showStats: true
```

---

### Example B: Project architecture overview

```yaml
documents:
  - description: "Project Architecture Overview"
    outputPath: .context/architecture.md
    sources:
      - type: tree
        description: "Top-level structure"
        sourcePaths: [src]
        maxDepth: 2
        showSize: true
        dirContext:
          src/controllers: "HTTP request handlers"
          src/services: "Business logic layer"
          src/models: "Data models"

      - type: file
        description: "Public interfaces"
        sourcePaths: [src]
        filePattern: "*.interface.ts"
        treeView: false
```

---

### Example C: Sanitized API documentation

```yaml
$schema: https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

settings:
  modifiers:
    public-api:
      name: php-content-filter
      options:
        keep_method_bodies: false
    redact-secrets:
      name: sanitizer
      options:
        rules:
          - type: keyword
            keywords: [password, secret, token, key]
            replacement: "[REDACTED]"
          - type: regex
            usePatterns: [email, api-key, jwt, database-conn]

documents:
  - description: "Public API Documentation"
    outputPath: docs/api.md
    modifiers:
      - redact-secrets
    sources:
      - type: file
        description: "API controllers"
        sourcePaths: [src/Api/Controllers]
        filePattern: "*.php"
        contains: "@Route"
        notContains: "@internal"
        modifiers:
          - public-api

      - type: github
        description: "Shared auth library"
        repository: "my-org/auth-lib"
        sourcePaths: [src]
        branch: main
        filePattern: "*.php"
        githubToken: ${GITHUB_TOKEN}
        modifiers:
          - php-signature
```

---

### Example D: Multi-environment config with variables and imports

```yaml
$schema: https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

variables:
  env: ${APP_ENV}       # loaded from environment
  version: 2.1.0
  src: src

import:
  - path: "**/module-context.yaml"

documents:
  - description: "{{env}} Environment Overview"
    outputPath: "docs/{{env}}/overview.md"
    sources:
      - type: text
        content: |
          # {{env}} Environment — v{{version}}
          Generated: ${DATETIME} by ${USER}

      - type: file
        sourcePaths:
          - "{{src}}/core"
        filePattern: "*.ts"
        notPath: [tests, dist]
        treeView:
          enabled: true
          showSize: true
          maxDepth: 3
```

---

### Example E: Complete multi-document workspace context

```yaml
$schema: https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json

variables:
  src: "src"
  output_dir: ".context"

import:
  - path: "**/module-context.yaml"

documents:
  # ── Project structure overview ───────────────────────────────────────────────
  - description: "Project Overview"
    outputPath: "{{output_dir}}/overview.md"
    sources:
      - type: text
        content: |
          # Project Overview
          This document provides a structural overview for LLM agents.
        tag: HEADER

      - type: tree
        sourcePaths: [.]
        maxDepth: 3
        notPath: [node_modules, dist, .git, coverage]
        includeFiles: false

      - type: file
        sourcePaths: [.]
        filePattern: "package.json"
        treeView: false

  # ── Core source code ──────────────────────────────────────────────────────────
  - description: "Core Source Code"
    outputPath: "{{output_dir}}/source-core.md"
    sources:
      - type: tree
        sourcePaths: ["{{src}}"]
        notPath: [tests, fixtures]
        maxDepth: 4
        showSize: true

      - type: file
        sourcePaths: ["{{src}}"]
        filePattern: "*.ts"
        notPath: [tests, __tests__, fixtures]
        notContains: "@deprecated"
        treeView: false

  # ── Test suite overview ───────────────────────────────────────────────────────
  - description: "Test Suite"
    outputPath: "{{output_dir}}/tests.md"
    sources:
      - type: tree
        sourcePaths: [tests]
        maxDepth: 3

  # ── Recent changes ────────────────────────────────────────────────────────────
  - description: "Recent Git Changes"
    outputPath: "{{output_dir}}/recent-changes.md"
    sources:
      - type: git_diff
        commit: "last-2weeks"
        filePattern: ["*.ts", "*.json", "*.yaml"]
        notPath: [node_modules, dist, package-lock.json]
        render:
          strategy: llm
          showStats: true
```

---

## 12. Quick Reference Tables

### Source type selector

| Use Case | Source Type | Key Fields |
|----------|-------------|------------|
| Include local source files | `file` | `sourcePaths`, `filePattern`, `notPath` |
| Directory overview only | `tree` | `sourcePaths`, `maxDepth`, `includeFiles: false` |
| Section header / instructions | `text` | `content`, `tag` |
| Fetch web documentation | `url` | `urls`, `selector`, `headers` |
| Show recent code changes | `git_diff` | `commit`, `render.strategy` |
| Files from a GitHub repo | `github` | `repository`, `sourcePaths`, `githubToken` |

### Modifier selector

| Modifier | When to Use |
|----------|-------------|
| `sanitizer` (keyword) | Redact hardcoded secrets, passwords, internal keys |
| `sanitizer` (regex + `usePatterns`) | Redact emails, JWTs, API keys using named patterns |
| `php-signature` | PHP only — strip method bodies, keep signatures |
| `php-content-filter` | PHP only — include/exclude class members by visibility |
| `php-docs` | PHP only — convert classes to Markdown documentation |

### Common `notPath` patterns

```yaml
notPath:
  - node_modules
  - dist
  - .git
  - coverage
  - __pycache__
  - .venv
  - vendor
  - fixtures
```

---

*Official documentation: [docs.ctxllm.com](https://docs.ctxllm.com/)*
*JSON Schema: [json-schema.json](https://raw.githubusercontent.com/context-hub/generator/refs/heads/main/json-schema.json)*
*GitHub: [context-hub/generator](https://github.com/context-hub/generator)*
*Last reviewed: May 2026*
