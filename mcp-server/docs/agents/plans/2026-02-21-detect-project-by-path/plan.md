# Plan

## Summary

Agents need a way to identify which project they are working on without requiring the `work.md` (or any plan-folder file) to be open. The fix is a new `ledger_detect_project` MCP tool that accepts a working directory path, cross-references it against all project roots stored in the centralized ledger's `.meta.json` files, and returns the unique project's `plan_path`. If zero or more than one project matches the given path, the tool cancels with a descriptive error rather than guessing.

Once the tool exists, the pre-flight check section of agents 3–7 (Developer, QA, Reviewer, Documentation, Synthesis) is updated to auto-detect the project using this tool when no explicit `project_path` is provided, eliminating the requirement for an open `work.md` file. Agent 2 (Project Manager) is unchanged — it always receives the explicit path from the planner.

---

## Architectural Context

### Ledger & Slug Layout

Every project is stored in the centralized ledger root (default: `{mcp-server}/storage/ledger/`) under a directory named after the plan folder **slug** (e.g., `2026-02-16-feature`). Each slot contains:

- `project-ledger.json` — root index
- `WP-###.json` — work package details
- `.meta.json` — lightweight project metadata

### Relevant Schema: `ProjectMeta` ([src/schema/project-meta.ts](../../../../../src/schema/project-meta.ts))

```typescript
{
  slug: string;         // plan folder basename
  plan_path: string;    // absolute path to the plan folder — KEY FIELD
  status: ...;
  date_created: string;
  last_updated: string;
  title?: string;
}
```

`plan_path` is the canonical record of where on disk the plan folder lives. The path always follows the convention:

```
{project-root}/docs/agents/plans/{YYYY-MM-DD}-{name}
```

This gives us exactly **4 path segments** between the project root and the slug.

### Project Enumeration

`LedgerStore.listAllProjects()` ([src/storage/ledger-store.ts](../../../../../src/storage/ledger-store.ts)) already scans all `.meta.json` files in the ledger root and returns `ProjectMeta[]`. No new I/O infrastructure is needed.

### Existing Utilities

| File | Relevant Export |
|------|-----------------|
| `src/utils/ledger-root.ts` | `resolveLedgerRoot()`, `projectSlugFromPath()` |
| `src/utils/path-validator.ts` | `planFolderBasename()`, `validatePlanPath()` |
| `src/storage/ledger-store.ts` | `LedgerStore.listAllProjects()` |
| `src/tools/project-lifecycle.ts` | Houses all project-level tools; new tool belongs here |

### Existing Tools

There are currently **18 MCP tools**. The new tool makes 19. All project-level tools live in `project-lifecycle.ts` and are registered from its `register()` function.

### Persona Files

All agent personas live in `personas/ledger/` and sync to `personas/vanilla/` via `sync-personas.js`. The pre-flight check is the one section shared identically across agents 3–7 — each persona has a `### Pre-flight check` section under `## MCP Tools — Project Ledger`. Agent 2's pre-flight differs (it expects the project to be uninitialized) and is **not changed** by this plan.

---

## Approach / Architecture

### Core Idea: Derive Project Root from `plan_path`

Given the path convention `{project-root}/docs/agents/plans/{slug}`, the project root is `plan_path` minus 4 trailing segments. Normalize both the derived project root and the supplied `cwd_path` (to lowercase on Windows; resolve separators), then check:

```
normalize(cwd_path).startsWith(normalize(project_root) + sep)
OR
normalize(cwd_path) === normalize(project_root)
```

Any project where this is true is a **candidate**. Exactly one candidate → unique match. Zero → `NOT_FOUND`. Many → `AMBIGUOUS`.

### Why 4-Segment Depth?

The constraint is enforced by `validatePlanPathOrError()` (which all initialization tools already call) combined with the documented convention in `path-validator.ts`. No project can be legitimately initialized outside this structure, so the depth is reliable.

### Tolerance for Sub-Plan Paths

If an agent is working deep inside the codebase (e.g., `f:\project\src\tools\`), it is still a descendant of the project root and will match correctly. If an agent provides the plan folder itself (e.g., `f:\project\docs\agents\plans\2026-02-16-feature`), it is also a descendant of the project root and matches.

### New Components

1. **`inferProjectRootFromPlanPath(planPath: string): string`** — pure utility function  
   Location: `src/utils/ledger-root.ts` (already contains related path helpers)  
   Logic: calls `dirname()` four times on the normalized plan path.

2. **`LedgerStore.detectProjectByCwd(cwdPath, ledgerRoot?)`** — static method  
   Location: `src/storage/ledger-store.ts`  
   Logic: enumerates all projects, derives project root for each, checks if `cwdPath` is under it, returns `{ status: 'FOUND', meta } | { status: 'NOT_FOUND' } | { status: 'AMBIGUOUS', candidates: ProjectMeta[] }`.

3. **`ledger_detect_project` MCP tool**  
   Location: `src/tools/project-lifecycle.ts`  
   Input schema: `{ cwd_path: string }`  
   Success output: `{ plan_path, slug, title?, status }` from the matched `ProjectMeta`  
   Failure output: descriptive error (not found / ambiguous with candidate list)

4. **Updated pre-flight check** (agents 3–7)  
   The old pre-flight required the agent to already know `project_path` before it could verify server reachability. The new flow is:
   1. Load tools via `tool_search_tool_regex` (pattern `ledger_`) — unchanged.
   2. **If no explicit `project_path` is provided:** call `ledger_detect_project` with `cwd_path` set to the workspace/codebase root directory.
      - `FOUND` → use returned `plan_path` as `project_path` for the rest of the session.
      - `NOT_FOUND` or `AMBIGUOUS` → stop and surface the error to the user.
   3. Verify the MCP server by calling `ledger_get_project_status` with the resolved `project_path` — unchanged.

---

## Rationale

- **No "active project" singleton** — avoids concurrency issues with parallel projects; pure path-matching is stateless.
- **Uses existing `.meta.json` scan** — `LedgerStore.listAllProjects()` already exists and handles skipping of invalid/archived entries. No new I/O infrastructure required.
- **Fails loudly on ambiguity** — returning a wrong project would be worse than cancelling. The convention of one project per codebase makes true ambiguity rare in practice.
- **Pure utility function for the root derivation** — isolated, trivially testable, avoids duplicating logic across tests and production code.
- **Static method on `LedgerStore`** — keeps storage-layer concerns together; mirrors the pattern of the existing `listAllProjects()` static method.

---

## Detailed Steps

1. **Add `inferProjectRootFromPlanPath`** to `src/utils/ledger-root.ts`  
   - Accept an absolute `planPath` string  
   - Normalize backslashes to forward slashes  
   - Call `dirname()` four times to walk up 4 segments  
   - Return the resulting project root path

2. **Add `LedgerStore.detectProjectByCwd`** static method to `src/storage/ledger-store.ts`  
   - Call `LedgerStore.listAllProjects(ledgerRoot)` to get all `ProjectMeta[]`  
   - For each meta, call `inferProjectRootFromPlanPath(meta.plan_path)` to get its project root  
   - Normalize `cwdPath` and each project root (lowercase on Windows, forward slashes)  
   - Collect all projects where `normalizedCwd` starts with `normalizedProjectRoot + /` or equals it  
   - Return typed discriminated union: `FOUND`, `AMBIGUOUS`, or `NOT_FOUND`

3. **Add `ledger_detect_project` tool** to `src/tools/project-lifecycle.ts`  
   - Input schema: `{ cwd_path: z.string() }` with a clear description  
   - Call `LedgerStore.detectProjectByCwd(args.cwd_path)`  
   - On `FOUND`: return JSON with `plan_path`, `slug`, `title`, `status`  
   - On `NOT_FOUND`: return error — no project tracks a codebase containing this path  
   - On `AMBIGUOUS`: return error listing all candidate `plan_path` values  
   - Register the tool inside the existing `register()` function in `project-lifecycle.ts`

4. **Write unit tests** for the new utility and static method  
   - `src/utils/ledger-root.ts`: test `inferProjectRootFromPlanPath` with Unix and Windows paths  
   - `src/storage/ledger-store.ts`: test `detectProjectByCwd` with mocked `.meta.json` files covering FOUND, NOT_FOUND, and AMBIGUOUS scenarios  
   - Test case: `cwd_path` is the plan folder itself → should still match  
   - Test case: `cwd_path` is an ancestor of project root → should NOT match  

5. **Update manifest documents**  
   - `docs/agents/project-manifest/api-surface.md`: add `ledger_detect_project` tool signature and `inferProjectRootFromPlanPath` utility  
   - `docs/agents/project-manifest/file-tree.md`: no new files; annotate `ledger-root.ts` with the new export  
   - `docs/agents/project-manifest/data-flows.md`: add a flow for the detection logic

6. **Update persona pre-flight checks** (agents 3–7)  
   In each of `personas/ledger/3-developer.md`, `4-qa.md`, `5-reviewer.md`, `6-documentation.md`, `7-synthesis.md`:
   - Replace the existing `### Pre-flight check` section with the new two-phase version described in the Approach section above.
   - Update the **Tools you will use** table to add a row for `ledger_detect_project` with the purpose "Detect the active project from the current workspace path when `project_path` is not explicitly provided."  
   - Bump each persona's version (patch increment: e.g., `3.2.0` → `3.3.0`) and update `Last Updated`.
   - After editing, run `node sync-personas.js` from the workspace root to propagate changes to `personas/vanilla/`.

---

## Dependencies

- `LedgerStore.listAllProjects()` — already exists; no changes needed to its signature
- `resolveLedgerRoot()` — already exported from `ledger-root.ts`; reused as-is
- Node.js `path` module: `dirname`, `normalize`, `sep` — already used throughout the codebase

---

## Required Components

### New

| Component | Location | Type |
|-----------|----------|------|
| `inferProjectRootFromPlanPath()` | `src/utils/ledger-root.ts` | Exported utility function |
| `LedgerStore.detectProjectByCwd()` | `src/storage/ledger-store.ts` | Static async method |
| `ledger_detect_project` MCP tool | `src/tools/project-lifecycle.ts` | MCP tool registration |
| Unit tests for utility | `tests/utils/ledger-root.test.ts` | Test additions |
| Unit tests for static method | `tests/storage/ledger-store.test.ts` | Test additions |

### Existing (Modified)

| File | Change |
|------|--------|
| `src/utils/ledger-root.ts` | Add `inferProjectRootFromPlanPath` |
| `src/storage/ledger-store.ts` | Add `detectProjectByCwd` static method |
| `src/tools/project-lifecycle.ts` | Add tool handler + registration |
| `docs/agents/project-manifest/api-surface.md` | Document new tool + utility |
| `docs/agents/project-manifest/file-tree.md` | Annotate new export |
| `docs/agents/project-manifest/data-flows.md` | Document detection flow |
| `personas/ledger/3-developer.md` | Updated pre-flight check + tools table |
| `personas/ledger/4-qa.md` | Updated pre-flight check + tools table |
| `personas/ledger/5-reviewer.md` | Updated pre-flight check + tools table |
| `personas/ledger/6-documentation.md` | Updated pre-flight check + tools table |
| `personas/ledger/7-synthesis.md` | Updated pre-flight check + tools table |

---

## Assumptions

- The plan folder is always exactly 4 levels below the project root (`docs/agents/plans/{slug}/`). This is the established convention enforced by `validatePlanPathOrError()`.
- Path comparison on Windows is case-insensitive. The implementation must lowercase both sides before comparing.
- Agents pass the directory they are operating from as `cwd_path`, not a file path. If a file path is passed, `dirname()` can be called to obtain the directory.
- For the persona pre-flight, agents should use the **workspace root** (the project folder open in VS Code) as `cwd_path`. Agents always operate within a known workspace, so this value is always deterministic.
- A project that has been archived (slug starts with `.`) is already excluded by `listAllProjects()` and will never appear as a candidate.

---

## Constraints

- No new files may be created inside plan folders (existing constraint 3a from `constraints.md`).
- All file reads must use the existing `LedgerStore.listAllProjects()` path to stay consistent with the central ledger pattern.
- The new tool must not require `project_path` as a parameter — that would defeat the purpose of the feature.
- The tool must not introduce a global "active project" state on the server.

---

## Out of Scope

- Fuzzy or similarity-based matching (e.g., Levenshtein distance on project names).
- Modifying the Project Manager persona (agent 2) — it always receives the plan path explicitly.
- Modifying existing MCP tools to auto-call `detectProjectByCwd` internally.
- Persisting the "detected project" in any cache or session state.
- Supporting projects whose plan paths do not follow the `docs/agents/plans/slug` convention.

---

## Acceptance Criteria

- `ledger_detect_project` returns the correct `plan_path` when `cwd_path` is anywhere inside the project root.
- `ledger_detect_project` returns the correct `plan_path` when `cwd_path` is the plan folder itself.
- `ledger_detect_project` returns a `NOT_FOUND` error when no known project's root is an ancestor of `cwd_path`.
- `ledger_detect_project` returns an `AMBIGUOUS` error listing all candidates when two or more projects share an ancestor relationship with `cwd_path`.
- `ledger_detect_project` does NOT match when `cwd_path` is a parent of the project root (i.e., does not match upward).
- Path comparison is case-insensitive on Windows.
- All new logic is covered by unit tests with at least: found, not-found, ambiguous, and exact-plan-path-as-cwd cases.
- Manifest documents updated: `api-surface.md`, `file-tree.md`, `data-flows.md`.
- Persona pre-flight checks in agents 3–7 updated to use `ledger_detect_project` when `project_path` is not explicitly known.
- `ledger_detect_project` listed in the **Tools you will use** table of each updated persona.
- `sync-personas.js` run after persona edits; `personas/vanilla/` reflects the changes.
- Agent 2 (Project Manager) persona is unchanged.

---

## Testing Strategy

Unit tests in `tests/utils/ledger-root.test.ts` will cover `inferProjectRootFromPlanPath` with both Unix and Windows absolute paths.

Unit tests in `tests/storage/ledger-store.test.ts` will use `createTempStore` (or a mock of `listAllProjects`) to create two or more projects and exercise the FOUND, AMBIGUOUS, and NOT_FOUND branches of `detectProjectByCwd`. The existing `create-temp-store.ts` test helper provides the scaffolding needed.

No integration test is required for this feature: the detection logic is pure path string manipulation above an already-tested I/O method.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Non-conventional plan paths** — a project initialized outside `docs/agents/plans/` would not be matched | Document the assumption clearly; flag it as a known limitation in the tool's description. The `validatePlanPathOrError()` guard on initialization already discourages non-conventional paths. |
| **Case sensitivity on Linux/macOS** — projects hosted on case-sensitive file systems using mixed case would fail silently | Comparison lowercasing is only applied on Windows (`process.platform === 'win32'`); on Unix, use exact comparison. |
| **False positive for monorepo layouts** — two projects in the same monorepo at `{root}/apps/a/docs/agents/plans/slug-a` and `{root}/apps/b/docs/agents/plans/slug-b` produce different project roots and will not collide | No mitigation needed; the 4-level derivation naturally isolates sub-roots. |
| **`cwd_path` is above all project roots** — ancestor path matches nothing | Tool returns NOT_FOUND with a clear suggestion to provide a more specific path or initialize the project. |
