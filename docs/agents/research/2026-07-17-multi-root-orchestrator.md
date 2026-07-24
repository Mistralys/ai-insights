# Research Report

## Problem Statement

The AI Insights Orchestrator currently configures each Deep Agent stage with a single `LocalShellBackend(root_dir=target_project_path)`, confining the agent's virtual filesystem to one project folder. VS Code Chat agents, by contrast, have access to all repositories in the workspace. This makes cross-repository implementations difficult: plans must be split per repository, and agents lose the holistic view of the broader change.

**Question:** Can Deep Agents be given multiple paths to work in, enabling orchestrated workflows that span repository boundaries?

## Problem Decomposition

1. **Backend architecture:** Does `deepagents` support exposing multiple filesystem roots to a single agent?
2. **Shell execution:** Can `execute()` (shell commands) target different working directories across roots?
3. **Integration surface:** What changes would the Orchestrator's `create_stage_node` factory need to support multi-root?
4. **Path middleware:** How would `PathNormalizationMiddleware` interact with multiple roots?
5. **Prompt & MCP tool impact:** How would agents and MCP tools handle multi-root path semantics?

## Context & Constraints

- Orchestrator uses `deepagents>=0.6,<1` (currently v0.6.12)
- Each stage creates a `LocalShellBackend(root_dir=target_path, virtual_mode=True, inherit_env=True)` in `src/nodes/__init__.py` line 868
- `PathNormalizationMiddleware` rewrites absolute host paths → virtual `/`-rooted paths using a single `root_dir` prefix
- MCP tools receive absolute host paths (skipped by the middleware) and operate via the MCP server, not the backend
- The `target_project_path` state field holds a single absolute path to the target codebase
- The `project_path` state field holds the plan directory path (used for MCP ledger tool calls)

## Prior Art & Known Patterns

### Pattern 1: CompositeBackend (built into deepagents)

- **Description:** `deepagents.backends.CompositeBackend` routes file operations by virtual path prefix. It accepts a `default` backend and a `routes` dict mapping prefix strings (e.g. `"/repo-a/"`) to backend instances. Each route can point to a `LocalShellBackend` with a different `root_dir`.
- **Where used:** Documented as a first-class pattern in the [Deep Agents backends guide](https://docs.langchain.com/oss/python/deepagents/backends). Primary documented use case is routing `/memories/` to `StoreBackend` while keeping default in `StateBackend`. The docs also explicitly describe routing `/workspace/` to `FilesystemBackend`.
- **Strengths:**
  - Native to the library — no monkey-patching or custom backends needed
  - File operations (`ls`, `read`, `write`, `edit`, `glob`, `grep`) are all prefix-routed
  - Path remapping is transparent: listings and search results preserve the virtual prefix
  - Longest-prefix-wins semantics handle nested routes correctly
- **Weaknesses:**
  - **`execute()` is NOT routed** — it always delegates to the `default` backend. The agent's shell `cwd` is always the default backend's `root_dir`. To run commands in a different repo, the agent must `cd` explicitly or use absolute paths in shell commands.
  - The agent's virtual filesystem presents a unified view, but the agent must understand which prefix maps to which repository. This requires clear prompt engineering.
  - `SummarizationMiddleware` and `FilesystemMiddleware` artifacts (`/large_tool_results/`, `/conversation_history/`) go to the default backend. Using `StateBackend` as default (recommended pattern) avoids polluting project directories.
- **Fit:** **High.** This is the mechanism to use. The `execute()` limitation is a friction point but not a blocker.

### Pattern 2: Parent directory as root_dir

- **Description:** Set `root_dir` to the common parent directory of all target repositories. For example, if working on `/workspace/ai-insights/` and `/workspace/ai-persona-builder/`, set `root_dir=/workspace/`.
- **Where used:** Simple single-backend pattern, no composite routing needed.
- **Strengths:**
  - Zero library changes; works with the current Orchestrator code by just passing a different `--project-path`
  - `execute()` cwd is the parent, but relative paths to each repo work naturally
  - All file operations work without prefix routing
- **Weaknesses:**
  - Exposes the entire parent directory tree, not just the target repos — agents can read/write sibling directories
  - `virtual_mode=True` blocks path traversal (`..`) but the agent can still access any child
  - `PathNormalizationMiddleware` would normalize all paths relative to the parent, making virtual paths less intuitive (e.g. `/ai-insights/src/...` instead of `/src/...`)
  - Agent prompts referencing "the project root" become ambiguous
  - MCP tool `project_path` would need to point to each specific repo, not the parent
- **Fit:** **Medium.** Quick workaround for simple cases, but loses precision and introduces prompt confusion.

### Pattern 3: Symlink workspace directory

- **Description:** Create a temporary workspace directory with symlinks to each target repository, then use that as `root_dir`.
- **Where used:** Common pattern in CI/CD systems and monorepo tooling.
- **Strengths:**
  - Clean virtual filesystem layout (`/repo-a/`, `/repo-b/`)
  - Single `root_dir` — no `CompositeBackend` needed
  - `execute()` can `cd` into each subdirectory naturally
- **Weaknesses:**
  - Requires creating/cleaning up temp directories per run
  - `virtual_mode=True` may block symlink traversal depending on the backend's implementation (the `FilesystemBackend` has explicit symlink checks)
  - Cross-platform concern: Windows symlinks require elevated privileges or developer mode
  - Adds operational complexity
- **Fit:** **Low.** The cross-platform policy (AGENTS.md §Cross-Platform Policy) makes this risky.

## Alternative & Creative Approaches

### Approach A: CompositeBackend with LocalShellBackend default + routed repos

**Description:** Use `CompositeBackend` with a `LocalShellBackend` as the `default` (pointed at the primary repo) and route secondary repos via additional `LocalShellBackend` instances:

```python
backend = CompositeBackend(
    default=LocalShellBackend(
        root_dir="/path/to/primary-repo",
        virtual_mode=True,
        inherit_env=True,
    ),
    routes={
        "/secondary-repo/": LocalShellBackend(
            root_dir="/path/to/secondary-repo",
            virtual_mode=True,
            inherit_env=True,
        ),
    },
)
```

The agent sees `/` as the primary repo and `/secondary-repo/` as the secondary. File tools are routed transparently. `execute()` runs with `cwd` at the primary repo; to run commands in the secondary, the agent uses `cd /path/to/secondary-repo && ...` (absolute host paths in shell commands are not restricted by `virtual_mode`).

**Rationale:** This is the most natural fit for the library's design. The primary repo gets the "default" treatment (clean `/`-rooted paths), while secondary repos are explicitly namespaced.

**Risk:** The `execute()` single-cwd limitation means build/test commands in secondary repos require explicit `cd` invocations. The `PathNormalizationMiddleware` currently handles a single `root_dir`; it would need extension to handle multiple root mappings.

### Approach B: Hybrid — CompositeBackend + StateBackend default

**Description:** Use `StateBackend` as the `CompositeBackend` default (for agent artifacts) and route _all_ repos explicitly:

```python
backend = CompositeBackend(
    default=StateBackend(),
    routes={
        "/ai-insights/": LocalShellBackend(root_dir="/path/to/ai-insights", virtual_mode=True, inherit_env=True),
        "/persona-builder/": LocalShellBackend(root_dir="/path/to/persona-builder", virtual_mode=True, inherit_env=True),
    },
)
```

This is the pattern recommended by the Deep Agents documentation for keeping agent internal data separate from project files.

**Rationale:** Cleanest separation. Agent artifacts (offloaded tool results, conversation history) stay in ephemeral state. Both repos are explicitly mounted.

**Risk:**
- `execute()` goes to `StateBackend` which does NOT implement `SandboxBackendProtocol` → **the `execute` tool would be unavailable.** This is a dealbreaker for development workflows.
- Workaround: Wrap `StateBackend` in a custom class that implements `SandboxBackendProtocol` and delegates execution to one of the routed `LocalShellBackend` instances. Feasible but adds complexity.

### Approach C: Multiple runs with artifact sharing

**Description:** Keep the single-root model but orchestrate multiple sequential runs — one per repository — sharing context through the ledger and knowledge store.

**Rationale:** No library changes needed. Each run operates in its well-understood single-root mode.

**Risk:** Loses the holistic view. Cross-repo coordination happens only through the ledger's text artifacts, not through direct file access. Essentially the status quo pain point.

## Comparative Evaluation

| Criterion | CompositeBackend (A) | Parent dir (2) | Symlinks (3) | Hybrid StateDefault (B) | Multi-run (C) |
|---|---|---|---|---|---|
| **Complexity** | Medium — Orchestrator changes + middleware extension | Low — CLI flag only | Medium — temp dir management | High — custom SandboxBackendProtocol wrapper | Low — operational orchestration |
| **File access** | Full, routed by prefix | Full, flat namespace | Full, via symlinks | Full, routed by prefix | Single repo per run |
| **Shell execution** | Works (primary repo cwd) | Works (parent cwd) | Works | Blocked without custom wrapper | Works |
| **Cross-platform** | Yes | Yes | No (Windows symlinks) | Yes | Yes |
| **Agent clarity** | Good — explicit namespaces | Poor — ambiguous root | Good — named subdirs | Good — explicit namespaces | Poor — no cross-repo context |
| **Orchestrator changes** | `create_stage_node`, state, CLI, middleware, prompts | `--project-path` only | Temp dir setup/teardown | Same as A + custom backend class | None |
| **Risk** | Medium — `execute()` cwd quirk | Low | Medium — platform issues | High — custom protocol impl | Low — but doesn't solve the problem |
| **Time to implement** | Days (focused) | Hours | Hours + testing | Days (more complex) | Zero |

## Route Naming Convention

The virtual prefix naming for mounted repositories is an important UX decision for agents.

### Option 1: Nested subfolder — `/mount/persona-builder/`

A `/mount/` parent directory would group all secondary repos and signal their nature clearly. However, this has a **technical problem** with `CompositeBackend`'s routing: intermediate directories are not synthesized. If an agent navigates incrementally (which they do), `ls /mount/` falls through to the default backend, which has no `mount/` directory — the listing fails. Only the full route prefix (`/mount/persona-builder/`) is recognized.

### Option 2 (recommended): Flat prefix — `/mount-persona-builder/`

A flat `mount-` prefix avoids the intermediate-directory problem entirely:

```
ls /                              → shows "/mount-persona-builder/" as entry ✓
ls /mount-persona-builder/        → routed correctly ✓
ls /mount-persona-builder/src/    → routed correctly ✓
```

Benefits:
- **No routing ambiguity** — every prefix is a direct route match
- **Clear semantic signal** — the `mount-` prefix tells agents "this is an external repository, not a subdirectory of the primary project"
- **Scales naturally** — `/mount-persona-builder/`, `/mount-cli-menu/`, etc.
- **No hacks needed** — the nested approach would require a dummy `StateBackend` route for `/mount/` itself to make `ls /mount/` work

The recommended backend configuration becomes:

```python
backend = CompositeBackend(
    default=LocalShellBackend(
        root_dir="/path/to/ai-insights",
        virtual_mode=True, inherit_env=True,
    ),
    routes={
        "/mount-persona-builder/": LocalShellBackend(
            root_dir="/path/to/ai-persona-builder",
            virtual_mode=True, inherit_env=True,
        ),
    },
)
```

## Recommendation

**Use Approach A: `CompositeBackend` with `LocalShellBackend` as default.**

This is the recommended path because:

1. **It's a first-class library feature** — `CompositeBackend` is documented, tested, and maintained by the Deep Agents team. No custom backend classes are needed.

2. **The `execute()` limitation is manageable.** Shell commands always run in the default backend's `cwd` (primary repo). For commands targeting secondary repos, the agent can use `cd /absolute/path && command` — and since `virtual_mode` explicitly does NOT restrict shell execution, this works on all platforms.

3. **The integration surface is well-defined.** The Orchestrator changes are scoped to:
   - **State:** Add `target_project_paths: list[str]` (or a dict mapping virtual names to host paths) alongside the existing `target_project_path`
   - **CLI:** Accept multiple `--project-path` arguments or a workspace definition
   - **`create_stage_node`:** Build a `CompositeBackend` when multiple paths are provided; fall back to current `LocalShellBackend` for single-path runs
   - **`PathNormalizationMiddleware`:** Extend to handle multiple `root_dir` → virtual prefix mappings (currently handles one)
   - **Prompts:** Update `project-path-reminder.md` to explain the multi-root layout to agents
   - **MCP tools:** The `project_path` injected into MCP tool calls remains a single path (the ledger project path) — no change needed

4. **Backward compatible.** Single-path runs continue to work exactly as today.

### Proof-of-Concept Outline

1. **Verify CompositeBackend + dual LocalShellBackend** works with `create_deep_agent` in isolation (pytest, no orchestrator) — confirm file ops route correctly and `execute()` works via the default
2. **Extend `PathNormalizationMiddleware`** to accept a dict of `{virtual_prefix: host_root}` mappings (in addition to the current single-root mode for backward compatibility)
3. **Prototype in `create_stage_node`:** When `target_project_paths` has multiple entries, construct a `CompositeBackend` with the first entry as default and remaining entries as routes
4. **Update user prompt template** to list all mounted repos and their virtual prefixes
5. **Run a cross-repo plan** through the orchestrator to validate end-to-end

## Open Questions

- **Subagent backend sharing:** When the main agent spawns subagents (via the `task` tool), do they inherit the `CompositeBackend` configuration? The `SubAgent` spec accepts a `backend` override, but the general-purpose subagent inherits the parent's backend by default. Need to verify this works with `CompositeBackend`. (Likely yes — the `FilesystemMiddleware` forwards the backend instance.)
- **MCP tool path semantics:** MCP tools (skipped by `PathNormalizationMiddleware`) receive absolute host paths via `inject_project_path()`. For cross-repo work, should MCP tools be aware of which repo is being targeted, or is the single `project_path` (ledger project) sufficient? The MCP server's own tool schemas accept `project_path` as a per-call argument, so this may already work.
- **Performance:** Multiple `LocalShellBackend` instances mean multiple `ripgrep` processes for grep operations across roots. For workspace-wide searches, `CompositeBackend.grep(path="/")` fans out to all backends. Acceptable for 2–3 repos; may need attention for larger workspaces.
- **Naming convention (resolved):** Use the flat `mount-` prefix convention (`/mount-persona-builder/`, `/mount-cli-menu/`). Nested `/mount/repo/` was considered but has a technical limitation — `CompositeBackend` does not synthesize intermediate directories, so `ls /mount/` would fail. See the Route Naming Convention section above.

---

## Addendum — Second-Pass Review (2026-07-17)

A source-code-level review of the orchestrator, `deepagents` v0.6.12, and the middleware chain identified the following gaps in the original analysis. Items are ranked by implementation impact.

### 1. Resolved Open Question: Subagent Backend Inheritance (CONFIRMED)

The original report listed "do subagents inherit the `CompositeBackend`?" as an Open Question. Source code confirms they **do**.

In `create_stage_node` (~line 907), `PathNormalizationMiddleware` is explicitly appended to each subagent's middleware list. Inside `create_deep_agent()` (~line 640), subagent middleware is built with `FilesystemMiddleware(backend=backend)` and `create_summarization_middleware(model, backend)` — both receive the parent's backend instance. Since subagent specs from the orchestrator only carry `name`, `description`, and `system_prompt` (no `tools` or `backend` override), subagents inherit the parent's MCP tools (already wrapped) and the parent's backend.

**Impact:** This is good news — `CompositeBackend` propagation to subagents works for free. No orchestrator changes needed for subagent routing.

### 2. MISSED: `ledger_detect_project` Short-Circuit in `inject_project_path()`

`inject_project_path()` in `src/utils/tool_wrappers.py` **short-circuits** `ledger_detect_project` — it never reaches the MCP server. Instead, it returns a synthetic response derived from the plan directory's slug:

```python
if _ctx.tool_name == "ledger_detect_project":
    slug = _ctx.project_path.rstrip("/").rsplit("/", 1)[-1]
    ...
    return _make_tool_response(payload, input, _ctx.tool_name, status="success")
```

For multi-root workflows, this short-circuit only returns the primary project's slug. If a cross-repo plan needs to register work packages against a secondary project's ledger, this synthetic response would be wrong. The wrapper would need to either (a) be extended with repo-awareness or (b) be bypassed for multi-root runs so the real MCP tool handles detection.

**Impact:** Medium. Blocks multi-repo ledger operations until addressed.

### 3. MISSED: Agent Artifact Pollution in Primary Repo

`create_deep_agent()` automatically injects `FilesystemMiddleware(backend=backend)` and `SummarizationMiddleware(model, backend)`. These middlewares write internal artifacts to the backend:

- `/large_tool_results/` — offloaded oversized tool outputs
- `/conversation_history/` — summarization checkpoints

With `CompositeBackend` where `default=LocalShellBackend(root_dir=primary_repo)`, these artifacts land **in the primary repo's working directory**. This creates git-noise and potential merge conflicts.

**Mitigation options:**
- Add a `/artifacts/` route mapped to a `StateBackend` to capture agent-internal files
- Add `.gitignore` entries for `/large_tool_results/` and `/conversation_history/`
- The second option is simpler but pollutes the filesystem; the first is cleaner but adds another route

**Impact:** Low-medium. Not a functional blocker but a developer-experience annoyance.

### 4. MISSED: Resume/Checkpoint Reconstruction

The orchestrator uses LangGraph checkpoints for resumable runs. On resume, `create_stage_node` **reconstructs** the backend from `WorkflowState` fields — the `CompositeBackend` instance itself is not serialized.

For this to work, `WorkflowState` must contain enough information to reconstruct the `CompositeBackend` on resume — specifically, the full mapping of `{virtual_prefix: host_path}`. The proposed `target_project_paths: list[str]` would suffice, but the **mapping** between virtual prefix names and host paths must be deterministic (derived from the list, not from runtime input).

**Impact:** Low — solvable by design, but the state schema and reconstruction logic must be planned together.

### 5. MISSED: Middleware Interaction with CompositeBackend Path Remapping

The middleware chain is (from outermost to innermost):

```
PathNormalization → PatchToolCalls → Summarization → SubAgent → Filesystem → [backend]
```

`PathNormalizationMiddleware` currently rewrites host paths ↔ virtual paths for a **single** `root_dir`. `CompositeBackend` also performs its own virtual-prefix ↔ host-path mapping internally. These two path-rewriting layers must not conflict.

Specific interaction concern: When the agent uses a host path for the **secondary** repo (e.g. `/Users/user/repos/persona-builder/src/index.ts`), `PathNormalizationMiddleware` currently won't rewrite it (doesn't match the single `root_dir`). It passes through to `CompositeBackend`, which also won't recognize it (expects virtual-prefix paths like `/mount-persona-builder/src/index.ts`). The call falls to the default backend, which tries to read from the primary repo — **silent wrong-file read**.

The multi-root `PathNormalizationMiddleware` extension must map **all** host roots to their virtual prefixes, not just the primary one. This is more complex than the original report's "extend to handle multiple root_dir → virtual prefix mappings" suggests — it requires bidirectional mapping and careful ordering to avoid prefix collisions.

**Impact:** Medium. Must be designed carefully to avoid subtle path-resolution bugs.

### 6. MISSED: Plan Placement and `_infer_project_root()` Interaction

The CLI's `_infer_project_root()` uses `plan_dir.parents[3]` — it assumes the plan lives at `<project-root>/docs/agents/plans/<slug>`. For cross-repo plans, the plan necessarily lives in **one** repo (the primary), and secondary repos must be passed via explicit CLI arguments.

This creates an asymmetry: the primary repo is inferred from plan placement, while secondary repos require `--project-path` (or a new `--mount` flag). The CLI design should make this asymmetry clear to users and in error messages.

**Impact:** Low. A UX concern, not a technical blocker.

### 7. CLARIFIED: Work Package → Repository Scoping (Accepted Design)

`restrict_to_wp()` guards **MCP ledger tool calls only** — it checks `work_package_id` in tool arguments and rejects cross-WP writes. It has zero visibility into filesystem operations (read, write, edit, grep), which go through the Deep Agents backend entirely outside its scope. This is true even in the current single-repo model: `restrict_to_wp()` never prevented an agent from editing a file that conceptually "belongs" to a different WP.

Neither `WorkPackageSummarySchema` nor `WorkPackageDetailSchema` carry a `target_repo` field, but this is not a gap — it mirrors how single-repo scoping already works. The plan document and WP spec files (`work/WP-001.md`) written by the Planner/PM naturally describe what to change and where, including which repository. Agents follow those descriptions. The "wrong repo" risk in a multi-root setup is no different from the "wrong file" risk in a single-repo setup: both rely on plan instructions rather than programmatic enforcement, and both work reliably in practice.

The project-path-reminder partial could list WP-to-repo mappings for additional clarity, but this is a prompt-quality improvement, not a safety gap.

**Impact:** Low. Accepted design characteristic — not a gap requiring mitigation.

### 8. NOTED: Context Window Pressure (Accepted Trade-Off)

Multi-root runs double (or more) the filesystem surface the agent must track. A two-repo workspace means two directory trees, two sets of source files, and cross-repo dependency relationships. This increases:

- Token consumption for `ls` and `grep` results
- The likelihood of the agent "forgetting" context from one repo while focused on the other
- The need for the `SummarizationMiddleware` to offload more aggressively

> **Note:** This concern can be disregarded. The same pressure exists in VS Code Chat and any other multi-repo environment. It is an accepted trade-off when multi-repo support is required for a project — the whole point of this feature is to give orchestrated agents the same cross-repo visibility that IDE-based agents already have.

**Impact:** None. Not actionable.

### 9. NOTED: `glob` and `grep` Fan-Out Across All Backends

The original report mentions `grep` fan-out briefly in Open Questions. Source code confirms that **both** `glob` and `grep` fan out across all backends when `path` is `None` or `"/"`. `upload_files` and `download_files` also group by backend for batch operations.

This fan-out is a feature for workspace-wide searches, but performance scales linearly with the number of mounted repos. For 2–3 repos this is acceptable; for larger workspaces it could be noticeable.

### 10. NOTED: deepagents v0.7.0a7 Path Traversal Fix (Not in v0.6.12)

The pre-release `deepagents==0.7.0a7` (2026-07-14) adds `..` traversal rejection at the sandbox tool level for `glob` and `grep` ([#4588](https://github.com/langchain-ai/deepagents/issues/4588)). In v0.6.12, traversal protection relies entirely on `FilesystemBackend._resolve_path()` under `virtual_mode=True`.

This is not a blocker — `virtual_mode=True` already rejects `..` in file operations — but upgrading to v0.7.x when stable would add defense-in-depth. `execute()` remains unrestricted in both versions (by design — documented as "no sandboxing").

### 11. CORRECTION: Approach B Dismissal May Be Premature

The original report dismisses Approach B (Hybrid `StateBackend` default) because `execute()` would be unavailable. However, `CompositeBackend.execute()` only checks `isinstance(self.default, SandboxBackendProtocol)` — it doesn't need `LocalShellBackend` specifically. A thin wrapper around `StateBackend` that implements `SandboxBackendProtocol` by delegating `execute()` to an injected `LocalShellBackend` would unlock this approach.

The implementation cost is modest (a ~30-line class), and the benefit — agent artifacts going to `StateBackend` instead of polluting project directories (gap #3 above) — may justify it. This should be reconsidered alongside gap #3.

---

### Updated Open Questions

The original Open Questions list should be revised:

| Original Question | Status |
|---|---|
| Subagent backend sharing | **Resolved** — subagents inherit the parent's backend (§1 above) |
| MCP tool path semantics | **Unchanged** — still open, compounded by the `ledger_detect_project` short-circuit (§2) |
| Performance (grep fan-out) | **Unchanged** — confirmed, including `glob` (§9) |
| Naming convention | **Resolved** in the original report (flat `mount-` prefix) |

**New open questions:**

- **Artifact isolation strategy:** Use a `/artifacts/` route to `StateBackend`, `.gitignore` entries, or a hybrid default backend? (§3, §11)
- **Multi-repo ledger operations:** Can a single orchestrator run manage work packages across multiple ledger projects, or should multi-root be limited to a single ledger project with file access to secondary repos? (§2)
- **deepagents upgrade timeline:** When v0.7.x reaches stable, upgrading would provide sandbox-level traversal protection for `glob`/`grep`. Should the multi-root implementation target v0.6.x or wait for v0.7.x? (§10)

---

## References

- [Deep Agents v0.6.12 — `CompositeBackend` source](https://github.com/langchain-ai/deepagents/blob/7e70065/libs/deepagents/deepagents/backends/composite.py#L107) (installed at `orchestrator/.venv/`)
- [Deep Agents Backends documentation](https://docs.langchain.com/oss/python/deepagents/backends) — routing patterns, `CompositeBackend` examples
- [Deep Agents API reference: `CompositeBackend`](https://reference.langchain.com/python/deepagents/backends/composite/CompositeBackend)
- Orchestrator stage factory: `orchestrator/src/nodes/__init__.py` lines 810–920
- `PathNormalizationMiddleware`: `orchestrator/src/utils/path_middleware.py`
- Current state schema: `orchestrator/src/state.py` — `WorkflowState.target_project_path`
- Prompt template: `orchestrator/src/nodes/templates/partials/project-path-reminder.md`
- `inject_project_path()`: `orchestrator/src/utils/tool_wrappers.py` — short-circuit logic and `setdefault` semantics
- `create_deep_agent()` middleware stack: `deepagents` v0.6.12, `graph.py` lines 640–760
- `_resolve_path()` traversal checks: `deepagents/backends/filesystem.py` lines 188–214
- deepagents v0.7.0a7 release notes: sandbox-level `..` rejection for `glob`/`grep` ([#4588](https://github.com/langchain-ai/deepagents/issues/4588))
