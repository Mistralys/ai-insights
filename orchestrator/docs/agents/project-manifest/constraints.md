# Constraints & Conventions

This document codifies established rules, conventions, and non-obvious gotchas for the **AI Insights Orchestrator**.

### Constraint Entry Format

New constraint entries should follow this structure:

| Section | Content |
|---------|---------|
| **Rule** | The specific, actionable rule — include forbidden alternatives inline. |
| **Rationale** | Why the rule exists. One or two sentences. |
| **Anti-pattern** (if applicable) | A concrete ❌ code example showing the wrong approach. |
| **Correct pattern** (if applicable) | A concrete ✅ code example showing the right approach. |
| **Forbidden patterns** (if applicable) | A prose or list summary of every variant that must NOT be used. |

---

## Prompt Architecture Constraints

### 1. Persona Files Are the Source of Truth for Agent Behaviour

**Rule:** All identity declarations, workflow step enumerations, and MCP tool-call instructions live exclusively in persona system prompts (`personas/ledger/claude-code/`). User-turn prompts in `_build_*_prompt()` functions must contain only runtime context that the persona file cannot know: concrete `project_path`, `wp_id`, and plan content. All prompt builders delegate to the centralized :func:`build_stage_prompt` in `src/nodes/__init__.py`. Any change to agent behaviour must be made in the persona source files, **not** in prompt builder functions.

**Rationale:** Splitting identity from runtime context keeps persona files reviewable, versionable, and reusable across different orchestration surfaces without coupling them to Python implementation details.

**Anti-pattern:**
```python
# ❌ WRONG — workflow instructions embedded in the user-turn prompt
def _build_developer_prompt(project_path: str, wp_id: str) -> str:
    return f"""
    CRITICAL — EVERY MCP TOOL CALL MUST include `project_path='{project_path}'`.

    Your workflow:
    1. Call ledger_get_next_action with agent_role: "Developer"
    2. Read the WP spec
    3. Implement the changes
    ...
    """
```

**Correct pattern:**
```python
# ✅ CORRECT — delegate to the centralized helper
from . import build_stage_prompt

def _build_developer_prompt(state: WorkflowState) -> str:
    return build_stage_prompt(
        state["project_path"],
        wp_id=state.get("current_wp_id", ""),
    )
```

---

### 2. The `project_path` Reminder Is Permanent

**Rule:** The user-turn prompt must always include a reminder to use the specified `project_path` for all ledger tool calls. The reminder text is defined once in `build_stage_prompt()` (`src/nodes/__init__.py`) and must never be removed. Persona Markdown files are static and cannot contain runtime values, so this runtime reminder lives in the user-turn prompt.

**Rationale:** Without the reminder the agent may omit `project_path` from MCP tool calls, causing every ledger operation to fail.

---

### 3. Prompt Templates Are Structurally Uniform Within Their Category

**Rule:** The six WP-scoped prompt builder functions (`_build_developer_prompt`, `_build_qa_prompt`, `_build_security_auditor_prompt`, `_build_reviewer_prompt`, `_build_release_engineer_prompt`, `_build_docs_prompt`) must all delegate to the centralized `build_stage_prompt()` helper in `src/nodes/__init__.py`. Any change to the minimal prompt pattern must be applied in that single helper. The PM and synthesis templates are documented exceptions with justified divergences (PM adds plan content via the `preamble`/`extra` parameters; synthesis omits `wp_id`).

**Rationale:** Structural uniformity makes the prompt layer auditable at a glance and prevents silent divergence between nodes that should behave identically.

---

## Supervisor & Routing Constraints

### 4. No LLM Calls in the Supervisor

**Rule:** The supervisor node must not make LLM calls. All routing decisions must come from the MCP server's `ledger_get_next_action` tool. The supervisor is a pure-Python router.

**Rationale:** LLM-based routing introduces non-determinism into an otherwise deterministic pipeline. Delegating routing to the ledger tools ensures the supervisor's behaviour is fully specified by the workflow manifest.

---

### 5. Manifest-Derived Constants

**Rule:** `PIPELINE_ROLES`, `PIPELINE_SEQUENCE`, and action→role maps in `src/config.py` must be derived from `shared/workflow-manifest.json` at import time. Never hardcode role names or pipeline ordering as bare string literals.

**Rationale:** The workflow manifest is the canonical source of pipeline ordering and role naming. Hardcoded constants drift silently when the manifest is updated.

---

### 6. Circuit-Breaker Threshold: 3 Consecutive Failures

**Rule:** A work package that accumulates ≥3 consecutive stage failures must be skipped for the remainder of the run. The threshold value must be read from configuration, not hardcoded.

**Rationale:** Without a circuit-breaker a pathologically failing WP will stall the entire orchestration run indefinitely.

---

## Node Implementation Constraints

### 7. Stage Node Isolation

**Rule:** Each stage node must create its own Deep Agent instance per invocation. No state — including LLM client instances, MCP connections, or tool objects — may be shared between stage invocations.

**Rationale:** Shared state between stage invocations introduces subtle coupling that makes failures hard to diagnose and prevents clean retry semantics.

---

### 8. Cross-Platform File Locking

**Rule:** File locking for the JSONL run log must use `msvcrt` on Windows and `fcntl` on Unix. All path construction must use `pathlib.Path`, never bare string concatenation.

**Rationale:** The orchestrator must run in CI environments on both Linux and Windows. Platform-specific locking ensures log integrity without blocking on a missing system call.

---

## LangGraph-Specific Constraints

### 9. LangGraph Config Annotations Require `Optional[RunnableConfig]`

**Rule:** In files that use `from __future__ import annotations`, always annotate LangGraph config parameters as `Optional[RunnableConfig]`, **not** `RunnableConfig | None`.

**Rationale:** `from __future__ import annotations` causes Python to stringify all type hints at parse time. The union syntax `RunnableConfig | None` becomes the string `"RunnableConfig | None"`, which LangGraph's config injection does not recognise. `Optional[RunnableConfig]` produces `"Optional[RunnableConfig]"`, which is in the allowlist.

**Symptom:** `get_run_logger: config is None` warnings; JSONL events only flushed at run end rather than incrementally.

**Anti-pattern:**
```python
# ❌ WRONG — union syntax is stringified to an unrecognised form
from __future__ import annotations
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: RunnableConfig | None = None) -> WorkflowState:
    ...
```

**Correct pattern:**
```python
# ✅ CORRECT — Optional[] form is in LangGraph's annotation allowlist
from __future__ import annotations
from typing import Optional
from langchain_core.runnables import RunnableConfig

async def node(state: WorkflowState, config: Optional[RunnableConfig] = None) -> WorkflowState:
    ...
```

---

## Review & Documentation Conventions

### 10. `documentation-forward` Is the Named Review-to-Documentation Handoff Convention

**Rule:** When a code-review pipeline identifies documentation gaps, the reviewer must record them as structured pipeline comments with type `documentation-forward`. The documentation stage resolves these comments. This is the standard cross-pipeline handoff mechanism for documentation work identified during review.

**Format:** Comment objects in the code-review pipeline result must use:
```json
{
  "type": "documentation-forward",
  "priority": "medium",
  "note": "[documentation-forward] <description of documentation gap and suggested resolution>"
}
```

**Rationale:** Naming the convention enforces a consistent, machine-readable handoff signal between the reviewer and documentation agents, preventing documentation gaps from being silently dropped when the code-review pipeline completes.

**Who resolves it:** The documentation stage agent reads open `documentation-forward` comments from the most recent code-review pipeline and addresses each one before marking the WP complete.

---

## MCP Server Dependency

### 11. MCP Server Must Be Pre-Built

**Rule:** The orchestrator spawns the MCP server as a subprocess. `mcp-server/dist/index.js` must exist before any orchestration run begins. Use `node scripts/run-orchestrator.js` for automatic build-freshness checks rather than launching `orchestrator` directly.

**Rationale:** The orchestrator has no fallback if the MCP server subprocess fails to start — all ledger operations will fail silently or with unhelpful errors.
