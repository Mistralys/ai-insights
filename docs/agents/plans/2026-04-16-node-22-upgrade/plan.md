# Plan

## Summary

Upgrade the minimum Node.js version requirement across the entire AI Insights workspace from >=18 to >=22.0.0. This affects the MCP server, personas build system, orchestrator (which depends on Node.js for the MCP server subprocess), GitHub Actions CI/CD workflows, documentation, and generated `.context/` files.

## Architectural Context

The workspace has three sub-projects that depend on Node.js:

- **MCP Server** (`mcp-server/`): TypeScript ESM project. Currently targets ES2022 with Node16 module resolution. Already uses `@types/node: ^22.10.5` in devDependencies — the type definitions already target Node 22.
- **Personas Build System** (`personas/`): JavaScript CommonJS project using `@mistralys/persona-builder`. Documentation states Node.js ≥ 18.
- **Orchestrator** (`orchestrator/`): Python project that spawns the MCP server as a Node.js subprocess. Documentation states Node.js 18+.

CI runs on Node 20 across all jobs. No `engines.node` fields exist in any `package.json`. No `.nvmrc` or `.node-version` files exist.

### Current Version References

| File | Current Value | Type |
|------|---------------|------|
| `README.md` (L62) | `Node.js >= 18` | Documentation |
| `orchestrator/README.md` (L30) | `18+` | Documentation |
| `orchestrator/README.md` (L383) | `v18 or higher` | Documentation |
| `personas/docs/agents/project-manifest/tech-stack.md` (L7) | `Node.js ≥ 18` | Manifest doc |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` (L7) | `Node.js` (no version) | Manifest doc |
| `mcp-server/docs/agents/project-manifest/constraints.md` (L554) | `Node.js 20` | CI gate doc |
| `.github/workflows/ci.yml` (L19, L43, L91, L105) | `'20'` | CI runner (×4 jobs) |
| `.github/workflows/release-personas.yml` (L22) | `'20'` | CI runner |
| `.context/README.md` (L73) | `Node.js >= 18` | Generated doc |
| `.context/personas/manifest.md` (L1427) | `Node.js ≥ 18` | Generated doc |
| `.context/orchestrator/overview.md` (L42) | `18+` | Generated doc |
| `mcp-server/tsconfig.json` | `target: ES2022`, `module: Node16` | Compiler config |

## Approach / Architecture

This is a documentation + configuration sweep with one optional TypeScript compiler upgrade:

1. **Add `engines.node` fields** to all `package.json` files to enforce `>=22.0.0` at install time.
2. **Update CI workflows** from `node-version: '20'` to `node-version: '22'`.
3. **Update all documentation** to reflect the new minimum version.
4. **Upgrade TypeScript compiler target** from `ES2022` / `Node16` to `ES2024` / `NodeNext` to unlock newer language features available in Node 22 (e.g., `Set` methods, `Promise.withResolvers`, `ArrayBuffer.resize`, `RegExp` v flag).
5. **Regenerate `.context/` docs** so the auto-generated docs reflect the new version.

## Rationale

- Node 22 is the current Active LTS release (LTS since October 2024, maintained until April 2027).
- The MCP server already uses `@types/node: ^22.10.5`, meaning the codebase already targets Node 22 types.
- CI already runs on Node 20 (not 18), so bumping to 22 is a single step rather than a jump of two major versions.
- Node 18 reached end-of-life on September 11, 2025 — over 7 months ago. Continuing to support it is a liability.

## Detailed Steps

### 1. Add `engines.node` field to all `package.json` files

Add `"engines": { "node": ">=22.0.0" }` to:

- `package.json` (workspace root)
- `mcp-server/package.json`
- `personas/package.json`

### 2. Update GitHub Actions CI workflows

In `.github/workflows/ci.yml`, change all four `node-version: '20'` lines to `node-version: '22'`:

- L19: `mcp-server-tests` job
- L43: `orchestrator-tests` job
- L91: `manifest-validation` job
- L105: `persona-build-check` job

In `.github/workflows/release-personas.yml`, change `node-version: '20'` (L22) to `node-version: '22'`.

### 3. Update root documentation

In `README.md` (L62), change `Node.js >= 18` to `Node.js >= 22`.

### 4. Update MCP Server documentation

In `mcp-server/docs/agents/project-manifest/tech-stack.md` (L7):
- Update the Runtime row to specify `Node.js ≥ 22`.

In `mcp-server/docs/agents/project-manifest/constraints.md` (L554):
- Change `Node.js 20` to `Node.js 22` in the CI gate description.

In `mcp-server/README.md` (L128):
- Change `Node.js (ESM-compatible version)` to specify `Node.js >= 22`.

### 5. Update Personas documentation

In `personas/docs/agents/project-manifest/tech-stack.md` (L7):
- Change `Node.js ≥ 18` to `Node.js ≥ 22`.

### 6. Update Orchestrator documentation

In `orchestrator/README.md`:
- L30: Change `18+` to `22+` in the prerequisites table.
- L383: Change `v18 or higher` to `v22 or higher`.

### 7. Update TypeScript compiler configuration

In `mcp-server/tsconfig.json`:
- Change `"target": "ES2022"` to `"target": "ES2024"`.
- Change `"module": "Node16"` to `"module": "NodeNext"`.
- Change `"moduleResolution": "Node16"` to `"moduleResolution": "NodeNext"`.
- Change `"lib": ["ES2022"]` to `"lib": ["ES2024"]`.

Then update `mcp-server/docs/agents/project-manifest/tech-stack.md` to reflect the new target:
- Change `ES2022` → `ES2024` and `Node16 module resolution` → `NodeNext module resolution`.

### 8. Update AGENTS.md project statistics

In `AGENTS.md` at the root, the Project Statistics table references `TypeScript 5.7.2 (ES2022)` for the MCP Server. Update this to `TypeScript 5.7.2 (ES2024)`.

### 9. Regenerate `.context/` generated docs

Run `node scripts/cli.js ctx-generate` to regenerate all `.context/` files so they reflect the updated documentation. This will automatically pick up the changes from:
- `.context/README.md` (mirrors root `README.md`)
- `.context/personas/manifest.md` (mirrors personas tech-stack.md)
- `.context/orchestrator/overview.md` (mirrors orchestrator README.md)
- `.context/mcp-server/manifest.md` (mirrors mcp-server tech-stack.md)

### 10. Run test suites to verify no regressions

- `cd mcp-server && npm test` — MCP server Vitest suite
- `cd orchestrator && pytest` — Orchestrator pytest suite
- `node scripts/build-personas.js --check` — Personas build check
- `node scripts/validate-workflow-manifest.js` — Manifest validation

## Dependencies

- Node.js 22 must be installed on the developer machine.
- CI runners (GitHub Actions `ubuntu-latest`) support Node 22 via `actions/setup-node`.

## Required Components

### Files to modify

- `package.json` (root)
- `mcp-server/package.json`
- `personas/package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-personas.yml`
- `README.md`
- `mcp-server/README.md`
- `mcp-server/docs/agents/project-manifest/tech-stack.md`
- `mcp-server/docs/agents/project-manifest/constraints.md`
- `personas/docs/agents/project-manifest/tech-stack.md`
- `orchestrator/README.md`
- `mcp-server/tsconfig.json`
- `AGENTS.md`

### Files auto-regenerated

- `.context/README.md`
- `.context/personas/manifest.md`
- `.context/orchestrator/overview.md`
- `.context/mcp-server/manifest.md`
- `.context/agents.md`

## Assumptions

- Node.js 22 is already installed locally (or will be before implementation).
- No application code depends on Node 18- or Node 20-specific behavior that was changed or removed in Node 22.
- All npm dependencies are compatible with Node 22 (highly likely given `@types/node: ^22.10.5` already in use).

## Constraints

- Package-lock files (`package-lock.json`) will not be manually edited. They will be regenerated by `npm install` after `engines` fields are added.
- Historical plan documents (under `docs/agents/implementation-history/`) that reference Node 18 will NOT be updated — they are historical records.

## Out of Scope

- Upgrading the two sibling workspace projects (`ai-persona-builder`, `cli-menu`) — those are separate packages with their own release cycles.
- Upgrading npm dependencies to take advantage of Node 22 features.
- Removing any Node 18/20 compatibility shims (none are known to exist).
- Changing the Python version for the orchestrator.

## Acceptance Criteria

- All `package.json` files declare `"engines": { "node": ">=22.0.0" }`.
- All CI jobs run on `node-version: '22'`.
- All documentation and manifest files reference Node.js 22 as the minimum version.
- `mcp-server` test suite passes on Node 22.
- `orchestrator` test suite passes on Node 22.
- Persona build check passes.
- `.context/` docs are regenerated and reflect the new version.

## Testing Strategy

1. Run the MCP server test suite (`cd mcp-server && npm test`) on Node 22.
2. Run the orchestrator test suite (`cd orchestrator && pytest`) with Node 22 on PATH.
3. Run the persona build check (`node scripts/build-personas.js --check`).
4. Run the manifest validation (`node scripts/validate-workflow-manifest.js`).
5. Verify CI passes on a push/PR after the changes are committed.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **npm dependency incompatible with Node 22** | Extremely unlikely — `@types/node ^22.10.5` is already in use and CI runs on Node 20 (one major version away). Run `npm install` and full test suite before committing. |
| **TypeScript `NodeNext` module resolution behavioral change** | If any issues arise during `tsc` compilation, revert to `Node16` and keep `ES2024` target only. `NodeNext` is the recommended successor to `Node16` and should be fully compatible. |
| **CI runner doesn't have Node 22 available** | `actions/setup-node@v6` supports Node 22. It's the current Active LTS — no risk here. |
| **Breaking change in Node 22 runtime behavior** | Node 22 has no known breaking changes that affect the patterns used in this codebase (ESM, fs, path, child_process). Full test suite run mitigates this. |
