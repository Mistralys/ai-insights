# Pipeline Routing

> Part of the [Agent Workflow Specification](README.md).

---

## 8. Pipeline Ordering & Prerequisites

Pipelines within a work package must follow a strict order:

```
implementation → qa → code-review → documentation
```

### 8.1 Prerequisites Map

| Pipeline Type | Prerequisite |
|--------------|-------------|
| `implementation` | None (can always start) |
| `qa` | Most recent `implementation` pipeline must be PASS |
| `code-review` | Most recent `qa` pipeline must be PASS |
| `documentation` | Most recent `code-review` pipeline must be PASS |

### 8.2 Prerequisite Check Algorithm

```
function canStartPipeline(wp, pipelineType):
  prerequisite = PIPELINE_PREREQUISITES[pipelineType]
  if prerequisite is null:
    return true
  
  prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)
  if prereqPipelines is empty:
    return false
  
  mostRecent = prereqPipelines.last()
  return mostRecent.status == "PASS"
```

> **Note:** This check validates that the prerequisite is PASS but does not verify temporal ordering. The full re-validation guard (ensuring the prerequisite PASSed *after* the most recent run of the current pipeline type) is enforced in `startPipeline` (see [§11.1](operations.md#111-algorithm)).

### 8.3 Duplicate Prevention

Only one pipeline of a given type can be IN_PROGRESS at a time per work package.

```
function hasDuplicateInProgress(wp, pipelineType):
  return wp.pipelines.any(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
```

### 8.4 Downstream Types

Returns all pipeline types that follow a given type in the pipeline ordering (§8.1).

```
function getDownstreamTypes(pipelineType):
  ordering = ["implementation", "qa", "code-review", "documentation"]
  index = ordering.indexOf(pipelineType)
  if index == -1 OR index == ordering.length - 1:
    return []
  return ordering.slice(index + 1)
```

| Input | Output |
|-------|--------|
| `implementation` | `["qa", "code-review", "documentation"]` |
| `qa` | `["code-review", "documentation"]` |
| `code-review` | `["documentation"]` |
| `documentation` | `[]` |

> Used by `hasDownstreamFail` ([§11.3](operations.md#113-downstream-fail-detection)) and the re-validation guard ([§11.1](operations.md#111-algorithm)).

### 8.5 Upstream Types

Returns all pipeline types that precede a given type in the pipeline ordering (§8.1). Counterpart of `getDownstreamTypes` (§8.4).

```
function getUpstreamTypes(pipelineType):
  ordering = ["implementation", "qa", "code-review", "documentation"]
  index = ordering.indexOf(pipelineType)
  if index <= 0:
    return []
  return ordering.slice(0, index)
```

| Input | Output |
|-------|--------|
| `implementation` | `[]` |
| `qa` | `["implementation"]` |
| `code-review` | `["implementation", "qa"]` |
| `documentation` | `["implementation", "qa", "code-review"]` |

> Used by the re-validation guard's upstream activity check ([§11.1](operations.md#111-algorithm)) to distinguish stale prerequisites from self-rework scenarios.

---

## 9. Pipeline Routing Maps

Three maps control how agents are assigned and how failures/successes are routed.

### 9.1 PIPELINE_AGENT_MAP

Maps pipeline type to the agent that owns it. Used to auto-update `assigned_to` when a pipeline starts.

| Pipeline Type | Agent |
|--------------|-------|
| `implementation` | Developer |
| `qa` | QA |
| `code-review` | Reviewer |
| `documentation` | Documentation |

### 9.2 NEXT_AGENT_MAP

Maps pipeline type to the next agent in the success path. Used for handoff notes on PASS.

| Pipeline Type | Next Agent (on PASS) |
|--------------|---------------------|
| `implementation` | QA |
| `qa` | Reviewer |
| `code-review` | Documentation |
| `documentation` | Synthesis |

### 9.3 FAIL_ROUTING_MAP

Maps pipeline type to the agent responsible for fixing failures. Used for handoff notes on FAIL.

| Pipeline Type | Rework Agent (on FAIL) |
|--------------|------------------------|
| `implementation` | Developer (self-rework) |
| `qa` | Developer |
| `code-review` | Developer |
| `documentation` | Documentation (self-rework) |

> Key insight: Documentation is the only pipeline type with self-rework on FAIL. All other FAIL paths route back to the Developer.
>
> **Escalation path:** If a documentation pipeline FAIL is caused by underlying code issues (not documentation quality), the Documentation agent should set the WP to BLOCKED with a `technical` blocker describing the code issue. This surfaces the problem to the Project Manager (via §14.1.2 UNBLOCK_WP), who can coordinate with the Developer. The `FAIL_ROUTING_MAP` deliberately does not route documentation failures to Developer because most documentation issues are self-correctable; the blocker mechanism handles the exceptional case.

### 9.4 AGENT_PIPELINE_MAP (Inverse)

Maps agent role to the pipeline type it owns. Derived from PIPELINE_AGENT_MAP by inversion. This is a convenience lookup for implementations — no algorithm in this specification references it by name, but it is useful for dynamically resolving an agent's pipeline type (e.g., when determining which pipeline to check in `getNextAction`).

| Agent | Pipeline Type |
|-------|--------------|
| Developer | `implementation` |
| QA | `qa` |
| Reviewer | `code-review` |
| Documentation | `documentation` |
