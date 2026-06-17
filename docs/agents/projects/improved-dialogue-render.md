# Project: Improved Dialogue Rendering

## Description

I would like to improve & simplify the orchestrator's dialogue rendering to make it a bit more natural to read, akin to how it is rendered in IDE chat interfaces. The aim is to be able to read the agent's though processed to identify potential issues after the fact.

## Tool Results

Tool results are overly verbose and can be, barring exceptions, be hidden entirely. 

## Rendering Philosophy

The idea is to keep only conversation and relevant tool calls to folow the agent's progress.

## Things To Keep

See the [Full Event Shapes](#full-event-shapes) section for complete JSON shapes with render suggestions.

All tool calls start with `Tool call: \`tool_name\`` — unknown tools are always visible. Details follow on the next line where useful.

In summary:
- **Display texts** — narrative text the agent writes between tool calls
- **`edit_file`** — `Tool call: \`edit_file\`` + file path
- **`write_file`** — `Tool call: \`write_file\`` + file path
- **`read_file`** — `Tool call: \`read_file\`` + file path
- **`execute`** — `Tool call: \`execute\`` + command + result (test output is valuable)
- **`write_todos`** — `Tool call: \`write_todos\`` + compact checklist
- **`task`** — `Tool call: \`task\`` + sub-agent type + collapsed result
- **`glob` / `grep` / `ls`** — `Tool call: \`glob\`` — no further detail
- **`ledger_*` tools** — `Tool call: \`ledger_begin_work\`` + contextual summary; see [Ledger Tools](#ledger-tools)

---

## Streaming Architecture

All AI output — both narrative text and tool call inputs — is delivered as a stream of
small chunks (`AIMessageChunk` entries in the JSONL). A renderer must reassemble these
chunks before displaying them. Each chunk carries a `msg.id` (the run ID) and a content
`index` to group related pieces.

**Top-level chunk wrapper:**
```json
{
  "ns": ["developer:ee8ed20a-4a46-f14a-2e7c-875050e74bd1"],
  "msg": {
    "type": "AIMessageChunk | tool",
    "id": "lc_run--019ea6f9-...",
    "content": [ "…content items…" ]
  }
}
```

Content item types inside `AIMessageChunk`:

| `type`             | Purpose |
|--------------------|---------|
| `text`             | Streamed narrative fragment — reassemble by `index` per `msg.id` |
| `tool_use`         | Initiates a tool call — `input` is always `{}` here |
| `input_json_delta` | Streams the tool's JSON input — reassemble `partial_json` by `index` per `msg.id` |

Tool results arrive as a separate `type: "tool"` message.

---

## Full Event Shapes

### Display Texts (reassembled)

Text content is streamed as individual fragments. Each fragment:

```json
{
  "text": "Now I have enough context. Let me implement the two files:",
  "type": "text",
  "index": 0
}
```

Consecutive fragments with the same `index` within a single `msg.id` form one paragraph.

#### Render Suggestion

```
Now I have enough context. Let me implement the two files:
```

---

### Edit File

Tool call input (reassembled from `input_json_delta` fragments):

```json
{
  "id": "toolu_01UpKW97ImmtgKoXWnfGuXQE",
  "name": "edit_file",
  "input": {
    "file_path": "/path/to/ComtypeAPITrait.php",
    "old_string": "use Maileditor\\Comtypes\\Collection\\ComtypeRecord;",
    "new_string": "use ClassFactory;\nuse Maileditor\\Comtypes\\Collection\\ComtypeRecord;"
  },
  "type": "tool_use"
}
```

Tool result:
```json
{
  "content": "Successfully replaced 1 instance(s) of the string in '/path/to/ComtypeAPITrait.php'",
  "type": "tool",
  "name": "edit_file",
  "status": "success"
}
```

#### Render Suggestion

```markdown
Tool call: `edit_file`
↳ [ComtypeAPITrait.php](/path/to/ComtypeAPITrait.php)
```

---

### Write File

Tool call input:

```json
{
  "id": "toolu_014T7gF62TkezHsWHkkm8gDN",
  "name": "write_file",
  "input": {
    "file_path": "/path/to/modules/comboSelect.js",
    "content": "/**\n * Layout Editor GUI — ComboSelect Widget Module\n * …"
  },
  "type": "tool_use"
}
```

Tool result:
```json
{
  "content": "Updated file /path/to/modules/comboSelect.js",
  "type": "tool",
  "name": "write_file",
  "status": "success"
}
```

#### Render Suggestion

```markdown
Tool call: `write_file`
↳ [comboSelect.js](/path/to/modules/comboSelect.js)
```

---

### Read File

Tool call input:

```json
{
  "id": "toolu_01JT5btyxYpjSxKzDwxy5Kgy",
  "name": "read_file",
  "input": {
    "file_path": "/path/to/work/WP-001.md"
  },
  "type": "tool_use"
}
```

#### Render Suggestion

```markdown
Tool call: `read_file`
↳ [WP-001.md](/path/to/work/WP-001.md)
```

---

### Execute

Tool call input:

```json
{
  "id": "toolu_01NAWtsTkCfh7PLoR6JZrqLm",
  "name": "execute",
  "input": {
    "command": "cd /path/to/project && php vendor/bin/phpunit tests/…Test.php --no-coverage 2>&1",
    "timeout": 120
  },
  "type": "tool_use"
}
```

Tool result:
```json
{
  "content": "PHPUnit 13.1.12 by Sebastian Bergmann and contributors.\n\n.....\n\nOK (5 tests, 59 assertions)\n\n[Command succeeded with exit code 0]",
  "type": "tool",
  "name": "execute",
  "status": "success"
}
```

Execute results are arguably the most valuable to show — they contain test runner output,
linting results, and other verification feedback. Unlike other tool results, these should
not be hidden.

#### Render Suggestion

Show the command (abbreviated) and the last meaningful output line:

```markdown
Tool call: `execute`
↳ `php vendor/bin/phpunit tests/…Test.php`
↳ OK (5 tests, 59 assertions) ✓
```

For failures, show the full output block (collapsible in the UI, with controls to expand to full size).

---

### Write Todos

Tool call input:

```json
{
  "id": "toolu_015tgR6JoVxK5FAM1wr9xABm",
  "name": "write_todos",
  "input": {
    "todos": [
      { "content": "Write comboSelect.js module", "status": "in_progress" },
      { "content": "Append ComboSelect CSS styles", "status": "pending" },
      { "content": "Verify implementation", "status": "pending" },
      { "content": "Complete pipeline in ledger", "status": "pending" }
    ]
  },
  "type": "tool_use"
}
```

#### Render Suggestion

Render as a compact checklist to show what the agent has planned:

```markdown
Tool call: `write_todos`
- [x] Write comboSelect.js module _(in progress)_
- [ ] Append ComboSelect CSS styles
- [ ] Verify implementation
- [ ] Complete pipeline in ledger
```

---

### Task (Sub-agent Dispatch)

Tool call input:

```json
{
  "id": "toolu_01VjrxovreV7nLcN1Jk8A1zC",
  "name": "task",
  "input": {
    "subagent_type": "ctx-architect",
    "description": "CTX Architect v1.2.0\n\n## Context\n\nThe project is the **Application Framework** …"
  },
  "type": "tool_use"
}
```

Tool result:
```json
{
  "content": "Clean run. Here is the full summary:\n\n---\n\n## Summary\n\n…",
  "type": "tool",
  "name": "task",
  "status": "success"
}
```

#### Render Suggestion

Show the sub-agent type and a collapsed view of its response:

```markdown
Tool call: `task`
↳ Sub-agent: **ctx-architect**
↳ Clean run. (expand for details)
```

---

## Minimal Display (No Details)

The following shell-style tools should be shown with just the tool name — no inputs or results:

| Tool | Render as |
|------|-----------|
| `glob` | `Tool call: \`glob\`` |
| `grep` | `Tool call: \`grep\`` |
| `ls` | `Tool call: \`ls\`` |

---

## Ledger Tools

Ledger tools are the workflow backbone — they show the agent's progress through work
packages and pipeline stages. Show them with a small amount of context so the reader
can follow the workflow without reading raw JSON.

### Workflow & pipeline tools

These carry the most signal — always show detail:

| Tool | Relevant inputs | Detail line |
|------|----------------|-------------|
| `ledger_begin_work` | `work_package_id`, `type`, `agent_role` | `↳ WP-001 — implementation (Developer)` |
| `ledger_start_pipeline` | `work_package_id`, `type`, `agent_role` | `↳ WP-001 — documentation (Documentation)` |
| `ledger_complete_pipeline` | `work_package_id`, `type`, `status`, first `summary` item | `↳ WP-001 implementation → PASS` + first summary bullet |
| `ledger_cancel_pipeline` | `work_package_id`, `type`, `reason` | `↳ WP-001 implementation — {reason}` |
| `ledger_claim_work_package` | `work_package_id`, `agent` | `↳ WP-001 → Developer` |

**`ledger_complete_pipeline` example:**

Tool call input:
```json
{
  "name": "ledger_complete_pipeline",
  "input": {
    "work_package_id": "WP-001",
    "type": "implementation",
    "status": "PASS",
    "agent_role": "Developer",
    "summary": [
      "Added two public static methods to ComtypeAPITrait: buildSendingModesResponse() and buildSendingModeData().",
      "Added use statements for ClassFactory and BaseSendingMode."
    ]
  }
}
```

Render:
```markdown
Tool call: `ledger_complete_pipeline`
↳ WP-001 implementation → **PASS**
↳ Added two public static methods to ComtypeAPITrait: buildSendingModesResponse() and buildSendingModeData().
```

---

### Status & update tools

Show which WP is affected and the key change:

| Tool | Relevant inputs | Detail line |
|------|----------------|-------------|
| `ledger_update_work_package_status` | `work_package_id`, `status` | `↳ WP-001 → COMPLETE` |
| `ledger_update_pipeline_progress` | `work_package_id`, `type`, first `summary` item | `↳ WP-001 qa — {first summary item}` |
| `ledger_update_acceptance_criteria` | `work_package_id`, count of `operations` | `↳ WP-001 (3 operations)` |
| `ledger_add_project_comment` | `type`, `priority`, first line of `note` | `↳ note (high): {first line of note}` |

---

### Read & query tools

These are informational — show the subject but no result detail:

| Tool | Relevant inputs | Detail line |
|------|----------------|-------------|
| `ledger_get_next_action` | `agent_role` | `↳ Developer` |
| `ledger_get_work_package` | `work_package_id` | `↳ WP-001` |
| `ledger_get_handoff_status` | `current_agent` | `↳ Developer` |
| `ledger_get_project_status` | — | _(no detail)_ |
| `ledger_list_work_packages` | — | _(no detail)_ |
| `ledger_search_insights` | `query` | `↳ "ComboSelect widget QA testing"` |
| `ledger_help` | — | _(no detail)_ |

