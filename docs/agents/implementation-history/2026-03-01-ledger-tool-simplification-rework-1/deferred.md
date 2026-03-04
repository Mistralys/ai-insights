# Deferred Optimization Candidates

These items were identified in the 2026-03-01 Ledger Tool Simplification synthesis but are explicitly **out of scope** for this project. They are documented here for future scheduling.

---

## Synthesis #6 — `getNextActionsCollector` Eager Loading

**Location:** `mcp-server/src/tools/workflow-next-action.ts`

**Current behaviour:** `getNextActionsCollector` fetches all WP details upfront via `Promise.all` before scanning for actionable results.

**Future optimization:** Refactor to an early-exit sequential fetch pattern — load one WP at a time and stop at the first actionable result. This eliminates unnecessary I/O for projects where the first actionable WP appears early in the list.

**Trigger:** Schedule when large ledgers (100+ WPs) show measurable latency impact on `ledger_get_next_actions` calls.

---

## Synthesis #7 — `workflow-next-action.ts` File Split

**Location:** `mcp-server/src/tools/workflow-next-action.ts` (~1,525+ lines)

**Current behaviour:** The file contains both single-action logic (per-agent `get*Action` functions) and batch logic (`getNextActionsCollector`), making it one of the largest files in the codebase.

**Future optimization:** Extract the batch logic into a separate `workflow-next-action-batch.ts` module to improve navigability and maintainability.

**Trigger:** Schedule when the next batch-related work occasion arises naturally. Avoid a split purely for size — co-location of single and batch logic is acceptable until a functional seam makes the split natural.

---

## Synthesis #9 — `computeHandoffStatus` I/O Overhead

**Location:** `mcp-server/src/tools/workflow-handoff.ts`

**Current behaviour:** `computeHandoffStatus` creates a new `LedgerStore` instance per WAIT response and re-reads WP details that may already be in memory higher in the call chain (e.g. in `getDeveloperHandoff`).

**Future optimization:** Thread pre-loaded WP details through `embedHandoffStatusInWait` → `computeHandoffStatus` → `buildHandoffResponse` to avoid the extra disk reads on every WAIT response.

**Trigger:** Schedule when handoff response latency becomes a user-visible issue, or when the surrounding call graph is refactored for other reasons (e.g. #7 file split).

---

*Recorded: 2026-03-01 | Source: synthesis.md from 2026-03-01-ledger-tool-simplification-rework-1*
