# Orchestrator Changelog

## v0.2.1 - Documentation Structure
- Docs: Updated and split READMEs for clarity.

## v0.2.0 - Ledger Delegation Architecture (Breaking-S)
- Architecture: Delegated all logic execution to the ledger system.
- Scripts: Replaced the primary execution script.

### Breaking Changes
This release significantly refactors the orchestration logic, moving execution responsibility to the ledger. Previous local execution patterns may be deprecated.

## v0.1.1 - Logic Cycle Stabilization
- Logic: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial implementation of the LangGraph-based pipeline.
- Core: Completed post-development rework and stabilization.
- Config: Updated `.env.example`.
- Housekeeping: Removed temporary folders.
