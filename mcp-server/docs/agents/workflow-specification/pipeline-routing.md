# Pipeline Routing

> Part of the [Agent Workflow Specification](README.md).

---

## 8. Pipeline Ordering & Prerequisites

Pipelines within a work package follow a **canonical ordering** of six stages. The Project Manager selects which stages are active for each WP at creation time:

```
Canonical:  implementation → qa → security-audit → code-review → release-engineering → documentation
```

The PM may compose **any valid subsequence** of this ordering. Inactive stages are skipped by the dynamic routing functions. For example, the default 4-stage chain:

```
Default:    implementation → qa → code-review → documentation
```

A WP with all six stages active follows the full chain:

```
Full:       implementation → qa → security-audit → code-review → release-engineering → documentation
```

A documentation-only WP has a single stage:

```
Doc-only:   documentation
```

The active stages for a WP are always a **subsequence** of the canonical ordering — stages can be omitted, but never reordered. See [§4.2](data-model.md#42-pipeline-stage-constants) for the constant definitions and common composition patterns.

### 8.1 Prerequisites Map

The **static** prerequisites map defines the canonical prerequisite for each pipeline type — i.e., the immediately preceding stage in the canonical ordering:

| Pipeline Type | Canonical Prerequisite |
|--------------|----------------------|
| `implementation` | None (can always start) |
| `qa` | `implementation` |
| `security-audit` | `qa` |
| `code-review` | `security-audit` |
| `release-engineering` | `code-review` |
| `documentation` | `release-engineering` |

Because inactive stages are skipped, the **effective** prerequisite for a given pipeline type depends on the work package's `active_pipeline_stages`. The `resolvePrerequisite` function dynamically computes the correct prerequisite by walking backward through the canonical ordering until it finds an active predecessor:

#### 8.1.1 Dynamic Prerequisite Resolution

```
function resolvePrerequisite(pipelineType, activeStages):
  // activeStages defaults to DEFAULT_PIPELINE_STAGES when absent/null
  ordering = CANONICAL_PIPELINE_ORDERING
  index = ordering.indexOf(pipelineType)
  
  if index <= 0:
    return null  // implementation has no prerequisite
  
  // Walk backward from the position just before pipelineType
  for i = index - 1 downto 0:
    if ordering[i] in activeStages:
      return ordering[i]
  
  return null  // No active predecessor (should not happen for well-formed activeStages)
```

**Effective prerequisite examples:**

| Pipeline Type | Active Stages (default 4) | Active Stages (all 6) |
|--------------|--------------------------|----------------------|
| `implementation` | None | None |
| `qa` | `implementation` | `implementation` |
| `security-audit` | *(not active)* | `qa` |
| `code-review` | `qa` | `security-audit` |
| `release-engineering` | *(not active)* | `code-review` |
| `documentation` | `code-review` | `release-engineering` |

### 8.2 Prerequisite Check Algorithm

```
function canStartPipeline(wp, pipelineType):
  activeStages = wp.active_pipeline_stages ?? DEFAULT_PIPELINE_STAGES
  prerequisite = resolvePrerequisite(pipelineType, activeStages)
  if prerequisite is null:
    return true
  
  prereqPipelines = wp.pipelines.filter(p => p.type == prerequisite)
  if prereqPipelines is empty:
    return false
  
  mostRecent = prereqPipelines.last()
  return mostRecent.status == "PASS"
```

> **Note:** This check validates that the prerequisite is PASS but does not verify temporal ordering. The full re-validation guard (ensuring the prerequisite PASSed *after* the most recent run of the current pipeline type) is enforced in `startPipeline` (see [§11.1](operations.md#111-algorithm)).
>
> **Implementation note:** `startPipeline` (§11.1) implements the prerequisite check inline rather than delegating to `canStartPipeline`, because it extends the check with additional guards (re-validation, duplicate prevention, active-stage validation) in a single pass. This function is provided as a conceptual reference for the ordering rule; implementations are not required to expose it as a separate callable.

### 8.3 Duplicate Prevention

Only one pipeline of a given type can be IN_PROGRESS at a time per work package.

```
function hasDuplicateInProgress(wp, pipelineType):
  return wp.pipelines.any(p => p.type == pipelineType AND p.status == "IN_PROGRESS")
```

### 8.4 Downstream Types

Returns all pipeline types that follow a given type in the canonical pipeline ordering. When `activeStages` is provided, the result is filtered to only include active stages.

```
function getDownstreamTypes(pipelineType, activeStages?):
  ordering = CANONICAL_PIPELINE_ORDERING
  stages = activeStages ?? ordering
  index = ordering.indexOf(pipelineType)
  if index == -1 OR index == ordering.length - 1:
    return []
  downstream = ordering.slice(index + 1)
  return downstream.filter(t => t in stages)
```

**Examples with default (4 stages):**

| Input | Output |
|-------|--------|
| `implementation` | `["qa", "code-review", "documentation"]` |
| `qa` | `["code-review", "documentation"]` |
| `code-review` | `["documentation"]` |
| `documentation` | `[]` |

**Examples with all 6 stages active:**

| Input | Output |
|-------|--------|
| `implementation` | `["qa", "security-audit", "code-review", "release-engineering", "documentation"]` |
| `qa` | `["security-audit", "code-review", "release-engineering", "documentation"]` |
| `security-audit` | `["code-review", "release-engineering", "documentation"]` |
| `code-review` | `["release-engineering", "documentation"]` |
| `release-engineering` | `["documentation"]` |
| `documentation` | `[]` |

> Used by `hasDownstreamFail` ([§11.3](operations.md#113-downstream-fail-detection)) and the re-validation guard ([§11.1](operations.md#111-algorithm)).

### 8.5 Upstream Types

Returns all pipeline types that precede a given type in the canonical pipeline ordering. When `activeStages` is provided, the result is filtered to only include active stages. Counterpart of `getDownstreamTypes` (§8.4).

```
function getUpstreamTypes(pipelineType, activeStages?):
  ordering = CANONICAL_PIPELINE_ORDERING
  stages = activeStages ?? ordering
  index = ordering.indexOf(pipelineType)
  if index <= 0:
    return []
  upstream = ordering.slice(0, index)
  return upstream.filter(t => t in stages)
```

**Examples with default (4 stages):**

| Input | Output |
|-------|--------|
| `implementation` | `[]` |
| `qa` | `["implementation"]` |
| `code-review` | `["implementation", "qa"]` |
| `documentation` | `["implementation", "qa", "code-review"]` |

**Examples with all 6 stages active:**

| Input | Output |
|-------|--------|
| `implementation` | `[]` |
| `qa` | `["implementation"]` |
| `security-audit` | `["implementation", "qa"]` |
| `code-review` | `["implementation", "qa", "security-audit"]` |
| `release-engineering` | `["implementation", "qa", "security-audit", "code-review"]` |
| `documentation` | `["implementation", "qa", "security-audit", "code-review", "release-engineering"]` |

> Used by the re-validation guard's upstream activity check ([§11.1](operations.md#111-algorithm)) to distinguish stale prerequisites from self-rework scenarios, and by upstream circuit breaker propagation ([§21.53](edge-cases.md#2153-upstream-circuit-breaker-propagation)).

---

## 9. Pipeline Routing Maps

Four maps control how agents are assigned and how failures/successes are routed. `PIPELINE_AGENT_MAP`, `FAIL_ROUTING_MAP`, and `AGENT_PIPELINE_MAP` are static (they cover all 6 pipeline types). `NEXT_AGENT_MAP` is replaced by the dynamic `resolveNextAgent` function because the next agent depends on which stages are active.

### 9.1 PIPELINE_AGENT_MAP

Maps pipeline type to the agent that owns it. Used to auto-update `assigned_to` when a pipeline starts.

| Pipeline Type | Agent |
|--------------|-------|
| `implementation` | Developer |
| `qa` | QA |
| `security-audit` | Security Auditor |
| `code-review` | Reviewer |
| `release-engineering` | Release Engineer |
| `documentation` | Documentation |

### 9.2 resolveNextAgent (Dynamic Next-Agent Resolution)

In previous versions of this specification, `NEXT_AGENT_MAP` was a static map. With dynamic pipeline composition, the next agent on PASS depends on the work package's `active_pipeline_stages`. The `resolveNextAgent` function replaces the static map:

```
function resolveNextAgent(pipelineType, activeStages):
  // activeStages defaults to DEFAULT_PIPELINE_STAGES when absent/null
  ordering = CANONICAL_PIPELINE_ORDERING
  agentMap = PIPELINE_AGENT_MAP
  index = ordering.indexOf(pipelineType)
  
  if index == -1:
    return null  // Unknown pipeline type
  
  // Find the next active stage after the current one
  for i = index + 1 to ordering.length - 1:
    if ordering[i] in activeStages:
      return agentMap[ordering[i]]
  
  // No more active pipeline stages — route to Synthesis
  return "Synthesis"
```

**Effective routing examples:**

| Pipeline Type | Default (4 stages) | All 6 stages | Doc-only | Verification-only (impl/qa/review) |
|--------------|-------------------|--------------|----------|------------------------------------|
| `implementation` | QA | QA | *(not active)* | QA |
| `qa` | Reviewer | Security Auditor | *(not active)* | Reviewer |
| `security-audit` | *(not active)* | Reviewer | *(not active)* | *(not active)* |
| `code-review` | Documentation | Release Engineer | *(not active)* | Synthesis |
| `release-engineering` | *(not active)* | Documentation | *(not active)* | *(not active)* |
| `documentation` | Synthesis | Synthesis | Synthesis | *(not active)* |

> **Terminal routing:** When `resolveNextAgent` returns `"Synthesis"`, it means there are no more active pipeline stages. This is the signal that the current stage is the **last active stage** — its owning agent is the terminal agent for this WP (see [§6.2.1](state-machines.md#621-dynamic-complete-guard-helpers)).

> **Backward compatibility:** When `activeStages` contains only the 4 default types (`DEFAULT_PIPELINE_STAGES`), `resolveNextAgent` produces the same results as the original static `NEXT_AGENT_MAP`.

### 9.3 FAIL_ROUTING_MAP

Maps pipeline type to the agent responsible for fixing failures. Used for handoff notes on FAIL. The base map is static:

| Pipeline Type | Rework Agent (on FAIL) |
|--------------|------------------------|
| `implementation` | Developer (self-rework) |
| `qa` | Developer |
| `security-audit` | Developer |
| `code-review` | Developer |
| `release-engineering` | Release Engineer (self-rework) |
| `documentation` | Documentation (self-rework) |

#### 9.3.1 FAIL Routing Fallback

When the standard FAIL target's owned pipeline stage is **not active** in the WP's `active_pipeline_stages`, the routing falls back to the agent owning the WP's **first active stage**:

```
function resolveFailAgent(pipelineType, activeStages):
  activeStages = activeStages ?? DEFAULT_PIPELINE_STAGES
  standardTarget = FAIL_ROUTING_MAP[pipelineType]
  targetStage = AGENT_PIPELINE_MAP[standardTarget]  // standardTarget always owns a pipeline type — see AGENT_PIPELINE_MAP consistency invariant (§9.4)
  
  if targetStage in activeStages:
    return standardTarget
  
  // Fallback: route to first active stage's agent
  firstStage = activeStages[0]
  return PIPELINE_AGENT_MAP[firstStage]
```

In practice, this fallback only triggers for unusual compositions where the standard fail target's stage was omitted (e.g., a WP with `["qa", "code-review"]` where a `qa` FAIL would normally route to Developer, but `implementation` is not active — the fallback routes to QA itself for self-rework). For all standard compositions (including the default 4 stages and full 6 stages), the base FAIL_ROUTING_MAP applies directly.

> **Self-referential fallback:** When the fallback routes to the same agent that completed the failing pipeline (e.g., QA FAIL → QA when Developer's stage is not active), this produces a self-rework handoff note. This follows the same self-referential handoff pattern as Documentation (§21.29) and Release Engineering (§21.56).

> **Failure routing rationale:**
> - **Security Auditor (`security-audit`)** failures route to Developer because security issues are typically code-level fixes, consistent with the QA and code-review failure routing pattern.
> - **Release Engineer (`release-engineering`)** failures are self-rework because release issues (versioning, packaging, changelog) are within the Release Engineer's own domain, consistent with the Documentation self-rework pattern.
>
> **Escalation path:** If a release-engineering pipeline FAIL is caused by underlying code issues (not release/packaging quality), the Release Engineer should set the WP to BLOCKED with a `technical` blocker. This follows the same escalation pattern as Documentation failures ([§21.24](edge-cases.md#2124-documentation-fail-escalation)).

### 9.4 AGENT_PIPELINE_MAP (Inverse)

Maps agent role to the pipeline type it owns. Derived from PIPELINE_AGENT_MAP by inversion. This is a convenience lookup for implementations — no algorithm in this specification references it by name, but it is useful for dynamically resolving an agent's pipeline type (e.g., when determining which pipeline to check in `getNextAction`).

| Agent | Pipeline Type |
|-------|--------------|
| Developer | `implementation` |
| QA | `qa` |
| Security Auditor | `security-audit` |
| Reviewer | `code-review` |
| Release Engineer | `release-engineering` |
| Documentation | `documentation` |

> **Map consistency invariant:** `PIPELINE_AGENT_MAP` (§9.1), `FAIL_ROUTING_MAP` (§9.3), and `AGENT_PIPELINE_MAP` (§9.4) must be consistent — every pipeline type that appears as a key in one map must appear in all maps, and `AGENT_PIPELINE_MAP` must be the exact inverse of `PIPELINE_AGENT_MAP`. The `resolveNextAgent` function (§9.2) dynamically derives next-agent routing from `PIPELINE_AGENT_MAP` and `CANONICAL_PIPELINE_ORDERING`, so no separate static `NEXT_AGENT_MAP` needs to be kept in sync. A typo or omission in any map could silently misroute handoffs or skip pipeline stages. Implementations SHOULD validate cross-map consistency at startup (e.g., asserting key-set equality and inverse-mapping correctness) and fail fast on any divergence.
